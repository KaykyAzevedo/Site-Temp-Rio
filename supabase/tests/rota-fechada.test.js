// ROTA-FIXA (050): rota do dia FECHADA (foto) no rota-core. Dados FICTÍCIOS.
// Rodar (da raiz do repo): node --test supabase/tests/rota-fechada.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../functions/_shared/rota-core.js');

const HOJE = '2026-11-23';   // segunda
const FROTA = [
    { id: 'caminhao', nome: 'Caminhão', modo: 'cd_ceasa', capacidade_volume: null, dias_sem_saida: [0], volta_sede: false, cor: '#111111', ordem: 1, ativo: true },
    { id: 's10', nome: 'S10', modo: 'porta', capacidade_volume: 100000, dias_sem_saida: [0], volta_sede: true, cor: '#222222', ordem: 2, ativo: true },
    { id: 'strada', nome: 'Strada', modo: 'porta', capacidade_volume: null, dias_sem_saida: [0, 6], volta_sede: true, cor: '#333333', ordem: 3, ativo: true }
];
function base(n, extra) {
    const pedidos = [], clientes = {}, porPedido = {};
    for (let i = 0; i < n; i++) {
        const doc = String(12000000000000 + i), vei = i % 4 === 3 ? 'caminhao' : (i % 4 === 2 ? 'strada' : 's10');
        clientes[doc] = { nome: 'Cliente ' + i, bairro: 'Bairro ' + (i % 5), cidade: 'Petrópolis',
                          pos: i % 7 === 6 ? null : [R.ROTA.ORIGEM[0] + 0.006 * ((i * 5) % 9 + 1), R.ROTA.ORIGEM[1] + 0.004 * ((i * 3) % 7)] };
        pedidos.push({ cd_pedido: 7000 + i, dt_pedido: '2026-11-21T10:00:00-03:00', etapa: 'conferido', cliente_tipo: 'cnpj', documento: doc, caixas_24: 2, caixas_48: 1, caixas_outras: 0 });
        porPedido[7000 + i] = vei;
    }
    return Object.assign({ pedidos, clientes, porPedido, ignorados: {}, veiculos: FROTA }, extra || {});
}
function plan(d, dia, fechada, mais) {
    return R.planejar(d.pedidos, d.clientes, dia || HOJE, Object.assign({ cfg: R.cfgDe(R.CFG_PADRAO), excecoes: {}, marcacao: true, padroes: {}, porPedido: d.porPedido,
        regras: {}, ignorados: d.ignorados, veiculos: d.veiculos, fechada }, mais || {}));
}
const ordemPorta = (b) => b.paradas.concat(b.semPosicao).map((sp) => sp.pedidos.map((x) => x.p.cd_pedido).join('+'));
const foto = (pl, extra) => Object.assign({ data: HOJE, itens: R.itensDaRota(pl), fechada_em: '2026-11-23T09:40:00Z', fechada_nome: 'Márcio', automatico: false, versao: 1 }, extra || {});

test('sem fechada (sem a 050) = exatamente o comportamento de hoje', () => {
    const d = base(16);
    const a = plan(d), b = R.planejar(d.pedidos, d.clientes, HOJE, { cfg: R.cfgDe(R.CFG_PADRAO), excecoes: {}, marcacao: true, padroes: {}, porPedido: d.porPedido, regras: {}, ignorados: {}, veiculos: FROTA });
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
    assert.equal(a.fechada, null);
});

test('fechar: a foto (itensDaRota) reproduz a mesma rota; metadados expostos', () => {
    const d = base(16), viva = plan(d), f = foto(viva);
    assert.ok(f.itens.length === 16 && f.itens.every((it) => it.ordem >= 1));
    const fx = plan(d, HOJE, f);
    for (const id of fx.ordem) {
        if (fx.veiculos[id].cd) assert.equal(fx.veiculos[id].pedidos.length, viva.veiculos[id].pedidos.length);
        else assert.deepEqual(ordemPorta(fx.veiculos[id]), ordemPorta(viva.veiculos[id]), id);
    }
    assert.deepEqual(Object.keys(fx.entregues).sort(), Object.keys(viva.entregues).sort());
    assert.deepEqual(fx.fechada, { data: HOJE, fechadaEm: '2026-11-23T09:40:00Z', nome: 'Márcio', automatico: false, versao: 1 });
    assert.equal(fx.fica.length, 0);
});

