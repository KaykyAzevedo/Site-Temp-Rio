-- 070: base5751091. Decisoes TL26/11 revisaveis pelo dono. Sem backfill legado.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
select pg_advisory_xact_lock(5100,35);
select pg_advisory_xact_lock(5100,5201);
select pg_advisory_xact_lock(5100,5001);
select pg_advisory_xact_lock(5100,4601);
do $$begin
 if to_regprocedure('public.rota_068_mover_pedido(bigint,date,text,uuid)') is null or to_regprocedure('public.rota_068h_pendente_base(bigint,date)') is null then raise exception '070 requer068CH_r3';end if;
end$$;
alter table public.rota_config add column if not exists previsao_definitiva_070 boolean not null default false;
update public.rota_config set previsao_definitiva_070=true where id=1;
create table if not exists public.rota_070_backup(nome text primary key,def text not null);
create table if not exists public.rota_070_prontidao(cd_pedido bigint primary key,pronto_erp boolean not null,pronto_desde timestamptz not null,visto_em timestamptz not null);
create table if not exists public.rota_070_saida(cd_pedido bigint primary key,data_saida date not null,em timestamptz not null default now(),por uuid not null);
create table if not exists public.rota_070_definitiva(dia date primary key,origem text not null check(origem in('manual','virada')),versao bigint not null check(versao>0),confirmada_em timestamptz not null default now(),por uuid);
create table if not exists public.rota_070_reserva(dia date not null references public.rota_070_definitiva(dia),cd_pedido bigint not null,veiculo_id text not null,ordem integer,pronto_ao_reservar boolean not null default true check(pronto_ao_reservar),invalidada_em timestamptz,motivo text,primary key(dia,cd_pedido));
create index if not exists rota_070_reserva_pedido on public.rota_070_reserva(cd_pedido,dia);
create table if not exists public.rota_070_recebimento(cd_pedido bigint not null,dia date not null,em timestamptz not null default now(),primary key(cd_pedido,dia));
create table if not exists public.rota_070_requisicao(requisicao uuid primary key,entrada jsonb not null,resultado jsonb not null,por uuid not null,em timestamptz not null default now());
create table if not exists public.rota_070_politica(id integer primary key check(id=1),inicio date not null,dias_recebidos integer not null default 1 check(dias_recebidos in(0,1)),ultimo_dia date);
insert into public.rota_070_politica(id,inicio,ultimo_dia) values(1,(now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date) on conflict do nothing;
-- Nenhuma FK ao snapshot ERP: DELETE+INSERT da coleta nao apaga memoria de prontidao/marca/reserva.
do $$declare t text;begin foreach t in array array['rota_070_backup','rota_070_prontidao','rota_070_saida','rota_070_definitiva','rota_070_reserva','rota_070_recebimento','rota_070_requisicao','rota_070_politica'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
end loop;end$$;
insert into public.rota_070_backup(nome,def)
select n,pg_get_functiondef(n::regprocedure) from unnest(array[
 'public.rota_068_pedido_entregue(bigint)','public.rota_065_ler_semana(date)',
 'public.rota_050_ajustar(text,bigint[],text,jsonb)','public.rota_050_fechar_hoje(jsonb,uuid,boolean)','public.rota_050_fechar_auto(jsonb)',
 'public.rota_050_gravar_itens(date,jsonb,uuid)','public.rota_065_aplicar_plano(date,jsonb)',
 'public.rota_054_candidatos(date)','public.rota_054_incluir(date,integer,jsonb)']) n on conflict do nothing;

create or replace function public.rota_070_agora() returns timestamptz language sql stable set search_path='' as $$select now()$$;
create or replace function public.rota_070_hoje() returns date language sql stable set search_path='' as $$select (public.rota_070_agora() at time zone 'America/Sao_Paulo')::date$$;
create or replace function public.rota_070_travas() returns void language plpgsql set search_path='' as $$begin
 perform pg_advisory_xact_lock(5100,5201);perform pg_advisory_xact_lock(5100,5001);perform pg_advisory_xact_lock(5100,4601);
end$$;
create or replace function public.rota_070_autorizar(p_escrita boolean) returns void language plpgsql stable security definer set search_path='' as $$begin
 if not p_escrita and coalesce(auth.role(),'')='service_role' then return;end if;
 if auth.uid() is null or not coalesce(case when p_escrita then public.pode_marcar_rota() else public.eh_equipe() end,false) then raise exception 'sem permissao070' using errcode='42501';end if;
end$$;
create or replace function public.rota_070_historico_em(p_cd bigint) returns date language sql stable security definer set search_path='' as $$
 select public.rota_068_recebido_dia(p_cd)+case when exists(select 1 from public.rota_070_recebimento r where r.cd_pedido=p_cd and r.dia=public.rota_068_recebido_dia(p_cd)) then (select dias_recebidos from public.rota_070_politica where id=1) else 1 end
$$;
create or replace function public.rota_070_entregue(p_cd bigint) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.rota_070_historico_em(p_cd)<=public.rota_070_hoje(),false)
 and not exists(select 1 from public.pedido_entrega_problema p where p.cd_pedido=p_cd and p.desfeito_em is null)
 and not exists(select 1 from public.rota_068h_reprogramacao r where r.cd_pedido=p_cd and r.ativa)
$$;
create or replace function public.rota_068_pedido_entregue(p_cd bigint) returns boolean language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or not coalesce(public.eh_equipe(),false) then raise exception 'somente equipe le historico' using errcode='42501';end if;
 return public.rota_070_entregue(p_cd);
end$$;
create or replace function public.rota_070_erp_pronto(p_etapa text,p_conferencia timestamptz,p_faturamento timestamptz) returns boolean language sql immutable set search_path='' as $$
 select coalesce((p_etapa='conferido' and p_conferencia is not null) or (p_etapa in('saiu','atendido') and p_faturamento is not null),false)
$$;
insert into public.rota_070_prontidao(cd_pedido,pronto_erp,pronto_desde,visto_em)
select cd_pedido,public.rota_070_erp_pronto(etapa,dt_conferencia,coalesce(dt_saida,dt_nota,dt_atendido)),coalesce(atualizado_em,public.rota_070_agora()),public.rota_070_agora() from public.solidcon_pedidos_erp on conflict do nothing;
create or replace function public.rota_070_observar_erp() returns trigger language plpgsql security definer set search_path='' as $$declare v boolean;begin
 perform pg_advisory_xact_lock(5100,5201);
 v:=public.rota_070_erp_pronto(new.etapa,new.dt_conferencia,coalesce(new.dt_saida,new.dt_nota,new.dt_atendido));
 insert into public.rota_070_prontidao as r(cd_pedido,pronto_erp,pronto_desde,visto_em) values(new.cd_pedido,v,public.rota_070_agora(),public.rota_070_agora())
 on conflict(cd_pedido) do update set pronto_erp=excluded.pronto_erp,pronto_desde=case when r.pronto_erp and excluded.pronto_erp then r.pronto_desde else excluded.pronto_desde end,visto_em=excluded.visto_em;
 return null;
end$$;
drop trigger if exists rota_070_observar_erp on public.solidcon_pedidos_erp;
create trigger rota_070_observar_erp after insert or update on public.solidcon_pedidos_erp for each row execute function public.rota_070_observar_erp();
create or replace function public.rota_070_pronto(p_cd bigint) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.solidcon_pedidos_erp e where e.cd_pedido=p_cd
 and public.rota_055_pendente(p_cd,public.rota_070_hoje()) and not public.rota_070_entregue(p_cd)
 and public.rota_070_erp_pronto(e.etapa,e.dt_conferencia,coalesce(e.dt_saida,e.dt_nota,e.dt_atendido))
 and not exists(select 1 from public.rota_pedido_ignorado g where g.cd_pedido=p_cd and g.alcance='site'))
$$;
create or replace function public.rota_070_data(p_cd bigint) returns date language sql stable security definer set search_path='' as $$
 select coalesce((select s.data_saida from public.rota_070_saida s where s.cd_pedido=p_cd),(select p.dia from public.rota_plano_semana p where p.cd_pedido=p_cd and not p.removido))
