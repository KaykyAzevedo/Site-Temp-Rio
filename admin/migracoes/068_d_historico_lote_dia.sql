-- 068 D r2 (sobre 070 / cf77910): historico por mes/dia lendo o estado canonico do 070 ('historico')
-- e canhotos em lote por DIA, sem vinculo pedido/cliente e sem duplicar a virada de meia-noite.
-- Requer 070 (rota_070_hoje, rota_070_entregue, rota_070_historico_em, rota_070_estado, rota_070_politica),
-- 068C/H (rota_068_entregas) e 052/057 (Storage privado canhotos e worker de retencao).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_catalog.pg_advisory_xact_lock(5100, 6804);
select pg_catalog.pg_advisory_xact_lock(5100, 5201);
select pg_catalog.pg_advisory_xact_lock(5100, 5001);

do $$begin
  if to_regprocedure('public.rota_070_hoje()') is null
     or to_regprocedure('public.rota_070_entregue(bigint)') is null
     or to_regprocedure('public.rota_070_historico_em(bigint)') is null
     or to_regprocedure('public.rota_070_estado(bigint)') is null
     or to_regclass('public.rota_070_politica') is null
     or to_regprocedure('public.rota_068_entregas(date,date)') is null
     or to_regprocedure('public.rota_052_arquivo_livre(text)') is null
     or to_regprocedure('public.rota_052_limpeza_lote(integer)') is null
     or not exists (select 1 from storage.buckets where id = 'canhotos' and not public) then
    raise exception '068 D r2 requer 070, 068C/H e 052/057 (bucket privado canhotos e retencao). Nada aplicado.';
  end if;
end$$;

-- Validador puro do caminho de lote: lote/AAAA-MM-DD/<uuid>.(jpg|jpeg|png|webp) com data valida no calendario.
create or replace function public.rota_068_lote_dia(p_caminho text)
returns date
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  d date;
begin
  if p_caminho is null or p_caminho !~ '^lote/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$' then
    return null;
  end if;
  begin
    d := pg_catalog.split_part(p_caminho, '/', 2)::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    return null;
  end;
  if d not between date '2020-01-01' and date '2100-12-31' then
    return null;
  end if;
  return d;
end;
$$;
revoke all on function public.rota_068_lote_dia(text) from public, anon, authenticated, service_role;

create table if not exists public.canhoto_lote_dia (
  caminho text primary key,
  dia date not null,
  enviado_em timestamptz not null default pg_catalog.clock_timestamp(),
  enviado_por uuid not null,
  removido_em timestamptz,
  removido_por uuid,
  check (public.rota_068_lote_dia(caminho) is not null and public.rota_068_lote_dia(caminho) = dia),
  check ((removido_em is null) = (removido_por is null))
);
create index if not exists canhoto_lote_dia_068_dia on public.canhoto_lote_dia (dia, enviado_em);
alter table public.canhoto_lote_dia drop constraint if exists canhoto_lote_dia_068_inicio;
alter table public.canhoto_lote_dia add constraint canhoto_lote_dia_068_inicio check (dia >= date '2026-11-23');
alter table public.canhoto_lote_dia enable row level security;
revoke all on public.canhoto_lote_dia from public, anon, authenticated, service_role;
grant select on public.canhoto_lote_dia to authenticated;
drop policy if exists canhoto_lote_dia_068_equipe on public.canhoto_lote_dia;
create policy canhoto_lote_dia_068_equipe on public.canhoto_lote_dia
  for select to authenticated using ((select public.eh_equipe()));

-- Janela de upload usa o relogio oficial do 070 (rota_070_hoje) e inicio inclusivo em 23/11/2026.
create or replace function public.rota_068_lote_upload_valido(p_nome text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.rota_068_lote_dia(p_nome) between greatest(date '2026-11-23', public.rota_070_hoje() - 365) and public.rota_070_hoje(),
    false
  ) and public.rota_052_arquivo_livre(p_nome);
$$;
revoke all on function public.rota_068_lote_upload_valido(text) from public, anon, authenticated, service_role;
grant execute on function public.rota_068_lote_upload_valido(text) to authenticated;

drop policy if exists canhotos_068_lote_insere on storage.objects;
create policy canhotos_068_lote_insere on storage.objects
  for insert to authenticated
  with check (bucket_id = 'canhotos' and (select public.pode_marcar_rota()) and public.rota_068_lote_upload_valido(name));

