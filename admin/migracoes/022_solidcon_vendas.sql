-- 022_solidcon_vendas.sql: NAO APLICADA. Vendas diarias, antes 018 de A.
-- Corpo original preservado; numeros antigos abaixo sao historicos.
-- 018: vendas diarias, leitura do ERP. Nao altera RPCs/objetos da 012/017.
begin;
do $$
begin
  if to_regclass('public.solidcon_produtos') is null
     or to_regclass('public.solidcon_sync') is null
     or to_regclass('public.integracoes_autorizadas') is null
     or to_regclass('public.solidcon_estoque_diario') is null
     or to_regclass('public.solidcon_eventos') is null
     or to_regclass('public.solidcon_config') is null
     or to_regprocedure('public.solidcon_receber_produtos(jsonb,timestamptz,uuid)') is null
     or to_regprocedure('public.solidcon_definir_limite(integer)') is null
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('public.eh_admin()') is null then
    raise exception '018 requer 012 e 017 completas e helpers eh_equipe()/eh_admin() de producao. Nada foi aplicado.';
  end if;
end;
$$;

-- Coordenar instalacao/reaplicacao com a RPC de vendas, sem bloquear estoque.
select pg_catalog.pg_advisory_xact_lock(5100,18);

create table if not exists public.solidcon_vendas_dia (
  dia date not null,
  ean text not null check (ean ~ '^[0-9]{1,32}$'),
  nome text,
  categoria text,
  formato text not null check (formato in ('pote','cx24','cx48','outro')),
  potes_por_unidade integer,
  familia text check (familia is null or familia ~ '^[0-9]{12}$'),
  qtd numeric not null check (qtd >= 0 and qtd <> 'NaN'::numeric),
  valor_centavos bigint not null check (valor_centavos >= 0),
  valor_bruto_centavos bigint not null check (valor_bruto_centavos >= 0),
  desconto_centavos bigint not null check (desconto_centavos >= 0),
  coletado_em timestamptz not null,
  primary key (dia,ean),
  constraint solidcon_vendas_formato_potes check (
    (formato='pote' and potes_por_unidade is not distinct from 1)
    or (formato='cx24' and potes_por_unidade is not distinct from 24)
    or (formato='cx48' and potes_por_unidade is not distinct from 48)
    or (formato='outro' and potes_por_unidade is null)
  )
);
create index if not exists solidcon_vendas_familia_dia_idx
  on public.solidcon_vendas_dia(familia,dia desc);

create table if not exists public.solidcon_vendas_sync (
  id bigint generated always as identity primary key,
  dia date,
  status text not null check (status in ('ok','erro')),
  linhas integer not null default 0,
  valor_total_centavos bigint not null default 0,
  coletado_em timestamptz,
  execucao_id uuid,
  mensagem text,
  em timestamptz not null default now()
);
create index if not exists solidcon_vendas_sync_dia_coleta_idx
  on public.solidcon_vendas_sync(dia,coletado_em desc) where status='ok';
create unique index if not exists solidcon_vendas_sync_execucao_idx
  on public.solidcon_vendas_sync(execucao_id) where status='ok' and execucao_id is not null;

alter table public.solidcon_vendas_dia enable row level security;
alter table public.solidcon_vendas_sync enable row level security;
revoke all on public.solidcon_vendas_dia,public.solidcon_vendas_sync from public,anon,authenticated;
revoke all on sequence public.solidcon_vendas_sync_id_seq from public,anon,authenticated;
grant select on public.solidcon_vendas_dia,public.solidcon_vendas_sync to authenticated;
drop policy if exists solidcon_018_equipe_le on public.solidcon_vendas_dia;
create policy solidcon_018_equipe_le on public.solidcon_vendas_dia for select to authenticated using(public.eh_equipe());
drop policy if exists solidcon_018_equipe_le on public.solidcon_vendas_sync;
create policy solidcon_018_equipe_le on public.solidcon_vendas_sync for select to authenticated using(public.eh_equipe());

