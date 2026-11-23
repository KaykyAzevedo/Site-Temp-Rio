// Retencao de canhotos: recebe um cliente de SERVICO, nunca chave/telefone no frontend.
(function (raiz) {
    'use strict';
    async function limpar(sb, opts) {
        var total = { lotes: 0, arquivos: 0, linhas: 0 };
        var max = Math.max(1, Math.min(20, Number(opts && opts.maxLotes) || 20));
        for (var i = 0; i < max; i++) {
            var r = await sb.rpc('rota_052_limpeza_lote', { p_limite: 100 });
            if (r.error) throw r.error;
            var lote = r.data;
            total.linhas += Number(lote && lote.linhas) || 0;
            if (!lote || !Array.isArray(lote.caminhos) || !lote.caminhos.length) break;
            if (!lote.token || lote.caminhos.length > 100) throw new Error('lote de limpeza invalido');
            // Nunca DELETE SQL em storage.objects: a API remove tanto o arquivo fisico quanto seus metadados.
            var apagou = await sb.storage.from('canhotos').remove(lote.caminhos);
            if (apagou.error) throw apagou.error;
            var confirmou = await sb.rpc('rota_052_limpeza_confirmar', { p_token: lote.token });
            if (confirmou.error) throw confirmou.error;
            total.lotes++; total.arquivos += lote.caminhos.length; total.linhas += Number(confirmou.data) || 0;
        }
        return total;
    }
    async function responder(req, sb) {
        function json(status, value) { return new Response(JSON.stringify(value), { status: status, headers: { 'Content-Type': 'application/json' } }); }
        if (req.method !== 'POST') return json(405, { erro: 'use POST' });
        var token = req.headers.get('x-cron-token') || '';
        if (token.length < 32 || token.length > 512) return json(401, { erro: 'nao autorizado' });
        var auth;
        try { auth = await sb.rpc('whatsapp_043_cron_ok', { p_token: token }); }
        catch (e) { return json(503, { erro: 'autenticacao do cron indisponivel' }); }
        if (auth.error || auth.data !== true) return json(401, { erro: 'nao autorizado' });
        try { return json(200, Object.assign({ ok: true }, await limpar(sb))); }
        catch (e) { return json(503, { erro: 'limpeza incompleta; lote preservado para retentativa' }); }
    }
    var api = { limpar: limpar, responder: responder };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    raiz.TempRioCanhotosLimpeza = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
