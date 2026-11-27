"""AG068-R1: cobre a RPC065 REAL e a data logica, nao apenas UPDATEordem."""
from pathlib import Path
import ast,subprocess,json,os
R=Path(__file__).resolve().parents[2];DB=os.environ.get('TEMPRIO_AGR2_DB','sentinela_separando_cpf_forja068ag_r2')
assert DB.startswith('sentinela_separando_cpf_forja068ag_r2')
PS=['C:/Program Files/PostgreSQL/18/bin/psql.exe','-X','-h','127.0.0.1','-p','55439','-U','qa','-v','ON_ERROR_STOP=1','-Atq','-d',DB]
S=next(ast.literal_eval(x.value) for x in ast.parse((R/'supabase/tests/ag-pg.py').read_text(encoding='utf-8')).body if isinstance(x,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='S' for t in x.targets))
INIT="set qa.uid='22222222-2222-4222-8222-222222222222';set qa.role='authenticated';set qa.agora='2026-11-27T10:00:00-03';"
OLD="""delete from public.rota_068_prazo_pedido where cd_pedido=988001;
insert into public.rota_plano_semana(cd_pedido,dia,veiculo_id,ordem,removido) values(988001,'2026-12-04','s10',1,false);
insert into public.rota_068_prazo_pedido(cd_pedido,tipo,data_agendada,motivo,atualizado_em) values(988001,'data','2026-12-03','Agenda criada depois plano','2026-11-26 16:00-03');
"""
def item(cd=988001,dia='2026-12-04',v='s10',ordem=1,rem=False):return {'cd_pedido':cd,'dia':dia,'veiculo_id':v,'ordem':ordem,'removido':rem}
def save(items,version=None,scope=None):
 version=version or "coalesce((select versao from public.rota_065_semana where inicio='2026-11-30'),0)"
 return "select public.rota_065_salvar_semana('2026-11-30',"+version+",'"+json.dumps(items)+"'::jsonb,"+("'"+scope+"'" if scope else 'null')+");"
NOMOVE="select jsonb_build_object('ancora3',public.rota_068ag_estado(988001)->>'data_ancora'='2026-12-03','sem_override',not (public.rota_068ag_estado(988001)->>'movido_manualmente')::boolean,'sem_auditoria',not exists(select 1 from public.rota_068ag_manual where cd_pedido=988001));"
MOVE="select jsonb_build_object('ancora4',public.rota_068ag_estado(988001)->>'data_ancora'='2026-12-04','manual',(public.rota_068ag_estado(988001)->>'movido_manualmente')::boolean);"
CASES=[
('RPC065 mesmo lote preserva ancora eworker nao recebe04',OLD+save([item()])+NOMOVE+"set qa.agora='2026-12-04T00:00:01-03';select public.rota_070_virar_dia('2026-12-04');select jsonb_build_object('sem_recebido04',not exists(select 1 from public.pedido_entrega_rota where cd_pedido=988001),'naofecha04',not public.rota_070_fechavel(988001,'2026-12-04','s10'));",'ok'),
('RPC065 mudar so ordem nao autoriza',OLD+"insert into public.rota_plano_semana(cd_pedido,dia,veiculo_id,ordem) values(988002,'2026-12-04','s10',2);"+save([item(ordem=2),item(988002,ordem=1)])+NOMOVE,'ok'),
('RPC065 so veiculo nao autoriza',OLD+save([item(v='caminhao',ordem=None)])+NOMOVE,'ok'),
('RPC065 editar OUTROpedido mantem ancora antiga',OLD+"insert into public.rota_plano_semana(cd_pedido,dia,veiculo_id,ordem) values(988002,'2026-12-04','s10',2);"+save([item(),item(988002,dia='2026-12-02')])+NOMOVE,'ok'),
('RPC065 mudanca REAL dedata registra ancora nova',OLD+save([item(dia='2026-12-03')])+"select jsonb_build_object('data3',public.rota_068ag_estado(988001)->>'data_ancora'='2026-12-03','registrado',exists(select 1 from public.rota_068ag_manual where cd_pedido=988001 and dia='2026-12-03'));"+save([item()])+MOVE,'ok'),
('RPC065 omitirativo = bandeja manual',OLD+save([])+"select jsonb_build_object('bandeja',(public.rota_068ag_estado(988001)->>'na_bandeja')::boolean,'semplano',not exists(select 1 from public.rota_plano_semana where cd_pedido=988001));",'ok'),
('RPC065 tombstone inalterado nao fabrica bandejamanual',OLD+"update public.rota_plano_semana set removido=true,ordem=null where cd_pedido=988001;delete from public.rota_068ag_manual where cd_pedido=988001;"+save([item(dia='2026-12-03',ordem=None,rem=True)])+NOMOVE,'ok'),
('RPC065 novalinha ativa e movimentoreal',save([item()])+MOVE,'ok'),
('RPC065 versaoantiga recusa semefeito',OLD+save([item(dia='2026-12-03')],version='999999999')+NOMOVE,'versao_antiga'),
('RPC065 scope veiculo nao mexe linhas fora escopo',OLD+save([item()],scope='s10')+NOMOVE,'ok'),
('RPC065 overrideHlegitimo preserva auditoria byteigual',"select public.rota_068_mover_pedido(988001,'2026-12-04','s10','068a0000-0000-4000-8000-000000000091');update public.rota_068ag_manual set em='2026-11-26 17:00-03' where cd_pedido=988001;create temp table audit_before as select to_jsonb(m) j from public.rota_068ag_manual m where cd_pedido=988001;"+save([item()])+MOVE+"select jsonb_build_object('audit_igual',(select j from audit_before)=(select to_jsonb(m) from public.rota_068ag_manual m where cd_pedido=988001));",'ok'),
('DMLdireto ordem/veiculo nao movimento, datareal continua',OLD+"update public.rota_plano_semana set ordem=2 where cd_pedido=988001;"+NOMOVE+"update public.rota_plano_semana set dia='2026-12-02' where cd_pedido=988001;select jsonb_build_object('real',public.rota_068ag_estado(988001)->>'data_ancora'='2026-12-02');",None)
]
def execute(sql):return subprocess.run(PS,input='begin;'+INIT+S+sql+'rollback;',capture_output=True,text=True,encoding='utf-8',errors='replace')
def check(name,sql,status):
 x=execute(sql)
 if x.returncode:return False,x.stdout+x.stderr
 data=[json.loads(l) for l in x.stdout.splitlines() if l.startswith('{')]
 bools=[v for v in data if v and all(type(y)is bool for y in v.values())]
 ok=bool(bools) and all(all(v.values()) for v in bools)
 if status=='ok':ok=ok and any(v.get('status')=='ok' for v in data) and not any(v.get('status')=='erro' for v in data)
 elif status:ok=ok and any(v.get('motivo')==status for v in data)
 return ok,data
if __name__=='__main__':
 results=[]
 for name,sql,status in CASES:
  ok,data=check(name,sql,status);assert ok,(name,data);results.append({'nome':name,'pass':True});print('PASS',name,flush=True)
 (R/'evidencias/pg-r2-batch065.json').write_text(json.dumps(results,indent=2)+'\n',encoding='utf-8');print('PASS',len(results),'RPC/efetiva')
