/* Página /privacidade.html — formulário de exercício de direitos da LGPD.
 *
 * Três tipos, comportamento bem diferente entre eles (ver a nota grande na
 * migração 015 sobre por que):
 *
 *   - "acesso": desde a migração 036 também é PEDIDO. lgpd_meus_dados() só
 *     registra a solicitação e devolve um protocolo genérico (nunca dado
 *     pessoal, nem se o documento existe); a equipe responde em até 15 dias.
 *   - "correcao" e "exclusao": entram como PEDIDO em solicitacoes_lgpd. O
 *     admin atende depois de confirmar quem é a pessoa — não tem como
 *     validar identidade o bastante, sem login, para uma ação irreversível
 *     rodar sozinha.
 *
 * Carregado no fim do body de privacidade.html, depois de js/main.js.
 */
(function () {
    'use strict';

    var V = window.Validadores;
    var tipoAtual = 'acesso';

    function $(sel) { return document.querySelector(sel); }

    function esc(t) {
        return String(t == null ? '' : t)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* ===================================================================
     * Alternar entre os três tipos
     * =================================================================== */
    function selecionarTipo(tipo) {
        tipoAtual = tipo;
        document.querySelectorAll('.lgpd-tab').forEach(function (b) {
            b.classList.toggle('is-ativo', b.getAttribute('data-lgpd-tipo') === tipo);
        });

        $('#lgpd-campo-contato').classList.toggle('hidden', tipo === 'acesso');
        $('#lgpd-campo-mensagem').classList.toggle('hidden', tipo !== 'correcao');
        $('#lgpd-aviso-exclusao').hidden = tipo !== 'exclusao';
        $('#lgpd-mensagem-label').textContent = 'O que precisa corrigir?';
        $('#lgpd-resultado').innerHTML = '';

        var rotuloBotao = { acesso: 'Pedir meus dados', correcao: 'Enviar pedido de correção', exclusao: 'Pedir exclusão dos meus dados' };
        $('#lgpd-enviar').textContent = rotuloBotao[tipo];
    }

    /* ===================================================================
     * Máscaras (mesmos validadores do pop-up de pré-registro)
     * =================================================================== */
    function ligarMascaras() {
        var campoDoc = $('#lgpd-documento');
        campoDoc.addEventListener('input', function () {
            var cursor = this.selectionStart, antes = this.value.length;
            // Sem saber se é CPF ou CNPJ de antemão: decide pelo tamanho de dígitos já digitados.
            var digitos = V.soDigitos(this.value);
            this.value = digitos.length > 11 ? V.mascararCnpj(this.value) : V.mascararCpf(this.value);
            this.selectionStart = this.selectionEnd = cursor + (this.value.length - antes);
        });

        var campoTel = $('#lgpd-telefone');
        campoTel.addEventListener('input', function () {
            var cursor = this.selectionStart, antes = this.value.length;
            this.value = V.mascararTelefone(this.value);
            this.selectionStart = this.selectionEnd = cursor + (this.value.length - antes);
        });
    }

    /* ===================================================================
     * Envio
     * =================================================================== */
    function marcarErro(nomeCampo, msg) {
        var campo = document.querySelector('[data-campo="' + nomeCampo + '"]');
        if (!campo) return;
        campo.classList.add('is-erro');
        var alvo = campo.querySelector('.campo-msg');
        if (alvo) alvo.textContent = msg;
    }

    function limparErros() {
        document.querySelectorAll('#form-lgpd .campo').forEach(function (c) {
            c.classList.remove('is-erro');
            var alvo = c.querySelector('.campo-msg');
            if (alvo) alvo.textContent = '';
        });
    }

    function validar() {
        var documento = $('#lgpd-documento').value;
        var telefone = $('#lgpd-telefone').value;
        var tipoDoc = V.soDigitos(documento).length > 11 ? 'cnpj' : 'cpf';
        var ok = true;

        limparErros();

        if (!V.documentoValido(documento, tipoDoc)) {
            marcarErro('documento', 'CPF ou CNPJ inválido. Confira os números.');
            ok = false;
        }
        if (!V.telefoneValido(telefone)) {
            marcarErro('telefone', 'Informe o telefone com DDD, do jeito que foi cadastrado.');
            ok = false;
        }
        if (tipoAtual === 'correcao' && !$('#lgpd-mensagem').value.trim()) {
            marcarErro('mensagem', 'Conte o que precisa corrigir.');
            ok = false;
        }

        return ok ? { documento: documento, telefone: telefone,
                       contato: $('#lgpd-contato').value.trim(),
                       mensagem: $('#lgpd-mensagem').value.trim() } : null;
    }

    /* Desde a 036 a resposta é sempre a mesma, exista ou não o cadastro:
     * só o protocolo muda. Nunca mostra dado pessoal. */
    function renderizarPedidoAcesso(resposta) {
        var protocolo = resposta && resposta.protocolo ? ' Protocolo: <strong>' + esc(resposta.protocolo) + '</strong>.' : '';
        var prazo = (resposta && resposta.prazo_dias) || 15;
        return '<div class="cart-line p-4 text-sm text-white">' +
            '<i class="fa-solid fa-circle-check text-green-400 mr-1"></i> ' +
            'Recebemos seu pedido; a equipe responderá em até ' + esc(prazo) + ' dias, ' +
            'pelo telefone ou e-mail do seu cadastro, depois de confirmar sua identidade.' + protocolo + '</div>';
    }

    function aoEnviar(ev) {
        ev.preventDefault();
        var dados = validar();
        if (!dados) return;

        var botao = $('#lgpd-enviar');
        var textoOriginal = botao.textContent;
        botao.disabled = true;
        botao.textContent = 'Um momento...';
        $('#lgpd-resultado').innerHTML = '';

        var acao;
        if (tipoAtual === 'acesso') {
            acao = window.TempRioDB.consultarMeusDados(dados.documento, dados.telefone)
                .then(function (resposta) {
                    $('#lgpd-resultado').innerHTML = renderizarPedidoAcesso(resposta);
                    $('#form-lgpd').reset();
                });
        } else {
            acao = window.TempRioDB.registrarSolicitacaoLgpd(
                tipoAtual, dados.documento, dados.telefone, dados.contato, dados.mensagem,
                window.TempRioDB.armadilhaDe($('#form-lgpd'))
            ).then(function () {
                $('#lgpd-resultado').innerHTML = '<div class="cart-line p-4 text-sm text-white">' +
                    '<i class="fa-solid fa-circle-check text-green-400 mr-1"></i> ' +
                    'Pedido registrado. Vamos confirmar sua identidade e responder pelo contato informado ' +
                    '(ou pelo telefone/e-mail já cadastrado), o mais rápido possível.</div>';
                $('#form-lgpd').reset();
            });
        }

        acao
            .catch(function (e) {
                $('#lgpd-resultado').innerHTML = '<div class="cart-aviso p-4 text-sm">' +
                    (window.TempRioDB.ehLimite(e) ? window.TempRioDB.MSG_LIMITE
                        : 'Não conseguimos processar agora. Tente de novo em instantes, ou fale com a gente pelo WhatsApp.') + '</div>';
            })
            .then(function () {
                botao.disabled = false;
                botao.textContent = textoOriginal;
            });
    }

    function iniciar() {
        if (!V) return; // js/validadores.js não carregou; sem ele não valida nada com segurança

        document.querySelectorAll('.lgpd-tab').forEach(function (b) {
            b.addEventListener('click', function () { selecionarTipo(b.getAttribute('data-lgpd-tipo')); });
        });
        ligarMascaras();
        $('#form-lgpd').addEventListener('submit', aoEnviar);
        if (window.TempRioDB) window.TempRioDB.adicionarArmadilha($('#form-lgpd'));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
