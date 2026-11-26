\set ON_ERROR_STOP on
do $$begin if current_database() !~ '^sentinela_separando_cpf_forja068h' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somenteQA H local';end if;end$$;
\if :{?migracaoH}
 \i :migracaoH
 \i :migracaoH
\else
 \ir ../../admin/migracoes/068_h_mover_nao_historico.sql
 \ir ../../admin/migracoes/068_h_mover_nao_historico.sql
\endif
reset role;set qa.uid='22222222-2222-4222-8222-222222222222';set qa.role='authenticated';
create table qa.h_hoje as select pg_get_functiondef('public.rota_068_hoje()'::regprocedure) d;
create or replace function public.rota_068_hoje() returns date language sql stable set search_path='' as $$select '2026-11-26'::date$$;
create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select '2026-11-26'::date$$;
insert into public.solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_saida,cliente_tipo,cliente_nome) select 688000+n,('6880000000'||lpad(n::text,4,'0'))::text,
case when n in(4,5,6,7,9,10) then 'atendido' else 'aberto' end,
case when n in(4,5,6,7,9,10) then timestamptz '2026-11-01 10:00-03' end,'cnpj','HH QA'||n from generate_series(1,14) n;
insert into public.rota_plano_semana(cd_pedido,dia,veiculo_id,ordem) values
(688001,'2026-11-26','s10',1),(688002,'2026-11-25','s10',1),(688003,'2026-11-16','s10',1),(688005,'2026-11-25','s10',2);
insert into public.pedido_entrega_rota(cd_pedido,data_entrega,cliente_tipo,cliente_nome) values
(688004,'2026-11-26','cnpj','RecebidoHoje'),(688005,'2026-11-25','cnpj','ProblemaOntem'),(688006,'2026-11-25','cnpj','Historico'),(688009,'2026-11-26','cnpj','Fronteira'),(688010,'2026-11-26','cnpj','A Hoje');
insert into public.pedido_entrega_confirmacao(cd_pedido,requisicao,confirmado_por,confirmado_em) values
(688004,'88888888-0004-4004-8004-000000000004',auth.uid(),'2026-11-25 16:00-03'),(688007,'88888888-0007-4007-8007-000000000007',auth.uid(),'2026-11-25 16:00-03');
-- Foto anterior da entrega com problema, preservada durante reprogramacao.
insert into public.rota_dia_item(data,cd_pedido,veiculo_id,ordem,incluido_em) values('2026-11-25',688005,'s10',20,now()-interval '2 days');
update public.rota_dia_fechada set fechada_em=now()-interval '2 days' where data='2026-11-25';
create table qa.h_memoria as select (select jsonb_agg(to_jsonb(i) order by data,cd_pedido) from public.rota_dia_item i) itens,
(select jsonb_agg(to_jsonb(e) order by cd_pedido) from public.pedido_entrega_rota e) entregas;
set role authenticated;
select public.rota_068_problema_marcar(688005,'Reprogramar explicitamente','88888888-0005-4005-8005-000000000005');
select qa.check(not (select entregue from public.rota_068_estados_pedidos(array[688001]::bigint[])),'h origem hoje aberta movivel');
select qa.check(not (select entregue from public.rota_068_estados_pedidos(array[688004]::bigint[])),'h recebidohoje vence063ontem');
select qa.check(not (select entregue from public.rota_068_estados_pedidos(array[688005]::bigint[])),'h problema antigo movivel');
select qa.check((select entregue from public.rota_068_estados_pedidos(array[688006]::bigint[])) and (select entregue from public.rota_068_estados_pedidos(array[688007]::bigint[])),'h historico e063antigo travados');
select qa.check(not (select entregue from public.rota_068_estados_pedidos(array[688010]::bigint[])),'h faturamentoantigo isolado nao trava');
select public.rota_068_mover_pedido(688001,'2026-11-30','s10','88888888-1001-4001-8001-000000000001') h_mov \gset
select qa.check(:'h_mov'::jsonb @> '{"status":"ok","entregue":false,"reprogramado":true,"origem":{"dia":"2026-11-26"},"destino":{"dia":"2026-11-30","inicio":"2026-11-30"}}','h moveHoje entre semanas atomico');
select qa.check((select dia='2026-11-30' and veiculo_id='s10' from public.rota_plano_semana where cd_pedido=688001),'h plano destino persistido');
select qa.check((:'h_mov'::jsonb->'origem'->>'versao')::bigint>0 and (:'h_mov'::jsonb->'destino'->>'versao')::bigint>0,'h versoes origem destino');
select public.rota_068_mover_pedido(688001,'2026-11-30','s10','88888888-1001-4001-8001-000000000001') h_retry \gset
select qa.check(:'h_retry'::jsonb->>'repetido'='true','h retry movimento idempotente');
select qa.check(public.rota_068_mover_pedido(688001,'2026-12-01','s10','88888888-1001-4001-8001-000000000001')->>'motivo'='requisicao_invalida','h uuid nao troca destino');
select qa.check(public.rota_068_mover_pedido(688006,'2026-11-30','s10',gen_random_uuid())->>'motivo'='pedido_historico','h RPC recusa somente origem historica');
select qa.check(public.rota_068_mover_pedido(688011,'2026-11-26','s10',gen_random_uuid())->>'motivo'='dia_bloqueado','h hoje fechado nao e destino');
select qa.check(public.rota_068_mover_pedido(688011,'2026-11-29','s10',gen_random_uuid())->>'motivo'='dia_bloqueado','h domingo desabilitado');
select qa.check(public.rota_068_mover_pedido(688011,'2026-11-28','s10',gen_random_uuid())->>'motivo'='dia_sem_saida','h dia sem saida veiculo');
select qa.check(public.rota_068_mover_pedido(688011,'2026-12-03','inativo',gen_random_uuid())->>'motivo'='veiculo_invalido','h veiculo inativo');
-- 065 existente tambem permite origem passada para destino futuro, preservando demais itens.
select jsonb_agg(jsonb_build_object('cd_pedido',p.cd_pedido,'dia',p.dia,'veiculo_id',p.veiculo_id,'ordem',p.ordem,'removido',p.removido))||jsonb_build_array(jsonb_build_object('cd_pedido',688002,'dia','2026-12-01','veiculo_id','s10','ordem',1,'removido',false)) h_payload from public.rota_plano_semana p where p.dia between '2026-11-30' and '2026-12-05' \gset
select (public.rota_065_ler_semana('2026-11-30')->>'versao')::bigint h_v \gset
select qa.check(public.rota_065_salvar_semana('2026-11-30',:h_v,:'h_payload'::jsonb)->>'status'='ok','h 065 aceita origem dia passado');
update public.rota_plano_semana set dia='2026-12-02',ordem=1 where cd_pedido=688003;
select qa.check((select dia='2026-12-02' from public.rota_plano_semana where cd_pedido=688003),'h DML aceita origem semana anterior');
select qa.erro($q$insert into public.rota_plano_semana(cd_pedido,dia,veiculo_id,ordem) values(688006,'2026-12-03','s10',1)$q$,'22023','h DML recusa historico');
select qa.check(public.rota_068_mover_pedido(688004,'2026-12-10','s10','88888888-1004-4004-8004-000000000004')->>'status'='ok','h recebidohoje agenda qualquer semanafutura');
select qa.check(public.rota_068_mover_pedido(688005,null,null,'88888888-1005-4005-8005-000000000005')->>'status'='ok','h problema vai bandeja explicitamente');
select qa.check(not exists(select 1 from public.rota_plano_semana where cd_pedido=688005),'h bandeja remove so plano');
select qa.check((select reprogramado from public.rota_063_ler_entregas(array[688005]::bigint[])),'h 063 informa reprogramacao para core');
select qa.check((public.rota_065_ler_semana('2026-11-23')->'pedidos_estado'->'688005'->>'reprogramado')='true','h mapa065 porpedido');
select qa.check(public.rota_068_trocar_veiculo(688010,'caminhao','pedido')->>'status'='ok','h A recebidohoje troca veiculo');
select qa.check(public.rota_068_trocar_veiculo(688006,'caminhao','pedido')->>'motivo'='pedido_historico','h A historico recusa');
reset role;
select qa.check(public.rota_055_pendente(688005,'2026-11-26') and public.rota_055_pendente(688010,'2026-11-26'),'h 055 reabre problema e recebidohoje vencido');
-- Falha real apos gravar estado/auditoria, durante a escrita do plano: tudo volta.
create table qa.h_antes_falha as select (select count(*) from public.rota_068h_movimento_log) logs,
 (select jsonb_agg(to_jsonb(s) order by inicio) from public.rota_065_semana s) versoes;
