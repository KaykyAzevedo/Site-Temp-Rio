'use strict';
// 068 D UI: Histórico de pedidos e canhotos em lote por dia (contrato congelado 25e146b2 sobre 070).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

function carregarModulo(opts) {
  opts = opts || {};
  let agora = opts.agora || '2026-11-27T10:00:00-03:00';
  class Clock extends Date {
    constructor(...a) { super(...(a.length ? a : [agora])); }
    static now() { return Date.parse(agora); }
  }
  let uuidSeq = 0, nextTimerId = 0;
  const timers = new Map();
  const fakeSetTimeout = (fn, ms) => { const id = ++nextTimerId; timers.set(id, { id, fn, ms }); return id; };
  const fakeClearTimeout = (id) => { timers.delete(id); };
  const w = {
    TempRio068Partes: opts.partes !== undefined ? opts.partes : { F2: true, A: true, B: false, C: false, D: true, E: false, Acoes063: false, Problema: true },
    TempRioCanhoto: {
      uuid: () => `00000000-0000-4000-8000-00000000000${++uuidSeq}`,
      reduzir: async (f) => ({ size: 1024, type: 'image/jpeg', name: f.name })
    },
    addEventListener() {}
  };
  const src = fs.readFileSync(path.join(__dirname, '../../js/admin-historico-068d.js'), 'utf8');
  vm.runInNewContext(src, { window: w, Date: Clock, Intl, Promise, URL, WeakMap, Object, Array, Set, Number, String, Error, isFinite, Math, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, console });
  return { H: w.TempRioHistorico068D, w, timers, setAgora: (v) => { agora = v; } };
}

function criarAlvo() {
  const listeners = {};
  return {
    isConnected: true,
    classList: { contains: () => false },
    html: '',
    listeners,
    set innerHTML(v) { this.html = v; },
    get innerHTML() { return this.html; },
    contains: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(ev, fn) { listeners[ev] = fn; }
  };
}

test('068D wiring: flag D:true com C:false/Acoes063:false/Problema:true e HTML sem admin-068.js', () => {
  const w = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../js/admin-068-partes.js'), 'utf8'), { window: w, Object });
  assert.equal(w.TempRio068Partes.D, true);
  assert.equal(w.TempRio068Partes.C, false);
  assert.equal(w.TempRio068Partes.Acoes063, false);
  assert.equal(w.TempRio068Partes.Problema, true);
  const html = fs.readFileSync(path.join(__dirname, '../../admin.html'), 'utf8');
  assert.match(html, /data-aba="historicopedidos"/);
  assert.match(html, /id="painel-historicopedidos"/);
  assert.match(html, /src="\.\/js\/admin-historico-068d\.js"/);
  assert.ok(!html.includes('src="./js/admin-068.js"'));
});

test('068D lerHistoricoMes pagina com order dia desc / cd asc nulls last e range', async () => {
  const { H } = carregarModulo();
  const log = [];
  const pagina1 = Array.from({ length: 500 }, (_, i) => ({ dia: '2026-11-26', cd_pedido: i + 1, cliente_nome: 'Cli ' + i, status: 'entregue', data_entrega: '2026-11-26', lote_fotos: 1, cliente_tipo: 'cnpj', valor_centavos: 1000 }));
  const pagina2 = [{ dia: '2026-11-25', cd_pedido: null, cliente_nome: null, status: null, data_entrega: '2026-11-25', lote_fotos: 3, cliente_tipo: null, valor_centavos: null }];
  const sb = {
    rpc(fn, args) {
      log.push({ fn, args, orders: [], range: null });
      const cur = log[log.length - 1];
      const q = {
        order(col, opts) { cur.orders.push([col, opts]); return q; },
        range(a, b) { cur.range = [a, b]; return q; },
        then(ok, bad) { return Promise.resolve({ data: cur.range[0] === 0 ? pagina1 : pagina2 }).then(ok, bad); }
      };
      return q;
    }
  };
  const rows = await H.lerHistoricoMes(sb, '2026-11');
  assert.equal(rows.length, 501);
  assert.equal(log.length, 2);
  const normObj = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(normObj(log[0].args), { p_mes: '2026-11-01' });
  assert.deepEqual(normObj(log[0].orders), [['dia', { ascending: false }], ['cd_pedido', { ascending: true, nullsFirst: false }]]);
  assert.deepEqual(normObj(log[0].range), [0, 499]);
  assert.deepEqual(normObj(log[1].range), [500, 999]);
  await assert.rejects(H.lerHistoricoMes(sb, 'invalido'), /Mês inválido/);
});