$$;
create or replace function public.rota_070_veiculo(p_cd bigint) returns text language sql stable security definer set search_path='' as $$
 select coalesce((select p.veiculo_id from public.rota_plano_semana p where p.cd_pedido=p_cd and not p.removido),(select m.veiculo from public.rota_pedido_veiculo m where m.cd_pedido=p_cd),(select c.veiculo from public.rota_cliente_veiculo c join public.solidcon_pedidos_erp e on e.documento=c.documento where e.cd_pedido=p_cd),public.rota_054_padrao_separando())
$$;
create or replace function public.rota_070_feriado(p_dia date) returns boolean language plpgsql stable security definer set search_path='' as $$
declare y int:=extract(year from p_dia);a int;b int;c int;d int;e int;f int;g int;h int;i int;k int;l int;m int;n int;pascoa date;begin
 if not coalesce((select feriados_sem_saida from public.rota_config where id=1),false) then return false;end if;
 if to_char(p_dia,'MM-DD')=any(array['01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25']) or p_dia=any(coalesce((select feriados_extras from public.rota_config where id=1),'{}'::date[])) then return true;end if;
 a:=y%19;b:=y/100;c:=y%100;d:=b/4;e:=b%4;f:=(b+8)/25;g:=(b-f+1)/3;h:=(19*a+b-d-g+15)%30;i:=c/4;k:=c%4;l:=(32+2*e+2*i-h-k)%7;m:=(a+11*h+22*l)/451;n:=h+l-7*m+114;
 pascoa:=make_date(y,n/31,n%31+1);return p_dia=any(array[pascoa-48,pascoa-47,pascoa-2,pascoa+60]);
end$$;
create or replace function public.rota_070_dia_motivo(p_cd bigint,p_dia date,p_veiculo text,p_futuro boolean default false) returns text language plpgsql stable security definer set search_path='' as $$begin
 if p_dia is null or p_dia<public.rota_070_hoje() or p_dia>date '2100-12-31' or (p_futuro and p_dia<=public.rota_070_hoje()) then return 'dia_bloqueado';end if;
 if extract(isodow from p_dia)=7 then return 'domingo';end if;
 if not exists(select 1 from public.rota_veiculos v where v.id=p_veiculo and v.ativo) then return 'veiculo_invalido';end if;
 if exists(select 1 from public.rota_dia_fechada f where f.data=p_dia and f.estado='fechada') then return 'dia_bloqueado';end if;
 if public.rota_070_feriado(p_dia) or not public.rota_065_sai(p_veiculo,p_dia) then return 'dia_sem_saida';end if;
 return null;
end$$;
create or replace function public.rota_070_calendario(p_cd_pedido bigint,p_de date,p_ate date) returns jsonb language plpgsql stable security definer set search_path='' as $$declare v text;r jsonb;begin
 perform public.rota_070_autorizar(false);
 if p_cd_pedido is null or p_de is null or p_ate is null or p_ate<p_de or p_ate-p_de>61 or not exists(select 1 from public.solidcon_pedidos_erp where cd_pedido=p_cd_pedido) then raise exception 'calendario invalido' using errcode='22023';end if;
 v:=public.rota_070_veiculo(p_cd_pedido);
 select jsonb_agg(jsonb_build_object('dia',d::date,'habilitado',m is null,'motivo',m) order by d) into r from generate_series(p_de::timestamp,p_ate::timestamp,interval '1 day') d cross join lateral(select public.rota_070_dia_motivo(p_cd_pedido,d::date,v,true) m) x;
 return jsonb_build_object('status','ok','cd_pedido',p_cd_pedido,'veiculo_id',v,'de',p_de,'ate',p_ate,'dias',r);
end$$;
create or replace function public.rota_070_reserva_valida(p_cd bigint,p_dia date,p_v text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rota_070_reserva r where r.cd_pedido=p_cd and r.dia=p_dia and r.veiculo_id=p_v and r.invalidada_em is null
 -- B070-R1: revalidar prontidaoERP atual, sem exigir pendenteH depois da virada070.
 and exists(select 1 from public.solidcon_pedidos_erp e where e.cd_pedido=p_cd
 and public.rota_070_erp_pronto(e.etapa,e.dt_conferencia,coalesce(e.dt_saida,e.dt_nota,e.dt_atendido)))
 and coalesce(public.rota_070_data(p_cd),p_dia)<=p_dia
 and public.rota_070_veiculo(p_cd)=p_v and not public.rota_070_entregue(p_cd)
 and not exists(select 1 from public.rota_plano_semana p where p.cd_pedido=p_cd and p.removido)
 and not exists(select 1 from public.rota_068h_reprogramacao h where h.cd_pedido=p_cd and h.ativa and h.criada_em>(select confirmada_em from public.rota_070_definitiva where dia=p_dia))
 and not exists(select 1 from public.pedido_entrega_problema p where p.cd_pedido=p_cd and p.desfeito_em is null and p.em>(select confirmada_em from public.rota_070_definitiva where dia=p_dia))
 and not exists(select 1 from public.rota_pedido_ignorado g where g.cd_pedido=p_cd))
$$;
create or replace function public.rota_070_estado(p_cd bigint) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('cd_pedido',p_cd,'entregue',public.rota_070_entregue(p_cd),'reprogramado',exists(select 1 from public.rota_068h_reprogramacao r where r.cd_pedido=p_cd and r.ativa),'data_recebimento',public.rota_068_recebido_dia(p_cd),'pendente',public.rota_055_pendente(p_cd,public.rota_070_hoje()),'pronto_despacho',public.rota_070_pronto(p_cd),
 'estado_070',case when public.rota_070_entregue(p_cd) then 'historico' when public.rota_070_pronto(p_cd) then 'pronto_despacho' when not public.rota_055_pendente(p_cd,public.rota_070_hoje()) and public.rota_068_recebido_dia(p_cd) is not null then 'recebido' else coalesce((select etapa from public.solidcon_pedidos_erp where cd_pedido=p_cd),'indisponivel') end,
 'data_saida_marcada',public.rota_070_data(p_cd),'origem_data_saida',case when exists(select 1 from public.rota_070_saida where cd_pedido=p_cd) then '070' when public.rota_070_data(p_cd) is not null then 'plano065' end,
 'data_rota_reservada',(select min(r.dia) from public.rota_070_reserva r where r.cd_pedido=p_cd and r.dia>=public.rota_070_hoje() and public.rota_070_reserva_valida(p_cd,r.dia,r.veiculo_id)),'historico_em',public.rota_070_historico_em(p_cd))
$$;
create or replace function public.rota_070_estados_pedidos(p_cds bigint[])
returns table(cd_pedido bigint,entregue boolean,reprogramado boolean,data_recebimento date,pendente boolean,pronto_despacho boolean,estado_070 text,data_saida_marcada date,origem_data_saida text,data_rota_reservada date,historico_em date)
language plpgsql stable security definer set search_path='' as $$begin
 perform public.rota_070_autorizar(false);
 if p_cds is null or cardinality(p_cds)>300 or exists(select 1 from unnest(p_cds) c where c is null or c not between 1 and 999999999999) then raise exception 'pedidos invalidos' using errcode='22023';end if;
 return query select x.* from (select distinct c from unnest(p_cds) c) a cross join lateral jsonb_to_record(public.rota_070_estado(a.c)) as x(cd_pedido bigint,entregue boolean,reprogramado boolean,data_recebimento date,pendente boolean,pronto_despacho boolean,estado_070 text,data_saida_marcada date,origem_data_saida text,data_rota_reservada date,historico_em date);
end$$;
create or replace function public.rota_070_saida_ler(p_cds bigint[])
returns table(cd_pedido bigint,data_saida_marcada date,origem_data_saida text,entregue boolean,pendente boolean,pronto_despacho boolean)
language sql stable security definer set search_path='' as $$select s.cd_pedido,s.data_saida_marcada,s.origem_data_saida,s.entregue,s.pendente,s.pronto_despacho from public.rota_070_estados_pedidos(p_cds) s$$;
-- Mudanca explicita no plano elimina override obsoleto; nao interfere nas provas/fotos nem memoria066.
create or replace function public.rota_070_plano_mudou() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='DELETE' then
 update public.rota_070_reserva set invalidada_em=public.rota_070_agora(),motivo='movido' where cd_pedido=old.cd_pedido and invalidada_em is null and dia>=public.rota_070_hoje();
 delete from public.rota_070_saida where cd_pedido=old.cd_pedido;
 elsif new.removido or tg_op='INSERT' or old.dia is distinct from new.dia then delete from public.rota_070_saida where cd_pedido=new.cd_pedido and (new.removido or data_saida is distinct from new.dia);end if;
 if tg_op<>'DELETE' then update public.rota_070_reserva set invalidada_em=public.rota_070_agora(),motivo='movido' where cd_pedido=new.cd_pedido and invalidada_em is null and dia>=public.rota_070_hoje() and (new.removido or dia<>new.dia or veiculo_id<>new.veiculo_id);end if;return null;
