\set ON_ERROR_STOP on
do $$begin if current_database() !~ '^sentinela_separando_cpf_forja068c' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somente fixture C local';end if;end$$;
\if :{?qa_base_pronta}
\else
 \i :fixture068
 reset role;
 alter table public.solidcon_pedidos_erp add column if not exists cliente_tipo text default 'cnpj',add column if not exists cliente_nome text,add column if not exists valor_centavos bigint;
 alter table public.rota_pedido_ignorado add column if not exists motivo text,add column if not exists atualizado_por uuid;
 create or replace function public.texto_seguro(p_valor text,p_tamanho_maximo integer default 200) returns boolean language sql immutable as $$select p_valor is null or (char_length(p_valor)<=p_tamanho_maximo and p_valor !~ '[<>]')$$;
 create table qa.limpeza055(def text);
 insert into qa.limpeza055 select pg_get_functiondef('public.rota_045_limpar()'::regprocedure);
 \i :base045
 select def from qa.limpeza055 \gexec
 \i :baseF2
 create table qa.antes063 as select pg_get_functiondef('public.rota_055_pendente(bigint,date)'::regprocedure) pendente,pg_get_functiondef('public.rota_063_ler_entregas(bigint[])'::regprocedure) ler;
 -- R1: acervo legitimo recebido pela RPC063 publicada ANTES da migracaoC, sem nenhuma foto059.
 set qa.uid='22222222-2222-4222-8222-222222222222';set qa.role='authenticated';
 insert into public.solidcon_pedidos_erp(cd_pedido,etapa,dt_saida,cliente_tipo,cliente_nome,valor_centavos) values
 (683901,'atendido',now(),'cnpj','Legado063 ativo',6300),(683902,'atendido',now(),'cnpj','Legado063 desfeito',6400);
 select public.rota_063_confirmar_entrega(683901,'Confirmacao legitima anterior','cccccccc-0901-4901-8901-000000000001');
 select public.rota_063_confirmar_entrega(683902,'Desfeita antes deC','cccccccc-0902-4902-8902-000000000001');
 update public.pedido_entrega_confirmacao set desfeito_por='11111111-1111-4111-8111-111111111111',desfeito_em=now() where cd_pedido=683902;
 create table qa.legado_r1 as select ec.* from public.pedido_entrega_confirmacao ec where ec.cd_pedido in(683901,683902);
\endif
\if :{?qa_preparar}
\else
\if :{?migracao068}
 \i :migracao068
 \i :migracao068
\else
 \ir ../../admin/migracoes/068_c_entrega_automatica.sql
 \ir ../../admin/migracoes/068_c_entrega_automatica.sql
\endif
reset role;set qa.role='authenticated';set qa.uid='22222222-2222-4222-8222-222222222222';
select qa.check(not public.rota_055_pendente(683901,public.rota_068_hoje()),'c R1 recebido063 anterior continua fora da fila');
set role authenticated;
select qa.check((select count(*)=1 from public.rota_063_ler_entregas(array[683901]::bigint[])),'c R1 projecao063 preserva legado sem059');
reset role;
select qa.check((select l.id=ec.id and l.confirmado_em=ec.confirmado_em and l.confirmado_nome=ec.confirmado_nome from public.rota_063_ler_entregas(array[683901]::bigint[]) l join public.pedido_entrega_confirmacao ec on ec.cd_pedido=l.cd_pedido and ec.desfeito_em is null),'c R1 data autor id063 preservados');
set role authenticated;
select qa.check((select count(*)=0 from public.rota_063_ler_entregas(array[683902]::bigint[])),'c R1 legado desfeito nao ressuscita');
select qa.check(exists(select 1 from public.rota_068_entregas('2026-01-01','2026-12-31') where cd_pedido=683901 and status='entregue'),'c R1 UI preserva legado na leituraC');
reset role;
select qa.check(not exists(select 1 from public.pedido_entrega_rota where cd_pedido=683901) and not exists(select 1 from public.rota_059_saidas where cd_pedido=683901),'c R1 nao inventa saida nem snapshot063');
select qa.check(not exists((select * from public.pedido_entrega_confirmacao where cd_pedido in(683901,683902) except select * from qa.legado_r1) union all (select * from qa.legado_r1 except select * from public.pedido_entrega_confirmacao where cd_pedido in(683901,683902))),'c R1 acervo063 inalterado');
set role authenticated;
select qa.check(public.rota_068_problema_marcar(683901,'Problema em entregalegitima','cccccccc-0901-4901-8901-000000000002')->>'ativa'='true','c R1 problema permitido no legado semfake059');
reset role;
select qa.check(not public.rota_055_pendente(683901,public.rota_068_hoje()),'c R1 problema legado nao volta fila');
create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select '2026-11-25'::date$$;
insert into public.solidcon_pedidos_erp(cd_pedido,etapa,cliente_tipo,cliente_nome,valor_centavos) values
 (683001,'conferido','cnpj','Cliente C QA',12300),(683002,'aberto','cpf','Pessoa C QA',45600),(683003,'aberto','cnpj','Ainda sem saida',7000);
