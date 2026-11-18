// Testes do Plano da semana (046) e da S10 de segunda a sexta (o dono, 2026-11-18). Dados FICTÍCIOS.
// Rodar (da raiz do repo; o arquivo EXPLÍCITO — no Node 24 "node --test supabase/tests/" dá MODULE_NOT_FOUND):
//   node --test supabase/tests/rota-semana.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../functions/_shared/rota-core.js');
const W = require('../functions/_shared/whatsapp-core.js');

const O = R.ROTA.ORIGEM, CEASA = R.ROTA.CEASA_CENTRO;
const SEMANA = '2026-11-30';                              // segunda; sexta = 04/12; sem feriado
let seq = 70000;
function docN(i) { return String(20000000000000 + i); }
function ped(doc, o) {
    return Object.assign({ cd_pedido: ++seq, dt_pedido: '2026-11-20T10:00:00-03:00', etapa: 'aberto', cliente_tipo: doc ? 'cnpj' : 'cpf', documento: doc || null,
                           cliente_nome: null, caixas_24: 5, caixas_48: 0, caixas_outras: 0, valor_centavos: 10000 }, o || {});
}
// Cliente a 'dist' graus da sede na direção 'ang' (0 = norte, 90 = leste).
function cliAng(nome, ang, dist, o) {
    const r = ang * Math.PI / 180;
    return Object.assign({ nome, bairro: 'Bairro ' + nome, cidade: 'Rio de Janeiro', logradouro: 'Rua Ficticia', numero: '1', complemento: null,
                           pos: [O[0] + Math.cos(r) * dist, O[1] + Math.sin(r) * dist / Math.cos(O[0] * Math.PI / 180)], precisao: 'exata' }, o || {});
}
// 5 grupos bem separados (direções 10, 80, 150, 220, 290 graus), 4 clientes cada.
function cenario(o) {
    o = o || {};
    const clientes = {}, pedidos = [], padroes = {};
    [10, 80, 150, 220, 290].forEach((a, g) => {
        for (let i = 0; i < 4; i++) {
            const d = docN(g * 10 + i);
            clientes[d] = cliAng('G' + g + 'C' + i, a + i * 2, 0.04 + i * 0.01, { bairro: 'Bairro G' + g });
            pedidos.push(ped(d, o.ped ? o.ped(g, i) : {}));
            padroes[d] = 's10';
        }
    });
    return { clientes, pedidos, padroes };
}
const diaDe = (r) => { const m = {}; r.dias.forEach((d) => d.pedidos.forEach((x) => { m[x.p.cd_pedido] = d.dia; })); return m; };

// ===================== S10 de segunda a sexta =====================
test('S10 seg..sex: sábado sem saída para a S10, com saída para o caminhão; prazo e próxima saída por veículo', () => {
    assert.deepEqual(R.ROTA.DIAS_SEM_SAIDA_S10, [0, 6]);
    assert.deepEqual(R.ROTA.DIAS_SEM_SAIDA_CAMINHAO, [0]);
    assert.equal(R.temSaida('2026-11-28', null, 's10'), false);
    assert.equal(R.temSaida('2026-11-28', null, 'caminhao'), true);
    assert.equal(R.temSaida('2026-11-28'), true);                         // sem veículo = padrão (caminhão)
    assert.equal(R.proximaSaida('2026-11-27', false, null, 's10'), '2026-11-30');
    assert.equal(R.proximaSaida('2026-11-27', false, null, 'caminhao'), '2026-11-28');
    // pedido de sexta: S10 vence terça (seg + ter); caminhão vence segunda (sáb + seg)
    assert.equal(R.prazoDe('2026-11-27T10:00:00-03:00', null, 's10'), '2026-12-01');
    assert.equal(R.prazoDe('2026-11-27T10:00:00-03:00', null, 'caminhao'), '2026-11-30');
    assert.equal(R.prazoDe('2026-11-27T10:00:00-03:00'), '2026-11-30');
    // sexta: "vence na próxima saída" da S10 é a segunda
    assert.equal(R.situacaoPrazo('2026-11-30', '2026-11-27', null, 's10'), 'amanha');
    assert.equal(R.situacaoPrazo('2026-11-28', '2026-11-27', null, 's10'), 'ok');
});

