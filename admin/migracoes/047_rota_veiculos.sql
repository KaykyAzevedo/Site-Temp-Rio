-- 047: Rotas — FROTA configuravel no painel (caminhao do CEASA, S10, STRADA e o que vier) + tela do motorista.
-- NAO APLICADA. Idempotente. Requer 013 (texto_seguro), 014 (eh_admin/eh_equipe), 035 (solidcon_pedidos_erp),
-- 040 (rota_cliente_veiculo, rota_040_veiculo_carimbar), 044 (rota_pedido_veiculo, pode_marcar_rota, rota_044_marcar)
-- e 046 (rota_plano_semana). pg_cron e opcional (so a limpeza diaria). Ordem: 044 -> 045 -> 046 -> 047.
--
-- Pedido do dono (2026-11-19): 3 rotas (caminhao/CEASA, S10, STRADA com motorista novo); carga do veiculo alteravel
-- e veiculo novo pelo painel, sem mexer em codigo; relatorio por veiculo; tela basica so para o motorista.
--
-- (1) rota_veiculos: a frota. id = slug imutavel (^[a-z0-9_]{2,20}$), nome, modo ('cd_ceasa' = UMA parada no CD do
--     CEASA | 'porta' = porta a porta), capacidade_volume (volume: cx24 = 9, cx48 = 16,5, pote = 0,375; NULL = "carga
--     nao definida": sem limite, o painel avisa), dias_sem_saida (0 = domingo .. 6 = sabado; domingo SEMPRE sem saida),
--     volta_sede, cor (#rrggbb),
--     ordem (na tela), ativo. Seeds (so se nao existirem; nao sobrescreve o que o painel ja mudou):
--       caminhao (cd_ceasa, sem limite, sem saida domingo)      — regra do dono: CEASA = 1 parada, seg a sab;
--       s10      (porta, 2700, sem saida domingo e sabado)      — regra do dono: S10 seg a sex; volta_sede = a da 040;
--       strada   (porta, NULL = carga nao definida, seg a sex).
--     Veiculo com uso NAO se apaga (as FKs abaixo sao ON DELETE RESTRICT): desativa (ativo = false). Sem uso, o admin
--     pode apagar. id nao muda (gatilho; e as FKs sao ON UPDATE RESTRICT).
--     RLS: leitura eh_equipe() e o MOTORISTA le o proprio veiculo; escrita so eh_admin().
-- (2) As colunas de veiculo da 040 (rota_cliente_veiculo) e da 044 (rota_pedido_veiculo) trocam o CHECK
--     ('caminhao','s10') por FK -> rota_veiculos(id). rota_plano_semana (046) ganha veiculo_id (FK, padrao 's10'):
--     cada veiculo porta-a-porta tem o seu plano da semana; salvar a semana de um nao apaga a do outro.
--     rota_044_marcar passa a aceitar qualquer veiculo ATIVO (22023 se inativo/inexistente).
--     rota_047_salvar_semana(p_inicio, p_veiculo, p_itens): a semana de UM veiculo (ativo, modo 'porta'; dia em que
--     ele sai). rota_046_salvar_semana(p_inicio, p_itens) continua = a semana da S10.
-- (3) rota_motoristas: user_id (auth.users) -> veiculo_id, nome, ativo. O motorista NAO entra em admins (o dono cria o
--     login no Supabase Auth e a linha aqui); eh_equipe() continua falsa para ele, entao ele nao le nenhuma outra
--     tabela do painel. Leitura: equipe e o proprio motorista; escrita so eh_admin().
-- (4) rota_saida: a rota PUBLICADA pelo painel (foto do momento) por (data, veiculo_id): versao (sobe a cada
--     publicacao), paradas jsonb (lista ordenada, formato validado: ver rota_047_paradas_validas), resumo jsonb (lista fechada
--     de campos: rota_047_resumo_valido),
--     publicado_em/por. Escrita: pode_marcar_rota() (data de hoje ate +14 dias, veiculo ativo). Leitura: equipe, OU o
--     motorista ATIVO do veiculo, so a de HOJE e AMANHA (data de Sao Paulo). Limpeza: mais de 30 dias.
-- (5) WhatsApp (042): o gatilho de papel x rotina passa a valer para TODA rota_<veiculo> (entregador ou gestor);
--     rotina rota_strada criada DESLIGADA e em simulacao (seg a sex). O dono liga no painel.
-- Politicas por comando com (select ...) (initPlan, padrao da 038). Nada de FOR ALL. anon nada.
-- ATENCAO: rodar a 046 de novo DEPOIS da 047 volta rota_046_salvar_semana para a versao que apaga a semana de TODOS os
-- veiculos; se isso acontecer, rode a 047 de novo (idempotente).
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('public.eh_admin()') is null or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('public.pode_marcar_rota()') is null or to_regprocedure('auth.uid()') is null
     or to_regprocedure('public.texto_seguro(text,integer)') is null
     or to_regprocedure('public.rota_040_veiculo_carimbar()') is null
     or to_regprocedure('public.rota_044_marcar(bigint,text,text)') is null
     or to_regclass('auth.users') is null or to_regclass('public.solidcon_pedidos_erp') is null
     or to_regclass('public.rota_config') is null or to_regclass('public.rota_cliente_veiculo') is null
     or to_regclass('public.rota_pedido_veiculo') is null or to_regclass('public.rota_plano_semana') is null
     or to_regclass('public.whatsapp_rotinas') is null or to_regclass('public.whatsapp_destinatarios') is null then
    raise exception '047 requer 013, 014, 035, 040, 042 (whatsapp), 044 e 046 (rota_plano_semana). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 47);

-- ===================== (1) rota_veiculos =====================
create table if not exists public.rota_veiculos (
  id text primary key check (id ~ '^[a-z0-9_]{2,20}$'),   -- e nao e nome reservado (CHECK rota_veiculos_047_id abaixo)
  nome text not null,
  modo text not null check (modo in ('cd_ceasa', 'porta')),
  capacidade_volume numeric(9,2),
  dias_sem_saida smallint[] not null default '{0}',
  volta_sede boolean not null default false,
  cor text not null default '#64748b',
  ordem smallint not null default 100,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
-- Sentinela V-BACK V4: 'constructor'/'__proto__'/'prototype' passam no regex mas sao propriedades herdadas de Object no JS
-- (mapas por id no painel/rota-core/WhatsApp). Recusados aqui e no rota-core.
alter table public.rota_veiculos drop constraint if exists rota_veiculos_047_id;
alter table public.rota_veiculos add constraint rota_veiculos_047_id check (id not in ('constructor', '__proto__', 'prototype'));
alter table public.rota_veiculos drop constraint if exists rota_veiculos_047_nome;
alter table public.rota_veiculos add constraint rota_veiculos_047_nome
  check (char_length(nome) between 1 and 40 and public.texto_seguro(nome, 40));
alter table public.rota_veiculos drop constraint if exists rota_veiculos_047_capacidade;
alter table public.rota_veiculos add constraint rota_veiculos_047_capacidade
  check (capacidade_volume is null or capacidade_volume between 1 and 100000);
-- Pelo menos 1 dia com saida na semana. DOMINGO e SEMPRE dia sem saida (regra do dono; Sentinela V-BACK V3: o plano da
-- semana da 046 e a RPC so aceitam seg..sab, entao um veiculo de domingo seria planejado e nunca salvo). O gatilho poe o 0.
alter table public.rota_veiculos drop constraint if exists rota_veiculos_047_dias;
alter table public.rota_veiculos add constraint rota_veiculos_047_dias
  check (cardinality(dias_sem_saida) <= 6 and array_position(dias_sem_saida, null) is null
         and dias_sem_saida <@ array[0,1,2,3,4,5,6]::smallint[] and 0 = any (dias_sem_saida));
alter table public.rota_veiculos drop constraint if exists rota_veiculos_047_cor;
alter table public.rota_veiculos add constraint rota_veiculos_047_cor check (cor ~ '^#[0-9a-f]{6}$');
alter table public.rota_veiculos drop constraint if exists rota_veiculos_047_ordem;
alter table public.rota_veiculos add constraint rota_veiculos_047_ordem check (ordem between 0 and 999);

-- Normaliza (nome sem espacos sobrando; cor em minusculas; dias sem repeticao e em ordem), id imutavel, carimbo.
create or replace function public.rota_047_veiculo_normalizar()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception 'o id do veiculo nao muda (crie outro e desative este)' using errcode = '22023';
  end if;
  new.nome := btrim(regexp_replace(coalesce(new.nome, ''), '\s+', ' ', 'g'));
  new.cor := lower(btrim(coalesce(new.cor, '')));
  -- domingo sempre sem saida (o painel nem oferece); repetidos fora, em ordem
  new.dias_sem_saida := coalesce((select array_agg(distinct d order by d) from unnest(coalesce(new.dias_sem_saida, '{}') || array[0]::smallint[]) as t(d)), '{0}');
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;
revoke all on function public.rota_047_veiculo_normalizar() from public, anon, authenticated;

drop trigger if exists rota_047_veiculo_normalizar on public.rota_veiculos;
create trigger rota_047_veiculo_normalizar before insert or update on public.rota_veiculos
  for each row execute function public.rota_047_veiculo_normalizar();

-- Seeds (nao sobrescreve). S10 herda a volta para a sede da 040.
insert into public.rota_veiculos (id, nome, modo, capacidade_volume, dias_sem_saida, volta_sede, cor, ordem)
values ('caminhao', 'Caminhão (CEASA)', 'cd_ceasa', null, '{0}', false, '#b45309', 10),
       ('s10', 'S10', 'porta', 2700, '{0,6}', coalesce((select c.s10_volta_sede from public.rota_config c where c.id = 1), false), '#2563eb', 20),
       ('strada', 'Strada', 'porta', null, '{0,6}', false, '#059669', 30)
on conflict (id) do nothing;

-- ===================== (3) rota_motoristas (antes das politicas que dependem dela) =====================
create table if not exists public.rota_motoristas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  veiculo_id text not null references public.rota_veiculos(id) on update restrict on delete restrict,
  nome text,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
alter table public.rota_motoristas drop constraint if exists rota_motoristas_047_nome;
alter table public.rota_motoristas add constraint rota_motoristas_047_nome
  check (nome is null or (char_length(nome) between 1 and 60 and public.texto_seguro(nome, 60)));
create index if not exists rota_motoristas_047_veiculo_idx on public.rota_motoristas (veiculo_id);

drop trigger if exists rota_047_motorista_carimbar on public.rota_motoristas;
create trigger rota_047_motorista_carimbar before insert or update on public.rota_motoristas
  for each row execute function public.rota_040_veiculo_carimbar();

-- Veiculo do motorista logado (NULL = nao e motorista ativo). INVOKER: le a propria linha (politica abaixo).
create or replace function public.rota_047_veiculo_motorista()
returns text
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select m.veiculo_id from public.rota_motoristas m
   where m.user_id = auth.uid() and m.ativo;
$$;
revoke all on function public.rota_047_veiculo_motorista() from public, anon;
grant execute on function public.rota_047_veiculo_motorista() to authenticated;

alter table public.rota_motoristas enable row level security;
revoke all on public.rota_motoristas from public, anon, authenticated;
grant select, insert, update, delete on public.rota_motoristas to authenticated;

drop policy if exists rota_047_equipe_le on public.rota_motoristas;
create policy rota_047_equipe_le on public.rota_motoristas for select to authenticated
  using ((select public.eh_equipe()));
drop policy if exists rota_047_motorista_le on public.rota_motoristas;
create policy rota_047_motorista_le on public.rota_motoristas for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists rota_047_admin_insere on public.rota_motoristas;
create policy rota_047_admin_insere on public.rota_motoristas for insert to authenticated
  with check ((select public.eh_admin()));
drop policy if exists rota_047_admin_atualiza on public.rota_motoristas;
create policy rota_047_admin_atualiza on public.rota_motoristas for update to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));
drop policy if exists rota_047_admin_apaga on public.rota_motoristas;
create policy rota_047_admin_apaga on public.rota_motoristas for delete to authenticated
  using ((select public.eh_admin()));

-- ===================== RLS de rota_veiculos =====================
alter table public.rota_veiculos enable row level security;
revoke all on public.rota_veiculos from public, anon, authenticated;
grant select, insert, update, delete on public.rota_veiculos to authenticated;

drop policy if exists rota_047_equipe_le on public.rota_veiculos;
create policy rota_047_equipe_le on public.rota_veiculos for select to authenticated
  using ((select public.eh_equipe()));
drop policy if exists rota_047_motorista_le on public.rota_veiculos;
create policy rota_047_motorista_le on public.rota_veiculos for select to authenticated
  using (id = (select public.rota_047_veiculo_motorista()));
drop policy if exists rota_047_admin_insere on public.rota_veiculos;
create policy rota_047_admin_insere on public.rota_veiculos for insert to authenticated
  with check ((select public.eh_admin()));
drop policy if exists rota_047_admin_atualiza on public.rota_veiculos;
create policy rota_047_admin_atualiza on public.rota_veiculos for update to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));
drop policy if exists rota_047_admin_apaga on public.rota_veiculos;
create policy rota_047_admin_apaga on public.rota_veiculos for delete to authenticated
  using ((select public.eh_admin()));

