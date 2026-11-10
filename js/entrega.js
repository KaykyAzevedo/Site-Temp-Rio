/* Regiões de entrega: qual região atende um CEP, quanto custa e em quantos dias.
 *
 * Fonte dos dados, em ordem:
 *   1. o banco (tabela `regioes`), quando o Supabase estiver configurado —
 *      é o que permite ativar e desativar região em tempo real pelo painel;
 *   2. data/regioes.js, quando não estiver — o site continua funcionando.
 *
 * Não escreve nada e não toca no DOM. A interface vive em js/pedido.js.
 *
 * Carregado no <head>, depois de js/config.js e data/regioes.js.
 */
(function () {
    'use strict';

    var regioes = [];
    var origem = 'local';
    var carregando = null;

    function semanteLocal() {
        return (typeof regioesEntrega !== 'undefined' && Array.isArray(regioesEntrega))
            ? regioesEntrega.map(function (r) { return r; })
            : [];
    }

    /* CEP normalizado: só os 8 dígitos. Comparar faixa como TEXTO de largura
     * fixa evita o problema de "20000000" virar número e perder o zero à
     * esquerda em CEPs que começam com 0 (São Paulo, por exemplo). */
    function normalizarCep(valor) {
        var d = String(valor == null ? '' : valor).replace(/\D/g, '');
        return d.length === 8 ? d : null;
    }

    function cepValido(valor) {
        return normalizarCep(valor) !== null;
    }

    function dentroDaFaixa(cep, faixa) {
        return cep >= String(faixa.inicio) && cep <= String(faixa.fim);
    }

    /* Qual região atende este CEP.
     *
     * Quando o CEP cai em mais de uma faixa — o que acontece de propósito, já
     * que "Resto do estado" cobre tudo —, vence a de maior prioridade. Sem essa
     * regra, a ordem do array decidiria o frete, o que é um jeito silencioso de
     * cobrar errado. */
    function regiaoDoCep(valorCep) {
        var cep = normalizarCep(valorCep);
        if (!cep) return null;

        var candidatas = regioes.filter(function (r) {
            return (r.faixas || []).some(function (f) { return dentroDaFaixa(cep, f); });
        });

        if (!candidatas.length) return null;

        /* A ORDEM AQUI IMPORTA, E JÁ CAUSOU UM BUG.
         *
         * A versão anterior descartava as regiões inativas ANTES de escolher a
         * mais específica. Resultado: suspender São Gonçalo não suspendia nada —
         * o CEP caía na região "Resto do estado", que cobre o estado inteiro, e
         * o site seguia vendendo, cobrando outro frete. O administrador achava
         * que tinha fechado a área.
         *
         * A regra correta: a região MAIS ESPECÍFICA que cobre o CEP é quem
         * manda, esteja ela ativa ou não. Se ela estiver suspensa, a resposta é
         * "indisponível" — nunca cair numa região mais ampla por baixo.
         *
         * Entre regiões de MESMA prioridade, aí sim a ativa ganha: é empate
         * real, não uma específica sendo atropelada por uma genérica. */
        candidatas.sort(function (a, b) {
            var porPrioridade = (b.prioridade || 0) - (a.prioridade || 0);
            if (porPrioridade !== 0) return porPrioridade;
            return (b.ativo ? 1 : 0) - (a.ativo ? 1 : 0);
        });
        return candidatas[0];
    }

    /* A resposta que a tela precisa, num objeto só.
     *
     * Distingue três situações que são diferentes para o cliente:
     *   - 'atende'      → há região ativa; mostra taxa e prazo
     *   - 'indisponivel'→ a região existe mas está desativada agora
     *   - 'fora'        → nenhuma região cobre esse CEP
     *
     * Separar "indisponível" de "fora" importa: no primeiro caso a área é sua e
     * a entrega volta; no segundo você nunca atendeu ali. O texto que o cliente
     * lê muda, e a lista de espera faz sentido nos dois, por motivos distintos.
     */
    function consultar(valorCep) {
        var cep = normalizarCep(valorCep);
        if (!cep) return { situacao: 'cep-invalido', regiao: null };

        var regiao = regiaoDoCep(cep);
        if (!regiao) return { situacao: 'fora', regiao: null };

        // Região suspensa NÃO cai para uma região mais ampla: a decisão de
        // suspender é da administração e vale.
        if (!regiao.ativo) return { situacao: 'indisponivel', regiao: regiao };

        return {
            situacao: 'atende',
            regiao: regiao,
            taxaCentavos: Number(regiao.taxaCentavos) || 0,
            prazoDias: Number(regiao.prazoDias) || 0
        };
    }

    /* Todos os bairros conhecidos, para o autocompletar. Só das regiões ativas:
     * sugerir um bairro que não é atendido leva o cliente a preencher o pedido
     * inteiro para tomar um não no fim. */
    function bairrosAtendidos() {
        var vistos = Object.create(null);
        var saida = [];
        regioes.forEach(function (r) {
            if (!r.ativo) return;
            (r.bairros || []).forEach(function (b) {
                var chave = b.toLowerCase();
                if (vistos[chave]) return;
                vistos[chave] = true;
                saida.push({ bairro: b, regiao: r.nome });
            });
        });
        return saida.sort(function (a, b) { return a.bairro.localeCompare(b.bairro, 'pt-BR'); });
    }

    function formatarPrazo(dias) {
        if (!dias) return 'a combinar';
        return dias === 1 ? 'até 1 dia útil' : 'até ' + dias + ' dias úteis';
    }

    /* ===================================================================
     * Carregamento
     * =================================================================== */
    function cfgSupabase() {
        var s = (typeof siteConfig !== 'undefined' && siteConfig.supabase) || null;
        return (s && s.url && s.anonKey) ? s : null;
    }

    /* As regiões são o único dado que o site PRECISA ler do banco: sem elas o
     * cliente não sabe o frete. Por isso a política de RLS libera leitura desta
     * tabela para visitante anônimo — e só dela. Não há dado pessoal aqui. */
    function carregarDoBanco() {
        var c = cfgSupabase();
        if (!c) return Promise.reject(new Error('sem supabase'));

        var base = c.url.replace(/\/+$/, '');
        var cab = { apikey: c.anonKey, Authorization: 'Bearer ' + c.anonKey };

        return Promise.all([
            fetch(base + '/rest/v1/regioes?select=*&order=prioridade.desc', { headers: cab }),
            fetch(base + '/rest/v1/regioes_faixas_cep?select=*', { headers: cab })
        ]).then(function (rs) {
            if (!rs[0].ok || !rs[1].ok) throw new Error('HTTP ' + rs[0].status + '/' + rs[1].status);
            return Promise.all([rs[0].json(), rs[1].json()]);
        }).then(function (dados) {
            var faixasPorRegiao = {};
            dados[1].forEach(function (f) {
                (faixasPorRegiao[f.regiao_id] = faixasPorRegiao[f.regiao_id] || [])
                    .push({ inicio: f.cep_inicio, fim: f.cep_fim });
            });

            return dados[0].map(function (r) {
                return {
                    id: r.id,
                    nome: r.nome,
                    prioridade: r.prioridade,
                    ativo: r.ativo,
                    taxaCentavos: r.taxa_centavos,
                    prazoDias: r.prazo_dias,
                    bairros: r.bairros || [],
                    faixas: faixasPorRegiao[r.id] || []
                };
            });
        });
    }

    function carregar() {
        if (carregando) return carregando;

        regioes = semanteLocal(); // já responde enquanto o banco não chega
        origem = 'local';

        carregando = carregarDoBanco()
            .then(function (doBanco) {
                if (doBanco.length) {
                    regioes = doBanco;
                    origem = 'banco';
                }
                return regioes;
            })
            .catch(function () {
                // Sem banco (ou banco fora do ar) o site segue com o arquivo
                // local. Vale avisar no console: as mudanças feitas no painel
                // não estarão valendo.
                if (cfgSupabase()) {
                    console.warn('[entrega] não foi possível ler as regiões do banco; ' +
                                 'usando data/regioes.js. O que estiver desativado no painel ' +
                                 'não vai valer nesta sessão.');
                }
                return regioes;
            });

        return carregando;
    }

    window.Entrega = {
        carregar: carregar,
        pronto: function () { return carregando || carregar(); },
        origem: function () { return origem; },
        regioes: function () { return regioes.slice(); },

        cepValido: cepValido,
        normalizarCep: normalizarCep,
        consultar: consultar,
        regiaoDoCep: regiaoDoCep,
        bairrosAtendidos: bairrosAtendidos,
        formatarPrazo: formatarPrazo
    };

    carregar();
})();
