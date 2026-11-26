-- 065: Semana programavel (quadro de arrastar). O plano salvo VALE no fechamento do dia; "veiculo nao sai nesta data".
-- Contrato com o front: docs/plans/2026-11-25-semana-065-contrato.md. Rollback: 065_rollback.sql.
-- Requer 046/047 (rota_plano_semana com veiculo_id, rota_veiculos.modo), 050/055 (rota_dia_fechada, rota_050_gravar_itens,
-- rota_055_pendente), 045 (rota_pedido_ignorado), 044 (pode_marcar_rota). Aditiva e idempotente; nao apaga dados.
--
-- (1) rota_plano_semana ganha ordem (1..N por dia+veiculo; null = CD/CEASA ou removido) e removido (tirado do dia: nao
--     entra no fechamento). A 047 continua gravando (sem ordem, removido=false).
-- (2) rota_065_semana: versao por semana (segunda). Sobe a CADA gravacao do plano daquela semana (gatilho por linha,
--     inclusive pela 046/047 e pelo insert/update/delete direto) e a cada "nao sai nesta data".
-- (3) rota_065_sem_saida (dia, veiculo_id, motivo): datas avulsas sem saida. Os dias fixos seguem em rota_veiculos.
-- (4) RPCs:
--     rota_065_ler_semana(p_inicio)                               DEFINER, so eh_equipe (le so a semana pedida).
--     rota_065_salvar_semana(p_inicio, p_versao_base, p_itens, p_veiculo default null)  DEFINER, pode_marcar_rota.
--     rota_065_marcar_sem_saida(p_dia, p_veiculo, p_sem_saida, p_versao_base, p_motivo default null) DEFINER, pode_marcar_rota.
--     So falta de permissao levanta 42501; o resto devolve {status:'erro', motivo}. Gravacoes sob o lock 5100/4601 (046).
-- (5) Fechamento: rota_050_gravar_itens (corpo da 055) aplica o plano do dia ANTES de gravar a foto, no manual (050_fechar)
--     e no automatico (050_fechar_auto / Edge): planejado p/ hoje entra (veiculo e ordem do plano), planejado p/ outro
--     dia ou removido sai, veiculo com "nao sai nesta data" sai. Respeita 045 (ignorado) e 055/063 (pendente).
--     B065-R1: no AUTOMATICO (rota_dia_fechada.automatico) o corte 061 vale sobre a lista FINAL ja mesclada com o
--     plano (criado/separado depois de hora_saida nao entra). Manual continua livre quanto ao corte.
-- (6) B065-R2: inclusao automatica 054 (candidatos + revalidacao em rota_054_incluir) respeita o plano: outro dia,
--     removido, veiculo sem saida (fixo ou avulso) e veiculo do plano de hoje; sob a trava 4601 (depois da 5001).
--     Proposta do painel/Edge que ainda traga um pedido que o plano tira e aceita sem ele. "Trazer para hoje"
--     (rota_050_ajustar) continua livre.
-- (7) B065-R3/R4: linha de dia NAO editavel (hoje/fechado/passado desta semana, veiculo inativo/sem saida) fica como
--     esta: salvar_semana recusa mexer nela (dia_bloqueado, origem) e o DELETE so pega linha editavel; a 047/046
--     legada ignora (sem efeito) item/linha travados, limpa removido e grava ordem 1..N; gatilho barra DML direto
--     do authenticated em linha travada. Ordem das travas: 5201 -> 5001 -> 4601 (ninguem pega 4601 e depois 5001).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
begin
  if to_regclass('public.rota_plano_semana') is null or to_regclass('public.rota_veiculos') is null
     or to_regclass('public.rota_dia_fechada') is null or to_regclass('public.rota_pedido_ignorado') is null
     or to_regclass('public.solidcon_pedidos_erp') is null
     or to_regprocedure('public.rota_050_gravar_itens(date,jsonb,uuid)') is null
     or to_regprocedure('public.rota_055_pendente(bigint,date)') is null
     or to_regprocedure('public.rota_050_hoje()') is null
     or to_regprocedure('public.pode_marcar_rota()') is null or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('public.rota_054_candidatos(date)') is null or to_regprocedure('public.rota_054_incluir(date,integer,jsonb)') is null
     or to_regprocedure('public.rota_054_tem_saida(date,text)') is null or to_regprocedure('public.rota_061_auto_aberta(date)') is null
     or to_regclass('public.rota_059_saidas') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rota_plano_semana' and column_name = 'veiculo_id')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rota_veiculos' and column_name = 'modo') then
    raise exception '065 requer 044/045/046/047/050/054/055/059/061. Nada foi aplicado.';
  end if;
