from pathlib import Path
import subprocess,json,time
ROOT=Path(__file__).resolve().parents[2];DB='sentinela_separando_cpf_forja068v_conc';B=['C:/Program Files/PostgreSQL/18/bin/psql.exe','-X','-h','127.0.0.1','-p','55439','-U','qa','-v','ON_ERROR_STOP=1','-At','-q'];INIT="set qa.uid='22222222-2222-4222-8222-222222222222';set qa.role='authenticated';set qa.agora='2026-11-27T10:00:00-03';"
def run(db,sql):
 x=subprocess.run(B+['-d',db,'-c',sql],capture_output=True,text=True,encoding='utf-8');assert not x.returncode,x.stderr;return x.stdout
run('postgres',f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)');run('postgres',f'CREATE DATABASE {DB} TEMPLATE sentinela_separando_cpf_forja068v')
fotocmd="select md5(jsonb_agg(to_jsonb(i) order by data,cd_pedido)::text) from public.rota_dia_item i";photo=run(DB,fotocmd)
a=subprocess.Popen(B+['-d',DB,'-c','begin;'+INIT+"select public.rota_068_veiculo_historico(1557,'s10','Concorrencia1');select pg_sleep(1.5);commit;"],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
for _ in range(80):
 if run(DB,"select count(*) from pg_stat_activity where datname=current_database() and wait_event='PgSleep'").strip()=='1':break
 time.sleep(.02)
else:raise AssertionError('T1 semponto sincronizado')
start=time.monotonic();b=run(DB,INIT+"select public.rota_068_veiculo_historico(1557,'caminhao','Concorrencia2')");duration=time.monotonic()-start;stdout,stderr=a.communicate(timeout=10);assert a.returncode==0,stderr;assert duration>.5,duration
result=json.loads(b.strip().splitlines()[-1]);assert result['veiculo_de']=='s10' and result['veiculo_para']=='caminhao',result;assert run(DB,fotocmd)==photo
(ROOT/'evidencias/pg068v-concorrencia.json').write_text(json.dumps({'esperou_lock_seg':duration,'resultado':result,'foto050_intacta':True},indent=2)+'\n',encoding='utf-8');print('PASS concorrencia, origem auditada serializada efoto intacta')
