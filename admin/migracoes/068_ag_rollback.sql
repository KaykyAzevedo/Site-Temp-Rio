-- 068AG rollback aditivo: conserva override manual/auditoria, restaura corpos V.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
select pg_advisory_xact_lock(5100,6847);select pg_advisory_xact_lock(5100,5201);select pg_advisory_xact_lock(5100,5001);select pg_advisory_xact_lock(5100,4601);
drop trigger if exists rota_068ag_plano_manual on public.rota_plano_semana;
do $$declare r record;begin
 if to_regclass('public.rota_068ag_backup') is not null then for r in select def from public.rota_068ag_backup loop execute r.def;end loop;end if;
end$$;
update public.rota_config set agendados_prioridade_068ag=false where id=1;
revoke all on function public.rota_068ag_agendados_ler(bigint[]) from public,anon,authenticated,service_role;
-- Helpers privados e tabela ficam inertes para preservar decisao manual e rollback repetivel.
notify pgrst,'reload schema';commit;
