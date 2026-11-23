'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../functions/_shared/rota-core.js');
function app(cliente) {
    const window = { TempRioRotaCore: R };
    const src = fs.readFileSync(path.join(__dirname, '../../js/admin-rota.js'), 'utf8')
        .replace('raiz.TempRioRota = {', 'raiz.__testeTelefone = { st, paradasPublicar }; raiz.TempRioRota = {');
    vm.runInNewContext(src, { window, Intl, Date, console });
    const q = window.__testeTelefone;
    q.st.clientes = { '12000000000001': cliente };
    return q;
}
const parada = { documento: '12000000000001', nome: 'Cliente', pedidos: [{ p: { cd_pedido: 11 }, v: { c24: 1, c48: 0, avulsos: 0, vol: 9 } }] };
test('053 publica telefone do cadastro ou celular, e omite quando ausente', () => {
    for (const [cliente, esperado] of [
        [{ telefone: '(21) 3333-4444', celular: '21999998888' }, '(21) 3333-4444'],
        [{ telefone: '  ', celular: '21999998888' }, '21999998888'],
        [{}, null]
    ]) {
        const q = app(cliente), p = q.paradasPublicar({ sequencia: [parada] })[0];
        if (esperado) assert.equal(p.telefone, esperado);
        else assert.equal(Object.hasOwn(p, 'telefone'), false);
    }
});
test('053 nao inventa telefone unico para o CD com varios clientes', () => {
    const q = app({ telefone: '21999998888' });
    const p = q.paradasPublicar({ sequencia: [{ ...parada, cd: true, carga: [] }] })[0];
    assert.equal(Object.hasOwn(p, 'telefone'), false);
});
