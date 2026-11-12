-- 034: Kanban andando pelo ERP (fase 2): vinculo pedido do site <-> venda SOLIDCON e confirmacao automatica.
-- NAO APLICADA (aguarda aprovacao do dono). Instalacao manual no SQL Editor (papel postgres). Idempotente.
-- Nao acessa o ERP, nao altera o coletor; so LE solidcon_vendas_clientes (026).
-- A fase 1 (sem migracao) faz a mesma conta no navegador (js/admin-erp-casamento.js) e so SUGERE;
-- esta migracao grava o vinculo e move aguardando -> confirmado sozinha, registrando em auditoria.
--
-- Regra (identica a js/admin-erp-casamento.js; mudar nos DOIS lugares):
--   1. venda.tipo='cnpj' e venda.documento = digitos de pedido.cnpj;
--   2. venda.dt >= pedido.criado_em - 30 min e venda.dia <= dia_SP(pedido.criado_em) + 7;
--   3. |venda.valor - alvo| <= max(5% do alvo, R$ 10,00), alvo = valor_centavos OU valor_centavos+frete_centavos
--      (vale a menor diferenca; empate prefere 'produtos');
--   4. uma venda (dia,cd_pdv,nr_cupom) casa com no maximo um pedido (indice unico);
--   5. pedidos em ordem (criado_em,id); casado = exatamente 1 venda na tolerancia E essa venda nao esta na
--      tolerancia de nenhum OUTRO pedido aberto ainda sem vinculo. Qualquer duvida = nao grava (o painel
--      mostra "Conferir no ERP").
--   Status: so aguardando -> confirmado. Nunca entregue/cancelado, nunca volta. confirmado so ganha o vinculo.
--   confirmado_em = dt da venda (faturamento no mes certo). Sem WhatsApp automatico (exige clique).
--
-- Objetos:
--   pedidos_erp_vinculo           tabela; SELECT so equipe (RLS eh_equipe()); sem escrita direta.
--   pedidos_casar_erp()           RPC SECURITY DEFINER (search_path=pg_catalog): equipe autenticada, ou
--                                 sessao sem JWT do dono do banco (postgres/supabase_admin: SQL Editor,
--                                 pg_cron). Devolve jsonb. O painel (fase 1) NAO chama esta RPC.
--   pedidos_desvincular_erp(uuid) RPC SECURITY DEFINER: equipe desfaz um vinculo errado (status NAO muda);
--                                 o par pedido/cupom fica bloqueado para o automatico (nao recasa sozinho).
begin;

do $$
begin
  if to_regclass('public.pedidos') is null
     or to_regclass('public.solidcon_vendas_clientes') is null
     or to_regclass('public.auditoria') is null
     or not exists (select 1 from pg_catalog.pg_attribute
                     where attrelid = 'public.pedidos'::regclass and attname = 'frete_centavos' and not attisdropped)
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception '034 requer pedidos (com frete_centavos), 015 (auditoria), 026 e eh_equipe()/auth.uid(). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 34);

-- ===================== TABELAS =====================
-- Sem FK para solidcon_vendas_clientes: o espelho 026 substitui o intervalo a cada sync.
-- venda_presente=false: o cupom sumiu do ERP depois do vinculo (estorno?). O status NAO e revertido.
create table if not exists public.pedidos_erp_vinculo (
  pedido_id uuid primary key references public.pedidos(id) on delete cascade,
  dia date not null,
  cd_pdv integer not null check (cd_pdv >= 0),
  nr_cupom bigint not null check (nr_cupom >= 0),
  dt timestamptz not null check (isfinite(dt)),
  valor_erp_centavos bigint not null check (valor_erp_centavos >= 0),
  alvo text not null check (alvo in ('produtos', 'produtos_frete')),
  diferenca_centavos bigint not null,
  confirmou boolean not null,          -- true = este vinculo moveu aguardando -> confirmado
  venda_presente boolean not null default true,
  casado_em timestamptz not null default now(),
  casado_por text not null check (length(casado_por) between 1 and 254),
  constraint pedidos_erp_vinculo_cupom_uk unique (dia, cd_pdv, nr_cupom)
);

