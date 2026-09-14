-- 006 — Itens de pedido e ligação com cliente/região
--
-- ============================================================================
-- ISTO NÃO EXIGE MUDAR UMA LINHA DE JAVASCRIPT
-- ============================================================================
--
-- O site continua fazendo o mesmo INSERT em `pedidos` que faz hoje, com o
-- mesmo jsonb de itens. Dois gatilhos aqui embaixo fazem o resto: resolvem o
-- cliente, resolvem a região pelo CEP e explodem o jsonb em linhas de
-- pedido_items.
--
-- O motivo de fazer no banco e não no navegador: um pedido gravado sem os
-- itens normalizados seria um pedido invisível para qualquer relatório por
-- produto, e não haveria como saber quais ficaram para trás. No gatilho, ou o
-- pedido inteiro entra ou nada entra.
--
-- ============================================================================
-- POR QUE `pedidos.itens` (jsonb) CONTINUA EXISTINDO
-- ============================================================================
--
-- A especificação pedia items json em `pedidos` E uma tabela `pedido_items`.
-- Guardar a mesma informação duas vezes é começar a contar os dias até as duas
-- discordarem — então elas têm papéis diferentes e isso é regra, não estilo:
--
--   pedidos.itens  → CÓPIA CONGELADA do que foi para o WhatsApp. Prova do que
--                    o cliente mandou. Nunca é editada, nunca entra em soma.
--   pedido_items   → a verdade consultável. TODO relatório por produto sai
--                    daqui.
--
-- Se algum dia as duas divergirem, pedido_items está certa: ela é derivada da
-- outra, e não o contrário.

-- ============================================================================
-- 1. Novas colunas em `pedidos`
-- ============================================================================
-- `regiao` (texto, o nome) já existe desde a migração 002 e continua sendo o
-- que o painel mostra. `regiao_id` é a chave estrangeira, para agrupar sem
-- depender de o nome nunca mudar.
alter table public.pedidos add column if not exists cliente_id uuid
  references public.clientes(id) on delete set null;
alter table public.pedidos add column if not exists regiao_id text
  references public.regioes(id) on delete set null;

-- O envio pelo WhatsApp é um passo separado da gravação: o pedido é gravado
-- antes de a janela abrir, justamente para não se perder se o WhatsApp falhar.
-- Sem esta coluna, pedido gravado e pedido enviado ficam indistinguíveis.
alter table public.pedidos add column if not exists enviado_whatsapp boolean not null default false;
alter table public.pedidos add column if not exists enviado_whatsapp_em timestamptz;

-- Índices pedidos explicitamente.
create index if not exists pedidos_cliente_idx on public.pedidos (cliente_id);
create index if not exists pedidos_regiao_idx on public.pedidos (regiao_id);
-- pedidos_criado_em_idx (a "data do pedido") já existe desde a migração 001.

-- ============================================================================
-- 2. Itens de pedido
-- ============================================================================
create table if not exists public.pedido_items (
  id bigint generated always as identity primary key,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,

  -- on delete set null, nunca cascade: apagar um tempero do catálogo não pode
  -- apagar linha de venda de dois anos atrás.
  produto_id text references public.catalogo_produtos(id) on delete set null,

  -- Nome e preço CONGELADOS no momento da venda. Se o produto for renomeado ou
  -- reajustado, o pedido antigo continua contando a história certa — é a
  -- diferença entre um histórico e um relatório que se reescreve sozinho.
  produto_nome text not null,
  quantidade integer not null check (quantidade > 0),      -- em POTES
  preco_unitario_centavos bigint not null check (preco_unitario_centavos >= 0),

  -- "1 caixa de 48 + 1 de 24" — como o site montou as caixas para esses potes.
  caixas_descricao text,

  total_centavos bigint generated always as
    (quantidade * preco_unitario_centavos) stored
);

