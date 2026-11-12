-- 033: coordenadas por cliente CNPJ (mapa de expansao com linha do tempo). APLICADA em 2026-11-12.
-- Instalacao manual no SQL Editor (papel postgres). Idempotente: pode rodar de novo.
-- Nao acessa o ERP, nao altera o coletor, nao altera nem apaga dados existentes.
-- Nao toca solidcon_clientes (023/027) nem solidcon_vendas_clientes (026): so le.
--
-- (A) solidcon_clientes_geo: 1 linha por CNPJ com lat/lng, precisao e chave_endereco
--     (sha256 do endereco normalizado no SERVIDOR; mudou o endereco no ERP => chave nova =>
--     cliente volta a ficar pendente). CPF NUNCA: documento so com 14 digitos (CHECK) e a RPC
--     de gravacao so aceita documento presente em solidcon_clientes com tipo='cnpj'.
-- (B) Leitura: SELECT direto so equipe (RLS eh_equipe()); anon nada.
--     Escrita: sem INSERT/UPDATE/DELETE direto para ninguem da API; so pela RPC
--     solidcon_gravar_geo_clientes (SECURITY DEFINER, search_path=pg_catalog), que exige eh_equipe().
-- (C) RPCs de leitura (SECURITY INVOKER + checagem eh_equipe(); RLS das tabelas vale junto):
--     solidcon_geo_pendentes(p_limite)  -> enderecos a geocodificar (novo / mudou / retentar)
--     solidcon_mapa_clientes()          -> 1 linha por CNPJ: pino + primeira/ultima compra +
--                                          total e agregado mensal (linha do tempo).
-- Geocodificacao: feita no navegador do admin (Nominatim, 1 req/s), nunca em lote automatico.
-- Contrato completo e politica de uso do Nominatim: admin/migracoes/LEIAME.md, secao 033.
begin;

do $$
begin
  if to_regclass('public.solidcon_clientes') is null
     or to_regclass('public.solidcon_vendas_clientes') is null
     or not exists (select 1 from pg_catalog.pg_attribute
                     where attrelid = 'public.solidcon_clientes'::regclass
                       and attname = 'cep' and not attisdropped)
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception '033 requer 023, 026 e 027 (endereco CNPJ) aplicadas e eh_equipe()/auth.uid(). Nada foi aplicado.';
  end if;
end;
$$;

-- Lock proprio (clientes=23, vendas_clientes=26).
select pg_catalog.pg_advisory_xact_lock(5100, 33);

-- ===================== (A) CHAVE DO ENDERECO =====================
-- Normalizacao: minusculas, sem acento, so [a-z0-9], espacos colapsados; campos unidos por '|'.
-- Entram: logradouro, numero, cep, bairro, cidade, estado (complemento NAO: sala/loja nao move o pino).
-- Sem logradouro, sem cep e sem bairro => NULL (nao ha o que geocodificar).
create or replace function public.solidcon_033_norm(p text)
returns text
language sql immutable
set search_path = pg_catalog
as $$
  select nullif(btrim(regexp_replace(
    translate(lower(coalesce(p, '')),
      -- Maiusculas acentuadas tambem: lower() depende do locale do banco.
      'áàâãäåéèêëíìîïóòôõöúùûüçñýÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ',
      'aaaaaaeeeeiiiiooooouuuucnyaaaaaaeeeeiiiiooooouuuucny'),
    '[^a-z0-9]+', ' ', 'g')), '');
$$;

create or replace function public.solidcon_033_chave_endereco(
  p_logradouro text, p_numero text, p_cep text, p_bairro text, p_cidade text, p_estado text
)
returns text
language sql immutable
set search_path = pg_catalog
as $$
  select case
    when public.solidcon_033_norm(p_logradouro) is null
     and public.solidcon_033_norm(p_cep) is null
     and public.solidcon_033_norm(p_bairro) is null then null
    else encode(sha256(convert_to(concat_ws('|',
      coalesce(public.solidcon_033_norm(p_logradouro), ''),
      coalesce(public.solidcon_033_norm(p_numero), ''),
      coalesce(public.solidcon_033_norm(p_cep), ''),
      coalesce(public.solidcon_033_norm(p_bairro), ''),
      coalesce(public.solidcon_033_norm(p_cidade), ''),
      coalesce(public.solidcon_033_norm(p_estado), '')), 'UTF8')), 'hex')
  end;
$$;
revoke all on function public.solidcon_033_norm(text) from public, anon, authenticated;
revoke all on function public.solidcon_033_chave_endereco(text, text, text, text, text, text)
  from public, anon, authenticated;
-- As RPCs INVOKER abaixo chamam a chave como o usuario logado: equipe precisa de EXECUTE.
grant execute on function public.solidcon_033_norm(text) to authenticated;
grant execute on function public.solidcon_033_chave_endereco(text, text, text, text, text, text) to authenticated;

