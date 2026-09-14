-- 013 — Validação e sanitização no banco (defesa em profundidade)
--
-- ============================================================================
-- O QUE ESTA MIGRAÇÃO RESOLVE, E O QUE ELA NÃO PRECISA RESOLVER
-- ============================================================================
--
-- Até aqui, CPF/CNPJ/telefone/e-mail só eram validados no navegador
-- (js/validadores.js, js/pedido.js). Isso protege a UX — o cliente vê o erro
-- na hora — mas não protege o banco: qualquer requisição feita direto contra
-- a API REST do Supabase (sem passar pelo site, sem rodar o JS) contorna essa
-- validação inteira. `pedidos`, `leads` e `lista_espera` aceitam INSERT
-- anônimo (`with check (true)` — decisão já documentada e aceita em
-- admin/supabase.sql: é o preço de um site sem servidor). Sem checagem no
-- banco, essa porta aceita CPF de 3 dígitos, telefone "abc", e-mail sem @.
--
-- Esta migração fecha essa porta com `CHECK constraints`, usando as MESMAS
-- regras já escritas em js/validadores.js e js/pedido.js — os dígitos
-- verificadores de CPF/CNPJ (módulo 11), não só o formato.
--
-- O QUE FICA DE FORA, DE PROPÓSITO:
--
-- - SQL injection: não existe onde corrigir. Toda escrita deste projeto passa
--   pela API REST do PostgREST (INSERT/UPDATE parametrizados pela própria
--   biblioteca) ou por funções `plpgsql` com parâmetros tipados
--   (`completar_visita`, `criar_pedido`, etc.) — nenhuma delas monta SQL por
--   concatenação de string (`EXECUTE format(...)` com valor de usuário). Não
--   há string de SQL em lugar nenhum do JavaScript deste site. Conferido: zero
--   ocorrências de `execute`/`format` com entrada de usuário em admin/*.sql.
--
-- - XSS no front-end: já é tratado por escapagem na SAÍDA, não filtro na
--   entrada — a defesa correta. Toda tela que devolve dado do visitante para
--   a página (admin.js, vitrine.js, pedido.js) já passa por uma função
--   `esc()` que troca `< > & " '` por entidade HTML antes de entrar num
--   `innerHTML`; nada usa `.innerHTML` direto com string do usuário. Não é
--   preciso trocar isso por textContent nem trazer DOMPurify — o resultado
--   final (nenhum HTML de usuário executa) já é o mesmo, e trocar tudo agora
--   só arriscaria quebrar telas que já funcionam. O CHECK de `texto_seguro`
--   abaixo é só uma segunda trava (rejeita `<`/`>` na origem), não a defesa
--   principal.
--
-- - Rate limiting contra abuso do INSERT público: fica para outra frente
--   (o painel já tornou qualquer pedido/lead falso visível na hora, para
--   cancelar). Esta migração é só validação de formato.
--
-- ============================================================================
-- POR QUE BOA PARTE DOS CHECKS ENTRA COMO "NOT VALID"
-- ============================================================================
--
-- `pedidos`, `lista_espera`, `usuarios` e `clientes` já têm linhas reais
-- (inclusive dados de demonstração com CNPJ sequencial tipo
-- "11.222.333/0001-44", que passa no formato mas NÃO no dígito verificador
-- de verdade). Um `CHECK` normal validaria essas linhas na hora de criar a
-- restrição e a migração inteira falharia por causa de dado antigo.
--
-- `NOT VALID` resolve isso do jeito certo: a restrição vale para toda escrita
-- NOVA a partir de agora (é o que importa para segurança), sem exigir limpar
-- dado histórico primeiro. Quem quiser validar o que já existe, depois, roda
-- a consulta no fim deste arquivo para achar as linhas e decide caso a caso.
--
-- A tabela `leads` é nova (migração 011, ainda sem uso real) — entra com
-- CHECK normal, já validado, sem essa ressalva.

-- ============================================================================
-- 1. Funções de validação — mesma regra de js/validadores.js, em SQL
-- ============================================================================
-- `immutable`: dependem só do argumento, nunca do estado do banco — permite
-- o planner usá-las em índice, se um dia precisar.

create or replace function public.cpf_valido(p_valor text)
returns boolean
language plpgsql
immutable
as $$
declare
  c text := regexp_replace(coalesce(p_valor, ''), '\D', '', 'g');
  soma integer;
  peso integer;
  i integer;
  d1 integer;
  d2 integer;
begin
  if length(c) <> 11 then return false; end if;
  if c ~ '^(\d)\1{10}$' then return false; end if; -- 000...  111...  etc.

  soma := 0; peso := 10;
  for i in 1..9 loop
    soma := soma + substring(c from i for 1)::integer * peso;
    peso := peso - 1;
  end loop;
  d1 := (soma * 10) % 11;
  if d1 = 10 then d1 := 0; end if;
  if d1 <> substring(c from 10 for 1)::integer then return false; end if;

  soma := 0; peso := 11;
  for i in 1..10 loop
    soma := soma + substring(c from i for 1)::integer * peso;
    peso := peso - 1;
  end loop;
  d2 := (soma * 10) % 11;
  if d2 = 10 then d2 := 0; end if;
  return d2 = substring(c from 11 for 1)::integer;
end;
$$;

create or replace function public.cnpj_valido(p_valor text)
returns boolean
language plpgsql
immutable
as $$
declare
  c text := regexp_replace(coalesce(p_valor, ''), '\D', '', 'g');
  soma integer;
  peso integer;
  i integer;
  d1 integer;
  d2 integer;
begin
  if length(c) <> 14 then return false; end if;
  if c ~ '^(\d)\1{13}$' then return false; end if;

  soma := 0; peso := 5;
  for i in 1..12 loop
    soma := soma + substring(c from i for 1)::integer * peso;
    peso := peso - 1;
    if peso < 2 then peso := 9; end if;
  end loop;
  d1 := soma % 11;
  d1 := case when d1 < 2 then 0 else 11 - d1 end;
  if d1 <> substring(c from 13 for 1)::integer then return false; end if;

  soma := 0; peso := 6;
  for i in 1..13 loop
    soma := soma + substring(c from i for 1)::integer * peso;
    peso := peso - 1;
    if peso < 2 then peso := 9; end if;
  end loop;
  d2 := soma % 11;
  d2 := case when d2 < 2 then 0 else 11 - d2 end;
  return d2 = substring(c from 14 for 1)::integer;
end;
$$;

-- Dispatcha pelo tipo declarado — usado onde o documento vem com um campo
-- "é CPF ou CNPJ" ao lado (leads.tipo_documento).
create or replace function public.documento_valido(p_valor text, p_tipo text)
returns boolean
language sql
immutable
as $$
  select case p_tipo
    when 'cpf'  then public.cpf_valido(p_valor)
    when 'cnpj' then public.cnpj_valido(p_valor)
    else false
  end;
$$;

-- Telefone BR: só o formato (10 ou 11 dígitos, com DDD). Não existe dígito
-- verificador de telefone para checar de verdade.
create or replace function public.telefone_valido(p_valor text)
returns boolean
language sql
immutable
as $$
  select length(regexp_replace(coalesce(p_valor, ''), '\D', '', 'g')) in (10, 11);
$$;

-- CEP: 8 dígitos, mascarado ou não — mesma regra de clientes.cep (migração
-- 004), só que tolerando os dois formatos como pedido pela especificação.
create or replace function public.cep_valido(p_valor text)
returns boolean
language sql
immutable
as $$
  select length(regexp_replace(coalesce(p_valor, ''), '\D', '', 'g')) = 8;
$$;

-- E-mail: pragmático, não RFC — a mesma regra de js/pedido.js, para o banco
-- concordar com o que a tela já validou. Uma lista de "domínios suspeitos"
-- (descartáveis, etc.) não entra aqui: esses domínios mudam toda semana, uma
-- lista fixa no banco ficaria desatualizada rápido e barraria e-mail real
-- por engano — o valor real de bloquear e-mail descartável é revisão humana
-- no painel (a pessoa aparece na aba Leads/Clientes de qualquer forma), não
-- uma blocklist estática.
create or replace function public.email_valido(p_valor text)
returns boolean
language sql
immutable
as $$
  select p_valor ~ '^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$';
$$;

-- Campo de texto livre (nome, bairro, endereço...): teto de tamanho e sem
-- `<`/`>` literais. NÃO é a defesa contra XSS (essa é a escapagem na saída,
-- já em uso — ver o cabeçalho) — é só para um formulário aberto ao público
-- não virar depósito de HTML/script nem de texto gigante. Aspas, apóstrofo e
-- acento continuam liberados: "D'Ávila", "Praça XV" são nomes reais.
create or replace function public.texto_seguro(p_valor text, p_tamanho_maximo integer default 200)
returns boolean
language sql
immutable
as $$
  select p_valor is null
      or (char_length(p_valor) <= p_tamanho_maximo and p_valor !~ '[<>]');
$$;

-- ============================================================================
-- 2. pedidos — INSERT é público; aqui é onde a validação mais importa
-- ============================================================================
alter table public.pedidos drop constraint if exists pedidos_cnpj_valido;
alter table public.pedidos add constraint pedidos_cnpj_valido
  check (public.cnpj_valido(cnpj)) not valid;

alter table public.pedidos drop constraint if exists pedidos_telefone_valido;
alter table public.pedidos add constraint pedidos_telefone_valido
  check (public.telefone_valido(telefone)) not valid;

alter table public.pedidos drop constraint if exists pedidos_email_valido;
alter table public.pedidos add constraint pedidos_email_valido
  check (email is null or email = '' or public.email_valido(email)) not valid;

alter table public.pedidos drop constraint if exists pedidos_cep_valido;
alter table public.pedidos add constraint pedidos_cep_valido
  check (cep is null or public.cep_valido(cep)) not valid;

alter table public.pedidos drop constraint if exists pedidos_razao_social_segura;
alter table public.pedidos add constraint pedidos_razao_social_segura
  check (public.texto_seguro(razao_social, 200)) not valid;

alter table public.pedidos drop constraint if exists pedidos_responsavel_seguro;
alter table public.pedidos add constraint pedidos_responsavel_seguro
  check (public.texto_seguro(responsavel, 200)) not valid;

alter table public.pedidos drop constraint if exists pedidos_endereco_seguro;
alter table public.pedidos add constraint pedidos_endereco_seguro
  check (
    public.texto_seguro(logradouro, 200) and public.texto_seguro(numero, 30) and
    public.texto_seguro(complemento, 100) and public.texto_seguro(bairro, 100) and
    public.texto_seguro(cidade, 100)
  ) not valid;

alter table public.pedidos drop constraint if exists pedidos_observacoes_segura;
alter table public.pedidos add constraint pedidos_observacoes_segura
  check (public.texto_seguro(observacoes, 2000)) not valid;

-- ============================================================================
-- 3. lista_espera — mesma exposição de pedidos (INSERT público), campos
--    nullable porque o formulário de espera é mais curto
-- ============================================================================
alter table public.lista_espera drop constraint if exists espera_cnpj_valido;
alter table public.lista_espera add constraint espera_cnpj_valido
  check (cnpj is null or cnpj = '' or public.cnpj_valido(cnpj)) not valid;

alter table public.lista_espera drop constraint if exists espera_telefone_valido;
alter table public.lista_espera add constraint espera_telefone_valido
  check (telefone is null or telefone = '' or public.telefone_valido(telefone)) not valid;

alter table public.lista_espera drop constraint if exists espera_email_valido;
alter table public.lista_espera add constraint espera_email_valido
  check (email is null or email = '' or public.email_valido(email)) not valid;

alter table public.lista_espera drop constraint if exists espera_cep_valido;
alter table public.lista_espera add constraint espera_cep_valido
  check (cep is null or public.cep_valido(cep)) not valid;

alter table public.lista_espera drop constraint if exists espera_texto_seguro;
alter table public.lista_espera add constraint espera_texto_seguro
  check (
    public.texto_seguro(razao_social, 200) and public.texto_seguro(responsavel, 200) and
    public.texto_seguro(cidade, 100) and public.texto_seguro(endereco, 300) and
    public.texto_seguro(observacoes, 2000)
  ) not valid;

-- ============================================================================
-- 4. leads — tabela nova (migração 011): CHECK normal, já validado
-- ============================================================================
-- documento_valido() é redundante com o CHECK de tipo_documento que a 011 já
-- criou (in ('cpf','cnpj')) — soma-se a ele: aquele garante o RÓTULO, este
-- garante que o NÚMERO bate com o rótulo.
alter table public.leads drop constraint if exists leads_documento_valido;
alter table public.leads add constraint leads_documento_valido
  check (public.documento_valido(documento, tipo_documento));

alter table public.leads drop constraint if exists leads_telefone_valido;
alter table public.leads add constraint leads_telefone_valido
  check (public.telefone_valido(telefone));

alter table public.leads drop constraint if exists leads_nome_seguro;
alter table public.leads add constraint leads_nome_seguro
  check (public.texto_seguro(nome, 150));

-- ============================================================================
-- 5. usuarios / clientes — escrita já é só do gatilho da 006 (security
--    definer) ou do admin autenticado, não do visitante anônimo. Ainda assim,
--    dado errado aqui vaza para nota fiscal e WhatsApp do vendedor — vale a
--    mesma trava.
-- ============================================================================
alter table public.usuarios drop constraint if exists usuarios_cpf_valido;
alter table public.usuarios add constraint usuarios_cpf_valido
  check (cpf is null or public.cpf_valido(cpf)) not valid;

alter table public.usuarios drop constraint if exists usuarios_cnpj_valido;
alter table public.usuarios add constraint usuarios_cnpj_valido
  check (cnpj is null or public.cnpj_valido(cnpj)) not valid;

alter table public.usuarios drop constraint if exists usuarios_telefone_valido;
alter table public.usuarios add constraint usuarios_telefone_valido
  check (telefone is null or public.telefone_valido(telefone)) not valid;

alter table public.usuarios drop constraint if exists usuarios_email_valido;
alter table public.usuarios add constraint usuarios_email_valido
  check (email is null or email = '' or public.email_valido(email)) not valid;

alter table public.usuarios drop constraint if exists usuarios_nome_seguro;
alter table public.usuarios add constraint usuarios_nome_seguro
  check (public.texto_seguro(nome, 200)) not valid;

alter table public.clientes drop constraint if exists clientes_endereco_seguro;
alter table public.clientes add constraint clientes_endereco_seguro
  check (
    public.texto_seguro(apelido, 100) and public.texto_seguro(logradouro, 200) and
    public.texto_seguro(numero, 30) and public.texto_seguro(complemento, 100) and
    public.texto_seguro(bairro, 100) and public.texto_seguro(cidade, 100)
  ) not valid;

-- ============================================================================
-- Como conferir o que já existe e não passaria na validação nova
-- ============================================================================
-- As linhas atuais NÃO foram tocadas (constraints ficaram NOT VALID onde
-- havia risco de dado antigo). Para ver quais violam:
--
--   select id, cnpj, telefone, email, cep from public.pedidos
--    where not public.cnpj_valido(cnpj)
--       or not public.telefone_valido(telefone)
--       or (email is not null and email <> '' and not public.email_valido(email))
--       or (cep is not null and not public.cep_valido(cep));
--
-- Depois de corrigir (ou decidir que os dados antigos ficam como estão),
-- validar de verdade é opcional:
--
--   alter table public.pedidos validate constraint pedidos_cnpj_valido;
--
-- (repete para cada constraint/tabela). Sem rodar isso, a proteção contra
-- dado NOVO já está ativa — só não é retroativa.