end$$;
drop trigger if exists rota_070_plano_mudou on public.rota_plano_semana;
create trigger rota_070_plano_mudou after insert or update or delete on public.rota_plano_semana for each row execute function public.rota_070_plano_mudou();
create or replace function public.rota_070_saida_gravar(p_cd bigint,p_data date,p_req uuid,p_remover boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare inp jsonb;prev public.rota_070_requisicao;res jsonb;v text;m text;begin
 perform public.rota_070_autorizar(true);perform public.rota_070_travas();
 if p_req is null or p_cd is null or p_cd not between 1 and 999999999999 or (not p_remover and p_data is null) then return jsonb_build_object('status','erro','motivo','parametro_invalido');end if;
 inp:=jsonb_build_object('acao',case when p_remover then 'remover' else 'salvar' end,'cd',p_cd,'data',p_data);
 select * into prev from public.rota_070_requisicao where requisicao=p_req;
 if found then if prev.entrada<>inp or prev.por<>auth.uid() then return jsonb_build_object('status','erro','motivo','requisicao_invalida');end if;return prev.resultado||jsonb_build_object('repetido',true);end if;
 if public.rota_070_entregue(p_cd) then return jsonb_build_object('status','erro','motivo','pedido_historico');end if;
 if not exists(select 1 from public.solidcon_pedidos_erp where cd_pedido=p_cd) then return jsonb_build_object('status','erro','motivo','pedido_nao_encontrado');end if;
 if exists(select 1 from public.rota_pedido_ignorado where cd_pedido=p_cd) then return jsonb_build_object('status','erro','motivo','fora_da_rota');end if;
 v:=public.rota_070_veiculo(p_cd);
 if not p_remover then m:=public.rota_070_dia_motivo(p_cd,p_data,v,true);if m is not null then return jsonb_build_object('status','erro','motivo',m);end if;end if;
 res:=public.rota_068_mover_pedido(p_cd,case when p_remover then null else p_data end,v,md5('070-saida:'||p_req::text)::uuid);
 if res->>'status'<>'ok' then return res;end if;
 if (p_remover and exists(select 1 from public.rota_plano_semana where cd_pedido=p_cd)) or (not p_remover and not exists(select 1 from public.rota_plano_semana where cd_pedido=p_cd and dia=p_data and veiculo_id=v and not removido)) then raise exception '070 plano mudou: recalcule' using errcode='40001';end if;
 if p_remover then delete from public.rota_070_saida where cd_pedido=p_cd;
 else insert into public.rota_070_saida as s(cd_pedido,data_saida,em,por) values(p_cd,p_data,public.rota_070_agora(),auth.uid()) on conflict(cd_pedido) do update set data_saida=excluded.data_saida,em=excluded.em,por=excluded.por;end if;
 res:=jsonb_build_object('status','ok','cd_pedido',p_cd,'data_saida_marcada',case when p_remover then null else p_data end,'origem_data_saida',case when p_remover then null else '070' end,'repetido',false);
 insert into public.rota_070_requisicao(requisicao,entrada,resultado,por,em) values(p_req,inp,res,auth.uid(),public.rota_070_agora());return res;
end$$;
create or replace function public.rota_070_saida_salvar(p_cd_pedido bigint,p_data date,p_requisicao uuid) returns jsonb language sql security definer set search_path='' as $$select public.rota_070_saida_gravar(p_cd_pedido,p_data,p_requisicao,false)$$;
create or replace function public.rota_070_saida_remover(p_cd_pedido bigint,p_requisicao uuid) returns jsonb language sql security definer set search_path='' as $$select public.rota_070_saida_gravar(p_cd_pedido,null,p_requisicao,true)$$;

create or replace function public.rota_070_reservas(p_de date,p_ate date) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(d.dia,jsonb_build_object('dia',d.dia,'origem',d.origem,'versao',d.versao,'itens',coalesce((select jsonb_agg(jsonb_build_object('cd_pedido',r.cd_pedido,'veiculo_id',r.veiculo_id,'ordem',r.ordem,'pronto_ao_reservar',r.pronto_ao_reservar,'ativo',public.rota_070_reserva_valida(r.cd_pedido,r.dia,r.veiculo_id),'motivo',case when public.rota_070_reserva_valida(r.cd_pedido,r.dia,r.veiculo_id) then null else coalesce(r.motivo,'estado_alterado') end) order by r.veiculo_id,r.ordem nulls last,r.cd_pedido) from public.rota_070_reserva r where r.dia=d.dia),'[]'::jsonb))),'{}'::jsonb) from public.rota_070_definitiva d where d.dia between p_de and p_ate
$$;
create or replace function public.rota_070_definitiva_ler(p_dia date) returns jsonb language plpgsql stable security definer set search_path='' as $$declare foto jsonb;begin
 perform public.rota_070_autorizar(false);
 if p_dia is null then raise exception 'dia invalido' using errcode='22023';end if;
 select to_jsonb(f)||jsonb_build_object('itens',coalesce((select jsonb_agg(jsonb_build_object('cd_pedido',i.cd_pedido,'veiculo_id',i.veiculo_id,'ordem',i.ordem,'removido_em',i.removido_em) order by i.veiculo_id,i.ordem nulls last,i.cd_pedido) from public.rota_dia_item i where i.data=f.data),'[]'::jsonb)) into foto from public.rota_dia_fechada f where f.data=p_dia;
 return jsonb_build_object('status','ok','dia',p_dia,'cabecalho',(select jsonb_build_object('dia',d.dia,'origem',d.origem,'versao',d.versao,'confirmada_em',d.confirmada_em) from public.rota_070_definitiva d where d.dia=p_dia),'reservas_070',public.rota_070_reservas(p_dia,p_dia),'foto',foto);
