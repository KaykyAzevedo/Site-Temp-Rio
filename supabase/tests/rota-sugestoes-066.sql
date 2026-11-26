\set ON_ERROR_STOP on
-- 066 Assistente da semana. Herda a fixture completa da 065 (guard localhost/DB sentinela_separando_*, 050..065 reais).
\ir rota-semana-065.sql
reset role;set search_path=public,pg_catalog;set timezone='America/Sao_Paulo';
-- Stubs fieis a 023/033/039/047 (as migracoes completas exigem o resto do ERP): so as colunas que a 066 le.
alter table solidcon_pedidos_erp add column if not exists caixas_24 integer,add column if not exists caixas_48 integer,add column if not exists caixas_outras integer;
alter table rota_veiculos add column if not exists capacidade_volume numeric;
create table if not exists public.solidcon_clientes(documento text primary key,nome text not null);
create table if not exists public.solidcon_clientes_geo(documento text primary key,lat numeric(9,6),lng numeric(9,6),precisao text not null);
create temporary table corpo065 as select pg_get_functiondef('public.rota_050_gravar_itens(date,jsonb,uuid)'::regprocedure) gravar,
 pg_get_functiondef('public.rota_054_incluir(date,integer,jsonb)'::regprocedure) incluir;
\ir ../../admin/migracoes/066_rota_sugestoes.sql
\ir ../../admin/migracoes/066_rota_sugestoes.sql
select qa.check((select replace(pg_get_functiondef('public.rota_050_gravar_itens(date,jsonb,uuid)'::regprocedure),chr(13),'')=replace(gravar,chr(13),'')
 and replace(pg_get_functiondef('public.rota_054_incluir(date,integer,jsonb)'::regprocedure),chr(13),'')=replace(incluir,chr(13),'') from corpo065),'066 nao mexe no fechamento nem na 054');
select qa.check(not has_function_privilege('anon','public.rota_066_sugestoes(date)','execute')
 and not has_function_privilege('anon','public.rota_066_registrar(bigint,text,date)','execute')
 and not has_function_privilege('authenticated','public.rota_066_prazo(timestamptz,text)','execute')
 and not has_table_privilege('authenticated','public.rota_066_historico','select')
 and not has_table_privilege('authenticated','public.rota_066_feedback','select'),'066 grants minimos');

