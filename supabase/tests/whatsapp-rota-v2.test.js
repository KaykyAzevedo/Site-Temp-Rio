// Testes da rota do WhatsApp no modo v2 (044: marcação CEASA/S10, regras, CD do CEASA, hora prevista). Dados FICTÍCIOS.
// Rodar (da raiz do repo; o arquivo EXPLÍCITO — no Node 24 "node --test supabase/tests/" dá MODULE_NOT_FOUND):
//   node --test supabase/tests/whatsapp-rota-v2.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../functions/_shared/rota-core.js');
const W = require('../functions/_shared/whatsapp-core.js');

const AGORA = new Date('2026-11-24T09:00:00Z');   // terça 06:00 em SP (dia com saída)
const DT = '2026-11-23T10:00:00-03:00';
const CEASA = R.ROTA.CEASA_CENTRO;
let seq = 5000;
function ped(doc, o) {
    return Object.assign({ cd_pedido: ++seq, dt_pedido: DT, etapa: 'aberto', cliente_tipo: doc ? 'cnpj' : 'cpf', documento: doc || null,
                           cliente_nome: null, caixas_24: 2, caixas_48: 1, caixas_outras: 0, valor_centavos: 10000 }, o || {});
}
function docN(i) { return String(10000000000000 + i); }
function cli(nome, dLat, dLng, o) {
    return Object.assign({ nome: nome, bairro: 'Bairro Ficticio', cidade: 'Rio de Janeiro', logradouro: 'Rua Ficticia', numero: '1', complemento: null,
                           pos: [R.ROTA.ORIGEM[0] + dLat, R.ROTA.ORIGEM[1] + dLng], precisao: 'exata' }, o || {});
}
const semQuebra = (ps) => ps.every((s) => !/[\n\r\t]/.test(s) && !/ {4,}/.test(s));
const cabe = (m) => m.partes.every((p) => W.renderizar(p).length <= W.WA.CORPO_MAX && semQuebra(p.params));
const itens = (m) => m.partes.map((p) => p.params[3]).join('; ').split('; ');
const cfg = (o) => R.cfgDe(Object.assign({}, R.CFG_PADRAO, { hora_saida: '07:00', velocidade_kmh: 25, minutos_parada: 10 }, o || {}));

// Supabase falso: tabela ausente = PGRST205; erros[tabela] = erro de leitura; rpc solidcon_rota_posicoes a partir de 'clientes'.
function sbFalso(tabelas, clientes, erros) {
    erros = erros || {};
    return {
        from(nome) {
            let linhas = (tabelas[nome] || []).slice(), de = 0, ate = 1e9, lim = null;
            const erro = erros[nome] || (tabelas[nome] ? null : { code: 'PGRST205', message: 'Could not find the table public.' + nome });
            const b = {
                select() { return b; }, order() { return b; }, is(c, v) { linhas = linhas.filter(r => r[c] == v); return b; },
                in(c, v) { linhas = linhas.filter((r) => v.includes(r[c])); return b; }, eq(c, v) { linhas = linhas.filter((r) => r[c] === v); return b; },
                limit(n) { lim = n; return b; }, range(a, z) { de = a; ate = z; return b; },
                then(ok, er) { const d = erro ? null : linhas.slice(de, ate + 1).slice(0, lim == null ? undefined : lim); return Promise.resolve({ data: d, error: erro }).then(ok, er); }
            };
            return b;
        },
        rpc(n, a) {
            if (n !== 'solidcon_rota_posicoes') return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + n } });   // como o PostgREST (ex.: 050 ausente)
            return Promise.resolve({ data: a.p_documentos.filter((d) => clientes[d]).map((d) => {
                const c = clientes[d];
                return { documento: d, nome: c.nome, bairro: c.bairro, logradouro: c.logradouro, numero: c.numero, complemento: c.complemento, cidade: c.cidade,
                         lat: c.pos ? c.pos[0] : null, lng: c.pos ? c.pos[1] : null, precisao: 'exata', pino_desatualizado: false };
            }), error: null });
        }
    };
}

