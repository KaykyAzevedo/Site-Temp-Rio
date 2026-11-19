// Testes da sugestão "juntar pedido a uma rota S10 prevista" (sugestoesJuntar). Dados FICTÍCIOS.
// Rodar (da raiz do repo; o arquivo EXPLÍCITO):
//   node --test supabase/tests/rota-juntar.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../functions/_shared/rota-core.js');

const O = R.ROTA.ORIGEM;
const HOJE = '2026-12-01';                 // terça
const QUA = '2026-12-02', QUI = '2026-12-03', SAB = '2026-12-05';
let seq = 90000;
function docN(i) { return String(30000000000000 + i); }
function ped(doc, o) {
    return Object.assign({ cd_pedido: ++seq, dt_pedido: '2026-11-30T09:00:00-03:00', etapa: 'aberto', cliente_tipo: doc ? 'cnpj' : 'cpf', documento: doc || null,
                           cliente_nome: null, caixas_24: 5, caixas_48: 0, caixas_outras: 0, valor_centavos: 10000 }, o || {});
}
// Cliente a 'dist' graus da sede na direção 'ang' (0 = norte, 90 = leste).
function cliAng(nome, ang, dist, o) {
    const r = ang * Math.PI / 180;
    return Object.assign({ nome, bairro: 'Bairro ' + nome, cidade: 'Rio de Janeiro', logradouro: 'Rua Ficticia', numero: '1', complemento: null,
                           pos: [O[0] + Math.cos(r) * dist, O[1] + Math.sin(r) * dist / Math.cos(O[0] * Math.PI / 180)], precisao: 'exata' }, o || {});
}
// Rota da S10 de quarta: 3 clientes para o LESTE (a ~2, 4 e 6 km da sede).
function base() {
    const clientes = {}, padroes = {}, rotaPeds = [];
    [0.02, 0.04, 0.06].forEach((d, i) => { const doc = docN(i); clientes[doc] = cliAng('Leste' + i, 90, d, { bairro: 'Bairro Leste' }); padroes[doc] = 's10'; rotaPeds.push(ped(doc)); });
    return { clientes, padroes, rotaPeds };
}
function rotaDe(b, dia, extra) { return R.planejar(b.rotaPeds.concat(extra || []), b.clientes, dia || QUA, { marcacao: true, padroes: b.padroes }); }
function add(b, nome, ang, dist, o) { const doc = docN(100 + Object.keys(b.clientes).length); b.clientes[doc] = cliAng(nome, ang, dist, o && o.cli); if (!(o && o.semMarca)) b.padroes[doc] = (o && o.veiculo) || 's10'; return doc; }
const opts = (b, o) => Object.assign({ hoje: HOJE, padroes: b.padroes }, o || {});

test('cliente perto do trajeto: sugere juntar na quarta, com desvio pequeno, entre quais paradas e a folga', () => {
    const b = base(), rota = rotaDe(b);
    assert.equal(rota.s10.paradas.length, 3);
    const doc = add(b, 'Perto', 88, 0.03), novo = ped(doc);
    const r = R.sugestoesJuntar(b.rotaPeds.concat([novo]), b.clientes, rota, opts(b));
    assert.equal(r.sugestoes.length, 1);
    const s = r.sugestoes[0];
    assert.equal(s.dia, QUA); assert.equal(s.fonte, 'dia'); assert.equal(s.criterio, 'desvio');
    assert.deepEqual(s.cds, [novo.cd_pedido]);
    assert.ok(s.desvioKm >= 0 && s.desvioKm <= 1, 'desvio ' + s.desvioKm);
    assert.deepEqual(s.entre, { antes: 'Leste0', depois: 'Leste1' });
    assert.equal(s.acao, 'produzir'); assert.equal(s.precisaMarcar, false); assert.equal(s.estoura, false); assert.equal(s.situacao, 'hoje');
    assert.equal(s.folgaAntes, R.ROTA.CAPACIDADE_S10 - 135); assert.equal(s.folgaDepois, R.ROTA.CAPACIDADE_S10 - 180);
    assert.ok(s.minutosExtra >= R.cfgOk(null).minutosParada);
    assert.equal(r.rotas.length, 1); assert.equal(r.rotas[0].paradas, 3);
});

