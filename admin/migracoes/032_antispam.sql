-- 032: protecao anti-spam nos INSERTs anonimos do site (pendencia da auditoria 028).
-- APLICADA em 2026-11-12. Instalacao manual no SQL Editor (papel postgres). Idempotente: pode rodar de novo.
-- Nao altera nem apaga dados existentes; o unico DELETE (retencao, com WHERE) fica no trigger.
-- Sem servico externo e sem conta nova (Turnstile/Cloudflare fica documentado como opcao).
--
-- (A) Limite de taxa por origem em pedidos, leads, lista_espera, consentimentos, vitrines,
--     solicitacoes_lgpd e visitas: trigger BEFORE INSERT (primeiro da fila: nome 'a000_...')
--     so para os papeis da API publica (anon e authenticated fora da equipe). Equipe,
--     service_role e SQL Editor nunca sao limitados.
--     Origem = IP do cliente lido de request.headers (PostgREST): cf-connecting-ip, senao
--     x-real-ip, senao o 1o item de x-forwarded-for (o que a doc do Supabase indica). ATENCAO:
--     o 1o item de x-forwarded-for pode ser forjado pelo cliente (a Cloudflare acrescenta, nao
--     substitui); por isso ha tambem um DISJUNTOR GLOBAL por tabela/minuto que nao depende do IP.
--     Sem IP: chave pela 'sessao' do proprio insert (visitas/leads); sem nada: so o disjuntor.
--     Conferir em producao quais headers chegam: select public.antispam_032_diagnostico();
--     (logado como admin no painel; devolve so presenca/contagem, nunca o IP).
-- (B) LGPD: o IP NUNCA e gravado; so sha256(sal || ip). O sal e aleatorio, gerado na instalacao,
--     guardado em tabela sem acesso pela API (nao esta no repositorio: hash com sal publico seria
--     reversivel por forca bruta no espaco IPv4). Eventos com mais de 48 h sao apagados em TODA
--     escrita protegida (DELETE com WHERE pelo indice de 'em') e, se a extensao pg_cron estiver
--     habilitada, tambem por um job de hora em hora ('antispam_032_limpeza'). Sem pg_cron e sem
--     nenhuma escrita no site, um evento vencido fica ate a proxima escrita. Finalidade: seguranca.
-- (C) Honeypot: coluna 'armadilha' (text, sempre NULL gravado) nas tabelas de formulario. Se vier
--     preenchida, o insert e DESCARTADO em silencio (trigger devolve NULL: HTTP 201 sem gravar),
--     para o robo nao aprender. Precisa ser coluna porque o PostgREST recusa campo desconhecido.
--     visitas nao tem formulario: sem coluna.
-- Limite estourado: erro 'muitas tentativas, tente novamente em alguns minutos', SQLSTATE 'TR429'
-- (PostgREST devolve HTTP 400 com code TR429; o site mostra mensagem amigavel).
begin;

do $$
begin
  if to_regclass('public.pedidos') is null or to_regclass('public.leads') is null
     or to_regclass('public.lista_espera') is null or to_regclass('public.consentimentos') is null
     or to_regclass('public.vitrines') is null or to_regclass('public.solicitacoes_lgpd') is null
     or to_regclass('public.visitas') is null
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('public.eh_admin()') is null then
    raise exception '032 requer as tabelas publicas (pedidos, leads, lista_espera, consentimentos, vitrines, solicitacoes_lgpd, visitas) e eh_equipe()/eh_admin(). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100,32);

-- Sal secreto por instalacao (nunca exposto pela API).
create table if not exists public.antispam_032_config (
  id smallint primary key check (id = 1),
  sal text not null check (char_length(sal) >= 32)
);
insert into public.antispam_032_config(id, sal)
  select 1, encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text || random()::text, 'UTF8')), 'hex')
   where not exists (select 1 from public.antispam_032_config where id = 1);

-- Eventos de escrita (so hash, tabela e instante). Retencao <= 48 h.
create table if not exists public.antispam_032_eventos (
  id bigint generated always as identity primary key,
  chave text,
  tabela text not null,
  em timestamptz not null default now()
);
create index if not exists antispam_032_eventos_chave_idx on public.antispam_032_eventos(tabela, chave, em) where chave is not null;
create index if not exists antispam_032_eventos_tabela_idx on public.antispam_032_eventos(tabela, em);
create index if not exists antispam_032_eventos_em_idx on public.antispam_032_eventos(em);

