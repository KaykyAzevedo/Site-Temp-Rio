-- 068CH r3: legado entregue continua entregue; movimento e pendencia sao flags distintas.
-- BackupH3 proprio: nao reutilizar corpos do H2 retirado, preservado para auditoria.
-- Requer065+A+C_r3; D opcional. Destino continua dia futuro editavel065. Nenhum dado historico apagado.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
select pg_catalog.pg_advisory_xact_lock(5100,6808);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
select pg_catalog.pg_advisory_xact_lock(5100,4601);
do $$begin
 if to_regprocedure('public.rota_065_salvar_semana(date,bigint,jsonb,text)') is null
 or to_regprocedure('public.rota_068_trocar_veiculo(bigint,text,text)') is null
 or to_regclass('public.pedido_entrega_rota') is null or to_regclass('public.pedido_entrega_problema') is null then
 raise exception '068H requer065+A+C_r3. Nada aplicado.';end if;
end$$;
create table if not exists public.rota_068h3_backup(nome text primary key,def text not null);
alter table public.rota_068h3_backup enable row level security;
revoke all on public.rota_068h3_backup from public,anon,authenticated,service_role;
insert into public.rota_068h3_backup(nome,def)
select x.n,pg_catalog.pg_get_functiondef(x.n::regprocedure) from pg_catalog.unnest(array[
 'public.rota_065_ler_semana(date)','public.rota_065_salvar_semana(date,bigint,jsonb,text)',
 'public.rota_047_salvar_semana(date,text,jsonb)','public.rota_065_plano_guardar()',
 'public.rota_068_veiculo_saiu(bigint)','public.rota_068_trocar_veiculo(bigint,text,text)',
 'public.rota_055_pendente(bigint,date)','public.rota_063_ler_entregas(bigint[])',
 'public.rota_068_entrega_capturar(bigint[])','public.rota_068_entregas(date,date)'
]) x(n) on conflict(nome) do nothing;

create table if not exists public.rota_068h_reprogramacao(
 cd_pedido bigint primary key check(cd_pedido between 1 and 999999999999),
 ativa boolean not null default true,dia date,veiculo_id text,
 criada_em timestamptz not null default pg_catalog.now(),por uuid not null,
 recebido_dia date,concluida_em timestamptz
);
create table if not exists public.rota_068h_movimento_log(
 requisicao uuid primary key,cd_pedido bigint not null,entrada jsonb not null,resultado jsonb not null,
 por uuid not null,em timestamptz not null default pg_catalog.now()
);
alter table public.rota_068h_reprogramacao enable row level security;
alter table public.rota_068h_movimento_log enable row level security;
revoke all on public.rota_068h_reprogramacao,public.rota_068h_movimento_log from public,anon,authenticated,service_role;
grant select on public.rota_068h_reprogramacao,public.rota_068h_movimento_log to authenticated;
drop policy if exists rota_068h_reprogramacao_equipe on public.rota_068h_reprogramacao;
create policy rota_068h_reprogramacao_equipe on public.rota_068h_reprogramacao for select to authenticated using((select public.eh_equipe()));
drop policy if exists rota_068h_log_equipe on public.rota_068h_movimento_log;
create policy rota_068h_log_equipe on public.rota_068h_movimento_log for select to authenticated using((select public.eh_equipe()));

create or replace function public.rota_068_recebido_dia(p_cd bigint)
returns date language sql stable security definer set search_path='' as $$
 select coalesce((select r.recebido_dia from public.rota_068h_reprogramacao r where r.cd_pedido=p_cd),
 (select e.data_entrega from public.pedido_entrega_rota e where e.cd_pedido=p_cd),
 (select max((ec.confirmado_em at time zone 'America/Sao_Paulo')::date) from public.pedido_entrega_confirmacao ec where ec.cd_pedido=p_cd and ec.desfeito_em is null),
 (select max((c.enviado_em at time zone 'America/Sao_Paulo')::date) from public.pedido_canhoto c where c.cd_pedido=p_cd and c.substituido_em is null),
 (select max(s.dia_saida) from public.rota_059_saidas s where s.cd_pedido=p_cd),
 (select (coalesce(e.dt_saida,e.dt_nota,e.dt_atendido) at time zone 'America/Sao_Paulo')::date
  from public.solidcon_pedidos_erp e where e.cd_pedido=p_cd and e.etapa in('saiu','atendido')
  and ((coalesce(e.dt_saida,e.dt_nota,e.dt_atendido) at time zone 'America/Sao_Paulo')::date<date '2026-11-23'
   or coalesce(e.dt_saida,e.dt_nota,e.dt_atendido)<(select cfg.canhoto_desde from public.rota_config cfg where cfg.id=1))));

