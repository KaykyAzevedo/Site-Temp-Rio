\set ON_ERROR_STOP on
-- 065 Semana programavel. Herda guard localhost/DB sentinela_separando_* e as migracoes reais 050/054/055/056/059/061/063.
\ir entrega-sem-canhoto.sql
reset role;set search_path=public,pg_catalog;set timezone='America/Sao_Paulo';
-- Stubs fieis a 046/047 (as migracoes completas exigem 013/014/035/040/042): colunas, FK, CHECK seg..sab, trava 4601 e RLS.
alter table rota_veiculos add column nome text,add column modo text not null default 'porta';
insert into rota_veiculos(id,ativo,dias_sem_saida,nome,modo) values('caminhao',true,'{0}','Caminhao','cd_ceasa') on conflict(id) do update set modo='cd_ceasa',ativo=true;
update rota_veiculos set modo='porta' where id<>'caminhao';
create table public.rota_plano_semana(cd_pedido bigint primary key check(cd_pedido between 1 and 999999999999),
 dia date not null check(extract(isodow from dia) between 1 and 6),atualizado_em timestamptz not null default now(),atualizado_por uuid,
 veiculo_id text not null default 's10' references rota_veiculos(id));
create function public.rota_046_plano_travar() returns trigger language plpgsql set search_path=pg_catalog as $$begin perform pg_catalog.pg_advisory_xact_lock(5100,4601);return null;end$$;
create trigger rota_046_plano_travar before insert or update or delete on rota_plano_semana for each statement execute function rota_046_plano_travar();
alter table rota_plano_semana enable row level security;
grant select,insert,update,delete on rota_plano_semana to authenticated;
create policy rota_046_equipe_le on rota_plano_semana for select to authenticated using((select eh_equipe()));
create policy rota_046_marca_insere on rota_plano_semana for insert to authenticated with check((select pode_marcar_rota()));
create policy rota_046_marca_atualiza on rota_plano_semana for update to authenticated using((select pode_marcar_rota())) with check((select pode_marcar_rota()));
create policy rota_046_marca_apaga on rota_plano_semana for delete to authenticated using((select pode_marcar_rota()));
-- Hoje = quarta 25/11/2026. Semana 23..28; editaveis 26, 27, 28 (S10 nao sai sabado).
create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select '2026-11-25'::date$$;
delete from rota_dia_item where data>='2026-11-26';delete from rota_dia_fechada where data>='2026-11-26';
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa) select 96500+n,'1200000096'||lpad(n::text,4,'0'),'conferido' from generate_series(1,9) n;
insert into rota_pedido_ignorado values(96509);
create temporary table antes065 as select (select count(*) from rota_dia_item) itens,(select count(*) from rota_plano_semana) plano;
create temporary table corpo055 as select pg_get_functiondef('public.rota_050_gravar_itens(date,jsonb,uuid)'::regprocedure) corpo;
create temporary table corpo061 as select pg_get_functiondef('public.rota_054_candidatos(date)'::regprocedure) cand,pg_get_functiondef('public.rota_054_incluir(date,integer,jsonb)'::regprocedure) incl;
\ir ../../admin/migracoes/065_semana_plano.sql
\ir ../../admin/migracoes/065_semana_plano.sql
select qa.check((select itens=(select count(*) from rota_dia_item) and plano=(select count(*) from rota_plano_semana) from antes065),'065 aplicar sem DML');
select qa.check(not has_function_privilege('anon','public.rota_065_salvar_semana(date,bigint,jsonb,text)','execute')
 and not has_function_privilege('anon','public.rota_065_ler_semana(date)','execute')
 and not has_function_privilege('authenticated','public.rota_065_aplicar_plano(date,jsonb)','execute')
 and not has_function_privilege('authenticated','public.rota_065_subir(date)','execute'),'065 grants minimos');

create function qa.sv(p jsonb,v bigint default null,ini date default '2026-11-23',vei text default null) returns jsonb language sql as
 $$select public.rota_065_salvar_semana(ini,coalesce(v,(public.rota_065_ler_semana(ini)->>'versao')::bigint),p,vei)$$;
create function qa.it(cd int,d text,v text,o int,rem boolean default false) returns jsonb language sql as
 $$select jsonb_build_object('cd_pedido',cd,'dia',d,'veiculo_id',v,'ordem',o,'removido',rem)$$;
grant execute on all functions in schema qa to authenticated;
-- ---------- permissao ----------
set role authenticated;
set qa.uid='33333333-3333-4333-8333-333333333333';
select qa.erro($c$select rota_065_ler_semana('2026-11-23')$c$,'42501','065 motorista nao le');
set qa.uid='44444444-4444-4444-8444-444444444444';
select qa.check(rota_065_ler_semana('2026-11-23')->>'status'='ok','065 vendedor le');
select qa.erro($c$select rota_065_salvar_semana('2026-11-23',0,'[]')$c$,'42501','065 vendedor nao salva');
select qa.erro($c$select rota_065_marcar_sem_saida('2026-11-26','s10',true,0)$c$,'42501','065 vendedor nao marca');
set qa.uid='22222222-2222-4222-8222-222222222222';

-- ---------- ler ----------
select qa.check((select r->>'inicio'='2026-11-23' and r->>'hoje'='2026-11-25' and (r->>'versao')::int=0 and r->'itens'='[]' and r->'sem_saida'='[]'
 from (select rota_065_ler_semana('2026-11-23') r) x),'065 semana vazia versao 0');
