/* Validadores de documento e telefone, compartilhados entre páginas.
 *
 * CNPJ e máscara de telefone já existiam, sozinhos, dentro de js/pedido.js —
 * que não carrega no catálogo. Em vez de duplicar ali e aqui, viraram este
 * arquivo pequeno, carregado nas duas páginas. O algoritmo de CNPJ é
 * exatamente o mesmo de antes; CPF é novo, mesma família de conta (mod 11).
 *
 * Sem I/O, sem DOM: só funções puras, fáceis de testar isoladas.
 */
(function () {
    'use strict';

    function soDigitos(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

    /* ===================================================================
     * Máscaras
     * =================================================================== */
    function mascararTelefone(v) {
        var d = soDigitos(v).slice(0, 11);
        if (d.length <= 2) return d.length ? '(' + d : '';
        if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
        if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
        return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    }

    function mascararCpf(v) {
        var d = soDigitos(v).slice(0, 11);
        if (d.length <= 3) return d;
        if (d.length <= 6) return d.slice(0, 3) + '.' + d.slice(3);
        if (d.length <= 9) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
        return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    }

    function mascararCnpj(v) {
        var d = soDigitos(v).slice(0, 14);
        if (d.length <= 2) return d;
        if (d.length <= 5) return d.slice(0, 2) + '.' + d.slice(2);
        if (d.length <= 8) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5);
        if (d.length <= 12) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8);
        return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
    }

    /* ===================================================================
     * Dígitos verificadores
     * =================================================================== */
    /* CPF: dois dígitos, cada um soma dígito × peso decrescente, resto da
     * divisão por 11. peso = tamanho_da_base + 1 dá 10..2 no primeiro cálculo
     * (base de 9 dígitos) e 11..2 no segundo (base de 10) — é a mesma regra
     * dita de duas formas, sem tabela de pesos escrita à mão duas vezes. */
    function cpfValido(valor) {
        var c = soDigitos(valor);
        if (c.length !== 11) return false;
        if (/^(\d)\1{10}$/.test(c)) return false; // 00000000000 e afins

        function digito(base) {
            var soma = 0, peso = base.length + 1;
            for (var i = 0; i < base.length; i++) soma += Number(base.charAt(i)) * peso--;
            var resto = (soma * 10) % 11;
            return resto === 10 ? 0 : resto;
        }

        return digito(c.slice(0, 9)) === Number(c.charAt(9)) &&
               digito(c.slice(0, 10)) === Number(c.charAt(10));
    }

    /* CNPJ com dígitos verificadores. Um campo que aceita qualquer número não
     * serve para emitir nota: o erro só apareceria no faturamento. Mesmo
     * algoritmo de js/pedido.js — ver o comentário lá para o porquê do peso
     * reiniciar em 9 assim que passa de 2. */
    function cnpjValido(valor) {
        var c = soDigitos(valor);
        if (c.length !== 14) return false;
        if (/^(\d)\1{13}$/.test(c)) return false;

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

    /* Documento único: decide pelo tamanho, já que os dois algoritmos acima
     * recusam qualquer coisa que não seja 11 ou 14 dígitos. */
    function documentoValido(valor, tipo) {
        if (tipo === 'cpf') return cpfValido(valor);
        if (tipo === 'cnpj') return cnpjValido(valor);
        return false;
    }

    /* DDD do Rio: 21 (capital e região metropolitana) e 24 (interior — Volta
     * Redonda, região dos Lagos). Só reconhecimento informativo — quem faz a
     * entrega de verdade caber ou não é o CEP, checado no pedido. */
    var DDD_RIO = ['21', '24'];
    function telefoneEhDoRio(valor) {
        var d = soDigitos(valor);
        return d.length >= 2 && DDD_RIO.indexOf(d.slice(0, 2)) !== -1;
    }

    function telefoneValido(valor) {
        var d = soDigitos(valor);
        return d.length === 10 || d.length === 11;
    }

    /* Pragmático, não RFC — mesma regra usada em js/pedido.js e agora também
     * no banco (public.email_valido(), migração 013): melhor aceitar um
     * endereço estranho do que barrar um cliente real. Nenhuma lista de
     * "domínio suspeito" aqui, pelo mesmo motivo explicado na migração — essa
     * lista envelhece rápido e barra gente de verdade. */
    function emailValido(valor) {
        return /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(String(valor || '').trim());
    }

    window.Validadores = {
        mascararTelefone: mascararTelefone,
        mascararCpf: mascararCpf,
        mascararCnpj: mascararCnpj,
        cpfValido: cpfValido,
        cnpjValido: cnpjValido,
        documentoValido: documentoValido,
        telefoneValido: telefoneValido,
        telefoneEhDoRio: telefoneEhDoRio,
        emailValido: emailValido,
        soDigitos: soDigitos
    };
})();
