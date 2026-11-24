\set ON_ERROR_STOP on
-- PG18 local isolado. Nunca conectar ao banco do projeto.
\ir enviado.sql
alter table public.rota_config add column bairros_caminhao text[] not null default '{}',add column corte_hora smallint,
 add column s10_volta_sede boolean default false,add column atualizado_em timestamptz default now(),add column atualizado_por uuid;
alter table public.rota_cliente_veiculo add column atualizado_em timestamptz default now(),add column atualizado_por uuid;
\ir ../../admin/migracoes/040_rota_config.sql
insert into public.solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_saida,dt_atendido) select cd,('1200000000'||cd)::text,'atendido',
 case when cd in(1525,1526,1527) then timestamptz '2026-11-23 11:00-03' else timestamptz '2026-11-23 17:23-03' end,timestamptz '2026-11-23 17:24-03'
 from unnest(array[1525,1526,1527,1528,1529,1530,1532,1534]) cd
 on conflict(cd_pedido) do update set etapa=excluded.etapa,dt_saida=excluded.dt_saida,dt_atendido=excluded.dt_atendido;
select qa.check(rota_055_pendente(1525,'2026-11-24'),'desde sem056 ainda vale055');
select revisao as rev_instala from public.rota_dia_fechada \gset
\ir ../../admin/migracoes/056_canhoto_desde.sql
select qa.check((select revisao=:rev_instala+1 from public.rota_dia_fechada),'desde instalacao invalida revisao');
select qa.check((select canhoto_desde=timestamptz '2026-11-23 15:00Z' from public.rota_config where id=1),'desde instante padrao SP');
select qa.check((select atttypmod=3 from pg_attribute where attrelid='public.rota_config'::regclass and attname='canhoto_desde'),'desde precisao de milissegundos igual JS');
select qa.check((select bool_and(not rota_055_pendente(cd,'2026-11-24')) from unnest(array[1525,1526,1527]) cd),'desde tres pedidos manha legado');
select qa.check((select bool_and(rota_055_pendente(cd,'2026-11-24')) from unnest(array[1528,1529,1530,1532,1534]) cd),'desde cinco pedidos17h pendentes');
update public.solidcon_pedidos_erp set dt_saida='2026-11-23 14:59:59.999Z' where cd_pedido=1525;
update public.solidcon_pedidos_erp set dt_saida='2026-11-23 15:00Z' where cd_pedido=1526;
select qa.check(not rota_055_pendente(1525,'2026-11-24') and rota_055_pendente(1526,'2026-11-24'),'desde antes estrito e igualdade nova');
update public.solidcon_pedidos_erp set dt_saida=null,dt_nota='2026-11-23 11:59-03' where cd_pedido=1527;
select qa.check(not rota_055_pendente(1527,'2026-11-24'),'desde fallback nota antes atendido');
select qa.erro($c$select rota_050_ajustar('adicionar',array[1525]::bigint[],'s10','[]')$c$,'P0002','desde ajuste recusa legado');
select qa.check(not rota_050_envio_ok('2026-11-24','s10','[{"ordem":1,"pedidos":[1525]}]'),'desde publicacao aberta recusa legado');
select qa.check(rota_050_envio_ok('2026-11-24','s10','[{"ordem":1,"pedidos":[1534]}]'),'desde publicacao nova aceita recente');
insert into public.pedido_canhoto(cd_pedido,caminho) values(1534,'2026-11-23/1534/77777777-7777-4777-8777-777777777777.jpg');
select qa.check(not rota_055_pendente(1534,'2026-11-24'),'desde novo recebido com canhoto');
select qa.erro($c$update public.rota_config set canhoto_desde=null where id=1$c$,'23502','desde recusa null');
select qa.erro($c$update public.rota_config set canhoto_desde='infinity' where id=1$c$,'23514','desde recusa infinito');
select revisao as rev_noop from public.rota_dia_fechada \gset
update public.rota_config set canhoto_desde=canhoto_desde where id=1;
insert into public.rota_config(id,canhoto_desde) values(1,'2026-11-23 12:00-03') on conflict(id) do update set canhoto_desde=excluded.canhoto_desde;
\ir ../../admin/migracoes/056_canhoto_desde.sql
select qa.check((select revisao=:rev_noop from public.rota_dia_fechada),'desde reaplicacao e noop nao invalidam');
set role authenticated;set qa.papel='vendedor';
update public.rota_config set canhoto_desde='2026-11-24 12:00-03' where id=1;
reset role;
select qa.check((select canhoto_desde=timestamptz '2026-11-23 12:00-03' from public.rota_config),'desde vendedor sem escrita RLS');
set role authenticated;set qa.papel='motorista';
update public.rota_config set canhoto_desde='2026-11-24 12:00-03' where id=1;
reset role;
select qa.check((select canhoto_desde=timestamptz '2026-11-23 12:00-03' from public.rota_config),'desde motorista sem escrita RLS');
set role authenticated;set qa.papel='admin';
update public.rota_config set canhoto_desde='2026-11-23 13:00-03' where id=1;
reset role;
select qa.check((select canhoto_desde=timestamptz '2026-11-23 13:00-03' from public.rota_config),'desde admin pode editar RLS');
select qa.check((select revisao=:rev_noop+1 from public.rota_dia_fechada),'desde edicao invalida revisao');
\ir ../../admin/migracoes/056_canhoto_desde.sql
select qa.check((select canhoto_desde=timestamptz '2026-11-23 13:00-03' from public.rota_config),'desde reexecucao conserva escolha admin');
select qa.check(not has_function_privilege('authenticated','public.rota_055_pendente(bigint,date)','execute') and not has_function_privilege('anon','public.rota_056_config_revisao()','execute'),'desde auxiliares privados');
select qa.erro($c$set local role anon;select canhoto_desde from public.rota_config$c$,'42501','desde anon sem leitura');
-- Linha ausente nao presume corte. A055 continua sendo o fallback.
delete from public.rota_config;
select qa.check(rota_055_pendente(1525,'2026-11-24'),'desde linha config ausente conserva055');
set role authenticated;set qa.papel='vendedor';
select qa.erro($c$insert into public.rota_config(id) values(1)$c$,'42501','desde vendedor nao insere corte');
reset role;
insert into public.rota_config(id) values(1);
set qa.papel='marcador';
create temporary table foto_desde as select
 (select jsonb_agg(to_jsonb(i) order by data,cd_pedido) from public.rota_dia_item i) itens,
 (select jsonb_agg(to_jsonb(c) order by id) from public.pedido_canhoto c) fotos,
 (select jsonb_agg(to_jsonb(s) order by data,veiculo_id) from public.rota_saida s) saidas;
select revisao as rev_rollback from public.rota_dia_fechada \gset
\ir ../../admin/migracoes/056_rollback.sql
\ir ../../admin/migracoes/056_rollback.sql
select qa.check(rota_055_pendente(1525,'2026-11-24'),'desde rollback restaura055');
select qa.check((select revisao=:rev_rollback+1 from public.rota_dia_fechada),'desde rollback invalida uma vez');
select qa.check((select itens is not distinct from(select jsonb_agg(to_jsonb(i) order by data,cd_pedido) from public.rota_dia_item i)
 and fotos is not distinct from(select jsonb_agg(to_jsonb(c) order by id) from public.pedido_canhoto c)
 and saidas is not distinct from(select jsonb_agg(to_jsonb(s) order by data,veiculo_id) from public.rota_saida s) from foto_desde),'desde rollback conserva itens fotos publicacoes');
\ir ../../admin/migracoes/056_canhoto_desde.sql
select qa.check(not rota_055_pendente(1525,'2026-11-24'),'desde reaplicacao restabelece corte');
select count(*) testes_desde from qa.checks where nome like 'desde%';
