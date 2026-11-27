-- 068 B: Prazo de entrega flexivel ("prazo ideal", nao regra fixa). Aditiva e idempotente; nao aplicada/publicada.
-- Requer 044/047 (pode_marcar_rota, rota_veiculos), 050 (rota_050_hoje, rota_050_nome), 054 (rota_054_tem_saida,
-- rota_054_padrao_separando), 065 (rota_plano_semana), 066 (rota_066_sugestoes, rota_066_prazo).
-- Rollback: 068_b_rollback.sql (preserva dados das tabelas novas e restaura rota_066_sugestoes da 066).
--
-- (1) rota_068_prazo_cliente: regra padrao por cliente (sempre N dias uteis ou sempre nos dias da semana 1..6).
-- (2) rota_068_prazo_pedido: excecao so deste pedido (+N dias uteis ou data agendada pelo cliente).
-- (3) rota_068_prazo_log: auditoria imutavel (quem/quando/motivo/escopo/acao).
--     Precedencia: excecao do pedido > regra do cliente > padrao (2 dias uteis do veiculo, respeitando feriados/corte).
-- (4) RPCs:
--     rota_068_prazo_salvar(cd, tipo, dias, data, escopo, motivo, regra_dias_semana)  DEFINER, pode_marcar_rota.
--     rota_068_prazo_remover_regra(documento, motivo default null)                    DEFINER, pode_marcar_rota.
--     rota_068_prazo_remover_excecao(cd_pedido, motivo default null)                  DEFINER, pode_marcar_rota.
--     rota_068_prazo_ler(cds bigint[])                                                DEFINER, eh_equipe.
--     rota_068_regras_prazo()                                                         DEFINER, eh_equipe.
-- (5) Integracao: rota_066_sugestoes(date) passa a usar rota_068_prazo_calcular (mesmo formato de saida da 066).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

select pg_catalog.pg_advisory_xact_lock(5100, 6802);

do $$
begin
  if to_regprocedure('public.pode_marcar_rota()') is null
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('public.rota_050_hoje()') is null
     or to_regprocedure('public.rota_050_nome(uuid)') is null
     or to_regprocedure('public.rota_054_tem_saida(date,text)') is null
     or to_regprocedure('public.rota_054_padrao_separando()') is null
     or to_regprocedure('public.rota_066_sugestoes(date)') is null
     or to_regprocedure('public.rota_066_prazo(timestamptz,text)') is null
     or to_regprocedure('public.rota_066_saida(text,date)') is null
     or to_regclass('public.rota_065_sem_saida') is null
     or to_regclass('public.solidcon_pedidos_erp') is null
     or to_regclass('public.rota_config') is null
     or to_regclass('public.rota_veiculos') is null
     or to_regclass('public.rota_plano_semana') is null
     or to_regclass('public.rota_pedido_veiculo') is null
     or to_regclass('public.rota_cliente_veiculo') is null then
    raise exception '068 B requer 044/047/050/054/065/066 aplicadas. Nada foi aplicado.';
  end if;
end;
$$;

-- ===================== (1) tabelas =====================
-- Sem FK para solidcon_pedidos_erp/solidcon_clientes: o sync do ERP substitui as tabelas inteiras (DELETE+INSERT).
create table if not exists public.rota_068_prazo_cliente (
  documento text primary key check (documento ~ '^[0-9]{11,14}$'),
  tipo text not null check (tipo in ('dias_uteis', 'semana')),
  dias integer,
  dias_semana smallint[],
  motivo text not null check (pg_catalog.char_length(motivo) between 1 and 200 and motivo !~ '[[:cntrl:]<>]'),
  atualizado_em timestamptz not null default pg_catalog.now(),
  atualizado_por uuid,
  atualizado_por_nome text check (atualizado_por_nome is null or pg_catalog.char_length(atualizado_por_nome) between 1 and 60)
);
alter table public.rota_068_prazo_cliente drop constraint if exists rota_068_prazo_cliente_regra;
alter table public.rota_068_prazo_cliente add constraint rota_068_prazo_cliente_regra check (
  (tipo = 'dias_uteis' and dias between 0 and 365 and dias_semana is null)
  or (tipo = 'semana' and dias is null and dias_semana is not null
      and pg_catalog.cardinality(dias_semana) between 1 and 7
      and dias_semana <@ array[0,1,2,3,4,5,6]::smallint[])
);

create table if not exists public.rota_068_prazo_pedido (
  cd_pedido bigint primary key check (cd_pedido between 1 and 999999999999),
  tipo text not null check (tipo in ('dias_uteis', 'data')),
  dias integer,
  data_agendada date,
  motivo text not null check (pg_catalog.char_length(motivo) between 1 and 200 and motivo !~ '[[:cntrl:]<>]'),
  atualizado_em timestamptz not null default pg_catalog.now(),
  atualizado_por uuid,
  atualizado_por_nome text check (atualizado_por_nome is null or pg_catalog.char_length(atualizado_por_nome) between 1 and 60),
  constraint rota_068_prazo_pedido_regra check (
    (tipo = 'dias_uteis' and dias between 0 and 365 and data_agendada is null)
    or (tipo = 'data' and dias is null and data_agendada between date '2020-01-01' and date '2100-12-31')
  )
);

create table if not exists public.rota_068_prazo_log (
  id bigint generated always as identity primary key,
  escopo text not null,
  acao text not null check (acao in ('salvar', 'remover', 'limpeza')),
  cd_pedido bigint check (cd_pedido is null or cd_pedido between 1 and 999999999999),
  documento text check (documento is null or documento ~ '^[0-9]{11,14}$'),
  tipo text check (tipo is null or tipo in ('dias_uteis', 'data', 'semana')),
  dias integer check (dias is null or dias between 0 and 365),
  data_agendada date,
  dias_semana smallint[],
  motivo text check (motivo is null or (pg_catalog.char_length(motivo) between 1 and 200 and motivo !~ '[[:cntrl:]<>]')),
  por uuid,
  por_nome text check (por_nome is null or pg_catalog.char_length(por_nome) between 1 and 60),
  em timestamptz not null default pg_catalog.now()
);
alter table public.rota_068_prazo_log drop constraint if exists rota_068_prazo_log_escopo_check;
alter table public.rota_068_prazo_log drop constraint if exists rota_068_prazo_log_068_escopo;
alter table public.rota_068_prazo_log add constraint rota_068_prazo_log_068_escopo
  check (escopo in ('pedido', 'cliente', 'padrao'));
create index if not exists rota_068_prazo_log_cd_idx on public.rota_068_prazo_log (cd_pedido, em desc) where cd_pedido is not null;
create index if not exists rota_068_prazo_log_doc_idx on public.rota_068_prazo_log (documento, em desc) where documento is not null;
create index if not exists rota_068_prazo_log_em_idx on public.rota_068_prazo_log (em);

-- Prazo ideal padrao e dias uteis da semana configuraveis em rota_config (meta, nao regra; default = 2 dias uteis, seg..sex).
alter table public.rota_config add column if not exists prazo_ideal_dias integer not null default 2;
alter table public.rota_config add column if not exists prazo_dias_uteis_semana smallint[] not null default array[1,2,3,4,5]::smallint[];
alter table public.rota_config add column if not exists prazo_ideal_atualizado_em timestamptz;
alter table public.rota_config add column if not exists prazo_ideal_atualizado_por uuid;
alter table public.rota_config add column if not exists prazo_ideal_atualizado_por_nome text;
alter table public.rota_config drop constraint if exists rota_config_068_prazo_ideal_dias;
alter table public.rota_config add constraint rota_config_068_prazo_ideal_dias
  check (prazo_ideal_dias between 0 and 365);
alter table public.rota_config drop constraint if exists rota_config_068_prazo_dias_uteis_semana;
alter table public.rota_config add constraint rota_config_068_prazo_dias_uteis_semana
  check (pg_catalog.cardinality(prazo_dias_uteis_semana) between 1 and 7
         and pg_catalog.array_position(prazo_dias_uteis_semana, null) is null
         and prazo_dias_uteis_semana <@ array[0,1,2,3,4,5,6]::smallint[]);

-- B068-R4-B: protege campos novos e metadados em rota_config contra forja ou alteracao sem log nos caminhos DML herdados da 040
-- (UPDATE/INSERT diretos de admin) e na RPC, preservando 100% da edicao legada dos outros campos da 040.
create or replace function public.rota_068_config_prazo_guardar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_em timestamptz := pg_catalog.now();
  v_nome text;
  v_mudou boolean;
