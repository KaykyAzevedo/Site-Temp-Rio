-- 037: qualidade do endereco no mapa de expansao + lista "Corrigir no ERP" + interessados que nao compraram.
-- APLICADA em 2026-11-13 (conferida: 4 funcoes INVOKER so authenticated; anon segue so com as 7 publicas). Instalacao manual no SQL Editor (papel postgres). Idempotente: pode rodar de novo.
-- Nao apaga nem altera dados (nenhum INSERT/UPDATE/DELETE). Nao toca no ERP/SOLIDCON nem no coletor.
-- Requer 033 (solidcon_clientes_geo, solidcon_mapa_clientes), 026 (solidcon_vendas_clientes),
-- 013 (cnpj_valido) e eh_equipe(). A 034 (pedidos_erp_vinculo) e opcional.
--
-- (A) Qualidade CALCULADA NA LEITURA (nao gravada): solidcon_037_avaliacao() devolve, por cliente CNPJ,
--     qualidade ('confiavel' | 'aproximado' | 'sem_localizacao') + motivos (text[]). Calcular na leitura
--     evita valor velho: CEP compartilhado e endereco mudam a cada sync do ERP, sem gatilho nenhum.
--     Checagens de cadastro: CNPJ com DV invalido/digitos repetidos, sem CEP, CEP invalido (formato,
--     digitos repetidos), CEP fora da faixa da UF (faixas oficiais dos Correios, sem tabela), CEP generico
--     (termina em 000), CEP compartilhado por 5+ clientes, logradouro vazio/ficticio. Checagens do pino:
--     nao localizado, endereco mudou depois do pino, posicao so pelo bairro.
--     A validacao "o ponto cai no municipio declarado" fica no navegador (js/admin.js, gmapNoMunicipio):
--     a busca no Nominatim ja vai limitada ao municipio (viewbox+bounded) e o resultado so e aceito se
--     address.city/town/municipality = cidade do ERP. O servidor mantem a trava 'fora_do_rj' da 033.
--     Sem semente de municipios.
-- (B) solidcon_mapa_clientes() ganha as colunas qualidade e motivos NO FIM (o painel atual ignora colunas
--     a mais). Exige DROP + CREATE (o tipo de retorno muda); grants refeitos em seguida.
-- (C) solidcon_geo_corrigir_erp(): clientes CNPJ sem localizacao confiavel ou com cadastro a corrigir.
-- (D) solidcon_interessados(): quem demonstrou interesse e nao comprou (lista_espera e pedidos do site
--     sem venda no ERP pelo CNPJ), 1 linha por origem+CNPJ, documento mascarado, SEM telefone/e-mail/
--     responsavel. Posicao aproximada pela media dos clientes do ERP ja localizados no mesmo CEP, senao
--     bairro+cidade, senao cidade. Nunca chama servico externo. CPF nunca entra.
-- Todas as funcoes: SECURITY INVOKER (RLS das tabelas vale) + checagem eh_equipe() nas RPCs;
-- EXECUTE so para authenticated (revoke all from public, anon, authenticated antes).
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.solidcon_clientes_geo') is null
     or to_regclass('public.solidcon_clientes') is null
     or to_regclass('public.solidcon_vendas_clientes') is null
     or to_regclass('public.pedidos') is null
     or to_regclass('public.lista_espera') is null
     or to_regprocedure('public.solidcon_mapa_clientes()') is null
     or to_regprocedure('public.solidcon_033_chave_endereco(text,text,text,text,text,text)') is null
     or to_regprocedure('public.solidcon_033_norm(text)') is null
     or to_regprocedure('public.cnpj_valido(text)') is null
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception '037 requer 033, 026, 013 (cnpj_valido), pedidos, lista_espera e eh_equipe(). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 37);

