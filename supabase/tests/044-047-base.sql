-- Corpo literal da047; fixture e comparacao de rollback.
create or replace function public.rota_044_marcar(p_cd_pedido bigint, p_veiculo text, p_escopo text default 'pedido')
returns text
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_doc text;
  v_padrao text;
begin
  if not public.pode_marcar_rota() then
    raise exception 'sem permissao para marcar a rota' using errcode = '42501';
  end if;
  if p_cd_pedido is null or coalesce(p_escopo, '') not in ('pedido', 'sempre')
     or (p_veiculo is not null and not exists (select 1 from public.rota_veiculos v where v.id = p_veiculo and v.ativo)) then
    raise exception 'parametro invalido' using errcode = '22023';
  end if;
  select e.documento into v_doc from public.solidcon_pedidos_erp e where e.cd_pedido = p_cd_pedido;
  if not found then
    raise exception 'pedido nao encontrado' using errcode = 'P0002';
  end if;
  if v_doc is not null then
    select r.veiculo into v_padrao from public.rota_cliente_veiculo r where r.documento = v_doc;
  end if;

  if p_veiculo is null then
    delete from public.rota_pedido_veiculo where cd_pedido = p_cd_pedido;
    if p_escopo = 'sempre' and v_doc is not null then
      delete from public.rota_cliente_veiculo where documento = v_doc;
    end if;
    return 'removido';
  end if;

  if v_doc is not null and (p_escopo = 'sempre' or v_padrao is null) then
    insert into public.rota_cliente_veiculo as r (documento, veiculo) values (v_doc, p_veiculo)
      on conflict (documento) do update set veiculo = excluded.veiculo;
    delete from public.rota_pedido_veiculo where cd_pedido = p_cd_pedido;
    return 'padrao';
  end if;
  if v_padrao is not distinct from p_veiculo then
    delete from public.rota_pedido_veiculo where cd_pedido = p_cd_pedido;
    return 'padrao';
  end if;
  insert into public.rota_pedido_veiculo as r (cd_pedido, veiculo) values (p_cd_pedido, p_veiculo)
    on conflict (cd_pedido) do update set veiculo = excluded.veiculo;
  return 'pedido';
end;
$$;
revoke all on function public.rota_044_marcar(bigint, text, text) from public, anon;
grant execute on function public.rota_044_marcar(bigint, text, text) to authenticated;

