-- Rollback 053: publicar primeiro o painel sem telefone e retirar essa chave das rotas existentes.
-- Recusa dados incompativeis, em vez de alterar silenciosamente a rota e seu progresso.
begin;
set local lock_timeout='5s';
select pg_catalog.pg_advisory_xact_lock(5100,53);
do $$begin
 if exists(select 1 from public.rota_saida s, pg_catalog.jsonb_array_elements(s.paradas) p where p ? 'telefone') then
   raise exception '053 rollback: retire a chave telefone das rotas publicadas antes de reverter' using errcode='22023';
 end if;
end$$;
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

commit;

