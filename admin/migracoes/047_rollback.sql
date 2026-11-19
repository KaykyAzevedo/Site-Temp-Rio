-- ROLLBACK da 047 (frota configuravel). NAO e migracao: so rode se precisar desfazer a 047.
-- Uma transacao so: ou desfaz tudo, ou nada muda. Antes: faca backup (Database -> Backups) ou exporte rota_saida,
-- rota_motoristas e rota_veiculos (as tres tabelas sao APAGADAS: rotas publicadas, motoristas e frota editada).
-- PRECHECK: se houver padrao/escolha/plano em veiculo que nao seja caminhao/S10 (ex.: Strada), PARA sem mudar nada:
-- remarque esses pedidos/clientes no painel (ou apague as marcacoes) e rode de novo.
-- Ordem (Sentinela V-BACK V5): a politica rota_047_motorista_le (rota_veiculos) depende de rota_047_veiculo_motorista():
-- sai ANTES da funcao. Restaura no fim os CHECK ('caminhao','s10') e as funcoes originais da 044/046 e da 042.
-- Sem CASCADE. pg_cron opcional.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.rota_veiculos') is null then
    raise exception 'rollback 047: a 047 nao esta aplicada (rota_veiculos nao existe). Nada foi alterado.';
  end if;
  if exists (select 1 from public.rota_cliente_veiculo where veiculo not in ('caminhao', 's10'))
     or exists (select 1 from public.rota_pedido_veiculo where veiculo not in ('caminhao', 's10'))
     or exists (select 1 from public.rota_plano_semana where veiculo_id is distinct from 's10') then
    raise exception 'rollback 047: ha padrao/escolha/plano em veiculo que nao e caminhao/S10. Remarque (ou apague) essas marcacoes e planos antes. Nada foi alterado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 47);

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $j$select cron.unschedule(jobid) from cron.job where jobname = 'rota-limpeza-saida'$j$;
  end if;
end;
$$;

-- (4) rota publicada e (3) motoristas: a politica de rota_veiculos que usa a funcao do motorista sai antes dela
drop table if exists public.rota_saida;
drop policy if exists rota_047_motorista_le on public.rota_veiculos;
drop table if exists public.rota_motoristas;
drop function if exists public.rota_047_limpar();
drop function if exists public.rota_047_saida_publicar();
drop function if exists public.rota_047_resumo_valido(jsonb);
drop function if exists public.rota_047_paradas_validas(jsonb);
drop function if exists public.rota_047_inteiros_ok(jsonb, integer);
drop function if exists public.rota_047_num_ok(jsonb, numeric, numeric, boolean);
drop function if exists public.rota_047_texto_ok(jsonb, integer, boolean);
drop function if exists public.rota_047_veiculo_motorista();

-- (2) FK -> CHECK de antes; plano da semana sem veiculo_id
alter table public.rota_cliente_veiculo drop constraint if exists rota_cliente_veiculo_047_veiculo_fk;
alter table public.rota_pedido_veiculo drop constraint if exists rota_pedido_veiculo_047_veiculo_fk;
alter table public.rota_plano_semana drop constraint if exists rota_plano_semana_047_veiculo_fk;
drop index if exists public.rota_cliente_veiculo_047_veiculo_idx;
drop index if exists public.rota_pedido_veiculo_047_veiculo_idx;
drop index if exists public.rota_plano_semana_047_veiculo_dia_idx;
alter table public.rota_cliente_veiculo drop constraint if exists rota_cliente_veiculo_veiculo_check;
alter table public.rota_cliente_veiculo add constraint rota_cliente_veiculo_veiculo_check check (veiculo in ('caminhao', 's10'));
alter table public.rota_pedido_veiculo drop constraint if exists rota_pedido_veiculo_veiculo_check;
alter table public.rota_pedido_veiculo add constraint rota_pedido_veiculo_veiculo_check check (veiculo in ('caminhao', 's10'));
alter table public.rota_plano_semana drop column if exists veiculo_id;

-- funcoes originais (copiadas da 044, 046 e 042) antes de apagar a frota
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

create or replace function public.whatsapp_042_rotina_validar()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare v_permitidos text[];
begin
  v_permitidos := case
    when new.codigo in ('receber_diario', 'alertas_marcio') then array['gestor']
    when new.codigo in ('rota_s10', 'rota_caminhao') then array['entregador', 'gestor']
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

drop function if exists public.rota_047_salvar_semana(date, text, jsonb);
drop table if exists public.rota_veiculos;
drop function if exists public.rota_047_veiculo_normalizar();
delete from public.whatsapp_rotinas where codigo = 'rota_strada';

commit;