-- ===================== (2) CHECK fixo -> FK =====================
-- Tira o CHECK antigo ('caminhao','s10') das colunas de veiculo (nome gerado pelo Postgres: procura pela definicao).
do $$
declare r record;
begin
  for r in select c.conrelid::regclass as tabela, c.conname
             from pg_catalog.pg_constraint c
            where c.contype = 'c'
              and c.conrelid in ('public.rota_cliente_veiculo'::regclass, 'public.rota_pedido_veiculo'::regclass)
              and pg_catalog.pg_get_constraintdef(c.oid) like '%caminhao%'
              and pg_catalog.pg_get_constraintdef(c.oid) like '%s10%' loop
    execute format('alter table %s drop constraint %I', r.tabela, r.conname);
  end loop;
end;
$$;

alter table public.rota_plano_semana add column if not exists veiculo_id text not null default 's10';

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'rota_cliente_veiculo_047_veiculo_fk'
                    and conrelid = 'public.rota_cliente_veiculo'::regclass) then
    alter table public.rota_cliente_veiculo add constraint rota_cliente_veiculo_047_veiculo_fk
      foreign key (veiculo) references public.rota_veiculos(id) on update restrict on delete restrict;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'rota_pedido_veiculo_047_veiculo_fk'
                    and conrelid = 'public.rota_pedido_veiculo'::regclass) then
    alter table public.rota_pedido_veiculo add constraint rota_pedido_veiculo_047_veiculo_fk
      foreign key (veiculo) references public.rota_veiculos(id) on update restrict on delete restrict;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'rota_plano_semana_047_veiculo_fk'
                    and conrelid = 'public.rota_plano_semana'::regclass) then
    alter table public.rota_plano_semana add constraint rota_plano_semana_047_veiculo_fk
      foreign key (veiculo_id) references public.rota_veiculos(id) on update restrict on delete restrict;
  end if;