// Cenário base: 4 S10 marcados, 1 sem marcação, 2 boxes do CEASA, 1 cliente de "bairro do caminhão" marcado CEASA (v3: vai
// para o CD como os outros; bairros_caminhao fica no banco sem uso), 1 que não recebe terça.
function cenario() {
    const c = {
        [docN(1)]: cli('Mercado Um', 0.010, 0.010), [docN(2)]: cli('Mercado Dois', 0.020, -0.010), [docN(3)]: cli('Mercado Tres', 0.030, 0.020),
        [docN(4)]: cli('Mercado Quatro', 0.040, -0.020), [docN(5)]: cli('Sem Marca', 0.015, 0.000),
        [docN(6)]: cli('Box Ficticio A', 0, 0, { pos: CEASA, logradouro: 'Av Brasil', numero: '19001', bairro: 'Irajá' }),
        [docN(7)]: cli('Box Ficticio B', 0, 0, { pos: [CEASA[0] + 0.001, CEASA[1]], bairro: 'Irajá' }),
        [docN(8)]: cli('Porta Caminhao', 0.10, -0.01, { bairro: 'Bairro Do Caminhao' }),
        [docN(9)]: cli('Fecha Terca', 0.025, 0.005)
    };
    const pedidos = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ped(docN(i)));
    const padroes = [{ documento: docN(1), veiculo: 's10' }, { documento: docN(2), veiculo: 's10' }, { documento: docN(3), veiculo: 's10' },
                     { documento: docN(4), veiculo: 's10' }, { documento: docN(6), veiculo: 'caminhao' }, { documento: docN(7), veiculo: 'caminhao' },
                     { documento: docN(8), veiculo: 'caminhao' }, { documento: docN(9), veiculo: 's10' }];
    const regras = [{ documento: docN(2), janela_inicio: '08:00:00', janela_fim: '11:00:00', dias_sem_receber: [], prioridade: false, observacao: 'Portao lateral' },
                    { documento: docN(9), janela_inicio: null, janela_fim: null, dias_sem_receber: [2], prioridade: false, observacao: null }];
    const tabelas = { rota_059_saidas: [], solidcon_pedidos_erp: pedidos, solidcon_pedidos_erp_sync: [{ status: 'ok', coletado_em: '2026-11-24T08:50:00Z' }],
                      rota_config: [{ id: 1, bairros_caminhao: ['Bairro do Caminhão'], hora_saida: '07:00:00', velocidade_kmh: 25, minutos_parada: 10 }],
                      rota_cliente_veiculo: padroes, rota_pedido_veiculo: [], rota_cliente_regras: regras };
    return { c, pedidos, tabelas };
}

test('coleta sem a 044 (tabelas ausentes): d sem v2 e mensagem igual à do modo automático', async () => {
    const { c, tabelas } = cenario();
    tabelas.rota_cliente_veiculo = tabelas.solidcon_pedidos_erp.map(p=>({documento:p.documento,veiculo:'s10'}));delete tabelas.rota_pedido_veiculo; delete tabelas.rota_cliente_regras;
    const d = await W.coletarRota(sbFalso(tabelas, c));
    assert.equal(d.v2, undefined);
    const m = W.montarRota(d, 's10', AGORA, {});
    assert.equal(m.resumo.modo, undefined);
    // Automático: o "Sem Marca" entra (não existe marcação) e ninguém ganha "~HH:MM".
    assert.ok(/Sem Marca/.test(m.texto));
    assert.ok(!/~\d\d:\d\d/.test(m.texto));
});

test('coleta com a 044 PARCIAL (uma tabela ausente) = modo automático', async () => {
    const { c, tabelas } = cenario();
    delete tabelas.rota_cliente_regras;
    const d = await W.coletarRota(sbFalso(tabelas, c));
    assert.equal(d.v2, undefined);
});

