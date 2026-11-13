-- 035: pedidos de venda do ERP com a etapa do WMS (Kanban), coletor pelo banco SQL, modulo 'pedidos'.
-- NAO APLICADA. Instalacao manual no SQL Editor (papel postgres). Idempotente: pode rodar de novo.
-- Requer 019 (integracoes_autorizadas), 023 (solidcon_clientes), 026 (solidcon_026_documento_valido)
-- e eh_equipe().
-- Origem (leitura de TABELAS autorizada pelo dono em 2026-11-13; so SELECT, filial 4):
--   dbo.tbPedido + dbo.tbPedidoVenda + dbo.tbWmsCarga + dbo.tbWmsCargaUmaSaida (agregado por pedido)
--   + dbo.VW_MGN_PARCEIRO (CNPJ do cliente pelo codigo comercial do pedido).
-- Janela: pedidos dos ultimos 30 dias; concluidos ('saiu'/'atendido') so nos ultimos 3 dias.
--   Carga cancelada nao entra. Cada coleta aceita SUBSTITUI a tabela inteira (poda natural).
-- Minimizacao/LGPD: sem endereco, observacao ou JSON do pedido. Cliente CNPJ valido = documento
--   + nome (o nome vem de solidcon_clientes pelo documento, nunca do coletor). CPF ou
--   indefinido = SO o tipo: sem documento, sem nome, sem codigo de cliente.
-- (A) solidcon_pedidos_erp: espelho dos pedidos da janela.
-- (B) solidcon_pedidos_erp_sync: log de coletas (ok/erro, so contagens). Retencao 30 dias.
-- (C) RPC solidcon_receber_pedidos_erp: so a conta de integracao (integracoes_autorizadas);
--     NUNCA adicionar a conta de sync a admins. Trava de sanidade contra queda brusca.
-- Leitura: somente eh_equipe(); anon nada. Escrita: somente a RPC SECURITY DEFINER.
-- Nao altera nenhuma tabela/funcao existente.
begin;

do $$
begin
  if to_regclass('public.integracoes_autorizadas') is null
     or to_regclass('public.solidcon_clientes') is null
     or to_regprocedure('public.solidcon_026_documento_valido(text,text)') is null
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception '035 requer 019, 023, 026 (solidcon_026_documento_valido) e eh_equipe(). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100,35);

create table if not exists public.solidcon_pedidos_erp (
  cd_pedido bigint primary key check (cd_pedido between 1 and 999999999999),
  dt_pedido timestamptz not null,
  etapa text not null check (etapa in ('aberto','na_carga','separando','separado','conferido','saiu','atendido')),
  dt_carga timestamptz,
  dt_sep_inicio timestamptz,
  dt_sep_fim timestamptz,
  dt_conferencia timestamptz,
  dt_saida timestamptz,
  dt_nota timestamptz,
  dt_atendido timestamptz,
  cliente_tipo text not null check (cliente_tipo in ('cnpj','cpf','indefinido')),
  documento text,
  cliente_nome text check (cliente_nome is null or char_length(cliente_nome) between 1 and 150),
  valor_centavos bigint check (valor_centavos is null or valor_centavos between 0 and 999999999999999),
  nr_carga bigint check (nr_carga is null or nr_carga between 1 and 999999999999),
  atualizado_em timestamptz not null,
  -- CPF/indefinido nunca identificados; CNPJ sempre com documento.
  constraint solidcon_pedidos_erp_035_cliente check (
    (cliente_tipo = 'cnpj' and documento ~ '^[0-9]{14}$')
    or (cliente_tipo in ('cpf','indefinido') and documento is null and cliente_nome is null)
  ),
  -- A etapa precisa da data/carga que a justifica.
  constraint solidcon_pedidos_erp_035_etapa check (
    case etapa
      when 'atendido' then dt_atendido is not null
      when 'saiu' then dt_saida is not null
      when 'conferido' then dt_conferencia is not null
      when 'separado' then dt_sep_fim is not null
      when 'separando' then dt_sep_inicio is not null
      when 'na_carga' then nr_carga is not null
      else true
    end
  )
);
create index if not exists solidcon_pedidos_erp_documento_idx on public.solidcon_pedidos_erp(documento) where documento is not null;
create index if not exists solidcon_pedidos_erp_etapa_idx on public.solidcon_pedidos_erp(etapa, dt_pedido);

create table if not exists public.solidcon_pedidos_erp_sync (
  id bigint generated always as identity primary key,
  status text not null check (status in ('ok','erro')),
  linhas integer not null default 0,
  por_etapa jsonb,
  coletado_em timestamptz,
  execucao_id uuid,
  mensagem text check (mensagem is null or char_length(mensagem) <= 200),
  em timestamptz not null default now()
);
create unique index if not exists solidcon_pedidos_erp_sync_execucao_idx
  on public.solidcon_pedidos_erp_sync(execucao_id) where status = 'ok' and execucao_id is not null;
create index if not exists solidcon_pedidos_erp_sync_em_idx on public.solidcon_pedidos_erp_sync(em);

alter table public.solidcon_pedidos_erp enable row level security;
alter table public.solidcon_pedidos_erp_sync enable row level security;
revoke all on public.solidcon_pedidos_erp, public.solidcon_pedidos_erp_sync from public, anon, authenticated;
revoke all on sequence public.solidcon_pedidos_erp_sync_id_seq from public, anon, authenticated;
grant select on public.solidcon_pedidos_erp, public.solidcon_pedidos_erp_sync to authenticated;
drop policy if exists solidcon_035_equipe_le on public.solidcon_pedidos_erp;
create policy solidcon_035_equipe_le on public.solidcon_pedidos_erp for select to authenticated using (public.eh_equipe());
drop policy if exists solidcon_035_equipe_le on public.solidcon_pedidos_erp_sync;
create policy solidcon_035_equipe_le on public.solidcon_pedidos_erp_sync for select to authenticated using (public.eh_equipe());

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
          -- Whitelist EXATA de campos (cliente_nome nunca vem do coletor).
          if not (v_item ?& v_campos) or (v_item - v_campos) <> '{}'::jsonb then
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
        dt_nota, dt_atendido, cliente_tipo, documento, cliente_nome, valor_centavos, nr_carga, atualizado_em)
      select (i->>'cd_pedido')::bigint, (i->>'dt_pedido')::timestamptz, i->>'etapa',
        (i->>'dt_carga')::timestamptz, (i->>'dt_sep_inicio')::timestamptz, (i->>'dt_sep_fim')::timestamptz,
        (i->>'dt_conferencia')::timestamptz, (i->>'dt_saida')::timestamptz, (i->>'dt_nota')::timestamptz,
        (i->>'dt_atendido')::timestamptz, i->>'cliente_tipo', i->>'documento',
        -- Nome so para CNPJ, do espelho de clientes (023).
        case when i->>'cliente_tipo' = 'cnpj' then (
          select left(btrim(c.nome), 150) from public.solidcon_clientes c
           where c.tipo = 'cnpj' and c.documento = i->>'documento') end,
        (i->>'valor_centavos')::bigint, (i->>'nr_carga')::bigint, p_coletado_em
      from jsonb_array_elements(p_itens) as t(i);
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
