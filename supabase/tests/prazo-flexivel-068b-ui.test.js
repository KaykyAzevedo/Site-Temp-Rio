'use strict';
// 068 B UI: Prazo ideal flexível (contrato congelado 27b0aefe sobre 216d678).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const R = require('../functions/_shared/rota-core.js');
const Cal = require('../../js/admin-calendario.js');
const U = require('../../js/admin-previsao.js');
const Q = require('../../js/admin-rota-quadro.js');

function carregarPrazo(opts) {
  opts = opts || {};
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : [opts.agora || '2026-11-27T10:00:00-03:00'])); } }
  const w = {
    TempRio068Partes: opts.partes !== undefined ? opts.partes : { F2: true, A: true, B: true, C: false, D: true, E: false, Acoes063: false, Problema: true },
    TempRioCalendario: Cal,
    CustomEvent: class { constructor(t) { this.type = t; } },
    dispatchEvent(ev) { if (opts.onEvent) opts.onEvent(ev); }
  };
  const src = fs.readFileSync(path.join(__dirname, '../../js/admin-prazo-068b.js'), 'utf8');
  vm.runInNewContext(src, { window: w, Date: Clock, Intl, Promise, Object, Array, Set, Number, String, Error, isFinite, Math, console });
  return { P: w.TempRioPrazo068B, w };
}

test('068B wiring: flag B:true com C:false/Acoes063:false/D:true/Problema:true e HTML sem admin-068.js', () => {
  const w = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../js/admin-068-partes.js'), 'utf8'), { window: w, Object });
  assert.equal(w.TempRio068Partes.B, true);
  assert.equal(w.TempRio068Partes.C, false);
  assert.equal(w.TempRio068Partes.D, true);
  assert.equal(w.TempRio068Partes.Acoes063, false);
  assert.equal(w.TempRio068Partes.Problema, true);
  const html = fs.readFileSync(path.join(__dirname, '../../admin.html'), 'utf8');
  assert.match(html, /src="\.\/js\/admin-prazo-068b\.js"/);
  assert.ok(!html.includes('src="./js/admin-068.js"'));
});

test('068B lerPrazos pagina em blocos <=2000, deduplica e falha sem publicar parcial', async () => {
  const { P } = carregarPrazo();
  const tamanhos = [];
  const cds = Array.from({ length: 4001 }, (_, i) => i + 1).concat([1, 2]);
  const sbOk = {
    rpc(fn, args) {
      assert.equal(fn, 'rota_068_prazo_ler');
      tamanhos.push(args.p_cds.length);
      return Promise.resolve({ data: args.p_cds.map((cd) => ({ cd_pedido: cd, prazo_ideal: '2026-12-01', origem: 'padrao', travado: false })) });
    }
  };
  const res = await P.lerPrazos(sbOk, cds);
  assert.deepEqual(tamanhos, [2000, 2000, 1]);
  assert.equal(Object.keys(res.porPedido).length, 4001);

  let chamadas = 0;
  const sbFalha = {
    rpc(fn, args) {
      chamadas++;
      if (chamadas === 2) return Promise.resolve({ error: { code: '57014', message: 'timeout bloco 2' } });
      return Promise.resolve({ data: args.p_cds.map((cd) => ({ cd_pedido: cd, prazo_ideal: '2026-12-01' })) });
    }
  };
  await assert.rejects(P.lerPrazos(sbFalha, cds), /timeout bloco 2/);
  chamadas = 0;
  const tudoFalha = await P.lerTudo({ rpc: (fn, a) => fn === 'rota_068_prazo_padrao_ler' ? Promise.resolve({ data: { status: 'ok', prazo_ideal_dias: 2, prazo_dias_uteis_semana: [1, 2, 3, 4, 5] } }) : fn === 'rota_068_regras_prazo' ? Promise.resolve({ data: [] }) : sbFalha.rpc(fn, a) }, cds);
  assert.deepEqual(Object.keys(tudoFalha.prazos), [], 'falha em bloco nao publica mapa parcial');
  assert.match(tudoFalha.erro, /timeout|57014|ler/);
});

