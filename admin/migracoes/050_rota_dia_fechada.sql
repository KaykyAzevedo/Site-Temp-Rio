-- 050: Rotas — a rota do dia vira PREVISAO SALVA ("fechada") + ajustes do Marcio (Remover de hoje / Trazer para hoje).
-- NAO APLICADA. Idempotente. Requer 014 (eh_admin/eh_equipe), 035 (solidcon_pedidos_erp), 045 (rota_pedido_ignorado), 040/044 (rota_config com
-- hora_saida, pode_marcar_rota) e 047 (rota_veiculos, rota_saida). Nao depende da 048/049. Rollback: 050_rollback.sql.
--
-- Pedido do dono (2026-11-23): o calculo e uma PREVISAO; montada a rota do dia, ela fica SALVA pelo dia (pedido novo
-- vai para o proximo dia com saida); de manha o Marcio pode adicionar/remover clientes (excecoes).
--
-- (1) rota_dia_fechada (1 linha por dia de Sao Paulo): estado 'fechada' | 'reaberta', automatico, versao (sobe a cada
--     fechamento), fechada_em/por/nome, alterada_em (ultimo ajuste), reaberta_em/por/nome.
-- (2) rota_dia_item (data, cd_pedido): a foto. veiculo_id (FK rota_veiculos), documento (copiado do ERP no servidor),
--     ordem (1..n na rota do veiculo; NULL = recalcular o veiculo), origem 'previsao' | 'adicionado',
--     incluido_em/por, removido_em/por/nome ("Remover de hoje": continua aqui marcado, o pedido vai para o proximo dia).
--     Sem FK para solidcon_pedidos_erp (a coleta apaga e reinsere todos os pedidos; mesmo motivo da 044/045).
-- (3) rota_dia_log: auditoria curta (fechar, fechar_auto, adicionar, remover, reabrir; quem, quando, detalhe <= 200).
-- (4) RPCs SECURITY DEFINER, search_path = '' (a foto so muda por elas; nenhuma politica de escrita):
--     rota_050_fechar(p_itens)       quem pode_marcar_rota(): fecha HOJE com a previsao montada no painel.
--     rota_050_fechar_auto(p_itens)  SO service_role (Edge Function whatsapp-rotinas, no tique do pg_cron da 042):
--                                    fecha HOJE se ninguem fechou/reabriu e ja passou rota_config.hora_saida.
--     rota_050_ajustar(p_acao, p_cds, p_veiculo, p_ordem)  pode_marcar_rota(): 'remover' (Remover de hoje) ou
--                                    'adicionar' (Trazer para hoje, so pedido EM ABERTO fora da foto), e grava a ordem
--                                    nova SO do veiculo afetado (p_ordem cobre exatamente os pedidos dele).
--     rota_050_reabrir()             SO eh_admin(): desfaz o fechamento (apaga a foto; o fechamento automatico NAO
--                                    fecha de novo um dia reaberto).
--     Todas sob pg_advisory_xact_lock(5100, 5001): um ajuste por vez, nunca 2 fechamentos.
--     "Tirar da rota" (045, atraso de boleto) NAO e mexido aqui: continua valendo antes da foto ate "Voltar para a rota".
-- (5) RLS: leitura eh_equipe(); anon nada; authenticated so SELECT. Limpeza: dias com mais de 60 dias, log > 180.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('public.eh_equipe()') is null or to_regprocedure('public.eh_admin()') is null
     or to_regprocedure('public.pode_marcar_rota()') is null
     or to_regclass('public.solidcon_pedidos_erp') is null
     or to_regclass('public.rota_veiculos') is null or to_regclass('public.rota_saida') is null
     or to_regclass('public.rota_pedido_ignorado') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rota_config' and column_name = 'hora_saida') then
    raise exception '050 requer 014, 035, 044 (pode_marcar_rota, rota_config.hora_saida), 045 (rota_pedido_ignorado) e 047 (rota_veiculos, rota_saida). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 50);

