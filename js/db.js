/* Registro de pedidos e visitas no Supabase — lado público do site.
 *
 * Usa fetch direto na API REST em vez da biblioteca oficial: as páginas
 * públicas só precisam INSERIR, e um insert não justifica carregar 120 KB de
 * biblioteca em todo o site. O painel (admin.html) carrega a biblioteca, porque
 * lá tem login de verdade.
 *
 * Nada aqui LÊ dados. Mesmo que alguém tente, as políticas de RLS do banco
 * recusam leitura com a chave pública — ver admin/supabase.sql.
 *
 * Carregado no <head>, depois de js/config.js.
 */
(function () {
    'use strict';

    function cfg() {
        var s = (typeof siteConfig !== 'undefined' && siteConfig.supabase) || null;
        return (s && s.url && s.anonKey) ? s : null;
    }

    function inserir(tabela, linha) {
        var c = cfg();
        if (!c) return Promise.reject(new Error('supabase nao configurado'));

        return fetch(c.url.replace(/\/+$/, '') + '/rest/v1/' + tabela, {
            method: 'POST',
            headers: {
                'apikey': c.anonKey,
                'Authorization': 'Bearer ' + c.anonKey,
                'Content-Type': 'application/json',
                // Não devolve a linha criada: o site não tem permissão de ler,
                // e pedir retorno faria a requisição falhar por RLS.
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(linha)
        }).then(function (resposta) {
            // fetch não rejeita em erro de HTTP: sem esta checagem, um 401 por
            // política mal configurada passaria como sucesso.
            if (!resposta.ok) {
                return resposta.text().then(function (corpo) {
                    throw new Error('HTTP ' + resposta.status + ' ' + corpo.slice(0, 200));
                });
            }
            return true;
        });
    }

    /* Completar uma linha de visita depois de criada (segundos de sessão,
     * CEP consultado, pré-registro) NÃO é um PATCH direto — parece o caminho
     * óbvio, mas não funciona: no Postgres, um UPDATE sob Row Level Security
     * precisa de uma política de SELECT além da de UPDATE, porque é o SELECT
     * que decide quais linhas existem para o UPDATE mirar. Dar essa política
     * de SELECT deixaria qualquer visitante listar a visita de todo mundo
     * (ver o porquê em admin/migracoes/012_completar_visita_rpc.sql).
     *
     * A saída é a mesma já usada para aprovar vitrine: uma função do banco
     * com `security definer`, chamada aqui como RPC. Ela roda com os direitos
     * de quem criou a função — passa por cima do RLS por dentro, mas só faz
     * exatamente o que o corpo dela diz. Quem chama continua precisando saber
     * o `sessao` da visita; não ganha a capacidade de listar as dos outros.
     *
     * `manterVivo`: usa `keepalive`, que deixa a requisição terminar mesmo se
     * a aba fechar no meio — o substituto de `sendBeacon` para quando o corpo
     * não é um POST simples (o Beacon aceita, mas não deixa mandar os headers
     * de autenticação que a API do Supabase exige). */
    function completarVisita(sessao, campos, manterVivo) {
        var c = cfg();
        if (!c || !sessao) return Promise.resolve(false);

        var corpo = { p_sessao: sessao };
        if (campos.segundos != null) corpo.p_segundos = campos.segundos;
        if (campos.cep != null) corpo.p_cep = campos.cep;
        if (campos.preRegistro != null) corpo.p_pre_registro = campos.preRegistro;

        return fetch(c.url.replace(/\/+$/, '') + '/rest/v1/rpc/completar_visita', {
            method: 'POST',
            keepalive: !!manterVivo,
            headers: {
                'apikey': c.anonKey,
                'Authorization': 'Bearer ' + c.anonKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(corpo)
        }).then(function (resposta) {
            if (!resposta.ok) {
                return resposta.text().then(function (texto) {
                    throw new Error('HTTP ' + resposta.status + ' ' + texto.slice(0, 200));
                });
            }
            return true;
        });
    }

    /* ===================================================================
     * Visitas
     *
     * Mínimo possível: página, quando, e um id de sessão aleatório que vive
     * só enquanto a aba estiver aberta. Sem IP, sem cookie, sem nada que
     * identifique a pessoa — logo, sem aviso de cookies.
     * =================================================================== */
    function idDeSessao() {
        try {
            var id = sessionStorage.getItem('temprio.sessao');
            if (!id) {
                id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
                sessionStorage.setItem('temprio.sessao', id);
            }
            return id;
        } catch (e) {
            return null; // aba anônima: conta a visita sem sessão
        }
    }

    /* "google/direto/referencia": três baldes, não a URL inteira. Guardar a
     * URL de origem completa não ajudaria em nada que "de onde, largamente"
     * já não responda, e cresce a superfície de dado pessoal por nada — a URL
     * de referência às vezes carrega parâmetros de quem clicou (campanha,
     * e-mail marcado), que não são desta empresa para guardar. */
    function origemDaVisita() {
        var ref = document.referrer;
        if (!ref) return 'direto';
        try {
            var host = new URL(ref).hostname.replace(/^www\./, '');
            if (/(^|\.)google\./.test(host)) return 'google';
            if (/(^|\.)instagram\.com$/.test(host) || /(^|\.)facebook\.com$/.test(host)) return 'social';
            if (host === location.hostname) return 'direto'; // navegação interna, não é "vinda de fora"
            return 'referencia';
        } catch (e) {
            return 'referencia';
        }
    }

    /* Classificação de dispositivo já acontece no banco, a partir do
     * user_agent (gatilho visita_classificar, migração 007) — o site só
     * precisa mandar o dado bruto, sem duplicar a lógica aqui. */
    function registrarVisita() {
        if (!cfg()) return;

        var pagina = location.pathname.split('/').pop() || 'index.html';
        inserir('visitas', {
            pagina: pagina,
            sessao: idDeSessao(),
            user_agent: navigator.userAgent || null,
            referencia: origemDaVisita()
        }).catch(function () { /* medir visita nunca pode atrapalhar o site */ });

        medirTempoDeSessao();
    }

    /* Tempo de sessão: quando a aba fica oculta (troca de aba, minimiza,
     * fecha), manda o tempo decorrido para a MESMA linha da visita, filtrando
     * por `sessao`. `visibilitychange` e não `beforeunload`: no Safari do
     * iPhone, fechar a aba com o dedo frequentemente não dispara
     * `beforeunload`, e a sessão nunca seria medida — `visibilitychange`
     * dispara mesmo quando a pessoa só troca de app, o que é mais cedo mas
     * nunca falha em disparar. */
    function medirTempoDeSessao() {
        var sessao = idDeSessao();
        if (!sessao) return;

        var inicio = Date.now();
        var jaEnviado = false;

        function enviar() {
            if (jaEnviado) return;
            jaEnviado = true;
            var segundos = Math.round((Date.now() - inicio) / 1000);
            if (segundos < 1) return; // sessão instantânea não soma nada ao gráfico
            completarVisita(sessao, { segundos: segundos }, true)
                .catch(function () { /* mesma regra: medir nunca trava o site */ });
        }

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') enviar();
        });
        // Rede de segurança para quando visibilitychange não disparar mesmo
        // assim (raro, mas existe em alguns navegadores embutidos).
        window.addEventListener('pagehide', enviar);
    }

    /* ===================================================================
     * Pedidos
     * =================================================================== */
    var CHAVE_FILA = 'temprio.pedidos.fila.v1';

    function lerFila() {
        try { return JSON.parse(localStorage.getItem(CHAVE_FILA)) || []; }
        catch (e) { return []; }
    }

    function gravarFila(fila) {
        try { localStorage.setItem(CHAVE_FILA, JSON.stringify(fila)); }
        catch (e) { /* sem storage: perde-se a rede de segurança, não o pedido */ }
    }

    /* O pedido é registrado, mas o que vale para o cliente é a mensagem do
     * WhatsApp. Por isso uma falha aqui NUNCA pode travar o envio: o pedido
     * fica na fila e sobe na próxima visita. */
    function registrarPedido(pedido) {
        if (!cfg()) return Promise.resolve(false);

        return inserir('pedidos', pedido)
            .then(function () { return true; })
            .catch(function () {
                gravarFila(lerFila().concat([pedido]));
                return false;
            });
    }

    function reenviarPedidosPendentes() {
        var fila = lerFila();
        if (!fila.length || !cfg()) return;

        var restantes = [];
        Promise.all(fila.map(function (p) {
            return inserir('pedidos', p).catch(function () { restantes.push(p); });
        })).then(function () { gravarFila(restantes); });
    }

    /* ===================================================================
     * Lista de espera
     *
     * Mesma casa dos pedidos, de propósito: antes ela ia para uma planilha do
     * Google, e eram dois lugares para acompanhar. Quem já tiver a planilha
     * configurada continua sendo atendido pelo caminho antigo em js/pedido.js,
     * que só recorre a ela quando o banco não estiver disponível.
     * =================================================================== */
    function registrarEspera(dados) {
        if (!cfg()) return Promise.reject(new Error('supabase nao configurado'));
        return inserir('lista_espera', dados);
    }

    /* ===================================================================
     * Pré-registro (pop-up do catálogo)
     *
     * Grava em duas tabelas com papéis diferentes: `leads` guarda o contato
     * completo, com política própria de leitura para o painel; a mesma linha
     * de `visitas` que gerou o pop-up ganha um retrato compacto em
     * `pre_registro`, para cruzar "essa visita virou lead" sem duplicar dado
     * pessoal em dois lugares por extenso.
     *
     * Falha ao completar a visita não desfaz o lead — a pessoa preencheu o
     * formulário, isso já vale, mesmo que o PATCH de enriquecimento falhe.
     * =================================================================== */
    function registrarPreRegistro(dados) {
        if (!cfg()) return Promise.reject(new Error('supabase nao configurado'));

        var sessao = idDeSessao();
        var pagina = location.pathname.split('/').pop() || 'index.html';

        return inserir('leads', {
            nome: dados.nome,
            telefone: dados.telefone,
            documento: dados.documento,
            tipo_documento: dados.tipoDocumento,
            ddd_rio: !!dados.dddRio,
            pagina_origem: pagina,
            sessao: sessao
        }).then(function () {
            if (sessao) {
                completarVisita(sessao, {
                    preRegistro: { nome: dados.nome, telefone: dados.telefone, tipo_documento: dados.tipoDocumento }
                }).catch(function () { /* o lead já foi salvo; isto é só enriquecimento */ });
            }
            return true;
        });
    }

    /* Chamado por js/pedido.js quando o ViaCEP responde. É a única fonte de
     * região deste sistema (ver a nota grande em admin/migracoes/007 sobre
     * por que não é IP nem geolocalização) — sem isto, `visitas.cep` fica
     * vazio para sempre e o mapa do painel não tem o que mostrar. */
    function registrarCepConsultado(cep) {
        var sessao = idDeSessao();
        if (!sessao || !cep) return;
        completarVisita(sessao, { cep: String(cep).replace(/\D/g, '') })
            .catch(function () { /* enriquecimento; nunca trava a consulta de CEP */ });
    }

    window.TempRioDB = {
        configurado: function () { return !!cfg(); },
        registrarPedido: registrarPedido,
        registrarEspera: registrarEspera,
        registrarVisita: registrarVisita,
        registrarPreRegistro: registrarPreRegistro,
        registrarCepConsultado: registrarCepConsultado,
        reenviarPedidosPendentes: reenviarPedidosPendentes
    };

    // A visita é contada assim que a página carrega.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            registrarVisita();
            reenviarPedidosPendentes();
        });
    } else {
        registrarVisita();
        reenviarPedidosPendentes();
    }
})();
