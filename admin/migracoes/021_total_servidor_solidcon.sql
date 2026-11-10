-- 021_total_servidor_solidcon.sql: NAO APLICADA: total no servidor, antes 011 de A.
-- Corpo original preservado; numeros antigos abaixo sao historicos.
-- 011 — Total no servidor e lançamento manual no comercial SOLIDCON
--
-- Rode depois das migrações 004–010. Não há integração automática com ERP:
-- Márcio digita o pedido no comercial e o painel registra o número gerado.
-- Nenhum backfill: preços, totais e itens dos pedidos antigos ficam intactos.
begin;

-- ============================================================================
-- 1. Código do catálogo e auditoria/controle do pedido
-- ============================================================================
alter table public.catalogo_produtos add column if not exists codigo_erp text;
create unique index if not exists catalogo_produtos_codigo_erp_uk
  on public.catalogo_produtos (codigo_erp) where codigo_erp is not null;

-- Sem default: pedido anterior à 011 não tem auditoria do navegador.
alter table public.pedidos add column if not exists valor_site_centavos bigint;
alter table public.pedidos add column if not exists frete_site_centavos bigint;
alter table public.pedidos add column if not exists numero_solidcon text;
alter table public.pedidos add column if not exists lancado_solidcon_em timestamptz;

-- ============================================================================
-- Região: redefinição da 006 apenas para desempate determinístico
-- ============================================================================
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
  -- Especificidade é prioridade, não largura da faixa (regra preservada).
  -- Desempate desta migracao: prioridade DESC, ativo DESC,
  -- id ASC em ordem Unicode/binária (COLLATE "C"), sem depender da ordem dos dados.
  if v_cep is not null and length(v_cep) = 8 then
    select r.id into v_regiao
    from public.regioes r
    join public.regioes_faixas_cep f on f.regiao_id = r.id
    where v_cep between f.cep_inicio and f.cep_fim
    order by r.prioridade desc, r.ativo desc, r.id collate "C" asc
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