alter table public.antispam_032_config enable row level security;
alter table public.antispam_032_eventos enable row level security;
revoke all on public.antispam_032_config, public.antispam_032_eventos from public, anon, authenticated;
revoke all on sequence public.antispam_032_eventos_id_seq from public, anon, authenticated;
-- Sem nenhuma policy: nem a equipe le pela API (nao ha o que ver alem de hashes).

-- Honeypot: coluna nas tabelas com formulario.
alter table public.pedidos add column if not exists armadilha text;
alter table public.leads add column if not exists armadilha text;
alter table public.lista_espera add column if not exists armadilha text;
alter table public.consentimentos add column if not exists armadilha text;
alter table public.vitrines add column if not exists armadilha text;
alter table public.solicitacoes_lgpd add column if not exists armadilha text;

create or replace function public.antispam_032_ip()
returns text
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_h jsonb;
  v_ip text;
begin
  begin
    v_h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if v_h is null or jsonb_typeof(v_h) <> 'object' then return null; end if;
  v_ip := coalesce(nullif(btrim(v_h->>'cf-connecting-ip'), ''),
                   nullif(btrim(v_h->>'x-real-ip'), ''),
                   nullif(btrim(split_part(v_h->>'x-forwarded-for', ',', 1)), ''));
  if v_ip is null or char_length(v_ip) > 64 then return null; end if;
  -- So aceita IP valido (lixo no header nao vira chave).
  begin
    return host(v_ip::inet);
  exception when others then
    return null;
  end;
end;
$$;
revoke all on function public.antispam_032_ip() from public, anon, authenticated;

create or replace function public.antispam_032_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_papel text := coalesce(current_setting('role', true), '');
  v_linha jsonb := to_jsonb(new);
  v_tabela text := tg_table_name;
  v_ip text;
  v_base text;
  v_chave text;
  v_sal text;
  v_curto_qtd int; v_curto_janela interval;
  v_longo_qtd int; v_longo_janela interval;
  v_global_min int;
  v_n bigint;
