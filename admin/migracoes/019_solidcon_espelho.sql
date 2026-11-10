-- 019_solidcon_espelho.sql: JA APLICADA em producao como 012 de A. Renomeacao documental: NAO REAPLICAR.
-- Reaplicar 019 substitui solidcon_receber_produtos pela versao anterior a 020, interrompendo historico e eventos.
-- Corpo original preservado; numeros antigos abaixo sao historicos.
-- 012: espelho isolado. Nao consulta/escreve no ERP nem altera o catalogo do site.
-- Aplicacao manual futura; requer os helpers de papeis de PRODUCAO e auth.users.
begin;

do $$
begin
  if to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('public.eh_admin()') is null then
    raise exception '012 requer public.eh_equipe() e public.eh_admin() de producao. Nao reaplicar admin/supabase.sql: ele nao representa a separacao de papeis implantada.';
  end if;
end;
$$;

create table if not exists public.solidcon_produtos (
  id_produto bigint primary key check (id_produto > 0),
  id_loja integer not null check (id_loja = 4),
  nome text not null,
  categoria text not null check (categoria in ('TEMPERO - CAIXA 24 UN', 'TEMPERO - CAIXA 48 UN')),
  emb text not null,
  preco_centavos bigint not null check (preco_centavos >= 0),
  estoque_disponivel numeric not null check (estoque_disponivel >= 0 and estoque_disponivel <> 'NaN'::numeric),
  eans text[] not null,
  presente boolean not null default true,
  dtalteracao_erp timestamptz,
  visto_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.solidcon_sync (
  id bigint generated always as identity primary key,
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz not null default now(),
  status text not null check (status in ('ok', 'erro', 'teste')),
  qtd_recebida integer not null default 0,
  qtd_presente integer not null default 0,
  mensagem text
);

create table if not exists public.integracoes_autorizadas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  criado_em timestamptz not null default now()
);

-- Nullable para preservar logs legados; novos snapshots exigem ambos na RPC.
alter table public.solidcon_sync
  add column if not exists coletado_em timestamptz,
  add column if not exists execucao_id uuid;
create index if not exists solidcon_sync_ultimo_snapshot_idx
  on public.solidcon_sync (coletado_em desc)
  where status = 'ok' and coletado_em is not null;
create unique index if not exists solidcon_sync_execucao_ok_idx
  on public.solidcon_sync (execucao_id)
  where status = 'ok' and execucao_id is not null;

alter table public.solidcon_produtos enable row level security;
alter table public.solidcon_sync enable row level security;
alter table public.integracoes_autorizadas enable row level security;

-- Nenhuma escrita direta, nem para admin. Cadastro da identidade via SQL owner.
revoke all on public.solidcon_produtos, public.solidcon_sync, public.integracoes_autorizadas from public, anon, authenticated;
revoke all on sequence public.solidcon_sync_id_seq from public, anon, authenticated;
grant select on public.solidcon_produtos, public.solidcon_sync, public.integracoes_autorizadas to authenticated;
drop policy if exists solidcon_admin_le on public.solidcon_produtos;
create policy solidcon_admin_le on public.solidcon_produtos for select to authenticated using (public.eh_equipe());
drop policy if exists solidcon_admin_le on public.solidcon_sync;
create policy solidcon_admin_le on public.solidcon_sync for select to authenticated using (public.eh_equipe());
drop policy if exists solidcon_admin_le on public.integracoes_autorizadas;
create policy solidcon_admin_le on public.integracoes_autorizadas for select to authenticated using (public.eh_admin());

