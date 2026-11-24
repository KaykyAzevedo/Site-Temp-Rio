// WA-PED: pedidos_do_dia (rotina pedidos_dia) e rota_paradas + rota_sugerida (rotina rota_chefe). Dados FICTÍCIOS.
// Rodar (da raiz do repo): node --test supabase/tests/whatsapp-chefe.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../functions/_shared/whatsapp-core.js');
const R = require('../functions/_shared/rota-core.js');

const URL_P = 'https://www.exemplo.com.br';
// Regras da Meta para TODO parâmetro: texto não vazio, sem \n/\r/\t, sem 4+ espaços, bem formado, dentro do limite;
// corpo renderizado <= 1024; texto da prévia = renderização.
function confere(m) {
    assert.ok(m.partes.length >= 1);
    for (const p of m.partes) {
        const lim = W.WA.LIMITES[p.modelo];
        assert.equal(p.params.length, lim.length, p.modelo);
        p.params.forEach((x, i) => {
            const tag = p.modelo + ' {{' + (i + 1) + '}} ' + JSON.stringify(x);
            assert.ok(typeof x === 'string' && x.length > 0, tag);
            assert.ok(!/[\r\n\t]| {4,}/.test(x), tag);
            assert.ok(x.isWellFormed(), tag);
            assert.ok(x.length <= lim[i], tag + ' ' + x.length + '>' + lim[i]);
        });
        assert.ok(W.renderizar(p).length <= W.WA.CORPO_MAX, p.modelo + ' ' + W.renderizar(p).length);
    }
    assert.ok(W.linhasDeLog(m).every((l) => l.corpo && l.corpo.length <= W.WA.CORPO_MAX));
    return m;
}

// ---------------- pedidos_do_dia ----------------
const AG_PED = new Date('2026-11-23T20:00:00Z');   // segunda, 23/11 17:00 em SP
let cd = 1000;
function ped(etapa, o) {
    const n = cd++;
    return Object.assign({ cd_pedido: n, etapa, dt_pedido: '2026-11-20T10:00:00-03:00', cliente_tipo: 'cnpj', documento: String(30000000000000 + (n % 50)),
                           cliente_nome: 'CLIENTE ' + (n % 50), valor_centavos: 10000, caixas_24: 2, caixas_48: 1, caixas_outras: 0 }, o || {});
}

test('pedidos_do_dia: Entrou dt_pedido, pronto conferido, Enviou saiu/atendido pela data de faturamento SP', () => {
    const ps = [
        ped('aberto', { dt_pedido: '2026-11-23T00:05:00-03:00', valor_centavos: 500000 }),   // entrou (00:05 SP)
        ped('aberto', { dt_pedido: '2026-11-22T23:55:00-03:00' }),                           // ontem: fora
        ped('separando', { dt_pedido: '2026-11-23T09:00:00-03:00', dt_sep_inicio: '2026-11-23T10:00:00-03:00', valor_centavos: 250000 }),   // entrou
        ped('conferido', { dt_pedido: '2026-11-23T08:00:00-03:00', dt_conferencia: '2026-11-23T12:00:00-03:00', caixas_24: 10, caixas_48: 4, caixas_outras: 5 }),   // entrou + pronto
        ped('conferido', { dt_conferencia: '2026-11-19T12:00:00-03:00', caixas_24: null, caixas_48: null, caixas_outras: null }),   // pronto (velho, sem caixas)
        ped('saiu', { dt_saida: '2026-11-23T07:00:00-03:00', valor_centavos: 120000 }),     // enviou
        ped('saiu', { dt_saida: '2026-11-22T23:59:00-03:00' }),                             // saiu ontem: fora
        ped('atendido', { dt_saida: '2026-11-22T07:00:00-03:00', dt_atendido: '2026-11-23T09:00:00-03:00', valor_centavos: null }),   // entregue hoje
        ped('atendido', { dt_saida: '2026-11-23T07:00:00-03:00', dt_atendido: '2026-11-24T09:00:00-03:00' }),   // entregue amanhã (fora, data da coluna)
        ped('aberto', { dt_pedido: '2026-11-23T10:00:00-03:00', cliente_tipo: 'cpf', documento: null, cliente_nome: null, valor_centavos: 3000 })   // PF: entrou, nome neutro
    ];
    const m = confere(W.montarPedidosDia({ pedidos: ps, nomes: { [ps[0].documento]: { nome: 'PETRO FRUTAS' } }, coletado: '2026-11-23T19:58:00Z' }, AG_PED, { template: 'pedidos_do_dia', painelUrl: URL_P }));
    const p = m.partes[0];
    assert.equal(p.template, 'pedidos_do_dia');
    assert.deepEqual(m.resumo, { entrou: 4, pronto: 2, enviou: 2 });
    assert.equal(p.params[0], 'segunda, 23/11 às 17:00');
    assert.match(p.params[1], /^4 pedidos · R\$\s7\.630,00$/);
    assert.equal(p.params[2], 'PETRO FRUTAS · CLIENTE 2 · CLIENTE 3 · +1');   // cadastro > cliente_nome; +1 = PF
    assert.equal(p.params[3], '2 pedidos · 14 caixas + 5 potes (1 sem caixas no ERP)');
    assert.match(p.params[5], /^2 pedidos · R\$\s1\.300,00$/);
    assert.equal(p.params[7], URL_P + '/admin.html#pedidos');
    assert.ok(m.texto.startsWith('📦 *Resumo dos pedidos do dia — segunda, 23/11 às 17:00*\n\n📥 *Entrou* (pedidos que chegaram no ERP)\n4 pedidos'), m.texto);
    // PF nunca pelo nome
    const soPf = W.montarPedidosDia({ pedidos: [ps[9]], nomes: {}, coletado: '2026-11-23T19:58:00Z' }, AG_PED, {});
    assert.equal(soPf.partes[0].params[2], 'cliente pessoa física');
});

