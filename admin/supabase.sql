-- Painel de administrador da Temp Rio — esquema do banco.
--
-- Cole tudo isto no SQL Editor do Supabase e execute uma vez.
-- Passo a passo completo em admin/LEIAME-PAINEL.md.
--
-- ============================================================================
-- LEIA ISTO ANTES: por que a segurança está toda aqui embaixo, e não no site
-- ============================================================================
--
-- A chave que o site usa (anon key) é PÚBLICA por natureza: ela vai no código
-- da página e qualquer visitante consegue lê-la. Isso não é falha — é o
-- desenho do Supabase. Quem realmente protege os dados são as políticas de
-- Row Level Security (RLS) definidas abaixo.
--
-- Sem RLS, essa chave pública daria a qualquer pessoa a lista completa de
-- pedidos, com nome, CNPJ, telefone e endereço dos seus clientes.
--
-- A regra que aplicamos:
--   - o site (anônimo) só PODE INSERIR pedidos e visitas;
--   - o site NÃO PODE LER nada;
--   - ler e alterar exige estar autenticado E constar na tabela de admins.
--
-- Esse segundo requisito importa: no Supabase, "autenticado" é qualquer pessoa
-- que criou conta. Se o cadastro estiver aberto, autenticado sozinho não
-- protege nada. Por isso toda leitura passa pela tabela `admins`.

-- ============================================================================
-- 1. Quem é administrador
-- ============================================================================
create table if not exists public.admins (
  email text primary key,
  criado_em timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Cada admin enxerga apenas a própria linha. É o suficiente para as políticas
-- abaixo funcionarem, sem expor a lista de administradores.
drop policy if exists "admin le a propria linha" on public.admins;
create policy "admin le a propria linha"
  on public.admins for select
  to authenticated
  using (email = auth.jwt() ->> 'email');

-- Função de conveniência usada por todas as políticas.
create or replace function public.eh_admin()
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1 from public.admins a
    where a.email = auth.jwt() ->> 'email'
  );
$$;

-- ============================================================================
-- 2. Pedidos
-- ============================================================================
create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),

  -- aguardando: cliente clicou em enviar; ninguém confirmou ainda.
  -- confirmado: você fechou o negócio na conversa. SÓ ISTO CONTA COMO VENDA.
  -- entregue:   já saiu e chegou.
  -- cancelado:  não vingou.
  status text not null default 'aguardando'
    check (status in ('aguardando', 'confirmado', 'entregue', 'cancelado')),

  -- Empresa
  razao_social text not null,
  cnpj text not null,
  inscricao_estadual text,
  responsavel text not null,
  telefone text not null,
  email text,

  -- Entrega
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,

  -- Pedido
  potes integer not null default 0,
  caixas integer not null default 0,
  valor_centavos bigint not null default 0,
  itens jsonb not null default '[]'::jsonb,
  observacoes text,

  -- Preenchidos quando você muda o status no painel
  confirmado_em timestamptz,
  atualizado_em timestamptz
);

create index if not exists pedidos_criado_em_idx on public.pedidos (criado_em desc);
create index if not exists pedidos_status_idx on public.pedidos (status);
create index if not exists pedidos_confirmado_em_idx on public.pedidos (confirmado_em desc);

alter table public.pedidos enable row level security;

-- O site grava. Só isso.
drop policy if exists "site registra pedido" on public.pedidos;
create policy "site registra pedido"
  on public.pedidos for insert
  to anon, authenticated
  with check (true);

-- Ler exige ser admin. Sem esta política, a chave pública leria tudo.
drop policy if exists "admin le pedidos" on public.pedidos;
create policy "admin le pedidos"
  on public.pedidos for select
  to authenticated
  using (public.eh_admin());

drop policy if exists "admin atualiza pedidos" on public.pedidos;
create policy "admin atualiza pedidos"
  on public.pedidos for update
  to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

