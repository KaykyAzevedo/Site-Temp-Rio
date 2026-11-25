\set ON_ERROR_STOP on
-- Herda guard localhost + DB sentinela_separando_* e regressao 050/052/054/055/056/059.
\ir pronto-despacho.sql
alter table solidcon_pedidos_erp add column dt_pedido timestamptz,add column dt_sep_inicio timestamptz;
create temporary table antes061 as
 select (select count(*) from rota_dia_item) itens,(select count(*) from rota_dia_log) logs,
 (select count(*) from pedido_canhoto) fotos;
create temporary table corpos061 as
 select n,pg_get_functiondef(n::regprocedure) corpo from unnest(array[
 'public.rota_054_incluir(date,integer,jsonb)', 'public.rota_054_candidatos(date)',
 'public.rota_055_pendente(bigint,date)', 'public.rota_050_fechar_auto(jsonb)']) n;
\ir ../../admin/migracoes/061_rota_pos_saida.sql
\ir ../../admin/migracoes/061_rota_pos_saida.sql
select qa.check(not has_function_privilege('anon','public.rota_054_incluir(date,integer,jsonb)','execute'),'061 anon sem RPC');
select qa.check(not has_function_privilege('authenticated','public.rota_061_auto_aberta(date)','execute'),'061 relogio privado');
select qa.check(has_function_privilege('service_role','public.rota_054_incluir(date,integer,jsonb)','execute'),'061 service mantem RPC');
\ir ../../admin/migracoes/061_rollback.sql
\ir ../../admin/migracoes/061_rollback.sql
select qa.check((select bool_and(pg_get_functiondef(n::regprocedure)=corpo) from corpos061),'061 rollback corpos exatos054055059');
select qa.check(to_regprocedure('public.rota_061_auto_aberta(date)') is null,'061 rollback helper removido');
\ir ../../admin/migracoes/061_rota_pos_saida.sql
select qa.check((select itens=(select count(*) from rota_dia_item) and logs=(select count(*) from rota_dia_log) and fotos=(select count(*) from pedido_canhoto) from antes061),'061 aplicar reverter nao muda dados');
-- Injecao de relogio SOMENTE na fixture; conserva a expressao de fuso/corte da migracao.
do $$begin execute replace(pg_get_functiondef('public.rota_061_auto_aberta(date)'::regprocedure),
 'pg_catalog.clock_timestamp()', '(pg_catalog.current_setting(''qa.agora''))::timestamptz');end$$;
set qa.agora='2026-11-23T07:59:00-03:00';
select qa.check(rota_061_auto_aberta('2026-11-23'),'061 0759 permite');
set qa.agora='2026-11-23T08:00:00-03:00';
select qa.check(rota_061_auto_aberta('2026-11-23'),'061 0800 exato permite');
set qa.agora='2026-11-23T08:00:00.001-03:00';
select qa.check(not rota_061_auto_aberta('2026-11-23'),'061 milissegundo depois bloqueia');
set qa.agora='2026-11-23T11:01:00Z';
select qa.check(not rota_061_auto_aberta('2026-11-23'),'061 0801 SP bloqueia');
set qa.agora='2026-11-23T13:30:00Z';
select qa.check(not rota_061_auto_aberta('2026-11-23'),'061 1030 bloqueia');
update rota_config set hora_saida='10:45:59';
select qa.check(rota_061_auto_aberta('2026-11-23'),'061 usa hora configurada');
set qa.agora='2026-11-23T10:45:00.001-03:00';
select qa.check(not rota_061_auto_aberta('2026-11-23'),'061 segundos config truncados como core');
update rota_config set hora_saida='08:00';
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa) values(99001,'12000000099001','separando');
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_sep_inicio) values
 (99008,'12000000099008','conferido','2026-11-22T10:30-03'),
 (99009,'12000000099009','conferido','2026-11-22T08:00-03');
set qa.agora='2026-11-23T07:59:00-03:00';
select qa.check(exists(select from rota_054_candidatos('2026-11-23') where cd_pedido=99001),'061 candidato antes da saida');
select qa.check(exists(select from rota_054_candidatos('2026-11-23') where cd_pedido=99008)
 and not exists(select from rota_054_candidatos('2026-11-23') where cd_pedido=99009),'061 candidato adiado sobrevive etapa e servidor concorda com core');
set qa.agora='2026-11-23T08:00:00-03:00';
set qa.papel='marcador';set qa.role='authenticated';
select qa.check((rota_054_incluir('2026-11-23',(select revisao from rota_dia_fechada where data='2026-11-23'),(
 select jsonb_agg(jsonb_build_object('cd_pedido',cd_pedido,'veiculo_id',veiculo_id,'ordem',rn)) from
 (select cd_pedido,veiculo_id,row_number() over(partition by veiculo_id order by cd_pedido) rn from
  (select cd_pedido,veiculo_id from rota_dia_item where data='2026-11-23' and removido_em is null
    and veiculo_id in(select veiculo_id from rota_054_candidatos('2026-11-23'))
   union select cd_pedido,veiculo_id from rota_054_candidatos('2026-11-23')) u) n))->>'incluidos')::integer>0,'061 inclusao RPC exata0800');
