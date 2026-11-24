/* Arquivo de entregas057. Leitura de equipe, fotos somente por URL assinada curta.
 * Cache apenas na sessao/aba; sair() invalida inclusive respostas assincronas antigas.
 */
(function (raiz) {
    'use strict';
    var TAM = 25, FOTOS = 10;
    function novo() { return { alvo: null, sb: null, seq: 0, req: 0, q: {}, lista: [], mais: false, ocupado: false, buscou: false, erro: '', abertos: {}, fotos: {}, urls: {}, vendo: {}, assinando: {} }; }
    var st = novo();
    function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function data(x) {
        if (!x || !isFinite(Date.parse(x))) return 'Não informado';
        return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(x));
    }
    function dinheiro(x) { return x == null ? 'Não informado' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(x) / 100); }
    function endereco(p) {
        var rua = [p.logradouro, p.numero].filter(Boolean).join(', ');
        var partes = [rua, p.complemento, p.bairro, [p.cidade, p.uf].filter(Boolean).join('/')].filter(Boolean);
        return (partes.join(' · ') || p.endereco_texto || 'Endereço não informado') + (p.cep ? ' · CEP ' + p.cep : '');
    }
    function erro(e) {
        var c = String((e && e.code) || '');
        return /^(PGRST202|42P01|42883)$/.test(c) ? 'Arquivo de canhotos ainda não disponível.' : c === '42501' ? 'Sem permissão para consultar o arquivo.' : c === '22023' ? 'Confira o número, o período e os filtros.' : 'Não foi possível consultar agora. Tente novamente.';
    }
    function assinaturaUrl(x) { try { var u = new URL(x); return /^https?:$/.test(u.protocol) ? u.href : null; } catch (e) { return null; } }
    function valida(s, seq) { return st === s && s.seq === seq; }
    function buscaValida(s, seq, req) { return valida(s, seq) && s.req === req; }
    function itemFoto(cd, f) {
        var key = cd + '|' + f.caminho, u = st.urls[f.caminho], aberta = st.vendo[key] && u && u.ate > Date.now();
        return '<li class="mb-3"><p class="text-xs">' + esc(data(f.enviado_em)) + (f.substituido_em ? ' · Foto anterior, substituída' : '') + '</p>' +
            '<button type="button" class="adm-botao-fantasma" data-arq-ver="' + esc(f.caminho) + '" data-arq-cd="' + cd + '"' + (st.assinando[f.caminho] ? ' disabled' : '') + '>' + (aberta ? 'Fechar foto' : st.assinando[f.caminho] ? 'Abrindo…' : 'Ver foto') + '</button>' +
            (aberta ? '<a href="' + esc(u.url) + '" target="_blank" rel="noopener noreferrer"><img data-arq-img="' + esc(f.caminho) + '" data-arq-cd="' + cd + '" src="' + esc(u.url) + '" alt="Canhoto do pedido ' + cd + '" style="display:block;max-width:100%;max-height:60vh;object-fit:contain;margin-top:8px"></a>' : '') + '</li>';
    }
    function item(p) {
        var cd = Number(p.cd_pedido), f = st.fotos[cd], caixa = function (v) { return v == null ? 'não informado' : String(v); };
        return '<details class="adm-card p-4 mb-3" data-arq-pedido="' + cd + '"' + (st.abertos[cd] ? ' open' : '') + '><summary class="font-bold">Pedido ' + cd + ' · ' + esc(p.cliente_nome || 'Nome não informado') + ' · ' + esc(data(p.dt_faturado || p.dt_pedido)) + '</summary>' +
            '<p class="text-sm mt-3">' + (p.cliente_tipo === 'cnpj' ? (/^\d{14}$/.test(p.documento || '') ? 'CNPJ ' + esc(p.documento) : 'CNPJ não informado') : p.cliente_tipo === 'cpf' ? 'Consumidor final · documento não armazenado' : 'Identificação não disponível') + '</p>' +
            '<p class="text-sm">' + esc(endereco(p)) + '</p>' +
            '<p class="text-sm">Valor: ' + esc(dinheiro(p.valor_centavos)) + ' · Carga: ' + esc(p.nr_carga || 'não informada') + '</p>' +
            '<p class="text-sm">Caixas 24: ' + esc(caixa(p.caixas_24)) + ' · Caixas 48: ' + esc(caixa(p.caixas_48)) + ' · Avulsos: ' + esc(caixa(p.caixas_outras)) + '</p>' +
            '<p class="text-sm">Pedido em ' + esc(data(p.dt_pedido)) + ' · Faturado em ' + esc(data(p.dt_faturado)) + '</p>' +
            '<p class="text-sm">Veículo: ' + esc(p.veiculo_nome || p.veiculo_id || 'não informado') + ' · Motorista da rota: ' + esc(p.motorista_nome || 'não informado') + (p.rota_data ? ' · Rota de ' + esc(p.rota_data) : '') + '</p>' +
            (p.dados_incompletos ? '<p class="text-xs mt-2" role="note">Dados parciais: o pedido já não estava completo na fonte quando foi arquivado. Campos ausentes não foram estimados.</p>' : '') +
            '<p class="text-xs mt-2">Último canhoto em ' + esc(data(p.ultimo_canhoto_em)) + ' · Arquivado em ' + esc(data(p.arquivado_em)) + '</p>' +
            '<div class="mt-3" aria-live="polite">' + (!f || f.ocupado && !f.lista.length ? '<p>Carregando fotos…</p>' : '') +
                (f ? (f.erro ? '<p role="alert">' + esc(f.erro) + ' <button type="button" class="adm-botao-fantasma" data-arq-fotos="' + cd + '">Tentar fotos novamente</button></p>' : '') +
                    '<ul>' + f.lista.map(function (x) { return itemFoto(cd, x); }).join('') + '</ul>' +
                    (!f.lista.length && !f.ocupado && !f.erro ? '<p>Sem fotos disponíveis. Podem ter sido removidas pela equipe ou estar em expurgo.</p>' : '') +
                    (f.mais ? '<button type="button" class="adm-botao-fantasma" data-arq-fotos="' + cd + '"' + (f.ocupado ? ' disabled' : '') + '>Mais fotos</button>' : '') : '') + '</div></details>';
    }
    function desenharResultados() {
        var root = st.alvo, el = root && root.querySelector('[data-arq-resultados]'); if (!el || !root.isConnected) return;
        el.innerHTML = (st.erro ? '<p role="alert">' + esc(st.erro) + '</p>' : '') +
            (st.buscou && !st.lista.length && !st.ocupado && !st.erro ? '<p>Nenhum pedido arquivado com esses filtros.</p>' : '') +
            st.lista.map(item).join('') + (st.mais ? '<button type="button" class="adm-botao-fantasma" data-arq-mais' + (st.ocupado ? ' disabled' : '') + '>Mais pedidos</button>' : '') +
            (st.ocupado ? '<p role="status">Buscando pedidos arquivados…</p>' : '');
        var btn = root.querySelector('[data-arq-buscar]'); if (btn) btn.disabled = st.ocupado;
        var s = st, seq = s.seq;
        el.querySelectorAll('[data-arq-img]').forEach(function (img) { img.onerror = function () {
            if (!valida(s, seq) || !img.isConnected) return;
            var cam = img.getAttribute('data-arq-img'), cd = img.getAttribute('data-arq-cd'); delete st.urls[cam]; st.vendo[cd + '|' + cam] = false;
            if (st.fotos[cd]) st.fotos[cd].erro = 'Foto indisponível ou link expirado. Abra novamente para tentar.'; desenharResultados();
        }; });
    }
    function buscar(q, mais) {
        if (!st.sb) return Promise.resolve();
        var s = st, ultimo = mais && s.lista[s.lista.length - 1];
        if (!mais) s.seq++;
        var seq = s.seq, req = ++s.req;
        if (!mais) { s.q = q; s.lista = []; s.mais = false; s.fotos = {}; s.urls = {}; s.vendo = {}; s.assinando = {}; s.abertos = {}; }
        s.ocupado = true; s.erro = ''; s.buscou = true; desenharResultados();
        return s.sb.rpc('rota_057_buscar', { p_busca: s.q.busca || '', p_de: s.q.de || null, p_ate: s.q.ate || null,
            p_antes: ultimo ? ultimo.ultimo_canhoto_em : null, p_antes_cd: ultimo ? Number(ultimo.cd_pedido) : null, p_limite: TAM + 1 }).then(function (r) {
            if (!buscaValida(s, seq, req)) return;
            if (r.error) throw r.error;
            if (!Array.isArray(r.data)) throw new Error('resposta invalida');
            s.mais = r.data.length > TAM; var vistos = {}; s.lista.forEach(function (p) { vistos[p.cd_pedido] = true; });
            r.data.slice(0, TAM).forEach(function (p) { if (!vistos[p.cd_pedido]) { vistos[p.cd_pedido] = true; s.lista.push(p); } });
        }).catch(function (e) { if (buscaValida(s, seq, req)) s.erro = erro(e); }).then(function () { if (buscaValida(s, seq, req)) { s.ocupado = false; desenharResultados(); } });
    }
    function carregarFotos(cd) {
        var s = st, seq = s.seq, f = s.fotos[cd] || (s.fotos[cd] = { lista: [], mais: false, de: 0, ocupado: false, erro: '' });
        if (f.ocupado) return Promise.resolve(); f.ocupado = true; f.erro = ''; desenharResultados();
        return s.sb.from('pedido_arquivo_foto').select('caminho,enviado_em,origem,substituido_em,removido_em').eq('cd_pedido', Number(cd)).is('removido_em', null)
            .order('enviado_em', { ascending: false }).order('caminho', { ascending: true }).range(f.de, f.de + FOTOS).then(function (r) {
                if (!valida(s, seq)) return; if (r.error) throw r.error;
                var linhas = r.data || [], vistos = {}; f.lista.forEach(function (x) { vistos[x.caminho] = true; });
                linhas.slice(0, FOTOS).forEach(function (x) { if (!vistos[x.caminho]) { vistos[x.caminho] = true; f.lista.push(x); } });
                f.de += Math.min(FOTOS, linhas.length); f.mais = linhas.length > FOTOS;
            }).catch(function (e) { if (valida(s, seq)) f.erro = erro(e); }).then(function () { if (valida(s, seq)) { f.ocupado = false; desenharResultados(); } });
    }
    function verFoto(cd, cam) {
        var s = st, seq = s.seq, key = cd + '|' + cam, u = s.urls[cam];
        if (s.vendo[key] && u && u.ate > Date.now()) { s.vendo[key] = false; desenharResultados(); return Promise.resolve(); }
        if (u && u.ate > Date.now()) { s.vendo[key] = true; desenharResultados(); return Promise.resolve(); }
        if (s.assinando[cam]) return Promise.resolve(); s.assinando[cam] = true; desenharResultados();
        return Promise.resolve().then(function () { return raiz.TempRioCanhoto.urlAssinada(s.sb, cam); }).then(function (url) {
            if (!valida(s, seq)) return; var segura = assinaturaUrl(url); if (!segura) throw new Error('url invalida');
            s.urls[cam] = { url: segura, ate: Date.now() + 110000 }; s.vendo[key] = true; if (s.fotos[cd]) s.fotos[cd].erro = '';
        }).catch(function () { if (valida(s, seq) && s.fotos[cd]) s.fotos[cd].erro = 'Não foi possível abrir a foto. Tente novamente.'; }).then(function () {
            if (valida(s, seq)) { delete s.assinando[cam]; desenharResultados(); }
        });
    }
    function desenhar(alvo, ctx) {
        ctx = ctx || {}; if (!alvo || !ctx.sb || ['admin', 'vendedor'].indexOf(ctx.papel) < 0) { sair(); if (alvo) alvo.innerHTML = ''; return; }
        if (st.sb && st.sb !== ctx.sb) sair(); st.alvo = alvo; st.sb = ctx.sb;
        alvo.innerHTML = '<details class="adm-card p-5 mt-5"><summary class="font-bold">Canhotos arquivados · buscar entregas antigas</summary>' +
            '<p class="text-xs mt-3">Pedido e comprovantes guardados por um ano após o último canhoto. Busca pelo faturamento, em São Paulo; sem essa data, usa a data do pedido ou, se ambas faltarem, o arquivamento.</p>' +
            '<form class="flex flex-wrap gap-3 mt-3" data-arq-form><label>Nº do pedido, cliente ou CNPJ<input class="adm-input" name="busca" maxlength="150" value="' + esc(st.q.busca || '') + '"></label>' +
            '<label>De<input type="date" name="de" class="adm-input" value="' + esc(st.q.de || '') + '"></label><label>Até<input type="date" name="ate" class="adm-input" value="' + esc(st.q.ate || '') + '"></label>' +
            '<button type="submit" class="adm-botao" data-arq-buscar>Buscar</button></form><div class="mt-4" data-arq-resultados aria-live="polite"></div></details>';
        if (!alvo._arquivoLigado) {
        alvo._arquivoLigado = true;
        alvo.addEventListener('submit', function (ev) {
            var form = ev.target.closest('[data-arq-form]'); if (!form) return; ev.preventDefault();
            var q = { busca: form.elements.busca.value.trim(), de: form.elements.de.value, ate: form.elements.ate.value };
            if (q.de && q.ate && q.de > q.ate) { st.erro = 'A data inicial precisa ser anterior à final.'; desenharResultados(); return; } buscar(q, false);
        });
        alvo.addEventListener('toggle', function (ev) {
            var el = ev.target; if (!el.matches('[data-arq-pedido]')) return; var cd = el.getAttribute('data-arq-pedido');
            st.abertos[cd] = el.open; if (el.open && !st.fotos[cd]) carregarFotos(cd);
        }, true);
        alvo.addEventListener('click', function (ev) {
            var b = ev.target.closest('button'); if (!b || !alvo.contains(b)) return;
            if (b.hasAttribute('data-arq-mais')) buscar(st.q, true);
            else if (b.hasAttribute('data-arq-fotos')) carregarFotos(b.getAttribute('data-arq-fotos'));
            else if (b.hasAttribute('data-arq-ver')) verFoto(b.getAttribute('data-arq-cd'), b.getAttribute('data-arq-ver'));
        });
        }
        desenharResultados();
    }
    function sair() { if (st.alvo) st.alvo.innerHTML = ''; st = novo(); }
    raiz.TempRioArquivoCanhotos = { desenhar: desenhar, sair: sair };
})(typeof window !== 'undefined' ? window : globalThis);
