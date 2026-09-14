-- Regiões de entrega — esquema, políticas e seed.
--
-- Rode DEPOIS de admin/supabase.sql (este arquivo usa a função eh_admin()
-- definida lá). Cole no SQL Editor do Supabase e execute uma vez.
--
-- ============================================================================
-- UMA DIFERENÇA IMPORTANTE DE PERMISSÃO
-- ============================================================================
--
-- Todas as outras tabelas do painel são invisíveis para o site: o visitante só
-- insere, nunca lê. Aqui é o contrário — o navegador do cliente PRECISA ler as
-- regiões, senão ele não tem como saber o frete antes de confirmar o pedido.
--
-- Isso é seguro porque não há dado pessoal aqui: são áreas de entrega, taxas e
-- prazos, exatamente a informação que a página exibe para qualquer visitante.
-- Escrever continua restrito ao administrador.

-- ============================================================================
-- 1. Regiões
-- ============================================================================
create table if not exists public.regioes (
  id text primary key,                       -- 'zona-sul', 'centro'...
  nome text not null,
  bairros text[] not null default '{}',

  taxa_centavos bigint not null default 0,
  prazo_dias integer not null default 0,

  ativo boolean not null default true,

  -- Quando um CEP cai em mais de uma região, vence a de maior prioridade.
  -- É o que faz "Zona Sul" ganhar da região que cobre o estado inteiro.
  prioridade integer not null default 10,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ============================================================================
-- 2. Faixas de CEP
-- ============================================================================
-- Tabela separada porque uma região tem MAIS DE UMA faixa. No Rio isso não é
-- exceção: a Zona Sul ocupa 22000–22299 e 22400–22499, com a faixa 22300
-- pertencendo a outra área; a Zona Oeste tem Bangu em 21800 e Campo Grande em
-- 23000, com a Barra no meio. Um par cep_inicio/cep_fim por região obrigaria a
-- inventar regiões artificiais ou a engolir bairros errados.
--
-- O CEP é guardado como TEXTO de 8 dígitos, não como número: comparar texto
-- preserva o zero à esquerda, que number perderia.
create table if not exists public.regioes_faixas_cep (
  id bigint generated always as identity primary key,
  regiao_id text not null references public.regioes(id) on delete cascade,
  cep_inicio char(8) not null,
  cep_fim char(8) not null,

  constraint faixa_coerente check (cep_inicio <= cep_fim),
  constraint cep_so_digitos check (cep_inicio ~ '^[0-9]{8}$' and cep_fim ~ '^[0-9]{8}$')
);

create index if not exists faixas_regiao_idx on public.regioes_faixas_cep (regiao_id);
create index if not exists faixas_intervalo_idx on public.regioes_faixas_cep (cep_inicio, cep_fim);

-- ============================================================================
-- 3. Políticas
-- ============================================================================
alter table public.regioes enable row level security;
alter table public.regioes_faixas_cep enable row level security;

-- Leitura liberada: o site precisa calcular o frete no navegador do cliente.
drop policy if exists "todos leem regioes" on public.regioes;
create policy "todos leem regioes"
  on public.regioes for select
  to anon, authenticated
  using (true);

drop policy if exists "todos leem faixas" on public.regioes_faixas_cep;
create policy "todos leem faixas"
  on public.regioes_faixas_cep for select
  to anon, authenticated
  using (true);

-- Escrever, só administrador.
drop policy if exists "admin escreve regioes" on public.regioes;
create policy "admin escreve regioes"
  on public.regioes for all
  to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

drop policy if exists "admin escreve faixas" on public.regioes_faixas_cep;
create policy "admin escreve faixas"
  on public.regioes_faixas_cep for all
  to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

create or replace function public.marcar_regiao_atualizada()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists regioes_atualizacao on public.regioes;
create trigger regioes_atualizacao
  before update on public.regioes
  for each row execute function public.marcar_regiao_atualizada();

-- ============================================================================
-- 4. Colunas novas em `pedidos`
-- ============================================================================
-- Frete separado do valor dos produtos: no painel, faturamento de mercadoria e
-- custo de entrega são números diferentes, e somá-los numa coluna só tornaria
-- impossível separá-los depois.
alter table public.pedidos add column if not exists frete_centavos bigint not null default 0;
alter table public.pedidos add column if not exists regiao text;

-- ============================================================================
-- 5. Seed
-- ============================================================================
--
-- >>> DOIS AVISOS ANTES DE VOCÊ RODAR ISTO <<<
--
-- 1. AS FAIXAS DE CEP são as que eu conheço, não uma fonte oficial dos
--    Correios. Um limite errado cobra frete errado ou recusa um cliente
--    válido. CONFIRA cada faixa contra os CEPs que você realmente atende.
--
-- 2. AS TAXAS E OS PRAZOS abaixo são EXEMPLOS. Nenhum número veio de você.
--    Troque todos — pela aba Regiões do painel, que edita sem SQL.
--
-- A região 'resto-rj' existe de propósito: hoje o site atende todo o estado.
-- Sem ela, um cliente de Petrópolis passaria a ser recusado da noite para o
-- dia. Para deixar de atender uma área, desative-a no painel.

insert into public.regioes (id, nome, prioridade, ativo, taxa_centavos, prazo_dias, bairros) values
  ('centro',            'Centro',                10, true, 2500, 2,
   array['Centro','Lapa','Cinelândia','Saúde','Gamboa','Santo Cristo','Praça Mauá','Castelo']),
  ('zona-sul',          'Zona Sul',              10, true, 3000, 2,
   array['Copacabana','Leme','Ipanema','Leblon','Botafogo','Flamengo','Laranjeiras','Catete','Glória','Urca','Humaitá','Gávea','Jardim Botânico','Lagoa','São Conrado','Vidigal','Cosme Velho']),
  ('zona-norte',        'Zona Norte',            10, true, 3500, 3,
   array['Tijuca','Vila Isabel','Maracanã','Grajaú','Andaraí','Méier','Engenho Novo','Cachambi','Todos os Santos','Madureira','Penha','Olaria','Ramos','Bonsucesso','Ilha do Governador','São Cristóvão','Benfica']),
  ('barra-jacarepagua', 'Barra e Jacarepaguá',   10, true, 4000, 3,
   array['Barra da Tijuca','Recreio dos Bandeirantes','Jacarepaguá','Freguesia','Taquara','Anil','Itanhangá','Vargem Grande','Vargem Pequena','Curicica']),
  ('zona-oeste',        'Zona Oeste',            10, true, 5000, 4,
   array['Bangu','Realengo','Padre Miguel','Campo Grande','Santa Cruz','Guaratiba','Sepetiba','Paciência','Inhoaíba','Cosmos','Senador Camará']),
  ('niteroi',           'Niterói',               10, true, 4500, 3,
   array['Icaraí','Centro','Santa Rosa','Ingá','São Francisco','Charitas','Piratininga','Itaipu','Fonseca','Barreto','Pendotiba','Camboinhas']),
  ('sao-goncalo',       'São Gonçalo',           10, true, 5000, 4,
   array['Alcântara','Centro','Neves','Trindade','Colubandê','Mutuá','Porto da Pedra','Zé Garoto']),
  ('baixada',           'Baixada Fluminense',    10, true, 5500, 4,
   array['Duque de Caxias','Nova Iguaçu','São João de Meriti','Belford Roxo','Nilópolis','Mesquita','Queimados','Japeri','Magé']),
  ('resto-rj',          'Resto do estado do Rio', 0, true, 8000, 7,
   array[]::text[])
on conflict (id) do nothing;

insert into public.regioes_faixas_cep (regiao_id, cep_inicio, cep_fim) values
  ('centro',            '20000000', '20099999'),
  ('zona-sul',          '22000000', '22299999'),  -- Glória a Botafogo, Copacabana, Leme
  ('zona-sul',          '22400000', '22499999'),  -- Ipanema, Leblon, Gávea, Lagoa
  ('zona-sul',          '22600000', '22619999'),  -- São Conrado
  ('zona-norte',        '20500000', '21399999'),
  ('barra-jacarepagua', '22620000', '22799999'),
  ('zona-oeste',        '21800000', '21899999'),  -- Bangu, Realengo, Padre Miguel
  ('zona-oeste',        '23000000', '23799999'),  -- Campo Grande, Santa Cruz
  ('niteroi',           '24000000', '24399999'),
  ('sao-goncalo',       '24400000', '24799999'),
  ('baixada',           '25000000', '26599999'),
  ('resto-rj',          '20000000', '28999999')
on conflict do nothing;

-- ============================================================================
-- 6. Conferência
-- ============================================================================
-- Rode isto depois do seed para ver qual região responde por um CEP. Troque o
-- CEP do exemplo pelos que você atende de verdade e confira um por um — é mais
-- barato conferir agora do que descobrir cobrando frete errado.
--
--   select r.nome, r.taxa_centavos, r.prazo_dias, r.ativo
--   from public.regioes r
--   join public.regioes_faixas_cep f on f.regiao_id = r.id
--   where '22041001' between f.cep_inicio and f.cep_fim
--   order by r.prioridade desc
--   limit 1;
