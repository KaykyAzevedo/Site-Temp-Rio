\set ON_ERROR_STOP on
-- 068 B Prazo flexivel ("prazo ideal"). Herda fixture completa 066 (guard localhost/DB sentinela_separando_*, 050..066 reais).
\if :{?fixture066}
\i :fixture066
\else
\ir rota-sugestoes-066.sql
\endif
reset role;set search_path=public,pg_catalog;set timezone='America/Sao_Paulo';

create temporary table corpo066 as select pg_get_functiondef('public.rota_066_sugestoes(date)'::regprocedure) sug;

\ir ../../admin/migracoes/068_b_prazo_flexivel.sql
\ir ../../admin/migracoes/068_b_prazo_flexivel.sql

-- ---------- grants minimos ----------
select qa.check(
  not has_function_privilege('anon','public.rota_068_prazo_salvar(bigint,text,integer,date,text,text,integer[])','execute')
  and not has_function_privilege('anon','public.rota_068_prazo_remover_regra(text,text)','execute')
  and not has_function_privilege('anon','public.rota_068_prazo_remover_excecao(bigint,text)','execute')
  and not has_function_privilege('anon','public.rota_068_prazo_ler(bigint[])','execute')
  and not has_function_privilege('anon','public.rota_068_regras_prazo()','execute')
  and not has_function_privilege('anon','public.rota_068_prazo_padrao_ler()','execute')
  and not has_function_privilege('anon','public.rota_068_prazo_padrao_salvar(integer,integer[])','execute')
  and not has_function_privilege('anon','public.rota_068_calendario_veiculo(text,date,date)','execute')
  and not has_function_privilege('authenticated','public.rota_068_prazo_calcular(bigint,timestamptz,text,text)','execute')
  and not has_function_privilege('authenticated','public.rota_068_somar_dias_uteis(timestamptz,text,integer)','execute')
  and not has_function_privilege('authenticated','public.rota_068_proximo_dia_semana(timestamptz,text,smallint[])','execute')
  and not has_function_privilege('authenticated','public.rota_068_prazo_limpar()','execute')
  and not has_function_privilege('authenticated','public.rota_068_prazo_travado(bigint)','execute')
  and not has_function_privilege('authenticated','public.rota_068_prazo_padrao_dias()','execute')
  and not has_function_privilege('authenticated','public.rota_068_prazo_dias_uteis_semana()','execute')
  and not has_function_privilege('authenticated','public.rota_068_eh_dia_util_prazo(date)','execute')
  and not has_table_privilege('anon','public.rota_068_prazo_cliente','select')
  and not has_table_privilege('anon','public.rota_068_prazo_pedido','select')
  and not has_table_privilege('anon','public.rota_068_prazo_log','select')
  and not has_table_privilege('authenticated','public.rota_068_prazo_cliente','insert')
  and not has_table_privilege('authenticated','public.rota_068_prazo_cliente','update')
  and not has_table_privilege('authenticated','public.rota_068_prazo_cliente','delete')
  and not has_table_privilege('authenticated','public.rota_068_prazo_pedido','insert')
  and not has_table_privilege('authenticated','public.rota_068_prazo_pedido','update')
  and not has_table_privilege('authenticated','public.rota_068_prazo_pedido','delete')
  and not has_table_privilege('authenticated','public.rota_068_prazo_log','insert')
  and has_table_privilege('service_role','public.rota_068_prazo_cliente','select')
  and has_table_privilege('service_role','public.rota_068_prazo_pedido','select')
  and not has_table_privilege('service_role','public.rota_068_prazo_cliente','insert')
  and not has_table_privilege('service_role','public.rota_068_prazo_cliente','update')
  and not has_table_privilege('service_role','public.rota_068_prazo_cliente','delete')
  and not has_table_privilege('service_role','public.rota_068_prazo_pedido','insert')
  and not has_table_privilege('service_role','public.rota_068_prazo_pedido','update')
  and not has_table_privilege('service_role','public.rota_068_prazo_pedido','delete')
  and not has_table_privilege('service_role','public.rota_068_prazo_log','select'),
  '068B grants minimos (anon=0, authenticated=SELECT, service_role=SELECT tabelas de prazo sem DML/log)');

-- ---------- permissoes ----------
set role authenticated;
-- motorista (3333): nao e equipe, nao marca rota
set qa.uid='33333333-3333-4333-8333-333333333333';
select qa.erro($c$select rota_068_prazo_ler(array[98101::bigint])$c$,'42501','068B motorista nao le prazos');
select qa.erro($c$select rota_068_regras_prazo()$c$,'42501','068B motorista nao le regras');
select qa.erro($c$select rota_068_prazo_salvar(98101,'dias_uteis',3,null,'pedido','teste',null)$c$,'42501','068B motorista nao salva prazo');
select qa.erro($c$select rota_068_prazo_remover_regra('66000000000001')$c$,'42501','068B motorista nao remove regra');
-- vendedor (4444): eh_equipe=true, pode_marcar_rota=false
set qa.uid='44444444-4444-4444-8444-444444444444';
select qa.check((select count(*)=1 and bool_and(origem='padrao' and prazo_ideal='2026-12-01' and tipo='dias_uteis' and dias=2 and atraso_dias=0 and excecao is null)
  from rota_068_prazo_ler(array[98101::bigint])),'068B vendedor le prazo padrao (2 dias uteis S10)');
select qa.check((select count(*)=0 from rota_068_prazo_ler(array[]::bigint[])),'068B ler array vazio devolve 0 linhas');
select qa.check((select count(*)=0 from rota_068_regras_prazo()),'068B vendedor le regras vazias');
select qa.erro($c$select rota_068_prazo_salvar(98101,'dias_uteis',3,null,'pedido','teste',null)$c$,'42501','068B vendedor nao salva prazo');
select qa.erro($c$select rota_068_prazo_remover_regra('66000000000001')$c$,'42501','068B vendedor nao remove regra');
select qa.erro($c$select rota_068_prazo_remover_excecao(98101)$c$,'42501','068B vendedor nao remove excecao');
-- DML direto bloqueado mesmo para Marcio (pode_marcar_rota=true)
set qa.uid='22222222-2222-4222-8222-222222222222';
select qa.erro($c$insert into rota_068_prazo_pedido(cd_pedido,tipo,dias,motivo) values(98101,'dias_uteis',3,'direto')$c$,'42501','068B DML direto em pedido bloqueado');
select qa.erro($c$insert into rota_068_prazo_cliente(documento,tipo,dias,motivo) values('66000000000001','dias_uteis',3,'direto')$c$,'42501','068B DML direto em cliente bloqueado');

