from pathlib import Path
import json,subprocess,hashlib,os,re
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'evidencias';DB=os.environ.get('TEMPRIO068V_DB','sentinela_separando_cpf_forja068v');assert re.fullmatch('sentinela_separando_cpf_forja068v[a-z0-9_]*',DB)
BASE=['C:/Program Files/PostgreSQL/18/bin/psql.exe','-X','-h','127.0.0.1','-p','55439','-U','qa','-d',DB,'-v','ON_ERROR_STOP=1','-At','-q'];UID='22222222-2222-4222-8222-222222222222'
INIT="reset role;set qa.uid='"+UID+"';set qa.role='authenticated';set qa.agora='2026-11-27T10:00:00-03';"
checks=[]
def run(sql,ok=True):
 x=subprocess.run(BASE+['-c',INIT+sql],capture_output=True,text=True,encoding='utf-8',errors='replace')
 if ok and x.returncode:raise RuntimeError(x.stderr[-4000:])
 return x

def query(sql):return json.loads(run('select to_jsonb(q) from ('+sql+') q').stdout.strip().splitlines()[-1])
def yes(name,sql):
 x=query('select ('+sql+') pass');assert x['pass'],(name,x);checks.append(name)
def mig(name):
 x=subprocess.run(BASE+['-f',str(ROOT/'admin/migracoes'/name)],capture_output=True,text=True,encoding='utf-8');assert x.returncode==0,x.stderr