-- ===================== (B) TABELA =====================
-- precisao: 'endereco' (rua+numero), 'cep', 'bairro' (centro do bairro) ou 'nao_encontrado'
-- (nenhuma tentativa achou; lat/lng NULL; evita repetir requisicoes ao Nominatim).
-- fonte: 'nominatim' (navegador do admin) ou 'manual' (correcao feita pela equipe).
-- Sem FK para solidcon_clientes: aquele espelho e trocado inteiro a cada sync (DELETE+INSERT).
-- Linha cujo CNPJ saiu do ERP fica orfa e simplesmente nao aparece no mapa (join).
create table if not exists public.solidcon_clientes_geo (
  documento text primary key check (documento ~ '^[0-9]{14}$'),
  lat numeric(9,6),
  lng numeric(9,6),
  precisao text not null check (precisao in ('endereco', 'cep', 'bairro', 'nao_encontrado')),
  fonte text not null check (fonte in ('nominatim', 'manual')),
  chave_endereco text not null check (chave_endereco ~ '^[0-9a-f]{64}$'),
  geocodificado_em timestamptz not null default now() check (isfinite(geocodificado_em)),
  geocodificado_por text check (length(geocodificado_por) between 1 and 254),
  constraint solidcon_clientes_geo_coord check (
    (precisao = 'nao_encontrado' and lat is null and lng is null)
    or (precisao <> 'nao_encontrado' and lat is not null and lng is not null
        -- Caixa do Brasil (inclui Noronha/Trindade). Faixa do RJ e checada na RPC pelo estado.
        and lat between -34 and 5.5 and lng between -74.5 and -28.5)
  )
);

alter table public.solidcon_clientes_geo enable row level security;
revoke all on public.solidcon_clientes_geo from public, anon, authenticated;
grant select on public.solidcon_clientes_geo to authenticated;
drop policy if exists solidcon_033_equipe_le on public.solidcon_clientes_geo;
create policy solidcon_033_equipe_le on public.solidcon_clientes_geo
  for select to authenticated using (public.eh_equipe());