test('pedidos_do_dia: zero = "nenhum pedido"/"nenhum", nunca vazio; coleta ausente ou atrasada avisa no {{1}}', () => {
    const m = confere(W.montarPedidosDia({ pedidos: [], nomes: {}, coletado: null }, AG_PED, {}));
    assert.deepEqual(m.partes[0].params, ['segunda, 23/11 às 17:00 (ATENÇÃO, sem coleta do ERP)', 'nenhum pedido', 'nenhum', 'nenhum pedido', 'nenhum', 'nenhum pedido', 'nenhum', 'abra o painel']);
    const v = W.montarPedidosDia({ pedidos: [], nomes: {}, coletado: '2026-11-23T17:10:00Z' }, AG_PED, {});
    assert.equal(v.partes[0].params[0], 'segunda, 23/11 às 17:00 (ATENÇÃO, ERP de 14:10)');
    assert.equal(W.montarPedidosDia({ pedidos: [], nomes: {}, coletado: '2026-11-23T19:40:00Z' }, AG_PED, {}).partes[0].params[0], 'segunda, 23/11 às 17:00');
});

test('pedidos_do_dia: pior caso — 5000 pedidos, nomes gigantes com quebra/tab, valores máximos: tudo no limite', () => {
    const longo = 'Nome\tComprido\n de     Cliente Ficticio '.repeat(10);
    const ps = [];
    for (let i = 0; i < 5000; i++) ps.push(ped(['aberto', 'conferido', 'saiu', 'atendido'][i % 4], { dt_pedido: '2026-11-23T10:00:00-03:00', dt_conferencia: '2026-11-23T11:00:00-03:00',
        dt_saida: '2026-11-23T12:00:00-03:00', dt_atendido: '2026-11-23T13:00:00-03:00', documento: String(40000000000000 + i), cliente_nome: longo + i, valor_centavos: 999999999999999, caixas_24: 99999, caixas_48: 99999, caixas_outras: 99999 }));
    const m = confere(W.montarPedidosDia({ pedidos: ps, nomes: {}, coletado: null }, AG_PED, { painelUrl: 'https://' + 'sub.'.repeat(40) + 'exemplo.test' }));
    for (const k of [2, 4, 6]) assert.match(m.partes[0].params[k], / · \+\d+$/, 'o "+N" nunca é cortado');
});