create index if not exists pedido_items_pedido_idx on public.pedido_items (pedido_id);
create index if not exists pedido_items_produto_idx on public.pedido_items (produto_id);

alter table public.pedido_items enable row level security;

-- Sem política para anon: quem escreve é o gatilho, como security definer.
drop policy if exists "admin le itens" on public.pedido_items;
create policy "admin le itens"
  on public.pedido_items for select to authenticated using (public.eh_admin());

drop policy if exists "admin escreve itens" on public.pedido_items;
create policy "admin escreve itens"
  on public.pedido_items for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- ============================================================================
-- 3. Resolver cliente e região — ANTES de inserir
-- ============================================================================
-- before insert, e não after: assim dá para preencher new.cliente_id
-- diretamente, sem um UPDATE que faria todo pedido nascer marcado como
-- "editado".
create or replace function public.pedido_resolver_cliente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc     text;
  v_cep     text;
  v_usuario uuid;
  v_cliente uuid;
  v_regiao  text;
begin
  v_doc := nullif(regexp_replace(coalesce(new.cnpj, ''), '[^0-9]', '', 'g'), '');
  v_cep := nullif(regexp_replace(coalesce(new.cep,  ''), '[^0-9]', '', 'g'), '');

  -- Região pelo CEP: a MAIS ESPECÍFICA vence, ativa ou não. É a mesma regra de
  -- js/entrega.js — se uma região suspensa cobre o CEP, o pedido pertence a
  -- ela, e não à região genérica que a engloba. Filtrar por `ativo` aqui faria
  -- o pedido cair na faixa errada e sumir do relatório da região certa.
  if v_cep is not null and length(v_cep) = 8 then
    select r.id into v_regiao
    from public.regioes r
    join public.regioes_faixas_cep f on f.regiao_id = r.id
    where v_cep between f.cep_inicio and f.cep_fim
    order by r.prioridade desc, r.ativo desc
    limit 1;

    new.regiao_id := v_regiao;
  end if;

  if v_doc is null then
    return new;   -- sem CNPJ não há como identificar; o pedido entra assim mesmo
  end if;

  select id into v_usuario
  from public.usuarios
  where documento = v_doc and removido_em is null;

  if v_usuario is null then
    insert into public.usuarios (tipo, nome, cnpj, telefone, email)
    values ('cliente', new.razao_social, new.cnpj, new.telefone, new.email)
    returning id into v_usuario;
  else
    -- SÓ PREENCHE O QUE ESTÁ VAZIO. Nunca sobrescreve.
    --
    -- Qualquer pessoa pode inserir um pedido com o CNPJ de outra empresa — é o
    -- preço de um site sem login, e a migração 001 já documenta isso. Se este
    -- gatilho fizesse upsert de verdade, esse buraco deixaria de ser "pedido
    -- falso na fila" e viraria "edição do cadastro alheio": bastaria enviar um
    -- pedido com o CNPJ certo e um telefone errado para trocar o contato do
    -- cliente no painel.
    --
    -- Os dados novos ficam na linha do pedido, que é onde o vendedor confere
    -- antes de confirmar. Corrigir o cadastro é ação de admin, no painel.
    update public.usuarios set
      telefone = coalesce(telefone, new.telefone),
      email    = coalesce(email,    new.email)
    where id = v_usuario;
  end if;

  select id into v_cliente
  from public.clientes
  where usuario_id = v_usuario and removido_em is null
  order by criado_em
  limit 1;

  if v_cliente is null then
    insert into public.clientes (
      usuario_id, inscricao_estadual, cep, logradouro, numero,
      complemento, bairro, cidade, uf, regiao_entrega_id)
    values (
      v_usuario, new.inscricao_estadual,
      case when length(coalesce(v_cep, '')) = 8 then v_cep end,
      new.logradouro, new.numero, new.complemento, new.bairro,
      new.cidade, upper(nullif(new.uf, '')), v_regiao)
    returning id into v_cliente;
  else
    -- Mesma regra: preenche o vazio, não reescreve o preenchido.
    update public.clientes set
      inscricao_estadual = coalesce(inscricao_estadual, new.inscricao_estadual),
      logradouro         = coalesce(logradouro, new.logradouro),
      numero             = coalesce(numero, new.numero),
      bairro             = coalesce(bairro, new.bairro),
      cidade             = coalesce(cidade, new.cidade),
      uf                 = coalesce(uf, upper(nullif(new.uf, ''))),
      cep                = coalesce(cep, case when length(coalesce(v_cep,'')) = 8 then v_cep end),
      regiao_entrega_id  = coalesce(regiao_entrega_id, v_regiao)
    where id = v_cliente;
  end if;

  new.cliente_id := v_cliente;
  return new;
