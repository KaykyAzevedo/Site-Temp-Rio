'use strict';
// 068V UI: troca de veiculo no Historico e selos "Sem veiculo" (sem S10 implicito).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ler = (f) => fs.readFileSync(path.join(__dirname, '../../', f), 'utf8');

test('068V Historico: le e troca veiculo via RPCs do contrato, so com pode_marcar_rota, motivo obrigatorio', () => {
  const s = ler('js/admin-historico-068d.js');
  assert.match(s, /rota_068_veiculo_historico_ler', \{ p_cds: lote \}/);
  assert.match(s, /rota_068_veiculo_historico', \{ p_cd: Number\(cd\), p_veiculo: veiculo, p_motivo: motivo \}/);
  assert.match(s, /i \+= 300/);
  assert.match(s, /if \(!st\.podeMarcar\) return '<div class="adm-hist068-veic">' \+ selo/);
  assert.match(s, /motivo\.length > 200/);
  assert.match(s, /Sem veículo/);
});

test('068V Semana/Pedidos/Amanha: selo Sem veiculo, grupo em dia passado e aviso de amanha', () => {
  const q = ler('js/admin-rota-quadro.js'), r = ler('js/admin-rota.js');
  assert.match(q, /data-rq-sem-veiculo/);
  assert.match(q, /data-rq-grupo-sem-veiculo/);
  assert.match(q, /col\.dia <= st\.hoje/);
  assert.match(r, /semVeiculo: !vid/);
  assert.match(r, /veiculo: vid \|\| null/);
  assert.match(r, /data-rota-070-sem-veiculo/);
  assert.match(r, /semPlano\.semVeiculoPedidos\.length/);
  assert.match(ler('css/admin-rota.css'), /\.rota-selo-sem-veiculo/);
});

test('068V r2: sem fallback S10 em itens salvos, leitura B/recebidos sobrescrevem foto050 e quadro nao grava sem veiculo', () => {
  const r = fs.readFileSync(path.join(__dirname, '../../js/admin-rota.js'), 'utf8');
  const q = fs.readFileSync(path.join(__dirname, '../../js/admin-rota-quadro.js'), 'utf8');
  assert.ok(!/it\.veiculo_id \|\| 's10'/.test(r));
  assert.ok(!/st\.planoVeic\[[a-z]+\] \|\| 's10'/.test(r));
  assert.match(r, /rota_068v_semana_recebidos', \{ p_inicio: ini \}/);
  assert.match(r, /overlay068v\(ini, hoje, diasArr, fazerCartao, d065\)/);
  assert.match(r, /origemDia: 'recebido', entregue: true/);
  assert.match(q, /nunca grava pedido sem veículo/);
  assert.match(q, /Escolha o veículo do pedido antes de programar/);
});

// ---- r3: leitura atomica da Semana e troca no Historico -> Semana relê ----
const vm = require('node:vm');
const R = require('../functions/_shared/rota-core.js');
function appSemana() {
  const window = { TempRioRotaCore: R };
  const src = fs.readFileSync(path.join(__dirname, '../../js/admin-rota.js'), 'utf8').replace('raiz.TempRioRota = {', 'raiz.__v={st,sincronizar068v,MSG:MSG_068V};raiz.TempRioRota = {');
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : ['2026-11-27T10:00:00-03:00'])); } }
  const rapido = (fn, ms) => setTimeout(fn, ms === 20000 ? 0 : ms);
  vm.runInNewContext(src, { window, Intl, Date: Clock, setTimeout: rapido, clearTimeout, console });
  const q = window.__v, s = q.st;
  s.ativo = true; s.v2 = true; s.sessao = 1; s.seq = 1;
  s.sem065Dados = { '2026-11-23': { itens: [{ cd_pedido: 1529, dia: '2026-11-24', veiculo_id: 's10' }] } };
  return q;
}
const OK_REC = [{ cd_pedido: 1557, dia: '2026-11-26', veiculo_id: null, sem_veiculo: true }];
const OK_MAPA = [{ cd_pedido: 1529, veiculo_efetivo: null, sem_veiculo: true }, { cd_pedido: 1557, veiculo_efetivo: null, sem_veiculo: true }];
function sbCom(falha) {
  return { rpc(nome) {
    if (nome === falha.nome) return falha.tipo === 'timeout' ? new Promise(() => {}) : Promise.resolve({ error: { code: 'XX', message: 'boom' } });
    return Promise.resolve({ data: nome === 'rota_068v_semana_recebidos' ? OK_REC : OK_MAPA });
  } };
}
for (const nome of ['rota_068v_semana_recebidos', 'rota_068_veiculo_historico_ler']) {
  for (const tipo of ['erro', 'timeout']) {
    test(`068V r3: ${tipo} em ${nome} nao aplica parcial, mantem anterior e avisa`, async () => {
      const q = appSemana(), anterior = { veic: { 1529: { veiculo_efetivo: 's10' } }, recebidos: [] };
      q.st.v068v['2026-11-23'] = anterior; q.st.sb = sbCom({ nome, tipo });
      await q.sincronizar068v('2026-11-23');
      assert.strictEqual(q.st.v068v['2026-11-23'], anterior);
      assert.equal(q.st.msgSemana, q.MSG); assert.equal(q.st.semMsgErro, true);
      assert.match(q.MSG, /não foi possível ler veículos\/entregas; tente atualizar/i);
    });
  }
}
test('068V r3: leitura completa aplica mapa+recebidos e limpa o aviso', async () => {
  const q = appSemana(); q.st.sb = sbCom({ nome: 'nenhum' }); q.st.msgSemana = q.MSG; q.st.semMsgErro = true;
  await q.sincronizar068v('2026-11-23');
  assert.equal(q.st.v068v['2026-11-23'].recebidos.length, 1);
  assert.equal(q.st.v068v['2026-11-23'].veic[1529].sem_veiculo, true);
  assert.equal(q.st.msgSemana, '');
});
test('068V r3: trocar veiculo no Historico invalida cache e dispara evento; Semana invalida v068v e relê', async () => {
  const eventos = [], w = { TempRio068Partes: { F2: true, A: true, B: false, C: false, D: true, E: false, Acoes063: false, Problema: true }, addEventListener() {}, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }, dispatchEvent(e) { eventos.push(e); } };
  const src = fs.readFileSync(path.join(__dirname, '../../js/admin-historico-068d.js'), 'utf8').replace('raiz.TempRioHistorico068D = api;', 'raiz.TempRioHistorico068D = api; raiz.__h={st,salvarVeiculo};');
  vm.runInNewContext(src, { window: w, Date, Intl, Promise, URL, WeakMap, Object, Array, Set, Number, String, Error, isFinite, Math, setTimeout, clearTimeout, console });
  const { st, salvarVeiculo } = w.__h;
  st.sb = { rpc: () => Promise.resolve({ data: { status: 'ok', veiculo_para: 's10', alterado: true } }) };
  st.podeMarcar = true; st.semanaLinhas = [{ x: 1 }];
  await salvarVeiculo('1557', 's10', 'foi na S10');
  assert.equal(st.semanaLinhas, null);
  assert.equal(eventos.length, 1); assert.equal(eventos[0].type, 'temprio-veiculo068h'); assert.equal(eventos[0].detail.cd_pedido, 1557);
  const r = fs.readFileSync(path.join(__dirname, '../../js/admin-rota.js'), 'utf8');
  assert.match(r, /addEventListener\('temprio-veiculo068h', function \(\) \{\s*if \(!st\.sb\) return;\s*st\.mut\+\+; st\.v068v = \{\}; st\.carregado = false;\s*if \(st\.ativo\) recarregarTudo\(\);/);
});

// ---- r4: Historico nao esconde falha da leitura de veiculos ----
function appHistorico() {
  const w = { TempRio068Partes: { F2: true, A: true, B: false, C: false, D: true, E: false, Acoes063: false, Problema: true }, addEventListener() {} };
  const src = fs.readFileSync(path.join(__dirname, '../../js/admin-historico-068d.js'), 'utf8').replace('raiz.TempRioHistorico068D = api;', 'raiz.TempRioHistorico068D = api; raiz.__h={st,carregarMes,renderHtml};');
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : ['2026-11-27T10:00:00-03:00'])); } static now() { return Date.parse('2026-11-27T10:00:00-03:00'); } }
  const rapido = (fn, ms) => setTimeout(fn, ms === 20000 ? 0 : ms);
  vm.runInNewContext(src, { window: w, Date: Clock, Intl, Promise, URL, WeakMap, Object, Array, Set, Number, String, Error, isFinite, Math, setTimeout: rapido, clearTimeout, console });
  const q = w.__h; q.st.sb = null; return q;
}
function sbHist(modo) {
  return { rpc(nome) {
    if (nome === 'pode_marcar_rota') return Promise.resolve({ data: true });
    if (nome === 'rota_068_historico') return Promise.resolve({ data: [{ cd_pedido: 1557, dia: '2026-11-26', status: 'entregue', cliente_nome: 'X' }] });
    if (nome === 'rota_068_veiculo_historico_ler') {
      if (modo.v === 'erro') return Promise.resolve({ error: { code: 'XX', message: 'boom' } });
      if (modo.v === 'timeout') return new Promise(() => {});
      return Promise.resolve({ data: [{ cd_pedido: 1557, veiculo_efetivo: 'caminhao', sem_veiculo: false }] });
    }
    return Promise.resolve({ data: [] });
  } };
}
for (const falha of ['erro', 'timeout']) {
  test(`068V r4: Historico ${falha} na leitura de veiculos mantem anteriores e mostra aviso`, async () => {
    const q = appHistorico(), s = q.st, modo = { v: 'ok' };
    s.sb = sbHist(modo); s.ativo = true; s.alvo = { isConnected: true, contains: () => false, set innerHTML(v) { this.h = v; }, get innerHTML() { return this.h || ''; }, querySelector: () => null, querySelectorAll: () => [] };
    await q.carregarMes('2026-11'); await new Promise(r => setTimeout(r, 5));
    assert.equal(s.veic['1557'].veiculo_efetivo, 'caminhao'); assert.equal(s.veicErro, false);
    modo.v = falha; await q.carregarMes('2026-11'); await new Promise(r => setTimeout(r, 30));
    assert.equal(s.veicErro, true);
    assert.equal(s.veic['1557'].veiculo_efetivo, 'caminhao');
    assert.match(q.renderHtml(), /Não foi possível ler os veículos; tente atualizar\./);
    assert.match(q.renderHtml(), /CEASA \(caminhão\)/);
    modo.v = 'ok'; await q.carregarMes('2026-11'); await new Promise(r => setTimeout(r, 5));
    assert.equal(s.veicErro, false); assert.ok(!/Não foi possível ler os veículos/.test(q.renderHtml()));
  });
}

