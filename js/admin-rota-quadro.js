/* =====================================================================
 * 065 + 066 — QUADRO DA SEMANA + ASSISTENTE DE PLANEJAMENTO (js/admin-rota-quadro.js)
 *
 * Módulo de UI para programar a semana arrastando cartões ou pelo
 * menu acessível de teclado ("Programar para…" / "Mover / tirar…"),
 * com mapa interativo da semana (066), avisos de atraso e sugestões explicáveis.
 *
 * Contrato front <-> backend 065 (docs/plans/2026-11-25-semana-065-contrato.md):
 *   - Ler: rota_065_ler_semana(p_inicio) ->
 *     { status:'ok', inicio, hoje, versao, itens:[{cd_pedido,dia,veiculo_id,ordem,removido}],
 *       sem_saida:[{dia,veiculo_id,motivo}], fechados:['YYYY-MM-DD'] }
 *   - Salvar: rota_065_salvar_semana(p_inicio, p_versao_base, p_itens, p_veiculo) ->
 *     { status:'ok', versao, itens } | { status:'erro', motivo, cd_pedido? }
 *   - Sem saída avulsa: rota_065_marcar_sem_saida(p_dia, p_veiculo, p_sem_saida, p_versao_base, p_motivo)
 *
 * Contrato front <-> backend 066 (assistente de planejamento):
 *   - Sugestões: rota_066_sugestoes(p_semana) ->
 *     { versao, pedidos:[{cd_pedido,dia_sugerido,veiculo_sugerido,motivo,texto,score,prazo,atrasado_se_dia}],
 *       dias:[{dia,veiculo_id,cx_planejadas,cx_capacidade,paradas,folga_cx,folga_paradas}],
 *       encaixes:[{dia,veiculo_id,cd_pedido,distancia_km,perto_de_cd,texto}] }
 *   - Feedback: rota_066_registrar(p_cd, p_acao, p_dia)
 * ===================================================================== */
