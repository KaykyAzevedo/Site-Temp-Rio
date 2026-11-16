/* =====================================================================
 * ROTA DO DIA (aba "Rotas" do painel) — módulo separado do admin.js.
 *
 * O que faz: pega os pedidos do ERP ainda não saídos (Kanban do WMS), separa os do CEASA (caminhão) dos
 * demais (S10), escolhe o que cabe na S10 por PRAZO e VOLUME, e ordena as paradas a partir da sede
 * ("vai chegando e vai entregando"): vizinho mais próximo + melhoria 2-opt sobre distância em linha reta.
 *
 * Privacidade: o planejamento roda no navegador. O mapa-base é carregado do OpenStreetMap; nenhum dado de cliente
 * é enviado. O botão "Abrir no Google Maps" só existe no clique e leva SÓ coordenadas (sem nome, documento ou endereço).
 *
 * Fontes (somente leitura, RLS eh_equipe — admin e vendedor):
 *   solidcon_pedidos_erp (035; caixas_24/48/outras da 039 — 'caixas_outras' são POTES AVULSOS, ver ROTA.VOLUME_POTE),
 *   solidcon_pedidos_erp_sync,
 *   RPC solidcon_mapa_clientes (posição ATUAL do cliente: ignora pino de endereço antigo) e
 *   solidcon_clientes (logradouro/número/bairro para a regra do CEASA e a lista).
 * ===================================================================== */