// ---------------- rota_chefe ----------------
const AG = new Date('2026-11-23T09:00:00Z');   // segunda, 06:00 SP
const FROTA = [
    { id: 'caminhao', nome: 'Caminhão', modo: 'cd_ceasa', capacidade_volume: null, dias_sem_saida: [0], volta_sede: false, cor: '#111111', ordem: 1, ativo: true },
    { id: 's10', nome: 'S10', modo: 'porta', capacidade_volume: 100000, dias_sem_saida: [0], volta_sede: true, cor: '#222222', ordem: 2, ativo: true },
    { id: 'strada', nome: 'Strada', modo: 'porta', capacidade_volume: 1500, dias_sem_saida: [0, 6], volta_sede: true, cor: '#333333', ordem: 3, ativo: false }
];
const BAIRROS = ['Nogueira', 'Itaipava', 'Corrêas', 'Centro', 'Quitandinha', 'Valparaíso'];
// n entregas por veículo: { s10: 8, caminhao: 3 }. semPos: 1 a cada 5 da S10 sem posição. Pedido sem marcação = aguardando.
function dados(por, o) {
    o = o || {};
    const pedidos = [], clientes = {}, porPedido = {}, regras = [];
    let i = 0;
    for (const [vei, n] of Object.entries(por)) for (let k = 0; k < n; k++, i++) {
        const doc = String(11000000000000 + i), nome = o.nome ? o.nome(i) : (vei === 'caminhao' ? 'HORTI CEASA ' : 'MERCADO FICTICIO ') + i;
        const pos = vei === 'caminhao' ? [R.ROTA.ORIGEM[0], R.ROTA.ORIGEM[1]] : (k % 5 === 4 ? null : [R.ROTA.ORIGEM[0] + 0.004 * (k + 1), R.ROTA.ORIGEM[1] + 0.003 * ((k * 7) % 11)]);
        clientes[doc] = { nome, logradouro: o.rua || 'Rua Ficticia', numero: String(100 + i), bairro: BAIRROS[k % 6], cidade: 'Petrópolis', pos };
        pedidos.push({ cd_pedido: 5000 + i, dt_pedido: '2026-11-21T10:00:00-03:00', etapa: 'conferido', cliente_tipo: 'cnpj', documento: doc, caixas_24: 2 + (i % 3), caixas_48: i % 2, caixas_outras: i % 4 === 0 ? 3 : 0, valor_centavos: 1000 });
        porPedido[5000 + i] = vei;
        if (vei !== 'caminhao' && k === 0) regras.push({ documento: doc, janela_inicio: '07:00', janela_fim: '10:00', dias_sem_receber: [], prioridade: true });
    }
    if (o.aguardando) pedidos.push({ cd_pedido: 9000, dt_pedido: '2026-11-21T10:00:00-03:00', etapa: 'aberto', cliente_tipo: 'cpf', documento: null, caixas_24: 1, caixas_48: 0, caixas_outras: 0 });
    return { pedidos, clientes, cfg: R.cfgDe(R.CFG_PADRAO), excecoes: {}, coletado: null, veiculos: o.frota || FROTA, v2: true, porPedido, regras: R.regrasDe(regras), ignorados: {} };
}
const chefe = (d, ag, o) => confere(W.montarChefe(d, ag || AG, Object.assign({ painelUrl: URL_P, template: 'rota_sugerida' }, o || {})));
const sug = (m) => m.partes[m.partes.length - 1];

test('rota_chefe: 1 parte — paradas (6 vagas, "—" nas sobras) e a sugerida POR ÚLTIMO', () => {
    const m = chefe(dados({ s10: 3, caminhao: 1 }, { aguardando: true }));
    assert.deepEqual(m.partes.map((p) => p.template), ['rota_paradas', 'rota_sugerida']);
    const p = m.partes[0];
    assert.equal(p.params[0], 'segunda, 23/11'); assert.equal(p.params[1], '1 de 1');
    assert.match(p.params[2], /^MERCADO FICTICIO 0 · 1 pedido · 2 cx \+ 3 potes — Rua Ficticia, 100, Nogueira, Petrópolis · prioridade alta · recebe 07:00–10:00$/);
    assert.equal(p.params[5], 'HORTI CEASA 3 · 1 pedido · 3 cx — entrega no CEASA (Caminhão)');   // CEASA depois das portas
    assert.deepEqual(p.params.slice(6), ['—', '—']);
    const s = sug(m).params;
    assert.equal(s[1], '4 pedidos · 4 entregas · 13 cx + 3 potes · 1 pedido aguardando marcação');
    assert.equal(s[2], 'Caminhão (CEASA): 1 pedido · 1 cliente');
    assert.match(s[3], /^S10: 3 pedidos · 3 paradas · ~\d+ km$/);
    assert.equal(s[4], '—');   // Strada inativa não aparece
    assert.ok(!/Strada/.test(m.texto));
    assert.match(s[5], / → volta ao depósito$/);
    assert.equal(s[6], '1 cliente com prioridade alta · 1 com horário fixo');
    assert.equal(s[7], URL_P + '/admin.html#rotas');
    assert.ok(m.texto.endsWith('_Mensagem automática do Temp Rio._'));
    assert.deepEqual(m.resumo, { entregas: 4, pedidos: 4, partesParadas: 1, omitidas: 0, aguardando: 1, fica: 0 });
});