-- ============================================================================
-- 2. Uma regra de itens para os dois gatilhos
-- ============================================================================
-- Mesma normalização da 006: regex de dígitos e mínimo de 1; potes inválido,
-- ausente, negativo, decimal ou zero vira 1 (não rejeita nem perde o item).
-- Inteiro fora da capacidade da coluna também vira 1. Itens sem id entram
-- com produto_id nulo, nome preservado e preço de 400 (js/config.js).
-- Array ausente/malformado vira vazio, sem chamar jsonb_array_elements em
-- objeto/escalar. Produto existente usa seu preço mesmo inativo/removido:
-- não há regra nova de disponibilidade que possa bloquear a gravação.
--
-- A soma tem limites físicos: potes é integer e valor é bigint. Se uma linha
-- estourar qualquer limite acumulado, ela é ignorada NOS DOIS gatilhos; fica
-- no JSON original para revisão. Não usamos total do navegador como fallback.
create or replace function public.pedido_itens_precificados(p_itens jsonb)
returns table (
  produto_id text, produto_nome text, quantidade integer,
  preco_unitario_centavos bigint, caixas_descricao text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item jsonb;
  v_potes bigint := 0;
  v_valor numeric := 0;
  v_total numeric;
begin
  for v_item in select value from jsonb_array_elements(
    case when jsonb_typeof(p_itens) = 'array' then p_itens else '[]'::jsonb end)
  loop
    quantidade := 1;
    if v_item->>'potes' ~ '^[0-9]+$' then
      begin
        quantidade := greatest((v_item->>'potes')::integer, 1);
      exception when numeric_value_out_of_range then
        quantidade := 1;
      end;
    end if;

    select p.id, p.preco_centavos
      into produto_id, preco_unitario_centavos
      from public.catalogo_produtos p where p.id = v_item->>'id';
    preco_unitario_centavos := coalesce(preco_unitario_centavos, 400);
    produto_nome := coalesce(nullif(v_item->>'nome', ''), v_item->>'id', 'sem nome');
    caixas_descricao := v_item->>'caixas';
    v_total := quantidade::numeric * preco_unitario_centavos;
    if v_potes + quantidade > 2147483647
       or v_valor + v_total > 9223372036854775807 then
      continue;
    end if;
    v_potes := v_potes + quantidade;
    v_valor := v_valor + v_total;
    return next;
  end loop;
end;
$$;

-- Helper interno: os gatilhos definer abaixo consultam o catálogo inteiro
-- e inserem pedido_items apesar do RLS de anon, como na 006. Não é RPC pública.
revoke all on function public.pedido_itens_precificados(jsonb) from public, anon, authenticated;

-- ============================================================================
-- 3. Recalcular ANTES de inserir, DEPOIS de resolver cliente/região
-- ============================================================================
create or replace function public.pedido_total_servidor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sobrescreve também auditoria enviada diretamente: o valor auditado é
  -- SEMPRE o que chegou nas colunas originais, antes deste recálculo.
  new.valor_site_centavos := new.valor_centavos;
  new.frete_site_centavos := new.frete_centavos;
  select coalesce(sum(i.quantidade), 0)::integer,
         coalesce(sum(i.quantidade::numeric * i.preco_unitario_centavos), 0)::bigint
    into new.potes, new.valor_centavos
    from public.pedido_itens_precificados(new.itens) i;

  -- Região inativa/ausente: zero, sem cair na região genérica ativa.
  -- Sem CEP válido: zero mesmo se o chamador fornecer regiao_id diretamente;
  -- a 006 só resolve/substitui regiao_id quando recebe oito dígitos de CEP.
  new.frete_centavos := 0;
  if length(regexp_replace(coalesce(new.cep, ''), '[^0-9]', '', 'g')) = 8 then
    select coalesce((select r.taxa_centavos from public.regioes r
                    where r.id = new.regiao_id and r.ativo), 0)
      into new.frete_centavos;
  end if;

  -- Um INSERT público não pode nascer marcado como lançado no comercial.
  new.numero_solidcon := null;
  new.lancado_solidcon_em := null;
  return new;
end;
$$;

-- PostgreSQL executa gatilhos do mesmo evento/momento por NOME, não por
-- criação: pedidos_total_servidor (t) vem depois de pedidos_resolver_cliente (r).
drop trigger if exists pedidos_total_servidor on public.pedidos;
create trigger pedidos_total_servidor
  before insert on public.pedidos
  for each row execute function public.pedido_total_servidor();

-- ============================================================================
-- 4. Preço congelado POR PRODUTO, sem média valor/potes
-- ============================================================================
create or replace function public.pedido_explodir_itens()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pedido_items (
    pedido_id, produto_id, produto_nome,
    quantidade, preco_unitario_centavos, caixas_descricao)
  select new.id, i.produto_id, i.produto_nome,
         i.quantidade, i.preco_unitario_centavos, i.caixas_descricao
    from public.pedido_itens_precificados(new.itens) i;
  return new;
end;
$$;
-- O AFTER INSERT pedidos_explodir_itens da 006 já chama esta função.

-- ============================================================================
-- 5. Registrar/desfazer lançamento — RLS de admin continua valendo
-- ============================================================================
-- Retorna a linha atualizada; pedido inexistente/invisível retorna NULL.
-- Trim vazio ou NULL desfaz ambos os campos. Repetir número renova a data.
create or replace function public.marcar_lancado_solidcon(p_pedido uuid, p_numero text)
returns public.pedidos
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_numero text := nullif(trim(p_numero), '');
  v_pedido public.pedidos;
begin
  update public.pedidos
     set numero_solidcon = v_numero,
         lancado_solidcon_em = case when v_numero is not null then now() end
   where id = p_pedido
   returning * into v_pedido;
  return v_pedido;
end;
$$;
revoke all on function public.marcar_lancado_solidcon(uuid, text) from public, anon;
grant execute on function public.marcar_lancado_solidcon(uuid, text) to authenticated;

commit;
