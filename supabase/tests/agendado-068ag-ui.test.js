'use strict';
// 068AG UI: selo/prioridade/alertas de pedido agendado e coleta explicita do RPC (sem fallback silencioso).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const R = require('../functions/_shared/rota-core.js');
const ler = (f) => fs.readFileSync(path.join(__dirname, '../../', f), 'utf8');
function app(calls) {
  const core = calls ? Object.assign({}, R, { planejar: (...a) => { calls.n++; return R.planejar(...a); }, planejarSemana: (...a) => { calls.n++; return R.planejarSemana(...a); }, sugestoesJuntar: (...a) => { calls.n++; return R.sugestoesJuntar(...a); } }) : R;
  const window = { TempRioRotaCore: core };
  const src = ler('js/admin-rota.js').replace('raiz.TempRioRota = {', 'raiz.__a={st,seloPrazo,htmlAlertasAgendados,htmlAgendadosErro,carregarAgendados,agendadosOk,agBloqueado,desenhar,planejar,optsPlano};raiz.TempRioRota = {');
  vm.runInNewContext(src, { window, Intl, Date, setTimeout, clearTimeout, console });
  const q = window.__a; q.st.ativo = true; q.st.v2 = true; q.st.sessao = 1; q.st.seq = 1;
  q.st.pedidos = [{ cd_pedido: 10, documento: '1', etapa: 'conferido' }, { cd_pedido: 11, documento: '2', etapa: 'conferido' }];
  return q;
}
const AG = (cd, ag) => ({ cd_pedido: cd, agendado: ag, data_agendada: ag ? '2026-12-03' : null, data_ancora: ag ? '2026-12-04' : null, movido_manualmente: false, na_bandeja: false, dia_plano: null });

test('068AG selo: agendado forte, prioridade maxima, risco e texto de encaixe', () => {
  const q = app();
  const h = q.seloPrazo({ agendado: true, dataAgendada: '2026-12-03', prioridadeMaxima: true, alertaAgendadoForte: true, prazo: '2026-12-03', situacao: 'ok' }, true);
  assert.match(h, /Agendado p\/ 03\/12/); assert.match(h, /prioridade máxima/); assert.match(h, /Agendamento em risco/);
  const e = q.seloPrazo({ prazo: '2026-12-02', situacao: 'ok', encaixeAgendado: { cd_pedido: 1, data: '2026-12-03', nome: 'Mercado X', km: 1.2 } }, true);
  assert.match(e, /Agendado qui p\/ Mercado X · a 1,2 km, encaixa na qui/);
  assert.equal(q.seloPrazo({ prazo: '2026-12-02', situacao: 'ok' }, true), '');   // nao agendado: comportamento anterior
});

test('068AG alertas fortes listam motivo, nome e data; sem alertas nao renderiza', () => {
  const q = app();
  assert.equal(q.htmlAlertasAgendados([]), '');
  const h = q.htmlAlertasAgendados([{ cd_pedido: 10, data_agendada: '2026-12-03', dia: '2026-12-04', motivo: 'plano_fora_data' }, { cd_pedido: 11, data_agendada: '2026-12-03', dia: '2026-12-03', motivo: 'capacidade' }]);
  assert.match(h, /role="alert"/); assert.match(h, /#10/); assert.match(h, /plano salvo fora da data agendada/); assert.match(h, /acima da capacidade/);
});

test('068AG coleta: erro do RPC nao some (aviso, sem mapa); sucesso aplica; mapa incompleto nao e usado', async () => {
  const q = app();
  q.st.sb = { rpc: () => Promise.resolve({ error: { message: 'boom' } }) };
  await q.carregarAgendados();
  assert.equal(q.st.agendados, null); assert.match(q.st.agendadosErro, /boom/); assert.match(q.htmlAgendadosErro(), /Agendamentos não carregados/);
  q.st.sb = { rpc: (n, a) => Promise.resolve({ data: a.p_cds.map((cd) => AG(cd, cd === 10)) }) };
  await q.carregarAgendados();
  assert.equal(q.st.agendadosErro, ''); assert.equal(q.st.agendados[10].agendado, true); assert.ok(q.agendadosOk());
  q.st.pedidos.push({ cd_pedido: 12 });   // pedido novo sem agenda lida: core recusaria mapa incompleto
  assert.equal(q.agendadosOk(), undefined);
});

test('068AG planejadores recebem opts.agendados, Definitiva traduz fora_data e cartao da Semana carrega a agenda', () => {
  const r = ler('js/admin-rota.js'), qd = ler('js/admin-rota-quadro.js');
  assert.equal((r.match(/agendados: agendadosOk\(\)/g) || []).length, 4);
  assert.match(r, /pedido_agendado_fora_data/);
  assert.match(r, /dataAgendada: \(st\.agendados/);
  assert.match(qd, /data-rq-agendado/);
});

test('068AG UIAG-R1: agenda em erro bloqueia calculo (nada de fallback da data do cliente) e nunca passa undefined ao core', async () => {
  const calls = { n: 0 }, q = app(calls), st = q.st;
  st.cfg = R.cfgDe({}); st.carregado = true; st.frota047 = false;
  st.alvo = { innerHTML: '', querySelector: (sel) => (sel === 'dialog[open]' ? null : { addEventListener() {} }), querySelectorAll: () => [], addEventListener() {} };
  // 1) leitura ok -> agenda carregada
  st.sb = { rpc: (n, a) => Promise.resolve({ data: a.p_cds.map((cd) => AG(cd, cd === 10)) }) };
  await q.carregarAgendados();
  assert.equal(q.agBloqueado(), false);
  // 2) releitura falha (ex.: 57014) -> mapa some e a tela bloqueia sem chamar planejadores
  st.sb = { rpc: () => Promise.resolve({ error: { code: '57014', message: 'statement timeout' } }) };
  await q.carregarAgendados();
  assert.equal(st.agendados, null); assert.equal(q.agBloqueado(), true);
  calls.n = 0; q.desenhar();
  assert.equal(calls.n, 0);
  assert.match(st.alvo.innerHTML, /Não foi possível ler os agendamentos/); assert.match(st.alvo.innerHTML, /bloqueados/);
  // 3) defesa: nenhuma chamada ao core sem opts.agendados
  assert.throws(() => q.planejar(st.pedidos, {}, '2026-12-03', q.optsPlano()), /Agendamentos indisponíveis/);
  assert.equal(calls.n, 0);
  // 4) carregando (sem erro) tambem bloqueia, e a confirmacao da rota de amanha nao roda
  st.agendadosErro = ''; calls.n = 0; q.desenhar();
  assert.match(st.alvo.innerHTML, /Carregando agendamentos/); assert.equal(calls.n, 0);
  // 5) leitura volta ao normal
  st.sb = { rpc: (n, a) => Promise.resolve({ data: a.p_cds.map((cd) => AG(cd, cd === 10)) }) };
  await q.carregarAgendados();
  assert.equal(q.agBloqueado(), false); assert.ok(q.optsPlano().agendados);
});
