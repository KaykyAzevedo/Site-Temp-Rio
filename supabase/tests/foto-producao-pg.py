"""Importa somente foto sanitizada em DB local exclusivo; nunca toca producao."""
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
FORJA = ROOT.parent
PHOTO = ROOT / 'evidencias_foto/entradas'
OUT = ROOT / 'evidencias_foto'
OUT.mkdir(exist_ok=True)
BASE = ['C:/Program Files/PostgreSQL/18/bin/psql.exe', '-h', '127.0.0.1', '-p', '55439', '-U', 'qa', '-v', 'ON_ERROR_STOP=1']
DB = 'sentinela_separando_cpf_forja068hr3_foto'
UID = '22222222-2222-4222-8222-222222222222'

def envelope(name):
    value = json.loads((PHOTO / name).read_text(encoding='utf-8-sig'))
    if 'rows' in value:
        value = value['rows'][0]
        if len(value) == 1:
            value = next(iter(value.values()))
    return json.loads(value) if isinstance(value, str) else value

foto = envelope('foto_producao.json')
extra = envelope('foto_complemento.json')
residual = envelope('foto_C_residual.json')
sha = hashlib.sha256((PHOTO / 'foto_producao.json').read_bytes()).hexdigest()
assert sha == '163f65801105543ed0f26a13afd1a4c94c0a8e6bccd7f4576d3f3fe6e8c278f6'
assert len(foto['pedidos']) == 196
assert sum(p['etapa'] in ('saiu', 'atendido') for p in foto['pedidos']) == 179
assert not extra['reprogramacao068h'] and not residual['entrega_problema']
assert {(x['cd_pedido'], x['data_entrega']) for x in residual['entrega_rota']} == {(x['cd_pedido'], x['dia_saida']) for x in foto['saidas059']}
assert {x['cd_pedido'] for x in extra['canhoto']} == {x['cd_pedido'] for x in foto['canhoto']}