-- Carimba as datas de mudança de status no banco, não no navegador: assim o
-- horário não depende do relógio da máquina de quem clicou.
create or replace function public.marcar_atualizacao()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  if new.status = 'confirmado' and coalesce(old.status, '') <> 'confirmado' then
    new.confirmado_em := now();
  end if;
  return new;
end;
$$;

drop trigger if exists pedidos_atualizacao on public.pedidos;
create trigger pedidos_atualizacao
  before update on public.pedidos
  for each row execute function public.marcar_atualizacao();

-- ============================================================================
-- 3. Visitas
-- ============================================================================
-- Deliberadamente mínimo: página, quando, e um id de sessão aleatório gerado
-- no navegador. Sem IP, sem cookie, sem identificação de pessoa — nada que
-- exija aviso de cookies ou que crie obrigação de LGPD além do necessário.
create table if not exists public.visitas (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  pagina text not null,
  sessao text
);

create index if not exists visitas_criado_em_idx on public.visitas (criado_em desc);

alter table public.visitas enable row level security;

drop policy if exists "site registra visita" on public.visitas;
create policy "site registra visita"
  on public.visitas for insert
  to anon, authenticated
  with check (true);

drop policy if exists "admin le visitas" on public.visitas;
create policy "admin le visitas"
  on public.visitas for select
  to authenticated
  using (public.eh_admin());

-- ============================================================================
-- 4. Agregações para o dashboard
-- ============================================================================
-- Somar no banco em vez de baixar tudo: 12 meses de visitas podem ser milhares
-- de linhas, e o painel só precisa de um número por mês.
--
-- security invoker (o padrão) é essencial aqui: as funções rodam com a
-- permissão de quem chama, então o RLS continua valendo. Um usuário que não
-- esteja na tabela admins recebe zero linhas, não um erro — e nunca dados.

create or replace function public.resumo_mensal(meses integer default 12)
returns table (
  mes date,
  iniciados bigint,
  confirmados bigint,
  faturamento_centavos bigint
)
language sql
stable
security invoker
as $$
  select
    date_trunc('month', p.criado_em)::date as mes,
    count(*) as iniciados,
    count(*) filter (where p.status in ('confirmado', 'entregue')) as confirmados,
    -- Faturamento conta APENAS pedido confirmado ou entregue. Pedido
    -- aguardando é intenção de compra, não venda.
    coalesce(sum(p.valor_centavos) filter (
      where p.status in ('confirmado', 'entregue')
    ), 0)::bigint as faturamento_centavos
  from public.pedidos p
  where p.criado_em >= date_trunc('month', now()) - make_interval(months => meses - 1)
  group by 1
  order by 1;
$$;

create or replace function public.visitas_mensais(meses integer default 12)
returns table (
  mes date,
  visitas bigint,
  sessoes bigint
)
language sql
stable
security invoker
as $$
  select
    date_trunc('month', v.criado_em)::date as mes,
    count(*) as visitas,
    count(distinct v.sessao) as sessoes
  from public.visitas v
  where v.criado_em >= date_trunc('month', now()) - make_interval(months => meses - 1)
  group by 1
  order by 1;
$$;

-- ============================================================================
-- 5. Últimos passos (faça agora, não deixe para depois)
-- ============================================================================
--
-- a) Cadastre o seu e-mail como administrador. Troque pelo e-mail real que
--    você vai usar para entrar no painel:
--
--        insert into public.admins (email) values ('voce@exemplo.com');
--
-- b) Crie o usuário desse e-mail em Authentication > Users > Add user,
--    marcando "Auto Confirm User".
--
-- c) Em Authentication > Providers > Email, DESLIGUE "Enable Sign Ups".
--    Sem isso, qualquer pessoa cria conta no seu projeto. As políticas acima
--    ainda barrariam a leitura (por causa da tabela admins), mas cadastro
--    aberto é porta que não precisa existir.
