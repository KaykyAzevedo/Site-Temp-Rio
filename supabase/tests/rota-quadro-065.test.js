'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const R = require('../functions/_shared/rota-core.js');
const Q = require('../../js/admin-rota-quadro.js');

test('065 quadro: semana atual marca passado/hoje como somente leitura e dias futuros com saida como editaveis', () => {
    const st = Q.normalizarEstado(Q.dadosExemplo());
    assert.equal(st.inicio, '2026-11-23');
    assert.equal(st.fim, '2026-11-28');
    assert.equal(st.hoje, '2026-11-25');
    // Strada inativa (ativo: false) nao entra na lista de veiculos ativos nem no filtro
    assert.deepEqual(st.veiculos.map(v => v.id), ['s10', 'caminhao']);
    assert.ok(!Q.html(st).includes('data-rq-veic-filtro="strada"'));
    const porDia = Object.fromEntries(st.dias.map(d => [d.dia, d]));
    assert.equal(porDia['2026-11-23'].editavel, false);
    assert.equal(porDia['2026-11-23'].leituraMotivo, 'passado');
    assert.equal(porDia['2026-11-24'].editavel, false);
    assert.equal(porDia['2026-11-24'].leituraMotivo, 'passado');
    assert.equal(porDia['2026-11-25'].editavel, false);
    assert.equal(porDia['2026-11-25'].leituraMotivo, 'fechada');
    assert.equal(porDia['2026-11-26'].editavel, true);
    assert.equal(porDia['2026-11-27'].editavel, true);
    assert.equal(porDia['2026-11-28'].editavel, true);
    // Quinta 26/11 tem S10 (277/300 cx24 = 92%) + CEASA (150 cx24) -> dentro da capacidade da S10
    assert.equal(porDia['2026-11-26'].excesso, false);
    // Sexta 27/11 passa de 300 cx24 na S10 (367/300 = 122%) -> excesso sinalizado
    assert.equal(porDia['2026-11-27'].excesso, true);
    assert.ok(porDia['2026-11-27'].ocupacaoPct > 100);
});

test('065 quadro: ordem por (dia, veiculo) e null para cd_ceasa; sabado aceita caminhao e recusa S10; sem_saida avulso bloqueia', () => {
    const st = Q.normalizarEstado(Q.dadosExemplo());
    const qui = st.dias.find(d => d.dia === '2026-11-26');
    const s10Qui = qui.cartoes.filter(c => c.veiculo === 's10');
    const camQui = qui.cartoes.filter(c => c.veiculo === 'caminhao');
    assert.deepEqual(s10Qui.map(c => c.ordem), [1, 2, 3]);
    assert.deepEqual(camQui.map(c => c.ordem), [null]);

    // Tentar programar pedido S10 no sabado (S10 nao sai sabado) -> recusado
    const recSab = Q.aplicarAcao(st, { tipo: 'programar', cd_pedido: 1534, dia: '2026-11-28', veiculo: 's10' });
    assert.equal(recSab.ok, false);
    assert.match(recSab.motivo, /não sai neste dia/i);

    // Programar para o caminhao no sabado -> aceito com ordem null
    const okSab = Q.aplicarAcao(st, { tipo: 'programar', cd_pedido: 1556, dia: '2026-11-28', veiculo: 'caminhao' });
    assert.equal(okSab.ok, true);
    const sab = okSab.estado.dias.find(d => d.dia === '2026-11-28');
    const novo = sab.cartoes.find(c => c.cd_pedido === 1556);
    assert.ok(novo);
    assert.equal(novo.veiculo, 'caminhao');
    assert.equal(novo.ordem, null);

    // sem_saida avulso na quinta 26/11 para s10 bloqueia programar s10 na quinta
    const comSemSaida = Q.normalizarEstado(Object.assign({}, Q.dadosExemplo(), {
        sem_saida: [{ dia: '2026-11-26', veiculo_id: 's10', motivo: 'oficina' }]
    }));
    const recSemSaida = Q.aplicarAcao(comSemSaida, { tipo: 'programar', cd_pedido: 1534, dia: '2026-11-26', veiculo: 's10' });
    assert.equal(recSemSaida.ok, false);
    assert.match(recSemSaida.motivo, /não sai neste dia/i);
    assert.ok(Q.html(comSemSaida).includes('S10 sem saída (oficina)'));
});

test('065 quadro: programar, mover, remover e montarPayloadSalvar envia SO dias editaveis com versao_base', () => {
    let st = Q.normalizarEstado(Q.dadosExemplo());
    // Recusa mexer em dia passado ou hoje
    assert.equal(Q.aplicarAcao(st, { tipo: 'remover', cd_pedido: 1510, deDia: '2026-11-23' }).ok, false);
    assert.equal(Q.aplicarAcao(st, { tipo: 'programar', cd_pedido: 1534, dia: '2026-11-25', veiculo: 's10' }).ok, false);

    // Programar #1534 da bandeja para sexta 27/11 na pos 1
    let r = Q.aplicarAcao(st, { tipo: 'programar', cd_pedido: 1534, dia: '2026-11-27', veiculo: 's10', ordem: 1 });
    assert.equal(r.ok, true);
    st = r.estado;
    assert.equal(st.dias.find(d => d.dia === '2026-11-27').cartoes[0].cd_pedido, 1534);
    assert.ok(!st.bandeja.some(c => c.cd_pedido === 1534));

    // Mover #1539 de quinta 26/11 para sexta 27/11
    r = Q.aplicarAcao(st, { tipo: 'mover', cd_pedido: 1539, deDia: '2026-11-26', paraDia: '2026-11-27', veiculo: 's10' });
    assert.equal(r.ok, true);
    st = r.estado;
    assert.ok(!st.dias.find(d => d.dia === '2026-11-26').cartoes.some(c => c.cd_pedido === 1539));
    assert.ok(st.dias.find(d => d.dia === '2026-11-27').cartoes.some(c => c.cd_pedido === 1539));

    // Remover #1543 de quinta 26/11 para a bandeja
    r = Q.aplicarAcao(st, { tipo: 'remover', cd_pedido: 1543, deDia: '2026-11-26' });
    assert.equal(r.ok, true);
    st = r.estado;
    const rem = st.bandeja.find(c => c.cd_pedido === 1543);
    assert.ok(rem);
    assert.equal(rem.origemDia, 'removido');
    assert.equal(rem.diaAnterior, '2026-11-26');

    const payload = Q.montarPayloadSalvar(st);
    assert.equal(payload.inicio, '2026-11-23');
    assert.equal(payload.versao_base, 3);
    // Contrato Forja: nenhum item de dia nao editavel (<= hoje 2026-11-25) pode ir no payload!
    assert.ok(payload.itens.every(i => i.dia > '2026-11-25'), 'somente dias > hoje entram no payload');
    assert.ok(!payload.itens.some(i => [1510, 1512, 1518, 1521, 1528, 1531].includes(i.cd_pedido)));
    const itRem = payload.itens.find(i => i.cd_pedido === 1543);
    assert.deepEqual(itRem, { cd_pedido: 1543, dia: '2026-11-26', veiculo_id: 's10', ordem: null, removido: true });
    const itCam = payload.itens.find(i => i.cd_pedido === 1552);
    assert.deepEqual(itCam, { cd_pedido: 1552, dia: '2026-11-28', veiculo_id: 'caminhao', ordem: null, removido: false });
});

