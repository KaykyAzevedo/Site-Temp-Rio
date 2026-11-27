-- Executar ANTES de070principal; somente leitura, falha antes de qualquer alteracao.
begin read only;
do $$begin
 if not exists(select 1 from pg_extension where extname='pg_cron') then raise exception '070 requer pg_cron habilitado antes de aplicar';end if;
 if to_regprocedure('public.rota_068_mover_pedido(bigint,date,text,uuid)') is null or to_regprocedure('public.rota_068h_pendente_base(bigint,date)') is null or to_regclass('public.pedido_entrega_rota') is null then raise exception '070 requer base5751091/068CH_r3';end if;
end$$;
select current_database() banco,(now() at time zone 'America/Sao_Paulo') agora_sp;
commit;
