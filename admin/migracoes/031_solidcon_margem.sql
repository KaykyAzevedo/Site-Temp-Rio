-- 031: margem real por produto da filial 4 (coletor pelo banco SQL, modulo 'margem').
-- NAO APLICADA. Instalacao manual no SQL Editor (papel postgres). Idempotente: pode rodar de novo.
-- Requer 019 (integracoes_autorizadas) e eh_equipe().
-- Origem (somente filial 4, filtro dentro das consultas aprovadas do sync-banco.ps1):
--   dbo.VW_RDUPHOLD_VENDA_ITENS  -> agregado por dia + Codigo_Produto (quantidade, venda, custo).
--   dbo.VW_MGN_ESTOQUE (EstoqueTipo='Produto') -> custo medio, custo de reposicao, preco, ultimo recebimento.
-- Nenhum dado de cliente: so produto, dia e valores.
-- (A) solidcon_margem_diaria: janela [desde, ate) substituida por inteiro a cada coleta aceita
--     (3 ultimos dias no ciclo normal; blocos de ate 62 dias no backfill desde 2026-05-29).
--     Valores com sinal: devolucao pode deixar quantidade/venda/custo do dia negativos.
-- (B) solidcon_custos: espelho substituido por inteiro (1x/hora).
-- (C) solidcon_margem_sync: log das duas RPCs (so contagens). Retencao 90 dias.
-- (D) solidcon_margem_cobertura: um dia por linha para cada dia de janela ACEITA (inclusive dias
--     sem venda). O painel so trata um periodo como completo se todos os dias estiverem aqui;
--     sem depender do log (que expira em 90 dias).
-- Leitura: somente eh_equipe(); anon nada. Escrita: somente as RPCs SECURITY DEFINER.
-- Codigo_Produto/CodigoProduto = codigo do produto no ERP; a correspondencia com
-- solidcon_produtos.id_produto NAO foi confirmada: nenhuma FK, o painel faz a juncao.
begin;

do $$
begin
  if to_regclass('public.integracoes_autorizadas') is null
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception '031 requer 019 (integracoes_autorizadas) e eh_equipe(). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100,31);

create table if not exists public.solidcon_margem_diaria (
  dia date not null,
  codigo_produto integer not null check (codigo_produto > 0),
  quantidade numeric(18,3) not null,
  venda_centavos bigint not null,
  custo_centavos bigint not null,
  linhas integer not null check (linhas > 0),
  coletado_em timestamptz not null,
  primary key (dia, codigo_produto)
);
create index if not exists solidcon_margem_diaria_produto_idx on public.solidcon_margem_diaria(codigo_produto, dia);

create table if not exists public.solidcon_custos (
  codigo_produto integer not null check (codigo_produto > 0),
  unidade text not null check (char_length(unidade) between 1 and 20),
  custo_medio_centavos bigint check (custo_medio_centavos is null or custo_medio_centavos >= 0),
  custo_reposicao_centavos bigint check (custo_reposicao_centavos is null or custo_reposicao_centavos >= 0),
  preco_venda_centavos bigint check (preco_venda_centavos is null or preco_venda_centavos >= 0),
  ultimo_recebimento date,
  coletado_em timestamptz not null,
  primary key (codigo_produto, unidade)
);

create table if not exists public.solidcon_margem_cobertura (
  dia date primary key,
  coletado_em timestamptz not null
);

create table if not exists public.solidcon_margem_sync (
  id bigint generated always as identity primary key,
  parte text not null check (parte in ('vendas','custos')),
  status text not null check (status in ('ok','erro')),
  linhas integer not null default 0,
  desde date,
  ate date,
  coletado_em timestamptz,
  execucao_id uuid,
  mensagem text check (mensagem is null or char_length(mensagem) <= 200),
  em timestamptz not null default now()
);
-- Uma execucao do backfill manda varios blocos: unico por execucao + parte + janela.
create unique index if not exists solidcon_margem_sync_execucao_idx
  on public.solidcon_margem_sync(execucao_id, parte, coalesce(desde, '-infinity'::date))
  where status = 'ok' and execucao_id is not null;
create index if not exists solidcon_margem_sync_em_idx on public.solidcon_margem_sync(em);