begin
  -- Honeypot: preenchido = robo. Descarta em silencio, para qualquer papel da API publica.
  if v_linha ? 'armadilha' then
    if nullif(btrim(coalesce(v_linha->>'armadilha', '')), '') is not null
       and v_papel in ('anon', 'authenticated') then
      return null;
    end if;
    new := jsonb_populate_record(new, jsonb_build_object('armadilha', null));
  end if;

  -- So os papeis da API publica; equipe isenta (eh_equipe e SECURITY DEFINER, le o JWT).
  if v_papel not in ('anon', 'authenticated') then return new; end if;
  if v_papel = 'authenticated' and coalesce(public.eh_equipe(), false) then return new; end if;

  -- Limites: curto (por origem), longo (por origem), global por minuto (disjuntor).
  case v_tabela
    when 'pedidos' then v_curto_qtd := 5;  v_curto_janela := interval '10 minutes'; v_longo_qtd := 20;  v_longo_janela := interval '1 day';  v_global_min := 30;
    when 'leads' then v_curto_qtd := 10; v_curto_janela := interval '1 hour';     v_longo_qtd := 30;  v_longo_janela := interval '1 day';  v_global_min := 30;
    when 'lista_espera' then v_curto_qtd := 10; v_curto_janela := interval '1 hour'; v_longo_qtd := 30; v_longo_janela := interval '1 day'; v_global_min := 30;
    when 'consentimentos' then v_curto_qtd := 20; v_curto_janela := interval '1 hour'; v_longo_qtd := 60; v_longo_janela := interval '1 day'; v_global_min := 60;
    when 'vitrines' then v_curto_qtd := 10; v_curto_janela := interval '1 hour'; v_longo_qtd := 30; v_longo_janela := interval '1 day'; v_global_min := 30;
    when 'solicitacoes_lgpd' then v_curto_qtd := 5; v_curto_janela := interval '1 hour'; v_longo_qtd := 10; v_longo_janela := interval '1 day'; v_global_min := 20;
    when 'visitas' then v_curto_qtd := 120; v_curto_janela := interval '1 hour'; v_longo_qtd := 600; v_longo_janela := interval '1 day'; v_global_min := 600;
    else return new;
  end case;

  -- Serializa por tabela: contagem + registro sem corrida entre inserts simultaneos.
  perform pg_advisory_xact_lock(5132, hashtext(v_tabela));

  -- Disjuntor global (independe de IP: cobre IP forjado/rotativo).
  select count(*) into v_n from public.antispam_032_eventos
   where tabela = v_tabela and em > now() - interval '1 minute';
  if v_n >= v_global_min then
    raise exception 'muitas tentativas, tente novamente em alguns minutos' using errcode = 'TR429';
  end if;

  v_ip := public.antispam_032_ip();
  v_base := case
    when v_ip is not null then 'ip:' || v_ip
    when nullif(btrim(coalesce(v_linha->>'sessao', '')), '') is not null then 'sessao:' || left(v_linha->>'sessao', 100)
    else null end;
  if v_base is not null then
    select sal into v_sal from public.antispam_032_config where id = 1;
    v_chave := encode(sha256(convert_to(coalesce(v_sal, '') || '|' || v_base, 'UTF8')), 'hex');
    select count(*) into v_n from public.antispam_032_eventos
     where tabela = v_tabela and chave = v_chave and em > now() - v_curto_janela;
    if v_n >= v_curto_qtd then
      raise exception 'muitas tentativas, tente novamente em alguns minutos' using errcode = 'TR429';
    end if;
    select count(*) into v_n from public.antispam_032_eventos
     where tabela = v_tabela and chave = v_chave and em > now() - v_longo_janela;
    if v_n >= v_longo_qtd then
      raise exception 'muitas tentativas, tente novamente em alguns minutos' using errcode = 'TR429';
    end if;
  end if;

  insert into public.antispam_032_eventos(chave, tabela) values (v_chave, v_tabela);

  -- Retencao: vencidos (> 48 h) saem em toda escrita protegida; o indice em 'em' deixa isso barato
  -- (normalmente 0 linhas). WHERE obrigatorio (safeupdate).
  delete from public.antispam_032_eventos where em < now() - interval '48 hours';
  return new;
end;
$$;
revoke all on function public.antispam_032_trigger() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['pedidos','leads','lista_espera','consentimentos','vitrines','solicitacoes_lgpd','visitas'] loop
    execute format('drop trigger if exists a000_antispam_032 on public.%I', t);
    execute format('create trigger a000_antispam_032 before insert on public.%I for each row execute function public.antispam_032_trigger()', t);
  end loop;
end;
$$;

-- Limpeza agendada (garante o prazo mesmo sem trafego) quando pg_cron existe; senao so avisa.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'antispam_032_limpeza') then
      perform cron.unschedule('antispam_032_limpeza');
    end if;
    perform cron.schedule('antispam_032_limpeza', '17 * * * *',
      $job$delete from public.antispam_032_eventos where em < now() - interval '48 hours'$job$);
  else
    raise notice '032: pg_cron nao habilitado; eventos vencidos saem na proxima escrita protegida.';
  end if;
end;
$$;

-- Diagnostico para conferir em producao (admin logado, via API): so presenca/contagem.
create or replace function public.antispam_032_diagnostico()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_h jsonb;
begin
  if not coalesce(public.eh_admin(), false) then
    raise exception 'somente admin' using errcode = '42501';
  end if;
  begin
    v_h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_h := null;
  end;
  return jsonb_build_object(
    'tem_request_headers', v_h is not null,
    'tem_cf_connecting_ip', coalesce(v_h ? 'cf-connecting-ip', false),
    'tem_x_real_ip', coalesce(v_h ? 'x-real-ip', false),
    'itens_x_forwarded_for', case when v_h ? 'x-forwarded-for'
                               then array_length(string_to_array(v_h->>'x-forwarded-for', ','), 1) else 0 end,
    'ip_reconhecido', public.antispam_032_ip() is not null,
    'eventos_48h', (select count(*) from public.antispam_032_eventos where em > now() - interval '48 hours'));
end;
$$;
revoke all on function public.antispam_032_diagnostico() from public, anon;
grant execute on function public.antispam_032_diagnostico() to authenticated;

commit;
