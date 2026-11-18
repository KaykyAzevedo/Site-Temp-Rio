-- 044: Rotas v2 — marcacao CEASA/S10 com memoria por cliente + regras e horarios de entrega.
-- APLICADA em producao em 2026-11-18 (MCP Supabase, conferida: 2 tabelas, 12 politicas, cron rota-limpeza). Idempotente.
-- Requer 014 (eh_admin, eh_equipe, admins.papel), 013 (texto_seguro), 035 (solidcon_pedidos_erp) e 040 (rota_config,
-- rota_cliente_veiculo). pg_cron e opcional (so a limpeza diaria).
--
-- Regra do dono (2026-11-17): o Marcio e o dono marcam, TODO DIA, cada pedido pendente como CEASA (= caminhao) ou S10.
-- O sistema lembra por cliente; com o tempo so cliente novo fica "Falta marcar". Pedido sem marcacao NAO entra na rota
-- (o painel mostra a regra automatica de antes so como SUGESTAO). Caminhao: clientes do CEASA viram UMA parada (o
-- centro de distribuicao no CEASA, com a lista de carga); clientes dos bairros do caminhao continuam na porta.
--
-- (1) rota_config ganha hora_saida (07:00), velocidade_kmh (25) e minutos_parada (10): horario estimado das paradas.
-- (2) admins.marca_rota: permissao EXPLICITA por usuario para marcar a rota e editar as regras, sem virar admin.
--     public.pode_marcar_rota(): admin OU (esta em admins E marca_rota). Vendedor sem a marca so le.
--     Quem liga (so o dono, no SQL Editor): update public.admins set marca_rota = true where email = '<email>';
--     (nenhum cliente da API escreve em admins: nao ha politica de escrita nessa tabela.)
-- (3) rota_cliente_veiculo (040) passa a ser o PADRAO do cliente; escrita: pode_marcar_rota() (antes so eh_admin()).
--     As linhas existentes (exceções 'caminhao') viram padrao sem mudanca de dado.
-- (4) rota_pedido_veiculo: escolha SO DESTE PEDIDO (vence o padrao). Sem FK para solidcon_pedidos_erp de proposito:
--     a coleta (035/039) apaga e reinsere todos os pedidos a cada execucao (FK com cascade apagaria as marcacoes;
--     sem cascade quebraria a coleta). Limpeza diaria: rota_044_limpar() (pedido que saiu/sumiu ha mais de 30 dias).
-- (5) rota_cliente_regras: regras fixas de entrega por cliente — janela de recebimento (inicio/fim, ambos opcionais,
--     00:00..23:59: '24:00' e recusado; "ate o fim do dia" = sem fim), dias da semana que NAO recebe
--     (0 = domingo ... 6 = sabado), prioridade "entregar primeiro", observacao curta.
-- (6) rota_044_marcar(cd_pedido, veiculo, escopo): uma chamada do painel faz a gravacao certa (padrao x so este
--     pedido). SECURITY INVOKER: as politicas RLS valem; a funcao so organiza.
-- RLS: leitura eh_equipe() (vendedor le); escrita pode_marcar_rota(); anon nada. Politicas por comando com
--      (select ...) (initPlan, padrao da 038). Nada de FOR ALL. Nenhum dado de cliente alem do documento.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('public.eh_admin()') is null or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('auth.uid()') is null or to_regprocedure('auth.jwt()') is null
     or to_regprocedure('public.texto_seguro(text,integer)') is null
     or to_regclass('public.admins') is null or to_regclass('public.solidcon_pedidos_erp') is null
     or to_regclass('public.rota_config') is null or to_regclass('public.rota_cliente_veiculo') is null
     or to_regprocedure('public.rota_040_veiculo_carimbar()') is null then
    raise exception '044 requer 013 (texto_seguro), 014 (eh_admin/eh_equipe), 035 (solidcon_pedidos_erp) e 040 (rota_config, rota_cliente_veiculo). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 44);