$$;
revoke all on function public.rota_068_recebido_dia(bigint) from public,anon,authenticated,service_role;
create or replace function public.rota_068_pedido_entregue(p_cd bigint)
returns boolean language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or not coalesce(public.eh_equipe(),false) then raise exception 'somente equipe le historico' using errcode='42501';end if;
 return coalesce(public.rota_068_recebido_dia(p_cd)<public.rota_068_hoje(),false)
 and not exists(select 1 from public.pedido_entrega_problema p where p.cd_pedido=p_cd and p.desfeito_em is null)
 and not exists(select 1 from public.rota_068h_reprogramacao r where r.cd_pedido=p_cd and r.ativa);
end$$;
revoke all on function public.rota_068_pedido_entregue(bigint) from public,anon,authenticated,service_role;
grant execute on function public.rota_068_pedido_entregue(bigint) to authenticated;

drop function if exists public.rota_068_estados_pedidos(bigint[]);
create function public.rota_068_estados_pedidos(p_cds bigint[])
returns table(cd_pedido bigint,entregue boolean,reprogramado boolean,data_recebimento date,pendente boolean)
language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or not coalesce(public.eh_equipe(),false) then raise exception 'somente equipe le estado' using errcode='42501';end if;
 if p_cds is null or cardinality(p_cds)>300 or exists(select 1 from unnest(p_cds) c where c is null or c not between 1 and 999999999999) then raise exception 'pedidos invalidos' using errcode='22023';end if;
 return query select distinct c,public.rota_068_pedido_entregue(c),exists(select 1 from public.rota_068h_reprogramacao r where r.cd_pedido=c and r.ativa),public.rota_068_recebido_dia(c),public.rota_055_pendente(c,public.rota_068_hoje()) from unnest(p_cds) c;
end$$;
revoke all on function public.rota_068_estados_pedidos(bigint[]) from public,anon,authenticated,service_role;
grant execute on function public.rota_068_estados_pedidos(bigint[]) to authenticated;

-- Auxiliar autorizado tambem usado pelo DML direto INVOKER; nao permite destravar Historico.
create or replace function public.rota_068_reprogramar_explicito(p_cd bigint,p_dia date,p_veiculo text)
returns void language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or not coalesce(public.pode_marcar_rota(),false) then raise exception 'sem permissao' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(5100,5201);perform pg_catalog.pg_advisory_xact_lock(5100,5001);perform pg_catalog.pg_advisory_xact_lock(5100,4601);
 if public.rota_068_pedido_entregue(p_cd) then raise exception 'pedido_historico' using errcode='22023';end if;
 if not exists(select 1 from public.solidcon_pedidos_erp e where e.cd_pedido=p_cd) then raise exception 'pedido inexistente' using errcode='P0002';end if;
 insert into public.rota_068h_movimento_log(requisicao,cd_pedido,entrada,resultado,por)
 values(pg_catalog.gen_random_uuid(),p_cd,jsonb_build_object('acao','reprogramar','dia',p_dia,'veiculo',p_veiculo),jsonb_build_object('recebido_anterior',public.rota_068_recebido_dia(p_cd),'reprogramado',true),auth.uid());
 insert into public.rota_068h_reprogramacao as r(cd_pedido,ativa,dia,veiculo_id,por)
 values(p_cd,true,p_dia,p_veiculo,auth.uid())
 on conflict(cd_pedido) do update set ativa=true,dia=excluded.dia,veiculo_id=excluded.veiculo_id,
 criada_em=case when r.ativa then r.criada_em else pg_catalog.now() end,por=excluded.por,concluida_em=null;
end$$;
revoke all on function public.rota_068_reprogramar_explicito(bigint,date,text) from public,anon,authenticated,service_role;
grant execute on function public.rota_068_reprogramar_explicito(bigint,date,text) to authenticated;

create or replace function public.rota_068h_ordenar(p_dia date,p_veiculo text)
returns void language sql security definer set search_path='' as $$
 with ordens as(select p.cd_pedido,(row_number() over(order by p.ordem nulls last,p.cd_pedido))::integer n
 from public.rota_plano_semana p join public.rota_veiculos v on v.id=p.veiculo_id
 where p.dia=p_dia and p.veiculo_id=p_veiculo and not p.removido and v.modo='porta')
 update public.rota_plano_semana p set ordem=o.n from ordens o where p.cd_pedido=o.cd_pedido and p.ordem is distinct from o.n;
$$;
revoke all on function public.rota_068h_ordenar(date,text) from public,anon,authenticated,service_role;

