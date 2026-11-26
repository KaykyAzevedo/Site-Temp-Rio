-- Rollback066: remove as RPCs, auxiliares e os gatilhos de memoria. PRESERVA dados: rota_066_historico e
-- rota_066_feedback ficam (reaplicar a 066 continua de onde parou; backfill nao sobrescreve). Nao toca plano/fechamento.
-- Reverter o painel junto: sem rota_066_sugestoes o quadro fica sem sugestoes (PGRST202/42883), como antes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_catalog.pg_advisory_xact_lock(5100, 66);
select pg_catalog.pg_advisory_xact_lock(5100, 5201);
select pg_catalog.pg_advisory_xact_lock(5100, 5001);
select pg_catalog.pg_advisory_xact_lock(5100, 4601);
drop trigger if exists rota_066_hist_foto on public.rota_dia_item;
drop trigger if exists rota_066_hist_plano on public.rota_plano_semana;
drop function if exists public.rota_066_sugestoes(date);
drop function if exists public.rota_066_registrar(bigint, text, date);
drop function if exists public.rota_066_hist_foto();
drop function if exists public.rota_066_hist_plano();
drop function if exists public.rota_066_km(double precision, double precision, double precision, double precision);
drop function if exists public.rota_066_volume(integer, integer, integer);
drop function if exists public.rota_066_saida(text, date);
drop function if exists public.rota_066_prazo(timestamptz, text);
drop function if exists public.rota_066_dia_txt(date, date);
notify pgrst, 'reload schema';
commit;
