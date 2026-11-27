'use strict';
// Rotas sem abas "Hoje" e "Próxima": Semana é a tela principal; clicar num dia abre o detalhe mantendo fechar/reabrir/PDF.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const R = require('../functions/_shared/rota-core.js');
const U = require('../../js/admin-previsao.js');
const Q = require('../../js/admin-rota-quadro.js');

function criarAlvo() {
  const listeners = {};
  function btn(sel) {
    return {
      getAttribute(k) { return sel === '[data-rota-vista]' && k === 'data-rota-vista' ? 'semana' : null; },
      addEventListener(ev, fn) { listeners[sel] = fn; }
    };
  }
  return {
    html: '',
    listeners,
    addEventListener() {},
    removeEventListener() {},
    set innerHTML(v) { this.html = v; },
    get innerHTML() { return this.html; },
    querySelector(sel) {
      if (sel === '[data-rota-voltar-semana]' && this.html.includes('data-rota-voltar-semana')) return btn(sel);
      if (sel === '#rota-atualizar' || sel === '#rota-imprimir') return btn(sel);
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '[data-rota-vista]' && this.html.includes('data-rota-vista="semana"')) return [btn(sel)];
      return [];
    }
  };
}

function montarRotas() {
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : ['2026-11-27T10:00:00-03:00'])); } }
  const w = { TempRioRotaCore: R, TempRioRotaQuadro: Q, TempRioPrevisao: U, TempRioCalendario: require('../../js/admin-calendario.js') };
  const ctx = { window: w, Date: Clock, Intl, Promise, console, setTimeout, clearTimeout, setInterval, clearInterval, document: { getElementById: () => null } };
  const src = fs.readFileSync(require.resolve('../../js/admin-rota.js'), 'utf8');
  vm.runInNewContext(src.replace('    raiz.TempRioRota = {', '    raiz.qaSem = { st, desenhar, abrirDetalheDia, aplicarLeituraSemana065 };\n    raiz.TempRioRota = {'), ctx);
  const a = w.qaSem, s = a.st, alvo = criarAlvo();
  const frota = [
    { id: 's10', nome: 'S10', modo: 'porta', ativo: true, capacidade_volume: 2700, dias_sem_saida: [0, 6] },
    { id: 'caminhao', nome: 'CEASA', modo: 'cd_ceasa', ativo: true, capacidade_volume: null, dias_sem_saida: [0] }
  ];
  const ped = (cd) => ({ cd_pedido: cd, etapa: 'atendido', dt_pedido: '2026-11-25T10:00:00-03:00', dt_saida: '2026-11-26T10:00:00-03:00', documento: '11222333000181', cliente_nome: 'Cliente ' + cd, caixas_24: 2 });
  const est = (cd) => ({ cd_pedido: cd, entregue: false, pendente: true, reprogramado: false, data_recebimento: null, pronto_despacho: true, estado_070: 'pronto_despacho', data_saida_marcada: null, origem_data_saida: null, data_rota_reservada: null, historico_em: null });
  Object.assign(s, {
    alvo, ativo: true, carregado: true, v2: true, podeMarcar: true, pln046: true, papel: 'admin',
    sem065: true, fx050: true, frota047: true, frotaLinhas: frota, frota: R.frotaDe(frota),
    cfg: R.cfgDe({ hora_saida: '08:00', feriados_sem_saida: false }), cfgLinha: { hora_saida: '08:00' },
    pedidos: [ped(1), ped(2)], clientes: { '11222333000181': { nome: 'Cliente 1', bairro: 'Centro', cidade: 'Rio de Janeiro', pos: [-22.91, -43.20] } },
    porPedido: { 1: 's10', 2: 'caminhao' }, semanaIni: '2026-11-23', temCaixas: true,
    estadosDia: '2026-11-27', estadosH: { 1: est(1), 2: est(2) }
  });
  a.aplicarLeituraSemana065('2026-11-23', {
    data: {
      status: 'ok', inicio: '2026-11-23', hoje: '2026-11-27', versao: 1,
      itens: [{ cd_pedido: 1, dia: '2026-11-27', veiculo_id: 's10', ordem: 1 }, { cd_pedido: 2, dia: '2026-11-28', veiculo_id: 'caminhao', ordem: 1 }],
      sem_saida: [], fechados: [], pedidos_estado: { 1: est(1), 2: est(2) }
    }
  });
  return { a, s, alvo };
}

test('Rotas remove abas Hoje e Proxima; Semana e a visao principal', () => {
  const { a, s, alvo } = montarRotas();
  assert.equal(s.vista, 'semana');
  a.desenhar();
  assert.match(alvo.html, /data-rota-vista="semana"/);
  assert.doesNotMatch(alvo.html, /data-rota-vista="hoje"|data-rota-vista="proxima"/);
  assert.doesNotMatch(alvo.html, />Hoje ·|>Próxima ·/);
  assert.doesNotMatch(alvo.html, /data-rota-voltar-semana/);
});

test('Clicar no dia de hoje abre detalhe com Fechar, Reabrir e PDF, e Voltar retorna para Semana', () => {
  const { a, s, alvo } = montarRotas();
  a.abrirDetalheDia('2026-11-27');
  assert.equal(s.vista, 'hoje');
  assert.equal(s.diaDetalhe, '2026-11-27');
  assert.match(alvo.html, /aria-current="page">Dia · sexta 27\/11</);
  assert.match(alvo.html, /data-rota-voltar-semana="1"/);
  assert.match(alvo.html, /id="rota-fx-fechar"/);
  assert.match(alvo.html, /data-rota-pdf="s10"/);
  assert.doesNotMatch(alvo.html, /data-rota-vista="hoje"|data-rota-vista="proxima"/);

  // Com rota de hoje fechada: mostra Reabrir (admin) e mantem PDF
  s.fxFoto = { data: '2026-11-27', fechada_em: '2026-11-27T11:00:00Z', fechada_nome: 'Admin', automatico: false, itens: [{ cd_pedido: 1, veiculo_id: 's10', ordem: 1 }] };
  a.desenhar();
  assert.match(alvo.html, /id="rota-fx-reabrir"/);
  assert.match(alvo.html, /data-rota-pdf="s10"/);

  // Voltar para a semana retorna a tela principal
  alvo.listeners['[data-rota-voltar-semana]']();
  assert.equal(s.vista, 'semana');
  assert.equal(s.diaDetalhe, null);
  assert.doesNotMatch(alvo.html, /data-rota-voltar-semana/);
});

test('Clicar em outro dia da semana abre detalhe do dia com PDF e sem abas Hoje/Proxima', () => {
  const { a, s, alvo } = montarRotas();
  a.abrirDetalheDia('2026-11-28');
  assert.equal(s.vista, 'dia');
  assert.equal(s.diaDetalhe, '2026-11-28');
  assert.match(alvo.html, /aria-current="page">Dia · sábado 28\/11</);
  assert.match(alvo.html, /data-rota-voltar-semana="1"/);
  assert.match(alvo.html, /data-rota-pdf="caminhao"/);
  assert.doesNotMatch(alvo.html, /data-rota-vista="hoje"|data-rota-vista="proxima"/);
});