-- ===================== (C) GRAVAR LOTE DE COORDENADAS =====================
-- p_itens: array 1..200 de objetos com EXATAMENTE:
--   documento (string 14 digitos), lat (number|null), lng (number|null),
--   precisao ('endereco'|'cep'|'bairro'|'nao_encontrado'), fonte ('nominatim'|'manual'),
--   chave_endereco (a recebida de solidcon_geo_pendentes).
-- Lote estruturalmente invalido => exception 22023 (nada gravado; mensagem sem dado do cliente).
-- Por item (lote segue): documento fora de solidcon_clientes/CNPJ, chave diferente da atual
-- (endereco mudou no meio do caminho), fora da faixa do RJ quando estado='RJ', ou precisao pior
-- que a ja gravada para o mesmo endereco => item ignorado e listado em 'ignorados'.
create or replace function public.solidcon_gravar_geo_clientes(p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
  v_doc text;
  v_lat numeric;
  v_lng numeric;
  v_prec text;
  v_fonte text;
  v_chave text;
  v_cli record;
  v_atual record;
  v_rank_novo int;
  v_rank_atual int;
  v_motivo text;
  v_gravados int := 0;
  v_ignorados jsonb := '[]'::jsonb;
  v_quem text;
  v_campos constant text[] := array['documento', 'lat', 'lng', 'precisao', 'fonte', 'chave_endereco'];
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array'
     or jsonb_array_length(p_itens) not between 1 and 200
     or octet_length(p_itens::text) > 131072 then
    raise exception 'lote invalido: array de 1 a 200 itens' using errcode = '22023';
  end if;
  if (select count(distinct value->>'documento') from jsonb_array_elements(p_itens))
     <> jsonb_array_length(p_itens) then
    raise exception 'lote invalido: documento repetido' using errcode = '22023';
  end if;

  -- Validacao estrutural de TODOS os itens antes de gravar qualquer um.
  for v_item in select value from jsonb_array_elements(p_itens) loop
    if jsonb_typeof(v_item) <> 'object' or not (v_item ?& v_campos) or (v_item - v_campos) <> '{}'::jsonb then
      raise exception 'lote invalido: campos' using errcode = '22023';
    end if;
    if jsonb_typeof(v_item->'documento') <> 'string' or (v_item->>'documento') !~ '^[0-9]{14}$' then
      -- 11 digitos (CPF) cai aqui: CPF nunca e geocodificado.
      raise exception 'lote invalido: documento (so CNPJ)' using errcode = '22023';
    end if;
    if jsonb_typeof(v_item->'precisao') <> 'string'
       or (v_item->>'precisao') not in ('endereco', 'cep', 'bairro', 'nao_encontrado')
       or jsonb_typeof(v_item->'fonte') <> 'string'
       or (v_item->>'fonte') not in ('nominatim', 'manual')
       or ((v_item->>'fonte') = 'manual' and (v_item->>'precisao') = 'nao_encontrado') then
      raise exception 'lote invalido: precisao/fonte' using errcode = '22023';
    end if;
    if jsonb_typeof(v_item->'chave_endereco') <> 'string'
       or (v_item->>'chave_endereco') !~ '^[0-9a-f]{64}$' then
      raise exception 'lote invalido: chave_endereco' using errcode = '22023';
    end if;
    if (v_item->>'precisao') = 'nao_encontrado' then
      if jsonb_typeof(v_item->'lat') <> 'null' or jsonb_typeof(v_item->'lng') <> 'null' then
        raise exception 'lote invalido: nao_encontrado exige lat/lng null' using errcode = '22023';
      end if;
    elsif jsonb_typeof(v_item->'lat') <> 'number' or jsonb_typeof(v_item->'lng') <> 'number'
       or (v_item->>'lat')::numeric not between -34 and 5.5
       or (v_item->>'lng')::numeric not between -74.5 and -28.5 then
      raise exception 'lote invalido: lat/lng devem ser numeros dentro do Brasil' using errcode = '22023';
    end if;
  end loop;

  perform pg_advisory_xact_lock(5100, 33);
  v_quem := left(nullif(auth.jwt()->>'email', ''), 254);

  for v_item in select value from jsonb_array_elements(p_itens) loop
    v_doc := v_item->>'documento';
    v_prec := v_item->>'precisao';
    v_fonte := v_item->>'fonte';
    v_chave := v_item->>'chave_endereco';
    v_lat := round((v_item->>'lat')::numeric, 6);
    v_lng := round((v_item->>'lng')::numeric, 6);
    v_motivo := null;

    select c.estado,
           public.solidcon_033_chave_endereco(c.logradouro, c.numero, c.cep, c.bairro, c.cidade, c.estado) as chave
      into v_cli
      from public.solidcon_clientes c
     where c.documento = v_doc and c.tipo = 'cnpj';

    if not found then
      v_motivo := 'cliente_inexistente';
    elsif v_cli.chave is null or v_cli.chave <> v_chave then
      v_motivo := 'endereco_mudou';
    elsif v_prec <> 'nao_encontrado' and v_cli.estado = 'RJ'
          and not (v_lat between -23.50 and -20.60 and v_lng between -45.00 and -40.80) then
      -- Homonimo de rua/bairro em outro estado: tipico do geocodificador. Nao grava.
      v_motivo := 'fora_do_rj';
    else
      select g.precisao, g.fonte, g.chave_endereco into v_atual
        from public.solidcon_clientes_geo g where g.documento = v_doc;
      if found and v_atual.chave_endereco = v_chave and v_fonte = 'nominatim' then
        v_rank_novo := case v_prec when 'endereco' then 3 when 'cep' then 2 when 'bairro' then 1 else 0 end;
        v_rank_atual := case v_atual.precisao when 'endereco' then 3 when 'cep' then 2 when 'bairro' then 1 else 0 end;
        if v_atual.fonte = 'manual' then
          v_motivo := 'correcao_manual_preservada';
        elsif v_rank_novo < v_rank_atual then
          v_motivo := 'precisao_inferior';
        end if;
      end if;
    end if;

    if v_motivo is not null then
      v_ignorados := v_ignorados || jsonb_build_object('documento', v_doc, 'motivo', v_motivo);
    else
      insert into public.solidcon_clientes_geo as g
        (documento, lat, lng, precisao, fonte, chave_endereco, geocodificado_em, geocodificado_por)
      values (v_doc, v_lat, v_lng, v_prec, v_fonte, v_chave, now(), v_quem)
      on conflict (documento) do update set
        lat = excluded.lat, lng = excluded.lng, precisao = excluded.precisao, fonte = excluded.fonte,
        chave_endereco = excluded.chave_endereco, geocodificado_em = excluded.geocodificado_em,
        geocodificado_por = excluded.geocodificado_por;
      v_gravados := v_gravados + 1;
    end if;
  end loop;

  return jsonb_build_object('status', 'ok', 'gravados', v_gravados, 'ignorados', v_ignorados);
end;
$$;
revoke all on function public.solidcon_gravar_geo_clientes(jsonb) from public, anon, authenticated;
grant execute on function public.solidcon_gravar_geo_clientes(jsonb) to authenticated;

-- ===================== (D) PENDENTES DE GEOCODIFICACAO =====================
-- CNPJ com endereco e: sem coordenada ('novo'), chave diferente da gravada ('mudou'), ou
-- 'nao_encontrado' ha mais de 30 dias ('retentar'). Clientes que mais compraram vem primeiro.
-- Devolve so o necessario para montar a consulta (sem nome, telefone, e-mail).
create or replace function public.solidcon_geo_pendentes(p_limite integer default 100)
returns table (
  documento text, logradouro text, numero text, cep text, bairro text, cidade text, estado text,
  chave_endereco text, motivo text
)
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  if p_limite is null or p_limite not between 1 and 500 then
    raise exception 'p_limite deve ficar entre 1 e 500' using errcode = '22023';
  end if;
  return query
  with c as (
    select cl.documento, cl.logradouro, cl.numero, cl.cep, cl.bairro, cl.cidade, cl.estado,
           public.solidcon_033_chave_endereco(cl.logradouro, cl.numero, cl.cep, cl.bairro, cl.cidade, cl.estado) as chave
      from public.solidcon_clientes cl
     where cl.tipo = 'cnpj'
  ), v as (
    select vc.documento, sum(vc.valor_centavos) as total
      from public.solidcon_vendas_clientes vc
     where vc.tipo = 'cnpj'
     group by vc.documento
  )
  select c.documento, c.logradouro, c.numero, c.cep, c.bairro, c.cidade, c.estado, c.chave,
         case when g.documento is null then 'novo'
              when g.chave_endereco <> c.chave then 'mudou'
              else 'retentar' end
    from c
    left join public.solidcon_clientes_geo g on g.documento = c.documento
    left join v on v.documento = c.documento
   where c.chave is not null
     and (g.documento is null
          or g.chave_endereco <> c.chave
          or (g.precisao = 'nao_encontrado' and g.fonte = 'nominatim'
              and g.geocodificado_em < now() - interval '30 days'))
   order by coalesce(v.total, 0) desc, c.documento
   limit p_limite;
end;
$$;
revoke all on function public.solidcon_geo_pendentes(integer) from public, anon, authenticated;
grant execute on function public.solidcon_geo_pendentes(integer) to authenticated;

-- ===================== (E) LEITURA DO MAPA =====================
-- 1 linha por cliente CNPJ do espelho (com ou sem pino, com ou sem compra).
-- lat/lng/precisao so quando a coordenada e do endereco ATUAL (chave igual); senao NULL
-- e 'pino_desatualizado'=true (o mapa pode mostrar o pino antigo esmaecido ou esconder).
-- meses: objeto {"AAAA-MM": [centavos, cupons], ...} (dia de America/Sao_Paulo da venda,
-- mesmo 'dia' da 026). Janela = retencao da 026 (400 dias): primeira_compra e a primeira
-- DENTRO da janela, nao a primeira da historia do cliente.
create or replace function public.solidcon_mapa_clientes()
returns table (
  documento text, nome text, bairro text, cidade text, estado text,
  lat numeric, lng numeric, precisao text, pino_desatualizado boolean,
  primeira_compra date, ultima_compra date, total_centavos bigint, cupons integer, meses jsonb
)
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  return query
  with m as (
    select vc.documento, to_char(vc.dia, 'YYYY-MM') as mes,
           sum(vc.valor_centavos) as centavos, count(*) as qtd,
           min(vc.dia) as d_min, max(vc.dia) as d_max
      from public.solidcon_vendas_clientes vc
     where vc.tipo = 'cnpj'
     group by vc.documento, to_char(vc.dia, 'YYYY-MM')
  ), a as (
    select m.documento, min(m.d_min) as primeira, max(m.d_max) as ultima,
           sum(m.centavos)::bigint as total, sum(m.qtd)::integer as qtd,
           jsonb_object_agg(m.mes, jsonb_build_array(m.centavos::bigint, m.qtd::integer)) as meses
      from m group by m.documento
  )
  select c.documento, c.nome, c.bairro, c.cidade, c.estado,
         case when ok then g.lat end, case when ok then g.lng end,
         case when ok then g.precisao end,
         (g.documento is not null and not ok),
         a.primeira, a.ultima, coalesce(a.total, 0), coalesce(a.qtd, 0),
         coalesce(a.meses, '{}'::jsonb)
    from public.solidcon_clientes c
    left join public.solidcon_clientes_geo g on g.documento = c.documento
    left join a on a.documento = c.documento
    cross join lateral (select coalesce(g.chave_endereco =
      public.solidcon_033_chave_endereco(c.logradouro, c.numero, c.cep, c.bairro, c.cidade, c.estado), false) as ok) k
   where c.tipo = 'cnpj'
   order by c.documento;
end;
$$;
revoke all on function public.solidcon_mapa_clientes() from public, anon, authenticated;
grant execute on function public.solidcon_mapa_clientes() to authenticated;

commit;