alter table public.solidcon_margem_diaria enable row level security;
alter table public.solidcon_custos enable row level security;
alter table public.solidcon_margem_sync enable row level security;
alter table public.solidcon_margem_cobertura enable row level security;
revoke all on public.solidcon_margem_diaria, public.solidcon_custos, public.solidcon_margem_sync, public.solidcon_margem_cobertura from public, anon, authenticated;
revoke all on sequence public.solidcon_margem_sync_id_seq from public, anon, authenticated;
grant select on public.solidcon_margem_diaria, public.solidcon_custos, public.solidcon_margem_sync, public.solidcon_margem_cobertura to authenticated;
drop policy if exists solidcon_031_equipe_le on public.solidcon_margem_cobertura;
create policy solidcon_031_equipe_le on public.solidcon_margem_cobertura for select to authenticated using (public.eh_equipe());
drop policy if exists solidcon_031_equipe_le on public.solidcon_margem_diaria;
create policy solidcon_031_equipe_le on public.solidcon_margem_diaria for select to authenticated using (public.eh_equipe());
drop policy if exists solidcon_031_equipe_le on public.solidcon_custos;
create policy solidcon_031_equipe_le on public.solidcon_custos for select to authenticated using (public.eh_equipe());
drop policy if exists solidcon_031_equipe_le on public.solidcon_margem_sync;
create policy solidcon_031_equipe_le on public.solidcon_margem_sync for select to authenticated using (public.eh_equipe());

