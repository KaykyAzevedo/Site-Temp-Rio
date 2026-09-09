-- Vitrine "Onde comprar Temp Rio" — esquema, view pública, RPC e políticas.
--
-- Rode DEPOIS de admin/supabase.sql (usa eh_admin()) e de
-- admin/supabase-regioes.sql. Cole no SQL Editor e execute uma vez.
--
-- ============================================================================
-- DUAS DIFERENÇAS EM RELAÇÃO AO ESQUEMA PEDIDO
-- ============================================================================
--
-- 1. NÃO EXISTE `produto_id`.
--    O pedido original previa destacar "o produto do cliente". Aqui os clientes
--    são lojistas que COMPRAM os 73 temperos — eles não têm produto no
--    catálogo. O que se destaca é a LOJA deles, numa seção "Onde comprar".
--
-- 2. NÃO EXISTE `cliente_id`.
--    Não há tabela de clientes: o site não tem cadastro nem login de comprador.
--    O cliente é identificado pelo CNPJ que ele digita no pedido, que é a mesma
--    chave usada na aba Histórico do painel.

-- ============================================================================
-- 1. Tabela
-- ============================================================================
create table if not exists public.vitrines (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),

  -- Quem (chave = CNPJ, como no resto do sistema)
  cnpj text not null,
  razao_social text not null,
  responsavel text,
  telefone text,
  email text,

  -- Onde fica a loja. É isto que o consumidor vai usar para chegar lá.
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text not null,
  regiao text,

  -- De onde veio a sugestão
  pedido_id uuid references public.pedidos(id) on delete set null,
  caixas integer not null default 0,
  valor_centavos bigint not null default 0,
  motivos text[] not null default '{}',

  tipo text not null check (tipo in ('basic', 'pro', 'premium')),
  dias integer not null default 1,

  status text not null default 'pendente'
    check (status in ('pendente', 'aprovado', 'rejeitado')),

  -- data_fim é o ÚLTIMO DIA INCLUSIVE: um plano de 3 dias aprovado hoje
  -- termina em hoje+2. A contagem na tela depende dessa regra.
  data_inicio date,
  data_fim date,

  aprovado_em timestamptz,
  aprovado_por text,
  observacao text,

  -- EXCLUSIVIDADE RIO, garantida no banco e não só na tela.
  -- Uma checagem só no JavaScript é contornável por quem editar a página; esta
  -- o banco recusa. (Hoje é redundante — o site só fecha pedido para CEP do
  -- Rio —, mas não depende daquela regra continuar existindo.)
  constraint vitrine_so_rio check (uf = 'RJ')
);

create index if not exists vitrines_status_idx on public.vitrines (status);
create index if not exists vitrines_periodo_idx on public.vitrines (data_inicio, data_fim);
create index if not exists vitrines_cnpj_idx on public.vitrines (cnpj);

alter table public.vitrines enable row level security;

-- O site cria o pedido de vitrine. Só isso.
drop policy if exists "site solicita vitrine" on public.vitrines;
create policy "site solicita vitrine"
  on public.vitrines for insert
  to anon, authenticated
  with check (status = 'pendente' and uf = 'RJ');

-- Ler a tabela CRUA e aprovar: só administrador. A tabela tem telefone,
-- e-mail e CNPJ do comprador — nada disso é público.
drop policy if exists "admin le vitrines" on public.vitrines;
create policy "admin le vitrines"
  on public.vitrines for select
  to authenticated
  using (public.eh_admin());

drop policy if exists "admin decide vitrines" on public.vitrines;
create policy "admin decide vitrines"
  on public.vitrines for update
  to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

-- ============================================================================
-- 2. View pública — o que o consumidor pode ver
-- ============================================================================
-- A seção "Onde comprar" precisa mostrar a loja em destaque para QUALQUER
-- visitante. Mas a tabela guarda telefone, e-mail e CNPJ do comprador, que não
-- têm por que ser públicos — expor a tabela inteira seria vazar contato de
-- cliente para achar uma loja.
--
-- Esta view mostra só nome e localização, e nada mais. O site lê a VIEW; a
-- tabela continua fechada.
--
-- security_invoker = false (padrão) faz a view rodar com os direitos do dono,
-- passando por cima do RLS da tabela — que é exatamente o que queremos aqui,
-- controlando a exposição pela lista de colunas.
create or replace view public.vitrines_publicas as
  select
    v.id,
    v.razao_social,
    v.logradouro,
    v.numero,
    v.bairro,
    v.cidade,
    v.uf,
    v.tipo,
    v.data_fim,
    -- Ordena Premium na frente, sem expor o plano como se fosse hierarquia
    -- de cliente na tela.
    case v.tipo when 'premium' then 3 when 'pro' then 2 else 1 end as peso
  from public.vitrines v
  where v.status = 'aprovado'
    and v.data_inicio <= current_date
    and v.data_fim >= current_date;

grant select on public.vitrines_publicas to anon, authenticated;

-- ============================================================================
-- 3. Histórico do cliente, sem expor pedido nenhum
-- ============================================================================
-- A sugestão precisa saber se é o 2º pedido do cliente. Mas o site NÃO PODE ler
-- a tabela de pedidos — a política proíbe, e com razão.
--
-- Esta função devolve APENAS CONTAGENS para um CNPJ que o chamador já
-- conhece (ele acabou de digitá-lo). Nenhum dado de pedido sai daqui.
--
-- security definer é necessário para ela enxergar os pedidos. O risco é alguém
-- descobrir quantos pedidos um CNPJ fez, tendo o CNPJ em mãos; é pouco e não
-- expõe valor por pedido, contato nem endereço.
create or replace function public.historico_do_cliente(p_cnpj text)
returns table (pedidos bigint, caixas bigint, valor_centavos bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint,
    coalesce(sum(p.caixas), 0)::bigint,
    coalesce(sum(p.valor_centavos), 0)::bigint
  from public.pedidos p
  where regexp_replace(p.cnpj, '[^0-9]', '', 'g') = regexp_replace(p_cnpj, '[^0-9]', '', 'g');
$$;

grant execute on function public.historico_do_cliente(text) to anon, authenticated;

-- ============================================================================
-- 4. Aprovar / rejeitar
-- ============================================================================
-- Aprovar calcula as datas NO BANCO, não no navegador: assim o prazo não
-- depende do relógio da máquina de quem clicou.
create or replace function public.decidir_vitrine(
  p_id uuid,
  p_aprovar boolean,
  p_observacao text default null
)
returns public.vitrines
language plpgsql
security invoker
as $$
declare
  v public.vitrines;
begin
  if not public.eh_admin() then
    raise exception 'sem permissao';
  end if;

  update public.vitrines
     set status      = case when p_aprovar then 'aprovado' else 'rejeitado' end,
         -- data_fim é o último dia INCLUSIVE: 3 dias = hoje, +1 e +2.
         data_inicio = case when p_aprovar then current_date else null end,
         data_fim    = case when p_aprovar then current_date + (dias - 1) else null end,
         aprovado_em = now(),
         aprovado_por = auth.jwt() ->> 'email',
         observacao  = coalesce(p_observacao, observacao)
   where id = p_id
   returning * into v;

  return v;
end;
$$;

grant execute on function public.decidir_vitrine(uuid, boolean, text) to authenticated;
