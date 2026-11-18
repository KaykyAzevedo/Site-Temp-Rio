/* =====================================================================
 * WHATSAPP — NÚCLEO (sem DOM, sem segredo, sem chamada à Meta). Fonte ÚNICA de:
 *   - coleta dos dados no Supabase (via cliente supabase-js: o do painel, com a sessão do admin, ou o da Edge Function);
 *   - montagem das mensagens (texto para prévia/log + "partes" = template + parâmetros para a Meta);
 *   - decisão de horário (quais rotinas estão na hora, em São Paulo).
 * Usado por: Edge Function supabase/functions/whatsapp-rotinas (Deno), painel js/admin-whatsapp.js ("Gerar prévia")
 * e testes em node. Depende de rota-core.js (carregado antes: globalThis.TempRioRotaCore).
 * O ENVIO fica isolado no provedor (supabase/functions/whatsapp-rotinas/provedor.ts), nunca aqui.
 * ===================================================================== */
(function (raiz) {
    'use strict';
    var core = (typeof module !== 'undefined' && module.exports && typeof require === 'function')
        ? require('./rota-core.js') : raiz.TempRioRotaCore;
    if (!core) throw new Error('whatsapp-core: rota-core.js precisa ser carregado antes.');
    var ROTA = core.ROTA;

    var WA = {
        TZ: 'America/Sao_Paulo',
        JANELA_HORAS: 3,             // rotina das 06:00 ainda sai até 08:59 (cron atrasado); depois disso, só amanhã
        PARADO_ERP_DIAS: 7,          // pedido do ERP parado há mais de 7 dias
        AGUARDANDO_SITE_HORAS: 24,   // pedido do site "aguardando" há mais de 24 h
        COLETA_PARADA_MIN: 30,       // folga além do intervalo próprio de cada coletor do ERP (ver COLETORES)
        ESTOQUE_HORAS: 24,           // eventos de estoque crítico das últimas 24 h
        PARAM_MAX: 700,              // parâmetro de template: curto, sem quebra de linha (regra da Meta)
        LOTE_PARADAS: ROTA.LOTE_GMAPS_MOVEL,   // 3 paradas intermediárias + destino = 4 por link (app do celular)
        // Teto de mensagens por rota e por destinatário (= CHECK de whatsapp_envios.partes na 042). Acima disso a rota
        // manda as primeiras PARTES_MAX-1 mensagens + 1 aviso com quantas paradas ficaram de fora (ver no painel).
        PARTES_MAX: 100,
        DIAS: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'],
        ROTINAS: ['receber_diario', 'rota_s10', 'rota_caminhao', 'alertas_marcio']
    };

    // ===================== formatação =====================
    function brl(centavos) {
        var v = (Number(centavos) || 0) / 100;
        try { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
        catch (e) { return 'R$ ' + v.toFixed(2).replace('.', ','); }
    }
    function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }
    // Texto bem formado: surrogate isolado que já venha do banco vira U+FFFD (toWellFormed: Deno, Node 20+, navegadores
    // atuais; sem ela, segue como veio).
    function bemFormado(s) { s = String(s == null ? '' : s); return typeof s.toWellFormed === 'function' ? s.toWellFormed() : s; }
    // Corte em até n unidades UTF-16 (o .length que a Meta e os limites contam) SEM separar um emoji/caractere fora do
    // BMP: se o corte cairia entre o surrogate alto e o baixo, recua 1 (o resultado fica com n-1, dentro do limite).
    function corte(s, n) {
        if (n <= 0) return '';
        if (s.length <= n) return s;
        var c = s.charCodeAt(n - 1);
        return s.slice(0, c >= 0xD800 && c <= 0xDBFF ? n - 1 : n);
    }
    // Corta para caber em max COM a reticência ('…' = 1 unidade): no máximo max-1 do texto + '…'.
    function encurtar(t, max) { return t.length > max ? corte(t, max - 1).trim() + '…' : t; }
    // Parâmetro de template da Meta: sem quebra de linha/tab, sem 4+ espaços seguidos, tamanho limitado.
    function param(s, max) {
        var t = bemFormado(s).replace(/[\r\n\t]+/g, ' · ').replace(/ {2,}/g, ' ').trim();
        t = encurtar(t, max || WA.PARAM_MAX);
        return t || '-';
    }
    function nomeCurto(s, max) { return encurtar(bemFormado(s || '').replace(/\s+/g, ' ').trim(), max || 40); }
    function horaMin(valor) {
        var d = valor instanceof Date ? valor : new Date(valor);
        if (isNaN(d.getTime())) return null;
        try { return new Intl.DateTimeFormat('pt-BR', { timeZone: WA.TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d); }
        catch (e) { return d.toISOString().slice(11, 16); }
    }
    function minutosSP(valor) {
        var d = valor instanceof Date ? valor : new Date(valor);
        var hm = horaMin(d); if (!hm) return null;
        var p = hm.split(':'); return Number(p[0]) * 60 + Number(p[1]);
    }
    function diaSemanaCod(dia) { return WA.DIAS[core.diaSemana(dia)]; }
    function dataLonga(dia) { return core.nomeDia(dia) + ', ' + core.dataBr(dia); }
    function linkPainel(url, aba) { return url ? String(url).replace(/\/+$/, '') + '/admin.html' + (aba ? '#' + aba : '') : ''; }

    // ===================== horário (pura) =====================
    // rotinas: linhas de whatsapp_rotinas. Devolve [{ rotina, dia }] das ativas cujo horário (SP) já passou hoje,
    // dentro da janela, num dia marcado. A trava "1x por dia" é do banco (whatsapp_042_reservar).
    function rotinasDevidas(rotinas, agora) {
        var dia = core.diaSP(agora), min = minutosSP(agora), out = [];
        if (!dia || min == null) return out;
        var cod = diaSemanaCod(dia);
        (rotinas || []).forEach(function (r) {
            if (!r || !r.ativo) return;
            if ((r.dias || []).indexOf(cod) < 0) return;
            var p = String(r.horario || '').split(':'), h = Number(p[0]), m = Number(p[1] || 0);
            if (!isFinite(h) || !isFinite(m)) return;
            var ini = h * 60 + m;
            if (min >= ini && min < ini + WA.JANELA_HORAS * 60) out.push({ rotina: r, dia: dia });
        });
        return out;
    }

    // ===================== coleta (supabase-js) =====================
    // Mantém o código do PostgREST/Postgres no Error (ausente() decide pelo código, não pela frase).
    function erroDe(r) {
        if (!r || !r.error) return null;
        var e = new Error(String(r.error.message || r.error));
        if (r.error.code) e.code = String(r.error.code);
        return e;
    }
    // TABELA ausente (migração não aplicada): SÓ PGRST205 (PostgREST, "Could not find the table") ou 42P01 (Postgres,
    // relation does not exist). Coluna ausente (42703 / PGRST204), função, permissão, timeout etc. NÃO são ausência:
    // viram erro. Erro SEM código também é erro (a frase sozinha não basta). Com 'tabela': se a mensagem nomeia outra
    // tabela/relação (ex.: uma relação usada por política), também não.
    function ausente(err, tabela) {
        if (!err) return false;
        var cod = String(err.code || ''), msg = String(err.message || '');
        if (cod !== 'PGRST205' && cod !== '42P01') return false;
        if (!tabela) return true;
        var m = msg.match(/table '([^']+)'/i) || msg.match(/relation "([^"]+)"/i);
        return !m || m[1] === tabela || m[1] === 'public.' + tabela;
    }
    // Pagina de 1000 em 1000 (limite padrão do PostgREST) até max linhas.
    function todas(fabrica, max) {
        var out = [], passo = 1000; max = max || 20000;
        function pag(de) {
            return fabrica().range(de, de + passo - 1).then(function (r) {
                if (r.error) throw erroDe(r);
                var d = r.data || []; out = out.concat(d);
                if (d.length < passo || out.length >= max) return out.slice(0, max);
                return pag(de + passo);
            });
        }
        return pag(0);
    }
    function emBlocos(lista, n, fn) {
        var blocos = []; for (var i = 0; i < lista.length; i += n) blocos.push(lista.slice(i, i + n));
        return Promise.all(blocos.map(fn)).then(function (rs) { return [].concat.apply([], rs); });
    }
    function nomesDe(sb, docs) {
        if (!docs.length) return Promise.resolve({});
        return emBlocos(docs, 200, function (b) {
            return sb.from('solidcon_clientes').select('documento,nome,bairro').in('documento', b).then(function (r) { if (r.error) throw erroDe(r); return r.data || []; });
        }).then(function (rows) { var m = {}; rows.forEach(function (c) { m[c.documento] = c; }); return m; });
    }

    function coletarReceber(sb) {
        return Promise.all([
            todas(function () { return sb.from('solidcon_receber').select('tipo,documento,vencimento,valor_aberto_centavos').order('id', { ascending: true }); }, 50000),
            sb.from('solidcon_receber_sync').select('coletado_em').eq('status', 'ok').order('coletado_em', { ascending: false }).limit(1)
        ]).then(function (rs) {
            var titulos = rs[0], sy = rs[1] && !rs[1].error && rs[1].data && rs[1].data[0];
            var docs = {}; titulos.forEach(function (t) { if (t.documento) docs[t.documento] = true; });
            return nomesDe(sb, Object.keys(docs)).then(function (nomes) { return { titulos: titulos, nomes: nomes, coletado: sy ? sy.coletado_em : null }; });
        });
    }

    // Mesmas fontes da aba Rotas (js/admin-rota.js): pedidos pendentes, cadastro, posição atual, config (040), padrões
    // por cliente e (044) escolha por pedido + regras de entrega. Tabela da 044 AUSENTE = modo automático de antes (v1).
    // Tabela da 044 presente com ERRO de leitura (timeout, permissão...) = erro ("falha ao montar" no log): nunca manda
    // uma rota montada sem as marcações (seria diferente da aba Rotas), igual ao que já vale para rota_config.
    function coletarRota(sb) {
        function opcional(tabela, fab) { return todas(fab, 20000).catch(function (e) { if (ausente(e, tabela)) return null; throw e; }); }
        return Promise.all([
            todas(function () { return sb.from('solidcon_pedidos_erp').select('*').in('etapa', ROTA.ETAPAS_PENDENTES).order('cd_pedido', { ascending: true }); }, 5000),
            sb.from('solidcon_pedidos_erp_sync').select('coletado_em').eq('status', 'ok').order('coletado_em', { ascending: false }).limit(1),
            sb.from('rota_config').select('*').eq('id', 1).limit(1),
            todas(function () { return sb.from('rota_cliente_veiculo').select('documento,veiculo').order('documento', { ascending: true }); }, 20000)
                .catch(function (e) { if (ausente(e, 'rota_cliente_veiculo')) return []; throw e; }),
            opcional('rota_pedido_veiculo', function () { return sb.from('rota_pedido_veiculo').select('cd_pedido,veiculo').order('cd_pedido', { ascending: true }); }),
            opcional('rota_cliente_regras', function () { return sb.from('rota_cliente_regras').select('documento,janela_inicio,janela_fim,dias_sem_receber,prioridade,observacao').order('documento', { ascending: true }); })
        ]).then(function (rs) {
            var pedidos = rs[0], docs = {};
            pedidos.forEach(function (p) { if (p.documento) docs[p.documento] = true; });
            if (rs[2] && rs[2].error && !ausente(rs[2].error, 'rota_config')) throw erroDe(rs[2]);
            var cfgAusente = !!(rs[2] && rs[2].error);
            var cfgLinha = rs[2] && !rs[2].error && rs[2].data && rs[2].data[0] ? rs[2].data[0] : null;
            var excecoes = {};
            rs[3].forEach(function (e) { if (e.veiculo === 'caminhao' || e.veiculo === 's10') excecoes[e.documento] = e.veiculo; });
            // v2 só com a 044 inteira (mesma detecção da aba Rotas: config + as duas tabelas novas).
            var v2 = !cfgAusente && rs[4] !== null && rs[5] !== null, porPedido = {}, regras = {};
            if (v2) {
                rs[4].forEach(function (p) { if (p.veiculo === 'caminhao' || p.veiculo === 's10') porPedido[p.cd_pedido] = p.veiculo; });
                regras = core.regrasDe(rs[5]);
            }
            var sy = rs[1] && !rs[1].error && rs[1].data && rs[1].data[0];
            return emBlocos(Object.keys(docs), 500, function (b) {
                return sb.rpc('solidcon_rota_posicoes', { p_documentos: b }).then(function (r) { if (r.error) throw erroDe(r); return r.data || []; });
            }).then(function (rows) {
                var cli = {};
                rows.forEach(function (c) {
                    var lat = Number(c.lat), lng = Number(c.lng), tem = c.lat != null && c.lng != null && isFinite(lat) && isFinite(lng) && !c.pino_desatualizado;
                    cli[c.documento] = { nome: c.nome, logradouro: c.logradouro, numero: c.numero, complemento: c.complemento, bairro: c.bairro,
                                         cidade: c.cidade, pos: tem ? [lat, lng] : null, precisao: tem ? c.precisao : null };
                });
                var d = { pedidos: pedidos, clientes: cli, cfg: core.cfgDe(cfgLinha || core.CFG_PADRAO), excecoes: excecoes, coletado: sy ? sy.coletado_em : null };
                if (v2) { d.v2 = true; d.porPedido = porPedido; d.regras = regras; }
                return d;
            });
        });
    }

    // Coletores do ERP vigiados no alerta "coleta parada" (W3): cada um pela ÚLTIMA execução com status 'ok' e pela data
    // EFETIVA da coleta (coletado_em = quando o ERP foi lido). Limite = intervalo próprio do coletor + 30 min de folga
    // (sync-banco.ps1: pedidos a cada 5 min, receber e margem a cada 60; sync-produtos.ps1: estoque a cada 30).
    // Tabela ausente (migração não aplicada) = coletor fora da conta.
    var COLETORES = [
        { nome: 'pedidos', tabela: 'solidcon_pedidos_erp_sync', limiteMin: WA.COLETA_PARADA_MIN },
        { nome: 'estoque', tabela: 'solidcon_sync', limiteMin: 30 + WA.COLETA_PARADA_MIN },
        { nome: 'contas a receber', tabela: 'solidcon_receber_sync', limiteMin: 60 + WA.COLETA_PARADA_MIN },
        { nome: 'margem', tabela: 'solidcon_margem_sync', limiteMin: 60 + WA.COLETA_PARADA_MIN }
    ];

    function coletarAlertas(sb, agora) {
        var t = (agora instanceof Date ? agora : new Date(agora)).getTime();
        var iso = function (ms) { return new Date(ms).toISOString(); };
        function ultimaOk(c) {
            return sb.from(c.tabela).select('coletado_em').eq('status', 'ok').order('coletado_em', { ascending: false, nullsFirst: false }).limit(1)
                .then(function (r) {
                    if (r.error) return ausente(r.error) ? null : Promise.reject(erroDe(r));
                    var v = r.data && r.data[0] ? r.data[0].coletado_em : null;
                    return { nome: c.nome, limiteMin: c.limiteMin, ultima: v || null };
                });
        }
        return Promise.all([
            todas(function () {
                return sb.from('solidcon_pedidos_erp').select('cd_pedido,dt_pedido,etapa,cliente_tipo,documento,cliente_nome')
                    .in('etapa', ROTA.ETAPAS_PENDENTES).lt('dt_pedido', iso(t - WA.PARADO_ERP_DIAS * 864e5)).order('dt_pedido', { ascending: true });
            }, 5000),
            todas(function () {
                return sb.from('pedidos').select('id,criado_em').eq('status', 'aguardando')
                    .lt('criado_em', iso(t - WA.AGUARDANDO_SITE_HORAS * 36e5)).order('criado_em', { ascending: true });
            }, 5000),
            Promise.all(COLETORES.map(ultimaOk)),
            todas(function () {
                return sb.from('solidcon_eventos').select('nome,tipo,em').in('tipo', ['esgotou', 'estoque_baixo'])
                    .gte('em', iso(t - WA.ESTOQUE_HORAS * 36e5)).order('em', { ascending: false });
            }, 2000).catch(function (e) { if (ausente(e)) return null; throw e; })
        ]).then(function (rs) {
            var docs = {}; rs[0].forEach(function (p) { if (p.documento) docs[p.documento] = true; });
            return nomesDe(sb, Object.keys(docs)).then(function (nomes) {
                return { parados: rs[0], nomes: nomes, siteAguardando: rs[1], coletas: rs[2].filter(Boolean), estoque: rs[3] };
            });
        });
    }

    // ===================== templates (texto EXATO cadastrado na Meta — igual a integracao/whatsapp/LEIAME.md) =====================
    // A prévia e o log mostram a renderização destes textos com os parâmetros: é exatamente o que a Meta entrega.
    // Regras da Meta para o corpo (erro 2388293 = poucas palavras para tantas variáveis): não começa nem termina com
    // {{n}}; dois {{n}} nunca lado a lado (só espaço/pontuação entre eles); pelo menos 3 palavras fixas por {{n}};
    // no máximo 1 linha em branco seguida; renderizado <= 1024. Conferido em supabase/tests/whatsapp-templates.test.js.
    var MODELOS = {
        relatorio_diario: 'Resumo das contas a receber de {{1}}.\nTotal vencido em aberto: {{2}}.\nTotal que vence hoje: {{3}}.\nTotal a vencer nos próximos 7 dias: {{4}}.\nMaiores valores vencidos por cliente: {{5}}.\nDados do ERP: {{6}}.\nMais detalhes no painel: {{7}}\nMensagem automática do Temp Rio.',
        rota_do_dia: 'Rota do dia do veículo {{1}}, saída de {{2}}.\nTrecho desta mensagem: {{3}}.\nParadas em ordem de entrega: {{4}}\nMapa ou painel deste trecho: {{5}}\nMensagem automática do Temp Rio.',
        alertas_operacao: 'Alertas da operação do Temp Rio em {{1}}.\nPontos que precisam de atenção: {{2}}\nConfira os detalhes no painel: {{3}}\nMensagem automática do Temp Rio.'
    };
    WA.CORPO_MAX = 1024;   // limite do corpo do template na Meta (texto fixo + parâmetros)
    // Orçamento de caracteres por parâmetro ({{1}}, {{2}}, ...): texto fixo + soma dos limites <= CORPO_MAX no PIOR caso
    // (fixo: relatorio 236, rota 153, alertas 134). parte() aplica estes limites a todo parâmetro (corte com '…').
    WA.LIMITES = {
        relatorio_diario: [25, 140, 60, 60, 300, 60, 140],
        rota_do_dia: [20, 25, 40, 480, 300],
        alertas_operacao: [25, 750, 110]
    };
    function renderizar(parte) {
        return MODELOS[parte.modelo].replace(/\{\{(\d+)\}\}/g, function (_, n) { return parte.params[Number(n) - 1]; });
    }
    // texto = TODAS as partes, renderizadas, na ordem de envio.
    function textoDe(partes) {
        if (partes.length === 1) return renderizar(partes[0]);
        return partes.map(function (p, i) { return '[mensagem ' + (i + 1) + ' de ' + partes.length + ']\n' + renderizar(p); }).join('\n\n');
    }
    // Histórico (whatsapp_envios): UMA linha por parte ("parte N de M"), com o texto renderizado inteiro daquela parte
    // (cada parte tem no máximo CORPO_MAX = 1024, então nada é cortado). O limite por linha (6000, igual à 042) só age em
    // texto fora do padrão e, se agir, marca explicitamente '[histórico resumido]'.
    WA.CORPO_LOG_MAX = 6000;
    var MARCA_RESUMO = '[histórico resumido]';
    function corpoLog(s) {
        s = bemFormado(s);
        return s.length <= WA.CORPO_LOG_MAX ? s : corte(s, WA.CORPO_LOG_MAX - MARCA_RESUMO.length - 1) + '\n' + MARCA_RESUMO;
    }
    function linhasDeLog(msg) {
        if (!msg || !msg.partes || !msg.partes.length) return [{ parte: null, partes: null, corpo: msg && msg.texto ? corpoLog(msg.texto) : null }];
        return msg.partes.map(function (p, i) { return { parte: i + 1, partes: msg.partes.length, corpo: corpoLog(renderizar(p)) }; });
    }
    function parte(modelo, template, params) {
        var lim = WA.LIMITES[modelo] || [];
        return { modelo: modelo, template: template || modelo, params: params.map(function (v, i) { return param(v, lim[i]); }) };
    }
    // Empacota itens inteiros (nunca corta um item no meio) em grupos de até maxItens e maxChars (juntos com sep).
    function empacotar(itens, maxItens, maxChars, sep) {
        var grupos = [], g = [], tam = 0;
        itens.forEach(function (it) {
            var add = (g.length ? sep.length : 0) + it.length;
            if (g.length && (g.length >= maxItens || tam + add > maxChars)) { grupos.push(g); g = []; tam = 0; add = it.length; }
            g.push(it); tam += add;
        });
        if (g.length) grupos.push(g);
        return grupos;
    }

    // ===================== montagem (pura) =====================
    // Cada montador devolve { texto, partes: [{ modelo, template, params }], vazio?: motivo }.

    // PF / sem documento: SEMPRE neutro (nunca nome), mesmo para gestor. CNPJ: nome do cadastro.
    function nomeNeutro(tipo) { return tipo === 'pf' || tipo === 'cpf' ? 'cliente pessoa física' : 'cliente sem documento'; }

    // receber_diario. d = { titulos, nomes, coletado }. Saldo em aberto do ERP (solidcon_receber é a foto do que está
    // em aberto: título quitado some; por isso NÃO há "recebido ontem" confiável nesta base). SÓ para gestor.
    function montarReceber(d, agora, opts) {
        opts = opts || {};
        var hoje = core.diaSP(agora), lim7 = core.somaDias(hoje, 7);
        var venc = { n: 0, v: 0, docs: {}, semDoc: 0 }, hojeV = { n: 0, v: 0 }, prox = { n: 0, v: 0 }, porCli = {};
        (d.titulos || []).forEach(function (t) {
            var v = Number(t.valor_aberto_centavos) || 0, dv = String(t.vencimento).slice(0, 10);
            if (v <= 0) return;
            if (dv < hoje) {
                venc.n++; venc.v += v;
                var dias = Math.round((Date.parse(hoje + 'T12:00:00Z') - Date.parse(dv + 'T12:00:00Z')) / 864e5);
                var cnpj = t.tipo === 'cnpj' && t.documento;
                var k = cnpj ? 'd:' + t.documento : 'x:' + venc.n;
                if (cnpj) venc.docs[t.documento] = true; else venc.semDoc++;
                var c = porCli[k] || (porCli[k] = { documento: cnpj ? t.documento : null, tipo: t.tipo, v: 0, n: 0, dias: 0 });
                c.v += v; c.n++; if (dias > c.dias) c.dias = dias;
            } else if (dv === hoje) { hojeV.n++; hojeV.v += v; }
            else if (dv <= lim7) { prox.n++; prox.v += v; }
        });
        var nCli = Object.keys(venc.docs).length;
        var top = Object.keys(porCli).map(function (k) { return porCli[k]; })
            .sort(function (a, b) { return b.v - a.v || b.dias - a.dias; }).slice(0, 5)
            .map(function (c, i) {
                var nm = c.documento ? nomeCurto(d.nomes && d.nomes[c.documento] && d.nomes[c.documento].nome || 'cliente', 28) : nomeNeutro(c.tipo);
                return (i + 1) + ') ' + nm + ' ' + brl(c.v) + ' (' + c.dias + 'd)';
            });
        var cliTxt = plural(nCli, 'cliente', 'clientes') + (venc.semDoc ? ' + ' + plural(venc.semDoc, 'parcela', 'parcelas') + ' de pessoa física/sem documento' : '');
        // {{6}} entra em "Dados do ERP: {{6}}." -> "coleta de 16/11 06:00" / "ATENÇÃO, coleta antiga de 14/11 05:50".
        var quando = d.coletado ? core.dataBr(core.diaSP(d.coletado)) + ' ' + horaMin(d.coletado) : null;
        var velho = !d.coletado || (new Date(agora).getTime() - new Date(d.coletado).getTime()) > 26 * 36e5;
        var partes = [parte('relatorio_diario', opts.template, [
            param(dataLonga(hoje), 40),
            param(brl(venc.v) + ' (' + plural(venc.n, 'parcela', 'parcelas') + ', ' + cliTxt + ')', 140),
            param(brl(hojeV.v) + ' (' + plural(hojeV.n, 'parcela', 'parcelas') + ')', 60),
            param(brl(prox.v) + ' (' + plural(prox.n, 'parcela', 'parcelas') + ')', 60),
            param(top.length ? top.join('; ') : 'nenhum', 350),
            param(!quando ? 'ATENÇÃO, nenhuma coleta registrada' : (velho ? 'ATENÇÃO, coleta antiga de ' : 'coleta de ') + quando, 60),
            param(linkPainel(opts.painelUrl, 'site') || 'abra o painel', 150)])];
        return { texto: textoDe(partes), partes: partes, resumo: { vencido: venc.v, parcelasVencidas: venc.n, clientes: nCli, hoje: hojeV.v, prox7: prox.v } };
    }

    // rota_s10 / rota_caminhao. d = coletarRota(...). veiculo = 's10' | 'caminhao'. Entregador ou gestor.
    function caixasTxt(sp) {
        var c24 = 0, c48 = 0, av = 0, desc = false;
        sp.pedidos.forEach(function (x) { if (x.v.vol == null) desc = true; else { c24 += x.v.c24; c48 += x.v.c48; av += x.v.avulsos; } });
        var p = [];
        if (c24) p.push(c24 + ' cx24'); if (c48) p.push(c48 + ' cx48'); if (av) p.push(av + ' potes');
        if (desc) p.push('volume a conferir');
        return p.join(' + ') || '—';
    }
    function nomeParada(sp) {
        if (sp.tipo === 'cnpj' && sp.nome) return nomeCurto(sp.nome, 30);
        return (sp.tipo === 'cnpj' ? 'cliente' : nomeNeutro(sp.tipo)) + ' (pedido ' + sp.pedidos[0].p.cd_pedido + ')';
    }
    // Uma parada = um item inteiro (nunca cortado): "n) nome — bairro — caixas", no máximo ITEM_MAX caracteres.
    var ITEM_MAX = 115, LISTA_MAX = WA.LIMITES.rota_do_dia[3];
    // v2 (044): "n) ~HH:MM nome — bairro — caixas — recebe 08:00–11:00". A hora prevista vem logo depois do número e a
    // janela por último: se o item passar de ITEM_MAX, o corte pega a janela, nunca a hora nem as caixas.
    // CD do CEASA (última parada do caminhão): UM item com quantos clientes e o total de caixas da carga.
    function itemParada(sp, n, v2) {
        if (!v2) return nomeCurto(n + ') ' + nomeParada(sp) + ' — ' + (sp.bairro ? nomeCurto(sp.bairro, 22) : 's/ bairro') + ' — ' + caixasTxt(sp), ITEM_MAX);
        var hora = sp.eta ? '~' + sp.eta + ' ' : '';
        if (sp.cd) return nomeCurto(n + ') ' + hora + ROTA.CEASA_CD_NOME + ' — ' + plural(sp.carga ? sp.carga.length : 0, 'cliente', 'clientes') + ' — ' + caixasTxt(sp), ITEM_MAX);
        return nomeCurto(n + ') ' + hora + nomeParada(sp) + ' — ' + (sp.bairro ? nomeCurto(sp.bairro, 22) : 's/ bairro') + ' — ' + caixasTxt(sp) +
            (sp.janela ? ' — recebe ' + sp.janela : ''), ITEM_MAX);
    }
    // Quantas paradas a parte leva: guardado na estrutura (o texto não é reanalisado). Não vai para a Meta.
    function comParadas(pt, n) { pt.paradas = n; return pt; }
    function montarRota(d, veiculo, agora, opts) {
        opts = opts || {};
        var hoje = core.diaSP(agora), rotulo = veiculo === 'caminhao' ? 'Caminhão CEASA' : 'S10';
        // v2 (044 legível, ver coletarRota): veículo só pela marcação (pedido > padrão do cliente); sem marcação o pedido
        // fica FORA (aguardando, como na aba Rotas); regras de entrega (dia fechado, janela, prioridade) e hora prevista.
        var v2 = !!d.v2;
        var pl = v2
            ? core.planejar(d.pedidos, d.clientes, hoje, { cfg: d.cfg, excecoes: d.excecoes, marcacao: true, padroes: d.excecoes, porPedido: d.porPedido || {}, regras: d.regras || {} })
            : core.planejar(d.pedidos, d.clientes, hoje, { cfg: d.cfg, excecoes: d.excecoes });
        if (pl.semSaida) return { vazio: 'sem saída hoje (' + (pl.feriado ? 'feriado' : 'domingo/dia sem saída') + ')', texto: 'Rota ' + rotulo + ' — ' + dataLonga(hoje) + ': sem saída hoje.', partes: [] };
        var r = veiculo === 'caminhao' ? pl.caminhao : pl.s10;
        var total = r.paradas.length + r.semPosicao.length;
        if (!total) {
            // v2: diz quantos pedidos esperam marcação (o histórico mostra por que a rota saiu vazia).
            var ag = v2 && pl.aguardando.length ? ' (' + plural(pl.aguardando.length, 'pedido aguardando', 'pedidos aguardando') + ' marcação CEASA/S10)' : '';
            return { vazio: 'sem paradas' + ag, texto: 'Rota ' + rotulo + ' — ' + dataLonga(hoje) + ': nenhuma parada' + ag + '.', partes: [] };
        }
        var partes = [];
        // v2 caminhão com CD E porta sem posição: o CD continua a ÚLTIMA parada. Portas com posição (links), depois as sem
        // posição, e o CD numa mensagem própria no fim, com link da última porta com posição (ou da sede) até o CD.
        // Sem porta sem posição: o CD vai no último link, como qualquer parada — EXCETO se a rota vai passar de PARTES_MAX
        // (aí o corte poderia levar o CD): separa também, e o CD fica fora do corte, depois do aviso.
        // (sem porta sem posição, partes = só os links: ceil(paradas / LOTE_PARADAS)).
        var cdSep = !!(v2 && veiculo === 'caminhao' && r.cd &&
            (r.semPosicao.length > 0 || Math.ceil(r.paradas.length / WA.LOTE_PARADAS) > WA.PARTES_MAX));
        var comLink = cdSep ? r.paradas.slice(0, -1) : r.paradas;
        // Com posição: 1 mensagem por link do Maps (até 4 paradas: 3 intermediárias + destino).
        var links = core.linksGoogleMaps(comLink, WA.LOTE_PARADAS);
        links.forEach(function (lk) {
            var itens = comLink.slice(lk.de - 1, lk.ate).map(function (sp, i) { return itemParada(sp, lk.de + i, v2); });
            partes.push(comParadas(parte('rota_do_dia', opts.template, [param(rotulo, 20), param(dataLonga(hoje), 40),
                param((lk.ate > lk.de ? 'paradas ' + lk.de + '–' + lk.ate : 'parada ' + lk.de) + ' de ' + total, 40), param(itens.join('; '), LISTA_MAX), param(lk.url, 300)]), itens.length));
        });
        // Sem posição: mesmos lotes (até 4 paradas e LISTA_MAX caracteres), sem cortar parada.
        var ini = comLink.length + 1, n = ini;
        empacotar(r.semPosicao.map(function (sp, i) { return itemParada(sp, ini + i, v2); }), WA.LOTE_PARADAS, LISTA_MAX, '; ').forEach(function (g) {
            var de = n, ate = n + g.length - 1; n = ate + 1;
            partes.push(comParadas(parte('rota_do_dia', opts.template, [param(rotulo, 20), param(dataLonga(hoje), 40),
                param('sem posição no mapa, ' + de + (ate > de ? '–' + ate : '') + ' de ' + total, 40), param(g.join('; '), LISTA_MAX),
                param('sem link (cliente sem posição no mapa)', 300)]), g.length));
        });
        var cdParte = null;
        if (cdSep) {
            var ultima = comLink.length ? comLink[comLink.length - 1] : null;
            var lkCd = ultima ? core.linksGoogleMaps([ultima, r.cd], 1)[1] : core.linksGoogleMaps([r.cd], 1)[0];
            cdParte = comParadas(parte('rota_do_dia', opts.template, [param(rotulo, 20), param(dataLonga(hoje), 40),
                param('parada ' + total + ' de ' + total + ' (última)', 40), param(itemParada(r.cd, total, v2), LISTA_MAX), param(lkCd.url, 300)]), 1);
        }
        // Rota gigante (ex.: milhares de pedidos PF sem posição): limita ANTES do envio, com aviso na última mensagem.
        // Com o CD separado, ele fica fora do corte e continua sendo a última mensagem (o aviso vem antes dele).
        var omitidas = 0, maxPartes = WA.PARTES_MAX - (cdParte ? 1 : 0), ultimaNum = total - (cdParte ? 1 : 0);
        if (partes.length > maxPartes) {
            var fora = partes.splice(maxPartes - 1);
            fora.forEach(function (x) { omitidas += x.paradas; });   // pela estrutura, nunca pelo texto (nome pode ter '; ')
            partes.push(parte('rota_do_dia', opts.template, [param(rotulo, 20), param(dataLonga(hoje), 40), param('aviso', 40),
                param('rota longa demais para o WhatsApp: ' + plural(omitidas, 'parada não foi enviada', 'paradas não foram enviadas') +
                      ' (' + (ultimaNum - omitidas + 1) + ' a ' + ultimaNum + '). Veja a rota completa na aba Rotas do painel.', LISTA_MAX),
                param(linkPainel(opts.painelUrl, 'rotas') || 'abra o painel', 300)]));
        }
        if (cdParte) partes.push(cdParte);
        var resumo = { paradas: total, semPosicao: r.semPosicao.length, links: links.length + (cdParte ? 1 : 0), fica: veiculo === 's10' ? pl.fica.length : 0, omitidas: omitidas };
        if (v2) {   // na v2 o caminhão também pode deixar pedido para depois (cliente que não recebe hoje)
            resumo.modo = 'marcacao'; resumo.aguardando = pl.aguardando.length;
            resumo.fica = pl.fica.filter(function (x) { return x.veiculo === veiculo; }).length;
            resumo.atrasos = r.horario ? r.horario.atrasos : 0;
            if (veiculo === 'caminhao') resumo.cd = r.cd ? r.cd.total.clientes : 0;
        }
        return { texto: textoDe(partes), partes: partes, resumo: resumo };
    }

    // alertas_marcio. d = coletarAlertas(...). Sem nada a alertar: vazio (não manda mensagem). SÓ para gestor.
    function quantoTempo(min) { return min >= 120 ? Math.floor(min / 60) + ' h' : min + ' min'; }
    function montarAlertas(d, agora, opts) {
        opts = opts || {};
        var t = new Date(agora).getTime(), hoje = core.diaSP(agora), itens = [];
        if (d.parados && d.parados.length) {
            var ex = d.parados.slice(0, 3).map(function (p) {
                var nm = p.cliente_tipo === 'cnpj'
                    ? nomeCurto((p.documento && d.nomes && d.nomes[p.documento] && d.nomes[p.documento].nome) || p.cliente_nome || 'cliente', 24)
                    : nomeNeutro(p.cliente_tipo);
                return '#' + p.cd_pedido + ' ' + nm + ' (' + Math.floor((t - new Date(p.dt_pedido).getTime()) / 864e5) + 'd)';
            });
            itens.push('📦 ' + plural(d.parados.length, 'pedido do ERP parado', 'pedidos do ERP parados') + ' há mais de ' + WA.PARADO_ERP_DIAS + ' dias: ' + ex.join(', ') + (d.parados.length > 3 ? '…' : ''));
        }
        if (d.siteAguardando && d.siteAguardando.length) {
            var h = Math.floor((t - new Date(d.siteAguardando[0].criado_em).getTime()) / 36e5);
            itens.push('🛒 ' + plural(d.siteAguardando.length, 'pedido do site aguardando', 'pedidos do site aguardando') + ' há mais de ' + WA.AGUARDANDO_SITE_HORAS + ' h (o mais antigo: ' + (h >= 48 ? Math.floor(h / 24) + ' dias' : h + ' h') + ')');
        }
        var parados = (d.coletas || []).map(function (c) {
            if (!c.ultima) return c.nome + ' (nenhuma coleta ok registrada)';
            var min = Math.floor((t - new Date(c.ultima).getTime()) / 6e4);
            return min > c.limiteMin ? c.nome + ' (há ' + quantoTempo(min) + ', última ' + core.dataBr(core.diaSP(c.ultima)) + ' ' + horaMin(c.ultima) + ')' : null;
        }).filter(Boolean);
        if (parados.length) itens.push('🔌 Coleta do ERP parada: ' + parados.join('; '));
        if (d.estoque && d.estoque.length) {
            var vistos = {}, nomes = [];
            d.estoque.forEach(function (e) { var k = String(e.nome); if (!vistos[k]) { vistos[k] = 1; nomes.push(nomeCurto(e.nome, 28) + (e.tipo === 'esgotou' ? ' (esgotou)' : ' (baixo)')); } });
            itens.push('📉 Estoque crítico (24 h): ' + nomes.slice(0, 5).join(', ') + (nomes.length > 5 ? ' e mais ' + (nomes.length - 5) : ''));
        }
        if (!itens.length) return { vazio: 'nada a alertar', texto: 'Alertas — ' + dataLonga(hoje) + ': nada a alertar.', partes: [] };
        // Itens inteiros (cada um até 300), juntos até 750; o que não couber vira "+N no painel" (nunca corta no meio).
        var cab = itens.map(function (i) { return nomeCurto(i, 300); }), cabe = [], tam = 0;
        cab.forEach(function (i, k) { var add = (cabe.length ? 3 : 0) + i.length; if (tam + add <= 720 && cabe.length === k) { cabe.push(i); tam += add; } });
        var lista = cabe.join(' | ') + (cabe.length < cab.length ? ' | (+' + (cab.length - cabe.length) + ' no painel)' : '');
        var partes = [parte('alertas_operacao', opts.template, [param(dataLonga(hoje) + ' ' + horaMin(agora), 40), param(lista, 750),
                                                                 param(linkPainel(opts.painelUrl, '') || 'abra o painel', 150)])];
        return { texto: textoDe(partes), partes: partes, resumo: { itens: itens.length } };
    }

    // ===================== rotina inteira =====================
    // Coleta + monta. Não envia nem grava: quem chama decide (Edge Function: provedor + log; painel: só mostra).
    function gerar(sb, codigo, agora, opts) {
        opts = opts || {};
        if (codigo === 'receber_diario') return coletarReceber(sb).then(function (d) { return montarReceber(d, agora, opts); });
        if (codigo === 'rota_s10' || codigo === 'rota_caminhao') return coletarRota(sb).then(function (d) { return montarRota(d, codigo === 'rota_s10' ? 's10' : 'caminhao', agora, opts); });
        if (codigo === 'alertas_marcio') return coletarAlertas(sb, agora).then(function (d) { return montarAlertas(d, agora, opts); });
        return Promise.reject(new Error('rotina desconhecida: ' + codigo));
    }
    // Papel x rotina (W1; mesma regra do gatilho da 042): financeiro e alertas SÓ gestor; rotas entregador ou gestor.
    var PAPEIS = { receber_diario: ['gestor'], alertas_marcio: ['gestor'], rota_s10: ['entregador', 'gestor'], rota_caminhao: ['entregador', 'gestor'] };
    function papelPermitido(codigo, papel) { return (PAPEIS[codigo] || []).indexOf(papel) >= 0; }
    // Quem pode receber: papel permitido para a rotina, ativo E com consentimento registrado (LGPD).
    // Devolve { ok: [...], pulados: [{dest, motivo}] }.
    function filtrarDestinatarios(ids, todos, codigo) {
        var porId = {}; (todos || []).forEach(function (d) { porId[d.id] = d; });
        var ok = [], pulados = [];
        (ids || []).forEach(function (id) {
            var d = porId[id];
            if (!d) pulados.push({ dest: { id: null }, motivo: 'destinatário removido' });
            else if (!papelPermitido(codigo, d.papel)) pulados.push({ dest: d, motivo: 'papel "' + d.papel + '" não recebe esta rotina' });
            else if (!d.ativo) pulados.push({ dest: d, motivo: 'destinatário inativo' });
            else if (!d.consentimento_em) pulados.push({ dest: d, motivo: 'sem consentimento registrado (LGPD)' });
            else ok.push(d);
        });
        return { ok: ok, pulados: pulados };
    }

    var WhatsCore = { WA: WA, brl: brl, param: param, horaMin: horaMin, minutosSP: minutosSP, rotinasDevidas: rotinasDevidas,
        coletarReceber: coletarReceber, coletarRota: coletarRota, coletarAlertas: coletarAlertas,
        montarReceber: montarReceber, montarRota: montarRota, montarAlertas: montarAlertas, gerar: gerar,
        filtrarDestinatarios: filtrarDestinatarios, papelPermitido: papelPermitido, PAPEIS: PAPEIS, MODELOS: MODELOS, renderizar: renderizar,
        empacotar: empacotar, COLETORES: COLETORES, linkPainel: linkPainel, linhasDeLog: linhasDeLog, corpoLog: corpoLog, MARCA_RESUMO: MARCA_RESUMO,
        nomeCurto: nomeCurto, corte: corte };
    raiz.TempRioWhatsCore = WhatsCore;
    if (typeof module !== 'undefined' && module.exports) module.exports = WhatsCore;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
