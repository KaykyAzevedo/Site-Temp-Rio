// 052: js/canhoto.js (compartilhado motorista/painel) — caminho no formato do banco e envio (upload + registro).
// Dados FICTÍCIOS, Supabase falso. Rodar: node --test supabase/tests/canhoto.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = { crypto: globalThis.crypto };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../js/canhoto.js'), 'utf8'), { window: raiz, Intl, Date, Promise, Uint8Array, Math, String, Number, Array });
const C = raiz.TempRioCanhoto;
// mesma regex do CHECK/rota_052_caminho_valido (052)
const SQL = fs.readFileSync(path.join(__dirname, '../../admin/migracoes/052_canhotos.sql'), 'utf8');
const RE = new RegExp(SQL.match(/select p_nome ~ '([^']+)'/)[1]);

function sbFalso(o) {
    o = o || {};
    const ch = [];
    return { ch, storage: { from(b) { return { upload(cam, blob, opt) { ch.push(['upload', b, cam, opt.contentType, opt.upsert]); return Promise.resolve(o.upload || { data: { path: cam }, error: null }); } }; } },
             rpc(n, a) { ch.push(['rpc', n, a]); return Promise.resolve(o.rpc || { data: a.p_cds.length, error: null }); } };
}

test('caminho = <data>/<cd>/<uuid>.jpg e passa na regra do banco', () => {
    for (let i = 0; i < 50; i++) {
        const c = C.caminho('2026-11-23', 960001 + i);
        assert.ok(RE.test(c), c);
        assert.ok(c.startsWith('2026-11-23/' + (960001 + i) + '/'));
    }
    assert.ok(/^\d{4}-\d{2}-\d{2}\/7\//.test(C.caminho(null, 7)), 'sem dia = hoje (SP)');
    assert.ok(!RE.test('2026-11-23/0/x.jpg') && !RE.test('../960001/a.jpg'));
});

test('enviar: upload privado (sem sobrescrever) + registro para todos os pedidos da parada', async () => {
    const sb = sbFalso();
    const r = await C.enviar(sb, { size: 10 }, ['960001', 960002], { dia: '2026-11-23' });
    assert.ok(RE.test(r.caminho));
    assert.equal(sb.ch[0][0] + '|' + sb.ch[0][1], 'upload|canhotos');
    assert.equal(sb.ch[0][3], 'image/jpeg'); assert.equal(sb.ch[0][4], false);
    assert.equal(JSON.stringify(sb.ch[1]), JSON.stringify(['rpc', 'rota_052_registrar', { p_caminho: r.caminho, p_cds: [960001, 960002], p_substituir: false }]));
});

test('enviar: reenvio da fila (arquivo já subiu) registra; outro erro de upload não registra; erro do registro propaga', async () => {
    const sb = sbFalso({ upload: { data: null, error: { message: 'The resource already exists', statusCode: '409' } } });
    await C.enviar(sb, {}, [960001], { caminho: '2026-11-23/960001/11111111-1111-4111-8111-111111111111.jpg' });
    assert.equal(sb.ch[1][1], 'rota_052_registrar');
    const sb2 = sbFalso({ upload: { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } } });
    await assert.rejects(C.enviar(sb2, {}, [960001], {}), (e) => /row-level/.test(e.message));
    assert.equal(sb2.ch.length, 1, 'não registra');
    const sb3 = sbFalso({ rpc: { data: null, error: { code: '42501', message: 'pedido nao esta na sua rota de hoje' } } });
    await assert.rejects(C.enviar(sb3, {}, [960001], {}), (e) => /sua rota/.test(e.message));
    const sb4 = sbFalso();
    await C.enviar(sb4, {}, [960001], { substituir: true });
    assert.equal(sb4.ch[1][2].p_substituir, true);
});

test('MOT-6: foto de CD associa 51 pedidos e o limite completo sem truncar', async () => {
    assert.equal(C.MAX_PEDIDOS, 15050);
    for (const n of [50, 51, C.MAX_PEDIDOS]) {
        const cds = Array.from({ length: n }, (_, i) => 960001 + i);
        const sb = sbFalso();
        await C.enviar(sb, {}, cds, { dia: '2026-11-23' });
        assert.deepEqual(Array.from(sb.ch[1][2].p_cds), cds);
    }
    const sb = sbFalso();
    await assert.rejects(C.enviar(sb, {}, Array.from({ length: C.MAX_PEDIDOS + 1 }, (_, i) => 1 + i)), (e) => e.code === '22023');
    assert.equal(sb.ch.length, 0, 'não sobe arquivo que não pode registrar');
});

test('motorista valida contexto antes do upload e repete veículo/versão no registro', async () => {
    const calls = [];
    const sb = {
        rpc(n, a) { calls.push([n, a]); return Promise.resolve({ data: n === 'rota_051_validar_contexto' ? true : 2 }); },
        storage: { from() { return { upload() { calls.push(['upload']); return Promise.resolve({ data: {}, error: null }); } }; } }
    };
    await C.enviar(sb, {}, [960001, 960002, 960001], {
        caminho: '2026-11-23/960001/11111111-1111-4111-8111-111111111111.jpg',
        motorista: true, veiculo: 's10', versao: 7
    });
    assert.equal(calls[0][0], 'rota_051_validar_contexto');
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), { p_data: '2026-11-23', p_veiculo: 's10', p_versao: 7 });
    assert.equal(calls[1][0], 'upload');
    assert.equal(calls[2][1].p_veiculo, 's10');
    assert.equal(calls[2][1].p_versao, 7);
    assert.deepEqual(Array.from(calls[2][1].p_cds), [960001, 960002]);
});

test('dia antigo/veículo/versão/contexto recusados são propagados antes do Storage', async () => {
    for (const code of ['P5101', 'P5102', 'P5103', 'P5104']) {
        let uploads = 0;
        const sb = {
            rpc() { return Promise.resolve({ error: { code, message: 'contexto recusado' } }); },
            storage: { from() { return { upload() { uploads++; return Promise.resolve({ data: {} }); } }; } }
        };
        await assert.rejects(C.enviar(sb, {}, [960001], { motorista: true, veiculo: 's10', versao: 1 }), (e) => e.code === code);
        assert.equal(uploads, 0);
    }
});