-- ---------- cenario: hoje = domingo 29/11/2026; semana 30/11..05/12 inteira editavel ----------
create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select '2026-11-29'::date$$;
delete from rota_plano_semana;delete from rota_065_sem_saida;delete from rota_066_historico;delete from rota_066_feedback;
delete from rota_dia_item where data>='2026-10-01';delete from rota_dia_log where data>='2026-10-01';delete from rota_dia_fechada where data>='2026-10-01';
update solidcon_pedidos_erp set etapa='atendido',dt_saida='2026-01-01T10:00-03';
update rota_config set corte_hora=null,feriados_sem_saida=true,feriados_extras=null,hora_saida='08:00' where id=1;
update rota_veiculos set dias_sem_saida='{0,6}',capacidade_volume=2700 where id='s10';
update rota_veiculos set dias_sem_saida='{0,6}',capacidade_volume=900 where id='strada';   -- sabado so o caminhao
update rota_veiculos set dias_sem_saida='{0}',capacidade_volume=null where id='caminhao';
insert into rota_065_sem_saida(dia,veiculo_id,motivo) values('2026-12-03','s10','medico');   -- S10 nao sai na quinta
create function qa.doc(n int) returns text language sql immutable as $$select '660000000000'||lpad(n::text,2,'0')$$;
insert into solidcon_clientes select qa.doc(n),'Cliente '||chr(64+n) from generate_series(1,15) n;
-- A..O = 98101..98115 (doc n). Prazo S10 = 2 dias uteis seg..sex do pedido.
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_pedido,caixas_24) values
 (98101,qa.doc(1),'conferido','2026-11-27T10:00-03',null),   -- A s10: prazo ter 01/12
 (98102,qa.doc(2),'conferido','2026-12-03T10:00-03',null),   -- B caminhao: prazo sab 05/12
 (98103,qa.doc(3),'conferido','2026-12-03T10:00-03',null),   -- C s10: prazo seg 07/12 -> sexta (S10 nao sai sabado)
 (98104,qa.doc(4),'conferido','2026-12-03T10:00-03',null),   -- D strada: idem -> sexta
 (98105,qa.doc(5),'conferido','2026-12-01T10:00-03',null),   -- E s10: prazo qui 03/12, mas S10 nao sai na quinta
 (98106,qa.doc(6),'conferido','2026-11-20T10:00-03',null),   -- F s10: venceu ter 24/11
 (98107,qa.doc(7),'conferido','2026-11-29T10:00-03',null),   -- G s10: prazo ter, perto de H (programado seg)
 (98108,qa.doc(8),'conferido','2026-11-28T10:00-03',null),   -- H programado seg 30/11 (no prazo)
 (98109,qa.doc(9),'conferido','2026-11-29T10:00-03',290),    -- I programado ter 01/12: 290 cx (S10 = 300 cx)
 (98110,qa.doc(10),'conferido','2026-11-29T10:00-03',5),     -- J 5 cx, perto de I: cabe
 (98111,qa.doc(11),'conferido','2026-11-29T10:00-03',20),    -- K 20 cx, perto de I: nao cabe
 (98112,qa.doc(12),'conferido','2026-12-01T10:00-03',null),  -- L strada: prazo qui 03/12; costuma ir as quartas com M
 (98113,qa.doc(13),'conferido','2026-12-01T10:00-03',null),  -- M programado strada qua 02/12
 (98114,qa.doc(14),'conferido','2026-11-27T10:00-03',null),  -- N programado sex 04/12 depois do prazo (ter)
 (98115,qa.doc(15),'conferido','2026-11-29T10:00-03',null);  -- O sem marcacao nenhuma
insert into rota_pedido_veiculo(cd_pedido,veiculo) values(98101,'s10'),(98102,'caminhao'),(98103,'s10'),(98104,'strada'),(98105,'s10'),(98106,'s10'),
 (98107,'s10'),(98108,'s10'),(98109,'s10'),(98110,'s10'),(98111,'s10'),(98112,'strada'),(98113,'strada'),(98114,'s10')
 on conflict (cd_pedido) do update set veiculo=excluded.veiculo;
insert into solidcon_clientes_geo(documento,lat,lng,precisao) values
 (qa.doc(8),-22.900000,-43.200000,'endereco'),(qa.doc(7),-22.895500,-43.200000,'endereco'),   -- G a 0,5 km de H
 (qa.doc(9),-22.990000,-43.200000,'endereco'),(qa.doc(10),-22.981000,-43.200000,'endereco'),  -- J a 1,0 km de I
 (qa.doc(11),-22.976500,-43.200000,'endereco');                                               -- K a 1,5 km de I
-- Memoria pelos GATILHOS (foto fechada): L e M juntos na strada em 4 quartas; peso cai com a idade.
insert into rota_dia_fechada(data,estado) select d,'fechada' from unnest(array['2026-10-28','2026-11-04','2026-11-11','2026-11-18']::date[]) d;
insert into rota_dia_item(data,cd_pedido,documento,veiculo_id,ordem)
 select d,98200+2*k,qa.doc(12),'strada',1 from unnest(array['2026-10-28','2026-11-04','2026-11-11','2026-11-18']::date[]) with ordinality t(d,k)
 union all select d,98201+2*k,qa.doc(13),'strada',2 from unnest(array['2026-10-28','2026-11-04','2026-11-11','2026-11-18']::date[]) with ordinality t(d,k);