select qa.check(rota_065_ler_semana('2026-11-24')->>'motivo'='parametro_invalido','065 ler fora da segunda');

-- ---------- salvar: recusas sem efeito ----------
select qa.check(qa.sv('[{"cd_pedido":96501,"dia":"2026-11-26","veiculo_id":"s10","ordem":1}]')->>'motivo'='parametro_invalido','065 falta removido');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-26','s10',1)||'{"x":1}'))->>'motivo'='parametro_invalido','065 chave extra');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-30','s10',1)))->>'motivo'='parametro_invalido','065 dia fora da semana');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-02-30','s10',1)))->>'motivo'='parametro_invalido','065 data impossivel');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-26','s10',1)),0,'2026-11-24')->>'motivo'='parametro_invalido','065 inicio nao segunda');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-26','s10',1),qa.it(96501,'2026-11-27','s10',1)))->>'motivo'='pedido_duplicado','065 duplicado');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-26','inativo',1)))->>'motivo'='veiculo_invalido','065 veiculo inativo');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-26','s10',1)),null,'2026-11-23','strada')->>'motivo'='parametro_invalido','065 item fora do veiculo do escopo');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-25','s10',1)))->>'motivo'='dia_bloqueado','065 hoje bloqueado');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-24','s10',1)))->>'motivo'='dia_bloqueado','065 passado bloqueado');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-28','s10',1)))->>'motivo'='dia_sem_saida','065 S10 nao sai sabado');
select qa.check(qa.sv(jsonb_build_array(qa.it(99999999,'2026-11-26','s10',1)))->>'cd_pedido'='99999999','065 pedido inexistente com codigo');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-26','s10',null)))->>'motivo'='ordem_invalida','065 porta sem ordem');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-26','caminhao',1)))->>'motivo'='ordem_invalida','065 CEASA com ordem');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-26','s10',1,true)))->>'motivo'='ordem_invalida','065 removido com ordem');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-26','s10',1),qa.it(96502,'2026-11-26','s10',3)))->>'motivo'='ordem_invalida','065 ordem com buraco');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-26','s10',1),qa.it(96502,'2026-11-26','s10',1)))->>'motivo'='ordem_invalida','065 ordem repetida');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-26','s10',1)),5)->>'motivo'='versao_antiga','065 versao antiga');
select qa.check((select count(*)=0 from rota_plano_semana) and coalesce((select versao from rota_065_semana where inicio='2026-11-23'),0)=0,'065 recusas sem efeito');

-- ---------- salvar valido ----------
select qa.sv(jsonb_build_array(
 qa.it(96501,'2026-11-26','s10',2),qa.it(96502,'2026-11-26','s10',1),qa.it(96503,'2026-11-26','strada',1),
 qa.it(96504,'2026-11-27','s10',1),qa.it(96505,'2026-11-27','caminhao',null),qa.it(96506,'2026-11-26','s10',null,true),
 qa.it(96507,'2026-11-27','s10',2),qa.it(96509,'2026-11-27','s10',3))) r \gset
select qa.check((:'r'::jsonb->>'status')='ok' and (:'r'::jsonb->>'itens')::int=8 and (:'r'::jsonb->>'versao')::int>0,'065 salvar ok');
select (rota_065_ler_semana('2026-11-23')) l \gset
select qa.check((:'l'::jsonb->>'versao')=(:'r'::jsonb->>'versao') and jsonb_array_length(:'l'::jsonb->'itens')=8,'065 ler devolve versao e itens salvos');
select qa.check((select ordem is null and removido from rota_plano_semana where cd_pedido=96506),'065 removido gravado');
select qa.check(qa.sv('[]',(:'r'::jsonb->>'versao')::bigint-1)->>'motivo'='versao_antiga','065 segundo salvamento com versao lida antes recusa');
-- Escopo por veiculo: salvar so strada nao apaga S10.
select qa.check(qa.sv(jsonb_build_array(qa.it(96503,'2026-11-27','strada',1)),null,'2026-11-23','strada')->>'status'='ok','065 salvar escopo strada');
select qa.check((select count(*)=7 from rota_plano_semana where veiculo_id<>'strada') and (select dia='2026-11-27' from rota_plano_semana where cd_pedido=96503),'065 escopo preserva outros veiculos');
-- Linha em dia nao editavel (hoje) fica como esta.
reset role;insert into rota_plano_semana(cd_pedido,dia,veiculo_id) values(96508,'2026-11-25','s10');
set role authenticated;set qa.uid='22222222-2222-4222-8222-222222222222';
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-26','s10',1)))->>'status'='ok','065 salvar semana inteira');
select qa.check((select array_agg(cd_pedido order by cd_pedido)='{96501,96508}' from rota_plano_semana),'065 substitui so dias editaveis');
-- Escrita legada (047/direta) tambem sobe a versao.
select (rota_065_ler_semana('2026-11-23')->>'versao')::bigint v0 \gset
reset role;update rota_plano_semana set dia='2026-11-27' where cd_pedido=96501;
set role authenticated;set qa.uid='22222222-2222-4222-8222-222222222222';
select qa.check((rota_065_ler_semana('2026-11-23')->>'versao')::bigint>:v0,'065 gravacao legada sobe a versao');
select qa.check(qa.sv('[]',:v0)->>'motivo'='versao_antiga','065 quadro aberto antes da gravacao legada recusa');

