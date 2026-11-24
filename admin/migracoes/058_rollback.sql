-- Rollback058 preserva memoria de retencao; com atividade, reverter UI/flags e manter banco.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
select pg_catalog.pg_advisory_xact_lock(5100,58);
select pg_catalog.pg_advisory_xact_lock(5100,23);
select pg_catalog.pg_advisory_xact_lock(5100,35);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
do $$begin
 if to_regclass('public.solidcon_pessoa_retencao') is not null then
  if exists(select 1 from public.solidcon_pessoa_retencao) then
   raise exception '058 possui memoria de retencao: rollback recusado para nao ressuscitar dados expirados; reverta UI/flags mantendo058.' using errcode='55006';
  end if;
 end if;
 if exists(select 1 from pg_extension where extname='pg_cron') then
  execute $j$select cron.unschedule(jobid) from cron.job where jobname='solidcon-cpf-retencao'$j$;
 end if;
end$$;
lock table public.solidcon_clientes in share row exclusive mode nowait;
lock table public.solidcon_pedidos_erp in share row exclusive mode nowait;
drop trigger if exists solidcon_058_cliente_ins on public.solidcon_clientes;
drop trigger if exists solidcon_058_cliente_upd on public.solidcon_clientes;
drop trigger if exists solidcon_058_cliente_antes on public.solidcon_clientes;
drop trigger if exists solidcon_058_cliente_travar on public.solidcon_clientes;
drop trigger if exists solidcon_058_pedido_antes on public.solidcon_pedidos_erp;
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
          if not (v_item ?& v_campos) or (v_item - v_campos - 'produtos') <> '{}'::jsonb then
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
        caixas_24, caixas_48, caixas_outras)
      select (i->>'cd_pedido')::bigint, (i->>'dt_pedido')::timestamptz, i->>'etapa',
        (i->>'dt_carga')::timestamptz, (i->>'dt_sep_inicio')::timestamptz, (i->>'dt_sep_fim')::timestamptz,
        (i->>'dt_conferencia')::timestamptz, (i->>'dt_saida')::timestamptz, (i->>'dt_nota')::timestamptz,
        (i->>'dt_atendido')::timestamptz, i->>'cliente_tipo', i->>'documento',
        -- Nome so para CNPJ, do espelho de clientes (023).
        case when i->>'cliente_tipo' = 'cnpj' then (
          select left(btrim(c.nome), 150) from public.solidcon_clientes c
           where c.tipo = 'cnpj' and c.documento = i->>'documento') end,
        (i->>'valor_centavos')::bigint, (i->>'nr_carga')::bigint, p_coletado_em,
        cx.c24, cx.c48, cx.outras
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
  case when nullif(to_jsonb(p)->>'entrega_logradouro','') is not null then 'pedido' when cli.logradouro is not null then 'cadastro' else coalesce(a.endereco_origem,case when r.endereco is not null then 'rota' end) end,
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
drop function if exists public.solidcon_058_cliente_depois();
drop function if exists public.solidcon_058_cliente_antes();
drop function if exists public.solidcon_058_cliente_travar();
drop function if exists public.solidcon_058_pedido_antes();
drop function if exists public.solidcon_058_limpar();
drop function if exists public.solidcon_058_cliente_vencido(text);
drop function if exists public.solidcon_058_vencido(timestamptz);
drop table if exists public.solidcon_pessoa_retencao;
update public.solidcon_pedidos_erp set cliente_nome=null where cliente_tipo in('cpf','indefinido') and cliente_nome is not null;
alter table public.solidcon_pedidos_erp drop constraint if exists solidcon_pedidos_erp_058_endereco;
alter table public.solidcon_pedidos_erp drop constraint if exists solidcon_pedidos_erp_035_cliente;
alter table public.solidcon_pedidos_erp add constraint solidcon_pedidos_erp_035_cliente check(
 (cliente_tipo='cnpj' and documento ~ '^[0-9]{14}$') or(cliente_tipo in('cpf','indefinido') and documento is null and cliente_nome is null));
alter table public.solidcon_pedidos_erp drop column if exists pessoa_chave,drop column if exists entrega_logradouro,drop column if exists entrega_numero,
 drop column if exists entrega_complemento,drop column if exists entrega_bairro,drop column if exists entrega_cidade,drop column if exists entrega_uf,drop column if exists entrega_cep,drop column if exists entrega_origem;
alter table public.solidcon_clientes drop column if exists pessoa_chave;
update public.solidcon_clientes set logradouro=null,numero=null,complemento=null,cep=null where tipo='cpf';
alter table public.solidcon_clientes drop constraint if exists solidcon_clientes_027_endereco_cpf;
alter table public.solidcon_clientes add constraint solidcon_clientes_027_endereco_cpf check(tipo='cnpj' or(logradouro is null and numero is null and complemento is null and cep is null));
notify pgrst,'reload schema';
commit;
