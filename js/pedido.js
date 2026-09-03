/* Página de pedido: revisão, dados do cliente e envio pelo WhatsApp.
 *
 * REGRA DE SEGURANÇA: o resto do site monta HTML com innerHTML a partir de
 * dados confiáveis (catálogo). Aqui NÃO: tudo que o cliente digitou volta para
 * a tela por textContent ou .value, nunca por innerHTML.
 */
(function () {
    'use strict';

    var UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
               'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

    var CHAVE_RASCUNHO = 'temprio.checkout.v1';

    // Orçamento da URL do WhatsApp. O navegador aguenta mais, mas o repasse
    // para o aplicativo trunca bem antes — e em silêncio.
    var LIMITE_URL = 1800;

    // Faixa de diacríticos montada em tempo de execução, para não depender de
    // escapes unicode no código-fonte.
    var DIACRITICOS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

    function semAcento(texto) {
        return String(texto == null ? '' : texto).normalize('NFD').replace(DIACRITICOS, '');
    }

    // O que a pessoa digitou volta para a tela; escapar é obrigatório aqui.
    function esc(texto) {
        return String(texto == null ? '' : texto)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function $(sel) { return document.querySelector(sel); }
    function campoDe(nome) { return document.querySelector('[data-campo="' + nome + '"]'); }
    function inputDe(nome) { return document.getElementById('f-' + nome); }

    /* ===================================================================
     * Máscaras
     * =================================================================== */
    function mascararTelefone(v) {
        var d = v.replace(/\D/g, '').slice(0, 11);
        if (d.length <= 2) return d.length ? '(' + d : '';
        if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
        if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
        return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    }

    function mascararCep(v) {
        var d = v.replace(/\D/g, '').slice(0, 8);
        return d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
    }

    function mascararCnpj(v) {
        var d = v.replace(/\D/g, '').slice(0, 14);
        if (d.length <= 2) return d;
        if (d.length <= 5) return d.slice(0, 2) + '.' + d.slice(2);
        if (d.length <= 8) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5);
        if (d.length <= 12) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8);
        return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
    }

    /* CNPJ com dígitos verificadores. Um campo que aceita qualquer número não
     * serve para emitir nota: o erro só apareceria no faturamento. */
    function cnpjValido(valor) {
        var c = String(valor).replace(/\D/g, '');
        if (c.length !== 14) return false;
        if (/^(\d)\1{13}$/.test(c)) return false; // 00000000000000 e afins

        function digito(base) {
            var peso = base.length - 7;
            var soma = 0;
            for (var i = 0; i < base.length; i++) {
                soma += Number(base.charAt(i)) * peso--;
                if (peso < 2) peso = 9;
            }
            var resto = soma % 11;
            return resto < 2 ? 0 : 11 - resto;
        }

        return digito(c.slice(0, 12)) === Number(c.charAt(12)) &&
               digito(c.slice(0, 13)) === Number(c.charAt(13));
    }

    /* ===================================================================
     * Validação
     *
     * Vermelho é exclusivo de erro de campo. Avisos não bloqueantes usam o
     * laranja da marca (.cart-aviso).
     * =================================================================== */
    var REGRAS = {
        razaoSocial: {
            obrigatorio: true,
            testa: function (v) { return v.trim().length >= 3; },
            msg: 'Informe a razão social da empresa.'
        },
        cnpj: {
            obrigatorio: true,
            testa: function (v) { return cnpjValido(v); },
            msg: 'CNPJ inválido. Confira os números.'
        },
        inscricaoEstadual: {
            obrigatorio: true,
            // Só o formato. Cada um dos 27 estados tem seu próprio algoritmo de
            // dígito verificador, e implementá-los é fonte conhecida de recusa
            // indevida — barraria cliente legítimo por causa de uma regra
            // estadual mal replicada. Isenção é opção explícita, não campo vazio.
            testa: function (v) {
                if (isentoDeIE()) return true;
                var d = v.replace(/\D/g, '');
                return d.length >= 8 && d.length <= 14;
            },
            msg: 'Informe a inscrição estadual (8 a 14 dígitos) ou marque isenta.'
        },
        nome: {
            obrigatorio: true,
            testa: function (v) { return v.trim().length >= 3; },
            msg: 'Informe o nome do responsável.'
        },
        telefone: {
            obrigatorio: true,
            testa: function (v) { var d = v.replace(/\D/g, ''); return d.length === 10 || d.length === 11; },
            msg: 'Informe um telefone com DDD.'
        },
        email: {
            obrigatorio: true,
            // Pragmático, não RFC: melhor aceitar um endereço estranho do que
            // barrar um cliente real.
            testa: function (v) { return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim()); },
            msg: 'Informe um e-mail válido.'
        },
        cep: {
            obrigatorio: true,
            testa: function (v) { return v.replace(/\D/g, '').length === 8; },
            msg: 'Informe um CEP com 8 dígitos.'
        },
        logradouro: { obrigatorio: true, testa: naoVazio, msg: 'Campo obrigatório.' },
        numero: { obrigatorio: true, testa: naoVazio, msg: 'Informe o número ou S/N.' },
        bairro: { obrigatorio: true, testa: naoVazio, msg: 'Campo obrigatório.' },
        cidade: { obrigatorio: true, testa: naoVazio, msg: 'Campo obrigatório.' },
        uf: {
            obrigatorio: true,
            testa: function (v) { return UFS.indexOf(v) !== -1; },
            msg: 'Selecione o estado.'
        }
    };

    function naoVazio(v) { return v.trim().length > 0; }

    function isentoDeIE() {
        var caixa = document.getElementById('f-ieIsento');
        return !!(caixa && caixa.checked);
    }

    /* Isenta: trava o campo com o valor que vai para a nota, em vez de deixar
     * em branco. "ISENTO" é o que o vendedor precisa ler no pedido. */
    function aplicarIsencaoIE() {
        var campo = inputDe('inscricaoEstadual');
        if (!campo) return;

        if (isentoDeIE()) {
            campo.dataset.anterior = campo.value.replace(/ISENTO/i, '');
            campo.value = 'ISENTO';
            campo.disabled = true;
        } else {
            campo.disabled = false;
            if (campo.value === 'ISENTO') campo.value = campo.dataset.anterior || '';
        }
        validarCampo('inscricaoEstadual');
    }

    var tocados = Object.create(null);

    function validarCampo(nome, forcar) {
        var regra = REGRAS[nome];
        if (!regra) return true;

        var input = inputDe(nome);
        var wrapper = campoDe(nome);
        if (!input || !wrapper) return true;

        var ok = regra.testa(input.value);

        // Só pinta de vermelho o que a pessoa já tocou ou o que falhou no envio.
        if (!ok && (forcar || tocados[nome])) {
            wrapper.classList.add('is-erro');
            wrapper.querySelector('.campo-msg').textContent = regra.msg;
        } else {
            wrapper.classList.remove('is-erro');
        }
        return ok;
    }

    function validarTudo() {
        var invalidos = [];
        Object.keys(REGRAS).forEach(function (nome) {
            if (!validarCampo(nome, true)) invalidos.push(nome);
        });
        return invalidos;
    }

    /* ===================================================================
     * Rascunho do formulário
     * =================================================================== */
    var CAMPOS = ['razaoSocial', 'cnpj', 'inscricaoEstadual', 'nome', 'telefone', 'email',
                  'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf',
                  'observacoes'];

    function lerFormulario() {
        var d = {};
        CAMPOS.forEach(function (n) {
            var el = inputDe(n);
            d[n] = el ? el.value.trim() : '';
        });
        return d;
    }

    function salvarRascunho() {
        var dados = lerFormulario();
        dados.ieIsento = isentoDeIE();
        try { localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(dados)); }
        catch (e) { /* storage indisponível: o formulário funciona igual */ }
    }

    function carregarRascunho() {
        var bruto;
        try { bruto = localStorage.getItem(CHAVE_RASCUNHO); }
        catch (e) { return; }
        if (!bruto) return;

        var d;
        try { d = JSON.parse(bruto); } catch (e) { return; }
        if (!d || typeof d !== 'object') return;

        var caixa = document.getElementById('f-ieIsento');
        if (caixa) caixa.checked = !!d.ieIsento;

        CAMPOS.forEach(function (n) {
            var el = inputDe(n);
            if (el && typeof d[n] === 'string') el.value = d[n];
        });

        aplicarIsencaoIE();
        atualizarAvisoEntrega();
    }

    /* ===================================================================
     * ViaCEP
     * =================================================================== */
    var cacheCep = Object.create(null);
    var ultimoCep = '';

    function dicaCep(texto, alerta) {
        var el = $('#dica-cep');
        el.textContent = texto || '';
        el.classList.toggle('is-visivel', !!texto);
        el.classList.toggle('is-alerta', !!alerta);
    }

    function buscarCep() {
        var digitos = inputDe('cep').value.replace(/\D/g, '');
        if (digitos.length !== 8 || digitos === ultimoCep) return;
        ultimoCep = digitos;

        if (cacheCep[digitos]) { aplicarEndereco(cacheCep[digitos]); return; }

        dicaCep('Buscando endereço...');

        // O ViaCEP não tem SLA. Uma promessa pendurada não pode travar o envio.
        var abortador = new AbortController();
        var expirou = setTimeout(function () { abortador.abort(); }, 6000);

        // Só o CEP viaja: nenhum dado pessoal sai desta página.
        fetch('https://viacep.com.br/ws/' + digitos + '/json/', { signal: abortador.signal })
            .then(function (r) { return r.json(); })
            .then(function (dados) {
                clearTimeout(expirou);
                if (dados && dados.erro) {
                    dicaCep('');
                    tocados.cep = true;
                    campoDe('cep').classList.add('is-erro');
                    campoDe('cep').querySelector('.campo-msg').textContent =
                        'CEP não encontrado. Preencha o endereço manualmente.';
                    return;
                }
                cacheCep[digitos] = dados;
                aplicarEndereco(dados);
            })
            .catch(function () {
                clearTimeout(expirou);
                // Laranja, não vermelho: falha de rede não é erro do cliente.
                dicaCep('Não conseguimos consultar o CEP agora. Preencha o endereço manualmente.', true);
            });
    }

    function aplicarEndereco(dados) {
        // Preserva o que a pessoa já digitou em número e complemento.
        if (dados.logradouro) inputDe('logradouro').value = dados.logradouro;
        if (dados.bairro) inputDe('bairro').value = dados.bairro;
        if (dados.localidade) inputDe('cidade').value = dados.localidade;
        if (dados.uf) inputDe('uf').value = dados.uf;

        ['logradouro', 'bairro', 'cidade', 'uf'].forEach(function (n) { validarCampo(n); });
        dicaCep('Endereço preenchido pelo CEP.');
        atualizarAvisoEntrega();
        salvarRascunho();

        var numero = inputDe('numero');
        if (numero && !numero.value.trim()) numero.focus();
    }

    /* ===================================================================
     * Aviso de entrega — o FAQ do site já promete isto
     * =================================================================== */
    function ufsAtendidas() {
        return (siteConfig.entrega && siteConfig.entrega.ufsAtendidas) || ['RJ'];
    }

    // Sem UF ainda, não bloqueia nada: só depois que o CEP resolve é que dá
    // para julgar. O padrão é "atende", para nunca travar quem não preencheu.
    function atendeEndereco() {
        var uf = inputDe('uf').value;
        if (!uf) return true;
        return ufsAtendidas().indexOf(uf) !== -1;
    }

    function atualizarAvisoEntrega() {
        var uf = inputDe('uf').value;
        var box = $('#aviso-entrega');
        if (!uf) { box.classList.add('hidden'); return; }

        box.classList.remove('hidden');
        box.textContent = atendeEndereco()
            ? (siteConfig.entrega && siteConfig.entrega.prazoAtendido) ||
              'Entrega em até 7 dias em todo o estado do Rio de Janeiro.'
            : 'Ainda não entregamos nesse endereço — veja as opções no resumo ao lado.';

        render(); // o resumo muda de cara quando o endereço sai da área
    }

    /* ===================================================================
     * Lista de espera
     *
     * O site é estático: o cadastro precisa de um destino externo, senão o
     * dado morre no navegador do cliente e nunca chega ao painel. Vai para
     * uma planilha do Google, via script publicado (ver admin/LEIAME.md).
     * =================================================================== */
    var CHAVE_FILA = 'temprio.espera.fila.v1';

    function endpointEspera() {
        return (siteConfig.listaEspera && siteConfig.listaEspera.endpoint) || '';
    }

    function lerFila() {
        try { return JSON.parse(localStorage.getItem(CHAVE_FILA)) || []; }
        catch (e) { return []; }
    }

    function gravarFila(fila) {
        try { localStorage.setItem(CHAVE_FILA, JSON.stringify(fila)); }
        catch (e) { /* sem storage: perde-se a rede de segurança, não o fluxo */ }
    }

    /* text/plain evita o preflight do CORS. O Apps Script não responde a
     * OPTIONS, então uma requisição "simples" é a única que passa direto. */
    function postarEspera(dados) {
        var url = endpointEspera();
        if (!url) return Promise.reject(new Error('sem endpoint'));

        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(dados)
        }).then(function (resposta) {
            // fetch NÃO rejeita em erro de HTTP: um 500 chega aqui como sucesso.
            // Sem esta checagem, uma falha do script viraria "cadastro
            // confirmado" e o interessado se perderia em silêncio.
            if (resposta.type === 'opaque') return true; // sem como inspecionar
            if (!resposta.ok) throw new Error('HTTP ' + resposta.status);

            return resposta.text().then(function (corpo) {
                var json = null;
                try { json = JSON.parse(corpo); } catch (e) { return true; }
                if (json && json.ok === false) throw new Error(json.erro || 'recusado');
                return true;
            });
        });
    }

    /* Reenvia o que ficou preso numa falha de rede anterior. Roda no
     * carregamento da página: se a pessoa voltar, o cadastro dela sobe. */
    function reenviarPendentes() {
        var fila = lerFila();
        if (!fila.length || !endpointEspera()) return;

        var restantes = [];
        var pendencias = fila.map(function (item) {
            return postarEspera(item).catch(function () { restantes.push(item); });
        });
        Promise.all(pendencias).then(function () { gravarFila(restantes); });
    }

    function dadosDaEspera() {
        var d = lerFormulario();
        var t = Cart.totais();
        return {
            enviadoEm: new Date().toISOString(),
            razaoSocial: d.razaoSocial,
            cnpj: d.cnpj,
            inscricaoEstadual: d.inscricaoEstadual,
            responsavel: d.nome,
            telefone: d.telefone,
            email: d.email,
            cep: d.cep,
            cidade: d.cidade,
            uf: d.uf,
            endereco: d.logradouro + ', ' + d.numero +
                      (d.complemento ? ' - ' + d.complemento : '') + ' - ' + d.bairro,
            // O tamanho do pedido perdido é o dado mais útil do painel: mostra
            // quanta demanda está represada em cada praça.
            potes: t.potes,
            caixas: t.caixas,
            valor: Cart.formatarBRL(t.valorCentavos),
            itens: Cart.itens().map(function (i) { return i.nome + ' ' + i.potes; }).join(', '),
            observacoes: d.observacoes
        };
    }

    /* Monta a linha do pedido para o banco. Os nomes das colunas seguem o
     * padrão do Postgres (minúsculas com underscore), não o do formulário. */
    function pedidoParaBanco() {
        var d = lerFormulario();
        var t = Cart.totais();
        return {
            razao_social: d.razaoSocial,
            cnpj: d.cnpj,
            inscricao_estadual: d.inscricaoEstadual,
            responsavel: d.nome,
            telefone: d.telefone,
            email: d.email,
            cep: d.cep,
            logradouro: d.logradouro,
            numero: d.numero,
            complemento: d.complemento,
            bairro: d.bairro,
            cidade: d.cidade,
            uf: d.uf,
            potes: t.potes,
            caixas: t.caixas,
            valor_centavos: t.valorCentavos,
            // Guarda o pedido item a item: sem isso o painel mostraria só o
            // total, e você não saberia quais sabores saem mais.
            itens: Cart.itens().map(function (i) {
                return { id: i.id, nome: i.nome, potes: i.potes, caixas: i.descricaoCaixas };
            }),
            observacoes: d.observacoes
        };
    }

    var enviandoEspera = false;

    function entrarNaListaDeEspera() {
        if (enviandoEspera) return;

        var invalidos = validarTudo();
        if (invalidos.length) {
            var primeiro = inputDe(invalidos[0]);
            if (primeiro) {
                primeiro.focus();
                primeiro.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            CartUI.toast('Complete seus dados para entrar na lista.');
            return;
        }

        var dados = dadosDaEspera();
        var botao = $('#btn-espera');
        enviandoEspera = true;
        if (botao) {
            botao.disabled = true;
            botao.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';
        }

        if (!endpointEspera()) {
            // Ainda não configurado: guarda para subir depois e avisa sem mentir.
            gravarFila(lerFila().concat([dados]));
            enviandoEspera = false;
            mostrarEsperaSalvaLocal();
            return;
        }

        postarEspera(dados)
            .then(function () {
                enviandoEspera = false;
                marcarEsperaConfirmada();
            })
            .catch(function () {
                // Rede fora: não perde o cadastro, tenta de novo na próxima visita.
                gravarFila(lerFila().concat([dados]));
                enviandoEspera = false;
                mostrarEsperaSalvaLocal();
            });
    }

    function marcarEsperaConfirmada() {
        try { localStorage.setItem('temprio.espera.confirmada', '1'); } catch (e) {}
        render();
        CartUI.toast('Pronto! Avisamos assim que chegarmos aí.');
    }

    function mostrarEsperaSalvaLocal() {
        render();
        CartUI.toast('Não conseguimos enviar agora — fale com um vendedor no WhatsApp.');
    }

    function jaNaEspera() {
        try { return localStorage.getItem('temprio.espera.confirmada') === '1'; }
        catch (e) { return false; }
    }

    /* ===================================================================
     * Texto do pedido
     * =================================================================== */
    function blocoCliente(d, comAcento) {
        var t = function (s) { return comAcento ? s : semAcento(s); };
        var endereco = d.logradouro + ', ' + d.numero +
            (d.complemento ? ' - ' + d.complemento : '') +
            ' - ' + d.bairro + ', ' + d.cidade + '/' + d.uf + ' - CEP ' + d.cep;

        return t('*Empresa:* ' + d.razaoSocial) + '\n' +
               '*CNPJ:* ' + d.cnpj + '\n' +
               t('*Insc. Estadual:* ' + d.inscricaoEstadual) + '\n' +
               t('*Responsavel:* ' + d.nome) + '\n' +
               '*Tel:* ' + d.telefone + '\n' +
               t('*Email:* ' + d.email) + '\n' +
               t('*Endereco:* ' + endereco);
    }

    function blocoTotais(t, comAcento) {
        var linha = '*TOTAL:* ' + t.potes + ' potes = ' + t.caixas + ' caixas / ' +
                    Cart.formatarBRL(t.valorCentavos);
        var min = t.atingiuMinimo
            ? 'Pedido minimo (' + t.minimoPotes + ' potes): OK'
            : 'Abaixo do minimo: faltam ' + t.faltamPotes + ' potes';
        return comAcento ? linha + '\n' + min : semAcento(linha + '\n' + min);
    }

    // A: uma linha por item, o formato mais legível para quem recebe.
    function textoCompleto(itens, t, d, comAcento) {
        var nome = function (s) { return comAcento ? s : semAcento(s); };
        var linhas = itens.map(function (it, i) {
            return (i + 1) + ') ' + nome(it.nome) + ' - ' + it.potes + ' potes (' +
                   nome(it.descricaoCaixas) + ')';
        });
        return '*NOVO PEDIDO - TEMP RIO*\n\n' +
               blocoCliente(d, comAcento) + '\n\n' +
               '*ITENS*\n' + linhas.join('\n') + '\n\n' +
               blocoTotais(t, comAcento) +
               (d.observacoes ? '\n\n*Obs:* ' + (comAcento ? d.observacoes : semAcento(d.observacoes)) : '');
    }

    // B: uma linha só com sabor e potes. A montagem das caixas fica de fora —
    // ela é derivável dos potes e o vendedor a recalcula do mesmo jeito.
    function textoCompacto(itens, t, d, comAcento) {
        var nome = function (s) { return comAcento ? s : semAcento(s); };
        var lista = itens.map(function (it) {
            return nome(it.nome) + ' ' + it.potes;
        }).join(', ');

        return '*NOVO PEDIDO - TEMP RIO*\n\n' +
               blocoCliente(d, comAcento) + '\n\n' +
               '*ITENS (potes):* ' + lista + '\n\n' +
               blocoTotais(t, comAcento) +
               (d.observacoes ? '\n\n*Obs:* ' + (comAcento ? d.observacoes : semAcento(d.observacoes)) : '');
    }

    // C: só o resumo na URL; a lista completa vai pela área de transferência.
    function textoResumo(t, d) {
        return semAcento(
            '*NOVO PEDIDO - TEMP RIO*\n\n' +
            blocoCliente(d, false) + '\n\n' +
            blocoTotais(t, false) + '\n\n' +
            'A lista completa de sabores foi copiada - cole aqui na conversa.'
        );
    }

    function montarEnvio(d) {
        var itens = Cart.itens();
        var t = Cart.totais();
        if (!itens.length) return null;

        var base = siteConfig.links.whatsappApi + '?text=';
        var orcamento = LIMITE_URL - base.length;

        function cabe(txt) { return encodeURIComponent(txt).length <= orcamento; }

        // O texto da URL vai sem acento: cada letra acentuada custa 6 caracteres
        // codificados. O texto copiado mantém os acentos.
        var completoUrl = textoCompleto(itens, t, d, false);
        if (cabe(completoUrl)) {
            return { nivel: 'A', url: base + encodeURIComponent(completoUrl),
                     copia: textoCompleto(itens, t, d, true), precisaColar: false };
        }

        var compactoUrl = textoCompacto(itens, t, d, false);
        if (cabe(compactoUrl)) {
            return { nivel: 'B', url: base + encodeURIComponent(compactoUrl),
                     copia: textoCompleto(itens, t, d, true), precisaColar: false };
        }

        var resumo = textoResumo(t, d);
        return { nivel: 'C', url: base + encodeURIComponent(resumo),
                 copia: textoCompleto(itens, t, d, true), precisaColar: true };
    }

    /* ===================================================================
     * Área de transferência — com cascata de fallback
     * =================================================================== */
    function copiar(texto) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(texto).catch(function () { return copiaLegada(texto); });
        }
        return Promise.resolve(copiaLegada(texto));
    }

    // navigator.clipboard não existe fora de contexto seguro — e este site pode
    // acabar servido em HTTP simples ou aberto em file://.
    function copiaLegada(texto) {
        try {
            var ta = document.createElement('textarea');
            ta.value = texto;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(ta);
            if (!ok) throw new Error('execCommand falhou');
            return true;
        } catch (e) {
            mostrarCaixaDeCopia(texto);
            return false;
        }
    }

    function mostrarCaixaDeCopia(texto) {
        var caixa = $('#caixa-copia');
        if (!caixa) {
            caixa = document.createElement('div');
            caixa.id = 'caixa-copia';
            caixa.className = 'cart-aviso p-4 space-y-2';
            caixa.innerHTML = '<p class="text-xs font-bold">Copie o pedido abaixo e cole na conversa:</p>' +
                '<textarea readonly rows="6" class="campo-input text-xs"></textarea>';
            $('#pedido-resumo').appendChild(caixa);
        }
        var ta = caixa.querySelector('textarea');
        ta.value = texto; // .value, nunca innerHTML
        ta.select();
    }

    /* ===================================================================
     * Envio
     * =================================================================== */
    function enviar() {
        if (Cart.vazio()) return;

        var invalidos = validarTudo();
        if (invalidos.length) {
            var primeiro = inputDe(invalidos[0]);
            if (primeiro) {
                primeiro.focus();
                primeiro.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            CartUI.toast(invalidos.length === 1
                ? 'Revise 1 campo destacado.'
                : 'Revise ' + invalidos.length + ' campos destacados.');
            return;
        }

        var envio = montarEnvio(lerFormulario());
        if (!envio) return;

        // Registra o pedido no painel. Sem await de propósito: o que importa
        // para o cliente é a mensagem do WhatsApp, e uma falha de rede aqui não
        // pode travar o envio. O que não subir fica na fila do TempRioDB e sobe
        // na próxima visita.
        if (window.TempRioDB) TempRioDB.registrarPedido(pedidoParaBanco());

        // Copiar ANTES de navegar: a escrita na área de transferência exige o
        // gesto do usuário e pode não rodar depois que a aba perde o foco.
        copiar(envio.copia).then(function () {
            if (envio.precisaColar) {
                CartUI.toast('Pedido copiado — cole na conversa do WhatsApp.');
            }
            var janela = window.open(envio.url, '_blank', 'noopener');
            if (!janela) window.location.href = envio.url; // popup bloqueado
        });
    }

    /* ===================================================================
     * Renderização
     * =================================================================== */
    function resumoHTML(t) {
        var minimoBRL = Cart.formatarBRL(Cart.precoDePotes(t.minimoPotes));
        var pct = Math.round(t.progresso * 100);

        var aviso = t.atingiuMinimo
            ? '<p class="flex items-center gap-2 text-xs font-bold text-green-400">' +
                  '<i class="fa-solid fa-circle-check"></i> Pedido mínimo atingido</p>'
            : '<div class="cart-aviso p-3 text-xs leading-relaxed">' +
                  '<strong class="font-bold">Faltam ' + t.faltamPotes + ' potes</strong>.<br>' +
                  '<span class="opacity-80">Você pode enviar assim mesmo; o vendedor confirma.</span>' +
              '</div>';

        return '' +
        '<p class="text-lg font-bold uppercase tracking-wider">Resumo</p>' +

        '<div class="space-y-2">' +
            '<div class="cart-progresso"><div class="cart-progresso-barra' +
                (t.atingiuMinimo ? ' is-completo' : '') + '" style="width:' + pct + '%"></div></div>' +
            '<p class="text-[0.6rem] text-textSecondary uppercase tracking-widest">' +
                'Pedido mínimo: ' + t.minimoPotes + ' potes (' + minimoBRL + ')</p>' +
        '</div>' +

        aviso +

        '<div class="space-y-1.5 text-sm border-t border-white/5 pt-4">' +
            '<div class="flex justify-between text-textSecondary"><span>Potes</span><span class="text-white">' + t.potes + '</span></div>' +
            '<div class="flex justify-between text-textSecondary"><span>Caixas a enviar</span><span class="text-white">' + t.caixas + '</span></div>' +
            '<div class="flex justify-between text-textSecondary"><span>Preço por pote</span><span class="text-white">' +
                Cart.formatarBRL(Cart.config.precoPorPoteCentavos) + '</span></div>' +
        '</div>' +

        '<div class="flex items-end justify-between border-t border-white/5 pt-4">' +
            '<span class="text-[0.6rem] text-textSecondary uppercase tracking-widest">Total</span>' +
            '<span class="text-3xl font-bold text-white leading-none" style="font-family:\'Barlow Condensed\',sans-serif;">' +
                Cart.formatarBRL(t.valorCentavos) + '</span>' +
        '</div>' +

        (atendeEndereco() ? blocoEnvio() : blocoForaDaArea());
    }

    function blocoEnvio() {
        return '' +
        '<button type="button" id="btn-enviar" class="btn-primary w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2">' +
            '<i class="fa-brands fa-whatsapp text-lg"></i> Enviar pedido no WhatsApp' +
        '</button>' +

        '<button type="button" id="btn-copiar" class="w-full py-3 rounded-xl border border-white/12 text-white/70 hover:text-white hover:border-white/25 transition-all text-xs font-bold uppercase tracking-widest">' +
            'Copiar pedido' +
        '</button>' +

        '<p class="text-[0.65rem] text-textSecondary text-center leading-relaxed">' +
            'Nenhum pagamento é feito aqui. Um vendedor confirma o pedido com você.' +
        '</p>';
    }

    /* Fora da área: não é porta fechada, é triagem. A lista de espera é o
     * caminho principal, mas o WhatsApp continua aberto — uma proposta de fora
     * do estado pode compensar, e quem decide isso é o vendedor. */
    function blocoForaDaArea() {
        var cidade = inputDe('cidade').value;
        var uf = inputDe('uf').value;
        var onde = cidade ? cidade + '/' + uf : 'nesse endereço';

        if (jaNaEspera()) {
            return '' +
            '<div class="rounded-xl border border-green-500/30 bg-green-500/10 p-4 space-y-2">' +
                '<p class="flex items-center gap-2 text-sm font-bold text-green-400">' +
                    '<i class="fa-solid fa-circle-check"></i> Você está na lista</p>' +
                '<p class="text-xs text-textSecondary leading-relaxed">' +
                    'Avisamos assim que a Temp Rio começar a entregar em ' + esc(onde) + '.</p>' +
            '</div>' +
            '<a href="' + esc(siteConfig.links.whatsappApi) + '" target="_blank" rel="noopener"' +
                ' class="w-full py-3 rounded-xl border border-white/12 text-white/70 hover:text-white hover:border-white/25 transition-all text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">' +
                '<i class="fa-brands fa-whatsapp"></i> Falar com um vendedor' +
            '</a>';
        }

        return '' +
        '<div class="cart-aviso p-4 space-y-2">' +
            '<p class="flex items-center gap-2 text-sm font-bold">' +
                '<i class="fa-solid fa-truck"></i> Ainda não entregamos em ' + esc(onde) + '</p>' +
            '<p class="text-xs leading-relaxed opacity-90">' +
                'Hoje a nossa entrega cobre o estado do Rio de Janeiro. ' +
                'Entre na lista de espera e avisamos assim que chegarmos à sua região.</p>' +
        '</div>' +

        '<button type="button" id="btn-espera" class="btn-primary w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2">' +
            '<i class="fa-solid fa-bell"></i> Entrar na lista de espera' +
        '</button>' +

        '<a href="' + esc(siteConfig.links.whatsappApi) + '" target="_blank" rel="noopener"' +
            ' class="w-full py-3 rounded-xl border border-white/12 text-white/70 hover:text-white hover:border-white/25 transition-all text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">' +
            '<i class="fa-brands fa-whatsapp"></i> Falar com um vendedor' +
        '</a>' +

        '<p class="text-[0.65rem] text-textSecondary text-center leading-relaxed">' +
            'Pedidos de fora do Rio podem ser avaliados caso a caso — vale conversar.' +
        '</p>';
    }

    function render() {
        var itens = Cart.itens();
        var t = Cart.totais();
        var vazio = itens.length === 0;

        $('#pedido-vazio').classList.toggle('hidden', !vazio);
        $('#pedido-conteudo').classList.toggle('hidden', vazio);
        if (vazio) return;

        $('#pedido-lista').innerHTML = itens.map(CartUI.linhaHTML).join('');
        $('#pedido-resumo').innerHTML = resumoHTML(t);

        // Os botões do resumo mudam conforme o endereço atende ou não.
        var enviar_ = $('#btn-enviar');
        if (enviar_) enviar_.addEventListener('click', enviar);

        var copiar_ = $('#btn-copiar');
        if (copiar_) copiar_.addEventListener('click', function () {
            var envio = montarEnvio(lerFormulario());
            if (!envio) return;
            copiar(envio.copia).then(function () { CartUI.toast('Pedido copiado.'); });
        });

        var espera_ = $('#btn-espera');
        if (espera_) espera_.addEventListener('click', entrarNaListaDeEspera);
    }

    /* ===================================================================
     * Boot
     * =================================================================== */
    function iniciar() {
        // Estados
        var uf = inputDe('uf');
        uf.innerHTML = '<option value="">--</option>' +
            UFS.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join('');

        CartUI.ligarLista($('#pedido-lista'));
        render();
        document.addEventListener('cart:change', render);

        $('#btn-limpar').addEventListener('click', function () {
            if (Cart.vazio()) return;
            Cart.limpar();
            CartUI.toast('Pedido esvaziado.');
        });

        // Máscaras
        inputDe('telefone').addEventListener('input', function () {
            this.value = mascararTelefone(this.value);
        });
        inputDe('cnpj').addEventListener('input', function () {
            this.value = mascararCnpj(this.value);
        });
        inputDe('inscricaoEstadual').addEventListener('input', function () {
            if (!isentoDeIE()) this.value = this.value.replace(/\D/g, '').slice(0, 14);
        });

        var caixaIsento = document.getElementById('f-ieIsento');
        caixaIsento.addEventListener('change', function () {
            aplicarIsencaoIE();
            salvarRascunho();
        });
        inputDe('cep').addEventListener('input', function () {
            this.value = mascararCep(this.value);
            if (this.value.replace(/\D/g, '').length === 8) buscarCep();
        });
        inputDe('cep').addEventListener('blur', buscarCep);

        // Validação: blur valida; input só LIMPA erro, nunca cria enquanto digita.
        Object.keys(REGRAS).forEach(function (nome) {
            var el = inputDe(nome);
            if (!el) return;
            el.addEventListener('blur', function () { tocados[nome] = true; validarCampo(nome); });
            el.addEventListener('input', function () {
                if (campoDe(nome).classList.contains('is-erro')) validarCampo(nome);
            });
        });

        uf.addEventListener('change', atualizarAvisoEntrega);

        // Rascunho: um F5 não pode apagar o endereço todo.
        CAMPOS.forEach(function (n) {
            var el = inputDe(n);
            if (el) el.addEventListener('input', salvarRascunho);
        });
        uf.addEventListener('change', salvarRascunho);

        carregarRascunho();

        // Cadastro que ficou preso numa falha de rede sobe agora.
        reenviarPendentes();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