end;
$$;
select pg_catalog.pg_advisory_xact_lock(5100, 5201);
select pg_catalog.pg_advisory_xact_lock(5100, 5001);
select pg_catalog.pg_advisory_xact_lock(5100, 4601);

-- ===================== (1) plano: ordem e removido =====================
alter table public.rota_plano_semana add column if not exists ordem integer;
alter table public.rota_plano_semana add column if not exists removido boolean not null default false;
alter table public.rota_plano_semana drop constraint if exists rota_plano_semana_065_ordem;
alter table public.rota_plano_semana add constraint rota_plano_semana_065_ordem
  check ((ordem is null or ordem between 1 and 100000) and (not removido or ordem is null));

-- ===================== (2) versao por semana =====================
create table if not exists public.rota_065_semana (
  inicio date primary key check (extract(isodow from inicio) = 1),
  versao bigint not null default 0 check (versao >= 0),
  atualizado_em timestamptz not null default pg_catalog.now(),
  atualizado_por uuid
);
-- ===================== (3) datas avulsas sem saida =====================
create table if not exists public.rota_065_sem_saida (
  dia date not null check (extract(isodow from dia) between 1 and 6 and dia between date '2020-01-01' and date '2100-12-31'),
  veiculo_id text not null references public.rota_veiculos(id) on delete cascade,
  motivo text check (motivo is null or (pg_catalog.char_length(motivo) between 1 and 80 and motivo !~ '[[:cntrl:]<>]')),
  marcado_em timestamptz not null default pg_catalog.now(),
  marcado_por uuid,
  primary key (dia, veiculo_id)
);
alter table public.rota_065_semana enable row level security;
alter table public.rota_065_sem_saida enable row level security;
revoke all on public.rota_065_semana, public.rota_065_sem_saida from public, anon, authenticated;
grant select on public.rota_065_semana, public.rota_065_sem_saida to authenticated;
drop policy if exists rota_065_equipe_le on public.rota_065_semana;
create policy rota_065_equipe_le on public.rota_065_semana for select to authenticated using ((select public.eh_equipe()));
drop policy if exists rota_065_equipe_le on public.rota_065_sem_saida;
create policy rota_065_equipe_le on public.rota_065_sem_saida for select to authenticated using ((select public.eh_equipe()));

create or replace function public.rota_065_subir(p_dia date)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.rota_065_semana as s (inicio, versao, atualizado_em, atualizado_por)
  values (p_dia - (extract(isodow from p_dia)::integer - 1), 1, pg_catalog.now(), auth.uid())
  on conflict (inicio) do update set versao = s.versao + 1, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por;
$$;
revoke all on function public.rota_065_subir(date) from public, anon, authenticated;

create or replace function public.rota_065_plano_versao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.rota_065_subir(old.dia); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.dia is distinct from old.dia) then perform public.rota_065_subir(new.dia); end if;
  return null;
end;
$$;
revoke all on function public.rota_065_plano_versao() from public, anon, authenticated;
drop trigger if exists rota_065_plano_versao on public.rota_plano_semana;
create trigger rota_065_plano_versao after insert or update or delete on public.rota_plano_semana
  for each row execute function public.rota_065_plano_versao();

-- Veiculo sai em p_dia? Ativo, fora dos dias fixos sem saida e sem data avulsa. (Feriados: o painel/rota-core.)
create or replace function public.rota_065_sai(p_veiculo text, p_dia date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.rota_veiculos v
                  where v.id = p_veiculo and v.ativo and not (extract(dow from p_dia)::smallint = any (v.dias_sem_saida)))
     and not exists (select 1 from public.rota_065_sem_saida s where s.dia = p_dia and s.veiculo_id = p_veiculo);
$$;
revoke all on function public.rota_065_sai(text, date) from public, anon, authenticated;

