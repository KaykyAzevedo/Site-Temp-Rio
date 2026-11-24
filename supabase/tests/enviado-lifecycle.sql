\set ON_ERROR_STOP on
-- Executar depois de enviado.sql, no mesmo banco PG18 isolado. Nunca no projeto.
do $$begin if current_database() !~ '^sentinela_separando_enviado' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somente fixture local';end if;end$$;
set timezone='America/Sao_Paulo';
set qa.papel='marcador';set qa.role='authenticated';
-- As limpezas044/045 sao invoker/service_role, como em producao.
grant select on public.solidcon_pedidos_erp to service_role;
grant select,delete on public.rota_pedido_veiculo,public.rota_pedido_ignorado to service_role;
delete from public.pedido_canhoto;
update public.solidcon_pedidos_erp set dt_saida=now() where cd_pedido in (1528,1529);
insert into public.pedido_canhoto(cd_pedido,caminho) values(1528,'2026-11-23/1528/66666666-6666-4666-8666-666666666666.jpg');
insert into public.rota_pedido_veiculo(cd_pedido,veiculo,atualizado_em) values(1528,'s10',now()-interval '31 days'),(1529,'s10',now()-interval '31 days'),(1530,'s10',now()-interval '31 days');
insert into public.rota_pedido_ignorado(cd_pedido,atualizado_em) values(1528,now()-interval '31 days'),(1529,now()-interval '31 days'),(1530,now()-interval '31 days');
set role service_role;
select public.rota_044_limpar();select public.rota_045_limpar();
reset role;
select qa.check(exists(select 1 from public.rota_pedido_veiculo where cd_pedido=1529) and not exists(select 1 from public.rota_pedido_veiculo where cd_pedido in(1528,1530)),'enviado limpeza044 preserva recente sem canhoto');
select qa.check(exists(select 1 from public.rota_pedido_ignorado where cd_pedido=1529) and not exists(select 1 from public.rota_pedido_ignorado where cd_pedido in(1528,1530)),'enviado limpeza045 preserva exclusao de recente');
select qa.check(not has_function_privilege('authenticated','public.rota_044_limpar()','execute') and not has_function_privilege('anon','public.rota_055_pendente(bigint,date)','execute'),'enviado ACLs privadas preservadas');
create temporary table antes_055 as select
 (select jsonb_agg(to_jsonb(f) order by data) from public.rota_dia_fechada f) cab,
 (select jsonb_agg(to_jsonb(i) order by data,cd_pedido) from public.rota_dia_item i) itens,
 (select jsonb_agg(to_jsonb(c) order by id) from public.pedido_canhoto c) canhotos,
 (select jsonb_agg(to_jsonb(s) order by data,veiculo_id) from public.rota_saida s) saidas;
\ir ../../admin/migracoes/055_rollback.sql
\ir ../../admin/migracoes/055_rollback.sql
select qa.check(to_regprocedure('public.rota_055_pendente(bigint,date)') is null,'enviado rollback duplo remove helper');
select qa.check(not exists(select 1 from pg_trigger where tgname like 'rota_055_canhoto_%'),'enviado rollback remove triggers');
\ir ../../admin/migracoes/055_enviado_canhoto.sql
\ir ../../admin/migracoes/055_enviado_canhoto.sql
select qa.check((select cab is not distinct from (select jsonb_agg(to_jsonb(f) order by data) from public.rota_dia_fechada f)
 and itens is not distinct from (select jsonb_agg(to_jsonb(i) order by data,cd_pedido) from public.rota_dia_item i)
 and canhotos is not distinct from (select jsonb_agg(to_jsonb(c) order by id) from public.pedido_canhoto c)
 and saidas is not distinct from (select jsonb_agg(to_jsonb(s) order by data,veiculo_id) from public.rota_saida s) from antes_055),'enviado lifecycle preserva dados revisoes ordens e fotos');
select qa.check(rota_055_pendente(1529,'2026-11-23') and not rota_055_pendente(1528,'2026-11-23'),'enviado reaplicada conserva regra');
select count(*) as testes_enviado_lifecycle from qa.checks where nome like 'enviado%';