-- ---------- veiculo nao sai nesta data ----------
select (rota_065_ler_semana('2026-11-23')->>'versao')::bigint v1 \gset
select qa.check(rota_065_marcar_sem_saida('2026-11-27','s10',true,:v1-1,'medico')->>'motivo'='versao_antiga','065 marcar com versao antiga');
select qa.check(rota_065_marcar_sem_saida('2026-11-25','s10',true,:v1,'medico')->>'motivo'='dia_bloqueado','065 marcar hoje bloqueado');
select qa.check(rota_065_marcar_sem_saida('2026-11-27','inativo',true,:v1)->>'motivo'='veiculo_invalido','065 marcar inativo');
select qa.check(rota_065_marcar_sem_saida('2026-11-27','s10',true,:v1,repeat('x',81))->>'motivo'='parametro_invalido','065 motivo longo');
select qa.check(rota_065_marcar_sem_saida('2026-11-29','s10',true,:v1)->>'motivo'='parametro_invalido','065 domingo');
select rota_065_marcar_sem_saida('2026-11-27','s10',true,:v1,'  medico  ') m \gset
select qa.check(:'m'::jsonb->>'status'='ok' and :'m'::jsonb->'devolvidos'='[96501]' and (:'m'::jsonb->>'versao')::bigint>:v1,'065 marcar devolve pedidos do dia');
select qa.check((select motivo='medico' from rota_065_sem_saida where dia='2026-11-27' and veiculo_id='s10')
 and not exists(select from rota_plano_semana where cd_pedido=96501),'065 data sem saida gravada e plano liberado');
select qa.check((select l->'sem_saida'='[{"dia":"2026-11-27","motivo":"medico","veiculo_id":"s10"}]' from (select rota_065_ler_semana('2026-11-23') l) x),'065 ler mostra sem saida');
select qa.check(qa.sv(jsonb_build_array(qa.it(96501,'2026-11-27','s10',1)))->>'motivo'='dia_sem_saida','065 salvar respeita data sem saida');
select qa.check(rota_065_marcar_sem_saida('2026-11-27','s10',false,(rota_065_ler_semana('2026-11-23')->>'versao')::bigint)->>'status'='ok','065 desmarcar ok');
select qa.check(not exists(select from rota_065_sem_saida),'065 desmarcar apaga a data');

-- ---------- o plano vale no fechamento ----------
-- Plano de sexta 27: S10 = 96502(1),96501(2); 96503 removido; 96504 programado p/ sabado (strada sai); 96509 ignorado(045).
select qa.check(qa.sv(jsonb_build_array(qa.it(96502,'2026-11-27','s10',1),qa.it(96501,'2026-11-27','s10',2),qa.it(96503,'2026-11-27','strada',null,true),
 qa.it(96504,'2026-11-28','strada',1),qa.it(96505,'2026-11-27','caminhao',null),qa.it(96509,'2026-11-27','s10',3)))->>'status'='ok','065 plano de sexta salvo');
reset role;
create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select '2026-11-27'::date$$;
insert into rota_065_sem_saida(dia,veiculo_id) values('2026-11-27','strada');
set role authenticated;set qa.uid='22222222-2222-4222-8222-222222222222';
-- Painel manda a previsao dele: ignora o plano (96507 e 96504 na S10, 96503 e 96506 na strada).
select rota_050_fechar('[{"cd_pedido":96507,"veiculo_id":"s10","ordem":1},{"cd_pedido":96504,"veiculo_id":"s10","ordem":2},
 {"cd_pedido":96503,"veiculo_id":"s10","ordem":3},{"cd_pedido":96506,"veiculo_id":"strada","ordem":1}]') is not null fechou \gset
reset role;
select qa.check((select string_agg(cd_pedido||':'||veiculo_id||':'||coalesce(ordem::text,'-'),',' order by veiculo_id,ordem nulls last,cd_pedido)
 from rota_dia_item where data='2026-11-27')='96505:caminhao:-,96502:s10:1,96501:s10:2,96507:s10:3','065 fechamento: plano entra na ordem, removido/futuro/ignorado/sem saida saem');
-- Fechamento automatico (Edge) passa pelo mesmo caminho.
delete from rota_dia_item where data='2026-11-27';delete from rota_dia_log where data='2026-11-27';delete from rota_dia_fechada where data='2026-11-27';
update rota_config set hora_saida='00:00';
select qa.check((rota_050_fechar_auto('[{"cd_pedido":96504,"veiculo_id":"s10","ordem":1}]')->>'fechou')::boolean,'065 auto fecha');
select qa.check(not exists(select from rota_dia_item where data='2026-11-27' and cd_pedido=96504)
 and (select string_agg(cd_pedido::text,',' order by veiculo_id,ordem nulls last) from rota_dia_item where data='2026-11-27')='96505,96502,96501','065 auto aplica o plano');
update rota_config set hora_saida='08:00';
-- Sem plano para o veiculo: ordem do painel inalterada (comportamento 050/055).
select qa.check((public.rota_065_aplicar_plano('2026-11-30','[{"cd_pedido":96507,"veiculo_id":"strada","ordem":7}]'::jsonb))
 ='[{"ordem":7,"cd_pedido":96507,"veiculo_id":"strada"}]'::jsonb,'065 sem plano mantem lista do painel');

