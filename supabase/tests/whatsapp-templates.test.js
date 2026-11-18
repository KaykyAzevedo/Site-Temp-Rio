// Templates do WhatsApp x regras da Meta para o corpo (erro 2388293) e x LEIAME. Dados FICTÍCIOS.
// Rodar (da raiz do repo; o arquivo EXPLÍCITO — no Node 24 "node --test supabase/tests/" dá MODULE_NOT_FOUND):
//   node --test supabase/tests/whatsapp-templates.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../functions/_shared/whatsapp-core.js');

const PH = /\{\{(\d+)\}\}/g;
const fixo = (t) => t.replace(PH, '');
const palavras = (t) => fixo(t).split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length;
const nums = (t) => [...t.matchAll(PH)].map((m) => Number(m[1]));
const LEIAME = fs.readFileSync(path.join(__dirname, '../../integracao/whatsapp/LEIAME.md'), 'utf8').replace(/\r\n/g, '\n');

for (const [nome, corpo] of Object.entries(W.MODELOS)) {
    test(nome + ': regras da Meta', () => {
        assert.ok(!/^\s*\{\{/.test(corpo), 'começa com variável');
        assert.ok(!/\}\}\s*$/.test(corpo), 'termina com variável');
        // nunca dois {{n}} separados só por espaço/pontuação/símbolo (ex.: "{{2}} ({{3}})", "{{5}}\n{{6}}")
        assert.ok(!/\}\}[\s\p{P}\p{S}]*\{\{/u.test(corpo), 'variáveis lado a lado');
        const n = nums(corpo);
        assert.deepEqual(n, n.map((_, i) => i + 1), 'numeração 1..n, na ordem, sem repetir');
        assert.ok(palavras(corpo) >= 3 * n.length, palavras(corpo) + ' palavras para ' + n.length + ' variáveis');
        assert.ok(!/\n\s*\n\s*\n/.test(corpo), 'mais de 1 linha em branco seguida');
        assert.ok(!/[\t]| {4,}/.test(corpo));
    });
    test(nome + ': orçamento — texto fixo + limites dos parâmetros <= 1024 (pior caso)', () => {
        const lim = W.WA.LIMITES[nome];
        assert.equal(lim.length, nums(corpo).length);
        assert.ok(fixo(corpo).length + lim.reduce((a, b) => a + b, 0) <= W.WA.CORPO_MAX, fixo(corpo).length + ' + ' + lim.join('+'));
        // parâmetros gigantes, com quebra de linha: parte() corta cada um no limite e o corpo continua cabendo
        const p = { modelo: nome, template: nome, params: [] };
        const pt = W.renderizar(Object.assign(p, { params: lim.map((l) => 'x'.repeat(l)) }));
        assert.ok(pt.length <= W.WA.CORPO_MAX);
    });
    test(nome + ': LEIAME tem o texto idêntico ao código', () => {
        const bloco = '     ```\n' + corpo.split('\n').map((l) => '     ' + l).join('\n') + '\n     ```';
        assert.ok(LEIAME.includes('**`' + nome + '`**'), 'nome no LEIAME');
        assert.ok(LEIAME.includes(bloco), 'texto no LEIAME');
        for (const k of nums(corpo)) assert.ok(LEIAME.includes('- `{{' + k + '}}` '), 'exemplo de {{' + k + '}}');
    });
}

test('textos antigos recusados pela Meta não existem mais', () => {
    const todos = Object.values(W.MODELOS).join('\n');
    assert.ok(!todos.includes('{{2}} ({{3}})'));
    assert.ok(!todos.includes('{{5}}\n{{6}}'));
});

test('montagens reais no pior caso: cada parâmetro dentro do limite, sem quebra, corpo <= 1024', () => {
    const agora = new Date('2026-11-16T09:00:00Z');
    const longo = 'Nome; Muito\nComprido\tde Cliente Ficticio '.repeat(8);
    const titulos = [], nomes = {};
    for (let i = 0; i < 40; i++) { const d = String(10000000000000 + i); titulos.push({ tipo: i % 4 ? 'cnpj' : 'pf', documento: i % 4 ? d : null, vencimento: '2025-01-0' + (1 + (i % 9)), valor_aberto_centavos: 99999999999 }); nomes[d] = { nome: longo }; }
    const mr = W.montarReceber({ titulos, nomes, coletado: null }, agora, { painelUrl: 'https://' + 'sub.'.repeat(40) + 'exemplo.test' });
    const ma = W.montarAlertas({ parados: Array.from({ length: 50 }, (_, i) => ({ cd_pedido: 900000 + i, dt_pedido: '2026-01-01T10:00:00Z', cliente_tipo: 'cnpj', cliente_nome: longo })), nomes: {},
        siteAguardando: [{ criado_em: '2026-01-01T10:00:00Z' }], coletas: W.COLETORES.map((c) => ({ nome: c.nome + ' ' + 'z'.repeat(80), limiteMin: c.limiteMin, ultima: '2026-11-01T00:00:00Z' })),
        estoque: Array.from({ length: 30 }, (_, i) => ({ nome: longo + i, tipo: 'esgotou' })) }, agora, { painelUrl: 'https://' + 'sub.'.repeat(40) + 'exemplo.test' });
    for (const m of [mr, ma]) for (const p of m.partes) {
        assert.ok(W.renderizar(p).length <= W.WA.CORPO_MAX, p.modelo + ' ' + W.renderizar(p).length);
        p.params.forEach((x, i) => { assert.ok(x.length <= W.WA.LIMITES[p.modelo][i]); assert.ok(!/[\n\r\t]| {4,}/.test(x)); assert.ok(x.length > 0); });
    }
    assert.match(W.renderizar(mr.partes[0]), /\nDados do ERP: ATENÇÃO, nenhuma coleta registrada\.\n/);
});