select qa.check((select count(*)=8 and count(distinct dia)=4 from rota_066_historico where fonte='foto'),'066 gatilho grava a foto na memoria');
-- Item removido da foto sai da memoria; voltar recoloca.
update rota_dia_item set removido_em=now() where cd_pedido=98202;
select qa.check(not exists(select from rota_066_historico where cd_pedido=98202),'066 removido da foto sai da memoria');
update rota_dia_item set removido_em=null where cd_pedido=98202;
select qa.check(exists(select from rota_066_historico where cd_pedido=98202 and fonte='foto'),'066 voltar para a foto recoloca');
-- Plano salvo (065) pelo Marcio: H seg, I ter, M qua, N sex (atrasa).
set role authenticated;set qa.uid='22222222-2222-4222-8222-222222222222';
select qa.check(qa.sv(jsonb_build_array(qa.it(98108,'2026-11-30','s10',1),qa.it(98109,'2026-12-01','s10',1),qa.it(98113,'2026-12-02','strada',1),
 qa.it(98114,'2026-12-04','s10',1)),null,'2026-11-30')->>'status'='ok','066 plano da semana salvo');
reset role;
select qa.check((select count(*)=4 from rota_066_historico where fonte='plano'),'066 gatilho grava o plano na memoria');
create temporary table antes066 as select (select count(*) from rota_plano_semana) plano,(select count(*) from rota_dia_item) foto,
 (select count(*) from rota_066_historico) hist,(select count(*) from rota_066_feedback) fb,(select max(versao) from rota_065_semana) versao;

-- ---------- permissao ----------
set role authenticated;
set qa.uid='33333333-3333-4333-8333-333333333333';
select qa.erro($c$select rota_066_sugestoes('2026-11-30')$c$,'42501','066 motorista nao ve sugestoes');
select qa.erro($c$select rota_066_registrar(98101,'aceita','2026-12-01')$c$,'42501','066 motorista nao registra');
set qa.uid='44444444-4444-4444-8444-444444444444';
select qa.erro($c$select rota_066_sugestoes('2026-11-30')$c$,'42501','066 vendedor nao ve sugestoes');
set qa.uid='22222222-2222-4222-8222-222222222222';
select qa.check(rota_066_sugestoes('2026-12-01')->>'motivo'='parametro_invalido','066 semana fora da segunda');
select qa.check(rota_066_sugestoes('2027-06-07')->>'motivo'='parametro_invalido','066 semana longe demais');

-- ---------- sugestoes ----------
select rota_066_sugestoes('2026-11-30') s \gset
reset role;
create function qa.p(s jsonb,cd bigint) returns jsonb language sql immutable as $$select e from jsonb_array_elements(s->'pedidos') e where (e->>'cd_pedido')::bigint=cd$$;
create function qa.d(s jsonb,dia text,v text) returns jsonb language sql immutable as $$select e from jsonb_array_elements(s->'dias') e where e->>'dia'=dia and e->>'veiculo_id'=v$$;
select qa.check(:'s'::jsonb->>'status'='ok' and (:'s'::jsonb->>'versao')::bigint=(select versao from rota_065_semana where inicio='2026-11-30'),'066 devolve a versao da semana (065)');
select qa.check((select count(*)=0 from (select 1 from antes066 where plano<>(select count(*) from rota_plano_semana) or foto<>(select count(*) from rota_dia_item)
 or hist<>(select count(*) from rota_066_historico) or fb<>(select count(*) from rota_066_feedback) or versao<>(select max(versao) from rota_065_semana)) x),'066 sugestoes so leitura');
select qa.check(qa.p(:'s',98101) @> '{"dia_sugerido":"2026-12-01","veiculo_sugerido":"s10","prazo":"2026-12-01","atrasado_se_dia":"2026-12-02"}'
 and qa.p(:'s',98101)->'motivo' ? 'prazo','066 prazo puxa ao ultimo dia util do veiculo');
