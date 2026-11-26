-- 064: NF por emitente. Separa venda nossa, bonificacao nossa e nota de TERCEIROS (compra de fornecedor).
-- Causa: tbNota tpNF=1 inclui NF-e emitidas por fornecedores (importadas); entravam como venda.
-- Aditiva: 4 colunas novas (nulas = linha LEGADA, gravada pelo coletor antigo) + coluna gerada 'classe'.
-- Decisao do dono (25/11): guardar TUDO, cada uma no seu lugar.
--   venda       = emitente nosso e natureza sem 'Bonifica'  -> soma cliente/mapa/rankings
--   bonificacao = emitente nosso e natureza com 'Bonifica'  -> NAO soma; aparece a parte no detalhe do cliente
--   compra      = emitente de terceiro                      -> secao Compras de fornecedor, nunca cliente
--   legado      = linha sem emitente (antes do coletor 064)  -> continua somando como antes ate o backfill
-- Aplicar DEPOIS da 062 (redefine solidcon_mapa_clientes e solidcon_ler_vendas_nf da 062).
-- Requer023/026/041/060/062. Rollback: 064_rollback.sql (volta as RPCs 060/062; preserva colunas e dados).
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
select pg_catalog.pg_advisory_xact_lock(5100,60);
do $$begin
 if to_regclass('public.solidcon_vendas_nf') is null or to_regclass('public.solidcon_fornecedores') is null
   or to_regclass('public.solidcon_clientes') is null or to_regprocedure('public.solidcon_mapa_clientes()') is null
   or to_regprocedure('public.solidcon_026_documento_valido(text,text)') is null then
  raise exception '064 requer023/026/041/060. Nada aplicado.';
 end if;
 if pg_catalog.pg_get_functiondef('public.solidcon_mapa_clientes()'::regprocedure) not like '%solidcon_vendas_nf%' then
  raise exception '064 requer a 062 aplicada antes (mapa com NF). Nada aplicado.';
 end if;
end$$;

alter table public.solidcon_vendas_nf add column if not exists emitente text;
alter table public.solidcon_vendas_nf add column if not exists natureza text;
alter table public.solidcon_vendas_nf add column if not exists bonificacao boolean;
alter table public.solidcon_vendas_nf add column if not exists proprio boolean;
alter table public.solidcon_vendas_nf add column if not exists classe text generated always as (
 case when proprio is null then 'legado' when not proprio then 'compra' when bonificacao then 'bonificacao' else 'venda' end) stored;
alter table public.solidcon_vendas_nf drop constraint if exists solidcon_vendas_nf_064_emitente;
alter table public.solidcon_vendas_nf add constraint solidcon_vendas_nf_064_emitente check(
 (emitente is null and natureza is null and bonificacao is null and proprio is null)
 or (emitente ~ '^[0-9]{14}$' and bonificacao is not null and proprio is not null
     and (natureza is null or (pg_catalog.char_length(natureza) between 1 and 60 and natureza !~ '[[:cntrl:]]'))
     and bonificacao = coalesce(natureza ilike '%bonifica%',false)));
create index if not exists solidcon_vendas_nf_064_compras on public.solidcon_vendas_nf(emitente,dia desc) where proprio is false;