-- Dia editavel no quadro: depois de hoje (SP) e sem foto fechada.
create or replace function public.rota_065_dia_editavel(p_dia date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_dia > public.rota_050_hoje()
     and not exists (select 1 from public.rota_dia_fechada f where f.data = p_dia and f.estado = 'fechada');
$$;
revoke all on function public.rota_065_dia_editavel(date) from public, anon, authenticated;

-- B065-R3: o editavel COMPLETO de uma linha do plano = dia editavel + veiculo ativo que sai naquele dia.
-- Execute para authenticated: o gatilho de guarda (invoker) chama; so devolve boolean, sem dado de pedido.
create or replace function public.rota_065_linha_editavel(p_dia date, p_veiculo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.rota_065_dia_editavel(p_dia) and public.rota_065_sai(p_veiculo, p_dia), false);
$$;
revoke all on function public.rota_065_linha_editavel(date, text) from public, anon, authenticated;
grant execute on function public.rota_065_linha_editavel(date, text) to authenticated;

-- Linha JA SALVA que nao pode mudar nem sumir: da segunda desta semana (SP) em diante e nao editavel (hoje, fechado,
-- passado desta semana, veiculo inativo/sem saida). Semanas anteriores (sobra que a limpeza 046 ainda nao apagou)
-- podem ser reprogramadas: o pedido pendente aparece na bandeja.
create or replace function public.rota_065_travada(p_dia date, p_veiculo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_dia >= public.rota_050_hoje() - (extract(isodow from public.rota_050_hoje())::integer - 1)
     and not public.rota_065_linha_editavel(p_dia, p_veiculo);
$$;
revoke all on function public.rota_065_travada(date, text) from public, anon, authenticated;
grant execute on function public.rota_065_travada(date, text) to authenticated;

-- B065-R3: DML direto do cliente (policies 046 por pode_marcar_rota) e a 047 (invoker) nao mexem em linha travada nem
-- gravam em dia nao editavel. Funcoes DEFINER (065, limpeza 046, fechamento) rodam como dono e passam direto.
create or replace function public.rota_065_plano_guardar()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user is distinct from 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and public.rota_065_travada(old.dia, old.veiculo_id) then
    raise exception 'plano: pedido % em dia somente leitura', old.cd_pedido using errcode = '22023';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and not public.rota_065_linha_editavel(new.dia, new.veiculo_id) then
    raise exception 'plano: dia % nao editavel para o veiculo %', new.dia, new.veiculo_id using errcode = '22023';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.rota_065_plano_guardar() from public, anon, authenticated;
drop trigger if exists rota_065_plano_guardar on public.rota_plano_semana;
create trigger rota_065_plano_guardar before insert or update or delete on public.rota_plano_semana
  for each row execute function public.rota_065_plano_guardar();

-- B065-R2: o plano tira o pedido da inclusao AUTOMATICA de p_data (mesma regra do fechamento): programado p/ outro dia
-- (futuro), removido de p_data, programado p/ p_data num veiculo que nao sai, ou o veiculo dele tem "nao sai nesta data".
create or replace function public.rota_065_fora_auto(p_cd bigint, p_data date, p_veiculo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.rota_plano_semana p
                  where p.cd_pedido = p_cd
                    and ((p.dia = p_data and (p.removido or not public.rota_065_sai(p.veiculo_id, p_data)))
                         or (p.dia > p_data and not p.removido)))
      or exists (select 1 from public.rota_065_sem_saida s where s.dia = p_data and s.veiculo_id = p_veiculo);
$$;
revoke all on function public.rota_065_fora_auto(bigint, date, text) from public, anon, authenticated;

-- B065-R1: corte 061 (mesma conta da rota_050_fechar_auto): criado ou com separacao iniciada DEPOIS da saida de p_data.
-- hora_saida truncada ao minuto; 08:00:00 exato ainda entra, 08:00:00.001 nao.
create or replace function public.rota_065_pos_corte(p_cd bigint, p_data date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.solidcon_pedidos_erp p
                  cross join lateral (select coalesce((select c.hora_saida from public.rota_config c where c.id = 1), '08:00'::time) h) cfg
                  where p.cd_pedido = p_cd
                    and greatest(p.dt_pedido, p.dt_sep_inicio) >
                        ((p_data + pg_catalog.make_time(extract(hour from cfg.h)::integer, extract(minute from cfg.h)::integer, 0))
                          at time zone 'America/Sao_Paulo'));
$$;
revoke all on function public.rota_065_pos_corte(bigint, date) from public, anon, authenticated;

-- ===================== (4) RPCs =====================
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
revoke all on function public.rota_065_ler_semana(date) from public, anon, authenticated;
grant execute on function public.rota_065_ler_semana(date) to authenticated;

create or replace function public.rota_065_salvar_semana(p_inicio date, p_versao_base bigint, p_itens jsonb, p_veiculo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_versao bigint;
  v_cd bigint;
  v_n integer;
  v_campos constant text[] := array['cd_pedido', 'dia', 'veiculo_id', 'ordem', 'removido'];
begin
  if not coalesce(public.pode_marcar_rota(), false) then
    raise exception 'sem permissao para salvar o plano' using errcode = '42501';
  end if;
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
  select (e ->> 'cd_pedido')::bigint into v_cd from pg_catalog.jsonb_array_elements(p_itens) e
   where not public.rota_065_dia_editavel((e ->> 'dia')::date) order by 1 limit 1;
  if found then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'dia_bloqueado', 'cd_pedido', v_cd);
  end if;
  -- B065-R3: a ORIGEM tambem conta. Pedido ja salvo em linha travada (hoje, fechado, passado desta semana, veiculo
  -- inativo/sem saida) nao e movido pelo ON CONFLICT: recusa tudo, com o mesmo motivo e origem:true.
  select p.cd_pedido into v_cd from pg_catalog.jsonb_array_elements(p_itens) e
    join public.rota_plano_semana p on p.cd_pedido = (e ->> 'cd_pedido')::bigint
   where public.rota_065_travada(p.dia, p.veiculo_id) order by 1 limit 1;
  if found then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'dia_bloqueado', 'cd_pedido', v_cd, 'origem', true);
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
  delete from public.rota_plano_semana p
   where p.dia between p_inicio and p_inicio + 5 and public.rota_065_linha_editavel(p.dia, p.veiculo_id)
     and (p_veiculo is null or p.veiculo_id = p_veiculo);
  insert into public.rota_plano_semana as r (cd_pedido, dia, veiculo_id, ordem, removido)
  select (e ->> 'cd_pedido')::bigint, (e ->> 'dia')::date, e ->> 'veiculo_id', (e ->> 'ordem')::integer, (e ->> 'removido')::boolean
    from pg_catalog.jsonb_array_elements(p_itens) e
  on conflict (cd_pedido) do update set dia = excluded.dia, veiculo_id = excluded.veiculo_id, ordem = excluded.ordem, removido = excluded.removido;
  get diagnostics v_n = row_count;
  perform public.rota_065_subir(p_inicio);   -- sobe mesmo salvando igual/vazio: quem leu antes relê
  return pg_catalog.jsonb_build_object('status', 'ok', 'itens', v_n,
    'versao', (select s.versao from public.rota_065_semana s where s.inicio = p_inicio));
end;
$$;
revoke all on function public.rota_065_salvar_semana(date, bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.rota_065_salvar_semana(date, bigint, jsonb, text) to authenticated;

create or replace function public.rota_065_marcar_sem_saida(p_dia date, p_veiculo text, p_sem_saida boolean, p_versao_base bigint, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inicio date;
  v_versao bigint;
  v_motivo text := nullif(pg_catalog.btrim(p_motivo), '');
  v_devolvidos jsonb := '[]'::jsonb;
begin
  if not coalesce(public.pode_marcar_rota(), false) then
    raise exception 'sem permissao para marcar o veiculo' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(5100, 4601);
  if p_dia is null or extract(isodow from p_dia) not between 1 and 6 or p_veiculo is null or p_sem_saida is null
     or p_versao_base is null or p_versao_base < 0
     or (v_motivo is not null and (pg_catalog.char_length(v_motivo) > 80 or v_motivo ~ '[[:cntrl:]<>]')) then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
  end if;
  if not exists (select 1 from public.rota_veiculos v where v.id = p_veiculo and v.ativo) then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'veiculo_invalido');
  end if;
  if not public.rota_065_dia_editavel(p_dia) then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'dia_bloqueado');
  end if;
  v_inicio := p_dia - (extract(isodow from p_dia)::integer - 1);
  v_versao := coalesce((select s.versao from public.rota_065_semana s where s.inicio = v_inicio), 0);
  if v_versao <> p_versao_base then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'versao_antiga', 'versao', v_versao);
  end if;
  if p_sem_saida then
    insert into public.rota_065_sem_saida as s (dia, veiculo_id, motivo, marcado_por)
    values (p_dia, p_veiculo, v_motivo, auth.uid())
    on conflict (dia, veiculo_id) do update set motivo = excluded.motivo, marcado_em = pg_catalog.now(), marcado_por = excluded.marcado_por;
    -- Pedidos programados neste veiculo/dia voltam para a bandeja (sem dia no plano).
    with apagados as (
      delete from public.rota_plano_semana p where p.dia = p_dia and p.veiculo_id = p_veiculo returning p.cd_pedido, p.removido
    ) select coalesce(pg_catalog.jsonb_agg(a.cd_pedido order by a.cd_pedido) filter (where not a.removido), '[]'::jsonb)
        into v_devolvidos from apagados a;
  else
    delete from public.rota_065_sem_saida s where s.dia = p_dia and s.veiculo_id = p_veiculo;
  end if;
  perform public.rota_065_subir(v_inicio);
  return pg_catalog.jsonb_build_object('status', 'ok', 'devolvidos', v_devolvidos,
    'versao', (select s.versao from public.rota_065_semana s where s.inicio = v_inicio));
