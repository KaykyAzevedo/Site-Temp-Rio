/* =====================================================================
 * 068 D — Histórico de pedidos e canhotos em lote por dia (sobre 070).
 * Contrato congelado: docs/plans/2026-11-27-068D-r2-sobre-070-contrato.md
 * Consome exclusivamente as 5 RPCs 068D + Storage privado 'canhotos' (lote/).
 * ===================================================================== */
(function (raiz) {
    'use strict';

    var BUCKET = 'canhotos';
    var INICIO_HISTORICO = '2026-11-23';
    var PAGINA = 500;
    var MAX_LINHAS = 50000;
    var MAX_LOTE = 100;
    var MAX_BYTES_RAW = 20 * 1024 * 1024;
    var SIGNED_TTL_S = 300;
    var SIGNED_CACHE_MS = 285000;
    var TIPOS_IMG = ['image/jpeg', 'image/png', 'image/webp'];

    var MOTIVOS_LOTE = {
        parametro_invalido: 'Data ou lista de fotos inválida (envie 1 a 100 fotos entre 23/11/2026 e hoje).',
        arquivo_ausente: 'Uma ou mais fotos não foram encontradas no armazenamento. Tente registrar novamente.',
        arquivo_em_expurgo: 'Uma ou mais fotos estão em expurgo e não podem ser registradas.',
        arquivo_expirado: 'Uma ou mais fotos expiraram. Envie novamente.',
        arquivo_removido: 'Uma ou mais fotos foram removidas. Envie novamente.'
    };

    var caminhosArquivo = new WeakMap();
    var ouvintesGlobais = false;
    var timerVirada = null;
    var MARGEM_VIRADA_MS = 3000;

    function novoEstado() {
        return {
            alvo: null,
            sb: null,
            papel: null,
            podeMarcar: false,
            seq: 0,
            reqMes: 0,
            mes: '',
            diaFiltro: '',
            busca: '',
            diaCarregado: '',
            carregando: false,
            carregado: false,
            erro: '',
            ausente: false,
            linhas: [],
            semanaCarregando: false,
            semanaErro: '',
            semanaAberta: false,
            semanaLinhas: null,
            galerias: {},      // { [dia]: { aberta, carregando, erro, fotos: [] } }
            urls: {},          // { [caminho]: { url, ate } }
            vendo: {},         // { [caminho]: true }
            assinando: {},     // { [caminho]: true }
            confirmRem: '',    // caminho aguardando confirmacao inline de remocao (admin)
            removendo: {},     // { [caminho]: true }
            lotes: {},         // { [dia]: { ocupado, msg, erro, caminhosPendentes: [], arquivosFalhos: [] } }
            veic: {},          // 068V: { [cd_pedido]: { veiculo_efetivo, sem_veiculo } } (rota_068_veiculo_historico_ler)
            veicBusy: {},      // { [cd]: true } salvando
            veicMes: '',
            veicErro: false,
            veicMsg: {},       // { [cd]: { ok, texto } }
            uploadDia: ''      // dia escolhido no card superior "Enviar canhotos por dia"
        };
    }

    var st = novoEstado();

    function parteDAtiva() {
        return !raiz.TempRio068Partes || raiz.TempRio068Partes.D === true;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function norm(s) {
        return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    }

    function hojeSP(agora) {
        var d = agora ? new Date(agora) : new Date();
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(d).slice(0, 10);
    }

    function somaDiasISO(iso, delta) {
        var d = new Date(iso + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() + delta);
        return d.toISOString().slice(0, 10);
    }

    function minDiaUpload(hoje) {
        var lim = somaDiasISO(hoje, -365);
        return lim > INICIO_HISTORICO ? lim : INICIO_HISTORICO;
    }

    function diaUploadValido(dia, hoje) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia || ''))) return false;
        var h = hoje || hojeSP();
        return dia >= minDiaUpload(h) && dia <= h;
    }

    function dataBr(iso) {
        if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(String(iso))) return 'Não informado';
        var p = String(iso).slice(0, 10).split('-');
        return p[2] + '/' + p[1] + '/' + p[0];
    }

    function dataSemanaBr(iso) {
        if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(String(iso))) return 'Não informado';
        var d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
        var wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(d).replace(/\.$/, '');
        return wd + ', ' + dataBr(iso);
    }

    function horaSP(iso) {
        if (!iso || !isFinite(Date.parse(iso))) return '';
        return new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'
        }).format(new Date(iso));
    }

    function brl(centavos) {
        if (centavos == null || !isFinite(Number(centavos))) return 'Sem valor';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(centavos) / 100);
    }

    function urlSegura(u) {
        try {
            var parsed = new URL(String(u || ''));
            return /^https?:$/.test(parsed.protocol) ? parsed.href : null;
        } catch (e) { return null; }
    }

    function codigoAusente(err) {
        var c = String((err && err.code) || '');
        return /^(PGRST202|42883|42P01)$/.test(c);
    }

    function msgErroRpc(err, contexto) {
        var c = String((err && err.code) || '');
        if (codigoAusente(err)) return 'Histórico de pedidos (068D) ainda não está instalado neste banco.';
        if (c === '42501') return contexto === 'remover'
            ? 'Somente administradores podem remover canhotos.'
            : contexto === 'lote'
                ? 'Sem permissão para enviar canhotos em lote.'
                : 'Sem permissão para consultar o histórico de pedidos.';
        if (c === '22023') return 'Parâmetro inválido. Confira o mês ou a data informada.';
        return String((err && err.message) || err || 'Não foi possível concluir a operação.');
    }

    function mesesDisponiveis(hoje) {
        var h = hoje || hojeSP();
        var atual = h.slice(0, 7);
        var minMes = INICIO_HISTORICO.slice(0, 7);
        var lista = [];
        var ano = Number(atual.slice(0, 4)), mes = Number(atual.slice(5, 7));
        for (var i = 0; i < 48; i++) {
            var ym = String(ano) + '-' + (mes < 10 ? '0' + mes : String(mes));
            if (ym < minMes) break;
            lista.push(ym);
            mes--;
            if (mes < 1) { mes = 12; ano--; }
        }
        return lista.length ? lista : [atual];
    }

    function mesRotulo(ym) {
        if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) return String(ym || '');
        var d = new Date(ym + '-15T12:00:00Z');
        var nome = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
        return nome.charAt(0).toUpperCase() + nome.slice(1);
    }

    function valida(s, seq) {
        return st === s && s.seq === seq;
    }

    // ---- Camada de RPCs (contrato congelado 25e146b2) ----

    function lerHistoricoMes(sb, mes) {
        if (!sb) return Promise.reject(new Error('Sessão indisponível.'));
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes || ''))) {
            var inv = new Error('Mês inválido.'); inv.code = '22023'; return Promise.reject(inv);
        }
        var pMes = mes + '-01';
        var acumulado = [];
        function pagina(ini) {
            return Promise.resolve().then(function () {
                var q = sb.rpc('rota_068_historico', { p_mes: pMes });
                if (q && typeof q.order === 'function') {
                    q = q.order('dia', { ascending: false }).order('cd_pedido', { ascending: true, nullsFirst: false });
                }
                if (q && typeof q.range === 'function') {
                    q = q.range(ini, ini + PAGINA - 1);
                }
                return q;
            }).then(function (r) {
                if (!r || r.error) throw (r && r.error) || new Error('Falha ao ler histórico.');
                if (!Array.isArray(r.data)) throw new Error('Resposta inválida do histórico.');
                acumulado = acumulado.concat(r.data);
                if (r.data.length < PAGINA) return acumulado;
                if (acumulado.length >= MAX_LINHAS) {
                    var lim = new Error('Limite de leitura do histórico atingido; selecione outro período.');
                    lim.code = 'LIMITE_LEITURA';
                    throw lim;
                }
                return pagina(ini + PAGINA);
            });
        }
        return pagina(0);
    }

    function listarLoteDia(sb, dia) {
        if (!sb) return Promise.reject(new Error('Sessão indisponível.'));
        return Promise.resolve(sb.rpc('rota_068_lote_listar', { p_dia: dia })).then(function (r) {
            if (!r || r.error) throw (r && r.error) || new Error('Falha ao listar canhotos do dia.');
            if (!Array.isArray(r.data)) throw new Error('Resposta inválida ao listar canhotos.');
            return r.data;
        });
    }

    function registrarLoteDia(sb, dia, caminhos) {
        if (!sb) return Promise.reject(new Error('Sessão indisponível.'));
        if (!Array.isArray(caminhos) || !caminhos.length || caminhos.length > MAX_LOTE) {
            return Promise.reject(new Error(MOTIVOS_LOTE.parametro_invalido));
        }
        return Promise.resolve(sb.rpc('rota_068_lote_registrar', { p_dia: dia, p_caminhos: caminhos })).then(function (r) {
            if (!r || r.error) throw (r && r.error) || new Error('Falha ao registrar lote.');
            var d = r.data;
            if (!d || (d.status !== 'ok' && d.status !== 'erro')) {
                throw new Error('Resposta inválida ao registrar canhotos; atualize para conferir.');
            }
            if (d.status === 'erro') {
                var e = new Error(MOTIVOS_LOTE[d.motivo] || 'Não foi possível registrar o lote (' + d.motivo + ').');
                e.motivo = d.motivo;
                throw e;
            }
            return d;
        });
    }

    function removerFotoLote(sb, caminho) {
        if (!sb) return Promise.reject(new Error('Sessão indisponível.'));
        return Promise.resolve(sb.rpc('rota_068_lote_remover', { p_caminho: caminho })).then(function (r) {
            if (!r || r.error) throw (r && r.error) || new Error('Falha ao remover canhoto.');
            var d = r.data;
            if (!d || d.status !== 'ok') throw new Error('Resposta inválida ao remover canhoto.');
            if (d.pode_apagar === true) {
                return Promise.resolve(sb.storage.from(BUCKET).remove([caminho])).then(function (sr) {
                    return Object.assign({}, d, { storage_removido: !(sr && sr.error), storage_erro: sr && sr.error ? String(sr.error.message || sr.error) : '' });
                }, function (err) {
                    return Object.assign({}, d, { storage_removido: false, storage_erro: String((err && err.message) || err) });
                });
            }
            return d;
        });
    }

    // 068V: veículo efetivo de cada pedido do mês (lotes de 300). Falha = cartões sem seletor (não derruba o histórico).
    var VEIC_ROTULO = { caminhao: 'CEASA (caminhão)', s10: 'S10' };
    var MOTIVOS_VEIC = {
        motivo_invalido: 'Informe um motivo de 1 a 200 caracteres.',
        veiculo_invalido: 'Veículo inválido ou inativo.',
        pedido_nao_encontrado: 'Pedido não encontrado.',
        parametro_invalido: 'Parâmetro inválido.'
    };
    var MSG_VEIC = 'Não foi possível ler os veículos; tente atualizar.';
    var TIMEOUT_VEIC_MS = 20000;
    // Leitura atômica: erro/timeout de qualquer lote rejeita (nada é aplicado pela chamadora).
    function lerVeiculosHistorico(sb, cds) {
        var lotes = [];
        for (var i = 0; i < cds.length; i += 300) lotes.push(cds.slice(i, i + 300));
        function um(lote) {
            return new Promise(function (resolve, reject) {
                var t = setTimeout(function () { reject(new Error('timeout')); }, TIMEOUT_VEIC_MS);
                Promise.resolve().then(function () { return sb.rpc('rota_068_veiculo_historico_ler', { p_cds: lote }); }).then(function (r) {
                    clearTimeout(t);
                    if (!r || r.error || !Array.isArray(r.data)) reject((r && r.error) || new Error('resposta inválida'));
                    else resolve(r.data);
                }, function (e) { clearTimeout(t); reject(e); });
            });
        }
        return lotes.reduce(function (cadeia, lote) {
            return cadeia.then(function (acc) {
                return um(lote).then(function (linhas) {
                    linhas.forEach(function (x) { if (x && x.cd_pedido != null) acc[String(x.cd_pedido)] = x; });
                    return acc;
                });
            });
        }, Promise.resolve({}));
    }
    function trocarVeiculoHistorico(sb, cd, veiculo, motivo) {
        return Promise.resolve(sb.rpc('rota_068_veiculo_historico', { p_cd: Number(cd), p_veiculo: veiculo, p_motivo: motivo })).then(function (r) {
            if (!r || r.error) throw (r && r.error) || new Error('Falha ao trocar o veículo.');
            var d = r.data || {};
            if (d.status && d.status !== 'ok') { var e = new Error(MOTIVOS_VEIC[d.status] || String(d.status)); e.code = String(d.status); throw e; }
            return d;
        });
    }
    function salvarVeiculo(cd, veiculo, motivo) {
        if (!st.sb || !st.podeMarcar || st.veicBusy[cd]) return Promise.resolve();
        var s = st, seq = s.seq, req = s.reqMes;
        motivo = String(motivo || '').trim();
        if (!veiculo) { s.veicMsg[cd] = { ok: false, texto: 'Escolha o veículo.' }; redesenhar(); return Promise.resolve(); }
        if (!motivo || motivo.length > 200) { s.veicMsg[cd] = { ok: false, texto: 'Informe um motivo de 1 a 200 caracteres.' }; redesenhar(); return Promise.resolve(); }
        s.veicBusy[cd] = true; s.veicMsg[cd] = null; redesenhar();
        return trocarVeiculoHistorico(s.sb, cd, veiculo, motivo).then(function (d) {
            if (!valida(s, seq) || s.reqMes !== req) return;
            delete s.veicBusy[cd];
            var novo = d.veiculo_para || veiculo;
            s.veic[String(cd)] = { cd_pedido: cd, veiculo_id: novo, veiculo_efetivo: novo, sem_veiculo: false };
            s.veicMsg[cd] = { ok: true, texto: d.alterado === false ? 'Já estava neste veículo.' : 'Veículo atualizado.' };
            // Semana/rotas em cache ficam velhas: invalida (relê ao abrir) e avisa a Semana para reler veículos/entregas.
            s.semanaLinhas = null; s.semanaErro = '';
            if (s.semanaAberta) carregarRotasSemana();
            if (d.alterado !== false && typeof raiz.dispatchEvent === 'function' && typeof raiz.CustomEvent === 'function') {
                raiz.dispatchEvent(new raiz.CustomEvent('temprio-veiculo068h', { detail: { cd_pedido: Number(cd), veiculo: novo } }));
            }
            redesenhar();
        }, function (err) {
            if (!valida(s, seq) || s.reqMes !== req) return;
            delete s.veicBusy[cd];
            var c = String((err && err.code) || '');
            s.veicMsg[cd] = { ok: false, texto: c === '42501' ? 'Sem permissão para trocar o veículo.' : codigoAusente(err) ? 'Troca de veículo (068V) ainda não está instalada neste banco.' : (MOTIVOS_VEIC[c] || String((err && err.message) || 'Não foi possível trocar o veículo.')) };
            redesenhar();
        });
    }
    function htmlVeiculoHistorico(p) {
        var cd = String(p.cd_pedido), v = st.veic[cd];
        if (!v) return '';
        var efet = v.veiculo_efetivo || v.veiculo_id || '';
        var selo = v.sem_veiculo || !efet
            ? '<span class="rota-selo rota-selo-sem-veiculo" title="Nenhum veículo definido para este pedido"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>Sem veículo</span>'
            : '<span class="rota-selo"><i class="fa-solid fa-truck" aria-hidden="true"></i>' + esc(VEIC_ROTULO[efet] || efet) + '</span>';
        var msg = st.veicMsg[cd];
        var msgH = msg ? '<p class="text-xs ' + (msg.ok ? '' : 'adm-entrega-erro') + '" role="' + (msg.ok ? 'status' : 'alert') + '"' + (msg.ok ? ' style="color:var(--adm-tinta-2)"' : '') + '>' + esc(msg.texto) + '</p>' : '';
        if (!st.podeMarcar) return '<div class="adm-hist068-veic">' + selo + '</div>';
        var busy = !!st.veicBusy[cd];
        return '<div class="adm-hist068-veic">' + selo +
            '<form class="adm-hist068-veic-form" data-h068-veic="' + esc(cd) + '">' +
                '<label class="sr-only" for="h068-v-' + esc(cd) + '">Veículo do pedido #' + esc(cd) + '</label>' +
                '<select id="h068-v-' + esc(cd) + '" name="veiculo" class="adm-input"' + (busy ? ' disabled' : '') + '>' +
                    '<option value="">Trocar veículo…</option>' +
                    '<option value="caminhao"' + (efet === 'caminhao' ? ' disabled' : '') + '>Caminhão (CEASA)</option>' +
                    '<option value="s10"' + (efet === 's10' ? ' disabled' : '') + '>S10</option></select>' +
                '<input name="motivo" class="adm-input" maxlength="200" placeholder="Motivo (obrigatório)" aria-label="Motivo da troca do pedido #' + esc(cd) + '"' + (busy ? ' disabled' : '') + '>' +
                '<button type="submit" class="adm-botao-fantasma"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Salvando…' : 'Salvar') + '</button>' +
            '</form>' + msgH + '</div>';
    }

    function lerRotasSemana(sb) {
        if (!sb) return Promise.reject(new Error('Sessão indisponível.'));
        return Promise.resolve(sb.rpc('rota_068_rotas_semana')).then(function (r) {
            if (!r || r.error) throw (r && r.error) || new Error('Falha ao ler rotas da semana.');
            if (!Array.isArray(r.data)) throw new Error('Resposta inválida das rotas da semana.');
            return r.data;
        });
    }

    function assinarUrlLote(sb, caminho) {
        return Promise.resolve(sb.storage.from(BUCKET).createSignedUrl(caminho, SIGNED_TTL_S)).then(function (r) {
            if (!r || r.error) throw (r && r.error) || new Error('Não foi possível abrir a foto.');
            var segura = urlSegura(r.data && (r.data.signedUrl || r.data.signedURL));
            if (!segura) throw new Error('Link de foto inválido.');
            return segura;
        });
    }

    function caminhoParaArquivo(dia, file) {
        var mapa = caminhosArquivo.get(file);
        if (!mapa) { mapa = Object.create(null); caminhosArquivo.set(file, mapa); }
        if (!mapa[dia]) {
            var helper = raiz.TempRioCanhoto;
            var id = helper && typeof helper.uuid === 'function'
                ? helper.uuid()
                : (raiz.crypto && typeof raiz.crypto.randomUUID === 'function' ? raiz.crypto.randomUUID() : '');
            if (!id) throw new Error('Não foi possível gerar identificador para a foto.');
            mapa[dia] = 'lote/' + dia + '/' + id + '.jpg';
        }
        return mapa[dia];
    }

    // ---- Agrupamento puro (dia DESC, cd_pedido ASC; preserva dia só-foto) ----

    function agruparPorDia(linhas) {
        var porDia = Object.create(null);
        (linhas || []).forEach(function (x) {
            if (!x || !x.dia) return;
            var d = String(x.dia).slice(0, 10);
            var g = porDia[d] || (porDia[d] = { dia: d, pedidos: [], vistos: Object.create(null), lote_fotos: 0 });
            var nf = Number(x.lote_fotos || 0);
            if (isFinite(nf) && nf > g.lote_fotos) g.lote_fotos = nf;
            if (x.cd_pedido != null) {
                var cd = Number(x.cd_pedido);
                if (!g.vistos[cd]) {
                    g.vistos[cd] = true;
                    g.pedidos.push(x);
                }
            }
        });
        return Object.keys(porDia).sort().reverse().map(function (d) {
            var g = porDia[d];
            g.pedidos.sort(function (a, b) { return Number(a.cd_pedido) - Number(b.cd_pedido); });
            return { dia: g.dia, pedidos: g.pedidos, lote_fotos: g.lote_fotos };
        });
    }

    // ---- Ações assíncronas com guarda de sessão ----

    function carregarMes(mesAlvo) {
        if (!st.sb || !parteDAtiva()) return Promise.resolve();
        var s = st, seq = s.seq, req = ++s.reqMes;
        var hoje = hojeSP();
        var mes = mesAlvo || s.mes || hoje.slice(0, 7);
        s.mes = mes;
        s.diaCarregado = hoje;
        s.carregando = true;
        s.erro = '';
        s.ausente = false;
        s.galerias = {};
        s.confirmRem = '';
        redesenhar();

        var pPerm = Promise.resolve(s.sb.rpc('pode_marcar_rota')).then(function (r) {
            return !!(r && !r.error && r.data === true);
        }, function () { return false; });

        return Promise.all([lerHistoricoMes(s.sb, mes), pPerm]).then(function (rs) {
            if (!valida(s, seq) || s.reqMes !== req) return;
            s.linhas = rs[0];
            s.podeMarcar = rs[1];
            if (s.veicMes !== mes) { s.veic = {}; s.veicMes = mes; }   // mesmo mês: mantém os anteriores se a releitura falhar
            s.veicBusy = {}; s.veicMsg = {}; s.veicErro = false;
            s.carregado = true;
            s.carregando = false;
            s.erro = '';
            s.ausente = false;
            if (s.diaFiltro && !s.linhas.some(function (x) { return String(x.dia || '').slice(0, 10) === s.diaFiltro; })) {
                s.diaFiltro = '';
            }
            redesenhar();
            var cds = s.linhas.map(function (x) { return x.cd_pedido; }).filter(function (c) { return c != null; });
            if (cds.length) lerVeiculosHistorico(s.sb, cds).then(function (mapa) {
                if (!valida(s, seq) || s.reqMes !== req) return;
                s.veic = mapa; s.veicErro = false; redesenhar();
            }, function () {
                if (!valida(s, seq) || s.reqMes !== req) return;
                s.veicErro = true; redesenhar();   // não esconde em silêncio: aviso + mantém dados anteriores
            });
        }, function (err) {
            if (!valida(s, seq) || s.reqMes !== req) return;
            s.carregando = false;
            s.carregado = false;
            s.linhas = [];
            s.ausente = codigoAusente(err);
            s.erro = msgErroRpc(err, 'historico');
            redesenhar();
        });
    }

    function carregarRotasSemana() {
        if (!st.sb || !parteDAtiva() || st.semanaCarregando) return Promise.resolve();
        var s = st, seq = s.seq;
        s.semanaCarregando = true;
        s.semanaErro = '';
        redesenhar();
        return lerRotasSemana(s.sb).then(function (lista) {
            if (!valida(s, seq)) return;
            s.semanaCarregando = false;
            s.semanaLinhas = lista;
            s.semanaErro = '';
            redesenhar();
        }, function (err) {
            if (!valida(s, seq)) return;
            s.semanaCarregando = false;
            s.semanaErro = msgErroRpc(err, 'semana');
            redesenhar();
        });
    }

    function carregarGaleriaDia(dia, abrir) {
        if (!st.sb || !parteDAtiva()) return Promise.resolve();
        var s = st, seq = s.seq;
        var g = s.galerias[dia] || (s.galerias[dia] = { aberta: true, carregando: false, erro: '', fotos: [] });
        if (abrir !== undefined) g.aberta = !!abrir;
        if (!g.aberta) { redesenhar(); return Promise.resolve(); }
        if (g.carregando) return Promise.resolve();
        g.carregando = true;
        g.erro = '';
        redesenhar();
        return listarLoteDia(s.sb, dia).then(function (fotos) {
            if (!valida(s, seq)) return;
            g.carregando = false;
            g.fotos = fotos;
            g.erro = '';
            // Sincroniza contagem do dia na lista em memória
            s.linhas.forEach(function (x) {
                if (String(x.dia || '').slice(0, 10) === dia) x.lote_fotos = fotos.length;
            });
            redesenhar();
        }, function (err) {
            if (!valida(s, seq)) return;
            g.carregando = false;
            g.erro = msgErroRpc(err, 'listar');
            redesenhar();
        });
    }

    function alternarFoto(dia, caminho) {
        if (!st.sb) return Promise.resolve();
        var s = st, seq = s.seq, cache = s.urls[caminho];
        if (s.vendo[caminho] && cache && cache.ate > Date.now()) {
            s.vendo[caminho] = false;
            redesenhar();
            return Promise.resolve();
        }
        if (cache && cache.ate > Date.now()) {
            s.vendo[caminho] = true;
            redesenhar();
            return Promise.resolve();
        }
        if (s.assinando[caminho]) return Promise.resolve();
        s.assinando[caminho] = true;
        redesenhar();
        return assinarUrlLote(s.sb, caminho).then(function (url) {
            if (!valida(s, seq)) return;
            s.urls[caminho] = { url: url, ate: Date.now() + SIGNED_CACHE_MS };
            s.vendo[caminho] = true;
            if (s.galerias[dia]) s.galerias[dia].erro = '';
        }, function (err) {
            if (!valida(s, seq)) return;
            if (s.galerias[dia]) s.galerias[dia].erro = String((err && err.message) || 'Não foi possível abrir a foto.');
        }).then(function () {
            if (valida(s, seq)) { delete s.assinando[caminho]; redesenhar(); }
        });
    }

    function confirmarRemocao(dia, caminho) {
        if (!st.sb || st.papel !== 'admin' || st.removendo[caminho]) return Promise.resolve();
        var s = st, seq = s.seq;
        s.removendo[caminho] = true;
        s.confirmRem = '';
        redesenhar();
        return removerFotoLote(s.sb, caminho).then(function (res) {
            if (!valida(s, seq)) return;
            delete s.removendo[caminho];
            delete s.urls[caminho];
            delete s.vendo[caminho];
            var g = s.galerias[dia];
            if (g) {
                g.fotos = g.fotos.filter(function (f) { return f.caminho !== caminho; });
                if (res && res.pode_apagar && res.storage_removido === false) {
                    g.erro = 'Canhoto removido da lista; a limpeza do arquivo ocorrerá automaticamente.';
                }
            }
            return carregarGaleriaDia(dia, true).then(function () {
                if (valida(s, seq)) return carregarMes(s.mes);
            });
        }, function (err) {
            if (!valida(s, seq)) return;
            delete s.removendo[caminho];
            if (s.galerias[dia]) s.galerias[dia].erro = msgErroRpc(err, 'remover');
            redesenhar();
        });
    }

    function enviarLote(dia, arquivos) {
        if (!st.sb || !st.podeMarcar) return Promise.resolve();
        var s = st, seq = s.seq, hoje = hojeSP();
        if (diaUploadValido(dia, hoje)) s.uploadDia = dia;
        var lt = s.lotes[dia] || (s.lotes[dia] = { ocupado: false, msg: '', erro: '', caminhosPendentes: [], arquivosFalhos: [] });
        if (lt.ocupado) return Promise.resolve();

        if (!diaUploadValido(dia, hoje)) {
            lt.erro = 'Data fora do permitido (de ' + dataBr(minDiaUpload(hoje)) + ' até ' + dataBr(hoje) + ').';
            lt.msg = '';
            redesenhar();
            return Promise.resolve();
        }

        // Caso 1: retry de registro sem reupload (todos os caminhos já subiram)
        var listaArq = Array.from(arquivos || []);
        if (!listaArq.length && lt.caminhosPendentes && lt.caminhosPendentes.length) {
            lt.ocupado = true;
            lt.erro = '';
            lt.msg = 'Registrando ' + lt.caminhosPendentes.length + ' foto(s) já enviada(s)…';
            redesenhar();
            return registrarLoteDia(s.sb, dia, lt.caminhosPendentes.slice()).then(function (res) {
                if (!valida(s, seq)) return;
                lt.ocupado = false;
                lt.caminhosPendentes = [];
                lt.arquivosFalhos = [];
                lt.erro = '';
                lt.msg = res.repetido
                    ? 'Lote já registrado anteriormente (' + res.total + ' foto(s) no dia).'
                    : res.registrados + ' foto(s) registrada(s) no dia ' + dataBr(dia) + '.';
                return aposLoteOk(s, seq, dia);
            }, function (err) {
                if (!valida(s, seq)) return;
                lt.ocupado = false;
                lt.erro = msgErroRpc(err, 'lote');
                lt.msg = '';
                if (err && /^(arquivo_expirado|arquivo_removido|arquivo_em_expurgo)$/.test(String(err.motivo || ''))) {
                    lt.caminhosPendentes = [];
                }
                redesenhar();
            });
        }

        // Caso 2: novos arquivos ou retry de arquivos que falharam no upload
        if (!listaArq.length && lt.arquivosFalhos && lt.arquivosFalhos.length) {
            listaArq = lt.arquivosFalhos.slice();
        }
        if (!listaArq.length || listaArq.length > MAX_LOTE) {
            lt.erro = 'Selecione de 1 a ' + MAX_LOTE + ' fotos por envio.';
            lt.msg = '';
            redesenhar();
            return Promise.resolve();
        }
        var invalido = listaArq.some(function (f) {
            return !f || TIPOS_IMG.indexOf(String(f.type || '').toLowerCase()) < 0 || Number(f.size || 0) > MAX_BYTES_RAW;
        });
        if (invalido) {
            lt.erro = 'Use apenas fotos JPG, PNG ou WEBP de até 20 MB cada.';
            lt.msg = '';
            redesenhar();
            return Promise.resolve();
        }
        var helper = raiz.TempRioCanhoto;
        if (!helper || typeof helper.reduzir !== 'function') {
            lt.erro = 'Módulo de preparação de fotos indisponível. Atualize a página.';
            lt.msg = '';
            redesenhar();
            return Promise.resolve();
        }

        lt.ocupado = true;
        lt.erro = '';
        lt.msg = 'Preparando envio de ' + listaArq.length + ' foto(s)…';
        redesenhar();

        var subidos = (lt.caminhosPendentes || []).slice();
        var vistos = Object.create(null);
        subidos.forEach(function (c) { vistos[c] = true; });
        var falhos = [];
        var idx = 0;

        return listaArq.reduce(function (cadeia, file) {
            return cadeia.then(function () {
                if (!valida(s, seq)) return;
                idx++;
                lt.msg = 'Enviando foto ' + idx + ' de ' + listaArq.length + '…';
                redesenhar();
                var cam = caminhoParaArquivo(dia, file);
                if (vistos[cam]) return;
                return helper.reduzir(file).then(function (blob) {
                    if (!valida(s, seq)) return null;
                    return s.sb.storage.from(BUCKET).upload(cam, blob, {
                        contentType: 'image/jpeg', upsert: false, cacheControl: '3600'
                    });
                }).then(function (r) {
                    if (!valida(s, seq) || !r) return;
                    if (r.error && !/exist|duplicate|409/i.test(String(r.error.message || r.error.statusCode || ''))) {
                        throw r.error;
                    }
                    vistos[cam] = true;
                    subidos.push(cam);
                }).catch(function () {
                    falhos.push(file);
                });
            });
        }, Promise.resolve()).then(function () {
            if (!valida(s, seq)) return;
            lt.caminhosPendentes = subidos;
            lt.arquivosFalhos = falhos;
            if (!subidos.length) {
                lt.ocupado = false;
                lt.erro = 'Nenhuma foto pôde ser enviada. Confira o arquivo e tente novamente.';
                lt.msg = '';
                redesenhar();
                return;
            }
            if (falhos.length) {
                // Registra as que subiram ou avisa? Registra somente se todas subiram, mantendo falhas para retry sem reupload das já enviadas.
                lt.ocupado = false;
                lt.erro = falhos.length + ' foto(s) falhou(aram) no envio. Clique em tentar novamente (as ' + subidos.length + ' já enviadas não serão reenviadas).';
                lt.msg = '';
                redesenhar();
                return;
            }
            lt.msg = 'Registrando ' + subidos.length + ' foto(s) no dia ' + dataBr(dia) + '…';
            redesenhar();
            return registrarLoteDia(s.sb, dia, subidos.slice()).then(function (res) {
                if (!valida(s, seq)) return;
                lt.ocupado = false;
                lt.caminhosPendentes = [];
                lt.arquivosFalhos = [];
                lt.erro = '';
                lt.msg = res.repetido
                    ? 'Lote já registrado anteriormente (' + res.total + ' foto(s) no dia).'
                    : res.registrados + ' foto(s) registrada(s) no dia ' + dataBr(dia) + '.';
                return aposLoteOk(s, seq, dia);
            }, function (err) {
                if (!valida(s, seq)) return;
                lt.ocupado = false;
                lt.erro = msgErroRpc(err, 'lote');
                lt.msg = '';
                if (err && /^(arquivo_expirado|arquivo_removido|arquivo_em_expurgo)$/.test(String(err.motivo || ''))) {
                    lt.caminhosPendentes = [];
                }
                redesenhar();
            });
        });
    }

    function aposLoteOk(s, seq, dia) {
        if (!valida(s, seq)) return;
        var g = s.galerias[dia];
        var prom = g && g.aberta ? carregarGaleriaDia(dia, true) : Promise.resolve();
        return prom.then(function () {
            if (!valida(s, seq)) return;
            if (dia.slice(0, 7) === s.mes) return carregarMes(s.mes);
            redesenhar();
        });
    }

    // ---- Renderização ----

    function htmlGaleriaDia(dia, totalEsperado) {
        var g = st.galerias[dia];
        var lt = st.lotes[dia] || {};
        var aberta = !!(g && g.aberta);
        var qtd = g && !g.carregando && !g.erro ? g.fotos.length : totalEsperado;
        var hoje = hojeSP();
        var podeEnviarDia = st.podeMarcar && diaUploadValido(dia, hoje);
        var temRetryReg = !!(lt.caminhosPendentes && lt.caminhosPendentes.length && !(lt.arquivosFalhos && lt.arquivosFalhos.length));
        var temRetryArq = !!(lt.arquivosFalhos && lt.arquivosFalhos.length);

        var corpoGaleria = '';
        if (aberta) {
            if (g.carregando) {
                corpoGaleria = '<p class="text-xs mt-2" style="color:var(--adm-tinta-2)">Carregando canhotos…</p>';
            } else {
                var itens = (g.fotos || []).map(function (f) {
                    var cam = f.caminho;
                    var cache = st.urls[cam];
                    var vendo = !!(st.vendo[cam] && cache && cache.ate > Date.now());
                    var assinando = !!st.assinando[cam];
                    var removendo = !!st.removendo[cam];
                    var pedindoConf = st.confirmRem === cam;
                    return '<li class="adm-hist068-foto-item">' +
                        '<div class="adm-hist068-foto-topo">' +
                            '<span class="text-xs" style="color:var(--adm-tinta-2)"><i class="fa-regular fa-image mr-1" aria-hidden="true"></i>' + esc(horaSP(f.enviado_em) || 'Canhoto') + '</span>' +
                            '<div class="adm-hist068-foto-acoes">' +
                                '<button type="button" class="adm-botao-fantasma" data-h068-ver="' + esc(cam) + '" data-h068-dia="' + esc(dia) + '"' + (assinando ? ' disabled' : '') + '>' +
                                    (vendo ? 'Fechar foto' : assinando ? 'Abrindo…' : 'Ver foto') + '</button>' +
                                (st.papel === 'admin'
                                    ? (pedindoConf
                                        ? '<span class="adm-pe-canhoto-conf">Remover? ' +
                                            '<button type="button" class="adm-botao adm-pe-canhoto-perigo" data-h068-rem-ok="' + esc(cam) + '" data-h068-dia="' + esc(dia) + '"' + (removendo ? ' disabled' : '') + '>Confirmar</button>' +
                                            '<button type="button" class="adm-botao-fantasma" data-h068-rem-cancelar="1">Cancelar</button></span>'
                                        : '<button type="button" class="adm-botao-fantasma" data-h068-rem-pedir="' + esc(cam) + '" aria-label="Remover canhoto de ' + esc(dataBr(dia)) + '"' + (removendo ? ' disabled' : '') + '>Remover</button>')
                                    : '') +
                            '</div>' +
                        '</div>' +
                        (vendo
                            ? '<div class="adm-hist068-foto-preview">' +
                                '<a href="' + esc(cache.url) + '" target="_blank" rel="noopener noreferrer">' +
                                    '<img class="adm-pe-canhoto-img" data-h068-img="' + esc(cam) + '" data-h068-dia="' + esc(dia) + '" src="' + esc(cache.url) + '" alt="Canhoto do dia ' + esc(dataBr(dia)) + '">' +
                                '</a></div>'
                            : '') +
                    '</li>';
                }).join('');
                corpoGaleria = (g.erro ? '<p role="alert" class="adm-entrega-erro mt-2">' + esc(g.erro) + '</p>' : '') +
                    (itens ? '<ul class="adm-hist068-fotos-lista">' + itens + '</ul>' : '<p class="text-xs mt-2" style="color:var(--adm-tinta-3)">Nenhum canhoto em lote neste dia.</p>');
            }
        }

        var formUpload = podeEnviarDia
            ? '<form class="adm-hist068-lote-form" data-h068-lote="' + esc(dia) + '">' +
                '<label class="adm-hist068-file-lbl"><span class="sr-only">Selecionar fotos do dia ' + esc(dataBr(dia)) + '</span>' +
                '<input type="file" name="fotos" multiple accept="image/jpeg,image/png,image/webp" class="adm-input"' + (lt.ocupado ? ' disabled' : '') + '></label>' +
                '<button type="submit" class="adm-botao-fantasma"' + (lt.ocupado ? ' disabled' : '') + '>' +
                    '<i class="fa-solid fa-upload mr-1" aria-hidden="true"></i>' +
                    (lt.ocupado ? 'Enviando…' : temRetryReg ? 'Tentar registrar novamente' : temRetryArq ? 'Tentar fotos que falharam' : 'Enviar canhotos') +
                '</button>' +
                (lt.msg ? '<p role="status" class="text-xs" style="color:var(--adm-tinta-2)">' + esc(lt.msg) + '</p>' : '') +
                (lt.erro ? '<p role="alert" class="adm-entrega-erro">' + esc(lt.erro) + '</p>' : '') +
              '</form>'
            : '';

        return '<div class="adm-hist068-lote-bloco">' +
            '<div class="adm-hist068-lote-cab">' +
                '<button type="button" class="adm-botao-fantasma" data-h068-galeria="' + esc(dia) + '" aria-expanded="' + (aberta ? 'true' : 'false') + '">' +
                    '<i class="fa-regular fa-images mr-1" aria-hidden="true"></i>Canhotos do dia (' + qtd + ')' +
                '</button>' +
                '<span class="text-xs" style="color:var(--adm-tinta-3)">Fotos vinculadas somente ao dia, sem vínculo com pedido ou cliente.</span>' +
            '</div>' +
            corpoGaleria +
            formUpload +
        '</div>';
    }

    function htmlRotasSemana() {
        var linhas = st.semanaLinhas;
        var corpo = '';
        if (st.semanaAberta) {
            if (st.semanaCarregando) {
                corpo = '<p class="text-xs mt-2" style="color:var(--adm-tinta-2)">Carregando rotas da semana…</p>';
            } else if (st.semanaErro) {
                corpo = '<p role="alert" class="adm-entrega-erro mt-2">' + esc(st.semanaErro) + '</p>';
            } else if (!linhas || !linhas.length) {
                corpo = '<p class="text-xs mt-2" style="color:var(--adm-tinta-3)">Nenhuma rota fechada registrada nesta semana.</p>';
            } else {
                corpo = '<div class="adm-hist068-semana-grid">' + linhas.map(function (r) {
                    var foto = r && r.foto || {};
                    var itens = Array.isArray(foto.itens) ? foto.itens : [];
                    var veics = Array.from(new Set(itens.map(function (i) { return i && i.veiculo_id; }).filter(Boolean)));
                    var estado = foto.estado || (foto.fechada_em ? 'fechada' : 'registrada');
                    return '<article class="adm-hist068-semana-item">' +
                        '<strong>' + esc(dataSemanaBr(r.dia)) + '</strong>' +
                        '<p class="text-xs" style="color:var(--adm-tinta-2)">' + esc(estado) +
                            (foto.fechada_em ? ' · ' + esc(horaSP(foto.fechada_em)) : '') + '</p>' +
                        '<p class="text-xs" style="color:var(--adm-tinta-3)">' + itens.length + ' pedido(s)' +
                            (veics.length ? ' · ' + esc(veics.join(', ')) : '') + '</p>' +
                    '</article>';
                }).join('') + '</div>';
            }
        }
        return '<details class="adm-card p-4 mb-5" data-h068-semana' + (st.semanaAberta ? ' open' : '') + '>' +
            '<summary class="font-bold text-sm cursor-pointer"><i class="fa-solid fa-route mr-2" aria-hidden="true"></i>Rotas fechadas desta semana (seg–dom · somente leitura)</summary>' +
            corpo +
        '</details>';
    }

    function htmlCardEnvioDia(hoje) {
        if (!st.podeMarcar) return '';
        var minD = minDiaUpload(hoje);
        var diaSel = st.uploadDia && diaUploadValido(st.uploadDia, hoje) ? st.uploadDia : hoje;
        st.uploadDia = diaSel;
        var lt = st.lotes[diaSel] || {};
        var temRetryReg = !!(lt.caminhosPendentes && lt.caminhosPendentes.length && !(lt.arquivosFalhos && lt.arquivosFalhos.length));
        return '<section class="adm-card p-4 mb-5" aria-labelledby="h068-envio-tit">' +
            '<h3 id="h068-envio-tit" class="text-sm font-bold mb-1"><i class="fa-solid fa-camera mr-2" aria-hidden="true"></i>Enviar canhotos em lote por dia</h3>' +
            '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">Envie de 1 a 100 fotos de um dia (de ' + esc(dataBr(minD)) + ' até ' + esc(dataBr(hoje)) + '). As fotos ficam agrupadas apenas pelo dia.</p>' +
            '<form class="adm-hist068-lote-form" data-h068-lote-topo="1">' +
                '<label class="text-xs">Dia<input type="date" name="dia" class="adm-input" min="' + esc(minD) + '" max="' + esc(hoje) + '" value="' + esc(diaSel) + '"' + (lt.ocupado ? ' disabled' : '') + ' required></label>' +
                '<label class="text-xs">Fotos (JPG, PNG, WEBP)<input type="file" name="fotos" multiple accept="image/jpeg,image/png,image/webp" class="adm-input"' + (lt.ocupado ? ' disabled' : '') + '></label>' +
                '<button type="submit" class="adm-botao"' + (lt.ocupado ? ' disabled' : '') + '>' +
                    (lt.ocupado ? 'Enviando…' : temRetryReg ? 'Tentar registrar novamente' : 'Enviar lote') +
                '</button>' +
                (lt.msg ? '<p role="status" class="text-xs" style="color:var(--adm-tinta-2)">' + esc(lt.msg) + '</p>' : '') +
                (lt.erro ? '<p role="alert" class="adm-entrega-erro">' + esc(lt.erro) + '</p>' : '') +
            '</form></section>';
    }

    function renderHtml() {
        if (!parteDAtiva()) return '';
        var hoje = hojeSP();
        var meses = mesesDisponiveis(hoje);
        var mesAtual = st.mes || meses[0];
        var grupos = agruparPorDia(st.linhas);
        var buscaNorm = norm(st.busca);
        var diasOpcoes = grupos.map(function (g) { return g.dia; });

        var gruposVisiveis = grupos.filter(function (g) {
            if (st.diaFiltro && g.dia !== st.diaFiltro) return false;
            if (!buscaNorm) return true;
            return g.pedidos.some(function (p) {
                return norm(String(p.cd_pedido) + ' ' + (p.cliente_nome || '')).indexOf(buscaNorm) >= 0;
            });
        }).map(function (g) {
            if (!buscaNorm) return g;
            return {
                dia: g.dia,
                lote_fotos: g.lote_fotos,
                pedidos: g.pedidos.filter(function (p) {
                    return norm(String(p.cd_pedido) + ' ' + (p.cliente_nome || '')).indexOf(buscaNorm) >= 0;
                })
            };
        });

        var totalPedidos = gruposVisiveis.reduce(function (acc, g) { return acc + g.pedidos.length; }, 0);

        var corpo = '';
        if (st.carregando && !st.carregado) {
            corpo = '<div class="adm-card p-6 text-sm" role="status" style="color:var(--adm-tinta-2)">Carregando histórico de pedidos…</div>';
        } else if (st.erro) {
            corpo = '<div class="adm-card p-5" role="alert"><p class="adm-entrega-erro">' + esc(st.erro) + '</p>' +
                '<button type="button" class="adm-botao-fantasma mt-2" data-h068-tentar="1">Tentar novamente</button></div>';
        } else if (!gruposVisiveis.length) {
            corpo = '<div class="adm-card p-6 text-sm" style="color:var(--adm-tinta-2)">Nenhum pedido ou canhoto em lote no histórico para ' + esc(mesRotulo(mesAtual)) +
                (buscaNorm || st.diaFiltro ? ' com os filtros atuais.' : '.') + '</div>';
        } else {
            corpo = gruposVisiveis.map(function (g) {
                var cards = g.pedidos.length
                    ? '<div class="adm-hist068-pedidos-grid">' + g.pedidos.map(function (p) {
                        var tipo = p.cliente_tipo === 'cnpj' ? 'PJ' : p.cliente_tipo === 'cpf' ? 'PF' : '';
                        return '<article class="adm-hist068-pedido" data-h068-pedido="' + esc(p.cd_pedido) + '">' +
                            '<div class="adm-hist068-pedido-topo">' +
                                '<strong>Pedido #' + esc(p.cd_pedido) + '</strong>' +
                                '<span class="rota-selo">' + esc(p.status === 'entregue' ? 'Entregue' : (p.status || 'Entregue')) + '</span>' +
                            '</div>' +
                            '<p class="text-sm font-semibold">' + esc(p.cliente_nome || 'Consumidor final') +
                                (tipo ? ' <span class="text-xs" style="color:var(--adm-tinta-3)">(' + esc(tipo) + ')</span>' : '') + '</p>' +
                            '<p class="text-xs" style="color:var(--adm-tinta-2)">' + esc(brl(p.valor_centavos)) +
                                (p.data_entrega ? ' · Entregue em ' + esc(dataBr(p.data_entrega)) : '') + '</p>' +
                            (p.obs ? '<p class="text-xs mt-1" style="color:var(--adm-tinta-2)">' + esc(p.obs) + '</p>' : '') +
                            (p.por_nome || p.em ? '<p class="text-xs" style="color:var(--adm-tinta-3)">' + esc([p.por_nome, horaSP(p.em)].filter(Boolean).join(' · ')) + '</p>' : '') +
                            htmlVeiculoHistorico(p) +
                        '</article>';
                    }).join('') + '</div>'
                    : '<p class="text-xs mb-2" style="color:var(--adm-tinta-3)">Dia com canhotos em lote (sem pedidos listados).</p>';

                return '<section class="adm-card p-4 mb-4 adm-hist068-dia" data-h068-dia-sec="' + esc(g.dia) + '">' +
                    '<div class="adm-hist068-dia-cab">' +
                        '<h3 class="text-base font-bold">' + esc(dataSemanaBr(g.dia)) + '</h3>' +
                        '<span class="text-xs" style="color:var(--adm-tinta-2)">' + g.pedidos.length + ' pedido(s) · ' + g.lote_fotos + ' canhoto(s)</span>' +
                    '</div>' +
                    cards +
                    htmlGaleriaDia(g.dia, g.lote_fotos) +
                '</section>';
            }).join('');
        }

        return '<div class="adm-hist068">' +
            '<div class="adm-hist068-topo">' +
                '<div>' +
                    '<h2 class="text-lg font-bold"><i class="fa-solid fa-clock-rotate-left mr-2" aria-hidden="true"></i>Histórico de pedidos</h2>' +
                    '<p class="text-xs mt-1" style="color:var(--adm-tinta-3)">Entregas concluídas a partir de 23/11/2026 (virada automática à 00:00 SP conforme o 070). Pedidos com problema ativo ficam fora até serem resolvidos.</p>' +
                '</div>' +
                '<button type="button" class="adm-botao-fantasma" data-h068-atualizar="1"' + (st.carregando ? ' disabled' : '') + '>' +
                    '<i class="fa-solid fa-rotate mr-1" aria-hidden="true"></i>Atualizar' +
                '</button>' +
            '</div>' +
            (st.veicErro && st.carregado ? '<div class="adm-card p-3 mb-3" role="alert"><p class="adm-entrega-erro">' + esc(MSG_VEIC) + '</p><button type="button" class="adm-botao-fantasma mt-2" data-h068-tentar="1">Atualizar</button></div>' : '') +
            htmlRotasSemana() +
            htmlCardEnvioDia(hoje) +
            '<div class="adm-card p-4 mb-5 adm-hist068-filtros">' +
                '<label class="text-xs">Mês' +
                    '<select class="adm-input" data-h068-mes>' +
                        meses.map(function (m) {
                            return '<option value="' + esc(m) + '"' + (m === mesAtual ? ' selected' : '') + '>' + esc(mesRotulo(m)) + '</option>';
                        }).join('') +
                    '</select></label>' +
                '<label class="text-xs">Dia' +
                    '<select class="adm-input" data-h068-dia-filtro>' +
                        '<option value="">Todos os dias (' + diasOpcoes.length + ')</option>' +
                        diasOpcoes.map(function (d) {
                            return '<option value="' + esc(d) + '"' + (d === st.diaFiltro ? ' selected' : '') + '>' + esc(dataSemanaBr(d)) + '</option>';
                        }).join('') +
                    '</select></label>' +
                '<label class="text-xs adm-hist068-busca">Buscar por nº ou cliente' +
                    '<input type="search" class="adm-input" data-h068-busca value="' + esc(st.busca) + '" placeholder="Ex.: 1530 ou nome do cliente" autocomplete="off"></label>' +
                '<span class="text-xs self-end pb-2" role="status" style="color:var(--adm-tinta-2)">' +
                    totalPedidos + ' pedido(s) em ' + gruposVisiveis.length + ' dia(s)' +
                '</span>' +
            '</div>' +
            corpo +
        '</div>';
    }

    function redesenhar() {
        var alvo = st.alvo;
        if (!alvo || !alvo.isConnected) return;
        var focoId = null, selIni = null;
        if (typeof document !== 'undefined' && document.activeElement && alvo.contains(document.activeElement)) {
            if (document.activeElement.hasAttribute && document.activeElement.hasAttribute('data-h068-busca')) {
                focoId = '[data-h068-busca]';
                selIni = document.activeElement.selectionStart;
            }
        }
        alvo.innerHTML = renderHtml();
        var s = st, seq = s.seq;
        alvo.querySelectorAll('[data-h068-img]').forEach(function (img) {
            img.onerror = function () {
                if (!valida(s, seq) || !img.isConnected) return;
                var cam = img.getAttribute('data-h068-img'), dia = img.getAttribute('data-h068-dia');
                delete s.urls[cam];
                s.vendo[cam] = false;
                if (s.galerias[dia]) s.galerias[dia].erro = 'Foto indisponível ou link expirado. Abra novamente para tentar.';
                redesenhar();
            };
        });
        if (focoId) {
            var el = alvo.querySelector(focoId);
            if (el && el.focus) {
                el.focus();
                if (selIni != null && el.setSelectionRange) {
                    try { el.setSelectionRange(selIni, selIni); } catch (e) { /* ignore */ }
                }
            }
        }
    }

    function ligarDelegacao(alvo) {
        if (!alvo || alvo._h068Ligado) return;
        alvo._h068Ligado = true;

        alvo.addEventListener('click', function (ev) {
            var b = ev.target && ev.target.closest ? ev.target.closest('button') : null;
            if (!b || !alvo.contains(b)) return;
            if (b.hasAttribute('data-h068-atualizar') || b.hasAttribute('data-h068-tentar')) {
                carregarMes(st.mes);
                if (st.semanaAberta) carregarRotasSemana();
            } else if (b.hasAttribute('data-h068-galeria')) {
                var dia = b.getAttribute('data-h068-galeria');
                var aberta = !!(st.galerias[dia] && st.galerias[dia].aberta);
                carregarGaleriaDia(dia, !aberta);
            } else if (b.hasAttribute('data-h068-ver')) {
                alternarFoto(b.getAttribute('data-h068-dia'), b.getAttribute('data-h068-ver'));
            } else if (b.hasAttribute('data-h068-rem-pedir')) {
                st.confirmRem = b.getAttribute('data-h068-rem-pedir');
                redesenhar();
            } else if (b.hasAttribute('data-h068-rem-cancelar')) {
                st.confirmRem = '';
                redesenhar();
            } else if (b.hasAttribute('data-h068-rem-ok')) {
                confirmarRemocao(b.getAttribute('data-h068-dia'), b.getAttribute('data-h068-rem-ok'));
            }
        });

        alvo.addEventListener('change', function (ev) {
            var t = ev.target;
            if (!t || !alvo.contains(t)) return;
            if (t.hasAttribute && t.hasAttribute('data-h068-mes')) {
                st.diaFiltro = '';
                carregarMes(t.value);
            } else if (t.hasAttribute && t.hasAttribute('data-h068-dia-filtro')) {
                st.diaFiltro = t.value;
                redesenhar();
            } else if (t.name === 'dia' && t.closest && t.closest('[data-h068-lote-topo]')) {
                st.uploadDia = t.value;
                redesenhar();
            }
        });

        alvo.addEventListener('input', function (ev) {
            var t = ev.target;
            if (t && t.hasAttribute && t.hasAttribute('data-h068-busca')) {
                st.busca = t.value;
                redesenhar();
            }
        });

        alvo.addEventListener('submit', function (ev) {
            var fv = ev.target && ev.target.closest ? ev.target.closest('[data-h068-veic]') : null;
            if (fv && alvo.contains(fv)) {
                ev.preventDefault();
                salvarVeiculo(fv.getAttribute('data-h068-veic'), fv.elements.veiculo.value, fv.elements.motivo.value);
                return;
            }
            var form = ev.target && ev.target.closest ? ev.target.closest('[data-h068-lote], [data-h068-lote-topo]') : null;
            if (!form || !alvo.contains(form)) return;
            ev.preventDefault();
            var dia = form.hasAttribute('data-h068-lote-topo')
                ? (form.elements && form.elements.dia ? form.elements.dia.value : st.uploadDia)
                : form.getAttribute('data-h068-lote');
            var input = form.elements && form.elements.fotos;
            enviarLote(dia, input ? input.files : []);
        });

        alvo.addEventListener('toggle', function (ev) {
            var el = ev.target;
            if (!el || !el.hasAttribute || !el.hasAttribute('data-h068-semana')) return;
            st.semanaAberta = !!el.open;
            if (st.semanaAberta && st.semanaLinhas === null && !st.semanaCarregando) {
                carregarRotasSemana();
            }
        }, true);
    }

    function msAteProximaMeiaNoiteSP(agora) {
        var d = agora ? new Date(agora) : new Date();
        var partes = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }).formatToParts(d);
        var h = 0, m = 0, s = 0;
        partes.forEach(function (p) {
            if (p.type === 'hour') h = Number(p.value) % 24;
            else if (p.type === 'minute') m = Number(p.value);
            else if (p.type === 'second') s = Number(p.value);
        });
        var segRestantes = 86400 - (h * 3600 + m * 60 + s);
        var ms = segRestantes * 1000 + MARGEM_VIRADA_MS;
        return Math.max(1000, Math.min(ms, 86400000 + MARGEM_VIRADA_MS + 2000));
    }

    function visivel() {
        return !!(st.alvo && st.alvo.isConnected && st.sb && parteDAtiva() &&
            (!st.alvo.classList || !st.alvo.classList.contains('hidden')));
    }

    function cancelarVirada() {
        if (timerVirada != null && typeof clearTimeout === 'function') {
            clearTimeout(timerVirada);
        }
        timerVirada = null;
    }

    function agendarVirada() {
        cancelarVirada();
        if (!visivel() || typeof setTimeout !== 'function') return;
        var s = st, seq = s.seq;
        timerVirada = setTimeout(function () {
            timerVirada = null;
            if (!valida(s, seq) || !visivel()) return;
            verificarVirada();
            if (valida(s, seq) && visivel()) agendarVirada();
        }, msAteProximaMeiaNoiteSP());
    }

    function verificarVirada() {
        if (!visivel()) { cancelarVirada(); return; }
        var hoje = hojeSP();
        if (st.diaCarregado && st.diaCarregado !== hoje) {
            carregarMes(st.mes || hoje.slice(0, 7));
            if (st.semanaAberta) carregarRotasSemana();
        }
    }

    function pausar() {
        cancelarVirada();
    }

    function ligarGlobais() {
        if (ouvintesGlobais) return;
        ouvintesGlobais = true;
        if (typeof raiz.addEventListener === 'function') {
            raiz.addEventListener('focus', function () { verificarVirada(); if (visivel() && timerVirada == null) agendarVirada(); });
            raiz.addEventListener('temprio-entrega063', function () {
                if (visivel()) {
                    carregarMes(st.mes);
                } else {
                    st.carregado = false;
                }
            });
        }
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('visibilitychange', function () {
                if (document.visibilityState === 'visible') { verificarVirada(); if (visivel() && timerVirada == null) agendarVirada(); }
            });
        }
    }

    function desenhar(alvo, ctx) {
        ctx = ctx || {};
        if (!alvo || !ctx.sb || !parteDAtiva()) {
            sair();
            if (alvo) alvo.innerHTML = '';
            return;
        }
        if (st.sb && st.sb !== ctx.sb) sair();
        st.alvo = alvo;
        st.sb = ctx.sb;
        st.papel = ctx.papel || null;
        ligarDelegacao(alvo);
        ligarGlobais();
        var hoje = hojeSP();
        if (!st.mes) st.mes = hoje.slice(0, 7);
        if (!st.uploadDia) st.uploadDia = hoje;
        if (!st.carregado || st.diaCarregado !== hoje) {
            carregarMes(st.mes);
        } else {
            redesenhar();
        }
        agendarVirada();
    }

    function sair() {
        cancelarVirada();
        var alvoAnt = st.alvo;
        st.seq++;
        st = novoEstado();
        if (alvoAnt) alvoAnt.innerHTML = '';
    }

    var api = {
        desenhar: desenhar,
        sair: sair,
        pausar: pausar,
        verificarVirada: verificarVirada,
        msAteProximaMeiaNoiteSP: msAteProximaMeiaNoiteSP,
        // Exportados para testes unitários/contrato
        lerHistoricoMes: lerHistoricoMes,
        listarLoteDia: listarLoteDia,
        registrarLoteDia: registrarLoteDia,
        removerFotoLote: removerFotoLote,
        lerRotasSemana: lerRotasSemana,
        assinarUrlLote: assinarUrlLote,
        agruparPorDia: agruparPorDia,
        diaUploadValido: diaUploadValido,
        minDiaUpload: minDiaUpload,
        enviarLote: enviarLote,
        confirmarRemocao: confirmarRemocao,
        _estado: function () { return st; }
    };

    raiz.TempRioHistorico068D = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
