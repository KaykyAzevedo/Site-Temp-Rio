-- 028: reforco de seguranca do banco (achados da auditoria das migracoes 004-027).
-- NAO APLICADA. Instalacao manual no SQL Editor (papel postgres). Idempotente: pode rodar de novo.
-- Nao apaga nem altera dados existentes (nenhum UPDATE/DELETE; compativel com safeupdate).
-- Nao muda nada do ERP/SOLIDCON nem do site.
--
-- (1) pedidos: insercao anonima nao escolhe mais status/confirmacao/envio/datas.
--     Antes, um POST direto em /rest/v1/pedidos com status='confirmado' entrava como
--     pedido confirmado e somava no faturamento do painel. O site nunca envia esses campos.
-- (2) historico_do_cliente(p_cnpj): numeros so para a equipe autenticada.
--     Antes, qualquer visitante consultava total de pedidos/caixas/valor de qualquer CNPJ.
--     Agora anon/nao-equipe recebem zeros, que o site ja trata como "1 pedido".
-- (3) Limites de tamanho nos campos livres das tabelas com INSERT anonimo (visitas, leads,
--     consentimentos, vitrines, pedidos, lista_espera). NOT VALID: vale para linhas novas e
--     alteradas, sem reprovar linhas antigas.
-- (4) Privilegios que o RLS nao cobre: TRUNCATE/REFERENCES/TRIGGER revogados de anon e
--     authenticated nas tabelas de public (o site e o painel nao usam nenhum deles).
-- (5) Funcoes SECURITY DEFINER com search_path=public passam a public, pg_temp
--     (pg_temp explicito no fim: nada de objeto temporario sombreando tabela).
begin;

do $$
begin
  if to_regclass('public.pedidos') is null
     or to_regclass('public.visitas') is null
     or to_regclass('public.leads') is null
     or to_regclass('public.consentimentos') is null
     or to_regclass('public.vitrines') is null
     or to_regclass('public.lista_espera') is null
     or to_regprocedure('public.historico_do_cliente(text)') is null
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('auth.role()') is null then
    raise exception '028 requer pedidos/visitas/leads/consentimentos/vitrines/lista_espera, historico_do_cliente(text), eh_equipe() e auth.role(). Nada foi aplicado.';
  end if;
end;
$$;

-- (1) pedidos: estado inicial imposto pelo servidor para quem nao e da equipe ------------
create or replace function public.pedido_028_estado_inicial()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- So os papeis da API publica; service_role/SQL Editor (importacoes, correcoes) seguem livres.
  -- anon nunca e equipe: nao chama eh_equipe() (que le admins, sem SELECT para anon).
  if current_user = 'anon'
     or (current_user = 'authenticated' and not coalesce(public.eh_equipe(), false)) then
    new.status := 'aguardando';
    new.confirmado_em := null;
    new.enviado_whatsapp := false;
    new.enviado_whatsapp_em := null;
    new.criado_em := now();
    new.atualizado_em := now();
  end if;
  return new;
end;
$$;
revoke all on function public.pedido_028_estado_inicial() from public, anon, authenticated;

drop trigger if exists pedidos_028_estado_inicial on public.pedidos;
create trigger pedidos_028_estado_inicial
  before insert on public.pedidos
  for each row execute function public.pedido_028_estado_inicial();

-- (2) historico_do_cliente: mesma assinatura e mesmo retorno; numeros so para a equipe.
-- Nenhuma prova de titularidade do CNPJ e possivel no site publico (um pedido recente pode
-- ser forjado por terceiros), entao anon e nao-equipe recebem zeros; js/pedido.js ja trata
-- zeros como "1 pedido" e a sugestao de vitrine segue pelos numeros do pedido atual.
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
    join public.pedidos p on regexp_replace(p.cnpj, '[^0-9]', '', 'g') = l.doc
   where length(l.doc) = 14;
