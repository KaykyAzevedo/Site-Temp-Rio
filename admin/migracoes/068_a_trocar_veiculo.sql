-- 068 A: troca atomica marcacao + plano persistido. Aditiva; nao aplicada/publicada.
-- Requer 044/047, 059/061 e 065. Nao altera foto fechada nem plano bloqueado.
-- Locks compartilhados com fechamento: 5201 -> 5001 -> 4601.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
select pg_catalog.pg_advisory_xact_lock(5100,68);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
select pg_catalog.pg_advisory_xact_lock(5100,4601);
do $$begin
 if to_regprocedure('public.rota_044_marcar(bigint,text,text)') is null
 or to_regprocedure('public.rota_065_linha_editavel(date,text)') is null
 or to_regprocedure('public.rota_065_travada(date,text)') is null
 or to_regprocedure('public.rota_054_padrao_separando()') is null
 or to_regclass('public.rota_065_semana') is null or to_regclass('public.rota_059_saidas') is null
 or to_regclass('public.rota_plano_semana') is null then
 raise exception '068 A requer044/047/059/061/065. Nada aplicado.';
 end if;
end$$;

-- Booleano para o gatilho INVOKER: sem marca_rota, responde bloqueado sem revelar estado.
create or replace function public.rota_068_veiculo_saiu(p_cd bigint)
returns boolean language sql volatile security definer set search_path='' as $$
 select not coalesce(public.pode_marcar_rota(),false)
   or exists(select 1 from public.rota_059_saidas s where s.cd_pedido=p_cd)
   or exists(select 1 from public.solidcon_pedidos_erp e where e.cd_pedido=p_cd and e.etapa in('saiu','atendido'));
$$;
revoke all on function public.rota_068_veiculo_saiu(bigint) from public,anon,authenticated;
grant execute on function public.rota_068_veiculo_saiu(bigint) to authenticated;

-- BEFORE STATEMENT toma locks antes dos row locks do DML direto (evita checar saida com foto concorrente).
create or replace function public.rota_068_veiculo_travar()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user='authenticated' then
  perform pg_catalog.pg_advisory_xact_lock(5100,5201);
  perform pg_catalog.pg_advisory_xact_lock(5100,5001);
  perform pg_catalog.pg_advisory_xact_lock(5100,4601);
 end if;
 return null;
end$$;
revoke all on function public.rota_068_veiculo_travar() from public,anon,authenticated;
drop trigger if exists rota_068_veiculo_travar on public.rota_pedido_veiculo;
create trigger rota_068_veiculo_travar before insert or update or delete on public.rota_pedido_veiculo
 for each statement execute function public.rota_068_veiculo_travar();

create or replace function public.rota_068_veiculo_guardar()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user='authenticated' and (
  (tg_op in('UPDATE','DELETE') and public.rota_068_veiculo_saiu(old.cd_pedido))
  or (tg_op in('INSERT','UPDATE') and public.rota_068_veiculo_saiu(new.cd_pedido))) then
  raise exception 'ja_saiu: pedido somente leitura' using errcode='42501';
 end if;
 return case when tg_op='DELETE' then old else new end;
end$$;
revoke all on function public.rota_068_veiculo_guardar() from public,anon,authenticated;
drop trigger if exists rota_068_veiculo_guardar on public.rota_pedido_veiculo;
create trigger rota_068_veiculo_guardar before insert or update or delete on public.rota_pedido_veiculo
 for each row execute function public.rota_068_veiculo_guardar();

create or replace function public.rota_068_trocar_veiculo(p_cd_pedido bigint,p_veiculo text,p_escopo text default 'pedido')
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 v_doc text;v_padrao text;v_destino text;v_resultado text;v_plano public.rota_plano_semana%rowtype;
 v_tem_plano boolean;v_inicio date;v_versao bigint;v_modo text;v_ordem integer;