test('rota_chefe: 3 partes — "n de 3", ordem = a mesma da rota_<veículo> (mesmo plano da aba Rotas)', () => {
    const d = dados({ s10: 14, caminhao: 3 });
    const m = chefe(d);
    assert.equal(m.partes.length, 4);
    assert.deepEqual(m.partes.slice(0, 3).map((p) => p.params[1]), ['1 de 3', '2 de 3', '3 de 3']);
    assert.deepEqual(m.partes.slice(0, 3).map((p) => p.entregas), [6, 6, 5]);
    // ordem das entregas da S10 = ordem das paradas da rota_s10 (rota_do_dia) com o mesmo dado
    const nomesChefe = m.partes.slice(0, 3).flatMap((p) => p.params.slice(2)).filter((x) => /^MERCADO/.test(x)).map((x) => x.split(' · ')[0]);
    const rs10 = W.montarRota(d, 's10', AG, {});
    const nomesRota = rs10.partes.flatMap((p) => p.params[3].split('; ')).map((x) => x.replace(/^\d+\) ~\d\d:\d\d /, '').replace(/^\d+\) /, '').split(' — ')[0]);
    assert.deepEqual(nomesChefe, nomesRota);
    assert.match(sug(m).params[5], /\(\+2 entregas sem posição no mapa\)$/);   // k = 4 e 9 da S10
    // só o modelo da sugerida segue o template da rotina; as paradas são sempre rota_paradas
    const m2 = W.montarChefe(d, AG, { template: 'outro_nome' });
    assert.deepEqual([...new Set(m2.partes.map((p) => p.template))], ['rota_paradas', 'outro_nome']);
});

test('rota_chefe: corte — acima de PARTES_MAX-1 mensagens o resto fica no painel e a sugerida avisa (sem ser cortado)', () => {
    const n = (W.WA.PARTES_MAX - 1) * 6 + 13;   // 13 entregas a mais
    const m = chefe(dados({ s10: 0, caminhao: n }));
    assert.equal(m.partes.length, W.WA.PARTES_MAX);
    assert.equal(m.partes[0].params[1], '1 de ' + (W.WA.PARTES_MAX - 1));
    assert.equal(m.resumo.omitidas, 13);
    assert.match(sug(m).params[1], /^\d+ pedidos · \d+ entregas · .* · \+13 entregas só no painel$/);
});

test('rota_chefe: zero pedidos = só a sugerida "nenhum pedido para sair"; domingo/feriado = não manda', () => {
    const m = chefe(dados({}));
    assert.equal(m.partes.length, 1);
    assert.equal(sug(m).template, 'rota_sugerida');
    assert.deepEqual(sug(m).params.slice(1, 7), ['nenhum pedido para sair', 'Caminhão (CEASA): nenhum pedido', 'S10: nenhum pedido', '—', 'nenhuma', 'nenhuma']);
    const dom = W.montarChefe(dados({ s10: 3 }), new Date('2026-11-22T09:00:00Z'), {});
    assert.ok(dom.vazio && dom.partes.length === 0, JSON.stringify(dom.vazio));
});

test('rota_chefe: frota com mais de 3 veículos ativos junta o excedente no {{5}}; veículo que não sai hoje aparece assim', () => {
    const frota = FROTA.map((v) => Object.assign({}, v, { ativo: true })).concat([
        { id: 'fiorino', nome: 'Fiorino', modo: 'porta', capacidade_volume: null, dias_sem_saida: [0, 1], volta_sede: false, cor: '#444444', ordem: 4, ativo: true }]);
    const d = dados({ s10: 4, strada: 3, caminhao: 1 }, { frota });
    const m = chefe(d);
    const s = sug(m).params;
    assert.match(s[4], /^Strada: 3 pedidos · 3 paradas · ~\d+ km \| Fiorino: não sai hoje$/);
    // 2 veículos porta a porta: cada entrega leva o veículo; a ordem sai por veículo
    assert.ok(m.partes[0].params.slice(2).some((x) => / · S10 — /.test(x)));
    assert.match(s[5], /^S10: .* \| Strada: /);
});

test('rota_chefe: pior caso — nomes/ruas gigantes com quebra e emoji: só o endereço é cortado ("…"), caixas e prioridade inteiras', () => {
    const EMO = String.fromCodePoint(0x1f600);
    const d = dados({ s10: 40, caminhao: 40 }, { nome: (i) => ('Nome\n' + EMO + '\tGigante     ').repeat(10) + i, rua: ('Rua ' + EMO + ' Muito\nLonga    ').repeat(12) });
    const m = chefe(d);
    for (const p of m.partes.slice(0, -1)) for (const x of p.params.slice(2)) {
        if (x === '—') continue;
        assert.match(x, /^[^—]+ · \d+ pedidos? · [^—]+ — /, x);
    }
    assert.match(m.partes[0].params[2], /… · prioridade alta · recebe 07:00–10:00$/);
});

