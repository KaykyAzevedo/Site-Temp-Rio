\set ON_ERROR_STOP on
-- 068 D r2 sobre 070 (cf77910). Somente PG18 local isolado (127.0.0.1). Nenhuma conexao a ERP/producao.
do $$begin
  if current_database() !~ '^sentinela_separando_cpf_brasa068d' or inet_server_addr() is distinct from '127.0.0.1'::inet then
    raise exception 'somente fixture D r2 local';
  end if;
end$$;

\if :{?qa_base_pronta}
\else
  -- Base 050/052/054/055/056/059/061/063/065 a partir do repositorio cf77910
  \i :fixture065
  reset role; set search_path = public, pg_catalog; set timezone = 'America/Sao_Paulo';

  -- Colunas/funcoes adicionais exigidas por 044/045/068F2/068A/068C/068H/070
  create or replace function public.texto_seguro(p_valor text, p_tamanho_maximo integer default 200)
  returns boolean language sql immutable as $$
    select p_valor is null or (char_length(p_valor) <= p_tamanho_maximo and p_valor !~ '[<>]');
  $$;
  alter table public.solidcon_pedidos_erp
    add column if not exists dt_pedido timestamptz default now(),
    add column if not exists cliente_tipo text default 'cnpj',
    add column if not exists cliente_nome text,
    add column if not exists valor_centavos bigint,
    add column if not exists atualizado_em timestamptz default now(),
    add column if not exists dt_conferencia timestamptz;
  alter table public.rota_pedido_ignorado add column if not exists motivo text, add column if not exists atualizado_por uuid;
  alter table public.rota_pedido_veiculo add column if not exists atualizado_por uuid;

  create table qa.limpeza055_d(def text);
  insert into qa.limpeza055_d select pg_get_functiondef('public.rota_045_limpar()'::regprocedure);
  \i :base045
  select def from qa.limpeza055_d \gexec

  create table qa.limpeza044_d(def text);
  insert into qa.limpeza044_d select pg_get_functiondef('public.rota_044_limpar()'::regprocedure);
  \i :base044
  select def from qa.limpeza044_d \gexec
  \i :base044047

  -- Instala pilha real de producao cf77910: 068F2 + 068A + 068C + 068H r3 + 070
  \i :base068f
  \i :base068a
  \i :base068c
  \i :base068h
  \i :base070
\endif

-- Aplica 068 D r2 duas vezes (idempotencia)
\if :{?migracao068d}
  \i :migracao068d
  \i :migracao068d
\else
  \ir ../../admin/migracoes/068_d_historico_lote_dia.sql
  \ir ../../admin/migracoes/068_d_historico_lote_dia.sql
\endif

reset role; set search_path = public, pg_catalog; set timezone = 'America/Sao_Paulo';
set qa.role = 'authenticated'; set qa.uid = '22222222-2222-4222-8222-222222222222';

-- Storage API simulada nesta fixture: privilegios normais de tabela + RLS reais 052/D.
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

-- Relogio controlavel de QA sobre o relogio oficial do 070 (rota_070_agora) e 068/050 alinhados.
create table qa.relogio_d as
  select pg_get_functiondef('public.rota_070_agora()'::regprocedure) def070,
         pg_get_functiondef('public.rota_068_hoje()'::regprocedure) def068,
         pg_get_functiondef('public.rota_050_hoje()'::regprocedure) def050;
create or replace function public.rota_070_agora() returns timestamptz language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('qa.agora', true), ''), '2026-11-26T18:00:00-03')::timestamptz
$$;
create or replace function public.rota_068_hoje() returns date language sql stable set search_path = '' as $$
  select public.rota_070_hoje()
$$;
create or replace function public.rota_050_hoje() returns date language sql stable set search_path = '' as $$
  select public.rota_070_hoje()
$$;
set qa.agora = '2026-11-26T18:00:00-03';
update public.rota_070_politica set inicio = date '2026-11-25', ultimo_dia = date '2026-11-26', dias_recebidos = 1 where id = 1;

