-- 041: FORNECEDOR nao e cliente (decisao do dono com o Marcio, 2026-11-16).
-- NAO APLICADA. Instalacao manual no SQL Editor (papel postgres). Idempotente: pode rodar de novo.
-- O ERP mistura clientes e fornecedores no mesmo cadastro (solidcon_clientes) e e SO LEITURA. Aqui fica a
-- marcacao do lado do painel: documento marcado = fornecedor = some do mapa, das listas e das contagens de clientes.
-- Os documentos NAO estao neste arquivo (repositorio publico): o Tech Lead insere pelo SQL Editor ou o admin marca no painel.
-- Requer 033 (solidcon_geo_pendentes), 037 (solidcon_mapa_clientes, solidcon_geo_corrigir_erp, solidcon_interessados),
-- eh_admin()/eh_equipe(). Independente de 038, 039 e 040.
-- (1) solidcon_fornecedores: documento (so digitos, 11..14), observacao (<= 200), marcado_em/marcado_por (gatilho).
--     RLS: leitura (select eh_equipe()); insert/delete so (select eh_admin()); sem update; anon sem grant.
-- (2) As 4 funcoes que listam clientes do ERP sao recriadas a partir do texto ATUAL (033/037), mudando SO o filtro
--     "not exists em solidcon_fornecedores". Mesmas assinaturas, retorno, SECURITY INVOKER, search_path e grants:
--       solidcon_geo_pendentes  - fornecedor nao e geocodificado;
--       solidcon_mapa_clientes  - fornecedor nao vira pino nem conta no mapa;
--       solidcon_rota_posicoes  - NOVA: posicao atual por documento para a Rota/WhatsApp, SEM filtro de fornecedor;
--       solidcon_geo_corrigir_erp - fornecedor nao aparece em "Corrigir no ERP";
--       solidcon_interessados   - fornecedor nao vira "interessado" e o ponto dele nao entra na media de posicao.
-- Pedido do ERP de fornecedor (solidcon_pedidos_erp) NAO e filtrado: e pedido real e continua no Kanban.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('public.eh_admin()') is null or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('auth.uid()') is null
     or to_regclass('public.solidcon_clientes') is null
     or to_regprocedure('public.solidcon_geo_pendentes(integer)') is null
     or to_regprocedure('public.solidcon_mapa_clientes()') is null
     or to_regprocedure('public.solidcon_geo_corrigir_erp()') is null
     or to_regprocedure('public.solidcon_interessados()') is null
     or to_regprocedure('public.solidcon_037_avaliacao()') is null then
    raise exception '041 requer 033 e 037 (funcoes do mapa) e eh_admin()/eh_equipe(). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 41);

-- ===================== (1) solidcon_fornecedores =====================
create table if not exists public.solidcon_fornecedores (
  documento text primary key check (documento ~ '^[0-9]{11,14}$'),
  observacao text check (observacao is null or char_length(observacao) <= 200),
  marcado_em timestamptz not null default now(),
  marcado_por uuid
);

-- Carimbo de quem/quando (funcao de gatilho: ninguem precisa de EXECUTE).
create or replace function public.solidcon_041_fornecedor_carimbar()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.marcado_em := now();
  new.marcado_por := auth.uid();
  new.observacao := nullif(btrim(new.observacao), '');
  return new;
end;
$$;
revoke all on function public.solidcon_041_fornecedor_carimbar() from public, anon, authenticated;

drop trigger if exists solidcon_041_fornecedor_carimbar on public.solidcon_fornecedores;
create trigger solidcon_041_fornecedor_carimbar before insert on public.solidcon_fornecedores
  for each row execute function public.solidcon_041_fornecedor_carimbar();

alter table public.solidcon_fornecedores enable row level security;
revoke all on public.solidcon_fornecedores from public, anon, authenticated;
grant select, insert, delete on public.solidcon_fornecedores to authenticated;

drop policy if exists solidcon_041_equipe_le on public.solidcon_fornecedores;
create policy solidcon_041_equipe_le on public.solidcon_fornecedores for select to authenticated
  using ((select public.eh_equipe()));
drop policy if exists solidcon_041_admin_insere on public.solidcon_fornecedores;
create policy solidcon_041_admin_insere on public.solidcon_fornecedores for insert to authenticated
  with check ((select public.eh_admin()));
drop policy if exists solidcon_041_admin_apaga on public.solidcon_fornecedores;
create policy solidcon_041_admin_apaga on public.solidcon_fornecedores for delete to authenticated
  using ((select public.eh_admin()));

-- ===================== (2) funcoes sem fornecedores =====================
-- (texto da 033)
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
       and not exists (select 1 from public.solidcon_fornecedores f where f.documento = cl.documento)   -- 041: fornecedor nao e geocodificado
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

