'use strict';
// 068 C UI: botao "Problema na entrega" (marcar/desfazer), vermelho, nao conta como entregue.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const R = require('../functions/_shared/rota-core.js'), UI = require('../../js/entrega-admin.js');
const p = { cd_pedido: 1530, etapa: 'atendido', dt_saida: '2026-11-23T17:00:00-03:00', dt_pedido: '2026-11-22T07:00:00-03:00', documento: '12000000001530', caixas_24: 1, caixas_48: 0, caixas_outras: 0 };
const base = { cfg: R.cfgDe({ hora_saida: '08:00', canhoto_desde: '2026-01-01T00:00Z' }), confirmacoes: {}, canhotos: {}, agora: '2026-11-25T16:01:00-03:00', problemas: {}, podeMarcar: true, papel: 'marca_rota' };
const prob = { 1530: { cd_pedido: 1530, obs: 'Cliente <fechado>', por_nome: 'Ana', em: '2026-11-25T15:00:00-03:00' } };
const setPartes = (v) => { globalThis.TempRio068Partes = v; };
test.afterEach(() => { delete globalThis.TempRio068Partes; });

test('botao so aparece com parte C ligada, leitura carregada e permissao', () => {
  setPartes({ C: true });
  assert.match(UI.html(p, base), /data-entrega068-acao="marcar"[^>]*>Problema na entrega/);
  assert.doesNotMatch(UI.html(p, { ...base, podeMarcar: false }), /entrega068/);
  assert.doesNotMatch(UI.html(p, { ...base, problemas: null }), /entrega068/);
  setPartes({ C: false });
  assert.doesNotMatch(UI.html(p, base), /entrega068/);
});
test('problema ativo: vermelho com observacao escapada; Desfazer so admin', () => {
  setPartes({ C: true });
  const o = { ...base, problemas: prob };
  const h = UI.html(p, o);
  assert.match(h, /adm-entrega-problema/); assert.match(h, /Cliente &lt;fechado&gt;/); assert.match(h, /Ana/);
  assert.doesNotMatch(h, /acao="desfazer"/); assert.doesNotMatch(h, /acao="marcar"/);
  assert.match(UI.html(p, { ...o, papel: 'admin' }), /data-entrega068-acao="desfazer"/);
});
test('problema nao conta como entregue (overlay de admin.js)', () => {
  const c = { ...base, canhotos: { 1530: [{ enviado_em: '2026-11-25T17:00:00-03:00' }] } };
  assert.equal(R.etapaEntrega(p, c), 'recebido');
  const c2 = { ...c, confirmacoes: { 1530: { reprogramado: true, problema: true } } };
  assert.notEqual(R.etapaEntrega(p, c2), 'recebido'); assert.equal(R.recebidoRecente(p, c2), false);
  const src = fs.readFileSync(require('path').join(__dirname, '../../js/admin.js'), 'utf8');
  assert.match(src, /pe\.confirmacoes\[cd\] = \{ reprogramado: true, problema: true \}/);
  assert.match(src, /is-problema/);
});
test('marcar/desfazer chamam as RPCs com UUID, tratam erro e resposta invalida', async () => {
  const calls = [];
  const sb = (resp) => ({ rpc(n, a) { calls.push([n, a]); return Promise.resolve(resp); } });
  const id = '11111111-1111-4111-8111-111111111111';
  await UI.marcarProblema(sb({ data: { status: 'ok', ativa: true } }), 1530, 'porta fechada', id);
  await UI.desfazerProblema(sb({ data: { status: 'ok', alterado: true } }), 1530, id);
  assert.deepEqual(calls, [['rota_068_problema_marcar', { p_cd_pedido: 1530, p_obs: 'porta fechada', p_requisicao: id }], ['rota_068_problema_desfazer', { p_cd_pedido: 1530, p_requisicao: id }]]);
  await assert.rejects(UI.marcarProblema(sb({ data: { status: 'erro', motivo: 'pedido_sem_saida' } }), 1, 'x', id), /ainda não saiu/);
  await assert.rejects(UI.marcarProblema(sb({ error: { message: 'somente quem marca rota informa problema' } }), 1, 'x', id), /somente quem marca/);
  await assert.rejects(UI.desfazerProblema(sb({ data: null }), 1, id), /inválida/);
});
test('lerProblemas: blocos de 200, so ativos, tabela ausente desliga, erro vira aviso', async () => {
  const mk = (rows, err) => { const log = []; return { log, from(t) { assert.equal(t, 'pedido_entrega_problema'); const q = { select(s) { log.push(s); return q; }, in(c, l) { assert.ok(l.length <= 200); log.push('in' + l.length); return q; }, is(c, v) { assert.equal(c, 'desfeito_em'); assert.equal(v, null); return q; }, then(ok, bad) { return Promise.resolve(err ? { error: err } : { data: rows }).then(ok, bad); } }; return q; } }; };
  const ped = Array.from({ length: 450 }, (_, i) => ({ cd_pedido: i + 1 }));
  const a = mk([{ cd_pedido: 5, obs: 'x' }, { cd_pedido: 99999, obs: 'fora' }]);
  const r = await UI.lerProblemas(a, ped);
  assert.deepEqual(a.log.filter((x) => /^in/.test(x)), ['in200', 'in200', 'in50']); assert.deepEqual(Object.keys(r.porPedido), ['5']);
  assert.equal((await UI.lerProblemas(mk(null, { code: '42P01' }), ped)).instalada, false);
  const e = await UI.lerProblemas(mk(null, { code: '500', message: 'boom' }), ped); assert.equal(e.erro, 'boom');
});
test('ligar: clique abre dialogo; observacao obrigatoria, limite 300, UUID, carregando e erro', async () => {
  setPartes({ C: true });
  const botao = { getAttribute: (k) => ({ 'data-entrega068-cd': '1530', 'data-entrega068-acao': 'marcar' })[k], isConnected: true, focus() {} };
  const erroEl = { textContent: '' }, cont = { textContent: '' }, ta = { value: '', focus() {} }, submit = { textContent: 'Registrar problema', disabled: false };
  const form = {}; let dlg, req;
  globalThis.document = { createElement() { dlg = { style: {}, setAttribute() {}, addEventListener() {}, isConnected: true, close() { this.isConnected = false; }, remove() {}, showModal() {}, querySelectorAll: () => [submit], querySelector(sel) { if (sel === 'form') return form; return ({ '[name=obs]': ta, '[data-entrega068-erro]': erroEl, '[data-entrega068-cont]': cont, '[type=submit]': submit })[sel] || {}; }, set innerHTML(v) { this.html = v; } }; return dlg; }, body: { appendChild() {} } };
  let resolver; const calls = [];
  const sb = { rpc(n, a) { calls.push(a); return new Promise((r) => { resolver = r; }); } };
  const getOpts = () => ({ ...base, sb, sessao: 1 });
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => (req = '22222222-2222-4222-8222-222222222222') }, configurable: true });
  try {
    const el = { querySelectorAll: (s) => (s === '[data-entrega068-cd]' ? [botao] : []) };
    UI.ligar(el, getOpts); botao.onclick({ stopPropagation() {} });
    assert.match(dlg.html, /name="obs" maxlength="300" rows="3" required/); assert.match(dlg.html, /obrigatório/);
    ta.value = '   '; form.onsubmit({ preventDefault() {} });
    assert.match(erroEl.textContent, /Observação inválida/); assert.equal(calls.length, 0);
    ta.value = 'x'.repeat(301); form.onsubmit({ preventDefault() {} }); assert.equal(calls.length, 0);
    ta.value = 'a<b'; form.onsubmit({ preventDefault() {} }); assert.equal(calls.length, 0);
    ta.value = '  porta   fechada  '; form.onsubmit({ preventDefault() {} });
    assert.equal(calls.length, 1); assert.deepEqual(calls[0], { p_cd_pedido: 1530, p_obs: 'porta fechada', p_requisicao: req });
    assert.equal(submit.textContent, 'Salvando…'); assert.equal(submit.disabled, true);
    form.onsubmit({ preventDefault() {} }); assert.equal(calls.length, 1);
    resolver({ data: { status: 'erro', motivo: 'pedido_sem_saida' } }); await new Promise((r) => setImmediate(r));
    assert.match(erroEl.textContent, /ainda não saiu/); assert.equal(submit.disabled, false); assert.equal(submit.textContent, 'Registrar problema');
  } finally { if (orig) Object.defineProperty(globalThis, 'crypto', orig); delete globalThis.document; }
});
test('070 + Problema:true: flag separada, botao so enviado/recebido, Desfazer so admin, sem selo com problema ativo', () => {
  const vm = require('node:vm'), path = require('node:path');
  const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : ['2026-11-27T10:00:00-03:00'])); } }
  const w = { TempRioRotaCore: R, TempRioPrevisao: require('../../js/admin-previsao.js'), TempRioCalendario: require('../../js/admin-calendario.js'), addEventListener() {} };
  vm.runInNewContext(read('js/admin-068-partes.js'), { window: w, Object });
  assert.equal(w.TempRio068Partes.Problema, true);
  assert.equal(w.TempRio068Partes.C, false);
  assert.equal(w.TempRio068Partes.Acoes063, false);
  vm.runInNewContext(read('js/entrega-admin.js'), { window: w, Intl, Date: Clock, Promise });
  const src = read('js/admin.js'), a = src.indexOf('    var PE_COLUNAS ='), b = src.indexOf('    function peFecharLegenda', a);
  const ctx = { window: w, Intl, Date: Clock, Promise, console, sb: {}, papel: 'marca_rota', celular: () => false, localStorage: { getItem: () => null }, esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), icoFa: () => '', infoAtraso: () => null, selosAtraso: () => '', seloAtraso: () => null, cmpCadastros: () => ({}), docDigitos: (x) => x || '', docNorm: (x) => x, geoNorm: (x) => String(x || '').toLowerCase(), brl: String, NUM: new Intl.NumberFormat('pt-BR') };
  const app = vm.runInNewContext(src.slice(a, b) + ';({pe,peRecebidoHtml,peCartaoCompacto,peCartaoDetalhado,setPapel(v){papel=v;}});', ctx);
  const est = (cd, e) => ({ cd_pedido: cd, entregue: e === 'historico', pendente: !['recebido', 'historico'].includes(e), reprogramado: false, data_recebimento: ['recebido', 'historico'].includes(e) ? '2026-11-27' : null, pronto_despacho: e === 'pronto_despacho', estado_070: e, data_saida_marcada: null });
  Object.assign(app.pe, { estadosDia: '2026-11-27', podeMarcar: true, problemas: {}, estadosH: { 1: est(1, 'aberto'), 2: est(2, 'conferido'), 3: est(3, 'pronto_despacho'), 4: est(4, 'recebido'), 5: est(5, 'historico') } });
  const ped = (cd, etapa) => ({ cd_pedido: cd, etapa, dt_pedido: '2026-11-25T10:00:00-03:00', cliente_tipo: 'cnpj', cliente_nome: 'Cliente ' + cd });
  // Aberto, conferido e pronto_despacho NAO mostram botao (SQL exige saida).
  for (const [cd, et] of [[1, 'aberto'], [2, 'conferido'], [3, 'atendido']]) {
    assert.equal(app.peRecebidoHtml(ped(cd, et)), '');
  }
  // Recebido e Historico mantem selo 070 + acrescentam botao Problema, sem acao 063.
  const hRec = app.peRecebidoHtml(ped(4, 'atendido'));
  assert.match(hRec, /<span class="rota-selo">Recebido<\/span>/);
  assert.match(hRec, /data-entrega068-acao="marcar"[^>]*>Problema na entrega/);
  assert.doesNotMatch(hRec, /data-entrega063-acao/);
  const hHist = app.peRecebidoHtml(ped(5, 'atendido'));
  assert.match(hHist, /<span class="rota-selo">Entregue<\/span>/);
  assert.match(hHist, /data-entrega068-acao="marcar"/);
  // Sem permissao: mantem selo 070, sem botao.
  app.pe.podeMarcar = false;
  assert.equal(app.peRecebidoHtml(ped(4, 'atendido')), '<span class="rota-selo">Recebido</span>');
  app.pe.podeMarcar = true;
  // Problema ativo: vermelho + obs escapada, SEM selo Recebido/Entregue; Desfazer so admin.
  app.pe.problemas = { 4: { cd_pedido: 4, obs: 'Recusado <portaria>', por_nome: 'Ana', em: '2026-11-27T09:00:00-03:00' } };
  const hProb = app.peRecebidoHtml(ped(4, 'atendido'));
  assert.match(hProb, /adm-entrega-problema/);
  assert.match(hProb, /Recusado &lt;portaria&gt;/);
  assert.doesNotMatch(hProb, /rota-selo|Recebido|Entregue/);
  assert.doesNotMatch(hProb, /acao="desfazer"|acao="marcar"/);
  assert.match(app.peCartaoCompacto(ped(4, 'atendido')), /is-problema/);
  assert.match(app.peCartaoDetalhado(ped(4, 'atendido'), false), /is-problema/);
  app.setPapel('admin');
  assert.match(app.peRecebidoHtml(ped(4, 'atendido')), /data-entrega068-acao="desfazer"/);
  // Sem 070: pronto_despacho tambem nao mostra botao; enviado e recebido mostram.
  setPartes({ C: false, Problema: true });
  const prontoNao070 = { ...p, dt_saida: '2026-11-25T17:00:00-03:00' };
  assert.doesNotMatch(UI.problemaHtml(prontoNao070, base), /entrega068/);
  assert.match(UI.problemaHtml(p, base), /data-entrega068-acao="marcar"/);
  assert.match(UI.problemaHtml(p, { ...base, canhotos: { 1530: [{ enviado_em: '2026-11-25T17:00:00-03:00' }] } }), /data-entrega068-acao="marcar"/);
  setPartes({ C: false, Problema: false });
  assert.doesNotMatch(UI.problemaHtml(p, base), /entrega068/);
});
test('ligar com Acoes063:false nao fecha dialogo de Problema aberto durante redesenho', () => {
  setPartes({ Acoes063: false, C: false, Problema: true });
  let fechado = 0;
  const botao = { getAttribute: (k) => ({ 'data-entrega068-cd': '1530', 'data-entrega068-acao': 'marcar' })[k], isConnected: true, focus() {} };
  globalThis.document = { createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, close() { fechado++; }, remove() {}, showModal() {}, querySelector: () => ({ focus() {} }), set innerHTML(v) {} }), body: { appendChild() {} } };
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => '33333333-3333-4333-8333-333333333333' }, configurable: true });
  try {
    const el = { querySelectorAll: (s) => (s === '[data-entrega068-cd]' ? [botao] : []) };
    UI.ligar(el, () => ({ ...base, sb: {}, sessao: 1 }));
    botao.onclick({ stopPropagation() {} });
    UI.ligar(el, () => ({ ...base, sb: {}, sessao: 1 }));
    assert.equal(fechado, 0);
    UI.fechar();
    assert.equal(fechado, 1);
  } finally { if (orig) Object.defineProperty(globalThis, 'crypto', orig); delete globalThis.document; }
});
