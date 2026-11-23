// ROTA-FIXA (050) no WhatsApp: fechamento automático (fecharRotaAuto) e mensagens de rota usando a rota FECHADA.
// Dados FICTÍCIOS, Supabase falso (sem rede). Rodar: node --test supabase/tests/rota-fechada-whatsapp.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../functions/_shared/whatsapp-core.js');
const R = require('../functions/_shared/rota-core.js');

const FROTA = [
    { id: 'caminhao', nome: 'Caminhão', modo: 'cd_ceasa', capacidade_volume: null, dias_sem_saida: [0], volta_sede: false, cor: '#111111', ordem: 1, ativo: true },
    { id: 's10', nome: 'S10', modo: 'porta', capacidade_volume: 100000, dias_sem_saida: [0], volta_sede: true, cor: '#222222', ordem: 2, ativo: true }
];
function banco(o) {
    o = o || {};
    const pedidos = [], posicoes = [], pv = [];
    for (let i = 0; i < 6; i++) {
        const doc = String(13000000000000 + i);
        pedidos.push({ cd_pedido: 8000 + i, dt_pedido: '2026-11-21T10:00:00-03:00', etapa: 'conferido', cliente_tipo: 'cnpj', documento: doc, caixas_24: 2, caixas_48: 0, caixas_outras: 0 });
        posicoes.push({ documento: doc, nome: 'Cliente ' + i, bairro: 'Bairro ' + i, cidade: 'Petrópolis', lat: R.ROTA.ORIGEM[0] + 0.005 * (i + 1), lng: R.ROTA.ORIGEM[1] + 0.003 * ((i * 5) % 4), pino_desatualizado: false });
        pv.push({ cd_pedido: 8000 + i, veiculo: i === 5 ? 'caminhao' : 's10' });
    }
    const T = {
        solidcon_pedidos_erp: pedidos, solidcon_pedidos_erp_sync: [], rota_cliente_veiculo: [], rota_pedido_veiculo: pv, rota_cliente_regras: [], rota_pedido_ignorado: [],
        rota_veiculos: FROTA, rota_config: [{ id: 1, hora_saida: o.horaSaida || '08:00', corte_hora: 8, velocidade_kmh: 60, minutos_parada: 45, feriados_sem_saida: true, feriados_extras: [] }],
        rota_dia_fechada: o.linha ? [o.linha] : [], rota_dia_item: o.itens || []
    };
    const rpcs = [];
    const sb = {
        rpcs,
        from(t) {
            const q = { select() { return q; }, eq() { return q; }, in() { return q; }, gte() { return q; }, order() { return q; }, limit() { return q; },
                range(a, b) { q._r = [a, b]; return q; },
                then(ok, ko) {
                    if (o.sem050 && /^rota_dia_/.test(t)) return Promise.resolve({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public." + t + "' in the schema cache" } }).then(ok, ko);
                    const d = T[t] || []; return Promise.resolve({ data: q._r ? d.slice(q._r[0], q._r[1] + 1) : d, error: null }).then(ok, ko);
                } };
            return q;
        },
        rpc(nome, args) {
            rpcs.push({ nome, args });
            if (nome === 'solidcon_rota_posicoes') return Promise.resolve({ data: posicoes, error: null });
            if (nome === 'rota_050_fechar_auto') return Promise.resolve({ data: o.respAuto || { fechou: true }, error: null });
            if (nome === 'rota_050_ler') {   // 050: cabeçalho + itens num objeto (o.leituras = respostas em sequência p/ simular corrida)
                if (o.sem050) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.rota_050_ler' } });
                if (o.leituras && o.leituras.length) { const l = o.leituras.length > 1 ? o.leituras.shift() : o.leituras[0]; return Promise.resolve({ data: l, error: null }); }
                const ln = T.rota_dia_fechada[0];
                return Promise.resolve({ data: ln ? { linha: Object.assign({ revisao: 1 }, ln), itens: ln.estado === 'fechada' ? T.rota_dia_item : [] } : null, error: null });
            }
            return Promise.resolve({ data: null, error: { code: '42883', message: 'função ausente' } });
        }
    };
    return { sb, T };
}
const SEG_0830 = new Date('2026-11-23T11:30:00Z'), SEG_0745 = new Date('2026-11-23T10:45:00Z'), DOM_0900 = new Date('2026-11-22T12:00:00Z');
const autos = (sb) => sb.rpcs.filter((r) => r.nome === 'rota_050_fechar_auto');

test('fechamento automático: só depois da hora de saída lida do rota_config (08:00), com a previsão daquele momento', async () => {
    let b = banco();
    assert.deepEqual(await W.fecharRotaAuto(b.sb, SEG_0745), { fechou: false, motivo: 'antes_da_hora' });
    assert.equal(autos(b.sb).length, 0);
    b = banco();
    const r = await W.fecharRotaAuto(b.sb, SEG_0830);
    assert.deepEqual(r, { fechou: true, pedidos: 6 });
    const itens = autos(b.sb)[0].args.p_itens;
    assert.equal(itens.length, 6);
    assert.ok(itens.every((it) => it.ordem >= 1 && ['s10', 'caminhao'].includes(it.veiculo_id)));
    assert.deepEqual(itens.filter((it) => it.veiculo_id === 'caminhao').map((it) => it.cd_pedido), [8005]);
    // hora configurável: 09:00 -> às 08:30 ainda não
    b = banco({ horaSaida: '09:00' });
    assert.equal((await W.fecharRotaAuto(b.sb, SEG_0830)).motivo, 'antes_da_hora');
});

test('fechamento automático: não fecha 2x, não fecha dia reaberto, nem domingo, nem sem a 050', async () => {
    for (const [o, motivo] of [[{ linha: { data: '2026-11-23', estado: 'fechada', automatico: false, versao: 1 } }, 'ja_fechada'],
                               [{ linha: { data: '2026-11-23', estado: 'reaberta', automatico: false, versao: 1 } }, 'reaberta'],
                               [{ sem050: true }, 'sem_050']]) {
        const b = banco(o);
        assert.equal((await W.fecharRotaAuto(b.sb, SEG_0830)).motivo, motivo);
        assert.equal(autos(b.sb).length, 0, motivo);
    }
    const b = banco();
    assert.equal((await W.fecharRotaAuto(b.sb, DOM_0900)).motivo, 'sem_saida');
    // o banco ainda pode recusar (corrida com quem fechou pelo botão): devolve o motivo dele
    const c = banco({ respAuto: { fechou: false, motivo: 'ja_tem' } });
    assert.deepEqual(await W.fecharRotaAuto(c.sb, SEG_0830), { fechou: false, motivo: 'ja_tem' });
});

test('Sentinela RF-1: reabriram DURANTE a coleta -> coleta de novo e usa o estado novo (nunca cabeçalho fechado com itens de outra hora)', async () => {
    const fechada = { linha: { data: '2026-11-23', estado: 'fechada', automatico: true, versao: 1, revisao: 1 }, itens: [{ cd_pedido: 8000, veiculo_id: 's10', ordem: 1, origem: 'previsao' }] };
    const reaberta = { linha: { data: '2026-11-23', estado: 'reaberta', automatico: true, versao: 1, revisao: 2 }, itens: [] };
    const b = banco({ leituras: [fechada, reaberta, reaberta] });
    const m = await W.gerar(b.sb, 'rota_s10', SEG_0830, {});
    assert.equal(m.resumo.paradas, 5, 'previsão viva (reaberta): todos os pedidos da S10');
    assert.equal(b.sb.rpcs.filter((r) => r.nome === 'rota_050_ler').length, 4, 'leu + conferiu (mudou), leu + conferiu de novo');
    // mudando sem parar: erro (o envio do dia NÃO sai com uma rota inventada)
    const c = banco({ leituras: [fechada, reaberta, fechada, reaberta, fechada, reaberta, fechada] });
    c.sb.rpc = ((orig) => { let n = 0; const alt = [fechada, reaberta]; return (nome, args) => nome === 'rota_050_ler' ? Promise.resolve({ data: alt[(n++) % 2], error: null }) : orig(nome, args); })(c.sb.rpc.bind(c.sb));
    await assert.rejects(W.gerar(c.sb, 'rota_s10', SEG_0830, {}), /mudou durante a leitura/);
});

test('rota_s10 e rota_chefe usam a rota FECHADA: pedido novo fica para o próximo dia; removido de hoje também', async () => {
    const linha = { data: '2026-11-23', estado: 'fechada', automatico: true, versao: 1, fechada_em: '2026-11-23T11:00:00Z', fechada_nome: null };
    const itens = [8000, 8001, 8002, 8003].map((cd, i) => ({ cd_pedido: cd, veiculo_id: 's10', ordem: 4 - i, origem: 'previsao' }))
        .concat([{ cd_pedido: 8004, veiculo_id: 's10', ordem: null, origem: 'previsao', removido_em: '2026-11-23T11:10:00Z', removido_nome: 'Márcio' },
                 { cd_pedido: 8005, veiculo_id: 'caminhao', ordem: 1, origem: 'previsao' }]);
    const b = banco({ linha, itens });
    b.T.solidcon_pedidos_erp.push({ cd_pedido: 8099, dt_pedido: '2026-11-23T08:10:00-03:00', etapa: 'aberto', cliente_tipo: 'cnpj', documento: '13000000000000', caixas_24: 1, caixas_48: 0, caixas_outras: 0 });
    b.T.rota_pedido_veiculo.push({ cd_pedido: 8099, veiculo: 's10' });
    const m = await W.gerar(b.sb, 'rota_s10', SEG_0830, {});
    const nomes = m.partes.flatMap((p) => p.params[3].split('; ')).map((x) => x.replace(/^\d+\) (~\d\d:\d\d )?/, '').split(' — ')[0]);
    assert.deepEqual(nomes, ['Cliente 3', 'Cliente 2', 'Cliente 1', 'Cliente 0'], 'ordem SALVA (4,3,2,1), sem o removido');
    assert.equal(m.resumo.paradas, 4);
    assert.equal(m.resumo.fica, 2, '8004 (removido de hoje) e 8099 (entrou depois) ficam');
    const c = await W.gerar(b.sb, 'rota_chefe', SEG_0830, { template: 'rota_sugerida' });
    assert.equal(c.resumo.entregas, 5);
    assert.match(c.partes[c.partes.length - 1].params[1], /^5 pedidos · 5 entregas · .* · 2 pedidos ficam para outro dia$/);
    // sem a 050: previsão viva (como antes), 8004 e 8099 entram
    const v = await W.gerar(banco({ sem050: true }).sb, 'rota_s10', SEG_0830, {});
    assert.equal(v.resumo.paradas, 5);
});