test('068B htmlCard respeita row.travado (Historico), permissao e atraso', () => {
  const { P } = carregarPrazo();
  const ped = { cd_pedido: 1530, documento: '11222333000181' };
  const rowEdit = { cd_pedido: 1530, prazo_ideal: '2026-12-02', origem: 'excecao_pedido', atraso_dias: 2, travado: false };
  const hEdit = P.htmlCard(ped, { instalada: true, podeMarcar: true, prazos: { 1530: rowEdit } });
  assert.match(hEdit, /Meta ·/);
  assert.match(hEdit, /02\/12\/2026/);
  assert.match(hEdit, /\(exceção\)/);
  assert.match(hEdit, /\+2d/);
  assert.match(hEdit, /data-prazo068-cd="1530"/);
  assert.match(hEdit, />Alterar meta</);

  // Pedido no Historico (travado:true): sem botao de edicao
  const hTrav = P.htmlCard(ped, { instalada: true, podeMarcar: true, prazos: { 1530: { ...rowEdit, travado: true } } });
  assert.match(hTrav, /02\/12\/2026/);
  assert.doesNotMatch(hTrav, /data-prazo068-cd/);

  // Sem permissao (vendedor): somente leitura
  const hLeitor = P.htmlCard(ped, { instalada: true, podeMarcar: false, papel: 'vendedor', prazos: { 1530: rowEdit } });
  assert.doesNotMatch(hLeitor, /data-prazo068-cd/);
});