-- ---------- validacoes ----------
select qa.check(rota_068_prazo_salvar(98101,'dias_uteis',3,null,'pedido','   ',null)->>'motivo'='motivo_invalido','068B motivo vazio recusado');
select qa.check(rota_068_prazo_salvar(98101,'dias_uteis',3,null,'pedido','<b>xss</b>',null)->>'motivo'='motivo_invalido','068B motivo com <> recusado');
select qa.check(rota_068_prazo_salvar(98101,'dias_uteis',3,null,'pedido',repeat('a',201),null)->>'motivo'='motivo_invalido','068B motivo >200 recusado');
select qa.check(rota_068_prazo_salvar(99999999,'dias_uteis',3,null,'pedido','ok',null)->>'motivo'='pedido_nao_encontrado','068B pedido inexistente recusado');
select qa.check(rota_068_prazo_salvar(98101,'dias_uteis',-1,null,'pedido','ok',null)->>'motivo'='parametro_invalido','068B dias <0 recusado');
select qa.check(rota_068_prazo_salvar(98101,'dias_uteis',366,null,'pedido','ok',null)->>'motivo'='parametro_invalido','068B dias >365 recusado');
select qa.check(rota_068_prazo_salvar(98101,'data',null,'2026-12-05','cliente','ok',null)->>'motivo'='parametro_invalido','068B data fixa nao vale como regra de cliente');
select qa.check(rota_068_prazo_salvar(98101,'dias_uteis',2,null,'cliente','ok',array[0,2])->>'motivo'='dia_sem_saida','068B domingo recusado em dias_semana');
select qa.check(rota_068_prazo_salvar(98101,'semana',null,null,'pedido','ok',array[2])->>'motivo'='parametro_invalido','068B semana nao vale como excecao de pedido');
select qa.check(rota_068_prazo_salvar(98101,'data',2,'2026-12-05','pedido','ok',null)->>'motivo'='parametro_invalido','068B data com dias preenchido recusado');

-- pedido sem documento (CPF): aceita excecao por pedido, recusa regra de cliente
reset role;
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_pedido) values(98601,null,'conferido','2026-11-27T10:00-03');
set role authenticated;set qa.uid='22222222-2222-4222-8222-222222222222';
select qa.check(rota_068_prazo_salvar(98601,'dias_uteis',4,null,'cliente','regra',null)->>'motivo'='cliente_sem_documento','068B pedido sem documento recusa escopo cliente');
select qa.check(rota_068_prazo_salvar(98601,'data',null,'2026-12-04','pedido','Cliente pediu sexta',null) @> '{"status":"ok","prazo_ideal":"2026-12-04","origem":"pedido"}','068B pedido sem documento aceita excecao data');

-- ---------- dias uteis, sabado/domingo, feriados, corte_hora ----------
-- 98101: dt=sex 27/11 10:00, S10 (seg..sex). Padrao 2du = ter 01/12.
-- 98102: dt=qui 03/12 10:00, caminhao (seg..sab). Padrao 2du = sab 05/12.
-- +0 dias uteis: 98101 (sex 27/11) -> sex 27/11; 98107 (dom 29/11) -> seg 30/11.
select qa.check(rota_068_prazo_salvar(98101,'dias_uteis',0,null,'pedido','Urgente mesmo dia',null) @> '{"status":"ok","prazo_ideal":"2026-11-27","origem":"pedido"}','068B +0 dias uteis em dia util = proprio dia');
select qa.check(rota_068_prazo_salvar(98107,'dias_uteis',0,null,'pedido','Urgente domingo',null) @> '{"status":"ok","prazo_ideal":"2026-11-30","origem":"pedido"}','068B +0 dias uteis no domingo = segunda');
-- 98101 com +0du -> prazo 27/11; hoje = 29/11 -> atraso_dias = 2
select qa.check((select prazo_ideal='2026-11-27' and origem='pedido' and atraso_dias=2 and tipo='dias_uteis' and dias=0 and data is null
  and motivo='Urgente mesmo dia' and por is not null and em is not null and excecao->>'tipo'='dias_uteis' and (excecao->>'dias')::int=0
  from rota_068_prazo_ler(array[98101::bigint])),'068B ler retorna atraso_dias e objeto excecao completos');

-- Feriado extra na segunda 30/11: 98101 (+2du S10 a partir de sex 27/11) pula sab/dom/seg -> ter (1) + qua (2) = 02/12!
reset role;
update rota_config set feriados_sem_saida=true, feriados_extras=array['2026-11-30'::date] where id=1;
set role authenticated;set qa.uid='22222222-2222-4222-8222-222222222222';
select qa.check(rota_068_prazo_remover_excecao(98101,'Volta padrao') @> '{"status":"ok","alterado":true,"prazo_ideal":"2026-12-02","origem":"padrao"}','068B feriado extra empurra +2du para quarta 02/12');
-- Feriado nacional fixo (25/12 natal) e movel (Pascoa 2026 = 05/04 -> Sexta Santa = 03/04)
reset role;
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_pedido) values
 (98602,qa.doc(1),'conferido','2026-04-01T10:00-03'),   -- qua 01/04: qui 02 (1), sex 03 FERIADO, sab/dom off, seg 06 (2)
 (98603,qa.doc(2),'conferido','2026-12-23T10:00-03');   -- qua 23/12: qui 24 (1), sex 25 NATAL, sab 26 caminhao (2) / seg 28 S10 (2)
