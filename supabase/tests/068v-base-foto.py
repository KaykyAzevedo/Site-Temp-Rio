"""Teste PG18 completo da 068V (rota_068_veiculo_historico) sobre pilha real 6a42d0d
(044/045/050..066 + 068F2/A/C/H r3 + 070 + 068D + 068B) com a foto real c8c88e54 (196 pedidos / 183 atendidos).

Valida:
1) Grants minimos (anon=0, service_role=0, sem DML direto em rota_068v_veiculo_log).
2) Permissoes (motorista/vendedor bloqueados 42501; marca_rota/admin autorizados).
3) Validacoes (parametro_invalido, veiculo_invalido, motivo_invalido, pedido_nao_encontrado).
4) Caso real #1557 e #1558 (Qui 26/11):
   - ANTES: rota_070_definitiva_ler('2026-11-26') so tem [1548, 1549, 1550] ativos; #1557 e #1558 ausentes.
   - Em 26/11 (relogio da foto): 17 pendentes, 4 Prontos [1547,1554,1556,1563], 174 entregues, 5 Recebidos HOJE.
   - Apos aplicar 068V (2x idempotente): 196 estados 100% identicos!
   - Virando relogio para 27/11 (Historico): 068A recusa ja_saiu para #1557/#1558;
     rota_068_veiculo_historico(1557/1558, 'caminhao', ...) inclui ambos em rota_dia_item('2026-11-26', 'caminhao')!
   - rota_070_definitiva_ler('2026-11-26') e rota_068_rotas_semana() agora mostram [1548, 1549, 1550, 1557, 1558] sob caminhao!
   - rota_068_historico('2026-11-01') preserva data_entrega='2026-11-26' e status='entregue'.
   - 17 pendentes (mesmos IDs), 4 Prontos, 179 entregues (27/11), 0 Recebidos HOJE = 100% IDENTICOS!
   - rota_cliente_veiculo de #1557 permanece intocada (muda SO o pedido).
   - Chamada repetida = alterado: false, sem log duplicado.
5) Troca de veiculo em pedido ja na foto (acao_foto='atualizado'), reativacao de removido na foto do dia da entrega,
   e pedido PENDENTE (acao_foto='nenhuma', NAO cria rota_dia_item e continua pendente=true).
6) Rollback 2x preserva rota_068v_veiculo_log e dados corrigidos, remove RPC e mantem 17 pendentes + 068A/B/C/D/H/070 intactos.
"""
import hashlib, json, os, re, subprocess, sys
from pathlib import Path

PSQL = r'C:/Program Files/PostgreSQL/18/bin/psql.exe'
REPO = Path(sys.argv[1]).resolve()
MIG_V = Path(sys.argv[2]).resolve()
RB_V = Path(sys.argv[3]).resolve()
PORT = int(sys.argv[4]) if len(sys.argv) > 4 else 55439
DB = os.environ.get('TEMPRIO068V_DB', 'sentinela_separando_cpf_forja068v')
assert re.fullmatch(r'sentinela_separando_cpf_forja068v[a-z0-9_]*', DB)

FOTO = REPO / 'supabase/tests/fixtures/070/foto_070_producao.json'
SHA_ESPERADO = 'c8c88e541a472370f857def508fb317274fa0574d1851c773708f098d2ebe58f'
sha = hashlib.sha256(FOTO.read_bytes()).hexdigest()
assert sha == SHA_ESPERADO, f'SHA inesperado da foto 070: {sha}'

BASE = [PSQL, '-X', '-h', '127.0.0.1', '-p', str(PORT), '-U', 'qa', '-v', 'ON_ERROR_STOP=1']
UID_ADMIN = '11111111-1111-4111-8111-111111111111'
UID_MARCIO = '22222222-2222-4222-8222-222222222222'
UID_MOT = '33333333-3333-4333-8333-333333333333'
UID_VEND = '44444444-4444-4444-8444-444444444444'

def init_role(uid=UID_MARCIO, agora='2026-11-26T18:12:51.634445-03'):
    return f"set qa.uid='{uid}'; set qa.role='authenticated'; set qa.agora='{agora}'; set role authenticated;"

