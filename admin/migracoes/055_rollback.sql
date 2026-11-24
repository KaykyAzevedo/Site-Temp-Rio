-- Rollback055: volta aos filtros anteriores; preserva canhotos/fotos/ordens/revisoes.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
select pg_catalog.pg_advisory_xact_lock(5100,55);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
drop trigger if exists rota_055_canhoto_ins on public.pedido_canhoto;
drop trigger if exists rota_055_canhoto_upd on public.pedido_canhoto;
drop trigger if exists rota_055_canhoto_del on public.pedido_canhoto;
drop function if exists public.rota_055_canhoto_revisao();
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
         where p.cd_pedido = (e ->> 'cd_pedido')::bigint and p.etapa in ('aberto', 'na_carga', 'separando', 'separado', 'conferido'))) then
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

create or replace function public.rota_050_ajustar(p_acao text, p_cds bigint[], p_veiculo text, p_ordem jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
           and p.etapa in ('aberto', 'na_carga', 'separando', 'separado', 'conferido')) <> (select count(distinct x) from pg_catalog.unnest(p_cds) x) then
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
$$;

create or replace function public.rota_050_envio_ok(p_data date, p_veic text, p_paradas jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_pub text; v_esp text; v_cd boolean;
begin
  if not exists (select 1 from public.rota_dia_fechada f where f.data = p_data and f.estado = 'fechada') then
    return true;
  end if;
  p_paradas := case when pg_catalog.jsonb_typeof(p_paradas) = 'array' then p_paradas else '[]'::jsonb end;
  v_cd := exists (select 1 from pg_catalog.jsonb_array_elements(p_paradas) p where pg_catalog.jsonb_typeof(p -> 'itens') = 'array');
  -- enviado: grupos (parada; no CD, tudo junto) na ordem das paradas; dentro do grupo, codigos em ordem
  with par as (
    select p, n, case when pg_catalog.jsonb_typeof(p -> 'ordem') = 'number' then (p ->> 'ordem')::numeric else n end o
      from pg_catalog.jsonb_array_elements(p_paradas) with ordinality t(p, n)
  ), cds as (
    select case when v_cd then 0 else par.o end o, case when v_cd then 0 else par.n end n, (x #>> '{}')::bigint cd
      from par cross join lateral (
        select e from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(par.p -> 'pedidos') = 'array' then par.p -> 'pedidos' else '[]'::jsonb end) e
        union all
        select e from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(par.p -> 'itens') = 'array' then par.p -> 'itens' else '[]'::jsonb end) it
          cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(it -> 'pedidos') = 'array' then it -> 'pedidos' else '[]'::jsonb end) e
      ) y(x)
     where pg_catalog.jsonb_typeof(x) = 'number'
  ), g as (select o, n, pg_catalog.string_agg(distinct cd::text, ',' order by cd::text) gr from cds group by o, n)
  select coalesce(pg_catalog.string_agg(gr, '|' order by o, n), '') into v_pub from g;
  -- esperado: itens ativos da foto (em aberto, nao tirados da rota), agrupados pela ordem salva
  with esp as (
    select case when v_cd then 0 else coalesce(i.ordem, 2147483647) end o, i.cd_pedido cd
      from public.rota_dia_item i
      join public.solidcon_pedidos_erp p on p.cd_pedido = i.cd_pedido and p.etapa in ('aberto', 'na_carga', 'separando', 'separado', 'conferido')
     where i.data = p_data and i.veiculo_id = p_veic and i.removido_em is null
       and not exists (select 1 from public.rota_pedido_ignorado r where r.cd_pedido = i.cd_pedido)
  ), g as (select o, pg_catalog.string_agg(cd::text, ',' order by cd::text) gr from esp group by o)
  select coalesce(pg_catalog.string_agg(gr, '|' order by o), '') into v_esp from g;
  return v_pub = v_esp;
end;
$$;

