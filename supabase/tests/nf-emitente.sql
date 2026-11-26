\set ON_ERROR_STOP on
-- 064 NF por emitente. Herda guard localhost/DB sentinela_nf_* e o estado final do teste 062 (026/060/062 reais).
-- CNPJs ficticios validos: 90000000000184 = "nosso" emitente; 90000000000265 = outro proprio (erro); 90000000000346 = fornecedor.
\ir mapa-clientes-nf.sql
set search_path=public,pg_catalog;
reset role;set qa.papel='vendedor';set qa.uid='11111111-1111-4111-8111-111111111111';set timezone='America/Sao_Paulo';
insert into solidcon_clientes(documento,tipo,nome) values('90000000000346','cnpj','FORNECEDOR QA');
create temporary table corpos_062 as select p.oid,pg_get_functiondef(p.oid) corpo,p.proacl from pg_proc p
 where p.oid in('public.solidcon_mapa_clientes()'::regprocedure,'public.solidcon_ler_vendas_nf()'::regprocedure,
  'public.solidcon_receber_vendas_nf(date,date,jsonb,timestamptz,uuid)'::regprocedure);
create temporary table mapa_062 as select * from solidcon_mapa_clientes();
create temporary table ler_062 as select solidcon_ler_vendas_nf() r;
create temporary table dados_pre as select (select count(*) from solidcon_vendas_nf) n;
\ir ../../admin/migracoes/064_nf_emitente.sql
\ir ../../admin/migracoes/064_nf_emitente.sql
select qa.check((select n=(select count(*) from solidcon_vendas_nf) from dados_pre),'064 aplicar sem DML');
select qa.check(not exists(select from solidcon_vendas_nf where classe<>'legado'),'064 linhas antigas = legado');
select qa.check(not exists((select * from solidcon_mapa_clientes() except select * from mapa_062) union all (select * from mapa_062 except select * from solidcon_mapa_clientes())),'064 legado: mapa identico ao 062');
select qa.check((select (r->'notas')=(select jsonb_agg(x-'classe') from jsonb_array_elements(solidcon_ler_vendas_nf()->'notas') x) and (r->'dias')=solidcon_ler_vendas_nf()->'dias' from ler_062),'064 legado: notas/dias iguais ao 062');
select qa.check((solidcon_ler_vendas_nf()->>'legado')::int=(select count(*) from solidcon_vendas_nf),'064 contador legado');
select qa.check((select p.proacl=c.proacl from pg_proc p join corpos_062 c on c.oid=p.oid where p.oid='public.solidcon_receber_vendas_nf(date,date,jsonb,timestamptz,uuid)'::regprocedure),'064 receber mesma OID/ACL');

create function qa.nf(cd bigint,doc text,emit text,nat text,bon boolean,prop boolean,valor bigint,d text default '2026-06-25') returns jsonb language sql as $$
 select jsonb_build_object('cd_nota',cd,'numero',cd,'serie','1','dia',d,'dt',d||'T12:00:00-03:00','documento',doc,'cd_pedido',null,
  'valor_centavos',valor,'total_nota_centavos',valor+100,'st_centavos',null,'nf_cupom',false,'emitente',emit,'natureza',nat,'bonificacao',bon,'proprio',prop)$$;
create function qa.env(p jsonb,ini date default '2026-06-25',fim date default '2026-06-25') returns jsonb language sql as $$select public.solidcon_receber_vendas_nf(ini,fim,p,clock_timestamp(),gen_random_uuid())$$;
create temporary table caso064 as select jsonb_build_array(
 qa.nf(550,'37893563000166','90000000000184','Venda de Merc.Própria',false,true,2164320),
 qa.nf(560,'37893563000166','90000000000184','5.910 - Bonificação, Doação ou Brinde',true,true,50000),
 qa.nf(561,'11222333000181','90000000000184',null,false,true,7000),
 qa.nf(570,'90000000000346','90000000000346','Venda de mercadoria',false,false,66300000),
 qa.nf(571,'90000000000346','90000000000346','Bonificacao',true,false,1000)) p;