-- A 052 permite UPDATE de qualquer nome: impedir rename de lote para caminho de pedido.
-- Leitura e DELETE continuam na 052 (equipe/admin); lote nao tem UPDATE/upsert de arquivo.
drop policy if exists canhotos_052_marca_atualiza on storage.objects;
create policy canhotos_052_marca_atualiza on storage.objects
  for update to authenticated
  using (bucket_id = 'canhotos' and name !~ '^lote/' and (select public.pode_marcar_rota()) and public.rota_052_arquivo_livre(name))
  with check (bucket_id = 'canhotos' and (select public.pode_marcar_rota()) and public.rota_052_caminho_valido(name) and public.rota_052_arquivo_livre(name));

create or replace function public.rota_068_lote_registrar(p_dia date, p_caminhos text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  v_hoje date := public.rota_070_hoje();
begin
  if auth.uid() is null or not coalesce(public.pode_marcar_rota(), false) then
    raise exception 'somente quem marca rota anexa lote' using errcode = '42501';
  end if;
  if p_dia is null
     or p_dia not between greatest(date '2026-11-23', v_hoje - 365) and v_hoje
     or p_caminhos is null
     or pg_catalog.cardinality(p_caminhos) not between 1 and 100
     or exists (select 1 from pg_catalog.unnest(p_caminhos) p where public.rota_068_lote_dia(p) is distinct from p_dia)
     or (select count(distinct p) from pg_catalog.unnest(p_caminhos) p) <> pg_catalog.cardinality(p_caminhos) then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(5100, 5201);
  if exists (select 1 from pg_catalog.unnest(p_caminhos) p where not public.rota_052_arquivo_livre(p)) then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'arquivo_em_expurgo');
  end if;
  if exists (select 1 from pg_catalog.unnest(p_caminhos) p where not exists (select 1 from storage.objects o where o.bucket_id = 'canhotos' and o.name = p)) then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'arquivo_ausente');
  end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'canhotos' and o.name = any (p_caminhos) and o.created_at < pg_catalog.now() - interval '1 year') then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'arquivo_expirado');
  end if;
  if exists (select 1 from public.canhoto_lote_dia c where c.caminho = any (p_caminhos) and c.removido_em is not null) then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'arquivo_removido');
  end if;
  insert into public.canhoto_lote_dia (caminho, dia, enviado_por)
  select p, p_dia, auth.uid()
    from pg_catalog.unnest(p_caminhos) p
  on conflict (caminho) do nothing;
  get diagnostics n = row_count;
  return pg_catalog.jsonb_build_object('status', 'ok', 'registrados', n, 'total', pg_catalog.cardinality(p_caminhos), 'repetido', n = 0);
end;
$$;

