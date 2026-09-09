-- 007 — Visitas por região
--
-- ============================================================================
-- LEIA ANTES DE RODAR: o que esta migração NÃO faz, e por quê
-- ============================================================================
--
-- A especificação pedia `visitas_site` com `ip`, `localizacao_lat` e
-- `localizacao_lng`. Esta migração NÃO cria essas três colunas. Elas estão em
-- 009_opcional_ip_geo.sql, separadas, para a decisão ser explícita.
--
-- Três razões, na ordem em que pesam:
--
-- 1. IP É DADO PESSOAL. A LGPD trata endereço IP como dado pessoal, e
--    coordenada de geolocalização idem. Hoje a tabela `visitas` guarda página,
--    horário e um id de sessão aleatório — e por isso o site não precisa de
--    aviso de cookies, o que está escrito no LEIAME-PAINEL.md e na página de
--    pedido. Gravar IP ou coordenada muda essa resposta: passa a exigir base
--    legal, aviso e política de privacidade.
--
-- 2. GEOLOCALIZAÇÃO POR IP É RUIM NO BRASIL, e ruim justamente no caso de
--    vocês. Operadora de celular roteia por poucos pontos de saída: um cliente
--    navegando em Campo Grande costuma aparecer em São Paulo. Para um negócio
--    que entrega SÓ no Rio e quer saber de qual região vem a demanda, o dado
--    seria errado com frequência — e errado de um jeito difícil de perceber.
--
-- 3. JÁ EXISTE UM SINAL MELHOR E CONSENTIDO. O visitante digita o CEP na
--    página de pedido, por vontade dele, para saber o frete. Esse CEP dá a
--    região EXATA, pelas mesmas faixas que calculam a entrega — não uma
--    estimativa. É o que esta migração usa.
--
-- O custo honesto da escolha: só conta região de quem chegou a consultar o
-- CEP. Quem entrou e saiu não entra no relatório por região (continua contado
-- no total de visitas). Em troca, o número que aparece é confiável e não cria
-- obrigação nova.

-- ============================================================================
-- 1. Novas colunas em `visitas`
-- ============================================================================
-- A tabela se chama `visitas` desde a migração 001 e continua com esse nome; o
-- `visitas_site` da especificação é esta.

-- Região consultada pelo próprio visitante, quando ele consulta.
alter table public.visitas add column if not exists regiao_id text
  references public.regioes(id) on delete set null;
-- `text` e nao `char(8)`: o tipo e coagido ao montar a tupla, ANTES do
-- gatilho que tira a pontuacao. Com char(8), um CEP mascarado ('20520-000')
-- seria recusado com 'value too long' e o gatilho nunca rodaria. A CHECK
-- abaixo garante o formato, e ela SIM e avaliada depois do gatilho.
alter table public.visitas add column if not exists cep text;
alter table public.visitas drop constraint if exists visitas_cep_so_digitos;
alter table public.visitas add constraint visitas_cep_so_digitos
  check (cep is null or cep ~ '^[0-9]{8}$');

-- Duração da sessão, em segundos. Exige uma mudança no site para ser
-- preenchida — ver a seção 4 aqui embaixo. Enquanto isso fica nula, e o
-- relatório trata nulo como "não medido", nunca como zero.
alter table public.visitas add column if not exists segundos integer
  check (segundos is null or segundos >= 0);

