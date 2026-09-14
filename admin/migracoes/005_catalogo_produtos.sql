-- 005 — Catálogo de produtos
--
-- ============================================================================
-- ISTO AINDA NÃO É A FONTE DO CATÁLOGO DO SITE
-- ============================================================================
--
-- Hoje os 73 temperos vivem em data/produtos.js e o navegador os lê do próprio
-- arquivo, sem rede. Esta tabela é semeada com os mesmos 73 e passa a ser a
-- fonte do PAINEL (cadastrar, editar, desativar) e dos relatórios por produto.
--
-- Trocar o site para ler daqui é uma decisão separada, com um custo real: hoje
-- o catálogo aparece mesmo se o Supabase estiver fora do ar; lendo do banco,
-- não aparece. O caminho recomendado, quando for a hora, é gerar
-- data/produtos.js a partir da tabela na hora de publicar — banco como fonte,
-- arquivo estático como entrega.
--
-- ENQUANTO ISSO: o id aqui é o MESMO slug de data/produtos.js. É o que faz
-- pedido_items (migração 006) casar item de pedido com produto.
--
-- ============================================================================
-- PREÇO EM CENTAVOS INTEIROS, NUNCA DECIMAL
-- ============================================================================
--
-- Todo o sistema já trabalha assim (js/config.js, js/cart.js, tabela pedidos).
-- Decimal/float em dinheiro acumula erro de arredondamento: some um centavo
-- por linha e o total do pedido deixa de bater com a soma dos itens.

