-- Restaura corpos6a42d0d. Conserva auditoria, correcoes explicitas e memoria066.
begin;
select pg_advisory_xact_lock(5100,6822);select pg_advisory_xact_lock(5100,5201);select pg_advisory_xact_lock(5100,5001);select pg_advisory_xact_lock(5100,4601);
do $$declare r record;begin for r in select def from public.rota_068v_backup order by nome loop execute r.def;end loop;end$$;
drop function if exists public.rota_068_veiculo_historico(bigint,text,text);
drop function if exists public.rota_068_veiculo_historico_ler(bigint[]);
drop function if exists public.rota_068v_semana_recebidos(date);
drop function if exists public.rota_068v_estado_base(bigint);
drop function if exists public.rota_068v_provas(bigint);
drop function if exists public.rota_068v_memoria();
drop function if exists public.rota_068v_veiculo(bigint,date);
notify pgrst,'reload schema';commit;
