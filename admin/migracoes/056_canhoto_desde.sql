-- 056: corte do controle de canhoto; antes e legado recebido. Requer055 aplicada.
-- Instante padrao 23/11/2026 12:00 Sao Paulo = 15:00 UTC. Reexecucao preserva edicao admin.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
select pg_catalog.pg_advisory_xact_lock(5100,56);
do $$begin
 if to_regprocedure('public.rota_055_pendente(bigint,date)') is null or to_regclass('public.rota_config') is null then
  raise exception '056 requer040/055. Nada aplicado.';
 end if;
end$$;
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
-- Falha sem alteracao se houver escritor/leitor concorrente: evita ciclo DDL/config ->5001.
lock table public.rota_config in access exclusive mode nowait;
do $$declare v_nova boolean;begin
 v_nova := not exists(select 1 from pg_catalog.pg_attribute where attrelid='public.rota_config'::regclass and attname='canhoto_desde' and not attisdropped);
 alter table public.rota_config add column if not exists canhoto_desde timestamptz(3) not null default timestamptz '2026-11-23 12:00:00-03';
 alter table public.rota_config alter column canhoto_desde set default timestamptz '2026-11-23 12:00:00-03';
 alter table public.rota_config alter column canhoto_desde set not null;
 if v_nova then
  update public.rota_dia_fechada set revisao=revisao+1,alterada_em=pg_catalog.now() where data=public.rota_050_hoje() and estado='fechada';
 end if;
end$$;
alter table public.rota_config drop constraint if exists rota_056_canhoto_desde_finito;
alter table public.rota_config add constraint rota_056_canhoto_desde_finito check(pg_catalog.isfinite(canhoto_desde));
-- RLS/grants/carimbo040 permanecem: equipe le, somente admin insere/atualiza. Sem novo endpoint.
create or replace function public.rota_055_pendente(p_cd bigint,p_dia date)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.solidcon_pedidos_erp p where p.cd_pedido=p_cd
   and not exists(select 1 from public.pedido_canhoto c where c.cd_pedido=p.cd_pedido and c.substituido_em is null)
   and (p.etapa in ('aberto','na_carga','separando','separado','conferido')
     or (p.etapa in ('saiu','atendido')
       and ((select c.canhoto_desde from public.rota_config c where c.id=1) is null
         or coalesce(p.dt_saida,p.dt_nota,p.dt_atendido)>=(select c.canhoto_desde from public.rota_config c where c.id=1))
       and (coalesce(p.dt_saida,p.dt_nota,p.dt_atendido) at time zone 'America/Sao_Paulo')::date>=p_dia-7)))
$$;
-- CREATE OR REPLACE conserva ACL privada055, incluindo EXECUTE de service_role para limpezas.
create or replace function public.rota_056_config_revisao()
returns trigger language plpgsql security definer set search_path=''
as $$begin
 if tg_op='UPDATE' then
  if new.canhoto_desde is not distinct from old.canhoto_desde then return new;end if;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(5100,5001);
 update public.rota_dia_fechada set revisao=revisao+1,alterada_em=pg_catalog.now() where data=public.rota_050_hoje() and estado='fechada';
 if tg_op='DELETE' then return old;end if;
 return new;
end$$;
revoke all on function public.rota_056_config_revisao() from public,anon,authenticated,service_role;
drop trigger if exists rota_056_config_revisao on public.rota_config;
-- AFTER evita revisar a tentativa de INSERT que virou UPDATE em um upsert (um unico efeito real).
create trigger rota_056_config_revisao after insert or update of canhoto_desde or delete on public.rota_config
 for each row execute function public.rota_056_config_revisao();
notify pgrst, 'reload schema';
commit;
