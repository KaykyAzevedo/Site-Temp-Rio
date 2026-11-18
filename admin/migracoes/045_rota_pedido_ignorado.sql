-- 045: Rotas v3 — "Tirar da rota" por pedido, valendo ATE REATIVAR.
-- NAO APLICADA. Idempotente. Requer 013 (texto_seguro), 014 (eh_equipe), 035 (solidcon_pedidos_erp) e 044
-- (pode_marcar_rota). pg_cron e opcional (so a limpeza diaria).
--
-- Regra do dono/Marcio (2026-11-18, uso real): ha pedidos 'aberto' antigos no ERP (desde 26/10) que nao vao sair
-- e o ERP e so leitura. O painel guarda, do lado dele, quais pedidos foram "tirados da rota": o pedido ignorado NAO
-- entra na rota, nem em "Falta marcar", nem na mensagem do WhatsApp; aparece numa lista "Fora da rota" com
-- "Voltar para a rota" (apaga a linha). Pedido que nao foi tirado continua aparecendo, mesmo antigo.
--
-- rota_pedido_ignorado: cd_pedido (PK), motivo opcional curto (<= 120, texto_seguro, vazio = NULL), atualizado_em/por
-- (carimbados pelo gatilho). Sem FK para solidcon_pedidos_erp pelo mesmo motivo da 044: a coleta (035/039) apaga e
-- reinsere todos os pedidos a cada execucao. Limpeza diaria rota_045_limpar(): pedido que saiu/sumiu do ERP (nao esta
-- mais pendente) e tirado ha mais de 30 dias.
-- RLS: leitura eh_equipe(); escrita pode_marcar_rota(); anon nada. Politicas por comando com (select ...). Sem FOR ALL.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('public.eh_equipe()') is null or to_regprocedure('public.pode_marcar_rota()') is null
     or to_regprocedure('auth.uid()') is null
     or to_regprocedure('public.texto_seguro(text,integer)') is null
     or to_regclass('public.solidcon_pedidos_erp') is null then
    raise exception '045 requer 013 (texto_seguro), 014 (eh_equipe), 035 (solidcon_pedidos_erp) e 044 (pode_marcar_rota). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 45);

create table if not exists public.rota_pedido_ignorado (
  cd_pedido bigint primary key check (cd_pedido between 1 and 999999999999),
  motivo text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
alter table public.rota_pedido_ignorado drop constraint if exists rota_pedido_ignorado_045_motivo;
alter table public.rota_pedido_ignorado add constraint rota_pedido_ignorado_045_motivo
  check (motivo is null or (char_length(motivo) between 1 and 120 and public.texto_seguro(motivo, 120)));

-- Normaliza o motivo (espacos colapsados, sem pontas; vazio = NULL) e carimba quem/quando.
create or replace function public.rota_045_ignorado_normalizar()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.motivo := nullif(btrim(regexp_replace(coalesce(new.motivo, ''), '\s+', ' ', 'g')), '');
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;
revoke all on function public.rota_045_ignorado_normalizar() from public, anon, authenticated;

drop trigger if exists rota_045_ignorado_normalizar on public.rota_pedido_ignorado;
create trigger rota_045_ignorado_normalizar before insert or update on public.rota_pedido_ignorado
  for each row execute function public.rota_045_ignorado_normalizar();

alter table public.rota_pedido_ignorado enable row level security;
revoke all on public.rota_pedido_ignorado from public, anon, authenticated;
grant select, insert, update, delete on public.rota_pedido_ignorado to authenticated;

drop policy if exists rota_045_equipe_le on public.rota_pedido_ignorado;
create policy rota_045_equipe_le on public.rota_pedido_ignorado for select to authenticated
  using ((select public.eh_equipe()));
drop policy if exists rota_045_marca_insere on public.rota_pedido_ignorado;
create policy rota_045_marca_insere on public.rota_pedido_ignorado for insert to authenticated
  with check ((select public.pode_marcar_rota()));
drop policy if exists rota_045_marca_atualiza on public.rota_pedido_ignorado;
create policy rota_045_marca_atualiza on public.rota_pedido_ignorado for update to authenticated
  using ((select public.pode_marcar_rota())) with check ((select public.pode_marcar_rota()));
drop policy if exists rota_045_marca_apaga on public.rota_pedido_ignorado;
create policy rota_045_marca_apaga on public.rota_pedido_ignorado for delete to authenticated
  using ((select public.pode_marcar_rota()));

-- ===================== limpeza =====================
-- Tirado ha mais de 30 dias e o pedido ja nao esta pendente no ERP (saiu, atendido ou sumiu).
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
revoke all on function public.rota_045_limpar() from public, anon, authenticated;
grant execute on function public.rota_045_limpar() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $j$select cron.unschedule(jobid) from cron.job where jobname = 'rota-limpeza-ignorados'$j$;
    execute $j$select cron.schedule('rota-limpeza-ignorados', '27 6 * * *', 'select public.rota_045_limpar()')$j$;
  else
    raise notice '045: pg_cron nao instalado: limpeza diaria de rota_pedido_ignorado NAO agendada (rode select public.rota_045_limpar() de vez em quando).';
  end if;
end;
$$;

commit;