end;
$$;

drop trigger if exists pedidos_resolver_cliente on public.pedidos;
create trigger pedidos_resolver_cliente
  before insert on public.pedidos
  for each row execute function public.pedido_resolver_cliente();

-- ============================================================================
-- 4. Explodir o jsonb em linhas — DEPOIS de inserir
-- ============================================================================
-- after insert porque pedido_items tem chave estrangeira para pedidos: a linha
-- do pedido precisa existir antes.
create or replace function public.pedido_explodir_itens()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unitario bigint;
begin
  -- Preço por pote derivado do próprio pedido, não fixado em 400. Assim um
  -- reajuste futuro em js/config.js não deixa o histórico contando o preço
  -- errado, e o total dos itens sempre fecha com o total do pedido.
  v_unitario := case
    when coalesce(new.potes, 0) > 0
      then round(new.valor_centavos::numeric / new.potes)::bigint
    else 0
  end;

  insert into public.pedido_items (
    pedido_id, produto_id, produto_nome,
    quantidade, preco_unitario_centavos, caixas_descricao)
  select
    new.id,
    -- Só vira chave estrangeira se o produto existir no catálogo; item de um
    -- tempero que saiu de linha entra com produto_id nulo e o nome preservado.
    (select p.id from public.catalogo_produtos p where p.id = item->>'id'),
    coalesce(nullif(item->>'nome', ''), item->>'id', 'sem nome'),
    case when item->>'potes' ~ '^[0-9]+$'
         then greatest((item->>'potes')::integer, 1) else 1 end,
    v_unitario,
    item->>'caixas'
  -- O case tem que estar DENTRO da chamada: jsonb_array_elements no FROM e
  -- avaliado antes de qualquer WHERE, entao filtrar depois nao protege nada --
  -- um `itens` que chegasse como objeto derrubaria o pedido inteiro.
  from jsonb_array_elements(
         case when jsonb_typeof(coalesce(new.itens, '[]'::jsonb)) = 'array'
              then new.itens else '[]'::jsonb end) as item;

  return new;
end;
$$;

drop trigger if exists pedidos_explodir_itens on public.pedidos;
create trigger pedidos_explodir_itens
  after insert on public.pedidos
  for each row execute function public.pedido_explodir_itens();

-- ============================================================================
-- 5. Backfill dos pedidos que já estão no banco
-- ============================================================================
-- Os gatilhos só valem daqui para a frente. Este bloco roda a mesma lógica
-- sobre o que já existe, e é idempotente: rodar duas vezes não duplica item
-- nem cliente.
do $$
declare
  p record;
  v_unitario bigint;