-- ===================== (1) Rotas semana atual sem apagar memoria 066 =====================
insert into public.rota_dia_fechada(data, estado) values ('2026-11-16', 'fechada'), ('2026-11-23', 'fechada'), ('2026-11-30', 'fechada') on conflict (data) do nothing;
create table qa.memoria_rotas_d as select count(*) n from public.rota_dia_fechada;
set role authenticated;
select qa.check(
  not exists (select 1 from public.rota_068_rotas_semana() where dia < '2026-11-23' or dia >= '2026-11-30')
  and exists (select 1 from public.rota_068_rotas_semana() where dia = '2026-11-23'),
  'd2 rotas le so semana atual pelo relogio 070'
);
reset role;
select qa.check(
  exists (select 1 from public.rota_dia_fechada where data = '2026-11-16')
  and (select n = (select count(*) from public.rota_dia_fechada) from qa.memoria_rotas_d),
  'd2 filtro rotas nao apaga memoria 066'
);

-- ===================== (2) Lote: validacao de caminho, upload RLS, registro, rename =====================
select qa.check(
  public.rota_068_lote_dia('lote/2026-02-29/dddddddd-0001-4001-8001-000000000001.jpg') is null
  and public.rota_068_lote_dia('../2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg') is null,
  'd2 rejeita data impossivel e traversal'
);
set role authenticated;
select qa.check(
  public.rota_068_lote_upload_valido('lote/2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg')
  and not public.rota_068_lote_upload_valido('lote/2026-11-27/dddddddd-0001-4001-8001-000000000001.jpg'),
  'd2 caminho lote e janela upload pelo relogio 070'
);
select qa.check(not public.rota_068_lote_upload_valido('lote/2026-11-22/dddddddd-0001-4001-8001-000000000008.jpg'), 'd2 antes inicio 23 upload bloqueado');
select qa.check(public.rota_068_lote_registrar('2026-11-22', array['lote/2026-11-22/dddddddd-0001-4001-8001-000000000008.jpg'])->>'motivo' = 'parametro_invalido', 'd2 antes inicio 23 registro bloqueado');
select qa.erro($c$insert into storage.objects(bucket_id, name) values ('canhotos', 'lote/2026-11-22/dddddddd-0001-4001-8001-000000000008.jpg')$c$, '42501', 'd2 antes inicio 23 RLS upload bloqueado');

insert into storage.objects(bucket_id, name, owner) values
  ('canhotos', 'lote/2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg', auth.uid()),
  ('canhotos', 'lote/2026-11-25/dddddddd-0001-4001-8001-000000000002.png', auth.uid()),
  ('canhotos', 'lote/2026-11-26/dddddddd-0001-4001-8001-000000000003.webp', auth.uid());

select qa.check(
  public.rota_068_lote_registrar('2026-11-25', array[
    'lote/2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg',
    'lote/2026-11-25/dddddddd-0001-4001-8001-000000000002.png'
  ]) @> '{"status":"ok","registrados":2,"total":2}',
  'd2 registra lote dois arquivos'
);
select qa.check(
  public.rota_068_lote_registrar('2026-11-25', array['lote/2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg']) @> '{"status":"ok","registrados":0,"repetido":true}',
  'd2 retry registro idempotente'
);
select qa.check((select count(*) = 2 and bool_and(enviado_por = auth.uid()) from public.rota_068_lote_listar('2026-11-25')), 'd2 lista por dia e autor real');
select qa.check(public.rota_068_lote_registrar('2026-11-25', array['lote/2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg', 'lote/2026-11-25/dddddddd-0001-4001-8001-000000000099.jpg'])->>'motivo' = 'arquivo_ausente', 'd2 falta parcial recusa lote');
select qa.check(public.rota_068_lote_registrar('2026-11-26', array['lote/2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg'])->>'motivo' = 'parametro_invalido', 'd2 nao troca dia do caminho');
select qa.check(public.rota_068_lote_registrar('2026-11-25', array['lote/2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg', 'lote/2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg'])->>'motivo' = 'parametro_invalido', 'd2 duplicata no lote recusada');
select qa.erro($c$insert into public.canhoto_lote_dia(caminho, dia, enviado_por) values ('lote/2026-11-25/dddddddd-0001-4001-8001-000000000099.jpg', '2026-11-25', auth.uid())$c$, '42501', 'd2 metadata sem escrita direta');

