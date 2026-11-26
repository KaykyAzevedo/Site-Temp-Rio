-- 068 F2 rollback. Idempotente. Nao remove a 045 nem suas linhas.
-- As linhas antes 'site' passam a ter a semantica da 045: continuam fora da rota.
-- ATENCAO: remove o log F2; exporte-o antes se precisar preservar a auditoria.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_catalog.pg_advisory_xact_lock(5100, 68);

drop trigger if exists rota_068_site_guardar on public.rota_pedido_ignorado;
drop trigger if exists rota_068_site_registrar on public.rota_pedido_ignorado;
drop function if exists public.rota_068_tirar_do_site(bigint, text);
drop function if exists public.rota_068_voltar_ao_site(bigint);
drop function if exists public.rota_068_fora_do_site();
drop function if exists public.rota_068_site_guardar();
drop function if exists public.rota_068_site_registrar();
drop table if exists public.rota_068_site_log;
drop index if exists public.rota_pedido_ignorado_068_site_idx;
alter table public.rota_pedido_ignorado drop constraint if exists rota_pedido_ignorado_068_alcance;
alter table public.rota_pedido_ignorado drop column if exists alcance;

notify pgrst, 'reload schema';
commit;
