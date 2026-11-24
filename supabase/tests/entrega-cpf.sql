\set ON_ERROR_STOP on
-- Somente PG18 isolado, sem ERP/Supabase. Infra real057 com stubs Auth/Storage.
\ir pedido-arquivo.sql
do $$begin if current_database() !~ '^sentinela_separando_cpf' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somente fixture CPF local';end if;end$$;
alter table public.solidcon_clientes add column telefone text,add column celular text,add column email text,add column coletado_em timestamptz default now();
create table public.solidcon_clientes_sync(id bigint generated always as identity primary key,status text,linhas integer,coletado_em timestamptz,execucao_id uuid,mensagem text,em timestamptz default now());
alter table public.solidcon_clientes enable row level security;
revoke all on public.solidcon_clientes from public,anon,authenticated;
grant select on public.solidcon_clientes to authenticated;
create policy cpf_fixture_equipe on public.solidcon_clientes for select to authenticated using(public.eh_equipe());
-- Copia o receptor027 antes058 apenas como dependencia da instalacao/rollback.
create function public.solidcon_receber_clientes(jsonb,timestamptz,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
\ir ../../admin/migracoes/058_entrega_cpf.sql
\ir ../../admin/migracoes/058_entrega_cpf.sql
set qa.papel='marcador';set qa.uid='11111111-1111-4111-8111-111111111111';
delete from public.solidcon_pedidos_erp;
create sequence qa.cpf_coletas;
create function qa.pedido058(p_cd bigint,p_key text,p_fat timestamptz default null) returns jsonb language sql as $$
 select jsonb_build_object('cd_pedido',p_cd,'dt_pedido',coalesce(p_fat,now())-interval '1 day','etapa',case when p_fat is null then 'aberto' else 'atendido' end,
 'dt_carga',null,'dt_sep_inicio',null,'dt_sep_fim',null,'dt_conferencia',null,'dt_saida',p_fat,'dt_nota',p_fat,'dt_atendido',p_fat,
 'cliente_tipo','cpf','documento',null,'valor_centavos',12300,'nr_carga',null,'pessoa_chave',p_key)
$$;
create function qa.receber058(p jsonb) returns jsonb language sql as $$select public.solidcon_receber_pedidos_erp(p,clock_timestamp()+nextval('qa.cpf_coletas')*interval '1 second',gen_random_uuid())$$;
create function qa.cliente058(p_doc text,p_key text,p_nome text default 'Pessoa Ficticia') returns jsonb language sql as $$
 select jsonb_build_object('documento',p_doc,'tipo','cpf','nome',p_nome,'telefone','21999999999','celular',null,'email',null,
 'logradouro','Rua CPF QA','numero','20','complemento','Casa','bairro','Barra','cidade','Rio','estado','RJ','cep','22770000','pessoa_chave',p_key)
$$;
create function qa.clientes058(p jsonb) returns jsonb language sql as $$select public.solidcon_receber_clientes(p,clock_timestamp()+nextval('qa.cpf_coletas')*interval '1 second',gen_random_uuid())$$;
select qa.check((qa.clientes058(jsonb_build_array(qa.cliente058('01234567890',repeat('a',64))))->>'status')='ok','cpf cadastro recebe chave/endereco');
select qa.check((qa.receber058(jsonb_build_array(qa.pedido058(10001,repeat('a',64))))->>'status')='ok','cpf pedido recebe HMAC sem CPF');
select qa.check((select documento is null and cliente_nome='Pessoa Ficticia' and entrega_logradouro='Rua CPF QA' and entrega_numero='20' and entrega_cep='22770000' from public.solidcon_pedidos_erp where cd_pedido=10001),'cpf fonte enriquece por HMAC');
select qa.check((select count(*)=0 from public.solidcon_pessoa_retencao where to_jsonb(solidcon_pessoa_retencao)::text like '%01234567890%'),'cpf memoria tecnica sem documento');
select qa.check((qa.receber058(jsonb_build_array(qa.pedido058(10001,repeat('a',64))||jsonb_build_object('documento','01234567890')))->>'status')='erro','cpf documento no pedido recusado');
select qa.check((qa.receber058(jsonb_build_array(qa.pedido058(10001,repeat('a',64))||jsonb_build_object('cliente_nome','injetado')))->>'status')='erro','cpf nome arbitrario no payload recusado');
select qa.check((qa.receber058(jsonb_build_array(qa.pedido058(10001,'01234567890')))->>'status')='erro','cpf chave nao HMAC recusada');
select qa.check((qa.clientes058(jsonb_build_array(qa.cliente058('01234567890',repeat('b',64))))->>'motivo')='chave_pessoa_divergente','cpf rotacao acidental de segredo recusada');
-- Cliente chega depois do pedido: completa fonte sem novo GET/payload de pedidos.
select qa.check((qa.receber058(jsonb_build_array(qa.pedido058(10002,repeat('b',64))))->>'status')='ok','cpf pedido antes cadastro aceito sem inventar dados');
select qa.check((select cliente_nome is null and entrega_logradouro is null from public.solidcon_pedidos_erp where cd_pedido=10002),'cpf nao usa cliente por nome nem outro HMAC');
select qa.check((qa.clientes058(jsonb_build_array(qa.cliente058('12345678901',repeat('b',64),'Pessoa Dois')))->>'status')='ok','cpf cadastro atrasado aceito');
select qa.check((select cliente_nome='Pessoa Dois' and entrega_complemento='Casa' from public.solidcon_pedidos_erp where cd_pedido=10002),'cpf cadastro atrasado completa pedido');
-- Canhoto antes de expirar: arquivo057 retencao propria, independente dos dados da fonte.
insert into storage.objects(bucket_id,name) values('canhotos','2026-11-24/10002/58585858-5858-4858-8858-585858585858.jpg');
select public.rota_052_registrar('2026-11-24/10002/58585858-5858-4858-8858-585858585858.jpg',array[10002]::bigint[],false);
select qa.check((select cliente_nome='Pessoa Dois' and logradouro='Rua CPF QA' and documento is null and endereco_origem='cadastro' from public.pedido_arquivo where cd_pedido=10002),'cpf arquivo057 captura sem documento e origem correta');
-- Envelhece faturamento da fixture e testa replay de pedido/API antigos.
update public.solidcon_pedidos_erp set dt_saida=now()-interval '181 days',dt_nota=now()-interval '181 days',dt_atendido=now()-interval '181 days' where cd_pedido=10002;
select public.solidcon_058_limpar();
select qa.check((select cliente_nome is null and pessoa_chave is null and entrega_logradouro is null from public.solidcon_pedidos_erp where cd_pedido=10002),'cpf fonte expurgada180dias');
select qa.check(not exists(select 1 from public.solidcon_clientes where pessoa_chave=repeat('b',64)),'cpf cadastro contatos documento removidos no prazo');
select qa.check((select cliente_nome='Pessoa Dois' and logradouro='Rua CPF QA' from public.pedido_arquivo where cd_pedido=10002),'cpf arquivo057 preservado1ano apos expurgo180');
select qa.check((qa.clientes058(jsonb_build_array(qa.cliente058('12345678901',repeat('b',64),'Pessoa Dois')))->>'status')='ok','cpf replay cadastro processado sem ressuscitar');
select qa.check(not exists(select 1 from public.solidcon_clientes where documento='12345678901'),'cpf replay nao repoe PII expirada');
select qa.check((qa.receber058(jsonb_build_array(qa.pedido058(10002,repeat('b',64),now()-interval '181 days'))))->>'motivo'='pedido_fora_da_janela','cpf replay antigo recusado pela janela039 preservada');
select qa.check((select cliente_nome is null and pessoa_chave is null and entrega_bairro is null from public.solidcon_pedidos_erp where cd_pedido=10002),'cpf replay pedido nao repoe PII');
-- Pedido novo reabre necessidade operacional; API pode voltar a preencher apos chegar atividade.
select qa.check((qa.receber058(jsonb_build_array(qa.pedido058(10003,repeat('b',64))))->>'status')='ok','cpf novo pedido aberto permite nova entrega');
select qa.check((qa.clientes058(jsonb_build_array(qa.cliente058('12345678901',repeat('b',64),'Pessoa Dois')))->>'status')='ok','cpf nova atividade permite cadastro');
select qa.check((select cliente_nome='Pessoa Dois' from public.solidcon_pedidos_erp where cd_pedido=10003),'cpf pedido novo recebe nome');
-- Cadastro com novo faturamento renova prazo mesmo depois da poda30dias.
select qa.check((qa.receber058(jsonb_build_array(qa.pedido058(10003,repeat('b',64),now())))->>'status')='ok','cpf novo faturamento atualiza prazo');
delete from public.solidcon_pedidos_erp where cd_pedido=10003;
select public.solidcon_058_limpar();
select qa.check(exists(select 1 from public.solidcon_clientes where pessoa_chave=repeat('b',64)),'cpf memoria faturamento sobrevive poda30dias');
select qa.check(not has_table_privilege('authenticated','public.solidcon_pessoa_retencao','select') and not has_function_privilege('authenticated','public.solidcon_058_limpar()','execute'),'cpf equipe sem memoria HMAC/cron direto');
select qa.check(not has_table_privilege('anon','public.solidcon_pessoa_retencao','select') and not has_table_privilege('anon','public.solidcon_pedidos_erp','select'),'cpf anon sem dados');
set role authenticated;set qa.papel='motorista';
select qa.check((select count(*)=0 from public.solidcon_clientes) and(select count(*)=0 from public.solidcon_pedidos_erp),'cpf motorista sem fontes globais');
select qa.erro($c$select public.solidcon_058_limpar()$c$,'42501','cpf cron privado sem execucao de equipe');
reset role;set qa.papel='marcador';
-- Sem pedido conhecido, prazo comeca na primeira observacao e nao renova a cada API.
select qa.check((qa.clientes058(jsonb_build_array(qa.cliente058('23456789012',repeat('c',64),'Sem Pedido')))->>'status')='ok','cpf sem pedido inicia observacao');
update public.solidcon_pessoa_retencao set primeira_em=now()-interval '181 days' where chave=repeat('c',64);
select public.solidcon_058_limpar();
select qa.check(not exists(select 1 from public.solidcon_clientes where pessoa_chave=repeat('c',64)),'cpf sem pedido expira180dias da primeira observacao');
select qa.check((qa.clientes058(jsonb_build_array(qa.cliente058('23456789012',repeat('c',64),'Sem Pedido')))->>'status')='ok' and not exists(select 1 from public.solidcon_clientes where pessoa_chave=repeat('c',64)),'cpf API diaria nao renova prazo sem pedido');
-- Coletor antigo apos ativacao nao ressuscita CPF sem HMAC.
select qa.check((qa.clientes058(jsonb_build_array((qa.cliente058('23456789012',null,'Sem Pedido')-'pessoa_chave')||jsonb_build_object('logradouro',null,'numero',null,'complemento',null,'cep',null)))->>'status')='ok','cpf payload027 legado ainda processado');
select qa.check(not exists(select 1 from public.solidcon_clientes where documento='23456789012'),'cpf legado nao ressuscita expirados apos ativacao');
select qa.check((qa.clientes058(jsonb_build_array(jsonb_build_object('documento','11222333000181','tipo','cnpj','nome','Empresa QA','telefone',null,'celular',null,'email',null,'cidade','Rio','bairro','Barra','estado','RJ')))->>'status')='ok','cpf cadastro CNPJ027 antigo aceito');
select qa.check((qa.receber058(jsonb_build_array((qa.pedido058(10005,null)-'pessoa_chave')||jsonb_build_object('cliente_tipo','cnpj','documento','11222333000181')))->>'status')='ok','cpf pedido CNPJ039 antigo aceito');
select qa.check((select cliente_nome='Empresa QA' and documento='11222333000181' and pessoa_chave is null from public.solidcon_pedidos_erp where cd_pedido=10005),'cpf CNPJ nome/documento anteriores preservados');
-- Fronteira exata em transacao, independente do timezone de sessao.
begin;
set local timezone='UTC';
select qa.check(not public.solidcon_058_vencido(((now() at time zone 'America/Sao_Paulo')-interval '180 days') at time zone 'America/Sao_Paulo'),'cpf fronteira180dias inclusiva SP');
select qa.check(public.solidcon_058_vencido(now()-interval '180 days 1 second'),'cpf depois180dias expira');
commit;
select count(*) as checks_cpf from qa.checks where nome like 'cpf%';