-- ===================== (1) cabecalho =====================
create table if not exists public.rota_dia_fechada (
  data date primary key,
  estado text not null default 'fechada' check (estado in ('fechada', 'reaberta')),
  automatico boolean not null default false,
  versao integer not null default 1 check (versao between 1 and 1000),
  fechada_em timestamptz not null default now(),
  fechada_por uuid,
  fechada_nome text check (fechada_nome is null or char_length(fechada_nome) <= 60),
  alterada_em timestamptz,
  reaberta_em timestamptz,
  reaberta_por uuid,
  reaberta_nome text check (reaberta_nome is null or char_length(reaberta_nome) <= 60),
  -- Sentinela RF-1/RF-2: sobe em TODA mudança da foto (fechar, ajustar, reabrir). Quem leu antes compara e relê.
  revisao integer not null default 1 check (revisao between 1 and 1000000)
);
alter table public.rota_dia_fechada add column if not exists revisao integer not null default 1;

-- ===================== (2) itens (a foto) =====================
create table if not exists public.rota_dia_item (
  data date not null references public.rota_dia_fechada(data) on delete cascade,
  cd_pedido bigint not null check (cd_pedido between 1 and 999999999999),
  documento text check (documento is null or documento ~ '^[0-9]{14}$'),
  veiculo_id text not null references public.rota_veiculos(id) on update restrict on delete restrict,
  ordem integer check (ordem is null or ordem between 1 and 100000),
  origem text not null default 'previsao' check (origem in ('previsao', 'adicionado')),
  incluido_em timestamptz not null default now(),
  incluido_por uuid,
  removido_em timestamptz,
  removido_por uuid,
  removido_nome text check (removido_nome is null or char_length(removido_nome) <= 60),
  primary key (data, cd_pedido)
);
create index if not exists rota_dia_item_veiculo_idx on public.rota_dia_item(veiculo_id);

-- ===================== (3) log =====================
create table if not exists public.rota_dia_log (
  id bigint generated always as identity primary key,
  data date not null,
  acao text not null check (acao in ('fechar', 'fechar_auto', 'adicionar', 'remover', 'reabrir')),
  detalhe text check (detalhe is null or char_length(detalhe) <= 200),
  por uuid,
  por_nome text check (por_nome is null or char_length(por_nome) <= 60),
  em timestamptz not null default now()
);
create index if not exists rota_dia_log_data_idx on public.rota_dia_log(data, em);

-- ===================== RLS e grants =====================
alter table public.rota_dia_fechada enable row level security;
alter table public.rota_dia_item enable row level security;
alter table public.rota_dia_log enable row level security;
revoke all on public.rota_dia_fechada, public.rota_dia_item, public.rota_dia_log from public, anon, authenticated;
grant select on public.rota_dia_fechada, public.rota_dia_item, public.rota_dia_log to authenticated;
grant select on public.rota_dia_fechada, public.rota_dia_item, public.rota_dia_log to service_role;
drop policy if exists rota_050_fechada_le on public.rota_dia_fechada;
create policy rota_050_fechada_le on public.rota_dia_fechada for select to authenticated using ((select public.eh_equipe()));
drop policy if exists rota_050_item_le on public.rota_dia_item;
create policy rota_050_item_le on public.rota_dia_item for select to authenticated using ((select public.eh_equipe()));
drop policy if exists rota_050_log_le on public.rota_dia_log;
create policy rota_050_log_le on public.rota_dia_log for select to authenticated using ((select public.eh_equipe()));

-- ===================== (4) funcoes internas (sem grant) =====================
-- Hoje em Sao Paulo.
create or replace function public.rota_050_hoje()
returns date
language sql
stable
set search_path = ''
as $$ select (pg_catalog.now() at time zone 'America/Sao_Paulo')::date $$;
revoke all on function public.rota_050_hoje() from public, anon, authenticated;