update storage.objects set name = '2026-11-25/123/dddddddd-0001-4001-8001-000000000001.jpg' where name = 'lote/2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg';
reset role;
select qa.check(exists (select 1 from storage.objects where name = 'lote/2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg'), 'd2 rename para pedido bloqueado');
select qa.check(not exists (select 1 from public.pedido_canhoto where caminho like 'lote/%'), 'd2 nenhum vinculo pedido ou cliente');

-- ===================== (3) Historico lendo estado canonico do 070 (sem duplicar virada) =====================
insert into public.pedido_entrega_rota(cd_pedido, data_entrega, cliente_tipo, cliente_nome, valor_centavos) values
  (684001, '2026-11-25', 'cnpj', 'D ontem', 1000),
  (684002, '2026-11-26', 'cnpj', 'D hoje', 2000),
  (684003, '2026-10-31', 'cnpj', 'D outubro', 3000),
  (684004, '2026-11-22', 'cnpj', 'D antes inicio', 4000),
  (684005, '2026-11-23', 'cnpj', 'D inicio segunda', 5000);
-- Marca 684002 como recebimento oficial do 070 em 26/11 (para testar politica 070 dias_recebidos=1 vs 0)
insert into public.rota_070_recebimento(cd_pedido, dia) values (684002, '2026-11-26');
-- 684006: entrega de 26/11 FORA de rota_070_recebimento (legado/manual -> 070 usa else 1)
insert into public.pedido_entrega_rota(cd_pedido, data_entrega, cliente_tipo, cliente_nome, valor_centavos) values
  (684006, '2026-11-26', 'cnpj', 'D legado hoje', 6000);

set role authenticated;
select public.rota_068_lote_registrar('2026-11-26', array['lote/2026-11-26/dddddddd-0001-4001-8001-000000000003.webp']);

set timezone = 'UTC';
select qa.check((select lote_fotos = 2 and status = 'entregue' from public.rota_068_historico('2026-11-01') where cd_pedido = 684001), 'd2 historico agrupa fotos no dia');
select qa.check(not exists (select 1 from public.rota_068_historico('2026-11-01') where cd_pedido in (684002, 684006)), 'd2 hoje nao vira historico antes meia noite SP (dias_recebidos=1)');
select qa.check(not exists (select 1 from public.rota_068_historico('2026-11-01') where dia = '2026-11-26'), 'd2 fotos de hoje nao entram no historico com dias_recebidos=1');
select qa.check(not exists (select 1 from public.rota_068_historico('2026-11-01') where cd_pedido = 684004) and exists (select 1 from public.rota_068_historico('2026-11-01') where cd_pedido = 684005), 'd2 inicio 23 inclusivo sem backfill 22');
set timezone = 'Asia/Tokyo';
select qa.check(not exists (select 1 from public.rota_068_historico('2026-11-01') where cd_pedido in (684002, 684003)), 'd2 timezone sessao e outro mes nao vazam');
select qa.erro($c$select * from public.rota_068_historico('2026-11-02')$c$, '22023', 'd2 mes exige primeiro dia');
set timezone = 'America/Sao_Paulo';

-- 3a) Politica 070 dias_recebidos = 0: 684002 (em rota_070_recebimento) ENTRA no historico no proprio dia 26/11 com foto do dia,
--     enquanto 684006 (fora de rota_070_recebimento -> historico_em = +1) CONTINUA fora! Prova leitura direta do 070.
reset role;
update public.rota_070_politica set dias_recebidos = 0 where id = 1;
set role authenticated;
select qa.check(
  (select lote_fotos = 1 and dia = '2026-11-26' from public.rota_068_historico('2026-11-01') where cd_pedido = 684002)
  and not exists (select 1 from public.rota_068_historico('2026-11-01') where cd_pedido = 684006),
  'd2 politica 070 dias_recebidos=0 reflete imediatamente sem duplicar regra'
);
reset role;
update public.rota_070_politica set dias_recebidos = 1 where id = 1;