-- Remover a assinatura antiga para nao deixar uma RPC sem as novas travas.
drop function if exists public.solidcon_receber_produtos(jsonb);
create or replace function public.solidcon_receber_produtos(
  p_itens jsonb, p_coletado_em timestamptz, p_execucao_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
  v_ean jsonb;
  v_inicio timestamptz := clock_timestamp();
  v_total integer;
  v_log bigint;
  v_presentes bigint;
  v_ultimo_coletado timestamptz;
  v_agora timestamptz;
  v_motivo text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.integracoes_autorizadas where user_id = auth.uid()
  ) then
    raise exception 'integracao nao autorizada' using errcode = '42501';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'p_itens deve ser array';
  end if;
  v_total := jsonb_array_length(p_itens);
  if v_total > 2000 or octet_length(p_itens::text) > 4194304 then
    raise exception 'payload fora dos limites (1..2000 itens, 4 MiB)';
  end if;

  for v_item in select value from jsonb_array_elements(p_itens) loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ?& array['id_produto','id_loja','nome','categoria','emb','preco_centavos','estoque_disponivel','eans','dtalteracao_erp']) then
      raise exception 'item incompleto';
    end if;
    if jsonb_typeof(v_item->'id_produto') <> 'number'
       or (v_item->>'id_produto') !~ '^[1-9][0-9]{0,18}$'
       or jsonb_typeof(v_item->'id_loja') <> 'number'
       or (v_item->>'id_loja') <> '4'
       or jsonb_typeof(v_item->'preco_centavos') <> 'number'
       or (v_item->>'preco_centavos') !~ '^[0-9]{1,19}$'
       or jsonb_typeof(v_item->'estoque_disponivel') <> 'number' then
      raise exception 'identificador, filial, preco ou estoque invalido';
    end if;
    -- Casts tambem recusam overflow; nenhuma alteracao sobrevive a uma excecao.
    perform (v_item->>'id_produto')::bigint, (v_item->>'preco_centavos')::bigint;
    -- Origem ERP pode ser negativa; o coletor envia max(qtd_produto, 0).
    if (v_item->>'estoque_disponivel')::numeric < 0 then
      raise exception 'estoque negativo';
    end if;
    if jsonb_typeof(v_item->'nome') <> 'string' or length(v_item->>'nome') not between 1 and 1000
       or jsonb_typeof(v_item->'categoria') <> 'string'
       or (v_item->>'categoria') not in ('TEMPERO - CAIXA 24 UN','TEMPERO - CAIXA 48 UN')
       or jsonb_typeof(v_item->'emb') <> 'string' or length(v_item->>'emb') > 100 then
      raise exception 'nome, categoria ou embalagem invalida';
    end if;
    if jsonb_typeof(v_item->'eans') <> 'array' then
      raise exception 'eans deve ser array de texto';
    end if;
    if jsonb_array_length(v_item->'eans') not between 1 and 100 then
      raise exception 'quantidade de EANs invalida';
    end if;
    for v_ean in select value from jsonb_array_elements(v_item->'eans') loop
      if jsonb_typeof(v_ean) <> 'string' or (v_ean #>> '{}') !~ '^[0-9]{1,32}$' then
        raise exception 'EAN invalido (usar texto de digitos)';
      end if;
    end loop;
    if jsonb_typeof(v_item->'dtalteracao_erp') <> 'null' then
      if jsonb_typeof(v_item->'dtalteracao_erp') <> 'string'
         or (v_item->>'dtalteracao_erp') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$' then
        raise exception 'data ERP deve incluir fuso';
      end if;
      perform (v_item->>'dtalteracao_erp')::timestamptz;
    end if;
  end loop;
  if (select count(distinct (value->>'id_produto')::bigint) from jsonb_array_elements(p_itens)) <> v_total then
    raise exception 'id_produto duplicado';
  end if;

  -- Serializa snapshots concorrentes; lock liberado automaticamente na transacao.
  perform pg_advisory_xact_lock(5100, 4);
  v_agora := clock_timestamp();
  -- Ambos os lados comparam produtos distintos da UNIAO com/sem saldo.
  select count(*) into v_presentes from public.solidcon_produtos where presente = true;
  select max(coletado_em) into v_ultimo_coletado from public.solidcon_sync where status = 'ok';
  if p_execucao_id is null then
    v_motivo := 'execucao_invalida';
  elsif p_coletado_em is null or not isfinite(p_coletado_em)
     or p_coletado_em < v_agora - interval '24 hours'
     or p_coletado_em > v_agora + interval '5 minutes' then
    v_motivo := 'coleta_fora_da_janela';
  elsif v_ultimo_coletado is not null and p_coletado_em <= v_ultimo_coletado then
    v_motivo := 'snapshot_antigo';
  elsif exists (select 1 from public.solidcon_sync where status = 'ok' and execucao_id = p_execucao_id) then
    v_motivo := 'execucao_repetida';
  elsif v_total = 0 then
    v_motivo := 'snapshot_vazio';
  elsif v_presentes > 0 and v_total::numeric < v_presentes::numeric * 0.5 then
    v_motivo := 'queda_superior_50';
  end if;
  if v_motivo is not null then
    -- Retorno de negocio, sem RAISE: uma excecao reverteria tambem este log.
    -- Nenhuma escrita no espelho nem no ultimo snapshot aceito ocorre aqui.
    insert into public.solidcon_sync (
      iniciado_em, concluido_em, status, qtd_recebida, qtd_presente,
      mensagem, coletado_em, execucao_id
    ) values (
      v_inicio, clock_timestamp(), 'erro', v_total, v_presentes::integer,
      v_motivo, p_coletado_em, p_execucao_id
    ) returning id into v_log;
    return jsonb_build_object(
      'id', v_log, 'status', 'erro', 'motivo', v_motivo,
      'qtd_recebida', v_total, 'qtd_presente', v_presentes, 'execucao_id', p_execucao_id
    );
  end if;

  insert into public.solidcon_produtos as destino (
    id_produto, id_loja, nome, categoria, emb, preco_centavos, estoque_disponivel,
    eans, presente, dtalteracao_erp, visto_em, atualizado_em
  )
  select (i->>'id_produto')::bigint, (i->>'id_loja')::integer,
    i->>'nome', i->>'categoria', i->>'emb', (i->>'preco_centavos')::bigint,
    (i->>'estoque_disponivel')::numeric,
    array(select distinct e from jsonb_array_elements_text(i->'eans') as t(e) order by e),
    true, (i->>'dtalteracao_erp')::timestamptz, v_inicio, v_inicio
  from jsonb_array_elements(p_itens) as t(i)
  on conflict (id_produto) do update set
    id_loja = excluded.id_loja, nome = excluded.nome, categoria = excluded.categoria,
    emb = excluded.emb, preco_centavos = excluded.preco_centavos,
    estoque_disponivel = excluded.estoque_disponivel, eans = excluded.eans,
    presente = true, dtalteracao_erp = excluded.dtalteracao_erp,
    visto_em = excluded.visto_em, atualizado_em = excluded.atualizado_em;

  -- Ausente das DUAS listas = saiu do conjunto ativo (nao apenas esgotou).
  -- Esgotado continua presente=true, com estoque_disponivel=0 no upsert acima.
  update public.solidcon_produtos as p
     set presente = false, estoque_disponivel = 0, atualizado_em = v_inicio
   where (p.presente or p.estoque_disponivel <> 0) and not exists (
     select 1 from jsonb_array_elements(p_itens) as t(i)
     where (i->>'id_produto')::bigint = p.id_produto
   );
  insert into public.solidcon_sync (
    iniciado_em, concluido_em, status, qtd_recebida, qtd_presente, coletado_em, execucao_id
  ) values (v_inicio, clock_timestamp(), 'ok', v_total, v_total, p_coletado_em, p_execucao_id)
    returning id into v_log;
  return jsonb_build_object(
    'id', v_log, 'status', 'ok', 'qtd_recebida', v_total, 'qtd_presente', v_total,
    'coletado_em', p_coletado_em, 'execucao_id', p_execucao_id
  );
end;
$$;

create or replace function public.solidcon_registrar_falha(p_msg text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.integracoes_autorizadas where user_id = auth.uid()
  ) then
    raise exception 'integracao nao autorizada' using errcode = '42501';
  end if;
  insert into public.solidcon_sync(status, mensagem)
    values ('erro', left(coalesce(p_msg, 'falha sem detalhe'), 500));
end;
$$;

revoke all on function public.solidcon_receber_produtos(jsonb, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.solidcon_registrar_falha(text) from public, anon, authenticated;
grant execute on function public.solidcon_receber_produtos(jsonb, timestamptz, uuid) to authenticated;
grant execute on function public.solidcon_registrar_falha(text) to authenticated;
commit;