end$$;
create or replace function public.rota_070_definitiva_salvar(p_dia date,p_itens jsonb,p_versao_base bigint,p_requisicao uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare inp jsonb;prev public.rota_070_requisicao;res jsonb;e jsonb;m text;v text;cd bigint;ver bigint;begin
 perform public.rota_070_autorizar(true);perform public.rota_070_travas();
 if p_dia is null or p_dia<>public.rota_070_hoje()+1 or p_requisicao is null or p_versao_base is null or p_itens is null or jsonb_typeof(p_itens)<>'array' or jsonb_array_length(p_itens)>3000 then return jsonb_build_object('status','erro','motivo','parametro_invalido');end if;
 inp:=jsonb_build_object('acao','definitiva','dia',p_dia,'itens',p_itens,'versao',p_versao_base);
 select * into prev from public.rota_070_requisicao where requisicao=p_requisicao;
 if found then if prev.entrada<>inp or prev.por<>auth.uid() then return jsonb_build_object('status','erro','motivo','requisicao_invalida');end if;return prev.resultado||jsonb_build_object('repetido',true);end if;
 if extract(isodow from p_dia)=7 then return jsonb_build_object('status','erro','motivo','domingo');end if;
 if exists(select 1 from public.rota_dia_fechada where data=p_dia and estado='fechada') then return jsonb_build_object('status','erro','motivo','dia_bloqueado');end if;
 ver:=coalesce((select versao from public.rota_070_definitiva where dia=p_dia),0);
 if ver<>p_versao_base then return jsonb_build_object('status','erro','motivo','versao_antiga');end if;
 if exists(select 1 from jsonb_array_elements(p_itens) x where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'cd_pedido') is distinct from 'number' or jsonb_typeof(x->'veiculo_id') is distinct from 'string' or (x ? 'ordem' and jsonb_typeof(x->'ordem') not in('number','null'))) then return jsonb_build_object('status','erro','motivo','parametro_invalido');end if;
 if exists(select 1 from jsonb_array_elements(p_itens) x where (x->>'cd_pedido')::numeric not between 1 and 999999999999 or (x->>'cd_pedido')::numeric<>trunc((x->>'cd_pedido')::numeric) or ((x->>'ordem') is not null and ((x->>'ordem')::numeric not between 1 and 100000 or (x->>'ordem')::numeric<>trunc((x->>'ordem')::numeric)))) or exists(select 1 from jsonb_array_elements(p_itens) x group by x->>'cd_pedido' having count(*)>1) then return jsonb_build_object('status','erro','motivo','parametro_invalido');end if;
 -- Validar TUDO antes de mover qualquer pedido; erro de regra nao deixa movimento parcial.
 for e in select value from jsonb_array_elements(p_itens) loop
  cd:=(e->>'cd_pedido')::bigint;v:=e->>'veiculo_id';
  if not public.rota_070_pronto(cd) then return jsonb_build_object('status','erro','motivo','pedido_nao_pronto','cd_pedido',cd);end if;
  m:=public.rota_070_dia_motivo(cd,p_dia,v,true);if m is not null then return jsonb_build_object('status','erro','motivo',m,'cd_pedido',cd);end if;
  if public.rota_070_data(cd)>p_dia then return jsonb_build_object('status','erro','motivo','dia_bloqueado','cd_pedido',cd);end if;
  if exists(select 1 from public.rota_pedido_ignorado where cd_pedido=cd) then return jsonb_build_object('status','erro','motivo','fora_da_rota','cd_pedido',cd);end if;
 end loop;
 for e in select value from jsonb_array_elements(p_itens) loop
  cd:=(e->>'cd_pedido')::bigint;v:=e->>'veiculo_id';
  res:=public.rota_068_mover_pedido(cd,p_dia,v,md5('070-reserva:'||p_requisicao::text||':'||cd::text)::uuid);
  if res->>'status'<>'ok' or not exists(select 1 from public.rota_plano_semana where cd_pedido=cd and dia=p_dia and veiculo_id=v and not removido) then raise exception '070 movimento falhou: %',res using errcode='40001';end if;
  update public.rota_plano_semana set ordem=(e->>'ordem')::integer where cd_pedido=cd;
 end loop;
 insert into public.rota_070_definitiva as d(dia,origem,versao,confirmada_em,por) values(p_dia,'manual',ver+1,public.rota_070_agora(),auth.uid()) on conflict(dia) do update set origem='manual',versao=excluded.versao,confirmada_em=excluded.confirmada_em,por=excluded.por;
 delete from public.rota_070_reserva where dia=p_dia;
 insert into public.rota_070_reserva(dia,cd_pedido,veiculo_id,ordem) select p_dia,(x->>'cd_pedido')::bigint,x->>'veiculo_id',(x->>'ordem')::integer from jsonb_array_elements(p_itens) x;
 res:=jsonb_build_object('status','ok','dia',p_dia,'versao',ver+1,'repetido',false);
 insert into public.rota_070_requisicao(requisicao,entrada,resultado,por,em) values(p_requisicao,inp,res,auth.uid(),public.rota_070_agora());return res;
end$$;
-- Guard final: nao aceita previsao naoPronto. Reserva supera mudanca para Recebidos; foto anterior continua projecao.
create or replace function public.rota_070_fechavel(p_cd bigint,p_dia date,p_v text,p_foto_anterior boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rota_dia_item i where i.data=p_dia and i.cd_pedido=p_cd and i.veiculo_id=p_v and i.removido_em is null)
 or (p_foto_anterior and exists(select 1 from jsonb_array_elements(coalesce(nullif(current_setting('rota070.foto_anterior',true),''),'[]')::jsonb) i where (i->>'cd_pedido')::bigint=p_cd and i->>'veiculo_id'=p_v and (i->>'data')::date=p_dia))
 or (
 extract(isodow from p_dia)<>7 and not public.rota_070_feriado(p_dia) and public.rota_065_sai(p_v,p_dia)
 and not exists(select 1 from public.rota_pedido_ignorado g where g.cd_pedido=p_cd)
 and not exists(select 1 from public.rota_plano_semana p where p.cd_pedido=p_cd and (p.removido or p.dia>p_dia))
 and coalesce(public.rota_070_data(p_cd),p_dia)<=p_dia
 and (public.rota_070_reserva_valida(p_cd,p_dia,p_v) or (public.rota_070_pronto(p_cd) and not exists(select 1 from public.rota_070_definitiva d where d.dia=p_dia and d.origem='manual'))))
$$;
-- Auxiliar privado, chamado somente pelo worker sem data arbitraria no RPC publico.
create or replace function public.rota_070_virar_dia(p_dia date) returns integer language plpgsql security definer set search_path='' as $$
declare item record;n int:=0;limite timestamptz:=p_dia::timestamp at time zone 'America/Sao_Paulo';begin
 if p_dia<= (select inicio from public.rota_070_politica where id=1) or p_dia>public.rota_070_hoje() or extract(isodow from p_dia)=7 then return 0;end if;
 if not exists(select 1 from public.rota_070_definitiva d where d.dia=p_dia) then
  insert into public.rota_070_definitiva(dia,origem,versao,confirmada_em) values(p_dia,'virada',1,limite) on conflict do nothing;
  insert into public.rota_070_reserva(dia,cd_pedido,veiculo_id,ordem)
  select p_dia,e.cd_pedido,public.rota_070_veiculo(e.cd_pedido),pl.ordem from public.solidcon_pedidos_erp e
  join public.rota_070_prontidao pr on pr.cd_pedido=e.cd_pedido
  left join public.rota_plano_semana pl on pl.cd_pedido=e.cd_pedido and not pl.removido
  left join public.rota_068h_reprogramacao h on h.cd_pedido=e.cd_pedido and h.ativa
  left join public.rota_070_saida s on s.cd_pedido=e.cd_pedido
  where public.rota_070_pronto(e.cd_pedido) and coalesce(public.rota_070_data(e.cd_pedido),p_dia)<=p_dia
  and greatest(pr.pronto_desde,h.criada_em,s.em)<limite
  and not public.rota_070_feriado(p_dia) and public.rota_065_sai(public.rota_070_veiculo(e.cd_pedido),p_dia)
  and not exists(select 1 from public.rota_pedido_ignorado g where g.cd_pedido=e.cd_pedido)
  and not exists(select 1 from public.rota_plano_semana p where p.cd_pedido=e.cd_pedido and p.removido)
  on conflict do nothing;
 end if;
 for item in select r.*,p.cliente_tipo,p.cliente_nome,p.documento,p.valor_centavos from public.rota_070_reserva r join public.solidcon_pedidos_erp p on p.cd_pedido=r.cd_pedido
 join public.rota_070_prontidao pr on pr.cd_pedido=r.cd_pedido
 left join public.rota_068h_reprogramacao h on h.cd_pedido=r.cd_pedido and h.ativa
 left join public.rota_070_saida s on s.cd_pedido=r.cd_pedido
 where r.dia=p_dia and public.rota_070_pronto(r.cd_pedido) and public.rota_070_reserva_valida(r.cd_pedido,p_dia,r.veiculo_id)
 and greatest(pr.pronto_desde,h.criada_em,s.em)<limite
 and not public.rota_070_feriado(p_dia) and public.rota_065_sai(r.veiculo_id,p_dia)
 and not exists(select 1 from public.rota_070_recebimento x where x.cd_pedido=r.cd_pedido and x.dia=p_dia)
 loop
  insert into public.pedido_entrega_rota(cd_pedido,data_entrega,cliente_tipo,cliente_nome,documento,valor_centavos,registrado_em)
  values(item.cd_pedido,p_dia,item.cliente_tipo,item.cliente_nome,case when item.cliente_tipo='cnpj' then item.documento end,item.valor_centavos,public.rota_070_agora()) on conflict(cd_pedido) do nothing;
  update public.rota_068h_reprogramacao set ativa=false,recebido_dia=p_dia,concluida_em=public.rota_070_agora() where cd_pedido=item.cd_pedido and ativa;
  insert into public.rota_070_recebimento(cd_pedido,dia,em) values(item.cd_pedido,p_dia,public.rota_070_agora()) on conflict do nothing;
  n:=n+1;
 end loop;return n;
