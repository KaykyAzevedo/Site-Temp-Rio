-- 052: Foto do CANHOTO do pedido (motorista na parada ou equipe no painel) -> o Kanban mostra "Recebido".
-- NAO APLICADA. Idempotente. Requer 014 (eh_admin/eh_equipe), 035 (solidcon_pedidos_erp), 044 (pode_marcar_rota),
-- 051 (rota_051_meu_veiculo, rota_051_cds_da_rota) e o Supabase Storage (schema storage). Rollback: 052_rollback.sql.
--
-- Regra do dono (23/11): pedido que saiu fica "Enviado"; com foto do canhoto vira "Recebido" no Kanban do painel (a marca
-- e do lado do painel; o ERP e so leitura; se o ERP ja diz atendido, continua Recebido).
-- (1) Bucket PRIVADO 'canhotos' (sem acesso publico; 5 MB; so image/jpeg|png|webp). Caminho <data>/<cd_pedido>/<uuid>.<ext>.
--     Politicas em storage.objects (por comando, so neste bucket):
--       SELECT  equipe (eh_equipe) — o painel le por URL assinada curta;
--       INSERT  motorista SO no caminho de HOJE e de pedido da rota publicada do veiculo dele (rota_052_caminho_motorista);
--       INSERT  quem pode_marcar_rota (painel), caminho no formato;
--       UPDATE  quem pode_marcar_rota;
--       DELETE  SO admin.
-- (2) pedido_canhoto: cd_pedido, caminho, origem 'motorista' | 'painel', enviado_por/em, substituido_em/por (TROCAR guarda
--     a anterior como substituida; nada some sem o admin). Uma foto pode valer para varios pedidos da mesma parada
--     (uma linha por pedido, mesmo caminho). Leitura: equipe. Escrita SO por RPC:
--       rota_052_registrar(p_caminho, p_cds, p_substituir, p_veiculo DEFAULT NULL, p_versao DEFAULT NULL):
--         objeto precisa existir; motorista = contexto original obrigatorio (051), rota de hoje e arquivo dele;
--         painel = pode_marcar_rota, pedidos existentes no ERP, chamada antiga com 3 argumentos preservada.
--       rota_052_remover(p_cd, p_caminho): SO admin; devolve se o arquivo ainda e usado por outro pedido (o painel so apaga
--         o arquivo do Storage quando ninguem mais usa).
--       rota_052_canhotos_motorista(p_data): pedidos da rota dele (hoje/amanha) que ja tem canhoto (mostra o check).
-- (3) Retencao autorizada pelo dono: 1 ANO. Cron chama canhotos-limpeza via Vault/043.
--     Fila com advisory lock e lease; arquivo sai pela API Storage, vinculos so apos confirmacao.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception '052 requer o Supabase Storage (storage.buckets / storage.objects). Nada foi aplicado.';
  end if;
  if to_regprocedure('public.rota_051_cds_da_rota(date,text)') is null
     or to_regprocedure('public.rota_051_validar_contexto(date,text,integer)') is null
     or to_regprocedure('public.pode_marcar_rota()') is null
     or to_regprocedure('public.eh_admin()') is null or to_regclass('public.solidcon_pedidos_erp') is null then
    raise exception '052 requer 014, 035, 044 e 051. Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 52);

-- Caminhos reservados nao podem ganhar novos vinculos enquanto a API apaga o arquivo.
create table if not exists public.rota_052_expurgo (
  caminho text primary key,
  corte timestamptz not null,
  criado_em timestamptz not null default now(),
  token uuid,
  reservado_em timestamptz,
  concluido_em timestamptz,
  tentativas integer not null default 0
);
alter table public.rota_052_expurgo enable row level security;
revoke all on public.rota_052_expurgo from public, anon, authenticated;
grant select on public.rota_052_expurgo to service_role;

create or replace function public.rota_052_arquivo_livre(p_nome text)
returns boolean language sql stable security definer set search_path = ''
as $$select not exists(select 1 from public.rota_052_expurgo q where q.caminho=p_nome)$$;
revoke all on function public.rota_052_arquivo_livre(text) from public, anon;
grant execute on function public.rota_052_arquivo_livre(text) to authenticated;

