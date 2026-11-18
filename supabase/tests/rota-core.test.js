// Testes do núcleo da Rota (044: marcação CEASA/S10, regras e horários). Dados FICTÍCIOS.
// Rodar (da raiz do repo; o arquivo EXPLÍCITO — no Node 24 "node --test supabase/tests/" dá MODULE_NOT_FOUND):
//   node --test supabase/tests/rota-core.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../functions/_shared/rota-core.js');
const W = require('../functions/_shared/whatsapp-core.js');

const DIA = '2026-11-24';                       // terça (dia com saída)
const DT = '2026-11-23T10:00:00-03:00';         // pedido da véspera: prazo 25/11
const CEASA = R.ROTA.CEASA_CENTRO;
let seq = 1000;
function ped(doc, o) {
    o = o || {};
    return Object.assign({ cd_pedido: ++seq, dt_pedido: DT, etapa: 'aberto', cliente_tipo: doc ? 'cnpj' : 'cpf', documento: doc || null,
                           cliente_nome: null, caixas_24: 2, caixas_48: 1, caixas_outras: 0, valor_centavos: 10000 }, o);
}
// Cliente fictício a dLat/dLng graus da sede.
function cli(nome, dLat, dLng, o) {
    return Object.assign({ nome: nome, bairro: 'Barra da Tijuca', cidade: 'Rio de Janeiro', logradouro: 'Rua Ficticia', numero: '1', complemento: null,
                           pos: [R.ROTA.ORIGEM[0] + dLat, R.ROTA.ORIGEM[1] + dLng], precisao: 'exata' }, o || {});
}
function docN(i) { return String(10000000000000 + i).padStart(14, '0'); }
const nomes = (ps) => ps.map((p) => p.nome);

test('compat whatsapp-rotinas: sem "marcacao" o planejador segue automático (como antes da 044)', () => {
    const clientes = { [docN(1)]: cli('Box Ceasa', 0, 0, { pos: CEASA, logradouro: 'Av Brasil', numero: '19001' }),
                       [docN(2)]: cli('Mercado A', 0.01, 0.01), [docN(3)]: cli('Mercado B', 0.03, -0.02) };
    const pedidos = [ped(docN(1)), ped(docN(2)), ped(docN(3))];
    const pl = R.planejar(pedidos, clientes, DIA, { cfg: R.cfgDe(R.CFG_PADRAO), excecoes: {} });
    assert.equal(pl.modo, 'auto');
    assert.equal(pl.aguardando.length, 0);
    assert.equal(pl.caminhao.cd, null);
    assert.deepEqual(pl.caminhao.paradas.map((s) => s.documento), [docN(1)]);
    assert.equal(pl.s10.paradas.length, 2);
    // Sem regras: ordem = ordenarParadas de antes (vizinho + 2-opt por distância).
    const esperado = R.ordenarParadas(R.ROTA.ORIGEM, pl.s10.paradas.slice().reverse(), false);
    assert.deepEqual(nomes(pl.s10.paradas), nomes(esperado));
    // Exceção (040) continua mandando no modo automático.
    const pl2 = R.planejar(pedidos, clientes, DIA, { excecoes: { [docN(2)]: 'caminhao' } });
    assert.ok(pl2.caminhao.pedidos.some((x) => x.p.documento === docN(2)));
    // A mensagem da whatsapp-rotinas monta igual (campos que ela usa continuam lá).
    const d = { pedidos, clientes, cfg: R.cfgDe(R.CFG_PADRAO), excecoes: {} };
    const agora = new Date(DIA + 'T09:00:00-03:00');
    const s10 = W.montarRota(d, 's10', agora, {});
    assert.ok(!s10.vazio && s10.partes.length >= 1);
    assert.equal(s10.resumo.paradas, 2);
    const cam = W.montarRota(d, 'caminhao', agora, {});
    assert.equal(cam.resumo.paradas, 1);
});