-- (texto da 037)
create or replace function public.solidcon_mapa_clientes()
returns table (
  documento text, nome text, bairro text, cidade text, estado text,
  lat numeric, lng numeric, precisao text, pino_desatualizado boolean,
  primeira_compra date, ultima_compra date, total_centavos bigint, cupons integer, meses jsonb,
  qualidade text, motivos text[]
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
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
         coalesce(a.meses, '{}'::jsonb),
         q.qualidade, q.motivos
    from public.solidcon_clientes c
    left join public.solidcon_clientes_geo g on g.documento = c.documento
    left join a on a.documento = c.documento
    left join public.solidcon_037_avaliacao() q on q.documento = c.documento
    cross join lateral (select coalesce(g.chave_endereco =
      public.solidcon_033_chave_endereco(c.logradouro, c.numero, c.cep, c.bairro, c.cidade, c.estado), false) as ok) k
   where c.tipo = 'cnpj'
     and not exists (select 1 from public.solidcon_fornecedores f where f.documento = c.documento)   -- 041: fornecedor nao e cliente
   order by c.documento;
end;
$$;
revoke all on function public.solidcon_mapa_clientes() from public, anon, authenticated;
grant execute on function public.solidcon_mapa_clientes() to authenticated;

-- Rota do dia (js/admin-rota.js) e WhatsApp (042): posicao ATUAL dos clientes COM PEDIDO PENDENTE, por documento.
-- Fonte independente do filtro comercial: NAO exclui fornecedor (pedido de fornecedor e pedido real e precisa de
-- posicao para a ordem da rota e para a regra do CEASA por raio). Mesma validacao de pino do mapa: so devolve
-- lat/lng quando a chave_endereco do pino e a do endereco ATUAL do cadastro (033/037).
-- Equipe logada (painel) ou service_role (Edge Function whatsapp-rotinas). Ate 2000 documentos por chamada.
create or replace function public.solidcon_rota_posicoes(p_documentos text[])
returns table (
  documento text, nome text, logradouro text, numero text, complemento text, bairro text, cidade text, estado text,
  lat numeric, lng numeric, precisao text, pino_desatualizado boolean
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if current_user <> 'service_role' and (auth.uid() is null or not coalesce(public.eh_equipe(), false)) then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_documentos, '{}')) > 2000 then
    raise exception 'no maximo 2000 documentos por chamada' using errcode = '22023';
  end if;
  return query
  select c.documento, c.nome, c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.estado,
         case when ok then g.lat end, case when ok then g.lng end, case when ok then g.precisao end,
         (g.documento is not null and not ok)
    from public.solidcon_clientes c
    left join public.solidcon_clientes_geo g on g.documento = c.documento
    cross join lateral (select coalesce(g.chave_endereco =
      public.solidcon_033_chave_endereco(c.logradouro, c.numero, c.cep, c.bairro, c.cidade, c.estado), false) as ok) k
   where c.documento = any (coalesce(p_documentos, '{}'))
   order by c.documento;
end;
$$;
revoke all on function public.solidcon_rota_posicoes(text[]) from public, anon, authenticated;
grant execute on function public.solidcon_rota_posicoes(text[]) to authenticated, service_role;