test('coleta com a 044: escolha por pedido e regras lidas', async () => {
    const { c, pedidos, tabelas } = cenario();
    tabelas.rota_pedido_veiculo = [{ cd_pedido: pedidos[0].cd_pedido, veiculo: 'caminhao' }, { cd_pedido: 99999, veiculo: 'xpto' }];
    const d = await W.coletarRota(sbFalso(tabelas, c));
    assert.equal(d.v2, true);
    assert.deepEqual(d.porPedido, { [pedidos[0].cd_pedido]: 'caminhao' });
    assert.equal(d.regras[docN(2)].janela, '08:00–11:00');
    assert.ok(d.regras[docN(9)].dias[2]);
});

test('coleta com a 044 e ERRO de leitura (timeout) = falha, nunca rota sem as marcações', async () => {
    const { c, tabelas } = cenario();
    for (const t of ['rota_pedido_veiculo', 'rota_cliente_regras']) {
        await assert.rejects(W.coletarRota(sbFalso(tabelas, c, { [t]: { code: '57014', message: 'canceling statement due to statement timeout' } })), /timeout/);
    }
});

test('S10 v2: só marcados; sem marcação e dia fechado ficam fora; hora prevista por parada; janela no fim', async () => {
    const { c, tabelas } = cenario();
    const d = await W.coletarRota(sbFalso(tabelas, c));
    const m = W.montarRota(d, 's10', AGORA, {});
    assert.equal(m.resumo.modo, 'marcacao');
    assert.equal(m.resumo.paradas, 4);
    assert.equal(m.resumo.aguardando, 1);
    assert.equal(m.resumo.fica, 1);                       // Fecha Terca (não recebe terça)
    assert.ok(!/Sem Marca|Fecha Terca|Box Ficticio|Porta Caminhao/.test(m.texto));
    const it = itens(m);
    assert.equal(it.length, 4);
    for (const x of it) assert.match(x, /^\d+\) ~\d\d:\d\d .+ — .+ — .+$/);
    assert.ok(it.some((x) => /Mercado Dois — .+ — recebe 08:00–11:00$/.test(x)));
    // Horas crescentes na ordem da rota e a primeira depois da saída (07:00).
    const horas = it.map((x) => x.match(/~(\d\d):(\d\d)/)).map((h) => Number(h[1]) * 60 + Number(h[2]));
    assert.ok(horas[0] > 7 * 60 && horas.every((h, i) => i === 0 || h >= horas[i - 1]), String(horas));
    assert.ok(cabe(m));
});

test('v3 caminhão: SÓ o CD do CEASA, UM item, com clientes e caixas (cliente do bairro do caminhão também vai ao CD)', async () => {
    const { c, tabelas } = cenario();
    const d = await W.coletarRota(sbFalso(tabelas, c));
    const m = W.montarRota(d, 'caminhao', AGORA, {});
    const it = itens(m);
    assert.equal(m.resumo.paradas, 1);                    // só o CD
    assert.equal(m.resumo.cd, 3);
    assert.equal(it.length, 1);
    assert.match(it[0], /^1\) ~\d\d:\d\d CD CEASA — 3 clientes — 6 cx24 \+ 3 cx48$/);
    assert.equal(m.partes[0].params[2], 'parada 1 de 1');
    assert.ok(!/Box Ficticio|Porta Caminhao/.test(m.texto));   // a carga do CD não lista cliente por cliente
    const o = R.ROTA.ORIGEM;
    assert.ok(m.partes[0].params[4].includes('origin=' + o[0].toFixed(5) + ',' + o[1].toFixed(5)));
    const url = m.partes[m.partes.length - 1].params[4];
    assert.ok(url.includes('destination=' + CEASA[0].toFixed(5) + ',' + CEASA[1].toFixed(5)), url);
    assert.equal(m.partes.length, 1);
    assert.ok(cabe(m));
});