-- ======================= B065-R1..R4 (correcoes 26/11) =======================
-- Cada cenario roda numa transacao e termina em ROLLBACK; o resultado volta por variavel e e conferido depois.
reset role;
create function qa.estado(comando text) returns text language plpgsql as $$
declare r text;begin begin execute comando;return '00000';exception when others then get stacked diagnostics r=returned_sqlstate;return r;end;end$$;
grant execute on function qa.estado(text) to authenticated;
create function qa.foto(d date) returns text language sql as $$select coalesce(string_agg(cd_pedido||':'||veiculo_id||':'||coalesce(ordem::text,'-'),',' order by veiculo_id,ordem nulls last,cd_pedido),'')
 from public.rota_dia_item where data=d and removido_em is null$$;
-- Base comum: hoje = qua 25/11, saida 08:00, fixture neutralizada (nenhum outro pedido pendente/candidato).
create function qa.base_b065() returns void language plpgsql as $body$begin
 execute $f$create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $x$select '2026-11-25'::date$x$ $f$;
 update rota_config set hora_saida='08:00' where id=1;
 delete from rota_dia_item where data='2026-11-25';delete from rota_dia_log where data='2026-11-25';delete from rota_dia_fechada where data='2026-11-25';
 delete from rota_plano_semana;delete from rota_065_sem_saida;
 update solidcon_pedidos_erp set etapa='atendido',dt_saida='2026-01-01T10:00-03';
 insert into rota_pedido_ignorado(cd_pedido) select cd_pedido from solidcon_pedidos_erp on conflict do nothing;
end$body$;

-- ---- R1: corte 061 sobre a lista FINAL no automatico; plano salvo na vespera; 07:59 / 08:00 exato / .001 / tique atrasado ----
begin;
select qa.base_b065();
insert into solidcon_pedidos_erp(cd_pedido,etapa,dt_pedido,dt_sep_inicio) values
 (99711,'conferido','2026-11-24T10:00-03','2026-11-25T07:59-03'),
 (99712,'conferido','2026-11-24T10:00-03','2026-11-25T08:00:00-03'),
 (99713,'conferido','2026-11-24T10:00-03','2026-11-25T08:00:00.001-03'),
 (99714,'conferido','2026-11-24T10:00-03','2026-11-25T08:01-03'),
 (99715,'separando','2026-11-24T10:00-03','2026-11-25T08:30-03'),
 (99716,'conferido','2026-11-25T08:00:00.001-03',null);
-- Plano gravado em 24/11 (vespera) para 25/11.
insert into rota_plano_semana(cd_pedido,dia,veiculo_id,ordem,atualizado_em) values
 (99711,'2026-11-25','s10',1,'2026-11-24T17:00-03'),(99712,'2026-11-25','s10',2,'2026-11-24T17:00-03'),
 (99713,'2026-11-25','s10',3,'2026-11-24T17:00-03'),(99714,'2026-11-25','s10',4,'2026-11-24T17:00-03'),
 (99716,'2026-11-25','strada',1,'2026-11-24T17:00-03');
set local qa.auto_agora='2026-11-25T07:59:00-03';
select rota_050_fechar_auto('[]')->>'motivo'='antes_da_hora' r1_0759 \gset
set local qa.auto_agora='2026-11-25T10:00:00-03';
select (rota_050_fechar_auto('[{"cd_pedido":99715,"veiculo_id":"s10","ordem":1}]')->>'fechou')::boolean r1_fechou \gset
select qa.foto('2026-11-25') r1_foto_auto \gset
-- Manual no mesmo horario continua livre quanto ao corte.
delete from rota_dia_item where data='2026-11-25';delete from rota_dia_fechada where data='2026-11-25';
set local qa.uid='22222222-2222-4222-8222-222222222222';
set local role authenticated;
select rota_050_fechar('[{"cd_pedido":99715,"veiculo_id":"s10","ordem":1}]') is not null r1_manual \gset
reset role;
select qa.foto('2026-11-25') r1_foto_manual \gset
-- 08:00 exato (tique em ponto): 07:59 e 08:00:00 entram; .001 e 08:01 saem.
delete from rota_dia_item where data='2026-11-25';delete from rota_dia_fechada where data='2026-11-25';
set local qa.auto_agora='2026-11-25T08:00:00-03';
select (rota_050_fechar_auto('[]')->>'fechou')::boolean r1_0800 \gset
select qa.foto('2026-11-25') r1_foto_0800 \gset
rollback;
select qa.check(:'r1_0759'::boolean,'B065-R1 07:59 nao fecha');
select qa.check(:'r1_fechou'::boolean and :'r1_foto_auto'='99711:s10:1,99712:s10:2','B065-R1 tique atrasado: plano da vespera passa pelo corte 061 (0759 e 0800 exato entram, .001/0801/pos-saida saem)');
select qa.check(:'r1_manual'::boolean and :'r1_foto_manual'='99711:s10:1,99712:s10:2,99713:s10:3,99714:s10:4,99715:s10:5,99716:strada:1','B065-R1 manual continua livre do corte');
select qa.check(:'r1_0800'::boolean and :'r1_foto_0800'='99711:s10:1,99712:s10:2','B065-R1 tique das 08:00 exato aplica o mesmo corte');

