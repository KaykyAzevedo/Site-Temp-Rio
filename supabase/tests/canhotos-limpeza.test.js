'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../functions/_shared/canhotos-limpeza-core.js');
function banco(op = {}) {
    const calls = [], lotes = (op.lotes || [{ token: 't1', caminhos: ['a.jpg', 'b.jpg'] }, { caminhos: [] }]).slice();
    return { calls, rpc(n, a) {
        calls.push([n, a]);
        if (n === 'whatsapp_043_cron_ok') return Promise.resolve(op.auth || { data: true });
        if (n === 'rota_052_limpeza_lote') return Promise.resolve({ data: lotes.shift() || { caminhos: [] } });
        return Promise.resolve(op.confirmar || { data: 3 });
    }, storage: { from(b) { assert.equal(b, 'canhotos'); return { remove(paths) { calls.push(['remove', paths]); return Promise.resolve(op.remove || { data: [] }); } }; } } };
}
test('retencao remove pelo Storage antes de confirmar linhas e termina no lote vazio', async () => {
    const sb = banco();
    assert.deepEqual(await C.limpar(sb), { lotes: 1, arquivos: 2, linhas: 3 });
    assert.deepEqual(sb.calls.map(c => c[0]), ['rota_052_limpeza_lote', 'remove', 'rota_052_limpeza_confirmar', 'rota_052_limpeza_lote']);
});
test('falha no Storage nao confirma nem apaga linhas; reenvio de arquivo ausente e seguro', async () => {
    const sb = banco({ remove: { error: { message: 'offline' } } });
    await assert.rejects(C.limpar(sb));
    assert.equal(sb.calls.some(c => c[0] === 'rota_052_limpeza_confirmar'), false);
    assert.equal((await C.limpar(banco({ remove: { data: [] } }))).arquivos, 2);
});
test('falha na confirmacao e propagada para retry e o worker respeita teto de lotes', async () => {
    await assert.rejects(C.limpar(banco({ confirmar: { error: { code: '40001' } } })));
    const sb = banco({ lotes: Array.from({ length: 4 }, (_, i) => ({ token: 't' + i, caminhos: ['a'] })) });
    assert.equal((await C.limpar(sb, { maxLotes: 2 })).lotes, 2);
});
test('cron exige token valido antes de executar qualquer limpeza', async () => {
    for (const auth of [{ data: false }, { error: { code: 'oops' } }]) {
        const sb = banco({ auth });
        const r = await C.responder(new Request('https://test', { method: 'POST', headers: { 'x-cron-token': 'x'.repeat(32) } }), sb);
        assert.equal(r.status, 401); assert.equal(sb.calls.length, 1);
    }
    const sb = banco();
    assert.equal((await C.responder(new Request('https://test', { method: 'POST' }), sb)).status, 401);
    assert.equal((await C.responder(new Request('https://test'), sb)).status, 405);
    assert.equal(sb.calls.length, 0);
});
test('cron autorizado retorna so contagens', async () => {
    const r = await C.responder(new Request('https://test', { method: 'POST', headers: { 'x-cron-token': 'x'.repeat(32) } }), banco());
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, lotes: 1, arquivos: 2, linhas: 3 });
});
test('falha de rede na autenticacao nao executa limpeza nem ecoa token', async () => {
    const sb = { rpc() { return Promise.reject(new Error('rede')); } };
    const r = await C.responder(new Request('https://test', { method: 'POST', headers: { 'x-cron-token': 'x'.repeat(32) } }), sb);
    assert.equal(r.status, 503);
    assert.equal((await r.text()).includes('x'.repeat(32)), false);
});
