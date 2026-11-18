-- 046: Rotas — "Plano da semana" da S10 (pedido do Marcio, 2026-11-18).
-- NAO APLICADA. Idempotente. Requer 014 (eh_equipe), 035 (solidcon_pedidos_erp), 040 (rota_040_veiculo_carimbar) e
-- 044 (pode_marcar_rota). pg_cron e opcional (so a limpeza diaria).
--
-- O painel sugere o plano de seg a sab da proxima semana (rota-core.js planejarSemana: setores por angulo a partir da
-- sede, prazo, capacidade, dias em que o cliente nao recebe). O Marcio move pedidos entre os dias e SALVA: o dia salvo
-- vence a sugestao NO PLANO. Regra do dono (2026-11-18): cada dia e uma rota diferente e o plano e SO uma base de
-- referencia: a rota do dia (planejar) e o WhatsApp NAO mudam por causa dele; o painel no maximo mostra
-- "planejado p/ qua 25/11" ao lado do pedido. A S10 roda de segunda a sexta (o sabado e aceito aqui para a regra
-- por veiculo continuar configuravel no codigo; o planejarSemana da S10 ignora dia salvo sem saida dela).
--
-- rota_plano_semana: cd_pedido (PK) -> dia (seg..sab), atualizado_em/por (gatilho da 040). Sem FK para
-- solidcon_pedidos_erp pelo mesmo motivo da 044 (a coleta apaga e reinsere os pedidos). Limpeza diaria
-- rota_046_limpar(): dias que ja passaram (data de Sao Paulo).
-- rota_046_salvar_semana(p_inicio, p_itens): grava a semana INTEIRA de uma vez (atomico): apaga o que estava salvo
-- nos dias daquela semana e grava a lista nova (pedido que estava salvo em outra semana muda para esta).
-- SECURITY INVOKER: as politicas RLS valem; a funcao so organiza.
-- RLS: leitura eh_equipe(); escrita pode_marcar_rota(); anon nada. Politicas por comando com (select ...). Sem FOR ALL.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('public.eh_equipe()') is null or to_regprocedure('public.pode_marcar_rota()') is null
     or to_regprocedure('auth.uid()') is null
     or to_regprocedure('public.rota_040_veiculo_carimbar()') is null
     or to_regclass('public.solidcon_pedidos_erp') is null then
    raise exception '046 requer 014 (eh_equipe), 035 (solidcon_pedidos_erp), 040 (rota_040_veiculo_carimbar) e 044 (pode_marcar_rota). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 46);

