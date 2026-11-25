\set ON_ERROR_STOP on
-- Herda guard localhost/DB sentinela_nf_* e as migracoes reais026/060 + sua regressao.
\ir vendas-nf.sql
set search_path=public,pg_catalog;
alter table solidcon_clientes add primary key(documento),add column tipo text,add column nome text,
 add column bairro text,add column cidade text,add column estado text,add column logradouro text,
 add column numero text,add column cep text;
create table solidcon_clientes_geo(documento text primary key,lat numeric,lng numeric,precisao text,chave_endereco text);
create table solidcon_fornecedores(documento text primary key);
-- Stubs de geocodificacao/qualidade: este teste isola somente a fonte de compras da RPC.
create function solidcon_033_chave_endereco(text,text,text,text,text,text) returns text language sql immutable as $$select 'endereco-atual'::text$$;
create function solidcon_037_avaliacao() returns table(documento text,qualidade text,motivos text[])
 language sql stable security invoker as $$select c.documento,'boa'::text,'{}'::text[] from public.solidcon_clientes c$$;
grant select on solidcon_clientes,solidcon_clientes_geo,solidcon_fornecedores to authenticated;
alter table solidcon_clientes enable row level security;
alter table solidcon_clientes_geo enable row level security;
alter table solidcon_fornecedores enable row level security;
create policy mapa_equipe on solidcon_clientes for select to authenticated using((select eh_equipe()));
create policy mapa_equipe on solidcon_clientes_geo for select to authenticated using((select eh_equipe()));
create policy mapa_equipe on solidcon_fornecedores for select to authenticated using((select eh_equipe()));
delete from solidcon_vendas_nf;delete from solidcon_vendas_clientes;
insert into solidcon_clientes(documento,tipo,nome,bairro,cidade,estado) values
 ('37893563000166','cnpj','TATAIS JULIETA','Centro','Petropolis','RJ'),
 ('04252011000110','cnpj','FICTICIO SO PDV','Centro','Petropolis','RJ'),
 ('11222333000181','cnpj','FICTICIO MISTO','Centro','Petropolis','RJ'),
 ('11444777000161','cnpj','FICTICIO FORNECEDOR','Centro','Petropolis','RJ'),
 ('55000000000005','cnpj','FICTICIO SEM COMPRA','Centro','Petropolis','RJ'),
 ('52998224725','cpf','FICTICIO CPF','Centro','Petropolis','RJ');
insert into solidcon_clientes_geo values
 ('37893563000166',-22.5,-43.2,'manual','endereco-atual'),
 ('04252011000110',-22.6,-43.3,'manual','endereco-velho');
insert into solidcon_fornecedores values('11444777000161');
insert into solidcon_clientes(documento,tipo,nome) values('18285535000111','cnpj','Vida em Graos QA');
insert into solidcon_fornecedores values('18285535000111');
insert into solidcon_vendas_clientes(dia,dt,documento,tipo,valor_centavos,total_itens,cd_pdv,nr_cupom,coletado_em) values
 ('2026-06-25','2026-06-25T12:00-03','04252011000110','cnpj',10000,1,1,1,now()),
 ('2026-07-02','2026-07-02T12:00-03','04252011000110','cnpj',20000,1,1,2,now()),
 ('2026-06-25','2026-06-25T12:00-03','11222333000181','cnpj',5000,1,1,3,now()),
 ('2026-06-25','2026-06-25T12:00-03','52998224725','cpf',999999,1,1,4,now());
insert into solidcon_vendas_nf(cd_nota,numero,serie,dia,dt,documento,valor_centavos,total_nota_centavos,st_centavos,nf_cupom,coletado_em) values
 (550,550,'1','2026-06-25','2026-06-25T18:30-03','37893563000166',2164320,2421121,233458,false,now()),
 (551,551,'1','2026-07-01','2026-07-01T12:00-03','37893563000166',10000,12500,2000,false,now()),
 (552,552,'1','2026-06-25','2026-06-25T12:00-03','11222333000181',7000,9000,1000,false,now()),
 (553,553,'1','2026-06-25','2026-06-25T12:00-03','11222333000181',5000,6000,500,true,now()),
 (554,554,'1','2026-06-25','2026-06-25T12:00-03','11444777000161',90000,99000,1000,false,now());
