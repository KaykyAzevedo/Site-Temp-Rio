/* =====================================================================
 * ROTA DO DIA (aba "Rotas" do painel) — módulo separado do admin.js.
 *
 * O que faz: pega os pedidos do ERP ainda não saídos (Kanban do WMS), separa CEASA (caminhão) e S10
 * (na v2 pela marcação com memória por cliente; sem a 044 pela regra automática), escolhe o que cabe na S10
 * por PRAZO e VOLUME, respeita dias sem receber, prioridade e janela de horário (044) e ordena as paradas
 * saindo da sede. No caminhão (v2/v3), tudo o que está marcado CEASA vai para UMA parada: "Centro de
 * distribuição CEASA" (v3: sem paradas em bairros no caminho). 045: pedido "tirado da rota" fica numa lista
 * "Fora da rota" até alguém clicar "Voltar para a rota".
 *
 * Privacidade: o planejamento roda no navegador. O mapa-base é carregado do OpenStreetMap; nenhum dado de cliente
 * é enviado. O botão "Abrir no Google Maps" só existe no clique e leva SÓ coordenadas (sem nome, documento ou endereço).
 *
 * Fontes (RLS eh_equipe para leitura; escrita de marcação/regras por pode_marcar_rota() e rota_config por eh_admin()):
 *   solidcon_pedidos_erp (035; caixas_24/48/outras da 039 — 'caixas_outras' são POTES AVULSOS, ver ROTA.VOLUME_POTE),
 *   solidcon_pedidos_erp_sync,
 *   RPC solidcon_mapa_clientes / solidcon_rota_posicoes (041),
 *   solidcon_clientes (logradouro/número/bairro para a regra do CEASA e a lista),
 *   rota_config e rota_cliente_veiculo (040),
 *   rota_pedido_veiculo, rota_cliente_regras, pode_marcar_rota() e rota_044_marcar (044),
 *   rota_pedido_ignorado (045, opcional: sem ela o botão "Tirar da rota" não aparece),
 *   rota_plano_semana e rota_046_salvar_semana (046, opcional: plano de referência seg–sex da S10).
 * ===================================================================== */