create table if not exists public.rota_plano_semana (
  cd_pedido bigint primary key check (cd_pedido between 1 and 999999999999),
  dia date not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
-- So segunda a sabado (domingo nao tem saida) e datas plausiveis.
alter table public.rota_plano_semana drop constraint if exists rota_plano_semana_046_dia;
alter table public.rota_plano_semana add constraint rota_plano_semana_046_dia
  check (extract(isodow from dia) between 1 and 6 and dia between date '2020-01-01' and date '2100-12-31');
create index if not exists rota_plano_semana_046_dia_idx on public.rota_plano_semana (dia);

drop trigger if exists rota_046_plano_carimbar on public.rota_plano_semana;
create trigger rota_046_plano_carimbar before insert or update on public.rota_plano_semana
  for each row execute function public.rota_040_veiculo_carimbar();

-- Trava comum de TODA gravacao do plano (PS-1): a RPC e o insert/update/delete direto (mover um pedido, inclusive
-- entre semanas) pegam o mesmo advisory lock de transacao. Sem ela, duas gravacoes da semana ao mesmo tempo viravam a
-- uniao das duas listas (o DELETE de uma nao enxerga o INSERT ainda nao confirmado da outra, em Read Committed).
-- Com ela, a segunda espera a primeira confirmar e substitui o que a primeira gravou (o ultimo salvamento vence).
-- Gatilho por COMANDO (nao por linha): 1 lock por comando, solto no fim da transacao.
create or replace function public.rota_046_plano_travar()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(5100, 4601);
  return null;
end;
$$;
revoke all on function public.rota_046_plano_travar() from public, anon, authenticated;

drop trigger if exists rota_046_plano_travar on public.rota_plano_semana;
create trigger rota_046_plano_travar before insert or update or delete on public.rota_plano_semana
  for each statement execute function public.rota_046_plano_travar();

alter table public.rota_plano_semana enable row level security;
revoke all on public.rota_plano_semana from public, anon, authenticated;
grant select, insert, update, delete on public.rota_plano_semana to authenticated;

drop policy if exists rota_046_equipe_le on public.rota_plano_semana;
create policy rota_046_equipe_le on public.rota_plano_semana for select to authenticated
  using ((select public.eh_equipe()));
drop policy if exists rota_046_marca_insere on public.rota_plano_semana;
create policy rota_046_marca_insere on public.rota_plano_semana for insert to authenticated
  with check ((select public.pode_marcar_rota()));
drop policy if exists rota_046_marca_atualiza on public.rota_plano_semana;
create policy rota_046_marca_atualiza on public.rota_plano_semana for update to authenticated
  using ((select public.pode_marcar_rota())) with check ((select public.pode_marcar_rota()));
drop policy if exists rota_046_marca_apaga on public.rota_plano_semana;
create policy rota_046_marca_apaga on public.rota_plano_semana for delete to authenticated
  using ((select public.pode_marcar_rota()));

-- ===================== salvar a semana inteira =====================
-- p_inicio: a SEGUNDA-feira da semana. p_itens: jsonb array [{"cd_pedido": 123, "dia": "2026-11-24"}, ...] (ate 3000).
--   Cada dia entre p_inicio e p_inicio + 5 (seg..sab); cd_pedido sem repeticao e na lista do ERP.
--   Lista vazia = limpa o plano da semana (tudo volta a ser sugestao).
-- Retorna quantos pedidos ficaram salvos na semana. Erros: 42501 (sem permissao), 22023 (parametro), P0002 (pedido
-- nao esta na lista do ERP).
create or replace function public.rota_046_salvar_semana(p_inicio date, p_itens jsonb)
returns integer
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_n integer;
  v_falta bigint;
begin
  if not public.pode_marcar_rota() then
    raise exception 'sem permissao para salvar o plano' using errcode = '42501';
  end if;
  -- Trava comum das gravacoes do plano (a mesma do gatilho rota_046_plano_travar), ANTES de ler/apagar a semana.
  perform pg_catalog.pg_advisory_xact_lock(5100, 4601);
  if p_inicio is null or extract(isodow from p_inicio) <> 1 or p_itens is null or jsonb_typeof(p_itens) <> 'array'
     or jsonb_array_length(p_itens) > 3000 then
    raise exception 'parametro invalido' using errcode = '22023';
  end if;
  -- (sem tabela temporaria: authenticated pode nao ter TEMP; o jsonb e lido direto, ate 3000 itens)
  begin
    select count(*) filter (where i.cd_pedido is null or i.dia is null or i.dia < p_inicio or i.dia > p_inicio + 5),
           count(*) - count(distinct i.cd_pedido)
      into v_n, v_falta
      from jsonb_to_recordset(p_itens) as i(cd_pedido bigint, dia date);
  exception when others then
    raise exception 'parametro invalido' using errcode = '22023';
  end;
  if v_n > 0 or v_falta > 0 then
    raise exception 'parametro invalido' using errcode = '22023';
  end if;
  select i.cd_pedido into v_falta from jsonb_to_recordset(p_itens) as i(cd_pedido bigint, dia date)
   where not exists (select 1 from public.solidcon_pedidos_erp e where e.cd_pedido = i.cd_pedido)
   order by i.cd_pedido limit 1;
  if found then
    raise exception 'pedido % nao encontrado', v_falta using errcode = 'P0002';
  end if;
  delete from public.rota_plano_semana where dia between p_inicio and p_inicio + 5;
  insert into public.rota_plano_semana as r (cd_pedido, dia)
    select i.cd_pedido, i.dia from jsonb_to_recordset(p_itens) as i(cd_pedido bigint, dia date)
    on conflict (cd_pedido) do update set dia = excluded.dia;
  select count(*) into v_n from public.rota_plano_semana where dia between p_inicio and p_inicio + 5;
  return v_n;
end;
$$;
revoke all on function public.rota_046_salvar_semana(date, jsonb) from public, anon;
grant execute on function public.rota_046_salvar_semana(date, jsonb) to authenticated;

-- ===================== limpeza =====================
-- Dias que ja passaram (data de Sao Paulo). Pedido que nao saiu no dia planejado volta a ser sugestao.
create or replace function public.rota_046_limpar()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare v_n integer;
begin
  delete from public.rota_plano_semana where dia < (now() at time zone 'America/Sao_Paulo')::date;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.rota_046_limpar() from public, anon, authenticated;
grant execute on function public.rota_046_limpar() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $j$select cron.unschedule(jobid) from cron.job where jobname = 'rota-limpeza-plano'$j$;
    execute $j$select cron.schedule('rota-limpeza-plano', '31 6 * * *', 'select public.rota_046_limpar()')$j$;
  else
    raise notice '046: pg_cron nao instalado: limpeza diaria de rota_plano_semana NAO agendada (rode select public.rota_046_limpar() de vez em quando).';
  end if;
end;
$$;

commit;