test('depois de fechada: pedido NOVO não muda a rota de hoje e vai para o próximo dia com saída', () => {
    const d = base(12), f = foto(plan(d));
    const antes = plan(d, HOJE, f);
    const doc = '12000000000099';
    d.clientes[doc] = { nome: 'Cliente Novo', bairro: 'Bairro 1', cidade: 'Petrópolis', pos: [R.ROTA.ORIGEM[0] + 0.001, R.ROTA.ORIGEM[1]] };
    d.pedidos.push({ cd_pedido: 7999, dt_pedido: '2026-11-23T09:00:00-03:00', etapa: 'aberto', cliente_tipo: 'cnpj', documento: doc, caixas_24: 1, caixas_48: 0, caixas_outras: 0 });
    d.porPedido[7999] = 's10';
    const dep = plan(d, HOJE, f);
    assert.deepEqual(ordemPorta(dep.veiculos.s10), ordemPorta(antes.veiculos.s10));
    const novo = dep.fica.find((x) => x.p.cd_pedido === 7999);
    assert.ok(novo && novo.motivoFica === 'rota_fechada' && novo.proxima === '2026-11-24', JSON.stringify(novo && { m: novo.motivoFica, p: novo.proxima }));
    // a "aba" do próximo dia (painel: excluir = entregues de hoje) recebe o pedido novo
    const prox = plan(d, '2026-11-24', f, { excluir: dep.entregues });
    assert.ok(prox.veiculos.s10.pedidos.some((x) => x.p.cd_pedido === 7999));
    assert.ok(!prox.veiculos.s10.pedidos.some((x) => dep.entregues[x.p.cd_pedido]));
    // sábado: a Strada não sai; pedido novo da Strada na sexta vai para a segunda seguinte
    const dS = base(4), fS = foto(plan(dS, '2026-11-27'), { data: '2026-11-27' });
    dS.clientes['12000000000098'] = { nome: 'Novo Strada', bairro: 'B', cidade: 'P', pos: [R.ROTA.ORIGEM[0] + 0.002, R.ROTA.ORIGEM[1]] };
    dS.pedidos.push({ cd_pedido: 7998, dt_pedido: '2026-11-27T09:00:00-03:00', etapa: 'aberto', cliente_tipo: 'cnpj', documento: '12000000000098', caixas_24: 1, caixas_48: 0, caixas_outras: 0 });
    dS.porPedido[7998] = 'strada';
    const sx = plan(dS, '2026-11-27', fS).fica.find((x) => x.p.cd_pedido === 7998);
    assert.equal(sx.proxima, '2026-11-30');
});

test('Remover de hoje: sai da rota fechada e volta no próximo dia; a ordem dos outros veículos não muda', () => {
    const d = base(16), viva = plan(d), f = foto(viva);
    const alvo = viva.veiculos.s10.paradas[1].pedidos[0].p.cd_pedido;
    const f2 = Object.assign({}, f, { itens: f.itens.map((it) => it.cd_pedido === alvo ? Object.assign({}, it, { removido_em: '2026-11-23T10:00:00Z', removido_nome: 'Márcio' }) : it) });
    const pl = plan(d, HOJE, f2);
    assert.ok(!pl.entregues[alvo]);
    const x = pl.fica.find((y) => y.p.cd_pedido === alvo);
    assert.ok(x && x.motivoFica === 'rota_fechada' && x.removidoHoje && x.removidoHoje.nome === 'Márcio' && x.proxima === '2026-11-24');
    assert.deepEqual(ordemPorta(pl.veiculos.strada), ordemPorta(viva.veiculos.strada));
    const semAlvo = ordemPorta(viva.veiculos.s10).filter((k) => k !== String(alvo));
    assert.deepEqual(ordemPorta(pl.veiculos.s10), semAlvo, 'sem o removido, o resto da S10 na ordem salva');
});

