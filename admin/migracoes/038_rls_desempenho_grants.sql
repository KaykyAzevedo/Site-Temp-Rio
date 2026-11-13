-- 038: desempenho e limpeza de RLS + grants minimos de anon (achados 3, 4 e 7 da auditoria de 2026-11-13).
-- NAO APLICADA. Instalacao manual no SQL Editor (papel postgres). Idempotente: pode rodar de novo.
-- Nao apaga nem altera linhas (nenhum INSERT/UPDATE/DELETE). Nao toca no ERP/SOLIDCON.
-- INDEPENDENTE da 037 (pode aplicar antes ou depois; testado nas duas ordens).
-- Estado esperado das politicas: export de producao de 2026-11-13 (67 politicas). Cada troca so
-- acontece se a politica estiver EXATAMENTE como esperado; senao a 038 pula aquela troca e avisa (NOTICE).
--
-- (1) [achado 3] Toda politica de public que chama public.eh_admin()/public.eh_equipe() direto passa a
--     chamar (select public.eh_...()): o Postgres calcula UMA vez por consulta (initPlan) em vez de uma
--     vez por linha. Mesma semantica: as duas funcoes sao STABLE e so dependem do JWT e de admins.
--     ALTER POLICY so troca a expressao; comando, papeis e nome continuam iguais.
-- (2) [achado 7] FOR ALL trocado por comandos explicitos, sem mudar quem pode o que:
--     usuarios/clientes: 'admin escreve X' (ALL, eh_admin) vira so INSERT + DELETE, porque SELECT e
--       UPDATE ja estao cobertos por 'equipe le X'/'equipe atualiza X' (eh_equipe inclui todo admin);
--     catalogo_produtos, pedido_items, regioes, regioes_faixas_cep: 'admin escreve X' (ALL) vira
--       INSERT + UPDATE + DELETE; o SELECT ja e coberto por 'admin le ...' ou 'todos leem ...' (true).
--     Prova: matriz papeis x tabelas x select/insert/update/delete antes = depois (LEIAME, secao 038).
-- (3) [achado 4] pedidos.cnpj_digitos: coluna gerada STORED = regexp_replace(cnpj, '[^0-9]', '', 'g')
--     + indice. historico_do_cliente passa a filtrar por ela (MESMA expressao '[^0-9]' da 028; mesma
--     assinatura e grants). Funcoes com '\D' (015) e a 034 ficam como estao: '\D' nao e garantidamente
--     igual a '[^0-9]' fora do ASCII, e trocar a 034 exigiria reescrever o corpo inteiro.
--     ATENCAO: ADD COLUMN ... STORED reescreve a tabela e CREATE INDEX (sem CONCURRENTLY, que nao roda em
--     transacao) bloqueia escrita enquanto cria. pedidos e pequena; lock_timeout 5s aborta em vez de travar.
-- (4) Grants de anon: nas 7 tabelas em que o site publico SO insere (pedidos, leads, visitas,
--     lista_espera, solicitacoes_lgpd, consentimentos, vitrines), anon perde SELECT/UPDATE/DELETE e fica
--     so com INSERT. O RLS ja negava tudo isso a anon (nenhuma politica de anon alem do INSERT); isto e
--     defesa em profundidade. O site usa sempre Prefer: return=minimal (sem RETURNING de colunas), e os
--     gatilhos INVOKER dessas tabelas nao leem a propria tabela. authenticated nao muda (o painel precisa).
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- Deparse das politicas sai qualificado (public.eh_admin()) e nada sem schema e resolvido por engano.
set local search_path = pg_catalog, pg_temp;

do $$
begin
  if to_regprocedure('public.eh_admin()') is null
     or to_regprocedure('public.eh_equipe()') is null
     or to_regclass('public.pedidos') is null
     or to_regprocedure('public.historico_do_cliente(text)') is null then
    raise exception '038 requer eh_admin(), eh_equipe(), pedidos e historico_do_cliente(text). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 38);

-- ===================== (2) FOR ALL -> comandos explicitos =====================
-- Helper temporario (some no fim da transacao): troca 'admin escreve X' (ALL) por comandos explicitos.
create function pg_temp.m038_trocar_all(p_tabela text, p_politica text, p_comandos text[], p_exige text[])
returns void
language plpgsql
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_rel regclass := to_regclass('public.' || quote_ident(p_tabela));
  v_ok boolean;
  v_cmd text;
  v_nome text;
  v_falta text;
  v_admin constant text[] := array['public.eh_admin()', '( SELECT public.eh_admin() AS eh_admin)'];
  v_equipe constant text[] := array['public.eh_equipe()', '( SELECT public.eh_equipe() AS eh_equipe)'];
