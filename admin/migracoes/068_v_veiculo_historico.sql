-- 068V sobre6a42d0d: semveiculo=null; correcao historica auditada sem inventar entrega/foto.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
select pg_advisory_xact_lock(5100,6822);select pg_advisory_xact_lock(5100,5201);select pg_advisory_xact_lock(5100,5001);select pg_advisory_xact_lock(5100,4601);
create table if not exists public.rota_068v_backup(nome text primary key,def text not null);
alter table public.rota_068v_backup enable row level security;
revoke all on public.rota_068v_backup from public,anon,authenticated,service_role;
insert into public.rota_068v_backup select n,pg_get_functiondef(n::regprocedure) from unnest(array['public.rota_054_padrao_separando()','public.rota_070_estado(bigint)','public.rota_066_sugestoes(date)','public.rota_068_mover_pedido(bigint,date,text,uuid)','public.rota_070_fechavel(bigint,date,text,boolean)']) n on conflict do nothing;
-- Bandeja nao exige veiculo. Destino comdia continua exigindo veiculo explicito valido.
do $$declare body text;begin
 select replace(def,'if not exists(select 1 from public.rota_veiculos z where z.id=v and z.ativo) then','if (p_dia is not null or v is not null) and not exists(select 1 from public.rota_veiculos z where z.id=v and z.ativo) then') into body from public.rota_068v_backup where nome='public.rota_068_mover_pedido(bigint,date,text,uuid)';execute body;
end$$;
-- Fechamento/054 revalidam a escolha tambem em payload direto; nao basta o filtro do core.
do $$declare body text;begin
 select replace(def,'public.rota_070_pronto(p_cd) and not exists','public.rota_070_pronto(p_cd) and coalesce(public.rota_070_veiculo(p_cd)=p_v,false) and not exists') into body from public.rota_068v_backup where nome='public.rota_070_fechavel(bigint,date,text,boolean)';execute body;
end$$;
-- Um unico ponto de fallback antigo alimentava054/065/066/068A/H/070. Nome preservado, valor implicito removido.
create or replace function public.rota_054_padrao_separando() returns text language sql immutable set search_path='' as $$select null::text$$;
revoke all on function public.rota_054_padrao_separando() from public,anon,authenticated,service_role;
create table if not exists public.rota_068v_veiculo_log(
 id bigint generated always as identity primary key,cd_pedido bigint not null check(cd_pedido between 1 and 999999999999),
 veiculo_de text,veiculo_para text not null references public.rota_veiculos(id),motivo text not null check(char_length(motivo) between 1 and 200 and motivo !~ '[<>[:cntrl:]]'),por uuid not null,em timestamptz not null default clock_timestamp());
create index if not exists rota_068v_log_cd on public.rota_068v_veiculo_log(cd_pedido,em desc);
alter table public.rota_068v_veiculo_log enable row level security;
revoke all on public.rota_068v_veiculo_log from public,anon,authenticated,service_role;
revoke all on sequence public.rota_068v_veiculo_log_id_seq from public,anon,authenticated,service_role;
grant select on public.rota_068v_veiculo_log to authenticated;
drop policy if exists rota_068v_log_equipe on public.rota_068v_veiculo_log;
create policy rota_068v_log_equipe on public.rota_068v_veiculo_log for select to authenticated using((select public.eh_equipe()));
-- Resolucao para historico: foto real do dia > plano real do dia > pedido > cliente. Nenhum default/geo.
create or replace function public.rota_068v_veiculo(p_cd bigint,p_dia date default null) returns text language sql stable security definer set search_path='' as $$
 select coalesce(
 (select p.veiculo_id from public.rota_plano_semana p where p.cd_pedido=p_cd and not p.removido and (p_dia is null or p.dia=p_dia)),
 (select m.veiculo from public.rota_pedido_veiculo m where m.cd_pedido=p_cd),
 (select c.veiculo from public.rota_cliente_veiculo c where c.documento=coalesce((select e.documento from public.solidcon_pedidos_erp e where e.cd_pedido=p_cd),(select e.documento from public.pedido_entrega_rota e where e.cd_pedido=p_cd))),
 (select i.veiculo_id from public.rota_dia_item i join public.rota_dia_fechada f on f.data=i.data where i.cd_pedido=p_cd and i.removido_em is null and f.estado='fechada' and not f.automatico and (p_dia is null or i.data=p_dia) order by i.data desc limit 1),
 (select h.veiculo_id from public.rota_066_historico h where h.cd_pedido=p_cd and h.fonte='plano' and h.dia=p_dia))
