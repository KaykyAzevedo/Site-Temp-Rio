"""Prova locks reais: RPC e DML esperam fechamento e revalidam a saida apos COMMIT."""
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
PSQL = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
DB = 'sentinela_separando_cpf_forja068a_concorrencia'
CONN = f'host=127.0.0.1 port=55439 user=qa dbname={DB} connect_timeout=5'

def sql(text, db=CONN):
    r = subprocess.run([PSQL, db, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', text], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()

sql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)', 'host=127.0.0.1 port=55439 user=qa dbname=postgres')
sql(f'CREATE DATABASE {DB} TEMPLATE sentinela_separando_cpf_forja068a', 'host=127.0.0.1 port=55439 user=qa dbname=postgres')
results = []
for cd, direct in [(681290, False), (681291, True)]:
    sql(f"insert into public.solidcon_pedidos_erp(cd_pedido,etapa) values({cd},'conferido')")
    locker = subprocess.Popen([PSQL, CONN, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    worker = None
    try:
        locker.stdin.write("begin;select pg_advisory_xact_lock(5100,5201);select pg_advisory_xact_lock(5100,5001);\n\\echo LOCKED\n")
        locker.stdin.flush()
        while locker.stdout.readline().strip() != 'LOCKED':
            if locker.poll() is not None:
                raise RuntimeError('fechamento nao adquiriu locks')
        mutation = (f"insert into public.rota_pedido_veiculo(cd_pedido,veiculo) values({cd},'s10')" if direct
                    else f"select public.rota_068_trocar_veiculo({cd},'s10','pedido')")
        query = "set qa.uid='22222222-2222-4222-8222-222222222222';set role authenticated;" + mutation
        worker = subprocess.Popen([PSQL, CONN + ' application_name=forja068a_contender', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-c', query], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 10
        while sql("select count(*) from pg_stat_activity where application_name='forja068a_contender' and wait_event='advisory'") != '1':
            if worker.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError('troca nao aguardou lock de fechamento')
            time.sleep(0.1)
        locker.stdin.write(f"insert into public.rota_dia_fechada(data,estado) values('2026-11-26','fechada') on conflict(data) do update set estado='fechada';insert into public.rota_dia_item(data,cd_pedido,veiculo_id,ordem) values('2026-11-26',{cd},'s10',1);commit;\n\\q\n")
        locker.stdin.flush()
        locker.wait(timeout=10)
        out, err = worker.communicate(timeout=10)
        if direct:
            assert worker.returncode != 0 and '42501' in err and 'ja_saiu' in err, (out, err)
        else:
            assert worker.returncode == 0 and 'ja_saiu' in out, (out, err)
        assert sql(f'select count(*) from public.rota_pedido_veiculo where cd_pedido={cd}') == '0'
        results.append('PASS: ' + ('DML' if direct else 'RPC') + ' aguardou fechamento, revalidou saida e nao gravou')
    finally:
        if locker.poll() is None:
            locker.kill()
        if worker and worker.poll() is None:
            worker.kill()
(ROOT / 'concorrencia.txt').write_text('\n'.join(results) + '\n', encoding='utf-8')
print('\n'.join(results))
