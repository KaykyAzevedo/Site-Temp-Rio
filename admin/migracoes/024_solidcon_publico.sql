-- 024: contrato publico minimo do espelho. APLICADA em 2026-11-11.
-- Requer 005/014 (catalogo/RLS admin), 019/020 (espelho) e 022 (vendas).
-- Independente da 021: instala SOMENTE a mesma coluna e indice de vinculo.
-- Nenhuma consulta ao ERP, alteracao de coletor, dado pessoal ou preco publico.
begin;

-- Definicoes identicas as da 021; uma 021 futura pode executar estes IF NOT EXISTS.
alter table public.catalogo_produtos add column if not exists codigo_erp text;
create unique index if not exists catalogo_produtos_codigo_erp_uk
  on public.catalogo_produtos (codigo_erp) where codigo_erp is not null;
-- Nao concede escrita nem cria policy permissiva. A policy da 005
-- "admin escreve produtos" exige eh_admin() no USING e WITH CHECK; a 014
-- restringe esse helper ao papel admin. Ela cobre a nova coluna tambem.

-- Sem argumentos: nao permite sondar EANs/codigos, datas ou quantidades.
-- Executar como owner das tabelas; search_path fechado e nomes qualificados.
create or replace function public.solidcon_catalogo_publico()
returns table (produto_id text, disponivel boolean, posicao bigint)
language sql stable security definer
set search_path = pg_catalog
as $$
  with ultima_coleta as (
    select s.status, s.coletado_em
    from public.solidcon_sync s
    order by s.concluido_em desc, s.id desc limit 1
  ), catalogo as (
    select c.id, btrim(c.codigo_erp) as codigo
    from public.catalogo_produtos c
    where c.ativo and c.removido_em is null
  ), familias_erp as (
    -- Mesma base de Familia-Venda: caixas GTIN-14 -> do 2o ao 13o digito.
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
  ), vinculos as (
    -- Um produto do site = um sabor: expande vinculo para CX24 + CX48.
    -- Aliases sem familia conservam o casamento exato legado.
    -- Alias ambiguo (mais de uma familia) fica desconhecido/fail-open.
    select c.id, p.id_produto, p.presente, p.estoque_disponivel,
           p.atualizado_em
    from catalogo c join public.solidcon_produtos p
      on exists (select 1 from familia_catalogo f join familias_erp e on e.familia = f.familia
                 where f.id = c.id and e.id_produto = p.id_produto)
         or (c.codigo <> '' and (p.id_produto::text = c.codigo or c.codigo = any(p.eans))
             and not exists (select 1 from familias_candidatas f where f.id = c.id))
  ), disponibilidade as (
    select v.id,
      case when (select u.status = 'ok'
                   and u.coletado_em between now() - interval '2 hours' and now()
                 from ultima_coleta u)
                 and bool_and(v.presente and v.atualizado_em >= now() - interval '2 hours')
           then bool_or(v.estoque_disponivel > 0)
           else true end as disponivel
    from vinculos v group by v.id
  ), vendas as (
    select v.familia, sum(v.qtd * v.potes_por_unidade) as potes
    from public.solidcon_vendas_dia v
    where v.dia between (now() at time zone 'America/Sao_Paulo')::date - 89
                    and (now() at time zone 'America/Sao_Paulo')::date
      and v.formato in ('pote', 'cx24', 'cx48') and v.familia is not null
      and exists (select 1 from familia_catalogo f where f.familia = v.familia)
    group by v.familia having sum(v.qtd * v.potes_por_unidade) > 0
  ), ranking as (
    -- Posicoes consecutivas; empate por familia, estavel e sem expor volume.
    select v.familia, row_number() over (order by v.potes desc, v.familia) as posicao
    from vendas v
  )
  select c.id, coalesce(d.disponivel, true), r.posicao
  from catalogo c
  left join disponibilidade d on d.id = c.id
  left join familia_catalogo f on f.id = c.id
  left join ranking r on r.familia = f.familia
  order by c.id;
$$;

-- O anon recebe somente EXECUTE desta projecao, nunca SELECT no espelho.
revoke all on function public.solidcon_catalogo_publico() from public, anon, authenticated;
grant execute on function public.solidcon_catalogo_publico() to anon, authenticated;
comment on function public.solidcon_catalogo_publico() is
  'Catalogo ativo: ID, disponibilidade fail-open em falha/ausencia/coleta >2h e posicao por potes/90 dias. Sem volumes, valores ou dados pessoais.';

commit;