begin
  if new.prazo_dias_uteis_semana is not null
     and pg_catalog.cardinality(new.prazo_dias_uteis_semana) > 0
     and pg_catalog.array_position(new.prazo_dias_uteis_semana, null) is null
     and not exists (select 1 from pg_catalog.unnest(new.prazo_dias_uteis_semana) x where x not between 0 and 6) then
    select pg_catalog.array_agg(distinct x::smallint order by x::smallint)
      into new.prazo_dias_uteis_semana
      from pg_catalog.unnest(new.prazo_dias_uteis_semana) x;
  end if;

  if tg_op = 'INSERT' then
    v_mudou := (new.prazo_ideal_dias is distinct from 2)
            or (new.prazo_dias_uteis_semana is distinct from array[1,2,3,4,5]::smallint[]);
    if v_mudou then
      v_nome := case when v_uid is not null then public.rota_050_nome(v_uid) else null end;
      new.prazo_ideal_atualizado_em := v_em;
      new.prazo_ideal_atualizado_por := v_uid;
      new.prazo_ideal_atualizado_por_nome := v_nome;
    else
      new.prazo_ideal_atualizado_em := null;
      new.prazo_ideal_atualizado_por := null;
      new.prazo_ideal_atualizado_por_nome := null;
    end if;
    return new;
  end if;

  -- UPDATE
  v_mudou := (new.prazo_ideal_dias is distinct from old.prazo_ideal_dias)
          or (new.prazo_dias_uteis_semana is distinct from old.prazo_dias_uteis_semana);
  if v_mudou then
    v_nome := case when v_uid is not null then public.rota_050_nome(v_uid) else null end;
    new.prazo_ideal_atualizado_em := v_em;
    new.prazo_ideal_atualizado_por := v_uid;
    new.prazo_ideal_atualizado_por_nome := v_nome;
  else
    -- Preserva metadados originais quando apenas campos da 040 mudam ou ha tentativa de forjar metadados.
    new.prazo_ideal_atualizado_em := old.prazo_ideal_atualizado_em;
    new.prazo_ideal_atualizado_por := old.prazo_ideal_atualizado_por;
    new.prazo_ideal_atualizado_por_nome := old.prazo_ideal_atualizado_por_nome;
  end if;
  return new;
end;
$$;
revoke all on function public.rota_068_config_prazo_guardar() from public, anon, authenticated;

create or replace function public.rota_068_config_prazo_logar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mudou boolean;
begin
  if tg_op = 'INSERT' then
    v_mudou := (new.prazo_ideal_dias is distinct from 2)
            or (new.prazo_dias_uteis_semana is distinct from array[1,2,3,4,5]::smallint[]);
  else
    v_mudou := (new.prazo_ideal_dias is distinct from old.prazo_ideal_dias)
            or (new.prazo_dias_uteis_semana is distinct from old.prazo_dias_uteis_semana);
  end if;

  if v_mudou then
    insert into public.rota_068_prazo_log
      (escopo, acao, cd_pedido, documento, tipo, dias, data_agendada, dias_semana, motivo, por, por_nome, em)
    values (
      'padrao', 'salvar', null, null, 'dias_uteis',
      new.prazo_ideal_dias, null, new.prazo_dias_uteis_semana,
      'Prazo ideal padrao alterado',
      new.prazo_ideal_atualizado_por,
      new.prazo_ideal_atualizado_por_nome,
      coalesce(new.prazo_ideal_atualizado_em, pg_catalog.now())
    );
  end if;
  return null;
end;
$$;
revoke all on function public.rota_068_config_prazo_logar() from public, anon, authenticated;

drop trigger if exists rota_068_config_prazo_guardar on public.rota_config;
create trigger rota_068_config_prazo_guardar
  before insert or update on public.rota_config
  for each row execute function public.rota_068_config_prazo_guardar();

drop trigger if exists rota_068_config_prazo_logar on public.rota_config;
create trigger rota_068_config_prazo_logar
  after insert or update on public.rota_config
  for each row execute function public.rota_068_config_prazo_logar();

-- RLS + grants minimos: SELECT equipe (authenticated) e Edge (service_role nas tabelas de leitura); NENHUMA escrita direta nem anon.
alter table public.rota_068_prazo_cliente enable row level security;
alter table public.rota_068_prazo_pedido enable row level security;
alter table public.rota_068_prazo_log enable row level security;
revoke all on public.rota_068_prazo_cliente, public.rota_068_prazo_pedido, public.rota_068_prazo_log from public, anon, authenticated, service_role;
grant select on public.rota_068_prazo_cliente, public.rota_068_prazo_pedido, public.rota_068_prazo_log to authenticated;
grant select on public.rota_068_prazo_cliente, public.rota_068_prazo_pedido to service_role;

drop policy if exists rota_068_prazo_cliente_equipe_le on public.rota_068_prazo_cliente;
create policy rota_068_prazo_cliente_equipe_le on public.rota_068_prazo_cliente
  for select to authenticated using ((select public.eh_equipe()));

drop policy if exists rota_068_prazo_pedido_equipe_le on public.rota_068_prazo_pedido;
create policy rota_068_prazo_pedido_equipe_le on public.rota_068_prazo_pedido
  for select to authenticated using ((select public.eh_equipe()));

drop policy if exists rota_068_prazo_log_equipe_le on public.rota_068_prazo_log;
create policy rota_068_prazo_log_equipe_le on public.rota_068_prazo_log
  for select to authenticated using ((select public.eh_equipe()));

-- ===================== (2) auxiliares privadas =====================
-- Relogio unico: delega a rota_070_hoje() quando 070 estiver instalada; senao rota_050_hoje().
create or replace function public.rota_068_prazo_hoje()
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_d date;
begin
  if to_regprocedure('public.rota_070_hoje()') is not null then
    execute 'select public.rota_070_hoje()' into v_d;
    return v_d;
  end if;
  return public.rota_050_hoje();
end;
$$;
revoke all on function public.rota_068_prazo_hoje() from public, anon, authenticated, service_role;

-- Feriado (mesmo calendario de rota_054_tem_saida e rota-core): fixos, moveis (Pascoa) e feriados_extras da 040.
create or replace function public.rota_068_eh_feriado(p_data date)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_feriados boolean;
  v_extras date[];
  v_ano integer;
  v_pascoa date;
  a integer; b integer; c integer; d integer; e integer; f integer; g integer; h integer; i integer; k integer; l integer; m integer;
begin
  if p_data is null then return false; end if;
  select r.feriados_sem_saida, r.feriados_extras into v_feriados, v_extras from public.rota_config r where r.id = 1;
  if not coalesce(v_feriados, true) then return false; end if;
  if pg_catalog.to_char(p_data, 'MM-DD') = any (array['01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25'])
     or p_data = any (coalesce(v_extras, '{}'::date[])) then
    return true;
  end if;
  v_ano := extract(year from p_data)::integer;
  a := v_ano % 19; b := v_ano / 100; c := v_ano % 100; d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  v_pascoa := pg_catalog.make_date(v_ano, (h + l - 7 * m + 114) / 31, (h + l - 7 * m + 114) % 31 + 1);
  return p_data = any (array[v_pascoa - 48, v_pascoa - 47, v_pascoa - 2, v_pascoa + 60]);
end;
$$;
revoke all on function public.rota_068_eh_feriado(date) from public, anon, authenticated;

-- Dias da semana configurados como dia util de entrega para contagem do prazo ideal (default seg..sex = {1,2,3,4,5}).
-- Independente de rota_veiculos.dias_sem_saida (que continua valendo para programar saidas de cada veiculo).
create or replace function public.rota_068_prazo_dias_uteis_semana()
returns smallint[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.prazo_dias_uteis_semana from public.rota_config c where c.id = 1), array[1,2,3,4,5]::smallint[]);
$$;
revoke all on function public.rota_068_prazo_dias_uteis_semana() from public, anon, authenticated;