test('068D dia so-foto renderiza cabecalho e galeria sem cartao de pedido; XSS escapado', async () => {
  const { H } = carregarModulo();
  const alvo = criarAlvo();
  const linhas = [
    { dia: '2026-11-26', cd_pedido: 1530, cliente_nome: 'Mercado <Script>', status: 'entregue', data_entrega: '2026-11-26', lote_fotos: 2, obs: 'Obs <b>x</b>', por_nome: 'Ana', em: '2026-11-26T15:00:00Z', cliente_tipo: 'cnpj', valor_centavos: 12345 },
    { dia: '2026-11-24', cd_pedido: null, cliente_nome: null, status: null, data_entrega: '2026-11-24', lote_fotos: 4, obs: null, por_nome: null, em: null, cliente_tipo: null, valor_centavos: null }
  ];
  const sb = {
    rpc(fn) {
      if (fn === 'pode_marcar_rota') return Promise.resolve({ data: true });
      const q = { order() { return q; }, range() { return q; }, then(ok, bad) { return Promise.resolve({ data: linhas }).then(ok, bad); } };
      return q;
    }
  };
  H.desenhar(alvo, { sb, papel: 'vendedor' });
  await new Promise((r) => setImmediate(r));
  assert.match(alvo.html, /Mercado &lt;Script&gt;/);
  assert.match(alvo.html, /Obs &lt;b&gt;x&lt;\/b&gt;/);
  assert.match(alvo.html, /data-h068-dia-sec="2026-11-24"/);
  assert.match(alvo.html, /0 pedido\(s\) · 4 canhoto\(s\)/);
  assert.match(alvo.html, /Dia com canhotos em lote \(sem pedidos listados\)/);
  assert.doesNotMatch(alvo.html, /data-h068-pedido="null"/);
  // Nao-admin nunca ve botao Remover
  assert.doesNotMatch(alvo.html, /data-h068-rem-pedir/);
});

test('068D datas permitidas de upload: >=2026-11-23, <=hojeSP e max 365 dias', () => {
  const { H } = carregarModulo({ agora: '2026-11-27T10:00:00-03:00' });
  assert.equal(H.diaUploadValido('2026-11-22', '2026-11-27'), false);
  assert.equal(H.diaUploadValido('2026-11-23', '2026-11-27'), true);
  assert.equal(H.diaUploadValido('2026-11-27', '2026-11-27'), true);
  assert.equal(H.diaUploadValido('2026-11-28', '2026-11-27'), false);
  // Mais de 1 ano depois: limite anda para hoje - 365
  assert.equal(H.minDiaUpload('2028-01-10'), '2027-01-10');
  assert.equal(H.diaUploadValido('2026-12-01', '2028-01-10'), false);
});

