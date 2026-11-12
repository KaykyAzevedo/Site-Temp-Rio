-- 030: contas a receber ABERTAS da filial 4 (coletor pelo banco SQL, modulo 'receber').
-- NAO APLICADA. Instalacao manual no SQL Editor (papel postgres). Idempotente: pode rodar de novo.
-- Requer 019 (integracoes_autorizadas), 026 (solidcon_026_documento_valido) e eh_equipe().
-- Origem: dbo.VW_RDUPHOLD_CONTASRECEBER_ABERTO (Codigo_Filial=4) + dbo.VW_MGN_PARCEIRO (CNPJ).
-- Minimizacao/LGPD: so filial 4; sem Historico livre e sem nome do parceiro (o nome vem de
-- solidcon_clientes pelo documento). Pessoa fisica entra como tipo 'pf' SEM documento, SEM
-- codigo do parceiro, SEM numero de titulo/nota: so valores e vencimento.
-- (A) solidcon_receber: espelho substituido por inteiro a cada coleta aceita.
-- (B) solidcon_receber_sync: log de coletas (ok/erro, so contagens). Retencao 90 dias.
-- (C) RPC solidcon_receber_contas_receber: so a conta de integracao; trava de sanidade.
-- Leitura: somente eh_equipe(); anon nada. Escrita: somente a RPC SECURITY DEFINER.
-- Nao altera nenhuma tabela/funcao existente.
begin;

do $$
begin
  if to_regclass('public.integracoes_autorizadas') is null
     or to_regprocedure('public.solidcon_026_documento_valido(text,text)') is null
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception '030 requer 019, 026 (solidcon_026_documento_valido) e eh_equipe(). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100,30);

create table if not exists public.solidcon_receber (
  id text primary key check (id ~ '^[0-9a-f]{32}$'),
  tipo text not null check (tipo in ('cnpj','pf','sem_documento')),
  documento text,
  codigo_parceiro integer,
  documento_titulo text check (documento_titulo is null or char_length(documento_titulo) between 1 and 30),
  cd_nota bigint check (cd_nota is null or cd_nota > 0),
  vencimento date not null,
  valor_aberto_centavos bigint not null check (valor_aberto_centavos >= 0),
  valor_fatura_centavos bigint check (valor_fatura_centavos is null or valor_fatura_centavos >= 0),
  valor_pago_centavos bigint check (valor_pago_centavos is null or valor_pago_centavos >= 0),
  valor_mora_centavos bigint check (valor_mora_centavos is null or valor_mora_centavos >= 0),
  valor_multa_centavos bigint check (valor_multa_centavos is null or valor_multa_centavos >= 0),
  valor_desconto_centavos bigint check (valor_desconto_centavos is null or valor_desconto_centavos >= 0),
  categoria text check (categoria is null or char_length(categoria) between 1 and 100),
  dias_atraso integer not null check (dias_atraso >= 0),
  coletado_em timestamptz not null,
  -- PF nunca identificada; CNPJ sempre com documento.
  constraint solidcon_receber_030_tipo check (
    (tipo = 'cnpj' and documento ~ '^[0-9]{14}$')
    or (tipo = 'pf' and documento is null and codigo_parceiro is null and documento_titulo is null and cd_nota is null)
    or (tipo = 'sem_documento' and documento is null and codigo_parceiro is null)
  )
);
create index if not exists solidcon_receber_documento_idx on public.solidcon_receber(documento) where documento is not null;
create index if not exists solidcon_receber_vencimento_idx on public.solidcon_receber(vencimento);

create table if not exists public.solidcon_receber_sync (
  id bigint generated always as identity primary key,
  status text not null check (status in ('ok','erro')),
  linhas integer not null default 0,
  total_aberto_centavos bigint,
  coletado_em timestamptz,
  execucao_id uuid,
  mensagem text check (mensagem is null or char_length(mensagem) <= 200),
  em timestamptz not null default now()
);
create unique index if not exists solidcon_receber_sync_execucao_idx
  on public.solidcon_receber_sync(execucao_id) where status = 'ok' and execucao_id is not null;
create index if not exists solidcon_receber_sync_em_idx on public.solidcon_receber_sync(em);

