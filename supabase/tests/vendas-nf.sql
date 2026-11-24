\set ON_ERROR_STOP on
do $$begin
 if current_database() !~ '^sentinela_nf_' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somente fixture local sentinela_nf_*';end if;
end$$;
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
end$$;
create schema auth;create schema qa;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('qa.uid',true),'')::uuid$$;
create function public.eh_equipe() returns boolean language sql stable as $$select current_setting('qa.papel',true) in ('admin','vendedor','marcador')$$;
create function public.eh_admin() returns boolean language sql stable as $$select current_setting('qa.papel',true)='admin'$$;
create table public.integracoes_autorizadas(user_id uuid primary key);
create table public.solidcon_produtos(id integer);create table public.solidcon_sync(id integer);create table public.solidcon_clientes(documento text);
grant usage on schema public,auth,qa to anon,authenticated,service_role;
\ir ../../admin/migracoes/026_solidcon_vendas_clientes.sql
\ir ../../admin/migracoes/060_solidcon_vendas_nf.sql
\ir ../../admin/migracoes/060_solidcon_vendas_nf.sql
create table qa.checks(nome text primary key);
create function qa.check(ok boolean,nome text) returns void language plpgsql security definer as $$begin if ok is distinct from true then raise exception 'FAIL %',nome;end if;insert into qa.checks values(nome);end$$;
insert into public.integracoes_autorizadas values('11111111-1111-4111-8111-111111111111');
set qa.uid='11111111-1111-4111-8111-111111111111';set qa.papel='integracao';set timezone='America/Sao_Paulo';
create table qa.caso(payload jsonb,coleta timestamptz,execucao uuid);
insert into qa.caso values('[{"cd_nota":550,"numero":550,"serie":"1","dia":"2026-06-25","dt":"2026-06-25T18:30:00-03:00","documento":"37893563000166","cd_pedido":538,"valor_centavos":2164320,"total_nota_centavos":2421121,"st_centavos":233458,"nf_cupom":false}]',clock_timestamp()-interval '10 minutes','22222222-2222-4222-8222-222222222222');
select qa.check((select solidcon_receber_vendas_nf('2026-06-25','2026-06-25',payload,coleta,execucao)->>'status'='ok' from qa.caso),'NF550 aceita');
select qa.check((select valor_centavos=2164320 and total_nota_centavos=2421121 and st_centavos=233458 and cd_pedido=538 and dia='2026-06-25' from solidcon_vendas_nf where cd_nota=550),'NF550 produtos total ST distintos');
select qa.check((select count(*)=1 from solidcon_vendas_nf_dias),'cobertura apos carga');
set timezone='UTC';
select qa.check((select (solidcon_receber_vendas_nf('2026-06-25','2026-06-25',payload,coleta,execucao)->>'repetido')::boolean from qa.caso),'replay mesmo payload outro timezone');
select qa.check((select count(*)=1 from solidcon_vendas_nf_sync where status='ok'),'replay sem novo log');
select qa.check((select solidcon_receber_vendas_nf('2026-06-25','2026-06-25',jsonb_set(payload,'{0,numero}','551'),coleta,execucao)->>'motivo'='conflito_execucao' from qa.caso),'execucao divergente recusada');
select qa.check((select solidcon_receber_vendas_nf('2026-06-25','2026-06-25',payload,coleta-interval '1 minute',gen_random_uuid())->>'motivo'='snapshot_antigo' from qa.caso),'snapshot velho recusado');
select qa.check((select numero=550 from solidcon_vendas_nf where cd_nota=550),'erros preservam nota');
create function qa.tentar(p jsonb) returns jsonb language sql as $$select public.solidcon_receber_vendas_nf('2026-06-25','2026-06-25',p,clock_timestamp(),gen_random_uuid())$$;
select qa.check((select qa.tentar(payload||payload)->>'motivo'='nota_duplicada' from qa.caso),'duplicata falha antes delete');
select qa.check((select qa.tentar(jsonb_set(payload,'{0,documento}','"00000000191"'))->>'status'='erro' from qa.caso),'CPF recusado');
select qa.check((select qa.tentar(jsonb_set(payload,'{0,nome}','"nao enviar"'))->>'motivo'='campos_invalidos' from qa.caso),'campo extra recusado');
select qa.check((select qa.tentar(jsonb_set(payload,'{0,dia}','"2026-06-26"'))->>'motivo'='data_invalida' from qa.caso),'dia fora da janela recusado');
select qa.check((select qa.tentar(jsonb_set(payload,'{0,dt}','"2026-06-26T03:00:00Z"'))->>'motivo'='data_invalida' from qa.caso),'dt noutro diaSP recusado');
select qa.check((select qa.tentar(jsonb_set(payload,'{0,valor_centavos}','-1'))->>'motivo'='numero_invalido' from qa.caso),'dinheiro negativo recusado');
select qa.check((select qa.tentar(payload#-'{0,dt}')->>'motivo'='campos_invalidos' from qa.caso),'obrigatorio ausente recusado');
select qa.check((select qa.tentar(jsonb_set(payload,'{0,nf_cupom}','null'))->>'motivo'='nota_invalida' from qa.caso),'booleano null recusado');
select qa.check(solidcon_receber_vendas_nf('2026-06-25','2026-07-26','[]',clock_timestamp(),gen_random_uuid())->>'motivo'='intervalo_invalido','32dias recusados');
select qa.check((select count(*)=1 from solidcon_vendas_nf),'todos erros preservam dados');
-- Cancelamento posterior e uma janela valida vazia: elimina a antiga, mantendo dia coberto.
select qa.check(qa.tentar('[]')->>'status'='ok','janela vazia aceita');
select qa.check(not exists(select from solidcon_vendas_nf) and exists(select from solidcon_vendas_nf_dias where dia='2026-06-25'),'cancelamento retira venda e preserva cobertura');
select qa.check((select solidcon_receber_vendas_nf('2026-06-25','2026-06-25',payload,coleta,execucao)->>'status'='ok' from qa.caso) and not exists(select from solidcon_vendas_nf),'replay antigo nao ressuscita venda');
select qa.check((select qa.tentar(payload)->>'status'='ok' from qa.caso),'nova coleta restaura nota valida');
select qa.check((select qa.tentar(jsonb_set(payload,'{0,st_centavos}','null'))->>'status'='ok' from qa.caso),'ST null aceita');
select qa.check((select st_centavos is null from solidcon_vendas_nf where cd_nota=550),'ST null permanece desconhecida');
select qa.check((select solidcon_receber_vendas_nf('2026-06-26','2026-06-26',jsonb_set(jsonb_set(payload,'{0,dia}','"2026-06-26"'),'{0,dt}','"2026-06-26T00:00:00-03:00"'),clock_timestamp(),gen_random_uuid())->>'status'='ok' from qa.caso),'nota muda dia');
select qa.check((select count(*)=1 and min(dia)=date '2026-06-26' from solidcon_vendas_nf),'mesma nota movida nao duplica');
set role authenticated;set qa.papel='vendedor';
select qa.check((select count(*)=1 from public.solidcon_vendas_nf),'equipe le NF');
select qa.check((select count(*)=2 from public.solidcon_vendas_nf_dias),'equipe le cobertura');
select qa.check(jsonb_array_length(public.solidcon_ler_vendas_nf()->'notas')=1 and jsonb_array_length(public.solidcon_ler_vendas_nf()->'dias')=2,'RPC unico snapshot NF cobertura');
select qa.check((select not prosecdef and provolatile='s' from pg_proc where oid='public.solidcon_ler_vendas_nf()'::regprocedure),'leitura stable invoker');
set qa.papel='motorista';
select qa.check(not exists(select from public.solidcon_vendas_nf) and not exists(select from public.solidcon_vendas_nf_dias),'motorista sem leitura global');
do $$declare negado boolean:=false;begin begin perform public.solidcon_ler_vendas_nf();exception when insufficient_privilege then negado:=true;end;perform qa.check(negado,'motorista sem acesso ao RPC de leitura');end$$;
reset role;
select qa.check(not has_table_privilege('anon','public.solidcon_vendas_nf','select') and not has_table_privilege('authenticated','public.solidcon_vendas_nf','insert'),'sem anon/escrita direta');
select qa.check(not has_function_privilege('anon','public.solidcon_receber_vendas_nf(date,date,jsonb,timestamptz,uuid)','execute'),'RPC nao anonima');
select qa.check(not has_function_privilege('anon','public.solidcon_ler_vendas_nf()','execute'),'leitura RPC nao anonima');
set qa.uid='33333333-3333-4333-8333-333333333333';
do $$declare negado boolean:=false;begin begin perform public.solidcon_receber_vendas_nf('2026-06-25','2026-06-25','[]',clock_timestamp(),gen_random_uuid());exception when insufficient_privilege then negado:=true;end;perform qa.check(negado,'usuario fora da integracao recusado');end$$;
set qa.uid='11111111-1111-4111-8111-111111111111';
create temporary table antes as select to_jsonb(n) dados from public.solidcon_vendas_nf n;
\ir ../../admin/migracoes/060_rollback.sql
\ir ../../admin/migracoes/060_rollback.sql
select qa.check((select jsonb_agg(dados) from antes)=(select jsonb_agg(to_jsonb(n)) from public.solidcon_vendas_nf n),'rollback preserva notas');
select qa.check(to_regprocedure('public.solidcon_receber_vendas_nf(date,date,jsonb,timestamptz,uuid)') is null,'rollback desliga envio');
\ir ../../admin/migracoes/060_solidcon_vendas_nf.sql
select qa.check((select count(*)=1 from public.solidcon_vendas_nf),'reaplicacao preserva notas');
-- Apenas fixture: relaxa data minima de inicio da coleta para injetar um registro ja expirado.
-- Em producao, datas antes de maio2026 nem sao aceitas; simula o que existira apos400dias.
alter table public.solidcon_vendas_nf drop constraint solidcon_vendas_nf_dia_check;
insert into public.solidcon_vendas_nf(cd_nota,numero,serie,dia,dt,documento,valor_centavos,total_nota_centavos,st_centavos,nf_cupom,coletado_em)
select 900001,1,'1',d,(d+time '12:00') at time zone 'America/Sao_Paulo','11222333000181',100,110,10,false,now()
from (select (now() at time zone 'America/Sao_Paulo')::date-401 d) x;
insert into public.solidcon_vendas_nf(cd_nota,numero,serie,dia,dt,documento,valor_centavos,total_nota_centavos,st_centavos,nf_cupom,coletado_em)
select 900002,2,'1',d,(d+time '12:00') at time zone 'America/Sao_Paulo','11222333000181',100,110,10,false,now()
from (select (now() at time zone 'America/Sao_Paulo')::date-400 d) x;
-- Expurgo pelo diaSP, sem depender da existencia de dados anteriores a maio2026 neste teste.
insert into public.solidcon_vendas_nf_dias values((now() at time zone 'America/Sao_Paulo')::date-401,now(),gen_random_uuid());
select public.solidcon_060_limpar();
select qa.check(not exists(select from public.solidcon_vendas_nf_dias where dia<(now() at time zone 'America/Sao_Paulo')::date-400),'expurgo cobertura400dias');
select qa.check(not exists(select from public.solidcon_vendas_nf where cd_nota=900001) and exists(select from public.solidcon_vendas_nf where cd_nota=900002),'expurgo401 preserva400dias');
delete from public.solidcon_vendas_nf where cd_nota=900002;
alter table public.solidcon_vendas_nf add constraint solidcon_vendas_nf_dia_check check(dia>=date '2026-05-29');
select count(*) checks_nf from qa.checks;
