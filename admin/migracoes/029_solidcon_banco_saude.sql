-- 029: batidas do coletor pelo BANCO SQL Server da SOLIDCON (integracao/solidcon/sync-banco.ps1).
-- NAO APLICADA. Instalacao manual no SQL Editor (papel postgres). Idempotente: pode rodar de novo.
-- Nao altera dados existentes; o unico DELETE (retencao de 30 dias, com WHERE) fica dentro da RPC.
-- Etapa 1: so o modulo 'saude' (SELECT 1 no banco). Nenhum dado do ERP e gravado aqui.
-- (A) solidcon_banco_sync: uma linha por batida (modulo, status, duracao, versao do SQL, mensagem curta).
-- (B) RPC solidcon_receber_banco_saude: so a conta de integracao (integracoes_autorizadas), como 019-027.
-- Leitura: somente eh_equipe(); anon nada. Escrita: somente a RPC SECURITY DEFINER.
begin;

do $$
begin
  if to_regclass('public.integracoes_autorizadas') is null
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception '029 requer 019 (integracoes_autorizadas) e o helper eh_equipe() de producao. Nada foi aplicado.';
  end if;
end;
$$;

-- Lock proprio do coletor pelo banco (5100,29).
select pg_catalog.pg_advisory_xact_lock(5100,29);

create table if not exists public.solidcon_banco_sync (
  id bigint generated always as identity primary key,
  modulo text not null check (modulo ~ '^[a-z][a-z0-9_]{0,39}$'),
  status text not null check (status in ('ok','erro')),
  duracao_ms integer not null check (duracao_ms between 0 and 600000),
  versao_servidor text check (versao_servidor is null or versao_servidor ~ '^[0-9]{1,4}(\.[0-9]{1,6}){1,3}$'),
  mensagem text check (mensagem is null or char_length(mensagem) <= 200),
  execucao_id uuid not null,
  em timestamptz not null default now()
);
create unique index if not exists solidcon_banco_sync_execucao_idx
  on public.solidcon_banco_sync(execucao_id, modulo);
create index if not exists solidcon_banco_sync_modulo_em_idx
  on public.solidcon_banco_sync(modulo, em desc);
create index if not exists solidcon_banco_sync_em_idx
  on public.solidcon_banco_sync(em);

alter table public.solidcon_banco_sync enable row level security;
revoke all on public.solidcon_banco_sync from public, anon, authenticated;
revoke all on sequence public.solidcon_banco_sync_id_seq from public, anon, authenticated;
grant select on public.solidcon_banco_sync to authenticated;
drop policy if exists solidcon_029_equipe_le on public.solidcon_banco_sync;
create policy solidcon_029_equipe_le on public.solidcon_banco_sync
  for select to authenticated using (public.eh_equipe());

create or replace function public.solidcon_receber_banco_saude(
  p_status text, p_duracao_ms integer, p_versao text, p_mensagem text, p_execucao_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_id bigint;
  v_apagadas bigint;
begin
  if auth.uid() is null or not exists (
    select 1 from public.integracoes_autorizadas where user_id = auth.uid()
  ) then
    raise exception 'integracao nao autorizada' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('ok','erro') then
    raise exception 'status invalido' using errcode = '22023';
  end if;
  if p_duracao_ms is null or p_duracao_ms < 0 or p_duracao_ms > 600000 then
    raise exception 'duracao invalida' using errcode = '22023';
  end if;
  if p_versao is not null and p_versao !~ '^[0-9]{1,4}(\.[0-9]{1,6}){1,3}$' then
    raise exception 'versao invalida' using errcode = '22023';
  end if;
  if p_mensagem is not null and char_length(p_mensagem) > 200 then
    raise exception 'mensagem longa' using errcode = '22023';
  end if;
  if p_status = 'ok' and p_mensagem is not null then
    raise exception 'batida ok nao leva mensagem' using errcode = '22023';
  end if;
  if p_execucao_id is null then
    raise exception 'execucao_id obrigatorio' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(5100,29);

  -- Reenvio da mesma execucao (falha de transporte) nao duplica a batida.
  insert into public.solidcon_banco_sync(modulo, status, duracao_ms, versao_servidor, mensagem, execucao_id)
  values ('saude', p_status, p_duracao_ms, p_versao, nullif(btrim(p_mensagem), ''), p_execucao_id)
  on conflict (execucao_id, modulo) do nothing
  returning id into v_id;

  -- Retencao: 30 dias (288 batidas/dia por modulo). DELETE sempre com WHERE (safeupdate).
  delete from public.solidcon_banco_sync where em < now() - interval '30 days';
  get diagnostics v_apagadas = row_count;

  return jsonb_build_object('ok', true, 'id', v_id, 'duplicada', v_id is null, 'apagadas', v_apagadas);
end;
$$;
revoke all on function public.solidcon_receber_banco_saude(text, integer, text, text, uuid) from public, anon, authenticated;
grant execute on function public.solidcon_receber_banco_saude(text, integer, text, text, uuid) to authenticated;

commit;