-- Nome curto de quem fez (Usuarios/048 guarda o nome no app_metadata; senao, o comeco do e-mail). So exibicao.
create or replace function public.rota_050_nome(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(nullif(pg_catalog.btrim(u.raw_app_meta_data ->> 'nome'), ''),
                         pg_catalog.split_part(u.email, '@', 1)), '[<>\s]+', ' ', 'g')), 60)
    from auth.users u where u.id = p_uid
$$;
revoke all on function public.rota_050_nome(uuid) from public, anon, authenticated;

-- Valida a lista [{cd_pedido, veiculo_id, ordem}] e grava a foto de p_data (que ja tem o cabecalho). Pedido precisa
-- estar EM ABERTO no ERP; veiculo ATIVO; sem repetir pedido.
create or replace function public.rota_050_gravar_itens(p_data date, p_itens jsonb, p_uid uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  if p_itens is null or pg_catalog.jsonb_typeof(p_itens) <> 'array' or pg_catalog.jsonb_array_length(p_itens) > 3000 then
    raise exception 'lista de pedidos invalida' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e
              where pg_catalog.jsonb_typeof(e) <> 'object'
                 or pg_catalog.jsonb_typeof(e -> 'cd_pedido') <> 'number'
                 or pg_catalog.jsonb_typeof(e -> 'veiculo_id') <> 'string'
                 or (e ? 'ordem' and pg_catalog.jsonb_typeof(e -> 'ordem') not in ('number', 'null'))) then
    raise exception 'item invalido na lista de pedidos' using errcode = '22023';
  end if;
  -- sem tabela temporaria (funcao DEFINER): a lista e relida do jsonb em cada conferencia
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e
              where (e ->> 'cd_pedido')::numeric not between 1 and 999999999999
                 or (e ->> 'cd_pedido')::numeric <> pg_catalog.trunc((e ->> 'cd_pedido')::numeric)
                 or (e ->> 'ordem') is not null and ((e ->> 'ordem')::numeric not between 1 and 100000
                                                     or (e ->> 'ordem')::numeric <> pg_catalog.trunc((e ->> 'ordem')::numeric))) then
    raise exception 'item invalido na lista de pedidos' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e group by (e ->> 'cd_pedido')::bigint having count(*) > 1) then
    raise exception 'pedido repetido na lista' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e
              where not exists (select 1 from public.rota_veiculos v where v.id = e ->> 'veiculo_id' and v.ativo)) then
    raise exception 'veiculo desativado ou inexistente' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_itens) e where not exists (
        select 1 from public.solidcon_pedidos_erp p
         where p.cd_pedido = (e ->> 'cd_pedido')::bigint and p.etapa in ('aberto', 'na_carga', 'separando', 'separado', 'conferido'))) then
    raise exception 'pedido nao esta em aberto no ERP' using errcode = 'P0002';
  end if;
  insert into public.rota_dia_item (data, cd_pedido, documento, veiculo_id, ordem, origem, incluido_por)
  select p_data, p.cd_pedido, p.documento, e ->> 'veiculo_id', (e ->> 'ordem')::integer, 'previsao', p_uid
    from pg_catalog.jsonb_array_elements(p_itens) e
    join public.solidcon_pedidos_erp p on p.cd_pedido = (e ->> 'cd_pedido')::bigint;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.rota_050_gravar_itens(date, jsonb, uuid) from public, anon, authenticated;