end;
$$;
revoke all on function public.rota_065_marcar_sem_saida(date, text, boolean, bigint, text) from public, anon, authenticated;
grant execute on function public.rota_065_marcar_sem_saida(date, text, boolean, bigint, text) to authenticated;

-- ===================== (5) o plano vale no fechamento =====================
-- Recebe a lista do painel/Edge [{cd_pedido, veiculo_id, ordem}] ja validada na forma e devolve a lista final do dia.
create or replace function public.rota_065_aplicar_plano(p_data date, p_itens jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with cal as (
    select (e ->> 'cd_pedido')::bigint cd, e ->> 'veiculo_id' v, (e ->> 'ordem')::integer o, t.pos
      from pg_catalog.jsonb_array_elements(p_itens) with ordinality t(e, pos)
  ), sem as (
    select s.veiculo_id v from public.rota_065_sem_saida s where s.dia = p_data
  ), fora as (   -- programado para outro dia (futuro) ou tirado deste dia
    select p.cd_pedido cd from public.rota_plano_semana p
     where (p.dia = p_data and p.removido) or (p.dia > p_data and not p.removido)
  ), plano as (  -- programado para hoje e que pode sair hoje
    select p.cd_pedido cd, p.veiculo_id v, p.ordem o from public.rota_plano_semana p
     where p.dia = p_data and not p.removido and public.rota_065_sai(p.veiculo_id, p_data)
       and not exists (select 1 from public.rota_pedido_ignorado g where g.cd_pedido = p.cd_pedido)
       and exists (select 1 from public.solidcon_pedidos_erp e where e.cd_pedido = p.cd_pedido and public.rota_055_pendente(e.cd_pedido, p_data))
  ), resto as (
    select c.* from cal c
     where not exists (select 1 from fora f where f.cd = c.cd) and not exists (select 1 from sem s where s.v = c.v)
       and not exists (select 1 from plano p where p.cd = c.cd)
  ), juntos as (
    select p.cd, p.v, p.o, 0 grupo, coalesce(p.o, 0)::bigint k1, p.cd k2 from plano p
    union all
    select r.cd, r.v, r.o, 1, coalesce(r.o, 2147483647)::bigint, r.pos from resto r
  ), final as (
    select j.cd, j.v,
           case when not exists (select 1 from plano p where p.v = j.v) then j.o            -- veiculo sem plano: ordem do painel
                when vv.modo = 'cd_ceasa' then null                                         -- CD/CEASA: 1 parada
                else (pg_catalog.row_number() over (partition by j.v order by j.grupo, j.k1, j.k2))::integer end o,
           j.grupo, j.k1, j.k2
      from juntos j left join public.rota_veiculos vv on vv.id = j.v
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('cd_pedido', f.cd, 'veiculo_id', f.v, 'ordem', f.o)
                  order by f.v, f.grupo, f.k1, f.k2), '[]'::jsonb)
    from final f;
