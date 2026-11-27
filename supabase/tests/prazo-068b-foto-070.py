"""Teste PG18 de integracao 068B r8 sobre pilha real 216d678 (050..066 + 068F2/A/C/H r3 + 070 + 068D)
com a foto real sanitizada c8c88e54 (196 pedidos / 183 atendidos).
Comprova: pendentes (17) e pronto_despacho (4) e entregues (174) e recebidos hoje (5) NAO MUDAM
antes, depois da 068B r8 (2x) e apos rollback (2x); travado === entregue nos 196 pedidos."""
import hashlib, json, os, re, subprocess, sys
from pathlib import Path

PSQL = r'C:/Program Files/PostgreSQL/18/bin/psql.exe'
REPO = Path(sys.argv[1]).resolve()
MIG_B = Path(sys.argv[2]).resolve()
RB_B = Path(sys.argv[3]).resolve()
PORT = int(sys.argv[4]) if len(sys.argv) > 4 else 55439
DB = os.environ.get('TEMPRIO068B_FOTO_DB', 'sentinela_separando_brasa068b_foto')
assert re.fullmatch(r'sentinela_separando_brasa068b[a-z0-9_]*', DB)

FOTO = REPO / 'supabase/tests/fixtures/070/foto_070_producao.json'
SHA_ESPERADO = 'c8c88e541a472370f857def508fb317274fa0574d1851c773708f098d2ebe58f'
sha = hashlib.sha256(FOTO.read_bytes()).hexdigest()
assert sha == SHA_ESPERADO, f'SHA inesperado da foto 070: {sha}'

BASE = [PSQL, '-X', '-h', '127.0.0.1', '-p', str(PORT), '-U', 'qa', '-v', 'ON_ERROR_STOP=1']
UID_MARCIO = '22222222-2222-4222-8222-222222222222'
INIT = f"set qa.uid='{UID_MARCIO}'; set qa.role='authenticated'; set role authenticated;"