test('cliente novo sem marcação NÃO entra na rota: vai para aguardando, com a sugestão automática', () => {
    const clientes = { [docN(1)]: cli('Box Ceasa', 0, 0, { pos: CEASA, complemento: 'CEASA pavilhão 30' }), [docN(2)]: cli('Mercado Novo', 0.01, 0.01) };
    const pedidos = [ped(docN(1)), ped(docN(2)), ped(null)];
    const pl = R.planejar(pedidos, clientes, DIA, { marcacao: true, padroes: {}, porPedido: {} });
    assert.equal(pl.modo, 'marcacao');
    assert.equal(pl.aguardando.length, 3);
    assert.equal(pl.s10.pedidos.length + pl.caminhao.pedidos.length + pl.fica.length, 0);
    assert.deepEqual(Object.keys(pl.entregues), []);
    const porDoc = {}; pl.aguardando.forEach((x) => { porDoc[x.p.documento] = x; });
    assert.deepEqual([porDoc[docN(1)].sugestao.veiculo, porDoc[docN(1)].sugestao.motivo], ['caminhao', 'ceasa']);
    assert.deepEqual([porDoc[docN(2)].sugestao.veiculo, porDoc[docN(2)].sugestao.motivo], ['s10', 'padrao']);
    assert.equal(porDoc.null.marcacao, null);
});

test('escolha "só neste pedido" vence o padrão; padrão vale para os outros pedidos do cliente', () => {
    const clientes = { [docN(1)]: cli('Box Ceasa', 0, 0, { pos: CEASA, bairro: 'Irajá', logradouro: 'Av. Brasil', numero: '19.001' }) };
    const a = ped(docN(1)), b = ped(docN(1)), pf = ped(null);
    const pl = R.planejar([a, b, pf], clientes, DIA, { marcacao: true, padroes: { [docN(1)]: 'caminhao' }, porPedido: { [b.cd_pedido]: 's10', [pf.cd_pedido]: 's10' } });
    const xa = pl.caminhao.pedidos.find((x) => x.p.cd_pedido === a.cd_pedido);
    const xb = pl.s10.pedidos.find((x) => x.p.cd_pedido === b.cd_pedido);
    assert.ok(xa && xb);
    assert.equal(xa.marcacao, 'padrao'); assert.equal(xb.marcacao, 'pedido');
    assert.equal(xa.entrega, 'cd');
    // Cliente do CEASA marcado S10 neste pedido: a S10 vai na posição do cadastro do ERP.
    assert.deepEqual(pl.s10.paradas.find((s) => s.documento === docN(1)).pos, CEASA);
    // PF (sem documento) só tem escolha por pedido.
    assert.ok(pl.s10.pedidos.some((x) => x.p.cd_pedido === pf.cd_pedido && x.marcacao === 'pedido'));
    assert.deepEqual(R.marcacaoDe(pf, { x: 'caminhao' }, {}), null);
    // opts.excecoes serve de padrões quando opts.padroes não vem (mesma tabela rota_cliente_veiculo).
    const pl2 = R.planejar([a], clientes, DIA, { marcacao: true, excecoes: { [docN(1)]: 's10' } });
    assert.equal(pl2.s10.pedidos.length, 1);
});

