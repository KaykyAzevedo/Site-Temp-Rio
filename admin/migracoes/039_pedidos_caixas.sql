-- 039: caixas por pedido do ERP (Rota do dia: capacidade da S10 por volume de caixas 24/48).
-- APLICADA em 2026-11-16 (conferida: caixas_24/48/outras criadas; RPC DEFINER aceita "produtos"; anon sem EXECUTE). Instalacao manual no SQL Editor (papel postgres). Idempotente.
-- Requer 035 (solidcon_pedidos_erp + solidcon_receber_pedidos_erp) e 019 (solidcon_produtos).
-- INDEPENDENTE de 036/037/038.
-- (1) solidcon_pedidos_erp ganha caixas_24, caixas_48, caixas_outras (integer NULL, >= 0). NULL = nao sabemos
--     (coletor sem a chave nova, consulta de produtos falhou, quantidade fracionada).
-- (2) solidcon_receber_pedidos_erp passa a aceitar o campo OPCIONAL 'produtos' = [{p: cdProduto, q: quantidade}]
--     por pedido e converte em caixas pelo espelho solidcon_produtos (categoria 'TEMPERO - CAIXA 24 UN'/'48 UN';
--     produto fora do espelho = caixas_outras). O resto da funcao e IDENTICO ao da 035 (mesmas validacoes,
--     trava, substituicao completa, log). Sem 'produtos' o comportamento e o da 035 (colunas novas NULL).
--     Ordem segura: aplicar a 039 ANTES de ligar "pedidos_enviar_caixas": true no config-banco.json do coletor
--     (a 035 recusa campo novo com 'campos_invalidos').
-- Hipotese a confirmar com a AMOSTRA do -Testar: qtPedidoItem e numero de CAIXAS (o produto ja e a caixa).
-- Nada de dado de cliente novo; RLS/grants de leitura nao mudam (eh_equipe le, como na 035).
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.solidcon_pedidos_erp') is null
     or to_regclass('public.solidcon_produtos') is null
     or to_regprocedure('public.solidcon_receber_pedidos_erp(jsonb,timestamptz,uuid)') is null then
    raise exception '039 requer 035 (solidcon_pedidos_erp e solidcon_receber_pedidos_erp) e 019 (solidcon_produtos). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 39);
-- Mesma trava da RPC: nenhuma coleta grava no meio da troca.
select pg_catalog.pg_advisory_xact_lock(5100, 35);

alter table public.solidcon_pedidos_erp
  add column if not exists caixas_24 integer,
  add column if not exists caixas_48 integer,
  add column if not exists caixas_outras integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'solidcon_pedidos_erp_039_caixas'
                    and conrelid = 'public.solidcon_pedidos_erp'::regclass) then
    alter table public.solidcon_pedidos_erp add constraint solidcon_pedidos_erp_039_caixas check (
      (caixas_24 is null or caixas_24 between 0 and 100000)
      and (caixas_48 is null or caixas_48 between 0 and 100000)
      and (caixas_outras is null or caixas_outras between 0 and 100000)
    );
  end if;
end;
$$;

