/* Pop-up de pré-registro do catálogo.
 *
 * Diferente do convite da Vitrine (que só aparece DEPOIS de um pedido, como
 * cortesia), este aparece 3 segundos depois de o catálogo carregar — é
 * captação de contato, não recibo de cliente. Some sozinho depois da primeira
 * aparição: a marca de "já mostrei" fica no localStorage, então mesmo quem
 * fecha e reabre o navegador não vê de novo.
 *
 * Carregado no fim do body de catalogo.html, depois de js/db.js e
 * js/validadores.js.
 */
(function () {
    'use strict';

    var CHAVE_JA_MOSTROU = 'temprio.preRegistro.mostrado.v1';
    var V = window.Validadores;

    function jaMostrou() {
        try { return localStorage.getItem(CHAVE_JA_MOSTROU) === '1'; }
        catch (e) { return false; } // sem storage: melhor mostrar de novo do que nunca mostrar
    }

    function marcarComoMostrado() {
        try { localStorage.setItem(CHAVE_JA_MOSTROU, '1'); } catch (e) { /* sem rede de segurança, sem problema */ }
    }

    function esc(t) {
        return String(t == null ? '' : t)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* ===================================================================
     * Montagem
     * =================================================================== */
    var caixa = null;
    var tipoDocumentoAtual = 'cpf';

    function montar() {
        caixa = document.createElement('div');
        caixa.id = 'pre-registro';
        caixa.className = 'vitrine-fundo';
        caixa.innerHTML =
            '<div class="vitrine-painel">' +
                '<button type="button" id="pre-registro-fechar" aria-label="Fechar"' +
                    ' class="float-right -mt-1 -mr-1 w-8 h-8 rounded-full flex items-center justify-center' +
                    ' text-textSecondary hover:text-white hover:bg-white/10 transition-colors">' +
                    '<i class="fa-solid fa-xmark"></i>' +
                '</button>' +

                '<p class="text-[0.65rem] font-bold uppercase tracking-widest text-primary-400 mb-3">Antes de continuar</p>' +
                '<h2 class="text-2xl font-bold mb-3" style="font-family:\'Barlow Condensed\',sans-serif;">' +
                    'Quer que a gente te avise das novidades?</h2>' +
                '<p class="text-sm text-textSecondary font-light leading-relaxed mb-5">' +
                    'Deixa seu contato e a gente avisa sobre lançamentos e condições especiais. ' +
                    'Não é obrigatório para navegar ou pedir — só se você quiser.' +
                '</p>' +

                '<form id="form-pre-registro" novalidate class="space-y-4">' +
                    '<div class="campo" data-campo="nome">' +
                        '<label for="pr-nome" class="block text-xs font-bold uppercase tracking-widest text-textSecondary mb-2">Nome *</label>' +
                        '<input id="pr-nome" name="nome" type="text" autocomplete="name" class="campo-input" placeholder="Como podemos te chamar">' +
                        '<p class="campo-msg"></p>' +
                    '</div>' +

                    '<div class="campo" data-campo="telefone">' +
                        '<label for="pr-telefone" class="block text-xs font-bold uppercase tracking-widest text-textSecondary mb-2">Telefone (com DDD) *</label>' +
                        '<input id="pr-telefone" name="telefone" type="tel" inputmode="numeric" autocomplete="tel" class="campo-input" placeholder="(21) 99999-9999" maxlength="15">' +
                        '<p class="campo-msg"></p>' +
                        '<p class="campo-dica" id="pr-dica-ddd">Ótimo — esse DDD já está na nossa área de entrega.</p>' +
                    '</div>' +

                    '<div>' +
                        '<span class="block text-xs font-bold uppercase tracking-widest text-textSecondary mb-2">Você é *</span>' +
                        '<div class="flex gap-4 mb-3">' +
                            '<label class="flex items-center gap-2 text-sm cursor-pointer">' +
                                '<input type="radio" name="pr-tipo-doc" value="cpf" checked class="accent-primary-500 w-4 h-4">Pessoa física (CPF)</label>' +
                            '<label class="flex items-center gap-2 text-sm cursor-pointer">' +
                                '<input type="radio" name="pr-tipo-doc" value="cnpj" class="accent-primary-500 w-4 h-4">Empresa (CNPJ)</label>' +
                        '</div>' +
                        '<div class="campo" data-campo="documento">' +
                            '<input id="pr-documento" name="documento" type="text" inputmode="numeric" class="campo-input" placeholder="000.000.000-00" maxlength="14">' +
                            '<p class="campo-msg"></p>' +
                        '</div>' +
                    '</div>' +

                    '<label class="campo-check">' +
                        '<input type="checkbox" id="pr-consentimento">' +
                        '<span>Li e aceito os <a href="./privacidade.html" target="_blank" rel="noopener"' +
                            ' class="underline hover:text-primary-400">Termos e a Política de Privacidade</a>. ' +
                            'Autorizo a Temp Rio a guardar meus dados para contato — não compartilhamos com terceiros.</span>' +
                    '</label>' +
                    '<p class="campo-msg" id="pr-consentimento-erro"></p>' +

                    '<div class="flex flex-col sm:flex-row gap-3 pt-2">' +
                        '<button type="submit" id="pr-enviar" class="btn-primary flex-1 py-3 rounded-xl font-bold text-sm">' +
                            'Quero receber novidades</button>' +
                        '<button type="button" id="pr-depois" class="flex-1 py-3 rounded-xl border border-white/12 text-white/70' +
                            ' hover:text-white hover:border-white/25 transition-all text-sm font-bold">' +
                            'Continuar navegando</button>' +
                    '</div>' +
                '</form>' +
            '</div>';

        document.body.appendChild(caixa);
        window.ScrollLock.acquire('pre-registro');
        ligar();

        // Foco no primeiro campo: quem navega por teclado não precisa procurar.
        setTimeout(function () { document.getElementById('pr-nome').focus(); }, 50);
    }

    function fechar() {
        if (!caixa) return;
        window.ScrollLock.release('pre-registro');
        caixa.remove();
        caixa = null;
        marcarComoMostrado();
    }

    /* ===================================================================
     * Interação
     * =================================================================== */
    function placeholderDoDocumento() {
        return tipoDocumentoAtual === 'cpf' ? '000.000.000-00' : '00.000.000/0000-00';
    }

    function ligar() {
        document.getElementById('pre-registro-fechar').addEventListener('click', fechar);
        document.getElementById('pr-depois').addEventListener('click', fechar);

        // Clique fora do painel fecha — clique DENTRO não deve propagar e
        // fechar por engano (o painel para o clique antes de chegar aqui).
        caixa.addEventListener('click', function (ev) {
            if (ev.target === caixa) fechar();
        });

        document.addEventListener('keydown', function aoTeclar(ev) {
            if (ev.key === 'Escape' && caixa) fechar();
        });

        var campoTelefone = document.getElementById('pr-telefone');
        campoTelefone.addEventListener('input', function () {
            var cursor = this.selectionStart;
            var antes = this.value.length;
            this.value = V.mascararTelefone(this.value);
            this.selectionStart = this.selectionEnd = cursor + (this.value.length - antes);
            document.getElementById('pr-dica-ddd').classList.toggle(
                'is-visivel', V.telefoneValido(this.value) && V.telefoneEhDoRio(this.value));
        });

        var campoDocumento = document.getElementById('pr-documento');
        campoDocumento.addEventListener('input', function () {
            var cursor = this.selectionStart;
            var antes = this.value.length;
            this.value = tipoDocumentoAtual === 'cpf' ? V.mascararCpf(this.value) : V.mascararCnpj(this.value);
            this.selectionStart = this.selectionEnd = cursor + (this.value.length - antes);
        });

        document.querySelectorAll('input[name="pr-tipo-doc"]').forEach(function (r) {
            r.addEventListener('change', function () {
                tipoDocumentoAtual = this.value;
                campoDocumento.value = '';
                campoDocumento.maxLength = tipoDocumentoAtual === 'cpf' ? 14 : 18;
                campoDocumento.placeholder = placeholderDoDocumento();
                limparErro('documento');
            });
        });

        document.getElementById('form-pre-registro').addEventListener('submit', aoEnviar);
    }

    /* ===================================================================
     * Validação e envio
     * =================================================================== */
    function marcarErro(nomeCampo, mensagem) {
        var campo = document.querySelector('[data-campo="' + nomeCampo + '"]');
        if (!campo) return;
        campo.classList.add('is-erro');
        var msg = campo.querySelector('.campo-msg');
        if (msg) msg.textContent = mensagem;
    }

    function limparErro(nomeCampo) {
        var campo = document.querySelector('[data-campo="' + nomeCampo + '"]');
        if (campo) campo.classList.remove('is-erro');
    }

    function validar() {
        var ok = true;
        var nome = document.getElementById('pr-nome').value.trim();
        var telefone = document.getElementById('pr-telefone').value;
        var documento = document.getElementById('pr-documento').value;
        var consentimento = document.getElementById('pr-consentimento').checked;

        ['nome', 'telefone', 'documento'].forEach(limparErro);
        document.getElementById('pr-consentimento-erro').textContent = '';

        if (nome.length < 3) { marcarErro('nome', 'Informe pelo menos 3 letras do nome.'); ok = false; }
        if (!V.telefoneValido(telefone)) { marcarErro('telefone', 'Informe um telefone com DDD.'); ok = false; }
        if (!V.documentoValido(documento, tipoDocumentoAtual)) {
            marcarErro('documento', tipoDocumentoAtual === 'cpf' ? 'CPF inválido. Confira os números.' : 'CNPJ inválido. Confira os números.');
            ok = false;
        }
        if (!consentimento) {
            document.getElementById('pr-consentimento-erro').textContent = 'Precisamos da sua autorização para guardar o contato.';
            ok = false;
        }

        return ok ? { nome: nome, telefone: telefone, documento: V.soDigitos(documento),
                       tipoDocumento: tipoDocumentoAtual, dddRio: V.telefoneEhDoRio(telefone) } : null;
    }

    function aoEnviar(ev) {
        ev.preventDefault();
        var dados = validar();
        if (!dados) return;

        var botao = document.getElementById('pr-enviar');
        botao.disabled = true;
        botao.textContent = 'Enviando...';

        var salvo = window.TempRioDB && window.TempRioDB.configurado()
            ? window.TempRioDB.registrarPreRegistro(dados)
            : Promise.resolve(false);

        salvo
            .then(function () {
                fechar();
                if (window.CartUI && window.CartUI.toast) {
                    window.CartUI.toast('Obrigado! Vamos te avisar das novidades.');
                }
            })
            .catch(function () {
                botao.disabled = false;
                botao.textContent = 'Quero receber novidades';
                marcarErro('nome', ''); // limpa foco de erro anterior sem duplicar mensagem
                document.getElementById('pr-consentimento-erro').textContent =
                    'Não conseguimos salvar agora. Tente de novo em instantes.';
            });
    }

    /* ===================================================================
     * Disparo
     * =================================================================== */
    function iniciar() {
        if (jaMostrou()) return;
        setTimeout(function () {
            // Não mostra por cima de outro overlay já aberto (modal de
            // produto, carrinho) — os três segundos podem cair bem no meio
            // de alguém já decidindo alguma coisa.
            if (document.querySelector('.vitrine-fundo, #product-modal:not(.hidden), #cart-drawer.is-aberto')) return;
            montar();
        }, 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
