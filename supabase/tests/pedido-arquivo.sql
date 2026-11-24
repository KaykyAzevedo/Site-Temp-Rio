\set ON_ERROR_STOP on
\ir pedido-arquivo-base.sql
insert into storage.objects(bucket_id,name,owner) values('canhotos','2026-11-24/5001/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg','11111111-1111-4111-8111-111111111111');
select public.rota_052_registrar('2026-11-24/5001/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',array[5001]::bigint[],false);
select qa.check((select cliente_nome='Cliente Arquivo' and documento='11222333000181' and logradouro='Rua Teste' and valor_centavos=300960 and caixas_24=3 and nr_carga=123 from public.pedido_arquivo where cd_pedido=5001),'arquivo snapshot pedido completo no anexo');
select qa.check((select count(*)=1 from public.pedido_arquivo_foto where cd_pedido=5001),'arquivo foto vinculada atomicamente');
update public.solidcon_pedidos_erp set valor_centavos=400000,caixas_24=4 where cd_pedido=5001;
select qa.check((select valor_centavos=400000 and caixas_24=4 from public.pedido_arquivo where cd_pedido=5001),'arquivo atualiza fonte assinada');
-- Cadastro/documento pode faltar numa coleta posterior; desconhecido nao apaga prova anterior.
update public.solidcon_pedidos_erp set cliente_tipo='indefinido',documento=null,cliente_nome=null where cd_pedido=5001;
select qa.check((select cliente_tipo='cnpj' and documento='11222333000181' and cliente_nome='Cliente Arquivo' from public.pedido_arquivo where cd_pedido=5001),'arquivo sync indefinido nao apaga identificacao conhecida');
select qa.check((public.solidcon_receber_pedidos_erp('[]',now()-interval '1 minute','22222222-2222-4222-8222-222222222222')->>'status')='ok','arquivo sync039 real aceita substituicao');
select qa.check(not exists(select 1 from public.solidcon_pedidos_erp) and (select valor_centavos=400000 and cliente_nome='Cliente Arquivo' from public.pedido_arquivo where cd_pedido=5001),'arquivo sobrevive poda30dias');
select qa.check((select count(*)=1 from public.rota_057_buscar('5001',null,null,null,null,50)),'arquivo busca por pedido');
select qa.check((select count(*)=1 from public.rota_057_buscar('cliente arquivo',null,null,null,null,50)),'arquivo busca por cliente');
set role authenticated;set qa.papel='vendedor';
select qa.check((select count(*)=1 from public.pedido_arquivo where cd_pedido=5001),'arquivo equipe le');
select qa.erro($c$insert into public.pedido_arquivo(cd_pedido,ultimo_canhoto_em) values(1,now())$c$,'42501','arquivo equipe nao escreve direto');
set qa.papel='motorista';
select qa.check((select count(*)=0 from public.pedido_arquivo),'arquivo motorista sem historico global');
select qa.erro($c$select * from public.rota_057_buscar('5001')$c$,'42501','arquivo motorista sem busca global');
reset role;set qa.papel='marcador';
select qa.check(not has_table_privilege('anon','public.pedido_arquivo','select') and not has_function_privilege('anon','public.rota_057_buscar(text,date,date,timestamptz,bigint,integer)','execute'),'arquivo anon sem acesso');
select qa.check(not has_function_privilege('authenticated','public.rota_057_guardar(bigint[])','execute'),'arquivo snapshot privado');
insert into storage.objects(bucket_id,name) values('canhotos','2026-99-99/5001/14141414-1414-4414-8414-141414141414.jpg');
select public.rota_052_registrar('2026-99-99/5001/14141414-1414-4414-8414-141414141414.jpg',array[5001]::bigint[],false);
select qa.check((select count(*)=1 from public.pedido_arquivo_foto where cd_pedido=5001 and caminho like '2026-99-99%'),'arquivo aceita nome legado sem calendario sem inventar rota');
select qa.erro($c$insert into public.pedido_canhoto(cd_pedido,caminho,origem,rota_data,rota_veiculo) values(5001,'2026-11-24/5001/99999999-9999-4999-8999-999999999999.jpg','painel',current_date,'s10')$c$,'23514','arquivo contexto parcial recusado');
-- Campos pessoais que058/Problema2 passara a alimentar. Aqui somente dados sinteticos diretos.
alter table public.solidcon_pedidos_erp add column entrega_logradouro text,add column entrega_numero text,add column entrega_complemento text,
 add column entrega_bairro text,add column entrega_cidade text,add column entrega_uf text,add column entrega_cep text;
insert into public.solidcon_pedidos_erp(cd_pedido,dt_pedido,etapa,dt_saida,dt_atendido,cliente_tipo,documento,cliente_nome,valor_centavos,atualizado_em,
 entrega_logradouro,entrega_numero,entrega_bairro,entrega_cidade,entrega_uf,entrega_cep)
 values(5002,now()-interval '190 days','atendido',now()-interval '181 days',now()-interval '181 days','cpf',null,'Pessoa Ficticia',50000,now(),'Rua CPF','20','Barra','Rio','RJ','22770-000');