end;
$$;
-- Indices das FKs (o RESTRICT de rota_veiculos confere por eles).
create index if not exists rota_cliente_veiculo_047_veiculo_idx on public.rota_cliente_veiculo (veiculo);
create index if not exists rota_pedido_veiculo_047_veiculo_idx on public.rota_pedido_veiculo (veiculo);
create index if not exists rota_plano_semana_047_veiculo_dia_idx on public.rota_plano_semana (veiculo_id, dia);

-- rota_044_marcar: mesma regra da 044; o veiculo agora e qualquer um ATIVO de rota_veiculos.
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
  if p_cd_pedido is null or coalesce(p_escopo, '') not in ('pedido', 'sempre')
     or (p_veiculo is not null and not exists (select 1 from public.rota_veiculos v where v.id = p_veiculo and v.ativo)) then
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

-- Plano da semana de UM veiculo porta-a-porta (mesma regra da 046, agora por veiculo): apaga o que estava salvo
-- para ESTE veiculo nos dias da semana e grava a lista nova; pedido salvo em outro veiculo/semana passa para este.
-- Cada dia: p_inicio .. p_inicio + 5 e dia em que o veiculo sai (dias_sem_saida). Erros: 42501, 22023, P0002.
create or replace function public.rota_047_salvar_semana(p_inicio date, p_veiculo text, p_itens jsonb)
returns integer
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_n integer;
  v_falta bigint;
  v_dias smallint[];