// ---- dup: foto 050 legada repete em Qua pedidos ja entregues em Ter ----
test('068V dup: dia passado nao repete pedido entregue em dia anterior; hoje/futuro inalterados', () => {
  const window = { TempRioRotaCore: R };
  const src = fs.readFileSync(path.join(__dirname, '../../js/admin-rota.js'), 'utf8').replace('raiz.TempRioRota = {', 'raiz.__o={st,overlay068v};raiz.TempRioRota = {');
  vm.runInNewContext(src, { window, Intl, Date, setTimeout, clearTimeout, console });
  const { st, overlay068v } = window.__o, ini = '2026-11-23', hoje = '2026-11-27';
  const ids = [1531, 1535, 1539, 1541, 1543, 1544, 1536, 1537, 1540];
  const cart = (cds) => cds.map(cd => ({ cd_pedido: cd, veiculo: 's10' }));
  st.v068v[ini] = { veic: {}, recebidos: ids.map(cd => ({ cd_pedido: cd, dia: '2026-11-24', status: 'entregue', veiculo_id: 's10', sem_veiculo: false })).concat([{ cd_pedido: 1600, dia: '2026-11-25', status: 'problema' }]) };
  const cols = [
    { dia: '2026-11-24', cartoes: cart(ids) },
    { dia: '2026-11-25', cartoes: cart(ids.concat([1600, 1999])) },
    { dia: '2026-11-27', cartoes: cart([1531]) },
    { dia: '2026-11-28', cartoes: cart([1531]) }
  ];
  overlay068v(ini, hoje, cols, () => { throw new Error('nao deve criar cartao novo'); }, { itens: [] });
  assert.deepEqual(cols[0].cartoes.map(c => c.cd_pedido), ids);            // dia da entrega mantem todos
  assert.deepEqual(cols[1].cartoes.map(c => c.cd_pedido), [1600, 1999]);   // Qua: sem os 9 de Ter; problema nao conta como entrega
  assert.deepEqual(cols[2].cartoes.map(c => c.cd_pedido), [1531]);         // hoje inalterado
  assert.deepEqual(cols[3].cartoes.map(c => c.cd_pedido), [1531]);         // futuro inalterado
});
