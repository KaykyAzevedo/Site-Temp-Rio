-- 068AG sobre068V: agenda e ancora/prioridade maxima; nenhuma programacao automatica persistida.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
select pg_advisory_xact_lock(5100,6847);select pg_advisory_xact_lock(5100,5201);select pg_advisory_xact_lock(5100,5001);select pg_advisory_xact_lock(5100,4601);
create table if not exists public.rota_068ag_backup(nome text primary key,def text not null);
alter table public.rota_068ag_backup enable row level security;revoke all on public.rota_068ag_backup from public,anon,authenticated,service_role;
insert into public.rota_068ag_backup select n,pg_get_functiondef(n::regprocedure) from unnest(array['public.rota_065_salvar_semana(date,bigint,jsonb,text)','public.rota_066_sugestoes(date)','public.rota_070_estado(bigint)','public.rota_070_fechavel(bigint,date,text,boolean)','public.rota_070_reserva_valida(bigint,date,text)','public.rota_070_virar_dia(date)','public.rota_070_definitiva_salvar(date,jsonb,bigint,uuid)','public.rota_068_mover_pedido(bigint,date,text,uuid)']) n on conflict do nothing;
create table if not exists public.rota_068ag_manual(cd_pedido bigint primary key,prazo_em timestamptz not null,dia date,por uuid not null,em timestamptz not null default now());
alter table public.rota_068ag_manual enable row level security;revoke all on public.rota_068ag_manual from public,anon,authenticated,service_role;
alter table public.rota_config add column if not exists agendados_prioridade_068ag boolean not null default false;
update public.rota_config set agendados_prioridade_068ag=true where id=1;
create or replace function public.rota_068ag_estado(p_cd bigint) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('cd_pedido',p_cd,'agendado',true,'data_agendada',e.data_agendada,
 'data_ancora',case when m.cd_pedido is not null then m.dia else e.data_agendada end,
 'movido_manualmente',m.cd_pedido is not null and m.dia is distinct from e.data_agendada,
 'na_bandeja',m.cd_pedido is not null and m.dia is null,
 'dia_plano',(select p.dia from public.rota_plano_semana p where p.cd_pedido=p_cd and not p.removido))
 from public.rota_068_prazo_pedido e left join public.rota_068ag_manual m on m.cd_pedido=e.cd_pedido and m.prazo_em=e.atualizado_em and ((m.dia is null and not exists(select 1 from public.rota_plano_semana v where v.cd_pedido=e.cd_pedido and not v.removido)) or exists(select 1 from public.rota_plano_semana v where v.cd_pedido=e.cd_pedido and not v.removido and v.dia=m.dia)) where e.cd_pedido=p_cd and e.tipo='data'),jsonb_build_object('cd_pedido',p_cd,'agendado',false,'data_agendada',null,'data_ancora',null,'movido_manualmente',false,'na_bandeja',false,'dia_plano',null))
$$;
create or replace function public.rota_068ag_data(p_cd bigint) returns date language sql stable security definer set search_path='' as $$
 select case when (public.rota_068ag_estado(p_cd)->>'agendado')::boolean then (public.rota_068ag_estado(p_cd)->>'data_ancora')::date else public.rota_070_data(p_cd) end
$$;
create or replace function public.rota_068ag_no_dia(p_cd bigint,p_dia date) returns boolean language sql stable security definer set search_path='' as $$
 select not (public.rota_068ag_estado(p_cd)->>'agendado')::boolean or coalesce((public.rota_068ag_estado(p_cd)->>'data_ancora')::date=p_dia,false)
$$;
create or replace function public.rota_068ag_agendados_ler(p_cds bigint[])
returns table(cd_pedido bigint,agendado boolean,data_agendada date,data_ancora date,movido_manualmente boolean,na_bandeja boolean,dia_plano date)
language plpgsql stable security definer set search_path='' as $$begin
 if coalesce(auth.role(),'')<>'service_role' and (auth.uid() is null or not coalesce(public.eh_equipe(),false)) then raise exception 'somente equipe' using errcode='42501';end if;
 if p_cds is null or cardinality(p_cds)>300 or exists(select 1 from unnest(p_cds) c where c is null or c not between 1 and 999999999999) then raise exception 'pedidos invalidos' using errcode='22023';end if;
 return query select x.* from (select distinct c from unnest(p_cds) c) a cross join lateral jsonb_to_record(public.rota_068ag_estado(c)) x(cd_pedido bigint,agendado boolean,data_agendada date,data_ancora date,movido_manualmente boolean,na_bandeja boolean,dia_plano date);
