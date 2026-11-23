/* =====================================================================
 * CANHOTO (migração 052) — compartilhado entre motorista.html e o painel (admin.html).
 * Foto do canhoto: reduzida NO APARELHO antes de enviar (lado maior até 1600 px, JPEG 0,7), enviada ao bucket PRIVADO
 * 'canhotos' do Supabase Storage em <data SP>/<cd_pedido>/<uuid>.jpg e registrada pela RPC rota_052_registrar (que
 * confere de novo quem pode anexar o quê). Leitura só por URL assinada curta (equipe).
 * Nada aqui guarda a foto fora do aparelho; a fila offline do motorista usa IndexedDB (js/motorista.js).
 * ===================================================================== */
(function (raiz) {
    'use strict';
    var MAX_LADO = 1600, QUALIDADE = 0.7, LIMITE = 5 * 1024 * 1024, BUCKET = 'canhotos';
    var MAX_PEDIDOS = 15050;   // 047: 50 na raiz + 300 itens CD x 50 pedidos. Mesmo limite da 052.
    var TIPOS = ['image/jpeg', 'image/png', 'image/webp'];

    function uuid() {
        if (raiz.crypto && typeof raiz.crypto.randomUUID === 'function') return raiz.crypto.randomUUID();
        var b = new Uint8Array(16); (raiz.crypto || {}).getRandomValues ? raiz.crypto.getRandomValues(b) : b.forEach(function (_, i) { b[i] = Math.floor(Math.random() * 256); });
        b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        var h = Array.prototype.map.call(b, function (x) { return (x + 0x100).toString(16).slice(1); }).join('');
        return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    }
    function hojeSP() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).slice(0, 10); }
    // <AAAA-MM-DD>/<cd_pedido>/<uuid>.jpg (o banco confere o formato; o motorista só pode o dia de hoje).
    function caminho(dia, cd) { return String(dia || hojeSP()) + '/' + String(Number(cd)) + '/' + uuid() + '.jpg'; }

    // Reduz a foto (File/Blob de imagem) para JPEG <= MAX_LADO. Sem suporte a canvas/decodificação: rejeita (a tela avisa).
    function reduzir(arquivo) {
        return new Promise(function (ok, falha) {
            if (!arquivo || TIPOS.indexOf(String(arquivo.type || '').toLowerCase()) < 0) { falha(new Error('Envie uma foto (JPG, PNG ou WEBP).')); return; }
            var url = URL.createObjectURL(arquivo), img = new Image();
            img.onload = function () {
                try {
                    var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, MAX_LADO / Math.max(w, h));
                    var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    URL.revokeObjectURL(url);
                    c.toBlob(function (b) {
                        if (!b) { falha(new Error('Não foi possível preparar a foto.')); return; }
                        if (b.size > LIMITE) { falha(new Error('A foto ficou grande demais (limite 5 MB).')); return; }
                        ok(b);
                    }, 'image/jpeg', QUALIDADE);
                } catch (e) { URL.revokeObjectURL(url); falha(e); }
            };
            img.onerror = function () { URL.revokeObjectURL(url); falha(new Error('Não foi possível abrir a foto.')); };
            img.src = url;
        });
    }
    // Envia e registra ate MAX_PEDIDOS. Painel: {substituir}; motorista: {caminho,motorista:true,veiculo,versao}.
    // Recusas de contexto sao propagadas sem upload/sem alterar a fila. Devolve Promise<{caminho}>.
    function enviar(sb, blob, cds, opts) {
        opts = opts || {};
        var lista = [], vistos = Object.create(null);
        if (!Array.isArray(cds) || !cds.length || cds.length > MAX_PEDIDOS || cds.some(function (cd) {
            var n = Number(cd); if (!isFinite(n) || n < 1 || n > 999999999999 || Math.floor(n) !== n) return true;
            if (!vistos[n]) { vistos[n] = true; lista.push(n); } return false;
        })) { var invalido = new Error('Lista de pedidos invalida (1 a ' + MAX_PEDIDOS + ').'); invalido.code = '22023'; return Promise.reject(invalido); }
        cds = lista;
        var cam = opts.caminho || caminho(opts.dia, cds[0]);
        // Motorista: falha de dia/veiculo/versao deve chegar antes do upload (sem virar 403 do Storage).
        // O registro confere o contexto de novo na transacao dele. Painel continua sem esses argumentos.
        var conferir = opts.motorista ? sb.rpc('rota_051_validar_contexto', {
            p_data: String(cam).split('/')[0], p_veiculo: opts.veiculo == null ? null : opts.veiculo,
            p_versao: opts.versao == null ? null : opts.versao
        }) : Promise.resolve(null);
        return conferir.then(function (r) {
            if (r && r.error) throw r.error;
            if (opts.motorista && (!r || r.data !== true)) {
                var semContexto = new Error('Nao foi possivel confirmar o contexto da rota.'); semContexto.code = 'P5104'; throw semContexto;
            }
            return sb.storage.from(BUCKET).upload(cam, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
        }).then(function (r) {
            // reenvio da fila: o arquivo já subiu antes (409/Duplicate) -> segue para registrar
            if (r && r.error && !/exist|duplicate|409/i.test(String(r.error.message || r.error.statusCode || ''))) throw r.error;
            var args = { p_caminho: cam, p_cds: cds, p_substituir: !!opts.substituir };
            if (opts.motorista) { args.p_veiculo = opts.veiculo == null ? null : opts.veiculo; args.p_versao = opts.versao == null ? null : opts.versao; }
            return sb.rpc('rota_052_registrar', args);
        }).then(function (r) { if (r && r.error) throw r.error; return { caminho: cam }; });
    }
    function urlAssinada(sb, cam) {
        return sb.storage.from(BUCKET).createSignedUrl(cam, 120).then(function (r) { if (r.error) throw r.error; return r.data.signedUrl || r.data.signedURL; });
    }
    raiz.TempRioCanhoto = { reduzir: reduzir, enviar: enviar, caminho: caminho, urlAssinada: urlAssinada, uuid: uuid, BUCKET: BUCKET, TIPOS: TIPOS, MAX_PEDIDOS: MAX_PEDIDOS };
})(typeof window !== 'undefined' ? window : this);