-- Fecha HOJE (interna). p_auto: fechamento automatico (sem usuario). Devolve o cabecalho como jsonb.
create or replace function public.rota_050_fechar_hoje(p_itens jsonb, p_uid uuid, p_auto boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.rota_050_hoje();
  v_atual public.rota_dia_fechada;
  v_nome text := case when p_uid is null then null else public.rota_050_nome(p_uid) end;
  v_n integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(5100, 5001);
  if extract(dow from v_hoje) = 0 then
    raise exception 'domingo: sem saida' using errcode = '22023';
  end if;
  select * into v_atual from public.rota_dia_fechada where data = v_hoje for update;
  if found and v_atual.estado = 'fechada' then
    raise exception 'a rota de hoje ja esta fechada' using errcode = '23505';
  end if;
  if found then   -- reaberta: fecha de novo (versao + 1)
    delete from public.rota_dia_item where data = v_hoje;
    update public.rota_dia_fechada
       set estado = 'fechada', automatico = p_auto, versao = v_atual.versao + 1, revisao = v_atual.revisao + 1, fechada_em = pg_catalog.now(),
           fechada_por = p_uid, fechada_nome = v_nome, alterada_em = null
     where data = v_hoje;
  else
    insert into public.rota_dia_fechada (data, estado, automatico, fechada_por, fechada_nome)
    values (v_hoje, 'fechada', p_auto, p_uid, v_nome);
  end if;
  v_n := public.rota_050_gravar_itens(v_hoje, p_itens, p_uid);
  insert into public.rota_dia_log (data, acao, detalhe, por, por_nome)
  values (v_hoje, case when p_auto then 'fechar_auto' else 'fechar' end, v_n || ' pedido(s)', p_uid, v_nome);
  return (select pg_catalog.to_jsonb(f) from public.rota_dia_fechada f where f.data = v_hoje);
end;
$$;
revoke all on function public.rota_050_fechar_hoje(jsonb, uuid, boolean) from public, anon, authenticated;

-- ===================== (4) RPCs =====================
create or replace function public.rota_050_fechar(p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.pode_marcar_rota(), false) then
    raise exception 'sem permissao para fechar a rota' using errcode = '42501';
  end if;
  return public.rota_050_fechar_hoje(p_itens, auth.uid(), false);
end;
$$;
revoke all on function public.rota_050_fechar(jsonb) from public, anon;
grant execute on function public.rota_050_fechar(jsonb) to authenticated;

-- Automatico: SO service_role. Idempotente: dia que ja tem linha (fechada OU reaberta pelo admin) nao e tocado; antes
-- de rota_config.hora_saida (Sao Paulo) nao fecha; domingo nao fecha. Devolve {fechou, motivo?, rota?}.
create or replace function public.rota_050_fechar_auto(p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.rota_050_hoje();
  v_saida time;
begin
  perform pg_catalog.pg_advisory_xact_lock(5100, 5001);
  if exists (select 1 from public.rota_dia_fechada where data = v_hoje) then
    return pg_catalog.jsonb_build_object('fechou', false, 'motivo', 'ja_tem');
  end if;
  if extract(dow from v_hoje) = 0 then
    return pg_catalog.jsonb_build_object('fechou', false, 'motivo', 'sem_saida');
  end if;
  select c.hora_saida into v_saida from public.rota_config c where c.id = 1;
  if (pg_catalog.now() at time zone 'America/Sao_Paulo')::time < coalesce(v_saida, '08:00'::time) then
    return pg_catalog.jsonb_build_object('fechou', false, 'motivo', 'antes_da_hora');
  end if;
  return pg_catalog.jsonb_build_object('fechou', true, 'rota', public.rota_050_fechar_hoje(p_itens, null, true));
end;
$$;
revoke all on function public.rota_050_fechar_auto(jsonb) from public, anon, authenticated;
grant execute on function public.rota_050_fechar_auto(jsonb) to service_role;

-- Ajuste na rota FECHADA de hoje.
--   'remover' (Remover de hoje): p_cds = pedidos ATIVOS da foto; precisa trazer TODOS os pedidos ativos de hoje de cada
--     cliente (documento) envolvido, em qualquer veiculo (Sentinela RF-3: o cliente sai inteiro de hoje). p_veiculo e
--     ignorado. Os pedidos voltam no proximo dia (a linha fica marcada com quem/quando).
--   'adicionar' (Trazer para hoje): p_cds = pedidos EM ABERTO fora da foto; entram em p_veiculo ATIVO.
-- p_ordem = [{cd_pedido, ordem}] cobrindo EXATAMENTE os pedidos ativos dos veiculos AFETADOS depois do ajuste (os
-- veiculos dos removidos, ou p_veiculo); a ordem dos outros veiculos nao muda. revisao + 1.
create or replace function public.rota_050_ajustar(p_acao text, p_cds bigint[], p_veiculo text, p_ordem jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.rota_050_hoje();
  v_uid uuid := auth.uid();
  v_nome text;
  v_n integer;
  v_veics text[];
begin
  if not coalesce(public.pode_marcar_rota(), false) then
    raise exception 'sem permissao para ajustar a rota' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(5100, 5001);
  if p_acao is null or p_acao not in ('remover', 'adicionar') or p_cds is null or pg_catalog.cardinality(p_cds) not between 1 and 300
     or (p_acao = 'adicionar' and p_veiculo is null) then
    raise exception 'ajuste invalido' using errcode = '22023';
  end if;
  if not exists (select 1 from public.rota_dia_fechada where data = v_hoje and estado = 'fechada') then
    raise exception 'a rota de hoje nao esta fechada' using errcode = 'P0002';
  end if;
  v_nome := public.rota_050_nome(v_uid);
  if p_acao = 'remover' then
    if (select count(*) from public.rota_dia_item i where i.data = v_hoje and i.cd_pedido = any (p_cds) and i.removido_em is null)
       <> (select count(distinct x) from pg_catalog.unnest(p_cds) x) then
      raise exception 'pedido nao esta na rota de hoje' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.rota_dia_item i
                where i.data = v_hoje and i.removido_em is null and i.documento is not null and i.cd_pedido <> all (p_cds)
                  and i.documento in (select j.documento from public.rota_dia_item j where j.data = v_hoje and j.cd_pedido = any (p_cds))) then
      raise exception 'remover de hoje precisa levar todos os pedidos do cliente (atualize a aba)' using errcode = '22023';
    end if;
    select pg_catalog.array_agg(distinct i.veiculo_id) into v_veics from public.rota_dia_item i where i.data = v_hoje and i.cd_pedido = any (p_cds);
    update public.rota_dia_item set removido_em = pg_catalog.now(), removido_por = v_uid, removido_nome = v_nome, ordem = null
     where data = v_hoje and cd_pedido = any (p_cds);
  else
    if not exists (select 1 from public.rota_veiculos v where v.id = p_veiculo and v.ativo) then
      raise exception 'veiculo desativado ou inexistente' using errcode = '22023';
    end if;
    if exists (select 1 from public.rota_dia_item i where i.data = v_hoje and i.cd_pedido = any (p_cds) and i.removido_em is null) then
      raise exception 'pedido ja esta na rota de hoje' using errcode = '23505';
    end if;
    if (select count(*) from public.solidcon_pedidos_erp p where p.cd_pedido = any (p_cds)
           and p.etapa in ('aberto', 'na_carga', 'separando', 'separado', 'conferido')) <> (select count(distinct x) from pg_catalog.unnest(p_cds) x) then
      raise exception 'pedido nao esta em aberto no ERP' using errcode = 'P0002';
    end if;
    v_veics := array[p_veiculo];
    insert into public.rota_dia_item (data, cd_pedido, documento, veiculo_id, ordem, origem, incluido_por)
    select v_hoje, p.cd_pedido, p.documento, p_veiculo, null, 'adicionado', v_uid
      from public.solidcon_pedidos_erp p where p.cd_pedido = any (p_cds)
    on conflict (data, cd_pedido) do update
      set veiculo_id = excluded.veiculo_id, ordem = null, origem = 'adicionado', incluido_em = pg_catalog.now(),
          incluido_por = excluded.incluido_por, removido_em = null, removido_por = null, removido_nome = null, documento = excluded.documento;
  end if;
  -- ordem nova SO dos veiculos afetados: tem de cobrir exatamente os pedidos ativos deles
  if p_ordem is null or pg_catalog.jsonb_typeof(p_ordem) <> 'array' then
    raise exception 'ordem invalida' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_ordem) e
              where pg_catalog.jsonb_typeof(e -> 'cd_pedido') <> 'number' or pg_catalog.jsonb_typeof(e -> 'ordem') <> 'number'
                 or (e ->> 'ordem')::numeric not between 1 and 100000) then
    raise exception 'ordem invalida' using errcode = '22023';
  end if;
  if (select pg_catalog.array_agg(x order by x) from (select (e ->> 'cd_pedido')::bigint x from pg_catalog.jsonb_array_elements(p_ordem) e) s)
     is distinct from
     (select pg_catalog.array_agg(i.cd_pedido order by i.cd_pedido) from public.rota_dia_item i
       where i.data = v_hoje and i.veiculo_id = any (v_veics) and i.removido_em is null) then
    raise exception 'a ordem nao confere com os pedidos do veiculo (atualize a aba)' using errcode = '22023';
  end if;
  update public.rota_dia_item i set ordem = (e ->> 'ordem')::integer
    from pg_catalog.jsonb_array_elements(p_ordem) e
   where i.data = v_hoje and i.cd_pedido = (e ->> 'cd_pedido')::bigint;
  update public.rota_dia_fechada set alterada_em = pg_catalog.now(), revisao = revisao + 1 where data = v_hoje;
  v_n := pg_catalog.cardinality(p_cds);
  insert into public.rota_dia_log (data, acao, detalhe, por, por_nome)
  values (v_hoje, p_acao::text, pg_catalog.left(v_n || ' pedido(s), veiculo(s) ' || pg_catalog.array_to_string(v_veics, ',') || ': ' || pg_catalog.array_to_string(p_cds[1:20], ','), 200), v_uid, v_nome);
  return (select pg_catalog.to_jsonb(f) from public.rota_dia_fechada f where f.data = v_hoje);