begin
  -- `ped` como alias da tabela: com a variavel de loop chamada `p` e a tabela
  -- sem alias, o plpgsql resolveria `p.id` dentro do NOT EXISTS como a
  -- VARIAVEL (nula na primeira volta) em vez da coluna. O filtro nao filtraria
  -- nada e rodar esta migracao duas vezes duplicaria todos os itens.
  for p in select ped.* from public.pedidos ped where not exists (
             select 1 from public.pedido_items i where i.pedido_id = ped.id)
  loop
    v_unitario := case when coalesce(p.potes, 0) > 0
      then round(p.valor_centavos::numeric / p.potes)::bigint else 0 end;

    insert into public.pedido_items (
      pedido_id, produto_id, produto_nome,
      quantidade, preco_unitario_centavos, caixas_descricao)
    select p.id,
           (select c.id from public.catalogo_produtos c where c.id = item->>'id'),
           coalesce(nullif(item->>'nome', ''), item->>'id', 'sem nome'),
           case when item->>'potes' ~ '^[0-9]+$'
                then greatest((item->>'potes')::integer, 1) else 1 end,
           v_unitario,
           item->>'caixas'
    from jsonb_array_elements(
           case when jsonb_typeof(coalesce(p.itens, '[]'::jsonb)) = 'array'
                then p.itens else '[]'::jsonb end) as item;
  end loop;
end;
$$;

-- ============================================================================
-- 7. `historico_pedidos` é RELAÇÃO, não coluna
-- ============================================================================
-- A especificação pedia "historico_pedidos (json/relação)". Como coluna json
-- seria uma segunda cópia da tabela de pedidos dentro da linha do cliente: no
-- dia em que um pedido mudasse de status, as duas divergiriam e não haveria
-- como saber qual está certa.
--
-- Aqui o histórico é a relação clientes 1:N pedidos, e esta view entrega o
-- resumo já somado — que é o que a tela realmente consome.
create or replace view public.clientes_historico as
  select
    c.id                as cliente_id,
    u.id                as usuario_id,
    u.nome              as razao_social,
    u.cnpj,
    u.telefone,
    c.cidade,
    c.bairro,
    c.regiao_entrega_id,
    count(p.id)                                                    as pedidos,
    count(p.id) filter (where p.status in ('confirmado','entregue')) as pedidos_fechados,
    coalesce(sum(p.caixas), 0)::bigint                             as caixas,
    coalesce(sum(p.valor_centavos) filter (
      where p.status in ('confirmado','entregue')), 0)::bigint     as faturamento_centavos,
    max(p.criado_em)                                               as ultimo_pedido_em
  from public.clientes c
  join public.usuarios u on u.id = c.usuario_id
  left join public.pedidos p on p.cliente_id = c.id
  where c.removido_em is null
  group by c.id, u.id, u.nome, u.cnpj, u.telefone, c.cidade, c.bairro, c.regiao_entrega_id;

-- A view herda o RLS das tabelas de baixo, então não é um buraco: quem não é
-- admin lê zero linhas. Ela mora nesta migração, e não na 004 junto da tabela
-- `clientes`, porque depende de pedidos.cliente_id, que nasce aqui em cima.
alter view public.clientes_historico set (security_invoker = true);
grant select on public.clientes_historico to authenticated;

-- ============================================================================
-- 6. Conferência: o total do pedido bate com a soma dos itens?
-- ============================================================================
-- Não é constraint, porque frete e arredondamento de centavo podem produzir
-- diferença legítima de poucos centavos. É uma consulta para rodar quando algo
-- parecer errado — se aparecer linha aqui com diferença grande, o jsonb do
-- pedido e o total do pedido discordam na origem, no site.
create or replace view public.pedidos_conferencia as
  select p.id, p.criado_em, p.razao_social,
         p.valor_centavos                                as total_do_pedido,
         coalesce(sum(i.total_centavos), 0)::bigint      as soma_dos_itens,
         p.valor_centavos - coalesce(sum(i.total_centavos), 0)::bigint as diferenca
  from public.pedidos p
  left join public.pedido_items i on i.pedido_id = p.id
  group by p.id
  having abs(p.valor_centavos - coalesce(sum(i.total_centavos), 0)::bigint) > 100;

alter view public.pedidos_conferencia set (security_invoker = true);
grant select on public.pedidos_conferencia to authenticated;
