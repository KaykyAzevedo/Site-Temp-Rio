-- 020_solidcon_historico.sql: JA APLICADA em producao como 017 de A. Renomeacao documental: NAO REAPLICAR.
-- Corpo original preservado; numeros antigos abaixo sao historicos.
-- 017: historico e eventos do espelho. Nao altera script, ERP ou catalogo.
-- Independente das 013-016 do outro repo; todos os objetos novos usam solidcon_.
begin;

do $$
begin
  if to_regclass('public.solidcon_produtos') is null
     or to_regclass('public.solidcon_sync') is null
     or to_regclass('public.integracoes_autorizadas') is null
     or to_regprocedure('public.solidcon_receber_produtos(jsonb,timestamp with time zone,uuid)') is null
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('public.eh_admin()') is null then
    raise exception '017 requer a 012 aplicada (espelho, sync, autorizacoes, RPC de 3 argumentos) e os helpers eh_equipe()/eh_admin() de producao. Nenhuma alteracao foi aplicada.';
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute
                 where attrelid = 'public.solidcon_sync'::regclass
                   and attname = 'coletado_em' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute
                     where attrelid = 'public.solidcon_sync'::regclass
                       and attname = 'execucao_id' and not attisdropped) then
    raise exception '017 requer a 012 completa: solidcon_sync.coletado_em e execucao_id ausentes. Nenhuma alteracao foi aplicada.';
  end if;
end;
$$;

-- Mesmo lock da coleta: terminar snapshots ativos antes de instalar a extensao.
select pg_catalog.pg_advisory_xact_lock(5100, 4);

create table if not exists public.solidcon_estoque_diario (
  dia date not null,
  id_produto bigint not null check (id_produto > 0),
  estoque_disponivel numeric not null
    check (estoque_disponivel >= 0 and estoque_disponivel <> 'NaN'::numeric),
  preco_centavos bigint not null check (preco_centavos >= 0),
  presente boolean not null,
  atualizado_em timestamptz not null default now(),
  primary key (dia, id_produto)
);

create table if not exists public.solidcon_eventos (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  id_produto bigint not null check (id_produto > 0),
  nome text not null,
  tipo text not null check (tipo in (
    'produto_novo', 'esgotou', 'voltou_estoque', 'estoque_baixo',
    'preco_mudou', 'sumiu', 'reapareceu'
  )),
  valor_antes numeric,
  valor_depois numeric,
  coletado_em timestamptz not null
);
create index if not exists solidcon_eventos_em_idx on public.solidcon_eventos (em desc);
create index if not exists solidcon_eventos_produto_em_idx
  on public.solidcon_eventos (id_produto, em desc);

create table if not exists public.solidcon_config (
  id smallint primary key default 1 constraint solidcon_config_linha_unica check (id = 1),
  limite_estoque_baixo integer not null default 5 check (limite_estoque_baixo >= 0),
  atualizado_em timestamptz not null default now()
);
insert into public.solidcon_config (id) values (1) on conflict (id) do nothing;

alter table public.solidcon_estoque_diario enable row level security;
alter table public.solidcon_eventos enable row level security;
alter table public.solidcon_config enable row level security;
revoke all on public.solidcon_estoque_diario, public.solidcon_eventos, public.solidcon_config
  from public, anon, authenticated;
revoke all on sequence public.solidcon_eventos_id_seq from public, anon, authenticated;
grant select on public.solidcon_estoque_diario, public.solidcon_eventos, public.solidcon_config
  to authenticated;
drop policy if exists solidcon_017_equipe_le on public.solidcon_estoque_diario;
create policy solidcon_017_equipe_le on public.solidcon_estoque_diario
  for select to authenticated using (public.eh_equipe());
drop policy if exists solidcon_017_equipe_le on public.solidcon_eventos;
create policy solidcon_017_equipe_le on public.solidcon_eventos
  for select to authenticated using (public.eh_equipe());
