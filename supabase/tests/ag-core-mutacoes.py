from pathlib import Path
import subprocess,json
R=Path(__file__).resolve().parents[2];Q=R.parent/'qa_068AG_mut';(Q/'supabase/functions/_shared').mkdir(parents=True,exist_ok=True);(Q/'supabase/tests').mkdir(parents=True,exist_ok=True)
source=(R/'supabase/functions/_shared/rota-core.js').read_text(encoding='utf-8');target=Q/'supabase/functions/_shared/rota-core.js';test=Q/'supabase/tests/agendado-prioridade-068ag.test.js';test.write_bytes((R/'supabase/tests/agendado-prioridade-068ag.test.js').read_bytes())
def run():return subprocess.run(['node','--test','--test-reporter=tap',str(test)],capture_output=True,text=True,encoding='utf-8',errors='replace')
target.write_text(source,encoding='utf-8');c=run();assert c.returncode==0,c.stdout
muts=[('prioridade_maxima','if(!!a.agendado!==!!b.agendado)return a.agendado?-1:1;',''),('encaixe_folga',"if(u.encaixeAgendado && perm.indexOf(u.encaixeAgendado.dia)>=0)","if(false)"),('bandeja_manual','x.naBandejaManual=!!a.na_bandeja','x.naBandejaManual=false')];res=[]
for name,old,new in muts:
 assert old in source,name;target.write_text(source.replace(old,new),encoding='utf-8');x=run();assert x.returncode!=0 and 'not ok' in x.stdout,(name,'sobreviveu')
 (R/'evidencias'/('core-mut-'+name+'.txt')).write_text(x.stdout+x.stderr,encoding='utf-8');res.append({'nome':name,'detectada':True})
target.write_text(source,encoding='utf-8');(R/'evidencias/core-mutacoes.json').write_text(json.dumps(res,indent=2)+'\n',encoding='utf-8');print('PASS3/3 mutacoesCore')