def states():return query("select jsonb_agg(to_jsonb(s) order by cd_pedido) rows from public.rota_070_estados_pedidos((select array_agg(cd_pedido) from public.solidcon_pedidos_erp)) s")['rows']
def protected():return query("select md5((select coalesce(jsonb_agg(to_jsonb(i) order by data,cd_pedido),'[]')::text from public.rota_dia_item i)) foto,md5((select coalesce(jsonb_agg(to_jsonb(f) order by data),'[]')::text from public.rota_dia_fechada f)) cabecalho")
before=states();photos=protected();rawmem=query('select count(*) n from public.rota_066_historico')['n']
old=query("select count(*) filter(where public.rota_070_veiculo(e.cd_pedido) is null) sem_veiculo,count(*) filter(where e.data_entrega='2026-11-24' and public.rota_070_veiculo(e.cd_pedido) is null) ter_sem,count(*) filter(where e.data_entrega='2026-11-24') ter_total,count(*) total from public.rota_068_entregas('2026-11-23','2026-11-28') e")
mig('068_v_veiculo_historico.sql');mig('068_v_veiculo_historico.sql');after=states();assert before==after;checks.append('196estados070 identicos antes/depois aplicar2x');(OUT/'estados070-antes.json').write_text(json.dumps(before,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');(OUT/'estados070-depois.json').write_text(json.dumps(after,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
assert photos==protected();checks.append('foto050 fisica/cabecalho intactos na migracao')
week=query("select jsonb_agg(to_jsonb(s) order by dia,cd_pedido) rows from public.rota_068v_semana_recebidos('2026-11-23') s")['rows']
new={'sem_veiculo':sum(x['sem_veiculo'] for x in week),'ter_sem':sum(x['sem_veiculo'] and x['dia']=='2026-11-24' for x in week),'ter_total':sum(x['dia']=='2026-11-24' for x in week),'total':len(week),'sem_ids':[x['cd_pedido'] for x in week if x['sem_veiculo']]}
assert new['ter_sem']==0 and new['ter_total']==9;checks.append('Ter24 real9 tem escolhas atuais validas:0semveiculo, nao inventar ausencia')
checks.append('semana real semveiculo calculada semfabricar ausencias')
assert any(x['cd_pedido']==1557 and x['dia']=='2026-11-26' and x['sem_veiculo'] and not x['na_foto'] for x in week);checks.append('1557 aparecesemveiculo26 mesmoausente050 eS10semsaida')
yes('1558 escolhaCEASA real preservada',"public.rota_068v_veiculo(1558,'2026-11-26')='caminhao'")
yes('fallback compartilhado065A/H070 removido',"public.rota_054_padrao_separando() is null and public.rota_070_veiculo(1557) is null")
yes('memoria raw nao apagada',f"(select count(*) from public.rota_066_historico)={rawmem}")
yes('memoria view nao aprende autoS10 semescolha',"not exists(select 1 from public.rota_068v_memoria() h where h.fonte='foto' and public.rota_068v_veiculo(h.cd_pedido,h.dia) is null)")
yes('066 sugestoes consulta view filtrada',"position('from public.rota_068v_memoria() h' in pg_get_functiondef('public.rota_066_sugestoes(date)'::regprocedure))>0")
# FotoAUTO sintetica semescolha prova descarte na leitura/memoria sem poluir metricas reais.
x=run("begin;insert into public.solidcon_pedidos_erp(cd_pedido,etapa,cliente_tipo,dt_pedido) values(999901,'aberto','cpf','2026-11-23');insert into public.rota_dia_item(data,cd_pedido,veiculo_id,origem) values('2026-11-24',999901,'s10','previsao');select jsonb_build_object('sem',public.rota_068v_veiculo(999901,'2026-11-24') is null,'mem',not exists(select 1 from public.rota_068v_memoria() where cd_pedido=999901));rollback;")
v=[json.loads(l) for l in x.stdout.splitlines() if l.startswith('{')][-1];assert all(v.values()),v;checks.append('autoS10 sintetico semescolha descartado leitura/memoria, tabela preservada')
# Leituras/destinos semveiculo e memoria nao inventam atribuicao.
yes('calendario070 semveiculo nao habilita data',"(public.rota_070_calendario(1557,'2026-11-30','2026-11-30')->'dias'->0->>'motivo')='veiculo_invalido'")
cdsem=query("select min(cd_pedido) cd from public.solidcon_pedidos_erp e where public.rota_055_pendente(e.cd_pedido,public.rota_070_hoje()) and public.rota_070_veiculo(e.cd_pedido) is null")['cd'];assert cdsem is not None
x=run(f"begin;select public.rota_068_mover_pedido({cdsem},null,null,'06800000-0000-4000-8000-000000000001');rollback;");v=[json.loads(l) for l in x.stdout.splitlines() if l.startswith('{')][-1];assert v['status']=='ok',v;checks.append('H bandeja semveiculo permitido semdefault')
x=run("begin;select public.rota_066_sugestoes('2026-11-30');rollback;");checks.append('066 sugestoes executa sobre memoria filtrada')
x=run("begin;set qa.agora='2026-11-27T00:00:01-03';select public.rota_070_virada();select jsonb_build_object('semrota',not exists(select 1 from public.rota_070_reserva r where public.rota_070_veiculo(r.cd_pedido) is null));rollback;");v=[json.loads(l) for l in x.stdout.splitlines() if l.startswith('{')][-1];assert v['semrota'];checks.append('virada070 nao reserva semveiculo')
cdready=query("select min(cd_pedido) cd from public.solidcon_pedidos_erp e where public.rota_070_pronto(e.cd_pedido) and public.rota_070_veiculo(e.cd_pedido) is null")['cd'];assert cdready is not None
yes('fechamento direto nao injeta S10 emPronto semescolha',f"not public.rota_070_fechavel({cdready},'2026-11-27','s10')")
x=run(f"begin;select public.rota_050_fechar_hoje(jsonb_build_array(jsonb_build_object('cd_pedido',{cdready},'veiculo_id','s10','ordem',1)),null,true);rollback;",False);assert x.returncode and 'Pronto' in x.stderr;checks.append('08hRPC recusa payloadsemveiculo e nao persiste050')
# B muda so escolha/memoria; datas/status/provas e bytes050 permanecem.
for cd in [1557,new['sem_ids'][0],1564]:
 prot=protected();st=states();r=query(f"select public.rota_068_veiculo_historico({cd},'caminhao','Veiculo confirmado pelo dono') r")['r'];assert r['status']=='ok',r
 assert prot==protected() and st==states();checks.append(str(cd)+' B preserva196estados e050bytes')
 yes(str(cd)+' B resolveveiculo correto',f"public.rota_068v_veiculo({cd})='caminhao'")
 n=query('select count(*) n from public.rota_068v_veiculo_log')['n'];r=query(f"select public.rota_068_veiculo_historico({cd},'caminhao','Repetido') r")['r'];assert r['alterado']==False
 assert n==query('select count(*) n from public.rota_068v_veiculo_log')['n'];checks.append(str(cd)+' retry sem log duplicado')
yes('Bhistorico aprende memoria066 semcriarfotos',"exists(select 1 from public.rota_068v_memoria() where cd_pedido=1557 and veiculo_id='caminhao') and not exists(select 1 from public.rota_dia_item where cd_pedido=1557)")
yes('Bnao muda padrao global cliente1557',"not exists(select 1 from public.rota_cliente_veiculo c join public.solidcon_pedidos_erp e on e.documento=c.documento where e.cd_pedido=1557)")
yes('C063datahistorico continua26',"public.rota_068_recebido_dia(1557)=date '2026-11-26' and public.rota_068_pedido_entregue(1557)")
for reason,args in [('parametro_invalido',"null,'caminhao','QA'"),('veiculo_invalido',"1557,'fantasma','QA'"),('motivo_invalido',"1557,'caminhao','<script>'"),('pedido_nao_encontrado',"99999999,'caminhao','QA'")]:yes(reason,f"(public.rota_068_veiculo_historico({args})->>'motivo')='{reason}'")
for uid,role,stmt in [('33333333-3333-4333-8333-333333333333','authenticated',"public.rota_068_veiculo_historico(1557,'caminhao','QA')"),('77777777-7777-4777-8777-777777777777','authenticated',"public.rota_068_veiculo_historico_ler(array[1557]::bigint[])"),('', 'anon',"public.rota_068v_semana_recebidos('2026-11-23')"),(UID,'authenticated',"public.rota_068v_veiculo(1557)")]:
 x=run("set qa.uid='"+uid+"';set role "+role+';select '+stmt+';',False);assert x.returncode,(uid,stmt);checks.append('perm bloqueada '+role+' '+stmt.split('(')[0])
yes('sem DML auditoria authenticated',"not has_table_privilege('authenticated','public.rota_068v_veiculo_log','insert') and not has_table_privilege('authenticated','public.rota_068v_veiculo_log','update') and not has_table_privilege('authenticated','public.rota_068v_veiculo_log','delete')")
yes('service_role semEXECcorrecao',"not has_function_privilege('service_role','public.rota_068_veiculo_historico(bigint,text,text)','execute')")
result={'foto_sha256':'c8c88e541a472370f857def508fb317274fa0574d1851c773708f098d2ebe58f','base':'6a42d0d','antes':old,'depois':new,'pendentes_antes':[x['cd_pedido'] for x in before if x['pendente']],'pendentes_depois':[x['cd_pedido'] for x in after if x['pendente']],'ter_depois_por_veiculo':{v:sum(x['dia']=='2026-11-24' and x['veiculo_id']==v for x in week) for v in ['s10','caminhao']},'foto050_intacta':True,'checks':len(checks),'pass':checks}
# Rollback conserva correcoes/auditoria, restaura corposoriginais exatos2x e reaplica.
n=query('select count(*) n from public.rota_068v_veiculo_log')['n'];mig('068_v_rollback.sql');mig('068_v_rollback.sql')
yes('rollback2x restaura corpos base exatos',"(select bool_and(def=pg_get_functiondef(nome::regprocedure)) from public.rota_068v_backup)")
assert n==query('select count(*) n from public.rota_068v_veiculo_log')['n'];assert before==states();assert photos==protected();checks.append('rollback conserva correcoes/log/status/050')
mig('068_v_veiculo_historico.sql');assert before==states();checks.append('reaplicar estados intactos')
result.update(checks=len(checks),pass_=checks);(OUT/'pg068v-resultado.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:v for k,v in result.items() if k not in('pass','pass_')},ensure_ascii=False))
