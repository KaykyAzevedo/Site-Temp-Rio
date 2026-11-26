"""QA local destrutivo apenas em bancos com prefixo exclusivo Forja068H.
Requer template C_r2 aprovado, sem clientes conectados ao template.
"""
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'evidencias'
OUT.mkdir(exist_ok=True)
PSQL = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
BASE = [PSQL, '-h', '127.0.0.1', '-p', '55439', '-U', 'qa', '-v', 'ON_ERROR_STOP=1']
PREFIX = 'sentinela_separando_cpf_forja068hr3'

def sql(db, *args):
    return subprocess.run(BASE + ['-d', db, *args], capture_output=True, text=True, encoding='utf-8', errors='replace')

def clone(name, source):
    assert re.fullmatch(PREFIX + '[a-z0-9_]*', name), name
    assert source == 'sentinela_separando_cpf_forja068cr2' or re.fullmatch(PREFIX + '[a-z0-9_]*', source)
    r = sql('postgres', '-c', f'DROP DATABASE IF EXISTS {name} WITH (FORCE)', '-c', f'CREATE DATABASE {name} TEMPLATE {source}')
    assert r.returncode == 0, r.stderr

prep = PREFIX + '_base'
clone(prep, 'sentinela_separando_cpf_forja068cr2')
r = sql(prep, '-f', str(ROOT / 'supabase/tests/h-base.sql'))
(OUT / 'preparo.txt').write_text(r.stdout + r.stderr, encoding='utf-8')
assert r.returncode == 0, r.stderr
migration = (ROOT / 'admin/migracoes/068_h_mover_nao_historico.sql').read_text(encoding='utf-8')
tests = ROOT / 'supabase/tests/mover-nao-historico-068.sql'
clone(PREFIX + '_qa', prep)
r = sql(PREFIX + '_qa', '-f', str(tests))
(OUT / 'pg.txt').write_text(r.stdout + r.stderr, encoding='utf-8')
assert r.returncode == 0 and re.search(r'checks_h\s*-+\s*61\b', r.stdout), r.stderr
print('PG 61/61 PASS; rollback2x/reaplicar; atomicidade com falha apos estado', flush=True)

mutations = [
    ('ignora_ERP_legado', "e.etapa in('saiu','atendido')", "false and e.etapa in('saiu','atendido')"),
    ('ignora059', 'select max(s.dia_saida) from public.rota_059_saidas s where s.cd_pedido=p_cd', 'select null::date'),
    ('falso_nao_entregue_pendente', 'public.rota_055_pendente(c,public.rota_068_hoje()) from unnest(p_cds)', 'not public.rota_068_pedido_entregue(c) from unnest(p_cds)'),
    ('autorizacao_helper', "if auth.uid() is null or not coalesce(public.eh_equipe(),false) then raise exception 'somente equipe le historico' using errcode='42501';end if;", ''),
    ('historico', 'public.rota_068_recebido_dia(p_cd)<public.rota_068_hoje()', 'public.rota_068_recebido_dia(p_cd)>public.rota_068_hoje()'),
    ('precedencia', '(select e.data_entrega from public.pedido_entrega_rota e where e.cd_pedido=p_cd),', ''),
    ('origem_passada', 'where public.rota_068_pedido_entregue(p.cd_pedido)', 'where public.rota_065_travada(p.dia,p.veiculo_id)'),
    ('pendencia055', 'or (not coalesce(public.rota_068_recebido_dia(p_cd)<public.rota_068_hoje(),false) and public.rota_068h_pendente_base(p_cd,p_dia));', 'and (not coalesce(public.rota_068_recebido_dia(p_cd)<public.rota_068_hoje(),false) and public.rota_068h_pendente_base(p_cd,p_dia));'),
    ('foto_antiga', 'and (i.incluido_em>=r.criada_em or f.fechada_em>=r.criada_em)', ''),
    ('uuid', 'if prev.entrada<>inp then', 'if false then'),
    ('destino', 'or not public.rota_065_dia_editavel(p_dia)', ''),
    ('canonicaC', " d:=replace(d,'select er.cd_pedido,er.data_entrega,','select er.cd_pedido,coalesce((select h.recebido_dia from public.rota_068h_reprogramacao h where h.cd_pedido=er.cd_pedido),er.data_entrega) as data_entrega,');", ''),
]
for i, (name, before, after) in enumerate(mutations, 1):
    assert before in migration, name
    mutant = OUT / f'mutacao_{i}_{name}.sql'
    mutant.write_text(migration.replace(before, after, 1), encoding='utf-8')
    db = PREFIX + '_m' + str(i)
    clone(db, prep)
    r = sql(db, '-v', 'migracaoH=' + mutant.as_posix(), '-f', str(tests))
    (OUT / f'mutacao_{i}_{name}.txt').write_text(r.stdout + r.stderr, encoding='utf-8')
    assert r.returncode != 0 and 'ERROR:  FAIL:' in r.stderr, (name, r.stderr[-1500:])
    print(f'MUT {i} {name}: detectada', flush=True)
candidate_c=(ROOT/'admin/migracoes/068_c_entrega_automatica.sql').read_text(encoding='utf-8')
floor="and (fat.em at time zone 'America/Sao_Paulo')::date>=date '2026-11-23'"
assert floor in candidate_c
mutant_c=OUT/'mutacao_13_C_sem_piso.sql'
mutant_c.write_text(candidate_c.replace(floor,''),encoding='utf-8')
db=PREFIX+'_c_sem_piso'
clone(db,prep)
r=sql(db,'-f',str(mutant_c))
assert r.returncode==0,r.stderr
r=sql(db,'-f',str(tests))
(OUT/'mutacao_13_C_sem_piso.txt').write_text(r.stdout+r.stderr,encoding='utf-8')
assert r.returncode!=0 and 'ERROR:  FAIL:' in r.stderr,r.stderr[-1800:]
print('MUT 13 C_sem_piso: detectada; total13/13 por assercao funcional',flush=True)

