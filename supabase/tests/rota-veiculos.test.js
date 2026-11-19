// Testes da FROTA configurável (047): N veículos, Strada sem carga definida, veículo inativo, fallback sem a 047,
// plano da semana e sugestão de juntar por veículo, rota_<veículo> do WhatsApp. Dados FICTÍCIOS.
// Rodar (da raiz do repo; o arquivo EXPLÍCITO):
//   node --test supabase/tests/rota-veiculos.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../functions/_shared/rota-core.js');
const W = require('../functions/_shared/whatsapp-core.js');

const O = R.ROTA.ORIGEM, CEASA = R.ROTA.CEASA_CENTRO;
const TER = '2026-12-01', SAB = '2026-12-05', SEMANA = '2026-11-30';
let seq = 80000;
function docN(i) { return String(40000000000000 + i); }
function ped(doc, o) {
    return Object.assign({ cd_pedido: ++seq, dt_pedido: '2026-11-30T09:00:00-03:00', etapa: 'aberto', cliente_tipo: doc ? 'cnpj' : 'cpf', documento: doc || null,
                           cliente_nome: null, caixas_24: 5, caixas_48: 0, caixas_outras: 0, valor_centavos: 10000 }, o || {});
}
function cliAng(nome, ang, dist, o) {
    const r = ang * Math.PI / 180;
    return Object.assign({ nome, bairro: 'Bairro ' + nome, cidade: 'Rio de Janeiro', logradouro: 'Rua Ficticia', numero: '1', complemento: null,
                           pos: [O[0] + Math.cos(r) * dist, O[1] + Math.sin(r) * dist / Math.cos(O[0] * Math.PI / 180)], precisao: 'exata' }, o || {});
}
// Linhas como vêm da rota_veiculos (047).
const LINHAS = () => [
    { id: 'caminhao', nome: 'Caminhão (CEASA)', modo: 'cd_ceasa', capacidade_volume: null, dias_sem_saida: [0], volta_sede: false, cor: '#b45309', ordem: 10, ativo: true },
    { id: 's10', nome: 'S10', modo: 'porta', capacidade_volume: '2700.00', dias_sem_saida: [0, 6], volta_sede: false, cor: '#2563eb', ordem: 20, ativo: true },
    { id: 'strada', nome: 'Strada', modo: 'porta', capacidade_volume: null, dias_sem_saida: [0, 6], volta_sede: false, cor: '#059669', ordem: 30, ativo: true }
];
// 3 grupos: S10 no leste, Strada no norte, CEASA.
function cenario() {
    const clientes = {}, padroes = {}, pedidos = [];
    for (let i = 0; i < 4; i++) { const d = docN(i); clientes[d] = cliAng('Leste' + i, 90, 0.02 + i * 0.01); padroes[d] = 's10'; pedidos.push(ped(d)); }
    for (let i = 0; i < 3; i++) { const d = docN(10 + i); clientes[d] = cliAng('Norte' + i, 0, 0.02 + i * 0.01); padroes[d] = 'strada'; pedidos.push(ped(d)); }
    const dc = docN(20); clientes[dc] = cliAng('Box', 0, 0, { pos: CEASA, logradouro: 'Av Brasil', numero: '19001' }); padroes[dc] = 'caminhao'; pedidos.push(ped(dc));
    return { clientes, padroes, pedidos };
}
const cds = (b) => b.pedidos.map((x) => x.p.cd_pedido).sort();

