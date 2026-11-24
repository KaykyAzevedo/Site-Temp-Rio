-- 058: nome/endereco CPF por pedido via HMAC local; fonte180dias, arquivo057 independente.
-- Requer023/027/039/057. Flags pessoas_pedido desligadas ate instalar; nao escreve no ERP.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
select pg_catalog.pg_advisory_xact_lock(5100,58);
select pg_catalog.pg_advisory_xact_lock(5100,23);
select pg_catalog.pg_advisory_xact_lock(5100,35);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
do $$begin
 if to_regprocedure('public.rota_057_guardar(bigint[])') is null or to_regprocedure('public.solidcon_receber_clientes(jsonb,timestamptz,uuid)') is null then
  raise exception '058 requer023/027/039/057; nada aplicado';
 end if;
end$$;
lock table public.solidcon_clientes in share row exclusive mode nowait;
lock table public.solidcon_pedidos_erp in share row exclusive mode nowait;
alter table public.solidcon_clientes add column if not exists pessoa_chave text;
alter table public.solidcon_clientes drop constraint if exists solidcon_clientes_027_endereco_cpf;
alter table public.solidcon_clientes drop constraint if exists solidcon_clientes_058_chave;
alter table public.solidcon_clientes add constraint solidcon_clientes_058_chave check(pessoa_chave is null or(tipo='cpf' and pessoa_chave ~ '^[0-9a-f]{64}$'));
create unique index if not exists solidcon_clientes_058_chave_idx on public.solidcon_clientes(pessoa_chave) where pessoa_chave is not null;
alter table public.solidcon_pedidos_erp
 add column if not exists pessoa_chave text,add column if not exists entrega_logradouro text,add column if not exists entrega_numero text,
 add column if not exists entrega_complemento text,add column if not exists entrega_bairro text,add column if not exists entrega_cidade text,
 add column if not exists entrega_uf text,add column if not exists entrega_cep text,add column if not exists entrega_origem text;
alter table public.solidcon_pedidos_erp drop constraint if exists solidcon_pedidos_erp_035_cliente;
alter table public.solidcon_pedidos_erp add constraint solidcon_pedidos_erp_035_cliente check(
 (cliente_tipo='cnpj' and documento is not null and documento ~ '^[0-9]{14}$' and pessoa_chave is null)
 or(cliente_tipo='cpf' and documento is null and(pessoa_chave is null or pessoa_chave ~ '^[0-9a-f]{64}$'))
 or(cliente_tipo='indefinido' and documento is null and cliente_nome is null and pessoa_chave is null));
alter table public.solidcon_pedidos_erp drop constraint if exists solidcon_pedidos_erp_058_endereco;
alter table public.solidcon_pedidos_erp add constraint solidcon_pedidos_erp_058_endereco check(
 (entrega_logradouro is null or char_length(btrim(entrega_logradouro)) between 1 and 100)
 and(entrega_numero is null or char_length(btrim(entrega_numero)) between 1 and 30)
 and(entrega_complemento is null or char_length(btrim(entrega_complemento)) between 1 and 60)
 and(entrega_bairro is null or char_length(btrim(entrega_bairro)) between 1 and 100)
 and(entrega_cidade is null or char_length(btrim(entrega_cidade)) between 1 and 100)
 and(entrega_uf is null or entrega_uf ~ '^[A-Z]{2}$') and(entrega_cep is null or entrega_cep ~ '^[0-9]{8}$')
 and(entrega_origem is null or entrega_origem='cadastro')
 and(cliente_tipo='cpf' or coalesce(entrega_logradouro,entrega_numero,entrega_complemento,entrega_bairro,entrega_cidade,entrega_uf,entrega_cep,entrega_origem) is null));
create index if not exists solidcon_pedidos_erp_058_chave_idx on public.solidcon_pedidos_erp(pessoa_chave) where pessoa_chave is not null;
-- Sem CPF/documento/nome/endereco: memoria tecnica para nao renovar180dias em cada fullreplace.
create table if not exists public.solidcon_pessoa_retencao(
 chave text primary key check(chave ~ '^[0-9a-f]{64}$'),
 primeira_em timestamptz not null default now() check(isfinite(primeira_em)),
 ultimo_faturado_em timestamptz check(ultimo_faturado_em is null or isfinite(ultimo_faturado_em)));
alter table public.solidcon_pessoa_retencao enable row level security;
revoke all on public.solidcon_pessoa_retencao from public,anon,authenticated,service_role;

create or replace function public.solidcon_058_vencido(p_em timestamptz)
returns boolean language sql stable set search_path='' as $$
 select p_em is not null and((p_em at time zone 'America/Sao_Paulo')+interval '180 days') at time zone 'America/Sao_Paulo'<now()
$$;
create or replace function public.solidcon_058_cliente_vencido(p_chave text)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select public.solidcon_058_vencido(coalesce(r.ultimo_faturado_em,r.primeira_em))
  and not exists(select 1 from public.solidcon_pedidos_erp p where p.cliente_tipo='cpf' and p.pessoa_chave=p_chave
   and coalesce(p.dt_saida,p.dt_nota,p.dt_atendido) is null)
 from public.solidcon_pessoa_retencao r where r.chave=p_chave),false)
$$;
create or replace function public.solidcon_058_cliente_travar()
returns trigger language plpgsql security definer set search_path='' as $$begin
 perform pg_catalog.pg_advisory_xact_lock(5100,35);perform pg_catalog.pg_advisory_xact_lock(5100,5201);perform pg_catalog.pg_advisory_xact_lock(5100,5001);return null;
end$$;
create or replace function public.solidcon_058_cliente_antes()
returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.tipo<>'cpf' then return new;end if;
 if new.pessoa_chave is null then
  -- Antes da ativacao, payload023/027 continua igual. Depois nao ressuscitar CPF sem chave.
  if exists(select 1 from public.solidcon_pessoa_retencao) then return null;end if;
  return new;
 end if;
 if new.pessoa_chave !~ '^[0-9a-f]{64}$' then raise exception 'chave invalida' using errcode='22023';end if;
 insert into public.solidcon_pessoa_retencao(chave) values(new.pessoa_chave) on conflict do nothing;
 if public.solidcon_058_cliente_vencido(new.pessoa_chave) then return null;end if;
 return new;