-- Pares recusados pela equipe: o automatico nunca recasa este pedido com este cupom.
create table if not exists public.pedidos_erp_recusa (
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  dia date not null,
  cd_pdv integer not null,
  nr_cupom bigint not null,
  recusado_em timestamptz not null default now(),
  recusado_por text check (length(recusado_por) between 1 and 254),
  primary key (pedido_id, dia, cd_pdv, nr_cupom)
);

alter table public.pedidos_erp_vinculo enable row level security;
alter table public.pedidos_erp_recusa enable row level security;
revoke all on public.pedidos_erp_vinculo, public.pedidos_erp_recusa from public, anon, authenticated;
grant select on public.pedidos_erp_vinculo, public.pedidos_erp_recusa to authenticated;
drop policy if exists pedidos_034_equipe_le on public.pedidos_erp_vinculo;
create policy pedidos_034_equipe_le on public.pedidos_erp_vinculo
  for select to authenticated using (public.eh_equipe());
drop policy if exists pedidos_034_equipe_le on public.pedidos_erp_recusa;
create policy pedidos_034_equipe_le on public.pedidos_erp_recusa
  for select to authenticated using (public.eh_equipe());

-- ===================== GATE COMUM =====================
-- Equipe autenticada, ou sessao sem JWT de postgres/supabase_admin (SQL Editor, pg_cron).
-- Pela API (PostgREST) a sessao e 'authenticator': sem JWT de equipe nao passa. Outros logins diretos: recusados.
create or replace function public.pedidos_034_pode()
returns text
language plpgsql stable
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is not null and coalesce(public.eh_equipe(), false) then
    return coalesce(left(nullif(auth.jwt()->>'email', ''), 254), 'equipe');
  end if;
  -- Lista FECHADA: so as sessoes do dono do banco (SQL Editor e pg_cron). Qualquer outro login direto e recusado.
  if auth.uid() is null and session_user in ('postgres', 'supabase_admin') then
    return 'automatico';
  end if;
  return null;
end;
$$;
revoke all on function public.pedidos_034_pode() from public, anon, authenticated;

-- ===================== CASAR =====================
create or replace function public.pedidos_casar_erp()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_quem text;
  v_p record;
  v_c record;
  v_n integer;
  v_disputado boolean;
  v_casados integer := 0;
  v_confirmados integer := 0;
  v_duvida integer := 0;
  v_sumiram integer;
  v_voltaram integer;