end;
$$;
revoke all on function public.rota_050_ajustar(text, bigint[], text, jsonb) from public, anon;
grant execute on function public.rota_050_ajustar(text, bigint[], text, jsonb) to authenticated;

-- Reabrir (desfazer o fechamento de hoje): SO admin. Apaga a foto; a linha fica 'reaberta' (o automatico nao fecha
-- de novo; quem pode marcar fecha de novo pelo botao, versao + 1).
create or replace function public.rota_050_reabrir()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.rota_050_hoje();
  v_uid uuid := auth.uid();
  v_nome text;
begin
  if not coalesce(public.eh_admin(), false) then
    raise exception 'so o administrador reabre a rota' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(5100, 5001);
  if not exists (select 1 from public.rota_dia_fechada where data = v_hoje and estado = 'fechada') then
    raise exception 'a rota de hoje nao esta fechada' using errcode = 'P0002';
  end if;
  v_nome := public.rota_050_nome(v_uid);
  delete from public.rota_dia_item where data = v_hoje;
  update public.rota_dia_fechada set estado = 'reaberta', reaberta_em = pg_catalog.now(), reaberta_por = v_uid, reaberta_nome = v_nome, revisao = revisao + 1
   where data = v_hoje;
  insert into public.rota_dia_log (data, acao, detalhe, por, por_nome) values (v_hoje, 'reabrir', null, v_uid, v_nome);
  return (select pg_catalog.to_jsonb(f) from public.rota_dia_fechada f where f.data = v_hoje);
