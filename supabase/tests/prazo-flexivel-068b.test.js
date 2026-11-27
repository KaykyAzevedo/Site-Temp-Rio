'use strict';
// 068 B: Prazo ideal flexivel (rota-core.js + verificacao estrutural da migracao/rollback).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../functions/_shared/rota-core.js');
const W = require('../functions/_shared/whatsapp-core.js');

const cfgPadrao = core.comFrota({ feriados_sem_saida: true, feriados_extras: [], corte_hora: null }, null);

test('068B rota-core: padrao 2 dias uteis permanece identico (S10 vs caminhao)', () => {
    assert.equal(core.prazoDe('2026-11-27T10:00:00-03:00', cfgPadrao, 's10'), '2026-12-01');
    assert.equal(core.prazoDe('2026-12-03T10:00:00-03:00', cfgPadrao, 'caminhao'), '2026-12-05');
    assert.equal(core.prazoDe('2026-12-03T10:00:00-03:00', cfgPadrao, 's10'), '2026-12-07');
});

test('068B rota-core: +0 e +N dias uteis respeitando fim de semana, feriado e corte_hora', () => {
    assert.equal(core.prazoDe('2026-11-27T10:00:00-03:00', cfgPadrao, 's10', { tipo: 'dias_uteis', dias: 0 }), '2026-11-27');
    assert.equal(core.prazoDe('2026-11-29T10:00:00-03:00', cfgPadrao, 's10', { tipo: 'dias_uteis', dias: 0 }), '2026-11-30');
    assert.equal(core.prazoDe('2026-11-27T10:00:00-03:00', cfgPadrao, 's10', { tipo: 'dias_uteis', dias: 5 }), '2026-12-04');
    // Feriado movel Sexta Santa 2026-04-03
    assert.equal(core.prazoDe('2026-04-01T10:00:00-03:00', cfgPadrao, 's10', { tipo: 'dias_uteis', dias: 2 }), '2026-04-06');
    // Feriado extra na segunda 2026-11-30
    const cfgFer = core.comFrota({ feriados_sem_saida: true, feriados_extras: ['2026-11-30'], corte_hora: null }, null);
    assert.equal(core.prazoDe('2026-11-27T10:00:00-03:00', cfgFer, 's10', { tipo: 'dias_uteis', dias: 2 }), '2026-12-02');
    // corte_hora = 14
    const cfgCorte = core.comFrota({ feriados_sem_saida: true, corte_hora: 14 }, null);
    assert.equal(core.prazoDe('2026-11-30T15:00:00-03:00', cfgCorte, 's10', { tipo: 'dias_uteis', dias: 2 }), '2026-12-03');
    // 365 dias uteis nao estoura o limite do loop
    const p365 = core.prazoDe('2026-11-27T10:00:00-03:00', cfgPadrao, 's10', { tipo: 'dias_uteis', dias: 365 });
    assert.match(p365, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(p365 > '2028-01-01');
});

test('068B rota-core: data agendada e regra por dias da semana', () => {
    assert.equal(core.prazoDe('2026-11-27T10:00:00-03:00', cfgPadrao, 's10', { tipo: 'data', data: '2026-12-09' }), '2026-12-09');
    // Ter/Qui a partir de sex 27/11 -> ter 01/12
    assert.equal(core.prazoDe('2026-11-27T10:00:00-03:00', cfgPadrao, 's10', { tipo: 'semana', dias_semana: [2, 4] }), '2026-12-01');
    // Se terca 01/12 for feriado extra -> pula para quinta 03/12
    const cfgFerTer = core.comFrota({ feriados_sem_saida: true, feriados_extras: ['2026-12-01'] }, null);
    assert.equal(core.prazoDe('2026-11-27T10:00:00-03:00', cfgFerTer, 's10', { tipo: 'semana', dias_semana: [2, 4] }), '2026-12-03');
    // Regra sabado [6] em S10 resolve sabado sem devolver nulo
    assert.equal(core.prazoDe('2026-11-20T10:00:00-03:00', cfgPadrao, 's10', { tipo: 'semana', dias_semana: [6] }), '2026-11-21');
});

test('068B rota-core: prazoPedido aplica precedencia excecao > cliente > padrao', () => {
    const ped = { cd_pedido: 100, documento: '66000000000001', dt_pedido: '2026-11-27T10:00:00-03:00' };
    const regras = { '66000000000001': { tipo: 'dias_uteis', dias_uteis: 5 } };
    const excecoes = { 100: { tipo: 'data', data: '2026-12-09' } };
    assert.equal(core.prazoPedido(ped, cfgPadrao, 's10', null, null), '2026-12-01');
    assert.equal(core.prazoPedido(ped, cfgPadrao, 's10', null, regras), '2026-12-04');
    assert.equal(core.prazoPedido(ped, cfgPadrao, 's10', excecoes, regras), '2026-12-09');
});

test('068B B068-R1 rota-core: calendario semanal esparso (+120 e +365) e veiculo sem saida', () => {
    const veicSoSab = [{ id: 's10', nome: 'S10', modo: 'porta', capacidade: 2700, diasSemSaida: [0, 1, 2, 3, 4, 5], ativo: true }];
    const cfgSab = core.comFrota({ feriados_sem_saida: false, feriados_extras: [], corte_hora: null }, veicSoSab);
    assert.equal(core.prazoDe('2026-11-23T10:00:00-03:00', cfgSab, 's10', { tipo: 'dias_uteis', dias: 120 }), '2029-03-10');
    assert.equal(core.prazoDe('2026-11-23T10:00:00-03:00', cfgSab, 's10', { tipo: 'dias_uteis', dias: 365 }), '2033-11-19');
    const veicNenhum = [{ id: 's10', nome: 'S10', modo: 'porta', capacidade: 2700, diasSemSaida: [0, 1, 2, 3, 4, 5, 6], ativo: true }];
    const cfgNenhum = core.comFrota({ feriados_sem_saida: false }, veicNenhum);
    assert.equal(core.prazoDe('2026-11-23T10:00:00-03:00', cfgNenhum, 's10', { tipo: 'dias_uteis', dias: 2 }), null);
});

test('068B B068-R2 rota-core: planejar, planejarSemana e sugestoesJuntar propagam opts.prazos e opts.regrasPrazo', () => {
    // Repro exata da Sentinela: pedido 99102 de 27/11, excecao data 09/12, planejado 03/12 -> prazo 09/12 (ok, nao vencido!)
    const ped1 = { cd_pedido: 99102, documento: '66000000000001', etapa: 'conferido', dt_pedido: '2026-11-27T10:00:00-03:00', caixas_24: 10, caixas_48: 0, caixas_outras: 0 };
    const ped2 = { cd_pedido: 99103, documento: '66000000000002', etapa: 'conferido', dt_pedido: '2026-11-27T10:00:00-03:00', caixas_24: 10, caixas_48: 0, caixas_outras: 0 };
    const clientes = {
        '66000000000001': { documento: '66000000000001', nome: 'Cliente Excecao', bairro: 'Centro', cidade: 'Rio de Janeiro', uf: 'RJ', pos: [-22.90, -43.20] },
        '66000000000002': { documento: '66000000000002', nome: 'Cliente Regra', bairro: 'Centro', cidade: 'Rio de Janeiro', uf: 'RJ', pos: [-22.905, -43.20] }
    };
    const prazos = { 99102: { prazo: '2026-12-09', origem: 'pedido', tipo: 'data', data: '2026-12-09' } };
    const regrasPrazo = { '66000000000002': { tipo: 'dias_uteis', dias_uteis: 5 } }; // sex 27/11 + 5du = sex 04/12
    const padroes = { '66000000000001': 's10', '66000000000002': 's10' };

    // Sem 068B: ambos vencem 2026-12-01 (vencidos em 03/12)
    const plSem = core.planejar([ped1, ped2], clientes, '2026-12-03', { marcacao: true, padroes, cfg: cfgPadrao });
    const p1Sem = plSem.s10.pedidos.find((x) => x.p.cd_pedido === 99102);
    assert.equal(p1Sem.prazo, '2026-12-01');
    assert.equal(p1Sem.situacao, 'vencido');

    // Com 068B (opts.prazos + opts.regrasPrazo): planejar detalhe do dia 03/12 ve 09/12 e 04/12!
    const plCom = core.planejar([ped1, ped2], clientes, '2026-12-03', { marcacao: true, padroes, cfg: cfgPadrao, prazos, regrasPrazo });
    const p1Com = plCom.s10.pedidos.find((x) => x.p.cd_pedido === 99102);
    const p2Com = plCom.s10.pedidos.find((x) => x.p.cd_pedido === 99103);
    assert.equal(p1Com.prazo, '2026-12-09');
    assert.equal(p1Com.situacao, 'ok');
    assert.equal(p2Com.prazo, '2026-12-04');
    assert.equal(p2Com.situacao, 'amanha');

    // planejarSemana propaga prazos e regrasPrazo (nao marca estoura em 03/12)
    const semCom = core.planejarSemana([ped1, ped2], clientes, '2026-11-30', {
        padroes, cfg: cfgPadrao, prazos, regrasPrazo, plano: { 99102: { dia: '2026-12-03', veiculo_id: 's10' } }
    });
    const diaQui = semCom.dias.find((d) => d.dia === '2026-12-03');
    const sp1 = diaQui.pedidos.find((x) => x.p.cd_pedido === 99102);
    assert.equal(sp1.prazo, '2026-12-09');
    assert.equal(sp1.estoura, false);

    // sugestoesJuntar propaga prazos e regrasPrazo
    const rotas = [{ dia: '2026-12-03', veiculo: 's10', fonte: 'plano', paradas: [{ documento: '66000000000099', nome: 'Ancora', pos: [-22.901, -43.20] }], volume: 90 }];
    const jCom = core.sugestoesJuntar([ped1, ped2], clientes, rotas, { padroes, cfg: cfgPadrao, prazos, regrasPrazo, hoje: '2026-11-30' });
    const sj1 = jCom.sugestoes.find((s) => s.cds.includes(99102));
    const sj2 = jCom.sugestoes.find((s) => s.cds.includes(99103));
    assert.equal(sj1.prazo, '2026-12-09');
    assert.equal(sj1.estoura, false);
    assert.equal(sj2.prazo, '2026-12-04');
    assert.equal(sj2.estoura, false);
});

test('068B rota-core: prazo_ideal_dias e prazo_dias_uteis_semana configuraveis em cfg (independente de rota_veiculos)', () => {
    const cfg4 = core.comFrota({ feriados_sem_saida: true, prazo_ideal_dias: 4, prazo_dias_uteis_semana: [1, 2, 3, 4, 5] }, null);
    const ped = { cd_pedido: 100, documento: '66000000000001', dt_pedido: '2026-12-01T10:00:00-03:00' };
    // Padrao configurado 4du seg..sex (mesmo no caminhao!): ter 01/12 -> qua(1), qui(2), sex(3), seg 07/12(4)
    assert.equal(core.prazoPedido(ped, cfg4, 'caminhao', null, null), '2026-12-07');
    // Habilitando sabado em prazo_dias_uteis_semana: ter 01/12 + 4du = sab 05/12 (mesmo na S10!)
    const cfgSab = core.comFrota({ feriados_sem_saida: true, prazo_ideal_dias: 4, prazo_dias_uteis_semana: [1, 2, 3, 4, 5, 6] }, null);
    assert.equal(core.prazoPedido(ped, cfgSab, 's10', null, null), '2026-12-05');
    // Regra cliente 1du vence padrao configurado
    assert.equal(core.prazoPedido(ped, cfg4, 's10', null, { '66000000000001': { tipo: 'dias_uteis', dias: 1 } }), '2026-12-02');
    // Excecao pedido data vence regra cliente e padrao configurado
    assert.equal(core.prazoPedido(ped, cfg4, 's10', { 100: { tipo: 'data', data: '2026-12-16' } }, { '66000000000001': { tipo: 'dias_uteis', dias: 1 } }), '2026-12-16');
});

test('068B r8 + 070 rota-core: modos previsao e definitiva (Rota de amanha) usam prazo flexivel e dias uteis configurados', () => {
    const pedPronto = { cd_pedido: 701547, documento: '66000000000001', etapa: 'conferido', dt_pedido: '2026-11-26T10:00:00-03:00', caixas_24: 5, caixas_48: 0, caixas_outras: 0 };
    const pedAberto = { cd_pedido: 701545, documento: '66000000000002', etapa: 'aberto', dt_pedido: '2026-11-26T10:00:00-03:00', caixas_24: 5, caixas_48: 0, caixas_outras: 0 };
    const clientes = {
        '66000000000001': { documento: '66000000000001', nome: 'Pronto QA', bairro: 'Centro', cidade: 'Rio de Janeiro', uf: 'RJ', pos: [-22.90, -43.20] },
        '66000000000002': { documento: '66000000000002', nome: 'Aberto QA', bairro: 'Centro', cidade: 'Rio de Janeiro', uf: 'RJ', pos: [-22.905, -43.20] }
    };
    const pedidos_estado = {
        701547: { cd_pedido: 701547, entregue: false, pendente: true, pronto_despacho: true, estado_070: 'pronto_despacho', data_saida_marcada: null },
        701545: { cd_pedido: 701545, entregue: false, pendente: true, pronto_despacho: false, estado_070: 'aberto', data_saida_marcada: null }
    };
    const padroes = { '66000000000001': 's10', '66000000000002': 's10' };
    const cfg070 = core.comFrota({ feriados_sem_saida: true, prazo_ideal_dias: 4, prazo_dias_uteis_semana: [1, 2, 3, 4, 5] }, null);
    const prazos = { 701547: { tipo: 'data', data: '2026-12-09' } };
    const regrasPrazo = { '66000000000002': { tipo: 'dias_uteis', dias: 1 } };

    // Modo PREVISAO: inclui ambos (Pronto + Aberto) com prazos flexiveis (701547=09/12 excecao; 701545=27/11 regra cliente)
    const prev = core.planejar([pedPronto, pedAberto], clientes, '2026-11-30', {
        marcacao: true, padroes, cfg: cfg070, pedidos_estado, modo_planejamento: 'previsao', hoje: '2026-11-26', prazos, regrasPrazo
    });
    assert.equal(prev.s10.pedidos.length, 2);
    assert.equal(prev.s10.pedidos.find((x) => x.p.cd_pedido === 701547).prazo, '2026-12-09');
    assert.equal(prev.s10.pedidos.find((x) => x.p.cd_pedido === 701547).situacao, 'ok');
    assert.equal(prev.s10.pedidos.find((x) => x.p.cd_pedido === 701545).prazo, '2026-11-27');
    assert.equal(prev.s10.pedidos.find((x) => x.p.cd_pedido === 701545).situacao, 'vencido');

    // Modo DEFINITIVA (Rota de amanha): inclui SOMENTE Pronto (701547) e aplica prazo flexivel (09/12, situacao 'ok')
    const def = core.planejar([pedPronto, pedAberto], clientes, '2026-11-30', {
        marcacao: true, padroes, cfg: cfg070, pedidos_estado, modo_planejamento: 'definitiva', hoje: '2026-11-26', prazos, regrasPrazo
    });
    assert.equal(def.s10.pedidos.length, 1);
    assert.equal(def.s10.pedidos[0].p.cd_pedido, 701547);
    assert.equal(def.s10.pedidos[0].prazo, '2026-12-09');
    assert.equal(def.s10.pedidos[0].situacao, 'ok');

    // planejarSemana modo definitiva respeita prazo flexivel e nao marca estoura
    const semDef = core.planejarSemana([pedPronto, pedAberto], clientes, '2026-11-30', {
        padroes, cfg: cfg070, pedidos_estado, modo_planejamento: 'definitiva', hoje: '2026-11-26', prazos, regrasPrazo,
        plano: { 701547: { dia: '2026-12-03', veiculo_id: 's10' } }
    });
    const dQui = semDef.dias.find((d) => d.dia === '2026-12-03');
    assert.equal(dQui.pedidos.length, 1);
    assert.equal(dQui.pedidos[0].prazo, '2026-12-09');
    assert.equal(dQui.pedidos[0].estoura, false);
});

test('068B migracao e rollback: checagens estruturais de seguranca', () => {
    const lf = (s) => s.replace(/\r\n/g, '\n');
    const mig = lf(fs.readFileSync(path.join(__dirname, '../../admin/migracoes/068_b_prazo_flexivel.sql'), 'utf8'));
    const rb = lf(fs.readFileSync(path.join(__dirname, '../../admin/migracoes/068_b_rollback.sql'), 'utf8'));
    assert.match(mig, /enable row level security/);
    assert.match(mig, /revoke all on function public\.rota_068_prazo_salvar.*from public, anon, authenticated/);
    assert.match(mig, /revoke all on function public\.rota_068_prazo_padrao_salvar.*from public, anon, authenticated/);
    assert.match(mig, /revoke all on function public\.rota_068_calendario_veiculo.*from public, anon, authenticated/);
    assert.match(mig, /create trigger rota_068_config_prazo_guardar/);
    assert.match(mig, /create trigger rota_068_config_prazo_logar/);
    assert.match(mig, /using \(\(select public\.eh_equipe\(\)\)\)/);
    assert.doesNotMatch(mig, /for all/i);
    assert.doesNotMatch(rb, /drop table/i, 'rollback preserva dados');
    assert.match(rb, /drop trigger if exists rota_068_config_prazo_guardar on public\.rota_config/);
    assert.match(rb, /drop trigger if exists rota_068_config_prazo_logar on public\.rota_config/);
    assert.match(rb, /drop function if exists public\.rota_068_prazo_salvar/);
    assert.match(rb, /drop function if exists public\.rota_068_prazo_travado/);
    assert.match(rb, /drop function if exists public\.rota_068_prazo_padrao_salvar/);
    assert.match(rb, /drop function if exists public\.rota_068_calendario_veiculo/);
    assert.match(mig, /'pedido_historico'/);
    assert.match(mig, /prazo_dias_uteis_semana = coalesce\(v_uteis, prazo_dias_uteis_semana\)/);
    const fnPadrao = mig.slice(mig.indexOf('create or replace function public.rota_068_prazo_padrao_salvar'));
    assert.ok(fnPadrao.indexOf('pg_advisory_xact_lock(5100, 6802)') > 0);
    assert.ok(fnPadrao.indexOf('pg_advisory_xact_lock(5100, 6802)') < fnPadrao.indexOf('update public.rota_config'));
    assert.doesNotMatch(fnPadrao.slice(0, fnPadrao.indexOf('pg_advisory_xact_lock(5100, 6802)')), /rota_068_prazo_dias_uteis_semana/, 'R5-C: nao ler config antes do lock 6802');
    assert.match(mig, /public\.rota_070_entregue\(bigint\)/, '068B r8 delega a rota_070_entregue quando 070 instalada');
    assert.match(mig, /public\.rota_068_prazo_hoje\(\)/, '068B r8 usa relogio unificado com 070');
    assert.match(mig, /'dias_prazo'/, '068B r8 expoe dias_prazo para o mini calendario compartilhado');
    assert.match(rb, /drop function if exists public\.rota_068_prazo_hoje\(\)/);
    assert.doesNotMatch(rb, /rota_070_/i, 'rollback 068B nao toca no 070');
    assert.match(rb, /public\.rota_066_prazo\(q\.dt_pedido, q\.veic\)/);
    assert.match(mig, /revoke all on public\.rota_068_prazo_cliente, public\.rota_068_prazo_pedido, public\.rota_068_prazo_log from public, anon, authenticated, service_role;/);
    assert.match(mig, /grant select on public\.rota_068_prazo_cliente, public\.rota_068_prazo_pedido to service_role;/);
});

// Helper stub de transporte para testar Edge (whatsapp-core: coletarRota, montarRota, montarChefe, fecharRotaAuto).
function sbEdge068B(opts) {
    opts = opts || {};
    const T = Object.assign({
        solidcon_pedidos_erp: [],
        solidcon_pedidos_erp_sync: [{ status: 'ok', coletado_em: '2026-12-03T10:50:00Z' }],
        rota_config: [{ id: 1, hora_saida: '08:00', velocidade_kmh: 25, minutos_parada: 10, feriados_sem_saida: true,
                        prazo_ideal_dias: 2, prazo_dias_uteis_semana: [1, 2, 3, 4, 5], previsao_definitiva_070: !!opts.ativa070 }],
        rota_cliente_veiculo: [],
        rota_pedido_veiculo: [],
        rota_cliente_regras: [],
        rota_pedido_ignorado: [],
        rota_veiculos: [
            { id: 'caminhao', nome: 'Caminhão', modo: 'cd_ceasa', capacidade_volume: null, dias_sem_saida: [0], volta_sede: false, cor: '#111111', ordem: 1, ativo: true },
            { id: 's10', nome: 'S10', modo: 'porta', capacidade_volume: opts.capS10 != null ? opts.capS10 : 100000, dias_sem_saida: [0], volta_sede: true, cor: '#222222', ordem: 2, ativo: true }
        ],
        pedido_canhoto: [],
        rota_059_saidas: [],
        rota_068_prazo_pedido: [],
        rota_068_prazo_cliente: []
    }, opts.tabelas || {});
    if (opts.sem068B) { delete T.rota_068_prazo_pedido; delete T.rota_068_prazo_cliente; }
    const erros = opts.erros || {}, rpcs = [];
    const posicoes = opts.posicoes || [];
    const sb = {
        rpcs,
        from(nome) {
            let linhas = (T[nome] || []).slice(), de = 0, ate = 1e9, lim = null;
            const erro = erros[nome] || (Object.prototype.hasOwnProperty.call(T, nome) ? null : { code: 'PGRST205', message: "Could not find the table 'public." + nome + "' in the schema cache" });
            const b = {
                select() { return b; }, order() { return b; },
                is(c, v) { linhas = linhas.filter((r) => r[c] == v); return b; },
                in(c, v) { linhas = linhas.filter((r) => v.includes(r[c])); return b; },
                eq(c, v) { linhas = linhas.filter((r) => r[c] === v); return b; },
                limit(n) { lim = n; return b; },
                range(a, z) { de = a; ate = z; return b; },
                then(ok, ko) {
                    const d = erro ? null : linhas.slice(de, ate + 1).slice(0, lim == null ? undefined : lim);
                    return Promise.resolve({ data: d, error: erro }).then(ok, ko);
                }
            };
            return b;
        },
        rpc(nome, args) {
            rpcs.push({ nome, args });
            if (nome === 'solidcon_rota_posicoes') return Promise.resolve({ data: posicoes, error: null });
            if (nome === 'rota_050_ler') return Promise.resolve({ data: opts.foto050 || null, error: null });
            if (nome === 'rota_050_fechar_auto') return Promise.resolve({ data: { fechou: true }, error: null });
            if (nome === 'rota_070_estados_pedidos') {
                const mapa = opts.estados070 || {};
                return Promise.resolve({ data: args.p_cds.map((cd) => mapa[cd]), error: null });
            }
            if (nome === 'rota_070_definitiva_ler') {
                return Promise.resolve({ data: { status: 'ok', reservas_070: opts.reservas070 || {} }, error: null });
            }
            return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + nome } });
        }
    };
    return { sb, T };
}