test('fallback sem a 047: 3 veículos padrão; s10/caminhao continuam como antes; strada existe', () => {
    const f = R.frotaDe(null);
    assert.deepEqual(f.lista.map((v) => [v.id, v.modo, v.capacidade]), [['caminhao', 'cd_ceasa', null], ['s10', 'porta', 2700], ['strada', 'porta', null]]);
    assert.equal(f.padrao, true);
    const c = cenario();
    const pl = R.planejar(c.pedidos, c.clientes, TER, { marcacao: true, padroes: c.padroes });
    assert.deepEqual(pl.ordem, ['caminhao', 's10', 'strada']);
    assert.equal(pl.s10, pl.veiculos.s10); assert.equal(pl.caminhao, pl.veiculos.caminhao); assert.equal(pl.ceasa, pl.caminhao.pedidos);
    assert.equal(pl.s10.pedidos.length, 4); assert.equal(pl.veiculos.strada.pedidos.length, 3); assert.equal(pl.caminhao.pedidos.length, 1);
    assert.equal(pl.caminhao.paradas.length, 1); assert.equal(pl.caminhao.cd.veiculo, 'caminhao');
    // mesma frota vinda da tabela = mesmo resultado
    const pl2 = R.planejar(c.pedidos, c.clientes, TER, { marcacao: true, padroes: c.padroes, veiculos: LINHAS() });
    assert.deepEqual(pl2.ordem, pl.ordem);
    ['caminhao', 's10', 'strada'].forEach((v) => assert.deepEqual(cds(pl2.veiculos[v]), cds(pl.veiculos[v])));
    assert.equal(R.temSaida(SAB, null, 'strada'), false); assert.equal(R.temSaida(SAB, null, 'caminhao'), true);
});

test('Strada sem carga definida: sem limite (semLimite, ocupação null), nada fica por capacidade; S10 respeita 2700', () => {
    const c = cenario();
    c.pedidos.forEach((p) => { p.caixas_24 = 200; });               // 1800 por pedido
    const pl = R.planejar(c.pedidos, c.clientes, TER, { marcacao: true, padroes: c.padroes, veiculos: LINHAS() });
    const st = pl.veiculos.strada;
    assert.equal(st.semLimite, true); assert.equal(st.capacidade, null); assert.equal(st.ocupacao, null);
    assert.equal(st.pedidos.length, 3); assert.equal(st.volume, 5400);
    assert.equal(pl.s10.pedidos.length, 1); assert.equal(pl.s10.ocupacao, 1800 / 2700);
    assert.equal(pl.fica.filter((x) => x.motivoFica === 'capacidade').map((x) => x.veiculo).join(), 's10,s10,s10');
    // sem caixas na Strada: entra (não há capacidade a conferir)
    const c2 = cenario(); c2.pedidos[4].caixas_24 = null; c2.pedidos[4].caixas_48 = null;
    const pl2 = R.planejar(c2.pedidos, c2.clientes, TER, { marcacao: true, padroes: c2.padroes, veiculos: LINHAS() });
    assert.equal(pl2.veiculos.strada.desconhecidos, 1); assert.equal(pl2.veiculos.strada.pedidos.length, 3);
});

test('capacidade alterável: S10 com 900 de carga leva só o que cabe; capacidade 0/inválida = sem limite', () => {
    const c = cenario(), l = LINHAS();
    l[1].capacidade_volume = 90;                                    // 10 cx24
    let pl = R.planejar(c.pedidos, c.clientes, TER, { marcacao: true, padroes: c.padroes, veiculos: l });
    assert.equal(pl.s10.pedidos.length, 2); assert.equal(pl.s10.volume, 90);
    l[1].capacidade_volume = 'abc';
    pl = R.planejar(c.pedidos, c.clientes, TER, { marcacao: true, padroes: c.padroes, veiculos: l });
    assert.equal(pl.s10.semLimite, true); assert.equal(pl.s10.pedidos.length, 4);
});

test('veículo inativo: pedidos marcados nele vão para aguardando (veiculoInativo); some de ordem; alias vazio', () => {
    const c = cenario(), l = LINHAS();
    l[2].ativo = false; l[1].ativo = false;
    const pl = R.planejar(c.pedidos, c.clientes, TER, { marcacao: true, padroes: c.padroes, veiculos: l });
    assert.deepEqual(pl.ordem, ['caminhao']);
    assert.equal(pl.s10.inativo, true); assert.equal(pl.s10.pedidos.length, 0); assert.ok(pl.s10.horario);
    assert.equal(pl.aguardando.length, 7); assert.ok(pl.aguardando.every((x) => x.veiculoInativo));
    // marcado num id que não existe na frota: também aguardando
    const c2 = cenario(); c2.padroes[docN(0)] = 'fusca';
    const pl2 = R.planejar(c2.pedidos, c2.clientes, TER, { marcacao: true, padroes: c2.padroes, veiculos: LINHAS() });
    assert.equal(pl2.aguardando.length, 1); assert.equal(pl2.aguardando[0].veiculoInativo, true);
});

