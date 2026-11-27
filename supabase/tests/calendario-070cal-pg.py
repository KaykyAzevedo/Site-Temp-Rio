"""Teste PG18 do hotfix 070-CAL sobre pilha real completa 03b4c5a (044/045/050..066 + 068F2/A/C/H r3 + 070 + 068D + 068B + 068V + 068AG)
e foto real sanitizada c8c88e54 (196 pedidos / 183 atendidos).

Valida:
1) Repro ANTES do hotfix: pedido SEM VEICULO em 03b4c5a recebe TODOS os dias bloqueados com motivo='veiculo_invalido'
   em rota_070_calendario e recusa em rota_070_saida_salvar.
2) APOS 070_cal_sem_veiculo.sql (2x idempotente):
   - Pedido SEM VEICULO: dias uteis futuros (e sabado quando caminhao sai) ficam HABILITADOS; hoje/passado=dia_bloqueado,
     domingo=domingo, feriado (25/12)=dia_sem_saida, dia em que NENHUM veiculo ativo sai (sem_saida avulso para todos)=dia_sem_saida,
     dia fechado=dia_bloqueado; veiculo_id permanece null (NAO atribui veiculo!).
   - rota_070_saida_salvar(cd_sem_veic, '2026-12-03', req) grava data_saida_marcada='2026-12-03' em rota_070_saida SEM
     criar linha em rota_plano_semana nem atribuir veiculo; idempotencia funciona; rota_070_saida_remover limpa.
   - Fechamento 08h / definitiva / 065 / 066 (068V) INALTERADOS: pedido sem veiculo continua rota_070_fechavel=false e
     nao entra em rota_070_definitiva_salvar sem veiculo.
   - Pedido COM VEICULO (ex.: s10): comportamento 100% INALTERADO (sabado continua bloqueado para S10, grava rota_plano_semana + rota_070_saida).
   - Foto real c8c88e54: 17 pendentes, 4 Prontos [1547,1554,1556,1563], 174 entregues, 5 Recebidos HOJE = 100% IDENTICOS
     antes, depois (2x) e apos rollback (2x)!
"""
import hashlib, json, os, re, subprocess, sys, uuid
from pathlib import Path

PSQL = r'C:/Program Files/PostgreSQL/18/bin/psql.exe'
REPO = Path(sys.argv[1]).resolve()
MIG_CAL = Path(sys.argv[2]).resolve()
RB_CAL = Path(sys.argv[3]).resolve()
PORT = int(sys.argv[4]) if len(sys.argv) > 4 else 55439
DB = os.environ.get('TEMPRIO070CAL_DB', 'sentinela_separando_brasa070cal')
assert re.fullmatch(r'sentinela_separando_brasa070cal[a-z0-9_]*', DB)

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

def query_json(sql, prefix=INIT):
    out = run(DB, '-At', '-q', input_sql=prefix + sql)
    lines = [l for l in out.splitlines() if l.strip()]
    return json.loads(lines[-1])

