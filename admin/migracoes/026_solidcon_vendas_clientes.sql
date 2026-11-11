-- 026: historico de compras por cliente SOLIDCON. APLICADA em 2026-11-11.
-- Permite analise comercial B2B, recorrencia e ticket medio no painel administrativo.
-- Instalacao manual futura; nenhum acesso ao ERP e nenhuma alteracao no site publico.
begin;

do $$
begin
  if to_regclass('public.solidcon_produtos') is null
     or to_regclass('public.solidcon_sync') is null
     or to_regclass('public.integracoes_autorizadas') is null
     or to_regclass('public.solidcon_clientes') is null
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('public.eh_admin()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception '026 requer 019/020 e 023 completas e helpers de producao. Nada foi aplicado.';
  end if;
end;
$$;

-- Lock proprio para coordenar instalacao e atualizacoes de vendas por cliente,
-- independente dos locks de estoque (5100,4), vendas gerais (5100,18), clientes (5100,23) e ficha (5100,25).
select pg_catalog.pg_advisory_xact_lock(5100, 26);

-- 1. Tabela com as colunas EXATAS para a Vitral (js/admin.js):
-- dia, dt, documento, tipo, valor_centavos, total_itens, cd_pdv, nr_cupom, coletado_em.
-- Chave unica / primaria: (dia, cd_pdv, nr_cupom).
-- Justificativa da chave unica: identifica univocamente cada cupom fiscal emitido por determinado PDV naquele dia,
-- correspondendo exatamente a ordenacao de consulta de js/admin.js (order by dia, cd_pdv, nr_cupom).
-- NAO sao armazenados: nfCeChave, cnpj da filial ou modalidades de pagamento (minimizacao LGPD).
create table if not exists public.solidcon_vendas_clientes (
  dia date not null,
  dt timestamptz not null check (isfinite(dt)),
  documento text not null,
  tipo text not null check (tipo in ('cpf', 'cnpj')),
  valor_centavos bigint not null check (valor_centavos >= 0),
  total_itens integer not null check (total_itens >= 0),
  cd_pdv integer not null check (cd_pdv >= 0),
  nr_cupom bigint not null check (nr_cupom >= 0),
  coletado_em timestamptz not null check (isfinite(coletado_em)),
  primary key (dia, cd_pdv, nr_cupom),
  constraint solidcon_vendas_clientes_documento_tipo check (
    (tipo = 'cpf' and documento ~ '^[0-9]{11}$')
    or (tipo = 'cnpj' and documento ~ '^[0-9]{14}$')
  )
);

-- Indices de alta performance:
-- 1) Por documento e dia (essencial para apuracao do historico/recorrencia por cliente)
create index if not exists solidcon_vendas_clientes_doc_dia_idx
  on public.solidcon_vendas_clientes(documento, dia desc);

-- 2) Por dia desc (para consultas e expurgo de retencao)
create index if not exists solidcon_vendas_clientes_dia_idx
  on public.solidcon_vendas_clientes(dia desc);

-- 1b. Digitos verificadores CPF/CNPJ (modulo 11), mesma regra do coletor.
-- Rejeita documentos de um digito repetido (ex.: so zeros).
create or replace function public.solidcon_026_documento_valido(p_doc text, p_tipo text)
returns boolean
language plpgsql immutable
set search_path = pg_catalog
as $$
declare
  v_pesos int[];
  v_k int;
  v_s int;
  v_r int;
  v_dv int;
  v_rodada int;
