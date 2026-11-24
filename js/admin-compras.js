/* Historico comercial1A: cupons PDV + pedidos faturados sem cupom correspondente.
 * Somente calculo no painel, sem gravacao. NF e origem provisoria por pedido, nao nota fiscal consultada.
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
    var api = { juntar: juntar };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    raiz.TempRioCompras = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
