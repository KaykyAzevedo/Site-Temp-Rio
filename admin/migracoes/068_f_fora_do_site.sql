-- 068 F2: "Tirar do site" manual (pedido que o ERP ainda mostra mas nao vai sair). NAO APLICADA. Idempotente.
-- Requer 013 (texto_seguro), 014 (eh_equipe), 035 (solidcon_pedidos_erp), 044 (pode_marcar_rota), 045 (rota_pedido_ignorado).
-- Rollback: 068_f_rollback.sql. Contrato com o front: docs/plans/2026-11-26-068-contrato.md (secao F).
--
-- Sync (verificado, sem mudanca): solidcon_receber_pedidos_erp (035/039/058) SUBSTITUI a tabela inteira a cada coleta
-- aceita; pedido que some da lista do ERP sai de Pedidos/Rotas/WhatsApp na coleta seguinte e volta sozinho se reaparecer.
--
-- (1) rota_pedido_ignorado ganha alcance: 'rota' (045, como antes: fora da rota/"Falta marcar"/WhatsApp da rota) ou
--     'site' (068: tudo de 'rota' + fora de Pedidos, bandeja e plano no painel; motivo obrigatorio). Quem ja filtra por
--     "existe em rota_pedido_ignorado" (050/054/055/061/065/066, rota-core, whatsapp) trata 'site' como ignorado sem mudanca.
-- (2) 'site' so muda pelas RPCs rota_068_tirar_do_site / rota_068_voltar_ao_site (DEFINER, pode_marcar_rota). DML direto do
--     authenticated (incl. o "Tirar da rota"/"Voltar para a rota" da 045 e rota_044_*) em linha 'site' = 42501.
-- (3) rota_068_site_log: registro permanente de cada tirada/volta/troca de motivo/limpeza (quem, quando, motivo). Leitura
--     eh_equipe(); escrita so pelo gatilho. A limpeza 045/055 (30 dias, pedido fora do ERP) continua apagando a linha,
--     mas o registro fica no log.
-- (4) rota_068_fora_do_site(): lista para o painel (INVOKER; RLS 045/035 valem).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.rota_pedido_ignorado') is null or to_regclass('public.solidcon_pedidos_erp') is null
     or to_regprocedure('public.texto_seguro(text,integer)') is null or to_regprocedure('public.pode_marcar_rota()') is null
     or to_regprocedure('public.eh_equipe()') is null or to_regprocedure('auth.uid()') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                     and table_name = 'rota_pedido_ignorado' and column_name = 'motivo') then
    raise exception '068 F2 requer 013, 014, 035, 044 e 045. Nada foi aplicado.';
  end if;
end;
$$;
select pg_catalog.pg_advisory_xact_lock(5100, 68);

-- ===================== (1) alcance =====================
alter table public.rota_pedido_ignorado add column if not exists alcance text not null default 'rota';
alter table public.rota_pedido_ignorado drop constraint if exists rota_pedido_ignorado_068_alcance;
alter table public.rota_pedido_ignorado add constraint rota_pedido_ignorado_068_alcance
  check (alcance in ('rota', 'site') and (alcance = 'rota' or motivo is not null));
create index if not exists rota_pedido_ignorado_068_site_idx on public.rota_pedido_ignorado (cd_pedido) where alcance = 'site';

-- ===================== (3) registro =====================
create table if not exists public.rota_068_site_log (
  id bigint generated always as identity primary key,
  cd_pedido bigint not null check (cd_pedido between 1 and 999999999999),
  acao text not null check (acao in ('tirou', 'motivo', 'voltou', 'limpeza')),
  motivo text check (motivo is null or char_length(motivo) <= 120),
  por uuid,
  em timestamptz not null default pg_catalog.now()
);
create index if not exists rota_068_site_log_pedido_idx on public.rota_068_site_log (cd_pedido, em);
alter table public.rota_068_site_log enable row level security;
revoke all on public.rota_068_site_log from public, anon, authenticated;
revoke all on sequence public.rota_068_site_log_id_seq from public, anon, authenticated;
grant select on public.rota_068_site_log to authenticated;
drop policy if exists rota_068_equipe_le on public.rota_068_site_log;
create policy rota_068_equipe_le on public.rota_068_site_log for select to authenticated using ((select public.eh_equipe()));

-- ===================== (2) guarda: 'site' so pelas RPCs =====================
-- Mesmo criterio da 065: DML do authenticated (direto ou por funcao INVOKER) passa pela guarda; funcoes DEFINER (as RPCs
-- abaixo) e a limpeza agendada (postgres) rodam como dono e passam direto.
create or replace function public.rota_068_site_guardar()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user is distinct from 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if (tg_op in ('UPDATE', 'DELETE') and old.alcance = 'site') or (tg_op in ('INSERT', 'UPDATE') and new.alcance = 'site') then
    raise exception 'pedido % fora do site: use rota_068_tirar_do_site / rota_068_voltar_ao_site',
      coalesce(case when tg_op = 'DELETE' then old.cd_pedido else new.cd_pedido end, 0) using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.rota_068_site_guardar() from public, anon, authenticated;
drop trigger if exists rota_068_site_guardar on public.rota_pedido_ignorado;
create trigger rota_068_site_guardar before insert or update or delete on public.rota_pedido_ignorado
  for each row execute function public.rota_068_site_guardar();