end;
$$;
revoke all on function public.rota_050_reabrir() from public, anon;
grant execute on function public.rota_050_reabrir() to authenticated;

-- ===================== leitura consistente (Sentinela RF-1) =====================
-- Cabecalho + itens do dia em UM SELECT (um snapshot): nunca "cabecalho fechado + itens de antes/depois". INVOKER: a RLS
-- vale (equipe le; service_role passa). null = o dia nao tem linha. Painel e Edge Function leem SO por aqui.
create or replace function public.rota_050_ler(p_data date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'linha', pg_catalog.to_jsonb(f),
           'itens', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('cd_pedido', i.cd_pedido, 'documento', i.documento, 'veiculo_id', i.veiculo_id,
                                  'ordem', i.ordem, 'origem', i.origem, 'removido_em', i.removido_em, 'removido_nome', i.removido_nome) order by i.cd_pedido)
                                from public.rota_dia_item i where i.data = f.data and f.estado = 'fechada'), '[]'::jsonb))
    from public.rota_dia_fechada f where f.data = p_data
$$;
revoke all on function public.rota_050_ler(date) from public, anon;
grant execute on function public.rota_050_ler(date) to authenticated, service_role;

-- ===================== envio ao motorista confere a foto (Sentinela RF-2 / R2-A) =====================
-- Dia FECHADO: o envio (rota_saida) de um veiculo so e aceito se trouxer EXATAMENTE os pedidos ativos da foto desse
-- veiculo que ainda estao em aberto no ERP e nao foram "tirados da rota" (045), NA ORDEM SALVA: cada parada porta a porta
-- e um grupo (os pedidos de mesma ordem na foto), na sequencia da foto. CD do CEASA (parada com itens): uma parada so,
-- confere o conjunto. Dia nao fechado (previsao/reaberto/amanha): sem conferencia. true = confere.
create or replace function public.rota_050_envio_ok(p_data date, p_veic text, p_paradas jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_pub text; v_esp text; v_cd boolean;
begin
  if not exists (select 1 from public.rota_dia_fechada f where f.data = p_data and f.estado = 'fechada') then
    return true;
  end if;
  p_paradas := case when pg_catalog.jsonb_typeof(p_paradas) = 'array' then p_paradas else '[]'::jsonb end;
  v_cd := exists (select 1 from pg_catalog.jsonb_array_elements(p_paradas) p where pg_catalog.jsonb_typeof(p -> 'itens') = 'array');
  -- enviado: grupos (parada; no CD, tudo junto) na ordem das paradas; dentro do grupo, codigos em ordem
  with par as (
    select p, n, case when pg_catalog.jsonb_typeof(p -> 'ordem') = 'number' then (p ->> 'ordem')::numeric else n end o
      from pg_catalog.jsonb_array_elements(p_paradas) with ordinality t(p, n)
  ), cds as (
    select case when v_cd then 0 else par.o end o, case when v_cd then 0 else par.n end n, (x #>> '{}')::bigint cd
      from par cross join lateral (
        select e from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(par.p -> 'pedidos') = 'array' then par.p -> 'pedidos' else '[]'::jsonb end) e
        union all
        select e from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(par.p -> 'itens') = 'array' then par.p -> 'itens' else '[]'::jsonb end) it
          cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(it -> 'pedidos') = 'array' then it -> 'pedidos' else '[]'::jsonb end) e
      ) y(x)
     where pg_catalog.jsonb_typeof(x) = 'number'
  ), g as (select o, n, pg_catalog.string_agg(distinct cd::text, ',' order by cd::text) gr from cds group by o, n)
  select coalesce(pg_catalog.string_agg(gr, '|' order by o, n), '') into v_pub from g;
  -- esperado: itens ativos da foto (em aberto, nao tirados da rota), agrupados pela ordem salva
  with esp as (
    select case when v_cd then 0 else coalesce(i.ordem, 2147483647) end o, i.cd_pedido cd
      from public.rota_dia_item i
      join public.solidcon_pedidos_erp p on p.cd_pedido = i.cd_pedido and p.etapa in ('aberto', 'na_carga', 'separando', 'separado', 'conferido')
     where i.data = p_data and i.veiculo_id = p_veic and i.removido_em is null
       and not exists (select 1 from public.rota_pedido_ignorado r where r.cd_pedido = i.cd_pedido)
  ), g as (select o, pg_catalog.string_agg(cd::text, ',' order by cd::text) gr from esp group by o)
  select coalesce(pg_catalog.string_agg(gr, '|' order by o), '') into v_esp from g;
  return v_pub = v_esp;
