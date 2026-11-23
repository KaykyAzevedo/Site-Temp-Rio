-- ROLLBACK da 052 (canhotos). NAO e migracao. Apaga a TABELA pedido_canhoto (as ligacoes foto -> pedido) e as politicas
-- do bucket. Os ARQUIVOS do bucket 'canhotos' NAO sao apagados aqui (Storage: apague pelo painel do Supabase se o dono
-- pedir); o bucket fica, privado e sem politica (ninguem le nem grava). Sem CASCADE.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_catalog.pg_advisory_xact_lock(5100, 52);
do $$begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    execute $j$select cron.unschedule(jobid) from cron.job where jobname='canhotos-retencao'$j$;
  end if;
end$$;
drop function if exists public.rota_052_agendar_limpeza();
drop function if exists public.rota_052_limpeza_confirmar(uuid);
drop function if exists public.rota_052_limpeza_lote(integer);
drop policy if exists canhotos_052_equipe_le on storage.objects;
drop policy if exists canhotos_052_motorista_insere on storage.objects;
drop policy if exists canhotos_052_marca_insere on storage.objects;
drop policy if exists canhotos_052_marca_atualiza on storage.objects;
drop policy if exists canhotos_052_admin_apaga on storage.objects;
drop function if exists public.rota_052_canhotos_motorista(date);
drop function if exists public.rota_052_remover(bigint, text);
drop function if exists public.rota_052_registrar(text, bigint[], boolean);
drop function if exists public.rota_052_registrar(text, bigint[], boolean, text, integer);
drop table if exists public.pedido_canhoto;
drop function if exists public.rota_052_caminho_motorista(text);
drop function if exists public.rota_052_caminho_valido(text);
drop function if exists public.rota_052_arquivo_livre(text);
drop table if exists public.rota_052_expurgo;
commit;
