-- 036: reforco LGPD + grants de funcoes SECURITY DEFINER (achados 1, 2 e 8 da auditoria de 2026-11-13).
-- APLICADA em 2026-11-13 (conferida: anon executa so as 7 DEFINER publicas). Instalacao manual no SQL Editor (papel postgres). Idempotente: pode rodar de novo.
-- Nao apaga nem altera dados existentes (nenhum UPDATE/DELETE). Nao toca no ERP/SOLIDCON.
-- Requer 015 (solicitacoes_lgpd, auditoria, lgpd_meus_dados) e 013 (telefone_valido).
--
-- (1) lgpd_meus_dados(text,text) NAO devolve mais dado pessoal. Antes: documento + telefone
--     (publicos para PJ) liberavam cadastro, endereco e pedidos, sem limite de tentativas.
--     Agora so registra um pedido tipo 'acesso' em solicitacoes_lgpd + auditoria e devolve
--     {status:'recebido', protocolo, prazo_dias:15} SEMPRE igual, exista ou nao o documento.
--     A equipe confirma a identidade e responde por e-mail/WhatsApp (LGPD art. 19, II: 15 dias).
--     Mesma assinatura (text,text) e mesmo grant (anon, authenticated): o site nao quebra.
--     O INSERT passa pelo antispam da 032 (limite de solicitacoes_lgpd: 5/h e 10/dia por origem,
--     20/min no total): o papel da sessao continua 'anon' dentro da funcao SECURITY DEFINER.
--     solicitacoes_lgpd.tipo passa a aceitar 'acesso' (so amplia o CHECK; linhas antigas valem).
-- (2) EXECUTE de anon (e de PUBLIC) revogado de TODA funcao SECURITY DEFINER do schema public,
--     exceto as 7 que o site publico chama via /rpc (lista abaixo). Quem hoje tem EXECUTE por
--     authenticated/service_role (inclusive herdado de PUBLIC) recebe o grant explicito ANTES do
--     revoke, entao o painel e o coletor SOLIDCON (conta authenticated) continuam iguais.
--     Gatilhos (pedido_resolver_cliente, pedido_explodir_itens, pedido_total_servidor...) nao
--     dependem do EXECUTE de quem insere: o INSERT anonimo de pedidos continua funcionando.
--     Funcoes novas criadas pelo postgres em public deixam de nascer com EXECUTE direto para anon.
--     ATENCAO: o EXECUTE para PUBLIC e padrao GLOBAL do Postgres e nao da para tira-lo so do
--     schema public; por isso toda funcao nova continua com 'revoke all ... from public, anon'.
-- (3) search_path das SECURITY DEFINER com 'pg_catalog' (019-035) vira 'pg_catalog, pg_temp'.
--     Sem pg_temp na lista, o Postgres procura tabelas temporarias PRIMEIRO. Conferido: todas as
--     tabelas citadas nessas funcoes sao qualificadas (public.x) ou sao CTEs; nada muda de sentido.
begin;

-- O ALTER do CHECK pega ACCESS EXCLUSIVE em solicitacoes_lgpd: melhor abortar do que travar o site.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.solicitacoes_lgpd') is null
     or to_regclass('public.auditoria') is null
     or to_regprocedure('public.lgpd_meus_dados(text,text)') is null
     or to_regprocedure('public.telefone_valido(text)') is null then
    raise exception '036 requer 015 (solicitacoes_lgpd, auditoria, lgpd_meus_dados) e 013 (telefone_valido). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 36);

-- (1) LGPD: acesso vira pedido, sem devolver dado ---------------------------------------------
alter table public.solicitacoes_lgpd drop constraint if exists solicitacoes_lgpd_tipo_check;
alter table public.solicitacoes_lgpd add constraint solicitacoes_lgpd_tipo_check
  check (tipo in ('acesso', 'exclusao', 'correcao'));

create or replace function public.lgpd_meus_dados(p_documento text, p_telefone text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_doc text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_id uuid;
begin
  -- So formato (o site ja valida antes). Nunca consulta usuarios/clientes/pedidos:
  -- a resposta nao pode variar com a existencia do documento.
  if length(v_doc) not in (11, 14) or not coalesce(public.telefone_valido(v_tel), false) then
    raise exception 'documento ou telefone invalido' using errcode = '22023';
  end if;

  insert into public.solicitacoes_lgpd (tipo, documento, telefone)
  values ('acesso', v_doc, v_tel)
  returning id into v_id;

  insert into public.auditoria (acao, ator, documento_alvo, detalhes)
  values ('lgpd_acesso_solicitado', null, v_doc, jsonb_build_object('solicitacao_id', v_id));

  return jsonb_build_object(
    'status', 'recebido',
    'protocolo', upper(left(replace(coalesce(v_id::text, ''), '-', ''), 8)),
    'prazo_dias', 15
  );
end;
$$;

revoke all on function public.lgpd_meus_dados(text, text) from public;
grant execute on function public.lgpd_meus_dados(text, text) to anon, authenticated;

-- (2) EXECUTE de anon/PUBLIC so nas funcoes DEFINER que o site publico chama ----------------
do $$
declare
  v_publicas text[] := array[
    'criar_pedido(jsonb)',
    'marcar_enviado_whatsapp(uuid)',
    'completar_visita(text, integer, text, jsonb)',
    'lgpd_meus_dados(text, text)',
    'historico_do_cliente(text)',
    'solidcon_catalogo_publico()',
    'solidcon_ficha_publica()'
  ];
  v_f regprocedure;
  v_papel text;
begin
  for v_f in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and (p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')') <> all (v_publicas)
  loop
    -- Preserva quem ja executa hoje (direto ou via PUBLIC) antes de tirar PUBLIC.
    foreach v_papel in array array['authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = v_papel)
         and has_function_privilege(v_papel, v_f, 'execute') then
        execute format('grant execute on function %s to %I', v_f, v_papel);
      end if;
    end loop;
    execute format('revoke execute on function %s from public, anon', v_f);
  end loop;
end;
$$;

do $$
begin
  alter default privileges for role postgres in schema public
    revoke execute on functions from anon;
exception when insufficient_privilege then
  raise notice '036: default privileges do postgres nao alterados (rode como postgres).';
end;
$$;

-- (3) search_path das DEFINER 019-035: pg_temp explicito no fim -------------------------------
do $$
declare
  v_f regprocedure;
begin
  for v_f in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proconfig @> array['search_path=pg_catalog']
  loop
    execute format('alter function %s set search_path = pg_catalog, pg_temp', v_f);
  end loop;
end;
$$;

commit;