-- Recebe dois formatos (nunca misturados no mesmo envio):
--  LEGADO (11 campos, coletor antigo): aceito so enquanto nenhuma nota tiver emitente; depois = 'coletor_antigo'
--    (replay/reinstalacao do coletor velho nao pode apagar a classificacao da janela).
--  064 (15 campos): emitente (14 digitos, CNPJ valido), natureza (<=60 ou null), bonificacao, proprio.
--    Coerencia conferida no servidor: bonificacao = natureza ILIKE '%bonifica%'; um unico emitente proprio,
--    igual ao ja gravado; nenhum terceiro com o CNPJ proprio. Falha = codigo, nada apagado.
create or replace function public.solidcon_receber_vendas_nf(p_inicio date,p_fim date,p_itens jsonb,p_coletado_em timestamptz,p_execucao_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_hoje date;v_agora timestamptz;v_motivo text;v_item jsonb;v_campo text;v_dia date;v_dt timestamptz;
 v_n integer;v_assinatura text;v_antiga public.solidcon_vendas_nf_sync%rowtype;v_novo boolean;v_proprio text;
 v_campos constant text[]:=array['cd_nota','numero','serie','dia','dt','documento','cd_pedido','valor_centavos','total_nota_centavos','st_centavos','nf_cupom'];
 v_campos064 constant text[]:=array['cd_nota','numero','serie','dia','dt','documento','cd_pedido','valor_centavos','total_nota_centavos','st_centavos','nf_cupom',
   'emitente','natureza','bonificacao','proprio'];
begin
 if auth.uid() is null or not exists(select 1 from public.integracoes_autorizadas where user_id=auth.uid()) then
  raise exception 'integracao nao autorizada' using errcode='42501';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(5100,60);
 v_agora:=pg_catalog.clock_timestamp();v_hoje:=(v_agora at time zone 'America/Sao_Paulo')::date;
 begin
  if p_inicio is null or p_fim is null or p_inicio>p_fim or p_fim-p_inicio>30
    or p_inicio<greatest(date '2026-05-29',v_hoje-400) or p_fim>v_hoje then
   v_motivo:='intervalo_invalido';
  elsif p_execucao_id is null or p_coletado_em is null or not pg_catalog.isfinite(p_coletado_em)
    or p_coletado_em<v_agora-interval '24 hours' or p_coletado_em>v_agora+interval '5 minutes' then
   v_motivo:='coleta_invalida';
  elsif p_itens is null or pg_catalog.jsonb_typeof(p_itens)<>'array' then v_motivo:='payload_invalido';
  elsif pg_catalog.jsonb_array_length(p_itens)>10000 or pg_catalog.octet_length(p_itens::text)>16777216 then v_motivo:='limite_excedido';
  else
   v_n:=pg_catalog.jsonb_array_length(p_itens);
   -- Formato decidido pelo 1o item; todos os demais tem de ter exatamente as mesmas chaves.
   v_novo:=v_n>0 and pg_catalog.jsonb_typeof(p_itens->0)='object' and (p_itens->0) ? 'proprio';
   for v_item in select value from pg_catalog.jsonb_array_elements(p_itens) loop
    if pg_catalog.jsonb_typeof(v_item)<>'object'
      or (v_novo and (not(v_item ?& v_campos064) or exists(select 1 from pg_catalog.jsonb_object_keys(v_item) k where not(k=any(v_campos064)))))
      or (not v_novo and (not(v_item ?& v_campos) or exists(select 1 from pg_catalog.jsonb_object_keys(v_item) k where not(k=any(v_campos))))) then v_motivo:='campos_invalidos';exit;end if;
    if pg_catalog.jsonb_typeof(v_item->'dia')<>'string' or (v_item->>'dia') !~ '^\d{4}-\d{2}-\d{2}$'
      or pg_catalog.jsonb_typeof(v_item->'dt')<>'string' or (v_item->>'dt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then v_motivo:='data_invalida';exit;end if;
    v_dia:=(v_item->>'dia')::date;v_dt:=(v_item->>'dt')::timestamptz;
    if v_dia<p_inicio or v_dia>p_fim or not pg_catalog.isfinite(v_dt) or (v_dt at time zone 'America/Sao_Paulo')::date<>v_dia then v_motivo:='data_invalida';exit;end if;
    if pg_catalog.jsonb_typeof(v_item->'documento')<>'string' or not public.solidcon_026_documento_valido(v_item->>'documento','cnpj')
      or pg_catalog.jsonb_typeof(v_item->'serie')<>'string' or (v_item->>'serie') !~ '^[0-9A-Za-z-]{1,32}$'
      or pg_catalog.jsonb_typeof(v_item->'nf_cupom')<>'boolean' then v_motivo:='nota_invalida';exit;end if;
    foreach v_campo in array array['cd_nota','numero','valor_centavos','total_nota_centavos'] loop
     if pg_catalog.jsonb_typeof(v_item->v_campo)<>'number' or (v_item->>v_campo) !~ '^(0|[1-9][0-9]{0,15})$' then v_motivo:='numero_invalido';exit;end if;
    end loop;
    exit when v_motivo is not null;
    if (v_item->>'cd_nota')::numeric not between 1 and 9007199254740991 or (v_item->>'numero')::numeric not between 1 and 999999999
      or (v_item->>'valor_centavos')::numeric>999999999999999 or (v_item->>'total_nota_centavos')::numeric>999999999999999 then v_motivo:='numero_invalido';exit;end if;
    -- ST ausente e desconhecida, nao zero; nao impede somar produtos conhecidos.
    if v_item->'st_centavos'<>'null'::jsonb and (pg_catalog.jsonb_typeof(v_item->'st_centavos')<>'number' or (v_item->>'st_centavos') !~ '^(0|[1-9][0-9]{0,14})$'
      or (v_item->>'st_centavos')::numeric>999999999999999) then v_motivo:='numero_invalido';exit;end if;
    if v_item->'cd_pedido'<>'null'::jsonb and (pg_catalog.jsonb_typeof(v_item->'cd_pedido')<>'number' or (v_item->>'cd_pedido') !~ '^[1-9][0-9]{0,15}$'
      or (v_item->>'cd_pedido')::numeric not between 1 and 9007199254740991) then v_motivo:='pedido_invalido';exit;end if;
    if v_novo then
     if pg_catalog.jsonb_typeof(v_item->'emitente')<>'string' or (v_item->>'emitente') !~ '^[0-9]{14}$'
       or not public.solidcon_026_documento_valido(v_item->>'emitente','cnpj')
       or pg_catalog.jsonb_typeof(v_item->'proprio')<>'boolean' then v_motivo:='emitente_invalido';exit;end if;
     if (v_item->'natureza'<>'null'::jsonb and (pg_catalog.jsonb_typeof(v_item->'natureza')<>'string'
         or pg_catalog.char_length(v_item->>'natureza') not between 1 and 60 or (v_item->>'natureza') ~ '[[:cntrl:]]'
         or (v_item->>'natureza')<>pg_catalog.btrim(v_item->>'natureza')))
       or pg_catalog.jsonb_typeof(v_item->'bonificacao')<>'boolean'
       or (v_item->'bonificacao')::text::boolean is distinct from coalesce((v_item->>'natureza') ilike '%bonifica%',false) then v_motivo:='natureza_invalida';exit;end if;
    end if;
   end loop;
   if v_motivo is null and (select count(distinct (value->>'cd_nota')::bigint) from pg_catalog.jsonb_array_elements(p_itens))<>v_n then v_motivo:='nota_duplicada';end if;
   if v_motivo is null and v_novo then
    -- Um CNPJ proprio por envio, o mesmo ja gravado; terceiro nunca com o CNPJ proprio.
    select pg_catalog.min(e) into v_proprio from (
      select value->>'emitente' e from pg_catalog.jsonb_array_elements(p_itens) where (value->>'proprio')::boolean
      union select emitente from public.solidcon_vendas_nf where proprio) x;
    if (select count(distinct e) from (
          select value->>'emitente' e from pg_catalog.jsonb_array_elements(p_itens) where (value->>'proprio')::boolean
          union select emitente from public.solidcon_vendas_nf where proprio) x)>1
      or exists(select 1 from pg_catalog.jsonb_array_elements(p_itens) where not (value->>'proprio')::boolean and value->>'emitente'=v_proprio) then
     v_motivo:='emitente_inconsistente';
    end if;
   elsif v_motivo is null and v_n>0 and exists(select 1 from public.solidcon_vendas_nf where proprio is not null) then
    v_motivo:='coletor_antigo';
   end if;
  end if;
  if v_motivo is null then
   v_assinatura:=pg_catalog.md5(p_itens::text||pg_catalog.to_char(p_coletado_em at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'));
   select * into v_antiga from public.solidcon_vendas_nf_sync where status='ok' and execucao_id=p_execucao_id and inicio=p_inicio and fim=p_fim;
   if found then
    if v_antiga.assinatura=v_assinatura then return pg_catalog.jsonb_build_object('status','ok','linhas',v_antiga.linhas,'repetido',true);end if;
    v_motivo:='conflito_execucao';
   elsif exists(select 1 from public.solidcon_vendas_nf_dias where dia between p_inicio and p_fim and coletado_em>=p_coletado_em)
     or exists(select 1 from public.solidcon_vendas_nf n join pg_catalog.jsonb_array_elements(p_itens) i on n.cd_nota=(i->>'cd_nota')::bigint where n.coletado_em>=p_coletado_em) then v_motivo:='snapshot_antigo';
   end if;
  end if;
  if v_motivo is null then
   delete from public.solidcon_vendas_nf where dia between p_inicio and p_fim;
   insert into public.solidcon_vendas_nf(cd_nota,numero,serie,dia,dt,documento,cd_pedido,valor_centavos,total_nota_centavos,st_centavos,nf_cupom,coletado_em,
     emitente,natureza,bonificacao,proprio)
   select (i->>'cd_nota')::bigint,(i->>'numero')::bigint,i->>'serie',(i->>'dia')::date,(i->>'dt')::timestamptz,i->>'documento',
     (i->>'cd_pedido')::bigint,(i->>'valor_centavos')::bigint,(i->>'total_nota_centavos')::bigint,(i->>'st_centavos')::bigint,(i->>'nf_cupom')::boolean,p_coletado_em,
     i->>'emitente',i->>'natureza',(i->>'bonificacao')::boolean,(i->>'proprio')::boolean
   from pg_catalog.jsonb_array_elements(p_itens) i
   on conflict(cd_nota) do update set numero=excluded.numero,serie=excluded.serie,dia=excluded.dia,dt=excluded.dt,documento=excluded.documento,
     cd_pedido=excluded.cd_pedido,valor_centavos=excluded.valor_centavos,total_nota_centavos=excluded.total_nota_centavos,st_centavos=excluded.st_centavos,nf_cupom=excluded.nf_cupom,coletado_em=excluded.coletado_em,
     emitente=excluded.emitente,natureza=excluded.natureza,bonificacao=excluded.bonificacao,proprio=excluded.proprio;
   insert into public.solidcon_vendas_nf_dias(dia,coletado_em,execucao_id)
   select d::date,p_coletado_em,p_execucao_id from pg_catalog.generate_series(p_inicio::timestamp,p_fim::timestamp,interval '1 day') d
   on conflict(dia) do update set coletado_em=excluded.coletado_em,execucao_id=excluded.execucao_id;
   insert into public.solidcon_vendas_nf_sync(inicio,fim,status,linhas,coletado_em,execucao_id,assinatura)
   values(p_inicio,p_fim,'ok',v_n,p_coletado_em,p_execucao_id,v_assinatura);
   perform public.solidcon_060_limpar();
   return pg_catalog.jsonb_build_object('status','ok','linhas',v_n,'repetido',false);
  end if;
 exception when others then v_motivo:='payload_invalido';
 end;
 insert into public.solidcon_vendas_nf_sync(inicio,fim,status,linhas,execucao_id,mensagem) values(p_inicio,p_fim,'erro',0,p_execucao_id,v_motivo);
 return pg_catalog.jsonb_build_object('status','erro','motivo',v_motivo);
end$$;
revoke all on function public.solidcon_receber_vendas_nf(date,date,jsonb,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.solidcon_receber_vendas_nf(date,date,jsonb,timestamptz,uuid) to authenticated;

-- Leitura do painel (mesmo contrato 060/062): 'notas' = SO venda/legado, para o painel antigo ja somar certo.
-- Novos: 'bonificacoes' (nossas, nao somam) e 'legado' (linhas ainda sem emitente: backfill pendente).
create or replace function public.solidcon_ler_vendas_nf()
returns jsonb language plpgsql stable security invoker set search_path=''
as $$begin
 if not coalesce(public.eh_equipe(),false) then raise exception 'equipe necessaria' using errcode='42501';end if;
 return (with notas as materialized (
  select cd_nota,numero,serie,dia,dt,documento,tipo,cd_pedido,valor_centavos,total_nota_centavos,st_centavos,nf_cupom,classe
  from public.solidcon_vendas_nf n
  where n.classe in ('venda','legado') and not exists(select from public.solidcon_fornecedores f where f.documento=n.documento)
  order by cd_nota limit 20000
 ),bonif as materialized (
  select cd_nota,numero,serie,dia,documento,cd_pedido,valor_centavos,total_nota_centavos,natureza
  from public.solidcon_vendas_nf n
  where n.classe='bonificacao' and not exists(select from public.solidcon_fornecedores f where f.documento=n.documento)
  order by cd_nota limit 5000
 ),dias as materialized (
  select dia,coletado_em from public.solidcon_vendas_nf_dias order by dia limit 402
 ) select pg_catalog.jsonb_build_object(
  'notas',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(n)) from notas n),'[]'::jsonb),
  'bonificacoes',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b)) from bonif b),'[]'::jsonb),
  'dias',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(d)) from dias d),'[]'::jsonb),
  'legado',(select count(*) from public.solidcon_vendas_nf where classe='legado'),
  'truncado',(select count(*)>=20000 from notas) or (select count(*)>=5000 from bonif) or (select count(*)>=402 from dias)));