begin
  v_quem := public.pedidos_034_pode();
  if v_quem is null then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(5100, 34);

  -- Revalida vinculos: cupom sumiu do espelho (ou voltou). WHERE obrigatorio (safeupdate).
  update public.pedidos_erp_vinculo v set venda_presente = false
   where v.venda_presente and not exists (
     select 1 from public.solidcon_vendas_clientes s
      where s.dia = v.dia and s.cd_pdv = v.cd_pdv and s.nr_cupom = v.nr_cupom);
  get diagnostics v_sumiram = row_count;
  update public.pedidos_erp_vinculo v set venda_presente = true
   where not v.venda_presente and exists (
     select 1 from public.solidcon_vendas_clientes s
      where s.dia = v.dia and s.cd_pdv = v.cd_pdv and s.nr_cupom = v.nr_cupom);
  get diagnostics v_voltaram = row_count;

  -- Pares (pedido aberto sem vinculo) x (venda livre) dentro da regra 1-3, com a menor diferenca.
  create temporary table if not exists pg_temp.casar_034_par (
    pedido_id uuid, criado_em timestamptz, status text, cnpj text,
    dia date, cd_pdv integer, nr_cupom bigint, dt timestamptz, valor bigint,
    alvo text, diferenca bigint
  ) on commit drop;
  delete from pg_temp.casar_034_par where pedido_id is not null or pedido_id is null;

  insert into pg_temp.casar_034_par
  select p.id, p.criado_em, p.status, s.documento, s.dia, s.cd_pdv, s.nr_cupom, s.dt, s.valor_centavos,
         x.alvo, x.dif
    from public.pedidos p
    join public.solidcon_vendas_clientes s
      on s.tipo = 'cnpj'
     and s.documento = regexp_replace(p.cnpj, '[^0-9]', '', 'g')
     and s.dt >= p.criado_em - interval '30 minutes'
     and s.dia <= (p.criado_em at time zone 'America/Sao_Paulo')::date + 7
    cross join lateral (
      select a.alvo, abs(s.valor_centavos - a.v) as dif
        from (values ('produtos', p.valor_centavos::bigint, 1),
                     ('produtos_frete', p.valor_centavos::bigint + coalesce(p.frete_centavos, 0)::bigint, 2)) a(alvo, v, ord)
       where abs(s.valor_centavos - a.v) <= greatest(round(a.v * 0.05), 1000)
       order by abs(s.valor_centavos - a.v), a.ord
       limit 1
    ) x
   where p.status in ('aguardando', 'confirmado')
     and p.criado_em >= now() - interval '120 days'
     and not exists (select 1 from public.pedidos_erp_vinculo v where v.pedido_id = p.id)
     and not exists (select 1 from public.pedidos_erp_vinculo v
                      where v.dia = s.dia and v.cd_pdv = s.cd_pdv and v.nr_cupom = s.nr_cupom)
     and not exists (select 1 from public.pedidos_erp_recusa r
                      where r.pedido_id = p.id and r.dia = s.dia and r.cd_pdv = s.cd_pdv and r.nr_cupom = s.nr_cupom);

  for v_p in select distinct pedido_id, criado_em, status, cnpj from pg_temp.casar_034_par
              order by criado_em, pedido_id loop
    -- Pares ainda livres deste pedido (vendas casadas nesta rodada saem).
    select count(*) into v_n from pg_temp.casar_034_par c
     where c.pedido_id = v_p.pedido_id
       and not exists (select 1 from public.pedidos_erp_vinculo v
                        where v.dia = c.dia and v.cd_pdv = c.cd_pdv and v.nr_cupom = c.nr_cupom);
    if v_n <> 1 then
      if v_n > 1 then v_duvida := v_duvida + 1; end if;
      continue;
    end if;
    select * into v_c from pg_temp.casar_034_par c
     where c.pedido_id = v_p.pedido_id
       and not exists (select 1 from public.pedidos_erp_vinculo v
                        where v.dia = c.dia and v.cd_pdv = c.cd_pdv and v.nr_cupom = c.nr_cupom);
    -- A venda tambem serve para outro pedido aberto ainda sem vinculo? Duvida: nao grava.
    select exists (
      select 1 from pg_temp.casar_034_par o
       where o.dia = v_c.dia and o.cd_pdv = v_c.cd_pdv and o.nr_cupom = v_c.nr_cupom
         and o.pedido_id <> v_p.pedido_id
         and not exists (select 1 from public.pedidos_erp_vinculo v where v.pedido_id = o.pedido_id)
    ) into v_disputado;
    if v_disputado then
      v_duvida := v_duvida + 1;
      continue;
    end if;

    insert into public.pedidos_erp_vinculo
      (pedido_id, dia, cd_pdv, nr_cupom, dt, valor_erp_centavos, alvo, diferenca_centavos, confirmou, casado_por)
    values (v_p.pedido_id, v_c.dia, v_c.cd_pdv, v_c.nr_cupom, v_c.dt, v_c.valor, v_c.alvo, v_c.diferenca,
            v_p.status = 'aguardando', v_quem);
    v_casados := v_casados + 1;

    if v_p.status = 'aguardando' then
      -- 1o UPDATE: transicao (o gatilho marcar_atualizacao carimba confirmado_em := now()).
      update public.pedidos set status = 'confirmado'
       where id = v_p.pedido_id and status = 'aguardando';
      if found then
        -- 2o UPDATE: confirmado_em = instante da venda no ERP (sem transicao, o gatilho nao sobrescreve).
        update public.pedidos set confirmado_em = v_c.dt where id = v_p.pedido_id and status = 'confirmado';
        insert into public.auditoria (acao, ator, documento_alvo, detalhes)
        values ('pedido_confirmado_erp', 'automatico', v_p.cnpj,
                jsonb_build_object('pedido_id', v_p.pedido_id, 'dia', v_c.dia, 'cd_pdv', v_c.cd_pdv,
                  'nr_cupom', v_c.nr_cupom, 'valor_erp_centavos', v_c.valor, 'alvo', v_c.alvo,
                  'diferenca_centavos', v_c.diferenca, 'executado_por', v_quem));
        v_confirmados := v_confirmados + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('status', 'ok', 'casados', v_casados, 'confirmados', v_confirmados,
    'em_duvida', v_duvida, 'vendas_sumiram', v_sumiram, 'vendas_voltaram', v_voltaram);
