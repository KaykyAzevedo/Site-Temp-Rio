-- 068H rollback idempotente: restaura corpos anteriores e conserva estado/auditoria, nenhuma foto/memoria apagada.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
select pg_catalog.pg_advisory_xact_lock(5100,6808);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
select pg_catalog.pg_advisory_xact_lock(5100,4601);
drop trigger if exists rota_068h_plano_reprogramar on public.rota_plano_semana;
drop trigger if exists rota_000_068h_plano_travar on public.rota_plano_semana;
do $$declare r record;begin
 if to_regclass('public.rota_068h_backup') is not null then
  -- A063 mudou somente pelo campo adicional; precisa DROP antes de restaurar a assinatura original.
  drop function if exists public.rota_063_ler_entregas(bigint[]);
  for r in select nome,def from public.rota_068h_backup order by nome loop execute r.def;end loop;
  grant execute on function public.rota_063_ler_entregas(bigint[]) to authenticated,service_role;
 end if;
end$$;
drop function if exists public.rota_068_mover_pedido(bigint,date,text,uuid);
drop function if exists public.rota_068_estados_pedidos(bigint[]);
drop function if exists public.rota_068h_plano_reprogramar();
drop function if exists public.rota_068h_plano_travar();
drop function if exists public.rota_068_reprogramar_explicito(bigint,date,text);
drop function if exists public.rota_068h_ordenar(date,text);
drop function if exists public.rota_068_pedido_entregue(bigint);
drop function if exists public.rota_068_recebido_dia(bigint);
drop function if exists public.rota_068h_pendente_base(bigint,date);
drop function if exists public.rota_068h_capturar_base(bigint[]);
-- TabelasH ficam privadas/comRLS para reter auditoria e permitir reaplicar sem apagar fatos.
notify pgrst,'reload schema';commit;