-- ===================== (A) AVALIACAO =====================
-- CEP (8 digitos) dentro da faixa oficial da UF. UF desconhecida/nula => null (nao avalia).
create or replace function public.solidcon_037_cep_da_uf(p_cep text, p_uf text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case when p_cep !~ '^[0-9]{8}$' then null else (
    with f(n) as (select substr(p_cep, 1, 5)::int)
    select case upper(p_uf)
      when 'SP' then n between 1000 and 19999
      when 'RJ' then n between 20000 and 28999
      when 'ES' then n between 29000 and 29999
      when 'MG' then n between 30000 and 39999
      when 'BA' then n between 40000 and 48999
      when 'SE' then n between 49000 and 49999
      when 'PE' then n between 50000 and 56999
      when 'AL' then n between 57000 and 57999
      when 'PB' then n between 58000 and 58999
      when 'RN' then n between 59000 and 59999
      when 'CE' then n between 60000 and 63999
      when 'PI' then n between 64000 and 64999
      when 'MA' then n between 65000 and 65999
      when 'PA' then n between 66000 and 68899
      when 'AP' then n between 68900 and 68999
      when 'AM' then n between 69000 and 69299 or n between 69400 and 69899
      when 'RR' then n between 69300 and 69399
      when 'AC' then n between 69900 and 69999
      when 'DF' then n between 70000 and 72799 or n between 73000 and 73699
      when 'GO' then n between 72800 and 72999 or n between 73700 and 76799
      when 'RO' then n between 76800 and 76999
      when 'TO' then n between 77000 and 77999
      when 'MT' then n between 78000 and 78899
      when 'MS' then n between 79000 and 79999
      when 'PR' then n between 80000 and 87999
      when 'SC' then n between 88000 and 89999
      when 'RS' then n between 90000 and 99999
      else null end
    from f) end;
$$;
revoke all on function public.solidcon_037_cep_da_uf(text, text) from public, anon, authenticated;
grant execute on function public.solidcon_037_cep_da_uf(text, text) to authenticated;

-- 1 linha por cliente CNPJ do ERP. INVOKER: quem chama precisa ler solidcon_clientes/_geo (RLS equipe).
create or replace function public.solidcon_037_avaliacao()
returns table (documento text, qualidade text, motivos text[])
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  with c as (
    select cl.documento, cl.logradouro, cl.cep, cl.estado,
           case when cl.cep is null then 0
                else count(*) over (partition by cl.cep) end as mesmo_cep,
           g.documento is not null as tem_geo,
           g.precisao,
           coalesce(g.chave_endereco = public.solidcon_033_chave_endereco(
             cl.logradouro, cl.numero, cl.cep, cl.bairro, cl.cidade, cl.estado), false) as geo_atual
      from public.solidcon_clientes cl
      left join public.solidcon_clientes_geo g on g.documento = cl.documento
     where cl.tipo = 'cnpj'
  ), f as (
    select c.documento, c.precisao,
           not coalesce(public.cnpj_valido(c.documento), false) as cnpj_invalido,
           c.cep is null as sem_cep,
           c.cep is not null and (c.cep !~ '^[0-9]{8}$' or c.cep ~ '^(.)\1{7}$') as cep_invalido,
           c.cep ~ '^[0-9]{8}$' and c.cep !~ '^(.)\1{7}$'
             and public.solidcon_037_cep_da_uf(c.cep, c.estado) is false as cep_fora_da_uf,
           c.cep ~ '^[0-9]{5}000$' and c.cep !~ '^(.)\1{7}$' as cep_generico,
           c.mesmo_cep >= 5 as cep_compartilhado,
           coalesce(public.solidcon_033_norm(c.logradouro), '')
             ~ '^(|x+|teste|nao informado|nao consta|sem|sem endereco|sem logradouro|0+)$' as sem_logradouro,
           c.tem_geo and not c.geo_atual as endereco_mudou,
           not c.tem_geo or (c.geo_atual and c.precisao = 'nao_encontrado') as nao_localizado,
           c.geo_atual and c.precisao in ('endereco', 'cep', 'bairro') as tem_pino
      from c
  )
  select f.documento,
         case
           when not f.tem_pino or f.cnpj_invalido
                or (f.precisao = 'cep' and (f.sem_cep or f.cep_invalido or f.cep_fora_da_uf)) then 'sem_localizacao'
           when f.precisao = 'bairro'
                or (f.precisao = 'cep' and (f.cep_generico or f.cep_compartilhado)) then 'aproximado'
           else 'confiavel'
         end,
         array_remove(array[
           case when f.cnpj_invalido then 'cnpj_invalido' end,
           case when f.sem_cep then 'sem_cep' end,
           case when f.cep_invalido then 'cep_invalido' end,
           case when f.cep_fora_da_uf then 'cep_fora_da_uf' end,
           case when f.cep_generico then 'cep_generico' end,
           case when f.cep_compartilhado then 'cep_compartilhado' end,
           case when f.sem_logradouro then 'sem_logradouro' end,
           case when f.nao_localizado then 'nao_localizado' end,
           case when f.endereco_mudou then 'endereco_mudou' end,
           case when f.tem_pino and f.precisao = 'bairro' then 'posicao_por_bairro' end
         ]::text[], null)
    from f;
$$;
revoke all on function public.solidcon_037_avaliacao() from public, anon, authenticated;
grant execute on function public.solidcon_037_avaliacao() to authenticated;

-- ===================== (B) MAPA COM QUALIDADE =====================
-- Mesmo corpo da 033 + qualidade/motivos no fim. DROP necessario: muda o tipo de retorno.
drop function if exists public.solidcon_mapa_clientes();
create function public.solidcon_mapa_clientes()
returns table (
  documento text, nome text, bairro text, cidade text, estado text,
  lat numeric, lng numeric, precisao text, pino_desatualizado boolean,
  primeira_compra date, ultima_compra date, total_centavos bigint, cupons integer, meses jsonb,
  qualidade text, motivos text[]
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  return query
  with m as (
    select vc.documento, to_char(vc.dia, 'YYYY-MM') as mes,
           sum(vc.valor_centavos) as centavos, count(*) as qtd,
           min(vc.dia) as d_min, max(vc.dia) as d_max
      from public.solidcon_vendas_clientes vc
     where vc.tipo = 'cnpj'
     group by vc.documento, to_char(vc.dia, 'YYYY-MM')
  ), a as (
    select m.documento, min(m.d_min) as primeira, max(m.d_max) as ultima,
           sum(m.centavos)::bigint as total, sum(m.qtd)::integer as qtd,
           jsonb_object_agg(m.mes, jsonb_build_array(m.centavos::bigint, m.qtd::integer)) as meses
      from m group by m.documento
  )
  select c.documento, c.nome, c.bairro, c.cidade, c.estado,
         case when ok then g.lat end, case when ok then g.lng end,
         case when ok then g.precisao end,
         (g.documento is not null and not ok),
         a.primeira, a.ultima, coalesce(a.total, 0), coalesce(a.qtd, 0),
         coalesce(a.meses, '{}'::jsonb),
         q.qualidade, q.motivos
    from public.solidcon_clientes c
    left join public.solidcon_clientes_geo g on g.documento = c.documento
    left join a on a.documento = c.documento
    left join public.solidcon_037_avaliacao() q on q.documento = c.documento
    cross join lateral (select coalesce(g.chave_endereco =
      public.solidcon_033_chave_endereco(c.logradouro, c.numero, c.cep, c.bairro, c.cidade, c.estado), false) as ok) k
   where c.tipo = 'cnpj'
   order by c.documento;
end;
$$;
revoke all on function public.solidcon_mapa_clientes() from public, anon, authenticated;
grant execute on function public.solidcon_mapa_clientes() to authenticated;

-- ===================== (C) CORRIGIR NO ERP =====================
-- So o que alguem precisa corrigir: sem localizacao confiavel, ou cadastro com erro.
-- CEP generico/compartilhado sozinho NAO entra (vira 'aproximado' no mapa, nao e erro de cadastro).
create or replace function public.solidcon_geo_corrigir_erp()
returns table (
  documento text, nome text, logradouro text, numero text, cep text, bairro text, cidade text, estado text,
  qualidade text, motivos text[]
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  return query
  select c.documento, c.nome, c.logradouro, c.numero, c.cep, c.bairro, c.cidade, c.estado, q.qualidade, q.motivos
    from public.solidcon_037_avaliacao() q
    join public.solidcon_clientes c on c.documento = q.documento
   where q.qualidade = 'sem_localizacao'
      or q.motivos && array['cnpj_invalido', 'sem_cep', 'cep_invalido', 'cep_fora_da_uf', 'sem_logradouro']::text[]
   order by (q.qualidade = 'sem_localizacao') desc, c.nome, c.documento;
end;
$$;
revoke all on function public.solidcon_geo_corrigir_erp() from public, anon, authenticated;
grant execute on function public.solidcon_geo_corrigir_erp() to authenticated;

-- ===================== (D) INTERESSADOS =====================
create or replace function public.solidcon_037_mascarar_cnpj(p_doc text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case when p_doc ~ '^[0-9]{14}$'
    then substr(p_doc, 1, 2) || '.' || substr(p_doc, 3, 3) || '.***/****-' || substr(p_doc, 13, 2) end;
$$;
revoke all on function public.solidcon_037_mascarar_cnpj(text) from public, anon, authenticated;
grant execute on function public.solidcon_037_mascarar_cnpj(text) to authenticated;

create or replace function public.solidcon_interessados()
returns table (
  origem text, chave text, nome text, documento_mascarado text,
  cep text, bairro text, cidade text, uf text,
  lat numeric, lng numeric, precisao text,
  primeiro_contato timestamptz, ultimo_contato timestamptz, contatos integer,
  ultimo_status text, valor_centavos bigint
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_vinculados text[] := '{}';
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  -- 034 e opcional: sem ela, so a venda no ERP pelo CNPJ decide "comprou".
  if to_regclass('public.pedidos_erp_vinculo') is not null then
    execute $q$
      select coalesce(array_agg(distinct regexp_replace(p.cnpj, '[^0-9]', '', 'g')), '{}')
        from public.pedidos p join public.pedidos_erp_vinculo v on v.pedido_id = p.id
    $q$ into v_vinculados;
  end if;

  return query
  with brutos as (
    select 'pedido_site'::text as origem, regexp_replace(coalesce(p.cnpj, ''), '[^0-9]', '', 'g') as doc,
           p.id as ref, p.razao_social as nome_, regexp_replace(coalesce(p.cep, ''), '[^0-9]', '', 'g') as cep_,
           nullif(btrim(p.bairro), '') as bairro_, nullif(btrim(p.cidade), '') as cidade_,
           upper(nullif(btrim(p.uf), '')) as uf_, p.criado_em as em, p.status as status_,
           p.valor_centavos as valor
      from public.pedidos p
     where p.status is distinct from 'teste'
    union all
    select 'lista_espera', regexp_replace(coalesce(e.cnpj, ''), '[^0-9]', '', 'g'),
           e.id, e.razao_social, regexp_replace(coalesce(e.cep, ''), '[^0-9]', '', 'g'),
           null, nullif(btrim(e.cidade), ''), upper(nullif(btrim(e.uf), '')), e.criado_em,
           case when e.atendido then 'atendido' else 'aguardando' end, e.valor_centavos
      from public.lista_espera e
  ), nao_compraram as (
    select b.* from brutos b
     where b.doc ~ '^[0-9]{14}$'
       and b.doc <> all (v_vinculados)
       and not exists (select 1 from public.solidcon_vendas_clientes vc
                        where vc.documento = b.doc and vc.tipo = 'cnpj')
  ), agg as (
    select n.origem as o, n.doc,
           (array_agg(n.ref order by n.em, n.ref))[1] as primeiro_ref,
           (array_agg(n.nome_ order by n.em desc))[1] as nome_,
           (array_agg(n.cep_ order by n.em desc) filter (where n.cep_ ~ '^[0-9]{8}$'))[1] as cep_,
           (array_agg(n.bairro_ order by n.em desc) filter (where n.bairro_ is not null))[1] as bairro_,
           (array_agg(n.cidade_ order by n.em desc) filter (where n.cidade_ is not null))[1] as cidade_,
           (array_agg(n.uf_ order by n.em desc) filter (where n.uf_ ~ '^[A-Z]{2}$'))[1] as uf_,
           min(n.em) as primeiro, max(n.em) as ultimo, count(*)::integer as qtd,
           (array_agg(n.status_ order by n.em desc))[1] as status_,
           coalesce(sum(n.valor), 0)::bigint as valor
      from nao_compraram n
     group by n.origem, n.doc
  ), pontos as (
    -- Clientes do ERP ja localizados com precisao de endereco/CEP e pino atual.
    select cl.cep as cep_, public.solidcon_033_norm(cl.bairro) as b, public.solidcon_033_norm(cl.cidade) as cid,
           cl.estado as uf_, g.lat as la, g.lng as ln
      from public.solidcon_clientes cl
      join public.solidcon_clientes_geo g on g.documento = cl.documento
     where cl.tipo = 'cnpj' and g.precisao in ('endereco', 'cep')
       and g.chave_endereco = public.solidcon_033_chave_endereco(cl.logradouro, cl.numero, cl.cep, cl.bairro, cl.cidade, cl.estado)
  ), por_cep as (
    select p.cep_, avg(p.la) as la, avg(p.ln) as ln from pontos p where p.cep_ is not null group by p.cep_
  ), por_bairro as (
    select p.b, p.cid, p.uf_, avg(p.la) as la, avg(p.ln) as ln from pontos p
     where p.b is not null and p.cid is not null group by p.b, p.cid, p.uf_
  ), por_cidade as (
    select p.cid, p.uf_, avg(p.la) as la, avg(p.ln) as ln from pontos p where p.cid is not null group by p.cid, p.uf_
  )
  select a.o,
         replace(a.primeiro_ref::text, '-', ''),
         a.nome_,
         public.solidcon_037_mascarar_cnpj(a.doc),
         a.cep_, a.bairro_, a.cidade_, a.uf_,
         round(coalesce(pc.la, pb.la, pci.la), 5),
         round(coalesce(pc.ln, pb.ln, pci.ln), 5),
         case when pc.la is not null then 'cep' when pb.la is not null then 'bairro'
              when pci.la is not null then 'cidade' end,
         a.primeiro, a.ultimo, a.qtd, a.status_, a.valor
    from agg a
    left join por_cep pc on pc.cep_ = a.cep_
    left join por_bairro pb on pb.b = public.solidcon_033_norm(a.bairro_)
                           and pb.cid = public.solidcon_033_norm(a.cidade_) and pb.uf_ = a.uf_
    left join por_cidade pci on pci.cid = public.solidcon_033_norm(a.cidade_) and pci.uf_ = a.uf_
   order by a.ultimo desc, a.o, a.doc;
end;
$$;
revoke all on function public.solidcon_interessados() from public, anon, authenticated;
grant execute on function public.solidcon_interessados() to authenticated;

commit;