-- User agent bruto, como pedido. Sozinho não identifica ninguém, mas é um
-- ingrediente de fingerprint: combinado com outros sinais, ajuda a distinguir
-- um visitante. Guardamos porque a pergunta que ele responde ("meus clientes
-- usam celular ou computador?") é legítima e não tem outro jeito de responder.
alter table public.visitas add column if not exists user_agent text;

-- Classificação derivada, para o relatório não ter que interpretar string de
-- user agent em toda consulta.
alter table public.visitas add column if not exists dispositivo text
  check (dispositivo is null or dispositivo in ('celular', 'tablet', 'computador'));

alter table public.visitas add column if not exists referencia text;  -- de onde veio

create index if not exists visitas_regiao_idx on public.visitas (regiao_id);
create index if not exists visitas_dispositivo_idx on public.visitas (dispositivo);
create index if not exists visitas_sessao_idx on public.visitas (sessao);
-- visitas_criado_em_idx (a "data da visita") já existe desde a migração 001.

-- ============================================================================
-- 2. Preencher região e dispositivo sozinho
-- ============================================================================
create or replace function public.visita_classificar()
returns trigger
language plpgsql
as $$
declare
  v_cep text;
  ua    text := lower(coalesce(new.user_agent, ''));
begin
  v_cep := nullif(regexp_replace(coalesce(new.cep, ''), '[^0-9]', '', 'g'), '');

  if v_cep is not null and length(v_cep) = 8 then
    new.cep := v_cep;
    select r.id into new.regiao_id
    from public.regioes r
    join public.regioes_faixas_cep f on f.regiao_id = r.id
    where v_cep between f.cep_inicio and f.cep_fim
    order by r.prioridade desc, r.ativo desc
    limit 1;
  else
    new.cep := null;
  end if;

  -- Ordem importa: tablet antes de celular, porque quase todo user agent de
  -- tablet Android também contém "android", e alguns contêm "mobile".
  if ua = '' then
    new.dispositivo := null;
  elsif ua like '%ipad%' or ua like '%tablet%'
     or (ua like '%android%' and ua not like '%mobile%') then
    new.dispositivo := 'tablet';
  elsif ua like '%mobi%' or ua like '%iphone%' or ua like '%android%' then
    new.dispositivo := 'celular';
  else
    new.dispositivo := 'computador';
  end if;

  return new;
end;
$$;

drop trigger if exists visitas_classificar on public.visitas;
create trigger visitas_classificar
  before insert or update on public.visitas
  for each row execute function public.visita_classificar();

-- O site precisa poder completar a própria visita depois: ele grava a visita
-- na abertura da página e só sabe o CEP e a duração mais tarde. A política
-- deixa atualizar a linha pelo id de sessão que o próprio navegador gerou —
-- ele não é segredo, então isto permite a alguém alterar a visita de outro.
-- O que está em jogo é um número de relatório, não dado de cliente; se algum
-- dia isso incomodar, o caminho é um servidor próprio recebendo a métrica.
drop policy if exists "site completa a visita" on public.visitas;
create policy "site completa a visita"
  on public.visitas for update
  to anon, authenticated
  using (criado_em > now() - interval '6 hours')
  with check (criado_em > now() - interval '6 hours');

-- ============================================================================
-- 3. Relatório de visitas por região
-- ============================================================================
create or replace function public.visitas_por_regiao(meses integer default 12)
returns table (
  regiao_id text,
  regiao_nome text,
  ativo boolean,
  visitas bigint,
  sessoes bigint,
  segundos_medianos integer,
  pedidos bigint,
  faturamento_centavos bigint
)
language sql
stable
security invoker
as $$
  with janela as (
    select date_trunc('month', now()) - make_interval(months => meses - 1) as inicio
  ),
  v as (
    select coalesce(visitas.regiao_id, 'sem-cep') as rid,
           count(*) as visitas,
           count(distinct visitas.sessao) as sessoes,
           percentile_cont(0.5) within group (order by visitas.segundos)
             filter (where visitas.segundos is not null) as seg
    from public.visitas, janela
    where visitas.criado_em >= janela.inicio
    group by 1
  ),
  p as (
    select coalesce(pedidos.regiao_id, 'sem-cep') as rid,
           count(*) as pedidos,
           coalesce(sum(pedidos.valor_centavos) filter (
             where pedidos.status in ('confirmado','entregue')), 0)::bigint as fat
    from public.pedidos, janela
    where pedidos.criado_em >= janela.inicio
    group by 1
  )
  select
    coalesce(v.rid, p.rid),
    coalesce(r.nome, 'Sem CEP informado'),
    coalesce(r.ativo, false),
    coalesce(v.visitas, 0),
    coalesce(v.sessoes, 0),
    round(v.seg)::integer,
    coalesce(p.pedidos, 0),
    coalesce(p.fat, 0)
  from v
  full outer join p on p.rid = v.rid
  left join public.regioes r on r.id = coalesce(v.rid, p.rid)
  order by coalesce(p.fat, 0) desc, coalesce(v.visitas, 0) desc;
$$;

-- Mediana e não média no tempo de sessão: uma aba esquecida aberta por seis
-- horas puxa a média para um número que não descreve visitante nenhum.

-- ============================================================================
-- 4. O que falta no site para `segundos` deixar de ser nulo
-- ============================================================================
-- A coluna existe, o relatório já sabe usá-la, e ela fica nula até o site
-- passar a medir. O que a página precisa fazer, em js/analytics.js:
--
--   1. guardar o id da linha devolvida pelo insert da visita;
--   2. marcar o instante da abertura;
--   3. no evento `visibilitychange` com estado 'hidden' — e NÃO no
--      `beforeunload`, que o Safari de iPhone frequentemente não dispara —
--      mandar a duração com navigator.sendBeacon(), que sobrevive à página
--      sendo fechada no meio do envio.
--
-- E para `cep`: quando o visitante consulta o frete na página de pedido,
-- atualizar a mesma linha com o CEP consultado. É a única fonte de região
-- deste relatório.