insert into rota_pedido_veiculo(cd_pedido,veiculo) values(98602,'s10'),(98603,'caminhao');
set role authenticated;set qa.uid='22222222-2222-4222-8222-222222222222';
select qa.check((select prazo_ideal='2026-04-06' from rota_068_prazo_ler(array[98602::bigint])),'068B feriado movel (Sexta Santa) pulado');
-- Com padrao seg..sex (independente de caminhao rodar sabado): qua 23/12 + 2du pula Natal 25/12 e sab/dom -> seg 28/12!
select qa.check((select prazo_ideal='2026-12-28' from rota_068_prazo_ler(array[98603::bigint])),'068B Natal pulado e padrao seg-sex independe do veiculo');
-- Desligando feriados_sem_saida: 98602 conta Sexta Santa (03/04)
reset role;
update rota_config set feriados_sem_saida=false, feriados_extras=null where id=1;
set role authenticated;
select qa.check((select prazo_ideal='2026-04-03' from rota_068_prazo_ler(array[98602::bigint])),'068B feriados_sem_saida=false conta feriado');
-- corte_hora=14: pedido as 15h conta do dia seguinte
reset role;
update rota_config set feriados_sem_saida=true, corte_hora=14 where id=1;
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_pedido) values(98604,qa.doc(1),'conferido','2026-11-30T15:00-03');
insert into rota_pedido_veiculo(cd_pedido,veiculo) values(98604,'s10');
set role authenticated;
-- seg 30/11 15:00 (>=14h) -> base ter 01/12 -> +2du = qua(1), qui(2) = 03/12
select qa.check((select prazo_ideal='2026-12-03' from rota_068_prazo_ler(array[98604::bigint])),'068B corte_hora empurra base para o dia seguinte');
reset role;
update rota_config set corte_hora=null where id=1;

-- ---------- regra do cliente (dias_uteis e semana) x excecao do pedido ----------
set role authenticated;set qa.uid='22222222-2222-4222-8222-222222222222';
-- Regra cliente doc(1): sempre 5 dias uteis (Vitral chama com p_tipo='dias_uteis', p_regra_dias_semana=null)
select qa.check(rota_068_prazo_salvar(98101,'dias_uteis',5,null,'cliente','Cliente recebe com 5 dias',null)
  @> '{"status":"ok","prazo_ideal":"2026-12-04","origem":"cliente"}','068B regra cliente 5 dias uteis (sex 27/11 -> sex 04/12)');
-- Outro pedido do MESMO cliente (98116, dt=sex 27/11 11:00) herda a regra automaticamente!
select qa.check((select prazo_ideal='2026-12-04' and origem='cliente' and tipo='dias_uteis' and dias=5 and excecao is null
  from rota_068_prazo_ler(array[98116::bigint])),'068B novo pedido do cliente herda regra do cliente');
-- Excecao pontual no 98101 (data agendada 2026-12-09) vence a regra do cliente, sem alterar 98116
select qa.check(rota_068_prazo_salvar(98101,'data',null,'2026-12-09','pedido','Cliente pediu dia 09/12',null)
  @> '{"status":"ok","prazo_ideal":"2026-12-09","origem":"pedido"}','068B excecao por data agendada vence regra do cliente');
select qa.check((select prazo_ideal='2026-12-09' and origem='pedido' and tipo='data' and data='2026-12-09' and dias is null
  and excecao->>'data'='2026-12-09' from rota_068_prazo_ler(array[98101::bigint])),'068B ler 98101 mostra excecao de data');
select qa.check((select prazo_ideal='2026-12-04' and origem='cliente' from rota_068_prazo_ler(array[98116::bigint])),'068B 98116 mantem regra do cliente intacta');

-- Regra cliente por DIAS DA SEMANA (formato exato que Vitral envia: p_tipo='dias_uteis', p_dias=2, p_regra_dias_semana=array[4,2])
-- doc(1) agora: sempre terca (2) e quinta (4). Salvar regra do cliente pelo 98101 tambem limpa excecao pontual do 98101!
select qa.check(rota_068_prazo_salvar(98101,'dias_uteis',2,null,'cliente','So recebe terca e quinta',array[4,2])
  @> '{"status":"ok","prazo_ideal":"2026-12-01","origem":"cliente"}','068B regra cliente semana [4,2] (sex 27/11 -> ter 01/12)');
select qa.check((select tipo='semana' and dias is null and dias_semana=array[2,4]::smallint[] and motivo='So recebe terca e quinta'
  from rota_068_regras_prazo() where documento=qa.doc(1)),'068B regras_prazo devolve dias_semana ordenado e normalizado');
select qa.check((select origem='cliente' and tipo='semana' and dias is null and dias_semana=array[2,4]::smallint[] and excecao is null
  from rota_068_prazo_ler(array[98101::bigint])),'068B salvar regra do cliente limpa excecao pontual daquele pedido');

-- Regra cliente semana [6] (sabado) em pedido S10: fallback nao devolve null!
select qa.check(rota_068_prazo_salvar(98106,'semana',null,null,'cliente','So sabado',array[6])
  @> '{"status":"ok","prazo_ideal":"2026-11-21","origem":"cliente"}','068B regra sabado em S10 resolve sabado sem devolver nulo');

-- ---------- B068-R1: calendario semanal esparso (+120 e +365) + recusa atomica de prazo indisponivel ----------
reset role;
begin;
-- Calendario de dias uteis do prazo com apenas 1 dia/semana (so sabado = {6}), sem feriados:
-- 2026-11-23 + 120 sabados = 2029-03-10; + 365 sabados = 2033-11-19.
update rota_config set feriados_sem_saida=false, feriados_extras=null, corte_hora=null, prazo_dias_uteis_semana='{6}' where id=1;
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_pedido) values
 (98691,qa.doc(1),'conferido','2026-11-23T10:00-03'),
 (98692,qa.doc(2),'conferido',null);
insert into rota_pedido_veiculo(cd_pedido,veiculo) values(98691,'s10'),(98692,'s10');
set local role authenticated;set local qa.uid='22222222-2222-4222-8222-222222222222';
select qa.check(rota_068_prazo_salvar(98691,'dias_uteis',120,null,'pedido','Esparso 120 sabados',null)
  @> '{"status":"ok","prazo_ideal":"2029-03-10","origem":"pedido"}','068B B068-R1 so sabado +120 resolve 2029-03-10');
select qa.check((rota_068_prazo_salvar(98691,'dias_uteis',365,null,'pedido','Esparso 365 sabados',null)->>'prazo_ideal')='2033-11-19',
  '068B B068-R1 so sabado +365 resolve 2033-11-19');
-- Pedido sem dt_pedido em regra relativa: prazo_indisponivel atomico (sem gravar tabela nem log)
select qa.check(rota_068_prazo_salvar(98692,'dias_uteis',5,null,'pedido','Sem dt_pedido',null)
  @> '{"status":"erro","motivo":"prazo_indisponivel"}','068B B068-R1 prazo nao calculavel recusa prazo_indisponivel');
