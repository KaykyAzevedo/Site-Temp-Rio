-- 048: Tela "Usuários" do painel (Edge Function usuarios-admin): auditoria + UMA RPC que muda os acessos.
-- NAO APLICADA. Idempotente. Requer 013 (texto_seguro), 014 (eh_admin) e 047 (rota_motoristas/rota_veiculos).
-- pg_cron e opcional (so a limpeza do log).
--
-- (1) usuarios_log: quem (ator_id/ator_email), quando, acao (criar | redefinir_senha | alterar | desativar | reativar),
--     alvo e um detalhe curto (tipo/veiculo, ex.: 'vendedor+rota → motorista/strada'). NUNCA senha, token ou metadado
--     cru. Escrita: a RPC abaixo (na MESMA transacao da mudanca de papel) e notas de falha da funcao (service_role).
--     Leitura: so admin. Ninguem edita linha. Limpeza: mais de 2 anos.
-- (2) usuarios_048_operacao: reserva curta (2 min) de uma operacao que tem etapa no Auth fora do banco (desativar =
--     tira o papel e DEPOIS bloqueia o login; reativar = libera o login e DEPOIS devolve o papel). Enquanto a reserva
--     vale, outra mudanca no mesmo usuario e recusada (em_andamento). So a RPC le/escreve (nenhum papel tem grant).
-- (3) usuarios_048_aplicar(p jsonb): SECURITY DEFINER, search_path vazio, EXECUTE so service_role (a funcao, depois de
--     validar o JWT). Numa transacao, sob pg_advisory_xact_lock(5100, 4801) (todas as mudancas de acesso em fila):
--       - re-confere que o ATOR ainda e admin agora (mesma regra do eh_admin: admins.email = e-mail EXATO do JWT, papel
--         admin) e que o login dele existe e nao esta bloqueado;
--       - le o alvo pelo id no auth.users e usa o e-mail EXATO dele como chave de admins (o mesmo que o JWT traz);
--         linha em admins que difere so em maiusculas/minusculas = conflito (variante_email), nada e mudado;
--       - travas: ninguem desativa/tira o proprio admin; nunca fica sem admin ativo; veiculo ativo porta a porta;
--       - muda admins / rota_motoristas, confere o estado final e grava usuarios_log — tudo junto ou nada.
--     Ordem com o Auth (na funcao) = menor privilegio se algo falhar no meio: criar = login sem acesso e SO depois o
--     papel (falhou: apaga o login); desativar = tira o papel ANTES do bloqueio; reativar = libera o login e SO depois
--     devolve o papel; alterar/senha = so banco (o app_metadata e so exibicao).
-- Nenhuma mudanca em admins: o nome exibido e o "ultimo tipo" ficam no app_metadata do Auth (so o servidor escreve).
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('public.eh_admin()') is null or to_regprocedure('public.texto_seguro(text,integer)') is null
     or to_regclass('public.rota_motoristas') is null or to_regclass('public.rota_veiculos') is null then
    raise exception '048 requer 013 (texto_seguro), 014 (eh_admin) e 047 (rota_motoristas). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 48);

-- ===================== (1) usuarios_log =====================
create table if not exists public.usuarios_log (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  ator_id uuid,
  ator_email text,
  acao text not null,
  alvo_id uuid,
  alvo_email text,
  detalhe text
);
alter table public.usuarios_log drop constraint if exists usuarios_log_048_acao;
alter table public.usuarios_log add constraint usuarios_log_048_acao
  check (acao in ('criar', 'redefinir_senha', 'alterar', 'desativar', 'reativar'));
alter table public.usuarios_log drop constraint if exists usuarios_log_048_textos;
alter table public.usuarios_log add constraint usuarios_log_048_textos
  check ((ator_email is null or char_length(ator_email) <= 254) and (alvo_email is null or char_length(alvo_email) <= 254)
         and (detalhe is null or (char_length(detalhe) <= 200 and public.texto_seguro(detalhe, 200))));
create index if not exists usuarios_log_048_criado_idx on public.usuarios_log (criado_em desc);
create index if not exists usuarios_log_048_alvo_idx on public.usuarios_log (alvo_id);