test('v2: escolha SÓ DESTE PEDIDO tira o pedido da S10 e leva para o CD', async () => {
    const { c, pedidos, tabelas } = cenario();
    tabelas.rota_pedido_veiculo = [{ cd_pedido: pedidos[0].cd_pedido, veiculo: 'caminhao' }];
    const d = await W.coletarRota(sbFalso(tabelas, c));
    const s = W.montarRota(d, 's10', AGORA, {}), k = W.montarRota(d, 'caminhao', AGORA, {});
    assert.ok(!/Mercado Um/.test(s.texto));
    assert.equal(s.resumo.paradas, 3);
    assert.match(itens(k).pop(), /CD CEASA — 4 clientes/);
});

test('v2: nada marcado = vazio dizendo quantos aguardam marcação', async () => {
    const { c, tabelas } = cenario();
    tabelas.rota_cliente_veiculo = [];
    const d = await W.coletarRota(sbFalso(tabelas, c));
    const m = W.montarRota(d, 's10', AGORA, {});
    assert.equal(m.partes.length, 0);
    assert.equal(m.vazio, 'sem paradas (9 pedidos aguardando marcação CEASA/S10)');
});

test('v2 pior caso: 60 paradas, nomes/bairros longos, janelas: ≤ 1024, sem quebra, item ≤ 115, hora nunca cortada', () => {
    const clientes = {}, pedidos = [], padroes = {}, regras = {};
    for (let i = 1; i <= 60; i++) {
        const d = docN(100 + i);
        const bairro = i % 3 ? 'Bairro Com Nome Realmente Gigante ' + i : 'Bairro Do Caminhao Com Nome Bem Comprido';
        clientes[d] = cli('Supermercado Ficticio Nome Muito Comprido Mesmo ' + i, 0.002 * i, (i % 7) * 0.003, { bairro: bairro });
        pedidos.push(ped(d, { caixas_24: 1, caixas_48: 1, caixas_outras: 5 }));
        padroes[d] = i % 3 ? 's10' : 'caminhao';
        if (i % 2) regras[d] = R.regraDe({ janela_inicio: '06:30', janela_fim: '23:59', dias_sem_receber: [], prioridade: i % 5 === 0 });
    }
    for (let i = 1; i <= 3; i++) { const d = docN(800 + i); clientes[d] = cli('Box CEASA ' + 'Z'.repeat(80), 0, 0, { pos: CEASA, bairro: 'Irajá' }); pedidos.push(ped(d, { caixas_24: 99, caixas_48: 99, caixas_outras: 999 })); padroes[d] = 'caminhao'; }
    for (let i = 1; i <= 5; i++) { const d = docN(900 + i); clientes[d] = cli('Sem Pino ' + 'X'.repeat(60), 0, 0, { pos: null, bairro: 'Y'.repeat(60) }); pedidos.push(ped(d)); padroes[d] = 's10'; }
    const d = { pedidos, clientes, cfg: cfg({ bairrosCaminhao: ['Bairro Do Caminhao Com Nome Bem Comprido'] }), excecoes: padroes, porPedido: {}, regras, v2: true, coletado: null };
    for (const v of ['s10', 'caminhao']) {
        const m = W.montarRota(d, v, AGORA, {});
        assert.ok(m.partes.length >= (v === 's10' ? 3 : 1), v + ': ' + m.partes.length);
        // v3: caminhão = 1 mensagem, só o CD (20 clientes de "bairro" + 3 boxes)
        if (v === 'caminhao') { assert.equal(m.partes.length, 1); assert.deepEqual(itens(m).map((x) => x.replace(/~\d\d:\d\d/, '~HH')), ['1) ~HH CD CEASA — 23 clientes — 317 cx24 + 317 cx48 + 3097 potes']); }
        assert.ok(cabe(m), v);
        for (const p of m.partes) for (const x of p.params[3].split('; ')) {
            assert.ok(x.length <= 115, x);
            if (p.params[4].startsWith('https://')) assert.match(x, /^\d+\) ~\d\d:\d\d /);
        }
    }
});

