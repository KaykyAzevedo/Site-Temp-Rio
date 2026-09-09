-- 004 — Usuários e clientes
--
-- Rode DEPOIS de admin/supabase.sql (001), supabase-regioes.sql (002) e
-- supabase-vitrine.sql (003). Ver admin/migracoes/LEIAME.md.
--
-- ============================================================================
-- POR QUE ESTAS TABELAS NÃO SÃO LOGIN
-- ============================================================================
--
-- O site não tem cadastro nem senha de comprador, e não vai ter tão cedo: o
-- lojista digita os dados no pedido e envia. `usuarios` aqui é um CADASTRO,
-- não uma tabela de autenticação — quem autentica é o Supabase Auth, e quem
-- autoriza é a tabela `admins` da migração 001.
--
-- Estas tabelas se preenchem SOZINHAS a partir dos pedidos (gatilho na
-- migração 006). Nenhuma linha do site precisa mudar para elas começarem a
-- existir.
--
-- ============================================================================
-- A CHAVE É O CNPJ, PORQUE JÁ ERA
-- ============================================================================
--
-- O painel já agrupa histórico por CNPJ e a função historico_do_cliente() já
-- casa CNPJ ignorando pontuação. Inventar um id de cliente agora criaria uma
-- segunda identidade concorrendo com a que o sistema já usa.
--
-- A coluna `documento` normaliza CNPJ ou CPF para só dígitos e é o que carrega
-- a unicidade: "12.345.678/0001-90" e "12345678000190" são a mesma empresa.

-- ============================================================================
-- 1. Usuários (clientes e vendedores)
-- ============================================================================
create table if not exists public.usuarios (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  tipo text not null default 'cliente'
    check (tipo in ('cliente', 'vendedor')),

  nome text not null,
  email text,
  telefone text,

  cpf text,
  cnpj text,

  -- Documento em dígitos puros. É coluna GERADA: não dá para ficar fora de
  -- sincronia com cpf/cnpj, porque o banco a recalcula a cada escrita.
  documento text generated always as (
    coalesce(
      nullif(regexp_replace(coalesce(cnpj, ''), '[^0-9]', '', 'g'), ''),
      nullif(regexp_replace(coalesce(cpf,  ''), '[^0-9]', '', 'g'), '')
    )
  ) stored,

  -- Soft delete: nada some do banco, porque pedido antigo aponta para cá.
  ativo boolean not null default true,
  removido_em timestamptz,

  observacoes text
);

-- Unicidade só entre os vivos: apagar e recadastrar o mesmo CNPJ é possível.
create unique index if not exists usuarios_documento_uk
  on public.usuarios (documento)
  where documento is not null and removido_em is null;

create index if not exists usuarios_tipo_idx on public.usuarios (tipo);
create index if not exists usuarios_nome_idx on public.usuarios (lower(nome));

-- ============================================================================
-- 2. Clientes (o lojista, com endereço e região)
-- ============================================================================
-- Um `usuario` é a pessoa/empresa; um `cliente` é essa empresa COMO COMPRADORA,
-- com endereço de entrega e região. A separação parece cerimônia num negócio
-- com um vendedor só, mas é ela que permite o mesmo CNPJ ter duas lojas em
-- bairros diferentes — que é o caso comum em rede pequena.
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  apelido text,                    -- "Loja da Tijuca", quando há mais de uma

  inscricao_estadual text,
  isento_ie boolean not null default false,

  -- CEP em TEXTO de 8 dígitos, nunca número: number come o zero à esquerda, e
  -- metade do Rio começa com 2. É a mesma decisão da migração 002.
  --
  -- `text` e não `char(8)`: char coage o tipo ao montar a tupla, antes de
  -- qualquer gatilho, então um CEP mascarado ("20520-000") seria recusado com
  -- "value too long" sem chance de ser normalizado. A CHECK lá embaixo é
  -- avaliada DEPOIS dos gatilhos e garante o mesmo formato.
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf char(2),

  regiao_entrega_id text references public.regioes(id) on delete set null,

  ativo boolean not null default true,
  removido_em timestamptz,
  observacoes text,

  constraint cep_so_digitos check (cep is null or cep ~ '^[0-9]{8}$')
);

-- Índice pedido explicitamente: busca por CEP no painel.
create index if not exists clientes_cep_idx on public.clientes (cep);
create index if not exists clientes_usuario_idx on public.clientes (usuario_id);
create index if not exists clientes_regiao_idx on public.clientes (regiao_entrega_id);

-- ============================================================================
-- 3. Datas de alteração carimbadas no banco
-- ============================================================================
create or replace function public.marcar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists usuarios_atualizacao on public.usuarios;
create trigger usuarios_atualizacao
  before update on public.usuarios
  for each row execute function public.marcar_atualizado_em();

drop trigger if exists clientes_atualizacao on public.clientes;
create trigger clientes_atualizacao
  before update on public.clientes
  for each row execute function public.marcar_atualizado_em();

-- ============================================================================
-- 4. Permissões
-- ============================================================================
-- ATENÇÃO: nenhuma política de INSERT para `anon` aqui, de propósito.
--
-- Estas tabelas guardam o cadastro consolidado dos clientes. Quem escreve
-- nelas é o gatilho da migração 006, que roda como security definer a partir
-- do pedido — assim o site continua só inserindo pedido, e não ganha uma porta
-- nova para escrever no cadastro.
alter table public.usuarios enable row level security;
alter table public.clientes enable row level security;

drop policy if exists "admin le usuarios" on public.usuarios;
create policy "admin le usuarios"
  on public.usuarios for select to authenticated using (public.eh_admin());

drop policy if exists "admin escreve usuarios" on public.usuarios;
create policy "admin escreve usuarios"
  on public.usuarios for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists "admin le clientes" on public.clientes;
create policy "admin le clientes"
  on public.clientes for select to authenticated using (public.eh_admin());

drop policy if exists "admin escreve clientes" on public.clientes;
create policy "admin escreve clientes"
  on public.clientes for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- ============================================================================
-- 5. O vendedor da casa
-- ============================================================================
-- catalogo_produtos.vendedor_id (migração 005) precisa apontar para alguém.
insert into public.usuarios (tipo, nome, email, telefone, cnpj)
select 'vendedor', 'Temp Rio Indústria e Comércio', 'ouvidoriatemprio@gmail.com',
       '(21) 99620-3535', null
where not exists (select 1 from public.usuarios where tipo = 'vendedor');
