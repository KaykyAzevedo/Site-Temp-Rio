-- BASE (referência): public.vitrines — exportada de PRODUÇÃO em 2026-11-13, somente leitura
-- (information_schema, pg_constraint, pg_indexes, pg_policies, role_table_grants, pg_trigger).
-- Motivo: a tabela existe no banco e é usada pela 028 (exige) e pela 032 (antispam), mas nunca
-- teve CREATE TABLE versionado no repositório (achado 6 da auditoria de 2026-11-13).
--
-- NÃO precisa rodar em produção (já existe igual). Serve para auditoria e para recriar o banco
-- do zero / PG local de teste. Idempotente: não altera uma tabela que já exista.
-- Ordem num banco novo: depois da 001 (eh_admin), pedidos, 028 e 032 (antispam_032_trigger).
-- Em produção a tabela tinha 0 linhas na exportação.
begin;

create table if not exists public.vitrines (
  id             uuid primary key default gen_random_uuid(),
  criado_em      timestamptz not null default now(),
  cnpj           text not null,
  razao_social   text not null,
  responsavel    text,
  telefone       text,
  email          text,
  cep            text,
  logradouro     text,
  numero         text,
  complemento    text,
  bairro         text,
  cidade         text,
  uf             text not null,
  regiao         text,
  pedido_id      uuid references public.pedidos(id) on delete set null,
  caixas         integer not null default 0,
  valor_centavos bigint not null default 0,
  motivos        text[] not null default '{}'::text[],
  tipo           text not null,
  dias           integer not null default 1,
  status         text not null default 'pendente',
  data_inicio    date,
  data_fim       date,
  aprovado_em    timestamptz,
  aprovado_por   text,
  observacao     text,
  armadilha      text,
  constraint vitrine_so_rio        check (uf = 'RJ'),
  constraint vitrines_status_check check (status in ('pendente', 'aprovado', 'rejeitado')),
  constraint vitrines_tipo_check   check (tipo in ('basic', 'pro', 'premium'))
);
-- Em produção também existe vitrines_028_tamanhos (CHECK de tamanhos, NOT VALID), criada pela 028.

create index if not exists vitrines_status_idx  on public.vitrines (status);
create index if not exists vitrines_periodo_idx on public.vitrines (data_inicio, data_fim);
create index if not exists vitrines_cnpj_idx    on public.vitrines (cnpj);

alter table public.vitrines enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vitrines' and policyname = 'site solicita vitrine') then
    create policy "site solicita vitrine" on public.vitrines for insert to anon, authenticated
      with check (status = 'pendente' and uf = 'RJ');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vitrines' and policyname = 'admin le vitrines') then
    create policy "admin le vitrines" on public.vitrines for select to authenticated
      using (public.eh_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vitrines' and policyname = 'admin decide vitrines') then
    create policy "admin decide vitrines" on public.vitrines for update to authenticated
      using (public.eh_admin()) with check (public.eh_admin());
  end if;
end;
$$;

-- Gatilho do antispam (função criada pela 032).
do $$
begin
  if to_regprocedure('public.antispam_032_trigger()') is not null
     and not exists (select 1 from pg_trigger where tgrelid = 'public.vitrines'::regclass and tgname = 'a000_antispam_032') then
    create trigger a000_antispam_032 before insert on public.vitrines
      for each row execute function public.antispam_032_trigger();
  end if;
end;
$$;

-- Grants de produção na exportação: anon e authenticated com SELECT/INSERT/UPDATE/DELETE na
-- tabela (padrão do Supabase). O RLS acima é o que restringe: anon só consegue INSERT pendente/RJ.
-- Endurecer esses grants é tarefa de migração (038), não deste arquivo de base.

commit;