select qa.check((rota_054_incluir('2026-11-23',-1,'[]')->>'incluidos')::integer=0,'061 retry0800 idempotente');
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa) values(99003,'12000000099003','separando');
set qa.agora='2026-11-23T10:30:00-03:00';
select qa.check(not exists(select from rota_054_candidatos('2026-11-23')),'061 nenhum candidato depois da saida');
create temporary table corte061 as select (select count(*) from rota_dia_item) itens,(select count(*) from rota_dia_log) logs,(select revisao from rota_dia_fechada where data='2026-11-23') rev;
set qa.role='authenticated';set qa.papel='marcador';
set role authenticated;
select qa.check((rota_054_incluir('2026-11-23',-1,'[]')->>'motivo')='saida_encerrada','061 RPC obsoleta depois da saida nao grava');
select qa.check(rota_054_incluir('2026-11-23',-1,'[]')->'foto' is not null,'061 resposta compativel painel');
select qa.erro($q$select rota_054_incluir('2026-11-24',1,'[]')$q$,'40001','061 dia errado continua recusado');
set qa.papel='motorista';
select qa.erro($q$select rota_054_incluir('2026-11-23',1,'[]')$q$,'42501','061 motorista nao inclui');
reset role;set qa.papel='marcador';
set role service_role;set qa.role='service_role';
select qa.check((rota_054_incluir('2026-11-23',-1,'[]')->>'incluidos')::integer=0,'061 service tambem respeita corte');
reset role;set qa.role='authenticated';
select qa.check((select itens=(select count(*) from rota_dia_item) and logs=(select count(*) from rota_dia_log) and rev=(select revisao from rota_dia_fechada where data='2026-11-23') from corte061),'061 corte sem reordenacao revisao ou log');
-- Ajuste manual REAL055 permanece livre apos a saida (e gera a propria auditoria).
select rota_050_ajustar('adicionar',array[99003]::bigint[],'s10',(
 select jsonb_agg(jsonb_build_object('cd_pedido',cd,'ordem',rn)) from
 (select cd,row_number() over(order by cd) rn from
  (select cd_pedido cd from rota_dia_item where data='2026-11-23' and veiculo_id='s10' and removido_em is null union select 99003) s) n));
select qa.check(exists(select from rota_dia_item where data='2026-11-23' and cd_pedido=99003 and origem='adicionado' and removido_em is null),'061 manual1030 funciona');
-- Foto anterior ao faturamento nao envelhece pedido um dia antes no SQL.
insert into solidcon_pedidos_erp(cd_pedido,etapa,dt_saida) values(99002,'atendido','2026-11-16T17:54-03');
insert into rota_dia_fechada(data) values('2026-11-16');
insert into rota_dia_item(data,cd_pedido,veiculo_id,origem) values('2026-11-16',99002,'s10','adicionado');
select qa.check(rota_055_pendente(99002,'2026-11-24') and not rota_055_pendente(99002,'2026-11-25'),'061 SQL max foto16 e despacho17');
update solidcon_pedidos_erp set dt_saida='2026-11-16T08:00-03' where cd_pedido=99002;
select qa.check(not rota_055_pendente(99002,'2026-11-24'),'061 faturado0800 sai mesmo dia');
-- Primeiro fechamento automatico atrasado tambem filtra no servidor, mesmo com lista velha/errada da Edge.
-- Injeta apenas o relogio de entrada050 nesta fixture; a selecao de itens e a de producao.
do $$begin execute replace(pg_get_functiondef('public.rota_050_fechar_auto(jsonb)'::regprocedure),
 'pg_catalog.now()', '(pg_catalog.current_setting(''qa.auto_agora''))::timestamptz');end$$;
create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select '2026-11-25'::date$$;
set qa.auto_agora='2026-11-25T10:30:00-03:00';
insert into solidcon_pedidos_erp(cd_pedido,etapa,dt_pedido,dt_sep_inicio) values
 (99005,'separando','2026-11-25T07:00-03','2026-11-25T08:00-03'),
 (99006,'separando','2026-11-25T07:00-03','2026-11-25T10:30-03'),
 (99007,'conferido','2026-11-25T10:30-03',null);
select qa.check((rota_050_fechar_auto('[{"cd_pedido":99005,"veiculo_id":"s10","ordem":1},{"cd_pedido":99006,"veiculo_id":"s10","ordem":2},{"cd_pedido":99007,"veiculo_id":"s10","ordem":3}]')->>'fechou')::boolean,'061 fechamento inicial atrasado fecha');
select qa.check(exists(select from rota_dia_item where data='2026-11-25' and cd_pedido=99005)
 and not exists(select from rota_dia_item where data='2026-11-25' and cd_pedido in(99006,99007)),'061 servidor filtra novos pos0800 inclusive conferido');
update rota_dia_fechada set estado='reaberta' where data='2026-11-25';
select rota_050_fechar('[{"cd_pedido":99006,"veiculo_id":"s10","ordem":1}]');
select qa.check(exists(select from rota_dia_item where data='2026-11-25' and cd_pedido=99006),'061 fechamento manual nao herda filtro');
create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select '2026-11-23'::date$$;
select count(*) testes_total from qa.checks;
