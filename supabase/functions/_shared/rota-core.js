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
        // v3 (o dono, 2026-11-18): 300 cx24 × 9 = 2700 (≈ 163 cx48 × 16,5 = 2689,5). Carga mista = soma dos volumes.
        CAPACIDADE_S10: 2700,
        VOLUME_CX24: 9,
        VOLUME_CX48: 16.5,
        // POTES AVULSOS: a coluna caixas_outras (039) traz UNIDADES (potes) de produtos com código próprio, fora do
        // espelho 24/48 — conferido em produção: pedido 1497 = 530 × R$ 3,30. 24 potes ocupam o espaço de 1 caixa
        // de 24, então cada pote = 9/24 = 0,375 de volume.
        VOLUME_POTE: 9 / 24,
        // Prazo de entrega: 2 dias ÚTEIS a partir do pedido. Dia útil = dia em que o VEÍCULO do pedido sai, menos
        // feriado quando a configuração (rota_config.feriados_sem_saida) disser que não tem saída.
        // Por veículo (o dono, 2026-11-18): a S10 roda de SEGUNDA a SEXTA; o caminhão do CEASA de segunda a sábado.
        // Pedido sem veículo (falta marcar) e as funções chamadas sem veículo usam DIAS_SEM_SAIDA (= o caminhão).
        PRAZO_DIAS_UTEIS: 2,
        DIAS_SEM_SAIDA: [0],          // 0 = domingo (Date.getUTCDay sobre a data de São Paulo); padrão / caminhão
        DIAS_SEM_SAIDA_S10: [0, 6],   // S10: sem saída domingo e sábado
        DIAS_SEM_SAIDA_CAMINHAO: [0], // caminhão do CEASA: sem saída só domingo
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
        // Rotas v2 (044) / v3: o caminhão leva TUDO o que está marcado CEASA a UM centro de distribuição no CEASA; cada
        // cliente retira lá. Na rota é UMA parada (a única do caminhão), com a lista de carga agregada por cliente.
        // v3: o caminhão NÃO para em bairros no caminho ("não é regra", o dono 2026-11-18).
        CEASA_CD_NOME: 'CD CEASA',
        // Ordenação com janela de horário (044): limite de rodadas de melhoria (realocar + 2-opt) — rápido o bastante
        // para recalcular a cada marcação no navegador (~60 paradas).
        HORARIO_RODADAS: 30,
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
    // 044: horaSaida ('HH:MM' ou minutos), velocidadeKmh e minutosParada para o horário estimado das paradas.
    // v3: rota_config.bairros_caminhao (040) fica no banco SEM USO (o caminhão só vai ao CEASA); cfgDe ainda o lê em
    // cfg.bairrosCaminhao só por compatibilidade, e nenhuma regra o consulta.
    var CFG_PADRAO = { bairrosCaminhao: [], corteHora: null, voltaSede: false, feriadosSemSaida: true, feriadosExtras: [],
                       horaSaida: '07:00', velocidadeKmh: 25, minutosParada: 10 };
    // 'HH:MM' / 'HH:MM:SS' (time do Postgres) ou número de minutos -> minutos desde 00:00. Inválido -> null.
    // fimDeJanela=true aceita também '24:00' (= 1440, fim do dia): o time do Postgres aceita 24:00; a 044 recusa,
    // mas aqui não some em silêncio. Hora de saída e início de janela continuam 00:00..23:59.
    function minutosDe(v, fimDeJanela) {
        if (v == null || v === '') return null;
        var max = fimDeJanela ? 24 * 60 : 24 * 60 - 1;
        if (typeof v === 'number') return isFinite(v) && v >= 0 && Math.round(v) <= max ? Math.round(v) : null;
        var m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(String(v).trim());
        if (!m) return null;
        var h = Number(m[1]), mi = Number(m[2]), seg = m[3] ? Number(m[3]) : 0;
        if (fimDeJanela && h === 24) return mi === 0 && seg === 0 && !/\.\d*[1-9]/.test(String(v)) ? 24 * 60 : null;
        return h <= 23 && mi <= 59 && seg <= 59 ? h * 60 + mi : null;
    }
    // minutos -> 'HH:MM' (passa da meia-noite: volta a 00:00; não acontece numa saída de manhã).
    function hhmm(min) {
        if (min == null || !isFinite(min)) return null;
        var t = Math.round(min), h = Math.floor(t / 60) % 24, m = t % 60;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
    function numEntre(v, lo, hi, padrao) { if (v == null || v === '') return padrao; var n = Number(v); return isFinite(n) && n >= lo && n <= hi ? n : padrao; }
    function primeiro(l, a, b) { return l[a] !== undefined ? l[a] : l[b]; }
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
        // 044 (sem a coluna: padrões 07:00 / 25 km/h / 10 min — os mesmos da migração).
        var hs = minutosDe(primeiro(l, 'horaSaida', 'hora_saida'));
        c.horaSaida = hs == null ? 7 * 60 : hs;
        c.velocidadeKmh = numEntre(primeiro(l, 'velocidadeKmh', 'velocidade_kmh'), 5, 120, 25);
        c.minutosParada = numEntre(primeiro(l, 'minutosParada', 'minutos_parada'), 0, 120, 10);
        c._pronta = true;
        return c;
    }
    function cfgOk(cfg) { return cfg && cfg._pronta ? cfg : cfgDe(cfg || CFG_PADRAO); }

    // ===================== datas (dia de São Paulo, 'YYYY-MM-DD') =====================
    // Formatadores criados UMA vez (criar Intl a cada chamada custava ~0,1 ms: pesa no recálculo ao vivo do painel).
    var fmtDia = null, fmtHora = null;
    try {
        fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: ROTA.TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
        fmtHora = new Intl.DateTimeFormat('en-GB', { timeZone: ROTA.TZ, hour: '2-digit', hourCycle: 'h23' });
    } catch (e) { fmtDia = null; fmtHora = null; }   // sem Intl com fuso: cai no UTC-3 fixo abaixo
    function diaSP(valor) {
        if (!valor) return null;
        var d = valor instanceof Date ? valor : new Date(valor);
        if (isNaN(d.getTime())) return null;
        try {
            var s = fmtDia ? fmtDia.format(d) : '';
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
            var h = fmtHora ? Number(fmtHora.format(d)) : NaN;
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
    // veiculo (opcional): 's10' | 'caminhao'. Sem veículo: ROTA.DIAS_SEM_SAIDA (dias de saída de pelo menos um veículo).
    function diasSemSaida(veiculo) { return veiculo === 's10' ? ROTA.DIAS_SEM_SAIDA_S10 : veiculo === 'caminhao' ? ROTA.DIAS_SEM_SAIDA_CAMINHAO : ROTA.DIAS_SEM_SAIDA; }
    function temSaida(dia, cfg, veiculo) { return diasSemSaida(veiculo).indexOf(diaSemana(dia)) < 0 && !ehFeriado(dia, cfg); }
    function dataBr(dia) { var p = String(dia).split('-'); return p[2] + '/' + p[1]; }
    var DIAS_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    function nomeDia(dia) { return DIAS_NOME[diaSemana(dia)]; }
    // Próximo dia com saída, a partir de 'dia' (inclusive se incluir=true). null = nenhum nos próximos
    // ROTA.BUSCA_SAIDA_DIAS dias (configuração com feriados demais): quem chama mostra "sem saída nos próximos N dias".
    function proximaSaida(dia, incluir, cfg, veiculo) {
        var d = incluir ? dia : somaDias(dia, 1);
        for (var i = 0; i < ROTA.BUSCA_SAIDA_DIAS; i++) { if (temSaida(d, cfg, veiculo)) return d; d = somaDias(d, 1); }
        return null;
    }
    // Prazo = dia do pedido + N dias úteis (dia com saída). Pedido feito a partir de corteHora (São Paulo) conta como
    // do dia seguinte. Pedido de sábado: segunda e terça. De domingo: idem. veiculo (opcional): dias úteis DELE (S10:
    // seg..sex, então pedido de sexta vence na terça; caminhão/sem veículo: seg..sáb).
    function prazoDe(dtPedido, cfg, veiculo) {
        cfg = cfgOk(cfg);
        var d = diaSP(dtPedido);
        if (!d) return null;
        if (cfg.corteHora != null) { var h = horaSP(dtPedido); if (h != null && h >= cfg.corteHora) d = somaDias(d, 1); }
        var n = 0;
        for (var guarda = 0; n < ROTA.PRAZO_DIAS_UTEIS && guarda < ROTA.BUSCA_SAIDA_DIAS; guarda++) { d = somaDias(d, 1); if (temSaida(d, cfg, veiculo)) n++; }
        return n < ROTA.PRAZO_DIAS_UTEIS ? null : d;   // não achou os dias úteis no limite: prazo indisponível (sem_data)
    }
    // Situação do prazo em relação ao dia da saída D.
    function situacaoPrazo(prazo, dia, cfg, veiculo) {
        if (!prazo) return 'sem_data';
        if (prazo < dia) return 'vencido';
        if (prazo === dia) return 'hoje';
        var prox = proximaSaida(dia, false, cfg, veiculo);
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
    // fim (opcional, [lat,lng]): ponto final FIXO (ex.: o CD do CEASA no caminhão); tem precedência sobre volta.
    function doisOpt(origem, seq, volta, fim) {
        var s = seq.slice(), n = s.length, melhorou = true, voltas = 0, ultimo = fim || (volta ? origem : null);
        function pos(i) { return i < 0 ? origem : s[i].pos; }
        while (melhorou && voltas < 200) {
            melhorou = false; voltas++;
            for (var i = 0; i < n - 1; i++) {
                for (var k = i + 1; k < n; k++) {
                    var a = pos(i - 1), b = pos(i), c = pos(k), d = k + 1 < n ? pos(k + 1) : ultimo;
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
    function ordenarParadas(origem, paradas, volta, fim) {
        if (paradas.length < 2) return paradas.slice();
        return doisOpt(origem, vizinhoMaisProximo(origem, paradas), volta, fim);
    }

    // ===================== HORÁRIO (044) =====================
    // tempo = { saida: minutos (hora_saida), vel: km/h, parada: minutos por parada }. Perna = linha reta × FATOR_ESTRADA
    // ÷ velocidade. Chegou antes de abrir a janela: espera abrir. Chegou depois do fim: atraso (min) = chegada − fim.
    // A parada (minutos_parada) conta a partir do início do atendimento (chegada ou abertura da janela).
    function tempoDe(cfg) { cfg = cfgOk(cfg); return { saida: cfg.horaSaida, vel: cfg.velocidadeKmh, parada: cfg.minutosParada }; }
    function minutosPerna(a, b, vel) { return km(a, b) * ROTA.FATOR_ESTRADA / vel * 60; }
    function janelaDe(sp) { var r = sp && sp.regra; return r ? { ini: r.ini, fim: r.fim } : { ini: null, fim: null }; }
    // Grava em cada parada: chegadaMin/eta ('HH:MM'), espera, atraso, saidaMin (min inteiros). Paradas sem posição não
    // entram (horário desconhecido). Retorna o resumo da rota.
    function calcularHorarios(origem, seq, tempo, volta) {
        tempo = tempo || tempoDe(null);
        var t = tempo.saida, a = origem, res = { saida: hhmm(tempo.saida), saidaMin: tempo.saida, atrasos: 0, atrasoTotal: 0, esperaTotal: 0, fimMin: null, fim: null };
        for (var i = 0; i < seq.length; i++) {
            var sp = seq[i], j = janelaDe(sp);
            t += minutosPerna(a, sp.pos, tempo.vel);
            var chegada = t, espera = j.ini != null && t < j.ini ? j.ini - t : 0;
            t += espera;
            var atraso = j.fim != null && t > j.fim ? t - j.fim : 0;
            sp.chegadaMin = Math.round(chegada); sp.eta = hhmm(chegada); sp.espera = Math.round(espera); sp.atraso = Math.round(atraso);
            if (sp.atraso > 0) { res.atrasos++; res.atrasoTotal += sp.atraso; }
            res.esperaTotal += sp.espera;
            t += tempo.parada; sp.saidaMin = Math.round(t);
            a = sp.pos;
        }
        if (volta && seq.length) t += minutosPerna(a, origem, tempo.vel);
        res.fimMin = Math.round(t); res.fim = hhmm(t);
        return res;
    }

    // Ordena um GRUPO de paradas (todas com posição) que começa em 'inicio' no minuto t0 e termina em 'fim' (ou aberto).
    // Sem janela no grupo: igual a ordenarParadas (vizinho + 2-opt por distância). Com janela: compara a ordem por
    // distância com uma inserção (janelas que fecham antes entram primeiro, cada uma na posição de menor atraso e,
    // empatando, menor km) e melhora com realocar + 2-opt aceitando só o que NÃO piora o atraso total (e, sem piorar,
    // diminui o km). IMPOSSÍVEL (nem indo direto do início chega antes do fim da janela): a janela dele não entra na
    // conta — fica na posição de menor km (não desvia a rota por um atraso que vai acontecer de qualquer jeito) — e o
    // atraso continua marcado por calcularHorarios.
    function ordenarGrupo(inicio, t0, grupo, tempo, fim) {
        var n = grupo.length;
        var base = n < 2 ? grupo.slice() : doisOpt(inicio, vizinhoMaisProximo(inicio, grupo), false, fim);
        var temJanela = grupo.some(function (sp) { var j = janelaDe(sp); return j.ini != null || j.fim != null; });
        if (!temJanela || n < 2) return base;
        // Matrizes de km/minutos: nó 0 = início, 1..n = paradas, n+1 = fim (se houver).
        var pts = [inicio].concat(grupo.map(function (sp) { return sp.pos; })), N = n + 1 + (fim ? 1 : 0);
        if (fim) pts.push(fim);
        var K = [], ini = [null], fimJ = [null];
        for (var x = 0; x < N; x++) { K.push(new Float64Array(N)); for (var y = 0; y < N; y++) K[x][y] = x === y ? 0 : km(pts[x], pts[y]); }
        var fator = ROTA.FATOR_ESTRADA / tempo.vel * 60, FIM = fim ? n + 1 : -1;
        grupo.forEach(function (sp, i) {
            var j = janelaDe(sp), direto = t0 + K[0][i + 1] * fator;
            ini.push(j.ini); fimJ.push(j.fim != null && direto > j.fim + 1e-9 ? null : j.fim);   // impossível: fora da conta
        });
        // s = índices 1..n. limite (opcional): para de somar quando o atraso já passou do da solução atual (poda).
        function aval(s, limite) {
            var t = t0, a = 0, at = 0, d = 0;
            for (var i = 0; i < s.length; i++) {
                var b = s[i]; d += K[a][b]; t += K[a][b] * fator;
                if (ini[b] != null && t < ini[b]) t = ini[b];
                if (fimJ[b] != null && t > fimJ[b]) { at += t - fimJ[b]; if (limite && at > limite.at + 1e-6) return { at: Infinity, d: Infinity }; }
                t += tempo.parada; a = b;
            }
            if (FIM > 0) d += K[a][FIM];
            return { at: at, d: d };
        }
        function melhor(c, r) { return c.at < r.at - 1e-6 || (c.at <= r.at + 1e-6 && c.d < r.d - 1e-9); }
        var idx = new Map(); grupo.forEach(function (sp, i) { idx.set(sp, i + 1); });
        var sBase = base.map(function (sp) { return idx.get(sp); });
        // Inserção por prazo da janela (fim mais cedo primeiro; sem fim por último, pela abertura).
        var ordem = []; for (var q = 1; q <= n; q++) ordem.push(q);
        ordem.sort(function (p, r) {
            var fp = fimJ[p] == null ? 1e9 : fimJ[p], fr = fimJ[r] == null ? 1e9 : fimJ[r];
            if (fp !== fr) return fp - fr;
            var ip = ini[p] == null ? -1 : ini[p], ir = ini[r] == null ? -1 : ini[r];
            return ip - ir || K[0][p] - K[0][r] || p - r;
        });
        var sIns = [];
        ordem.forEach(function (b) {
            var mPos = 0, mC = null;
            for (var pz = 0; pz <= sIns.length; pz++) {
                sIns.splice(pz, 0, b);
                var c = aval(sIns);
                if (!mC || melhor(c, mC)) { mC = c; mPos = pz; }
                sIns.splice(pz, 1);
            }
            sIns.splice(mPos, 0, b);
        });
        var s = sBase, cur = aval(sBase), cIns = aval(sIns);
        if (melhor(cIns, cur)) { s = sIns; cur = cIns; }
        // Melhoria local: realocar (tira uma parada e põe em outra posição) e 2-opt (inverte um trecho).
        for (var rod = 0, mudou = true; mudou && rod < ROTA.HORARIO_RODADAS; rod++) {
            mudou = false;
            for (var i = 0; i < n; i++) {
                for (var k = 0; k < n; k++) {
                    if (k === i) continue;
                    var t2 = s.slice(), b2 = t2.splice(i, 1)[0]; t2.splice(k, 0, b2);
                    var c2 = aval(t2, cur);
                    if (melhor(c2, cur)) { s = t2; cur = c2; mudou = true; }
                }
            }
            for (var i2 = 0; i2 < n - 1; i2++) {
                for (var k2 = i2 + 1; k2 < n; k2++) {
                    var t3 = s.slice(0, i2).concat(s.slice(i2, k2 + 1).reverse(), s.slice(k2 + 1));
                    var c3 = aval(t3, cur);
                    if (melhor(c3, cur)) { s = t3; cur = c3; mudou = true; }
                }
            }
        }
        return s.map(function (b) { return grupo[b - 1]; });
    }
    // Ordem da rota com horário: prioritários ("entregar primeiro") antes de todos; cada grupo ordenado por
    // ordenarGrupo. Sem prioridade e sem janela: EXATAMENTE ordenarParadas (rota de antes da 044).
    function ordenarComHorario(origem, paradas, tempo, volta, fim) {
        var pri = paradas.filter(function (sp) { return sp.regra && sp.regra.prioridade; });
        var resto = paradas.filter(function (sp) { return !(sp.regra && sp.regra.prioridade); });
        var temJanela = paradas.some(function (sp) { return sp.regra && (sp.regra.ini != null || sp.regra.fim != null); });
        if (!pri.length && !temJanela) return ordenarParadas(origem, paradas, volta, fim);
        var fimTudo = fim || (volta ? origem : null);
        if (!pri.length) return ordenarGrupo(origem, tempo.saida, resto, tempo, fimTudo);
        // O grupo dos prioritários termina "aberto" (quem vem depois começa onde ele parar).
        var sp1 = ordenarGrupo(origem, tempo.saida, pri, tempo, resto.length ? null : fimTudo);
        if (!resto.length) return sp1;
        var h = calcularHorarios(origem, sp1, tempo, false);
        return sp1.concat(ordenarGrupo(sp1[sp1.length - 1].pos, h.fimMin, resto, tempo, fimTudo));
    }

    // ===================== REGRAS DE ENTREGA POR CLIENTE (044: rota_cliente_regras) =====================
    // Linha do banco (janela_inicio, janela_fim, dias_sem_receber, prioridade, observacao) ou já em camelCase.
    // dias: 0 = domingo ... 6 = sábado (mesma convenção de diaSemana). Retorna null se a linha não diz nada.
    function regraDe(l) {
        if (!l) return null;
        var r = { ini: minutosDe(primeiro(l, 'janelaInicio', 'janela_inicio')), fim: minutosDe(primeiro(l, 'janelaFim', 'janela_fim'), true),
                  dias: {}, prioridade: !!l.prioridade, obs: null };
        (primeiro(l, 'diasSemReceber', 'dias_sem_receber') || []).forEach(function (d) { d = Number(d); if (d >= 0 && d <= 6 && d === Math.floor(d)) r.dias[d] = true; });
        if (r.ini != null && r.fim != null && r.ini >= r.fim) { r.ini = null; r.fim = null; }   // inválida (o banco já barra)
        var o = l.observacao != null ? l.observacao : l.obs;
        r.obs = o == null || String(o).trim() === '' ? null : String(o).slice(0, 200);
        var fimTxt = r.fim === 24 * 60 ? '24:00' : hhmm(r.fim);
        r.janela = r.ini == null && r.fim == null ? null : (r.ini == null ? 'até ' + fimTxt : r.fim == null ? 'a partir de ' + hhmm(r.ini) : hhmm(r.ini) + '–' + fimTxt);
        return r;
    }
    // Lista de linhas (com documento) ou mapa { documento: linha } -> { documento: regra }.
    function regrasDe(x) {
        var m = {};
        if (!x) return m;
        if (Array.isArray(x)) x.forEach(function (l) { var r = l && l.documento ? regraDe(l) : null; if (r) m[l.documento] = r; });
        else Object.keys(x).forEach(function (d) { var v = x[d]; var r = v && v.dias && 'ini' in v ? v : regraDe(v); if (r) m[d] = r; });
        return m;
    }
    function naoRecebe(regra, dia) { return !!(regra && regra.dias[diaSemana(dia)]); }
    // Próxima saída ELEGÍVEL (depois de 'dia'): dia com saída E em que o cliente recebe. Percorre dia a dia até
    // ROTA.BUSCA_SAIDA_DIAS (o mesmo limite de proximaSaida), então feriados seguidos nos dias de recebimento não cortam
    // a busca. Sem regra = proximaSaida. null = nenhuma no limite (ou o cliente não recebe dia nenhum).
    function proximaSaidaCliente(dia, regra, cfg, veiculo) {
        if (!regra) return proximaSaida(dia, false, cfg, veiculo);
        var algum = false;
        for (var w = 0; w < 7; w++) if (!regra.dias[w]) { algum = true; break; }
        if (!algum) return null;
        var d = dia;
        for (var i = 0; i < ROTA.BUSCA_SAIDA_DIAS; i++) {
            d = somaDias(d, 1);
            if (temSaida(d, cfg, veiculo) && !naoRecebe(regra, d)) return d;
        }
        return null;
    }

    // ===================== CEASA =====================
    function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
    // Retorna o motivo ('endereco' | 'av_brasil_19001' | 'raio') ou null.
    function motivoCeasa(c) {
        if (!c) return null;
        if ([c.logradouro, c.complemento, c.bairro].some(function (t) { return ROTA.CEASA_TEXTO.test(norm(t)); })) return 'endereco';
        if (ROTA.CEASA_AV_BRASIL.test(norm(c.logradouro)) && String(c.numero || '').replace(/\D/g, '') === ROTA.CEASA_NUMERO) return 'av_brasil_19001';
        if (c.pos && km(c.pos, ROTA.CEASA_CENTRO) <= ROTA.CEASA_RAIO_KM) return 'raio';
        return null;
    }

    // ===================== VEÍCULO =====================
    // Ordem de decisão: exceção por cliente (rota_cliente_veiculo) > regra do CEASA > S10. (v3: o "bairro atendido pelo
    // caminhão no caminho" saiu — o caminhão só vai ao CEASA.)
    // Retorna { veiculo: 'caminhao'|'s10', motivo: 'excecao'|'ceasa'|'padrao', detalhe }.
    function veiculoDe(p, c, cfg, excecoes) {
        cfg = cfgOk(cfg);
        var ex = p && p.documento && excecoes ? excecoes[p.documento] : null;
        if (ex === 'caminhao' || ex === 's10') return { veiculo: ex, motivo: 'excecao', detalhe: null };
        var mc = motivoCeasa(c);
        if (mc) return { veiculo: 'caminhao', motivo: 'ceasa', detalhe: mc };
        return { veiculo: 's10', motivo: 'padrao', detalhe: null };
    }

    // ===================== MARCAÇÃO CEASA/S10 (044) =====================
    // Ordem: escolha SÓ DESTE PEDIDO (rota_pedido_veiculo) > PADRÃO do cliente (rota_cliente_veiculo) > nada.
    // 'caminhao' = o que o painel chama de "CEASA". Sem marcação: null (o pedido NÃO entra na rota).
    // Retorna { veiculo, origem: 'pedido'|'padrao' } ou null.
    function marcacaoDe(p, padroes, porPedido) {
        if (!p) return null;
        var v = porPedido ? porPedido[p.cd_pedido] : null;
        if (v === 'caminhao' || v === 's10') return { veiculo: v, origem: 'pedido' };
        v = p.documento && padroes ? padroes[p.documento] : null;
        if (v === 'caminhao' || v === 's10') return { veiculo: v, origem: 'padrao' };
        return null;
    }
    // Só a regra automática (endereço CEASA / Av. Brasil 19001 / raio / S10), sem exceção: na v2 vira SUGESTÃO exibida
    // para quem marca.
    function sugestaoDe(p, c, cfg) { return veiculoDe(p, c, cfg, null); }
    // Caminhão na v2/v3: TUDO vai para o CD do CEASA (sem parada na porta). Mantida por compatibilidade.
    function entregaCaminhao() { return 'cd'; }
    // Lista de carga do CD: um item por cliente (vários pedidos somados). volume null se algum pedido não tem caixas.
    function cargaCd(lista) {
        var porChave = {}, itens = [];
        lista.forEach(function (x) {
            var chave = x.p.documento ? 'd:' + x.p.documento : 'p:' + x.p.cd_pedido, it = porChave[chave];
            if (!it) {
                it = porChave[chave] = { chave: chave, documento: x.p.documento || null, nome: (x.c && x.c.nome) || x.p.cliente_nome || null,
                    tipo: x.p.cliente_tipo, pedidos: [], c24: 0, c48: 0, avulsos: 0, caixas: 0, volume: 0, desconhecidos: 0, valorCentavos: null };
                itens.push(it);
            }
            it.pedidos.push(x.p.cd_pedido);
            if (x.v.vol == null) { it.desconhecidos++; it.volume = null; }
            else { it.c24 += x.v.c24; it.c48 += x.v.c48; it.avulsos += x.v.avulsos; it.caixas = it.c24 + it.c48; if (it.volume != null) it.volume += x.v.vol; }
            if (x.p.valor_centavos != null) it.valorCentavos = (it.valorCentavos || 0) + Number(x.p.valor_centavos);
        });
        itens.sort(function (a, b) { return String(a.nome || '~').localeCompare(String(b.nome || '~'), 'pt-BR') || a.chave.localeCompare(b.chave); });
        var tot = { c24: 0, c48: 0, avulsos: 0, caixas: 0, desconhecidos: 0, valorCentavos: 0, clientes: itens.length, pedidos: lista.length };
        itens.forEach(function (it) { tot.c24 += it.c24; tot.c48 += it.c48; tot.avulsos += it.avulsos; tot.desconhecidos += it.desconhecidos; tot.valorCentavos += it.valorCentavos || 0; });
        tot.caixas = tot.c24 + tot.c48;
        return { itens: itens, total: tot };
    }

    // Paradas = clientes (vários pedidos do mesmo cliente = 1 parada), ordenadas pelo caminho saindo da sede.
    // Sem posição: no fim, por bairro (sem bairro por último).
    // o (044, opcional): { regras: {documento: regra}, tempo: tempoDe(cfg), fim: [lat,lng] ponto final fixo }.
    // Com regras: janela/prioridade entram na ordem (ordenarComHorario) e cada parada ganha regra/eta/espera/atraso.
    function montarParadas(lista, volta, o) {
        o = o || {};
        var regras = o.regras || {}, porChave = {}, comPos = [], semPos = [];
        lista.forEach(function (x) {
            var chave = x.p.documento ? 'd:' + x.p.documento : 'p:' + x.p.cd_pedido;
            var sp = porChave[chave];
            if (!sp) {
                sp = porChave[chave] = { chave: chave, documento: x.p.documento || null, nome: (x.c && x.c.nome) || x.p.cliente_nome || null,
                    bairro: (x.c && x.c.bairro) || null, cidade: (x.c && x.c.cidade) || null, pos: x.c && x.c.pos ? x.c.pos : null,
                    precisao: x.c ? x.c.precisao : null, tipo: x.p.cliente_tipo, veiculo: x.veiculo, motivo: x.motivo, detalhe: x.detalhe, pedidos: [] };
                var rg = x.p.documento ? regras[x.p.documento] : null;
                if (rg) { sp.regra = rg; sp.prioridade = !!rg.prioridade; sp.janela = rg.janela; sp.obs = rg.obs; }
                (sp.pos ? comPos : semPos).push(sp);
            }
            sp.pedidos.push(x);
        });
        var tempo = o.tempo || tempoDe(null);
        var seq = ordenarComHorario(ROTA.ORIGEM, comPos, tempo, volta, o.fim || null);
        semPos.sort(function (a, b) {
            var ba = norm(a.bairro), bb = norm(b.bairro);
            if (!ba !== !bb) return ba ? -1 : 1;
            return ba.localeCompare(bb, 'pt-BR') || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
        });
        var kmReta = comprimento(ROTA.ORIGEM, seq, volta);
        return { paradas: seq, semPosicao: semPos, kmReta: kmReta, km: kmReta * ROTA.FATOR_ESTRADA };
    }
    // Parada do CD do CEASA (caminhão, v2): sempre a ÚLTIMA; sem horário por cliente.
    function paradaCd(lista) {
        var cg = cargaCd(lista);
        return { chave: 'cd:ceasa', cd: true, documento: null, nome: ROTA.CEASA_CD_NOME, bairro: null, cidade: null, pos: ROTA.CEASA_CENTRO,
                 precisao: null, tipo: null, veiculo: 'caminhao', motivo: 'cd', detalhe: null, pedidos: lista, carga: cg.itens, total: cg.total };
    }

    // ===================== PLANEJADOR (puro: testável em node) =====================
    // pedidos: linhas de solidcon_pedidos_erp. clientes: { documento -> {nome, bairro, cidade, logradouro, numero,
    // complemento, pos:[lat,lng]|null, precisao} }. dia: 'YYYY-MM-DD' da saída.
    // opts: { excluir: { cd_pedido: true }, cfg: linha de rota_config (opcional), excecoes: { documento: 'caminhao'|'s10' } }.
    // opts.ignorados (045, opcional): { cd_pedido: true | {motivo, atualizado_em} } = "tirado da rota" até reativar: não
    //   entra na rota, nem em aguardando, nem em fica; vai para res.ignorados (lista "Fora da rota").
    // Dias por veículo: res.semSaida = nenhum veículo sai (domingo/feriado). res.s10.semSaida = a S10 não sai (sábado):
    //   os pedidos S10 vão para fica com motivoFica 'sem_saida_s10' e a próxima saída da S10 (estoura se passar do prazo).
    //   Prazo, situação e próxima saída de cada pedido contam os dias úteis do veículo dele.
    // opts.plano (046, opcional): { cd_pedido: 'YYYY-MM-DD' } = dia salvo no "Plano da semana". SÓ INFORMAÇÃO (o dono,
    //   2026-11-18: cada dia é uma rota diferente; o plano é base de referência): cada pedido ganha x.planoDia (dia
    //   salvo, se for hoje ou depois) para a tela mostrar "planejado p/ qua 25/11". NÃO muda nada no cálculo.
    // opts (044, todos opcionais):
    //   marcacao: true  -> MODO v2: veículo só pela marcação (porPedido > padrões). Sem marcação: res.aguardando (fora
    //                      da rota) com a sugestão automática. Caminhão: UMA parada, o CD do CEASA (lista de carga).
    //                      Sem 'marcacao': modo automático de antes (whatsapp-rotinas publicado usa assim).
    //   padroes: { documento: 'caminhao'|'s10' } (rota_cliente_veiculo; se ausente usa opts.excecoes);
    //   porPedido: { cd_pedido: 'caminhao'|'s10' } (rota_pedido_veiculo);
    //   regras: linhas de rota_cliente_regras (lista) ou { documento: linha|regra }: dia que não recebe (vai para a
    //           próxima saída em que recebe), janela e prioridade (ordem + horário).
    function planejar(pedidos, clientes, dia, opts) {
        opts = opts || {};
        var excluir = opts.excluir || {}, ignorados = opts.ignorados || {}, plano = opts.plano || {}, cfg = cfgOk(opts.cfg), excecoes = opts.excecoes || {};
        var v2 = !!opts.marcacao, padroes = opts.padroes || excecoes, porPedido = opts.porPedido || {};
        var regras = regrasDe(opts.regras), tempo = tempoDe(cfg);
        var res = { dia: dia, semSaida: !temSaida(dia, cfg), feriado: ehFeriado(dia, cfg), cfg: cfg, modo: v2 ? 'marcacao' : 'auto',
                    caminhao: { pedidos: [], paradas: [], semPosicao: [], km: 0, kmReta: 0, c24: 0, c48: 0, avulsos: 0, desconhecidos: 0, cd: null, horario: null },
                    s10: { pedidos: [], paradas: [], semPosicao: [], volume: 0, c24: 0, c48: 0, desconhecidos: 0, avulsos: 0, km: 0, kmReta: 0, volta: cfg.voltaSede, horario: null,
                           semSaida: !temSaida(dia, cfg, 's10') },
                    fica: [], aguardando: [], ignorados: [], entregues: {} };
        res.ceasa = res.caminhao.pedidos;   // nome antigo (compatibilidade)
        if (res.semSaida) return res;
        // próxima saída DA S10 (só a S10 tem "fica"; o caminhão não tem limite). null = sem saída no limite (estoura).
        var proxima = proximaSaida(dia, false, cfg, 's10');
        res.semProxima = !proxima;
        var cands = [];
        (pedidos || []).forEach(function (p) {
            if (ROTA.ETAPAS_PENDENTES.indexOf(p.etapa) < 0 || excluir[p.cd_pedido]) return;
            var c = p.documento ? clientes[p.documento] || null : null;
            var v = volumePedido(p), ve, x, prazo, vq;
            if (v2) {
                var m = marcacaoDe(p, padroes, porPedido), sug = sugestaoDe(p, c, cfg);
                vq = m ? m.veiculo : null; prazo = prazoDe(p.dt_pedido, cfg, vq);
                x = { p: p, c: c, prazo: prazo, situacao: situacaoPrazo(prazo, dia, cfg, vq), v: v, sugestao: sug, marcacao: m ? m.origem : null,
                      veiculo: m ? m.veiculo : null, motivo: m ? 'marcado' : null, detalhe: m ? m.origem : null, ceasa: motivoCeasa(c) };
                if (m && m.veiculo === 'caminhao') x.entrega = entregaCaminhao(c, cfg);
            } else {
                ve = veiculoDe(p, c, cfg, excecoes);
                vq = ve.veiculo; prazo = prazoDe(p.dt_pedido, cfg, vq);
                x = { p: p, c: c, prazo: prazo, situacao: situacaoPrazo(prazo, dia, cfg, vq), v: v,
                      veiculo: ve.veiculo, motivo: ve.motivo, detalhe: ve.detalhe, ceasa: ve.motivo === 'ceasa' ? ve.detalhe : null };
            }
            x.regra = p.documento ? regras[p.documento] || null : null;
            var ig = ignorados[p.cd_pedido];
            if (ig) { x.ignorado = ig === true ? {} : ig; res.ignorados.push(x); return; }   // 045: fora da rota até reativar
            var pd = plano[p.cd_pedido];
            if (pd && /^\d{4}-\d{2}-\d{2}$/.test(String(pd)) && String(pd) >= dia) x.planoDia = String(pd);   // 046: só informação
            cands.push(x);
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
            if (v2 && !x.veiculo) { res.aguardando.push(x); return; }   // falta marcar: fora da rota
            if (x.veiculo === 's10' && res.s10.semSaida) {   // a S10 não sai hoje (sábado): próxima saída DELA em que o cliente recebe
                var ps = proximaSaidaCliente(dia, x.regra, cfg, 's10');
                x.motivoFica = 'sem_saida_s10'; x.proxima = ps; x.estoura = !ps || (!!x.prazo && x.prazo < ps);
                res.fica.push(x); return;
            }
            if (naoRecebe(x.regra, dia)) {   // o cliente não recebe neste dia da semana: próxima saída em que recebe
                var pc = proximaSaidaCliente(dia, x.regra, cfg, x.veiculo);
                x.motivoFica = 'dia_fechado'; x.proxima = pc; x.estoura = !pc || (!!x.prazo && x.prazo < pc);
                res.fica.push(x); return;
            }
            // Próxima saída ELEGÍVEL para este cliente (dia com saída em que ele recebe): é ela que decide segurar o
            // volume desconhecido, a data de quem fica e se estoura o prazo. Sem regra: a próxima saída de todos.
            var proxCli = x.regra ? proximaSaidaCliente(dia, x.regra, cfg, 's10') : proxima;   // (caminhão retorna antes)
            if (x.veiculo === 'caminhao') {   // caminhão: sem limite de capacidade
                cam.pedidos.push(x); res.entregues[x.p.cd_pedido] = true;
                if (x.v.vol == null) cam.desconhecidos++; else { cam.c24 += x.v.c24; cam.c48 += x.v.c48; cam.avulsos += x.v.avulsos; }
                return;
            }
            if (x.v.vol == null) {
                // Volume desconhecido: não dá para conferir a capacidade. Vai na rota (com aviso, fora da conta) só se
                // esperar faria passar do prazo (prazo até a próxima saída); senão fica para a próxima, também com aviso.
                if (!x.prazo || !proxCli || x.prazo < proxCli) { res.s10.pedidos.push(x); res.s10.desconhecidos++; res.entregues[x.p.cd_pedido] = true; return; }
                x.estoura = false; x.proxima = proxCli; x.semVolume = true; x.motivoFica = 'sem_volume';
                res.fica.push(x); return;
            }
            if (usado + x.v.vol <= ROTA.CAPACIDADE_S10 + 1e-9) {
                usado += x.v.vol; res.s10.pedidos.push(x); res.entregues[x.p.cd_pedido] = true;
                res.s10.c24 += x.v.c24; res.s10.c48 += x.v.c48; res.s10.avulsos += x.v.avulsos;
                return;
            }
            // Não cabe: fica para a próxima saída. Estoura o prazo se a próxima saída é depois do prazo.
            x.estoura = !proxCli || (!!x.prazo && x.prazo < proxCli);
            x.proxima = proxCli; x.motivoFica = 'capacidade';
            res.fica.push(x);
        });
        res.s10.volume = usado;
        var om = { regras: regras, tempo: tempo };
        var ms = montarParadas(res.s10.pedidos, cfg.voltaSede, om);
        res.s10.paradas = ms.paradas; res.s10.semPosicao = ms.semPosicao; res.s10.kmReta = ms.kmReta; res.s10.km = ms.km;
        res.s10.horario = calcularHorarios(ROTA.ORIGEM, ms.paradas, tempo, cfg.voltaSede);
        if (!v2) {
            // Caminhão (automático, antes da 044): também pelo caminho saindo da sede (sem volta na conta).
            var mc = montarParadas(cam.pedidos, false, om);
            cam.paradas = mc.paradas; cam.semPosicao = mc.semPosicao; cam.kmReta = mc.kmReta; cam.km = mc.km;
        } else {
            // v2/v3: o caminhão só vai ao CD do CEASA: UMA parada com a lista de carga (sem portas no caminho).
            cam.paradas = []; cam.semPosicao = []; cam.portas = 0;
            if (cam.pedidos.length) { cam.cd = paradaCd(cam.pedidos); cam.paradas = [cam.cd]; }
            cam.kmReta = comprimento(ROTA.ORIGEM, cam.paradas, false); cam.km = cam.kmReta * ROTA.FATOR_ESTRADA;
        }
        cam.horario = calcularHorarios(ROTA.ORIGEM, cam.paradas, tempo, false);
        return res;
    }

    // ===================== PLANO DA SEMANA (046) =====================
    // Segunda-feira da semana SEGUINTE a 'dia' (a semana que o Márcio planeja).
    function proximaSemana(dia) { var d = somaDias(dia, 1); while (diaSemana(d) !== 1) d = somaDias(d, 1); return d; }
    // Segunda-feira da semana de 'dia' (domingo conta como fim da semana anterior).
    function segundaDe(dia) { var w = diaSemana(dia); return somaDias(dia, w === 0 ? -6 : 1 - w); }
    // Direção a partir da sede, em graus 0..360 (0 = norte, 90 = leste). Aproximação plana: suficiente para separar setores.
    function anguloDe(pos) {
        var o = ROTA.ORIGEM, dy = pos[0] - o[0], dx = (pos[1] - o[1]) * Math.cos(o[0] * Math.PI / 180);
        var a = Math.atan2(dx, dy) * 180 / Math.PI;
        return a < 0 ? a + 360 : a;
    }
    function difAng(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
    function mediaAng(lista) {
        var sx = 0, sy = 0; lista.forEach(function (a) { sx += Math.sin(a * Math.PI / 180); sy += Math.cos(a * Math.PI / 180); });
        if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return lista.length ? lista[0] : null;
        var m = Math.atan2(sx, sy) * 180 / Math.PI; return m < 0 ? m + 360 : m;
    }
    // REGIÕES = SETORES POR ÂNGULO a partir da sede (não k-means): toda rota sai da sede, então clientes na mesma direção
    // ficam no mesmo "raio" de viagem. O círculo é aberto no MAIOR vão angular entre clientes e cortado em k arcos
    // contíguos (k = dias com saída da S10, no máximo 1 por cliente) escolhendo os cortes por programação dinâmica:
    //   custo = Σ desequilíbrio de volume ((V - média)/média)² + 4·Σ excesso sobre a capacidade ((V - CAP)/CAP)²
    //           − Σ (vão angular no corte / 30°).
    // Resultado: corta nos VÃOS naturais entre grupos de clientes (estável: um pedido a mais num grupo não move a fronteira)
    // e, onde não há vão, equilibra o volume. Determinístico (sem semente/iteração aleatória; empate = corte mais cedo).
    // k-means foi descartado: depende da semente, não garante contiguidade a partir da sede e muda com pequenas variações.
    function setores(unidades, k) {
        var us = unidades.slice().sort(function (a, b) { return a.ang - b.ang || (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0); });
        var n = us.length; if (!n || k < 1) return [];
        var ini = 0, maior = -1;
        for (var i = 0; i < n; i++) { var prox = i + 1 < n ? us[i + 1].ang : us[0].ang + 360, vao = prox - us[i].ang; if (vao > maior + 1e-9) { maior = vao; ini = (i + 1) % n; } }
        var ord = us.slice(ini).concat(us.slice(0, ini)), kk = Math.min(k, n), CAP = ROTA.CAPACIDADE_S10;
        var pre = [0]; ord.forEach(function (u, q) { pre.push(pre[q] + Math.max(u.vol || 0, ROTA.VOLUME_CX24)); });
        var media = pre[n] / kk;
        var gap = []; for (var g0 = 0; g0 < n - 1; g0++) { var dg = ord[g0 + 1].ang - ord[g0].ang; gap.push(dg < 0 ? dg + 360 : dg); }
        function custo(a, b) {   // grupo = ord[a..b-1]
            var v = pre[b] - pre[a], c = Math.pow((v - media) / media, 2);
            if (v > CAP) c += 4 * Math.pow((v - CAP) / CAP, 2);
            return c;
        }
        var f = [], de = [];
        for (var g = 0; g <= kk; g++) { f.push(new Array(n + 1).fill(Infinity)); de.push(new Array(n + 1).fill(-1)); }
        f[0][0] = 0;
        for (var gg = 1; gg <= kk; gg++) {
            for (var b = gg; b <= n - (kk - gg); b++) {
                for (var a = gg - 1; a < b; a++) {
                    if (f[gg - 1][a] === Infinity) continue;
                    var v2 = f[gg - 1][a] + custo(a, b) - (a > 0 ? gap[a - 1] / 30 : 0);
                    if (v2 < f[gg][b] - 1e-12) { f[gg][b] = v2; de[gg][b] = a; }
                }
            }
        }
        var cortes = [], fim = n;
        for (var g2 = kk; g2 >= 1; g2--) { var a2 = de[g2][fim]; cortes.unshift([a2, fim]); fim = a2; }
        return cortes.map(function (cb) {
            var gr = ord.slice(cb[0], cb[1]);
            return { unidades: gr, angIni: gr[0].ang, angFim: gr[gr.length - 1].ang, centro: mediaAng(gr.map(function (u) { return u.ang; })),
                     prazoMin: gr.reduce(function (m, u) { return u.prazo && (!m || u.prazo < m) ? u.prazo : m; }, null),
                     volume: gr.reduce(function (t, u) { return t + (u.vol || 0); }, 0) };
        });
    }
    // planejarSemana(pedidos, clientes, semanaInicio, opts) — SUGESTÃO editável do plano da S10 nos dias em que ELA sai
    // (ROTA.DIAS_SEM_SAIDA_S10: seg a sex). semanaInicio: qualquer dia da semana desejada ('YYYY-MM-DD'); usa a segunda
    // dela. Dia útil da S10 com feriado (config) fica em res.semSaida; sábado/domingo nem entram. res.fim = último dia
    // da semana com dia útil da S10 (sexta). Base: pedidos PENDENTES, não ignorados (045), marcados S10 (044). Sem marcação: res.faltaMarcar
    // (com a sugestão; NÃO ocupam capacidade). Marcados CEASA: res.cd (lista de carga do CD, à parte).
    // opts: { cfg, padroes, porPedido, regras, ignorados, plano: { cd_pedido: 'YYYY-MM-DD' } (046: vence a sugestão), excluir }.
    // Regras, nesta ordem:
    //   1. plano salvo com dia válido desta semana: o pedido vai nele (origemDia 'salvo'), mesmo passando da capacidade
    //      (dia.excesso) ou do prazo (estoura) ou em dia que o cliente não recebe (x.diaFechado) — o Márcio decidiu;
    //      dia salvo de OUTRA semana futura: res.foraDaSemana; dia passado / sem saída: ignorado (vale a sugestão);
    //   2. sugestão: cliente (todos os pedidos dele juntos) -> setor por ângulo -> dia do setor; setores com prazo mais
    //      cedo ficam nos dias mais cedo;
    //   3. dia em que o cliente não recebe (044) e prazo: se o dia do setor não serve, o dia permitido (até o prazo, se
    //      houver) cujo setor está mais perto em ângulo; nenhum até o prazo: o 1º dia permitido, estoura;
    //   4. capacidade S10 (ROTA.CAPACIDADE_S10 por dia), enchendo na ordem: prioridade, prazo, pedido mais antigo; não
    //      coube: o dia permitido de setor mais perto (respeitando o prazo, se possível); nenhum: res.sobra (motivo
    //      'capacidade'); volume desconhecido conta 0 (dia.desconhecidos);
    //   5. sem posição: setor do BAIRRO (média dos clientes com posição do mesmo bairro); sem isso: res.semPosicao.
    //   Semana sem nenhum dia de saída da S10: res.semSaidaNaSemana = true e tudo em res.sobra (motivo 'sem_saida_semana').
    // Cada dia: { dia, nome, pedidos, paradas, semPosicao, horario, km, volume, ocupacao (0..1+), c24, c48, avulsos,
    // desconhecidos, excesso, regiao }. Cada pedido (x): { p, c, prazo, situacao (no dia dele), v, veiculo, marcacao,
    // regra, dia, origemDia 'salvo'|'sugestao', diaSugerido, estoura, diaFechado, regiao, ang }.
    function planejarSemana(pedidos, clientes, semanaInicio, opts) {
        opts = opts || {};
        var cfg = cfgOk(opts.cfg), padroes = opts.padroes || opts.excecoes || {}, porPedido = opts.porPedido || {};
        var regras = regrasDe(opts.regras), ignorados = opts.ignorados || {}, plano = opts.plano || {}, excluir = opts.excluir || {};
        var tempo = tempoDe(cfg), CAP = ROTA.CAPACIDADE_S10;
        var ini = segundaDe(semanaInicio), todos = [], dias = [], semSaida = [], idx = {};
        for (var i = 0; i < 7; i++) {
            var d = somaDias(ini, i);
            if (diasSemSaida('s10').indexOf(diaSemana(d)) >= 0) continue;   // sábado/domingo: a S10 não roda
            todos.push(d);
            if (temSaida(d, cfg, 's10')) { idx[d] = dias.length; dias.push(d); } else semSaida.push({ dia: d, feriado: ehFeriado(d, cfg) });
        }
        var res = { inicio: ini, fim: todos.length ? todos[todos.length - 1] : ini, dias: [], semSaida: semSaida, faltaMarcar: [], cd: null, cdPedidos: [], semPosicao: [], sobra: [], foraDaSemana: [], regioes: [],
                    resumo: { pedidos: 0, estouram: 0, volume: 0, salvos: 0 } };
        var dd = dias.map(function (d) { return { dia: d, nome: nomeDia(d), lista: [], usado: 0, regiao: null, centro: null }; });
        var s10 = [];
        (pedidos || []).forEach(function (p) {
            if (ROTA.ETAPAS_PENDENTES.indexOf(p.etapa) < 0 || excluir[p.cd_pedido] || ignorados[p.cd_pedido]) return;
            var c = p.documento ? clientes[p.documento] || null : null, m = marcacaoDe(p, padroes, porPedido);
            var x = { p: p, c: c, prazo: prazoDe(p.dt_pedido, cfg, m ? m.veiculo : null), v: volumePedido(p), veiculo: m ? m.veiculo : null, marcacao: m ? m.origem : null,
                      regra: p.documento ? regras[p.documento] || null : null, dia: null, origemDia: null, diaSugerido: null, estoura: false, diaFechado: false, regiao: null, ang: null };
            if (!m) { x.sugestao = sugestaoDe(p, c, cfg); res.faltaMarcar.push(x); return; }
            if (m.veiculo === 'caminhao') { res.cdPedidos.push(x); return; }
            s10.push(x);
        });
        if (res.cdPedidos.length) res.cd = paradaCd(res.cdPedidos.map(function (x) { return { p: x.p, c: x.c, v: x.v }; }));
        function ordX(a, b) { var pa = a.prazo || '9999', pb = b.prazo || '9999'; if (pa !== pb) return pa < pb ? -1 : 1; var da = String(a.p.dt_pedido), db = String(b.p.dt_pedido); if (da !== db) return da < db ? -1 : 1; return Number(a.p.cd_pedido) - Number(b.p.cd_pedido); }
        // ---- unidades (cliente; pedidos salvos ficam à parte, por dia) ----
        var porBairro = {};
        Object.keys(clientes || {}).forEach(function (doc) { var c = clientes[doc]; if (c && c.pos && c.bairro) { var b = normBairro(c.bairro); (porBairro[b] || (porBairro[b] = [])).push(anguloDe(c.pos)); } });
        var unid = {}, salvos = [], lista = [];
        s10.sort(ordX).forEach(function (x) {
            var pd = plano[x.p.cd_pedido]; pd = pd && /^\d{4}-\d{2}-\d{2}$/.test(String(pd)) ? String(pd) : null;
            if (pd && idx[pd] != null) { x.origemDia = 'salvo'; salvos.push({ x: x, dia: pd }); return; }
            if (pd && pd > somaDias(ini, 6)) { x.origemDia = 'salvo'; x.dia = pd; res.foraDaSemana.push(x); return; }
            if (pd && pd >= ini) x.salvoInvalido = pd;   // salvo num dia desta semana sem saída da S10 (sábado/feriado): vale a sugestão
            var ch = x.p.documento ? 'd:' + x.p.documento : 'p:' + x.p.cd_pedido, u = unid[ch];
            if (!u) { u = unid[ch] = { chave: ch, xs: [], vol: 0, prazo: null, regra: x.regra, pri: !!(x.regra && x.regra.prioridade), ang: null, semVol: 0 }; lista.push(u);
                      if (x.c && x.c.pos) u.ang = anguloDe(x.c.pos);
                      else if (x.c && x.c.bairro && porBairro[normBairro(x.c.bairro)]) { u.ang = mediaAng(porBairro[normBairro(x.c.bairro)]); u.pelaBairro = true; } }
            u.xs.push(x); if (x.v.vol == null) u.semVol++; else u.vol += x.v.vol;
            if (x.prazo && (!u.prazo || x.prazo < u.prazo)) u.prazo = x.prazo;
        });
        // ---- salvos primeiro (vencem a sugestão) ----
        salvos.forEach(function (sv) { var di = dd[idx[sv.dia]]; sv.x.dia = sv.dia; di.lista.push(sv.x); if (sv.x.v.vol != null) di.usado += sv.x.v.vol; });
        // ---- regiões ----
        // Âncoras das regiões: clientes com POSIÇÃO. Sem nenhum (ex.: o único geolocalizado do bairro foi salvo num dia, ou
        // só há pedido de cliente sem pino), os de ângulo pelo BAIRRO formam as regiões (PS-2). O ângulo só decide o dia:
        // a parada continua sem coordenada (vai para dia.semPosicao na ordem do dia; nenhum pino é inventado).
        var comAng = lista.filter(function (u) { return u.ang != null && !u.pelaBairro; });
        if (!comAng.length) comAng = lista.filter(function (u) { return u.ang != null; });
        var regs = setores(comAng, dias.length);
        // regiões com prazo mais cedo -> dias mais cedo (empate: ângulo)
        // (com a base = pedidos já em aberto, quase todos vencem antes da semana: desempata pelo nº de clientes vencidos)
        regs.forEach(function (r) { r.vencidos = r.unidades.filter(function (u) { return u.prazo && u.prazo < ini; }).length; });
        regs.sort(function (a, b) { var pa = a.prazoMin || '9999', pb = b.prazoMin || '9999'; return pa < pb ? -1 : pa > pb ? 1 : (b.vencidos - a.vencidos) || (a.angIni - b.angIni); });
        regs.forEach(function (r, ri) { r.dia = dias[ri]; dd[ri].regiao = ri; dd[ri].centro = r.centro; r.unidades.forEach(function (u) { u.reg = ri; }); });
        lista.forEach(function (u) {   // sem posição (pelo bairro): região do cliente com posição mais perto em ângulo
            if (u.reg != null || u.ang == null || !comAng.length) return;
            var m = null; comAng.forEach(function (v) { if (!m || difAng(v.ang, u.ang) < difAng(m.ang, u.ang) - 1e-9) m = v; }); u.reg = m.reg;
        });
        res.regioes = regs.map(function (r, ri) { return { indice: ri, dia: r.dia, angIni: Math.round(r.angIni), angFim: Math.round(r.angFim), centro: Math.round(r.centro), clientes: r.unidades.length }; });
        // ---- semana sem NENHUM dia de saída da S10 (recesso/feriados, PS-3): tudo em sobra com motivo próprio ----
        if (!dias.length) {
            lista.forEach(function (u) { u.xs.forEach(function (x) { x.motivoSobra = 'sem_saida_semana'; res.sobra.push(x); }); });
            lista = [];
        }
        res.semSaidaNaSemana = !dias.length;
        // ---- dia de cada unidade: prazo, dia fechado, capacidade ----
        function permitidos(u) { return dias.filter(function (d) { return !naoRecebe(u.regra, d); }); }
        function pertoDe(u, cands) {   // ordena dias candidatos pelo setor mais perto em ângulo (dia sem setor: por último), depois data
            return cands.slice().sort(function (a, b) {
                var ca = dd[idx[a]].centro, cb = dd[idx[b]].centro;
                var xa = ca == null || u.ang == null ? 999 : difAng(ca, u.ang), xb = cb == null || u.ang == null ? 999 : difAng(cb, u.ang);
                return xa - xb || (a < b ? -1 : 1);
            });
        }
        var semAng = lista.filter(function (u) { return u.reg == null; });
        semAng.forEach(function (u) { u.xs.forEach(function (x) { x.motivoSemPosicao = 'sem_posicao'; res.semPosicao.push(x); }); });
        var aloca = lista.filter(function (u) { return u.reg != null; });
        aloca.sort(function (a, b) {
            if (a.pri !== b.pri) return a.pri ? -1 : 1;
            var pa = a.prazo || '9999', pb = b.prazo || '9999'; if (pa !== pb) return pa < pb ? -1 : 1;
            // mesmo prazo: a região do dia mais cedo primeiro (quem é da região de segunda pega a segunda antes de quem
            // só foi puxado para ela pelo prazo) — evita misturar regiões quando a capacidade aperta
            if (a.reg !== b.reg) return a.reg - b.reg;
            return ordX(a.xs[0], b.xs[0]) || (a.chave < b.chave ? -1 : 1);
        });
        aloca.forEach(function (u) {
            var alvo = dias[u.reg], perm = permitidos(u);
            if (!perm.length) { u.xs.forEach(function (x) { x.motivoSobra = 'dia_fechado'; x.diaSugerido = alvo; res.sobra.push(x); }); return; }
            var noPrazo = u.prazo ? perm.filter(function (d) { return d <= u.prazo; }) : perm;
            var base = noPrazo.length ? noPrazo : perm, estoura = !noPrazo.length && !!u.prazo;
            var ordem = base.indexOf(alvo) >= 0 ? [alvo].concat(pertoDe(u, base.filter(function (d) { return d !== alvo; }))) : pertoDe(u, base);
            // já vencido (nenhum dia permitido até o prazo): fica no dia da região mesmo assim, marcado (estoura)
            var sugerido = ordem[0], escolhido = null;
            for (var k = 0; k < ordem.length && !escolhido; k++) if (dd[idx[ordem[k]]].usado + u.vol <= CAP + 1e-9) escolhido = ordem[k];
            if (!escolhido && !estoura && noPrazo.length < perm.length) {   // não coube até o prazo: dia depois do prazo (estoura)
                var depois = pertoDe(u, perm.filter(function (d) { return noPrazo.indexOf(d) < 0; }));
                for (var q = 0; q < depois.length && !escolhido; q++) if (dd[idx[depois[q]]].usado + u.vol <= CAP + 1e-9) escolhido = depois[q];
            }
            if (!escolhido) { u.xs.forEach(function (x) { x.motivoSobra = 'capacidade'; x.diaSugerido = sugerido; res.sobra.push(x); }); return; }
            var di = dd[idx[escolhido]]; di.usado += u.vol;
            u.xs.forEach(function (x) { x.dia = escolhido; x.origemDia = 'sugestao'; x.diaSugerido = escolhido; x.regiao = u.reg; x.ang = u.ang == null ? null : Math.round(u.ang); di.lista.push(x); });
        });
        // ---- montar os dias ----
        dd.forEach(function (di) {
            di.lista.forEach(function (x) {
                x.situacao = situacaoPrazo(x.prazo, di.dia, cfg, 's10'); x.estoura = !!x.prazo && x.prazo < di.dia; x.diaFechado = naoRecebe(x.regra, di.dia);
                if (x.ang == null && x.c && x.c.pos) x.ang = Math.round(anguloDe(x.c.pos));
            });
            di.lista.sort(ordX);
            var mp = montarParadas(di.lista, cfg.voltaSede, { regras: regras, tempo: tempo });
            var t = { c24: 0, c48: 0, avulsos: 0, desconhecidos: 0, volume: 0 };
            di.lista.forEach(function (x) { if (x.v.vol == null) t.desconhecidos++; else { t.c24 += x.v.c24; t.c48 += x.v.c48; t.avulsos += x.v.avulsos; t.volume += x.v.vol; } });
            res.dias.push({ dia: di.dia, nome: di.nome, pedidos: di.lista, paradas: mp.paradas, semPosicao: mp.semPosicao, km: mp.km, kmReta: mp.kmReta,
                            horario: calcularHorarios(ROTA.ORIGEM, mp.paradas, tempo, cfg.voltaSede), volume: t.volume, ocupacao: t.volume / CAP,
                            c24: t.c24, c48: t.c48, avulsos: t.avulsos, desconhecidos: t.desconhecidos, excesso: t.volume > CAP + 1e-9, regiao: di.regiao });
            res.resumo.pedidos += di.lista.length; res.resumo.volume += t.volume;
            res.resumo.estouram += di.lista.filter(function (x) { return x.estoura; }).length;
            res.resumo.salvos += di.lista.filter(function (x) { return x.origemDia === 'salvo'; }).length;
        });
        res.sobra.forEach(function (x) { x.estoura = !!x.prazo && x.prazo <= res.fim; });
        res.semPosicao.forEach(function (x) { x.estoura = !!x.prazo && x.prazo < ini; });
        res.resumo.sobra = res.sobra.length; res.resumo.semPosicao = res.semPosicao.length; res.resumo.faltaMarcar = res.faltaMarcar.length;
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
        diasSemSaida: diasSemSaida,
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
        linksGoogleMaps: linksGoogleMaps,
        // 044
        minutosDe: minutosDe,
        hhmm: hhmm,
        tempoDe: tempoDe,
        calcularHorarios: calcularHorarios,
        ordenarComHorario: ordenarComHorario,
        regraDe: regraDe,
        regrasDe: regrasDe,
        naoRecebe: naoRecebe,
        proximaSaidaCliente: proximaSaidaCliente,
        marcacaoDe: marcacaoDe,
        sugestaoDe: sugestaoDe,
        entregaCaminhao: entregaCaminhao,
        cargaCd: cargaCd,
        // 046
        planejarSemana: planejarSemana,
        proximaSemana: proximaSemana,
        segundaDe: segundaDe,
        anguloDe: anguloDe
    };
    raiz.TempRioRotaCore = Core;
    if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