test('068D upload lote usa upsert:false, retry sem reupload e trata todos os 5 motivos de erro', async () => {
  const { H } = carregarModulo();
  const alvo = criarAlvo();
  const uploads = [], regCalls = [];
  let falharReg = true;
  const sb = {
    storage: {
      from(b) {
        assert.equal(b, 'canhotos');
        return {
          upload(cam, blob, opts) {
            uploads.push({ cam, opts });
            return Promise.resolve({ data: { path: cam }, error: null });
          }
        };
      }
    },
    rpc(fn, args) {
      if (fn === 'pode_marcar_rota') return Promise.resolve({ data: true });
      if (fn === 'rota_068_historico') {
        const q = { order() { return q; }, range() { return q; }, then(ok, bad) { return Promise.resolve({ data: [] }).then(ok, bad); } };
        return q;
      }
      if (fn === 'rota_068_lote_registrar') {
        regCalls.push(args);
        if (falharReg) return Promise.resolve({ error: { message: 'timeout de rede' } });
        return Promise.resolve({ data: { status: 'ok', registrados: 0, total: 2, repetido: true } });
      }
      return Promise.resolve({ data: [] });
    }
  };
  H.desenhar(alvo, { sb, papel: 'marca_rota' });
  await new Promise((r) => setImmediate(r));

  const f1 = { name: 'a.jpg', type: 'image/jpeg', size: 1000 };
  const f2 = { name: 'b.png', type: 'image/png', size: 2000 };
  await H.enviarLote('2026-11-26', [f1, f2]);
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].opts.upsert, false);
  assert.match(uploads[0].cam, /^lote\/2026-11-26\/[0-9a-f-]+\.jpg$/);
  assert.equal(regCalls.length, 1);
  assert.match(alvo.html, /Tentar registrar novamente/);

  // Retry: NAO reenvia ao Storage, chama apenas rota_068_lote_registrar com mesmos caminhos
  falharReg = false;
  await H.enviarLote('2026-11-26', []);
  assert.equal(uploads.length, 2, 'nao deve reupar arquivos ja enviados');
  assert.equal(regCalls.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(regCalls[1])), JSON.parse(JSON.stringify(regCalls[0])));
  assert.match(alvo.html, /Lote já registrado anteriormente/);

  // Todos os 5 motivos de negocio do contrato
  for (const motivo of ['parametro_invalido', 'arquivo_ausente', 'arquivo_em_expurgo', 'arquivo_expirado', 'arquivo_removido']) {
    await assert.rejects(
      H.registrarLoteDia({ rpc: () => Promise.resolve({ data: { status: 'erro', motivo } }) }, '2026-11-26', ['lote/2026-11-26/00000000-0000-4000-8000-000000000001.jpg']),
      (e) => e.motivo === motivo
    );
  }
});

test('068D signedUrl usa 300s + valida protocolo; remover exige admin e apaga objeto no Storage quando pode_apagar:true', async () => {
  const { H } = carregarModulo();
  const signedCalls = [], removedPaths = [];
  const sb = {
    storage: {
      from(b) {
        assert.equal(b, 'canhotos');
        return {
          createSignedUrl(cam, ttl) {
            signedCalls.push({ cam, ttl });
            return Promise.resolve({ data: { signedUrl: cam.includes('bad') ? 'javascript:alert(1)' : 'https://storage.local/signed?t=1' } });
          },
          remove(list) {
            removedPaths.push(list);
            return Promise.resolve({ data: list, error: null });
          }
        };
      }
    },
    rpc(fn, args) {
      if (fn === 'rota_068_lote_remover') return Promise.resolve({ data: { status: 'ok', alterado: true, pode_apagar: true } });
      if (fn === 'rota_068_lote_listar') return Promise.resolve({ data: [{ caminho: 'lote/2026-11-26/u1.jpg', enviado_em: '2026-11-26T12:00:00Z', enviado_por: 'u' }] });
      if (fn === 'rota_068_rotas_semana') return Promise.resolve({ data: [{ dia: '2026-11-26', foto: { estado: 'fechada', itens: [{ cd_pedido: 1, veiculo_id: 's10' }] } }] });
      return Promise.resolve({ data: [] });
    }
  };
  const url = await H.assinarUrlLote(sb, 'lote/2026-11-26/u1.jpg');
  assert.equal(url, 'https://storage.local/signed?t=1');
  assert.equal(signedCalls[0].ttl, 300);
  await assert.rejects(H.assinarUrlLote(sb, 'lote/2026-11-26/bad.jpg'), /inválido/);

  const resRem = await H.removerFotoLote(sb, 'lote/2026-11-26/u1.jpg');
  assert.equal(resRem.pode_apagar, true);
  assert.equal(resRem.storage_removido, true);
  assert.deepEqual(JSON.parse(JSON.stringify(removedPaths)), [['lote/2026-11-26/u1.jpg']]);

  const sem = await H.lerRotasSemana(sb);
  assert.equal(sem.length, 1);
  assert.equal(sem[0].dia, '2026-11-26');
});