test('Trazer para hoje: entra no veículo escolhido; SÓ esse veículo é reordenado (2-opt); itensDaRota dá a ordem nova dele', () => {
    const d = base(16), viva = plan(d), f = foto(viva);
    const doc = '12000000000077';
    d.clientes[doc] = { nome: 'Cliente de amanhã', bairro: 'Bairro 2', cidade: 'Petrópolis', pos: [R.ROTA.ORIGEM[0] + 0.03, R.ROTA.ORIGEM[1] + 0.01] };
    d.pedidos.push({ cd_pedido: 7777, dt_pedido: '2026-11-23T07:00:00-03:00', etapa: 'aberto', cliente_tipo: 'cnpj', documento: doc, caixas_24: 1, caixas_48: 0, caixas_outras: 0 });
    // fora da foto: vai para amanhã
    assert.equal(plan(d, HOJE, f).fica.find((x) => x.p.cd_pedido === 7777).motivoFica, 'rota_fechada');
    // RPC adicionar: item novo na Strada (ordem null) -> a Strada inteira recalcula
    const itens = f.itens.map((it) => it.veiculo_id === 'strada' ? Object.assign({}, it, { ordem: null }) : it).concat([{ cd_pedido: 7777, veiculo_id: 'strada', ordem: null, origem: 'adicionado' }]);
    const pl = plan(d, HOJE, Object.assign({}, f, { itens }));
    assert.ok(pl.veiculos.strada.pedidos.some((x) => x.p.cd_pedido === 7777 && x.origemFechada === 'adicionado'));
    assert.deepEqual(ordemPorta(pl.veiculos.s10), ordemPorta(viva.veiculos.s10), 'S10 intacta');
    const nova = R.itensDaRota(pl, 'strada');
    assert.ok(nova.length === pl.veiculos.strada.pedidos.length && nova.every((it) => it.veiculo_id === 'strada' && it.ordem >= 1));
    // com a ordem gravada, a rota fica igual (determinística) e fixa
    const gravada = Object.assign({}, f, { itens: itens.map((it) => { const o = nova.find((n) => n.cd_pedido === it.cd_pedido); return o ? Object.assign({}, it, { ordem: o.ordem }) : it; }) });
    assert.deepEqual(ordemPorta(plan(d, HOJE, gravada).veiculos.strada), ordemPorta(pl.veiculos.strada));
});

test('ordem fixa: mudar o pino de um cliente depois de fechar NÃO reordena a rota fechada', () => {
    const d = base(16), viva = plan(d), f = foto(viva);
    const doc = viva.veiculos.s10.paradas[0].documento;
    d.clientes[doc] = Object.assign({}, d.clientes[doc], { pos: [R.ROTA.ORIGEM[0] + 0.2, R.ROTA.ORIGEM[1] + 0.2] });
    assert.deepEqual(ordemPorta(plan(d, HOJE, f).veiculos.s10), ordemPorta(viva.veiculos.s10));
});

test('"Tirar da rota" (045) continua valendo ANTES da foto e nunca volta sozinho; foto de outro dia e modo sem 044 são ignorados', () => {
    const d = base(12), viva = plan(d), f = foto(viva);
    const cd = viva.veiculos.s10.pedidos[0].p.cd_pedido;
    d.ignorados = { [cd]: { motivo: 'boleto atrasado' } };
    const pl = plan(d, HOJE, f);
    assert.ok(pl.ignorados.some((x) => x.p.cd_pedido === cd) && !pl.entregues[cd] && !pl.fica.some((x) => x.p.cd_pedido === cd));
    assert.ok(!plan(d, '2026-11-24', f, { excluir: pl.entregues }).veiculos.s10.pedidos.some((x) => x.p.cd_pedido === cd), 'nem no dia seguinte');
    // foto de ontem não vale hoje
    assert.equal(plan(base(12), HOJE, foto(viva, { data: '2026-11-22' })).fechada, null);
    // modo automático (sem a 044) ignora a foto
    const dd = base(12);
    const auto = R.planejar(dd.pedidos, dd.clientes, HOJE, { cfg: R.cfgDe(R.CFG_PADRAO), excecoes: {}, veiculos: FROTA, fechada: f });
    assert.equal(auto.fechada, null);
});