test('068B B068-R8-1 Edge: coletarRota + montarRota/montarChefe propagam excecao de pedido e regra de cliente (repro Sentinela)', async () => {
    // Repro exata da Sentinela: 99102 (excecao 09/12) e 99103 (regra cliente 5du -> 04/12), ambos dt=27/11, saida 03/12, modo definitiva 070.
    const p1 = { cd_pedido: 99102, documento: '66000000000001', etapa: 'conferido', dt_pedido: '2026-11-27T10:00:00-03:00', dt_conferencia: '2026-11-27T11:00:00-03:00', cliente_tipo: 'cnpj', caixas_24: 10, caixas_48: 0, caixas_outras: 0 };
    const p2 = { cd_pedido: 99103, documento: '66000000000002', etapa: 'conferido', dt_pedido: '2026-11-27T10:00:00-03:00', dt_conferencia: '2026-11-27T11:00:00-03:00', cliente_tipo: 'cnpj', caixas_24: 10, caixas_48: 0, caixas_outras: 0 };
    const p3 = { cd_pedido: 99104, documento: '66000000000003', etapa: 'conferido', dt_pedido: '2026-11-27T10:00:00-03:00', dt_conferencia: '2026-11-27T11:00:00-03:00', cliente_tipo: 'cnpj', caixas_24: 10, caixas_48: 0, caixas_outras: 0 };
    const posicoes = [
        { documento: '66000000000001', nome: 'QA Excecao', bairro: 'Centro', cidade: 'Rio de Janeiro', lat: -22.90, lng: -43.20, precisao: 'exata', pino_desatualizado: false },
        { documento: '66000000000002', nome: 'QA Regra 5du', bairro: 'Centro', cidade: 'Rio de Janeiro', lat: -22.91, lng: -43.20, precisao: 'exata', pino_desatualizado: false },
        { documento: '66000000000003', nome: 'QA Regra Semana', bairro: 'Centro', cidade: 'Rio de Janeiro', lat: -22.92, lng: -43.20, precisao: 'exata', pino_desatualizado: false }
    ];
    const estados070 = {
        99102: { cd_pedido: 99102, pendente: true, entregue: false, pronto_despacho: true, estado_070: 'pronto_despacho' },
        99103: { cd_pedido: 99103, pendente: true, entregue: false, pronto_despacho: true, estado_070: 'pronto_despacho' },
        99104: { cd_pedido: 99104, pendente: true, entregue: false, pronto_despacho: true, estado_070: 'pronto_despacho' }
    };
    const { sb } = sbEdge068B({
        ativa070: true,
        posicoes,
        estados070,
        tabelas: {
            solidcon_pedidos_erp: [p1, p2, p3],
            rota_cliente_veiculo: [
                { documento: '66000000000001', veiculo: 's10' },
                { documento: '66000000000002', veiculo: 's10' },
                { documento: '66000000000003', veiculo: 's10' }
            ],
            rota_068_prazo_pedido: [{ cd_pedido: 99102, tipo: 'data', dias: null, data_agendada: '2026-12-09' }],
            rota_068_prazo_cliente: [
                { documento: '66000000000002', tipo: 'dias_uteis', dias: 5, dias_semana: null },
                { documento: '66000000000003', tipo: 'semana', dias: null, dias_semana: [5] }   // sex 04/12
            ]
        }
    });
    const AGORA = new Date('2026-12-03T11:00:00Z'); // qui 03/12 08:00 SP
    const d = await W.coletarRota(sb, AGORA);
    assert.deepEqual(d.prazos, { 99102: { tipo: 'data', data: '2026-12-09' } });
    assert.deepEqual(d.regrasPrazo, {
        '66000000000002': { tipo: 'dias_uteis', dias: 5 },
        '66000000000003': { tipo: 'semana', dias_semana: [5] }
    });

    // Intercepta core.planejar durante montarRota e montarChefe para provar que a Edge calcula exatamente o mesmo prazo da UI.
    const orig = core.planejar;
    const vistos = [];
    core.planejar = function () {
        const res = orig.apply(core, arguments);
        vistos.push({ opts: arguments[3], pl: res });
        return res;
    };
    try {
        const mRota = W.montarRota(d, 's10', AGORA, {});
        const mChefe = W.montarChefe(d, AGORA, { template: 'rota_sugerida' });
        assert.equal(mRota.resumo.paradas, 3);
        assert.equal(mChefe.resumo.entregas, 3);
    } finally {
        core.planejar = orig;
    }
    assert.equal(vistos.length, 2);
    for (const v of vistos) {
        assert.deepEqual(v.opts.prazos, { 99102: { tipo: 'data', data: '2026-12-09' } });
        assert.deepEqual(v.opts.regrasPrazo, {
            '66000000000002': { tipo: 'dias_uteis', dias: 5 },
            '66000000000003': { tipo: 'semana', dias_semana: [5] }
        });
        const r1 = v.pl.s10.pedidos.find((x) => x.p.cd_pedido === 99102);
        const r2 = v.pl.s10.pedidos.find((x) => x.p.cd_pedido === 99103);
        const r3 = v.pl.s10.pedidos.find((x) => x.p.cd_pedido === 99104);
        assert.equal(r1.prazo, '2026-12-09'); assert.equal(r1.situacao, 'ok');
        assert.equal(r2.prazo, '2026-12-04'); assert.equal(r2.situacao, 'amanha');
        assert.equal(r3.prazo, '2026-12-04'); assert.equal(r3.situacao, 'amanha');
    }
});

