-- 016 — Corrige a validação da 013: CHECK "NOT VALID" trava linha antiga
-- inteira, não só dado novo
--
-- ============================================================================
-- O BUG (achado testando o painel)
-- ============================================================================
--
-- A 013 supôs que `CHECK ... NOT VALID` protege só ESCRITA NOVA, sem tocar
-- linha antiga com dado ruim (CNPJ de demonstração tipo "11.222.333/0001-44",
-- que não passa no dígito verificador). Isso está certo pela metade: `NOT
-- VALID` só pula a VARREDURA em massa no momento de criar a restrição — a
-- partir daí, TODO UPDATE em QUALQUER linha (antiga ou nova) é conferido de
-- novo contra a constraint inteira, mesmo trocando uma coluna que não tem
-- nada a ver com CNPJ/telefone/e-mail/CEP. Postgres reavalia a linha toda,
-- não a coluna que mudou.
--
-- Resultado real: dos pedidos hoje no banco, 26 têm CNPJ de demonstração
-- inválido. "Marcar entregue", "Confirmar" e "Cancelar" chamam
-- `update pedidos set status = ...` — e o Postgres rejeita com
-- `violates check constraint "pedidos_cnpj_valido"`, mesmo o pedido não
-- tendo CNPJ nenhum alterado. No painel isso aparecia como o clique
-- "travando": o `sb.update(...).then()` só reage ao terminar, e o erro
-- disparava um `window.alert()` nativo, que trava a aba até alguém (ou o
-- watchdog do automation) fechar a caixa — parecia congelamento de render,
-- era erro de banco com aviso bloqueante.
--
-- ============================================================================
-- A CORREÇÃO
-- ============================================================================
--
-- Troca os `CHECK` de cnpj/cpf/telefone/e-mail/CEP/texto por um trigger
-- `before insert or update` que só valida a coluna que de fato mudou (ou
-- todas, se a linha é nova). `INSERT` continua tão travado quanto antes;
-- `UPDATE` para de reabrir campo que ninguém tocou. É o comportamento que a
-- 013 já descrevia na intenção ("proteção contra dado novo"), só que
-- implementado do jeito que o Postgres exige para isso ser verdade em
-- UPDATE.
--
-- Idempotente: `create or replace function`, `drop trigger if exists` antes
-- de recriar, `drop constraint if exists` nos CHECKs antigos. Rodar de novo
-- não quebra nada.

-- ============================================================================
-- 1. pedidos
-- ============================================================================
create or replace function public.pedidos_valida_alteracoes()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' or NEW.cnpj is distinct from OLD.cnpj then
    if not public.cnpj_valido(NEW.cnpj) then
      raise exception 'CNPJ inválido: %', NEW.cnpj;
    end if;
  end if;

  if TG_OP = 'INSERT' or NEW.telefone is distinct from OLD.telefone then
    if not public.telefone_valido(NEW.telefone) then
      raise exception 'Telefone inválido: %', NEW.telefone;
    end if;
  end if;

  if TG_OP = 'INSERT' or NEW.email is distinct from OLD.email then
    if NEW.email is not null and NEW.email <> '' and not public.email_valido(NEW.email) then
      raise exception 'E-mail inválido: %', NEW.email;
    end if;
  end if;

  if TG_OP = 'INSERT' or NEW.cep is distinct from OLD.cep then
    if NEW.cep is not null and not public.cep_valido(NEW.cep) then
      raise exception 'CEP inválido: %', NEW.cep;
    end if;
  end if;

  if TG_OP = 'INSERT' or NEW.razao_social is distinct from OLD.razao_social then
    if not public.texto_seguro(NEW.razao_social, 200) then
      raise exception 'Razão social inválida';
    end if;
  end if;

  if TG_OP = 'INSERT' or NEW.responsavel is distinct from OLD.responsavel then
    if not public.texto_seguro(NEW.responsavel, 200) then
      raise exception 'Responsável inválido';
    end if;
  end if;

  if TG_OP = 'INSERT'
     or NEW.logradouro is distinct from OLD.logradouro
     or NEW.numero is distinct from OLD.numero
     or NEW.complemento is distinct from OLD.complemento
     or NEW.bairro is distinct from OLD.bairro
     or NEW.cidade is distinct from OLD.cidade then
    if not (
      public.texto_seguro(NEW.logradouro, 200) and public.texto_seguro(NEW.numero, 30) and
      public.texto_seguro(NEW.complemento, 100) and public.texto_seguro(NEW.bairro, 100) and
      public.texto_seguro(NEW.cidade, 100)
    ) then
      raise exception 'Endereço inválido';
    end if;
  end if;

  if TG_OP = 'INSERT' or NEW.observacoes is distinct from OLD.observacoes then
    if not public.texto_seguro(NEW.observacoes, 2000) then
      raise exception 'Observações inválidas (texto grande demais ou com < / >)';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_pedidos_valida on public.pedidos;