-- 3b) Problema ativo no 070 (684001 de 25/11): estado_070='recebido' -> sai do historico; ao desfazer, volta ao historico!
set role authenticated;
select qa.check((public.rota_068_problema_marcar(684001, 'Cliente fechado QA', '68400100-0000-4000-8000-000000000001')->>'status') = 'ok', 'd2 marca problema em 684001');
select qa.check(
  (select estado_070 <> 'historico' from public.rota_070_estados_pedidos(array[684001::bigint]))
  and not exists (select 1 from public.rota_068_historico('2026-11-01') where cd_pedido = 684001),
  'd2 problema ativo sai do historico (segue estado_070)'
);
set qa.uid = '11111111-1111-4111-8111-111111111111';
select qa.check((public.rota_068_problema_desfazer(684001, '68400100-0000-4000-8000-000000000002')->>'status') = 'ok', 'd2 admin desfaz problema em 684001');
select qa.check(
  (select estado_070 = 'historico' from public.rota_070_estados_pedidos(array[684001::bigint]))
  and exists (select 1 from public.rota_068_historico('2026-11-01') where cd_pedido = 684001),
  'd2 desfazer problema devolve 684001 ao historico'
);

-- 3c) Reprogramacao ativa no 070/H: pedido sai do historico enquanto reprogramado; apos virada real 070 (27/11) + 00h (28/11) entra em 27/11!
reset role;
insert into public.solidcon_pedidos_erp(cd_pedido, documento, etapa, dt_pedido, dt_conferencia, cliente_tipo, cliente_nome, valor_centavos)
  values (684010, '11222333000181', 'conferido', '2026-11-26T10:00-03', '2026-11-26T11:00-03', 'cnpj', 'D virada 070', 9900);
insert into public.rota_pedido_veiculo(cd_pedido, veiculo) values (684010, 's10');
-- Atualiza prontidao 070 para antes da meia-noite de 27/11
update public.rota_070_prontidao set pronto_erp = true, pronto_desde = '2026-11-26T11:00-03', visto_em = '2026-11-26T11:00-03' where cd_pedido = 684010;
-- Reprogramacao ativa sobre 684005 (23/11): deve sumir do historico enquanto ativa
insert into public.rota_068h_reprogramacao(cd_pedido, ativa, dia, veiculo_id, por, criada_em)
  values (684005, true, '2026-11-27', 's10', '22222222-2222-4222-8222-222222222222', '2026-11-26T15:00-03');
set role authenticated; set qa.uid = '22222222-2222-4222-8222-222222222222';
select qa.check(not exists (select 1 from public.rota_068_historico('2026-11-01') where cd_pedido = 684005), 'd2 pedido reprogramado ativo nao aparece no historico');

-- Virada real 070 em 27/11 00:00:01 SP:
--   * 684002 e 684006 (de 26/11) passam automaticamente para historico!
--   * 684010 vira Recebido de 27/11 (fica 1 dia em Recebidos -> NAO entra no historico em 27/11)!
reset role;
set qa.agora = '2026-11-27T00:00:01-03';
select qa.check((public.rota_070_virada()->>'status') = 'ok', 'd2 virada real 070 em 27/11 executa ok');
set role authenticated;
select qa.check((select lote_fotos = 1 from public.rota_068_historico('2026-11-01') where cd_pedido = 684002), 'd2 apos meia noite SP 684002 entra no historico com foto');
select qa.check(exists (select 1 from public.rota_068_historico('2026-11-01') where cd_pedido = 684006), 'd2 apos meia noite SP 684006 legado entra no historico');
select qa.check(
  (select estado_070 = 'recebido' and historico_em = date '2026-11-28' from public.rota_070_estados_pedidos(array[684010::bigint]))
  and not exists (select 1 from public.rota_068_historico('2026-11-01') where cd_pedido = 684010),
  'd2 pedido virado pelo 070 em 27/11 fica 1 dia em Recebidos fora do historico'
);