create or replace function public.solidcon_receber_pedidos_erp(
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
  v_ts timestamptz;
  v_ped timestamptz;
  v_etapas jsonb;
  v_log bigint;
  v_campos constant text[] := array['cd_pedido','dt_pedido','etapa','dt_carga','dt_sep_inicio','dt_sep_fim',
    'dt_conferencia','dt_saida','dt_nota','dt_atendido','cliente_tipo','documento','valor_centavos','nr_carga'];
  v_datas constant text[] := array['dt_pedido','dt_carga','dt_sep_inicio','dt_sep_fim','dt_conferencia',
    'dt_saida','dt_nota','dt_atendido'];
  v_c text;
  v_prods jsonb;
  v_p jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.integracoes_autorizadas where user_id = auth.uid()
  ) then
    raise exception 'integracao nao autorizada' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(5100,35);
  v_agora := clock_timestamp();
  begin
    if p_execucao_id is null then
      v_motivo := 'execucao_invalida';
    elsif p_coletado_em is null or not isfinite(p_coletado_em)
       or p_coletado_em < v_agora - interval '1 hour'
       or p_coletado_em > v_agora + interval '5 minutes' then
      v_motivo := 'coleta_fora_da_janela';
    elsif p_itens is null or jsonb_typeof(p_itens) <> 'array' then
      v_motivo := 'payload_invalido';
    else
      v_linhas := jsonb_array_length(p_itens);
      if v_linhas > 5000 or octet_length(p_itens::text) > 4194304 then
        v_motivo := 'payload_fora_do_limite';
      else
        for v_item in select value from jsonb_array_elements(p_itens) loop
          if jsonb_typeof(v_item) <> 'object' then v_motivo := 'item_invalido'; exit; end if;
          -- Whitelist EXATA de campos (cliente_nome nunca vem do coletor). 039: 'produtos' e OPCIONAL
          -- (coletor sem pedidos_enviar_caixas continua mandando exatamente os campos da 035).
          if not (v_item ?& v_campos) or (v_item - v_campos - 'produtos') <> '{}'::jsonb then
            v_motivo := 'campos_invalidos'; exit;
          end if;
          if jsonb_typeof(v_item->'cd_pedido') <> 'number' or (v_item->>'cd_pedido') !~ '^[1-9][0-9]{0,11}$' then
            v_motivo := 'pedido_invalido'; exit;
          end if;
          if jsonb_typeof(v_item->'etapa') <> 'string'
             or (v_item->>'etapa') not in ('aberto','na_carga','separando','separado','conferido','saiu','atendido') then
            v_motivo := 'etapa_invalida'; exit;
          end if;
          -- Datas: null ou ISO com fuso; entre 2000 e a coleta (+1 dia de folga de relogio).
          foreach v_c in array v_datas loop
            if jsonb_typeof(v_item->v_c) = 'null' then
              if v_c = 'dt_pedido' then v_motivo := 'data_invalida'; end if;
              continue;
            end if;
            if jsonb_typeof(v_item->v_c) <> 'string'
               or (v_item->>v_c) !~ '^(20)[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?[+-][0-9]{2}:[0-9]{2}$' then
              v_motivo := 'data_invalida'; exit;
            end if;
            begin
              v_ts := (v_item->>v_c)::timestamptz;
            exception when others then
              v_motivo := 'data_invalida'; exit;
            end;
            if v_ts < '2000-01-01'::timestamptz or v_ts > p_coletado_em + interval '1 day' then
              v_motivo := 'data_invalida'; exit;
            end if;
            if v_c = 'dt_pedido' then v_ped := v_ts; end if;
          end loop;
          exit when v_motivo is not null;
          -- Janela de 30 dias (+2 de folga para fuso/relogio).
          if v_ped < p_coletado_em - interval '32 days' then
            v_motivo := 'pedido_fora_da_janela'; exit;
          end if;
          if not (case v_item->>'etapa'
               when 'atendido' then jsonb_typeof(v_item->'dt_atendido') = 'string'
               when 'saiu' then jsonb_typeof(v_item->'dt_saida') = 'string'
               when 'conferido' then jsonb_typeof(v_item->'dt_conferencia') = 'string'
               when 'separado' then jsonb_typeof(v_item->'dt_sep_fim') = 'string'
               when 'separando' then jsonb_typeof(v_item->'dt_sep_inicio') = 'string'
               when 'na_carga' then jsonb_typeof(v_item->'nr_carga') = 'number'
               else true end) then
            v_motivo := 'etapa_sem_data'; exit;
          end if;
          if jsonb_typeof(v_item->'cliente_tipo') <> 'string'
             or (v_item->>'cliente_tipo') not in ('cnpj','cpf','indefinido') then
            v_motivo := 'cliente_tipo_invalido'; exit;
          end if;
          if (v_item->>'cliente_tipo') = 'cnpj' then
            if jsonb_typeof(v_item->'documento') <> 'string'
               or not public.solidcon_026_documento_valido(v_item->>'documento', 'cnpj') then
              v_motivo := 'documento_invalido'; exit;
            end if;
          elsif jsonb_typeof(v_item->'documento') <> 'null' then
            -- CPF / indefinido: nunca identificar.
            v_motivo := 'identificacao_indevida'; exit;
          end if;
          if jsonb_typeof(v_item->'valor_centavos') <> 'null' and (
               jsonb_typeof(v_item->'valor_centavos') <> 'number' or (v_item->>'valor_centavos') !~ '^[0-9]{1,15}$') then
            v_motivo := 'valor_invalido'; exit;
          end if;
          if jsonb_typeof(v_item->'nr_carga') <> 'null' and (
               jsonb_typeof(v_item->'nr_carga') <> 'number' or (v_item->>'nr_carga') !~ '^[1-9][0-9]{0,11}$') then
            v_motivo := 'carga_invalida'; exit;
          end if;
          -- 039: produtos = null | [{p: cdProduto, q: quantidade}] (no maximo 300). Um objeto sozinho e aceito
          -- como lista de 1 (serializacao do PowerShell). So numeros: nenhum texto livre entra.
          if v_item ? 'produtos' and jsonb_typeof(v_item->'produtos') <> 'null' then
            v_prods := case jsonb_typeof(v_item->'produtos') when 'object' then jsonb_build_array(v_item->'produtos')
                                                              else v_item->'produtos' end;
            if jsonb_typeof(v_prods) <> 'array' or jsonb_array_length(v_prods) > 300 then
              v_motivo := 'produtos_invalidos'; exit;
            end if;
            for v_p in select value from jsonb_array_elements(v_prods) loop
              if jsonb_typeof(v_p) <> 'object' or not (v_p ?& array['p','q']) or (v_p - array['p','q']) <> '{}'::jsonb
                 or jsonb_typeof(v_p->'p') <> 'number' or (v_p->>'p') !~ '^[1-9][0-9]{0,11}$'
                 or jsonb_typeof(v_p->'q') <> 'number' or (v_p->>'q') !~ '^[0-9]{1,6}(\.[0-9]{1,6})?$'
                 or (v_p->>'q')::numeric > 100000 then
                v_motivo := 'produtos_invalidos'; exit;
              end if;
            end loop;
            exit when v_motivo is not null;
          end if;
        end loop;
        if v_motivo is null and (select count(distinct value->>'cd_pedido') from jsonb_array_elements(p_itens)) <> v_linhas then
          v_motivo := 'pedido_duplicado';
        end if;
      end if;
    end if;
    if v_motivo is null then
      select max(coletado_em) into v_ultima from public.solidcon_pedidos_erp_sync where status = 'ok';
      select count(*) into v_anteriores from public.solidcon_pedidos_erp;
      if v_ultima is not null and p_coletado_em <= v_ultima then
        v_motivo := 'snapshot_antigo';
      elsif exists (select 1 from public.solidcon_pedidos_erp_sync where status = 'ok' and execucao_id = p_execucao_id) then
        v_motivo := 'execucao_repetida';
      elsif v_anteriores >= 20 and v_linhas::bigint * 10 < v_anteriores * 3 then
        -- Mais de 70% dos pedidos sumindo de uma vez (5 min): mais provavel falha na origem.
        v_motivo := 'queda_superior_70_porcento';
      end if;
    end if;
    if v_motivo is null then
      -- Substituicao completa = poda de tudo que saiu da janela. WHERE obrigatorio (safeupdate).
      delete from public.solidcon_pedidos_erp where cd_pedido is not null;
      insert into public.solidcon_pedidos_erp(
        cd_pedido, dt_pedido, etapa, dt_carga, dt_sep_inicio, dt_sep_fim, dt_conferencia, dt_saida,
        dt_nota, dt_atendido, cliente_tipo, documento, cliente_nome, valor_centavos, nr_carga, atualizado_em,
        caixas_24, caixas_48, caixas_outras)
      select (i->>'cd_pedido')::bigint, (i->>'dt_pedido')::timestamptz, i->>'etapa',
        (i->>'dt_carga')::timestamptz, (i->>'dt_sep_inicio')::timestamptz, (i->>'dt_sep_fim')::timestamptz,
        (i->>'dt_conferencia')::timestamptz, (i->>'dt_saida')::timestamptz, (i->>'dt_nota')::timestamptz,
        (i->>'dt_atendido')::timestamptz, i->>'cliente_tipo', i->>'documento',
        -- Nome so para CNPJ, do espelho de clientes (023).
        case when i->>'cliente_tipo' = 'cnpj' then (
          select left(btrim(c.nome), 150) from public.solidcon_clientes c
           where c.tipo = 'cnpj' and c.documento = i->>'documento') end,
        (i->>'valor_centavos')::bigint, (i->>'nr_carga')::bigint, p_coletado_em,
        cx.c24, cx.c48, cx.outras
      from jsonb_array_elements(p_itens) as t(i)
      -- 039: caixas pelo cadastro do espelho (solidcon_produtos.categoria). Sem 'produtos' ou com quantidade
      -- fracionada = NULL nas tres (nao da para afirmar). Produto fora do espelho = caixas_outras.
      left join lateral (
        select case when x.n = 0 or x.frac then null else coalesce(x.c24, 0) end as c24,
               case when x.n = 0 or x.frac then null else coalesce(x.c48, 0) end as c48,
               case when x.n = 0 or x.frac then null else coalesce(x.outras, 0) end as outras
          from (
            select count(*) as n,
                   coalesce(bool_or((e->>'q')::numeric <> trunc((e->>'q')::numeric)), false) as frac,
                   sum((e->>'q')::numeric) filter (where pr.categoria = 'TEMPERO - CAIXA 24 UN')::integer as c24,
                   sum((e->>'q')::numeric) filter (where pr.categoria = 'TEMPERO - CAIXA 48 UN')::integer as c48,
                   sum((e->>'q')::numeric) filter (where pr.id_produto is null
                                                      or pr.categoria not in ('TEMPERO - CAIXA 24 UN', 'TEMPERO - CAIXA 48 UN'))::integer as outras
              from jsonb_array_elements(case jsonb_typeof(i->'produtos')
                                          when 'array' then i->'produtos'
                                          when 'object' then jsonb_build_array(i->'produtos')
                                          else '[]'::jsonb end) as e
              left join public.solidcon_produtos pr on pr.id_produto = (e->>'p')::bigint
          ) x
      ) cx on true;
      select coalesce(jsonb_object_agg(etapa, n), '{}'::jsonb) into v_etapas
        from (select etapa, count(*) as n from public.solidcon_pedidos_erp group by etapa) e;
      delete from public.solidcon_pedidos_erp_sync where em < v_agora - interval '30 days';
      insert into public.solidcon_pedidos_erp_sync(status, linhas, por_etapa, coletado_em, execucao_id, em)
        values ('ok', v_linhas, v_etapas, p_coletado_em, p_execucao_id, v_agora) returning id into v_log;
      return jsonb_build_object('id', v_log, 'status', 'ok', 'linhas', v_linhas,
        'coletado_em', p_coletado_em, 'execucao_id', p_execucao_id);
    end if;
  exception when others then
    -- Nunca SQLERRM/DETAIL (poderia citar documento recebido).
    v_motivo := 'falha_interna';
  end;
  insert into public.solidcon_pedidos_erp_sync(status, linhas, coletado_em, execucao_id, mensagem, em)
    values ('erro', v_linhas, p_coletado_em, p_execucao_id, v_motivo, v_agora) returning id into v_log;
  return jsonb_build_object('id', v_log, 'status', 'erro', 'motivo', v_motivo, 'execucao_id', p_execucao_id);
end;
$$;
revoke all on function public.solidcon_receber_pedidos_erp(jsonb, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.solidcon_receber_pedidos_erp(jsonb, timestamptz, uuid) to authenticated;

commit;