$$;
create or replace function public.rota_068_veiculo_historico_ler(p_cds bigint[])
returns table(cd_pedido bigint,veiculo_id text,veiculo_efetivo text,sem_veiculo boolean,dia_foto date,na_foto boolean)
language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or not coalesce(public.eh_equipe(),false) then raise exception 'somente equipe' using errcode='42501';end if;
 if p_cds is null or cardinality(p_cds)>300 or exists(select 1 from unnest(p_cds) c where c is null or c not between 1 and 999999999999) then raise exception 'pedidos invalidos' using errcode='22023';end if;
 return query select c,v.v,v.v,v.v is null,f.dia,f.dia is not null from (select distinct x c from unnest(p_cds) x) z
 cross join lateral(select public.rota_068v_veiculo(c) v) v
 left join lateral(select max(i.data) dia from public.rota_dia_item i join public.rota_dia_fechada f on f.data=i.data where i.cd_pedido=c and i.removido_em is null and f.estado='fechada') f on true;
end$$;
create or replace function public.rota_068v_semana_recebidos(p_inicio date)
returns table(cd_pedido bigint,dia date,veiculo_id text,sem_veiculo boolean,na_foto boolean,status text,obs text,por_nome text,em timestamptz,cliente_tipo text,cliente_nome text,valor_centavos bigint)
language plpgsql stable security definer set search_path='' as $$declare hoje date:=public.rota_070_hoje();begin
 if auth.uid() is null or not coalesce(public.eh_equipe(),false) then raise exception 'somente equipe' using errcode='42501';end if;
 if p_inicio is null or p_inicio<>hoje-(extract(isodow from hoje)::integer-1) then raise exception 'somente semana atual' using errcode='22023';end if;
 return query select e.cd_pedido,e.data_entrega,v.v,v.v is null,exists(select 1 from public.rota_dia_item i where i.cd_pedido=e.cd_pedido and i.data=e.data_entrega and i.removido_em is null),e.status,e.obs,e.por_nome,e.em,e.cliente_tipo,e.cliente_nome,e.valor_centavos
 from public.rota_068_entregas(p_inicio,p_inicio+5) e cross join lateral(select public.rota_068v_veiculo(e.cd_pedido,e.data_entrega) v) v
 where e.data_entrega<=hoje and not exists(select 1 from public.rota_dia_item i where i.cd_pedido=e.cd_pedido and i.data=e.data_entrega and i.removido_em is not null)
 order by e.data_entrega,e.cd_pedido;
end$$;
create or replace function public.rota_068v_provas(p_cd bigint) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('entregue',public.rota_070_entregue(p_cd),'pendente',public.rota_055_pendente(p_cd,public.rota_070_hoje()),'recebido',public.rota_068_recebido_dia(p_cd),
 'C',(select to_jsonb(e) from public.pedido_entrega_rota e where e.cd_pedido=p_cd),
 'H',(select to_jsonb(e) from public.rota_068h_reprogramacao e where e.cd_pedido=p_cd),
 '063',(select jsonb_agg(to_jsonb(e) order by e.id) from public.pedido_entrega_confirmacao e where e.cd_pedido=p_cd),
 'canhoto',(select jsonb_agg(to_jsonb(e) order by e.id) from public.pedido_canhoto e where e.cd_pedido=p_cd),
 'problema',(select jsonb_agg(to_jsonb(e) order by e.id) from public.pedido_entrega_problema e where e.cd_pedido=p_cd))