-- ---- R2: 054 candidatos/incluir respeitam o plano 065 antes das 08:00; ajuste manual continua possivel ----
begin;
select qa.base_b065();
insert into solidcon_pedidos_erp(cd_pedido,etapa,dt_pedido,dt_sep_inicio) values
 (99721,'separando','2026-11-24T10:00-03','2026-11-25T07:00-03'),
 (99722,'separando','2026-11-24T10:00-03','2026-11-25T07:00-03'),
 (99723,'separando','2026-11-24T10:00-03','2026-11-25T07:00-03'),
 (99724,'separando','2026-11-24T10:00-03','2026-11-25T07:00-03'),
 (99726,'separando','2026-11-24T10:00-03','2026-11-25T07:00-03'),
 (99727,'separando','2026-11-24T10:00-03','2026-11-25T07:00-03');
-- 99721 plano 26/11 (outro dia); 99722 removido de 25/11; 99723 sem plano (S10); 99724 marcado strada, strada nao sai
-- nesta data; 99726 plano de HOJE na S10 mas marcado caminhao; 99727 plano de HOJE na strada (sem saida avulsa).
insert into rota_pedido_veiculo(cd_pedido,veiculo) values(99724,'strada'),(99726,'caminhao');
insert into rota_plano_semana(cd_pedido,dia,veiculo_id,ordem,removido) values
 (99721,'2026-11-26','s10',1,false),(99722,'2026-11-25','s10',null,true),(99726,'2026-11-25','s10',1,false),(99727,'2026-11-25','strada',1,false);
insert into rota_065_sem_saida(dia,veiculo_id) values('2026-11-25','strada');
set local qa.agora='2026-11-25T07:59:00-03';
select string_agg(cd_pedido||':'||veiculo_id,',' order by cd_pedido) r2_cand0 from rota_054_candidatos('2026-11-25') \gset
set local qa.uid='22222222-2222-4222-8222-222222222222';set local qa.role='authenticated';
set local role authenticated;
select rota_050_fechar('[]') is not null r2_fechou \gset
reset role;
select qa.foto('2026-11-25') r2_foto0 \gset
select string_agg(cd_pedido||':'||veiculo_id,',' order by cd_pedido) r2_cand1 from rota_054_candidatos('2026-11-25') \gset
-- Proposta do painel/Edge (rota-core sem o filtro 065): traz 99721/99722/99724 que o plano tira.
-- (chamada como na Sentinela: qa.uid = Marcio, auth.role() authenticated; revisao lida pela fixture)
select qa.estado($q$select rota_054_incluir('2026-11-25',(select revisao from rota_dia_fechada where data='2026-11-25'),
 '[{"cd_pedido":99726,"veiculo_id":"s10","ordem":1},{"cd_pedido":99721,"veiculo_id":"s10","ordem":2},{"cd_pedido":99723,"veiculo_id":"s10","ordem":3},
   {"cd_pedido":99722,"veiculo_id":"s10","ordem":4},{"cd_pedido":99724,"veiculo_id":"strada","ordem":1}]')$q$)='00000' r2_ok \gset
reset role;
select qa.foto('2026-11-25') r2_foto1 \gset
rollback;
select qa.check(:'r2_cand0'='99723:s10,99726:s10','B065-R2 candidatos: sem outro dia/removido/sem saida avulsa; veiculo do plano de hoje');
select qa.check(:'r2_fechou'::boolean and :'r2_foto0'='99726:s10:1','B065-R2 fechar manual 07:59: plano de hoje entra, outro dia/removido/sem saida fora');
select qa.check(:'r2_cand1'='99723:s10','B065-R2 depois de fechar so o candidato legitimo');
select qa.check(:'r2_ok'::boolean and :'r2_foto1'='99726:s10:1,99723:s10:2','B065-R2 incluir aceita a proposta sem os pedidos que o plano tira (ordem 1..N)');
select qa.check((select position('lock(5100,5001)' in d)>0 and position('lock(5100,5001)' in d)<position('lock(5100,4601)' in d) from (select pg_get_functiondef('public.rota_054_incluir(date,integer,jsonb)'::regprocedure) d) x)
 and (select position('lock(5100, 4601)' in d)>0 and position('lock(5100, 4601)' in d)<position('rota_065_aplicar_plano' in d) from (select pg_get_functiondef('public.rota_050_gravar_itens(date,jsonb,uuid)'::regprocedure) d) x),
 'B065-R2 incluir e fechamento pegam a trava 4601 do plano depois da 5001 (concorrencia real: rota-semana-065.pg.test.js)');

begin;
select qa.base_b065();
insert into solidcon_pedidos_erp(cd_pedido,etapa,dt_pedido,dt_sep_inicio) values
 (99721,'separando','2026-11-24T10:00-03','2026-11-25T07:00-03'),(99723,'separando','2026-11-24T10:00-03','2026-11-25T07:00-03');
insert into rota_plano_semana(cd_pedido,dia,veiculo_id,ordem) values(99721,'2026-11-26','s10',1);
set local qa.agora='2026-11-25T07:59:00-03';
set local qa.uid='22222222-2222-4222-8222-222222222222';set local qa.role='authenticated';
set local role authenticated;
select rota_050_fechar('[]') is not null r2b_fechou \gset
reset role;
-- Diferenca que NAO vem do plano (falta o candidato legitimo) continua 40001.
select qa.estado($q$select rota_054_incluir('2026-11-25',(select revisao from rota_dia_fechada where data='2026-11-25'),'[{"cd_pedido":99721,"veiculo_id":"s10","ordem":1}]')$q$) r2b_40001 \gset
-- Ajuste manual explicito do dia ("Trazer para hoje") continua possivel com plano para amanha.
select qa.estado($q$select rota_050_ajustar('adicionar',array[99721]::bigint[],'s10','[{"cd_pedido":99721,"ordem":1}]')$q$)='00000' r2b_manual \gset
reset role;
select qa.foto('2026-11-25') r2b_foto \gset
rollback;
select qa.check(:'r2b_40001'='40001','B065-R2 outra divergencia da proposta continua 40001');
select qa.check(:'r2b_manual'::boolean and :'r2b_foto'='99721:s10:1','B065-R2 ajuste manual do dia continua livre');

-- ---- B065-R2-A: veiculo do plano de HOJE diferente da marcacao (core propoe pela marcacao) ----
-- Repro da Sentinela: fora da rota (045) no fechamento, reativado antes das 08:00; proposta do core = S10.
begin;
select qa.base_b065();
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_pedido,dt_sep_inicio) values(99741,'12000000099741','separando','2026-11-24T10:00-03','2026-11-25T07:00-03');
insert into rota_pedido_veiculo(cd_pedido,veiculo) values(99741,'s10');
insert into rota_plano_semana(cd_pedido,dia,veiculo_id,ordem) values(99741,'2026-11-25','strada',1);
set local qa.uid='22222222-2222-4222-8222-222222222222';set local qa.role='authenticated';set local qa.agora='2026-11-25T07:59:00-03';
insert into rota_pedido_ignorado(cd_pedido) values(99741);select rota_050_fechar('[]') is not null r2a_fechou \gset
delete from rota_pedido_ignorado where cd_pedido=99741;
select string_agg(cd_pedido||':'||veiculo_id,',') r2a_cand from rota_054_candidatos('2026-11-25') \gset
select qa.estado($q$select rota_054_incluir('2026-11-25',(select revisao from rota_dia_fechada where data='2026-11-25'),'[{"cd_pedido":99741,"veiculo_id":"s10","ordem":1}]')$q$) r2a_1 \gset
select qa.foto('2026-11-25') r2a_foto \gset
rollback;
select qa.check(:'r2a_cand'='99741:strada' and :'r2a_1'='00000' and :'r2a_foto'='99741:strada:1','B065-R2-A proposta do core na marcacao: entra no veiculo do plano');