delete from public.rota_dia_item where data='2026-11-26';
insert into public.rota_dia_fechada(data,estado) values('2026-11-26','reaberta') on conflict(data) do update set estado='reaberta';
insert into public.rota_dia_item(data,cd_pedido,veiculo_id,ordem) values('2026-11-26',683001,'s10',1);
select qa.check(not exists(select 1 from public.pedido_entrega_rota where cd_pedido=683001),'c foto aberta nao entrega');
update public.rota_dia_fechada set estado='fechada' where data='2026-11-26';
select qa.check((select data_entrega='2026-11-26' and cliente_nome='Cliente C QA' and valor_centavos=12300 from public.pedido_entrega_rota where cd_pedido=683001),'c fechamento entrega e captura snapshot');
insert into public.rota_dia_item(data,cd_pedido,veiculo_id,ordem) values('2026-11-26',683002,'s10',2);
select qa.check(exists(select 1 from public.pedido_entrega_rota where cd_pedido=683002),'c insercao em foto fechada entrega');
select qa.check(not exists(select 1 from public.pedido_canhoto where cd_pedido in(683001,683002)) and not exists(select 1 from public.pedido_entrega_confirmacao where cd_pedido in(683001,683002)),'c automatico nao inventa canhoto nem confirmacao063');
set role authenticated;
select qa.check((select status='entregue' and data_entrega='2026-11-26' from public.rota_068_entregas('2026-11-26','2026-11-26') where cd_pedido=683001),'c projecao entregue');
select qa.check((select confirmado_em=timestamptz '2026-11-26 00:00-03' from public.rota_063_ler_entregas(array[683001]::bigint[])),'c projecao063 canonica');
select qa.erro($c$select public.rota_063_confirmar_entrega(683001,null,gen_random_uuid())$c$,'42501','c recebido manual063 desativado');
select qa.check(public.rota_068_problema_marcar(683003,'Ainda nao saiu',gen_random_uuid())->>'motivo'='pedido_sem_saida','c problema exige saida');
select qa.check((select bool_and(public.rota_068_problema_marcar(683001,o,gen_random_uuid())->>'motivo'='observacao_invalida') from unnest(array[null::text,'','   ','<x>',repeat('x',301)]) o),'c observacao invalida');
select qa.check(public.rota_068_problema_marcar(683001,'  Caixa   avariada  ','cccccccc-0001-4001-8001-000000000001') @> '{"status":"ok","ativa":true,"repetido":false}','c marca problema');
select qa.check(public.rota_068_problema_marcar(683001,null,'cccccccc-0001-4001-8001-000000000001') @> '{"status":"ok","ativa":true,"repetido":true}','c retry da mesma requisicao');
select qa.check(public.rota_068_problema_marcar(683001,'Nao altera observacao','cccccccc-0001-4001-8001-000000000002')->>'repetido'='true','c segundo clique ativo idempotente');
select qa.check((select count(*)=1 and min(obs)='Caixa avariada' and min(por::text)='22222222-2222-4222-8222-222222222222' from public.pedido_entrega_problema where cd_pedido=683001),'c audita obs normalizada e autor real');
select qa.check((select status='problema' and obs='Caixa avariada' and por_nome is not null from public.rota_068_entregas('2026-11-26','2026-11-26') where cd_pedido=683001),'c problema sai da contagem entregue');
select qa.check(public.rota_068_problema_marcar(683002,'Outro pedido','cccccccc-0001-4001-8001-000000000001')->>'motivo'='requisicao_invalida','c requisicao nao muda pedido');
select qa.erro($c$select public.rota_068_problema_desfazer(683001,gen_random_uuid())$c$,'42501','c Marcio nao desfaz');
select qa.erro($c$update public.pedido_entrega_problema set obs='adulterado'$c$,'42501','c auditoria sem escrita direta');
select qa.erro($c$delete from public.pedido_entrega_rota where cd_pedido=683001$c$,'42501','c snapshot sem escrita direta');
reset role;
select qa.check(not public.rota_055_pendente(683001,'2026-11-26'),'c problema nao retorna pendenteSQL');
insert into public.rota_dia_item(data,cd_pedido,veiculo_id,ordem) values('2026-11-26',683901,'s10',3);
set role authenticated;
select qa.check((select count(*)=1 and min(confirmado_em)=timestamptz '2026-11-26 00:00-03' from public.rota_063_ler_entregas(array[683901]::bigint[])),'c R1 saida real tem precedencia sem duplicar063');
reset role;
-- Coleta e reabertura nao apagam fato ja ocorrido.
delete from public.solidcon_pedidos_erp where cd_pedido=683001;
update public.rota_dia_fechada set estado='reaberta' where data='2026-11-26';
delete from public.rota_dia_item where cd_pedido=683001;
insert into public.solidcon_pedidos_erp(cd_pedido,etapa,cliente_tipo,cliente_nome) values(683001,'aberto','cnpj','Nome novo nao reescreve historia');
select qa.check((select cliente_nome='Cliente C QA' and valor_centavos=12300 from public.pedido_entrega_rota where cd_pedido=683001),'c snapshot sobrevive sync e reabertura');
select qa.check(not public.rota_055_pendente(683001,'2026-11-26'),'c reaparecer aberto nao volta pendente');
set qa.uid='11111111-1111-4111-8111-111111111111';set role authenticated;
select qa.check(public.rota_068_problema_desfazer(683001,'cccccccc-0002-4002-8002-000000000001') @> '{"status":"ok","alterado":true}','c admin desfaz');
select qa.check(public.rota_068_problema_marcar(683001,null,'cccccccc-0001-4001-8001-000000000001')->>'ativa'='false','c replay antigo nao ressuscita problema');
select qa.check(public.rota_068_problema_marcar(683001,repeat('x',300),'cccccccc-0001-4001-8001-000000000003')->>'ativa'='true','c limite300 e nova ocorrencia');
select qa.check(public.rota_068_problema_desfazer(683001,'cccccccc-0002-4002-8002-000000000001')->>'repetido'='true','c replay desfazer nao desfaz ocorrencia nova');
select qa.check((select count(*)=1 from public.pedido_entrega_problema where cd_pedido=683001 and desfeito_em is null),'c ocorrencia nova continua ativa');
select qa.check(public.rota_068_problema_desfazer(683001,'cccccccc-0001-4001-8001-000000000003')->>'motivo'='requisicao_invalida','c requisicao nao troca operacao');
select public.rota_068_problema_desfazer(683001,'cccccccc-0002-4002-8002-000000000002');
select qa.check((select status='entregue' from public.rota_068_entregas('2026-11-26','2026-11-26') where cd_pedido=683001),'c desfazer devolve a entregue');
select public.rota_068_tirar_do_site(683001,'Excluir da operacao');
select qa.check(not exists(select 1 from public.rota_068_entregas('2026-11-26','2026-11-26') where cd_pedido=683001),'c tirado site nao entra em relatorio');
select public.rota_068_voltar_ao_site(683001);
set qa.uid='44444444-4444-4444-8444-444444444444';
select qa.erro($c$select public.rota_068_problema_marcar(683001,'Sem permissao',gen_random_uuid())$c$,'42501','c vendedor nao marca');
select qa.check(exists(select 1 from public.rota_068_entregas('2026-11-26','2026-11-26') where cd_pedido=683001),'c vendedor le status');
set qa.uid='33333333-3333-4333-8333-333333333333';
select qa.erro($c$select * from public.rota_068_entregas('2026-11-26','2026-11-26')$c$,'42501','c motorista sem leitura global');
reset role;set role anon;
select qa.erro($c$select * from public.rota_068_entregas('2026-11-26','2026-11-26')$c$,'42501','c anon sem leitura');
reset role;set qa.uid='';set qa.role='service_role';set role service_role;
select qa.check(exists(select 1 from public.rota_068_entregas('2026-11-26','2026-11-26') where cd_pedido=683001),'c Edge le projecao canonica');
reset role;set qa.uid='11111111-1111-4111-8111-111111111111';set qa.role='authenticated';
update public.pedido_entrega_rota set data_entrega=public.rota_068_hoje()-181 where cd_pedido=683002;
select public.rota_068_entregas_limpar();
select qa.check((select cliente_nome is null from public.pedido_entrega_rota where cd_pedido=683002),'c nomeCPF expira180');
-- R2 NAO corrigir: dono decidiu que fechamento manual antecipado ja conta entregue.
create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select (now() at time zone 'America/Sao_Paulo')::date$$;
update public.rota_config set hora_saida='23:59' where id=1;
delete from public.rota_plano_semana;
delete from public.rota_dia_item where data=public.rota_050_hoje();
delete from public.rota_dia_fechada where data=public.rota_050_hoje();
insert into public.solidcon_pedidos_erp(cd_pedido,etapa,dt_pedido,dt_saida,cliente_tipo,cliente_nome,valor_centavos) values(683992,'atendido',now(),now(),'cnpj','Manualanteshora desejado',45600);
set role authenticated;
select public.rota_050_fechar('[{"cd_pedido":683992,"veiculo_id":"s10","ordem":1}]');
select qa.check(exists(select 1 from public.rota_068_entregas((now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date) where cd_pedido=683992 and status='entregue'),'c R2 dono confirma fechar manual antes hora ja entregue');
reset role;
create table qa.acervo_c as select (select count(*) from public.pedido_entrega_rota) entregas,(select count(*) from public.pedido_entrega_problema) problemas;
\ir ../../admin/migracoes/068_c_rollback.sql
\ir ../../admin/migracoes/068_c_rollback.sql
select qa.check((select pendente=pg_get_functiondef('public.rota_055_pendente(bigint,date)'::regprocedure) and ler=pg_get_functiondef('public.rota_063_ler_entregas(bigint[])'::regprocedure) from qa.antes063),'c rollback063 exato');
select qa.check((select entregas=(select count(*) from public.pedido_entrega_rota) and problemas=(select count(*) from public.pedido_entrega_problema) from qa.acervo_c),'c rollback conserva acervo');
\ir ../../admin/migracoes/068_c_entrega_automatica.sql
select qa.check(not public.rota_055_pendente(683001,'2026-11-26'),'c reaplicar nao perde entrega');
select count(*) as checks_c from qa.checks where nome like 'c %';
\endif