test('065 quadro: HTML escapa XSS em cliente, bairro, cidade, mensagem e janela', () => {
    const dados = Q.dadosExemplo();
    dados.msg = '<script>alert(1)</script>';
    dados.bandeja[0].cliente = 'Mercado <img src=x onerror=alert(1)>';
    dados.bandeja[0].bairro = '<b>Centro</b>';
    const html = Q.html(dados);
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('<b>Centro</b>'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('065 integracao admin-rota.js: rota_065_ler_semana, rota_063_ler_entregas (Recebido some da bandeja), salvar, versao_antiga e fallback 047', async () => {
    const src = fs.readFileSync(require.resolve('../../js/admin-rota.js'), 'utf8');
    const hook = '    raiz.qa065 = { st, carregar, montarDadosQuadro065, salvarSemana065, marcarSemSaida065, semanaAlvo }; desenhar = function(){};\n    raiz.TempRioRota = {';
    class Clock extends Date {
        constructor(...a) { super(...(a.length ? a : ['2026-11-25T14:00:00-03:00'])); }
    }
    const sandbox = {
        window: { TempRioRotaCore: R, TempRioRotaQuadro: Q },
        Intl, Date: Clock, Promise, setTimeout, clearTimeout, setInterval, clearInterval, console
    };
    vm.runInNewContext(src.replace('    raiz.TempRioRota = {', hook), sandbox);
    const { st, carregar, montarDadosQuadro065, salvarSemana065, marcarSemSaida065, semanaAlvo } = sandbox.window.qa065;

    // Quarta 25/11 -> semanaAlvo() abre a semana ATUAL (seg 23/11)
    assert.equal(semanaAlvo(), '2026-11-23');

    const pedidos = [
        { cd_pedido: 2001, documento: '12000000002001', cliente_nome: 'Cliente Programado Qui', etapa: 'aberto', dt_pedido: '2026-11-24T10:00:00-03:00', caixas_24: 40, caixas_48: 0, caixas_outras: 0 },
        { cd_pedido: 2002, documento: '12000000002002', cliente_nome: 'Cliente Bandeja', etapa: 'aberto', dt_pedido: '2026-11-24T11:00:00-03:00', caixas_24: 30, caixas_48: 0, caixas_outras: 0 },
        { cd_pedido: 2003, documento: '12000000002003', cliente_nome: 'Cliente Recebido 063', etapa: 'atendido', dt_pedido: '2026-11-23T09:00:00-03:00', dt_saida: '2026-11-24T16:00:00-03:00', caixas_24: 20, caixas_48: 0, caixas_outras: 0 },
        { cd_pedido: 2004, documento: '12000000002004', cliente_nome: 'Box Ceasa Sabado', etapa: 'aberto', dt_pedido: '2026-11-25T09:00:00-03:00', caixas_24: 100, caixas_48: 0, caixas_outras: 0 }
    ];
    const T = {
        solidcon_pedidos_erp: pedidos,
        solidcon_pedidos_erp_sync: [{ coletado_em: '2026-11-25T13:55:00-03:00' }],
        rota_config: [{ id: 1, hora_saida: '08:00', canhoto_desde: '2026-01-01T00:00:00Z' }],
        rota_cliente_veiculo: [
            { documento: '12000000002001', veiculo: 's10' },
            { documento: '12000000002002', veiculo: 's10' },
            { documento: '12000000002003', veiculo: 's10' },
            { documento: '12000000002004', veiculo: 'caminhao' }
        ],
        rota_pedido_veiculo: [],
        rota_cliente_regras: [],
        rota_pedido_ignorado: [],
        rota_plano_semana: [],
        rota_veiculos: [
            { id: 's10', nome: 'S10', modo: 'porta', capacidade_volume: 2700, dias_sem_saida: [0, 6], ativo: true, ordem: 10, cor: '#2563eb' },
            { id: 'caminhao', nome: 'Caminhão (CEASA)', modo: 'cd_ceasa', capacidade_volume: null, dias_sem_saida: [0], ativo: true, ordem: 20, cor: '#b45309' },
            { id: 'strada', nome: 'Strada', modo: 'porta', capacidade_volume: null, dias_sem_saida: [0, 6], ativo: false, ordem: 30, cor: '#059669' }
        ],
        rota_saida: [],
        rota_saida_progresso: [],
        pedido_canhoto: [],
        solidcon_clientes: [
            { documento: '12000000002001', nome: 'Cliente Programado Qui', bairro: 'Tijuca', cidade: 'Rio de Janeiro' },
            { documento: '12000000002002', nome: 'Cliente Bandeja', bairro: 'Penha', cidade: 'Rio de Janeiro' },
            { documento: '12000000002003', nome: 'Cliente Recebido 063', bairro: 'Centro', cidade: 'Rio de Janeiro' },
            { documento: '12000000002004', nome: 'Box Ceasa Sabado', bairro: 'Irajá', cidade: 'Rio de Janeiro' }
        ]
    };

    const chamadasRpc = [];
    let respSalvar065 = { data: { status: 'ok', versao: 6, itens: 2 } };
    st.ativo = true;
    st.papel = 'admin';
    st.sb = {
        from(t) {
            const q = {
                select() { return q; }, in() { return q; }, order() { return q; }, gte() { return q; },
                is() { return q; }, eq() { return q; }, limit() { return q; }, range() { return q; },
                then(ok, er) { return Promise.resolve({ data: T[t] || [], error: null }).then(ok, er); }
            };
            return q;
        },
        rpc(n, args) {
            chamadasRpc.push([n, args]);
            if (n === 'solidcon_mapa_clientes') return this.from('solidcon_mapa_clientes');
            if (n === 'pode_marcar_rota') return Promise.resolve({ data: true, error: null });
            if (n === 'rota_050_ler') return Promise.resolve({ data: null, error: null });
            if (n === 'rota_063_ler_entregas') {
                // #2003 foi confirmado manualmente pelo botao Recebido (063)
                return Promise.resolve({
                    data: [{ cd_pedido: 2003, id: 77, confirmado_em: '2026-11-25T12:00:00-03:00', confirmado_nome: 'Márcio' }],
                    error: null
                });
            }
            if (n === 'rota_065_ler_semana') {
                return Promise.resolve({
                    data: {
                        status: 'ok',
                        inicio: '2026-11-23',
                        hoje: '2026-11-25',
                        versao: 5,
                        itens: [
                            { cd_pedido: 2001, dia: '2026-11-26', veiculo_id: 's10', ordem: 1, removido: false },
                            { cd_pedido: 2003, dia: '2026-11-26', veiculo_id: 's10', ordem: 2, removido: false },
                            { cd_pedido: 2004, dia: '2026-11-28', veiculo_id: 'caminhao', ordem: null, removido: false }
                        ],
                        sem_saida: [],
                        fechados: ['2026-11-25']
                    },
                    error: null
                });
            }
            if (n === 'rota_065_salvar_semana') return Promise.resolve(respSalvar065);
            if (n === 'rota_065_marcar_sem_saida') return Promise.resolve({ data: { status: 'ok', versao: 7, devolvidos: [2001] }, error: null });
            if (n === 'rota_047_salvar_semana') return Promise.resolve({ data: 1, error: null });
            return Promise.resolve({ data: [], error: null });
        }
    };

    carregar();
    for (let i = 0; st.carregando && i < 50; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(st.erro, null);
    assert.equal(st.carregado, true);
    assert.equal(st.sem065, true);

    const quadroDados = montarDadosQuadro065('2026-11-23');
    const stQuadro = Q.normalizarEstado(quadroDados);
    assert.equal(stQuadro.versaoBase, 5);

    // #2003 foi marcado Recebido na 063 -> NAO aparece na quinta 26/11 nem na bandeja!
    const todosCartoesDias = Array.from(stQuadro.dias).flatMap(d => Array.from(d.cartoes).map(c => c.cd_pedido));
    const todosCartoesBandeja = Array.from(stQuadro.bandeja).map(c => c.cd_pedido);
    assert.ok(!todosCartoesDias.includes(2003), 'pedido Recebido 063 some dos dias do quadro');
    assert.ok(!todosCartoesBandeja.includes(2003), 'pedido Recebido 063 some da bandeja');
    assert.ok(todosCartoesDias.includes(2001), '#2001 programado na quinta');
    assert.ok(todosCartoesDias.includes(2004), '#2004 programado no sabado (caminhao)');
    assert.deepEqual(todosCartoesBandeja, [2002], '#2002 pendente sem dia fica na bandeja');

    // Salvar semana via 065
    const payload = Q.montarPayloadSalvar(stQuadro);
    salvarSemana065(payload, false);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(st.sem065Dados['2026-11-23'].versao, 6);
    assert.equal(st.semVersaoConflito, false);

    // Conflito versao_antiga -> ativa banner de conflito sem mesclar
    respSalvar065 = { data: { status: 'erro', motivo: 'versao_antiga' } };
    salvarSemana065(payload, false);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(st.semVersaoConflito, true);
    assert.equal(st.semMsgErro, true);
    assert.match(st.msgSemana, /Outro usuário salvou/i);

    // Marcar sem saida na quinta 26/11 para s10 -> devolve #2001 para a bandeja e sobe versao para 7
    st.semVersaoConflito = false;
    marcarSemSaida065({ dia: '2026-11-26', veiculo_id: 's10', sem_saida: true, versao_base: 6, motivo: 'manutenção' });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(st.sem065Dados['2026-11-23'].versao, 7);
    const aposSemSaida = Q.normalizarEstado(montarDadosQuadro065('2026-11-23'));
    assert.ok(aposSemSaida.bandeja.some(c => c.cd_pedido === 2001), '#2001 voltou para a bandeja');

    // Fallback para rota_047_salvar_semana quando 065 ainda nao estiver aplicada (PGRST202):
    // com apenas itens de veiculo porta (s10), chama rota_047_salvar_semana so para s10 e nunca para caminhao.
    respSalvar065 = { error: { code: 'PGRST202', message: 'Could not find the function public.rota_065_salvar_semana' } };
    const payloadSoPorta = { inicio: '2026-11-23', versao_base: 7, itens: [{ cd_pedido: 2001, dia: '2026-11-27', veiculo_id: 's10', ordem: 1, removido: false }] };
    salvarSemana065(payloadSoPorta, false);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(st.sem065, false);
    assert.ok(chamadasRpc.some(c => c[0] === 'rota_047_salvar_semana' && c[1].p_veiculo === 's10'), 'caiu no fallback rota_047_salvar_semana para s10');
    assert.ok(!chamadasRpc.some(c => c[0] === 'rota_047_salvar_semana' && c[1].p_veiculo === 'caminhao'), 'nunca chama rota_047_salvar_semana para caminhao');
});

test('065 regressoes Sentinela UI065-R1..R6: versao base imutavel, rota fechada anterior fora da bandeja, sem_saida preserva rascunho, logout invalida callbacks, filtro S10->Caminhao no sabado e fallback 047 seguro', async () => {
    const ini = '2026-11-23', seg = '2026-11-23', qui = '2026-11-26', sex = '2026-11-27', sab = '2026-11-28';
    const frota = [
        { id: 's10', nome: 'S10', modo: 'porta', capacidade_volume: 2700, dias_sem_saida: [0, 6], ativo: true },
        { id: 'caminhao', nome: 'Caminhao', modo: 'cd_ceasa', dias_sem_saida: [0], ativo: true }
    ];
    function criarApp() {
        const src = fs.readFileSync(require.resolve('../../js/admin-rota.js'), 'utf8');
        class Clock extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-25T14:00:00-03:00'])); } }
        const ctx = { window: { TempRioRotaCore: R, TempRioRotaQuadro: Q }, Intl, Date: Clock, Promise, setTimeout, clearTimeout, setInterval, clearInterval, console };
        const hook = '    raiz.qa = {st,aplicarLeituraSemana065,montarDadosQuadro065,salvarSemana065,marcarSemSaida065,carregarSemana065}; desenhar=function(){};\n    raiz.TempRioRota = {';
        vm.runInNewContext(src.replace('    raiz.TempRioRota = {', hook), ctx);
        const a = ctx.window.qa, s = a.st;
        Object.assign(s, {
            ativo: true, v2: true, podeMarcar: true, pln046: true, papel: 'admin',
            frota047: true, frotaLinhas: frota, frota: R.frotaDe(frota),
            cfg: R.cfgDe({ hora_saida: '08:00', canhoto_desde: '2026-01-01T00:00Z' }),
            cfgLinha: { hora_saida: '08:00' }, pedidos: [], clientes: {}, sem065: true
        });
        s.sb = { rpc: () => Promise.resolve({ data: { status: 'ok', versao: 3, devolvidos: [] } }) };
        return { ...a, publica: ctx.window.TempRioRota };
    }
    function pedido(cd, extra = {}) {
        return { cd_pedido: cd, documento: '1200000000' + String(cd).padStart(4, '0'), cliente_nome: 'QA ' + cd, etapa: 'aberto', dt_pedido: '2026-11-24T10:00:00-03:00', caixas_24: 1, ...extra };
    }
    function item(cd, dia, veiculo_id = 's10', ordem = 1) {
        return { cd_pedido: cd, dia, veiculo_id, ordem, removido: false };
    }
    function ler(a, versao, itens, semIni = ini) {
        a.aplicarLeituraSemana065(semIni, { data: { status: 'ok', inicio: semIni, hoje: '2026-11-25', versao, itens, sem_saida: [], fechados: [], pedidos_estado:Object.fromEntries(a.st.pedidos.map(p=>[p.cd_pedido,{entregue:false,pendente:true,reprogramado:false}])) } });
    }
    function todos(q) {
        return Array.from(q.dias).flatMap(d => Array.from(d.cartoes).map(c => ({ cd: c.cd_pedido, dia: d.dia })))
            .concat(Array.from(q.bandeja).map(c => ({ cd: c.cd_pedido, dia: null })));
    }

    // R1/R3 mantêm os testes de rascunhos (sugestões). Movimentos H são pontuais, testados em068-movimento-calendario.
    // --- UI065-R1: versaoBase do rascunho imutavel + conflito sinalizado ao ler versao diferente (inclusive ida e volta de semana) ---
    {
        const a = criarApp();
        a.st.pedidos = [pedido(2001), pedido(2002)];
        ler(a, 1, [item(2001, qui)]);
        const r = Q.aplicarAcao(Q.normalizarEstado({...a.montarDadosQuadro065(ini),movimentoAtomico:false}), { tipo: 'mover', cd_pedido: 2001, paraDia: sex });
        assert.equal(r.ok, true);
        a.st.semQuadroRasc[ini] = r.estado;

        // Ida e volta de semana mantendo o rascunho na v1
        ler(a, 1, [], '2026-11-30');
        await a.carregarSemana065('2026-11-30', false);
        assert.equal(a.st.semVersaoConflito, false);

        // Outra sessao salva v2 na semana 2026-11-23 incluindo #2002 no sabado/caminhao
        ler(a, 2, [item(2001, qui), item(2002, sab, 'caminhao', null)], ini);
        const estadoReconstruido = Q.normalizarEstado(a.montarDadosQuadro065(ini));
        assert.equal(estadoReconstruido.versaoBase, 1, 'R1: versaoBase do rascunho permanece 1 (imutavel)');
        assert.equal(estadoReconstruido.versaoConflito, true, 'R1: conflito de versao sinalizado imediatamente');
        assert.equal(estadoReconstruido.podeEditar, false, 'R1: edicao bloqueada ate recarregar/descartar');
        const payload = Q.montarPayloadSalvar(estadoReconstruido);
        assert.equal(payload.versao_base, 1, 'R1: payload nunca adota versao_base=2 sobre snapshot antigo');
    }

    // --- H substitui UI065-R2 por decisão explícita do dono: 059/data/ERP não bloqueiam, só flag Histórico. ---
    {
        const a=criarApp();
        a.st.pedidos=[pedido(1535,{etapa:'atendido',dt_saida:'2026-11-23T10:00:00-03:00'}),pedido(1531),pedido(1536)];
        a.st.diasSaida={1535:'2026-11-23',1531:'2026-11-24',1536:'2026-11-25'};
        ler(a,1,[item(1535,seg)]);
        let q=Q.normalizarEstado(a.montarDadosQuadro065(ini));
        const p=q.dias.flatMap(d=>d.cartoes).find(c=>c.cd_pedido===1535);
        assert.ok(p,'H: conserva origem passada mesmo com059');assert.equal(p.entregue,false);assert.equal(p.bloqueado,false);
        let r=Q.aplicarAcao(q,{tipo:'mover',cd_pedido:1535,paraDia:qui,veiculo:'s10'});
        assert.equal(r.ok,true);assert.equal(r.pontual.dia,qui,'H: mudança pede RPC pontual, não salva065 origem');
        assert.equal(q.dias.flatMap(d=>d.cartoes).find(c=>c.cd_pedido===1535).dia,seg,'H: nada de mudança otimista antes da RPC');
        assert.ok(q.bandeja.some(c=>c.cd_pedido===1531),'H: problema/recebidoHoje não somem só por059');
        a.aplicarLeituraSemana065(ini,{data:{status:'ok',inicio:ini,hoje:'2026-11-25',versao:2,itens:[item(1535,seg)],sem_saida:[],fechados:[],pedidos_estado:{1535:{entregue:true,pendente:false},1531:{entregue:false,pendente:true},1536:{entregue:false,pendente:true}}}});
        q=Q.normalizarEstado(a.montarDadosQuadro065(ini));
        assert.ok(!todos(q).some(c=>c.cd===1535),'H: Histórico confirmado não entra em pendentes');
        assert.equal(Q.aplicarAcao(q,{tipo:'mover',cd_pedido:1535,paraDia:qui,veiculo:'s10'}).ok,false,'H: recusa Histórico');
    }

    // --- UI065-R3: marcar "nao sai nesta data" preserva rascunho dos demais dias/veiculos e devolve apenas afetados ---
    {
        const a = criarApp();
        a.st.pedidos = [pedido(2001), pedido(2004)];
        ler(a, 1, [item(2001, qui, 's10', 1), item(2004, sab, 'caminhao', null)]);
        let q = Q.normalizarEstado({...a.montarDadosQuadro065(ini),movimentoAtomico:false});
        // Move #2001 de quinta para sexta no rascunho
        a.st.semQuadroRasc[ini] = Q.aplicarAcao(q, { tipo: 'mover', cd_pedido: 2001, paraDia: sex, veiculo: 's10' }).estado;

        // Marca caminhao sem saida no sabado -> #2001 continua na sexta no rascunho e #2004 volta para a bandeja
        a.marcarSemSaida065({ dia: sab, veiculo_id: 'caminhao', sem_saida: true, versao_base: 1 });
        await new Promise(ok => setImmediate(ok));
        assert.ok(a.st.semQuadroRasc[ini], 'R3: rascunho preservado');
        let mapa = todos(a.montarDadosQuadro065(ini));
        assert.equal(mapa.find(c => c.cd === 2001).dia, sex, 'R3: movimento nao salvo de #2001 para sexta preservado');
        assert.equal(mapa.find(c => c.cd === 2004).dia, null, 'R3: #2004 do caminhao no sabado devolvido para a bandeja');

        // Reativar saida do caminhao no sabado tambem preserva o rascunho de #2001 na sexta E desbloqueia a coluna de sabado para reprogramar #2004 (UI065-R3-A)
        a.marcarSemSaida065({ dia: sab, veiculo_id: 'caminhao', sem_saida: false, versao_base: 3 });
        await new Promise(ok => setImmediate(ok));
        const qReativado = Q.normalizarEstado(a.montarDadosQuadro065(ini));
        mapa = todos(qReativado);
        assert.equal(mapa.find(c => c.cd === 2001).dia, sex, 'R3: reativacao preserva rascunho de #2001 na sexta');
        const colSabReativado = qReativado.dias.find(d => d.dia === sab);
        assert.equal(colSabReativado.editavel, true, 'R3-A: coluna de sabado volta a ficar editavel apos reativar saida');
        assert.deepEqual(Object.keys(colSabReativado.semSaidaVeiculos), [], 'R3-A: semSaidaVeiculos limpo na coluna reativada');
        const reprog2004 = Q.aplicarAcao({...qReativado,movimentoAtomico:false}, { tipo: 'programar', cd_pedido: 2004, paraDia: sab, veiculo: 'caminhao' });
        assert.equal(reprog2004.ok, true, 'R3-A: permite reprogramar #2004 no sabado/caminhao imediatamente apos reativar');
        const mapaFinalR3 = todos(reprog2004.estado);
        assert.equal(mapaFinalR3.find(c => c.cd === 2001).dia, sex, 'R3-A: #2001 segue na sexta');
        assert.equal(mapaFinalR3.find(c => c.cd === 2004).dia, sab, 'R3-A: #2004 voltou para o sabado');
    }

    // --- UI065-R4: resposta de gravacao apos logout (ou troca de sessao) e descartada ---
    {
        const a = criarApp();
        a.st.pedidos = [pedido(2001)];
        ler(a, 1, [item(2001, qui)]);
        let resolveSalvar, resolveSemSaida;
        a.st.sb = { rpc: (n) => new Promise(ok => { if (n === 'rota_065_salvar_semana') resolveSalvar = ok; else resolveSemSaida = ok; }) };

        a.salvarSemana065({ inicio: ini, versao_base: 1, itens: [item(2001, sex)] }, false);
        a.publica.sair();
        assert.equal(Object.keys(a.st.sem065Dados).length, 0);
        resolveSalvar({ data: { status: 'ok', versao: 2, itens: 1 } });
        await new Promise(ok => setImmediate(ok));
        assert.equal(Object.keys(a.st.sem065Dados).length, 0, 'R4: sem065Dados permanece vazio apos logout');
        assert.equal(a.st.plano[2001], undefined, 'R4: st.plano permanece limpo apos logout');

        // Sair + entrar como outro usuario antes da resposta de marcarSemSaida065
        a.st.ativo = true;
        a.st.podeMarcar = true;
        a.st.v2 = true;
        a.st.pln046 = true;
        a.st.sb = { rpc: () => new Promise(ok => { resolveSemSaida = ok; }) };
        a.marcarSemSaida065({ dia: sab, veiculo_id: 'caminhao', sem_saida: true, versao_base: 1 });
        a.publica.sair();
        // Novo usuario entra
        a.st.ativo = true;
        a.st.sb = { rpc: () => Promise.resolve({ data: null }) };
        resolveSemSaida({ data: { status: 'ok', versao: 9, devolvidos: [] } });
        await new Promise(ok => setImmediate(ok));
        assert.equal(Object.keys(a.st.sem065Dados).length, 0, 'R4: callback da sessao anterior nao contamina nova sessao');
    }

    // --- UI065-R5: trocar filtro Todos -> S10 -> Caminhao -> Todos recalcula sabado editavel e desbloqueia cartoes ---
    {
        let s = Q.normalizarEstado(Q.dadosExemplo());
        const col = () => s.dias.find(d => d.dia === sab);
        assert.equal(col().editavel, true);
        s = Q.normalizarEstado({ ...s, veiculoAtual: 's10' });
        assert.equal(col().editavel, false);
        assert.equal(col().leituraMotivo, 'sem_saida');
        s = Q.normalizarEstado({ ...s, veiculoAtual: 'caminhao' });
        assert.equal(col().editavel, true, 'R5: sabado volta a ser editavel no filtro caminhao');
        assert.equal(col().leituraMotivo, null);
        assert.ok(col().cartoes.every(c => !c.bloqueado), 'R5: cartoes do caminhao no sabado nao ficam bloqueados');
        const r = Q.aplicarAcao(s, { tipo: 'programar', cd_pedido: 1556, paraDia: sab, veiculo: 'caminhao' });
        assert.equal(r.ok, true, 'R5: aceita programar pedido no caminhao para sabado apos trocar filtro');
        s = Q.normalizarEstado({ ...r.estado, veiculoAtual: 'todos' });
        assert.equal(col().editavel, true);
    }

    // --- UI065-R6: fallback 047 nao envia caminhao (cd_ceasa), preserva dias <= hoje e recusa cd_ceasa sem gravacao parcial ---
    {
        const a = criarApp();
        a.st.pedidos = [pedido(1510), pedido(2001)];
        a.st.plano = { 1510: seg, 2001: qui };
        a.st.planoVeic = { 1510: 's10', 2001: 's10' };
        ler(a, 1, [item(1510, seg, 's10', 1), item(2001, qui, 's10', 1)]);
        const chamadas = [], gravados = [];
        a.st.sb = {
            rpc(n, p) {
                chamadas.push({ n, p });
                if (n === 'rota_065_salvar_semana') {
                    return Promise.resolve({ error: { code: 'PGRST202', message: 'Could not find the function public.rota_065_salvar_semana' } });
                }
                if (n === 'rota_047_salvar_semana' && p.p_veiculo === 'caminhao') {
                    return Promise.resolve({ error: { code: '22023', message: 'parametro invalido' } });
                }
                if (n === 'rota_047_salvar_semana') gravados.push(p);
                return Promise.resolve({ data: 2 });
            }
        };
        a.salvarSemana065({ inicio: ini, versao_base: 1, itens: [item(2001, sex, 's10', 1)] }, false);
        await new Promise(ok => setImmediate(ok));
        assert.ok(!chamadas.some(c => c.n === 'rota_047_salvar_semana' && c.p.p_veiculo === 'caminhao'), 'R6: nunca chama 047 para caminhao');
        assert.equal(gravados.length, 1);
        assert.equal(gravados[0].p_veiculo, 's10');
        // Preserva o item de segunda 23/11 (somente leitura, <= hoje) junto com o novo de sexta 27/11
        assert.deepEqual(JSON.parse(JSON.stringify(gravados[0].p_itens)), [{ cd_pedido: 1510, dia: seg }, { cd_pedido: 2001, dia: sex }], 'R6: preserva dia <= hoje no fallback 047');
        assert.equal(a.st.semMsgErro, false);
        assert.equal(a.st.plano[1510], seg);
        assert.equal(a.st.plano[2001], sex);

        // Se tentar salvar item de caminhao (cd_ceasa) sem a 065 aplicada, recusa antes de chamar 047 (zero gravacao parcial)
        chamadas.length = 0;
        gravados.length = 0;
        a.salvarSemana065({ inicio: ini, versao_base: 1, itens: [item(2001, sex, 's10', 1), item(2004, sab, 'caminhao', null)] }, false);
        await new Promise(ok => setImmediate(ok));
        assert.equal(gravados.length, 0, 'R6: nenhuma gravacao parcial quando ha item cd_ceasa sem 065');
        assert.equal(a.st.semMsgErro, true);
        assert.match(a.st.msgSemana, /migração 065/i);
    }
});

test('066 assistente e mapa: linha deposito->paradas->deposito por dia/veiculo, pedido sem geo fora da linha, aviso Atrasa X dia(s), chips Aceitar/Ignorar e Sugerir semana no rascunho', async () => {
    let st = Q.normalizarEstado(Q.dadosExemplo());

    // 1. Mapa: linhas por (dia, veiculo) saem do deposito, passam pelas paradas na ordem do dia e voltam ao deposito
    const rm0 = Q.calcularRotasMapa(st);
    const linhaQuiS10 = rm0.linhas.find(l => l.chave === '2026-11-26|s10');
    assert.ok(linhaQuiS10, 'linha da S10 na quinta existe');
    assert.deepEqual(linhaQuiS10.pontos[0], rm0.origem, 'inicia no deposito');
    assert.deepEqual(linhaQuiS10.pontos[linhaQuiS10.pontos.length - 1], rm0.origem, 'retorna ao deposito');
    assert.deepEqual(linhaQuiS10.paradas.map(p => p.cd_pedido), [1536, 1539, 1543], 'paradas na ordem do dia');

    // Cores distintas por dia/veiculo
    const linhaSexS10 = rm0.linhas.find(l => l.chave === '2026-11-27|s10');
    const linhaQuiCam = rm0.linhas.find(l => l.chave === '2026-11-26|caminhao');
    assert.notEqual(linhaQuiS10.cor, linhaSexS10.cor, 'cor por dia diferente');
    assert.notEqual(linhaQuiS10.cor, linhaQuiCam.cor, 'cor por veiculo diferente no mesmo dia');

    // Pedido sem geo (#1545 pos: null): ao programar para quinta, tem selo "Sem localizacao" e fica fora da linha do mapa
    const rSemGeo = Q.aplicarAcao(st, { tipo: 'programar', cd_pedido: 1545, dia: '2026-11-26', veiculo: 's10' });
    assert.equal(rSemGeo.ok, true);
    const card1545 = rSemGeo.estado.dias.find(d => d.dia === '2026-11-26').cartoes.find(c => c.cd_pedido === 1545);
    assert.equal(card1545.semGeo, true);
    const rmAposSemGeo = rSemGeo.estado.rotasMapa;
    const linhaQuiApos = rmAposSemGeo.linhas.find(l => l.chave === '2026-11-26|s10');
    assert.ok(!linhaQuiApos.paradas.some(p => p.cd_pedido === 1545), 'pedido sem geo fica fora da polyline');
    assert.ok(linhaQuiApos.semGeoCds.includes(1545), 'registrado em semGeoCds do dia/veiculo');
    assert.ok(Q.html(rSemGeo.estado).includes('data-rq-sem-geo="1545"'), 'icone/selo Sem localizacao renderizado');

    // 2. Aviso de atraso: cartao programado em dia DEPOIS do prazo ganha "Atrasa X dia(s)" e contador no topo da coluna
    // #1534 tem prazo 2026-11-24; programado em 2026-11-27 -> atrasa 3 dias
    const rAtr = Q.aplicarAcao(st, { tipo: 'programar', cd_pedido: 1534, dia: '2026-11-27', veiculo: 's10' });
    assert.equal(rAtr.ok, true);
    const colSex = rAtr.estado.dias.find(d => d.dia === '2026-11-27');
    const card1534 = colSex.cartoes.find(c => c.cd_pedido === 1534);
    assert.equal(card1534.atrasado, true);
    assert.equal(card1534.atrasoDias, 3);
    assert.equal(colSex.atrasados, 2, 'contador no topo da coluna soma #1546 (1 dia) + #1534 (3 dias)');
    const htmlAtr = Q.html(rAtr.estado);
    assert.ok(htmlAtr.includes('Atrasa 3 dias'), 'selo vermelho Atrasa 3 dias no cartao');
    assert.ok(htmlAtr.includes('Atrasa 1 dia'), 'selo vermelho Atrasa 1 dia em #1536/#1546');
    assert.ok(htmlAtr.includes('data-rq-contador-atraso="2"'), 'contador de atrasos no topo da coluna');

    // 3. Sugestoes (stub do contrato 066): chips com Aceitar/Ignorar e botao "Sugerir semana" (pre-preenche rascunho sem salvar)
    const stub066 = Q.gerarStubSugestoes066(st);
    assert.ok(Array.isArray(stub066.pedidos) && stub066.pedidos.length > 0, 'stub 066 gera sugestoes por pedido');
    assert.ok(Array.isArray(stub066.dias) && stub066.dias.length > 0, 'stub 066 gera folgas por dia/veiculo');
    assert.ok(Array.isArray(stub066.encaixes) && stub066.encaixes.length > 0, 'stub 066 gera encaixes de proximidade/capacidade');

    // Ignorar sugestao de #1534 remove o chip daquele pedido
    const rIgn = Q.aplicarAcao(st, { tipo: 'ignorar_sugestao', cd_pedido: 1534, dia: '2026-11-26' });
    assert.equal(rIgn.ok, true);
    assert.ok(!Q.html(rIgn.estado).includes('data-rq-sug-cartao="1534"'), 'chip ignorado some do cartao');

    // Aceitar sugestao programa o pedido no rascunho
    const sug1540 = stub066.pedidos.find(p => p.cd_pedido === 1540);
    assert.ok(sug1540);
    const rAc = Q.aplicarAcao(st, { tipo: 'aceitar_sugestao', cd_pedido: 1540, dia: sug1540.dia_sugerido, veiculo: sug1540.veiculo_sugerido });
    assert.equal(rAc.ok, true);
    assert.equal(rAc.estado.temRascunho, true);
    assert.ok(rAc.estado.dias.find(d => d.dia === sug1540.dia_sugerido).cartoes.some(c => c.cd_pedido === 1540));

    // Botao "Sugerir semana" pre-preenche o rascunho com todas as sugestoes nao ignoradas
    const rSugSem = Q.aplicarSugestoesSemana(st);
    assert.equal(rSugSem.ok, true);
    assert.ok(rSugSem.aplicados.length >= 3, 'pre-preencheu sugestoes da bandeja no rascunho');
    assert.equal(rSugSem.estado.temRascunho, true);

    // 4. Integracao admin-rota.js: abre direto na Semana (st.vista === 'semana'), clicando num dia abre o detalhe e Voltar = Semana
    const src = fs.readFileSync(require.resolve('../../js/admin-rota.js'), 'utf8');
    class Clock066 extends Date { constructor(...a) { super(...(a.length ? a : ['2026-11-25T14:00:00-03:00'])); } }
    const ctx = { window: { TempRioRotaCore: R, TempRioRotaQuadro: Q }, Intl, Date: Clock066, Promise, setTimeout, clearTimeout, setInterval, clearInterval, console };
    const hook = '    raiz.qa066 = { st, abrirDetalheDia, registrarFeedback066, aplicarLeituraSugestoes066 }; desenhar = function(){};\n    raiz.TempRioRota = {';
    vm.runInNewContext(src.replace('    raiz.TempRioRota = {', hook), ctx);
    const { st: stRota, abrirDetalheDia, registrarFeedback066, aplicarLeituraSugestoes066 } = ctx.window.qa066;
    assert.equal(stRota.vista, 'semana', 'aba Rotas abre direto na Semana por padrao');
    abrirDetalheDia('2026-11-27');
    assert.equal(stRota.diaDetalhe, '2026-11-27');
    assert.notEqual(stRota.vista, 'semana', 'clicar num dia abre o detalhe daquele dia');

    const fbChamadas = [];
    stRota.ativo = true; stRota.v2 = true; stRota.pln046 = true; stRota.podeMarcar = true;
    stRota.sb = { rpc: (n, a) => { fbChamadas.push({ n, a }); return Promise.resolve({ data: { ok: true } }); } };
    aplicarLeituraSugestoes066('2026-11-23', {
        data: {
            versao: 2,
            pedidos: [{ cd_pedido: 2002, dia_sugerido: '2026-11-26', veiculo_sugerido: 's10', motivo: ['mesma_regiao'], texto: 'Vence sex — sugerido qui', score: 90, prazo: '2026-11-27', atrasado_se_dia: '2026-11-28' }],
            dias: [],
            encaixes: []
        }
    });
    assert.equal(stRota.sug066, true);
    await registrarFeedback066(2002, 'aceita', '2026-11-26');
    assert.equal(fbChamadas.length, 1);
    assert.equal(fbChamadas[0].n, 'rota_066_registrar');
    assert.deepEqual(JSON.parse(JSON.stringify(fbChamadas[0].a)), { p_cd: 2002, p_acao: 'aceita', p_dia: '2026-11-26' });
});

test('066 regressoes Sentinela UI066-R1..R2 e contrato real Forja: detalhe do dia reflete quadro (quinta/sexta, ordem manual, caminhao, passado), mapa cd_ceasa com 1 parada no CD e soma rascunho em dias', () => {
    const frota = [
        { id: 's10', nome: 'S10', modo: 'porta', capacidade_volume: 2700, dias_sem_saida: [0, 6], ativo: true },
        { id: 'caminhao', nome: 'Caminhao', modo: 'cd_ceasa', capacidade_volume: null, dias_sem_saida: [0], ativo: true }
    ];

    // --- UI066-R2: modo cd_ceasa agrega cartoes em 1 unica parada no CD CEASA, mesmo com posicoes distintas ou sem geo ---
    {
        const cdComGeo = Q.normalizarEstado({
            inicio: '2026-11-23',
            hoje: '2026-11-25',
            veiculos: frota,
            sem_saida: [],
            dias: [{
                dia: '2026-11-26',
                cartoes: [
                    { cd_pedido: 10, cliente: 'CD A', veiculo: 'caminhao', pos: [-22.83, -43.37], c24: 1 },
                    { cd_pedido: 11, cliente: 'CD B', veiculo: 'caminhao', pos: [-22.88, -43.30], c24: 1 }
                ]
            }],
            bandeja: []
        });
        const mapa1 = Q.calcularRotasMapa(cdComGeo);
        assert.equal(mapa1.linhas.length, 1);
        assert.equal(mapa1.linhas[0].paradas.length, 1, 'R2: caminhao gera exatamente 1 parada no CD CEASA');
        assert.deepEqual(mapa1.linhas[0].paradas[0].pos, R.ROTA.CEASA_CENTRO, 'R2: coordenada canonica do CD CEASA');
        assert.deepEqual(mapa1.linhas[0].pontos, [R.ROTA.ORIGEM, R.ROTA.CEASA_CENTRO, R.ROTA.ORIGEM], 'R2: linha deposito -> CD CEASA -> deposito');

        // Mesmo quando clientes do caminhao nao tem geo individual, a linha para o CD CEASA permanece intacta
        const cdSemGeo = Q.normalizarEstado({
            inicio: '2026-11-23',
            hoje: '2026-11-25',
            veiculos: frota,
            sem_saida: [],
            dias: [{
                dia: '2026-11-28',
                cartoes: [
                    { cd_pedido: 12, cliente: 'Box Sem Pino 1', veiculo: 'caminhao', pos: null, c24: 10 },
                    { cd_pedido: 13, cliente: 'Box Sem Pino 2', veiculo: 'caminhao', pos: null, c24: 20 }
                ]
            }],
            bandeja: []
        });
        const mapa2 = Q.calcularRotasMapa(cdSemGeo);
        assert.equal(mapa2.linhas.length, 1, 'R2: linha do caminhao nao some quando cliente nao tem geo');
        assert.equal(mapa2.linhas[0].paradas.length, 1);
        assert.deepEqual(mapa2.linhas[0].paradas[0].pos, R.ROTA.CEASA_CENTRO);
        assert.equal(mapa2.semGeo.length, 0, 'R2: cartao cd_ceasa usa o CD e nao entra como semGeo');
    }

    // --- UI066-R1: abrirDetalheDia alimenta o detalhe pelo plano/rascunho do dia selecionado (quinta, sexta, ordem manual, caminhao, dia passado) ---
    {
        const src = fs.readFileSync(require.resolve('../../js/admin-rota.js'), 'utf8');
        const begin = src.indexOf('        var oDia = optsPlano();');
        const end = src.indexOf('        // 050: o plano desenhado', begin);
        assert.ok(begin > 0 && end > begin);
        const calculoDetalhe = src.slice(begin, end);
        class Clock extends Date { constructor(...a) { super(...(a.length ? a : ['2026-11-25T14:00:00-03:00'])); } }
        const hook = `    raiz.qaR1={st,aplicarLeituraSemana065,montarDadosQuadro065,abrirDetalheDia,atual:function(){var pl=planos();${calculoDetalhe}return atual;}};desenhar=function(){};\n    raiz.TempRioRota = {`;
        const ctx = { window: { TempRioRotaCore: R, TempRioRotaQuadro: Q }, Date: Clock, Intl, Promise, setTimeout, clearTimeout, setInterval, clearInterval, console };
        vm.runInNewContext(src.replace('    raiz.TempRioRota = {', hook), ctx);
        const a = ctx.window.qaR1, s = a.st;
        const p = (cd, extra = {}) => ({ cd_pedido: cd, documento: '1200000000' + String(cd), cliente_nome: 'Cliente ' + cd, etapa: 'conferido', dt_pedido: '2026-11-24T10:00:00-03:00', caixas_24: 10, ...extra });

        Object.assign(s, {
            ativo: true, v2: true, podeMarcar: true, pln046: true, papel: 'admin',
            frota047: true, frotaLinhas: frota, frota: R.frotaDe(frota),
            cfg: R.cfgDe({ hora_saida: '08:00', feriados_sem_saida: false, canhoto_desde: '2026-01-01T00:00Z' }),
            cfgLinha: { hora_saida: '08:00' },
            pedidos: [p(3000), p(3001), p(3002), p(3003), p(3004)],
            clientes: {}, sem065: true, fx050: true, fxFoto: { data: '2026-11-25', itens: [] },
            porPedido: { 3000: 's10', 3001: 's10', 3002: 's10', 3003: 's10', 3004: 'caminhao' }
        });
        // 3001 mais perto da sede (-23.00,-43.32) que 3003 (-22.85,-43.20), mas testaremos ordem manual inversa [3003, 3001]
        s.clientes['12000000003000'] = { nome: 'Cliente 3000 Seg', bairro: 'Irajá', cidade: 'Rio', pos: [-22.83, -43.32] };
        s.clientes['12000000003001'] = { nome: 'Cliente 3001 Qui Perto', bairro: 'Barra', cidade: 'Rio', pos: [-22.99, -43.33] };
        s.clientes['12000000003002'] = { nome: 'Cliente 3002 Sex', bairro: 'Centro', cidade: 'Rio', pos: [-22.90, -43.18] };
        s.clientes['12000000003003'] = { nome: 'Cliente 3003 Qui Longe', bairro: 'Tijuca', cidade: 'Rio', pos: [-22.92, -43.23] };
        s.clientes['12000000003004'] = { nome: 'Box 3004 Sab', bairro: 'Irajá', cidade: 'Rio', pos: [-22.8269, -43.34] };

        a.aplicarLeituraSemana065('2026-11-23', {
            data: {
                status: 'ok', inicio: '2026-11-23', hoje: '2026-11-25', versao: 1,
                itens: [
                    { cd_pedido: 3000, dia: '2026-11-23', veiculo_id: 's10', ordem: 1, removido: false },
                    { cd_pedido: 3003, dia: '2026-11-26', veiculo_id: 's10', ordem: 1, removido: false },
                    { cd_pedido: 3001, dia: '2026-11-26', veiculo_id: 's10', ordem: 2, removido: false },
                    { cd_pedido: 3002, dia: '2026-11-27', veiculo_id: 's10', ordem: 1, removido: false },
                    { cd_pedido: 3004, dia: '2026-11-28', veiculo_id: 'caminhao', ordem: null, removido: false }
                ],
                sem_saida: [], fechados: ['2026-11-25']
            }
        });

        // 1) Sexta 27/11: quadro tem so [3002] -> detalhe tem so [3002] (nao mistura 3001/3003 de quinta!)
        a.abrirDetalheDia('2026-11-27');
        assert.deepEqual(Array.from(R.itensDaRota(a.atual()).map(x => x.cd_pedido)), [3002], 'R1: detalhe de sexta contem apenas #3002');

        // 2) Quinta 26/11: preserva ordem manual [3003, 3001] definida no quadro
        a.abrirDetalheDia('2026-11-26');
        assert.deepEqual(Array.from(R.itensDaRota(a.atual()).map(x => x.cd_pedido)), [3003, 3001], 'R1: detalhe de quinta preserva conjunto e ordem manual [3003, 3001]');

        // 3) Sabado 28/11 (caminhao / cd_ceasa): detalhe contem apenas #3004 no caminhao
        a.abrirDetalheDia('2026-11-28');
        const detSab = R.itensDaRota(a.atual());
        assert.deepEqual(JSON.parse(JSON.stringify(detSab)), [{ cd_pedido: 3004, veiculo_id: 'caminhao', ordem: 1 }], 'R1: detalhe de sabado traz #3004 no caminhao');

        // 4) Dia passado (Segunda 23/11): reconstitui #3000 e marca somente leitura
        a.abrirDetalheDia('2026-11-23');
        const plSeg = a.atual();
        assert.deepEqual(Array.from(R.itensDaRota(plSeg).map(x => x.cd_pedido)), [3000], 'R1: detalhe de dia passado reconstitui #3000');
        assert.equal(plSeg.somenteLeituraDia, true, 'R1: dia passado permanece somente leitura');
    }

    // --- Contrato real 066 (Forja): soma rascunho em dias (folga_cx) e move pedido atrasado (dia_plano / atrasa_no_plano) em Sugerir semana ---
    {
        const base = Q.normalizarEstado({
            inicio: '2026-11-23',
            hoje: '2026-11-25',
            veiculos: frota,
            dias: [
                { dia: '2026-11-26', cartoes: [{ cd_pedido: 4001, cliente: 'Cli Qui', veiculo: 's10', c24: 100, prazo: '2026-11-26' }] },
                { dia: '2026-11-27', cartoes: [{ cd_pedido: 4002, cliente: 'Cli Atrasado Sex', veiculo: 's10', c24: 50, prazo: '2026-11-26' }] }
            ],
            bandeja: [
                { cd_pedido: 4003, cliente: 'Cli Bandeja', veiculo: 's10', c24: 40, prazo: '2026-11-27' }
            ],
            sugestoes: {
                status: 'ok',
                semana: '2026-11-23',
                hoje: '2026-11-25',
                versao: 0,
                pedidos: [
                    { cd_pedido: 4002, dia_sugerido: '2026-11-26', veiculo_sugerido: 's10', motivo: ['prazo', 'atrasa_no_plano'], texto: 'Atrasa na sex — sugerido qui', score: 92, prazo: '2026-11-26', atrasado_se_dia: '2026-11-27', dia_plano: '2026-11-27' },
                    { cd_pedido: 4003, dia_sugerido: null, veiculo_sugerido: null, motivo: ['sem_dia_de_saida'], texto: 'Sem dia de saída disponível', score: 10, prazo: '2026-11-27', atrasado_se_dia: '2026-11-28', dia_plano: null }
                ],
                dias: [
                    { dia: '2026-11-26', veiculo_id: 's10', cx_planejadas: 50, cx_capacidade: 300, paradas: 1, folga_cx: 250, paradas_max: 10, folga_paradas: 9 }
                ],
                encaixes: []
            }
        });
        assert.equal(base.versaoBase, 0, 'preserva versao zero');
        assert.equal(base.sugestoes.versao, 0, 'preserva versao zero nas sugestoes');
        assert.equal(base.sugestoes.invalida, false);
        // O rascunho na quinta tem 100 cx24 -> cx_planejadas vivo = 100, folga_cx = 200
        const diaQuiSug = base.sugestoes.dias.find(d => d.dia === '2026-11-26' && d.veiculo_id === 's10');
        assert.equal(diaQuiSug.cx_planejadas, 100, 'soma cartoes vivos do rascunho em cx_planejadas');
        assert.equal(diaQuiSug.folga_cx, 200, 'recalcula folga_cx com o rascunho');

        // Sugerir semana move #4002 (atrasado na sexta, dia_plano='2026-11-27') para quinta ('2026-11-26') e ignora #4003 (dia_sugerido: null)
        const rSug = Q.aplicarSugestoesSemana(base);
        assert.equal(rSug.ok, true);
        assert.deepEqual(rSug.aplicados.map(x => x.cd_pedido), [4002]);
        assert.ok(rSug.estado.dias.find(d => d.dia === '2026-11-26').cartoes.some(c => c.cd_pedido === 4002), '#4002 movido para quinta no rascunho');
    }
});

test('066 regressoes Sentinela UI066-R1-A e UI066-R4: foto historica real preserva Recebido/canhoto/etapa avancada/ausente e falha de leitura nao finge foto; sugestoes de outra versao/semana sao recusadas e invalidadas', async () => {
    const frota = [
        { id: 's10', nome: 'S10', modo: 'porta', capacidade_volume: 2700, dias_sem_saida: [0, 6], ativo: true },
        { id: 'caminhao', nome: 'Caminhao', modo: 'cd_ceasa', capacidade_volume: null, dias_sem_saida: [0], ativo: true }
    ];
    const src = fs.readFileSync(require.resolve('../../js/admin-rota.js'), 'utf8');
    const begin = src.indexOf('        var oDia = optsPlano();');
    const end = src.indexOf('        // 050: o plano desenhado', begin);
    const calculoDetalhe = src.slice(begin, end);
    class Clock extends Date { constructor(...a) { super(...(a.length ? a : ['2026-11-25T14:00:00-03:00'])); } }
    const hook = `    raiz.qaR1A={st,aplicarLeituraSemana065,aplicarLeituraSugestoes066,montarDadosQuadro065,abrirDetalheDia,carregarFotoDiaDetalhe,salvarSemana065,recarregarSugestoes066,htmlFechamento,atual:function(){var pl=planos();${calculoDetalhe}return atual;}};desenhar=function(){};\n    raiz.TempRioRota = {`;
    const ctx = { window: { TempRioRotaCore: R, TempRioRotaQuadro: Q }, Date: Clock, Intl, Promise, setTimeout, clearTimeout, setInterval, clearInterval, console };
    vm.runInNewContext(src.replace('    raiz.TempRioRota = {', hook), ctx);
    const a = ctx.window.qaR1A, s = a.st;
    const p = (cd, extra = {}) => ({ cd_pedido: cd, documento: '1200000000' + String(cd), cliente_nome: 'Cliente ' + cd, etapa: 'conferido', dt_pedido: '2026-11-24T10:00:00-03:00', caixas_24: 10, ...extra });

    Object.assign(s, {
        ativo: true, v2: true, podeMarcar: true, pln046: true, papel: 'admin',
        frota047: true, frotaLinhas: frota, frota: R.frotaDe(frota),
        cfg: R.cfgDe({ hora_saida: '08:00', feriados_sem_saida: false, canhoto_desde: '2026-01-01T00:00Z' }),
        cfgLinha: { hora_saida: '08:00' },
        pedidos: [
            p(3001),
            p(3002, { etapa: 'atendido', dt_saida: '2026-11-24T11:00:00-03:00' }),
            p(3005, { etapa: 'entregue', dt_saida: '2026-11-01T08:00:00-03:00' })
        ],
        clientes: {}, sem065: true, fx050: true, fxFoto: { data: '2026-11-25', itens: [] },
        porPedido: { 3001: 's10', 3002: 's10', 3005: 's10' }
    });
    for (const [i, ped] of s.pedidos.entries()) {
        s.clientes[ped.documento] = { nome: ped.cliente_nome, bairro: 'Centro', cidade: 'Rio', pos: [-22.85 + i * 0.01, -43.22] };
    }
    a.aplicarLeituraSemana065('2026-11-23', {
        data: {
            status: 'ok', inicio: '2026-11-23', hoje: '2026-11-25', versao: 1,
            itens: [{ cd_pedido: 3001, dia: '2026-11-26', veiculo_id: 's10', ordem: 1, removido: false }],
            sem_saida: [], fechados: ['2026-11-25']
        }
    });

    // --- UI066-R1-A: foto real de 24/11 com pedido Recebido (#3002), pedido com canhoto e etapa avancada (#3005) e pedido ausente de st.pedidos (#3099) ---
    s.fxDias['2026-11-24'] = {
        data: '2026-11-24',
        itens: [
            { cd_pedido: 3002, veiculo_id: 's10', ordem: 1 },
            { cd_pedido: 3001, veiculo_id: 's10', ordem: 2 },
            { cd_pedido: 3005, veiculo_id: 's10', ordem: 3 },
            { cd_pedido: 3099, veiculo_id: 's10', ordem: 4, cliente_nome: 'Cliente Historico Ausente', c24: 15 }
        ]
    };
    s.confirmacoes[3002] = { confirmado_em: '2026-11-24T14:00:00-03:00', confirmado_nome: 'QA' };
    s.canhotos[3005] = true;

    a.abrirDetalheDia('2026-11-24');
    const hist = a.atual();
    const cdsHist = Array.from(R.itensDaRota(hist).map(x => x.cd_pedido));
    assert.deepEqual(cdsHist, [3002, 3001, 3005, 3099], 'R1-A: foto historica preserva Recebido, canhoto, etapa avancada e ausente na ordem exata');
    assert.equal(hist.somenteLeituraDia, true);

    // Em falha de leitura historica (rota_050_ler com erro 57014), identifica erro sem apresentar plano como foto confirmada
    delete s.fxDias['2026-11-23'];
    s.sb = { rpc: (n) => Promise.resolve(n === 'rota_050_ler' ? { error: { code: '57014', message: 'statement timeout' } } : { data: null }) };
    await a.carregarFotoDiaDetalhe('2026-11-23');
    a.abrirDetalheDia('2026-11-23');
    const histErro = a.atual();
    assert.equal(histErro.fechada, null, 'R1-A: falha na leitura historica nao apresenta plano como foto confirmada');
    assert.match(histErro.fxErroHistorico, /timeout/i);
    assert.ok(a.htmlFechamento(histErro).includes('data-rota-fx-erro-hist="1"'), 'R1-A: banner de erro historico renderizado');

    // --- UI066-R4: plano 065 v1 + sugestoes 066 v2 (outro snapshot) invalida recomendacoes, recusa Sugerir/Aceitar e dispara releitura ---
    delete s.confirmacoes[3002];
    delete s.canhotos[3005];
    let releituras = 0;
    s.sb = {
        rpc(n) {
            if (n === 'rota_065_ler_semana' || n === 'rota_066_sugestoes') releituras++;
            return new Promise(() => {}); // mantem releitura pendente para inspecionar o estado imediato
        }
    };
    s.sem065Dados['2026-11-23'].itens = [];
    a.aplicarLeituraSugestoes066('2026-11-23', {
        data: {
            status: 'ok', semana: '2026-11-23', hoje: '2026-11-25', versao: 2,
            pedidos: [{ cd_pedido: 3002, dia_sugerido: '2026-11-27', veiculo_sugerido: 's10', score: 130, motivo: ['vencido'], texto: 'Venceu' }],
            dias: [], encaixes: []
        }
    });
    const board = Q.normalizarEstado(a.montarDadosQuadro065('2026-11-23'));
    assert.equal(board.versaoBase, 1);
    assert.equal(board.sugestoes.versao, 2);
    assert.equal(board.sugestoes.invalida, true, 'R4: sugestoes de versao divergente marcadas como invalidas');
    assert.equal(board.sugestoes.pedidos.length, 0, 'R4: nao cai no stub nem expoe pedidos de versao divergente');
    assert.ok(releituras >= 2, 'R4: disparou releitura coordenada de 065 e 066');
    const aplicado = Q.aplicarSugestoesSemana(board);
    assert.equal(aplicado.ok, false, 'R4: Sugerir semana recusa aplicar sugestoes de versao divergente');
    assert.equal(aplicado.aplicados.length, 0);
    const aceito = Q.aplicarAcao(board, { tipo: 'aceitar_sugestao', cd_pedido: 3002, dia: '2026-11-27', veiculo: 's10' });
    assert.equal(aceito.ok, false, 'R4: Aceitar recusa sugestao de versao divergente');

    // Apos salvar localmente (v1 -> v2), cache antigo e invalidado (sem cair no stub) e resposta 066 antiga fora de ordem e descartada
    let resolveSugAntiga, resolveSugNova;
    let chamadaSug = 0;
    s.sb = {
        rpc(n) {
            if (n === 'rota_065_salvar_semana') return Promise.resolve({ data: { status: 'ok', versao: 2, itens: 1 } });
            if (n === 'rota_066_sugestoes') {
                chamadaSug++;
                return new Promise(ok => { if (chamadaSug === 1) resolveSugAntiga = ok; else resolveSugNova = ok; });
            }
            return Promise.resolve({ data: null });
        }
    };
    // Dispara uma leitura 066 antes do salvar
    a.recarregarSugestoes066('2026-11-23');
    // Agora salva a semana (sobe versao para 2 e invalida a leitura anterior)
    a.salvarSemana065({ inicio: '2026-11-23', versao_base: 1, itens: [{ cd_pedido: 3001, dia: '2026-11-26', veiculo_id: 's10', ordem: 1, removido: false }] }, false);
    await new Promise(ok => setImmediate(ok));
    const boardDuranteReleitura = Q.normalizarEstado(a.montarDadosQuadro065('2026-11-23'));
    assert.equal(boardDuranteReleitura.versaoBase, 2);
    assert.equal(boardDuranteReleitura.sugestoes.invalida, true, 'R4: cache invalidado durante releitura pos-salvar, sem cair no stub');
    assert.equal(boardDuranteReleitura.sugestoes.pedidos.length, 0);

    // Resposta antiga (v1) chega atrasada -> descartada por seqSug066!
    resolveSugAntiga({ data: { status: 'ok', semana: '2026-11-23', hoje: '2026-11-25', versao: 1, pedidos: [{ cd_pedido: 3002, dia_sugerido: '2026-11-27', veiculo_sugerido: 's10', score: 130, motivo: ['vencido'] }], dias: [], encaixes: [] } });
    await new Promise(ok => setImmediate(ok));
    assert.equal(s.sug066Dados['2026-11-23'].status, 'carregando', 'R4: resposta 066 fora de ordem anterior ao salvar foi descartada');

    // Resposta nova (v2) chega -> aceita e coerente com versaoBase=2!
    resolveSugNova({ data: { status: 'ok', semana: '2026-11-23', hoje: '2026-11-25', versao: 2, pedidos: [{ cd_pedido: 3002, dia_sugerido: '2026-11-27', veiculo_sugerido: 's10', score: 130, motivo: ['vencido'], texto: 'Sug v2' }], dias: [], encaixes: [] } });
    await new Promise(ok => setImmediate(ok));
    const boardPosReleitura = Q.normalizarEstado(a.montarDadosQuadro065('2026-11-23'));
    assert.equal(boardPosReleitura.sugestoes.invalida, false);
    assert.equal(boardPosReleitura.sugestoes.versao, 2);
    assert.equal(boardPosReleitura.sugestoes.pedidos.length, 1);
});