drop policy if exists solidcon_017_equipe_le on public.solidcon_config;
create policy solidcon_017_equipe_le on public.solidcon_config
  for select to authenticated using (public.eh_equipe());


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
  v_limite integer;
  v_dia date;
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

  -- INICIO EXTENSAO 017: somente snapshots aprovados chegam aqui.
  select limite_estoque_baixo into v_limite
    from public.solidcon_config where id = 1;
  if not found then
    raise exception '017: linha unica de solidcon_config ausente';
  end if;
  v_dia := (p_coletado_em at time zone 'America/Sao_Paulo')::date;

  -- Comparar ANTES de alterar o espelho: baseline e a tabela da 012, nao o
  -- historico vazio. Primeira coleta da 017 nao transforma existentes em novos.
  with recebido as (
    select (i->>'id_produto')::bigint as id_produto, i->>'nome' as nome,
      (i->>'estoque_disponivel')::numeric as estoque,
      (i->>'preco_centavos')::bigint as preco
    from jsonb_array_elements(p_itens) as t(i)
  )
  insert into public.solidcon_eventos (
    em, id_produto, nome, tipo, valor_antes, valor_depois, coletado_em
  )
  select v_agora, n.id_produto, n.nome, e.tipo, e.antes, e.depois, p_coletado_em
    from recebido n
    left join public.solidcon_produtos a on a.id_produto = n.id_produto
    cross join lateral (values
      ('produto_novo', null::numeric, n.estoque, a.id_produto is null),
      ('esgotou', a.estoque_disponivel, n.estoque,
        a.presente and a.estoque_disponivel > 0 and n.estoque = 0),
      ('voltou_estoque', a.estoque_disponivel, n.estoque,
        a.presente and a.estoque_disponivel = 0 and n.estoque > 0),
      ('estoque_baixo', a.estoque_disponivel, n.estoque,
        a.presente and a.estoque_disponivel > v_limite
          and n.estoque <= v_limite and n.estoque > 0),
      ('preco_mudou', a.preco_centavos::numeric, n.preco::numeric,
        a.id_produto is not null and a.preco_centavos is distinct from n.preco),
      ('reapareceu', 0::numeric, 1::numeric,
        a.id_produto is not null and not a.presente)
    ) as e(tipo, antes, depois, gerar)
   where e.gerar;

  -- Ausencia nao prova falta de saldo: registrar sumiu, sem esgotou artificial.
  insert into public.solidcon_eventos (
    em, id_produto, nome, tipo, valor_antes, valor_depois, coletado_em
  )
  select v_agora, a.id_produto, a.nome, 'sumiu', 1, 0, p_coletado_em
    from public.solidcon_produtos a
   where a.presente and not exists (
     select 1 from jsonb_array_elements(p_itens) as t(i)
      where (i->>'id_produto')::bigint = a.id_produto
   );
  -- FIM EVENTOS 017; upsert e ausencia originais da 012 seguem abaixo.


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
  -- Foto final do espelho inteiro, inclusive ausentes, apos upsert/ausencia.
  -- PK ja inicia por dia e atende tambem a remocao dos dias antigos.
  insert into public.solidcon_estoque_diario (
    dia, id_produto, estoque_disponivel, preco_centavos, presente, atualizado_em
  )
  select v_dia, p.id_produto, p.estoque_disponivel, p.preco_centavos, p.presente, v_agora
    from public.solidcon_produtos p
  on conflict (dia, id_produto) do update set
    estoque_disponivel = excluded.estoque_disponivel,
    preco_centavos = excluded.preco_centavos,
    presente = excluded.presente,
    atualizado_em = excluded.atualizado_em;
  -- Mantem hoje e os 400 dias anteriores; 400 exatos ficam, 401 saem.
  delete from public.solidcon_estoque_diario
   where dia < (v_agora at time zone 'America/Sao_Paulo')::date - 400;
  -- FIM EXTENSAO 017; log/retorno originais seguem inalterados.


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

-- Sem UPDATE direto, inclusive admin: operacao estreita via RPC autorizada.
create or replace function public.solidcon_definir_limite(p_limite integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null or not coalesce(public.eh_admin(), false) then
    raise exception 'somente admin pode definir limite SOLIDCON' using errcode = '42501';
  end if;
  if p_limite is null or p_limite < 0 then
    raise exception 'limite de estoque baixo deve ser inteiro >= 0';
  end if;
  perform pg_advisory_xact_lock(5100, 4);
  update public.solidcon_config
     set limite_estoque_baixo = p_limite, atualizado_em = clock_timestamp()
   where id = 1;
  if not found then
    raise exception '017: linha unica de solidcon_config ausente';
  end if;
  return p_limite;
end;
$$;

revoke all on function public.solidcon_definir_limite(integer) from public, anon, authenticated;
grant execute on function public.solidcon_definir_limite(integer) to authenticated;
revoke all on function public.solidcon_receber_produtos(jsonb, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.solidcon_receber_produtos(jsonb, timestamptz, uuid) to authenticated;
commit;
