\set ON_ERROR_STOP on
do $$begin if current_database() !~ '^sentinela_separando_cpf_forja068a' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somente fixture A local';end if;end$$;
\if :{?qa_base_pronta}
\else
 \i :fixture068
 create or replace function public.texto_seguro(p_valor text,p_tamanho_maximo integer default 200)
 returns boolean language sql immutable as $$select p_valor is null or (char_length(p_valor)<=p_tamanho_maximo and p_valor !~ '[<>]')$$;
 alter table public.rota_pedido_veiculo add column if not exists atualizado_por uuid;
 create table qa.limpeza055(def text);
 insert into qa.limpeza055 select pg_get_functiondef('public.rota_044_limpar()'::regprocedure);
 \i :base044
 select def from qa.limpeza055 \gexec
 \ir 044-047-base.sql
 create table qa.original044(def text);
 insert into qa.original044 select pg_get_functiondef('public.rota_044_marcar(bigint,text,text)'::regprocedure);
\endif
\if :{?qa_preparar}
\else
\if :{?migracao068}
 \i :migracao068
 \i :migracao068
\else
 \ir ../../admin/migracoes/068_a_trocar_veiculo.sql
 \ir ../../admin/migracoes/068_a_trocar_veiculo.sql
\endif

reset role;set qa.role='authenticated';set qa.uid='22222222-2222-4222-8222-222222222222';
-- A suite065 termina com outro hoje e fotos futuras; isola a janela destes cenarios A.
create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select '2026-11-25'::date$$;
delete from public.rota_plano_semana;
delete from public.rota_065_sem_saida;
delete from public.rota_dia_item where data between '2026-11-26' and '2026-11-28';
delete from public.rota_dia_fechada where data between '2026-11-26' and '2026-11-28';
insert into public.solidcon_pedidos_erp(cd_pedido,documento,etapa) values
 (681201,'68120000000001','conferido'),(681202,'68120000000002','conferido'),(681203,'68120000000003','conferido'),
 (681204,'68120000000004','conferido'),(681205,null,'aberto'),(681206,'68120000000006','aberto'),
 (681210,'68120000000010','saiu'),(681211,'68120000000011','atendido'),(681212,'68120000000012','conferido'),
 (681213,'68120000000013','aberto'),(681214,'68120000000014','aberto');
insert into public.rota_cliente_veiculo(documento,veiculo) values('68120000000001','s10'),('68120000000002','s10'),('68120000000003','s10'),('68120000000004','caminhao');
insert into public.rota_plano_semana(cd_pedido,dia,veiculo_id,ordem) values
 (681201,'2026-11-26','s10',2),(681202,'2026-11-26','s10',1),(681203,'2026-11-26','s10',3),(681204,'2026-11-26','caminhao',null);
select versao as versao_antes from public.rota_065_semana where inicio='2026-11-23' \gset
set role authenticated;
select public.rota_068_trocar_veiculo(681201,'caminhao','pedido') as troca \gset
select qa.check(:'troca'::jsonb @> '{"status":"ok","resultado":"pedido","plano":{"dia":"2026-11-26","veiculo_id":"caminhao","inicio":"2026-11-23"}}','a troca retorna plano persistido');
select qa.check((select veiculo_id='caminhao' and ordem is null from public.rota_plano_semana where cd_pedido=681201) and (select veiculo='caminhao' from public.rota_pedido_veiculo where cd_pedido=681201),'a marcacao e plano atomicos');
select qa.check((select veiculo='s10' from public.rota_cliente_veiculo where documento='68120000000001'),'a escopo pedido preserva padrao');
select qa.check((:'troca'::jsonb->'plano'->>'versao')::bigint>:versao_antes,'a versao do plano sobe');
select qa.check((select array_agg(ordem order by cd_pedido)='{1,2}'::integer[] from public.rota_plano_semana where cd_pedido in(681202,681203)),'a renumera origem porta');
select qa.check(public.rota_068_trocar_veiculo(681201,'s10','pedido')->>'status'='ok','a troca reversa aceita');
select qa.check((select veiculo_id='s10' and ordem=3 from public.rota_plano_semana where cd_pedido=681201) and not exists(select 1 from public.rota_pedido_veiculo where cd_pedido=681201),'a reversa persiste plano e remove redundancia');
select qa.check(public.rota_044_marcar(681201,'caminhao','sempre')='padrao','a legado044 funciona');
select qa.check((select veiculo_id='caminhao' from public.rota_plano_semana where cd_pedido=681201) and (select veiculo='caminhao' from public.rota_cliente_veiculo where documento='68120000000001'),'a legado044 tambem atualiza plano');
select qa.check(public.rota_068_trocar_veiculo(681201,null,'sempre')->>'resultado'='removido','a null limpa padrao');
select qa.check((select veiculo_id='s10' from public.rota_plano_semana where cd_pedido=681201) and not exists(select 1 from public.rota_cliente_veiculo where documento='68120000000001'),'a null plano acompanha fallback');
select qa.check(public.rota_068_trocar_veiculo(681205,'strada','pedido') @> '{"status":"ok","resultado":"pedido","plano":null}','a CPF sem documento escolha por pedido');
select qa.check(public.rota_068_trocar_veiculo(681206,'strada','pedido') @> '{"status":"ok","resultado":"padrao","plano":null}','a primeiro cliente preserva regra044');
select qa.check(public.rota_068_trocar_veiculo(null,'s10','pedido')->>'motivo'='parametro_invalido' and public.rota_068_trocar_veiculo(681205,'s10',null)->>'motivo'='parametro_invalido','a parametros invalidos');
select qa.check(public.rota_068_trocar_veiculo(689999,'s10','pedido')->>'motivo'='pedido_nao_encontrado','a pedido inexistente');
select qa.check(public.rota_068_trocar_veiculo(681205,'inativo','pedido')->>'motivo'='veiculo_invalido','a veiculo inativo');
reset role;