-- Dia conta como dia util do prazo ideal? Esta em prazo_dias_uteis_semana E nao e feriado (quando feriados_sem_saida=true).
create or replace function public.rota_068_eh_dia_util_prazo(p_data date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_data is not null
     and extract(dow from p_data)::smallint = any (public.rota_068_prazo_dias_uteis_semana())
     and not public.rota_068_eh_feriado(p_data);
$$;
revoke all on function public.rota_068_eh_dia_util_prazo(date) from public, anon, authenticated;

-- Soma N dias uteis de entrega (configuracao rota_config.prazo_dias_uteis_semana + feriados) a partir do pedido (SP + corte_hora).
-- N = 0: o proprio dia base se for dia util de prazo, senao o proximo dia util >= dia base.
-- N > 0: N-esimo dia util estritamente apos o dia base.
-- B068-R1: limite de busca dimensionado pela frequencia semanal real (1..7 dias/semana) + feriados_extras.
create or replace function public.rota_068_somar_dias_uteis(p_dt timestamptz, p_veiculo text, p_dias integer)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_d date;
  v_n integer := 0;
  v_g integer := 0;
  v_lim integer;
  v_corte smallint;
  v_uteis smallint[];
  v_ativos integer;
  v_extras_n integer;
begin
  if p_dt is null or p_dias is null or p_dias not between 0 and 365 then return null; end if;
  v_uteis := public.rota_068_prazo_dias_uteis_semana();
  v_ativos := coalesce(pg_catalog.cardinality(v_uteis), 0);
  if v_ativos <= 0 then return null; end if;

  v_d := (p_dt at time zone 'America/Sao_Paulo')::date;
  select c.corte_hora, coalesce(pg_catalog.cardinality(c.feriados_extras), 0)
    into v_corte, v_extras_n
    from public.rota_config c where c.id = 1;
  v_extras_n := coalesce(v_extras_n, 0);
  if v_corte is not null and extract(hour from (p_dt at time zone 'America/Sao_Paulo')) >= v_corte then
    v_d := v_d + 1;
  end if;
  if p_dias = 0 then
    v_lim := least(4000, 400 + v_extras_n * 7);
    while v_g < v_lim loop
      if extract(dow from v_d)::smallint = any (v_uteis) and not public.rota_068_eh_feriado(v_d) then return v_d; end if;
      v_d := v_d + 1; v_g := v_g + 1;
    end loop;
    return null;
  end if;
  v_lim := least(4000, greatest(400, ((p_dias + v_extras_n + 20) * 7 / v_ativos) + 200));
  while v_n < p_dias and v_g < v_lim loop
    v_d := v_d + 1; v_g := v_g + 1;
    if extract(dow from v_d)::smallint = any (v_uteis) and not public.rota_068_eh_feriado(v_d) then v_n := v_n + 1; end if;
  end loop;
  return case when v_n < p_dias then null else v_d end;
end;
$$;
revoke all on function public.rota_068_somar_dias_uteis(timestamptz, text, integer) from public, anon, authenticated;

-- Proximo dia apos o pedido (SP + corte_hora) cujo dia da semana (0=dom..6=sab) esta na regra do cliente e nao e feriado.
create or replace function public.rota_068_proximo_dia_semana(p_dt timestamptz, p_veiculo text, p_dias_semana smallint[])
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_d date;
  v_g integer := 0;
  v_corte smallint;
begin
  if p_dt is null or p_dias_semana is null or pg_catalog.cardinality(p_dias_semana) = 0 then return null; end if;
  v_d := (p_dt at time zone 'America/Sao_Paulo')::date;
  select c.corte_hora into v_corte from public.rota_config c where c.id = 1;
  if v_corte is not null and extract(hour from (p_dt at time zone 'America/Sao_Paulo')) >= v_corte then
    v_d := v_d + 1;
  end if;
  while v_g < 400 loop
    v_d := v_d + 1; v_g := v_g + 1;
    if extract(dow from v_d)::smallint = any (p_dias_semana) and not public.rota_068_eh_feriado(v_d) then
      return v_d;
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.rota_068_proximo_dia_semana(timestamptz, text, smallint[]) from public, anon, authenticated;

-- Veiculo efetivo do pedido (mesma precedencia da 065/066/070: plano ativo hoje/futuro > pedido > cliente > padrao 054).
create or replace function public.rota_068_veiculo_efetivo(p_cd_pedido bigint, p_doc text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select pl.veiculo_id from public.rota_plano_semana pl
      where pl.cd_pedido = p_cd_pedido and not pl.removido and pl.dia >= public.rota_068_prazo_hoje()),
    (select m.veiculo from public.rota_pedido_veiculo m where m.cd_pedido = p_cd_pedido),
    case when p_doc is not null then (select c.veiculo from public.rota_cliente_veiculo c where c.documento = p_doc) end,
    public.rota_054_padrao_separando()
  );
$$;
revoke all on function public.rota_068_veiculo_efetivo(bigint, text) from public, anon, authenticated;

-- Prazo ideal padrao configurado em rota_config (fallback = 2 dias uteis).
create or replace function public.rota_068_prazo_padrao_dias()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.prazo_ideal_dias from public.rota_config c where c.id = 1), 2);
$$;
revoke all on function public.rota_068_prazo_padrao_dias() from public, anon, authenticated;

-- Prazo ideal efetivo do pedido: excecao do pedido > regra do cliente > padrao configurado em rota_config.
create or replace function public.rota_068_prazo_calcular(p_cd_pedido bigint, p_dt timestamptz, p_doc text, p_veiculo text)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pp public.rota_068_prazo_pedido%rowtype;
  v_pc public.rota_068_prazo_cliente%rowtype;
begin
  select p.* into v_pp from public.rota_068_prazo_pedido p where p.cd_pedido = p_cd_pedido;
  if found then
    if v_pp.tipo = 'data' then return v_pp.data_agendada; end if;
    return public.rota_068_somar_dias_uteis(p_dt, p_veiculo, v_pp.dias);
  end if;
  if p_doc is not null then
    select c.* into v_pc from public.rota_068_prazo_cliente c where c.documento = p_doc;
    if found then
      if v_pc.tipo = 'semana' then return public.rota_068_proximo_dia_semana(p_dt, p_veiculo, v_pc.dias_semana); end if;
      return public.rota_068_somar_dias_uteis(p_dt, p_veiculo, v_pc.dias);
    end if;
  end if;
  return public.rota_068_somar_dias_uteis(p_dt, p_veiculo, public.rota_068_prazo_padrao_dias());
end;
$$;
revoke all on function public.rota_068_prazo_calcular(bigint, timestamptz, text, text) from public, anon, authenticated;

