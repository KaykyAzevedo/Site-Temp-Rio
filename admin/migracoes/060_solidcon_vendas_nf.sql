-- 060: NF-e de venda normal modelo55/filial4. Aplicacao manual pelo dono apos revisao.
-- Sem acesso ao ERP. Requer026/023 e helpers de equipe/integracao publicados.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
select pg_catalog.pg_advisory_xact_lock(5100,60);
do $$begin
 if to_regclass('public.integracoes_autorizadas') is null or to_regprocedure('auth.uid()') is null
   or to_regprocedure('public.eh_equipe()') is null or to_regprocedure('public.solidcon_026_documento_valido(text,text)') is null then
  raise exception '060 requer023/026 e helpers publicados. Nada aplicado.';
 end if;
end$$;
create table if not exists public.solidcon_vendas_nf (
 cd_nota bigint primary key check(cd_nota between 1 and 9007199254740991),
 filial smallint not null default 4 check(filial=4),
 numero bigint not null check(numero between 1 and 999999999),serie text not null check(serie ~ '^[0-9A-Za-z-]{1,32}$'),
 dia date not null check(dia>=date '2026-05-29'),dt timestamptz not null check(pg_catalog.isfinite(dt)),
 documento text not null check(public.solidcon_026_documento_valido(documento,'cnpj')),
 tipo text not null default 'cnpj' check(tipo='cnpj'),
 cd_pedido bigint check(cd_pedido between 1 and 9007199254740991),
 valor_centavos bigint not null check(valor_centavos between 0 and 999999999999999),
 total_nota_centavos bigint not null check(total_nota_centavos between 0 and 999999999999999),
 st_centavos bigint check(st_centavos between 0 and 999999999999999),
 nf_cupom boolean not null,coletado_em timestamptz not null check(pg_catalog.isfinite(coletado_em)),
 check((dt at time zone 'America/Sao_Paulo')::date=dia)
);
create index if not exists solidcon_vendas_nf_doc_dia on public.solidcon_vendas_nf(documento,dia desc);
create index if not exists solidcon_vendas_nf_dia on public.solidcon_vendas_nf(dia);
-- Cobertura e o registro autoritativo de dias inclusive VAZIOS: impede fallback cancelar a exclusao de uma NF.
create table if not exists public.solidcon_vendas_nf_dias (
 dia date primary key,coletado_em timestamptz not null check(pg_catalog.isfinite(coletado_em)),execucao_id uuid not null
);
create table if not exists public.solidcon_vendas_nf_sync (
 id bigint generated always as identity primary key,inicio date,fim date,status text not null check(status in('ok','erro')),
 linhas integer not null default 0,coletado_em timestamptz,execucao_id uuid,assinatura text,mensagem text,
 em timestamptz not null default pg_catalog.clock_timestamp()
);
create unique index if not exists solidcon_vendas_nf_sync_exec on public.solidcon_vendas_nf_sync(execucao_id,inicio,fim) where status='ok';
create index if not exists solidcon_vendas_nf_sync_coleta on public.solidcon_vendas_nf_sync(coletado_em desc) where status='ok';
alter table public.solidcon_vendas_nf enable row level security;
alter table public.solidcon_vendas_nf_dias enable row level security;
alter table public.solidcon_vendas_nf_sync enable row level security;
revoke all on public.solidcon_vendas_nf,public.solidcon_vendas_nf_dias,public.solidcon_vendas_nf_sync from public,anon,authenticated,service_role;
revoke all on sequence public.solidcon_vendas_nf_sync_id_seq from public,anon,authenticated,service_role;
grant select on public.solidcon_vendas_nf,public.solidcon_vendas_nf_dias,public.solidcon_vendas_nf_sync to authenticated;
drop policy if exists nf_060_equipe on public.solidcon_vendas_nf;
create policy nf_060_equipe on public.solidcon_vendas_nf for select to authenticated using((select public.eh_equipe()));
drop policy if exists nf_060_equipe on public.solidcon_vendas_nf_dias;
create policy nf_060_equipe on public.solidcon_vendas_nf_dias for select to authenticated using((select public.eh_equipe()));
drop policy if exists nf_060_equipe on public.solidcon_vendas_nf_sync;
create policy nf_060_equipe on public.solidcon_vendas_nf_sync for select to authenticated using((select public.eh_equipe()));