-- Falha SQL depois de alterar plano: subtransacao deve desfazer tambem ordem e versao.
create table qa.antes_falha_a as select
 (select jsonb_agg(to_jsonb(p) order by cd_pedido) from public.rota_plano_semana p) plano,
 (select jsonb_agg(to_jsonb(p) order by inicio) from public.rota_065_semana p) versoes;
create function qa.falhar_marcacao() returns trigger language plpgsql as $$begin
 if new.cd_pedido=681202 then raise exception 'falha simulada da fixture' using errcode='P7777';end if;return new;end$$;
create trigger qa_falha before insert on public.rota_pedido_veiculo for each row execute function qa.falhar_marcacao();
set role authenticated;
select qa.erro($c$select public.rota_068_trocar_veiculo(681202,'caminhao','pedido')$c$,'P7777','a falha apos plano propagada');
reset role;
drop trigger qa_falha on public.rota_pedido_veiculo;
select qa.check((select plano=(select jsonb_agg(to_jsonb(p) order by cd_pedido) from public.rota_plano_semana p)
 and versoes=(select jsonb_agg(to_jsonb(p) order by inicio) from public.rota_065_semana p) from qa.antes_falha_a)
 and not exists(select 1 from public.rota_pedido_veiculo where cd_pedido=681202),'a excecao reverte plano ordem versao marcacao');

-- Recusa de destino/origem nao pode alterar marcacao, padrao, plano ou versao.
insert into public.rota_065_sem_saida(dia,veiculo_id,motivo) values('2026-11-26','strada','QA');
create table qa.antes_a as select
 (select jsonb_agg(to_jsonb(p) order by cd_pedido) from public.rota_plano_semana p) plano,
 (select jsonb_agg(to_jsonb(p) order by cd_pedido) from public.rota_pedido_veiculo p) marcacao,
 (select jsonb_agg(to_jsonb(p) order by documento) from public.rota_cliente_veiculo p) padrao,
 (select jsonb_agg(to_jsonb(p) order by inicio) from public.rota_065_semana p) versoes;
set role authenticated;
select qa.check(public.rota_068_trocar_veiculo(681201,'strada','sempre')->>'motivo'='dia_sem_saida','a destino sem saida recusa');
reset role;
select qa.check((select plano=(select jsonb_agg(to_jsonb(p) order by cd_pedido) from public.rota_plano_semana p)
 and marcacao=(select jsonb_agg(to_jsonb(p) order by cd_pedido) from public.rota_pedido_veiculo p)
 and padrao=(select jsonb_agg(to_jsonb(p) order by documento) from public.rota_cliente_veiculo p)
 and versoes=(select jsonb_agg(to_jsonb(p) order by inicio) from public.rota_065_semana p) from qa.antes_a),'a recusa totalmente sem efeito');
