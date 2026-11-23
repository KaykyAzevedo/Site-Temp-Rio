-- 051: Tela do motorista v2 — progresso da rota ("Próximo ponto") e detalhe dos pedidos da parada.
-- NAO APLICADA. Idempotente. Requer 014 (eh_equipe), 035/039 (solidcon_pedidos_erp com caixas) e 047 (rota_saida,
-- rota_motoristas, rota_047_veiculo_motorista). Rollback: 051_rollback.sql.
--
-- (1) rota_saida_progresso (data, veiculo_id, versao, ordem): parada FEITA na VERSAO vista pelo motorista.
--     Versao 0 preserva linhas legadas sem identidade conhecida, nunca reaproveitadas na rota atual.
--     feito_em = hora em que o motorista tocou, mesmo
--     offline; registrado_em = quando chegou no banco). Leitura: equipe (o painel mostra "S10: 4 de 9 feitas") e o
--     proprio motorista (o veiculo dele, hoje e amanha). Escrita SO pela RPC.
-- (2) rota_051_marcar(p_data, p_veiculo, p_versao, p_ordem, p_feito, p_em): SO o motorista ATIVO, SO o veiculo dele,
--     SO a VERSAO esperada, SO HOJE (Sao Paulo) e
--     SO uma parada que existe na rota publicada (rota_saida) desse dia. Idempotente (a fila offline reenvia sem medo):
--     feito = insere se nao existe (fica a 1a hora); desfazer = apaga SO nessa versao. p_em fica entre agora - 18 h e agora.
--     P5101 dia antigo; P5102 veiculo divergente; P5103 rota/versao divergente; P5104 contexto ausente.
--     Recusas NAO mudam progresso/fotos: cliente deve preservar pendencias para recuperacao.
-- (3) rota_051_pedidos_motorista(p_data): caixas (24/48/outras) de cada pedido da rota publicada DO VEICULO DELE (hoje ou
--     amanha). Sem valor nem documento (o motorista nao le solidcon_pedidos_erp).
-- DEFINER com search_path vazio; anon nada.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.rota_saida') is null or to_regclass('public.rota_motoristas') is null
     or to_regprocedure('public.eh_equipe()') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'solidcon_pedidos_erp' and column_name = 'caixas_24') then
    raise exception '051 requer 014, 039 (caixas em solidcon_pedidos_erp) e 047 (rota_saida, rota_motoristas). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 51);

-- A 047 reinicia versao=1 no INSERT. Preserva o contador mesmo quando o escritorio retira a rota:
-- uma fila offline antiga nunca pode coincidir com uma nova publicacao do mesmo dia/veiculo.
create table if not exists public.rota_051_versoes (
  data date not null,
  veiculo_id text not null references public.rota_veiculos(id) on update restrict on delete restrict,
  ultima_versao integer not null check (ultima_versao > 0),
  primary key(data, veiculo_id)
);
alter table public.rota_051_versoes enable row level security;
revoke all on public.rota_051_versoes from public, anon, authenticated;
grant select, delete on public.rota_051_versoes to service_role;
insert into public.rota_051_versoes(data, veiculo_id, ultima_versao)
select s.data, s.veiculo_id, s.versao from public.rota_saida s
on conflict(data, veiculo_id) do update
  set ultima_versao = greatest(rota_051_versoes.ultima_versao, excluded.ultima_versao);

create or replace function public.rota_051_saida_versao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.rota_051_versoes(data, veiculo_id, ultima_versao)
    values (new.data, new.veiculo_id, new.versao)
    on conflict(data, veiculo_id) do update
      set ultima_versao = greatest(rota_051_versoes.ultima_versao + 1, excluded.ultima_versao)
    returning ultima_versao into new.versao;
  else
    -- UPSERT executa BEFORE INSERT e BEFORE UPDATE: o INSERT ja reservou a proxima versao.
    -- UPDATE normal recebe old+1 (tambem sem a 047 numa fixture), sem incrementar a reserva duas vezes.
    insert into public.rota_051_versoes(data, veiculo_id, ultima_versao)
    values (new.data, new.veiculo_id, greatest(old.versao + 1, new.versao))
    on conflict(data, veiculo_id) do update
      set ultima_versao = greatest(rota_051_versoes.ultima_versao, excluded.ultima_versao)
    returning ultima_versao into new.versao;
  end if;
  return new;
end;
$$;
revoke all on function public.rota_051_saida_versao() from public, anon, authenticated;
drop trigger if exists rota_051_saida_versao on public.rota_saida;
-- Nome apos os gatilhos 047/050: recebe a versao proposta pela 047 e garante que nao foi reutilizada.
create trigger rota_051_saida_versao before insert or update on public.rota_saida
  for each row execute function public.rota_051_saida_versao();