test('longe do trajeto (> 3 km de desvio): não sugere (descartados.longe); limite configurável', () => {
    const b = base(), rota = rotaDe(b);
    const doc = add(b, 'Norte', 0, 0.08);
    const ps = b.rotaPeds.concat([ped(doc)]);
    let r = R.sugestoesJuntar(ps, b.clientes, rota, opts(b));
    assert.equal(r.sugestoes.length, 0); assert.equal(r.descartados.longe, 1);
    r = R.sugestoesJuntar(ps, b.clientes, rota, opts(b, { desvioMaxKm: 50 }));
    assert.equal(r.sugestoes.length, 1);
});

test('mesmo cliente já é parada da rota: pedido novo dele sugerido com desvio 0 e sem minuto extra', () => {
    const b = base(), rota = rotaDe(b), doc = docN(1), novo = ped(doc);
    const r = R.sugestoesJuntar(b.rotaPeds.concat([novo]), b.clientes, rota, opts(b));
    assert.equal(r.sugestoes.length, 1);
    assert.equal(r.sugestoes[0].criterio, 'mesmo_cliente'); assert.equal(r.sugestoes[0].desvioKm, 0); assert.equal(r.sugestoes[0].minutosExtra, 0);
});

test('capacidade: não cabe na rota (2700) -> descartados.capacidade; volume desconhecido entra com aviso', () => {
    const b = base();
    b.rotaPeds[0].caixas_24 = 290;                                  // rota com 290+5+5 cx24 = 2700
    const rota = rotaDe(b);
    assert.equal(rota.s10.volume, 2700);
    const d1 = add(b, 'Perto', 88, 0.03), d2 = add(b, 'SemCaixa', 92, 0.05);
    const r = R.sugestoesJuntar(b.rotaPeds.concat([ped(d1), ped(d2, { caixas_24: null, caixas_48: null })]), b.clientes, rota, opts(b));
    assert.equal(r.descartados.capacidade, 1);
    assert.equal(r.sugestoes.length, 1); assert.equal(r.sugestoes[0].semVolume, 1); assert.equal(r.sugestoes[0].volume, 0);
});

test('veículo: marcado CEASA fica fora; sem marcação com sugestão S10 = precisaMarcar; endereço do CEASA fica fora', () => {
    const b = base(), rota = rotaDe(b);
    const dCeasa = add(b, 'MarcadoCeasa', 88, 0.03, { veiculo: 'caminhao' });
    const dSem = add(b, 'SemMarca', 89, 0.05, { semMarca: true });
    const dEnd = add(b, 'EndCeasa', 91, 0.045, { semMarca: true, cli: { logradouro: 'Mercado CEASA' } });
    const r = R.sugestoesJuntar(b.rotaPeds.concat([ped(dCeasa), ped(dSem), ped(dEnd)]), b.clientes, rota, opts(b));
    assert.equal(r.descartados.ceasa, 2);
    assert.equal(r.sugestoes.length, 1); assert.equal(r.sugestoes[0].documento, dSem); assert.equal(r.sugestoes[0].precisaMarcar, true);
});

test('semana: escolhe o dia de trajeto mais perto, lista a alternativa; dia em que o cliente não recebe fica de fora', () => {
    const b = base();
    const rQua = rotaDe(b, QUA);
    // quinta: rota para o NORTE
    const bn = { clientes: {}, padroes: {}, rotaPeds: [] };
    [0.02, 0.04].forEach((d, i) => { const doc = docN(50 + i); bn.clientes[doc] = cliAng('Norte' + i, 0, d); bn.padroes[doc] = 's10'; bn.rotaPeds.push(ped(doc)); });
    const rQui = rotaDe(bn, QUI);
    Object.assign(b.clientes, bn.clientes); Object.assign(b.padroes, bn.padroes);
    const doc = add(b, 'Nordeste', 45, 0.02);                       // perto das duas (a ~2 km da sede)
    const ps = b.rotaPeds.concat(bn.rotaPeds, [ped(doc, { dt_pedido: '2026-12-01T09:00:00-03:00' })]);   // prazo quinta
    let r = R.sugestoesJuntar(ps, b.clientes, [rQua, rQui], opts(b, { desvioMaxKm: 10 }));
    assert.equal(r.sugestoes.length, 1);
    const s = r.sugestoes[0];
    assert.equal(s.alternativas.length, 1);
    assert.ok(s.desvioKm <= s.alternativas[0].desvioKm);
    // não recebe no dia escolhido: vai para o outro
    const regras = [{ documento: doc, dias_sem_receber: [R.diaSemana(s.dia)] }];
    r = R.sugestoesJuntar(ps, b.clientes, [rQua, rQui], opts(b, { desvioMaxKm: 10, regras }));
    assert.equal(r.sugestoes.length, 1); assert.notEqual(r.sugestoes[0].dia, s.dia); assert.equal(r.sugestoes[0].alternativas.length, 0);
    // não recebe em nenhum dos dois
    r = R.sugestoesJuntar(ps, b.clientes, [rQua, rQui], opts(b, { desvioMaxKm: 10, regras: [{ documento: doc, dias_sem_receber: [3, 4] }] }));
    assert.equal(r.sugestoes.length, 0); assert.equal(r.descartados.dia_fechado, 1);
});

