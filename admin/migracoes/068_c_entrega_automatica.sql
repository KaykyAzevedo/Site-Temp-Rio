-- 068 C: primeira saida da rota = entrega; problema nao devolve para pendentes.
-- Requer057/058/059/061/063 e F2. Nenhuma alteracao no ERP ou confirmacao/foto ficticia.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
select pg_catalog.pg_advisory_xact_lock(5100,68);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
do $$begin
 if to_regclass('public.rota_059_saidas') is null or to_regprocedure('public.rota_063_ler_entregas(bigint[])') is null
 or to_regprocedure('public.rota_068_fora_do_site()') is null
 or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='solidcon_pedidos_erp' and column_name='cliente_nome') then
 raise exception '068 C requer057/058/059/061/063 e068F2. Nada aplicado.';end if;
end$$;

create table if not exists public.pedido_entrega_rota(
 cd_pedido bigint primary key check(cd_pedido between 1 and 999999999999),
 data_entrega date not null check(data_entrega between date '2020-01-01' and date '2100-12-31'),
 cliente_tipo text not null check(cliente_tipo in('cnpj','cpf','indefinido')),
 cliente_nome text check(cliente_nome is null or char_length(cliente_nome)<=150),
 documento text check(documento is null or (cliente_tipo='cnpj' and documento ~ '^[0-9]{14}$')),
 valor_centavos bigint check(valor_centavos is null or valor_centavos between 0 and 999999999999999),
 registrado_em timestamptz not null default pg_catalog.clock_timestamp()
);
create index if not exists pedido_entrega_rota_068_dia on public.pedido_entrega_rota(data_entrega,cd_pedido);
create table if not exists public.pedido_entrega_problema(
 id bigint generated always as identity primary key,
 cd_pedido bigint not null check(cd_pedido between 1 and 999999999999),
 obs text not null check(char_length(obs) between 1 and 300 and btrim(obs)<>'' and obs !~ '[<>[:cntrl:]]'),
 por uuid not null,por_nome text,em timestamptz not null default pg_catalog.clock_timestamp(),
 desfeito_por uuid,desfeito_nome text,desfeito_em timestamptz,
 check((desfeito_por is null)=(desfeito_em is null))
);
create unique index if not exists pedido_entrega_problema_068_ativo on public.pedido_entrega_problema(cd_pedido) where desfeito_em is null;
-- Legado063 pode ter entrega legitima sem foto059; problema nao exige inventar pedido_entrega_rota.
alter table public.pedido_entrega_problema drop constraint if exists pedido_entrega_problema_cd_pedido_fkey;
create table if not exists public.pedido_entrega_problema_requisicao(
 requisicao uuid primary key,cd_pedido bigint not null,acao text not null check(acao in('marcar','desfazer')),
 problema_id bigint references public.pedido_entrega_problema(id),em timestamptz not null default pg_catalog.clock_timestamp()
);
alter table public.pedido_entrega_rota enable row level security;
alter table public.pedido_entrega_problema enable row level security;
alter table public.pedido_entrega_problema_requisicao enable row level security;
revoke all on public.pedido_entrega_rota,public.pedido_entrega_problema,public.pedido_entrega_problema_requisicao from public,anon,authenticated,service_role;
revoke all on sequence public.pedido_entrega_problema_id_seq from public,anon,authenticated,service_role;
grant select on public.pedido_entrega_rota,public.pedido_entrega_problema to authenticated;
drop policy if exists entrega_rota_068_equipe on public.pedido_entrega_rota;
create policy entrega_rota_068_equipe on public.pedido_entrega_rota for select to authenticated using((select public.eh_equipe()));
drop policy if exists entrega_problema_068_equipe on public.pedido_entrega_problema;
create policy entrega_problema_068_equipe on public.pedido_entrega_problema for select to authenticated using((select public.eh_equipe()));

create or replace function public.rota_068_hoje()
returns date language sql stable security invoker set search_path='' as $$select (pg_catalog.now() at time zone 'America/Sao_Paulo')::date$$;
revoke all on function public.rota_068_hoje() from public,anon,authenticated,service_role;