end$$;
create or replace function public.solidcon_058_pedido_antes()
returns trigger language plpgsql security definer set search_path='' as $$declare c public.solidcon_clientes;v_fat timestamptz;begin
 if new.cliente_tipo<>'cpf' then return new;end if;
 v_fat:=coalesce(new.dt_saida,new.dt_nota,new.dt_atendido);
 if new.pessoa_chave is not null then
  if new.pessoa_chave !~ '^[0-9a-f]{64}$' then raise exception 'chave invalida' using errcode='22023';end if;
  insert into public.solidcon_pessoa_retencao as r(chave,ultimo_faturado_em) values(new.pessoa_chave,v_fat)
   on conflict(chave) do update set ultimo_faturado_em=greatest(r.ultimo_faturado_em,excluded.ultimo_faturado_em)
   where r.ultimo_faturado_em is distinct from greatest(r.ultimo_faturado_em,excluded.ultimo_faturado_em);
 end if;
 if not public.solidcon_058_vencido(v_fat) and new.pessoa_chave is not null then
  select * into c from public.solidcon_clientes where tipo='cpf' and pessoa_chave=new.pessoa_chave;
 end if;
 -- Somente valores do cadastro confirmado: nao aceita nome/endereco no payload de pedidos.
 new.documento:=null;new.cliente_nome:=c.nome;new.entrega_logradouro:=c.logradouro;new.entrega_numero:=c.numero;
 new.entrega_complemento:=c.complemento;new.entrega_bairro:=c.bairro;new.entrega_cidade:=c.cidade;new.entrega_uf:=c.estado;new.entrega_cep:=c.cep;
 new.entrega_origem:=case when c.nome is not null then 'cadastro' end;
 if public.solidcon_058_vencido(v_fat) then new.pessoa_chave:=null;end if;
 return new;
end$$;
create or replace function public.solidcon_058_cliente_depois()
returns trigger language plpgsql security definer set search_path='' as $$begin
 update public.solidcon_pedidos_erp p set cliente_nome=c.nome,entrega_logradouro=c.logradouro,entrega_numero=c.numero,
  entrega_complemento=c.complemento,entrega_bairro=c.bairro,entrega_cidade=c.cidade,entrega_uf=c.estado,entrega_cep=c.cep
 from clientes058 c where p.cliente_tipo='cpf' and c.tipo='cpf' and p.pessoa_chave=c.pessoa_chave
  and not public.solidcon_058_vencido(coalesce(p.dt_saida,p.dt_nota,p.dt_atendido))
  and row(p.cliente_nome,p.entrega_logradouro,p.entrega_numero,p.entrega_complemento,p.entrega_bairro,p.entrega_cidade,p.entrega_uf,p.entrega_cep)
   is distinct from row(c.nome,c.logradouro,c.numero,c.complemento,c.bairro,c.cidade,c.estado,c.cep);
 return null;
end$$;
create or replace function public.solidcon_058_limpar()
returns jsonb language plpgsql security definer set search_path='' as $$declare v_p integer;v_c integer;begin
 if not pg_catalog.pg_try_advisory_xact_lock(5100,23) or not pg_catalog.pg_try_advisory_xact_lock(5100,35)
 or not pg_catalog.pg_try_advisory_xact_lock(5100,5201) or not pg_catalog.pg_try_advisory_xact_lock(5100,5001) then return jsonb_build_object('ocupado',true);end if;
 -- Snapshot057 observa os valores anteriores a anonimizar; copia tem seu proprio prazo1ano.
 perform public.rota_057_guardar(array(select p.cd_pedido from public.solidcon_pedidos_erp p
  where p.cliente_tipo='cpf' and public.solidcon_058_vencido(coalesce(p.dt_saida,p.dt_nota,p.dt_atendido))
  and exists(select 1 from public.pedido_canhoto c where c.cd_pedido=p.cd_pedido)));
 update public.solidcon_pedidos_erp set pessoa_chave=null,cliente_nome=null,entrega_logradouro=null,entrega_numero=null,
  entrega_complemento=null,entrega_bairro=null,entrega_cidade=null,entrega_uf=null,entrega_cep=null,entrega_origem=null
 where cliente_tipo='cpf' and public.solidcon_058_vencido(coalesce(dt_saida,dt_nota,dt_atendido))
  and coalesce(pessoa_chave,cliente_nome,entrega_logradouro,entrega_numero,entrega_complemento,entrega_bairro,entrega_cidade,entrega_uf,entrega_cep,entrega_origem) is not null;
 get diagnostics v_p=row_count;
 delete from public.solidcon_clientes where tipo='cpf' and pessoa_chave is not null and public.solidcon_058_cliente_vencido(pessoa_chave);
 get diagnostics v_c=row_count;
 return jsonb_build_object('pedidos',v_p,'cadastros',v_c);
end$$;
revoke all on function public.solidcon_058_vencido(timestamptz),public.solidcon_058_cliente_vencido(text),public.solidcon_058_cliente_travar(),public.solidcon_058_cliente_antes(),public.solidcon_058_pedido_antes(),public.solidcon_058_cliente_depois(),public.solidcon_058_limpar() from public,anon,authenticated,service_role;
drop trigger if exists solidcon_058_cliente_travar on public.solidcon_clientes;
create trigger solidcon_058_cliente_travar before insert or update or delete on public.solidcon_clientes for each statement execute function public.solidcon_058_cliente_travar();
drop trigger if exists solidcon_058_cliente_antes on public.solidcon_clientes;
create trigger solidcon_058_cliente_antes before insert or update on public.solidcon_clientes for each row execute function public.solidcon_058_cliente_antes();
drop trigger if exists solidcon_058_pedido_antes on public.solidcon_pedidos_erp;
create trigger solidcon_058_pedido_antes before insert or update on public.solidcon_pedidos_erp for each row execute function public.solidcon_058_pedido_antes();
drop trigger if exists solidcon_058_cliente_ins on public.solidcon_clientes;
create trigger solidcon_058_cliente_ins after insert on public.solidcon_clientes referencing new table as clientes058 for each statement execute function public.solidcon_058_cliente_depois();
drop trigger if exists solidcon_058_cliente_upd on public.solidcon_clientes;
create trigger solidcon_058_cliente_upd after update on public.solidcon_clientes referencing new table as clientes058 for each statement execute function public.solidcon_058_cliente_depois();