create or replace function public.rota_054_candidatos(p_data date)
returns table(cd_pedido bigint,documento text,veiculo_id text)
language sql stable security definer set search_path=''
as $$
 select p.cd_pedido,p.documento,coalesce(m.veiculo,c.veiculo,public.rota_054_padrao_separando())
 from public.solidcon_pedidos_erp p
 left join public.rota_pedido_veiculo m on m.cd_pedido=p.cd_pedido
 left join public.rota_cliente_veiculo c on c.documento=p.documento
 where p.etapa='separando'
   and public.rota_054_tem_saida(p_data,coalesce(m.veiculo,c.veiculo,public.rota_054_padrao_separando()))
   and not exists(select 1 from public.rota_pedido_ignorado g where g.cd_pedido=p.cd_pedido)
   and not exists(select 1 from public.rota_dia_item x where x.data=p_data and x.cd_pedido=p.cd_pedido)
   -- RF-3: remover de hoje tira o cliente inteiro, inclusive pedidos que chegam depois.
   and not exists(select 1 from public.rota_dia_item x where x.data=p_data and x.removido_em is not null and x.documento=p.documento)
 order by p.cd_pedido
$$;

create or replace function public.rota_044_limpar()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare v_n integer;
begin
  delete from public.rota_pedido_veiculo v
   where v.atualizado_em < now() - interval '30 days'
     and not exists (select 1 from public.solidcon_pedidos_erp e
                      where e.cd_pedido = v.cd_pedido
                        and e.etapa in ('aberto', 'na_carga', 'separando', 'separado', 'conferido'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.rota_045_limpar()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare v_n integer;
begin
  delete from public.rota_pedido_ignorado g
   where g.atualizado_em < now() - interval '30 days'
     and not exists (select 1 from public.solidcon_pedidos_erp e
                      where e.cd_pedido = g.cd_pedido
                        and e.etapa in ('aberto', 'na_carga', 'separando', 'separado', 'conferido'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.rota_052_registrar(p_caminho text, p_cds bigint[], p_substituir boolean,
                                                   p_veiculo text default null, p_versao integer default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_veic text := public.rota_051_meu_veiculo();
  v_hoje date := (pg_catalog.now() at time zone 'America/Sao_Paulo')::date;
  v_origem text;
  v_n integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(5100,5201);
  if not public.rota_052_arquivo_livre(p_caminho) then
    raise exception 'ARQUIVO_EXPIRADO: canhoto reservado para retencao; preserve a pendencia original' using errcode='P5105';
  end if;
  if p_cds is null or pg_catalog.cardinality(p_cds) not between 1 and 15050
     or exists (select 1 from pg_catalog.unnest(p_cds) x where x is null or x not between 1 and 999999999999)
     or public.rota_052_caminho_valido(p_caminho) is distinct from true then
    raise exception 'canhoto invalido' using errcode = '22023';
  end if;
  if pg_catalog.split_part(p_caminho, '/', 2)::bigint <> all (p_cds) then
    raise exception 'o caminho precisa ser de um dos pedidos' using errcode = '22023';
  end if;
  if coalesce(public.pode_marcar_rota(), false) then
    v_origem := 'painel';
    if not exists (select 1 from storage.objects o where o.bucket_id = 'canhotos' and o.name = p_caminho) then
      raise exception 'arquivo do canhoto nao encontrado' using errcode = 'P0002';
    end if;
    if (select count(*) from public.solidcon_pedidos_erp p where p.cd_pedido = any (p_cds)) <> (select count(distinct x) from pg_catalog.unnest(p_cds) x) then
      raise exception 'pedido nao existe no ERP' using errcode = 'P0002';
    end if;
  elsif v_veic is not null then
    v_origem := 'motorista';
    -- Mesma recusa P5101 para replay antigo; o cliente preserva a foto. A trava da rota vale ate COMMIT.
    perform public.rota_051_validar_contexto(pg_catalog.split_part(p_caminho, '/', 1)::date, p_veiculo, p_versao);
    v_veic := p_veiculo;   -- usa o vinculo travado/validado, nao a leitura anterior a essa trava
    if coalesce(p_substituir, false) then
      raise exception 'o motorista nao troca canhoto (so o escritorio)' using errcode = '42501';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'canhotos' and o.name = p_caminho and o.owner = v_uid) then
      raise exception 'arquivo do canhoto nao encontrado' using errcode = 'P0002';
    end if;
    if exists (select 1 from pg_catalog.unnest(p_cds) x where x not in (select public.rota_051_cds_da_rota(v_hoje, v_veic))) then
      raise exception 'pedido nao esta na sua rota de hoje' using errcode = '42501';
    end if;
  else
    raise exception 'sem permissao para anexar canhoto' using errcode = '42501';
  end if;
  if coalesce(p_substituir, false) then
    update public.pedido_canhoto set substituido_em = pg_catalog.now(), substituido_por = v_uid
     where cd_pedido = any (p_cds) and substituido_em is null and caminho <> p_caminho;
  end if;
  insert into public.pedido_canhoto (cd_pedido, caminho, origem, enviado_por)
  select distinct x, p_caminho, v_origem, v_uid from pg_catalog.unnest(p_cds) x
  on conflict (cd_pedido, caminho) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.rota_052_remover(p_cd bigint, p_caminho text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.eh_admin(), false) then
    raise exception 'so o administrador remove canhoto' using errcode = '42501';
  end if;
  delete from public.pedido_canhoto where cd_pedido = p_cd and caminho = p_caminho;
  if not found then
    raise exception 'canhoto nao encontrado' using errcode = 'P0002';
  end if;
  return exists (select 1 from public.pedido_canhoto where caminho = p_caminho);
end;
$$;

create or replace function public.rota_052_limpeza_lote(p_limite integer default 100)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_corte timestamptz := ((pg_catalog.now() at time zone 'America/Sao_Paulo') - interval '1 year') at time zone 'America/Sao_Paulo';
  v_token uuid := pg_catalog.gen_random_uuid();
  v_caminhos text[];
  v_n integer;
begin
  if p_limite is null or p_limite not between 1 and 100 then
    raise exception 'limite de limpeza invalido' using errcode='22023';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(5100,5201) then
    return pg_catalog.jsonb_build_object('caminhos','[]'::jsonb,'ocupado',true);
  end if;
  -- Vinculos expirados sem arquivo, com arquivo recente ou compartilhado com vinculo recente.
  -- O arquivo recente tem seu proprio prazo; a idade do vinculo nao e renovada por sobrescrita.
  delete from public.pedido_canhoto c where c.enviado_em < v_corte and (
    not exists(select 1 from storage.objects o where o.bucket_id='canhotos' and o.name=c.caminho)
    or exists(select 1 from storage.objects o where o.bucket_id='canhotos' and o.name=c.caminho and o.created_at>=v_corte)
    or exists(select 1 from public.pedido_canhoto n where n.caminho=c.caminho and n.enviado_em>=v_corte));
  get diagnostics v_n = row_count;
  insert into public.rota_052_expurgo(caminho,corte)
  select o.name,v_corte from storage.objects o
   where o.bucket_id='canhotos' and o.created_at<v_corte
     and not exists(select 1 from public.pedido_canhoto c where c.caminho=o.name and c.enviado_em>=v_corte)
  on conflict(caminho) do nothing;
  with candidatos as (
    select q.caminho from public.rota_052_expurgo q where q.concluido_em is null
      and (q.reservado_em is null or q.reservado_em<pg_catalog.now()-interval '10 minutes')
    order by q.criado_em,q.caminho limit p_limite for update
  ), reservados as (
    update public.rota_052_expurgo q set token=v_token,reservado_em=pg_catalog.now(),tentativas=q.tentativas+1
      from candidatos c where q.caminho=c.caminho returning q.caminho
  ) select pg_catalog.array_agg(caminho order by caminho) into v_caminhos from reservados;
  return pg_catalog.jsonb_build_object('token',v_token,'caminhos',coalesce(v_caminhos,'{}'::text[]),'linhas',v_n);
end$$;

create or replace function public.rota_052_limpeza_confirmar(p_token uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(5100,5201);
  -- API removeu fisicamente? Nunca aceitar apenas a afirmacao do cliente/worker.
  if exists(select 1 from public.rota_052_expurgo q join storage.objects o on o.bucket_id='canhotos' and o.name=q.caminho
             where q.token=p_token and q.concluido_em is null) then
    raise exception 'arquivo ainda existe no Storage; lote preservado' using errcode='40001';
  end if;
  delete from public.pedido_canhoto c using public.rota_052_expurgo q
    where q.token=p_token and q.concluido_em is null and c.caminho=q.caminho and c.enviado_em<q.corte;
  get diagnostics v_n = row_count;
  update public.rota_052_expurgo set concluido_em=pg_catalog.now() where token=p_token and concluido_em is null;
  return v_n;
end$$;
drop function if exists public.rota_055_pendente(bigint,date);
commit;