end$$;
create or replace function public.rota_070_virada() returns jsonb language plpgsql security definer set search_path='' as $$declare d date;n int:=0;dias int:=0;begin
 -- Coleta058 detem35; mesma ordem impede observar DELETE+INSERT incompleto e inversao de locks.
 perform pg_advisory_xact_lock(5100,35);perform public.rota_070_travas();
 if not coalesce((select previsao_definitiva_070 from public.rota_config where id=1),false) then return jsonb_build_object('status','ok','motivo','070_desativada','dias',0,'recebidos',0);end if;
 for d in select generate_series(ultimo_dia+1,least(public.rota_070_hoje(),ultimo_dia+32),interval '1 day')::date from public.rota_070_politica where id=1 loop
  n:=n+public.rota_070_virar_dia(d);update public.rota_070_politica set ultimo_dia=d where id=1;dias:=dias+1;
 end loop;return jsonb_build_object('status','ok','dias',dias,'recebidos',n);
end$$;

-- Corpos575 preservados; apenas pontos de elegibilidade/ordem de locks e mapa070 alterados.
CREATE OR REPLACE FUNCTION public.rota_050_fechar_hoje(p_itens jsonb, p_uid uuid, p_auto boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hoje date := public.rota_050_hoje();
  v_atual public.rota_dia_fechada;
  v_nome text := case when p_uid is null then null else public.rota_050_nome(p_uid) end;
  v_n integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(5100,5201);
  perform pg_catalog.pg_advisory_xact_lock(5100, 5001);
  perform set_config('rota070.foto_anterior',coalesce((select jsonb_agg(jsonb_build_object('cd_pedido',i.cd_pedido,'veiculo_id',i.veiculo_id,'data',i.data))::text from public.rota_dia_item i where i.data=v_hoje and i.removido_em is null),'[]'),true);
  if extract(dow from v_hoje) = 0 then
    raise exception 'domingo: sem saida' using errcode = '22023';
  end if;
  select * into v_atual from public.rota_dia_fechada where data = v_hoje for update;
  if found and v_atual.estado = 'fechada' then
    raise exception 'a rota de hoje ja esta fechada' using errcode = '23505';
  end if;
  if found then   -- reaberta: fecha de novo (versao + 1)
    delete from public.rota_dia_item where data = v_hoje;
    update public.rota_dia_fechada
       set estado = 'fechada', automatico = p_auto, versao = v_atual.versao + 1, revisao = v_atual.revisao + 1, fechada_em = pg_catalog.now(),
           fechada_por = p_uid, fechada_nome = v_nome, alterada_em = null
     where data = v_hoje;
  else
    insert into public.rota_dia_fechada (data, estado, automatico, fechada_por, fechada_nome)
    values (v_hoje, 'fechada', p_auto, p_uid, v_nome);
  end if;
  v_n := public.rota_050_gravar_itens(v_hoje, p_itens, p_uid);
  insert into public.rota_dia_log (data, acao, detalhe, por, por_nome)
  values (v_hoje, case when p_auto then 'fechar_auto' else 'fechar' end, v_n || ' pedido(s)', p_uid, v_nome);
  return (select pg_catalog.to_jsonb(f) from public.rota_dia_fechada f where f.data = v_hoje);
end;
$function$;
CREATE OR REPLACE FUNCTION public.rota_050_fechar_auto(p_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hoje date := public.rota_050_hoje();
  v_saida time;
  v_itens jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(5100,5201);
  perform pg_catalog.pg_advisory_xact_lock(5100, 5001);
  if exists (select 1 from public.rota_dia_fechada where data = v_hoje) then
    return pg_catalog.jsonb_build_object('fechou', false, 'motivo', 'ja_tem');
  end if;
  if extract(dow from v_hoje) = 0 then
    return pg_catalog.jsonb_build_object('fechou', false, 'motivo', 'sem_saida');
  end if;
  select c.hora_saida into v_saida from public.rota_config c where c.id = 1;
  if (pg_catalog.now() at time zone 'America/Sao_Paulo')::time < coalesce(v_saida, '08:00'::time) then
    return pg_catalog.jsonb_build_object('fechou', false, 'motivo', 'antes_da_hora');
  end if;
  -- Tique inicial atrasado: nao transportar criacao/separacao posterior a saida.
  -- A funcao050 interna continua validando integralmente a lista restante.
  if p_itens is null or pg_catalog.jsonb_typeof(p_itens)<>'array' or pg_catalog.jsonb_array_length(p_itens)>3000 then
    raise exception 'lista de pedidos invalida' using errcode='22023';
  end if;
  select coalesce(pg_catalog.jsonb_agg(x.e order by x.o),'[]'::jsonb) into v_itens
    from pg_catalog.jsonb_array_elements(p_itens) with ordinality x(e,o)
   where not exists(select from public.solidcon_pedidos_erp p
     where p.cd_pedido=(x.e->>'cd_pedido')::numeric
       and greatest(p.dt_pedido,p.dt_sep_inicio)>((v_hoje + pg_catalog.make_time(extract(hour from coalesce(v_saida,'08:00'::time))::integer,extract(minute from coalesce(v_saida,'08:00'::time))::integer,0)) at time zone 'America/Sao_Paulo'));
  return pg_catalog.jsonb_build_object('fechou', true, 'rota', public.rota_050_fechar_hoje(v_itens, null, true));
end;
$function$;
CREATE OR REPLACE FUNCTION public.rota_050_gravar_itens(p_data date, p_itens jsonb, p_uid uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_n integer;
begin
  if p_itens is null or pg_catalog.jsonb_typeof(p_itens) <> 'array' or pg_catalog.jsonb_array_length(p_itens) > 3000 then
    raise exception 'lista de pedidos invalida' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e
              where pg_catalog.jsonb_typeof(e) <> 'object'
                 or pg_catalog.jsonb_typeof(e -> 'cd_pedido') <> 'number'
                 or pg_catalog.jsonb_typeof(e -> 'veiculo_id') <> 'string'
                 or (e ? 'ordem' and pg_catalog.jsonb_typeof(e -> 'ordem') not in ('number', 'null'))) then
    raise exception 'item invalido na lista de pedidos' using errcode = '22023';
  end if;
  -- sem tabela temporaria (funcao DEFINER): a lista e relida do jsonb em cada conferencia
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e
              where (e ->> 'cd_pedido')::numeric not between 1 and 999999999999
                 or (e ->> 'cd_pedido')::numeric <> pg_catalog.trunc((e ->> 'cd_pedido')::numeric)
                 or (e ->> 'ordem') is not null and ((e ->> 'ordem')::numeric not between 1 and 100000
                                                     or (e ->> 'ordem')::numeric <> pg_catalog.trunc((e ->> 'ordem')::numeric))) then
    raise exception 'item invalido na lista de pedidos' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e group by (e ->> 'cd_pedido')::bigint having count(*) > 1) then
    raise exception 'pedido repetido na lista' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e
              where not exists (select 1 from public.rota_veiculos v where v.id = e ->> 'veiculo_id' and v.ativo)) then
    raise exception 'veiculo desativado ou inexistente' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(5100, 4601);        -- 065: le o plano sem gravacao concorrente (5001 ja e nossa)
  p_itens := public.rota_065_aplicar_plano(p_data, p_itens);   -- 065: o plano salvo vale no fechamento
  -- B065-R1: fechamento AUTOMATICO (linha recem-gravada por rota_050_fechar_hoje): corte 061 sobre a lista FINAL.
  -- Ordem renumerada so quando algo saiu (dense_rank mantem paradas com varios pedidos juntas; CD/CEASA segue null).
  if coalesce((select f.automatico from public.rota_dia_fechada f where f.data = p_data), false)
     and exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e
                  where public.rota_065_pos_corte((e ->> 'cd_pedido')::bigint, p_data)) then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('cd_pedido', r.cd, 'veiculo_id', r.v, 'ordem', r.o)
             order by r.pos), '[]'::jsonb)
      into p_itens
      from (select k.cd, k.v, k.pos,
                   case when k.o is null then null
                        else (pg_catalog.dense_rank() over (partition by k.v, k.o is null order by k.o))::integer end o
              from (select (x.e ->> 'cd_pedido')::bigint cd, x.e ->> 'veiculo_id' v, (x.e ->> 'ordem')::integer o, x.pos
                      from pg_catalog.jsonb_array_elements(p_itens) with ordinality x(e, pos)
                     where not public.rota_065_pos_corte((x.e ->> 'cd_pedido')::bigint, p_data)) k) r;
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e where not exists (
        select 1 from public.solidcon_pedidos_erp p
         where p.cd_pedido = (e ->> 'cd_pedido')::bigint and public.rota_070_fechavel(p.cd_pedido,p_data,e->>'veiculo_id',true))) then
    raise exception 'pedido nao esta Pronto nem reservado para esta rota' using errcode = 'P0002';
  end if;
  insert into public.rota_dia_item (data, cd_pedido, documento, veiculo_id, ordem, origem, incluido_por)
  select p_data, p.cd_pedido, p.documento, e ->> 'veiculo_id', (e ->> 'ordem')::integer, 'previsao', p_uid
    from pg_catalog.jsonb_array_elements(p_itens) e
    join public.solidcon_pedidos_erp p on p.cd_pedido = (e ->> 'cd_pedido')::bigint;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
