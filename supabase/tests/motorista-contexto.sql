\set ON_ERROR_STOP on
-- SOMENTE banco descartavel local; nunca usar contra o projeto.
do $$begin
  if current_database() !~ '^sentinela_mot2_' or inet_server_addr() is distinct from '127.0.0.1'::inet then
    raise exception 'Use banco local descartavel sentinela_mot2_* em 127.0.0.1';
  end if;
end$$;
set timezone='America/Sao_Paulo';
do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end$$;
create schema qa;
create table qa.checks(nome text primary key);
create function qa.check(ok boolean,nome text) returns void language plpgsql security definer as $$
begin if ok is distinct from true then raise exception 'FAIL: %',nome; end if; insert into qa.checks values(nome); end$$;
create function qa.erro(comando text,codigo text,nome text) returns void language plpgsql as $$
declare recebido text;
begin
  begin execute comando; exception when others then get stacked diagnostics recebido=returned_sqlstate; end;
  perform qa.check(recebido=codigo,nome);
end$$;
grant usage on schema qa to authenticated,anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('qa.uid',true),'')::uuid$$;
create function public.eh_equipe() returns boolean language sql stable as $$select coalesce(current_setting('qa.papel',true),'') in ('admin','marcador','vendedor')$$;
create function public.eh_admin() returns boolean language sql stable as $$select coalesce(current_setting('qa.papel',true),'')='admin'$$;
create function public.pode_marcar_rota() returns boolean language sql stable as $$select coalesce(current_setting('qa.papel',true),'') in ('admin','marcador')$$;
create table public.rota_veiculos(id text primary key);
create table public.rota_motoristas(user_id uuid primary key,veiculo_id text references public.rota_veiculos(id),ativo boolean);
alter table public.rota_motoristas enable row level security;
grant select on public.rota_motoristas to authenticated;
create policy proprio_vinculo on public.rota_motoristas for select to authenticated using(user_id=auth.uid() or eh_equipe());
create function public.rota_047_veiculo_motorista() returns text language sql stable as $$
select veiculo_id from public.rota_motoristas where user_id=auth.uid() and ativo$$;
create table public.rota_saida(data date,veiculo_id text references public.rota_veiculos(id),versao integer,
  paradas jsonb,resumo jsonb,primary key(data,veiculo_id));
alter table public.rota_saida enable row level security;
grant select on public.rota_saida to authenticated;
create policy leitura_rota on public.rota_saida for select to authenticated using (
  eh_equipe() or (veiculo_id=rota_047_veiculo_motorista() and data between current_date and current_date+1));
create table public.solidcon_pedidos_erp(cd_pedido bigint primary key,caixas_24 integer,caixas_48 integer,caixas_outras integer);
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,created_at timestamptz not null default now(),unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to authenticated;
grant select,insert,update,delete on storage.objects to authenticated;
insert into public.rota_veiculos values('s10'),('strada'),('caminhao');
insert into public.rota_motoristas values
 ('11111111-1111-4111-8111-111111111111','s10',true),
 ('22222222-2222-4222-8222-222222222222','strada',true),
 ('33333333-3333-4333-8333-333333333333','s10',false),
 ('44444444-4444-4444-8444-444444444444','caminhao',true);
insert into public.rota_saida values
 (current_date,'s10',1,'[{"ordem":1,"pedidos":[11]},{"ordem":2,"pedidos":[22]}]','{}'),
 (current_date,'strada',1,'[{"ordem":3,"pedidos":[33]}]','{}');
insert into public.solidcon_pedidos_erp values(11,1,0,0),(22,1,0,0),(33,1,0,0);
-- Layout anterior da 051: a atualizacao deve preservar sem inferir versao.
create table public.rota_saida_progresso (
 data date not null,veiculo_id text not null references public.rota_veiculos(id),ordem integer not null,
 feito_em timestamptz not null,feito_por uuid,registrado_em timestamptz not null default now(),
 primary key(data,veiculo_id,ordem));