test('prazo: prefere a rota até o prazo mesmo com desvio maior; sem nenhuma no prazo, a melhor marcada estoura', () => {
    const b = base(), rQua = rotaDe(b, QUA);
    const doc = add(b, 'Perto', 88, 0.03);
    // quinta: mesma rota (desvio igual) — empate vai para o dia mais cedo
    const rQui = rotaDe(b, QUI);
    let r = R.sugestoesJuntar(b.rotaPeds.concat([ped(doc)]), b.clientes, [rQui, rQua], opts(b));
    assert.equal(r.sugestoes[0].dia, QUA);
    // pedido antigo (prazo 24/11): as duas estouram; continua sugerindo (a mais cedo), marcada
    r = R.sugestoesJuntar(b.rotaPeds.concat([ped(doc, { dt_pedido: '2026-11-20T09:00:00-03:00' })]), b.clientes, [rQui, rQua], opts(b));
    assert.equal(r.sugestoes[0].estoura, true); assert.equal(r.sugestoes[0].situacao, 'vencido'); assert.equal(r.sugestoes[0].dia, QUA);
    // quarta só com desvio grande, quinta perto; prazo quarta: fica a quarta (no prazo)
    const b2 = base(), rQua2 = rotaDe(b2, QUA);
    const bn = { clientes: {}, padroes: {}, rotaPeds: [] };
    const dn = docN(60); bn.clientes[dn] = cliAng('Sul', 180, 0.03); bn.padroes[dn] = 's10'; bn.rotaPeds.push(ped(dn));
    const rQui2 = rotaDe(bn, QUI);
    Object.assign(b2.clientes, bn.clientes); Object.assign(b2.padroes, bn.padroes);
    const dc = add(b2, 'SulPerto', 178, 0.031);
    const ps = b2.rotaPeds.concat(bn.rotaPeds, [ped(dc)]);           // prazo quarta 02/12
    r = R.sugestoesJuntar(ps, b2.clientes, [rQua2, rQui2], opts(b2, { desvioMaxKm: 20 }));
    assert.equal(r.sugestoes[0].dia, QUA); assert.equal(r.sugestoes[0].estoura, false);
    assert.equal(r.sugestoes[0].alternativas[0].dia, QUI); assert.equal(r.sugestoes[0].alternativas[0].estoura, true);
    assert.ok(r.sugestoes[0].desvioKm > r.sugestoes[0].alternativas[0].desvioKm);
});

test('fora: rota de dia passado e de sábado; pedido já na rota, ignorado (045), excluído ou já saiu; rota vazia', () => {
    const b = base(), rota = rotaDe(b);
    const doc = add(b, 'Perto', 88, 0.03);
    const ps = b.rotaPeds.concat([ped(doc)]);
    assert.equal(R.sugestoesJuntar(ps, b.clientes, rota, opts(b, { hoje: '2026-12-03' })).sugestoes.length, 0);
    const sab = { dia: SAB, paradas: rota.s10.paradas, volume: rota.s10.volume };
    let r = R.sugestoesJuntar(ps, b.clientes, sab, opts(b));
    assert.equal(r.rotas.length, 0); assert.equal(r.descartados.sem_rota, 1);
    // já na rota: nenhum dos 3 da rota vira sugestão
    r = R.sugestoesJuntar(ps, b.clientes, rota, opts(b));
    assert.deepEqual(r.sugestoes.map((s) => s.documento), [doc]);
    const novo = ps[3];
    for (const o of [{ ignorados: { [novo.cd_pedido]: true } }, { excluir: { [novo.cd_pedido]: true } }]) assert.equal(R.sugestoesJuntar(ps, b.clientes, rota, opts(b, o)).sugestoes.length, 0);
    novo.etapa = 'saiu';
    assert.equal(R.sugestoesJuntar(ps, b.clientes, rota, opts(b)).sugestoes.length, 0);
    novo.etapa = 'separado';
    assert.equal(R.sugestoesJuntar(ps, b.clientes, rota, opts(b)).sugestoes[0].acao, 'juntar');
    // rota sem nenhuma parada: nada a juntar
    r = R.sugestoesJuntar(ps, b.clientes, { dia: QUA, paradas: [], volume: 0 }, opts(b));
    assert.equal(r.rotas.length, 0);
});