test('dias por veículo: sábado S10 e Strada ficam (sem_saida_s10 / sem_saida_veiculo); Strada configurada seg..sáb sai', () => {
    const c = cenario();
    let pl = R.planejar(c.pedidos, c.clientes, SAB, { marcacao: true, padroes: c.padroes, veiculos: LINHAS() });
    assert.equal(pl.semSaida, false); assert.equal(pl.caminhao.pedidos.length, 1);
    assert.deepEqual(pl.fica.map((x) => [x.veiculo, x.motivoFica, x.proxima]).sort(),
        [['s10', 'sem_saida_s10', '2026-12-07'], ['s10', 'sem_saida_s10', '2026-12-07'], ['s10', 'sem_saida_s10', '2026-12-07'], ['s10', 'sem_saida_s10', '2026-12-07'],
         ['strada', 'sem_saida_veiculo', '2026-12-07'], ['strada', 'sem_saida_veiculo', '2026-12-07'], ['strada', 'sem_saida_veiculo', '2026-12-07']]);
    const l = LINHAS(); l[2].dias_sem_saida = [0];
    pl = R.planejar(c.pedidos, c.clientes, SAB, { marcacao: true, padroes: c.padroes, veiculos: l });
    assert.equal(pl.veiculos.strada.pedidos.length, 3);
    // caminhão desativado e os outros sem sábado: sábado = sem saída de NENHUM veículo
    const l2 = LINHAS(); l2[0].ativo = false;
    pl = R.planejar(c.pedidos, c.clientes, SAB, { marcacao: true, padroes: c.padroes, veiculos: l2 });
    assert.equal(pl.semSaida, true);
    // prazo pelos dias da Strada: pedido de sexta vence terça (sem sábado)
    assert.equal(R.prazoDe('2026-12-04T09:00:00-03:00', R.comFrota(null, LINHAS()), 'strada'), '2026-12-08');
});

test('veículo novo (fiorino) porta a porta com dias e carga próprios; cd_ceasa com capacidade definida limita', () => {
    const c = cenario(), l = LINHAS();
    l.push({ id: 'fiorino', nome: 'Fiorino', modo: 'porta', capacidade_volume: 50, dias_sem_saida: [0, 3], ordem: 40, ativo: true });
    const d = docN(30); c.clientes[d] = cliAng('Sul', 180, 0.03); c.padroes[d] = 'fiorino';
    c.pedidos.push(ped(d), ped(d));
    let pl = R.planejar(c.pedidos, c.clientes, TER, { marcacao: true, padroes: c.padroes, veiculos: l });
    assert.deepEqual(pl.ordem, ['caminhao', 's10', 'strada', 'fiorino']);
    assert.equal(pl.veiculos.fiorino.pedidos.length, 1); assert.equal(pl.fica.filter((x) => x.veiculo === 'fiorino')[0].motivoFica, 'capacidade');
    pl = R.planejar(c.pedidos, c.clientes, '2026-12-02', { marcacao: true, padroes: c.padroes, veiculos: l });   // quarta: fiorino não sai
    assert.equal(pl.veiculos.fiorino.semSaida, true);
    assert.equal(pl.fica.filter((x) => x.veiculo === 'fiorino').every((x) => x.motivoFica === 'sem_saida_veiculo' && x.proxima === '2026-12-03'), true);
    // caminhão com capacidade 45 (5 cx24): o 2º box fica
    const l2 = LINHAS(); l2[0].capacidade_volume = 45;
    const dc2 = docN(21); c.clientes[dc2] = cliAng('Box2', 0, 0, { pos: CEASA }); c.padroes[dc2] = 'caminhao'; c.pedidos.push(ped(dc2));
    pl = R.planejar(c.pedidos, c.clientes, TER, { marcacao: true, padroes: c.padroes, veiculos: l2 });
    assert.equal(pl.caminhao.pedidos.length, 1); assert.equal(pl.fica.filter((x) => x.veiculo === 'caminhao')[0].motivoFica, 'capacidade');
});

