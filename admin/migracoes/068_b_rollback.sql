-- 068 B rollback idempotente. Preserva dados (rota_068_prazo_cliente, rota_068_prazo_pedido, rota_068_prazo_log);
-- remove RPCs/auxiliares da 068 B e restaura rota_066_sugestoes(date) ao corpo exato da 066.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

select pg_catalog.pg_advisory_xact_lock(5100, 6802);

do $$
begin
  if to_regprocedure('cron.unschedule(bigint)') is not null and to_regclass('cron.job') is not null then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'rota-068-prazo-limpeza';
  end if;
end;
$$;

-- Restaura rota_066_sugestoes(date) ao corpo exato da 066 (somente se a 066 ainda estiver instalada).
do $$
begin
  if to_regprocedure('public.rota_066_prazo(timestamptz,text)') is not null
     and to_regprocedure('public.rota_066_sugestoes(date)') is not null then
    execute $fn$
create or replace function public.rota_066_sugestoes(p_semana date)
returns jsonb
language plpgsql
stable
security definer   -- le tabelas sem grant (memoria/feedback) e funcoes privadas; acesso conferido abaixo
set search_path = ''
as $body$
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
      from public.rota_066_historico h
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
           pl.dia pl_dia, pl.veiculo_id pl_veic, pl.removido pl_rem, m.veiculo m_veic, c.veiculo c_veic, hv.veiculo_id h_veic,
           g.lat, g.lng, coalesce(cl.nome, 'pedido ' || p.cd_pedido) nome
      from public.solidcon_pedidos_erp p
      left join public.rota_plano_semana pl on pl.cd_pedido = p.cd_pedido
      left join public.rota_pedido_veiculo m on m.cd_pedido = p.cd_pedido
      left join public.rota_cliente_veiculo c on c.documento = p.documento
      left join hveic hv on hv.doc = p.documento
      left join geo g on g.documento = p.documento
      left join public.solidcon_clientes cl on cl.documento = p.documento
     where p.etapa in ('aberto', 'na_carga', 'separando', 'separado', 'conferido')
       and public.rota_055_pendente(p.cd_pedido, v_hoje)
       and not exists (select 1 from public.rota_pedido_ignorado i where i.cd_pedido = p.cd_pedido)
       and not exists (select 1 from public.rota_dia_item f where f.data = v_hoje and f.cd_pedido = p.cd_pedido and f.removido_em is null)
  ),
  ped2 as (
    select q.*, public.rota_066_prazo(q.dt_pedido, q.veic) prazo
      from (select p.*, coalesce(case when p.pl_rem is false and p.pl_dia >= v_hoje then p.pl_veic end, p.m_veic, p.c_veic, p.h_veic,
                                 public.rota_054_padrao_separando()) veic,
                   (p.m_veic is null and p.c_veic is null and not (p.pl_rem is false and p.pl_dia >= v_hoje)) sem_marcacao
              from ped p) q
  ),
  alvo as (  -- sem programacao valida: sem plano, removido, plano velho, ou plano depois do prazo
    select p.*, (p.pl_rem is false and p.pl_dia >= v_hoje and p.prazo is not null and p.pl_dia > p.prazo) atrasa_plano
      from ped2 p
     where not (p.pl_rem is false and p.pl_dia >= v_hoje and (p.prazo is null or p.pl_dia <= p.prazo))
  ),
  prog as (  -- o que ja esta programado nas celulas e AINDA vale (B066-R1): plano ativo de pedido elegivel (mesmo filtro
             -- de ped: etapa aberto..conferido, pendente 055/063 sem Recebido/canhoto, nao 045, fora da foto de hoje)
    select p.pl_dia dia, p.pl_veic veiculo_id, p.cd, p.doc, p.vol, p.lat, p.lng, p.nome
      from ped p
      join cel c on c.dia = p.pl_dia and c.veiculo_id = p.pl_veic
     where p.pl_rem is false
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
     where not (a.pl_rem is true and c.dia = a.pl_dia)                  -- tirado deste dia: nao sugere de volta
  ),
  lim as (select k.cd, max(k.dia) filter (where not k.late) dia_base, min(k.dia) primeiro from cand k group by k.cd),
  cand2 as (
    select k.cd, k.dia, k.veiculo_id, l.dia_base from cand k join lim l on l.cd = k.cd
     where (l.dia_base is not null and not k.late) or (l.dia_base is null and k.dia = l.primeiro)
  ),
  pont as (
    select k.cd, k.dia, k.veiculo_id, k.dia_base,
           (case when k.dia_base is null then 100 + least(30, greatest(0, k.dia - coalesce(a.prazo, k.dia)) * 5)
                 else 40 - 3 * (k.dia_base - k.dia) end)::double precision s_prazo,
           rg.km rg_km, rg.nome rg_nome,
           case when rg.km is not null and rg.km <= 3 then 25 * (1 - rg.km / 3) else 0 end s_reg,
           case when t.w > 0 then 15 * coalesce(hd.w, 0) / t.w else 0 end s_dow,
           least(20, 10 * coalesce(jt.w, 0)) s_junto, jt.nome junto_nome,
           (8 * coalesce(f.acc, 0) - 15 * coalesce(f.ign, 0) - case when fc.cd is not null then 30 else 0 end)::double precision s_fb,
           (case when dd.cap is not null and a.vol is not null and dd.vol + a.vol > dd.cap then -60 else 0 end
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
  ),
  melhor as (
    select distinct on (p.cd) p.*, p.s_prazo + p.s_reg + p.s_dow + p.s_junto + p.s_fb + p.s_cap total
      from pont p order by p.cd, p.s_prazo + p.s_reg + p.s_dow + p.s_junto + p.s_fb + p.s_cap desc, p.dia desc
  ),
  saida_ped as (
    -- B066-R2: faixas que os pesos nao atravessam. Sem dia no prazo (vencido / vence hoje / sem saida ate la) = 100+;
    -- os demais ficam em ate 99. Capacidade/feedback so avisam (motivo) e escolhem dia dentro da faixa.
    select a.cd, a.prazo, m.dia, m.veiculo_id,
           case when m.cd is null then null
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
    select dd.dia, dd.veiculo_id, dd.vnome, dd.cap, dd.vol dvol, a.cd, n.km, n.cd perto_cd, n.nome perto_nome,
           pg_catalog.row_number() over (partition by dd.dia, dd.veiculo_id order by n.km, a.cd) rk
      from dias2 dd
      join alvo a on a.veic = dd.veiculo_id and not a.atrasa_plano and a.lat is not null
                 and (a.prazo is null or dd.dia <= a.prazo)
                 and not (a.pl_rem is true and a.pl_dia = dd.dia)
      cross join lateral (select x.cd, x.nome, public.rota_066_km(a.lat, a.lng, x.lat, x.lng) km from prog x
                           where x.dia = dd.dia and x.veiculo_id = dd.veiculo_id and x.lat is not null order by 3, x.cd limit 1) n
     where n.km <= 5
       and (dd.cap is null or a.vol is null or dd.vol + a.vol <= dd.cap)
       and (dd.paradas_max is null or dd.paradas < dd.paradas_max)
  )
  select pg_catalog.jsonb_build_object(
    'status', 'ok', 'semana', p_semana, 'hoje', v_hoje,
    'versao', coalesce((select s.versao from public.rota_065_semana s where s.inicio = p_semana), 0),
    'pedidos', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'cd_pedido', s.cd, 'dia_sugerido', s.dia, 'veiculo_sugerido', s.veiculo_id, 'motivo', pg_catalog.to_jsonb(s.motivo),
                   'texto', s.texto, 'score', round(coalesce(s.total, 0)::numeric, 1), 'prazo', s.prazo,
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
                 'perto_de_cd', e.perto_cd,
                 'texto', e.vnome || case when e.cap is null then ' sem limite de cx na ' || public.rota_066_dia_txt(e.dia, p_semana)
                                         else ' tem ' || round((e.cap - e.dvol) / 9) || ' cx livres na ' || public.rota_066_dia_txt(e.dia, p_semana) end
                          || ': cabe Pedido ' || e.cd || ' (' || pg_catalog.replace(round(e.km::numeric, 1)::text, '.', ',') || ' km de ' || e.perto_nome || ')')
               order by e.dia, e.veiculo_id, e.rk) from enc e where e.rk <= 3), '[]'::jsonb))
    into v_res;
  return v_res;