end$$;
create or replace function public.rota_068ag_manual_registrar(p_cd bigint,p_dia date) returns void language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or not coalesce(public.pode_marcar_rota(),false) then return;end if;
 insert into public.rota_068ag_manual as m(cd_pedido,prazo_em,dia,por) select p_cd,e.atualizado_em,p_dia,auth.uid() from public.rota_068_prazo_pedido e where e.cd_pedido=p_cd and e.tipo='data'
 on conflict(cd_pedido) do update set prazo_em=excluded.prazo_em,dia=excluded.dia,por=excluded.por,em=now();
end$$;
-- Compara DATA EFETIVA: ausente/removido=bandeja(null); ordem/veiculo nao sao movimento de data.
create or replace function public.rota_068ag_plano_manual() returns trigger language plpgsql security definer set search_path='' as $$
declare antes date;depois date;cd bigint;begin
 if tg_op<>'INSERT' then antes:=case when not old.removido then old.dia end;cd:=old.cd_pedido;end if;
 if tg_op<>'DELETE' then depois:=case when not new.removido then new.dia end;cd:=new.cd_pedido;end if;
 if antes is distinct from depois then perform public.rota_068ag_manual_registrar(cd,depois);end if;
 return null;
end$$;
drop trigger if exists rota_068ag_plano_manual on public.rota_plano_semana;
create trigger rota_068ag_plano_manual after insert or update or delete on public.rota_plano_semana for each row execute function public.rota_068ag_plano_manual();
-- 065: conservar OLD logico dos IDs presentes no lote. O UPSERT compara antes/depois;
-- apagar/reinserir a MESMA linha nao e movimento. IDs omitidos continuam sendo removidos.
do $$declare body text;needle text;begin
 select def into body from public.rota_068ag_backup where nome='public.rota_065_salvar_semana(date,bigint,jsonb,text)';
 needle:='and (p_veiculo is null or p.veiculo_id = p_veiculo);';
 if position(needle in body)=0 then raise exception '068AG corpo065 inesperado';end if;
 body:=replace(body,needle,'and (p_veiculo is null or p.veiculo_id = p_veiculo) and not exists(select 1 from pg_catalog.jsonb_array_elements(p_itens) e where (e->>''cd_pedido'')::bigint=p.cd_pedido);');
 execute body;
end$$;
-- Mover para bandeja sem linha previa tambem e acao manual; retries antigos retornam antes deste ponto.
do $$declare body text;pos int;begin
 select def into body from public.rota_068ag_backup where nome='public.rota_068_mover_pedido(bigint,date,text,uuid)';
 pos:=length(body)-strpos(reverse(body),reverse('return res;'))-length('return res;')+2;
 if pos<1 then raise exception '068AG corpoH inesperado';end if;
 body:=overlay(body placing 'perform public.rota_068ag_manual_registrar(p_cd_pedido,p_dia);return res;' from pos for length('return res;'));execute body;
end$$;
-- Metadados aditivos no mapa065; campos070tabulares/pendencia nao mudam.
do $$declare body text;begin
 select replace(def,'CREATE OR REPLACE FUNCTION public.rota_070_estado(','CREATE OR REPLACE FUNCTION public.rota_068ag_estado_base(') into body from public.rota_068ag_backup where nome='public.rota_070_estado(bigint)';execute body;