$$;
revoke all on function public.rota_065_aplicar_plano(date, jsonb) from public, anon, authenticated;

-- Corpo da 055 + UMA linha: p_itens := rota_065_aplicar_plano(...) depois das conferencias de forma.
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
  perform pg_catalog.pg_advisory_xact_lock(5100, 4601);        -- 065: le o plano sem gravacao concorrente (5001 ja e nossa)
  p_itens := public.rota_065_aplicar_plano(p_data, p_itens);   -- 065: o plano salvo vale no fechamento
  -- B065-R1: fechamento AUTOMATICO (linha recem-gravada por rota_050_fechar_hoje): corte 061 sobre a lista FINAL.
  -- Ordem renumerada so quando algo saiu (dense_rank mantem paradas com varios pedidos juntas; CD/CEASA segue null).
  if coalesce((select f.automatico from public.rota_dia_fechada f where f.data = p_data), false)
     and exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e
                  where public.rota_065_pos_corte((e ->> 'cd_pedido')::bigint, p_data)) then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('cd_pedido', r.cd, 'veiculo_id', r.v, 'ordem', r.o)
             order by r.pos), '[]'::jsonb)
      into p_itens
      from (select k.cd, k.v, k.pos,
                   case when k.o is null then null
                        else (pg_catalog.dense_rank() over (partition by k.v, k.o is null order by k.o))::integer end o
              from (select (x.e ->> 'cd_pedido')::bigint cd, x.e ->> 'veiculo_id' v, (x.e ->> 'ordem')::integer o, x.pos
                      from pg_catalog.jsonb_array_elements(p_itens) with ordinality x(e, pos)
                     where not public.rota_065_pos_corte((x.e ->> 'cd_pedido')::bigint, p_data)) k) r;
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