create trigger trg_pedidos_valida
  before insert or update on public.pedidos
  for each row execute function public.pedidos_valida_alteracoes();

alter table public.pedidos drop constraint if exists pedidos_cnpj_valido;
alter table public.pedidos drop constraint if exists pedidos_telefone_valido;
alter table public.pedidos drop constraint if exists pedidos_email_valido;
alter table public.pedidos drop constraint if exists pedidos_cep_valido;
alter table public.pedidos drop constraint if exists pedidos_razao_social_segura;
alter table public.pedidos drop constraint if exists pedidos_responsavel_seguro;
alter table public.pedidos drop constraint if exists pedidos_endereco_seguro;
alter table public.pedidos drop constraint if exists pedidos_observacoes_segura;

-- ============================================================================
-- 2. lista_espera — mesmos campos, todos nullable
-- ============================================================================
create or replace function public.lista_espera_valida_alteracoes()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' or NEW.cnpj is distinct from OLD.cnpj then
    if NEW.cnpj is not null and NEW.cnpj <> '' and not public.cnpj_valido(NEW.cnpj) then
      raise exception 'CNPJ inválido: %', NEW.cnpj;
    end if;
  end if;

  if TG_OP = 'INSERT' or NEW.telefone is distinct from OLD.telefone then
    if NEW.telefone is not null and NEW.telefone <> '' and not public.telefone_valido(NEW.telefone) then
      raise exception 'Telefone inválido: %', NEW.telefone;
    end if;
  end if;

  if TG_OP = 'INSERT' or NEW.email is distinct from OLD.email then
    if NEW.email is not null and NEW.email <> '' and not public.email_valido(NEW.email) then
      raise exception 'E-mail inválido: %', NEW.email;
    end if;
  end if;

  if TG_OP = 'INSERT' or NEW.cep is distinct from OLD.cep then
    if NEW.cep is not null and not public.cep_valido(NEW.cep) then
      raise exception 'CEP inválido: %', NEW.cep;
    end if;
  end if;

  if TG_OP = 'INSERT'
     or NEW.razao_social is distinct from OLD.razao_social
     or NEW.responsavel is distinct from OLD.responsavel
     or NEW.cidade is distinct from OLD.cidade
     or NEW.endereco is distinct from OLD.endereco
     or NEW.observacoes is distinct from OLD.observacoes then
    if not (
      public.texto_seguro(NEW.razao_social, 200) and public.texto_seguro(NEW.responsavel, 200) and
      public.texto_seguro(NEW.cidade, 100) and public.texto_seguro(NEW.endereco, 300) and
      public.texto_seguro(NEW.observacoes, 2000)
    ) then
      raise exception 'Texto inválido (tamanho ou < / >)';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_lista_espera_valida on public.lista_espera;
create trigger trg_lista_espera_valida
  before insert or update on public.lista_espera
  for each row execute function public.lista_espera_valida_alteracoes();

alter table public.lista_espera drop constraint if exists espera_cnpj_valido;
alter table public.lista_espera drop constraint if exists espera_telefone_valido;
alter table public.lista_espera drop constraint if exists espera_email_valido;
alter table public.lista_espera drop constraint if exists espera_cep_valido;
alter table public.lista_espera drop constraint if exists espera_texto_seguro;

