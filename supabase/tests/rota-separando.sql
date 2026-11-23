\set ON_ERROR_STOP on
do $$begin if current_database() !~ '^sentinela_separando_' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somente fixture local sentinela_separando_*'; end if;end$$;
set timezone='America/Sao_Paulo';
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
end$$;
create schema qa;
create table qa.checks(nome text primary key);
create function qa.check(ok boolean,nome text) returns void language plpgsql security definer as $$begin if ok is distinct from true then raise exception 'FAIL: %',nome;end if;insert into qa.checks values(nome);end$$;
create function qa.erro(comando text,codigo text,nome text) returns void language plpgsql as $$declare recebido text;begin begin execute comando;exception when others then get stacked diagnostics recebido=returned_sqlstate;end;perform qa.check(recebido=codigo,nome);end$$;
create schema auth;
create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('qa.uid',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select nullif(current_setting('qa.role',true),'')$$;
create function public.eh_equipe() returns boolean language sql stable as $$select coalesce(current_setting('qa.papel',true),'') in ('admin','marcador','vendedor')$$;
create function public.eh_admin() returns boolean language sql stable as $$select coalesce(current_setting('qa.papel',true),'')='admin'$$;
create function public.pode_marcar_rota() returns boolean language sql stable as $$select coalesce(current_setting('qa.papel',true),'') in ('admin','marcador')$$;
grant usage on schema public,auth,qa to anon,authenticated,service_role;
create table public.solidcon_pedidos_erp(cd_pedido bigint primary key,documento text,etapa text);
create table public.rota_veiculos(id text primary key,ativo boolean,dias_sem_saida smallint[]);
create table public.rota_config(id integer primary key,hora_saida time,feriados_sem_saida boolean,feriados_extras date[]);
create table public.rota_cliente_veiculo(documento text primary key,veiculo text references public.rota_veiculos(id));
create table public.rota_pedido_veiculo(cd_pedido bigint primary key,veiculo text references public.rota_veiculos(id));
create table public.rota_pedido_ignorado(cd_pedido bigint primary key);
create table public.rota_saida(data date,veiculo_id text references public.rota_veiculos(id),versao integer not null default 1,paradas jsonb,resumo jsonb,primary key(data,veiculo_id));
\ir ../../admin/migracoes/050_rota_dia_fechada.sql
-- Data controlada APENAS nesta fixture; a funcao de producao continua usando agora no fuso SP.
create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select '2026-11-23'::date$$;
insert into rota_veiculos values('s10',true,'{0,6}'),('strada',true,'{0}'),('inativo',false,'{0}');
insert into rota_config values(1,'08:00',true,'{}');
insert into solidcon_pedidos_erp values(1,'12000000000001','conferido'),(2,'12000000000002','conferido'),(3,'12000000000003','separando'),(4,'12000000000004','separando'),(5,'12000000000005','separando'),(6,'12000000000006','separando'),(7,'12000000000007','separando'),(8,'12000000000008','separando');
insert into rota_cliente_veiculo values('12000000000004','strada'),('12000000000007','inativo');
insert into rota_pedido_veiculo values(5,'strada');
insert into rota_pedido_ignorado values(6);
insert into rota_dia_fechada(data) values('2026-11-23');
insert into rota_dia_item(data,cd_pedido,documento,veiculo_id,ordem) values('2026-11-23',1,'12000000000001','s10',1),('2026-11-23',2,'12000000000002','strada',9);
insert into rota_dia_item(data,cd_pedido,documento,veiculo_id,removido_em) values('2026-11-23',8,'12000000000008','s10',now());
\ir ../../admin/migracoes/054_rota_separando.sql
\ir ../../admin/migracoes/054_rota_separando.sql
select qa.check(not has_function_privilege('anon','public.rota_054_incluir(date,integer,jsonb)','execute'),'anon sem RPC');
select qa.check(not has_function_privilege('authenticated','public.rota_054_candidatos(date)','execute'),'candidatos internos');
select qa.check(public.rota_054_padrao_separando()='s10','S10 padrao fixo');
select qa.check((select array_agg(cd_pedido order by cd_pedido)='{3,4,5}'::bigint[] from rota_054_candidatos('2026-11-23')),'candidatos respeitam 045 removido inativo');
select qa.check((select veiculo_id='s10' from rota_054_candidatos('2026-11-23') where cd_pedido=3),'sem marcacao S10');
select qa.check((select veiculo_id='strada' from rota_054_candidatos('2026-11-23') where cd_pedido=4),'padrao cliente');
select qa.check((select veiculo_id='strada' from rota_054_candidatos('2026-11-23') where cd_pedido=5),'escolha pedido');
set role authenticated;
set qa.papel='motorista';set qa.role='authenticated';
select qa.erro($c$select rota_054_incluir('2026-11-23',1,'[]')$c$,'42501','motorista nao inclui');
set qa.papel='vendedor';
select qa.erro($c$select rota_054_incluir('2026-11-23',1,'[]')$c$,'42501','vendedor nao inclui');
set qa.papel='marcador';
select qa.erro($c$select rota_054_incluir('2026-11-24',1,'[]')$c$,'40001','virada de dia recusa');
select qa.erro($c$select rota_054_incluir('2026-11-23',0,'[]')$c$,'40001','revisao antiga recusa');
select qa.erro($c$select rota_054_incluir('2026-11-23',1,'[{"cd_pedido":3,"veiculo_id":"s10","ordem":1}]')$c$,'40001','proposta incompleta recusa');
select rota_054_incluir('2026-11-23',1,'[{"cd_pedido":1,"veiculo_id":"s10","ordem":2},{"cd_pedido":3,"veiculo_id":"s10","ordem":1},{"cd_pedido":2,"veiculo_id":"strada","ordem":1},{"cd_pedido":4,"veiculo_id":"strada","ordem":2},{"cd_pedido":5,"veiculo_id":"strada","ordem":3}]') as resultado \gset
select qa.check((:'resultado'::jsonb->>'incluidos')::integer=3,'inclusao valida');
select qa.check((select count(*)=3 from rota_dia_item where origem='separando'),'origem separando persistida');
select qa.check((select revisao=2 from rota_dia_fechada),'revisao sobe uma vez');
select qa.check((select count(*)=1 from rota_dia_log),'um log');
select qa.check((rota_054_incluir('2026-11-23',1,'[]')->>'incluidos')::integer=0,'retry idempotente ate com revisao anterior');
select qa.check((select revisao=2 from rota_dia_fechada),'retry nao altera revisao');
reset role;
-- Pedido novo do mesmo cliente removido nao volta sozinho.
insert into solidcon_pedidos_erp values(9,'12000000000008','separando');
select qa.check(not exists(select 1 from rota_054_candidatos('2026-11-23') where cd_pedido=9),'remocao vence novo pedido do cliente');
select qa.check(not rota_054_tem_saida('2026-11-28','s10') and rota_054_tem_saida('2026-11-30','s10'),'sabado S10 proxima segunda');
select qa.check(not rota_054_tem_saida('2026-11-29','strada'),'domingo nunca sai');
select qa.check(not rota_054_tem_saida('2026-12-25','strada'),'feriado fixo');
select qa.check(not rota_054_tem_saida('2026-02-16','strada') and not rota_054_tem_saida('2026-04-03','strada') and not rota_054_tem_saida('2026-06-04','strada'),'feriados moveis');
update rota_config set feriados_extras='{2026-11-23}';
select qa.check(not rota_054_tem_saida('2026-11-23','s10'),'feriado extra');
update rota_config set feriados_sem_saida=false;
select qa.check(rota_054_tem_saida('2026-11-23','s10'),'config permite feriado');
update rota_config set feriados_sem_saida=true,feriados_extras='{}';
select qa.check(not rota_054_tem_saida('2026-11-23','inativo'),'inativo sem saida');
-- RPC real sem foto fechada: previsao continua viva, sem gravacao automatica.
begin;
delete from rota_dia_fechada;
select rota_054_incluir('2026-11-23',0,'[]')->>'motivo' as motivo_aberta \gset
rollback;
select qa.check(:'motivo_aberta'='aberta','rota aberta nao recebe foto automatica');
-- Domingo: mesmo com cabecalho fechado sintetico, nao entra.
create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select '2026-11-29'::date$$;
insert into rota_dia_fechada(data) values('2026-11-29');
select qa.check((rota_054_incluir('2026-11-29',1,'[]')->>'incluidos')::integer=0,'RPC domingo nao inclui');
delete from rota_dia_fechada where data='2026-11-29';
create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select '2026-11-23'::date$$;
set role service_role;
set qa.role='service_role';set qa.papel='';
select qa.check((rota_054_incluir('2026-11-23',2,'[]')->>'incluidos')::integer=0,'service role autorizado sem equipe');
reset role;
-- Origem no fechamento inicial tambem fica duravel quando a etapa avanca no ERP.
insert into solidcon_pedidos_erp values(30,'12000000000030','separando');
insert into rota_dia_fechada(data) values('2026-11-24');
select rota_050_gravar_itens('2026-11-24','[{"cd_pedido":30,"veiculo_id":"s10","ordem":1}]',null);
select qa.check((select origem='separando' from rota_dia_item where cd_pedido=30),'fechamento inicial preserva origem');
delete from rota_dia_fechada where data='2026-11-24';
delete from solidcon_pedidos_erp where cd_pedido=30;
\ir ../../admin/migracoes/054_rota_separando.sql
select qa.check((select count(*)=3 from rota_dia_item where origem='separando'),'reaplicar preserva origem');
select qa.check((select revisao=2 from rota_dia_fechada),'reaplicar preserva revisao');
select count(*) as testes_sql from qa.checks;
