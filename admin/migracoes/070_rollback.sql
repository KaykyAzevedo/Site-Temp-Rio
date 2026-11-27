-- Rollback idempotente: conserva tabelas/auditoria/provas070, restaura corpos575.
begin;
select pg_advisory_xact_lock(5100,35);select pg_advisory_xact_lock(5100,5201);select pg_advisory_xact_lock(5100,5001);select pg_advisory_xact_lock(5100,4601);
do $$begin if exists(select 1 from pg_extension where extname='pg_cron') then perform cron.unschedule(jobid) from cron.job where jobname='rota-070-virada';end if;end$$;
update public.rota_config set previsao_definitiva_070=false where id=1;
drop trigger if exists rota_070_observar_erp on public.solidcon_pedidos_erp;
drop trigger if exists rota_070_plano_mudou on public.rota_plano_semana;
do $$declare r record;begin
 for r in select def from public.rota_070_backup order by nome loop execute r.def;end loop;
 for r in select p.oid::regprocedure assinatura from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'rota_070_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',r.assinatura);end loop;
end$$;
commit;
