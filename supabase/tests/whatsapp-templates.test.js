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
        // nunca dois {{n}} separados só por espaço/pontuação/símbolo (ex.: "{{2}} ({{3}})", "{{5}}\n{{6}}").
        // EXCEÇÃO CONHECIDA (WA-PED): rota_sugerida foi cadastrado na Meta com "{{3}}\n{{4}}\n{{5}}" (risco de recusa
        // 2388293, ver LEIAME). O teste trava que é SÓ esse trecho; qualquer outro par lado a lado falha.
        const lado = (corpo.match(/\}\}[\s\p{P}\p{S}]*\{\{/gu) || []).length;
        if (nome === 'rota_sugerida') assert.ok(corpo.includes('\n{{3}}\n{{4}}\n{{5}}\n') && lado === 2, 'rota_sugerida: só {{3}}/{{4}}/{{5}} lado a lado');
        else assert.equal(lado, 0, 'variáveis lado a lado');
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

// ---------- alertas_operacao_v2: a Meta reclassificou o 1º texto como MARKETING; o v2 tem de parecer aviso operacional (UTILITY) ----------
const EMOJI = /\p{Extended_Pictographic}/u;
const PROMO = /\b(alertas?|oferta|promo\w*|desconto|grátis|aproveite|imperd\w*|novidade|compre|urgente|atenção)\b/iu;
test('alertas_operacao_v2: nome novo, antigo fora de MODELOS/LIMITES, tom seco sem emoji nem chamada', () => {
    assert.ok(W.MODELOS.alertas_operacao_v2 && W.WA.LIMITES.alertas_operacao_v2);
    assert.equal(W.MODELOS.alertas_operacao, undefined);
    assert.equal(W.WA.LIMITES.alertas_operacao, undefined);
    // relatorio_diario_v2 e os do WA-PED têm emoji de propósito (layout em blocos aprovado pelo dono); os demais seguem sem
    const COM_EMOJI = ['relatorio_diario_v2', 'pedidos_do_dia', 'rota_paradas', 'rota_sugerida'];
    for (const [nome, corpo] of Object.entries(W.MODELOS)) if (COM_EMOJI.indexOf(nome) < 0) assert.ok(!EMOJI.test(corpo), corpo);
    assert.ok(!PROMO.test(W.MODELOS.alertas_operacao_v2), W.MODELOS.alertas_operacao_v2);
});
test('alertas_operacao_v2: montarAlertas usa o v2, itens sem emoji; rotina gravada com o nome antigo manda o v2', () => {
    const agora = new Date('2026-11-16T09:10:00Z');
    const d = { parados: [{ cd_pedido: 48120, dt_pedido: '2026-11-02T10:00:00Z', cliente_tipo: 'cnpj', documento: '11222333000181' }], nomes: { '11222333000181': { nome: 'Padaria Modelo' } },
        siteAguardando: [{ criado_em: '2026-11-14T12:00:00Z' }], coletas: [{ nome: 'pedidos', limiteMin: 30, ultima: '2026-11-16T08:00:00Z' }], estoque: [{ nome: 'Sorvete Ficticio', tipo: 'esgotou' }] };
    for (const [tpl, esperado] of [[undefined, 'alertas_operacao_v2'], ['alertas_operacao', 'alertas_operacao_v2'], ['alertas_operacao_v2', 'alertas_operacao_v2'], ['outro_nome', 'outro_nome']]) {
        const m = W.montarAlertas(d, agora, { template: tpl, painelUrl: 'https://www.exemplo.com.br' });
        assert.equal(m.partes.length, 1);
        assert.equal(m.partes[0].modelo, 'alertas_operacao_v2');
        assert.equal(m.partes[0].template, esperado, String(tpl));
        assert.equal(m.resumo.itens, 4);
        assert.ok(!EMOJI.test(m.texto), m.texto);
        assert.ok(m.texto.startsWith('Aviso de operação do Temp Rio em segunda, 16/11 06:10.\nItens para conferir hoje: 1 pedido do ERP parado há mais de 7 dias: #48120 Padaria Modelo (13d) | 1 pedido do site aguardando'), m.texto);
        assert.equal(m.texto, W.renderizar(m.partes[0]));
    }
    // as outras rotinas não são afetadas pelo mapa de nomes aposentados
    assert.equal(W.montarReceber({ titulos: [], nomes: {}, coletado: null }, agora, { template: 'relatorio_diario' }).partes[0].template, 'relatorio_diario');
});