end;
$$;
revoke all on function public.rota_050_envio_ok(date, text, jsonb) from public, anon, authenticated;

-- Gatilho (defesa para QUALQUER gravacao em rota_saida): pega a MESMA trava de fechar/ajustar/reabrir antes de ler a foto
-- (serializa com eles) e confere pedidos + ordem.
create or replace function public.rota_050_saida_conferir()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(5100, 5001);
  if not public.rota_050_envio_ok(new.data, new.veiculo_id, new.paradas) then
    raise exception 'a rota de hoje foi fechada ou ajustada depois que a tela carregou: atualize e envie de novo' using errcode = '40001';
  end if;
  return new;
end;
$$;
revoke all on function public.rota_050_saida_conferir() from public, anon, authenticated;
drop trigger if exists rota_050_saida_conferir on public.rota_saida;
create trigger rota_050_saida_conferir before insert or update of paradas, data, veiculo_id on public.rota_saida
  for each row execute function public.rota_050_saida_conferir();

-- Envio ao motorista pelo painel (R2-A): numa transacao, sob a trava, confere a REVISAO que a tela viu (da linha de HOJE;
-- 0 = hoje sem linha, cobre "fechou depois que a tela carregou"), a foto (pedidos + ordem) e grava. Quem pode marcar rota.
create or replace function public.rota_050_publicar(p_data date, p_veiculo text, p_paradas jsonb, p_resumo jsonb, p_revisao integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_rev integer;
begin
  if not coalesce(public.pode_marcar_rota(), false) then
    raise exception 'sem permissao para enviar a rota' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(5100, 5001);
  select f.revisao into v_rev from public.rota_dia_fechada f where f.data = public.rota_050_hoje();
  if coalesce(v_rev, 0) is distinct from coalesce(p_revisao, -1) then
    raise exception 'a rota de hoje mudou (fechada, ajustada ou reaberta) depois que a tela carregou: atualize e envie de novo' using errcode = '40001';
  end if;
  if not public.rota_050_envio_ok(p_data, p_veiculo, p_paradas) then
    raise exception 'a rota de hoje foi fechada ou ajustada depois que a tela carregou: atualize e envie de novo' using errcode = '40001';
  end if;
  insert into public.rota_saida (data, veiculo_id, paradas, resumo)
  values (p_data, p_veiculo, p_paradas, p_resumo)
  on conflict (data, veiculo_id) do update set paradas = excluded.paradas, resumo = excluded.resumo;
  return (select pg_catalog.to_jsonb(r) from public.rota_saida r where r.data = p_data and r.veiculo_id = p_veiculo);
end;
$$;
revoke all on function public.rota_050_publicar(date, text, jsonb, jsonb, integer) from public, anon;
grant execute on function public.rota_050_publicar(date, text, jsonb, jsonb, integer) to authenticated;

-- ===================== (5) limpeza =====================
create or replace function public.rota_050_limpar()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare v_n integer;
begin
  delete from public.rota_dia_fechada where data < public.rota_050_hoje() - 60;
  get diagnostics v_n = row_count;
  delete from public.rota_dia_log where em < pg_catalog.now() - interval '180 days';
  return v_n;
end;
$$;
revoke all on function public.rota_050_limpar() from public, anon, authenticated;
grant execute on function public.rota_050_limpar() to service_role;
grant delete on public.rota_dia_fechada, public.rota_dia_item, public.rota_dia_log to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $j$select cron.unschedule(jobid) from cron.job where jobname = 'rota-limpeza-dia-fechada'$j$;
    execute $j$select cron.schedule('rota-limpeza-dia-fechada', '47 6 * * *', 'select public.rota_050_limpar()')$j$;
  else
    raise notice '050: pg_cron nao instalado: limpeza diaria NAO agendada (rode select public.rota_050_limpar() de vez em quando).';
  end if;
end;
$$;

commit;