-- Na mesma chamada: plano Strada/marcacao S10, plano S10/marcacao Strada, plano CD/CEASA/marcacao S10, candidato comum,
-- foto ja com paradas nos dois veiculos. Retry depois do sucesso nao duplica.
begin;
select qa.base_b065();
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_pedido,dt_sep_inicio) values
 (99741,'12000000099741','separando','2026-11-24T10:00-03','2026-11-25T07:00-03'),
 (99742,'12000000099742','separando','2026-11-24T10:00-03','2026-11-25T07:00-03'),
 (99743,'12000000099743','separando','2026-11-24T10:00-03','2026-11-25T07:00-03'),
 (99744,'12000000099744','separando','2026-11-24T10:00-03','2026-11-25T07:00-03'),
 (99745,'12000000099745','conferido','2026-11-24T10:00-03',null),
 (99746,'12000000099746','conferido','2026-11-24T10:00-03',null);
insert into rota_pedido_veiculo(cd_pedido,veiculo) values(99741,'s10'),(99742,'strada'),(99743,'s10');
insert into rota_plano_semana(cd_pedido,dia,veiculo_id,ordem) values
 (99741,'2026-11-25','strada',2),(99742,'2026-11-25','s10',2),(99743,'2026-11-25','caminhao',null),(99745,'2026-11-25','strada',1),(99746,'2026-11-25','s10',1);