-- Recusas ANTES do primeiro envio valido: nada apagado.
create temporary table antes_recusa as select jsonb_agg(to_jsonb(n) order by cd_nota) d from solidcon_vendas_nf n;
select qa.check(qa.env(jsonb_set(p,'{1,bonificacao}','false'))->>'motivo'='natureza_invalida','064 bonificacao incoerente com natureza') from caso064;
select qa.check(qa.env(jsonb_set(p,'{0,natureza}','" Venda"'))->>'motivo'='natureza_invalida','064 natureza sem trim recusada') from caso064;
select qa.check(qa.env(jsonb_set(p,'{0,natureza}',to_jsonb(repeat('x',61))))->>'motivo'='natureza_invalida','064 natureza >60 recusada') from caso064;
select qa.check(qa.env(jsonb_set(p,'{0,emitente}','"90000000000185"'))->>'motivo'='emitente_invalido','064 emitente DV invalido') from caso064;
select qa.check(qa.env(jsonb_set(p,'{0,emitente}','"9000000000018"'))->>'motivo'='emitente_invalido','064 emitente 13 digitos') from caso064;
select qa.check(qa.env(jsonb_set(p,'{0,proprio}','"true"'))->>'motivo'='emitente_invalido','064 proprio nao booleano') from caso064;
select qa.check(qa.env(jsonb_set(p,'{1,emitente}','"90000000000265"'))->>'motivo'='emitente_inconsistente','064 dois emitentes proprios no envio') from caso064;
select qa.check(qa.env(jsonb_set(p,'{3,emitente}','"90000000000184"'))->>'motivo'='emitente_inconsistente','064 terceiro com CNPJ proprio') from caso064;
select qa.check(qa.env(p||jsonb_build_array((p->0)-'proprio'-'emitente'-'natureza'-'bonificacao'||'{"cd_nota":999}'))->>'motivo'='campos_invalidos','064 formatos misturados') from caso064;
select qa.check(qa.env(jsonb_set(p,'{0,extra}','1'))->>'motivo'='campos_invalidos','064 campo extra') from caso064;
select qa.check((select jsonb_agg(to_jsonb(n) order by cd_nota) from solidcon_vendas_nf n)=d,'064 recusas nao apagam nada') from antes_recusa;
-- Envio valido.
select qa.check(qa.env(p)->>'status'='ok','064 envio classificado aceito') from caso064;
select qa.check((select string_agg(cd_nota||':'||classe,',' order by cd_nota) from solidcon_vendas_nf where dia='2026-06-25')='550:venda,560:bonificacao,561:venda,570:compra,571:compra','064 classes');
select qa.check(not exists(select from solidcon_vendas_nf where dia='2026-06-25' and documento='18285535000111'),'064 janela substituida (Vida em Graos fora)');
set role authenticated;
select qa.check(not exists(select from jsonb_array_elements(solidcon_ler_vendas_nf()->'notas') n where n->>'cd_nota' in('560','570','571')),'064 notas: so venda/legado');
select qa.check((select count(*)=1 and min(n->>'cd_nota')='560' and min(n->>'natureza') like '5.910%' from jsonb_array_elements(solidcon_ler_vendas_nf()->'bonificacoes') n),'064 bonificacao a parte com natureza');
select qa.check((solidcon_ler_vendas_nf()->>'legado')::int=(select count(*) from solidcon_vendas_nf where dia<>'2026-06-25'),'064 legado = dias ainda nao reenviados');
select qa.check((select f->>'emitente'='90000000000346' and f->>'nome'='FORNECEDOR QA' and (f->>'qtd')::int=2 and (f->>'valor_centavos')::bigint=66301000
 and f->>'primeira'='2026-06-25' from jsonb_array_elements(solidcon_ler_compras_nf()->'fornecedores') f),'064 compras por emitente');
