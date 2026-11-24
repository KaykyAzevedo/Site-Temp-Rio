\set ON_ERROR_STOP on
-- Inclui guard localhost/DB sentinela_separando_*, migrations reais e regressões055/056.
\ir canhoto-desde.sql
create temporary table helper056 as select pg_get_functiondef('public.rota_055_pendente(bigint,date)'::regprocedure) as corpo;
create temporary table antes059 as select (select count(*) from pedido_canhoto) fotos,(select count(*) from rota_dia_item) itens;
\ir ../../admin/migracoes/059_pronto_despacho.sql
\ir ../../admin/migracoes/059_pronto_despacho.sql
update rota_config set hora_saida='08:00',canhoto_desde='2026-01-01T00:00Z' where id=1;
insert into solidcon_pedidos_erp(cd_pedido,etapa,dt_saida) values
 (91537,'atendido','2026-11-24T17:23-03'),
 (91538,'atendido','2026-11-16T17:23-03'),
 (91539,'atendido','2026-11-17T08:00-03'),
 (91540,'atendido','2026-11-17T08:00:00.001-03'),
 (91541,'atendido','2026-11-01T17:00-03');
select qa.check(rota_055_pendente(91537,'2026-11-25'),'despacho vespera elegivel');
select qa.check(rota_055_pendente(91538,'2026-11-24') and not rota_055_pendente(91538,'2026-11-25'),'despacho sete oito dias da saida');
select qa.check(not rota_055_pendente(91539,'2026-11-25') and rota_055_pendente(91540,'2026-11-25'),'despacho igualdade0800 e milissegundo posterior');
insert into rota_dia_fechada(data,estado) values('2026-11-26','fechada'),('2026-11-27','fechada'),('2026-11-28','reaberta');
insert into rota_dia_item(data,cd_pedido,veiculo_id,ordem,origem) values
 ('2026-11-26',91541,'s10',1,'adicionado'),('2026-11-27',91541,'s10',1,'adicionado'),('2026-11-28',91541,'s10',1,'adicionado');
select qa.check((select dia_saida=date '2026-11-26' from rota_059_saidas where cd_pedido=91541),'despacho primeira rota ativa');
select qa.check(rota_055_pendente(91541,'2026-11-25'),'despacho faturamento antigo com rota tardia nao some');
update rota_dia_item set removido_em=now() where data='2026-11-26' and cd_pedido=91541;
select qa.check((select dia_saida=date '2026-11-27' from rota_059_saidas where cd_pedido=91541),'despacho ignora item removido');
update rota_dia_fechada set estado='reaberta' where data='2026-11-27';
select qa.check(not exists(select from rota_059_saidas where cd_pedido=91541) and not rota_055_pendente(91541,'2026-11-25'),'despacho reaberta nao e saida');
select qa.check(not has_table_privilege('anon','public.rota_059_saidas','select'),'despacho anon sem grant');
select qa.check((select reloptions @> array['security_invoker=true'] from pg_class where oid='rota_059_saidas'::regclass),'despacho view invoker');
select qa.check(not has_function_privilege('authenticated','public.rota_055_pendente(bigint,date)','execute'),'despacho helper privado');
insert into rota_dia_item(data,cd_pedido,veiculo_id,ordem,origem) values('2026-11-26',91537,'s10',2,'adicionado');
set role authenticated;set qa.papel='marcador';
select qa.check(exists(select from public.rota_059_saidas where cd_pedido=91537),'despacho equipe le com RLS');
reset role;
set role authenticated; set qa.papel='motorista';
select qa.check(not exists(select from public.rota_059_saidas),'despacho motorista sem leitura global');
reset role;set qa.papel='marcador';
\ir ../../admin/migracoes/059_rollback.sql
\ir ../../admin/migracoes/059_rollback.sql
select qa.check((select pg_get_functiondef('public.rota_055_pendente(bigint,date)'::regprocedure)=corpo from helper056),'despacho rollback corpo056 exato');
select qa.check(to_regclass('public.rota_059_saidas') is null,'despacho rollback view removida');
\ir ../../admin/migracoes/059_pronto_despacho.sql
select qa.check((select count(*) from pedido_canhoto)=(select fotos from antes059),'despacho fotos preservadas');
select count(*) testes_total from qa.checks;