alter table public.solidcon_receber enable row level security;
alter table public.solidcon_receber_sync enable row level security;
revoke all on public.solidcon_receber, public.solidcon_receber_sync from public, anon, authenticated;
revoke all on sequence public.solidcon_receber_sync_id_seq from public, anon, authenticated;
grant select on public.solidcon_receber, public.solidcon_receber_sync to authenticated;
drop policy if exists solidcon_030_equipe_le on public.solidcon_receber;
create policy solidcon_030_equipe_le on public.solidcon_receber for select to authenticated using (public.eh_equipe());
drop policy if exists solidcon_030_equipe_le on public.solidcon_receber_sync;
create policy solidcon_030_equipe_le on public.solidcon_receber_sync for select to authenticated using (public.eh_equipe());

create or replace function public.solidcon_receber_contas_receber(
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
  v_dia date;
  v_total bigint;
  v_log bigint;
  v_campos constant text[] := array['id','tipo','documento','codigo_parceiro','documento_titulo','cd_nota',
    'vencimento','valor_aberto','valor_fatura','valor_pago','valor_mora','valor_multa','valor_desconto','categoria'];
  v_valores constant text[] := array['valor_fatura','valor_pago','valor_mora','valor_multa','valor_desconto'];
  v_c text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.integracoes_autorizadas where user_id = auth.uid()
  ) then
    raise exception 'integracao nao autorizada' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(5100,30);
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
      if v_linhas > 10000 or octet_length(p_itens::text) > 8388608 then
        v_motivo := 'payload_fora_do_limite';
      else
        for v_item in select value from jsonb_array_elements(p_itens) loop
          if jsonb_typeof(v_item) <> 'object' then v_motivo := 'item_invalido'; exit; end if;
          -- Whitelist EXATA de campos.
          if not (v_item ?& v_campos) or (v_item - v_campos) <> '{}'::jsonb then
            v_motivo := 'campos_invalidos'; exit;
          end if;
          if jsonb_typeof(v_item->'id') <> 'string' or (v_item->>'id') !~ '^[0-9a-f]{32}$' then
            v_motivo := 'id_invalido'; exit;
          end if;
          if jsonb_typeof(v_item->'tipo') <> 'string' or (v_item->>'tipo') not in ('cnpj','pf','sem_documento') then
            v_motivo := 'tipo_invalido'; exit;
          end if;
          if (v_item->>'tipo') = 'cnpj' then
            if jsonb_typeof(v_item->'documento') <> 'string'
               or not public.solidcon_026_documento_valido(v_item->>'documento', 'cnpj') then
              v_motivo := 'documento_invalido'; exit;
            end if;
            if jsonb_typeof(v_item->'codigo_parceiro') <> 'number'
               or (v_item->>'codigo_parceiro') !~ '^[1-9][0-9]{0,9}$'
               or (v_item->>'codigo_parceiro')::bigint > 2147483647 then
              v_motivo := 'parceiro_invalido'; exit;
            end if;
          else
            -- PF / sem documento: nunca identificar.
            if jsonb_typeof(v_item->'documento') <> 'null' or jsonb_typeof(v_item->'codigo_parceiro') <> 'null' then
              v_motivo := 'identificacao_indevida'; exit;
            end if;
          end if;
          if (v_item->>'tipo') = 'pf'
             and (jsonb_typeof(v_item->'documento_titulo') <> 'null' or jsonb_typeof(v_item->'cd_nota') <> 'null') then
            v_motivo := 'identificacao_indevida'; exit;
          end if;
          if jsonb_typeof(v_item->'documento_titulo') <> 'null' and (
               jsonb_typeof(v_item->'documento_titulo') <> 'string'
               or (v_item->>'documento_titulo') !~ '^[0-9A-Za-z./ -]{1,30}$') then
            v_motivo := 'titulo_invalido'; exit;
          end if;
          if jsonb_typeof(v_item->'cd_nota') <> 'null' and (
               jsonb_typeof(v_item->'cd_nota') <> 'number' or (v_item->>'cd_nota') !~ '^[1-9][0-9]{0,17}$') then
            v_motivo := 'nota_invalida'; exit;
          end if;
          if jsonb_typeof(v_item->'vencimento') <> 'string'
             or (v_item->>'vencimento') !~ '^(19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}$' then
            v_motivo := 'vencimento_invalido'; exit;
          end if;
          begin
            v_dia := (v_item->>'vencimento')::date;
          exception when others then
            v_motivo := 'vencimento_invalido'; exit;
          end;
          if jsonb_typeof(v_item->'valor_aberto') <> 'number' or (v_item->>'valor_aberto') !~ '^[0-9]{1,15}$' then
            v_motivo := 'valor_invalido'; exit;
          end if;
          foreach v_c in array v_valores loop
            if jsonb_typeof(v_item->v_c) <> 'null' and (
                 jsonb_typeof(v_item->v_c) <> 'number' or (v_item->>v_c) !~ '^[0-9]{1,15}$') then
              v_motivo := 'valor_invalido';
            end if;
          end loop;
          exit when v_motivo is not null;
          if jsonb_typeof(v_item->'categoria') <> 'null' and (
               jsonb_typeof(v_item->'categoria') <> 'string'
               or length(btrim(v_item->>'categoria')) not between 1 and 100
               or (v_item->>'categoria') ~ '[[:cntrl:]]') then
            v_motivo := 'categoria_invalida'; exit;
          end if;
        end loop;
        if v_motivo is null and (select count(distinct value->>'id') from jsonb_array_elements(p_itens)) <> v_linhas then
          v_motivo := 'id_duplicado';
        end if;
      end if;
    end if;
    if v_motivo is null then
      select max(coletado_em) into v_ultima from public.solidcon_receber_sync where status = 'ok';
      select count(*) into v_anteriores from public.solidcon_receber;
      if v_ultima is not null and p_coletado_em <= v_ultima then
        v_motivo := 'snapshot_antigo';
      elsif exists (select 1 from public.solidcon_receber_sync where status = 'ok' and execucao_id = p_execucao_id) then
        v_motivo := 'execucao_repetida';
      elsif v_anteriores >= 20 and v_linhas::bigint * 10 < v_anteriores * 3 then
        -- Mais de 70% das parcelas sumindo de uma vez: mais provavel falha na origem do que pagamento.
        v_motivo := 'queda_superior_70_porcento';
      end if;
    end if;
    if v_motivo is null then
      v_dia := (p_coletado_em at time zone 'America/Sao_Paulo')::date;
      -- Substituicao completa. WHERE obrigatorio (safeupdate).
      delete from public.solidcon_receber where id is not null;
      insert into public.solidcon_receber(
        id, tipo, documento, codigo_parceiro, documento_titulo, cd_nota, vencimento,
        valor_aberto_centavos, valor_fatura_centavos, valor_pago_centavos, valor_mora_centavos,
        valor_multa_centavos, valor_desconto_centavos, categoria, dias_atraso, coletado_em)
      select i->>'id', i->>'tipo', i->>'documento', (i->>'codigo_parceiro')::integer, i->>'documento_titulo',
        (i->>'cd_nota')::bigint, (i->>'vencimento')::date,
        (i->>'valor_aberto')::bigint, (i->>'valor_fatura')::bigint, (i->>'valor_pago')::bigint,
        (i->>'valor_mora')::bigint, (i->>'valor_multa')::bigint, (i->>'valor_desconto')::bigint,
        nullif(btrim(i->>'categoria'), ''), greatest(0, v_dia - (i->>'vencimento')::date), p_coletado_em
      from jsonb_array_elements(p_itens) as t(i);
      select coalesce(sum(valor_aberto_centavos), 0) into v_total from public.solidcon_receber;
      delete from public.solidcon_receber_sync where em < v_agora - interval '90 days';
      insert into public.solidcon_receber_sync(status, linhas, total_aberto_centavos, coletado_em, execucao_id, em)
        values ('ok', v_linhas, v_total, p_coletado_em, p_execucao_id, v_agora) returning id into v_log;
      return jsonb_build_object('id', v_log, 'status', 'ok', 'linhas', v_linhas,
        'coletado_em', p_coletado_em, 'execucao_id', p_execucao_id);
    end if;
  exception when others then
    -- Nunca SQLERRM/DETAIL.
    v_motivo := 'falha_interna';
  end;
  insert into public.solidcon_receber_sync(status, linhas, coletado_em, execucao_id, mensagem, em)
    values ('erro', v_linhas, p_coletado_em, p_execucao_id, v_motivo, v_agora) returning id into v_log;
  return jsonb_build_object('id', v_log, 'status', 'erro', 'motivo', v_motivo, 'execucao_id', p_execucao_id);
end;
$$;
revoke all on function public.solidcon_receber_contas_receber(jsonb, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.solidcon_receber_contas_receber(jsonb, timestamptz, uuid) to authenticated;

commit;
