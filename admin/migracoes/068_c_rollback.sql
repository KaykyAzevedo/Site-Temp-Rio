-- 068 C rollback idempotente. Preserva snapshot/auditoria/requisicoes e a limpeza de dados pessoais.
-- Desfazer D antes de C. Nenhum acervo e apagado.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
select pg_catalog.pg_advisory_xact_lock(5100,68);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
do $$begin if to_regprocedure('public.rota_068_historico(date)') is not null then raise exception 'reverta068D antes de068C';end if;end$$;
drop trigger if exists rota_068_entrega_item_ins on public.rota_dia_item;
drop trigger if exists rota_068_entrega_item_upd on public.rota_dia_item;
drop trigger if exists rota_068_entrega_fechamento on public.rota_dia_fechada;
drop function if exists public.rota_068_entrega_item();
drop function if exists public.rota_068_entrega_fechamento();
drop function if exists public.rota_068_entrega_capturar(bigint[]);
drop function if exists public.rota_068_problema_marcar(bigint,text,uuid);
drop function if exists public.rota_068_problema_desfazer(bigint,uuid);
drop function if exists public.rota_068_entregas(date,date);
create or replace function public.rota_063_ler_entregas(p_cds bigint[])
returns table(cd_pedido bigint,id bigint,confirmado_em timestamptz,confirmado_nome text)
language plpgsql stable security definer set search_path=''
as $$begin
 if coalesce(auth.role(),'')<>'service_role' and (auth.uid() is null or not coalesce(public.eh_equipe(),false)) then
   raise exception 'somente equipe le status de entrega' using errcode='42501';end if;
 if p_cds is null or pg_catalog.cardinality(p_cds)>300 or exists(select from pg_catalog.unnest(p_cds) x where x is null or x not between 1 and 999999999999) then
   raise exception 'pedidos invalidos' using errcode='22023';end if;
 return query select c.cd_pedido,c.id,c.confirmado_em,c.confirmado_nome from public.pedido_entrega_confirmacao c where c.cd_pedido=any(p_cds) and c.desfeito_em is null;
end$$;
revoke all on function public.rota_063_ler_entregas(bigint[]) from public,anon,authenticated,service_role;
grant execute on function public.rota_063_ler_entregas(bigint[]) to authenticated,service_role;

create or replace function public.rota_055_pendente(p_cd bigint,p_dia date)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.solidcon_pedidos_erp p
   cross join lateral (select coalesce(p.dt_saida,p.dt_nota,p.dt_atendido) as em) fat
   cross join lateral (select coalesce((select pg_catalog.make_time(extract(hour from c.hora_saida)::integer,extract(minute from c.hora_saida)::integer,0) from public.rota_config c where c.id=1),time '07:00') as hora) cfg
   where p.cd_pedido=p_cd
   and not exists(select from public.pedido_entrega_confirmacao ec where ec.cd_pedido=p.cd_pedido and ec.desfeito_em is null)
   and not exists(select 1 from public.pedido_canhoto c where c.cd_pedido=p.cd_pedido and c.substituido_em is null)
   and (p.etapa in ('aberto','na_carga','separando','separado','conferido')
     or (p.etapa in ('saiu','atendido') and fat.em is not null
       and ((select c.canhoto_desde from public.rota_config c where c.id=1) is null
         or fat.em>=(select c.canhoto_desde from public.rota_config c where c.id=1))
       and greatest((select s.dia_saida from public.rota_059_saidas s where s.cd_pedido=p.cd_pedido),
         (fat.em at time zone 'America/Sao_Paulo')::date +
         case when (fat.em at time zone 'America/Sao_Paulo')::time > cfg.hora then 1 else 0 end)>=p_dia-7)))
$$;
grant execute on function public.rota_063_confirmar_entrega(bigint,text,uuid),public.rota_063_desfazer_entrega(bigint) to authenticated;
notify pgrst,'reload schema';
commit;
