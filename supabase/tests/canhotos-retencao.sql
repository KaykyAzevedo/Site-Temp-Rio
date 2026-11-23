\set ON_ERROR_STOP on
do $$begin if current_database() !~ '^sentinela_mot2_' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somente fixture local sentinela_mot2_*'; end if;end$$;
set timezone='America/Sao_Paulo';
begin;
insert into storage.objects(bucket_id,name,created_at) values
 ('canhotos','2024-01-01/11/11111111-1111-4111-8111-111111111111.jpg',now()-interval '2 years'),
 ('canhotos','2024-01-01/11/22222222-2222-4222-8222-222222222222.jpg',now()-interval '1 year'),
 ('canhotos','2024-01-01/11/33333333-3333-4333-8333-333333333333.jpg',now()-interval '7 months'),
 ('canhotos','2024-01-01/11/44444444-4444-4444-8444-444444444444.jpg',now()-interval '2 years'),
 ('canhotos','2024-01-01/11/55555555-5555-4555-8555-555555555555.jpg',now()-interval '2 years'),
 ('canhotos','2024-01-01/11/66666666-6666-4666-8666-666666666666.jpg',now()-interval '2 years'),
 ('outro','2024-01-01/11/77777777-7777-4777-8777-777777777777.jpg',now()-interval '2 years'),
 ('canhotos','2024-01-01/11/99999999-9999-4999-8999-999999999999.jpg',now()-interval '1 day');
insert into pedido_canhoto(cd_pedido,caminho,origem,enviado_em,substituido_em) values
 (11,'2024-01-01/11/11111111-1111-4111-8111-111111111111.jpg','painel',now()-interval '2 years',null),
 (11,'2024-01-01/11/22222222-2222-4222-8222-222222222222.jpg','painel',now()-interval '1 year',null),
 (11,'2024-01-01/11/33333333-3333-4333-8333-333333333333.jpg','painel',now()-interval '7 months',null),
 (11,'2024-01-01/11/44444444-4444-4444-8444-444444444444.jpg','painel',now()-interval '2 years',null),
 (22,'2024-01-01/11/44444444-4444-4444-8444-444444444444.jpg','painel',now()-interval '1 day',null),
 (11,'2024-01-01/11/66666666-6666-4666-8666-666666666666.jpg','painel',now()-interval '2 years',now()-interval '1 day'),
 (11,'2024-01-01/11/88888888-8888-4888-8888-888888888888.jpg','painel',now()-interval '2 years',null),
 (11,'2024-01-01/11/99999999-9999-4999-8999-999999999999.jpg','painel',now()-interval '2 years',null);
