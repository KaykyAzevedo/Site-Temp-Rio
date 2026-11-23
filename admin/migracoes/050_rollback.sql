-- ROLLBACK da 050 (rota do dia fechada). NAO e migracao: so rode se precisar desfazer a 050.
-- Uma transacao: ou desfaz tudo, ou nada muda. APAGA as fotos das rotas fechadas e o log de ajustes (rota_dia_*).
-- Antes: publique o painel e a whatsapp-rotinas SEM a 050 (sem ela os dois voltam sozinhos ao comportamento de antes:
-- previsao viva) e, se quiser guardar, exporte rota_dia_fechada / rota_dia_item / rota_dia_log. Sem CASCADE.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

select pg_catalog.pg_advisory_xact_lock(5100, 50);

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $j$select cron.unschedule(jobid) from cron.job where jobname = 'rota-limpeza-dia-fechada'$j$;
  end if;
end;
$$;

drop trigger if exists rota_050_saida_conferir on public.rota_saida;
drop function if exists public.rota_050_saida_conferir();
drop function if exists public.rota_050_publicar(date, text, jsonb, jsonb, integer);
drop function if exists public.rota_050_envio_ok(date, text, jsonb);
drop function if exists public.rota_050_ler(date);
drop function if exists public.rota_050_limpar();
drop function if exists public.rota_050_reabrir();
drop function if exists public.rota_050_ajustar(text, bigint[], text, jsonb);
drop function if exists public.rota_050_fechar_auto(jsonb);
drop function if exists public.rota_050_fechar(jsonb);
drop function if exists public.rota_050_fechar_hoje(jsonb, uuid, boolean);
drop function if exists public.rota_050_gravar_itens(date, jsonb, uuid);
drop function if exists public.rota_050_nome(uuid);
drop function if exists public.rota_050_hoje();
drop table if exists public.rota_dia_log;
drop table if exists public.rota_dia_item;
drop table if exists public.rota_dia_fechada;

commit;