-- Regra final do dono + alinhamento 070 / CH r3: SOMENTE o HISTORICO trava.
-- 1) Se 070 instalada (producao 216d678): delega diretamente a public.rota_070_entregue(bigint) (fonte unica: historico_em <= hoje, politica, problema, reprogramacao, 059 e ERP legado).
-- 2) Senao, se CH r3 instalado: delega a public.rota_068_pedido_entregue(bigint).
-- 3) Fallback sem 070/H: aplica o MESMO predicado canonico CH r3 (problema/reprogramacao ativa = false;
--    COALESCE(reprogramacao.recebido_dia, pedido_entrega_rota, max(063 ativa), max(canhoto ativo), max(059.dia_saida),
--    ERP legado saiu/atendido anterior a 2026-11-23 ou anterior a canhoto_desde) < hoje SP).
create or replace function public.rota_068_prazo_travado(p_cd_pedido bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.rota_068_prazo_hoje();
  v_flag boolean := false;
  v_dia date := null;
begin
  if p_cd_pedido is null then return false; end if;

  -- Fonte canonica 070 (producao 216d678): inclui rota_070_historico_em, politica, problema, reprogramacao e legado ERP.
  if to_regprocedure('public.rota_070_entregue(bigint)') is not null then
    execute 'select coalesce(public.rota_070_entregue($1), false)' into v_flag using p_cd_pedido;
    return v_flag;
  end if;

  -- Fonte canonica CH r3 quando 070 nao esta instalada.
  if to_regprocedure('public.rota_068_pedido_entregue(bigint)') is not null then
    execute 'select coalesce(public.rota_068_pedido_entregue($1), false)' into v_flag using p_cd_pedido;
    return v_flag;
  end if;

  -- Fallback quando B roda sem 070/H: problema ativo ou reprogramacao ativa sempre liberam (false).
  if to_regclass('public.pedido_entrega_problema') is not null then
    execute 'select exists (select 1 from public.pedido_entrega_problema p where p.cd_pedido = $1 and p.desfeito_em is null)'
      into v_flag using p_cd_pedido;
    if v_flag then return false; end if;
  end if;
  if to_regclass('public.rota_068h_reprogramacao') is not null then
    execute 'select exists (select 1 from public.rota_068h_reprogramacao r where r.cd_pedido = $1 and r.ativa)'
      into v_flag using p_cd_pedido;
    if v_flag then return false; end if;
  end if;

  -- Data canonica de recebimento por precedencia estrita (identica a rota_068_recebido_dia do CH r3).
  if to_regclass('public.rota_068h_reprogramacao') is not null then
    execute 'select r.recebido_dia from public.rota_068h_reprogramacao r where r.cd_pedido = $1'
      into v_dia using p_cd_pedido;
  end if;

  if v_dia is null and to_regclass('public.pedido_entrega_rota') is not null then
    execute 'select e.data_entrega from public.pedido_entrega_rota e where e.cd_pedido = $1'
      into v_dia using p_cd_pedido;
  end if;

  if v_dia is null and to_regclass('public.pedido_entrega_confirmacao') is not null then
    select max((ec.confirmado_em at time zone 'America/Sao_Paulo')::date)
      into v_dia
      from public.pedido_entrega_confirmacao ec
     where ec.cd_pedido = p_cd_pedido and ec.desfeito_em is null;
  end if;

  if v_dia is null then
    select max((c.enviado_em at time zone 'America/Sao_Paulo')::date)
      into v_dia
      from public.pedido_canhoto c
     where c.cd_pedido = p_cd_pedido and c.substituido_em is null;
  end if;

  if v_dia is null and to_regclass('public.rota_059_saidas') is not null then
    execute 'select max(s.dia_saida) from public.rota_059_saidas s where s.cd_pedido = $1'
      into v_dia using p_cd_pedido;
  end if;

  if v_dia is null then
    select (coalesce(e.dt_saida, e.dt_nota, e.dt_atendido) at time zone 'America/Sao_Paulo')::date
      into v_dia
      from public.solidcon_pedidos_erp e
     where e.cd_pedido = p_cd_pedido
       and e.etapa in ('saiu', 'atendido')
       and coalesce(e.dt_saida, e.dt_nota, e.dt_atendido) is not null
       and (
         (coalesce(e.dt_saida, e.dt_nota, e.dt_atendido) at time zone 'America/Sao_Paulo')::date < date '2026-11-23'
         or coalesce(e.dt_saida, e.dt_nota, e.dt_atendido) < (select cfg.canhoto_desde from public.rota_config cfg where cfg.id = 1)
       );
  end if;

  return coalesce(v_dia < v_hoje, false);
end;
$$;
revoke all on function public.rota_068_prazo_travado(bigint) from public, anon, authenticated, service_role;
drop function if exists public.rota_068_prazo_entregue(bigint);

-- ===================== (3) RPCs =====================
create or replace function public.rota_068_prazo_salvar(
  p_cd_pedido bigint,
  p_tipo text,
  p_dias integer default null,
  p_data date default null,
  p_escopo text default 'pedido',
  p_motivo text default null,
  p_regra_dias_semana integer[] default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_nome text;
  v_motivo text;
  v_doc text;
  v_dt timestamptz;
  v_veic text;
  v_sem smallint[];
  v_prazo date;
begin
  if v_uid is null or not coalesce(public.pode_marcar_rota(), false) then
    raise exception 'sem permissao para alterar prazo' using errcode = '42501';
  end if;
  if p_cd_pedido is null or p_cd_pedido not between 1 and 999999999999
     or coalesce(p_escopo, '') not in ('pedido', 'cliente')
     or coalesce(p_tipo, '') not in ('dias_uteis', 'data', 'semana') then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
  end if;

  v_motivo := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_motivo, ''), '[ \t\r\n]+', ' ', 'g')), '');
  if v_motivo is null or pg_catalog.char_length(v_motivo) > 200 or v_motivo ~ '[[:cntrl:]<>]' then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'motivo_invalido');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(5100, 6802);

  select e.documento, e.dt_pedido into v_doc, v_dt
    from public.solidcon_pedidos_erp e
   where e.cd_pedido = p_cd_pedido;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'pedido_nao_encontrado');
  end if;
  if public.rota_068_prazo_travado(p_cd_pedido) then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'pedido_historico');
  end if;

  v_nome := public.rota_050_nome(v_uid);
  v_veic := public.rota_068_veiculo_efetivo(p_cd_pedido, v_doc);

  if p_escopo = 'cliente' then
    if v_doc is null or v_doc !~ '^[0-9]{11,14}$' then
      return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'cliente_sem_documento');
    end if;
    if p_tipo = 'data' or p_data is not null then
      return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
    end if;

    if p_regra_dias_semana is not null and pg_catalog.cardinality(p_regra_dias_semana) > 0 then
      if exists (select 1 from pg_catalog.unnest(p_regra_dias_semana) x where x is null or x not between 0 and 6) then
        return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
      end if;
      -- Domingo (0) so e aceito se estiver habilitado na configuracao prazo_dias_uteis_semana.
      if exists (select 1 from pg_catalog.unnest(p_regra_dias_semana) x where x = 0)
         and not (0::smallint = any (public.rota_068_prazo_dias_uteis_semana())) then
        return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'dia_sem_saida');
      end if;
      select pg_catalog.array_agg(distinct x::smallint order by x::smallint)
        into v_sem
        from pg_catalog.unnest(p_regra_dias_semana) x;

      -- B068-R1: calcula antes de persistir; recusa atomicamente se o calendario nao produz prazo valido.
      v_prazo := public.rota_068_proximo_dia_semana(v_dt, v_veic, v_sem);
      if v_prazo is null then
        return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'prazo_indisponivel');
      end if;

      insert into public.rota_068_prazo_cliente as c
        (documento, tipo, dias, dias_semana, motivo, atualizado_em, atualizado_por, atualizado_por_nome)
      values (v_doc, 'semana', null, v_sem, v_motivo, pg_catalog.now(), v_uid, v_nome)
      on conflict (documento) do update set
        tipo = excluded.tipo, dias = excluded.dias, dias_semana = excluded.dias_semana,
        motivo = excluded.motivo, atualizado_em = excluded.atualizado_em,
        atualizado_por = excluded.atualizado_por, atualizado_por_nome = excluded.atualizado_por_nome;

      -- Ao definir regra do cliente a partir deste pedido, limpa eventual excecao pontual dele (mesma regra da 044).
      delete from public.rota_068_prazo_pedido where cd_pedido = p_cd_pedido;

      insert into public.rota_068_prazo_log
        (escopo, acao, cd_pedido, documento, tipo, dias, data_agendada, dias_semana, motivo, por, por_nome)
      values ('cliente', 'salvar', p_cd_pedido, v_doc, 'semana', null, null, v_sem, v_motivo, v_uid, v_nome);
    elsif p_tipo = 'dias_uteis' then
      if p_dias is null or p_dias not between 0 and 365 then
        return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
      end if;
      v_prazo := public.rota_068_somar_dias_uteis(v_dt, v_veic, p_dias);
      if v_prazo is null then
        return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'prazo_indisponivel');
      end if;

      insert into public.rota_068_prazo_cliente as c
        (documento, tipo, dias, dias_semana, motivo, atualizado_em, atualizado_por, atualizado_por_nome)
      values (v_doc, 'dias_uteis', p_dias, null, v_motivo, pg_catalog.now(), v_uid, v_nome)
      on conflict (documento) do update set
        tipo = excluded.tipo, dias = excluded.dias, dias_semana = excluded.dias_semana,
        motivo = excluded.motivo, atualizado_em = excluded.atualizado_em,
        atualizado_por = excluded.atualizado_por, atualizado_por_nome = excluded.atualizado_por_nome;

      delete from public.rota_068_prazo_pedido where cd_pedido = p_cd_pedido;

      insert into public.rota_068_prazo_log
        (escopo, acao, cd_pedido, documento, tipo, dias, data_agendada, dias_semana, motivo, por, por_nome)
      values ('cliente', 'salvar', p_cd_pedido, v_doc, 'dias_uteis', p_dias, null, null, v_motivo, v_uid, v_nome);
    else
      return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
    end if;
  else
    -- escopo = 'pedido'
    if p_tipo = 'semana' or (p_regra_dias_semana is not null and pg_catalog.cardinality(p_regra_dias_semana) > 0) then
      return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
    end if;
    if p_tipo = 'dias_uteis' then
      if p_dias is null or p_dias not between 0 and 365 or p_data is not null then
        return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
      end if;
      v_prazo := public.rota_068_somar_dias_uteis(v_dt, v_veic, p_dias);
      if v_prazo is null then
        return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'prazo_indisponivel');
      end if;

      insert into public.rota_068_prazo_pedido as p
        (cd_pedido, tipo, dias, data_agendada, motivo, atualizado_em, atualizado_por, atualizado_por_nome)
      values (p_cd_pedido, 'dias_uteis', p_dias, null, v_motivo, pg_catalog.now(), v_uid, v_nome)
      on conflict (cd_pedido) do update set
        tipo = excluded.tipo, dias = excluded.dias, data_agendada = excluded.data_agendada,
        motivo = excluded.motivo, atualizado_em = excluded.atualizado_em,
        atualizado_por = excluded.atualizado_por, atualizado_por_nome = excluded.atualizado_por_nome;

      insert into public.rota_068_prazo_log
        (escopo, acao, cd_pedido, documento, tipo, dias, data_agendada, dias_semana, motivo, por, por_nome)
      values ('pedido', 'salvar', p_cd_pedido, v_doc, 'dias_uteis', p_dias, null, null, v_motivo, v_uid, v_nome);
    else
      -- p_tipo = 'data': aceita QUALQUER data >= hoje (inclusive semanas/meses futuros), usando os dias uteis configurados + feriados.
      if p_data is null or p_data < public.rota_068_prazo_hoje() or p_data > date '2100-12-31' or p_dias is not null then
        return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
      end if;
      if not public.rota_068_eh_dia_util_prazo(p_data) then
        return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'dia_sem_saida');
      end if;
      v_prazo := p_data;

      insert into public.rota_068_prazo_pedido as p
        (cd_pedido, tipo, dias, data_agendada, motivo, atualizado_em, atualizado_por, atualizado_por_nome)
      values (p_cd_pedido, 'data', null, p_data, v_motivo, pg_catalog.now(), v_uid, v_nome)
      on conflict (cd_pedido) do update set
        tipo = excluded.tipo, dias = excluded.dias, data_agendada = excluded.data_agendada,
        motivo = excluded.motivo, atualizado_em = excluded.atualizado_em,
        atualizado_por = excluded.atualizado_por, atualizado_por_nome = excluded.atualizado_por_nome;

      insert into public.rota_068_prazo_log
        (escopo, acao, cd_pedido, documento, tipo, dias, data_agendada, dias_semana, motivo, por, por_nome)
      values ('pedido', 'salvar', p_cd_pedido, v_doc, 'data', null, p_data, null, v_motivo, v_uid, v_nome);
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'cd_pedido', p_cd_pedido,
    'prazo_ideal', v_prazo,
    'origem', p_escopo
  );