end$$;
revoke all on function public.solidcon_ler_vendas_nf() from public,anon,authenticated,service_role;
grant execute on function public.solidcon_ler_vendas_nf() to authenticated;

-- Compras de fornecedor: NF-e de terceiros, por emitente. Nunca entram em cliente/mapa/ranking.
create or replace function public.solidcon_ler_compras_nf()
returns jsonb language plpgsql stable security invoker set search_path=''
as $$begin
 if not coalesce(public.eh_equipe(),false) then raise exception 'equipe necessaria' using errcode='42501';end if;
 return (with notas as materialized (
  select cd_nota,numero,serie,dia,emitente,documento,natureza,valor_centavos,total_nota_centavos,st_centavos
  from public.solidcon_vendas_nf where classe='compra' order by dia desc,cd_nota desc limit 5000
 ),total as materialized (
  select emitente,count(*)::integer qtd,sum(valor_centavos)::bigint valor_centavos,sum(total_nota_centavos)::bigint total_nota_centavos,
    min(dia) primeira,max(dia) ultima
  from public.solidcon_vendas_nf where classe='compra' group by emitente
 ) select pg_catalog.jsonb_build_object(
  'fornecedores',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('emitente',t.emitente,'nome',c.nome,'qtd',t.qtd,
     'valor_centavos',t.valor_centavos,'total_nota_centavos',t.total_nota_centavos,'primeira',t.primeira,'ultima',t.ultima)
     order by t.total_nota_centavos desc,t.emitente)
   from total t left join public.solidcon_clientes c on c.documento=t.emitente),'[]'::jsonb),
  'notas',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(n)) from notas n),'[]'::jsonb),
  'legado',(select count(*) from public.solidcon_vendas_nf where classe='legado'),
  'truncado',(select count(*)>=5000 from notas)));