-- ===================== (1) rota_config: horario =====================
alter table public.rota_config add column if not exists hora_saida time not null default '07:00';
alter table public.rota_config add column if not exists velocidade_kmh numeric(4,1) not null default 25;
alter table public.rota_config add column if not exists minutos_parada smallint not null default 10;
alter table public.rota_config drop constraint if exists rota_config_044_velocidade;
alter table public.rota_config add constraint rota_config_044_velocidade check (velocidade_kmh between 5 and 120);
alter table public.rota_config drop constraint if exists rota_config_044_parada;
alter table public.rota_config add constraint rota_config_044_parada check (minutos_parada between 0 and 120);
-- time do Postgres aceita '24:00'; o painel nao (hora de saida e 00:00..23:59). Recusado aqui, com erro 23514.
alter table public.rota_config drop constraint if exists rota_config_044_hora_saida;
alter table public.rota_config add constraint rota_config_044_hora_saida check (hora_saida < time '24:00');

-- ===================== (2) permissao explicita: marca_rota =====================
alter table public.admins add column if not exists marca_rota boolean not null default false;

-- INVOKER: le a propria linha de admins (politica "admin le a propria linha"), igual a eh_admin()/eh_equipe().
create or replace function public.pode_marcar_rota()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.admins a
     where a.email = (auth.jwt() ->> 'email')
       and (a.papel = 'admin' or a.marca_rota)
  );
$$;
revoke all on function public.pode_marcar_rota() from public, anon;
grant execute on function public.pode_marcar_rota() to authenticated;

-- ===================== (3) rota_cliente_veiculo = PADRAO do cliente =====================
-- Mesma tabela e mesmos dados da 040; so a escrita passa de eh_admin() para pode_marcar_rota().
drop policy if exists rota_040_admin_insere on public.rota_cliente_veiculo;
drop policy if exists rota_040_admin_atualiza on public.rota_cliente_veiculo;
drop policy if exists rota_040_admin_apaga on public.rota_cliente_veiculo;
drop policy if exists rota_044_marca_insere on public.rota_cliente_veiculo;
create policy rota_044_marca_insere on public.rota_cliente_veiculo for insert to authenticated
  with check ((select public.pode_marcar_rota()));
drop policy if exists rota_044_marca_atualiza on public.rota_cliente_veiculo;
create policy rota_044_marca_atualiza on public.rota_cliente_veiculo for update to authenticated
  using ((select public.pode_marcar_rota())) with check ((select public.pode_marcar_rota()));
drop policy if exists rota_044_marca_apaga on public.rota_cliente_veiculo;
create policy rota_044_marca_apaga on public.rota_cliente_veiculo for delete to authenticated
  using ((select public.pode_marcar_rota()));

