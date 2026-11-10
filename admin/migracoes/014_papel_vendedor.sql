-- 014 — Papel de vendedor (RBAC sobre o Supabase Auth já existente)
--
-- ============================================================================
-- POR QUE ISTO NÃO É UM SISTEMA DE LOGIN NOVO
-- ============================================================================
--
-- O pedido original era um sistema de autenticação completo: bcrypt, JWT de
-- 15 minutos, refresh token de 7 dias, cookie httpOnly, rotas /login e
-- /refresh-token. Nada disso entra aqui, por um motivo simples: o painel já
-- tem isso, através do Supabase Auth (`sb.auth.signInWithPassword`, em
-- js/admin.js) — senha com hash seguro, JWT com expiração e renovação,
-- sessão que se invalida no `signOut()`. Reimplementar por cima seria pior
-- segurança que a de hoje, não melhor: é código de autenticação escrito à
-- mão, competindo com um serviço já auditado.
--
-- O que faltava de verdade — e o que esta migração resolve — é AUTORIZAÇÃO
-- por papel: hoje `admins` é uma lista simples, todo mundo nela tem acesso
-- total. Não existe um nível intermediário para "vendedor vê pedidos e
-- clientes, mas não mexe em região, vitrine ou catálogo".
--
-- `usuarios` (migração 004) CONTINUA não sendo tabela de login — ela é o
-- cadastro de quem COMPRA. Um vendedor da loja não é um "usuário" nesse
-- sentido; ele é uma segunda linha em `admins`, com um papel diferente.
--
-- CLIENTE (comprador logando para ver o próprio histórico) fica de fora,
-- também de propósito: o site inteiro é desenhado para checkout sem conta
-- (ver a nota grande no topo da migração 004, "por que estas tabelas não são
-- login"). Adicionar login de cliente é uma feature nova e grande — mudaria
-- a promessa do site — não uma peça de autorização a mais.
--
-- ============================================================================
-- 1. Papel em `admins`
-- ============================================================================
alter table public.admins add column if not exists papel text not null default 'admin'
  check (papel in ('admin', 'vendedor'));
-- default 'admin' preserva o comportamento de hoje para quem já está
-- cadastrado — ninguém perde acesso ao rodar esta migração.

-- ============================================================================
-- 2. Funções de autorização
-- ============================================================================
-- `eh_admin()` muda de sentido: antes era "está em admins" (qualquer papel);
-- agora é "está em admins E o papel é admin" — acesso total, como sempre foi
-- para quem já tinha essa linha (papel nasce 'admin' por default).
create or replace function public.eh_admin()
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1 from public.admins a
    where a.email = auth.jwt() ->> 'email' and a.papel = 'admin'
  );
$$;

-- Novo: "faz parte da equipe" — admin OU vendedor. É o gate mais largo,
-- usado só nas duas áreas que o vendedor precisa (pedidos, clientes/usuarios).
-- Todo o resto do painel continua atrás de eh_admin() sozinho, sem mudar
-- nada nas políticas que não são tocadas por esta migração.
create or replace function public.eh_equipe()
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1 from public.admins a
    where a.email = auth.jwt() ->> 'email'
  );
$$;

-- O painel usa isto para decidir o que mostrar (esconder aba é UX, não
-- segurança — a proteção de verdade são as políticas abaixo). Devolve null
-- para quem não está em `admins`, nunca erro.
create or replace function public.meu_papel()
returns text
language sql
stable
security invoker
as $$
  select a.papel from public.admins a where a.email = auth.jwt() ->> 'email';
$$;

grant execute on function public.eh_equipe() to authenticated;
grant execute on function public.meu_papel() to authenticated;

-- ============================================================================
-- 3. Pedidos — vendedor lê e atualiza (é o trabalho dele: confirmar/cancelar)
-- ============================================================================
drop policy if exists "admin le pedidos" on public.pedidos;
create policy "equipe le pedidos"
  on public.pedidos for select
  to authenticated
  using (public.eh_equipe());

drop policy if exists "admin atualiza pedidos" on public.pedidos;
create policy "equipe atualiza pedidos"
  on public.pedidos for update
  to authenticated
  using (public.eh_equipe())
  with check (public.eh_equipe());

-- A função abaixo tinha a própria checagem de admin, independente do RLS
-- (ver o cabeçalho da migração 008: "a checagem explícita transforma
-- 'nenhuma linha atualizada' numa mensagem que diz o que houve"). Sem
-- atualizar aqui, ela continuaria recusando vendedor mesmo com a política
-- de UPDATE já liberada — dois lugares dizendo coisas diferentes.
create or replace function public.atualizar_status_pedido(
  p_id uuid,
  p_status text,
  p_observacoes text default null
)
returns public.pedidos
language plpgsql
security invoker
as $$
declare
  v public.pedidos;
begin
  if p_status not in ('aguardando', 'confirmado', 'entregue', 'cancelado') then
    raise exception 'status invalido: %', p_status;
  end if;

  if not public.eh_equipe() then
    raise exception 'sem permissao';
  end if;

  update public.pedidos
     set status = p_status,
         observacoes = coalesce(p_observacoes, observacoes)
   where id = p_id
   returning * into v;

  return v;
end;
$$;

-- ============================================================================
-- 4. Usuários e clientes — vendedor lê e atualiza; criar/apagar continua só
--    admin (é o gatilho da 006 quem cria, de qualquer forma — "for all" no
--    lugar certo já cobria isso, e continua cobrindo)
-- ============================================================================
drop policy if exists "admin le usuarios" on public.usuarios;
create policy "equipe le usuarios"
  on public.usuarios for select
  to authenticated
  using (public.eh_equipe());

-- Policy adicional (permissiva, soma com "admin escreve usuarios" que já
-- existe para tudo): dá UPDATE à equipe sem tirar o INSERT/DELETE que
-- continua só de admin.
drop policy if exists "equipe atualiza usuarios" on public.usuarios;
create policy "equipe atualiza usuarios"
  on public.usuarios for update
  to authenticated
  using (public.eh_equipe())
  with check (public.eh_equipe());

drop policy if exists "admin le clientes" on public.clientes;
create policy "equipe le clientes"
  on public.clientes for select
  to authenticated
  using (public.eh_equipe());

drop policy if exists "equipe atualiza clientes" on public.clientes;
create policy "equipe atualiza clientes"
  on public.clientes for update
  to authenticated
  using (public.eh_equipe())
  with check (public.eh_equipe());

-- ============================================================================
-- Como dar acesso a um vendedor
-- ============================================================================
-- Mesmos passos 4 e 5 do admin/LEIAME-PAINEL.md (criar o usuário no
-- Authentication → Users do Supabase), e no SQL Editor:
--
--   insert into public.admins (email, papel) values ('vendedor@exemplo.com', 'vendedor');
--
-- Para promover ou rebaixar depois:
--
--   update public.admins set papel = 'admin' where email = 'vendedor@exemplo.com';
