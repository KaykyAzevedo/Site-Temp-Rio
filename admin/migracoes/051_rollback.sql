-- ROLLBACK da 051 (progresso da rota do motorista). NAO e migracao. Apaga o progresso marcado (rota_saida_progresso).
-- Antes: publique a tela do motorista SEM a 051 (sem ela a tela volta a so mostrar a rota). Sem CASCADE.
-- Se a 052 estiver instalada, execute o rollback 052 antes deste (ela usa o contexto e os pedidos da 051).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_catalog.pg_advisory_xact_lock(5100, 51);
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $j$select cron.unschedule(jobid) from cron.job where jobname = 'rota-limpeza-progresso'$j$;
  end if;
end;
$$;
drop function if exists public.rota_051_limpar();
drop function if exists public.rota_051_pedidos_motorista(date);
drop function if exists public.rota_051_cds_da_rota(date, text);
drop function if exists public.rota_051_marcar(date, integer, boolean, timestamptz);
drop function if exists public.rota_051_marcar(date, text, integer, integer, boolean, timestamptz);
drop function if exists public.rota_051_validar_contexto(date, text, integer);
drop function if exists public.rota_051_meu_veiculo();
drop trigger if exists rota_051_saida_versao on public.rota_saida;
drop function if exists public.rota_051_saida_versao();
drop table if exists public.rota_saida_progresso;
drop table if exists public.rota_051_versoes;
commit;