CREATE OR REPLACE FUNCTION public.rota_065_aplicar_plano(p_data date, p_itens jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with cal as (
    select (e ->> 'cd_pedido')::bigint cd, e ->> 'veiculo_id' v, (e ->> 'ordem')::integer o, t.pos
      from pg_catalog.jsonb_array_elements(p_itens) with ordinality t(e, pos)
  ), sem as (
    select s.veiculo_id v from public.rota_065_sem_saida s where s.dia = p_data
  ), fora as (   -- programado para outro dia (futuro) ou tirado deste dia
    select p.cd_pedido cd from public.rota_plano_semana p
     where (p.dia = p_data and p.removido) or (p.dia > p_data and not p.removido)
  ), plano as (  -- programado para hoje e que pode sair hoje
    select p.cd_pedido cd, p.veiculo_id v, p.ordem o from public.rota_plano_semana p
     where p.dia = p_data and not p.removido and public.rota_065_sai(p.veiculo_id, p_data)
       and not exists (select 1 from public.rota_pedido_ignorado g where g.cd_pedido = p.cd_pedido)
       and exists (select 1 from public.solidcon_pedidos_erp e where e.cd_pedido = p.cd_pedido and public.rota_070_fechavel(e.cd_pedido,p_data,p.veiculo_id,true))
  ), resto as (
    select c.* from cal c
     where not exists (select 1 from fora f where f.cd = c.cd) and not exists (select 1 from sem s where s.v = c.v)
       and not exists (select 1 from plano p where p.cd = c.cd)
  ), juntos as (
    select p.cd, p.v, p.o, 0 grupo, coalesce(p.o, 0)::bigint k1, p.cd k2 from plano p
    union all
    select r.cd, r.v, r.o, 1, coalesce(r.o, 2147483647)::bigint, r.pos from resto r
  ), final as (
    select j.cd, j.v,
           case when not exists (select 1 from plano p where p.v = j.v) then j.o            -- veiculo sem plano: ordem do painel
                when vv.modo = 'cd_ceasa' then null                                         -- CD/CEASA: 1 parada
                else (pg_catalog.row_number() over (partition by j.v order by j.grupo, j.k1, j.k2))::integer end o,
           j.grupo, j.k1, j.k2
      from juntos j left join public.rota_veiculos vv on vv.id = j.v
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('cd_pedido', f.cd, 'veiculo_id', f.v, 'ordem', f.o)
                  order by f.v, f.grupo, f.k1, f.k2), '[]'::jsonb)
    from final f;
$function$;
CREATE OR REPLACE FUNCTION public.rota_065_ler_semana(p_inicio date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.eh_equipe(), false) then
    raise exception 'equipe necessaria' using errcode = '42501';
  end if;
  if p_inicio is null or extract(isodow from p_inicio) <> 1 then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
  end if;
  return pg_catalog.jsonb_build_object(
    'status', 'ok', 'inicio', p_inicio, 'hoje', public.rota_050_hoje(),
    'reservas_070',public.rota_070_reservas(p_inicio,p_inicio+5),
'pedidos_estado',coalesce((select jsonb_object_agg(e.cd_pedido,public.rota_070_estado(e.cd_pedido)) from (select cd_pedido from public.solidcon_pedidos_erp union select cd_pedido from public.rota_plano_semana union select cd_pedido from public.pedido_entrega_rota union select cd_pedido from public.pedido_entrega_confirmacao) e),'{}'::jsonb),
'versao', coalesce((select s.versao from public.rota_065_semana s where s.inicio = p_inicio), 0),
    'itens', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('cd_pedido', p.cd_pedido, 'dia', p.dia, 'veiculo_id', p.veiculo_id,
                 'ordem', p.ordem, 'removido', p.removido) order by p.dia, p.veiculo_id, p.removido, p.ordem nulls last, p.cd_pedido)
              from public.rota_plano_semana p where p.dia between p_inicio and p_inicio + 5), '[]'::jsonb),
    'sem_saida', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('dia', s.dia, 'veiculo_id', s.veiculo_id, 'motivo', s.motivo)
                 order by s.dia, s.veiculo_id)
              from public.rota_065_sem_saida s where s.dia between p_inicio and p_inicio + 5), '[]'::jsonb),
    'fechados', coalesce((select pg_catalog.jsonb_agg(f.data order by f.data)
              from public.rota_dia_fechada f where f.data between p_inicio and p_inicio + 5 and f.estado = 'fechada'), '[]'::jsonb));
end;
$function$;
create or replace function public.rota_054_candidatos(p_data date)
returns table(cd_pedido bigint,documento text,veiculo_id text)
language sql stable security definer set search_path=''
as $$
 select p.cd_pedido,p.documento,vq.v
 from public.solidcon_pedidos_erp p
 left join public.rota_pedido_veiculo m on m.cd_pedido=p.cd_pedido
 left join public.rota_cliente_veiculo c on c.documento=p.documento
 left join public.rota_plano_semana pl on pl.cd_pedido=p.cd_pedido and pl.dia=p_data and not pl.removido
 cross join lateral (select coalesce(pl.veiculo_id,m.veiculo,c.veiculo,public.rota_054_padrao_separando()) v) vq
 where public.rota_061_auto_aberta(p_data)
   and public.rota_070_fechavel(p.cd_pedido,p_data,vq.v)
   and public.rota_054_tem_saida(p_data,vq.v)
   and not public.rota_065_fora_auto(p.cd_pedido,p_data,vq.v)
   and not exists(select 1 from public.rota_pedido_ignorado g where g.cd_pedido=p.cd_pedido)
   and not exists(select 1 from public.rota_dia_item x where x.data=p_data and x.cd_pedido=p.cd_pedido)
   -- RF-3: remover de hoje tira o cliente inteiro, inclusive pedidos que chegam depois.
   and not exists(select 1 from public.rota_dia_item x where x.data=p_data and x.removido_em is not null and x.documento=p.documento)
 order by p.cd_pedido
$$;
revoke all on function public.rota_054_candidatos(date) from public,anon,authenticated,service_role;

