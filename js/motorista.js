/* =====================================================================
 * TELA DO MOTORISTA (motorista.html) — v2 (051/052): direta, com mapa e "Próximo ponto".
 * Login do Supabase (e-mail/senha). O motorista NÃO é da equipe do painel: lê só a rota publicada (rota_saida) do veículo
 * dele, de hoje e amanhã (047), o progresso da versão atual (051) e as caixas de cada pedido da rota
 * (rota_051_pedidos_motorista, sem valores). Grava SÓ: parada feita/desfeita (rota_051_marcar com data, veículo e versão
 * originais) e foto do canhoto (bucket privado, 052, com preflight de contexto).
 * Sem internet: marcação e foto vão para uma FILA no aparelho (IndexedDB; sem ele, memória da página com aviso explícito)
 * e sobem quando a internet volta. Recusas de dia antigo (P5101), veículo divergente (P5102), versão divergente (P5103) ou
 * contexto ausente (P5104) NUNCA apagam a pendência: ficam retidas no aparelho para conferência/exportação, sem aplicar
 * em outra rota/cliente.
 * Texto vindo do banco sempre por esc()/textContent. Mapa: Leaflet (opcional: sem ele, a lista funciona igual).
 * ===================================================================== */
(function () {
    'use strict';
    var cfg = (typeof siteConfig !== 'undefined' && siteConfig.supabase) || {};
    var TZ = 'America/Sao_Paulo';
    var DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    var NUM = new Intl.NumberFormat('pt-BR');
    // geracao: sobe a cada saída/troca de sessão; mut: sobe a cada mutação confirmada no servidor (MOT-3).
    var sb = null, _rotas = [], _veiculo = null, st = {
        dia: null, carregando: false, ultimaCarga: null, geracao: 0, usuario: null,
        progresso: {}, tem051: false, cx: {}, canhotos: {}, tem052: false,
        fila: [], enviando: false, promEnvio: null, aviso: '', mapa: null, foco: null,
        mut: 0, confirmados: {}, confirmadosCanhoto: {}, ack: {}, expurgarIds: [], volatil: false, exportUrl: null,
        ctxAnterior: null
    };
    Object.defineProperty(st, 'rotas', {
        enumerable: true,
        get: function () { return _rotas; },
        set: function (novas) {
            var arr = Array.isArray(novas) ? novas : [];
            if (!arr.length) {
                st.ctxAnterior = null;
            } else if (_rotas && _rotas.length && !st.ctxAnterior) {
                var r0 = _rotas[0], r1 = arr[0];
                if (!r1 || r0.data !== r1.data || r0.veiculo_id !== r1.veiculo_id || Number(r0.versao) !== Number(r1.versao) || r0.paradas !== r1.paradas) {
                    st.ctxAnterior = { rotas: _rotas.slice(), veiculo: _veiculo, dia: st.dia, usuario: st.usuario };
                }
            }
            _rotas = arr;
        }
    });
    Object.defineProperty(st, 'veiculo', {
        enumerable: true,
        get: function () { return _veiculo; },
        set: function (novo) {
            if (!novo) {
                st.ctxAnterior = null;
            } else if (_veiculo && _veiculo.id && novo.id && _veiculo.id !== novo.id && _rotas && _rotas.length && !st.ctxAnterior) {
                st.ctxAnterior = { rotas: _rotas.slice(), veiculo: _veiculo, dia: st.dia, usuario: st.usuario };
            }
            _veiculo = novo;
        }
    });
    function $(q) { return document.querySelector(q); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function hojeSP() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).slice(0, 10); }
    function diaTxt(d) { var dt = new Date(d + 'T12:00:00Z'); return DIAS[dt.getUTCDay()] + ', ' + d.slice(8, 10) + '/' + d.slice(5, 7); }
    function horaCurta(iso) { var d = iso ? new Date(iso) : null; return d && !isNaN(d.getTime()) ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : ''; }
    function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
    function txtCaixas(o, curto) {
        var p = [];
        if (num(o.c24)) p.push('<strong>' + NUM.format(num(o.c24)) + '</strong> cx24');
        if (num(o.c48)) p.push('<strong>' + NUM.format(num(o.c48)) + '</strong> cx48');
        if (num(o.avulsos)) p.push('<strong>' + NUM.format(num(o.avulsos)) + '</strong> ' + (curto ? 'potes' : 'potes avulsos'));
        return p.join(' + ') || 'caixas a conferir';
    }
    function temPos(p) { return p && p.lat != null && p.lng != null && isFinite(Number(p.lat)) && isFinite(Number(p.lng)); }
    function pedidosDa(p) {   // números dos pedidos da parada (porta: p.pedidos; CD: itens[].pedidos)
        var out = [], vistos = Object.create(null);
        function add(n) { var v = Number(n); if (isFinite(v) && v > 0 && Math.floor(v) === v && !vistos[v]) { vistos[v] = true; out.push(v); } }
        (Array.isArray(p && p.pedidos) ? p.pedidos : []).forEach(add);
        (Array.isArray(p && p.itens) ? p.itens : []).forEach(function (it) { (Array.isArray(it && it.pedidos) ? it.pedidos : []).forEach(add); });
        return out;
    }
    function chaveProg(data, veic, versao, ordem) {
        return String(data || '').slice(0, 10) + '|' + String(veic || '') + '|' + Number(versao || 0) + '|' + Number(ordem);
    }

    // ===================== sequência monotônica e tombstones (MOT-4) =====================
    var seqOp = Date.now() * 100, CHAVE_ACK = 'temprio-motorista-ack';
    function proximoSeq() {
        var agora = Date.now() * 100;
        seqOp = agora > seqOp ? agora : seqOp + 1;
        return seqOp;
    }
    function carregarAckLocal() {
        try {
            var bruto = typeof localStorage !== 'undefined' ? localStorage.getItem(CHAVE_ACK) : null;
            var obj = bruto ? JSON.parse(bruto) : null;
            if (obj && typeof obj === 'object') Object.keys(obj).forEach(function (k) { st.ack[k] = obj[k]; });
        } catch (e) { /* storage restrito */ }
    }
    function gravarAck(chave, seq, opId) {
        if (chave && seq) st.ack[chave] = Math.max(Number(st.ack[chave] || 0), Number(seq));
        if (opId != null) st.ack['id:' + opId] = true;
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(CHAVE_ACK, JSON.stringify(st.ack));
        } catch (e) { /* storage restrito */ }
    }

    // ===================== fila offline (IndexedDB; sem ele, memória com aviso) =====================
    var BANCO = 'temprio-motorista', LOJA = 'fila', idb = null, idbOk = true;
    function abrirIdb() {
        if (idb) return Promise.resolve(idb);
        if (!idbOk || typeof indexedDB === 'undefined') { idbOk = false; st.volatil = true; return Promise.resolve(null); }
        return new Promise(function (ok) {
            try {
                var r = indexedDB.open(BANCO, 1);
                r.onupgradeneeded = function () { r.result.createObjectStore(LOJA, { keyPath: 'id', autoIncrement: true }); };
                r.onsuccess = function () {
                    idb = r.result;
                    idb.onversionchange = function () { try { idb.close(); } catch (e) {} idb = null; };
                    ok(idb);
                };
                r.onerror = r.onblocked = function () { idbOk = false; st.volatil = true; ok(null); };
            } catch (e) { idbOk = false; st.volatil = true; ok(null); }
        });
    }
    function idbFazer(modo, fn) {
        return abrirIdb().then(function (db) {
            if (!db) return Promise.reject(new Error('IDB_INDISPONIVEL'));
            return new Promise(function (ok, falha) {
                try {
                    var tx = db.transaction(LOJA, modo), store = tx.objectStore(LOJA), req = fn(store);
                    var falhouReq = null;
                    if (req && typeof req === 'object' && 'onerror' in req) {
                        req.onerror = function (ev) { falhouReq = req.error || (ev && ev.target && ev.target.error) || new Error('IDB_REQ_ERRO'); };
                    }
                    tx.oncomplete = function () { if (falhouReq) falha(falhouReq); else ok(req ? req.result : true); };
                    tx.onerror = function () { falha(tx.error || falhouReq || new Error('IDB_TX_ERRO')); };
                    tx.onabort = function () { falha(tx.error || falhouReq || new Error('IDB_TX_ABORT')); };
                } catch (e) { falha(e); }
            });
        });
    }
    var memoria = [], seqMem = 0;

    // Saneia itens lidos do IDB: filtra tombstones (enviado: true) e operações antigas já superadas por ação mais recente
    // na mesma parada (MOT-4: impede replay de marcar antigo se o delete anterior tiver falhado).
    function sanearFilaLida(bruta) {
        carregarAckLocal();
        var lista = Array.isArray(bruta) ? bruta : [];
        var maxSeqParada = Object.create(null);
        var idsPresentes = Object.create(null);
        var idsAnulados = Object.create(null);
        lista.forEach(function (o) {
            if (!o || typeof o !== 'object') return;
            if (o.id != null) idsPresentes[o.id] = true;
            var s = Number(o.seq || 0);
            if (s > seqOp) seqOp = s;
            var ch = (o.data && o.veiculo && o.versao != null && o.ordem != null)
                ? (o.uid || '') + '|' + chaveProg(o.data, o.veiculo, o.versao, o.ordem) : '';
            if (ch && (o.tipo === 'marcar' || o.tipo === 'tombstone')) {
                if (s > (maxSeqParada[ch] || 0)) maxSeqParada[ch] = s;
            }
            if (o.enviado || o.tombstone || o.tipo === 'tombstone') {
                if (o.refId != null) { idsAnulados[o.refId] = true; st.ack['id:' + o.refId] = 1; }
                if (o.opId != null) { idsAnulados[o.opId] = true; }
                gravarAck(ch, s, o.opId || o.refId || o.id);
            }
        });
        var ativas = [];
        lista.forEach(function (o) {
            if (!o || typeof o !== 'object') return;
            var oid = o.opId || o.id;
            if (o.enviado || o.tombstone || o.tipo === 'tombstone' ||
                (o.id != null && (idsAnulados[o.id] || st.ack['id:' + o.id])) ||
                (oid != null && (idsAnulados[oid] || st.ack['id:' + oid]))) {
                // Se é um tombstone auxiliar (refId) cujo registro original ainda está preso no IDB, preserva o tombstone no IDB!
                var manterTombstone = (o.tipo === 'tombstone' && o.refId != null && idsPresentes[o.refId]);
                if (!manterTombstone && o.id != null && typeof o.id !== 'string' && st.expurgarIds.indexOf(o.id) < 0) {
                    st.expurgarIds.push(o.id);
                }
                return;
            }
            if (o.tipo === 'marcar' && o.data && o.veiculo && o.versao != null && o.ordem != null) {
                var ch = (o.uid || '') + '|' + chaveProg(o.data, o.veiculo, o.versao, o.ordem);
                var s = Number(o.seq || 0);
                var ackSeq = Number(st.ack[ch] || 0);
                var maxS = Number(maxSeqParada[ch] || 0);
                // Se já houve confirmação com seq >= s, ou outra operação mais nova (maxS > s) na mesma parada, descarta a antiga
                if ((ackSeq && s > 0 && s <= ackSeq) || (maxS && s > 0 && s < maxS)) {
                    if (o.id != null && typeof o.id !== 'string' && st.expurgarIds.indexOf(o.id) < 0) st.expurgarIds.push(o.id);
                    return;
                }
            }
            ativas.push(o);
        });
        // Mantém só a última operação não enviada por parada se houver mais de uma com mesmo seq
        var vistasParada = Object.create(null), final = [];
        for (var i = ativas.length - 1; i >= 0; i--) {
            var item = ativas[i];
            if (item.tipo === 'marcar' && !item.falhou && item.data && item.veiculo && item.versao != null && item.ordem != null) {
                var kp = (item.uid || '') + '|' + chaveProg(item.data, item.veiculo, item.versao, item.ordem);
                if (vistasParada[kp]) {
                    if (item.id != null && typeof item.id !== 'string' && st.expurgarIds.indexOf(item.id) < 0) st.expurgarIds.push(item.id);
                    continue;
                }
                vistasParada[kp] = true;
            }
            final.unshift(item);
        }
        return final;
    }

    function filaLer() {
        return idbFazer('readonly', function (s) { return s.getAll(); }).then(function (l) {
            var saneada = sanearFilaLida(l || []);
            var memAtiva = sanearFilaLida(memoria);
            return saneada.concat(memAtiva.filter(function (m) { return !saneada.some(function (x) { return x.id === m.id; }); }));
        }, function () {
            idbOk = false; st.volatil = true;
            return sanearFilaLida(memoria.slice());
        });
    }

    function filaPor(op) {
        if (!op.seq) op.seq = proximoSeq();
        if (!op.opId) op.opId = 'op_' + op.seq + '_' + Math.random().toString(36).slice(2, 7);
        // Se é uma nova marcação para a mesma parada/versão/veículo, substitui pendentes anteriores ainda não enviadas
        var idsSubstituidos = [];
        if (op.tipo === 'marcar' && op.data && op.veiculo && op.versao != null && op.ordem != null) {
            st.fila = st.fila.filter(function (x) {
                var mesmo = x !== op && x.uid === op.uid && x.tipo === 'marcar' && !x.falhou &&
                    x.data === op.data && x.veiculo === op.veiculo && Number(x.versao) === Number(op.versao) && Number(x.ordem) === Number(op.ordem);
                if (mesmo) {
                    if (x.id != null && typeof x.id !== 'string') idsSubstituidos.push(x.id);
                    memoria = memoria.filter(function (m) { return m !== x && m.id !== x.id; });
                    return false;
                }
                return true;
            });
        }
        var expurgadosOk = [];
        return idbFazer('readwrite', function (s) {
            st.expurgarIds.concat(idsSubstituidos).forEach(function (idAnt) {
                try { s.delete(idAnt); expurgadosOk.push(idAnt); } catch (e) {}
            });
            return s.add(op);
        }).then(function (id) {
            if (id == null) {
                idbOk = false; st.volatil = true;
                op.id = 'm' + (++seqMem); op.volatil = true; memoria.push(op);
            } else {
                op.id = id; op.volatil = false;
                st.expurgarIds = st.expurgarIds.filter(function (x) { return expurgadosOk.indexOf(x) < 0; });
            }
            return op;
        }, function () {
            idbOk = false; st.volatil = true;
            op.id = 'm' + (++seqMem); op.volatil = true; memoria.push(op);
            return op;
        });
    }

    // Confirma o envio de um item: registra ack/sequência e remove do IndexedDB.
    // Se o delete do IDB falhar (MOT-4), retenta e, se persistir a falha, grava tombstone no IDB (no próprio registro ou
    // em registro novo com autoIncrement) para que nunca seja reenviado ao recarregar.
    function filaConfirmarEnvio(o) {
        o.enviado = true; o.tombstone = true;
        var ch = o.tipo === 'marcar' && o.data && o.veiculo && o.versao != null && o.ordem != null
            ? (o.uid || '') + '|' + chaveProg(o.data, o.veiculo, o.versao, o.ordem) : '';
        gravarAck(ch, o.seq, o.opId || o.id);
        memoria = memoria.filter(function (x) { return x !== o && x.id !== o.id; });
        if (o.id == null || typeof o.id === 'string') return Promise.resolve();
        function tentarDelete() {
            var expOk = [];
            return idbFazer('readwrite', function (s) {
                st.expurgarIds.forEach(function (idAnt) {
                    try { s.delete(idAnt); expOk.push(idAnt); } catch (e) {}
                });
                return s.delete(o.id);
            }).then(function (res) {
                st.expurgarIds = st.expurgarIds.filter(function (x) { return expOk.indexOf(x) < 0; });
                return res;
            });
        }
        function gravarTombstoneIdb() {
            return idbFazer('readwrite', function (s) {
                return s.put(Object.assign({}, o, { enviado: true, tombstone: true }));
            }).catch(function () {
                // Se a chave o.id estiver bloqueada tanto para delete quanto para put, adiciona registro tombstone separado
                return idbFazer('readwrite', function (s) {
                    return s.add({
                        tipo: 'tombstone',
                        refId: o.id,
                        opId: o.opId,
                        uid: o.uid,
                        data: o.data,
                        veiculo: o.veiculo,
                        versao: o.versao,
                        ordem: o.ordem,
                        seq: o.seq,
                        enviado: true,
                        tombstone: true
                    });
                });
            }).catch(function () { /* registrado também em st.ack / localStorage e st.expurgarIds */ });
        }
        return tentarDelete().catch(function () {
            // 1ª falha de delete: retenta uma vez imediatamente
            return tentarDelete().catch(function () {
                if (st.expurgarIds.indexOf(o.id) < 0) st.expurgarIds.push(o.id);
                return gravarTombstoneIdb();
            });
        });
    }

    function filaTirar(id) {
        memoria = memoria.filter(function (o) { return o.id !== id; });
        if (id == null || typeof id === 'string') return Promise.resolve();
        return idbFazer('readwrite', function (s) { return s.delete(id); }).catch(function () {
            if (st.expurgarIds.indexOf(id) < 0) st.expurgarIds.push(id);
        });
    }
    function filaAtualizar(op) {
        if (op.id == null || typeof op.id === 'string') {
            op.volatil = true; st.volatil = true;
            return Promise.resolve();
        }
        return idbFazer('readwrite', function (s) { return s.put(op); }).catch(function () {
            op.volatil = true; st.volatil = true;
        });
    }
    function minhaFila() { return st.fila.filter(function (o) { return o && !o.enviado && !o.tombstone && o.uid === st.usuario; }); }

    // Progresso EFETIVO da rota r: só da mesma data + mesmo veículo + mesma versão (MOT-1).
    function feitoEfetivo(r) {
        var m = {};
        if (!r) return m;
        var dia = String(r.data || '').slice(0, 10);
        var vid = (st.veiculo && st.veiculo.id) || r.veiculo_id || '';
        var ver = Number(r.versao || 0);
        var pref = dia + '|' + vid + '|' + ver + '|';
        Object.keys(st.progresso).forEach(function (k) {
            if (k.indexOf(pref) === 0) m[k.slice(pref.length)] = st.progresso[k];
        });
        minhaFila().forEach(function (o) {
            if (o.tipo === 'marcar' && !o.falhou && o.data === dia && o.veiculo === vid && Number(o.versao) === ver) {
                if (o.feito) m[o.ordem] = m[o.ordem] || o.em; else delete m[o.ordem];
            }
        });
        return m;
    }
    function estadoCanhotoPedido(cd, r) {
        var n = Number(cd);
        if (st.canhotos[n]) return 'enviado';
        if (!r) return '';
        var dia = String(r.data || '').slice(0, 10);
        var vid = (st.veiculo && st.veiculo.id) || r.veiculo_id || '';
        var ver = Number(r.versao || 0);
        var item = minhaFila().filter(function (o) {
            return o.tipo === 'canhoto' && !o.falhou && o.data === dia && o.veiculo === vid && Number(o.versao) === ver && Array.isArray(o.cds) && o.cds.indexOf(n) >= 0;
        })[0];
        if (!item) return '';
        return item.volatil ? 'volatil' : 'fila';
    }
    function pendentesFila() { return minhaFila().filter(function (o) { return !o.falhou; }).length; }
    function retidosFila() { return minhaFila().filter(function (o) { return !!o.falhou; }); }

    function codigoErroDe(e, o) {
        var c = String((e && e.code) || '').toUpperCase();
        var m = String((e && e.message) || e || '');
        if (c === 'P5101' || /P5101|DIA_ANTIGO/i.test(m)) return 'P5101';
        if (c === 'P5102' || /P5102|VEICULO_DIVERGENTE/i.test(m)) return 'P5102';
        if (c === 'P5103' || /P5103|VERSAO_DIVERGENTE/i.test(m)) return 'P5103';
        if (c === 'P5104' || /P5104|CONTEXTO_AUSENTE/i.test(m)) return 'P5104';
        if (c === 'P5105' || /P5105|ARQUIVO_EXPIRADO/i.test(m)) return 'P5105';
        if (o && o.data && o.data < hojeSP() && (/22023/.test(c) || /so a rota de hoje|so canhoto de hoje/i.test(m))) return 'P5101';
        return c || String((e && (e.statusCode || e.status)) || 'ERRO');
    }
    function textoRetido(cod, e, o) {
        var rotulo = o.tipo === 'canhoto'
            ? 'Foto do canhoto (parada ' + (o.parada || o.ordem || '?') + (o.cds && o.cds.length ? ', #' + o.cds.slice(0, 3).join(', #') + (o.cds.length > 3 ? '…' : '') : '') + ')'
            : 'Marcação da parada ' + (o.ordem || '?') + (o.cliente ? ' (' + o.cliente + ')' : '');
        if (cod === 'P5101') return rotulo + ' é de dia anterior (' + (o.data || '') + '): preservada no celular sem apagar (P5101). Exporte ou mostre ao escritório.';
        if (cod === 'P5102') return rotulo + ' era do veículo "' + (o.veiculo || '?') + '" (vínculo atual mudou): não foi aplicada no veículo atual e ficou guardada para conferência (P5102).';
        if (cod === 'P5103') return rotulo + ' era da versão v' + (o.versao || '?') + ' (a rota foi republicada/alterada): não foi aplicada na versão nova para não marcar cliente errado e ficou guardada (P5103).';
        if (cod === 'P5104') return rotulo + ' está sem veículo/versão original: guardada para conferência sem aplicar na rota atual (P5104).';
        if (cod === 'P5105') return rotulo + ' está com caminho expirado/reservado pela retenção de 1 ano: preservada no celular sem apagar (P5105). Exporte para o escritório.';
        var det = String((e && e.message) || e || cod);
        return rotulo + ' não foi aceita pelo servidor (' + det + '). Continua guardada no celular: avise o escritório.';
    }

    // Valida contexto local antes de enviar (MOT-1): nunca envia sem veículo/versão originais nem quando vínculo, dia ou
    // versão já carregada na tela divergirem.
    function validarContextoLocal(o) {
        if (!o || !o.data || !o.veiculo || !(Number(o.versao) >= 1)) {
            var e4 = new Error('CONTEXTO_AUSENTE: veiculo e versao originais sao obrigatorios');
            e4.code = 'P5104'; return e4;
        }
        if (o.data < hojeSP()) {
            var e1 = new Error('DIA_ANTIGO: pendencia de outro dia; preserve para recuperacao no escritorio');
            e1.code = 'P5101'; return e1;
        }
        if (st.veiculo && st.veiculo.id && o.veiculo !== st.veiculo.id) {
            var e2 = new Error('VEICULO_DIVERGENTE: nao reenviar a pendencia na vinculacao atual');
            e2.code = 'P5102'; return e2;
        }
        if (st.rotas && st.rotas.length) {
            var rMesmoDia = st.rotas.filter(function (x) { return x.data === o.data && x.veiculo_id === o.veiculo; })[0];
            if (!rMesmoDia || Number(rMesmoDia.versao) !== Number(o.versao)) {
                var e3 = new Error('VERSAO_DIVERGENTE: rota substituida' + (rMesmoDia ? ' para v' + rMesmoDia.versao : ' ou retirada'));
                e3.code = 'P5103'; return e3;
            }
        }
        return null;
    }

    // Envia a fila, uma operação por vez. Erro de rede: para e tenta depois. Recusa do banco ou divergência de contexto
    // (P5101..P5105, 42501, 22023, P0002): NUNCA apaga a marcação nem a foto — preserva o item na fila com código/motivo
    // para recuperação ou exportação (MOT-1 / MOT-2).
    function enviarFila() {
        if (st.enviando) return st.promEnvio || Promise.resolve();
        if (!sb || navigator.onLine === false) return Promise.resolve();
        var g = st.geracao;
        if (!minhaFila().some(function (o) { return !o.falhou; })) return Promise.resolve();
        st.enviando = true; desenharStatus();
        function definitivo(e) {
            var c = String((e && e.code) || '').toUpperCase(), stCode = String((e && (e.statusCode || e.status)) || ''), m = String((e && e.message) || e || '');
            return /^(P5101|P5102|P5103|P5104|P5105|42501|22023|P0002|23514|PGRST202|42883)$/.test(c) || /^(400|403|413|415|422)$/.test(stCode) ||
                /DIA_ANTIGO|VEICULO_DIVERGENTE|VERSAO_DIVERGENTE|CONTEXTO_AUSENTE|ARQUIVO_EXPIRADO|row-level security|permissao|so o motorista|nao esta na sua rota|nao esta na rota|so a rota de hoje|so canhoto de hoje|mime|size|large|invalid/i.test(m);
        }
        function reterItem(o, e) {
            var cod = codigoErroDe(e, o);
            o.codigoErro = cod;
            o.falhou = textoRetido(cod, e, o);
            st.aviso = o.falhou;
            return filaAtualizar(o);
        }
        function proxima() {
            if (g !== st.geracao) { st.enviando = false; st.promEnvio = null; return Promise.resolve(); }
            var o = minhaFila().filter(function (x) { return !x.falhou; })[0];
            if (!o) { st.enviando = false; st.promEnvio = null; return Promise.resolve(); }
            var erroCtx = validarContextoLocal(o);
            if (erroCtx) {
                return reterItem(o, erroCtx).then(function () { return proxima(); });
            }
            var p;
            if (o.tipo === 'marcar') {
                p = sb.rpc('rota_051_marcar', {
                    p_data: o.data,
                    p_veiculo: o.veiculo,
                    p_versao: Number(o.versao),
                    p_ordem: Number(o.ordem),
                    p_feito: !!o.feito,
                    p_em: o.em
                }).then(function (r) { if (r && r.error) throw r.error; });
            } else {
                p = window.TempRioCanhoto.enviar(sb, o.blob, o.cds, {
                    caminho: o.caminho,
                    motorista: true,
                    veiculo: o.veiculo,
                    versao: Number(o.versao)
                });
            }
            return p.then(function () {
                if (g !== st.geracao) { st.enviando = false; st.promEnvio = null; return; }
                st.mut++;
                if (o.tipo === 'marcar') {
                    var kp = chaveProg(o.data, o.veiculo, o.versao, o.ordem);
                    if (o.feito) st.progresso[kp] = st.progresso[kp] || o.em; else delete st.progresso[kp];
                    st.confirmados[kp] = { mut: st.mut, feito: !!o.feito, em: o.em };
                } else {
                    (o.cds || []).forEach(function (cd) {
                        var n = Number(cd);
                        st.canhotos[n] = true;
                        st.confirmadosCanhoto[n] = { mut: st.mut };
                    });
                }
                st.fila = st.fila.filter(function (x) { return x !== o && x.id !== o.id; });
                return filaConfirmarEnvio(o).then(function () { return proxima(); });
            }, function (e) {
                if (g !== st.geracao) { st.enviando = false; st.promEnvio = null; return; }
                if (!definitivo(e)) { st.enviando = false; st.promEnvio = null; return; }   // rede/servidor fora: tenta depois, na mesma ordem
                return reterItem(o, e).then(function () { return proxima(); });
            });
        }
        var prom = proxima().then(function () {
            st.enviando = false; st.promEnvio = null;
            if (g === st.geracao) desenhar();
        }, function () {
            st.enviando = false; st.promEnvio = null;
        });
        st.promEnvio = prom;
        return prom;
    }

    // ===================== exportação / recuperação de pendências (MOT-2 / MOT-5) =====================
    function blobParaDataUrl(blob) {
        if (!blob || typeof FileReader === 'undefined') return Promise.resolve(null);
        return new Promise(function (ok) {
            try {
                var fr = new FileReader();
                fr.onload = function () { ok(fr.result || null); };
                fr.onerror = function () { ok(null); };
                fr.readAsDataURL(blob);
            } catch (e) { ok(null); }
        });
    }
    function exportarPendencias() {
        var itens = minhaFila();
        if (!itens.length) return Promise.resolve(null);
        return Promise.all(itens.map(function (o) {
            return blobParaDataUrl(o.blob).then(function (dataUrl) {
                return {
                    tipo: o.tipo,
                    data: o.data || null,
                    veiculo: o.veiculo || null,
                    versao: o.versao != null ? Number(o.versao) : null,
                    ordem: o.ordem != null ? Number(o.ordem) : (o.parada != null ? Number(o.parada) : null),
                    cliente: o.cliente || null,
                    feito: o.tipo === 'marcar' ? !!o.feito : undefined,
                    pedidos: o.cds || [],
                    caminho: o.caminho || null,
                    em: o.em || null,
                    codigoErro: o.codigoErro || null,
                    motivo: o.falhou || null,
                    volatil: !!o.volatil,
                    fotoDataUrl: dataUrl
                };
            });
        })).then(function (exportados) {
            var pacote = {
                exportado_em: new Date().toISOString(),
                usuario: st.usuario,
                veiculo_atual: st.veiculo ? st.veiculo.id : null,
                pendencias: exportados
            };
            var json = JSON.stringify(pacote, null, 2);
            window.__ultimaExportacao = pacote;
            try {
                if (st.exportUrl) URL.revokeObjectURL(st.exportUrl);
                var b = new Blob([json], { type: 'application/json;charset=utf-8' });
                st.exportUrl = URL.createObjectURL(b);
                var a = document.createElement('a');
                a.href = st.exportUrl;
                a.download = 'pendencias-motorista-' + hojeSP() + '.json';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            } catch (e) { /* ambiente sem download automático */ }
            st.aviso = 'Arquivo de recuperação preparado (' + NUM.format(exportados.length) + (exportados.length === 1 ? ' item' : ' itens') + '). Envie ao escritório.';
            desenharStatus();
            return pacote;
        });
    }
    function reenviarRetidos() {
        var ret = retidosFila();
        if (!ret.length) return Promise.resolve();
        st.aviso = '';
        return Promise.all(ret.map(function (o) {
            delete o.falhou;
            delete o.codigoErro;
            return filaAtualizar(o);
        })).then(function () {
            desenhar();
            return enviarFila();
        });
    }

    // ===================== estados =====================
    function mostrar(qual) {
        $('#mot-estado').hidden = qual !== 'estado';
        $('#mot-login').hidden = qual !== 'login';
        $('#mot-rota').hidden = qual !== 'rota';
        $('#mot-sair').hidden = qual === 'login' || !sb;
    }
    function estado(titulo, texto, acoes) {
        liberarMapa();
        var el = $('#mot-estado');
        mostrar('estado');
        var mostrarFila = !!(st.usuario && acoes && minhaFila().length);
        var htmlFila = mostrarFila ? htmlFilaStatus(true) : '';
        var blocoFila = mostrarFila
            ? '<div id="mot-fila-estado" class="mot-fila" role="status" aria-live="polite">' + htmlFila + '</div>'
            : '';
        el.innerHTML = '<p class="mot-estado-tit">' + esc(titulo) + '</p>' + (texto ? '<p class="mot-sub">' + esc(texto) + '</p>' : '') + blocoFila + (acoes || '');
        var b = el.querySelector('[data-mot-tentar]'); if (b) b.addEventListener('click', carregar);
        var s = el.querySelector('[data-mot-sair]'); if (s) s.addEventListener('click', sair);
        var be = el.querySelector('#mot-fila-exportar'); if (be) be.addEventListener('click', exportarPendencias);
        var br = el.querySelector('#mot-fila-reenviar'); if (br) br.addEventListener('click', reenviarRetidos);
    }
    function rede() { $('#mot-rede').hidden = navigator.onLine !== false; }
    function liberarMapa() { if (st.mapa) { try { st.mapa.remove(); } catch (e) { /* já saiu */ } st.mapa = null; } }
    // Esquece TUDO da sessão anterior (a fila no aparelho é por usuário: só a do usuário logado é enviada/mostrada).
    function limpar() {
        st.geracao++; st.rotas = []; st.veiculo = null; st.dia = null; st.carregando = false; st.ultimaCarga = null;
        st.progresso = {}; st.cx = {}; st.canhotos = {}; st.aviso = ''; st.enviando = false; st.promEnvio = null;
        st.mut = 0; st.confirmados = {}; st.confirmadosCanhoto = {};
        st.confirmaSair = false; st.abertos = {}; st.foco = null; st.ctxAnterior = null;
        if (st.exportUrl) { try { URL.revokeObjectURL(st.exportUrl); } catch (e) {} st.exportUrl = null; }
        liberarMapa(); $('#mot-rota').innerHTML = ''; $('#mot-estado').innerHTML = '';
    }

    // ===================== login =====================
    function telaLogin(msg) { mostrar('login'); $('#mot-login-msg').textContent = msg || ''; $('#mot-email').focus(); }
    function entrar(ev) {
        ev.preventDefault();
        var email = String($('#mot-email').value || '').trim(), senha = $('#mot-senha').value || '';
        var msg = $('#mot-login-msg');
        if (!email || !senha) { msg.textContent = 'Preencha e-mail e senha.'; (email ? $('#mot-senha') : $('#mot-email')).focus(); return; }
        if (navigator.onLine === false) { msg.textContent = 'Sem internet. Conecte e tente de novo.'; return; }
        var b = $('#mot-entrar'); b.disabled = true; b.textContent = 'Entrando…'; msg.textContent = '';
        sb.auth.signInWithPassword({ email: email, password: senha }).then(function (r) {
            b.disabled = false; b.textContent = 'Entrar';
            if (r.error) { msg.textContent = /invalid/i.test(String(r.error.message || '')) ? 'E-mail ou senha não conferem.' : 'Não foi possível entrar: ' + String(r.error.message || r.error); $('#mot-senha').focus(); return; }
            $('#mot-senha').value = '';
            var uid = r.data && r.data.session && r.data.session.user ? r.data.session.user.id : null;
            if (uid !== st.usuario) limpar();
            st.usuario = uid;
            carregar();
        }, function (e) { b.disabled = false; b.textContent = 'Entrar'; msg.textContent = 'Não foi possível entrar: ' + String((e && e.message) || e); });
    }
    function sair() {
        if (!sb) return;
        if (minhaFila().length && !st.confirmaSair) {   // marcação/foto pendente ou retida: avisa na tela (sem confirm())
            st.confirmaSair = true; desenhar(); var c = $('#mot-sair-nao'); if (c) c.focus(); return;
        }
        st.confirmaSair = false;
        limpar();
        estado('Saindo…', '');
        var g = st.geracao;
        function falhou(m) {
            if (g !== st.geracao) return;
            estado('Não foi possível sair', 'Os dados da rota foram escondidos. Confira a internet e toque em Sair de novo. (' + m + ')',
                '<div class="mot-acoes"><button type="button" class="mot-botao" data-mot-sair>Sair</button><button type="button" class="mot-botao-leve" data-mot-tentar>Mostrar a rota de novo</button></div>');
        }
        sb.auth.signOut().then(function (r) {
            if (r && r.error) { falhou(String(r.error.message || r.error)); return; }
            st.usuario = null; limpar(); telaLogin('');
        }, function (e) { falhou(String((e && e.message) || e)); });
    }

    // ===================== leitura (coordenada com enviarFila: MOT-3) =====================
    function ausenteFn(e) { return !!e && /^(PGRST202|42883|PGRST205|42P01)$/.test(String(e.code || '')); }
    function carregar() {
        if (!sb || st.carregando) return Promise.resolve();
        var g = st.geracao;
        st.carregando = true;
        if (!st.rotas.length) estado('Carregando sua rota…', '');
        var esperaEnvio = st.enviando && st.promEnvio ? st.promEnvio.catch(function () {}) : Promise.resolve();
        return esperaEnvio.then(function () {
            if (g !== st.geracao) return null;
            return sb.rpc('rota_047_veiculo_motorista');
        }).then(function (r) {
            if (!r || g !== st.geracao) return null;
            if (r.error) throw r.error;
            if (!r.data) {
                var garantirFila = st.fila.length ? Promise.resolve(st.fila) : filaLer().then(function (lida) {
                    if (g === st.geracao && lida && lida.length && !st.fila.length) st.fila = lida;
                    return st.fila;
                });
                return garantirFila.then(function () {
                    if (g !== st.geracao) return null;
                    st.carregando = false;
                    estado('Seu login ainda não está ligado a um veículo', 'Peça ao escritório para vincular seu usuário a um veículo na Frota do painel. Depois toque em Tentar de novo.',
                        '<div class="mot-acoes"><button type="button" class="mot-botao" data-mot-tentar>Tentar de novo</button><button type="button" class="mot-botao-leve" data-mot-sair>Sair</button></div>');
                    return null;
                });
            }
            var vid = r.data, hoje = hojeSP(), amanha = new Date(Date.parse(hoje + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
            var mutAntes = st.mut;
            function opt(p) { return Promise.resolve(p).catch(function (e) { return { data: null, error: e }; }); }
            return Promise.all([
                sb.from('rota_saida').select('data,veiculo_id,versao,paradas,resumo,publicado_em').eq('veiculo_id', vid).order('data', { ascending: true }),
                opt(sb.from('rota_veiculos').select('id,nome,cor').eq('id', vid)),
                opt(sb.from('rota_saida_progresso').select('data,veiculo_id,versao,ordem,feito_em').eq('veiculo_id', vid)),
                opt(sb.rpc('rota_051_pedidos_motorista', { p_data: hoje })),
                opt(sb.rpc('rota_051_pedidos_motorista', { p_data: amanha })),
                opt(sb.rpc('rota_052_canhotos_motorista', { p_data: hoje })),
                filaLer()
            ]).then(function (rs) {
                if (g !== st.geracao) return;
                if (rs[0].error) throw rs[0].error;
                var v = rs[1] && !rs[1].error && rs[1].data && rs[1].data[0];
                st.veiculo = { id: vid, nome: v ? v.nome : vid, cor: v && /^#[0-9a-f]{6}$/i.test(v.cor || '') ? v.cor : null };
                st.rotas = (rs[0].data || []).filter(function (x) { return x && x.veiculo_id === vid && String(x.data) >= hoje; });
                var versaoPorDia = Object.create(null);
                st.rotas.forEach(function (rt) { versaoPorDia[String(rt.data).slice(0, 10)] = Number(rt.versao || 1); });

                // 051: só desliga se a tabela/função realmente não existir (PGRST205/42P01). Erro transitório preserva estado!
                if (rs[2] && rs[2].error) {
                    if (ausenteFn(rs[2].error)) { st.tem051 = false; st.progresso = {}; }
                } else if (rs[2]) {
                    st.tem051 = true;
                    var novoProg = {};
                    (rs[2].data || []).forEach(function (x) {
                        var diaX = String(x.data || '').slice(0, 10);
                        var verX = x.versao != null ? Number(x.versao) : (versaoPorDia[diaX] || 1);
                        if (verX > 0) novoProg[chaveProg(diaX, x.veiculo_id || vid, verX, x.ordem)] = x.feito_em;
                    });
                    // MOT-3: mutações confirmadas depois que esta leitura começou (mut > mutAntes) vencem o snapshot antigo
                    Object.keys(st.confirmados).forEach(function (k) {
                        var c = st.confirmados[k];
                        if (c && c.mut > mutAntes) {
                            if (c.feito) novoProg[k] = novoProg[k] || c.em; else delete novoProg[k];
                        }
                    });
                    st.progresso = novoProg;
                }

                if ((rs[3] && !rs[3].error) || (rs[4] && !rs[4].error)) {
                    var novoCx = Object.assign({}, st.cx);
                    [rs[3], rs[4]].forEach(function (r2) { if (r2 && !r2.error) (r2.data || []).forEach(function (x) { novoCx[Number(x.cd_pedido)] = x; }); });
                    st.cx = novoCx;
                }

                if (rs[5] && rs[5].error) {
                    if (ausenteFn(rs[5].error)) { st.tem052 = false; st.canhotos = {}; }
                } else if (rs[5]) {
                    st.tem052 = !!window.TempRioCanhoto;
                    var novosCan = {};
                    (rs[5].data || []).forEach(function (x) { novosCan[Number(typeof x === 'object' ? x.rota_052_canhotos_motorista || x.cd_pedido : x)] = true; });
                    Object.keys(st.confirmadosCanhoto).forEach(function (cd) {
                        var cc = st.confirmadosCanhoto[cd];
                        if (cc && cc.mut > mutAntes) novosCan[Number(cd)] = true;
                    });
                    st.canhotos = novosCan;
                }

                var lida = rs[6] || [], idsLidos = Object.create(null);
                lida.forEach(function (o) { if (o && o.id != null) idsLidos[o.id] = true; });
                var mesclada = lida.concat(st.fila.filter(function (o) { return o && !o.enviado && !o.tombstone && (o.id == null || !idsLidos[o.id]); }));
                st.fila = sanearFilaLida(mesclada);

                st.ultimaCarga = new Date();
                if (!st.dia || !st.rotas.some(function (x) { return x.data === st.dia; })) st.dia = st.rotas.length ? st.rotas[0].data : null;
                st.carregando = false;
                desenhar();
                return enviarFila();
            });
        }).catch(function (e) {
            if (g !== st.geracao) return;
            st.carregando = false;
            var cod = String((e && e.code) || ''), m = String((e && e.message) || e || '');
            if (/PGRST202|42883/.test(cod)) { estado('A tela do motorista ainda não está ligada', 'O escritório precisa terminar a instalação (migração 047).', '<div class="mot-acoes"><button type="button" class="mot-botao-leve" data-mot-sair>Sair</button></div>'); return; }
            if (/JWT|401|PGRST301/i.test(cod + ' ' + m)) { st.usuario = null; limpar(); telaLogin('Sua sessão expirou. Entre de novo.'); return; }
            if (st.rotas.length) { desenhar(); rede(); return; }   // mantém a última rota na tela
            estado(navigator.onLine === false ? 'Sem internet' : 'Não foi possível carregar a rota',
                navigator.onLine === false ? 'Conecte o celular à internet e toque em Tentar de novo.' : 'Tente de novo em instantes. Se continuar, avise o escritório. (' + m + ')',
                '<div class="mot-acoes"><button type="button" class="mot-botao" data-mot-tentar>Tentar de novo</button></div>');
        });
    }

    // ===================== desenho =====================
    function linkMaps(p) {
        var end = [p.endereco, p.bairro, p.cidade].filter(Boolean).join(', ');
        if (temPos(p)) return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(Number(p.lat) + ',' + Number(p.lng));
        return end ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(end) : '';
    }
    function linkWaze(p) {
        var end = [p.endereco, p.bairro, p.cidade].filter(Boolean).join(', ');
        if (temPos(p)) return 'https://waze.com/ul?ll=' + encodeURIComponent(Number(p.lat) + ',' + Number(p.lng)) + '&navigate=yes';
        return end ? 'https://waze.com/ul?q=' + encodeURIComponent(end) + '&navigate=yes' : '';
    }
    function htmlTel(p) {
        var tel = String((p && (p.telefone || p.tel || p.celular || p.fone)) || '').trim();
        if (!tel) return '';
        var limpo = tel.replace(/[^\d+]/g, '');
        return '<p class="mot-tel">Telefone: ' + (limpo.length >= 8 ? '<a href="tel:' + esc(limpo) + '">' + esc(tel) + '</a>' : esc(tel)) + '</p>';
    }
    function rotaAtual() { return st.rotas.filter(function (x) { return x.data === st.dia; })[0] || st.rotas[0]; }
    function paradasDe(r) { return (Array.isArray(r && r.paradas) ? r.paradas.slice() : []).sort(function (a, b) { return num(a.ordem) - num(b.ordem); }); }
    function podeMarcar(r) { return !!r && st.tem051 && r.data === hojeSP(); }
    function attrsFotoInput(r, p, cdUnico) {
        var vid = (st.veiculo && st.veiculo.id) || (r && r.veiculo_id) || '';
        var ver = r && r.versao != null ? Number(r.versao) : '';
        var dia = (r && r.data) || '';
        var cds = cdUnico ? [Number(cdUnico)] : (p ? pedidosDa(p) : []);
        return 'data-mot-foto data-ordem="' + esc(p ? p.ordem : '') + '"' +
            (cdUnico ? ' data-cd="' + esc(cdUnico) + '"' : '') +
            ' data-dia="' + esc(dia) + '"' +
            ' data-veiculo="' + esc(vid) + '"' +
            ' data-versao="' + esc(ver) + '"' +
            ' data-cliente="' + esc((p && p.nome) || '') + '"' +
            ' data-cds="' + esc(cds.join(',')) + '"';
    }

    function htmlProximo(r, paradas, feitos) {
        var hoje = r.data === hojeSP();
        var idx = -1;
        for (var i = 0; i < paradas.length; i++) if (!feitos[paradas[i].ordem]) { idx = i; break; }
        var nFeitas = paradas.filter(function (p) { return feitos[p.ordem]; }).length;
        var ultimo = null;   // "Desfazer" = a parada feita mais recente (pela hora do toque)
        paradas.forEach(function (p) { if (feitos[p.ordem] && (!ultimo || String(feitos[p.ordem]) >= String(feitos[ultimo.ordem]))) ultimo = p; });
        var desfazer = podeMarcar(r) && ultimo ? '<button type="button" class="mot-botao-leve mot-desfazer" id="mot-desfazer" data-ordem="' + esc(ultimo.ordem) + '">Desfazer parada ' + esc(ultimo.ordem) + '</button>' : '';
        if (idx < 0) {
            return '<section class="mot-proximo is-fim" aria-labelledby="mot-prox-tit"><p class="mot-etapa">' + (hoje ? 'Todas as paradas feitas' : 'Rota de amanhã') + '</p>' +
                '<h2 class="mot-prox-nome mot-nome" id="mot-prox-tit" tabindex="-1">' + (hoje ? 'Rota concluída' : 'Confira as paradas abaixo') + '</h2>' +
                '<p class="mot-sub">' + NUM.format(nFeitas) + ' de ' + NUM.format(paradas.length) + ' paradas feitas.</p>' + (desfazer ? '<div class="mot-acoes">' + desfazer + '</div>' : '') + '</section>';
        }
        var p = paradas[idx], gm = linkMaps(p), wz = linkWaze(p);
        var end = [p.endereco, [p.bairro, p.cidade].filter(Boolean).join(' · ')].filter(Boolean);
        var avisos = [];
        if (p.prioridade) avisos.push('<li class="is-atencao">Entregar primeiro</li>');
        if (p.janela) avisos.push('<li class="is-atencao">Recebe ' + esc(p.janela) + '</li>');
        var cds = pedidosDa(p), temFoto = cds.length && cds.every(function (cd) { return st.canhotos[cd]; });
        var vid = (st.veiculo && st.veiculo.id) || r.veiculo_id, ver = Number(r.versao);
        var itemFilaFoto = minhaFila().filter(function (o) { return o.tipo === 'canhoto' && !o.falhou && o.parada === p.ordem && o.data === r.data && o.veiculo === vid && Number(o.versao) === ver; })[0];
        var txtBtnFoto = temFoto
            ? '✓ Canhoto enviado · nova foto'
            : itemFilaFoto
                ? (itemFilaFoto.volatil ? '⚠ Foto só na memória (não recarregue)' : '✓ Foto guardada (envia com internet)')
                : 'Foto do canhoto';
        var foto = podeMarcar(r) && st.tem052 && cds.length
            ? '<label class="mot-botao-leve mot-foto" for="mot-foto-in"><span>' + txtBtnFoto + '</span>' +
              '<input type="file" id="mot-foto-in" class="sr-only" accept="image/*" capture="environment" ' + attrsFotoInput(r, p, 0) + '></label>'
            : '';
        return '<section class="mot-proximo" aria-labelledby="mot-prox-tit">' +
            '<p class="mot-etapa">' + (hoje ? 'Parada ' + NUM.format(idx + 1) + ' de ' + NUM.format(paradas.length) : 'Amanhã · parada ' + NUM.format(idx + 1) + ' de ' + NUM.format(paradas.length)) +
                (p.eta ? ' · chegada ~' + esc(p.eta) : '') + '</p>' +
            '<h2 class="mot-prox-nome mot-nome" id="mot-prox-tit" tabindex="-1"><span class="mot-num-mini" aria-hidden="true">' + esc(p.ordem) + '</span><span>' + esc(p.nome || 'Cliente') + '</span></h2>' +
            (end.length ? '<p class="mot-end">' + end.map(esc).join('<br>') + '</p>' : '') +
            htmlTel(p) +
            (temPos(p) ? '' : '<p class="mot-aviso-pino">Sem pino no mapa: a navegação usa o endereço.</p>') +
            '<p class="mot-cx">' + txtCaixas(p) + '</p>' +
            (avisos.length ? '<ul class="mot-avisos">' + avisos.join('') + '</ul>' : '') +
            (p.obs ? '<p class="mot-obs">' + esc(p.obs) + '</p>' : '') +
            '<div class="mot-acoes mot-acoes-prox">' +
                (gm ? '<a class="mot-botao mot-ir" href="' + esc(gm) + '" target="_blank" rel="noopener noreferrer">Ir (Maps)</a>' : '') +
                (wz ? '<a class="mot-botao-leve" href="' + esc(wz) + '" target="_blank" rel="noopener noreferrer">Waze</a>' : '') +
            '</div>' +
            (podeMarcar(r) ? '<button type="button" class="mot-botao mot-proximo-btn" id="mot-proximo" data-ordem="' + esc(p.ordem) + '">Próximo ponto ›<span class="sr-only"> (marca a parada ' + esc(p.ordem) + ' como feita)</span></button>' : '') +
            (foto || desfazer ? '<div class="mot-acoes">' + foto + desfazer + '</div>' : '') +
            '</section>';
    }
    function htmlSeloCanhoto(est) {
        if (est === 'enviado') return ' <span class="mot-ok" title="Canhoto enviado">✓ canhoto</span>';
        if (est === 'volatil') return ' <span class="mot-ok is-fila" title="Foto só na memória da aba">⚠ canhoto na memória</span>';
        if (est === 'fila') return ' <span class="mot-ok is-fila" title="Foto guardada no celular">✓ canhoto guardado</span>';
        return '';
    }
    function htmlDetalhe(p, feitos, r, ordemAtual) {
        var cds = pedidosDa(p);
        var itensComPedidos = Array.isArray(p.itens) && p.itens.some(function (it) { return Array.isArray(it.pedidos) && it.pedidos.length; });
        var podeFoto = podeMarcar(r) && st.tem052;
        var linhas = !itensComPedidos ? cds.map(function (cd) {
            var c = st.cx[cd];
            var cx = c
                ? [num(c.caixas_24) ? NUM.format(num(c.caixas_24)) + ' cx24' : '', num(c.caixas_48) ? NUM.format(num(c.caixas_48)) + ' cx48' : '', num(c.caixas_outras) ? NUM.format(num(c.caixas_outras)) + ' outras' : ''].filter(Boolean).join(' + ') || 'sem caixas no ERP'
                : (cds.length === 1 && !p.cd ? [num(p.c24) ? NUM.format(num(p.c24)) + ' cx24' : '', num(p.c48) ? NUM.format(num(p.c48)) + ' cx48' : '', num(p.avulsos) ? NUM.format(num(p.avulsos)) + ' potes' : ''].filter(Boolean).join(' + ') : '');
            var estC = estadoCanhotoPedido(cd, r);
            var idIn = 'mot-foto-cd-' + esc(p.ordem) + '-' + esc(cd);
            var btnFoto = podeFoto
                ? '<label class="mot-botao-leve mot-foto mot-foto-ped" for="' + idIn + '"><span>' + (estC ? 'Nova foto' : 'Foto do canhoto') + '</span>' +
                  '<input type="file" id="' + idIn + '" class="sr-only" accept="image/*" capture="environment" ' + attrsFotoInput(r, p, cd) + '></label>'
                : '';
            return '<li class="mot-item-ped"><div class="mot-item-ped-info"><span><strong>Pedido #' + esc(cd) + '</strong>' + htmlSeloCanhoto(estC) + '</span>' +
                (cx ? '<span class="mot-item-ped-cx">' + esc(cx) + '</span>' : '') + '</div>' + btnFoto + '</li>';
        }).join('') : '';
        var itens = Array.isArray(p.itens) && p.itens.length
            ? '<ul class="mot-itens" aria-label="Carga por cliente">' + p.itens.map(function (it) {
                var peds = Array.isArray(it.pedidos) && it.pedidos.length
                    ? '<small class="mot-ped">' + it.pedidos.map(function (n) { return '#' + esc(n) + htmlSeloCanhoto(estadoCanhotoPedido(n, r)); }).join(', ') + '</small>'
                    : '';
                return '<li><span class="mot-item-cli"><span>' + esc(it.nome || 'Cliente') + '</span>' + peds + '</span><span>' +
                    [num(it.c24) ? NUM.format(num(it.c24)) + ' cx24' : '', num(it.c48) ? NUM.format(num(it.c48)) + ' cx48' : '', num(it.avulsos) ? NUM.format(num(it.avulsos)) + ' potes' : ''].filter(Boolean).join(' + ') + '</span></li>';
              }).join('') + '</ul>' : '';
        var feito = feitos[p.ordem], eAtual = ordemAtual != null && p.ordem === ordemAtual;
        var todosEnv = cds.length > 0 && cds.every(function (cd) { return estadoCanhotoPedido(cd, r) === 'enviado'; });
        var algumVol = !todosEnv && cds.some(function (cd) { return estadoCanhotoPedido(cd, r) === 'volatil'; });
        var algumFila = !todosEnv && !algumVol && cds.some(function (cd) { return estadoCanhotoPedido(cd, r) !== ''; });
        var end = [p.endereco, [p.bairro, p.cidade].filter(Boolean).join(' · ')].filter(Boolean);
        var gm = linkMaps(p), wz = linkWaze(p);
        var idFotoParada = 'mot-foto-par-' + esc(p.ordem);
        var btnFotoParada = podeFoto && cds.length && (itensComPedidos || cds.length > 1)
            ? '<label class="mot-botao-leve mot-foto" for="' + idFotoParada + '"><span>' + (todosEnv ? '✓ Canhoto da parada · nova foto' : 'Foto do canhoto da parada (' + NUM.format(cds.length) + ')') + '</span>' +
              '<input type="file" id="' + idFotoParada + '" class="sr-only" accept="image/*" capture="environment" ' + attrsFotoInput(r, p, 0) + '></label>'
            : '';
        return '<li class="mot-det mot-parada' + (feito ? ' is-feita' : '') + (eAtual ? ' is-atual' : '') + (p.cd ? ' is-cd' : '') + '"><details' + (st.abertos && st.abertos[p.ordem] ? ' open' : '') + ' data-mot-det="' + esc(p.ordem) + '">' +
            '<summary><span class="mot-num' + (feito ? ' is-feita' : '') + '" aria-hidden="true">' + (feito ? '✓' : esc(p.ordem)) + '</span>' +
            '<span class="mot-det-tit"><strong class="mot-nome">' + esc(p.nome || 'Cliente') + '</strong><small>' + (feito ? 'Feita às ' + esc(horaCurta(feito)) : (p.eta ? '~' + esc(p.eta) + ' · ' : '') + txtCaixas(p, true)) +
            (todosEnv ? ' · <span class="mot-ok">✓ canhoto</span>' : algumVol ? ' · <span class="mot-ok is-fila">⚠ canhoto na memória</span>' : algumFila ? ' · <span class="mot-ok is-fila">✓ canhoto guardado</span>' : '') + '</small></span></summary>' +
            '<div class="mot-det-corpo">' +
                (end.length ? '<p class="mot-end">' + end.map(esc).join('<br>') + '</p>' : '') +
                htmlTel(p) +
                '<p class="mot-cx">' + txtCaixas(p) + '</p>' +
                (p.prioridade ? '<p class="mot-ped is-atencao">Entregar primeiro</p>' : '') +
                (p.janela ? '<p class="mot-ped">Recebe ' + esc(p.janela) + '</p>' : '') +
                (p.obs ? '<p class="mot-obs">' + esc(p.obs) + '</p>' : '') +
                (!itensComPedidos && Array.isArray(p.pedidos) && p.pedidos.length ? '<p class="mot-ped">Pedidos: ' + p.pedidos.map(function (n) { return '#' + esc(n); }).join(', ') + '</p>' : '') +
                (linhas ? '<ul class="mot-itens" aria-label="Pedidos da parada">' + linhas + '</ul>' : '') + itens +
                (btnFotoParada || gm || wz ? '<div class="mot-acoes mot-acoes-det">' +
                    btnFotoParada +
                    (gm ? '<a class="mot-botao-leve" href="' + esc(gm) + '" target="_blank" rel="noopener noreferrer">Abrir no Maps</a>' : '') +
                    (wz ? '<a class="mot-botao-leve" href="' + esc(wz) + '" target="_blank" rel="noopener noreferrer">Waze</a>' : '') +
                '</div>' : '') +
            '</div></details></li>';
    }
    function htmlFilaStatus(forcarExportar) {
        var fila = minhaFila(), n = pendentesFila(), retidos = retidosFila();
        var nFotosFalhas = retidos.filter(function (o) { return o.tipo === 'canhoto'; }).length;
        var nMarcasFalhas = retidos.filter(function (o) { return o.tipo === 'marcar'; }).length;
        var temVolatil = !idbOk || st.volatil || fila.some(function (o) { return o.volatil; });
        if (!n && !retidos.length && !st.aviso && !temVolatil) return '';
        var partes = [];
        if (temVolatil) {
            partes.push('<p class="is-atencao">⚠ Armazenamento do celular indisponível (modo somente memória): as marcações e fotos feitas sem internet NÃO sobrevivem se recarregar ou fechar a página. Mantenha a aba aberta até conectar' + (fila.length ? ' ou exporte abaixo.' : '.') + '</p>');
        }
        if (n) {
            partes.push('<p>' + (st.enviando ? 'Enviando ' : (temVolatil ? 'Na memória desta aba: ' : 'Guardado no celular: ')) +
                NUM.format(n) + (n === 1 ? ' marcação/foto' : ' marcações/fotos') +
                (st.enviando ? '…' : (temVolatil ? ' (não recarregue a página antes de enviar).' : ' (envia quando a internet voltar).')) + '</p>');
        }
        if (nFotosFalhas) {
            partes.push('<p class="is-ruim">' + NUM.format(nFotosFalhas) + (nFotosFalhas === 1 ? ' foto não aceita' : ' fotos não aceitas') + ': continuam guardadas no celular. Exporte ou avise o escritório.</p>');
        }
        if (nMarcasFalhas) {
            partes.push('<p class="is-ruim">' + NUM.format(nMarcasFalhas) + (nMarcasFalhas === 1 ? ' marcação retida para conferência' : ' marcações retidas para conferência') + ' (não apagada).</p>');
        }
        if (st.aviso) {
            partes.push('<p class="is-ruim">' + esc(st.aviso) + '</p>');
        }
        if (retidos.length || (temVolatil && fila.length) || (forcarExportar && fila.length)) {
            partes.push('<div class="mot-acoes mot-acoes-fila">' +
                '<button type="button" class="mot-botao-leve" id="mot-fila-exportar">Exportar pendências (' + NUM.format(fila.length) + ')</button>' +
                (retidos.length ? '<button type="button" class="mot-botao-leve" id="mot-fila-reenviar">Tentar reenviar</button>' : '') +
            '</div>');
        }
        return partes.join('');
    }
    function desenharStatus() {
        var el = $('#mot-fila'); if (!el) return;
        var html = htmlFilaStatus(false);
        el.hidden = !html;
        el.innerHTML = html;
        var be = $('#mot-fila-exportar'); if (be) be.addEventListener('click', exportarPendencias);
        var br = $('#mot-fila-reenviar'); if (br) br.addEventListener('click', reenviarRetidos);
    }
    function lembrarFoco(alvo) {
        if (st.foco) return st.foco;
        var a = document.activeElement;
        if (!a || !alvo || !alvo.contains(a) || a === alvo) return null;
        if (a.id) return '#' + a.id;
        if (a.getAttribute('data-mot-dia')) return '[data-mot-dia="' + a.getAttribute('data-mot-dia') + '"]';
        if (a.tagName === 'SUMMARY' && a.parentElement && a.parentElement.getAttribute('data-mot-det')) {
            return '[data-mot-det="' + a.parentElement.getAttribute('data-mot-det') + '"] > summary';
        }
        return null;
    }
    function desenhar() {
        var alvo = $('#mot-rota'), v = st.veiculo || { nome: '' };
        var focoAlvo = lembrarFoco(alvo); st.foco = null; st.ctxAnterior = null;
        var hoje = hojeSP();
        liberarMapa();
        var veicHtml = '<span class="mot-veic"' + (v.cor ? ' style="--veic-cor:' + esc(v.cor) + '"' : '') + '><i aria-hidden="true"></i>' + esc(v.nome) + '</span>';
        var confSair = st.confirmaSair ? '<div class="mot-confirma" role="alertdialog" aria-labelledby="mot-conf-txt"><p id="mot-conf-txt">Ainda há marcação ou foto guardada no celular' + (!idbOk || st.volatil ? ' (só na memória desta aba — sair agora apagará esses dados)' : ' (se sair agora, ela só é enviada quando você entrar de novo)') + '.</p>' +
            '<div class="mot-acoes"><button type="button" class="mot-botao-leve" id="mot-sair-nao">Ficar</button><button type="button" class="mot-botao" id="mot-sair-sim">Sair assim mesmo</button></div></div>' : '';
        if (!st.rotas.length) {
            alvo.innerHTML = confSair + '<div class="mot-cab"><p class="mot-linha-topo">' + veicHtml + '</p><h1 class="mot-tit" id="mot-rota-tit">Nenhuma rota publicada para hoje</h1>' +
                '<p class="mot-sub">Quando o escritório enviar a rota, ela aparece aqui. Toque em Atualizar para conferir.</p></div>' +
                '<div id="mot-fila" class="mot-fila" role="status" aria-live="polite" hidden></div>' +
                '<div class="mot-acoes"><button type="button" class="mot-botao" id="mot-atualizar">Atualizar</button></div>';
            mostrar('rota'); desenharStatus(); ligar(); return;
        }
        var r = rotaAtual(), paradas = paradasDe(r), feitos = feitoEfetivo(r);
        var nFeitas = paradas.filter(function (p) { return feitos[p.ordem]; }).length;
        var proxParada = paradas.filter(function (p) { return !feitos[p.ordem]; })[0] || null;
        var ordemAtual = proxParada ? proxParada.ordem : null;
        var abas = st.rotas.length > 1
            ? '<div class="mot-dias" role="group" aria-label="Dia da rota">' + st.rotas.map(function (x) {
                return '<button type="button" data-mot-dia="' + esc(x.data) + '" aria-pressed="' + (x.data === r.data) + '">' + esc(x.data === hoje ? 'Hoje' : 'Amanhã') + ' · ' + esc(x.data.slice(8, 10) + '/' + x.data.slice(5, 7)) + '</button>';
              }).join('') + '</div>' : '';
        var semPino = paradas.filter(function (p) { return !temPos(p); });
        alvo.innerHTML = confSair +
            '<div class="mot-cab"><p class="mot-linha-topo">' + veicHtml + '<span>' + esc(diaTxt(r.data)) + '</span>' +
                (podeMarcar(r) ? '<span class="mot-progresso"><strong>' + NUM.format(nFeitas) + '</strong> de ' + NUM.format(paradas.length) + ' feitas</span>' : '') + '</p>' +
                '<h1 class="sr-only" id="mot-rota-tit">' + esc(r.data === hoje ? 'Rota de hoje' : 'Rota de amanhã') + '</h1></div>' +
            abas +
            '<div id="mot-fila" class="mot-fila" role="status" aria-live="polite" hidden></div>' +
            htmlProximo(r, paradas, feitos) +
            '<section class="mot-mapa-sec" aria-label="Mapa da rota"><div id="mot-mapa" class="mot-mapa" role="img" aria-label="Mapa com as paradas numeradas na ordem de entrega"></div>' +
                (semPino.length ? '<p class="mot-aviso-pino">' + NUM.format(semPino.length) + (semPino.length === 1 ? ' parada sem pino no mapa: ' : ' paradas sem pino no mapa: ') +
                    semPino.map(function (p) { return esc(p.ordem) + '. ' + esc(p.nome || 'Cliente'); }).join(' · ') + ' (use o endereço).</p>' : '') + '</section>' +
            '<section aria-labelledby="mot-lista-tit"><h2 class="mot-lista-tit" id="mot-lista-tit">Pedidos por parada</h2>' +
                '<ol class="mot-lista">' + paradas.map(function (p) { return htmlDetalhe(p, feitos, r, ordemAtual); }).join('') + '</ol></section>' +
            '<div class="mot-rodape"><button type="button" class="mot-botao-leve" id="mot-atualizar">Atualizar</button>' +
                '<span>Versão ' + esc(r.versao) + ', enviada às ' + esc(horaCurta(r.publicado_em)) + (st.ultimaCarga ? ' · carregado às ' + esc(st.ultimaCarga.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })) : '') + '</span></div>';
        mostrar('rota'); desenharStatus(); ligar(); desenharMapa(paradas, feitos);
        if (focoAlvo) { var f = $(focoAlvo); if (f) f.focus(); }
    }
    function desenharMapa(paradas, feitos) {
        var el = $('#mot-mapa'); if (!el) return;
        var pts = paradas.filter(temPos);
        if (typeof window.L === 'undefined' || !pts.length) {
            el.classList.add('is-vazio');
            el.innerHTML = '<p>' + (pts.length ? 'Mapa indisponível agora (sem internet?). A lista abaixo tem tudo.' : 'Nenhuma parada com pino no mapa.') + '</p>';
            return;
        }
        var idx = -1;
        for (var i = 0; i < paradas.length; i++) if (!feitos[paradas[i].ordem]) { idx = i; break; }
        var atual = idx >= 0 ? paradas[idx] : null;
        var m = L.map(el, { scrollWheelZoom: false, zoomControl: true, attributionControl: true });
        if (navigator.onLine !== false) {
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(m);
        }
        var ll = pts.map(function (p) { return [Number(p.lat), Number(p.lng)]; });
        if (ll.length > 1) L.polyline(ll, { color: '#f0915a', weight: 4, opacity: 0.85, interactive: false }).addTo(m);
        pts.forEach(function (p) {
            var feito = !!feitos[p.ordem], eAtual = atual && atual.ordem === p.ordem;
            var cls = 'mot-pino' + (feito ? ' is-feita' : '') + (eAtual ? ' is-atual' : '');
            L.marker([Number(p.lat), Number(p.lng)], { icon: L.divIcon({ className: 'mot-pino-ic', html: '<span class="' + cls + '">' + (feito ? '✓' : esc(p.ordem)) + '</span>', iconSize: eAtual ? [40, 40] : [30, 30], iconAnchor: eAtual ? [20, 20] : [15, 15] }),
                title: p.ordem + '. ' + (p.nome || 'Cliente') + (feito ? ' (feita)' : ''), keyboard: false, zIndexOffset: eAtual ? 1000 : 0 }).addTo(m);
        });
        try { m.fitBounds(ll, { padding: [28, 28], maxZoom: 15, animate: false }); } catch (e) { m.setView(ll[0], 13); }
        st.mapa = m;
    }

    // ===================== ações =====================
    function marcar(ordem, feito) {
        var r = rotaAtual(); if (!r || !podeMarcar(r)) return Promise.resolve();
        var vid = (st.veiculo && st.veiculo.id) || r.veiculo_id, ver = Number(r.versao);
        var p = paradasDe(r).filter(function (x) { return Number(x.ordem) === Number(ordem); })[0];
        var op = {
            tipo: 'marcar',
            uid: st.usuario,
            veiculo: vid,
            versao: ver,
            data: r.data,
            ordem: Number(ordem),
            cds: p ? pedidosDa(p) : [],
            cliente: (p && p.nome) || '',
            feito: !!feito,
            em: new Date().toISOString(),
            seq: proximoSeq()
        };
        st.aviso = '';
        return filaPor(op).then(function () {
            st.fila.push(op);
            desenhar();
            return enviarFila();
        });
    }
    function proximoPonto(btn) {
        var r = rotaAtual(), paradas = paradasDe(r), ordem = Number(btn.getAttribute('data-ordem'));
        var feitos = feitoEfetivo(r); feitos[ordem] = true;
        var prox = paradas.filter(function (p) { return !feitos[p.ordem]; })[0];
        // "já direcionando ao próximo ponto": abre a navegação NO PRÓPRIO toque (o navegador bloqueia janela aberta depois)
        var url = prox ? linkMaps(prox) : '';
        if (url) { try { window.open(url, '_blank', 'noopener'); } catch (e) { /* bloqueado: o botão Ir continua na tela */ } }
        st.foco = '#mot-prox-tit';
        marcar(ordem, true);
    }
    function capturarContextoFoto(input) {
        if (input && input.__ctxFoto) return input.__ctxFoto;
        var get = input && typeof input.getAttribute === 'function' ? function (k) { return input.getAttribute(k); } : function () { return null; };
        var ordem = Number(get('data-ordem') || 0);
        var cdUnico = Number(get('data-cd') || 0);
        var attrVer = get('data-versao'), attrDia = get('data-dia'), attrVeic = get('data-veiculo'), attrCds = get('data-cds'), attrCli = get('data-cliente');
        if (attrVer != null && attrVer !== '' && attrDia && attrVeic) {
            var listaCds = String(attrCds || '').split(',').map(Number).filter(function (n) { return isFinite(n) && n >= 1; });
            if (cdUnico) listaCds = listaCds.indexOf(cdUnico) >= 0 ? [cdUnico] : [cdUnico];
            return {
                uid: st.usuario,
                data: String(attrDia),
                veiculo: String(attrVeic),
                versao: Number(attrVer),
                ordem: ordem,
                cds: listaCds,
                cliente: String(attrCli || ''),
                cdUnico: cdUnico,
                pode: !!(st.tem052 && st.tem051)
            };
        }
        var snap = st.ctxAnterior;
        var rotasRef = snap && snap.rotas && snap.rotas.length ? snap.rotas : st.rotas;
        var diaRef = (snap && snap.dia) || st.dia;
        var veicRef = (snap && snap.veiculo) || st.veiculo;
        var r = (rotasRef || []).filter(function (x) { return x.data === diaRef; })[0] || (rotasRef && rotasRef[0]) || null;
        if (!r) return null;
        var vid = (veicRef && veicRef.id) || r.veiculo_id || '';
        var ver = Number(r.versao);
        var p = paradasDe(r).filter(function (x) { return Number(x.ordem) === ordem; })[0];
        var cdsParada = p ? pedidosDa(p) : [];
        var cds = cdUnico ? (cdsParada.indexOf(cdUnico) >= 0 ? [cdUnico] : []) : cdsParada;
        return {
            uid: (snap && snap.usuario) || st.usuario,
            data: r.data,
            veiculo: vid,
            versao: ver,
            ordem: ordem,
            cds: cds,
            cliente: (p && p.nome) || '',
            cdUnico: cdUnico,
            pode: !!(st.tem052 && st.tem051 && r.data === hojeSP())
        };
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        ['click', 'pointerdown', 'touchstart', 'focusin'].forEach(function (evName) {
            document.addEventListener(evName, function (ev) {
                var t = ev && ev.target;
                if (t && t.tagName === 'INPUT' && t.type === 'file' && t.getAttribute && t.getAttribute('data-ordem') && !t.__ctxFoto) {
                    t.__ctxFoto = capturarContextoFoto(t);
                }
            }, true);
        });
    }
    function fotoEscolhida(input) {
        var f = input && input.files && input.files[0];
        if (!f || !window.TempRioCanhoto) return;
        var ctx = capturarContextoFoto(input);
        if (!ctx || !ctx.pode) return;
        var cds = Array.isArray(ctx.cds) ? ctx.cds : [];
        if (!cds.length) {
            if (ctx.cdUnico) {
                st.aviso = 'O pedido #' + ctx.cdUnico + ' não pertence mais à parada ' + (ctx.ordem || '?') + '. Confira a rota atual antes de anexar a foto.';
                desenhar();
            }
            return;
        }
        var maxPeds = Number(window.TempRioCanhoto.MAX_PEDIDOS) || 15050;
        if (cds.length > maxPeds) {
            st.aviso = 'Esta parada tem ' + NUM.format(cds.length) + ' pedidos (limite por foto: ' + NUM.format(maxPeds) + '). Anexe por pedido.';
            desenhar();
            return;
        }
        var g = st.geracao, focoAlvo = input.id ? '#' + input.id : '#mot-foto-in';
        st.aviso = '';
        window.TempRioCanhoto.reduzir(f).then(function (blob) {
            if (g !== st.geracao) return;
            var op = {
                tipo: 'canhoto',
                uid: ctx.uid || st.usuario,
                veiculo: ctx.veiculo,
                versao: ctx.versao,
                data: ctx.data,
                parada: ctx.ordem,
                ordem: ctx.ordem,
                cliente: ctx.cliente || '',
                cds: cds,
                caminho: window.TempRioCanhoto.caminho(ctx.data, cds[0]),
                blob: blob,
                em: new Date().toISOString(),
                seq: proximoSeq()
            };
            var erroCtx = validarContextoLocal(op);
            if (erroCtx) {
                var cod = codigoErroDe(erroCtx, op);
                op.codigoErro = cod;
                op.falhou = textoRetido(cod, erroCtx, op);
                st.aviso = op.falhou;
            }
            return filaPor(op).then(function () {
                if (g !== st.geracao) return;
                st.fila.push(op);
                st.foco = focoAlvo;
                desenhar();
                return enviarFila();
            });
        }, function (e) { if (g !== st.geracao) return; st.aviso = String((e && e.message) || e); desenhar(); });
    }
    function ligar() {
        var a = $('#mot-atualizar'); if (a) a.addEventListener('click', function () { a.disabled = true; a.textContent = 'Atualizando…'; carregar(); });
        document.querySelectorAll('[data-mot-dia]').forEach(function (b) {
            b.addEventListener('click', function () { st.dia = b.getAttribute('data-mot-dia'); desenhar(); var n = document.querySelector('[data-mot-dia="' + st.dia + '"]'); if (n) n.focus(); });
        });
        var p = $('#mot-proximo'); if (p) p.addEventListener('click', function () { if (!p.disabled) { p.disabled = true; proximoPonto(p); } });
        var d = $('#mot-desfazer'); if (d) d.addEventListener('click', function () { st.foco = '#mot-prox-tit'; marcar(d.getAttribute('data-ordem'), false); });
        document.querySelectorAll('[data-mot-foto]').forEach(function (fi) {
            fi.__ctxFoto = capturarContextoFoto(fi);
            fi.addEventListener('click', function () { if (!fi.__ctxFoto) fi.__ctxFoto = capturarContextoFoto(fi); });
            fi.addEventListener('change', function () { fotoEscolhida(fi); });
        });
        document.querySelectorAll('[data-mot-det]').forEach(function (det) {
            var gDet = st.geracao;
            det.addEventListener('toggle', function () {
                if (gDet !== st.geracao || !det.isConnected) return;
                st.abertos = st.abertos || {};
                st.abertos[det.getAttribute('data-mot-det')] = det.open;
            });
        });
        var sn = $('#mot-sair-nao'); if (sn) sn.addEventListener('click', function () { st.confirmaSair = false; desenhar(); var s = $('#mot-sair'); if (s) s.focus(); });
        var ss = $('#mot-sair-sim'); if (ss) ss.addEventListener('click', sair);
    }

    // ===================== início =====================
    function iniciar() {
        rede();
        carregarAckLocal();
        filaLer().then(function (f) { if (f && f.length && !st.fila.length) st.fila = f; desenharStatus(); });
        window.addEventListener('online', function () {
            rede();
            enviarFila().then(function () { carregar(); });
        });
        window.addEventListener('offline', function () { rede(); desenharStatus(); });
        setInterval(function () { if (st.usuario && navigator.onLine !== false) enviarFila(); }, 30000);
        $('#mot-login').addEventListener('submit', entrar);
        $('#mot-sair').addEventListener('click', sair);
        if (!cfg.url || !cfg.anonKey || typeof window.supabase === 'undefined') {
            estado('Não foi possível abrir a tela', navigator.onLine === false ? 'Sem internet: conecte e recarregue a página.' : 'A biblioteca de login não carregou. Recarregue a página.');
            return;
        }
        sb = window.supabase.createClient(cfg.url, cfg.anonKey);
        sb.auth.onAuthStateChange(function (ev, sessao) {
            var uid = sessao && sessao.user ? sessao.user.id : null;
            if (ev === 'SIGNED_OUT' || !uid) { if (st.usuario || st.rotas.length) { st.usuario = null; limpar(); telaLogin(''); } return; }
            if (st.usuario && uid !== st.usuario) { limpar(); st.usuario = uid; carregar(); }
        });
        sb.auth.getSession().then(function (r) {
            if (r && r.data && r.data.session) { st.usuario = r.data.session.user ? r.data.session.user.id : null; carregar(); } else telaLogin('');
        }, function () { telaLogin(''); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
