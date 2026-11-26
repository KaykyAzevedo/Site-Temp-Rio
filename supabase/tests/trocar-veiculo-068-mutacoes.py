"""Muta apenas copias do pacote e databases QA locais; exige Python stdlib e PG18."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
RUNNER = Path(__file__).with_name('trocar-veiculo-068.ps1')
MIGRATION = ROOT / 'admin/migracoes/068_a_trocar_veiculo.sql'
MUTANTS = ROOT / 'mutacoes'
MUTANTS.mkdir(exist_ok=True)
PREFIX = 'sentinela_separando_cpf_forja068a'

def run(*args):
    return subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(RUNNER), *args],
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')

base = run('-Database', PREFIX + '_base', '-Preparar')
if base.returncode:
    raise SystemExit(base.stdout)
source = MIGRATION.read_text(encoding='utf-8')

def change(old, new):
    assert old in source, old
    return source.replace(old, new)

cases = {
    'sem_plano': (change('if v_destino is distinct from v_plano.veiculo_id then', 'if false then'), 'a marcacao e plano atomicos'),
    'sem_saida_rpc': (change('if public.rota_068_veiculo_saiu(p_cd_pedido) then', 'if false then'), 'a etapas saiu atendido bloqueadas'),
    'sem_saida_dml': (change("if current_user='authenticated' and (", "if false and ("), 'a guarda insert direto'),
    'sem_permissao': (change("if auth.uid() is null or not coalesce(public.pode_marcar_rota(),false) then", 'if false then'), 'a vendedor sem marca_rota'),
    'sem_origem': (change('if not public.rota_065_linha_editavel(v_plano.dia,v_plano.veiculo_id) then', 'if false then'), 'a origem hoje bloqueada065'),
    'sem_renumerar': (change('and p.ordem is distinct from o.n', 'and false'), 'a renumera origem porta'),
}
results = []
for name, (sql, expected) in cases.items():
    path = MUTANTS / (name + '.sql')
    path.write_text(sql, encoding='utf-8')
    result = run('-Database', PREFIX + '_' + name, '-Template', PREFIX + '_base', '-Migracao', str(path))
    log = (ROOT / (PREFIX + '_' + name + '.log')).read_text(encoding='utf-8-sig', errors='replace')
    killed = result.returncode != 0 and expected in log
    results.append(f'{"KILLED" if killed else "FAIL"}: {name} -> {expected}')
    print(results[-1], flush=True)
    if not killed:
        print(result.stdout)
        raise SystemExit(1)
(ROOT / 'mutacoes.txt').write_text('\n'.join(results) + '\n6/6 mutacoes detectadas\n', encoding='utf-8')