test('068B B068-R8-1 Edge: montarChefe e fecharRotaAuto 08h respeitam capacidade/prioridade pelos prazos flexiveis (excecao e regra)', async () => {
    // Capacidade da S10 = 100 (cabe APENAS 1 pedido de 10 cx24 = 90 vol; 2 pedidos = 180 > 100).
    // Pedido A (99201, dt 27/11) tem excecao prorrogada para 2026-12-09 (prazo longo).
    // Pedido B (99202, dt 02/12) sem excecao teria prazo 04/12 (depois de A=01/12!), MAS tem regra de cliente 1 dia util -> vence 03/12 (HOJE)!
    // Com 068B na Edge:
    //   - fecharRotaAuto 08h DEVE priorizar 99202 (prazo 03/12) e deixar 99201 (prazo 09/12) em fica!
    //   - montarChefe NAO deve acusar "passa do prazo" para 99201 (que fica com prazo 09/12, muito alem do proximo dia 04/12)!
    const pA = { cd_pedido: 99201, documento: '66000000000011', etapa: 'aberto', dt_pedido: '2026-11-27T10:00:00-03:00', cliente_tipo: 'cnpj', caixas_24: 10, caixas_48: 0, caixas_outras: 0 };
    const pB = { cd_pedido: 99202, documento: '66000000000012', etapa: 'aberto', dt_pedido: '2026-12-02T10:00:00-03:00', cliente_tipo: 'cnpj', caixas_24: 10, caixas_48: 0, caixas_outras: 0 };
    const posicoes = [
        { documento: '66000000000011', nome: 'Cliente Prorrogado', bairro: 'Centro', cidade: 'Rio de Janeiro', lat: -22.90, lng: -43.20, precisao: 'exata', pino_desatualizado: false },
        { documento: '66000000000012', nome: 'Cliente Regra Urgente', bairro: 'Centro', cidade: 'Rio de Janeiro', lat: -22.91, lng: -43.20, precisao: 'exata', pino_desatualizado: false }
    ];
    const { sb } = sbEdge068B({
        ativa070: false,
        capS10: 100,
        posicoes,
        tabelas: {
            solidcon_pedidos_erp: [pA, pB],
            rota_cliente_veiculo: [
                { documento: '66000000000011', veiculo: 's10' },
                { documento: '66000000000012', veiculo: 's10' }
            ],
            rota_068_prazo_pedido: [{ cd_pedido: 99201, tipo: 'data', dias: null, data_agendada: '2026-12-09' }],
            rota_068_prazo_cliente: [{ documento: '66000000000012', tipo: 'dias_uteis', dias: 1, dias_semana: null }]
        }
    });
    const QUI_0815 = new Date('2026-12-03T11:15:00Z'); // qui 03/12 08:15 SP (apos hora_saida 08:00)

    const fech = await W.fecharRotaAuto(sb, QUI_0815);
    assert.deepEqual(fech, { fechou: true, pedidos: 1 });
    const callAuto = sb.rpcs.find((r) => r.nome === 'rota_050_fechar_auto');
    assert.ok(callAuto, 'fecharRotaAuto chamou rota_050_fechar_auto');
    assert.deepEqual(callAuto.args.p_itens.map((x) => x.cd_pedido), [99202], 'fechamento 08h priorizou 99202 (regra 1du = 03/12) sobre 99201 (excecao 09/12)');

    // Mensagem rota_s10 e rota_chefe com a mesma coleta: entra 99202, fica 99201 SEM alerta "passa do prazo"!
    const mS10 = await W.gerar(sb, 'rota_s10', QUI_0815, {});
    assert.match(mS10.texto, /Cliente Regra Urgente/);
    assert.doesNotMatch(mS10.texto, /Cliente Prorrogado/);
    const mChefe = await W.gerar(sb, 'rota_chefe', QUI_0815, { template: 'rota_sugerida' });
    assert.equal(mChefe.resumo.entregas, 1);
    assert.equal(mChefe.resumo.fica, 1);
    assert.doesNotMatch(mChefe.texto, /passa do prazo|passam do prazo/, '99201 tem excecao 09/12: chefe nao deve alarmar vencimento falso');
});