// ---------- relatorio_diario_v2 (WA-V2): 11 parâmetros, 1 cliente por linha; o v1 segue igual ----------
const AG = new Date('2026-11-23T11:30:00Z');   // segunda, 23/11 08:30 em SP
const URL_P = 'https://www.exemplo.com.br';
const limpo = (x) => typeof x === 'string' && x.length > 0 && !/[\r\n\t]| {4,}/.test(x);
function tit(doc, venc, cent, tipo) { return { tipo: tipo || 'cnpj', documento: tipo && tipo !== 'cnpj' ? null : doc, vencimento: venc, valor_aberto_centavos: cent }; }
function confere(m) {
    assert.equal(m.partes.length, 1);
    const p = m.partes[0];
    assert.equal(p.modelo, 'relatorio_diario_v2'); assert.equal(p.template, 'relatorio_diario_v2');
    assert.equal(p.params.length, 11);
    p.params.forEach((x, i) => { assert.ok(limpo(x), '{{' + (i + 1) + '}} ' + JSON.stringify(x)); assert.ok(x.length <= W.WA.LIMITES.relatorio_diario_v2[i], '{{' + (i + 1) + '}} ' + x.length); });
    assert.ok(W.renderizar(p).length <= W.WA.CORPO_MAX);
    assert.equal(m.texto, W.renderizar(p));
    return p.params;
}

test('v2: 5+ clientes — top 5 por valor, 1 por linha, singular/plural de dias e parcelas', () => {
    const nomes = {}, titulos = [];
    ['Alfa', 'Beta', 'Gama', 'Delta', 'Epsilon', 'Zeta'].forEach((n, i) => { const d = String(20000000000000 + i); nomes[d] = { nome: n + ' Comercio Ficticio' }; titulos.push(tit(d, '2026-11-' + String(22 - i).padStart(2, '0'), (i + 1) * 100000)); });
    titulos.push(tit('20000000000000', '2026-11-23', 207494), tit('20000000000001', '2026-11-25', 9612143), tit('20000000000002', '2026-11-30', 1), tit('20000000000003', '2026-12-01', 5));   // 01/12 = fora dos 7 dias
    const p = confere(W.montarReceber({ titulos, nomes, coletado: '2026-11-23T11:28:00Z' }, AG, { template: 'relatorio_diario_v2', painelUrl: URL_P }));
    assert.equal(p[0], 'segunda, 23/11');
    assert.match(p[1], /^R\$\s21\.000,00 · 6 parcelas · 6 clientes$/);
    assert.match(p[2], /^R\$\s2\.074,94 · 1 parcela$/);
    assert.match(p[3], /^R\$\s96\.121,44 · 2 parcelas$/);
    assert.match(p[4], /^Zeta Comercio Ficticio — R\$\s6\.000,00 \(6 dias\)$/);
    assert.match(p[8], /^Beta Comercio Ficticio — R\$\s2\.000,00 \(2 dias\)$/);   // Alfa (o menor) ficou de fora
    assert.ok(!p.slice(4, 9).some((x) => /Alfa/.test(x)));
    assert.equal(p[9], '23/11 às 08:28');
    assert.equal(p[10], URL_P + '/admin.html#clientes');
    assert.ok(W.renderizar(W.montarReceber({ titulos, nomes, coletado: null }, AG, { template: 'relatorio_diario_v2', painelUrl: URL_P }).partes[0]).includes('\n1. Zeta Comercio Ficticio — '));
});

test('v2: 2 clientes (+ PF) — vagas vazias "—", "1 dia"/"1 parcela", PF sempre neutro', () => {
    const titulos = [tit('30000000000001', '2026-11-22', 822622), tit('30000000000002', '2026-11-19', 1000), tit(null, '2026-11-01', 500, 'pf')];
    const nomes = { '30000000000001': { nome: 'PETRO FRUTAS - NOGUEIRA' }, '30000000000002': { nome: 'Mercado Exemplo Ltda' } };
    const p = confere(W.montarReceber({ titulos, nomes, coletado: '2026-11-23T11:28:00Z' }, AG, { template: 'relatorio_diario_v2', painelUrl: URL_P }));
    assert.match(p[1], /^R\$\s8\.241,22 · 3 parcelas · 2 clientes \+ 1 parcela de pessoa física\/sem documento$/);
    assert.match(p[4], /^PETRO FRUTAS - NOGUEIRA — R\$\s8\.226,22 \(1 dia\)$/);
    assert.match(p[5], /^Mercado Exemplo Ltda — R\$\s10,00 \(4 dias\)$/);
    assert.match(p[6], /^cliente pessoa física — R\$\s5,00 \(22 dias\)$/);
    assert.deepEqual(p.slice(7, 9), ['—', '—']);
    assert.equal(p[2], 'nada vence hoje'); assert.equal(p[3], 'nada vence nos próximos 7 dias');
    // só PF vencido: sem "0 clientes"
    const q = confere(W.montarReceber({ titulos: [tit(null, '2026-11-20', 700, 'pf')], nomes: {}, coletado: '2026-11-23T11:28:00Z' }, AG, { template: 'relatorio_diario_v2' }));
    assert.match(q[1], /^R\$\s7,00 · 1 parcela · 1 parcela de pessoa física\/sem documento$/);
});

