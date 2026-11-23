-- Rollback054: preserva todos os pedidos/ordens/revisoes. Inclusoes automaticas viram 'adicionado'.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_catalog.pg_advisory_xact_lock(5100,54);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
drop function if exists public.rota_054_incluir(date,integer,jsonb);
drop trigger if exists rota_054_origem on public.rota_dia_item;
drop function if exists public.rota_054_origem();
drop function if exists public.rota_054_candidatos(date);
drop function if exists public.rota_054_tem_saida(date,text);
drop function if exists public.rota_054_padrao_separando();
drop index if exists public.rota_dia_item_054_removido_doc_idx;
update public.rota_dia_item set origem='adicionado' where origem='separando';
alter table public.rota_dia_item drop constraint if exists rota_dia_item_054_origem_check;
alter table public.rota_dia_item drop constraint if exists rota_dia_item_origem_check;
alter table public.rota_dia_item add constraint rota_dia_item_origem_check check(origem in ('previsao','adicionado'));
commit;
