-- 008 — Operações (CRUD) como funções do banco
--
-- Por que funções e não INSERT/UPDATE soltos do navegador:
--
--   - Uma operação que toca duas tabelas tem que ser tudo-ou-nada. Do
--     navegador, a conexão cai entre a primeira e a segunda chamada e sobra
--     meio pedido no banco, sem ninguém saber.
--   - A regra fica num lugar só. "Faturamento conta apenas confirmado ou
--     entregue" já vale para o dashboard; se o status pudesse ser escrito
--     direto, um valor fora da lista passaria e o relatório mentiria.
--
-- Todas as funções de admin usam `security invoker` (o padrão) — o RLS
-- continua valendo, e quem não é admin recebe erro, nunca dado. As duas que o
-- site anônimo chama são `security definer` e estão marcadas como tal, com o
-- motivo escrito em cima.

-- ============================================================================
-- 1. Criar pedido — uma chamada, atômica
-- ============================================================================
-- O site hoje faz INSERT direto em `pedidos` e os gatilhos da migração 006
-- cuidam do resto; isso continua funcionando e não precisa mudar.
--
-- Esta função é a alternativa para quando o site quiser criar o pedido e
-- receber o id de volta numa chamada só, sem depender do header `Prefer:
-- return=representation`.
create or replace function public.criar_pedido(p_pedido jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Lista de campos explícita, e não `jsonb_populate_record`: com definer, um
  -- jsonb solto deixaria o chamador escrever QUALQUER coluna — inclusive
  -- status 'confirmado', que inflaria o faturamento sem venda nenhuma.
  insert into public.pedidos (
    razao_social, cnpj, inscricao_estadual, responsavel, telefone, email,
    cep, logradouro, numero, complemento, bairro, cidade, uf,
    potes, caixas, valor_centavos, frete_centavos, regiao, itens, observacoes)
  values (
    p_pedido->>'razao_social',
    p_pedido->>'cnpj',
    p_pedido->>'inscricao_estadual',
    p_pedido->>'responsavel',
    p_pedido->>'telefone',
    p_pedido->>'email',
    p_pedido->>'cep',
    p_pedido->>'logradouro',
    p_pedido->>'numero',
    p_pedido->>'complemento',
    p_pedido->>'bairro',
    p_pedido->>'cidade',
    p_pedido->>'uf',
    coalesce((p_pedido->>'potes')::integer, 0),
    coalesce((p_pedido->>'caixas')::integer, 0),
    coalesce((p_pedido->>'valor_centavos')::bigint, 0),
    coalesce((p_pedido->>'frete_centavos')::bigint, 0),
    p_pedido->>'regiao',
    coalesce(p_pedido->'itens', '[]'::jsonb),
    p_pedido->>'observacoes'
  )
  returning id into v_id;   -- status nasce 'aguardando', pelo padrão da coluna

  return v_id;
end;
$$;

grant execute on function public.criar_pedido(jsonb) to anon, authenticated;

-- ============================================================================
-- 2. Marcar que foi para o WhatsApp
-- ============================================================================
-- O site grava o pedido ANTES de abrir o WhatsApp, de propósito: se o envio
-- falhar, o pedido não se perde. Esta função fecha o ciclo.
--
-- Só liga a marca, nunca desliga: assim o pior que alguém de fora consegue
-- fazer é marcar como enviado um pedido que não foi — visível na hora, porque
-- a conversa não chegou. Desmarcar apagaria a informação de que algo chegou, e
-- isso não fica em mão anônima.
create or replace function public.marcar_enviado_whatsapp(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.pedidos
     set enviado_whatsapp = true,
         enviado_whatsapp_em = coalesce(enviado_whatsapp_em, now())
   where id = p_id and enviado_whatsapp = false;
$$;

grant execute on function public.marcar_enviado_whatsapp(uuid) to anon, authenticated;

-- ============================================================================
-- 3. Atualizar status — só admin
-- ============================================================================
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

  -- O update abaixo já passa pelo RLS (security invoker), mas a checagem
  -- explícita transforma "nenhuma linha atualizada" numa mensagem que diz o
  -- que houve, em vez de um silêncio que parece bug.
  if not public.eh_admin() then
    raise exception 'sem permissao';
  end if;

  update public.pedidos
     set status = p_status,
         observacoes = coalesce(p_observacoes, observacoes)
   where id = p_id
   returning * into v;

  -- confirmado_em e atualizado_em são carimbados pelo gatilho
  -- marcar_atualizacao() da migração 001, com o relógio do banco.
  return v;
end;
$$;

grant execute on function public.atualizar_status_pedido(uuid, text, text) to authenticated;

-- ============================================================================
-- 4. Produtos — criar, editar, remover (soft) e restaurar
-- ============================================================================
create or replace function public.salvar_produto(
  p_id text,
  p_nome text,
  p_descricao text default null,
  p_preco_centavos bigint default null,
  p_imagem text default null,
  p_categoria text default null,
  p_destaque boolean default null,
  p_ativo boolean default null
)
returns public.catalogo_produtos
language plpgsql
security invoker
as $$
declare
  v public.catalogo_produtos;
begin
  if not public.eh_admin() then
    raise exception 'sem permissao';
  end if;

  if coalesce(trim(p_nome), '') = '' then
    raise exception 'nome obrigatorio';
  end if;

  insert into public.catalogo_produtos (
    id, nome, descricao, preco_centavos, imagem, categoria, destaque, ativo,
    vendedor_id)
  values (
    p_id, p_nome, p_descricao, coalesce(p_preco_centavos, 400), p_imagem,
    p_categoria, coalesce(p_destaque, false), coalesce(p_ativo, true),
    (select id from public.usuarios where tipo = 'vendedor' order by criado_em limit 1))
  on conflict (id) do update set
    -- coalesce em cada campo: omitir um argumento MANTÉM o valor atual, em vez
    -- de apagá-lo. Sem isso, editar só o preço zeraria a descrição.
    nome           = excluded.nome,
    descricao      = coalesce(p_descricao,      catalogo_produtos.descricao),
    preco_centavos = coalesce(p_preco_centavos, catalogo_produtos.preco_centavos),
    imagem         = coalesce(p_imagem,         catalogo_produtos.imagem),
    categoria      = coalesce(p_categoria,      catalogo_produtos.categoria),
    destaque       = coalesce(p_destaque,       catalogo_produtos.destaque),
    ativo          = coalesce(p_ativo,          catalogo_produtos.ativo),
    removido_em    = null
  returning * into v;

  return v;
end;
$$;

-- Soft delete: a linha fica. Apagar de verdade quebraria produto_id em
-- pedido_items (viraria nulo) e o relatório por produto perderia a história.
create or replace function public.remover_produto(p_id text)
returns public.catalogo_produtos
language plpgsql
security invoker
as $$
declare
  v public.catalogo_produtos;
begin
  if not public.eh_admin() then
    raise exception 'sem permissao';
  end if;

  update public.catalogo_produtos
     set ativo = false, removido_em = now()
   where id = p_id
   returning * into v;

  if v.id is null then
    raise exception 'produto % nao existe', p_id;
  end if;

  return v;
end;
$$;

create or replace function public.restaurar_produto(p_id text)
returns public.catalogo_produtos
language plpgsql
security invoker
as $$
declare
  v public.catalogo_produtos;
begin
  if not public.eh_admin() then
    raise exception 'sem permissao';
  end if;

  update public.catalogo_produtos
     set ativo = true, removido_em = null
   where id = p_id
   returning * into v;

  return v;
end;
$$;

grant execute on function public.salvar_produto(text, text, text, bigint, text, text, boolean, boolean) to authenticated;
grant execute on function public.remover_produto(text) to authenticated;
grant execute on function public.restaurar_produto(text) to authenticated;

-- ============================================================================
-- 5. Vendas por produto — o relatório que pedido_items existe para servir
-- ============================================================================
create or replace function public.vendas_por_produto(meses integer default 12)
returns table (
  produto_id text,
  produto_nome text,
  ativo boolean,
  pedidos bigint,
  potes bigint,
  faturamento_centavos bigint
)
language sql
stable
security invoker
as $$
  select
    -- Agrupa pelo nome congelado quando o produto saiu do catálogo: assim a
    -- venda antiga continua aparecendo com o nome que tinha.
    coalesce(i.produto_id, i.produto_nome),
    coalesce(c.nome, i.produto_nome),
    coalesce(c.ativo, false),
    count(distinct i.pedido_id),
    coalesce(sum(i.quantidade), 0)::bigint,
    coalesce(sum(i.total_centavos), 0)::bigint
  from public.pedido_items i
  join public.pedidos p on p.id = i.pedido_id
  left join public.catalogo_produtos c on c.id = i.produto_id
  where p.criado_em >= date_trunc('month', now()) - make_interval(months => meses - 1)
    and p.status in ('confirmado', 'entregue')   -- mesma regra do dashboard
  group by 1, 2, 3
  order by 6 desc;
$$;

grant execute on function public.vendas_por_produto(integer) to authenticated;

-- ============================================================================
-- 6. Vitrine (displays): já existe
-- ============================================================================
-- A aprovação de destaque é decidir_vitrine(p_id, p_aprovar, p_observacao), da
-- migração 003. Não é redefinida aqui para não haver duas versões da mesma
-- regra em arquivos diferentes.