create or replace function public.rota_068_mover_pedido(p_cd_pedido bigint,p_dia date,p_veiculo text,p_requisicao uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare oldp public.rota_plano_semana;tem boolean;v text;modo text;ord integer;ori jsonb;dest jsonb;res jsonb;inp jsonb;
 prev public.rota_068h_movimento_log;ini date;v_old bigint;
begin
 if auth.uid() is null or not coalesce(public.pode_marcar_rota(),false) then raise exception 'sem permissao mover' using errcode='42501';end if;
 if p_cd_pedido is null or p_cd_pedido not between 1 and 999999999999 or p_requisicao is null then return jsonb_build_object('status','erro','motivo','parametro_invalido');end if;
 perform pg_advisory_xact_lock(5100,5201);perform pg_advisory_xact_lock(5100,5001);perform pg_advisory_xact_lock(5100,4601);
 inp:=jsonb_build_object('cd_pedido',p_cd_pedido,'dia',p_dia,'veiculo',p_veiculo);
 select * into prev from public.rota_068h_movimento_log where requisicao=p_requisicao;
 if found then
  if prev.entrada<>inp then return jsonb_build_object('status','erro','motivo','requisicao_invalida');end if;
  return prev.resultado||jsonb_build_object('repetido',true,'entregue',public.rota_068_pedido_entregue(p_cd_pedido));
 end if;
 if public.rota_068_pedido_entregue(p_cd_pedido) then return jsonb_build_object('status','erro','motivo','pedido_historico','entregue',true);end if;
 if not exists(select 1 from public.solidcon_pedidos_erp e where e.cd_pedido=p_cd_pedido) then return jsonb_build_object('status','erro','motivo','pedido_nao_encontrado');end if;
 select * into oldp from public.rota_plano_semana where cd_pedido=p_cd_pedido for update;tem:=found;
 v:=coalesce(p_veiculo,case when tem then oldp.veiculo_id end,
 (select m.veiculo from public.rota_pedido_veiculo m where m.cd_pedido=p_cd_pedido),
 (select c.veiculo from public.rota_cliente_veiculo c join public.solidcon_pedidos_erp e on e.documento=c.documento where e.cd_pedido=p_cd_pedido),public.rota_054_padrao_separando());
 if not exists(select 1 from public.rota_veiculos z where z.id=v and z.ativo) then return jsonb_build_object('status','erro','motivo','veiculo_invalido');end if;
 if p_dia is not null then
  if p_dia not between date '2020-01-01' and date '2100-12-31' or extract(isodow from p_dia)=7 or not public.rota_065_dia_editavel(p_dia) then return jsonb_build_object('status','erro','motivo','dia_bloqueado');end if;
  if not public.rota_065_sai(v,p_dia) then return jsonb_build_object('status','erro','motivo','dia_sem_saida');end if;
 end if;
 if tem then
  ini:=oldp.dia-(extract(isodow from oldp.dia)::integer-1);
  ori:=jsonb_build_object('dia',oldp.dia,'veiculo_id',oldp.veiculo_id,'inicio',ini);
 end if;
 perform public.rota_068_reprogramar_explicito(p_cd_pedido,p_dia,v);
 if p_dia is null then delete from public.rota_plano_semana where cd_pedido=p_cd_pedido;
 else
  select z.modo into modo from public.rota_veiculos z where z.id=v;
  if modo='porta' then select coalesce(max(p.ordem),0)+1 into ord from public.rota_plano_semana p where p.dia=p_dia and p.veiculo_id=v and not p.removido and p.cd_pedido<>p_cd_pedido;end if;
  insert into public.rota_plano_semana as p(cd_pedido,dia,veiculo_id,ordem,removido) values(p_cd_pedido,p_dia,v,ord,false)
  on conflict(cd_pedido) do update set dia=excluded.dia,veiculo_id=excluded.veiculo_id,ordem=excluded.ordem,removido=false;
  perform public.rota_068h_ordenar(p_dia,v);
 end if;
 if tem and public.rota_065_linha_editavel(oldp.dia,oldp.veiculo_id) then perform public.rota_068h_ordenar(oldp.dia,oldp.veiculo_id);end if;
 if p_veiculo is not null then insert into public.rota_pedido_veiculo as m(cd_pedido,veiculo) values(p_cd_pedido,v) on conflict(cd_pedido) do update set veiculo=excluded.veiculo;end if;
 if tem then ori:=ori||jsonb_build_object('versao',coalesce((select s.versao from public.rota_065_semana s where s.inicio=ini),0));end if;
 if p_dia is not null then
  ini:=p_dia-(extract(isodow from p_dia)::integer-1);
  dest:=jsonb_build_object('dia',p_dia,'veiculo_id',v,'inicio',ini,'versao',coalesce((select s.versao from public.rota_065_semana s where s.inicio=ini),0));
 end if;
 res:=jsonb_build_object('status','ok','entregue',false,'reprogramado',true,'origem',ori,'destino',dest,'repetido',false);
 insert into public.rota_068h_movimento_log(requisicao,cd_pedido,entrada,resultado,por) values(p_requisicao,p_cd_pedido,inp,res,auth.uid());
 return res;
end$$;
revoke all on function public.rota_068_mover_pedido(bigint,date,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.rota_068_mover_pedido(bigint,date,text,uuid) to authenticated;

-- DML direto mantem destino065, mas a origem nao depende de data/veiculo antigo.
create or replace function public.rota_065_plano_guardar()
returns trigger language plpgsql security invoker set search_path='' as $$begin
 if current_user is distinct from 'authenticated' then return case when tg_op='DELETE' then old else new end;end if;
 if (tg_op in('UPDATE','DELETE') and public.rota_068_pedido_entregue(old.cd_pedido)) or (tg_op in('INSERT','UPDATE') and public.rota_068_pedido_entregue(new.cd_pedido)) then raise exception 'pedido_historico' using errcode='22023';end if;
 if tg_op in('INSERT','UPDATE') and not public.rota_065_linha_editavel(new.dia,new.veiculo_id) then raise exception 'dia destino nao editavel' using errcode='22023';end if;
 return case when tg_op='DELETE' then old else new end;
end$$;
create or replace function public.rota_068h_plano_reprogramar()
returns trigger language plpgsql security invoker set search_path='' as $$begin
 if current_user='authenticated' and (tg_op<>'UPDATE' or old.dia is distinct from new.dia or old.veiculo_id is distinct from new.veiculo_id or old.removido is distinct from new.removido) then
  perform public.rota_068_reprogramar_explicito(case when tg_op='DELETE' then old.cd_pedido else new.cd_pedido end,
   case when tg_op='DELETE' or new.removido then null else new.dia end,case when tg_op='DELETE' then old.veiculo_id else new.veiculo_id end);
 end if;return null;
end$$;
revoke all on function public.rota_068h_plano_reprogramar() from public,anon,authenticated,service_role;
drop trigger if exists rota_068h_plano_reprogramar on public.rota_plano_semana;
create trigger rota_068h_plano_reprogramar after insert or update or delete on public.rota_plano_semana for each row execute function public.rota_068h_plano_reprogramar();
create or replace function public.rota_068h_plano_travar()
returns trigger language plpgsql security invoker set search_path='' as $$begin
 if current_user='authenticated' then perform pg_catalog.pg_advisory_xact_lock(5100,5201);perform pg_catalog.pg_advisory_xact_lock(5100,5001);end if;return null;
end$$;
revoke all on function public.rota_068h_plano_travar() from public,anon,authenticated,service_role;
drop trigger if exists rota_000_068h_plano_travar on public.rota_plano_semana;
create trigger rota_000_068h_plano_travar before insert or update or delete on public.rota_plano_semana for each statement execute function public.rota_068h_plano_travar();

-- TrocaA usa exatamente a mesma flag, nao etapaERP/059 isolada.
create or replace function public.rota_068_veiculo_saiu(p_cd bigint)
returns boolean language sql volatile security definer set search_path='' as $$select not coalesce(public.pode_marcar_rota(),false) or public.rota_068_pedido_entregue(p_cd)$$;
-- Patches pontuais dos corpos aprovados + conclusao de reprogramacao, abaixo.
-- Corpos065/A aprovados com deltasH; gerados offline, nunca publicados automaticamente.
create or replace function public.rota_065_salvar_semana(p_inicio date, p_versao_base bigint, p_itens jsonb, p_veiculo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_versao bigint;
  v_cd bigint;
  v_n integer; v_068_antes jsonb; v_068_cd bigint;
  v_campos constant text[] := array['cd_pedido', 'dia', 'veiculo_id', 'ordem', 'removido'];
begin
  if not coalesce(public.pode_marcar_rota(), false) then
    raise exception 'sem permissao para salvar o plano' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(5100,5201);perform pg_catalog.pg_advisory_xact_lock(5100,5001);
  perform pg_catalog.pg_advisory_xact_lock(5100, 4601);
  -- Forma: lista de objetos com exatamente as 5 chaves e os tipos do contrato.
  if p_inicio is null or extract(isodow from p_inicio) <> 1 or p_versao_base is null or p_versao_base < 0
     or p_itens is null or pg_catalog.jsonb_typeof(p_itens) <> 'array' or pg_catalog.jsonb_array_length(p_itens) > 3000
     or exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e
                 where pg_catalog.jsonb_typeof(e) <> 'object' or not (e ?& v_campos)
                    or exists (select 1 from pg_catalog.jsonb_object_keys(e) k where not (k = any (v_campos)))
                    or pg_catalog.jsonb_typeof(e -> 'cd_pedido') <> 'number' or (e ->> 'cd_pedido') !~ '^[1-9][0-9]{0,11}$'
                    or pg_catalog.jsonb_typeof(e -> 'dia') <> 'string' or (e ->> 'dia') !~ '^\d{4}-\d{2}-\d{2}$'
                    or pg_catalog.jsonb_typeof(e -> 'veiculo_id') <> 'string'
                    or pg_catalog.jsonb_typeof(e -> 'removido') <> 'boolean'
                    or (pg_catalog.jsonb_typeof(e -> 'ordem') <> 'null'
                        and (pg_catalog.jsonb_typeof(e -> 'ordem') <> 'number' or (e ->> 'ordem') !~ '^[1-9][0-9]{0,5}$'))) then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
  end if;
  begin
    if exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e where (e ->> 'dia')::date not between p_inicio and p_inicio + 5)
       or (p_veiculo is not null and exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e where e ->> 'veiculo_id' is distinct from p_veiculo)) then
      return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
    end if;
  exception when others then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
  end;
  select (e ->> 'cd_pedido')::bigint into v_cd from pg_catalog.jsonb_array_elements(p_itens) e
   group by (e ->> 'cd_pedido')::bigint having count(*) > 1 order by 1 limit 1;
  if found then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'pedido_duplicado', 'cd_pedido', v_cd);
  end if;
  if (p_veiculo is not null and not exists (select 1 from public.rota_veiculos v where v.id = p_veiculo and v.ativo))
     or exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e
                 where not exists (select 1 from public.rota_veiculos v where v.id = e ->> 'veiculo_id' and v.ativo)) then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'veiculo_invalido');
  end if;
  select (e->>'cd_pedido')::bigint into v_cd from pg_catalog.jsonb_array_elements(p_itens) e where public.rota_068_pedido_entregue((e->>'cd_pedido')::bigint) limit 1;
  if found then return pg_catalog.jsonb_build_object('status','erro','motivo','pedido_historico','cd_pedido',v_cd);end if;
  select (e ->> 'cd_pedido')::bigint into v_cd from pg_catalog.jsonb_array_elements(p_itens) e
   where not public.rota_065_dia_editavel((e ->> 'dia')::date) order by 1 limit 1;
  if found then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'dia_bloqueado', 'cd_pedido', v_cd);
  end if;
  -- B065-R3: a ORIGEM tambem conta. Pedido ja salvo em linha travada (hoje, fechado, passado desta semana, veiculo
  -- inativo/sem saida) nao e movido pelo ON CONFLICT: recusa tudo, com o mesmo motivo e origem:true.
  select p.cd_pedido into v_cd from pg_catalog.jsonb_array_elements(p_itens) e
    join public.rota_plano_semana p on p.cd_pedido = (e ->> 'cd_pedido')::bigint
   where public.rota_068_pedido_entregue(p.cd_pedido) order by 1 limit 1;
  if found then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'pedido_historico', 'cd_pedido', v_cd, 'origem', true);
  end if;
  select (e ->> 'cd_pedido')::bigint into v_cd from pg_catalog.jsonb_array_elements(p_itens) e
   where not public.rota_065_sai(e ->> 'veiculo_id', (e ->> 'dia')::date) order by 1 limit 1;
  if found then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'dia_sem_saida', 'cd_pedido', v_cd);
  end if;
  select (e ->> 'cd_pedido')::bigint into v_cd from pg_catalog.jsonb_array_elements(p_itens) e
   where not exists (select 1 from public.solidcon_pedidos_erp p where p.cd_pedido = (e ->> 'cd_pedido')::bigint) order by 1 limit 1;
  if found then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'pedido_inexistente', 'cd_pedido', v_cd);
  end if;
  -- Ordem: removido e CD/CEASA = null; porta = 1..N sem buracos por (dia, veiculo).
  select (e ->> 'cd_pedido')::bigint into v_cd from pg_catalog.jsonb_array_elements(p_itens) e
    join public.rota_veiculos v on v.id = e ->> 'veiculo_id'
   where ((e ->> 'removido')::boolean or v.modo = 'cd_ceasa') and e -> 'ordem' <> 'null'::jsonb
      or not (e ->> 'removido')::boolean and v.modo = 'porta' and e -> 'ordem' = 'null'::jsonb
   order by 1 limit 1;
  if found then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'ordem_invalida', 'cd_pedido', v_cd);
  end if;
  if exists (select 1 from (
        select count(*) n, count(distinct (e ->> 'ordem')::integer) d, max((e ->> 'ordem')::integer) mx
          from pg_catalog.jsonb_array_elements(p_itens) e join public.rota_veiculos v on v.id = e ->> 'veiculo_id'
         where v.modo = 'porta' and not (e ->> 'removido')::boolean
         group by e ->> 'dia', e ->> 'veiculo_id') g where g.n <> g.d or g.mx <> g.n) then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'ordem_invalida');
  end if;
  -- Concorrencia: so grava sobre a versao que o quadro leu (o lock acima serializa com 046/047/065).
  v_versao := coalesce((select s.versao from public.rota_065_semana s where s.inicio = p_inicio), 0);
  if v_versao <> p_versao_base then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'versao_antiga', 'versao', v_versao);
  end if;
  -- B065-R3: so linha editavel COMPLETA (dia + veiculo ativo que sai); as outras ficam como estao.
  select coalesce(jsonb_object_agg(p.cd_pedido,jsonb_build_object('dia',p.dia,'veiculo_id',p.veiculo_id,'removido',p.removido)),'{}'::jsonb) into v_068_antes from public.rota_plano_semana p where (p.dia between p_inicio and p_inicio+5 and (p_veiculo is null or p.veiculo_id=p_veiculo)) or p.cd_pedido in(select (e->>'cd_pedido')::bigint from jsonb_array_elements(p_itens) e);
  delete from public.rota_plano_semana p
   where p.dia between p_inicio and p_inicio + 5 and public.rota_065_linha_editavel(p.dia, p.veiculo_id) and not public.rota_068_pedido_entregue(p.cd_pedido)
     and (p_veiculo is null or p.veiculo_id = p_veiculo);
  insert into public.rota_plano_semana as r (cd_pedido, dia, veiculo_id, ordem, removido)
  select (e ->> 'cd_pedido')::bigint, (e ->> 'dia')::date, e ->> 'veiculo_id', (e ->> 'ordem')::integer, (e ->> 'removido')::boolean
    from pg_catalog.jsonb_array_elements(p_itens) e
  on conflict (cd_pedido) do update set dia = excluded.dia, veiculo_id = excluded.veiculo_id, ordem = excluded.ordem, removido = excluded.removido;
  get diagnostics v_n = row_count;
  for v_068_cd in select distinct cd from (select key::bigint cd from jsonb_each(v_068_antes) union all select (e->>'cd_pedido')::bigint from jsonb_array_elements(p_itens) e) z loop
   if coalesce(v_068_antes->v_068_cd::text,'null'::jsonb) is distinct from coalesce((select jsonb_build_object('dia',p.dia,'veiculo_id',p.veiculo_id,'removido',p.removido) from public.rota_plano_semana p where p.cd_pedido=v_068_cd),'null'::jsonb) and not public.rota_068_pedido_entregue(v_068_cd) then
    perform public.rota_068_reprogramar_explicito(v_068_cd,(select case when not p.removido then p.dia end from public.rota_plano_semana p where p.cd_pedido=v_068_cd),(select p.veiculo_id from public.rota_plano_semana p where p.cd_pedido=v_068_cd));
   end if;
  end loop;
  perform public.rota_065_subir(p_inicio);   -- sobe mesmo salvando igual/vazio: quem leu antes relê
  return pg_catalog.jsonb_build_object('status', 'ok', 'itens', v_n,
    'versao', (select s.versao from public.rota_065_semana s where s.inicio = p_inicio));