create or replace function public.solidcon_geo_corrigir_erp()
returns table (
  documento text, nome text, logradouro text, numero text, cep text, bairro text, cidade text, estado text,
  qualidade text, motivos text[]
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  return query
  select c.documento, c.nome, c.logradouro, c.numero, c.cep, c.bairro, c.cidade, c.estado, q.qualidade, q.motivos
    from public.solidcon_037_avaliacao() q
    join public.solidcon_clientes c on c.documento = q.documento
   where not exists (select 1 from public.solidcon_fornecedores f where f.documento = c.documento)   -- 041
     and (q.qualidade = 'sem_localizacao'
      or q.motivos && array['cnpj_invalido', 'sem_cep', 'cep_invalido', 'cep_fora_da_uf', 'sem_logradouro']::text[])
   order by (q.qualidade = 'sem_localizacao') desc, c.nome, c.documento;
end;
$$;
revoke all on function public.solidcon_geo_corrigir_erp() from public, anon, authenticated;
grant execute on function public.solidcon_geo_corrigir_erp() to authenticated;

create or replace function public.solidcon_interessados()
returns table (
  origem text, chave text, nome text, documento_mascarado text,
  cep text, bairro text, cidade text, uf text,
  lat numeric, lng numeric, precisao text,
  primeiro_contato timestamptz, ultimo_contato timestamptz, contatos integer,
  ultimo_status text, valor_centavos bigint
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_vinculados text[] := '{}';
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  -- 034 e opcional: sem ela, so a venda no ERP pelo CNPJ decide "comprou".
  if to_regclass('public.pedidos_erp_vinculo') is not null then
    execute $q$
      select coalesce(array_agg(distinct regexp_replace(p.cnpj, '[^0-9]', '', 'g')), '{}')
        from public.pedidos p join public.pedidos_erp_vinculo v on v.pedido_id = p.id
    $q$ into v_vinculados;
  end if;

  return query
  with brutos as (
    select 'pedido_site'::text as origem, regexp_replace(coalesce(p.cnpj, ''), '[^0-9]', '', 'g') as doc,
           p.id as ref, p.razao_social as nome_, regexp_replace(coalesce(p.cep, ''), '[^0-9]', '', 'g') as cep_,
           nullif(btrim(p.bairro), '') as bairro_, nullif(btrim(p.cidade), '') as cidade_,
           upper(nullif(btrim(p.uf), '')) as uf_, p.criado_em as em, p.status as status_,
           p.valor_centavos as valor
      from public.pedidos p
     where p.status is distinct from 'teste'
    union all
    select 'lista_espera', regexp_replace(coalesce(e.cnpj, ''), '[^0-9]', '', 'g'),
           e.id, e.razao_social, regexp_replace(coalesce(e.cep, ''), '[^0-9]', '', 'g'),
           null, nullif(btrim(e.cidade), ''), upper(nullif(btrim(e.uf), '')), e.criado_em,
           case when e.atendido then 'atendido' else 'aguardando' end, e.valor_centavos
      from public.lista_espera e
  ), nao_compraram as (
    select b.* from brutos b
     where b.doc ~ '^[0-9]{14}$'
       and b.doc <> all (v_vinculados)
       and not exists (select 1 from public.solidcon_vendas_clientes vc
                        where vc.documento = b.doc and vc.tipo = 'cnpj')
       and not exists (select 1 from public.solidcon_fornecedores f where f.documento = b.doc)   -- 041
  ), agg as (
    select n.origem as o, n.doc,
           (array_agg(n.ref order by n.em, n.ref))[1] as primeiro_ref,
           (array_agg(n.nome_ order by n.em desc))[1] as nome_,
           (array_agg(n.cep_ order by n.em desc) filter (where n.cep_ ~ '^[0-9]{8}$'))[1] as cep_,
           (array_agg(n.bairro_ order by n.em desc) filter (where n.bairro_ is not null))[1] as bairro_,
           (array_agg(n.cidade_ order by n.em desc) filter (where n.cidade_ is not null))[1] as cidade_,
           (array_agg(n.uf_ order by n.em desc) filter (where n.uf_ ~ '^[A-Z]{2}$'))[1] as uf_,
           min(n.em) as primeiro, max(n.em) as ultimo, count(*)::integer as qtd,
           (array_agg(n.status_ order by n.em desc))[1] as status_,
           coalesce(sum(n.valor), 0)::bigint as valor
      from nao_compraram n
     group by n.origem, n.doc
  ), pontos as (
    -- Clientes do ERP ja localizados com precisao de endereco/CEP e pino atual.
    select cl.cep as cep_, public.solidcon_033_norm(cl.bairro) as b, public.solidcon_033_norm(cl.cidade) as cid,
           cl.estado as uf_, g.lat as la, g.lng as ln
      from public.solidcon_clientes cl
      join public.solidcon_clientes_geo g on g.documento = cl.documento
     where cl.tipo = 'cnpj' and g.precisao in ('endereco', 'cep')
       and not exists (select 1 from public.solidcon_fornecedores f where f.documento = cl.documento)   -- 041: o ponto do CEASA (fornecedores) nao entra na media
       and g.chave_endereco = public.solidcon_033_chave_endereco(cl.logradouro, cl.numero, cl.cep, cl.bairro, cl.cidade, cl.estado)
  ), por_cep as (
    select p.cep_, avg(p.la) as la, avg(p.ln) as ln from pontos p where p.cep_ is not null group by p.cep_
  ), por_bairro as (
    select p.b, p.cid, p.uf_, avg(p.la) as la, avg(p.ln) as ln from pontos p
     where p.b is not null and p.cid is not null group by p.b, p.cid, p.uf_
  ), por_cidade as (
    select p.cid, p.uf_, avg(p.la) as la, avg(p.ln) as ln from pontos p where p.cid is not null group by p.cid, p.uf_
  )
  select a.o,
         replace(a.primeiro_ref::text, '-', ''),
         a.nome_,
         public.solidcon_037_mascarar_cnpj(a.doc),
         a.cep_, a.bairro_, a.cidade_, a.uf_,
         round(coalesce(pc.la, pb.la, pci.la), 5),
         round(coalesce(pc.ln, pb.ln, pci.ln), 5),
         case when pc.la is not null then 'cep' when pb.la is not null then 'bairro'
              when pci.la is not null then 'cidade' end,
         a.primeiro, a.ultimo, a.qtd, a.status_, a.valor
    from agg a
    left join por_cep pc on pc.cep_ = a.cep_
    left join por_bairro pb on pb.b = public.solidcon_033_norm(a.bairro_)
                           and pb.cid = public.solidcon_033_norm(a.cidade_) and pb.uf_ = a.uf_
    left join por_cidade pci on pci.cid = public.solidcon_033_norm(a.cidade_) and pci.uf_ = a.uf_
   order by a.ultimo desc, a.o, a.doc;
end;
$$;
revoke all on function public.solidcon_interessados() from public, anon, authenticated;
grant execute on function public.solidcon_interessados() to authenticated;

commit;