select qa.check(qa.p(:'s',98102) @> '{"dia_sugerido":"2026-12-05","veiculo_sugerido":"caminhao"}'
 and qa.p(:'s',98103) @> '{"dia_sugerido":"2026-12-04","veiculo_sugerido":"s10","prazo":"2026-12-07"}'
 and qa.p(:'s',98104) @> '{"dia_sugerido":"2026-12-04","veiculo_sugerido":"strada"}','066 sabado so caminhao (S10/strada vao na sexta)');
select qa.check(qa.p(:'s',98105) @> '{"dia_sugerido":"2026-12-02","prazo":"2026-12-03"}' and qa.d(:'s','2026-12-03','s10') is null
 and qa.d(:'s','2026-12-03','strada') is not null,'066 S10 sem saida na quinta (data avulsa 065)');
select qa.check(qa.p(:'s',98106) @> '{"dia_sugerido":"2026-11-30","prazo":"2026-11-24","atrasado_se_dia":"2026-11-25"}'
 and qa.p(:'s',98106)->'motivo' ? 'vencido' and (qa.p(:'s',98106)->>'score')::numeric>=100
 and (:'s'::jsonb->'pedidos'->0->>'cd_pedido')='98106' and qa.p(:'s',98106)->>'texto' like 'Venceu ter 24/11 — primeiro dia livre seg%','066 vencido: primeiro dia, prioridade maxima');
select qa.check(qa.p(:'s',98107) @> '{"dia_sugerido":"2026-11-30"}' and qa.p(:'s',98107)->'motivo' ? 'mesma_regiao'
 and qa.p(:'s',98107)->>'texto'='Vence ter — sugerido seg (mesma região de Cliente H)','066 proximidade puxa para o dia do vizinho');
select qa.check(qa.d(:'s','2026-12-01','s10') @> '{"cx_planejadas":290.0,"cx_capacidade":300.0,"folga_cx":10.0,"paradas":1}','066 folga de capacidade do dia');
select qa.check(exists(select from jsonb_array_elements(:'s'::jsonb->'encaixes') e where e @> '{"dia":"2026-12-01","veiculo_id":"s10","cd_pedido":98110,"perto_de_cd":98109,"distancia_km":1.0}'
   and e->>'texto'='s10 tem 10 cx livres na ter: cabe Pedido 98110 (1,0 km de Cliente I)')
 and not exists(select from jsonb_array_elements(:'s'::jsonb->'encaixes') e where e @> '{"dia":"2026-12-01","cd_pedido":98111}'),'066 encaixe cabe na folga; maior que a folga nao');
select qa.check(qa.p(:'s',98112) @> '{"dia_sugerido":"2026-12-02","veiculo_sugerido":"strada","prazo":"2026-12-03"}'
 and qa.p(:'s',98112)->'motivo' ?& array['costuma_junto','costuma_dia']
 and qa.p(:'s',98112)->>'texto'='Vence qui — sugerido qua (costuma ir às quartas com Cliente M)','066 co-ocorrencia historica (memoria das fotos)');
select qa.check(qa.d(:'s','2026-12-02','strada') @> '{"paradas":1,"paradas_max":2,"folga_paradas":1}','066 paradas maximas pela media historica');
select qa.check(qa.p(:'s',98108) is null and qa.p(:'s',98109) is null and qa.p(:'s',98113) is null,'066 programado no prazo nao vira sugestao');
select qa.check(qa.p(:'s',98114) @> '{"dia_plano":"2026-12-04","prazo":"2026-12-01"}' and qa.p(:'s',98114)->'motivo' ? 'atrasa_no_plano'
 and (qa.p(:'s',98114)->>'dia_sugerido')<='2026-12-01' and qa.p(:'s',98114)->>'texto' like 'Programado sex atrasa.%','066 programado depois do prazo avisa e sugere no prazo');
