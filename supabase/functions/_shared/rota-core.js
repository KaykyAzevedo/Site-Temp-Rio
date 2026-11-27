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
        VEICULO_SEPARANDO: 's10',    // dono 23/11: padrão FIXO, só quando não há escolha por pedido/cliente
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
        // Etapas candidatas à entrega; faturamento (saiu/atendido) ainda exige canhoto.
        ETAPAS_PENDENTES: ['aberto', 'na_carga', 'separando', 'separado', 'conferido', 'saiu', 'atendido'],
        ENVIADO_MAX_DIAS: 7,
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
        // Sugestão de juntar pedido a uma rota S10 já prevista (sugestoesJuntar): desvio EXTRA máximo, em km de rua
        // (linha reta × FATOR_ESTRADA), para inserir o cliente no trajeto. Só sugestão; nada muda sozinho.
        JUNTAR_DESVIO_KM: 3,
        // Distância: linha reta (haversine) × 1,3 só para ESTIMAR km de rua.
        FATOR_ESTRADA: 1.3,
        // Google Maps (link de rota): no computador até 9 destinos por link; no celular o app aceita só 3 paradas
        // intermediárias + o destino = 4. Os lotes são encadeados (cada um começa onde o anterior terminou).
        LOTE_GMAPS: 9,
        LOTE_GMAPS_MOVEL: 4,
        MOVEL_MQ: '(max-width: 1023px), (pointer: coarse)',
        TZ: 'America/Sao_Paulo'
    };
    // ===================== FROTA (047) =====================
    // Veículos vêm de rota_veiculos (047), editáveis no painel. Sem a 047 (tabela ausente): estes 3 padrões, as mesmas
    // regras do dono já valendo. modo 'cd_ceasa' = UMA parada no CD do CEASA (lista de carga); 'porta' = porta a porta.
    // capacidade = volume (cx24 = 9, cx48 = 16,5, pote = 0,375); null = "carga não definida": sem limite + aviso.
    // voltaSede null = usa a da rota_config (s10_volta_sede), como antes da 047.
    ROTA.VEICULOS_PADRAO = [
        { id: 'caminhao', nome: 'Caminhão (CEASA)', modo: 'cd_ceasa', capacidade: null, diasSemSaida: ROTA.DIAS_SEM_SAIDA_CAMINHAO, voltaSede: false, cor: '#b45309', ordem: 10, ativo: true },
        { id: 's10', nome: 'S10', modo: 'porta', capacidade: ROTA.CAPACIDADE_S10, diasSemSaida: ROTA.DIAS_SEM_SAIDA_S10, voltaSede: null, cor: '#2563eb', ordem: 20, ativo: true },
        { id: 'strada', nome: 'Strada', modo: 'porta', capacidade: null, diasSemSaida: [0, 6], voltaSede: false, cor: '#059669', ordem: 30, ativo: true }
    ];

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
        var desde = primeiro(l, 'canhotoDesde', 'canhoto_desde');
        // Sem a coluna056: nenhum legado presumido, conserva055.
        c.canhotoDesde = desde && isFinite(Date.parse(desde)) ? new Date(desde).toISOString() : null;
        c._pronta = true;
        return c;
    }
    function cfgOk(cfg) { return cfg && cfg._pronta ? cfg : cfgDe(cfg || CFG_PADRAO); }

    // Id de veículo: slug ^[a-z0-9_]{2,20}$, menos os nomes de propriedade herdada de Object (Sentinela V-BACK V4: 'constructor'
    // e '__proto__' passavam no regex e quebravam os mapas por id). O CHECK da 047 recusa os mesmos.
    var ID_VEIC_RESERVADO = /^(constructor|__proto__|prototype)$/;
    function idVeiculoValido(v) { return typeof v === 'string' && /^[a-z0-9_]{2,20}$/.test(v) && !ID_VEIC_RESERVADO.test(v); }
    function temProp(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
    // Linha de rota_veiculos (ou objeto já normalizado) -> veículo. id inválido: null (ignorado).
    // Domingo é SEMPRE dia sem saída (regra do dono; Sentinela V-BACK V3: o plano da semana e o CHECK da 046 só aceitam seg..sáb).
    function veiculoNorm(l) {
        if (!l) return null;
        var id = String(l.id == null ? '' : l.id).trim();
        if (!idVeiculoValido(id)) return null;
        var cap = l.capacidade !== undefined ? l.capacidade : l.capacidade_volume;
        cap = cap == null || cap === '' ? null : Number(cap);
        if (cap != null && !(isFinite(cap) && cap > 0)) cap = null;
        var ds = l.diasSemSaida !== undefined ? l.diasSemSaida : l.dias_sem_saida, dias = [];
        (ds == null ? [0] : ds).forEach(function (d) { d = Number(d); if (d >= 0 && d <= 6 && d === Math.floor(d) && dias.indexOf(d) < 0) dias.push(d); });
        if (dias.indexOf(0) < 0) dias.push(0);
        dias.sort(function (a, b) { return a - b; });
        var vs = l.voltaSede !== undefined ? l.voltaSede : l.volta_sede;
        var ordem = Number(l.ordem);
        return { id: id, nome: String(l.nome == null || String(l.nome).trim() === '' ? id : l.nome).slice(0, 40), modo: l.modo === 'cd_ceasa' ? 'cd_ceasa' : 'porta',
                 capacidade: cap, diasSemSaida: dias, voltaSede: vs == null ? null : !!vs,
                 cor: /^#[0-9a-fA-F]{6}$/.test(String(l.cor || '')) ? String(l.cor).toLowerCase() : '#64748b',
                 ordem: isFinite(ordem) ? ordem : 100, ativo: l.ativo === undefined ? true : !!l.ativo };
    }
    // linhas: lista de rota_veiculos (inclusive inativos) ou null/undefined = 047 ausente (VEICULOS_PADRAO).
    // -> { lista (ordem, id), porId, ativos, padrao: true se veio do fallback }.
    function frotaDe(linhas) {
        var padrao = linhas == null, porId = Object.create(null), lista = [];
        (padrao ? ROTA.VEICULOS_PADRAO : linhas).forEach(function (l) { var v = veiculoNorm(l); if (v && !temProp(porId, v.id)) { porId[v.id] = v; lista.push(v); } });
        lista.sort(function (a, b) { return a.ordem - b.ordem || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
        return { lista: lista, porId: porId, ativos: lista.filter(function (v) { return v.ativo; }), padrao: padrao };
    }
    var FROTA_PADRAO = frotaDe(null);
    // cfg pronta + frota. veiculos undefined: mantém a frota que a cfg já tiver (ou os padrões).
    function comFrota(cfg, veiculos) {
        var c = cfgOk(cfg);
        if (veiculos === undefined && c.frota) return c;
        var f = veiculos == null ? FROTA_PADRAO : frotaDe(veiculos), out = {};
        Object.keys(c).forEach(function (k) { out[k] = c[k]; });
        out.frota = f.porId; out.veiculos = f.lista; out.frotaPadrao = f.padrao;
        // Dia sem saída de NENHUM veículo ativo (sem veículo ativo: todo dia).
        out.diasSemSaidaGeral = [0, 1, 2, 3, 4, 5, 6].filter(function (w) { return f.ativos.every(function (v) { return v.diasSemSaida.indexOf(w) >= 0; }); });
        return out;
    }
    function veiculoDaFrota(id, cfg) { var f = cfg && cfg.frota; return f && temProp(f, id) ? f[id] : null; }

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
    function etapaEnviada(p) { return !!p && (p.etapa === 'saiu' || p.etapa === 'atendido'); }
    function faturadoEm(p) {
        var campos = ['dt_saida', 'dt_nota', 'dt_atendido'];
        for (var i = 0; p && i < campos.length; i++) if (p[campos[i]] && isFinite(Date.parse(p[campos[i]]))) return p[campos[i]];
        return null;
    }
    function temCanhoto(canhotos, cd) {
        var v = canhotos && canhotos[cd];
        return Array.isArray(v) ? v.some(function (c) { return c && !c.substituido_em; }) : !!v;
    }
    function legadoRecebido(p, cfg) {
        var desde = cfgOk(cfg).canhotoDesde, em = faturadoEm(p);
        return etapaEnviada(p) && !!desde && !!em && Date.parse(em) < Date.parse(desde);
    }
    function confirmacaoEntrega(confirmacoes, cd) {
        var c = confirmacoes && confirmacoes[cd];
        return c && !c.reprogramado && !c.desfeito_em && isFinite(Date.parse(c.confirmado_em)) ? c : null;
    }
    function recebidoEntrega(p, canhotos, cfg, confirmacoes) { if (p && confirmacoes && confirmacoes[p.cd_pedido] && confirmacoes[p.cd_pedido].reprogramado) return false; return !!p && (temCanhoto(canhotos, p.cd_pedido) || !!confirmacaoEntrega(confirmacoes, p.cd_pedido) || legadoRecebido(p, cfg)); }
    function instanteSaida(dia, cfg) {
        var min = cfg.horaSaida;
        return dia + 'T' + String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0') + ':00-03:00';
    }
    // 061: a foto nunca antecipa o faturamento. Saida = max(foto, primeira
    // hora de saida >= faturamento), mantendo o fallback de dia CORRIDO da059.
    // Sao Paulo usa UTC-3 nas datas operacionais deste sistema (sem horario de verao).
    function saidaEntrega(p, ctx) {
        ctx = ctx || {};
        var em = faturadoEm(p), cfg = cfgOk(ctx.cfg);
        if (!em) return null;
        var dia = ctx.saidas && ctx.saidas[p.cd_pedido], fx = ctx.fechada;
        if (!dia && fx && fx.estado !== 'reaberta' && (fx.itens || []).some(function (i) { return i.cd_pedido === p.cd_pedido && !i.removido_em; })) dia = fx.data;
        function instante(d) { return instanteSaida(d, cfg); }
        var salvo = dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : null;
        dia = diaSP(em);
        if (Date.parse(em) > Date.parse(instante(dia))) dia = somaDias(dia, 1);
        return instante(salvo && salvo > dia ? salvo : dia);
    }
    function etapaEntrega(p, ctx) {
        ctx = ctx || {};
        if (!p) return 'aberto';
        if (ctx.pedidos_estado && ctx.pedidos_estado[p.cd_pedido] && typeof ctx.pedidos_estado[p.cd_pedido].pronto_despacho === 'boolean') { var e070 = estado070(p, ctx); return e070.entregue || !e070.pendente ? 'recebido' : e070.pronto_despacho ? 'pronto_despacho' : p.etapa; }
        if (recebidoEntrega(p, ctx.canhotos, ctx.cfg, ctx.confirmacoes)) return 'recebido';
        if (!etapaEnviada(p)) return p.etapa;
        var em = saidaEntrega(p, ctx), agora = ctx.agora == null ? Date.now() : new Date(ctx.agora).getTime();
        return em && agora >= Date.parse(em) ? 'enviado' : 'pronto_despacho';
    }
    function recebidoEm(p, ctx) {
        ctx = ctx || {};
        if (p && ctx.confirmacoes && ctx.confirmacoes[p.cd_pedido] && ctx.confirmacoes[p.cd_pedido].reprogramado) return null;
        var lista = ctx.canhotos && ctx.canhotos[p.cd_pedido], ultimo = null;
        if (Array.isArray(lista)) lista.forEach(function (c) {
            if (c && !c.substituido_em && isFinite(Date.parse(c.enviado_em)) && (!ultimo || Date.parse(c.enviado_em) > Date.parse(ultimo))) ultimo = c.enviado_em;
        });
        if (temCanhoto(ctx.canhotos, p.cd_pedido)) return ultimo;
        var confirmacao = confirmacaoEntrega(ctx.confirmacoes, p.cd_pedido);
        return (confirmacao && confirmacao.confirmado_em) || (legadoRecebido(p, ctx.cfg) ? faturadoEm(p) : null);
    }
    function recebidoRecente(p, ctx) {
        ctx = ctx || {};
        var em = recebidoEm(p, ctx), hoje = diaSP(ctx.agora == null ? new Date() : ctx.agora), dia = diaSP(em);
        return !!dia && (dia === hoje || dia === somaDias(hoje, -1));
    }
    function recebidoRotulo(p, ctx) {
        ctx = ctx || {};
        if (temCanhoto(ctx.canhotos, p.cd_pedido)) return 'Recebido (canhoto)';
        var c = confirmacaoEntrega(ctx.confirmacoes, p.cd_pedido);
        return c ? 'Recebido (marcado por ' + (c.confirmado_nome || 'equipe') + ')' : legadoRecebido(p, ctx.cfg) ? 'Recebido (legado)' : '';
    }
    // Uma linha por pedido, consulta limitada aos ids ja carregados. Erros (inclusive
    // falta da059) interrompem a leitura: nao inventar ausencia de rota fechada.
    function coletarSaidas(sb, pedidos) {
        var ids = Array.from(new Set((pedidos || []).map(function (p) { return p.cd_pedido; }))), mapa = {}, corrente = Promise.resolve();
        for (var i = 0; i < ids.length; i += 200) (function (bloco) {
            corrente = corrente.then(function () {
                return sb.from('rota_059_saidas').select('cd_pedido,dia_saida').in('cd_pedido', bloco).then(function (r) {
                    if (r.error) throw new Error('Saidas de entrega (059): ' + (r.error.message || r.error.code));
                    (r.data || []).forEach(function (x) { mapa[x.cd_pedido] = x.dia_saida; });
                });
            });
        })(ids.slice(i, i + 200));
        return corrente.then(function () { return mapa; });
    }
    function enviadoAntigo(p, canhotos, hoje, cfg, ctx) {
        if (p && ctx && ((ctx.reprogramados && ctx.reprogramados[p.cd_pedido]) || (ctx.confirmacoes && ctx.confirmacoes[p.cd_pedido] && ctx.confirmacoes[p.cd_pedido].reprogramado))) return false;
        var em = saidaEntrega(p, Object.assign({}, ctx, { cfg: cfg }));
        return etapaEnviada(p) && !recebidoEntrega(p, canhotos, cfg, ctx && ctx.confirmacoes) && !!em &&
            Date.parse(hoje + 'T12:00:00Z') - Date.parse(diaSP(em) + 'T12:00:00Z') > ROTA.ENVIADO_MAX_DIAS * 864e5;
    }
    // 070: servidor e coluna Pronto usam o MESMO estado. Foto persistida supera filtros vivos.
    function estado070(p, opts) {
        var e = p && opts && opts.pedidos_estado && opts.pedidos_estado[p.cd_pedido];
        if (!e || typeof e.entregue !== 'boolean' || typeof e.pendente !== 'boolean' || typeof e.pronto_despacho !== 'boolean' || (e.entregue && e.pendente) || (e.pronto_despacho && (!e.pendente || e.entregue))) throw new Error('Estado canonico070 indisponivel ou invalido');
        return e;
    }
    function reserva070(p, dia, opts) {
        var r = opts && opts.reservas_070 && opts.reservas_070[dia];
        return r && Array.isArray(r.itens) ? r.itens.find(function (i) { return i.cd_pedido === p.cd_pedido && i.ativo === true && i.pronto_ao_reservar === true; }) || null : null;
    }
    function elegivel070(p, dia, opts) {
        var modo = opts.modo_planejamento || 'previsao';
        if (modo !== 'previsao' && modo !== 'definitiva') throw new Error('Modo de planejamento070 invalido');
        if (modo === 'previsao') return pendenteEntrega(p, opts.canhotos, opts.hoje || dia, opts.cfg, opts);
        var e = estado070(p, opts), r = reserva070(p, dia, opts), h = opts.reservas_070 && opts.reservas_070[dia];
        if (e.entregue || (e.data_saida_marcada && e.data_saida_marcada > dia)) return false;
        if (r) return true;
        return e.pronto_despacho && !(h && h.origem === 'manual');
    }
    function opcoes070(opts) {
        opts = opts || {};
        if (opts.modo_planejamento && ['previsao','definitiva'].indexOf(opts.modo_planejamento) < 0) throw new Error('Modo de planejamento070 invalido');
        var plano = Object.assign({}, opts.plano || {}), porPedido = Object.assign({}, opts.porPedido || {});
        Object.keys(opts.pedidos_estado || {}).forEach(function (cd) {
            var e = opts.pedidos_estado[cd];
            if (e && e.data_saida_marcada && !plano[cd]) plano[cd] = e.data_saida_marcada;
        });
        Object.keys(opts.reservas_070 || {}).forEach(function (dia) {
            (opts.reservas_070[dia].itens || []).forEach(function (i) {
                if (i.ativo === true && i.pronto_ao_reservar === true) {
                    if (!plano[i.cd_pedido]) plano[i.cd_pedido] = { dia: dia, veiculo_id: i.veiculo_id };
                    if (!porPedido[i.cd_pedido]) porPedido[i.cd_pedido] = i.veiculo_id;
                }
            });
        });
        return Object.assign({}, opts, { plano: plano, porPedido: porPedido });
    }
    function coletarEstados070(sb, pedidos) {
        var ids = Array.from(new Set((pedidos || []).map(function (p) { return p.cd_pedido; }))), mapa = {}, corrente = Promise.resolve();
        for (var i=0;i<ids.length;i+=200) (function (bloco) {
            corrente = corrente.then(function () { return sb.rpc('rota_070_estados_pedidos', { p_cds: bloco }).then(function (r) {
                if (r.error) throw new Error('Estado070: '+(r.error.message || r.error.code));
                if (!Array.isArray(r.data) || r.data.length !== bloco.length) throw new Error('Estado070 incompleto');
                r.data.forEach(function (e) {
                    if (!e || bloco.indexOf(e.cd_pedido)<0 || mapa[e.cd_pedido]) throw new Error('Estado070 invalido');
                    mapa[e.cd_pedido]=e;estado070({cd_pedido:e.cd_pedido},{pedidos_estado:mapa});
                });
            }); });
        })(ids.slice(i,i+200));
        return corrente.then(function () { return mapa; });
    }
    function pendenteEntrega(p, canhotos, hoje, cfg, ctx) {
        if (p && ctx && ctx.pedidos_estado) {
            var estado = ctx.pedidos_estado[p.cd_pedido];
            if (!estado || typeof estado.entregue !== 'boolean' || typeof estado.pendente !== 'boolean' || (estado.entregue && estado.pendente)) throw new Error('Estado canonico de pendencia indisponivel ou invalido');
            return estado.pendente;
        }
        if (p && ctx && ((ctx.reprogramados && ctx.reprogramados[p.cd_pedido]) || (ctx.confirmacoes && ctx.confirmacoes[p.cd_pedido] && ctx.confirmacoes[p.cd_pedido].reprogramado))) return true;
        return !!p && ROTA.ETAPAS_PENDENTES.indexOf(p.etapa) >= 0 && !recebidoEntrega(p, canhotos, cfg, ctx && ctx.confirmacoes) &&
            (!etapaEnviada(p) || (!!faturadoEm(p) && !enviadoAntigo(p, canhotos, hoje, cfg, ctx)));
    }
    // 063 opcional. Nao confundir ausencia da migracao com erro real de leitura.
    function coletarConfirmacoes(sb, pedidos) {
        var ids = Array.from(new Set((pedidos || []).map(function (p) { return p.cd_pedido; }))), mapa = {}, instalada = true, corrente = Promise.resolve();
        for (var i = 0; i < ids.length; i += 200) (function (bloco) {
            corrente = corrente.then(function () {
                if (!instalada) return;
                return sb.rpc('rota_063_ler_entregas', { p_cds: bloco }).then(function (r) {
                    if (r.error) {
                        if (['PGRST202', '42883'].indexOf(String(r.error.code)) >= 0) { instalada = false; mapa = {}; return; }
                        throw new Error('Confirmacoes de entrega (063): ' + (r.error.message || r.error.code));
                    }
                    if (r.data != null && !Array.isArray(r.data)) throw new Error('Resposta de entregas063 invalida');
                    (r.data || []).forEach(function (c) {
                        if (!c || (c.reprogramado !== undefined && typeof c.reprogramado !== 'boolean') || bloco.indexOf(c.cd_pedido) < 0 || c.desfeito_em || !isFinite(Date.parse(c.confirmado_em)) || !Number.isSafeInteger(c.id) || c.id < 1) throw new Error('Status de entrega063 invalido');
                        mapa[c.cd_pedido] = c;
                    });
                });
            });
        })(ids.slice(i, i + 200));
        return corrente.then(function () { return { instalada: instalada, porPedido: mapa }; });
    }
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
    // veiculo (opcional): id do veículo. Com a frota na cfg (comFrota): os dias DELE na rota_veiculos; sem frota: os
    // padrões (s10 seg..sex, caminhao seg..sáb, strada seg..sex). Sem veículo: dia sem saída de NENHUM veículo
    // (cfg.diasSemSaidaGeral; sem frota: ROTA.DIAS_SEM_SAIDA). Veículo desconhecido: ROTA.DIAS_SEM_SAIDA.
    function diasSemSaida(veiculo, cfg) {
        if (veiculo) {
            var v = veiculoDaFrota(veiculo, cfg);
            if (v) return v.diasSemSaida;
            if (veiculo === 's10') return ROTA.DIAS_SEM_SAIDA_S10;
            if (veiculo === 'caminhao') return ROTA.DIAS_SEM_SAIDA_CAMINHAO;
            return temProp(FROTA_PADRAO.porId, veiculo) ? FROTA_PADRAO.porId[veiculo].diasSemSaida : ROTA.DIAS_SEM_SAIDA;
        }
        return cfg && cfg.diasSemSaidaGeral ? cfg.diasSemSaidaGeral : ROTA.DIAS_SEM_SAIDA;
    }
    function temSaida(dia, cfg, veiculo) { return diasSemSaida(veiculo, cfg).indexOf(diaSemana(dia)) < 0 && !ehFeriado(dia, cfg); }
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
    // 047: qualquer id de veículo (slug); se ele está ATIVO quem decide é o planejador (inativo: fica em aguardando).
    // Retorna { veiculo, origem: 'pedido'|'padrao' } ou null.
    function idVeiculoOk(v) { return idVeiculoValido(v); }
    function marcacaoDe(p, padroes, porPedido) {
        if (!p) return null;
        var v = porPedido ? porPedido[p.cd_pedido] : null;
        if (idVeiculoOk(v)) return { veiculo: v, origem: 'pedido' };
        v = p.documento && padroes ? padroes[p.documento] : null;
        if (idVeiculoOk(v)) return { veiculo: v, origem: 'padrao' };
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
    // 058: pessoa fisica usa somente a copia de entrega do pedido; nunca documento/identidade por nome.
    function clienteDoPedido(p, clientes) {
        if (!p) return null;
        if (p.cliente_tipo !== 'cpf') return p.documento ? (clientes || {})[p.documento] || null : null;
        return { nome: p.cliente_nome || null, logradouro: p.entrega_logradouro || null, numero: p.entrega_numero || null,
            complemento: p.entrega_complemento || null, bairro: p.entrega_bairro || null, cidade: p.entrega_cidade || null,
            uf: p.entrega_uf || null, cep: p.entrega_cep || null, pos: null, precisao: null };
    }
    function enderecoDoCliente(c) {
        return c ? [[c.logradouro, c.numero].filter(Boolean).join(', '), c.complemento].filter(Boolean).join(' — ') : '';
    }
    function montarParadas(lista, volta, o) {
        o = o || {};
        var regras = o.regras || {}, porChave = {}, comPos = [], semPos = [];
        lista.forEach(function (x) {
            var chave = x.p.documento ? 'd:' + x.p.documento : 'p:' + x.p.cd_pedido;
            var sp = porChave[chave];
            if (!sp) {
                sp = porChave[chave] = { chave: chave, documento: x.p.documento || null, nome: (x.c && x.c.nome) || x.p.cliente_nome || null,
                    bairro: (x.c && x.c.bairro) || null, cidade: (x.c && x.c.cidade) || null, endereco: enderecoDoCliente(x.c), uf: (x.c && x.c.uf) || null, pos: x.c && x.c.pos ? x.c.pos : null,
                    precisao: x.c ? x.c.precisao : null, tipo: x.p.cliente_tipo, veiculo: x.veiculo, motivo: x.motivo, detalhe: x.detalhe, pedidos: [] };
                var rg = x.p.documento ? regras[x.p.documento] : null;
                if (rg) { sp.regra = rg; sp.prioridade = !!rg.prioridade; sp.janela = rg.janela; sp.obs = rg.obs; }
                (sp.pos ? comPos : semPos).push(sp);
            }
            sp.pedidos.push(x);
        });
        var tempo = o.tempo || tempoDe(null);
        // 050 (rota fechada): ordem SALVA quando todas as paradas têm ordem (menor ordem entre os pedidos do cliente);
        // se faltar ordem em alguma (ajuste no veículo), recalcula só este veículo pelo caminho de sempre (2-opt).
        var ordemDe = function (sp) { var m = null; sp.pedidos.forEach(function (x) { if (x.fechadaOrdem == null) m = NaN; else if (m === null || x.fechadaOrdem < m) m = x.fechadaOrdem; }); return m; };
        var fixa = !!o.ordemFixa && comPos.concat(semPos).every(function (sp) { var m = ordemDe(sp); return m !== null && isFinite(m); });
        if (fixa) {
            // Sentinela RF-4: a SEQUÊNCIA salva vale inteira (com ou sem pino). Um cliente que perde/ganha o pino depois de
            // fechar NÃO muda de lugar: 'sequencia' é a ordem de entrega (lista, PDF, motorista, mensagens); 'paradas' (só as
            // com posição, na mesma ordem) serve só para trajeto/mapa/links e 'semPosicao' só para avisar.
            var porOrdem = function (a, b) { return ordemDe(a) - ordemDe(b) || (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0); };
            var todas = comPos.concat(semPos).sort(porOrdem);
            var seqF = todas.filter(function (sp) { return !!sp.pos; }), semF = todas.filter(function (sp) { return !sp.pos; });
            var kmF = comprimento(ROTA.ORIGEM, seqF, volta);
            return { paradas: seqF, semPosicao: semF, sequencia: todas, kmReta: kmF, km: kmF * ROTA.FATOR_ESTRADA, ordemFixa: true };
        }
        var seq = ordenarComHorario(ROTA.ORIGEM, comPos, tempo, volta, o.fim || null);
        semPos.sort(function (a, b) {
            var ba = norm(a.bairro), bb = norm(b.bairro);
            if (!ba !== !bb) return ba ? -1 : 1;
            return ba.localeCompare(bb, 'pt-BR') || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
        });
        var kmReta = comprimento(ROTA.ORIGEM, seq, volta);
        return { paradas: seq, semPosicao: semPos, sequencia: seq.concat(semPos), kmReta: kmReta, km: kmReta * ROTA.FATOR_ESTRADA };
    }
    // Ordem de ENTREGA de um bloco (porta: sequencia; sem ela, paradas + sem posição, como antes). Ver RF-4.
    function sequenciaDe(b) { return b ? (b.sequencia || (b.paradas || []).concat(b.semPosicao || [])) : []; }
    // Parada do CD do CEASA (caminhão, v2): sempre a ÚLTIMA; sem horário por cliente.
    function paradaCd(lista) {
        var cg = cargaCd(lista);
        return { chave: 'cd:ceasa', cd: true, documento: null, nome: ROTA.CEASA_CD_NOME, bairro: null, cidade: null, pos: ROTA.CEASA_CENTRO,
                 precisao: null, tipo: null, veiculo: 'caminhao', motivo: 'cd', detalhe: null, pedidos: lista, carga: cg.itens, total: cg.total };
    }

    // ===================== ROTA FECHADA (050) =====================
    // f = { data: 'YYYY-MM-DD', itens: [{ cd_pedido, veiculo_id, ordem (null = recalcular o veículo), origem,
    //       removido_em? }], fechada_em?, fechada_nome?, automatico?, versao? } (linhas de rota_dia_item + cabeçalho).
    // Item com removido_em = "Remover de hoje": fora da rota de hoje, vai para o próximo dia (não some).
    function fechadaDe(f) {
        var porCd = Object.create(null), removidos = Object.create(null), docsRemovidos = Object.create(null);
        (f.itens || []).forEach(function (it) {
            if (!it || it.cd_pedido == null || !idVeiculoValido(it.veiculo_id)) return;
            var cd = Number(it.cd_pedido);
            if (it.removido_em) { removidos[cd] = { em: it.removido_em, nome: it.removido_nome || null }; if (it.documento) docsRemovidos[it.documento] = true; return; }
            var o = it.ordem == null || it.ordem === '' ? null : Number(it.ordem);
            porCd[cd] = { veiculo: it.veiculo_id, ordem: o != null && isFinite(o) ? o : null, origem: it.origem === 'separando' ? 'separando' : it.origem === 'adicionado' ? 'adicionado' : 'previsao' };
        });
        return { porCd: porCd, removidos: removidos, docsRemovidos: docsRemovidos, recalcular: Object.create(null),
                 meta: { data: f.data, fechadaEm: f.fechada_em || null, nome: f.fechada_nome || null, automatico: !!f.automatico, versao: f.versao || null } };
    }
    // Foto de um plano (para fechar ou para regravar a ordem de UM veículo depois de um ajuste): [{ cd_pedido, veiculo_id,
    // ordem }] na ordem da rota. Porta a porta: paradas com posição, depois sem posição (todos os pedidos de uma parada
    // têm a mesma ordem). CD do CEASA: 1 ordem por cliente da carga. so = id do veículo (opcional).
    function itensDaRota(pl, so) {
        var out = [];
        (pl && pl.ordem || []).forEach(function (id) {
            if (so && id !== so) return;
            var b = pl.veiculos[id];
            if (!b || b.semSaida) return;
            var n = 0;
            if (b.cd) b.cd.carga.forEach(function (it) { n++; it.pedidos.forEach(function (cd) { out.push({ cd_pedido: Number(cd), veiculo_id: id, ordem: n }); }); });
            else sequenciaDe(b).forEach(function (sp) { n++; sp.pedidos.forEach(function (x) { out.push({ cd_pedido: Number(x.p.cd_pedido), veiculo_id: id, ordem: n }); }); });
        });
        return out;
    }

    // 054: proposta atômica. Reordena só veículos com novos separando. Itens históricos/045 da foto
    // permanecem no fim para cobrir exatamente o conjunto salvo, como no ajuste manual da 050.
    function propostaSeparando(pedidos, clientes, dia, opts) {
        var pl = planejar(pedidos, clientes, dia, Object.assign({}, opts, { projetarSeparando: true })), adicoes = pl.adicoesSeparando || [];
        var veiculos = [], ordem = [];
        adicoes.forEach(function (it) { if (veiculos.indexOf(it.veiculo_id) < 0) veiculos.push(it.veiculo_id); });
        veiculos.sort();
        veiculos.forEach(function (id) {
            var itens = itensDaRota(pl, id), vistos = Object.create(null), n = 0;
            itens.forEach(function (it) { vistos[it.cd_pedido] = true; n = Math.max(n, it.ordem); ordem.push(it); });
            (opts.fechada.itens || []).forEach(function (it) {
                if (it.veiculo_id === id && !it.removido_em && !vistos[it.cd_pedido]) {
                    vistos[it.cd_pedido] = true; ordem.push({ cd_pedido: Number(it.cd_pedido), veiculo_id: id, ordem: ++n });
                }
            });
        });
        return { adicoes: adicoes, veiculos: veiculos, ordem: ordem };
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
    // 047 (frota): opts.veiculos = linhas de rota_veiculos (inclusive inativas); ausente/null = os 3 padrões
    //   (ROTA.VEICULOS_PADRAO). res.veiculos = { id: bloco } dos veículos ATIVOS, na ordem de res.ordem; res.s10 e
    //   res.caminhao continuam (mesmo objeto do bloco; veículo inativo/ausente = bloco vazio com inativo: true).
    //   Bloco 'porta': { id, nome, modo, cor, capacidade (null = sem limite), semLimite, pedidos, paradas, semPosicao,
    //   volume, ocupacao (null sem limite), c24, c48, avulsos, desconhecidos, km, kmReta, volta, horario, semSaida }.
    //   Bloco 'cd_ceasa' (v2): + cd (parada do CD), portas; sem 'marcacao' (modo automático) vira porta a porta.
    //   Pedido marcado em veículo inativo/inexistente: res.aguardando com x.veiculoInativo = true.
    //   Veículo que não sai hoje (dias_sem_saida/feriado): pedidos dele em fica, motivoFica 'sem_saida_s10' (S10) ou
    //   'sem_saida_veiculo' (outros), com a próxima saída DELE. Capacidade: a do veículo (S10 2700); null = sem limite.
    function planejar(pedidos, clientes, dia, opts) {
        opts = opcoes070(opts);
        var excluir = opts.excluir || {}, ignorados = opts.ignorados || {}, plano = opts.plano || {}, cfg = comFrota(opts.cfg, opts.veiculos), excecoes = opts.excecoes || {};
        var v2 = !!opts.marcacao, padroes = opts.padroes || excecoes, porPedido = opts.porPedido || {};
        var regras = regrasDe(opts.regras), tempo = tempoDe(cfg);
        // 050 (opcional): rota do dia FECHADA (foto). Só vale no modo v2 e para o próprio dia da foto.
        var fx = v2 && opts.fechada && opts.fechada.data === dia ? fechadaDe(opts.fechada) : null;
        var res = { dia: dia, semSaida: !temSaida(dia, cfg), feriado: ehFeriado(dia, cfg), cfg: cfg, modo: v2 ? 'marcacao' : 'auto',
                    veiculos: Object.create(null), ordem: [], frota: cfg.veiculos, fica: [], aguardando: [], ignorados: [], entregues: {},
                    fechada: fx ? fx.meta : null, adicoesSeparando: [],
                    enviadosAntigos: (pedidos || []).filter(function (p) { return enviadoAntigo(p, opts.canhotos, opts.hoje || dia, cfg, opts); }) };
        function bloco(v, inativo) {
            var b = { id: v.id, nome: v.nome, modo: v.modo, cor: v.cor, capacidade: v.capacidade, semLimite: v.capacidade == null, inativo: !!inativo,
                      pedidos: [], paradas: [], semPosicao: [], volume: 0, ocupacao: null, c24: 0, c48: 0, avulsos: 0, desconhecidos: 0, km: 0, kmReta: 0,
                      volta: v.voltaSede == null ? cfg.voltaSede : v.voltaSede, horario: null, semSaida: !temSaida(dia, cfg, v.id) };
            if (v.modo === 'cd_ceasa') { b.cd = null; b.volta = false; }
            return b;
        }
        cfg.veiculos.forEach(function (v) { if (v.ativo) { res.veiculos[v.id] = bloco(v); res.ordem.push(v.id); } });
        ['s10', 'caminhao'].forEach(function (id) {   // aliases de antes da 047
            res[id] = temProp(res.veiculos, id) ? res.veiculos[id] : bloco(veiculoDaFrota(id, cfg) || FROTA_PADRAO.porId[id], true);
        });
        res.ceasa = res.caminhao.pedidos;   // nome antigo (compatibilidade)
        if (res.semSaida) return res;
        // próxima saída DA S10 (compatibilidade: res.semProxima). Cada veículo usa a dele (proxVei).
        var proxVei = Object.create(null);
        function proximaDe(id) { if (!temProp(proxVei, id)) proxVei[id] = proximaSaida(dia, false, cfg, id); return proxVei[id]; }
        res.semProxima = !proximaDe('s10');
        var cands = [];
        (pedidos || []).forEach(function (p) {
            var foto070 = fx && temProp(fx.porCd,p.cd_pedido) && (opts.modo_planejamento === 'definitiva' || (opts.pedidos_estado && opts.pedidos_estado[p.cd_pedido] && typeof opts.pedidos_estado[p.cd_pedido].pronto_despacho === 'boolean'));
            if ((!foto070 && !elegivel070(p,dia,opts)) || excluir[p.cd_pedido]) return;
            var c = clienteDoPedido(p, clientes);
            var v = volumePedido(p), ve, x, prazo, vq;
            if (v2) {
                var m = marcacaoDe(p, padroes, porPedido), sug = sugestaoDe(p, c, cfg);
                // O ERP pode avancar a etapa durante a noite. O inicio da separacao
                // depois da saida conserva o fallback S10 para a proxima rota,
                // sem criar marcacao permanente nem sobrescrever escolha manual.
                var sepDia = p.dt_sep_inicio && diaSP(p.dt_sep_inicio);
                var sepAdiado = !!sepDia && sepDia < dia && Date.parse(p.dt_sep_inicio) > Date.parse(instanteSaida(sepDia, cfg));
                if (!m && (p.etapa === 'separando' || sepAdiado)) m = { veiculo: ROTA.VEICULO_SEPARANDO, origem: 'separando' };
                vq = m ? m.veiculo : null; prazo = prazoDe(p.dt_pedido, cfg, vq);
                x = { p: p, c: c, prazo: prazo, situacao: situacaoPrazo(prazo, dia, cfg, vq), v: v, sugestao: sug, marcacao: m ? m.origem : null,
                      veiculo: m ? m.veiculo : null, motivo: m ? 'marcado' : null, detalhe: m ? m.origem : null, ceasa: motivoCeasa(c) };
                var vm = m ? veiculoDaFrota(m.veiculo, cfg) : null;
                if (vm && vm.modo === 'cd_ceasa') x.entrega = entregaCaminhao(c, cfg);
            } else {
                ve = veiculoDe(p, c, cfg, excecoes);
                vq = ve.veiculo; prazo = prazoDe(p.dt_pedido, cfg, vq);
                x = { p: p, c: c, prazo: prazo, situacao: situacaoPrazo(prazo, dia, cfg, vq), v: v,
                      veiculo: ve.veiculo, motivo: ve.motivo, detalhe: ve.detalhe, ceasa: ve.motivo === 'ceasa' ? ve.detalhe : null };
            }
            x.regra = p.documento ? regras[p.documento] || null : null;
            x.separando = opts.modo_planejamento === 'definitiva' ? elegivel070(p,dia,opts) : v2 && (p.etapa === 'separando' || sepAdiado);
            var ig = ignorados[p.cd_pedido];
            if (ig) { x.ignorado = ig === true ? {} : ig; res.ignorados.push(x); return; }   // 045: fora da rota até reativar
            var pd = plano[p.cd_pedido];
            if (pd && typeof pd === 'object') pd = pd.dia;   // 047: { dia, veiculo_id }
            if (pd && /^\d{4}-\d{2}-\d{2}$/.test(String(pd)) && String(pd) >= dia) x.planoDia = String(pd);   // 046: só informação
            cands.push(x);
        });
        // A decisão é calculada antes de percorrer os itens: até as paradas anteriores do veículo afetado
        // perdem a ordem fixa. A foto original é imutável e a RPC 054 revalida tudo antes de persistir.
        // Corte SP do proprio dia: apos a saida nao se acrescenta nem reordena
        // automaticamente uma foto. A inclusao manual ja salva continua livre.
        var limite = Date.parse(instanteSaida(dia, cfg));
        var agoraInclusao = opts.agora == null ? Date.now() : new Date(opts.agora).getTime();
        if (fx && agoraInclusao <= limite && opts.projetarSeparando !== false) cands.forEach(function (x) {
            var cd = x.p.cd_pedido, b = x.veiculo && res.veiculos[x.veiculo];
            if (x.separando && !temProp(fx.porCd, cd) && !temProp(fx.removidos, cd) &&
                !(x.p.documento && fx.docsRemovidos[x.p.documento]) && b && !b.semSaida) {
                fx.porCd[cd] = { veiculo: x.veiculo, ordem: null, origem: 'separando' };
                fx.recalcular[x.veiculo] = true;
                res.adicoesSeparando.push({ cd_pedido: Number(cd), veiculo_id: x.veiculo });
            }
        });
        // Prioridade: prazo (mais antigo primeiro), depois o pedido mais antigo, depois o código (estável).
        cands.sort(function (a, b) {
            var pa = a.prazo || '9999', pb = b.prazo || '9999';
            if (pa !== pb) return pa < pb ? -1 : 1;
            var da = String(a.p.dt_pedido), db = String(b.p.dt_pedido);
            if (da !== db) return da < db ? -1 : 1;
            return Number(a.p.cd_pedido) - Number(b.p.cd_pedido);
        });
        cands.forEach(function (x) {
            // Se o primeiro tique do dia atrasar, o fechamento automatico ainda
            // nao pode capturar um pedido criado/separado depois da saida.
            if (!fx && opts.fechamentoAutomatico && [x.p.dt_pedido, x.p.dt_sep_inicio].some(function (em) { return em && Date.parse(em) > limite; })) {
                x.motivoFica = 'rota_fechada'; x.proxima = proximaDe(x.veiculo || 's10');
                x.estoura = !x.proxima || (!!x.prazo && x.prazo < x.proxima); res.fica.push(x); return;
            }
            if (fx) {   // 050: dia FECHADO — só a foto, no veículo da foto (sem capacidade/dia fechado: o Márcio decidiu)
                var it = temProp(fx.porCd, x.p.cd_pedido) ? fx.porCd[x.p.cd_pedido] : null;
                if (!it) {   // entrou depois / removido de hoje: vai para o próximo dia (com saída) em que o cliente recebe
                    var pf = x.separando ? proximaSaida(dia, false, cfg, x.veiculo || null) : proximaSaidaCliente(dia, x.regra, cfg, x.veiculo || null);
                    x.motivoFica = 'rota_fechada'; x.proxima = pf; x.estoura = !pf || (!!x.prazo && x.prazo < pf);
                    if (temProp(fx.removidos, x.p.cd_pedido)) x.removidoHoje = fx.removidos[x.p.cd_pedido];
                    res.fica.push(x); return;
                }
                x.veiculo = it.veiculo; x.fechadaOrdem = fx.recalcular[it.veiculo] ? null : it.ordem; x.origemFechada = it.origem;
                x.entrouAoSeparar = it.origem === 'separando' || x.separando;
                x.diaSemReceber = x.entrouAoSeparar && naoRecebe(x.regra, dia);
                var bf = temProp(res.veiculos, it.veiculo) ? res.veiculos[it.veiculo] : null;
                if (!bf) { x.veiculoInativo = true; res.aguardando.push(x); return; }   // veículo desativado depois de fechar
                bf.pedidos.push(x); res.entregues[x.p.cd_pedido] = true;
                if (x.v.vol == null) bf.desconhecidos++; else { bf.c24 += x.v.c24; bf.c48 += x.v.c48; bf.avulsos += x.v.avulsos; bf.volume += x.v.vol; }
                return;
            }
            if (v2 && !x.veiculo) { res.aguardando.push(x); return; }   // falta marcar: fora da rota
            var b = temProp(res.veiculos, x.veiculo) ? res.veiculos[x.veiculo] : null;
            if (!b) { x.veiculoInativo = true; res.aguardando.push(x); return; }   // 047: veículo inativo/inexistente
            if (b.semSaida) {   // este veículo não sai hoje (S10 no sábado, feriado...): próxima saída DELE em que o cliente recebe
                var ps = x.separando ? proximaSaida(dia, false, cfg, b.id) : proximaSaidaCliente(dia, x.regra, cfg, b.id);
                x.motivoFica = b.id === 's10' ? 'sem_saida_s10' : 'sem_saida_veiculo'; x.proxima = ps; x.estoura = !ps || (!!x.prazo && x.prazo < ps);
                res.fica.push(x); return;
            }
            if (naoRecebe(x.regra, dia) && !x.separando) {   // separando entra com aviso; Márcio decide
                var pc = proximaSaidaCliente(dia, x.regra, cfg, x.veiculo);
                x.motivoFica = 'dia_fechado'; x.proxima = pc; x.estoura = !pc || (!!x.prazo && x.prazo < pc);
                res.fica.push(x); return;
            }
            if (x.separando) {   // como Trazer para hoje: prioridade de inclusão, capacidade só avisa
                x.entrouAoSeparar = true; x.diaSemReceber = naoRecebe(x.regra, dia);
                b.pedidos.push(x); res.entregues[x.p.cd_pedido] = true;
                if (x.v.vol == null) b.desconhecidos++;
                else { b.c24 += x.v.c24; b.c48 += x.v.c48; b.avulsos += x.v.avulsos; b.volume += x.v.vol; }
                return;
            }
            var cap = b.capacidade;
            if (b.modo === 'cd_ceasa' && (cap == null || x.v.vol == null || b.volume + x.v.vol <= cap + 1e-9)) {   // CD: sem limite (padrão)
                b.pedidos.push(x); res.entregues[x.p.cd_pedido] = true;
                if (x.v.vol == null) b.desconhecidos++; else { b.c24 += x.v.c24; b.c48 += x.v.c48; b.avulsos += x.v.avulsos; b.volume += x.v.vol; }
                return;
            }
            // Próxima saída ELEGÍVEL para este cliente (dia com saída DO VEÍCULO em que ele recebe): é ela que decide segurar
            // o volume desconhecido, a data de quem fica e se estoura o prazo.
            var proxCli = x.regra ? proximaSaidaCliente(dia, x.regra, cfg, b.id) : proximaDe(b.id);
            if (b.modo === 'porta' && x.v.vol == null) {
                // Volume desconhecido: não dá para conferir a capacidade. Vai na rota (com aviso, fora da conta) se o veículo
                // não tem limite ou se esperar faria passar do prazo (prazo até a próxima saída); senão fica, com aviso.
                if (cap == null || !x.prazo || !proxCli || x.prazo < proxCli) { b.pedidos.push(x); b.desconhecidos++; res.entregues[x.p.cd_pedido] = true; return; }
                x.estoura = false; x.proxima = proxCli; x.semVolume = true; x.motivoFica = 'sem_volume';
                res.fica.push(x); return;
            }
            if (cap == null || b.volume + x.v.vol <= cap + 1e-9) {
                b.volume += x.v.vol; b.pedidos.push(x); res.entregues[x.p.cd_pedido] = true;
                b.c24 += x.v.c24; b.c48 += x.v.c48; b.avulsos += x.v.avulsos;
                return;
            }
            // Não cabe: fica para a próxima saída. Estoura o prazo se a próxima saída é depois do prazo.
            x.estoura = !proxCli || (!!x.prazo && x.prazo < proxCli);
            x.proxima = proxCli; x.motivoFica = 'capacidade';
            res.fica.push(x);
        });
        var om = { regras: regras, tempo: tempo, ordemFixa: !!fx };
        res.ordem.forEach(function (id) {
            var b = res.veiculos[id];
            b.ocupacao = b.capacidade == null ? null : b.volume / b.capacidade;
            if (b.modo === 'porta' || !v2) {
                // porta a porta (e, no modo automático de antes da 044, também o caminhão: pelo caminho, sem volta na conta)
                var volta = b.modo === 'porta' ? b.volta : false;
                var ms = montarParadas(b.pedidos, volta, om);
                b.paradas = ms.paradas; b.semPosicao = ms.semPosicao; b.sequencia = ms.sequencia; b.ordemFixa = !!ms.ordemFixa; b.kmReta = ms.kmReta; b.km = ms.km;
                b.horario = calcularHorarios(ROTA.ORIGEM, ms.paradas, tempo, volta);
            } else {
                // v2/v3: o veículo do CEASA só vai ao CD: UMA parada com a lista de carga (sem portas no caminho).
                b.paradas = []; b.semPosicao = []; b.portas = 0;
                if (b.pedidos.length) { b.cd = paradaCd(b.pedidos); b.cd.veiculo = b.id; b.paradas = [b.cd]; }
                b.sequencia = b.paradas;
                b.kmReta = comprimento(ROTA.ORIGEM, b.paradas, false); b.km = b.kmReta * ROTA.FATOR_ESTRADA;
                b.horario = calcularHorarios(ROTA.ORIGEM, b.paradas, tempo, false);
            }
        });
        if (res.caminhao.inativo) res.caminhao.horario = calcularHorarios(ROTA.ORIGEM, [], tempo, false);
        if (res.s10.inativo) res.s10.horario = calcularHorarios(ROTA.ORIGEM, [], tempo, res.s10.volta);
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
    function setores(unidades, k, CAPV) {
        var us = unidades.slice().sort(function (a, b) { return a.ang - b.ang || (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0); });
        var n = us.length; if (!n || k < 1) return [];
        var ini = 0, maior = -1;
        for (var i = 0; i < n; i++) { var prox = i + 1 < n ? us[i + 1].ang : us[0].ang + 360, vao = prox - us[i].ang; if (vao > maior + 1e-9) { maior = vao; ini = (i + 1) % n; } }
        var ord = us.slice(ini).concat(us.slice(0, ini)), kk = Math.min(k, n), CAP = CAPV === undefined ? ROTA.CAPACIDADE_S10 : (CAPV == null ? Infinity : CAPV);
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
    // 047: vale para QUALQUER veículo porta a porta ATIVO: opts.veiculo (padrão 's10') e opts.veiculos (linhas da
    // rota_veiculos; ausente = os padrões). Dias = os dias em que ELE sai; capacidade = a DELE (null = sem limite:
    // ocupacao null, nunca excesso, sobra só por dia fechado). Base = pedidos marcados NESTE veículo; marcados em
    // veículo do CEASA: res.cd; em outro veículo porta a porta (ou inativo): res.outros (fora do plano deste).
    // opts.plano aceita { cd_pedido: 'YYYY-MM-DD' } ou { cd_pedido: { dia, veiculo_id } } (047): salvo para OUTRO
    // veículo não vale aqui. Veículo inexistente/inativo/do CEASA: res.veiculoInvalido = true e nada planejado.
    function planejarSemana(pedidos, clientes, semanaInicio, opts) {
        opts = opcoes070(opts);
        var cfg = comFrota(opts.cfg, opts.veiculos), padroes = opts.padroes || opts.excecoes || {}, porPedido = opts.porPedido || {};
        var regras = regrasDe(opts.regras), ignorados = opts.ignorados || {}, plano = opts.plano || {}, excluir = opts.excluir || {};
        var vid = opts.veiculo || 's10', vei = veiculoDaFrota(vid, cfg), valido = !!(vei && vei.ativo && vei.modo === 'porta');
        var tempo = tempoDe(cfg), CAP = valido && vei.capacidade != null ? vei.capacidade : Infinity;
        var volta = valido && vei.voltaSede != null ? vei.voltaSede : cfg.voltaSede;
        var ini = segundaDe(semanaInicio), todos = [], dias = [], semSaida = [], idx = {};
        for (var i = 0; i < 7 && valido; i++) {
            var d = somaDias(ini, i);
            if (diasSemSaida(vid, cfg).indexOf(diaSemana(d)) >= 0) continue;   // dia em que o veículo não roda (S10: sáb/dom)
            todos.push(d);
            if (temSaida(d, cfg, vid)) { idx[d] = dias.length; dias.push(d); } else semSaida.push({ dia: d, feriado: ehFeriado(d, cfg) });
        }
        var res = { inicio: ini, fim: todos.length ? todos[todos.length - 1] : ini, veiculo: vid, nomeVeiculo: vei ? vei.nome : vid, capacidade: CAP === Infinity ? null : CAP,
                    semLimite: CAP === Infinity, veiculoInvalido: !valido,
                    dias: [], semSaida: semSaida, faltaMarcar: [], cd: null, cdPedidos: [], outros: [], semPosicao: [], sobra: [], foraDaSemana: [], regioes: [],
                    resumo: { pedidos: 0, estouram: 0, volume: 0, salvos: 0 } };
        if (!valido) { res.semSaidaNaSemana = true; res.resumo.sobra = 0; res.resumo.semPosicao = 0; res.resumo.faltaMarcar = 0; return res; }
        var dd = dias.map(function (d) { return { dia: d, nome: nomeDia(d), lista: [], usado: 0, regiao: null, centro: null }; });
        var s10 = [];
        (pedidos || []).forEach(function (p) {
            if (!(opts.modo_planejamento === 'definitiva' ? dias.some(function (d) { return elegivel070(p,d,opts); }) : pendenteEntrega(p, opts.canhotos, opts.hoje || semanaInicio, cfg, opts)) || excluir[p.cd_pedido] || ignorados[p.cd_pedido]) return;
            var c = clienteDoPedido(p, clientes), m = marcacaoDe(p, padroes, porPedido);
            var x = { p: p, c: c, prazo: prazoDe(p.dt_pedido, cfg, m ? m.veiculo : null), v: volumePedido(p), veiculo: m ? m.veiculo : null, marcacao: m ? m.origem : null,
                      regra: p.documento ? regras[p.documento] || null : null, dia: null, origemDia: null, diaSugerido: null, estoura: false, diaFechado: false, regiao: null, ang: null };
            if (!m) { x.sugestao = sugestaoDe(p, c, cfg); res.faltaMarcar.push(x); return; }
            if (m.veiculo !== vid) { var om2 = veiculoDaFrota(m.veiculo, cfg); if (om2 && om2.ativo && om2.modo === 'cd_ceasa') res.cdPedidos.push(x); else res.outros.push(x); return; }
            s10.push(x);
        });
        if (res.cdPedidos.length) res.cd = paradaCd(res.cdPedidos.map(function (x) { return { p: x.p, c: x.c, v: x.v }; }));
        function ordX(a, b) { var pa = a.prazo || '9999', pb = b.prazo || '9999'; if (pa !== pb) return pa < pb ? -1 : 1; var da = String(a.p.dt_pedido), db = String(b.p.dt_pedido); if (da !== db) return da < db ? -1 : 1; return Number(a.p.cd_pedido) - Number(b.p.cd_pedido); }
        // ---- unidades (cliente; pedidos salvos ficam à parte, por dia) ----
        var porBairro = {};
        Object.keys(clientes || {}).forEach(function (doc) { var c = clientes[doc]; if (c && c.pos && c.bairro) { var b = normBairro(c.bairro); (porBairro[b] || (porBairro[b] = [])).push(anguloDe(c.pos)); } });
        var unid = {}, salvos = [], lista = [];
        s10.sort(ordX).forEach(function (x) {
            var pd = plano[x.p.cd_pedido];
            if (pd && typeof pd === 'object') pd = !pd.veiculo_id || pd.veiculo_id === vid ? pd.dia : null;   // 047: salvo para outro veículo não vale
            pd = pd && /^\d{4}-\d{2}-\d{2}$/.test(String(pd)) ? String(pd) : null;
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
        var regs = setores(comAng, dias.length, CAP === Infinity ? null : CAP);
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
                x.situacao = situacaoPrazo(x.prazo, di.dia, cfg, vid); x.estoura = !!x.prazo && x.prazo < di.dia; x.diaFechado = naoRecebe(x.regra, di.dia);
                if (x.ang == null && x.c && x.c.pos) x.ang = Math.round(anguloDe(x.c.pos));
            });
            di.lista.sort(ordX);
            var mp = montarParadas(di.lista, volta, { regras: regras, tempo: tempo });
            var t = { c24: 0, c48: 0, avulsos: 0, desconhecidos: 0, volume: 0 };
            di.lista.forEach(function (x) { if (x.v.vol == null) t.desconhecidos++; else { t.c24 += x.v.c24; t.c48 += x.v.c48; t.avulsos += x.v.avulsos; t.volume += x.v.vol; } });
            res.dias.push({ dia: di.dia, nome: di.nome, pedidos: di.lista, paradas: mp.paradas, semPosicao: mp.semPosicao, km: mp.km, kmReta: mp.kmReta,
                            horario: calcularHorarios(ROTA.ORIGEM, mp.paradas, tempo, volta), volume: t.volume, ocupacao: CAP === Infinity ? null : t.volume / CAP,
                            c24: t.c24, c48: t.c48, avulsos: t.avulsos, desconhecidos: t.desconhecidos, excesso: t.volume > CAP + 1e-9, regiao: di.regiao, veiculo: vid });
            res.resumo.pedidos += di.lista.length; res.resumo.volume += t.volume;
            res.resumo.estouram += di.lista.filter(function (x) { return x.estoura; }).length;
            res.resumo.salvos += di.lista.filter(function (x) { return x.origemDia === 'salvo'; }).length;
        });
        res.sobra.forEach(function (x) { x.estoura = !!x.prazo && x.prazo <= res.fim; });
        res.semPosicao.forEach(function (x) { x.estoura = !!x.prazo && x.prazo < ini; });
        res.resumo.sobra = res.sobra.length; res.resumo.semPosicao = res.semPosicao.length; res.resumo.faltaMarcar = res.faltaMarcar.length;
        return res;
    }

    // ===================== SUGESTÃO: JUNTAR PEDIDO A UMA ROTA PORTA A PORTA PREVISTA =====================
    // Rotas aceitas: resultado de planejar (uma rota por veículo porta a porta ativo que sai no dia: res.veiculos; sem
    // res.veiculos, só res.s10), resultado de planejarSemana (cada res.dias[i], do veículo res.veiculo), um objeto
    // { dia, veiculo? (padrão 's10'), paradas, pedidos?, volume?, fonte? } ou uma lista de qualquer um desses.
    function rotasDe(x, cfg, saida) {
        saida = saida || [];
        if (!x) return saida;
        if (Array.isArray(x)) { x.forEach(function (r) { rotasDe(r, cfg, saida); }); return saida; }
        if (x.s10 && x.dia) {   // planejar
            if (x.semSaida) return saida;
            var ids = x.veiculos && x.ordem ? x.ordem : ['s10'];
            ids.forEach(function (id) {
                var b = x.veiculos && x.veiculos[id] ? x.veiculos[id] : (id === 's10' ? x.s10 : null);
                if (!b || b.inativo || b.semSaida || (b.modo && b.modo !== 'porta')) return;
                saida.push({ dia: x.dia, veiculo: id, fonte: 'dia', paradas: b.paradas || [], semPosicao: b.semPosicao || [],
                             pedidos: b.pedidos || [], volume: b.volume || 0, volta: b.volta != null ? !!b.volta : cfg.voltaSede });
            });
            return saida;
        }
        if (x.dias && x.inicio) {   // planejarSemana
            var vs = x.veiculo || 's10', vv = veiculoDaFrota(vs, cfg);
            x.dias.forEach(function (d) {
                saida.push({ dia: d.dia, veiculo: vs, fonte: 'semana', paradas: d.paradas || [], semPosicao: d.semPosicao || [], pedidos: d.pedidos || [], volume: d.volume || 0,
                             volta: vv && vv.voltaSede != null ? vv.voltaSede : cfg.voltaSede,
                             salvos: (d.pedidos || []).filter(function (p) { return p.origemDia === 'salvo'; }).length });
            });
            return saida;
        }
        if (x.dia && (x.paradas || x.pedidos)) saida.push({ dia: x.dia, veiculo: x.veiculo || 's10', fonte: x.fonte || 'outra', paradas: x.paradas || [], semPosicao: x.semPosicao || [],
            pedidos: x.pedidos || [], volume: x.volume != null && isFinite(Number(x.volume)) ? Number(x.volume) : null,   // sem volume: deriva dos pedidos
            volta: x.volta != null ? !!x.volta : cfg.voltaSede });
        return saida;
    }
    // Menor desvio para inserir o ponto P no trajeto sede -> paradas (-> sede se volta). Retorna { extra (km reta), i }:
    // P entra entre o ponto i-1 (ou a sede, i=0) e o ponto i (ou o fim/volta).
    function insercaoMaisBarata(seq, P, volta) {
        var pts = [ROTA.ORIGEM].concat(seq.map(function (s) { return s.pos; })), fim = volta ? ROTA.ORIGEM : null, melhor = null;
        for (var i = 0; i < pts.length; i++) {
            var a = pts[i], b = i + 1 < pts.length ? pts[i + 1] : fim;
            var extra = b ? km(a, P) + km(P, b) - km(a, b) : km(a, P);
            if (!melhor || extra < melhor.extra - 1e-9) melhor = { extra: Math.max(0, extra), i: i };
        }
        return melhor;
    }
    // Bairro QUALIFICADO pela cidade (Sentinela 2-B #3): 'BAIRRO|cidade'. Sem bairro OU sem cidade: null (não compara).
    // UF (quando houver, c.uf) entra à parte: as duas conhecidas e diferentes = não é o mesmo bairro.
    function chaveBairro(o) {
        if (!o || !o.bairro || !o.cidade) return null;
        var b = normBairro(o.bairro), c = norm(o.cidade).replace(/\s+/g, ' ');
        return b && c ? b + '|' + c : null;
    }
    function ufDe(o) { var u = o && (o.uf || o.estado); u = u ? norm(u) : ''; return /^[a-z]{2}$/.test(u) ? u : null; }
    // sugestoesJuntar(pedidos, clientes, rotas, opts) — SÓ SUGESTÃO para o Márcio: pedido pendente (aberto ou já em
    // produção) de cliente PERTO de uma rota porta a porta já prevista (S10, Strada... — rota do dia ou dia do plano da
    // semana, salvo/sugerido) que ainda NÃO está nela: "mandar para a produção para sair junto em <dia>". Não grava nada.
    // opts: { cfg, veiculos (linhas da 047; ausente = padrões), padroes, porPedido, regras, ignorados, excluir,
    //         hoje: 'YYYY-MM-DD' (padrão: hoje em SP), desvioMaxKm (padrão ROTA.JUNTAR_DESVIO_KM, km de rua), alternativas (2) }.
    // Critérios (todos):
    //   - pedido pendente (ROTA.ETAPAS_PENDENTES), não ignorado (045), não excluído, fora de TODAS as rotas recebidas;
    //   - veículo: pedido marcado num veículo porta a porta ATIVO só concorre às rotas DESSE veículo; sem marcação (e
    //     sugestão automática que não é o CEASA) concorre às rotas de todos (precisaMarcar). Marcado no CEASA ou com
    //     sugestão CEASA: descartados.ceasa; marcado em veículo inativo/inexistente: descartados.veiculo_inativo;
    //   - rota: dia >= hoje, veículo ativo porta a porta que sai no dia, dia em que o cliente recebe (044);
    //   - perto: mesmo cliente já é parada da rota (desvio 0) | desvio extra de inserção no trajeto <= desvioMaxKm |
    //     cliente sem posição: mesmo BAIRRO **e mesma CIDADE** (e UF, se as duas souberem) de uma parada da rota
    //     (criterio 'bairro', desvio desconhecido); sem cidade de um dos lados: não compara (sem_posicao);
    //   - capacidade (a do VEÍCULO da rota; null = sem limite, semLimite): o volume do cliente (todos os pedidos candidatos
    //     dele juntos) SOZINHO acima da capacidade = nunca (mesmo com carga da rota desconhecida); carga da rota + cliente
    //     <= capacidade. Volume desconhecido entra com aviso (semVolume) e conta 0. Carga da rota = MAIOR entre o volume
    //     informado e a soma dos pedidos dela (sem repetir cd_pedido; pedido sem caixas conta 0 e vai em
    //     rota.desconhecidos). Rota sem volume E sem pedidos: capacidadeDesconhecida (sugere marcado, folga null);
    //   - prazo (dias úteis do veículo da rota): prefere rota até o prazo; se NENHUMA serve no prazo, a de DATA mais cedo
    //     (critério e desvio só desempatam na mesma data), marcada estoura.
    // Escolha (1 sugestão por cliente e veículo marcado): no prazo > [entre as no prazo: mesmo cliente > menor desvio >
    // bairro > dia mais cedo] | todas estouram: dia mais cedo > mesmo cliente > menor desvio > bairro. As outras rotas que
    // também servem vão em 'alternativas'. Cada sugestão é avaliada SOZINHA na rota (folgaDepois); duas sugestões aceitas
    // na mesma rota podem juntas passar da capacidade: a tela recalcula ao aceitar.
    // Retorno: { hoje, desvioMaxKm, rotas: [{dia, nome, veiculo, nomeVeiculo, capacidade, semLimite, fonte, paradas,
    //            volume, folga, capacidadeDesconhecida, desconhecidos, salvos}], sugestoes: [...],
    //            descartados: { longe, capacidade, dia_fechado, sem_posicao, ceasa, veiculo_inativo, sem_rota } }.
    // Sugestão: { chave, documento, nome, bairro, cidade, pos, pedidos: [x], cds: [cd_pedido], volume, semVolume, prazo,
    //   dia, nomeDia, veiculo, nomeVeiculo, fonte, situacao (prazo no dia), estoura, criterio 'mesmo_cliente'|'desvio'|
    //   'bairro', desvioKm (rua, 1 casa; null no bairro), minutosExtra, entre: { antes, depois } (nome da parada/'Sede'/
    //   null), acao 'produzir' (algum pedido ainda 'aberto') | 'juntar' (todos já em produção), precisaMarcar,
    //   capacidade, semLimite, folgaAntes, folgaDepois (null se capacidadeDesconhecida ou semLimite),
    //   capacidadeDesconhecida, rotaDesconhecidos (pedidos da rota sem caixas),
    //   alternativas: [{ dia, nomeDia, veiculo, fonte, desvioKm, criterio, estoura }] }.
    // Ordem da lista: dia da rota (mais cedo), menor desvio (bairro por último), prazo, chave. descartados conta
    // clientes (não pedidos), exceto ceasa e veiculo_inativo, que contam pedidos.
    function sugestoesJuntar(pedidos, clientes, rotas, opts) {
        opts = opcoes070(opts);
        var cfg = comFrota(opts.cfg, opts.veiculos), padroes = opts.padroes || opts.excecoes || {}, porPedido = opts.porPedido || {};
        var regras = regrasDe(opts.regras), ignorados = opts.ignorados || {}, excluir = opts.excluir || {};
        var hoje = opts.hoje || diaSP(new Date()), limite = opts.desvioMaxKm != null ? Number(opts.desvioMaxKm) : ROTA.JUNTAR_DESVIO_KM;
        var nAlt = opts.alternativas != null ? Number(opts.alternativas) : 2, tempo = tempoDe(cfg);
        var res = { hoje: hoje, desvioMaxKm: limite, rotas: [], sugestoes: [],
                    descartados: { longe: 0, capacidade: 0, dia_fechado: 0, sem_posicao: 0, ceasa: 0, veiculo_inativo: 0, sem_rota: 0 } };
        function porta(id) { var v = veiculoDaFrota(id, cfg); return v && v.ativo && v.modo === 'porta' ? v : null; }
        // ---- rotas válidas ----
        var naRota = {}, rs = [];
        rotasDe(rotas, cfg).forEach(function (r) {
            // Carga da rota DERIVADA dos pedidos dela (r.pedidos + pedidos das paradas, cada cd_pedido uma vez só) (2-B,
            // Sentinela): rota recebida sem 'volume' não vira carga zero. Com volume informado vale o MAIOR dos dois.
            // Nenhum pedido e nenhum volume = capacidade desconhecida (sugere marcado, sem conferir a carga da rota).
            var daRota = {}, nPed = 0, derivado = 0, desconhecidos = 0;
            function contar(x) {
                if (!x || !x.p || daRota[x.p.cd_pedido]) return;
                daRota[x.p.cd_pedido] = true; naRota[x.p.cd_pedido] = true; nPed++;
                var vv = x.v && 'vol' in x.v ? x.v.vol : volumePedido(x.p).vol;
                if (vv == null) desconhecidos++; else derivado += vv;
            }
            (r.pedidos || []).forEach(contar);
            (r.paradas || []).concat(r.semPosicao || []).forEach(function (sp) { (sp.pedidos || []).forEach(contar); });
            var vei = porta(r.veiculo);
            if (!vei || !r.dia || r.dia < hoje || !temSaida(r.dia, cfg, r.veiculo)) return;
            var seq = (r.paradas || []).filter(function (sp) { return sp && sp.pos && !sp.cd; });
            if (!seq.length && !(r.semPosicao || []).length) return;   // rota vazia: nada previsto para juntar
            var docs = {}, bairros = {};
            seq.concat(r.semPosicao || []).forEach(function (sp) {
                if (sp.documento) docs[sp.documento] = sp;
                var kb = chaveBairro(sp); if (kb) (bairros[kb] || (bairros[kb] = [])).push(ufDe(sp));
            });
            var informado = r.volume != null && isFinite(Number(r.volume)) ? Number(r.volume) : null;
            var capDesc = informado == null && !nPed, vol = capDesc ? null : Math.max(informado || 0, derivado), cap = vei.capacidade;
            rs.push({ dia: r.dia, nome: nomeDia(r.dia), veiculo: vei.id, nomeVeiculo: vei.nome, capacidade: cap, semLimite: cap == null,
                      fonte: r.fonte, seq: seq, volta: !!r.volta, docs: docs, bairros: bairros, volume: vol,
                      folga: capDesc || cap == null ? null : Math.max(0, cap - vol), capacidadeDesconhecida: capDesc, desconhecidos: desconhecidos, salvos: r.salvos || 0 });
        });
        rs.sort(function (a, b) { return a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : (a.veiculo < b.veiculo ? -1 : a.veiculo > b.veiculo ? 1 : (a.fonte < b.fonte ? -1 : a.fonte > b.fonte ? 1 : 0)); });
        res.rotas = rs.map(function (r) { return { dia: r.dia, nome: r.nome, veiculo: r.veiculo, nomeVeiculo: r.nomeVeiculo, capacidade: r.capacidade, semLimite: r.semLimite,
                                                  fonte: r.fonte, paradas: r.seq.length, volume: r.volume, folga: r.folga,
                                                  capacidadeDesconhecida: r.capacidadeDesconhecida, desconhecidos: r.desconhecidos, salvos: r.salvos }; });
        // ---- candidatos por cliente (e veículo marcado) ----
        var unid = Object.create(null), lista = [];
        (pedidos || []).forEach(function (p) {
            if (!(opts.modo_planejamento === 'definitiva' ? rs.some(function (r) { return elegivel070(p,r.dia,opts); }) : pendenteEntrega(p, opts.canhotos, hoje, cfg, opts)) || excluir[p.cd_pedido] || ignorados[p.cd_pedido] || naRota[p.cd_pedido]) return;
            var c = clienteDoPedido(p, clientes), m = marcacaoDe(p, padroes, porPedido), precisaMarcar = false, alvo = null;
            if (m) {
                var vm = veiculoDaFrota(m.veiculo, cfg);
                if (vm && vm.ativo && vm.modo === 'cd_ceasa') { res.descartados.ceasa++; return; }
                if (!porta(m.veiculo)) { res.descartados.veiculo_inativo++; return; }
                alvo = m.veiculo;
            } else {
                if (sugestaoDe(p, c, cfg).veiculo === 'caminhao') { res.descartados.ceasa++; return; }
                precisaMarcar = true;
            }
            // Sentinela V-BACK V2: o grupo é cliente + VEÍCULO marcado (pedidos do mesmo cliente em veículos diferentes nunca se misturam).
            var ch = (p.documento ? 'd:' + p.documento : 'p:' + p.cd_pedido) + '|' + (alvo || '*'), u = temProp(unid, ch) ? unid[ch] : null;
            if (!u) { u = unid[ch] = { chave: ch, documento: p.documento || null, c: c, alvo: alvo, xs: [], vol: 0, semVol: 0, dtMin: null, aberto: false, precisaMarcar: false,
                                       regra: p.documento ? regras[p.documento] || null : null, prazos: Object.create(null) }; lista.push(u); }
            var v = volumePedido(p);
            u.xs.push({ p: p, c: c, v: v, prazo: prazoDe(p.dt_pedido, cfg, alvo || 's10'), veiculo: m ? m.veiculo : null, marcacao: m ? m.origem : null, precisaMarcar: precisaMarcar });
            if (v.vol == null) u.semVol++; else u.vol += v.vol;
            if (p.etapa === 'aberto') u.aberto = true;
            if (precisaMarcar) u.precisaMarcar = true;
        });
        // Prazo do cliente nos dias úteis de cada veículo (o mais cedo dos pedidos dele).
        function prazoU(u, vid) {
            if (!temProp(u.prazos, vid)) u.prazos[vid] = u.xs.reduce(function (mn, x) { var pz = prazoDe(x.p.dt_pedido, cfg, vid); return pz && (!mn || pz < mn) ? pz : mn; }, null);
            return u.prazos[vid];
        }
        // ---- avaliar cada cliente em cada rota ----
        function nomeParada(sp) { return sp ? (sp.nome || sp.bairro || null) : 'Sede'; }
        var pesoCrit = { mesmo_cliente: 0, desvio: 1, bairro: 2 };
        lista.forEach(function (u) {
            var pos = u.c && u.c.pos ? u.c.pos : null, kb = chaveBairro(u.c), uf = ufDe(u.c);
            var ops = [], motivos = {};
            var minhas = rs.filter(function (r) { return !u.alvo || r.veiculo === u.alvo; });
            if (!minhas.length) { res.descartados.sem_rota++; return; }
            minhas.forEach(function (r) {
                if (naoRecebe(u.regra, r.dia)) { motivos.dia_fechado = true; return; }
                var crit = null, desvio = null, entre = null;
                if (u.documento && r.docs[u.documento]) { crit = 'mesmo_cliente'; desvio = 0; entre = null; }
                else if (pos && r.seq.length) {
                    var ins = insercaoMaisBarata(r.seq, pos, r.volta), dk = ins.extra * ROTA.FATOR_ESTRADA;
                    if (dk > limite + 1e-9) { motivos.longe = true; return; }
                    crit = 'desvio'; desvio = dk;
                    entre = { antes: nomeParada(ins.i === 0 ? null : r.seq[ins.i - 1]), depois: ins.i < r.seq.length ? nomeParada(r.seq[ins.i]) : (r.volta ? 'Sede' : null) };
                } else if (!pos && kb && r.bairros[kb] && r.bairros[kb].some(function (ufr) { return !uf || !ufr || ufr === uf; })) { crit = 'bairro'; }
                else { motivos[pos ? 'longe' : 'sem_posicao'] = true; return; }
                // Capacidade do veículo: o cliente SOZINHO acima dela nunca cabe (Sentinela 2-B #1); a carga da rota só
                // entra na conta quando conhecida.
                if (r.capacidade != null && (u.vol > r.capacidade + 1e-9 || (!r.capacidadeDesconhecida && r.volume + u.vol > r.capacidade + 1e-9))) { motivos.capacidade = true; return; }
                var pz = prazoU(u, r.veiculo);
                ops.push({ r: r, crit: crit, desvio: desvio, entre: entre, estoura: !!pz && pz < r.dia, prazo: pz });
            });
            if (!ops.length) {
                var mo = motivos.capacidade ? 'capacidade' : motivos.longe ? 'longe' : motivos.dia_fechado ? 'dia_fechado' : 'sem_posicao';
                res.descartados[mo]++; return;
            }
            ops.sort(function (a, b) {
                if (a.estoura !== b.estoura) return a.estoura ? 1 : -1;
                // Todas estouram (Sentinela 2-B #2): a DATA mais cedo vence; critério/desvio só desempatam na mesma data.
                if (a.estoura && a.r.dia !== b.r.dia) return a.r.dia < b.r.dia ? -1 : 1;
                if (a.crit !== b.crit) return pesoCrit[a.crit] - pesoCrit[b.crit];
                var da = a.desvio == null ? 0 : a.desvio, db = b.desvio == null ? 0 : b.desvio;
                if (Math.abs(da - db) > 1e-9) return da - db;
                if (a.r.dia !== b.r.dia) return a.r.dia < b.r.dia ? -1 : 1;
                return a.r.veiculo < b.r.veiculo ? -1 : a.r.veiculo > b.r.veiculo ? 1 : 0;
            });
            var o = ops[0], r = o.r, um = function (n) { return Math.round(n * 10) / 10; };
            res.sugestoes.push({
                chave: u.chave, documento: u.documento, nome: (u.c && u.c.nome) || u.xs[0].p.cliente_nome || null, bairro: (u.c && u.c.bairro) || null,
                cidade: (u.c && u.c.cidade) || null, pos: pos,
                pedidos: u.xs, cds: u.xs.map(function (x) { return x.p.cd_pedido; }), volume: u.vol, semVolume: u.semVol, prazo: o.prazo,
                dia: r.dia, nomeDia: r.nome, veiculo: r.veiculo, nomeVeiculo: r.nomeVeiculo, fonte: r.fonte,
                situacao: situacaoPrazo(o.prazo, r.dia, cfg, r.veiculo), estoura: o.estoura,
                criterio: o.crit, desvioKm: o.desvio == null ? null : um(o.desvio),
                minutosExtra: o.crit === 'mesmo_cliente' ? 0 : Math.round((o.desvio == null ? 0 : o.desvio) / tempo.vel * 60 + tempo.parada),
                entre: o.entre, acao: u.aberto ? 'produzir' : 'juntar', precisaMarcar: u.precisaMarcar,
                capacidade: r.capacidade, semLimite: r.semLimite,
                folgaAntes: r.folga, folgaDepois: r.capacidadeDesconhecida || r.capacidade == null ? null : Math.max(0, r.capacidade - r.volume - u.vol),
                capacidadeDesconhecida: r.capacidadeDesconhecida, rotaDesconhecidos: r.desconhecidos,
                alternativas: ops.slice(1, 1 + Math.max(0, nAlt)).map(function (a) { return { dia: a.r.dia, nomeDia: a.r.nome, veiculo: a.r.veiculo, fonte: a.r.fonte, criterio: a.crit, desvioKm: a.desvio == null ? null : um(a.desvio), estoura: a.estoura }; })
            });
        });
        res.sugestoes.sort(function (a, b) {
            if (a.dia !== b.dia) return a.dia < b.dia ? -1 : 1;
            var da = a.desvioKm == null ? 1e9 : a.desvioKm, db = b.desvioKm == null ? 1e9 : b.desvioKm;
            if (da !== db) return da - db;
            var pa = a.prazo || '9999', pb = b.prazo || '9999'; if (pa !== pb) return pa < pb ? -1 : 1;
            return a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0;
        });
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
        saidaEntrega: saidaEntrega, etapaEntrega: etapaEntrega, recebidoEm: recebidoEm, recebidoRecente: recebidoRecente, coletarSaidas: coletarSaidas,
        etapaEnviada: etapaEnviada, faturadoEm: faturadoEm, temCanhoto: temCanhoto, legadoRecebido: legadoRecebido, recebidoEntrega: recebidoEntrega, enviadoAntigo: enviadoAntigo, pendenteEntrega: pendenteEntrega,
        confirmacaoEntrega: confirmacaoEntrega, coletarConfirmacoes: coletarConfirmacoes, recebidoRotulo: recebidoRotulo,
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
        clienteDoPedido: clienteDoPedido, enderecoDoCliente: enderecoDoCliente,
        coletarEstados070: coletarEstados070, elegivel070: elegivel070, planejar: planejar, fechadaDe: fechadaDe, itensDaRota: itensDaRota, sequenciaDe: sequenciaDe, propostaSeparando: propostaSeparando,
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
        anguloDe: anguloDe,
        sugestoesJuntar: sugestoesJuntar,
        frotaDe: frotaDe,
        idVeiculoValido: idVeiculoValido,
        veiculoNorm: veiculoNorm,
        comFrota: comFrota,
        chaveBairro: chaveBairro,
        rotasDe: rotasDe,
        insercaoMaisBarata: insercaoMaisBarata
    };
    raiz.TempRioRotaCore = Core;
    if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