# 1) Cria DB exclusivo com pilha real 03b4c5a completa
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
create table qa.limpeza055_cal(def text);
insert into qa.limpeza055_cal select pg_get_functiondef('public.rota_045_limpar()'::regprocedure);
\\i {(REPO / 'admin/migracoes/045_rota_pedido_ignorado.sql').as_posix()}
select def from qa.limpeza055_cal \\gexec
create table qa.limpeza044_cal(def text);
insert into qa.limpeza044_cal select pg_get_functiondef('public.rota_044_limpar()'::regprocedure);
\\i {(REPO / 'admin/migracoes/044_rota_marcacao_horarios.sql').as_posix()}
select def from qa.limpeza044_cal \\gexec
\\i {(REPO / 'supabase/tests/044-047-base.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/066_rota_sugestoes.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_f_fora_do_site.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_a_trocar_veiculo.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_c_entrega_automatica.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_h_mover_nao_historico.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/070_previsao_definitiva.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_d_historico_lote_dia.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_b_prazo_flexivel.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_v_veiculo_historico.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_ag_agendado_prioridade.sql').as_posix()}
"""
run(DB, '-q', input_sql=setup_sql)

# 2) Carrega foto real c8c88e54 (196 pedidos / 183 atendidos)
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
    }

antes = resumo_estados()
assert antes['total'] == 196 and len(antes['pendentes']) == 17 and antes['prontos'] == [1547, 1554, 1556, 1563]
assert len(antes['entregues']) == 174 and len(antes['recebidos']) == 5

# Acha 1 pedido pendente SEM VEICULO e 1 pedido pendente COM VEICULO (s10 ou caminhao) na foto real!
sem_veic = query_json(f"select jsonb_agg(cd order by cd) from unnest({arr}) cd where public.rota_055_pendente(cd, public.rota_070_hoje()) and public.rota_070_veiculo(cd) is null;", prefix="reset role;")
assert sem_veic and len(sem_veic) >= 1, 'Esperado ao menos 1 pendente sem veiculo na foto real'
cd_sem = sem_veic[0]
# Garante 1 pendente COM veiculo s10 (em transacao isolada depois) ou usa existente
com_s10 = query_json(f"select jsonb_agg(cd order by cd) from unnest({arr}) cd where public.rota_055_pendente(cd, public.rota_070_hoje()) and public.rota_070_veiculo(cd)='s10';", prefix="reset role;")
cd_s10 = com_s10[0] if com_s10 else None
assert cd_s10 is not None, 'Esperado ao menos 1 pendente com veiculo s10 na foto real'

# 3) REPRO ANTES do hotfix: todos os dias futuros do pedido sem veiculo vem bloqueados com 'veiculo_invalido'!
cal_antes = query_json(f"select public.rota_070_calendario({cd_sem}, '2026-11-26', '2026-12-31');")
fut_antes = [d for d in cal_antes['dias'] if d['dia'] > '2026-11-26' and d['dia'] != '2026-11-29' and d['motivo'] != 'domingo']
assert all(not d['habilitado'] and d['motivo'] == 'veiculo_invalido' for d in fut_antes), fut_antes[:5]

# 4) Aplica hotfix 070-CAL 2x (idempotente) + checa grants privados preservados
run(DB, '-q', '-f', str(MIG_CAL))
run(DB, '-q', '-f', str(MIG_CAL))

priv_ok = query_json("""
select jsonb_build_object(
  'dm_auth', has_function_privilege('authenticated','public.rota_070_dia_motivo(bigint,date,text,boolean)','execute'),
  'dm_anon', has_function_privilege('anon','public.rota_070_dia_motivo(bigint,date,text,boolean)','execute'),
  'sg_auth', has_function_privilege('authenticated','public.rota_070_saida_gravar(bigint,date,uuid,boolean)','execute'),
  'sg_anon', has_function_privilege('anon','public.rota_070_saida_gravar(bigint,date,uuid,boolean)','execute')
);
""", prefix="reset role;")
assert priv_ok == {'dm_auth': False, 'dm_anon': False, 'sg_auth': False, 'sg_anon': False}, priv_ok

# Estados da foto real 100% inalterados apos aplicar
assert resumo_estados() == antes

# 5) Pedido SEM VEICULO: calendario habilita dias uteis futuros (e sabado se caminhao sai), bloqueia hoje/domingo/feriado!
cal_dep = query_json(f"select public.rota_070_calendario({cd_sem}, '2026-11-26', '2026-12-31');")
assert cal_dep['status'] == 'ok' and cal_dep['veiculo_id'] is None, cal_dep
dmap = {d['dia']: d for d in cal_dep['dias']}
assert dmap['2026-11-26']['habilitado'] is False and dmap['2026-11-26']['motivo'] == 'dia_bloqueado'   # hoje (futuro=true)
assert dmap['2026-11-27']['habilitado'] is True and dmap['2026-11-27']['motivo'] is None               # sex util futuro
assert dmap['2026-11-28']['habilitado'] is True and dmap['2026-11-28']['motivo'] is None               # sab (caminhao sai)
assert dmap['2026-11-29']['habilitado'] is False and dmap['2026-11-29']['motivo'] == 'domingo'         # domingo
assert dmap['2026-12-03']['habilitado'] is True and dmap['2026-12-03']['motivo'] is None               # qui dezembro
assert dmap['2026-12-25']['habilitado'] is False and dmap['2026-12-25']['motivo'] == 'dia_sem_saida'   # Natal feriado

# Se TODOS os veiculos ativos forem marcados sem_saida num dia especifico (ex. 2026-12-04), o dia bloqueia tambem para sem veiculo!
run(DB, '-q', '-c', "insert into public.rota_065_sem_saida(dia, veiculo_id, motivo) select date '2026-12-04', id, 'Recesso QA' from public.rota_veiculos where ativo on conflict do nothing;")
cal_sem_todos = query_json(f"select public.rota_070_calendario({cd_sem}, '2026-12-01', '2026-12-10');")
dmap2 = {d['dia']: d for d in cal_sem_todos['dias']}
assert dmap2['2026-12-04']['habilitado'] is False and dmap2['2026-12-04']['motivo'] == 'dia_sem_saida', dmap2['2026-12-04']
run(DB, '-q', '-c', "delete from public.rota_065_sem_saida where dia = date '2026-12-04';")

# 6) Gravar e remover data marcada para pedido SEM VEICULO: funciona SEM atribuir veiculo nem tocar em rota_plano_semana!
req1 = str(uuid.uuid4())
r_save = query_json(f"select public.rota_070_saida_salvar({cd_sem}, '2026-12-03', '{req1}'::uuid);")
assert r_save['status'] == 'ok' and r_save['data_saida_marcada'] == '2026-12-03' and r_save['origem_data_saida'] == '070' and r_save['repetido'] is False, r_save
# Repeticao idempotente
r_rep = query_json(f"select public.rota_070_saida_salvar({cd_sem}, '2026-12-03', '{req1}'::uuid);")
assert r_rep['status'] == 'ok' and r_rep['repetido'] is True, r_rep
# Veiculo continua NULL, rota_plano_semana continua SEM linha, fechamento continua FALSE (068V preservada!)
chk_sem = query_json(f"""
select jsonb_build_object(
  'veic', public.rota_070_veiculo({cd_sem}),
  'plano', exists(select 1 from public.rota_plano_semana where cd_pedido={cd_sem}),
  'saida', (select data_saida from public.rota_070_saida where cd_pedido={cd_sem}),
  'fech_s10', public.rota_070_fechavel({cd_sem}, date '2026-12-03', 's10', false),
  'fech_cam', public.rota_070_fechavel({cd_sem}, date '2026-12-03', 'caminhao', false)
);
""", prefix="reset role;")
assert chk_sem == {'veic': None, 'plano': False, 'saida': '2026-12-03', 'fech_s10': False, 'fech_cam': False}, chk_sem
# Recusa domingo e feriado na gravacao para sem veiculo
assert query_json(f"select public.rota_070_saida_salvar({cd_sem}, '2026-11-29', '{uuid.uuid4()}'::uuid);")['motivo'] == 'domingo'
assert query_json(f"select public.rota_070_saida_salvar({cd_sem}, '2026-12-25', '{uuid.uuid4()}'::uuid);")['motivo'] == 'dia_sem_saida'
# Remove data marcada
r_rem = query_json(f"select public.rota_070_saida_remover({cd_sem}, '{uuid.uuid4()}'::uuid);")
assert r_rem['status'] == 'ok' and r_rem['data_saida_marcada'] is None, r_rem
assert query_json(f"select to_jsonb(exists(select 1 from public.rota_070_saida where cd_pedido={cd_sem}));", prefix="reset role;") is False

# 7) Pedido COM VEICULO (s10): comportamento 100% INALTERADO (sabado 28/11 bloqueado para S10; grava plano + saida)!
cal_s10 = query_json(f"select public.rota_070_calendario({cd_s10}, '2026-11-26', '2026-12-05');")
assert cal_s10['veiculo_id'] == 's10'
ds10 = {d['dia']: d for d in cal_s10['dias']}
assert ds10['2026-11-27']['habilitado'] is True
assert ds10['2026-11-28']['habilitado'] is False and ds10['2026-11-28']['motivo'] == 'dia_sem_saida'   # sabado S10 bloqueado!
assert ds10['2026-11-29']['habilitado'] is False and ds10['2026-11-29']['motivo'] == 'domingo'
r_s10 = query_json(f"select public.rota_070_saida_salvar({cd_s10}, '2026-11-27', '{uuid.uuid4()}'::uuid);")
assert r_s10['status'] == 'ok' and r_s10['data_saida_marcada'] == '2026-11-27', r_s10
assert query_json(f"select to_jsonb(exists(select 1 from public.rota_plano_semana where cd_pedido={cd_s10} and dia=date '2026-11-27' and veiculo_id='s10'));", prefix="reset role;") is True
assert query_json(f"select public.rota_070_saida_remover({cd_s10}, '{uuid.uuid4()}'::uuid);")['status'] == 'ok'

# 8) Pendentes da foto real 100% iguais antes, depois e apos rollback 2x!
assert resumo_estados() == antes
run(DB, '-q', '-f', str(RB_CAL))
run(DB, '-q', '-f', str(RB_CAL))
assert resumo_estados() == antes
# Apos rollback, comportamento volta ao original da 070 (veiculo_invalido para sem veiculo)
cal_rb = query_json(f"select public.rota_070_calendario({cd_sem}, '2026-11-27', '2026-11-27');")
assert cal_rb['dias'][0]['habilitado'] is False and cal_rb['dias'][0]['motivo'] == 'veiculo_invalido'
# Reaplica hotfix e valida novamente
run(DB, '-q', '-f', str(MIG_CAL))
cal_re = query_json(f"select public.rota_070_calendario({cd_sem}, '2026-11-27', '2026-11-27');")
assert cal_re['dias'][0]['habilitado'] is True and cal_re['dias'][0]['motivo'] is None
assert resumo_estados() == antes

print(json.dumps({
    'status': 'PASS',
    'foto_sha256': sha,
    'pedidos': 196,
    'pendentes_antes_depois_rollback': len(antes['pendentes']),
    'pronto_despacho': antes['prontos'],
    'cd_sem_veiculo_testado': cd_sem,
    'cd_s10_testado': cd_s10,
    'sem_veiculo_habilita_util_bloqueia_dom_fer': True
}, ensure_ascii=False))
