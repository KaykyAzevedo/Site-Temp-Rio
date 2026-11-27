from pathlib import Path
R=Path(__file__).resolve().parents[2]
s='\n'.join(l for l in (R/'evidencias/066-base-V.sql').read_text(encoding='utf-8').splitlines() if l.strip())+'\n'
def rep(a,b):
 global s
 assert s.count(a)==1,(a[:80],s.count(a));s=s.replace(a,b)
rep('pl.dia pl_dia, pl.veiculo_id',"(ag.s->>'agendado')::boolean agendado,(ag.s->>'data_agendada')::date ag_data,(ag.s->>'data_ancora')::date ag_dia,(ag.s->>'na_bandeja')::boolean ag_bandeja,pl.dia pl_dia, pl.veiculo_id")
rep('left join public.rota_plano_semana pl on pl.cd_pedido = p.cd_pedido',"cross join lateral(select public.rota_068ag_estado(p.cd_pedido) s) ag\n      left join public.rota_plano_semana pl on pl.cd_pedido = p.cd_pedido")
rep("where p.etapa in ('aberto', 'na_carga', 'separando', 'separado', 'conferido')", "where (p.etapa in ('aberto', 'na_carga', 'separando', 'separado', 'conferido') or (ag.s->>'agendado')::boolean)")
rep('select p.*, coalesce(case when p.pl_rem','select p.*, case when p.agendado then public.rota_070_veiculo(p.cd) else coalesce(case when p.pl_rem')
rep('public.rota_054_padrao_separando()) veic,','public.rota_054_padrao_separando()) end veic,')
rep('where not (p.pl_rem is false and p.pl_dia >= v_hoje and (p.prazo is null or p.pl_dia <= p.prazo))','where p.agendado or not (p.pl_rem is false and p.pl_dia >= v_hoje and (p.prazo is null or p.pl_dia <= p.prazo))')
rep('where p.pl_rem is false\n  ),\n  dias as',"where p.pl_rem is false and not p.agendado\n    union all\n    select p.ag_dia,p.veic,p.cd,p.doc,p.vol,p.lat,p.lng,p.nome from ped2 p where p.agendado and not p.ag_bandeja and p.veic is not null and p.ag_dia between p_semana and p_semana+5\n  ),\n  dias as")
rep('where not (a.pl_rem is true and c.dia = a.pl_dia)','where (not a.agendado or c.dia=a.ag_dia) and not (a.pl_rem is true and c.dia = a.pl_dia)')
rep('where (l.dia_base is not null and not k.late) or (l.dia_base is null and k.dia = l.primeiro)',"where (l.dia_base is not null and not k.late) or (l.dia_base is null and k.dia = l.primeiro) or exists(select 1 from alvo a join prog x on x.dia=k.dia and x.veiculo_id=k.veiculo_id join ped2 ax on ax.cd=x.cd and ax.agendado join dias2 dd on dd.dia=k.dia and dd.veiculo_id=k.veiculo_id where a.cd=k.cd and a.cd<>x.cd and public.rota_066_km(a.lat,a.lng,x.lat,x.lng)<=5 and (dd.cap is null or (a.vol is not null and dd.vol+a.vol<=dd.cap)))")
rep('select k.cd, k.dia, k.veiculo_id, k.dia_base,','select k.cd, k.dia, k.veiculo_id, k.dia_base,anc.cd ag_cd,anc.nome ag_nome,anc.km ag_km,(case when anc.km<=5 then 60 else 0 end) s_ag,')
rep('dd.vol + a.vol > dd.cap','dd.vol + case when a.agendado then 0 else a.vol end > dd.cap')
rep('  ),\n  melhor as (',"      left join lateral(select x.cd,x.nome,public.rota_066_km(a.lat,a.lng,x.lat,x.lng) km from prog x join ped2 ap on ap.cd=x.cd and ap.agendado where x.dia=k.dia and x.veiculo_id=k.veiculo_id and x.cd<>a.cd order by 3,x.cd limit 1) anc on true\n  ),\n  melhor as (")
s=s.replace('p.s_fb + p.s_cap','p.s_fb + p.s_cap + p.s_ag')
rep('select a.cd, a.prazo, m.dia, m.veiculo_id,','select a.cd, a.prazo,case when a.agendado then a.ag_dia else m.dia end dia,case when a.agendado then a.veic else m.veiculo_id end veiculo_id,a.agendado,a.ag_data,a.ag_dia,m.ag_cd,m.ag_nome,m.ag_km,')
rep('case when m.cd is null then null\n                when m.dia_base','case when a.agendado then 10000 when m.cd is null then null\n                when m.dia_base')
rep("'texto', s.texto, 'score'","'agendado',s.agendado,'data_agendada',s.ag_data,'data_ancora',s.ag_dia,'prioridade_maxima',s.agendado,'ancora_cd',case when not ('sem_capacidade'=any(s.motivo)) then s.ag_cd end,'ancora_nome',s.ag_nome,'ancora_km',case when not ('sem_capacidade'=any(s.motivo)) and s.ag_km<=5 then s.ag_km end,'texto', s.texto, 'score'")
rep('dd.vol dvol, a.cd, n.km, n.cd perto_cd, n.nome perto_nome,',"dd.vol dvol, a.cd,a.agendado,a.ag_data,a.ag_dia,(public.rota_068ag_estado(n.cd)->>'agendado')::boolean perto_agendado,n.km,n.cd perto_cd,n.nome perto_nome,")
rep('and (a.prazo is null or dd.dia <= a.prazo)',"and (not a.agendado or dd.dia=a.ag_dia) and (a.prazo is null or dd.dia<=a.prazo or exists(select 1 from prog ax join ped2 ap on ap.cd=ax.cd and ap.agendado where ax.dia=dd.dia and ax.veiculo_id=dd.veiculo_id and ax.cd<>a.cd and public.rota_066_km(a.lat,a.lng,ax.lat,ax.lng)<=5))")
rep('where x.dia = dd.dia and x.veiculo_id = dd.veiculo_id and x.lat is not null','where x.dia = dd.dia and x.veiculo_id = dd.veiculo_id and x.cd<>a.cd and x.lat is not null')
rep("'perto_de_cd', e.perto_cd,","'perto_de_cd',e.perto_cd,'agendado',e.agendado,'data_agendada',e.ag_data,'data_ancora',e.ag_dia,'prioridade_maxima',e.agendado,'ancora_cd',case when e.perto_agendado then e.perto_cd end,'ancora_nome',case when e.perto_agendado then e.perto_nome end,'ancora_km',case when e.perto_agendado then round(e.km::numeric,1) end,'alerta_forte',e.agendado and e.dia is distinct from e.ag_data,")
rep("'texto', e.vnome || case", "'texto',case when e.perto_agendado then 'Agendado '||e.dia||' p/ '||e.perto_nome||' - Pedido '||e.cd||' a '||replace(round(e.km::numeric,1)::text,'.',',')||' km, encaixa nesta data. ' else '' end || e.vnome || case")
rep('  return v_res;','  return public.rota_068ag_sugestoes_formato(v_res,p_semana);')
(R/'evidencias/066-candidato-AG.sql').write_text(s,encoding='utf-8')
header=(R/'evidencias/AG-base-parte.sql').read_text(encoding='utf-8')
fmt=(R/'evidencias/AG-formato-parte.sql').read_text(encoding='utf-8')
acl="""revoke all on function public.rota_068ag_estado(bigint),public.rota_068ag_data(bigint),public.rota_068ag_no_dia(bigint,date),public.rota_068ag_manual_registrar(bigint,date),public.rota_068ag_plano_manual(),public.rota_068ag_estado_base(bigint),public.rota_068ag_sugestoes_formato(jsonb,date),public.rota_068ag_agendados_ler(bigint[]) from public,anon,authenticated,service_role;
grant execute on function public.rota_068ag_agendados_ler(bigint[]) to authenticated,service_role;
notify pgrst,'reload schema';commit;
"""
(R/'admin/migracoes/068_ag_agendado_prioridade.sql').write_text(header+'\n'+fmt+'\n'+s.rstrip().rstrip(';')+';\n'+acl,encoding='utf-8');print('066 transformada eSQLAG completo')