-- Dia seguinte 28/11 00:00:01 SP: 684010 passa para estado_070='historico' e entra automaticamente em rota_068_historico!
reset role;
set qa.agora = '2026-11-28T00:00:01-03';
set role authenticated;
select qa.check(
  (select estado_070 = 'historico' from public.rota_070_estados_pedidos(array[684010::bigint]))
  and (select dia = date '2026-11-27' and data_entrega = date '2026-11-27' and status = 'entregue' from public.rota_068_historico('2026-11-01') where cd_pedido = 684010),
  'd2 em 28/11 684010 entra no historico lendo estado_070=historico'
);

-- Coerencia total: todo pedido retornado por rota_068_historico tem estado_070='historico' e entregue=true em rota_070_estados_pedidos!
select qa.check((
  select bool_and(s.estado_070 = 'historico' and s.entregue)
    from public.rota_070_estados_pedidos(array(select h.cd_pedido from public.rota_068_historico('2026-11-01') h where h.cd_pedido is not null)) s
), 'd2 coerencia 100% entre rota_068_historico e rota_070_estados_pedidos');

-- Dia com foto sem pedido conhecido tambem aparece no historico (cd/status/nome nulos)
insert into storage.objects(bucket_id, name, owner) values ('canhotos', 'lote/2026-11-24/dddddddd-0001-4001-8001-000000000004.jpg', auth.uid());
select public.rota_068_lote_registrar('2026-11-24', array['lote/2026-11-24/dddddddd-0001-4001-8001-000000000004.jpg']);
select qa.check(
  exists (select 1 from public.rota_068_historico('2026-11-01') where dia = '2026-11-24' and cd_pedido is null and status is null and cliente_nome is null and lote_fotos = 1),
  'd2 dia com foto aparece mesmo sem pedido conhecido'
);

-- ===================== (4) Permissoes e remocao =====================
select qa.erro($c$select public.rota_068_lote_remover('lote/2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg')$c$, '42501', 'd2 Marcio nao remove foto');
set qa.uid = '44444444-4444-4444-8444-444444444444';
select qa.check((select count(*) = 2 from public.rota_068_lote_listar('2026-11-25')), 'd2 vendedor le galeria');
select qa.erro($c$select public.rota_068_lote_registrar('2026-11-25', array['lote/2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg'])$c$, '42501', 'd2 vendedor nao registra');
select qa.erro($c$insert into storage.objects(bucket_id, name) values ('canhotos', 'lote/2026-11-25/dddddddd-0001-4001-8001-000000000007.jpg')$c$, '42501', 'd2 vendedor nao faz upload');
set qa.uid = '33333333-3333-4333-8333-333333333333';
select qa.erro($c$select * from public.rota_068_rotas_semana()$c$, '42501', 'd2 motorista sem leitura global rotas');
select qa.erro($c$select * from public.rota_068_lote_listar('2026-11-25')$c$, '42501', 'd2 motorista sem galeria global');
select qa.erro($c$select * from public.rota_068_historico('2026-11-01')$c$, '42501', 'd2 motorista sem historico');
select qa.check((select count(*) = 0 from public.canhoto_lote_dia), 'd2 motorista RLS metadata');
reset role; set role anon;
select qa.erro($c$select * from public.rota_068_historico('2026-11-01')$c$, '42501', 'd2 anon sem historico');
reset role; set qa.uid = '11111111-1111-4111-8111-111111111111'; set role authenticated;
select qa.check(public.rota_068_lote_remover('lote/2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg') @> '{"status":"ok","alterado":true,"pode_apagar":true}', 'd2 admin remove metadata logicamente');
select qa.check(public.rota_068_lote_remover('lote/2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg')->>'alterado' = 'false', 'd2 remover retry idempotente');
select qa.check((select count(*) = 1 from public.rota_068_lote_listar('2026-11-25')), 'd2 removido sai galeria');
select qa.check(public.rota_068_lote_registrar('2026-11-25', array['lote/2026-11-25/dddddddd-0001-4001-8001-000000000001.jpg'])->>'motivo' = 'arquivo_removido', 'd2 retry nao ressuscita removido');

