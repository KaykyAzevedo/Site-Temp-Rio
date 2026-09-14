/* Página /privacidade.html — formulário de exercício de direitos da LGPD.
 *
 * Três tipos, comportamento bem diferente entre eles (ver a nota grande na
 * migração 015 sobre por que):
 *
 *   - "acesso": só lê. Chama lgpd_meus_dados() na hora e mostra o resultado
 *     na própria página — nenhum humano precisa mediar.
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

    var BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    var STATUS_ROTULO = { aguardando: 'Aguardando', confirmado: 'Confirmado', entregue: 'Entregue', cancelado: 'Cancelado' };

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

        var rotuloBotao = { acesso: 'Consultar meus dados', correcao: 'Enviar pedido de correção', exclusao: 'Pedir exclusão dos meus dados' };
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

    function renderizarMeusDados(dados) {
        if (!dados) {
            return '<div class="cart-aviso p-4 text-sm">' +
                'Não encontramos um cadastro com esse CPF/CNPJ e telefone juntos. ' +
                'Confira se são exatamente os dados que você usou ao pedir ou se pré-cadastrar — ' +
                'ou fale com a gente pelo WhatsApp.</div>';
        }

        var cad = dados.cadastro || {};
        var html = '<div class="cart-line p-5 space-y-4">' +
            '<div><p class="text-xs uppercase tracking-widest text-textSecondary mb-1">Cadastro</p>' +
            '<p class="text-sm text-white">' + esc(cad.nome || '—') + '</p>' +
            '<p class="text-sm text-textSecondary">' + esc(cad.email || 'sem e-mail') + ' · ' + esc(cad.telefone || '—') + '</p></div>';

        if (dados.endereco && dados.endereco.length) {
            html += '<div><p class="text-xs uppercase tracking-widest text-textSecondary mb-1">Endereço</p>' +
                dados.endereco.map(function (e) {
                    return '<p class="text-sm text-textSecondary">' +
                        esc([e.logradouro, e.numero].filter(Boolean).join(', ')) + ' — ' +
                        esc([e.bairro, e.cidade, e.uf].filter(Boolean).join('/')) + '</p>';
                }).join('') + '</div>';
        }

        if (dados.pedidos && dados.pedidos.length) {
            html += '<div><p class="text-xs uppercase tracking-widest text-textSecondary mb-2">Pedidos (' + dados.pedidos.length + ')</p>' +
                '<div class="space-y-1.5 max-h-56 overflow-y-auto">' +
                dados.pedidos.map(function (p) {
                    return '<div class="flex items-center justify-between text-sm" style="border-bottom:1px solid rgba(255,255,255,.06);padding-bottom:.35rem">' +
                        '<span class="text-textSecondary">' + esc(new Date(p.data).toLocaleDateString('pt-BR')) + '</span>' +
                        '<span class="text-white">' + esc(BRL.format((p.valor_centavos || 0) / 100)) + '</span>' +
                        '<span class="text-textSecondary">' + esc(STATUS_ROTULO[p.status] || p.status) + '</span>' +
                        '</div>';
                }).join('') + '</div></div>';
        } else {
            html += '<p class="text-sm text-textSecondary">Nenhum pedido fechado ainda.</p>';
        }

        html += '</div>';
        return html;
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
                .then(function (resultado) {
                    $('#lgpd-resultado').innerHTML = renderizarMeusDados(resultado);
                });
        } else {
            acao = window.TempRioDB.registrarSolicitacaoLgpd(
                tipoAtual, dados.documento, dados.telefone, dados.contato, dados.mensagem
            ).then(function () {
                $('#lgpd-resultado').innerHTML = '<div class="cart-line p-4 text-sm text-white">' +
                    '<i class="fa-solid fa-circle-check text-green-400 mr-1"></i> ' +
                    'Pedido registrado. Vamos confirmar sua identidade e responder pelo contato informado ' +
                    '(ou pelo telefone/e-mail já cadastrado), o mais rápido possível.</div>';
                $('#form-lgpd').reset();
            });
        }

        acao
            .catch(function () {
                $('#lgpd-resultado').innerHTML = '<div class="cart-aviso p-4 text-sm">' +
                    'Não conseguimos processar agora. Tente de novo em instantes, ou fale com a gente pelo WhatsApp.</div>';
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
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