-- Cenario de regressao comercial:44 NF/R$933k de fornecedor nao viram cliente.
insert into solidcon_vendas_nf(cd_nota,numero,serie,dia,dt,documento,valor_centavos,total_nota_centavos,st_centavos,nf_cupom,coletado_em)
select 880000+n,700+n,'1',date '2026-06-25','2026-06-25T12:00-03'::timestamptz,'18285535000111',
 2120454+case when n<=24 then 1 else 0 end,2121454,1000,false,now() from generate_series(1,44) n;
-- Instala exatamente a RPC publicada041 (o rollback062 contem o corpo original).
\ir ../../admin/migracoes/062_rollback.sql
set qa.papel='vendedor';set qa.uid='11111111-1111-4111-8111-111111111111';
create temporary table mapa_antes as select * from solidcon_mapa_clientes();
create temporary table func_antes as select p.oid,p.proacl,pg_get_functiondef(p.oid) corpo,
 pg_get_function_result(p.oid) resultado,p.proargnames,p.proallargtypes,p.proconfig
 from pg_proc p where p.oid='public.solidcon_mapa_clientes()'::regprocedure;
create temporary table rpc_nf_antes as select pg_get_functiondef(p.oid) corpo,p.oid,p.proacl,p.proconfig,p.prosecdef,pg_get_function_result(p.oid) resultado
 from pg_proc p where p.oid='public.solidcon_ler_vendas_nf()'::regprocedure;
create temporary table cobertura_062 as select solidcon_ler_vendas_nf()->'dias' dias;
grant select on cobertura_062,rpc_nf_antes to authenticated;
select qa.check((select count(*)=44 from jsonb_array_elements(solidcon_ler_vendas_nf()->'notas') n where n->>'documento'='18285535000111'),'062 repro RPC060 antiga expunha fornecedor NF');
-- Repro: sem062, NF550 existe e Tatais continua zerada. Cliente PDV funciona.
select qa.check((select total_centavos=0 and cupons=0 and primeira_compra is null from mapa_antes where documento='37893563000166'),'062 repro Tatais sem compra antes');
select qa.check((select total_centavos=30000 and cupons=2 from mapa_antes where documento='04252011000110'),'062 controle PDV antes');
\ir ../../admin/migracoes/062_mapa_clientes_nf.sql
\ir ../../admin/migracoes/062_mapa_clientes_nf.sql
select qa.check((select p.oid=a.oid and p.proacl=a.proacl and p.proargnames=a.proargnames and p.proallargtypes=a.proallargtypes
 and pg_get_function_result(p.oid)=a.resultado and p.proconfig=a.proconfig and not p.prosecdef and p.provolatile='s'
 from pg_proc p cross join func_antes a where p.oid='public.solidcon_mapa_clientes()'::regprocedure),'062 OID assinatura colunas ACL search_path invoker stable iguais');
set role authenticated;
create temporary table mapa_depois as select * from solidcon_mapa_clientes();
select qa.check(not exists(select from jsonb_array_elements(solidcon_ler_vendas_nf()->'notas') n where n->>'documento' in('18285535000111','11444777000161')),'062 RPC comercial exclui fornecedor antes da paginacao');
select qa.check(not exists(select from mapa_depois where documento='18285535000111'),'062 Vida em Graos nao vira cliente no mapa');
select qa.check((select solidcon_ler_vendas_nf()->'dias'=dias from cobertura_062),'062 cobertura preservada mesmo excluindo fornecedor');
select qa.check((select p.oid=a.oid and p.proacl=a.proacl and p.proconfig=a.proconfig and p.prosecdef=a.prosecdef and pg_get_function_result(p.oid)=a.resultado
 from pg_proc p cross join rpc_nf_antes a where p.oid='public.solidcon_ler_vendas_nf()'::regprocedure),'062 RPC060 assinatura ACL invoker preservados');
select qa.check((select total_centavos=2174320 and cupons=2 and primeira_compra='2026-06-25' and ultima_compra='2026-07-01'
 and meses='{"2026-06":[2164320,1],"2026-07":[10000,1]}'::jsonb from mapa_depois where documento='37893563000166'),'062 Tatais produtos datas meses documentos');