-- Uma unica consulta/snapshot para notas E cobertura: nao misturar antes/depois do backfill.
-- INVOKER conserva RLS; limites fixos, nenhuma consulta arbitraria ou escrita.
create or replace function public.solidcon_ler_vendas_nf()
returns jsonb language plpgsql stable security invoker set search_path=''
as $$begin
 if not coalesce(public.eh_equipe(),false) then raise exception 'equipe necessaria' using errcode='42501';end if;
 return (with notas as materialized (
  select cd_nota,numero,serie,dia,dt,documento,tipo,cd_pedido,valor_centavos,total_nota_centavos,st_centavos,nf_cupom
  from public.solidcon_vendas_nf order by cd_nota limit 20000
 ),dias as materialized (
  select dia,coletado_em from public.solidcon_vendas_nf_dias order by dia limit 402
 ) select pg_catalog.jsonb_build_object(
  'notas',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(n)) from notas n),'[]'::jsonb),
  'dias',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(d)) from dias d),'[]'::jsonb),
  'truncado',(select count(*)>=20000 from notas) or (select count(*)>=402 from dias)));
end$$;
revoke all on function public.solidcon_ler_vendas_nf() from public,anon,authenticated,service_role;
grant execute on function public.solidcon_ler_vendas_nf() to authenticated;

create or replace function public.solidcon_060_limpar()
returns integer language plpgsql security definer set search_path=''
as $$declare v_n integer;v_hoje date:=(pg_catalog.now() at time zone 'America/Sao_Paulo')::date;
begin
 if not pg_catalog.pg_try_advisory_xact_lock(5100,60) then return 0;end if;
 delete from public.solidcon_vendas_nf where dia<v_hoje-400;
 get diagnostics v_n=row_count;
 delete from public.solidcon_vendas_nf_dias where dia<v_hoje-400;
 delete from public.solidcon_vendas_nf_sync where em<pg_catalog.now()-interval '90 days';
 return v_n;
end$$;
revoke all on function public.solidcon_060_limpar() from public,anon,authenticated,service_role;
grant execute on function public.solidcon_060_limpar() to service_role;