-- ===================== (6) inclusao automatica 054 respeita o plano (B065-R2) =====================
-- Corpo da 061 + plano: veiculo = o do plano de HOJE (se houver), senao marcacao/padrao; fora se o plano tira (outro dia,
-- removido, veiculo sem saida) ou o veiculo tem "nao sai nesta data". Corte 061 (auto_aberta) igual.
create or replace function public.rota_054_candidatos(p_data date)
returns table(cd_pedido bigint,documento text,veiculo_id text)
language sql stable security definer set search_path=''
as $$
 select p.cd_pedido,p.documento,vq.v
 from public.solidcon_pedidos_erp p
 left join public.rota_pedido_veiculo m on m.cd_pedido=p.cd_pedido
 left join public.rota_cliente_veiculo c on c.documento=p.documento
 left join public.rota_plano_semana pl on pl.cd_pedido=p.cd_pedido and pl.dia=p_data and not pl.removido
 cross join lateral (select coalesce(pl.veiculo_id,m.veiculo,c.veiculo,public.rota_054_padrao_separando()) v) vq
 where public.rota_061_auto_aberta(p_data)
   and (p.etapa='separando' or (
     (p.dt_sep_inicio at time zone 'America/Sao_Paulo')::date<p_data
     and (p.dt_sep_inicio at time zone 'America/Sao_Paulo')::time>
       coalesce((select pg_catalog.make_time(extract(hour from cfg.hora_saida)::integer,extract(minute from cfg.hora_saida)::integer,0) from public.rota_config cfg where cfg.id=1),time '07:00')))
   and public.rota_055_pendente(p.cd_pedido,p_data)
   and public.rota_054_tem_saida(p_data,vq.v)
   and not public.rota_065_fora_auto(p.cd_pedido,p_data,vq.v)
   and not exists(select 1 from public.rota_pedido_ignorado g where g.cd_pedido=p.cd_pedido)
   and not exists(select 1 from public.rota_dia_item x where x.data=p_data and x.cd_pedido=p.cd_pedido)
   -- RF-3: remover de hoje tira o cliente inteiro, inclusive pedidos que chegam depois.
   and not exists(select 1 from public.rota_dia_item x where x.data=p_data and x.removido_em is not null and x.documento=p.documento)
 order by p.cd_pedido
$$;
revoke all on function public.rota_054_candidatos(date) from public,anon,authenticated,service_role;

