\set ON_ERROR_STOP on
-- PG local descartavel. O runner fornece fixture068 e base045 a partir do worktree somente leitura.
do $$begin if current_database() !~ '^sentinela_separando_cpf_forja068f' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somente fixture F2 local'; end if;end$$;
\if :{?qa_base_pronta}
\else
  \i :fixture068
  -- Corpo literal da 013: a fixture nao instala as tabelas de formularios daquela migracao.
  create or replace function public.texto_seguro(p_valor text, p_tamanho_maximo integer default 200)
  returns boolean language sql immutable as $$
    select p_valor is null or (char_length(p_valor) <= p_tamanho_maximo and p_valor !~ '[<>]');
  $$;
  -- A fixture anterior usa stub da 045: completa colunas antes de instalar a migracao real.
  alter table public.rota_pedido_ignorado add column motivo text, add column atualizado_por uuid;
  create table qa.limpeza055(def text);
  insert into qa.limpeza055 select pg_get_functiondef('public.rota_045_limpar()'::regprocedure);
  \i :base045
  select def from qa.limpeza055 \gexec
\endif
\if :{?qa_preparar}
\else
\if :{?migracao068}
  \i :migracao068
  \i :migracao068
\else
  \ir ../../admin/migracoes/068_f_fora_do_site.sql
  \ir ../../admin/migracoes/068_f_fora_do_site.sql
\endif

set qa.uid='11111111-1111-4111-8111-111111111111';set qa.papel='marcador';
select qa.check((select pg_get_functiondef('public.rota_045_limpar()'::regprocedure)=def from qa.limpeza055),'f2 preserva limpeza055');
select qa.check((select alcance='rota' from public.rota_pedido_ignorado where cd_pedido=6),'f2 legado continua rota');
select qa.check((qa.receber058(jsonb_build_array(qa.pedido058(68101,repeat('a',64)),qa.pedido058(68102,repeat('a',64))))->>'status')='ok','f2 coleta1 aceita dois pedidos');

set role authenticated;
select public.rota_068_tirar_do_site(68101,E'  Nao   vai\n sair  ') as primeira_tirada \gset
select qa.check(:'primeira_tirada'::jsonb->>'status'='ok','f2 marcador tira pedido');
select qa.check(:'primeira_tirada'::jsonb->>'repetido'='false','f2 primeira retirada nao repetida');
select qa.check((select alcance='site' and motivo='Nao vai sair' and atualizado_por=auth.uid() from public.rota_pedido_ignorado where cd_pedido=68101),'f2 normaliza motivo e autor');
select qa.check((select count(*)=1 from public.rota_068_site_log where cd_pedido=68101 and acao='tirou' and motivo='Nao vai sair' and por=auth.uid()),'f2 auditoria tirou');
select qa.check((public.rota_068_tirar_do_site(68101,'Nao vai sair')->>'repetido')::boolean,'f2 repeticao reconhecida');
select qa.check((select count(*)=1 from public.rota_068_site_log where cd_pedido=68101),'f2 repeticao nao duplica log');
select qa.check((public.rota_068_tirar_do_site(68101,'Cliente pediu adiamento')->>'status')='ok','f2 altera motivo');
select qa.check((select count(*)=1 from public.rota_068_site_log where cd_pedido=68101 and acao='motivo' and motivo='Cliente pediu adiamento'),'f2 auditoria motivo');
select qa.erro($c$insert into public.rota_pedido_ignorado(cd_pedido,motivo,alcance) values(68101,'bypass','rota') on conflict(cd_pedido) do update set alcance='rota'$c$,'42501','f2 guarda upsert direto');
select qa.erro($c$update public.rota_pedido_ignorado set motivo='bypass' where cd_pedido=68101$c$,'42501','f2 guarda update direto');
select qa.erro($c$delete from public.rota_pedido_ignorado where cd_pedido=68101$c$,'42501','f2 guarda delete direto');
select qa.erro($c$insert into public.rota_pedido_ignorado(cd_pedido,motivo,alcance) values(68102,'bypass','site')$c$,'42501','f2 guarda insert direto');
select qa.erro($c$insert into public.rota_068_site_log(cd_pedido,acao) values(68101,'voltou')$c$,'42501','f2 log sem escrita direta');
select qa.check((select bool_and(public.rota_068_tirar_do_site(68101,m)->>'motivo'='motivo_invalido') from unnest(array[null::text,'',E' \n ','<invalido>','x>y',repeat('a',121)]) m),'f2 motivos invalidos recusados');
select qa.check(public.rota_068_tirar_do_site(null,'ok')->>'motivo'='pedido_invalido' and public.rota_068_tirar_do_site(0,'ok')->>'motivo'='pedido_invalido' and public.rota_068_tirar_do_site(1000000000000,'ok')->>'motivo'='pedido_invalido','f2 ids invalidos');
select qa.check(public.rota_068_tirar_do_site(68999,'ok')->>'motivo'='pedido_nao_encontrado','f2 pedido inexistente');
select qa.check((public.rota_068_tirar_do_site(68101,repeat('a',120))->>'status')='ok','f2 limite120 aceito');
reset role;

