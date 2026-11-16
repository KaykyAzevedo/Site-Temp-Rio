/* =====================================================================
 * ROTA — NÚCLEO PURO (sem DOM, sem rede). Fonte ÚNICA do planejador da Rota do dia:
 *   - navegador: carregado por admin.html antes de js/admin-rota.js (expõe globalThis.TempRioRotaCore);
 *   - Edge Function supabase/functions/whatsapp-rotinas (Deno): import './_shared/rota-core.js' (efeito colateral) e
 *     globalThis.TempRioRotaCore;
 *   - node (testes): require(...).
 * Regras do dono: constantes ROTA (capacidade da S10, volumes, CEASA, feriados, prazo) e a configuração (040).
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
        // rodam sábado), menos feriado quando a configuração (rota_config.feriados_sem_saida) disser que não tem saída.
        PRAZO_DIAS_UTEIS: 2,
        DIAS_SEM_SAIDA: [0],          // 0 = domingo (Date.getUTCDay sobre a data de São Paulo)
        // Feriados nacionais FIXOS (MM-DD). Os móveis (Carnaval seg/ter, Sexta-feira Santa, Corpus Christi) saem da
        // Páscoa; feriado estadual/municipal/ponte entra em rota_config.feriados_extras.
        FERIADOS_FIXOS: ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'],
        // Quantos dias à frente procurar um dia com saída (prazo, próxima saída). A 040 aceita até 120 datas extras;
        // somando domingos e feriados, 400 dias cobre o pior caso. Se esgotar: INDISPONÍVEL (null), nunca uma data
        // que não foi validada como dia com saída.
        BUSCA_SAIDA_DIAS: 400,
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

    // ===================== configuração (rota_config / migração 040) =====================
    // Sem a 040 aplicada valem estes padrões (o módulo funciona igual a antes, agora com feriados nacionais).
    var CFG_PADRAO = { bairrosCaminhao: [], corteHora: null, voltaSede: false, feriadosSemSaida: true, feriadosExtras: [] };
    // Bairro normalizado: MAIÚSCULAS, sem acento, só letras/números/pontuação simples, espaços colapsados
    // (mesma regra do gatilho da 040: 'Irajá' = 'IRAJA').
    function normBairro(s) {
        return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
            .replace(/[^A-Z0-9 .,'()\/-]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    // Configuração pronta para uso (aceita a linha do banco ou já normalizada; tudo opcional).
    function cfgDe(linha) {
        var l = linha || {}, c = {};
        var bairros = l.bairrosCaminhao || l.bairros_caminhao || [];
        c.bairrosCaminhao = {}; bairros.forEach(function (b) { var n = normBairro(b); if (n) c.bairrosCaminhao[n] = true; });
        var corte = l.corteHora !== undefined ? l.corteHora : l.corte_hora;
        c.corteHora = corte == null || corte === '' || isNaN(Number(corte)) ? null : Math.max(0, Math.min(23, Number(corte)));
        c.voltaSede = !!(l.voltaSede !== undefined ? l.voltaSede : l.s10_volta_sede);
        var fs = l.feriadosSemSaida !== undefined ? l.feriadosSemSaida : l.feriados_sem_saida;
        c.feriadosSemSaida = fs === undefined || fs === null ? true : !!fs;
        c.feriadosExtras = {}; (l.feriadosExtras || l.feriados_extras || []).forEach(function (d) { if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) c.feriadosExtras[String(d)] = true; });
        c._pronta = true;
        return c;
    }
    function cfgOk(cfg) { return cfg && cfg._pronta ? cfg : cfgDe(cfg || CFG_PADRAO); }

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
    // Hora (0-23) em São Paulo.
    function horaSP(valor) {
        var d = valor instanceof Date ? valor : new Date(valor);
        if (isNaN(d.getTime())) return null;
        try {
            var h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: ROTA.TZ, hour: '2-digit', hourCycle: 'h23' }).format(d));
            if (h >= 0 && h <= 23) return h;
        } catch (e) { /* sem Intl com fuso */ }
        return new Date(d.getTime() - 3 * 3600000).getUTCHours();
    }
    function somaDias(dia, n) { var d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
    function diaSemana(dia) { return new Date(dia + 'T12:00:00Z').getUTCDay(); }
    // Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano).
    function pascoa(ano) {
        var a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
            g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
            l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
            mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
        return ano + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
    }
    var feriadosMemo = {};
    // Feriados nacionais do ano: fixos + Carnaval (seg e ter: Páscoa -48/-47), Sexta-feira Santa (-2), Corpus Christi (+60).
    function feriadosDoAno(ano) {
        if (feriadosMemo[ano]) return feriadosMemo[ano];
        var p = pascoa(ano), f = {};
        ROTA.FERIADOS_FIXOS.forEach(function (md) { f[ano + '-' + md] = true; });
        [[-48, 'Carnaval'], [-47, 'Carnaval'], [-2, 'Sexta-feira Santa'], [60, 'Corpus Christi']].forEach(function (x) { f[somaDias(p, x[0])] = x[1]; });
        feriadosMemo[ano] = f;
        return f;
    }
    function ehFeriado(dia, cfg) {
        cfg = cfgOk(cfg);
        if (!cfg.feriadosSemSaida) return false;
        return !!feriadosDoAno(Number(dia.slice(0, 4)))[dia] || !!cfg.feriadosExtras[dia];
    }
    function temSaida(dia, cfg) { return ROTA.DIAS_SEM_SAIDA.indexOf(diaSemana(dia)) < 0 && !ehFeriado(dia, cfg); }
    function dataBr(dia) { var p = String(dia).split('-'); return p[2] + '/' + p[1]; }
    var DIAS_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    function nomeDia(dia) { return DIAS_NOME[diaSemana(dia)]; }
    // Próximo dia com saída, a partir de 'dia' (inclusive se incluir=true). null = nenhum nos próximos
    // ROTA.BUSCA_SAIDA_DIAS dias (configuração com feriados demais): quem chama mostra "sem saída nos próximos N dias".
    function proximaSaida(dia, incluir, cfg) {
        var d = incluir ? dia : somaDias(dia, 1);
        for (var i = 0; i < ROTA.BUSCA_SAIDA_DIAS; i++) { if (temSaida(d, cfg)) return d; d = somaDias(d, 1); }
        return null;
    }
    // Prazo = dia do pedido + N dias úteis (dia com saída). Pedido feito a partir de corteHora (São Paulo) conta como
    // do dia seguinte. Pedido de sábado: segunda e terça. De domingo: idem.
    function prazoDe(dtPedido, cfg) {
        cfg = cfgOk(cfg);
        var d = diaSP(dtPedido);
        if (!d) return null;
        if (cfg.corteHora != null) { var h = horaSP(dtPedido); if (h != null && h >= cfg.corteHora) d = somaDias(d, 1); }
        var n = 0;
        for (var guarda = 0; n < ROTA.PRAZO_DIAS_UTEIS && guarda < ROTA.BUSCA_SAIDA_DIAS; guarda++) { d = somaDias(d, 1); if (temSaida(d, cfg)) n++; }
        return n < ROTA.PRAZO_DIAS_UTEIS ? null : d;   // não achou os dias úteis no limite: prazo indisponível (sem_data)
    }
    // Situação do prazo em relação ao dia da saída D.
    function situacaoPrazo(prazo, dia, cfg) {
        if (!prazo) return 'sem_data';
        if (prazo < dia) return 'vencido';
        if (prazo === dia) return 'hoje';
        var prox = proximaSaida(dia, false, cfg);
        if (prox && prazo === prox) return 'amanha';
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
    // Soma das pernas saindo da origem; com volta=true, soma também a volta do último ponto para a origem.
    function comprimento(origem, seq, volta) {
        var t = 0, a = origem;
        for (var i = 0; i < seq.length; i++) { t += km(a, seq[i].pos); a = seq[i].pos; }
        if (volta && seq.length) t += km(a, origem);
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
    // 2-opt com início fixo (a origem). volta=false: caminho aberto; volta=true: o fim liga de volta na origem.
    function doisOpt(origem, seq, volta) {
        var s = seq.slice(), n = s.length, melhorou = true, voltas = 0;
        function pos(i) { return i < 0 ? origem : s[i].pos; }
        while (melhorou && voltas < 200) {
            melhorou = false; voltas++;
            for (var i = 0; i < n - 1; i++) {
                for (var k = i + 1; k < n; k++) {
                    var a = pos(i - 1), b = pos(i), c = pos(k), d = k + 1 < n ? pos(k + 1) : (volta ? origem : null);
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
    function ordenarParadas(origem, paradas, volta) {
        if (paradas.length < 2) return paradas.slice();
        return doisOpt(origem, vizinhoMaisProximo(origem, paradas), volta);
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

    // ===================== VEÍCULO =====================
    // Ordem de decisão (o dono, 2026-11-16): exceção por cliente (rota_cliente_veiculo) > regra do CEASA > bairro
    // atendido pelo caminhão no caminho (rota_config.bairros_caminhao, comparação sem acento) > S10.
    // Retorna { veiculo: 'caminhao'|'s10', motivo: 'excecao'|'ceasa'|'bairro'|'padrao', detalhe }.
    function veiculoDe(p, c, cfg, excecoes) {
        cfg = cfgOk(cfg);
        var ex = p && p.documento && excecoes ? excecoes[p.documento] : null;
        if (ex === 'caminhao' || ex === 's10') return { veiculo: ex, motivo: 'excecao', detalhe: null };
        var mc = motivoCeasa(c);
        if (mc) return { veiculo: 'caminhao', motivo: 'ceasa', detalhe: mc };
        var b = c ? normBairro(c.bairro) : '';
        if (b && cfg.bairrosCaminhao[b]) return { veiculo: 'caminhao', motivo: 'bairro', detalhe: b };
        return { veiculo: 's10', motivo: 'padrao', detalhe: null };
    }

    // Paradas = clientes (vários pedidos do mesmo cliente = 1 parada), ordenadas pelo caminho saindo da sede.
    // Sem posição: no fim, por bairro (sem bairro por último).
    function montarParadas(lista, volta) {
        var porChave = {}, comPos = [], semPos = [];
        lista.forEach(function (x) {
            var chave = x.p.documento ? 'd:' + x.p.documento : 'p:' + x.p.cd_pedido;
            var sp = porChave[chave];
            if (!sp) {
                sp = porChave[chave] = { chave: chave, documento: x.p.documento || null, nome: (x.c && x.c.nome) || x.p.cliente_nome || null,
                    bairro: (x.c && x.c.bairro) || null, cidade: (x.c && x.c.cidade) || null, pos: x.c && x.c.pos ? x.c.pos : null,
                    precisao: x.c ? x.c.precisao : null, tipo: x.p.cliente_tipo, veiculo: x.veiculo, motivo: x.motivo, detalhe: x.detalhe, pedidos: [] };
                (sp.pos ? comPos : semPos).push(sp);
            }
            sp.pedidos.push(x);
        });
        var seq = ordenarParadas(ROTA.ORIGEM, comPos, volta);
        semPos.sort(function (a, b) {
            var ba = norm(a.bairro), bb = norm(b.bairro);
            if (!ba !== !bb) return ba ? -1 : 1;
            return ba.localeCompare(bb, 'pt-BR') || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
        });
        var kmReta = comprimento(ROTA.ORIGEM, seq, volta);
        return { paradas: seq, semPosicao: semPos, kmReta: kmReta, km: kmReta * ROTA.FATOR_ESTRADA };
    }

    // ===================== PLANEJADOR (puro: testável em node) =====================
    // pedidos: linhas de solidcon_pedidos_erp. clientes: { documento -> {nome, bairro, cidade, logradouro, numero,
    // complemento, pos:[lat,lng]|null, precisao} }. dia: 'YYYY-MM-DD' da saída.
    // opts: { excluir: { cd_pedido: true }, cfg: linha de rota_config (opcional), excecoes: { documento: 'caminhao'|'s10' } }.
    function planejar(pedidos, clientes, dia, opts) {
        opts = opts || {};
        var excluir = opts.excluir || {}, cfg = cfgOk(opts.cfg), excecoes = opts.excecoes || {};
        var res = { dia: dia, semSaida: !temSaida(dia, cfg), feriado: ehFeriado(dia, cfg), cfg: cfg,
                    caminhao: { pedidos: [], paradas: [], semPosicao: [], km: 0, kmReta: 0, c24: 0, c48: 0, avulsos: 0, desconhecidos: 0 },
                    s10: { pedidos: [], paradas: [], semPosicao: [], volume: 0, c24: 0, c48: 0, desconhecidos: 0, avulsos: 0, km: 0, kmReta: 0, volta: cfg.voltaSede },
                    fica: [], entregues: {} };
        res.ceasa = res.caminhao.pedidos;   // nome antigo (compatibilidade)
        if (res.semSaida) return res;
        var proxima = proximaSaida(dia, false, cfg);   // null = sem saída no limite: o que fica não tem data (e estoura)
        res.semProxima = !proxima;
        var cands = [];
        (pedidos || []).forEach(function (p) {
            if (ROTA.ETAPAS_PENDENTES.indexOf(p.etapa) < 0 || excluir[p.cd_pedido]) return;
            var c = p.documento ? clientes[p.documento] || null : null;
            var prazo = prazoDe(p.dt_pedido, cfg), v = volumePedido(p), ve = veiculoDe(p, c, cfg, excecoes);
            cands.push({ p: p, c: c, prazo: prazo, situacao: situacaoPrazo(prazo, dia, cfg), v: v,
                         veiculo: ve.veiculo, motivo: ve.motivo, detalhe: ve.detalhe, ceasa: ve.motivo === 'ceasa' ? ve.detalhe : null });
        });
        // Prioridade: prazo (mais antigo primeiro), depois o pedido mais antigo, depois o código (estável).
        cands.sort(function (a, b) {
            var pa = a.prazo || '9999', pb = b.prazo || '9999';
            if (pa !== pb) return pa < pb ? -1 : 1;
            var da = String(a.p.dt_pedido), db = String(b.p.dt_pedido);
            if (da !== db) return da < db ? -1 : 1;
            return Number(a.p.cd_pedido) - Number(b.p.cd_pedido);
        });
        var usado = 0, cam = res.caminhao;
        cands.forEach(function (x) {
            if (x.veiculo === 'caminhao') {   // caminhão: sem limite de capacidade
                cam.pedidos.push(x); res.entregues[x.p.cd_pedido] = true;
                if (x.v.vol == null) cam.desconhecidos++; else { cam.c24 += x.v.c24; cam.c48 += x.v.c48; cam.avulsos += x.v.avulsos; }
                return;
            }
            if (x.v.vol == null) {
                // Volume desconhecido: não dá para conferir a capacidade. Vai na rota (com aviso, fora da conta) só se
                // esperar faria passar do prazo (prazo até a próxima saída); senão fica para a próxima, também com aviso.
                if (!x.prazo || !proxima || x.prazo < proxima) { res.s10.pedidos.push(x); res.s10.desconhecidos++; res.entregues[x.p.cd_pedido] = true; return; }
                x.estoura = false; x.proxima = proxima; x.semVolume = true;
                res.fica.push(x); return;
            }
            if (usado + x.v.vol <= ROTA.CAPACIDADE_S10 + 1e-9) {
                usado += x.v.vol; res.s10.pedidos.push(x); res.entregues[x.p.cd_pedido] = true;
                res.s10.c24 += x.v.c24; res.s10.c48 += x.v.c48; res.s10.avulsos += x.v.avulsos;
                return;
            }
            // Não cabe: fica para a próxima saída. Estoura o prazo se a próxima saída é depois do prazo.
            x.estoura = !proxima || (!!x.prazo && x.prazo < proxima);
            x.proxima = proxima;
            res.fica.push(x);
        });
        res.s10.volume = usado;
        var ms = montarParadas(res.s10.pedidos, cfg.voltaSede);
        res.s10.paradas = ms.paradas; res.s10.semPosicao = ms.semPosicao; res.s10.kmReta = ms.kmReta; res.s10.km = ms.km;
        // Caminhão: também pelo caminho saindo da sede (sem volta na conta: não foi definido).
        var mc = montarParadas(cam.pedidos, false);
        cam.paradas = mc.paradas; cam.semPosicao = mc.semPosicao; cam.kmReta = mc.kmReta; cam.km = mc.km;
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

    var Core = {
        ROTA: ROTA,
        CFG_PADRAO: CFG_PADRAO,
        normBairro: normBairro,
        cfgDe: cfgDe,
        cfgOk: cfgOk,
        diaSP: diaSP,
        horaSP: horaSP,
        somaDias: somaDias,
        diaSemana: diaSemana,
        pascoa: pascoa,
        feriadosDoAno: feriadosDoAno,
        ehFeriado: ehFeriado,
        temSaida: temSaida,
        dataBr: dataBr,
        nomeDia: nomeDia,
        proximaSaida: proximaSaida,
        prazoDe: prazoDe,
        situacaoPrazo: situacaoPrazo,
        volumePedido: volumePedido,
        km: km,
        comprimento: comprimento,
        vizinhoMaisProximo: vizinhoMaisProximo,
        doisOpt: doisOpt,
        ordenarParadas: ordenarParadas,
        norm: norm,
        motivoCeasa: motivoCeasa,
        veiculoDe: veiculoDe,
        montarParadas: montarParadas,
        planejar: planejar,
        linksGoogleMaps: linksGoogleMaps
    };
    raiz.TempRioRotaCore = Core;
    if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