end;
$$;
create or replace function public.rota_047_salvar_semana(p_inicio date, p_veiculo text, p_itens jsonb)
returns integer
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_n integer;
  v_falta bigint;
  v_dias smallint[];
begin
  if not public.pode_marcar_rota() then
    raise exception 'sem permissao para salvar o plano' using errcode = '42501';
  end if;
  -- Trava comum das gravacoes do plano (a mesma da 046), ANTES de ler/apagar a semana.
  perform pg_catalog.pg_advisory_xact_lock(5100,5201);perform pg_catalog.pg_advisory_xact_lock(5100,5001);
  perform pg_catalog.pg_advisory_xact_lock(5100, 4601);
  select v.dias_sem_saida into v_dias from public.rota_veiculos v where v.id = p_veiculo and v.ativo and v.modo = 'porta';
  if not found or p_inicio is null or extract(isodow from p_inicio) <> 1 or p_itens is null
     or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 3000 then
    raise exception 'parametro invalido' using errcode = '22023';
  end if;
  begin
    select count(*) filter (where i.cd_pedido is null or i.dia is null or i.dia < p_inicio or i.dia > p_inicio + 5
                                  or extract(dow from i.dia)::smallint = any (v_dias)),
           count(*) - count(distinct i.cd_pedido)
      into v_n, v_falta
      from jsonb_to_recordset(p_itens) as i(cd_pedido bigint, dia date);
  exception when others then
    raise exception 'parametro invalido' using errcode = '22023';
  end;
  if v_n > 0 or v_falta > 0 then
    raise exception 'parametro invalido' using errcode = '22023';
  end if;
  select i.cd_pedido into v_falta from jsonb_to_recordset(p_itens) as i(cd_pedido bigint, dia date)
   where not exists (select 1 from public.solidcon_pedidos_erp e where e.cd_pedido = i.cd_pedido)
   order by i.cd_pedido limit 1;
  if found then
    raise exception 'pedido % nao encontrado', v_falta using errcode = 'P0002';
  end if;
  delete from public.rota_plano_semana p
   where p.veiculo_id = p_veiculo and p.dia between p_inicio and p_inicio + 5
     and public.rota_065_linha_editavel(p.dia, p.veiculo_id) and not public.rota_068_pedido_entregue(p.cd_pedido);
  insert into public.rota_plano_semana as r (cd_pedido, dia, veiculo_id, ordem, removido)
    select k.cd_pedido, k.dia, p_veiculo, (row_number() over (partition by k.dia order by k.pos))::integer, false
      from (select i.cd_pedido, i.dia, i.pos
              from rows from (jsonb_to_recordset(p_itens) as (cd_pedido bigint, dia date)) with ordinality as i(cd_pedido, dia, pos)
             where public.rota_065_linha_editavel(i.dia, p_veiculo)
               and not exists (select 1 from public.rota_plano_semana o
                                where o.cd_pedido = i.cd_pedido and public.rota_068_pedido_entregue(o.cd_pedido))) k
    on conflict (cd_pedido) do update set dia = excluded.dia, veiculo_id = excluded.veiculo_id, ordem = excluded.ordem, removido = false;
  select count(*) into v_n from public.rota_plano_semana where veiculo_id = p_veiculo and dia between p_inicio and p_inicio + 5;
  return v_n;