test('planejar no SÁBADO: S10 vai para fica (sem_saida_s10, próxima = segunda, estoura se vencer antes); caminhão sai', () => {
    const SAB = '2026-11-28';
    const clientes = { [docN(1)]: cliAng('S10 A', 30, 0.05), [docN(2)]: cliAng('S10 Vence Sex', 60, 0.05), [docN(3)]: cliAng('Box', 0, 0, { pos: CEASA, complemento: 'CEASA' }),
                       [docN(4)]: cliAng('Fecha Seg', 90, 0.05) };
    const a = ped(docN(1), { dt_pedido: '2026-11-26T10:00:00-03:00' });     // S10: sex 27 + seg 30 -> prazo 30
    const b = ped(docN(2), { dt_pedido: '2026-11-25T10:00:00-03:00' });     // S10: qui 26 + sex 27 -> prazo 27 (já vencido)
    const c = ped(docN(3)), d = ped(docN(4), { dt_pedido: '2026-11-26T10:00:00-03:00' });
    const padroes = { [docN(1)]: 's10', [docN(2)]: 's10', [docN(3)]: 'caminhao', [docN(4)]: 's10' };
    const regras = [{ documento: docN(4), dias_sem_receber: [1] }];          // não recebe segunda
    const pl = R.planejar([a, b, c, d], clientes, SAB, { marcacao: true, padroes, regras });
    assert.equal(pl.semSaida, false); assert.equal(pl.s10.semSaida, true);
    assert.equal(pl.s10.pedidos.length, 0); assert.equal(pl.caminhao.pedidos.length, 1);
    const f = (x) => pl.fica.find((y) => y.p.cd_pedido === x.cd_pedido);
    assert.deepEqual([f(a).motivoFica, f(a).proxima, f(a).estoura], ['sem_saida_s10', '2026-11-30', false]);
    assert.deepEqual([f(b).motivoFica, f(b).estoura], ['sem_saida_s10', true]);
    assert.deepEqual([f(d).proxima, f(d).estoura], ['2026-12-01', true]);  // próxima saída da S10 em que ele recebe
    // na sexta a S10 sai normalmente
    const sex = R.planejar([a, b], clientes, '2026-11-27', { marcacao: true, padroes });
    assert.equal(sex.s10.semSaida, false); assert.equal(sex.s10.pedidos.length, 2);
    // v1 (automático) também: S10 parada no sábado
    assert.equal(R.planejar([a], clientes, SAB, { excecoes: {} }).s10.pedidos.length, 0);
});

test('WhatsApp: rota_s10 no sábado = sem saída (não manda); rota_caminhao no sábado manda', () => {
    const clientes = { [docN(1)]: cliAng('S10 A', 30, 0.05), [docN(3)]: cliAng('Box', 0, 0, { pos: CEASA, complemento: 'CEASA' }) };
    const d = { pedidos: [ped(docN(1)), ped(docN(3))], clientes, cfg: R.cfgDe(R.CFG_PADRAO), excecoes: { [docN(1)]: 's10', [docN(3)]: 'caminhao' }, porPedido: {}, regras: {}, v2: true, coletado: null };
    const sab = new Date('2026-11-28T09:00:00Z');
    const s = W.montarRota(d, 's10', sab, {});
    assert.equal(s.partes.length, 0);
    assert.equal(s.vazio, 'sem saída hoje para a S10 (sábado)');
    const k = W.montarRota(d, 'caminhao', sab, {});
    assert.equal(k.partes.length, 1); assert.match(k.partes[0].params[3], /CD CEASA/);
    assert.equal(W.montarRota(d, 's10', new Date('2026-11-27T09:00:00Z'), {}).partes.length, 1);   // sexta: manda
});