end$$;
create or replace function public.rota_070_estado(p_cd bigint) returns jsonb language sql stable security definer set search_path='' as $$select public.rota_068ag_estado_base(p_cd)||public.rota_068ag_estado(p_cd)$$;
-- Datas070 efetivas usam ancora para agenda; reserva/foto ja persistida permanece projecao.
do $$declare body text;begin
 select def into body from public.rota_068ag_backup where nome='public.rota_070_fechavel(bigint,date,text,boolean)';
 body:=replace(body,'extract(isodow from p_dia)<>7','public.rota_068ag_no_dia(p_cd,p_dia) and extract(isodow from p_dia)<>7');body:=replace(body,'public.rota_070_data(p_cd)','public.rota_068ag_data(p_cd)');execute body;
 select def into body from public.rota_068ag_backup where nome='public.rota_070_reserva_valida(bigint,date,text)';body:=replace(body,'r.invalidada_em is null','r.invalidada_em is null and public.rota_068ag_no_dia(p_cd,p_dia)');body:=replace(body,'public.rota_070_data(p_cd)','public.rota_068ag_data(p_cd)');execute body;
 select def into body from public.rota_068ag_backup where nome='public.rota_070_virar_dia(date)';body:=replace(body,'public.rota_070_pronto(e.cd_pedido)','(public.rota_070_pronto(e.cd_pedido) and public.rota_068ag_no_dia(e.cd_pedido,p_dia))');body:=replace(body,'public.rota_070_pronto(r.cd_pedido)','(public.rota_070_pronto(r.cd_pedido) and public.rota_068ag_no_dia(r.cd_pedido,p_dia))');body:=replace(body,'public.rota_070_data(e.cd_pedido)','public.rota_068ag_data(e.cd_pedido)');execute body;
 select def into body from public.rota_068ag_backup where nome='public.rota_070_definitiva_salvar(date,jsonb,bigint,uuid)';body:=replace(body,'if not public.rota_070_pronto(cd) then', 'if not public.rota_068ag_no_dia(cd,p_dia) then return jsonb_build_object(''status'',''erro'',''motivo'',''pedido_agendado_fora_data'',''cd_pedido'',cd);end if; if not public.rota_070_pronto(cd) then');body:=replace(body,'public.rota_070_data(cd)','public.rota_068ag_data(cd)');execute body;
end$$;