-- Corpo da 061 + (a) trava 4601 depois da 5001: candidatos e plano lidos sem gravacao concorrente do plano;
-- (b) proposta do painel/Edge (rota-core ainda sem o filtro 065) que traga pedido FORA da foto e fora dos candidatos
-- que o plano tira (rota_065_fora_auto) e aceita sem ele, com a ordem renumerada 1..N por veiculo. Qualquer outra
-- diferenca continua 40001 (recalcular). (c) B065-R2-A: candidato cujo veiculo vem do plano de HOJE e que a proposta pos
-- noutro veiculo entra no veiculo do plano, no fim da rota dele; o resto da proposta e validado como antes.
create or replace function public.rota_054_incluir(p_data date,p_revisao integer,p_ordem jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_hoje date:=public.rota_050_hoje(); v_rev integer; v_estado text; v_novos jsonb; v_veics text[];
 v_esperados jsonb; v_recebidos jsonb; v_n integer; v_uid uuid:=auth.uid(); v_ordem jsonb; v_plano jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.pode_marcar_rota(),false) then
   raise exception 'sem permissao para incluir separando' using errcode='42501';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(5100,5001);
 perform pg_catalog.pg_advisory_xact_lock(5100,4601);
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
 -- 065 (c) B065-R2-A: o VEICULO DO PLANO DE HOJE manda. Candidato cujo veiculo veio do plano e que a proposta trouxe
 -- noutro veiculo (o rota-core segue a marcacao) sai da proposta; o resto dela e validado como sempre; ele entra no
 -- veiculo do plano, no fim da rota desse veiculo (CD/CEASA: ordem nula, 1 parada).
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('cd_pedido',(n->>'cd_pedido')::bigint,'veiculo_id',n->>'veiculo_id',
          'veiculo_proposta',t.x->>'veiculo_id') order by (n->>'cd_pedido')::bigint),'[]'::jsonb)
   into v_plano
   from pg_catalog.jsonb_array_elements(v_novos) n
   join pg_catalog.jsonb_array_elements(p_ordem) t(x) on (t.x->>'cd_pedido')::bigint=(n->>'cd_pedido')::bigint
  where t.x->>'veiculo_id' is distinct from n->>'veiculo_id'
    and exists(select 1 from public.rota_plano_semana pl where pl.cd_pedido=(n->>'cd_pedido')::bigint and pl.dia=v_hoje
                  and not pl.removido and pl.veiculo_id=n->>'veiculo_id');
 -- 065 (b): sem os pedidos que o plano tirou desta inclusao (nem na foto, nem candidatos) e sem os de (c).
 select pg_catalog.jsonb_agg(t.x order by t.pos) into v_ordem
   from pg_catalog.jsonb_array_elements(p_ordem) with ordinality t(x,pos)
  where not exists(select 1 from pg_catalog.jsonb_array_elements(v_plano) q where (q->>'cd_pedido')::bigint=(t.x->>'cd_pedido')::bigint)
    and (exists(select 1 from public.rota_dia_item i where i.data=v_hoje and i.cd_pedido=(t.x->>'cd_pedido')::bigint and i.removido_em is null)
         or exists(select 1 from pg_catalog.jsonb_array_elements(v_novos) n where (n->>'cd_pedido')::bigint=(t.x->>'cd_pedido')::bigint)
         or not public.rota_065_fora_auto((t.x->>'cd_pedido')::bigint,v_hoje,t.x->>'veiculo_id'));
 v_ordem:=coalesce(v_ordem,'[]'::jsonb);
 if pg_catalog.jsonb_array_length(v_ordem)<pg_catalog.jsonb_array_length(p_ordem) then
   select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('cd_pedido',r.cd,'veiculo_id',r.v,'ordem',r.o) order by r.pos) into v_ordem
     from (select (t.x->>'cd_pedido')::bigint cd,t.x->>'veiculo_id' v,t.pos,
                  (pg_catalog.dense_rank() over (partition by t.x->>'veiculo_id' order by (t.x->>'ordem')::integer))::integer o
             from pg_catalog.jsonb_array_elements(v_ordem) with ordinality t(x,pos)) r;
   v_ordem:=coalesce(v_ordem,'[]'::jsonb);
 end if;
 -- Veiculos que a proposta tem de cobrir: os dos candidatos comuns + o veiculo em que a proposta pos os de (c).
 select pg_catalog.array_agg(distinct v.veic) into v_veics from (
   select x->>'veiculo_id' veic from pg_catalog.jsonb_array_elements(v_novos) x
    where not exists(select 1 from pg_catalog.jsonb_array_elements(v_plano) q where q->>'cd_pedido'=x->>'cd_pedido')
   union all select q->>'veiculo_proposta' from pg_catalog.jsonb_array_elements(v_plano) q) v;
 select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(e.cd,e.veic) order by e.cd) into v_esperados from (
   select i.cd_pedido cd,i.veiculo_id veic from public.rota_dia_item i where i.data=v_hoje and i.veiculo_id=any(v_veics) and i.removido_em is null
   union all select (x->>'cd_pedido')::bigint,x->>'veiculo_id' from pg_catalog.jsonb_array_elements(v_novos) x
    where not exists(select 1 from pg_catalog.jsonb_array_elements(v_plano) q where q->>'cd_pedido'=x->>'cd_pedido')
 ) e;
 select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array((x->>'cd_pedido')::bigint,x->>'veiculo_id') order by (x->>'cd_pedido')::bigint)
   into v_recebidos from pg_catalog.jsonb_array_elements(v_ordem) x;
 if v_esperados is distinct from v_recebidos then
   raise exception 'pedidos/veiculos mudaram: recalcule a proposta' using errcode='40001';
 end if;
 insert into public.rota_dia_item(data,cd_pedido,documento,veiculo_id,ordem,origem,incluido_por)
 select v_hoje,(x->>'cd_pedido')::bigint,x->>'documento',x->>'veiculo_id',null,'separando',v_uid
 from pg_catalog.jsonb_array_elements(v_novos) x;
 update public.rota_dia_item i set ordem=(x->>'ordem')::integer from pg_catalog.jsonb_array_elements(v_ordem) x
 where i.data=v_hoje and i.cd_pedido=(x->>'cd_pedido')::bigint;
 update public.rota_dia_item i set ordem=c.o
   from (select (q->>'cd_pedido')::bigint cd,
                case when vv.modo='cd_ceasa' then null
                     else (coalesce((select max(z.ordem) from public.rota_dia_item z where z.data=v_hoje and z.veiculo_id=q->>'veiculo_id' and z.removido_em is null
                                       and not exists(select 1 from pg_catalog.jsonb_array_elements(v_plano) w where (w->>'cd_pedido')::bigint=z.cd_pedido)),0)
                           + pg_catalog.row_number() over (partition by q->>'veiculo_id' order by (q->>'cd_pedido')::bigint))::integer end o
           from pg_catalog.jsonb_array_elements(v_plano) q left join public.rota_veiculos vv on vv.id=q->>'veiculo_id') c
  where i.data=v_hoje and i.cd_pedido=c.cd;
 select pg_catalog.array_agg(distinct x->>'veiculo_id' order by x->>'veiculo_id') into v_veics from pg_catalog.jsonb_array_elements(v_novos) x;   -- para o log
 update public.rota_dia_fechada set alterada_em=pg_catalog.now(),revisao=revisao+1 where data=v_hoje;
 insert into public.rota_dia_log(data,acao,detalhe,por,por_nome)
 values(v_hoje,'adicionar',pg_catalog.left('Separando automatico: '||v_n||' pedido(s); veiculos '||pg_catalog.array_to_string(v_veics,','),200),v_uid,public.rota_050_nome(v_uid));
 return pg_catalog.jsonb_build_object('incluidos',v_n,'revisao',v_rev+1,'foto',public.rota_050_ler(v_hoje));
