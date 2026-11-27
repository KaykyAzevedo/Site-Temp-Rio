from pathlib import Path
import subprocess,json,time
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'evidencias';DB='sentinela_separando_cpf_forja070_concorrencia_r2'
BASE=['C:/Program Files/PostgreSQL/18/bin/psql.exe','-h','127.0.0.1','-p','55439','-U','qa','-v','ON_ERROR_STOP=1','-At']
def run(db,sql):
 r=subprocess.run(BASE+['-d',db,'-c',sql],capture_output=True,text=True,encoding='utf-8',errors='replace');assert not r.returncode,r.stderr;return r.stdout
init="set qa.uid='22222222-2222-4222-8222-222222222222';set qa.role='authenticated';"
checks=[]
for sentido in ['worker_antes_marca','marca_antes_worker']:
 run('postgres',f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)');run('postgres',f'CREATE DATABASE {DB} TEMPLATE sentinela_separando_cpf_forja070_foto_r2')
 worker="set qa.agora='2026-11-27T00:00:01-03';select public.rota_070_virada();"
 marca="set qa.agora='2026-11-26T22:00:00-03';select public.rota_070_saida_salvar(1547,'2026-11-30','70000000-0000-4000-8000-000000000099');"
 first,second=(worker,marca) if sentido.startswith('worker') else (marca,worker)
 proc=subprocess.Popen(BASE+['-d',DB,'-c','begin;'+init+first+"select pg_sleep(1.5);commit;"],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
 # Espera evidencia de lock no PG, nao um sono presumido.
 for _ in range(50):
  active=run(DB,"select count(*) from pg_stat_activity where datname=current_database() and wait_event='PgSleep'").strip()
  if active=='1':break
  time.sleep(.02)
 else:raise AssertionError('T1 nao chegou ao ponto sincronizado')
 start=time.monotonic();out=run(DB,init+second);elapsed=time.monotonic()-start
 stdout,stderr=proc.communicate(timeout=10);assert proc.returncode==0,(stdout,stderr);assert elapsed>.5,(sentido,elapsed)
 actual=json.loads(run(DB,init+"set qa.agora='2026-11-27T00:02:00-03';select jsonb_build_object('data',public.rota_070_data(1547),'historico',public.rota_070_entregue(1547),'recebimento',(select min(dia) from public.rota_070_recebimento where cd_pedido=1547),'reserva27',public.rota_070_reserva_valida(1547,'2026-11-27','s10'));").strip().splitlines()[-1])
 assert actual['data']=='2026-11-30' and not actual['historico'] and not actual['reserva27'],actual
 assert actual['recebimento']==('2026-11-27' if sentido.startswith('worker') else None),actual
 checks.append({'caso':sentido,'esperou_lock_seg':round(elapsed,3),'estado':actual})
(OUT/'pg070-concorrencia.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print('PASS concorrencia 2 sentidos, sem deadlock e sem perda de marca')