-- Corpo da 061 + (a) trava 4601 depois da 5001: candidatos e plano lidos sem gravacao concorrente do plano;
-- (b) proposta do painel/Edge (rota-core ainda sem o filtro 065) que traga pedido FORA da foto e fora dos candidatos
-- que o plano tira (rota_065_fora_auto) e aceita sem ele, com a ordem renumerada 1..N por veiculo. Qualquer outra
-- diferenca continua 40001 (recalcular). (c) B065-R2-A: candidato cujo veiculo vem do plano de HOJE e que a proposta pos
-- noutro veiculo entra no veiculo do plano, no fim da rota dele; o resto da proposta e validado como antes.
create or replace function public.rota_054_incluir(p_data date,p_revisao integer,p_ordem jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_hoje date:=public.rota_050_hoje(); v_rev integer; v_estado text; v_novos jsonb; v_veics text[];
 v_esperados jsonb; v_recebidos jsonb; v_n integer; v_uid uuid:=auth.uid(); v_ordem jsonb; v_plano jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.pode_marcar_rota(),false) then
   raise exception 'sem permissao para incluir separando' using errcode='42501';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(5100,5201);
 perform pg_catalog.pg_advisory_xact_lock(5100,5001);
 perform pg_catalog.pg_advisory_xact_lock(5100,4601);
 if p_data is distinct from v_hoje then raise exception 'o dia mudou: atualize a rota' using errcode='40001';end if;
 select f.revisao,f.estado into v_rev,v_estado from public.rota_dia_fechada f where f.data=v_hoje for update;
 if not found or v_estado<>'fechada' then return pg_catalog.jsonb_build_object('incluidos',0,'motivo','aberta');end if;
 if not public.rota_061_auto_aberta(v_hoje) then
   return pg_catalog.jsonb_build_object('incluidos',0,'motivo','saida_encerrada','revisao',v_rev,'foto',public.rota_050_ler(v_hoje));
 end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) order by c.cd_pedido),'[]'::jsonb)
   into v_novos from public.rota_054_candidatos(v_hoje) c;
 v_n:=pg_catalog.jsonb_array_length(v_novos);
 -- Retry sem nada novo nao altera revisao/log, mesmo que a resposta anterior se tenha perdido.
 if v_n=0 then return pg_catalog.jsonb_build_object('incluidos',0,'revisao',v_rev,'foto',public.rota_050_ler(v_hoje));end if;
 if p_revisao is distinct from v_rev then raise exception 'a rota mudou: recalcule a proposta' using errcode='40001';end if;
 if p_ordem is null or pg_catalog.jsonb_typeof(p_ordem)<>'array' then raise exception 'ordem invalida' using errcode='22023';end if;
 if pg_catalog.jsonb_array_length(p_ordem)>10000 or exists(select 1 from pg_catalog.jsonb_array_elements(p_ordem) x
    where pg_catalog.jsonb_typeof(x) is distinct from 'object'
       or pg_catalog.jsonb_typeof(x->'cd_pedido') is distinct from 'number'
       or pg_catalog.jsonb_typeof(x->'veiculo_id') is distinct from 'string'
       or pg_catalog.jsonb_typeof(x->'ordem') is distinct from 'number') then
   raise exception 'ordem invalida' using errcode='22023';
 end if;
 if exists(select 1 from pg_catalog.jsonb_array_elements(p_ordem) x
     where (x->>'cd_pedido')::numeric not between 1 and 999999999999 or (x->>'cd_pedido')::numeric<>pg_catalog.trunc((x->>'cd_pedido')::numeric)
        or (x->>'ordem')::numeric not between 1 and 100000 or (x->>'ordem')::numeric<>pg_catalog.trunc((x->>'ordem')::numeric))
    or exists(select 1 from pg_catalog.jsonb_array_elements(p_ordem) x group by x->>'cd_pedido' having count(*)>1) then
   raise exception 'ordem invalida ou pedido duplicado' using errcode='22023';
 end if;
 -- 065 (c) B065-R2-A: o VEICULO DO PLANO DE HOJE manda. Candidato cujo veiculo veio do plano e que a proposta trouxe
 -- noutro veiculo (o rota-core segue a marcacao) sai da proposta; o resto dela e validado como sempre; ele entra no
 -- veiculo do plano, no fim da rota desse veiculo (CD/CEASA: ordem nula, 1 parada).
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('cd_pedido',(n->>'cd_pedido')::bigint,'veiculo_id',n->>'veiculo_id',
          'veiculo_proposta',t.x->>'veiculo_id') order by (n->>'cd_pedido')::bigint),'[]'::jsonb)
   into v_plano
   from pg_catalog.jsonb_array_elements(v_novos) n
   join pg_catalog.jsonb_array_elements(p_ordem) t(x) on (t.x->>'cd_pedido')::bigint=(n->>'cd_pedido')::bigint
  where t.x->>'veiculo_id' is distinct from n->>'veiculo_id'
    and exists(select 1 from public.rota_plano_semana pl where pl.cd_pedido=(n->>'cd_pedido')::bigint and pl.dia=v_hoje
                  and not pl.removido and pl.veiculo_id=n->>'veiculo_id');
 -- 065 (b): sem os pedidos que o plano tirou desta inclusao (nem na foto, nem candidatos) e sem os de (c).
 select pg_catalog.jsonb_agg(t.x order by t.pos) into v_ordem
   from pg_catalog.jsonb_array_elements(p_ordem) with ordinality t(x,pos)
  where not exists(select 1 from pg_catalog.jsonb_array_elements(v_plano) q where (q->>'cd_pedido')::bigint=(t.x->>'cd_pedido')::bigint)
    and (exists(select 1 from public.rota_dia_item i where i.data=v_hoje and i.cd_pedido=(t.x->>'cd_pedido')::bigint and i.removido_em is null)
         or exists(select 1 from pg_catalog.jsonb_array_elements(v_novos) n where (n->>'cd_pedido')::bigint=(t.x->>'cd_pedido')::bigint)
         or not public.rota_065_fora_auto((t.x->>'cd_pedido')::bigint,v_hoje,t.x->>'veiculo_id'));
 v_ordem:=coalesce(v_ordem,'[]'::jsonb);
 if pg_catalog.jsonb_array_length(v_ordem)<pg_catalog.jsonb_array_length(p_ordem) then
   select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('cd_pedido',r.cd,'veiculo_id',r.v,'ordem',r.o) order by r.pos) into v_ordem
     from (select (t.x->>'cd_pedido')::bigint cd,t.x->>'veiculo_id' v,t.pos,
                  (pg_catalog.dense_rank() over (partition by t.x->>'veiculo_id' order by (t.x->>'ordem')::integer))::integer o
             from pg_catalog.jsonb_array_elements(v_ordem) with ordinality t(x,pos)) r;
   v_ordem:=coalesce(v_ordem,'[]'::jsonb);
 end if;
 -- Veiculos que a proposta tem de cobrir: os dos candidatos comuns + o veiculo em que a proposta pos os de (c).
 select pg_catalog.array_agg(distinct v.veic) into v_veics from (
   select x->>'veiculo_id' veic from pg_catalog.jsonb_array_elements(v_novos) x
    where not exists(select 1 from pg_catalog.jsonb_array_elements(v_plano) q where q->>'cd_pedido'=x->>'cd_pedido')
   union all select q->>'veiculo_proposta' from pg_catalog.jsonb_array_elements(v_plano) q) v;
 select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(e.cd,e.veic) order by e.cd) into v_esperados from (
   select i.cd_pedido cd,i.veiculo_id veic from public.rota_dia_item i where i.data=v_hoje and i.veiculo_id=any(v_veics) and i.removido_em is null
   union all select (x->>'cd_pedido')::bigint,x->>'veiculo_id' from pg_catalog.jsonb_array_elements(v_novos) x
    where not exists(select 1 from pg_catalog.jsonb_array_elements(v_plano) q where q->>'cd_pedido'=x->>'cd_pedido')
 ) e;
 select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array((x->>'cd_pedido')::bigint,x->>'veiculo_id') order by (x->>'cd_pedido')::bigint)
   into v_recebidos from pg_catalog.jsonb_array_elements(v_ordem) x;
 if v_esperados is distinct from v_recebidos then
   raise exception 'pedidos/veiculos mudaram: recalcule a proposta' using errcode='40001';
 end if;
 insert into public.rota_dia_item(data,cd_pedido,documento,veiculo_id,ordem,origem,incluido_por)
 select v_hoje,(x->>'cd_pedido')::bigint,x->>'documento',x->>'veiculo_id',null,'separando',v_uid
 from pg_catalog.jsonb_array_elements(v_novos) x;
 update public.rota_dia_item i set ordem=(x->>'ordem')::integer from pg_catalog.jsonb_array_elements(v_ordem) x
 where i.data=v_hoje and i.cd_pedido=(x->>'cd_pedido')::bigint;
 update public.rota_dia_item i set ordem=c.o
   from (select (q->>'cd_pedido')::bigint cd,
                case when vv.modo='cd_ceasa' then null
                     else (coalesce((select max(z.ordem) from public.rota_dia_item z where z.data=v_hoje and z.veiculo_id=q->>'veiculo_id' and z.removido_em is null
                                       and not exists(select 1 from pg_catalog.jsonb_array_elements(v_plano) w where (w->>'cd_pedido')::bigint=z.cd_pedido)),0)
                           + pg_catalog.row_number() over (partition by q->>'veiculo_id' order by (q->>'cd_pedido')::bigint))::integer end o
           from pg_catalog.jsonb_array_elements(v_plano) q left join public.rota_veiculos vv on vv.id=q->>'veiculo_id') c
  where i.data=v_hoje and i.cd_pedido=c.cd;
 select pg_catalog.array_agg(distinct x->>'veiculo_id' order by x->>'veiculo_id') into v_veics from pg_catalog.jsonb_array_elements(v_novos) x;   -- para o log
 update public.rota_dia_fechada set alterada_em=pg_catalog.now(),revisao=revisao+1 where data=v_hoje;
 insert into public.rota_dia_log(data,acao,detalhe,por,por_nome)
 values(v_hoje,'adicionar',pg_catalog.left('Separando automatico: '||v_n||' pedido(s); veiculos '||pg_catalog.array_to_string(v_veics,','),200),v_uid,public.rota_050_nome(v_uid));
 return pg_catalog.jsonb_build_object('incluidos',v_n,'revisao',v_rev+1,'foto',public.rota_050_ler(v_hoje));