create or replace function public.solidcon_receber_vendas_nf(p_inicio date,p_fim date,p_itens jsonb,p_coletado_em timestamptz,p_execucao_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_hoje date;v_agora timestamptz;v_motivo text;v_item jsonb;v_campo text;v_dia date;v_dt timestamptz;
 v_n integer;v_assinatura text;v_antiga public.solidcon_vendas_nf_sync%rowtype;
 v_campos constant text[]:=array['cd_nota','numero','serie','dia','dt','documento','cd_pedido','valor_centavos','total_nota_centavos','st_centavos','nf_cupom'];
begin
 if auth.uid() is null or not exists(select 1 from public.integracoes_autorizadas where user_id=auth.uid()) then
  raise exception 'integracao nao autorizada' using errcode='42501';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(5100,60);
 v_agora:=pg_catalog.clock_timestamp();v_hoje:=(v_agora at time zone 'America/Sao_Paulo')::date;
 begin
  if p_inicio is null or p_fim is null or p_inicio>p_fim or p_fim-p_inicio>30
    or p_inicio<greatest(date '2026-05-29',v_hoje-400) or p_fim>v_hoje then
   v_motivo:='intervalo_invalido';
  elsif p_execucao_id is null or p_coletado_em is null or not pg_catalog.isfinite(p_coletado_em)
    or p_coletado_em<v_agora-interval '24 hours' or p_coletado_em>v_agora+interval '5 minutes' then
   v_motivo:='coleta_invalida';
  elsif p_itens is null or pg_catalog.jsonb_typeof(p_itens)<>'array' then v_motivo:='payload_invalido';
  elsif pg_catalog.jsonb_array_length(p_itens)>10000 or pg_catalog.octet_length(p_itens::text)>16777216 then v_motivo:='limite_excedido';
  else
   v_n:=pg_catalog.jsonb_array_length(p_itens);
   for v_item in select value from pg_catalog.jsonb_array_elements(p_itens) loop
    if pg_catalog.jsonb_typeof(v_item)<>'object' or not(v_item ?& v_campos)
      or exists(select 1 from pg_catalog.jsonb_object_keys(v_item) k where not(k=any(v_campos))) then v_motivo:='campos_invalidos';exit;end if;
    if pg_catalog.jsonb_typeof(v_item->'dia')<>'string' or (v_item->>'dia') !~ '^\d{4}-\d{2}-\d{2}$'
      or pg_catalog.jsonb_typeof(v_item->'dt')<>'string' or (v_item->>'dt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then v_motivo:='data_invalida';exit;end if;
    v_dia:=(v_item->>'dia')::date;v_dt:=(v_item->>'dt')::timestamptz;
    if v_dia<p_inicio or v_dia>p_fim or not pg_catalog.isfinite(v_dt) or (v_dt at time zone 'America/Sao_Paulo')::date<>v_dia then v_motivo:='data_invalida';exit;end if;
    if pg_catalog.jsonb_typeof(v_item->'documento')<>'string' or not public.solidcon_026_documento_valido(v_item->>'documento','cnpj')
      or pg_catalog.jsonb_typeof(v_item->'serie')<>'string' or (v_item->>'serie') !~ '^[0-9A-Za-z-]{1,32}$'
      or pg_catalog.jsonb_typeof(v_item->'nf_cupom')<>'boolean' then v_motivo:='nota_invalida';exit;end if;
    foreach v_campo in array array['cd_nota','numero','valor_centavos','total_nota_centavos'] loop
     if pg_catalog.jsonb_typeof(v_item->v_campo)<>'number' or (v_item->>v_campo) !~ '^(0|[1-9][0-9]{0,15})$' then v_motivo:='numero_invalido';exit;end if;
    end loop;
    exit when v_motivo is not null;
    if (v_item->>'cd_nota')::numeric not between 1 and 9007199254740991 or (v_item->>'numero')::numeric not between 1 and 999999999
      or (v_item->>'valor_centavos')::numeric>999999999999999 or (v_item->>'total_nota_centavos')::numeric>999999999999999 then v_motivo:='numero_invalido';exit;end if;
    -- ST ausente e desconhecida, nao zero; nao impede somar produtos conhecidos.
    if v_item->'st_centavos'<>'null'::jsonb and (pg_catalog.jsonb_typeof(v_item->'st_centavos')<>'number' or (v_item->>'st_centavos') !~ '^(0|[1-9][0-9]{0,14})$'
      or (v_item->>'st_centavos')::numeric>999999999999999) then v_motivo:='numero_invalido';exit;end if;
    if v_item->'cd_pedido'<>'null'::jsonb and (pg_catalog.jsonb_typeof(v_item->'cd_pedido')<>'number' or (v_item->>'cd_pedido') !~ '^[1-9][0-9]{0,15}$'
      or (v_item->>'cd_pedido')::numeric not between 1 and 9007199254740991) then v_motivo:='pedido_invalido';exit;end if;
   end loop;
   if v_motivo is null and (select count(distinct (value->>'cd_nota')::bigint) from pg_catalog.jsonb_array_elements(p_itens))<>v_n then v_motivo:='nota_duplicada';end if;
  end if;
  if v_motivo is null then
   v_assinatura:=pg_catalog.md5(p_itens::text||pg_catalog.to_char(p_coletado_em at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'));
   select * into v_antiga from public.solidcon_vendas_nf_sync where status='ok' and execucao_id=p_execucao_id and inicio=p_inicio and fim=p_fim;
   if found then
    if v_antiga.assinatura=v_assinatura then return pg_catalog.jsonb_build_object('status','ok','linhas',v_antiga.linhas,'repetido',true);end if;
    v_motivo:='conflito_execucao';
   elsif exists(select 1 from public.solidcon_vendas_nf_dias where dia between p_inicio and p_fim and coletado_em>=p_coletado_em)
     or exists(select 1 from public.solidcon_vendas_nf n join pg_catalog.jsonb_array_elements(p_itens) i on n.cd_nota=(i->>'cd_nota')::bigint where n.coletado_em>=p_coletado_em) then v_motivo:='snapshot_antigo';
   end if;
  end if;
  if v_motivo is null then
   delete from public.solidcon_vendas_nf where dia between p_inicio and p_fim;
   insert into public.solidcon_vendas_nf(cd_nota,numero,serie,dia,dt,documento,cd_pedido,valor_centavos,total_nota_centavos,st_centavos,nf_cupom,coletado_em)
   select (i->>'cd_nota')::bigint,(i->>'numero')::bigint,i->>'serie',(i->>'dia')::date,(i->>'dt')::timestamptz,i->>'documento',
     (i->>'cd_pedido')::bigint,(i->>'valor_centavos')::bigint,(i->>'total_nota_centavos')::bigint,(i->>'st_centavos')::bigint,(i->>'nf_cupom')::boolean,p_coletado_em
   from pg_catalog.jsonb_array_elements(p_itens) i
   on conflict(cd_nota) do update set numero=excluded.numero,serie=excluded.serie,dia=excluded.dia,dt=excluded.dt,documento=excluded.documento,
     cd_pedido=excluded.cd_pedido,valor_centavos=excluded.valor_centavos,total_nota_centavos=excluded.total_nota_centavos,st_centavos=excluded.st_centavos,nf_cupom=excluded.nf_cupom,coletado_em=excluded.coletado_em;
   insert into public.solidcon_vendas_nf_dias(dia,coletado_em,execucao_id)
   select d::date,p_coletado_em,p_execucao_id from pg_catalog.generate_series(p_inicio::timestamp,p_fim::timestamp,interval '1 day') d
   on conflict(dia) do update set coletado_em=excluded.coletado_em,execucao_id=excluded.execucao_id;
   insert into public.solidcon_vendas_nf_sync(inicio,fim,status,linhas,coletado_em,execucao_id,assinatura)
   values(p_inicio,p_fim,'ok',v_n,p_coletado_em,p_execucao_id,v_assinatura);
   perform public.solidcon_060_limpar();
   return pg_catalog.jsonb_build_object('status','ok','linhas',v_n,'repetido',false);
  end if;
 exception when others then v_motivo:='payload_invalido';
 end;
 insert into public.solidcon_vendas_nf_sync(inicio,fim,status,linhas,execucao_id,mensagem) values(p_inicio,p_fim,'erro',0,p_execucao_id,v_motivo);
 return pg_catalog.jsonb_build_object('status','erro','motivo',v_motivo);
end$$;
revoke all on function public.solidcon_receber_vendas_nf(date,date,jsonb,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.solidcon_receber_vendas_nf(date,date,jsonb,timestamptz,uuid) to authenticated;
do $$begin
 if exists(select 1 from pg_catalog.pg_extension where extname='pg_cron') then
  execute $j$select cron.unschedule(jobid) from cron.job where jobname='solidcon-vendas-nf-retencao'$j$;
  execute $j$select cron.schedule('solidcon-vendas-nf-retencao','23 6 * * *','select public.solidcon_060_limpar()')$j$;
 else raise notice '060 sem pg_cron: limpeza tambem ocorre na RPC; configurar cron antes de publicar.';
 end if;
end$$;
notify pgrst,'reload schema';
commit;