alter table public.usuarios_log enable row level security;
revoke all on public.usuarios_log from public, anon, authenticated;
grant select on public.usuarios_log to authenticated;
grant select, insert on public.usuarios_log to service_role;
-- log nao se edita: nem a funcao (service_role) altera linha; apagar so pela limpeza (abaixo)
revoke update, truncate on public.usuarios_log from service_role;

drop policy if exists usuarios_048_admin_le on public.usuarios_log;
create policy usuarios_048_admin_le on public.usuarios_log for select to authenticated
  using ((select public.eh_admin()));

create or replace function public.usuarios_048_limpar()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare v_n integer;
begin
  delete from public.usuarios_log where criado_em < now() - interval '2 years';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.usuarios_048_limpar() from public, anon, authenticated;
grant execute on function public.usuarios_048_limpar() to service_role;
grant delete on public.usuarios_log to service_role;

-- ===================== (2) reserva de operacao com etapa no Auth =====================
create table if not exists public.usuarios_048_operacao (
  alvo_id uuid primary key,
  token uuid not null,
  acao text not null check (acao in ('desativar', 'reativar')),
  ator_id uuid,
  criado_em timestamptz not null default now()
);
alter table public.usuarios_048_operacao enable row level security;
revoke all on public.usuarios_048_operacao from public, anon, authenticated, service_role;

-- ===================== (3) RPC =====================
-- p: { fase: checar|reservar|aplicar|concluir|cancelar, acao, ator_id, ator_email, alvo_id?, email? (criar/checar),
--      tipo?, veiculo_id?, marca_rota?, nome?, token? (concluir/cancelar/aplicar do reativar), falhou? (concluir) }
-- Devolve { ok: true, antes, depois, email, token? } ou { ok: false, erro } (sem mudar nada). Erro inesperado = exception
-- (a transacao inteira volta: papel e log juntos).
create or replace function public.usuarios_048_aplicar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fase text := coalesce(p->>'fase', 'aplicar');
  v_acao text := p->>'acao';
  v_ator uuid; v_alvo uuid; v_token uuid;
  v_ator_email text := p->>'ator_email';
  v_email text; v_ban timestamptz; v_banido boolean := false;
  v_tipo text := nullif(p->>'tipo', '');
  v_veic text := nullif(p->>'veiculo_id', '');
  v_marca boolean;
  v_nome text := nullif(btrim(coalesce(p->>'nome', '')), '');
  a_papel text; a_marca boolean; m_veic text; m_ativo boolean; m_nome text;
  v_antes text; v_veic_antes text; v_marca_antes boolean;
  v_novo text; v_veic_novo text; v_marca_nova boolean := false;
  v_depois text; v_op_token uuid; v_op_acao text;
  v_det text;