test('068B B068-R8-1 Edge: tabela 068B ausente mantem compatibilidade; erro real de leitura rejeita coleta e fechamento 08h', async () => {
    const p1 = { cd_pedido: 99301, documento: '66000000000021', etapa: 'conferido', dt_pedido: '2026-11-27T10:00:00-03:00', cliente_tipo: 'cnpj', caixas_24: 2, caixas_48: 0, caixas_outras: 0 };
    const posicoes = [{ documento: '66000000000021', nome: 'QA Compat', bairro: 'Centro', cidade: 'Rio de Janeiro', lat: -22.90, lng: -43.20, precisao: 'exata', pino_desatualizado: false }];
    const QUI_0815 = new Date('2026-12-03T11:15:00Z');

    // Sem 068B (PGRST205): coleta e fechamento seguem normalmente com mapas vazios.
    const sem = sbEdge068B({
        sem068B: true, posicoes,
        tabelas: { solidcon_pedidos_erp: [p1], rota_cliente_veiculo: [{ documento: '66000000000021', veiculo: 's10' }] }
    });
    const dSem = await W.coletarRota(sem.sb, QUI_0815);
    assert.deepEqual(dSem.prazos, {});
    assert.deepEqual(dSem.regrasPrazo, {});
    assert.deepEqual(await W.fecharRotaAuto(sem.sb, QUI_0815), { fechou: true, pedidos: 1 });

    // Com erro real (timeout 57014 ou permissao 42501) em qualquer tabela 068B: rejeita coleta E fechamento 08h!
    for (const tab of ['rota_068_prazo_pedido', 'rota_068_prazo_cliente']) {
        for (const err of [
            { code: '57014', message: 'canceling statement due to statement timeout' },
            { code: '42501', message: 'permission denied for table ' + tab }
        ]) {
            const comErro = sbEdge068B({
                posicoes,
                tabelas: { solidcon_pedidos_erp: [p1], rota_cliente_veiculo: [{ documento: '66000000000021', veiculo: 's10' }] },
                erros: { [tab]: err }
            });
            await assert.rejects(W.coletarRota(comErro.sb, QUI_0815), new RegExp(err.message.split(' ')[0]));
            await assert.rejects(W.fecharRotaAuto(comErro.sb, QUI_0815), new RegExp(err.message.split(' ')[0]));
        }
    }
});
