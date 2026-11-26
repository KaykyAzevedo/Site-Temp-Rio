"""Muta apenas copias do pacote e databases QA locais; exige Python stdlib e PG18."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
RUNNER = Path(__file__).with_name('fora-do-site-068.ps1')
MIGRATION = ROOT / 'admin/migracoes/068_f_fora_do_site.sql'
MUTANTS = ROOT / 'mutacoes'
MUTANTS.mkdir(exist_ok=True)
PREFIX = 'sentinela_separando_cpf_forja068f'

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

sync_mutation = """
do $mut$
begin
 execute replace(pg_get_functiondef('public.solidcon_receber_pedidos_erp(jsonb,timestamptz,uuid)'::regprocedure),
 'delete from public.solidcon_pedidos_erp where cd_pedido is not null;', 'perform 1;');
end $mut$;
"""
survival_mutation = """
create or replace function qa.apagar_bloqueio() returns trigger language plpgsql as $$
begin delete from public.rota_pedido_ignorado where cd_pedido=old.cd_pedido;return old;end$$;
drop trigger if exists qa_apagar_bloqueio on public.solidcon_pedidos_erp;
create trigger qa_apagar_bloqueio after delete on public.solidcon_pedidos_erp for each row execute function qa.apagar_bloqueio();
"""
cases = {
    'sem_guarda': (change("if current_user is distinct from 'authenticated' then", 'if true then'), 'f2 guarda upsert direto'),
    'sem_permissao': (change('if not coalesce(public.pode_marcar_rota(), false) then', 'if false then'), 'f2 vendedor nao tira'),
    'sem_log': (change('if v_new and not v_old then', 'if false then'), 'f2 auditoria tirou'),
    'sem_remover_fonte': (source + sync_mutation, 'f2 pedido some da fonte na coleta2'),
    'apaga_bloqueio_sync': (source + survival_mutation, 'f2 lista removido do ERP com registro'),
    'sem_limite': (change('pg_catalog.char_length(v_motivo) > 120 or not public.texto_seguro(v_motivo, 120)', 'false'), 'violates check constraint "rota_pedido_ignorado_045_motivo"'),
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