-- Sync real 058: a 2a coleta remove; a 3a devolve sem remover o bloqueio manual.
select qa.check((qa.receber058('[]')->>'status')='ok','f2 coleta2 vazia aceita');
select qa.check(not exists(select 1 from public.solidcon_pedidos_erp where cd_pedido in(68101,68102)),'f2 pedido some da fonte na coleta2');
set role authenticated;
select qa.check((select not no_erp from public.rota_068_fora_do_site() where cd_pedido=68101),'f2 lista removido do ERP com registro');
reset role;
select qa.check((qa.receber058(jsonb_build_array(qa.pedido058(68101,repeat('a',64)),qa.pedido058(68102,repeat('a',64))))->>'status')='ok','f2 coleta3 reaparece');
select qa.check((select count(*)=2 from public.solidcon_pedidos_erp where cd_pedido in(68101,68102)),'f2 fonte volta na coleta3');
select qa.check((select alcance='site' from public.rota_pedido_ignorado where cd_pedido=68101),'f2 retirada sobrevive coleta');
select qa.check(not exists(select 1 from public.rota_pedido_ignorado where cd_pedido=68102),'f2 pedido comum volta visivel');
set role authenticated;
select qa.check((select no_erp from public.rota_068_fora_do_site() where cd_pedido=68101),'f2 lista reencontra fonte');
insert into public.rota_pedido_ignorado(cd_pedido,motivo) values(68102,'Apenas rota');
select qa.check((public.rota_068_voltar_ao_site(68102)->>'alterado')='false' and exists(select 1 from public.rota_pedido_ignorado where cd_pedido=68102),'f2 voltar nao desfaz exclusao so rota');

set qa.papel='vendedor';
select qa.check((select count(*)=1 from public.rota_068_fora_do_site()),'f2 vendedor le lista');
select qa.erro($c$select public.rota_068_tirar_do_site(68102,'sem permissao')$c$,'42501','f2 vendedor nao tira');
select qa.erro($c$select public.rota_068_voltar_ao_site(68101)$c$,'42501','f2 vendedor nao devolve');
select qa.erro($c$insert into public.rota_pedido_ignorado(cd_pedido,motivo) values(68103,'sem permissao')$c$,'42501','f2 vendedor sem insert RLS');
set qa.papel='motorista';
select qa.check((select count(*)=0 from public.rota_068_fora_do_site()) and (select count(*)=0 from public.rota_068_site_log),'f2 motorista sem leitura global');
select qa.erro($c$select public.rota_068_tirar_do_site(68102,'sem permissao')$c$,'42501','f2 motorista nao tira');
reset role;set role anon;
select qa.erro($c$select public.rota_068_tirar_do_site(68102,'sem permissao')$c$,'42501','f2 anon sem RPC tirar');
select qa.erro($c$select public.rota_068_voltar_ao_site(68101)$c$,'42501','f2 anon sem RPC voltar');
select qa.erro($c$select * from public.rota_068_fora_do_site()$c$,'42501','f2 anon sem RPC lista');
select qa.erro($c$select * from public.rota_068_site_log$c$,'42501','f2 anon sem log');
reset role;set role authenticated;set qa.papel='admin';
select qa.check((public.rota_068_voltar_ao_site(68101)->>'alterado')='true','f2 admin devolve');
select qa.check((public.rota_068_voltar_ao_site(68101)->>'alterado')='false','f2 voltar repetido');
select qa.check(not exists(select 1 from public.rota_pedido_ignorado where cd_pedido=68101),'f2 volta ao site e rota');
select qa.check((select count(*)=1 from public.rota_068_site_log where cd_pedido=68101 and acao='voltou' and por=auth.uid()),'f2 auditoria voltou');
select public.rota_068_tirar_do_site(68101,'Expirar fora da fonte');
reset role;
-- Envelhecimento exclusivo da fixture: gatilho045 carimba now() no UPDATE normal.
alter table public.rota_pedido_ignorado disable trigger rota_045_ignorado_normalizar;
update public.rota_pedido_ignorado set atualizado_em=now()-interval '31 days' where cd_pedido=68101;
alter table public.rota_pedido_ignorado enable trigger rota_045_ignorado_normalizar;
select qa.receber058('[]');
set qa.uid='';
select public.rota_045_limpar();
select qa.check(not exists(select 1 from public.rota_pedido_ignorado where cd_pedido=68101),'f2 limpeza remove linha vencida');
select qa.check((select count(*)=1 from public.rota_068_site_log where cd_pedido=68101 and acao='limpeza' and por is null and motivo='Expirar fora da fonte'),'f2 auditoria limpeza');

-- Rollback 2x preserva a 045 e suas linhas; reaplicar retoma operacao sem perda da fonte.
set qa.uid='11111111-1111-4111-8111-111111111111';set qa.papel='marcador';
select qa.receber058(jsonb_build_array(qa.pedido058(68101,repeat('a',64))));
select public.rota_068_tirar_do_site(68101,'Preservar exclusao rota');
\ir ../../admin/migracoes/068_f_rollback.sql
\ir ../../admin/migracoes/068_f_rollback.sql
select qa.check(to_regclass('public.rota_068_site_log') is null and to_regprocedure('public.rota_068_tirar_do_site(bigint,text)') is null and to_regprocedure('public.rota_068_voltar_ao_site(bigint)') is null and to_regprocedure('public.rota_068_fora_do_site()') is null,'f2 rollback remove objetos');
select qa.check(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='rota_pedido_ignorado' and column_name='alcance'),'f2 rollback remove alcance');
select qa.check((select motivo='Preservar exclusao rota' from public.rota_pedido_ignorado where cd_pedido=68101) and exists(select 1 from public.rota_pedido_ignorado where cd_pedido=68102),'f2 rollback conserva linhas045');
select qa.check((select pg_get_functiondef('public.rota_045_limpar()'::regprocedure)=def from qa.limpeza055),'f2 rollback preserva limpeza055');
\ir ../../admin/migracoes/068_f_fora_do_site.sql
select qa.check((select alcance='rota' from public.rota_pedido_ignorado where cd_pedido=68101),'f2 reaplicar mantém exclusao rota');
set role authenticated;
select qa.check((public.rota_068_tirar_do_site(68101,'Reaplicada')->>'status')='ok','f2 reaplicacao funcional');
reset role;
select count(*) as checks_f2 from qa.checks where nome like 'f2%';
\endif