test('CEASA vira UMA parada (CD) no fim do caminhão, com a carga agregada; bairro do caminhão fica na porta', () => {
    const cfg = R.cfgDe({ bairros_caminhao: ['Vila da Penha'] });
    const clientes = {
        [docN(1)]: cli('Box Um', 0, 0, { pos: [CEASA[0] + 0.001, CEASA[1]], complemento: 'Ceasa' }),
        [docN(2)]: cli('Box Dois', 0, 0, { pos: [CEASA[0], CEASA[1] + 0.002], logradouro: 'Avenida Brasil', numero: '19001' }),
        [docN(3)]: cli('Cliente Longe Marcado CEASA', 0.05, 0.05),              // marcado CEASA: retira no CD
        [docN(4)]: cli('Mercado Penha', 0, 0, { pos: [-22.8400, -43.2800], bairro: 'Vila da Penha' })
    };
    const p1 = ped(docN(1), { caixas_24: 3, caixas_48: 0 }), p1b = ped(docN(1), { caixas_24: 1, caixas_48: 2, caixas_outras: 24 });
    const p2 = ped(docN(2), { caixas_24: null, caixas_48: null }), p3 = ped(docN(3)), p4 = ped(docN(4));
    const padroes = { [docN(1)]: 'caminhao', [docN(2)]: 'caminhao', [docN(3)]: 'caminhao', [docN(4)]: 'caminhao' };
    const pl = R.planejar([p1, p1b, p2, p3, p4], clientes, DIA, { marcacao: true, cfg, padroes });
    const cam = pl.caminhao;
    assert.equal(cam.paradas.length, 2);
    assert.equal(cam.paradas[0].documento, docN(4));                       // porta no caminho
    const cd = cam.paradas[1];
    assert.equal(cd.cd, true); assert.equal(cam.cd, cd); assert.deepEqual(cd.pos, CEASA);
    assert.equal(cd.carga.length, 3);                                     // 3 clientes, 4 pedidos
    const um = cd.carga.find((i) => i.documento === docN(1));
    assert.deepEqual([um.pedidos.length, um.c24, um.c48, um.avulsos, um.caixas, um.valorCentavos], [2, 4, 2, 24, 6, 20000]);
    const dois = cd.carga.find((i) => i.documento === docN(2));
    assert.equal(dois.volume, null); assert.equal(dois.desconhecidos, 1);
    assert.deepEqual([cd.total.clientes, cd.total.pedidos, cd.total.caixas, cd.total.desconhecidos], [3, 4, 9, 1]);
    // O km do caminhão vai até o CD; o link do Maps termina no CD.
    const links = R.linksGoogleMaps(cam.paradas);
    assert.ok(links[0].url.includes('destination=' + CEASA[0].toFixed(5)));
    assert.ok(cam.km > 0 && cam.horario.fim);
});

test('dia que o cliente não recebe: pedido vai para a próxima saída em que ele recebe (estoura se passar do prazo)', () => {
    const ds = R.diaSemana(DIA);
    const clientes = { [docN(1)]: cli('Fecha Terça', 0.01, 0.01), [docN(2)]: cli('Recebe', 0.02, 0.01) };
    const pa = ped(docN(1)), pb = ped(docN(2));
    const regras = [{ documento: docN(1), dias_sem_receber: [ds, (ds + 1) % 7] }];
    const pl = R.planejar([pa, pb], clientes, DIA, { marcacao: true, padroes: { [docN(1)]: 's10', [docN(2)]: 's10' }, regras });
    assert.deepEqual(pl.s10.pedidos.map((x) => x.p.documento), [docN(2)]);
    const f = pl.fica.find((x) => x.p.cd_pedido === pa.cd_pedido);
    assert.equal(f.motivoFica, 'dia_fechado');
    assert.equal(f.proxima, R.somaDias(DIA, 2));                          // pula terça e quarta
    assert.equal(f.estoura, true);                                         // prazo 25/11 < 26/11
    assert.ok(!pl.entregues[pa.cd_pedido]);
    // Vale também no modo automático quando há regras (e não ocupa a S10).
    const pl2 = R.planejar([pa], clientes, DIA, { regras });
    assert.equal(pl2.fica[0].motivoFica, 'dia_fechado');
});

test('prioridade "entregar primeiro": prioritários antes dos outros, mesmo longe', () => {
    const clientes = {};
    const pedidos = [];
    for (let i = 1; i <= 6; i++) { clientes[docN(i)] = cli('Perto ' + i, 0.003 * i, 0.002 * i); pedidos.push(ped(docN(i))); }
    clientes[docN(9)] = cli('Longe Prioritario', 0.12, 0.1); pedidos.push(ped(docN(9)));
    const padroes = {}; Object.keys(clientes).forEach((d) => { padroes[d] = 's10'; });
    const pl = R.planejar(pedidos, clientes, DIA, { marcacao: true, padroes, regras: [{ documento: docN(9), prioridade: true }] });
    assert.equal(pl.s10.paradas[0].documento, docN(9));
    assert.equal(pl.s10.paradas[0].prioridade, true);
    const sem = R.planejar(pedidos, clientes, DIA, { marcacao: true, padroes });
    assert.notEqual(sem.s10.paradas[0].documento, docN(9));
});