-- ===================== (4) rota_pedido_veiculo: so neste pedido =====================
create table if not exists public.rota_pedido_veiculo (
  cd_pedido bigint primary key check (cd_pedido between 1 and 999999999999),
  veiculo text not null check (veiculo in ('caminhao', 's10')),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
-- Carimbo quem/quando: a mesma funcao de gatilho da 040 (so atualizado_em/atualizado_por).
drop trigger if exists rota_044_pedido_carimbar on public.rota_pedido_veiculo;
create trigger rota_044_pedido_carimbar before insert or update on public.rota_pedido_veiculo
  for each row execute function public.rota_040_veiculo_carimbar();

alter table public.rota_pedido_veiculo enable row level security;
revoke all on public.rota_pedido_veiculo from public, anon, authenticated;
grant select, insert, update, delete on public.rota_pedido_veiculo to authenticated;

drop policy if exists rota_044_equipe_le on public.rota_pedido_veiculo;
create policy rota_044_equipe_le on public.rota_pedido_veiculo for select to authenticated
  using ((select public.eh_equipe()));
drop policy if exists rota_044_marca_insere on public.rota_pedido_veiculo;
create policy rota_044_marca_insere on public.rota_pedido_veiculo for insert to authenticated
  with check ((select public.pode_marcar_rota()));
drop policy if exists rota_044_marca_atualiza on public.rota_pedido_veiculo;
create policy rota_044_marca_atualiza on public.rota_pedido_veiculo for update to authenticated
  using ((select public.pode_marcar_rota())) with check ((select public.pode_marcar_rota()));
drop policy if exists rota_044_marca_apaga on public.rota_pedido_veiculo;
create policy rota_044_marca_apaga on public.rota_pedido_veiculo for delete to authenticated
  using ((select public.pode_marcar_rota()));

-- ===================== (5) rota_cliente_regras =====================
create table if not exists public.rota_cliente_regras (
  documento text primary key check (documento ~ '^[0-9]{11,14}$'),
  janela_inicio time,
  janela_fim time,
  dias_sem_receber smallint[] not null default '{}',
  prioridade boolean not null default false,
  observacao text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
alter table public.rota_cliente_regras drop constraint if exists rota_cliente_regras_044_janela;
alter table public.rota_cliente_regras add constraint rota_cliente_regras_044_janela
  check ((janela_inicio is null or janela_inicio < time '24:00') and (janela_fim is null or janela_fim < time '24:00')
         and (janela_inicio is null or janela_fim is null or janela_inicio < janela_fim));
alter table public.rota_cliente_regras drop constraint if exists rota_cliente_regras_044_dias;
alter table public.rota_cliente_regras add constraint rota_cliente_regras_044_dias
  check (cardinality(dias_sem_receber) <= 7 and array_position(dias_sem_receber, null) is null
         and dias_sem_receber <@ array[0,1,2,3,4,5,6]::smallint[]);
alter table public.rota_cliente_regras drop constraint if exists rota_cliente_regras_044_obs;
alter table public.rota_cliente_regras add constraint rota_cliente_regras_044_obs
  check (observacao is null or (char_length(observacao) between 1 and 200 and public.texto_seguro(observacao, 200)));

-- Normaliza (observacao sem espacos nas pontas; vazia = NULL; dias sem repeticao e em ordem) e carimba quem/quando.
create or replace function public.rota_044_regras_normalizar()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.observacao := nullif(btrim(regexp_replace(coalesce(new.observacao, ''), '\s+', ' ', 'g')), '');
  new.dias_sem_receber := coalesce((select array_agg(distinct d order by d) from unnest(coalesce(new.dias_sem_receber, '{}')) as t(d)), '{}');
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;
revoke all on function public.rota_044_regras_normalizar() from public, anon, authenticated;

drop trigger if exists rota_044_regras_normalizar on public.rota_cliente_regras;
create trigger rota_044_regras_normalizar before insert or update on public.rota_cliente_regras
  for each row execute function public.rota_044_regras_normalizar();

alter table public.rota_cliente_regras enable row level security;
revoke all on public.rota_cliente_regras from public, anon, authenticated;
grant select, insert, update, delete on public.rota_cliente_regras to authenticated;

drop policy if exists rota_044_equipe_le on public.rota_cliente_regras;
create policy rota_044_equipe_le on public.rota_cliente_regras for select to authenticated
  using ((select public.eh_equipe()));
drop policy if exists rota_044_marca_insere on public.rota_cliente_regras;
create policy rota_044_marca_insere on public.rota_cliente_regras for insert to authenticated
  with check ((select public.pode_marcar_rota()));
drop policy if exists rota_044_marca_atualiza on public.rota_cliente_regras;
create policy rota_044_marca_atualiza on public.rota_cliente_regras for update to authenticated
  using ((select public.pode_marcar_rota())) with check ((select public.pode_marcar_rota()));
drop policy if exists rota_044_marca_apaga on public.rota_cliente_regras;
create policy rota_044_marca_apaga on public.rota_cliente_regras for delete to authenticated
  using ((select public.pode_marcar_rota()));

-- ===================== (6) rota_044_marcar =====================
-- p_veiculo: 'caminhao' (CEASA) | 's10' | NULL (desmarcar). p_escopo: 'pedido' (so neste) | 'sempre' (padrao).
--   Cliente SEM padrao (e com documento): marcar grava o PADRAO, qualquer que seja o escopo.
--   Cliente COM padrao: 'sempre' troca o padrao (e tira a escolha deste pedido); 'pedido' grava so neste pedido
--   (igual ao padrao: apaga a escolha do pedido, nao guarda repeticao).
--   Pedido sem documento (PF/indefinido): so existe 'pedido' (nao ha cliente para lembrar).
--   NULL + 'pedido': tira a escolha do pedido (volta ao padrao). NULL + 'sempre': tira o padrao E a escolha do pedido.
-- Retorna o que ficou valendo: 'padrao' | 'pedido' | 'removido'. Erros: 42501 (sem permissao), 22023 (parametro),
-- P0002 (pedido nao esta na lista do ERP).
create or replace function public.rota_044_marcar(p_cd_pedido bigint, p_veiculo text, p_escopo text default 'pedido')
returns text
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_doc text;
  v_padrao text;
begin
  if not public.pode_marcar_rota() then
    raise exception 'sem permissao para marcar a rota' using errcode = '42501';
  end if;
  if p_cd_pedido is null or (p_veiculo is not null and p_veiculo not in ('caminhao', 's10'))
     or coalesce(p_escopo, '') not in ('pedido', 'sempre') then
    raise exception 'parametro invalido' using errcode = '22023';
  end if;
  select e.documento into v_doc from public.solidcon_pedidos_erp e where e.cd_pedido = p_cd_pedido;
  if not found then
    raise exception 'pedido nao encontrado' using errcode = 'P0002';
  end if;
  if v_doc is not null then
    select r.veiculo into v_padrao from public.rota_cliente_veiculo r where r.documento = v_doc;
  end if;

  if p_veiculo is null then
    delete from public.rota_pedido_veiculo where cd_pedido = p_cd_pedido;
    if p_escopo = 'sempre' and v_doc is not null then
      delete from public.rota_cliente_veiculo where documento = v_doc;
    end if;
    return 'removido';
  end if;

  if v_doc is not null and (p_escopo = 'sempre' or v_padrao is null) then
    insert into public.rota_cliente_veiculo as r (documento, veiculo) values (v_doc, p_veiculo)
      on conflict (documento) do update set veiculo = excluded.veiculo;
    delete from public.rota_pedido_veiculo where cd_pedido = p_cd_pedido;
    return 'padrao';
  end if;
  if v_padrao is not distinct from p_veiculo then
    delete from public.rota_pedido_veiculo where cd_pedido = p_cd_pedido;
    return 'padrao';
  end if;
  insert into public.rota_pedido_veiculo as r (cd_pedido, veiculo) values (p_cd_pedido, p_veiculo)
    on conflict (cd_pedido) do update set veiculo = excluded.veiculo;
  return 'pedido';
end;
$$;
revoke all on function public.rota_044_marcar(bigint, text, text) from public, anon;
grant execute on function public.rota_044_marcar(bigint, text, text) to authenticated;

-- ===================== limpeza =====================
-- Escolha "so neste pedido" cujo pedido ja nao esta pendente no ERP (saiu, atendido ou sumiu) e com mais de 30 dias.
create or replace function public.rota_044_limpar()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare v_n integer;
begin
  delete from public.rota_pedido_veiculo v
   where v.atualizado_em < now() - interval '30 days'
     and not exists (select 1 from public.solidcon_pedidos_erp e
                      where e.cd_pedido = v.cd_pedido
                        and e.etapa in ('aberto', 'na_carga', 'separando', 'separado', 'conferido'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.rota_044_limpar() from public, anon, authenticated;
grant execute on function public.rota_044_limpar() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $j$select cron.unschedule(jobid) from cron.job where jobname = 'rota-limpeza'$j$;
    execute $j$select cron.schedule('rota-limpeza', '23 6 * * *', 'select public.rota_044_limpar()')$j$;
  else
    raise notice '044: pg_cron nao instalado: limpeza diaria de rota_pedido_veiculo NAO agendada (rode select public.rota_044_limpar() de vez em quando).';
  end if;
end;
$$;

commit;