select qa.check(jsonb_array_length(solidcon_ler_compras_nf()->'notas')=2 and not (solidcon_ler_compras_nf()->>'truncado')::boolean,'064 compras lista');
select qa.check((select total_centavos=2164320+10000 and meses='{"2026-06":[2164320,1],"2026-07":[10000,1]}'::jsonb from solidcon_mapa_clientes() where documento='37893563000166'),'064 mapa sem bonificacao');
select qa.check((select total_centavos=12000 from solidcon_mapa_clientes() where documento='11222333000181'),'064 mapa venda natureza nula');
select qa.check(not exists(select from solidcon_mapa_clientes() where documento='90000000000346' and total_centavos>0),'064 fornecedor nao soma no mapa');
reset role;
-- Coletor antigo/replay legado depois da classificacao: codigo distinto, sem efeito.
create temporary table antes_legado as select jsonb_agg(to_jsonb(n) order by cd_nota) d from solidcon_vendas_nf n;
select qa.check(qa.env(jsonb_build_array((p->0)-'proprio'-'emitente'-'natureza'-'bonificacao'))->>'motivo'='coletor_antigo','064 coletor antigo recusado') from caso064;
select qa.check((select jsonb_agg(to_jsonb(n) order by cd_nota) from solidcon_vendas_nf n)=d,'064 coletor antigo sem efeito') from antes_legado;
select qa.check(qa.env('[]','2026-06-26','2026-06-26')->>'status'='ok','064 janela vazia aceita (qualquer formato)');
select qa.check(qa.env(jsonb_build_array(qa.nf(580,'37893563000166','90000000000265','Venda',false,true,1,'2026-06-27')),'2026-06-27','2026-06-27')->>'motivo'='emitente_inconsistente','064 proprio diferente do ja gravado');
select qa.check(qa.env(jsonb_build_array(qa.nf(581,'37893563000166','90000000000184','Venda',false,true,1,'2026-06-27')),'2026-06-27','2026-06-27')->>'status'='ok','064 outra janela mesmo proprio');
-- Snapshot antigo continua recusado no formato novo.
select qa.check(public.solidcon_receber_vendas_nf('2026-06-25','2026-06-25',p,clock_timestamp()-interval '1 hour',gen_random_uuid())->>'motivo'='snapshot_antigo','064 snapshot antigo') from caso064;
-- Restricao de tabela: escrita direta incoerente barrada mesmo por dono.
do $$declare ok boolean:=false;begin
 begin update public.solidcon_vendas_nf set bonificacao=true where cd_nota=550;exception when check_violation then ok:=true;end;
 perform qa.check(ok,'064 check bonificacao x natureza na tabela');
 ok:=false;begin update public.solidcon_vendas_nf set proprio=null where cd_nota=550;exception when check_violation then ok:=true;end;
 perform qa.check(ok,'064 check tudo-ou-nada');
end$$;
-- Acesso.
select qa.check((select not prosecdef and provolatile='s' from pg_proc where oid='public.solidcon_ler_compras_nf()'::regprocedure),'064 compras stable invoker');
select qa.check(not has_function_privilege('anon','public.solidcon_ler_compras_nf()','execute'),'064 compras sem anon');
set role authenticated;set qa.papel='motorista';
do $$declare erro text;begin
 begin perform public.solidcon_ler_compras_nf();exception when others then get stacked diagnostics erro=returned_sqlstate;end;
 perform qa.check(erro='42501','064 motorista sem compras');
end$$;
reset role;set qa.papel='vendedor';
-- Rollback: corpos 062/060 exatos, dados e colunas preservados; reaplicar recupera.
create temporary table dados_064 as select jsonb_agg(to_jsonb(n) order by cd_nota) d from solidcon_vendas_nf n;
\ir ../../admin/migracoes/064_rollback.sql
\ir ../../admin/migracoes/064_rollback.sql
-- Fim de linha (CRLF/LF do checkout) nao muda a funcao; compara o resto byte a byte.
select qa.check((select bool_and(replace(pg_get_functiondef(c.oid),chr(13),'')=replace(c.corpo,chr(13),'')) and count(*)=3 from corpos_062 c),'064 rollback corpos 060/062 exatos');
select qa.check(to_regprocedure('public.solidcon_ler_compras_nf()') is null,'064 rollback remove compras');
select qa.check((select jsonb_agg(to_jsonb(n) order by cd_nota) from solidcon_vendas_nf n)=d,'064 rollback preserva dados') from dados_064;
select qa.check(qa.env(p)->>'motivo'='campos_invalidos','064 rollback: RPC060 recusa formato novo') from caso064;
\ir ../../admin/migracoes/064_nf_emitente.sql
select qa.check((select count(*)=2 from solidcon_vendas_nf where classe='compra'),'064 reaplicacao preserva classes');
select count(*) filter(where nome like '064%') testes_064,count(*) testes_total from qa.checks;
