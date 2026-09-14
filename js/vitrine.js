/* Vitrine "Onde comprar Temp Rio".
 *
 * O QUE ESTA FUNCIONALIDADE É — e o que ela não é.
 *
 * O pedido original falava em "o cliente destacar seus produtos". Aqui isso não
 * existe: os clientes são lojistas que COMPRAM os 73 temperos; eles não têm
 * produtos no catálogo. O que eles querem ganhar comprando mais é consumidor
 * entrando na loja deles.
 *
 * Então a vitrine destaca a LOJA: nome, bairro e endereço do lojista numa seção
 * "Onde comprar", com prazo. É cortesia por volume, não um produto vendido.
 *
 * Este arquivo tem a regra de sugestão (sem DOM, testável isolada) e a leitura
 * das vitrines aprovadas. A interface vive em js/pedido.js e js/admin.js.
 *
 * Carregado no <head>, depois de js/config.js.
 */
(function () {
    'use strict';

    var cfg = (typeof siteConfig !== 'undefined' && siteConfig.vitrine) || {
        // Limiares em CAIXAS. Os números originais (10/30) não serviam: o
        // pedido mínimo já é 10 caixas, então todo pedido nasceria no teto do
        // Basic. Estes mantêm a proporção da ideia sobre os números reais.
        planos: [
            { tipo: 'basic',   rotulo: 'Basic Display',   ateCaixas: 20,   dias: 1 },
            { tipo: 'pro',     rotulo: 'Pro Display',     ateCaixas: 60,   dias: 3 },
            { tipo: 'premium', rotulo: 'Premium Display', ateCaixas: null, dias: 7 }
        ],
        // Gatilhos: basta um.
        caixasParaSugerir: 21,
        pedidosParaSugerir: 2,
        // Sobe um nível.
        pedidosParaRecorrente: 3,
        valorParaBonusCentavos: 576000, // 3x o pedido mínimo
        ufsPermitidas: ['RJ']
    };

    function planos() { return cfg.planos; }

    function planoPorCaixas(caixas) {
        var lista = planos();
        for (var i = 0; i < lista.length; i++) {
            if (lista[i].ateCaixas === null || caixas <= lista[i].ateCaixas) return lista[i];
        }
        return lista[lista.length - 1];
    }

    function subirUmNivel(plano) {
        var lista = planos();
        var i = lista.indexOf(plano);
        return (i >= 0 && i < lista.length - 1) ? lista[i + 1] : plano;
    }

    /* Regra de sugestão.
     *
     * `pedido`   : { caixas, valorCentavos, uf }
     * `historico`: { pedidos, caixas, valorCentavos } — do cliente, incluindo o atual
     *
     * Devolve sempre um objeto com `elegivel` e, quando elegível, o plano e os
     * motivos. Os motivos são exibidos para o lojista: "você ganhou porque..."
     * converte melhor do que um prêmio sem explicação.
     */
    function sugerir(pedido, historico) {
        pedido = pedido || {};
        historico = historico || { pedidos: 1 };

        var caixas = Number(pedido.caixas) || 0;
        var valor = Number(pedido.valorCentavos) || 0;
        var qtdPedidos = Number(historico.pedidos) || 1;

        // Exclusividade Rio. Redundante hoje — o site só fecha pedido para CEP
        // do Rio —, mas explícita aqui para não depender daquela regra.
        var uf = String(pedido.uf || '').toUpperCase();
        if (uf && cfg.ufsPermitidas.indexOf(uf) === -1) {
            return { elegivel: false, motivo: 'fora-do-rio' };
        }

        // Gatilho: segundo pedido OU pedido grande. Basta um.
        var porRecorrencia = qtdPedidos >= cfg.pedidosParaSugerir;
        var porVolume = caixas >= cfg.caixasParaSugerir;
        if (!porRecorrencia && !porVolume) {
            return {
                elegivel: false,
                motivo: 'abaixo-do-gatilho',
                faltamCaixas: Math.max(0, cfg.caixasParaSugerir - caixas)
            };
        }

        var plano = planoPorCaixas(caixas);
        var motivos = [];

        if (porVolume) motivos.push(caixas + ' caixas neste pedido');
        if (porRecorrencia && !porVolume) motivos.push(qtdPedidos + 'º pedido com a gente');

        // Bônus sobem um nível cada, sem passar do topo.
        if (qtdPedidos >= cfg.pedidosParaRecorrente) {
            plano = subirUmNivel(plano);
            motivos.push('cliente recorrente (' + qtdPedidos + ' pedidos)');
        }
        if (valor >= cfg.valorParaBonusCentavos) {
            plano = subirUmNivel(plano);
            motivos.push('pedido acima de ' + formatarBRL(cfg.valorParaBonusCentavos));
        }

        return {
            elegivel: true,
            tipo: plano.tipo,
            rotulo: plano.rotulo,
            dias: plano.dias,
            motivos: motivos
        };
    }

    var BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    function formatarBRL(c) { return BRL.format((c || 0) / 100); }

    /* Dias restantes de uma vitrine ativa.
     *
     * REGRA: `data_fim` é o ÚLTIMO DIA INCLUSIVE. Um plano de 3 dias aprovado
     * hoje termina depois de amanhã (hoje + 2), e a contagem diz "3 dias" no
     * primeiro dia — que é o que a pessoa espera ler de um plano de 3 dias.
     *
     * Conta em dias de calendário, não em milissegundos: com diferença de
     * horas, "termina hoje" viraria 0 dias às 23h e a vitrine sumiria da tela
     * antes de o dia acabar. */
    function diasRestantes(dataFim) {
        if (!dataFim) return 0;

        var fim = new Date(String(dataFim).slice(0, 10) + 'T00:00:00');
        var hoje = new Date();
        hoje.setHours(0, 0, 0, 0);

        var dias = Math.round((fim - hoje) / 86400000);
        return dias < 0 ? 0 : dias + 1; // +1 porque o dia final conta inteiro
    }

    function textoContagem(dataFim) {
        var d = diasRestantes(dataFim);
        if (d <= 0) return 'Destaque encerrado';
        return d === 1 ? 'Em destaque por mais 1 dia' : 'Em destaque por mais ' + d + ' dias';
    }

    /* ===================================================================
     * Leitura pública
     *
     * Lê a VIEW vitrines_publicas, não a tabela. A view expõe só o que o
     * consumidor precisa para achar a loja — nome, bairro, cidade — e deixa de
     * fora telefone, e-mail e CNPJ do comprador, que não têm por que ser
     * públicos. Ver admin/supabase-vitrine.sql.
     * =================================================================== */
    function cfgSupabase() {
        var s = (typeof siteConfig !== 'undefined' && siteConfig.supabase) || null;
        return (s && s.url && s.anonKey) ? s : null;
    }

    function listarAtivas() {
        var c = cfgSupabase();
        if (!c) return Promise.resolve([]);

        var url = c.url.replace(/\/+$/, '') +
            '/rest/v1/vitrines_publicas?select=*&order=peso.desc,data_fim.asc';

        return fetch(url, { headers: { apikey: c.anonKey, Authorization: 'Bearer ' + c.anonKey } })
            .then(function (r) { return r.ok ? r.json() : []; })
            .catch(function () { return []; });
    }

    /* ===================================================================
     * Seção "Onde comprar" no catálogo
     * =================================================================== */
    function esc(t) {
        return String(t == null ? '' : t)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function cartaoLoja(v) {
        var endereco = [v.logradouro, v.numero].filter(Boolean).join(', ');
        return '' +
        '<div class="cart-line p-5 flex flex-col">' +
            '<div class="flex items-start justify-between gap-3 mb-3">' +
                '<p class="font-bold text-white uppercase tracking-wide text-sm leading-tight">' +
                    esc(v.razao_social) + '</p>' +
                '<i class="fa-solid fa-store text-primary-500 shrink-0"></i>' +
            '</div>' +
            '<p class="text-xs text-textSecondary font-light leading-relaxed flex-1">' +
                (endereco ? esc(endereco) + '<br>' : '') +
                esc([v.bairro, v.cidade].filter(Boolean).join(' · ')) +
            '</p>' +
            // A contagem é a promessa que o lojista comprou: fica visível.
            '<p class="text-[0.65rem] font-bold uppercase tracking-widest text-primary-400 mt-4 pt-3"' +
                ' style="border-top:1px solid rgba(255,255,255,.06)">' +
                '<i class="fa-regular fa-clock mr-1"></i>' + esc(textoContagem(v.data_fim)) +
            '</p>' +
        '</div>';
    }

    function montarSecao() {
        var alvo = document.getElementById('vitrine-secao');
        if (!alvo) return;

        listarAtivas().then(function (lista) {
            // Sem loja em destaque, a seção não existe. Um título sozinho com
            // um vazio embaixo é pior do que nada.
            if (!lista.length) { alvo.classList.add('hidden'); return; }

            alvo.classList.remove('hidden');
            alvo.innerHTML =
                '<div class="flex flex-col md:flex-row md:items-end justify-between mb-6 gap-3">' +
                    '<div>' +
                        '<h2 class="text-2xl md:text-3xl font-bold tracking-tight mb-2">Onde comprar</h2>' +
                        '<p class="text-textSecondary font-light text-sm max-w-xl">' +
                            'Lojas parceiras com os temperos Temp Rio à venda agora.</p>' +
                    '</div>' +
                '</div>' +
                '<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">' +
                    lista.map(cartaoLoja).join('') +
                '</div>';
        });
    }

    window.Vitrine = {
        config: cfg,
        planos: planos,
        sugerir: sugerir,
        diasRestantes: diasRestantes,
        textoContagem: textoContagem,
        listarAtivas: listarAtivas,
        montarSecao: montarSecao
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', montarSecao);
    } else {
        montarSecao();
    }
})();
