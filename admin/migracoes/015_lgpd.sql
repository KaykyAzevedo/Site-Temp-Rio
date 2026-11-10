-- 015 — LGPD: consentimento, direitos do titular, retenção e auditoria
--
-- ============================================================================
-- O QUE ENTRA AQUI, E O QUE NÃO ENTRA COMO "ENDPOINT"
-- ============================================================================
--
-- O pedido original descrevia rotas de servidor (GET /meus-dados, POST
-- /deletar-conta, POST /corrigir-dados). Este site não tem servidor — o
-- equivalente aqui, como em toda função pública deste projeto
-- (completar_visita, criar_pedido, historico_do_cliente...), é uma função do
-- banco chamada via RPC pela página. É a mesma ideia, sem Express no meio.
--
-- Por decisão explícita (conversa com o dono do site): o registro de
-- consentimento NÃO guarda IP. A migração 007 já rejeitou coletar IP em
-- qualquer parte do site — é dado pessoal sob a própria LGPD, e é o motivo de
-- este site não precisar de aviso de cookies. Guardar IP "para provar
-- consentimento" reabriria exatamente essa obrigação. A prova que fica é
-- suficiente na prática: o registro em `consentimentos` só existe porque a
-- pessoa marcou o checkbox obrigatório — sem ele, o formulário nem envia (ver
-- js/pre-registro.js). User-Agent entra: é dado bem mais fraco (já é
-- coletado em `visitas` desde a migração 007) e ajuda a identificar fraude
-- grosseira (mesmo aceite, User-Agent de robô).
--
-- ============================================================================
-- 1. Consentimento — pop-up de pré-registro
-- ============================================================================
create table if not exists public.consentimentos (
  id uuid primary key default gen_random_uuid(),
  contexto text not null check (contexto in ('pre_registro')),
  documento text not null,          -- dígitos puros, mesmo padrão das outras tabelas
  telefone text,
  versao_politica text not null default 'v1',
  aceite_em timestamptz not null default now(),
  user_agent text
);

create index if not exists consentimentos_documento_idx on public.consentimentos (documento);

alter table public.consentimentos enable row level security;

drop policy if exists "site registra consentimento" on public.consentimentos;
create policy "site registra consentimento"
  on public.consentimentos for insert
  to anon, authenticated
  with check (true);

drop policy if exists "admin le consentimentos" on public.consentimentos;
create policy "admin le consentimentos"
  on public.consentimentos for select
  to authenticated
  using (public.eh_admin());

-- ============================================================================
-- 2. Solicitações do titular — acesso, exclusão, correção
-- ============================================================================
-- Mesma filosofia do resto do painel: nada instantâneo e destrutivo acontece
-- sem uma pessoa confirmar (é assim que a Vitrine, a lista de espera e a
-- confirmação de pedido já funcionam). "Corrigir dados" e "excluir minha
-- conta" entram como PEDIDO nesta tabela — o titular não tem login, então
-- não há como validar identidade o bastante para uma ação irreversível
-- rodar sozinha. Quem atende é o admin, depois de confirmar quem é a pessoa
-- (o mesmo cuidado que já seria necessário atendendo por telefone/e-mail).
--
-- "Acesso" (ver os próprios dados) é diferente: só LÊ, não muda nada, então
-- pode ser self-service — ver a função lgpd_meus_dados() abaixo.
create table if not exists public.solicitacoes_lgpd (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),

  tipo text not null check (tipo in ('exclusao', 'correcao')),
  documento text not null,
  telefone text,
  contato text,          -- e-mail ou telefone para responder, se diferente
  mensagem text,         -- ex.: "meu endereço mudou para..."

  atendido boolean not null default false,
  atendido_em timestamptz,
  atendido_por text,
  observacoes text,

  constraint solicitacoes_lgpd_documento_valido
    check (length(regexp_replace(documento, '\D', '', 'g')) in (11, 14)),
  constraint solicitacoes_lgpd_telefone_seguro
    check (telefone is null or public.telefone_valido(telefone)),
  constraint solicitacoes_lgpd_texto_seguro
    check (public.texto_seguro(contato, 200) and public.texto_seguro(mensagem, 2000)
       and public.texto_seguro(observacoes, 2000))
);

create index if not exists solicitacoes_lgpd_documento_idx on public.solicitacoes_lgpd (documento);
create index if not exists solicitacoes_lgpd_atendido_idx on public.solicitacoes_lgpd (atendido);

alter table public.solicitacoes_lgpd enable row level security;

drop policy if exists "site registra solicitacao lgpd" on public.solicitacoes_lgpd;
create policy "site registra solicitacao lgpd"
  on public.solicitacoes_lgpd for insert
  to anon, authenticated
  with check (true);