-- (A) vendas por dia + produto -------------------------------------------------------------
create or replace function public.solidcon_receber_margem_vendas(
  p_desde date, p_ate date, p_itens jsonb, p_coletado_em timestamptz, p_execucao_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_agora timestamptz;
  v_hoje date;
  v_motivo text;
  v_item jsonb;
  v_linhas integer := 0;
  v_anteriores bigint;
  v_ultima timestamptz;
  v_log bigint;
  v_dia date;
  v_campos constant text[] := array['dia','codigo_produto','quantidade','venda','custo','linhas'];
begin
  if auth.uid() is null or not exists (
    select 1 from public.integracoes_autorizadas where user_id = auth.uid()
  ) then
    raise exception 'integracao nao autorizada' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(5100,31);
  v_agora := clock_timestamp();
  v_hoje := (v_agora at time zone 'America/Sao_Paulo')::date;
  begin
    if p_execucao_id is null then
      v_motivo := 'execucao_invalida';
    elsif p_coletado_em is null or not isfinite(p_coletado_em)
       or p_coletado_em < v_agora - interval '24 hours'
       or p_coletado_em > v_agora + interval '5 minutes' then
      v_motivo := 'coleta_fora_da_janela';
    elsif p_desde is null or p_ate is null or p_desde >= p_ate
       or p_ate - p_desde > 62 or p_desde < date '2026-05-29' or p_ate > v_hoje + 1 then
      v_motivo := 'janela_invalida';
    elsif p_itens is null or jsonb_typeof(p_itens) <> 'array' then
      v_motivo := 'payload_invalido';
    else
      v_linhas := jsonb_array_length(p_itens);
      if v_linhas > 50000 or octet_length(p_itens::text) > 8388608 then
        v_motivo := 'payload_fora_do_limite';
      else
        for v_item in select value from jsonb_array_elements(p_itens) loop
          if jsonb_typeof(v_item) <> 'object' then v_motivo := 'item_invalido'; exit; end if;
          if not (v_item ?& v_campos) or (v_item - v_campos) <> '{}'::jsonb then
            v_motivo := 'campos_invalidos'; exit;
          end if;
          if jsonb_typeof(v_item->'dia') <> 'string' or (v_item->>'dia') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then
            v_motivo := 'dia_invalido'; exit;
          end if;
          begin
            v_dia := (v_item->>'dia')::date;
          exception when others then
            v_motivo := 'dia_invalido'; exit;
          end;
          if v_dia < p_desde or v_dia >= p_ate then v_motivo := 'dia_fora_da_janela'; exit; end if;
          if jsonb_typeof(v_item->'codigo_produto') <> 'number'
             or (v_item->>'codigo_produto') !~ '^[1-9][0-9]{0,9}$'
             or (v_item->>'codigo_produto')::bigint > 2147483647 then
            v_motivo := 'produto_invalido'; exit;
          end if;
          if jsonb_typeof(v_item->'quantidade') <> 'number'
             or (v_item->>'quantidade') !~ '^-?[0-9]{1,15}(\.[0-9]{1,3})?$' then
            v_motivo := 'quantidade_invalida'; exit;
          end if;
          if jsonb_typeof(v_item->'venda') <> 'number' or (v_item->>'venda') !~ '^-?[0-9]{1,15}$'
             or jsonb_typeof(v_item->'custo') <> 'number' or (v_item->>'custo') !~ '^-?[0-9]{1,15}$' then
            v_motivo := 'valor_invalido'; exit;
          end if;
          if jsonb_typeof(v_item->'linhas') <> 'number' or (v_item->>'linhas') !~ '^[1-9][0-9]{0,8}$' then
            v_motivo := 'linhas_invalidas'; exit;
          end if;
        end loop;
        if v_motivo is null and (select count(distinct (value->>'dia') || '|' || (value->>'codigo_produto'))
                                   from jsonb_array_elements(p_itens)) <> v_linhas then
          v_motivo := 'item_duplicado';
        end if;
      end if;
    end if;
    if v_motivo is null then
      select max(coletado_em) into v_ultima from public.solidcon_margem_sync where parte = 'vendas' and status = 'ok';
      select count(*) into v_anteriores from public.solidcon_margem_diaria where dia >= p_desde and dia < p_ate;
      if v_ultima is not null and p_coletado_em <= v_ultima then
        v_motivo := 'snapshot_antigo';
      elsif exists (select 1 from public.solidcon_margem_sync where parte = 'vendas' and status = 'ok'
                       and execucao_id = p_execucao_id and desde = p_desde) then
        v_motivo := 'execucao_repetida';
      elsif v_anteriores >= 30 and v_linhas::bigint * 10 < v_anteriores * 3 then
        -- Janela que ja tinha 30+ linhas perdendo mais de 70% de uma vez: falha na origem, nao venda.
        v_motivo := 'queda_superior_70_porcento';
      end if;
    end if;
    if v_motivo is null then
      -- Substitui so a janela (WHERE obrigatorio, safeupdate).
      delete from public.solidcon_margem_diaria where dia >= p_desde and dia < p_ate;
      insert into public.solidcon_margem_diaria(dia, codigo_produto, quantidade, venda_centavos, custo_centavos, linhas, coletado_em)
      select (i->>'dia')::date, (i->>'codigo_produto')::integer, (i->>'quantidade')::numeric,
             (i->>'venda')::bigint, (i->>'custo')::bigint, (i->>'linhas')::integer, p_coletado_em
        from jsonb_array_elements(p_itens) as t(i);
      -- Cobertura: todos os dias da janela aceita, com ou sem venda.
      insert into public.solidcon_margem_cobertura(dia, coletado_em)
      select g::date, p_coletado_em from generate_series(p_desde::timestamp, (p_ate - 1)::timestamp, interval '1 day') as g
      on conflict (dia) do update set coletado_em = excluded.coletado_em;
      delete from public.solidcon_margem_sync where em < v_agora - interval '90 days';
      insert into public.solidcon_margem_sync(parte, status, linhas, desde, ate, coletado_em, execucao_id, em)
        values ('vendas', 'ok', v_linhas, p_desde, p_ate, p_coletado_em, p_execucao_id, v_agora) returning id into v_log;
      return jsonb_build_object('id', v_log, 'status', 'ok', 'linhas', v_linhas, 'desde', p_desde, 'ate', p_ate);
    end if;
  exception when others then
    v_motivo := 'falha_interna';
  end;
  insert into public.solidcon_margem_sync(parte, status, linhas, desde, ate, coletado_em, execucao_id, mensagem, em)
    values ('vendas', 'erro', v_linhas, p_desde, p_ate, p_coletado_em, p_execucao_id, v_motivo, v_agora) returning id into v_log;
  return jsonb_build_object('id', v_log, 'status', 'erro', 'motivo', v_motivo);
end;
$$;
revoke all on function public.solidcon_receber_margem_vendas(date, date, jsonb, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.solidcon_receber_margem_vendas(date, date, jsonb, timestamptz, uuid) to authenticated;

-- (B) custos por produto ---------------------------------------------------------------------
create or replace function public.solidcon_receber_custos(
  p_itens jsonb, p_coletado_em timestamptz, p_execucao_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_agora timestamptz;
  v_motivo text;
  v_item jsonb;
  v_linhas integer := 0;
  v_anteriores bigint;
  v_ultima timestamptz;
  v_log bigint;
  v_d date;
  v_c text;
  v_campos constant text[] := array['codigo_produto','unidade','custo_medio','custo_reposicao','preco_venda','ultimo_recebimento'];
begin
  if auth.uid() is null or not exists (
    select 1 from public.integracoes_autorizadas where user_id = auth.uid()
  ) then
    raise exception 'integracao nao autorizada' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(5100,31);
  v_agora := clock_timestamp();
  begin
    if p_execucao_id is null then
      v_motivo := 'execucao_invalida';
    elsif p_coletado_em is null or not isfinite(p_coletado_em)
       or p_coletado_em < v_agora - interval '24 hours'
       or p_coletado_em > v_agora + interval '5 minutes' then
      v_motivo := 'coleta_fora_da_janela';
    elsif p_itens is null or jsonb_typeof(p_itens) <> 'array' then
      v_motivo := 'payload_invalido';
    else
      v_linhas := jsonb_array_length(p_itens);
      if v_linhas = 0 then
        v_motivo := 'snapshot_vazio';
      elsif v_linhas > 20000 or octet_length(p_itens::text) > 8388608 then
        v_motivo := 'payload_fora_do_limite';
      else
        for v_item in select value from jsonb_array_elements(p_itens) loop
          if jsonb_typeof(v_item) <> 'object' then v_motivo := 'item_invalido'; exit; end if;
          if not (v_item ?& v_campos) or (v_item - v_campos) <> '{}'::jsonb then
            v_motivo := 'campos_invalidos'; exit;
          end if;
          if jsonb_typeof(v_item->'codigo_produto') <> 'number'
             or (v_item->>'codigo_produto') !~ '^[1-9][0-9]{0,9}$'
             or (v_item->>'codigo_produto')::bigint > 2147483647 then
            v_motivo := 'produto_invalido'; exit;
          end if;
          if jsonb_typeof(v_item->'unidade') <> 'string' or (v_item->>'unidade') !~ '^[0-9A-Za-z./ -]{1,20}$' then
            v_motivo := 'unidade_invalida'; exit;
          end if;
          foreach v_c in array array['custo_medio','custo_reposicao','preco_venda'] loop
            if jsonb_typeof(v_item->v_c) <> 'null' and (
                 jsonb_typeof(v_item->v_c) <> 'number' or (v_item->>v_c) !~ '^[0-9]{1,15}$') then
              v_motivo := 'valor_invalido';
            end if;
          end loop;
          exit when v_motivo is not null;
          if jsonb_typeof(v_item->'ultimo_recebimento') <> 'null' then
            if jsonb_typeof(v_item->'ultimo_recebimento') <> 'string'
               or (v_item->>'ultimo_recebimento') !~ '^(19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}$' then
              v_motivo := 'data_invalida'; exit;
            end if;
            begin
              v_d := (v_item->>'ultimo_recebimento')::date;
            exception when others then
              v_motivo := 'data_invalida'; exit;
            end;
          end if;
        end loop;
        if v_motivo is null and (select count(distinct (value->>'codigo_produto') || '|' || (value->>'unidade'))
                                   from jsonb_array_elements(p_itens)) <> v_linhas then
          v_motivo := 'item_duplicado';
        end if;
      end if;
    end if;
    if v_motivo is null then
      select max(coletado_em) into v_ultima from public.solidcon_margem_sync where parte = 'custos' and status = 'ok';
      select count(*) into v_anteriores from public.solidcon_custos;
      if v_ultima is not null and p_coletado_em <= v_ultima then
        v_motivo := 'snapshot_antigo';
      elsif exists (select 1 from public.solidcon_margem_sync where parte = 'custos' and status = 'ok' and execucao_id = p_execucao_id) then
        v_motivo := 'execucao_repetida';
      elsif v_linhas::bigint * 2 < v_anteriores then
        v_motivo := 'queda_superior_50_porcento';
      end if;
    end if;
    if v_motivo is null then
      delete from public.solidcon_custos where codigo_produto is not null;
      insert into public.solidcon_custos(codigo_produto, unidade, custo_medio_centavos, custo_reposicao_centavos,
        preco_venda_centavos, ultimo_recebimento, coletado_em)
      select (i->>'codigo_produto')::integer, i->>'unidade', (i->>'custo_medio')::bigint, (i->>'custo_reposicao')::bigint,
             (i->>'preco_venda')::bigint, (i->>'ultimo_recebimento')::date, p_coletado_em
        from jsonb_array_elements(p_itens) as t(i);
      delete from public.solidcon_margem_sync where em < v_agora - interval '90 days';
      insert into public.solidcon_margem_sync(parte, status, linhas, coletado_em, execucao_id, em)
        values ('custos', 'ok', v_linhas, p_coletado_em, p_execucao_id, v_agora) returning id into v_log;
      return jsonb_build_object('id', v_log, 'status', 'ok', 'linhas', v_linhas);
    end if;
  exception when others then
    v_motivo := 'falha_interna';
  end;
  insert into public.solidcon_margem_sync(parte, status, linhas, coletado_em, execucao_id, mensagem, em)
    values ('custos', 'erro', v_linhas, p_coletado_em, p_execucao_id, v_motivo, v_agora) returning id into v_log;
  return jsonb_build_object('id', v_log, 'status', 'erro', 'motivo', v_motivo);
end;
$$;
revoke all on function public.solidcon_receber_custos(jsonb, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.solidcon_receber_custos(jsonb, timestamptz, uuid) to authenticated;

commit;
