from pathlib import Path
import subprocess,json,os,hashlib,time
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'evidencias';DB='sentinela_separando_cpf_forja070_foto_r2'
BASE=['C:/Program Files/PostgreSQL/18/bin/psql.exe','-h','127.0.0.1','-p','55439','-U','qa','-v','ON_ERROR_STOP=1','-At']
def run(db,*args,ok=True):
 r=subprocess.run(BASE+['-d',db,*args],capture_output=True,text=True,encoding='utf-8',errors='replace')
 if ok and r.returncode:raise RuntimeError(r.stderr[-4000:])
 return r
# Dois rollbacks reais restauram todos os corpos registrados, sem apagar as provas/tabelas070.
for i in range(2):run(DB,'-f',str(ROOT/'admin/migracoes/070_rollback.sql'))
r=run(DB,'-c',"select bool_and(def=pg_get_functiondef(nome::regprocedure)) from public.rota_070_backup")
assert r.stdout.strip()=='t',r.stdout
run(DB,'-f',str(ROOT/'admin/migracoes/070_previsao_definitiva.sql'))
# Clock QA recolocado depois de reaplicar.
run(DB,'-c',"create or replace function public.rota_070_agora() returns timestamptz language sql stable set search_path='' as $$select coalesce(nullif(current_setting('qa.agora',true),''),'2026-11-26T18:12:51.634445-03')::timestamptz$$;")
checks=[{'nome':'rollback2x/reaplicar corpos575 exatos','detectado':True}]
# Mutacoes isoladas exclusivamente em prefixoForja070; nao alteram o candidato.
mut=[
 ('pronto_sem_ERP','public.rota_070_pronto(bigint)',"public.rota_070_erp_pronto(e.etapa,e.dt_conferencia,coalesce(e.dt_saida,e.dt_nota,e.dt_atendido))",'true'),
 ('legado_desbloqueado','public.rota_070_entregue(bigint)',"coalesce(public.rota_070_historico_em(p_cd)<=public.rota_070_hoje(),false)",'false'),
 ('marca_data_desviada','public.rota_070_data(bigint)','select coalesce(','select 1+coalesce('),
 ('domingo_habilitado','public.rota_070_dia_motivo(bigint,date,text,boolean)',"if extract(isodow from p_dia)=7 then return 'domingo';end if;",''),
 ('data_entrega_ontem','public.rota_070_virar_dia(date)',"values(item.cd_pedido,p_dia,item.cliente_tipo","values(item.cd_pedido,p_dia-1,item.cliente_tipo"),
 ('coleta_reseta_pronto','public.rota_070_observar_erp()',"case when r.pronto_erp and excluded.pronto_erp then r.pronto_desde else excluded.pronto_desde end",'excluded.pronto_desde'),
 ('fechamento_exige_pendente','public.rota_050_gravar_itens(date,jsonb,uuid)',"public.rota_070_fechavel(p.cd_pedido,p_data,e->>'veiculo_id',true)",'public.rota_055_pendente(p.cd_pedido,p_data)'),
 ('reserva_invalida','public.rota_070_reserva_valida(bigint,date,text)',"r.invalidada_em is null",'false'),
 ('R1_reserva_sem_ERPpronto','public.rota_070_reserva_valida(bigint,date,text)',"and public.rota_070_erp_pronto(e.etapa,e.dt_conferencia,coalesce(e.dt_saida,e.dt_nota,e.dt_atendido))",'')]
for i,(nome,signature,old,new) in enumerate(mut,1):
 db='sentinela_separando_cpf_forja070r2_m'+str(i)
 run('postgres','-c',f'DROP DATABASE IF EXISTS {db} WITH (FORCE)','-c',f'CREATE DATABASE {db} TEMPLATE {DB}')
 body=run(db,'-c',"select pg_get_functiondef('"+signature+"'::regprocedure)").stdout
 assert old in body,(nome,'ponto mutacao nao encontrado')
 run(db,'-c',body.replace(old,new))
 env=dict(os.environ,TEMPRIO070_DB=db)
 teste='070-regressao-reserva-pg.py' if nome.startswith('R1_') else '070-regras-pg.py'
 t=subprocess.run(['python',str(ROOT/'supabase/tests'/teste)],capture_output=True,text=True,encoding='utf-8',env=env)
 (OUT/('mutacao-'+nome+'.txt')).write_text(t.stdout+t.stderr,encoding='utf-8')
 assert t.returncode,(nome,'nao detectada')
 checks.append({'nome':nome,'detectado':True})
 print('DETECTADA',nome,flush=True)
(OUT/'pg070-lifecycle-mutacoes.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print('PASS rollback2x/reaplicar +9/9muts')