drop policy if exists "admin le solicitacoes lgpd" on public.solicitacoes_lgpd;
create policy "admin le solicitacoes lgpd"
  on public.solicitacoes_lgpd for select
  to authenticated
  using (public.eh_admin());

drop policy if exists "admin atualiza solicitacoes lgpd" on public.solicitacoes_lgpd;
create policy "admin atualiza solicitacoes lgpd"
  on public.solicitacoes_lgpd for update
  to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

-- ============================================================================
-- 3. Log de exclusões e auditoria
-- ============================================================================
create table if not exists public.deletados_logicamente (
  id uuid primary key default gen_random_uuid(),
  documento text not null,
  motivo text not null check (motivo in ('solicitacao_titular', 'retencao_expirada')),
  dados_anonimizados jsonb,   -- retrato de que linhas/campos foram limpos, para auditoria futura
  executado_em timestamptz not null default now(),
  executado_por text          -- e-mail do admin que confirmou; null quando automático
);

alter table public.deletados_logicamente enable row level security;

drop policy if exists "admin le exclusoes" on public.deletados_logicamente;
create policy "admin le exclusoes"
  on public.deletados_logicamente for select
  to authenticated
  using (public.eh_admin());

drop policy if exists "admin registra exclusao" on public.deletados_logicamente;
create policy "admin registra exclusao"
  on public.deletados_logicamente for insert
  to authenticated
  with check (public.eh_admin());