end;
$$;
create or replace function public.rota_065_ler_semana(p_inicio date)
returns jsonb
language plpgsql
stable
security definer   -- usa rota_050_hoje (privada); acesso conferido abaixo
set search_path = ''
as $$
begin
  if not coalesce(public.eh_equipe(), false) then
    raise exception 'equipe necessaria' using errcode = '42501';
  end if;
  if p_inicio is null or extract(isodow from p_inicio) <> 1 then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
  end if;
  return pg_catalog.jsonb_build_object(
    'status', 'ok', 'inicio', p_inicio, 'hoje', public.rota_050_hoje(),
    'pedidos_estado',coalesce((select jsonb_object_agg(e.cd_pedido,jsonb_build_object('entregue',public.rota_068_pedido_entregue(e.cd_pedido),'reprogramado',exists(select 1 from public.rota_068h_reprogramacao r where r.cd_pedido=e.cd_pedido and r.ativa),'data_recebimento',public.rota_068_recebido_dia(e.cd_pedido),'pendente',public.rota_055_pendente(e.cd_pedido,public.rota_068_hoje()))) from (select cd_pedido from public.solidcon_pedidos_erp union select cd_pedido from public.rota_plano_semana union select cd_pedido from public.pedido_entrega_rota union select cd_pedido from public.pedido_entrega_confirmacao) e),'{}'::jsonb),
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
$$;
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
  return pg_catalog.jsonb_build_object('status','erro','motivo','pedido_historico');
 end if;
 if v_doc is not null then select c.veiculo into v_padrao from public.rota_cliente_veiculo c where c.documento=v_doc;end if;
 -- null limpa marcacao; o plano adota o padrao que restara apos a regra044 (fallback operacional054).
 v_destino:=coalesce(p_veiculo,case when p_escopo='pedido' then v_padrao end,public.rota_054_padrao_separando());
 select p.* into v_plano from public.rota_plano_semana p where p.cd_pedido=p_cd_pedido for update;
 v_tem_plano:=found;
 if v_tem_plano then
  if not public.rota_065_sai(v_destino,v_plano.dia) then return jsonb_build_object('status','erro','motivo','dia_sem_saida');end if;
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
 perform public.rota_068_reprogramar_explicito(p_cd_pedido,case when v_tem_plano then v_plano.dia end,v_destino);
 return pg_catalog.jsonb_build_object('status','ok','resultado',v_resultado,'entregue',false,'reprogramado',true,
  'plano',case when v_tem_plano then pg_catalog.jsonb_build_object('dia',v_plano.dia,'veiculo_id',v_destino,'inicio',v_inicio,'versao',v_versao) else null end);
end$$;


-- Compatibilidade C: snapshot/auditoria continuam; reprogramacao altera apenas elegibilidade atual.
do $$declare d text;begin
 select def into d from public.rota_068h3_backup where nome='public.rota_055_pendente(bigint,date)';
 execute replace(d,'public.rota_055_pendente','public.rota_068h_pendente_base');
 select def into d from public.rota_068h3_backup where nome='public.rota_068_entrega_capturar(bigint[])';
 execute replace(d,'public.rota_068_entrega_capturar','public.rota_068h_capturar_base');
end$$;
revoke all on function public.rota_068h_pendente_base(bigint,date),public.rota_068h_capturar_base(bigint[]) from public,anon,authenticated,service_role;
create or replace function public.rota_055_pendente(p_cd bigint,p_dia date)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rota_068h_reprogramacao r join public.solidcon_pedidos_erp e on e.cd_pedido=r.cd_pedido where r.cd_pedido=p_cd and r.ativa)
 or (not coalesce(public.rota_068_recebido_dia(p_cd)<public.rota_068_hoje(),false) and public.rota_068h_pendente_base(p_cd,p_dia));