create function qa.h_falhar_plano() returns trigger language plpgsql as $$begin
 if new.cd_pedido=688012 then raise exception 'falha QA depois estado' using errcode='P0001';end if;return new;end$$;
create trigger zzz_h_qa_falha before insert on public.rota_plano_semana for each row execute function qa.h_falhar_plano();
set role authenticated;
select qa.erro($q$select public.rota_068_mover_pedido(688012,'2026-12-03','s10','88888888-3012-4012-8012-000000000012')$q$,'P0001','h falha apos estado aborta RPC');
reset role;
select qa.check(not exists(select 1 from public.rota_plano_semana where cd_pedido=688012)
 and not exists(select 1 from public.rota_068h_reprogramacao where cd_pedido=688012)
 and (select logs=(select count(*) from public.rota_068h_movimento_log)
 and versoes is not distinct from (select jsonb_agg(to_jsonb(s) order by inicio) from public.rota_065_semana s) from qa.h_antes_falha),'h falha nao deixa plano estado log nem versao parcial');
drop trigger zzz_h_qa_falha on public.rota_plano_semana;drop function qa.h_falhar_plano();
-- Ler/capturar foto antiga nao conclui uma nova tentativa.
select public.rota_068_entrega_capturar(array[688005]::bigint[]);
select qa.check((select ativa from public.rota_068h_reprogramacao where cd_pedido=688005),'h foto antiga nao encerra tentativa');
select qa.check((select itens=(select jsonb_agg(to_jsonb(i) order by data,cd_pedido) from public.rota_dia_item i) and entregas=(select jsonb_agg(to_jsonb(e) order by cd_pedido) from public.pedido_entrega_rota e) from qa.h_memoria),'h historia fotos memoria066 preservadas');
-- Fronteira realSP por data:23:59:59SP ainda hoje,00:00SP entraHistorico; sessaoUTC nao altera.
set timezone='UTC';
create or replace function public.rota_068_hoje() returns date language sql stable set search_path='' as $$select (timestamptz '2026-11-27 02:59:59Z' at time zone 'America/Sao_Paulo')::date$$;
select qa.check(not public.rota_068_pedido_entregue(688009),'h 235959 SP nao historico');
create or replace function public.rota_068_hoje() returns date language sql stable set search_path='' as $$select (timestamptz '2026-11-27 03:00:00Z' at time zone 'America/Sao_Paulo')::date$$;
select qa.check(public.rota_068_pedido_entregue(688009),'h 000000 SP historico trava');
select qa.check(not public.rota_068_pedido_entregue(688004),'h reprogramado nao trava por recibo antigo');
-- Nova saida real pelaRPC050 encerra tentativa sem apagar o snapshot/auditoria anterior.
create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select '2026-11-27'::date$$;
delete from public.rota_dia_item where data='2026-11-27';delete from public.rota_dia_fechada where data='2026-11-27';
set role authenticated;
select public.rota_050_fechar('[{"cd_pedido":688005,"veiculo_id":"s10","ordem":1}]');
reset role;
select qa.check((select not ativa and recebido_dia='2026-11-27' from public.rota_068h_reprogramacao where cd_pedido=688005),'h nova saida encerra tentativa');
select qa.check((select data_entrega='2026-11-25' from public.pedido_entrega_rota where cd_pedido=688005),'h snapshot anterior nao reescrito');
select qa.check(exists(select 1 from public.rota_068_entregas('2026-11-27','2026-11-27') where cd_pedido=688005),'h C canonica data da nova tentativa');
set qa.uid='11111111-1111-4111-8111-111111111111';set role authenticated;
select public.rota_068_problema_desfazer(688005,'88888888-2005-4005-8005-000000000005');
reset role;
select qa.check(not public.rota_068_pedido_entregue(688005),'h nova tentativa recebida hoje ainda movivel');
create or replace function public.rota_068_hoje() returns date language sql stable set search_path='' as $$select '2026-11-28'::date$$;
select qa.check(public.rota_068_pedido_entregue(688005),'h nova tentativa trava somente dia seguinte');
set qa.uid='44444444-4444-4444-8444-444444444444';set role authenticated;
select qa.erro($q$select public.rota_068_mover_pedido(688011,'2026-12-03','s10',gen_random_uuid())$q$,'42501','h vendedor nao move');
reset role;set qa.uid='77777777-7777-4777-8777-777777777777';set role authenticated;
select qa.erro($q$select public.rota_068_pedido_entregue(688006)$q$,'42501','h helper nega usuario fora equipe');
select qa.erro($q$select * from public.rota_068_estados_pedidos(array[688006]::bigint[])$q$,'42501','h RPC nega usuario fora equipe');
reset role;set qa.uid='';set role authenticated;
select qa.erro($q$select public.rota_068_pedido_entregue(688006)$q$,'42501','h helper exige ator autenticado');
reset role;set qa.uid='44444444-4444-4444-8444-444444444444';set role authenticated;
select qa.check(public.rota_068_pedido_entregue(688006) and (select entregue from public.rota_068_estados_pedidos(array[688006]::bigint[])),'h equipe le helper e RPC coerentes');
reset role;set role anon;
select qa.erro($q$select * from public.rota_068_estados_pedidos(array[688011]::bigint[])$q$,'42501','h anon sem estado');
reset role;
create table qa.h_acervo as select (select count(*) from public.rota_068h_movimento_log) n,(select count(*) from public.pedido_entrega_rota) e;
\ir ../../admin/migracoes/068_h_rollback.sql
\ir ../../admin/migracoes/068_h_rollback.sql
select qa.check(not exists(select 1 from public.rota_068h_backup b where b.def is distinct from pg_get_functiondef(b.nome::regprocedure)),'h rollback corpos exatos');
select qa.check((select n=(select count(*) from public.rota_068h_movimento_log) and e=(select count(*) from public.pedido_entrega_rota) from qa.h_acervo),'h rollback conserva acervo');
\ir ../../admin/migracoes/068_h_mover_nao_historico.sql
select qa.check(to_regprocedure('public.rota_068_mover_pedido(bigint,date,text,uuid)') is not null,'h reaplicar funciona');
select d from qa.h_hoje \gexec
select count(*) as checks_h from qa.checks where nome like 'h %';