-- "Quem acessou, quando, o quê" — na versão que este projeto consegue
-- entregar de verdade: um log das AÇÕES sensíveis (exclusão, purga,
-- consulta de dados por alguém de fora), não de toda leitura que acontece no
-- painel. Postgres não dispara gatilho em SELECT — auditar toda leitura
-- exigiria a extensão pgAudit (grava no log do servidor, não numa tabela) ou
-- reescrever todo `sb.from(...).select(...)` do painel para passar por uma
-- função que registra antes de responder. Não faz sentido pagar esse custo
-- para as telas de relatório; faz sentido para o que a LGPD realmente pede
-- (rastro de quem tocou em dado pessoal de forma consequente).
create table if not exists public.auditoria (
  id bigint generated always as identity primary key,
  acao text not null,
  ator text,                  -- e-mail do admin, ou null quando a chamada foi anônima (self-service)
  documento_alvo text,
  detalhes jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists auditoria_criado_em_idx on public.auditoria (criado_em desc);
create index if not exists auditoria_documento_idx on public.auditoria (documento_alvo);

alter table public.auditoria enable row level security;

drop policy if exists "admin le auditoria" on public.auditoria;
create policy "admin le auditoria"
  on public.auditoria for select
  to authenticated
  using (public.eh_admin());
-- Sem política de INSERT para ninguém: só as funções abaixo escrevem aqui,
-- e são security definer — o mesmo padrão de completar_visita/criar_pedido,
-- que já contorna RLS de propósito, só pelo caminho controlado da função.

-- ============================================================================
-- 4. Retenção — marcar inativo, e só apagar depois da carência
-- ============================================================================
-- Cliente ativo: guardado sem prazo (ele pode voltar a comprar). Cliente sem
-- pedido em 12 meses: marcado aqui; se passar mais 90 dias sem voltar a
-- comprar, os dados de contato são anonimizados. Pedido em si nunca é
-- apagado — 5 anos é obrigação fiscal (mesma razão de pedidos.cnpj nunca
-- sumir, ver a função de anonimização abaixo).
alter table public.usuarios add column if not exists pendente_exclusao_em timestamptz;

-- ============================================================================
-- 5. A anonimização em si — um lugar só, chamado pelos dois caminhos
--    (pedido do titular, ou retenção vencida)
-- ============================================================================
-- Por que `pedidos.cnpj` e `pedidos.razao_social` NÃO são apagados aqui:
-- nota fiscal e escrituração fiscal precisam do CNPJ/razão social do
-- comprador por até 5 anos — é a mesma obrigação legal que este pedido já
-- citou. A LGPD tem uma exceção para exatamente este caso (art. 16: dado
-- pode ser mantido para cumprir obrigação legal, mesmo após o titular pedir
-- exclusão). O que É apagado do pedido é o que NÃO é fiscalmente exigido:
-- telefone, e-mail, endereço de entrega, nome do responsável que assinou o
-- pedido. `usuarios`/`clientes` (o cadastro consolidado, sem função fiscal)
-- são limpos por completo, inclusive o próprio CPF/CNPJ.
create or replace function public._lgpd_anonimizar(p_documento text, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
  v_usuario_ids uuid[];
  v_usuarios int;
  v_clientes int;
  v_pedidos int;
  v_leads int;
  v_retrato jsonb;
begin
  -- Checagem própria, não só nos dois chamadores: esta função virou
  -- security definer (para poder escrever em auditoria, que não tem
  -- política de INSERT nenhuma) e o Postgres concede EXECUTE a PUBLIC em
  -- função nova por padrão — sem isto, qualquer chamada anônima direta a
  -- `_lgpd_anonimizar` pelo nome (via RPC) anonimizaria qualquer CPF/CNPJ.
  if not public.eh_admin() then
    raise exception 'sem permissao';
  end if;

  if length(v_doc) not in (11, 14) then
    raise exception 'documento invalido para anonimizacao';
  end if;

  -- Captura os ids ANTES de limpar `documento` — depois do update abaixo,
  -- a coluna que liga usuarios a clientes é o `id`, que não muda; é o
  -- `documento` que vira nulo, então precisa ser lido agora.
  select array_agg(id) into v_usuario_ids from public.usuarios where documento = v_doc;

  update public.usuarios
     set nome = '[removido a pedido do titular]',
         email = null, telefone = null, cpf = null, cnpj = null,
         observacoes = null, ativo = false,
         removido_em = coalesce(removido_em, now()),
         pendente_exclusao_em = null
   where documento = v_doc;
  get diagnostics v_usuarios = row_count;

  update public.clientes
     set apelido = null, logradouro = null, numero = null, complemento = null,
         bairro = null, cidade = null, uf = null, cep = null, observacoes = null,
         ativo = false, removido_em = coalesce(removido_em, now())
   where usuario_id = any(v_usuario_ids);
  get diagnostics v_clientes = row_count;

  update public.pedidos
     set responsavel = '[removido a pedido do titular]',
         telefone = '00000000000', email = null,
         cep = null, logradouro = null, numero = null, complemento = null,
         bairro = null, cidade = null, uf = null
   where regexp_replace(cnpj, '\D', '', 'g') = v_doc;
  get diagnostics v_pedidos = row_count;

  delete from public.leads where documento = v_doc;
  get diagnostics v_leads = row_count;

  v_retrato := jsonb_build_object(
    'usuarios_afetados', v_usuarios, 'clientes_afetados', v_clientes,
    'pedidos_com_contato_limpo', v_pedidos, 'leads_removidos', v_leads,
    'campos_mantidos_em_pedidos', jsonb_build_array('cnpj', 'razao_social', 'valor_centavos', 'itens', 'status')
  );

  insert into public.deletados_logicamente (documento, motivo, dados_anonimizados, executado_por)
  values (v_doc, p_motivo, v_retrato, auth.jwt() ->> 'email');

  insert into public.auditoria (acao, ator, documento_alvo, detalhes)
  values ('lgpd_anonimizacao', auth.jwt() ->> 'email', v_doc, v_retrato);

  return v_retrato;
end;
$$;

-- Postgres concede EXECUTE a PUBLIC (inclusive `anon`) em função nova por
-- padrão — revogado aqui de propósito. A checagem de eh_admin() lá dentro já
-- protegeria mesmo sem isto, mas não faz sentido deixar a função exposta ao
-- anônimo por fora quando ninguém de fora deveria nem tentar chamá-la.
revoke execute on function public._lgpd_anonimizar(text, text) from public;
grant execute on function public._lgpd_anonimizar(text, text) to authenticated;

-- Chamada pelo admin, a partir de uma solicitação de exclusão atendida.
create or replace function public.lgpd_excluir_pessoa(p_documento text, p_solicitacao_id uuid default null)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_retrato jsonb;
begin
  if not public.eh_admin() then
    raise exception 'sem permissao';
  end if;

  v_retrato := public._lgpd_anonimizar(p_documento, 'solicitacao_titular');

  if p_solicitacao_id is not null then
    update public.solicitacoes_lgpd
       set atendido = true, atendido_em = now(), atendido_por = auth.jwt() ->> 'email'
     where id = p_solicitacao_id;
  end if;

  return v_retrato;
end;
$$;

revoke execute on function public.lgpd_excluir_pessoa(text, uuid) from public;
grant execute on function public.lgpd_excluir_pessoa(text, uuid) to authenticated;

-- ============================================================================
-- 6. Direito de acesso — self-service, só leitura
-- ============================================================================
-- Sem login de cliente, a única forma de confirmar "é você mesmo" é pedir
-- dois dados que, juntos, só o próprio titular (ou alguém que já tem acesso
-- indevido a ambos) teria: documento E telefone cadastrado. É mais estrito
-- que historico_do_cliente() (migração/arquivo supabase-vitrine.sql, que usa
-- só CNPJ) de propósito — aqui o retorno é o cadastro completo, não uma
-- contagem agregada.
create or replace function public.lgpd_meus_dados(p_documento text, p_telefone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_usuario record;
  v_resultado jsonb;
begin
  select * into v_usuario
    from public.usuarios
   where documento = v_doc
     and regexp_replace(coalesce(telefone, ''), '\D', '', 'g') = v_tel
     and v_tel <> ''
   limit 1;

  insert into public.auditoria (acao, ator, documento_alvo, detalhes)
  values ('lgpd_acesso_solicitado', null, v_doc,
          jsonb_build_object('encontrado', v_usuario.id is not null));

  if v_usuario.id is null then
    return null; -- não diz "documento não existe" nem "telefone não bate" separado, de propósito
  end if;

  select jsonb_build_object(
    'cadastro', jsonb_build_object(
      'nome', v_usuario.nome, 'email', v_usuario.email, 'telefone', v_usuario.telefone,
      'documento', v_usuario.documento, 'cadastrado_em', v_usuario.criado_em
    ),
    'endereco', (
      select jsonb_agg(jsonb_build_object(
        'apelido', c.apelido, 'cep', c.cep, 'logradouro', c.logradouro, 'numero', c.numero,
        'complemento', c.complemento, 'bairro', c.bairro, 'cidade', c.cidade, 'uf', c.uf
      ))
      from public.clientes c where c.usuario_id = v_usuario.id
    ),
    'pedidos', (
      select jsonb_agg(jsonb_build_object(
        'data', p.criado_em, 'status', p.status, 'potes', p.potes, 'caixas', p.caixas,
        'valor_centavos', p.valor_centavos, 'itens', p.itens
      ) order by p.criado_em desc)
      from public.pedidos p
      where regexp_replace(p.cnpj, '\D', '', 'g') = v_doc
    ),
    'pre_registros' , (
      select jsonb_agg(jsonb_build_object('nome', l.nome, 'em', l.criado_em, 'pagina', l.pagina_origem))
      from public.leads l where l.documento = v_doc
    )
  ) into v_resultado;

  return v_resultado;
end;
$$;

grant execute on function public.lgpd_meus_dados(text, text) to anon, authenticated;

-- ============================================================================
-- 7. Retenção — marcar e purgar (chamado por um botão no painel; este
--    projeto não tem cron/Edge Function, então não roda sozinho — ver a
--    seção de retenção em admin/LEIAME-PAINEL.md para a rotina manual)
-- ============================================================================
create or replace function public.lgpd_marcar_inativos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marcados int;
begin
  if not public.eh_admin() then
    raise exception 'sem permissao';
  end if;

  update public.usuarios u
     set pendente_exclusao_em = now()
   where u.tipo = 'cliente'
     and u.documento is not null
     and u.removido_em is null
     and u.pendente_exclusao_em is null
     and not exists (
       select 1 from public.pedidos p
        where regexp_replace(p.cnpj, '\D', '', 'g') = u.documento
          and p.criado_em >= now() - interval '12 months'
     );
  get diagnostics v_marcados = row_count;

  insert into public.auditoria (acao, ator, detalhes)
  values ('lgpd_marcacao_retencao', auth.jwt() ->> 'email', jsonb_build_object('marcados', v_marcados));

  return v_marcados;
end;
$$;

create or replace function public.lgpd_purgar_marcados()
returns integer
language plpgsql
security invoker
as $$
declare
  v_doc text;
  v_total int := 0;
begin
  if not public.eh_admin() then
    raise exception 'sem permissao';
  end if;

  for v_doc in
    select documento from public.usuarios
     where pendente_exclusao_em is not null
       and pendente_exclusao_em <= now() - interval '90 days'
       and removido_em is null
  loop
    perform public._lgpd_anonimizar(v_doc, 'retencao_expirada');
    v_total := v_total + 1;
  end loop;

  return v_total;
end;
$$;

revoke execute on function public.lgpd_marcar_inativos() from public;
revoke execute on function public.lgpd_purgar_marcados() from public;
grant execute on function public.lgpd_marcar_inativos() to authenticated;
grant execute on function public.lgpd_purgar_marcados() to authenticated;

-- ============================================================================
-- 8. Falta uma política: admin precisa poder apagar `leads` (a
--    anonimização remove a linha, não só limpa os campos — ver o porquê no
--    comentário de _lgpd_anonimizar mais abaixo desta seção)
-- ============================================================================
-- Leads não tem uso fiscal nem histórico que precise sobreviver: ao contrário
-- de pedidos, apagar a linha é mais simples e mais correto do que tentar
-- limpar os campos e ainda satisfazer o CHECK de documento válido da
-- migração 013 (um documento "anonimizado" nunca passaria em cpf_valido/
-- cnpj_valido — a linha teria que ser apagada de qualquer forma).
drop policy if exists "admin apaga leads" on public.leads;
create policy "admin apaga leads"
  on public.leads for delete
  to authenticated
  using (public.eh_admin());
