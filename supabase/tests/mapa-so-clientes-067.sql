\set ON_ERROR_STOP on
-- 067 Mapa / Crescimento da marca so com CLIENTE. Herda guard localhost/DB sentinela_nf_* e o estado final do 064
-- (026/060/062/064 reais). CNPJs ficticios validos (solidcon_026_documento_valido).
\ir nf-emitente.sql
set search_path=public,pg_catalog;
-- Casos novos: so bonificacao (66000000000108), so NF legado (66000000000280), emitente de compra que TAMBEM comprou
-- de nos (90000000000346 ganha 1 venda), parceiro sem nada (55000000000005, ja na fixture).
insert into solidcon_clientes(documento,tipo,nome,bairro,cidade,estado) values
 ('66000000000108','cnpj','SO BONIFICACAO QA','Centro','Petropolis','RJ'),
 ('66000000000280','cnpj','SO LEGADO QA','Centro','Petropolis','RJ');
insert into solidcon_vendas_nf(cd_nota,numero,serie,dia,dt,documento,valor_centavos,total_nota_centavos,st_centavos,nf_cupom,coletado_em,emitente,natureza,bonificacao,proprio) values
 (990101,9101,'1','2026-06-25','2026-06-25T12:00-03','66000000000108',5000,5000,0,false,now(),'90000000000184','5.910 - Bonificação',true,true),
 (990102,9102,'1','2026-06-26','2026-06-26T12:00-03','66000000000280',7000,7000,0,false,now(),null,null,null,null),
 (990103,9103,'1','2026-06-27','2026-06-27T12:00-03','90000000000346',3000,3000,0,false,now(),'90000000000184','5.102 - Venda',false,true);
create temporary table mapa_064 as select * from solidcon_mapa_clientes();
create temporary table func_064 as select p.proargtypes,p.prorettype,p.proallargtypes,p.proargnames,p.proacl,p.prosecdef,p.provolatile,p.proconfig
 from pg_proc p where p.oid='public.solidcon_mapa_clientes()'::regprocedure;
create temporary table corpo_064 as select pg_get_functiondef('public.solidcon_mapa_clientes()'::regprocedure) corpo;
select qa.check((select count(*)=1 from mapa_064 where documento='55000000000005' and total_centavos=0 and cupons=0),'067 antes: parceiro sem compra aparecia no mapa');
\ir ../../admin/migracoes/067_mapa_so_clientes.sql
\ir ../../admin/migracoes/067_mapa_so_clientes.sql
create temporary table mapa_067 as select * from solidcon_mapa_clientes();
select qa.check((select p.proargtypes=a.proargtypes and p.prorettype=a.prorettype and p.proallargtypes is not distinct from a.proallargtypes
   and p.proargnames is not distinct from a.proargnames and p.proacl is not distinct from a.proacl and p.prosecdef=a.prosecdef
   and p.provolatile=a.provolatile and p.proconfig is not distinct from a.proconfig
 from pg_proc p cross join func_064 a where p.oid='public.solidcon_mapa_clientes()'::regprocedure),'067 assinatura colunas ACL invoker stable search_path iguais');
select qa.check(not exists(select from mapa_067 where documento='55000000000005'),'067 parceiro que nunca comprou sai do mapa');
select qa.check(not exists(select from mapa_067 where documento='66000000000108'),'067 so bonificacao nao conta como compra');
select qa.check(exists(select from mapa_067 where documento='66000000000280' and total_centavos=7000),'067 NF legado conta como compra');
select qa.check(exists(select from mapa_067 where documento='04252011000110' and total_centavos=30000 and cupons=2),'067 so PDV continua');
select qa.check(exists(select from mapa_067 where documento='90000000000346' and total_centavos=3000 and cupons=1),'067 emitente de compra que tambem comprou de nos aparece, so com a venda');
select qa.check(not exists(select from mapa_067 where documento in('11444777000161','18285535000111')),'067 solidcon_fornecedores segue fora mesmo com NF');
select qa.check(not exists(select from mapa_067 where documento='52998224725'),'067 CPF segue fora');
select qa.check(not exists(select from mapa_067 where total_centavos<=0 and cupons<=0) and not exists(select from mapa_067 where primeira_compra is null),'067 toda linha tem compra e 1a compra');
-- Quem ja estava com compra fica identico ao 064 (mesmas colunas: pino, meses, qualidade).
select qa.check(not exists((select * from mapa_067 except select * from mapa_064 where cupons>0)
 union all (select * from mapa_064 where cupons>0 except select * from mapa_067)),'067 compradores identicos ao 064; so saem os sem compra');
-- Permissao igual: equipe le; anon nao.
select qa.check(not has_function_privilege('anon','public.solidcon_mapa_clientes()','execute') and has_function_privilege('authenticated','public.solidcon_mapa_clientes()','execute'),'067 grants iguais');
-- ---------- rollback ----------
\ir ../../admin/migracoes/067_rollback.sql
\ir ../../admin/migracoes/067_rollback.sql
select qa.check((select replace(pg_get_functiondef('public.solidcon_mapa_clientes()'::regprocedure),chr(13),'')=replace(corpo,chr(13),'') from corpo_064),'067 rollback volta o corpo 064 exato');
select qa.check(not exists((select * from solidcon_mapa_clientes() except select * from mapa_064) union all (select * from mapa_064 except select * from solidcon_mapa_clientes())),'067 rollback: mapa identico ao 064');
\ir ../../admin/migracoes/067_mapa_so_clientes.sql
select qa.check(not exists((select * from solidcon_mapa_clientes() except select * from mapa_067) union all (select * from mapa_067 except select * from solidcon_mapa_clientes())),'067 reaplicar = 067');
select count(*) filter(where nome like '067%') testes_067,count(*) testes_total from qa.checks;