test('068B salvarPrazo/remover/salvarPadrao validam motivo, cobrem todos motivos de erro e nunca fazem upsert 040', async () => {
  const { P } = carregarPrazo();
  const calls = [];
  const sb = {
    from() { throw new Error('nunca deve usar DML/upsert 040 para prazo'); },
    rpc(fn, args) {
      calls.push([fn, JSON.parse(JSON.stringify(args))]);
      return Promise.resolve({ data: { status: 'ok', cd_pedido: 1530, prazo_ideal: '2026-12-05', origem: 'excecao_pedido', prazo_ideal_dias: 3, prazo_dias_uteis_semana: [1, 2, 3, 4, 5, 6] } });
    }
  };
  await assert.rejects(P.salvarPrazo(sb, { p_cd_pedido: 1530, p_tipo: 'dias_uteis', p_dias: 3, p_escopo: 'pedido', p_motivo: '   ' }), /motivo/i);
  await assert.rejects(P.salvarPrazo(sb, { p_cd_pedido: 1530, p_tipo: 'dias_uteis', p_dias: 3, p_escopo: 'pedido', p_motivo: 'x<script>' }), /motivo/i);

  await P.salvarPrazo(sb, { p_cd_pedido: 1530, p_tipo: 'dias_uteis', p_dias: 3, p_escopo: 'pedido', p_motivo: '  Pedido   combinado  ' });
  await P.removerExcecao(sb, 1530, 'voltar padrao');
  await P.removerRegra(sb, '11222333000181', null);
  await P.salvarPadrao(sb, 3, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(calls[0], ['rota_068_prazo_salvar', { p_cd_pedido: 1530, p_tipo: 'dias_uteis', p_dias: 3, p_data: null, p_escopo: 'pedido', p_motivo: 'Pedido combinado', p_regra_dias_semana: null }]);
  assert.deepEqual(calls[1], ['rota_068_prazo_remover_excecao', { p_cd_pedido: 1530, p_motivo: 'voltar padrao' }]);
  assert.deepEqual(calls[2], ['rota_068_prazo_remover_regra', { p_documento: '11222333000181', p_motivo: null }]);
  assert.deepEqual(calls[3], ['rota_068_prazo_padrao_salvar', { p_dias: 3, p_dias_uteis_semana: [1, 2, 3, 4, 5, 6] }]);

  for (const motivo of ['parametro_invalido', 'motivo_invalido', 'pedido_nao_encontrado', 'pedido_historico', 'cliente_sem_documento', 'dia_sem_saida', 'prazo_indisponivel']) {
    await assert.rejects(
      P.salvarPrazo({ rpc: () => Promise.resolve({ data: { status: 'erro', motivo } }) }, { p_cd_pedido: 1, p_tipo: 'dias_uteis', p_dias: 2, p_motivo: 'ok' }),
      (e) => e.motivo === motivo
    );
  }
});

test('068B calendario de prazo usa rota_068_calendario_veiculo + dias_prazo + permitirDomingo no TempRioCalendario', async () => {
  const { P } = carregarPrazo();
  const calls = [];
  const calResp = {
    status: 'ok',
    veiculo_id: 's10',
    hoje: '2026-11-27',
    prazo_dias_uteis_semana: [0, 1, 2, 3, 4, 5],
    dias_sem_saida: [0, 6],
    feriados_sem_saida: true,
    feriados: ['2026-11-20'],
    sem_saida_avulso: [],
    dias_prazo: [
      { dia: '2026-11-26', habilitado: false, motivo: 'dia_passado' },
      { dia: '2026-11-27', habilitado: true, motivo: null },
      { dia: '2026-11-28', habilitado: false, motivo: 'dia_nao_util' },
      { dia: '2026-11-29', habilitado: true, motivo: null },
      { dia: '2026-11-30', habilitado: false, motivo: 'feriado' }
    ]
  };
  const sb = { rpc(fn, args) { calls.push([fn, JSON.parse(JSON.stringify(args))]); return Promise.resolve({ data: calResp }); } };
  const d = await P.lerCalendarioPrazo(sb, 's10', '2026-11-27');
  assert.deepEqual(calls[0], ['rota_068_calendario_veiculo', { p_veiculo: 's10', p_de: '2026-11-01', p_ate: '2026-11-30' }]);

  const permitirDom = d.prazo_dias_uteis_semana.includes(0);
  const htmlComDom = Cal.html({ chave: 'prazo068-1', mes: '2026-11-01', hoje: d.hoje, min: d.hoje, permitirDomingo: permitirDom, indisponivel: (iso) => P.motivoCalendario(iso, d) });
  // Hoje (27/11) e Domingo habilitado (29/11) ficam clicaveis; 28/11 (dia_nao_util) e 30/11 (feriado) ficam disabled
  assert.doesNotMatch(htmlComDom.match(/<button[^>]*data-cal-dia="2026-11-27"[^>]*>/)[0], / disabled/);
  assert.doesNotMatch(htmlComDom.match(/<button[^>]*data-cal-dia="2026-11-29"[^>]*>/)[0], / disabled/);
  assert.match(htmlComDom.match(/<button[^>]*data-cal-dia="2026-11-28"[^>]*>/)[0], / disabled/);
  assert.match(htmlComDom.match(/<button[^>]*data-cal-dia="2026-11-30"[^>]*>/)[0], / disabled/);

  // Sem domingo nos dias uteis do prazo: domingo fica bloqueado
  const htmlSemDom = Cal.html({ chave: 'prazo068-1', mes: '2026-11-01', hoje: d.hoje, min: d.hoje, permitirDomingo: false, indisponivel: (iso) => P.motivoCalendario(iso, d) });
  assert.match(htmlSemDom.match(/<button[^>]*data-cal-dia="2026-11-29"[^>]*>/)[0], / disabled/);
});

test('068B Rotas propaga opts.prazos + opts.regrasPrazo aos 3 planejadores e exibe Prazo padrao para pode_marcar_rota (sem exigir admin)', () => {
  const { P } = carregarPrazo();
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : ['2026-11-27T10:00:00-03:00'])); } }
  const calls = [], spy = { ...R };
  for (const n of ['planejar', 'planejarSemana', 'sugestoesJuntar']) {
    spy[n] = function (...a) { calls.push({ n, opts: a.at(-1) }); return R[n](...a); };
  }
  const w = { TempRioRotaCore: spy, TempRioRotaQuadro: Q, TempRioPrevisao: U, TempRioCalendario: Cal, TempRioPrazo068B: P };
  const ctx = { window: w, Date: Clock, Intl, Promise, console, setTimeout, clearTimeout, setInterval, clearInterval, document: { getElementById: () => null } };
  const src = fs.readFileSync(path.join(__dirname, '../../js/admin-rota.js'), 'utf8');
  vm.runInNewContext(src.replace('    raiz.TempRioRota = {', '    raiz.qaB = { st, optsPlano, planos, calcularJuntar, desenhar, aplicarLeituraSemana065 };\n    raiz.TempRioRota = {'), ctx);
  const a = w.qaB, s = a.st;
  const alvo = { html: '', addEventListener() {}, removeEventListener() {}, set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; }, querySelector: (sel) => (sel === '#rota-atualizar' || sel === '#rota-imprimir' ? { addEventListener() {} } : null), querySelectorAll: () => [] };
  const frota = [{ id: 's10', nome: 'S10', modo: 'porta', ativo: true, capacidade_volume: 2700, dias_sem_saida: [0, 6] }];
  const ped = { cd_pedido: 1, etapa: 'atendido', dt_pedido: '2026-11-25T10:00:00-03:00', documento: '11222333000181', caixas_24: 1 };
  const est = { cd_pedido: 1, entregue: false, pendente: true, reprogramado: false, data_recebimento: null, pronto_despacho: true, estado_070: 'pronto_despacho', data_saida_marcada: null, origem_data_saida: null, data_rota_reservada: null, historico_em: null };
  const prazosMock = { 1: { cd_pedido: 1, prazo_ideal: '2026-12-03', origem: 'excecao_pedido' } };
  const regrasMock = { '11222333000181': { documento: '11222333000181', tipo: 'dias_uteis', dias: 4 } };
  Object.assign(s, {
    alvo, ativo: true, carregado: true, v2: true, podeMarcar: true, pln046: true, papel: 'vendedor',
    sem065: true, frota047: true, frotaLinhas: frota, frota: R.frotaDe(frota), cfg: R.cfgDe({}), cfgLinha: {},
    pedidos: [ped], clientes: {}, porPedido: { 1: 's10' }, semanaIni: '2026-11-23',
    estadosDia: '2026-11-27', estadosH: { 1: est },
    prazo068Instalada: true, prazos068: prazosMock, regrasPrazo068: regrasMock, padraoPrazo068: { prazo_ideal_dias: 3, prazo_dias_uteis_semana: [1, 2, 3, 4, 5] }
  });
  a.aplicarLeituraSemana065('2026-11-23', { data: { status: 'ok', inicio: '2026-11-23', hoje: '2026-11-27', versao: 1, itens: [{ cd_pedido: 1, dia: '2026-11-27', veiculo_id: 's10', ordem: 1 }], sem_saida: [], fechados: [], pedidos_estado: { 1: est } } });

  // Dispara planejar (previsao e definitiva), planejarSemana e sugestoesJuntar
  s.modo070 = 'previsao'; a.desenhar();
  s.modo070 = 'definitiva'; a.planos();
  a.calcularJuntar(a.planos().hoje, {});
  for (const n of ['planejar', 'planejarSemana', 'sugestoesJuntar']) {
    const c = calls.find((x) => x.n === n);
    assert.ok(c, 'deve chamar ' + n);
    assert.equal(c.opts.prazos, prazosMock);
    assert.equal(c.opts.regrasPrazo, regrasMock);
  }
  assert.ok(calls.some((x) => x.n === 'planejar' && x.opts.modo_planejamento === 'definitiva' && x.opts.prazos === prazosMock));
  // Botao Meta padrao aparece para pode_marcar_rota mesmo sem papel admin; Configurar continua so admin
  assert.match(alvo.html, /id="rota-prazo-padrao"[^>]*>.*Meta padrão/);
  assert.match(alvo.html, /meta de 2 dias úteis/);
  assert.doesNotMatch(alvo.html, /id="rota-configurar"/);
});