test('sem posição: mesmo bairro de uma parada = sugestão "bairro" (desvio desconhecido); outro bairro = sem_posicao', () => {
    const b = base(), rota = rotaDe(b);
    const d1 = add(b, 'X', 0, 0, { cli: { pos: null, bairro: 'bairro leste' } });
    const d2 = add(b, 'Y', 0, 0, { cli: { pos: null, bairro: 'Outro Bairro' } });
    const d3 = add(b, 'Z', 88, 0.03);
    const r = R.sugestoesJuntar(b.rotaPeds.concat([ped(d1), ped(d2), ped(d3)]), b.clientes, rota, opts(b));
    assert.deepEqual(r.sugestoes.map((s) => [s.documento, s.criterio]), [[d3, 'desvio'], [d1, 'bairro']]);
    assert.equal(r.sugestoes[1].desvioKm, null);
    assert.equal(r.descartados.sem_posicao, 1);
});

test('aceita o resultado do planejarSemana; vários pedidos do cliente = 1 sugestão; puro e determinístico; rápido', () => {
    const b = base();
    const semana = R.planejarSemana(b.rotaPeds, b.clientes, '2026-11-30', { padroes: b.padroes });
    const comRota = semana.dias.filter((d) => d.paradas.length);
    assert.ok(comRota.length >= 1);
    const doc = add(b, 'Perto', 88, 0.03);
    const ps = b.rotaPeds.concat([ped(doc), ped(doc, { caixas_24: 2 })]);
    const antes = JSON.stringify(ps);
    const r1 = R.sugestoesJuntar(ps, b.clientes, semana, opts(b, { hoje: '2026-11-30' }));
    assert.equal(JSON.stringify(ps), antes);
    assert.equal(r1.sugestoes.length, 1);
    assert.equal(r1.sugestoes[0].fonte, 'semana'); assert.equal(r1.sugestoes[0].cds.length, 2); assert.equal(r1.sugestoes[0].volume, 63);
    assert.ok(comRota.some((d) => d.dia === r1.sugestoes[0].dia));
    const r2 = R.sugestoesJuntar(ps, b.clientes, semana, opts(b, { hoje: '2026-11-30' }));
    assert.deepEqual(r2, r1);
    // 300 candidatos x 5 dias de 40 paradas
    const bg = { clientes: {}, padroes: {}, rotaPeds: [] }, rotas = [];
    for (let d = 0; d < 5; d++) {
        const rp = [];
        for (let i = 0; i < 40; i++) { const k = docN(1000 + d * 100 + i); bg.clientes[k] = cliAng('R' + d + 'C' + i, d * 72 + (i % 10) * 3, 0.01 + i * 0.002); bg.padroes[k] = 's10'; rp.push(ped(k, { caixas_24: 1 })); }
        bg.rotaPeds.push(...rp);
        rotas.push(R.planejar(rp, bg.clientes, R.somaDias('2026-11-30', d), { marcacao: true, padroes: bg.padroes }));
    }
    const cand = [];
    for (let i = 0; i < 300; i++) { const k = docN(5000 + i); bg.clientes[k] = cliAng('K' + i, (i * 37) % 360, 0.01 + (i % 30) * 0.003); bg.padroes[k] = 's10'; cand.push(ped(k)); }
    const t0 = Date.now();
    const rg = R.sugestoesJuntar(bg.rotaPeds.concat(cand), bg.clientes, rotas, { hoje: '2026-11-30', padroes: bg.padroes });
    const ms = Date.now() - t0;
    assert.ok(ms < 100, ms + ' ms');
    assert.equal(rg.sugestoes.length + rg.descartados.longe + rg.descartados.capacidade, 300);
});