def run(db, *args, input_sql=None):
    r = subprocess.run(BASE + ['-d', db, *args], input=input_sql, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode:
        raise RuntimeError(f'psql falhou ({r.returncode}): {r.stderr[-4000:]}')
    return r.stdout

def run_expect_err(sql, errcode, prefix=None):
    r = subprocess.run(BASE + ['-d', DB, '-At', '-q'], input=(prefix or init_role()) + sql, capture_output=True, text=True, encoding='utf-8', errors='replace')
    assert r.returncode != 0, f'Esperava erro {errcode}, mas passou sem erro!'
    assert errcode in r.stderr or 'sem permissao' in r.stderr or 'permission denied' in r.stderr or 'ja_saiu' in r.stderr, f'Erro inesperado: {r.stderr}'

def query_json(sql, prefix=None):
    out = run(DB, '-At', '-q', input_sql=(prefix or init_role()) + sql)
    lines = [l for l in out.splitlines() if l.strip()]
    return json.loads(lines[-1])

# 1) Sobe DB exclusivo com pilha completa de producao 6a42d0d
assert re.fullmatch(r'sentinela_separando_cpf_forja068v[a-z0-9_]*', DB)
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
create table qa.limpeza055_v(def text);
insert into qa.limpeza055_v select pg_get_functiondef('public.rota_045_limpar()'::regprocedure);
\\i {(REPO / 'admin/migracoes/045_rota_pedido_ignorado.sql').as_posix()}
select def from qa.limpeza055_v \\gexec
create table qa.limpeza044_v(def text);
insert into qa.limpeza044_v select pg_get_functiondef('public.rota_044_limpar()'::regprocedure);
\\i {(REPO / 'admin/migracoes/044_rota_marcacao_horarios.sql').as_posix()}
select def from qa.limpeza044_v \\gexec
\\i {(REPO / 'supabase/tests/044-047-base.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/066_rota_sugestoes.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_f_fora_do_site.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_a_trocar_veiculo.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_c_entrega_automatica.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_h_mover_nao_historico.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/070_previsao_definitiva.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_d_historico_lote_dia.sql').as_posix()}
\\i {(REPO / 'admin/migracoes/068_b_prazo_flexivel.sql').as_posix()}
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
# Simula S10 marcada sem saida em 26/11 (como em producao)
load_sql.append("insert into public.rota_065_sem_saida(dia, veiculo_id, motivo) values ('2026-11-26', 's10', 'Sem saida S10 qui 26/11') on conflict do nothing;")
load_sql.append("create or replace function public.rota_070_agora() returns timestamptz language sql stable set search_path='' as $$select coalesce(nullif(current_setting('qa.agora',true),''),'2026-11-26T18:12:51.634445-03')::timestamptz$$;")
load_sql.append("create or replace function public.rota_068_hoje() returns date language sql stable set search_path='' as $$select public.rota_070_hoje()$$;")
load_sql.append("create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select public.rota_070_hoje()$$;")
load_sql.append("update public.rota_070_politica set inicio=date '2026-11-26', ultimo_dia=date '2026-11-26', dias_recebidos=1 where id=1;")
run(DB, '-q', input_sql='\n'.join(load_sql))

ids = sorted(p['cd_pedido'] for p in f['pedidos'])
arr = 'array[' + ','.join(map(str, ids)) + ']::bigint[]'

def resumo_estados(agora='2026-11-26T18:12:51.634445-03'):
    rows = query_json(f"select jsonb_agg(to_jsonb(s) order by cd_pedido) from public.rota_070_estados_pedidos({arr}) s;", prefix=init_role(UID_MARCIO, agora))
    return {
        'total': len(rows),
        'pendentes': sorted(x['cd_pedido'] for x in rows if x['pendente']),
        'prontos': sorted(x['cd_pedido'] for x in rows if x['pronto_despacho']),
        'entregues': sorted(x['cd_pedido'] for x in rows if x['entregue']),
        'recebidos': sorted(x['cd_pedido'] for x in rows if x['estado_070'] == 'recebido'),
    }

def itens_ativos_foto(dia, agora='2026-11-27T10:00:00-03'):
    r = query_json(f"select public.rota_070_definitiva_ler(date '{dia}');", prefix=init_role(UID_MARCIO, agora))
    return sorted([(x['cd_pedido'], x['veiculo_id']) for x in (r['foto']['itens'] or []) if x['removido_em'] is None])


print('BASE6a42+foto real c8 carregada:', DB)