create or replace function public.solidcon_receber_vendas(
  p_dia date,p_itens jsonb,p_coletado_em timestamptz,p_execucao_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_agora timestamptz;
  v_hoje date;
  v_motivo text;
  v_item jsonb;
  v_campo text;
  v_linhas integer := 0;
  v_total numeric := 0;
  v_log bigint;
  v_ultima timestamptz;
begin
  if auth.uid() is null or not exists(
    select 1 from public.integracoes_autorizadas where user_id=auth.uid()
  ) then
    raise exception 'integracao nao autorizada' using errcode='42501';
  end if;
  -- Lock exclusivo das vendas; independente do estoque (5100,4).
  -- Serializa tambem o teste de UUID global entre dias diferentes.
  perform pg_advisory_xact_lock(5100,18);
  v_agora := clock_timestamp();
  v_hoje := (v_agora at time zone 'America/Sao_Paulo')::date;
  if p_dia is null or p_dia < v_hoje-400 or p_dia > v_hoje then
    v_motivo := 'dia_fora_da_janela';
  elsif p_execucao_id is null then
    v_motivo := 'execucao_invalida';
  elsif p_coletado_em is null or not isfinite(p_coletado_em)
     or p_coletado_em < v_agora-interval '24 hours'
     or p_coletado_em > v_agora+interval '5 minutes' then
    v_motivo := 'coleta_fora_da_janela';
  elsif p_itens is null or jsonb_typeof(p_itens)<>'array' then
    v_motivo := 'payload_invalido';
  else
    v_linhas := jsonb_array_length(p_itens);
    if v_linhas>2000 or octet_length(p_itens::text)>4194304 then
      v_motivo := 'payload_fora_do_limite';
    else
      for v_item in select value from jsonb_array_elements(p_itens) loop
        if jsonb_typeof(v_item)<>'object' or not(v_item ?& array[
          'ean','nome','categoria','formato','potes_por_unidade','familia','qtd',
          'valor_centavos','valor_bruto_centavos','desconto_centavos'
        ]) then
          v_motivo := 'item_invalido'; exit;
        end if;
        if jsonb_typeof(v_item->'ean')<>'string' or (v_item->>'ean')!~'^[0-9]{1,32}$'
           or jsonb_typeof(v_item->'formato')<>'string'
           or (v_item->>'formato') not in('pote','cx24','cx48','outro')
           or jsonb_typeof(v_item->'qtd')<>'number' then
          v_motivo := 'item_invalido'; exit;
        end if;
        foreach v_campo in array array['nome','categoria'] loop
          if jsonb_typeof(v_item->v_campo)<>'null' and (
            jsonb_typeof(v_item->v_campo)<>'string' or
            length(v_item->>v_campo) not between 1 and
              (case when v_campo='nome' then 1000 else 200 end)
          ) then v_motivo := 'metadados_invalidos'; exit; end if;
        end loop;
        exit when v_motivo is not null;
        if jsonb_typeof(v_item->'familia')<>'null' and (
          jsonb_typeof(v_item->'familia')<>'string' or (v_item->>'familia')!~'^[0-9]{12}$'
        ) then v_motivo := 'familia_invalida'; exit; end if;
        if (v_item->>'formato')='outro' then
          if jsonb_typeof(v_item->'potes_por_unidade')<>'null' then
            v_motivo := 'fator_invalido'; exit;
          end if;
        elsif jsonb_typeof(v_item->'potes_por_unidade')<>'number'
           or (v_item->>'potes_por_unidade') is distinct from
              (case v_item->>'formato' when 'pote' then '1' when 'cx24' then '24' when 'cx48' then '48' end) then
          v_motivo := 'fator_invalido'; exit;
        end if;
        foreach v_campo in array array['valor_centavos','valor_bruto_centavos','desconto_centavos'] loop
          if jsonb_typeof(v_item->v_campo)<>'number' or (v_item->>v_campo)!~'^[0-9]{1,19}$' then
            v_motivo := 'valor_invalido'; exit;
          end if;
        end loop;
        exit when v_motivo is not null;
        begin
          if (v_item->>'qtd')::numeric<0 then v_motivo := 'quantidade_invalida'; end if;
          perform (v_item->>'valor_centavos')::bigint,
                  (v_item->>'valor_bruto_centavos')::bigint,
                  (v_item->>'desconto_centavos')::bigint;
          v_total := v_total+(v_item->>'valor_centavos')::numeric;
        exception when invalid_text_representation or numeric_value_out_of_range then
          v_motivo := 'valor_invalido';
        end;
        exit when v_motivo is not null;
      end loop;
      if v_motivo is null and v_total>9223372036854775807::numeric then
        v_motivo := 'total_fora_do_limite';
      end if;
      if v_motivo is null and (select count(distinct value->>'ean') from jsonb_array_elements(p_itens))<>v_linhas then
        v_motivo := 'ean_duplicado';
      end if;
    end if;
  end if;
  if v_motivo is null then
    select max(coletado_em) into v_ultima from public.solidcon_vendas_sync where dia=p_dia and status='ok';
    if v_ultima is not null and p_coletado_em<=v_ultima then
      v_motivo := 'snapshot_antigo';
    elsif exists(select 1 from public.solidcon_vendas_sync where status='ok' and execucao_id=p_execucao_id) then
      v_motivo := 'execucao_repetida';
    elsif v_linhas=0 and exists(select 1 from public.solidcon_vendas_dia where dia=p_dia) then
      v_motivo := 'vazio_sobre_dia_existente';
    end if;
  end if;
  if v_motivo is not null then
    -- Nao usar RAISE: manter log de rejeicao sem tocar nos dados daquele dia.
    insert into public.solidcon_vendas_sync(dia,status,linhas,coletado_em,execucao_id,mensagem,em)
      values(p_dia,'erro',v_linhas,p_coletado_em,p_execucao_id,v_motivo,v_agora) returning id into v_log;
    return jsonb_build_object('id',v_log,'status','erro','motivo',v_motivo,'dia',p_dia,'execucao_id',p_execucao_id);
  end if;
  delete from public.solidcon_vendas_dia where dia=p_dia;
  insert into public.solidcon_vendas_dia(
    dia,ean,nome,categoria,formato,potes_por_unidade,familia,qtd,
    valor_centavos,valor_bruto_centavos,desconto_centavos,coletado_em
  )
  select p_dia,i->>'ean',i->>'nome',i->>'categoria',i->>'formato',
    (i->>'potes_por_unidade')::integer,i->>'familia',(i->>'qtd')::numeric,
    (i->>'valor_centavos')::bigint,(i->>'valor_bruto_centavos')::bigint,
    (i->>'desconto_centavos')::bigint,p_coletado_em
  from jsonb_array_elements(p_itens) as t(i);
  insert into public.solidcon_vendas_sync(dia,status,linhas,valor_total_centavos,coletado_em,execucao_id,em)
    values(p_dia,'ok',v_linhas,v_total::bigint,p_coletado_em,p_execucao_id,v_agora) returning id into v_log;
  return jsonb_build_object(
    'id',v_log,'status','ok','dia',p_dia,'linhas',v_linhas,
    'valor_total_centavos',v_total::bigint,'coletado_em',p_coletado_em,'execucao_id',p_execucao_id
  );
end;
$$;
revoke all on function public.solidcon_receber_vendas(date,jsonb,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.solidcon_receber_vendas(date,jsonb,timestamptz,uuid) to authenticated;

create or replace view public.solidcon_vendas_por_dia with(security_invoker=true) as
select dia,sum(valor_centavos) as valor_centavos,
  sum(qtd*coalesce(potes_por_unidade,0)) as potes
from public.solidcon_vendas_dia group by dia;

create or replace view public.solidcon_vendas_por_mes with(security_invoker=true) as
select date_trunc('month',dia)::date as mes,sum(valor_centavos) as valor_centavos,
  sum(qtd*coalesce(potes_por_unidade,0)) as potes,
  count(distinct dia) filter(where qtd>0 or valor_centavos>0) as dias_com_venda
from public.solidcon_vendas_dia group by date_trunc('month',dia)::date;

create or replace view public.solidcon_vendas_familia_mes with(security_invoker=true) as
with familias as (
  select date_trunc('month',dia)::date as mes,
    coalesce(familia,'ean:'||ean) as familia,formato,
    min(nome) as nome_item,sum(qtd) as qtd,sum(valor_centavos) as valor_centavos,
    sum(qtd*coalesce(potes_por_unidade,0)) as potes
  from public.solidcon_vendas_dia group by date_trunc('month',dia)::date,coalesce(familia,'ean:'||ean),formato
), nomes_pote as (
  select distinct on(familia) familia,nome
  from public.solidcon_vendas_dia
  where formato='pote' and familia is not null and nome is not null
  order by familia,dia desc,coletado_em desc,ean
)
select f.mes,f.familia,coalesce(n.nome,f.nome_item,f.familia) as nome_familia,
  f.formato,f.qtd,f.valor_centavos,f.potes
from familias f left join nomes_pote n on n.familia=f.familia;
revoke all on public.solidcon_vendas_por_dia,public.solidcon_vendas_por_mes,public.solidcon_vendas_familia_mes from public,anon,authenticated;
grant select on public.solidcon_vendas_por_dia,public.solidcon_vendas_por_mes,public.solidcon_vendas_familia_mes to authenticated;
commit;
