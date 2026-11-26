\set ON_ERROR_STOP on
-- Apenas fixture local prefixoH. Instala044real+A sobre o templateC aprovado; preserva limpeza055.
do $$begin if current_database() !~ '^sentinela_separando_cpf_forja068h' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somenteQA H local';end if;end$$;
alter table public.rota_pedido_veiculo add column if not exists atualizado_por uuid;
create temporary table h_limpeza as select pg_get_functiondef('public.rota_044_limpar()'::regprocedure) d;
\i C:/Users/emporio/Downloads/TempRio-trabalho/worktrees/temp-rio-068/admin/migracoes/044_rota_marcacao_horarios.sql
select d from h_limpeza \gexec
\i C:/Users/emporio/Downloads/TempRio-trabalho/forja/pacote_068A_trocar_veiculo_20261126/supabase/tests/044-047-base.sql
\i C:/Users/emporio/Downloads/TempRio-trabalho/forja/pacote_068A_trocar_veiculo_20261126/admin/migracoes/068_a_trocar_veiculo.sql