end;
$$;
revoke all on function public.pedidos_casar_erp() from public, anon, authenticated;
grant execute on function public.pedidos_casar_erp() to authenticated;

-- ===================== DESVINCULAR =====================
-- Equipe desfaz um vinculo errado. O status do pedido NAO muda (quem confirmou errado reabre pelo fluxo normal).
-- O par fica em pedidos_erp_recusa: o automatico nao recasa o mesmo pedido com o mesmo cupom.
create or replace function public.pedidos_desvincular_erp(p_pedido uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_quem text;
  v_v record;
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  v_quem := left(nullif(auth.jwt()->>'email', ''), 254);
  perform pg_advisory_xact_lock(5100, 34);
  delete from public.pedidos_erp_vinculo where pedido_id = p_pedido returning * into v_v;
  if not found then
    return jsonb_build_object('status', 'ok', 'removido', false);
  end if;
  insert into public.pedidos_erp_recusa (pedido_id, dia, cd_pdv, nr_cupom, recusado_por)
  values (v_v.pedido_id, v_v.dia, v_v.cd_pdv, v_v.nr_cupom, v_quem)
  on conflict do nothing;
  insert into public.auditoria (acao, ator, documento_alvo, detalhes)
  select 'pedido_desvinculado_erp', v_quem, p.cnpj,
         jsonb_build_object('pedido_id', v_v.pedido_id, 'dia', v_v.dia, 'cd_pdv', v_v.cd_pdv, 'nr_cupom', v_v.nr_cupom)
    from public.pedidos p where p.id = v_v.pedido_id;
  return jsonb_build_object('status', 'ok', 'removido', true);
end;
$$;
revoke all on function public.pedidos_desvincular_erp(uuid) from public, anon, authenticated;
grant execute on function public.pedidos_desvincular_erp(uuid) to authenticated;

-- ===================== AGENDAMENTO OPCIONAL =====================
-- Com pg_cron habilitado (Database -> Extensions), roda a cada 30 min (mesmo ritmo do coletor).
-- Sem pg_cron: rodar manualmente no SQL Editor (select public.pedidos_casar_erp();). Chamar pelo painel
-- (sb.rpc('pedidos_casar_erp') ao abrir Pedidos) e uma integracao FUTURA: a fase 1 so faz SELECT.
do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'pedidos_034_casar_erp';
    perform cron.schedule('pedidos_034_casar_erp', '*/30 * * * *', 'select public.pedidos_casar_erp()');
  else
    raise notice '034: pg_cron ausente; rode select public.pedidos_casar_erp(); no SQL Editor (o painel ainda nao chama).';
  end if;
end;
$$;

commit;