-- Registro: so transicoes que envolvem 'site'. DEFINER para gravar no log (sem grant de escrita a ninguem).
create or replace function public.rota_068_site_registrar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old boolean := tg_op in ('UPDATE', 'DELETE') and old.alcance = 'site';
  v_new boolean := tg_op in ('INSERT', 'UPDATE') and new.alcance = 'site';
begin
  if v_new and not v_old then
    insert into public.rota_068_site_log (cd_pedido, acao, motivo, por) values (new.cd_pedido, 'tirou', new.motivo, auth.uid());
  elsif v_new and v_old and new.motivo is distinct from old.motivo then
    insert into public.rota_068_site_log (cd_pedido, acao, motivo, por) values (new.cd_pedido, 'motivo', new.motivo, auth.uid());
  elsif v_old and not v_new then
    insert into public.rota_068_site_log (cd_pedido, acao, motivo, por)
      values (old.cd_pedido, case when auth.uid() is null then 'limpeza' else 'voltou' end, old.motivo, auth.uid());
  end if;
  return null;
end;
$$;
revoke all on function public.rota_068_site_registrar() from public, anon, authenticated;
drop trigger if exists rota_068_site_registrar on public.rota_pedido_ignorado;
create trigger rota_068_site_registrar after insert or update or delete on public.rota_pedido_ignorado
  for each row execute function public.rota_068_site_registrar();

-- ===================== RPCs =====================
-- So falta de permissao levanta 42501; o resto devolve {status:'erro', motivo}.
create or replace function public.rota_068_tirar_do_site(p_cd_pedido bigint, p_motivo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_motivo text := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_motivo, ''), '\s+', ' ', 'g')), '');
  v_antes text;
  v_motivo_antes text;
begin
  if not coalesce(public.pode_marcar_rota(), false) then
    raise exception 'sem permissao para tirar pedido do site' using errcode = '42501';
  end if;
  if p_cd_pedido is null or p_cd_pedido not between 1 and 999999999999 then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'pedido_invalido');
  end if;
  if v_motivo is null or pg_catalog.char_length(v_motivo) > 120 or not public.texto_seguro(v_motivo, 120) then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'motivo_invalido');
  end if;
  if not exists (select 1 from public.solidcon_pedidos_erp e where e.cd_pedido = p_cd_pedido) then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'pedido_nao_encontrado');
  end if;
  select g.alcance, g.motivo into v_antes, v_motivo_antes from public.rota_pedido_ignorado g where g.cd_pedido = p_cd_pedido for update;
  insert into public.rota_pedido_ignorado as g (cd_pedido, motivo, alcance) values (p_cd_pedido, v_motivo, 'site')
    on conflict (cd_pedido) do update set motivo = excluded.motivo, alcance = 'site';
  return pg_catalog.jsonb_build_object('status', 'ok', 'cd_pedido', p_cd_pedido, 'alcance', 'site',
    'repetido', v_antes = 'site' and v_motivo_antes is not distinct from v_motivo);
end;
$$;
revoke all on function public.rota_068_tirar_do_site(bigint, text) from public, anon;
grant execute on function public.rota_068_tirar_do_site(bigint, text) to authenticated;

-- Volta ao site E a rota (apaga a linha). Linha so 'rota' (045) ou inexistente: nada muda (alterado=false).
create or replace function public.rota_068_voltar_ao_site(p_cd_pedido bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not coalesce(public.pode_marcar_rota(), false) then
    raise exception 'sem permissao para voltar pedido ao site' using errcode = '42501';
  end if;
  if p_cd_pedido is null or p_cd_pedido not between 1 and 999999999999 then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'pedido_invalido');
  end if;
  delete from public.rota_pedido_ignorado g where g.cd_pedido = p_cd_pedido and g.alcance = 'site';
  get diagnostics v_n = row_count;
  return pg_catalog.jsonb_build_object('status', 'ok', 'cd_pedido', p_cd_pedido, 'alterado', v_n > 0);
end;
$$;
revoke all on function public.rota_068_voltar_ao_site(bigint) from public, anon;
grant execute on function public.rota_068_voltar_ao_site(bigint) to authenticated;

-- ===================== (4) leitura =====================
-- no_erp=false: o pedido ja saiu da lista do ERP (a linha sai na limpeza de 30 dias; o log fica).
create or replace function public.rota_068_fora_do_site()
returns table (cd_pedido bigint, motivo text, atualizado_em timestamptz, atualizado_por uuid, no_erp boolean,
               etapa text, dt_pedido timestamptz, cliente_tipo text, cliente_nome text)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.cd_pedido, g.motivo, g.atualizado_em, g.atualizado_por, e.cd_pedido is not null,
         e.etapa, e.dt_pedido, e.cliente_tipo, e.cliente_nome
    from public.rota_pedido_ignorado g
    left join public.solidcon_pedidos_erp e on e.cd_pedido = g.cd_pedido
   where g.alcance = 'site'
   order by g.atualizado_em desc, g.cd_pedido
$$;
revoke all on function public.rota_068_fora_do_site() from public, anon;
grant execute on function public.rota_068_fora_do_site() to authenticated;

notify pgrst, 'reload schema';
commit;
