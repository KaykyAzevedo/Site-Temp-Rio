-- Rollback065: volta rota_050_gravar_itens EXATO da 055 e rota_054_candidatos/rota_054_incluir EXATOS da 061 (o plano
-- deixa de valer no fechamento e na inclusao separando) e remove as RPCs/gatilhos 065. A 047 fica no corpo compativel
-- (programacao legada ativa: removido=false, ordem 1..N), sem depender da 065.
-- PRESERVA dados: colunas ordem/removido de rota_plano_semana, rota_065_semana e rota_065_sem_saida (auditoria/reaplicacao).
-- Reverter o painel junto: sem as RPCs 065 o quadro cai no rota_047_salvar_semana (PGRST202/42883).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_catalog.pg_advisory_xact_lock(5100, 5201);
select pg_catalog.pg_advisory_xact_lock(5100, 5001);
select pg_catalog.pg_advisory_xact_lock(5100, 4601);
create or replace function public.rota_050_gravar_itens(p_data date, p_itens jsonb, p_uid uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e where not exists (
        select 1 from public.solidcon_pedidos_erp p
         where p.cd_pedido = (e ->> 'cd_pedido')::bigint and public.rota_055_pendente(p.cd_pedido,public.rota_050_hoje()))) then
    raise exception 'pedido nao esta em aberto no ERP' using errcode = 'P0002';
  end if;
  insert into public.rota_dia_item (data, cd_pedido, documento, veiculo_id, ordem, origem, incluido_por)
  select p_data, p.cd_pedido, p.documento, e ->> 'veiculo_id', (e ->> 'ordem')::integer, 'previsao', p_uid
    from pg_catalog.jsonb_array_elements(p_itens) e
    join public.solidcon_pedidos_erp p on p.cd_pedido = (e ->> 'cd_pedido')::bigint;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.rota_050_gravar_itens(date, jsonb, uuid) from public, anon, authenticated;
-- B065-R2: candidatos/inclusao 054 voltam EXATOS da 061 (sem plano; trava so 5001).
create or replace function public.rota_054_candidatos(p_data date)
returns table(cd_pedido bigint,documento text,veiculo_id text)
language sql stable security definer set search_path=''
as $$
 select p.cd_pedido,p.documento,coalesce(m.veiculo,c.veiculo,public.rota_054_padrao_separando())
 from public.solidcon_pedidos_erp p
 left join public.rota_pedido_veiculo m on m.cd_pedido=p.cd_pedido
 left join public.rota_cliente_veiculo c on c.documento=p.documento
 where public.rota_061_auto_aberta(p_data)
   and (p.etapa='separando' or (
     (p.dt_sep_inicio at time zone 'America/Sao_Paulo')::date<p_data
     and (p.dt_sep_inicio at time zone 'America/Sao_Paulo')::time>
       coalesce((select pg_catalog.make_time(extract(hour from cfg.hora_saida)::integer,extract(minute from cfg.hora_saida)::integer,0) from public.rota_config cfg where cfg.id=1),time '07:00')))
   and public.rota_055_pendente(p.cd_pedido,p_data)
   and public.rota_054_tem_saida(p_data,coalesce(m.veiculo,c.veiculo,public.rota_054_padrao_separando()))
   and not exists(select 1 from public.rota_pedido_ignorado g where g.cd_pedido=p.cd_pedido)
   and not exists(select 1 from public.rota_dia_item x where x.data=p_data and x.cd_pedido=p.cd_pedido)
   -- RF-3: remover de hoje tira o cliente inteiro, inclusive pedidos que chegam depois.
   and not exists(select 1 from public.rota_dia_item x where x.data=p_data and x.removido_em is not null and x.documento=p.documento)
 order by p.cd_pedido