select qa.check(qa.p(:'s',98115) @> '{"veiculo_sugerido":"s10"}' and qa.p(:'s',98115)->'motivo' ?& array['sem_marcacao','sem_geo'],'066 sem marcacao usa o padrao e avisa');

-- ---------- feedback ----------
set role authenticated;set qa.uid='22222222-2222-4222-8222-222222222222';
select qa.check(rota_066_registrar(98101,'talvez','2026-12-01')->>'motivo'='parametro_invalido'
 and rota_066_registrar(98101,'ignorada','2026-12-06')->>'motivo'='parametro_invalido'
 and rota_066_registrar(99999999,'ignorada','2026-12-01')->>'motivo'='pedido_inexistente','066 registrar valida');
select qa.check(rota_066_registrar(98101,'ignorada','2026-12-01')->>'status'='ok' and rota_066_registrar(98101,'ignorada','2026-12-01')->>'status'='ok','066 registrar ignorada');
select rota_066_sugestoes('2026-11-30') s2 \gset
reset role;
select qa.check((select count(*)=1 from rota_066_feedback where cd_pedido=98101),'066 clique repetido nao duplica');
select qa.check((qa.p(:'s2',98101)->>'score')::numeric<(qa.p(:'s',98101)->>'score')::numeric and qa.p(:'s2',98101)->>'dia_sugerido'='2026-11-30','066 feedback ignorado reduz score e muda o dia');
select qa.check(qa.p(:'s2',98107)=qa.p(:'s',98107),'066 feedback de um cliente nao mexe nos outros');
-- Ignorar a sugestao do mesmo dia da semana em outro pedido do cliente tambem pesa (por cliente + dia da semana).
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_pedido) values(98116,qa.doc(1),'conferido','2026-11-27T11:00-03');
insert into rota_pedido_veiculo(cd_pedido,veiculo) values(98116,'s10');
set role authenticated;
select rota_066_sugestoes('2026-11-30') s3 \gset
reset role;
select qa.check(qa.p(:'s3',98116)->>'dia_sugerido'='2026-11-30' and qa.p(:'s3',98116)->'motivo' ? 'prazo','066 feedback pesa no cliente/dia da semana');


-- ---------- B066-R1: plano de pedido que ja nao vale (entregue/faturado, 045) nao ocupa o dia nem serve de ancora ----------
begin;
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_pedido,dt_saida,caixas_24) values
 (98121,qa.doc(1),'atendido','2026-11-26T10:00-03','2026-11-27T09:00-03',300),   -- faturado/saiu (Recebido 063 ou aguardando canhoto)
 (98122,qa.doc(2),'conferido','2026-11-26T10:00-03',null,300);                    -- tirado da rota (045)
insert into rota_pedido_ignorado(cd_pedido) values(98122);
insert into rota_plano_semana(cd_pedido,dia,veiculo_id,ordem) values(98121,'2026-11-30','s10',2),(98122,'2026-11-30','s10',3);
insert into solidcon_clientes_geo(documento,lat,lng,precisao) values(qa.doc(1),-22.950000,-43.200000,'endereco') on conflict(documento) do update set lat=excluded.lat,lng=excluded.lng;
set local role authenticated;set local qa.uid='22222222-2222-4222-8222-222222222222';
select rota_066_sugestoes('2026-11-30') r1s \gset
reset role;
rollback;
select qa.check(qa.d(:'r1s','2026-11-30','s10') @> '{"cx_planejadas":0.0,"paradas":1,"folga_cx":300.0}','B066-R1 plano de pedido entregue/045 nao conta cx nem parada');
select qa.check(qa.p(:'r1s',98107)=qa.p(:'s',98107),'B066-R1 ancora de regiao so com programado que vale');