// ---------- WA1: só TABELA ausente cai para o modo automático; coluna/outra relação/etc. = falha ----------
test('WA1: coluna ausente, outra relação e erro sem código NÃO viram "044 ausente" (falha ao montar)', async () => {
    const { c, tabelas } = cenario();
    const casos = [
        ['rota_pedido_veiculo', { code: '42703', message: 'column rota_pedido_veiculo.veiculo does not exist' }],
        ['rota_cliente_regras', { code: 'PGRST204', message: "Could not find the 'prioridade' column of 'rota_cliente_regras' in the schema cache" }],
        ['rota_cliente_regras', { code: '42P01', message: 'relation "public.admins" does not exist' }],
        ['rota_pedido_veiculo', { code: 'PGRST205', message: "Could not find the table 'public.outra_tabela' in the schema cache" }],
        ['rota_cliente_veiculo', { code: '42703', message: 'column rota_cliente_veiculo.veiculo does not exist' }],
        ['rota_config', { code: '42703', message: 'column rota_config.hora_saida does not exist' }],
        ['rota_pedido_veiculo', { message: 'function public.pode_marcar_rota() does not exist' }],
        // sem code, mesmo com a frase exata de tabela ausente da PRÓPRIA tabela: rejeita (só o código vale)
        ['rota_cliente_regras', { message: "Could not find the table 'public.rota_cliente_regras' in the schema cache" }],
        ['rota_pedido_veiculo', { message: 'relation "public.rota_pedido_veiculo" does not exist' }]
    ];
    for (const [t, e] of casos) await assert.rejects(W.coletarRota(sbFalso(tabelas, c, { [t]: e })), (x) => x.message === e.message, t + ' ' + e.code);
});

test('WA1: tabela da 044 ausente pelo código, com o nome dela = modo automático', async () => {
    const { c, tabelas } = cenario();
    for (const e of [{ code: '42P01', message: 'relation "public.rota_pedido_veiculo" does not exist' },
                     { code: 'PGRST205', message: "Could not find the table 'public.rota_pedido_veiculo' in the schema cache" }]) {
        const d = await W.coletarRota(sbFalso(tabelas, c, { rota_pedido_veiculo: e }));
        assert.equal(d.v2, undefined, e.code);
    }
});

// ---------- v3: o caminhão é SÓ o CD (sem portas): rota grande continua 1 mensagem ----------
function cenarioCaminhaoGrande(n, comPino) {
    const { c, pedidos, tabelas } = cenario();
    for (let i = 1; i <= n; i++) {
        const d = docN(2000 + i);
        c[d] = cli('Cliente Caminhao ' + i, 0.001 * (i % 20), 0.001 * Math.floor(i / 20), { bairro: 'Bairro Do Caminhao' });
        if (!comPino) c[d].pos = null;
        pedidos.push(ped(d)); tabelas.rota_cliente_veiculo.push({ documento: d, veiculo: 'caminhao' });
    }
    return { c, tabelas };
}
for (const [n, comPino] of [[500, false], [400, true]]) {
    test('v3: caminhão com ' + n + ' clientes ' + (comPino ? 'com' : 'sem') + ' posição = 1 mensagem, só o CD, link sede -> CD', async () => {
        const { c, tabelas } = cenarioCaminhaoGrande(n, comPino);
        const m = W.montarRota(await W.coletarRota(sbFalso(tabelas, c)), 'caminhao', AGORA, {});
        assert.deepEqual([m.resumo.paradas, m.resumo.semPosicao, m.resumo.links, m.resumo.omitidas, m.partes.length, m.resumo.cd], [1, 0, 1, 0, 1, n + 3]);
        assert.match(m.partes[0].params[3], new RegExp('^1\\) ~\\d\\d:\\d\\d CD CEASA — ' + (n + 3) + ' clientes — '));
        const o = R.ROTA.ORIGEM, url = m.partes[0].params[4];
        assert.ok(url.includes('origin=' + o[0].toFixed(5) + ',' + o[1].toFixed(5)) && url.includes('destination=' + CEASA[0].toFixed(5) + ',' + CEASA[1].toFixed(5)), url);
        assert.ok(cabe(m));
    });
}

