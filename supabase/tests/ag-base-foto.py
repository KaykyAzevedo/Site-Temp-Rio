"""Reconstroi SOMENTE PG local exclusivo para AG a partir da QA V congelada e foto c8."""
from pathlib import Path
import subprocess,os,hashlib
R=Path(__file__).resolve().parents[2];V=R.parent/'pacote_068V_veiculo_historico';Q=R.parent/'qa_068v_6a42d0d';DB='sentinela_separando_cpf_forja068v_agbase'
assert hashlib.sha256((Q/'supabase/tests/fixtures/070/foto_070_producao.json').read_bytes()).hexdigest()=='c8c88e541a472370f857def508fb317274fa0574d1851c773708f098d2ebe58f'
env=dict(os.environ,TEMPRIO068V_DB=DB)
subprocess.run(['python',str(V/'supabase/tests/068v-base-foto.py'),str(Q),str(V/'admin/migracoes/068_v_veiculo_historico.sql'),str(V/'admin/migracoes/068_v_rollback.sql'),'55439'],env=env,check=True)
subprocess.run(['C:/Program Files/PostgreSQL/18/bin/psql.exe','-X','-h','127.0.0.1','-p','55439','-U','qa','-d',DB,'-v','ON_ERROR_STOP=1','-f',str(V/'admin/migracoes/068_v_veiculo_historico.sql')],check=True)
print('Parent V pronto; rodar ag-pg.py, ag-mutacoes.py, ag-concorrencia.py em seguida')