begin
 if auth.uid() is null or not coalesce(public.pode_marcar_rota(),false) then
  raise exception 'sem permissao para trocar veiculo' using errcode='42501';
 end if;
 if p_cd_pedido is null or p_cd_pedido not between 1 and 999999999999 or coalesce(p_escopo,'') not in('pedido','sempre') then
  return pg_catalog.jsonb_build_object('status','erro','motivo','parametro_invalido');
 end if;
 perform pg_catalog.pg_advisory_xact_lock(5100,5201);
 perform pg_catalog.pg_advisory_xact_lock(5100,5001);
 perform pg_catalog.pg_advisory_xact_lock(5100,4601);
 if p_veiculo is not null and not exists(select 1 from public.rota_veiculos v where v.id=p_veiculo and v.ativo) then
  return pg_catalog.jsonb_build_object('status','erro','motivo','veiculo_invalido');
 end if;
 select e.documento into v_doc from public.solidcon_pedidos_erp e where e.cd_pedido=p_cd_pedido for share;
 if not found then return pg_catalog.jsonb_build_object('status','erro','motivo','pedido_nao_encontrado');end if;
 if public.rota_068_veiculo_saiu(p_cd_pedido) then
  return pg_catalog.jsonb_build_object('status','erro','motivo','ja_saiu');
 end if;
 if v_doc is not null then select c.veiculo into v_padrao from public.rota_cliente_veiculo c where c.documento=v_doc;end if;
 -- null limpa marcacao; o plano adota o padrao que restara apos a regra044 (fallback operacional054).
 v_destino:=coalesce(p_veiculo,case when p_escopo='pedido' then v_padrao end,public.rota_054_padrao_separando());
 select p.* into v_plano from public.rota_plano_semana p where p.cd_pedido=p_cd_pedido for update;
 v_tem_plano:=found;
 if v_tem_plano then
  if not public.rota_065_linha_editavel(v_plano.dia,v_plano.veiculo_id) then
   return pg_catalog.jsonb_build_object('status','erro','motivo','dia_bloqueado');
  end if;
  if not public.rota_065_linha_editavel(v_plano.dia,v_destino) then
   return pg_catalog.jsonb_build_object('status','erro','motivo','dia_sem_saida');
  end if;
  select v.modo into v_modo from public.rota_veiculos v where v.id=v_destino;
  if v_destino is distinct from v_plano.veiculo_id then
   if not v_plano.removido and v_modo='porta' then
    select coalesce(max(p.ordem),0)+1 into v_ordem from public.rota_plano_semana p
     where p.dia=v_plano.dia and p.veiculo_id=v_destino and not p.removido;
   end if;
   update public.rota_plano_semana set veiculo_id=v_destino,ordem=v_ordem where cd_pedido=p_cd_pedido;
   -- Fecha o buraco da origem e normaliza destino, sem tocar outros dias ou removidos.
   with ordens as (
    select p.cd_pedido,(pg_catalog.row_number() over(partition by p.veiculo_id order by p.ordem nulls last,p.cd_pedido))::integer n
     from public.rota_plano_semana p join public.rota_veiculos v on v.id=p.veiculo_id
     where p.dia=v_plano.dia and p.veiculo_id in(v_plano.veiculo_id,v_destino) and not p.removido and v.modo='porta'
   ) update public.rota_plano_semana p set ordem=o.n from ordens o where p.cd_pedido=o.cd_pedido and p.ordem is distinct from o.n;
  end if;
  v_inicio:=v_plano.dia-(extract(isodow from v_plano.dia)::integer-1);
  v_versao:=coalesce((select s.versao from public.rota_065_semana s where s.inicio=v_inicio),0);
 end if;

 -- Mesma regra044/047 (inclusive primeiro cliente sem padrao); apenas depois de TODAS as recusas.
 if p_veiculo is null then
  delete from public.rota_pedido_veiculo where cd_pedido=p_cd_pedido;
  if p_escopo='sempre' and v_doc is not null then delete from public.rota_cliente_veiculo where documento=v_doc;end if;
  v_resultado:='removido';
 elsif v_doc is not null and (p_escopo='sempre' or v_padrao is null) then
  insert into public.rota_cliente_veiculo as c(documento,veiculo) values(v_doc,p_veiculo)
   on conflict(documento) do update set veiculo=excluded.veiculo;
  delete from public.rota_pedido_veiculo where cd_pedido=p_cd_pedido;
  v_resultado:='padrao';
 elsif v_padrao is not distinct from p_veiculo then
  delete from public.rota_pedido_veiculo where cd_pedido=p_cd_pedido;
  v_resultado:='padrao';
 else
  insert into public.rota_pedido_veiculo as p(cd_pedido,veiculo) values(p_cd_pedido,p_veiculo)
   on conflict(cd_pedido) do update set veiculo=excluded.veiculo;
  v_resultado:='pedido';
 end if;
 return pg_catalog.jsonb_build_object('status','ok','resultado',v_resultado,
  'plano',case when v_tem_plano then pg_catalog.jsonb_build_object('dia',v_plano.dia,'veiculo_id',v_destino,'inicio',v_inicio,'versao',v_versao) else null end);
end$$;
revoke all on function public.rota_068_trocar_veiculo(bigint,text,text) from public,anon,authenticated;
grant execute on function public.rota_068_trocar_veiculo(bigint,text,text) to authenticated;

-- Legado044 delega a mesma transacao: impede bypass pela escrita de padrao que nao toca pedido_veiculo.
create or replace function public.rota_044_marcar(p_cd_pedido bigint,p_veiculo text,p_escopo text default 'pedido')
returns text language plpgsql volatile security invoker set search_path=pg_catalog,pg_temp as $$
declare v jsonb;
begin
 v:=public.rota_068_trocar_veiculo(p_cd_pedido,p_veiculo,p_escopo);
 if v->>'status'<>'ok' then
  if v->>'motivo'='pedido_nao_encontrado' then raise exception 'pedido nao encontrado' using errcode='P0002';end if;
  raise exception 'troca de veiculo: %',v->>'motivo' using errcode='22023';
 end if;
 return v->>'resultado';
end$$;
revoke all on function public.rota_044_marcar(bigint,text,text) from public,anon;
grant execute on function public.rota_044_marcar(bigint,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
