from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'evidencias_core'
OUT.mkdir(exist_ok=True)
source=(ROOT/'supabase/functions/_shared/rota-core.js').read_text(encoding='utf-8')
cases=[
 ('ignora_mapa', 'if (p && ctx && ctx.pedidos_estado) {','if (false) {'),
 ('falso_nao_entregue_pendente', 'return estado.pendente;','return !estado.entregue;'),
 ('sem_validacao', "if (!estado || typeof estado.entregue !== 'boolean' || typeof estado.pendente !== 'boolean' || (estado.entregue && estado.pendente)) throw new Error('Estado canonico de pendencia indisponivel ou invalido');", ''),
]
for i,(name,before,after) in enumerate(cases,1):
 assert source.count(before)==1,name
 p=OUT/('mut_'+str(i)+'_'+name)
 (p/'supabase/functions/_shared').mkdir(parents=True,exist_ok=True)
 (p/'supabase/tests').mkdir(parents=True,exist_ok=True)
 (p/'supabase/functions/_shared/rota-core.js').write_text(source.replace(before,after),encoding='utf-8')
 (p/'supabase/tests/incidente-068ch-foto.test.js').write_bytes((ROOT/'supabase/tests/incidente-068ch-foto.test.js').read_bytes())
 r=subprocess.run(['node','--test','supabase/tests/incidente-068ch-foto.test.js'],cwd=p,capture_output=True,text=True,encoding='utf-8',errors='replace')
 (p/'resultado.txt').write_text(r.stdout+r.stderr,encoding='utf-8')
 assert r.returncode!=0 and ('ERR_ASSERTION' in r.stdout or 'AssertionError' in r.stdout),(name,r.stdout[-2000:])
 print(name+': detectada',flush=True)
print('3/3 mutacoes core detectadas sobre foto real, sem ERP/rede',flush=True)
