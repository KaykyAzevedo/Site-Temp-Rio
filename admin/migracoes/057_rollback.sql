-- Rollback057 sem perda: so desinstala quando nao existe acervo retido.
-- Para retirar a UI com acervo existente, mantenha057/worker de retencao ate a expiracao.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
select pg_catalog.pg_advisory_xact_lock(5100,57);
select pg_catalog.pg_advisory_xact_lock(5100,35);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
lock table public.solidcon_pedidos_erp in share row exclusive mode nowait;
lock table public.pedido_canhoto in access exclusive mode nowait;
do $$begin
 if to_regclass('public.pedido_arquivo') is not null then
  if exists(select 1 from public.pedido_arquivo) then
   raise exception '057 possui acervo retido: rollback recusado sem apagar dados; mantenha retencao e reverta somente a UI.' using errcode='55006';
  end if;
 end if;
end$$;
drop trigger if exists rota_057_fonte_travar on public.solidcon_pedidos_erp;
drop trigger if exists rota_057_fonte_ins on public.solidcon_pedidos_erp;
drop trigger if exists rota_057_fonte_upd on public.solidcon_pedidos_erp;
drop trigger if exists rota_057_canhoto_ins on public.pedido_canhoto;
drop trigger if exists rota_057_canhoto_upd on public.pedido_canhoto;
drop trigger if exists rota_057_canhoto_del on public.pedido_canhoto;
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
  perform pg_catalog.pg_advisory_xact_lock(5100,5001);
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
  perform pg_catalog.pg_advisory_xact_lock(5100,5001);
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
  perform pg_catalog.pg_advisory_xact_lock(5100,5001);
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
drop function if exists public.rota_057_buscar(text,date,date,timestamptz,bigint,integer);
drop function if exists public.rota_057_canhoto_depois();
drop function if exists public.rota_057_fonte_depois();
drop function if exists public.rota_057_fonte_travar();
drop function if exists public.rota_057_guardar(bigint[]);
drop function if exists public.rota_057_dia_caminho(text);
drop function if exists public.rota_057_purgar();
drop table if exists public.pedido_arquivo_foto;
drop table if exists public.pedido_arquivo;
alter table public.pedido_canhoto drop column if exists rota_data,drop column if exists rota_veiculo,drop column if exists rota_versao;
notify pgrst,'reload schema';
commit;
