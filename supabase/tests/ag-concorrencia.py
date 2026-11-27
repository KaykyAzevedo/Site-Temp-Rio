from pathlib import Path
import ast,subprocess,json,time
R=Path(__file__).resolve().parents[2];DB='sentinela_separando_cpf_forja068ag_r2_conc';B=['C:/Program Files/PostgreSQL/18/bin/psql.exe','-X','-h','127.0.0.1','-p','55439','-U','qa','-v','ON_ERROR_STOP=1','-Atq']
S=next(ast.literal_eval(x.value) for x in ast.parse((R/'supabase/tests/ag-pg.py').read_text(encoding='utf-8')).body if isinstance(x,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='S' for t in x.targets))
INIT="set qa.uid='22222222-2222-4222-8222-222222222222';set qa.role='authenticated';set qa.agora='2026-12-02T20:00:00-03';"
def run(db,s):
 x=subprocess.run(B+['-d',db],input=s,capture_output=True,text=True,encoding='utf-8');assert x.returncode==0,x.stderr;return x.stdout
run('postgres','drop database if exists '+DB);run('postgres','create database '+DB+' template sentinela_separando_cpf_forja068ag_r2');run(DB,INIT+S)
a=subprocess.Popen(B+['-d',DB],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8');a.stdin.write('begin;'+INIT+"select public.rota_068_mover_pedido(988001,'2026-12-04','s10','068a0000-0000-4000-8000-000000000041');select pg_sleep(1.5);commit;\n");a.stdin.close();a.stdin=None
for _ in range(80):
 if run(DB,"select count(*) from pg_stat_activity where datname=current_database() and wait_event='PgSleep'").strip()=='1':break
 time.sleep(.02)
else:raise AssertionError('T1 nao sincronizou')
t=time.monotonic();res=run(DB,INIT+"select public.rota_070_definitiva_salvar('2026-12-03',jsonb_build_array(jsonb_build_object('cd_pedido',988001,'veiculo_id','s10','ordem',1)),0,'068a0000-0000-4000-8000-000000000042');");secs=time.monotonic()-t;out,err=a.communicate(timeout=10);assert a.returncode==0,err
r=json.loads(res.strip().splitlines()[-1]);assert secs>.5 and r.get('motivo')=='pedido_agendado_fora_data',(secs,r)
assert run(DB,"select dia from public.rota_plano_semana where cd_pedido=988001").strip()=='2026-12-04'
(R/'evidencias/pg-concorrencia.json').write_text(json.dumps({'esperou_lock_seg':secs,'resposta':r,'plano_preservado':'2026-12-04'},indent=2)+'\n',encoding='utf-8');print('PASS H manual serializa com070 confirma; recusa ancora antiga')
