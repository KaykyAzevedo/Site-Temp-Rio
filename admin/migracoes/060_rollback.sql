-- Reverter coletor/site junto. Preserva notas, cobertura e logs para auditoria/reaplicacao.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
select pg_catalog.pg_advisory_xact_lock(5100,60);
do $$begin
 if exists(select 1 from pg_catalog.pg_extension where extname='pg_cron') then
  execute $j$select cron.unschedule(jobid) from cron.job where jobname='solidcon-vendas-nf-retencao'$j$;
 end if;
end$$;
drop function if exists public.solidcon_receber_vendas_nf(date,date,jsonb,timestamptz,uuid);
drop function if exists public.solidcon_ler_vendas_nf();
drop function if exists public.solidcon_060_limpar();
notify pgrst,'reload schema';
commit;