insert into public.rota_plano_semana(cd_pedido,dia,veiculo_id,ordem) values(681213,'2026-11-25','s10',1);
set role authenticated;
select qa.check(public.rota_068_trocar_veiculo(681213,'caminhao','pedido')->>'motivo'='dia_bloqueado','a origem hoje bloqueada065');
select qa.check(public.rota_068_trocar_veiculo(681210,'caminhao','sempre')->>'motivo'='ja_saiu' and public.rota_068_trocar_veiculo(681211,'caminhao','pedido')->>'motivo'='ja_saiu','a etapas saiu atendido bloqueadas');
select qa.erro($c$select public.rota_044_marcar(681210,'caminhao','sempre')$c$,'22023','a legado nao altera padrao de pedido saiu');
reset role;
insert into public.rota_dia_fechada(data,estado) values('2026-11-24','fechada') on conflict(data) do update set estado='fechada';
insert into public.rota_dia_item(data,cd_pedido,documento,veiculo_id,ordem) values('2026-11-24',681212,'68120000000012','s10',1);
insert into public.rota_pedido_veiculo(cd_pedido,veiculo) values(681212,'s10');
set role authenticated;
select qa.check(public.rota_068_trocar_veiculo(681212,'caminhao','pedido')->>'motivo'='ja_saiu','a saida059 bloqueia ainda conferido');
select qa.erro($c$insert into public.rota_pedido_veiculo(cd_pedido,veiculo) values(681210,'s10')$c$,'42501','a guarda insert direto');
select qa.erro($c$update public.rota_pedido_veiculo set veiculo='caminhao' where cd_pedido=681212$c$,'42501','a guarda update direto');
select qa.erro($c$delete from public.rota_pedido_veiculo where cd_pedido=681212$c$,'42501','a guarda delete direto');
select qa.erro($c$insert into public.rota_pedido_veiculo(cd_pedido,veiculo) values(681212,'caminhao') on conflict(cd_pedido) do update set veiculo=excluded.veiculo$c$,'42501','a guarda upsert direto');
select qa.erro($c$update public.rota_pedido_veiculo set cd_pedido=681214 where cd_pedido=681212$c$,'42501','a guarda chave antiga');
select qa.erro($c$update public.rota_pedido_veiculo set cd_pedido=681210 where cd_pedido=681205$c$,'42501','a guarda chave nova');
select qa.check(not exists(select 1 from public.rota_cliente_veiculo where documento='68120000000010'),'a legado saiu sem efeito');
set qa.uid='44444444-4444-4444-8444-444444444444';
select qa.erro($c$select public.rota_068_trocar_veiculo(681205,'s10','pedido')$c$,'42501','a vendedor sem marca_rota');
set qa.uid='33333333-3333-4333-8333-333333333333';
select qa.erro($c$select public.rota_068_trocar_veiculo(681205,'s10','pedido')$c$,'42501','a motorista sem acesso');
set qa.uid='';
select qa.erro($c$select public.rota_068_trocar_veiculo(681205,'s10','pedido')$c$,'42501','a sem uid');
reset role;set role anon;
select qa.erro($c$select public.rota_068_trocar_veiculo(681205,'s10','pedido')$c$,'42501','a anon sem acesso');
reset role;set qa.uid='11111111-1111-4111-8111-111111111111';set role authenticated;
select qa.check(public.rota_068_trocar_veiculo(681205,'s10','pedido')->>'status'='ok','a admin autorizado');
reset role;
-- Removido permanece removido; nem a troca reativa o pedido no plano.
insert into public.rota_plano_semana(cd_pedido,dia,veiculo_id,ordem,removido) values(681214,'2026-11-27','caminhao',null,true);
set qa.uid='22222222-2222-4222-8222-222222222222';set role authenticated;
select qa.check(public.rota_068_trocar_veiculo(681214,'s10','pedido')->>'status'='ok','a troca removido aceita');
select qa.check((select removido and ordem is null and veiculo_id='s10' from public.rota_plano_semana where cd_pedido=681214),'a preserva removido');
reset role;
create table qa.dados_a as select
 (select jsonb_agg(to_jsonb(p) order by cd_pedido) from public.rota_plano_semana p) plano,
 (select jsonb_agg(to_jsonb(p) order by inicio) from public.rota_065_semana p) versoes;
\ir ../../admin/migracoes/068_a_rollback.sql
\ir ../../admin/migracoes/068_a_rollback.sql
select qa.check((select def=pg_get_functiondef('public.rota_044_marcar(bigint,text,text)'::regprocedure) from qa.original044),'a rollback044 exato');
select qa.check(to_regprocedure('public.rota_068_trocar_veiculo(bigint,text,text)') is null and not exists(select 1 from pg_trigger where tgname like 'rota_068_veiculo%'),'a rollback remove objetos');
select qa.check((select plano=(select jsonb_agg(to_jsonb(p) order by cd_pedido) from public.rota_plano_semana p) and versoes=(select jsonb_agg(to_jsonb(p) order by inicio) from public.rota_065_semana p) from qa.dados_a),'a rollback preserva plano versoes');
\ir ../../admin/migracoes/068_a_trocar_veiculo.sql
set role authenticated;
select qa.check(public.rota_068_trocar_veiculo(681205,'strada','pedido')->>'status'='ok','a reaplicacao funcional');
reset role;
select count(*) as checks_a from qa.checks where nome like 'a %';
\endif
