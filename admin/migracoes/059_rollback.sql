-- Reverter site/Edge junto; restaura055/056, sem apagar dados.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
select pg_catalog.pg_advisory_xact_lock(5100,59);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
create or replace function public.rota_055_pendente(p_cd bigint,p_dia date)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.solidcon_pedidos_erp p where p.cd_pedido=p_cd
   and not exists(select 1 from public.pedido_canhoto c where c.cd_pedido=p.cd_pedido and c.substituido_em is null)
   and (p.etapa in ('aberto','na_carga','separando','separado','conferido')
     or (p.etapa in ('saiu','atendido')
       and ((select c.canhoto_desde from public.rota_config c where c.id=1) is null
         or coalesce(p.dt_saida,p.dt_nota,p.dt_atendido)>=(select c.canhoto_desde from public.rota_config c where c.id=1))
       and (coalesce(p.dt_saida,p.dt_nota,p.dt_atendido) at time zone 'America/Sao_Paulo')::date>=p_dia-7)))
$$;
drop view if exists public.rota_059_saidas;
drop index if exists public.rota_059_item_pedido;
notify pgrst,'reload schema';
commit;