-- ---------- B066-R2: vencido continua no topo (>= 100) com dia lotado e feedback negativo; regular <= 99 ----------
begin;
update solidcon_pedidos_erp set caixas_24=1 where cd_pedido=98106;
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_pedido,caixas_24) values(98123,qa.doc(3),'conferido','2026-11-28T10:00-03',310);
insert into rota_pedido_veiculo(cd_pedido,veiculo) values(98123,'s10');
insert into rota_plano_semana(cd_pedido,dia,veiculo_id,ordem) values(98123,'2026-11-30','s10',2);   -- seg passa de 300 cx
insert into rota_066_feedback(cd_pedido,documento,acao,dia) select 98106,qa.doc(6),'ignorada','2026-11-30' from generate_series(1,5);
set local role authenticated;set local qa.uid='22222222-2222-4222-8222-222222222222';
select rota_066_sugestoes('2026-11-30') r2s \gset
reset role;
rollback;
select qa.check(qa.p(:'r2s',98106) @> '{"dia_sugerido":"2026-11-30"}' and qa.p(:'r2s',98106)->'motivo' ?& array['vencido','sem_capacidade','feedback_ignorado']
 and (qa.p(:'r2s',98106)->>'score')::numeric>=100 and (:'r2s'::jsonb->'pedidos'->0->>'cd_pedido')='98106','B066-R2 vencido com sobrecarga e feedback negativo segue >= 100 no topo');
select qa.check(not exists(select from jsonb_array_elements(:'r2s'::jsonb->'pedidos') e where (e->>'score')::numeric>99
   and not (e->'motivo' ?| array['vencido','vence_hoje','atrasa'])),'B066-R2 pedido no prazo nunca passa de 99');
-- ---------- memoria do plano: desprogramar futuro apaga; limpeza de passado preserva ----------
set role authenticated;
select qa.check(rota_065_marcar_sem_saida('2026-12-02','strada',true,(rota_065_ler_semana('2026-11-30')->>'versao')::bigint)->>'status'='ok','066 marcar sem saida devolve M');
reset role;
select qa.check(not exists(select from rota_066_historico where cd_pedido=98113 and fonte='plano'),'066 desprogramar futuro sai da memoria');
create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select '2026-12-02'::date$$;
delete from rota_plano_semana where dia<'2026-12-02';
select qa.check((select count(*)=2 from rota_066_historico where fonte='plano' and cd_pedido in(98108,98109)),'066 limpeza de dia passado preserva a memoria');
create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select '2026-11-29'::date$$;

-- ---------- rollback ----------
create temporary table dados066 as select (select jsonb_agg(to_jsonb(h) order by cd_pedido,fonte) from rota_066_historico h) hist,
 (select jsonb_agg(to_jsonb(f) order by id) from rota_066_feedback f) fb;
\ir ../../admin/migracoes/066_rollback.sql
\ir ../../admin/migracoes/066_rollback.sql
select qa.check(to_regprocedure('public.rota_066_sugestoes(date)') is null and to_regprocedure('public.rota_066_registrar(bigint,text,date)') is null
 and not exists(select from pg_trigger where tgname in('rota_066_hist_foto','rota_066_hist_plano')),'066 rollback remove RPCs e gatilhos');
select qa.check((select hist=(select jsonb_agg(to_jsonb(h) order by cd_pedido,fonte) from rota_066_historico h) and fb=(select jsonb_agg(to_jsonb(f) order by id) from rota_066_feedback f) from dados066),'066 rollback preserva memoria e feedback');
select qa.check((select replace(pg_get_functiondef('public.rota_050_gravar_itens(date,jsonb,uuid)'::regprocedure),chr(13),'')=replace(gravar,chr(13),'') from corpo065),'066 rollback nao toca o fechamento');
\ir ../../admin/migracoes/066_rota_sugestoes.sql
select qa.check((select hist=(select jsonb_agg(to_jsonb(h) order by cd_pedido,fonte) from rota_066_historico h) from dados066),'066 reaplicar nao duplica a memoria');
select count(*) filter(where nome like '066%') testes_066,count(*) testes_total from qa.checks;