test('horário: eta = saída + linha reta × fator ÷ velocidade; chegou cedo espera abrir', () => {
    const clientes = { [docN(1)]: cli('Abre 9h', 0.05, 0) };
    const p = ped(docN(1));
    const cfg = R.cfgDe({ hora_saida: '06:30:00', velocidade_kmh: 30, minutos_parada: 8 });
    const pl = R.planejar([p], clientes, DIA, { marcacao: true, cfg, padroes: { [docN(1)]: 's10' }, regras: [{ documento: docN(1), janela_inicio: '09:00' }] });
    const sp = pl.s10.paradas[0];
    const min = 6 * 60 + 30 + R.km(R.ROTA.ORIGEM, sp.pos) * R.ROTA.FATOR_ESTRADA / 30 * 60;
    assert.equal(sp.chegadaMin, Math.round(min));
    assert.equal(sp.eta, R.hhmm(min));
    assert.equal(sp.espera, Math.round(9 * 60 - min));
    assert.equal(sp.atraso, 0);
    assert.equal(sp.saidaMin, 9 * 60 + 8);
    assert.equal(sp.janela, 'a partir de 09:00');
    assert.equal(pl.s10.horario.saida, '06:30');
    // Padrões da migração quando a coluna não existe (sem a 044 aplicada).
    const c0 = R.cfgDe({});
    assert.deepEqual([c0.horaSaida, c0.velocidadeKmh, c0.minutosParada], [420, 25, 10]);
});

test('janela: inserção encaixa quem fecha cedo; impossível fica na melhor posição com atraso em minutos', () => {
    const clientes = {}, pedidos = [], padroes = {};
    // Linha de 8 clientes indo para o norte; o ÚLTIMO pela distância fecha às 08:00 (cabe se for primeiro).
    for (let i = 1; i <= 8; i++) { clientes[docN(i)] = cli('Linha ' + i, 0.012 * i, 0); pedidos.push(ped(docN(i))); padroes[docN(i)] = 's10'; }
    // Um impossível: fecha 07:05, a ~20 km.
    clientes[docN(20)] = cli('Impossivel', -0.0, 0.19); pedidos.push(ped(docN(20))); padroes[docN(20)] = 's10';
    const regras = [{ documento: docN(8), janela_fim: '08:00' }, { documento: docN(20), janela_fim: '07:05' }];
    const sem = R.planejar(pedidos, clientes, DIA, { marcacao: true, padroes, regras: [] });
    const semAtraso = R.calcularHorarios(R.ROTA.ORIGEM, sem.s10.paradas.map((s) => Object.assign({}, s, { regra: R.regraDe(regras.find((r) => r.documento === s.documento) || null) })), R.tempoDe(null), false);
    const pl = R.planejar(pedidos, clientes, DIA, { marcacao: true, padroes, regras });
    const p8 = pl.s10.paradas.find((s) => s.documento === docN(8));
    const imp = pl.s10.paradas.find((s) => s.documento === docN(20));
    assert.equal(p8.atraso, 0, 'o cliente que fecha 08:00 é atendido a tempo');
    assert.ok(imp.atraso > 0, 'o impossível fica marcado com atraso');
    assert.equal(pl.s10.paradas.length, 9, 'ninguém sai da rota por causa da janela');
    assert.ok(pl.s10.horario.atrasoTotal <= semAtraso.atrasoTotal, 'a melhoria nunca piora as violações');
    assert.equal(pl.s10.horario.atrasos, 1);
});

