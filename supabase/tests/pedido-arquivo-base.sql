\set ON_ERROR_STOP on
-- Fixture PG18 local; nenhuma conexao a ERP/projeto.
\ir canhoto-desde.sql
alter table public.solidcon_pedidos_erp add column dt_pedido timestamptz default now(),add column cliente_tipo text default 'cnpj',
 add column cliente_nome text,add column valor_centavos bigint,add column nr_carga bigint,add column atualizado_em timestamptz,
 add column dt_carga timestamptz,add column dt_sep_inicio timestamptz,add column dt_sep_fim timestamptz,add column dt_conferencia timestamptz,
 add column caixas_24 integer,add column caixas_48 integer,add column caixas_outras integer;
create table public.solidcon_clientes(documento text primary key,tipo text,nome text,logradouro text,numero text,complemento text,bairro text,cidade text,estado text,cep text);
create table public.integracoes_autorizadas(user_id uuid primary key);
create table public.solidcon_produtos(id_produto bigint primary key,categoria text);
create table public.rota_motoristas(user_id uuid primary key,veiculo_id text,nome text,ativo boolean);
alter table public.rota_veiculos add column nome text;
alter table public.rota_saida add column publicado_em timestamptz default now();
create or replace function public.solidcon_026_documento_valido(p_doc text, p_tipo text)
returns boolean
language plpgsql immutable
set search_path = pg_catalog
as $$
declare
  v_pesos int[];
  v_k int;
  v_s int;
  v_r int;
  v_dv int;
  v_rodada int;
begin
  if p_doc is null or p_tipo is null then return false; end if;
  if p_tipo = 'cpf' and p_doc !~ '^[0-9]{11}$' then return false; end if;
  if p_tipo = 'cnpj' and p_doc !~ '^[0-9]{14}$' then return false; end if;
  if p_tipo not in ('cpf', 'cnpj') then return false; end if;
  if p_doc ~ '^(.)\1+$' then return false; end if;
  for v_rodada in 1..2 loop
    if p_tipo = 'cpf' then
      v_k := 8 + v_rodada;
      v_pesos := array(select g from generate_series(v_k + 1, 2, -1) g);
    else
      v_k := 11 + v_rodada;
      v_pesos := case v_rodada when 1 then array[5,4,3,2,9,8,7,6,5,4,3,2]
                                       else array[6,5,4,3,2,9,8,7,6,5,4,3,2] end;
    end if;
    v_s := 0;
    for i in 1..v_k loop
      v_s := v_s + substring(p_doc from i for 1)::int * v_pesos[i];
    end loop;
    v_r := v_s % 11;
    v_dv := case when v_r < 2 then 0 else 11 - v_r end;
    if v_dv <> substring(p_doc from v_k + 1 for 1)::int then return false; end if;
  end loop;
  return true;
end;
$$;
\ir ../../admin/migracoes/035_solidcon_pedidos_erp.sql
\ir ../../admin/migracoes/039_pedidos_caixas.sql
insert into public.integracoes_autorizadas values('11111111-1111-4111-8111-111111111111');
insert into public.solidcon_clientes values('11222333000181','cnpj','Cliente Arquivo','Rua Teste','10','Galpao','Barra','Rio','RJ','22770000');
insert into public.rota_motoristas values('11111111-1111-4111-8111-111111111111','s10','Charles',true);
update public.rota_veiculos set nome='S10' where id='s10';
set qa.uid='11111111-1111-4111-8111-111111111111';set qa.papel='marcador';
-- Retira pedidos artificiais das suites anteriores; canhoto1534 vira caso legado sem fonte.
-- A RPC real mantem sua trava de queda>70% quando ha20+ pedidos; este cenario usa um pedido.
delete from public.solidcon_pedidos_erp;
insert into public.solidcon_pedidos_erp(cd_pedido,dt_pedido,etapa,dt_saida,dt_atendido,cliente_tipo,documento,cliente_nome,valor_centavos,nr_carga,atualizado_em,caixas_24,caixas_48,caixas_outras)
 values(5001,now()-interval '3 days','atendido',now()-interval '1 day',now()-interval '1 day','cnpj','11222333000181','Cliente Arquivo',300960,123,now(),3,1,2);
create or replace function public.rota_051_meu_veiculo()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select m.veiculo_id from public.rota_motoristas m where m.user_id = auth.uid() and m.ativo $$;
create or replace function public.rota_051_validar_contexto(p_data date, p_veiculo text, p_versao integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_veic text;
  v_versao integer;
  v_hoje date := (pg_catalog.now() at time zone 'America/Sao_Paulo')::date;
begin
  select m.veiculo_id into v_veic from public.rota_motoristas m
   where m.user_id = auth.uid() and m.ativo for share;
  if v_veic is null then
    raise exception 'so o motorista ativo usa a propria rota' using errcode = '42501';
  end if;
  if p_data < v_hoje then
    raise exception 'DIA_ANTIGO: pendencia de outro dia; preserve para recuperacao no escritorio' using errcode = 'P5101';
  end if;
  if p_data is distinct from v_hoje then
    raise exception 'so a rota de hoje pode ser marcada' using errcode = '22023';
  end if;
  if p_veiculo is null or p_veiculo = '' or p_versao is null or p_versao < 1 then
    raise exception 'CONTEXTO_AUSENTE: veiculo e versao originais sao obrigatorios' using errcode = 'P5104';
  end if;
  if p_veiculo is distinct from v_veic then
    raise exception 'VEICULO_DIVERGENTE: nao reenviar a pendencia na vinculacao atual' using errcode = 'P5102';
  end if;
  select s.versao into v_versao from public.rota_saida s
   where s.data = p_data and s.veiculo_id = p_veiculo for share;
  if v_versao is null or v_versao is distinct from p_versao then
    raise exception 'VERSAO_DIVERGENTE: rota substituida ou retirada; preserve a pendencia original' using errcode = 'P5103';
  end if;
  return true;
end;
$$;
create or replace function public.rota_051_cds_da_rota(p_data date, p_veic text)
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $$
  select distinct (x #>> '{}')::bigint
    from public.rota_saida s
    cross join lateral pg_catalog.jsonb_array_elements(s.paradas) p
    cross join lateral (
      select e from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p -> 'pedidos') = 'array' then p -> 'pedidos' else '[]'::jsonb end) e
      union all
      select e from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p -> 'itens') = 'array' then p -> 'itens' else '[]'::jsonb end) it
        cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(it -> 'pedidos') = 'array' then it -> 'pedidos' else '[]'::jsonb end) e
    ) y(x)
   where s.data = p_data and s.veiculo_id = p_veic and pg_catalog.jsonb_typeof(x) = 'number'
$$;
\ir ../../admin/migracoes/057_pedido_arquivo.sql