select qa.check(not exists(select 1 from rota_068_prazo_pedido where cd_pedido=98692)
  and not exists(select 1 from rota_068_prazo_log where cd_pedido=98692),
  '068B B068-R1 recusa prazo_indisponivel nao persiste regra nem log');
reset role;
rollback;
set role authenticated;set qa.uid='22222222-2222-4222-8222-222222222222';

-- ---------- Regra FINAL do dono (26/11): SOMENTE HISTORICO (helper H / data SP < hoje) trava; Recebidos HOJE, vencido, dia passado sem sair e problema ativo LIBERADOS; mini calendario multi-semana + dias uteis seg..dom configuraveis ----------
reset role;
begin;
-- Hoje na fixture = dom 2026-11-29.
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_pedido,dt_saida) values
 (98693,qa.doc(3),'conferido','2026-11-24T10:00-03',null),
 (98694,qa.doc(4),'atendido','2026-11-26T10:00-03','2026-11-27T09:00-03'),
 (986941,qa.doc(4),'atendido','2026-11-28T10:00-03','2026-11-29T09:00-03'),
 (98696,qa.doc(6),'atendido','2026-11-26T10:00-03','2026-11-27T09:00-03'),
 (986961,qa.doc(6),'atendido','2026-11-28T10:00-03','2026-11-29T09:00-03');
insert into rota_pedido_veiculo(cd_pedido,veiculo) values(98693,'s10'),(98694,'s10'),(986941,'s10'),(98696,'s10'),(986961,'s10');
insert into rota_plano_semana(cd_pedido,dia,veiculo_id,ordem) values(98693,'2026-11-27','s10',1);
insert into pedido_entrega_confirmacao(cd_pedido,requisicao,confirmado_por,confirmado_nome,confirmado_em) values
 (98694,gen_random_uuid(),'22222222-2222-4222-8222-222222222222','Marcio','2026-11-28T18:00-03'),
 (986941,gen_random_uuid(),'22222222-2222-4222-8222-222222222222','Marcio','2026-11-29T10:00-03');
insert into pedido_canhoto(cd_pedido,caminho,enviado_por,enviado_em) values
 (98696,'2026-11-28/98696/11111111-1111-4111-8111-111111111111.jpg','22222222-2222-4222-8222-222222222222','2026-11-28T17:00-03'),
 (986961,'2026-11-29/986961/22222222-2222-4222-8222-222222222222.jpg','22222222-2222-4222-8222-222222222222','2026-11-29T11:00-03');
set local role authenticated;set local qa.uid='22222222-2222-4222-8222-222222222222';

-- 1) Qualquer data futura (outras semanas/meses) aceita; domingo / sabado (fora seg-sex) / feriado / passado recusados!
select qa.check(rota_068_prazo_salvar(98106,'data',null,'2026-12-16','pedido','Agendado 2 semanas frente',null)
  @> '{"status":"ok","prazo_ideal":"2026-12-16","origem":"pedido"}','068B dono: vencido aceita data em semana futura');
select qa.check(rota_068_prazo_salvar(98106,'data',null,'2027-01-15','pedido','Agendado mes seguinte',null)
  @> '{"status":"ok","prazo_ideal":"2027-01-15","origem":"pedido"}','068B dono: aceita data em mes seguinte');
select qa.check(rota_068_prazo_salvar(98106,'data',null,'2026-12-06','pedido','Domingo',null)
  @> '{"status":"erro","motivo":"dia_sem_saida"}','068B dono: domingo recusado quando fora de dias uteis');
select qa.check(rota_068_prazo_salvar(98106,'data',null,'2026-12-05','pedido','Sabado fora seg-sex',null)
  @> '{"status":"erro","motivo":"dia_sem_saida"}','068B dono: sabado recusado com padrao seg-sex');
select qa.check(rota_068_prazo_salvar(98106,'data',null,'2026-12-25','pedido','Natal feriado',null)
  @> '{"status":"erro","motivo":"dia_sem_saida"}','068B dono: feriado recusado em data agendada');
select qa.check(rota_068_prazo_salvar(98106,'data',null,'2026-11-28','pedido','Ontem',null)
  @> '{"status":"erro","motivo":"parametro_invalido"}','068B dono: data passada < hoje recusada');

-- 2) Preso em dia passado no plano sem sair: editavel + entra em 066
select qa.check(rota_068_prazo_salvar(98693,'data',null,'2026-12-04','pedido','Nao saiu sexta, remarcado',null)
  @> '{"status":"ok","prazo_ideal":"2026-12-04","origem":"pedido"}','068B dono: dia passado sem sair aceita alterar prazo');
select qa.check(qa.p(rota_066_sugestoes('2026-11-30'),98693) @> '{"prazo":"2026-12-04"}'
  and (qa.p(rota_066_sugestoes('2026-11-30'),98693)->>'dia_sugerido') between '2026-11-30' and '2026-12-04',
  '068B dono: dia passado sem sair entra em sugestoes 066 com novo prazo');

-- 3) RECEBIDOS DE HOJE (confirmacao 063 de hoje e canhoto de hoje): LIBERADOS (travado=false)!
select qa.check((select bool_and(not travado and veiculo_efetivo='s10') from rota_068_prazo_ler(array[986941::bigint,986961::bigint])),
  '068B dono: recebidos de HOJE tem travado=false em prazo_ler');
select qa.check(rota_068_prazo_salvar(986941,'data',null,'2026-12-04','pedido','Ajuste recebido hoje 063',null)
  @> '{"status":"ok","prazo_ideal":"2026-12-04"}','068B dono: recebido HOJE (confirmacao 063) liberado');
select qa.check(rota_068_prazo_salvar(986961,'data',null,'2026-12-04','pedido','Ajuste recebido hoje canhoto',null)
  @> '{"status":"ok","prazo_ideal":"2026-12-04"}','068B dono: recebido HOJE (canhoto) liberado');

-- 4) HISTORICO (< hoje SP: confirmacao 063 ontem e canhoto ontem): TRAVADOS com pedido_historico!
select qa.check((select bool_and(travado) from rota_068_prazo_ler(array[98694::bigint,98696::bigint])),
  '068B dono: historico (< hoje SP) tem travado=true em prazo_ler');