$$;
create or replace function public.rota_068_veiculo_historico(p_cd bigint,p_veiculo text,p_motivo text)
returns jsonb language plpgsql security definer set search_path='' as $$declare antes jsonb;de text;dia date;doc text;log_id bigint;mudou boolean;mot text;begin
 if auth.uid() is null or not coalesce(public.pode_marcar_rota(),false) then raise exception 'sem permissao' using errcode='42501';end if;
 if p_cd is null or p_cd not between 1 and 999999999999 then return jsonb_build_object('status','erro','motivo','parametro_invalido');end if;
 mot:=btrim(p_motivo);
 if mot is null or char_length(mot) not between 1 and 200 or p_motivo ~ '[<>[:cntrl:]]' then return jsonb_build_object('status','erro','motivo','motivo_invalido');end if;
 if p_veiculo is null or not exists(select 1 from public.rota_veiculos v where v.id=p_veiculo and v.ativo) then return jsonb_build_object('status','erro','motivo','veiculo_invalido');end if;
 perform pg_advisory_xact_lock(5100,5201);perform pg_advisory_xact_lock(5100,5001);perform pg_advisory_xact_lock(5100,4601);
 if not exists(select 1 from public.solidcon_pedidos_erp where cd_pedido=p_cd) and not exists(select 1 from public.pedido_entrega_rota where cd_pedido=p_cd) and not exists(select 1 from public.pedido_entrega_confirmacao where cd_pedido=p_cd and desfeito_em is null) then return jsonb_build_object('status','erro','motivo','pedido_nao_encontrado');end if;
 antes:=public.rota_068v_provas(p_cd);de:=public.rota_068v_veiculo(p_cd);dia:=public.rota_068_recebido_dia(p_cd);
 mudou:=not exists(select 1 from public.rota_pedido_veiculo where cd_pedido=p_cd and veiculo=p_veiculo)

 or exists(select 1 from public.rota_plano_semana where cd_pedido=p_cd and veiculo_id<>p_veiculo);
 if not mudou then return jsonb_build_object('status','ok','cd_pedido',p_cd,'veiculo_de',de,'veiculo_para',p_veiculo,'alterado',false,'log_id',null);end if;
 insert into public.rota_pedido_veiculo as m(cd_pedido,veiculo) values(p_cd,p_veiculo) on conflict(cd_pedido) do update set veiculo=excluded.veiculo;
 -- Foto050 e suas revisoes permanecem intactas; leituraB sobrepoe a escolha explicita.
 update public.rota_plano_semana set veiculo_id=p_veiculo where cd_pedido=p_cd and veiculo_id<>p_veiculo;
 -- Fonte foto066 representa prova historica real C/063; nao grava saida/foto050 nem status do pedido.
 select coalesce((select documento from public.solidcon_pedidos_erp where cd_pedido=p_cd),(select documento from public.pedido_entrega_rota where cd_pedido=p_cd)) into doc;
 update public.rota_066_historico set veiculo_id=p_veiculo,registrado_em=now() where cd_pedido=p_cd;
 if dia is not null then insert into public.rota_066_historico as h(cd_pedido,fonte,dia,documento,veiculo_id) values(p_cd,'foto',dia,doc,p_veiculo)
 on conflict(cd_pedido,fonte) do update set veiculo_id=excluded.veiculo_id,documento=coalesce(h.documento,excluded.documento),registrado_em=now();end if;
 if antes is distinct from public.rota_068v_provas(p_cd) then raise exception '068V preservacao das provas falhou: transacao cancelada' using errcode='40001';end if;
 insert into public.rota_068v_veiculo_log(cd_pedido,veiculo_de,veiculo_para,motivo,por) values(p_cd,de,p_veiculo,mot,auth.uid()) returning id into log_id;
 return jsonb_build_object('status','ok','cd_pedido',p_cd,'veiculo_de',de,'veiculo_para',p_veiculo,'alterado',true,'log_id',log_id);
end$$;
-- Memoria066 consulta apenas escolhas reais. Dados antigos permanecem na tabela, sem treinamento por fallback.
create or replace function public.rota_068v_memoria() returns setof public.rota_066_historico language sql stable security definer set search_path='' as $$
 select h.cd_pedido,h.fonte,h.dia,h.documento,case when h.fonte='plano' then h.veiculo_id else public.rota_068v_veiculo(h.cd_pedido,h.dia) end,h.registrado_em
 from public.rota_066_historico h where h.fonte='plano' or public.rota_068v_veiculo(h.cd_pedido,h.dia) is not null
$$;
do $$declare body text;begin
 select replace(def,'from public.rota_066_historico h','from public.rota_068v_memoria() h') into body from public.rota_068v_backup where nome='public.rota_066_sugestoes(date)';execute body;
end$$;
-- 065.pedidos_estado herda JSON070; RPC070 tabular/assinatura nao muda.
do $$declare body text;begin
 select replace(def,'CREATE OR REPLACE FUNCTION public.rota_070_estado(','CREATE OR REPLACE FUNCTION public.rota_068v_estado_base(') into body from public.rota_068v_backup where nome='public.rota_070_estado(bigint)';execute body;
end$$;
create or replace function public.rota_070_estado(p_cd bigint) returns jsonb language sql stable security definer set search_path='' as $$select public.rota_068v_estado_base(p_cd)||jsonb_build_object('veiculo_id',public.rota_070_veiculo(p_cd),'sem_veiculo',public.rota_070_veiculo(p_cd) is null)$$;
revoke all on function public.rota_068v_memoria(),public.rota_068v_veiculo(bigint,date),public.rota_068v_provas(bigint),public.rota_068v_estado_base(bigint),public.rota_068_veiculo_historico(bigint,text,text),public.rota_068_veiculo_historico_ler(bigint[]),public.rota_068v_semana_recebidos(date) from public,anon,authenticated,service_role;
grant execute on function public.rota_068_veiculo_historico(bigint,text,text),public.rota_068_veiculo_historico_ler(bigint[]),public.rota_068v_semana_recebidos(date) to authenticated;
notify pgrst,'reload schema';
commit;