-- ============================================================================
-- 3. usuarios
-- ============================================================================
create or replace function public.usuarios_valida_alteracoes()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' or NEW.cpf is distinct from OLD.cpf then
    if NEW.cpf is not null and not public.cpf_valido(NEW.cpf) then
      raise exception 'CPF inválido: %', NEW.cpf;
    end if;
  end if;

  if TG_OP = 'INSERT' or NEW.cnpj is distinct from OLD.cnpj then
    if NEW.cnpj is not null and not public.cnpj_valido(NEW.cnpj) then
      raise exception 'CNPJ inválido: %', NEW.cnpj;
    end if;
  end if;

  if TG_OP = 'INSERT' or NEW.telefone is distinct from OLD.telefone then
    if NEW.telefone is not null and not public.telefone_valido(NEW.telefone) then
      raise exception 'Telefone inválido: %', NEW.telefone;
    end if;
  end if;

  if TG_OP = 'INSERT' or NEW.email is distinct from OLD.email then
    if NEW.email is not null and NEW.email <> '' and not public.email_valido(NEW.email) then
      raise exception 'E-mail inválido: %', NEW.email;
    end if;
  end if;

  if TG_OP = 'INSERT' or NEW.nome is distinct from OLD.nome then
    if not public.texto_seguro(NEW.nome, 200) then
      raise exception 'Nome inválido';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_usuarios_valida on public.usuarios;
create trigger trg_usuarios_valida
  before insert or update on public.usuarios
  for each row execute function public.usuarios_valida_alteracoes();

alter table public.usuarios drop constraint if exists usuarios_cpf_valido;
alter table public.usuarios drop constraint if exists usuarios_cnpj_valido;
alter table public.usuarios drop constraint if exists usuarios_telefone_valido;
alter table public.usuarios drop constraint if exists usuarios_email_valido;
alter table public.usuarios drop constraint if exists usuarios_nome_seguro;

-- ============================================================================
-- 4. clientes — só o endereço tem CHECK (o resto vem de usuarios)
-- ============================================================================
create or replace function public.clientes_valida_alteracoes()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT'
     or NEW.apelido is distinct from OLD.apelido
     or NEW.logradouro is distinct from OLD.logradouro
     or NEW.numero is distinct from OLD.numero
     or NEW.complemento is distinct from OLD.complemento
     or NEW.bairro is distinct from OLD.bairro
     or NEW.cidade is distinct from OLD.cidade then
    if not (
      public.texto_seguro(NEW.apelido, 100) and public.texto_seguro(NEW.logradouro, 200) and
      public.texto_seguro(NEW.numero, 30) and public.texto_seguro(NEW.complemento, 100) and
      public.texto_seguro(NEW.bairro, 100) and public.texto_seguro(NEW.cidade, 100)
    ) then
      raise exception 'Endereço inválido';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_clientes_valida on public.clientes;
create trigger trg_clientes_valida
  before insert or update on public.clientes
  for each row execute function public.clientes_valida_alteracoes();

alter table public.clientes drop constraint if exists clientes_endereco_seguro;

-- ============================================================================
-- Como conferir que deu certo
-- ============================================================================
--
-- 1. `select count(*) from pg_trigger where tgname like 'trg_%_valida';`
--    → 4 (pedidos, lista_espera, usuarios, clientes).
--
-- 2. Pegar um pedido com CNPJ de demonstração inválido e só mudar o status:
--
--   update public.pedidos set status = status where id = (
--     select id from public.pedidos where not public.cnpj_valido(cnpj) limit 1
--   );
--
--   Antes desta migração: erro de constraint. Depois: passa (o `cnpj` não
--   mudou, então a validação de CNPJ nem roda).
--
-- 3. Escrita nova ainda é travada — tentar inserir CNPJ malformado continua
--    dando erro, INSERT sempre valida tudo.
