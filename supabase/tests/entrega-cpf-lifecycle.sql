\set ON_ERROR_STOP on
-- Depois entrega-cpf.sql, somente fixture CPF local.
do $$begin if current_database() !~ '^sentinela_separando_cpf' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somente fixture local';end if;end$$;
create temporary table cpf_antes058 as select
 (select jsonb_agg(to_jsonb(x) order by chave) from public.solidcon_pessoa_retencao x) memoria,
 (select jsonb_agg(to_jsonb(x) order by cd_pedido) from public.solidcon_pedidos_erp x) fonte,
 (select jsonb_agg(to_jsonb(x) order by documento) from public.solidcon_clientes x) clientes,
 (select jsonb_agg(to_jsonb(x) order by cd_pedido) from public.pedido_arquivo x) arquivo;
\ir ../../admin/migracoes/058_entrega_cpf.sql
\ir ../../admin/migracoes/058_entrega_cpf.sql
select qa.check((select memoria is not distinct from(select jsonb_agg(to_jsonb(x) order by chave) from public.solidcon_pessoa_retencao x)
 and fonte is not distinct from(select jsonb_agg(to_jsonb(x) order by cd_pedido) from public.solidcon_pedidos_erp x)
 and clientes is not distinct from(select jsonb_agg(to_jsonb(x) order by documento) from public.solidcon_clientes x)
 and arquivo is not distinct from(select jsonb_agg(to_jsonb(x) order by cd_pedido) from public.pedido_arquivo x) from cpf_antes058),'cpf reaplicar2x preserva memoria prazo fonte cadastro e arquivo');