create or replace function public.rota_068_entrega_capturar(p_cds bigint[] default null)
returns void language sql volatile security definer set search_path='' as $$
 insert into public.pedido_entrega_rota(cd_pedido,data_entrega,cliente_tipo,cliente_nome,documento,valor_centavos)
 select s.cd_pedido,s.dia_saida,coalesce(e.cliente_tipo,'indefinido'),
  case when s.dia_saida>=public.rota_068_hoje()-case when e.cliente_tipo='cpf' then 180 else 365 end then e.cliente_nome end,
  case when e.cliente_tipo='cnpj' and e.documento ~ '^[0-9]{14}$' and s.dia_saida>=public.rota_068_hoje()-365 then e.documento end,e.valor_centavos
 from public.rota_059_saidas s left join public.solidcon_pedidos_erp e on e.cd_pedido=s.cd_pedido
 where p_cds is null or s.cd_pedido=any(p_cds)
 on conflict(cd_pedido) do nothing;
$$;
revoke all on function public.rota_068_entrega_capturar(bigint[]) from public,anon,authenticated,service_role;

create or replace function public.rota_068_entrega_item()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform public.rota_068_entrega_capturar(array(select distinct n.cd_pedido from novos068 n));return null;
end$$;
create or replace function public.rota_068_entrega_fechamento()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.estado='fechada' then
  perform public.rota_068_entrega_capturar(array(select i.cd_pedido from public.rota_dia_item i where i.data=new.data and i.removido_em is null));
 end if;return null;
end$$;
revoke all on function public.rota_068_entrega_item(),public.rota_068_entrega_fechamento() from public,anon,authenticated,service_role;
drop trigger if exists rota_068_entrega_item_ins on public.rota_dia_item;
drop trigger if exists rota_068_entrega_item_upd on public.rota_dia_item;
create trigger rota_068_entrega_item_ins after insert on public.rota_dia_item referencing new table as novos068 for each statement execute function public.rota_068_entrega_item();
create trigger rota_068_entrega_item_upd after update on public.rota_dia_item referencing new table as novos068 for each statement execute function public.rota_068_entrega_item();
drop trigger if exists rota_068_entrega_fechamento on public.rota_dia_fechada;
create trigger rota_068_entrega_fechamento after insert or update on public.rota_dia_fechada for each row execute function public.rota_068_entrega_fechamento();
select public.rota_068_entrega_capturar(null);

create or replace function public.rota_068_problema_marcar(p_cd_pedido bigint,p_obs text,p_requisicao uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pedido_entrega_problema; q public.pedido_entrega_problema_requisicao;
 v_obs text:=nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_obs,''),'\s+',' ','g')),'');v_repetido boolean;
begin
 if auth.uid() is null or not coalesce(public.pode_marcar_rota(),false) then raise exception 'somente quem marca rota informa problema' using errcode='42501';end if;
 if p_cd_pedido is null or p_cd_pedido not between 1 and 999999999999 or p_requisicao is null then return pg_catalog.jsonb_build_object('status','erro','motivo','parametro_invalido');end if;
 perform pg_catalog.pg_advisory_xact_lock(5100,5201);perform pg_catalog.pg_advisory_xact_lock(5100,5001);
 select * into q from public.pedido_entrega_problema_requisicao where requisicao=p_requisicao;
 if found then
  if q.cd_pedido<>p_cd_pedido or q.acao<>'marcar' then return pg_catalog.jsonb_build_object('status','erro','motivo','requisicao_invalida');end if;
  return pg_catalog.jsonb_build_object('status','ok','ativa',exists(select 1 from public.pedido_entrega_problema p where p.id=q.problema_id and p.desfeito_em is null),'repetido',true);
 end if;
 if v_obs is null or char_length(v_obs)>300 or v_obs ~ '[<>[:cntrl:]]' then return pg_catalog.jsonb_build_object('status','erro','motivo','observacao_invalida');end if;
 if not exists(select 1 from public.pedido_entrega_rota e where e.cd_pedido=p_cd_pedido)
 and not exists(select 1 from public.pedido_entrega_confirmacao ec where ec.cd_pedido=p_cd_pedido and ec.desfeito_em is null)
 then return pg_catalog.jsonb_build_object('status','erro','motivo','pedido_sem_saida');end if;
 select * into r from public.pedido_entrega_problema where cd_pedido=p_cd_pedido and desfeito_em is null;
 v_repetido:=found;
 if not v_repetido then
  insert into public.pedido_entrega_problema(cd_pedido,obs,por,por_nome) values(p_cd_pedido,v_obs,auth.uid(),public.rota_050_nome(auth.uid())) returning * into r;
 end if;
 insert into public.pedido_entrega_problema_requisicao(requisicao,cd_pedido,acao,problema_id) values(p_requisicao,p_cd_pedido,'marcar',r.id);
 return pg_catalog.jsonb_build_object('status','ok','ativa',true,'repetido',v_repetido);
