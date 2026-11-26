"""Muta apenas copias do pacote e databases QA locais; exige Python stdlib e PG18."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
RUNNER = Path(__file__).with_name('entrega-automatica-068.ps1')
MIGRATION = ROOT / 'admin/migracoes/068_c_entrega_automatica.sql'
MUTANTS = ROOT / 'mutacoes'
MUTANTS.mkdir(exist_ok=True)
PREFIX = 'sentinela_separando_cpf_forja068cr2'

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
    'r1_perde_fila063': (change('and not exists(select from public.pedido_entrega_confirmacao ec where ec.cd_pedido=p.cd_pedido and ec.desfeito_em is null)', 'and true'), 'c R1 recebido063 anterior continua fora da fila'),
    'r1_perde_leiturac': (change('where ec.desfeito_em is null and not exists(select 1 from public.pedido_entrega_rota er where er.cd_pedido=ec.cd_pedido)', 'where false and ec.desfeito_em is null and not exists(select 1 from public.pedido_entrega_rota er where er.cd_pedido=ec.cd_pedido)'), 'c R1 UI preserva legado na leituraC'),
    'r1_perde_leitura063': (change('where ec.cd_pedido=any(p_cds) and ec.desfeito_em is null', 'where false and ec.cd_pedido=any(p_cds) and ec.desfeito_em is null'), 'c R1 projecao063 preserva legado sem059'),
    'sem_captura': (change('where p_cds is null or s.cd_pedido=any(p_cds)', 'where false'), 'c fechamento entrega e captura snapshot'),
    'sem_autorizar_marcar': (change("if auth.uid() is null or not coalesce(public.pode_marcar_rota(),false) then", 'if false then'), 'c vendedor nao marca'),
    'sem_admin_desfazer': (change("if auth.uid() is null or not coalesce(public.eh_admin(),false) then", 'if false then'), 'c Marcio nao desfaz'),
    'volta_pendente': (change('and not exists(select 1 from public.pedido_entrega_rota er where er.cd_pedido=p.cd_pedido)', 'and true'), 'c reaparecer aberto nao volta pendente'),
    'replay_ignorado': (change('where requisicao=p_requisicao;', 'where requisicao=p_requisicao and false;'), 'c retry da mesma requisicao'),
    'inclui_fora_site': (change("and not exists(select 1 from public.rota_pedido_ignorado g where g.cd_pedido=e.cd_pedido and g.alcance='site')", 'and true'), 'c tirado site nao entra em relatorio'),
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
(ROOT / 'mutacoes.txt').write_text('\n'.join(results) + f'\n{len(cases)}/{len(cases)} mutacoes detectadas\n', encoding='utf-8')
