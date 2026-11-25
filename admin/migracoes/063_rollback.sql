-- Preserva auditoria e dados. Reverter tambem os fontes da063; remove somente APIs novas.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
select pg_advisory_xact_lock(5100,63);select pg_advisory_xact_lock(5100,5201);select pg_advisory_xact_lock(5100,5001);
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
       and greatest((select s.dia_saida from public.rota_059_saidas s where s.cd_pedido=p.cd_pedido),
         (fat.em at time zone 'America/Sao_Paulo')::date +
         case when (fat.em at time zone 'America/Sao_Paulo')::time > cfg.hora then 1 else 0 end)>=p_dia-7)))
$$;
drop function if exists public.rota_063_confirmar_entrega(bigint,text,uuid);
drop function if exists public.rota_063_desfazer_entrega(bigint);
drop function if exists public.rota_063_ler_entregas(bigint[]);
notify pgrst,'reload schema';commit;
