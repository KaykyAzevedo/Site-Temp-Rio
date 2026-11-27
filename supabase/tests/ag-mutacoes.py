from pathlib import Path
import ast,subprocess,json,re,importlib.util
R=Path(__file__).resolve().parents[2];OUT=R/'evidencias';PS=['C:/Program Files/PostgreSQL/18/bin/psql.exe','-X','-h','127.0.0.1','-p','55439','-U','qa','-v','ON_ERROR_STOP=1','-Atq']
S=next(ast.literal_eval(x.value) for x in ast.parse((R/'supabase/tests/ag-pg.py').read_text(encoding='utf-8')).body if isinstance(x,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='S' for t in x.targets))
INIT="set qa.uid='22222222-2222-4222-8222-222222222222';set qa.role='authenticated';set qa.agora='2026-11-27T10:00:00-03';"
def run(db,s):return subprocess.run(PS+['-d',db],input=s,capture_output=True,text=True,encoding='utf-8',errors='replace')
def ok(db,s):
 x=run(db,s);assert x.returncode==0,x.stderr;return x.stdout
muts=[
('ancora_exata','public.rota_068ag_no_dia(bigint,date)',"::date=p_dia","::date<=p_dia",'',"select to_jsonb(not public.rota_068ag_no_dia(988001,'2026-12-04'))"),
('manual_versaoB','public.rota_068ag_estado(bigint)','and m.prazo_em=e.atualizado_em','',"select public.rota_068_mover_pedido(988001,'2026-12-04','s10','068a0000-0000-4000-8000-000000000001');update public.rota_068_prazo_pedido set data_agendada='2026-12-07',atualizado_em='2026-11-27 11:00-03' where cd_pedido=988001;","select to_jsonb(public.rota_068ag_estado(988001)->>'data_ancora'='2026-12-07')"),
('proximidade066','public.rota_066_sugestoes(date)','public.rota_066_km(a.lat,a.lng,x.lat,x.lng)','1000::double precision', '',"select to_jsonb(exists(select 1 from jsonb_array_elements(public.rota_066_sugestoes('2026-11-30')->'pedidos') x where x->>'cd_pedido'='988002' and x->>'dia_sugerido'='2026-12-03'))"),
('semveiculoV','public.rota_054_padrao_separando()','null::text',"'s10'::text",'delete from public.rota_pedido_veiculo where cd_pedido=988001;',"select to_jsonb(public.rota_070_veiculo(988001) is null)"),
('definitiva_ancora','public.rota_070_definitiva_salvar(date,jsonb,bigint,uuid)','if not public.rota_068ag_no_dia(cd,p_dia) then','if false then',"set qa.agora='2026-12-03T20:00:00-03';","select to_jsonb(public.rota_070_definitiva_salvar('2026-12-04',jsonb_build_array(jsonb_build_object('cd_pedido',988001,'veiculo_id','s10','ordem',1)),0,'068a0000-0000-4000-8000-000000000010')->>'motivo'='pedido_agendado_fora_data')"),
('worker_naoadia','public.rota_070_virar_dia(date)',' and public.rota_068ag_no_dia(e.cd_pedido,p_dia)','',"set qa.agora='2026-12-04T00:00:01-03';select public.rota_070_virar_dia('2026-12-04');","select to_jsonb(not exists(select 1 from public.rota_070_reserva where dia='2026-12-04' and cd_pedido=988001))"),
('RPC_permissao','public.rota_068ag_agendados_ler(bigint[])',"if coalesce(auth.role(),'')<>'service_role' and (auth.uid() is null or not coalesce(public.eh_equipe(),false)) then",'if false then',"set qa.uid='77777777-7777-4777-8777-777777777777';set role authenticated;","select * from public.rota_068ag_agendados_ler(array[988001]::bigint[])"),
('override_acl',None,None,None,'',"select to_jsonb(not has_table_privilege('authenticated','public.rota_068ag_manual','update'))")]
spec=importlib.util.spec_from_file_location('batch065',R/'supabase/tests/ag-r2-batch065.py');batch=importlib.util.module_from_spec(spec);spec.loader.exec_module(batch)
batch_setup=batch.OLD+batch.save([batch.item()])
batch_test="select to_jsonb(public.rota_068ag_estado(988001)->>'data_ancora'='2026-12-03' and not (public.rota_068ag_estado(988001)->>'movido_manualmente')::boolean)"
muts.extend([
 ('065_reintroduzir_DELETE_INSERT','public.rota_065_salvar_semana(date,bigint,jsonb,text)'," and not exists(select 1 from pg_catalog.jsonb_array_elements(p_itens) e where (e->>'cd_pedido')::bigint=p.cd_pedido)",'',batch_setup,batch_test),
 ('trigger_sem_comparar_data_efetiva','public.rota_068ag_plano_manual()','antes is distinct from depois','true',batch_setup,batch_test)
])
results=[]
for i,(name,sig,old,new,setup,test) in enumerate(muts,1):
 db='sentinela_separando_cpf_forja068ag_r2_m'+str(i);assert re.fullmatch('sentinela_separando_cpf_forja068ag_r2_m[0-9]+',db)
 ok('postgres','drop database if exists '+db);ok('postgres','create database '+db+' template sentinela_separando_cpf_forja068ag_r2')
 c=run(db,'begin;'+INIT+S+setup+test+';rollback;')
 if name=='RPC_permissao':assert c.returncode and 'somente equipe' in c.stderr
 else:assert c.returncode==0 and c.stdout.strip().splitlines()[-1]=='true',(name,'controle',c.stdout,c.stderr)
 if sig:
  body=ok(db,"select pg_get_functiondef('"+sig+"'::regprocedure)");assert old in body,(name,old);ok(db,body.replace(old,new))
 else:ok(db,'grant update on public.rota_068ag_manual to authenticated')
 x=run(db,'begin;'+INIT+S+setup+test+';rollback;');det=x.returncode==0 if name=='RPC_permissao' else x.returncode!=0 or (x.stdout.strip().splitlines() or ['NULL'])[-1]!='true'
 assert det,(name,'naodetectada',x.stdout,x.stderr)
 (OUT/('mut-'+name+'.txt')).write_text(x.stdout+x.stderr,encoding='utf-8');results.append({'nome':name,'detectada':True});print('DETECTADA',name,flush=True)
(OUT/'pg-mutacoes.json').write_text(json.dumps(results,indent=2)+'\n',encoding='utf-8');print('PASS',len(results))