test('v3: S10 gigante (500 sem posição) continua cortada com aviso no fim (PARTES_MAX)', async () => {
    const { c, pedidos, tabelas } = cenario();
    for (let i = 1; i <= 500; i++) { const d = docN(4000 + i); c[d] = cli('Sem Pino ' + i, 0, 0, { pos: null }); pedidos.push(ped(d, { caixas_24: 0, caixas_48: 0 })); tabelas.rota_cliente_veiculo.push({ documento: d, veiculo: 's10' }); }
    const m = W.montarRota(await W.coletarRota(sbFalso(tabelas, c)), 's10', AGORA, {});
    assert.equal(m.partes.length, W.WA.PARTES_MAX);
    const ult = m.partes[m.partes.length - 1];
    assert.equal(ult.params[2], 'aviso');
    const enviadas = m.partes.slice(0, -1).reduce((a, p) => a + p.paradas, 0);
    assert.equal(enviadas + m.resumo.omitidas, m.resumo.paradas);
    assert.ok(ult.params[3].includes('(' + (enviadas + 1) + ' a ' + m.resumo.paradas + ')'), ult.params[3]);
    assert.ok(cabe(m));
});

// ---------- 045: "tirar da rota" (rota_pedido_ignorado) ----------
test('045: pedido ignorado não vai na mensagem (S10 e CD) nem conta como aguardando; resumo.ignorados', async () => {
    const { c, pedidos, tabelas } = cenario();
    const base = W.montarRota(await W.coletarRota(sbFalso(tabelas, c)), 's10', AGORA, {});
    assert.equal(base.resumo.ignorados, 0);
    tabelas.rota_pedido_ignorado = [{ cd_pedido: pedidos[0].cd_pedido }, { cd_pedido: pedidos[4].cd_pedido }, { cd_pedido: pedidos[5].cd_pedido }, { cd_pedido: 424242 }];
    const d = await W.coletarRota(sbFalso(tabelas, c));
    assert.deepEqual(Object.keys(d.ignorados).map(Number).sort((a, b) => a - b), [pedidos[0].cd_pedido, pedidos[4].cd_pedido, pedidos[5].cd_pedido, 424242].sort((a, b) => a - b));
    const s10 = W.montarRota(d, 's10', AGORA, {}), cam = W.montarRota(d, 'caminhao', AGORA, {});
    assert.ok(!/Mercado Um/.test(s10.texto));
    assert.deepEqual([s10.resumo.paradas, s10.resumo.aguardando, s10.resumo.ignorados], [3, 0, 3]);   // Sem Marca ignorado: sai de aguardando
    assert.match(itens(cam)[0], /CD CEASA — 2 clientes/);                                          // Box A ignorado
});

test('045 ausente = ninguém ignorado (e v2 continua); 045 com erro de leitura = falha ao montar', async () => {
    const { c, tabelas } = cenario();
    const d = await W.coletarRota(sbFalso(tabelas, c));
    assert.deepEqual([d.v2, d.ignorados], [true, {}]);
    for (const e of [{ code: '57014', message: 'canceling statement due to statement timeout' }, { code: '42501', message: 'permission denied for table rota_pedido_ignorado' },
                     { message: "Could not find the table 'public.rota_pedido_ignorado' in the schema cache" }]) {
        tabelas.rota_pedido_ignorado = [];
        await assert.rejects(W.coletarRota(sbFalso(tabelas, c, { rota_pedido_ignorado: e })), (x) => x.message === e.message);
    }
    // v1 (sem 044) com 045 lida: também respeita
    delete tabelas.rota_pedido_veiculo; tabelas.rota_pedido_ignorado = [{ cd_pedido: tabelas.solidcon_pedidos_erp[4].cd_pedido }];
    const d1 = await W.coletarRota(sbFalso(tabelas, c));
    assert.equal(d1.v2, undefined);
    assert.ok(/Mercado Um/.test(W.montarRota(d1, 's10', AGORA, {}).texto));
    assert.ok(!/Sem Marca/.test(W.montarRota(d1, 's10', AGORA, {}).texto));
});