select qa.check(not has_function_privilege('authenticated','public.rota_052_limpeza_lote(integer)','execute'),'retencao painel nao inicia');
select qa.check(not has_function_privilege('anon','public.rota_052_limpeza_confirmar(uuid)','execute'),'retencao anon nao confirma');
select qa.erro($c$select rota_052_limpeza_lote(101)$c$,'22023','retencao limite de lote');
select rota_052_limpeza_lote(100) as lote \gset
select qa.check(jsonb_array_length(:'lote'::jsonb->'caminhos')=3,'retencao reserva apenas antigos sem referencia recente');
select qa.check((:'lote'::jsonb->>'linhas')::integer=3,'retencao vinculos orfaos ou compartilhados expirados');
select qa.check(not exists(select 1 from pedido_canhoto where caminho like '%/99999999-%') and exists(select 1 from storage.objects where name like '%/99999999-%'),'retencao vinculo antigo sai e arquivo recente permanece');
select qa.check((select count(*)=0 from pedido_canhoto where caminho like '%/88888888-%'),'retencao limpa metadado sem arquivo');
select qa.check((select count(*)=1 from pedido_canhoto where caminho like '%/44444444-%'),'retencao preserva referencia recente compartilhada');
select qa.check((select count(*)=1 from pedido_canhoto where caminho like '%/22222222-%'),'retencao fronteira exata de um ano preservada');
select qa.check((select count(*)=1 from pedido_canhoto where caminho like '%/33333333-%'),'retencao sete meses nao sao um ano');
select qa.erro(format('select rota_052_limpeza_confirmar(%L::uuid)',:'lote'::jsonb->>'token'),'40001','retencao nao apaga linha antes da API');
select qa.check((select count(*)=1 from pedido_canhoto where caminho like '%/11111111-%'),'retencao falha de API preserva vinculo');
select qa.check(jsonb_array_length(rota_052_limpeza_lote(100)->'caminhos')=0,'retencao lease impede lote duplicado');
set role authenticated;
set qa.papel='marcador';
select qa.erro($c$select rota_052_registrar('2024-01-01/11/11111111-1111-4111-8111-111111111111.jpg',array[11]::bigint[],false)$c$,'P5105','retencao impede vinculo durante expurgo');
with mudados as (update storage.objects set owner=auth.uid() where name='2024-01-01/11/11111111-1111-4111-8111-111111111111.jpg' returning name)
select qa.check((select count(*)=0 from mudados),'retencao impede sobrescrever arquivo reservado');
with mudados as (update storage.objects set name='2024-01-01/11/99999999-9999-4999-8999-999999999999.jpg' where name='2024-01-01/11/11111111-1111-4111-8111-111111111111.jpg' returning name)
select qa.check((select count(*)=0 from mudados),'retencao impede renomear arquivo reservado');
reset role;
update rota_052_expurgo set reservado_em=now()-interval '11 minutes' where concluido_em is null;
select rota_052_limpeza_lote(100) as retry \gset
select qa.check(jsonb_array_length(:'retry'::jsonb->'caminhos')=3,'retencao retry depois de lease vencido');
select qa.check(rota_052_limpeza_confirmar((:'lote'::jsonb->>'token')::uuid)=0,'retencao token antigo nao confirma novo lote');
-- SOMENTE stub local: esta exclusao de metadados SIMULA a API Storage.remove, nao existe arquivo fisico na fixture.
delete from storage.objects where bucket_id='canhotos' and name in
 (select jsonb_array_elements_text(:'retry'::jsonb->'caminhos'));
select qa.check(rota_052_limpeza_confirmar((:'retry'::jsonb->>'token')::uuid)=2,'retencao confirma apos remocao da API');
select qa.check(rota_052_limpeza_confirmar((:'retry'::jsonb->>'token')::uuid)=0,'retencao confirmar duas vezes idempotente');
select qa.check((select count(*)=0 from pedido_canhoto where caminho like '%/11111111-%' or caminho like '%/66666666-%'),'retencao linhas antigas apagadas');
select qa.check((select count(*)=1 from storage.objects where bucket_id='outro'),'retencao nao toca outro bucket');
select qa.check((select count(*)=1 from storage.objects where name like '%/44444444-%'),'retencao arquivo compartilhado recente mantido');
select qa.check(jsonb_array_length(rota_052_limpeza_lote(100)->'caminhos')=0,'retencao segunda execucao sem duplicar');
-- pg_net/Vault simulados: nenhuma chamada HTTP real.
create schema net;
create schema vault;
create table qa.http(url text,headers jsonb,body jsonb);
create view vault.decrypted_secrets as select * from (values
 ('project_url','https://example.supabase.co'),
 ('whatsapp_cron_token','somente-fixture-sem-segredo-real-1234567890')) s(name,decrypted_secret);
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer)
returns bigint language plpgsql as $$begin insert into qa.http values(url,headers,body);return 1;end$$;
select qa.check(rota_052_agendar_limpeza(),'retencao agendamento com Vault e net');
select qa.check((select url='https://example.supabase.co/functions/v1/canhotos-limpeza' and headers ? 'x-cron-token' from qa.http),'retencao endpoint e autenticacao do cron');
commit;
select count(*) as verificacoes_retencao from qa.checks where nome like 'retencao%';

