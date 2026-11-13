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
                    var erro = new Error('HTTP ' + resposta.status + ' ' + corpo.slice(0, 200));
                    // Limite de tentativas do banco (migração 032): HTTP 400 com {code:'TR429'}.
                    if (corpoEhLimite(corpo)) { erro.limite = true; erro.code = 'TR429'; }
                    // 409 + 23505 (chave duplicada): o registro com este id JÁ existe no servidor.
                    erro.status = resposta.status;
                    if (resposta.status === 409 && duplicadoDoProprio(corpo, linha && linha.id)) erro.duplicado = true;
                    throw erro;
                });
            }
            return true;
        });
    }

    /* ---- Anti-spam (migração 032) ---------------------------------------
     * 1) Campo-isca ("armadilha"): input de texto FORA da tela (position:absolute; left:-10000px), não display:none —
     *    robôs costumam preencher tudo que está no DOM, e display:none/hidden faz parte dos navegadores/gerenciadores
     *    de senha pularem ou tratarem o campo de outro jeito. aria-hidden + tabindex=-1 + autocomplete=off e um nome
     *    neutro ('campo_conferencia', sem email/url/phone/company) evitam autofill e não atrapalham leitor de tela nem
     *    teclado. Humano deixa vazio; o valor vai SEMPRE no insert da tabela principal (string vazia se humano).
     *    Nunca em visitas nem em RPCs.
     * 2) Limite: TR429 vira erro com .limite = true; cada formulário mostra MSG_LIMITE sem apagar o que foi digitado. */
    var NOME_ARMADILHA = 'campo_conferencia';
    var MSG_LIMITE = 'Recebemos muitas tentativas a partir da sua conexão. Aguarde alguns minutos e tente de novo.';

    function corpoCodigo(corpo) {
        try { var j = JSON.parse(corpo); return j && j.code ? String(j.code) : ''; } catch (e) { return ''; }
    }
    function corpoEhLimite(corpo) { return corpoCodigo(corpo) === 'TR429'; }

    // "Já gravado" SÓ quando é a chave primária do próprio pedido: code 23505 + constraint pedidos_pkey na mensagem + o id
    // enviado em details ('Key (id)=(<uuid>) already exists.'). Outro 23505 (ex.: unique de usuarios/clientes pelo trigger
    // de resolução de cliente) NÃO grava o pedido: é falha comum e o item continua na fila.
    function duplicadoDoProprio(corpo, id) {
        if (!id) return false;
        try {
            var j = JSON.parse(corpo);
            return !!j && String(j.code) === '23505' && String(j.message || '').indexOf('pedidos_pkey') >= 0 &&
                String(j.details || '').indexOf(String(id)) >= 0;
        } catch (e) { return false; }
    }
    function ehLimite(e) { return !!(e && e.limite); }

    function armadilhaDe(raiz) {
        var el = raiz && raiz.querySelector ? raiz.querySelector('input[name="' + NOME_ARMADILHA + '"]') : null;
        return el ? String(el.value || '') : '';
    }

    function adicionarArmadilha(raiz) {
        if (!raiz || !raiz.appendChild || raiz.querySelector('input[name="' + NOME_ARMADILHA + '"]')) return;
        var env = document.createElement('div');
        env.setAttribute('aria-hidden', 'true');
        var s = env.style;
        s.position = 'absolute'; s.left = '-10000px'; s.top = 'auto'; s.width = '1px'; s.height = '1px'; s.overflow = 'hidden';
        var rot = document.createElement('label');
        rot.textContent = 'Deixe em branco ';
        var inp = document.createElement('input');
        inp.type = 'text'; inp.name = NOME_ARMADILHA; inp.value = '';
        inp.tabIndex = -1; inp.setAttribute('autocomplete', 'off');
        rot.appendChild(inp); env.appendChild(rot); raiz.appendChild(env);
    }

    function comArmadilha(linha, valor) {
        linha.armadilha = typeof valor === 'string' ? valor : (typeof linha.armadilha === 'string' ? linha.armadilha : '');
        return linha;
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
    // UUID v4 gerado no cliente: é o id do pedido (pedidos.id é uuid PK; o anon pode informar). Com o mesmo id em todas as
    // tentativas, um reenvio de algo que já gravou volta 409/23505 (o banco desfaz o 2º insert) e vira "já gravado".
    function novoId() {
        var c = window.crypto;
        if (c && c.randomUUID) return c.randomUUID();
        var b = new Uint8Array(16);
        if (c && c.getRandomValues) c.getRandomValues(b); else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
        b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
        return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    }

    /* Fila local: UMA CHAVE POR PEDIDO ('temprio_pedido_pendente_<id>' = {enfileirado_em, pedido}). Adicionar = um setItem,
     * confirmar = um removeItem: sem ler-modificar-gravar, então duas abas nunca apagam o item uma da outra. */
    var PREFIXO_FILA = 'temprio_pedido_pendente_';

    function chaveTemPedido(texto, id) {
        try { var o = JSON.parse(texto); return !!o && !!o.pedido && o.pedido.id === id; } catch (e) { return false; }
    }
    // Devolve true só se o pedido está MESMO persistido na chave própria (relê e confere o id); chave já existente com o
    // mesmo id conta como sucesso e não é sobrescrita. Exceção (ex.: quota cheia) ou divergência = false.
    function filaAdicionar(pedido) {
        try {
            var k = PREFIXO_FILA + pedido.id, ja = localStorage.getItem(k);
            if (ja !== null) return chaveTemPedido(ja, pedido.id);
            localStorage.setItem(k, JSON.stringify({ enfileirado_em: Date.now(), pedido: pedido }));
            return chaveTemPedido(localStorage.getItem(k), pedido.id);
        } catch (e) { return false; }
    }
    function filaRemover(id) {
        try { localStorage.removeItem(PREFIXO_FILA + id); } catch (e) { /* ignora */ }
    }
    function filaChaves() {
        var ks = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(PREFIXO_FILA) === 0) ks.push(k);
            }
        } catch (e) { /* sem storage */ }
        return ks;
    }
    // Itens pendentes em ordem de enfileiramento: [{id, pedido}]. Entrada ilegível é ignorada (não apagada).
    function filaItens() {
        return filaChaves().map(function (k) {
            try {
                var o = JSON.parse(localStorage.getItem(k));
                return o && o.pedido && o.pedido.id ? { t: Number(o.enfileirado_em) || 0, id: o.pedido.id, pedido: o.pedido } : null;
            } catch (e) { return null; }
        }).filter(Boolean).sort(function (a, b) { return a.t - b.t; });
    }
    function filaTemPendencia() { return filaChaves().length > 0 || lerFila().length > 0; }

    // Grava o array legado (ou remove a chave quando vazio). false se o storage recusar (ex.: quota).
    function gravarFilaLegada(arr) {
        try {
            if (arr.length) localStorage.setItem(CHAVE_FILA, JSON.stringify(arr)); else localStorage.removeItem(CHAVE_FILA);
            return true;
        } catch (e) { return false; }
    }

    // Migra a fila antiga (um array numa chave só) SEM risco de perda:
    //  1) itens sem id ganham id e o array é REGRAVADO com esses ids; se isso falhar (quota) a migração ABORTA com o array
    //     intacto (tenta de novo na próxima carga, e rodadas futuras nunca recriam o pedido com id novo);
    //  2) cada item vai para a chave própria (filaAdicionar confere a gravação); só quando deu certo o id é retirado do array
    //     (releitura + regravação; se falhar, o item fica nos dois lugares com o MESMO id e o servidor deduplica);
    //  3) o array só some quando esvazia. Migração parcial: o que não foi transferido continua no array, com o mesmo id.
    // Duas abas antigas migrando juntas podem gerar 2 ids para o mesmo legado (pode duplicar uma vez; o envio original dele
    // já não tinha deduplicação possível).
    function migrarFilaLegada() {
        var antiga = lerFila().filter(Boolean);
        if (!antiga.length) return;
        if (antiga.some(function (p) { return !p.id; })) {
            antiga.forEach(function (p) { if (!p.id) p.id = novoId(); });
            if (!gravarFilaLegada(antiga)) return; // sem ids estáveis persistidos não migra: nada é removido
        }
        antiga.forEach(function (p) {
            if (!filaAdicionar(comArmadilha(p))) return;
            gravarFilaLegada(lerFila().filter(function (x) { return x && x.id !== p.id; }));
        });
    }

    function registrarPedido(pedido) {
        if (!cfg()) return Promise.resolve(false);

        if (!pedido.id) pedido.id = novoId();
        comArmadilha(pedido);
        return inserir('pedidos', pedido)
            .then(function () { return true; })
            .catch(function (e) {
                if (e && e.duplicado) return true; // já gravado
                // Falha (rede ou limite) vai para a fila COM o mesmo id; o pedido vale pelo WhatsApp.
                filaAdicionar(pedido);
                return ehLimite(e) ? 'limite' : false;
            });
    }

    var drenandoFila = false;

    // Em série; cada confirmação remove SÓ a chave daquele pedido. 409 do próprio pedido_pkey = já gravado (sai da fila);
    // TR429 para a drenagem e mantém o resto; qualquer outra falha mantém o item.
    function drenarFila() {
        migrarFilaLegada();
        var parou = false;
        return filaItens().reduce(function (ant, it) {
            return ant.then(function () {
                if (parou) return;
                if (localStorage.getItem(PREFIXO_FILA + it.id) === null) return; // outra aba já resolveu
                return inserir('pedidos', comArmadilha(it.pedido)).then(
                    function () { filaRemover(it.id); },
                    function (e) {
                        if (e && e.duplicado) filaRemover(it.id);
                        else if (ehLimite(e)) parou = true;
                    });
            });
        }, Promise.resolve());
    }

    // Uma drenagem por vez: flag na página + navigator.locks entre abas SÓ para single-flight (as mutações da fila são
    // chamadas únicas, sem lock). Sem navigator.locks: só a flag; duas abas drenando no máximo reenviam o mesmo id e o
    // servidor deduplica por pedidos_pkey.
    function reenviarPedidosPendentes() {
        if (drenandoFila || !cfg() || !filaTemPendencia()) return;
        drenandoFila = true;
        var fim = function () { drenandoFila = false; };
        if (window.navigator && navigator.locks && navigator.locks.request) {
            navigator.locks.request('temprio-fila-pedidos', { ifAvailable: true }, function (lock) {
                if (!lock) return; // outra aba está drenando
                return drenarFila();
            }).then(fim, fim);
        } else {
            drenarFila().then(fim, fim);
        }
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
        return inserir('lista_espera', comArmadilha(dados));
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
            sessao: sessao,
            armadilha: typeof dados.armadilha === 'string' ? dados.armadilha : ''
        }).then(function () {
            if (sessao) {
                completarVisita(sessao, {
                    preRegistro: { nome: dados.nome, telefone: dados.telefone, tipo_documento: dados.tipoDocumento }
                }).catch(function () { /* o lead já foi salvo; isto é só enriquecimento */ });
            }
            // O checkbox de consentimento já bloqueou o envio se não estava
            // marcado (js/pre-registro.js) — isto só registra QUANDO e com
            // qual versão da política, para existir prova depois. Nunca
            // desfaz o lead se falhar: a pessoa já autorizou, isso já vale.
            registrarConsentimento('pre_registro', dados.documento, dados.telefone, dados.armadilha)
                .catch(function () { /* consentimento é registro, não é o que garante o direito */ });
            return true;
        });
    }

    /* ===================================================================
     * LGPD — consentimento, direitos do titular (migração 015)
     * =================================================================== */
    var VERSAO_POLITICA_ATUAL = 'v2'; // muda quando o texto de /privacidade.html mudar de fato

    function registrarConsentimento(contexto, documento, telefone, armadilha) {
        if (!cfg()) return Promise.resolve(false);
        return inserir('consentimentos', {
            contexto: contexto,
            documento: String(documento || '').replace(/\D/g, ''),
            telefone: telefone || null,
            versao_politica: VERSAO_POLITICA_ATUAL,
            user_agent: navigator.userAgent || null,
            armadilha: typeof armadilha === 'string' ? armadilha : ''
        }).then(function () { return true; });
    }

    /* Pedido de acesso, correção ou exclusão — nunca é instantâneo (ver o
     * porquê na migração 015): isto só registra o pedido. Quem atende é o
     * admin, pela aba LGPD do painel. */
    function registrarSolicitacaoLgpd(tipo, documento, telefone, contato, mensagem, armadilha) {
        if (!cfg()) return Promise.reject(new Error('supabase nao configurado'));
        return inserir('solicitacoes_lgpd', {
            tipo: tipo,
            documento: String(documento || '').replace(/\D/g, ''),
            telefone: telefone || null,
            contato: contato || null,
            mensagem: mensagem || null,
            armadilha: typeof armadilha === 'string' ? armadilha : ''
        });
    }

    /* Direito de acesso: desde a migração 036 só REGISTRA o pedido (tipo
     * 'acesso' em solicitacoes_lgpd) e devolve {status, protocolo, prazo_dias},
     * igual exista ou não o cadastro. Nunca devolve dado pessoal. */
    function consultarMeusDados(documento, telefone) {
        var c = cfg();
        if (!c) return Promise.reject(new Error('supabase nao configurado'));

        return fetch(c.url.replace(/\/+$/, '') + '/rest/v1/rpc/lgpd_meus_dados', {
            method: 'POST',
            headers: {
                apikey: c.anonKey, Authorization: 'Bearer ' + c.anonKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                p_documento: String(documento || '').replace(/\D/g, ''),
                p_telefone: String(telefone || '').replace(/\D/g, '')
            })
        }).then(function (resposta) {
            if (!resposta.ok) {
                return resposta.text().then(function (t) {
                    var erro = new Error('HTTP ' + resposta.status + ' ' + t.slice(0, 200));
                    // Limite do antispam (032) também vale nesta RPC desde a 036.
                    if (corpoEhLimite(t)) { erro.limite = true; erro.code = 'TR429'; }
                    erro.status = resposta.status;
                    throw erro;
                });
            }
            return resposta.json(); // {status:'recebido', protocolo, prazo_dias}
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
        reenviarPedidosPendentes: reenviarPedidosPendentes,
        registrarSolicitacaoLgpd: registrarSolicitacaoLgpd,
        consultarMeusDados: consultarMeusDados,
        adicionarArmadilha: adicionarArmadilha,
        armadilhaDe: armadilhaDe,
        ehLimite: ehLimite,
        corpoEhLimite: corpoEhLimite,
        MSG_LIMITE: MSG_LIMITE
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
