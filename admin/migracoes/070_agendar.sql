-- Etapa obrigatoria de instalacao070 em producao, depois do SQL070 principal.
-- LocalPG sem pg_cron testa o corpo diretamente; ausencia em producao FALHA explicitamente.
begin;
do $$begin if not exists(select 1 from pg_extension where extname='pg_cron') then raise exception '070 requer pg_cron habilitado: worker nao agendado';end if;end$$;
select cron.unschedule(jobid) from cron.job where jobname='rota-070-virada';
select cron.schedule('rota-070-virada','* * * * *','select public.rota_070_virada()');
do $$begin if (select count(*) from cron.job where jobname='rota-070-virada' and active and command='select public.rota_070_virada()')<>1 then raise exception '070 agendamento nao confirmado';end if;end$$;
commit;
