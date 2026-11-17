-- 042: rotinas de WhatsApp (relatório de contas a receber, rota dos entregadores, alertas) — fila/log + agendamento.
-- APLICADA em 2026-11-17 (pg_net ativado; 4 rotinas desligadas em simulacao; cron whatsapp-rotinas */15 e whatsapp-limpeza criados; anon sem grant). Idempotente.
-- Requer eh_admin() (014), 033 e 041 (solidcon_rota_posicoes: posicao dos clientes da rota). Le 030/035/039/040 se existirem.
-- NADA de segredo ou telefone neste arquivo (repositorio publico):
--   * telefones: tabela whatsapp_destinatarios, preenchida pelo painel (aba WhatsApp);
--   * token da Meta e phone_number_id: secrets da Edge Function (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID);
--   * URL do projeto e o token do cron: Vault (project_url, whatsapp_cron_token) — ver integracao/whatsapp/LEIAME.md.
-- (1) whatsapp_destinatarios: nome, telefone E.164, papel, ativo, consentimento_em (LGPD: so recebe com consentimento).
-- (2) whatsapp_rotinas: codigo, ativo, horario (Sao Paulo), dias, destinatarios, modo 'simulacao' | 'real', template.
--     Tudo nasce DESLIGADO e em SIMULACAO.
-- (3) whatsapp_envios: log/fila, 1 linha por parte da mensagem (status simulado|enviado|erro|pulado; corpo tem valores
--     comerciais). Retencao 90 dias.
-- (4) whatsapp_execucoes: trava "1 vez por rotina por dia" (rotina, dia) — o cron roda a cada 15 min.
-- RLS: SO eh_admin() le/escreve (envios/execucoes: admin so le; quem grava e a Edge Function com a chave de servico).
-- anon: nada. Politicas por comando, (select eh_admin()), sem FOR ALL.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('public.eh_admin()') is null or to_regprocedure('auth.uid()') is null
     or to_regclass('public.solidcon_clientes_geo') is null
     or to_regprocedure('public.solidcon_rota_posicoes(text[])') is null then
    raise exception '042 requer eh_admin() (014), 033 e 041 (solidcon_rota_posicoes). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 42);

-- ===================== (1) destinatarios =====================
create table if not exists public.whatsapp_destinatarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  telefone text not null unique check (telefone ~ '^\+[1-9][0-9]{7,14}$'),   -- E.164 (ex.: +5521999990000)
  papel text not null default 'outro' check (papel in ('gestor', 'entregador', 'outro')),
  ativo boolean not null default true,
  consentimento_em timestamptz,     -- LGPD: sem consentimento registrado, a rotina NAO envia (status 'pulado')
  consentimento_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);

