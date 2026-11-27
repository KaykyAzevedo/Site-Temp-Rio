/* =====================================================================
 * 068 B — Prazo Ideal Flexível (sobre 216d678: 070 + 068C + 068D).
 * Contrato congelado: docs/plans/2026-11-27-068B-r8-sobre-216d678-contrato.md
 * Consome exclusivamente as 6 RPCs 068B; nunca grava prazo via upsert 040.
 * ===================================================================== */
(function (raiz) {
    'use strict';

    var BLOCO_CDS = 2000;
    var DIAS_SEMANA = [
        { v: 0, curto: 'Dom', nome: 'Domingo' },
        { v: 1, curto: 'Seg', nome: 'Segunda' },
        { v: 2, curto: 'Ter', nome: 'Terça' },
        { v: 3, curto: 'Qua', nome: 'Quarta' },
        { v: 4, curto: 'Qui', nome: 'Quinta' },
        { v: 5, curto: 'Sex', nome: 'Sexta' },
        { v: 6, curto: 'Sáb', nome: 'Sábado' }
    ];
    var MOTIVOS_ERRO = {
        parametro_invalido: 'Confira os dados informados para a entrega agendada.',
        motivo_invalido: 'Informe um motivo de 1 a 200 caracteres, sem < > nem caracteres de controle.',
        pedido_nao_encontrado: 'Pedido não encontrado. Atualize a tela.',
        pedido_historico: 'Pedido já está no Histórico e não pode ter a data agendada alterada.',
        cliente_sem_documento: 'Este pedido não tem cliente identificado para salvar regra permanente.',
        dia_sem_saida: 'A data escolhida não é dia útil configurado ou é feriado.',
        prazo_indisponivel: 'Não foi possível calcular uma data válida com essas regras.',
        veiculo_invalido: 'Veículo inválido para consultar o calendário.'
    };
    var MOTIVOS_CAL = {
        dia_passado: 'Data anterior a hoje',
        domingo: 'Domingo não é dia útil',
        dia_nao_util: 'Dia não útil configurado',
        feriado: 'Feriado'
    };

    var dialogo = null;
    var soltarCal = null;
    var registroPedidos = Object.create(null);

    function calMod() {
        return raiz.TempRioCalendario || (typeof module !== 'undefined' && module.exports ? require('./admin-calendario.js') : null);
    }

    function parteBAtiva() {
        return !raiz.TempRio068Partes || raiz.TempRio068Partes.B === true;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function dataBr(iso) {
        if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(String(iso))) return 'Sem data';
        var p = String(iso).slice(0, 10).split('-');
        return p[2] + '/' + p[1] + '/' + p[0];
    }

    function horaSP(iso) {
        if (!iso || !isFinite(Date.parse(iso))) return '';
        return new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'
        }).format(new Date(iso));
    }

    function hojeSP() {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date()).slice(0, 10);
    }

    function rpcAusente(err) {
        var c = String((err && err.code) || '');
        var m = String((err && err.message) || '');
        return /^(PGRST202|42883|42P01)$/.test(c) || /Could not find the function/i.test(m);
    }

    function limparMotivo(v) {
        return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    }

    function motivoValido(m) {
        return !!m && m.length <= 200 && !/[<>\u0000-\u001f\u007f]/.test(m);
    }

    function normalizarDiasSemana(arr) {
        if (!Array.isArray(arr)) return [];
        var vistos = Object.create(null), out = [];
        arr.forEach(function (x) {
            var n = Number(x);
            if (Number.isInteger(n) && n >= 0 && n <= 6 && !vistos[n]) {
                vistos[n] = true;
                out.push(n);
            }
        });
        out.sort(function (a, b) { return a - b; });
        return out;
    }

    function textoDiasSemana(arr) {
        var limpos = normalizarDiasSemana(arr);
        return limpos.map(function (n) {
            var d = DIAS_SEMANA.filter(function (x) { return x.v === n; })[0];
            return d ? d.curto : String(n);
        }).join(', ');
    }

    function podeEditar(o) {
        return !!o && (o.podeMarcar === true || o.papel === 'admin');
    }

    function chamarRpc(sb, fn, args) {
        if (!sb) return Promise.reject(new Error('Sessão indisponível.'));
        return Promise.resolve().then(function () {
            return args === undefined ? sb.rpc(fn) : sb.rpc(fn, args);
        }).then(function (r) {
            if (!r || r.error) {
                var e = new Error(r && r.error ? (r.error.message || r.error.code) : 'Sem resposta de ' + fn);
                e.code = r && r.error && r.error.code;
                throw e;
            }
            return r.data;
        });
    }

    function checarStatusOk(d) {
        if (!d || (d.status !== 'ok' && d.status !== 'erro')) {
            throw new Error('Resposta inválida; atualize para conferir.');
        }
        if (d.status === 'erro') {
            var e = new Error(MOTIVOS_ERRO[d.motivo] || 'Não foi possível concluir (' + d.motivo + ').');
            e.motivo = d.motivo;
            throw e;
        }
        return d;
    }

    // ---- 6 RPCs do contrato congelado 27b0aefe ----

    function lerPrazos(sb, cds) {
        var ids = Array.from(new Set((cds || []).map(Number).filter(function (n) {
            return Number.isSafeInteger(n) && n > 0;
        })));
        if (!ids.length) return Promise.resolve({ instalada: true, porPedido: {} });
        var blocos = [];
        for (var i = 0; i < ids.length; i += BLOCO_CDS) blocos.push(ids.slice(i, i + BLOCO_CDS));
        var acumulado = Object.create(null);
        return blocos.reduce(function (cadeia, bloco) {
            return cadeia.then(function (st) {
                if (!st.instalada) return st;
                return chamarRpc(sb, 'rota_068_prazo_ler', { p_cds: bloco }).then(function (rows) {
                    if (!Array.isArray(rows)) throw new Error('Resposta inválida de rota_068_prazo_ler.');
                    rows.forEach(function (row) {
                        if (row && row.cd_pedido != null) acumulado[Number(row.cd_pedido)] = row;
                    });
                    return st;
                }, function (err) {
                    if (rpcAusente(err)) return { instalada: false };
                    throw err; // falha em qualquer bloco aborta sem publicar parcial
                });
            });
        }, Promise.resolve({ instalada: true })).then(function (st) {
            return { instalada: st.instalada, porPedido: st.instalada ? acumulado : {} };
        });
    }

    function lerRegras(sb) {
        return chamarRpc(sb, 'rota_068_regras_prazo').then(function (rows) {
            if (!Array.isArray(rows)) throw new Error('Resposta inválida de rota_068_regras_prazo.');
            var porDoc = Object.create(null);
            rows.forEach(function (r) { if (r && r.documento) porDoc[String(r.documento)] = r; });
            return { instalada: true, porDoc: porDoc, lista: rows };
        }, function (err) {
            if (rpcAusente(err)) return { instalada: false, porDoc: {}, lista: [] };
            throw err;
        });
    }

    function lerPadrao(sb) {
        return chamarRpc(sb, 'rota_068_prazo_padrao_ler').then(function (d) {
            // Compatibilidade com mocks antigos que devolvem [] para RPC desconhecida
            if (Array.isArray(d) && !d.length) return { instalada: false, padrao: null };
            checarStatusOk(d);
            return {
                instalada: true,
                padrao: {
                    prazo_ideal_dias: Number(d.prazo_ideal_dias),
                    prazo_dias_uteis_semana: normalizarDiasSemana(d.prazo_dias_uteis_semana),
                    atualizado_por: d.atualizado_por || null,
                    atualizado_em: d.atualizado_em || null
                }
            };
        }, function (err) {
            if (rpcAusente(err)) return { instalada: false, padrao: null };
            throw err;
        });
    }

    function lerTudo(sb, cds) {
        if (!sb || !parteBAtiva()) return Promise.resolve({ instalada: false, prazos: {}, regras: {}, padrao: null, erro: '' });
        return lerPadrao(sb).then(function (pad) {
            if (!pad.instalada) return { instalada: false, prazos: {}, regras: {}, padrao: null, erro: '' };
            return Promise.all([lerPrazos(sb, cds), lerRegras(sb)]).then(function (rs) {
                if (!rs[0].instalada || !rs[1].instalada) {
                    return { instalada: false, prazos: {}, regras: {}, padrao: null, erro: '' };
                }
                return {
                    instalada: true,
                    prazos: rs[0].porPedido,
                    regras: rs[1].porDoc,
                    padrao: pad.padrao,
                    erro: ''
                };
            });
        }).catch(function (err) {
            return {
                instalada: true,
                prazos: {},
                regras: {},
                padrao: null,
                erro: String((err && err.message) || err || 'Não foi possível ler as entregas agendadas.')
            };
        });
    }

    function salvarPrazo(sb, args) {
        var motivo = limparMotivo(args.p_motivo);
        if (!motivoValido(motivo)) {
            var e = new Error(MOTIVOS_ERRO.motivo_invalido); e.motivo = 'motivo_invalido'; return Promise.reject(e);
        }
        var payload = {
            p_cd_pedido: Number(args.p_cd_pedido),
            p_tipo: args.p_tipo,
            p_dias: args.p_dias == null ? null : Number(args.p_dias),
            p_data: args.p_data || null,
            p_escopo: args.p_escopo || 'pedido',
            p_motivo: motivo,
            p_regra_dias_semana: args.p_regra_dias_semana || null
        };
        return chamarRpc(sb, 'rota_068_prazo_salvar', payload).then(checarStatusOk);
    }

    function removerExcecao(sb, cdPedido, motivo) {
        var m = motivo ? limparMotivo(motivo) : null;
        if (m && !motivoValido(m)) {
            var e = new Error(MOTIVOS_ERRO.motivo_invalido); e.motivo = 'motivo_invalido'; return Promise.reject(e);
        }
        return chamarRpc(sb, 'rota_068_prazo_remover_excecao', { p_cd_pedido: Number(cdPedido), p_motivo: m }).then(checarStatusOk);
    }

    function removerRegra(sb, documento, motivo) {
        var m = motivo ? limparMotivo(motivo) : null;
        if (m && !motivoValido(m)) {
            var e = new Error(MOTIVOS_ERRO.motivo_invalido); e.motivo = 'motivo_invalido'; return Promise.reject(e);
        }
        return chamarRpc(sb, 'rota_068_prazo_remover_regra', { p_documento: String(documento), p_motivo: m }).then(checarStatusOk);
    }

    function salvarPadrao(sb, dias, diasUteisSemana) {
        var n = Number(dias);
        if (!Number.isInteger(n) || n < 0 || n > 365) {
            var e1 = new Error('Informe de 0 a 365 dias úteis.'); e1.motivo = 'parametro_invalido'; return Promise.reject(e1);
        }
        var lista = diasUteisSemana === null || diasUteisSemana === undefined ? null : normalizarDiasSemana(diasUteisSemana);
        if (lista !== null && !lista.length) {
            var e2 = new Error('Selecione pelo menos um dia útil da semana.'); e2.motivo = 'parametro_invalido'; return Promise.reject(e2);
        }
        return chamarRpc(sb, 'rota_068_prazo_padrao_salvar', {
            p_dias: n,
            p_dias_uteis_semana: lista
        }).then(checarStatusOk);
    }

    function lerCalendarioPrazo(sb, veiculo, mesIso) {
        var cal = calMod();
        var de = cal ? cal.mes(mesIso, 0) : null;
        var ate = cal && de ? cal.somar(cal.mes(de, 1), -1) : null;
        if (!de || !ate) return Promise.reject(new Error('Mês inválido.'));
        var veic = String(veiculo || 's10');
        return chamarRpc(sb, 'rota_068_calendario_veiculo', { p_veiculo: veic, p_de: de, p_ate: ate }).then(function (d) {
            checarStatusOk(d);
            if (!Array.isArray(d.dias_prazo)) throw new Error('Calendário de entrega agendada incompleto.');
            return d;
        });
    }

    function motivoCalendario(diaIso, calData) {
        if (!calData || !Array.isArray(calData.dias_prazo)) return 'Consulte a disponibilidade deste mês';
        var item = calData.dias_prazo.filter(function (x) { return x && x.dia === diaIso; })[0];
        if (!item) return 'Consulte a disponibilidade deste mês';
        return item.habilitado ? '' : (MOTIVOS_CAL[item.motivo] || item.motivo || 'Dia indisponível');
    }

    // ---- Apresentação nos cartões de Pedidos ----

    function origemRotulo(origem) {
        if (origem === 'excecao_pedido' || origem === 'pedido' || origem === 'excecao') return 'exceção';
        if (origem === 'regra_cliente' || origem === 'cliente') return 'regra do cliente';
        return 'padrão';
    }

    // 068SM: sem "meta". Só a ENTREGA AGENDADA pelo cliente (tipo 'data'): marcar / alterar / remover data.
    function htmlCard(pedido, opts) {
        opts = opts || {};
        if (!parteBAtiva() || !pedido) return '';
        if (opts.erro) {
            return '<p class="adm-prazo068-linha adm-entrega-erro" role="alert">Entrega agendada indisponível: ' + esc(opts.erro) + '</p>';
        }
        if (!opts.instalada) return '';
        var row = (opts.prazos && opts.prazos[pedido.cd_pedido]) || {};
        var agendado = row.tipo === 'data' && !!row.prazo_ideal;
        var pode = podeEditar(opts) && row.travado !== true;
        if (!agendado && !pode) return '';
        var cd = esc(pedido.cd_pedido);
        return '<div class="adm-prazo068-linha" data-prazo068-box="' + cd + '">' +
            '<span>Entrega agendada: <strong>' + (agendado ? esc(dataBr(row.prazo_ideal)) : 'sem data') + '</strong></span>' +
            (pode ? ' <button type="button" class="adm-botao-fantasma no-print" data-prazo068-cd="' + cd + '" aria-label="' + (agendado ? 'Alterar' : 'Marcar') + ' entrega agendada do pedido #' + cd + '">' + (agendado ? 'Alterar data' : 'Marcar data') + '</button>' : '') +
        '</div>';
    }

    // ---- Diálogos (<dialog>) ----

    function fechar() {
        if (soltarCal) { try { soltarCal(); } catch (e) { /* ignore */ } soltarCal = null; }
        if (dialogo) { dialogo.close(); dialogo.remove(); dialogo = null; }
    }

    function abrirPrazo(pedido, getOpts, opener) {
        var o = getOpts();
        if (!parteBAtiva() || !podeEditar(o) || !o.instalada || !pedido) return;
        var row = (o.prazos && o.prazos[pedido.cd_pedido]) || {};
        if (row.travado === true) return;
        var doc = pedido.documento ? String(pedido.documento) : '';
        var regra = (doc && o.regras && o.regras[doc]) || null;
        var padrao = o.padrao || { prazo_ideal_dias: row.prazo_padrao_dias != null ? row.prazo_padrao_dias : 2, prazo_dias_uteis_semana: [1, 2, 3, 4, 5] };
        var diasUteisPadrao = normalizarDiasSemana(padrao.prazo_dias_uteis_semana);
        if (!diasUteisPadrao.length) diasUteisPadrao = [1, 2, 3, 4, 5];
        var permiteDom = diasUteisPadrao.indexOf(0) >= 0;
        var veiculo = row.veiculo_efetivo || o.veiculo || 's10';
        var hoje = hojeSP();

        fechar();
        var dlg = document.createElement('dialog');
        dialogo = dlg;
        dlg.className = 'adm-prazo068-dlg';
        dlg.setAttribute('aria-labelledby', 'prazo068-tit');

        var cal = calMod();
        var calPorMes = Object.create(null);
        var dataEscolhida = row.tipo === 'data' && row.data ? String(row.data).slice(0, 10) : '';
        var mesInicial = (cal && cal.mes(dataEscolhida || row.prazo_ideal || hoje, 0)) || (hoje.slice(0, 7) + '-01');
        var diasIni = row.dias != null ? row.dias : (regra && regra.dias != null ? regra.dias : padrao.prazo_ideal_dias);
        var semanaIni = normalizarDiasSemana((regra && regra.dias_semana) || row.dias_semana || []);
        var auditoria = row.em ? 'Última alteração: ' + esc(row.por || 'equipe') + ' · ' + esc(horaSP(row.em)) + (row.motivo ? ' · ' + esc(row.motivo) : '') : '';

        dlg.innerHTML = '<form class="adm-prazo068-form" novalidate>' +
            '<h2 id="prazo068-tit" class="text-lg font-bold">Entrega agendada do pedido #' + esc(pedido.cd_pedido) + '</h2>' +
            '<p class="text-xs my-1" style="color:var(--adm-tinta-2)">Data combinada com o cliente: o pedido ganha prioridade máxima nessa data.</p>' +
            (row.tipo === 'data' && row.prazo_ideal ? '<p class="text-sm my-2">Data agendada atual: <strong>' + esc(dataBr(row.prazo_ideal)) + '</strong></p>' : '') +
            (auditoria ? '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">' + auditoria + '</p>' : '') +
            '<fieldset class="adm-prazo068-fs" hidden><legend>Aplicar em</legend>' +
                '<label class="adm-prazo068-opt"><input type="radio" name="escopo" value="pedido" checked> Só este pedido (exceção)</label>' +
                '<label class="adm-prazo068-opt"><input type="radio" name="escopo" value="cliente"' + (!doc ? ' disabled' : '') + '> Regra deste cliente (limpa exceção deste pedido)</label>' +
                (!doc ? '<p class="text-xs" style="color:var(--adm-tinta-3)">Pedido sem documento: disponível apenas como exceção por pedido.</p>' : '') +
            '</fieldset>' +
            '<fieldset class="adm-prazo068-fs" hidden><legend>Tipo</legend>' +
                '<label class="adm-prazo068-opt"><input type="radio" name="tipo" value="dias_uteis"> +N dias úteis</label>' +
                '<label class="adm-prazo068-opt" data-prazo068-opt-data><input type="radio" name="tipo" value="data" checked> Data agendada</label>' +
                '<label class="adm-prazo068-opt" data-prazo068-opt-semana hidden><input type="radio" name="tipo" value="semana"> Dias fixos da semana</label>' +
            '</fieldset>' +
            '<label class="block my-3" data-prazo068-blk-dias>Dias úteis (0 a 365)<input type="number" name="dias" class="adm-input" min="0" max="365" step="1" value="' + esc(diasIni) + '"></label>' +
            '<div class="my-3" data-prazo068-blk-data hidden>' +
                '<p class="text-xs mb-2" style="color:var(--adm-tinta-2)">Escolha hoje ou qualquer data útil futura (veículo ' + esc(veiculo) + '):</p>' +
                '<div data-prazo068-cal-wrap>' + (cal ? cal.html({ chave: 'prazo068-' + pedido.cd_pedido, mes: mesInicial, valor: dataEscolhida || null, hoje: hoje, min: hoje, permitirDomingo: permiteDom, indisponivel: function () { return 'Consulte a disponibilidade deste mês'; } }) : '<p role="alert">Calendário indisponível.</p>') + '</div>' +
            '</div>' +
            '<fieldset class="adm-prazo068-fs" data-prazo068-blk-semana hidden><legend>Dias da semana da regra</legend>' +
                '<div class="adm-prazo068-sem">' + DIAS_SEMANA.map(function (d) {
                    var dis = d.v === 0 && !permiteDom;
                    var chk = semanaIni.indexOf(d.v) >= 0 && !dis;
                    return '<label><input type="checkbox" name="semana" value="' + d.v + '"' + (chk ? ' checked' : '') + (dis ? ' disabled' : '') + '> ' + esc(d.curto) + '</label>';
                }).join('') + '</div>' +
                (!permiteDom ? '<p class="text-xs mt-1" style="color:var(--adm-tinta-3)">Domingo só fica disponível se habilitado nas regras da rota.</p>' : '') +
            '</fieldset>' +
            '<label class="block my-3">Motivo (obrigatório, 1 a 200 caracteres)<textarea name="motivo" class="adm-input block w-full" maxlength="200" rows="2" required></textarea></label>' +
            '<p class="text-xs" style="color:var(--adm-tinta-3)"><span data-prazo068-cont>0</span>/200</p>' +
            '<p role="alert" class="adm-entrega-erro" data-prazo068-erro></p>' +
            '<div class="adm-prazo068-acoes">' +
                '<button type="submit" class="adm-botao">Salvar data agendada</button>' +
                (row.excecao ? '<button type="button" class="adm-botao-fantasma" data-prazo068-rem-exc="1">Remover data agendada</button>' : '') +
                
                '<button type="button" class="adm-botao-fantasma" data-prazo068-cancelar="1">Cancelar</button>' +
            '</div>' +
        '</form>';

        var ocupado = false;
        var erroEl = dlg.querySelector('[data-prazo068-erro]');
        var ta = dlg.querySelector('[name=motivo]');
        var cont = dlg.querySelector('[data-prazo068-cont]');
        if (ta && cont) ta.oninput = function () { cont.textContent = String(ta.value.length); };

        function calOptsPara() {
            var calAtual = dlg.querySelector('[data-calendario]');
            var mesVis = (calAtual && calAtual.getAttribute('data-cal-mes')) || mesInicial;
            var dadosMes = calPorMes[mesVis];
            var permiteDomMes = dadosMes ? normalizarDiasSemana(dadosMes.prazo_dias_uteis_semana).indexOf(0) >= 0 : permiteDom;
            var hojeCal = (dadosMes && dadosMes.hoje) || hoje;
            return {
                chave: 'prazo068-' + pedido.cd_pedido,
                mes: mesVis,
                valor: dataEscolhida || null,
                hoje: hojeCal,
                min: hojeCal,
                permitirDomingo: permiteDomMes,
                desabilitado: ocupado,
                indisponivel: function (iso) { return motivoCalendario(iso, calPorMes[cal ? cal.mes(iso, 0) : mesVis]); },
                carregarMes: function (mes) {
                    var atual = getOpts();
                    if (atual.sb !== o.sb || atual.sessao !== o.sessao) return Promise.reject(new Error('Sessão alterada.'));
                    return lerCalendarioPrazo(o.sb, veiculo, mes).then(function (d) {
                        if (getOpts().sb !== o.sb || getOpts().sessao !== o.sessao) throw new Error('Sessão alterada.');
                        calPorMes[cal ? cal.mes(mes, 0) : mes] = d;
                        return d;
                    });
                },
                selecionar: function (iso) { dataEscolhida = iso; erroEl.textContent = ''; }
            };
        }

        var calWrap = dlg.querySelector('[data-prazo068-cal-wrap]');
        if (cal && calWrap) {
            soltarCal = cal.ligar(calWrap, calOptsPara);
        }

        function carregarMesInicialSeNecessario() {
            if (!cal || !calWrap || calPorMes[mesInicial]) return;
            lerCalendarioPrazo(o.sb, veiculo, mesInicial).then(function (d) {
                if (!dlg.isConnected || getOpts().sb !== o.sb || getOpts().sessao !== o.sessao) return;
                calPorMes[mesInicial] = d;
                var box = calWrap.querySelector('[data-calendario]');
                if (box) {
                    var tmp = dlg.ownerDocument.createElement('div');
                    tmp.innerHTML = cal.html(calOptsPara());
                    if (tmp.firstElementChild) box.replaceWith(tmp.firstElementChild);
                }
            }, function (err) {
                if (dlg.isConnected) erroEl.textContent = String((err && err.message) || err);
            });
        }

        function sincronizarVisibilidade() {
            var escopo = dlg.querySelector('[name=escopo]:checked').value;
            var cli = escopo === 'cliente';
            var optData = dlg.querySelector('[data-prazo068-opt-data]');
            var optSem = dlg.querySelector('[data-prazo068-opt-semana]');
            var rData = dlg.querySelector('[name=tipo][value=data]');
            var rSem = dlg.querySelector('[name=tipo][value=semana]');
            var rDias = dlg.querySelector('[name=tipo][value=dias_uteis]');
            optData.hidden = cli; rData.disabled = cli;
            optSem.hidden = !cli; rSem.disabled = !cli;
            var tipo = dlg.querySelector('[name=tipo]:checked').value;
            if (cli && tipo === 'data') { rDias.checked = true; tipo = 'dias_uteis'; }
            if (!cli && tipo === 'semana') { rDias.checked = true; tipo = 'dias_uteis'; }
            dlg.querySelector('[data-prazo068-blk-dias]').hidden = tipo !== 'dias_uteis';
            dlg.querySelector('[data-prazo068-blk-data]').hidden = tipo !== 'data';
            dlg.querySelector('[data-prazo068-blk-semana]').hidden = tipo !== 'semana';
            if (tipo === 'data') carregarMesInicialSeNecessario();
        }

        if (row.tipo === 'data' && dataEscolhida) {
            dlg.querySelector('[name=tipo][value=data]').checked = true;
        }
        dlg.addEventListener('change', function (ev) {
            if (ev.target && (ev.target.name === 'escopo' || ev.target.name === 'tipo')) sincronizarVisibilidade();
        });
        sincronizarVisibilidade();

        function travar(sim) {
            ocupado = sim;
            dlg.querySelectorAll('button').forEach(function (b) { b.disabled = sim; });
        }

        function executarMutacao(fn, btn, rotuloBusy) {
            if (ocupado) return;
            var atual = getOpts();
            if (atual.sb !== o.sb || atual.sessao !== o.sessao || !podeEditar(atual)) { fechar(); return; }
            erroEl.textContent = '';
            var rotAnt = btn ? btn.textContent : '';
            travar(true);
            if (btn) btn.textContent = rotuloBusy || 'Salvando…';
            Promise.resolve().then(fn).then(function () {
                if (!dlg.isConnected || getOpts().sb !== o.sb) return;
                fechar();
                if (typeof raiz.dispatchEvent === 'function' && typeof raiz.CustomEvent === 'function') {
                    raiz.dispatchEvent(new raiz.CustomEvent('temprio-prazo068'));
                }
            }).catch(function (err) {
                if (dlg.isConnected) erroEl.textContent = String((err && err.message) || err);
            }).then(function () {
                if (dlg.isConnected) {
                    travar(false);
                    if (btn) btn.textContent = rotAnt;
                } else {
                    ocupado = false;
                }
            });
        }

        dlg.querySelector('[data-prazo068-cancelar]').onclick = fechar;
        dlg.addEventListener('cancel', function (ev) { if (ocupado) ev.preventDefault(); });
        dlg.addEventListener('close', function () {
            if (soltarCal) { try { soltarCal(); } catch (e) { /* ignore */ } soltarCal = null; }
            if (opener && opener.isConnected) opener.focus();
        });

        var btnRemExc = dlg.querySelector('[data-prazo068-rem-exc]');
        if (btnRemExc) {
            btnRemExc.onclick = function () {
                executarMutacao(function () {
                    return removerExcecao(o.sb, pedido.cd_pedido, ta ? ta.value : null);
                }, btnRemExc, 'Removendo…');
            };
        }
        var btnRemReg = dlg.querySelector('[data-prazo068-rem-reg]');
        if (btnRemReg) {
            btnRemReg.onclick = function () {
                executarMutacao(function () {
                    return removerRegra(o.sb, doc, ta ? ta.value : null);
                }, btnRemReg, 'Removendo…');
            };
        }

        dlg.querySelector('form').onsubmit = function (ev) {
            ev.preventDefault();
            var escopo = dlg.querySelector('[name=escopo]:checked').value;
            var tipo = dlg.querySelector('[name=tipo]:checked').value;
            var dias = Number(dlg.querySelector('[name=dias]').value);
            var motivo = limparMotivo(ta ? ta.value : '');
            var semana = Array.from(dlg.querySelectorAll('[name=semana]:checked')).map(function (c) { return Number(c.value); });
            if (!motivoValido(motivo)) { erroEl.textContent = MOTIVOS_ERRO.motivo_invalido; return; }
            if (tipo === 'dias_uteis' && (!Number.isInteger(dias) || dias < 0 || dias > 365)) {
                erroEl.textContent = 'Informe de 0 a 365 dias úteis.'; return;
            }
            if (tipo === 'data' && !dataEscolhida) {
                erroEl.textContent = 'Escolha uma data útil no calendário.'; return;
            }
            if (tipo === 'semana' && !semana.length) {
                erroEl.textContent = 'Selecione pelo menos um dia da semana.'; return;
            }
            var btnSubmit = dlg.querySelector('[type=submit]');
            executarMutacao(function () {
                return salvarPrazo(o.sb, {
                    p_cd_pedido: pedido.cd_pedido,
                    p_tipo: tipo,
                    p_dias: tipo === 'dias_uteis' ? dias : null,
                    p_data: tipo === 'data' ? dataEscolhida : null,
                    p_escopo: escopo,
                    p_motivo: motivo,
                    p_regra_dias_semana: tipo === 'semana' ? semana : null
                });
            }, btnSubmit, 'Salvando…');
        };

        document.body.appendChild(dlg);
        dlg.showModal();
        if (ta) ta.focus();
    }

    function ligar(el, getOpts, pedidos) {
        if (!el || !parteBAtiva()) return;
        (pedidos || []).forEach(function (p) { if (p && p.cd_pedido != null) registroPedidos[Number(p.cd_pedido)] = p; });
        el.querySelectorAll('[data-prazo068-cd]').forEach(function (b) {
            b.onclick = function (ev) {
                ev.stopPropagation();
                var cd = Number(b.getAttribute('data-prazo068-cd'));
                var ped = registroPedidos[cd];
                if (ped) abrirPrazo(ped, getOpts, b);
            };
            b.onkeydown = function (ev) { ev.stopPropagation(); };
        });
    }

    var api = {
        lerTudo: lerTudo,
        lerPrazos: lerPrazos,
        lerRegras: lerRegras,
        lerPadrao: lerPadrao,
        salvarPrazo: salvarPrazo,
        removerExcecao: removerExcecao,
        removerRegra: removerRegra,
        salvarPadrao: salvarPadrao,
        lerCalendarioPrazo: lerCalendarioPrazo,
        motivoCalendario: motivoCalendario,
        textoDiasSemana: textoDiasSemana,
        htmlCard: htmlCard,
        abrirPrazo: abrirPrazo,
        ligar: ligar,
        fechar: fechar
    };

    raiz.TempRioPrazo068B = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
