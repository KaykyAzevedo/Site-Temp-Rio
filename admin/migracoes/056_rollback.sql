-- Rollback056: volta055, sem apagar canhotos/itens/ordem/publicacoes. Revisa foto ao mudar criterio.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
select pg_catalog.pg_advisory_xact_lock(5100,56);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
lock table public.rota_config in access exclusive mode nowait;
drop trigger if exists rota_056_config_revisao on public.rota_config;
drop function if exists public.rota_056_config_revisao();
create or replace function public.rota_055_pendente(p_cd bigint,p_dia date)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.solidcon_pedidos_erp p where p.cd_pedido=p_cd
   and not exists(select 1 from public.pedido_canhoto c where c.cd_pedido=p.cd_pedido and c.substituido_em is null)
   and (p.etapa in ('aberto','na_carga','separando','separado','conferido')
     or (p.etapa in ('saiu','atendido') and
       (coalesce(p.dt_saida,p.dt_nota,p.dt_atendido) at time zone 'America/Sao_Paulo')::date>=p_dia-7)))
$$;
do $$begin
 if exists(select 1 from pg_catalog.pg_attribute where attrelid='public.rota_config'::regclass and attname='canhoto_desde' and not attisdropped) then
  update public.rota_dia_fechada set revisao=revisao+1,alterada_em=pg_catalog.now() where data=public.rota_050_hoje() and estado='fechada';
 end if;
end$$;
alter table public.rota_config drop column if exists canhoto_desde;
notify pgrst, 'reload schema';
commit;
