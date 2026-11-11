-- 023: espelho minimizado de clientes SOLIDCON. APLICADA em 2026-11-11 (RPC corrigida no mesmo dia: DELETE com WHERE por causa do safeupdate).
-- Instalacao manual futura; nenhum acesso ao ERP e nenhuma alteracao no site.
begin;

do $$
begin
  if to_regclass('public.solidcon_produtos') is null
     or to_regclass('public.solidcon_sync') is null
     or to_regclass('public.integracoes_autorizadas') is null
     or to_regclass('public.solidcon_estoque_diario') is null
     or to_regclass('public.solidcon_eventos') is null
     or to_regclass('public.solidcon_config') is null
     or to_regprocedure('public.solidcon_receber_produtos(jsonb,timestamptz,uuid)') is null
     or to_regprocedure('public.solidcon_definir_limite(integer)') is null
     or to_regprocedure('public.eh_equipe()') is null
     or to_regprocedure('public.eh_admin()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception '023 requer 019/020 completas (012/017 de A) e helpers eh_equipe()/eh_admin() de producao. Nada foi aplicado.';
  end if;
end;
$$;

-- Independente dos locks de estoque (5100,4) e vendas (5100,18).
select pg_catalog.pg_advisory_xact_lock(5100,23);

create table if not exists public.solidcon_clientes (
  documento text primary key,
  tipo text not null check (tipo in ('cpf','cnpj')),
  nome text not null check (length(btrim(nome)) between 1 and 150),
  telefone text check (length(telefone) between 1 and 32),
  celular text check (length(celular) between 1 and 32),
  email text check (length(email) between 1 and 254),
  cidade text check (length(cidade) between 1 and 100),
  bairro text check (length(bairro) between 1 and 100),
  estado text check (estado ~ '^[A-Z]{2}$'),
  coletado_em timestamptz not null check (isfinite(coletado_em)),
  constraint solidcon_clientes_documento_tipo check (
    (tipo='cpf' and documento ~ '^[0-9]{11}$')
    or (tipo='cnpj' and documento ~ '^[0-9]{14}$')
  )
);

-- Somente metadados tecnicos. Nunca gravar dados pessoais/mensagem do ERP.
create table if not exists public.solidcon_clientes_sync (
  id bigint generated always as identity primary key,
  status text not null check (status in ('ok','erro')),
  linhas integer not null default 0,
  coletado_em timestamptz,
  execucao_id uuid,
  mensagem text,
  em timestamptz not null default now()
);
create index if not exists solidcon_clientes_sync_coleta_idx
  on public.solidcon_clientes_sync(coletado_em desc) where status='ok';
create unique index if not exists solidcon_clientes_sync_execucao_idx
  on public.solidcon_clientes_sync(execucao_id) where status='ok' and execucao_id is not null;

alter table public.solidcon_clientes enable row level security;
alter table public.solidcon_clientes_sync enable row level security;
revoke all on public.solidcon_clientes,public.solidcon_clientes_sync from public,anon,authenticated;
revoke all on sequence public.solidcon_clientes_sync_id_seq from public,anon,authenticated;
grant select on public.solidcon_clientes,public.solidcon_clientes_sync to authenticated;
drop policy if exists solidcon_023_equipe_le on public.solidcon_clientes;
create policy solidcon_023_equipe_le on public.solidcon_clientes for select to authenticated using(public.eh_equipe());
drop policy if exists solidcon_023_equipe_le on public.solidcon_clientes_sync;
create policy solidcon_023_equipe_le on public.solidcon_clientes_sync for select to authenticated using(public.eh_equipe());

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
          -- Whitelist EXATA: campos extras (inclusive dados pessoais) rejeitam o lote.
          if not(v_item ?& v_campos) or (v_item-v_campos)<>'{}'::jsonb then
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
          foreach v_campo in array array['nome','telefone','celular','email','cidade','bairro','estado'] loop
            v_limite := case v_campo when 'nome' then 150 when 'telefone' then 32
              when 'celular' then 32 when 'email' then 254 when 'estado' then 2 else 100 end;
            if jsonb_typeof(v_item->v_campo)<>'null' and (
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
      insert into public.solidcon_clientes(documento,tipo,nome,telefone,celular,email,cidade,bairro,estado,coletado_em)
      select i->>'documento',i->>'tipo',i->>'nome',i->>'telefone',i->>'celular',i->>'email',
        i->>'cidade',i->>'bairro',i->>'estado',p_coletado_em
      from jsonb_array_elements(p_itens) as t(i);
      insert into public.solidcon_clientes_sync(status,linhas,coletado_em,execucao_id,em)
        values('ok',v_linhas,p_coletado_em,p_execucao_id,v_agora) returning id into v_log;
      return jsonb_build_object('id',v_log,'status','ok','linhas',v_linhas,
        'coletado_em',p_coletado_em,'execucao_id',p_execucao_id);
    end if;
  exception when others then
    -- Nunca SQLERRM/DETAIL: poderiam conter documento/nome/valor recebido.
    v_motivo := 'falha_interna';
  end;
  -- Sem RAISE nas rejeicoes de snapshots autorizados: persiste o log de erro.
  insert into public.solidcon_clientes_sync(status,linhas,coletado_em,execucao_id,mensagem,em)
    values('erro',v_linhas,p_coletado_em,p_execucao_id,v_motivo,v_agora) returning id into v_log;
  return jsonb_build_object('id',v_log,'status','erro','motivo',v_motivo,'execucao_id',p_execucao_id);
end;
$$;
revoke all on function public.solidcon_receber_clientes(jsonb,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.solidcon_receber_clientes(jsonb,timestamptz,uuid) to authenticated;
commit;
