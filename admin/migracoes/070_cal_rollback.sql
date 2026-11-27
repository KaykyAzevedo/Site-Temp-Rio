-- 070-CAL rollback idempotente: restaura rota_070_dia_motivo e rota_070_saida_gravar exatas da 070. Preserva dados.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

select pg_catalog.pg_advisory_xact_lock(5100, 7001);
select pg_catalog.pg_advisory_xact_lock(5100, 5201);
select pg_catalog.pg_advisory_xact_lock(5100, 5001);
select pg_catalog.pg_advisory_xact_lock(5100, 4601);

create or replace function public.rota_070_dia_motivo(p_cd bigint,p_dia date,p_veiculo text,p_futuro boolean default false) returns text language plpgsql stable security definer set search_path='' as $$begin
 if p_dia is null or p_dia<public.rota_070_hoje() or p_dia>date '2100-12-31' or (p_futuro and p_dia<=public.rota_070_hoje()) then return 'dia_bloqueado';end if;
 if extract(isodow from p_dia)=7 then return 'domingo';end if;
 if not exists(select 1 from public.rota_veiculos v where v.id=p_veiculo and v.ativo) then return 'veiculo_invalido';end if;
 if exists(select 1 from public.rota_dia_fechada f where f.data=p_dia and f.estado='fechada') then return 'dia_bloqueado';end if;
 if public.rota_070_feriado(p_dia) or not public.rota_065_sai(p_veiculo,p_dia) then return 'dia_sem_saida';end if;
 return null;
end$$;
revoke all on function public.rota_070_dia_motivo(bigint, date, text, boolean) from public, anon, authenticated, service_role;

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
revoke all on function public.rota_070_saida_gravar(bigint, date, uuid, boolean) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