begin
  if p_doc is null or p_tipo is null then return false; end if;
  if p_tipo = 'cpf' and p_doc !~ '^[0-9]{11}$' then return false; end if;
  if p_tipo = 'cnpj' and p_doc !~ '^[0-9]{14}$' then return false; end if;
  if p_tipo not in ('cpf', 'cnpj') then return false; end if;
  if p_doc ~ '^(.)\1+$' then return false; end if;
  for v_rodada in 1..2 loop
    if p_tipo = 'cpf' then
      v_k := 8 + v_rodada;
      v_pesos := array(select g from generate_series(v_k + 1, 2, -1) g);
    else
      v_k := 11 + v_rodada;
      v_pesos := case v_rodada when 1 then array[5,4,3,2,9,8,7,6,5,4,3,2]
                                       else array[6,5,4,3,2,9,8,7,6,5,4,3,2] end;
    end if;
    v_s := 0;
    for i in 1..v_k loop
      v_s := v_s + substring(p_doc from i for 1)::int * v_pesos[i];
    end loop;
    v_r := v_s % 11;
    v_dv := case when v_r < 2 then 0 else 11 - v_r end;
    if v_dv <> substring(p_doc from v_k + 1 for 1)::int then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.solidcon_026_documento_valido(text, text) from public, anon, authenticated;

-- 2. Tabela de log de sincronizacao de vendas por cliente
-- Somente metadados tecnicos (LGPD: sem dados pessoais ou cupons).
create table if not exists public.solidcon_vendas_clientes_sync (
  id bigint generated always as identity primary key,
  inicio date not null,
  fim date not null,
  status text not null check (status in ('ok', 'erro')),
  linhas integer not null default 0,
  valor_total_centavos bigint not null default 0,
  coletado_em timestamptz,
  execucao_id uuid,
  mensagem text,
  em timestamptz not null default now()
);

create index if not exists solidcon_vendas_clientes_sync_coleta_idx
  on public.solidcon_vendas_clientes_sync(coletado_em desc) where status = 'ok';
create unique index if not exists solidcon_vendas_clientes_sync_execucao_idx
  on public.solidcon_vendas_clientes_sync(execucao_id) where status = 'ok' and execucao_id is not null;

-- 3. RLS e permissoes
alter table public.solidcon_vendas_clientes enable row level security;
alter table public.solidcon_vendas_clientes_sync enable row level security;

revoke all on public.solidcon_vendas_clientes, public.solidcon_vendas_clientes_sync from public, anon, authenticated;
revoke all on sequence public.solidcon_vendas_clientes_sync_id_seq from public, anon, authenticated;

grant select on public.solidcon_vendas_clientes, public.solidcon_vendas_clientes_sync to authenticated;

drop policy if exists solidcon_026_equipe_le on public.solidcon_vendas_clientes;
create policy solidcon_026_equipe_le on public.solidcon_vendas_clientes for select to authenticated using (public.eh_equipe());

drop policy if exists solidcon_026_equipe_le on public.solidcon_vendas_clientes_sync;
create policy solidcon_026_equipe_le on public.solidcon_vendas_clientes_sync for select to authenticated using (public.eh_equipe());