end;
$$;
revoke all on function public.rota_068_prazo_salvar(bigint, text, integer, date, text, text, integer[]) from public, anon, authenticated;
grant execute on function public.rota_068_prazo_salvar(bigint, text, integer, date, text, text, integer[]) to authenticated;

create or replace function public.rota_068_prazo_remover_regra(p_documento text, p_motivo text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_nome text;
  v_motivo text;
  v_ant public.rota_068_prazo_cliente%rowtype;
begin
  if v_uid is null or not coalesce(public.pode_marcar_rota(), false) then
    raise exception 'sem permissao para remover regra de prazo' using errcode = '42501';
  end if;
  if p_documento is null or p_documento !~ '^[0-9]{11,14}$' then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
  end if;
  if p_motivo is not null then
    v_motivo := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(p_motivo, '[ \t\r\n]+', ' ', 'g')), '');
    if v_motivo is not null and (pg_catalog.char_length(v_motivo) > 200 or v_motivo ~ '[[:cntrl:]<>]') then
      return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'motivo_invalido');
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(5100, 6802);

  delete from public.rota_068_prazo_cliente c
   where c.documento = p_documento
  returning c.* into v_ant;

  if not found then
    return pg_catalog.jsonb_build_object('status', 'ok', 'alterado', false);
  end if;

  v_nome := public.rota_050_nome(v_uid);
  insert into public.rota_068_prazo_log
    (escopo, acao, cd_pedido, documento, tipo, dias, data_agendada, dias_semana, motivo, por, por_nome)
  values ('cliente', 'remover', null, p_documento, v_ant.tipo, v_ant.dias, null, v_ant.dias_semana,
          coalesce(v_motivo, 'Regra do cliente removida'), v_uid, v_nome);

  return pg_catalog.jsonb_build_object('status', 'ok', 'alterado', true);
end;
$$;
revoke all on function public.rota_068_prazo_remover_regra(text, text) from public, anon, authenticated;
grant execute on function public.rota_068_prazo_remover_regra(text, text) to authenticated;

create or replace function public.rota_068_prazo_remover_excecao(p_cd_pedido bigint, p_motivo text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_nome text;
  v_motivo text;
  v_ant public.rota_068_prazo_pedido%rowtype;
  v_doc text;
  v_dt timestamptz;
  v_veic text;
  v_prazo date;
  v_origem text;
begin
  if v_uid is null or not coalesce(public.pode_marcar_rota(), false) then
    raise exception 'sem permissao para remover excecao de prazo' using errcode = '42501';
  end if;
  if p_cd_pedido is null or p_cd_pedido not between 1 and 999999999999 then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
  end if;
  if p_motivo is not null then
    v_motivo := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(p_motivo, '[ \t\r\n]+', ' ', 'g')), '');
    if v_motivo is not null and (pg_catalog.char_length(v_motivo) > 200 or v_motivo ~ '[[:cntrl:]<>]') then
      return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'motivo_invalido');
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(5100, 6802);

  select e.documento, e.dt_pedido into v_doc, v_dt
    from public.solidcon_pedidos_erp e where e.cd_pedido = p_cd_pedido;
  if found and public.rota_068_prazo_travado(p_cd_pedido) then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'pedido_historico');
  end if;

  delete from public.rota_068_prazo_pedido p
   where p.cd_pedido = p_cd_pedido
  returning p.* into v_ant;

  if v_doc is not null or v_dt is not null or exists (select 1 from public.solidcon_pedidos_erp e where e.cd_pedido = p_cd_pedido) then
    v_veic := public.rota_068_veiculo_efetivo(p_cd_pedido, v_doc);
    v_prazo := public.rota_068_prazo_calcular(p_cd_pedido, v_dt, v_doc, v_veic);
    v_origem := case when v_doc is not null and exists (select 1 from public.rota_068_prazo_cliente c where c.documento = v_doc)
                     then 'cliente' else 'padrao' end;
  end if;

  if v_ant.cd_pedido is null then
    return pg_catalog.jsonb_build_object('status', 'ok', 'alterado', false, 'prazo_ideal', v_prazo, 'origem', v_origem);
  end if;

  v_nome := public.rota_050_nome(v_uid);
  insert into public.rota_068_prazo_log
    (escopo, acao, cd_pedido, documento, tipo, dias, data_agendada, dias_semana, motivo, por, por_nome)
  values ('pedido', 'remover', p_cd_pedido, v_doc, v_ant.tipo, v_ant.dias, v_ant.data_agendada, null,
          coalesce(v_motivo, 'Excecao do pedido removida'), v_uid, v_nome);

  return pg_catalog.jsonb_build_object('status', 'ok', 'alterado', true, 'prazo_ideal', v_prazo, 'origem', v_origem);
end;
$$;
revoke all on function public.rota_068_prazo_remover_excecao(bigint, text) from public, anon, authenticated;
grant execute on function public.rota_068_prazo_remover_excecao(bigint, text) to authenticated;

drop function if exists public.rota_068_prazo_ler(bigint[]);
create function public.rota_068_prazo_ler(p_cds bigint[])
returns table (
  cd_pedido bigint,
  prazo_ideal date,
  origem text,
  atraso_dias integer,
  motivo text,
  por text,
  em timestamptz,
  tipo text,
  dias integer,
  data date,
  dias_semana smallint[],
  excecao jsonb,
  travado boolean,
  veiculo_efetivo text,
  prazo_padrao_dias integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.rota_068_prazo_hoje();
  v_padrao integer := public.rota_068_prazo_padrao_dias();
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  if p_cds is null or pg_catalog.cardinality(p_cds) = 0 then
    return;
  end if;
  if pg_catalog.cardinality(p_cds) > 2000 then
    raise exception 'no maximo 2000 pedidos por chamada' using errcode = '22023';
  end if;

  return query
  with alvo as (
    select distinct x.cd from pg_catalog.unnest(p_cds) x(cd)
     where x.cd is not null and x.cd between 1 and 999999999999
  ), base as (
    select e.cd_pedido, e.documento, e.dt_pedido,
           public.rota_068_veiculo_efetivo(e.cd_pedido, e.documento) as veic,
           pp.cd_pedido as pp_cd, pp.tipo as pp_tipo, pp.dias as pp_dias, pp.data_agendada as pp_data,
           pp.motivo as pp_motivo, coalesce(pp.atualizado_por_nome, public.rota_050_nome(pp.atualizado_por)) as pp_por, pp.atualizado_em as pp_em,
           pc.documento as pc_doc, pc.tipo as pc_tipo, pc.dias as pc_dias, pc.dias_semana as pc_sem,
           pc.motivo as pc_motivo, coalesce(pc.atualizado_por_nome, public.rota_050_nome(pc.atualizado_por)) as pc_por, pc.atualizado_em as pc_em
      from alvo a
      join public.solidcon_pedidos_erp e on e.cd_pedido = a.cd
      left join public.rota_068_prazo_pedido pp on pp.cd_pedido = e.cd_pedido
      left join public.rota_068_prazo_cliente pc on pc.documento = e.documento
  ), calc as (
    select b.*,
           public.rota_068_prazo_calcular(b.cd_pedido, b.dt_pedido, b.documento, b.veic) as prazo_calc
      from base b
  )
  select c.cd_pedido,
         c.prazo_calc,
         case when c.pp_cd is not null then 'pedido'
              when c.pc_doc is not null then 'cliente'
              else 'padrao' end,
         case when c.prazo_calc is not null and v_hoje > c.prazo_calc then (v_hoje - c.prazo_calc)::integer else 0 end,
         case when c.pp_cd is not null then c.pp_motivo
              when c.pc_doc is not null then c.pc_motivo
              else null end,
         case when c.pp_cd is not null then c.pp_por
              when c.pc_doc is not null then c.pc_por
              else null end,
         case when c.pp_cd is not null then c.pp_em
              when c.pc_doc is not null then c.pc_em
              else null end,
         case when c.pp_cd is not null then c.pp_tipo
              when c.pc_doc is not null then c.pc_tipo
              else 'dias_uteis' end,
         case when c.pp_cd is not null then c.pp_dias
              when c.pc_doc is not null then c.pc_dias
              else v_padrao end,
         case when c.pp_cd is not null then c.pp_data
              else null end,
         case when c.pp_cd is not null then null::smallint[]
              when c.pc_doc is not null then c.pc_sem
              else null::smallint[] end,
         case when c.pp_cd is not null then pg_catalog.jsonb_build_object(
                'tipo', c.pp_tipo, 'dias', c.pp_dias, 'data', c.pp_data,
                'motivo', c.pp_motivo, 'por', c.pp_por, 'em', c.pp_em)
              else null end,
         public.rota_068_prazo_travado(c.cd_pedido),
         c.veic,
         v_padrao
    from calc c
   order by c.cd_pedido;
end;
$$;
revoke all on function public.rota_068_prazo_ler(bigint[]) from public, anon, authenticated;
grant execute on function public.rota_068_prazo_ler(bigint[]) to authenticated;

-- Prazo ideal padrao e dias uteis da semana (configuracao na tela de Rotas: ler=eh_equipe, salvar=pode_marcar_rota).
create or replace function public.rota_068_prazo_padrao_ler()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rec record;
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  select c.prazo_ideal_dias, c.prazo_dias_uteis_semana, c.prazo_ideal_atualizado_em,
         coalesce(c.prazo_ideal_atualizado_por_nome, public.rota_050_nome(c.prazo_ideal_atualizado_por)) as por_nome
    into v_rec
    from public.rota_config c
   where c.id = 1;
  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'prazo_ideal_dias', coalesce(v_rec.prazo_ideal_dias, 2),
    'prazo_dias_uteis_semana', pg_catalog.to_jsonb(coalesce(v_rec.prazo_dias_uteis_semana, array[1,2,3,4,5]::smallint[])),
    'atualizado_por', v_rec.por_nome,
    'atualizado_em', v_rec.prazo_ideal_atualizado_em
  );