select qa.check(rota_068_prazo_salvar(98694,'data',null,'2026-12-04','pedido','Tentativa historico 063',null)
  @> '{"status":"erro","motivo":"pedido_historico"}','068B dono: historico confirmacao 063 travado');
select qa.check(rota_068_prazo_salvar(98696,'data',null,'2026-12-04','pedido','Tentativa historico canhoto',null)
  @> '{"status":"erro","motivo":"pedido_historico"}','068B dono: historico canhoto travado');
select qa.check(rota_068_prazo_remover_excecao(98694,'Tentativa remover')
  @> '{"status":"erro","motivo":"pedido_historico"}','068B dono: remover excecao em historico travado');
select qa.check(not exists(select 1 from rota_068_prazo_pedido where cd_pedido in(98694,98696))
  and not exists(select 1 from rota_068_prazo_log where cd_pedido in(98694,98696)),
  '068B dono: recusa pedido_historico nao grava pedido nem log');

-- 5) Com helper canonico do pacote H (public.rota_068_pedido_entregue(bigint)): delega diretamente a ele!
reset role;
create or replace function public.rota_068_pedido_entregue(p_cd bigint) returns boolean language sql stable set search_path='' as $$
  select p_cd = 98694;   -- simula H: 98694 entregue no historico; 98696 reprogramado (R3) -> false!
$$;
set local role authenticated;set local qa.uid='22222222-2222-4222-8222-222222222222';
select qa.check(rota_068_prazo_salvar(98694,'data',null,'2026-12-04','pedido','Bloqueado via helper H',null)
  @> '{"status":"erro","motivo":"pedido_historico"}','068B delegacao helper H: entregue=true trava');
select qa.check(rota_068_prazo_salvar(98696,'data',null,'2026-12-04','pedido','Reprogramado via helper H',null)
  @> '{"status":"ok","prazo_ideal":"2026-12-04"}','068B delegacao helper H: reprogramado R3 (false) libera');

-- 6) Mini calendario (rota_068_calendario_veiculo) devolve ambos: prazo_dias_uteis_semana E dias_sem_saida/avulsos do veiculo
select qa.check(
  rota_068_calendario_veiculo('s10','2026-12-01','2026-12-31') @> '{"status":"ok","veiculo_id":"s10","feriados_sem_saida":true,"prazo_dias_uteis_semana":[1,2,3,4,5]}'
  and (rota_068_calendario_veiculo('s10','2026-12-01','2026-12-31')->'feriados') ? '2026-12-25'
  and (rota_068_calendario_veiculo('s10','2026-12-01','2026-12-31')->'sem_saida_avulso') ? '2026-12-03'
  and jsonb_array_length(rota_068_calendario_veiculo('s10','2026-12-01','2026-12-31')->'dias_prazo') = 31
  and exists(select 1 from jsonb_array_elements(rota_068_calendario_veiculo('s10','2026-12-01','2026-12-31')->'dias_prazo') x where x->>'dia'='2026-12-25' and (x->>'habilitado')::boolean=false and x->>'motivo'='feriado')
  and exists(select 1 from jsonb_array_elements(rota_068_calendario_veiculo('s10','2026-12-01','2026-12-31')->'dias_prazo') x where x->>'dia'='2026-12-06' and (x->>'habilitado')::boolean=false and x->>'motivo'='domingo')
  and exists(select 1 from jsonb_array_elements(rota_068_calendario_veiculo('s10','2026-12-01','2026-12-31')->'dias_prazo') x where x->>'dia'='2026-12-07' and (x->>'habilitado')::boolean=true and x->>'motivo' is null),
  '068B calendario_veiculo devolve prazo_dias_uteis_semana, dias_sem_saida, feriados, avulsos e dias_prazo');

-- 7) Prazo ideal PADRAO + DIAS UTEIS DA SEMANA configuraveis (rota_068_prazo_padrao_salvar/ler)
set local qa.uid='44444444-4444-4444-8444-444444444444';
select qa.check((rota_068_prazo_padrao_ler()->>'prazo_ideal_dias')::int=2
  and rota_068_prazo_padrao_ler()->'prazo_dias_uteis_semana'='[1,2,3,4,5]'::jsonb,'068B padrao inicial = 2du, seg..sex');
select qa.erro($c$select rota_068_prazo_padrao_salvar(4,array[1,2,3,4,5,6])$c$,'42501','068B vendedor nao altera prazo padrao');
set local qa.uid='22222222-2222-4222-8222-222222222222';
select qa.check(rota_068_prazo_padrao_salvar(2,array[]::integer[])->>'motivo'='parametro_invalido','068B dias uteis vazio recusado');
select qa.check(rota_068_prazo_padrao_salvar(2,array[1,2,3,4,5,6]) @> '{"status":"ok","prazo_ideal_dias":2,"prazo_dias_uteis_semana":[1,2,3,4,5,6]}',
  '068B Marcio habilita sabado como dia util do prazo');
-- Agora sabado 2026-12-26 conta (qua 23/12 + 2du pula Natal 25/12 -> sab 26/12) E sabado 2026-12-05 passa a ser aceito em data agendada!
select qa.check((select prazo_ideal='2026-12-26' from rota_068_prazo_ler(array[98603::bigint])),'068B com sabado habilitado, 98603 vence sabado 26/12');
select qa.check(rota_068_prazo_salvar(98106,'data',null,'2026-12-05','pedido','Sabado agora e dia util',null)
  @> '{"status":"ok","prazo_ideal":"2026-12-05"}','068B mini calendario aceita sabado quando habilitado');
-- Altera para 4 dias uteis seg..sex: 98105 (dt=ter 01/12) -> qua(1), qui(2), sex(3), seg 07/12(4) em prazo_ler e 066!
select qa.check(rota_068_prazo_padrao_salvar(4,array[1,2,3,4,5]) @> '{"status":"ok","prazo_ideal_dias":4,"prazo_dias_uteis_semana":[1,2,3,4,5]}',
  '068B Marcio altera prazo padrao para 4du seg..sex');
select qa.check((select prazo_ideal='2026-12-07' and origem='padrao' and dias=4 and prazo_padrao_dias=4 from rota_068_prazo_ler(array[98105::bigint])),
  '068B prazo_ler usa padrao configurado (4du)');