test('2-B Sentinela: rota recebida SEM volume não vira carga zero (deriva dos pedidos, sem contar duas vezes)', () => {
    // rota cheia (300 cx24 = 2700) passada só com paradas, sem 'volume': os 5 candidatos não cabem
    const b = base();
    b.rotaPeds[0].caixas_24 = 290;
    const rota = rotaDe(b);
    const semVol = { dia: QUA, paradas: rota.s10.paradas };
    const novos = [];
    for (let i = 0; i < 5; i++) novos.push(ped(add(b, 'Perto' + i, 86 + i, 0.03 + i * 0.005)));
    let r = R.sugestoesJuntar(b.rotaPeds.concat(novos), b.clientes, semVol, opts(b));
    assert.equal(r.rotas[0].volume, 2700); assert.equal(r.rotas[0].folga, 0); assert.equal(r.rotas[0].capacidadeDesconhecida, false);
    assert.equal(r.sugestoes.length, 0); assert.equal(r.descartados.capacidade, 5);
    // volume informado MENOR que o dos pedidos: vale o dos pedidos
    r = R.sugestoesJuntar(b.rotaPeds.concat(novos), b.clientes, { dia: QUA, paradas: rota.s10.paradas, volume: 10 }, opts(b));
    assert.equal(r.rotas[0].volume, 2700); assert.equal(r.sugestoes.length, 0);
    // mesmos pedidos em 'pedidos' E nas paradas: conta UMA vez (1350 + 900 cabe; contado 2x não caberia)
    const b2 = base(); b2.rotaPeds[0].caixas_24 = 140;            // 140+5+5 = 150 cx24 = 1350
    const r2 = rotaDe(b2), d = add(b2, 'Grande', 88, 0.03);
    r = R.sugestoesJuntar(b2.rotaPeds.concat([ped(d, { caixas_24: 100 })]), b2.clientes, { dia: QUA, paradas: r2.s10.paradas, pedidos: r2.s10.pedidos }, opts(b2));
    assert.equal(r.rotas[0].volume, 1350); assert.equal(r.sugestoes.length, 1); assert.equal(r.sugestoes[0].folgaDepois, 2700 - 1350 - 900);
    // pedido da rota sem caixas: conta 0 e aparece em desconhecidos
    b2.rotaPeds[1].caixas_24 = null; b2.rotaPeds[1].caixas_48 = null;
    r = R.sugestoesJuntar(b2.rotaPeds, b2.clientes, { dia: QUA, paradas: rotaDe(b2).s10.paradas }, opts(b2));
    assert.equal(r.rotas[0].desconhecidos, 1); assert.equal(r.rotas[0].volume, 1305);
});

test('2-B Sentinela: rota sem volume e sem pedidos = capacidade desconhecida (sugere marcado, folga null)', () => {
    const b = base(), rota = rotaDe(b);
    const sóParadas = { dia: QUA, paradas: rota.s10.paradas.map((sp) => ({ chave: sp.chave, documento: sp.documento, nome: sp.nome, bairro: sp.bairro, pos: sp.pos })) };
    const doc = add(b, 'Perto', 88, 0.03);
    // só o pedido novo (as paradas não trazem os pedidos da rota, então eles nem são conhecidos)
    const r = R.sugestoesJuntar([ped(doc, { caixas_24: 50 })], b.clientes, sóParadas, opts(b));
    assert.equal(r.rotas[0].capacidadeDesconhecida, true); assert.equal(r.rotas[0].volume, null); assert.equal(r.rotas[0].folga, null);
    assert.equal(r.sugestoes.length, 1);
    assert.equal(r.sugestoes[0].capacidadeDesconhecida, true); assert.equal(r.sugestoes[0].folgaAntes, null); assert.equal(r.sugestoes[0].folgaDepois, null);
    // rotas do planejar/planejarSemana nunca ficam desconhecidas
    assert.equal(R.sugestoesJuntar(b.rotaPeds.concat([ped(doc)]), b.clientes, rota, opts(b)).rotas[0].capacidadeDesconhecida, false);
});

// ===================== Sentinela 2-B core (3 MÉDIOS) =====================
test('Sentinela #1: cliente que SOZINHO passa da capacidade do veículo nunca é sugerido, mesmo com carga da rota desconhecida', () => {
    const b = base(), rota = rotaDe(b);
    const sóParadas = { dia: QUA, paradas: rota.s10.paradas.map((sp) => ({ chave: sp.chave, documento: sp.documento, nome: sp.nome, bairro: sp.bairro, pos: sp.pos })) };
    const doc = add(b, 'Perto', 88, 0.03);
    let r = R.sugestoesJuntar([ped(doc, { caixas_24: 400 })], b.clientes, sóParadas, opts(b));   // 3600 > 2700
    assert.equal(r.rotas[0].capacidadeDesconhecida, true);
    assert.equal(r.sugestoes.length, 0); assert.equal(r.descartados.capacidade, 1);
    // exatamente 2700 sozinho ainda cabe (carga da rota desconhecida: sugere marcado)
    r = R.sugestoesJuntar([ped(doc, { caixas_24: 300 })], b.clientes, sóParadas, opts(b));
    assert.equal(r.sugestoes.length, 1); assert.equal(r.sugestoes[0].capacidadeDesconhecida, true);
});