end;
$$;
revoke all on function public.rota_068_prazo_padrao_ler() from public, anon, authenticated;
grant execute on function public.rota_068_prazo_padrao_ler() to authenticated;

drop function if exists public.rota_068_prazo_padrao_salvar(integer);
create or replace function public.rota_068_prazo_padrao_salvar(p_dias integer, p_dias_uteis_semana integer[] default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_nome text;
  v_em timestamptz := pg_catalog.now();
  v_uteis smallint[];
begin
  if v_uid is null or not coalesce(public.pode_marcar_rota(), false) then
    raise exception 'sem permissao para alterar prazo ideal padrao' using errcode = '42501';
  end if;
  if p_dias is null or p_dias not between 0 and 365 then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
  end if;

  if p_dias_uteis_semana is not null then
    if pg_catalog.cardinality(p_dias_uteis_semana) = 0
       or exists (select 1 from pg_catalog.unnest(p_dias_uteis_semana) x where x is null or x not between 0 and 6) then
      return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
    end if;
    select pg_catalog.array_agg(distinct x::smallint order by x::smallint)
      into v_uteis
      from pg_catalog.unnest(p_dias_uteis_semana) x;
  else
    v_uteis := null;
  end if;

  -- B068-R5-C: adquire trava 6802 ANTES de ler/atualizar rota_config e preserva prazo_dias_uteis_semana via COALESCE sobre a linha bloqueada.
  perform pg_catalog.pg_advisory_xact_lock(5100, 6802);

  -- Triggers rota_068_config_prazo_guardar/logar carimbam autor real e gravam o log atomicamente quando houver mudanca.
  update public.rota_config
     set prazo_ideal_dias = p_dias,
         prazo_dias_uteis_semana = coalesce(v_uteis, prazo_dias_uteis_semana)
   where id = 1
  returning prazo_dias_uteis_semana,
            prazo_ideal_atualizado_em,
            coalesce(prazo_ideal_atualizado_por_nome, public.rota_050_nome(prazo_ideal_atualizado_por))
    into v_uteis, v_em, v_nome;

  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'prazo_ideal_dias', p_dias,
    'prazo_dias_uteis_semana', pg_catalog.to_jsonb(v_uteis),
    'atualizado_por', v_nome,
    'atualizado_em', v_em
  );
end;
$$;
revoke all on function public.rota_068_prazo_padrao_salvar(integer, integer[]) from public, anon, authenticated;
grant execute on function public.rota_068_prazo_padrao_salvar(integer, integer[]) to authenticated;

-- Disponibilidade de datas para o mini calendario compartilhado (qualquer mes/periodo ate 366d).
-- Devolve tanto prazo_dias_uteis_semana (para o mini calendario de PRAZO) quanto dias_sem_saida + sem_saida_avulso
-- do veiculo (para o mini calendario de PROGRAMAR/MOVER na Semana).
create or replace function public.rota_068_calendario_veiculo(p_veiculo text, p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_veic record;
  v_hoje date := public.rota_068_prazo_hoje();
  v_uteis smallint[] := public.rota_068_prazo_dias_uteis_semana();
  v_fer_flag boolean;
  v_feriados jsonb;
  v_avulso jsonb;
  v_dias_prazo jsonb;
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  if p_veiculo is null or p_de is null or p_ate is null or p_ate < p_de or (p_ate - p_de) > 366 then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
  end if;
  select v.id, v.nome, v.ativo, v.dias_sem_saida into v_veic
    from public.rota_veiculos v where v.id = p_veiculo;
  if not found or not v_veic.ativo then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'veiculo_invalido');
  end if;

  select coalesce(c.feriados_sem_saida, true) into v_fer_flag from public.rota_config c where c.id = 1;

  select coalesce(pg_catalog.jsonb_agg(d::date order by d), '[]'::jsonb)
    into v_feriados
    from pg_catalog.generate_series(p_de::timestamp, p_ate::timestamp, interval '1 day') d
   where public.rota_068_eh_feriado(d::date);

  select coalesce(pg_catalog.jsonb_agg(s.dia order by s.dia), '[]'::jsonb)
    into v_avulso
    from public.rota_065_sem_saida s
   where s.veiculo_id = p_veiculo and s.dia between p_de and p_ate;

  -- Lista pronta dia-a-dia para o mini calendario compartilhado (TempRioCalendario) no modo PRAZO (mesmo formato do 070).
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'dia', x.dia,
      'habilitado', x.motivo is null,
      'motivo', x.motivo
    ) order by x.dia
  ), '[]'::jsonb)
    into v_dias_prazo
    from (
      select d::date as dia,
             case
               when d::date < v_hoje then 'dia_passado'
               when not (extract(dow from d::date)::smallint = any (v_uteis)) then
                 case when extract(dow from d::date) = 0 then 'domingo' else 'dia_nao_util' end
               when public.rota_068_eh_feriado(d::date) then 'feriado'
               else null
             end as motivo
        from pg_catalog.generate_series(p_de::timestamp, p_ate::timestamp, interval '1 day') d
    ) x;

  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'veiculo_id', v_veic.id,
    'hoje', v_hoje,
    'prazo_dias_uteis_semana', pg_catalog.to_jsonb(v_uteis),
    'dias_sem_saida', pg_catalog.to_jsonb(coalesce(v_veic.dias_sem_saida, array[0]::smallint[])),
    'feriados_sem_saida', coalesce(v_fer_flag, true),
    'feriados', v_feriados,
    'sem_saida_avulso', v_avulso,
    'dias_prazo', v_dias_prazo
  );
end;
$$;
revoke all on function public.rota_068_calendario_veiculo(text, date, date) from public, anon, authenticated;
grant execute on function public.rota_068_calendario_veiculo(text, date, date) to authenticated;

