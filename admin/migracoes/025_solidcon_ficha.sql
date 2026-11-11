-- 025: ficha tecnica publica dos sabores. APLICADA em 2026-11-11.
-- Requer 005/014 (catalogo/RLS admin), 019/020 (espelho) e 024 (catalogo_publico).
-- Nenhuma chamada nova ao ERP; dados extraidos do GetProdutos ja coletado.
-- Nao altera a RPC solidcon_receber_produtos (critica) nem o frescor do estoque:
-- a ficha NUNCA toca atualizado_em/visto_em/presente/estoque/preco de solidcon_produtos.
begin;

do $$
begin
  if to_regclass('public.solidcon_produtos') is null
     or to_regclass('public.solidcon_sync') is null
     or to_regclass('public.integracoes_autorizadas') is null
     or to_regclass('public.catalogo_produtos') is null
     or to_regprocedure('public.solidcon_catalogo_publico()') is null
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('public.eh_admin()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception '025 requer 019/020 e 024 completas e helpers de producao. Nada foi aplicado.';
  end if;
end;
$$;

-- Lock proprio para coordenar instalacao e atualizacoes da ficha tecnica,
-- independente dos locks de estoque (5100,4), vendas (5100,18) e clientes (5100,23).
select pg_catalog.pg_advisory_xact_lock(5100, 25);

-- 1. Colunas nullable em solidcon_produtos para acomodar metadados fiscais e medida
alter table public.solidcon_produtos
  add column if not exists ncm text,
  add column if not exists cest text,
  add column if not exists qtd_medida numeric,
  add column if not exists unid_medida text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'solidcon_produtos_ncm_chk') then
    alter table public.solidcon_produtos
      add constraint solidcon_produtos_ncm_chk check (ncm is null or ncm ~ '^[0-9]{8}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'solidcon_produtos_cest_chk') then
    alter table public.solidcon_produtos
      add constraint solidcon_produtos_cest_chk check (cest is null or cest ~ '^[0-9]{7}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'solidcon_produtos_qtd_medida_chk') then
    alter table public.solidcon_produtos
      add constraint solidcon_produtos_qtd_medida_chk check (qtd_medida is null or (qtd_medida >= 0 and qtd_medida <> 'NaN'::numeric));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'solidcon_produtos_unid_medida_chk') then
    alter table public.solidcon_produtos
      add constraint solidcon_produtos_unid_medida_chk check (unid_medida is null or (length(btrim(unid_medida)) between 1 and 20 and unid_medida !~ '[[:cntrl:]]'));
  end if;
end;
$$;

-- 2. Tabela de log das sincronizacoes de ficha tecnica
create table if not exists public.solidcon_ficha_sync (
  id bigint generated always as identity primary key,
  status text not null check (status in ('ok', 'erro')),
  linhas integer not null default 0,
  coletado_em timestamptz,
  execucao_id uuid,
  mensagem text,
  em timestamptz not null default now()
);
create index if not exists solidcon_ficha_sync_coleta_idx
  on public.solidcon_ficha_sync(coletado_em desc) where status = 'ok';
create unique index if not exists solidcon_ficha_sync_execucao_idx
  on public.solidcon_ficha_sync(execucao_id) where status = 'ok' and execucao_id is not null;

alter table public.solidcon_ficha_sync enable row level security;
revoke all on public.solidcon_ficha_sync from public, anon, authenticated;
revoke all on sequence public.solidcon_ficha_sync_id_seq from public, anon, authenticated;
grant select on public.solidcon_ficha_sync to authenticated;
drop policy if exists solidcon_025_equipe_le on public.solidcon_ficha_sync;
create policy solidcon_025_equipe_le on public.solidcon_ficha_sync for select to authenticated using (public.eh_equipe());

-- 3. RPC SECURITY DEFINER para receber atualizacoes de ficha tecnica
-- Valida autorizacao, lock proprio, janela temporal, duplicidades e faz UPDATE
-- com WHERE obrigatorio (compativel com safeupdate do Supabase/PostgREST).
create or replace function public.solidcon_receber_ficha(
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
  v_atualizados integer := 0;
  v_encontrados integer := 0;
  v_ultima timestamptz;
  v_log bigint;
  v_campos constant text[] := array['id_produto', 'ncm', 'cest', 'qtd_medida', 'unid_medida'];
begin
  if auth.uid() is null or not exists (
    select 1 from public.integracoes_autorizadas where user_id = auth.uid()
  ) then
    raise exception 'integracao nao autorizada' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(5100, 25);
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
      elsif v_linhas > 2000 or octet_length(p_itens::text) > 16777216 then
        v_motivo := 'payload_fora_do_limite';
      else
        for v_item in select value from jsonb_array_elements(p_itens) loop
          if jsonb_typeof(v_item) <> 'object' then
            v_motivo := 'item_invalido'; exit;
          end if;

          -- Whitelist exata de chaves
          if not(v_item ?& v_campos) or (v_item - v_campos) <> '{}'::jsonb then
            v_motivo := 'campos_invalidos'; exit;
          end if;

          -- id_produto: inteiro positivo
          if jsonb_typeof(v_item->'id_produto') <> 'number'
             or (v_item->>'id_produto')::numeric <= 0
             or (v_item->>'id_produto')::numeric <> trunc((v_item->>'id_produto')::numeric)
             or (v_item->>'id_produto')::numeric > 9223372036854775807 then
            v_motivo := 'id_produto_invalido'; exit;
          end if;

          -- ncm: nullable, 8 digitos
          if jsonb_typeof(v_item->'ncm') <> 'null' and (
            jsonb_typeof(v_item->'ncm') <> 'string'
            or (v_item->>'ncm') !~ '^[0-9]{8}$'
          ) then
            v_motivo := 'ncm_invalido'; exit;
          end if;

          -- cest: nullable, 7 digitos
          if jsonb_typeof(v_item->'cest') <> 'null' and (
            jsonb_typeof(v_item->'cest') <> 'string'
            or (v_item->>'cest') !~ '^[0-9]{7}$') then
            v_motivo := 'cest_invalido'; exit;
          end if;

          -- qtd_medida: nullable, numerico >= 0 e < 1e9 (sanidade)
          if jsonb_typeof(v_item->'qtd_medida') <> 'null' and (
            jsonb_typeof(v_item->'qtd_medida') <> 'number'
            or (v_item->>'qtd_medida')::numeric < 0
            or (v_item->>'qtd_medida')::numeric >= 1000000000
          ) then
            v_motivo := 'qtd_medida_invalida'; exit;
          end if;

          -- unid_medida: nullable, texto 1..20 chars, sem caracteres de controle
          if jsonb_typeof(v_item->'unid_medida') <> 'null' and (
            jsonb_typeof(v_item->'unid_medida') <> 'string'
            or length(btrim(v_item->>'unid_medida')) not between 1 and 20
            or (v_item->>'unid_medida') ~ '[[:cntrl:]]'
          ) then
            v_motivo := 'unid_medida_invalida'; exit;
          end if;
        end loop;

        -- Comparar pelo valor numerico: 1 e 1.0 sao o mesmo produto.
        if v_motivo is null and (
          select count(distinct (value->>'id_produto')::numeric) from jsonb_array_elements(p_itens)
        ) <> v_linhas then
          v_motivo := 'produto_duplicado';
        end if;
      end if;
    end if;

    if v_motivo is null then
      select max(coletado_em) into v_ultima from public.solidcon_ficha_sync where status = 'ok';
      if v_ultima is not null and p_coletado_em <= v_ultima then
        v_motivo := 'snapshot_antigo';
      elsif exists (select 1 from public.solidcon_ficha_sync where status = 'ok' and execucao_id = p_execucao_id) then
        v_motivo := 'execucao_repetida';
      end if;
    end if;

    if v_motivo is null then
      -- Todo item precisa existir e estar presente no espelho (mesmo GetProdutos
      -- do estoque recem-confirmado). Produto desconhecido rejeita o lote inteiro.
      select count(*) into v_encontrados
      from jsonb_array_elements(p_itens) as t(i)
      join public.solidcon_produtos p
        on p.id_produto = (t.i->>'id_produto')::numeric::bigint and p.presente;
      if v_encontrados <> v_linhas then
        v_motivo := 'produto_desconhecido';
      end if;
    end if;

    if v_motivo is null then
      -- UPDATE com WHERE obrigatorio (compativel com safeupdate do Supabase/PostgREST).
      -- So colunas da ficha; atualizado_em/visto_em ficam com o fluxo de estoque
      -- (024 usa atualizado_em para frescor: a ficha nao pode mascarar falha de estoque).
      update public.solidcon_produtos p
      set
        ncm = x.ncm, cest = x.cest, qtd_medida = x.qtd_medida, unid_medida = x.unid_medida
      from (
        select (t.i->>'id_produto')::numeric::bigint as id_produto,
               t.i->>'ncm' as ncm,
               t.i->>'cest' as cest,
               case when jsonb_typeof(t.i->'qtd_medida') = 'number'
                    then (t.i->>'qtd_medida')::numeric end as qtd_medida,
               case when jsonb_typeof(t.i->'unid_medida') = 'string'
                    then btrim(t.i->>'unid_medida') end as unid_medida
        from jsonb_array_elements(p_itens) as t(i)
      ) x
      where p.id_produto = x.id_produto and p.presente
        and (p.ncm, p.cest, p.qtd_medida, p.unid_medida)
            is distinct from (x.ncm, x.cest, x.qtd_medida, x.unid_medida);

      get diagnostics v_atualizados = row_count;

      insert into public.solidcon_ficha_sync(status, linhas, coletado_em, execucao_id, em)
        values('ok', v_linhas, p_coletado_em, p_execucao_id, v_agora) returning id into v_log;

      return jsonb_build_object(
        'id', v_log,
        'status', 'ok',
        'linhas', v_linhas,
        'encontrados', v_encontrados,
        'atualizados', v_atualizados,
        'coletado_em', p_coletado_em,
        'execucao_id', p_execucao_id
      );
    end if;
  exception when others then
    v_motivo := 'falha_interna';
  end;

  insert into public.solidcon_ficha_sync(status, linhas, coletado_em, execucao_id, mensagem, em)
    values('erro', v_linhas, p_coletado_em, p_execucao_id, v_motivo, v_agora) returning id into v_log;

  return jsonb_build_object(
    'id', v_log,
    'status', 'erro',
    'motivo', v_motivo,
    'execucao_id', p_execucao_id
  );
end;
$$;

revoke all on function public.solidcon_receber_ficha(jsonb, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.solidcon_receber_ficha(jsonb, timestamptz, uuid) to authenticated;

-- 4. Funcao publica solidcon_ficha_publica() para anon
-- Retorna dados publicos da ficha tecnica para os produtos do catalogo:
-- produto_id, ean_pote (EAN-13 calculado a partir da familia), ean_cx24, ean_cx48, ncm, gramatura.
-- NADA de estoque, preco ou vendas.
create or replace function public.solidcon_ficha_publica()
returns table (
  produto_id text,
  ean_pote text,
  ean_cx24 text,
  ean_cx48 text,
  ncm text,
  gramatura text
)
language sql stable security definer
set search_path = pg_catalog
as $$
  with catalogo as (
    select c.id, btrim(c.codigo_erp) as codigo
    from public.catalogo_produtos c
    where c.ativo and c.removido_em is null
  ), familias_erp as (
    -- Mesma base da 024: caixas GTIN-14 -> do 2o ao 13o digito.
    select distinct p.id_produto, substring(e.ean from 2 for 12) as familia
    from public.solidcon_produtos p cross join lateral unnest(p.eans) as e(ean)
    where e.ean ~ '^[0-9]{14}$'
  ), familias_candidatas as (
    -- Familia explicita (12), EAN de pote (13) ou de caixa (14).
    select c.id, case length(c.codigo)
      when 12 then c.codigo when 13 then substring(c.codigo from 1 for 12)
      when 14 then substring(c.codigo from 2 for 12) end as familia
    from catalogo c where c.codigo ~ '^[0-9]{12,14}$'
    union
    -- Compatibilidade com id_produto e aliases EAN antigos: resolve a familia
    -- do produto explicitamente vinculado, sem inferir pelo nome.
    select c.id, f.familia
    from catalogo c join public.solidcon_produtos p
      on c.codigo <> '' and (p.id_produto::text = c.codigo or c.codigo = any(p.eans))
    join familias_erp f on f.id_produto = p.id_produto
    where c.codigo !~ '^[0-9]{12,14}$'
  ), familia_catalogo as (
    select f.id, min(f.familia) as familia from familias_candidatas f
    group by f.id having count(*) = 1
  ), familia_unica_erp as (
    -- Produto cujos GTIN-14 apontam para mais de uma familia e ambiguo: fica fora da ficha.
    select fe.id_produto, min(fe.familia) as familia
    from familias_erp fe group by fe.id_produto having count(distinct fe.familia) = 1
  ), produtos_familia as (
    select distinct c.id, f.familia, p.id_produto, p.categoria, p.ncm,
      -- Gramatura so com unidade de peso/volume e quantidade > 0; "UN"/"CX" etc. viram null.
      case
        when p.qtd_medida > 0 and upper(btrim(p.unid_medida)) in ('G', 'GR', 'KG', 'ML', 'L', 'LT') then
          trim_scale(p.qtd_medida)::text || ' ' ||
          case upper(btrim(p.unid_medida)) when 'GR' then 'g' when 'LT' then 'l'
            else lower(btrim(p.unid_medida)) end
      end as gramatura
    from catalogo c
    join familia_catalogo f on f.id = c.id
    join familia_unica_erp fe on fe.familia = f.familia
    join public.solidcon_produtos p on p.id_produto = fe.id_produto
    where p.presente
  ), eans_familia as (
    -- Somente GTIN-14 da PROPRIA familia: um produto com EANs de varias familias
    -- nao pode emprestar a caixa de outro sabor.
    select pf.id, pf.categoria, e.ean
    from produtos_familia pf
    join public.solidcon_produtos p on p.id_produto = pf.id_produto
    cross join lateral unnest(p.eans) as e(ean)
    where e.ean ~ '^[0-9]{14}$' and substring(e.ean from 2 for 12) = pf.familia
  ), ficha_espelho as (
    -- Valor ambiguo (mais de um distinto) nao e publicado: null em vez de min().
    select pf.id,
      (select case when count(distinct ef.ean) = 1 then min(ef.ean) end
         from eans_familia ef where ef.id = pf.id and ef.categoria = 'TEMPERO - CAIXA 24 UN') as ean_cx24,
      (select case when count(distinct ef.ean) = 1 then min(ef.ean) end
         from eans_familia ef where ef.id = pf.id and ef.categoria = 'TEMPERO - CAIXA 48 UN') as ean_cx48,
      case when count(distinct pf.ncm) = 1 then min(pf.ncm) end as ncm,
      case when count(distinct pf.gramatura) = 1 then min(pf.gramatura) end as gramatura
    from produtos_familia pf
    group by pf.id
  )
  select
    c.id as produto_id,
    case when f.familia ~ '^[0-9]{12}$' then
      f.familia || (
        (
          10 - (
            (
              substring(f.familia from 1 for 1)::integer * 1 +
              substring(f.familia from 2 for 1)::integer * 3 +
              substring(f.familia from 3 for 1)::integer * 1 +
              substring(f.familia from 4 for 1)::integer * 3 +
              substring(f.familia from 5 for 1)::integer * 1 +
              substring(f.familia from 6 for 1)::integer * 3 +
              substring(f.familia from 7 for 1)::integer * 1 +
              substring(f.familia from 8 for 1)::integer * 3 +
              substring(f.familia from 9 for 1)::integer * 1 +
              substring(f.familia from 10 for 1)::integer * 3 +
              substring(f.familia from 11 for 1)::integer * 1 +
              substring(f.familia from 12 for 1)::integer * 3
            ) % 10
          )
        ) % 10
      )::text
    else null end as ean_pote,
    fe.ean_cx24,
    fe.ean_cx48,
    fe.ncm,
    fe.gramatura
  from catalogo c
  left join familia_catalogo f on f.id = c.id
  left join ficha_espelho fe on fe.id = c.id
  order by c.id;
$$;

revoke all on function public.solidcon_ficha_publica() from public, anon, authenticated;
grant execute on function public.solidcon_ficha_publica() to anon, authenticated;
comment on function public.solidcon_ficha_publica() is
  'Ficha tecnica publica dos produtos do catalogo: EAN do pote (EAN-13 calculado), GTIN-14 das caixas presentes no espelho, NCM e gramatura. Sem estoque, preco ou vendas.';

commit;