-- RECEPTORES058 (extensao opcional dos contratos027/039)
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
  v_chaves_antes jsonb;
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
          -- Whitelist027 preservada (9/13 campos), mais pessoa_chave opcional058.
          v_novo := v_item ?| v_campos_end;
          if not(v_item ?& v_campos) or (v_novo and not(v_item ?& v_campos_end))
             or (v_item-v_campos-v_campos_end-'pessoa_chave')<>'{}'::jsonb then
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
          if coalesce(jsonb_typeof(v_item->'pessoa_chave'),'null')<>'null' and
             (jsonb_typeof(v_item->'pessoa_chave')<>'string' or (v_item->>'pessoa_chave')!~'^[0-9a-f]{64}$' or v_item->>'tipo'<>'cpf') then
            v_motivo := 'chave_pessoa_invalida'; exit;
          end if;
          if v_item->>'tipo'='cpf' and coalesce(jsonb_typeof(v_item->'pessoa_chave'),'null')='null'
             and coalesce(v_item->>'logradouro',v_item->>'numero',v_item->>'complemento',v_item->>'cep') is not null then
            v_motivo := 'endereco_cpf_sem_chave'; exit;
          end if;
          if v_item->>'tipo'='cpf' and v_item->>'pessoa_chave' is not null and exists(
             select 1 from public.solidcon_clientes c where c.documento=v_item->>'documento'
              and c.pessoa_chave is not null and c.pessoa_chave<>v_item->>'pessoa_chave') then
            v_motivo := 'chave_pessoa_divergente'; exit;
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
      select coalesce(jsonb_object_agg(documento,pessoa_chave),'{}'::jsonb) into v_chaves_antes from public.solidcon_clientes where pessoa_chave is not null;
      delete from public.solidcon_clientes where documento is not null;
      insert into public.solidcon_clientes(documento,tipo,nome,telefone,celular,email,cidade,bairro,estado,
        logradouro,numero,complemento,cep,coletado_em,pessoa_chave)
      select i->>'documento',i->>'tipo',i->>'nome',i->>'telefone',i->>'celular',i->>'email',
        i->>'cidade',i->>'bairro',i->>'estado',
        i->>'logradouro',
        i->>'numero',
        i->>'complemento',
        i->>'cep',
        p_coletado_em,case when i->>'tipo'='cpf' then coalesce(i->>'pessoa_chave',v_chaves_antes->>(i->>'documento')) end
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
create or replace function public.solidcon_receber_pedidos_erp(
  p_itens jsonb, p_coletado_em timestamptz, p_execucao_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_agora timestamptz;
  v_motivo text;
  v_item jsonb;
  v_linhas integer := 0;
  v_anteriores bigint;
  v_ultima timestamptz;
  v_ts timestamptz;
  v_ped timestamptz;
  v_etapas jsonb;
  v_log bigint;
  v_campos constant text[] := array['cd_pedido','dt_pedido','etapa','dt_carga','dt_sep_inicio','dt_sep_fim',
    'dt_conferencia','dt_saida','dt_nota','dt_atendido','cliente_tipo','documento','valor_centavos','nr_carga'];
  v_datas constant text[] := array['dt_pedido','dt_carga','dt_sep_inicio','dt_sep_fim','dt_conferencia',
    'dt_saida','dt_nota','dt_atendido'];
  v_c text;
  v_prods jsonb;
  v_p jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.integracoes_autorizadas where user_id = auth.uid()
  ) then
    raise exception 'integracao nao autorizada' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(5100,35);
  v_agora := clock_timestamp();
  begin
    if p_execucao_id is null then
      v_motivo := 'execucao_invalida';
    elsif p_coletado_em is null or not isfinite(p_coletado_em)
       or p_coletado_em < v_agora - interval '1 hour'
       or p_coletado_em > v_agora + interval '5 minutes' then
      v_motivo := 'coleta_fora_da_janela';
    elsif p_itens is null or jsonb_typeof(p_itens) <> 'array' then
      v_motivo := 'payload_invalido';
    else
      v_linhas := jsonb_array_length(p_itens);
      if v_linhas > 5000 or octet_length(p_itens::text) > 4194304 then
        v_motivo := 'payload_fora_do_limite';
      else
        for v_item in select value from jsonb_array_elements(p_itens) loop
          if jsonb_typeof(v_item) <> 'object' then v_motivo := 'item_invalido'; exit; end if;
          -- Whitelist EXATA de campos (cliente_nome nunca vem do coletor). 039: 'produtos' e OPCIONAL
          -- (coletor sem pedidos_enviar_caixas continua mandando exatamente os campos da 035).
          if not (v_item ?& v_campos) or (v_item - v_campos - 'produtos' - 'pessoa_chave') <> '{}'::jsonb then
            v_motivo := 'campos_invalidos'; exit;
          end if;
          if jsonb_typeof(v_item->'cd_pedido') <> 'number' or (v_item->>'cd_pedido') !~ '^[1-9][0-9]{0,11}$' then
            v_motivo := 'pedido_invalido'; exit;
          end if;
          if jsonb_typeof(v_item->'etapa') <> 'string'
             or (v_item->>'etapa') not in ('aberto','na_carga','separando','separado','conferido','saiu','atendido') then
            v_motivo := 'etapa_invalida'; exit;
          end if;
          -- Datas: null ou ISO com fuso; entre 2000 e a coleta (+1 dia de folga de relogio).
          foreach v_c in array v_datas loop
            if jsonb_typeof(v_item->v_c) = 'null' then
              if v_c = 'dt_pedido' then v_motivo := 'data_invalida'; end if;
              continue;
            end if;
            if jsonb_typeof(v_item->v_c) <> 'string'
               or (v_item->>v_c) !~ '^(20)[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?[+-][0-9]{2}:[0-9]{2}$' then
              v_motivo := 'data_invalida'; exit;
            end if;
            begin
              v_ts := (v_item->>v_c)::timestamptz;
            exception when others then
              v_motivo := 'data_invalida'; exit;
            end;
            if v_ts < '2000-01-01'::timestamptz or v_ts > p_coletado_em + interval '1 day' then
              v_motivo := 'data_invalida'; exit;
            end if;
            if v_c = 'dt_pedido' then v_ped := v_ts; end if;
          end loop;
          exit when v_motivo is not null;
          -- Janela de 30 dias (+2 de folga para fuso/relogio).
          if v_ped < p_coletado_em - interval '32 days' then
            v_motivo := 'pedido_fora_da_janela'; exit;
          end if;
          if not (case v_item->>'etapa'
               when 'atendido' then jsonb_typeof(v_item->'dt_atendido') = 'string'
               when 'saiu' then jsonb_typeof(v_item->'dt_saida') = 'string'
               when 'conferido' then jsonb_typeof(v_item->'dt_conferencia') = 'string'
               when 'separado' then jsonb_typeof(v_item->'dt_sep_fim') = 'string'
               when 'separando' then jsonb_typeof(v_item->'dt_sep_inicio') = 'string'
               when 'na_carga' then jsonb_typeof(v_item->'nr_carga') = 'number'
               else true end) then
            v_motivo := 'etapa_sem_data'; exit;
          end if;
          if jsonb_typeof(v_item->'cliente_tipo') <> 'string'
             or (v_item->>'cliente_tipo') not in ('cnpj','cpf','indefinido') then
            v_motivo := 'cliente_tipo_invalido'; exit;
          end if;
          if (v_item->>'cliente_tipo') = 'cnpj' then
            if jsonb_typeof(v_item->'documento') <> 'string'
               or not public.solidcon_026_documento_valido(v_item->>'documento', 'cnpj') then
              v_motivo := 'documento_invalido'; exit;
            end if;
          elsif jsonb_typeof(v_item->'documento') <> 'null' then
            -- CPF / indefinido: nunca identificar.
            v_motivo := 'identificacao_indevida'; exit;
          end if;
          if jsonb_typeof(v_item->'valor_centavos') <> 'null' and (
               jsonb_typeof(v_item->'valor_centavos') <> 'number' or (v_item->>'valor_centavos') !~ '^[0-9]{1,15}$') then
            v_motivo := 'valor_invalido'; exit;
          end if;
          if jsonb_typeof(v_item->'nr_carga') <> 'null' and (
               jsonb_typeof(v_item->'nr_carga') <> 'number' or (v_item->>'nr_carga') !~ '^[1-9][0-9]{0,11}$') then
            v_motivo := 'carga_invalida'; exit;
          end if;
          if coalesce(jsonb_typeof(v_item->'pessoa_chave'),'null')<>'null' and
             (jsonb_typeof(v_item->'pessoa_chave')<>'string' or (v_item->>'pessoa_chave')!~'^[0-9a-f]{64}$' or v_item->>'cliente_tipo'<>'cpf') then
            v_motivo := 'chave_pessoa_invalida'; exit;
          end if;
          -- 039: produtos = null | [{p: cdProduto, q: quantidade}] (no maximo 300). Um objeto sozinho e aceito
          -- como lista de 1 (serializacao do PowerShell). So numeros: nenhum texto livre entra.
          if v_item ? 'produtos' and jsonb_typeof(v_item->'produtos') <> 'null' then
            v_prods := case jsonb_typeof(v_item->'produtos') when 'object' then jsonb_build_array(v_item->'produtos')
                                                              else v_item->'produtos' end;
            if jsonb_typeof(v_prods) <> 'array' or jsonb_array_length(v_prods) > 300 then
              v_motivo := 'produtos_invalidos'; exit;
            end if;
            for v_p in select value from jsonb_array_elements(v_prods) loop
              if jsonb_typeof(v_p) <> 'object' or not (v_p ?& array['p','q']) or (v_p - array['p','q']) <> '{}'::jsonb
                 or jsonb_typeof(v_p->'p') <> 'number' or (v_p->>'p') !~ '^[1-9][0-9]{0,11}$'
                 or jsonb_typeof(v_p->'q') <> 'number' or (v_p->>'q') !~ '^[0-9]{1,6}(\.[0-9]{1,6})?$'
                 or (v_p->>'q')::numeric > 100000 then
                v_motivo := 'produtos_invalidos'; exit;
              end if;
            end loop;
            exit when v_motivo is not null;
          end if;
        end loop;
        if v_motivo is null and (select count(distinct value->>'cd_pedido') from jsonb_array_elements(p_itens)) <> v_linhas then
          v_motivo := 'pedido_duplicado';
        end if;
      end if;
    end if;
    if v_motivo is null then
      select max(coletado_em) into v_ultima from public.solidcon_pedidos_erp_sync where status = 'ok';
      select count(*) into v_anteriores from public.solidcon_pedidos_erp;
      if v_ultima is not null and p_coletado_em <= v_ultima then
        v_motivo := 'snapshot_antigo';
      elsif exists (select 1 from public.solidcon_pedidos_erp_sync where status = 'ok' and execucao_id = p_execucao_id) then
        v_motivo := 'execucao_repetida';
      elsif v_anteriores >= 20 and v_linhas::bigint * 10 < v_anteriores * 3 then
        -- Mais de 70% dos pedidos sumindo de uma vez (5 min): mais provavel falha na origem.
        v_motivo := 'queda_superior_70_porcento';
      end if;
    end if;
    if v_motivo is null then
      -- Substituicao completa = poda de tudo que saiu da janela. WHERE obrigatorio (safeupdate).
      delete from public.solidcon_pedidos_erp where cd_pedido is not null;
      insert into public.solidcon_pedidos_erp(
        cd_pedido, dt_pedido, etapa, dt_carga, dt_sep_inicio, dt_sep_fim, dt_conferencia, dt_saida,
        dt_nota, dt_atendido, cliente_tipo, documento, cliente_nome, valor_centavos, nr_carga, atualizado_em,
        caixas_24, caixas_48, caixas_outras,pessoa_chave)
      select (i->>'cd_pedido')::bigint, (i->>'dt_pedido')::timestamptz, i->>'etapa',
        (i->>'dt_carga')::timestamptz, (i->>'dt_sep_inicio')::timestamptz, (i->>'dt_sep_fim')::timestamptz,
        (i->>'dt_conferencia')::timestamptz, (i->>'dt_saida')::timestamptz, (i->>'dt_nota')::timestamptz,
        (i->>'dt_atendido')::timestamptz, i->>'cliente_tipo', i->>'documento',
        -- Nome so para CNPJ, do espelho de clientes (023).
        case when i->>'cliente_tipo' = 'cnpj' then (
          select left(btrim(c.nome), 150) from public.solidcon_clientes c
           where c.tipo = 'cnpj' and c.documento = i->>'documento') end,
        (i->>'valor_centavos')::bigint, (i->>'nr_carga')::bigint, p_coletado_em,
        cx.c24, cx.c48, cx.outras,case when i->>'cliente_tipo'='cpf' then i->>'pessoa_chave' end
      from jsonb_array_elements(p_itens) as t(i)
      -- 039: caixas pelo cadastro do espelho (solidcon_produtos.categoria). Sem 'produtos' ou com quantidade
      -- fracionada = NULL nas tres (nao da para afirmar). Produto fora do espelho = caixas_outras.
      left join lateral (
        select case when x.n = 0 or x.frac then null else coalesce(x.c24, 0) end as c24,
               case when x.n = 0 or x.frac then null else coalesce(x.c48, 0) end as c48,
               case when x.n = 0 or x.frac then null else coalesce(x.outras, 0) end as outras
          from (
            select count(*) as n,
                   coalesce(bool_or((e->>'q')::numeric <> trunc((e->>'q')::numeric)), false) as frac,
                   sum((e->>'q')::numeric) filter (where pr.categoria = 'TEMPERO - CAIXA 24 UN')::integer as c24,
                   sum((e->>'q')::numeric) filter (where pr.categoria = 'TEMPERO - CAIXA 48 UN')::integer as c48,
                   sum((e->>'q')::numeric) filter (where pr.id_produto is null
                                                      or pr.categoria not in ('TEMPERO - CAIXA 24 UN', 'TEMPERO - CAIXA 48 UN'))::integer as outras
              from jsonb_array_elements(case jsonb_typeof(i->'produtos')
                                          when 'array' then i->'produtos'
                                          when 'object' then jsonb_build_array(i->'produtos')
                                          else '[]'::jsonb end) as e
              left join public.solidcon_produtos pr on pr.id_produto = (e->>'p')::bigint
          ) x
      ) cx on true;
      perform public.solidcon_058_limpar();
      select coalesce(jsonb_object_agg(etapa, n), '{}'::jsonb) into v_etapas
        from (select etapa, count(*) as n from public.solidcon_pedidos_erp group by etapa) e;
      delete from public.solidcon_pedidos_erp_sync where em < v_agora - interval '30 days';
      insert into public.solidcon_pedidos_erp_sync(status, linhas, por_etapa, coletado_em, execucao_id, em)
        values ('ok', v_linhas, v_etapas, p_coletado_em, p_execucao_id, v_agora) returning id into v_log;
      return jsonb_build_object('id', v_log, 'status', 'ok', 'linhas', v_linhas,
        'coletado_em', p_coletado_em, 'execucao_id', p_execucao_id);
    end if;
  exception when others then
    -- Nunca SQLERRM/DETAIL (poderia citar documento recebido).
    v_motivo := 'falha_interna';
  end;
  insert into public.solidcon_pedidos_erp_sync(status, linhas, coletado_em, execucao_id, mensagem, em)
    values ('erro', v_linhas, p_coletado_em, p_execucao_id, v_motivo, v_agora) returning id into v_log;
  return jsonb_build_object('id', v_log, 'status', 'erro', 'motivo', v_motivo, 'execucao_id', p_execucao_id);
