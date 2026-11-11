-- 027: estoque da fabrica (insumos), endereco de clientes CNPJ e formas de pagamento SOLIDCON.
-- APLICADA em 2026-11-11. Instalacao manual; nenhum acesso ao ERP e nenhuma alteracao no site.
-- Nao altera solidcon_receber_produtos nem o espelho de estoque vendavel (019/020).
-- (A) solidcon_insumos + solidcon_insumos_diario + solidcon_insumos_sync, RPC solidcon_receber_insumos.
-- (B) solidcon_clientes: logradouro/numero/complemento/cep (so CNPJ); solidcon_receber_clientes
--     aceita payload antigo (9 campos) e novo (13 campos).
-- (C) solidcon_vendas_modalidade + solidcon_vendas_modalidade_sync, RPC solidcon_receber_vendas_modalidade.
-- Leitura: somente eh_equipe(); anon nada. Escrita: somente RPCs SECURITY DEFINER da integracao.
begin;

do $$
begin
  if to_regclass('public.solidcon_produtos') is null
     or to_regclass('public.solidcon_clientes') is null
     or to_regclass('public.solidcon_clientes_sync') is null
     or to_regclass('public.integracoes_autorizadas') is null
     or to_regprocedure('public.solidcon_receber_clientes(jsonb,timestamptz,uuid)') is null
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('public.eh_admin()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception '027 requer 019/023 completas e helpers eh_equipe()/eh_admin() de producao. Nada foi aplicado.';
  end if;
end;
$$;

-- Locks proprios de insumos (5100,27) e modalidades (5100,28); clientes reusa (5100,23).
select pg_catalog.pg_advisory_xact_lock(5100,27);
select pg_catalog.pg_advisory_xact_lock(5100,28);
select pg_catalog.pg_advisory_xact_lock(5100,23);

-- ===================== (A) ESTOQUE DA FABRICA =====================
-- Tudo que NAO e das 2 categorias vendaveis (materia-prima, embalagens etc.).
-- estoque = valor bruto do ERP (pode ser negativo). Ausente do ultimo snapshot: presente=false,
-- estoque fica com o ultimo valor visto.
create table if not exists public.solidcon_insumos (
  id_produto integer primary key check (id_produto > 0),
  nome text not null check (length(btrim(nome)) between 1 and 1000),
  categoria text check (length(categoria) between 1 and 200),
  unidade text check (length(unidade) between 1 and 100),
  estoque numeric not null check (estoque <> 'NaN'::numeric and abs(estoque) < 1e15),
  presente boolean not null,
  dtalteracao_erp timestamptz,
  atualizado_em timestamptz not null
);

-- Foto diaria (dia de America/Sao_Paulo da coleta): ultima coleta aceita do dia, so presentes.
create table if not exists public.solidcon_insumos_diario (
  dia date not null,
  id_produto integer not null check (id_produto > 0),
  estoque numeric not null check (estoque <> 'NaN'::numeric and abs(estoque) < 1e15),
  primary key (dia,id_produto)
);

-- Somente metadados tecnicos.
create table if not exists public.solidcon_insumos_sync (
  id bigint generated always as identity primary key,
  status text not null check (status in ('ok','erro')),
  linhas integer not null default 0,
  coletado_em timestamptz,
  execucao_id uuid,
  mensagem text,
  em timestamptz not null default now()
);
create index if not exists solidcon_insumos_sync_coleta_idx
  on public.solidcon_insumos_sync(coletado_em desc) where status='ok';
create unique index if not exists solidcon_insumos_sync_execucao_idx
  on public.solidcon_insumos_sync(execucao_id) where status='ok' and execucao_id is not null;

alter table public.solidcon_insumos enable row level security;
alter table public.solidcon_insumos_diario enable row level security;
alter table public.solidcon_insumos_sync enable row level security;
revoke all on public.solidcon_insumos,public.solidcon_insumos_diario,public.solidcon_insumos_sync
  from public,anon,authenticated;
revoke all on sequence public.solidcon_insumos_sync_id_seq from public,anon,authenticated;
grant select on public.solidcon_insumos,public.solidcon_insumos_diario,public.solidcon_insumos_sync to authenticated;
drop policy if exists solidcon_027_equipe_le on public.solidcon_insumos;
create policy solidcon_027_equipe_le on public.solidcon_insumos for select to authenticated using(public.eh_equipe());
drop policy if exists solidcon_027_equipe_le on public.solidcon_insumos_diario;
create policy solidcon_027_equipe_le on public.solidcon_insumos_diario for select to authenticated using(public.eh_equipe());
drop policy if exists solidcon_027_equipe_le on public.solidcon_insumos_sync;
create policy solidcon_027_equipe_le on public.solidcon_insumos_sync for select to authenticated using(public.eh_equipe());

create or replace function public.solidcon_receber_insumos(
  p_itens jsonb,p_coletado_em timestamptz,p_execucao_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_agora timestamptz;
  v_motivo text;
  v_item jsonb;
  v_linhas integer := 0;
  v_anteriores bigint;
  v_ultima timestamptz;
  v_dia date;
  v_log bigint;
  v_campos constant text[] := array['id_produto','nome','categoria','unidade','estoque','dtalteracao_erp'];
begin
  if auth.uid() is null or not exists(
    select 1 from public.integracoes_autorizadas where user_id=auth.uid()
  ) then
    raise exception 'integracao nao autorizada' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(5100,27);
  v_agora := clock_timestamp();
  -- Subtransacao: erro inesperado depois do upsert preserva espelho e foto.
  begin
    if p_execucao_id is null then
      v_motivo := 'execucao_invalida';
    elsif p_coletado_em is null or not isfinite(p_coletado_em)
       or p_coletado_em < v_agora-interval '24 hours'
       or p_coletado_em > v_agora+interval '5 minutes' then
      v_motivo := 'coleta_fora_da_janela';
    elsif p_itens is null or jsonb_typeof(p_itens)<>'array' then
      v_motivo := 'payload_invalido';
    else
      v_linhas := jsonb_array_length(p_itens);
      if v_linhas=0 then
        v_motivo := 'snapshot_vazio';
      elsif v_linhas>10000 or octet_length(p_itens::text)>8388608 then
        v_motivo := 'payload_fora_do_limite';
      else
        for v_item in select value from jsonb_array_elements(p_itens) loop
          if jsonb_typeof(v_item)<>'object' then
            v_motivo := 'item_invalido'; exit;
          end if;
          -- Whitelist EXATA.
          if not(v_item ?& v_campos) or (v_item-v_campos)<>'{}'::jsonb then
            v_motivo := 'campos_invalidos'; exit;
          end if;
          if jsonb_typeof(v_item->'id_produto')<>'number'
             or (v_item->>'id_produto')!~'^[1-9][0-9]{0,9}$'
             or (v_item->>'id_produto')::bigint>2147483647 then
            v_motivo := 'id_invalido'; exit;
          end if;
          if jsonb_typeof(v_item->'nome')<>'string'
             or length(btrim(v_item->>'nome')) not between 1 and 1000
             or (v_item->>'nome') ~ '[[:cntrl:]]' then
            v_motivo := 'nome_invalido'; exit;
          end if;
          if (jsonb_typeof(v_item->'categoria')<>'null' and (
                jsonb_typeof(v_item->'categoria')<>'string'
                or length(v_item->>'categoria') not between 1 and 200
                or (v_item->>'categoria') ~ '[[:cntrl:]]'))
             or (jsonb_typeof(v_item->'unidade')<>'null' and (
                jsonb_typeof(v_item->'unidade')<>'string'
                or length(v_item->>'unidade') not between 1 and 100
                or (v_item->>'unidade') ~ '[[:cntrl:]]')) then
            v_motivo := 'metadados_invalidos'; exit;
          end if;
          -- Categorias vendaveis pertencem ao espelho de produtos (019), nunca a insumos.
          if (v_item->>'categoria') in ('TEMPERO - CAIXA 24 UN','TEMPERO - CAIXA 48 UN') then
            v_motivo := 'categoria_vendavel'; exit;
          end if;
          if jsonb_typeof(v_item->'estoque')<>'number'
             or abs((v_item->>'estoque')::numeric)>=1e15 then
            v_motivo := 'estoque_invalido'; exit;
          end if;
          if jsonb_typeof(v_item->'dtalteracao_erp')<>'null' and (
               jsonb_typeof(v_item->'dtalteracao_erp')<>'string'
               or (v_item->>'dtalteracao_erp') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$') then
            v_motivo := 'data_invalida'; exit;
          end if;
        end loop;
        if v_motivo is null and (select count(distinct (value->>'id_produto')::bigint)
                                   from jsonb_array_elements(p_itens))<>v_linhas then
          v_motivo := 'id_duplicado';
        end if;
        if v_motivo is null and exists(
          select 1 from public.solidcon_produtos p
            join jsonb_array_elements(p_itens) as t(i) on (i->>'id_produto')::bigint=p.id_produto
           where p.presente
        ) then
          -- Mesmo id ativo no espelho vendavel do ciclo: nunca nas duas tabelas.
          v_motivo := 'produto_vendavel';
        end if;
      end if;
    end if;
    if v_motivo is null then
      select max(coletado_em) into v_ultima from public.solidcon_insumos_sync where status='ok';
      select count(*) into v_anteriores from public.solidcon_insumos where presente;
      if v_ultima is not null and p_coletado_em<=v_ultima then
        v_motivo := 'snapshot_antigo';
      elsif exists(select 1 from public.solidcon_insumos_sync where status='ok' and execucao_id=p_execucao_id) then
        v_motivo := 'execucao_repetida';
      elsif v_linhas::bigint*2<v_anteriores then
        v_motivo := 'queda_superior_50_porcento';
      end if;
    end if;
    if v_motivo is null then
      v_dia := (p_coletado_em at time zone 'America/Sao_Paulo')::date;
      insert into public.solidcon_insumos as d(
        id_produto,nome,categoria,unidade,estoque,presente,dtalteracao_erp,atualizado_em
      )
      select (i->>'id_produto')::integer,i->>'nome',i->>'categoria',i->>'unidade',
        (i->>'estoque')::numeric,true,(i->>'dtalteracao_erp')::timestamptz,p_coletado_em
      from jsonb_array_elements(p_itens) as t(i)
      on conflict (id_produto) do update set
        nome=excluded.nome,categoria=excluded.categoria,unidade=excluded.unidade,
        estoque=excluded.estoque,presente=true,dtalteracao_erp=excluded.dtalteracao_erp,
        atualizado_em=excluded.atualizado_em;
      -- Ausente do snapshot = fora do conjunto ativo. WHERE obrigatorio (safeupdate).
      update public.solidcon_insumos as s
         set presente=false,atualizado_em=p_coletado_em
       where s.presente and not exists(
         select 1 from jsonb_array_elements(p_itens) as t(i)
          where (i->>'id_produto')::integer=s.id_produto
       );
      -- Foto do dia = ultima coleta aceita do dia, somente presentes.
      delete from public.solidcon_insumos_diario as f
       where f.dia=v_dia and not exists(
         select 1 from jsonb_array_elements(p_itens) as t(i)
          where (i->>'id_produto')::integer=f.id_produto
       );
      insert into public.solidcon_insumos_diario(dia,id_produto,estoque)
      select v_dia,(i->>'id_produto')::integer,(i->>'estoque')::numeric
        from jsonb_array_elements(p_itens) as t(i)
      on conflict (dia,id_produto) do update set estoque=excluded.estoque;
      -- Mantem hoje e os 400 dias anteriores; 400 exatos ficam, 401 saem.
      delete from public.solidcon_insumos_diario
       where dia < (v_agora at time zone 'America/Sao_Paulo')::date - 400;
      insert into public.solidcon_insumos_sync(status,linhas,coletado_em,execucao_id,em)
        values('ok',v_linhas,p_coletado_em,p_execucao_id,v_agora) returning id into v_log;
      return jsonb_build_object('id',v_log,'status','ok','linhas',v_linhas,'dia',v_dia,
        'coletado_em',p_coletado_em,'execucao_id',p_execucao_id);
    end if;
  exception when others then
    -- Nunca SQLERRM/DETAIL.
    v_motivo := 'falha_interna';
  end;
  insert into public.solidcon_insumos_sync(status,linhas,coletado_em,execucao_id,mensagem,em)
    values('erro',v_linhas,p_coletado_em,p_execucao_id,v_motivo,v_agora) returning id into v_log;
  return jsonb_build_object('id',v_log,'status','erro','motivo',v_motivo,'execucao_id',p_execucao_id);
end;
$$;
revoke all on function public.solidcon_receber_insumos(jsonb,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.solidcon_receber_insumos(jsonb,timestamptz,uuid) to authenticated;

-- ===================== (B) ENDERECO DE CLIENTES CNPJ =====================
-- Limites do vmEndereco do ERP: logradouro<=100, numero<=30, complemento<=60, cep 8 digitos.
-- CPF (pessoa fisica): SEMPRE null (minimizacao LGPD).
alter table public.solidcon_clientes add column if not exists logradouro text;
alter table public.solidcon_clientes add column if not exists numero text;
alter table public.solidcon_clientes add column if not exists complemento text;
alter table public.solidcon_clientes add column if not exists cep text;
alter table public.solidcon_clientes drop constraint if exists solidcon_clientes_027_logradouro;
alter table public.solidcon_clientes add constraint solidcon_clientes_027_logradouro
  check (length(logradouro) between 1 and 100);
alter table public.solidcon_clientes drop constraint if exists solidcon_clientes_027_numero;
alter table public.solidcon_clientes add constraint solidcon_clientes_027_numero
  check (length(numero) between 1 and 30);
alter table public.solidcon_clientes drop constraint if exists solidcon_clientes_027_complemento;
alter table public.solidcon_clientes add constraint solidcon_clientes_027_complemento
  check (length(complemento) between 1 and 60);
alter table public.solidcon_clientes drop constraint if exists solidcon_clientes_027_cep;
alter table public.solidcon_clientes add constraint solidcon_clientes_027_cep
  check (cep ~ '^[0-9]{8}$');
alter table public.solidcon_clientes drop constraint if exists solidcon_clientes_027_endereco_cpf;
alter table public.solidcon_clientes add constraint solidcon_clientes_027_endereco_cpf
  check (tipo='cnpj' or (logradouro is null and numero is null and complemento is null and cep is null));

-- Mesma assinatura/retorno da 023. Payload antigo (9 campos) continua aceito ate a troca do coletor:
-- nesse caso o endereco fica null. Payload novo exige os 13 campos.
create or replace function public.solidcon_receber_clientes(
  p_itens jsonb,p_coletado_em timestamptz,p_execucao_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_agora timestamptz;
  v_motivo text;
  v_item jsonb;
  v_campo text;
  v_limite integer;
  v_linhas integer := 0;
  v_anteriores bigint;
  v_ultima timestamptz;
  v_log bigint;
  v_campos constant text[] := array['documento','tipo','nome','telefone','celular','email','cidade','bairro','estado'];
  v_campos_end constant text[] := array['logradouro','numero','complemento','cep'];
  v_novo boolean;
begin
  if auth.uid() is null or not exists(
    select 1 from public.integracoes_autorizadas where user_id=auth.uid()
  ) then
    raise exception 'integracao nao autorizada' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(5100,23);
  v_agora := clock_timestamp();
  -- Subtransacao: erro inesperado apos DELETE tambem preserva todo o espelho.
  begin
    if p_execucao_id is null then
      v_motivo := 'execucao_invalida';
    elsif p_coletado_em is null or not isfinite(p_coletado_em)
       or p_coletado_em < v_agora-interval '24 hours'
       or p_coletado_em > v_agora+interval '5 minutes' then
      v_motivo := 'coleta_fora_da_janela';
    elsif p_itens is null or jsonb_typeof(p_itens)<>'array' then
      v_motivo := 'payload_invalido';
    else
      v_linhas := jsonb_array_length(p_itens);
      if v_linhas=0 then
        v_motivo := 'snapshot_vazio';
      elsif v_linhas>10000 or octet_length(p_itens::text)>16777216 then
        v_motivo := 'payload_fora_do_limite';
      else
        for v_item in select value from jsonb_array_elements(p_itens) loop
          if jsonb_typeof(v_item)<>'object' then
            v_motivo := 'item_invalido'; exit;
          end if;
          -- Whitelist EXATA: 9 campos (coletor antigo) ou 13 campos (com endereco).
          v_novo := v_item ?| v_campos_end;
          if not(v_item ?& v_campos) or (v_novo and not(v_item ?& v_campos_end))
             or (v_item-v_campos-v_campos_end)<>'{}'::jsonb then
            v_motivo := 'campos_invalidos'; exit;
          end if;
          if jsonb_typeof(v_item->'documento')<>'string'
             or jsonb_typeof(v_item->'tipo')<>'string'
             or (v_item->>'tipo') not in ('cpf','cnpj')
             or ((v_item->>'tipo')='cpf' and (v_item->>'documento')!~'^[0-9]{11}$')
             or ((v_item->>'tipo')='cnpj' and (v_item->>'documento')!~'^[0-9]{14}$') then
            v_motivo := 'documento_invalido'; exit;
          end if;
          if jsonb_typeof(v_item->'nome')<>'string'
             or length(btrim(v_item->>'nome')) not between 1 and 150 then
            v_motivo := 'nome_invalido'; exit;
          end if;
          foreach v_campo in array array['nome','telefone','celular','email','cidade','bairro','estado',
                                         'logradouro','numero','complemento','cep'] loop
            v_limite := case v_campo when 'nome' then 150 when 'telefone' then 32
              when 'celular' then 32 when 'email' then 254 when 'estado' then 2
              when 'logradouro' then 100 when 'numero' then 30 when 'complemento' then 60
              when 'cep' then 8 else 100 end;
            -- Campo ausente (payload antigo) = null.
            if coalesce(jsonb_typeof(v_item->v_campo),'null')<>'null' and (
              jsonb_typeof(v_item->v_campo)<>'string'
              or length(v_item->>v_campo) not between 1 and v_limite
              or btrim(v_item->>v_campo)=''
              or (v_item->>v_campo) ~ '[[:cntrl:]]'
            ) then v_motivo := 'metadados_invalidos'; exit; end if;
          end loop;
          exit when v_motivo is not null;
          if jsonb_typeof(v_item->'estado')<>'null' and (v_item->>'estado')!~'^[A-Z]{2}$' then
            v_motivo := 'estado_invalido'; exit;
          end if;
          if coalesce(jsonb_typeof(v_item->'cep'),'null')<>'null' and (v_item->>'cep')!~'^[0-9]{8}$' then
            v_motivo := 'cep_invalido'; exit;
          end if;
          -- Pessoa fisica nunca tem endereco gravado: lote com endereco de CPF e rejeitado.
          if (v_item->>'tipo')='cpf' and (
               coalesce(jsonb_typeof(v_item->'logradouro'),'null')<>'null'
               or coalesce(jsonb_typeof(v_item->'numero'),'null')<>'null'
               or coalesce(jsonb_typeof(v_item->'complemento'),'null')<>'null'
               or coalesce(jsonb_typeof(v_item->'cep'),'null')<>'null') then
            v_motivo := 'endereco_cpf'; exit;
          end if;
        end loop;
        if v_motivo is null and (select count(distinct value->>'documento') from jsonb_array_elements(p_itens))<>v_linhas then
          v_motivo := 'documento_duplicado';
        end if;
      end if;
    end if;
    if v_motivo is null then
      select max(coletado_em) into v_ultima from public.solidcon_clientes_sync where status='ok';
      select count(*) into v_anteriores from public.solidcon_clientes;
      if v_ultima is not null and p_coletado_em<=v_ultima then
        v_motivo := 'snapshot_antigo';
      elsif exists(select 1 from public.solidcon_clientes_sync where status='ok' and execucao_id=p_execucao_id) then
        v_motivo := 'execucao_repetida';
      elsif v_linhas*2<v_anteriores then
        v_motivo := 'queda_superior_50_porcento';
      end if;
    end if;
    if v_motivo is null then
      -- WHERE obrigatorio: safeupdate (PostgREST) bloqueia DELETE sem WHERE.
      delete from public.solidcon_clientes where documento is not null;
      insert into public.solidcon_clientes(documento,tipo,nome,telefone,celular,email,cidade,bairro,estado,
        logradouro,numero,complemento,cep,coletado_em)
      select i->>'documento',i->>'tipo',i->>'nome',i->>'telefone',i->>'celular',i->>'email',
        i->>'cidade',i->>'bairro',i->>'estado',
        case when i->>'tipo'='cnpj' then i->>'logradouro' end,
        case when i->>'tipo'='cnpj' then i->>'numero' end,
        case when i->>'tipo'='cnpj' then i->>'complemento' end,
        case when i->>'tipo'='cnpj' then i->>'cep' end,
        p_coletado_em
      from jsonb_array_elements(p_itens) as t(i);
      insert into public.solidcon_clientes_sync(status,linhas,coletado_em,execucao_id,em)
        values('ok',v_linhas,p_coletado_em,p_execucao_id,v_agora) returning id into v_log;
      return jsonb_build_object('id',v_log,'status','ok','linhas',v_linhas,
        'coletado_em',p_coletado_em,'execucao_id',p_execucao_id);
    end if;
  exception when others then
    -- Nunca SQLERRM/DETAIL: poderiam conter documento/nome/endereco recebido.
    v_motivo := 'falha_interna';
  end;
  insert into public.solidcon_clientes_sync(status,linhas,coletado_em,execucao_id,mensagem,em)
    values('erro',v_linhas,p_coletado_em,p_execucao_id,v_motivo,v_agora) returning id into v_log;
  return jsonb_build_object('id',v_log,'status','erro','motivo',v_motivo,'execucao_id',p_execucao_id);
end;
$$;
revoke all on function public.solidcon_receber_clientes(jsonb,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.solidcon_receber_clientes(jsonb,timestamptz,uuid) to authenticated;

-- ===================== (C) FORMAS DE PAGAMENTO =====================
-- Total por modalidade por dia (filial 4). NAO guarda sangria/fundo de caixa.
create table if not exists public.solidcon_vendas_modalidade (
  dia date not null,
  id_modalidade integer not null check (id_modalidade >= 0),
  nome text check (length(nome) between 1 and 100),
  valor_centavos bigint not null check (valor_centavos >= 0),
  qtde_pagamentos integer not null check (qtde_pagamentos >= 0),
  coletado_em timestamptz not null,
  primary key (dia,id_modalidade)
);

create table if not exists public.solidcon_vendas_modalidade_sync (
  id bigint generated always as identity primary key,
  dia date,
  status text not null check (status in ('ok','erro')),
  linhas integer not null default 0,
  valor_total_centavos bigint not null default 0,
  coletado_em timestamptz,
  execucao_id uuid,
  mensagem text,
  em timestamptz not null default now()
);
create index if not exists solidcon_vendas_modalidade_sync_dia_idx
  on public.solidcon_vendas_modalidade_sync(dia,coletado_em desc) where status='ok';
create unique index if not exists solidcon_vendas_modalidade_sync_execucao_idx
  on public.solidcon_vendas_modalidade_sync(execucao_id) where status='ok' and execucao_id is not null;

alter table public.solidcon_vendas_modalidade enable row level security;
alter table public.solidcon_vendas_modalidade_sync enable row level security;
revoke all on public.solidcon_vendas_modalidade,public.solidcon_vendas_modalidade_sync from public,anon,authenticated;
revoke all on sequence public.solidcon_vendas_modalidade_sync_id_seq from public,anon,authenticated;
grant select on public.solidcon_vendas_modalidade,public.solidcon_vendas_modalidade_sync to authenticated;
drop policy if exists solidcon_027_equipe_le on public.solidcon_vendas_modalidade;
create policy solidcon_027_equipe_le on public.solidcon_vendas_modalidade for select to authenticated using(public.eh_equipe());
drop policy if exists solidcon_027_equipe_le on public.solidcon_vendas_modalidade_sync;
create policy solidcon_027_equipe_le on public.solidcon_vendas_modalidade_sync for select to authenticated using(public.eh_equipe());

create or replace function public.solidcon_receber_vendas_modalidade(
  p_dia date,p_itens jsonb,p_coletado_em timestamptz,p_execucao_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_agora timestamptz;
  v_hoje date;
  v_motivo text;
  v_item jsonb;
  v_linhas integer := 0;
  v_total numeric := 0;
  v_log bigint;
  v_campos constant text[] := array['id_modalidade','nome','valor_centavos','qtde_pagamentos'];
begin
  if auth.uid() is null or not exists(
    select 1 from public.integracoes_autorizadas where user_id=auth.uid()
  ) then
    raise exception 'integracao nao autorizada' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(5100,28);
  v_agora := clock_timestamp();
  v_hoje := (v_agora at time zone 'America/Sao_Paulo')::date;
  begin
    if p_dia is null or p_dia < v_hoje-400 or p_dia > v_hoje then
      v_motivo := 'dia_fora_da_janela';
    elsif p_execucao_id is null then
      v_motivo := 'execucao_invalida';
    elsif p_coletado_em is null or not isfinite(p_coletado_em)
       or p_coletado_em < v_agora-interval '24 hours'
       or p_coletado_em > v_agora+interval '5 minutes' then
      v_motivo := 'coleta_fora_da_janela';
    elsif p_itens is null or jsonb_typeof(p_itens)<>'array' then
      v_motivo := 'payload_invalido';
    else
      -- Dia sem venda = array vazio: substitui o dia por 0 linhas.
      v_linhas := jsonb_array_length(p_itens);
      if v_linhas>200 or octet_length(p_itens::text)>262144 then
        v_motivo := 'payload_fora_do_limite';
      else
        for v_item in select value from jsonb_array_elements(p_itens) loop
          if jsonb_typeof(v_item)<>'object' or not(v_item ?& v_campos) or (v_item-v_campos)<>'{}'::jsonb then
            v_motivo := 'campos_invalidos'; exit;
          end if;
          if jsonb_typeof(v_item->'id_modalidade')<>'number'
             or (v_item->>'id_modalidade')!~'^[0-9]{1,10}$'
             or (v_item->>'id_modalidade')::bigint>2147483647
             or jsonb_typeof(v_item->'valor_centavos')<>'number'
             or (v_item->>'valor_centavos')!~'^[0-9]{1,18}$'
             or jsonb_typeof(v_item->'qtde_pagamentos')<>'number'
             or (v_item->>'qtde_pagamentos')!~'^[0-9]{1,10}$'
             or (v_item->>'qtde_pagamentos')::bigint>2147483647 then
            v_motivo := 'item_invalido'; exit;
          end if;
          if jsonb_typeof(v_item->'nome')<>'null' and (
               jsonb_typeof(v_item->'nome')<>'string'
               or length(v_item->>'nome') not between 1 and 100
               or btrim(v_item->>'nome')=''
               or (v_item->>'nome') ~ '[[:cntrl:]]') then
            v_motivo := 'nome_invalido'; exit;
          end if;
          v_total := v_total+(v_item->>'valor_centavos')::numeric;
        end loop;
        if v_motivo is null and v_total>9223372036854775807 then
          v_motivo := 'total_fora_do_limite';
        end if;
        if v_motivo is null and (select count(distinct (value->>'id_modalidade')::bigint)
                                   from jsonb_array_elements(p_itens))<>v_linhas then
          v_motivo := 'modalidade_duplicada';
        end if;
      end if;
    end if;
    if v_motivo is null then
      if exists(select 1 from public.solidcon_vendas_modalidade_sync
                 where status='ok' and dia=p_dia and coletado_em>=p_coletado_em) then
        v_motivo := 'snapshot_antigo';
      elsif exists(select 1 from public.solidcon_vendas_modalidade_sync
                    where status='ok' and execucao_id=p_execucao_id) then
        v_motivo := 'execucao_repetida';
      end if;
    end if;
    if v_motivo is null then
      -- Substitui o dia inteiro. WHERE obrigatorio (safeupdate).
      delete from public.solidcon_vendas_modalidade where dia=p_dia;
      insert into public.solidcon_vendas_modalidade(dia,id_modalidade,nome,valor_centavos,qtde_pagamentos,coletado_em)
      select p_dia,(i->>'id_modalidade')::integer,i->>'nome',(i->>'valor_centavos')::bigint,
        (i->>'qtde_pagamentos')::integer,p_coletado_em
      from jsonb_array_elements(p_itens) as t(i);
      insert into public.solidcon_vendas_modalidade_sync(dia,status,linhas,valor_total_centavos,coletado_em,execucao_id,em)
        values(p_dia,'ok',v_linhas,v_total::bigint,p_coletado_em,p_execucao_id,v_agora) returning id into v_log;
      return jsonb_build_object('id',v_log,'status','ok','dia',p_dia,'linhas',v_linhas,
        'valor_total_centavos',v_total::bigint,'coletado_em',p_coletado_em,'execucao_id',p_execucao_id);
    end if;
  exception when others then
    v_motivo := 'falha_interna';
  end;
  insert into public.solidcon_vendas_modalidade_sync(dia,status,linhas,coletado_em,execucao_id,mensagem,em)
    values(p_dia,'erro',v_linhas,p_coletado_em,p_execucao_id,v_motivo,v_agora) returning id into v_log;
  return jsonb_build_object('id',v_log,'status','erro','motivo',v_motivo,'dia',p_dia,'execucao_id',p_execucao_id);
end;
$$;
revoke all on function public.solidcon_receber_vendas_modalidade(date,jsonb,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.solidcon_receber_vendas_modalidade(date,jsonb,timestamptz,uuid) to authenticated;
commit;