begin
  if v_fase not in ('checar', 'reservar', 'aplicar', 'concluir', 'cancelar')
     or v_acao is null or v_acao not in ('criar', 'redefinir_senha', 'alterar', 'desativar', 'reativar') then
    return jsonb_build_object('ok', false, 'erro', 'acao_invalida');
  end if;
  begin
    v_ator := nullif(p->>'ator_id', '')::uuid;
    v_alvo := nullif(p->>'alvo_id', '')::uuid;
    v_token := nullif(p->>'token', '')::uuid;
    v_marca := (p->>'marca_rota')::boolean;
  exception when others then
    return jsonb_build_object('ok', false, 'erro', 'id_invalido');
  end;

  -- todas as mudancas de acesso em fila (entre instancias da funcao): a decisao e o efeito no banco sao atomicos
  perform pg_catalog.pg_advisory_xact_lock(5100, 4801);
  delete from public.usuarios_048_operacao where criado_em <= now() - interval '2 minutes';

  -- concluir/cancelar so fecham uma reserva desta mesma operacao (token)
  if v_fase in ('concluir', 'cancelar') then
    select o.token, o.acao into v_op_token, v_op_acao from public.usuarios_048_operacao o where o.alvo_id = v_alvo;
    if v_op_token is null or v_token is null or v_op_token <> v_token or v_op_acao <> v_acao then
      return jsonb_build_object('ok', false, 'erro', 'operacao_expirada');
    end if;
    delete from public.usuarios_048_operacao where alvo_id = v_alvo;
    if v_fase = 'concluir' and coalesce((p->>'falhou')::boolean, false) then
      insert into public.usuarios_log (ator_id, ator_email, acao, alvo_id, alvo_email, detalhe)
      select v_ator, v_ator_email, v_acao, v_alvo, u.email,
             case when v_acao = 'desativar' then 'bloqueio do login FALHOU: acesso aos dados ja retirado; repita Desativar'
                  else 'liberar o login FALHOU: nada mudou' end
        from auth.users u where u.id = v_alvo;
    end if;
    return jsonb_build_object('ok', true);
  end if;

  -- 1) o ATOR ainda e admin AGORA (mesma regra do eh_admin: e-mail exato do JWT), com login existente e nao bloqueado
  if v_ator is null or v_ator_email is null or not exists (
       select 1 from auth.users u join public.admins a on a.email = u.email
        where u.id = v_ator and u.email = v_ator_email and a.papel = 'admin'
          and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())) then
    return jsonb_build_object('ok', false, 'erro', 'somente_admin');
  end if;

  -- 2) criar, antes de existir o login: so confere (o login e criado depois, SEM acesso)
  if v_acao = 'criar' and v_alvo is null then
    if v_fase <> 'checar' then return jsonb_build_object('ok', false, 'erro', 'acao_invalida'); end if;
    v_email := p->>'email';
    if v_email is null or v_email = '' then return jsonb_build_object('ok', false, 'erro', 'email_invalido'); end if;
    if exists (select 1 from auth.users u where lower(u.email) = lower(v_email)) then
      return jsonb_build_object('ok', false, 'erro', 'email_existe');
    end if;
    if exists (select 1 from public.admins a where lower(a.email) = lower(v_email) and a.email <> v_email) then
      return jsonb_build_object('ok', false, 'erro', 'variante_email');
    end if;
    if v_tipo is null or v_tipo not in ('admin', 'vendedor', 'motorista') then
      return jsonb_build_object('ok', false, 'erro', 'tipo_invalido');
    end if;
    if v_tipo = 'motorista' and not exists (select 1 from public.rota_veiculos v where v.id = v_veic and v.ativo and v.modo = 'porta') then
      return jsonb_build_object('ok', false, 'erro', case when v_veic is null then 'veiculo_obrigatorio' else 'veiculo_inativo' end);
    end if;
    return jsonb_build_object('ok', true);
  end if;

  -- 3) alvo: pelo id no Auth; a chave de admins e o e-mail EXATO do login (o mesmo do JWT dele)
  select u.email, u.banned_until into v_email, v_ban from auth.users u where u.id = v_alvo and u.deleted_at is null;
  if v_alvo is null or v_email is null then
    return jsonb_build_object('ok', false, 'erro', 'usuario_nao_encontrado');
  end if;
  v_banido := v_ban is not null and v_ban > now();
  if exists (select 1 from public.admins a where lower(a.email) = lower(v_email) and a.email <> v_email) then
    return jsonb_build_object('ok', false, 'erro', 'variante_email');
  end if;

  -- reserva de outra operacao em andamento neste usuario?
  select o.token, o.acao into v_op_token, v_op_acao from public.usuarios_048_operacao o where o.alvo_id = v_alvo;
  if v_fase = 'aplicar' and v_acao = 'reativar' then
    if v_op_token is null or v_token is null or v_op_token <> v_token or v_op_acao <> 'reativar' then
      return jsonb_build_object('ok', false, 'erro', 'operacao_expirada');
    end if;
  elsif v_op_token is not null then
    return jsonb_build_object('ok', false, 'erro', 'em_andamento');
  end if;

  select a.papel, a.marca_rota into a_papel, a_marca from public.admins a where a.email = v_email;
  select m.veiculo_id, m.ativo, m.nome into m_veic, m_ativo, m_nome from public.rota_motoristas m where m.user_id = v_alvo;
  v_antes := case when a_papel in ('admin', 'vendedor') then a_papel when coalesce(m_ativo, false) then 'motorista' else 'sem_acesso' end;
  v_veic_antes := case when v_antes = 'motorista' then m_veic end;
  v_marca_antes := a_papel = 'vendedor' and coalesce(a_marca, false);

  -- 4) o que a acao quer
  if v_acao = 'criar' then
    if v_fase <> 'aplicar' then return jsonb_build_object('ok', false, 'erro', 'acao_invalida'); end if;
    if v_banido then return jsonb_build_object('ok', false, 'erro', 'desativado'); end if;
    v_novo := v_tipo;
  elsif v_acao = 'redefinir_senha' then
    if v_fase <> 'aplicar' then return jsonb_build_object('ok', false, 'erro', 'acao_invalida'); end if;
    if v_banido then return jsonb_build_object('ok', false, 'erro', 'desativado'); end if;
    v_novo := v_antes;
  elsif v_acao = 'alterar' then
    if v_fase <> 'aplicar' then return jsonb_build_object('ok', false, 'erro', 'acao_invalida'); end if;
    if v_banido then return jsonb_build_object('ok', false, 'erro', 'desativado'); end if;
    v_novo := coalesce(v_tipo, nullif(v_antes, 'sem_acesso'));
  elsif v_acao = 'desativar' then
    if v_fase <> 'reservar' then return jsonb_build_object('ok', false, 'erro', 'acao_invalida'); end if;
    v_novo := 'sem_acesso';
  else -- reativar: reservar (login ainda bloqueado) -> o Auth libera -> aplicar (login ja liberado)
    if v_fase not in ('reservar', 'aplicar') then return jsonb_build_object('ok', false, 'erro', 'acao_invalida'); end if;
    if v_fase = 'reservar' and not v_banido then return jsonb_build_object('ok', false, 'erro', 'ja_ativo'); end if;
    if v_fase = 'aplicar' and v_banido then return jsonb_build_object('ok', false, 'erro', 'desativado'); end if;
    v_novo := v_tipo;
  end if;
  if v_novo is null or v_novo not in ('admin', 'vendedor', 'motorista', 'sem_acesso')
     or (v_novo = 'sem_acesso' and v_acao not in ('desativar', 'redefinir_senha')) then
    return jsonb_build_object('ok', false, 'erro', case when v_acao = 'reativar' then 'tipo_desconhecido' else 'tipo_invalido' end);
  end if;
  if v_acao = 'redefinir_senha' then
    v_veic_novo := v_veic_antes;   -- senha nao mexe em papel nem veiculo
  elsif v_novo = 'motorista' then
    v_veic_novo := coalesce(v_veic, case when v_acao = 'alterar' then m_veic end);
    if not exists (select 1 from public.rota_veiculos v where v.id = v_veic_novo and v.ativo and v.modo = 'porta') then
      return jsonb_build_object('ok', false, 'erro', case when v_veic_novo is null then 'veiculo_obrigatorio' else 'veiculo_inativo' end);
    end if;
  end if;
  v_marca_nova := v_novo = 'vendedor' and coalesce(v_marca, case when v_acao in ('alterar', 'redefinir_senha') then v_marca_antes end, false);

  -- 5) travas (sob o lock: a contagem nao muda no meio)
  if v_acao = 'desativar' and v_alvo = v_ator then return jsonb_build_object('ok', false, 'erro', 'si_mesmo'); end if;
  if v_antes = 'admin' and v_novo <> 'admin' then
    if v_alvo = v_ator then return jsonb_build_object('ok', false, 'erro', 'si_mesmo'); end if;
    if not exists (select 1 from public.admins a join auth.users u on u.email = a.email
                    where a.papel = 'admin' and u.id <> v_alvo and u.deleted_at is null
                      and (u.banned_until is null or u.banned_until <= now())) then
      return jsonb_build_object('ok', false, 'erro', 'ultimo_admin');
    end if;
  end if;

  if v_fase = 'checar' then
    return jsonb_build_object('ok', true, 'antes', v_antes, 'depois', v_novo, 'email', v_email);
  end if;

  -- reativar/reservar: so marca a operacao (o papel volta no 'aplicar', depois que o Auth liberar o login)
  if v_acao = 'reativar' and v_fase = 'reservar' then
    v_token := gen_random_uuid();
    insert into public.usuarios_048_operacao (alvo_id, token, acao, ator_id) values (v_alvo, v_token, 'reativar', v_ator);
    return jsonb_build_object('ok', true, 'token', v_token, 'antes', v_antes, 'depois', v_novo, 'email', v_email);
  end if;

  -- 6) aplica no banco (redefinir_senha nao muda papel)
  if v_acao <> 'redefinir_senha' then
    if v_novo in ('admin', 'vendedor') then
      insert into public.admins (email, papel, marca_rota) values (v_email, v_novo, v_marca_nova)
        on conflict (email) do update set papel = excluded.papel, marca_rota = excluded.marca_rota;
      update public.rota_motoristas set ativo = false where user_id = v_alvo and ativo;
    elsif v_novo = 'motorista' then
      delete from public.admins where email = v_email;
      insert into public.rota_motoristas (user_id, veiculo_id, nome, ativo)
        values (v_alvo, v_veic_novo, coalesce(v_nome, m_nome), true)
        on conflict (user_id) do update set veiculo_id = excluded.veiculo_id, nome = excluded.nome, ativo = true;
    else
      delete from public.admins where email = v_email;
      update public.rota_motoristas set ativo = false where user_id = v_alvo and ativo;
    end if;
  end if;

  -- 7) confere o estado final (nao confia so na ausencia de erro)
  a_papel := null; m_ativo := null;
  select a.papel into a_papel from public.admins a where a.email = v_email;
  select m.ativo into m_ativo from public.rota_motoristas m where m.user_id = v_alvo;
  v_depois := case when a_papel in ('admin', 'vendedor') then a_papel when coalesce(m_ativo, false) then 'motorista' else 'sem_acesso' end;
  if v_depois <> v_novo or (v_novo <> 'motorista' and coalesce(m_ativo, false))
     or exists (select 1 from public.admins a where lower(a.email) = lower(v_email) and a.email <> v_email) then
    raise exception 'usuarios_048: estado final % <> %', v_depois, v_novo;
  end if;

  -- 8) auditoria na MESMA transacao (sem senha)
  v_det := case
    when v_acao = 'criar' then 'tipo ' || v_novo || coalesce('/' || v_veic_novo, '') || case when v_marca_nova then '+rota' else '' end
    when v_acao = 'redefinir_senha' then 'senha nova pedida (' || v_antes || ')'
    else v_antes || coalesce('/' || v_veic_antes, '') || case when v_marca_antes then '+rota' else '' end || ' → '
         || v_novo || coalesce('/' || v_veic_novo, '') || case when v_marca_nova then '+rota' else '' end
         || case when v_acao = 'desativar' then ' (login bloqueado a seguir)' else '' end
  end;
  insert into public.usuarios_log (ator_id, ator_email, acao, alvo_id, alvo_email, detalhe)
  values (v_ator, v_ator_email, v_acao, v_alvo, v_email, left(v_det, 200));

  -- desativar: a reserva segura a operacao ate o Auth bloquear o login (concluir); reativar: fecha a reserva
  if v_acao = 'desativar' then
    v_token := gen_random_uuid();
    insert into public.usuarios_048_operacao (alvo_id, token, acao, ator_id) values (v_alvo, v_token, 'desativar', v_ator);
  elsif v_acao = 'reativar' then
    delete from public.usuarios_048_operacao where alvo_id = v_alvo;
    v_token := null;
  end if;
  return jsonb_build_object('ok', true, 'antes', v_antes, 'depois', v_novo, 'email', v_email, 'token', v_token);
end;
$$;
revoke all on function public.usuarios_048_aplicar(jsonb) from public, anon, authenticated;
grant execute on function public.usuarios_048_aplicar(jsonb) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $j$select cron.unschedule(jobid) from cron.job where jobname = 'usuarios-limpeza-log'$j$;
    execute $j$select cron.schedule('usuarios-limpeza-log', '41 6 * * 1', 'select public.usuarios_048_limpar()')$j$;
  else
    raise notice '048: pg_cron nao instalado: limpeza de usuarios_log NAO agendada (rode select public.usuarios_048_limpar() de vez em quando).';
  end if;
end;
$$;

commit;
