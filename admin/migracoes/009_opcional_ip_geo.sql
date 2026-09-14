-- 009 — OPCIONAL: IP e coordenadas nas visitas
--
-- ############################################################################
-- NÃO RODE ESTE ARQUIVO SEM LER. Ele é opcional de propósito.
-- ############################################################################
--
-- A especificação pedia `ip`, `localizacao_lat` e `localizacao_lng` em
-- visitas_site. Eles estão separados aqui, e não na migração 007, porque
-- gravá-los muda três coisas de uma vez — e nenhuma delas dá para desfazer
-- depois que os dados já entraram.
--
-- ----------------------------------------------------------------------------
-- 1. O QUE MUDA JURIDICAMENTE
-- ----------------------------------------------------------------------------
-- Endereço IP e coordenada de geolocalização são dado pessoal na LGPD. Hoje o
-- site não guarda nenhum dos dois, e por isso o LEIAME-PAINEL.md diz, com
-- razão, que não é preciso aviso de cookies por causa das visitas.
--
-- Rodando esta migração e passando a preencher as colunas, isso deixa de ser
-- verdade. Passa a ser necessário:
--   - base legal para o tratamento (legítimo interesse, com registro);
--   - aviso ao visitante e política de privacidade acessível;
--   - prazo de descarte definido (o bloco 4 aqui embaixo dá um).
--
-- E o texto da página de pedido e do LEIAME precisam ser corrigidos junto. Um
-- site que promete não coletar e coleta é pior do que um que avisa.
--
-- ----------------------------------------------------------------------------
-- 2. O QUE MUDA NA PRÁTICA — e por que provavelmente piora
-- ----------------------------------------------------------------------------
-- Para uma empresa que entrega só no Rio, o objetivo do dado é saber DE QUAL
-- REGIÃO vem a demanda. IP responde isso mal no Brasil: operadora de celular
-- concentra a saída em poucos pontos, e boa parte dos acessos móveis do Rio
-- aparece como São Paulo. O relatório ficaria errado de um jeito plausível —
-- que é o pior tipo de erro, porque ninguém desconfia.
--
-- `localizacao_lat/lng` só existem se o visitante ACEITAR o pedido de
-- permissão do navegador. Na prática quase ninguém aceita numa loja que acabou
-- de abrir, e o pop-up de permissão logo na entrada custa visita.
--
-- A migração 007 usa o CEP que o visitante digita para consultar o frete:
-- consentido, exato e sem nada disso.
--
-- ----------------------------------------------------------------------------
-- 3. QUANDO RODAR MESMO ASSIM
-- ----------------------------------------------------------------------------
-- Faz sentido se um dia a pergunta for "de que ESTADO vem quem visita, para
-- decidir onde abrir a próxima área de entrega". Para essa pergunta, grossa,
-- IP serve — e aí o certo é guardar só o estado, nunca o IP inteiro.
-- O bloco abaixo já é escrito desse jeito.

-- ============================================================================
-- Colunas
-- ============================================================================

-- IP ANONIMIZADO, não o IP. O último octeto zerado (203.0.113.0 em vez de
-- 203.0.113.47) mantém a utilidade geográfica e deixa de apontar para uma
-- assinatura específica. É a prática padrão de analytics e reduz bastante o
-- que está em jogo se o banco vazar.
alter table public.visitas add column if not exists ip_anonimizado inet;

-- Preenchidos só por consulta a um serviço de geoIP, do lado do servidor.
-- O navegador não sabe o próprio IP.
alter table public.visitas add column if not exists geo_uf char(2);
alter table public.visitas add column if not exists geo_cidade text;

-- Coordenadas: só com permissão explícita do navegador. `geo_consentido`
-- registra que a permissão foi dada — sem esse registro, não há como provar
-- depois que havia consentimento.
alter table public.visitas add column if not exists localizacao_lat numeric(9,6);
alter table public.visitas add column if not exists localizacao_lng numeric(9,6);
alter table public.visitas add column if not exists geo_consentido boolean not null default false;

create index if not exists visitas_geo_uf_idx on public.visitas (geo_uf);

-- Coordenada só entra acompanhada do consentimento. É uma constraint e não uma
-- convenção porque convenção não impede ninguém de gravar.
alter table public.visitas drop constraint if exists geo_exige_consentimento;
alter table public.visitas add constraint geo_exige_consentimento check (
  (localizacao_lat is null and localizacao_lng is null) or geo_consentido
);

-- ============================================================================
-- 4. Descarte automático
-- ============================================================================
-- Dado pessoal guardado para sempre é passivo, não patrimônio. Esta função
-- apaga IP e coordenada depois de 90 dias e PRESERVA a linha da visita: o
-- total mensal continua correto, só a parte identificável some.
--
-- Agende em Database > Cron (extensão pg_cron), uma vez por dia:
--     select cron.schedule('limpar-geo', '0 4 * * *',
--                          'select public.limpar_dados_geo()');
create or replace function public.limpar_dados_geo()
returns integer
language sql
security definer
set search_path = public
as $$
  with limpas as (
    update public.visitas
       set ip_anonimizado = null,
           localizacao_lat = null,
           localizacao_lng = null,
           geo_cidade = null
     where criado_em < now() - interval '90 days'
       and (ip_anonimizado is not null
            or localizacao_lat is not null
            or geo_cidade is not null)
    returning 1
  )
  select count(*)::integer from limpas;
$$;

-- geo_uf sobrevive ao descarte de propósito: "veio do ES" não identifica
-- ninguém e é justamente o dado que justificava a coleta.

-- ============================================================================
-- 5. Relatório por estado
-- ============================================================================
create or replace function public.visitas_por_uf(meses integer default 12)
returns table (uf char(2), visitas bigint, sessoes bigint)
language sql
stable
security invoker
as $$
  select coalesce(v.geo_uf, '--')::char(2),
         count(*),
         count(distinct v.sessao)
  from public.visitas v
  where v.criado_em >= date_trunc('month', now()) - make_interval(months => meses - 1)
  group by 1
  order by 2 desc;
$$;

grant execute on function public.visitas_por_uf(integer) to authenticated;

-- ============================================================================
-- 6. Como desfazer
-- ============================================================================
-- Se rodar e se arrepender, isto apaga as colunas e tudo que elas guardavam:
--
--   alter table public.visitas
--     drop column if exists ip_anonimizado,
--     drop column if exists localizacao_lat,
--     drop column if exists localizacao_lng,
--     drop column if exists geo_cidade,
--     drop column if exists geo_uf,
--     drop column if exists geo_consentido;
--   drop function if exists public.limpar_dados_geo();
--   drop function if exists public.visitas_por_uf(integer);