select qa.check(qa.p(rota_066_sugestoes('2026-11-30'),98105) @> '{"prazo":"2026-12-07"}',
  '068B sugestoes 066 usa padrao configurado (4du)');
select qa.check(exists(select 1 from rota_068_prazo_log where escopo='padrao' and acao='salvar' and dias=4 and dias_semana=array[1,2,3,4,5]::smallint[] and por is not null),
  '068B alteracao do padrao e dias uteis gravada no log de auditoria');

-- 8) B068-R4-A: precedencia estrita de fontes de recebimento (C > 063 > canhoto; NAO OR de prova antiga) + problema ativo
reset role;
drop function if exists public.rota_068_pedido_entregue(bigint);
create table if not exists public.pedido_entrega_rota(
  cd_pedido bigint primary key,
  data_entrega date not null,
  cliente_tipo text not null default 'cnpj',
  cliente_nome text,
  documento text,
  valor_centavos bigint
);
create table if not exists public.pedido_entrega_problema(
  id bigint generated always as identity primary key,
  cd_pedido bigint not null,
  obs text not null,
  por uuid not null,
  por_nome text,
  em timestamptz not null default now(),
  desfeito_por uuid,
  desfeito_nome text,
  desfeito_em timestamptz
);
-- 98792: snapshot C HOJE (2026-11-29) + confirmacao 063 ONTEM (2026-11-28) -> C vence => travado=false (repro R4-A)
-- 98793: snapshot C ONTEM (2026-11-28) + confirmacao 063 HOJE (2026-11-29) -> C vence => travado=true
-- 98794: sem C, confirmacao 063 HOJE + canhoto ONTEM -> 063 vence => travado=false
-- 98795: snapshot C ONTEM + problema ativo -> problema libera => travado=false
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_pedido) values
 (98792,qa.doc(1),'conferido','2026-11-29T10:00-03'),
 (98793,qa.doc(1),'conferido','2026-11-27T10:00-03'),
 (98794,qa.doc(1),'conferido','2026-11-27T10:00-03'),
 (98795,qa.doc(1),'conferido','2026-11-27T10:00-03');
insert into rota_pedido_veiculo(cd_pedido,veiculo) values(98792,'s10'),(98793,'s10'),(98794,'s10'),(98795,'s10');
insert into pedido_entrega_confirmacao(cd_pedido,requisicao,confirmado_por,confirmado_nome,confirmado_em) values
 (98792,gen_random_uuid(),'22222222-2222-4222-8222-222222222222','Marcio','2026-11-28T12:00-03'),
 (98793,gen_random_uuid(),'22222222-2222-4222-8222-222222222222','Marcio','2026-11-29T12:00-03'),
 (98794,gen_random_uuid(),'22222222-2222-4222-8222-222222222222','Marcio','2026-11-29T12:00-03');
insert into pedido_canhoto(cd_pedido,caminho,enviado_por,enviado_em) values
 (98794,'2026-11-28/98794/33333333-3333-4333-8333-333333333333.jpg','22222222-2222-4222-8222-222222222222','2026-11-28T16:00-03');
insert into pedido_entrega_rota(cd_pedido,data_entrega,cliente_tipo,cliente_nome,documento,valor_centavos) values
 (98792,'2026-11-29','cnpj','QA precedencia C hoje',qa.doc(1),1000),
 (98793,'2026-11-28','cnpj','QA precedencia C ontem',qa.doc(1),1000),
 (98795,'2026-11-28','cnpj','QA problema ativo',qa.doc(1),1000);
insert into pedido_entrega_problema(cd_pedido,obs,por,por_nome) values
 (98795,'Loja fechada','22222222-2222-4222-8222-222222222222','Marcio');
set local role authenticated;set local qa.uid='22222222-2222-4222-8222-222222222222';
select qa.check((select not travado from rota_068_prazo_ler(array[98792::bigint]))
  and rota_068_prazo_salvar(98792,'data',null,'2026-12-09','pedido','C hoje vence 063 ontem',null) @> '{"status":"ok","prazo_ideal":"2026-12-09"}',
  '068B R4-A: snapshot C HOJE vence confirmacao 063 ONTEM (travado=false)');
select qa.check((select travado from rota_068_prazo_ler(array[98793::bigint]))
  and rota_068_prazo_salvar(98793,'data',null,'2026-12-09','pedido','C ontem vence 063 hoje',null) @> '{"status":"erro","motivo":"pedido_historico"}',
  '068B R4-A: snapshot C ONTEM vence confirmacao 063 HOJE (travado=true)');
select qa.check((select not travado from rota_068_prazo_ler(array[98794::bigint]))
  and rota_068_prazo_salvar(98794,'data',null,'2026-12-09','pedido','063 hoje vence canhoto ontem',null) @> '{"status":"ok","prazo_ideal":"2026-12-09"}',
  '068B R4-A: confirmacao 063 HOJE vence canhoto ONTEM (travado=false)');
select qa.check((select not travado from rota_068_prazo_ler(array[98795::bigint]))
  and rota_068_prazo_salvar(98795,'data',null,'2026-12-09','pedido','Problema ativo libera',null) @> '{"status":"ok","prazo_ideal":"2026-12-09"}',
  '068B R4-A: problema ativo em pedido_entrega_problema libera edicao');

-- 8b) Alinhamento CH r3 no fallback sem 070/H: ERP legado (< 2026-11-23 ou < canhoto_desde) trava; atendido pos-corte sem prova NAO trava!
reset role;
insert into solidcon_pedidos_erp(cd_pedido,documento,etapa,dt_pedido,dt_saida) values
  (98796,qa.doc(1),'atendido','2026-11-18T10:00-03','2026-11-20T10:00-03'),
  (98797,qa.doc(1),'atendido','2026-11-25T10:00-03','2026-11-26T16:00-03');
insert into rota_pedido_veiculo(cd_pedido,veiculo) values(98796,'s10'),(98797,'s10');
set local role authenticated;set local qa.uid='22222222-2222-4222-8222-222222222222';
select qa.check((select travado from rota_068_prazo_ler(array[98796::bigint]))
  and rota_068_prazo_salvar(98796,'data',null,'2026-12-09','pedido','Tentativa legado ERP',null) @> '{"status":"erro","motivo":"pedido_historico"}',
  '068B CH r3 fallback: ERP legado anterior a 23/11 trava (pedido_historico)');