-- Para publicar na fixture, deixa a etapa pendente antiga sem semantica de faturamento055/056.
update public.solidcon_pedidos_erp set etapa='conferido',dt_conferencia=now() where cd_pedido=5002;
insert into public.rota_saida(data,veiculo_id,versao,paradas,resumo) values((now() at time zone 'America/Sao_Paulo')::date,'s10',7,'[{"ordem":1,"nome":"Pessoa Ficticia","endereco":"Rua CPF,20","pedidos":[5002]}]','{}');
insert into storage.objects(bucket_id,name,owner) values('canhotos',(now() at time zone 'America/Sao_Paulo')::date::text||'/5002/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.jpg',auth.uid());
set qa.papel='motorista';
select public.rota_052_registrar((now() at time zone 'America/Sao_Paulo')::date::text||'/5002/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.jpg',array[5002]::bigint[],false,'s10',7);
set qa.papel='marcador';
select qa.check((select cliente_tipo='cpf' and documento is null and cliente_nome='Pessoa Ficticia' and logradouro='Rua CPF' and cep='22770000' from public.pedido_arquivo where cd_pedido=5002),'arquivo CPF nome endereco sem documento');
select qa.check((select rota_versao=7 and veiculo_id='s10' and motorista_nome='Charles' and contexto_origem='anexo_motorista' from public.pedido_arquivo where cd_pedido=5002),'arquivo contexto motorista validado congelado');
update public.rota_motoristas set nome='Motorista Novo' where veiculo_id='s10';
-- Simula expurgo180dias da fonte (a regra sera entregue em058); arquivo tem prazo proprio1ano.
update public.solidcon_pedidos_erp set cliente_nome=null,entrega_logradouro=null,entrega_numero=null,entrega_bairro=null,entrega_cidade=null,entrega_uf=null,entrega_cep=null where cd_pedido=5002;
select qa.check((select cliente_nome='Pessoa Ficticia' and logradouro='Rua CPF' from public.pedido_arquivo where cd_pedido=5002),'arquivo retencao CPF independente de180dias');
select qa.check((select motorista_nome='Charles' from public.pedido_arquivo where cd_pedido=5002),'arquivo contexto nao muda com cadastro posterior');
delete from public.solidcon_pedidos_erp where cd_pedido=5002;
select qa.check((select cliente_nome='Pessoa Ficticia' and valor_centavos=50000 from public.pedido_arquivo where cd_pedido=5002),'arquivo CPF sobrevive poda da fonte');
select qa.check((select count(*)=1 from public.rota_057_buscar('5002',(now() at time zone 'America/Sao_Paulo')::date-182,(now() at time zone 'America/Sao_Paulo')::date-180,null,null,50)),'arquivo periodo usa faturamento SP');
select qa.erro($c$select * from public.rota_057_buscar('',null,null,null,null,102)$c$,'22023','arquivo busca limite validado');
-- Canhotos historicos sem fonte: placeholders honestos, nenhuma dependencia da janela atual.
insert into storage.objects(bucket_id,name,created_at) values
 ('canhotos','2024-01-01/6001/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg',now()-interval '2 years'),
 ('canhotos','2026-11-23/6001/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg',now()-interval '1 day');
insert into public.pedido_canhoto(cd_pedido,caminho,origem,enviado_em) values
 (6001,'2024-01-01/6001/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg','painel',now()-interval '2 years'),
 (6002,'2024-01-01/6001/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg','painel',now()-interval '2 years'),
 (6001,'2026-11-23/6001/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg','painel',now()-interval '1 day');
select qa.check((select dados_incompletos and valor_centavos is null and cliente_nome is null from public.pedido_arquivo where cd_pedido=6002),'arquivo legado incompleto nao inventa dados');
select public.rota_052_limpeza_lote(100) as protegido \gset
select qa.check(not exists(select 1 from jsonb_array_elements_text(:'protegido'::jsonb->'caminhos') x where x like '%bbbbbbbb%'),'arquivo ultimo canhoto protege foto antiga compartilhada');
select qa.check(exists(select 1 from public.pedido_arquivo where cd_pedido=6002),'arquivo foto compartilhada protege pedido antigo');
-- Envelhecimento SOMENTE da fixture; simula prazo vencido, nao arquivos fisicos.
update public.pedido_canhoto set enviado_em=now()-interval '2 years' where cd_pedido in(6001,6002);
update public.pedido_arquivo set ultimo_canhoto_em=now()-interval '2 years' where cd_pedido in(6001,6002);
update storage.objects set created_at=now()-interval '2 years' where name like '%cccccccc%';
select public.rota_052_limpeza_lote(100) as lote_arquivo \gset
select qa.check(jsonb_array_length(:'lote_arquivo'::jsonb->'caminhos')=2,'arquivo reserva pacote vencido');
select qa.erro(format('select public.rota_052_limpeza_confirmar(%L::uuid)',:'lote_arquivo'::jsonb->>'token'),'40001','arquivo falha API preserva pacote');
select qa.check((select count(*)=2 from public.pedido_arquivo where cd_pedido in(6001,6002)),'arquivo mantem dados enquanto foto existe');
insert into storage.objects(bucket_id,name) values('canhotos','2026-11-24/6001/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg');
select qa.erro($c$select public.rota_052_registrar('2026-11-24/6001/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg',array[6001]::bigint[],false)$c$,'P5105','arquivo novo anexo nao ressuscita pacote em expurgo');
-- Stub local da Storage API: somente metadados, sem arquivo real na fixture.
delete from storage.objects where bucket_id='canhotos' and name in(select jsonb_array_elements_text(:'lote_arquivo'::jsonb->'caminhos'));
select public.rota_052_limpeza_confirmar((:'lote_arquivo'::jsonb->>'token')::uuid);
select qa.check(not exists(select 1 from public.pedido_arquivo where cd_pedido in(6001,6002)) and not exists(select 1 from public.pedido_arquivo_foto where cd_pedido in(6001,6002)),'arquivo expurgo conjunto apos API');
select qa.check(public.rota_052_limpeza_confirmar((:'lote_arquivo'::jsonb->>'token')::uuid)=0,'arquivo confirmar retry idempotente');
select qa.check(exists(select 1 from public.pedido_arquivo where cd_pedido=5001),'arquivo nao toca comprovante recente');
select count(*) as checks_arquivo from qa.checks where nome like 'arquivo%';