select qa.check((select total_centavos=12000 and cupons=2 and meses='{"2026-06":[12000,2]}'::jsonb from mapa_depois where documento='11222333000181'),'062 misto mesmo mes agrega e exclui NF cupom');
select qa.check((select total_centavos=30000 and cupons=2 and meses='{"2026-06":[10000,1],"2026-07":[20000,1]}'::jsonb from mapa_depois where documento='04252011000110'),'062 so PDV invariavel');
select qa.check((select lat=-22.5 and lng=-43.2 and precisao='manual' and not pino_desatualizado and qualidade='boa' from mapa_depois where documento='37893563000166'),'062 pino qualidade preservados');
select qa.check((select lat is null and lng is null and pino_desatualizado from mapa_depois where documento='04252011000110'),'062 pino velho continua invalido');
select qa.check((select total_centavos=0 and cupons=0 and meses='{}'::jsonb and primeira_compra is null and ultima_compra is null from mapa_depois where documento='55000000000005'),'062 sem compra continua zero');
select qa.check(not exists(select from mapa_depois where documento in('11444777000161','52998224725')),'062 fornecedor e CPF nao entram');
select qa.check((select count(*)=4 from mapa_depois),'062 cardinalidade sem cliente duplicado');
reset role;
delete from solidcon_fornecedores where documento='18285535000111';
select qa.check((select count(*)=44 from jsonb_array_elements(solidcon_ler_vendas_nf()->'notas') n where n->>'documento'='18285535000111'),'062 desmarcar fornecedor reabilita historico sem apagar NF');
insert into solidcon_fornecedores values('18285535000111');
-- Comparacao integral PDV e das colunas de cadastro/geo, nao so total.
select qa.check(not exists((select * from mapa_antes where documento='04252011000110' except select * from mapa_depois where documento='04252011000110')
 union all (select * from mapa_depois where documento='04252011000110' except select * from mapa_antes where documento='04252011000110')),'062 PDV todas colunas iguais');
-- Mesmo schema/assinatura e soma baseados em dia, independentemente do fuso da sessao.
set timezone='UTC';
select qa.check((select meses='{"2026-06":[2164320,1],"2026-07":[10000,1]}'::jsonb from solidcon_mapa_clientes() where documento='37893563000166'),'062 competencia nao muda UTC');
select qa.check(not has_function_privilege('anon','public.solidcon_mapa_clientes()','execute'),'062 anon sem grant');
do $$declare erro text;begin
 perform set_config('qa.uid','',false);
 begin perform * from solidcon_mapa_clientes();exception when others then get stacked diagnostics erro=returned_sqlstate;end;
 perform qa.check(erro='42501','062 sem UID recusado');
 perform set_config('qa.uid','11111111-1111-4111-8111-111111111111',false);
end$$;
set role authenticated;set qa.papel='motorista';
do $$declare erro text;begin
 begin perform * from solidcon_mapa_clientes();exception when others then get stacked diagnostics erro=returned_sqlstate;end;
 perform qa.check(erro='42501','062 motorista recusado');
end$$;
select qa.check(not exists(select from solidcon_vendas_nf),'062 motorista RLS NF sem linhas');
reset role;set qa.papel='vendedor';
create temporary table dados_062 as select (select count(*) from solidcon_vendas_nf) notas,(select count(*) from solidcon_vendas_clientes) pdv;
\ir ../../admin/migracoes/062_rollback.sql
\ir ../../admin/migracoes/062_rollback.sql
select qa.check((select pg_get_functiondef('public.solidcon_mapa_clientes()'::regprocedure)=corpo from func_antes),'062 rollback corpo041 exato');
select qa.check((select pg_get_functiondef('public.solidcon_ler_vendas_nf()'::regprocedure)=corpo from rpc_nf_antes),'062 rollback RPC060 corpo exato');
select qa.check(not exists((select * from solidcon_mapa_clientes() except select * from mapa_antes)
 union all(select * from mapa_antes except select * from solidcon_mapa_clientes())),'062 rollback resultado anterior exato');
\ir ../../admin/migracoes/062_mapa_clientes_nf.sql
select qa.check((select notas=(select count(*) from solidcon_vendas_nf) and pdv=(select count(*) from solidcon_vendas_clientes) from dados_062),'062 aplicar reverter sem DML');
select qa.check((select total_centavos=2174320 from solidcon_mapa_clientes() where documento='37893563000166'),'062 reaplicacao Tatais');
select count(*) filter(where nome like '062%') testes_062,count(*) testes_total from qa.checks;
