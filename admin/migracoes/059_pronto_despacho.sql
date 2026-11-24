-- 059: despacho derivado do dia ativo na rota fechada, sem alterar etapa do ERP.
-- Aplicar ANTES do site/Edge. Requer050/055/056; Postgres15+ (security_invoker).
begin;
set local lock_timeout='5s'; set local statement_timeout='60s';
select pg_catalog.pg_advisory_xact_lock(5100,59);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
do $$begin
 if to_regprocedure('public.rota_055_pendente(bigint,date)') is null
   or not exists(select 1 from pg_catalog.pg_attribute where attrelid='public.rota_config'::regclass and attname='canhoto_desde' and not attisdropped) then
  raise exception '059 requer050/055/056. Nada aplicado.';
 end if;
end$$;
create index if not exists rota_059_item_pedido on public.rota_dia_item(cd_pedido,data) where removido_em is null;
-- Primeiro dia ativo: uma reentrega nao faz um pedido ja enviado voltar para Pronto.
-- O invocador conserva RLS050: equipe/service_role, nunca anon/motorista global.
create or replace view public.rota_059_saidas with (security_invoker=true) as
 select i.cd_pedido,min(i.data) as dia_saida
 from public.rota_dia_item i join public.rota_dia_fechada f on f.data=i.data
 where i.removido_em is null and f.estado='fechada' group by i.cd_pedido;
revoke all on public.rota_059_saidas from public,anon,authenticated,service_role;
grant select on public.rota_059_saidas to authenticated,service_role;
create or replace function public.rota_055_pendente(p_cd bigint,p_dia date)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.solidcon_pedidos_erp p
   cross join lateral (select coalesce(p.dt_saida,p.dt_nota,p.dt_atendido) as em) fat
   cross join lateral (select coalesce((select pg_catalog.make_time(extract(hour from c.hora_saida)::integer,extract(minute from c.hora_saida)::integer,0) from public.rota_config c where c.id=1),time '07:00') as hora) cfg
   where p.cd_pedido=p_cd
   and not exists(select 1 from public.pedido_canhoto c where c.cd_pedido=p.cd_pedido and c.substituido_em is null)
   and (p.etapa in ('aberto','na_carga','separando','separado','conferido')
     or (p.etapa in ('saiu','atendido') and fat.em is not null
       and ((select c.canhoto_desde from public.rota_config c where c.id=1) is null
         or fat.em>=(select c.canhoto_desde from public.rota_config c where c.id=1))
       and coalesce((select s.dia_saida from public.rota_059_saidas s where s.cd_pedido=p.cd_pedido),
         (fat.em at time zone 'America/Sao_Paulo')::date +
         case when (fat.em at time zone 'America/Sao_Paulo')::time > cfg.hora then 1 else 0 end)>=p_dia-7)))
$$;
-- ACL privada da055 conservada pelo CREATE OR REPLACE.
notify pgrst,'reload schema';
commit;
