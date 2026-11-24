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
        // 049: pedidos_dia e rota_chefe (resumos para o chefe). 'rota_chefe' NÃO é rota de veículo: id 'chefe' é reservado
        // (veiculoDaRotina e CHECK rota_veiculos_049_id).
        ROTINAS: ['receber_diario', 'rota_s10', 'rota_caminhao', 'alertas_marcio', 'pedidos_dia', 'rota_chefe'],
        // 047: rota de QUALQUER veículo da frota = 'rota_' + id do veículo (rota_strada...). rota_s10/rota_caminhao seguem.
        ROTA_VEICULO: /^rota_([a-z0-9_]{2,20})$/,
        // Rótulo na mensagem dos veículos de antes da 047 (texto aprovado/conhecido); os outros usam o nome da frota.
        ROTULOS: { caminhao: 'Caminhão CEASA', s10: 'S10' }
    };
    // Rotina conhecida: as fixas ou rota_<id do veículo>. Veículo da rota_<id> (null se não for rota).
    function veiculoDaRotina(codigo) { var m = WA.ROTA_VEICULO.exec(String(codigo || '')); return m && !/^(constructor|__proto__|prototype|chefe)$/.test(m[1]) ? m[1] : null; }
    function rotinaConhecida(codigo) { return WA.ROTINAS.indexOf(codigo) >= 0 || !!veiculoDaRotina(codigo); }

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
    function coletarCanhotos(sb) {
        return todas(function () { return sb.from('pedido_canhoto').select('cd_pedido').is('substituido_em', null).order('id', { ascending: true }); }, 50000)
            .then(function (rows) {
                if (rows.length >= 50000) throw new Error('limite de leitura de canhotos atingido; nao e seguro montar a mensagem');
                var m = {}; rows.forEach(function (c) { m[c.cd_pedido] = true; }); return m;
            })
            .catch(function (e) { if (ausente(e, 'pedido_canhoto')) return {}; throw e; });
    }
    function coletarConfigRota(sb) {
        return sb.from('rota_config').select('*').eq('id', 1).limit(1).then(function (r) {
            if (r.error && !ausente(r.error, 'rota_config')) throw erroDe(r);
            return core.cfgDe(r.data && r.data[0]);
        });
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
    // 045 (opcional, independente da detecção v2): rota_pedido_ignorado = pedidos "tirados da rota" até reativar; ficam
    // fora da mensagem. Ausente = ninguém ignorado; presente com erro de leitura = rejeita (mesma regra acima).
    // 050 (opcional, agora = dia de SP; sem agora = hoje): rota do dia FECHADA (foto). Ausente = previsão viva, como
    // antes; presente com erro de leitura = rejeita (nunca manda uma rota diferente da aba Rotas). d.fechada = foto do
    // dia (estado 'fechada') ou null; d.fechadaLinha = a linha do dia (também 'reaberta'); d.fechada050 = tabela lida.
    // Sentinela RF-1: a foto vem de UMA RPC (rota_050_ler: cabeçalho + itens no mesmo SELECT). Se a revisão mudar enquanto
    // o resto é coletado (fechou/ajustou/reabriu no meio), coleta de novo (até 3 vezes); continuando a mudar, erro.
    function lerFechadaRpc(sb, hoje) {
        return sb.rpc('rota_050_ler', { p_data: hoje }).then(function (r) {
            if (r.error) { var e = erroDe(r); if (/^(PGRST202|42883)$/.test(String(e.code || '')) || ausente(e, 'rota_dia_fechada')) return null; throw e; }
            var o = r.data, l = o && o.linha ? o.linha : null;
            if (!l) return { linha: null, foto: null, rev: 0 };
            var foto = l.estado === 'fechada' ? Object.assign({}, l, { data: String(l.data).slice(0, 10), itens: Array.isArray(o.itens) ? o.itens : [] }) : null;
            return { linha: l, foto: foto, rev: Number(l.revisao) || 0 };
        });
    }
    function coletarRota(sb, agora, tentativa) {
        function opcional(tabela, fab) { return todas(fab, 20000).catch(function (e) { if (ausente(e, tabela)) return null; throw e; }); }
        var hoje = core.diaSP(agora || new Date());
        tentativa = tentativa || 1;
        return Promise.all([lerFechadaRpc(sb, hoje), coletarRotaBase(sb, opcional)]).then(function (rs) {
            var fx = rs[0], d = rs[1];
            var conferir = fx ? lerFechadaRpc(sb, hoje) : Promise.resolve(null);
            return conferir.then(function (fx2) {
                if (fx && fx2 && (fx2.rev !== fx.rev || !fx2.linha !== !fx.linha)) {
                    if (tentativa >= 3) throw new Error('a rota do dia mudou durante a leitura (3 vezes); tente de novo');
                    return coletarRota(sb, agora, tentativa + 1);
                }
                d.fechada050 = fx !== null;
                d.fechada = fx ? fx.foto : null;
                d.fechadaLinha = fx ? fx.linha : null;
                d.fechadaRev = fx ? fx.rev : null;
                return d;
            });
        });
    }
    function coletarRotaBase(sb, opcional) {
        return Promise.all([
            todas(function () { return sb.from('solidcon_pedidos_erp').select('*').in('etapa', ROTA.ETAPAS_PENDENTES).order('cd_pedido', { ascending: true }); }, 5000),
            sb.from('solidcon_pedidos_erp_sync').select('coletado_em').eq('status', 'ok').order('coletado_em', { ascending: false }).limit(1),
            sb.from('rota_config').select('*').eq('id', 1).limit(1),
            todas(function () { return sb.from('rota_cliente_veiculo').select('documento,veiculo').order('documento', { ascending: true }); }, 20000)
                .catch(function (e) { if (ausente(e, 'rota_cliente_veiculo')) return []; throw e; }),
            opcional('rota_pedido_veiculo', function () { return sb.from('rota_pedido_veiculo').select('cd_pedido,veiculo').order('cd_pedido', { ascending: true }); }),
            opcional('rota_cliente_regras', function () { return sb.from('rota_cliente_regras').select('documento,janela_inicio,janela_fim,dias_sem_receber,prioridade,observacao').order('documento', { ascending: true }); }),
            opcional('rota_pedido_ignorado', function () { return sb.from('rota_pedido_ignorado').select('cd_pedido').order('cd_pedido', { ascending: true }); }),
            // 047 (opcional): a frota. Ausente = os 3 padrões do rota-core; presente com erro de leitura = rejeita.
            opcional('rota_veiculos', function () { return sb.from('rota_veiculos').select('id,nome,modo,capacidade_volume,dias_sem_saida,volta_sede,cor,ordem,ativo').order('id', { ascending: true }); }),
            coletarCanhotos(sb)
        ]).then(function (rs) {
            var pedidos = rs[0], docs = {};
            pedidos.forEach(function (p) { if (p.documento) docs[p.documento] = true; });
            if (rs[2] && rs[2].error && !ausente(rs[2].error, 'rota_config')) throw erroDe(rs[2]);
            var cfgAusente = !!(rs[2] && rs[2].error);
            var cfgLinha = rs[2] && !rs[2].error && rs[2].data && rs[2].data[0] ? rs[2].data[0] : null;
            var excecoes = {};
            // Só veículo que EXISTE: com a 047, os da rota_veiculos (inclusive desativados: o planejador põe o pedido em
            // aguardando); sem a 047, só os dois de antes (o CHECK da 040/044 nem deixa gravar outro).
            var frotaIds = rs[7] ? core.frotaDe(rs[7]).porId : { caminhao: true, s10: true };
            var idOk = function (v) { return typeof v === 'string' && Object.prototype.hasOwnProperty.call(frotaIds, v); };
            rs[3].forEach(function (e) { if (idOk(e.veiculo)) excecoes[e.documento] = e.veiculo; });
            // v2 só com a 044 inteira (mesma detecção da aba Rotas: config + as duas tabelas novas).
            var v2 = !cfgAusente && rs[4] !== null && rs[5] !== null, porPedido = {}, regras = {};
            if (v2) {
                rs[4].forEach(function (p) { if (idOk(p.veiculo)) porPedido[p.cd_pedido] = p.veiculo; });
                regras = core.regrasDe(rs[5]);
            }
            var ignorados = {};
            (rs[6] || []).forEach(function (x) { if (x && x.cd_pedido != null) ignorados[x.cd_pedido] = true; });
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
                var d = { pedidos: pedidos, clientes: cli, cfg: core.cfgDe(cfgLinha || core.CFG_PADRAO), excecoes: excecoes, coletado: sy ? sy.coletado_em : null,
                          ignorados: ignorados, veiculos: rs[7], canhotos: rs[8] };   // null = sem a 047 (padrões)
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
                return sb.from('solidcon_pedidos_erp').select('cd_pedido,dt_pedido,etapa,dt_saida,dt_nota,dt_atendido,cliente_tipo,documento,cliente_nome')
                    .in('etapa', ROTA.ETAPAS_PENDENTES).order('dt_pedido', { ascending: true });
            }, 5000),
            todas(function () {
                return sb.from('pedidos').select('id,criado_em').eq('status', 'aguardando')
                    .lt('criado_em', iso(t - WA.AGUARDANDO_SITE_HORAS * 36e5)).order('criado_em', { ascending: true });
            }, 5000),
            Promise.all(COLETORES.map(ultimaOk)),
            todas(function () {
                return sb.from('solidcon_eventos').select('nome,tipo,em').in('tipo', ['esgotou', 'estoque_baixo'])
                    .gte('em', iso(t - WA.ESTOQUE_HORAS * 36e5)).order('em', { ascending: false });
            }, 2000).catch(function (e) { if (ausente(e)) return null; throw e; }),
            coletarCanhotos(sb), coletarConfigRota(sb)
        ]).then(function (rs) {
            var parados = rs[0].filter(function (p) { return !core.recebidoEntrega(p, rs[4], rs[5]) &&
                (core.etapaEnviada(p) ? core.enviadoAntigo(p, rs[4], core.diaSP(agora), rs[5]) : Date.parse(p.dt_pedido) < t - WA.PARADO_ERP_DIAS * 864e5); });
            var docs = {}; parados.forEach(function (p) { if (p.documento) docs[p.documento] = true; });
            return nomesDe(sb, Object.keys(docs)).then(function (nomes) {
                return { parados: parados, nomes: nomes, siteAguardando: rs[1], coletas: rs[2].filter(Boolean), estoque: rs[3] };
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
        // _v2 (cadastrado em 23/11/2026, em análise na Meta): mesmo conteúdo em blocos, 1 cliente por linha ({{5}}..{{9}}).
        // A rotina passa a usá-lo quando whatsapp_rotinas.template = 'relatorio_diario_v2' (sem mudar código).
        relatorio_diario_v2: '📊 *Resumo das contas a receber — {{1}}*\n\n🔴 *Vencido em aberto*\n{{2}}\n\n🟡 *Vence hoje*\n{{3}}\n\n🟢 *A vencer nos próximos 7 dias*\n{{4}}\n\n━━━━━━━━━━━━\n🏆 *Maiores valores vencidos por cliente*\n1. {{5}}\n2. {{6}}\n3. {{7}}\n4. {{8}}\n5. {{9}}\n━━━━━━━━━━━━\n\nDados do ERP: coleta de {{10}}\n👉 Mais detalhes no painel: {{11}}\n\n_Mensagem automática do Temp Rio._',
        rota_do_dia: 'Rota do dia do veículo {{1}}, saída de {{2}}.\nTrecho desta mensagem: {{3}}.\nParadas em ordem de entrega: {{4}}\nMapa ou painel deste trecho: {{5}}\nMensagem automática do Temp Rio.',
        // _v2: a Meta classificou o 1º texto como MARKETING; este é seco/operacional para ficar UTILITY (o antigo fica parado lá).
        alertas_operacao_v2: 'Aviso de operação do Temp Rio em {{1}}.\nItens para conferir hoje: {{2}}\nDetalhes no painel interno: {{3}}\nMensagem automática do Temp Rio.',
        // WA-PED (cadastrados em 23/11/2026, em análise). Rotina pedidos_dia: 1 mensagem.
        pedidos_do_dia: '📦 *Resumo dos pedidos do dia — {{1}}*\n\n📥 *Entrou* (pedidos que chegaram no ERP)\n{{2}}\nPrincipais clientes: {{3}}\n\n✅ *Tá pronto* (conferido, aguardando saída)\n{{4}}\nPrincipais clientes: {{5}}\n\n🚚 *Enviou* (saiu ou foi entregue)\n{{6}}\nPrincipais clientes: {{7}}\n\n👉 Mais detalhes no painel: {{8}}\n\n_Mensagem automática do Temp Rio._',
        // Rotina rota_chefe: N mensagens rota_paradas (6 entregas cada) e, POR ÚLTIMO, 1 rota_sugerida.
        rota_paradas: '📍 *Pedidos para sair — {{1}} (parte {{2}})*\nCliente, pedidos, caixas, endereço e prioridade de cada entrega:\n\n1. {{3}}\n\n2. {{4}}\n\n3. {{5}}\n\n4. {{6}}\n\n5. {{7}}\n\n6. {{8}}\n\nA rota sugerida chega na última mensagem. Mensagem automática do Temp Rio.',
        // ATENÇÃO: "{{3}}\n{{4}}\n{{5}}" = variáveis separadas só por quebra de linha (a Meta já recusou "{{5}}\n{{6}}" com o
        // erro 2388293). Texto mantido IGUAL ao cadastrado; ver o teste de regras da Meta (exceção explícita).
        rota_sugerida: '🗺️ *Rota sugerida — {{1}}*\n\n📦 Total para sair: {{2}}\n\n🚚 *Por veículo*\n{{3}}\n{{4}}\n{{5}}\n\nOrdem sugerida das entregas porta a porta: {{6}}\n\n⚠️ Prioridades do dia: {{7}}\n\n👉 Rota completa e mapa no painel: {{8}}\n\n_Mensagem automática do Temp Rio._'
    };
    WA.CORPO_MAX = 1024;   // limite do corpo do template na Meta (texto fixo + parâmetros)
    // Orçamento de caracteres por parâmetro ({{1}}, {{2}}, ...): texto fixo + soma dos limites <= CORPO_MAX no PIOR caso
    // (fixo: relatorio 236, relatorio_v2 294, rota 153, alertas_v2 126). parte() aplica estes limites a todo parâmetro (corte com '…').
    WA.LIMITES = {
        relatorio_diario: [25, 140, 60, 60, 300, 60, 140],
        // v2: {{5}}..{{9}} = 1 cliente cada (RECEBER_ITEM_MAX); {{10}} = "23/11 às 08:28" ou aviso de coleta antiga/ausente.
        relatorio_diario_v2: [25, 110, 50, 50, 64, 64, 64, 64, 64, 50, 120],
        rota_do_dia: [20, 25, 40, 480, 300],
        alertas_operacao_v2: [25, 750, 110],
        // WA-PED (fixo: pedidos 292, paradas 205, sugerida 208). Paradas: {{3}}..{{8}} = 1 entrega cada (ENTREGA_MAX).
        pedidos_do_dia: [60, 60, 120, 80, 120, 60, 120, 110],
        rota_paradas: [25, 15, 129, 129, 129, 129, 129, 129],
        rota_sugerida: [25, 150, 70, 70, 110, 150, 140, 100]
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
    // Nomes de template aposentados na Meta -> o atual. Rotina ainda gravada com o nome antigo manda o novo, e a prévia
    // continua idêntica ao que a Meta entrega (o texto renderizado é sempre o de MODELOS[modelo]).
    var APOSENTADOS = { alertas_operacao: 'alertas_operacao_v2' };
    function parte(modelo, template, params) {
        var lim = WA.LIMITES[modelo] || [];
        if (template && APOSENTADOS[template]) template = APOSENTADOS[template];
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
        var top5 = Object.keys(porCli).map(function (k) { return porCli[k]; })
            .sort(function (a, b) { return b.v - a.v || b.dias - a.dias; }).slice(0, 5);
        var resumo = { vencido: venc.v, parcelasVencidas: venc.n, clientes: nCli, hoje: hojeV.v, prox7: prox.v };
        if (opts.template === 'relatorio_diario_v2') return receberV2(d, agora, opts, hoje, venc, hojeV, prox, nCli, top5, resumo);
        var top = top5.map(function (c, i) {
                var nm = c.documento ? nomeCurto(d.nomes && d.nomes[c.documento] && d.nomes[c.documento].nome || 'cliente', 28) : nomeNeutro(c.tipo);
                return (i + 1) + ') ' + nm + ' ' + brl(c.v) + ' (' + c.dias + 'd)';
            });
        var cliTxt = plural(nCli, 'cliente', 'clientes') + (venc.semDoc ? ' + ' + plural(venc.semDoc, 'parcela', 'parcelas') + ' de pessoa física/sem documento' : '');
        // {{6}} entra em "Dados do ERP: {{6}}." -> "coleta de 16/11 06:00" / "ATENÇÃO, coleta antiga de 14/11 05:50".
        var quando = d.coletado ? core.dataBr(core.diaSP(d.coletado)) + ' ' + horaMin(d.coletado) : null;
        var velho = coletaVelha(d.coletado, agora);
        var partes = [parte('relatorio_diario', opts.template, [
            param(dataLonga(hoje), 40),
            param(brl(venc.v) + ' (' + plural(venc.n, 'parcela', 'parcelas') + ', ' + cliTxt + ')', 140),
            param(brl(hojeV.v) + ' (' + plural(hojeV.n, 'parcela', 'parcelas') + ')', 60),
            param(brl(prox.v) + ' (' + plural(prox.n, 'parcela', 'parcelas') + ')', 60),
            param(top.length ? top.join('; ') : 'nenhum', 350),
            param(!quando ? 'ATENÇÃO, nenhuma coleta registrada' : (velho ? 'ATENÇÃO, coleta antiga de ' : 'coleta de ') + quando, 60),
            param(linkPainel(opts.painelUrl, ABA_RECEBER) || 'abra o painel', 150)])];
        return { texto: textoDe(partes), partes: partes, resumo: resumo };
    }
    // Contas a receber ficam em Clientes > Financeiro: o link dos dois formatos abre essa aba.
    var ABA_RECEBER = 'clientes';
    // Coleta ausente ou com mais de 26 h = antiga (o relatório avisa).
    function coletaVelha(coletado, agora) { return !coletado || (new Date(agora).getTime() - new Date(coletado).getTime()) > 26 * 36e5; }
    // v2: 1 cliente por {{n}} = "NOME — R$ 8.226,22 (4 dias)". O nome é cortado com '…' para o valor e os dias caberem
    // inteiros em RECEBER_ITEM_MAX (nunca corta o valor). Vaga sem cliente = '—'; nenhum vencido = frase clara no 1º.
    var RECEBER_ITEM_MAX = WA.LIMITES.relatorio_diario_v2[4], RECEBER_NOME_MAX = 40;
    function itemReceberV2(c, nomes) {
        var cauda = ' — ' + brl(c.v) + ' (' + plural(c.dias, 'dia', 'dias') + ')';
        var bruto = c.documento ? (nomes && nomes[c.documento] && nomes[c.documento].nome || 'cliente') : nomeNeutro(c.tipo);
        return (nomeCurto(bruto, Math.max(8, Math.min(RECEBER_NOME_MAX, RECEBER_ITEM_MAX - cauda.length))) || 'cliente') + cauda;
    }
    // Totais do v2: "R$ 68.533,31 · 32 parcelas · 28 clientes"; zero = frase sem valor ("nada vencido").
    function totalV2(g, vazio, extra) { return g.n ? brl(g.v) + ' · ' + plural(g.n, 'parcela', 'parcelas') + (extra || '') : vazio; }
    function receberV2(d, agora, opts, hoje, venc, hojeV, prox, nCli, top5, resumo) {
        var cli = '';
        if (nCli) cli += ' · ' + plural(nCli, 'cliente', 'clientes');
        if (venc.semDoc) cli += (nCli ? ' + ' : ' · ') + plural(venc.semDoc, 'parcela', 'parcelas') + ' de pessoa física/sem documento';
        var itens = [0, 1, 2, 3, 4].map(function (i) {
            if (top5[i]) return itemReceberV2(top5[i], d.nomes);
            return i === 0 ? 'nenhum valor vencido' : '—';
        });
        // {{10}} entra em "Dados do ERP: coleta de {{10}}" -> "23/11 às 08:28" / "14/11 às 05:50 (ATENÇÃO, coleta antiga)".
        var quando = d.coletado ? core.dataBr(core.diaSP(d.coletado)) + ' às ' + horaMin(d.coletado) : null;
        var coleta = !quando ? '— (ATENÇÃO, nenhuma coleta registrada)' : quando + (coletaVelha(d.coletado, agora) ? ' (ATENÇÃO, coleta antiga)' : '');
        var partes = [parte('relatorio_diario_v2', opts.template, [
            dataLonga(hoje),
            totalV2(venc, 'nada vencido', cli),
            totalV2(hojeV, 'nada vence hoje'),
            totalV2(prox, 'nada vence nos próximos 7 dias')
        ].concat(itens, [coleta, linkPainel(opts.painelUrl, ABA_RECEBER) || 'abra o painel']))];
        return { texto: textoDe(partes), partes: partes, resumo: resumo };
    }

    // rota_<veículo> (rota_s10, rota_caminhao, rota_strada...). d = coletarRota(...). veiculo = id da frota. Entregador ou gestor.
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
    // CD do CEASA (a única parada do caminhão na v2/v3): UM item com quantos clientes e o total de caixas da carga.
    function itemParada(sp, n, v2) {
        if (!v2) return nomeCurto(n + ') ' + nomeParada(sp) + ' — ' + (sp.bairro ? nomeCurto(sp.bairro, 22) : 's/ bairro') + ' — ' + caixasTxt(sp), ITEM_MAX);
        var hora = sp.eta ? '~' + sp.eta + ' ' : '';
        if (sp.cd) return nomeCurto(n + ') ' + hora + ROTA.CEASA_CD_NOME + ' — ' + plural(sp.carga ? sp.carga.length : 0, 'cliente', 'clientes') + ' — ' + caixasTxt(sp), ITEM_MAX);
        return nomeCurto(n + ') ' + hora + nomeParada(sp) + ' — ' + (sp.bairro ? nomeCurto(sp.bairro, 22) : 's/ bairro') + ' — ' + caixasTxt(sp) +
            (sp.janela ? ' — recebe ' + sp.janela : ''), ITEM_MAX);
    }
    // Quantas paradas a parte leva: guardado na estrutura (o texto não é reanalisado). Não vai para a Meta.
    function comParadas(pt, n) { pt.paradas = n; return pt; }
    // O plano do dia = o MESMO cálculo da aba Rotas (rota-core planejar): v2 (044) pela marcação + regras; sem a 044, o
    // modo automático de antes. Usado por rota_<veículo> e por rota_chefe (WA-PED).
    function planoRota(d, hoje) {
        return core.planejar(d.pedidos, d.clientes, hoje, opcoesRota(d));
    }
    function opcoesRota(d) {
        return { cfg: d.cfg, excecoes: d.excecoes, marcacao: !!d.v2, padroes: d.excecoes, porPedido: d.porPedido || {},
                 regras: d.regras || {}, ignorados: d.ignorados || {}, veiculos: d.veiculos, fechada: d.fechada || null, canhotos: d.canhotos || {},
                 projetarSeparando: false };   // fechada: mensagem usa somente inclusao confirmada pela054
    }
    function montarRota(d, veiculo, agora, opts) {
        opts = opts || {};
        var hoje = core.diaSP(agora), frota = core.frotaDe(d.veiculos === undefined ? null : d.veiculos);
        var vei = Object.prototype.hasOwnProperty.call(frota.porId, veiculo) ? frota.porId[veiculo] : null;
        var rotulo = Object.prototype.hasOwnProperty.call(WA.ROTULOS, veiculo) ? WA.ROTULOS[veiculo] : (vei ? vei.nome : String(veiculo));
        // 047: veículo fora da frota ou desativado = não manda (o histórico mostra o motivo).
        if (!vei || !vei.ativo) return { vazio: 'veículo ' + veiculo + (vei ? ' desativado' : ' não existe na frota'), texto: 'Rota ' + rotulo + ': veículo ' + (vei ? 'desativado' : 'inexistente') + '.', partes: [] };
        // v2 (044 legível, ver coletarRota): veículo só pela marcação (pedido > padrão do cliente); sem marcação o pedido
        // fica FORA (aguardando, como na aba Rotas); regras de entrega (dia fechado, janela, prioridade) e hora prevista.
        // 045: pedido "tirado da rota" (d.ignorados) não vai na mensagem, nem conta como aguardando.
        var v2 = !!d.v2;
        // Sem a 044 (modo automático de antes) só existem a S10 e o caminhão.
        if (!v2 && veiculo !== 's10' && veiculo !== 'caminhao') return { vazio: 'rota ' + rotulo + ' exige a marcação por veículo (044)', texto: 'Rota ' + rotulo + ': sem marcação por veículo.', partes: [] };
        var pl = planoRota(d, hoje);
        if (pl.semSaida) return { vazio: 'sem saída hoje (' + (pl.feriado ? 'feriado' : 'domingo/dia sem saída') + ')', texto: 'Rota ' + rotulo + ' — ' + dataLonga(hoje) + ': sem saída hoje.', partes: [] };
        var r = pl.veiculos && pl.veiculos[veiculo] ? pl.veiculos[veiculo] : (veiculo === 'caminhao' ? pl.caminhao : pl.s10);
        // Dia em que ESTE veículo não sai (S10/Strada no sábado: dias_sem_saida da frota) = sem saída, não manda nada.
        if (r.semSaida) return { vazio: 'sem saída hoje para a ' + rotulo + ' (' + core.nomeDia(hoje) + ')', texto: 'Rota ' + rotulo + ' — ' + dataLonga(hoje) + ': a ' + rotulo + ' não sai hoje.', partes: [] };
        var total = r.paradas.length + r.semPosicao.length;
        if (!total) {
            // v2: diz quantos pedidos esperam marcação (o histórico mostra por que a rota saiu vazia).
            var ag = v2 && pl.aguardando.length ? ' (' + plural(pl.aguardando.length, 'pedido aguardando', 'pedidos aguardando') + ' marcação CEASA/S10)' : '';
            return { vazio: 'sem paradas' + ag, texto: 'Rota ' + rotulo + ' — ' + dataLonga(hoje) + ': nenhuma parada' + ag + '.', partes: [] };
        }
        var partes = [];
        // v2/v3 caminhão: r.paradas = [CD] (uma mensagem, link da sede até o CD). S10 e v1: lotes de até 4 paradas.
        var comLink = r.paradas;
        // Número de cada parada = posição na ORDEM DE ENTREGA (sequência). Sem rota fechada é o mesmo de antes (com posição,
        // depois sem posição); com a rota fechada, quem perdeu o pino mantém o número salvo (Sentinela RF-4).
        var seqAll = core.sequenciaDe(r), numero = function (sp) { var k = seqAll.indexOf(sp); return k >= 0 ? k + 1 : 0; };
        // Com posição: 1 mensagem por link do Maps (até 4 paradas: 3 intermediárias + destino).
        var links = core.linksGoogleMaps(comLink, WA.LOTE_PARADAS);
        links.forEach(function (lk) {
            var lote = comLink.slice(lk.de - 1, lk.ate), a = numero(lote[0]), z = numero(lote[lote.length - 1]);
            var itens = lote.map(function (sp) { return itemParada(sp, numero(sp), v2); });
            partes.push(comParadas(parte('rota_do_dia', opts.template, [param(rotulo, 20), param(dataLonga(hoje), 40),
                param((lote.length > 1 ? 'paradas ' + a + '–' + z : 'parada ' + a) + ' de ' + total, 40), param(itens.join('; '), LISTA_MAX), param(lk.url, 300)]), itens.length));
        });
        // Sem posição: mesmos lotes (até 4 paradas e LISTA_MAX caracteres), sem cortar parada.
        var nums = r.semPosicao.map(numero), pos = 0;
        empacotar(r.semPosicao.map(function (sp) { return itemParada(sp, numero(sp), v2); }), WA.LOTE_PARADAS, LISTA_MAX, '; ').forEach(function (g) {
            var de = nums[pos], ate = nums[pos + g.length - 1]; pos += g.length;
            partes.push(comParadas(parte('rota_do_dia', opts.template, [param(rotulo, 20), param(dataLonga(hoje), 40),
                param('sem posição no mapa, ' + de + (ate > de ? '–' + ate : '') + ' de ' + total, 40), param(g.join('; '), LISTA_MAX),
                param('sem link (cliente sem posição no mapa)', 300)]), g.length));
        });
        // Rota gigante (ex.: milhares de pedidos PF sem posição): limita ANTES do envio, com aviso na última mensagem.
        var omitidas = 0, maxPartes = WA.PARTES_MAX, ultimaNum = total;
        if (partes.length > maxPartes) {
            var fora = partes.splice(maxPartes - 1);
            fora.forEach(function (x) { omitidas += x.paradas; });   // pela estrutura, nunca pelo texto (nome pode ter '; ')
            partes.push(parte('rota_do_dia', opts.template, [param(rotulo, 20), param(dataLonga(hoje), 40), param('aviso', 40),
                param('rota longa demais para o WhatsApp: ' + plural(omitidas, 'parada não foi enviada', 'paradas não foram enviadas') +
                      ' (' + (ultimaNum - omitidas + 1) + ' a ' + ultimaNum + '). Veja a rota completa na aba Rotas do painel.', LISTA_MAX),
                param(linkPainel(opts.painelUrl, 'rotas') || 'abra o painel', 300)]));
        }
        var resumo = { paradas: total, semPosicao: r.semPosicao.length, links: links.length, fica: veiculo === 's10' ? pl.fica.length : 0, omitidas: omitidas };
        if (v2) {   // na v2 o caminhão também pode deixar pedido para depois (cliente que não recebe hoje)
            resumo.modo = 'marcacao'; resumo.aguardando = pl.aguardando.length; resumo.ignorados = pl.ignorados.length;
            resumo.fica = pl.fica.filter(function (x) { return x.veiculo === veiculo; }).length;
            resumo.atrasos = r.horario ? r.horario.atrasos : 0;
            if (r.modo === 'cd_ceasa') resumo.cd = r.cd ? r.cd.total.clientes : 0;
            if (r.semLimite && r.modo === 'porta') resumo.semLimite = true;   // carga do veículo não definida (aviso)
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
                var faturado = core.etapaEnviada(p), dias = faturado
                    ? Math.round((Date.parse(hoje + 'T12:00:00Z') - Date.parse(core.diaSP(core.faturadoEm(p)) + 'T12:00:00Z')) / 864e5)
                    : Math.floor((t - new Date(p.dt_pedido).getTime()) / 864e5);
                return '#' + p.cd_pedido + ' ' + nm + ' (' + dias + 'd' + (faturado ? ' faturado sem canhoto' : '') + ')';
            });
            itens.push(plural(d.parados.length, 'pedido do ERP parado', 'pedidos do ERP parados') + ' há mais de ' + WA.PARADO_ERP_DIAS + ' dias: ' + ex.join(', ') + (d.parados.length > 3 ? '…' : ''));
        }
        if (d.siteAguardando && d.siteAguardando.length) {
            var h = Math.floor((t - new Date(d.siteAguardando[0].criado_em).getTime()) / 36e5);
            itens.push(plural(d.siteAguardando.length, 'pedido do site aguardando', 'pedidos do site aguardando') + ' há mais de ' + WA.AGUARDANDO_SITE_HORAS + ' h (o mais antigo: ' + (h >= 48 ? Math.floor(h / 24) + ' dias' : h + ' h') + ')');
        }
        var parados = (d.coletas || []).map(function (c) {
            if (!c.ultima) return c.nome + ' (nenhuma coleta ok registrada)';
            var min = Math.floor((t - new Date(c.ultima).getTime()) / 6e4);
            return min > c.limiteMin ? c.nome + ' (há ' + quantoTempo(min) + ', última ' + core.dataBr(core.diaSP(c.ultima)) + ' ' + horaMin(c.ultima) + ')' : null;
        }).filter(Boolean);
        if (parados.length) itens.push('Coleta do ERP parada: ' + parados.join('; '));
        if (d.estoque && d.estoque.length) {
            var vistos = {}, nomes = [];
            d.estoque.forEach(function (e) { var k = String(e.nome); if (!vistos[k]) { vistos[k] = 1; nomes.push(nomeCurto(e.nome, 28) + (e.tipo === 'esgotou' ? ' (esgotou)' : ' (baixo)')); } });
            itens.push('Estoque crítico (24 h): ' + nomes.slice(0, 5).join(', ') + (nomes.length > 5 ? ' e mais ' + (nomes.length - 5) : ''));
        }
        if (!itens.length) return { vazio: 'nada a alertar', texto: 'Aviso de operação — ' + dataLonga(hoje) + ': nada a conferir.', partes: [] };
        // Itens inteiros (cada um até 300), juntos até 750; o que não couber vira "+N no painel" (nunca corta no meio).
        var cab = itens.map(function (i) { return nomeCurto(i, 300); }), cabe = [], tam = 0;
        cab.forEach(function (i, k) { var add = (cabe.length ? 3 : 0) + i.length; if (tam + add <= 720 && cabe.length === k) { cabe.push(i); tam += add; } });
        var lista = cabe.join(' | ') + (cabe.length < cab.length ? ' | (+' + (cab.length - cabe.length) + ' no painel)' : '');
        var partes = [parte('alertas_operacao_v2', opts.template, [param(dataLonga(hoje) + ' ' + horaMin(agora), 40), param(lista, 750),
                                                                 param(linkPainel(opts.painelUrl, '') || 'abra o painel', 150)])];
        return { texto: textoDe(partes), partes: partes, resumo: { itens: itens.length } };
    }

    // ===================== WA-PED: pedidos do dia (pedidos_dia) =====================
    // Fonte: solidcon_pedidos_erp (a mesma do Kanban "Pedidos" do painel). Regra (por pedido, dia de São Paulo):
    //   Entrou    = dt_pedido no dia (qualquer etapa agora);
    //   Tá pronto = etapa 'conferido' AGORA (= coluna "Conferido" do Kanban, sem filtro de dia);
    //   Enviou = saiu/atendido com faturamento no dia (saida > nota > atendido); NAO comprova entrega.
    // O Kanban não tem filtro "do dia" (mostra a etapa atual de todos); o recorte por dia é só desta mensagem.
    var ABA_PEDIDOS = 'pedidos', PED_COLS = 'cd_pedido,dt_pedido,etapa,dt_conferencia,dt_saida,dt_nota,dt_atendido,cliente_tipo,documento,cliente_nome,valor_centavos,caixas_24,caixas_48,caixas_outras';
    var PED_COLETA_VELHA_MIN = WA.COLETA_PARADA_MIN + 5;   // coletor de pedidos roda a cada 5 min
    function coletarPedidosDia(sb, agora) {
        // margem de 1 dia antes da meia-noite de SP; o recorte exato é por core.diaSP em montarPedidosDia.
        var desde = new Date(Date.parse(core.diaSP(agora) + 'T00:00:00Z') - 864e5).toISOString();
        var q = function () { return sb.from('solidcon_pedidos_erp').select(PED_COLS); };
        return Promise.all([
            todas(function () { return q().gte('dt_pedido', desde).order('cd_pedido', { ascending: true }); }, 20000),
            todas(function () { return q().eq('etapa', 'conferido').order('cd_pedido', { ascending: true }); }, 20000),
            todas(function () { return q().in('etapa', ['saiu', 'atendido']).order('cd_pedido', { ascending: true }); }, 20000),
            sb.from('solidcon_pedidos_erp_sync').select('coletado_em').eq('status', 'ok').order('coletado_em', { ascending: false }).limit(1),
            coletarCanhotos(sb), coletarConfigRota(sb)
        ]).then(function (rs) {
            var porCd = {}, pedidos = [], docs = {};
            [rs[0], rs[1], rs[2]].forEach(function (l) { l.forEach(function (p) { if (!porCd[p.cd_pedido]) { porCd[p.cd_pedido] = true; pedidos.push(p); if (p.documento) docs[p.documento] = true; } }); });
            var sy = rs[3] && !rs[3].error && rs[3].data && rs[3].data[0];
            return nomesDe(sb, Object.keys(docs)).then(function (nomes) { return { pedidos: pedidos, nomes: nomes, coletado: sy ? sy.coletado_em : null, canhotos: rs[4], cfg: rs[5] }; });
        });
    }
    function nomePedido(p, nomes, max) {
        if (p.cliente_tipo !== 'cnpj' || !p.documento) return nomeNeutro(p.cliente_tipo);
        return nomeCurto((nomes && nomes[p.documento] && nomes[p.documento].nome) || p.cliente_nome || 'cliente', max || 30);
    }
    // "8 pedidos · R$ 12.340,00" (pedido sem valor no ERP: avisa quantos); vazio = "nenhum pedido".
    function pedidosValor(l) {
        if (!l.length) return 'nenhum pedido';
        var v = 0, sem = 0; l.forEach(function (p) { if (p.valor_centavos == null) sem++; else v += Number(p.valor_centavos) || 0; });
        return plural(l.length, 'pedido', 'pedidos') + ' · ' + brl(v) + (sem ? ' (' + sem + ' sem valor no ERP)' : '');
    }
    // Caixas: cx24 + cx48 (rota-core volumePedido); potes avulsos e pedido sem caixas no ERP aparecem à parte.
    function somaCaixas(vols) {
        var cx = 0, pot = 0, desc = 0;
        vols.forEach(function (v) { if (v.vol == null) desc++; else { cx += v.c24 + v.c48; pot += v.avulsos; } });
        return { cx: cx, pot: pot, desc: desc };
    }
    function pedidosCaixas(l) {
        if (!l.length) return 'nenhum pedido';
        var s = somaCaixas(l.map(core.volumePedido));
        return plural(l.length, 'pedido', 'pedidos') + ' · ' + plural(s.cx, 'caixa', 'caixas') + (s.pot ? ' + ' + plural(s.pot, 'pote', 'potes') : '') +
            (s.desc ? ' (' + s.desc + ' sem caixas no ERP)' : '');
    }
    // "PETRO FRUTAS · RIO SUL ITAGUAI · MULTIMARKET · +5": até 3 por valor (depois nº de pedidos); PF/sem documento num
    // grupo neutro por tipo (nunca nome). Itens inteiros: o que não cabe em max entra no "+N".
    function principais(l, nomes, max) {
        if (!l.length) return 'nenhum';
        var g = {}, lista = [];
        l.forEach(function (p) {
            var k = p.cliente_tipo === 'cnpj' && p.documento ? 'd:' + p.documento : 't:' + p.cliente_tipo;
            var c = g[k] || (g[k] = { nome: nomePedido(p, nomes, 30), v: 0, n: 0, k: k });
            if (c.n === 0) lista.push(c);
            c.v += Number(p.valor_centavos) || 0; c.n++;
        });
        lista.sort(function (a, b) { return b.v - a.v || b.n - a.n || (a.k < b.k ? -1 : 1); });
        var mostra = [], tam = 0;
        for (var i = 0; i < lista.length && mostra.length < 3; i++) {
            var resto = lista.length - mostra.length - 1, cauda = resto ? (' · +' + resto).length : 0;
            var add = (mostra.length ? 3 : 0) + lista[i].nome.length;
            if (tam + add + cauda > max) break;
            mostra.push(lista[i].nome); tam += add;
        }
        var fora = lista.length - mostra.length;
        if (!mostra.length) return plural(lista.length, 'cliente', 'clientes');
        return mostra.join(' · ') + (fora ? ' · +' + fora : '');
    }
    function montarPedidosDia(d, agora, opts) {
        opts = opts || {};
        var hoje = core.diaSP(agora), noDia = function (v) { return !!v && core.diaSP(v) === hoje; };
        var entrou = [], pronto = [], enviou = [];
        (d.pedidos || []).forEach(function (p) {
            if (!p) return;
            if (noDia(p.dt_pedido)) entrou.push(p);
            if (p.etapa === 'conferido' && !core.recebidoEntrega(p, d.canhotos, d.cfg)) pronto.push(p);
            if (core.etapaEnviada(p) && noDia(core.faturadoEm(p))) enviou.push(p);
        });
        // {{1}} "segunda, 23/11 às 17:00"; coleta do ERP atrasada ou ausente vai junto (os números podem estar velhos).
        var t = new Date(agora).getTime(), col = d.coletado ? new Date(d.coletado).getTime() : NaN;
        var aviso = !isFinite(col) ? ' (ATENÇÃO, sem coleta do ERP)' : (t - col > PED_COLETA_VELHA_MIN * 6e4 ? ' (ATENÇÃO, ERP de ' + horaMin(d.coletado) + ')' : '');
        var L = WA.LIMITES.pedidos_do_dia;
        var partes = [parte('pedidos_do_dia', opts.template, [
            dataLonga(hoje) + ' às ' + horaMin(agora) + aviso,
            pedidosValor(entrou), principais(entrou, d.nomes, L[2]),
            pedidosCaixas(pronto), principais(pronto, d.nomes, L[4]),
            pedidosValor(enviou), principais(enviou, d.nomes, L[6]),
            linkPainel(opts.painelUrl, ABA_PEDIDOS) || 'abra o painel'])];
        return { texto: textoDe(partes), partes: partes, resumo: { entrou: entrou.length, pronto: pronto.length, enviou: enviou.length } };
    }

    // ===================== WA-PED: rota do chefe (rota_chefe = N x rota_paradas + 1 rota_sugerida) =====================
    // Mesmo plano da aba Rotas / rota_<veículo> (planoRota). Entregas = paradas porta a porta de cada veículo ativo, na
    // ordem da rota e da frota (com posição, depois sem posição), e por último as cargas do CD do CEASA (1 por cliente).
    var ENTREGA_MAX = WA.LIMITES.rota_paradas[2], ENTREGAS_POR_PARTE = 6, ABA_ROTAS = 'rotas';
    function nomeVeiculo(b) { return b.modo === 'cd_ceasa' && !/ceasa/i.test(b.nome) ? b.nome + ' (CEASA)' : b.nome; }
    // "18 cx", "18 cx + 3 potes", "volume a conferir" (pedido sem caixas no ERP).
    function cxCurto(s) {
        var t = [];
        if (s.cx || (!s.pot && !s.desc)) t.push(s.cx + ' cx');
        if (s.pot) t.push(plural(s.pot, 'pote', 'potes'));
        var txt = t.join(' + ');
        return s.desc ? (txt ? txt + ' + volume a conferir' : 'volume a conferir') : txt;
    }
    function enderecoDe(c) {
        if (!c) return 'sem endereço cadastrado';
        var rua = [c.logradouro, c.numero].map(function (x) { return x == null ? '' : bemFormado(x).replace(/\s+/g, ' ').trim(); }).filter(Boolean).join(', ');
        var e = [rua, c.bairro, c.cidade].map(function (x) { return x == null ? '' : bemFormado(x).replace(/\s+/g, ' ').trim(); }).filter(Boolean).join(', ');
        return e || 'sem endereço cadastrado';
    }
    // Uma entrega = 1 parâmetro inteiro: NOME · pedidos · caixas [· VEÍCULO] — ENDEREÇO [· prioridade alta · recebe
    // 08:00–11:00 · sem posição no mapa]. Contagem, caixas, prioridade, janela e "sem posição" ficam SEMPRE inteiros
    // (Sentinela WP-1): o orçamento de ENTREGA_MAX corta primeiro o veículo (até 6), depois o nome (até 10) e o endereço
    // fica com o que sobrar (nunca um mínimo maior que o orçamento). Corte com "…".
    var ITEM_TAG_MIN = 6, ITEM_NOME_MIN = 10, ITEM_END_MIN = 8;
    function montarItem(nome, meio, tag, end, extras) {
        var cauda = extras.length ? ' · ' + extras.join(' · ') : '';
        var livre = ENTREGA_MAX - meio.length - cauda.length - 3;   // ' — '
        var t = tag || '', n = nome;
        var sobra = n.length + (t ? 3 + t.length : 0) + ITEM_END_MIN - livre;
        if (sobra > 0 && t) { var ct = Math.min(sobra, Math.max(0, t.length - ITEM_TAG_MIN)); if (ct) { t = nomeCurto(t, t.length - ct); sobra -= ct; } }
        if (sobra > 0) { var cn = Math.min(sobra, Math.max(0, n.length - ITEM_NOME_MIN)); if (cn) { n = nomeCurto(n, n.length - cn); sobra -= cn; } }
        var maxEnd = livre - n.length - (t ? 3 + t.length : 0);
        var e = maxEnd >= 1 ? nomeCurto(end, maxEnd) : '';
        return n + meio + (t ? ' · ' + t : '') + ' — ' + (e || '…') + cauda;
    }
    function entregaPorta(sp, tag) {
        var c = sp.pedidos[0] && sp.pedidos[0].c;
        var meio = ' · ' + plural(sp.pedidos.length, 'pedido', 'pedidos') + ' · ' + cxCurto(somaCaixas(sp.pedidos.map(function (x) { return x.v; })));
        var ex = [];
        if (sp.prioridade) ex.push('prioridade alta');
        if (sp.janela) ex.push('recebe ' + sp.janela);
        if (!sp.pos) ex.push('sem posição no mapa');
        return montarItem(nomeParada(sp), meio, tag ? nomeCurto(tag, 40) : '', sp.tipo === 'cnpj' ? enderecoDe(c) : 'endereço no painel', ex);
    }
    function entregaCd(it, b) {
        var nm = it.documento ? nomeCurto(it.nome || 'cliente', 30) : nomeNeutro(it.tipo) + ' (pedido ' + it.pedidos[0] + ')';
        var s = { cx: it.c24 + it.c48, pot: it.avulsos, desc: it.desconhecidos };
        return montarItem(nm, ' · ' + plural(it.pedidos.length, 'pedido', 'pedidos') + ' · ' + cxCurto(s), '', 'entrega no CEASA (' + nomeCurto(b.nome, 40) + ')', []);
    }
    // Trajeto de um veículo: bairros (ou cidade) em ordem, repetidos seguidos viram um; corta o MEIO com "…" para caber.
    function trajeto(b, max) {
        var nomes = [];
        b.paradas.forEach(function (sp) {
            var n = nomeCurto(sp.bairro || sp.cidade || 'sem bairro', 22);
            if (nomes[nomes.length - 1] !== n) nomes.push(n);
        });
        var fim = b.volta ? 'volta ao depósito' : 'fim da rota';
        var sem = b.semPosicao.length ? ' (+' + plural(b.semPosicao.length, 'entrega sem posição no mapa', 'entregas sem posição no mapa') + ')' : '';
        if (!nomes.length) return 'só entregas sem posição no mapa' + sem;
        for (var k = nomes.length; k >= 1; k--) {
            var seq = k === nomes.length ? nomes : nomes.slice(0, k - 1).concat(['…', nomes[nomes.length - 1]]);
            if (k === 1) seq = ['…', nomes[nomes.length - 1]];
            var s = seq.join(' → ') + ' → ' + fim + sem;
            if (s.length <= max || k === 1) return s;
        }
    }
    function montarChefe(d, agora, opts) {
        opts = opts || {};
        var hoje = core.diaSP(agora), data = dataLonga(hoje), pl = planoRota(d, hoje);
        if (pl.semSaida) return { vazio: 'sem saída hoje (' + (pl.feriado ? 'feriado' : 'domingo/dia sem saída') + ')', texto: 'Rota sugerida — ' + data + ': sem saída hoje.', partes: [] };
        var blocos = pl.ordem.map(function (id) { return pl.veiculos[id]; });
        var portas = blocos.filter(function (b) { return !b.semSaida && !b.cd && (b.paradas.length + b.semPosicao.length) > 0; });
        var cds = blocos.filter(function (b) { return !b.semSaida && b.cd; });
        var multi = portas.length > 1, entregas = [], prio = 0, janela = 0, atrasos = 0, pedidosN = 0, cx = { cx: 0, pot: 0, desc: 0 };
        portas.forEach(function (b) {
            core.sequenciaDe(b).forEach(function (sp) {   // ordem de entrega (RF-4)
                entregas.push(entregaPorta(sp, multi ? b.nome : null));
                if (sp.prioridade) prio++;
                if (sp.janela) janela++;
            });
            atrasos += b.horario && b.horario.atrasos ? b.horario.atrasos : 0;
        });
        cds.forEach(function (b) { b.cd.carga.forEach(function (it) { entregas.push(entregaCd(it, b)); }); });
        blocos.forEach(function (b) {
            if (b.semSaida) return;
            pedidosN += b.pedidos.length;
            var s = somaCaixas(b.pedidos.map(function (x) { return x.v; })); cx.cx += s.cx; cx.pot += s.pot; cx.desc += s.desc;
        });
        // N mensagens rota_paradas (6 entregas cada); acima de PARTES_MAX-1 o resto fica só no painel (aviso na sugerida).
        var grupos = []; for (var i = 0; i < entregas.length; i += ENTREGAS_POR_PARTE) grupos.push(entregas.slice(i, i + ENTREGAS_POR_PARTE));
        var omitidas = 0;
        if (grupos.length > WA.PARTES_MAX - 1) grupos.splice(WA.PARTES_MAX - 1).forEach(function (g) { omitidas += g.length; });
        var partes = grupos.map(function (g, n) {
            var p = parte('rota_paradas', null, [data, (n + 1) + ' de ' + grupos.length].concat([0, 1, 2, 3, 4, 5].map(function (k) { return g[k] || '—'; })));
            p.entregas = g.length;   // estrutura (não vai para a Meta)
            return p;
        });
        // rota_sugerida (sempre a última)
        var L = WA.LIMITES.rota_sugerida, extra = [];
        if (omitidas) extra.push('+' + plural(omitidas, 'entrega', 'entregas') + ' só no painel');   // 1º: nunca cortado
        if (pl.aguardando.length) extra.push(plural(pl.aguardando.length, 'pedido aguardando', 'pedidos aguardando') + ' marcação');
        if (pl.fica.length) extra.push(plural(pl.fica.length, 'pedido fica', 'pedidos ficam') + ' para outro dia');
        var total = (pedidosN ? plural(pedidosN, 'pedido', 'pedidos') + ' · ' + plural(entregas.length, 'entrega', 'entregas') + ' · ' + cxCurto(cx) : 'nenhum pedido para sair') +
            (extra.length ? ' · ' + extra.join(' · ') : '');
        var linhas = blocos.map(function (b) {
            var nm = nomeVeiculo(b);
            if (b.semSaida) return nm + ': não sai hoje';
            if (!b.pedidos.length) return nm + ': nenhum pedido';
            if (b.cd) return nm + ': ' + plural(b.pedidos.length, 'pedido', 'pedidos') + ' · ' + plural(b.cd.carga.length, 'cliente', 'clientes');
            var np = b.paradas.length + b.semPosicao.length;
            return nm + ': ' + plural(b.pedidos.length, 'pedido', 'pedidos') + ' · ' + plural(np, 'parada', 'paradas') + (b.km ? ' · ~' + Math.round(b.km) + ' km' : '');
        });
        if (linhas.length > 3) linhas = linhas.slice(0, 2).concat([linhas.slice(2).join(' | ')]);
        while (linhas.length < 3) linhas.push('—');
        var ordem = !portas.length ? (cds.some(function (b) { return b.pedidos.length; }) ? 'nenhuma (só entrega no CEASA)' : 'nenhuma')
            : portas.map(function (b) {
                var max = Math.floor((L[5] - 3 * (portas.length - 1)) / portas.length) - (multi ? b.nome.length + 2 : 0);
                return (multi ? b.nome + ': ' : '') + trajeto(b, max);
            }).join(' | ');
        var pr = [];
        if (prio) pr.push(plural(prio, 'cliente com prioridade alta', 'clientes com prioridade alta'));
        if (janela) pr.push(janela + ' com horário fixo');
        if (atrasos) pr.push(plural(atrasos, 'entrega pode chegar fora do horário', 'entregas podem chegar fora do horário'));
        var estoura = pl.fica.filter(function (x) { return x.estoura; }).length;
        if (estoura) pr.push(plural(estoura, 'pedido que fica passa do prazo', 'pedidos que ficam passam do prazo'));
        partes.push(parte('rota_sugerida', opts.template, [data, total, linhas[0], linhas[1], linhas[2], ordem, pr.join(' · ') || 'nenhuma',
            linkPainel(opts.painelUrl, ABA_ROTAS) || 'abra o painel']));
        return { texto: textoDe(partes), partes: partes,
                 resumo: { entregas: entregas.length, pedidos: pedidosN, partesParadas: grupos.length, omitidas: omitidas, aguardando: pl.aguardando.length, fica: pl.fica.length } };
    }

    // ===================== 050: fechamento AUTOMÁTICO da rota do dia =====================
    // Chamado pela Edge Function whatsapp-rotinas a cada tique do pg_cron (042, */15), ANTES das rotinas. Fecha HOJE
    // com a previsão daquele momento (o MESMO plano da aba Rotas) se: a 050 existe, ninguém fechou nem reabriu, hoje tem
    // saída (domingo/feriado não) e já passou rota_config.hora_saida (SP). O banco confere de novo (rota_050_fechar_auto,
    // sob advisory lock: nunca fecha 2x). sb = cliente com a chave de serviço. Devolve { fechou, motivo?, pedidos? }.
    function fecharRotaAuto(sb, agora, tentativa) {
        tentativa = tentativa || 1;
        var hoje = core.diaSP(agora);
        return coletarRota(sb, agora).then(function (d) {
            if (!d.fechada050) return { fechou: false, motivo: 'sem_050' };
            if (!d.v2) return { fechou: false, motivo: 'sem_044' };
            if (d.fechadaLinha) {
                if (!d.fechada) return { fechou: false, motivo: 'reaberta' };
                var prop = core.propostaSeparando(d.pedidos, d.clientes, hoje, opcoesRota(d));
                if (!prop.adicoes.length) return { fechou: false, motivo: 'ja_fechada' };
                return sb.rpc('rota_054_incluir', { p_data: hoje, p_revisao: d.fechadaRev, p_ordem: prop.ordem }).then(function (r) {
                    if (r.error) {
                        if (String(r.error.code) === '40001' && tentativa < 3) return fecharRotaAuto(sb, agora, tentativa + 1);
                        throw erroDe(r);
                    }
                    return { fechou: false, motivo: 'ja_fechada', incluidos: Number(r.data && r.data.incluidos) || 0 };
                });
            }
            var min = minutosSP(agora);
            if (min == null || min < d.cfg.horaSaida) return { fechou: false, motivo: 'antes_da_hora' };
            var pl = planoRota(d, hoje);
            if (pl.semSaida) return { fechou: false, motivo: 'sem_saida' };
            var itens = core.itensDaRota(pl);
            return sb.rpc('rota_050_fechar_auto', { p_itens: itens }).then(function (r) {
                if (r.error) throw erroDe(r);
                var out = r.data || {};
                return out.fechou ? { fechou: true, pedidos: itens.length } : { fechou: false, motivo: out.motivo || 'recusado' };
            });
        });
    }

    // ===================== rotina inteira =====================
    // Coleta + monta. Não envia nem grava: quem chama decide (Edge Function: provedor + log; painel: só mostra).
    function gerar(sb, codigo, agora, opts) {
        opts = opts || {};
        if (codigo === 'receber_diario') return coletarReceber(sb).then(function (d) { return montarReceber(d, agora, opts); });
        if (codigo === 'pedidos_dia') return coletarPedidosDia(sb, agora).then(function (d) { return montarPedidosDia(d, agora, opts); });
        // rota_chefe ANTES de veiculoDaRotina (que já recusa 'chefe'): mesma coleta da rota de cada veículo.
        if (codigo === 'rota_chefe') return coletarRota(sb, agora).then(function (d) { return montarChefe(d, agora, opts); });
        var vr = veiculoDaRotina(codigo);
        if (vr) return coletarRota(sb, agora).then(function (d) { return montarRota(d, vr, agora, opts); });
        if (codigo === 'alertas_marcio') return coletarAlertas(sb, agora).then(function (d) { return montarAlertas(d, agora, opts); });
        return Promise.reject(new Error('rotina desconhecida: ' + codigo));
    }
    // Papel x rotina (W1; mesma regra do gatilho da 042): financeiro e alertas SÓ gestor; rotas entregador ou gestor.
    // 049: pedidos_dia (valores) e rota_chefe (endereços e a rota de todos os veículos) SÓ gestor (= gatilho da 049).
    var PAPEIS = { receber_diario: ['gestor'], alertas_marcio: ['gestor'], rota_s10: ['entregador', 'gestor'], rota_caminhao: ['entregador', 'gestor'],
                   pedidos_dia: ['gestor'], rota_chefe: ['gestor'] };
    // 047: toda rota_<veículo> = entregador ou gestor (mesma regra do gatilho whatsapp_042_rotina_validar trocado na 047).
    function papelPermitido(codigo, papel) { return (PAPEIS[codigo] || (veiculoDaRotina(codigo) ? PAPEIS.rota_s10 : [])).indexOf(papel) >= 0; }
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
        coletarReceber: coletarReceber, coletarRota: coletarRota, coletarAlertas: coletarAlertas, coletarPedidosDia: coletarPedidosDia,
        montarReceber: montarReceber, montarRota: montarRota, montarAlertas: montarAlertas, montarPedidosDia: montarPedidosDia, montarChefe: montarChefe, fecharRotaAuto: fecharRotaAuto, gerar: gerar,
        filtrarDestinatarios: filtrarDestinatarios, papelPermitido: papelPermitido, PAPEIS: PAPEIS, MODELOS: MODELOS, renderizar: renderizar,
        empacotar: empacotar, COLETORES: COLETORES, linkPainel: linkPainel, linhasDeLog: linhasDeLog, corpoLog: corpoLog, MARCA_RESUMO: MARCA_RESUMO,
        nomeCurto: nomeCurto, corte: corte, rotinaConhecida: rotinaConhecida, veiculoDaRotina: veiculoDaRotina };
    raiz.TempRioWhatsCore = WhatsCore;
    if (typeof module !== 'undefined' && module.exports) module.exports = WhatsCore;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