end$$;
revoke all on function public.rota_054_incluir(date,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.rota_054_incluir(date,integer,jsonb) to authenticated,service_role;

-- ===================== (7) 047/046 legadas no contrato 065 (B065-R4) =====================
-- Mesmas validacoes/erros da 047. Mudancas: (a) linha travada e item em dia nao editavel = sem efeito (cliente antigo
-- reenvia hoje/passado da semana: nao some nem move); (b) DELETE so do editavel completo deste veiculo; (c) programacao
-- legada e ATIVA: removido=false e ordem 1..N por dia na ordem da lista, inclusive no ON CONFLICT. Devolve como antes
-- quantos pedidos deste veiculo ficaram na semana. A 046 (S10) chama esta.
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
  delete from public.rota_plano_semana p
   where p.veiculo_id = p_veiculo and p.dia between p_inicio and p_inicio + 5
     and public.rota_065_linha_editavel(p.dia, p.veiculo_id);
  insert into public.rota_plano_semana as r (cd_pedido, dia, veiculo_id, ordem, removido)
    select k.cd_pedido, k.dia, p_veiculo, (row_number() over (partition by k.dia order by k.pos))::integer, false
      from (select i.cd_pedido, i.dia, i.pos
              from rows from (jsonb_to_recordset(p_itens) as (cd_pedido bigint, dia date)) with ordinality as i(cd_pedido, dia, pos)
             where public.rota_065_linha_editavel(i.dia, p_veiculo)
               and not exists (select 1 from public.rota_plano_semana o
                                where o.cd_pedido = i.cd_pedido and public.rota_065_travada(o.dia, o.veiculo_id))) k
    on conflict (cd_pedido) do update set dia = excluded.dia, veiculo_id = excluded.veiculo_id, ordem = excluded.ordem, removido = false;
  select count(*) into v_n from public.rota_plano_semana where veiculo_id = p_veiculo and dia between p_inicio and p_inicio + 5;
  return v_n;
end;
$$;
revoke all on function public.rota_047_salvar_semana(date, text, jsonb) from public, anon;
grant execute on function public.rota_047_salvar_semana(date, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
