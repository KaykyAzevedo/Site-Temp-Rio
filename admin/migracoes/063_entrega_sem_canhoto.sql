-- 063: prova administrativa independente da foto. Nenhum pedido e confirmado nesta migracao.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
select pg_catalog.pg_advisory_xact_lock(5100,63);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
do $$begin
 if to_regprocedure('public.rota_061_auto_aberta(date)') is null or to_regprocedure('public.eh_admin()') is null then
   raise exception '063 requer061 e eh_admin(). Nada aplicado.';
 end if;
end$$;
create table if not exists public.pedido_entrega_confirmacao(
 id bigint generated always as identity primary key,
 cd_pedido bigint not null check(cd_pedido between 1 and 999999999999),
 requisicao uuid not null unique,
 confirmado_por uuid not null,confirmado_nome text,confirmado_em timestamptz not null default pg_catalog.clock_timestamp(),
 motivo text check(motivo is null or pg_catalog.length(motivo)<=300),
 desfeito_por uuid,desfeito_nome text,desfeito_em timestamptz,
 check((desfeito_por is null)=(desfeito_em is null))
);
create unique index if not exists entrega_063_ativa on public.pedido_entrega_confirmacao(cd_pedido) where desfeito_em is null;
alter table public.pedido_entrega_confirmacao enable row level security;
revoke all on public.pedido_entrega_confirmacao from public,anon,authenticated,service_role;
revoke all on sequence public.pedido_entrega_confirmacao_id_seq from public,anon,authenticated,service_role;
grant select on public.pedido_entrega_confirmacao to authenticated;
drop policy if exists entrega_063_admin_le on public.pedido_entrega_confirmacao;
create policy entrega_063_admin_le on public.pedido_entrega_confirmacao for select to authenticated using((select public.eh_admin()));

create or replace function public.rota_063_confirmar_entrega(p_cd bigint,p_motivo text,p_requisicao uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$declare r public.pedido_entrega_confirmacao;u uuid:=auth.uid();begin
 if u is null or not coalesce(public.pode_marcar_rota(),false) then raise exception 'somente quem marca rota confirma entrega' using errcode='42501';end if;
 if p_cd is null or p_cd not between 1 and 999999999999 or p_requisicao is null or pg_catalog.length(p_motivo)>300 then
   raise exception 'confirmacao invalida' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(5100,5201);perform pg_catalog.pg_advisory_xact_lock(5100,5001);
 select * into r from public.pedido_entrega_confirmacao where requisicao=p_requisicao;
 if found then
   if r.cd_pedido<>p_cd then raise exception 'requisicao pertence a outro pedido' using errcode='22023';end if;
   return pg_catalog.jsonb_build_object('id',r.id,'ativa',r.desfeito_em is null,'repetido',true);
 end if;
 select * into r from public.pedido_entrega_confirmacao where cd_pedido=p_cd and desfeito_em is null;
 if found then return pg_catalog.jsonb_build_object('id',r.id,'ativa',true,'repetido',true);end if;
 if not exists(select from public.solidcon_pedidos_erp p where p.cd_pedido=p_cd and p.etapa in('saiu','atendido')
   and coalesce(p.dt_saida,p.dt_nota,p.dt_atendido) is not null) then
   raise exception 'pedido nao faturado ou nao encontrado: atualize o painel' using errcode='P0002';
 end if;
 if exists(select from public.pedido_canhoto c where c.cd_pedido=p_cd and c.substituido_em is null) then
   raise exception 'pedido ja possui canhoto ativo: atualize o painel' using errcode='40001';end if;
 insert into public.pedido_entrega_confirmacao(cd_pedido,requisicao,confirmado_por,confirmado_nome,motivo)
 values(p_cd,p_requisicao,u,public.rota_050_nome(u),nullif(pg_catalog.btrim(p_motivo),'')) returning * into r;
 return pg_catalog.jsonb_build_object('id',r.id,'ativa',true,'repetido',false);
end$$;
revoke all on function public.rota_063_confirmar_entrega(bigint,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.rota_063_confirmar_entrega(bigint,text,uuid) to authenticated;

create or replace function public.rota_063_desfazer_entrega(p_id bigint)
returns jsonb language plpgsql security definer set search_path=''
as $$declare r public.pedido_entrega_confirmacao;u uuid:=auth.uid();begin
 if u is null or not coalesce(public.eh_admin(),false) then raise exception 'somente admin desfaz entrega' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(5100,5201);perform pg_catalog.pg_advisory_xact_lock(5100,5001);
 select * into r from public.pedido_entrega_confirmacao where id=p_id for update;
 if not found then raise exception 'confirmacao nao encontrada' using errcode='P0002';end if;
 if r.desfeito_em is not null then return pg_catalog.jsonb_build_object('id',r.id,'ativa',false,'repetido',true);end if;
 update public.pedido_entrega_confirmacao set desfeito_por=u,desfeito_nome=public.rota_050_nome(u),desfeito_em=pg_catalog.clock_timestamp() where id=p_id;
 return pg_catalog.jsonb_build_object('id',r.id,'ativa',false,'repetido',false);
end$$;
revoke all on function public.rota_063_desfazer_entrega(bigint) from public,anon,authenticated,service_role;
grant execute on function public.rota_063_desfazer_entrega(bigint) to authenticated;

-- Projecao minima para planejamento: equipe recebe apenas status/data dos pedidos ja carregados.
-- Auditoria completa (pessoas/motivo/desfazer) continua na tabela com RLS exclusivamente admin.
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
notify pgrst,'reload schema';
commit;