test('regras: janela invertida é ignorada; dias e observação normalizados', () => {
    const r = R.regraDe({ janela_inicio: '12:00', janela_fim: '09:00', dias_sem_receber: [6, 6, 9, 0], prioridade: 1, observacao: 'x'.repeat(250) });
    assert.equal(r.ini, null); assert.equal(r.fim, null); assert.equal(r.janela, null);
    assert.deepEqual(Object.keys(r.dias).sort(), ['0', '6']);
    assert.equal(r.prioridade, true); assert.equal(r.obs.length, 200);
    assert.equal(R.regraDe({ janela_fim: '10:30:00' }).janela, 'até 10:30');
    assert.equal(R.minutosDe('25:00'), null); assert.equal(R.minutosDe('07:05'), 425);
    const m = R.regrasDe([{ documento: docN(1), prioridade: true }, { documento: null, prioridade: true }]);
    assert.deepEqual(Object.keys(m), [docN(1)]);
    assert.equal(R.proximaSaidaCliente(DIA, R.regraDe({ dias_sem_receber: [0, 1, 2, 3, 4, 5, 6] }), null), null);
});

test('desempenho: ~60 paradas com janelas e prioridades em menos de 50 ms', () => {
    let s = 42; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const clientes = {}, pedidos = [], padroes = {}, regras = [];
    for (let i = 1; i <= 60; i++) {
        const d = docN(i);
        clientes[d] = cli('C' + i, (rnd() - 0.3) * 0.08, (rnd() - 0.5) * 0.1);
        pedidos.push(ped(d, { caixas_24: 1, caixas_48: 0 })); padroes[d] = 's10';
        if (i % 3 === 0) { const ini = 420 + Math.floor(rnd() * 300); regras.push({ documento: d, janela_inicio: R.hhmm(ini), janela_fim: R.hhmm(ini + 60 + Math.floor(rnd() * 120)) }); }
        else if (i % 11 === 0) regras.push({ documento: d, prioridade: true });
    }
    const o = { marcacao: true, padroes, regras };
    R.planejar(pedidos, clientes, DIA, o);                                 // aquecimento (JIT)
    const tempos = [];
    for (let k = 0; k < 5; k++) { const t = process.hrtime.bigint(); R.planejar(pedidos, clientes, DIA, o); tempos.push(Number(process.hrtime.bigint() - t) / 1e6); }
    tempos.sort((a, b) => a - b);
    const pl = R.planejar(pedidos, clientes, DIA, o);
    assert.equal(pl.s10.paradas.length, 60);
    assert.ok(tempos[2] < 50, 'mediana ' + tempos[2].toFixed(1) + ' ms');
});

// ---- Achados da revisão (Sentinela) ----
test('R1 capacidade: quem não cabe vai para a próxima saída ELEGÍVEL do cliente (não a global) e estoura', () => {
    const clientes = { [docN(1)]: cli('Enche S10', 0.01, 0.01), [docN(2)]: cli('Fecha Quarta', 0.02, 0.01) };
    const cheio = ped(docN(1), { dt_pedido: '2026-11-22T10:00:00-03:00', caixas_24: 174, caixas_48: 0, caixas_outras: 0 });   // 1566 = S10 cheia
    const b = ped(docN(2), { caixas_24: 1, caixas_48: 0, caixas_outras: 0 });                                                // vence qua 25/11
    const pl = R.planejar([cheio, b], clientes, DIA, { marcacao: true, padroes: { [docN(1)]: 's10', [docN(2)]: 's10' },
                                                       regras: [{ documento: docN(2), dias_sem_receber: [3] }] });
    assert.equal(pl.s10.volume, R.ROTA.CAPACIDADE_S10);
    const f = pl.fica.find((x) => x.p.cd_pedido === b.cd_pedido);
    assert.equal(b.dt_pedido, DT); assert.equal(f.prazo, '2026-11-25');
    assert.equal(f.motivoFica, 'capacidade');
    assert.equal(f.proxima, '2026-11-26');
    assert.equal(f.estoura, true);
    // Sem regra: continua a próxima saída de todos (25/11), sem estourar.
    const pl2 = R.planejar([cheio, b], clientes, DIA, { marcacao: true, padroes: { [docN(1)]: 's10', [docN(2)]: 's10' } });
    const f2 = pl2.fica.find((x) => x.p.cd_pedido === b.cd_pedido);
    assert.deepEqual([f2.proxima, f2.estoura], ['2026-11-25', false]);
});