-- ===================== (1) bucket =====================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('canhotos', 'canhotos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Formato do caminho: AAAA-MM-DD/<cd_pedido>/<uuid>.(jpg|jpeg|png|webp)
create or replace function public.rota_052_caminho_valido(p_nome text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_nome ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}/[1-9][0-9]{0,11}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
$$;
revoke all on function public.rota_052_caminho_valido(text) from public, anon;
grant execute on function public.rota_052_caminho_valido(text) to authenticated;

-- Motorista: caminho de HOJE (SP) e o pedido do caminho esta na rota publicada de hoje do veiculo dele.
create or replace function public.rota_052_caminho_motorista(p_nome text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_veic text := public.rota_051_meu_veiculo();
  v_hoje date := (pg_catalog.now() at time zone 'America/Sao_Paulo')::date;
begin
  if v_veic is null or not public.rota_052_caminho_valido(p_nome) then return false; end if;
  if pg_catalog.split_part(p_nome, '/', 1) <> pg_catalog.to_char(v_hoje, 'YYYY-MM-DD') then return false; end if;
  return pg_catalog.split_part(p_nome, '/', 2)::bigint in (select public.rota_051_cds_da_rota(v_hoje, v_veic));
end;
$$;
revoke all on function public.rota_052_caminho_motorista(text) from public, anon;
grant execute on function public.rota_052_caminho_motorista(text) to authenticated;

drop policy if exists canhotos_052_equipe_le on storage.objects;
create policy canhotos_052_equipe_le on storage.objects for select to authenticated
  using (bucket_id = 'canhotos' and (select public.eh_equipe()));
drop policy if exists canhotos_052_motorista_insere on storage.objects;
create policy canhotos_052_motorista_insere on storage.objects for insert to authenticated
  with check (bucket_id = 'canhotos' and public.rota_052_caminho_motorista(name) and public.rota_052_arquivo_livre(name));
drop policy if exists canhotos_052_marca_insere on storage.objects;
create policy canhotos_052_marca_insere on storage.objects for insert to authenticated
  with check (bucket_id = 'canhotos' and (select public.pode_marcar_rota()) and public.rota_052_caminho_valido(name) and public.rota_052_arquivo_livre(name));
drop policy if exists canhotos_052_marca_atualiza on storage.objects;
create policy canhotos_052_marca_atualiza on storage.objects for update to authenticated
  using (bucket_id = 'canhotos' and (select public.pode_marcar_rota()) and public.rota_052_arquivo_livre(name))
  with check (bucket_id = 'canhotos' and (select public.pode_marcar_rota()) and public.rota_052_caminho_valido(name) and public.rota_052_arquivo_livre(name));
drop policy if exists canhotos_052_admin_apaga on storage.objects;
create policy canhotos_052_admin_apaga on storage.objects for delete to authenticated
  using (bucket_id = 'canhotos' and (select public.eh_admin()));

-- ===================== (2) pedido_canhoto =====================
create table if not exists public.pedido_canhoto (
  id bigint generated always as identity primary key,
  cd_pedido bigint not null check (cd_pedido between 1 and 999999999999),
  caminho text not null check (public.rota_052_caminho_valido(caminho)),
  origem text not null check (origem in ('motorista', 'painel')),
  enviado_por uuid,
  enviado_em timestamptz not null default now(),
  substituido_em timestamptz,
  substituido_por uuid,
  unique (cd_pedido, caminho)
);
create index if not exists pedido_canhoto_ativo_idx on public.pedido_canhoto(cd_pedido) where substituido_em is null;
create index if not exists pedido_canhoto_caminho_idx on public.pedido_canhoto(caminho,enviado_em);
create index if not exists pedido_canhoto_enviado_idx on public.pedido_canhoto(enviado_em);

alter table public.pedido_canhoto enable row level security;
revoke all on public.pedido_canhoto from public, anon, authenticated;
grant select on public.pedido_canhoto to authenticated;
grant select on public.pedido_canhoto to service_role;
drop policy if exists pedido_canhoto_052_equipe_le on public.pedido_canhoto;
create policy pedido_canhoto_052_equipe_le on public.pedido_canhoto for select to authenticated using ((select public.eh_equipe()));

-- Ate 15050 pedidos por foto: raiz (50) + 300 itens CD x 50 da parada publicada (047).
-- Uma associacao atomica, sem truncar ou fazer uploads adicionais para cargas grandes.
-- Painel mantem a chamada de 3 argumentos; motorista precisa informar o contexto original.
drop function if exists public.rota_052_registrar(text, bigint[], boolean);
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
revoke all on function public.rota_052_registrar(text, bigint[], boolean, text, integer) from public, anon;
grant execute on function public.rota_052_registrar(text, bigint[], boolean, text, integer) to authenticated;

-- Remover (so admin): apaga a linha do pedido; devolve true se o ARQUIVO ainda e usado por outro pedido.
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
revoke all on function public.rota_052_remover(bigint, text) from public, anon;
grant execute on function public.rota_052_remover(bigint, text) to authenticated;

-- Motorista: quais pedidos da rota dele (hoje/amanha) ja tem canhoto.
create or replace function public.rota_052_canhotos_motorista(p_data date)
returns setof bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_veic text := public.rota_051_meu_veiculo();
  v_hoje date := (pg_catalog.now() at time zone 'America/Sao_Paulo')::date;
begin
  if v_veic is null then raise exception 'so o motorista' using errcode = '42501'; end if;
  if p_data is null or p_data not between v_hoje and v_hoje + 1 then raise exception 'so hoje ou amanha' using errcode = '22023'; end if;
  return query select distinct c.cd_pedido from public.pedido_canhoto c
    where c.substituido_em is null and c.cd_pedido in (select public.rota_051_cds_da_rota(p_data, v_veic));
end;
$$;
revoke all on function public.rota_052_canhotos_motorista(date) from public, anon;
grant execute on function public.rota_052_canhotos_motorista(date) to authenticated;

-- ===================== retencao de 1 ano =====================
-- Todas as RPCs de limpeza sao exclusivas do worker com chave de servico (nunca do painel).
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
revoke all on function public.rota_052_limpeza_lote(integer) from public,anon,authenticated;
grant execute on function public.rota_052_limpeza_lote(integer) to service_role;

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
revoke all on function public.rota_052_limpeza_confirmar(uuid) from public,anon,authenticated;
grant execute on function public.rota_052_limpeza_confirmar(uuid) to service_role;

create or replace function public.rota_052_agendar_limpeza()
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_url text; v_token text;
begin
  perform pg_catalog.pg_advisory_xact_lock(5100,5202);
  if pg_catalog.to_regclass('vault.decrypted_secrets') is null or pg_catalog.to_regnamespace('net') is null then return false; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name=$1 limit 1' into v_url using 'project_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name=$1 limit 1' into v_token using 'whatsapp_cron_token';
  if v_url is null or v_url !~ '^https://' or v_token is null or pg_catalog.char_length(v_token)<32 then return false; end if;
  execute 'select net.http_post(url:=$1,headers:=$2,body:=$3,timeout_milliseconds:=60000)'
    using pg_catalog.rtrim(v_url,'/')||'/functions/v1/canhotos-limpeza',
          pg_catalog.jsonb_build_object('Content-Type','application/json','x-cron-token',v_token),
          pg_catalog.jsonb_build_object('acao','agendado');
  return true;
end$$;
revoke all on function public.rota_052_agendar_limpeza() from public,anon,authenticated;
grant execute on function public.rota_052_agendar_limpeza() to service_role;

do $$begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    execute $j$select cron.unschedule(jobid) from cron.job where jobname='canhotos-retencao'$j$;
    if exists(select 1 from pg_extension where extname='pg_net')
       and to_regclass('vault.decrypted_secrets') is not null and to_regprocedure('public.whatsapp_043_cron_ok(text)') is not null then
      execute $j$select cron.schedule('canhotos-retencao','25 * * * *','select public.rota_052_agendar_limpeza()')$j$;
    else
      raise notice '052: retencao de 1 ano requer pg_net, Vault e 043; cron NAO agendado.';
    end if;
  else
    raise notice '052: pg_cron ausente; retencao NAO agendada.';
  end if;
end$$;

commit;