test('068D virada 00h SP recarrega e sair() descarta resposta tardia e limpa DOM', async () => {
  const { H, setAgora } = carregarModulo({ agora: '2026-11-27T23:59:50-03:00' });
  const alvo = criarAlvo();
  let chamadas = 0, resolver;
  const sb = {
    rpc(fn) {
      if (fn === 'pode_marcar_rota') return Promise.resolve({ data: false });
      chamadas++;
      const q = {
        order() { return q; },
        range() { return q; },
        then(ok, bad) {
          if (chamadas === 3) return new Promise((r) => { resolver = r; }).then(ok, bad);
          return Promise.resolve({ data: [] }).then(ok, bad);
        }
      };
      return q;
    }
  };
  H.desenhar(alvo, { sb, papel: 'admin' });
  await new Promise((r) => setImmediate(r));
  assert.equal(chamadas, 1);

  // Mesmo dia: verificarVirada nao recarrega
  H.verificarVirada();
  assert.equal(chamadas, 1);

  // Virou 00h SP: recarrega automaticamente
  setAgora('2026-11-28T00:00:05-03:00');
  H.verificarVirada();
  await new Promise((r) => setImmediate(r));
  assert.equal(chamadas, 2);

  // Resposta tardia apos sair() e descartada
  setAgora('2026-11-29T00:00:05-03:00');
  H.verificarVirada();
  await new Promise((r) => setImmediate(r));
  assert.equal(chamadas, 3);
  H.sair();
  assert.equal(alvo.html, '');
  resolver({ data: [{ dia: '2026-11-28', cd_pedido: 999, cliente_nome: 'Vazado', status: 'entregue', lote_fotos: 0 }] });
  await new Promise((r) => setImmediate(r));
  assert.equal(alvo.html, '');
  assert.equal(H._estado().linhas.length, 0);
});

test('UI068D-R1: timer leve dispara releitura automatica na virada 23:59->00:00 SP sem chamar verificarVirada, reagenda e cancela em pausar()/sair()', async () => {
  const { H, timers, setAgora } = carregarModulo({ agora: '2026-11-27T23:59:55-03:00' });
  const alvo = criarAlvo();
  let leiturasHist = 0;
  const sb = {
    rpc(fn) {
      if (fn === 'pode_marcar_rota') return Promise.resolve({ data: false });
      if (fn === 'rota_068_historico') {
        leiturasHist++;
        const q = { order() { return q; }, range() { return q; }, then(ok, bad) { return Promise.resolve({ data: [] }).then(ok, bad); } };
        return q;
      }
      return Promise.resolve({ data: [] });
    }
  };
  H.desenhar(alvo, { sb, papel: 'admin' });
  await new Promise((r) => setImmediate(r));
  assert.equal(leiturasHist, 1);
  // Agendou 1 timer leve para 00:00:03 SP (5s + 3s = 8000ms)
  assert.equal(timers.size, 1);
  const t1 = Array.from(timers.values())[0];
  assert.equal(t1.ms, 8000);

  // Avanca o relogio para 00:00:03 SP e dispara o timer (SEM chamar verificarVirada manualmente)
  setAgora('2026-11-28T00:00:03-03:00');
  timers.delete(t1.id);
  t1.fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(leiturasHist, 2, 'deve reler automaticamente ao atravessar 00:00 SP em foco');
  // Reagendou para a proxima meia-noite (~86400s)
  assert.equal(timers.size, 1);
  const t2 = Array.from(timers.values())[0];
  assert.ok(t2.ms >= 86395000 && t2.ms <= 86405000, 'reagendado para proxima 00h SP: ' + t2.ms);

  // Troca de tela (pausar) cancela o timer
  H.pausar();
  assert.equal(timers.size, 0);

  // Reabrir reagenda e sair() cancela o timer
  H.desenhar(alvo, { sb, papel: 'admin' });
  assert.equal(timers.size, 1);
  H.sair();
  assert.equal(timers.size, 0);
});