test('planejarSemana por veículo: Strada só com os pedidos dela, seg..sex, sem limite; S10 ignora os da Strada; inválido', () => {
    const c = cenario();
    const st = R.planejarSemana(c.pedidos, c.clientes, SEMANA, { padroes: c.padroes, veiculos: LINHAS(), veiculo: 'strada' });
    assert.equal(st.veiculo, 'strada'); assert.equal(st.semLimite, true); assert.equal(st.capacidade, null);
    assert.deepEqual(st.dias.map((d) => d.dia), ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04']);
    assert.equal(st.resumo.pedidos, 3); assert.equal(st.outros.length, 4); assert.equal(st.cdPedidos.length, 1);
    assert.ok(st.dias.every((d) => d.ocupacao === null && d.excesso === false && d.veiculo === 'strada'));
    const s10 = R.planejarSemana(c.pedidos, c.clientes, SEMANA, { padroes: c.padroes, veiculos: LINHAS() });
    assert.equal(s10.veiculo, 's10'); assert.equal(s10.resumo.pedidos, 4); assert.equal(s10.outros.length, 3);
    // plano salvo para OUTRO veículo não vale; para este vale
    const cd = c.pedidos[0].cd_pedido;
    let s = R.planejarSemana(c.pedidos, c.clientes, SEMANA, { padroes: c.padroes, veiculos: LINHAS(), plano: { [cd]: { dia: '2026-12-04', veiculo_id: 'strada' } } });
    assert.notEqual(s.dias.find((d) => d.pedidos.some((x) => x.p.cd_pedido === cd)).pedidos.find((x) => x.p.cd_pedido === cd).origemDia, 'salvo');
    s = R.planejarSemana(c.pedidos, c.clientes, SEMANA, { padroes: c.padroes, veiculos: LINHAS(), plano: { [cd]: { dia: '2026-12-04', veiculo_id: 's10' } } });
    assert.equal(s.dias.find((d) => d.dia === '2026-12-04').pedidos.find((x) => x.p.cd_pedido === cd).origemDia, 'salvo');
    for (const v of ['caminhao', 'fusca']) {
        const r = R.planejarSemana(c.pedidos, c.clientes, SEMANA, { padroes: c.padroes, veiculos: LINHAS(), veiculo: v });
        assert.equal(r.veiculoInvalido, true); assert.equal(r.dias.length, 0);
    }
    const l = LINHAS(); l[2].ativo = false;
    assert.equal(R.planejarSemana(c.pedidos, c.clientes, SEMANA, { padroes: c.padroes, veiculos: l, veiculo: 'strada' }).veiculoInvalido, true);
});

test('sugestoesJuntar por veículo: marcado só nas rotas do veículo dele; sem marca concorre a todos; Strada sem limite; inativo', () => {
    const c = cenario();
    const pl = R.planejar(c.pedidos, c.clientes, TER, { marcacao: true, padroes: c.padroes, veiculos: LINHAS() });
    const o = (x) => Object.assign({ hoje: TER, padroes: c.padroes, veiculos: LINHAS() }, x || {});
    const r0 = R.sugestoesJuntar(c.pedidos, c.clientes, pl, o());
    assert.deepEqual(r0.rotas.map((r) => r.veiculo), ['s10', 'strada']);
    assert.equal(r0.rotas[1].semLimite, true); assert.equal(r0.rotas[1].folga, null);
    // perto do norte, marcado S10: não vai para a rota da Strada (longe da S10)
    const dn = docN(40); c.clientes[dn] = cliAng('NorteS10', 2, 0.025); c.padroes[dn] = 's10';
    // perto do norte, sem marcação: Strada, precisaMarcar
    const ds = docN(41); c.clientes[ds] = cliAng('NorteSemMarca', -2, 0.025);
    // perto do norte, marcado Strada, GIGANTE: Strada não tem limite
    const dg = docN(42); c.clientes[dg] = cliAng('NorteGrande', 1, 0.035); c.padroes[dg] = 'strada';
    const extra = [ped(dn), ped(ds), ped(dg, { caixas_24: 1000 })];
    const r = R.sugestoesJuntar(c.pedidos.concat(extra), c.clientes, pl, o());
    const por = {}; r.sugestoes.forEach((s) => { por[s.documento] = s; });
    assert.equal(por[dn], undefined); assert.equal(r.descartados.longe, 1);
    assert.equal(por[ds].veiculo, 'strada'); assert.equal(por[ds].precisaMarcar, true); assert.equal(por[ds].nomeVeiculo, 'Strada');
    assert.equal(por[dg].veiculo, 'strada'); assert.equal(por[dg].semLimite, true); assert.equal(por[dg].folgaDepois, null); assert.equal(por[dg].volume, 9000);
    // Strada desativada: o marcado nela = veiculo_inativo; rota dela some
    const l = LINHAS(); l[2].ativo = false;
    const r2 = R.sugestoesJuntar(c.pedidos.concat(extra), c.clientes, pl, o({ veiculos: l }));
    assert.deepEqual(r2.rotas.map((x) => x.veiculo), ['s10']);
    assert.ok(r2.descartados.veiculo_inativo >= 1);
    // rota da semana da Strada
    const sem = R.planejarSemana(c.pedidos, c.clientes, SEMANA, { padroes: c.padroes, veiculos: LINHAS(), veiculo: 'strada' });
    const r3 = R.sugestoesJuntar(c.pedidos.concat(extra), c.clientes, sem, o({ hoje: '2026-11-30' }));
    assert.ok(r3.rotas.length >= 1 && r3.rotas.every((x) => x.veiculo === 'strada' && x.fonte === 'semana'));
});

// ===================== WhatsApp rota_<veículo> =====================
const AGORA = new Date('2026-12-01T09:00:00Z');   // terça 06:00 em SP
function dadosWa(veiculos) {
    const c = cenario();
    return { pedidos: c.pedidos, clientes: c.clientes, cfg: R.cfgDe(R.CFG_PADRAO), excecoes: c.padroes, coletado: null, ignorados: {},
             v2: true, porPedido: {}, regras: {}, veiculos };
}
test('WhatsApp: rota_strada genérica (frota da 047 ou padrão), rota_s10/rota_caminhao iguais; inativo/sábado/v1 não mandam', () => {
    assert.equal(W.rotinaConhecida('rota_strada'), true); assert.equal(W.rotinaConhecida('rota_s10'), true);
    assert.equal(W.rotinaConhecida('rota_'), false); assert.equal(W.rotinaConhecida('rota_X'), false); assert.equal(W.rotinaConhecida('outra'), false);
    assert.equal(W.veiculoDaRotina('rota_strada'), 'strada'); assert.equal(W.veiculoDaRotina('receber_diario'), null);
    assert.equal(W.papelPermitido('rota_strada', 'entregador'), true); assert.equal(W.papelPermitido('rota_strada', 'gestor'), true);
    assert.equal(W.papelPermitido('rota_strada', 'financeiro'), false);
    for (const vs of [LINHAS(), null]) {
        const m = W.montarRota(dadosWa(vs), 'strada', AGORA, { painelUrl: 'https://x.test' });
        assert.ok(!m.vazio, 'strada manda'); assert.equal(m.resumo.paradas, 3);
        assert.equal(m.partes[0].params[0], 'Strada');
        const s = W.montarRota(dadosWa(vs), 's10', AGORA, {}); assert.equal(s.partes[0].params[0], 'S10'); assert.equal(s.resumo.paradas, 4);
        const cm = W.montarRota(dadosWa(vs), 'caminhao', AGORA, {}); assert.equal(cm.partes[0].params[0], 'Caminhão CEASA'); assert.equal(cm.resumo.cd, 1);
    }
    const l = LINHAS(); l[2].ativo = false;
    assert.match(W.montarRota(dadosWa(l), 'strada', AGORA, {}).vazio, /desativado/);
    assert.match(W.montarRota(dadosWa(LINHAS()), 'fusca', AGORA, {}).vazio, /não existe/);
    assert.match(W.montarRota(dadosWa(LINHAS()), 'strada', new Date('2026-12-05T09:00:00Z'), {}).vazio, /sem saída hoje para a Strada/);
    const v1 = dadosWa(null); delete v1.v2;
    assert.match(W.montarRota(v1, 'strada', AGORA, {}).vazio, /exige a marcação/);
    // Strada sem carga definida: aviso no resumo
    assert.equal(W.montarRota(dadosWa(LINHAS()), 'strada', AGORA, {}).resumo.semLimite, true);
});

test('WhatsApp coletarRota: lê rota_veiculos (047); sem a tabela = padrões; marcação em veículo fora da frota é ignorada', async () => {
    const c = cenario();
    const tab = (comFrota) => {
        const t = { solidcon_pedidos_erp: c.pedidos, solidcon_pedidos_erp_sync: [], rota_config: [{ id: 1 }],
                    rota_cliente_veiculo: Object.keys(c.padroes).map((d) => ({ documento: d, veiculo: c.padroes[d] })).concat([{ documento: docN(99), veiculo: 'fusca' }]),
                    rota_pedido_veiculo: [], rota_cliente_regras: [], rota_pedido_ignorado: [] };
        if (comFrota) t.rota_veiculos = LINHAS();
        return t;
    };
    const sb = (t) => ({
        from(nome) {
            let linhas = (t[nome] || []).slice(); const erro = t[nome] ? null : { code: 'PGRST205', message: 'Could not find the table public.' + nome };
            const b = { select() { return b; }, order() { return b; }, in(cc, v) { linhas = linhas.filter((r) => v.includes(r[cc])); return b; }, eq(cc, v) { linhas = linhas.filter((r) => r[cc] === v); return b; },
                        limit() { return b; }, range(a, z) { linhas = linhas.slice(a, z + 1); return b; }, then(ok, er) { return Promise.resolve({ data: erro ? null : linhas, error: erro }).then(ok, er); } };
            return b;
        },
        rpc(n, a) { return Promise.resolve({ data: a.p_documentos.filter((d) => c.clientes[d]).map((d) => { const k = c.clientes[d]; return { documento: d, nome: k.nome, bairro: k.bairro, cidade: k.cidade, lat: k.pos[0], lng: k.pos[1], precisao: 'exata' }; }), error: null }); }
    });
    const d1 = await W.coletarRota(sb(tab(true)));
    assert.equal(d1.veiculos.length, 3); assert.equal(d1.excecoes[docN(10)], 'strada'); assert.equal(d1.excecoes[docN(99)], undefined);
    const d0 = await W.coletarRota(sb(tab(false)));
    assert.equal(d0.veiculos, null); assert.equal(d0.excecoes[docN(10)], undefined);   // sem a 047 só caminhao/s10
    assert.equal(d0.excecoes[docN(0)], 's10');
});

// ===================== Sentinela V-BACK (V2, V3, V4) =====================
test('Sentinela V-BACK V2: mesmo cliente com pedidos marcados em S10 e Strada = sugestões independentes, sem somar a carga', () => {
    const c = cenario();
    const pl = R.planejar(c.pedidos, c.clientes, TER, { marcacao: true, padroes: c.padroes, veiculos: LINHAS() });
    const d = docN(50); c.clientes[d] = cliAng('Meio', 45, 0.02);        // perto das duas rotas
    const pS = ped(d, { caixas_24: 5 }), pT = ped(d, { caixas_24: 7 });
    const porPedido = { [pS.cd_pedido]: 's10', [pT.cd_pedido]: 'strada' };
    const o = { hoje: TER, padroes: c.padroes, porPedido, veiculos: LINHAS(), desvioMaxKm: 20 };
    const r1 = R.sugestoesJuntar(c.pedidos.concat([pS, pT]), c.clientes, pl, o);
    const r2 = R.sugestoesJuntar(c.pedidos.concat([pT, pS]), c.clientes, pl, o);
    const resumo = (r) => r.sugestoes.filter((s) => s.documento === d).map((s) => [s.veiculo, s.cds, s.volume, s.pedidos.map((x) => x.veiculo)]).sort();
    assert.deepEqual(resumo(r1), [['s10', [pS.cd_pedido], 45, ['s10']], ['strada', [pT.cd_pedido], 63, ['strada']]]);
    assert.deepEqual(resumo(r2), resumo(r1), 'a ordem dos pedidos não muda a alocação');
    const ch = r1.sugestoes.filter((s) => s.documento === d).map((s) => s.chave);
    assert.equal(new Set(ch).size, 2, 'chave distinta por veículo');
});

test('Sentinela V-BACK V3: domingo é sempre dia sem saída (frota só de domingo não tem dia nenhum)', () => {
    const l = LINHAS(); l.push({ id: 'domingo', nome: 'Domingo', modo: 'porta', capacidade_volume: null, dias_sem_saida: [1, 2, 3, 4, 5, 6], ordem: 50, ativo: true });
    const f = R.frotaDe(l);
    assert.deepEqual(f.porId.domingo.diasSemSaida, [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(R.frotaDe([{ id: 'x1', nome: 'X', modo: 'porta', dias_sem_saida: [6] }]).porId.x1.diasSemSaida, [0, 6]);
    const c = cenario(); const dd = docN(60); c.clientes[dd] = cliAng('Dom', 200, 0.03); c.padroes[dd] = 'domingo'; c.pedidos.push(ped(dd));
    const sem = R.planejarSemana(c.pedidos, c.clientes, '2026-12-07', { padroes: c.padroes, veiculos: l, veiculo: 'domingo' });
    assert.equal(sem.dias.length, 0); assert.equal(sem.semSaidaNaSemana, true);
    assert.ok(sem.dias.every((x) => R.diaSemana(x.dia) !== 0));
    assert.equal(R.planejar(c.pedidos, c.clientes, '2026-12-13', { marcacao: true, padroes: c.padroes, veiculos: l }).semSaida, true);   // domingo
});

test('Sentinela V-BACK V4: ids constructor/__proto__/prototype recusados; nada quebra (rota, semana, juntar, WhatsApp)', () => {
    for (const id of ['constructor', '__proto__', 'prototype']) {
        const l = LINHAS(); l.push({ id, nome: 'Mau', modo: 'porta', capacidade_volume: null, dias_sem_saida: [0], ordem: 60, ativo: true });
        const f = R.frotaDe(l);
        assert.equal(f.lista.length, 3, id); assert.equal(Object.prototype.hasOwnProperty.call(f.porId, id), false);
        assert.equal(R.idVeiculoValido(id), false);
        const c = cenario(); c.padroes[docN(0)] = id;
        const pl = R.planejar(c.pedidos, c.clientes, TER, { marcacao: true, padroes: c.padroes, veiculos: l });
        assert.equal(pl.aguardando.length, 1, id);
        assert.doesNotThrow(() => R.planejarSemana(c.pedidos, c.clientes, SEMANA, { padroes: c.padroes, veiculos: l, veiculo: id }));
        assert.equal(R.planejarSemana(c.pedidos, c.clientes, SEMANA, { padroes: c.padroes, veiculos: l, veiculo: id }).veiculoInvalido, true);
        assert.doesNotThrow(() => R.sugestoesJuntar(c.pedidos, c.clientes, [pl, { dia: TER, veiculo: id, paradas: pl.s10.paradas }], { hoje: TER, padroes: c.padroes, veiculos: l }));
        assert.equal(R.temSaida(TER, R.comFrota(null, l), id), true);   // desconhecido = padrão (sem exceção)
        assert.equal(W.veiculoDaRotina('rota_' + id), null);
        const m = W.montarRota(dadosWa(l), id, AGORA, {});
        assert.ok(m.vazio && /não existe/.test(m.vazio), id);
    }
});