test('veículo desativado depois de fechar: os pedidos dele vão para "aguardando" (veiculoInativo), sem quebrar', () => {
    const d = base(12), f = foto(plan(d));
    d.veiculos = FROTA.map((v) => v.id === 'strada' ? Object.assign({}, v, { ativo: false }) : v);
    const pl = plan(d, HOJE, f);
    const daStrada = f.itens.filter((it) => it.veiculo_id === 'strada').map((it) => it.cd_pedido);
    assert.ok(daStrada.length > 0 && daStrada.every((cd) => pl.aguardando.some((x) => x.p.cd_pedido === cd && x.veiculoInativo)));
});

test('pedido da foto que já saiu no ERP some da rota (não é pendente); itens inválidos da foto são ignorados', () => {
    const d = base(8), f = foto(plan(d));
    d.pedidos[0] = Object.assign({}, d.pedidos[0], { etapa: 'saiu', dt_saida: '2026-11-23T08:30:00-03:00' });
    const pl = plan(d, HOJE, Object.assign({}, f, { itens: f.itens.concat([{ cd_pedido: 1, veiculo_id: 'constructor', ordem: 1 }, null, { cd_pedido: null }]) }));
    assert.ok(!pl.entregues[d.pedidos[0].cd_pedido]);
    assert.equal(Object.keys(pl.entregues).length, 7);
});

test('Sentinela RF-4: perder ou ganhar o pino depois de fechar NÃO muda a ordem de entrega (sequência salva)', () => {
    const d = base(16), viva = plan(d), f = foto(viva);
    const seqAntes = R.sequenciaDe(viva.veiculos.s10).map((sp) => sp.chave);
    assert.ok(seqAntes.length >= 3);
    // 1º cliente perde o pino; um sem pino ganha
    const doc1 = viva.veiculos.s10.paradas[0].documento;
    d.clientes[doc1] = Object.assign({}, d.clientes[doc1], { pos: null });
    const semPino = viva.veiculos.s10.semPosicao[0];
    if (semPino) d.clientes[semPino.documento] = Object.assign({}, d.clientes[semPino.documento], { pos: [R.ROTA.ORIGEM[0] + 0.05, R.ROTA.ORIGEM[1] + 0.05] });
    const pl = plan(d, HOJE, f), b = pl.veiculos.s10;
    assert.deepEqual(R.sequenciaDe(b).map((sp) => sp.chave), seqAntes, 'mesma sequência');
    assert.equal(R.sequenciaDe(b)[0].chave, 'd:' + doc1, 'o que perdeu o pino continua em 1º');
    assert.ok(!b.paradas.some((sp) => sp.chave === 'd:' + doc1) && b.semPosicao.some((sp) => sp.chave === 'd:' + doc1), 'fora do trajeto do mapa, avisado como sem posição');
    // a foto/itens e a ordem salva não mudam
    assert.deepEqual(R.itensDaRota(pl, 's10').map((x) => x.cd_pedido), R.itensDaRota(viva, 's10').map((x) => x.cd_pedido));
    // sem rota fechada: sequência = paradas + sem posição (como antes)
    const v = plan(base(16));
    assert.deepEqual(R.sequenciaDe(v.veiculos.s10), v.veiculos.s10.paradas.concat(v.veiculos.s10.semPosicao));
});

test('Sentinela RF-3 (núcleo): cliente com pedidos em 2 veículos removido de hoje inteiro -> os 2 vão para o próximo dia', () => {
    const d = base(8);
    d.pedidos[1] = Object.assign({}, d.pedidos[1], { documento: d.pedidos[0].documento });   // mesmo cliente
    d.porPedido[d.pedidos[0].cd_pedido] = 's10'; d.porPedido[d.pedidos[1].cd_pedido] = 'strada';
    const viva = plan(d), f = foto(viva);
    const cds = [d.pedidos[0].cd_pedido, d.pedidos[1].cd_pedido];
    assert.ok(viva.entregues[cds[0]] && viva.entregues[cds[1]]);
    const f2 = Object.assign({}, f, { itens: f.itens.map((it) => cds.includes(it.cd_pedido) ? Object.assign({}, it, { removido_em: '2026-11-23T10:00:00Z' }) : it) });
    const pl = plan(d, HOJE, f2);
    assert.ok(cds.every((cd) => !pl.entregues[cd] && pl.fica.some((x) => x.p.cd_pedido === cd && x.motivoFica === 'rota_fechada')));
});