create or replace function public.rota_068_lote_listar(p_dia date)
returns table (caminho text, enviado_em timestamptz, enviado_por uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe le lote' using errcode = '42501';
  end if;
  if p_dia is null then
    raise exception 'dia invalido' using errcode = '22023';
  end if;
  return query
  select c.caminho, c.enviado_em, c.enviado_por
    from public.canhoto_lote_dia c
   where c.dia = p_dia
     and c.removido_em is null
     and exists (select 1 from storage.objects o where o.bucket_id = 'canhotos' and o.name = c.caminho)
   order by c.enviado_em, c.caminho;
end;
$$;

create or replace function public.rota_068_lote_remover(p_caminho text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if auth.uid() is null or not coalesce(public.eh_admin(), false) then
    raise exception 'somente admin remove lote' using errcode = '42501';
  end if;
  if public.rota_068_lote_dia(p_caminho) is null then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(5100, 5201);
  update public.canhoto_lote_dia
     set removido_em = pg_catalog.clock_timestamp(),
         removido_por = auth.uid()
   where caminho = p_caminho
     and removido_em is null;
  get diagnostics n = row_count;
  return pg_catalog.jsonb_build_object('status', 'ok', 'alterado', n > 0, 'pode_apagar', true);
end;
$$;
revoke all on function public.rota_068_lote_registrar(date, text[]), public.rota_068_lote_listar(date), public.rota_068_lote_remover(text) from public, anon, authenticated, service_role;
grant execute on function public.rota_068_lote_registrar(date, text[]), public.rota_068_lote_listar(date), public.rota_068_lote_remover(text) to authenticated;

-- Historico mensal: LE diretamente o estado 'historico' do 070 (rota_070_estado / rota_070_politica / rota_070_hoje),
-- sem duplicar regra de virada de meia-noite. Mantem inicio inclusivo em 23/11/2026 sem backfill anterior.
create or replace function public.rota_068_historico(p_mes date)
returns table (
  dia date,
  cd_pedido bigint,
  cliente_nome text,
  status text,
  data_entrega date,
  lote_fotos integer,
  obs text,
  por_nome text,
  em timestamptz,
  cliente_tipo text,
  valor_centavos bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ate date;
  v_hoje date := public.rota_070_hoje();
  v_dias_rec integer := coalesce((select p.dias_recebidos from public.rota_070_politica p where p.id = 1), 1);
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe le historico' using errcode = '42501';
  end if;
  if p_mes is null or extract(day from p_mes) <> 1 or p_mes not between date '2020-01-01' and date '2100-12-01' then
    raise exception 'mes invalido' using errcode = '22023';
  end if;
  v_ate := (p_mes + interval '1 month')::date;

  return query
  with entregas as (
    select e.*
      from public.rota_068_entregas(p_mes, v_ate - 1) e
     where e.data_entrega >= date '2026-11-23'
       and (public.rota_070_estado(e.cd_pedido)->>'estado_070') = 'historico'
  ), fotos_todas as (
    select c.dia, count(*)::integer as n
      from public.canhoto_lote_dia c
     where c.dia >= greatest(p_mes, date '2026-11-23')
       and c.dia < v_ate
       and c.removido_em is null
       and exists (select 1 from storage.objects o where o.bucket_id = 'canhotos' and o.name = c.caminho)
     group by c.dia
  ), fotos_hist as (
    -- Dias de lote sem pedido obedecem a mesma politica de passagem do 070 (rota_070_politica.dias_recebidos + rota_070_hoje).
    select f.dia, f.n
      from fotos_todas f
     where f.dia + v_dias_rec <= v_hoje
  ), linhas as (
    select e.data_entrega as d, e.cd_pedido as cd, e.cliente_nome as nome, e.status as st,
           e.data_entrega as de, coalesce(f.n, 0) as nf,
           e.obs as ob, e.por_nome as pn, e.em as tm, e.cliente_tipo as ct, e.valor_centavos as vc
      from entregas e
      left join fotos_todas f on f.dia = e.data_entrega
    union all
    -- Dia com fotos no historico sem pedido conhecido tambem aparece (cd/status/nome nulos); nao cria pedido ficticio.
    select f.dia, null::bigint, null::text, null::text, f.dia, f.n,
           null::text, null::text, null::timestamptz, null::text, null::bigint
      from fotos_hist f
     where not exists (select 1 from entregas e where e.data_entrega = f.dia)
  )
  select l.d, l.cd, l.nome, l.st, l.de, l.nf, l.ob, l.pn, l.tm, l.ct, l.vc
    from linhas l
   order by l.d desc, l.cd nulls last;
end;
$$;
revoke all on function public.rota_068_historico(date) from public, anon, authenticated, service_role;
grant execute on function public.rota_068_historico(date) to authenticated;

-- Definicao final do dono: Rotas mostra so semana atual; tabelas historicas/066 ficam intactas.
create or replace function public.rota_068_rotas_semana()
returns table (dia date, foto jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.rota_070_hoje();
  v_inicio date := v_hoje - (extract(isodow from v_hoje)::integer - 1);
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe le rotas da semana' using errcode = '42501';
  end if;
  return query
  select f.data, public.rota_050_ler(f.data)
    from public.rota_dia_fechada f
   where f.data >= v_inicio
     and f.data < v_inicio + 7
   order by f.data;
end;
$$;
revoke all on function public.rota_068_rotas_semana() from public, anon, authenticated, service_role;
grant execute on function public.rota_068_rotas_semana() to authenticated;

-- O worker 052/057 ja seleciona TODOS os objetos canhotos com mais de 1 ano e remove pela StorageAPI.
-- Metadado D so pode sair depois de a API confirmar ausencia fisica; nao muda worker/acervo 057.
create or replace function public.rota_068_lote_purgar()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(5100, 5201);
  delete from public.canhoto_lote_dia c
   where c.enviado_em < pg_catalog.now() - interval '1 year'
     and not exists (select 1 from storage.objects o where o.bucket_id = 'canhotos' and o.name = c.caminho);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.rota_068_lote_purgar() from public, anon, authenticated, service_role;

do $$begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $j$select cron.unschedule(jobid) from cron.job where jobname = 'rota-068-lote-metadados'$j$;
    execute $j$select cron.schedule('rota-068-lote-metadados', '53 6 * * *', 'select public.rota_068_lote_purgar()')$j$;
  end if;
end$$;

notify pgrst, 'reload schema';
commit;