$$;
-- Depois de uma NOVA inclusao/fechamento da rota (nunca a foto antiga), encerra tentativa explicita.
create or replace function public.rota_068_entrega_capturar(p_cds bigint[] default null)
returns void language plpgsql volatile security definer set search_path='' as $$begin
 perform public.rota_068h_capturar_base(p_cds);
 with saidas as(
  select r.cd_pedido,min(i.data) dia from public.rota_068h_reprogramacao r
  join public.rota_dia_item i on i.cd_pedido=r.cd_pedido and i.removido_em is null
  join public.rota_dia_fechada f on f.data=i.data and f.estado='fechada'
  where r.ativa and (p_cds is null or r.cd_pedido=any(p_cds)) and (r.dia is null or r.dia=i.data)
  and (i.incluido_em>=r.criada_em or f.fechada_em>=r.criada_em)
  group by r.cd_pedido
 ) update public.rota_068h_reprogramacao r set ativa=false,recebido_dia=s.dia,concluida_em=pg_catalog.clock_timestamp() from saidas s where r.cd_pedido=s.cd_pedido;
end$$;

-- Campo adicional opcional063 conserva consumidores antigos; coreH interpreta reprogramado como pendente.
drop function public.rota_063_ler_entregas(bigint[]);
create function public.rota_063_ler_entregas(p_cds bigint[])
returns table(cd_pedido bigint,id bigint,confirmado_em timestamptz,confirmado_nome text,reprogramado boolean)
language plpgsql stable security definer set search_path='' as $$begin
 if coalesce(auth.role(),'')<>'service_role' and (auth.uid() is null or not coalesce(public.eh_equipe(),false)) then raise exception 'somente equipe le status de entrega' using errcode='42501';end if;
 if p_cds is null or cardinality(p_cds)>300 or exists(select 1 from unnest(p_cds) x where x is null or x not between 1 and 999999999999) then raise exception 'pedidos invalidos' using errcode='22023';end if;
 return query
 select e.cd_pedido,e.cd_pedido,coalesce(r.recebido_dia,e.data_entrega)::timestamp at time zone 'America/Sao_Paulo',null::text,false
 from public.pedido_entrega_rota e left join public.rota_068h_reprogramacao r on r.cd_pedido=e.cd_pedido
 where e.cd_pedido=any(p_cds) and not coalesce(r.ativa,false)
 union all
 select ec.cd_pedido,ec.id,coalesce(r.recebido_dia::timestamp at time zone 'America/Sao_Paulo',ec.confirmado_em),ec.confirmado_nome,false
 from public.pedido_entrega_confirmacao ec left join public.rota_068h_reprogramacao r on r.cd_pedido=ec.cd_pedido
 where ec.cd_pedido=any(p_cds) and ec.desfeito_em is null and not coalesce(r.ativa,false)
 and not exists(select 1 from public.pedido_entrega_rota e where e.cd_pedido=ec.cd_pedido)
 union all
 select r.cd_pedido,r.cd_pedido,r.criada_em,null::text,true from public.rota_068h_reprogramacao r where r.cd_pedido=any(p_cds) and r.ativa;
end$$;
revoke all on function public.rota_063_ler_entregas(bigint[]) from public,anon,authenticated,service_role;
grant execute on function public.rota_063_ler_entregas(bigint[]) to authenticated,service_role;
-- Projecao canonicaC usa a data da tentativa atual; snapshots/fontes antigas continuam intactos.
do $$declare d text;begin
 select def into d from public.rota_068h3_backup where nome='public.rota_068_entregas(date,date)';
 d:=replace(d,'select er.cd_pedido,er.data_entrega,','select er.cd_pedido,coalesce((select h.recebido_dia from public.rota_068h_reprogramacao h where h.cd_pedido=er.cd_pedido),er.data_entrega) as data_entrega,');
 d:=replace(d,$old$select ec.cd_pedido,(ec.confirmado_em at time zone 'America/Sao_Paulo')::date,$old$,$new$select ec.cd_pedido,coalesce((select h.recebido_dia from public.rota_068h_reprogramacao h where h.cd_pedido=ec.cd_pedido),(ec.confirmado_em at time zone 'America/Sao_Paulo')::date),$new$);
 execute d;
end$$;
notify pgrst,'reload schema';
commit;
