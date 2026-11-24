\set ON_ERROR_STOP on
-- Somente fixture isolada, sem credenciais do projeto. Reusa a050/054 reais e a base do teste anterior.
\ir rota-separando.sql
alter table solidcon_pedidos_erp add column dt_saida timestamptz,add column dt_nota timestamptz,add column dt_atendido timestamptz;
alter table rota_pedido_veiculo add column atualizado_em timestamptz default now();
alter table rota_pedido_ignorado add column atualizado_em timestamptz default now();
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,created_at timestamptz default now(),unique(bucket_id,name));
create function public.rota_051_meu_veiculo() returns text language sql stable as $$select case when current_setting('qa.papel',true)='motorista' then 's10' end$$;
create function public.rota_051_cds_da_rota(date,text) returns setof bigint language sql stable as $$select x from unnest(array[1,3,1528]::bigint[]) x$$;
create function public.rota_051_validar_contexto(p_data date,p_veiculo text,p_versao integer) returns boolean language plpgsql as $$begin perform 1 from public.rota_saida where data=p_data and veiculo_id=p_veiculo for share;return true;end$$;
\ir ../../admin/migracoes/052_canhotos.sql
alter table public.pedido_canhoto alter column origem set default 'painel';
-- Assinaturas que a055 substitui. O rollback e conferido depois contra os corpos originais044/045.
create function public.rota_044_limpar() returns integer language sql as $$select 0$$;
create function public.rota_045_limpar() returns integer language sql as $$select 0$$;
revoke all on function public.rota_044_limpar(),public.rota_045_limpar() from public,anon,authenticated;
grant execute on function public.rota_044_limpar(),public.rota_045_limpar() to service_role;
\ir ../../admin/migracoes/055_enviado_canhoto.sql
\ir ../../admin/migracoes/055_enviado_canhoto.sql
set qa.papel='marcador';set qa.role='authenticated';
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_saida,dt_nota,dt_atendido) values
 (1528,'12000000001528','atendido','2026-11-22T17:23:00-03','2026-11-22T17:24:00-03','2026-11-22T17:24:00-03'),
 (1529,'12000000001529','saiu','2026-11-16T03:00:00Z',null,null),
 (1530,'12000000001530','saiu','2026-11-16T02:59:59Z',null,null),
 (1531,'12000000001531','atendido',null,'2026-11-22T12:00:00-03','2026-11-22T12:01:00-03'),
 (1532,'12000000001532','atendido',null,null,'2026-11-22T12:00:00-03'),
 (1533,'12000000001533','separando',null,null,null);