-- ===================== (5) Retencao worker 052 + purga metadata D =====================
reset role;
update public.canhoto_lote_dia set enviado_em = now() - interval '2 years' where caminho like '%000000000002.png';
update storage.objects set created_at = now() - interval '2 years' where name like '%000000000002.png';
select public.rota_052_limpeza_lote(100) as expurgo_d \gset
select qa.check(:'expurgo_d'::jsonb->'caminhos' ? 'lote/2026-11-25/dddddddd-0001-4001-8001-000000000002.png', 'd2 worker existente inclui lote vencido');
select qa.erro(format('select public.rota_052_limpeza_confirmar(%L::uuid)', :'expurgo_d'::jsonb->>'token'), '40001', 'd2 falha API preserva metadata');
select qa.check(public.rota_068_lote_purgar() = 0, 'd2 purga nao remove metadata com arquivo fisico');
set role authenticated;
select qa.check(public.rota_068_lote_registrar('2026-11-25', array['lote/2026-11-25/dddddddd-0001-4001-8001-000000000002.png'])->>'motivo' = 'arquivo_em_expurgo', 'd2 registro bloqueado durante expurgo');
reset role;
delete from storage.objects where bucket_id = 'canhotos' and name in (select jsonb_array_elements_text(:'expurgo_d'::jsonb->'caminhos'));
select public.rota_052_limpeza_confirmar((:'expurgo_d'::jsonb->>'token')::uuid);
select qa.check(public.rota_068_lote_purgar() = 1, 'd2 metadata sai depois API');

-- ===================== (6) Rollback 2x + preservacao acervo + 070 intacto + reaplicar =====================
create table qa.acervo_d as select
  (select count(*) from public.canhoto_lote_dia) metadata,
  (select count(*) from storage.objects where name like 'lote/%') fotos;
\ir ../../admin/migracoes/068_d_rollback.sql
\ir ../../admin/migracoes/068_d_rollback.sql
select qa.check(
  to_regprocedure('public.rota_068_historico(date)') is null
  and to_regprocedure('public.rota_068_rotas_semana()') is null
  and to_regprocedure('public.rota_068_lote_registrar(date,text[])') is null
  and to_regprocedure('public.rota_068_lote_listar(date)') is null
  and to_regprocedure('public.rota_068_lote_remover(text)') is null
  and to_regprocedure('public.rota_068_lote_upload_valido(text)') is null,
  'd2 rollback desliga todas as RPCs D'
);
select qa.check(
  to_regprocedure('public.rota_070_estado(bigint)') is not null
  and to_regprocedure('public.rota_070_historico_em(bigint)') is not null
  and to_regprocedure('public.rota_070_virada()') is not null
  and to_regclass('public.rota_070_politica') is not null,
  'd2 rollback nao toca no 070'
);
select qa.check(
  (select metadata = (select count(*) from public.canhoto_lote_dia) and fotos = (select count(*) from storage.objects where name like 'lote/%') from qa.acervo_d),
  'd2 rollback preserva acervo'
);

\ir ../../admin/migracoes/068_d_historico_lote_dia.sql
set role authenticated;
select qa.check(exists (select 1 from public.rota_068_lote_listar('2026-11-24')), 'd2 reaplicar recupera galeria');
select qa.check(exists (select 1 from public.rota_068_historico('2026-11-01') where cd_pedido = 684010), 'd2 reaplicar mantem leitura do historico 070');
reset role;

select def070 from qa.relogio_d \gexec
select def068 from qa.relogio_d \gexec
select def050 from qa.relogio_d \gexec
select count(*) filter (where nome like 'd2 %') checks_068d_r2, count(*) checks_total from qa.checks;