begin
  if not public.pode_marcar_rota() then
    raise exception 'sem permissao para salvar o plano' using errcode = '42501';
  end if;
  -- Trava comum das gravacoes do plano (a mesma da 046), ANTES de ler/apagar a semana.
  perform pg_catalog.pg_advisory_xact_lock(5100, 4601);
  select v.dias_sem_saida into v_dias from public.rota_veiculos v where v.id = p_veiculo and v.ativo and v.modo = 'porta';
  if not found or p_inicio is null or extract(isodow from p_inicio) <> 1 or p_itens is null
     or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 3000 then
    raise exception 'parametro invalido' using errcode = '22023';
  end if;
  begin
    select count(*) filter (where i.cd_pedido is null or i.dia is null or i.dia < p_inicio or i.dia > p_inicio + 5
                                  or extract(dow from i.dia)::smallint = any (v_dias)),
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
  delete from public.rota_plano_semana where veiculo_id = p_veiculo and dia between p_inicio and p_inicio + 5;
  insert into public.rota_plano_semana as r (cd_pedido, dia, veiculo_id)
    select i.cd_pedido, i.dia, p_veiculo from jsonb_to_recordset(p_itens) as i(cd_pedido bigint, dia date)
    on conflict (cd_pedido) do update set dia = excluded.dia, veiculo_id = excluded.veiculo_id;
  select count(*) into v_n from public.rota_plano_semana where veiculo_id = p_veiculo and dia between p_inicio and p_inicio + 5;
  return v_n;