test('relatório: {{6}} diz a coleta (normal e velha)', () => {
    const agora = new Date('2026-11-16T09:00:00Z');
    assert.match(W.montarReceber({ titulos: [], nomes: {}, coletado: '2026-11-16T08:50:00Z' }, agora, {}).texto, /\nDados do ERP: coleta de 16\/11 05:50\.\n/);
    assert.match(W.montarReceber({ titulos: [], nomes: {}, coletado: '2026-11-14T08:50:00Z' }, agora, {}).texto, /\nDados do ERP: ATENÇÃO, coleta antiga de 14\/11 05:50\.\n/);
});

// ---------- T1: corte seguro por ponto de código (nunca deixa surrogate isolado de emoji) ----------
const R = require('../functions/_shared/rota-core.js');
const EMO = String.fromCodePoint(0x1f600);   // 😀 = 2 unidades UTF-16
const ok = (s) => typeof s === 'string' && s.isWellFormed();

test('T1: repro da Sentinela — param com emoji na fronteira', () => {
    const r = W.param('A'.repeat(8) + EMO + 'tail', 10);
    assert.ok(ok(r), JSON.stringify(r));
    assert.ok(r.length <= 10);
    assert.equal(r, 'A'.repeat(8) + '…');
});

test('T1: param/nomeCurto/corte com o emoji em TODA posição perto do limite de cada parâmetro', () => {
    const limites = new Set([10, 20, 28, 30, 40].concat(...Object.values(W.WA.LIMITES)));
    for (const L of limites) for (let k = Math.max(0, L - 4); k <= L + 1; k++) {
        const s = 'A'.repeat(k) + EMO + EMO + 'fim';
        for (const r of [W.param(s, L), W.nomeCurto(s, L)]) {
            assert.ok(ok(r), L + '/' + k + ' ' + JSON.stringify(r.slice(-3)));
            assert.ok(r.length <= L, L + '/' + k + ' len ' + r.length);
        }
        const c = W.corte(s, L);
        assert.ok(ok(c) && c.length <= L && s.startsWith(c), 'corte ' + L + '/' + k);
        assert.ok(c.length >= L - 1, 'corte recua no máximo 1');
    }
});

test('T1: texto já malformado (surrogate isolado vindo do banco) sai bem formado', () => {
    assert.ok(ok(W.param('abc\uD83Ddef', 50)));
    assert.ok(ok(W.nomeCurto('abc\uDE00def', 50)));
    assert.ok(ok(W.corpoLog('x\uD83D')));
});

test('T1: histórico (corpoLog) cortado com emoji na fronteira continua bem formado', () => {
    const L = W.WA.CORPO_LOG_MAX - W.MARCA_RESUMO.length - 1;
    for (const k of [L - 2, L - 1, L]) {
        const r = W.corpoLog('a'.repeat(k) + EMO + 'b'.repeat(200));
        assert.ok(ok(r) && r.length <= W.WA.CORPO_LOG_MAX && r.endsWith(W.MARCA_RESUMO), String(k));
    }
});

test('T1: montarRota (v1 e v2) com emoji na fronteira do nome/bairro: parâmetros, corpo e histórico bem formados', () => {
    const agora = new Date('2026-11-24T09:00:00Z');   // terça
    for (const v2 of [false, true]) for (let k = 24; k <= 32; k++) {
        const d = '10000000000001', d2 = '10000000000002';
        const clientes = {
            [d]: { nome: 'a'.repeat(k) + EMO + 'tail', bairro: 'b'.repeat(k - 8) + EMO + 'x', cidade: 'Rio', pos: [R.ROTA.ORIGEM[0] + 0.01, R.ROTA.ORIGEM[1]] },
            [d2]: { nome: EMO.repeat(k), bairro: EMO.repeat(15), cidade: 'Rio', pos: null }
        };
        const pedidos = [d, d2].map((x, i) => ({ cd_pedido: 100 + i, dt_pedido: '2026-11-23T10:00:00-03:00', etapa: 'aberto', cliente_tipo: 'cnpj', documento: x, caixas_24: 2, caixas_48: 1, caixas_outras: 0 }));
        const dados = { pedidos, clientes, cfg: R.cfgDe(R.CFG_PADRAO), excecoes: { [d]: 's10', [d2]: 's10' }, coletado: null };
        if (v2) Object.assign(dados, { v2: true, porPedido: {}, regras: R.regrasDe([{ documento: d, janela_inicio: '08:00', janela_fim: '11:00', dias_sem_receber: [], prioridade: false }]) });
        const m = W.montarRota(dados, 's10', agora, {});
        assert.equal(m.resumo.paradas, 2);
        for (const p of m.partes) {
            p.params.forEach((x, i) => { assert.ok(ok(x), (v2 ? 'v2 ' : 'v1 ') + k + ' {{' + (i + 1) + '}} ' + JSON.stringify(x)); assert.ok(x.length <= W.WA.LIMITES[p.modelo][i]); });
            assert.ok(ok(W.renderizar(p)));
        }
        assert.ok(W.linhasDeLog(m).every((l) => ok(l.corpo)));
        assert.ok(ok(m.texto));
    }
});