-- ===================== (2) rotinas =====================
create table if not exists public.whatsapp_rotinas (
  codigo text primary key check (codigo ~ '^[a-z][a-z0-9_]{2,39}$'),
  descricao text check (descricao is null or char_length(descricao) <= 200),
  ativo boolean not null default false,
  horario time not null default '06:00',                                   -- hora de Sao Paulo
  dias text[] not null default '{seg,ter,qua,qui,sex,sab}'
    check (dias <@ array['dom','seg','ter','qua','qui','sex','sab']::text[] and cardinality(dias) between 1 and 7),
  destinatarios uuid[] not null default '{}' check (cardinality(destinatarios) <= 20),
  modo text not null default 'simulacao' check (modo in ('simulacao', 'real')),
  template text check (template is null or template ~ '^[a-z0-9_]{1,250}$'),  -- nome do template aprovado na Meta
  idioma text not null default 'pt_BR' check (idioma ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);

insert into public.whatsapp_rotinas (codigo, descricao, horario, dias, template) values
  ('receber_diario', 'Contas a receber: vencido, vence hoje, proximos 7 dias e maiores vencidos', '06:00', '{seg,ter,qua,qui,sex,sab}', 'relatorio_diario'),
  ('rota_s10',       'Rota do dia da S10 (paradas em ordem + mapa)',                              '06:00', '{seg,ter,qua,qui,sex,sab}', 'rota_do_dia'),
  ('rota_caminhao',  'Rota do dia do caminhao do CEASA (paradas em ordem + mapa)',                '06:00', '{seg,ter,qua,qui,sex,sab}', 'rota_do_dia'),
  ('alertas_marcio', 'Alertas: pedidos parados, pedidos do site aguardando, coleta do ERP parada, estoque critico', '07:00', '{seg,ter,qua,qui,sex,sab}', 'alertas_operacao')
on conflict (codigo) do nothing;

-- ===================== (3) envios (log) e (4) execucoes (trava diaria) =====================
create table if not exists public.whatsapp_envios (
  id bigint generated always as identity primary key,
  rotina text not null check (char_length(rotina) <= 40),
  destinatario_id uuid references public.whatsapp_destinatarios(id) on delete set null,
  origem text not null default 'agendado' check (origem in ('agendado', 'previa')),
  status text not null check (status in ('simulado', 'enviado', 'erro', 'pulado')),
  erro text check (erro is null or char_length(erro) <= 300),
  -- 1 linha POR PARTE da mensagem (parte N de M; null = linha sem mensagem: pulado/erro de montagem). Uma parte tem no
  -- maximo 1024 caracteres (limite do template); o teto de 6000 e so protecao e, se agir, o texto termina com
  -- '[historico resumido]' (Edge Function).
  parte smallint,
  partes smallint,
  corpo text check (corpo is null or char_length(corpo) <= 6000),   -- tem valores comerciais: so admin le
  meta_id text check (meta_id is null or char_length(meta_id) <= 200),
  criado_em timestamptz not null default now()
);
-- Idempotente tambem para quem ja tinha a tabela sem as colunas de parte.
alter table public.whatsapp_envios add column if not exists parte smallint;
alter table public.whatsapp_envios add column if not exists partes smallint;
-- Sempre recria (idempotente e corrige versao anterior). Sem "is not null" o CHECK com NULL passaria.
alter table public.whatsapp_envios drop constraint if exists whatsapp_envios_042_parte;
alter table public.whatsapp_envios add constraint whatsapp_envios_042_parte check (
  (parte is null and partes is null)
  or (parte is not null and partes is not null and partes between 1 and 100 and parte between 1 and partes));
-- 100 = WA.PARTES_MAX (whatsapp-core.js): a rota e limitada ANTES do envio (99 mensagens + 1 aviso), entao nada passa disso.
create index if not exists whatsapp_envios_criado_em_idx on public.whatsapp_envios (criado_em desc);

create table if not exists public.whatsapp_execucoes (
  rotina text not null,
  dia date not null,          -- dia de Sao Paulo
  criado_em timestamptz not null default now(),
  primary key (rotina, dia)
);

-- ===================== carimbos (gatilhos; ninguem precisa de EXECUTE) =====================
create or replace function public.whatsapp_042_carimbar()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  if tg_table_name = 'whatsapp_destinatarios' then
    -- Consentimento: registra quem marcou; desmarcar limpa os dois.
    if new.consentimento_em is not null and (tg_op = 'INSERT' or old.consentimento_em is null) then
      new.consentimento_em := now(); new.consentimento_por := auth.uid();
    elsif new.consentimento_em is null then
      new.consentimento_por := null;
    end if;
    new.nome := btrim(new.nome);
  end if;
  return new;
end;
$$;
revoke all on function public.whatsapp_042_carimbar() from public, anon, authenticated;

drop trigger if exists whatsapp_042_carimbar on public.whatsapp_destinatarios;
create trigger whatsapp_042_carimbar before insert or update on public.whatsapp_destinatarios
  for each row execute function public.whatsapp_042_carimbar();
drop trigger if exists whatsapp_042_carimbar on public.whatsapp_rotinas;
create trigger whatsapp_042_carimbar before insert or update on public.whatsapp_rotinas
  for each row execute function public.whatsapp_042_carimbar();

-- Papel x rotina (mesma regra de whatsapp-core.js PAPEIS): relatorio financeiro e alertas SO para 'gestor';
-- rotas para 'entregador' ou 'gestor'. Validado ao salvar a rotina (aqui) e de novo no envio (Edge Function).
create or replace function public.whatsapp_042_rotina_validar()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare v_permitidos text[];
begin
  v_permitidos := case
    when new.codigo in ('receber_diario', 'alertas_marcio') then array['gestor']
    when new.codigo in ('rota_s10', 'rota_caminhao') then array['entregador', 'gestor']
    else null end;
  if v_permitidos is not null and exists (
       select 1 from unnest(new.destinatarios) u(id)
         join public.whatsapp_destinatarios d on d.id = u.id
        where d.papel <> all (v_permitidos)) then
    raise exception 'rotina %: so recebe quem tem papel %', new.codigo, array_to_string(v_permitidos, ' ou ')
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.whatsapp_042_rotina_validar() from public, anon, authenticated;
drop trigger if exists whatsapp_042_rotina_validar on public.whatsapp_rotinas;
create trigger whatsapp_042_rotina_validar before insert or update of destinatarios on public.whatsapp_rotinas
  for each row execute function public.whatsapp_042_rotina_validar();

-- ===================== RLS e grants =====================
alter table public.whatsapp_destinatarios enable row level security;
alter table public.whatsapp_rotinas enable row level security;
alter table public.whatsapp_envios enable row level security;
alter table public.whatsapp_execucoes enable row level security;
revoke all on public.whatsapp_destinatarios, public.whatsapp_rotinas, public.whatsapp_envios, public.whatsapp_execucoes
  from public, anon, authenticated;
revoke all on sequence public.whatsapp_envios_id_seq from public, anon, authenticated;
grant select, insert, update, delete on public.whatsapp_destinatarios to authenticated;
grant select, update on public.whatsapp_rotinas to authenticated;
grant select on public.whatsapp_envios, public.whatsapp_execucoes to authenticated;
-- A Edge Function usa a chave de servico (service_role, ignora RLS); grants explicitos para nao depender de default privileges.
grant select, insert, update, delete on public.whatsapp_destinatarios, public.whatsapp_rotinas, public.whatsapp_envios,
  public.whatsapp_execucoes to service_role;
grant usage, select on sequence public.whatsapp_envios_id_seq to service_role;

drop policy if exists whatsapp_042_admin_le on public.whatsapp_destinatarios;
create policy whatsapp_042_admin_le on public.whatsapp_destinatarios for select to authenticated using ((select public.eh_admin()));
drop policy if exists whatsapp_042_admin_insere on public.whatsapp_destinatarios;
create policy whatsapp_042_admin_insere on public.whatsapp_destinatarios for insert to authenticated with check ((select public.eh_admin()));
drop policy if exists whatsapp_042_admin_atualiza on public.whatsapp_destinatarios;
create policy whatsapp_042_admin_atualiza on public.whatsapp_destinatarios for update to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));
drop policy if exists whatsapp_042_admin_apaga on public.whatsapp_destinatarios;
create policy whatsapp_042_admin_apaga on public.whatsapp_destinatarios for delete to authenticated using ((select public.eh_admin()));