select qa.check(rota_055_pendente(1528,'2026-11-23'),'enviado atendido sem foto pendente');
select qa.check(rota_055_pendente(1529,'2026-11-23'),'enviado sete dias SP incluso');
select qa.check(not rota_055_pendente(1530,'2026-11-23'),'enviado oito dias SP fora');
select qa.check(rota_055_pendente(1531,'2026-11-23') and rota_055_pendente(1532,'2026-11-23'),'enviado nota e atendido fallback');
select qa.check(not has_function_privilege('authenticated','public.rota_055_pendente(bigint,date)','execute'),'enviado helper privado');
select rota_050_ajustar('adicionar',array[1528]::bigint[],'s10','[{"cd_pedido":1,"ordem":1},{"cd_pedido":3,"ordem":2},{"cd_pedido":1528,"ordem":3}]');
select qa.check(rota_050_envio_ok('2026-11-23','s10','[{"ordem":1,"pedidos":[1]},{"ordem":2,"pedidos":[3]},{"ordem":3,"pedidos":[1528]}]'),'enviado publicar faturado sem foto');
select revisao as rev_antes from rota_dia_fechada \gset
insert into pedido_canhoto(cd_pedido,caminho) values(1528,'2026-11-23/1528/11111111-1111-4111-8111-111111111111.jpg');
select qa.check(not rota_055_pendente(1528,'2026-11-23'),'enviado ativo confirma entrega');
select qa.check((select revisao=:rev_antes+1 from rota_dia_fechada),'enviado foto sobe revisao');
select qa.check(not rota_050_envio_ok('2026-11-23','s10','[{"ordem":1,"pedidos":[1]},{"ordem":2,"pedidos":[3]},{"ordem":3,"pedidos":[1528]}]'),'enviado recebido recusa publicacao');
select qa.check(rota_050_envio_ok('2026-11-23','s10','[{"ordem":1,"pedidos":[1]},{"ordem":2,"pedidos":[3]}]'),'enviado demais ordens preservadas');
select revisao as rev_retry from rota_dia_fechada \gset
insert into pedido_canhoto(cd_pedido,caminho) values(1528,'2026-11-23/1528/11111111-1111-4111-8111-111111111111.jpg') on conflict do nothing;
select qa.check((select revisao=:rev_retry from rota_dia_fechada),'enviado retry sem linhas nao sobe revisao');
update pedido_canhoto set substituido_em=now() where cd_pedido=1528;
select qa.check(rota_055_pendente(1528,'2026-11-23'),'enviado substituido nao e comprovante');
insert into pedido_canhoto(cd_pedido,caminho) values(1528,'2026-11-23/1528/22222222-2222-4222-8222-222222222222.jpg');
delete from pedido_canhoto where cd_pedido=1528 and substituido_em is null;
select qa.check(rota_055_pendente(1528,'2026-11-23'),'enviado removido volta pendente');
insert into pedido_canhoto(cd_pedido,caminho) values(1533,'2026-11-23/1528/33333333-3333-4333-8333-333333333333.jpg');
select qa.check(not exists(select 1 from rota_054_candidatos('2026-11-23') where cd_pedido=1533),'enviado 054 nao recoloca recebido');
-- Com foto, nenhuma etapa e candidata, mesmo se o ERP regredir.
insert into pedido_canhoto(cd_pedido,caminho) values(1,'2026-11-23/1528/44444444-4444-4444-8444-444444444444.jpg');
select qa.check(not rota_055_pendente(1,'2026-11-23'),'enviado canhoto prevalece antes faturamento');
select qa.erro($c$select rota_050_ajustar('adicionar',array[1530]::bigint[],'s10','[]')$c$,'P0002','enviado ajuste recusa antigo');
-- Previsao aberta tambem confere elegibilidade na publicacao.
select qa.check(not rota_050_envio_ok('2026-11-24','s10','[{"ordem":1,"pedidos":[1]}]'),'enviado aberto nao publica recebido');
select qa.check(rota_050_envio_ok('2026-11-24','s10','[{"ordem":1,"pedidos":[1529]}]'),'enviado futuro usa idade de hoje');
select qa.check(rota_050_envio_ok('2026-11-24','s10','[{"ordem":1,"pedidos":null,"itens":null}]'),'enviado arrays opcionais null conservam contrato047');
-- Fechamento inicial: aceita faturado recente e recusa canhoto/antigo.
insert into rota_dia_fechada(data) values('2026-11-24');
select qa.erro($c$select rota_050_gravar_itens('2026-11-24','[{"cd_pedido":1,"veiculo_id":"s10","ordem":1}]',null)$c$,'P0002','enviado fechamento recusa recebido');
select rota_050_gravar_itens('2026-11-24','[{"cd_pedido":1529,"veiculo_id":"s10","ordem":1}]',null);
select qa.check(exists(select 1 from rota_dia_item where data='2026-11-24' and cd_pedido=1529),'enviado fechamento aceita faturado');
delete from rota_dia_fechada where data='2026-11-24';
-- Uma instrucao com varias fotos sobe uma vez.
select revisao as rev_lote from rota_dia_fechada \gset
insert into pedido_canhoto(cd_pedido,caminho) values(3,'2026-11-23/1528/55555555-5555-4555-8555-555555555555.jpg'),(1528,'2026-11-23/1528/55555555-5555-4555-8555-555555555555.jpg');
select qa.check((select revisao=:rev_lote+1 from rota_dia_fechada),'enviado lote sobe uma revisao');
delete from pedido_canhoto;
select count(*) as testes_enviado from qa.checks where nome like 'enviado%';
