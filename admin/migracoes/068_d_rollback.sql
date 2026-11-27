-- Rollback 068 D r2 idempotente: desliga novas operacoes/UI; conserva acervo, retencao e nao toca no 070.
-- Nao apaga fotos, metadados ou pedido_arquivo 057. Guarda contra rename de lote permanece.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_catalog.pg_advisory_xact_lock(5100, 6804);
select pg_catalog.pg_advisory_xact_lock(5100, 5201);
drop function if exists public.rota_068_historico(date);
drop function if exists public.rota_068_rotas_semana();
drop function if exists public.rota_068_lote_registrar(date, text[]);
drop function if exists public.rota_068_lote_listar(date);
drop function if exists public.rota_068_lote_remover(text);
drop policy if exists canhotos_068_lote_insere on storage.objects;
drop function if exists public.rota_068_lote_upload_valido(text);
-- canhoto_lote_dia + rota_068_lote_dia + rota_068_lote_purgar/cron ficam para cumprir retencao sem perder acervo.
notify pgrst, 'reload schema';
commit;