end;
$$;
revoke all on function public.rota_047_salvar_semana(date, text, jsonb) from public, anon;
grant execute on function public.rota_047_salvar_semana(date, text, jsonb) to authenticated;

-- A RPC da 046 continua valendo: e a semana da S10.
create or replace function public.rota_046_salvar_semana(p_inicio date, p_itens jsonb)
returns integer
language sql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select public.rota_047_salvar_semana(p_inicio, 's10', p_itens);
$$;
revoke all on function public.rota_046_salvar_semana(date, jsonb) from public, anon;
grant execute on function public.rota_046_salvar_semana(date, jsonb) to authenticated;

-- ===================== (4) rota_saida =====================
-- Formato de cada parada (objeto; so estas chaves; strings com texto_seguro):
--   ordem int 1..200 (obrigatorio, sem repeticao na lista), nome 1..150 (obrigatorio), endereco <=300, bairro <=80,
--   cidade <=80, lat -90..90, lng -180..180 (os dois ou nenhum), c24/c48/avulsos int 0..100000, volume 0..1000000,
--   pedidos [int] <=50, janela <=40, obs <=200, eta 'HH:MM', prioridade bool, cd bool,
--   itens [ {nome <=150, c24, c48, avulsos, pedidos} ] <=300 (lista de carga do CD do CEASA).
create or replace function public.rota_047_texto_ok(p jsonb, p_max integer, p_obrigatorio boolean)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p is null or jsonb_typeof(p) = 'null' then not p_obrigatorio
              when jsonb_typeof(p) <> 'string' then false
              else char_length(p #>> '{}') between (case when p_obrigatorio then 1 else 0 end) and p_max
                   and public.texto_seguro(p #>> '{}', p_max) end;
$$;
create or replace function public.rota_047_num_ok(p jsonb, p_min numeric, p_max numeric, p_inteiro boolean)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p is null or jsonb_typeof(p) = 'null' then true
              when jsonb_typeof(p) <> 'number' then false
              else (p::text)::numeric between p_min and p_max
                   and (not p_inteiro or (p::text)::numeric = trunc((p::text)::numeric)) end;
$$;
create or replace function public.rota_047_inteiros_ok(p jsonb, p_max integer)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p is null or jsonb_typeof(p) = 'null' then true
              when jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > p_max then false
              else not exists (select 1 from jsonb_array_elements(p) e(v)
                                where not public.rota_047_num_ok(e.v, 1, 999999999999, true) or jsonb_typeof(e.v) <> 'number') end;
$$;
create or replace function public.rota_047_paradas_validas(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v jsonb;
  it jsonb;
  v_ordens integer[] := '{}';
  v_chaves constant text[] := array['ordem','nome','endereco','bairro','cidade','lat','lng','c24','c48','avulsos','volume',
                                    'pedidos','janela','obs','eta','prioridade','cd','itens'];
  v_chaves_item constant text[] := array['nome','c24','c48','avulsos','pedidos'];
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 200 then return false; end if;
  for v in select e.v from jsonb_array_elements(p) e(v) loop
    if jsonb_typeof(v) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(v) k where k <> all (v_chaves)) then return false; end if;
    if jsonb_typeof(v->'ordem') is distinct from 'number' or not public.rota_047_num_ok(v->'ordem', 1, 200, true) then return false; end if;
    if (v->>'ordem')::integer = any (v_ordens) then return false; end if;
    v_ordens := v_ordens || (v->>'ordem')::integer;
    if not (public.rota_047_texto_ok(v->'nome', 150, true) and public.rota_047_texto_ok(v->'endereco', 300, false)
            and public.rota_047_texto_ok(v->'bairro', 80, false) and public.rota_047_texto_ok(v->'cidade', 80, false)
            and public.rota_047_texto_ok(v->'janela', 40, false) and public.rota_047_texto_ok(v->'obs', 200, false)
            and public.rota_047_texto_ok(v->'eta', 5, false)
            and public.rota_047_num_ok(v->'lat', -90, 90, false) and public.rota_047_num_ok(v->'lng', -180, 180, false)
            and public.rota_047_num_ok(v->'c24', 0, 100000, true) and public.rota_047_num_ok(v->'c48', 0, 100000, true)
            and public.rota_047_num_ok(v->'avulsos', 0, 100000, true) and public.rota_047_num_ok(v->'volume', 0, 1000000, false)
            and public.rota_047_inteiros_ok(v->'pedidos', 50)) then return false; end if;
    if (v ? 'lat' and jsonb_typeof(v->'lat') <> 'null') is distinct from (v ? 'lng' and jsonb_typeof(v->'lng') <> 'null') then return false; end if;
    if v ? 'eta' and jsonb_typeof(v->'eta') = 'string' and (v->>'eta') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
    if v ? 'prioridade' and jsonb_typeof(v->'prioridade') not in ('boolean', 'null') then return false; end if;
    if v ? 'cd' and jsonb_typeof(v->'cd') not in ('boolean', 'null') then return false; end if;
    if v ? 'itens' and jsonb_typeof(v->'itens') <> 'null' then
      if jsonb_typeof(v->'itens') <> 'array' or jsonb_array_length(v->'itens') > 300 then return false; end if;
      for it in select e.v from jsonb_array_elements(v->'itens') e(v) loop
        if jsonb_typeof(it) <> 'object' then return false; end if;
        if exists (select 1 from jsonb_object_keys(it) k where k <> all (v_chaves_item)) then return false; end if;
        if not (public.rota_047_texto_ok(it->'nome', 150, false) and public.rota_047_num_ok(it->'c24', 0, 100000, true)
                and public.rota_047_num_ok(it->'c48', 0, 100000, true) and public.rota_047_num_ok(it->'avulsos', 0, 100000, true)
                and public.rota_047_inteiros_ok(it->'pedidos', 50)) then return false; end if;
      end loop;
    end if;
  end loop;
  return true;
end;
$$;
-- Usadas no CHECK de rota_saida: o Postgres confere EXECUTE de quem grava (authenticated). Puras (so validam o
-- jsonb recebido, sem ler tabela): sem risco em deixar authenticated chamar. anon nao.
revoke all on function public.rota_047_texto_ok(jsonb, integer, boolean) from public, anon;
revoke all on function public.rota_047_num_ok(jsonb, numeric, numeric, boolean) from public, anon;
revoke all on function public.rota_047_inteiros_ok(jsonb, integer) from public, anon;
revoke all on function public.rota_047_paradas_validas(jsonb) from public, anon;
-- Sentinela V-BACK V1: o resumo tambem chega ao motorista -> lista FECHADA de campos (sem objeto aninhado):
--   km (0..10000), horaSaida/horaFim 'HH:MM', c24/c48/avulsos/semVolume (inteiros 0..1000000), volume (0..1000000),
--   semLimite (bool), veiculo (nome do veiculo, <= 40, texto_seguro). Qualquer outra chave (cpf, telefone, valor...) = recusa.
create or replace function public.rota_047_resumo_valido(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_chaves constant text[] := array['km','horaSaida','horaFim','c24','c48','avulsos','semVolume','volume','semLimite','veiculo'];
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k <> all (v_chaves)) then return false; end if;
  if not (public.rota_047_num_ok(p->'km', 0, 10000, false) and public.rota_047_num_ok(p->'volume', 0, 1000000, false)
          and public.rota_047_num_ok(p->'c24', 0, 1000000, true) and public.rota_047_num_ok(p->'c48', 0, 1000000, true)
          and public.rota_047_num_ok(p->'avulsos', 0, 1000000, true) and public.rota_047_num_ok(p->'semVolume', 0, 1000000, true)
          and public.rota_047_texto_ok(p->'veiculo', 40, false)
          and public.rota_047_texto_ok(p->'horaSaida', 5, false) and public.rota_047_texto_ok(p->'horaFim', 5, false)) then return false; end if;
  if p ? 'horaSaida' and jsonb_typeof(p->'horaSaida') = 'string' and (p->>'horaSaida') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
  if p ? 'horaFim' and jsonb_typeof(p->'horaFim') = 'string' and (p->>'horaFim') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
  if p ? 'semLimite' and jsonb_typeof(p->'semLimite') not in ('boolean', 'null') then return false; end if;
  return true;
end;
$$;
revoke all on function public.rota_047_resumo_valido(jsonb) from public, anon;
grant execute on function public.rota_047_resumo_valido(jsonb) to authenticated;
grant execute on function public.rota_047_texto_ok(jsonb, integer, boolean) to authenticated;
grant execute on function public.rota_047_num_ok(jsonb, numeric, numeric, boolean) to authenticated;
grant execute on function public.rota_047_inteiros_ok(jsonb, integer) to authenticated;
grant execute on function public.rota_047_paradas_validas(jsonb) to authenticated;

create table if not exists public.rota_saida (
  data date not null,
  veiculo_id text not null references public.rota_veiculos(id) on update restrict on delete restrict,
  versao integer not null default 1,
  paradas jsonb not null default '[]',
  resumo jsonb not null default '{}',
  publicado_em timestamptz not null default now(),
  publicado_por uuid,
  primary key (data, veiculo_id)
);
alter table public.rota_saida drop constraint if exists rota_saida_047_data;
alter table public.rota_saida add constraint rota_saida_047_data check (data between date '2020-01-01' and date '2100-12-31');
alter table public.rota_saida drop constraint if exists rota_saida_047_versao;
alter table public.rota_saida add constraint rota_saida_047_versao check (versao between 1 and 100000);
-- Tamanho: ate 256 KB de paradas e 8 KB de resumo (objeto).
alter table public.rota_saida drop constraint if exists rota_saida_047_paradas;
alter table public.rota_saida add constraint rota_saida_047_paradas
  check (pg_catalog.pg_column_size(paradas) <= 262144 and public.rota_047_paradas_validas(paradas));
alter table public.rota_saida drop constraint if exists rota_saida_047_resumo;
alter table public.rota_saida add constraint rota_saida_047_resumo
  check (pg_catalog.pg_column_size(resumo) <= 8192 and public.rota_047_resumo_valido(resumo));
create index if not exists rota_saida_047_veiculo_data_idx on public.rota_saida (veiculo_id, data);

-- Publicar: data de hoje (Sao Paulo) ate +14 dias, veiculo ATIVO; versao sobe a cada publicacao; carimbo.
-- INVOKER: le rota_veiculos pela politica da equipe (quem publica e da equipe).
create or replace function public.rota_047_saida_publicar()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if tg_op = 'UPDATE' and (new.data is distinct from old.data or new.veiculo_id is distinct from old.veiculo_id) then
    raise exception 'data/veiculo da rota publicada nao mudam' using errcode = '22023';
  end if;
  if new.data < v_hoje or new.data > v_hoje + 14 then
    raise exception 'data fora de hoje..+14 dias' using errcode = '22023';
  end if;
  if not exists (select 1 from public.rota_veiculos v where v.id = new.veiculo_id and v.ativo) then
    raise exception 'veiculo inativo ou inexistente' using errcode = '22023';
  end if;
  new.versao := case when tg_op = 'UPDATE' then old.versao + 1 else 1 end;
  new.publicado_em := now();
  new.publicado_por := auth.uid();
  return new;
end;
$$;
revoke all on function public.rota_047_saida_publicar() from public, anon, authenticated;

drop trigger if exists rota_047_saida_publicar on public.rota_saida;
create trigger rota_047_saida_publicar before insert or update on public.rota_saida
  for each row execute function public.rota_047_saida_publicar();

alter table public.rota_saida enable row level security;
revoke all on public.rota_saida from public, anon, authenticated;
grant select, insert, update, delete on public.rota_saida to authenticated;

drop policy if exists rota_047_equipe_le on public.rota_saida;
create policy rota_047_equipe_le on public.rota_saida for select to authenticated
  using ((select public.eh_equipe()));
drop policy if exists rota_047_motorista_le on public.rota_saida;
create policy rota_047_motorista_le on public.rota_saida for select to authenticated
  using (veiculo_id = (select public.rota_047_veiculo_motorista())
         and data between (select (now() at time zone 'America/Sao_Paulo')::date)
                      and (select (now() at time zone 'America/Sao_Paulo')::date + 1));
drop policy if exists rota_047_marca_insere on public.rota_saida;
create policy rota_047_marca_insere on public.rota_saida for insert to authenticated
  with check ((select public.pode_marcar_rota()));
drop policy if exists rota_047_marca_atualiza on public.rota_saida;
create policy rota_047_marca_atualiza on public.rota_saida for update to authenticated
  using ((select public.pode_marcar_rota())) with check ((select public.pode_marcar_rota()));
drop policy if exists rota_047_marca_apaga on public.rota_saida;
create policy rota_047_marca_apaga on public.rota_saida for delete to authenticated
  using ((select public.pode_marcar_rota()));

-- ===================== (5) WhatsApp: rota de qualquer veiculo =====================
-- A Edge Function (whatsapp-core.js, ainda NAO publicada com isto) entende rota_<id do veiculo>. Papel x rotina da 042:
-- TODA rotina rota_* e de 'entregador' ou 'gestor' (antes so rota_s10/rota_caminhao; uma rota_strada criada sem esta
-- troca nao teria conferencia de papel). Mesma regra no envio (whatsapp-core.js PAPEIS / papelPermitido).
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
-- Rotina da Strada: DESLIGADA e em simulacao (o dono liga no painel). Seg a sex, como o veiculo.
insert into public.whatsapp_rotinas (codigo, descricao, horario, dias, template)
values ('rota_strada', 'Rota do dia da Strada (paradas em ordem + mapa)', '06:00', '{seg,ter,qua,qui,sex}', 'rota_do_dia')
on conflict (codigo) do nothing;

-- ===================== limpeza =====================
create or replace function public.rota_047_limpar()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare v_n integer;
begin
  delete from public.rota_saida where data < (now() at time zone 'America/Sao_Paulo')::date - 30;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.rota_047_limpar() from public, anon, authenticated;
grant execute on function public.rota_047_limpar() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $j$select cron.unschedule(jobid) from cron.job where jobname = 'rota-limpeza-saida'$j$;
    execute $j$select cron.schedule('rota-limpeza-saida', '37 6 * * *', 'select public.rota_047_limpar()')$j$;
  else
    raise notice '047: pg_cron nao instalado: limpeza diaria de rota_saida NAO agendada (rode select public.rota_047_limpar() de vez em quando).';
  end if;
end;
$$;

commit;
