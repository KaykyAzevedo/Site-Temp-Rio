-- Rollback067: volta solidcon_mapa_clientes() EXATA da 064 (lista todo CNPJ do cadastro, sem compra inclusive). Sem dados.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_catalog.pg_advisory_xact_lock(5100, 67);
-- Mapa (062) + 064: soma so NF de venda nossa (ou legado ate o backfill).
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
      from (
        select v.documento, v.dia, v.valor_centavos
          from public.solidcon_vendas_clientes v where v.tipo = 'cnpj'
        union all
        select n.documento, n.dia, n.valor_centavos
          from public.solidcon_vendas_nf n where n.nf_cupom is not true
           and n.classe in ('venda','legado')   -- 064: bonificacao e compra de fornecedor nao somam
           and not exists(select from public.solidcon_fornecedores f where f.documento=n.documento)
      ) vc
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
notify pgrst, 'reload schema';
commit;