end$$;
revoke all on function public.solidcon_ler_compras_nf() from public,anon,authenticated,service_role;
grant execute on function public.solidcon_ler_compras_nf() to authenticated;

-- Mapa (062) + 064: soma so NF de venda nossa (ou legado ate o backfill).
create or replace function public.solidcon_mapa_clientes()
returns table (
  documento text, nome text, bairro text, cidade text, estado text,
  lat numeric, lng numeric, precisao text, pino_desatualizado boolean,
  primeira_compra date, ultima_compra date, total_centavos bigint, cupons integer, meses jsonb,
  qualidade text, motivos text[]
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if auth.uid() is null or not coalesce(public.eh_equipe(), false) then
    raise exception 'somente equipe' using errcode = '42501';
  end if;
  return query
  with m as (
    select vc.documento, to_char(vc.dia, 'YYYY-MM') as mes,
           sum(vc.valor_centavos) as centavos, count(*) as qtd,
           min(vc.dia) as d_min, max(vc.dia) as d_max
      from (
        select v.documento, v.dia, v.valor_centavos
          from public.solidcon_vendas_clientes v where v.tipo = 'cnpj'
        union all
        select n.documento, n.dia, n.valor_centavos
          from public.solidcon_vendas_nf n where n.nf_cupom is not true
           and n.classe in ('venda','legado')   -- 064: bonificacao e compra de fornecedor nao somam
           and not exists(select from public.solidcon_fornecedores f where f.documento=n.documento)
      ) vc
     group by vc.documento, to_char(vc.dia, 'YYYY-MM')
  ), a as (
    select m.documento, min(m.d_min) as primeira, max(m.d_max) as ultima,
           sum(m.centavos)::bigint as total, sum(m.qtd)::integer as qtd,
           jsonb_object_agg(m.mes, jsonb_build_array(m.centavos::bigint, m.qtd::integer)) as meses
      from m group by m.documento
  )
  select c.documento, c.nome, c.bairro, c.cidade, c.estado,
         case when ok then g.lat end, case when ok then g.lng end,
         case when ok then g.precisao end,
         (g.documento is not null and not ok),
         a.primeira, a.ultima, coalesce(a.total, 0), coalesce(a.qtd, 0),
         coalesce(a.meses, '{}'::jsonb),
         q.qualidade, q.motivos
    from public.solidcon_clientes c
    left join public.solidcon_clientes_geo g on g.documento = c.documento
    left join a on a.documento = c.documento
    left join public.solidcon_037_avaliacao() q on q.documento = c.documento
    cross join lateral (select coalesce(g.chave_endereco =
      public.solidcon_033_chave_endereco(c.logradouro, c.numero, c.cep, c.bairro, c.cidade, c.estado), false) as ok) k
   where c.tipo = 'cnpj'
     and not exists (select 1 from public.solidcon_fornecedores f where f.documento = c.documento)   -- 041: fornecedor nao e cliente
   order by c.documento;
end;
$$;
revoke all on function public.solidcon_mapa_clientes() from public, anon, authenticated;
grant execute on function public.solidcon_mapa_clientes() to authenticated;
notify pgrst,'reload schema';
commit;
