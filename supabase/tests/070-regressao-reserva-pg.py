"""B070-R1: reserva exige prontidaoERP atual; virada propria e foto050 nao somem."""
from pathlib import Path
import subprocess,json,os,re
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'evidencias';DB=os.environ.get('TEMPRIO070_DB','sentinela_separando_cpf_forja070_foto_r2');assert re.fullmatch('sentinela_separando_cpf_forja070[a-z0-9_]*',DB)
BASE=['C:/Program Files/PostgreSQL/18/bin/psql.exe','-h','127.0.0.1','-p','55439','-U','qa','-d',DB,'-v','ON_ERROR_STOP=1','-At']
UID='22222222-2222-4222-8222-222222222222';init="set qa.uid='"+UID+"';set qa.role='authenticated';";checks=[]
def run(sql,ok=True):
 r=subprocess.run(BASE+['-c',sql],capture_output=True,text=True,encoding='utf-8',errors='replace')
 if ok and r.returncode:raise RuntimeError(r.stderr[-5000:])
 return r
for n in ['rota_068_reprogramar_explicito(bigint,date,text)','rota_068_mover_pedido(bigint,date,text,uuid)']:
 body=run("select pg_get_functiondef('public."+n+"'::regprocedure)").stdout.replace('pg_catalog.now()','public.rota_070_agora()');run(body)
run('alter table public.rota_068h_reprogramacao alter column criada_em set default public.rota_070_agora()')
manual="select public.rota_070_definitiva_salvar('2026-11-27',jsonb_build_array(jsonb_build_object('cd_pedido',1547,'veiculo_id','s10','ordem',1)),0,'70000000-1547-4547-8547-000000000099');"
virada="set qa.agora='2026-11-27T00:00:01-03';select public.rota_070_virada();"
regressa="update public.solidcon_pedidos_erp set etapa='aberto',dt_atendido=null,dt_saida=null,dt_nota=null,dt_conferencia=null where cd_pedido=1547;"
close="set qa.agora='2026-11-27T08:00:00-03';select public.rota_050_fechar_hoje(jsonb_build_array(jsonb_build_object('cd_pedido',1547,'veiculo_id','s10','ordem',1)),'"+UID+"',false);"
def check(name,body,expected):
 r=run('begin;'+init+body+'select jsonb_build_object('+expected+');rollback;');value=[json.loads(x) for x in r.stdout.splitlines() if x.startswith('{')][-1];assert all(value.values()),(name,value);checks.append({'caso':name,'provas':value})
check('MANUAL regressaoERP antes00 invalida reserva/050',manual+regressa+virada,"'pronto_false',not public.rota_070_pronto(1547),'reserva_false',not public.rota_070_reserva_valida(1547,'2026-11-27','s10'),'fechavel_false',not public.rota_070_fechavel(1547,'2026-11-27','s10'),'nao_recebeu',not exists(select 1 from public.rota_070_recebimento where cd_pedido=1547)")
check('AUTO regressaoERP depois00 nao autoriza nova foto',virada+regressa,"'reserva_false',not public.rota_070_reserva_valida(1547,'2026-11-27','s10'),'fechavel_false',not public.rota_070_fechavel(1547,'2026-11-27','s10'),'prova_preservada',exists(select 1 from public.rota_070_recebimento where cd_pedido=1547 and dia='2026-11-27')")
for origem,body in [('manual',manual+regressa+virada),('auto',virada+regressa)]:
 r=run('begin;'+init+body+close+'rollback;',ok=False);assert r.returncode and 'Pronto' in r.stderr,(origem,r.stdout,r.stderr);checks.append({'caso':origem+' fechar rejeita ABERTO','recusou':True})
check('virada propria Received nao perde reservaERPPronto',manual+virada,"'pendente_false',not public.rota_055_pendente(1547,public.rota_070_hoje()),'pronto_canonico_false',not public.rota_070_pronto(1547),'ERPpronto_true',(select public.rota_070_erp_pronto(etapa,dt_conferencia,coalesce(dt_saida,dt_nota,dt_atendido)) from public.solidcon_pedidos_erp where cd_pedido=1547),'reserva_true',public.rota_070_reserva_valida(1547,'2026-11-27','s10'),'fechavel_true',public.rota_070_fechavel(1547,'2026-11-27','s10')")
check('foto050 PERSISTIDA preservada mesmo regressaoERP posterior',manual+virada+close+regressa,"'reserva_false',not public.rota_070_reserva_valida(1547,'2026-11-27','s10'),'foto_preservada',exists(select 1 from public.rota_dia_item where cd_pedido=1547 and data='2026-11-27' and removido_em is null),'projecao_foto_true',public.rota_070_fechavel(1547,'2026-11-27','s10')")
# Regressao via coleta completa DELETE+INSERT, sem validar apenas UPDATE artificioso.
coleta="create temporary table copiaR1 as select * from public.solidcon_pedidos_erp where cd_pedido=1547;update copiaR1 set etapa='aberto',dt_atendido=null,dt_saida=null,dt_nota=null,dt_conferencia=null;delete from public.solidcon_pedidos_erp where cd_pedido=1547;insert into public.solidcon_pedidos_erp select * from copiaR1;"
for origem,body in [('manual',manual+coleta+virada),('auto',virada+coleta)]:check(origem+' coletaDELETE+INSERT regressao invalida',body,"'reserva_false',not public.rota_070_reserva_valida(1547,'2026-11-27','s10'),'fechavel_false',not public.rota_070_fechavel(1547,'2026-11-27','s10')")
# Etapa conferido so e Pronto com conferencia valida, mesmo que fat antigo tenha sobrado.
check('conferido SEM data nao revalida reserva',manual+"update public.solidcon_pedidos_erp set etapa='conferido',dt_conferencia=null where cd_pedido=1547;"+virada,"'reserva_false',not public.rota_070_reserva_valida(1547,'2026-11-27','s10')")
(OUT/'B070-R1-regressoes.json').write_text(json.dumps({'checks':len(checks),'pass':checks},ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print('PASS B070-R1',len(checks))