select qa.check((select not travado from rota_068_prazo_ler(array[98797::bigint]))
  and rota_068_prazo_salvar(98797,'data',null,'2026-12-09','pedido','Atendido pos-corte sem prova',null) @> '{"status":"ok","prazo_ideal":"2026-12-09"}',
  '068B CH r3 fallback: atendido pos-corte sem prova continua editavel');

-- 9) B068-R4-B: protecao de auditoria/autoria em rota_config contra DML direto da 040 (UPDATE/INSERT/UPSERT), preservando 040
reset role;
create temporary table r4b_cont(n bigint);
insert into r4b_cont select count(*) from rota_068_prazo_log where escopo='padrao';
grant select on r4b_cont to authenticated;
set local role authenticated;set local qa.uid='11111111-1111-4111-8111-111111111111';
-- 9a) UPDATE direto de admin tentando forjar nome/data ao mudar prazo_ideal_dias -> autor real + now() + 1 log atomico
update rota_config set prazo_ideal_dias=7, prazo_ideal_atualizado_por_nome='Outra pessoa', prazo_ideal_atualizado_em=null where id=1;
select qa.check((select prazo_ideal_dias=7 and prazo_ideal_atualizado_por='11111111-1111-4111-8111-111111111111'
  and prazo_ideal_atualizado_por_nome is distinct from 'Outra pessoa' and prazo_ideal_atualizado_em is not null from rota_config where id=1),
  '068B R4-B: UPDATE direto de admin sobrescreve autor real e data');
select qa.check((select count(*) from rota_068_prazo_log where escopo='padrao')=(select n+1 from r4b_cont)
  and exists(select 1 from rota_068_prazo_log where escopo='padrao' and dias=7 and por='11111111-1111-4111-8111-111111111111' and por_nome is distinct from 'Outra pessoa'),
  '068B R4-B: UPDATE direto gera exatamente 1 log atomico com autor real');
-- 9b) UPDATE direto tentando forjar so metadados (sem mudar valores) -> metadados preservados e 0 novos logs
update rota_config set prazo_ideal_atualizado_por_nome='Forjado', prazo_ideal_atualizado_em=null, prazo_ideal_atualizado_por='99999999-9999-4999-8999-999999999999' where id=1;
select qa.check((select prazo_ideal_atualizado_por='11111111-1111-4111-8111-111111111111'
  and prazo_ideal_atualizado_por_nome is distinct from 'Forjado' and prazo_ideal_atualizado_em is not null from rota_config where id=1)
  and (select count(*) from rota_068_prazo_log where escopo='padrao')=(select n+1 from r4b_cont),
  '068B R4-B: tentativa de forjar metadados sem mudar valores e bloqueada');
-- 9c) Caminho legado 040 (UPDATE de corte_hora) continua funcionando, preserva metadados e gera 0 logs de prazo
update rota_config set corte_hora=15 where id=1;
select qa.check((select corte_hora=15 and prazo_ideal_dias=7 and prazo_ideal_atualizado_por='11111111-1111-4111-8111-111111111111' from rota_config where id=1)
  and (select count(*) from rota_068_prazo_log where escopo='padrao')=(select n+1 from r4b_cont),
  '068B R4-B: UPDATE legado 040 preservado sem gerar log espurio');
-- 9d) UPSERT (INSERT ... ON CONFLICT DO UPDATE) mudando prazo_dias_uteis_semana desordenado/duplicado -> normaliza + 1 log (nao 2!)
insert into rota_config(id,prazo_ideal_dias,prazo_dias_uteis_semana,prazo_ideal_atualizado_por_nome)
 values(1,7,array[5,1,5]::smallint[],'Falso')
 on conflict(id) do update set prazo_dias_uteis_semana=excluded.prazo_dias_uteis_semana, prazo_ideal_atualizado_por_nome=excluded.prazo_ideal_atualizado_por_nome;
select qa.check((select prazo_dias_uteis_semana=array[1,5]::smallint[] and prazo_ideal_atualizado_por='11111111-1111-4111-8111-111111111111'
  and prazo_ideal_atualizado_por_nome is distinct from 'Falso' from rota_config where id=1)
  and (select count(*) from rota_068_prazo_log where escopo='padrao')=(select n+2 from r4b_cont),
  '068B R4-B: UPSERT normaliza dias_uteis e gera exatamente 1 log atomico');
-- 9e) INSERT direto (linha ausente): default com metadado forjado zera metadados (0 logs); valor alterado carimba autor real (+1 log)
reset role;
delete from rota_config where id=1;
set local role authenticated;set local qa.uid='11111111-1111-4111-8111-111111111111';
insert into rota_config(id,prazo_ideal_atualizado_por_nome,prazo_ideal_atualizado_em) values(1,'Falso',now());
select qa.check((select prazo_ideal_dias=2 and prazo_ideal_atualizado_por_nome is null and prazo_ideal_atualizado_em is null from rota_config where id=1)
  and (select count(*) from rota_068_prazo_log where escopo='padrao')=(select n+2 from r4b_cont),
  '068B R4-B: INSERT direto com defaults zera metadados forjados');
reset role;
delete from rota_config where id=1;
set local role authenticated;set local qa.uid='11111111-1111-4111-8111-111111111111';
insert into rota_config(id,prazo_ideal_dias,prazo_ideal_atualizado_por_nome) values(1,6,'Falso');
select qa.check((select prazo_ideal_dias=6 and prazo_ideal_atualizado_por='11111111-1111-4111-8111-111111111111'
  and prazo_ideal_atualizado_por_nome is distinct from 'Falso' and prazo_ideal_atualizado_em is not null from rota_config where id=1)
  and (select count(*) from rota_068_prazo_log where escopo='padrao')=(select n+3 from r4b_cont),
  '068B R4-B: INSERT direto com valor alterado carimba autor real e gera 1 log');
reset role;
rollback;
set role authenticated;set qa.uid='22222222-2222-4222-8222-222222222222';

