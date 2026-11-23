-- 049: WhatsApp — 2 rotinas novas para o chefe (WA-PED): pedidos do dia e rota do dia (paradas + rota sugerida).
-- NAO APLICADA. Idempotente. Requer 042 (whatsapp_rotinas, whatsapp_042_rotina_validar) e 047 (rota_veiculos e a troca
-- do gatilho de papel). Nao depende da 048. Rollback: 049_rollback.sql.
--
-- (1) Rotinas (DESLIGADAS, em simulacao, sem destinatarios; o dono liga no painel). Nao sobrescreve se ja existirem:
--       pedidos_dia  template pedidos_do_dia  17:00 seg a sab  — entrou / ta pronto / enviou no dia;
--       rota_chefe   template rota_sugerida   06:00 seg a sab  — N mensagens rota_paradas (template fixo no codigo,
--                    whatsapp-core.js) e, POR ULTIMO, 1 rota_sugerida (o nome gravado aqui).
-- (2) Papel x rotina (gatilho da 042, trocado na 047): pedidos_dia e rota_chefe SO 'gestor' (valores, enderecos e a
--     rota de todos os veiculos). Vem ANTES da regra rota_<veiculo> (entregador ou gestor). Mesma regra no envio
--     (whatsapp-core.js PAPEIS). O resto da funcao e igual ao da 047.
-- (3) rota_veiculos: o id 'chefe' fica reservado (senao rota_chefe seria tambem a rota do veiculo "chefe"). O CHECK da
--     047 (constructor/__proto__/prototype) e trocado por um que recusa tambem 'chefe'. Se ja existir veiculo 'chefe',
--     PARA sem mudar nada.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.whatsapp_rotinas') is null
     or to_regprocedure('public.whatsapp_042_rotina_validar()') is null
     or to_regclass('public.rota_veiculos') is null then
    raise exception '049 requer 042 (whatsapp_rotinas) e 047 (rota_veiculos). Nada foi aplicado.';
  end if;
  if exists (select 1 from public.rota_veiculos where id = 'chefe') then
    raise exception '049: ja existe veiculo com id ''chefe'' (reservado para a rotina rota_chefe). Renomeie/apague o veiculo antes. Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 49);

-- ===================== (3) id reservado =====================
alter table public.rota_veiculos drop constraint if exists rota_veiculos_049_id;
alter table public.rota_veiculos add constraint rota_veiculos_049_id check (id not in ('constructor', '__proto__', 'prototype', 'chefe'));
alter table public.rota_veiculos drop constraint if exists rota_veiculos_047_id;

-- ===================== (2) papel x rotina =====================
create or replace function public.whatsapp_042_rotina_validar()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare v_permitidos text[];
begin
  v_permitidos := case
    when new.codigo in ('receber_diario', 'alertas_marcio', 'pedidos_dia', 'rota_chefe') then array['gestor']
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

-- ===================== (1) rotinas =====================
-- ativo/modo/destinatarios ficam no padrao da 042 (false / 'simulacao' / '{}').
insert into public.whatsapp_rotinas (codigo, descricao, horario, dias, template) values
  ('pedidos_dia', 'Pedidos do dia: entrou, ta pronto (conferido) e enviou, com os principais clientes', '17:00', '{seg,ter,qua,qui,sex,sab}', 'pedidos_do_dia'),
  ('rota_chefe',  'Rota do dia para o chefe: pedidos para sair (6 por mensagem) e, por ultimo, a rota sugerida', '06:00', '{seg,ter,qua,qui,sex,sab}', 'rota_sugerida')
on conflict (codigo) do nothing;

commit;