create table if not exists public.rota_saida_progresso (
  data date not null,
  veiculo_id text not null references public.rota_veiculos(id) on update restrict on delete restrict,
  versao integer not null constraint rota_051_versao check (versao >= 0),
  ordem integer not null check (ordem between 1 and 500),
  feito_em timestamptz not null,
  feito_por uuid,
  registrado_em timestamptz not null default now(),
  primary key (data, veiculo_id, versao, ordem)
);

-- Atualizacao de uma 051 anterior: nao e seguro adivinhar a versao das marcacoes antigas.
-- Preserva-as como legado 0, sem apagar nem associa-las a outra entrega. Reaplicar nao altera versoes conhecidas.
alter table public.rota_saida_progresso add column if not exists versao integer not null default 0;
alter table public.rota_saida_progresso drop constraint if exists rota_051_versao;
alter table public.rota_saida_progresso add constraint rota_051_versao check (versao >= 0);
alter table public.rota_saida_progresso drop constraint if exists rota_saida_progresso_pkey;
alter table public.rota_saida_progresso add primary key (data, veiculo_id, versao, ordem);

alter table public.rota_saida_progresso enable row level security;
revoke all on public.rota_saida_progresso from public, anon, authenticated;
grant select on public.rota_saida_progresso to authenticated;
grant select, delete on public.rota_saida_progresso to service_role;
drop policy if exists rota_051_equipe_le on public.rota_saida_progresso;
create policy rota_051_equipe_le on public.rota_saida_progresso for select to authenticated
  using ((select public.eh_equipe()) and exists (
    select 1 from public.rota_saida s where s.data = rota_saida_progresso.data
      and s.veiculo_id = rota_saida_progresso.veiculo_id and s.versao = rota_saida_progresso.versao));
drop policy if exists rota_051_motorista_le on public.rota_saida_progresso;
create policy rota_051_motorista_le on public.rota_saida_progresso for select to authenticated
  using (veiculo_id = (select public.rota_047_veiculo_motorista())
         and data between (select (now() at time zone 'America/Sao_Paulo')::date)
                      and (select (now() at time zone 'America/Sao_Paulo')::date + 1)
         and exists (select 1 from public.rota_saida s where s.data = rota_saida_progresso.data
           and s.veiculo_id = rota_saida_progresso.veiculo_id and s.versao = rota_saida_progresso.versao));

-- Veiculo do motorista ATIVO logado (null = nao e motorista). Interna (sem grant).
create or replace function public.rota_051_meu_veiculo()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select m.veiculo_id from public.rota_motoristas m where m.user_id = auth.uid() and m.ativo $$;
revoke all on function public.rota_051_meu_veiculo() from public, anon, authenticated;