-- ---------- integracao com rota_066_sugestoes ----------
-- Antes: 98114 (doc 14, dt=sex 27/11, programado sex 04/12) atrasava no plano (prazo padrao = ter 01/12).
-- Agora: salvamos excecao data 2026-12-04 no 98114 -> deixa de atrasar no plano e sai das sugestoes!
select qa.check(rota_068_prazo_salvar(98114,'data',null,'2026-12-04','pedido','Agendado sexta com cliente',null)->>'status'='ok','068B salva prazo 04/12 para 98114');
-- E no 98101 (doc 1): colocamos excecao data 2026-12-04 -> sugestao 066 passa a mostrar prazo 2026-12-04 e atrasado_se_dia 2026-12-05!
select qa.check(rota_068_prazo_salvar(98101,'data',null,'2026-12-04','pedido','Cliente pediu sexta',null)->>'status'='ok','068B salva prazo 04/12 para 98101');
select rota_066_sugestoes('2026-11-30') s068b \gset
select qa.check(qa.p(:'s068b',98114) is null,'068B integracao 066: 98114 com prazo estendido deixa de atrasar no plano');
select qa.check(qa.p(:'s068b',98101) @> '{"prazo":"2026-12-04","atrasado_se_dia":"2026-12-05","dia_sugerido":"2026-12-04"}','068B integracao 066: 98101 usa prazo flexivel na sugestao');

-- ---------- remover regra + auditoria ----------
select qa.check(rota_068_prazo_remover_regra(qa.doc(1)) @> '{"status":"ok","alterado":true}','068B remover regra existente = alterado true');
select qa.check(rota_068_prazo_remover_regra(qa.doc(1)) @> '{"status":"ok","alterado":false}','068B remover regra inexistente = alterado false');
select qa.check((select origem='padrao' and prazo_ideal='2026-12-01' and dias=2 from rota_068_prazo_ler(array[98116::bigint])),'068B apos remover regra, 98116 volta ao padrao 2du');
-- 98101 ainda tem excecao pontual (preservada ao remover regra do cliente)
select qa.check((select origem='pedido' and prazo_ideal='2026-12-04' from rota_068_prazo_ler(array[98101::bigint])),'068B remover regra do cliente preserva excecao do pedido');

-- B068-R8-1: service_role (Edge Function whatsapp-rotinas) le excecoes e regras sem DML e sem acessar log
reset role;
begin;
set local role service_role;
select qa.check((select count(*) >= 1 and exists(select 1 from rota_068_prazo_pedido where cd_pedido=98101 and tipo='data' and data_agendada='2026-12-04') from rota_068_prazo_pedido)
  and (select count(*) >= 1 from rota_068_prazo_cliente),'068B R8-1: service_role le rota_068_prazo_pedido e rota_068_prazo_cliente');
select qa.erro($c$select count(*) from rota_068_prazo_log$c$,'42501','068B R8-1: service_role nao le rota_068_prazo_log');
select qa.erro($c$insert into rota_068_prazo_pedido(cd_pedido,tipo,dias,motivo) values(98101,'dias_uteis',3,'edge')$c$,'42501','068B R8-1: service_role sem DML em prazo_pedido');
reset role;
commit;

reset role;
select qa.check((select count(*)>=8 and count(*) filter(where acao='salvar')>=6 and count(*) filter(where acao='remover')>=2
  and bool_and(por is not null and em is not null and motivo is not null) from rota_068_prazo_log),'068B auditoria completa no log');

-- ---------- rollback duplo + preservacao de dados + reaplicacao ----------
create temporary table dados068b as select
  (select jsonb_agg(to_jsonb(c) order by documento) from rota_068_prazo_cliente c) cli,
  (select jsonb_agg(to_jsonb(p) order by cd_pedido) from rota_068_prazo_pedido p) ped,
  (select jsonb_agg(to_jsonb(l) order by id) from rota_068_prazo_log l) lg;

\ir ../../admin/migracoes/068_b_rollback.sql
\ir ../../admin/migracoes/068_b_rollback.sql

select qa.check(
  to_regprocedure('public.rota_068_prazo_salvar(bigint,text,integer,date,text,text,integer[])') is null
  and to_regprocedure('public.rota_068_prazo_remover_regra(text,text)') is null
  and to_regprocedure('public.rota_068_prazo_ler(bigint[])') is null
  and to_regprocedure('public.rota_068_regras_prazo()') is null
  and to_regprocedure('public.rota_068_prazo_travado(bigint)') is null
  and to_regprocedure('public.rota_068_prazo_padrao_ler()') is null
  and to_regprocedure('public.rota_068_prazo_padrao_salvar(integer,integer[])') is null
  and to_regprocedure('public.rota_068_calendario_veiculo(text,date,date)') is null
  and to_regprocedure('public.rota_068_prazo_dias_uteis_semana()') is null
  and to_regprocedure('public.rota_068_eh_dia_util_prazo(date)') is null
  and to_regprocedure('public.rota_068_config_prazo_guardar()') is null
  and to_regprocedure('public.rota_068_config_prazo_logar()') is null
  and to_regprocedure('public.rota_068_prazo_hoje()') is null
  and not exists(select 1 from pg_trigger where tgrelid='public.rota_config'::regclass and tgname in('rota_068_config_prazo_guardar','rota_068_config_prazo_logar')),
  '068B rollback remove todas as RPCs e triggers');
select qa.check((select replace(pg_get_functiondef('public.rota_066_sugestoes(date)'::regprocedure),chr(13),'')=replace(sug,chr(13),'') from corpo066),
  '068B rollback restaura rota_066_sugestoes da 066 byte a byte');
select qa.check((select
  cli=(select jsonb_agg(to_jsonb(c) order by documento) from rota_068_prazo_cliente c)
  and ped=(select jsonb_agg(to_jsonb(p) order by cd_pedido) from rota_068_prazo_pedido p)
  and lg=(select jsonb_agg(to_jsonb(l) order by id) from rota_068_prazo_log l)
  from dados068b),'068B rollback preserva todos os dados');

\ir ../../admin/migracoes/068_b_prazo_flexivel.sql
set role authenticated;set qa.uid='22222222-2222-4222-8222-222222222222';
select qa.check((select prazo_ideal='2026-12-04' and origem='pedido' from rota_068_prazo_ler(array[98101::bigint])),'068B reaplicar retoma dados preservados');
reset role;
select qa.check((select count(*)=2 from pg_trigger where tgrelid='public.rota_config'::regclass and tgname in('rota_068_config_prazo_guardar','rota_068_config_prazo_logar')),
  '068B reaplicar recria triggers de auditoria em rota_config');
select count(*) filter(where nome like '068B%') testes_068b, count(*) testes_total from qa.checks;
