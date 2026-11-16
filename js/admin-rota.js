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

    // ===================== REGRAS DO DONO (constantes) =====================
    var ROTA = {
        // Sede/origem: Empório Hortifruti Barra da Tijuca (Rua Gildásio Amado). Mesmo ponto de HM_ORIGEM do
        // admin.js (duplicado aqui para o módulo ser independente; se um mudar, mude os dois).
        ORIGEM: [-23.0030, -43.3264],
        // S10 (caminhonete + carreta): capacidade em VOLUME. Caixa de 24 un = 9; caixa de 48 un = 16,5.
        // 174 cx24 × 9 = 1566 (≈ 95 cx48 × 16,5 = 1567,5). Carga mista = soma dos volumes.
        CAPACIDADE_S10: 1566,
        VOLUME_CX24: 9,
        VOLUME_CX48: 16.5,
        // POTES AVULSOS: a coluna caixas_outras (039) traz UNIDADES (potes) de produtos com código próprio, fora do
        // espelho 24/48 — conferido em produção: pedido 1497 = 530 × R$ 3,30. 24 potes ocupam o espaço de 1 caixa
        // de 24, então cada pote = 9/24 = 0,375 de volume.
        VOLUME_POTE: 9 / 24,
        // Prazo de entrega: 2 dias ÚTEIS a partir do pedido. Dia útil = segunda a sábado (os dois veículos
        // rodam sábado). Feriado não é considerado (ver relatório).
        PRAZO_DIAS_UTEIS: 2,
        DIAS_SEM_SAIDA: [0],          // 0 = domingo (Date.getUTCDay sobre a data de São Paulo)
        // Etapas do Kanban do ERP que ainda vão sair (saiu/atendido ficam de fora).
        ETAPAS_PENDENTES: ['aberto', 'na_carga', 'separando', 'separado', 'conferido'],
        // CEASA-RJ (Av. Brasil, 19001 — Irajá): vai no CAMINHÃO, sem limite de capacidade. Um cliente é do CEASA se:
        //   (a) logradouro, complemento ou bairro do cadastro do ERP contém "CEASA"; ou
        //   (b) logradouro é a Av. Brasil e o número é 19001; ou
        //   (c) a posição no mapa está a até 600 m do CEASA (o grupo de clientes em -22.8269,-43.3400).
        CEASA_CENTRO: [-22.8269, -43.3400],
        CEASA_RAIO_KM: 0.6,
        CEASA_TEXTO: /\bc\.?\s?e\.?\s?a\.?\s?s\.?\s?a\b/i,
        CEASA_AV_BRASIL: /\b(av|avenida|av\.)\s*brasil\b/i,
        CEASA_NUMERO: '19001',
        // Distância: linha reta (haversine) × 1,3 só para ESTIMAR km de rua.
        FATOR_ESTRADA: 1.3,
        // Google Maps (link de rota): no computador até 9 destinos por link; no celular o app aceita só 3 paradas
        // intermediárias + o destino = 4. Os lotes são encadeados (cada um começa onde o anterior terminou).
        LOTE_GMAPS: 9,
        LOTE_GMAPS_MOVEL: 4,
        MOVEL_MQ: '(max-width: 1023px), (pointer: coarse)',
        TZ: 'America/Sao_Paulo'
    };

    // ===================== datas (dia de São Paulo, 'YYYY-MM-DD') =====================
    function diaSP(valor) {
        if (!valor) return null;
        var d = valor instanceof Date ? valor : new Date(valor);
        if (isNaN(d.getTime())) return null;
        try {
            var s = d.toLocaleDateString('en-CA', { timeZone: ROTA.TZ });
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        } catch (e) { /* sem Intl com fuso */ }
        var x = new Date(d.getTime() - 3 * 3600000);   // UTC-3 fixo (São Paulo sem horário de verão)
        return x.toISOString().slice(0, 10);
    }
    function somaDias(dia, n) { var d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
    function diaSemana(dia) { return new Date(dia + 'T12:00:00Z').getUTCDay(); }
    function temSaida(dia) { return ROTA.DIAS_SEM_SAIDA.indexOf(diaSemana(dia)) < 0; }
    function dataBr(dia) { var p = String(dia).split('-'); return p[2] + '/' + p[1]; }
    var DIAS_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    function nomeDia(dia) { return DIAS_NOME[diaSemana(dia)]; }
    // Próximo dia com saída, a partir de 'dia' (inclusive se incluir=true).
    function proximaSaida(dia, incluir) {
        var d = incluir ? dia : somaDias(dia, 1);
        for (var i = 0; i < 8 && !temSaida(d); i++) d = somaDias(d, 1);
        return d;
    }
    // Prazo = dia do pedido + N dias úteis (seg-sáb). Pedido de sábado: segunda e terça. De domingo: idem.
    function prazoDe(dtPedido) {
        var d = diaSP(dtPedido);
        if (!d) return null;
        var n = 0;
        while (n < ROTA.PRAZO_DIAS_UTEIS) { d = somaDias(d, 1); if (temSaida(d)) n++; }
        return d;
    }
    // Situação do prazo em relação ao dia da saída D.
    function situacaoPrazo(prazo, dia) {
        if (!prazo) return 'sem_data';
        if (prazo < dia) return 'vencido';
        if (prazo === dia) return 'hoje';
        if (prazo === proximaSaida(dia, false)) return 'amanha';
        return 'ok';
    }

    // ===================== volume =====================
    // null = desconhecido (sem caixas do ERP). avulsos = potes avulsos (caixas_outras), somados ao volume.
    function volumePedido(p) {
        var c24 = p.caixas_24, c48 = p.caixas_48, out = p.caixas_outras;
        if (c24 == null && c48 == null) return { vol: null, c24: null, c48: null, avulsos: out == null ? null : Number(out) };
        c24 = Number(c24) || 0; c48 = Number(c48) || 0; out = Number(out) || 0;
        return { vol: c24 * ROTA.VOLUME_CX24 + c48 * ROTA.VOLUME_CX48 + out * ROTA.VOLUME_POTE, c24: c24, c48: c48, avulsos: out };
    }

    // ===================== distância e ordem =====================
    function km(a, b) {
        var R = 6371, rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
        var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
    }
    // Caminho ABERTO saindo da origem (não volta): soma das pernas.
    function comprimento(origem, seq) {
        var t = 0, a = origem;
        for (var i = 0; i < seq.length; i++) { t += km(a, seq[i].pos); a = seq[i].pos; }
        return t;
    }
    function vizinhoMaisProximo(origem, paradas) {
        var resto = paradas.slice(), seq = [], a = origem;
        while (resto.length) {
            var mi = 0, md = Infinity;
            for (var i = 0; i < resto.length; i++) { var d = km(a, resto[i].pos); if (d < md - 1e-12) { md = d; mi = i; } }
            var p = resto.splice(mi, 1)[0]; seq.push(p); a = p.pos;
        }
        return seq;
    }
    // 2-opt para caminho aberto com início fixo (a origem). Inverte trechos enquanto encurta.
    function doisOpt(origem, seq) {
        var s = seq.slice(), n = s.length, melhorou = true, voltas = 0;
        function pos(i) { return i < 0 ? origem : s[i].pos; }
        while (melhorou && voltas < 200) {
            melhorou = false; voltas++;
            for (var i = 0; i < n - 1; i++) {
                for (var k = i + 1; k < n; k++) {
                    var a = pos(i - 1), b = pos(i), c = pos(k), d = k + 1 < n ? pos(k + 1) : null;
                    var antes = km(a, b) + (d ? km(c, d) : 0), depois = km(a, c) + (d ? km(b, d) : 0);
                    if (depois < antes - 1e-9) {
                        var meio = s.slice(i, k + 1).reverse();
                        Array.prototype.splice.apply(s, [i, meio.length].concat(meio));
                        melhorou = true;
                    }
                }
            }
        }
        return s;
    }
    function ordenarParadas(origem, paradas) {
        if (paradas.length < 2) return paradas.slice();
        return doisOpt(origem, vizinhoMaisProximo(origem, paradas));
    }

    // ===================== CEASA =====================
    function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
    // Retorna o motivo ('endereco' | 'av_brasil_19001' | 'raio') ou null.
    function motivoCeasa(c) {
        if (!c) return null;
        if ([c.logradouro, c.complemento, c.bairro].some(function (t) { return ROTA.CEASA_TEXTO.test(norm(t)); })) return 'endereco';
        if (ROTA.CEASA_AV_BRASIL.test(norm(c.logradouro)) && String(c.numero || '').replace(/\D/g, '') === ROTA.CEASA_NUMERO) return 'av_brasil_19001';
        if (c.pos && km(c.pos, ROTA.CEASA_CENTRO) <= ROTA.CEASA_RAIO_KM) return 'raio';
        return null;
    }

    // ===================== PLANEJADOR (puro: testável em node) =====================
    // pedidos: linhas de solidcon_pedidos_erp. clientes: { documento -> {nome, bairro, cidade, logradouro, numero,
    // complemento, pos:[lat,lng]|null, precisao} }. dia: 'YYYY-MM-DD' da saída. opts.excluir: { cd_pedido: true }.
    function planejar(pedidos, clientes, dia, opts) {
        opts = opts || {};
        var excluir = opts.excluir || {};
        var res = { dia: dia, semSaida: !temSaida(dia), ceasa: [], s10: { pedidos: [], paradas: [], semPosicao: [], volume: 0, c24: 0, c48: 0,
                    desconhecidos: 0, avulsos: 0, km: 0, kmReta: 0 }, fica: [], entregues: {} };
        if (res.semSaida) return res;
        var proxima = proximaSaida(dia, false);
        var cands = [];
        (pedidos || []).forEach(function (p) {
            if (ROTA.ETAPAS_PENDENTES.indexOf(p.etapa) < 0 || excluir[p.cd_pedido]) return;
            var c = p.documento ? clientes[p.documento] || null : null;
            var prazo = prazoDe(p.dt_pedido), v = volumePedido(p);
            cands.push({ p: p, c: c, prazo: prazo, situacao: situacaoPrazo(prazo, dia), v: v, ceasa: motivoCeasa(c) });
        });
        // Prioridade: prazo (mais antigo primeiro), depois o pedido mais antigo, depois o código (estável).
        cands.sort(function (a, b) {
            var pa = a.prazo || '9999', pb = b.prazo || '9999';
            if (pa !== pb) return pa < pb ? -1 : 1;
            var da = String(a.p.dt_pedido), db = String(b.p.dt_pedido);
            if (da !== db) return da < db ? -1 : 1;
            return Number(a.p.cd_pedido) - Number(b.p.cd_pedido);
        });
        var usado = 0;
        cands.forEach(function (x) {
            if (x.ceasa) { res.ceasa.push(x); res.entregues[x.p.cd_pedido] = true; return; }   // caminhão: sem limite
            if (x.v.vol == null) {
                // Volume desconhecido: não dá para conferir a capacidade. Vai na rota (com aviso, fora da conta) só se
                // esperar faria passar do prazo (prazo até a próxima saída); senão fica para a próxima, também com aviso.
                if (!x.prazo || x.prazo < proxima) { res.s10.pedidos.push(x); res.s10.desconhecidos++; res.entregues[x.p.cd_pedido] = true; return; }
                x.estoura = false; x.proxima = proxima; x.semVolume = true;
                res.fica.push(x); return;
            }
            if (usado + x.v.vol <= ROTA.CAPACIDADE_S10 + 1e-9) {
                usado += x.v.vol; res.s10.pedidos.push(x); res.entregues[x.p.cd_pedido] = true;
                res.s10.c24 += x.v.c24; res.s10.c48 += x.v.c48; res.s10.avulsos += x.v.avulsos;
                return;
            }
            // Não cabe: fica para a próxima saída. Estoura o prazo se a próxima saída é depois do prazo.
            x.estoura = !!x.prazo && x.prazo < proxima;
            x.proxima = proxima;
            res.fica.push(x);
        });
        res.s10.volume = usado;
        // Paradas = clientes (vários pedidos do mesmo cliente = 1 parada). Sem posição: no fim, por bairro.
        var porChave = {}, comPos = [], semPos = [];
        res.s10.pedidos.forEach(function (x) {
            var chave = x.p.documento ? 'd:' + x.p.documento : 'p:' + x.p.cd_pedido;
            var st = porChave[chave];
            if (!st) {
                st = porChave[chave] = { chave: chave, documento: x.p.documento || null, nome: (x.c && x.c.nome) || x.p.cliente_nome || null,
                    bairro: (x.c && x.c.bairro) || null, cidade: (x.c && x.c.cidade) || null, pos: x.c && x.c.pos ? x.c.pos : null,
                    precisao: x.c ? x.c.precisao : null, tipo: x.p.cliente_tipo, pedidos: [] };
                (st.pos ? comPos : semPos).push(st);
            }
            st.pedidos.push(x);
        });
        var seq = ordenarParadas(ROTA.ORIGEM, comPos);
        res.s10.paradas = seq;
        res.s10.kmReta = comprimento(ROTA.ORIGEM, seq);
        res.s10.km = res.s10.kmReta * ROTA.FATOR_ESTRADA;
        // Por bairro; sem bairro (ex.: CPF, sem cadastro) por último.
        semPos.sort(function (a, b) {
            var ba = norm(a.bairro), bb = norm(b.bairro);
            if (!ba !== !bb) return ba ? -1 : 1;
            return ba.localeCompare(bb, 'pt-BR') || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
        });
        res.s10.semPosicao = semPos;
        return res;
    }

    // Links do Google Maps só com COORDENADAS, em lotes (cada lote começa onde o anterior terminou).
    function linksGoogleMaps(paradas, porLote) {
        var n = Math.max(1, Number(porLote) || ROTA.LOTE_GMAPS);
        var links = [], ant = ROTA.ORIGEM;
        function f(p) { return p[0].toFixed(5) + ',' + p[1].toFixed(5); }
        for (var i = 0; i < paradas.length; i += n) {
            var lote = paradas.slice(i, i + n), dest = lote[lote.length - 1].pos;
            var meio = lote.slice(0, -1).map(function (s) { return f(s.pos); }).join('|');
            links.push({ de: i + 1, ate: i + lote.length, url: 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + f(ant) +
                '&destination=' + f(dest) + (meio ? '&waypoints=' + encodeURIComponent(meio) : '') });
            ant = dest;
        }
        return links;
    }

    var Planejador = { ROTA: ROTA, diaSP: diaSP, somaDias: somaDias, proximaSaida: proximaSaida, prazoDe: prazoDe, situacaoPrazo: situacaoPrazo,
        volumePedido: volumePedido, km: km, comprimento: comprimento, vizinhoMaisProximo: vizinhoMaisProximo, doisOpt: doisOpt,
        ordenarParadas: ordenarParadas, motivoCeasa: motivoCeasa, planejar: planejar, linksGoogleMaps: linksGoogleMaps, temSaida: temSaida };
    if (typeof module !== 'undefined' && module.exports) { module.exports = Planejador; return; }   // node: só o planejador

    // ===================== UI (navegador) =====================
    var st = { carregado: false, carregando: false, erro: null, pedidos: [], clientes: {}, coletado: null, temCaixas: false,
               vista: 'hoje', mapa: null, ro: null, sb: null, papel: null, alvo: null, seq: 0, ativo: false };
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
            paginar(function () { return sb.rpc('solidcon_mapa_clientes').order('documento', { ascending: true }); }, 20000)
        ]).then(function (rs) {
            if (seq !== st.seq) return;
            if (rs[0].error) throw rs[0].error;
            var pedidos = rs[0].data || [];
            var docs = {}; pedidos.forEach(function (p) { if (p.documento) docs[p.documento] = true; });
            var lista = Object.keys(docs);
            // Endereço (regra do CEASA e lista): só dos clientes com pedido pendente, em blocos.
            var blocos = [];
            for (var i = 0; i < lista.length; i += 200) blocos.push(lista.slice(i, i + 200));
            return Promise.all(blocos.map(function (b) {
                return sb.from('solidcon_clientes').select('documento,nome,logradouro,numero,complemento,bairro,cidade,estado').in('documento', b);
            })).then(function (cs) {
                if (seq !== st.seq) return;
                var cli = {};
                cs.forEach(function (r) { if (!r.error) (r.data || []).forEach(function (c) { cli[c.documento] = { nome: c.nome, logradouro: c.logradouro, numero: c.numero,
                    complemento: c.complemento, bairro: c.bairro, cidade: c.cidade, pos: null, precisao: null }; }); });
                var mapa = rs[2] && !rs[2].error ? rs[2].data || [] : [];
                mapa.forEach(function (m) {
                    if (!docs[m.documento]) return;
                    var c = cli[m.documento] || (cli[m.documento] = { nome: m.nome, bairro: m.bairro, cidade: m.cidade, pos: null });
                    var lat = Number(m.lat), lng = Number(m.lng);
                    if (m.lat != null && m.lng != null && isFinite(lat) && isFinite(lng) && !m.pino_desatualizado) { c.pos = [lat, lng]; c.precisao = m.precisao; }
                });
                st.pedidos = pedidos; st.clientes = cli;
                st.temCaixas = pedidos.some(function (p) { return 'caixas_24' in p; });
                var sy = rs[1] && !rs[1].error && rs[1].data && rs[1].data[0];
                st.coletado = sy ? sy.coletado_em : null;
                st.posErro = rs[2] && rs[2].error ? String(rs[2].error.message || rs[2].error) : null;
                st.carregando = false; st.carregado = true; desenhar();
            });
        }).catch(function (e) {
            if (seq !== st.seq) return;
            st.carregando = false; st.carregado = false; st.erro = String((e && e.message) || e); desenhar();
        });
    }

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

    function htmlParada(sp, n) {
        var cx = sp.pedidos.map(function (x) { return txtCaixas(x.v); }).join('<br>');
        var val = sp.pedidos.reduce(function (a, x) { return a + (Number(x.p.valor_centavos) || 0); }, 0);
        var pior = sp.pedidos.slice().sort(function (a, b) { return String(a.prazo || '9') < String(b.prazo || '9') ? -1 : 1; })[0];
        return '<tr><td class="rota-n">' + (n == null ? '—' : n) + '</td><td><strong>' + esc(sp.nome || nomeCliente(null, sp.pedidos[0])) + '</strong>' +
            '<div class="rota-sub">' + esc([sp.bairro, sp.cidade].filter(Boolean).join(' · ') || 'sem bairro') +
            ' · pedido' + (sp.pedidos.length > 1 ? 's ' : ' ') + sp.pedidos.map(function (x) { return esc(x.p.cd_pedido); }).join(', ') +
            (sp.precisao === 'bairro' ? ' · <span class="rota-aviso-txt">posição aproximada (bairro)</span>' : '') + '</div></td>' +
            '<td data-rotulo="Caixas">' + cx + '</td><td class="num" data-rotulo="Valor">' + esc(brl(val)) + '</td><td data-rotulo="Prazo">' + seloPrazo(pior) + '</td></tr>';
    }

    function htmlS10(pl) {
        var s = pl.s10, pct = Math.min(100, Math.round(s.volume / ROTA.CAPACIDADE_S10 * 100)), cheio = s.volume > ROTA.CAPACIDADE_S10 * 0.95;
        var nParadas = s.paradas.length + s.semPosicao.length;
        var avisos = [];
        if (s.desconhecidos) avisos.push(NUM.format(s.desconhecidos) + (s.desconhecidos === 1 ? ' pedido com volume desconhecido (não entra na conta)' : ' pedidos com volume desconhecido (não entram na conta)'));
        if (s.semPosicao.length) avisos.push(NUM.format(s.semPosicao.length) + (s.semPosicao.length === 1 ? ' parada sem posição no mapa (no fim, por bairro)' : ' paradas sem posição no mapa (no fim, por bairro)'));
        var links = s.paradas.length ? linksGoogleMaps(s.paradas, loteGmaps()) : [];
        return '<section class="adm-card p-5 mb-6 rota-cartao" aria-labelledby="rota-s10-tit">' +
            '<div class="rota-cab"><div><p class="rota-tit" id="rota-s10-tit"><i class="fa-solid fa-truck-pickup" aria-hidden="true"></i> S10 (caminhonete + carreta)</p>' +
            '<p class="rota-sub">Demais clientes · sai da sede e entrega na ordem do caminho</p></div>' +
            '<div class="rota-kpis"><span><strong>' + NUM.format(nParadas) + '</strong> parada' + (nParadas === 1 ? '' : 's') + '</span>' +
            '<span><strong>' + NUM.format(s.pedidos.length) + '</strong> pedido' + (s.pedidos.length === 1 ? '' : 's') + '</span>' +
            '<span title="Linha reta × ' + NUM1.format(ROTA.FATOR_ESTRADA) + '; não volta para a sede"><strong>~' + NUM.format(Math.round(s.km)) + ' km</strong> estimados</span></div></div>' +
            '<div class="rota-ocup" role="img" aria-label="Ocupação da S10: ' + NUM1.format(s.volume) + ' de ' + NUM.format(ROTA.CAPACIDADE_S10) + ' (' + pct + '%)">' +
                '<div class="rota-ocup-barra' + (cheio ? ' is-cheia' : '') + '" style="width:' + pct + '%"></div></div>' +
            '<p class="rota-sub mt-1">Volume ' + NUM1.format(s.volume) + ' de ' + NUM.format(ROTA.CAPACIDADE_S10) + ' (' + pct + '%) · ' + NUM.format(s.c24) + ' cx24 · ' + NUM.format(s.c48) + ' cx48' +
                (s.avulsos ? ' · ' + txtAvulsos(s.avulsos) + ' — inclui potes avulsos' : '') +
                ' · cabe ~' + NUM.format(Math.floor((ROTA.CAPACIDADE_S10 - s.volume) / ROTA.VOLUME_CX24)) + ' cx24 a mais</p>' +
            (avisos.length ? '<ul class="rota-avisos">' + avisos.map(function (a) { return '<li><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> ' + esc(a) + '</li>'; }).join('') + '</ul>' : '') +
            (s.paradas.length ? '<div id="rota-mapa" class="adm-mapa-escuro rota-mapa" role="img" aria-label="Mapa da rota da S10 com ' + NUM.format(s.paradas.length) + ' paradas numeradas"></div>' : '') +
            (links.length ? '<div class="rota-gmaps no-print">' + links.map(function (l) {
                return '<button type="button" class="adm-botao-fantasma" data-rota-gmaps="' + esc(l.url) + '"><i class="fa-solid fa-diamond-turn-right" aria-hidden="true"></i> Abrir no Google Maps' +
                    (links.length > 1 ? (l.de === l.ate ? ' (parada ' + l.de + ')' : ' (paradas ' + l.de + '–' + l.ate + ')') : '') + '</button>';
            }).join('') + '<span class="rota-sub">Só as coordenadas vão para o Google (sem nome ou endereço).</span></div>' : '') +
            (nParadas ? '<div class="overflow-x-auto"><table class="adm-tabela rota-tabela"><thead><tr><th>#</th><th>Cliente</th><th>Caixas</th><th class="num">Valor</th><th>Prazo</th></tr></thead><tbody>' +
                s.paradas.map(function (sp, i) { return htmlParada(sp, i + 1); }).join('') +
                (s.semPosicao.length ? '<tr class="rota-sep"><td colspan="5">Sem posição no mapa — entregar conforme o bairro</td></tr>' + s.semPosicao.map(function (sp) { return htmlParada(sp, null); }).join('') : '') +
                '</tbody></table></div>' : '<p class="adm-vazio-linha"><span class="adm-vazio-titulo">Nada para a S10 neste dia</span></p>') +
            '</section>';
    }

    function htmlFica(pl) {
        if (!pl.fica.length) return '';
        var estouram = pl.fica.filter(function (x) { return x.estoura; }).length;
        return '<section class="adm-card p-5 mb-6 rota-cartao' + (estouram ? ' rota-cartao-alerta' : '') + '" aria-labelledby="rota-fica-tit">' +
            '<p class="rota-tit" id="rota-fica-tit"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> Fica para a próxima saída (' + esc(nomeDia(pl.fica[0].proxima)) + ' ' + esc(dataBr(pl.fica[0].proxima)) + ')</p>' +
            '<p class="rota-sub mb-3">Não coube na S10 (capacidade ' + NUM.format(ROTA.CAPACIDADE_S10) + ')' +
                (pl.fica.some(function (x) { return x.semVolume; }) ? ', ou está sem volume conhecido e ainda dá prazo na próxima saída' : '') + '.' +
                (estouram ? ' <strong class="rota-txt-ruim">' + NUM.format(estouram) + (estouram === 1 ? ' pedido vai passar do prazo' : ' pedidos vão passar do prazo') + '.</strong>' : '') + '</p>' +
            '<div class="overflow-x-auto"><table class="adm-tabela rota-tabela"><thead><tr><th>Cliente</th><th>Caixas</th><th class="num">Valor</th><th>Prazo</th></tr></thead><tbody>' +
            pl.fica.map(function (x) {
                return '<tr' + (x.estoura ? ' class="rota-linha-ruim"' : '') + '><td><strong>' + esc(nomeCliente(x.c, x)) + '</strong><div class="rota-sub">' + esc((x.c && x.c.bairro) || 'sem bairro') +
                    ' · pedido ' + esc(x.p.cd_pedido) + (x.estoura ? ' · <strong class="rota-txt-ruim">passa do prazo</strong>' : '') + '</div></td><td data-rotulo="Caixas">' + txtCaixas(x.v) + '</td>' +
                    '<td class="num" data-rotulo="Valor">' + esc(brl(x.p.valor_centavos)) + '</td><td data-rotulo="Prazo">' + seloPrazo(x) + '</td></tr>';
            }).join('') + '</tbody></table></div></section>';
    }

    function htmlCeasa(pl) {
        var porCli = {}, ordem = [];
        pl.ceasa.forEach(function (x) { var k = x.p.documento || 'p' + x.p.cd_pedido; if (!porCli[k]) { porCli[k] = []; ordem.push(k); } porCli[k].push(x); });
        var cx24 = 0, cx48 = 0, av = 0, desc = 0;
        pl.ceasa.forEach(function (x) { if (x.v.vol == null) desc++; else { cx24 += x.v.c24; cx48 += x.v.c48; av += x.v.avulsos; } });
        return '<section class="adm-card p-5 mb-6 rota-cartao" aria-labelledby="rota-ceasa-tit">' +
            '<div class="rota-cab"><div><p class="rota-tit" id="rota-ceasa-tit"><i class="fa-solid fa-truck" aria-hidden="true"></i> Caminhão do CEASA</p>' +
            '<p class="rota-sub">Clientes do CEASA-RJ (Av. Brasil, 19001) · sem limite de capacidade</p></div>' +
            '<div class="rota-kpis"><span><strong>' + NUM.format(ordem.length) + '</strong> cliente' + (ordem.length === 1 ? '' : 's') + '</span><span><strong>' +
                NUM.format(pl.ceasa.length) + '</strong> pedido' + (pl.ceasa.length === 1 ? '' : 's') + '</span><span>' + NUM.format(cx24) + ' cx24 · ' + NUM.format(cx48) + ' cx48' + (av ? ' · ' + txtAvulsos(av) : '') +
                (desc ? ' · ' + NUM.format(desc) + ' sem caixas' : '') + '</span></div></div>' +
            (ordem.length ? '<ol class="rota-ceasa">' + ordem.map(function (k) {
                var xs = porCli[k], x0 = xs[0];
                return '<li><strong>' + esc(nomeCliente(x0.c, x0)) + '</strong> <span class="rota-sub">pedido' + (xs.length > 1 ? 's ' : ' ') + xs.map(function (x) { return esc(x.p.cd_pedido); }).join(', ') +
                    ' · ' + xs.map(function (x) { return txtCaixas(x.v); }).join(' + ') + '</span> ' + seloPrazo(xs.slice().sort(function (a, b) { return String(a.prazo) < String(b.prazo) ? -1 : 1; })[0]) + '</li>';
            }).join('') + '</ol>' : '<p class="adm-vazio-linha"><span class="adm-vazio-titulo">Nenhum pedido do CEASA neste dia</span></p>') + '</section>';
    }

    function planos() {
        var hoje = hojeSP(), pl = {};
        pl.hoje = planejar(st.pedidos, st.clientes, hoje);
        var prox = proximaSaida(hoje, false);
        pl.proxima = planejar(st.pedidos, st.clientes, prox, { excluir: pl.hoje.semSaida ? {} : pl.hoje.entregues });
        return pl;
    }

    function desenharMapa(pl) {
        liberarMapa();
        var el = document.getElementById('rota-mapa');
        if (!el || typeof L === 'undefined') return;
        var m = L.map(el, { scrollWheelZoom: false });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 18 }).addTo(m);
        var pts = [ROTA.ORIGEM].concat(pl.s10.paradas.map(function (s) { return s.pos; }));
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
            '<p class="rota-sub">Pedidos do ERP ainda não saídos · prazo de ' + ROTA.PRAZO_DIAS_UTEIS + ' dias úteis (seg–sáb) · domingo sem saída' +
            (st.coletado ? ' · ERP lido às ' + esc(new Date(st.coletado).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: ROTA.TZ })) : '') + '</p></div>';
        if (st.carregando && !st.carregado) { alvo.innerHTML = cab + '</div><p class="adm-vazio-linha"><i class="fa-solid fa-spinner fa-spin"></i><span class="adm-vazio-texto">Carregando pedidos e posições…</span></p>'; return; }
        if (st.erro) {
            alvo.innerHTML = cab + '</div><div class="adm-card p-6"><p class="text-sm mb-3">Não foi possível carregar a rota: ' + esc(st.erro) + '</p><button type="button" class="adm-botao-fantasma" id="rota-tentar">Tentar de novo</button></div>';
            alvo.querySelector('#rota-tentar').addEventListener('click', carregar);
            return;
        }
        if (!st.carregado) { alvo.innerHTML = cab + '</div>'; carregar(); return; }
        var pl = planos(), atual = st.vista === 'proxima' || pl.hoje.semSaida ? pl.proxima : pl.hoje;
        if (pl.hoje.semSaida) st.vista = 'proxima';
        var seletor = '<div class="rota-acoes no-print"><div class="flex gap-1" role="group" aria-label="Dia da rota">' +
            '<button type="button" class="adm-chip' + (st.vista === 'hoje' ? ' is-ativo' : '') + '" data-rota-vista="hoje" aria-pressed="' + (st.vista === 'hoje') + '"' + (pl.hoje.semSaida ? ' disabled title="Domingo: sem saída"' : '') + '>Hoje · ' +
                esc(nomeDia(pl.hoje.dia)) + ' ' + esc(dataBr(pl.hoje.dia)) + (pl.hoje.semSaida ? ' (sem saída)' : '') + '</button>' +
            '<button type="button" class="adm-chip' + (st.vista === 'proxima' ? ' is-ativo' : '') + '" data-rota-vista="proxima" aria-pressed="' + (st.vista === 'proxima') + '">Próxima saída · ' +
                esc(nomeDia(pl.proxima.dia)) + ' ' + esc(dataBr(pl.proxima.dia)) + '</button></div>' +
            '<button type="button" class="adm-botao-fantasma" id="rota-atualizar"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Atualizar</button>' +
            '<button type="button" class="adm-botao-fantasma" id="rota-imprimir"><i class="fa-solid fa-print" aria-hidden="true"></i> Imprimir</button></div></div>';
        var avisos = [];
        if (!st.temCaixas) avisos.push('As caixas por pedido ainda não chegam do ERP (migração 039 + coletor com "pedidos_enviar_caixas"). Sem elas a capacidade da S10 não é calculada: todos os pedidos aparecem como "volume desconhecido".');
        if (st.posErro) avisos.push('Posições dos clientes indisponíveis agora (' + st.posErro + '): as paradas ficam sem mapa, agrupadas por bairro.');
        var nota = st.vista === 'proxima' && !pl.hoje.semSaida ? '<p class="rota-sub mb-4">Simulação: considera que a rota de hoje sai como planejada; aqui ficam o que sobrou e o que ainda não estava no prazo.</p>' : '';
        alvo.innerHTML = cab + seletor +
            '<p class="rota-imp-dia">Rota de ' + esc(nomeDia(atual.dia)) + ', ' + esc(dataBr(atual.dia)) + '</p>' +
            (avisos.length ? '<div class="adm-card p-4 mb-5 rota-banner">' + avisos.map(function (a) { return '<p><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ' + esc(a) + '</p>'; }).join('') + '</div>' : '') +
            nota + htmlS10(atual) + htmlFica(atual) + htmlCeasa(atual) +
            '<details class="rota-regras no-print"><summary>Como a rota é montada</summary><ul>' +
                '<li>Candidatos: pedidos do ERP nas etapas aberto, na carga, separando, separado ou conferido.</li>' +
                '<li>CEASA (caminhão): endereço com "CEASA", Av. Brasil 19001 ou posição a até ' + NUM.format(ROTA.CEASA_RAIO_KM * 1000) + ' m do CEASA.</li>' +
                '<li>S10: por prazo (vencidos primeiro), até ' + NUM.format(ROTA.CAPACIDADE_S10) + ' de volume (cx24 = ' + NUM1.format(ROTA.VOLUME_CX24) + ', cx48 = ' + NUM1.format(ROTA.VOLUME_CX48) + '); o resto fica para a próxima saída.</li>' +
                '<li>Ordem: sai da sede, vai sempre para o cliente mais perto e depois desfaz cruzamentos (2-opt). Distância em linha reta × ' + NUM1.format(ROTA.FATOR_ESTRADA) + ' (estimativa).</li>' +
                '<li>Prazo: data do pedido + ' + ROTA.PRAZO_DIAS_UTEIS + ' dias úteis (segunda a sábado; feriados não contam como exceção).</li></ul></details>';
        alvo.querySelectorAll('[data-rota-vista]').forEach(function (b) { b.addEventListener('click', function () { st.vista = b.getAttribute('data-rota-vista'); desenhar(); }); });
        alvo.querySelector('#rota-atualizar').addEventListener('click', function () { st.carregado = false; carregar(); });
        alvo.querySelector('#rota-imprimir').addEventListener('click', imprimir);
        alvo.querySelectorAll('[data-rota-gmaps]').forEach(function (b) {
            b.addEventListener('click', function () { var w = window.open(b.getAttribute('data-rota-gmaps'), '_blank', 'noopener,noreferrer'); if (w) w.opener = null; });
        });
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
        },
        planejador: Planejador
    };
})(typeof window !== 'undefined' ? window : this);