test('v2: 0 clientes / valores zero — frases claras, nunca parâmetro vazio; coleta ausente ou antiga avisa', () => {
    for (const titulos of [[], [tit('1', '2026-11-20', 0), tit('2', '2026-11-23', -5)]]) {
        const p = confere(W.montarReceber({ titulos, nomes: {}, coletado: null }, AG, { template: 'relatorio_diario_v2' }));
        assert.deepEqual(p.slice(1, 9), ['nada vencido', 'nada vence hoje', 'nada vence nos próximos 7 dias', 'nenhum valor vencido', '—', '—', '—', '—']);
        assert.equal(p[9], '— (ATENÇÃO, nenhuma coleta registrada)');
        assert.equal(p[10], 'abra o painel');
    }
    const v = confere(W.montarReceber({ titulos: [], nomes: {}, coletado: '2026-11-21T08:50:00Z' }, AG, { template: 'relatorio_diario_v2' }));
    assert.equal(v[9], '21/11 às 05:50 (ATENÇÃO, coleta antiga)');
});

test('v2: pior caso — nome gigante com quebra/tab/espaços cortado com "…" sem quebrar valor nem dias; corpo <= 1024', () => {
    const longo = 'Nome;  Muito\nComprido\t\tde     Cliente Ficticio '.repeat(8);
    const titulos = [], nomes = {};
    for (let i = 0; i < 40; i++) { const d = String(40000000000000 + i); titulos.push(tit(d, '2025-01-0' + (1 + (i % 9)), 99999999999 - i)); nomes[d] = { nome: longo }; }
    const p = confere(W.montarReceber({ titulos, nomes, coletado: null }, AG, { template: 'relatorio_diario_v2', painelUrl: 'https://' + 'sub.'.repeat(40) + 'exemplo.test' }));
    for (const x of p.slice(4, 9)) assert.match(x, /^[^—]+… — R\$\s[\d.]+,\d\d \(\d+ dias\)$/, x);
    assert.ok(p[10].endsWith('…'));
});

test('v1 (relatorio_diario) inalterado, só o link vai para #clientes; sem template = v1', () => {
    const titulos = [tit('30000000000001', '2026-11-22', 822622), tit(null, '2026-11-01', 500, 'pf'), tit('30000000000001', '2026-11-23', 100)];
    const nomes = { '30000000000001': { nome: 'PETRO FRUTAS - NOGUEIRA' } };
    for (const tpl of [undefined, 'relatorio_diario']) {
        const m = W.montarReceber({ titulos, nomes, coletado: '2026-11-23T11:28:00Z' }, AG, { template: tpl, painelUrl: URL_P });
        assert.equal(m.partes[0].modelo, 'relatorio_diario'); assert.equal(m.partes[0].template, 'relatorio_diario');
        assert.equal(m.partes[0].params.length, 7);
        assert.equal(m.texto.replace(/ /g, ' '), 'Resumo das contas a receber de segunda, 23/11.\nTotal vencido em aberto: R$ 8.231,22 (2 parcelas, 1 cliente + 1 parcela de pessoa física/sem documento).\nTotal que vence hoje: R$ 1,00 (1 parcela).\nTotal a vencer nos próximos 7 dias: R$ 0,00 (0 parcelas).\nMaiores valores vencidos por cliente: 1) PETRO FRUTAS - NOGUEIRA R$ 8.226,22 (1d); 2) cliente pessoa física R$ 5,00 (22d).\nDados do ERP: coleta de 23/11 08:28.\nMais detalhes no painel: ' + URL_P + '/admin.html#clientes\nMensagem automática do Temp Rio.');
        assert.deepEqual(m.resumo, { vencido: 823122, parcelasVencidas: 2, clientes: 1, hoje: 100, prox7: 0 });
    }
});
