-- ROLLBACK da 049 (rotinas do chefe no WhatsApp). NAO e migracao: so rode se precisar desfazer a 049.
-- Uma transacao: ou desfaz tudo, ou nada muda. APAGA as rotinas pedidos_dia e rota_chefe (com horario, dias e
-- destinatarios que o painel tiver mudado); o historico (whatsapp_envios/whatsapp_execucoes) fica. Antes de rodar:
-- publique a Edge Function SEM a 049 (ou desligue as duas rotinas), senao o cron nao acha mais as rotinas (nada envia).
-- Volta o gatilho de papel e o CHECK de id da frota para os da 047.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.whatsapp_rotinas') is null or to_regclass('public.rota_veiculos') is null then
    raise exception 'rollback 049: 042/047 ausentes. Nada foi alterado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 49);

delete from public.whatsapp_rotinas where codigo in ('pedidos_dia', 'rota_chefe');

alter table public.rota_veiculos drop constraint if exists rota_veiculos_047_id;
alter table public.rota_veiculos add constraint rota_veiculos_047_id check (id not in ('constructor', '__proto__', 'prototype'));
alter table public.rota_veiculos drop constraint if exists rota_veiculos_049_id;

-- funcao igual a da 047 (secao 5)
create or replace function public.whatsapp_042_rotina_validar()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare v_permitidos text[];
begin
  v_permitidos := case
    when new.codigo in ('receber_diario', 'alertas_marcio') then array['gestor']
    when new.codigo ~ '^rota_[a-z0-9_]{2,20}$' then array['entregador', 'gestor']
    else null end;
  if v_permitidos is not null and exists (
       select 1 from unnest(new.destinatarios) u(id)
         join public.whatsapp_destinatarios d on d.id = u.id
        where d.papel <> all (v_permitidos)) then
    raise exception 'rotina %: so recebe quem tem papel %', new.codigo, array_to_string(v_permitidos, ' ou ')
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.whatsapp_042_rotina_validar() from public, anon, authenticated;

commit;