begin
  if v_rel is null then raise notice '038: tabela % ausente; nada trocado.', p_tabela; return; end if;
  select pol.polcmd = '*' and pol.polpermissive
         and pol.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]::oid[]
         and pg_get_expr(pol.polqual, pol.polrelid) = any (v_admin)
         and pg_get_expr(pol.polwithcheck, pol.polrelid) = any (v_admin)
    into v_ok
    from pg_policy pol where pol.polrelid = v_rel and pol.polname = p_politica;
  if v_ok is null then
    raise notice '038: % / "%" nao existe (ja trocada?); nada a fazer.', p_tabela, p_politica; return;
  end if;
  if not v_ok then
    raise notice '038: % / "%" diferente do esperado; NAO trocada.', p_tabela, p_politica; return;
  end if;
  -- O que o ALL cobria e NAO vai virar politica propria precisa estar coberto por outra politica
  -- (p_exige = 'comando:nome', com eh_equipe() ou true na expressao).
  foreach v_falta in array coalesce(p_exige, '{}') loop
    if not exists (
      select 1 from pg_policy o
       where o.polrelid = v_rel and o.polname = split_part(v_falta, ':', 2) and o.polpermissive
         and o.polcmd = case split_part(v_falta, ':', 1) when 'select' then 'r' when 'update' then 'w' end
         and (select oid from pg_roles where rolname = 'authenticated') = any (o.polroles)
         and (pg_get_expr(o.polqual, o.polrelid) = any (v_equipe) or pg_get_expr(o.polqual, o.polrelid) = 'true')
         and (o.polcmd <> 'w' or pg_get_expr(o.polwithcheck, o.polrelid) = any (v_equipe))
    ) then
      raise notice '038: % / "%" nao cobre %; "%" NAO trocada.', p_tabela, split_part(v_falta, ':', 2), split_part(v_falta, ':', 1), p_politica;
      return;
    end if;
  end loop;
  foreach v_cmd in array p_comandos loop
    v_nome := 'admin ' || case v_cmd when 'insert' then 'insere ' when 'update' then 'atualiza ' else 'apaga ' end || p_tabela;
    execute format('drop policy if exists %I on public.%I', v_nome, p_tabela);
    execute case v_cmd
      when 'insert' then format('create policy %I on public.%I for insert to authenticated with check ((select public.eh_admin()))', v_nome, p_tabela)
      when 'update' then format('create policy %I on public.%I for update to authenticated using ((select public.eh_admin())) with check ((select public.eh_admin()))', v_nome, p_tabela)
      else format('create policy %I on public.%I for delete to authenticated using ((select public.eh_admin()))', v_nome, p_tabela)
    end;
  end loop;
  execute format('drop policy %I on public.%I', p_politica, p_tabela);
end;
$f$;

select pg_temp.m038_trocar_all('usuarios', 'admin escreve usuarios', array['insert', 'delete'],
                               array['select:equipe le usuarios', 'update:equipe atualiza usuarios']);
select pg_temp.m038_trocar_all('clientes', 'admin escreve clientes', array['insert', 'delete'],
                               array['select:equipe le clientes', 'update:equipe atualiza clientes']);
select pg_temp.m038_trocar_all('catalogo_produtos', 'admin escreve produtos', array['insert', 'update', 'delete'], null);
select pg_temp.m038_trocar_all('pedido_items', 'admin escreve itens', array['insert', 'update', 'delete'], null);
select pg_temp.m038_trocar_all('regioes', 'admin escreve regioes', array['insert', 'update', 'delete'], null);
select pg_temp.m038_trocar_all('regioes_faixas_cep', 'admin escreve faixas', array['insert', 'update', 'delete'], null);
-- SELECT do ALL nessas 4 tabelas ja e coberto por 'admin le todos os produtos', 'admin le itens',
-- 'todos leem regioes' (true) e 'todos leem faixas' (true): nada a criar.

-- ===================== (1) (select eh_...()) em todas as politicas =====================
do $$
declare
  r record;
  v_q text;
  v_w text;
  v_alter text;
  v_n int := 0;
  v_padrao constant text := '(?<!SELECT )public\.eh_(admin|equipe)\(\)';
begin
  for r in
    select pol.polname, c.relname,
           pg_get_expr(pol.polqual, pol.polrelid) as q, pg_get_expr(pol.polwithcheck, pol.polrelid) as w
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
  loop
    v_q := regexp_replace(r.q, v_padrao, '(select public.eh_\1())', 'g');
    v_w := regexp_replace(r.w, v_padrao, '(select public.eh_\1())', 'g');
    v_alter := '';
    if v_q is distinct from r.q then v_alter := v_alter || ' using (' || v_q || ')'; end if;
    if v_w is distinct from r.w then v_alter := v_alter || ' with check (' || v_w || ')'; end if;
    if v_alter <> '' then
      execute format('alter policy %I on public.%I', r.polname, r.relname) || v_alter;
      v_n := v_n + 1;
    end if;
  end loop;
  raise notice '038: % politica(s) com (select eh_...()).', v_n;
end;
$$;

-- ===================== (3) pedidos.cnpj_digitos =====================
alter table public.pedidos
  add column if not exists cnpj_digitos text generated always as (regexp_replace(cnpj, '[^0-9]', '', 'g')) stored;
create index if not exists pedidos_cnpj_digitos_idx on public.pedidos (cnpj_digitos);

-- Mesmo corpo da 028, trocando so a expressao do JOIN pela coluna (mesma expressao, agora indexada).
create or replace function public.historico_do_cliente(p_cnpj text)
returns table(pedidos bigint, caixas bigint, valor_centavos bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with liberado as (
    select regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g') as doc
     where coalesce(auth.role(), '') = 'authenticated'
       and coalesce(public.eh_equipe(), false)
  )
  -- Agregado sem GROUP BY: sempre exatamente 1 linha (zeros quando nao liberado).
  select count(p.id)::bigint,
         coalesce(sum(p.caixas), 0)::bigint,
         coalesce(sum(p.valor_centavos), 0)::bigint
    from liberado l
    join public.pedidos p on p.cnpj_digitos = l.doc
   where length(l.doc) = 14;
$$;
-- create or replace preserva os grants da 028/036 (anon e authenticated executam; PUBLIC nao).

-- ===================== (4) anon so INSERT nas tabelas de formulario =====================
do $$
declare
  t text;
begin
  foreach t in array array['pedidos', 'leads', 'visitas', 'lista_espera', 'solicitacoes_lgpd', 'consentimentos', 'vitrines'] loop
    if to_regclass('public.' || t) is null then
      raise notice '038: tabela % ausente; grants nao alterados.', t;
      continue;
    end if;
    execute format('revoke select, update, delete on public.%I from anon', t);
    execute format('grant insert on public.%I to anon', t);
  end loop;
end;
$$;

commit;
