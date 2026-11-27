from pathlib import Path
import subprocess,json,re
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'evidencias';BASE=['C:/Program Files/PostgreSQL/18/bin/psql.exe','-X','-h','127.0.0.1','-p','55439','-U','qa','-v','ON_ERROR_STOP=1','-At','-q']
INIT="set qa.uid='22222222-2222-4222-8222-222222222222';set qa.role='authenticated';set qa.agora='2026-11-27T10:00:00-03';"
def run(db,sql):return subprocess.run(BASE+['-d',db,'-c',sql],capture_output=True,text=True,encoding='utf-8',errors='replace')
def ok(db,sql):
 x=run(db,sql);assert x.returncode==0,x.stderr;return x.stdout
synt="insert into public.solidcon_pedidos_erp(cd_pedido,etapa,cliente_tipo,documento,dt_pedido) values(999901,'aberto','cnpj','12000000000999','2026-11-23');insert into public.rota_dia_item(data,cd_pedido,veiculo_id,origem) values('2026-11-24',999901,'s10','previsao');"
mut=[
 ('fallback','public.rota_054_padrao_separando()','select null::text',"select 's10'::text",'',"select to_jsonb(public.rota_054_padrao_separando() is null)"),
 ('fotoauto','public.rota_068v_veiculo(bigint,date)','and not f.automatico','',synt,"select to_jsonb(public.rota_068v_veiculo(999901,'2026-11-24') is null)"),
 ('memoria','public.rota_068v_memoria()',"where h.fonte='plano' or public.rota_068v_veiculo(h.cd_pedido,h.dia) is not null",'where true',synt,"select to_jsonb(not exists(select 1 from public.rota_068v_memoria() where cd_pedido=999901))"),
 ('permissao','public.rota_068_veiculo_historico(bigint,text,text)',"if auth.uid() is null or not coalesce(public.pode_marcar_rota(),false) then",'if false then',"set qa.uid='33333333-3333-4333-8333-333333333333';set role authenticated;","select public.rota_068_veiculo_historico(1531,'caminhao','QA')"),
 ('fotoalterada','public.rota_068_veiculo_historico(bigint,text,text)','-- Foto050 e suas revisoes permanecem intactas;',"update public.rota_dia_item set veiculo_id=p_veiculo where cd_pedido=p_cd; -- Foto050 e suas revisoes permanecem intactas;","select public.rota_068_veiculo_historico(1531,'caminhao','QA');","select to_jsonb(exists(select 1 from public.rota_dia_item where cd_pedido=1531 and veiculo_id='s10'))"),
 ('auditavel',None,None,None,'',"select to_jsonb(not has_table_privilege('authenticated','public.rota_068v_veiculo_log','update'))"),
 ('fechamento_sem_escolha','public.rota_070_fechavel(bigint,date,text,boolean)','and coalesce(public.rota_070_veiculo(p_cd)=p_v,false) ','','',"select to_jsonb(not public.rota_070_fechavel((select min(cd_pedido) from public.solidcon_pedidos_erp e where public.rota_070_pronto(e.cd_pedido) and public.rota_070_veiculo(e.cd_pedido) is null),'2026-11-27','s10'))")]
results=[]
for i,(name,sig,old,new,setup,test) in enumerate(mut,1):
 db='sentinela_separando_cpf_forja068v_m'+str(i);assert re.fullmatch('sentinela_separando_cpf_forja068v_m[0-9]+',db)
 ok('postgres',f'DROP DATABASE IF EXISTS {db} WITH (FORCE)');ok('postgres',f'CREATE DATABASE {db} TEMPLATE sentinela_separando_cpf_forja068v')
 control=run(db,'begin;'+INIT+setup+test+';rollback;')
 if name=='permissao':assert control.returncode!=0
 else:assert control.returncode==0 and control.stdout.strip().splitlines()[-1]=='true',(name,control.stdout,control.stderr)
 if sig:
  body=ok(db,"select pg_get_functiondef('"+sig+"'::regprocedure)");assert old in body,name;ok(db,body.replace(old,new))
 else:ok(db,'grant update on public.rota_068v_veiculo_log to authenticated')
 x=run(db,'begin;'+INIT+setup+test+';rollback;')
 detected=x.returncode==0 if name=='permissao' else (x.returncode!=0 or x.stdout.strip().splitlines()[-1]!='true')
 assert detected,(name,'nao detectado',x.stdout,x.stderr)
 (OUT/('mut068v-'+name+'.txt')).write_text(x.stdout+x.stderr,encoding='utf-8');results.append({'nome':name,'detectada':True});print('DETECTADA',name,flush=True)
(OUT/'pg068v-mutacoes.json').write_text(json.dumps(results,indent=2)+'\n',encoding='utf-8');print('PASS7/7muts')