(function (raiz) {
    'use strict';

    // Planejador PURO (regras, datas/feriados, volume, veículo, ordem, horários, Google Maps): supabase/functions/_shared/rota-core.js,
    // o MESMO arquivo usado pela Edge Function whatsapp-rotinas (rota para os entregadores). Aqui fica só a interface.
    var ehNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
    var core = ehNode ? require('../supabase/functions/_shared/rota-core.js') : raiz.TempRioRotaCore;
    if (!core) { if (raiz.console) raiz.console.error('[rotas] rota-core.js não carregou (admin.html deve carregá-lo antes de admin-rota.js).'); return; }
    var ROTA = core.ROTA;
    var CFG_PADRAO = core.CFG_PADRAO;
    var cfgDe = core.cfgDe;
    var diaSP = core.diaSP;
    var somaDias = core.somaDias;
    var diaSemana = core.diaSemana;
    var feriadosDoAno = core.feriadosDoAno;
    var dataBr = core.dataBr;
    var nomeDia = core.nomeDia;
    var proximaSaida = core.proximaSaida;
    var situacaoPrazo = core.situacaoPrazo;
    var proximaSemana = core.proximaSemana;
    var segundaDe = core.segundaDe;
    var km = core.km;
    var norm = core.norm;
    var planejar = core.planejar;
    var planejarSemana = core.planejarSemana;
    var linksGoogleMaps = core.linksGoogleMaps;
    var hhmm = core.hhmm;
    var minutosDe = core.minutosDe;
    var regraDe = core.regraDe;
    var regrasDe = core.regrasDe;
    var Planejador = core;   // testes e TempRioRota.planejador
    if (ehNode) { module.exports = Planejador; return; }   // node: só o planejador

    // ===================== UI (navegador) =====================
    var DIAS_CURTOS = [[1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb'], [0, 'Dom']];
    var DIAS_ROTULO = { 0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sáb' };
    var st = { carregado: false, carregando: false, erro: null, pedidos: [], clientes: {}, coletado: null, temCaixas: false,
               vista: 'hoje', mapa: null, ro: null, sb: null, papel: null, alvo: null, seq: 0, ativo: false,
               // 040: configuração (linha de rota_config ou null), padrões/exceções por cliente
               cfgLinha: null, cfg: cfgDe(CFG_PADRAO), cfgAusente: false, cfgErro: null, excecoes: {},
               cfgAberto: false, msgVeiculo: '', focoVeiculo: null,
               gravandoVeiculo: {}, seqVeiculo: {},   // R2: gravação por cliente/pedido em andamento (trava o seletor) e sequência
               dlgSalvando: false, dlgAbertura: 0,    // R3: gravação do "Configurar rota" pendente (fora do botão)
               // 044 (Rotas v2): marcação por pedido, regras de entrega por cliente e permissão pode_marcar_rota()
               v2: false, podeMarcar: false, porPedido: {}, regras: {},
               focoPedido: null, focoRegra: null, regraSalvando: false, regraAbertura: 0,
               // UI1: versão das MUTAÇÕES (sobe a cada gravação concluída). Leitura que começou antes de uma gravação
               // terminar é descartada e refeita; "Atualizar" com gravação pendente espera ela terminar.
               mut: 0, recargaPendente: false,
               // UI2: erro de leitura da v2 (não é 044 ausente) e último retrato completo (referências, seguem as gravações)
               erroV2: null, desatualizado: false, ultimoV2: null,
               // Mapa: enquadramento escolhido pelo usuário, por vista ('hoje' | 'proxima'). Vazio = enquadra a rota.
               mapaVista: {}, mapaAberto: false, focoMapa: false,
               // 045 (Tirar da rota): tabela lida? pedidos ignorados { cd_pedido: {motivo, atualizado_em} }, lista aberta
               ign045: false, ignorados: {}, foraAberto: false, focoFora: false, focoTirar: null,
               // 046 (Plano da semana da S10): tabela lida? plano salvo { cd_pedido: 'YYYY-MM-DD' }, rascunho local e semana alvo
               pln046: false, plano: {}, rascSemana: {}, semanaIni: null, semSalvando: false, msgSemana: '', focoSem: null };
    var NUM = new Intl.NumberFormat('pt-BR'), NUM1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function brl(c) { return c == null ? '—' : (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
    function hojeSP() { return diaSP(new Date()); }

    function paginar(fazer, max) {
        var todos = [];
        function pagina(ini) {
            return fazer().range(ini, ini + 999).then(function (r) {
                if (r.error) return { error: r.error };
                todos = todos.concat(r.data || []);
                if ((r.data || []).length === 1000 && todos.length < max) return pagina(ini + 1000);
                return { data: todos };
            });
        }
        return pagina(0);
    }

    // Celular/tela estreita/toque: lote menor (limite de paradas do app do Google Maps).
    function ehMovel() { try { return !!(window.matchMedia && window.matchMedia(ROTA.MOVEL_MQ).matches); } catch (e) { return false; } }
    function loteGmaps() { return ehMovel() ? ROTA.LOTE_GMAPS_MOVEL : ROTA.LOTE_GMAPS; }

    // Solta o mapa Leaflet e o ResizeObserver. Chamado ANTES de qualquer troca do HTML da aba (carregando, erro,
    // redesenho) e ao sair da aba/do painel: nada fica preso a um nó que já saiu do DOM.
    function liberarMapa() {
        if (st.ro) { try { st.ro.disconnect(); } catch (e) { /* já solto */ } st.ro = null; }
        if (st.mapa) { try { st.mapa.remove(); } catch (e) { /* já removido */ } st.mapa = null; }
    }

    // Gravação em andamento (marcação, exceção v1, regra, configuração ou plano da semana)?
    var MSG_ESPERA = 'Atualizando assim que a gravação em andamento terminar…';
    function pendentes() { return Object.keys(st.gravandoVeiculo).length > 0 || !!st.regraSalvando || !!st.dlgSalvando || !!st.semSalvando; }
    // Chamada quando QUALQUER gravação termina (ok ou erro), antes do redesenho: sobe a versão e solta a recarga adiada.
    function aposMutacao() {
        st.mut++;
        if (st.recargaPendente && !pendentes()) {   // o desenhar() seguinte recarrega (e este timeout garante, se ninguém desenhar)
            st.recargaPendente = false; st.carregado = false; st.msgVeiculo = st.msgVeiculo === MSG_ESPERA ? '' : st.msgVeiculo;
            setTimeout(function () { if (!st.carregado && !st.carregando) desenhar(); }, 0);
        }
    }
    function carregar() {
        if (!st.sb || st.carregando || !st.ativo) return;
        // UI1: com gravação pendente, a leitura poderia trazer o estado de ANTES dela. Espera terminar (aposMutacao).
        if (pendentes()) { st.recargaPendente = true; return; }
        var seq = ++st.seq, sb = st.sb, mut0 = st.mut;
        st.carregando = true; st.erro = null; desenhar();
        Promise.all([
            paginar(function () { return sb.from('solidcon_pedidos_erp').select('*').in('etapa', ROTA.ETAPAS_PENDENTES).order('cd_pedido', { ascending: true }); }, 5000),
            sb.from('solidcon_pedidos_erp_sync').select('coletado_em').eq('status', 'ok').order('coletado_em', { ascending: false }).limit(1),
            paginar(function () { return sb.rpc('solidcon_mapa_clientes').order('documento', { ascending: true }); }, 20000),
            // 040 (opcional): configuração e padrões/exceções por cliente. Sem a migração: padrões, sem erro.
            sb.from('rota_config').select('*').eq('id', 1).limit(1),
            paginar(function () { return sb.from('rota_cliente_veiculo').select('documento,veiculo').order('documento', { ascending: true }); }, 20000),
            // 044 (opcional): escolha por pedido, regras por cliente e permissão pode_marcar_rota(). Sem a 044: modo v1.
            paginar(function () { return sb.from('rota_pedido_veiculo').select('cd_pedido,veiculo').order('cd_pedido', { ascending: true }); }, 20000),
            paginar(function () { return sb.from('rota_cliente_regras').select('documento,janela_inicio,janela_fim,dias_sem_receber,prioridade,observacao').order('documento', { ascending: true }); }, 20000),
            sb.rpc('pode_marcar_rota'),
            // 045 (opcional): pedidos tirados da rota até reativar. Ausente = ninguém ignorado e sem o botão.
            paginar(function () { return sb.from('rota_pedido_ignorado').select('cd_pedido,motivo,atualizado_em').order('cd_pedido', { ascending: true }); }, 20000),
            // 046 (opcional): plano de referência da semana da S10. Ausente = sub-aba mostra sugestão sem salvar.
            paginar(function () { return sb.from('rota_plano_semana').select('cd_pedido,dia').order('cd_pedido', { ascending: true }); }, 20000)
        ]).then(function (rs) {
            if (seq !== st.seq) return;
            if (rs[0].error) throw rs[0].error;
            var pedidos = rs[0].data || [];
            var docs = {}; pedidos.forEach(function (p) { if (p.documento) docs[p.documento] = true; });
            var lista = Object.keys(docs);
            // Endereço (regra do CEASA e lista): só dos clientes com pedido pendente, em blocos.
            var blocos = [];
            for (var i = 0; i < lista.length; i += 200) blocos.push(lista.slice(i, i + 200));
            // Posição: solidcon_rota_posicoes (041) por documento COM PEDIDO — sem o filtro comercial do mapa (fornecedor
            // com pedido real continua com posição e com a regra do CEASA por raio). Sem a 041: posição do mapa (antes).
            var pBlocos = [];
            for (var j = 0; j < lista.length; j += 500) pBlocos.push(lista.slice(j, j + 500));
            var posicoes = Promise.all(pBlocos.map(function (b) { return sb.rpc('solidcon_rota_posicoes', { p_documentos: b }); }))
                .then(function (ps) {
                    var e = ps.filter(function (r) { return r.error; })[0];
                    if (e) return rpcAusente(e.error) ? null : { erro: String(e.error.message || e.error) };
                    return { linhas: [].concat.apply([], ps.map(function (r) { return r.data || []; })) };
                }, function (e) { return { erro: String((e && e.message) || e) }; });
            return Promise.all([Promise.all(blocos.map(function (b) {
                return sb.from('solidcon_clientes').select('documento,nome,logradouro,numero,complemento,bairro,cidade,estado').in('documento', b);
            })), posicoes]).then(function (cp) {
                if (seq !== st.seq) return;
                // UI1: alguma gravação terminou (ou começou) durante esta leitura: o retrato pode ser anterior a ela.
                // Descarta e lê de novo (ou espera a gravação pendente terminar).
                if (st.mut !== mut0 || pendentes()) {
                    st.carregando = false;
                    if (pendentes()) { st.recargaPendente = true; st.carregado = false; return; }
                    carregar(); return;
                }
                var cs = cp[0], rp = cp[1];
                var cli = {};
                cs.forEach(function (r) { if (!r.error) (r.data || []).forEach(function (c) { cli[c.documento] = { nome: c.nome, logradouro: c.logradouro, numero: c.numero,
                    complemento: c.complemento, bairro: c.bairro, cidade: c.cidade, pos: null, precisao: null }; }); });
                function posDe(m) {
                    if (!docs[m.documento]) return;
                    var c = cli[m.documento] || (cli[m.documento] = { nome: m.nome, bairro: m.bairro, cidade: m.cidade, pos: null });
                    var lat = Number(m.lat), lng = Number(m.lng);
                    if (m.lat != null && m.lng != null && isFinite(lat) && isFinite(lng) && !m.pino_desatualizado) { c.pos = [lat, lng]; c.precisao = m.precisao; }
                }
                var mapa = rs[2] && !rs[2].error ? rs[2].data || [] : [];
                if (!rp) mapa.forEach(posDe);   // sem a 041: posição vem do mapa (comportamento anterior)
                if (rp && rp.linhas) rp.linhas.forEach(posDe);
                st.pedidos = pedidos; st.clientes = cli;
                st.temCaixas = pedidos.some(function (p) { return 'caixas_24' in p; });
                var sy = rs[1] && !rs[1].error && rs[1].data && rs[1].data[0];
                st.coletado = sy ? sy.coletado_em : null;
                st.posErro = rp && rp.erro ? rp.erro : (!rp && rs[2] && rs[2].error ? String(rs[2].error.message || rs[2].error) : null);
                lerConfig(rs[3], rs[4], rs[5], rs[6], rs[7], rs[8], rs[9]);
                st.carregando = false; st.carregado = true; desenhar();
            });
        }).catch(function (e) {
            if (seq !== st.seq) return;
            st.carregando = false; st.carregado = false; st.erro = String((e && e.message) || e); desenhar();
        });
    }

    // Função inexistente (041/044 não aplicada): PostgREST PGRST202 / Postgres 42883.
    function rpcAusente(err) { return !!err && /PGRST202|42883|Could not find the function/i.test(String(err.code || '') + ' ' + String(err.message || '')); }
    // Tabela inexistente (040/044/045/046 não aplicada): SÓ PostgREST PGRST205 ou Postgres 42P01 referente à própria tabela.
    // Coluna ausente (42703 / PGRST204), outra relação ou erro sem código NÃO são ausência: viram erro (mesmo critério de whatsapp-core).
    function tabelaAusente(err, tabela) {
        if (!err) return false;
        var cod = String(err.code || ''), msg = String(err.message || '');
        if (cod !== 'PGRST205' && cod !== '42P01') return false;
        if (!tabela) return true;
        var m = msg.match(/table '([^']+)'/i) || msg.match(/relation "([^"]+)"/i) || msg.match(/table ([^\s']+)/i);
        return !m || m[1] === tabela || m[1] === 'public.' + tabela;
    }
    function lerConfig(rc, rx, rp, rr, pm, rg, rpl) {
        st.cfgAusente = false; st.cfgErro = null;
        if (rc && rc.error) {
            if (tabelaAusente(rc.error, 'rota_config')) st.cfgAusente = true; else st.cfgErro = String(rc.error.message || rc.error);
            st.cfgLinha = null;
        } else st.cfgLinha = rc && rc.data && rc.data[0] ? rc.data[0] : null;
        // Padrões/exceções: só troca o mapa se a leitura deu certo (erro não vira "ninguém tem padrão").
        var erroPadroes = rx && rx.error && !tabelaAusente(rx.error, 'rota_cliente_veiculo') ? String(rx.error.message || rx.error) : null;
        if (rx && !rx.error) {
            var ex = {};
            (rx.data || []).forEach(function (e) { if (e.veiculo === 'caminhao' || e.veiculo === 's10') ex[e.documento] = e.veiculo; });
            st.excecoes = ex;
            if (st.ultimoV2) st.ultimoV2.excecoes = ex;
        } else if (!erroPadroes || !st.v2 || arguments.length >= 5) st.excecoes = {};   // releitura parcial da v2 com erro: mantém o que tinha
        if (erroPadroes) {
            st.cfgErro = st.cfgErro || erroPadroes;
            if (st.v2 && arguments.length < 5) { st.erroV2 = 'padrões por cliente: ' + erroPadroes; st.desatualizado = !!st.ultimoV2; }
        }
        st.cfg = cfgDe(st.cfgLinha || CFG_PADRAO);
        if (arguments.length >= 5) {
            var falta044 = st.cfgAusente ||
                (rp && rp.error && tabelaAusente(rp.error, 'rota_pedido_veiculo')) ||
                (rr && rr.error && tabelaAusente(rr.error, 'rota_cliente_regras')) ||
                (pm && pm.error && rpcAusente(pm.error));
            st.v2 = !falta044;
            st.porPedido = {};
            st.regras = {};
            st.podeMarcar = false;
            st.ign045 = false; st.ignorados = {};
            st.pln046 = false; st.plano = {};
            st.erroV2 = null; st.desatualizado = false; st.avisoPerm = null;
            if (!st.v2) { st.ultimoV2 = null; return; }   // a 045/046 dependem da 044: sem v2, sem Tirar e sem Semana
            // UI2: erro de leitura que NÃO é 044 ausente (timeout 57014, rede, RLS...) não pode virar "mapa vazio".
            var erros = [];
            if (erroPadroes) erros.push('padrões por cliente: ' + erroPadroes);
            if (rp && !rp.error) (rp.data || []).forEach(function (p) { if (p.veiculo === 'caminhao' || p.veiculo === 's10') st.porPedido[p.cd_pedido] = p.veiculo; });
            else erros.push('escolhas por pedido: ' + String((rp && rp.error && (rp.error.message || rp.error)) || 'sem resposta'));
            if (rr && !rr.error) st.regras = regrasDe(rr.data || []);
            else erros.push('regras de entrega: ' + String((rr && rr.error && (rr.error.message || rr.error)) || 'sem resposta'));
            // 045: tabela ausente (PGRST205/42P01 da própria rota_pedido_ignorado) = sem o recurso; qualquer outro erro = UI2.
            if (rg && !rg.error) {
                st.ign045 = true;
                (rg.data || []).forEach(function (g) { if (g && g.cd_pedido != null) st.ignorados[g.cd_pedido] = { motivo: g.motivo || null, atualizado_em: g.atualizado_em || null }; });
            } else if (rg && rg.error && !tabelaAusente(rg.error, 'rota_pedido_ignorado')) {
                st.ign045 = true;
                erros.push('pedidos fora da rota: ' + String(rg.error.message || rg.error));
            }
            // 046: tabela ausente (PGRST205/42P01 da própria rota_plano_semana) = sugestão sem salvar; qualquer outro erro = UI2.
            if (rpl && !rpl.error) {
                st.pln046 = true;
                (rpl.data || []).forEach(function (l) {
                    if (l && l.cd_pedido != null && /^\d{4}-\d{2}-\d{2}/.test(String(l.dia || ''))) st.plano[l.cd_pedido] = String(l.dia).slice(0, 10);
                });
            } else if (rpl && rpl.error && !tabelaAusente(rpl.error, 'rota_plano_semana')) {
                st.pln046 = true;
                erros.push('plano da semana: ' + String(rpl.error.message || rpl.error));
            }
            if (pm && !pm.error) st.podeMarcar = !!pm.data;
            else st.avisoPerm = 'Não foi possível conferir a permissão de marcar (' + String((pm && pm.error && (pm.error.message || pm.error)) || 'sem resposta') + '): edição desligada até atualizar.';
            if (erros.length) {
                st.erroV2 = erros.join(' · ');
                if (st.ultimoV2) {   // mostra o último retrato completo, marcado como desatualizado, sem edição
                    st.excecoes = st.ultimoV2.excecoes; st.porPedido = st.ultimoV2.porPedido; st.regras = st.ultimoV2.regras;
                    st.ignorados = st.ultimoV2.ignorados || {};
                    st.plano = st.ultimoV2.plano || {};
                    st.desatualizado = true;
                }
                return;
            }
            // Leitura completa: vira o "último retrato" (referências: as gravações confirmadas mexem nos mesmos objetos).
            st.ultimoV2 = { excecoes: st.excecoes, porPedido: st.porPedido, regras: st.regras, ignorados: st.ignorados, plano: st.plano, em: new Date() };
        }
    }
    // "Configurar rota" (rota_config): sempre só admin (RLS eh_admin()).
    function podeConfigurar() { return st.papel === 'admin' && !st.cfgAusente; }
    // Marcação CEASA/S10 e regras de entrega por cliente: na v2 (044) vale pode_marcar_rota(); sem a 044 só admin.
    // Com erro de leitura da v2 (UI2) nada é editável: a marcação seria feita sobre um retrato incompleto/velho.
    function podeEditar() { return st.v2 ? !!st.podeMarcar && !st.erroV2 : podeConfigurar(); }
    // 045: "Tirar da rota" / "Voltar para a rota" — só com a 045 lida e quem pode marcar.
    function podeTirar() { return st.v2 && st.ign045 && podeEditar(); }
    // 046: salvar plano da semana no banco — só com a 046 lida e quem pode marcar.
    function podeSalvarSemana() { return st.v2 && st.pln046 && podeEditar(); }

    var SIT = { vencido: ['Vencido', 'rota-sit-vencido', 'fa-triangle-exclamation'], hoje: ['Vence hoje', 'rota-sit-hoje', 'fa-hourglass-end'],
                amanha: ['Vence na próxima saída', 'rota-sit-amanha', 'fa-hourglass-half'], ok: ['No prazo', 'rota-sit-ok', 'fa-check'], sem_data: ['Sem data', 'rota-sit-ok', 'fa-question'] };
    // soProblema=true (v3): só mostra selo quando há problema (vencido, vence hoje ou sem data); no prazo fica limpo.
    // US-2: listas auxiliares da semana vêm sem x.situacao no core — calcula em relação a diaRef e nunca trata undefined como "No prazo".
    function seloPrazo(x, soProblema, diaRef, veicRef) {
        if (!x) return '';
        var sit = x.situacao || (diaRef && situacaoPrazo ? situacaoPrazo(x.prazo, diaRef, st.cfg, veicRef || x.veiculo) : null);
        if (!sit || !SIT[sit]) return x.prazo && !soProblema ? '<span class="rota-selo">Prazo · ' + esc(dataBr(x.prazo)) + '</span>' : '';
        if (soProblema && (sit === 'ok' || sit === 'amanha')) return '';
        var s = SIT[sit];
        return '<span class="rota-sit ' + s[1] + '"><i class="fa-solid ' + s[2] + '" aria-hidden="true"></i>' + s[0] + (x.prazo ? ' · ' + dataBr(x.prazo) : '') + '</span>';
    }
    // '530 potes avulsos (≈22 cx24)': potes de produto com código próprio, em caixas de 24 equivalentes.
    function txtAvulsos(n) {
        return NUM.format(n) + (n === 1 ? ' pote avulso' : ' potes avulsos') + ' (≈' + NUM.format(Math.round(n / 24)) + ' cx24)';
    }
    // Resumo curto das caixas de uma parada (janelinha do mapa).
    function resumoParada(sp) {
        var c24 = 0, c48 = 0, av = 0, desc = 0;
        sp.pedidos.forEach(function (x) { if (x.v.vol == null) desc++; else { c24 += x.v.c24; c48 += x.v.c48; av += x.v.avulsos; } });
        var p = [];
        if (c24) p.push(NUM.format(c24) + ' cx24');
        if (c48) p.push(NUM.format(c48) + ' cx48');
        if (av) p.push(txtAvulsos(av));
        if (desc) p.push(desc === 1 ? 'volume desconhecido' : NUM.format(desc) + ' pedidos sem volume');
        return p.join(' + ');
    }
    function txtCaixas(v) {
        if (v.vol == null) return '<span class="rota-aviso-txt"><i class="fa-solid fa-circle-question" aria-hidden="true"></i> volume desconhecido</span>';
        var p = [];
        if (v.c24) p.push(NUM.format(v.c24) + ' cx24');
        if (v.c48) p.push(NUM.format(v.c48) + ' cx48');
        if (v.avulsos) p.push(txtAvulsos(v.avulsos));
        return p.join(' + ') || '0 cx';
    }
    function nomeCliente(c, x) {
        if (c && c.nome) return c.nome;
        if (x && x.p && x.p.cliente_nome) return x.p.cliente_nome;
        if (x && x.p && x.p.cliente_tipo === 'cpf') return 'Consumidor final (CPF)';
        if (x && x.p && x.p.cliente_tipo === 'indefinido') return 'Cliente sem documento no ERP';
        return 'Cliente ' + ((x && x.p && x.p.documento) || '');
    }

    // ===================== REGRAS POR CLIENTE (044) — ícone discreto e selos só quando ativos =====================
    function temRegraAtiva(r) {
        if (!r) return false;
        return r.ini != null || r.fim != null || !!r.prioridade || !!r.obs || Object.keys(r.dias || {}).length > 0;
    }
    function txtDiasSemReceber(r) {
        if (!r || !r.dias) return '';
        var ds = [1, 2, 3, 4, 5, 6, 0].filter(function (d) { return r.dias[d]; }).map(function (d) { return DIAS_ROTULO[d]; });
        return ds.length ? 'Não recebe: ' + ds.join(', ') : '';
    }
    // Botão ícone de relógio ao lado do nome do cliente (destacado quando o cliente tem regra cadastrada).
    function botaoRegraCliente(doc, nome) {
        if (!st.v2 || !podeEditar() || !doc || !/^\d{11,14}$/.test(doc)) return '';
        var r = st.regras[doc] || null, ativa = temRegraAtiva(r);
        var rot = (ativa ? 'Editar regras de entrega de ' : 'Definir horário e regras de entrega de ') + nome;
        return ' <button type="button" class="rota-btn-regra rota-btn-regra-ic' + (ativa ? ' is-ativa' : '') + ' no-print" data-rota-regra="' + esc(doc) + '"' +
            ' title="' + esc(rot) + '" aria-label="' + esc(rot) + '"><i class="fa-regular fa-clock" aria-hidden="true"></i></button>';
    }
    // Selos de regra do cliente: só aparecem quando há regra ativa. mostrarPrioridade/mostrarJanela evitam duplicar o que já saiu na coluna Hora.
    function htmlRegrasCliente(doc, _nome, mostrarPrioridade, mostrarJanela) {
        var r = doc ? st.regras[doc] || null : null;
        if (!r) return '';
        var partes = [];
        if (r.prioridade && mostrarPrioridade !== false) partes.push('<span class="rota-selo rota-selo-pri"><i class="fa-solid fa-bolt" aria-hidden="true"></i>Prioridade</span>');
        if (r.janela && mostrarJanela !== false) partes.push('<span class="rota-selo"><i class="fa-regular fa-clock" aria-hidden="true"></i>' + esc(r.janela) + '</span>');
        var td = txtDiasSemReceber(r);
        if (td) partes.push('<span class="rota-selo rota-selo-fechado"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i>' + esc(td) + '</span>');
        if (r.obs) partes.push('<span class="rota-obs" title="Observação de entrega"><i class="fa-regular fa-comment" aria-hidden="true"></i>' + esc(r.obs) + '</span>');
        return partes.length ? '<div class="rota-regras-cli">' + partes.join(' ') + '</div>' : '';
    }

    // ===================== VEÍCULO E MARCAÇÃO (v1: 040 / v2: 044 / v3: simplificado) =====================
    var MOTIVO_CEASA = { endereco: 'endereço com "CEASA"', av_brasil_19001: 'Av. Brasil, 19001', raio: 'a até 600 m do CEASA' };
    function seloMotivo(o) {
        if (o.motivo === 'excecao') return '<span class="rota-motivo rota-motivo-excecao" title="Definido manualmente para este cliente"><i class="fa-solid fa-hand-pointer" aria-hidden="true"></i>Exceção: vai ' + (o.veiculo === 'caminhao' ? 'no caminhão' : 'na S10') + '</span>';
        if (o.motivo === 'ceasa') return '<span class="rota-motivo"><i class="fa-solid fa-warehouse" aria-hidden="true"></i>CEASA (' + esc(MOTIVO_CEASA[o.detalhe] || o.detalhe) + ')</span>';
        return '<span class="rota-motivo rota-motivo-padrao"><i class="fa-solid fa-truck-pickup" aria-hidden="true"></i>S10 (padrão)</span>';
    }
    // v1 (sem 044): Menu do admin: Automático / Caminhão / S10 (grava a exceção em rota_cliente_veiculo).
    function menuVeiculo(doc, nome) {
        if (!podeEditar() || !doc) return '';
        var atual = st.excecoes[doc] || '';
        return '<label class="rota-veic no-print"><span class="sr-only">Veículo de ' + esc(nome) + '</span>' +
            '<select class="adm-input" data-rota-veiculo="' + esc(doc) + '" aria-label="Veículo de ' + esc(nome) + '"' + (st.gravandoVeiculo[doc] ? ' disabled aria-busy="true"' : '') + '>' +
            '<option value=""' + (atual ? '' : ' selected') + '>Automático</option>' +
            '<option value="caminhao"' + (atual === 'caminhao' ? ' selected' : '') + '>Vai no caminhão</option>' +
            '<option value="s10"' + (atual === 's10' ? ' selected' : '') + '>Vai na S10</option></select></label>';
    }

    // v2 (044): chave de trava por cliente (ou por pedido quando não há documento).
    function chaveTrava(p) { return p && p.documento ? p.documento : 'p:' + (p ? p.cd_pedido : ''); }
    function txtSugestao(sug) {
        if (!sug) return 'S10';
        if (sug.motivo === 'ceasa') return 'CEASA (' + (MOTIVO_CEASA[sug.detalhe] || sug.detalhe) + ')';
        return 'S10';
    }
    function seloMarcacaoLeitura(x) {
        if (!x.veiculo) return '<span class="rota-sit rota-sit-hoje"><i class="fa-solid fa-hand-pointer" aria-hidden="true"></i>Falta marcar</span>';
        var ehCeasa = x.veiculo === 'caminhao';
        var ic = ehCeasa ? 'fa-warehouse' : 'fa-truck-pickup';
        return '<span class="rota-motivo' + (x.marcacao === 'pedido' ? ' rota-motivo-excecao' : '') + '">' +
            '<i class="fa-solid ' + ic + '" aria-hidden="true"></i>' + (ehCeasa ? 'CEASA' : 'S10') + (x.marcacao === 'pedido' ? ' · só neste pedido' : '') + '</span>';
    }
    // Seletor CEASA / S10 por pedido + botão Tirar na mesma linha (sem repetir pílula "S10 · padrão do cliente" acima do select).
    function seletorPedidoV2(x, nome, mostrarId) {
        var tagId = mostrarId ? '<span class="rota-ped-tag">#' + esc(x.p.cd_pedido) + '</span>' : '';
        if (!podeEditar()) return '<div class="rota-marc-item">' + tagId + seloMarcacaoLeitura(x) + '</div>';
        var cd = x.p.cd_pedido, ch = chaveTrava(x.p), travado = !!st.gravandoVeiculo[ch];
        var atual = x.veiculo || '';
        var rotulo = 'Veículo do pedido ' + cd + ' de ' + nome;
        var soHoje = atual && x.marcacao === 'pedido' ? '<span class="rota-tag-sohoje" title="Escolha só neste pedido (diferente do padrão do cliente)">só neste</span>' : '';
        var sel = '<label class="rota-veic no-print">' +
            '<span class="sr-only">' + esc(rotulo) + '</span>' +
            '<select class="adm-input" data-rota-marcar="' + esc(cd) + '" data-rota-marcar-chave="' + esc(ch) + '" aria-label="' + esc(rotulo) + '"' + (travado ? ' disabled aria-busy="true"' : '') + '>' +
            (!atual ? '<option value="" selected>Marcar…</option>' : '') +
            '<option value="caminhao"' + (atual === 'caminhao' ? ' selected' : '') + '>CEASA</option>' +
            '<option value="s10"' + (atual === 's10' ? ' selected' : '') + '>S10</option>' +
            (atual ? '<option value="">Desmarcar</option>' : '') +
            '</select></label>';
        var imp = atual ? '<span class="rota-imp-veic">' + (atual === 'caminhao' ? 'CEASA' : 'S10') + '</span>' : '';
        return '<div class="rota-marc-item"><div class="rota-marc-linha">' + tagId + sel + botaoTirar(x, nome) + soHoje + imp + '</div></div>';
    }
    // 045: botão "Tirar da rota" do pedido (trava junto com o seletor do mesmo cliente: data-rota-marcar-chave).
    function botaoTirar(x, nome) {
        if (!podeTirar()) return '';
        var cd = x.p.cd_pedido, ch = chaveTrava(x.p), travado = !!st.gravandoVeiculo[ch];
        var rot = 'Tirar da rota o pedido ' + cd + ' de ' + nome;
        return '<button type="button" class="rota-btn-regra rota-btn-tirar no-print" data-rota-tirar="' + esc(cd) + '" data-rota-marcar-chave="' + esc(ch) + '"' +
            ' title="Tirar da rota" aria-label="' + esc(rot) + '"' + (travado ? ' disabled aria-busy="true"' : '') + '>' +
            '<i class="fa-solid fa-ban" aria-hidden="true"></i><span>Tirar</span></button>';
    }
    function celulaVeiculoParada(sp, nome) {
        if (!st.v2) return seloMotivo(sp) + menuVeiculo(sp.documento, nome);
        var mult = sp.pedidos.length > 1;
        return sp.pedidos.map(function (x) { return seletorPedidoV2(x, nome, mult); }).join('');
    }

    // Coluna de horário por parada (v2): hora prevista (~eta) e selos apenas quando há prioridade, atraso ou espera.
    function celulaHorarioParada(sp) {
        var partes = [];
        if (sp.eta) partes.push('<span class="rota-eta"><strong>~' + esc(sp.eta) + '</strong></span>');
        else partes.push('<span class="rota-sub">—</span>');
        if (sp.prioridade) partes.push('<span class="rota-selo rota-selo-pri"><i class="fa-solid fa-bolt" aria-hidden="true"></i>Prioridade</span>');
        if (sp.atraso > 0) partes.push('<span class="rota-sit rota-sit-vencido"><i class="fa-solid fa-clock" aria-hidden="true"></i>fora do horário (+' + NUM.format(sp.atraso) + ' min)</span>');
        if (sp.espera > 0) partes.push('<span class="rota-selo rota-selo-espera"><i class="fa-solid fa-hourglass-start" aria-hidden="true"></i>espera +' + NUM.format(sp.espera) + ' min</span>');
        if (sp.janela) partes.push('<div class="rota-sub">' + esc(sp.janela) + '</div>');
        return '<div class="rota-col-horario">' + partes.join(' ') + '</div>';
    }

    // 046: selo informativo "planejado p/ qua 25/11" na rota do dia (só referência).
    function seloPlanoDia(x) {
        if (!st.v2 || !x || !x.planoDia) return '';
        var rot = (DIAS_ROTULO[diaSemana(x.planoDia)] || nomeDia(x.planoDia)) + ' ' + dataBr(x.planoDia);
        return '<span class="rota-selo rota-selo-plano" title="Referência do plano da semana"><i class="fa-regular fa-calendar" aria-hidden="true"></i>planejado p/ ' + esc(rot) + '</span>';
    }
    function selosPlanoParada(sp) {
        if (!st.v2 || !sp || !sp.pedidos) return '';
        var vistos = {}, out = [];
        sp.pedidos.forEach(function (x) {
            if (!x.planoDia || vistos[x.planoDia]) return;
            vistos[x.planoDia] = true;
            out.push(seloPlanoDia(x));
        });
        return out.join(' ');
    }

    function htmlParada(sp, n) {
        var cx = sp.pedidos.map(function (x) { return txtCaixas(x.v); }).join('<br>');
        var val = sp.pedidos.reduce(function (a, x) { return a + (Number(x.p.valor_centavos) || 0); }, 0);
        var pior = sp.pedidos.slice().sort(function (a, b) { return String(a.prazo || '9') < String(b.prazo || '9') ? -1 : 1; })[0];
        var nome = sp.nome || nomeCliente(null, sp.pedidos[0]);
        var atrasada = st.v2 && sp.atraso > 0;
        if (!st.v2) {
            return '<tr><td class="rota-n">' + (n == null ? '—' : n) + '</td>' +
                '<td><strong>' + esc(nome) + '</strong>' +
                '<div class="rota-sub">' + esc([sp.bairro, sp.cidade].filter(Boolean).join(' · ') || 'sem bairro') +
                ' · pedido' + (sp.pedidos.length > 1 ? 's ' : ' ') + sp.pedidos.map(function (x) { return esc(x.p.cd_pedido); }).join(', ') +
                (sp.precisao === 'bairro' ? ' · <span class="rota-aviso-txt">posição aproximada (bairro)</span>' : '') + '</div></td>' +
                '<td data-rotulo="Caixas">' + cx + '</td><td class="num" data-rotulo="Valor">' + esc(brl(val)) + '</td><td data-rotulo="Prazo">' + seloPrazo(pior, false) + '</td>' +
                '<td data-rotulo="Veículo">' + celulaVeiculoParada(sp, nome) + '</td></tr>';
        }
        var prazoRuim = seloPrazo(pior, true);
        var plDia = selosPlanoParada(sp);
        return '<tr' + (atrasada ? ' class="rota-linha-ruim"' : '') + '><td class="rota-n">' + (n == null ? '—' : n) + '</td>' +
            '<td data-rotulo="Hora">' + celulaHorarioParada(sp) + '</td>' +
            '<td><div class="rota-cli-linha"><strong>' + esc(nome) + '</strong>' + botaoRegraCliente(sp.documento, nome) + '</div>' +
            '<div class="rota-sub">' + esc([sp.bairro, sp.cidade].filter(Boolean).join(' · ') || 'sem bairro') +
            ' · #' + sp.pedidos.map(function (x) { return esc(x.p.cd_pedido); }).join(', #') +
            (sp.precisao === 'bairro' ? ' · <span class="rota-aviso-txt">pos. aprox.</span>' : '') +
            (prazoRuim ? ' ' + prazoRuim : '') + (plDia ? ' ' + plDia : '') + '</div>' +
            htmlRegrasCliente(sp.documento, nome, false, false) + '</td>' +
            '<td data-rotulo="Caixas">' + cx + '</td>' +
            '<td data-rotulo="Veículo">' + celulaVeiculoParada(sp, nome) + '</td></tr>';
    }
    function tabelaParadas(g, vazio, paradasCustom) {
        var listaParadas = paradasCustom || g.paradas;
        var n = listaParadas.length + g.semPosicao.length;
        if (!n) return '<p class="adm-vazio-linha"><span class="adm-vazio-titulo">' + esc(vazio) + '</span></p>';
        if (!st.v2) {
            return '<div class="overflow-x-auto"><table class="adm-tabela rota-tabela"><thead><tr><th>#</th>' +
                '<th>Cliente</th><th>Caixas</th><th class="num">Valor</th><th>Prazo</th><th>Veículo</th></tr></thead><tbody>' +
                listaParadas.map(function (sp, i) { return htmlParada(sp, i + 1); }).join('') +
                (g.semPosicao.length ? '<tr class="rota-sep"><td colspan="6">Sem posição no mapa — entregar conforme o bairro</td></tr>' + g.semPosicao.map(function (sp) { return htmlParada(sp, null); }).join('') : '') +
                '</tbody></table></div>';
        }
        return '<div class="overflow-x-auto"><table class="adm-tabela rota-tabela"><thead><tr><th>#</th>' +
            '<th>Hora</th><th>Cliente</th><th>Caixas</th><th>Veículo</th></tr></thead><tbody>' +
            listaParadas.map(function (sp, i) { return htmlParada(sp, i + 1); }).join('') +
            (g.semPosicao.length ? '<tr class="rota-sep"><td colspan="5">Sem posição no mapa — entregar conforme o bairro</td></tr>' + g.semPosicao.map(function (sp) { return htmlParada(sp, null); }).join('') : '') +
            '</tbody></table></div>';
    }
    function botoesGmapsItens(paradas) {
        var links = paradas.length ? linksGoogleMaps(paradas, loteGmaps()) : [];
        return links.map(function (l) {
            return '<button type="button" class="adm-botao-fantasma" data-rota-gmaps="' + esc(l.url) + '" title="Só as coordenadas vão para o Google (sem nome ou endereço)"><i class="fa-solid fa-diamond-turn-right" aria-hidden="true"></i> Google Maps' +
                (links.length > 1 ? (l.de === l.ate ? ' (' + l.de + ')' : ' (' + l.de + '–' + l.ate + ')') : '') + '</button>';
        }).join('');
    }
    function botoesGmaps(paradas) {
        var btns = botoesGmapsItens(paradas);
        return btns ? '<div class="rota-gmaps no-print">' + btns + '</div>' : '';
    }

    // ===================== TOPO: FALTA MARCAR (v2/v3: pedidos sem CEASA/S10) =====================
    function htmlAguardando(pl) {
        if (!st.v2 || !pl.aguardando.length) return '';
        var n = pl.aguardando.length;
        return '<section class="adm-card p-4 mb-5 rota-cartao rota-cartao-aguardando" id="rota-aguardando" aria-labelledby="rota-ag-tit">' +
            '<div class="rota-cab rota-cab-compacto"><p class="rota-tit" id="rota-ag-tit"><i class="fa-solid fa-hand-pointer" aria-hidden="true"></i> Falta marcar (' + NUM.format(n) + ')</p>' +
            '<span class="rota-sub">Escolha <strong>CEASA</strong> ou <strong>S10</strong> para entrar na rota</span></div>' +
            '<div class="overflow-x-auto"><table class="adm-tabela rota-tabela"><thead><tr><th>Cliente</th><th>Caixas</th><th>Dica</th><th>Ação</th></tr></thead><tbody>' +
            pl.aguardando.map(function (x) {
                var nome = nomeCliente(x.c, x);
                var local = x.c ? [x.c.bairro, x.c.cidade].filter(Boolean).join(' · ') : '';
                var prazoRuim = seloPrazo(x, true, pl.dia);
                return '<tr><td><div class="rota-cli-linha"><strong>' + esc(nome) + '</strong>' + botaoRegraCliente(x.p.documento, nome) + '</div>' +
                    '<div class="rota-sub">' + esc(local || 'sem bairro') + ' · #' + esc(x.p.cd_pedido) + (prazoRuim ? ' ' + prazoRuim : '') + '</div>' +
                    htmlRegrasCliente(x.p.documento, nome, true, true) + '</td>' +
                    '<td data-rotulo="Caixas">' + txtCaixas(x.v) + '</td>' +
                    '<td data-rotulo="Dica"><span class="rota-dica-sug"><i class="fa-regular fa-lightbulb" aria-hidden="true"></i>' + esc(txtSugestao(x.sugestao)) + '</span></td>' +
                    '<td data-rotulo="Ação">' + seletorPedidoV2(x, nome, false) + '</td></tr>';
            }).join('') + '</tbody></table></div></section>';
    }

    function htmlS10(pl) {
        var s = pl.s10, pct = Math.min(100, Math.round(s.volume / ROTA.CAPACIDADE_S10 * 100)), cheio = s.volume > ROTA.CAPACIDADE_S10 * 0.95;
        var capCx = Math.round(ROTA.CAPACIDADE_S10 / ROTA.VOLUME_CX24);
        var usadoCx = Math.round(s.volume / ROTA.VOLUME_CX24);
        var restaCx = Math.max(0, Math.floor((ROTA.CAPACIDADE_S10 - s.volume) / ROTA.VOLUME_CX24));
        var nParadas = s.paradas.length + s.semPosicao.length;
        var avisos = [];
        if (s.desconhecidos) avisos.push(NUM.format(s.desconhecidos) + (s.desconhecidos === 1 ? ' pedido sem volume (fora da conta)' : ' pedidos sem volume (fora da conta)'));
        if (s.semPosicao.length) avisos.push(NUM.format(s.semPosicao.length) + (s.semPosicao.length === 1 ? ' parada sem posição no mapa (no fim)' : ' paradas sem posição no mapa (no fim)'));
        if (st.v2 && s.horario && s.horario.atrasos) avisos.push(NUM.format(s.horario.atrasos) + (s.horario.atrasos === 1 ? ' parada fora do horário' : ' paradas fora do horário') + ' (+' + NUM.format(s.horario.atrasoTotal) + ' min)');
        var kpiHorario = st.v2 && s.horario ? '<span><i class="fa-regular fa-clock" aria-hidden="true"></i> <strong>' + esc(s.horario.saida) + '</strong>' + (s.paradas.length && s.horario.fim ? ' → <strong>~' + esc(s.horario.fim) + '</strong>' : '') + '</span>' : '';
        var btnMapa = s.paradas.length
            ? '<button type="button" class="adm-botao-fantasma" id="rota-toggle-mapa" aria-expanded="' + (st.mapaAberto ? 'true' : 'false') + '"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i> ' + (st.mapaAberto ? 'Ocultar mapa' : 'Ver mapa (' + NUM.format(s.paradas.length) + ')') + '</button>'
            : '';
        var barraGmaps = botoesGmapsItens(s.paradas) + btnMapa;
        var detCx = [];
        if (s.c24) detCx.push(NUM.format(s.c24) + ' cx24');
        if (s.c48) detCx.push(NUM.format(s.c48) + ' cx48');
        if (s.avulsos) detCx.push(txtAvulsos(s.avulsos));
        return '<section class="adm-card p-4 mb-5 rota-cartao" aria-labelledby="rota-s10-tit">' +
            '<div class="rota-cab rota-cab-compacto"><p class="rota-tit" id="rota-s10-tit"><i class="fa-solid fa-truck-pickup" aria-hidden="true"></i> S10</p>' +
            '<div class="rota-kpis"><span><strong>' + NUM.format(nParadas) + '</strong> parada' + (nParadas === 1 ? '' : 's') + '</span>' +
            kpiHorario +
            '<span title="Linha reta × ' + NUM1.format(ROTA.FATOR_ESTRADA) + (s.volta ? '; inclui a volta para a sede' : '; não inclui a volta para a sede') + '"><strong>~' + NUM.format(Math.round(s.km)) + ' km</strong>' +
                (s.volta ? ' (c/ volta)' : '') + '</span></div></div>' +
            '<div class="rota-ocup" role="img" aria-label="Ocupação da S10: ' + NUM.format(usadoCx) + ' de ' + NUM.format(capCx) + ' cx24 (' + pct + '%)">' +
                '<div class="rota-ocup-barra' + (cheio ? ' is-cheia' : '') + '" style="width:' + pct + '%"></div></div>' +
            '<p class="rota-sub mt-1"><strong>' + NUM.format(usadoCx) + ' / ' + NUM.format(capCx) + ' cx24</strong> (' + pct + '%) · cabe ~' + NUM.format(restaCx) + ' cx24' +
                (detCx.length ? ' · ' + detCx.join(' + ') : '') + '</p>' +
            (avisos.length ? '<ul class="rota-avisos">' + avisos.map(function (a) { return '<li><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> ' + esc(a) + '</li>'; }).join('') + '</ul>' : '') +
            (barraGmaps ? '<div class="rota-gmaps mt-2 no-print">' + barraGmaps + '</div>' : '') +
            (st.mapaAberto && s.paradas.length ? '<div id="rota-mapa" class="adm-mapa-escuro rota-mapa" role="img" aria-label="Mapa da rota da S10 com ' + NUM.format(s.paradas.length) + ' paradas numeradas"></div>' : '') +
            tabelaParadas(s, s.semSaida ? 'A S10 não sai sábado' : 'Nada para a S10 neste dia') + '</section>';
    }

    function seloMotivoFica(x) {
        if (x.motivoFica === 'sem_saida_s10') {
            return '<span class="rota-selo rota-selo-fechado"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i>a S10 não sai sábado' +
                (x.proxima ? ' · próxima: ' + esc(nomeDia(x.proxima) + ' ' + dataBr(x.proxima)) : '') + '</span>';
        }
        if (x.motivoFica === 'dia_fechado') {
            return '<span class="rota-selo rota-selo-fechado"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i>não recebe neste dia' +
                (x.proxima ? ' · próxima: ' + esc(nomeDia(x.proxima) + ' ' + dataBr(x.proxima)) : ' · sem próxima data') + '</span>';
        }
        if (x.motivoFica === 'sem_volume') {
            return '<span class="rota-selo"><i class="fa-solid fa-circle-question" aria-hidden="true"></i>sem volume (no prazo)</span>';
        }
        return '<span class="rota-selo"><i class="fa-solid fa-box" aria-hidden="true"></i>capacidade da S10</span>';
    }
    function htmlFica(pl) {
        if (!pl.fica.length) return '';
        var estouram = pl.fica.filter(function (x) { return x.estoura; }).length;
        var proxPadrao = proximaSaida(pl.dia, false, pl.cfg, 's10');
        var datasDif = pl.fica.some(function (x) { return x.proxima !== proxPadrao; });
        var titProx = datasDif ? 'próxima data elegível'
            : proxPadrao ? esc(nomeDia(proxPadrao)) + ' ' + esc(dataBr(proxPadrao)) : 'sem saída nos próximos ' + NUM.format(ROTA.BUSCA_SAIDA_DIAS) + ' dias';
        return '<section class="adm-card p-4 mb-5 rota-cartao' + (estouram ? ' rota-cartao-alerta' : '') + '" aria-labelledby="rota-fica-tit">' +
            '<div class="rota-cab rota-cab-compacto"><p class="rota-tit" id="rota-fica-tit"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> Fica p/ próxima saída (' + NUM.format(pl.fica.length) + ' · ' + titProx + ')</p>' +
            (estouram ? '<span class="rota-sit rota-sit-vencido"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' + NUM.format(estouram) + (estouram === 1 ? ' passa do prazo' : ' passam do prazo') + '</span>' : '') + '</div>' +
            '<div class="overflow-x-auto"><table class="adm-tabela rota-tabela"><thead><tr><th>Cliente</th><th>Caixas</th><th>Veículo</th></tr></thead><tbody>' +
            pl.fica.map(function (x) {
                var nome = nomeCliente(x.c, x);
                var prazoRuim = seloPrazo(x, true);
                var plDia = seloPlanoDia(x);
                return '<tr' + (x.estoura ? ' class="rota-linha-ruim"' : '') + '><td><div class="rota-cli-linha"><strong>' + esc(nome) + '</strong>' + botaoRegraCliente(x.p.documento, nome) + '</div>' +
                    '<div class="rota-sub">' + esc((x.c && x.c.bairro) || 'sem bairro') +
                    ' · #' + esc(x.p.cd_pedido) + ' · ' + seloMotivoFica(x) +
                    (x.motivoFica !== 'dia_fechado' && x.motivoFica !== 'sem_saida_s10' && x.proxima !== proxPadrao ? ' · sai ' + (x.proxima ? esc(nomeDia(x.proxima) + ' ' + dataBr(x.proxima)) : 'sem data') : '') +
                    (prazoRuim ? ' ' + prazoRuim : '') + (plDia ? ' ' + plDia : '') +
                    (x.estoura ? ' · <strong class="rota-txt-ruim">passa do prazo</strong>' : '') + '</div>' +
                    (st.v2 ? htmlRegrasCliente(x.p.documento, nome, true, true) : '') + '</td><td data-rotulo="Caixas">' + txtCaixas(x.v) + '</td>' +
                    '<td data-rotulo="Veículo">' + (st.v2 ? seletorPedidoV2(x, nome, false) : seloMotivo(x) + menuVeiculo(x.p.documento, nome)) + '</td></tr>';
            }).join('') + '</tbody></table></div></section>';
    }

    // ===================== FORA DA ROTA (045: tirados até reativar) =====================
    function htmlForaDaRota(pl) {
        if (!st.v2 || !st.ign045 || !pl.ignorados.length) return '';
        var n = pl.ignorados.length, edita = podeTirar();
        return '<details class="adm-card p-4 mb-4 rota-cartao rota-fora" id="rota-fora"' + (st.foraAberto ? ' open' : '') + '>' +
            '<summary id="rota-fora-sum" class="rota-tit"><i class="fa-solid fa-ban" aria-hidden="true"></i> Fora da rota (' + NUM.format(n) + ')</summary>' +
            '<p class="rota-sub mb-2">Pedidos tirados da rota até alguém clicar em "Voltar para a rota".</p>' +
            '<div class="overflow-x-auto"><table class="adm-tabela rota-tabela"><thead><tr><th>Cliente</th><th>Caixas</th><th>Tirado</th>' + (edita ? '<th><span class="sr-only">Ação</span></th>' : '') + '</tr></thead><tbody>' +
            pl.ignorados.map(function (x) {
                var nome = nomeCliente(x.c, x), ig = x.ignorado || {}, ch = chaveTrava(x.p), travado = !!st.gravandoVeiculo[ch];
                var quando = ig.atualizado_em ? new Date(ig.atualizado_em) : null;
                var prazoRuim = seloPrazo(x, true);
                return '<tr><td><strong>' + esc(nome) + '</strong><div class="rota-sub">' + esc((x.c && x.c.bairro) || 'sem bairro') + ' · #' + esc(x.p.cd_pedido) +
                        (x.p.dt_pedido ? ' de ' + esc(dataBr(diaSP(x.p.dt_pedido))) : '') + (prazoRuim ? ' ' + prazoRuim : '') + '</div></td>' +
                    '<td data-rotulo="Caixas">' + txtCaixas(x.v) + '</td>' +
                    '<td data-rotulo="Tirado">' + (quando && !isNaN(quando.getTime()) ? esc(quando.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: ROTA.TZ })) : '—') +
                        (ig.motivo ? '<div class="rota-sub">' + esc(ig.motivo) + '</div>' : '') + '</td>' +
                    (edita ? '<td><button type="button" class="adm-botao-fantasma no-print" data-rota-voltar="' + esc(x.p.cd_pedido) + '" data-rota-marcar-chave="' + esc(ch) + '"' +
                        ' aria-label="' + esc('Voltar para a rota o pedido ' + x.p.cd_pedido + ' de ' + nome) + '"' + (travado ? ' disabled aria-busy="true"' : '') + '>' +
                        '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Voltar para a rota</button></td>' : '') + '</tr>';
            }).join('') + '</tbody></table></div></details>';
    }

    // ===================== CEASA (CD) — card único, carga agregada por cliente =====================
    function txtCaixasCargaItem(it) {
        var p = [];
        if (it.c24) p.push(NUM.format(it.c24) + ' cx24');
        if (it.c48) p.push(NUM.format(it.c48) + ' cx48');
        if (it.avulsos) p.push(txtAvulsos(it.avulsos));
        if (it.desconhecidos) p.push('<span class="rota-aviso-txt"><i class="fa-solid fa-circle-question" aria-hidden="true"></i> ' + (it.desconhecidos === 1 ? 'volume desconhecido' : NUM.format(it.desconhecidos) + ' sem volume') + '</span>');
        if (!p.length) return '0 cx';
        return it.caixas ? '<strong>' + NUM.format(it.caixas) + ' cx</strong> <span class="rota-sub">(' + p.join(' + ') + ')</span>' : p.join(' + ');
    }
    function htmlCaminhao(pl) {
        var c = pl.caminhao, n = c.paradas.length + c.semPosicao.length;
        if (!st.v2) {
            return '<section class="adm-card p-4 mb-5 rota-cartao" aria-labelledby="rota-cam-tit">' +
                '<div class="rota-cab rota-cab-compacto"><p class="rota-tit" id="rota-cam-tit"><i class="fa-solid fa-truck" aria-hidden="true"></i> Caminhão do CEASA</p>' +
                '<div class="rota-kpis"><span><strong>' + NUM.format(n) + '</strong> parada' + (n === 1 ? '' : 's') + '</span><span><strong>' +
                    NUM.format(c.pedidos.length) + '</strong> pedido' + (c.pedidos.length === 1 ? '' : 's') + '</span><span>' + NUM.format(c.c24) + ' cx24 · ' + NUM.format(c.c48) + ' cx48' +
                    (c.avulsos ? ' · ' + txtAvulsos(c.avulsos) : '') + (c.desconhecidos ? ' · ' + NUM.format(c.desconhecidos) + ' sem caixas' : '') + '</span>' +
                    (c.paradas.length ? '<span><strong>~' + NUM.format(Math.round(c.km)) + ' km</strong></span>' : '') + '</div></div>' +
                botoesGmaps(c.paradas) + tabelaParadas(c, 'Nenhum pedido para o caminhão neste dia') + '</section>';
        }
        var cd = c.cd;
        if (!c.pedidos.length || !cd) {
            return '<section class="adm-card p-4 mb-5 rota-cartao" id="rota-cd-ceasa" aria-labelledby="rota-cam-tit">' +
                '<div class="rota-cab rota-cab-compacto"><p class="rota-tit" id="rota-cam-tit"><i class="fa-solid fa-warehouse" aria-hidden="true"></i> CEASA (CD)</p>' +
                '<div class="rota-kpis"><span>0 pedidos</span></div></div>' +
                '<p class="adm-vazio-linha"><span class="adm-vazio-titulo">Nenhum pedido para o CEASA neste dia</span></p></section>';
        }
        var porChave = {};
        (cd.pedidos || []).forEach(function (x) {
            var ch = x.p.documento ? 'd:' + x.p.documento : 'p:' + x.p.cd_pedido;
            (porChave[ch] || (porChave[ch] = [])).push(x);
        });
        var tot = cd.total;
        var partesTot = [];
        if (tot.c24) partesTot.push(NUM.format(tot.c24) + ' cx24');
        if (tot.c48) partesTot.push(NUM.format(tot.c48) + ' cx48');
        if (tot.avulsos) partesTot.push(txtAvulsos(tot.avulsos));
        if (tot.desconhecidos) partesTot.push(NUM.format(tot.desconhecidos) + ' sem volume');
        var resumoTotCx = (tot.caixas ? NUM.format(tot.caixas) + ' cx' + (partesTot.length ? ' (' + partesTot.join(' + ') + ')' : '') : partesTot.join(' + ')) || '0 cx';
        return '<section class="adm-card p-4 mb-5 rota-cartao" id="rota-cd-ceasa" aria-labelledby="rota-cam-tit">' +
            '<div class="rota-cab rota-cab-compacto"><p class="rota-tit" id="rota-cam-tit"><i class="fa-solid fa-warehouse" aria-hidden="true"></i> CEASA (CD)</p>' +
            '<div class="rota-kpis"><span><strong>' + NUM.format(tot.clientes) + '</strong> ' + (tot.clientes === 1 ? 'cliente' : 'clientes') + ' · <strong>' + NUM.format(tot.pedidos) + '</strong> ' + (tot.pedidos === 1 ? 'pedido' : 'pedidos') + '</span>' +
            '<span><strong>' + esc(brl(tot.valorCentavos)) + '</strong></span>' +
            (cd.eta ? '<span>chegada <strong>~' + esc(cd.eta) + '</strong></span>' : '') + '</div></div>' +
            '<p class="rota-sub mb-2">Carga total: <strong>' + esc(resumoTotCx) + '</strong> · Av. Brasil, 19001</p>' +
            botoesGmaps(c.paradas) +
            '<div class="overflow-x-auto"><table class="adm-tabela rota-tabela"><thead><tr><th>Cliente</th><th>Caixas</th><th class="num">Total</th><th>Veículo</th></tr></thead><tbody>' +
            cd.carga.map(function (it) {
                var xs = porChave[it.chave] || [];
                var pior = xs.slice().sort(function (a, b) { return String(a.prazo || '9') < String(b.prazo || '9') ? -1 : 1; })[0];
                var nome = it.nome || (xs[0] ? nomeCliente(xs[0].c, xs[0]) : 'Cliente');
                var mult = xs.length > 1;
                var prazoRuim = pior ? seloPrazo(pior, true) : '';
                return '<tr><td><div class="rota-cli-linha"><strong>' + esc(nome) + '</strong>' + botaoRegraCliente(it.documento, nome) + '</div>' +
                    '<div class="rota-sub">#' + it.pedidos.map(esc).join(', #') + (prazoRuim ? ' ' + prazoRuim : '') + '</div>' +
                    htmlRegrasCliente(it.documento, nome, true, true) + '</td>' +
                    '<td data-rotulo="Caixas">' + txtCaixasCargaItem(it) + '</td>' +
                    '<td class="num" data-rotulo="Total">' + esc(brl(it.valorCentavos)) + '</td>' +
                    '<td data-rotulo="Veículo">' + xs.map(function (x) { return seletorPedidoV2(x, nome, mult); }).join('') + '</td></tr>';
            }).join('') +
            '</tbody><tfoot><tr class="rota-cd-total"><td><strong>Total no CD (' + NUM.format(tot.clientes) + ')</strong></td>' +
            '<td data-rotulo="Caixas"><strong>' + esc(resumoTotCx) + '</strong></td>' +
            '<td class="num" data-rotulo="Total"><strong>' + esc(brl(tot.valorCentavos)) + '</strong></td><td></td></tr></tfoot></table></div></section>';
    }

    // ---------- configuração e ajuda recolhidas no rodapé (acessíveis pelo botão "?" do topo) ----------
    function htmlConfigItens(pl) {
        var cfg = pl.cfg, extras = Object.keys(cfg.feriadosExtras).sort();
        var nRegras = Object.keys(st.regras).filter(function (d) { return temRegraAtiva(st.regras[d]); }).length;
        return [
            'Saídas: S10 de segunda a sexta · caminhão (CEASA) de segunda a sábado',
            'Caminhão: ' + (st.v2 ? 'só o Centro de distribuição CEASA (sem paradas em bairros no caminho)' : 'só o CEASA'),
            st.v2 ? 'Horário estimado: saída às ' + esc(hhmm(cfg.horaSaida) || '07:00') + ' · velocidade média ' + NUM1.format(cfg.velocidadeKmh) + ' km/h · ' + NUM.format(cfg.minutosParada) + ' min por parada' : null,
            'Feriados: ' + (cfg.feriadosSemSaida ? 'sem saída (nacionais, Carnaval, Sexta-feira Santa, Corpus Christi' + (extras.length ? ' e ' + esc(extras.map(dataBr).join(', ')) : '') + ')' : 'têm saída normal'),
            'Corte do pedido: ' + (cfg.corteHora == null ? 'sem corte' : 'a partir das ' + cfg.corteHora + 'h o prazo conta do dia seguinte'),
            'Volta da S10: ' + (cfg.voltaSede ? 'o km e o horário incluem a volta para a sede' : 'o km e o horário não incluem a volta'),
            st.v2
                ? 'Clientes com padrão CEASA/S10: ' + NUM.format(Object.keys(st.excecoes).length) + ' · escolhas só neste pedido: ' + NUM.format(Object.keys(st.porPedido).length) + ' · clientes com regras de entrega: ' + NUM.format(nRegras)
                : 'Exceções por cliente: ' + NUM.format(Object.keys(st.excecoes).length),
            st.v2 && st.ign045 ? 'Pedidos fora da rota: ' + NUM.format(Object.keys(st.ignorados).length) : null,
            st.v2 && st.pln046 ? 'Pedidos com dia fixado na semana (046): ' + NUM.format(Object.keys(st.plano).length) : null
        ].filter(function (t) { return t != null; });
    }
    function htmlConfigResumo(pl) {
        var itens = htmlConfigItens(pl);
        var aviso = st.cfgAusente ? '<p class="rota-sub mt-2"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Configuração ainda não instalada (migração 040): valem os padrões acima.</p>'
            : st.cfgErro ? '<p class="rota-sub mt-2 rota-txt-ruim">Não foi possível ler a configuração (' + esc(st.cfgErro) + '): valem os padrões.</p>' : '';
        return '<details class="rota-config-resumo rota-regras adm-card p-4 mt-2 no-print" id="rota-ajuda"' + (st.cfgAberto ? ' open' : '') + '>' +
            '<summary id="rota-ajuda-sum"><i class="fa-regular fa-circle-question" aria-hidden="true"></i> Regras da rota e como funciona</summary>' +
            '<ul>' + itens.map(function (t) { return '<li>' + t + '</li>'; }).join('') +
            '<li>Candidatos: pedidos do ERP nas etapas aberto, na carga, separando, separado ou conferido.</li>' +
            (st.v2 ? htmlAjudaV2() : htmlAjudaV1()) +
            '<li>Prazo: data do pedido + ' + ROTA.PRAZO_DIAS_UTEIS + ' dias úteis (S10 sai de segunda a sexta; caminhão do CEASA de segunda a sábado; feriado conforme as regras acima; pedido depois do corte conta do dia seguinte).</li>' +
            '</ul>' + aviso + '</details>';
    }
    function htmlDialogo() {
        var cfg = st.cfg, extras = Object.keys(cfg.feriadosExtras).sort();
        var horas = '<option value=""' + (cfg.corteHora == null ? ' selected' : '') + '>Sem corte</option>';
        for (var h = 0; h < 24; h++) horas += '<option value="' + h + '"' + (cfg.corteHora === h ? ' selected' : '') + '>A partir das ' + String(h).padStart(2, '0') + 'h</option>';
        var hoje = hojeSP(), prox = [];
        for (var i = 0, d = hoje; i < 120 && prox.length < 6; i++, d = somaDias(d, 1)) { if (feriadosDoAno(Number(d.slice(0, 4)))[d] && ROTA.DIAS_SEM_SAIDA.indexOf(diaSemana(d)) < 0) prox.push(d); }
        return '<dialog class="rota-dialogo" id="rota-dialogo" aria-labelledby="rota-dlg-tit">' +
            '<form method="dialog" class="rota-dlg-form" id="rota-dlg-form" novalidate>' +
            '<h3 id="rota-dlg-tit" class="rota-tit"><i class="fa-solid fa-sliders" aria-hidden="true"></i> Configurar rota</h3>' +
            (!st.v2 ? '' : '<fieldset><legend>Horário e ritmo da rota</legend>' +
                '<div class="rota-dlg-grade3">' +
                '<label class="rota-dlg-campo"><span>Hora de saída</span><input type="time" id="rota-dlg-saida" class="adm-input" value="' + esc(hhmm(cfg.horaSaida) || '07:00') + '" step="300"></label>' +
                '<label class="rota-dlg-campo"><span>Velocidade média (km/h)</span><input type="number" id="rota-dlg-vel" class="adm-input" min="5" max="120" step="0.5" value="' + esc(cfg.velocidadeKmh) + '"></label>' +
                '<label class="rota-dlg-campo"><span>Minutos por parada</span><input type="number" id="rota-dlg-parada" class="adm-input" min="0" max="120" step="1" value="' + esc(cfg.minutosParada) + '"></label>' +
                '</div>' +
                '<p class="rota-sub">Usados para estimar a chegada em cada parada (distância em linha reta × ' + NUM1.format(ROTA.FATOR_ESTRADA) + ' ÷ velocidade + tempo de atendimento).</p></fieldset>') +
            '<fieldset><legend>Feriados</legend>' +
                '<label class="rota-dlg-check"><input type="checkbox" id="rota-dlg-feriados"' + (cfg.feriadosSemSaida ? ' checked' : '') + '> Feriado não tem saída e não conta como dia útil</label>' +
                '<p class="rota-sub">Nacionais + Carnaval (seg e ter), Sexta-feira Santa e Corpus Christi (calculados pela Páscoa). Próximos: ' +
                    (prox.length ? esc(prox.map(function (x) { return dataBr(x); }).join(', ')) : 'nenhum nos próximos meses') + '.</p>' +
                '<div class="rota-dlg-linha"><label for="rota-dlg-data">Data a mais sem saída</label><input type="date" id="rota-dlg-data" class="adm-input">' +
                '<button type="button" class="adm-botao-fantasma" id="rota-dlg-add-data">Adicionar</button></div>' +
                '<ul class="rota-chips" id="rota-dlg-datas" aria-label="Datas extras sem saída">' + extras.map(chipData).join('') + '</ul></fieldset>' +
            '<fieldset><legend>Horário de corte do pedido</legend>' +
                '<label for="rota-dlg-corte" class="rota-sub">Pedido feito a partir desta hora conta o prazo do dia seguinte</label>' +
                '<select id="rota-dlg-corte" class="adm-input">' + horas + '</select></fieldset>' +
            '<fieldset><legend>S10</legend>' +
                '<label class="rota-dlg-check"><input type="checkbox" id="rota-dlg-volta"' + (cfg.voltaSede ? ' checked' : '') + '> A S10 volta para a sede no fim (o km estimado inclui a volta)</label></fieldset>' +
            '<p class="rota-dlg-msg" id="rota-dlg-msg" role="alert"></p>' +
            '<div class="rota-dlg-acoes"><button type="button" class="adm-botao-fantasma" id="rota-dlg-cancelar">Cancelar</button>' +
                '<button type="button" class="adm-botao" id="rota-dlg-salvar">Salvar</button></div>' +
            '</form></dialog>';
    }
    function chipData(d) {
        return '<li><span>' + esc(dataBr(d) + '/' + d.slice(0, 4)) + '</span><button type="button" class="rota-chip-x" data-rota-tira-data="' + esc(d) + '" aria-label="Tirar ' + esc(dataBr(d)) + '"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></li>';
    }

    // Diálogo "Configurar rota" (só admin).
    function abrirDialogo() {
        var dlg = document.getElementById('rota-dialogo');
        if (!dlg || typeof dlg.showModal !== 'function' || dlg.open || st.dlgSalvando) return;
        dlg._abertura = (st.dlgAbertura = (st.dlgAbertura || 0) + 1);
        dlg._rasc = { datas: Object.keys(st.cfg.feriadosExtras).sort() };
        if (st.v2) {
            dlg.querySelector('#rota-dlg-saida').value = hhmm(st.cfg.horaSaida) || '07:00';
            dlg.querySelector('#rota-dlg-vel').value = String(st.cfg.velocidadeKmh);
            dlg.querySelector('#rota-dlg-parada').value = String(st.cfg.minutosParada);
        }
        dlg.querySelector('#rota-dlg-data').value = '';
        dlg.querySelector('#rota-dlg-corte').value = st.cfg.corteHora == null ? '' : String(st.cfg.corteHora);
        dlg.querySelector('#rota-dlg-feriados').checked = !!st.cfg.feriadosSemSaida;
        dlg.querySelector('#rota-dlg-volta').checked = !!st.cfg.voltaSede;
        dlg.querySelector('#rota-dlg-msg').textContent = '';
        dlgTravar(dlg, false);
        dlgChips(dlg);
        if (!dlg._ligado) { ligarDialogo(dlg); dlg._ligado = true; }
        dlg.showModal();
        (dlg.querySelector('#rota-dlg-saida') || dlg.querySelector('#rota-dlg-feriados')).focus();
    }
    function dlgTravar(dlg, sim) {
        ['#rota-dlg-salvar', '#rota-dlg-cancelar', '#rota-dlg-saida', '#rota-dlg-vel', '#rota-dlg-parada',
         '#rota-dlg-add-data', '#rota-dlg-data', '#rota-dlg-corte',
         '#rota-dlg-feriados', '#rota-dlg-volta'].forEach(function (q) { var e = dlg.querySelector(q); if (e) e.disabled = sim; });
        dlg.querySelectorAll('[data-rota-tira-data]').forEach(function (e) { e.disabled = sim; });
        var f = dlg.querySelector('#rota-dlg-form'); if (f) { if (sim) f.setAttribute('aria-busy', 'true'); else f.removeAttribute('aria-busy'); }
    }
    function dlgChips(dlg) {
        dlg.querySelector('#rota-dlg-datas').innerHTML = dlg._rasc.datas.map(chipData).join('');
    }
    function ligarDialogo(dlg) {
        var msg = dlg.querySelector('#rota-dlg-msg');
        dlg.querySelector('#rota-dlg-add-data').addEventListener('click', function () {
            var v = dlg.querySelector('#rota-dlg-data').value, r = dlg._rasc;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { msg.textContent = 'Escolha uma data.'; return; }
            if (r.datas.indexOf(v) < 0) { r.datas.push(v); r.datas.sort(); }
            msg.textContent = ''; dlgChips(dlg);
        });
        dlg.addEventListener('click', function (ev) {
            var d = ev.target.closest('[data-rota-tira-data]'), r = dlg._rasc;
            if (d) { r.datas = r.datas.filter(function (x) { return x !== d.getAttribute('data-rota-tira-data'); }); dlgChips(dlg); dlg.querySelector('#rota-dlg-data').focus(); }
        });
        dlg.addEventListener('cancel', function (ev) { if (st.dlgSalvando) ev.preventDefault(); });
        dlg.querySelector('#rota-dlg-cancelar').addEventListener('click', function () {
            if (st.dlgSalvando) return;
            dlg.close();
            var b = st.alvo && st.alvo.querySelector('#rota-configurar'); if (b) b.focus();
        });
        dlg.addEventListener('close', function () {
            var b = st.alvo && st.alvo.querySelector('#rota-configurar');
            if (b) b.focus();
        });
        dlg.querySelector('#rota-dlg-salvar').addEventListener('click', function () {
            if (st.dlgSalvando) return;
            var r = dlg._rasc, corte = dlg.querySelector('#rota-dlg-corte').value, abertura = dlg._abertura;
            var saidaMin = null, vel = null, parada = null;
            if (st.v2) {   // horário (044): hora de saída 00:00..23:59 (24:00 recusado também no banco), velocidade e minutos
                var saidaTxt = String(dlg.querySelector('#rota-dlg-saida').value || '').trim();
                saidaMin = minutosDe(saidaTxt);
                if (saidaMin == null) { msg.textContent = 'Informe uma hora de saída válida (ex.: 07:00).'; dlg.querySelector('#rota-dlg-saida').focus(); return; }
                vel = Number(dlg.querySelector('#rota-dlg-vel').value);
                if (!isFinite(vel) || vel < 5 || vel > 120) { msg.textContent = 'A velocidade média deve ficar entre 5 e 120 km/h.'; dlg.querySelector('#rota-dlg-vel').focus(); return; }
                parada = Number(dlg.querySelector('#rota-dlg-parada').value);
                if (!isFinite(parada) || parada < 0 || parada > 120 || Math.floor(parada) !== parada) { msg.textContent = 'Os minutos por parada devem ser um número inteiro entre 0 e 120.'; dlg.querySelector('#rota-dlg-parada').focus(); return; }
            }
            // v3: bairros_caminhao NÃO vai no upsert (fica no banco sem uso; o dado não é apagado).
            var linha = { id: 1, feriados_extras: r.datas.slice(),
                          feriados_sem_saida: dlg.querySelector('#rota-dlg-feriados').checked, s10_volta_sede: dlg.querySelector('#rota-dlg-volta').checked,
                          corte_hora: corte === '' ? null : Number(corte) };
            if (st.v2) {
                linha.hora_saida = hhmm(saidaMin);
                linha.velocidade_kmh = Math.round(vel * 10) / 10;
                linha.minutos_parada = parada;
            }
            st.dlgSalvando = true; dlgTravar(dlg, true); msg.textContent = 'Salvando…';
            function mesmo() { return dlg.isConnected && dlg.open && dlg._abertura === abertura; }
            st.sb.from('rota_config').upsert(linha, { onConflict: 'id' }).then(function (res) {
                st.dlgSalvando = false;
                aposMutacao();
                if (res.error) {
                    if (mesmo()) { dlgTravar(dlg, false); msg.textContent = 'Não foi possível salvar: ' + (res.error.message || res.error); }
                    return;
                }
                var cfgLocal = Object.assign({}, st.cfgLinha || {}, linha);
                st.cfgLinha = cfgLocal; st.cfg = cfgDe(cfgLocal);
                if (mesmo()) dlg.close();
                if (st.ativo) {
                    desenhar();
                    var b = st.alvo && st.alvo.querySelector('#rota-configurar'); if (b) b.focus();
                }
                recarregarConfig();
            }, function (e) {
                st.dlgSalvando = false;
                aposMutacao();
                if (mesmo()) { dlgTravar(dlg, false); msg.textContent = 'Não foi possível salvar: ' + String((e && e.message) || e); }
            });
        });
    }
    function recarregarConfig() {
        if (!st.sb) return;
        var seq = st.seq, mut0 = st.mut;
        Promise.all([st.sb.from('rota_config').select('*').eq('id', 1).limit(1),
                     paginar(function () { return st.sb.from('rota_cliente_veiculo').select('documento,veiculo').order('documento', { ascending: true }); }, 20000)])
            .then(function (rs) {
                if (seq !== st.seq || !st.ativo) return;
                // UI1: gravação concluída/pendente durante a leitura -> retrato velho: lê de novo depois.
                if (st.mut !== mut0 || pendentes()) { if (pendentes()) st.recargaPendente = true; else recarregarConfig(); return; }
                lerConfig(rs[0], rs[1]); desenhar();
            });
    }

    // ===================== DIÁLOGO "SÓ NESTE PEDIDO" OU "SEMPRE" (044) =====================
    function htmlDialogoEscopo() {
        return '<dialog class="rota-dialogo rota-dialogo-curto" id="rota-dlg-escopo" aria-labelledby="rota-esc-tit">' +
            '<div class="rota-dlg-form">' +
            '<h3 id="rota-esc-tit" class="rota-tit"><i class="fa-solid fa-route" aria-hidden="true"></i> Como aplicar esta marcação?</h3>' +
            '<p class="rota-sub" id="rota-esc-txt"></p>' +
            '<div class="rota-dlg-acoes rota-dlg-acoes-wrap">' +
            '<button type="button" class="adm-botao-fantasma" id="rota-esc-cancelar">Cancelar</button>' +
            '<button type="button" class="adm-botao-fantasma" id="rota-esc-pedido">Só neste pedido</button>' +
            '<button type="button" class="adm-botao" id="rota-esc-sempre">Sempre (padrão do cliente)</button>' +
            '</div></div></dialog>';
    }
    function perguntarEscopoMarcacao(op) {
        var dlg = document.getElementById('rota-dlg-escopo');
        if (!dlg || typeof dlg.showModal !== 'function') { op.aoEscolher('pedido'); return; }
        dlg._op = op;
        dlg.querySelector('#rota-esc-txt').textContent = op.texto;
        dlg.querySelector('#rota-esc-pedido').textContent = op.rotuloPedido || 'Só neste pedido';
        dlg.querySelector('#rota-esc-pedido').style.display = op.soSempre ? 'none' : '';
        dlg.querySelector('#rota-esc-sempre').textContent = op.rotuloSempre || 'Sempre (padrão do cliente)';
        if (!dlg._ligado) {
            dlg._ligado = true;
            var fechar = function (escopo) {
                var atualOp = dlg._op; dlg._op = null;
                if (dlg.open) dlg.close();
                if (!atualOp) return;
                if (escopo) atualOp.aoEscolher(escopo);
                else atualOp.aoCancelar();
            };
            dlg.querySelector('#rota-esc-pedido').addEventListener('click', function () { fechar('pedido'); });
            dlg.querySelector('#rota-esc-sempre').addEventListener('click', function () { fechar('sempre'); });
            dlg.querySelector('#rota-esc-cancelar').addEventListener('click', function () { fechar(null); });
            dlg.addEventListener('cancel', function (ev) { ev.preventDefault(); fechar(null); });
        }
        dlg.showModal();
        dlg.querySelector(op.soSempre ? '#rota-esc-cancelar' : '#rota-esc-pedido').focus();
    }

    // Gravação v2 via RPC rota_044_marcar(p_cd_pedido, p_veiculo, p_escopo).
    // Trava todos os seletores do mesmo cliente enquanto grava, recalcula a rota ao vivo no sucesso e reverte no erro.
    function executarMarcacaoV2(cdPedido, doc, veiculo, escopo) {
        var ch = doc || ('p:' + cdPedido);
        if (!podeEditar() || st.gravandoVeiculo[ch]) return;
        var seq = (st.seqVeiculo[ch] || 0) + 1;
        st.seqVeiculo[ch] = seq; st.gravandoVeiculo[ch] = true;
        if (st.alvo) {
            st.alvo.querySelectorAll('[data-rota-marcar-chave="' + ch + '"]').forEach(function (el) {
                el.disabled = true; el.setAttribute('aria-busy', 'true');
            });
        }
        function fim(erro, resTipo) {
            if (st.seqVeiculo[ch] !== seq) return;
            delete st.gravandoVeiculo[ch];
            if (erro) {
                st.msgVeiculo = 'Não foi possível gravar a marcação: ' + erro;
            } else if (resTipo !== 'padrao' && resTipo !== 'pedido' && resTipo !== 'removido') {
                st.msgVeiculo = 'Resposta inesperada ao gravar a marcação. Clique em Atualizar para conferir.';
            } else {
                st.msgVeiculo = '';
                if (resTipo === 'removido') {
                    delete st.porPedido[cdPedido];
                    if (escopo === 'sempre' && doc) delete st.excecoes[doc];
                } else if (resTipo === 'padrao') {          // padrão do cliente = veiculo; a escolha do pedido some
                    if (doc) st.excecoes[doc] = veiculo;
                    delete st.porPedido[cdPedido];
                } else {                                     // 'pedido': só este pedido
                    st.porPedido[cdPedido] = veiculo;
                }
            }
            st.focoPedido = String(cdPedido);
            aposMutacao();
            desenhar();
        }
        st.sb.rpc('rota_044_marcar', { p_cd_pedido: Number(cdPedido), p_veiculo: veiculo, p_escopo: escopo })
            .then(function (r) { fim(r.error ? (r.error.message || String(r.error)) : null, r.data); },
                  function (e) { fim(String((e && e.message) || e), null); });
    }
    function aoMudarMarcacaoV2(sel) {
        if (!podeEditar()) return;
        var cd = Number(sel.getAttribute('data-rota-marcar'));
        var p = st.pedidos.filter(function (x) { return Number(x.cd_pedido) === cd; })[0];
        if (!p) return;
        var doc = p.documento || '';
        var ch = chaveTrava(p);
        if (st.gravandoVeiculo[ch]) return;
        var padrao = doc ? (st.excecoes[doc] || null) : null;
        var porPed = st.porPedido[cd] || null;
        var atual = porPed || padrao || '';
        var novo = sel.value || '';
        if (novo === atual) return;
        var nome = nomeCliente(doc ? st.clientes[doc] : null, { p: p });
        // Sem padrão no cliente (ou pedido sem documento): grava direto, sem perguntar.
        if (!padrao) {
            executarMarcacaoV2(cd, doc, novo || null, doc ? 'sempre' : 'pedido');
            return;
        }
        // Escolheu o próprio padrão num pedido que tinha escolha diferente: só volta ao padrão, sem perguntar.
        if (novo && novo === padrao) {
            executarMarcacaoV2(cd, doc, novo, 'pedido');
            return;
        }
        // Desmarcar em cliente que já tem padrão:
        if (!novo) {
            if (porPed) {
                perguntarEscopoMarcacao({
                    texto: nome + ' tem padrão ' + (padrao === 'caminhao' ? 'CEASA (caminhão)' : 'S10') + ' e o pedido #' + cd + ' estava marcado diferente. ' +
                        'Voltar só este pedido ao padrão, ou tirar o padrão do cliente? Tirando o padrão, este pedido e os que seguem o padrão voltam para "Aguardando marcação"; ' +
                        'os outros pedidos marcados "só neste pedido" continuam como estão.',
                    rotuloPedido: 'Só neste pedido (voltar ao padrão)',
                    rotuloSempre: 'Sempre (desmarcar cliente)',
                    aoEscolher: function (escopo) { executarMarcacaoV2(cd, doc, null, escopo); },
                    aoCancelar: function () { sel.value = atual; sel.focus(); }
                });
            } else {
                // O pedido segue o padrão: desmarcar = tirar o padrão do cliente (todos os pedidos dele voltam a "Falta marcar").
                perguntarEscopoMarcacao({
                    texto: 'O pedido #' + cd + ' segue o padrão ' + (padrao === 'caminhao' ? 'CEASA (caminhão)' : 'S10') + ' de ' + nome +
                        '. Desmarcar tira o padrão do cliente: este pedido e os outros que seguem o padrão voltam para "Aguardando marcação"; ' +
                        'pedidos marcados "só neste pedido" continuam como estão.',
                    soSempre: true,
                    rotuloSempre: 'Desmarcar o cliente',
                    aoEscolher: function (escopo) { executarMarcacaoV2(cd, doc, null, escopo); },
                    aoCancelar: function () { sel.value = atual; sel.focus(); }
                });
            }
            return;
        }
        // Cliente já tem padrão e o usuário escolheu outro veículo: perguntar "Só neste pedido" ou "Sempre".
        var rotNovo = novo === 'caminhao' ? 'CEASA (caminhão)' : 'S10';
        var rotPadrao = padrao === 'caminhao' ? 'CEASA (caminhão)' : 'S10';
        perguntarEscopoMarcacao({
            texto: nome + ' já tem padrão ' + rotPadrao + '. Aplicar ' + rotNovo + ' só no pedido #' + cd + ' ou sempre para este cliente?',
            rotuloPedido: 'Só neste pedido (#' + cd + ')',
            rotuloSempre: 'Sempre (mudar padrão)',
            aoEscolher: function (escopo) { executarMarcacaoV2(cd, doc, novo, escopo); },
            aoCancelar: function () { sel.value = atual; sel.focus(); }
        });
    }

    // ===================== TIRAR DA ROTA / VOLTAR (045: rota_pedido_ignorado) =====================
    function htmlDialogoTirar() {
        return '<dialog class="rota-dialogo rota-dialogo-curto" id="rota-dlg-tirar" aria-labelledby="rota-tirar-tit">' +
            '<form method="dialog" class="rota-dlg-form" id="rota-tirar-form" novalidate>' +
            '<h3 id="rota-tirar-tit" class="rota-tit"><i class="fa-solid fa-ban" aria-hidden="true"></i> Tirar da rota</h3>' +
            '<p class="rota-sub" id="rota-tirar-txt"></p>' +
            '<label class="rota-dlg-campo"><span>Motivo (opcional, até 120 caracteres)</span>' +
            '<input type="text" id="rota-tirar-motivo" class="adm-input" maxlength="120" autocomplete="off" placeholder="Ex.: pedido antigo, não vai sair"></label>' +
            '<p class="rota-dlg-msg" id="rota-tirar-msg" role="alert"></p>' +
            '<div class="rota-dlg-acoes"><button type="button" class="adm-botao-fantasma" id="rota-tirar-cancelar">Cancelar</button>' +
            '<button type="button" class="adm-botao" id="rota-tirar-ok">Tirar da rota</button></div>' +
            '</form></dialog>';
    }
    function abrirDialogoTirar(cd, btn) {
        if (!podeTirar()) return;
        var p = st.pedidos.filter(function (x) { return Number(x.cd_pedido) === Number(cd); })[0];
        if (!p || st.gravandoVeiculo[chaveTrava(p)]) return;
        var dlg = document.getElementById('rota-dlg-tirar');
        var nome = nomeCliente(p.documento ? st.clientes[p.documento] : null, { p: p });
        if (!dlg || typeof dlg.showModal !== 'function') { executarIgnorar(p, true, null); return; }
        if (dlg.open) return;
        dlg._p = p; dlg._btn = btn || null;
        dlg.querySelector('#rota-tirar-txt').textContent = 'Pedido #' + p.cd_pedido + ' de ' + nome + ' sai da rota, de "Aguardando marcação" e do WhatsApp até alguém clicar em "Voltar para a rota".';
        dlg.querySelector('#rota-tirar-motivo').value = '';
        dlg.querySelector('#rota-tirar-msg').textContent = '';
        if (!dlg._ligado) {
            dlg._ligado = true;
            var msg = dlg.querySelector('#rota-tirar-msg');
            var cancelar = function () {
                var b = dlg._btn, pAlvo = dlg._p;
                dlg._p = null;
                if (st.redesenhoPendente && pAlvo) st.focoTirar = String(pAlvo.cd_pedido);
                if (dlg.open) dlg.close();
                if (b && b.isConnected) b.focus();
            };
            var confirmar = function () {
                var alvoP = dlg._p; if (!alvoP) return;
                var motivo = String(dlg.querySelector('#rota-tirar-motivo').value || '').replace(/\s+/g, ' ').trim();
                if (motivo.length > 120) { msg.textContent = 'O motivo deve ter no máximo 120 caracteres.'; return; }
                if (/[<>]/.test(motivo)) { msg.textContent = 'O motivo não pode ter os caracteres < ou >.'; return; }
                dlg._p = null; dlg.close();
                executarIgnorar(alvoP, true, motivo || null);
            };
            dlg.querySelector('#rota-tirar-cancelar').addEventListener('click', cancelar);
            dlg.addEventListener('cancel', function (ev) { ev.preventDefault(); cancelar(); });
            dlg.querySelector('#rota-tirar-ok').addEventListener('click', confirmar);
            dlg.querySelector('#rota-tirar-form').addEventListener('submit', function (ev) { ev.preventDefault(); confirmar(); });
        }
        dlg.showModal();
        dlg.querySelector('#rota-tirar-motivo').focus();
    }
    // tirar=true: upsert em rota_pedido_ignorado; false ("Voltar para a rota"): apaga a linha. Mesma trava por cliente
    // da marcação (o seletor e os botões do cliente ficam desabilitados enquanto grava).
    function executarIgnorar(p, tirar, motivo) {
        var cd = Number(p.cd_pedido), ch = chaveTrava(p);
        if (!podeTirar() || st.gravandoVeiculo[ch]) return;
        var seq = (st.seqVeiculo[ch] || 0) + 1;
        st.seqVeiculo[ch] = seq; st.gravandoVeiculo[ch] = true;
        if (st.alvo) st.alvo.querySelectorAll('[data-rota-marcar-chave="' + ch + '"]').forEach(function (el) { el.disabled = true; el.setAttribute('aria-busy', 'true'); });
        var q = tirar ? st.sb.from('rota_pedido_ignorado').upsert({ cd_pedido: cd, motivo: motivo }, { onConflict: 'cd_pedido' })
                      : st.sb.from('rota_pedido_ignorado').delete().eq('cd_pedido', cd);
        function fim(erro) {
            if (st.seqVeiculo[ch] !== seq) return;
            delete st.gravandoVeiculo[ch];
            if (erro) st.msgVeiculo = 'Não foi possível ' + (tirar ? 'tirar o pedido da rota' : 'voltar o pedido para a rota') + ': ' + erro;
            else {
                st.msgVeiculo = '';
                if (tirar) { st.ignorados[cd] = { motivo: motivo, atualizado_em: new Date().toISOString() }; st.focoFora = true; }
                else { delete st.ignorados[cd]; st.focoPedido = String(cd); st.focoFora = true; }
            }
            aposMutacao();
            desenhar();
        }
        q.then(function (r) { fim(r.error ? (r.error.code === '42501' ? 'sem permissão' : (r.error.message || String(r.error))) : null); },
               function (e) { fim(String((e && e.message) || e)); });
    }

    // ===================== DIÁLOGO DE REGRAS DE ENTREGA POR CLIENTE (044) =====================
    function htmlDialogoRegra() {
        var checksDias = DIAS_CURTOS.map(function (d) {
            return '<label class="rota-dlg-check rota-dia-check"><input type="checkbox" name="rota-regra-dia" value="' + d[0] + '"> ' + d[1] + '</label>';
        }).join('');
        return '<dialog class="rota-dialogo" id="rota-dlg-regra" aria-labelledby="rota-regra-tit">' +
            '<form method="dialog" class="rota-dlg-form" id="rota-regra-form" novalidate>' +
            '<h3 id="rota-regra-tit" class="rota-tit"><i class="fa-solid fa-clock" aria-hidden="true"></i> Regras de entrega do cliente</h3>' +
            '<p class="rota-sub" id="rota-regra-sub"></p>' +
            '<fieldset><legend>Janela de recebimento (opcional)</legend>' +
                '<div class="rota-dlg-grade2">' +
                '<label class="rota-dlg-campo"><span>Recebe a partir de</span><input type="time" id="rota-regra-ini" class="adm-input" step="300"></label>' +
                '<label class="rota-dlg-campo"><span>Recebe até</span><input type="time" id="rota-regra-fim" class="adm-input" step="300"></label>' +
                '</div>' +
                '<p class="rota-sub">Se chegar antes do início, a rota conta espera; se passar do fim, marca "fora do horário (+N min)".</p></fieldset>' +
            '<fieldset><legend>Prioridade</legend>' +
                '<label class="rota-dlg-check"><input type="checkbox" id="rota-regra-pri"> Entregar primeiro (atendido antes das paradas sem prioridade)</label></fieldset>' +
            '<fieldset><legend>Dias da semana em que NÃO recebe</legend>' +
                '<div class="rota-dias-grade">' + checksDias + '</div>' +
                '<p class="rota-sub">Nos dias marcados acima o pedido fica para a próxima saída em que o cliente recebe.</p></fieldset>' +
            '<fieldset><legend>Observação de entrega (até 200 caracteres)</legend>' +
                '<label for="rota-regra-obs" class="sr-only">Observação</label>' +
                '<input type="text" id="rota-regra-obs" class="adm-input" maxlength="200" autocomplete="off" placeholder="Ex.: descarregar pela lateral, procurar recepção…"></fieldset>' +
            '<p class="rota-dlg-msg" id="rota-regra-msg" role="alert"></p>' +
            '<div class="rota-dlg-acoes">' +
            '<button type="button" class="adm-botao-fantasma" id="rota-regra-limpar">Limpar regras</button>' +
            '<button type="button" class="adm-botao-fantasma" id="rota-regra-cancelar">Cancelar</button>' +
            '<button type="button" class="adm-botao" id="rota-regra-salvar">Salvar</button></div>' +
            '</form></dialog>';
    }
    function dlgRegraTravar(dlg, sim) {
        ['#rota-regra-ini', '#rota-regra-fim', '#rota-regra-pri', '#rota-regra-obs',
         '#rota-regra-limpar', '#rota-regra-cancelar', '#rota-regra-salvar'].forEach(function (q) { var e = dlg.querySelector(q); if (e) e.disabled = sim; });
        dlg.querySelectorAll('input[name="rota-regra-dia"]').forEach(function (e) { e.disabled = sim; });
        var f = dlg.querySelector('#rota-regra-form'); if (f) { if (sim) f.setAttribute('aria-busy', 'true'); else f.removeAttribute('aria-busy'); }
    }
    function abrirDialogoRegra(doc, btnOrigem) {
        if (!st.v2 || !podeEditar() || !/^\d{11,14}$/.test(doc) || st.regraSalvando) return;
        var dlg = document.getElementById('rota-dlg-regra');
        if (!dlg || typeof dlg.showModal !== 'function' || dlg.open) return;
        var c = st.clientes[doc], nome = (c && c.nome) || ('Cliente ' + doc);
        var r = st.regras[doc] || null;
        dlg._doc = doc;
        dlg._btn = btnOrigem || null;
        dlg._abertura = (st.regraAbertura = (st.regraAbertura || 0) + 1);
        dlg.querySelector('#rota-regra-sub').textContent = nome + ' · doc. ' + doc;
        dlg.querySelector('#rota-regra-ini').value = r && r.ini != null ? hhmm(r.ini) : '';
        dlg.querySelector('#rota-regra-fim').value = r && r.fim != null ? (r.fim === 24 * 60 ? '23:59' : hhmm(r.fim)) : '';
        dlg.querySelector('#rota-regra-pri').checked = !!(r && r.prioridade);
        dlg.querySelector('#rota-regra-obs').value = (r && r.obs) || '';
        dlg.querySelectorAll('input[name="rota-regra-dia"]').forEach(function (chk) {
            chk.checked = !!(r && r.dias && r.dias[Number(chk.value)]);
        });
        dlg.querySelector('#rota-regra-msg').textContent = '';
        dlgRegraTravar(dlg, false);
        dlg.querySelector('#rota-regra-limpar').style.display = temRegraAtiva(r) ? '' : 'none';
        if (!dlg._ligado) { ligarDialogoRegra(dlg); dlg._ligado = true; }
        dlg.showModal();
        dlg.querySelector('#rota-regra-ini').focus();
    }
    function ligarDialogoRegra(dlg) {
        var msg = dlg.querySelector('#rota-regra-msg');
        function devolverFoco() {
            var doc = dlg._doc;
            // Só para o redesenho ADIADO (o evento 'close' ainda não rodou aqui); sem ele, um focoRegra solto
            // roubaria o foco da próxima marcação.
            if (st.redesenhoPendente) st.focoRegra = doc;
            var b = (dlg._btn && dlg._btn.isConnected ? dlg._btn : null) || (st.alvo && doc && st.alvo.querySelector('[data-rota-regra="' + doc + '"]'));
            if (b) b.focus();
        }
        dlg.addEventListener('cancel', function (ev) { if (st.regraSalvando) ev.preventDefault(); });
        dlg.querySelector('#rota-regra-cancelar').addEventListener('click', function () {
            if (st.regraSalvando) return;
            dlg.close();
            devolverFoco();
        });
        dlg.addEventListener('close', function () {
            if (!st.regraSalvando) devolverFoco();
        });
        function persistirRegra(limpar) {
            if (st.regraSalvando) return;
            var doc = dlg._doc, abertura = dlg._abertura;
            var iniTxt = limpar ? '' : String(dlg.querySelector('#rota-regra-ini').value || '').trim();
            var fimTxt = limpar ? '' : String(dlg.querySelector('#rota-regra-fim').value || '').trim();
            var iniMin = iniTxt ? minutosDe(iniTxt) : null;
            var fimMin = fimTxt ? minutosDe(fimTxt) : null;
            if (iniTxt && iniMin == null) { msg.textContent = 'Horário inicial inválido.'; dlg.querySelector('#rota-regra-ini').focus(); return; }
            if (fimTxt && fimMin == null) { msg.textContent = 'Horário final inválido.'; dlg.querySelector('#rota-regra-fim').focus(); return; }
            if (iniMin != null && fimMin != null && iniMin >= fimMin) {
                msg.textContent = 'O fim da janela deve ser depois do início.';
                dlg.querySelector('#rota-regra-fim').focus();
                return;
            }
            var pri = limpar ? false : dlg.querySelector('#rota-regra-pri').checked;
            var dias = [];
            if (!limpar) {
                dlg.querySelectorAll('input[name="rota-regra-dia"]:checked').forEach(function (chk) { dias.push(Number(chk.value)); });
                dias.sort(function (a, b) { return a - b; });
            }
            var obs = limpar ? '' : String(dlg.querySelector('#rota-regra-obs').value || '').replace(/\s+/g, ' ').trim();
            if (obs.length > 200) { msg.textContent = 'A observação deve ter no máximo 200 caracteres.'; dlg.querySelector('#rota-regra-obs').focus(); return; }
            if (/[<>]/.test(obs)) { msg.textContent = 'A observação não pode ter os caracteres < ou >.'; dlg.querySelector('#rota-regra-obs').focus(); return; }
            var vazio = iniMin == null && fimMin == null && !pri && !dias.length && !obs;
            var linha = { documento: doc, janela_inicio: iniMin == null ? null : hhmm(iniMin), janela_fim: fimMin == null ? null : hhmm(fimMin),
                          dias_sem_receber: dias, prioridade: pri, observacao: obs || null };
            st.regraSalvando = true; dlgRegraTravar(dlg, true); msg.textContent = 'Salvando…';
            function mesmo() { return dlg.isConnected && dlg.open && dlg._abertura === abertura; }
            var req = vazio
                ? st.sb.from('rota_cliente_regras').delete().eq('documento', doc)
                : st.sb.from('rota_cliente_regras').upsert(linha, { onConflict: 'documento' });
            req.then(function (res) {
                st.regraSalvando = false;
                aposMutacao();
                if (res.error) {
                    if (mesmo()) {
                        dlgRegraTravar(dlg, false);
                        msg.textContent = res.error.code === '23514' ? 'Não foi possível salvar: algum campo está fora do permitido (janela até 23:59, início antes do fim, observação até 200 caracteres sem < >).'
                            : res.error.code === '42501' ? 'Não foi possível salvar: sem permissão para editar regras de entrega.'
                            : 'Não foi possível salvar: ' + (res.error.message || res.error);
                    }
                    return;
                }
                if (vazio) delete st.regras[doc]; else st.regras[doc] = regraDe(linha);
                if (mesmo()) dlg.close();
                if (st.ativo) {
                    st.focoRegra = doc;
                    desenhar();
                }
            }, function (e) {
                st.regraSalvando = false;
                aposMutacao();
                if (mesmo()) { dlgRegraTravar(dlg, false); msg.textContent = 'Não foi possível salvar: ' + String((e && e.message) || e); }
            });
        }
        dlg.querySelector('#rota-regra-salvar').addEventListener('click', function () { persistirRegra(false); });
        dlg.querySelector('#rota-regra-limpar').addEventListener('click', function () { persistirRegra(true); });
    }

    // v1 (sem 044): Exceção por cliente: Automático apaga; Caminhão/S10 grava (upsert).
    function salvarVeiculo(doc, valor, sel) {
        if (!podeEditar() || !/^\d{11,14}$/.test(doc) || st.gravandoVeiculo[doc]) return;
        if ((st.excecoes[doc] || '') === (valor || '')) return;
        var seq = (st.seqVeiculo[doc] || 0) + 1;
        st.seqVeiculo[doc] = seq; st.gravandoVeiculo[doc] = true;
        if (sel) { sel.disabled = true; sel.setAttribute('aria-busy', 'true'); }
        var q = valor ? st.sb.from('rota_cliente_veiculo').upsert({ documento: doc, veiculo: valor }, { onConflict: 'documento' })
                      : st.sb.from('rota_cliente_veiculo').delete().eq('documento', doc);
        function fim(erro) {
            if (st.seqVeiculo[doc] !== seq) return;
            delete st.gravandoVeiculo[doc];
            if (erro) st.msgVeiculo = 'Não foi possível gravar o veículo: ' + erro;
            else { if (valor) st.excecoes[doc] = valor; else delete st.excecoes[doc]; st.msgVeiculo = ''; }
            st.focoVeiculo = doc;
            aposMutacao();
            desenhar();
        }
        q.then(function (r) { fim(r.error ? (r.error.message || String(r.error)) : null); }, function (e) { fim(String((e && e.message) || e)); });
    }

    // ===================== PLANO DA SEMANA DA S10 (046: referência seg–sex) =====================
    function cap(s) { var t = String(s || ''); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
    function semanaAlvo() {
        var ini = st.semanaIni && /^\d{4}-\d{2}-\d{2}$/.test(st.semanaIni) ? segundaDe(st.semanaIni) : null;
        return ini || proximaSemana(hojeSP());
    }
    function diaDeRasc(r) { return r && typeof r === 'object' ? r.dia : r; }
    function semanaDeRasc(cd, r) {
        if (r && typeof r === 'object' && r.semana) return r.semana;
        var d = diaDeRasc(r);
        if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return segundaDe(d);
        if (st.plano[cd] && /^\d{4}-\d{2}-\d{2}$/.test(st.plano[cd])) return segundaDe(st.plano[cd]);
        return semanaAlvo();
    }
    // Mapa efetivo { cd_pedido: 'YYYY-MM-DD' }: junta o salvo no banco (st.plano) com o rascunho da sessão (st.rascSemana).
    // Valor null no rascunho significa "Voltar à sugestão" para um pedido que estava salvo.
    // Quando semIni é informada, um rascunho de semana ANTERIOR a semIni não sobrescreve um dia já salvo em semIni.
    function planoEfetivo(semIni) {
        var m = {}, k, r, d, s;
        for (k in st.plano) if (Object.prototype.hasOwnProperty.call(st.plano, k) && st.plano[k]) m[k] = st.plano[k];
        for (k in st.rascSemana) {
            if (!Object.prototype.hasOwnProperty.call(st.rascSemana, k)) continue;
            r = st.rascSemana[k];
            d = diaDeRasc(r);
            s = semanaDeRasc(k, r);
            if (semIni && s && s < semIni && m[k] && m[k] >= semIni) continue;
            if (d === null) delete m[k];
            else if (d) m[k] = d;
        }
        return m;
    }
    function temRascunhoSemana(ini) {
        var k;
        for (k in st.rascSemana) {
            if (!Object.prototype.hasOwnProperty.call(st.rascSemana, k)) continue;
            if (!ini || semanaDeRasc(k, st.rascSemana[k]) === ini) return true;
        }
        return false;
    }
    function outrasSemanasComRascunho(ini) {
        var vistas = {}, out = [], k, s;
        for (k in st.rascSemana) {
            if (!Object.prototype.hasOwnProperty.call(st.rascSemana, k)) continue;
            s = semanaDeRasc(k, st.rascSemana[k]);
            if (s && s !== ini && !vistas[s]) { vistas[s] = true; out.push(s); }
        }
        return out.sort();
    }
    function limparRascunhoDaSemana(ini) {
        Object.keys(st.rascSemana).forEach(function (k) {
            if (semanaDeRasc(k, st.rascSemana[k]) === ini) delete st.rascSemana[k];
        });
    }
    function temSalvoSemana(sem) {
        if (!sem || !st.pln046) return false;
        var ini = sem.inicio, fim = somaDias(ini, 5), k;
        for (k in st.plano) {
            if (Object.prototype.hasOwnProperty.call(st.plano, k) && st.plano[k] >= ini && st.plano[k] <= fim) return true;
        }
        return false;
    }
    var CARDEAIS = ['Norte', 'Nordeste', 'Leste', 'Sudeste', 'Sul', 'Sudoeste', 'Oeste', 'Noroeste'];
    function dirCardeal(graus) {
        if (graus == null || !isFinite(graus)) return '';
        var g = ((Number(graus) % 360) + 360) % 360;
        return CARDEAIS[Math.round(g / 45) % 8];
    }
    function anguloMedioPedidos(pedidos) {
        var sx = 0, sy = 0, n = 0;
        (pedidos || []).forEach(function (x) {
            if (x && x.ang != null && isFinite(x.ang)) {
                var rad = Number(x.ang) * Math.PI / 180;
                sx += Math.cos(rad); sy += Math.sin(rad); n++;
            }
        });
        return n ? ((Math.atan2(sy, sx) * 180 / Math.PI) + 360) % 360 : null;
    }
    function resumoRegiaoDia(d, regioes) {
        var reg = null;
        (regioes || []).forEach(function (r) { if (r.dia === d.dia || (d.regiao != null && r.indice === d.regiao)) reg = r; });
        var centro = reg && reg.centro != null ? reg.centro : anguloMedioPedidos(d.pedidos);
        var dir = centro != null ? 'Setor ' + dirCardeal(centro) : '';
        var cont = {}, ordem = [];
        (d.pedidos || []).forEach(function (x) {
            var b = (x.c && x.c.bairro) ? String(x.c.bairro).trim() : '';
            if (!b) return;
            if (!cont[b]) { cont[b] = 0; ordem.push(b); }
            cont[b]++;
        });
        ordem.sort(function (a, b) { return cont[b] - cont[a] || (a < b ? -1 : 1); });
        var bairros = ordem.slice(0, 3).join(', ') + (ordem.length > 3 ? ' (+' + (ordem.length - 3) + ')' : '');
        if (dir && bairros) return dir + ' · ' + bairros;
        return bairros || dir || (d.pedidos && d.pedidos.length ? 'Sem bairro' : 'Sem entregas');
    }
    function seletorDiaSemana(x, dias, nome) {
        var cd = x.p.cd_pedido;
        if (!podeEditar()) {
            return x.origemDia === 'salvo'
                ? '<span class="rota-selo rota-selo-plano"><i class="fa-solid fa-thumbtack" aria-hidden="true"></i>fixado</span>'
                : '';
        }
        // US-4: semana sem nenhum dia de saída (recesso/feriados): não exibe seletor sem opções válidas.
        if (!dias || !dias.length) {
            return '<span class="rota-sub">Sem dias com saída · mude de semana</span>';
        }
        var rot = 'Dia da semana para o pedido ' + cd + ' de ' + nome;
        var temDia = dias.some(function (d) { return d.dia === x.dia; });
        var atualVal = temDia ? x.dia : '';
        var ops = (!temDia ? '<option value="" selected>Escolher dia…</option>' : '') +
            dias.map(function (d) {
                var r = cap(DIAS_ROTULO[diaSemana(d.dia)] || d.nome) + ' ' + dataBr(d.dia);
                return '<option value="' + esc(d.dia) + '"' + (x.dia === d.dia ? ' selected' : '') + '>' + esc(r) + '</option>';
            }).join('') +
            (x.origemDia === 'salvo' ? '<option value="sugestao">Voltar à sugestão</option>' : '');
        return '<label class="rota-veic rota-sem-veic no-print"><span class="sr-only">' + esc(rot) + '</span>' +
            '<select class="adm-input rota-sem-sel" data-rota-sem-dia="' + esc(cd) + '" data-rota-sem-atual="' + esc(atualVal) + '" aria-label="' + esc(rot) + '"' + (st.semSalvando ? ' disabled aria-busy="true"' : '') + '>' +
            ops + '</select></label>';
    }
    function htmlLinhaPedidoSemana(x, n, eta, dias) {
        var nome = nomeCliente(x.c, x);
        var bairro = (x.c && x.c.bairro) || 'sem bairro';
        var prazoRuim = seloPrazo(x, true);
        var alertas = [];
        if (x.estoura) alertas.push('<span class="rota-sit rota-sit-vencido"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>passa do prazo</span>');
        else if (prazoRuim) alertas.push(prazoRuim);
        if (x.diaFechado) alertas.push('<span class="rota-selo rota-selo-fechado"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i>não recebe neste dia</span>');
        if (x.salvoInvalido) alertas.push('<span class="rota-selo rota-selo-fechado"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i>salvo em dia sem saída (' + esc(dataBr(x.salvoInvalido)) + ')</span>');
        if (x.regra && x.regra.prioridade) alertas.push('<span class="rota-selo rota-selo-pri"><i class="fa-solid fa-bolt" aria-hidden="true"></i>Prioridade</span>');
        if (x.origemDia === 'salvo') alertas.push('<span class="rota-selo rota-selo-plano" title="Dia escolhido/fixado"><i class="fa-solid fa-thumbtack" aria-hidden="true"></i>fixado</span>');
        var ruim = x.estoura || x.diaFechado;
        return '<li class="rota-sem-item' + (ruim ? ' is-ruim' : '') + '">' +
            '<div class="rota-sem-item-topo">' +
                '<div class="rota-cli-linha">' +
                    (n != null ? '<span class="rota-sem-ord">' + n + '.</span>' : '') +
                    (eta ? '<span class="rota-eta">~' + esc(eta) + '</span>' : '') +
                    '<strong>' + esc(nome) + '</strong>' + botaoRegraCliente(x.p.documento, nome) +
                '</div>' +
                seletorDiaSemana(x, dias, nome) +
            '</div>' +
            '<div class="rota-sub">' + esc(bairro) + ' · #' + esc(x.p.cd_pedido) + ' · <strong>' + txtCaixas(x.v) + '</strong></div>' +
            (alertas.length ? '<div class="rota-regras-cli">' + alertas.join(' ') + '</div>' : '') +
            '</li>';
    }
    function htmlCardDiaSemana(d, sem) {
        var capCx = Math.round(ROTA.CAPACIDADE_S10 / ROTA.VOLUME_CX24);
        var usadoCx = Math.round(d.volume / ROTA.VOLUME_CX24);
        var pctTotal = Math.round(d.ocupacao * 100);
        var pctBarra = Math.min(100, pctTotal);
        var cheio = d.excesso || d.ocupacao > 0.95;
        var estouram = d.pedidos.filter(function (x) { return x.estoura; }).length;
        var fechados = d.pedidos.filter(function (x) { return x.diaFechado; }).length;
        var nParadas = d.paradas.length + d.semPosicao.length;
        var regTxt = resumoRegiaoDia(d, sem.regioes);
        var alertasDia = [];
        if (d.excesso) alertasDia.push('<span class="rota-sit rota-sit-vencido"><i class="fa-solid fa-box" aria-hidden="true"></i>acima de ' + NUM.format(capCx) + ' cx24</span>');
        if (estouram) alertasDia.push('<span class="rota-sit rota-sit-vencido"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' + NUM.format(estouram) + (estouram === 1 ? ' passa do prazo' : ' passam do prazo') + '</span>');
        if (fechados) alertasDia.push('<span class="rota-selo rota-selo-fechado"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i>' + NUM.format(fechados) + (fechados === 1 ? ' não recebe neste dia' : ' não recebem neste dia') + '</span>');
        if (d.horario && d.horario.atrasos) alertasDia.push('<span class="rota-sit rota-sit-vencido"><i class="fa-solid fa-clock" aria-hidden="true"></i>' + NUM.format(d.horario.atrasos) + ' fora do horário</span>');
        var itens = [];
        d.paradas.forEach(function (sp, idx) {
            sp.pedidos.forEach(function (x) { itens.push(htmlLinhaPedidoSemana(x, idx + 1, sp.eta, sem.dias)); });
        });
        d.semPosicao.forEach(function (sp) {
            sp.pedidos.forEach(function (x) { itens.push(htmlLinhaPedidoSemana(x, null, null, sem.dias)); });
        });
        return '<section class="adm-card p-3 rota-cartao rota-sem-dia' + (d.excesso || estouram ? ' rota-cartao-alerta' : '') + '" data-rota-sem-card="' + esc(d.dia) + '" aria-labelledby="rota-sem-tit-' + esc(d.dia) + '">' +
            '<div class="rota-sem-dia-cab">' +
                '<p class="rota-tit" id="rota-sem-tit-' + esc(d.dia) + '"><i class="fa-regular fa-calendar-check" aria-hidden="true"></i> ' + esc(cap(d.nome)) + ' · ' + esc(dataBr(d.dia)) + '</p>' +
                '<p class="rota-sub rota-sem-regiao"><i class="fa-solid fa-compass" aria-hidden="true"></i> <strong>Região:</strong> ' + esc(regTxt) + '</p>' +
                '<div class="rota-kpis">' +
                    '<span><strong>' + NUM.format(d.pedidos.length) + '</strong> ' + (d.pedidos.length === 1 ? 'pedido' : 'pedidos') + ' (' + NUM.format(nParadas) + (nParadas === 1 ? ' parada' : ' paradas') + ')</span>' +
                    '<span><strong>~' + NUM.format(Math.round(d.km)) + ' km</strong></span>' +
                    (d.horario && d.paradas.length && d.horario.fim ? '<span>' + esc(d.horario.saida) + ' → <strong>~' + esc(d.horario.fim) + '</strong></span>' : '') +
                '</div>' +
            '</div>' +
            '<div class="rota-ocup mt-2" role="img" aria-label="Ocupação de ' + esc(d.nome) + ': ' + NUM.format(usadoCx) + ' de ' + NUM.format(capCx) + ' cx24 (' + pctTotal + '%)">' +
                '<div class="rota-ocup-barra' + (cheio ? ' is-cheia' : '') + '" style="width:' + pctBarra + '%"></div></div>' +
            '<p class="rota-sub mt-1"><strong>' + NUM.format(usadoCx) + ' / ' + NUM.format(capCx) + ' cx24</strong> (' + pctTotal + '%)' +
                (d.desconhecidos ? ' · <span class="rota-aviso-txt">' + NUM.format(d.desconhecidos) + ' sem volume</span>' : '') + '</p>' +
            (alertasDia.length ? '<div class="rota-regras-cli mt-1">' + alertasDia.join(' ') + '</div>' : '') +
            (itens.length ? '<ol class="rota-sem-lista">' + itens.join('') + '</ol>' : '<p class="adm-vazio-linha"><span class="adm-vazio-titulo">Nenhum pedido neste dia</span></p>') +
            '</section>';
    }
    function htmlListaExtraSemana(id, icone, titulo, sub, lista, dias, diaRef, motivoFn) {
        if (!lista || !lista.length) return '';
        return '<section class="adm-card p-4 mb-4 rota-cartao" id="' + esc(id) + '" aria-labelledby="' + esc(id) + '-tit">' +
            '<div class="rota-cab rota-cab-compacto"><p class="rota-tit" id="' + esc(id) + '-tit"><i class="fa-solid ' + icone + '" aria-hidden="true"></i> ' + esc(titulo) + ' (' + NUM.format(lista.length) + ')</p>' +
            '<span class="rota-sub">' + esc(sub) + '</span></div>' +
            '<div class="overflow-x-auto"><table class="adm-tabela rota-tabela"><thead><tr><th>Cliente</th><th>Caixas</th><th>Situação</th><th>Dia na semana</th></tr></thead><tbody>' +
            lista.map(function (x) {
                var nome = nomeCliente(x.c, x);
                var ref = x.dia || diaRef;
                var prazoRuim = seloPrazo(x, true, ref, 's10');
                var ruim = !!(x.estoura || (x.prazo && ref && x.prazo < ref));
                return '<tr' + (ruim ? ' class="rota-linha-ruim"' : '') + '><td><div class="rota-cli-linha"><strong>' + esc(nome) + '</strong>' + botaoRegraCliente(x.p.documento, nome) + '</div>' +
                    '<div class="rota-sub">' + esc((x.c && x.c.bairro) || 'sem bairro') + ' · #' + esc(x.p.cd_pedido) + (prazoRuim ? ' ' + prazoRuim : '') + '</div>' +
                    htmlRegrasCliente(x.p.documento, nome, true, true) + '</td>' +
                    '<td data-rotulo="Caixas">' + txtCaixas(x.v) + '</td>' +
                    '<td data-rotulo="Situação">' + motivoFn(x) + '</td>' +
                    '<td data-rotulo="Dia na semana">' + seletorDiaSemana(x, dias, nome) + '</td></tr>';
            }).join('') + '</tbody></table></div></section>';
    }
    function htmlSemana(sem) {
        var padraoIni = proximaSemana(hojeSP());
        var diaRefSem = (sem.dias[0] && sem.dias[0].dia) || sem.inicio;
        var capCx = Math.round(ROTA.CAPACIDADE_S10 / ROTA.VOLUME_CX24);
        var totCx = Math.round((sem.resumo.volume || 0) / ROTA.VOLUME_CX24);
        var temRasc = temRascunhoSemana(sem.inicio);
        var outrasRasc = outrasSemanasComRascunho(sem.inicio);
        var temSalvo = temSalvoSemana(sem);
        var temPedidosDias = sem.dias.some(function (d) { return d.pedidos.length > 0; });
        var feriadosTxt = sem.semSaida.length
            ? sem.semSaida.map(function (f) { return cap(DIAS_ROTULO[diaSemana(f.dia)] || nomeDia(f.dia)) + ' ' + dataBr(f.dia); }).join(', ')
            : '';
        var botoesAcao = [];
        if (podeEditar() && temRasc) {
            botoesAcao.push('<button type="button" class="adm-botao-fantasma" id="rota-sem-sugestao"' + (st.semSalvando ? ' disabled' : '') + '><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Desfazer alterações</button>');
        }
        if (podeSalvarSemana()) {
            if (temSalvo) {
                botoesAcao.push('<button type="button" class="adm-botao-fantasma" id="rota-sem-limpar"' + (st.semSalvando ? ' disabled' : '') + '><i class="fa-regular fa-trash-can" aria-hidden="true"></i> Limpar plano salvo</button>');
            }
            botoesAcao.push('<button type="button" class="adm-botao" id="rota-sem-salvar"' + (st.semSalvando || !temPedidosDias ? ' disabled' : '') + '><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> ' + (st.semSalvando ? 'Salvando…' : 'Salvar semana') + '</button>');
        } else if (!st.pln046) {
            botoesAcao.push('<span class="rota-sub"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Sugestão (sem migração 046: visualização sem salvar no banco)</span>');
        }
        var avisoOutras = '';
        if (podeEditar() && outrasRasc.length) {
            avisoOutras = '<div class="rota-sem-barra mt-2 no-print" id="rota-sem-aviso-outras" role="status">' +
                '<span class="rota-sub"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Há alterações não salvas em outra semana (' +
                outrasRasc.map(function (s) { return 'seg ' + esc(dataBr(s)); }).join(', ') + '): elas são mantidas ao salvar ou limpar esta semana.</span>' +
                '<div class="rota-sem-acoes">' +
                outrasRasc.map(function (s) {
                    return '<button type="button" class="adm-botao-fantasma" data-rota-ir-sem="' + esc(s) + '"' + (st.semSalvando ? ' disabled' : '') + '>Ir para ' + esc(dataBr(s)) + '</button>';
                }).join('') +
                '<button type="button" class="adm-botao-fantasma" id="rota-sem-desc-outras"' + (st.semSalvando ? ' disabled' : '') + '>Descartar rascunho de outra semana</button>' +
                '</div></div>';
        }
        var cdResumo = '';
        if (sem.cd && sem.cd.total && sem.cd.total.pedidos) {
            var tCd = sem.cd.total;
            cdResumo = '<section class="adm-card p-3 mb-4 rota-cartao" id="rota-sem-ceasa" aria-labelledby="rota-sem-ceasa-tit">' +
                '<div class="rota-cab rota-cab-compacto mb-0"><p class="rota-tit" id="rota-sem-ceasa-tit"><i class="fa-solid fa-warehouse" aria-hidden="true"></i> CEASA (CD) — pedidos em aberto</p>' +
                '<div class="rota-kpis"><span><strong>' + NUM.format(tCd.clientes) + '</strong> ' + (tCd.clientes === 1 ? 'cliente' : 'clientes') + ' · <strong>' + NUM.format(tCd.pedidos) + '</strong> ' + (tCd.pedidos === 1 ? 'pedido' : 'pedidos') + ' · <strong>' + NUM.format(tCd.caixas) + ' cx</strong> (' + esc(brl(tCd.valorCentavos)) + ')</span>' +
                '<span class="rota-sub">O caminhão do CEASA sai seg–sáb na rota do dia</span></div></div></section>';
        }
        var subSobra = !sem.dias.length
            ? 'Esta semana não tem dias com saída da S10 (feriados/datas sem saída) — use Anterior ou Seguinte para planejar outra semana.'
            : 'Não couberam nos ' + NUM.format(capCx) + ' cx24/dia ou o cliente não recebe de segunda a sexta — escolha um dia para incluir.';
        return '<section class="adm-card p-4 mb-4 rota-cartao" id="rota-semana-topo" aria-labelledby="rota-sem-topo-tit">' +
                '<div class="rota-cab rota-cab-compacto">' +
                    '<div><p class="rota-tit" id="rota-sem-topo-tit"><i class="fa-solid fa-calendar-week" aria-hidden="true"></i> Plano da semana da S10 · seg ' + esc(dataBr(sem.inicio)) + ' a sex ' + esc(dataBr(sem.fim)) + '</p>' +
                    '<p class="rota-sub">Referência para organizar a semana por região e capacidade (' + NUM.format(capCx) + ' cx24/dia). Todo dia a rota do dia é calculada separadamente.</p></div>' +
                    '<div class="rota-sem-nav no-print">' +
                        '<button type="button" class="adm-botao-fantasma" id="rota-sem-ant" title="Semana anterior"' + (st.semSalvando ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> Anterior</button>' +
                        (sem.inicio !== padraoIni ? '<button type="button" class="adm-botao-fantasma" id="rota-sem-padrao"' + (st.semSalvando ? ' disabled' : '') + '>Próxima semana (' + esc(dataBr(padraoIni)) + ')</button>' : '') +
                        '<button type="button" class="adm-botao-fantasma" id="rota-sem-prox" title="Semana seguinte"' + (st.semSalvando ? ' disabled' : '') + '>Seguinte <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>' +
                    '</div>' +
                '</div>' +
                '<div class="rota-sem-barra">' +
                    '<div class="rota-kpis">' +
                        '<span><strong>' + NUM.format(sem.resumo.pedidos) + '</strong> ' + (sem.resumo.pedidos === 1 ? 'pedido S10 nos dias' : 'pedidos S10 nos dias') + '</span>' +
                        '<span><strong>~' + NUM.format(totCx) + ' cx24</strong> na semana</span>' +
                        (sem.resumo.salvos ? '<span><strong>' + NUM.format(sem.resumo.salvos) + '</strong> ' + (sem.resumo.salvos === 1 ? 'fixado' : 'fixados') + (temRasc ? ' (com edição não salva)' : '') + '</span>' : '') +
                        (sem.resumo.faltaMarcar ? '<span class="rota-sit rota-sit-hoje"><i class="fa-solid fa-hand-pointer" aria-hidden="true"></i>' + NUM.format(sem.resumo.faltaMarcar) + ' falta(m) marcar</span>' : '') +
                        (sem.resumo.estouram ? '<span class="rota-sit rota-sit-vencido"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' + NUM.format(sem.resumo.estouram) + (sem.resumo.estouram === 1 ? ' passa do prazo' : ' passam do prazo') + '</span>' : '') +
                        (feriadosTxt ? '<span class="rota-selo rota-selo-fechado"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i>Feriado sem saída: ' + esc(feriadosTxt) + '</span>' : '') +
                    '</div>' +
                    '<div class="rota-sem-acoes no-print">' + botoesAcao.join('') + '</div>' +
                '</div>' +
                avisoOutras +
                (st.msgSemana ? '<p class="rota-sub mt-2" id="rota-sem-msg" role="status"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ' + esc(st.msgSemana) + '</p>' : '') +
            '</section>' +
            (sem.dias.length
                ? '<div class="rota-semana-grade mb-4">' + sem.dias.map(function (d) { return htmlCardDiaSemana(d, sem); }).join('') + '</div>'
                : '<div class="adm-card p-6 mb-4"><p class="adm-vazio-linha"><span class="adm-vazio-titulo">Nenhum dia útil com saída da S10 nesta semana — use Anterior ou Seguinte para mudar de semana</span></p></div>') +
            htmlListaExtraSemana('rota-sem-sobra', 'fa-clock-rotate-left', 'Fora dos dias da semana / Sobra',
                subSobra,
                sem.sobra, sem.dias, diaRefSem, function (x) {
                    if (x.motivoSobra === 'sem_saida_semana') return '<span class="rota-selo rota-selo-fechado"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i>sem saída da S10 nesta semana · mude de semana</span>';
                    if (x.motivoSobra === 'dia_fechado') return '<span class="rota-selo rota-selo-fechado"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i>não recebe nos dias com saída</span>';
                    return '<span class="rota-selo"><i class="fa-solid fa-box" aria-hidden="true"></i>excede capacidade (' + NUM.format(capCx) + ' cx24)' + (x.diaSugerido ? ' · setor de ' + esc(DIAS_ROTULO[diaSemana(x.diaSugerido)] + ' ' + dataBr(x.diaSugerido)) : '') + '</span>';
                }) +
            htmlListaExtraSemana('rota-sem-sempos', 'fa-location-dot', 'Sem posição no mapa',
                'Pedidos S10 sem coordenadas nem bairro localizado — escolha o dia da semana manualmente.',
                sem.semPosicao, sem.dias, diaRefSem, function () {
                    return '<span class="rota-selo"><i class="fa-solid fa-circle-question" aria-hidden="true"></i>sem coordenadas para setorizar</span>';
                }) +
            htmlListaExtraSemana('rota-sem-outra', 'fa-calendar-days', 'Salvos em outra semana',
                'Pedidos S10 com dia fixado fora desta semana.',
                sem.foraDaSemana, sem.dias, diaRefSem, function (x) {
                    return seloPlanoDia({ planoDia: x.dia });
                }) +
            htmlAguardando({ aguardando: sem.faltaMarcar, dia: diaRefSem }) +
            cdResumo;
    }
    function aplicarDiaSemana(cd, val, semIni) {
        if (val === 'sugestao' || !val) {
            if (st.plano[cd]) st.rascSemana[cd] = { dia: null, semana: st.plano[cd] ? segundaDe(st.plano[cd]) : semIni };
            else delete st.rascSemana[cd];
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
            if (st.plano[cd] === val) delete st.rascSemana[cd];
            else st.rascSemana[cd] = { dia: val, semana: segundaDe(val) };
        }
        st.msgSemana = '';
        st.focoSem = 'ped:' + cd;
        desenhar();
    }
    function aoMudarDiaSemana(sel) {
        if (!podeEditar() || st.semSalvando) return;
        var cd = Number(sel.getAttribute('data-rota-sem-dia'));
        var val = sel.value || '';
        var valAtual = sel.getAttribute('data-rota-sem-atual') || '';
        if (!cd) return;
        var semIni = semanaAlvo();
        var rAnt = st.rascSemana[cd];
        var semAnt = rAnt ? semanaDeRasc(cd, rAnt) : null;
        if (rAnt && semAnt && semAnt !== semIni) {
            perguntarEscopoMarcacao({
                texto: 'O pedido #' + cd + ' tem alteração não salva na semana de seg ' + dataBr(semAnt) + '. Aplicar a mudança nesta semana e descartar o rascunho de ' + dataBr(semAnt) + '?',
                soSempre: true,
                rotuloSempre: 'Mover para esta semana',
                aoEscolher: function () { aplicarDiaSemana(cd, val, semIni); },
                aoCancelar: function () { sel.value = valAtual; sel.focus(); }
            });
            return;
        }
        aplicarDiaSemana(cd, val, semIni);
    }
    function descartarOutrasSemanas(semIni, btnOrigem) {
        var outras = outrasSemanasComRascunho(semIni);
        if (!outras.length || st.semSalvando) return;
        perguntarEscopoMarcacao({
            texto: 'Descartar as alterações não salvas de outra(s) semana(s) (' + outras.map(function (s) { return 'seg ' + dataBr(s); }).join(', ') + ')?',
            soSempre: true,
            rotuloSempre: 'Descartar rascunho',
            aoEscolher: function () {
                Object.keys(st.rascSemana).forEach(function (k) {
                    if (semanaDeRasc(k, st.rascSemana[k]) !== semIni) delete st.rascSemana[k];
                });
                st.msgSemana = 'Rascunho de outra semana descartado.';
                st.focoSem = '#rota-sem-salvar';
                desenhar();
            },
            aoCancelar: function () { if (btnOrigem && btnOrigem.isConnected) btnOrigem.focus(); }
        });
    }
    function salvarSemana(sem, limpar) {
        if (!podeSalvarSemana() || st.semSalvando || !sem) return;
        var ini = sem.inicio, fim = somaDias(ini, 5);
        var itens = [], cdsSalvos = {};
        if (!limpar) {
            sem.dias.forEach(function (d) {
                d.pedidos.forEach(function (x) {
                    var cd = Number(x.p.cd_pedido);
                    itens.push({ cd_pedido: cd, dia: d.dia });
                    cdsSalvos[cd] = true;
                });
            });
        }
        st.semSalvando = true;
        st.msgSemana = '';
        desenhar();
        st.sb.rpc('rota_046_salvar_semana', { p_inicio: ini, p_itens: itens }).then(function (r) {
            st.semSalvando = false;
            if (r.error) {
                var cod = String(r.error.code || '');
                st.msgSemana = cod === '42501' ? 'Não foi possível salvar a semana: sem permissão.'
                    : cod === 'P0002' ? 'Um pedido mudou de etapa no ERP. Atualize a aba e tente de novo.'
                    : 'Não foi possível salvar a semana: ' + String(r.error.message || r.error);
            } else {
                Object.keys(st.plano).forEach(function (k) {
                    if ((st.plano[k] >= ini && st.plano[k] <= fim) || cdsSalvos[k]) delete st.plano[k];
                });
                itens.forEach(function (it) { st.plano[it.cd_pedido] = it.dia; });
                limparRascunhoDaSemana(ini);
                st.msgSemana = limpar
                    ? 'Plano salvo da semana removido (voltou à sugestão automática).'
                    : 'Plano da semana salvo (' + NUM.format(itens.length) + (itens.length === 1 ? ' pedido).' : ' pedidos).');
            }
            st.focoSem = '#rota-sem-salvar';
            aposMutacao();
            desenhar();
        }, function (e) {
            st.semSalvando = false;
            st.msgSemana = 'Não foi possível salvar a semana: ' + String((e && e.message) || e);
            st.focoSem = '#rota-sem-salvar';
            aposMutacao();
            desenhar();
        });
    }

    function planos() {
        var hoje = hojeSP(), pl = {}, mapaPlano = st.v2 ? planoEfetivo() : {};
        var o = { cfg: st.cfg, excecoes: st.excecoes, marcacao: st.v2, padroes: st.excecoes, porPedido: st.porPedido, regras: st.regras,
                  ignorados: st.v2 && st.ign045 ? st.ignorados : {}, plano: mapaPlano };
        pl.hoje = planejar(st.pedidos, st.clientes, hoje, o);
        var prox = proximaSaida(hoje, false, st.cfg);
        pl.proxima = prox ? planejar(st.pedidos, st.clientes, prox, Object.assign({}, o, { excluir: pl.hoje.semSaida ? {} : pl.hoje.entregues })) : null;
        return pl;
    }

    // "Atualizar" (botão da aba, "Tentar de novo" e o ATUALIZAR do painel). Com gravação pendente, espera (UI1).
    function recarregarTudo() {
        if (pendentes()) { st.recargaPendente = true; st.msgVeiculo = MSG_ESPERA; desenhar(); return; }
        st.carregado = false; carregar();
    }
    function desenharMapa(pl) {
        liberarMapa();
        var el = document.getElementById('rota-mapa');
        if (!el || typeof L === 'undefined') return;
        var m = L.map(el, { scrollWheelZoom: false });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 18 }).addTo(m);
        var pts = [ROTA.ORIGEM].concat(pl.s10.paradas.map(function (s) { return s.pos; }));
        if (pl.s10.volta && pl.s10.paradas.length) pts.push(ROTA.ORIGEM);
        L.polyline(pts, { color: '#f0915a', weight: 3, opacity: 0.9, interactive: false, className: 'rota-linha' }).addTo(m);
        L.marker(ROTA.ORIGEM, { icon: L.divIcon({ className: 'rota-sede', html: '<span><i class="fa-solid fa-warehouse" aria-hidden="true"></i></span>', iconSize: [28, 28], iconAnchor: [14, 14] }),
            title: 'Sede — saída', keyboard: false, zIndexOffset: 1000 }).bindTooltip('Sede (saída)', { direction: 'top', offset: [0, -14] }).addTo(m);
        pl.s10.paradas.forEach(function (s, i) {
            var etaTxt = st.v2 && s.eta ? ' · ~' + esc(s.eta) : '';
            L.marker(s.pos, { icon: L.divIcon({ className: 'rota-num-ic', html: '<span class="rota-num' + (s.precisao === 'bairro' ? ' is-aprox' : '') + '">' + (i + 1) + '</span>', iconSize: [26, 26], iconAnchor: [13, 13] }),
                title: (i + 1) + '. ' + (s.nome || 'Cliente') + (s.bairro ? ' — ' + s.bairro : ''), keyboard: true })
                .bindTooltip((i + 1) + '. ' + esc(s.nome || 'Cliente') + (s.bairro ? ' — ' + esc(s.bairro) : '') + etaTxt + (resumoParada(s) ? '<br>' + esc(resumoParada(s)) : ''),
                    { direction: 'top', offset: [0, -12] }).addTo(m);
        });
        st.mapa = m;
        // Enquadramento: o que o usuário deixou (arrastar/zoom) vale entre redesenhos (marcações, troca de aba); sem isso,
        // enquadra a rota. 'prog' separa o movimento feito aqui do movimento do usuário.
        var chave = st.vista === 'proxima' ? 'proxima' : 'hoje', prog = false;
        function enquadrar() {
            if (!st.mapa || !el.clientWidth) return;
            prog = true;
            try {
                st.mapa.invalidateSize({ animate: false });
                var v = st.mapaVista[chave];
                if (v) st.mapa.setView(v.c, v.z, { animate: false });
                else st.mapa.fitBounds(pts, { padding: [30, 30], maxZoom: 14, animate: false });
            } finally { prog = false; }
        }
        m.on('moveend', function () { if (!prog && st.mapa === m) st.mapaVista[chave] = { c: m.getCenter(), z: m.getZoom() }; });
        // Botão "Enquadrar rota" (volta ao automático).
        var Reenq = L.Control.extend({ options: { position: 'topleft' }, onAdd: function () {
            var b = L.DomUtil.create('button', 'rota-reenq leaflet-bar');
            b.type = 'button'; b.title = 'Enquadrar a rota inteira'; b.setAttribute('aria-label', 'Enquadrar a rota inteira');
            b.innerHTML = '<i class="fa-solid fa-expand" aria-hidden="true"></i>';
            L.DomEvent.disableClickPropagation(b);
            L.DomEvent.on(b, 'click', function () { delete st.mapaVista[chave]; enquadrar(); });
            return b;
        } });
        new Reenq().addTo(m);
        enquadrar();
        if (typeof ResizeObserver !== 'undefined') { var t = 0; st.ro = new ResizeObserver(function () { cancelAnimationFrame(t); t = requestAnimationFrame(enquadrar); }); st.ro.observe(el); }
    }

    function desenhar() {
        var alvo = st.alvo;
        if (!alvo || !st.ativo) return;   // aba fechada (encerrar): resposta atrasada não desenha nada
        // Uma gravação que termina enquanto outro diálogo da aba está aberto (ex.: regras) não pode apagá-lo:
        // redesenha quando ele fechar.
        var aberto = alvo.querySelector('dialog[open]');
        if (aberto) {
            st.redesenhoPendente = true;
            if (!aberto._redesenhaAoFechar) {
                aberto._redesenhaAoFechar = true;
                aberto.addEventListener('close', function () { if (st.redesenhoPendente) { st.redesenhoPendente = false; setTimeout(desenhar, 0); } });
            }
            return;
        }
        st.redesenhoPendente = false;
        liberarMapa();                     // o HTML abaixo substitui o contêiner do mapa (carregando/erro/rota)
        var cab = '<div class="rota-topo"><div><h2 class="rota-titulo"><i class="fa-solid fa-route" aria-hidden="true"></i> Rota do dia</h2>' +
            '<p class="rota-sub">' + (st.coletado ? 'ERP às ' + esc(new Date(st.coletado).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: ROTA.TZ })) + ' · ' : '') +
            'S10 seg–sex · CEASA seg–sáb · prazo de ' + ROTA.PRAZO_DIAS_UTEIS + ' dias úteis' + (st.cfg && st.cfg.feriadosSemSaida ? ' (sem feriados)' : '') + '</p></div>';
        if (st.carregando && !st.carregado) { alvo.innerHTML = cab + '</div><p class="adm-vazio-linha"><i class="fa-solid fa-spinner fa-spin"></i><span class="adm-vazio-texto">Carregando pedidos e posições…</span></p>'; return; }
        if (st.erro) {
            alvo.innerHTML = cab + '</div><div class="adm-card p-6"><p class="text-sm mb-3">Não foi possível carregar a rota: ' + esc(st.erro) + '</p><button type="button" class="adm-botao-fantasma" id="rota-tentar">Tentar de novo</button></div>';
            alvo.querySelector('#rota-tentar').addEventListener('click', carregar);
            return;
        }
        if (!st.carregado) {
            alvo.innerHTML = cab + '</div><p class="adm-vazio-linha"><i class="fa-solid fa-spinner fa-spin"></i><span class="adm-vazio-texto">' +
                (pendentes() ? 'Terminando a gravação para atualizar…' : 'Carregando pedidos e posições…') + '</span></p>';
            carregar(); return;
        }
        if (st.v2 && st.erroV2 && !st.desatualizado) {
            alvo.innerHTML = cab + '</div><div class="adm-card p-6 rota-banner rota-banner-erro" role="alert"><p class="mb-2"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ' +
                '<strong>Não foi possível ler as marcações da rota</strong> (' + esc(st.erroV2) + ').</p>' +
                '<p class="rota-sub mb-3">A rota não é mostrada para não sair com CEASA/S10 ou horários errados.</p>' +
                '<button type="button" class="adm-botao" id="rota-tentar"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Tentar de novo</button></div>';
            alvo.querySelector('#rota-tentar').addEventListener('click', function () { st.carregado = false; carregar(); });
            return;
        }
        var pl = planos();
        var semDias = 'sem saída nos próximos ' + NUM.format(ROTA.BUSCA_SAIDA_DIAS) + ' dias';
        if (pl.hoje.semSaida && !pl.proxima) {   // nenhum dia com saída no limite: nada a planejar (configuração de feriados)
            alvo.innerHTML = cab + '</div><div class="adm-card p-6 rota-banner" role="status"><p><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i> ' +
                'Hoje não tem saída e não há ' + esc(semDias.replace('sem saída ', 'saída ')) + ' pelas regras atuais (feriados/datas extras). Confira "Regras da rota".</p></div>' +
                htmlConfigResumo(pl.hoje) + (podeConfigurar() ? '<button type="button" class="adm-botao-fantasma mt-3" id="rota-configurar"><i class="fa-solid fa-sliders" aria-hidden="true"></i> Configurar rota</button>' + htmlDialogo() : '');
            var cb0 = alvo.querySelector('#rota-configurar'); if (cb0) cb0.addEventListener('click', abrirDialogo);
            return;
        }
        if (!st.v2 && st.vista === 'semana') st.vista = 'hoje';
        if (st.vista !== 'semana') {
            if (!pl.proxima) st.vista = 'hoje';
            if (pl.hoje.semSaida && pl.proxima) st.vista = 'proxima';
        }
        var atual = (st.vista === 'proxima' || pl.hoje.semSaida) && pl.proxima ? pl.proxima : pl.hoje;
        var semIni = semanaAlvo();
        var sem = st.v2 && st.vista === 'semana'
            ? planejarSemana(st.pedidos, st.clientes, semIni, { cfg: st.cfg, padroes: st.excecoes, porPedido: st.porPedido, regras: st.regras,
                ignorados: st.ign045 ? st.ignorados : {}, plano: planoEfetivo(semIni) })
            : null;
        var motivoSem = pl.hoje.feriado ? 'feriado' : 'domingo';
        var nFora = st.v2 && st.ign045 && atual.ignorados ? atual.ignorados.length : 0;
        var chipSemana = st.v2
            ? '<button type="button" class="adm-chip' + (st.vista === 'semana' ? ' is-ativo' : '') + '" data-rota-vista="semana" aria-pressed="' + (st.vista === 'semana') + '">Semana · seg ' +
                esc(dataBr(semIni)) + ' a sex ' + esc(dataBr(somaDias(semIni, 4))) + '</button>'
            : '';
        var seletor = '<div class="rota-acoes no-print"><div class="flex flex-wrap gap-1" role="group" aria-label="Visão da rota">' +
            '<button type="button" class="adm-chip' + (st.vista === 'hoje' ? ' is-ativo' : '') + '" data-rota-vista="hoje" aria-pressed="' + (st.vista === 'hoje') + '"' + (pl.hoje.semSaida ? ' disabled title="Sem saída (' + motivoSem + ')"' : '') + '>Hoje · ' +
                esc(nomeDia(pl.hoje.dia)) + ' ' + esc(dataBr(pl.hoje.dia)) + (pl.hoje.semSaida ? ' (sem saída: ' + motivoSem + ')' : '') + '</button>' +
            (pl.proxima
                ? '<button type="button" class="adm-chip' + (st.vista === 'proxima' ? ' is-ativo' : '') + '" data-rota-vista="proxima" aria-pressed="' + (st.vista === 'proxima') + '">Próxima · ' +
                    esc(nomeDia(pl.proxima.dia)) + ' ' + esc(dataBr(pl.proxima.dia)) + '</button>'
                : '<button type="button" class="adm-chip" disabled aria-disabled="true" title="' + esc(semDias) + '">Próxima · ' + esc(semDias) + '</button>') +
            chipSemana + '</div>' +
            (nFora ? '<button type="button" class="adm-botao-fantasma" id="rota-atalho-fora"><i class="fa-solid fa-ban" aria-hidden="true"></i> Fora da rota (' + NUM.format(nFora) + ')</button>' : '') +
            (st.papel === 'admin' ? '<button type="button" class="adm-botao-fantasma" id="rota-configurar"' + (st.cfgAusente ? ' disabled title="Falta aplicar a migração 040"' : '') + '><i class="fa-solid fa-sliders" aria-hidden="true"></i> Configurar</button>' : '') +
            '<button type="button" class="adm-botao-fantasma" id="rota-btn-ajuda" aria-expanded="' + (st.cfgAberto ? 'true' : 'false') + '" title="Regras da rota e como funciona" aria-label="Regras da rota e como funciona"><i class="fa-regular fa-circle-question" aria-hidden="true"></i></button>' +
            '<button type="button" class="adm-botao-fantasma" id="rota-atualizar"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Atualizar</button>' +
            '<button type="button" class="adm-botao-fantasma" id="rota-imprimir"><i class="fa-solid fa-print" aria-hidden="true"></i> Imprimir</button></div></div>';
        var avisos = [];
        if (!st.temCaixas) avisos.push('As caixas por pedido ainda não chegam do ERP (migração 039 + coletor com "pedidos_enviar_caixas"). Sem elas a capacidade da S10 não é calculada: todos os pedidos aparecem como "volume desconhecido".');
        if (st.posErro) avisos.push('Posições dos clientes indisponíveis agora (' + st.posErro + '): as paradas ficam sem mapa, agrupadas por bairro.');
        if (st.msgVeiculo) avisos.push(st.msgVeiculo);
        if (st.avisoPerm) avisos.push(st.avisoPerm);
        var nota = st.vista === 'proxima' && !pl.hoje.semSaida ? '<p class="rota-sub mb-3">Simulação: considera que a rota de hoje sai como planejada; aqui ficam o que sobrou e o que ainda não estava no prazo.</p>' : '';
        var bannerDesat = st.v2 && st.erroV2 && st.desatualizado
            ? '<div class="adm-card p-4 mb-5 rota-banner rota-banner-erro" role="alert"><p><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ' +
                '<strong>Rota DESATUALIZADA:</strong> não foi possível reler as marcações (' + esc(st.erroV2) + '). Mostrando o último retrato completo' +
                (st.ultimoV2 && st.ultimoV2.em ? ' (lido às ' + esc(st.ultimoV2.em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })) + ')' : '') +
                '; a edição fica desligada até reler.</p><button type="button" class="adm-botao mt-2" id="rota-tentar"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Tentar de novo</button></div>'
            : '';
        var corpo = st.vista === 'semana' && sem
            ? '<p class="rota-imp-dia">Plano da semana da S10 · seg ' + esc(dataBr(sem.inicio)) + ' a sex ' + esc(dataBr(sem.fim)) + '</p>' +
              (avisos.length ? '<div class="adm-card p-4 mb-5 rota-banner" role="status">' + avisos.map(function (a) { return '<p><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ' + esc(a) + '</p>'; }).join('') + '</div>' : '') +
              htmlSemana(sem)
            : '<p class="rota-imp-dia">Rota de ' + esc(nomeDia(atual.dia)) + ', ' + esc(dataBr(atual.dia)) + '</p>' +
              (avisos.length ? '<div class="adm-card p-4 mb-5 rota-banner" role="status">' + avisos.map(function (a) { return '<p><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ' + esc(a) + '</p>'; }).join('') + '</div>' : '') +
              nota + htmlAguardando(atual) +
              '<div class="rota-grade-principal"><div class="rota-col-s10">' + htmlS10(atual) + htmlFica(atual) + '</div><div class="rota-col-ceasa">' + htmlCaminhao(atual) + '</div></div>';
        alvo.innerHTML = cab + seletor + bannerDesat + corpo +
            htmlForaDaRota(atual) + htmlConfigResumo(atual) +
            (podeConfigurar() ? htmlDialogo() : '') +
            (st.v2 && podeEditar() ? htmlDialogoEscopo() + htmlDialogoRegra() : '') + (podeTirar() ? htmlDialogoTirar() : '');
        ligarEventos(alvo, atual, sem);
    }
    // Ajuda da aba — v2 (044 aplicada): marcação, regras por cliente, horários, CD CEASA e plano da semana.
    function htmlAjudaV2() {
        return '<li>Marcação (CEASA / S10): cada pedido pendente é marcado como CEASA (caminhão) ou S10; o sistema lembra o padrão do cliente e permite exceção "só neste pedido" ou desmarcar. Sem marcação, o pedido fica em "Falta marcar" (fora da rota) com a regra automática (endereço com "CEASA", Av. Brasil 19001, até ' + NUM.format(ROTA.CEASA_RAIO_KM * 1000) + ' m do CEASA; senão S10) exibida como dica.</li>' +
                (st.ign045 ? '<li>Tirar da rota: o pedido sai da rota, de "Falta marcar" e do WhatsApp até alguém clicar em "Voltar para a rota" (lista "Fora da rota"). Pedido aberto antigo no ERP continua aparecendo até alguém tirar.</li>' : '') +
                '<li>Regras por cliente: dias da semana em que não recebe (o pedido fica para a próxima saída em que recebe), prioridade ("entregar primeiro"), janela de recebimento (início/fim) e observação curta.</li>' +
                '<li>S10 (segunda a sexta): por prazo (vencidos primeiro), até ' + NUM.format(Math.round(ROTA.CAPACIDADE_S10 / ROTA.VOLUME_CX24)) + ' cx24 equivalentes (volume ' + NUM.format(ROTA.CAPACIDADE_S10) + ': cx24 = ' + NUM1.format(ROTA.VOLUME_CX24) + ', cx48 = ' + NUM1.format(ROTA.VOLUME_CX48) + ', pote avulso = 9/24); o que exceder fica para a próxima saída.</li>' +
                '<li>Caminhão (segunda a sábado): tudo o que está marcado CEASA vai para o Centro de distribuição CEASA (uma parada, com a lista de carga agregada por cliente; sem limite de capacidade). O caminhão não para em bairros no caminho.</li>' +
                '<li>Semana (referência): agrupa os pedidos em aberto da S10 por região nos dias de segunda a sexta da semana seguinte (até 300 cx24/dia). Permite mover pedidos entre dias e salvar; na rota do dia aparece apenas o selo informativo "planejado p/ dia DD/MM".</li>' +
                '<li>Ordem e horários: sai da sede na hora configurada; prioritários vão primeiro, janelas de horário entram na posição de menor atraso e o percurso é otimizado (vizinho mais próximo + realocação + 2-opt, distância em linha reta × ' + NUM1.format(ROTA.FATOR_ESTRADA) + ' ÷ velocidade média + minutos por parada). Chegada antes da janela conta espera; após o fim marca "fora do horário (+N min)". Quem não dá para atender no horário nem indo direto fica na posição de menor km, com o atraso marcado. Horários são estimativa (linha reta), não trânsito real.</li>';
    }
    // Ajuda da aba — v1 (sem a 044): regra automática de antes, com exceção por cliente.
    function htmlAjudaV1() {
        return '<li>Veículo, nesta ordem: exceção marcada para o cliente &gt; CEASA (endereço com "CEASA", Av. Brasil 19001 ou até ' + NUM.format(ROTA.CEASA_RAIO_KM * 1000) + ' m do CEASA) &gt; S10.</li>' +
            '<li>S10: por prazo (vencidos primeiro), até ' + NUM.format(ROTA.CAPACIDADE_S10) + ' de volume (cx24 = ' + NUM1.format(ROTA.VOLUME_CX24) + ', cx48 = ' + NUM1.format(ROTA.VOLUME_CX48) + ', pote avulso = 9/24); o resto fica para a próxima saída. Caminhão: sem limite.</li>' +
            '<li>Ordem (S10 e caminhão): sai da sede, vai sempre para o cliente mais perto e depois desfaz cruzamentos (2-opt). Distância em linha reta × ' + NUM1.format(ROTA.FATOR_ESTRADA) + ' (estimativa).</li>';
    }
    function ligarEventos(alvo, atual, sem) {
        alvo.querySelectorAll('[data-rota-vista]').forEach(function (b) { b.addEventListener('click', function () { st.vista = b.getAttribute('data-rota-vista'); desenhar(); }); });
        alvo.querySelector('#rota-atualizar').addEventListener('click', recarregarTudo);
        var tentar = alvo.querySelector('#rota-tentar'); if (tentar) tentar.addEventListener('click', recarregarTudo);
        alvo.querySelector('#rota-imprimir').addEventListener('click', imprimir);
        var cfgBtn = alvo.querySelector('#rota-configurar');
        if (cfgBtn && podeConfigurar()) cfgBtn.addEventListener('click', abrirDialogo);
        var resumo = alvo.querySelector('.rota-config-resumo');
        if (resumo) resumo.addEventListener('toggle', function () {
            st.cfgAberto = resumo.open;
            var ba = alvo.querySelector('#rota-btn-ajuda'); if (ba) ba.setAttribute('aria-expanded', resumo.open ? 'true' : 'false');
        });
        var btnAjuda = alvo.querySelector('#rota-btn-ajuda');
        if (btnAjuda && resumo) btnAjuda.addEventListener('click', function () {
            resumo.open = !resumo.open; st.cfgAberto = resumo.open;
            btnAjuda.setAttribute('aria-expanded', resumo.open ? 'true' : 'false');
            if (resumo.open) {
                var s = alvo.querySelector('#rota-ajuda-sum');
                if (s) { if (s.scrollIntoView) s.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); s.focus(); }
            }
        });
        var btnMapa = alvo.querySelector('#rota-toggle-mapa');
        if (btnMapa) btnMapa.addEventListener('click', function () {
            st.mapaAberto = !st.mapaAberto; st.focoMapa = true; desenhar();
        });
        var atalhoFora = alvo.querySelector('#rota-atalho-fora');
        var fora = alvo.querySelector('#rota-fora');
        if (fora) fora.addEventListener('toggle', function () { st.foraAberto = fora.open; });
        if (atalhoFora && fora) atalhoFora.addEventListener('click', function () {
            fora.open = true; st.foraAberto = true;
            var fs = alvo.querySelector('#rota-fora-sum');
            if (fs) { if (fs.scrollIntoView) fs.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); fs.focus(); }
        });
        alvo.querySelectorAll('[data-rota-veiculo]').forEach(function (s) {
            s.addEventListener('change', function () { salvarVeiculo(s.getAttribute('data-rota-veiculo'), s.value, s); });
        });
        alvo.querySelectorAll('[data-rota-marcar]').forEach(function (s) {
            s.addEventListener('change', function () { aoMudarMarcacaoV2(s); });
        });
        alvo.querySelectorAll('[data-rota-tirar]').forEach(function (b) {
            b.addEventListener('click', function () { abrirDialogoTirar(b.getAttribute('data-rota-tirar'), b); });
        });
        alvo.querySelectorAll('[data-rota-voltar]').forEach(function (b) {
            b.addEventListener('click', function () {
                var cd = Number(b.getAttribute('data-rota-voltar'));
                var p = st.pedidos.filter(function (x) { return Number(x.cd_pedido) === cd; })[0];
                if (p) executarIgnorar(p, false, null);
            });
        });
        alvo.querySelectorAll('[data-rota-regra]').forEach(function (b) {
            b.addEventListener('click', function () { abrirDialogoRegra(b.getAttribute('data-rota-regra'), b); });
        });
        alvo.querySelectorAll('[data-rota-gmaps]').forEach(function (b) {
            b.addEventListener('click', function () { var w = window.open(b.getAttribute('data-rota-gmaps'), '_blank', 'noopener,noreferrer'); if (w) w.opener = null; });
        });
        alvo.querySelectorAll('[data-rota-sem-dia]').forEach(function (s) {
            s.addEventListener('change', function () { aoMudarDiaSemana(s); });
        });
        var bSemAnt = alvo.querySelector('#rota-sem-ant');
        if (bSemAnt) bSemAnt.addEventListener('click', function () { if (st.semSalvando) return; st.semanaIni = somaDias(semanaAlvo(), -7); st.msgSemana = ''; st.focoSem = '#rota-sem-ant'; desenhar(); });
        var bSemProx = alvo.querySelector('#rota-sem-prox');
        if (bSemProx) bSemProx.addEventListener('click', function () { if (st.semSalvando) return; st.semanaIni = somaDias(semanaAlvo(), 7); st.msgSemana = ''; st.focoSem = '#rota-sem-prox'; desenhar(); });
        var bSemPad = alvo.querySelector('#rota-sem-padrao');
        if (bSemPad) bSemPad.addEventListener('click', function () { if (st.semSalvando) return; st.semanaIni = null; st.msgSemana = ''; st.focoSem = '#rota-sem-prox'; desenhar(); });
        alvo.querySelectorAll('[data-rota-ir-sem]').forEach(function (b) {
            b.addEventListener('click', function () { if (st.semSalvando) return; st.semanaIni = b.getAttribute('data-rota-ir-sem'); st.msgSemana = ''; st.focoSem = '#rota-sem-topo-tit'; desenhar(); });
        });
        var bSemDescOutras = alvo.querySelector('#rota-sem-desc-outras');
        if (bSemDescOutras && sem) bSemDescOutras.addEventListener('click', function () { descartarOutrasSemanas(sem.inicio, bSemDescOutras); });
        var bSemSug = alvo.querySelector('#rota-sem-sugestao');
        if (bSemSug && sem) bSemSug.addEventListener('click', function () {
            if (st.semSalvando) return;
            limparRascunhoDaSemana(sem.inicio);
            st.msgSemana = 'Alterações não salvas desta semana descartadas.';
            st.focoSem = '#rota-sem-salvar';
            desenhar();
        });
        var bSemSalvar = alvo.querySelector('#rota-sem-salvar');
        if (bSemSalvar && sem) bSemSalvar.addEventListener('click', function () { salvarSemana(sem, false); });
        var bSemLimpar = alvo.querySelector('#rota-sem-limpar');
        if (bSemLimpar && sem) bSemLimpar.addEventListener('click', function () { salvarSemana(sem, true); });
        if (st.focoMapa) {
            st.focoMapa = false;
            if (btnMapa) btnMapa.focus();
        }
        if (st.focoVeiculo) {
            var alvoFoco = alvo.querySelector('[data-rota-veiculo="' + st.focoVeiculo + '"]');
            st.focoVeiculo = null;
            if (alvoFoco) alvoFoco.focus();
        }
        if (st.focoTirar) {
            var alvoTirar = alvo.querySelector('[data-rota-tirar="' + st.focoTirar + '"]');
            st.focoTirar = null;
            st.focoPedido = null;
            st.focoSem = null;
            st.focoFora = false;
            if (alvoTirar) alvoTirar.focus();
        } else if (st.focoRegra) {
            var alvoReg = alvo.querySelector('[data-rota-regra="' + st.focoRegra + '"]');
            st.focoRegra = null;
            st.focoPedido = null;
            st.focoSem = null;
            st.focoFora = false;
            if (alvoReg) alvoReg.focus();
        } else if (st.focoPedido) {
            var alvoPed = alvo.querySelector('[data-rota-marcar="' + st.focoPedido + '"]');
            st.focoPedido = null;
            if (alvoPed) { alvoPed.focus(); st.focoFora = false; st.focoSem = null; }
        }
        if (st.focoSem) {
            var fsSem = st.focoSem;
            st.focoSem = null;
            var elSem = fsSem.indexOf('ped:') === 0
                ? alvo.querySelector('[data-rota-sem-dia="' + fsSem.slice(4) + '"]')
                : alvo.querySelector(fsSem);
            if (!elSem || elSem.disabled) elSem = alvo.querySelector('#rota-sem-topo-tit');
            if (elSem) { if (!elSem.hasAttribute('tabindex') && elSem.tagName === 'P') elSem.setAttribute('tabindex', '-1'); elSem.focus(); }
        }
        if (st.focoFora) {   // 045: depois de tirar (ou voltar sem seletor visível) o foco vai para "Fora da rota" (ou o título)
            st.focoFora = false;
            var fs = alvo.querySelector('#rota-fora-sum') || alvo.querySelector('.rota-titulo');
            if (fs) { if (!fs.hasAttribute('tabindex') && fs.tagName !== 'SUMMARY') fs.setAttribute('tabindex', '-1'); fs.focus(); }
        }
        if (st.vista !== 'semana' && st.mapaAberto) desenharMapa(atual);
    }

    function imprimir() {
        document.body.classList.add('rota-imprimindo');
        var fim = function () { document.body.classList.remove('rota-imprimindo'); window.removeEventListener('afterprint', fim); };
        window.addEventListener('afterprint', fim);
        if (st.mapa) st.mapa.invalidateSize({ animate: false });
        window.print();
        setTimeout(fim, 1500);   // navegadores sem afterprint
    }

    raiz.TempRioRota = {
        // admin.js chama ao mostrar a aba (alvo = #painel-rotas). Carrega na 1ª vez; depois só redesenha.
        desenhar: function (alvo, ctx) {
            st.alvo = alvo; st.sb = ctx && ctx.sb; st.papel = ctx && ctx.papel; st.ativo = true;
            desenhar();
        },
        // ATUALIZAR do painel: relê tudo.
        recarregar: function () { if (st.alvo && st.ativo) recarregarTudo(); },
        // Sair da aba / do painel: solta mapa e observer e invalida a carga pendente (o .then confere st.seq e não
        // desenha). Ao voltar, o admin.js chama desenhar() de novo (a aba fica marcada para redesenho).
        encerrar: function () {
            liberarMapa();
            st.ativo = false;
            st.seq++;
            if (st.carregando) { st.carregando = false; st.carregado = false; }   // carga interrompida: refaz ao voltar
        },
        // Logout: além de encerrar, esquece dados e cliente (outra conta pode entrar na mesma aba do navegador).
        sair: function () {
            raiz.TempRioRota.encerrar();
            st.carregado = false; st.erro = null; st.pedidos = []; st.clientes = {}; st.coletado = null; st.sb = null; st.alvo = null;
            st.cfgLinha = null; st.cfg = cfgDe(CFG_PADRAO); st.excecoes = {}; st.msgVeiculo = ''; st.cfgAberto = false;
            st.v2 = false; st.podeMarcar = false; st.porPedido = {}; st.regras = {}; st.gravandoVeiculo = {}; st.seqVeiculo = {};
            st.focoVeiculo = null; st.focoPedido = null; st.focoRegra = null; st.regraSalvando = false; st.redesenhoPendente = false;
            st.mut = 0; st.recargaPendente = false; st.erroV2 = null; st.desatualizado = false; st.ultimoV2 = null; st.avisoPerm = null;
            st.mapaVista = {}; st.mapaAberto = false; st.focoMapa = false;
            st.ign045 = false; st.ignorados = {}; st.foraAberto = false; st.focoFora = false; st.focoTirar = null;
            st.pln046 = false; st.plano = {}; st.rascSemana = {}; st.semanaIni = null; st.semSalvando = false; st.msgSemana = ''; st.focoSem = null;
        },
        planejador: Planejador
    };
})(typeof window !== 'undefined' ? window : this);