(function (raiz) {
    'use strict';

    var ehNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
    var calendario = ehNode ? require('./admin-calendario.js') : raiz.TempRioCalendario;
    var core = ehNode ? require('../supabase/functions/_shared/rota-core.js') : raiz.TempRioRotaCore;
    var VOLUME_CX24 = (core && core.ROTA && core.ROTA.VOLUME_CX24) || 9;
    var ORIGEM_PADRAO = (core && core.ROTA && core.ROTA.ORIGEM) || [-23.0030, -43.3264];
    var CEASA_CENTRO = (core && core.ROTA && core.ROTA.CEASA_CENTRO) || [-22.8269, -43.3400];
    var CEASA_CD_NOME = (core && core.ROTA && core.ROTA.CEASA_CD_NOME) || 'CD CEASA';
    var NUM = new Intl.NumberFormat('pt-BR');
    var NUM1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

    var DIAS_CURTOS = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb' };
    var DIAS_MIN = { 0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sáb' };
    var CORES_DIA_VEIC = {
        '1|s10': '#3b82f6', '1|caminhao': '#d97706',
        '2|s10': '#10b981', '2|caminhao': '#b45309',
        '3|s10': '#a855f7', '3|caminhao': '#c2410c',
        '4|s10': '#f59e0b', '4|caminhao': '#92400e',
        '5|s10': '#ec4899', '5|caminhao': '#b91c1c',
        '6|s10': '#06b6d4', '6|caminhao': '#ea580c'
    };
    var CORES_DIA_FALLBACK = ['#3b82f6', '#3b82f6', '#10b981', '#a855f7', '#f59e0b', '#ec4899', '#ea580c'];

    var SIT_META = {
        vencido:  { rotulo: 'Vencido',        classe: 'rota-sit-vencido', icone: 'fa-triangle-exclamation' },
        hoje:     { rotulo: 'Vence hoje',     classe: 'rota-sit-hoje',    icone: 'fa-hourglass-end' },
        amanha:   { rotulo: 'Vence amanhã',   classe: 'rota-sit-amanha',  icone: 'fa-hourglass-half' },
        ok:       { rotulo: 'No prazo',       classe: 'rota-sit-ok',      icone: 'fa-check' },
        sem_data: { rotulo: 'Sem prazo',      classe: 'rota-sit-amanha',  icone: 'fa-question' }
    };
    var MOTIVO_BANDEJA = {
        capacidade:     { rotulo: 'Excede capacidade', classe: 'rota-selo',          icone: 'fa-box' },
        sem_posicao:    { rotulo: 'Sem posição',       classe: 'rota-selo',          icone: 'fa-location-dot' },
        falta_marcar:   { rotulo: 'Falta marcar',      classe: 'rota-sit-hoje',      icone: 'fa-hand-pointer' },
        dia_fechado:    { rotulo: 'Cliente fechado',   classe: 'rota-selo-fechado',  icone: 'fa-calendar-xmark' },
        outra_semana:   { rotulo: 'Outra semana',      classe: 'rota-selo-plano',    icone: 'fa-calendar-days' },
        removido:       { rotulo: 'Tirado do dia',     classe: 'rota-selo-fechado',  icone: 'fa-arrow-rotate-left' },
        sem_dia:        { rotulo: 'Sem dia',           classe: 'rota-selo',          icone: 'fa-clock' }
    };

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function dataBr(iso) {
        if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(String(iso))) return '';
        var p = String(iso).slice(0, 10).split('-');
        return p[2] + '/' + p[1];
    }

    function diaSemana(iso) {
        if (core && typeof core.diaSemana === 'function') return core.diaSemana(iso);
        var p = String(iso || '').slice(0, 10).split('-');
        if (p.length !== 3) return 1;
        return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0)).getUTCDay();
    }

    function somaDias(iso, n) {
        if (core && typeof core.somaDias === 'function') return core.somaDias(iso, n);
        var p = String(iso).slice(0, 10).split('-');
        var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + Number(n), 12, 0, 0));
        return d.toISOString().slice(0, 10);
    }

    function segundaDe(iso) {
        if (core && typeof core.segundaDe === 'function') return core.segundaDe(iso);
        var w = diaSemana(iso);
        return somaDias(iso, w === 0 ? -6 : 1 - w);
    }

    function diferencaDias(isoA, isoB) {
        if (!isoA || !isoB) return 0;
        var a = String(isoA).slice(0, 10).split('-');
        var b = String(isoB).slice(0, 10).split('-');
        if (a.length !== 3 || b.length !== 3) return 0;
        var tA = Date.UTC(Number(a[0]), Number(a[1]) - 1, Number(a[2]), 12, 0, 0);
        var tB = Date.UTC(Number(b[0]), Number(b[1]) - 1, Number(b[2]), 12, 0, 0);
        if (!isFinite(tA) || !isFinite(tB)) return 0;
        return Math.round((tA - tB) / 86400000);
    }

    function distKm(a, b) {
        if (!a || !b || !isFinite(a[0]) || !isFinite(a[1]) || !isFinite(b[0]) || !isFinite(b[1])) return null;
        if (core && typeof core.km === 'function') return Math.round(core.km(a, b) * 10) / 10;
        var R = 6371;
        var dLat = (b[0] - a[0]) * Math.PI / 180;
        var dLng = (b[1] - a[1]) * Math.PI / 180;
        var s1 = Math.sin(dLat / 2), s2 = Math.sin(dLng / 2);
        var c = s1 * s1 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * s2 * s2;
        return Math.round(2 * R * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c)) * 10) / 10;
    }

    function formatarVolume(c) {
        if (c && c.txtVolume) return String(c.txtVolume);
        var c24 = Number(c && c.c24) || 0;
        var c48 = Number(c && c.c48) || 0;
        var av = Number(c && c.avulsos) || 0;
        var partes = [];
        if (c24) partes.push(NUM.format(c24) + ' cx24');
        if (c48) partes.push(NUM.format(c48) + ' cx48');
        if (av) partes.push(NUM.format(av) + (av === 1 ? ' pote' : ' potes'));
        if (partes.length) return partes.join(' + ');
        if (c && c.volume != null && isFinite(Number(c.volume)) && Number(c.volume) > 0) {
            return '~' + NUM.format(Math.round(Number(c.volume) / VOLUME_CX24)) + ' cx24';
        }
        return 'volume a conferir';
    }

    function normalizarVeiculos(lista) {
        var padrao = [
            { id: 's10',      nome: 'S10',              modo: 'porta',    cor: '#2563eb', capacidade: 2700, diasSemSaida: [0, 6], ativo: true },
            { id: 'caminhao', nome: 'Caminhão (CEASA)', modo: 'cd_ceasa', cor: '#b45309', capacidade: null, diasSemSaida: [0],    ativo: true },
            { id: 'strada',   nome: 'Strada',           modo: 'porta',    cor: '#059669', capacidade: null, diasSemSaida: [0, 6], ativo: false }
        ];
        var base = Array.isArray(lista) && lista.length ? lista : padrao;
        var porId = Object.create(null);
        var ativos = [];
        base.forEach(function (v) {
            if (!v || !v.id || v.id === '__proto__' || v.id === 'constructor' || v.id === 'prototype') return;
            var cap = v.capacidade != null ? Number(v.capacidade) : (v.capacidade_volume != null ? Number(v.capacidade_volume) : null);
            if (cap != null && (!isFinite(cap) || cap <= 0)) cap = null;
            var dss = Array.isArray(v.diasSemSaida) ? v.diasSemSaida.slice() : (Array.isArray(v.dias_sem_saida) ? v.dias_sem_saida.slice() : [0]);
            if (dss.indexOf(0) < 0) dss.push(0);
            var ehAtivo = v.ativo !== false && v.ativo !== 0;
            var norm = {
                id: String(v.id),
                nome: String(v.nome || v.id),
                modo: v.modo === 'cd_ceasa' ? 'cd_ceasa' : 'porta',
                cor: /^#[0-9a-f]{6}$/i.test(String(v.cor || '')) ? String(v.cor).toLowerCase() : '#64748b',
                capacidade: cap,
                capacidadeCx24: cap == null ? null : Math.round(cap / VOLUME_CX24),
                semLimite: cap == null,
                diasSemSaida: dss,
                ativo: ehAtivo
            };
            if (norm.ativo) {
                porId[norm.id] = norm;
                ativos.push(norm);
            }
        });
        return { lista: ativos, porId: porId };
    }

    function veiculoSaiNoDia(veic, isoDia, feriado, semSaidaVeiculos) {
        if (!veic || !veic.ativo || feriado) return false;
        var w = diaSemana(isoDia);
        if (veic.diasSemSaida.indexOf(w) >= 0) return false;
        if (semSaidaVeiculos && Object.prototype.hasOwnProperty.call(semSaidaVeiculos, veic.id)) return false;
        return true;
    }

    function extrairPosicao(raw) {
        if (!raw) return null;
        if (Array.isArray(raw.pos) && raw.pos.length >= 2 && isFinite(Number(raw.pos[0])) && isFinite(Number(raw.pos[1]))) {
            return [Number(raw.pos[0]), Number(raw.pos[1])];
        }
        if (raw.lat != null && raw.lng != null && isFinite(Number(raw.lat)) && isFinite(Number(raw.lng))) {
            return [Number(raw.lat), Number(raw.lng)];
        }
        if (raw.c && Array.isArray(raw.c.pos) && raw.c.pos.length >= 2 && isFinite(Number(raw.c.pos[0])) && isFinite(Number(raw.c.pos[1]))) {
            return [Number(raw.c.pos[0]), Number(raw.c.pos[1])];
        }
        if (raw.c && raw.c.lat != null && raw.c.lng != null && isFinite(Number(raw.c.lat)) && isFinite(Number(raw.c.lng))) {
            return [Number(raw.c.lat), Number(raw.c.lng)];
        }
        return null;
    }

    function normalizarCartao(raw, frota, diaColuna, editavelColuna, hoje) {
        var cd = Number(raw && (raw.cd_pedido != null ? raw.cd_pedido : (raw.p && raw.p.cd_pedido)));
        var vid = String((raw && raw.veiculo) || (raw && raw.veiculo_id) || '');
        var v = (vid && frota.porId[vid]) || null;
        var c24 = Number(raw && (raw.c24 != null ? raw.c24 : (raw.v && raw.v.c24))) || 0;
        var c48 = Number(raw && (raw.c48 != null ? raw.c48 : (raw.v && raw.v.c48))) || 0;
        var avulsos = Number(raw && (raw.avulsos != null ? raw.avulsos : (raw.v && raw.v.avulsos))) || 0;
        var volBruto = raw && (raw.volume != null ? raw.volume : (raw.v && raw.v.vol));
        var volume = volBruto != null && isFinite(Number(volBruto)) ? Number(volBruto) : (c24 || c48 || avulsos ? c24 * 9 + c48 * 16.5 + avulsos * 0.375 : null);
        var prazo = raw && raw.prazo ? String(raw.prazo).slice(0, 10) : null;
        var atrasadoSeDia = raw && raw.atrasado_se_dia ? String(raw.atrasado_se_dia).slice(0, 10) : (raw && raw.atrasadoSeDia ? String(raw.atrasadoSeDia).slice(0, 10) : null);
        var refDia = diaColuna || hoje || null;
        var sit = raw && raw.situacao ? String(raw.situacao) : null;
        if (!sit || !SIT_META[sit]) {
            if (!prazo) sit = 'sem_data';
            else if (refDia && prazo < refDia) sit = 'vencido';
            else if (refDia && prazo === refDia) sit = 'hoje';
            else sit = 'ok';
        }
        // 066: atraso em dias quando o cartão cai num dia DEPOIS do prazo/vencimento
        var atrasoDias = 0;
        if (diaColuna && prazo && diaColuna > prazo) {
            atrasoDias = Math.max(1, diferencaDias(diaColuna, prazo));
        } else if (diaColuna && !prazo && atrasadoSeDia && diaColuna >= atrasadoSeDia) {
            atrasoDias = Math.max(1, diferencaDias(diaColuna, atrasadoSeDia) + 1);
        }
        var atrasado = atrasoDias > 0;
        var estoura = atrasado || (raw && raw.estoura != null ? !!(raw.estoura && (!diaColuna || !prazo || diaColuna > prazo)) : false);
        if (diaColuna && prazo) {
            // Se o cartão está num dia <= prazo, não estoura o prazo naquele dia
            if (diaColuna <= prazo) {
                atrasoDias = 0;
                atrasado = false;
                estoura = false;
                if (sit === 'vencido') sit = diaColuna === prazo ? 'hoje' : 'ok';
            } else {
                sit = 'vencido';
            }
        }
        var bloqueadoProprio = !!(raw && (raw._bloqueadoProprio !== undefined ? raw._bloqueadoProprio : raw.bloqueado));
        var entregue = raw && typeof raw.entregue === 'boolean' ? raw.entregue : undefined;
        // Contrato H: a origem só depende da flag canônica; a coluna governa o destino.
        var bloqueado = entregue !== undefined ? entregue : bloqueadoProprio || (diaColuna != null && !editavelColuna);
        var cliente = String((raw && (raw.cliente || raw.nome)) || (raw && raw.c && raw.c.nome) || (raw && raw.p && raw.p.cliente_nome) || ('Pedido #' + cd));
        var bairro = String((raw && raw.bairro) || (raw && raw.c && raw.c.bairro) || '').trim();
        var cidade = String((raw && raw.cidade) || (raw && raw.c && raw.c.cidade) || '').trim();
        var modoVeiculo = v ? v.modo : (raw && raw.modoVeiculo) || (vid === 'caminhao' ? 'cd_ceasa' : 'porta');
        var pos = extrairPosicao(raw);
        // UI066-R2: no modo cd_ceasa o destino do caminhão é sempre a parada única do CD CEASA (coordenada canônica no core)
        var semGeo = modoVeiculo === 'cd_ceasa' ? false : !pos;
        return {
            cd_pedido: cd,
            documento: String((raw && raw.documento) || (raw && raw.p && raw.p.documento) || ''),
            cliente: cliente,
            bairro: bairro,
            cidade: cidade,
            localizacao: [bairro || 'Sem bairro', cidade].filter(Boolean).join(' · '),
            pos: pos,
            semGeo: semGeo,
            prazo: prazo,
            atrasadoSeDia: atrasadoSeDia,
            atrasoDias: atrasoDias,
            atrasado: atrasado,
            situacao: sit,
            estoura: estoura,
            diaFechado: !!(raw && raw.diaFechado),
            prioridade: !!(raw && (raw.prioridade || (raw.regra && raw.regra.prioridade))),
            janela: String((raw && (raw.janela || (raw.regra && raw.regra.janela))) || ''),
            obs: String((raw && (raw.obs || (raw.regra && raw.regra.obs))) || ''),
            volume: volume,
            c24: c24,
            c48: c48,
            avulsos: avulsos,
            txtVolume: formatarVolume({ txtVolume: raw && raw.txtVolume, c24: c24, c48: c48, avulsos: avulsos, volume: volume }),
            veiculo: v ? v.id : vid,
            nomeVeiculo: v ? (v.id === 'caminhao' ? 'CEASA' : v.nome) : (raw && raw.nomeVeiculo) || vid || 'Sem veículo',
            corVeiculo: v ? v.cor : (raw && raw.corVeiculo) || '#64748b',
            modoVeiculo: modoVeiculo,
            faltaMarcar: !vid || !!(raw && raw.faltaMarcar),
            entregue: entregue,
            veiculoSomenteLeitura: entregue !== undefined ? entregue : !!(raw && raw.veiculoSomenteLeitura),
            dia: diaColuna || (raw && raw.dia ? String(raw.dia).slice(0, 10) : null),
            diaAnterior: raw && raw.diaAnterior ? String(raw.diaAnterior).slice(0, 10) : null,
            ordem: raw && raw.ordem != null ? Number(raw.ordem) : null,
            eta: raw && raw.eta ? String(raw.eta) : null,
            origemDia: raw && raw.origemDia ? String(raw.origemDia) : null,
            motivoBandeja: raw && raw.motivoBandeja ? String(raw.motivoBandeja) : null,
            _bloqueadoProprio: bloqueadoProprio,
            bloqueado: bloqueado
        };
    }

    function recalcularDia(d, frota, veiculoFiltro, hoje, podeEditarGlobal, fechadosSet, semSaidaPorDia, usarSemSaidaCanonico) {
        var iso = String(d.dia).slice(0, 10);
        var w = diaSemana(iso);
        var feriado = !!d.feriado;
        var fechada = !!d.fechada || !!(fechadosSet && fechadosSet[iso]);
        // UI065-R3-A: quando o estado traz a lista canonica sem_saida, reconstruir semSaidaVeiculos apenas dela
        var semSaidaVeiculos = usarSemSaidaCanonico
            ? Object.assign(Object.create(null), (semSaidaPorDia && semSaidaPorDia[iso]) || {})
            : Object.assign(Object.create(null), d.semSaidaVeiculos || {}, (semSaidaPorDia && semSaidaPorDia[iso]) || {});
        var veicAtivo = veiculoFiltro && veiculoFiltro !== 'todos' ? frota.porId[veiculoFiltro] : null;
        var veicsQueSaem = frota.lista.filter(function (v) { return veiculoSaiNoDia(v, iso, feriado, semSaidaVeiculos); });
        var saiNoFiltro = veicAtivo ? veiculoSaiNoDia(veicAtivo, iso, feriado, semSaidaVeiculos) : veicsQueSaem.length > 0;

        // UI065-R5: recalcular leituraMotivo e editavel sempre a partir da data, feriado, fechamento e filtro atual
        var leituraMotivo = null;
        if (hoje && iso < hoje) leituraMotivo = 'passado';
        else if (hoje && iso === hoje) leituraMotivo = fechada ? 'fechada' : 'hoje';
        else if (fechada) leituraMotivo = 'fechada';
        else if (feriado) leituraMotivo = 'feriado';
        else if (!saiNoFiltro) leituraMotivo = 'sem_saida';
        else if (d.somenteLeitura) leituraMotivo = 'leitura';
        var editavel = !leituraMotivo && saiNoFiltro;
        var podeMexerDia = !!podeEditarGlobal && editavel;

        var contOrdem = Object.create(null);
        var todosCartoes = (d.cartoes || d.pedidos || []).map(function (c) {
            var cVeic = (c && (c.veiculo || c.veiculo_id)) || '';
            var vObj = cVeic ? frota.porId[cVeic] : null;
            var saiVeicCard = !vObj || veiculoSaiNoDia(vObj, iso, feriado, semSaidaVeiculos);
            var editavelCard = podeMexerDia && saiVeicCard && !(hoje && (d.movimentoAtomico ? iso < hoje : iso <= hoje)) && !fechada && !feriado;
            var norm = normalizarCartao(c, frota, iso, editavelCard, hoje);
            if (norm.modoVeiculo === 'cd_ceasa') {
                norm.ordem = null;
            } else {
                var k = norm.veiculo || 's10';
                contOrdem[k] = (contOrdem[k] || 0) + 1;
                norm.ordem = contOrdem[k];
            }
            return norm;
        });

        var cartoesVisiveis = veicAtivo
            ? todosCartoes.filter(function (c) { return c.veiculo === veicAtivo.id; })
            : todosCartoes;

        var vol = 0, volComLimite = 0, c24 = 0, c48 = 0, avulsos = 0, desc = 0, estouram = 0, atrasados = 0, fechados = 0, semGeo = 0;
        cartoesVisiveis.forEach(function (c) {
            c24 += c.c24; c48 += c.c48; avulsos += c.avulsos;
            if (c.volume == null) {
                desc++;
            } else {
                vol += c.volume;
                var vc = frota.porId[c.veiculo];
                if (!vc || vc.capacidade != null) volComLimite += c.volume;
            }
            if (c.atrasado || c.atrasoDias > 0) atrasados++;
            if (c.estoura || c.situacao === 'vencido' || c.atrasado) estouram++;
            if (c.diaFechado) fechados++;
            if (c.semGeo) semGeo++;
        });

        var cap = null;
        if (veicAtivo) {
            cap = veicAtivo.capacidade;
        } else if (d.capacidade != null && isFinite(Number(d.capacidade))) {
            cap = Number(d.capacidade);
        } else {
            var somaCap = 0, temCap = false;
            veicsQueSaem.forEach(function (v) {
                if (v.capacidade != null) { somaCap += v.capacidade; temCap = true; }
            });
            cap = temCap ? somaCap : null;
        }
        var volParaCap = veicAtivo ? vol : volComLimite;
        var usadoCx24 = Math.round(vol / VOLUME_CX24);
        var usadoCapCx24 = Math.round(volParaCap / VOLUME_CX24);
        var capCx24 = cap == null ? null : Math.round(cap / VOLUME_CX24);
        var ocupacao = cap == null ? null : volParaCap / cap;
        var ocupacaoPct = ocupacao == null ? null : Math.round(ocupacao * 100);
        var excesso = cap != null && volParaCap > cap + 1e-9;

        return {
            dia: iso,
            nome: d.nome || DIAS_CURTOS[w] || iso,
            rotuloCurto: DIAS_CURTOS[w] || d.nome || iso,
            dataCurta: dataBr(iso),
            regiao: String(d.regiao || (cartoesVisiveis.length ? resumirBairros(cartoesVisiveis) : 'Sem entregas')),
            feriado: feriado,
            fechada: fechada,
            semSaidaVeiculos: semSaidaVeiculos,
            leituraMotivo: leituraMotivo,
            editavel: editavel,
            veiculosDia: veicsQueSaem.map(function (v) { return v.id; }),
            volume: vol,
            capacidade: cap,
            usadoCx24: usadoCx24,
            usadoCapCx24: usadoCapCx24,
            capacidadeCx24: capCx24,
            ocupacao: ocupacao,
            ocupacaoPct: ocupacaoPct,
            excesso: excesso,
            c24: c24,
            c48: c48,
            avulsos: avulsos,
            desconhecidos: desc,
            estouram: estouram,
            atrasados: atrasados,
            fechados: fechados,
            semGeo: semGeo,
            km: d.km != null ? Number(d.km) : null,
            horario: d.horario || null,
            cartoes: todosCartoes,
            cartoesVisiveis: cartoesVisiveis
        };
    }

    function resumirBairros(cartoes) {
        var cont = Object.create(null), lista = [];
        (cartoes || []).forEach(function (c) {
            var b = c.bairro;
            if (!b) return;
            if (!cont[b]) { cont[b] = 0; lista.push(b); }
            cont[b]++;
        });
        lista.sort(function (a, b) { return cont[b] - cont[a] || a.localeCompare(b); });
        if (!lista.length) return 'Sem bairro';
        return lista.slice(0, 2).join(', ') + (lista.length > 2 ? ' (+' + (lista.length - 2) + ')' : '');
    }

    // ===================== 066: STUB DO CONTRATO rota_066_sugestoes =====================
    function gerarStubSugestoes066(estadoBase) {
        var dias = (estadoBase && estadoBase.dias) || [];
        var bandeja = (estadoBase && estadoBase.bandeja) || [];
        var frotaPorId = (estadoBase && estadoBase.veiculosPorId) || Object.create(null);
        var frotaLista = (estadoBase && estadoBase.veiculos) || [];
        var hoje = (estadoBase && estadoBase.hoje) || '2026-11-25';

        var diasInfo = [];
        var folgaPorDiaVeic = Object.create(null);
        dias.forEach(function (col) {
            frotaLista.forEach(function (v) {
                if (!veiculoSaiNoDia(v, col.dia, col.feriado, col.semSaidaVeiculos)) return;
                var cartoesVeic = (col.cartoes || []).filter(function (c) { return c.veiculo === v.id; });
                var vol = 0;
                cartoesVeic.forEach(function (c) { if (c.volume != null) vol += c.volume; });
                var cxPlan = Math.round(vol / VOLUME_CX24);
                var cxCap = v.capacidadeCx24;
                var paradas = v.modo === 'cd_ceasa' ? (cartoesVeic.length ? 1 : 0) : cartoesVeic.length;
                var maxParadas = v.modo === 'cd_ceasa' ? 1 : 12;
                var folgaCx = cxCap != null ? Math.max(0, cxCap - cxPlan) : null;
                var folgaPar = v.modo === 'cd_ceasa' ? null : Math.max(0, maxParadas - paradas);
                var itemDia = {
                    dia: col.dia,
                    veiculo_id: v.id,
                    cx_planejadas: cxPlan,
                    cx_capacidade: cxCap,
                    paradas: paradas,
                    folga_cx: folgaCx,
                    folga_paradas: folgaPar
                };
                diasInfo.push(itemDia);
                folgaPorDiaVeic[col.dia + '|' + v.id] = itemDia;
            });
        });

        var pedidosSug = [];
        var encaixesSug = [];
        var diasEditaveis = dias.filter(function (col) {
            return col.editavel && (!hoje || col.dia > hoje) && !col.fechada && !col.feriado;
        });

        // Para cada cartão na bandeja, calcula dia_sugerido + veiculo_sugerido + motivo + texto
        bandeja.forEach(function (c) {
            if (!c || !c.cd_pedido || c.bloqueado) return;
            var vid = c.veiculo && frotaPorId[c.veiculo] ? c.veiculo : 's10';
            var vObj = frotaPorId[vid] || frotaLista[0];
            if (!vObj) return;
            var candidatos = diasEditaveis.filter(function (col) {
                return veiculoSaiNoDia(vObj, col.dia, col.feriado, col.semSaidaVeiculos);
            });
            if (!candidatos.length) return;

            var cxCard = Math.max(1, Math.round((c.volume || VOLUME_CX24) / VOLUME_CX24));
            var prazo = c.prazo || null;
            var vencidoOuHoje = !!(prazo && prazo <= hoje);

            // Procura se algum dia candidato (<= prazo, ou qualquer se vencido) já tem cliente da mesma região/próximo
            var melhorDia = null;
            var motivos = [];
            var ancoraRegiao = null;
            var menorDist = Infinity;

            candidatos.forEach(function (col) {
                if (!vencidoOuHoje && prazo && col.dia > prazo) return;
                var infoFolga = folgaPorDiaVeic[col.dia + '|' + vObj.id];
                if (infoFolga && infoFolga.folga_cx != null && infoFolga.folga_cx < cxCard) return;
                var cartoesVeic = (col.cartoes || []).filter(function (x) { return x.veiculo === vObj.id; });
                cartoesVeic.forEach(function (x) {
                    var mesmoBairro = c.bairro && x.bairro && c.bairro.toLowerCase() === x.bairro.toLowerCase();
                    var dKm = (c.pos && x.pos) ? distKm(c.pos, x.pos) : null;
                    if (mesmoBairro || (dKm != null && dKm <= 3.5)) {
                        var scoreDist = dKm != null ? dKm : 1.0;
                        if (scoreDist < menorDist) {
                            menorDist = scoreDist;
                            melhorDia = col;
                            ancoraRegiao = x;
                        }
                    }
                });
            });

            if (melhorDia && ancoraRegiao) {
                motivos = vencidoOuHoje ? ['vencido', 'mesma_regiao'] : ['prazo', 'mesma_regiao'];
            } else if (vencidoOuHoje) {
                // Vencido / vence hoje -> primeiro dia disponível com folga (ou o primeiro dia disponível)
                melhorDia = candidatos.filter(function (col) {
                    var f = folgaPorDiaVeic[col.dia + '|' + vObj.id];
                    return !f || f.folga_cx == null || f.folga_cx >= cxCard;
                })[0] || candidatos[0];
                motivos = [prazo < hoje ? 'vencido' : 'vence_hoje'];
            } else if (prazo) {
                // Prazo futuro -> último dia de saída útil <= prazo com folga
                var atePrazo = candidatos.filter(function (col) { return col.dia <= prazo; });
                var comFolga = atePrazo.filter(function (col) {
                    var f = folgaPorDiaVeic[col.dia + '|' + vObj.id];
                    return !f || f.folga_cx == null || f.folga_cx >= cxCard;
                });
                var listaBase = comFolga.length ? comFolga : (atePrazo.length ? atePrazo : candidatos);
                melhorDia = listaBase[listaBase.length - 1];
                motivos = ['ultimo_util_prazo'];
            } else {
                melhorDia = candidatos[0];
                motivos = ['capacidade'];
            }

            if (!melhorDia) return;
            var wPrazo = prazo ? DIAS_MIN[diaSemana(prazo)] : null;
            var wSug = DIAS_MIN[diaSemana(melhorDia.dia)];
            var txtPrazo = !prazo ? 'Sem prazo' : (prazo < hoje ? 'Vencido (' + dataBr(prazo) + ')' : (prazo === hoje ? 'Vence hoje' : 'Vence ' + wPrazo));
            var detalheMot = ancoraRegiao
                ? 'mesma região de ' + ancoraRegiao.cliente
                : (vencidoOuHoje ? '1ª saída útil' : 'última saída útil no prazo');
            var texto = txtPrazo + ' — sugerido ' + wSug + ' (' + detalheMot + ')';

            pedidosSug.push({
                cd_pedido: c.cd_pedido,
                dia_sugerido: melhorDia.dia,
                veiculo_sugerido: vObj.id,
                motivo: motivos,
                texto: texto,
                score: vencidoOuHoje ? 115 : (ancoraRegiao ? 88 : 75),
                prazo: prazo,
                atrasado_se_dia: prazo ? somaDias(prazo, 1) : null,
                dia_plano: null
            });
        });

        // Encaixes por coluna: dia editável com folga de cx na S10 (ou veículo porta) e pedido próximo que cabe
        diasEditaveis.forEach(function (col) {
            frotaLista.forEach(function (v) {
                if (v.modo !== 'porta' || v.capacidadeCx24 == null) return;
                var info = folgaPorDiaVeic[col.dia + '|' + v.id];
                if (!info || info.folga_cx == null || info.folga_cx < 15) return;
                var paradasDia = (col.cartoes || []).filter(function (x) { return x.veiculo === v.id; });
                if (!paradasDia.length) return;

                var melhorCand = null, melhorAncora = null, melhorKm = Infinity;
                bandeja.forEach(function (c) {
                    if (!c || !c.cd_pedido || c.bloqueado) return;
                    if (c.veiculo && c.veiculo !== v.id) return;
                    var cxC = Math.max(1, Math.round((c.volume || VOLUME_CX24) / VOLUME_CX24));
                    if (cxC > info.folga_cx) return;
                    paradasDia.forEach(function (anc) {
                        var dKm = (c.pos && anc.pos) ? distKm(c.pos, anc.pos) : ((c.bairro && anc.bairro && c.bairro === anc.bairro) ? 1.2 : null);
                        if (dKm != null && dKm < melhorKm) {
                            melhorKm = dKm;
                            melhorCand = c;
                            melhorAncora = anc;
                        }
                    });
                });

                if (melhorCand && melhorAncora) {
                    var wDia = DIAS_MIN[diaSemana(col.dia)];
                    encaixesSug.push({
                        dia: col.dia,
                        veiculo_id: v.id,
                        cd_pedido: melhorCand.cd_pedido,
                        distancia_km: melhorKm,
                        perto_de_cd: melhorAncora.cd_pedido,
                        texto: v.nome + ' tem ' + NUM.format(info.folga_cx) + ' cx livres na ' + wDia + ': cabe Pedido ' + melhorCand.cd_pedido + ' (' + NUM1.format(melhorKm) + ' km de ' + melhorAncora.cliente + ')'
                    });
                }
            });
        });

        var versaoStub = estadoBase && estadoBase.versaoBase != null && isFinite(Number(estadoBase.versaoBase))
            ? Number(estadoBase.versaoBase)
            : 0;
        return {
            status: 'ok',
            semana: (estadoBase && estadoBase.inicio) || null,
            hoje: hoje,
            versao: versaoStub,
            pedidos: pedidosSug,
            dias: diasInfo,
            encaixes: encaixesSug
        };
    }

    function normalizarSugestoes066(raw, estadoBase) {
        var versaoBase = estadoBase && estadoBase.versaoBase != null && isFinite(Number(estadoBase.versaoBase))
            ? Number(estadoBase.versaoBase)
            : 0;
        var inicioBase = (estadoBase && estadoBase.inicio) ? String(estadoBase.inicio).slice(0, 10) : null;
        var foiPassado = raw !== undefined && raw !== null;
        var base = foiPassado && typeof raw === 'object' ? raw : gerarStubSugestoes066(estadoBase);

        var versaoSug = base.versao != null && isFinite(Number(base.versao)) ? Number(base.versao) : versaoBase;
        var semanaSug = base.semana ? segundaDe(String(base.semana).slice(0, 10)) : inicioBase;
        var semanaDivergente = !!(foiPassado && base.semana && inicioBase && semanaSug !== inicioBase);
        var versaoDivergente = !!(foiPassado && base.versao != null && isFinite(Number(base.versao)) && versaoSug !== versaoBase);
        var statusInvalido = !!(foiPassado && (base.status === 'erro' || base.status === 'divergente' || base.status === 'carregando' || base.invalida));
        var invalida = semanaDivergente || versaoDivergente || statusInvalido;

        if (invalida) {
            return {
                status: base.status || (versaoDivergente || semanaDivergente ? 'divergente' : 'erro'),
                semana: semanaSug,
                hoje: base.hoje ? String(base.hoje).slice(0, 10) : (estadoBase && estadoBase.hoje) || null,
                versao: versaoSug,
                invalida: true,
                versaoDivergente: versaoDivergente || semanaDivergente,
                pedidos: [],
                dias: [],
                folgaPorDiaVeic: Object.create(null),
                encaixes: [],
                porPedido: Object.create(null),
                encaixesPorDia: Object.create(null)
            };
        }

        var pedidos = (base.pedidos || []).map(function (p) {
            if (!p || !p.cd_pedido) return null;
            return {
                cd_pedido: Number(p.cd_pedido),
                dia_sugerido: p.dia_sugerido ? String(p.dia_sugerido).slice(0, 10) : null,
                veiculo_sugerido: p.veiculo_sugerido ? String(p.veiculo_sugerido) : null,
                motivo: Array.isArray(p.motivo) ? p.motivo.map(String) : [],
                texto: String(p.texto || ''),
                score: Number(p.score) || 0,
                prazo: p.prazo ? String(p.prazo).slice(0, 10) : null,
                atrasado_se_dia: p.atrasado_se_dia ? String(p.atrasado_se_dia).slice(0, 10) : null,
                dia_plano: p.dia_plano ? String(p.dia_plano).slice(0, 10) : null
            };
        }).filter(Boolean);

        // Contrato 066 Forja: dias vem do plano SALVO; somar os cartões do rascunho por cima para refletir a ocupação/folga viva no quadro.
        var diasPorChave = Object.create(null);
        if (estadoBase && Array.isArray(estadoBase.dias)) {
            estadoBase.dias.forEach(function (col) {
                diasPorChave[col.dia] = col;
            });
        }
        var dias = (base.dias || []).map(function (d) {
            if (!d || !d.dia || !d.veiculo_id) return null;
            var iso = String(d.dia).slice(0, 10);
            var vid = String(d.veiculo_id);
            var cxCap = d.cx_capacidade != null ? Number(d.cx_capacidade) : null;
            var paradasMax = d.paradas_max != null ? Number(d.paradas_max) : null;
            var cxPlan = Number(d.cx_planejadas) || 0;
            var paradas = Number(d.paradas) || 0;

            var colVivo = diasPorChave[iso];
            if (colVivo && Array.isArray(colVivo.cartoes)) {
                var cartoesVeic = colVivo.cartoes.filter(function (c) { return c.veiculo === vid; });
                var volVivo = 0;
                var docsVistos = Object.create(null);
                var nParadas = 0;
                cartoesVeic.forEach(function (c) {
                    if (c.volume != null) volVivo += c.volume;
                    var chCli = c.documento || ('p:' + c.cd_pedido);
                    if (!docsVistos[chCli]) { docsVistos[chCli] = true; nParadas++; }
                });
                cxPlan = Math.round(volVivo / VOLUME_CX24 * 10) / 10;
                var vObj = estadoBase && estadoBase.veiculosPorId && estadoBase.veiculosPorId[vid];
                paradas = (vObj && vObj.modo === 'cd_ceasa') || vid === 'caminhao' ? (cartoesVeic.length ? 1 : 0) : nParadas;
            }
            var folgaCx = cxCap != null ? Math.max(0, Math.round((cxCap - cxPlan) * 10) / 10) : (d.folga_cx != null ? Number(d.folga_cx) : null);
            var folgaPar = paradasMax != null ? Math.max(0, paradasMax - paradas) : (d.folga_paradas != null ? Number(d.folga_paradas) : null);
            return {
                dia: iso,
                veiculo_id: vid,
                cx_planejadas: cxPlan,
                cx_capacidade: cxCap,
                paradas: paradas,
                folga_cx: folgaCx,
                paradas_max: paradasMax,
                folga_paradas: folgaPar
            };
        }).filter(Boolean);

        var folgaPorDiaVeic = Object.create(null);
        dias.forEach(function (d) { folgaPorDiaVeic[d.dia + '|' + d.veiculo_id] = d; });

        var encaixes = (base.encaixes || []).map(function (e) {
            if (!e || !e.dia || !e.cd_pedido) return null;
            return {
                dia: String(e.dia).slice(0, 10),
                veiculo_id: String(e.veiculo_id || 's10'),
                cd_pedido: Number(e.cd_pedido),
                distancia_km: e.distancia_km != null ? Number(e.distancia_km) : null,
                perto_de_cd: e.perto_de_cd != null ? Number(e.perto_de_cd) : null,
                texto: String(e.texto || '')
            };
        }).filter(Boolean);

        var porPedido = Object.create(null);
        pedidos.forEach(function (p) { porPedido[p.cd_pedido] = p; });

        var encaixesPorDia = Object.create(null);
        encaixes.forEach(function (e) {
            if (!encaixesPorDia[e.dia]) encaixesPorDia[e.dia] = [];
            encaixesPorDia[e.dia].push(e);
        });

        return {
            status: base.status || 'ok',
            semana: semanaSug,
            hoje: base.hoje ? String(base.hoje).slice(0, 10) : (estadoBase && estadoBase.hoje) || null,
            versao: versaoSug,
            invalida: false,
            versaoDivergente: false,
            pedidos: pedidos,
            dias: dias,
            folgaPorDiaVeic: folgaPorDiaVeic,
            encaixes: encaixes,
            porPedido: porPedido,
            encaixesPorDia: encaixesPorDia
        };
    }

    // ===================== 066: LINHAS DO MAPA DA SEMANA =====================
    function corLinhaRota(diaIso, veicId, veicCor) {
        var w = diaSemana(diaIso);
        var ch = w + '|' + veicId;
        if (CORES_DIA_VEIC[ch]) return CORES_DIA_VEIC[ch];
        return CORES_DIA_FALLBACK[w] || veicCor || '#3b82f6';
    }

    function calcularRotasMapa(estado) {
        var st = estado && estado.dias && estado.veiculosPorId ? estado : normalizarEstado(estado);
        var origem = Array.isArray(st.origem) && st.origem.length >= 2 ? st.origem : ORIGEM_PADRAO;
        var linhas = [];
        var semGeo = [];

        st.dias.forEach(function (col) {
            var porVeic = Object.create(null);
            (col.cartoesVisiveis || []).forEach(function (c) {
                var vid = c.veiculo || 's10';
                if (!porVeic[vid]) porVeic[vid] = [];
                porVeic[vid].push(c);
            });
            Object.keys(porVeic).forEach(function (vid) {
                var vObj = st.veiculosPorId[vid];
                var cartoes = porVeic[vid];
                var ehCeasa = (vObj && vObj.modo === 'cd_ceasa') || vid === 'caminhao' || (cartoes[0] && cartoes[0].modoVeiculo === 'cd_ceasa');
                var paradasComGeo = [];
                var cartoesSemGeo = [];

                if (ehCeasa) {
                    // UI066-R2: caminhão (modo cd_ceasa) faz UMA única parada no CD CEASA com carga agregada,
                    // independentemente das coordenadas individuais dos clientes.
                    if (!cartoes.length) return;
                    var posCd = [CEASA_CENTRO[0], CEASA_CENTRO[1]];
                    var cdsCarga = cartoes.map(function (c) { return c.cd_pedido; });
                    var atrasoMax = 0;
                    cartoes.forEach(function (c) { if ((c.atrasoDias || 0) > atrasoMax) atrasoMax = c.atrasoDias; });
                    paradasComGeo.push({
                        cd: true,
                        cd_pedido: cdsCarga[0],
                        pedidos: cdsCarga,
                        cliente: CEASA_CD_NOME,
                        nome: CEASA_CD_NOME,
                        bairro: 'Irajá',
                        ordem: 1,
                        pos: posCd,
                        atrasoDias: atrasoMax
                    });
                } else {
                    cartoes.forEach(function (c) {
                        if (c.pos && isFinite(c.pos[0]) && isFinite(c.pos[1])) {
                            paradasComGeo.push({
                                cd_pedido: c.cd_pedido,
                                cliente: c.cliente,
                                bairro: c.bairro,
                                ordem: c.ordem,
                                pos: [c.pos[0], c.pos[1]],
                                atrasoDias: c.atrasoDias || 0
                            });
                        } else {
                            cartoesSemGeo.push(c.cd_pedido);
                            semGeo.push({ cd_pedido: c.cd_pedido, dia: col.dia, veiculo_id: vid, cliente: c.cliente });
                        }
                    });
                }
                if (!paradasComGeo.length) return;
                // Depósito -> paradas na ordem do dia -> depósito (linha reta entre pontos)
                var pontos = [origem].concat(paradasComGeo.map(function (p) { return p.pos; })).concat([origem]);
                var kmTotal = 0;
                for (var i = 0; i < pontos.length - 1; i++) {
                    var d = distKm(pontos[i], pontos[i + 1]);
                    if (d != null) kmTotal += d;
                }
                linhas.push({
                    chave: col.dia + '|' + vid,
                    dia: col.dia,
                    rotuloDia: col.rotuloCurto + ' ' + col.dataCurta,
                    veiculo_id: vid,
                    nomeVeiculo: vObj ? (vObj.id === 'caminhao' ? 'CEASA' : vObj.nome) : vid,
                    cor: corLinhaRota(col.dia, vid, vObj && vObj.cor),
                    tracejada: ehCeasa,
                    origem: origem,
                    paradas: paradasComGeo,
                    pontos: pontos,
                    semGeoCds: cartoesSemGeo,
                    kmReta: Math.round(kmTotal * 10) / 10
                });
            });
        });

        return {
            origem: origem,
            linhas: linhas,
            semGeo: semGeo
        };
    }

    function normalizarEstado(dados) {
        var d = dados || {};
        var frota = normalizarVeiculos(d.veiculos);
        var hoje = String(d.hoje || (core && core.diaSP ? core.diaSP(new Date()) : '2026-11-25')).slice(0, 10);
        var inicio = segundaDe(String(d.inicio || hoje).slice(0, 10));
        var fim = String(d.fim || somaDias(inicio, 5)).slice(0, 10);
        var podeEditar = d.podeEditar !== false && !d.versaoConflito;
        var veiculoAtual = d.veiculoAtual && (d.veiculoAtual === 'todos' || frota.porId[d.veiculoAtual]) ? d.veiculoAtual : 'todos';

        var fechadosLista = Array.isArray(d.fechados) ? d.fechados.map(function (x) { return String(x).slice(0, 10); }) : [];
        var fechadosSet = Object.create(null);
        fechadosLista.forEach(function (iso) { if (iso) fechadosSet[iso] = true; });

        var temSemSaidaCanonico = Array.isArray(d.sem_saida) || Array.isArray(d.semSaida);
        var semSaidaBruto = Array.isArray(d.sem_saida) ? d.sem_saida : (Array.isArray(d.semSaida) ? d.semSaida : []);
        var semSaidaLista = [];
        var semSaidaPorDia = Object.create(null);
        semSaidaBruto.forEach(function (s) {
            if (!s || !s.dia || !s.veiculo_id) return;
            var iso = String(s.dia).slice(0, 10);
            var vid = String(s.veiculo_id);
            var mot = s.motivo != null ? String(s.motivo) : '';
            if (!semSaidaPorDia[iso]) semSaidaPorDia[iso] = Object.create(null);
            semSaidaPorDia[iso][vid] = mot;
            semSaidaLista.push({ dia: iso, veiculo_id: vid, motivo: mot });
        });

        var diasBrutos = Array.isArray(d.dias) && d.dias.length ? d.dias : [0, 1, 2, 3, 4, 5].map(function (i) {
            return { dia: somaDias(inicio, i), cartoes: [] };
        });

        var dias = diasBrutos.map(function (col) {
            return recalcularDia(Object.assign({},col,{movimentoAtomico:!!d.movimentoAtomico}), frota, veiculoAtual, hoje, podeEditar && !d.salvando, fechadosSet, semSaidaPorDia, temSemSaidaCanonico);
        });

        var bandejaTodos = (d.bandeja || []).map(function (c) {
            var norm = normalizarCartao(c, frota, null, podeEditar && !d.salvando, hoje);
            norm.dia = null;
            norm.ordem = null;
            norm.atrasoDias = 0;
            norm.atrasado = false;
            if (!norm.motivoBandeja) {
                norm.motivoBandeja = norm.origemDia === 'removido' ? 'removido' : (norm.faltaMarcar ? 'falta_marcar' : 'sem_dia');
            }
            return norm;
        });

        var bandejaVisivel = veiculoAtual !== 'todos'
            ? bandejaTodos.filter(function (c) { return c.veiculo === veiculoAtual || c.faltaMarcar; })
            : bandejaTodos;

        var totalPedidos = 0, totalCx24 = 0, totalSalvos = 0, totalEstouram = 0, totalAtrasados = 0, totalAtrasadosEditaveis = 0;
        dias.forEach(function (col) {
            totalPedidos += col.cartoesVisiveis.length;
            totalCx24 += col.usadoCx24;
            totalAtrasados += col.atrasados;
            if (col.editavel) {
                (col.cartoes || []).forEach(function (c) {
                    if (c.atrasado || c.atrasoDias > 0) totalAtrasadosEditaveis++;
                });
            }
            col.cartoesVisiveis.forEach(function (c) {
                if (c.origemDia === 'salvo' || c.origemDia === 'rascunho') totalSalvos++;
                if (c.estoura || c.situacao === 'vencido' || c.atrasado) totalEstouram++;
            });
        });

        var basePre = {
            inicio: inicio,
            fim: fim,
            hoje: hoje,
            versaoBase: d.versaoBase != null && isFinite(Number(d.versaoBase)) ? Number(d.versaoBase) : 0,
            veiculos: frota.lista,
            veiculosPorId: frota.porId,
            dias: dias,
            bandeja: bandejaTodos
        };
        var sugestoesIgnoradas = Object.assign({}, d.sugestoesIgnoradas || {});
        var sugestoes = normalizarSugestoes066(d.sugestoes, basePre);

        var stFinal = {
            inicio: inicio,
            fim: fim,
            hoje: hoje,
            movimentoAtomico: !!d.movimentoAtomico,
            calendarioH: d.calendarioH || {},
            origem: Array.isArray(d.origem) && d.origem.length >= 2 ? d.origem : ORIGEM_PADRAO,
            semanaAtualIni: segundaDe(hoje),
            proximaSemanaIni: somaDias(segundaDe(hoje), 7),
            versaoBase: d.versaoBase != null ? Number(d.versaoBase) || 0 : 0,
            podeEditar: podeEditar,
            salvando: !!d.salvando,
            temRascunho: !!d.temRascunho,
            temSalvo: !!d.temSalvo,
            versaoConflito: !!d.versaoConflito,
            confirmaSalvarAtraso: !!(d.confirmaSalvarAtraso && totalAtrasadosEditaveis > 0),
            mapaAberto: d.mapaAberto !== false,
            diaDestacadoMapa: d.diaDestacadoMapa ? String(d.diaDestacadoMapa).slice(0, 10) : null,
            msg: String(d.msg || ''),
            msgErro: !!d.msgErro,
            veiculoAtual: veiculoAtual,
            buscaBandeja: String(d.buscaBandeja || ''),
            filtroBandeja: String(d.filtroBandeja || 'todos'),
            pilhasExpandidas: Object.assign({}, d.pilhasExpandidas || {}),
            sugestoesIgnoradas: sugestoesIgnoradas,
            sugestoes: sugestoes,
            fechados: fechadosLista,
            sem_saida: semSaidaLista,
            veiculos: frota.lista,
            veiculosPorId: frota.porId,
            dias: dias,
            bandeja: bandejaTodos,
            bandejaVisivel: bandejaVisivel,
            resumo: {
                pedidos: totalPedidos,
                cx24: totalCx24,
                salvos: totalSalvos,
                estouram: totalEstouram,
                atrasados: totalAtrasados,
                atrasadosEditaveis: totalAtrasadosEditaveis,
                bandeja: bandejaVisivel.length
            }
        };
        stFinal.rotasMapa = calcularRotasMapa(stFinal);
        return stFinal;
    }

    function diaAceitaSalvar(col, veicObj, st) {
        if (!col || !veicObj || !veicObj.ativo) return false;
        if (st.hoje && col.dia <= st.hoje) return false;
        if (col.fechada || col.feriado) return false;
        return veiculoSaiNoDia(veicObj, col.dia, col.feriado, col.semSaidaVeiculos);
    }

    function montarPayloadSalvar(estado) {
        var st = estado && estado.dias && estado.veiculosPorId ? estado : normalizarEstado(estado);
        var itens = [];
        var vistos = Object.create(null);
        var diasPorIso = Object.create(null);
        st.dias.forEach(function (col) { diasPorIso[col.dia] = col; });

        st.dias.forEach(function (col) {
            var ordPorVeic = Object.create(null);
            (col.cartoes || []).forEach(function (c) {
                if (!c || !c.cd_pedido || c.entregue===true || vistos[c.cd_pedido]) return;
                var vid = c.veiculo || (st.veiculoAtual !== 'todos' ? st.veiculoAtual : 's10');
                var v = st.veiculosPorId[vid];
                if (!diaAceitaSalvar(col, v, st)) return;
                vistos[c.cd_pedido] = true;
                var ehCeasa = (v && v.modo === 'cd_ceasa') || c.modoVeiculo === 'cd_ceasa' || vid === 'caminhao';
                var ord = null;
                if (!ehCeasa) {
                    ordPorVeic[vid] = (ordPorVeic[vid] || 0) + 1;
                    ord = ordPorVeic[vid];
                }
                itens.push({
                    cd_pedido: Number(c.cd_pedido),
                    dia: col.dia,
                    veiculo_id: vid,
                    ordem: ord,
                    removido: false
                });
            });
        });

        (st.bandeja || []).forEach(function (c) {
            if (!c || !c.cd_pedido || c.entregue===true || vistos[c.cd_pedido]) return;
            if (c.origemDia === 'removido' || c.motivoBandeja === 'removido') {
                var vid = c.veiculo || (st.veiculoAtual !== 'todos' ? st.veiculoAtual : 's10');
                var v = st.veiculosPorId[vid];
                var diaRef = c.diaAnterior && c.diaAnterior >= st.inicio && c.diaAnterior <= st.fim ? c.diaAnterior : null;
                var colRef = diaRef ? diasPorIso[diaRef] : null;
                if (!colRef || !diaAceitaSalvar(colRef, v, st)) return;
                vistos[c.cd_pedido] = true;
                itens.push({
                    cd_pedido: Number(c.cd_pedido),
                    dia: diaRef,
                    veiculo_id: vid,
                    ordem: null,
                    removido: true
                });
            }
        });

        return {
            inicio: st.inicio,
            versao_base: st.versaoBase,
            itens: itens
        };
    }

    function aplicarAcao(estado, acao) {
        var st = normalizarEstado(estado);
        if (!st.podeEditar || st.salvando) {
            return { ok: false, motivo: 'Edição bloqueada neste momento.', estado: st };
        }
        var tipo = acao && acao.tipo;

        if (tipo === 'ignorar_sugestao') {
            var cdIgn = Number(acao && acao.cd_pedido);
            var diaIgn = acao && acao.dia ? String(acao.dia).slice(0, 10) : '';
            var chIgn = acao && acao.encaixe ? ('enc:' + diaIgn + '|' + cdIgn) : ('ped:' + cdIgn);
            var novasIgn = Object.assign({}, st.sugestoesIgnoradas);
            novasIgn[chIgn] = true;
            if (!acao.encaixe) novasIgn['ped:' + cdIgn] = true;
            var stIgn = normalizarEstado(Object.assign({}, st, {
                sugestoesIgnoradas: novasIgn,
                msg: ''
            }));
            return { ok: true, estado: stIgn, acao: acao };
        }

        if (tipo === 'sugerir_semana') {
            return aplicarSugestoesSemana(st);
        }
        if (tipo === 'aceitar_sugestao' && (!st.sugestoes || st.sugestoes.invalida || st.sugestoes.versaoDivergente || (st.sugestoes.versao != null && st.sugestoes.versao !== st.versaoBase))) {
            return { ok: false, motivo: 'As sugestões pertencem a outra versão do plano. Aguarde a releitura.', estado: st };
        }

        var cd = Number(acao && acao.cd_pedido);
        if (!cd) return { ok: false, motivo: 'Pedido inválido.', estado: st };

        var cloneDias = st.dias.map(function (d) {
            return Object.assign({}, d, { cartoes: d.cartoes.map(function (c) { return Object.assign({}, c); }) });
        });
        var cloneBandeja = st.bandeja.map(function (c) { return Object.assign({}, c); });

        function acharDia(iso) {
            for (var i = 0; i < cloneDias.length; i++) if (cloneDias[i].dia === iso) return cloneDias[i];
            return null;
        }

        var cartao = null, diaOrigemObj = null, idxOrigem = -1, daBandeja = false;
        for (var b = 0; b < cloneBandeja.length; b++) {
            if (cloneBandeja[b].cd_pedido === cd) {
                cartao = cloneBandeja[b]; idxOrigem = b; daBandeja = true; break;
            }
        }
        if (!cartao) {
            for (var d = 0; d < cloneDias.length; d++) {
                var lista = cloneDias[d].cartoes;
                for (var k = 0; k < lista.length; k++) {
                    if (lista[k].cd_pedido === cd) {
                        cartao = lista[k]; diaOrigemObj = cloneDias[d]; idxOrigem = k; break;
                    }
                }
                if (cartao) break;
            }
        }
        if (!cartao) return { ok: false, motivo: 'Pedido não encontrado no quadro.', estado: st };
        if (cartao.bloqueado || (cartao.entregue === undefined && diaOrigemObj && !diaOrigemObj.editavel)) {
            return { ok: false, motivo: 'Pedido no Histórico não pode ser movido.', estado: st };
        }
        if (tipo === 'trocar_veiculo' && cartao.veiculoSomenteLeitura) {
            return { ok: false, motivo: 'O veículo deste pedido está somente leitura após a saída.', estado: st };
        }

        if (st.movimentoAtomico && ['programar','mover','remover'].indexOf(tipo) >= 0 && !(tipo==='mover' && diaOrigemObj && String(acao.paraDia || acao.dia || '')===diaOrigemObj.dia && acao.ordem!=null)) {
            if (typeof cartao.entregue !== 'boolean') return {ok:false,motivo:'Estado do pedido indisponível. Atualize para conferir.',estado:st};
            var destino = tipo === 'remover' ? null : String(acao.paraDia || acao.dia || '').slice(0,10);
            var vidDestino = String(acao.veiculo || cartao.veiculo || '');
            if (destino) {
                var erroDestino = motivoDestino(destino, vidDestino, st);
                if (erroDestino) return {ok:false,motivo:erroDestino,estado:st};
            }
            return {ok:true,estado:st,acao:acao,pontual:{cd_pedido:cd,dia:destino,veiculo:vidDestino || null}};
        }
        if (tipo === 'remover') {
            if (daBandeja || !diaOrigemObj) {
                return { ok: false, motivo: 'O pedido já está na bandeja.', estado: st };
            }
            diaOrigemObj.cartoes.splice(idxOrigem, 1);
            cartao.diaAnterior = diaOrigemObj.dia;
            cartao.dia = null;
            cartao.ordem = null;
            cartao.origemDia = 'removido';
            cartao.motivoBandeja = 'removido';
            cloneBandeja.unshift(cartao);
        } else if (tipo === 'trocar_veiculo') {
            var novoVeicId = String((acao && acao.veiculo) || '').trim();
            var novoVeicObj = st.veiculosPorId[novoVeicId];
            if (!novoVeicObj || !novoVeicObj.ativo) {
                return { ok: false, motivo: 'Veículo inválido ou inativo.', estado: st };
            }
            if (cartao.veiculo === novoVeicObj.id && !cartao.faltaMarcar) {
                return { ok: true, estado: st, acao: acao };
            }
            cartao.veiculo = novoVeicObj.id;
            cartao.nomeVeiculo = novoVeicObj.id === 'caminhao' ? 'CEASA' : novoVeicObj.nome;
            cartao.corVeiculo = novoVeicObj.cor;
            cartao.modoVeiculo = novoVeicObj.modo;
            cartao.faltaMarcar = false;
            var msgTroca = '';
            if (!daBandeja && diaOrigemObj) {
                if (!veiculoSaiNoDia(novoVeicObj, diaOrigemObj.dia, diaOrigemObj.feriado, diaOrigemObj.semSaidaVeiculos)) {
                    diaOrigemObj.cartoes.splice(idxOrigem, 1);
                    cartao.diaAnterior = diaOrigemObj.dia;
                    cartao.dia = null;
                    cartao.ordem = null;
                    cartao.origemDia = 'removido';
                    cartao.motivoBandeja = 'sem_dia';
                    cloneBandeja.unshift(cartao);
                    msgTroca = (novoVeicObj.id === 'caminhao' ? 'CEASA' : novoVeicObj.nome) + ' não sai em ' + dataBr(diaOrigemObj.dia) + ': o pedido #' + cd + ' voltou para a bandeja.';
                } else {
                    cartao.origemDia = 'rascunho';
                }
            } else if (daBandeja) {
                if (cartao.motivoBandeja === 'falta_marcar') cartao.motivoBandeja = 'sem_dia';
            }
            var estadoTroca = normalizarEstado(Object.assign({}, st, {
                dias: cloneDias,
                bandeja: cloneBandeja,
                temRascunho: !daBandeja || st.temRascunho,
                confirmaSalvarAtraso: false,
                msg: msgTroca,
                msgErro: false
            }));
            return { ok: true, estado: estadoTroca, acao: acao };
        } else if (tipo === 'programar' || tipo === 'mover' || tipo === 'aceitar_sugestao') {
            var paraDia = String((acao && (acao.paraDia || acao.dia)) || '').slice(0, 10);
            var diaAlvoObj = acharDia(paraDia);
            if (!diaAlvoObj || !diaAlvoObj.editavel) {
                return { ok: false, motivo: 'Este dia não aceita programação (passado, hoje ou sem saída).', estado: st };
            }
            var veicId = String((acao && acao.veiculo) || cartao.veiculo || (st.veiculoAtual !== 'todos' ? st.veiculoAtual : 's10'));
            var veicObj = st.veiculosPorId[veicId];
            if (!veicObj || !veiculoSaiNoDia(veicObj, paraDia, diaAlvoObj.feriado, diaAlvoObj.semSaidaVeiculos)) {
                return { ok: false, motivo: 'O veículo ' + (veicObj ? veicObj.nome : veicId) + ' não sai neste dia.', estado: st };
            }
            if (daBandeja) cloneBandeja.splice(idxOrigem, 1);
            else if (diaOrigemObj) diaOrigemObj.cartoes.splice(idxOrigem, 1);

            cartao.veiculo = veicObj.id;
            cartao.nomeVeiculo = veicObj.id === 'caminhao' ? 'CEASA' : veicObj.nome;
            cartao.corVeiculo = veicObj.cor;
            cartao.modoVeiculo = veicObj.modo;
            cartao.faltaMarcar = false;
            cartao.dia = paraDia;
            cartao.origemDia = 'rascunho';
            cartao.motivoBandeja = null;

            var posAlvo = acao.ordem != null && isFinite(Number(acao.ordem))
                ? Math.max(0, Math.min(diaAlvoObj.cartoes.length, Number(acao.ordem) - 1))
                : diaAlvoObj.cartoes.length;
            diaAlvoObj.cartoes.splice(posAlvo, 0, cartao);
        } else {
            return { ok: false, motivo: 'Ação desconhecida.', estado: st };
        }

        var novoEstado = normalizarEstado(Object.assign({}, st, {
            dias: cloneDias,
            bandeja: cloneBandeja,
            temRascunho: true,
            confirmaSalvarAtraso: false,
            msg: ''
        }));
        return { ok: true, estado: novoEstado, acao: acao };
    }

    // 066: Botão "Sugerir semana" pré-preenche o RASCUNHO com as sugestões ativas (nunca salva sozinho)
    function aplicarSugestoesSemana(estado) {
        var st = normalizarEstado(estado);
        if (!st.podeEditar || st.salvando) {
            return { ok: false, motivo: 'Edição bloqueada neste momento.', estado: st };
        }
        // UI066-R4: recusar aplicação se as sugestões vieram de outra versão/semana do plano
        if (!st.sugestoes || st.sugestoes.invalida || st.sugestoes.versaoDivergente ||
            (st.sugestoes.versao != null && st.sugestoes.versao !== st.versaoBase) ||
            (st.sugestoes.semana && st.sugestoes.semana !== st.inicio)) {
            return { ok: false, motivo: 'As sugestões são de outra versão do plano. Recarregue a semana antes de aplicar.', aplicados: [], estado: st };
        }
        var sugs = (st.sugestoes && st.sugestoes.pedidos ? st.sugestoes.pedidos.slice() : []);
        // Também inclui encaixes cujo cd_pedido não esteja na lista de pedidos
        var vistosSug = Object.create(null);
        sugs.forEach(function (s) { vistosSug[s.cd_pedido] = true; });
        ((st.sugestoes && st.sugestoes.encaixes) || []).forEach(function (e) {
            if (!vistosSug[e.cd_pedido]) {
                vistosSug[e.cd_pedido] = true;
                sugs.push({
                    cd_pedido: e.cd_pedido,
                    dia_sugerido: e.dia,
                    veiculo_sugerido: e.veiculo_id || 's10',
                    score: 70
                });
            }
        });
        sugs.sort(function (a, b) { return (b.score || 0) - (a.score || 0) || a.cd_pedido - b.cd_pedido; });

        var aplicados = [];
        var atual = st;
        sugs.forEach(function (s) {
            if (!s || !s.cd_pedido || !s.dia_sugerido) return;
            if (atual.sugestoesIgnoradas['ped:' + s.cd_pedido]) return;
            var naBandeja = atual.bandeja.filter(function (c) { return c.cd_pedido === s.cd_pedido; })[0];
            if (naBandeja && !naBandeja.bloqueado) {
                var rProg = aplicarAcao(atual, {
                    tipo: 'programar',
                    cd_pedido: s.cd_pedido,
                    dia: s.dia_sugerido,
                    veiculo: s.veiculo_sugerido || naBandeja.veiculo || 's10'
                });
                if (rProg.ok) {
                    atual = rProg.estado;
                    aplicados.push({ cd_pedido: s.cd_pedido, dia: s.dia_sugerido, veiculo_id: s.veiculo_sugerido || 's10' });
                }
                return;
            }
            // Contrato 066 Forja: pedido programado depois do prazo (dia_plano / atrasa_no_plano) também pode receber sugestão para dia anterior
            var cardAtrasado = null, diaAt = null;
            atual.dias.forEach(function (col) {
                if (!col.editavel) return;
                (col.cartoes || []).forEach(function (c) {
                    if (c.cd_pedido === s.cd_pedido && !c.bloqueado && c.dia !== s.dia_sugerido && (c.atrasado || (s.dia_plano && c.dia === s.dia_plano))) {
                        cardAtrasado = c; diaAt = col.dia;
                    }
                });
            });
            if (cardAtrasado && diaAt) {
                var rMov = aplicarAcao(atual, {
                    tipo: 'mover',
                    cd_pedido: s.cd_pedido,
                    deDia: diaAt,
                    paraDia: s.dia_sugerido,
                    veiculo: s.veiculo_sugerido || cardAtrasado.veiculo || 's10'
                });
                if (rMov.ok) {
                    atual = rMov.estado;
                    aplicados.push({ cd_pedido: s.cd_pedido, dia: s.dia_sugerido, veiculo_id: s.veiculo_sugerido || 's10' });
                }
            }
        });

        if (!aplicados.length) {
            var stSem = normalizarEstado(Object.assign({}, st, {
                msg: 'Nenhuma sugestão pendente na bandeja para aplicar ao rascunho.',
                msgErro: false
            }));
            return { ok: true, aplicados: [], estado: stSem, acao: { tipo: 'sugerir_semana' } };
        }

        var stPronto = normalizarEstado(Object.assign({}, atual, {
            temRascunho: true,
            confirmaSalvarAtraso: false,
            msg: 'Rascunho preenchido com ' + NUM.format(aplicados.length) + (aplicados.length === 1 ? ' sugestão.' : ' sugestões.') + ' Revise o quadro e clique em Salvar semana para gravar.',
            msgErro: false
        }));
        return { ok: true, aplicados: aplicados, estado: stPronto, acao: { tipo: 'sugerir_semana', aplicados: aplicados } };
    }

    function htmlSeloPrazo(c, curto) {
        if (c.dia && c.atrasoDias > 0) {
            var rotAtr = 'Atrasa ' + NUM.format(c.atrasoDias) + (c.atrasoDias === 1 ? ' dia' : ' dias');
            var txtFullAtr = rotAtr + (c.prazo ? ' · prazo ' + dataBr(c.prazo) : '');
            return '<span class="rota-sit rota-sit-vencido rq-selo-atraso" data-rq-selo-atraso="' + esc(c.atrasoDias) + '" title="' + esc(txtFullAtr) + '" aria-label="' + esc(txtFullAtr) + '"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' + esc(curto ? rotAtr : txtFullAtr) + '</span>';
        }
        if (c.estoura && c.dia) {
            var txtFullEst = 'Passa do prazo' + (c.prazo ? ' · ' + dataBr(c.prazo) : '');
            var txtCurtoEst = c.prazo ? dataBr(c.prazo) : 'Venc.';
            return '<span class="rota-sit rota-sit-vencido" title="' + esc(txtFullEst) + '" aria-label="' + esc(txtFullEst) + '"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' + esc(curto ? txtCurtoEst : txtFullEst) + '</span>';
        }
        var m = SIT_META[c.situacao] || SIT_META.ok;
        var txtFull = m.rotulo + (c.prazo ? ' · ' + dataBr(c.prazo) : '');
        var txtCurto = c.prazo ? dataBr(c.prazo) : m.rotulo;
        return '<span class="rota-sit ' + m.classe + '" title="' + esc(txtFull) + '" aria-label="' + esc(txtFull) + '"><i class="fa-solid ' + m.icone + '" aria-hidden="true"></i>' + esc(curto ? txtCurto : txtFull) + '</span>';
    }

    function htmlSugestaoCartao(c, st) {
        if (!st.sugestoes || !st.sugestoes.porPedido) return '';
        var sug = st.sugestoes.porPedido[c.cd_pedido];
        if (!sug) return '';
        if (st.sugestoesIgnoradas && st.sugestoesIgnoradas['ped:' + c.cd_pedido]) return '';
        // Se o cartão já está programado num dia dentro do prazo ou no próprio dia sugerido, não mostra chip
        if (c.dia && (!sug.dia_sugerido || (c.dia === sug.dia_sugerido && (!sug.veiculo_sugerido || c.veiculo === sug.veiculo_sugerido)))) return '';
        if (c.dia && !c.atrasado && (!sug.dia_plano || c.dia !== sug.dia_plano)) return '';
        var colAlvo = sug.dia_sugerido ? st.dias.filter(function (d) { return d.dia === sug.dia_sugerido; })[0] : null;
        var vObj = st.veiculosPorId[sug.veiculo_sugerido || c.veiculo || 's10'];
        var podeAceitar = !!(sug.dia_sugerido && st.podeEditar && !st.salvando && !c.bloqueado && colAlvo && colAlvo.editavel &&
            vObj && veiculoSaiNoDia(vObj, colAlvo.dia, colAlvo.feriado, colAlvo.semSaidaVeiculos));

        return '<div class="rq-chip-sugestao no-print" data-rq-sug-cartao="' + esc(c.cd_pedido) + '">' +
            '<span class="rq-chip-sug-texto"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> ' + esc(sug.texto) + '</span>' +
            (st.podeEditar && !st.salvando && !c.bloqueado
                ? '<span class="rq-chip-sug-acoes">' +
                  (podeAceitar
                      ? '<button type="button" class="rq-sug-btn is-aceitar" data-rq-sug-aceitar="' + esc(c.cd_pedido) + '" data-rq-sug-dia="' + esc(sug.dia_sugerido) + '" data-rq-sug-veic="' + esc(vObj.id) + '">Aceitar</button>'
                      : '') +
                  '<button type="button" class="rq-sug-btn is-ignorar" data-rq-sug-ignorar="' + esc(c.cd_pedido) + '" data-rq-sug-dia="' + esc(sug.dia_sugerido || '') + '">Ignorar</button>' +
                  '</span>'
                : '') +
            '</div>';
    }

    function htmlSugestoesColuna(col, st) {
        if (!col.editavel || !st.sugestoes || !st.sugestoes.encaixesPorDia) return '';
        var lista = st.sugestoes.encaixesPorDia[col.dia] || [];
        if (!lista.length) return '';
        var naBandejaPorCd = Object.create(null);
        (st.bandeja || []).forEach(function (c) { naBandejaPorCd[c.cd_pedido] = c; });

        var chips = [];
        lista.forEach(function (enc) {
            if (!enc || !enc.cd_pedido) return;
            if (st.veiculoAtual !== 'todos' && enc.veiculo_id && enc.veiculo_id !== st.veiculoAtual) return;
            var ch = 'enc:' + col.dia + '|' + enc.cd_pedido;
            if (st.sugestoesIgnoradas && (st.sugestoesIgnoradas[ch] || st.sugestoesIgnoradas['ped:' + enc.cd_pedido])) return;
            // Só sugere encaixe se o pedido ainda não está neste dia
            if ((col.cartoes || []).some(function (c) { return c.cd_pedido === enc.cd_pedido; })) return;
            var cardCand = naBandejaPorCd[enc.cd_pedido];
            if (!cardCand) {
                st.dias.forEach(function (d) {
                    if (d.dia !== col.dia && d.editavel) {
                        (d.cartoes || []).forEach(function (c) { if (c.cd_pedido === enc.cd_pedido && !c.bloqueado) cardCand = c; });
                    }
                });
            }
            if (!cardCand) return;
            var vObj = st.veiculosPorId[enc.veiculo_id || cardCand.veiculo || 's10'];
            var infoFolga = st.sugestoes.folgaPorDiaVeic && st.sugestoes.folgaPorDiaVeic[col.dia + '|' + (vObj ? vObj.id : 's10')];
            var cxCand = Math.max(1, Math.round((cardCand.volume || VOLUME_CX24) / VOLUME_CX24));
            if (infoFolga && infoFolga.folga_cx != null && cxCand > infoFolga.folga_cx) return;
            var podeAceitar = st.podeEditar && !st.salvando && vObj && veiculoSaiNoDia(vObj, col.dia, col.feriado, col.semSaidaVeiculos);

            chips.push('<div class="rq-chip-sugestao is-coluna no-print" data-rq-sug-coluna="' + esc(col.dia + '|' + enc.cd_pedido) + '">' +
                '<span class="rq-chip-sug-texto"><i class="fa-regular fa-lightbulb" aria-hidden="true"></i> ' + esc(enc.texto) + '</span>' +
                (st.podeEditar && !st.salvando
                    ? '<span class="rq-chip-sug-acoes">' +
                      (podeAceitar
                          ? '<button type="button" class="rq-sug-btn is-aceitar" data-rq-sug-aceitar="' + esc(enc.cd_pedido) + '" data-rq-sug-dia="' + esc(col.dia) + '" data-rq-sug-veic="' + esc(vObj.id) + '">Aceitar</button>'
                          : '') +
                      '<button type="button" class="rq-sug-btn is-ignorar" data-rq-sug-ignorar="' + esc(enc.cd_pedido) + '" data-rq-sug-dia="' + esc(col.dia) + '" data-rq-sug-encaixe="1">Ignorar</button>' +
                      '</span>'
                    : '') +
                '</div>');
        });
        return chips.length ? '<div class="rq-dia-sugestoes">' + chips.join('') + '</div>' : '';
    }

    function motivoDestino(iso, vid, st) {
        if (!calendario || !calendario.somar(iso,0)) return 'Data inválida.';
        if (st.hoje && iso <= st.hoje) return 'Escolha uma data futura.';
        if (diaSemana(iso) === 0) return 'Domingo sem saída.';
        var disponibilidade=st.calendarioH && st.calendarioH[iso.slice(0,7)];
        var col = st.dias.filter(function(d){return d.dia === iso;})[0];
        if(st.movimentoAtomico && !col && !disponibilidade)return 'Consulte a disponibilidade deste mês.';
        if(disponibilidade && disponibilidade.fechados.indexOf(iso)>=0)return 'Dia fechado.';
        if (col && !col.editavel) return 'Este dia não aceita programação.';
        var v = st.veiculosPorId[vid];
        var feriado = !!(col && col.feriado) || !!(disponibilidade && disponibilidade.feriados.indexOf(iso)>=0);
        var semSaida = col ? col.semSaidaVeiculos : {};
        if(disponibilidade)disponibilidade.sem_saida.forEach(function(x){if(x.dia===iso)semSaida=Object.assign({},semSaida,{[x.veiculo_id]:x.motivo || true});});
        if (!v || !veiculoSaiNoDia(v,iso,feriado,semSaida)) return 'Veículo sem saída neste dia.';
        return '';
    }

    function htmlMenuProgramar(c, st, totalDiaVeic) {
        if (!st.podeEditar || st.salvando || c.bloqueado) return '';
        var rotuloBtn = c.dia ? 'Mover / tirar…' : 'Programar para…';
        var opcoesDias = st.dias.map(function (col) {
            var veicId = c.veiculo || (st.veiculoAtual !== 'todos' ? st.veiculoAtual : 's10');
            var veicObj = st.veiculosPorId[veicId] || st.veiculos[0];
            if (!c.veiculo && st.veiculoAtual === 'todos' && veicObj && !veiculoSaiNoDia(veicObj, col.dia, col.feriado, col.semSaidaVeiculos)) {
                var alt = st.veiculos.filter(function (v) { return veiculoSaiNoDia(v, col.dia, col.feriado, col.semSaidaVeiculos); })[0];
                if (alt) veicObj = alt;
            }
            var sai = veicObj && veiculoSaiNoDia(veicObj, col.dia, col.feriado, col.semSaidaVeiculos);
            var habilitado = col.editavel && sai;
            var ehAtual = c.dia === col.dia;
            var cxMenu = col.usadoCapCx24 != null ? col.usadoCapCx24 : col.usadoCx24;
            var motivo = !col.editavel
                ? (col.leituraMotivo === 'passado' ? 'passado' : col.leituraMotivo === 'hoje' || col.leituraMotivo === 'fechada' ? 'hoje/fechada' : 'sem saída')
                : (!sai ? (veicObj ? veicObj.nome + ' não sai' : 'sem saída') : (col.capacidadeCx24 != null ? cxMenu + '/' + col.capacidadeCx24 + ' cx24' : col.usadoCx24 + ' cx24'));
            var acaoAttr = c.dia ? 'data-rq-mover-dia="' + esc(col.dia) + '"' : 'data-rq-programar-dia="' + esc(col.dia) + '"';
            return '<button type="button" class="rq-menu-item' + (ehAtual ? ' is-atual' : '') + '" ' + acaoAttr +
                ' data-rq-cd="' + esc(c.cd_pedido) + '" data-rq-veic="' + esc(veicObj ? veicObj.id : 's10') + '"' +
                (!habilitado || ehAtual ? ' disabled' : '') + '>' +
                '<span>' + esc(col.rotuloCurto + ' ' + col.dataCurta) + (ehAtual ? ' (atual)' : '') + '</span>' +
                '<span class="rq-menu-sub">' + esc(motivo) + '</span></button>';
        }).join('');

        if (st.movimentoAtomico && calendario) {
            opcoesDias = calendario.html({chave:String(c.cd_pedido),valor:null,hoje:st.hoje,min:somaDias(st.hoje,1),
                indisponivel:function(iso){return motivoDestino(iso,c.veiculo,st);}});
        }
        var btnRemover = c.dia
            ? '<button type="button" class="rq-menu-item is-remover" data-rq-remover="' + esc(c.cd_pedido) + '" data-rq-de-dia="' + esc(c.dia) + '">' +
              '<span><i class="fa-solid fa-arrow-turn-down" aria-hidden="true"></i> Tirar do dia (bandeja)</span></button>'
            : '';

        var botoesOrdem = '';
        if (c.dia && c.modoVeiculo !== 'cd_ceasa' && c.ordem != null && (!st.movimentoAtomico || st.dias.some(function(d){return d.dia===c.dia && d.editavel;}))) {
            botoesOrdem = '<div class="rq-ordem-botoes" role="group" aria-label="Ordem do pedido #' + esc(c.cd_pedido) + '">' +
                '<button type="button" class="rq-btn-ordem" data-rq-ordem="-1" data-rq-cd="' + esc(c.cd_pedido) + '" title="Subir na ordem do dia" aria-label="Subir pedido #' + esc(c.cd_pedido) + ' na ordem"' + (c.ordem <= 1 ? ' disabled' : '') + '><span aria-hidden="true">↑</span></button>' +
                '<button type="button" class="rq-btn-ordem" data-rq-ordem="1" data-rq-cd="' + esc(c.cd_pedido) + '" title="Descer na ordem do dia" aria-label="Descer pedido #' + esc(c.cd_pedido) + ' na ordem"' + (totalDiaVeic && c.ordem >= totalDiaVeic ? ' disabled' : '') + '><span aria-hidden="true">↓</span></button>' +
                '</div>';
        }

        return '<div class="rq-cartao-acoes no-print">' +
            '<details class="rq-menu" data-rq-menu="' + esc(c.cd_pedido) + '">' +
            '<summary class="rq-menu-btn" aria-label="' + esc(rotuloBtn + ' pedido #' + c.cd_pedido + ' de ' + c.cliente) + '">' +
            '<i class="fa-solid fa-calendar-plus" aria-hidden="true"></i> ' + esc(rotuloBtn) + '</summary>' +
            '<div class="rq-menu-painel" role="group" aria-label="Destinos para o pedido #' + esc(c.cd_pedido) + '">' +
            '<div class="rq-menu-titulo">Escolher dia de saída</div>' +
            opcoesDias +
            btnRemover +
            '</div></details>' +
            botoesOrdem +
            '</div>';
    }

    function htmlCartao(c, st, contVeicDia) {
        var podeArrastar = st.podeEditar && !st.salvando && !c.bloqueado;
        var classes = ['rq-cartao'];
        if (c.atrasado || c.atrasoDias > 0) classes.push('is-atrasado', 'is-vencido');
        else if (c.situacao === 'vencido' || c.estoura) classes.push('is-vencido');
        else if (c.situacao === 'hoje') classes.push('is-vence-hoje');
        if (c.bloqueado) classes.push('is-bloqueado');
        if (c.semGeo) classes.push('is-sem-geo');

        var selosExtra = [];
        if (c.semGeo) {
            selosExtra.push('<span class="rota-selo rq-selo-sem-geo" data-rq-sem-geo="' + esc(c.cd_pedido) + '" title="Pedido sem coordenadas cadastradas — fora da linha do mapa"><i class="fa-solid fa-location-pin-lock" aria-hidden="true"></i>Sem localização</span>');
        }
        if (c.prioridade) selosExtra.push('<span class="rota-selo rota-selo-pri"><i class="fa-solid fa-bolt" aria-hidden="true"></i>Prioridade</span>');
        if (c.janela) selosExtra.push('<span class="rota-selo"><i class="fa-regular fa-clock" aria-hidden="true"></i>' + esc(c.janela) + '</span>');
        if (c.diaFechado) selosExtra.push('<span class="rota-selo rota-selo-fechado"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i>Não recebe neste dia</span>');
        if (c.origemDia === 'salvo') selosExtra.push('<span class="rota-selo rota-selo-plano"><i class="fa-solid fa-thumbtack" aria-hidden="true"></i>Salvo</span>');
        else if (c.origemDia === 'rascunho') selosExtra.push('<span class="rota-selo rota-selo-pri"><i class="fa-solid fa-pen" aria-hidden="true"></i>Rascunho</span>');
        if (!c.dia && c.motivoBandeja && MOTIVO_BANDEJA[c.motivoBandeja]) {
            var mb = MOTIVO_BANDEJA[c.motivoBandeja];
            selosExtra.push('<span class="rota-selo ' + mb.classe + '"><i class="fa-solid ' + mb.icone + '" aria-hidden="true"></i>' + esc(mb.rotulo) + '</span>');
        }

        var ordTxt = c.dia
            ? (c.modoVeiculo === 'cd_ceasa' ? '<span class="rq-cartao-ord" title="Centro de distribuição CEASA (1 parada)">CD</span>' : (c.ordem != null ? '<span class="rq-cartao-ord">' + c.ordem + '.</span>' : ''))
            : '';
        var icSemGeoFaixa = c.semGeo
            ? ' <i class="fa-solid fa-location-pin-lock rq-ic-sem-geo" title="Sem localização no mapa (fora da linha)" aria-label="Sem localização"></i>'
            : '';

        var rotuloSelVeic = 'Veículo do pedido #' + c.cd_pedido + ' de ' + c.cliente;
        var htmlVeicDetalhe = podeArrastar && !c.veiculoSomenteLeitura
            ? '<label class="rq-cartao-veic-wrap no-print" style="--veic-cor:' + esc(c.corVeiculo) + '">' +
                '<span class="rota-veic-cor" style="--veic-cor:' + esc(c.corVeiculo) + '" aria-hidden="true"></span>' +
                '<span class="sr-only">' + esc(rotuloSelVeic) + '</span>' +
                '<select class="adm-input rq-select-veiculo" data-rq-veiculo-select="' + esc(c.cd_pedido) + '" aria-label="' + esc(rotuloSelVeic) + '">' +
                ((!c.veiculo || c.faltaMarcar) ? '<option value="" selected>Marcar…</option>' : '') +
                st.veiculos.map(function (v) {
                    var rotV = v.id === 'caminhao' ? 'CEASA' : v.nome;
                    var sel = (!c.faltaMarcar && c.veiculo === v.id) ? ' selected' : '';
                    return '<option value="' + esc(v.id) + '"' + sel + '>' + esc(rotV) + '</option>';
                }).join('') +
                '</select></label>'
            : '<span class="rq-cartao-veic"><span class="rota-veic-cor" style="--veic-cor:' + esc(c.corVeiculo) + '" aria-hidden="true"></span>' + esc(c.nomeVeiculo) + '</span>';

        return '<li class="' + classes.join(' ') + '" style="--veic-cor:' + esc(c.corVeiculo) + '"' +
            ' data-rq-cartao="' + esc(c.cd_pedido) + '"' +
            (c.dia ? ' data-rq-dia="' + esc(c.dia) + '"' : ' data-rq-bandeja-item="1"') +
            ' data-rq-veiculo="' + esc(c.veiculo) + '"' +
            (c.atrasoDias > 0 ? ' data-rq-atraso="' + esc(c.atrasoDias) + '"' : '') +
            ' title="' + esc('#' + c.cd_pedido + ' · ' + c.cliente + ' (' + c.localizacao + ')' + (c.semGeo ? ' · Sem localização' : '')) + '"' +
            (podeArrastar ? ' draggable="true"' : '') + '>' +
            '<div class="rq-cartao-faixa">' +
                '<div class="rq-cartao-topo">' +
                    '<div class="rq-cartao-id" title="' + esc(c.cliente) + '">' +
                        ordTxt +
                        '<span class="rq-cartao-cliente-faixa" title="' + esc(c.cliente) + '">' + esc(c.cliente) + '</span>' +
                        icSemGeoFaixa +
                    '</div>' +
                    htmlSeloPrazo(c, !!c.dia) +
                '</div>' +
                '<div class="rq-cartao-subfaixa">' +
                    '<span class="rq-cartao-loc" title="' + esc('#' + c.cd_pedido + ' · ' + c.localizacao) + '"><span class="rota-veic-cor" style="--veic-cor:' + esc(c.corVeiculo) + '" aria-hidden="true"></span><span class="rq-cartao-num">#' + esc(c.cd_pedido) + '</span><span>· ' + esc(c.bairro || c.localizacao) + '</span></span>' +
                    '<span class="rq-cartao-vol">' + esc(c.txtVolume) + '</span>' +
                '</div>' +
                htmlSugestaoCartao(c, st) +
            '</div>' +
            '<div class="rq-cartao-corpo">' +
                '<div class="rq-cartao-detalhe-linha">' +
                    htmlVeicDetalhe +
                    '<span class="rq-cartao-cidade">' + esc(c.localizacao) + '</span>' +
                '</div>' +
                '<div class="rq-cartao-selos">' + htmlSeloPrazo(c, false) + (selosExtra.length ? ' ' + selosExtra.join('') : '') + '</div>' +
                htmlMenuProgramar(c, st, contVeicDia) +
            '</div>' +
            '</li>';
    }

    function htmlColunaDia(col, st) {
        var classes = ['rq-coluna-dia'];
        if (!col.editavel) classes.push('is-leitura');
        if (col.excesso) classes.push('is-excesso');
        if (col.atrasados > 0) classes.push('is-com-atraso');
        if (st.diaDestacadoMapa === col.dia) classes.push('is-mapa-destaque');

        var seloModo = '';
        if (st.movimentoAtomico && col.dia <= st.hoje) seloModo = '<span class="rq-dia-selo-modo">'+(col.dia === st.hoje ? 'Hoje' : 'Passado')+'</span>';
        else if (col.leituraMotivo === 'passado') seloModo = '<span class="rq-dia-selo-modo">Passado · leitura</span>';
        else if (col.leituraMotivo === 'hoje' || col.leituraMotivo === 'fechada') seloModo = '<span class="rq-dia-selo-modo is-hoje">' + (col.dia === st.hoje ? 'Hoje · leitura' : 'Fechado · leitura') + '</span>';
        else if (col.leituraMotivo === 'feriado') seloModo = '<span class="rq-dia-selo-modo">Feriado</span>';
        else if (col.leituraMotivo === 'sem_saida') seloModo = '<span class="rq-dia-selo-modo">Sem saída</span>';
        else seloModo = '<span class="rq-dia-selo-modo is-editavel">Editável</span>';

        var alertas = [];
        var cxCap = col.usadoCapCx24 != null ? col.usadoCapCx24 : col.usadoCx24;
        if (col.excesso && col.capacidadeCx24 != null) {
            var acima = Math.max(1, cxCap - col.capacidadeCx24);
            alertas.push('<span class="rota-sit rota-sit-vencido" data-rq-alerta-cap="' + esc(col.dia) + '"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>Acima da capacidade (+' + NUM.format(acima) + ' cx24)</span>');
        }
        if (col.atrasados > 0) {
            alertas.push('<span class="rota-sit rota-sit-vencido rq-dia-selo-atraso" data-rq-alerta-atraso="' + esc(col.dia) + '" data-rq-contador-atraso="' + esc(col.atrasados) + '"><i class="fa-solid fa-clock" aria-hidden="true"></i>' + NUM.format(col.atrasados) + (col.atrasados === 1 ? ' após o prazo' : ' após o prazo') + '</span>');
        } else if (col.estouram) {
            alertas.push('<span class="rota-sit rota-sit-vencido"><i class="fa-solid fa-clock" aria-hidden="true"></i>' + NUM.format(col.estouram) + (col.estouram === 1 ? ' vencido/estoura' : ' vencidos/estouram') + '</span>');
        }
        if (col.fechados) {
            alertas.push('<span class="rota-selo rota-selo-fechado"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i>' + NUM.format(col.fechados) + ' fechado(s)</span>');
        }
        if (col.semSaidaVeiculos) {
            Object.keys(col.semSaidaVeiculos).forEach(function (vid) {
                if (st.veiculoAtual !== 'todos' && st.veiculoAtual !== vid) return;
                var vObj = st.veiculosPorId[vid];
                var vNome = vObj ? vObj.nome : vid;
                var mot = col.semSaidaVeiculos[vid];
                alertas.push('<span class="rota-selo rota-selo-fechado" data-rq-selo-sem-saida="' + esc(col.dia + '|' + vid) + '"><i class="fa-solid fa-ban" aria-hidden="true"></i>' + esc(vNome + ' sem saída' + (mot ? ' (' + mot + ')' : '')) + '</span>');
            });
        }

        var btnSemSaida = '';
        var diaFuturoAberto = (!st.hoje || col.dia > st.hoje) && !col.fechada && !col.feriado;
        if (diaFuturoAberto && st.podeEditar && !st.salvando && st.veiculoAtual !== 'todos') {
            var vF = st.veiculosPorId[st.veiculoAtual];
            if (vF && vF.diasSemSaida.indexOf(diaSemana(col.dia)) < 0) {
                var marcadoSem = col.semSaidaVeiculos && Object.prototype.hasOwnProperty.call(col.semSaidaVeiculos, vF.id);
                btnSemSaida = '<button type="button" class="rq-btn-pilha no-print" data-rq-marcar-sem-saida="' + (marcadoSem ? '0' : '1') + '" data-rq-dia="' + esc(col.dia) + '" data-rq-veic="' + esc(vF.id) + '">' +
                    '<i class="fa-solid ' + (marcadoSem ? 'fa-rotate-left' : 'fa-calendar-xmark') + '" aria-hidden="true"></i> ' +
                    esc(marcadoSem ? 'Reativar saída (' + vF.nome + ')' : vF.nome + ' não sai nesta data') + '</button>';
            }
        }

        var contPorVeic = Object.create(null);
        col.cartoesVisiveis.forEach(function (c) {
            contPorVeic[c.veiculo] = (contPorVeic[c.veiculo] || 0) + 1;
        });

        var expandida = !!st.pilhasExpandidas[col.dia];
        var pctBarra = col.ocupacaoPct == null ? 0 : Math.min(100, col.ocupacaoPct);
        var cheia = col.excesso || (col.ocupacao != null && col.ocupacao > 0.95);
        var extraCeasa = col.usadoCx24 > cxCap ? ' + ' + NUM.format(col.usadoCx24 - cxCap) + ' CEASA' : '';

        return '<section class="' + classes.join(' ') + '" data-rq-coluna="' + esc(col.dia) + '"' +
            (col.editavel && st.podeEditar && !st.salvando ? ' data-rq-zona="dia" data-rq-alvo-dia="' + esc(col.dia) + '"' : '') +
            ' aria-labelledby="rq-tit-' + esc(col.dia) + '">' +
            '<header class="rq-dia-topo">' +
                '<div class="rq-dia-titulo-linha">' +
                    '<h3 class="rq-dia-titulo" id="rq-tit-' + esc(col.dia) + '">' +
                        '<button type="button" class="rq-dia-titulo-btn" data-rq-abrir-dia="' + esc(col.dia) + '" title="' + esc('Abrir detalhe da rota de ' + col.rotuloCurto + ' · ' + col.dataCurta) + '">' +
                            '<span>' + esc(col.rotuloCurto) + ' · ' + esc(col.dataCurta) + '</span>' +
                            '<i class="fa-solid fa-arrow-up-right-from-square rq-dia-abrir-ic no-print" aria-hidden="true"></i>' +
                        '</button>' +
                    '</h3>' +
                    seloModo +
                '</div>' +
                '<p class="rq-dia-regiao" title="' + esc(col.regiao) + '"><i class="fa-solid fa-compass" aria-hidden="true"></i>' + esc(col.regiao) + '</p>' +
                '<div class="rq-dia-metricas">' +
                    '<span><strong>' + NUM.format(col.cartoesVisiveis.length) + '</strong> ' + (col.cartoesVisiveis.length === 1 ? 'pedido' : 'pedidos') + '</span>' +
                    (col.capacidadeCx24 != null
                        ? '<span><strong>' + NUM.format(cxCap) + ' / ' + NUM.format(col.capacidadeCx24) + ' cx24</strong> (' + col.ocupacaoPct + '%)' + esc(extraCeasa) + '</span>'
                        : '<span><strong>' + NUM.format(col.usadoCx24) + ' cx24</strong> · s/ limite</span>') +
                '</div>' +
                (col.capacidadeCx24 != null
                    ? '<div class="rq-dia-ocup-wrap"><div class="rq-dia-ocup" role="img" aria-label="Ocupação de ' + esc(col.rotuloCurto + ' ' + col.dataCurta) + ': ' + col.ocupacaoPct + '%">' +
                      '<div class="rq-dia-ocup-barra' + (cheia ? ' is-cheia' : '') + '" style="width:' + pctBarra + '%"></div></div></div>'
                    : '') +
                (alertas.length ? '<div class="rq-dia-alertas">' + alertas.join('') + '</div>' : '') +
                htmlSugestoesColuna(col, st) +
                btnSemSaida +
                (col.cartoesVisiveis.length > 1
                    ? '<button type="button" class="rq-btn-pilha no-print" data-rq-expandir="' + esc(col.dia) + '" aria-pressed="' + expandida + '">' +
                      '<i class="fa-solid ' + (expandida ? 'fa-compress' : 'fa-layer-group') + '" aria-hidden="true"></i> ' +
                      (expandida ? 'Compactar pilha' : 'Expandir pilha (' + col.cartoesVisiveis.length + ')') + '</button>'
                    : '') +
            '</header>' +
            '<div class="rq-dia-corpo">' +
                (col.cartoesVisiveis.length
                    ? '<ol class="rq-pilha' + (expandida ? ' is-expandida' : '') + '" data-rq-pilha="' + esc(col.dia) + '">' +
                      col.cartoesVisiveis.map(function (c) { return htmlCartao(c, st, contPorVeic[c.veiculo]); }).join('') +
                      '</ol>'
                    : '<div class="rq-dia-vazio"><i class="fa-regular fa-calendar" aria-hidden="true"></i>' +
                      '<span>' + (col.editavel ? 'Arraste cartões para cá ou use "Programar para…"' : (col.leituraMotivo === 'sem_saida' ? 'Veículo não sai neste dia' : 'Sem entregas programadas')) + '</span></div>') +
            '</div>' +
            '</section>';
    }

    function filtrarBandeja(lista, busca, filtro) {
        var q = String(busca || '').trim().toLowerCase();
        return (lista || []).filter(function (c) {
            if (filtro === 'vencidos' && c.situacao !== 'vencido' && c.situacao !== 'hoje' && !c.estoura) return false;
            if (filtro === 'capacidade' && c.motivoBandeja !== 'capacidade') return false;
            if (filtro === 'falta_marcar' && !c.faltaMarcar && c.motivoBandeja !== 'falta_marcar') return false;
            if (filtro === 'removidos' && c.motivoBandeja !== 'removido' && c.origemDia !== 'removido') return false;
            if (!q) return true;
            var alvo = (c.cd_pedido + ' ' + c.cliente + ' ' + c.localizacao + ' ' + c.nomeVeiculo).toLowerCase();
            return alvo.indexOf(q) >= 0;
        });
    }

    function htmlSvgMapa(rm, diaDestacado) {
        var origem = (rm && rm.origem) || ORIGEM_PADRAO;
        var linhas = (rm && rm.linhas) || [];
        var pts = [origem];
        linhas.forEach(function (l) {
            (l.paradas || []).forEach(function (p) {
                if (p.pos && isFinite(p.pos[0]) && isFinite(p.pos[1])) pts.push(p.pos);
            });
        });
        var minLat = pts[0][0], maxLat = pts[0][0], minLng = pts[0][1], maxLng = pts[0][1];
        pts.forEach(function (pt) {
            if (pt[0] < minLat) minLat = pt[0];
            if (pt[0] > maxLat) maxLat = pt[0];
            if (pt[1] < minLng) minLng = pt[1];
            if (pt[1] > maxLng) maxLng = pt[1];
        });
        var dLat = Math.max(0.02, maxLat - minLat);
        var dLng = Math.max(0.03, maxLng - minLng);
        var W = 860, H = 220, padX = 48, padY = 26;
        function proj(pt) {
            var x = padX + ((pt[1] - minLng) / dLng) * (W - 2 * padX);
            var y = padY + (1 - (pt[0] - minLat) / dLat) * (H - 2 * padY);
            return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
        }
        var svgLinhas = [];
        var svgParadas = [];
        linhas.forEach(function (l) {
            var ativo = !diaDestacado || l.dia === diaDestacado;
            var focado = diaDestacado && l.dia === diaDestacado;
            var op = focado ? '1' : (ativo ? '0.86' : '0.16');
            var sw = focado ? '4.5' : (ativo ? '3' : '1.8');
            var coords = (l.pontos || []).map(function (pt) {
                var xy = proj(pt);
                return xy[0] + ',' + xy[1];
            }).join(' ');
            svgLinhas.push('<polyline class="rq-svg-linha" data-rq-svg-dia="' + esc(l.dia) + '" data-rq-svg-chave="' + esc(l.chave) + '"' +
                ' points="' + esc(coords) + '" fill="none" stroke="' + esc(l.cor) + '" stroke-width="' + sw + '" stroke-opacity="' + op + '"' +
                ' stroke-linejoin="round" stroke-linecap="round"' + (l.tracejada ? ' stroke-dasharray="6 5"' : '') + ' />');
            (l.paradas || []).forEach(function (p, idx) {
                var xy = proj(p.pos);
                var numTxt = p.ordem != null ? p.ordem : (idx + 1);
                svgParadas.push('<g class="rq-svg-parada" data-rq-svg-parada-dia="' + esc(l.dia) + '" transform="translate(' + xy[0] + ',' + xy[1] + ')" opacity="' + op + '">' +
                    '<circle r="8.5" fill="' + esc(l.cor) + '" stroke="#181c22" stroke-width="1.6" />' +
                    '<text y="3.2" text-anchor="middle" fill="#ffffff" font-size="8.5" font-weight="800">' + esc(numTxt) + '</text>' +
                    '<title>' + esc(l.rotuloDia + ' · ' + l.nomeVeiculo + ' · ' + numTxt + '. ' + p.cliente + ' (#' + p.cd_pedido + ')') + '</title>' +
                    '</g>');
            });
        });
        var dep = proj(origem);
        var svgDep = '<g class="rq-svg-deposito" data-rq-svg-deposito="1" transform="translate(' + dep[0] + ',' + dep[1] + ')">' +
            '<circle r="11" fill="#f0915a" stroke="#ffffff" stroke-width="2" />' +
            '<text y="3.5" text-anchor="middle" fill="#181c22" font-size="8.5" font-weight="900">SEDE</text>' +
            '<title>Depósito (saída e retorno)</title>' +
            '</g>';
        return '<svg class="rq-mapa-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" aria-label="Trajeto das rotas da semana">' +
            '<rect width="' + W + '" height="' + H + '" fill="rgba(16, 20, 26, 0.9)" />' +
            '<g class="rq-svg-grade" stroke="rgba(255,255,255,0.04)" stroke-width="1">' +
                '<line x1="0" y1="55" x2="' + W + '" y2="55" /><line x1="0" y1="110" x2="' + W + '" y2="110" /><line x1="0" y1="165" x2="' + W + '" y2="165" />' +
                '<line x1="215" y1="0" x2="215" y2="' + H + '" /><line x1="430" y1="0" x2="430" y2="' + H + '" /><line x1="645" y1="0" x2="645" y2="' + H + '" />' +
            '</g>' +
            svgLinhas.join('') +
            svgParadas.join('') +
            svgDep +
            '</svg>';
    }

    function htmlMapaSemana(st) {
        var rm = st.rotasMapa || calcularRotasMapa(st);
        var linhas = rm.linhas || [];
        var nSemGeo = (rm.semGeo || []).length;
        var legenda = linhas.length
            ? linhas.map(function (l) {
                var ativo = st.diaDestacadoMapa === l.dia;
                return '<button type="button" class="rq-mapa-legenda-item' + (ativo ? ' is-ativo' : '') + '" data-rq-mapa-dia="' + esc(l.dia) + '" data-rq-mapa-linha="' + esc(l.chave) + '" title="Passar o mouse ou clicar destaca a linha de ' + esc(l.rotuloDia + ' · ' + l.nomeVeiculo) + '">' +
                    '<span class="rq-mapa-cor" style="background:' + esc(l.cor) + '"></span>' +
                    '<span>' + esc(l.rotuloDia) + ' · ' + esc(l.nomeVeiculo) + '</span>' +
                    '<span class="rq-mapa-meta">(' + NUM.format(l.paradas.length) + ' · ~' + NUM1.format(l.kmReta) + ' km)</span>' +
                    '</button>';
            }).join('')
            : '<span class="rota-sub">Nenhuma parada com localização programada nos dias visíveis.</span>';

        return '<section class="adm-card p-3 rq-mapa-card no-print" data-rq-mapa-secao="1" aria-labelledby="rq-mapa-titulo">' +
            '<div class="rq-mapa-topo">' +
                '<div class="rq-mapa-tit-wrap">' +
                    '<h3 class="rota-tit" id="rq-mapa-titulo"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i> Trajeto da semana no mapa</h3>' +
                    '<span class="rota-sub">Depósito → paradas na ordem do dia → depósito (linha reta). Passe o mouse num dia para destacar só a rota dele.</span>' +
                '</div>' +
                '<div class="rq-mapa-acoes">' +
                    (nSemGeo ? '<span class="rota-selo rq-selo-sem-geo" data-rq-mapa-sem-geo="' + esc(nSemGeo) + '"><i class="fa-solid fa-location-pin-lock" aria-hidden="true"></i>' + NUM.format(nSemGeo) + ' sem localização (fora da linha)</span>' : '') +
                    '<button type="button" class="adm-botao-fantasma" data-rq-acao="toggle-mapa" aria-expanded="' + (st.mapaAberto ? 'true' : 'false') + '">' +
                        '<i class="fa-solid ' + (st.mapaAberto ? 'fa-chevron-up' : 'fa-chevron-down') + '" aria-hidden="true"></i> ' +
                        (st.mapaAberto ? 'Recolher mapa' : 'Mostrar mapa') +
                    '</button>' +
                '</div>' +
            '</div>' +
            '<div class="rq-mapa-legenda" role="group" aria-label="Rotas por dia e veículo">' + legenda + '</div>' +
            (st.mapaAberto ? '<div id="rq-mapa-canvas" class="rq-mapa-canvas" data-rq-mapa-canvas="1" role="region" aria-label="Mapa das rotas da semana">' + htmlSvgMapa(rm, st.diaDestacadoMapa) + '</div>' : '') +
            '</section>';
    }

    function htmlBandeja(st) {
        var filtrados = filtrarBandeja(st.bandejaVisivel, st.buscaBandeja, st.filtroBandeja);
        var nVenc = st.bandejaVisivel.filter(function (c) { return c.situacao === 'vencido' || c.situacao === 'hoje' || c.estoura; }).length;
        var nRem = st.bandejaVisivel.filter(function (c) { return c.motivoBandeja === 'removido' || c.origemDia === 'removido'; }).length;

        return '<section class="rq-bandeja" id="rq-bandeja" data-rq-bandeja="1"' +
            (st.podeEditar && !st.salvando ? ' data-rq-zona="bandeja"' : '') +
            ' aria-labelledby="rq-bandeja-tit">' +
            '<div class="rq-bandeja-topo">' +
                '<div>' +
                    '<h3 class="rota-tit" id="rq-bandeja-tit"><i class="fa-solid fa-inbox" aria-hidden="true"></i> Fora da rota / sem dia (' + NUM.format(st.bandejaVisivel.length) + ')</h3>' +
                    '<p class="rota-sub">Pedidos pendentes não programados nesta semana. Arraste um cartão para um dia editável acima (ou de um dia de volta para cá para retirar).</p>' +
                '</div>' +
                '<div class="rq-bandeja-controles no-print">' +
                    '<div class="flex flex-wrap gap-1" role="group" aria-label="Filtrar bandeja">' +
                        '<button type="button" class="adm-chip' + (st.filtroBandeja === 'todos' ? ' is-ativo' : '') + '" data-rq-filtro="todos" aria-pressed="' + (st.filtroBandeja === 'todos') + '">Todos (' + NUM.format(st.bandejaVisivel.length) + ')</button>' +
                        '<button type="button" class="adm-chip' + (st.filtroBandeja === 'vencidos' ? ' is-ativo' : '') + '" data-rq-filtro="vencidos" aria-pressed="' + (st.filtroBandeja === 'vencidos') + '">Vencidos / hoje (' + NUM.format(nVenc) + ')</button>' +
                        (nRem ? '<button type="button" class="adm-chip' + (st.filtroBandeja === 'removidos' ? ' is-ativo' : '') + '" data-rq-filtro="removidos" aria-pressed="' + (st.filtroBandeja === 'removidos') + '">Tirados do dia (' + NUM.format(nRem) + ')</button>' : '') +
                    '</div>' +
                    '<label class="sr-only" for="rq-busca-bandeja">Buscar pedido na bandeja</label>' +
                    '<input type="search" id="rq-busca-bandeja" class="adm-input rq-bandeja-busca" data-rq-busca="1" placeholder="Buscar nº, cliente ou bairro…" value="' + esc(st.buscaBandeja) + '">' +
                '</div>' +
            '</div>' +
            (filtrados.length
                ? '<ul class="rq-bandeja-grade" data-rq-bandeja-lista="1">' +
                  filtrados.map(function (c) { return htmlCartao(c, st, null); }).join('') +
                  '</ul>'
                : '<p class="adm-vazio-linha"><span class="adm-vazio-titulo">' +
                  (st.bandejaVisivel.length ? 'Nenhum pedido na bandeja corresponde ao filtro/busca.' : 'Todos os pedidos pendentes estão programados nos dias da semana.') +
                  '</span></p>') +
            '</section>';
    }

    function html(dados) {
        var st = dados && dados.dias && dados.veiculosPorId ? dados : normalizarEstado(dados);
        var ehSemAtual = st.inicio === st.semanaAtualIni;
        var ehProxSem = st.inicio === st.proximaSemanaIni;

        var seloEstado = st.temRascunho
            ? '<span class="rq-selo-estado is-rascunho" role="status"><i class="fa-solid fa-pen" aria-hidden="true"></i>Rascunho não salvo</span>'
            : (st.temSalvo
                ? '<span class="rq-selo-estado is-salvo" role="status"><i class="fa-solid fa-circle-check" aria-hidden="true"></i>Plano salvo (v' + NUM.format(st.versaoBase || 1) + ') · vale no fechamento 08:00</span>'
                : '<span class="rq-selo-estado" role="status"><i class="fa-regular fa-lightbulb" aria-hidden="true"></i>Sugestão automática (não salva)</span>');

        var msgHtml = '';
        if (st.versaoConflito) {
            msgHtml = '<div class="rq-msg-barra is-erro" role="alert">' +
                '<span><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> <strong>Conflito de versão (versao_antiga):</strong> outro usuário salvou o plano desta semana antes. Recarregue para atualizar sem sobrescrever.</span>' +
                '<button type="button" class="adm-botao-fantasma" data-rq-acao="recarregar"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Recarregar semana</button>' +
                '</div>';
        } else if (st.msg) {
            msgHtml = '<div class="rq-msg-barra' + (st.msgErro ? ' is-erro' : '') + '" role="' + (st.msgErro ? 'alert' : 'status') + '">' +
                '<span><i class="fa-solid ' + (st.msgErro ? 'fa-triangle-exclamation' : 'fa-circle-info') + '" aria-hidden="true"></i> ' + esc(st.msg) + '</span>' +
                '</div>';
        }

        var nAtrEdit = st.resumo.atrasadosEditaveis || 0;
        var txtConfirmaAtr = NUM.format(nAtrEdit) + (nAtrEdit === 1 ? ' pedido programado depois do prazo' : ' pedidos programados depois do prazo');
        var confirmaAtrasoHtml = st.confirmaSalvarAtraso && nAtrEdit > 0
            ? '<div class="rq-msg-barra is-atraso-confirma no-print" data-rq-confirma-atraso="' + esc(nAtrEdit) + '" role="alert">' +
              '<span><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> <strong>' + esc(txtConfirmaAtr) + '.</strong> Isso não bloqueia o salvamento — confirme se deseja gravar assim mesmo.</span>' +
              '<div class="rq-confirma-acoes">' +
                  '<button type="button" class="adm-botao-fantasma" data-rq-acao="cancelar-salvar">Revisar quadro</button>' +
                  '<button type="button" class="adm-botao" data-rq-acao="confirmar-salvar"><i class="fa-solid fa-check" aria-hidden="true"></i> Confirmar e salvar</button>' +
              '</div></div>'
            : '';

        return '<div class="rq-quadro" data-rq-quadro="1" data-rq-inicio="' + esc(st.inicio) + '" data-rq-versao="' + esc(st.versaoBase) + '">' +
            '<section class="adm-card p-4 rq-topo" aria-labelledby="rq-semana-titulo">' +
                '<div class="rq-topo-linha">' +
                    '<div class="rq-titulo-bloco">' +
                        '<h2 class="rota-tit" id="rq-semana-titulo"><i class="fa-solid fa-calendar-week" aria-hidden="true"></i> Programar a semana · Seg ' + esc(dataBr(st.inicio)) + ' a Sáb ' + esc(dataBr(st.fim)) +
                        (ehSemAtual ? ' <span class="rota-selo rota-selo-plano">Semana atual</span>' : '') + '</h2>' +
                        '<p class="rota-sub">O plano salvo alimenta o fechamento das 08:00 de cada dia. Clique no título de um dia para abrir o detalhe (fechar/reabrir, motorista, PDF).</p>' +
                    '</div>' +
                    '<div class="rq-nav-semana no-print" role="group" aria-label="Escolher semana">' +
                        '<button type="button" class="adm-botao-fantasma" data-rq-semana="' + esc(somaDias(st.inicio, -7)) + '"' + (st.salvando ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> Anterior</button>' +
                        '<button type="button" class="adm-chip' + (ehSemAtual ? ' is-ativo' : '') + '" data-rq-semana="' + esc(st.semanaAtualIni) + '" aria-pressed="' + ehSemAtual + '"' + (st.salvando ? ' disabled' : '') + '>Semana atual (' + esc(dataBr(st.semanaAtualIni)) + ')</button>' +
                        '<button type="button" class="adm-chip' + (ehProxSem ? ' is-ativo' : '') + '" data-rq-semana="' + esc(st.proximaSemanaIni) + '" aria-pressed="' + ehProxSem + '"' + (st.salvando ? ' disabled' : '') + '>Próxima (' + esc(dataBr(st.proximaSemanaIni)) + ')</button>' +
                        '<button type="button" class="adm-botao-fantasma" data-rq-semana="' + esc(somaDias(st.inicio, 7)) + '"' + (st.salvando ? ' disabled' : '') + '>Seguinte <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>' +
                    '</div>' +
                '</div>' +
                '<div class="rq-barra-veiculos">' +
                    '<div class="rq-veiculos-grupo no-print" role="group" aria-label="Filtrar veículo no quadro">' +
                        '<button type="button" class="adm-chip' + (st.veiculoAtual === 'todos' ? ' is-ativo' : '') + '" data-rq-veic-filtro="todos" aria-pressed="' + (st.veiculoAtual === 'todos') + '">Todos os veículos</button>' +
                        st.veiculos.map(function (v) {
                            var ativo = st.veiculoAtual === v.id;
                            var diasTxt = v.diasSemSaida.indexOf(6) >= 0 ? 'seg–sex' : 'seg–sáb';
                            var capTxt = v.capacidadeCx24 != null ? v.capacidadeCx24 + ' cx24' : (v.modo === 'cd_ceasa' ? 'CD CEASA' : 's/ limite');
                            return '<button type="button" class="adm-chip' + (ativo ? ' is-ativo' : '') + '" data-rq-veic-filtro="' + esc(v.id) + '" aria-pressed="' + ativo + '">' +
                                '<span class="rota-veic-cor" style="--veic-cor:' + esc(v.cor) + '" aria-hidden="true"></span>' +
                                '<span>' + esc(v.nome) + '</span>' +
                                '<span class="rq-veic-meta">(' + esc(diasTxt + ' · ' + capTxt) + ')</span></button>';
                        }).join('') +
                    '</div>' +
                    '<div class="rq-status-acoes no-print">' +
                        seloEstado +
                        (st.resumo.atrasados > 0
                            ? '<span class="rota-sit rota-sit-vencido" data-rq-resumo-atraso="' + esc(st.resumo.atrasados) + '"><i class="fa-solid fa-clock" aria-hidden="true"></i>' + NUM.format(st.resumo.atrasados) + (st.resumo.atrasados === 1 ? ' após o prazo' : ' após o prazo') + '</span>'
                            : '') +
                        (st.podeEditar
                            ? '<button type="button" class="adm-botao-fantasma" data-rq-acao="sugerir-semana"' + (st.salvando ? ' disabled' : '') + ' title="Pré-preenche o rascunho com as sugestões da semana (não salva sozinho)"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Sugerir semana</button>'
                            : '') +
                        (st.podeEditar && st.temRascunho
                            ? '<button type="button" class="adm-botao-fantasma" data-rq-acao="desfazer"' + (st.salvando ? ' disabled' : '') + '><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Desfazer</button>'
                            : '') +
                        (st.podeEditar && st.temSalvo
                            ? '<button type="button" class="adm-botao-fantasma" data-rq-acao="limpar"' + (st.salvando ? ' disabled' : '') + '><i class="fa-regular fa-trash-can" aria-hidden="true"></i> Limpar salvo</button>'
                            : '') +
                        (st.podeEditar
                            ? '<button type="button" class="adm-botao" data-rq-acao="salvar"' + (st.salvando ? ' disabled aria-busy="true"' : '') + '><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> ' + (st.salvando ? 'Salvando…' : 'Salvar semana') + '</button>'
                            : '') +
                    '</div>' +
                '</div>' +
                confirmaAtrasoHtml +
                msgHtml +
            '</section>' +
            htmlMapaSemana(st) +
            '<div class="rq-grade-dias" role="region" aria-label="Dias da semana">' +
                st.dias.map(function (col) { return htmlColunaDia(col, st); }).join('') +
            '</div>' +
            htmlBandeja(st) +
            '</div>';
    }

    function montar(alvo, dados, callbacks) {
        if (!alvo) return null;
        var cbs = callbacks || {};
        var st = normalizarEstado(dados);
        var arrastando = null;
        var mapaInst = null;
        var camadasPorLinha = Object.create(null);

        function destruirMapa() {
            camadasPorLinha = Object.create(null);
            if (mapaInst) {
                try { mapaInst.remove(); } catch (e) { /* ignore */ }
                mapaInst = null;
            }
        }

        function aplicarDestaqueMapa(diaIso) {
            st.diaDestacadoMapa = diaIso ? String(diaIso).slice(0, 10) : null;
            alvo.querySelectorAll('[data-rq-coluna]').forEach(function (el) {
                el.classList.toggle('is-mapa-destaque', el.getAttribute('data-rq-coluna') === st.diaDestacadoMapa);
            });
            alvo.querySelectorAll('[data-rq-mapa-dia]').forEach(function (el) {
                el.classList.toggle('is-ativo', el.getAttribute('data-rq-mapa-dia') === st.diaDestacadoMapa);
            });
            alvo.querySelectorAll('[data-rq-svg-dia]').forEach(function (polyEl) {
                var d = polyEl.getAttribute('data-rq-svg-dia');
                var ativo = !st.diaDestacadoMapa || d === st.diaDestacadoMapa;
                var focado = st.diaDestacadoMapa && d === st.diaDestacadoMapa;
                polyEl.setAttribute('stroke-opacity', focado ? '1' : (ativo ? '0.86' : '0.16'));
                polyEl.setAttribute('stroke-width', focado ? '4.5' : (ativo ? '3' : '1.8'));
            });
            alvo.querySelectorAll('[data-rq-svg-parada-dia]').forEach(function (gEl) {
                var d = gEl.getAttribute('data-rq-svg-parada-dia');
                var ativo = !st.diaDestacadoMapa || d === st.diaDestacadoMapa;
                var focado = st.diaDestacadoMapa && d === st.diaDestacadoMapa;
                gEl.setAttribute('opacity', focado ? '1' : (ativo ? '0.92' : '0.18'));
            });
            Object.keys(camadasPorLinha).forEach(function (ch) {
                var item = camadasPorLinha[ch];
                if (!item || !item.poly) return;
                var ativo = !st.diaDestacadoMapa || item.dia === st.diaDestacadoMapa;
                var focado = st.diaDestacadoMapa && item.dia === st.diaDestacadoMapa;
                try {
                    item.poly.setStyle({
                        opacity: focado ? 1 : (ativo ? 0.85 : 0.16),
                        weight: focado ? 5 : (ativo ? 3.5 : 2)
                    });
                    if (focado && typeof item.poly.bringToFront === 'function') item.poly.bringToFront();
                    (item.markers || []).forEach(function (mk) {
                        var elMk = mk && typeof mk.getElement === 'function' ? mk.getElement() : null;
                        if (elMk) elMk.style.opacity = focado ? '1' : (ativo ? '0.92' : '0.22');
                    });
                } catch (e) { /* ignore */ }
            });
        }

        function desenharMapaLeaflet() {
            destruirMapa();
            if (!st.mapaAberto) return;
            var elMapa = alvo.querySelector('[data-rq-mapa-canvas="1"]');
            var Lref = (typeof L !== 'undefined' && L) || (raiz && raiz.L) || null;
            if (!elMapa || !Lref || typeof Lref.map !== 'function') return;

            var rm = st.rotasMapa || calcularRotasMapa(st);
            var m = Lref.map(elMapa, { scrollWheelZoom: false });
            Lref.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap',
                maxZoom: 18
            }).addTo(m);

            var todosPontos = [rm.origem];
            Lref.marker(rm.origem, {
                icon: Lref.divIcon({
                    className: 'rota-sede',
                    html: '<span><i class="fa-solid fa-warehouse" aria-hidden="true"></i></span>',
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                }),
                title: 'Depósito — saída e retorno',
                keyboard: false,
                zIndexOffset: 1000
            }).bindTooltip('Depósito (saída e retorno)', { direction: 'top', offset: [0, -14] }).addTo(m);

            (rm.linhas || []).forEach(function (l) {
                var poly = Lref.polyline(l.pontos, {
                    color: l.cor,
                    weight: 3.5,
                    opacity: 0.85,
                    dashArray: l.tracejada ? '6 6' : null,
                    className: 'rq-mapa-polyline'
                }).addTo(m);
                var mks = [];
                l.paradas.forEach(function (p, idx) {
                    todosPontos.push(p.pos);
                    var numTxt = p.ordem != null ? p.ordem : (idx + 1);
                    var mk = Lref.marker(p.pos, {
                        icon: Lref.divIcon({
                            className: 'rota-num-ic',
                            html: '<span class="rota-num" style="background:' + esc(l.cor) + ';color:#fff;border-color:#fff">' + esc(numTxt) + '</span>',
                            iconSize: [24, 24],
                            iconAnchor: [12, 12]
                        }),
                        title: l.rotuloDia + ' · ' + numTxt + '. ' + p.cliente
                    }).bindTooltip(
                        '<strong>' + esc(l.rotuloDia + ' · ' + l.nomeVeiculo) + '</strong><br>' +
                        esc(numTxt + '. ' + p.cliente + ' (#' + p.cd_pedido + ')'),
                        { direction: 'top', offset: [0, -10] }
                    ).addTo(m);
                    mks.push(mk);
                });
                camadasPorLinha[l.chave] = { dia: l.dia, veiculo_id: l.veiculo_id, poly: poly, markers: mks };
            });

            mapaInst = m;
            try {
                m.invalidateSize({ animate: false });
                if (todosPontos.length > 1) {
                    m.fitBounds(todosPontos, { padding: [24, 24], maxZoom: 13, animate: false });
                } else {
                    m.setView(rm.origem, 11, { animate: false });
                }
            } catch (e) { /* ignore */ }
            if (st.diaDestacadoMapa) aplicarDestaqueMapa(st.diaDestacadoMapa);
        }

        function render(focoSeletor) {
            destruirMapa();
            alvo.innerHTML = html(st);
            desenharMapaLeaflet();
            if (focoSeletor) {
                var el = alvo.querySelector(focoSeletor);
                if (el && typeof el.focus === 'function') el.focus();
            }
        }

        function fecharMenus(exceto) {
            alvo.querySelectorAll('details.rq-menu[open]').forEach(function (d) {
                if (d !== exceto) {
                    d.removeAttribute('open');
                    var card = d.closest('.rq-cartao');
                    if (card) card.classList.remove('is-menu-aberto');
                }
            });
        }

        function executar(acao, foco) {
            var r = aplicarAcao(st, acao);
            if (!r.ok) {
                st = normalizarEstado(Object.assign({}, st, { msg: r.motivo, msgErro: true }));
                render(foco);
                return r;
            }
            if (r.pontual && typeof cbs.onMoverPedido === 'function') {
                cbs.onMoverPedido(r.pontual,st); return r;
            }
            st = r.estado;
            render(foco);
            if (acao.tipo === 'programar' && typeof cbs.onProgramar === 'function') cbs.onProgramar(acao, st);
            else if (acao.tipo === 'mover' && typeof cbs.onMover === 'function') cbs.onMover(acao, st);
            else if (acao.tipo === 'remover' && typeof cbs.onRemover === 'function') cbs.onRemover(acao, st);
            else if (acao.tipo === 'aceitar_sugestao') {
                if (typeof cbs.onProgramar === 'function') cbs.onProgramar(acao, st);
                if (typeof cbs.onFeedbackSugestao === 'function') {
                    cbs.onFeedbackSugestao({ cd_pedido: acao.cd_pedido, acao: 'aceita', dia: acao.dia, veiculo_id: acao.veiculo }, st);
                }
            } else if (acao.tipo === 'ignorar_sugestao') {
                if (typeof cbs.onFeedbackSugestao === 'function') {
                    cbs.onFeedbackSugestao({ cd_pedido: acao.cd_pedido, acao: 'ignorada', dia: acao.dia }, st);
                }
            } else if (acao.tipo === 'sugerir_semana') {
                if (typeof cbs.onSugerirSemana === 'function') cbs.onSugerirSemana(r.aplicados || [], st);
            } else if (acao.tipo === 'trocar_veiculo') {
                if (typeof cbs.onTrocarVeiculo === 'function') cbs.onTrocarVeiculo(acao, st);
            }
            if (typeof cbs.onChange === 'function') cbs.onChange(st, acao);
            return r;
        }

        if (calendario) calendario.ligar(alvo,function(chave){
            var cartao=null;
            st.dias.forEach(function(d){d.cartoes.forEach(function(c){if(c.cd_pedido===Number(chave))cartao=c;});});
            st.bandeja.forEach(function(c){if(c.cd_pedido===Number(chave))cartao=c;});
            return {hoje:st.hoje,min:somaDias(st.hoje,1),carregarMes:function(iso){
                if(typeof cbs.onLerCalendario!=='function')return Promise.reject(new Error('Disponibilidade indisponível. Atualize a semana.'));
                return cbs.onLerCalendario(iso).then(function(dados){st.calendarioH[iso.slice(0,7)]=dados;});
            },desabilitado:!st.podeEditar || st.salvando || !cartao || cartao.bloqueado,
                indisponivel:function(iso){return cartao ? motivoDestino(iso,cartao.veiculo,st) : 'Pedido indisponível';},
                selecionar:function(iso){if(cartao)executar({tipo:cartao.dia?'mover':'programar',cd_pedido:cartao.cd_pedido,paraDia:iso,dia:iso,veiculo:cartao.veiculo});}};
        });

        alvo.addEventListener('toggle', function (ev) {
            var menu = ev.target && ev.target.closest && ev.target.closest('details.rq-menu');
            if (!menu) return;
            var card = menu.closest('.rq-cartao');
            if (menu.open) {
                fecharMenus(menu);
                if (card) card.classList.add('is-menu-aberto');
            } else if (card) {
                card.classList.remove('is-menu-aberto');
            }
        }, true);

        alvo.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') {
                var menu = ev.target && ev.target.closest && ev.target.closest('details.rq-menu[open]');
                if (menu) {
                    ev.preventDefault();
                    menu.removeAttribute('open');
                    var card = menu.closest('.rq-cartao');
                    if (card) card.classList.remove('is-menu-aberto');
                    var sum = menu.querySelector('summary');
                    if (sum) sum.focus();
                }
            }
        });

        // 066: passar o mouse num dia destaca só a linha dele no mapa
        alvo.addEventListener('mouseover', function (ev) {
            var col = ev.target && ev.target.closest && ev.target.closest('[data-rq-coluna]');
            var leg = ev.target && ev.target.closest && ev.target.closest('[data-rq-mapa-dia]');
            var dia = (col && col.getAttribute('data-rq-coluna')) || (leg && leg.getAttribute('data-rq-mapa-dia')) || null;
            if (dia && st.diaDestacadoMapa !== dia) {
                aplicarDestaqueMapa(dia);
            }
        });

        alvo.addEventListener('mouseout', function (ev) {
            var col = ev.target && ev.target.closest && ev.target.closest('[data-rq-coluna]');
            var leg = ev.target && ev.target.closest && ev.target.closest('[data-rq-mapa-dia]');
            var origemEl = col || leg;
            if (origemEl && (!ev.relatedTarget || !origemEl.contains(ev.relatedTarget))) {
                aplicarDestaqueMapa(null);
            }
        });

        alvo.addEventListener('click', function (ev) {
            var t = ev.target;
            if (!t || !t.closest) return;

            var btnAbrirDia = t.closest('[data-rq-abrir-dia]');
            if (btnAbrirDia) {
                var diaAbrir = btnAbrirDia.getAttribute('data-rq-abrir-dia');
                if (diaAbrir && typeof cbs.onAbrirDia === 'function') {
                    cbs.onAbrirDia({ dia: diaAbrir }, st);
                }
                return;
            }

            var btnMapaDia = t.closest('[data-rq-mapa-dia]');
            if (btnMapaDia) {
                var dMapa = btnMapaDia.getAttribute('data-rq-mapa-dia');
                aplicarDestaqueMapa(st.diaDestacadoMapa === dMapa ? null : dMapa);
                return;
            }

            var btnSugAceitar = t.closest('[data-rq-sug-aceitar]');
            if (btnSugAceitar && !btnSugAceitar.disabled) {
                var cdSA = Number(btnSugAceitar.getAttribute('data-rq-sug-aceitar'));
                var diaSA = btnSugAceitar.getAttribute('data-rq-sug-dia');
                var veicSA = btnSugAceitar.getAttribute('data-rq-sug-veic');
                executar({ tipo: 'aceitar_sugestao', cd_pedido: cdSA, dia: diaSA, veiculo: veicSA }, '[data-rq-cartao="' + cdSA + '"] summary');
                return;
            }

            var btnSugIgnorar = t.closest('[data-rq-sug-ignorar]');
            if (btnSugIgnorar && !btnSugIgnorar.disabled) {
                var cdSI = Number(btnSugIgnorar.getAttribute('data-rq-sug-ignorar'));
                var diaSI = btnSugIgnorar.getAttribute('data-rq-sug-dia');
                var ehEnc = btnSugIgnorar.getAttribute('data-rq-sug-encaixe') === '1';
                executar({ tipo: 'ignorar_sugestao', cd_pedido: cdSI, dia: diaSI, encaixe: ehEnc });
                return;
            }

            var btnProg = t.closest('[data-rq-programar-dia]');
            if (btnProg && !btnProg.disabled) {
                var cdP = Number(btnProg.getAttribute('data-rq-cd'));
                var diaP = btnProg.getAttribute('data-rq-programar-dia');
                var veicP = btnProg.getAttribute('data-rq-veic');
                executar({ tipo: 'programar', cd_pedido: cdP, dia: diaP, veiculo: veicP }, '[data-rq-cartao="' + cdP + '"] summary');
                return;
            }

            var btnMov = t.closest('[data-rq-mover-dia]');
            if (btnMov && !btnMov.disabled) {
                var cdM = Number(btnMov.getAttribute('data-rq-cd'));
                var cardM = btnMov.closest('[data-rq-cartao]');
                var deDiaM = cardM ? cardM.getAttribute('data-rq-dia') : null;
                var paraDiaM = btnMov.getAttribute('data-rq-mover-dia');
                var veicM = btnMov.getAttribute('data-rq-veic');
                executar({ tipo: 'mover', cd_pedido: cdM, deDia: deDiaM, paraDia: paraDiaM, veiculo: veicM }, '[data-rq-cartao="' + cdM + '"] summary');
                return;
            }

            var btnRem = t.closest('[data-rq-remover]');
            if (btnRem && !btnRem.disabled) {
                var cdR = Number(btnRem.getAttribute('data-rq-remover'));
                var deDiaR = btnRem.getAttribute('data-rq-de-dia');
                executar({ tipo: 'remover', cd_pedido: cdR, deDia: deDiaR }, '[data-rq-cartao="' + cdR + '"] summary');
                return;
            }

            var btnOrd = t.closest('[data-rq-ordem]');
            if (btnOrd && !btnOrd.disabled) {
                var cdO = Number(btnOrd.getAttribute('data-rq-cd'));
                var delta = Number(btnOrd.getAttribute('data-rq-ordem'));
                var cardO = btnOrd.closest('[data-rq-cartao]');
                var diaO = cardO ? cardO.getAttribute('data-rq-dia') : null;
                var colO = st.dias.filter(function (d) { return d.dia === diaO; })[0];
                if (colO) {
                    var idxAtual = -1;
                    colO.cartoes.forEach(function (c, i) { if (c.cd_pedido === cdO) idxAtual = i; });
                    if (idxAtual >= 0) {
                        executar({ tipo: 'mover', cd_pedido: cdO, deDia: diaO, paraDia: diaO, ordem: idxAtual + 1 + delta }, '[data-rq-cartao="' + cdO + '"] [data-rq-ordem="' + delta + '"]');
                    }
                }
                return;
            }

            var btnSemSaida = t.closest('[data-rq-marcar-sem-saida]');
            if (btnSemSaida && !btnSemSaida.disabled) {
                var diaSS = btnSemSaida.getAttribute('data-rq-dia');
                var veicSS = btnSemSaida.getAttribute('data-rq-veic');
                var flagSS = btnSemSaida.getAttribute('data-rq-marcar-sem-saida') === '1';
                if (typeof cbs.onMarcarSemSaida === 'function') {
                    cbs.onMarcarSemSaida({ dia: diaSS, veiculo_id: veicSS, sem_saida: flagSS, versao_base: st.versaoBase, motivo: null }, st);
                }
                return;
            }

            var btnExp = t.closest('[data-rq-expandir]');
            if (btnExp) {
                var diaE = btnExp.getAttribute('data-rq-expandir');
                st.pilhasExpandidas[diaE] = !st.pilhasExpandidas[diaE];
                render('[data-rq-expandir="' + diaE + '"]');
                if (typeof cbs.onExpandirPilha === 'function') cbs.onExpandirPilha(st.pilhasExpandidas, st);
                return;
            }

            var btnVeic = t.closest('[data-rq-veic-filtro]');
            if (btnVeic) {
                var vf = btnVeic.getAttribute('data-rq-veic-filtro');
                st = normalizarEstado(Object.assign({}, st, { veiculoAtual: vf }));
                render('[data-rq-veic-filtro="' + vf + '"]');
                if (typeof cbs.onMudarVeiculo === 'function') cbs.onMudarVeiculo({ veiculo: vf }, st);
                return;
            }

            var btnFiltro = t.closest('[data-rq-filtro]');
            if (btnFiltro) {
                var fb = btnFiltro.getAttribute('data-rq-filtro');
                st.filtroBandeja = fb;
                render('[data-rq-filtro="' + fb + '"]');
                return;
            }

            var btnSem = t.closest('[data-rq-semana]');
            if (btnSem && !btnSem.disabled) {
                var novaSem = btnSem.getAttribute('data-rq-semana');
                if (typeof cbs.onMudarSemana === 'function') cbs.onMudarSemana({ inicio: novaSem }, st);
                return;
            }

            var btnAcao = t.closest('[data-rq-acao]');
            if (btnAcao && !btnAcao.disabled) {
                var ac = btnAcao.getAttribute('data-rq-acao');
                if (ac === 'sugerir-semana') {
                    executar({ tipo: 'sugerir_semana' }, '[data-rq-acao="salvar"]');
                } else if (ac === 'toggle-mapa') {
                    st = normalizarEstado(Object.assign({}, st, { mapaAberto: !st.mapaAberto }));
                    render('[data-rq-acao="toggle-mapa"]');
                } else if (ac === 'salvar') {
                    // 066: confirmação leve ao salvar quando há pedidos programados depois do prazo (não bloqueia)
                    if (st.resumo.atrasadosEditaveis > 0 && !st.confirmaSalvarAtraso && cbs.confirmarAtraso !== false) {
                        st = normalizarEstado(Object.assign({}, st, { confirmaSalvarAtraso: true }));
                        render('[data-rq-acao="confirmar-salvar"]');
                        return;
                    }
                    st = normalizarEstado(Object.assign({}, st, { confirmaSalvarAtraso: false }));
                    if (typeof cbs.onSalvar === 'function') {
                        cbs.onSalvar(montarPayloadSalvar(st), st);
                    }
                } else if (ac === 'confirmar-salvar') {
                    st = normalizarEstado(Object.assign({}, st, { confirmaSalvarAtraso: false }));
                    if (typeof cbs.onSalvar === 'function') {
                        cbs.onSalvar(montarPayloadSalvar(st), st);
                    }
                } else if (ac === 'cancelar-salvar') {
                    st = normalizarEstado(Object.assign({}, st, { confirmaSalvarAtraso: false }));
                    render('[data-rq-acao="salvar"]');
                } else if (ac === 'desfazer' && typeof cbs.onDesfazer === 'function') {
                    cbs.onDesfazer(st);
                } else if (ac === 'limpar' && typeof cbs.onLimpar === 'function') {
                    cbs.onLimpar(st);
                } else if (ac === 'recarregar' && typeof cbs.onRecarregar === 'function') {
                    cbs.onRecarregar(st);
                }
                return;
            }

            var cardClick = t.closest('.rq-cartao');
            if (cardClick && !t.closest('details.rq-menu') && !t.closest('button') && !t.closest('select') && !t.closest('.rq-cartao-veic-wrap')) {
                cardClick.classList.toggle('is-aberto');
            }
        });

        alvo.addEventListener('change', function (ev) {
            var sel = ev.target && ev.target.closest && ev.target.closest('[data-rq-veiculo-select]');
            if (!sel || sel.disabled) return;
            var cdV = Number(sel.getAttribute('data-rq-veiculo-select'));
            var novoV = sel.value || '';
            if (!cdV || !novoV) return;
            executar({ tipo: 'trocar_veiculo', cd_pedido: cdV, veiculo: novoV }, '[data-rq-cartao="' + cdV + '"] [data-rq-veiculo-select]');
        });

        alvo.addEventListener('input', function (ev) {
            var inp = ev.target;
            if (!inp || !inp.getAttribute || !inp.getAttribute('data-rq-busca')) return;
            var pos = inp.selectionStart;
            st.buscaBandeja = inp.value || '';
            render('#rq-busca-bandeja');
            var novoInp = alvo.querySelector('#rq-busca-bandeja');
            if (novoInp && pos != null) novoInp.setSelectionRange(pos, pos);
        });

        // HTML5 Drag and Drop (bandeja <-> dias e dia <-> dia)
        alvo.addEventListener('dragstart', function (ev) {
            var card = ev.target && ev.target.closest && ev.target.closest('.rq-cartao[draggable="true"]');
            if (!card) return;
            arrastando = {
                cd_pedido: Number(card.getAttribute('data-rq-cartao')),
                deDia: card.getAttribute('data-rq-dia') || null,
                veiculo: card.getAttribute('data-rq-veiculo') || null
            };
            card.classList.add('is-arrastando');
            if (ev.dataTransfer) {
                ev.dataTransfer.effectAllowed = 'move';
                try { ev.dataTransfer.setData('text/plain', String(arrastando.cd_pedido)); } catch (e) { /* ignore */ }
            }
        });

        alvo.addEventListener('dragend', function () {
            arrastando = null;
            alvo.querySelectorAll('.is-arrastando, .is-alvo-solta').forEach(function (el) {
                el.classList.remove('is-arrastando', 'is-alvo-solta');
            });
        });

        alvo.addEventListener('dragover', function (ev) {
            if (!arrastando) return;
            var zona = ev.target && ev.target.closest && ev.target.closest('[data-rq-zona]');
            if (!zona) return;
            ev.preventDefault();
            if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
            alvo.querySelectorAll('.is-alvo-solta').forEach(function (el) {
                if (el !== zona) el.classList.remove('is-alvo-solta');
            });
            zona.classList.add('is-alvo-solta');
        });

        alvo.addEventListener('dragleave', function (ev) {
            var zona = ev.target && ev.target.closest && ev.target.closest('[data-rq-zona]');
            if (zona && !zona.contains(ev.relatedTarget)) zona.classList.remove('is-alvo-solta');
        });

        alvo.addEventListener('drop', function (ev) {
            if (!arrastando) return;
            var zona = ev.target && ev.target.closest && ev.target.closest('[data-rq-zona]');
            if (!zona) return;
            ev.preventDefault();
            zona.classList.remove('is-alvo-solta');
            var tipoZona = zona.getAttribute('data-rq-zona');
            var info = arrastando;
            arrastando = null;
            if (tipoZona === 'bandeja') {
                if (info.deDia) executar({ tipo: 'remover', cd_pedido: info.cd_pedido, deDia: info.deDia, veiculo: info.veiculo });
            } else if (tipoZona === 'dia') {
                var paraDia = zona.getAttribute('data-rq-alvo-dia');
                var sobreCard = ev.target && ev.target.closest && ev.target.closest('.rq-cartao[data-rq-dia="' + paraDia + '"]');
                var ordemAlvo = null;
                if (sobreCard) {
                    var cdSobre = Number(sobreCard.getAttribute('data-rq-cartao'));
                    var col = st.dias.filter(function (d) { return d.dia === paraDia; })[0];
                    if (col) {
                        col.cartoes.forEach(function (c, idx) { if (c.cd_pedido === cdSobre) ordemAlvo = idx + 1; });
                    }
                }
                if (!info.deDia) {
                    executar({ tipo: 'programar', cd_pedido: info.cd_pedido, dia: paraDia, veiculo: info.veiculo, ordem: ordemAlvo });
                } else {
                    executar({ tipo: 'mover', cd_pedido: info.cd_pedido, deDia: info.deDia, paraDia: paraDia, veiculo: info.veiculo, ordem: ordemAlvo });
                }
            }
        });

        render();

        return {
            estado: function () { return st; },
            rotasMapa: function () { return st.rotasMapa || calcularRotasMapa(st); },
            destacarDiaMapa: function (diaIso) { aplicarDestaqueMapa(diaIso); return st.diaDestacadoMapa; },
            payloadSalvar: function () { return montarPayloadSalvar(st); },
            executar: executar,
            atualizar: function (novosDados) { st = normalizarEstado(novosDados); render(); return st; },
            sinalizarVersaoAntiga: function () {
                st = normalizarEstado(Object.assign({}, st, { versaoConflito: true, salvando: false }));
                render('[data-rq-acao="recarregar"]');
                return st;
            }
        };
    }

    // Dados realistas da semana atual (Seg 23/11 a Sáb 28/11, hoje = Qua 25/11) com coordenadas e sugestões 066
    function dadosExemplo() {
        return {
            inicio: '2026-11-23',
            fim: '2026-11-28',
            hoje: '2026-11-25',
            versaoBase: 3,
            podeEditar: true,
            salvando: false,
            temRascunho: true,
            temSalvo: true,
            veiculoAtual: 'todos',
            veiculos: [
                { id: 's10',      nome: 'S10',              modo: 'porta',    cor: '#2563eb', capacidade: 2700, diasSemSaida: [0, 6], ativo: true },
                { id: 'caminhao', nome: 'Caminhão (CEASA)', modo: 'cd_ceasa', cor: '#b45309', capacidade: null, diasSemSaida: [0],    ativo: true },
                { id: 'strada',   nome: 'Strada',           modo: 'porta',    cor: '#059669', capacidade: null, diasSemSaida: [0, 6], ativo: false }
            ],
            dias: [
                {
                    dia: '2026-11-23', nome: 'Segunda', regiao: 'Setor Norte · Irajá, Madureira',
                    capacidade: 2700,
                    cartoes: [
                        { cd_pedido: 1510, cliente: 'Hortifruti Tatais Julieta', bairro: 'Irajá', cidade: 'Rio de Janeiro', pos: [-22.8315, -43.3268], prazo: '2026-11-23', situacao: 'ok', c24: 110, c48: 20, veiculo: 's10', origemDia: 'salvo' },
                        { cd_pedido: 1512, cliente: 'Box Petro Frutas CEASA', bairro: 'Irajá', cidade: 'Rio de Janeiro', pos: [-22.8269, -43.3400], prazo: '2026-11-23', situacao: 'ok', c24: 180, c48: 40, veiculo: 'caminhao', origemDia: 'salvo' }
                    ]
                },
                {
                    dia: '2026-11-24', nome: 'Terça', regiao: 'Setor Oeste · Barra, Recreio',
                    capacidade: 2700,
                    cartoes: [
                        { cd_pedido: 1518, cliente: 'Supermercado Rio Sul Barra', bairro: 'Barra da Tijuca', cidade: 'Rio de Janeiro', pos: [-23.0004, -43.3659], prazo: '2026-11-24', situacao: 'ok', c24: 140, c48: 30, veiculo: 's10', origemDia: 'salvo' },
                        { cd_pedido: 1521, cliente: 'Empório gourmet Américas', bairro: 'Recreio', cidade: 'Rio de Janeiro', pos: [-23.0191, -43.4622], prazo: '2026-11-25', situacao: 'ok', c24: 65, c48: 10, veiculo: 's10', origemDia: 'salvo' }
                    ]
                },
                {
                    dia: '2026-11-25', nome: 'Quarta', regiao: 'Setor Sul · Copacabana, Botafogo', fechada: true,
                    capacidade: 2700,
                    cartoes: [
                        { cd_pedido: 1528, cliente: 'Supermercado Zona Sul', bairro: 'Copacabana', cidade: 'Rio de Janeiro', pos: [-22.9698, -43.1869], prazo: '2026-11-25', situacao: 'hoje', c24: 120, c48: 25, veiculo: 's10', origemDia: 'salvo', prioridade: true },
                        { cd_pedido: 1531, cliente: 'Mercearia Pão de Açúcar Sul', bairro: 'Botafogo', cidade: 'Rio de Janeiro', pos: [-22.9519, -43.1857], prazo: '2026-11-25', situacao: 'hoje', c24: 85, c48: 15, veiculo: 's10', origemDia: 'salvo', janela: '08:00–12:00' }
                    ]
                },
                {
                    dia: '2026-11-26', nome: 'Quinta', regiao: 'Setor Centro · Tijuca, Vila Isabel',
                    capacidade: 2700,
                    cartoes: [
                        { cd_pedido: 1536, cliente: 'Mercado Império da Tijuca', bairro: 'Tijuca', cidade: 'Rio de Janeiro', pos: [-22.9248, -43.2325], prazo: '2026-11-25', situacao: 'vencido', estoura: true, c24: 95, c48: 20, veiculo: 's10', origemDia: 'salvo', prioridade: true },
                        { cd_pedido: 1539, cliente: 'Sacolão Saens Peña', bairro: 'Tijuca', cidade: 'Rio de Janeiro', pos: [-22.9241, -43.2328], prazo: '2026-11-26', situacao: 'hoje', c24: 70, c48: 10, veiculo: 's10', origemDia: 'rascunho', janela: '09:00–14:00' },
                        { cd_pedido: 1541, cliente: 'Atacadão Ceasa Pavilhão 43', bairro: 'Irajá', cidade: 'Rio de Janeiro', pos: [-22.8269, -43.3400], prazo: '2026-11-26', situacao: 'ok', c24: 150, c48: 0, veiculo: 'caminhao', origemDia: 'salvo' },
                        { cd_pedido: 1543, cliente: 'Bistrô Vila Isabel', bairro: 'Vila Isabel', cidade: 'Rio de Janeiro', pos: [-22.9165, -43.2452], prazo: '2026-11-27', situacao: 'ok', c24: 42, c48: 8, veiculo: 's10', origemDia: 'sugestao' }
                    ]
                },
                {
                    dia: '2026-11-27', nome: 'Sexta', regiao: 'Setor Leste · Niterói, São Gonçalo',
                    capacidade: 2700,
                    cartoes: [
                        { cd_pedido: 1546, cliente: 'Rede Economia Icaraí', bairro: 'Icaraí', cidade: 'Niterói', pos: [-22.9056, -43.1069], prazo: '2026-11-26', situacao: 'vencido', estoura: true, c24: 130, c48: 30, veiculo: 's10', origemDia: 'salvo', prioridade: true },
                        { cd_pedido: 1548, cliente: 'Hortifruti Ingá Plaza', bairro: 'Ingá', cidade: 'Niterói', pos: [-22.9022, -43.1245], prazo: '2026-11-27', situacao: 'hoje', c24: 90, c48: 20, veiculo: 's10', origemDia: 'salvo' },
                        { cd_pedido: 1550, cliente: 'Super Compras Alcântara', bairro: 'Alcântara', cidade: 'São Gonçalo', pos: [-22.8165, -43.0031], prazo: '2026-11-27', situacao: 'ok', c24: 55, c48: 0, veiculo: 's10', origemDia: 'rascunho' }
                    ]
                },
                {
                    dia: '2026-11-28', nome: 'Sábado', regiao: 'CD CEASA · Av. Brasil, 19001',
                    capacidade: null,
                    cartoes: [
                        { cd_pedido: 1552, cliente: 'Distribuidora Frutas do Vale (Box 18)', bairro: 'Irajá', cidade: 'Rio de Janeiro', pos: [-22.8269, -43.3400], prazo: '2026-11-28', situacao: 'ok', c24: 210, c48: 50, veiculo: 'caminhao', origemDia: 'salvo' },
                        { cd_pedido: 1554, cliente: 'Comercial Agrícola Carioca (Box 07)', bairro: 'Irajá', cidade: 'Rio de Janeiro', pos: [-22.8275, -43.3395], prazo: '2026-11-28', situacao: 'ok', c24: 145, c48: 20, veiculo: 'caminhao', origemDia: 'rascunho' }
                    ]
                }
            ],
            bandeja: [
                { cd_pedido: 1534, cliente: 'Supermercado Guanabara Penha', bairro: 'Penha', cidade: 'Rio de Janeiro', pos: [-22.8427, -43.2785], prazo: '2026-11-24', situacao: 'vencido', c24: 115, c48: 25, veiculo: 's10', motivoBandeja: 'capacidade', prioridade: true },
                { cd_pedido: 1540, cliente: 'Padaria & Confeitaria Leblon', bairro: 'Leblon', cidade: 'Rio de Janeiro', pos: [-22.9841, -43.2231], prazo: '2026-11-25', situacao: 'hoje', c24: 15, c48: 4, veiculo: 's10', motivoBandeja: 'removido', origemDia: 'removido', diaAnterior: '2026-11-26' },
                { cd_pedido: 1545, cliente: 'Armazém São Francisco', bairro: 'São Francisco', cidade: 'Niterói', pos: null, prazo: '2026-11-27', situacao: 'ok', c24: 60, c48: 10, veiculo: 's10', motivoBandeja: 'sem_posicao' },
                { cd_pedido: 1556, cliente: 'Mercado Novo Horizonte', bairro: 'Campo Grande', cidade: 'Rio de Janeiro', pos: [-22.9028, -43.5591], prazo: '2026-11-28', situacao: 'ok', c24: 80, c48: 15, veiculo: '', faltaMarcar: true, motivoBandeja: 'falta_marcar' }
            ]
        };
    }

    var api = {
        normalizarEstado: normalizarEstado,
        montarPayloadSalvar: montarPayloadSalvar,
        aplicarAcao: aplicarAcao,
        motivoDestino: motivoDestino,
        aplicarSugestoesSemana: aplicarSugestoesSemana,
        gerarStubSugestoes066: gerarStubSugestoes066,
        normalizarSugestoes066: normalizarSugestoes066,
        calcularRotasMapa: calcularRotasMapa,
        diferencaDias: diferencaDias,
        html: html,
        montar: montar,
        dadosExemplo: dadosExemplo
    };

    if (ehNode) module.exports = api;
    raiz.TempRioRotaQuadro = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
