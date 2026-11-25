\set ON_ERROR_STOP on
\ir rota-pos-saida.sql
-- Permissoes reais por conta (admin/vendedor e marca_rota), nao pelo tipo do token.
create table public.admins(email text primary key,papel text,marca_rota boolean not null default false);
grant select on public.admins to authenticated;
alter table public.admins enable row level security;
create function auth.jwt() returns jsonb language sql stable security definer as $$select jsonb_build_object('email',(select email from auth.users where id=auth.uid()))$$;
create policy admin_propria on public.admins for select to authenticated using(email=auth.jwt()->>'email');
create or replace function public.eh_admin() returns boolean language sql stable security invoker as $$select exists(select from public.admins where email=auth.jwt()->>'email' and papel='admin')$$;
create or replace function public.eh_equipe() returns boolean language sql stable security invoker as $$select exists(select from public.admins where email=auth.jwt()->>'email' and papel in('admin','vendedor'))$$;
-- Mesmo predicado da044 publicada, incluindo a conta vendedor do Marcio.
create or replace function public.pode_marcar_rota() returns boolean language sql stable security invoker set search_path=pg_catalog as $$
 select exists(select 1 from public.admins a where a.email=(auth.jwt()->>'email') and(a.papel='admin' or a.marca_rota))
$$;
insert into auth.users values
 ('11111111-1111-4111-8111-111111111111','admin@teste.invalid','{"nome":"Admin QA"}'),
 ('22222222-2222-4222-8222-222222222222','marcio@teste.invalid','{"nome":"Marcio QA"}'),
 ('33333333-3333-4333-8333-333333333333','motorista@teste.invalid','{}'),
 ('44444444-4444-4444-8444-444444444444','vendedor@teste.invalid','{}') on conflict(id) do update set email=excluded.email,raw_app_meta_data=excluded.raw_app_meta_data;