create or replace function public.rota_068ag_sugestoes_formato(p jsonb,p_semana date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb:='[]';e jsonb;a jsonb;name text;warn boolean;txt text;begin
 for e in select value from jsonb_array_elements(p->'pedidos') loop
  a:=public.rota_068ag_estado((e->>'cd_pedido')::bigint);
  if (a->>'agendado')::boolean then
   select coalesce(c.nome,erp.cliente_nome,'Pedido '||(e->>'cd_pedido')) into name from public.solidcon_pedidos_erp erp left join public.solidcon_clientes c on c.documento=erp.documento where erp.cd_pedido=(e->>'cd_pedido')::bigint;
   warn:=(a->>'na_bandeja')::boolean or e->>'veiculo_sugerido' is null or (a->>'data_ancora') is distinct from (a->>'data_agendada') or (a->>'data_ancora')::date<public.rota_070_hoje() or coalesce(e->'motivo','[]') ? 'sem_capacidade' or not coalesce(public.rota_066_saida(e->>'veiculo_sugerido',(a->>'data_ancora')::date),false) or (a->>'dia_plano' is not null and (a->>'dia_plano') is distinct from (a->>'data_ancora'));
   txt:='AGENDADO '||coalesce(a->>'data_ancora','bandeja manual')||' p/ '||coalesce(name,'pedido')||' - prioridade maxima'||case when warn then ' - ALERTA: conferir data/veiculo/capacidade' else '' end;
   e:=e||jsonb_build_object('agendado',true,'prioridade_maxima',true,'data_agendada',a->'data_agendada','data_ancora',a->'data_ancora','dia_sugerido',a->'data_ancora','score',10000,'alerta_forte',warn,'fora_semana',(a->>'data_ancora')::date not between p_semana and p_semana+5,'texto',txt);
  elsif e->>'ancora_cd' is not null and e->>'ancora_km' is not null then
   txt:='Agendado '||coalesce(e->>'dia_sugerido','')||' p/ '||coalesce(e->>'ancora_nome','pedido')||' - Pedido '||(e->>'cd_pedido')||' a '||replace(round((e->>'ancora_km')::numeric,1)::text,'.',',')||' km, encaixa nesta data';
   e:=e||jsonb_build_object('texto',txt,'alerta_forte',false);
  else e:=e||jsonb_build_object('alerta_forte',false);end if;
  rows:=rows||jsonb_build_array(e);
 end loop;
 return p||jsonb_build_object('pedidos',rows,'agendados',coalesce((select jsonb_agg(x) from jsonb_array_elements(rows) x where (x->>'agendado')::boolean),'[]'));
end$$;

CREATE OR REPLACE FUNCTION public.rota_066_sugestoes(p_semana date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hoje date := public.rota_050_hoje();
  v_res jsonb;
begin
  if not coalesce(public.pode_marcar_rota(), false) then
    raise exception 'sem permissao para ver sugestoes da rota' using errcode = '42501';
  end if;
  if p_semana is null or extract(isodow from p_semana) <> 1 or p_semana < v_hoje - 56 or p_semana > v_hoje + 84 then
    return pg_catalog.jsonb_build_object('status', 'erro', 'motivo', 'parametro_invalido');
  end if;
  with
  cel as (   -- dia/veiculo programavel na semana: editavel (065) e o veiculo sai
    select d.dia, v.id veiculo_id, coalesce(v.nome, v.id) vnome, v.modo, v.capacidade_volume::numeric cap
      from (select (p_semana + k) dia from pg_catalog.generate_series(0, 5) k) d
      join public.rota_veiculos v on v.ativo
     where public.rota_065_dia_editavel(d.dia) and public.rota_066_saida(v.id, d.dia)
  ),
  geo as (
    select g.documento, g.lat::double precision lat, g.lng::double precision lng
      from public.solidcon_clientes_geo g where g.precisao <> 'nao_encontrado' and g.lat is not null
  ),
  hist as (  -- memoria: 12 semanas antes da semana pedida; foto vence plano do mesmo pedido; meia-vida 4 semanas
    select distinct on (h.cd_pedido) h.cd_pedido, h.documento doc, h.dia, h.veiculo_id,
           pg_catalog.power(0.5, (p_semana - h.dia) / 28.0)::double precision w
      from public.rota_068v_memoria() h
     where h.dia >= p_semana - 84 and h.dia < p_semana and h.documento is not null
     order by h.cd_pedido, (h.fonte = 'foto') desc, h.dia desc
  ),
  hdia as (select x.doc, x.dia, x.veiculo_id, max(x.w) w from hist x group by 1, 2, 3),
  hdow as (select x.doc, extract(isodow from x.dia)::integer dow, sum(x.w) w from hdia x group by 1, 2),
  htot as (select x.doc, sum(x.w) w from hdia x group by 1),
  hveic as (select distinct on (y.doc) y.doc, y.veiculo_id from (select x.doc, x.veiculo_id, sum(x.w) w from hdia x group by 1, 2) y
             order by y.doc, y.w desc, y.veiculo_id),
  hpar as (select a.doc a, b.doc b, sum(least(a.w, b.w)) w from hdia a join hdia b on b.dia = a.dia and b.veiculo_id = a.veiculo_id and b.doc <> a.doc
            group by 1, 2),
  hparadas as (select y.veiculo_id, pg_catalog.ceil(avg(y.n))::integer cap
                 from (select x.dia, x.veiculo_id, count(*) n from hdia x group by 1, 2) y group by 1),
  fb as (
    select f.documento doc, extract(isodow from f.dia)::integer dow,
           sum(case when f.acao = 'aceita' then pg_catalog.power(0.5, extract(epoch from (pg_catalog.now() - f.registrado_em)) / 86400 / 28) else 0 end) acc,
           sum(case when f.acao = 'ignorada' then pg_catalog.power(0.5, extract(epoch from (pg_catalog.now() - f.registrado_em)) / 86400 / 28) else 0 end) ign
      from public.rota_066_feedback f where f.registrado_em >= pg_catalog.now() - interval '84 days' and f.documento is not null
     group by 1, 2
  ),
  fbcd as (select distinct f.cd_pedido cd, f.dia from public.rota_066_feedback f
            where f.acao = 'ignorada' and f.registrado_em >= pg_catalog.now() - interval '84 days'),
  ped as (   -- pendentes fora da foto de hoje
    select p.cd_pedido cd, p.documento doc, p.dt_pedido, public.rota_066_volume(p.caixas_24, p.caixas_48, p.caixas_outras) vol,
           (ag.s->>'agendado')::boolean agendado,(ag.s->>'data_agendada')::date ag_data,(ag.s->>'data_ancora')::date ag_dia,(ag.s->>'na_bandeja')::boolean ag_bandeja,pl.dia pl_dia, pl.veiculo_id pl_veic, pl.removido pl_rem, m.veiculo m_veic, c.veiculo c_veic, hv.veiculo_id h_veic,
           g.lat, g.lng, coalesce(cl.nome, 'pedido ' || p.cd_pedido) nome
      from public.solidcon_pedidos_erp p
      cross join lateral(select public.rota_068ag_estado(p.cd_pedido) s) ag
      left join public.rota_plano_semana pl on pl.cd_pedido = p.cd_pedido
      left join public.rota_pedido_veiculo m on m.cd_pedido = p.cd_pedido
      left join public.rota_cliente_veiculo c on c.documento = p.documento
      left join hveic hv on hv.doc = p.documento
      left join geo g on g.documento = p.documento
      left join public.solidcon_clientes cl on cl.documento = p.documento
     where (p.etapa in ('aberto', 'na_carga', 'separando', 'separado', 'conferido') or (ag.s->>'agendado')::boolean)
       and public.rota_055_pendente(p.cd_pedido, v_hoje)
       and not exists (select 1 from public.rota_pedido_ignorado i where i.cd_pedido = p.cd_pedido)
       and not exists (select 1 from public.rota_dia_item f where f.data = v_hoje and f.cd_pedido = p.cd_pedido and f.removido_em is null)
  ),
  ped2 as (
    select q.*, public.rota_068_prazo_calcular(q.cd, q.dt_pedido, q.doc, q.veic) prazo
      from (select p.*, case when p.agendado then public.rota_070_veiculo(p.cd) else coalesce(case when p.pl_rem is false and p.pl_dia >= v_hoje then p.pl_veic end, p.m_veic, p.c_veic, p.h_veic,
                                 public.rota_054_padrao_separando()) end veic,
                   (p.m_veic is null and p.c_veic is null and not (p.pl_rem is false and p.pl_dia >= v_hoje)) sem_marcacao
              from ped p) q
  ),
  alvo as (  -- sem programacao valida: sem plano, removido, plano velho, ou plano depois do prazo
    select p.*, (p.pl_rem is false and p.pl_dia >= v_hoje and p.prazo is not null and p.pl_dia > p.prazo) atrasa_plano
      from ped2 p
     where p.agendado or not (p.pl_rem is false and p.pl_dia >= v_hoje and (p.prazo is null or p.pl_dia <= p.prazo))
  ),
  prog as (  -- o que ja esta programado nas celulas e AINDA vale (B066-R1): plano ativo de pedido elegivel (mesmo filtro
             -- de ped: etapa aberto..conferido, pendente 055/063 sem Recebido/canhoto, nao 045, fora da foto de hoje)
    select p.pl_dia dia, p.pl_veic veiculo_id, p.cd, p.doc, p.vol, p.lat, p.lng, p.nome
      from ped p
      join cel c on c.dia = p.pl_dia and c.veiculo_id = p.pl_veic
     where p.pl_rem is false and not p.agendado
    union all
    select p.ag_dia,p.veic,p.cd,p.doc,p.vol,p.lat,p.lng,p.nome from ped2 p where p.agendado and not p.ag_bandeja and p.veic is not null and p.ag_dia between p_semana and p_semana+5
  ),
  dias as (
    select c.dia, c.veiculo_id, c.vnome, c.modo, c.cap,
           coalesce((select sum(x.vol) from prog x where x.dia = c.dia and x.veiculo_id = c.veiculo_id), 0) vol,
           (select count(distinct coalesce(x.doc, x.cd::text)) from prog x where x.dia = c.dia and x.veiculo_id = c.veiculo_id) n_doc,
           case when c.modo = 'cd_ceasa' then null else hp.cap end paradas_max
      from cel c left join hparadas hp on hp.veiculo_id = c.veiculo_id
  ),
  dias2 as (
    select d.*, case when d.modo = 'cd_ceasa' then least(d.n_doc, 1) else d.n_doc end paradas from dias d
  ),
  cand as (
    select a.cd, c.dia, c.veiculo_id, (a.prazo is not null and c.dia > a.prazo) late
      from alvo a join cel c on c.veiculo_id = a.veic
     where (not a.agendado or c.dia=a.ag_dia) and not (a.pl_rem is true and c.dia = a.pl_dia)                  -- tirado deste dia: nao sugere de volta
  ),
  lim as (select k.cd, max(k.dia) filter (where not k.late) dia_base, min(k.dia) primeiro from cand k group by k.cd),
  cand2 as (
    select k.cd, k.dia, k.veiculo_id, l.dia_base from cand k join lim l on l.cd = k.cd
     where (l.dia_base is not null and not k.late) or (l.dia_base is null and k.dia = l.primeiro) or exists(select 1 from alvo a join prog x on x.dia=k.dia and x.veiculo_id=k.veiculo_id join ped2 ax on ax.cd=x.cd and ax.agendado join dias2 dd on dd.dia=k.dia and dd.veiculo_id=k.veiculo_id where a.cd=k.cd and a.cd<>x.cd and public.rota_066_km(a.lat,a.lng,x.lat,x.lng)<=5 and (dd.cap is null or (a.vol is not null and dd.vol+a.vol<=dd.cap)))
  ),
  pont as (
    select k.cd, k.dia, k.veiculo_id, k.dia_base,anc.cd ag_cd,anc.nome ag_nome,anc.km ag_km,(case when anc.km<=5 then 60 else 0 end) s_ag,
           (case when k.dia_base is null then 100 + least(30, greatest(0, k.dia - coalesce(a.prazo, k.dia)) * 5)
                 else 40 - 3 * (k.dia_base - k.dia) end)::double precision s_prazo,
           rg.km rg_km, rg.nome rg_nome,
           case when rg.km is not null and rg.km <= 3 then 25 * (1 - rg.km / 3) else 0 end s_reg,
           case when t.w > 0 then 15 * coalesce(hd.w, 0) / t.w else 0 end s_dow,
           least(20, 10 * coalesce(jt.w, 0)) s_junto, jt.nome junto_nome,
           (8 * coalesce(f.acc, 0) - 15 * coalesce(f.ign, 0) - case when fc.cd is not null then 30 else 0 end)::double precision s_fb,
           (case when dd.cap is not null and a.vol is not null and dd.vol + case when a.agendado then 0 else a.vol end > dd.cap then -60 else 0 end
            + case when dd.paradas_max is not null and dd.paradas_max < dd.paradas
                        + case when exists (select 1 from prog x where x.dia = k.dia and x.veiculo_id = k.veiculo_id and x.doc = a.doc) then 0 else 1 end
                   then -40 else 0 end)::double precision s_cap
      from cand2 k
      join alvo a on a.cd = k.cd
      join dias2 dd on dd.dia = k.dia and dd.veiculo_id = k.veiculo_id
      left join htot t on t.doc = a.doc
      left join hdow hd on hd.doc = a.doc and hd.dow = extract(isodow from k.dia)::integer
      left join fb f on f.doc = a.doc and f.dow = extract(isodow from k.dia)::integer
      left join fbcd fc on fc.cd = k.cd and fc.dia = k.dia
      left join lateral (select x.nome, public.rota_066_km(a.lat, a.lng, x.lat, x.lng) km from prog x
                          where x.dia = k.dia and x.veiculo_id = k.veiculo_id and x.cd <> k.cd and a.lat is not null and x.lat is not null
                          order by 2, x.cd limit 1) rg on true
      left join lateral (select sum(hp.w) w, (pg_catalog.array_agg(x.nome order by hp.w desc, x.cd))[1] nome
                           from prog x join hpar hp on hp.a = a.doc and hp.b = x.doc
                          where x.dia = k.dia and x.veiculo_id = k.veiculo_id) jt on true
      left join lateral(select x.cd,x.nome,public.rota_066_km(a.lat,a.lng,x.lat,x.lng) km from prog x join ped2 ap on ap.cd=x.cd and ap.agendado where x.dia=k.dia and x.veiculo_id=k.veiculo_id and x.cd<>a.cd order by 3,x.cd limit 1) anc on true
  ),
  melhor as (
    select distinct on (p.cd) p.*, p.s_prazo + p.s_reg + p.s_dow + p.s_junto + p.s_fb + p.s_cap + p.s_ag total
      from pont p order by p.cd, p.s_prazo + p.s_reg + p.s_dow + p.s_junto + p.s_fb + p.s_cap + p.s_ag desc, p.dia desc
  ),
  saida_ped as (
    -- B066-R2: faixas que os pesos nao atravessam. Sem dia no prazo (vencido / vence hoje / sem saida ate la) = 100+;
    -- os demais ficam em ate 99. Capacidade/feedback so avisam (motivo) e escolhem dia dentro da faixa.
    select a.cd, a.prazo,case when a.agendado then a.ag_dia else m.dia end dia,case when a.agendado then a.veic else m.veiculo_id end veiculo_id,a.agendado,a.ag_data,a.ag_dia,m.ag_cd,m.ag_nome,m.ag_km,
           case when a.agendado then 10000 when m.cd is null then null
                when m.dia_base is null then m.s_prazo + greatest(0, m.total - m.s_prazo)   -- >= 100, mais atraso = maior
                else least(99, m.total) end total,
           pg_catalog.array_remove(array[
             case when m.cd is null then 'sem_dia_de_saida'
                  when a.prazo is null then 'sem_prazo'
                  when m.dia_base is not null then 'prazo'
                  when a.prazo < v_hoje then 'vencido'
                  when a.prazo = v_hoje then 'vence_hoje'
                  else 'atrasa' end,
             case when a.atrasa_plano then 'atrasa_no_plano' end,
             case when m.s_reg > 0 then 'mesma_regiao' end,
             case when m.s_dow >= 6 then 'costuma_dia' end,
             case when m.s_junto > 0 then 'costuma_junto' end,
             case when m.s_fb < 0 then 'feedback_ignorado' end,
             case when m.s_fb > 0 then 'feedback_aceito' end,
             case when m.s_cap < 0 then 'sem_capacidade' end,
             case when a.lat is null then 'sem_geo' end,
             case when a.sem_marcacao then 'sem_marcacao' end], null) motivo,
           (case when a.atrasa_plano then 'Programado ' || public.rota_066_dia_txt(a.pl_dia, p_semana) || ' atrasa. ' else '' end
            || case when m.cd is null then 'Sem saída do ' || coalesce((select coalesce(v.nome, v.id) from public.rota_veiculos v where v.id = a.veic), a.veic) || ' nesta semana'
                    when a.prazo is null then 'Sugerido ' || public.rota_066_dia_txt(m.dia, p_semana)
                    when a.prazo < v_hoje then 'Venceu ' || public.rota_066_dia_txt(a.prazo, p_semana) || ' — primeiro dia livre ' || public.rota_066_dia_txt(m.dia, p_semana)
                    when a.prazo = v_hoje then 'Vence hoje — primeiro dia livre ' || public.rota_066_dia_txt(m.dia, p_semana)
                    when m.dia_base is null then 'Vence ' || public.rota_066_dia_txt(a.prazo, p_semana) || ' sem saída até lá — primeiro dia ' || public.rota_066_dia_txt(m.dia, p_semana)
                    else 'Vence ' || public.rota_066_dia_txt(a.prazo, p_semana) || ' — sugerido ' || public.rota_066_dia_txt(m.dia, p_semana) end
            || case when m.cd is null then ''
                    when m.s_reg > 0 then ' (mesma região de ' || m.rg_nome || ')'
                    when m.s_dow >= 6 and m.s_junto > 0 then ' (costuma ir às ' || (array['segundas','terças','quartas','quintas','sextas','sábados'])[extract(isodow from m.dia)::integer] || ' com ' || m.junto_nome || ')'
                    when m.s_junto > 0 then ' (costuma ir com ' || m.junto_nome || ')'
                    when m.s_dow >= 6 then ' (costuma ir às ' || (array['segundas','terças','quartas','quintas','sextas','sábados'])[extract(isodow from m.dia)::integer] || ')'
                    when m.s_cap < 0 then ' (passa da capacidade)'
                    else '' end) texto,
           a.pl_dia, a.pl_rem
      from alvo a left join melhor m on m.cd = a.cd
  ),
  enc as (
    select dd.dia, dd.veiculo_id, dd.vnome, dd.cap, dd.vol dvol, a.cd,a.agendado,a.ag_data,a.ag_dia,(public.rota_068ag_estado(n.cd)->>'agendado')::boolean perto_agendado,n.km,n.cd perto_cd,n.nome perto_nome,
           pg_catalog.row_number() over (partition by dd.dia, dd.veiculo_id order by n.km, a.cd) rk
      from dias2 dd
      join alvo a on a.veic = dd.veiculo_id and not a.atrasa_plano and a.lat is not null
                 and (not a.agendado or dd.dia=a.ag_dia) and (a.prazo is null or dd.dia<=a.prazo or exists(select 1 from prog ax join ped2 ap on ap.cd=ax.cd and ap.agendado where ax.dia=dd.dia and ax.veiculo_id=dd.veiculo_id and ax.cd<>a.cd and public.rota_066_km(a.lat,a.lng,ax.lat,ax.lng)<=5))
                 and not (a.pl_rem is true and a.pl_dia = dd.dia)
      cross join lateral (select x.cd, x.nome, public.rota_066_km(a.lat, a.lng, x.lat, x.lng) km from prog x
                           where x.dia = dd.dia and x.veiculo_id = dd.veiculo_id and x.cd<>a.cd and x.lat is not null order by 3, x.cd limit 1) n
     where n.km <= 5
       and (dd.cap is null or a.vol is null or dd.vol + a.vol <= dd.cap)
       and (dd.paradas_max is null or dd.paradas < dd.paradas_max)
  )
  select pg_catalog.jsonb_build_object(
    'status', 'ok', 'semana', p_semana, 'hoje', v_hoje,
    'versao', coalesce((select s.versao from public.rota_065_semana s where s.inicio = p_semana), 0),
    'pedidos', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'cd_pedido', s.cd, 'dia_sugerido', s.dia, 'veiculo_sugerido', s.veiculo_id, 'motivo', pg_catalog.to_jsonb(s.motivo),
                   'agendado',s.agendado,'data_agendada',s.ag_data,'data_ancora',s.ag_dia,'prioridade_maxima',s.agendado,'ancora_cd',case when not ('sem_capacidade'=any(s.motivo)) then s.ag_cd end,'ancora_nome',s.ag_nome,'ancora_km',case when not ('sem_capacidade'=any(s.motivo)) and s.ag_km<=5 then s.ag_km end,'texto', s.texto, 'score', round(coalesce(s.total, 0)::numeric, 1), 'prazo', s.prazo,
                   'atrasado_se_dia', s.prazo + 1,
                   'dia_plano', case when s.pl_rem is false and s.pl_dia >= v_hoje then s.pl_dia end)
                 order by coalesce(s.total, -1000) desc, s.cd) from saida_ped s), '[]'::jsonb),
    'dias', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'dia', d.dia, 'veiculo_id', d.veiculo_id, 'cx_planejadas', round(d.vol / 9, 1),
                 'cx_capacidade', round(d.cap / 9, 1), 'paradas', d.paradas,
                 'folga_cx', round((d.cap - d.vol) / 9, 1), 'paradas_max', d.paradas_max,
                 'folga_paradas', d.paradas_max - d.paradas)
               order by d.dia, d.veiculo_id) from dias2 d), '[]'::jsonb),
    'encaixes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'dia', e.dia, 'veiculo_id', e.veiculo_id, 'cd_pedido', e.cd, 'distancia_km', round(e.km::numeric, 1),
                 'perto_de_cd',e.perto_cd,'agendado',e.agendado,'data_agendada',e.ag_data,'data_ancora',e.ag_dia,'prioridade_maxima',e.agendado,'ancora_cd',case when e.perto_agendado then e.perto_cd end,'ancora_nome',case when e.perto_agendado then e.perto_nome end,'ancora_km',case when e.perto_agendado then round(e.km::numeric,1) end,'alerta_forte',e.agendado and e.dia is distinct from e.ag_data,
                 'texto',case when e.perto_agendado then 'Agendado '||e.dia||' p/ '||e.perto_nome||' - Pedido '||e.cd||' a '||replace(round(e.km::numeric,1)::text,'.',',')||' km, encaixa nesta data. ' else '' end || e.vnome || case when e.cap is null then ' sem limite de cx na ' || public.rota_066_dia_txt(e.dia, p_semana)
                                         else ' tem ' || round((e.cap - e.dvol) / 9) || ' cx livres na ' || public.rota_066_dia_txt(e.dia, p_semana) end
                          || ': cabe Pedido ' || e.cd || ' (' || pg_catalog.replace(round(e.km::numeric, 1)::text, '.', ',') || ' km de ' || e.perto_nome || ')')
               order by e.dia, e.veiculo_id, e.rk) from enc e where e.rk <= 3), '[]'::jsonb))
    into v_res;
  return public.rota_068ag_sugestoes_formato(v_res,p_semana);
end;
$function$;
revoke all on function public.rota_068ag_estado(bigint),public.rota_068ag_data(bigint),public.rota_068ag_no_dia(bigint,date),public.rota_068ag_manual_registrar(bigint,date),public.rota_068ag_plano_manual(),public.rota_068ag_estado_base(bigint),public.rota_068ag_sugestoes_formato(jsonb,date),public.rota_068ag_agendados_ler(bigint[]) from public,anon,authenticated,service_role;
grant execute on function public.rota_068ag_agendados_ler(bigint[]) to authenticated,service_role;
notify pgrst,'reload schema';commit;