insert into public.rota_saida_progresso values(current_date,'s10',2,now(),null,now());
\if :{?migration051}
\else
\set migration051 ../../admin/migracoes/051_motorista_progresso.sql
\endif
\if :{?migration052}
\else
\set migration052 ../../admin/migracoes/052_canhotos.sql
\endif
\ir :migration051
\ir :migration052
select qa.check(to_regprocedure('public.rota_051_marcar(date,text,integer,integer,boolean,timestamptz)') is not null,'assinatura com contexto');
select qa.check(to_regprocedure('public.rota_051_marcar(date,integer,boolean,timestamptz)') is null,'assinatura implicita removida');
select qa.check((select versao=0 from public.rota_saida_progresso),'legado preservado em zero');
select qa.check(not has_function_privilege('anon','public.rota_051_marcar(date,text,integer,integer,boolean,timestamptz)','execute'),'anon nao marca');
select qa.check(not has_function_privilege('anon','public.rota_051_validar_contexto(date,text,integer)','execute'),'anon nao valida');
set role authenticated;
set qa.uid='11111111-1111-4111-8111-111111111111';
set qa.papel='motorista';
select qa.check(rota_051_marcar(current_date,'s10',1,1,true,now()),'marca propria versao');
select qa.check(rota_051_marcar(current_date,'s10',1,1,true,now()),'reenvio mesma marcacao');
select qa.check((select count(*)=1 from rota_saida_progresso),'legado nao aparece');
select qa.erro($c$select rota_051_marcar(current_date-1,'s10',1,1,false,now())$c$,'P5101','dia antigo distinto');
select qa.erro($c$select rota_051_marcar(current_date+1,'s10',1,1,true,now())$c$,'22023','dia futuro recusado');
select qa.erro($c$select rota_051_marcar(current_date,'strada',1,3,true,now())$c$,'P5102','outro veiculo recusado');
select qa.erro($c$select rota_051_marcar(current_date,'s10',null,1,true,now())$c$,'P5104','versao ausente recusada');
select qa.erro($c$select rota_051_marcar(current_date,'s10',1,99,true,now())$c$,'P0002','parada ausente recusada');
select qa.erro($c$insert into rota_saida_progresso(data,veiculo_id,versao,ordem,feito_em) values(current_date,'s10',1,2,now())$c$,'42501','escrita direta recusada');
reset role;
select qa.check((select count(*)=2 from rota_saida_progresso),'recusas nao apagam progresso');
update rota_saida set versao=2,paradas='[{"ordem":1,"pedidos":[22]},{"ordem":2,"pedidos":[11]}]' where veiculo_id='s10';
set role authenticated;
select qa.check((select count(*)=0 from rota_saida_progresso),'republicacao nao reaproveita feito');
select qa.erro($c$select rota_051_marcar(current_date,'s10',1,1,true,now())$c$,'P5103','replay versao antiga recusado');
select qa.erro($c$select rota_051_marcar(current_date,'s10',1,1,false,now())$c$,'P5103','desfazer antigo recusado');
select qa.check(rota_051_marcar(current_date,'s10',2,1,true,now()),'nova versao independente');
select qa.check((select count(*)=1 from rota_saida_progresso),'leitura apenas versao atual');
set qa.papel='marcador';
select qa.check((select count(*)=1 from rota_saida_progresso),'painel nao conta versao antiga');
reset role;
select qa.check((select count(*)=3 from rota_saida_progresso),'historico de versoes preservado');
update rota_motoristas set veiculo_id='strada' where user_id='11111111-1111-4111-8111-111111111111';
set role authenticated;
set qa.papel='motorista';
select qa.erro($c$select rota_051_marcar(current_date,'s10',2,1,true,now())$c$,'P5102','troca de vinculo nao reatribui');
reset role;
update rota_motoristas set veiculo_id='s10' where user_id='11111111-1111-4111-8111-111111111111';
set role authenticated;
set qa.uid='33333333-3333-4333-8333-333333333333';
select qa.erro($c$select rota_051_marcar(current_date,'s10',2,1,true,now())$c$,'42501','motorista inativo recusado');
set qa.uid='11111111-1111-4111-8111-111111111111';
insert into storage.objects(bucket_id,name,owner) values('canhotos',current_date::text||'/11/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',auth.uid());
select qa.check(rota_052_registrar(current_date::text||'/11/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',array[11,22]::bigint[],false,'s10',2)=2,'foto com contexto');
select qa.check(rota_052_registrar(current_date::text||'/11/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',array[11,22]::bigint[],false,'s10',2)=0,'foto replay idempotente');
select qa.erro($c$select rota_052_registrar(current_date::text||'/11/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',array[11]::bigint[],false,'s10',1)$c$,'P5103','foto versao antiga recusada');
select qa.erro($c$select rota_052_registrar((current_date-1)::text||'/11/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',array[11]::bigint[],false,'s10',1)$c$,'P5101','foto dia antigo distinto');
select qa.erro($c$select rota_052_registrar(current_date::text||'/11/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',array[11]::bigint[],false)$c$,'P5104','motorista sem contexto recusado');
select qa.erro($c$select rota_052_registrar(current_date::text||'/11/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',array[11,33]::bigint[],false,'s10',2)$c$,'42501','foto outro veiculo recusada');
select qa.erro($c$select rota_052_remover(11,current_date::text||'/11/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg')$c$,'42501','motorista nao remove foto');
reset role;
select qa.check((select count(*)=2 from pedido_canhoto),'recusas nao apagam foto');
-- Parada no limite legal da 047: 300 itens x50 +50 pedidos na raiz.
insert into solidcon_pedidos_erp select x,1,0,0 from generate_series(100001,115050)x;
insert into rota_saida values(current_date,'caminhao',1,
 jsonb_build_array(jsonb_build_object('ordem',1,'nome','CD','cd',true,
 'pedidos',(select jsonb_agg(x) from generate_series(115001,115050)x),
 'itens',(select jsonb_agg(it) from (select jsonb_build_object('nome','Cliente','pedidos',jsonb_agg(x)) it from generate_series(100001,115000)x group by (x-100001)/50) g))),'{}');