insert into public.admins values('admin@teste.invalid','admin',false),('marcio@teste.invalid','vendedor',true),('vendedor@teste.invalid','vendedor',false);
create temporary table corpo_antes063 as select pg_get_functiondef('public.rota_055_pendente(bigint,date)'::regprocedure) corpo;
\ir ../../admin/migracoes/063_entrega_sem_canhoto.sql
\ir ../../admin/migracoes/063_entrega_sem_canhoto.sql
insert into solidcon_pedidos_erp(cd_pedido,etapa,dt_saida) values(99300,'atendido','2026-11-23T17:00-03'),(99301,'separado',null);
delete from pedido_canhoto where cd_pedido=1528;
select qa.check(rota_055_pendente(99300,'2026-11-25'),'063 repro entregue sem foto volta pendente');
set qa.role='authenticated';set qa.uid='22222222-2222-4222-8222-222222222222';
set role authenticated;
select qa.check(pode_marcar_rota() and not eh_admin(),'063 vendedor marca_rota permitido');
select qa.check((rota_063_confirmar_entrega(99300,'Entregue confirmado pelo dono','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'ativa')::boolean,'063 Marcio marca recebido');
select qa.check((rota_063_confirmar_entrega(99300,null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'repetido')::boolean,'063 retry mesma requisicao');
select qa.check((rota_063_confirmar_entrega(99300,null,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->>'repetido')::boolean,'063 segundo clique ativo nao duplica');
select qa.check((select count(*)=1 and min(confirmado_nome) is not null from rota_063_ler_entregas(array[99300]::bigint[])),'063 projecao equipe inclui nome');
select qa.check(not exists(select from pedido_entrega_confirmacao),'063 vendedor nao le auditoria RLS admin');
select qa.erro($q$select rota_063_desfazer_entrega((select id from rota_063_ler_entregas(array[99300]::bigint[])))$q$,'42501','063 Marcio nao desfaz');
select qa.erro($q$insert into pedido_entrega_confirmacao(cd_pedido,requisicao,confirmado_por) values(99300,gen_random_uuid(),auth.uid())$q$,'42501','063 escrita direta bloqueada mesmo marcador');
select qa.erro($q$select rota_063_confirmar_entrega(99301,null,gen_random_uuid())$q$,'P0002','063 separado nao pode recebido');
select qa.erro($q$select rota_063_confirmar_entrega(999999999,null,gen_random_uuid())$q$,'P0002','063 inexistente nao pode recebido');
select qa.erro($q$select rota_063_confirmar_entrega(99300,repeat('x',301),gen_random_uuid())$q$,'22023','063 motivo max300');
reset role;
select qa.check(not rota_055_pendente(99300,'2026-11-25'),'063 excluido da pendencia SQL');
select qa.check(not exists(select from pedido_canhoto where cd_pedido=99300),'063 marca nao inventa canhoto');
select qa.check((select count(*)=1 and bool_and(confirmado_por='22222222-2222-4222-8222-222222222222'::uuid) from pedido_entrega_confirmacao where cd_pedido=99300),'063 quem marcou nao vem do cliente');
set qa.uid='44444444-4444-4444-8444-444444444444';set role authenticated;
select qa.erro($q$select rota_063_confirmar_entrega(99300,null,gen_random_uuid())$q$,'42501','063 vendedor sem marca_rota recusado');
select qa.check(exists(select from rota_063_ler_entregas(array[99300]::bigint[])),'063 equipe somente status permitido');
reset role;
set qa.uid='33333333-3333-4333-8333-333333333333';set qa.papel='motorista';set role authenticated;
select qa.erro($q$select rota_063_confirmar_entrega(99300,null,gen_random_uuid())$q$,'42501','063 motorista nao marca');
select qa.erro($q$select * from rota_063_ler_entregas(array[99300]::bigint[])$q$,'42501','063 motorista sem leitura global');
reset role;
set qa.uid='11111111-1111-4111-8111-111111111111';set qa.papel='admin';set role authenticated;
select qa.check((select count(*)=1 and min(motivo)='Entregue confirmado pelo dono' from pedido_entrega_confirmacao where cd_pedido=99300),'063 admin le auditoria com motivo');
select qa.erro($q$update pedido_entrega_confirmacao set confirmado_em=now()$q$,'42501','063 admin nao adultera auditoria direto');
select qa.check((rota_063_desfazer_entrega((select id from rota_063_ler_entregas(array[99300]::bigint[])))->>'ativa')::boolean=false,'063 admin desfaz');
select qa.check((rota_063_confirmar_entrega(99300,null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'ativa')::boolean=false,'063 replay antigo apos desfazer nao ressuscita');
select qa.check((rota_063_desfazer_entrega((select id from pedido_entrega_confirmacao where cd_pedido=99300))->>'repetido')::boolean,'063 desfazer idempotente');
reset role;
select qa.check(rota_055_pendente(99300,'2026-11-25'),'063 desfazer volta pendente');
set role authenticated;
select rota_063_confirmar_entrega(99300,null,'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
select qa.check((select count(*)=2 and count(*) filter(where desfeito_em is null)=1 from pedido_entrega_confirmacao where cd_pedido=99300),'063 reconfirmar preserva historico');
-- Pedido1528 confirmado, depois o motorista anexa FOTO REAL (storage de fixture + RPC052 real).
select rota_063_confirmar_entrega(1528,null,'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
reset role;
insert into storage.objects(bucket_id,name,owner) values('canhotos',to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD')||'/1528/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg','33333333-3333-4333-8333-333333333333');
set qa.uid='33333333-3333-4333-8333-333333333333';set qa.papel='motorista';set role authenticated;
select qa.check(rota_052_registrar(to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD')||'/1528/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',array[1528]::bigint[],false,'s10',1)=1,'063 foto posterior motorista aceita');
reset role;
set qa.uid='11111111-1111-4111-8111-111111111111';set qa.papel='admin';set role authenticated;
select rota_063_desfazer_entrega((select id from rota_063_ler_entregas(array[1528]::bigint[])));
reset role;
select qa.check(not rota_055_pendente(1528,'2026-11-25') and exists(select from pedido_canhoto where cd_pedido=1528 and substituido_em is null),'063 desfazer marca nao desfaz foto');
select qa.check(not has_function_privilege('anon','public.rota_063_confirmar_entrega(bigint,text,uuid)','execute')
 and not has_table_privilege('anon','public.pedido_entrega_confirmacao','select'),'063 anon sem acesso');
set qa.uid='';set qa.role='service_role';set role service_role;
select qa.check(exists(select from rota_063_ler_entregas(array[99300]::bigint[])),'063 Edge service le status sem UID');
reset role;set qa.role='authenticated';
set role authenticated;
select qa.erro($q$select rota_063_confirmar_entrega(99300,null,gen_random_uuid())$q$,'42501','063 sem UID nao confirma');
reset role;set qa.uid='11111111-1111-4111-8111-111111111111';
-- Regra manual050 apenas documentada: reabrir APAGA foto; fechar grava novos itens e versao+1.
begin;
create temporary table v050 as select versao from rota_dia_fechada where data=rota_050_hoje();
select rota_050_reabrir();
select not exists(select from rota_dia_item where data=rota_050_hoje()) as reabriu_apagando \gset
select rota_050_fechar('[{"cd_pedido":99301,"veiculo_id":"s10","ordem":1}]');
select (select count(*)=1 and min(cd_pedido)=99301 from rota_dia_item where data=rota_050_hoje())
 and(select f.versao=v.versao+1 from rota_dia_fechada f cross join v050 v where f.data=rota_050_hoje()) as fechou_substituindo \gset
rollback;
select qa.check(:'reabriu_apagando'='t','063 documentacao reabrir apaga itens');
select qa.check(:'fechou_substituindo'='t','063 documentacao fechar substitui foto e aumenta versao');
create temporary table audit_antes_rollback as select count(*) n from pedido_entrega_confirmacao;
\ir ../../admin/migracoes/063_rollback.sql
\ir ../../admin/migracoes/063_rollback.sql
select qa.check((select pg_get_functiondef('public.rota_055_pendente(bigint,date)'::regprocedure)=corpo from corpo_antes063),'063 rollback restaura061 exata');
\ir ../../admin/migracoes/063_entrega_sem_canhoto.sql
select qa.check((select count(*)=n from pedido_entrega_confirmacao cross join audit_antes_rollback group by n),'063 reaplicar preserva auditoria');
select count(*) filter(where nome like '063%') testes_063,count(*) testes_total from qa.checks;