end$$;

CREATE OR REPLACE FUNCTION public.rota_050_ajustar(p_acao text, p_cds bigint[], p_veiculo text, p_ordem jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare

  v_hoje date := public.rota_050_hoje();

  v_uid uuid := auth.uid();

  v_nome text;

  v_n integer;

  v_veics text[];

begin

  if not coalesce(public.pode_marcar_rota(), false) then

    raise exception 'sem permissao para ajustar a rota' using errcode = '42501';

  end if;

  perform pg_catalog.pg_advisory_xact_lock(5100,5201);
  perform pg_catalog.pg_advisory_xact_lock(5100, 5001);

  if p_acao is null or p_acao not in ('remover', 'adicionar') or p_cds is null or pg_catalog.cardinality(p_cds) not between 1 and 300

     or (p_acao = 'adicionar' and p_veiculo is null) then

    raise exception 'ajuste invalido' using errcode = '22023';

  end if;

  if not exists (select 1 from public.rota_dia_fechada where data = v_hoje and estado = 'fechada') then

    raise exception 'a rota de hoje nao esta fechada' using errcode = 'P0002';

  end if;

  v_nome := public.rota_050_nome(v_uid);

  if p_acao = 'remover' then

    if (select count(*) from public.rota_dia_item i where i.data = v_hoje and i.cd_pedido = any (p_cds) and i.removido_em is null)

       <> (select count(distinct x) from pg_catalog.unnest(p_cds) x) then

      raise exception 'pedido nao esta na rota de hoje' using errcode = 'P0002';

    end if;

    if exists (select 1 from public.rota_dia_item i

                where i.data = v_hoje and i.removido_em is null and i.documento is not null and i.cd_pedido <> all (p_cds)

                  and i.documento in (select j.documento from public.rota_dia_item j where j.data = v_hoje and j.cd_pedido = any (p_cds))) then

      raise exception 'remover de hoje precisa levar todos os pedidos do cliente (atualize a aba)' using errcode = '22023';

    end if;

    select pg_catalog.array_agg(distinct i.veiculo_id) into v_veics from public.rota_dia_item i where i.data = v_hoje and i.cd_pedido = any (p_cds);

    update public.rota_dia_item set removido_em = pg_catalog.now(), removido_por = v_uid, removido_nome = v_nome, ordem = null

     where data = v_hoje and cd_pedido = any (p_cds);

  else

    if not exists (select 1 from public.rota_veiculos v where v.id = p_veiculo and v.ativo) then

      raise exception 'veiculo desativado ou inexistente' using errcode = '22023';

    end if;

    if exists (select 1 from public.rota_dia_item i where i.data = v_hoje and i.cd_pedido = any (p_cds) and i.removido_em is null) then

      raise exception 'pedido ja esta na rota de hoje' using errcode = '23505';

    end if;

    if (select count(*) from public.solidcon_pedidos_erp p where p.cd_pedido = any (p_cds)

           and public.rota_070_fechavel(p.cd_pedido,v_hoje,p_veiculo)) <> (select count(distinct x) from pg_catalog.unnest(p_cds) x) then

      raise exception 'pedido nao esta em aberto no ERP' using errcode = 'P0002';

    end if;

    v_veics := array[p_veiculo];

    insert into public.rota_dia_item (data, cd_pedido, documento, veiculo_id, ordem, origem, incluido_por)

    select v_hoje, p.cd_pedido, p.documento, p_veiculo, null, 'adicionado', v_uid

      from public.solidcon_pedidos_erp p where p.cd_pedido = any (p_cds)

    on conflict (data, cd_pedido) do update

      set veiculo_id = excluded.veiculo_id, ordem = null, origem = 'adicionado', incluido_em = pg_catalog.now(),

          incluido_por = excluded.incluido_por, removido_em = null, removido_por = null, removido_nome = null, documento = excluded.documento;

  end if;

  -- ordem nova SO dos veiculos afetados: tem de cobrir exatamente os pedidos ativos deles

  if p_ordem is null or pg_catalog.jsonb_typeof(p_ordem) <> 'array' then

    raise exception 'ordem invalida' using errcode = '22023';

  end if;

  if exists (select 1 from pg_catalog.jsonb_array_elements(p_ordem) e

              where pg_catalog.jsonb_typeof(e -> 'cd_pedido') <> 'number' or pg_catalog.jsonb_typeof(e -> 'ordem') <> 'number'

                 or (e ->> 'ordem')::numeric not between 1 and 100000) then

    raise exception 'ordem invalida' using errcode = '22023';

  end if;

  if (select pg_catalog.array_agg(x order by x) from (select (e ->> 'cd_pedido')::bigint x from pg_catalog.jsonb_array_elements(p_ordem) e) s)

     is distinct from

     (select pg_catalog.array_agg(i.cd_pedido order by i.cd_pedido) from public.rota_dia_item i

       where i.data = v_hoje and i.veiculo_id = any (v_veics) and i.removido_em is null) then

    raise exception 'a ordem nao confere com os pedidos do veiculo (atualize a aba)' using errcode = '22023';

  end if;

  update public.rota_dia_item i set ordem = (e ->> 'ordem')::integer

    from pg_catalog.jsonb_array_elements(p_ordem) e

   where i.data = v_hoje and i.cd_pedido = (e ->> 'cd_pedido')::bigint;

  update public.rota_dia_fechada set alterada_em = pg_catalog.now(), revisao = revisao + 1 where data = v_hoje;

  v_n := pg_catalog.cardinality(p_cds);

  insert into public.rota_dia_log (data, acao, detalhe, por, por_nome)

  values (v_hoje, p_acao::text, pg_catalog.left(v_n || ' pedido(s), veiculo(s) ' || pg_catalog.array_to_string(v_veics, ',') || ': ' || pg_catalog.array_to_string(p_cds[1:20], ','), 200), v_uid, v_nome);

  return (select pg_catalog.to_jsonb(f) from public.rota_dia_fechada f where f.data = v_hoje);

end;

$function$;
-- ACL explicita: privados nao sao RPCs; consultas equipe/service, escritas somente marcador autenticado.
do $$declare r record;begin for r in select p.oid::regprocedure assinatura from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'rota_070_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',r.assinatura);end loop;end$$;
grant execute on function public.rota_070_estados_pedidos(bigint[]),public.rota_070_saida_ler(bigint[]),public.rota_070_calendario(bigint,date,date),public.rota_070_definitiva_ler(date) to authenticated,service_role;
grant execute on function public.rota_070_saida_salvar(bigint,date,uuid),public.rota_070_saida_remover(bigint,uuid),public.rota_070_definitiva_salvar(date,jsonb,bigint,uuid) to authenticated;
revoke all on function public.rota_050_gravar_itens(date,jsonb,uuid),public.rota_050_fechar_hoje(jsonb,uuid,boolean),public.rota_065_aplicar_plano(date,jsonb),public.rota_054_candidatos(date) from public,anon,authenticated,service_role;
do $$begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.unschedule(jobid) from cron.job where jobname='rota-070-virada';
  perform cron.schedule('rota-070-virada','* * * * *','select public.rota_070_virada()');
 end if;
end$$;
commit;