end;
$body$;
$fn$;
    revoke all on function public.rota_066_sugestoes(date) from public, anon, authenticated;
    grant execute on function public.rota_066_sugestoes(date) to authenticated;
  end if;
end;
$$;

drop trigger if exists rota_068_config_prazo_guardar on public.rota_config;
drop trigger if exists rota_068_config_prazo_logar on public.rota_config;
drop function if exists public.rota_068_config_prazo_guardar();
drop function if exists public.rota_068_config_prazo_logar();
drop function if exists public.rota_068_calendario_veiculo(text, date, date);
drop function if exists public.rota_068_prazo_padrao_salvar(integer, integer[]);
drop function if exists public.rota_068_prazo_padrao_salvar(integer);
drop function if exists public.rota_068_prazo_padrao_ler();
drop function if exists public.rota_068_prazo_salvar(bigint, text, integer, date, text, text, integer[]);
drop function if exists public.rota_068_prazo_remover_regra(text, text);
drop function if exists public.rota_068_prazo_remover_excecao(bigint, text);
drop function if exists public.rota_068_prazo_ler(bigint[]);
drop function if exists public.rota_068_regras_prazo();
drop function if exists public.rota_068_prazo_limpar();
drop function if exists public.rota_068_prazo_travado(bigint);
drop function if exists public.rota_068_prazo_entregue(bigint);
drop function if exists public.rota_068_prazo_padrao_dias();
drop function if exists public.rota_068_prazo_calcular(bigint, timestamptz, text, text);
drop function if exists public.rota_068_veiculo_efetivo(bigint, text);
drop function if exists public.rota_068_proximo_dia_semana(timestamptz, text, smallint[]);
drop function if exists public.rota_068_somar_dias_uteis(timestamptz, text, integer);
drop function if exists public.rota_068_eh_dia_util_prazo(date);
drop function if exists public.rota_068_prazo_dias_uteis_semana();
drop function if exists public.rota_068_eh_feriado(date);
drop function if exists public.rota_068_prazo_hoje();

notify pgrst, 'reload schema';
commit;
