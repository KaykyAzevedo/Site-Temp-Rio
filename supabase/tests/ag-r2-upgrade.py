from pathlib import Path
import subprocess,os,json,importlib.util
R=Path(__file__).resolve().parents[2];R1=R.parent/'pacote_068AG_agendado_prioridade';DB='sentinela_separando_cpf_forja068ag_r2_upgrade';B=['C:/Program Files/PostgreSQL/18/bin/psql.exe','-X','-h','127.0.0.1','-p','55439','-U','qa','-v','ON_ERROR_STOP=1','-Atq']
def sql(db,s):
 x=subprocess.run(B+['-d',db],input=s,capture_output=True,text=True,encoding='utf-8');assert x.returncode==0,x.stderr;return x.stdout
def mig(root,name):
 x=subprocess.run(B+['-d',DB,'-f',str(root/'admin/migracoes'/name)],capture_output=True,text=True,encoding='utf-8');assert x.returncode==0,x.stderr
sql('postgres','drop database if exists '+DB);sql('postgres','create database '+DB+' template sentinela_separando_cpf_forja068v_agbase')
mig(R1,'068_ag_agendado_prioridade.sql');mig(R,'068_ag_agendado_prioridade.sql');mig(R,'068_ag_agendado_prioridade.sql')
os.environ['TEMPRIO_AGR2_DB']=DB
spec=importlib.util.spec_from_file_location('batch065',R/'supabase/tests/ag-r2-batch065.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
name,s,expect=m.CASES[0];ok,data=m.check(name,s,expect);assert ok,data
mig(R,'068_ag_rollback.sql');mig(R,'068_ag_rollback.sql');assert sql(DB,"select count(*)=8 and bool_and(def=pg_get_functiondef(nome::regprocedure)) from public.rota_068ag_backup").strip()=='t'
mig(R,'068_ag_agendado_prioridade.sql');ok,data=m.check(name,s,expect);assert ok,data
result={'upgrade_r1_r2_2x':'PASS','repro_RPC065':'PASS','rollback2x_8corpos_exatos':'PASS','reaplicar':'PASS'};(R/'evidencias/pg-r2-upgrade.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