create or replace function public.rota_068_regras_prazo()
returns table (
  documento text,
  tipo text,
  dias integer,
  dias_semana smallint[],
  motivo text,
  por text,
  em timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  return query
  select c.documento, c.tipo, c.dias, c.dias_semana, c.motivo,
         coalesce(c.atualizado_por_nome, public.rota_050_nome(c.atualizado_por)),
         c.atualizado_em
    from public.rota_068_prazo_cliente c
   order by c.documento;
end;
$$;
revoke all on function public.rota_068_regras_prazo() from public, anon, authenticated;
grant execute on function public.rota_068_regras_prazo() to authenticated;

-- Limpeza periodica de excecoes de pedidos que sairam do ERP ha >60 dias (regras de cliente ficam).
create or replace function public.rota_068_prazo_limpar()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(5100, 6802);
  with removidos as (
    delete from public.rota_068_prazo_pedido p
     where p.atualizado_em < pg_catalog.now() - interval '60 days'
       and not exists (select 1 from public.solidcon_pedidos_erp e where e.cd_pedido = p.cd_pedido)
    returning p.*
  )
  insert into public.rota_068_prazo_log
    (escopo, acao, cd_pedido, documento, tipo, dias, data_agendada, dias_semana, motivo, por, por_nome)
  select 'pedido', 'limpeza', r.cd_pedido, null, r.tipo, r.dias, r.data_agendada, null, 'Excecao expirada (fora do ERP > 60d)', null, 'sistema'
    from removidos r;
  get diagnostics v_n = row_count;
  delete from public.rota_068_prazo_log l where l.em < pg_catalog.now() - interval '365 days';
  return v_n;
end;
$$;
revoke all on function public.rota_068_prazo_limpar() from public, anon, authenticated;

-- ===================== (4) integracao com rota_066_sugestoes =====================
-- Corpo identico ao da 066, trocando apenas rota_066_prazo(q.dt_pedido, q.veic) por
-- rota_068_prazo_calcular(q.cd, q.dt_pedido, q.doc, q.veic).
create or replace function public.rota_066_sugestoes(p_semana date)
returns jsonb
language plpgsql
stable
security definer   -- le tabelas sem grant (memoria/feedback) e funcoes privadas; acesso conferido abaixo
set search_path = ''
as $$
declare
  v_hoje date := public.rota_050_hoje();
  v_res jsonb;
begin
  if not coalesce(public.pode_marcar_rota(), false) then
    raise exception 'sem permissao para ver sugestoes da rota' using errcode = '42501';
  end if;
  if p_semana is null or extract(isodow from p_semana) <> 1 or p_semana < v_hoje - 56 or p_semana > v_hoje + 84 then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
  end if;
  with
  cel as (   -- dia/veiculo programavel na semana: editavel (065) e o veiculo sai
    select d.dia, v.id veiculo_id, coalesce(v.nome, v.id) vnome, v.modo, v.capacidade_volume::numeric cap
      from (select (p_semana + k) dia from pg_catalog.generate_series(0, 5) k) d
      join public.rota_veiculos v on v.ativo
     where public.rota_065_dia_editavel(d.dia) and public.rota_066_saida(v.id, d.dia)
  ),
  geo as (
    select g.documento, g.lat::double precision lat, g.lng::double precision lng
      from public.solidcon_clientes_geo g where g.precisao <> 'nao_encontrado' and g.lat is not null
  ),
  hist as (  -- memoria: 12 semanas antes da semana pedida; foto vence plano do mesmo pedido; meia-vida 4 semanas
    select distinct on (h.cd_pedido) h.cd_pedido, h.documento doc, h.dia, h.veiculo_id,
           pg_catalog.power(0.5, (p_semana - h.dia) / 28.0)::double precision w
      from public.rota_066_historico h
     where h.dia >= p_semana - 84 and h.dia < p_semana and h.documento is not null
     order by h.cd_pedido, (h.fonte = 'foto') desc, h.dia desc
  ),
  hdia as (select x.doc, x.dia, x.veiculo_id, max(x.w) w from hist x group by 1, 2, 3),
  hdow as (select x.doc, extract(isodow from x.dia)::integer dow, sum(x.w) w from hdia x group by 1, 2),
  htot as (select x.doc, sum(x.w) w from hdia x group by 1),
  hveic as (select distinct on (y.doc) y.doc, y.veiculo_id from (select x.doc, x.veiculo_id, sum(x.w) w from hdia x group by 1, 2) y
             order by y.doc, y.w desc, y.veiculo_id),
  hpar as (select a.doc a, b.doc b, sum(least(a.w, b.w)) w from hdia a join hdia b on b.dia = a.dia and b.veiculo_id = a.veiculo_id and b.doc <> a.doc
            group by 1, 2),
  hparadas as (select y.veiculo_id, pg_catalog.ceil(avg(y.n))::integer cap
                 from (select x.dia, x.veiculo_id, count(*) n from hdia x group by 1, 2) y group by 1),
  fb as (
    select f.documento doc, extract(isodow from f.dia)::integer dow,
           sum(case when f.acao = 'aceita' then pg_catalog.power(0.5, extract(epoch from (pg_catalog.now() - f.registrado_em)) / 86400 / 28) else 0 end) acc,
           sum(case when f.acao = 'ignorada' then pg_catalog.power(0.5, extract(epoch from (pg_catalog.now() - f.registrado_em)) / 86400 / 28) else 0 end) ign
      from public.rota_066_feedback f where f.registrado_em >= pg_catalog.now() - interval '84 days' and f.documento is not null
     group by 1, 2
  ),
  fbcd as (select distinct f.cd_pedido cd, f.dia from public.rota_066_feedback f
            where f.acao = 'ignorada' and f.registrado_em >= pg_catalog.now() - interval '84 days'),
  ped as (   -- pendentes fora da foto de hoje
    select p.cd_pedido cd, p.documento doc, p.dt_pedido, public.rota_066_volume(p.caixas_24, p.caixas_48, p.caixas_outras) vol,
           pl.dia pl_dia, pl.veiculo_id pl_veic, pl.removido pl_rem, m.veiculo m_veic, c.veiculo c_veic, hv.veiculo_id h_veic,
           g.lat, g.lng, coalesce(cl.nome, 'pedido ' || p.cd_pedido) nome
      from public.solidcon_pedidos_erp p
      left join public.rota_plano_semana pl on pl.cd_pedido = p.cd_pedido
      left join public.rota_pedido_veiculo m on m.cd_pedido = p.cd_pedido
      left join public.rota_cliente_veiculo c on c.documento = p.documento
      left join hveic hv on hv.doc = p.documento
      left join geo g on g.documento = p.documento
      left join public.solidcon_clientes cl on cl.documento = p.documento
     where p.etapa in ('aberto', 'na_carga', 'separando', 'separado', 'conferido')
       and public.rota_055_pendente(p.cd_pedido, v_hoje)
       and not exists (select 1 from public.rota_pedido_ignorado i where i.cd_pedido = p.cd_pedido)
       and not exists (select 1 from public.rota_dia_item f where f.data = v_hoje and f.cd_pedido = p.cd_pedido and f.removido_em is null)
  ),
  ped2 as (
    select q.*, public.rota_068_prazo_calcular(q.cd, q.dt_pedido, q.doc, q.veic) prazo
      from (select p.*, coalesce(case when p.pl_rem is false and p.pl_dia >= v_hoje then p.pl_veic end, p.m_veic, p.c_veic, p.h_veic,
                                 public.rota_054_padrao_separando()) veic,
                   (p.m_veic is null and p.c_veic is null and not (p.pl_rem is false and p.pl_dia >= v_hoje)) sem_marcacao
              from ped p) q
  ),
  alvo as (  -- sem programacao valida: sem plano, removido, plano velho, ou plano depois do prazo
    select p.*, (p.pl_rem is false and p.pl_dia >= v_hoje and p.prazo is not null and p.pl_dia > p.prazo) atrasa_plano
      from ped2 p
     where not (p.pl_rem is false and p.pl_dia >= v_hoje and (p.prazo is null or p.pl_dia <= p.prazo))
  ),
  prog as (  -- o que ja esta programado nas celulas e AINDA vale (B066-R1): plano ativo de pedido elegivel (mesmo filtro
             -- de ped: etapa aberto..conferido, pendente 055/063 sem Recebido/canhoto, nao 045, fora da foto de hoje)
    select p.pl_dia dia, p.pl_veic veiculo_id, p.cd, p.doc, p.vol, p.lat, p.lng, p.nome
      from ped p
      join cel c on c.dia = p.pl_dia and c.veiculo_id = p.pl_veic
     where p.pl_rem is false
  ),
  dias as (
    select c.dia, c.veiculo_id, c.vnome, c.modo, c.cap,
           coalesce((select sum(x.vol) from prog x where x.dia = c.dia and x.veiculo_id = c.veiculo_id), 0) vol,
           (select count(distinct coalesce(x.doc, x.cd::text)) from prog x where x.dia = c.dia and x.veiculo_id = c.veiculo_id) n_doc,
           case when c.modo = 'cd_ceasa' then null else hp.cap end paradas_max
      from cel c left join hparadas hp on hp.veiculo_id = c.veiculo_id
  ),
  dias2 as (
    select d.*, case when d.modo = 'cd_ceasa' then least(d.n_doc, 1) else d.n_doc end paradas from dias d
  ),
  cand as (
    select a.cd, c.dia, c.veiculo_id, (a.prazo is not null and c.dia > a.prazo) late
      from alvo a join cel c on c.veiculo_id = a.veic
     where not (a.pl_rem is true and c.dia = a.pl_dia)                  -- tirado deste dia: nao sugere de volta
  ),
  lim as (select k.cd, max(k.dia) filter (where not k.late) dia_base, min(k.dia) primeiro from cand k group by k.cd),
  cand2 as (
    select k.cd, k.dia, k.veiculo_id, l.dia_base from cand k join lim l on l.cd = k.cd
     where (l.dia_base is not null and not k.late) or (l.dia_base is null and k.dia = l.primeiro)
  ),
  pont as (
    select k.cd, k.dia, k.veiculo_id, k.dia_base,
           (case when k.dia_base is null then 100 + least(30, greatest(0, k.dia - coalesce(a.prazo, k.dia)) * 5)
                 else 40 - 3 * (k.dia_base - k.dia) end)::double precision s_prazo,
           rg.km rg_km, rg.nome rg_nome,
           case when rg.km is not null and rg.km <= 3 then 25 * (1 - rg.km / 3) else 0 end s_reg,
           case when t.w > 0 then 15 * coalesce(hd.w, 0) / t.w else 0 end s_dow,
           least(20, 10 * coalesce(jt.w, 0)) s_junto, jt.nome junto_nome,
           (8 * coalesce(f.acc, 0) - 15 * coalesce(f.ign, 0) - case when fc.cd is not null then 30 else 0 end)::double precision s_fb,
           (case when dd.cap is not null and a.vol is not null and dd.vol + a.vol > dd.cap then -60 else 0 end
            + case when dd.paradas_max is not null and dd.paradas_max < dd.paradas
                        + case when exists (select 1 from prog x where x.dia = k.dia and x.veiculo_id = k.veiculo_id and x.doc = a.doc) then 0 else 1 end
                   then -40 else 0 end)::double precision s_cap
      from cand2 k
      join alvo a on a.cd = k.cd
      join dias2 dd on dd.dia = k.dia and dd.veiculo_id = k.veiculo_id
      left join htot t on t.doc = a.doc
      left join hdow hd on hd.doc = a.doc and hd.dow = extract(isodow from k.dia)::integer
      left join fb f on f.doc = a.doc and f.dow = extract(isodow from k.dia)::integer
      left join fbcd fc on fc.cd = k.cd and fc.dia = k.dia
      left join lateral (select x.nome, public.rota_066_km(a.lat, a.lng, x.lat, x.lng) km from prog x
                          where x.dia = k.dia and x.veiculo_id = k.veiculo_id and x.cd <> k.cd and a.lat is not null and x.lat is not null
                          order by 2, x.cd limit 1) rg on true
      left join lateral (select sum(hp.w) w, (pg_catalog.array_agg(x.nome order by hp.w desc, x.cd))[1] nome
                           from prog x join hpar hp on hp.a = a.doc and hp.b = x.doc
                          where x.dia = k.dia and x.veiculo_id = k.veiculo_id) jt on true
  ),
  melhor as (
    select distinct on (p.cd) p.*, p.s_prazo + p.s_reg + p.s_dow + p.s_junto + p.s_fb + p.s_cap total
      from pont p order by p.cd, p.s_prazo + p.s_reg + p.s_dow + p.s_junto + p.s_fb + p.s_cap desc, p.dia desc
  ),
  saida_ped as (
    -- B066-R2: faixas que os pesos nao atravessam. Sem dia no prazo (vencido / vence hoje / sem saida ate la) = 100+;
    -- os demais ficam em ate 99. Capacidade/feedback so avisam (motivo) e escolhem dia dentro da faixa.
    select a.cd, a.prazo, m.dia, m.veiculo_id,
           case when m.cd is null then null
                when m.dia_base is null then m.s_prazo + greatest(0, m.total - m.s_prazo)   -- >= 100, mais atraso = maior
                else least(99, m.total) end total,
           pg_catalog.array_remove(array[
             case when m.cd is null then 'sem_dia_de_saida'
                  when a.prazo is null then 'sem_prazo'
                  when m.dia_base is not null then 'prazo'
                  when a.prazo < v_hoje then 'vencido'
                  when a.prazo = v_hoje then 'vence_hoje'
                  else 'atrasa' end,
             case when a.atrasa_plano then 'atrasa_no_plano' end,
             case when m.s_reg > 0 then 'mesma_regiao' end,
             case when m.s_dow >= 6 then 'costuma_dia' end,
             case when m.s_junto > 0 then 'costuma_junto' end,
             case when m.s_fb < 0 then 'feedback_ignorado' end,
             case when m.s_fb > 0 then 'feedback_aceito' end,
             case when m.s_cap < 0 then 'sem_capacidade' end,
             case when a.lat is null then 'sem_geo' end,
             case when a.sem_marcacao then 'sem_marcacao' end], null) motivo,
           (case when a.atrasa_plano then 'Programado ' || public.rota_066_dia_txt(a.pl_dia, p_semana) || ' atrasa. ' else '' end
            || case when m.cd is null then 'Sem saída do ' || coalesce((select coalesce(v.nome, v.id) from public.rota_veiculos v where v.id = a.veic), a.veic) || ' nesta semana'
                    when a.prazo is null then 'Sugerido ' || public.rota_066_dia_txt(m.dia, p_semana)
                    when a.prazo < v_hoje then 'Venceu ' || public.rota_066_dia_txt(a.prazo, p_semana) || ' — primeiro dia livre ' || public.rota_066_dia_txt(m.dia, p_semana)
                    when a.prazo = v_hoje then 'Vence hoje — primeiro dia livre ' || public.rota_066_dia_txt(m.dia, p_semana)
                    when m.dia_base is null then 'Vence ' || public.rota_066_dia_txt(a.prazo, p_semana) || ' sem saída até lá — primeiro dia ' || public.rota_066_dia_txt(m.dia, p_semana)
                    else 'Vence ' || public.rota_066_dia_txt(a.prazo, p_semana) || ' — sugerido ' || public.rota_066_dia_txt(m.dia, p_semana) end
            || case when m.cd is null then ''
                    when m.s_reg > 0 then ' (mesma região de ' || m.rg_nome || ')'
                    when m.s_dow >= 6 and m.s_junto > 0 then ' (costuma ir às ' || (array['segundas','terças','quartas','quintas','sextas','sábados'])[extract(isodow from m.dia)::integer] || ' com ' || m.junto_nome || ')'
                    when m.s_junto > 0 then ' (costuma ir com ' || m.junto_nome || ')'
                    when m.s_dow >= 6 then ' (costuma ir às ' || (array['segundas','terças','quartas','quintas','sextas','sábados'])[extract(isodow from m.dia)::integer] || ')'
                    when m.s_cap < 0 then ' (passa da capacidade)'
                    else '' end) texto,
           a.pl_dia, a.pl_rem
      from alvo a left join melhor m on m.cd = a.cd
  ),
  enc as (
    select dd.dia, dd.veiculo_id, dd.vnome, dd.cap, dd.vol dvol, a.cd, n.km, n.cd perto_cd, n.nome perto_nome,
           pg_catalog.row_number() over (partition by dd.dia, dd.veiculo_id order by n.km, a.cd) rk
      from dias2 dd
      join alvo a on a.veic = dd.veiculo_id and not a.atrasa_plano and a.lat is not null
                 and (a.prazo is null or dd.dia <= a.prazo)
                 and not (a.pl_rem is true and a.pl_dia = dd.dia)
      cross join lateral (select x.cd, x.nome, public.rota_066_km(a.lat, a.lng, x.lat, x.lng) km from prog x
                           where x.dia = dd.dia and x.veiculo_id = dd.veiculo_id and x.lat is not null order by 3, x.cd limit 1) n
     where n.km <= 5
       and (dd.cap is null or a.vol is null or dd.vol + a.vol <= dd.cap)
       and (dd.paradas_max is null or dd.paradas < dd.paradas_max)
  )
  select pg_catalog.jsonb_build_object(
    'status', 'ok', 'semana', p_semana, 'hoje', v_hoje,
    'versao', coalesce((select s.versao from public.rota_065_semana s where s.inicio = p_semana), 0),
    'pedidos', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'cd_pedido', s.cd, 'dia_sugerido', s.dia, 'veiculo_sugerido', s.veiculo_id, 'motivo', pg_catalog.to_jsonb(s.motivo),
                   'texto', s.texto, 'score', round(coalesce(s.total, 0)::numeric, 1), 'prazo', s.prazo,
                   'atrasado_se_dia', s.prazo + 1,
                   'dia_plano', case when s.pl_rem is false and s.pl_dia >= v_hoje then s.pl_dia end)
                 order by coalesce(s.total, -1000) desc, s.cd) from saida_ped s), '[]'::jsonb),
    'dias', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'dia', d.dia, 'veiculo_id', d.veiculo_id, 'cx_planejadas', round(d.vol / 9, 1),
                 'cx_capacidade', round(d.cap / 9, 1), 'paradas', d.paradas,
                 'folga_cx', round((d.cap - d.vol) / 9, 1), 'paradas_max', d.paradas_max,
                 'folga_paradas', d.paradas_max - d.paradas)
               order by d.dia, d.veiculo_id) from dias2 d), '[]'::jsonb),
    'encaixes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'dia', e.dia, 'veiculo_id', e.veiculo_id, 'cd_pedido', e.cd, 'distancia_km', round(e.km::numeric, 1),
                 'perto_de_cd', e.perto_cd,
                 'texto', e.vnome || case when e.cap is null then ' sem limite de cx na ' || public.rota_066_dia_txt(e.dia, p_semana)
                                         else ' tem ' || round((e.cap - e.dvol) / 9) || ' cx livres na ' || public.rota_066_dia_txt(e.dia, p_semana) end
                          || ': cabe Pedido ' || e.cd || ' (' || pg_catalog.replace(round(e.km::numeric, 1)::text, '.', ',') || ' km de ' || e.perto_nome || ')')
               order by e.dia, e.veiculo_id, e.rk) from enc e where e.rk <= 3), '[]'::jsonb))
    into v_res;
  return v_res;
end;
$$;
revoke all on function public.rota_066_sugestoes(date) from public, anon, authenticated;
grant execute on function public.rota_066_sugestoes(date) to authenticated;

-- Cron opcional (diario 06:35 UTC = 03:35 SP).
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null and to_regclass('cron.job') is not null then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'rota-068-prazo-limpeza';
    perform cron.schedule('rota-068-prazo-limpeza', '35 6 * * *', 'select public.rota_068_prazo_limpar();');
  else
    raise notice '068 B sem pg_cron: limpeza opcional nao agendada.';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