$$;
create or replace function public.rota_054_incluir(p_data date,p_revisao integer,p_ordem jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_hoje date:=public.rota_050_hoje(); v_rev integer; v_estado text; v_novos jsonb; v_veics text[];
 v_esperados jsonb; v_recebidos jsonb; v_n integer; v_uid uuid:=auth.uid();
begin
 if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.pode_marcar_rota(),false) then
   raise exception 'sem permissao para incluir separando' using errcode='42501';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(5100,5001);
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
 select pg_catalog.array_agg(distinct x->>'veiculo_id') into v_veics from pg_catalog.jsonb_array_elements(v_novos) x;
 select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(e.cd,e.veic) order by e.cd) into v_esperados from (
   select i.cd_pedido cd,i.veiculo_id veic from public.rota_dia_item i where i.data=v_hoje and i.veiculo_id=any(v_veics) and i.removido_em is null
   union all select (x->>'cd_pedido')::bigint,x->>'veiculo_id' from pg_catalog.jsonb_array_elements(v_novos) x
 ) e;
 select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array((x->>'cd_pedido')::bigint,x->>'veiculo_id') order by (x->>'cd_pedido')::bigint)
   into v_recebidos from pg_catalog.jsonb_array_elements(p_ordem) x;
 if v_esperados is distinct from v_recebidos then
   raise exception 'pedidos/veiculos mudaram: recalcule a proposta' using errcode='40001';
 end if;
 insert into public.rota_dia_item(data,cd_pedido,documento,veiculo_id,ordem,origem,incluido_por)
 select v_hoje,(x->>'cd_pedido')::bigint,x->>'documento',x->>'veiculo_id',null,'separando',v_uid
 from pg_catalog.jsonb_array_elements(v_novos) x;
 update public.rota_dia_item i set ordem=(x->>'ordem')::integer from pg_catalog.jsonb_array_elements(p_ordem) x
 where i.data=v_hoje and i.cd_pedido=(x->>'cd_pedido')::bigint;
 update public.rota_dia_fechada set alterada_em=pg_catalog.now(),revisao=revisao+1 where data=v_hoje;
 insert into public.rota_dia_log(data,acao,detalhe,por,por_nome)
 values(v_hoje,'adicionar',pg_catalog.left('Separando automatico: '||v_n||' pedido(s); veiculos '||pg_catalog.array_to_string(v_veics,','),200),v_uid,public.rota_050_nome(v_uid));
 return pg_catalog.jsonb_build_object('incluidos',v_n,'revisao',v_rev+1,'foto',public.rota_050_ler(v_hoje));
end$$;
revoke all on function public.rota_054_candidatos(date) from public,anon,authenticated,service_role;
revoke all on function public.rota_054_incluir(date,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.rota_054_incluir(date,integer,jsonb) to authenticated,service_role;
-- B065-R4: a 047 NAO volta ao corpo antigo (removido/ordem ficam na tabela depois do rollback e a 065 pode ser
-- reaplicada): mesma regra da 047, mas a programacao legada e ATIVA (removido=false) e ordem 1..N por dia, tambem no
-- ON CONFLICT. Sem dependencia das funcoes 065 (removidas abaixo). A 046 (S10) continua chamando esta.
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
  delete from public.rota_plano_semana where veiculo_id = p_veiculo and dia between p_inicio and p_inicio + 5;
  insert into public.rota_plano_semana as r (cd_pedido, dia, veiculo_id, ordem, removido)
    select i.cd_pedido, i.dia, p_veiculo, (row_number() over (partition by i.dia order by i.pos))::integer, false
      from rows from (jsonb_to_recordset(p_itens) as (cd_pedido bigint, dia date)) with ordinality as i(cd_pedido, dia, pos)
    on conflict (cd_pedido) do update set dia = excluded.dia, veiculo_id = excluded.veiculo_id, ordem = excluded.ordem, removido = false;
  select count(*) into v_n from public.rota_plano_semana where veiculo_id = p_veiculo and dia between p_inicio and p_inicio + 5;
  return v_n;
end;
$$;
revoke all on function public.rota_047_salvar_semana(date, text, jsonb) from public, anon;
grant execute on function public.rota_047_salvar_semana(date, text, jsonb) to authenticated;
drop trigger if exists rota_065_plano_guardar on public.rota_plano_semana;
drop trigger if exists rota_065_plano_versao on public.rota_plano_semana;
drop function if exists public.rota_065_plano_guardar();
drop function if exists public.rota_065_fora_auto(bigint, date, text);
drop function if exists public.rota_065_pos_corte(bigint, date);
drop function if exists public.rota_065_travada(date, text);
drop function if exists public.rota_065_linha_editavel(date, text);
drop function if exists public.rota_065_ler_semana(date);
drop function if exists public.rota_065_salvar_semana(date, bigint, jsonb, text);
drop function if exists public.rota_065_marcar_sem_saida(date, text, boolean, bigint, text);
drop function if exists public.rota_065_aplicar_plano(date, jsonb);
drop function if exists public.rota_065_plano_versao();
drop function if exists public.rota_065_dia_editavel(date);
drop function if exists public.rota_065_sai(text, date);
drop function if exists public.rota_065_subir(date);
notify pgrst, 'reload schema';
commit;