(function (raiz) {
    'use strict';

    // Planejador PURO (regras, datas/feriados, volume, veículo, ordem, Google Maps): supabase/functions/_shared/rota-core.js,
    // o MESMO arquivo usado pela Edge Function whatsapp-rotinas (rota para os entregadores). Aqui fica só a interface.
    var ehNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
    var core = ehNode ? require('../supabase/functions/_shared/rota-core.js') : raiz.TempRioRotaCore;
    if (!core) { if (raiz.console) raiz.console.error('[rotas] rota-core.js não carregou (admin.html deve carregá-lo antes de admin-rota.js).'); return; }
    var ROTA = core.ROTA;
    var CFG_PADRAO = core.CFG_PADRAO;
    var normBairro = core.normBairro;
    var cfgDe = core.cfgDe;
    var diaSP = core.diaSP;
    var somaDias = core.somaDias;
    var diaSemana = core.diaSemana;
    var feriadosDoAno = core.feriadosDoAno;
    var dataBr = core.dataBr;
    var nomeDia = core.nomeDia;
    var proximaSaida = core.proximaSaida;
    var km = core.km;
    var norm = core.norm;
    var planejar = core.planejar;
    var linksGoogleMaps = core.linksGoogleMaps;
    var Planejador = core;   // testes e TempRioRota.planejador
    if (ehNode) { module.exports = Planejador; return; }   // node: só o planejador

    // ===================== UI (navegador) =====================
    var st = { carregado: false, carregando: false, erro: null, pedidos: [], clientes: {}, coletado: null, temCaixas: false,
               vista: 'hoje', mapa: null, ro: null, sb: null, papel: null, alvo: null, seq: 0, ativo: false,
               // 040: configuração (linha de rota_config ou null), exceções por cliente e sugestões de bairro
               cfgLinha: null, cfg: cfgDe(CFG_PADRAO), cfgAusente: false, cfgErro: null, excecoes: {}, bairrosConhecidos: [],
               cfgAberto: false, msgVeiculo: '', focoVeiculo: null,
               gravandoVeiculo: {}, seqVeiculo: {},   // R2: exceção por cliente em gravação (trava o menu dele) e sequência
               dlgSalvando: false, dlgAbertura: 0 };  // R3: gravação do "Configurar rota" pendente (fora do botão)
    var NUM = new Intl.NumberFormat('pt-BR'), NUM1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function brl(c) { return c == null ? '—' : (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
    function hojeSP() { return diaSP(new Date()); }

    function paginar(fazer, max) {
        var todos = [];
        function pagina(ini) {
            return fazer().range(ini, ini + 999).then(function (r) {
                if (r.error) return { error: r.error };
                todos = todos.concat(r.data || []);
                if ((r.data || []).length === 1000 && todos.length < max) return pagina(ini + 1000);
                return { data: todos };
            });
        }
        return pagina(0);
    }

    // Celular/tela estreita/toque: lote menor (limite de paradas do app do Google Maps).
    function ehMovel() { try { return !!(window.matchMedia && window.matchMedia(ROTA.MOVEL_MQ).matches); } catch (e) { return false; } }
    function loteGmaps() { return ehMovel() ? ROTA.LOTE_GMAPS_MOVEL : ROTA.LOTE_GMAPS; }

    // Solta o mapa Leaflet e o ResizeObserver. Chamado ANTES de qualquer troca do HTML da aba (carregando, erro,
    // redesenho) e ao sair da aba/do painel: nada fica preso a um nó que já saiu do DOM.
    function liberarMapa() {
        if (st.ro) { try { st.ro.disconnect(); } catch (e) { /* já solto */ } st.ro = null; }
        if (st.mapa) { try { st.mapa.remove(); } catch (e) { /* já removido */ } st.mapa = null; }
    }

    function carregar() {
        if (!st.sb || st.carregando || !st.ativo) return;
        var seq = ++st.seq, sb = st.sb;
        st.carregando = true; st.erro = null; desenhar();
        Promise.all([
            paginar(function () { return sb.from('solidcon_pedidos_erp').select('*').in('etapa', ROTA.ETAPAS_PENDENTES).order('cd_pedido', { ascending: true }); }, 5000),
            sb.from('solidcon_pedidos_erp_sync').select('coletado_em').eq('status', 'ok').order('coletado_em', { ascending: false }).limit(1),
            paginar(function () { return sb.rpc('solidcon_mapa_clientes').order('documento', { ascending: true }); }, 20000),
            // 040 (opcional): configuração e exceções por cliente. Sem a migração: padrões, sem erro.
            sb.from('rota_config').select('*').eq('id', 1).limit(1),
            paginar(function () { return sb.from('rota_cliente_veiculo').select('documento,veiculo').order('documento', { ascending: true }); }, 20000)
        ]).then(function (rs) {
            if (seq !== st.seq) return;
            if (rs[0].error) throw rs[0].error;
            var pedidos = rs[0].data || [];
            var docs = {}; pedidos.forEach(function (p) { if (p.documento) docs[p.documento] = true; });
            var lista = Object.keys(docs);
            // Endereço (regra do CEASA e lista): só dos clientes com pedido pendente, em blocos.
            var blocos = [];
            for (var i = 0; i < lista.length; i += 200) blocos.push(lista.slice(i, i + 200));
            // Posição: solidcon_rota_posicoes (041) por documento COM PEDIDO — sem o filtro comercial do mapa (fornecedor
            // com pedido real continua com posição e com a regra do CEASA por raio). Sem a 041: posição do mapa (antes).
            var pBlocos = [];
            for (var j = 0; j < lista.length; j += 500) pBlocos.push(lista.slice(j, j + 500));
            var posicoes = Promise.all(pBlocos.map(function (b) { return sb.rpc('solidcon_rota_posicoes', { p_documentos: b }); }))
                .then(function (ps) {
                    var e = ps.filter(function (r) { return r.error; })[0];
                    if (e) return rpcAusente(e.error) ? null : { erro: String(e.error.message || e.error) };
                    return { linhas: [].concat.apply([], ps.map(function (r) { return r.data || []; })) };
                }, function (e) { return { erro: String((e && e.message) || e) }; });
            return Promise.all([Promise.all(blocos.map(function (b) {
                return sb.from('solidcon_clientes').select('documento,nome,logradouro,numero,complemento,bairro,cidade,estado').in('documento', b);
            })), posicoes]).then(function (cp) {
                if (seq !== st.seq) return;
                var cs = cp[0], rp = cp[1];
                var cli = {};
                cs.forEach(function (r) { if (!r.error) (r.data || []).forEach(function (c) { cli[c.documento] = { nome: c.nome, logradouro: c.logradouro, numero: c.numero,
                    complemento: c.complemento, bairro: c.bairro, cidade: c.cidade, pos: null, precisao: null }; }); });
                function posDe(m) {
                    if (!docs[m.documento]) return;
                    var c = cli[m.documento] || (cli[m.documento] = { nome: m.nome, bairro: m.bairro, cidade: m.cidade, pos: null });
                    var lat = Number(m.lat), lng = Number(m.lng);
                    if (m.lat != null && m.lng != null && isFinite(lat) && isFinite(lng) && !m.pino_desatualizado) { c.pos = [lat, lng]; c.precisao = m.precisao; }
                }
                var mapa = rs[2] && !rs[2].error ? rs[2].data || [] : [];
                var bairros = {};   // sugestões do "bairros do caminhão": bairros de TODOS os clientes CNPJ do ERP
                mapa.forEach(function (m) {
                    var nb = normBairro(m.bairro);
                    if (nb) { var b = bairros[nb] || (bairros[nb] = { norm: nb, nome: String(m.bairro).trim(), n: 0 }); b.n++; }
                    if (!rp) posDe(m);   // sem a 041: posição vem do mapa (comportamento anterior)
                });
                if (rp && rp.linhas) rp.linhas.forEach(posDe);
                st.bairrosConhecidos = Object.keys(bairros).map(function (k) { return bairros[k]; }).sort(function (a, b) { return a.norm.localeCompare(b.norm, 'pt-BR'); });
                st.pedidos = pedidos; st.clientes = cli;
                st.temCaixas = pedidos.some(function (p) { return 'caixas_24' in p; });
                var sy = rs[1] && !rs[1].error && rs[1].data && rs[1].data[0];
                st.coletado = sy ? sy.coletado_em : null;
                st.posErro = rp && rp.erro ? rp.erro : (!rp && rs[2] && rs[2].error ? String(rs[2].error.message || rs[2].error) : null);
                lerConfig(rs[3], rs[4]);
                st.carregando = false; st.carregado = true; desenhar();
            });
        }).catch(function (e) {
            if (seq !== st.seq) return;
            st.carregando = false; st.carregado = false; st.erro = String((e && e.message) || e); desenhar();
        });
    }

    // Função inexistente (041 não aplicada): PostgREST PGRST202 / Postgres 42883.
    function rpcAusente(err) { return !!err && /PGRST202|42883|Could not find the function/i.test(String(err.code || '') + ' ' + String(err.message || '')); }
    // Tabela inexistente (040 não aplicada): PostgREST PGRST205 / Postgres 42P01.
    function tabelaAusente(err) { return !!err && /PGRST205|42P01|does not exist|Could not find the table/i.test(String(err.code || '') + ' ' + String(err.message || '')); }
    function lerConfig(rc, rx) {
        st.cfgAusente = false; st.cfgErro = null;
        if (rc && rc.error) {
            if (tabelaAusente(rc.error)) st.cfgAusente = true; else st.cfgErro = String(rc.error.message || rc.error);
            st.cfgLinha = null;
        } else st.cfgLinha = rc && rc.data && rc.data[0] ? rc.data[0] : null;
        st.excecoes = {};
        if (rx && !rx.error) (rx.data || []).forEach(function (e) { if (e.veiculo === 'caminhao' || e.veiculo === 's10') st.excecoes[e.documento] = e.veiculo; });
        else if (rx && rx.error && !tabelaAusente(rx.error)) st.cfgErro = st.cfgErro || String(rx.error.message || rx.error);
        st.cfg = cfgDe(st.cfgLinha || CFG_PADRAO);
    }
    function podeEditar() { return st.papel === 'admin' && !st.cfgAusente; }

    var SIT = { vencido: ['Vencido', 'rota-sit-vencido', 'fa-triangle-exclamation'], hoje: ['Vence hoje', 'rota-sit-hoje', 'fa-hourglass-end'],
                amanha: ['Vence na próxima saída', 'rota-sit-amanha', 'fa-hourglass-half'], ok: ['No prazo', 'rota-sit-ok', 'fa-check'], sem_data: ['Sem data', 'rota-sit-ok', 'fa-question'] };
    function seloPrazo(x) {
        var s = SIT[x.situacao] || SIT.ok;
        return '<span class="rota-sit ' + s[1] + '"><i class="fa-solid ' + s[2] + '" aria-hidden="true"></i>' + s[0] + (x.prazo ? ' · ' + dataBr(x.prazo) : '') + '</span>';
    }
    // '530 potes avulsos (≈22 cx24)': potes de produto com código próprio, em caixas de 24 equivalentes.
    function txtAvulsos(n) {
        return NUM.format(n) + (n === 1 ? ' pote avulso' : ' potes avulsos') + ' (≈' + NUM.format(Math.round(n / 24)) + ' cx24)';
    }
    // Resumo curto das caixas de uma parada (janelinha do mapa).
    function resumoParada(sp) {
        var c24 = 0, c48 = 0, av = 0, desc = 0;
        sp.pedidos.forEach(function (x) { if (x.v.vol == null) desc++; else { c24 += x.v.c24; c48 += x.v.c48; av += x.v.avulsos; } });
        var p = [];
        if (c24) p.push(NUM.format(c24) + ' cx24');
        if (c48) p.push(NUM.format(c48) + ' cx48');
        if (av) p.push(txtAvulsos(av));
        if (desc) p.push(desc === 1 ? 'volume desconhecido' : NUM.format(desc) + ' pedidos sem volume');
        return p.join(' + ');
    }
    function txtCaixas(v) {
        if (v.vol == null) return '<span class="rota-aviso-txt"><i class="fa-solid fa-circle-question" aria-hidden="true"></i> volume desconhecido</span>';
        var p = [];
        if (v.c24) p.push(NUM.format(v.c24) + ' cx24');
        if (v.c48) p.push(NUM.format(v.c48) + ' cx48');
        if (v.avulsos) p.push(txtAvulsos(v.avulsos));
        return p.join(' + ') || '0 cx';
    }
    function nomeCliente(c, x) {
        if (c && c.nome) return c.nome;
        if (x.p.cliente_tipo === 'cpf') return 'Consumidor final (CPF)';
        if (x.p.cliente_tipo === 'indefinido') return 'Cliente sem documento no ERP';
        return 'Cliente ' + (x.p.documento || '');
    }

    // O "porquê" do veículo (ícone + texto; a cor nunca é a única pista).
    var MOTIVO_CEASA = { endereco: 'endereço com "CEASA"', av_brasil_19001: 'Av. Brasil, 19001', raio: 'a até 600 m do CEASA' };
    function seloMotivo(o) {
        if (o.motivo === 'excecao') return '<span class="rota-motivo rota-motivo-excecao" title="Definido manualmente para este cliente"><i class="fa-solid fa-hand-pointer" aria-hidden="true"></i>Exceção: vai ' + (o.veiculo === 'caminhao' ? 'no caminhão' : 'na S10') + '</span>';
        if (o.motivo === 'ceasa') return '<span class="rota-motivo"><i class="fa-solid fa-warehouse" aria-hidden="true"></i>CEASA (' + esc(MOTIVO_CEASA[o.detalhe] || o.detalhe) + ')</span>';
        if (o.motivo === 'bairro') return '<span class="rota-motivo"><i class="fa-solid fa-map-pin" aria-hidden="true"></i>Bairro do caminhão (' + esc(o.detalhe) + ')</span>';
        return '<span class="rota-motivo rota-motivo-padrao"><i class="fa-solid fa-truck-pickup" aria-hidden="true"></i>S10 (padrão)</span>';
    }
    // Menu do admin: Automático / Caminhão / S10 (grava a exceção em rota_cliente_veiculo).
    function menuVeiculo(doc, nome) {
        if (!podeEditar() || !doc) return '';
        var atual = st.excecoes[doc] || '';
        return '<label class="rota-veic no-print"><span class="sr-only">Veículo de ' + esc(nome) + '</span>' +
            '<select class="adm-input" data-rota-veiculo="' + esc(doc) + '" aria-label="Veículo de ' + esc(nome) + '"' + (st.gravandoVeiculo[doc] ? ' disabled aria-busy="true"' : '') + '>' +
            '<option value=""' + (atual ? '' : ' selected') + '>Automático</option>' +
            '<option value="caminhao"' + (atual === 'caminhao' ? ' selected' : '') + '>Vai no caminhão</option>' +
            '<option value="s10"' + (atual === 's10' ? ' selected' : '') + '>Vai na S10</option></select></label>';
    }

    function htmlParada(sp, n) {
        var cx = sp.pedidos.map(function (x) { return txtCaixas(x.v); }).join('<br>');
        var val = sp.pedidos.reduce(function (a, x) { return a + (Number(x.p.valor_centavos) || 0); }, 0);
        var pior = sp.pedidos.slice().sort(function (a, b) { return String(a.prazo || '9') < String(b.prazo || '9') ? -1 : 1; })[0];
        var nome = sp.nome || nomeCliente(null, sp.pedidos[0]);
        return '<tr><td class="rota-n">' + (n == null ? '—' : n) + '</td><td><strong>' + esc(nome) + '</strong>' +
            '<div class="rota-sub">' + esc([sp.bairro, sp.cidade].filter(Boolean).join(' · ') || 'sem bairro') +
            ' · pedido' + (sp.pedidos.length > 1 ? 's ' : ' ') + sp.pedidos.map(function (x) { return esc(x.p.cd_pedido); }).join(', ') +
            (sp.precisao === 'bairro' ? ' · <span class="rota-aviso-txt">posição aproximada (bairro)</span>' : '') + '</div></td>' +
            '<td data-rotulo="Caixas">' + cx + '</td><td class="num" data-rotulo="Valor">' + esc(brl(val)) + '</td><td data-rotulo="Prazo">' + seloPrazo(pior) + '</td>' +
            '<td data-rotulo="Veículo">' + seloMotivo(sp) + menuVeiculo(sp.documento, nome) + '</td></tr>';
    }
    function tabelaParadas(g, vazio) {
        var n = g.paradas.length + g.semPosicao.length;
        if (!n) return '<p class="adm-vazio-linha"><span class="adm-vazio-titulo">' + esc(vazio) + '</span></p>';
        return '<div class="overflow-x-auto"><table class="adm-tabela rota-tabela"><thead><tr><th>#</th><th>Cliente</th><th>Caixas</th><th class="num">Valor</th><th>Prazo</th><th>Veículo</th></tr></thead><tbody>' +
            g.paradas.map(function (sp, i) { return htmlParada(sp, i + 1); }).join('') +
            (g.semPosicao.length ? '<tr class="rota-sep"><td colspan="6">Sem posição no mapa — entregar conforme o bairro</td></tr>' + g.semPosicao.map(function (sp) { return htmlParada(sp, null); }).join('') : '') +
            '</tbody></table></div>';
    }
    function botoesGmaps(paradas) {
        var links = paradas.length ? linksGoogleMaps(paradas, loteGmaps()) : [];
        if (!links.length) return '';
        return '<div class="rota-gmaps no-print">' + links.map(function (l) {
            return '<button type="button" class="adm-botao-fantasma" data-rota-gmaps="' + esc(l.url) + '"><i class="fa-solid fa-diamond-turn-right" aria-hidden="true"></i> Abrir no Google Maps' +
                (links.length > 1 ? (l.de === l.ate ? ' (parada ' + l.de + ')' : ' (paradas ' + l.de + '–' + l.ate + ')') : '') + '</button>';
        }).join('') + '<span class="rota-sub">Só as coordenadas vão para o Google (sem nome ou endereço).</span></div>';
    }

    function htmlS10(pl) {
        var s = pl.s10, pct = Math.min(100, Math.round(s.volume / ROTA.CAPACIDADE_S10 * 100)), cheio = s.volume > ROTA.CAPACIDADE_S10 * 0.95;
        var nParadas = s.paradas.length + s.semPosicao.length;
        var avisos = [];
        if (s.desconhecidos) avisos.push(NUM.format(s.desconhecidos) + (s.desconhecidos === 1 ? ' pedido com volume desconhecido (não entra na conta)' : ' pedidos com volume desconhecido (não entram na conta)'));
        if (s.semPosicao.length) avisos.push(NUM.format(s.semPosicao.length) + (s.semPosicao.length === 1 ? ' parada sem posição no mapa (no fim, por bairro)' : ' paradas sem posição no mapa (no fim, por bairro)'));
        return '<section class="adm-card p-5 mb-6 rota-cartao" aria-labelledby="rota-s10-tit">' +
            '<div class="rota-cab"><div><p class="rota-tit" id="rota-s10-tit"><i class="fa-solid fa-truck-pickup" aria-hidden="true"></i> S10 (caminhonete + carreta)</p>' +
            '<p class="rota-sub">Onde o caminhão não atende · sai da sede e entrega na ordem do caminho</p></div>' +
            '<div class="rota-kpis"><span><strong>' + NUM.format(nParadas) + '</strong> parada' + (nParadas === 1 ? '' : 's') + '</span>' +
            '<span><strong>' + NUM.format(s.pedidos.length) + '</strong> pedido' + (s.pedidos.length === 1 ? '' : 's') + '</span>' +
            '<span title="Linha reta × ' + NUM1.format(ROTA.FATOR_ESTRADA) + (s.volta ? '; inclui a volta para a sede' : '; não inclui a volta para a sede') + '"><strong>~' + NUM.format(Math.round(s.km)) + ' km</strong> estimados' +
                (s.volta ? ' (com volta)' : '') + '</span></div></div>' +
            '<div class="rota-ocup" role="img" aria-label="Ocupação da S10: ' + NUM1.format(s.volume) + ' de ' + NUM.format(ROTA.CAPACIDADE_S10) + ' (' + pct + '%)">' +
                '<div class="rota-ocup-barra' + (cheio ? ' is-cheia' : '') + '" style="width:' + pct + '%"></div></div>' +
            '<p class="rota-sub mt-1">Volume ' + NUM1.format(s.volume) + ' de ' + NUM.format(ROTA.CAPACIDADE_S10) + ' (' + pct + '%) · ' + NUM.format(s.c24) + ' cx24 · ' + NUM.format(s.c48) + ' cx48' +
                (s.avulsos ? ' · ' + txtAvulsos(s.avulsos) + ' — inclui potes avulsos' : '') +
                ' · cabe ~' + NUM.format(Math.floor((ROTA.CAPACIDADE_S10 - s.volume) / ROTA.VOLUME_CX24)) + ' cx24 a mais</p>' +
            (avisos.length ? '<ul class="rota-avisos">' + avisos.map(function (a) { return '<li><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> ' + esc(a) + '</li>'; }).join('') + '</ul>' : '') +
            (s.paradas.length ? '<div id="rota-mapa" class="adm-mapa-escuro rota-mapa" role="img" aria-label="Mapa da rota da S10 com ' + NUM.format(s.paradas.length) + ' paradas numeradas"></div>' : '') +
            botoesGmaps(s.paradas) + tabelaParadas(s, 'Nada para a S10 neste dia') + '</section>';
    }

    function htmlFica(pl) {
        if (!pl.fica.length) return '';
        var estouram = pl.fica.filter(function (x) { return x.estoura; }).length;
        return '<section class="adm-card p-5 mb-6 rota-cartao' + (estouram ? ' rota-cartao-alerta' : '') + '" aria-labelledby="rota-fica-tit">' +
            '<p class="rota-tit" id="rota-fica-tit"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> Fica para a próxima saída (' +
                (pl.fica[0].proxima ? esc(nomeDia(pl.fica[0].proxima)) + ' ' + esc(dataBr(pl.fica[0].proxima)) : 'sem saída nos próximos ' + NUM.format(ROTA.BUSCA_SAIDA_DIAS) + ' dias') + ')</p>' +
            '<p class="rota-sub mb-3">Não coube na S10 (capacidade ' + NUM.format(ROTA.CAPACIDADE_S10) + ')' +
                (pl.fica.some(function (x) { return x.semVolume; }) ? ', ou está sem volume conhecido e ainda dá prazo na próxima saída' : '') + '.' +
                (estouram ? ' <strong class="rota-txt-ruim">' + NUM.format(estouram) + (estouram === 1 ? ' pedido vai passar do prazo' : ' pedidos vão passar do prazo') + '.</strong>' : '') + '</p>' +
            '<div class="overflow-x-auto"><table class="adm-tabela rota-tabela"><thead><tr><th>Cliente</th><th>Caixas</th><th class="num">Valor</th><th>Prazo</th><th>Veículo</th></tr></thead><tbody>' +
            pl.fica.map(function (x) {
                var nome = nomeCliente(x.c, x);
                return '<tr' + (x.estoura ? ' class="rota-linha-ruim"' : '') + '><td><strong>' + esc(nome) + '</strong><div class="rota-sub">' + esc((x.c && x.c.bairro) || 'sem bairro') +
                    ' · pedido ' + esc(x.p.cd_pedido) + (x.estoura ? ' · <strong class="rota-txt-ruim">passa do prazo</strong>' : '') + '</div></td><td data-rotulo="Caixas">' + txtCaixas(x.v) + '</td>' +
                    '<td class="num" data-rotulo="Valor">' + esc(brl(x.p.valor_centavos)) + '</td><td data-rotulo="Prazo">' + seloPrazo(x) + '</td>' +
                    '<td data-rotulo="Veículo">' + seloMotivo(x) + menuVeiculo(x.p.documento, nome) + '</td></tr>';
            }).join('') + '</tbody></table></div></section>';
    }

    // Caminhão: CEASA + bairros que ficam no caminho (rota_config) + exceções. Sem limite de capacidade; ordem pelo caminho.
    function htmlCaminhao(pl) {
        var c = pl.caminhao, n = c.paradas.length + c.semPosicao.length, bairros = Object.keys(pl.cfg.bairrosCaminhao);
        return '<section class="adm-card p-5 mb-6 rota-cartao" aria-labelledby="rota-cam-tit">' +
            '<div class="rota-cab"><div><p class="rota-tit" id="rota-cam-tit"><i class="fa-solid fa-truck" aria-hidden="true"></i> Caminhão do CEASA</p>' +
            '<p class="rota-sub">CEASA-RJ (Av. Brasil, 19001)' + (bairros.length ? ' + ' + NUM.format(bairros.length) + (bairros.length === 1 ? ' bairro no caminho' : ' bairros no caminho') : '') +
                ' · sem limite de capacidade · ordem pelo caminho saindo da sede</p></div>' +
            '<div class="rota-kpis"><span><strong>' + NUM.format(n) + '</strong> parada' + (n === 1 ? '' : 's') + '</span><span><strong>' +
                NUM.format(c.pedidos.length) + '</strong> pedido' + (c.pedidos.length === 1 ? '' : 's') + '</span><span>' + NUM.format(c.c24) + ' cx24 · ' + NUM.format(c.c48) + ' cx48' +
                (c.avulsos ? ' · ' + txtAvulsos(c.avulsos) : '') + (c.desconhecidos ? ' · ' + NUM.format(c.desconhecidos) + ' sem caixas' : '') + '</span>' +
                (c.paradas.length ? '<span title="Linha reta × ' + NUM1.format(ROTA.FATOR_ESTRADA) + '; sem a volta"><strong>~' + NUM.format(Math.round(c.km)) + ' km</strong> estimados</span>' : '') + '</div></div>' +
            botoesGmaps(c.paradas) + tabelaParadas(c, 'Nenhum pedido para o caminhão neste dia') + '</section>';
    }

    // ---------- configuração: resumo (todos) + diálogo de edição (só admin) ----------
    function htmlConfigResumo(pl) {
        var cfg = pl.cfg, bairros = Object.keys(cfg.bairrosCaminhao).sort(), extras = Object.keys(cfg.feriadosExtras).sort();
        var itens = [
            'Bairros do caminhão: ' + (bairros.length ? esc(bairros.join(', ')) : 'nenhum (só o CEASA)'),
            'Feriados: ' + (cfg.feriadosSemSaida ? 'sem saída (nacionais, Carnaval, Sexta-feira Santa, Corpus Christi' + (extras.length ? ' e ' + esc(extras.map(dataBr).join(', ')) : '') + ')' : 'têm saída normal'),
            'Corte do pedido: ' + (cfg.corteHora == null ? 'sem corte' : 'a partir das ' + cfg.corteHora + 'h o prazo conta do dia seguinte'),
            'Volta da S10: ' + (cfg.voltaSede ? 'o km inclui a volta para a sede' : 'o km não inclui a volta'),
            'Exceções por cliente: ' + NUM.format(Object.keys(st.excecoes).length)
        ];
        var aviso = st.cfgAusente ? '<p class="rota-sub mt-2"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Configuração ainda não instalada (migração 040): valem os padrões acima.</p>'
            : st.cfgErro ? '<p class="rota-sub mt-2 rota-txt-ruim">Não foi possível ler a configuração (' + esc(st.cfgErro) + '): valem os padrões.</p>' : '';
        return '<details class="rota-config-resumo adm-card p-4 mb-5"' + (st.cfgAberto ? ' open' : '') + '><summary><i class="fa-solid fa-sliders" aria-hidden="true"></i> Regras da rota</summary>' +
            '<ul>' + itens.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' + aviso + '</details>';
    }
    function htmlDialogo() {
        var cfg = st.cfg, bairros = Object.keys(cfg.bairrosCaminhao).sort(), extras = Object.keys(cfg.feriadosExtras).sort();
        var horas = '<option value=""' + (cfg.corteHora == null ? ' selected' : '') + '>Sem corte</option>';
        for (var h = 0; h < 24; h++) horas += '<option value="' + h + '"' + (cfg.corteHora === h ? ' selected' : '') + '>A partir das ' + String(h).padStart(2, '0') + 'h</option>';
        var hoje = hojeSP(), prox = [];
        for (var i = 0, d = hoje; i < 120 && prox.length < 6; i++, d = somaDias(d, 1)) { if (feriadosDoAno(Number(d.slice(0, 4)))[d] && ROTA.DIAS_SEM_SAIDA.indexOf(diaSemana(d)) < 0) prox.push(d); }
        return '<dialog class="rota-dialogo" id="rota-dialogo" aria-labelledby="rota-dlg-tit">' +
            '<form method="dialog" class="rota-dlg-form" id="rota-dlg-form" novalidate>' +
            '<h3 id="rota-dlg-tit" class="rota-tit"><i class="fa-solid fa-sliders" aria-hidden="true"></i> Configurar rota</h3>' +
            '<fieldset><legend>Bairros que o caminhão do CEASA atende no caminho</legend>' +
                '<p class="rota-sub">Quem é desses bairros vai no caminhão (sem acento: "Irajá" = "IRAJA"). O resto vai na S10.</p>' +
                '<div class="rota-dlg-linha"><label for="rota-dlg-bairro" class="sr-only">Bairro</label>' +
                '<input id="rota-dlg-bairro" class="adm-input" list="rota-dlg-bairros" autocomplete="off" placeholder="Digite o bairro (sugestões dos clientes do ERP)">' +
                '<datalist id="rota-dlg-bairros">' + st.bairrosConhecidos.map(function (b) { return '<option value="' + esc(b.nome) + '" label="' + esc(b.nome + ' · ' + b.n + (b.n === 1 ? ' cliente' : ' clientes')) + '"></option>'; }).join('') + '</datalist>' +
                '<button type="button" class="adm-botao-fantasma" id="rota-dlg-add-bairro">Adicionar</button></div>' +
                '<ul class="rota-chips" id="rota-dlg-chips" aria-label="Bairros do caminhão">' + bairros.map(chipBairro).join('') + '</ul></fieldset>' +
            '<fieldset><legend>Feriados</legend>' +
                '<label class="rota-dlg-check"><input type="checkbox" id="rota-dlg-feriados"' + (cfg.feriadosSemSaida ? ' checked' : '') + '> Feriado não tem saída e não conta como dia útil</label>' +
                '<p class="rota-sub">Nacionais + Carnaval (seg e ter), Sexta-feira Santa e Corpus Christi (calculados pela Páscoa). Próximos: ' +
                    (prox.length ? esc(prox.map(function (x) { return dataBr(x); }).join(', ')) : 'nenhum nos próximos meses') + '.</p>' +
                '<div class="rota-dlg-linha"><label for="rota-dlg-data">Data a mais sem saída</label><input type="date" id="rota-dlg-data" class="adm-input">' +
                '<button type="button" class="adm-botao-fantasma" id="rota-dlg-add-data">Adicionar</button></div>' +
                '<ul class="rota-chips" id="rota-dlg-datas" aria-label="Datas extras sem saída">' + extras.map(chipData).join('') + '</ul></fieldset>' +
            '<fieldset><legend>Horário de corte do pedido</legend>' +
                '<label for="rota-dlg-corte" class="rota-sub">Pedido feito a partir desta hora conta o prazo do dia seguinte</label>' +
                '<select id="rota-dlg-corte" class="adm-input">' + horas + '</select></fieldset>' +
            '<fieldset><legend>S10</legend>' +
                '<label class="rota-dlg-check"><input type="checkbox" id="rota-dlg-volta"' + (cfg.voltaSede ? ' checked' : '') + '> A S10 volta para a sede no fim (o km estimado inclui a volta)</label></fieldset>' +
            '<p class="rota-dlg-msg" id="rota-dlg-msg" role="alert"></p>' +
            '<div class="rota-dlg-acoes"><button type="button" class="adm-botao-fantasma" id="rota-dlg-cancelar">Cancelar</button>' +
                '<button type="button" class="adm-botao" id="rota-dlg-salvar">Salvar</button></div>' +
            '</form></dialog>';
    }
    function chipBairro(b) {
        return '<li><span>' + esc(b) + '</span><button type="button" class="rota-chip-x" data-rota-tira-bairro="' + esc(b) + '" aria-label="Tirar ' + esc(b) + '"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></li>';
    }
    function chipData(d) {
        return '<li><span>' + esc(dataBr(d) + '/' + d.slice(0, 4)) + '</span><button type="button" class="rota-chip-x" data-rota-tira-data="' + esc(d) + '" aria-label="Tirar ' + esc(dataBr(d)) + '"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></li>';
    }
    // Diálogo "Configurar rota". Os ouvintes são ligados UMA vez por elemento (dlg._ligado); cada abertura só zera
    // o rascunho e os campos. Fechar (Cancelar/Esc) não redesenha a aba: só devolve o foco ao botão. (Antes o fechar
    // redesenhava por evento 'close' + timer; o Chrome entregava esses redesenhos atrasados e eles trocavam o diálogo
    // recém-aberto por um fechado.)
    function abrirDialogo() {
        var dlg = document.getElementById('rota-dialogo');
        if (!dlg || typeof dlg.showModal !== 'function' || dlg.open || st.dlgSalvando) return;   // não reabre com gravação pendente
        dlg._abertura = (st.dlgAbertura = (st.dlgAbertura || 0) + 1);
        dlg._rasc = { bairros: Object.keys(st.cfg.bairrosCaminhao).sort(), datas: Object.keys(st.cfg.feriadosExtras).sort() };
        dlg.querySelector('#rota-dlg-bairro').value = '';
        dlg.querySelector('#rota-dlg-data').value = '';
        dlg.querySelector('#rota-dlg-corte').value = st.cfg.corteHora == null ? '' : String(st.cfg.corteHora);
        dlg.querySelector('#rota-dlg-feriados').checked = !!st.cfg.feriadosSemSaida;
        dlg.querySelector('#rota-dlg-volta').checked = !!st.cfg.voltaSede;
        dlg.querySelector('#rota-dlg-msg').textContent = '';
        dlgTravar(dlg, false);
        dlgChips(dlg);
        if (!dlg._ligado) { ligarDialogo(dlg); dlg._ligado = true; }
        dlg.showModal();
        dlg.querySelector('#rota-dlg-bairro').focus();
    }
    // Durante a gravação: Salvar/Cancelar desabilitados, Esc ignorado, campos travados (aria-busy no formulário).
    function dlgTravar(dlg, sim) {
        ['#rota-dlg-salvar', '#rota-dlg-cancelar', '#rota-dlg-add-bairro', '#rota-dlg-add-data', '#rota-dlg-bairro', '#rota-dlg-data', '#rota-dlg-corte',
         '#rota-dlg-feriados', '#rota-dlg-volta'].forEach(function (q) { var e = dlg.querySelector(q); if (e) e.disabled = sim; });
        dlg.querySelectorAll('[data-rota-tira-bairro],[data-rota-tira-data]').forEach(function (e) { e.disabled = sim; });
        var f = dlg.querySelector('#rota-dlg-form'); if (f) { if (sim) f.setAttribute('aria-busy', 'true'); else f.removeAttribute('aria-busy'); }
    }
    function dlgChips(dlg) {
        dlg.querySelector('#rota-dlg-chips').innerHTML = dlg._rasc.bairros.map(chipBairro).join('');
        dlg.querySelector('#rota-dlg-datas').innerHTML = dlg._rasc.datas.map(chipData).join('');
    }
    function ligarDialogo(dlg) {
        var msg = dlg.querySelector('#rota-dlg-msg');
        function addBairro() {
            var inp = dlg.querySelector('#rota-dlg-bairro'), n = normBairro(inp.value), r = dlg._rasc;
            if (!n) { msg.textContent = 'Digite um bairro.'; inp.focus(); return; }
            if (n.length > 80) { msg.textContent = 'Nome de bairro longo demais.'; return; }
            if (r.bairros.indexOf(n) < 0) { r.bairros.push(n); r.bairros.sort(); }
            msg.textContent = ''; inp.value = ''; dlgChips(dlg); inp.focus();
        }
        dlg.querySelector('#rota-dlg-add-bairro').addEventListener('click', addBairro);
        dlg.querySelector('#rota-dlg-bairro').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addBairro(); } });
        dlg.querySelector('#rota-dlg-add-data').addEventListener('click', function () {
            var v = dlg.querySelector('#rota-dlg-data').value, r = dlg._rasc;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { msg.textContent = 'Escolha uma data.'; return; }
            if (r.datas.indexOf(v) < 0) { r.datas.push(v); r.datas.sort(); }
            msg.textContent = ''; dlgChips(dlg);
        });
        dlg.addEventListener('click', function (ev) {
            var b = ev.target.closest('[data-rota-tira-bairro]'), d = ev.target.closest('[data-rota-tira-data]'), r = dlg._rasc;
            if (b) { r.bairros = r.bairros.filter(function (x) { return x !== b.getAttribute('data-rota-tira-bairro'); }); dlgChips(dlg); dlg.querySelector('#rota-dlg-bairro').focus(); }
            if (d) { r.datas = r.datas.filter(function (x) { return x !== d.getAttribute('data-rota-tira-data'); }); dlgChips(dlg); dlg.querySelector('#rota-dlg-data').focus(); }
        });
        // Esc durante a gravação: não fecha (o diálogo só fecha com a resposta, para nada velho fechar um diálogo novo).
        dlg.addEventListener('cancel', function (ev) { if (st.dlgSalvando) ev.preventDefault(); });
        dlg.querySelector('#rota-dlg-cancelar').addEventListener('click', function () {
            if (st.dlgSalvando) return;
            dlg.close();
            var b = st.alvo && st.alvo.querySelector('#rota-configurar'); if (b) b.focus();   // explícito: o navegador restaura o foco anterior, que pode não ser o botão
        });
        dlg.addEventListener('close', function () {
            var b = st.alvo && st.alvo.querySelector('#rota-configurar');
            if (b) b.focus();
        });
        dlg.querySelector('#rota-dlg-salvar').addEventListener('click', function () {
            if (st.dlgSalvando) return;                                        // estado global, não o do botão
            var r = dlg._rasc, corte = dlg.querySelector('#rota-dlg-corte').value, abertura = dlg._abertura;
            var linha = { id: 1, bairros_caminhao: r.bairros.slice(), feriados_extras: r.datas.slice(),
                          feriados_sem_saida: dlg.querySelector('#rota-dlg-feriados').checked, s10_volta_sede: dlg.querySelector('#rota-dlg-volta').checked,
                          corte_hora: corte === '' ? null : Number(corte) };
            st.dlgSalvando = true; dlgTravar(dlg, true); msg.textContent = 'Salvando…';
            // Esta resposta só mexe no diálogo se ele ainda for o MESMO (mesma abertura, ainda na página e aberto).
            function mesmo() { return dlg.isConnected && dlg.open && dlg._abertura === abertura; }
            st.sb.from('rota_config').upsert(linha, { onConflict: 'id' }).then(function (res) {
                st.dlgSalvando = false;
                if (res.error) {
                    if (mesmo()) { dlgTravar(dlg, false); msg.textContent = 'Não foi possível salvar: ' + (res.error.message || res.error); }
                    return;
                }
                st.cfgLinha = linha; st.cfg = cfgDe(linha);
                if (mesmo()) dlg.close();
                if (st.ativo) {
                    desenhar();                                                // aba com as regras novas
                    var b = st.alvo && st.alvo.querySelector('#rota-configurar'); if (b) b.focus();
                }
                recarregarConfig();                                            // confirma o que o banco gravou (normalização)
            }, function (e) {
                st.dlgSalvando = false;
                if (mesmo()) { dlgTravar(dlg, false); msg.textContent = 'Não foi possível salvar: ' + String((e && e.message) || e); }
            });
        });
    }
    function recarregarConfig() {
        if (!st.sb) return;
        var seq = st.seq;
        Promise.all([st.sb.from('rota_config').select('*').eq('id', 1).limit(1),
                     paginar(function () { return st.sb.from('rota_cliente_veiculo').select('documento,veiculo').order('documento', { ascending: true }); }, 20000)])
            .then(function (rs) { if (seq !== st.seq || !st.ativo) return; lerConfig(rs[0], rs[1]); desenhar(); });
    }
    // Exceção por cliente: Automático apaga; Caminhão/S10 grava (upsert).
    // Uma gravação por cliente de cada vez: o menu DAQUELE cliente fica travado (disabled) do clique até a resposta;
    // toda resposta confere a sequência do cliente e é descartada se não for a última (nunca desenha estado velho).
    // Erro: o menu volta ao que está no banco (st.excecoes não muda) e mostra o aviso.
    function salvarVeiculo(doc, valor, sel) {
        if (!podeEditar() || !/^\d{11,14}$/.test(doc) || st.gravandoVeiculo[doc]) return;
        if ((st.excecoes[doc] || '') === (valor || '')) return;   // nada mudou
        var seq = (st.seqVeiculo[doc] || 0) + 1;
        st.seqVeiculo[doc] = seq; st.gravandoVeiculo[doc] = true;
        if (sel) { sel.disabled = true; sel.setAttribute('aria-busy', 'true'); }
        var q = valor ? st.sb.from('rota_cliente_veiculo').upsert({ documento: doc, veiculo: valor }, { onConflict: 'documento' })
                      : st.sb.from('rota_cliente_veiculo').delete().eq('documento', doc);
        function fim(erro) {
            if (st.seqVeiculo[doc] !== seq) return;          // resposta antiga: descartada
            delete st.gravandoVeiculo[doc];
            if (erro) st.msgVeiculo = 'Não foi possível gravar o veículo: ' + erro;
            else { if (valor) st.excecoes[doc] = valor; else delete st.excecoes[doc]; st.msgVeiculo = ''; }
            st.focoVeiculo = doc;
            desenhar();
        }
        q.then(function (r) { fim(r.error ? (r.error.message || String(r.error)) : null); }, function (e) { fim(String((e && e.message) || e)); });
    }

    function planos() {
        var hoje = hojeSP(), pl = {}, o = { cfg: st.cfg, excecoes: st.excecoes };
        pl.hoje = planejar(st.pedidos, st.clientes, hoje, o);
        var prox = proximaSaida(hoje, false, st.cfg);
        pl.proxima = prox ? planejar(st.pedidos, st.clientes, prox, { cfg: st.cfg, excecoes: st.excecoes, excluir: pl.hoje.semSaida ? {} : pl.hoje.entregues }) : null;
        return pl;
    }

    function desenharMapa(pl) {
        liberarMapa();
        var el = document.getElementById('rota-mapa');
        if (!el || typeof L === 'undefined') return;
        var m = L.map(el, { scrollWheelZoom: false });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 18 }).addTo(m);
        var pts = [ROTA.ORIGEM].concat(pl.s10.paradas.map(function (s) { return s.pos; }));
        if (pl.s10.volta && pl.s10.paradas.length) pts.push(ROTA.ORIGEM);
        L.polyline(pts, { color: '#f0915a', weight: 3, opacity: 0.9, interactive: false, className: 'rota-linha' }).addTo(m);
        L.marker(ROTA.ORIGEM, { icon: L.divIcon({ className: 'rota-sede', html: '<span><i class="fa-solid fa-warehouse" aria-hidden="true"></i></span>', iconSize: [28, 28], iconAnchor: [14, 14] }),
            title: 'Sede — saída', keyboard: false, zIndexOffset: 1000 }).bindTooltip('Sede (saída)', { direction: 'top', offset: [0, -14] }).addTo(m);
        pl.s10.paradas.forEach(function (s, i) {
            L.marker(s.pos, { icon: L.divIcon({ className: 'rota-num-ic', html: '<span class="rota-num' + (s.precisao === 'bairro' ? ' is-aprox' : '') + '">' + (i + 1) + '</span>', iconSize: [26, 26], iconAnchor: [13, 13] }),
                title: (i + 1) + '. ' + (s.nome || 'Cliente') + (s.bairro ? ' — ' + s.bairro : ''), keyboard: true })
                .bindTooltip((i + 1) + '. ' + esc(s.nome || 'Cliente') + (s.bairro ? ' — ' + esc(s.bairro) : '') + (resumoParada(s) ? '<br>' + esc(resumoParada(s)) : ''),
                    { direction: 'top', offset: [0, -12] }).addTo(m);
        });
        st.mapa = m;
        function enquadrar() { if (!st.mapa || !el.clientWidth) return; st.mapa.invalidateSize({ animate: false }); st.mapa.fitBounds(pts, { padding: [30, 30], maxZoom: 14, animate: false }); }
        enquadrar();
        if (typeof ResizeObserver !== 'undefined') { var t = 0; st.ro = new ResizeObserver(function () { cancelAnimationFrame(t); t = requestAnimationFrame(enquadrar); }); st.ro.observe(el); }
    }

    function desenhar() {
        var alvo = st.alvo;
        if (!alvo || !st.ativo) return;   // aba fechada (encerrar): resposta atrasada não desenha nada
        liberarMapa();                     // o HTML abaixo substitui o contêiner do mapa (carregando/erro/rota)
        var cab = '<div class="rota-topo"><div><h2 class="rota-titulo"><i class="fa-solid fa-route" aria-hidden="true"></i> Rota do dia</h2>' +
            '<p class="rota-sub">Pedidos do ERP ainda não saídos · prazo de ' + ROTA.PRAZO_DIAS_UTEIS + ' dias úteis (seg–sáb' + (st.cfg && st.cfg.feriadosSemSaida ? ', sem feriados' : '') + ') · domingo sem saída' +
            (st.coletado ? ' · ERP lido às ' + esc(new Date(st.coletado).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: ROTA.TZ })) : '') + '</p></div>';
        if (st.carregando && !st.carregado) { alvo.innerHTML = cab + '</div><p class="adm-vazio-linha"><i class="fa-solid fa-spinner fa-spin"></i><span class="adm-vazio-texto">Carregando pedidos e posições…</span></p>'; return; }
        if (st.erro) {
            alvo.innerHTML = cab + '</div><div class="adm-card p-6"><p class="text-sm mb-3">Não foi possível carregar a rota: ' + esc(st.erro) + '</p><button type="button" class="adm-botao-fantasma" id="rota-tentar">Tentar de novo</button></div>';
            alvo.querySelector('#rota-tentar').addEventListener('click', carregar);
            return;
        }
        if (!st.carregado) { alvo.innerHTML = cab + '</div>'; carregar(); return; }
        var pl = planos();
        var semDias = 'sem saída nos próximos ' + NUM.format(ROTA.BUSCA_SAIDA_DIAS) + ' dias';
        if (pl.hoje.semSaida && !pl.proxima) {   // nenhum dia com saída no limite: nada a planejar (configuração de feriados)
            alvo.innerHTML = cab + '</div><div class="adm-card p-6 rota-banner" role="status"><p><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i> ' +
                'Hoje não tem saída e não há ' + esc(semDias.replace('sem saída ', 'saída ')) + ' pelas regras atuais (feriados/datas extras). Confira "Regras da rota".</p></div>' +
                htmlConfigResumo(pl.hoje) + (podeEditar() ? '<button type="button" class="adm-botao-fantasma mt-3" id="rota-configurar"><i class="fa-solid fa-sliders" aria-hidden="true"></i> Configurar rota</button>' + htmlDialogo() : '');
            var cb0 = alvo.querySelector('#rota-configurar'); if (cb0) cb0.addEventListener('click', abrirDialogo);
            return;
        }
        if (!pl.proxima) st.vista = 'hoje';
        var atual = (st.vista === 'proxima' || pl.hoje.semSaida) && pl.proxima ? pl.proxima : pl.hoje;
        if (pl.hoje.semSaida) st.vista = 'proxima';
        var motivoSem = pl.hoje.feriado ? 'feriado' : 'domingo';
        var seletor = '<div class="rota-acoes no-print"><div class="flex gap-1" role="group" aria-label="Dia da rota">' +
            '<button type="button" class="adm-chip' + (st.vista === 'hoje' ? ' is-ativo' : '') + '" data-rota-vista="hoje" aria-pressed="' + (st.vista === 'hoje') + '"' + (pl.hoje.semSaida ? ' disabled title="Sem saída (' + motivoSem + ')"' : '') + '>Hoje · ' +
                esc(nomeDia(pl.hoje.dia)) + ' ' + esc(dataBr(pl.hoje.dia)) + (pl.hoje.semSaida ? ' (sem saída: ' + motivoSem + ')' : '') + '</button>' +
            (pl.proxima
                ? '<button type="button" class="adm-chip' + (st.vista === 'proxima' ? ' is-ativo' : '') + '" data-rota-vista="proxima" aria-pressed="' + (st.vista === 'proxima') + '">Próxima saída · ' +
                    esc(nomeDia(pl.proxima.dia)) + ' ' + esc(dataBr(pl.proxima.dia)) + '</button>'
                : '<button type="button" class="adm-chip" disabled aria-disabled="true" title="' + esc(semDias) + '">Próxima saída · ' + esc(semDias) + '</button>') + '</div>' +
            (st.papel === 'admin' ? '<button type="button" class="adm-botao-fantasma" id="rota-configurar"' + (st.cfgAusente ? ' disabled title="Falta aplicar a migração 040"' : '') + '><i class="fa-solid fa-sliders" aria-hidden="true"></i> Configurar rota</button>' : '') +
            '<button type="button" class="adm-botao-fantasma" id="rota-atualizar"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Atualizar</button>' +
            '<button type="button" class="adm-botao-fantasma" id="rota-imprimir"><i class="fa-solid fa-print" aria-hidden="true"></i> Imprimir</button></div></div>';
        var avisos = [];
        if (!st.temCaixas) avisos.push('As caixas por pedido ainda não chegam do ERP (migração 039 + coletor com "pedidos_enviar_caixas"). Sem elas a capacidade da S10 não é calculada: todos os pedidos aparecem como "volume desconhecido".');
        if (st.posErro) avisos.push('Posições dos clientes indisponíveis agora (' + st.posErro + '): as paradas ficam sem mapa, agrupadas por bairro.');
        if (st.msgVeiculo) avisos.push(st.msgVeiculo);
        var nota = st.vista === 'proxima' && !pl.hoje.semSaida ? '<p class="rota-sub mb-4">Simulação: considera que a rota de hoje sai como planejada; aqui ficam o que sobrou e o que ainda não estava no prazo.</p>' : '';
        alvo.innerHTML = cab + seletor +
            '<p class="rota-imp-dia">Rota de ' + esc(nomeDia(atual.dia)) + ', ' + esc(dataBr(atual.dia)) + '</p>' +
            (avisos.length ? '<div class="adm-card p-4 mb-5 rota-banner" role="status">' + avisos.map(function (a) { return '<p><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ' + esc(a) + '</p>'; }).join('') + '</div>' : '') +
            htmlConfigResumo(atual) + nota + htmlS10(atual) + htmlFica(atual) + htmlCaminhao(atual) +
            '<details class="rota-regras no-print"><summary>Como a rota é montada</summary><ul>' +
                '<li>Candidatos: pedidos do ERP nas etapas aberto, na carga, separando, separado ou conferido.</li>' +
                '<li>Veículo, nesta ordem: exceção marcada para o cliente &gt; CEASA (endereço com "CEASA", Av. Brasil 19001 ou até ' + NUM.format(ROTA.CEASA_RAIO_KM * 1000) + ' m do CEASA) &gt; bairro atendido pelo caminhão no caminho &gt; S10.</li>' +
                '<li>S10: por prazo (vencidos primeiro), até ' + NUM.format(ROTA.CAPACIDADE_S10) + ' de volume (cx24 = ' + NUM1.format(ROTA.VOLUME_CX24) + ', cx48 = ' + NUM1.format(ROTA.VOLUME_CX48) + ', pote avulso = 9/24); o resto fica para a próxima saída. Caminhão: sem limite.</li>' +
                '<li>Ordem (S10 e caminhão): sai da sede, vai sempre para o cliente mais perto e depois desfaz cruzamentos (2-opt). Distância em linha reta × ' + NUM1.format(ROTA.FATOR_ESTRADA) + ' (estimativa).</li>' +
                '<li>Prazo: data do pedido + ' + ROTA.PRAZO_DIAS_UTEIS + ' dias úteis (segunda a sábado; feriado conforme as regras acima; pedido depois do corte conta do dia seguinte).</li></ul></details>' +
            (podeEditar() ? htmlDialogo() : '');
        alvo.querySelectorAll('[data-rota-vista]').forEach(function (b) { b.addEventListener('click', function () { st.vista = b.getAttribute('data-rota-vista'); desenhar(); }); });
        alvo.querySelector('#rota-atualizar').addEventListener('click', function () { st.carregado = false; carregar(); });
        alvo.querySelector('#rota-imprimir').addEventListener('click', imprimir);
        var cfgBtn = alvo.querySelector('#rota-configurar');
        if (cfgBtn && podeEditar()) cfgBtn.addEventListener('click', abrirDialogo);
        var resumo = alvo.querySelector('.rota-config-resumo');
        if (resumo) resumo.addEventListener('toggle', function () { st.cfgAberto = resumo.open; });
        alvo.querySelectorAll('[data-rota-veiculo]').forEach(function (s) {
            s.addEventListener('change', function () { salvarVeiculo(s.getAttribute('data-rota-veiculo'), s.value, s); });
        });
        alvo.querySelectorAll('[data-rota-gmaps]').forEach(function (b) {
            b.addEventListener('click', function () { var w = window.open(b.getAttribute('data-rota-gmaps'), '_blank', 'noopener,noreferrer'); if (w) w.opener = null; });
        });
        if (st.focoVeiculo) {   // depois de gravar, o foco volta ao menu do mesmo cliente (a linha pode ter mudado de cartão)
            var alvoFoco = alvo.querySelector('[data-rota-veiculo="' + st.focoVeiculo + '"]');
            st.focoVeiculo = null;
            if (alvoFoco) alvoFoco.focus();
        }
        desenharMapa(atual);
    }

    function imprimir() {
        document.body.classList.add('rota-imprimindo');
        var fim = function () { document.body.classList.remove('rota-imprimindo'); window.removeEventListener('afterprint', fim); };
        window.addEventListener('afterprint', fim);
        if (st.mapa) st.mapa.invalidateSize({ animate: false });
        window.print();
        setTimeout(fim, 1500);   // navegadores sem afterprint
    }

    raiz.TempRioRota = {
        // admin.js chama ao mostrar a aba (alvo = #painel-rotas). Carrega na 1ª vez; depois só redesenha.
        desenhar: function (alvo, ctx) {
            st.alvo = alvo; st.sb = ctx && ctx.sb; st.papel = ctx && ctx.papel; st.ativo = true;
            desenhar();
        },
        // ATUALIZAR do painel: relê tudo.
        recarregar: function () { if (st.alvo && st.ativo) { st.carregado = false; carregar(); } },
        // Sair da aba / do painel: solta mapa e observer e invalida a carga pendente (o .then confere st.seq e não
        // desenha). Ao voltar, o admin.js chama desenhar() de novo (a aba fica marcada para redesenho).
        encerrar: function () {
            liberarMapa();
            st.ativo = false;
            st.seq++;
            if (st.carregando) { st.carregando = false; st.carregado = false; }   // carga interrompida: refaz ao voltar
        },
        // Logout: além de encerrar, esquece dados e cliente (outra conta pode entrar na mesma aba do navegador).
        sair: function () {
            raiz.TempRioRota.encerrar();
            st.carregado = false; st.erro = null; st.pedidos = []; st.clientes = {}; st.coletado = null; st.sb = null; st.alvo = null;
            st.cfgLinha = null; st.cfg = cfgDe(CFG_PADRAO); st.excecoes = {}; st.bairrosConhecidos = []; st.msgVeiculo = '';
        },
        planejador: Planejador
    };
})(typeof window !== 'undefined' ? window : this);