test('R1 volume desconhecido: segurar só se a próxima saída ELEGÍVEL do cliente ainda cumpre o prazo', () => {
    const clientes = { [docN(2)]: cli('Fecha Quarta', 0.02, 0.01) };
    const b = ped(docN(2), { caixas_24: null, caixas_48: null });
    const o = { marcacao: true, padroes: { [docN(2)]: 's10' } };
    // Fecha quarta: esperar levaria a 26/11 > prazo 25/11 -> vai HOJE (com aviso de volume).
    const pl = R.planejar([b], clientes, DIA, Object.assign({ regras: [{ documento: docN(2), dias_sem_receber: [3] }] }, o));
    assert.ok(pl.s10.pedidos.some((x) => x.p.cd_pedido === b.cd_pedido));
    assert.equal(pl.s10.desconhecidos, 1);
    // Sem regra: 25/11 ainda cumpre -> fica para a próxima, sem estourar.
    const pl2 = R.planejar([b], clientes, DIA, o);
    assert.deepEqual([pl2.fica.length, pl2.fica[0].motivoFica, pl2.fica[0].proxima, pl2.fica[0].estoura], [1, 'sem_volume', '2026-11-25', false]);
});

test('R2 proximaSaidaCliente percorre até BUSCA_SAIDA_DIAS: feriados nos dias de recebimento não cortam a busca', () => {
    const soSegunda = R.regraDe({ dias_sem_receber: [0, 2, 3, 4, 5, 6] });
    const cfg = R.cfgDe({ feriados_extras: ['2026-11-30', '2026-12-07'] });
    assert.equal(R.proximaSaidaCliente(DIA, soSegunda, cfg), '2026-12-14');
    assert.equal(R.proximaSaidaCliente(DIA, soSegunda, null), '2026-11-30');
    assert.equal(R.proximaSaidaCliente(DIA, null, cfg), R.proximaSaida(DIA, false, cfg));
    // No planejador: pedido de cliente que só recebe segunda, num dia fechado, vai para 14/12.
    const clientes = { [docN(3)]: cli('Só Segunda', 0.01, 0.02) };
    const p = ped(docN(3));
    const pl = R.planejar([p], clientes, DIA, { marcacao: true, cfg, padroes: { [docN(3)]: 's10' }, regras: [{ documento: docN(3), dias_sem_receber: [0, 2, 3, 4, 5, 6] }] });
    assert.deepEqual([pl.fica[0].motivoFica, pl.fica[0].proxima, pl.fica[0].estoura], ['dia_fechado', '2026-12-14', true]);
});

test('R3 24:00: aceito só como FIM de janela (1440); hora de saída e início continuam 00:00..23:59', () => {
    assert.equal(R.minutosDe('24:00', true), 1440);
    assert.equal(R.minutosDe('24:00:00', true), 1440);
    assert.equal(R.minutosDe(1440, true), 1440);
    assert.equal(R.minutosDe('24:01', true), null);
    assert.equal(R.minutosDe('24:00'), null);
    assert.equal(R.minutosDe(1440), null);
    const r = R.regraDe({ janela_inicio: '22:00', janela_fim: '24:00:00' });
    assert.deepEqual([r.ini, r.fim, r.janela], [1320, 1440, '22:00–24:00']);
    assert.equal(R.regraDe({ janela_fim: '24:00' }).janela, 'até 24:00');
    assert.equal(R.regraDe({ janela_inicio: '24:00' }).ini, null);
    assert.equal(R.cfgDe({ hora_saida: '24:00:00' }).horaSaida, 7 * 60);   // inválida: padrão (a 044 recusa no banco)
});
