-- Rollback061: restaurar tambem core/site/Edge. Nao desfaz reparo de dados separado.
-- Nao move nenhum item existente. Aplicar junto com site e whatsapp-rotinas.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
select pg_catalog.pg_advisory_xact_lock(5100,61);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
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
create or replace function public.rota_054_candidatos(p_data date)
returns table(cd_pedido bigint,documento text,veiculo_id text)
language sql stable security definer set search_path=''
as $$
 select p.cd_pedido,p.documento,coalesce(m.veiculo,c.veiculo,public.rota_054_padrao_separando())
 from public.solidcon_pedidos_erp p
 left join public.rota_pedido_veiculo m on m.cd_pedido=p.cd_pedido
 left join public.rota_cliente_veiculo c on c.documento=p.documento
 where p.etapa='separando' and public.rota_055_pendente(p.cd_pedido,p_data)
   and public.rota_054_tem_saida(p_data,coalesce(m.veiculo,c.veiculo,public.rota_054_padrao_separando()))
   and not exists(select 1 from public.rota_pedido_ignorado g where g.cd_pedido=p.cd_pedido)
   and not exists(select 1 from public.rota_dia_item x where x.data=p_data and x.cd_pedido=p.cd_pedido)
   -- RF-3: remover de hoje tira o cliente inteiro, inclusive pedidos que chegam depois.
   and not exists(select 1 from public.rota_dia_item x where x.data=p_data and x.removido_em is not null and x.documento=p.documento)
 order by p.cd_pedido
$$;
create or replace function public.rota_055_pendente(p_cd bigint,p_dia date)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.solidcon_pedidos_erp p
   cross join lateral (select coalesce(p.dt_saida,p.dt_nota,p.dt_atendido) as em) fat
   cross join lateral (select coalesce((select pg_catalog.make_time(extract(hour from c.hora_saida)::integer,extract(minute from c.hora_saida)::integer,0) from public.rota_config c where c.id=1),time '07:00') as hora) cfg
   where p.cd_pedido=p_cd
   and not exists(select 1 from public.pedido_canhoto c where c.cd_pedido=p.cd_pedido and c.substituido_em is null)
   and (p.etapa in ('aberto','na_carga','separando','separado','conferido')
     or (p.etapa in ('saiu','atendido') and fat.em is not null
       and ((select c.canhoto_desde from public.rota_config c where c.id=1) is null
         or fat.em>=(select c.canhoto_desde from public.rota_config c where c.id=1))
       and coalesce((select s.dia_saida from public.rota_059_saidas s where s.cd_pedido=p.cd_pedido),
         (fat.em at time zone 'America/Sao_Paulo')::date +
         case when (fat.em at time zone 'America/Sao_Paulo')::time > cfg.hora then 1 else 0 end)>=p_dia-7)))
$$;
drop function if exists public.rota_061_auto_aberta(date);

create or replace function public.rota_050_fechar_auto(p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.rota_050_hoje();
  v_saida time;
begin
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
  return pg_catalog.jsonb_build_object('fechou', true, 'rota', public.rota_050_fechar_hoje(p_itens, null, true));
end;
$$;
notify pgrst,'reload schema';
commit;