create table if not exists public.catalogo_produtos (
  -- Slug, igual ao de data/produtos.js: 'alho-em-po', 'pimenta-do-reino'.
  -- Chave de texto legível em vez de uuid porque ela já circula no sistema
  -- inteiro — no carrinho do cliente, no jsonb do pedido, no nome do arquivo
  -- da imagem. Trocar por uuid exigiria uma tradução em todo lugar.
  id text primary key,

  nome text not null,
  descricao text,

  preco_centavos bigint not null default 400
    check (preco_centavos >= 0),

  imagem text,
  categoria text,
  destaque boolean not null default false,

  vendedor_id uuid references public.usuarios(id) on delete set null,

  -- Soft delete em dois campos, e cada um responde uma pergunta diferente:
  --   ativo = false      → fora de linha por ora, volta quando quiser
  --   removido_em = data → apagado de vez, mas a linha fica porque pedido
  --                        antigo aponta para ela
  ativo boolean not null default true,
  removido_em timestamptz,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Índice pedido explicitamente.
create index if not exists catalogo_produtos_vendedor_idx
  on public.catalogo_produtos (vendedor_id);

-- Parcial: só indexa o que a vitrine consulta. Menor e mais rápido do que um
-- índice sobre as 73 linhas inteiras.
create index if not exists catalogo_produtos_ativos_idx
  on public.catalogo_produtos (nome)
  where ativo and removido_em is null;

create index if not exists catalogo_produtos_categoria_idx
  on public.catalogo_produtos (categoria) where categoria is not null;

drop trigger if exists catalogo_produtos_atualizacao on public.catalogo_produtos;
create trigger catalogo_produtos_atualizacao
  before update on public.catalogo_produtos
  for each row execute function public.marcar_atualizado_em();

-- ============================================================================
-- View pública — o que o site pode ler
-- ============================================================================
-- O catálogo é público por natureza (já está na tela para qualquer visitante),
-- mas o produto apagado ou desativado não é. A view aplica esse filtro num
-- lugar só, em vez de repetir `where ativo` em cada consulta.
create or replace view public.produtos_publicos as
  select id, nome, descricao, preco_centavos, imagem, categoria, destaque
  from public.catalogo_produtos
  where ativo and removido_em is null;

alter table public.catalogo_produtos enable row level security;

-- Ler o catálogo: qualquer um. Escrever: só admin.
drop policy if exists "todos leem produtos ativos" on public.catalogo_produtos;
create policy "todos leem produtos ativos"
  on public.catalogo_produtos for select
  to anon, authenticated
  using (ativo and removido_em is null);

drop policy if exists "admin le todos os produtos" on public.catalogo_produtos;
create policy "admin le todos os produtos"
  on public.catalogo_produtos for select
  to authenticated using (public.eh_admin());

drop policy if exists "admin escreve produtos" on public.catalogo_produtos;
create policy "admin escreve produtos"
  on public.catalogo_produtos for all
  to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

alter view public.produtos_publicos set (security_invoker = true);
grant select on public.produtos_publicos to anon, authenticated;

-- ============================================================================
-- Seed: os 73 temperos de data/produtos.js
-- ============================================================================
-- `on conflict do nothing`: rodar de novo não desfaz edição feita no painel.
-- Preço vem do padrão da coluna (R$ 4,00 por pote, de js/config.js) e
-- `categoria` fica nula porque data/produtos.js não tem categoria — é campo
-- para o painel preencher, não dado que exista hoje.
insert into public.catalogo_produtos (id, nome, imagem, destaque, vendedor_id)
select v.id, v.nome, v.imagem, v.destaque,
       (select id from public.usuarios where tipo = 'vendedor' order by criado_em limit 1)
from (values
  ('alho-em-po', 'Alho em Pó', 'assets/images/produtos/alho-em-po.png', false),
  ('alho-frito', 'Alho Frito', 'assets/images/produtos/alho-frito.png', true),
  ('ana-maria', 'Ana Maria', 'assets/images/produtos/ana-maria.png', false),
  ('baiano', 'Baiano', 'assets/images/produtos/baiano.png', false),
  ('bicarbonato-de-sodio', 'Bicarbonato de Sódio', 'assets/images/produtos/bicarbonato-de-sodio.png', false),
  ('caldo-de-bacon', 'Caldo de Bacon', 'assets/images/produtos/caldo-de-bacon.png', false),
  ('caldo-de-carne', 'Caldo de Carne', 'assets/images/produtos/caldo-de-carne.png', false),
  ('caldo-de-galinha', 'Caldo de Galinha', 'assets/images/produtos/caldo-de-galinha.png', false),
  ('caldo-de-legumes', 'Caldo de Legumes', 'assets/images/produtos/caldo-de-legumes.png', false),
  ('camomila', 'Camomila', 'assets/images/produtos/camomila.png', false),
  ('canela-em-pau', 'Canela em Pau', 'assets/images/produtos/canela-em-pau.png', false),
  ('canela-em-po', 'Canela em Pó', 'assets/images/produtos/canela-em-po.png', false),
  ('carne-fit', 'Carne Fit', 'assets/images/produtos/carne-fit.png', false),
  ('chia', 'Chia', 'assets/images/produtos/chia.png', false),
  ('chimichurri-com-pimenta', 'Chimichurri com Pimenta', 'assets/images/produtos/chimichurri-com-pimenta.png', false),
  ('chimichurri-defumado', 'Chimichurri Defumado', 'assets/images/produtos/chimichurri-defumado.png', false),
  ('chimichurri', 'Chimichurri', 'assets/images/produtos/chimichurri.png', true),
  ('churrasco', 'Churrasco', 'assets/images/produtos/churrasco.png', false),
  ('coentro-em-po', 'Coentro em Pó', 'assets/images/produtos/coentro-em-po.png', false),
  ('coloral-temperado', 'Colorau Temperado', 'assets/images/produtos/coloral-temperado.png', false),
  ('colorau-colorifico', 'Colorau Colorífico', 'assets/images/produtos/colorau-colorifico.png', false),
  ('cominho-em-po', 'Cominho em Pó', 'assets/images/produtos/cominho-em-po.png', false),
  ('completo-fit', 'Completo Fit', 'assets/images/produtos/completo-fit.png', false),
  ('conquista-sogra', 'Conquista Sogra', 'assets/images/produtos/conquista-sogra.png', false),
  ('cravo-em-flor', 'Cravo em Flor', 'assets/images/produtos/cravo-em-flor.png', false),
  ('curcuma', 'Cúrcuma', 'assets/images/produtos/curcuma.png', true),
  ('curry', 'Curry', 'assets/images/produtos/curry.png', true),
  ('do-chefe', 'Do Chefe', 'assets/images/produtos/do-chefe.png', false),
  ('dry-hub', 'Dry Rub', 'assets/images/produtos/dry-hub.png', false),
  ('edu', 'Edu', 'assets/images/produtos/edu.png', true),
  ('ervas-finas', 'Ervas Finas', 'assets/images/produtos/ervas-finas.png', false),
  ('familia', 'Família', 'assets/images/produtos/familia.png', false),
  ('fazenda', 'Fazenda', 'assets/images/produtos/fazenda.png', false),
  ('frango-fit', 'Frango Fit', 'assets/images/produtos/frango-fit.png', false),
  ('fumaca-em-po', 'Fumaça em Pó', 'assets/images/produtos/fumaca-em-po.png', false),
  ('gengibre-em-po', 'Gengibre em Pó', 'assets/images/produtos/gengibre-em-po.png', false),
  ('gergelim-preto', 'Gergelim Preto', 'assets/images/produtos/gergelim-preto.png', false),
  ('hibisco-em-flor', 'Hibisco em Flor', 'assets/images/produtos/hibisco-em-flor.png', false),
  ('lemon-pepper', 'Lemon Pepper', 'assets/images/produtos/lemon-pepper.png', true),
  ('limao-com-ervas', 'Limão com Ervas', 'assets/images/produtos/limao-com-ervas.png', false),
  ('limao-e-oregano', 'Limão e Orégano', 'assets/images/produtos/limao-e-oregano.png', false),
  ('linhaca-dourada', 'Linhaça Dourada', 'assets/images/produtos/linhaca-dourada.png', false),
  ('louro', 'Louro', 'assets/images/produtos/louro.png', false),
  ('manjericao', 'Manjericão', 'assets/images/produtos/manjericao.png', false),
  ('mineiro', 'Mineiro', 'assets/images/produtos/mineiro.png', false),
  ('mostarda-em-po', 'Mostarda em Pó', 'assets/images/produtos/mostarda-em-po.png', false),
  ('natural', 'Natural Fit', 'assets/images/produtos/natural.png', false),
  ('orange-pepper', 'Orange Pepper', 'assets/images/produtos/orange-pepper.png', false),
  ('oregano-peruano', 'Orégano Peruano', 'assets/images/produtos/oregano-peruano.png', false),
  ('paprica-defumada-picante', 'Páprica Defumada Picante', 'assets/images/produtos/paprica-defumada-picante.png', false),
  ('paprica-defumada', 'Páprica Defumada', 'assets/images/produtos/paprica-defumada.png', true),
  ('paprica-doce', 'Páprica Doce', 'assets/images/produtos/paprica-doce.png', false),
  ('paprica-picante', 'Páprica Picante', 'assets/images/produtos/paprica-picante.png', true),
  ('para-feijao', 'Para Feijão', 'assets/images/produtos/para-feijao.png', false),
  ('pega-esposa', 'Pega Esposa', 'assets/images/produtos/pega-esposa.png', false),
  ('pega-marido', 'Pega Marido', 'assets/images/produtos/pega-marido.png', false),
  ('peixe', 'Peixe Fit', 'assets/images/produtos/peixe.png', false),
  ('pimenta-calabresa-em-graos', 'Pimenta Calabresa em Grãos', 'assets/images/produtos/pimenta-calabresa-em-graos.png', false),
  ('pimenta-em-po', 'Pimenta em Pó', 'assets/images/produtos/pimenta-em-po.png', false),
  ('pimenta-preta-em-graos', 'Pimenta Preta em Grãos', 'assets/images/produtos/pimenta-preta-em-graos.png', false),
  ('pimenta-preta-em-po', 'Pimenta Preta em Pó', 'assets/images/produtos/pimenta-preta-em-po.png', false),
  ('pimenta-rosa-em-graos', 'Pimenta Rosa em Grãos', 'assets/images/produtos/pimenta-rosa-em-graos.png', false),
  ('psyllium-husk', 'Psyllium Husk', 'assets/images/produtos/psyllium-husk.png', false),
  ('sabor-do-nordeste', 'Sabor do Nordeste', 'assets/images/produtos/sabor-do-nordeste.png', false),
  ('sal-de-ouro', 'Sal de Ouro', 'assets/images/produtos/sal-de-ouro.png', false),
  ('sal-rosa-do-himalaia-fino', 'Sal Rosa do Himalaia Fino', 'assets/images/produtos/sal-rosa-do-himalaia-fino.png', false),
  ('sal-rosa-do-himalaia-grosso', 'Sal Rosa do Himalaia Grosso', 'assets/images/produtos/sal-rosa-do-himalaia-grosso.png', false),
  ('salsa-cebola-e-alho', 'Salsa, Cebola e Alho', 'assets/images/produtos/salsa-cebola-e-alho.png', false),
  ('salsa-cebola-e-bacon', 'Salsa, Cebola e Bacon', 'assets/images/produtos/salsa-cebola-e-bacon.png', false),
  ('sirio', 'Sírio', 'assets/images/produtos/sirio.png', false),
  ('tartaro', 'Tártaro', 'assets/images/produtos/tartaro.png', false),
  ('tempera-tudo', 'Tempera Tudo', 'assets/images/produtos/tempera-tudo.png', false),
  ('vinagrete', 'Vinagrete', 'assets/images/produtos/vinagrete.png', false)
) as v(id, nome, imagem, destaque)
on conflict (id) do nothing;
