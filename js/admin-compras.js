/* Historico comercial: PDV + NF oficial060; pedidos1A somente nas lacunas.
 * juntar conserva o contrato1A (NF provisoria por pedido); juntarFontes acrescenta NF consultada/cobertura.
 * Somente calculo no painel, sem gravacao.
 * Casamento exato CNPJ/centavos/dia inclusivo: diaPedidoSP..diaFaturamentoSP+5. Cupom e pedido usados uma vez.
 */
(function (raiz) {
    'use strict';
    var R = typeof module !== 'undefined' && module.exports ? require('../supabase/functions/_shared/rota-core.js') : raiz.TempRioRotaCore;
    function cnpj(v) {
        var d = String(v == null ? '' : v).replace(/\D/g, '');
        return d && d.length <= 14 && !/^0+$/.test(d) ? d.padStart(14, '0') : '';
    }
    function centavos(v) { return v != null && v !== '' && Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null; }
    function chave(doc, valor) { return doc + ':' + valor; }
    function juntar(cupons, pedidos) {
        var linhas = [], grupos = Object.create(null), vistos = Object.create(null), candidatos = [], ids = Object.create(null);
        var res = { linhas: linhas, clientes: Object.create(null), casados: 0, semValor: 0, semData: 0 };
        (cupons || []).forEach(function (l, i) {
            var dia = String(l.dia || '').slice(0, 10);
            var id = l.cd_pdv != null && l.nr_cupom != null ? dia + '|' + l.cd_pdv + '|' + l.nr_cupom : 'linha:' + i;
            if (vistos[id]) return;
            vistos[id] = true;
            linhas.push(Object.assign({}, l, { origem: 'PDV' }));
            var doc = l.tipo === 'cnpj' ? cnpj(l.documento) : '', v = centavos(l.valor_centavos);
            if (!doc || v == null || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return;
            var k = chave(doc, v);
            (grupos[k] || (grupos[k] = [])).push({ dia: dia, id: id, linha: linhas[linhas.length - 1] });
        });
        Object.keys(grupos).forEach(function (k) { grupos[k].sort(function (a, b) { return a.dia.localeCompare(b.dia) || a.id.localeCompare(b.id); }); });
        (pedidos || []).forEach(function (p) {
            if (!p || p.cliente_tipo !== 'cnpj' || !R.etapaEnviada(p)) return;
            var doc = cnpj(p.documento), cd = Number(p.cd_pedido);
            if (!doc || !Number.isSafeInteger(cd) || cd < 1 || ids[cd]) return;
            ids[cd] = true;
            if (!res.clientes[doc] || !res.clientes[doc].nome) res.clientes[doc] = { nome: p.cliente_nome || '' };
            var v = centavos(p.valor_centavos);
            if (v == null) { res.semValor++; return; }
            var em = R.faturadoEm(p);
            if (!em || !p.dt_pedido || !isFinite(Date.parse(p.dt_pedido))) { res.semData++; return; }
            var ini = R.diaSP(p.dt_pedido), dia = R.diaSP(em), fim = R.somaDias(dia, 5);
            if (ini > fim) { res.semData++; return; }
            candidatos.push({ p: p, doc: doc, valor: v, ini: ini, dia: dia, fim: fim, cd: cd });
        });
        // Intervalos por fim mais cedo; consumir o primeiro cupom livre elegivel maximiza o casamento individual.
        candidatos.sort(function (a, b) { return a.fim.localeCompare(b.fim) || a.ini.localeCompare(b.ini) || a.cd - b.cd; });
        candidatos.forEach(function (c) {
            var gs = grupos[chave(c.doc, c.valor)] || [], lo = 0, hi = gs.length;
            while (lo < hi) { var m = (lo + hi) >>> 1; if (gs[m].dia < c.ini) lo = m + 1; else hi = m; }
            if (lo < gs.length && gs[lo].dia <= c.fim) {
                var cupom = gs.splice(lo, 1)[0];
                if (!cupom.linha.cliente_nome) cupom.linha.cliente_nome = c.p.cliente_nome || '';
                res.casados++; return;
            }
            linhas.push({ dia: c.dia, documento: c.doc, tipo: 'cnpj', valor_centavos: c.valor, origem: 'NF', cd_pedido: c.cd, cliente_nome: c.p.cliente_nome || '' });
        });
        return res;
    }
    // 1B: a cobertura diária distingue "nenhuma NF válida" de "dia ainda não coletado".
    // Um dia coberto não pode ressuscitar nota cancelada através do pedido provisório.
    function juntarFontes(cupons, pedidos, notas, cobertura, fornecedores) {
        function cliente(l) { return !fornecedores || !Object.prototype.hasOwnProperty.call(fornecedores, cnpj(l.documento)); }
        cupons = (cupons || []).filter(cliente); pedidos = (pedidos || []).filter(cliente);
        if (notas == null && cobertura == null) {
            var antigo = juntar(cupons, pedidos);
            antigo.notas = []; antigo.nfPDV = []; antigo.nfSemPdv = 0; antigo.nfInstalada = false;
            return antigo;
        }
        if (!Array.isArray(notas) || !Array.isArray(cobertura)) throw new Error('Histórico NF incompleto.');
        var dias = Object.create(null), porPedido = Object.create(null), vistos = Object.create(null), oficiais = [], pdv = [], cuponsPorValor = Object.create(null);
        (cupons || []).forEach(function (c) { if (c.tipo === 'cnpj') cuponsPorValor[cnpj(c.documento) + ':' + c.dia + ':' + centavos(c.valor_centavos)] = true; });
        cobertura.forEach(function (x) {
            if (!x || !/^\d{4}-\d{2}-\d{2}$/.test(x.dia)) throw new Error('Cobertura NF inválida.');
            dias[x.dia] = true;
        });
        notas.filter(cliente).forEach(function (n) {
            var cd = Number(n.cd_nota), doc = cnpj(n.documento);
            if (!Number.isSafeInteger(cd) || cd < 1 || !doc || centavos(n.valor_centavos) == null ||
                centavos(n.total_nota_centavos) == null || (n.st_centavos != null && centavos(n.st_centavos) == null)) throw new Error('Nota fiscal inválida.');
            if (vistos[cd]) {
                if (JSON.stringify(vistos[cd]) !== JSON.stringify(n)) throw new Error('Nota fiscal repetida com dados diferentes.');
                return;
            }
            vistos[cd] = n;
            var linha = Object.assign({}, n, { documento: doc, tipo: 'cnpj', origem: 'NF', provisoria: false });
            oficiais.push(linha);
            if (n.cd_pedido != null) porPedido[doc + ':' + n.cd_pedido] = true;
            if (n.nf_cupom === true) pdv.push(linha);
        });
        var lacunas = (pedidos || []).filter(function (p) {
            var em = R.faturadoEm(p);
            return !porPedido[cnpj(p.documento) + ':' + p.cd_pedido] && (!em || !dias[R.diaSP(em)]);
        });
        var res = juntar(cupons, lacunas);
        res.linhas = res.linhas.map(function (l) { return l.origem === 'NF' ? Object.assign({}, l, { provisoria: true }) : l; });
        oficiais.forEach(function (n) {
            if (!res.clientes[n.documento]) res.clientes[n.documento] = { nome: n.cliente_nome || '' };
            // Flag de vínculo no ERP: a fonte de valor é o PDV, não somar novamente.
            if (n.nf_cupom !== true) res.linhas.push(n);
        });
        res.nfSemPdv = pdv.filter(function (n) { return !cuponsPorValor[n.documento + ':' + n.dia + ':' + centavos(n.valor_centavos)]; }).length;
        var total = 0;
        res.linhas.forEach(function (l) {
            var valor = centavos(l.valor_centavos);
            if (valor == null || !Number.isSafeInteger(total + valor)) throw new Error('Total de compras fora do limite de precisão.');
            total += valor;
        });
        res.notas = oficiais; res.nfPDV = pdv; res.nfInstalada = true;
        return res;
    }
    var api = { juntar: juntar, juntarFontes: juntarFontes };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    raiz.TempRioCompras = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