drop policy if exists whatsapp_042_admin_le on public.whatsapp_rotinas;
create policy whatsapp_042_admin_le on public.whatsapp_rotinas for select to authenticated using ((select public.eh_admin()));
drop policy if exists whatsapp_042_admin_atualiza on public.whatsapp_rotinas;
create policy whatsapp_042_admin_atualiza on public.whatsapp_rotinas for update to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));

drop policy if exists whatsapp_042_admin_le on public.whatsapp_envios;
create policy whatsapp_042_admin_le on public.whatsapp_envios for select to authenticated using ((select public.eh_admin()));
drop policy if exists whatsapp_042_admin_le on public.whatsapp_execucoes;
create policy whatsapp_042_admin_le on public.whatsapp_execucoes for select to authenticated using ((select public.eh_admin()));

-- ===================== funcoes da Edge Function (SO service_role) =====================
-- Trava diaria: true = esta chamada reservou (rotina, dia) e pode enviar; false = ja rodou hoje.
create or replace function public.whatsapp_042_reservar(p_rotina text, p_dia date)
returns boolean
language sql
security invoker
set search_path = pg_catalog
as $$
  with ins as (
    insert into public.whatsapp_execucoes (rotina, dia) values (p_rotina, p_dia)
    on conflict (rotina, dia) do nothing
    returning 1
  )
  select exists (select 1 from ins);
$$;
revoke all on function public.whatsapp_042_reservar(text, date) from public, anon, authenticated;
grant execute on function public.whatsapp_042_reservar(text, date) to service_role;

-- Posicao dos clientes da rota: public.solidcon_rota_posicoes (041), a MESMA fonte da aba Rotas (sem filtro de fornecedor).

-- Retencao: log de envios e travas com mais de 90 dias.
create or replace function public.whatsapp_042_limpar()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare v_n integer; v_m integer;
begin
  delete from public.whatsapp_envios where criado_em < now() - interval '90 days';
  get diagnostics v_n = row_count;
  delete from public.whatsapp_execucoes where dia < (now() at time zone 'America/Sao_Paulo')::date - 90;
  get diagnostics v_m = row_count;
  return v_n + v_m;
end;
$$;
revoke all on function public.whatsapp_042_limpar() from public, anon, authenticated;
grant execute on function public.whatsapp_042_limpar() to service_role;

-- ===================== agendamento (pg_cron + pg_net + Vault) =====================
-- A cada 15 min o banco chama a Edge Function, que decide o que esta no horario (Sao Paulo) e usa a trava diaria.
-- Autenticacao: header x-cron-token = segredo whatsapp_cron_token do Vault, IGUAL ao secret CRON_TOKEN da funcao.
-- (Nao usamos a chave de servico no header: o pg_net deixa o header legivel na fila net.http_request_queue enquanto
-- a requisicao espera; um token proprio so permite disparar esta funcao.) Sem pg_cron/pg_net: so um aviso.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    execute $j$select cron.unschedule(jobid) from cron.job where jobname in ('whatsapp-rotinas', 'whatsapp-limpeza')$j$;
    execute $j$select cron.schedule('whatsapp-rotinas', '*/15 * * * *', $c$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/whatsapp-rotinas',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_cron_token')),
        body := jsonb_build_object('acao', 'agendado'),
        timeout_milliseconds := 60000
      );
    $c$)$j$;
    execute $j$select cron.schedule('whatsapp-limpeza', '17 6 * * *', 'select public.whatsapp_042_limpar()')$j$;
  else
    raise notice '042: pg_cron/pg_net nao instalados: agendamento NAO criado. Ative as extensoes e rode a 042 de novo (ver integracao/whatsapp/LEIAME.md).';
  end if;
end;
$$;

commit;