set role authenticated;
set qa.uid='44444444-4444-4444-8444-444444444444';
insert into storage.objects(bucket_id,name,owner) values
 ('canhotos',current_date::text||'/100001/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg',auth.uid()),
 ('canhotos',current_date::text||'/100001/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg',auth.uid());
select qa.check(rota_052_registrar(current_date::text||'/100001/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg',
 array(select x::bigint from generate_series(100001,100051)x),false,'caminhao',1)=51,'CD 51 pedidos');
select qa.check(rota_052_registrar(current_date::text||'/100001/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg',
 array(select x::bigint from generate_series(100001,115050)x),false,'caminhao',1)=15050,'CD limite completo 15050');
select qa.check(rota_052_registrar(current_date::text||'/100001/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg',
 array(select x::bigint from generate_series(100001,115050)x),false,'caminhao',1)=0,'CD retry completo sem duplicar');
select qa.erro($c$select rota_052_registrar(current_date::text||'/100001/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg',
 array(select x::bigint from generate_series(100001,115051)x),false,'caminhao',1)$c$,'22023','CD acima do limite recusado');
select qa.erro($c$select rota_052_registrar(current_date::text||'/100001/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg',
 array[100001,null]::bigint[],false,'caminhao',1)$c$,'22023','pedido nulo recusado');
set qa.papel='marcador';
select qa.check(rota_052_registrar(current_date::text||'/100001/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg',array[100001]::bigint[],true)=0,'painel mantem chamada tres argumentos');
reset role;
-- Retirar e republicar no mesmo dia nao pode reutilizar o numero 1 da 047.
delete from rota_saida where veiculo_id='s10';
insert into rota_saida values(current_date,'s10',1,'[{"ordem":1,"pedidos":[22]}]','{}');
select qa.check((select versao>2 from rota_saida where veiculo_id='s10'),'retirar republicar nao recicla versao');
insert into rota_saida values(current_date,'s10',1,'[{"ordem":1,"pedidos":[22]}]','{}')
on conflict(data,veiculo_id) do update set paradas=excluded.paradas;
select qa.check((select versao=4 from rota_saida where veiculo_id='s10'),'upsert avanca uma versao sem contar duas vezes');
set role authenticated;
set qa.uid='11111111-1111-4111-8111-111111111111';
set qa.papel='motorista';
select qa.erro($c$select rota_051_marcar(current_date,'s10',1,1,true,now())$c$,'P5103','fila anterior a retirada recusada');
select qa.check((select count(*)=0 from rota_saida_progresso),'retirada nao ressuscita progresso');
reset role;
\ir :migration051
\ir :migration052
select qa.check((select count(*)=3 from rota_saida_progresso),'reaplicar preserva progresso');
select qa.check((select count(*)=15050 from pedido_canhoto where caminho like '%/cccccccc-%'),'reaplicar preserva associacao CD');
select count(*) as testes_sql_passaram from qa.checks;