test('rota_chefe / pedidos_dia: rotinas fixas, só gestor, "rota_chefe" não é rota do veículo "chefe"', () => {
    assert.equal(W.veiculoDaRotina('rota_chefe'), null);
    assert.equal(W.veiculoDaRotina('rota_strada'), 'strada');
    for (const c of ['rota_chefe', 'pedidos_dia']) {
        assert.ok(W.rotinaConhecida(c));
        assert.ok(W.papelPermitido(c, 'gestor'));
        assert.ok(!W.papelPermitido(c, 'entregador'));
        assert.ok(!W.papelPermitido(c, 'outro'));
    }
    assert.ok(W.papelPermitido('rota_s10', 'entregador'));
});

test('gerar: pedidos_dia e rota_chefe chamam a coleta certa (cliente supabase falso, sem rede)', async () => {
    const lidas = [];
    function consulta(tabela) {
        const q = { _t: tabela, select() { return q; }, eq() { return q; }, is() { return q; }, gte() { return q; }, lt() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; },
                    range() { return q; }, then(ok, ko) { lidas.push(tabela); return Promise.resolve({ data: tabela === 'rota_veiculos' ? FROTA : [], error: null }).then(ok, ko); } };
        return q;
    }
    const sb = { from: consulta, rpc() { return Promise.resolve({ data: [], error: null }); } };
    const a = await W.gerar(sb, 'pedidos_dia', AG_PED, { template: 'pedidos_do_dia' });
    assert.equal(a.partes[0].modelo, 'pedidos_do_dia');
    assert.ok(lidas.includes('solidcon_pedidos_erp') && lidas.includes('solidcon_pedidos_erp_sync'));
    lidas.length = 0;
    const b = await W.gerar(sb, 'rota_chefe', AG, { template: 'rota_sugerida' });
    assert.equal(b.partes.length, 1); assert.equal(b.partes[0].modelo, 'rota_sugerida');
    assert.ok(lidas.includes('rota_veiculos') && lidas.includes('rota_cliente_regras'));
});

test('Sentinela WP-1: 2 veículos porta a porta com nomes no máximo (40) + janela + prioridade + sem posição: nada operacional é cortado', () => {
    const NOME40 = 'Caminhonete com carreta da distribuidora';   // 40, válido na 047
    const frota = [{ id: 'caminhao', nome: 'Caminhão', modo: 'cd_ceasa', capacidade_volume: null, dias_sem_saida: [0], volta_sede: false, cor: '#111111', ordem: 1, ativo: true },
        { id: 's10', nome: NOME40, modo: 'porta', capacidade_volume: null, dias_sem_saida: [0], volta_sede: true, cor: '#222222', ordem: 2, ativo: true },
        { id: 'strada', nome: 'Outra caminhonete de nome bem comprido 40', modo: 'porta', capacidade_volume: null, dias_sem_saida: [0], volta_sede: true, cor: '#333333', ordem: 3, ativo: true }];
    const d = dados({ s10: 3, strada: 2 }, { frota, nome: (i) => 'CLIENTE COM NOME DE TRINTA CH ' + i, rua: 'Rua Muito Comprida do Bairro Que Nao Acaba Mais' });
    // todos com janela + prioridade; e um sem posição
    d.regras = R.regrasDe(Object.keys(d.clientes).map((doc) => ({ documento: doc, janela_inicio: '07:00', janela_fim: '10:00', dias_sem_receber: [], prioridade: true })));
    d.clientes[Object.keys(d.clientes)[0]].pos = null;
    const m = chefe(d);
    const itens = m.partes.slice(0, -1).flatMap((p) => p.params.slice(2)).filter((x) => x !== '—');
    assert.equal(itens.length, 5);
    for (const x of itens) {
        assert.ok(x.length <= W.WA.LIMITES.rota_paradas[2], x.length + ' ' + x);
        assert.match(x, / · \d+ pedidos? · \d+ cx/, x);
        assert.ok(x.includes('prioridade alta') && x.includes('recebe 07:00–10:00'), x);
    }
    assert.ok(itens.some((x) => x.endsWith('· sem posição no mapa')));
});