end;
$$;
create or replace function public.rota_057_guardar(p_cds bigint[])
returns integer language plpgsql security definer set search_path=''
as $$declare v_n integer;begin
 if p_cds is null or cardinality(p_cds)=0 then return 0;end if;
 with ids as(select distinct unnest(p_cds) cd_pedido),
 recentes as materialized(select distinct on(c.cd_pedido) c.* from public.pedido_canhoto c join ids using(cd_pedido) order by c.cd_pedido,c.enviado_em desc,c.id desc),
 limites as(select c.cd_pedido,max(c.enviado_em) ultimo from public.pedido_canhoto c join ids using(cd_pedido) group by c.cd_pedido),
 rotas as materialized(
  select s.data,s.veiculo_id,s.versao,s.publicado_em,(ped#>>'{}')::bigint cd_pedido,
   sp->>'endereco' endereco,it->>'nome' cliente_nome
  from public.rota_saida s
  cross join lateral jsonb_array_elements(case when jsonb_typeof(s.paradas)='array' then s.paradas else '[]'::jsonb end) sp
  cross join lateral jsonb_array_elements(case when jsonb_typeof(sp->'itens')='array' then sp->'itens' else jsonb_build_array(sp) end) it
  cross join lateral jsonb_array_elements(case when jsonb_typeof(it->'pedidos')='array' then it->'pedidos' else '[]'::jsonb end) ped
  where jsonb_typeof(ped)='number' and s.data in(select distinct public.rota_057_dia_caminho(caminho) from recentes)
 )
 insert into public.pedido_arquivo as arq(cd_pedido,dt_pedido,dt_faturado,cliente_tipo,cliente_nome,documento,logradouro,numero,complemento,bairro,cidade,uf,cep,endereco_texto,endereco_origem,valor_centavos,caixas_24,caixas_48,caixas_outras,nr_carga,rota_data,rota_versao,veiculo_id,veiculo_nome,motorista_id,motorista_nome,contexto_origem,ultimo_canhoto_em,dados_incompletos)
 select ids.cd_pedido,
  coalesce(p.dt_pedido,a.dt_pedido),
  coalesce(p.dt_saida,p.dt_nota,p.dt_atendido,a.dt_faturado),
  coalesce(nullif(p.cliente_tipo,'indefinido'),a.cliente_tipo,p.cliente_tipo,'indefinido'),
  coalesce(nullif(p.cliente_nome,''),nullif(cli.nome,''),a.cliente_nome,nullif(r.cliente_nome,'Consumidor final')),
  case when coalesce(nullif(p.cliente_tipo,'indefinido'),a.cliente_tipo,p.cliente_tipo)='cnpj' then coalesce(p.documento,a.documento) end,
  coalesce(nullif(to_jsonb(p)->>'entrega_logradouro',''),nullif(cli.logradouro,''),a.logradouro),
  coalesce(nullif(to_jsonb(p)->>'entrega_numero',''),nullif(cli.numero,''),a.numero),
  coalesce(nullif(to_jsonb(p)->>'entrega_complemento',''),nullif(cli.complemento,''),a.complemento),
  coalesce(nullif(to_jsonb(p)->>'entrega_bairro',''),nullif(cli.bairro,''),a.bairro),
  coalesce(nullif(to_jsonb(p)->>'entrega_cidade',''),nullif(cli.cidade,''),a.cidade),
  coalesce(nullif(to_jsonb(p)->>'entrega_uf',''),nullif(cli.estado,''),a.uf),
  nullif(regexp_replace(coalesce(nullif(to_jsonb(p)->>'entrega_cep',''),nullif(cli.cep,''),a.cep),'[^0-9]','','g'),''),
  coalesce(a.endereco_texto,r.endereco),
  case when nullif(to_jsonb(p)->>'entrega_logradouro','') is not null then coalesce(nullif(to_jsonb(p)->>'entrega_origem',''),'pedido') when cli.logradouro is not null then 'cadastro' else coalesce(a.endereco_origem,case when r.endereco is not null then 'rota' end) end,
  coalesce(p.valor_centavos,a.valor_centavos),
  coalesce(p.caixas_24,a.caixas_24),
  coalesce(p.caixas_48,a.caixas_48),
  coalesce(p.caixas_outras,a.caixas_outras),
  coalesce(p.nr_carga,a.nr_carga),
  case when a.ultimo_canhoto_em is null or cf.enviado_em>a.ultimo_canhoto_em then coalesce(r.data,a.rota_data) else a.rota_data end,
  case when a.ultimo_canhoto_em is null or cf.enviado_em>a.ultimo_canhoto_em then coalesce(r.versao,a.rota_versao) else a.rota_versao end,
  case when a.ultimo_canhoto_em is null or cf.enviado_em>a.ultimo_canhoto_em then coalesce(r.veiculo_id,a.veiculo_id) else a.veiculo_id end,
  case when a.ultimo_canhoto_em is null or cf.enviado_em>a.ultimo_canhoto_em then coalesce(v.nome,a.veiculo_nome) else a.veiculo_nome end,
  case when a.ultimo_canhoto_em is null or cf.enviado_em>a.ultimo_canhoto_em then coalesce(m.user_id,a.motorista_id) else a.motorista_id end,
  case when a.ultimo_canhoto_em is null or cf.enviado_em>a.ultimo_canhoto_em then coalesce(m.nome,a.motorista_nome) else a.motorista_nome end,
  case when a.ultimo_canhoto_em is null or cf.enviado_em>a.ultimo_canhoto_em then coalesce(case when r.veiculo_id is null then null when cf.rota_veiculo is not null then 'anexo_motorista' else 'publicacao_unica' end,a.contexto_origem) else a.contexto_origem end,
  greatest(l.ultimo,a.ultimo_canhoto_em),
  (coalesce(p.dt_pedido,a.dt_pedido) is null or coalesce(nullif(p.cliente_nome,''),nullif(cli.nome,''),a.cliente_nome,nullif(r.cliente_nome,'Consumidor final')) is null or coalesce(p.valor_centavos,a.valor_centavos) is null)
 from ids join recentes cf using(cd_pedido) join limites l using(cd_pedido)
 left join public.solidcon_pedidos_erp p using(cd_pedido)
 left join public.pedido_arquivo a using(cd_pedido)
 left join public.solidcon_clientes cli on p.cliente_tipo='cnpj' and cli.tipo='cnpj' and cli.documento=p.documento
 left join lateral(
  select z.* from(select rr.*,count(*) over() n from rotas rr where rr.cd_pedido=ids.cd_pedido
   and rr.data=coalesce(cf.rota_data,public.rota_057_dia_caminho(cf.caminho))
   and(cf.rota_veiculo is null or rr.veiculo_id=cf.rota_veiculo)
   and(cf.rota_versao is null or rr.versao=cf.rota_versao) and rr.publicado_em<=cf.enviado_em) z where z.n=1
 ) r on true
 left join public.rota_veiculos v on v.id=r.veiculo_id
 left join lateral(
  select z.* from(select mm.*,count(*) over() n from public.rota_motoristas mm
   where(cf.origem='motorista' and mm.user_id=cf.enviado_por) or(cf.origem='painel' and mm.veiculo_id=r.veiculo_id and mm.ativo)) z where z.n=1
 ) m on true
 on conflict(cd_pedido) do update set
 dt_pedido=excluded.dt_pedido,
 dt_faturado=excluded.dt_faturado,
 cliente_tipo=excluded.cliente_tipo,
 cliente_nome=excluded.cliente_nome,
 documento=excluded.documento,
 logradouro=excluded.logradouro,
 numero=excluded.numero,
 complemento=excluded.complemento,
 bairro=excluded.bairro,
 cidade=excluded.cidade,
 uf=excluded.uf,
 cep=excluded.cep,
 endereco_texto=excluded.endereco_texto,
 endereco_origem=excluded.endereco_origem,
 valor_centavos=excluded.valor_centavos,
 caixas_24=excluded.caixas_24,
 caixas_48=excluded.caixas_48,
 caixas_outras=excluded.caixas_outras,
 nr_carga=excluded.nr_carga,
 rota_data=excluded.rota_data,
 rota_versao=excluded.rota_versao,
 veiculo_id=excluded.veiculo_id,
 veiculo_nome=excluded.veiculo_nome,
 motorista_id=excluded.motorista_id,
 motorista_nome=excluded.motorista_nome,
 contexto_origem=excluded.contexto_origem,
 ultimo_canhoto_em=excluded.ultimo_canhoto_em,
 dados_incompletos=excluded.dados_incompletos,atualizado_em=pg_catalog.now()
 where row(arq.dt_pedido,arq.dt_faturado,arq.cliente_tipo,arq.cliente_nome,arq.documento,arq.logradouro,arq.numero,arq.complemento,arq.bairro,arq.cidade,arq.uf,arq.cep,arq.endereco_texto,arq.endereco_origem,arq.valor_centavos,arq.caixas_24,arq.caixas_48,arq.caixas_outras,arq.nr_carga,arq.rota_data,arq.rota_versao,arq.veiculo_id,arq.veiculo_nome,arq.motorista_id,arq.motorista_nome,arq.contexto_origem,arq.ultimo_canhoto_em,arq.dados_incompletos) is distinct from row(excluded.dt_pedido,excluded.dt_faturado,excluded.cliente_tipo,excluded.cliente_nome,excluded.documento,excluded.logradouro,excluded.numero,excluded.complemento,excluded.bairro,excluded.cidade,excluded.uf,excluded.cep,excluded.endereco_texto,excluded.endereco_origem,excluded.valor_centavos,excluded.caixas_24,excluded.caixas_48,excluded.caixas_outras,excluded.nr_carga,excluded.rota_data,excluded.rota_versao,excluded.veiculo_id,excluded.veiculo_nome,excluded.motorista_id,excluded.motorista_nome,excluded.contexto_origem,excluded.ultimo_canhoto_em,excluded.dados_incompletos);
 get diagnostics v_n=row_count;
 insert into public.pedido_arquivo_foto as foto(cd_pedido,caminho,enviado_em,origem,substituido_em,removido_em)
 select c.cd_pedido,c.caminho,c.enviado_em,c.origem,c.substituido_em,null from public.pedido_canhoto c where c.cd_pedido=any(p_cds)
 on conflict(cd_pedido,caminho) do update set enviado_em=excluded.enviado_em,origem=excluded.origem,substituido_em=excluded.substituido_em,removido_em=null
 where row(foto.enviado_em,foto.origem,foto.substituido_em,foto.removido_em) is distinct from row(excluded.enviado_em,excluded.origem,excluded.substituido_em,null);
 return v_n;
end$$;
revoke all on function public.rota_057_guardar(bigint[]) from public,anon,authenticated,service_role;

create or replace function public.rota_057_fonte_travar()
returns trigger language plpgsql security definer set search_path=''
as $$begin
 perform pg_catalog.pg_advisory_xact_lock(5100,5201);
 perform pg_catalog.pg_advisory_xact_lock(5100,5001);
 if tg_op in('DELETE','TRUNCATE') then
  perform public.rota_057_guardar(array(select distinct p.cd_pedido from public.solidcon_pedidos_erp p join public.pedido_canhoto c using(cd_pedido)));
 end if;
 return null;
end$$;
create or replace function public.rota_057_fonte_depois()
returns trigger language plpgsql security definer set search_path=''
as $$begin
 perform public.rota_057_guardar(array(select distinct cd_pedido from fonte057));return null;
end$$;
create or replace function public.rota_057_canhoto_depois()
returns trigger language plpgsql security definer set search_path=''
as $$begin
 perform pg_catalog.pg_advisory_xact_lock(5100,5201);
 perform pg_catalog.pg_advisory_xact_lock(5100,5001);
 if tg_op='DELETE' then
  update public.pedido_arquivo_foto f set removido_em=pg_catalog.now()
   from antigos057 c where f.cd_pedido=c.cd_pedido and f.caminho=c.caminho and f.removido_em is null;
 else
  perform public.rota_057_guardar(array(select distinct cd_pedido from novos057));
 end if;
 return null;
end$$;
revoke all on function public.rota_057_fonte_travar(),public.rota_057_fonte_depois(),public.rota_057_canhoto_depois() from public,anon,authenticated,service_role;
drop trigger if exists rota_057_fonte_travar on public.solidcon_pedidos_erp;
create trigger rota_057_fonte_travar before insert or update or delete or truncate on public.solidcon_pedidos_erp for each statement execute function public.rota_057_fonte_travar();
drop trigger if exists rota_057_fonte_ins on public.solidcon_pedidos_erp;
create trigger rota_057_fonte_ins after insert on public.solidcon_pedidos_erp referencing new table as fonte057 for each statement execute function public.rota_057_fonte_depois();
drop trigger if exists rota_057_fonte_upd on public.solidcon_pedidos_erp;
create trigger rota_057_fonte_upd after update on public.solidcon_pedidos_erp referencing new table as fonte057 for each statement execute function public.rota_057_fonte_depois();
drop trigger if exists rota_057_canhoto_ins on public.pedido_canhoto;
create trigger rota_057_canhoto_ins after insert on public.pedido_canhoto referencing new table as novos057 for each statement execute function public.rota_057_canhoto_depois();
drop trigger if exists rota_057_canhoto_upd on public.pedido_canhoto;
create trigger rota_057_canhoto_upd after update on public.pedido_canhoto referencing new table as novos057 for each statement execute function public.rota_057_canhoto_depois();
drop trigger if exists rota_057_canhoto_del on public.pedido_canhoto;
create trigger rota_057_canhoto_del after delete on public.pedido_canhoto referencing old table as antigos057 for each statement execute function public.rota_057_canhoto_depois();
create or replace function public.rota_057_purgar()
returns integer language plpgsql security definer set search_path=''
as $$declare v_n integer;v_corte timestamptz:=((now() at time zone 'America/Sao_Paulo')-interval '1 year') at time zone 'America/Sao_Paulo';begin
 delete from public.pedido_arquivo a where a.ultimo_canhoto_em<v_corte
  and not exists(select 1 from public.pedido_canhoto c where c.cd_pedido=a.cd_pedido)
  and not exists(select 1 from public.pedido_arquivo_foto f join storage.objects o on o.bucket_id='canhotos' and o.name=f.caminho where f.cd_pedido=a.cd_pedido);
 get diagnostics v_n=row_count;return v_n;
end$$;
revoke all on function public.rota_057_purgar() from public,anon,authenticated,service_role;
create or replace function public.rota_057_buscar(p_busca text default '',p_de date default null,p_ate date default null,
 p_antes timestamptz default null,p_antes_cd bigint default null,p_limite integer default 50)
returns setof public.pedido_arquivo language plpgsql stable security invoker set search_path=''
as $$begin
 if not coalesce(public.eh_equipe(),false) then raise exception 'somente equipe consulta o arquivo' using errcode='42501';end if;
 if p_limite is null or p_limite not between 1 and 101 or char_length(coalesce(p_busca,''))>150
 or(p_de is not null and p_ate is not null and p_de>p_ate) or((p_antes is null)<>(p_antes_cd is null)) then
  raise exception 'filtro de arquivo invalido' using errcode='22023';
 end if;
 return query select a.* from public.pedido_arquivo a
 where(coalesce(btrim(p_busca),'')='' or(case when btrim(p_busca) ~ '^[0-9]{1,12}$' then a.cd_pedido=btrim(p_busca)::bigint else false end)
  or strpos(lower(coalesce(a.cliente_nome,'')),lower(btrim(p_busca)))>0
  or(length(regexp_replace(p_busca,'[^0-9]','','g'))=14 and a.documento=regexp_replace(p_busca,'[^0-9]','','g')))
 and(p_de is null or coalesce(a.dt_faturado,a.dt_pedido,a.arquivado_em)>=p_de::timestamp at time zone 'America/Sao_Paulo')
 and(p_ate is null or coalesce(a.dt_faturado,a.dt_pedido,a.arquivado_em)<(p_ate+1)::timestamp at time zone 'America/Sao_Paulo')
 and(p_antes is null or(a.ultimo_canhoto_em,a.cd_pedido)<(p_antes,p_antes_cd))
 order by a.ultimo_canhoto_em desc,a.cd_pedido desc limit p_limite;
end$$;
revoke all on function public.rota_057_buscar(text,date,date,timestamptz,bigint,integer) from public,anon;
grant execute on function public.rota_057_buscar(text,date,date,timestamptz,bigint,integer) to authenticated;
create or replace function public.rota_052_registrar(p_caminho text, p_cds bigint[], p_substituir boolean,
                                                   p_veiculo text default null, p_versao integer default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_veic text := public.rota_051_meu_veiculo();
  v_hoje date := (pg_catalog.now() at time zone 'America/Sao_Paulo')::date;
  v_origem text;
  v_n integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(5100,5201);
  perform pg_catalog.pg_advisory_xact_lock(5100,5001);
  if not public.rota_052_arquivo_livre(p_caminho) then
    raise exception 'ARQUIVO_EXPIRADO: canhoto reservado para retencao; preserve a pendencia original' using errcode='P5105';
  end if;
  if p_cds is null or pg_catalog.cardinality(p_cds) not between 1 and 15050
     or exists (select 1 from pg_catalog.unnest(p_cds) x where x is null or x not between 1 and 999999999999)
     or public.rota_052_caminho_valido(p_caminho) is distinct from true then
    raise exception 'canhoto invalido' using errcode = '22023';
  end if;
  if pg_catalog.split_part(p_caminho, '/', 2)::bigint <> all (p_cds) then
    raise exception 'o caminho precisa ser de um dos pedidos' using errcode = '22023';
  end if;
  if coalesce(public.pode_marcar_rota(), false) then
    v_origem := 'painel';
    if not exists (select 1 from storage.objects o where o.bucket_id = 'canhotos' and o.name = p_caminho) then
      raise exception 'arquivo do canhoto nao encontrado' using errcode = 'P0002';
    end if;
    if exists(select 1 from pg_catalog.unnest(p_cds) x where not exists(select 1 from public.solidcon_pedidos_erp p where p.cd_pedido=x) and not exists(select 1 from public.pedido_arquivo a where a.cd_pedido=x)) then
      raise exception 'pedido nao existe no ERP' using errcode = 'P0002';
    end if;
  elsif v_veic is not null then
    v_origem := 'motorista';
    -- Mesma recusa P5101 para replay antigo; o cliente preserva a foto. A trava da rota vale ate COMMIT.
    perform public.rota_051_validar_contexto(pg_catalog.split_part(p_caminho, '/', 1)::date, p_veiculo, p_versao);
    v_veic := p_veiculo;   -- usa o vinculo travado/validado, nao a leitura anterior a essa trava
    if coalesce(p_substituir, false) then
      raise exception 'o motorista nao troca canhoto (so o escritorio)' using errcode = '42501';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'canhotos' and o.name = p_caminho and o.owner = v_uid) then
      raise exception 'arquivo do canhoto nao encontrado' using errcode = 'P0002';
    end if;
    if exists (select 1 from pg_catalog.unnest(p_cds) x where x not in (select public.rota_051_cds_da_rota(v_hoje, v_veic))) then
      raise exception 'pedido nao esta na sua rota de hoje' using errcode = '42501';
    end if;
  else
    raise exception 'sem permissao para anexar canhoto' using errcode = '42501';
  end if;
  if exists(select 1 from public.pedido_arquivo_foto f join public.rota_052_expurgo q on q.caminho=f.caminho where f.cd_pedido=any(p_cds) and q.concluido_em is null) then
    raise exception 'ARQUIVO_EXPIRADO: pacote reservado para expurgo; preserve a pendencia' using errcode='P5105';
  end if;
  if coalesce(p_substituir, false) then
    update public.pedido_canhoto set substituido_em = pg_catalog.now(), substituido_por = v_uid
     where cd_pedido = any (p_cds) and substituido_em is null and caminho <> p_caminho;
  end if;
  insert into public.pedido_canhoto (cd_pedido, caminho, origem, enviado_por,rota_data,rota_veiculo,rota_versao)
  select distinct x,p_caminho,v_origem,v_uid,case when v_origem='motorista' then v_hoje end,case when v_origem='motorista' then p_veiculo end,case when v_origem='motorista' then p_versao end from pg_catalog.unnest(p_cds) x
  on conflict (cd_pedido, caminho) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Mesmo nome de job, sem duplicar em reaplicacao. Sem pg_cron, a RPC de pedidos tambem limpa.
do $$begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  execute $j$select cron.unschedule(jobid) from cron.job where jobname='solidcon-cpf-retencao'$j$;
  execute $j$select cron.schedule('solidcon-cpf-retencao','17 * * * *','select public.solidcon_058_limpar()')$j$;
 else raise notice '058: pg_cron indisponivel; limpeza ocorre na RPC de pedidos; cron deve ser configurado antes de publicar.';
 end if;
end$$;
select public.solidcon_058_limpar();
notify pgrst,'reload schema';
commit;