set local qa.uid='22222222-2222-4222-8222-222222222222';set local qa.role='authenticated';set local qa.agora='2026-11-25T07:59:00-03';
insert into rota_pedido_ignorado(cd_pedido) values(99741),(99742),(99743);
select rota_050_fechar('[]') is not null r2c_fechou \gset
delete from rota_pedido_ignorado where cd_pedido in(99741,99742,99743);
select qa.foto('2026-11-25') r2c_foto0 \gset
select string_agg(cd_pedido||':'||veiculo_id,',' order by cd_pedido) r2c_cand from rota_054_candidatos('2026-11-25') \gset
-- Proposta como o core faria (veiculo pela marcacao; cobre S10 e Strada da foto).
select qa.estado($q$select rota_054_incluir('2026-11-25',(select revisao from rota_dia_fechada where data='2026-11-25'),
 '[{"cd_pedido":99746,"veiculo_id":"s10","ordem":1},{"cd_pedido":99741,"veiculo_id":"s10","ordem":2},{"cd_pedido":99743,"veiculo_id":"s10","ordem":3},
   {"cd_pedido":99744,"veiculo_id":"s10","ordem":4},{"cd_pedido":99745,"veiculo_id":"strada","ordem":1},{"cd_pedido":99742,"veiculo_id":"strada","ordem":2}]')$q$) r2c_1 \gset
select qa.foto('2026-11-25') r2c_foto1 \gset
select (rota_054_incluir('2026-11-25',(select revisao from rota_dia_fechada where data='2026-11-25'),'[]')->>'incluidos')::int r2c_retry \gset
select count(*) r2c_n from rota_dia_item where data='2026-11-25' \gset
rollback;
select qa.check(:'r2c_foto0'='99746:s10:1,99745:strada:1' and :'r2c_cand'='99741:strada,99742:s10,99743:caminhao,99744:s10','B065-R2-A candidatos no veiculo do plano (S10, Strada, CD/CEASA)');
select qa.check(:'r2c_1'='00000' and :'r2c_foto1'='99743:caminhao:-,99746:s10:1,99744:s10:2,99742:s10:3,99745:strada:1,99741:strada:2',
 'B065-R2-A plano vence a marcacao nos dois sentidos e no CD/CEASA; candidato comum entra; fim da rota do veiculo do plano');
select qa.check(:'r2c_retry'=0 and :'r2c_n'=6,'B065-R2-A retry depois do sucesso nao duplica');

-- ---- R3: salvar semana nao move/apaga linha nao editavel; gatilho barra DML direto do authenticated ----
begin;
select qa.base_b065();
update solidcon_pedidos_erp set etapa='conferido' where cd_pedido between 96501 and 96506;
insert into rota_plano_semana(cd_pedido,dia,veiculo_id,ordem) values
 (96501,'2026-11-24','s10',1),(96502,'2026-11-26','inativo',1),(96503,'2026-11-26','s10',1),(96504,'2026-11-25','s10',1),(96505,'2026-11-20','s10',1);
set local qa.uid='22222222-2222-4222-8222-222222222222';
set local role authenticated;
select qa.sv(jsonb_build_array(qa.it(96501,'2026-11-26','s10',1))) r3_a \gset
select qa.sv(jsonb_build_array(qa.it(96504,'2026-11-26','s10',1))) r3_b \gset
select qa.sv(jsonb_build_array(qa.it(96502,'2026-11-26','s10',1))) r3_c \gset
select qa.sv(jsonb_build_array(qa.it(96505,'2026-11-26','s10',1),qa.it(96503,'2026-11-26','s10',2)))->>'status' r3_d \gset
reset role;
select string_agg(cd_pedido||':'||dia||':'||veiculo_id||':'||coalesce(ordem::text,'-'),',' order by cd_pedido) r3_d_linhas from rota_plano_semana \gset
set local role authenticated;
select qa.sv('[]')->>'status' r3_e \gset
reset role;
select string_agg(cd_pedido::text,',' order by cd_pedido) r3_e_linhas from rota_plano_semana \gset
-- DML direto (policies 046 por pode_marcar_rota): travada nao muda nem some; editavel continua livre.
insert into rota_plano_semana(cd_pedido,dia,veiculo_id,ordem) values(96503,'2026-11-26','s10',1);
set local role authenticated;
select qa.estado($q$update rota_plano_semana set dia='2026-11-27' where cd_pedido=96504$q$) r3_upd_hoje \gset
select qa.estado($q$delete from rota_plano_semana where cd_pedido=96502$q$) r3_del_inativo \gset
select qa.estado($q$update rota_plano_semana set dia='2026-11-26' where cd_pedido=96501$q$) r3_upd_passado \gset
select qa.estado($q$insert into rota_plano_semana(cd_pedido,dia,veiculo_id) values(96506,'2026-11-25','s10')$q$) r3_ins_hoje \gset
select qa.estado($q$update rota_plano_semana set dia='2026-11-30',ordem=1 where cd_pedido=96503$q$) r3_upd_livre \gset
reset role;
select (select dia from rota_plano_semana where cd_pedido=96503)='2026-11-30' r3_livre_gravou \gset
rollback;
select qa.check(:'r3_a'::jsonb @> '{"status":"erro","motivo":"dia_bloqueado","cd_pedido":96501,"origem":true}','B065-R3 nao move do passado desta semana');
select qa.check(:'r3_b'::jsonb @> '{"motivo":"dia_bloqueado","cd_pedido":96504,"origem":true}','B065-R3 nao move de hoje');
select qa.check(:'r3_c'::jsonb @> '{"motivo":"dia_bloqueado","cd_pedido":96502,"origem":true}','B065-R3 nao move de veiculo inativo');
select qa.check(:'r3_d'='ok' and :'r3_d_linhas'='96501:2026-11-24:s10:1,96502:2026-11-26:inativo:1,96503:2026-11-26:s10:2,96504:2026-11-25:s10:1,96505:2026-11-26:s10:1',
 'B065-R3 salvar preserva linhas travadas; sobra de semana anterior pode ser reprogramada');
select qa.check(:'r3_e'='ok' and :'r3_e_linhas'='96501,96502,96504','B065-R3 DELETE so do editavel completo');
select qa.check(:'r3_upd_hoje'='22023' and :'r3_del_inativo'='22023' and :'r3_upd_passado'='22023' and :'r3_ins_hoje'='22023','B065-R3 DML direto em linha/dia travado recusa');
select qa.check(:'r3_upd_livre'='00000' and :'r3_livre_gravou'::boolean,'B065-R3 DML direto em linha editavel continua');

-- ---- R4: 047 legada (corpo da 065) limpa removido e grava ordem, entre semanas e entre veiculos; travada sem efeito ----
begin;
select qa.base_b065();
update solidcon_pedidos_erp set etapa='conferido' where cd_pedido between 96501 and 96507;
insert into rota_plano_semana(cd_pedido,dia,veiculo_id,ordem,removido) values
 (96501,'2026-11-26','s10',null,true),(96502,'2026-12-01','s10',5,false),(96503,'2026-12-01','strada',1,false),(96504,'2026-11-25','s10',1,false);
grant select on rota_veiculos,solidcon_pedidos_erp to authenticated;
set local qa.uid='22222222-2222-4222-8222-222222222222';
set local role authenticated;
select rota_047_salvar_semana('2026-11-30','s10','[{"cd_pedido":96503,"dia":"2026-12-01"},{"cd_pedido":96501,"dia":"2026-12-01"},{"cd_pedido":96502,"dia":"2026-12-02"}]') r4_n \gset
reset role;
select string_agg(cd_pedido||':'||dia||':'||veiculo_id||':'||coalesce(ordem::text,'-')||':'||removido,',' order by cd_pedido) r4_linhas from rota_plano_semana \gset
set local role authenticated;
-- Cliente antigo reenviando hoje (travado) e movendo de hoje: sem efeito; nao apaga a linha de hoje.
select rota_047_salvar_semana('2026-11-23','s10','[{"cd_pedido":96504,"dia":"2026-11-26"},{"cd_pedido":96505,"dia":"2026-11-25"},{"cd_pedido":96506,"dia":"2026-11-26"}]') r4_n2 \gset
reset role;
select string_agg(cd_pedido||':'||dia||':'||coalesce(ordem::text,'-'),',' order by cd_pedido) r4_linhas2 from rota_plano_semana where dia<'2026-11-30' \gset
rollback;
select qa.check(:'r4_n'=3 and :'r4_linhas'='96501:2026-12-01:s10:2:false,96502:2026-12-02:s10:1:false,96503:2026-12-01:s10:1:false,96504:2026-11-25:s10:1:false',
 'B065-R4 047 entre semanas/veiculos limpa removido e grava ordem 1..N por dia no ON CONFLICT');
select qa.check(:'r4_n2'=2 and :'r4_linhas2'='96504:2026-11-25:1,96506:2026-11-26:1','B065-R4 047 legada: linha/dia travado sem efeito, editavel grava');

-- ---------- rollback ----------
create temporary table dados065 as select (select jsonb_agg(to_jsonb(p) order by cd_pedido) from rota_plano_semana p) plano,
 (select jsonb_agg(to_jsonb(s)) from rota_065_semana s) versoes;
\ir ../../admin/migracoes/065_rollback.sql
\ir ../../admin/migracoes/065_rollback.sql
select qa.check((select replace(pg_get_functiondef('public.rota_050_gravar_itens(date,jsonb,uuid)'::regprocedure),chr(13),'')=replace(corpo,chr(13),'') from corpo055),'065 rollback gravar_itens 055 exato');
select qa.check(to_regprocedure('public.rota_065_salvar_semana(date,bigint,jsonb,text)') is null and not exists(select from pg_trigger where tgname='rota_065_plano_versao'),'065 rollback remove RPCs e gatilho');
select qa.check((select plano=(select jsonb_agg(to_jsonb(p) order by cd_pedido) from rota_plano_semana p) from dados065),'065 rollback preserva plano');
select qa.check((select replace(pg_get_functiondef('public.rota_054_candidatos(date)'::regprocedure),chr(13),'')=replace(cand,chr(13),'')
 and replace(pg_get_functiondef('public.rota_054_incluir(date,integer,jsonb)'::regprocedure),chr(13),'')=replace(incl,chr(13),'') from corpo061),'B065 rollback 054 candidatos/incluir 061 exatos');
select qa.check(not exists(select from pg_trigger where tgname='rota_065_plano_guardar') and to_regprocedure('public.rota_065_fora_auto(bigint,date,text)') is null
 and to_regprocedure('public.rota_065_linha_editavel(date,text)') is null,'B065 rollback remove guarda e auxiliares');
begin;
delete from rota_plano_semana;insert into rota_plano_semana(cd_pedido,dia,veiculo_id,ordem,removido) values(96501,'2026-11-26','s10',null,true);
update solidcon_pedidos_erp set etapa='conferido' where cd_pedido=96501;
grant select on rota_veiculos,solidcon_pedidos_erp to authenticated;
set local qa.uid='22222222-2222-4222-8222-222222222222';set local role authenticated;
select rota_047_salvar_semana('2026-11-30','s10','[{"cd_pedido":96501,"dia":"2026-12-01"}]') rb_n \gset
reset role;
select (select dia||':'||ordem||':'||removido from rota_plano_semana where cd_pedido=96501) rb_linha \gset
rollback;
select qa.check(:'rb_n'=1 and :'rb_linha'='2026-12-01:1:false','B065-R4 apos rollback a 047 tambem limpa removido e grava ordem');
\ir ../../admin/migracoes/065_semana_plano.sql
select qa.check((select versoes=(select jsonb_agg(to_jsonb(s)) from rota_065_semana s) from dados065),'065 reaplicar preserva versoes');
select count(*) filter(where nome like '065%') testes_065,count(*) testes_total from qa.checks;