-- Valida e trava o vinculo e a rota durante a transacao de quem chama (marcar/registrar canhoto).
-- FOR SHARE impede republicacao/retirada da rota ou troca do vinculo entre conferencia e escrita.
create or replace function public.rota_051_validar_contexto(p_data date, p_veiculo text, p_versao integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_veic text;
  v_versao integer;
  v_hoje date := (pg_catalog.now() at time zone 'America/Sao_Paulo')::date;
begin
  select m.veiculo_id into v_veic from public.rota_motoristas m
   where m.user_id = auth.uid() and m.ativo for share;
  if v_veic is null then
    raise exception 'so o motorista ativo usa a propria rota' using errcode = '42501';
  end if;
  if p_data < v_hoje then
    raise exception 'DIA_ANTIGO: pendencia de outro dia; preserve para recuperacao no escritorio' using errcode = 'P5101';
  end if;
  if p_data is distinct from v_hoje then
    raise exception 'so a rota de hoje pode ser marcada' using errcode = '22023';
  end if;
  if p_veiculo is null or p_veiculo = '' or p_versao is null or p_versao < 1 then
    raise exception 'CONTEXTO_AUSENTE: veiculo e versao originais sao obrigatorios' using errcode = 'P5104';
  end if;
  if p_veiculo is distinct from v_veic then
    raise exception 'VEICULO_DIVERGENTE: nao reenviar a pendencia na vinculacao atual' using errcode = 'P5102';
  end if;
  select s.versao into v_versao from public.rota_saida s
   where s.data = p_data and s.veiculo_id = p_veiculo for share;
  if v_versao is null or v_versao is distinct from p_versao then
    raise exception 'VERSAO_DIVERGENTE: rota substituida ou retirada; preserve a pendencia original' using errcode = 'P5103';
  end if;
  return true;
end;
$$;
revoke all on function public.rota_051_validar_contexto(date, text, integer) from public, anon;
grant execute on function public.rota_051_validar_contexto(date, text, integer) to authenticated;

-- Sem sobrecarga antiga: nenhuma chamada sem identidade pode marcar a rota atual implicitamente.
drop function if exists public.rota_051_marcar(date, integer, boolean, timestamptz);
create or replace function public.rota_051_marcar(p_data date, p_veiculo text, p_versao integer,
                                                p_ordem integer, p_feito boolean, p_em timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_em timestamptz;
begin
  perform public.rota_051_validar_contexto(p_data, p_veiculo, p_versao);
  if p_ordem is null or p_feito is null then
    raise exception 'marcacao invalida' using errcode = '22023';
  end if;
  if not exists (select 1 from public.rota_saida s, pg_catalog.jsonb_array_elements(s.paradas) p
                  where s.data = p_data and s.veiculo_id = p_veiculo and s.versao = p_versao
                    and pg_catalog.jsonb_typeof(p -> 'ordem') = 'number' and (p ->> 'ordem')::integer = p_ordem) then
    raise exception 'parada nao esta na rota publicada de hoje' using errcode = 'P0002';
  end if;
  if p_feito then
    v_em := least(pg_catalog.now(), greatest(coalesce(p_em, pg_catalog.now()), pg_catalog.now() - interval '18 hours'));
    insert into public.rota_saida_progresso (data, veiculo_id, versao, ordem, feito_em, feito_por)
    values (p_data, p_veiculo, p_versao, p_ordem, v_em, auth.uid())
    on conflict (data, veiculo_id, versao, ordem) do nothing;
  else
    delete from public.rota_saida_progresso where data = p_data and veiculo_id = p_veiculo
      and versao = p_versao and ordem = p_ordem;
  end if;
  return true;
end;
$$;
revoke all on function public.rota_051_marcar(date, text, integer, integer, boolean, timestamptz) from public, anon;
grant execute on function public.rota_051_marcar(date, text, integer, integer, boolean, timestamptz) to authenticated;

-- Pedidos (numeros) da rota publicada de um veiculo/dia: paradas[].pedidos[] e paradas[].itens[].pedidos[] (CD).
create or replace function public.rota_051_cds_da_rota(p_data date, p_veic text)
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $$
  select distinct (x #>> '{}')::bigint
    from public.rota_saida s
    cross join lateral pg_catalog.jsonb_array_elements(s.paradas) p
    cross join lateral (
      select e from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p -> 'pedidos') = 'array' then p -> 'pedidos' else '[]'::jsonb end) e
      union all
      select e from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p -> 'itens') = 'array' then p -> 'itens' else '[]'::jsonb end) it
        cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(it -> 'pedidos') = 'array' then it -> 'pedidos' else '[]'::jsonb end) e
    ) y(x)
   where s.data = p_data and s.veiculo_id = p_veic and pg_catalog.jsonb_typeof(x) = 'number'
$$;
revoke all on function public.rota_051_cds_da_rota(date, text) from public, anon, authenticated;

create or replace function public.rota_051_pedidos_motorista(p_data date)
returns table (cd_pedido bigint, caixas_24 integer, caixas_48 integer, caixas_outras integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_veic text := public.rota_051_meu_veiculo();
  v_hoje date := (pg_catalog.now() at time zone 'America/Sao_Paulo')::date;
begin
  if v_veic is null then
    raise exception 'so o motorista' using errcode = '42501';
  end if;
  if p_data is null or p_data not between v_hoje and v_hoje + 1 then
    raise exception 'so hoje ou amanha' using errcode = '22023';
  end if;
  return query
    select p.cd_pedido, p.caixas_24::integer, p.caixas_48::integer, p.caixas_outras::integer
      from public.solidcon_pedidos_erp p
     where p.cd_pedido in (select public.rota_051_cds_da_rota(p_data, v_veic))
     order by p.cd_pedido;
end;
$$;
revoke all on function public.rota_051_pedidos_motorista(date) from public, anon;
grant execute on function public.rota_051_pedidos_motorista(date) to authenticated;

-- Limpeza: progresso com mais de 60 dias.
create or replace function public.rota_051_limpar()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare v_n integer;
begin
  delete from public.rota_saida_progresso where data < (pg_catalog.now() at time zone 'America/Sao_Paulo')::date - 60;
  get diagnostics v_n = row_count;
  delete from public.rota_051_versoes where data < (pg_catalog.now() at time zone 'America/Sao_Paulo')::date - 60;
  return v_n;
end;
$$;
revoke all on function public.rota_051_limpar() from public, anon, authenticated;
grant execute on function public.rota_051_limpar() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $j$select cron.unschedule(jobid) from cron.job where jobname = 'rota-limpeza-progresso'$j$;
    execute $j$select cron.schedule('rota-limpeza-progresso', '52 6 * * *', 'select public.rota_051_limpar()')$j$;
  else
    raise notice '051: pg_cron nao instalado: limpeza diaria NAO agendada (rode select public.rota_051_limpar() de vez em quando).';
  end if;
end;
$$;

commit;