def run(db, *args, input_sql=None):
    r = subprocess.run(BASE + ['-d', db, *args], input=input_sql, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode:
        raise RuntimeError(f'psql falhou ({r.returncode}): {r.stderr[-4000:]}')
    return r.stdout

def query_json(sql):
    out = run(DB, '-At', '-q', input_sql=INIT + sql)
    lines = [l for l in out.splitlines() if l.strip()]
    return json.loads(lines[-1])

# 1) Cria DB exclusivo e instala pilha completa de producao 216d678 (050..065 + 044/045 + 068F2/A/C/H r3 + 070 + 068D + 066)
run('postgres', '-q', '-c', f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)')
run('postgres', '-q', '-c', f'CREATE DATABASE {DB}')

setup_sql = f"""
\\i {(REPO / 'supabase/tests/rota-semana-065.sql').as_posix()}
reset role; set search_path = public, pg_catalog; set timezone = 'America/Sao_Paulo';
create or replace function public.texto_seguro(p_valor text, p_tamanho_maximo integer default 200)
returns boolean language sql immutable as $$
  select p_valor is null or (char_length(p_valor) <= p_tamanho_maximo and p_valor !~ '[<>]');
$$;
alter table public.solidcon_pedidos_erp
  add column if not exists dt_pedido timestamptz default now(),
  add column if not exists cliente_tipo text default 'cnpj',
  add column if not exists cliente_nome text,
  add column if not exists valor_centavos bigint,
  add column if not exists atualizado_em timestamptz default now(),
  add column if not exists dt_conferencia timestamptz,
  add column if not exists caixas_24 integer,
  add column if not exists caixas_48 integer,
  add column if not exists caixas_outras integer;
create table if not exists public.solidcon_clientes(documento text primary key, nome text);
create table if not exists public.solidcon_clientes_geo(documento text primary key, lat double precision, lng double precision, precisao text);
alter table public.rota_veiculos add column if not exists capacidade_volume integer;
alter table public.rota_pedido_ignorado add column if not exists motivo text, add column if not exists atualizado_por uuid;
alter table public.rota_pedido_veiculo add column if not exists atualizado_por uuid;
create table qa.limpeza055_b8(def text);
insert into qa.limpeza055_b8 select pg_get_functiondef('public.rota_045_limpar()'::regprocedure);
\\i {(REPO / 'admin/migracoes/045_rota_pedido_ignorado.sql').as_posix()}
select def from qa.limpeza055_b8 \\gexec
create table qa.limpeza044_b8(def text);
insert into qa.limpeza044_b8 select pg_get_functiondef('public.rota_044_limpar()'::regprocedure);
\\i {(REPO / 'admin/migracoes/044_rota_marcacao_horarios.sql').as_posix()}
select def from qa.limpeza044_b8 \\gexec
\\i {(REPO / 'supabase/tests/044-047-base.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/066_rota_sugestoes.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_f_fora_do_site.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_a_trocar_veiculo.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_c_entrega_automatica.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_h_mover_nao_historico.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/070_previsao_definitiva.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_d_historico_lote_dia.sql').as_posix()}
"""
run(DB, '-q', input_sql=setup_sql)

# 2) Carrega foto real sanitizada c8c88e54 (196 pedidos / 183 atendidos)
f = json.loads(FOTO.read_text(encoding='utf-8-sig'))['rows'][0]['foto']
f = json.loads(f) if isinstance(f, str) else f
assert len(f['pedidos']) == 196 and sum(x['etapa'] == 'atendido' for x in f['pedidos']) == 183

load_sql = [f"set qa.uid='{UID_MARCIO}'; set qa.role='authenticated'; set timezone='America/Sao_Paulo';"]
for t in [
    'rota_070_requisicao', 'rota_070_recebimento', 'rota_070_reserva', 'rota_070_definitiva', 'rota_070_saida', 'rota_070_prontidao',
    'rota_068h_movimento_log', 'rota_068h_reprogramacao', 'pedido_entrega_problema_requisicao', 'pedido_entrega_problema',
    'pedido_entrega_rota', 'pedido_entrega_confirmacao', 'pedido_canhoto', 'rota_plano_semana', 'rota_pedido_veiculo',
    'rota_cliente_veiculo', 'rota_pedido_ignorado', 'rota_dia_item', 'rota_dia_fechada', 'solidcon_pedidos_erp',
    'rota_065_semana', 'rota_065_sem_saida'
]:
    load_sql.append(f'delete from public.{t};')

def ins(t, rows, defaults=None, key=None):
    if not rows:
        return
    cols = set(json.loads(run(DB, '-At', '-q', '-c', f"select json_agg(column_name) from information_schema.columns where table_schema='public' and table_name='{t}'").strip().splitlines()[-1]))
    data = [dict(defaults or {}, **{k: v for k, v in r.items() if k in cols}) for r in rows]
    names = sorted(set().union(*(r.keys() for r in data)))
    cn = ','.join('"' + n + '"' for n in names)
    s = f'insert into public.{t}({cn}) overriding system value select {cn} from jsonb_populate_recordset(null::public.{t},$FOTO${json.dumps(data, ensure_ascii=False)}$FOTO$)'
    if key:
        s += ' on conflict(' + key + ') do update set ' + ','.join(f'"{n}"=excluded."{n}"' for n in names if n != key)
    load_sql.append(s + ';')

hashes = sorted({x['cliente_hash'] for x in f['pedidos'] if x.get('cliente_hash')} | {x['cliente_hash'] for x in f['cliente_veiculo'] if x.get('cliente_hash')})
docs = {h: str(10000000000000 + i) for i, h in enumerate(hashes)}
ins('rota_veiculos', f['veiculos'], key='id')
ins('rota_config', f['config'], key='id')
ins('solidcon_pedidos_erp', [dict(x, documento=docs.get(x.get('cliente_hash')) if x['cliente_tipo'] == 'cnpj' else None, cliente_nome=None) for x in f['pedidos']])
ins('rota_cliente_veiculo', [dict(x, documento=docs[x['cliente_hash']]) for x in f['cliente_veiculo']])
ins('rota_pedido_veiculo', f['veiculo_pedido'])
ins('rota_pedido_ignorado', f['ignorado045'], {'motivo': 'QA sanitizado', 'atualizado_por': UID_MARCIO})
ins('pedido_entrega_confirmacao', f['entrega063'], {'confirmado_por': UID_MARCIO, 'confirmado_nome': None, 'motivo': None, 'desfeito_nome': None, 'desfeito_por': None})
ins('pedido_canhoto', f['canhoto'], {'caminho': '2026-11-25/1528/22222222-2222-4222-8222-222222222222.jpg', 'enviado_por': UID_MARCIO})
ins('rota_dia_fechada', f['fechada050'], {'fechada_por': UID_MARCIO, 'fechada_nome': None})
ins('rota_dia_item', f['item050'], {'documento': None})
ins('rota_plano_semana', f['plano065'])
ins('rota_065_semana', f['semana065'])
ins('rota_065_sem_saida', f['sem_saida065'])
ins('pedido_entrega_rota', f['entrega_rota'], {'cliente_nome': None, 'documento': None}, key='cd_pedido')

load_sql.append("create or replace function public.rota_070_agora() returns timestamptz language sql stable set search_path='' as $$select coalesce(nullif(current_setting('qa.agora',true),''),'2026-11-26T18:12:51.634445-03')::timestamptz$$;")
load_sql.append("create or replace function public.rota_068_hoje() returns date language sql stable set search_path='' as $$select public.rota_070_hoje()$$;")
load_sql.append("create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select public.rota_070_hoje()$$;")
load_sql.append("update public.rota_070_politica set inicio=date '2026-11-26', ultimo_dia=date '2026-11-26', dias_recebidos=1 where id=1;")
run(DB, '-q', input_sql='\n'.join(load_sql))

ids = sorted(p['cd_pedido'] for p in f['pedidos'])
arr = 'array[' + ','.join(map(str, ids)) + ']::bigint[]'

def resumo_estados():
    rows = query_json(f"select jsonb_agg(to_jsonb(s) order by cd_pedido) from public.rota_070_estados_pedidos({arr}) s;")
    return {
        'total': len(rows),
        'pendentes': sorted(x['cd_pedido'] for x in rows if x['pendente']),
        'prontos': sorted(x['cd_pedido'] for x in rows if x['pronto_despacho']),
        'entregues': sorted(x['cd_pedido'] for x in rows if x['entregue']),
        'recebidos': sorted(x['cd_pedido'] for x in rows if x['estado_070'] == 'recebido'),
        'mapa': {x['cd_pedido']: x for x in rows}
    }

# 3) Snapshot ANTES da 068B r8
antes = resumo_estados()
assert antes['total'] == 196
assert len(antes['pendentes']) == 17, f"Esperado 17 pendentes antes, obtido {len(antes['pendentes'])}"
assert antes['prontos'] == [1547, 1554, 1556, 1563], f"Prontos inesperados antes: {antes['prontos']}"
assert len(antes['entregues']) == 174, f"Esperado 174 entregues antes, obtido {len(antes['entregues'])}"
assert len(antes['recebidos']) == 5, f"Esperado 5 recebidos hoje antes, obtido {len(antes['recebidos'])}"

# 4) Aplica 068B r8 2x (idempotencia) e compara estados + prazo_ler + calendario + salvamento
run(DB, '-q', '-f', str(MIG_B))
run(DB, '-q', '-f', str(MIG_B))

depois = resumo_estados()
assert depois['pendentes'] == antes['pendentes'], 'Pendentes mudaram apos 068B r8!'
assert depois['prontos'] == antes['prontos'], 'Prontos mudaram apos 068B r8!'
assert depois['entregues'] == antes['entregues'], 'Entregues mudaram apos 068B r8!'
assert depois['recebidos'] == antes['recebidos'], 'Recebidos hoje mudaram apos 068B r8!'

# Coerencia 100%: travado em rota_068_prazo_ler === entregue do 070 em TODOS os 196 pedidos!
prazos = query_json(f"select jsonb_agg(to_jsonb(p) order by cd_pedido) from public.rota_068_prazo_ler({arr}) p;")
assert len(prazos) == 196
travados = sorted(x['cd_pedido'] for x in prazos if x['travado'])
liberados = sorted(x['cd_pedido'] for x in prazos if not x['travado'])
assert travados == depois['entregues'], f'Divergencia travado vs entregue 070: {len(travados)} vs {len(depois["entregues"])}'
assert liberados == sorted(depois['pendentes'] + depois['recebidos']), 'Liberados devem ser exatamente pendentes + recebidos hoje!'

# Operacoes reais sobre a foto: pendente (1547) e recebido de hoje editaveis; historico (1365) travado!
cd_rec_hoje = depois['recebidos'][0]
r_pend = query_json("select public.rota_068_prazo_salvar(1547, 'data', null, '2026-12-09', 'pedido', 'Agendado foto 070', null);")
assert r_pend['status'] == 'ok' and r_pend['prazo_ideal'] == '2026-12-09', r_pend
r_rec = query_json(f"select public.rota_068_prazo_salvar({cd_rec_hoje}, 'data', null, '2026-12-09', 'pedido', 'Recebido hoje editavel', null);")
assert r_rec['status'] == 'ok' and r_rec['prazo_ideal'] == '2026-12-09', r_rec
r_hist = query_json("select public.rota_068_prazo_salvar(1365, 'data', null, '2026-12-09', 'pedido', 'Historico bloqueado', null);")
assert r_hist['status'] == 'erro' and r_hist['motivo'] == 'pedido_historico', r_hist

# Calendario B usa relogio 070 (2026-11-26) e devolve dias_prazo + config padrao
cal = query_json("select public.rota_068_calendario_veiculo('s10', '2026-11-26', '2026-12-31');")
assert cal['status'] == 'ok' and cal['hoje'] == '2026-11-26' and cal['prazo_dias_uteis_semana'] == [1, 2, 3, 4, 5], cal
dias_map = {d['dia']: d for d in cal['dias_prazo']}
assert dias_map['2026-11-26']['habilitado'] is True
assert dias_map['2026-11-29']['habilitado'] is False and dias_map['2026-11-29']['motivo'] == 'domingo'
assert dias_map['2026-12-25']['habilitado'] is False and dias_map['2026-12-25']['motivo'] == 'feriado'

# Alterar config padrao e dias uteis NAO muda pendentes do 070!
r_cfg = query_json("select public.rota_068_prazo_padrao_salvar(4, array[1,2,3,4,5,6]);")
assert r_cfg['status'] == 'ok' and r_cfg['prazo_ideal_dias'] == 4 and r_cfg['prazo_dias_uteis_semana'] == [1, 2, 3, 4, 5, 6]
depois_cfg = resumo_estados()
assert depois_cfg['pendentes'] == antes['pendentes'] and depois_cfg['prontos'] == antes['prontos']

# 068D historico continua operacional sem alteracao
hist_d = query_json("select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) from public.rota_068_historico('2026-11-01') h;")
assert isinstance(hist_d, list)

# 5) Rollback 2x da 068B r8: pendentes, prontos, entregues, recebidos, 070 e 068D intactos!
run(DB, '-q', '-f', str(RB_B))
run(DB, '-q', '-f', str(RB_B))
pos_rb = resumo_estados()
assert pos_rb['pendentes'] == antes['pendentes'], 'Pendentes mudaram apos rollback 068B!'
assert pos_rb['prontos'] == antes['prontos'], 'Prontos mudaram apos rollback 068B!'
assert pos_rb['entregues'] == antes['entregues'], 'Entregues mudaram apos rollback 068B!'
assert pos_rb['recebidos'] == antes['recebidos'], 'Recebidos mudaram apos rollback 068B!'

# 6) Reaplicar 068B r8 retoma dados preservados sem mudar pendentes!
run(DB, '-q', '-f', str(MIG_B))
r_1547 = query_json("select jsonb_agg(to_jsonb(p)) from public.rota_068_prazo_ler(array[1547::bigint]) p;")[0]
assert r_1547['prazo_ideal'] == '2026-12-09' and r_1547['origem'] == 'pedido', r_1547

print(json.dumps({
    'status': 'PASS',
    'foto_sha256': sha,
    'pedidos': 196,
    'pendentes_antes_depois_rollback': len(antes['pendentes']),
    'pronto_despacho': antes['prontos'],
    'entregues_travados': len(travados),
    'recebidos_hoje_liberados': len(antes['recebidos']),
    'coerencia_196_196': True
}, ensure_ascii=False))
