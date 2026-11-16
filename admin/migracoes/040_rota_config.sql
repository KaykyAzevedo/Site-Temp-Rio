-- 040: configuracao da Rota do dia editavel no painel (aba Rotas).
-- APLICADA em 2026-11-16 (conferida: rota_config id=1 com padroes; politicas por comando; anon sem grant). Instalacao manual no SQL Editor (papel postgres). Idempotente.
-- Requer eh_admin() e eh_equipe() (014). Independente de 035..039 (o painel funciona sem a 040 com os padroes).
-- (1) rota_config: LINHA UNICA (id = 1) com as regras que o dono/Marcio ajustam:
--     bairros_caminhao  bairros atendidos pelo CAMINHAO do CEASA no caminho (normalizados: MAIUSCULAS, sem acento,
--                       espacos simples; o gatilho normaliza, tira vazios/repetidos e ordena);
--     corte_hora        0..23 = pedido feito a partir dessa hora (Sao Paulo) conta o prazo do dia seguinte; NULL = sem corte;
--     s10_volta_sede    true = o km estimado da S10 inclui a volta para a sede;
--     feriados_sem_saida true = feriado nao tem saida e nao conta como dia util (nacionais + moveis + extras);
--     feriados_extras   datas a mais sem saida (ex.: feriado estadual/municipal, ponte).
-- (2) rota_cliente_veiculo: EXCECAO por cliente (documento so digitos) -> 'caminhao' | 's10'. Sem linha = automatico.
-- RLS: leitura eh_equipe() (vendedor le); escrita SO eh_admin(); anon nada. Politicas por comando, com
--      (select eh_...()) (initPlan, padrao da 038). Nada de FOR ALL. Sem DELETE em rota_config.
-- Nenhum dado de cliente alem do documento (que ja esta em solidcon_pedidos_erp/solidcon_clientes).
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('public.eh_admin()') is null or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception '040 requer eh_admin(), eh_equipe() (014) e auth.uid(). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 40);

-- ===================== (1) rota_config =====================
create table if not exists public.rota_config (
  id smallint primary key default 1 check (id = 1),
  bairros_caminhao text[] not null default '{}'
    check (cardinality(bairros_caminhao) <= 300 and array_position(bairros_caminhao, null) is null),
  corte_hora smallint check (corte_hora between 0 and 23),
  s10_volta_sede boolean not null default false,
  feriados_sem_saida boolean not null default true,
  feriados_extras date[] not null default '{}'
    check (cardinality(feriados_extras) <= 120 and array_position(feriados_extras, null) is null),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);

-- Normaliza bairros (mesma ideia de geoNorm do painel, em MAIUSCULAS), limita tamanho, carimba quem/quando.
-- Funcao de gatilho: nao precisa de EXECUTE para quem grava; nenhuma chamada de funcao do schema public.
create or replace function public.rota_040_config_normalizar()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_b text;
  v_saida text[] := '{}';
begin
  foreach v_b in array coalesce(new.bairros_caminhao, '{}') loop
    -- Sem acento, MAIUSCULAS; o que nao for letra/numero/pontuacao simples vira espaco; espacos colapsados.
    v_b := upper(translate(coalesce(v_b, ''),
      'áàâãäåéèêëíìîïóòôõöúùûüçñýÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ',
      'aaaaaaeeeeiiiiooooouuuucnyaaaaaaeeeeiiiiooooouuuucny'));
    v_b := btrim(regexp_replace(regexp_replace(v_b, '[^A-Z0-9 .,''()/-]', ' ', 'g'), '\s+', ' ', 'g'));
    if v_b = '' then continue; end if;
    if char_length(v_b) > 80 then
      raise exception 'bairro invalido' using errcode = '22023';
    end if;
    v_saida := array_append(v_saida, v_b);
  end loop;
  new.bairros_caminhao := coalesce((select array_agg(distinct x order by x) from unnest(v_saida) as t(x)), '{}');
  new.feriados_extras := coalesce((select array_agg(distinct d order by d) from unnest(coalesce(new.feriados_extras, '{}')) as t(d)
                                    where d between date '2020-01-01' and date '2100-12-31'), '{}');
  new.id := 1;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;
revoke all on function public.rota_040_config_normalizar() from public, anon, authenticated;

drop trigger if exists rota_040_config_normalizar on public.rota_config;
create trigger rota_040_config_normalizar before insert or update on public.rota_config
  for each row execute function public.rota_040_config_normalizar();

-- Linha unica com os padroes (sem bairros; feriado sem saida; sem corte; S10 nao volta).
insert into public.rota_config (id) values (1) on conflict (id) do nothing;

alter table public.rota_config enable row level security;
revoke all on public.rota_config from public, anon, authenticated;
grant select, insert, update on public.rota_config to authenticated;

drop policy if exists rota_040_equipe_le on public.rota_config;
create policy rota_040_equipe_le on public.rota_config for select to authenticated
  using ((select public.eh_equipe()));
drop policy if exists rota_040_admin_insere on public.rota_config;
create policy rota_040_admin_insere on public.rota_config for insert to authenticated
  with check ((select public.eh_admin()));
drop policy if exists rota_040_admin_atualiza on public.rota_config;
create policy rota_040_admin_atualiza on public.rota_config for update to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));

-- ===================== (2) rota_cliente_veiculo =====================
create table if not exists public.rota_cliente_veiculo (
  documento text primary key check (documento ~ '^[0-9]{11,14}$'),
  veiculo text not null check (veiculo in ('caminhao', 's10')),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);

create or replace function public.rota_040_veiculo_carimbar()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;
revoke all on function public.rota_040_veiculo_carimbar() from public, anon, authenticated;

drop trigger if exists rota_040_veiculo_carimbar on public.rota_cliente_veiculo;
create trigger rota_040_veiculo_carimbar before insert or update on public.rota_cliente_veiculo
  for each row execute function public.rota_040_veiculo_carimbar();

alter table public.rota_cliente_veiculo enable row level security;
revoke all on public.rota_cliente_veiculo from public, anon, authenticated;
grant select, insert, update, delete on public.rota_cliente_veiculo to authenticated;

drop policy if exists rota_040_equipe_le on public.rota_cliente_veiculo;
create policy rota_040_equipe_le on public.rota_cliente_veiculo for select to authenticated
  using ((select public.eh_equipe()));
drop policy if exists rota_040_admin_insere on public.rota_cliente_veiculo;
create policy rota_040_admin_insere on public.rota_cliente_veiculo for insert to authenticated
  with check ((select public.eh_admin()));
drop policy if exists rota_040_admin_atualiza on public.rota_cliente_veiculo;
create policy rota_040_admin_atualiza on public.rota_cliente_veiculo for update to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));
drop policy if exists rota_040_admin_apaga on public.rota_cliente_veiculo;
create policy rota_040_admin_apaga on public.rota_cliente_veiculo for delete to authenticated
  using ((select public.eh_admin()));

commit;