def run(db, *args, ok=True):
    r = subprocess.run(BASE + ['-d', db, *args], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if ok and r.returncode:
        raise RuntimeError(r.stderr[-4500:])
    return r

assert re.fullmatch('sentinela_separando_cpf_forja068hr3[a-z0-9_]*', DB)
run('postgres', '-c', f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)', '-c', f'CREATE DATABASE {DB} TEMPLATE sentinela_separando_cpf_forja068cr2')
run(DB, '-f', str(ROOT / 'supabase/tests/h-base.sql'))
run(DB, '-f', str(ROOT / 'admin/migracoes/068_c_rollback.sql'))

sql = ["reset role;set qa.uid='"+UID+"';set qa.role='authenticated';set timezone='America/Sao_Paulo';"]
clear = ['pedido_entrega_problema_requisicao', 'pedido_entrega_problema', 'pedido_entrega_rota', 'pedido_entrega_confirmacao', 'pedido_canhoto', 'rota_plano_semana', 'rota_pedido_veiculo', 'rota_cliente_veiculo', 'rota_pedido_ignorado', 'rota_dia_item', 'rota_dia_fechada', 'solidcon_pedidos_erp', 'rota_065_semana', 'rota_065_sem_saida']
for table in clear:
    sql.append(f'DELETE FROM public.{table};')
sql.append("alter table public.solidcon_pedidos_erp add column if not exists dt_carga timestamptz,add column if not exists dt_sep_fim timestamptz,add column if not exists dt_conferencia timestamptz,add column if not exists nr_carga bigint,add column if not exists atualizado_em timestamptz,add column if not exists caixas_24 integer,add column if not exists caixas_48 integer,add column if not exists caixas_outras integer;")
sql.append("alter table public.rota_veiculos add column if not exists capacidade_volume numeric,add column if not exists cor text,add column if not exists ordem integer,add column if not exists volta_sede boolean;")
run(DB, '-c', sql.pop())
run(DB, '-c', sql.pop())

def insert(table, rows, defaults=None, upsert=None):
    if not rows:
        return
    fields = json.loads(run(DB, '-At', '-c', "select json_agg(column_name) from information_schema.columns where table_schema='public' and table_name='"+table+"'").stdout)
    data = []
    for row in rows:
        item = dict(defaults or {})
        item.update({k: v for k, v in row.items() if k in fields})
        data.append(item)
    columns = sorted(set().union(*(x.keys() for x in data)))
    cols = ','.join('"'+x+'"' for x in columns)
    text = json.dumps(data, ensure_ascii=False)
    statement = f'INSERT INTO public.{table}({cols}) OVERRIDING SYSTEM VALUE SELECT {cols} FROM jsonb_populate_recordset(NULL::public.{table},$foto${text}$foto$)'
    if upsert:
        statement += ' ON CONFLICT('+upsert+') DO UPDATE SET '+','.join('"'+x+'"=excluded."'+x+'"' for x in columns if x != upsert)
    sql.append(statement+';')

pedidos = [dict(p, documento=None, cliente_nome=None) for p in foto['pedidos']]
insert('solidcon_pedidos_erp', pedidos)
insert('rota_veiculos', foto['veiculos'], upsert='id')
insert('rota_config', foto['config'], upsert='id')
insert('rota_pedido_veiculo', foto['veiculo_pedido'])
insert('rota_pedido_ignorado', foto['ignorado045'], {'motivo': 'foto sanitizada QA', 'atualizado_por': UID})
insert('pedido_entrega_confirmacao', foto['entrega063'], {'confirmado_por': UID, 'confirmado_nome': None, 'motivo': None, 'desfeito_nome': None, 'desfeito_por': None})
insert('pedido_canhoto', extra['canhoto'], {'caminho': '2026-11-25/1528/22222222-2222-4222-8222-222222222222.jpg', 'enviado_por': UID})
insert('rota_dia_fechada', foto['fechada050'], {'fechada_por': UID, 'fechada_nome': None})
insert('rota_dia_item', foto['item050'], {'documento': None})
insert('rota_plano_semana', foto['plano065'])
insert('rota_065_semana', extra['semana065'])
insert('rota_065_sem_saida', extra['sem_saida065'])
erp = {p['cd_pedido']: p for p in foto['pedidos']}
insert('pedido_entrega_rota', [dict(x, cliente_tipo=erp[x['cd_pedido']]['cliente_tipo'], documento=None, cliente_nome=None) for x in residual['entrega_rota']])
# Os corpos lidos no rollback sao a referencia, nao uma aproximacao da055/063/065.
for key, body in foto['corpos'].items():
    if key.startswith(('rota_055_pendente(', 'rota_063_ler_entregas(', 'rota_065_ler_semana(', 'rota_065_salvar_semana(', 'rota_065_plano_guardar(')):
        sql.append(body.rstrip().rstrip(';')+';')
path = OUT / 'carregar_foto.sql'
path.write_text('\n'.join(sql)+'\n', encoding='utf-8')
r = run(DB, '-f', str(path))
(OUT / 'carregar_foto.txt').write_text(r.stdout+r.stderr, encoding='utf-8')
metadata = {'foto_sha256': sha, 'capturado_em_sp': foto['capturado_em_sp'], 'complemento_capturado_em_sp': extra['capturado_em_sp'], 'C_residual_capturado_em_sp': residual['capturado_em_sp'], 'complemento_sha256': hashlib.sha256((PHOTO/'foto_complemento.json').read_bytes()).hexdigest(), 'C_residual_sha256': hashlib.sha256((PHOTO/'foto_C_residual.json').read_bytes()).hexdigest(), 'pedidos':196,'saiu_atendido':179,'C_residual_consistente_com_059':True,'problema_ativo':0,'reprogramacao_ativa':0,'observacao':'Complementos em instantes distintos. Conjunto C/datas059 e IDs canhoto conferidos. Valores faltantes de ator/texto foram preenchidos somente para constraints QA; nao usados nos predicados. Marcas por cliente md5 sao contexto JS, nao prova de entrega.'}
(OUT / 'proveniencia.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

ids = [p['cd_pedido'] for p in foto['pedidos']]
init = "set qa.uid='"+UID+"';set qa.role='authenticated';"
def get_json(query):
    raw = run(DB,'-At','-c',init+query).stdout
    start=min((raw.index(x) for x in ['[','{'] if x in raw),default=-1)
    assert start>=0,raw[:300]
    return json.loads(raw[start:].strip())

before = get_json("select json_agg(json_build_object('cd_pedido',p.cd_pedido,'pendente',public.rota_055_pendente(p.cd_pedido,date '"+foto['dia_sp']+"')) order by p.cd_pedido) from public.solidcon_pedidos_erp p;")
(OUT/'pendentes_baseline_SQL.json').write_text(json.dumps(before, indent=2)+'\n',encoding='utf-8')
print('FOTO importada196/179, baseline pendenteSQL='+str(sum(x['pendente'] for x in before)),flush=True)

run(DB,'-f',str(FORJA/'pacote_068C_r3_testes_node_20261126/admin/migracoes/068_c_entrega_automatica.sql'))
run(DB,'-f',str(FORJA/'pacote_068H_r2_permissao_helper_20261126/admin/migracoes/068_h_mover_nao_historico.sql'))
# Data de referencia congelada no instante fotografado (SP).
run(DB,'-c',"create or replace function public.rota_068_hoje() returns date language sql stable set search_path='' as $$select date '"+foto['dia_sp']+"'$$;")
old = get_json("select json_agg(s order by s.cd_pedido) from public.rota_068_estados_pedidos(array["+','.join(map(str,ids))+"]::bigint[]) s;")
(OUT/'estados_H_3122f90.json').write_text(json.dumps(old,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
run(DB,'-f',str(FORJA/'pacote_068H_r2_permissao_helper_20261126/admin/migracoes/068_h_rollback.sql'))
run(DB,'-f',str(ROOT/'admin/migracoes/068_c_rollback.sql'))
run(DB,'-f',str(ROOT/'admin/migracoes/068_c_entrega_automatica.sql'))
run(DB,'-f',str(ROOT/'admin/migracoes/068_h_mover_nao_historico.sql'))
run(DB,'-c',"create or replace function public.rota_068_hoje() returns date language sql stable set search_path='' as $$select date '"+foto['dia_sp']+"'$$;")
new = get_json("select json_agg(s order by s.cd_pedido) from public.rota_068_estados_pedidos(array["+','.join(map(str,ids))+"]::bigint[]) s;")
(OUT/'estados_corrigidos_196.json').write_text(json.dumps(new,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
sources = get_json("select json_agg(json_build_object('cd_pedido',p.cd_pedido,'data_canonica',public.rota_068_recebido_dia(p.cd_pedido),'C',(select data_entrega from public.pedido_entrega_rota where cd_pedido=p.cd_pedido),'063',(select max(confirmado_em) from public.pedido_entrega_confirmacao where cd_pedido=p.cd_pedido and desfeito_em is null),'canhoto',(select max(enviado_em) from public.pedido_canhoto where cd_pedido=p.cd_pedido and substituido_em is null),'059',(select max(dia_saida) from public.rota_059_saidas where cd_pedido=p.cd_pedido),'etapa',p.etapa,'ERP_data',coalesce(p.dt_saida,p.dt_nota,p.dt_atendido)) order by p.cd_pedido) from public.solidcon_pedidos_erp p;")
for source in sources:
    source['fonte_canonica']=next((name for name in ['C','063','canhoto','059'] if source.get(name)),None)
    if not source['fonte_canonica'] and source['data_canonica'] and source['etapa'] in ('saiu','atendido'):
        source['fonte_canonica']='ERP_legado_pre23_ou_canhoto_desde'
(OUT/'fontes_provas_196.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
assert len(old)==len(new)==196
assert sum(x['entregue'] for x in new)==174
assert sum(not x['entregue'] and not x['pendente'] for x in new)==5
assert all(next(x for x in new if x['cd_pedido']==i)['entregue'] for i in range(1365,1380) if i in ids)
assert {x['cd_pedido'] for x in new if x['pendente']}=={x['cd_pedido'] for x in before if x['pendente']}
print('H antigo entregue=false '+str(sum(not x['entregue'] for x in old))+'; corrigido pendentes '+str(sum(x['pendente'] for x in new))+'; flags196 emitidas',flush=True)

# Reversao completa2x sobre a foto: corpos reais d52 restaurados, depois reaplicar sem mudar196flags.
for rollback in ['068_h_rollback.sql','068_h_rollback.sql','068_c_rollback.sql','068_c_rollback.sql']:
    run(DB,'-f',str(ROOT/'admin/migracoes'/rollback))
for key, expected in foto['corpos'].items():
    if key.startswith(('rota_055_pendente(', 'rota_063_ler_entregas(')):
        signature='public.'+key.split('(')[0]
        signature += '(bigint,date)' if key.startswith('rota_055') else '(bigint[])'
        actual=run(DB,'-At','-c',"select pg_get_functiondef('"+signature+"'::regprocedure)").stdout
        normalize=lambda text:'\n'.join(line for line in text.replace('\r','').strip().rstrip(';').splitlines() if line.strip())
        assert normalize(actual)==normalize(expected),key
run(DB,'-f',str(ROOT/'admin/migracoes/068_c_entrega_automatica.sql'))
run(DB,'-f',str(ROOT/'admin/migracoes/068_h_mover_nao_historico.sql'))
run(DB,'-c',"create or replace function public.rota_068_hoje() returns date language sql stable set search_path='' as $$select date '"+foto['dia_sp']+"'$$;")
after=get_json("select json_agg(s order by s.cd_pedido) from public.rota_068_estados_pedidos(array["+','.join(map(str,ids))+"]::bigint[]) s;")
assert after==new
(OUT/'rollback_foto.txt').write_text('H3/C rollback2x:055/063 iguais ao corpo reald52 exceto EOL/linhas vazias; reaplicar196estados identicos; backupsH2/H3 separados.\n',encoding='utf-8')
print('Foto rollbackH3/C2x e reaplicar:196estados identicos',flush=True)
