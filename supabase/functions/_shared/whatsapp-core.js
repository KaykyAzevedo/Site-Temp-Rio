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
    // Parâmetro de template da Meta: sem quebra de linha/tab, sem 4+ espaços seguidos, tamanho limitado.
    function param(s, max) {
        var t = String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' · ').replace(/ {2,}/g, ' ').trim();
        var m = max || WA.PARAM_MAX;
        if (t.length > m) t = t.slice(0, m - 1).trim() + '…';
        return t || '-';
    }
    function nomeCurto(s, max) { var t = String(s || '').replace(/\s+/g, ' ').trim(); max = max || 40; return t.length > max ? t.slice(0, max - 1).trim() + '…' : t; }
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
    function erroDe(r) { return r && r.error ? new Error(String(r.error.message || r.error)) : null; }
    function ausente(err) { return !!err && /PGRST205|42P01|does not exist|Could not find the table/i.test(String(err.code || '') + ' ' + String(err.message || '')); }
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

    // Mesmas fontes da aba Rotas (js/admin-rota.js): pedidos pendentes, cadastro, posição atual, config (040) e exceções.
    function coletarRota(sb) {
        return Promise.all([
            todas(function () { return sb.from('solidcon_pedidos_erp').select('*').in('etapa', ROTA.ETAPAS_PENDENTES).order('cd_pedido', { ascending: true }); }, 5000),
            sb.from('solidcon_pedidos_erp_sync').select('coletado_em').eq('status', 'ok').order('coletado_em', { ascending: false }).limit(1),
            sb.from('rota_config').select('*').eq('id', 1).limit(1),
            todas(function () { return sb.from('rota_cliente_veiculo').select('documento,veiculo').order('documento', { ascending: true }); }, 20000)
                .catch(function (e) { if (ausente(e)) return []; throw e; })
        ]).then(function (rs) {
            var pedidos = rs[0], docs = {};
            pedidos.forEach(function (p) { if (p.documento) docs[p.documento] = true; });
            if (rs[2] && rs[2].error && !ausente(rs[2].error)) throw erroDe(rs[2]);
            var cfgLinha = rs[2] && !rs[2].error && rs[2].data && rs[2].data[0] ? rs[2].data[0] : null;
            var excecoes = {};
            rs[3].forEach(function (e) { if (e.veiculo === 'caminhao' || e.veiculo === 's10') excecoes[e.documento] = e.veiculo; });
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
                return { pedidos: pedidos, clientes: cli, cfg: core.cfgDe(cfgLinha || core.CFG_PADRAO), excecoes: excecoes, coletado: sy ? sy.coletado_em : null };
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
    var MODELOS = {
        relatorio_diario: 'Contas a receber — {{1}}\nVencido: {{2}}\nVence hoje: {{3}}\nPróximos 7 dias: {{4}}\nMaiores vencidos: {{5}}\n{{6}}\nPainel: {{7}}\nMensagem automática do Temp Rio.',
        rota_do_dia: 'Rota {{1}} de {{2}} ({{3}}): {{4}}\nMapa: {{5}}\nMensagem automática do Temp Rio.',
        alertas_operacao: 'Alertas de {{1}}: {{2}}\nPainel: {{3}}\nMensagem automática do Temp Rio.'
    };
    WA.CORPO_MAX = 1024;   // limite do corpo do template na Meta (texto fixo + parâmetros)
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
        s = String(s == null ? '' : s);
        return s.length <= WA.CORPO_LOG_MAX ? s : s.slice(0, WA.CORPO_LOG_MAX - MARCA_RESUMO.length - 1) + '\n' + MARCA_RESUMO;
    }
    function linhasDeLog(msg) {
        if (!msg || !msg.partes || !msg.partes.length) return [{ parte: null, partes: null, corpo: msg && msg.texto ? corpoLog(msg.texto) : null }];
        return msg.partes.map(function (p, i) { return { parte: i + 1, partes: msg.partes.length, corpo: corpoLog(renderizar(p)) }; });
    }
    function parte(modelo, template, params) { return { modelo: modelo, template: template || modelo, params: params }; }
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
        var dadosTxt = d.coletado ? 'Dados do ERP de ' + core.dataBr(core.diaSP(d.coletado)) + ' ' + horaMin(d.coletado) : 'Sem coleta do ERP registrada';
        var velho = !d.coletado || (new Date(agora).getTime() - new Date(d.coletado).getTime()) > 26 * 36e5;
        var partes = [parte('relatorio_diario', opts.template, [
            param(dataLonga(hoje), 40),
            param(brl(venc.v) + ' (' + plural(venc.n, 'parcela', 'parcelas') + ', ' + cliTxt + ')', 140),
            param(brl(hojeV.v) + ' (' + plural(hojeV.n, 'parcela', 'parcelas') + ')', 60),
            param(brl(prox.v) + ' (' + plural(prox.n, 'parcela', 'parcelas') + ')', 60),
            param(top.length ? top.join('; ') : 'nenhum', 350),
            param((velho ? 'ATENÇÃO: ' : '') + dadosTxt + '.', 80),
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
    var ITEM_MAX = 115, LISTA_MAX = 480;
    function itemParada(sp, n) { return nomeCurto(n + ') ' + nomeParada(sp) + ' — ' + (sp.bairro ? nomeCurto(sp.bairro, 22) : 's/ bairro') + ' — ' + caixasTxt(sp), ITEM_MAX); }
    function montarRota(d, veiculo, agora, opts) {
        opts = opts || {};
        var hoje = core.diaSP(agora), rotulo = veiculo === 'caminhao' ? 'Caminhão CEASA' : 'S10';
        var pl = core.planejar(d.pedidos, d.clientes, hoje, { cfg: d.cfg, excecoes: d.excecoes });
        if (pl.semSaida) return { vazio: 'sem saída hoje (' + (pl.feriado ? 'feriado' : 'domingo/dia sem saída') + ')', texto: 'Rota ' + rotulo + ' — ' + dataLonga(hoje) + ': sem saída hoje.', partes: [] };
        var r = veiculo === 'caminhao' ? pl.caminhao : pl.s10;
        var total = r.paradas.length + r.semPosicao.length;
        if (!total) return { vazio: 'sem paradas', texto: 'Rota ' + rotulo + ' — ' + dataLonga(hoje) + ': nenhuma parada.', partes: [] };
        var partes = [];
        // Com posição: 1 mensagem por link do Maps (até 4 paradas: 3 intermediárias + destino).
        var links = core.linksGoogleMaps(r.paradas, WA.LOTE_PARADAS);
        links.forEach(function (lk) {
            var itens = r.paradas.slice(lk.de - 1, lk.ate).map(function (sp, i) { return itemParada(sp, lk.de + i); });
            partes.push(parte('rota_do_dia', opts.template, [param(rotulo, 20), param(dataLonga(hoje), 40),
                param('paradas ' + lk.de + (lk.ate > lk.de ? '–' + lk.ate : '') + ' de ' + total, 40), param(itens.join('; '), LISTA_MAX), param(lk.url, 300)]));
        });
        // Sem posição: mesmos lotes (até 4 paradas e LISTA_MAX caracteres), sem cortar parada.
        var ini = r.paradas.length + 1, n = ini;
        empacotar(r.semPosicao.map(function (sp, i) { return itemParada(sp, ini + i); }), WA.LOTE_PARADAS, LISTA_MAX, '; ').forEach(function (g) {
            var de = n, ate = n + g.length - 1; n = ate + 1;
            partes.push(parte('rota_do_dia', opts.template, [param(rotulo, 20), param(dataLonga(hoje), 40),
                param('sem posição no mapa, ' + de + (ate > de ? '–' + ate : '') + ' de ' + total, 40), param(g.join('; '), LISTA_MAX),
                param('sem link (cliente sem posição no mapa)', 300)]));
        });
        // Rota gigante (ex.: milhares de pedidos PF sem posição): limita ANTES do envio, com aviso na última mensagem.
        var omitidas = 0;
        if (partes.length > WA.PARTES_MAX) {
            var fora = partes.splice(WA.PARTES_MAX - 1);
            fora.forEach(function (x) { omitidas += x.params[3].split('; ').length; });
            partes.push(parte('rota_do_dia', opts.template, [param(rotulo, 20), param(dataLonga(hoje), 40), param('aviso', 40),
                param('rota longa demais para o WhatsApp: ' + plural(omitidas, 'parada não foi enviada', 'paradas não foram enviadas') +
                      ' (' + (total - omitidas + 1) + ' a ' + total + '). Veja a rota completa na aba Rotas do painel.', LISTA_MAX),
                param(linkPainel(opts.painelUrl, 'rotas') || 'abra o painel', 300)]));
        }
        return { texto: textoDe(partes), partes: partes,
                 resumo: { paradas: total, semPosicao: r.semPosicao.length, links: links.length, fica: veiculo === 's10' ? pl.fica.length : 0, omitidas: omitidas } };
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
        empacotar: empacotar, COLETORES: COLETORES, linkPainel: linkPainel, linhasDeLog: linhasDeLog, corpoLog: corpoLog, MARCA_RESUMO: MARCA_RESUMO };
    raiz.TempRioWhatsCore = WhatsCore;
    if (typeof module !== 'undefined' && module.exports) module.exports = WhatsCore;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
