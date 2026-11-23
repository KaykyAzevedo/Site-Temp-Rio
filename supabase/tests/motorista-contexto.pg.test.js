// Opt-in: MOT2_TEST_DB=sentinela_mot2_* node --test supabase/tests/motorista-contexto.pg.test.js
// Preparar banco vazio com motorista-contexto.sql. Conecta SOMENTE no cluster descartavel 127.0.0.1:55439.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const db = process.env.MOT2_TEST_DB;
const bin = process.env.MOT2_PSQL || 'C:/Program Files/PostgreSQL/18/bin/psql.exe';
function client(sql, waitReady = false) {
    assert.match(db || '', /^sentinela_mot2_[a-z0-9_]+$/);
    const p = spawn(bin, ['-X', '-A', '-t', '-q', '-h', '127.0.0.1', '-p', '55439', '-U', 'qa', '-d', db,
        '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { windowsHide: true });
    let out = '', err = '', seen = false, resolveReady, rejectReady;
    const ready = waitReady ? new Promise((a, b) => { resolveReady = a; rejectReady = b; }) : Promise.resolve();
    p.stdout.on('data', b => { out += b; if (waitReady && !seen && out.includes('MOT2_LOCKED')) { seen = true; resolveReady(); } });
    p.stderr.on('data', b => { err += b; });
    const done = new Promise((resolve, reject) => {
        p.on('error', e => { if (waitReady && !seen) rejectReady(e); reject(e); });
        p.on('close', code => {
            if (waitReady && !seen) rejectReady(new Error(err || 'sessao terminou antes da trava'));
            resolve({ code, out: out.trim(), err });
        });
    });
    p.stdin.end("set timezone='America/Sao_Paulo';\n" + sql); return { ready, done };
}
async function query(sql) {
    const r = await client(sql).done;
    assert.equal(r.code, 0, r.err); return r.out;
}
const identity = "set qa.uid='11111111-1111-4111-8111-111111111111'; set qa.papel='motorista';";
const driver = identity + 'set role authenticated;';
async function versao() { return Number(await query("select versao from rota_saida where data=current_date and veiculo_id='s10'")); }
async function aguardarLock(nome) {
    for (let i = 0; i < 25; i++) {
        if (await query("select count(*) from pg_stat_activity where application_name='" + nome + "' and wait_event_type='Lock'") === '1') return;
        await new Promise(r => setTimeout(r, 40));
    }
    assert.fail('a sessao concorrente nao esperou pela trava: ' + nome);
}
test('MOT2 PG18: contexto fica serializado com publicacao e mudanca de vinculo', { skip: !db, timeout: 25000 }, async () => {
    await query("update rota_motoristas set veiculo_id='s10',ativo=true where user_id='11111111-1111-4111-8111-111111111111'");
    let v = await versao();
    // Marcacao segura rota ate COMMIT: republicar precisa esperar.
    const marca = client(driver + "\nbegin;\nselect rota_051_marcar(current_date,'s10'," + v + ",1,true,now());\n\\echo MOT2_LOCKED\nselect pg_sleep(3);\ncommit;", true);
    await marca.ready;
    const pub = client("set application_name='mot2_publica'; update rota_saida set resumo='{\"km\":1}' where data=current_date and veiculo_id='s10'");
    await aguardarLock('mot2_publica');
    assert.equal((await marca.done).code, 0);
    assert.equal((await pub.done).code, 0);
    assert.ok(await versao() > v);
    assert.equal(await query(driver + "select count(*) from rota_saida_progresso where data=current_date and veiculo_id='s10'"), '0');

    // Inverso: validacao so continua depois da nova publicacao, e recusa a versao antiga.
    v = await versao();
    const publica = client("begin;\nupdate rota_saida set resumo='{\"km\":2}' where data=current_date and veiculo_id='s10';\n\\echo MOT2_LOCKED\nselect pg_sleep(3);\ncommit;", true);
    await publica.ready;
    const antiga = client(driver + "set application_name='mot2_marca'; select rota_051_marcar(current_date,'s10'," + v + ",1,true,now())");
    await aguardarLock('mot2_marca');
    assert.equal((await publica.done).code, 0);
    const recusada = await antiga.done;
    assert.notEqual(recusada.code, 0); assert.match(recusada.err, /P5103/);

    // Foto que terminou upload antes de republicar tambem nao se associa na versao nova.
    v = await versao();
    const fotoPub = client("begin;\nupdate rota_saida set resumo='{\"km\":3}' where data=current_date and veiculo_id='s10';\n\\echo MOT2_LOCKED\nselect pg_sleep(3);\ncommit;", true);
    await fotoPub.ready;
    const foto = client(driver + "set application_name='mot2_foto'; select rota_052_registrar(current_date::text||'/11/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',array[11]::bigint[],false,'s10'," + v + ")");
    await aguardarLock('mot2_foto');
    assert.equal((await fotoPub.done).code, 0);
    const fotoRecusada = await foto.done;
    assert.notEqual(fotoRecusada.code, 0); assert.match(fotoRecusada.err, /P5103/);

    // Viculo e validado sob trava: troca concorrente nao deixa aplicar na outra rota.
    v = await versao();
    const troca = client("begin;\nupdate rota_motoristas set veiculo_id='strada' where user_id='11111111-1111-4111-8111-111111111111';\n\\echo MOT2_LOCKED\nselect pg_sleep(3);\ncommit;", true);
    await troca.ready;
    const vinculo = client(driver + "set application_name='mot2_vinculo'; select rota_051_marcar(current_date,'s10'," + v + ",1,true,now())");
    await aguardarLock('mot2_vinculo');
    assert.equal((await troca.done).code, 0);
    const vinculoRecusado = await vinculo.done;
    assert.notEqual(vinculoRecusado.code, 0); assert.match(vinculoRecusado.err, /P5102/);
    await query("update rota_motoristas set veiculo_id='s10' where user_id='11111111-1111-4111-8111-111111111111'");
});

test('MOT2: contador convive com o gatilho real da 047 e UPSERT nao duplica versao', { skip: !db }, async () => {
    await query('alter table rota_veiculos add column if not exists ativo boolean not null default true; ' +
        'alter table rota_saida add column if not exists publicado_em timestamptz; ' +
        'alter table rota_saida add column if not exists publicado_por uuid;');
    const sql047 = fs.readFileSync(path.join(__dirname, '../../admin/migracoes/047_rota_veiculos.sql'), 'utf8');
    const start = sql047.indexOf('create or replace function public.rota_047_saida_publicar()');
    const end = sql047.indexOf('alter table public.rota_saida enable row level security;', start);
    assert.ok(start >= 0 && end > start);
    await query(sql047.slice(start, end));
    const v = await versao();
    await query("insert into rota_saida(data,veiculo_id,versao,paradas,resumo) values(current_date,'s10',1,'[{\"ordem\":1,\"pedidos\":[22]}]','{}') " +
        'on conflict(data,veiculo_id) do update set paradas=excluded.paradas,resumo=excluded.resumo');
    assert.equal(await versao(), v + 1);
    await query("delete from rota_saida where data=current_date and veiculo_id='s10'; " +
        "insert into rota_saida(data,veiculo_id,versao,paradas,resumo) values(current_date,'s10',1,'[{\"ordem\":1,\"pedidos\":[22]}]','{}')");
    assert.equal(await versao(), v + 2);
});

test('053: telefone opcional conserva validacoes e OID da 047; reaplicar e rollback', { skip: !db }, async () => {
    const base = path.join(__dirname, '../../admin/migracoes');
    const sql013 = fs.readFileSync(path.join(base, '013_validacao_seguranca.sql'), 'utf8');
    const ini = sql013.indexOf('create or replace function public.texto_seguro(');
    const fim = sql013.indexOf('$$;', ini) + 3;
    const sql047 = fs.readFileSync(path.join(base, '047_rota_veiculos.sql'), 'utf8');
    const h0 = sql047.indexOf('create or replace function public.rota_047_texto_ok(');
    const h1 = sql047.indexOf('revoke all on function public.rota_047_texto_ok', h0);
    assert.ok(ini >= 0 && fim > ini && h0 >= 0 && h1 > h0);
    await query(sql013.slice(ini, fim) + '\n' + sql047.slice(h0, h1));
    await query('create table if not exists public.solidcon_clientes(documento text primary key,telefone text,celular text)');
    const oid = await query("select 'public.rota_047_paradas_validas(jsonb)'::regprocedure::oid");
    const ddl = fs.readFileSync(path.join(base, '053_rota_telefone.sql'), 'utf8');
    await query(ddl); await query(ddl);
    assert.equal(await query("select 'public.rota_047_paradas_validas(jsonb)'::regprocedure::oid"), oid);
    async function valida(extra) {
        const json = JSON.stringify([{ ordem: 1, nome: 'Cliente', pedidos: [11], ...extra }]).replace(/'/g, "''");
        return await query("select rota_047_paradas_validas('" + json + "'::jsonb)::text");
    }
    assert.equal(await valida({}), 'true');
    assert.equal(await valida({ telefone: '(21) 3333-4444' }), 'true');
    assert.equal(await valida({ telefone: 'x'.repeat(32) }), 'true');
    assert.equal(await valida({ telefone: 'x'.repeat(33) }), 'false');
    assert.equal(await valida({ telefone: '<script>' }), 'false');
    assert.equal(await valida({ telefone: 123 }), 'false');
    assert.equal(await valida({ email: 'extra@test' }), 'false');
    await query(fs.readFileSync(path.join(base, '053_rollback.sql'), 'utf8'));
    assert.equal(await valida({ telefone: '12345678' }), 'false');
    await query(ddl);
});

test('retencao: advisory lock serializa lote e registro concorrente; nada e relinkado durante expurgo', { skip: !db, timeout: 10000 }, async () => {
    const cam = '2020-01-01/11/' + randomUUID() + '.jpg';
    await query("insert into storage.objects(bucket_id,name,created_at) values('canhotos','" + cam + "',now()-interval '2 years'); " +
        "insert into pedido_canhoto(cd_pedido,caminho,origem,enviado_em) values(11,'" + cam + "','painel',now()-interval '2 years')");
    const lote = client("begin;\nselect rota_052_limpeza_lote(100);\n\\echo MOT2_LOCKED\nselect pg_sleep(3);\ncommit;", true);
    await lote.ready;
    const ocupado = JSON.parse(await query('select rota_052_limpeza_lote(100)'));
    assert.equal(ocupado.ocupado, true);
    assert.deepEqual(ocupado.caminhos, []);
    const registro = client("set role authenticated;set qa.papel='marcador';set application_name='mot2_registro_expurgo'; " +
        "select rota_052_registrar('" + cam + "',array[11]::bigint[],false)");
    await aguardarLock('mot2_registro_expurgo');
    assert.equal((await lote.done).code, 0);
    const r = await registro.done;
    assert.notEqual(r.code, 0); assert.match(r.err, /P5105/);
});