-- 4. RPC SECURITY DEFINER para receber lote de vendas por cliente
-- Substitui atomicamente o intervalo [p_inicio, p_fim] (DELETE com WHERE compativel com safeupdate do Supabase/PostgREST).
-- Janela temporal de no maximo 31 datas por chamada (p_fim - p_inicio <= 30).
-- Snapshot mais antigo que qualquer envio OK que cubra algum dia do intervalo e recusado.
-- Retencao de 400 dias de historico (limpeza automatica de vendas anteriores a hoje - 400 dias).
create or replace function public.solidcon_receber_vendas_clientes(
  p_inicio date,
  p_fim date,
  p_itens jsonb,
  p_coletado_em timestamptz,
  p_execucao_id uuid
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
  v_campo text;
  v_linhas integer := 0;
  v_total numeric := 0;
  v_item_dia date;
  v_ultima timestamptz;
  v_log bigint;
  v_campos constant text[] := array['dia', 'dt', 'documento', 'tipo', 'valor_centavos', 'total_itens', 'cd_pdv', 'nr_cupom'];
begin
  if auth.uid() is null or not exists (
    select 1 from public.integracoes_autorizadas where user_id = auth.uid()
  ) then
    raise exception 'integracao nao autorizada' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(5100, 26);
  v_agora := clock_timestamp();
  v_hoje := (v_agora at time zone 'America/Sao_Paulo')::date;

  begin
    if p_inicio is null or p_fim is null or p_inicio > p_fim
       or (p_fim - p_inicio) > 30
       or p_inicio < (v_hoje - 400)
       or p_fim > v_hoje then
      v_motivo := 'intervalo_fora_da_janela';
    elsif p_execucao_id is null then
      v_motivo := 'execucao_invalida';
    elsif p_coletado_em is null or not isfinite(p_coletado_em)
       or p_coletado_em < v_agora - interval '24 hours'
       or p_coletado_em > v_agora + interval '5 minutes' then
      v_motivo := 'coleta_fora_da_janela';
    elsif p_itens is null or jsonb_typeof(p_itens) <> 'array' then
      v_motivo := 'payload_invalido';
    else
      v_linhas := jsonb_array_length(p_itens);
      if v_linhas > 10000 or octet_length(p_itens::text) > 16777216 then
        v_motivo := 'payload_fora_do_limite';
      else
        for v_item in select value from jsonb_array_elements(p_itens) loop
          if jsonb_typeof(v_item) <> 'object' then
            v_motivo := 'item_invalido'; exit;
          end if;
          -- Whitelist estrita: qualquer campo nao autorizado (ex: nfCeChave, cnpj, modalidades) rejeita o lote
          if not (v_item ?& v_campos) or (v_item - v_campos) <> '{}'::jsonb then
            v_motivo := 'campos_invalidos'; exit;
          end if;

          -- Validacao de dia
          if jsonb_typeof(v_item->'dia') <> 'string' or (v_item->>'dia') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
            v_motivo := 'dia_invalido'; exit;
          end if;
          begin
            v_item_dia := (v_item->>'dia')::date;
          exception when others then
            v_motivo := 'dia_invalido'; exit;
          end;
          if v_item_dia < p_inicio or v_item_dia > p_fim then
            v_motivo := 'item_fora_do_intervalo'; exit;
          end if;

          -- Validacao de dt: ISO com fuso explicito e no MESMO dia (America/Sao_Paulo) de "dia".
          if jsonb_typeof(v_item->'dt') <> 'string'
             or (v_item->>'dt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
            v_motivo := 'dt_invalida'; exit;
          end if;
          begin
            if not isfinite((v_item->>'dt')::timestamptz)
               or (((v_item->>'dt')::timestamptz) at time zone 'America/Sao_Paulo')::date <> v_item_dia then
              v_motivo := 'dt_invalida'; exit;
            end if;
          exception when others then
            v_motivo := 'dt_invalida'; exit;
          end;

          -- Validacao de tipo e documento
          if jsonb_typeof(v_item->'tipo') <> 'string'
             or (v_item->>'tipo') not in ('cpf', 'cnpj')
             or jsonb_typeof(v_item->'documento') <> 'string'
             or ((v_item->>'tipo') = 'cpf' and (v_item->>'documento') !~ '^[0-9]{11}$')
             or ((v_item->>'tipo') = 'cnpj' and (v_item->>'documento') !~ '^[0-9]{14}$')
             or not public.solidcon_026_documento_valido(v_item->>'documento', v_item->>'tipo') then
            v_motivo := 'documento_invalido'; exit;
          end if;

          -- Validacao de valores numericos inteiros
          foreach v_campo in array array['valor_centavos', 'total_itens', 'cd_pdv', 'nr_cupom'] loop
            if jsonb_typeof(v_item->v_campo) <> 'number' or (v_item->>v_campo) !~ '^[0-9]{1,19}$' then
              v_motivo := 'metadados_invalidos'; exit;
            end if;
          end loop;
          exit when v_motivo is not null;

          begin
            perform (v_item->>'valor_centavos')::bigint,
                    (v_item->>'total_itens')::integer,
                    (v_item->>'cd_pdv')::integer,
                    (v_item->>'nr_cupom')::bigint;
            v_total := v_total + (v_item->>'valor_centavos')::numeric;
          exception when others then
            v_motivo := 'valor_invalido'; exit;
          end;
        end loop;

        if v_motivo is null and v_total > 9223372036854775807::numeric then
          v_motivo := 'total_fora_do_limite';
        end if;

        -- Unicidade da chave primaria (dia, cd_pdv, nr_cupom) no payload
        if v_motivo is null and (
          select count(distinct ((value->>'dia')::date, (value->>'cd_pdv')::numeric, (value->>'nr_cupom')::numeric))
          from jsonb_array_elements(p_itens)
        ) <> v_linhas then
          v_motivo := 'cupom_duplicado';
        end if;
      end if;
    end if;

    if v_motivo is null then
      -- Qualquer envio OK cujo intervalo cruze [p_inicio, p_fim] protege seus dias:
      -- um snapshot mais antigo nao pode sobrescrever dia ja coberto por um mais novo.
      select max(coletado_em) into v_ultima from public.solidcon_vendas_clientes_sync
        where status = 'ok' and inicio <= p_fim and fim >= p_inicio;
      if v_ultima is not null and p_coletado_em <= v_ultima then
        v_motivo := 'snapshot_antigo';
      elsif exists (
        select 1 from public.solidcon_vendas_clientes_sync where status = 'ok' and execucao_id = p_execucao_id
      ) then
        v_motivo := 'execucao_repetida';
      elsif v_linhas = 0 and exists (
        select 1 from public.solidcon_vendas_clientes where dia >= p_inicio and dia <= p_fim
      ) then
        v_motivo := 'vazio_sobre_intervalo_existente';
      end if;
    end if;

    if v_motivo is null then
      -- Substituicao atomica do intervalo: DELETE com WHERE indexado (satisfaz safeupdate do PostgREST)
      delete from public.solidcon_vendas_clientes
      where dia >= p_inicio and dia <= p_fim and dia is not null;

      -- Insercao dos novos itens
      if v_linhas > 0 then
        insert into public.solidcon_vendas_clientes(
          dia, dt, documento, tipo, valor_centavos, total_itens, cd_pdv, nr_cupom, coletado_em
        )
        select
          (i->>'dia')::date,
          (i->>'dt')::timestamptz,
          i->>'documento',
          i->>'tipo',
          (i->>'valor_centavos')::bigint,
          (i->>'total_itens')::integer,
          (i->>'cd_pdv')::integer,
          (i->>'nr_cupom')::bigint,
          p_coletado_em
        from jsonb_array_elements(p_itens) as t(i);
      end if;

      -- Retencao de 400 dias: descarte automatico de dados historicos anteriores a 400 dias
      delete from public.solidcon_vendas_clientes
      where dia < (v_hoje - 400) and dia is not null;

      -- Registro de sincronizacao com sucesso
      insert into public.solidcon_vendas_clientes_sync(
        inicio, fim, status, linhas, valor_total_centavos, coletado_em, execucao_id, em
      )
      values (
        p_inicio, p_fim, 'ok', v_linhas, v_total::bigint, p_coletado_em, p_execucao_id, v_agora
      ) returning id into v_log;

      return jsonb_build_object(
        'id', v_log,
        'status', 'ok',
        'inicio', p_inicio,
        'fim', p_fim,
        'linhas', v_linhas,
        'valor_total_centavos', v_total::bigint,
        'coletado_em', p_coletado_em,
        'execucao_id', p_execucao_id
      );
    end if;
  exception when others then
    v_motivo := 'falha_interna';
  end;

  -- Registro de sincronizacao com erro (sem dados pessoais na mensagem)
  insert into public.solidcon_vendas_clientes_sync(
    inicio, fim, status, linhas, coletado_em, execucao_id, mensagem, em
  )
  values (
    coalesce(p_inicio, '1970-01-01'::date),
    coalesce(p_fim, '1970-01-01'::date),
    'erro', v_linhas, p_coletado_em, p_execucao_id, v_motivo, v_agora
  ) returning id into v_log;

  return jsonb_build_object(
    'id', v_log,
    'status', 'erro',
    'motivo', v_motivo,
    'inicio', p_inicio,
    'fim', p_fim,
    'execucao_id', p_execucao_id
  );
end;
$$;

revoke all on function public.solidcon_receber_vendas_clientes(date, date, jsonb, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.solidcon_receber_vendas_clientes(date, date, jsonb, timestamptz, uuid) to authenticated;

commit;