// ===================== Plano da semana =====================
test('semana: seg..sex (sem sábado), segunda da semana, próxima semana; feriado vai para semSaida', () => {
    assert.equal(R.proximaSemana('2026-11-25'), '2026-11-30');
    assert.equal(R.proximaSemana('2026-11-29'), '2026-11-30');              // domingo -> a segunda seguinte
    assert.equal(R.segundaDe('2026-12-03'), '2026-11-30');
    const { clientes, pedidos, padroes } = cenario();
    const r = R.planejarSemana(pedidos, clientes, '2026-12-02', { padroes });
    assert.deepEqual([r.inicio, r.fim], ['2026-11-30', '2026-12-04']);
    assert.deepEqual(r.dias.map((d) => d.dia), ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04']);
    assert.ok(r.dias.every((d) => R.diaSemana(d.dia) >= 1 && R.diaSemana(d.dia) <= 5));
    const f = R.planejarSemana(pedidos, clientes, '2026-11-16', { padroes });   // 20/11 (sexta) é feriado nacional
    assert.deepEqual(f.dias.map((d) => d.dia), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']);
    assert.deepEqual(f.semSaida, [{ dia: '2026-11-20', feriado: true }]);
});

test('semana: agrupamento por setor (cada grupo num dia, 5 grupos em 5 dias), determinístico e estável', () => {
    const { clientes, pedidos, padroes } = cenario();
    const r = R.planejarSemana(pedidos, clientes, SEMANA, { padroes });
    assert.equal(r.regioes.length, 5);
    const m = diaDe(r);
    for (let g = 0; g < 5; g++) {
        const dias = new Set(pedidos.filter((p) => clientes[p.documento].nome.startsWith('G' + g)).map((p) => m[p.cd_pedido]));
        assert.equal(dias.size, 1, 'grupo ' + g + ' em ' + [...dias]);
    }
    assert.equal(new Set(Object.values(m)).size, 5);
    // mesma entrada embaralhada -> mesmo plano
    const emb = pedidos.slice().reverse();
    assert.deepEqual(diaDe(R.planejarSemana(emb, clientes, SEMANA, { padroes })), m);
    // um pedido a mais num grupo não muda o dia de ninguém
    const extra = ped(docN(1));
    const m2 = diaDe(R.planejarSemana(pedidos.concat([extra]), clientes, SEMANA, { padroes }));
    pedidos.forEach((p) => assert.equal(m2[p.cd_pedido], m[p.cd_pedido]));
    assert.equal(m2[extra.cd_pedido], m[pedidos.find((p) => p.documento === docN(1)).cd_pedido]);   // mesmo cliente, mesmo dia
    // cada dia: ordem sugerida, km, horário, ocupação
    r.dias.forEach((d) => {
        assert.equal(d.paradas.length, 4); assert.ok(d.km > 0 && d.horario.fim);
        assert.equal(d.ocupacao, d.volume / R.ROTA.CAPACIDADE_S10); assert.equal(d.c24, 20); assert.equal(d.excesso, false);
        d.pedidos.forEach((x) => { assert.equal(x.origemDia, 'sugestao'); assert.equal(x.dia, d.dia); });
    });
});

test('semana: prazo — quem vence dentro da semana vai até o prazo; vencido antes da semana fica na região e estoura', () => {
    // G4 (o último dia) tem um pedido de sexta 27/11 (S10: vence terça 01/12); os demais são de 20/11 (vencidos)
    const { clientes, pedidos, padroes } = cenario({ ped: (g, i) => (g === 4 && i === 0 ? { dt_pedido: '2026-11-27T10:00:00-03:00' } : {}) });
    const r = R.planejarSemana(pedidos, clientes, SEMANA, { padroes });
    const x = r.dias.flatMap((d) => d.pedidos).find((y) => y.p.documento === docN(40));
    assert.equal(x.prazo, '2026-12-01');
    assert.ok(x.dia <= '2026-12-01', x.dia); assert.equal(x.estoura, false);
    const v = r.dias.flatMap((d) => d.pedidos).filter((y) => y.p.documento !== docN(40));
    assert.ok(v.every((y) => y.estoura === true && y.situacao === 'vencido'));
    assert.equal(r.resumo.estouram, 19);
});

test('semana: dia em que o cliente não recebe nunca é sugerido; vai para outro dia', () => {
    const { clientes, pedidos, padroes } = cenario();
    const base = diaDe(R.planejarSemana(pedidos, clientes, SEMANA, { padroes }));
    const p0 = pedidos[0], dow = R.diaSemana(base[p0.cd_pedido]);
    const r = R.planejarSemana(pedidos, clientes, SEMANA, { padroes, regras: [{ documento: p0.documento, dias_sem_receber: [dow] }] });
    const x = r.dias.flatMap((d) => d.pedidos).find((y) => y.p.cd_pedido === p0.cd_pedido);
    assert.notEqual(R.diaSemana(x.dia), dow); assert.equal(x.diaFechado, false);
    // não recebe nenhum dia da S10: sobra (motivo dia_fechado)
    const r2 = R.planejarSemana(pedidos, clientes, SEMANA, { padroes, regras: [{ documento: p0.documento, dias_sem_receber: [1, 2, 3, 4, 5] }] });
    assert.deepEqual(r2.sobra.map((y) => [y.p.cd_pedido, y.motivoSobra]), [[p0.cd_pedido, 'dia_fechado']]);
});

test('semana: capacidade 2700/dia — grupo grande se divide em dias de setores VIZINHOS; sem espaço na semana: sobra', () => {
    // G0 (10 graus) com 4 clientes de 100 cx24 (3600 > 2700): não cabe num dia; vai para mais de um dia, todos de setores
    // vizinhos (centro a menos de 90 graus) e nenhum dia passa de 2700
    const { clientes, pedidos, padroes } = cenario({ ped: (g) => (g === 0 ? { caixas_24: 100 } : {}) });
    const r = R.planejarSemana(pedidos, clientes, SEMANA, { padroes });
    assert.ok(r.dias.every((d) => d.volume <= R.ROTA.CAPACIDADE_S10));
    assert.equal(r.sobra.length, 0);
    const m = diaDe(r), g0 = new Set(pedidos.filter((p) => clientes[p.documento].nome.startsWith('G0')).map((p) => m[p.cd_pedido]));
    assert.ok(g0.size >= 2);
    const dif = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
    for (const d of g0) { const rg = r.regioes.find((x) => x.dia === d); assert.ok(rg && dif(rg.centro, 13) < 90, d + ' centro ' + (rg && rg.centro)); }
    // semana inteira cheia: 30 clientes de 300 cx24 (= 1 S10 cada) em 5 dias -> 25 sobram
    const cl = {}, ps = [], pa = {};
    for (let i = 0; i < 30; i++) { const d = docN(500 + i); cl[d] = cliAng('Grande ' + i, i * 12, 0.05); ps.push(ped(d, { caixas_24: 300 })); pa[d] = 's10'; }
    const r2 = R.planejarSemana(ps, cl, SEMANA, { padroes: pa });
    assert.equal(r2.dias.reduce((a, d) => a + d.pedidos.length, 0), 5);
    assert.equal(r2.sobra.length, 25); assert.ok(r2.sobra.every((x) => x.motivoSobra === 'capacidade' && x.diaSugerido));
});

test('semana: prioridade ("entregar primeiro") garante a vaga quando a capacidade aperta', () => {
    // 30 clientes de 300 cx24 (cada um enche uma S10) para 5 dias: 25 sobram; o prioritário nunca sobra
    const cl = {}, ps = [], pa = {};
    for (let i = 0; i < 30; i++) { const d = docN(600 + i); cl[d] = cliAng('Cheio ' + i, i * 12, 0.05); ps.push(ped(d, { caixas_24: 300 })); pa[d] = 's10'; }
    const sem = R.planejarSemana(ps, cl, SEMANA, { padroes: pa });
    const alvo = sem.sobra[sem.sobra.length - 1].p;
    const r = R.planejarSemana(ps, cl, SEMANA, { padroes: pa, regras: [{ documento: alvo.documento, prioridade: true }] });
    assert.ok(diaDe(r)[alvo.cd_pedido], 'prioritário ficou sem dia');
    assert.equal(r.sobra.length, 25);
});

test('semana: plano SALVO vence a sugestão (até acima da capacidade / em dia fechado); outra semana; sábado e passado ignorados', () => {
    const { clientes, pedidos, padroes } = cenario({ ped: (g) => (g === 0 ? { caixas_24: 100 } : {}) });
    const base = diaDe(R.planejarSemana(pedidos, clientes, SEMANA, { padroes }));
    const [a, b, c, d, e] = pedidos;
    const outroDia = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'].find((x) => x !== base[a.cd_pedido]);
    // todos os 4 de G0 (400 cx24 = 3600) salvos no mesmo dia: passa da capacidade, mas o Márcio decidiu
    const g0 = pedidos.filter((p) => clientes[p.documento].nome.startsWith('G0'));
    const plano = {}; g0.forEach((p) => { plano[p.cd_pedido] = outroDia; });
    plano[pedidos[5].cd_pedido] = '2026-12-09';                            // semana seguinte
    plano[pedidos[6].cd_pedido] = '2026-12-05';                            // sábado: S10 não sai -> sugestão
    plano[pedidos[7].cd_pedido] = '2026-11-20';                            // passado -> sugestão
    const regras = [{ documento: g0[1].documento, dias_sem_receber: [R.diaSemana(outroDia)] }];
    const r = R.planejarSemana(pedidos, clientes, SEMANA, { padroes, plano, regras });
    const dia = r.dias.find((x) => x.dia === outroDia), m = diaDe(r);
    g0.forEach((p) => assert.equal(m[p.cd_pedido], outroDia));
    assert.ok(dia.excesso && dia.volume > R.ROTA.CAPACIDADE_S10);
    const xs = dia.pedidos.filter((x) => plano[x.p.cd_pedido] === outroDia);
    assert.ok(xs.every((x) => x.origemDia === 'salvo'));
    assert.equal(xs.find((x) => x.p.documento === g0[1].documento).diaFechado, true);
    assert.deepEqual(r.foraDaSemana.map((x) => [x.p.cd_pedido, x.dia]), [[pedidos[5].cd_pedido, '2026-12-09']]);
    const x6 = r.dias.flatMap((q) => q.pedidos).find((x) => x.p.cd_pedido === pedidos[6].cd_pedido);
    assert.deepEqual([x6.origemDia, x6.salvoInvalido], ['sugestao', '2026-12-05']);
    const x7 = r.dias.flatMap((q) => q.pedidos).find((x) => x.p.cd_pedido === pedidos[7].cd_pedido);
    assert.deepEqual([x7.origemDia, x7.salvoInvalido], ['sugestao', undefined]);   // dia salvo já passado: como se não houvesse
    assert.equal(r.resumo.salvos, 4);
    void b; void c; void d; void e;
});

test('semana: base — só pendentes, sem ignorados (045); CEASA à parte (CD); sem marcação em faltaMarcar (sem capacidade)', () => {
    const { clientes, pedidos, padroes } = cenario();
    const box = docN(900), novo = docN(901), saiu = ped(docN(0), { etapa: 'saiu' });
    clientes[box] = cliAng('Box', 0, 0, { pos: CEASA, complemento: 'CEASA' }); clientes[novo] = cliAng('Novo', 45, 0.05);
    const pb = ped(box), pn = ped(novo, { caixas_24: 9999 });
    const ign = { [pedidos[0].cd_pedido]: true };
    const r = R.planejarSemana(pedidos.concat([pb, pn, saiu]), clientes, SEMANA, { padroes: Object.assign({ [box]: 'caminhao' }, padroes), ignorados: ign });
    const m = diaDe(r);
    assert.equal(m[pedidos[0].cd_pedido], undefined);
    assert.equal(m[saiu.cd_pedido], undefined);
    assert.deepEqual(r.cdPedidos.map((x) => x.p.cd_pedido), [pb.cd_pedido]);
    assert.ok(r.cd && r.cd.cd && r.cd.total.clientes === 1);
    assert.deepEqual(r.faltaMarcar.map((x) => [x.p.cd_pedido, x.sugestao.veiculo]), [[pn.cd_pedido, 's10']]);
    assert.ok(r.dias.every((d) => d.volume <= R.ROTA.CAPACIDADE_S10));
    assert.equal(r.resumo.pedidos, 19);
});

test('semana: sem posição — vai pelo setor do bairro; sem bairro conhecido: semPosicao', () => {
    const { clientes, pedidos, padroes } = cenario();
    const m0 = diaDe(R.planejarSemana(pedidos, clientes, SEMANA, { padroes }));
    const a = docN(800), b = docN(801);
    clientes[a] = { nome: 'Sem Pino G2', bairro: 'bairro g2', cidade: 'Rio', pos: null };   // mesmo bairro (sem acento/caixa) do G2
    clientes[b] = { nome: 'Sem Pino Longe', bairro: 'Bairro Desconhecido', cidade: 'Rio', pos: null };
    const pa = ped(a), pb = ped(b);
    const r = R.planejarSemana(pedidos.concat([pa, pb]), clientes, SEMANA, { padroes: Object.assign({ [a]: 's10', [b]: 's10' }, padroes) });
    const m = diaDe(r), diaG2 = m0[pedidos.find((p) => clientes[p.documento].nome.startsWith('G2')).cd_pedido];
    assert.equal(m[pa.cd_pedido], diaG2);
    assert.deepEqual(r.semPosicao.map((x) => x.p.cd_pedido), [pb.cd_pedido]);
    const dia = r.dias.find((d) => d.dia === diaG2);
    assert.equal(dia.semPosicao.length, 1);                                // na ordem do dia: no fim, por bairro
});

test('rota do DIA não obedece ao plano salvo: só informação x.planoDia (o dono: plano é base de referência)', () => {
    const { clientes, pedidos, padroes } = cenario();
    const DIA = '2026-11-30';
    const plano = { [pedidos[0].cd_pedido]: '2026-12-02', [pedidos[1].cd_pedido]: DIA, [pedidos[2].cd_pedido]: '2026-11-20' };
    const sem = R.planejar(pedidos, clientes, DIA, { marcacao: true, padroes });
    const com = R.planejar(pedidos, clientes, DIA, { marcacao: true, padroes, plano });
    const chaves = (pl) => JSON.stringify([pl.s10.paradas.map((s) => s.chave), pl.fica.map((x) => [x.p.cd_pedido, x.motivoFica]), pl.s10.volume]);
    assert.equal(chaves(com), chaves(sem));
    const x = (cd) => com.s10.pedidos.concat(com.fica).find((y) => y.p.cd_pedido === cd);
    assert.equal(x(pedidos[0].cd_pedido).planoDia, '2026-12-02');
    assert.equal(x(pedidos[1].cd_pedido).planoDia, DIA);
    assert.equal(x(pedidos[2].cd_pedido).planoDia, undefined);             // dia salvo já passado: nem informa
    assert.ok(!com.fica.some((y) => y.motivoFica === 'planejado'));
});

test('semana: rápido (< 100 ms para ~150 pedidos) e determinístico', () => {
    let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const cl = {}, ps = [], pa = {};
    for (let i = 0; i < 150; i++) {
        const d = docN(1000 + i);
        cl[d] = cliAng('R' + i, rnd() * 360, 0.02 + rnd() * 0.25, { bairro: 'B' + (i % 12), pos: i % 17 === 0 ? null : undefined });
        if (i % 17 !== 0) cl[d] = cliAng('R' + i, rnd() * 360, 0.02 + rnd() * 0.25, { bairro: 'B' + (i % 12) }); else cl[d].pos = null;
        ps.push(ped(d, { caixas_24: Math.floor(rnd() * 40), caixas_48: Math.floor(rnd() * 4), dt_pedido: '2026-11-2' + (rnd() < 0.5 ? '5' : '7') + 'T10:00:00-03:00' }));
        pa[d] = 's10';
    }
    const regras = Object.keys(cl).filter((_, i) => i % 9 === 0).map((d, k) => ({ documento: d, janela_inicio: '08:00', janela_fim: '12:00', dias_sem_receber: [1 + (k % 5)], prioridade: k % 4 === 0 }));
    const o = { padroes: pa, regras };
    R.planejarSemana(ps, cl, SEMANA, o);
    const t = [];
    for (let k = 0; k < 7; k++) { const a = process.hrtime.bigint(); R.planejarSemana(ps, cl, SEMANA, o); t.push(Number(process.hrtime.bigint() - a) / 1e6); }
    t.sort((a, b) => a - b);
    assert.ok(t[3] < 100, 'mediana ' + t[3].toFixed(1) + ' ms');
    const r1 = R.planejarSemana(ps, cl, SEMANA, o), r2 = R.planejarSemana(ps.slice().reverse(), cl, SEMANA, o);
    assert.deepEqual(diaDe(r1), diaDe(r2));
    // ninguém em dia que não recebe (fora os salvos, que aqui não há), nenhum dia acima da capacidade
    assert.ok(r1.dias.every((d) => d.volume <= R.ROTA.CAPACIDADE_S10 && d.pedidos.every((x) => !x.diaFechado)));
    const total = r1.dias.reduce((a, d) => a + d.pedidos.length, 0) + r1.sobra.length + r1.semPosicao.length;
    assert.equal(total, 150);
});