test('Sentinela #2: todas as rotas estouram o prazo -> a DATA mais cedo vence; desvio só desempata no mesmo dia', () => {
    // quarta: rota para o leste com o cliente a ~5,7 km de desvio; quinta: mesmo cliente com 0 km (já é parada? não: perto)
    const b = base(), rQua = rotaDe(b, QUA);
    const bn = { clientes: {}, padroes: {}, rotaPeds: [] };
    const dn = docN(70); bn.clientes[dn] = cliAng('NorteFora', 0, 0.05); bn.padroes[dn] = 's10'; bn.rotaPeds.push(ped(dn));
    const rQui = rotaDe(bn, QUI);
    Object.assign(b.clientes, bn.clientes); Object.assign(b.padroes, bn.padroes);
    const dc = add(b, 'NoCaminhoDoNorte', 0, 0.03);                 // em cima do trajeto de quinta, longe do de quarta
    const velho = ped(dc, { dt_pedido: '2026-11-20T09:00:00-03:00' });  // prazo 24/11: tudo estoura
    const ps = b.rotaPeds.concat(bn.rotaPeds, [velho]);
    const r = R.sugestoesJuntar(ps, b.clientes, [rQua, rQui], opts(b, { desvioMaxKm: 20 }));
    const s = r.sugestoes[0];
    assert.equal(s.estoura, true);
    assert.equal(s.dia, QUA, 'vencido: a data mais cedo, mesmo com desvio maior');
    assert.equal(s.alternativas[0].dia, QUI);
    assert.ok(s.desvioKm > s.alternativas[0].desvioKm);
    // no prazo continua: menor desvio vence entre as no prazo (pedido novo, prazo depois de quinta)
    const novo = ped(dc, { dt_pedido: '2026-12-01T09:00:00-03:00' });
    const r2 = R.sugestoesJuntar(b.rotaPeds.concat(bn.rotaPeds, [novo]), b.clientes, [rQua, rQui], opts(b, { desvioMaxKm: 20 }));
    assert.equal(r2.sugestoes[0].estoura, false); assert.equal(r2.sugestoes[0].dia, QUI);
});

test('Sentinela #3: sem posição, bairro homônimo de OUTRA cidade não conta; mesma cidade (caixa/acento diferentes) conta; sem cidade não compara', () => {
    const b = base();
    Object.keys(b.clientes).forEach((d) => { b.clientes[d].bairro = 'Centro'; b.clientes[d].cidade = 'Rio de Janeiro'; });
    const rota = rotaDe(b);
    const outra = add(b, 'Campos', 0, 0, { cli: { pos: null, bairro: 'CENTRO', cidade: 'Campos dos Goytacazes' } });
    const mesma = add(b, 'Rio', 0, 0, { cli: { pos: null, bairro: 'centro', cidade: 'RIO DE JANEIRO' } });
    const semCid = add(b, 'SemCidade', 0, 0, { cli: { pos: null, bairro: 'Centro', cidade: null } });
    const outroUf = add(b, 'OutroUF', 0, 0, { cli: { pos: null, bairro: 'Centro', cidade: 'Rio de Janeiro', uf: 'SP' } });
    const r = R.sugestoesJuntar(b.rotaPeds.concat([ped(outra), ped(mesma), ped(semCid), ped(outroUf)]), b.clientes, rota, opts(b, { desvioMaxKm: 0 }));
    // paradas da rota não têm UF: UF do cliente sozinho não basta para recusar
    assert.deepEqual(r.sugestoes.map((s) => s.documento).sort(), [mesma, outroUf].sort());
    assert.ok(r.sugestoes.every((s) => s.criterio === 'bairro'));
    assert.equal(r.descartados.sem_posicao, 2);
    // UF conhecida dos dois lados e diferente: não conta
    const comUf = { dia: QUA, paradas: rota.s10.paradas.map((sp) => Object.assign({}, sp, { uf: 'RJ' })) };
    const r2 = R.sugestoesJuntar([ped(outroUf), ped(mesma)], b.clientes, comUf, opts(b, { desvioMaxKm: 0 }));
    assert.deepEqual(r2.sugestoes.map((s) => s.documento), [mesma]);
});