end$$;

create or replace function public.rota_068_problema_desfazer(p_cd_pedido bigint,p_requisicao uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pedido_entrega_problema;q public.pedido_entrega_problema_requisicao;v_alterado boolean;
begin
 if auth.uid() is null or not coalesce(public.eh_admin(),false) then raise exception 'somente admin desfaz problema' using errcode='42501';end if;
 if p_cd_pedido is null or p_cd_pedido not between 1 and 999999999999 or p_requisicao is null then return pg_catalog.jsonb_build_object('status','erro','motivo','parametro_invalido');end if;
 perform pg_catalog.pg_advisory_xact_lock(5100,5201);perform pg_catalog.pg_advisory_xact_lock(5100,5001);
 select * into q from public.pedido_entrega_problema_requisicao where requisicao=p_requisicao;
 if found then
  if q.cd_pedido<>p_cd_pedido or q.acao<>'desfazer' then return pg_catalog.jsonb_build_object('status','erro','motivo','requisicao_invalida');end if;
  return pg_catalog.jsonb_build_object('status','ok','alterado',false,'repetido',true);
 end if;
 select * into r from public.pedido_entrega_problema where cd_pedido=p_cd_pedido and desfeito_em is null for update;
 v_alterado:=found;
 if v_alterado then update public.pedido_entrega_problema set desfeito_por=auth.uid(),desfeito_nome=public.rota_050_nome(auth.uid()),desfeito_em=pg_catalog.clock_timestamp() where id=r.id;end if;
 insert into public.pedido_entrega_problema_requisicao(requisicao,cd_pedido,acao,problema_id) values(p_requisicao,p_cd_pedido,'desfazer',r.id);
 return pg_catalog.jsonb_build_object('status','ok','alterado',v_alterado,'repetido',false);
end$$;
revoke all on function public.rota_068_problema_marcar(bigint,text,uuid),public.rota_068_problema_desfazer(bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.rota_068_problema_marcar(bigint,text,uuid),public.rota_068_problema_desfazer(bigint,uuid) to authenticated;

create or replace function public.rota_068_entregas(p_desde date,p_ate date)
returns table(cd_pedido bigint,data_entrega date,status text,obs text,por_nome text,em timestamptz,cliente_tipo text,cliente_nome text,documento text,valor_centavos bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'')<>'service_role' and (auth.uid() is null or not coalesce(public.eh_equipe(),false)) then raise exception 'somente equipe le entregas' using errcode='42501';end if;
 if p_desde is null or p_ate is null or p_ate<p_desde or p_ate-p_desde>366 then raise exception 'intervalo invalido' using errcode='22023';end if;
 return query with canonica as (
  select er.cd_pedido,er.data_entrega,er.cliente_tipo,er.cliente_nome,er.documento,er.valor_centavos from public.pedido_entrega_rota er
  union all
  -- C068-R1: preservar prova administrativa063 ativa, com sua data real; nao criar saida059/canhoto ficticio.
  select ec.cd_pedido,(ec.confirmado_em at time zone 'America/Sao_Paulo')::date,
   coalesce(src.cliente_tipo,'indefinido'),src.cliente_nome,
   case when src.cliente_tipo='cnpj' then src.documento end,src.valor_centavos
  from public.pedido_entrega_confirmacao ec left join public.solidcon_pedidos_erp src on src.cd_pedido=ec.cd_pedido
  where ec.desfeito_em is null and not exists(select 1 from public.pedido_entrega_rota er where er.cd_pedido=ec.cd_pedido)
 ) select e.cd_pedido,e.data_entrega,case when p.id is null then 'entregue' else 'problema' end,
 p.obs,p.por_nome,p.em,e.cliente_tipo,e.cliente_nome,e.documento,e.valor_centavos
 from canonica e left join public.pedido_entrega_problema p on p.cd_pedido=e.cd_pedido and p.desfeito_em is null
 where e.data_entrega between p_desde and p_ate
 and not exists(select 1 from public.rota_pedido_ignorado g where g.cd_pedido=e.cd_pedido and g.alcance='site')
 order by e.data_entrega,e.cd_pedido;
end$$;
revoke all on function public.rota_068_entregas(date,date) from public,anon,authenticated,service_role;
grant execute on function public.rota_068_entregas(date,date) to authenticated,service_role;

-- Projecao063 usada pelo core/Edge para EXCLUIR da fila: inclui problema, pois nao volta sozinho.
create or replace function public.rota_063_ler_entregas(p_cds bigint[])
returns table(cd_pedido bigint,id bigint,confirmado_em timestamptz,confirmado_nome text)
language plpgsql stable security definer set search_path='' as $$begin
 if coalesce(auth.role(),'')<>'service_role' and (auth.uid() is null or not coalesce(public.eh_equipe(),false)) then raise exception 'somente equipe le status de entrega' using errcode='42501';end if;
 if p_cds is null or pg_catalog.cardinality(p_cds)>300 or exists(select 1 from pg_catalog.unnest(p_cds) x where x is null or x not between 1 and 999999999999) then raise exception 'pedidos invalidos' using errcode='22023';end if;
 return query select e.cd_pedido,e.cd_pedido,e.data_entrega::timestamp at time zone 'America/Sao_Paulo',null::text from public.pedido_entrega_rota e where e.cd_pedido=any(p_cds)
 union all
 select ec.cd_pedido,ec.id,ec.confirmado_em,ec.confirmado_nome from public.pedido_entrega_confirmacao ec
 where ec.cd_pedido=any(p_cds) and ec.desfeito_em is null
 and not exists(select 1 from public.pedido_entrega_rota e where e.cd_pedido=ec.cd_pedido);
end$$;
-- Recebido virou automatico: nenhuma chamada antiga pode criar/desfazer prova manual063.
revoke execute on function public.rota_063_confirmar_entrega(bigint,text,uuid),public.rota_063_desfazer_entrega(bigint) from public,anon,authenticated,service_role;

create or replace function public.rota_068_entregas_limpar()
returns integer language plpgsql security definer set search_path='' as $$declare n integer;begin
 update public.pedido_entrega_rota e set cliente_nome=null,documento=null where (e.cliente_nome is not null or e.documento is not null)
 and e.data_entrega<public.rota_068_hoje()-case when e.cliente_tipo='cpf' then 180 else 365 end;
 get diagnostics n=row_count;return n;
end$$;
revoke all on function public.rota_068_entregas_limpar() from public,anon,authenticated,service_role;
select public.rota_068_entregas_limpar();
do $$begin if exists(select 1 from pg_extension where extname='pg_cron') then
 execute $j$select cron.unschedule(jobid) from cron.job where jobname='rota-068-entregas-limpeza'$j$;
 execute $j$select cron.schedule('rota-068-entregas-limpeza','41 6 * * *','select public.rota_068_entregas_limpar()')$j$;
end if;end$$;
-- Corpo055/063 ajustado abaixo: saida persistida e saida059 sempre fora de pendentes, inclusive com problema.
create or replace function public.rota_055_pendente(p_cd bigint,p_dia date)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.solidcon_pedidos_erp p
   cross join lateral (select coalesce(p.dt_saida,p.dt_nota,p.dt_atendido) as em) fat
   cross join lateral (select coalesce((select pg_catalog.make_time(extract(hour from c.hora_saida)::integer,extract(minute from c.hora_saida)::integer,0) from public.rota_config c where c.id=1),time '07:00') as hora) cfg
   where p.cd_pedido=p_cd
   and not exists(select from public.pedido_entrega_confirmacao ec where ec.cd_pedido=p.cd_pedido and ec.desfeito_em is null)
   and not exists(select 1 from public.pedido_entrega_rota er where er.cd_pedido=p.cd_pedido)
   and not exists(select 1 from public.rota_059_saidas sr where sr.cd_pedido=p.cd_pedido)
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