$$;
revoke all on function public.historico_do_cliente(text) from public;
grant execute on function public.historico_do_cliente(text) to anon, authenticated;

-- (3) limites de tamanho (NOT VALID: sem varrer nem reprovar linhas antigas) -------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('visitas',        'visitas_028_tamanhos',
       'char_length(coalesce(pagina,'''')) <= 200 and char_length(coalesce(sessao,'''')) <= 100
        and char_length(coalesce(user_agent,'''')) <= 1000 and char_length(coalesce(referencia,'''')) <= 100
        and char_length(coalesce(regiao_id,'''')) <= 100
        and (pre_registro is null or octet_length(pre_registro::text) <= 2048)'),
      ('leads',          'leads_028_tamanhos',
       'char_length(coalesce(pagina_origem,'''')) <= 200 and char_length(coalesce(sessao,'''')) <= 100
        and char_length(coalesce(observacoes,'''')) <= 2000'),
      ('consentimentos', 'consentimentos_028_tamanhos',
       'char_length(coalesce(documento,'''')) <= 20 and char_length(coalesce(telefone,'''')) <= 30
        and char_length(coalesce(versao_politica,'''')) <= 50 and char_length(coalesce(user_agent,'''')) <= 1000'),
      ('vitrines',       'vitrines_028_tamanhos',
       'char_length(coalesce(cnpj,'''')) <= 20 and char_length(coalesce(razao_social,'''')) <= 200
        and char_length(coalesce(responsavel,'''')) <= 200 and char_length(coalesce(telefone,'''')) <= 30
        and char_length(coalesce(email,'''')) <= 254 and char_length(coalesce(cep,'''')) <= 9
        and char_length(coalesce(logradouro,'''')) <= 200 and char_length(coalesce(numero,'''')) <= 30
        and char_length(coalesce(complemento,'''')) <= 100 and char_length(coalesce(bairro,'''')) <= 100
        and char_length(coalesce(cidade,'''')) <= 100 and char_length(coalesce(regiao,'''')) <= 100
        and char_length(coalesce(aprovado_por,'''')) <= 254 and char_length(coalesce(observacao,'''')) <= 2000'),
      ('pedidos',        'pedidos_028_tamanhos',
       'char_length(coalesce(inscricao_estadual,'''')) <= 30 and char_length(coalesce(uf,'''')) <= 2
        and char_length(coalesce(regiao,'''')) <= 100 and char_length(coalesce(regiao_id,'''')) <= 100
        and char_length(coalesce(numero_solidcon,'''')) <= 50
        and (itens is null or (jsonb_typeof(itens) <> ''array'' or jsonb_array_length(itens) <= 300)
             and octet_length(itens::text) <= 262144)'),
      ('lista_espera',   'lista_espera_028_tamanhos',
       'char_length(coalesce(inscricao_estadual,'''')) <= 30 and char_length(coalesce(uf,'''')) <= 2
        and char_length(coalesce(itens,'''')) <= 20000')
    ) as t(tabela, nome, expr)
  loop
    if not exists (select 1 from pg_constraint
                    where conrelid = ('public.' || r.tabela)::regclass and conname = r.nome) then
      execute format('alter table public.%I add constraint %I check (%s) not valid', r.tabela, r.nome, r.expr);
    end if;
  end loop;
end;
$$;

-- (4) privilegios fora do alcance do RLS -------------------------------------------------
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
do $$
begin
  -- Tabelas novas criadas pelo postgres tambem nascem sem esses tres privilegios.
  alter default privileges for role postgres in schema public
    revoke truncate, references, trigger on tables from anon, authenticated;
exception when insufficient_privilege then
  raise notice '028: default privileges do postgres nao alterados (rode como postgres).';
end;
$$;

-- (5) search_path das funcoes SECURITY DEFINER antigas (004-016, vitrine) ----------------
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proconfig @> array['search_path=public']
  loop
    execute format('alter function %s set search_path = public, pg_temp', f);
  end loop;
end;
$$;

commit;
