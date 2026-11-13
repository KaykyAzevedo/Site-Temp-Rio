/* Painel de administrador.
 *
 * Só lê e atualiza o que as políticas de RLS permitem. A proteção real está no
 * banco (admin/supabase.sql), não aqui: esconder um botão não protege dado
 * nenhum, então nem tentamos fingir que protege.
 *
 * Regra de segurança da tela: tudo que veio do banco é dado de cliente e entra
 * por textContent, nunca por innerHTML.
 */
(function () {
    'use strict';

    var cfg = (typeof siteConfig !== 'undefined' && siteConfig.supabase) || {};
    var $ = function (s) { return document.querySelector(s); };

    /* ===================================================================
     * Formatação
     * =================================================================== */
    var BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    var NUM = new Intl.NumberFormat('pt-BR');

    function brl(centavos) { return BRL.format((centavos || 0) / 100); }

    // Eixo com números curtos: "R$ 12 mil" em vez de "R$ 12.000,00".
    function brlCurto(centavos) {
        var v = (centavos || 0) / 100;
        if (v >= 1000000) return 'R$ ' + (v / 1000000).toFixed(1).replace('.', ',') + ' mi';
        if (v >= 1000) return 'R$ ' + Math.round(v / 1000) + ' mil';
        return 'R$ ' + Math.round(v);
    }

    var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

    function rotuloMes(iso) {
        var p = String(iso).split('-');
        return MESES[Number(p[1]) - 1] + '/' + p[0].slice(2);
    }

    function dataHora(iso) {
        var d = new Date(iso);
        return d.toLocaleDateString('pt-BR') + ' ' +
               d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function esc(t) {
        return String(t == null ? '' : t)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    var STATUS = {
        aguardando: { rotulo: 'Aguardando', icone: 'fa-clock' },
        confirmado: { rotulo: 'Confirmado', icone: 'fa-circle-check' },
        entregue:   { rotulo: 'Entregue',   icone: 'fa-truck' },
        cancelado:  { rotulo: 'Cancelado',  icone: 'fa-circle-xmark' }
    };

    // Cor sempre acompanhada de ícone e rótulo: status nunca é só cor.
    function selo(status) {
        var s = STATUS[status] || { rotulo: status, icone: 'fa-circle' };
        return '<span class="adm-selo adm-selo-' + esc(status) + '">' +
               '<i class="fa-solid ' + s.icone + '"></i>' + esc(s.rotulo) + '</span>';
    }

    /* ===================================================================
     * Dica de valor
     * =================================================================== */
    var dica = null;

    function mostrarDica(evento, html) {
        if (!dica) dica = $('#dica');
        dica.innerHTML = html;
        dica.classList.add('is-visivel');
        var caixa = dica.getBoundingClientRect();
        var x = Math.min(evento.clientX + 14, window.innerWidth - caixa.width - 10);
        var y = Math.max(evento.clientY - caixa.height - 12, 8);
        dica.style.left = x + 'px';
        dica.style.top = y + 'px';
    }

    function esconderDica() {
        if (dica) dica.classList.remove('is-visivel');
    }

    /* ===================================================================
     * Gráficos em SVG
     *
     * Feitos à mão em vez de biblioteca: são duas formas, de uma série cada, e
     * assim o painel não carrega 200 KB para desenhar barras e uma linha.
     * =================================================================== */
    var SVG_NS = 'http://www.w3.org/2000/svg';

    function el(nome, atrs) {
        var e = document.createElementNS(SVG_NS, nome);
        Object.keys(atrs || {}).forEach(function (k) { e.setAttribute(k, atrs[k]); });
        return e;
    }

    /* Escala do eixo: passo redondo primeiro, teto depois.
     *
     * O caminho ingênuo — arredondar o máximo para 1/2/2.5/5/10 × potência de
     * dez — produz duas coisas ruins: um máximo de 27 vira teto 50, jogando
     * metade do gráfico fora, e as marcações intermediárias saem quebradas
     * (12,5 virando "13"). Aqui o passo é escolhido redondo e o teto é o
     * primeiro múltiplo dele que cabe o dado. Toda marcação sai limpa. */
    function escala(max) {
        if (!(max > 0)) return { teto: 1, marcas: [0, 1] };

        var bruto = max / 4; // quatro faixas é a meta; o teto ajusta para 3 a 5
        var mag = Math.pow(10, Math.floor(Math.log10(bruto)));
        var passo = [1, 2, 2.5, 5, 10]
            .map(function (m) { return m * mag; })
            .filter(function (p) { return p >= bruto; })[0] || 10 * mag;

        var teto = Math.ceil(max / passo) * passo;
        var marcas = [];
        for (var v = 0; v <= teto + passo / 2; v += passo) marcas.push(v);
        return { teto: teto, marcas: marcas };
    }

    /* Colunas. Barra no máximo 24px (o resto da faixa é ar), topo arredondado
     * em 4px e base quadrada na linha de referência. */
    function desenharColunas(destino, dados, opcoes) {
        opcoes = opcoes || {};
        var L = 58, R = 16, T = 22, B = 34;
        var largura = destino.clientWidth || 720;
        var altura = opcoes.altura || 240;
        var pw = Math.max(60, largura - L - R);
        var ph = altura - T - B;

        var svg = el('svg', {
            viewBox: '0 0 ' + largura + ' ' + altura,
            class: 'adm-grafico', role: 'img',
            'aria-label': opcoes.descricao || 'Gráfico de colunas'
        });

        var esc_ = escala(Math.max.apply(null, dados.map(function (d) { return d.valor; }).concat([0])));
        var max = esc_.teto;
        var y = function (v) { return T + ph - (v / max) * ph; };

        // Grade e marcações: 1px sólido, recessivo.
        esc_.marcas.forEach(function (v) {
            var vy = y(v);
            svg.appendChild(el('line', {
                x1: L, x2: L + pw, y1: vy, y2: vy,
                class: v === 0 ? 'adm-eixo' : 'adm-grade'
            }));
            var t = el('text', { x: L - 8, y: vy + 3, class: 'adm-tick', 'text-anchor': 'end' });
            t.textContent = opcoes.formatarEixo ? opcoes.formatarEixo(v) : NUM.format(Math.round(v));
            svg.appendChild(t);
        });

        var faixa = pw / Math.max(dados.length, 1);
        var GAP = 2; // separação feita por vão na cor do fundo, não por contorno
        var larguraBarra = Math.min(24, Math.max(4, faixa - GAP * 2));
        var maiorValor = Math.max.apply(null, dados.map(function (d) { return d.valor; }).concat([0]));

        dados.forEach(function (d, i) {
            var cx = L + faixa * i + faixa / 2;
            var bx = cx - larguraBarra / 2;
            var by = y(d.valor);
            var bh = Math.max(0, T + ph - by);

            if (bh > 0) {
                var r = Math.min(4, larguraBarra / 2, bh);
                svg.appendChild(el('path', {
                    class: 'adm-barra',
                    d: 'M' + bx + ',' + (by + bh) +
                       ' L' + bx + ',' + (by + r) +
                       ' Q' + bx + ',' + by + ' ' + (bx + r) + ',' + by +
                       ' L' + (bx + larguraBarra - r) + ',' + by +
                       ' Q' + (bx + larguraBarra) + ',' + by + ' ' + (bx + larguraBarra) + ',' + (by + r) +
                       ' L' + (bx + larguraBarra) + ',' + (by + bh) + ' Z'
                }));
            }

            // Rótulo direto só no maior valor: número em cima de tudo é ruído.
            if (d.valor > 0 && d.valor === maiorValor && opcoes.rotularMaior) {
                var rot = el('text', {
                    x: cx, y: by - 7, class: 'adm-rotulo-direto', 'text-anchor': 'middle'
                });
                rot.textContent = opcoes.formatarRotulo ? opcoes.formatarRotulo(d.valor) : NUM.format(d.valor);
                svg.appendChild(rot);
            }

            var tick = el('text', { x: cx, y: altura - 12, class: 'adm-tick', 'text-anchor': 'middle' });
            tick.textContent = d.rotulo;
            svg.appendChild(tick);

            // Alvo de mouse mais largo que a barra: barra fina não deve exigir
            // precisão de cirurgião.
            var alvo = el('rect', {
                x: L + faixa * i, y: T, width: faixa, height: ph, class: 'adm-col-alvo'
            });
            alvo.addEventListener('mousemove', function (ev) {
                mostrarDica(ev, opcoes.dica ? opcoes.dica(d) : esc(d.rotulo) + ': ' + NUM.format(d.valor));
            });
            alvo.addEventListener('mouseleave', esconderDica);
            svg.appendChild(alvo);
        });

        destino.innerHTML = '';
        destino.appendChild(svg);
    }

    /* Linha de 2px com preenchimento de área a 10% e marcador na ponta. */
    function desenharLinha(destino, dados, opcoes) {
        opcoes = opcoes || {};
        var L = 58, R = 20, T = 22, B = 34;
        var largura = destino.clientWidth || 720;
        var altura = opcoes.altura || 240;
        var pw = Math.max(60, largura - L - R);
        var ph = altura - T - B;

        var svg = el('svg', {
            viewBox: '0 0 ' + largura + ' ' + altura,
            class: 'adm-grafico', role: 'img',
            'aria-label': opcoes.descricao || 'Gráfico de linha'
        });

        var esc_ = escala(Math.max.apply(null, dados.map(function (d) { return d.valor; }).concat([0])));
        var max = esc_.teto;
        var y = function (v) { return T + ph - (v / max) * ph; };
        var x = function (i) {
            return dados.length === 1 ? L + pw / 2 : L + (pw * i) / (dados.length - 1);
        };

        esc_.marcas.forEach(function (v) {
            var vy = y(v);
            svg.appendChild(el('line', {
                x1: L, x2: L + pw, y1: vy, y2: vy,
                class: v === 0 ? 'adm-eixo' : 'adm-grade'
            }));
            var t = el('text', { x: L - 8, y: vy + 3, class: 'adm-tick', 'text-anchor': 'end' });
            t.textContent = opcoes.formatarEixo ? opcoes.formatarEixo(v) : NUM.format(Math.round(v));
            svg.appendChild(t);
        });

        if (dados.length) {
            var pontos = dados.map(function (d, i) { return x(i) + ',' + y(d.valor); });
            svg.appendChild(el('path', {
                class: 'adm-area',
                d: 'M' + x(0) + ',' + (T + ph) + ' L' + pontos.join(' L') +
                   ' L' + x(dados.length - 1) + ',' + (T + ph) + ' Z'
            }));
            svg.appendChild(el('path', { class: 'adm-linha', d: 'M' + pontos.join(' L') }));

            // Marcador final com anel na cor da superfície.
            var ult = dados.length - 1;
            svg.appendChild(el('circle', { cx: x(ult), cy: y(dados[ult].valor), r: 4.5, class: 'adm-ponto' }));

            dados.forEach(function (d, i) {
                var tick = el('text', { x: x(i), y: altura - 12, class: 'adm-tick', 'text-anchor': 'middle' });
                // Com muitos pontos, mostra um rótulo a cada dois.
                tick.textContent = (dados.length > 8 && i % 2 === 1) ? '' : d.rotulo;
                svg.appendChild(tick);

                var meia = dados.length === 1 ? pw : pw / Math.max(dados.length - 1, 1);
                var alvo = el('rect', {
                    x: x(i) - meia / 2, y: T, width: meia, height: ph, class: 'adm-col-alvo'
                });
                alvo.addEventListener('mousemove', function (ev) {
                    mostrarDica(ev, opcoes.dica ? opcoes.dica(d) : esc(d.rotulo) + ': ' + NUM.format(d.valor));
                });
                alvo.addEventListener('mouseleave', esconderDica);
                svg.appendChild(alvo);
            });
        }

        destino.innerHTML = '';
        destino.appendChild(svg);
    }

    /* Rosca em vez de pizza fechada: o buraco no meio é onde o total entra
     * como texto, sem precisar de uma legenda separada só para ele. Até 6
     * fatias na cor da marca em opacidades diferentes — mais que isso e a
     * diferença de tom para de ser distinguível; o resto vira "Outras". */
    // Leaflet recebe cor como texto: lê o token computado (com reserva) em vez de repetir hex.
    function corToken(nome, reserva) {
        try { var v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim(); return v || reserva; } catch (e) { return reserva; }
    }
    var CORES_FATIA = ['var(--adm-cat-1)', 'var(--adm-cat-2)', 'var(--adm-cat-3)', 'var(--adm-cat-4)', 'var(--adm-cat-5)', 'var(--adm-cat-6)', 'var(--adm-cat-7)'];

    function desenharPizza(destino, legendaDestino, dados_, opcoes) {
        opcoes = opcoes || {};
        var largura = destino.clientWidth || 320;
        var altura = opcoes.altura || 260;
        var cx = largura / 2, cy = altura / 2;
        var rExterno = Math.min(largura, altura) / 2 - 8;
        var rInterno = rExterno * 0.6;

        var svg = el('svg', {
            viewBox: '0 0 ' + largura + ' ' + altura, class: 'adm-grafico', role: 'img',
            'aria-label': opcoes.descricao || 'Gráfico de rosca'
        });

        var total = dados_.reduce(function (a, d) { return a + d.valor; }, 0);
        if (!total) { destino.innerHTML = ''; destino.appendChild(svg); if (legendaDestino) legendaDestino.innerHTML = ''; return; }

        var anguloAtual = -Math.PI / 2;
        dados_.forEach(function (d, i) {
            var fatia = (d.valor / total) * Math.PI * 2;
            var a0 = anguloAtual, a1 = anguloAtual + fatia;
            anguloAtual = a1;
            var grandeArco = fatia > Math.PI ? 1 : 0;

            var pt = function (r, a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
            var p0e = pt(rExterno, a0), p1e = pt(rExterno, a1);
            var p0i = pt(rInterno, a1), p1i = pt(rInterno, a0);

            var caminho = el('path', {
                class: 'adm-fatia',
                fill: CORES_FATIA[i % CORES_FATIA.length],
                d: 'M' + p0e[0] + ',' + p0e[1] +
                   ' A' + rExterno + ',' + rExterno + ' 0 ' + grandeArco + ' 1 ' + p1e[0] + ',' + p1e[1] +
                   ' L' + p0i[0] + ',' + p0i[1] +
                   ' A' + rInterno + ',' + rInterno + ' 0 ' + grandeArco + ' 0 ' + p1i[0] + ',' + p1i[1] + ' Z'
            });
            caminho.addEventListener('mousemove', function (ev) {
                var pct = Math.round((d.valor / total) * 100);
                mostrarDica(ev, opcoes.dica ? opcoes.dica(d, pct) :
                    '<strong>' + esc(d.rotulo) + '</strong><br>' + NUM.format(d.valor) + ' (' + pct + '%)');
            });
            caminho.addEventListener('mouseleave', esconderDica);
            svg.appendChild(caminho);
        });

        var totalTexto = el('text', { x: cx, y: cy - 4, 'text-anchor': 'middle', class: 'adm-tile-valor', fill: 'currentColor' });
        totalTexto.setAttribute('style', 'font-size:1.1rem;font-weight:700');
        totalTexto.textContent = opcoes.formatarTotal ? opcoes.formatarTotal(total) : NUM.format(total);
        svg.appendChild(totalTexto);
        var totalRotulo = el('text', { x: cx, y: cy + 14, 'text-anchor': 'middle', class: 'adm-tick' });
        totalRotulo.textContent = opcoes.rotuloTotal || 'total';
        svg.appendChild(totalRotulo);

        destino.innerHTML = '';
        destino.appendChild(svg);

        if (legendaDestino) {
            legendaDestino.innerHTML = dados_.map(function (d, i) {
                return '<div class="adm-legenda-item">' +
                    '<span class="adm-legenda-cor" style="background:' + CORES_FATIA[i % CORES_FATIA.length] + '"></span>' +
                    '<span>' + esc(d.rotulo) + '</span>' +
                    '<span class="ml-auto" style="color:var(--adm-tinta-3)">' +
                        (opcoes.formatarLegenda ? opcoes.formatarLegenda(d.valor) : NUM.format(d.valor)) + '</span>' +
                '</div>';
            }).join('');
        }
    }

    /* ===================================================================
     * Estado
     * =================================================================== */
    var sb = null;
    var usuario = null;
    var papel = null; // 'admin' | 'vendedor' — ver migração 014
    var abaAtual = 'hoje'; // item do menu (ver NAV); cada item mostra uma ou mais SEÇÕES (painéis #painel-<seção>)
    var dados = { resumo: [], visitas: [], pedidos: [], espera: [],
                  regioes: [], faixas: [], vitrines: [], usuarios: [], clientes: [],
                  vendasRegiao: [], vendasProduto: [], visitasBrutas: [], leads: [],
                  solicitacoesLgpd: [] };

    // Seções = painéis (#painel-<seção>) com seus desenhistas; o menu agrupa seções em itens (NAV).
    var ABAS = ['dashboard', 'pedidos', 'clientes', 'historico', 'vendas',
                'espera', 'vitrine', 'regioes', 'visitas', 'solidcon', 'leads', 'lgpd', 'lojistas'];

    // Menu: item -> seções que ele mostra. restrito = só admin (mesmo conjunto de antes: vendas, espera, vitrine, regioes,
    // visitas, leads, lgpd e a nova 'lojistas', que saiu da Vitrine). Histórico agora é a vista "Encerrados" de Pedidos.
    var NAV = {
        hoje:     { secoes: ['dashboard'], restrito: false },
        pedidos:  { secoes: ['pedidos'],   restrito: false },
        clientes: { secoes: ['clientes'],  restrito: false },
        estoque:  { secoes: ['vitrine'],   restrito: true },
        vendas:   { secoes: ['vendas', 'visitas'], restrito: true },
        demanda:  { secoes: ['leads', 'espera'],   restrito: true },
        lojistas: { secoes: ['lojistas'],  restrito: true },
        regioes:  { secoes: ['regioes'],   restrito: true },
        solidcon: { secoes: ['solidcon'],  restrito: false },
        lgpd:     { secoes: ['lgpd'],      restrito: true }
    };
    // Nomes antigos de aba (links, atalhos, estado antigo) caem no item novo correspondente.
    var ALIAS_ABA = { dashboard: 'hoje', historico: 'pedidos', vitrine: 'estoque', espera: 'demanda', leads: 'demanda', visitas: 'vendas' };
    var vistaPedidos = 'andamento'; // 'andamento' | 'encerrados' (antigo Histórico)
    function secoesDe(nav) {
        if (nav === 'pedidos' && vistaPedidos === 'encerrados') return ['historico'];
        return (NAV[nav] || NAV.hoje).secoes;
    }
    function secaoVisivel(s) { return secoesDe(abaAtual).indexOf(s) >= 0; }

    /* Abas fora do alcance de um vendedor (migração 014: RLS só libera
     * pedidos/clientes/usuarios para quem não é admin). Esconder a aba é
     * só UX — a proteção de verdade já está no banco; sem isto, o vendedor
     * só veria essas telas permanentemente vazias, o que confunde mais do
     * que ajuda. LGPD entra na lista por um motivo à parte: é área
     * juridicamente sensível (excluir/anonimizar dado de cliente), e as
     * próprias funções RPC da migração 015 já exigem eh_admin() — o
     * vendedor nem conseguiria agir aqui mesmo se visse a aba. */
    var ABAS_SO_ADMIN = ['vendas', 'espera', 'vitrine', 'regioes', 'visitas', 'leads', 'lgpd'];

    /* Filtros globais: afetam Pedidos, Clientes e Dashboard de vendas — as
     * três telas que mostram linha a linha, em vez de um agregado já pronto
     * como o Dashboard principal ou a Lista de espera. */
    var filtros = {
        de: null, ate: null, busca: '', regioes: [], tipoCliente: 'todos', status: []
    };

    var STATUS_TODOS = ['aguardando', 'confirmado', 'entregue', 'cancelado'];

    /* ===================================================================
     * Autenticação
     * =================================================================== */
    function mostrarTela(qual) {
        ['config', 'login', 'painel'].forEach(function (t) {
            $('#tela-' + t).classList.toggle('hidden', t !== qual);
        });
    }

    function iniciar() {
        if (!cfg.url || !cfg.anonKey) {
            mostrarTela('config');
            return;
        }
        if (typeof window.supabase === 'undefined') {
            mostrarTela('config');
            console.error('[painel] biblioteca do Supabase não carregou.');
            return;
        }

        sb = window.supabase.createClient(cfg.url, cfg.anonKey);

        sb.auth.getSession().then(function (r) {
            if (r.data && r.data.session) {
                usuario = r.data.session.user;
                abrirPainel();
            } else {
                mostrarTela('login');
            }
        });

        $('#form-login').addEventListener('submit', entrar);
        $('#btn-sair').addEventListener('click', sair);
        $('#btn-atualizar').addEventListener('click', function () {
            abrirJanelaAnim();
            carregar();
            recarregarErp();
            saudeAtualizar();
        });
        $('#filtro-periodo').addEventListener('change', function () { carregar(); });

        document.querySelectorAll('.adm-aba').forEach(function (b) {
            b.addEventListener('click', function () { trocarAba(b.getAttribute('data-aba')); });
        });

        ligarFiltrosGlobais();
        document.querySelectorAll('[data-vista-pedidos]').forEach(function (b) {
            b.addEventListener('click', function () {
                vistaPedidos = b.getAttribute('data-vista-pedidos') === 'encerrados' ? 'encerrados' : 'andamento';
                abasParaRedesenhar.pedidos = true; abasParaRedesenhar.historico = true;
                mostrarSecoes();
                desenharAbaSeSuja('pedidos');
            });
        });
        var btnMais = document.getElementById('btn-mais'), menuMais = document.getElementById('menu-mais');
        if (btnMais && menuMais) btnMais.addEventListener('click', function () {
            if (celular()) { // celular: folha modal com foco contido
                if (sobrepos.atual === 'mais') { fecharSobreposto(true); return; }
                menuMais.classList.add('is-aberto'); btnMais.setAttribute('aria-expanded', 'true');
                abrirSobreposto('mais', btnMais);
                return;
            }
            var aberto = menuMais.classList.toggle('is-aberto');
            btnMais.setAttribute('aria-expanded', String(aberto));
        });
        // Celular: tocar fora da folha do "Mais" fecha.
        document.addEventListener('click', function (ev) {
            if (!menuMais || !celular() || sobrepos.atual !== 'mais') return;
            if (ev.target.closest('#menu-mais') || ev.target.closest('#btn-mais')) return;
            fecharSobreposto(false);
        });
        // Esc fecha a folha/gaveta aberta (devolvendo o foco); Tab fica contido nela.
        document.addEventListener('keydown', function (ev) {
            if (!sobrepos.atual) return;
            if (ev.key === 'Escape') { ev.preventDefault(); fecharSobreposto(true); return; }
            if (ev.key !== 'Tab') return;
            var raiz = sobrepos.atual === 'mais' ? menuMais : document.getElementById('corpo-filtros');
            var f = focaveis(raiz);
            if (!f.length) { ev.preventDefault(); return; }
            var primeiro = f[0], ultimo = f[f.length - 1], ativo = document.activeElement;
            if (!raiz.contains(ativo)) { ev.preventDefault(); primeiro.focus(); }
            else if (ev.shiftKey && ativo === primeiro) { ev.preventDefault(); ultimo.focus(); }
            else if (!ev.shiftKey && ativo === ultimo) { ev.preventDefault(); primeiro.focus(); }
        });
        ligarTabelasEmCartoes();
        ligarMenuFixo();
        $('#btn-sino').addEventListener('click', function () {
            marcarNotificacoesLidas();
            trocarAba('pedidos', true);
        });
        $('#btn-fechar-modal').addEventListener('click', fecharModal);
        $('#modal-detalhe').addEventListener('click', function (ev) {
            if (ev.target.id === 'modal-detalhe') fecharModal();
        });
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && !sobrepos.atual) fecharModal();
        });
    }

    /* Folha "Mais" e gaveta de filtros (celular): uma por vez, foco vai para dentro ao abrir, Esc fecha e devolve o foco ao botão. */
    var sobrepos = { atual: null, opener: null };
    function celular() { return window.innerWidth < 1024; }
    // Menu lateral recolhido (desktop): expande por hover/foco; "Fixar" deixa aberto e lembra no localStorage.
    function ligarMenuFixo() {
        var layout = document.querySelector('.adm-layout'), btn = document.getElementById('btn-fixar-menu');
        document.querySelectorAll('.adm-lateral .adm-aba').forEach(function (b) {
            var sp = b.querySelector('span');
            if (sp && !b.getAttribute('title')) b.setAttribute('title', sp.textContent.trim());
        });
        if (!layout || !btn) return;
        function aplicar(fixo) { layout.classList.toggle('is-menu-fixo', fixo); btn.setAttribute('aria-pressed', String(fixo)); }
        var fixo = false;
        try { fixo = localStorage.getItem('adm.menuFixo') === '1'; } catch (e) { fixo = false; }
        aplicar(fixo);
        btn.addEventListener('click', function () {
            fixo = !fixo; aplicar(fixo);
            try { localStorage.setItem('adm.menuFixo', fixo ? '1' : '0'); } catch (e) { /* sem armazenamento: vale só nesta sessão */ }
        });
    }

    // Cruzar 1024px (rotação, redimensionar): fecha a folha/gaveta e limpa atributos, para não deixar foco preso nem role=dialog no desktop.
    var eraCelular = window.innerWidth < 1024;
    window.addEventListener('resize', function () {
        var agora = celular();
        if (agora === eraCelular) return;
        eraCelular = agora;
        var estavaAberto = !!sobrepos.atual, menu = document.getElementById('menu-mais'), btn = document.getElementById('btn-mais');
        if (estavaAberto) fecharSobreposto(false);
        else if (menu) menu.classList.remove('is-aberto');
        if (menu) { menu.removeAttribute('role'); menu.removeAttribute('aria-modal'); menu.removeAttribute('aria-label'); }
        if (btn) btn.setAttribute('aria-expanded', 'false');
        var corpo = document.getElementById('corpo-filtros');
        if (corpo) { corpo.removeAttribute('role'); corpo.removeAttribute('aria-modal'); corpo.removeAttribute('aria-label'); if (agora && !corpo.classList.contains('hidden')) setFiltros(false); }
        if (estavaAberto && document.activeElement && document.activeElement !== document.body && !document.activeElement.offsetParent) { if (btn && btn.offsetParent) btn.focus(); }
    });
    function focaveis(raiz) {
        return [].slice.call(raiz.querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex]:not([tabindex="-1"])'))
            .filter(function (e) { return !e.disabled && e.offsetParent !== null; });
    }
    function setFiltros(abrir) {
        var corpo = document.getElementById('corpo-filtros'), icone = document.getElementById('icone-filtros');
        corpo.classList.toggle('hidden', !abrir);
        icone.classList.toggle('fa-chevron-down', !abrir);
        icone.classList.toggle('fa-chevron-up', abrir);
    }
    function abrirSobreposto(qual, opener) {
        if (sobrepos.atual && sobrepos.atual !== qual) fecharSobreposto(false);
        sobrepos = { atual: qual, opener: opener };
        var raiz = qual === 'mais' ? document.getElementById('menu-mais') : document.getElementById('corpo-filtros');
        raiz.setAttribute('role', 'dialog'); raiz.setAttribute('aria-modal', 'true');
        raiz.setAttribute('aria-label', qual === 'mais' ? 'Mais seções' : 'Filtros');
        var f = focaveis(raiz);
        if (f.length) f[0].focus();
    }
    function fecharSobreposto(devolverFoco) {
        var qual = sobrepos.atual, opener = sobrepos.opener;
        if (!qual) return;
        sobrepos = { atual: null, opener: null };
        var raiz;
        if (qual === 'mais') {
            raiz = document.getElementById('menu-mais');
            raiz.classList.remove('is-aberto');
            document.getElementById('btn-mais').setAttribute('aria-expanded', 'false');
        } else { raiz = document.getElementById('corpo-filtros'); setFiltros(false); }
        raiz.removeAttribute('role'); raiz.removeAttribute('aria-modal'); raiz.removeAttribute('aria-label');
        if (devolverFoco && opener && document.contains(opener)) opener.focus();
    }

    /* ===================================================================
     * Filtros globais
     *
     * Chips em vez de <select multiple>: com 9 regiões e 4 status, clicar é
     * mais rápido que segurar Ctrl numa lista nativa. Nenhum componente novo
     * — o mesmo botão .adm-chip que o resto do painel já usa.
     * =================================================================== */
    function montarChipsDeFiltro() {
        var alvoRegiao = $('#filtro-regiao');
        if (alvoRegiao && !alvoRegiao.dataset.montado) {
            alvoRegiao.dataset.montado = '1';
            alvoRegiao.innerHTML = dados.regioes.map(function (r) {
                return '<button type="button" class="adm-chip" data-regiao-chip="' + esc(r.id) + '">' +
                       esc(r.nome) + '</button>';
            }).join('');
            alvoRegiao.querySelectorAll('[data-regiao-chip]').forEach(function (b) {
                b.addEventListener('click', function () {
                    var id = b.getAttribute('data-regiao-chip');
                    var i = filtros.regioes.indexOf(id);
                    if (i === -1) { filtros.regioes.push(id); b.classList.add('is-ativo'); }
                    else { filtros.regioes.splice(i, 1); b.classList.remove('is-ativo'); }
                    aplicarFiltros();
                });
            });
        }

        var alvoStatus = $('#filtro-status');
        if (alvoStatus && !alvoStatus.dataset.montado) {
            alvoStatus.dataset.montado = '1';
            alvoStatus.innerHTML = STATUS_TODOS.map(function (s) {
                return '<button type="button" class="adm-chip" data-status-chip="' + s + '">' +
                       esc(STATUS[s].rotulo) + '</button>';
            }).join('');
            alvoStatus.querySelectorAll('[data-status-chip]').forEach(function (b) {
                b.addEventListener('click', function () {
                    var s = b.getAttribute('data-status-chip');
                    var i = filtros.status.indexOf(s);
                    if (i === -1) { filtros.status.push(s); b.classList.add('is-ativo'); }
                    else { filtros.status.splice(i, 1); b.classList.remove('is-ativo'); }
                    aplicarFiltros();
                });
            });
        }
    }

    function ligarFiltrosGlobais() {
        // Celular: o corpo dos filtros é uma gaveta; tocar fora ou em "Fechar" recolhe.
        document.addEventListener('click', function (ev) {
            var corpo = $('#corpo-filtros');
            if (window.innerWidth >= 1024 || corpo.classList.contains('hidden')) return;
            if (ev.target.closest('#corpo-filtros') || ev.target.closest('#btn-filtros')) return;
            ev.preventDefault(); ev.stopPropagation();
            $('#btn-filtros').click();
        }, true);
        var fecharFiltros = document.getElementById('btn-fechar-filtros');
        if (fecharFiltros) fecharFiltros.addEventListener('click', function () { $('#btn-filtros').click(); });
        $('#btn-filtros').addEventListener('click', function () {
            var abrir = $('#corpo-filtros').classList.contains('hidden');
            setFiltros(abrir);
            if (!celular()) return;
            if (abrir) abrirSobreposto('filtros', $('#btn-filtros'));
            else if (sobrepos.atual === 'filtros') fecharSobreposto(true);
        });

        $('#filtro-de').addEventListener('change', function () {
            filtros.de = this.value || null;
            aplicarFiltros();
        });
        $('#filtro-ate').addEventListener('change', function () {
            filtros.ate = this.value || null;
            aplicarFiltros();
        });

        var timerBusca = null;
        $('#filtro-busca').addEventListener('input', function () {
            var valor = this.value;
            clearTimeout(timerBusca);
            timerBusca = setTimeout(function () {
                filtros.busca = valor.trim().toLowerCase();
                aplicarFiltros();
            }, 250);
        });

        document.querySelectorAll('[data-tipo-cliente]').forEach(function (b) {
            b.addEventListener('click', function () {
                document.querySelectorAll('[data-tipo-cliente]').forEach(function (o) {
                    o.classList.remove('is-ativo');
                });
                b.classList.add('is-ativo');
                filtros.tipoCliente = b.getAttribute('data-tipo-cliente');
                aplicarFiltros();
            });
        });

        $('#btn-limpar-filtros').addEventListener('click', function () {
            filtros = { de: null, ate: null, busca: '', regioes: [], tipoCliente: 'todos', status: [] };
            $('#filtro-de').value = '';
            $('#filtro-ate').value = '';
            $('#filtro-busca').value = '';
            document.querySelectorAll('[data-regiao-chip], [data-status-chip]').forEach(function (b) {
                b.classList.remove('is-ativo');
            });
            document.querySelectorAll('[data-tipo-cliente]').forEach(function (b) {
                b.classList.toggle('is-ativo', b.getAttribute('data-tipo-cliente') === 'todos');
            });
            aplicarFiltros();
        });
    }

    /* Reaplica os filtros sem ir ao banco de novo: tudo que eles tocam já
     * está carregado na memória do painel. Só as três telas que os usam são
     * redesenhadas — não tem por que redesenhar o resto. */
    function aplicarFiltros() {
        var partes = [];
        if (filtros.de || filtros.ate) {
            partes.push((filtros.de ? new Date(filtros.de + 'T00:00:00').toLocaleDateString('pt-BR') : '…') +
                ' a ' + (filtros.ate ? new Date(filtros.ate + 'T00:00:00').toLocaleDateString('pt-BR') : '…'));
        }
        if (filtros.busca) partes.push('"' + filtros.busca + '"');
        if (filtros.regioes.length) partes.push(filtros.regioes.length + ' região(ões)');
        if (filtros.tipoCliente !== 'todos') partes.push(filtros.tipoCliente.toUpperCase());
        if (filtros.status.length) partes.push(filtros.status.length + ' status');
        $('#filtros-resumo').textContent = partes.length ? partes.join(' · ') : '';

        // Só as três telas que os filtros globais tocam — e só a que está
        // na tela agora é redesenhada de fato; as outras duas ficam
        // marcadas e são redesenhadas quando a pessoa clicar nelas (mesma
        // ideia de desenharAbaSeSuja, para não travar o painel a cada
        // mudança de filtro).
        ['pedidos', 'clientes', 'vendas'].forEach(function (a) { abasParaRedesenhar[a] = true; });
        desenharAbaSeSuja(abaAtual);

        // O card de Receita, no modo "Personalizado", lê filtros.de/ate —
        // sem isto, mudar o filtro global deixava o número visível
        // desatualizado até a pessoa clicar de novo no botão Personalizado.
        // É leve (só dois textContent) — pode continuar sempre em dia.
        desenharCardReceita();
    }

    /* Um pedido passa no filtro quando bate com CADA critério ativo — critérios
     * vazios não restringem nada, é assim que "nenhum filtro" continua
     * mostrando tudo. */
    function pedidoPassaNoFiltro(p) {
        if (filtros.de && p.criado_em < filtros.de) return false;
        if (filtros.ate && p.criado_em.slice(0, 10) > filtros.ate) return false;
        if (filtros.regioes.length && filtros.regioes.indexOf(p.regiao_id) === -1) return false;
        if (filtros.status.length && filtros.status.indexOf(p.status) === -1) return false;
        if (filtros.tipoCliente !== 'todos') {
            var ehPJ = !!(p.cnpj && p.cnpj.replace(/\D/g, '').length > 11);
            if (filtros.tipoCliente === 'pj' && !ehPJ) return false;
            if (filtros.tipoCliente === 'pf' && ehPJ) return false;
        }
        if (filtros.busca) {
            var alvo = (String(p.razao_social || '') + ' ' + String(p.cnpj || '') + ' ' +
                        String(p.telefone || '') + ' ' + String(p.responsavel || '')).toLowerCase();
            if (alvo.indexOf(filtros.busca) === -1) return false;
        }
        return true;
    }

    function entrar(e) {
        e.preventDefault();
        var botao = $('#btn-entrar');
        var erro = $('#login-erro');
        erro.classList.add('hidden');
        botao.disabled = true;
        botao.textContent = 'Entrando...';

        sb.auth.signInWithPassword({
            email: $('#login-email').value.trim(),
            password: $('#login-senha').value
        }).then(function (r) {
            botao.disabled = false;
            botao.textContent = 'Entrar';
            if (r.error) {
                erro.textContent = 'E-mail ou senha incorretos.';
                erro.classList.remove('hidden');
                return;
            }
            usuario = r.data.user;
            abrirPainel();
        });
    }

    function sair() {
        gmapEncerrar(true);
        saudeParar();
        if (canalRealtime) { sb.removeChannel(canalRealtime); canalRealtime = null; }
        sb.auth.signOut().then(function () {
            usuario = null;
            saudeParar();
            mostrarTela('login');
        });
    }

    function abrirPainel() {
        mostrarTela('painel');
        $('#quem').textContent = usuario ? usuario.email : '';

        sb.rpc('meu_papel').then(function (r) {
            papel = (r.data) || null;
            aplicarPapel();
            mostrarSecoes();
            saudeIniciar();
            carregar();
            ligarRealtime();
        });
    }

    /* Esconde as abas que o papel atual não usa, e tira o usuário de uma
     * aba escondida se ele estava nela (troca de conta na mesma sessão,
     * por exemplo). Não mexe em RLS nem em permissão — isso já está
     * garantido no banco (migração 014); aqui é só a tela concordar com o
     * que o banco já decidiu. */
    function aplicarPapel() {
        var restrito = papel === 'vendedor';
        document.querySelectorAll('.adm-aba').forEach(function (b) {
            var item = NAV[b.getAttribute('data-aba')];
            b.classList.toggle('hidden', !!(restrito && item && item.restrito));
        });
        // "Mais" some se nenhum item dele está disponível para o papel.
        var mais = document.getElementById('grupo-mais');
        if (mais) mais.classList.toggle('hidden', !document.querySelector('#menu-mais .adm-aba:not(.hidden)'));
        if (restrito && NAV[abaAtual] && NAV[abaAtual].restrito) {
            trocarAba('pedidos');
        }
    }

    /* ===================================================================
     * Carregamento
     * =================================================================== */
    function marcarCarregando(sim) {
        ABAS.forEach(function (a) {
            $('#painel-' + a).classList.toggle('adm-carregando', sim);
        });
    }

    function carregar() {
        var meses = Number($('#filtro-periodo').value) || 12;
        marcarCarregando(true);

        var desde = new Date();
        desde.setMonth(desde.getMonth() - (meses - 1));
        desde.setDate(1);
        desde.setHours(0, 0, 0, 0);

        Promise.all([
            sb.rpc('resumo_mensal', { meses: meses }),
            sb.rpc('visitas_mensais', { meses: meses }),
            sb.from('pedidos').select('*').gte('criado_em', desde.toISOString())
                .order('criado_em', { ascending: false }),
            sb.from('lista_espera').select('*').order('criado_em', { ascending: false }),
            sb.from('regioes').select('*').order('prioridade', { ascending: false }),
            sb.from('regioes_faixas_cep').select('*'),
            sb.from('vitrines').select('*').order('criado_em', { ascending: false }),
            sb.from('usuarios').select('*').eq('tipo', 'cliente'),
            sb.from('clientes').select('*'),
            sb.rpc('vendas_por_produto', { meses: meses }),
            sb.rpc('visitas_por_regiao', { meses: meses }),
            // Linhas cruas, não o agregado: o mapa e a tabela da aba Visitas
            // precisam de cada sessão para filtrar por 24h/7d/30d e listar
            // "o que aconteceu", não só "quanto". Limite de 1500 em vez de
            // uma data: em um site de pouco tráfego uma data fixa devolveria
            // pouca coisa; em um de muito tráfego, uma data fixa devolveria
            // demais. O limite por linhas se adapta aos dois casos.
            sb.from('visitas')
                .select('pagina, sessao, criado_em, regiao_id, cep, dispositivo, referencia, segundos')
                .order('criado_em', { ascending: false }).limit(1500),
            sb.from('leads').select('*').order('criado_em', { ascending: false }),
            sb.from('solicitacoes_lgpd').select('*').order('criado_em', { ascending: false })
        ]).then(function (rs) {
            marcarCarregando(false);

            var falha = rs.filter(function (r) { return r.error; })[0];
            if (falha) {
                mostrarFalha(falha.error);
                return;
            }

            dados.resumo = rs[0].data || [];
            dados.visitas = rs[1].data || [];
            dados.pedidos = rs[2].data || [];
            atualizarCartaoFiltros();
            dados.espera = rs[3].data || [];
            dados.regioes = rs[4].data || [];
            dados.faixas = rs[5].data || [];
            dados.vitrines = rs[6].data || [];
            dados.usuarios = rs[7].data || [];
            dados.clientes = rs[8].data || [];
            dados.vendasProduto = rs[9].data || [];
            dados.vendasRegiao = rs[10].data || [];
            dados.visitasBrutas = rs[11].data || [];
            dados.leads = rs[12].data || [];
            dados.solicitacoesLgpd = rs[13].data || [];
            erpvCalcular(); // pedidos novos com as vendas já em memória; a carga abaixo atualiza
            montarChipsDeFiltro();
            desenharTudo();
            carregarCasamentoErp();
        });
    }

    function mostrarFalha(erro) {
        var msg = String(erro && erro.message || erro);
        // Zero linhas com política ativa é o sintoma de e-mail fora da tabela
        // admins — vale dizer isso em vez de "erro desconhecido".
        $('#painel-' + secoesDe(abaAtual)[0]).innerHTML =
            '<div class="adm-card p-8">' +
            '<p class="font-bold mb-2">Não foi possível carregar os dados</p>' +
            '<p class="text-sm mb-3" style="color:var(--adm-tinta-2)">' + esc(msg) + '</p>' +
            '<p class="text-xs" style="color:var(--adm-tinta-3)">' +
            'Se a mensagem fala de permissão, confira se o seu e-mail está na tabela ' +
            '<strong>admins</strong> do banco. É o passo 5a do admin/LEIAME-PAINEL.md.</p>' +
            '</div>';
    }

    // Mostra só as seções do item ativo (com o título de cada uma quando há mais de uma), a barra de vista de Pedidos e o
    // cartão de filtros globais (só Pedidos e Clientes).
    function mostrarSecoes() {
        var vis = secoesDe(abaAtual);
        ABAS.forEach(function (a) {
            var mostra = vis.indexOf(a) >= 0;
            $('#painel-' + a).classList.toggle('hidden', !mostra);
            var cab = document.getElementById('cab-' + a);
            if (cab) cab.classList.toggle('hidden', !(mostra && (vis.length > 1 || a === 'historico')));
        });
        var barra = document.getElementById('barra-pedidos');
        if (barra) {
            barra.classList.toggle('hidden', abaAtual !== 'pedidos');
            barra.querySelectorAll('[data-vista-pedidos]').forEach(function (b) {
                b.classList.toggle('is-ativo', b.getAttribute('data-vista-pedidos') === vistaPedidos);
            });
        }
        atualizarCartaoFiltros();
    }

    // Barra de filtros: só nas abas que a usam E quando há o que filtrar (pedidos do site no período). Sem pedidos some inteira.
    // Fica visível se algum filtro já estiver ativo ou o período rápido não for o padrão (12): senão a pessoa não teria como desfazer.
    function atualizarCartaoFiltros() {
        var c = document.getElementById('cartao-filtros');
        if (!c) return;
        var per = document.getElementById('filtro-periodo');
        var ativo = !!(filtros.de || filtros.ate || filtros.busca || filtros.regioes.length || filtros.status.length ||
            filtros.tipoCliente !== 'todos' || (per && String(per.value) !== '12'));
        var util = dados.pedidos.length > 0 || ativo;
        c.classList.toggle('hidden', (abaAtual !== 'pedidos' && abaAtual !== 'clientes') || !util);
    }

    // forcarAndamento: atalhos para AGIR (sino, itens do Hoje) abrem Pedidos em andamento, não na vista "Encerrados" lembrada.
    function trocarAba(qual, forcarAndamento) {
        if (qual === 'historico') vistaPedidos = 'encerrados';
        else if (forcarAndamento && (ALIAS_ABA[qual] || qual) === 'pedidos') vistaPedidos = 'andamento';
        qual = ALIAS_ABA[qual] || qual;
        if (!NAV[qual]) qual = 'hoje';
        if (papel === 'vendedor' && NAV[qual].restrito) qual = 'pedidos';
        if (abaAtual !== qual && secoesDe(abaAtual).indexOf('regioes') >= 0 && secoesDe(qual).indexOf('regioes') < 0) gmapEncerrar(false);
        abaAtual = qual;
        document.querySelectorAll('.adm-aba').forEach(function (b) {
            b.classList.toggle('is-ativa', b.getAttribute('data-aba') === qual);
        });
        // Item dentro de "Mais": abre o grupo para o ativo ficar visível.
        var menu = document.getElementById('menu-mais'), btnMais = document.getElementById('btn-mais');
        var largo = window.matchMedia('(min-width: 1024px)').matches;
        if (largo) {
            if (menu && menu.querySelector('.adm-aba.is-ativa:not(.adm-so-mobile)')) { menu.classList.add('is-aberto'); if (btnMais) btnMais.setAttribute('aria-expanded', 'true'); }
        } else if (menu) { // celular: a folha do "Mais" fecha ao escolher; o botão acende se a aba ativa está lá dentro
            var focoDentro = menu.contains(document.activeElement);
            if (sobrepos.atual === 'mais') fecharSobreposto(false); else menu.classList.remove('is-aberto');
            if (btnMais) {
                btnMais.setAttribute('aria-expanded', 'false'); btnMais.classList.toggle('tem-ativa', !!menu.querySelector('.adm-aba.is-ativa'));
                if (focoDentro) btnMais.focus();
            }
        }
        setTimeout(ajustarSvgCelular, 60);
        abrirJanelaAnim(); setTimeout(reanimarAtivas, 40);
        mostrarSecoes();
        secoesDe(qual).forEach(function (s) { carregarErpDaAba(s); });

        // Cada seção só é redesenhada de verdade agora, se algo mudou desde a última vez que foi vista
        // (ver desenharAbaSeSuja) — é o que evita redesenhar tudo a cada clique em "confirmar pedido".
        desenharAbaSeSuja(qual);

        // Os mapas nascem em desenharVisitas()/desenharRegioes() — se a seção acabou de aparecer (estava escondida, então
        // media 0x0 e o Leaflet trava nesse tamanho), pede para recalcular depois que o container já é visível.
        if (secaoVisivel('visitas') && mapaVisitas) {
            setTimeout(function () { mapaVisitas.invalidateSize(); }, 0);
        }
        if (secaoVisivel('regioes') && mapaClientes) {
            setTimeout(function () { if (mapaClientes) mapaClientes.invalidateSize(); }, 0);
        }
    }

    /* Cada aba só é redesenhada de fato quando é a que está na tela — as
     * outras dez ficam "sujas" (precisando de redesenho) até a pessoa
     * clicar nelas. Antes, qualquer ação (confirmar pedido, marcar entregue,
     * mudar um filtro...) chamava carregar() -> desenharTudo(), que refazia
     * o HTML de TODAS as abas de uma vez — incluindo o Kanban inteiro, os
     * gráficos SVG, a tabela de visitas E o mapa Leaflet (que ainda cria uma
     * camada de tiles nova a cada chamada). Como o Tailwind via CDN
     * recompila as classes a cada mutação grande do DOM, isso empilhava
     * segundos de trabalho síncrono a cada clique — travando o painel
     * inteiro por vários segundos numa ação tão comum quanto "confirmar
     * venda". Redesenhar só o que está visível resolve isso na raiz, não só
     * esconde o sintoma. */
    var abasParaRedesenhar = {};
    var DESENHAR_ABA = {
        dashboard: desenharDashboard,
        pedidos: desenharPedidos,
        clientes: desenharClientes,
        historico: desenharHistorico,
        vendas: desenharVendas,
        espera: desenharEspera,
        vitrine: desenharVitrine,
        regioes: desenharRegioes,
        visitas: desenharVisitas,
        leads: desenharLeads,
        lgpd: desenharLgpd,
        solidcon: desenharSolidcon,
        lojistas: desenharLojistas
    };

    // aba = item do menu: redesenha, entre as seções dele, só as que estão "sujas".
    function desenharAbaSeSuja(aba) {
        secoesDe(aba).forEach(function (s) {
            if (!abasParaRedesenhar[s]) return;
            abasParaRedesenhar[s] = false;
            var fn = DESENHAR_ABA[s];
            if (fn) fn();
        });
    }

    /* ===================================================================
     * SOLIDCON — espelho SOMENTE LEITURA (migração 019; já aplicada como 012 de A)
     * Carrega sob demanda (ao abrir a aba) e isolado do carregar() geral:
     * sem o espelho aplicado, só esta aba mostra o aviso; as demais não mudam.
     * =================================================================== */
    var solid = { carregado: false, carregando: false, produtos: [], syncs: [],
                  erro: null, ausente: false, busca: '', situacao: 'todos', caixa: 'todas',
                  extra: false, eventos: [], limite: 5, ehAdmin: null, tipoEvento: 'todos',
                  catalogo: null, listaAberta: false, banco: null };
    var SOLID_BAIXO = 5;
    var SOLID_BANCO_STALE_MS = 20 * 60 * 1000; // coletor do banco roda a cada 5 min
    var SOLID_STALE_MS = 2 * 60 * 60 * 1000;

    function solidCaixa(p) {
        var m = /(\d+)\s*UN/i.exec(p.categoria || '');
        return m ? Number(m[1]) : null;
    }
    function solidEsgotado(p) { return p.presente === false || Number(p.estoque_disponivel) <= 0; }

    function solidTabelaAusente(erro) {
        var t = String((erro && erro.message || '') + ' ' + (erro && erro.code || ''));
        return /PGRST205|42P01|schema cache|does not exist|Could not find the table/i.test(t) ||
               (erro && erro.status === 404);
    }

    function carregarSolidcon() {
        solid.carregando = true;
        solidRedesenhar();

        return Promise.all([
            sb.from('solidcon_produtos')
                .select('id_produto,nome,categoria,preco_centavos,estoque_disponivel,presente,eans,dtalteracao_erp,atualizado_em')
                .order('nome', { ascending: true }).limit(5000),
            sb.from('solidcon_sync')
                .select('status,concluido_em,coletado_em,qtd_recebida,qtd_presente,mensagem')
                .order('concluido_em', { ascending: false }).limit(200)
        ]).then(function (rs) {
            var falha = rs.filter(function (r) { return r.error; })[0];
            solid.ausente = false; solid.erro = null;
            if (falha) {
                if (solidTabelaAusente(falha.error)) solid.ausente = true;
                else solid.erro = String(falha.error.message || falha.error);
                solid.carregado = false;
                solid.carregando = false;
                solidRedesenhar();
                return;
            }
            solid.produtos = rs[0].data || [];
            solid.syncs = rs[1].data || [];
            solid.carregado = true;
            return Promise.all([carregarSolidExtra(), carregarCatalogoSite(), carregarSolidBanco()]).then(function () {
                solid.carregando = false;
                solidRedesenhar();
            });
        }).catch(function (e) {
            solid.carregando = false;
            solid.erro = String(e && e.message || e);
            solidRedesenhar();
        });
    }

    // Redesenha só o que depende do espelho (Integração e Vitrine), e só se estiver na tela.
    function solidRedesenhar() {
        dashAtualizarResumo();
        abasParaRedesenhar.solidcon = true;
        abasParaRedesenhar.vitrine = true;
        abasParaRedesenhar.vendas = true; // nomes na margem por produto
        desenharAbaSeSuja(abaAtual);
    }

    // Produtos do site (para casar com o ERP). Tenta com codigo_erp (021); sem a coluna, cai para id/nome.
    function carregarCatalogoSite() {
        solid.semColuna = false;
        return sb.from('catalogo_produtos').select('id,nome,codigo_erp').order('nome', { ascending: true }).limit(1000)
            .then(function (r) {
                if (!r.error) { solid.catalogo = r.data || []; return; }
                solid.semColuna = /codigo_erp|42703|PGRST204/i.test(String((r.error.message || '') + ' ' + (r.error.code || '')));
                return sb.from('catalogo_produtos').select('id,nome').order('nome', { ascending: true }).limit(1000)
                    .then(function (r2) { solid.catalogo = r2.error ? null : (r2.data || []); });
            }, function () { solid.catalogo = null; });
    }

    // Última batida do coletor pelo banco SQL (029). Sem a 029 aplicada, a linha só não aparece.
    function carregarSolidBanco() {
        return sb.from('solidcon_banco_sync')
            .select('status,em,duracao_ms,mensagem')
            .eq('modulo', 'saude').order('em', { ascending: false }).limit(1)
            .then(function (r) { solid.banco = r.error ? null : ((r.data || [])[0] || false); },
                  function () { solid.banco = null; });
    }

    function solidLinhaBanco() {
        var b = solid.banco;
        if (b === null) return '';
        var txt, cor;
        if (b === false) {
            txt = 'Banco SOLIDCON: nenhuma batida recebida ainda'; cor = 'var(--adm-tinta-3)';
        } else {
            var ms = Date.now() - new Date(b.em).getTime();
            var min = Math.max(0, Math.round(ms / 60000));
            var ha = min < 60 ? min + ' min' : (Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : ''));
            if (ms > SOLID_BANCO_STALE_MS) {
                txt = 'Banco SOLIDCON: sem batida há ' + ha; cor = 'var(--adm-ruim)';
            } else if (b.status === 'ok') {
                txt = 'Banco SOLIDCON: ok há ' + ha; cor = 'var(--adm-tinta-2)';
            } else {
                txt = 'Banco SOLIDCON: erro há ' + ha + (b.mensagem ? ' — ' + b.mensagem : ''); cor = 'var(--adm-ruim)';
            }
        }
        return '<div class="flex items-center gap-2 mb-3 text-sm" style="color:' + cor + '">' +
               '<i class="fa-solid fa-database"></i><span>' + esc(txt) + '</span></div>';
    }

    function solidCabecalho() {
        var ultima = solid.syncs[0] || null;
        var ok = null;
        solid.syncs.forEach(function (s) {
            if (s.status !== 'ok' || !s.coletado_em) return;
            if (!ok || new Date(s.coletado_em) > new Date(ok.coletado_em)) ok = s;
        });
        var msg, alertas = [];
        if (!ok) {
            msg = 'Nenhuma sincronização concluída ainda';
            alertas.push('Nunca houve uma sincronização OK — os dados abaixo podem estar vazios ou desatualizados.');
        } else {
            var ms = Date.now() - new Date(ok.coletado_em).getTime();
            var min = Math.max(0, Math.round(ms / 60000));
            msg = 'Atualizado há ' + (min < 60 ? min + ' min' :
                  (Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '')));
            if (ms > SOLID_STALE_MS) alertas.push('Última sincronização OK há mais de 2 horas (' + dataHora(ok.coletado_em) + ').');
        }
        if (ultima && ultima.status === 'erro') {
            var m = String(ultima.mensagem || 'sem detalhes');
            alertas.push('A última execução falhou: ' + (m.length > 140 ? m.slice(0, 140) + '…' : m));
        }
        return '<div class="flex items-center gap-2 mb-3 text-sm" style="color:var(--adm-tinta-2)">' +
                   '<i class="fa-regular fa-clock"></i><span>' + esc(msg) + '</span>' +
                   (ok ? '<span class="text-xs" style="color:var(--adm-tinta-3)">(' + esc(dataHora(ok.coletado_em)) + ')</span>' : '') +
               '</div>' + solidLinhaBanco() +
               alertas.map(function (a) {
                   return '<div class="adm-card p-4 mb-3 text-sm" role="alert" style="border-color:var(--adm-ruim-borda)">' +
                          '<i class="fa-solid fa-triangle-exclamation mr-2" style="color:var(--adm-ruim)"></i>' + esc(a) + '</div>';
               }).join('');
    }

    function solidFiltrados() {
        var q = solid.busca.trim().toLowerCase();
        return solid.produtos.filter(function (p) {
            if (solid.situacao === 'disponiveis' && solidEsgotado(p)) return false;
            if (solid.situacao === 'esgotados' && !solidEsgotado(p)) return false;
            if (solid.caixa !== 'todas' && String(solidCaixa(p)) !== solid.caixa) return false;
            if (q && String(p.nome || '').toLowerCase().indexOf(q) < 0 &&
                String(p.id_produto).indexOf(q) < 0) return false;
            return true;
        });
    }

    function solidContadores() {
        var t = solid.produtos, esg = t.filter(solidEsgotado).length;
        function tile(r, v) {
            return '<div class="adm-card p-4"><p class="adm-tile-rotulo mb-1">' + r + '</p>' +
                   '<p class="adm-tile-valor">' + NUM.format(v) + '</p></div>';
        }
        return '<div class="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">' +
            tile('Total', t.length) + tile('Disponíveis', t.length - esg) + tile('Esgotados', esg) +
            tile('CX 24', t.filter(function (p) { return solidCaixa(p) === 24; }).length) +
            tile('CX 48', t.filter(function (p) { return solidCaixa(p) === 48; }).length) +
            '</div>';
    }

    function solidLinha(p) {
        var esg = solidEsgotado(p), est = Number(p.estoque_disponivel) || 0;
        var baixo = !esg && est <= solid.limite;
        var sit = esg
            ? '<span class="adm-selo adm-selo-cancelado"><i class="fa-solid fa-ban"></i>Esgotado</span>'
            : baixo
                ? '<span class="adm-selo adm-selo-aguardando"><i class="fa-solid fa-arrow-down"></i>Estoque baixo</span>'
                : '<span class="adm-selo adm-selo-confirmado"><i class="fa-solid fa-check"></i>Disponível</span>';
        var cx = solidCaixa(p);
        return '<tr data-solid-id="' + esc(p.id_produto) + '" tabindex="0" style="cursor:pointer" title="Ver histórico"><td>' + esc(p.id_produto) + '</td><td>' + esc(p.nome) + '</td>' +
            '<td>' + (cx ? 'CX ' + cx : '—') + '</td>' +
            '<td style="text-align:right">' + esc(NUM.format(esg ? 0 : est)) + '</td>' +
            '<td style="text-align:right">' + esc(brl(p.preco_centavos)) + '</td>' +
            '<td>' + sit + '</td></tr>';
    }

    function desenharSolidcon() {
        var alvo = $('#painel-solidcon');
        if (solid.ausente) {
            alvo.innerHTML = cartaoVazio('Integração SOLIDCON ainda não instalada',
                'As tabelas solidcon_produtos e solidcon_sync não existem neste banco. ' +
                'Confira o ambiente conectado e o acesso ao espelho. A 019 já foi aplicada como 012 de A. Reaplicá-la restaura a RPC anterior à 020 e interrompe o histórico.');
            return;
        }
        if (solid.erro) {
            alvo.innerHTML = '<div class="adm-card p-8"><p class="font-bold mb-2">Não foi possível carregar o SOLIDCON</p>' +
                '<p class="text-sm mb-4" style="color:var(--adm-tinta-2)">' + esc(solid.erro) + '</p>' +
                '<button type="button" class="adm-botao-fantasma" id="solid-tentar">Tentar de novo</button></div>';
            alvo.querySelector('#solid-tentar').addEventListener('click', carregarSolidcon);
            return;
        }
        if (!solid.carregado) {
            alvo.innerHTML = '<div class="adm-card p-8 text-center text-sm" style="color:var(--adm-tinta-2)">' +
                '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando a integração SOLIDCON…</div>';
            return;
        }

        function tile(r, v, nota) {
            return '<div class="adm-card p-4"><p class="adm-tile-rotulo mb-1">' + r + '</p>' +
                   '<p class="adm-tile-valor">' + esc(v) + '</p>' +
                   (nota ? '<p class="text-xs mt-1" style="color:var(--adm-tinta-3)">' + esc(nota) + '</p>' : '') + '</div>';
        }
        var falhas = solid.syncs.filter(function (s) { return s.status === 'erro'; }).length;
        var corte = Date.now() - 86400000;
        var ev24 = solid.extra ? solid.eventos.filter(function (e) { return new Date(e.em).getTime() >= corte; }).length : null;
        var selo = function (st) {
            return st === 'ok'
                ? '<span class="adm-selo adm-selo-confirmado"><i class="fa-solid fa-check"></i>OK</span>'
                : '<span class="adm-selo adm-selo-cancelado"><i class="fa-solid fa-triangle-exclamation"></i>Falhou</span>';
        };
        var histProd = solid.syncs.slice(0, 15).map(function (s) {
            var m = String(s.mensagem || '');
            return '<tr><td>' + esc(dataHora(s.concluido_em || s.coletado_em)) + '</td><td>' + selo(s.status) + '</td>' +
                '<td class="num">' + esc(s.qtd_recebida == null ? '—' : NUM.format(s.qtd_recebida)) + '</td>' +
                '<td class="num">' + esc(s.qtd_presente == null ? '—' : NUM.format(s.qtd_presente)) + '</td>' +
                '<td>' + esc(m.length > 120 ? m.slice(0, 120) + '…' : m) + '</td></tr>';
        }).join('');

        // Vendas: só a saúde da rotina (os números ficam em Pedidos e Dashboard de vendas).
        var vendaSaude;
        if (vend.carregando && !vend.carregado) vendaSaude = '<p class="text-sm" style="color:var(--adm-tinta-3)"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando…</p>';
        else if (vend.ausente) vendaSaude = '<p class="text-sm" style="color:var(--adm-tinta-3)">Rotina de vendas ainda não instalada neste banco.</p>';
        else if (vend.erro) vendaSaude = '<p class="text-sm" style="color:var(--adm-tinta-3)">Não foi possível ler: ' + esc(vend.erro) + '</p>';
        else if (!vend.carregado) vendaSaude = '';
        else {
            var cab = vendCabecalhoAtualizacao();
            vendaSaude = '<p class="text-sm mb-3" style="color:var(--adm-tinta-2)"><i class="fa-regular fa-clock mr-2"></i>Atualizado ' + esc(cab.txt) + '</p>' +
                (cab.alerta ? '<p class="text-sm mb-3" role="alert" style="color:var(--adm-ruim)"><i class="fa-solid fa-triangle-exclamation mr-2"></i>' + esc(cab.alerta) + '</p>' : '') +
                (vend.syncs.length
                    ? '<div class="overflow-x-auto" style="max-height:14rem;overflow-y:auto"><table class="adm-tabela"><thead><tr>' +
                      '<th>Execução</th><th>Dia coletado</th><th>Status</th><th class="num">Linhas</th><th>Mensagem</th></tr></thead><tbody>' +
                      vend.syncs.slice(0, 10).map(function (s) {
                          var m = String(s.mensagem || '');
                          return '<tr><td>' + esc(dataHora(s.em)) + '</td><td>' + esc(s.dia ? String(s.dia).split('-').reverse().join('/') : '—') + '</td>' +
                              '<td>' + selo(s.status) + '</td><td class="num">' + esc(s.linhas == null ? '—' : NUM.format(s.linhas)) + '</td>' +
                              '<td>' + esc(m.length > 120 ? m.slice(0, 120) + '…' : m) + '</td></tr>';
                      }).join('') + '</tbody></table></div>'
                    : '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhuma execução registrada.</p>');
        }

        alvo.innerHTML = solidCabecalho() +
            '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">' +
                tile('Produtos no espelho', NUM.format(solid.produtos.length), 'recebidos do ERP') +
                tile('Falhas recentes', NUM.format(falhas), 'nas últimas ' + NUM.format(solid.syncs.length) + ' execuções') +
                tile('Eventos em 24h', ev24 == null ? '—' : NUM.format(ev24), solid.extra ? 'estoque e preço' : 'histórico não instalado') +
                tile('Limite de estoque baixo', solid.extra ? NUM.format(solid.limite) + ' cx' : '—', 'alerta na Vitrine') +
            '</div>' +
            '<div class="adm-card p-5 mb-5"><p class="font-bold mb-1">Histórico de sincronização de produtos</p>' +
                '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">Estoque e preços do ERP, somente leitura.</p>' +
                (histProd
                    ? '<div class="overflow-x-auto" style="max-height:18rem;overflow-y:auto"><table class="adm-tabela"><thead><tr>' +
                      '<th>Concluída</th><th>Status</th><th class="num">Recebidos</th><th class="num">Presentes</th><th>Mensagem</th></tr></thead><tbody>' + histProd + '</tbody></table></div>'
                    : '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhuma execução registrada.</p>') +
            '</div>' +
            '<div class="adm-card p-5 mb-5"><p class="font-bold mb-1">Sincronização de vendas</p>' +
                '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">Saúde da rotina. Os valores vendidos ficam em Pedidos e no Dashboard de vendas.</p>' + vendaSaude + '</div>' +
            (solid.extra ? solidBlocoEventos() + '<div class="adm-card p-5 mt-5">' + solidControleLimite() + '</div>' : '') +
            '<p class="text-xs mt-3" style="color:var(--adm-tinta-3)">Somente leitura. O preço do ERP é apenas referência — não altera o preço do site.</p>';

        alvo.querySelectorAll('[data-solid-tipo]').forEach(function (b) {
            b.addEventListener('click', function () { solid.tipoEvento = b.getAttribute('data-solid-tipo'); desenharSolidcon(); });
        });
        var sv = $('#solid-limite-salvar');
        if (sv) sv.addEventListener('click', salvarSolidLimite);
    }

    /* ---- Vitrine: estoque do ERP ao lado de cada produto do site + alertas ---- */
    // Casa produto do site com itens do ERP SOMENTE por código explícito do catálogo
    // (codigo_erp = id_produto ou EAN). Sem inferência por nome: SKUs do mesmo sabor
    // (pesos/caixas diferentes) trocariam o estoque.
    // Família ERP (12 dígitos) de um item: EAN14 (caixa) -> substring(2, 12); EAN13 (pote) -> left(12).
    // Famílias ERP (12 dígitos) de um item: EAN14 -> substr(2,12); EAN13 -> left(12). Pode haver mais de uma (ambíguo).
    function solidFamiliasDe(p) {
        var set = {};
        (p.eans || []).map(String).forEach(function (e) {
            if (/^\d{14}$/.test(e)) set[e.slice(1, 13)] = true;
            else if (/^\d{13}$/.test(e)) set[e.slice(0, 12)] = true;
        });
        return Object.keys(set);
    }
    // Família única do item; item com 0 ou 2+ famílias distintas fica sem família (fail-open, igual ao SQL).
    function solidFamiliaDe(p) {
        var f = solidFamiliasDe(p);
        return f.length === 1 ? f[0] : null;
    }
    // Código de 12/13/14 dígitos -> família (12 = ela mesma, 13 = left 12, 14 = substr 2,12); senão null.
    function solidCodigoFamilia(cod) {
        cod = String(cod == null ? '' : cod).trim();
        if (/^\d{12}$/.test(cod)) return cod;
        if (/^\d{13}$/.test(cod)) return cod.slice(0, 12);
        if (/^\d{14}$/.test(cod)) return cod.slice(1, 13);
        return null;
    }

    function solidNorm(s) {
        return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
            .replace(/\bem conserva\b/g, ' ').replace(/\btemper(?:i)?o\b/g, ' ').replace(/\bind\b/g, ' ')
            .replace(/\bcx\.?\s*\d+\b/g, ' ').replace(/\b\d+([.,]\d+)?\s*(kg|g|gr|grs|ml|l)\b/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ').trim();
    }

    // Itens do ERP agrupados por família (caixas 24/48 do mesmo sabor); item sem família fica sozinho.
    function solidGrupos() {
        var mapa = {}, ordem = [];
        solid.produtos.forEach(function (p) {
            var f = solidFamiliaDe(p), k = f || ('id:' + p.id_produto);
            var g = mapa[k];
            if (!g) { g = mapa[k] = { chave: k, familia: f, itens: [] }; ordem.push(g); }
            g.itens.push(p);
        });
        ordem.forEach(function (g) {
            g.nome = vendLimparNome(g.itens[0].nome).replace(/\bEm Conserva\b/gi, '').replace(/\s{2,}/g, ' ').trim() || String(g.itens[0].nome);
            g.chaveNome = solidNorm(g.nome);
        });
        return ordem;
    }

    // Potes em estoque de um conjunto de itens (caixa 24/48 convertida em potes).
    function solidPotes(itens) {
        return itens.reduce(function (a, p) {
            return a + (solidEsgotado(p) ? 0 : (Number(p.estoque_disponivel) || 0) * (solidCaixa(p) || 1));
        }, 0);
    }

    // Casa produto do site com itens do ERP SOMENTE por codigo_erp confirmado.
    // 12 dígitos = família (preferencial). Código curto/id/EAN: acha o(s) item(ns) e resolve a família
    // pelos EANs deles, expandindo para todas as caixas (CX24 + CX48). Famílias distintas = ambíguo.
    function solidCasar(prod) {
        var cod = prod.codigo_erp ? String(prod.codigo_erp).trim() : '';
        if (!cod) return { itens: [], via: '', motivo: 'sem vínculo confirmado', familia: null };
        var fam = solidCodigoFamilia(cod);
        if (fam) {
            var porFam = solid.produtos.filter(function (p) { return solidFamiliaDe(p) === fam; });
            if (porFam.length) return { itens: porFam, via: 'família', motivo: '', familia: fam };
        }
        var diretos = solid.produtos.filter(function (p) {
            return String(p.id_produto) === cod || (p.eans || []).map(String).indexOf(cod) >= 0;
        });
        if (!diretos.length) return { itens: [], via: '', motivo: 'código ' + cod + ' não encontrado no ERP', familia: null };
        var uniao = {};
        diretos.forEach(function (p) { solidFamiliasDe(p).forEach(function (f) { uniao[f] = true; }); });
        var lista = Object.keys(uniao);
        if (lista.length > 1) return { itens: [], via: '', motivo: 'código ambíguo: aponta para ' + lista.length + ' famílias', familia: null, ambiguo: true };
        if (lista.length === 1) {
            return { itens: solid.produtos.filter(function (p) { return solidFamiliaDe(p) === lista[0]; }), via: 'código → família', motivo: '', familia: lista[0] };
        }
        return { itens: diretos, via: 'código', motivo: '', familia: null };
    }

    function solidSeloSituacao(itens) {
        if (!itens.length) return '<span class="adm-selo adm-selo-neutro"><i class="fa-solid fa-link-slash"></i>Sem vínculo</span>';
        var vivos = itens.filter(function (p) { return !solidEsgotado(p); });
        if (!vivos.length) return '<span class="adm-selo adm-selo-cancelado"><i class="fa-solid fa-ban"></i>Esgotado</span>';
        if (vivos.every(function (p) { return Number(p.estoque_disponivel) <= solid.limite; }))
            return '<span class="adm-selo adm-selo-aguardando"><i class="fa-solid fa-arrow-down"></i>Estoque baixo</span>';
        return '<span class="adm-selo adm-selo-confirmado"><i class="fa-solid fa-check"></i>Disponível</span>';
    }

    function solidTabelaPorProduto() {
        if (solid.catalogo == null) {
            return '<p class="text-sm" style="color:var(--adm-tinta-3)">Não foi possível ler o catálogo do site para casar com o ERP. A lista completa do ERP está logo abaixo.</p>';
        }
        if (!solid.catalogo.length) return '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhum produto no catálogo do site.</p>';
        var linhas = solid.catalogo.map(function (prod) {
            var c = solidCasar(prod);
            var chips = c.itens.map(function (p) {
                var cx = solidCaixa(p), esg = solidEsgotado(p);
                return '<span class="text-xs mr-3" style="white-space:nowrap;color:var(--adm-tinta-2)">' + (cx ? 'CX ' + cx : 'Pote') + ': <strong>' +
                       esc(NUM.format(esg ? 0 : Number(p.estoque_disponivel) || 0)) + '</strong> cx</span>';
            }).join('');
            var potes = c.itens.length ? '<span class="text-xs" style="color:var(--adm-tinta-3)">= ' + esc(NUM.format(solidPotes(c.itens))) + ' potes</span>' : '';
            return '<tr><td>' + esc(prod.nome) + '</td><td>' + (chips ? chips + potes : '<span class="text-xs" style="color:var(--adm-tinta-3)">—</span>') + '</td>' +
                   '<td>' + solidSeloSituacao(c.itens) + '</td>' +
                   '<td class="text-xs" style="color:var(--adm-tinta-3)">' + esc(c.via ? 'por ' + c.via : c.motivo) + '</td></tr>';
        }).join('');
        return '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Produto do site</th><th>Estoque no ERP</th><th>Situação</th><th>Vínculo</th></tr></thead><tbody>' +
               linhas + '</tbody></table></div>';
    }

    function desenharVitrineErp() {
        var alvo = $('#vitrine-erp');
        if (!alvo) return;
        var cab = '<div class="flex items-center gap-2 mb-4"><span class="adm-selo adm-selo-erp">ERP SOLIDCON</span>' +
                  '<p class="font-bold">Estoque por produto</p></div>';
        if (solid.ausente) {
            alvo.innerHTML = cab + cartaoVazio('Estoque do ERP ainda não instalado',
                'As tabelas solidcon_produtos e solidcon_sync não existem neste banco.');
            return;
        }
        if (solid.erro) {
            alvo.innerHTML = cab + '<div class="adm-card p-6"><p class="text-sm mb-3" style="color:var(--adm-tinta-2)">Não foi possível carregar o estoque: ' + esc(solid.erro) + '</p>' +
                '<button type="button" class="adm-botao-fantasma" id="solid-tentar">Tentar de novo</button></div>';
            alvo.querySelector('#solid-tentar').addEventListener('click', carregarSolidcon);
            return;
        }
        if (!solid.carregado) {
            alvo.innerHTML = cab + '<div class="adm-card p-6 text-center text-sm" style="color:var(--adm-tinta-2)"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando estoque do ERP…</div>';
            return;
        }
        function chips(attr, atual, itens) {
            return itens.map(function (i) {
                return '<button type="button" class="adm-chip' + (atual === i[0] ? ' is-ativo' : '') +
                       '" ' + attr + '="' + i[0] + '">' + i[1] + '</button>';
            }).join('');
        }
        alvo.innerHTML = cab + solidCabecalho() + solidBlocoAtencao() +
            '<div id="vitrine-vinculo"></div>' +
            '<div id="vitrine-giro"></div>' +
            '<div id="vitrine-entradas"></div>' +
            '<div id="vitrine-insumos"></div>' +
            '<div class="adm-card p-5 mb-5"><p class="font-bold mb-3">Produtos do site e estoque correspondente</p>' + solidTabelaPorProduto() +
            '<p class="text-xs mt-3" style="color:var(--adm-tinta-3)">O vínculo usa só o código ERP confirmado (família de 12 dígitos, id ou EAN). Estoque em caixas; o total soma as caixas convertidas em potes.</p></div>' +
            '<details class="mb-2"' + (solid.listaAberta ? ' open' : '') + '><summary class="text-sm font-bold cursor-pointer mb-3">Todos os produtos do ERP (' + NUM.format(solid.produtos.length) + ')</summary>' +
            solidContadores() +
            '<div class="flex items-center flex-wrap gap-3 mb-4">' +
                '<input type="search" id="solid-busca" class="adm-input" style="max-width:18rem;padding:.55rem .7rem" ' +
                    'placeholder="Buscar por nome ou código" aria-label="Buscar produto" value="' + esc(solid.busca) + '">' +
                '<div class="flex gap-1 flex-wrap">' +
                    chips('data-solid-sit', solid.situacao, [['todos', 'Todos'], ['disponiveis', 'Disponíveis'], ['esgotados', 'Esgotados']]) +
                '</div>' +
                '<div class="flex gap-1 flex-wrap">' +
                    chips('data-solid-cx', solid.caixa, [['todas', 'Todas as caixas'], ['24', 'CX 24'], ['48', 'CX 48']]) +
                '</div>' +
            '</div><div id="solid-lista"></div>' +
            '<p class="text-xs mt-3" style="color:var(--adm-tinta-3)">Somente leitura. O preço do ERP é apenas referência — não altera o preço do site.</p></details>';

        var det = alvo.querySelector('details');
        det.addEventListener('toggle', function () { solid.listaAberta = det.open; });
        $('#solid-busca').addEventListener('input', function (ev) { solid.busca = ev.target.value; desenharSolidLista(); });
        alvo.querySelectorAll('[data-solid-sit]').forEach(function (b) {
            b.addEventListener('click', function () { solid.situacao = b.getAttribute('data-solid-sit'); solid.listaAberta = true; desenharVitrineErp(); });
        });
        alvo.querySelectorAll('[data-solid-cx]').forEach(function (b) {
            b.addEventListener('click', function () { solid.caixa = b.getAttribute('data-solid-cx'); solid.listaAberta = true; desenharVitrineErp(); });
        });
        desenharSolidLista();
        desenharVinculo();
        desenharGiro();
        desenharEntradas();
        desenharInsumos();
    }

    /* ---- Vincular ao SOLIDCON: o admin confirma a família ERP de cada produto do site ---- */
    var vinc = { confirmarTodas: false, msg: '', ocupado: false, linhaMsg: {}, confirmarLinha: null };

    function vincFamilias() {
        return solidGrupos().filter(function (g) { return g.familia; })
            .sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome)); });
    }

    // Sugestão por nome normalizado; só vale como sugestão — nada é gravado sem confirmação.
    function vincSugestao(prod, fams) {
        var kn = solidNorm(prod.nome);
        if (!kn) return { tipo: 'nenhuma' };
        var exatas = fams.filter(function (f) { return f.chaveNome === kn; });
        if (exatas.length === 1) return { tipo: 'exata', f: exatas[0] };
        if (exatas.length > 1) return { tipo: 'ambigua' };
        var parc = fams.filter(function (f) { return f.chaveNome && (f.chaveNome.indexOf(kn) >= 0 || kn.indexOf(f.chaveNome) >= 0); });
        if (parc.length === 1) return { tipo: 'aproximada', f: parc[0] };
        return parc.length > 1 ? { tipo: 'ambigua' } : { tipo: 'nenhuma' };
    }

    function vincPodeEditar() { return papel === 'admin' && !solid.semColuna; }

    // Grava codigo_erp (null = remover). RLS é quem decide; resposta vazia = sem permissão.
    function vincGravar(prodId, codigo) {
        var dono = codigo ? vincColisao(prodId, codigo) : null;
        if (dono) return Promise.resolve({ ok: false, msg: 'Essa família já está vinculada a "' + dono + '".' });
        return sb.from('catalogo_produtos').update({ codigo_erp: codigo }).eq('id', prodId).select('id,codigo_erp')
            .then(function (r) {
                if (r.error) {
                    if (r.error.code === '23505') return { ok: false, msg: 'Esse código já está vinculado a outro produto.' };
                    if (r.error.code === '42501') return { ok: false, msg: 'Sem permissão: somente admin vincula.' };
                    return { ok: false, msg: 'Não foi possível gravar: ' + (r.error.message || '') };
                }
                if (!r.data || !r.data.length) return { ok: false, msg: 'Não gravou (sem permissão ou produto não encontrado).' };
                var prod = solid.catalogo.filter(function (x) { return x.id === prodId; })[0];
                if (prod) prod.codigo_erp = r.data[0].codigo_erp;
                return { ok: true };
            }, function (e) { return { ok: false, msg: 'Falha de rede: ' + (e && e.message || e) }; });
    }

    // Família canônica de um código (12/13/14 dígitos, ou id/EAN resolvido pelo espelho).
    function vincFamiliaCanonica(cod) {
        var c = solidCasar({ codigo_erp: cod });
        return c.familia || solidCodigoFamilia(cod);
    }

    // Outro produto já vinculado à mesma família (mesmo com alias diferente)? Devolve o nome dele.
    function vincColisao(prodId, cod) {
        var fam = vincFamiliaCanonica(cod), lit = String(cod).trim(), achou = null;
        solid.catalogo.forEach(function (p) {
            if (achou || p.id === prodId || !p.codigo_erp) return;
            var pc = String(p.codigo_erp).trim();
            if (pc === lit || (fam && vincFamiliaCanonica(pc) === fam)) achou = p.nome;
        });
        return achou;
    }

    function vincSalvarUm(prodId, codigo) {
        if (vinc.ocupado) return;
        vinc.ocupado = true; vinc.msg = ''; vinc.confirmarLinha = null;
        vincGravar(prodId, codigo || null).then(function (r) {
            vinc.ocupado = false;
            vinc.linhaMsg = {};
            if (!r.ok) vinc.linhaMsg[prodId] = r.msg;
            desenharVitrineErp();
        });
    }

    function vincExatasPendentes() {
        var fams = vincFamilias();
        var usados = {};
        // Reserva o código literal E a família canônica de quem já está vinculado (alias não escapa).
        solid.catalogo.forEach(function (p) {
            if (!p.codigo_erp) return;
            var c = String(p.codigo_erp).trim();
            usados[c] = true;
            var f = vincFamiliaCanonica(c);
            if (f) usados[f] = true;
        });
        var lista = [];
        solid.catalogo.forEach(function (prod) {
            if (prod.codigo_erp) return;
            var s = vincSugestao(prod, fams);
            if (s.tipo !== 'exata' || usados[s.f.familia]) return;
            usados[s.f.familia] = true;
            lista.push({ prod: prod, f: s.f });
        });
        return lista;
    }

    function vincAceitarTodas() {
        var lista = vincExatasPendentes();
        if (!lista.length || vinc.ocupado) return;
        vinc.ocupado = true;
        var ok = 0, falhas = [];
        lista.reduce(function (cadeia, it) {
            return cadeia.then(function () {
                return vincGravar(it.prod.id, it.f.familia).then(function (r) { if (r.ok) ok++; else falhas.push(it.prod.nome + ': ' + r.msg); });
            });
        }, Promise.resolve()).then(function () {
            vinc.ocupado = false; vinc.confirmarTodas = false; vinc.linhaMsg = {};
            vinc.msg = NUM.format(ok) + ' vínculo(s) gravado(s)' + (falhas.length ? '; ' + falhas.length + ' falhou: ' + falhas.slice(0, 3).join(' | ') : '.');
            desenharVitrineErp();
        });
    }

    function desenharVinculo() {
        var alvo = $('#vitrine-vinculo');
        if (!alvo) return;
        var cab = '<p class="font-bold">Vincular produtos do site ao SOLIDCON</p>';
        if (solid.catalogo == null) {
            alvo.innerHTML = '<div class="adm-card p-5 mb-5">' + cab + '<p class="text-sm mt-2" style="color:var(--adm-tinta-3)">Não foi possível ler o catálogo do site.</p></div>';
            return;
        }
        if (solid.semColuna) {
            alvo.innerHTML = '<div class="adm-card p-5 mb-5" style="border-color:var(--adm-atencao-borda)">' + cab +
                '<p class="text-sm mt-2" style="color:var(--adm-tinta-2)"><i class="fa-solid fa-circle-info mr-2"></i>' +
                'A coluna <strong>codigo_erp</strong> ainda não existe no catálogo (migração 024 pendente). Enquanto isso o estoque por produto não liga e o vínculo fica indisponível.</p></div>';
            return;
        }
        var fams = vincFamilias();
        var podeEditar = vincPodeEditar();
        var pend = podeEditar ? vincExatasPendentes() : [];
        var linhas = solid.catalogo.map(function (prod) {
            var atual = prod.codigo_erp ? String(prod.codigo_erp) : '';
            var cz = atual ? solidCasar(prod) : null;
            var famAtual = atual && cz && cz.familia ? fams.filter(function (f) { return f.familia === cz.familia; })[0] : null;
            var s = atual ? null : vincSugestao(prod, fams);
            var estado;
            if (atual) {
                estado = famAtual
                    ? '<span class="adm-selo adm-selo-confirmado"><i class="fa-solid fa-link"></i>' + esc(famAtual.nome) + '</span>'
                    : '<span class="adm-selo adm-selo-aguardando"><i class="fa-solid fa-link"></i>' + esc(atual) + '</span> <span class="text-xs" style="color:var(--adm-tinta-3)">(' + esc(cz && cz.motivo ? cz.motivo : 'sem família no ERP') + ')</span>';
            } else if (s.tipo === 'exata' || s.tipo === 'aproximada') {
                estado = '<span class="text-xs" style="color:var(--adm-tinta-2)">Sugestão (' + (s.tipo === 'exata' ? 'exata' : 'aproximada') + '): <strong>' + esc(s.f.nome) + '</strong></span>' +
                    (podeEditar ? ' <button type="button" class="adm-botao-fantasma" data-vinc-aceitar="' + esc(prod.id) + '" data-codigo="' + esc(s.f.familia) + '">Aceitar</button>' : '');
            } else {
                estado = '<span class="text-xs" style="color:var(--adm-tinta-3)">' + (s.tipo === 'ambigua' ? 'Várias candidatas — escolha na lista' : 'Sem sugestão — escolha na lista') + '</span>';
            }
            var seletor = podeEditar
                ? '<div class="flex items-center gap-2 flex-wrap"><select class="adm-input" style="width:auto;max-width:16rem;padding:.35rem .5rem" data-vinc-sel="' + esc(prod.id) + '" aria-label="Família ERP de ' + esc(prod.nome) + '">' +
                  '<option value="">— sem vínculo —</option>' +
                  (atual && !famAtual ? '<option value="' + esc(atual) + '" selected>Atual: ' + esc(atual) + '</option>' : '') +
                  fams.map(function (f) {
                      return '<option value="' + esc(f.familia) + '"' + (famAtual && f.familia === famAtual.familia ? ' selected' : '') + '>' + esc(f.nome) + ' (' + esc(f.familia) + ')</option>';
                  }).join('') + '</select>' +
                  '<button type="button" class="adm-botao-fantasma" data-vinc-salvar="' + esc(prod.id) + '">Gravar</button></div>'
                : '<span class="text-xs" style="color:var(--adm-tinta-3)">somente admin</span>';
            var conf = vinc.confirmarLinha && vinc.confirmarLinha.id === prod.id
                ? '<div class="text-xs mt-2" role="alert" style="color:var(--adm-tinta-2)">' +
                  (vinc.confirmarLinha.novo ? 'Trocar o vínculo atual (' + esc(atual) + ') por ' + esc(vinc.confirmarLinha.novo) + '?' : 'Remover o vínculo atual (' + esc(atual) + ')?') +
                  ' <button type="button" class="adm-botao" data-vinc-confirmar="' + esc(prod.id) + '">Confirmar</button>' +
                  ' <button type="button" class="adm-botao-fantasma" data-vinc-cancelar="1">Cancelar</button></div>'
                : '';
            return '<tr><td>' + esc(prod.nome) + '</td><td>' + estado + '</td><td>' + seletor + conf +
                (vinc.linhaMsg[prod.id] ? '<p class="text-xs mt-1" role="alert" style="color:var(--adm-ruim)">' + esc(vinc.linhaMsg[prod.id]) + '</p>' : '') + '</td></tr>';
        }).join('');
        var vinculados = solid.catalogo.filter(function (p) { return p.codigo_erp; }).length;
        var acao = '';
        if (podeEditar && pend.length) {
            acao = vinc.confirmarTodas
                ? '<span class="text-sm">Gravar ' + NUM.format(pend.length) + ' vínculo(s) exato(s)?</span> ' +
                  '<button type="button" class="adm-botao" id="vinc-todas-sim">Sim, gravar</button> <button type="button" class="adm-botao-fantasma" id="vinc-todas-nao">Cancelar</button>'
                : '<button type="button" class="adm-botao" id="vinc-todas">Aceitar todas as sugestões exatas (' + NUM.format(pend.length) + ')</button>';
        }
        alvo.innerHTML = '<div class="adm-card p-5 mb-5">' + cab +
            '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">Nada liga sozinho: a sugestão compara o nome do site com o sabor no ERP e só vale depois de confirmada. ' +
            'Grava a família ERP (12 dígitos) em <code>codigo_erp</code>. ' + NUM.format(vinculados) + ' de ' + NUM.format(solid.catalogo.length) + ' produtos vinculados.</p>' +
            (acao ? '<div class="flex items-center gap-3 flex-wrap mb-3">' + acao + '</div>' : '') +
            (vinc.msg ? '<p class="text-sm mb-3" role="status" style="color:var(--adm-tinta-2)">' + esc(vinc.msg) + '</p>' : '') +
            (solid.catalogo.length
                ? '<div class="overflow-x-auto" style="max-height:28rem;overflow-y:auto"><table class="adm-tabela"><thead><tr><th>Produto do site</th><th>Vínculo / sugestão</th><th>Família ERP</th></tr></thead><tbody>' + linhas + '</tbody></table></div>'
                : '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhum produto no catálogo do site.</p>') + '</div>';

        alvo.querySelectorAll('[data-vinc-aceitar]').forEach(function (b) {
            b.addEventListener('click', function () { vincSalvarUm(b.getAttribute('data-vinc-aceitar'), b.getAttribute('data-codigo')); });
        });
        alvo.querySelectorAll('[data-vinc-salvar]').forEach(function (b) {
            b.addEventListener('click', function () {
                var id = b.getAttribute('data-vinc-salvar');
                var sel = Array.prototype.filter.call(alvo.querySelectorAll('[data-vinc-sel]'), function (x) { return x.getAttribute('data-vinc-sel') === id; })[0];
                var novo = sel ? sel.value : '';
                var prod = solid.catalogo.filter(function (p) { return p.id === id; })[0];
                var atual = prod && prod.codigo_erp ? String(prod.codigo_erp) : '';
                vinc.linhaMsg = {}; vinc.msg = '';
                if (novo === atual) { vinc.confirmarLinha = null; vinc.linhaMsg[id] = 'Sem alteração.'; desenharVinculo(); return; }
                if (atual) { vinc.confirmarLinha = { id: id, novo: novo }; desenharVinculo(); return; } // troca/remoção pede confirmação
                vincSalvarUm(id, novo);
            });
        });
        alvo.querySelectorAll('[data-vinc-confirmar]').forEach(function (b) {
            b.addEventListener('click', function () {
                var c = vinc.confirmarLinha;
                if (c && c.id === b.getAttribute('data-vinc-confirmar')) vincSalvarUm(c.id, c.novo);
            });
        });
        alvo.querySelectorAll('[data-vinc-cancelar]').forEach(function (b) {
            b.addEventListener('click', function () { vinc.confirmarLinha = null; desenharVinculo(); });
        });
        var t = alvo.querySelector('#vinc-todas'); if (t) t.addEventListener('click', function () { vinc.confirmarTodas = true; vinc.msg = ''; desenharVinculo(); });
        var n = alvo.querySelector('#vinc-todas-nao'); if (n) n.addEventListener('click', function () { vinc.confirmarTodas = false; desenharVinculo(); });
        var s = alvo.querySelector('#vinc-todas-sim'); if (s) s.addEventListener('click', vincAceitarTodas);
    }


    // Aba Estoque (painel #painel-vitrine): só a parte do ERP. Os destaques de clientes foram para "Vitrines de lojistas".
    function desenharVitrine() {
        $('#painel-vitrine').innerHTML = '<section id="vitrine-erp" class="mb-10"></section>';
        desenharVitrineErp();
    }

    // "Vitrines de lojistas" (Mais): pedidos de destaque no catálogo (antes no fim da Vitrine).
    function desenharLojistas() {
        $('#painel-lojistas').innerHTML = '<div class="flex items-center gap-2 mb-4"><span class="adm-selo adm-selo-neutro">Site</span><p class="font-bold">Destaques de clientes</p></div><div id="lojistas-corpo"></div>';
        desenharVitrineBase();
    }

    function desenharSolidLista() {
        var lista = solidFiltrados();
        var alvo = $('#solid-lista');
        if (!solid.produtos.length) {
            alvo.innerHTML = cartaoVazio('Nenhum produto sincronizado ainda',
                'Quando a rotina de sincronização rodar, os produtos aparecem aqui.');
            return;
        }
        if (!lista.length) {
            alvo.innerHTML = cartaoVazio('Nenhum produto com esses filtros', 'Tente limpar a busca ou os filtros.');
            return;
        }
        alvo.innerHTML = '<div class="adm-card p-5"><div class="overflow-x-auto"><table class="adm-tabela"><thead><tr>' +
            '<th>Código</th><th>Produto</th><th>Caixa</th><th style="text-align:right">Estoque disponível</th>' +
            '<th style="text-align:right">Preço ERP (referência)</th><th>Situação</th></tr></thead><tbody>' +
            lista.map(solidLinha).join('') + '</tbody></table></div>' +
            '<p class="text-xs mt-3" style="color:var(--adm-tinta-3)">' + NUM.format(lista.length) + ' de ' +
            NUM.format(solid.produtos.length) + ' produtos</p></div>';
        if (solid.extra) {
            alvo.querySelectorAll('tr[data-solid-id]').forEach(function (tr) {
                var abrir = function () { abrirDetalheSolid(tr.getAttribute('data-solid-id')); };
                tr.addEventListener('click', abrir);
                tr.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') abrir(); });
            });
        }
    }

    /* ---- Extensão 017: eventos, histórico diário e limite de estoque baixo.
     * Tudo opcional: se as tabelas não existirem, solid.extra fica false e a
     * aba segue como antes, sem esses blocos. ---- */
    var SOLID_TIPOS = {
        esgotou:        { rotulo: 'Esgotou',           icone: 'fa-ban',         cls: 'adm-selo-cancelado' },
        voltou_estoque: { rotulo: 'Voltou ao estoque', icone: 'fa-rotate-left', cls: 'adm-selo-confirmado' },
        estoque_baixo:  { rotulo: 'Estoque baixo',     icone: 'fa-arrow-down',  cls: 'adm-selo-aguardando' },
        preco_mudou:    { rotulo: 'Preço mudou',       icone: 'fa-tag',         cls: 'adm-selo-entregue' },
        produto_novo:   { rotulo: 'Produto novo',      icone: 'fa-star',        cls: 'adm-selo-erp' },
        sumiu:          { rotulo: 'Sumiu da lista',    icone: 'fa-eye-slash',   cls: 'adm-selo-neutro' },
        reapareceu:     { rotulo: 'Reapareceu',        icone: 'fa-eye',         cls: 'adm-selo-neutro' }
    };

    function carregarSolidExtra() {
        var desde = new Date(Date.now() - 7 * 86400000).toISOString();
        return Promise.all([
            sb.from('solidcon_eventos')
                .select('id,em,id_produto,nome,tipo,valor_antes,valor_depois')
                .gte('em', desde).order('em', { ascending: false }).limit(200),
            sb.from('solidcon_config').select('limite_estoque_baixo').eq('id', 1).limit(1)
        ]).then(function (rs) {
            if (rs[0].error || rs[1].error) { solid.extra = false; return null; }
            solid.extra = true;
            solid.eventos = rs[0].data || [];
            var c = (rs[1].data || [])[0];
            solid.limite = c ? Number(c.limite_estoque_baixo) : SOLID_BAIXO;
            // O painel não distingue papéis: tenta o helper do banco; se falhar,
            // o botão aparece e a RPC recusa quem não é admin.
            return sb.rpc('eh_admin').then(function (r) {
                solid.ehAdmin = r.error ? null : r.data === true;
            }, function () { solid.ehAdmin = null; });
        }).catch(function () { solid.extra = false; });
    }

    function solidFmtValor(tipo, v) {
        if (v == null) return '—';
        if (tipo === 'preco_mudou') return brl(Number(v));
        return NUM.format(Number(v));
    }

    function solidSeloTipo(tipo) {
        var t = SOLID_TIPOS[tipo] || { rotulo: tipo, icone: 'fa-circle', cls: '' };
        return '<span class="adm-selo ' + t.cls + '"' + (t.estilo ? ' style="' + t.estilo + '"' : '') + '>' +
               '<i class="fa-solid ' + t.icone + '"></i>' + esc(t.rotulo) + '</span>';
    }

    function solidBlocoAtencao() {
        var lim = solid.limite;
        var grupos = solidGrupos();
        var esg = grupos.filter(function (g) { return g.itens.every(solidEsgotado); });
        var baixo = grupos.filter(function (g) {
            var vivos = g.itens.filter(function (p) { return !solidEsgotado(p); });
            return vivos.length && vivos.every(function (p) { return Number(p.estoque_disponivel) <= lim; });
        });

        function lista(itens, fn) {
            if (!itens.length) return '<p class="text-xs" style="color:var(--adm-tinta-3)">Nenhum.</p>';
            return '<ul class="text-xs space-y-1" style="color:var(--adm-tinta-2)">' +
                itens.slice(0, 5).map(fn).join('') + '</ul>' +
                (itens.length > 5 ? '<p class="text-xs mt-1" style="color:var(--adm-tinta-3)">+ ' + (itens.length - 5) + ' outros</p>' : '');
        }
        function col(titulo, n, corpo) {
            return '<div><p class="adm-tile-rotulo mb-1">' + titulo + '</p><p class="adm-tile-valor mb-2">' +
                   NUM.format(n) + '</p>' + corpo + '</div>';
        }
        function detalhe(g) {
            return g.itens.map(function (p) {
                var cx = solidCaixa(p);
                return (cx ? 'CX ' + cx : 'Pote') + ' ' + NUM.format(solidEsgotado(p) ? 0 : Number(p.estoque_disponivel) || 0);
            }).join(' · ');
        }

        return '<div class="adm-card p-5 mb-5"><p class="font-bold mb-4"><i class="fa-solid fa-bell mr-2" style="color:var(--adm-atencao)"></i>Alertas de estoque</p>' +
            '<div class="grid sm:grid-cols-2 gap-5">' +
            col('Esgotados (todas as caixas)', esg.length, lista(esg, function (g) { return '<li>' + esc(g.nome) + '</li>'; })) +
            col('Estoque baixo (≤ ' + NUM.format(lim) + ' cx)', baixo.length,
                lista(baixo, function (g) {
                    return '<li>' + esc(g.nome) + ' <span style="color:var(--adm-tinta-3)">— ' + esc(detalhe(g)) + '</span></li>';
                })) +
            '</div><p class="text-xs mt-4 pt-3" style="border-top:1px solid var(--adm-borda);color:var(--adm-tinta-3)">' +
            'Por sabor (família ERP): só esgota se todas as caixas zerarem. Limite: <strong>' + esc(NUM.format(lim)) + '</strong> caixas. O ajuste fica na aba Integração.</p></div>';
    }

    function solidControleLimite() {
        var lim = esc(NUM.format(solid.limite));
        if (solid.ehAdmin === false) {
            return '<p class="text-xs mt-4 pt-3" style="border-top:1px solid var(--adm-borda);color:var(--adm-tinta-3)">' +
                   'Limite de estoque baixo: <strong>' + lim + '</strong> caixas (somente admin altera).</p>';
        }
        return '<div class="flex items-center flex-wrap gap-2 mt-4 pt-3 text-xs" style="border-top:1px solid var(--adm-borda);color:var(--adm-tinta-3)">' +
            '<label for="solid-limite">Limite de estoque baixo (caixas):</label>' +
            '<input type="number" min="0" step="1" id="solid-limite" class="adm-input" style="width:5.5rem;padding:.35rem .5rem" value="' + esc(solid.limite) + '">' +
            '<button type="button" class="adm-botao-fantasma" id="solid-limite-salvar">Salvar</button>' +
            '<span id="solid-limite-msg" role="status"></span></div>';
    }

    function salvarSolidLimite() {
        var inp = $('#solid-limite'), msg = $('#solid-limite-msg'), btn = $('#solid-limite-salvar');
        var v = Number(inp.value);
        if (!inp.value || !isFinite(v) || v < 0 || Math.floor(v) !== v) {
            msg.textContent = 'Informe um número inteiro ≥ 0.';
            return;
        }
        btn.disabled = true; msg.textContent = 'Salvando…';
        sb.rpc('solidcon_definir_limite', { p_limite: v }).then(function (r) {
            btn.disabled = false;
            if (r.error) {
                var perm = r.error.code === '42501' || /somente admin|permission/i.test(r.error.message || '');
                if (perm) { solid.ehAdmin = false; desenharSolidcon(); return; }
                msg.textContent = 'Não foi possível salvar: ' + (r.error.message || '');
                return;
            }
            solid.limite = Number(r.data);
            solidRedesenhar();
        });
    }

    function solidBlocoEventos() {
        var tipos = Object.keys(SOLID_TIPOS);
        var lista = solid.eventos.filter(function (e) { return solid.tipoEvento === 'todos' || e.tipo === solid.tipoEvento; });
        var corpo = !solid.eventos.length
            ? '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhum evento nos últimos 7 dias.</p>'
            : !lista.length
                ? '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhum evento desse tipo.</p>'
                : '<div class="overflow-x-auto" style="max-height:20rem;overflow-y:auto"><table class="adm-tabela"><thead><tr>' +
                  '<th>Data/hora</th><th>Produto</th><th>Evento</th><th>Antes → depois</th></tr></thead><tbody>' +
                  lista.map(function (e) {
                      var ad = (e.tipo === 'sumiu' || e.tipo === 'reapareceu') ? '—' :
                          esc(solidFmtValor(e.tipo, e.valor_antes)) + ' → ' + esc(solidFmtValor(e.tipo, e.valor_depois));
                      return '<tr><td>' + esc(dataHora(e.em)) + '</td><td>' + esc(e.nome) +
                             ' <span style="color:var(--adm-tinta-3)">(' + esc(e.id_produto) + ')</span></td><td>' +
                             solidSeloTipo(e.tipo) + '</td><td>' + ad + '</td></tr>';
                  }).join('') + '</tbody></table></div>';
        return '<div class="adm-card p-5"><div class="flex items-center justify-between flex-wrap gap-3 mb-4">' +
            '<p class="font-bold">Eventos recentes <span class="text-xs font-normal" style="color:var(--adm-tinta-3)">últimos 7 dias</span></p>' +
            '<div class="flex gap-1 flex-wrap"><button type="button" class="adm-chip' + (solid.tipoEvento === 'todos' ? ' is-ativo' : '') +
            '" data-solid-tipo="todos">Todos</button>' +
            tipos.map(function (t) {
                return '<button type="button" class="adm-chip' + (solid.tipoEvento === t ? ' is-ativo' : '') +
                       '" data-solid-tipo="' + t + '">' + esc(SOLID_TIPOS[t].rotulo) + '</button>';
            }).join('') + '</div></div>' + corpo + '</div>';
    }

    function abrirDetalheSolid(id) {
        var p = solid.produtos.filter(function (x) { return String(x.id_produto) === String(id); })[0];
        if (!p) return;
        abrirModal('<h3 class="font-bold text-lg mb-1">' + esc(p.nome) + '</h3>' +
            '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">Código ' + esc(p.id_produto) +
            ' · preço ERP (referência) ' + esc(brl(p.preco_centavos)) + '</p>' +
            '<div id="solid-hist" class="text-sm" style="color:var(--adm-tinta-2)"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando histórico…</div>');
        var d = new Date(Date.now() - 30 * 86400000);
        var desde = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        sb.from('solidcon_estoque_diario')
            .select('dia,estoque_disponivel,preco_centavos,presente')
            .eq('id_produto', p.id_produto).gte('dia', desde).order('dia', { ascending: true })
            .then(function (r) {
                var alvo = $('#solid-hist');
                if (!alvo) return;
                if (r.error) { alvo.textContent = 'Não foi possível carregar o histórico.'; return; }
                alvo.innerHTML = solidHistoricoHtml(r.data || []);
            });
    }

    // Gráficos SVG de largura fixa: no celular o viewBox acompanha a tela (escala ~1), para os rótulos não encolherem.
    /* Tabelas largas (>= 5 colunas) viram cartões empilhados no celular (CSS em admin.css, <= 760px): cada célula ganha o
     * título da coluna em data-rotulo; colunas ordenáveis aparecem como botões acima da lista. Só marca atributos: no desktop não muda nada. */
    function tabelasEmCartoes(raiz) {
        raiz.querySelectorAll('table.adm-tabela:not([data-cartoes])').forEach(function (t) {
            t.setAttribute('data-cartoes', '1');
            var cab = t.querySelector(':scope > thead > tr');
            if (!cab) return;
            var rotulos = [];
            cab.querySelectorAll(':scope > th').forEach(function (th) {
                var n = th.colSpan || 1, txt = (th.textContent || '').replace(/[▲▼↑↓]/g, '').replace(/\s+/g, ' ').trim();
                for (var i = 0; i < n; i++) rotulos.push(n === 1 ? txt : '');
            });
            if (rotulos.length < 5) return;
            t.classList.add('adm-tabela-cartoes');
            t.querySelectorAll(':scope > tbody > tr').forEach(function (tr) {
                var idx = 0;
                tr.querySelectorAll(':scope > td').forEach(function (td) {
                    var n = td.colSpan || 1;
                    if (n === 1 && rotulos[idx] && !td.hasAttribute('data-rotulo')) td.setAttribute('data-rotulo', rotulos[idx]);
                    idx += n;
                });
            });
            if (t.classList.contains('adm-tabela-lista')) return; // a lista de clientes tem seletor de ordem próprio
            var ord = false;
            cab.querySelectorAll(':scope > th').forEach(function (th) {
                if (th.hasAttribute('aria-sort') || th.querySelector('button')) { th.classList.add('adm-th-ord'); ord = true; }
            });
            if (ord) t.classList.add('adm-cartoes-ord');
        });
    }
    function ligarTabelasEmCartoes() {
        var raiz = document.querySelector('.adm-principal'), agendado = false;
        if (!raiz || typeof MutationObserver === 'undefined') return;
        new MutationObserver(function () {
            if (agendado) return;
            agendado = true;
            requestAnimationFrame(function () { agendado = false; tabelasEmCartoes(raiz); ajustarSvgCelular(); prepararAnimacoes(raiz); });
        }).observe(raiz, { childList: true, subtree: true });
        abrirJanelaAnim(); tabelasEmCartoes(raiz); ajustarSvgCelular(); prepararAnimacoes(raiz);
    }

    /* ===================================================================
     * Animações de entrada (P5). Só classes e propriedades CSS (--i / --atraso via CSSOM); nada de style inline novo.
     * Rodam quando o elemento aparece (IntersectionObserver), uma vez por renderização, dentro de uma janela curta aberta
     * ao trocar de aba / carregar / Atualizar (para não reanimar a cada digitação). prefers-reduced-motion: nada é marcado.
     * =================================================================== */
    var janelaAnim = 0, ioAnim = null;
    function animOk() {
        if (typeof IntersectionObserver === 'undefined') return false;
        try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return true; }
    }
    function abrirJanelaAnim() { janelaAnim = Date.now() + 2500; }
    var alvosAnim = new Set();
    // Solta do observer o que saiu do DOM (redesenhos substituem os elementos): nada acumula.
    function limparAlvosAnim() {
        alvosAnim.forEach(function (e) {
            if (!e.isConnected) { if (ioAnim) ioAnim.unobserve(e); alvosAnim.delete(e); }
        });
    }
    function ioObs() {
        if (!ioAnim) ioAnim = new IntersectionObserver(function (es) {
            es.forEach(function (e) {
                if (!e.isIntersecting) return;
                ioAnim.unobserve(e.target); alvosAnim.delete(e.target);
                if (e.target.classList.contains('adm-tile-valor')) contarAte(e.target);
                else e.target.classList.add('is-vista');
            });
        }, { threshold: 0.08 });
        return ioAnim;
    }
    function marcarAnim(el, classe, i) {
        el.setAttribute('data-anim', '1');
        if (classe) el.classList.add(classe);
        if (i != null) el.style.setProperty('--i', String(Math.min(i, 14)));
        ioObs().observe(el); alvosAnim.add(el);
    }
    // Números dos KPIs contam de 0 até o valor (~600ms). Só texto com um número só ("R$ 1.234,56", "45%", "12 dias").
    function contarAte(el) {
        if (el._contando || el.children.length) { return; }
        var txt = el.textContent, m = /^\s*([^\d-]*)(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)([^\d]*)$/.exec(txt);
        if (!m) return;
        var alvo = parseFloat(m[2].replace(/\./g, '').replace(',', '.'));
        if (!isFinite(alvo) || alvo === 0) return;
        var dec = (m[2].split(',')[1] || '').length, t0 = null, ult = null, dur = 600;
        el._contando = true;
        function fmt(v) { return m[1] + v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3]; }
        function fim() { if (el.textContent === ult) el.textContent = txt; el._contando = false; }
        function passo(t) {
            if (!el._contando) return;
            if (el.textContent !== ult) { el._contando = false; return; } // outro código atualizou o valor: não sobrescrever
            if (t0 === null) t0 = t;
            var k = Math.min(1, (t - t0) / dur), v = alvo * (1 - Math.pow(1 - k, 3));
            if (k >= 1) { fim(); return; }
            ult = fmt(v); el.textContent = ult; requestAnimationFrame(passo);
        }
        el.textContent = fmt(0); ult = el.textContent;
        requestAnimationFrame(passo);
        setTimeout(function () { if (el._contando) fim(); }, dur + 400); // rede de segurança: o valor final sempre volta
    }
    function prepararAnimacoes(raiz) {
        limparAlvosAnim();
        if (Date.now() > janelaAnim || !animOk()) return;
        var ordem = 0;
        raiz.querySelectorAll('.adm-card:not([data-anim]), .adm-agora:not([data-anim])').forEach(function (c) {
            if (c.id === 'cartao-filtros' || c.closest('#modal-detalhe')) return;
            var topo = !c.parentElement.closest('.adm-card');
            if (topo) { marcarAnim(c, 'adm-anim', ordem); ordem++; c.style.setProperty('--atraso', Math.min(ordem, 8) * 45 + 'ms'); }
            else c.setAttribute('data-anim', '1');
        });
        raiz.querySelectorAll('.adm-tile-valor:not([data-anim])').forEach(function (v) { if (v.namespaceURI === 'http://www.w3.org/1999/xhtml') marcarAnim(v, '', null); });
        raiz.querySelectorAll('svg[viewBox]:not([data-anim])').forEach(function (svg) {
            marcarAnim(svg, 'adm-svg-anim', null);
            svg.querySelectorAll('.adm-barra, rect[rx]').forEach(function (r, i) { r.style.setProperty('--i', String(Math.min(i, 24))); });
            svg.querySelectorAll('.adm-fatia').forEach(function (r, i) { r.style.setProperty('--i', String(Math.min(i, 12))); });
            svg.querySelectorAll('polyline, path.adm-linha').forEach(function (l) { l.setAttribute('pathLength', '1'); });
        });
        raiz.querySelectorAll('div[style*="border-radius:99px"] > div[style*="width:"]:not([data-anim])').forEach(function (b, i) { marcarAnim(b, 'adm-hbarra', i); });
        raiz.querySelectorAll('table[style*=".72rem"]:not([data-anim])').forEach(function (t) {
            t.querySelectorAll('tbody tr').forEach(function (tr, r) {
                tr.querySelectorAll('td').forEach(function (td, c) { td.style.setProperty('--i', String(Math.min(r + c, 20))); });
            });
            marcarAnim(t, 'adm-heat', null);
        });
    }
    // Ao voltar para uma aba já desenhada: reinicia a entrada dos elementos dela.
    function reanimarAtivas() {
        if (!animOk()) return;
        limparAlvosAnim();
        secoesDe(abaAtual).forEach(function (sec) {
            var raiz = document.getElementById('painel-' + sec);
            if (!raiz) return;
            raiz.querySelectorAll('.adm-anim[data-anim], .adm-svg-anim[data-anim], .adm-hbarra[data-anim], .adm-heat[data-anim], .adm-tile-valor[data-anim]').forEach(function (e) {
                e.classList.remove('is-vista'); ioObs().observe(e); alvosAnim.add(e);
            });
        });
    }

    // Celular: texto dos gráficos SVG com 13px reais (o viewBox é escalado para a largura do contêiner).
    function ajustarSvgCelular() {
        if (window.innerWidth >= 1024) { // desktop: nenhum tamanho de texto de celular fica nos gráficos
            document.querySelectorAll('svg[data-fs]').forEach(function (svg) {
                svg.removeAttribute('data-fs');
                svg.querySelectorAll('text').forEach(function (t) { t.style.fontSize = ''; });
            });
            return;
        }
        document.querySelectorAll('.adm-principal svg[viewBox]').forEach(function (svg) {
            var vb = svg.viewBox && svg.viewBox.baseVal, cw = svg.getBoundingClientRect().width;
            if (!vb || !vb.width || !cw) return;
            var chave = String(Math.round(cw));
            if (svg.getAttribute('data-fs') === chave) return;
            svg.setAttribute('data-fs', chave);
            var px = (13 / (cw / vb.width)).toFixed(2) + 'px';
            svg.querySelectorAll('text').forEach(function (t) { t.style.fontSize = px; });
        });
    }

    function wGraf(padrao) { return window.innerWidth < 1024 ? Math.max(280, Math.min(padrao, window.innerWidth - 90)) : padrao; }

    function solidGrafico(dias) {
        var W = wGraf(600), H = 170, pl = (W < 600 ? 66 : 36), pr = 10, pt = 10, pb = 22;
        var max = Math.max.apply(null, dias.map(function (x) { return Number(x.estoque_disponivel); }).concat([1]));
        var n = dias.length;
        function X(i) { return n === 1 ? (pl + W - pr) / 2 : pl + i * (W - pl - pr) / (n - 1); }
        function Y(v) { return pt + (H - pt - pb) * (1 - v / max); }
        var pts = dias.map(function (x, i) { return X(i).toFixed(1) + ',' + Y(Number(x.estoque_disponivel)).toFixed(1); });
        var rot = function (iso) { var q = String(iso).split('-'); return q[2] + '/' + q[1]; };
        return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto" role="img" aria-label="Estoque por dia nos últimos 30 dias">' +
            '<line x1="' + pl + '" y1="' + Y(0) + '" x2="' + (W - pr) + '" y2="' + Y(0) + '" stroke="var(--adm-borda-forte)"/>' +
            '<line x1="' + pl + '" y1="' + Y(max) + '" x2="' + (W - pr) + '" y2="' + Y(max) + '" stroke="var(--adm-borda)" stroke-dasharray="3 3"/>' +
            '<text x="' + (pl - 6) + '" y="' + (Y(max) + 4) + '" text-anchor="end" font-size="10" fill="var(--adm-tinta-3)">' + esc(NUM.format(max)) + '</text>' +
            '<text x="' + (pl - 6) + '" y="' + (Y(0) + 4) + '" text-anchor="end" font-size="10" fill="var(--adm-tinta-3)">0</text>' +
            '<text x="' + pl + '" y="' + (H - 6) + '" font-size="10" fill="var(--adm-tinta-3)">' + esc(rot(dias[0].dia)) + '</text>' +
            '<text x="' + (W - pr) + '" y="' + (H - 6) + '" text-anchor="end" font-size="10" fill="var(--adm-tinta-3)">' + esc(rot(dias[n - 1].dia)) + '</text>' +
            '<polyline fill="none" stroke="var(--adm-dados)" stroke-width="2" stroke-linejoin="round" points="' + pts.join(' ') + '"/>' +
            dias.map(function (x, i) {
                return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(Number(x.estoque_disponivel)).toFixed(1) +
                       '" r="2.5" fill="var(--adm-dados)"><title>' + esc(rot(x.dia) + ': ' + NUM.format(Number(x.estoque_disponivel)) + ' cx') + '</title></circle>';
            }).join('') + '</svg>';
    }

    function solidHistoricoHtml(dias) {
        if (!dias.length) return '<p>Ainda não há histórico diário para este produto.</p>';
        var fmt = function (iso) { var q = String(iso).split('-'); return q[2] + '/' + q[1] + '/' + q[0]; };
        return '<p class="adm-tile-rotulo mb-2">Estoque por dia — últimos 30 dias</p>' + solidGrafico(dias) +
            '<div class="overflow-x-auto mt-4" style="max-height:14rem;overflow-y:auto"><table class="adm-tabela"><thead><tr>' +
            '<th>Dia</th><th style="text-align:right">Estoque</th><th style="text-align:right">Preço ERP</th><th>Na lista</th></tr></thead><tbody>' +
            dias.slice().reverse().map(function (x) {
                return '<tr><td>' + esc(fmt(x.dia)) + '</td><td style="text-align:right">' + esc(NUM.format(Number(x.estoque_disponivel))) +
                       '</td><td style="text-align:right">' + esc(brl(x.preco_centavos)) + '</td><td>' + (x.presente ? 'Sim' : 'Não') + '</td></tr>';
            }).join('') + '</tbody></table></div>';
    }


    /* ===================================================================
     * Vendas SOLIDCON — SOMENTE LEITURA (migração 022)
     * Sob demanda e isolado do carregar() geral. Sem a 018: aviso na aba.
     * =================================================================== */
    var vend = { carregado: false, carregando: false, ausente: false, erro: null,
                 dias: [], meses: [], fam: [], syncs: [], mesFoco: null, metrica: 'potes' };
    var VEND_DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    var VEND_FORMATOS = [['pote', 'Pote avulso'], ['cx24', 'Caixa 24'], ['cx48', 'Caixa 48'], ['outro', 'Outros']];

    // Supabase corta em 1000 linhas por requisição: busca em páginas.
    function vendPaginar(consulta, max) {
        var todos = [];
        function pagina(ini) {
            return consulta().range(ini, ini + 999).then(function (r) {
                if (r.error) return { error: r.error };
                todos = todos.concat(r.data || []);
                if ((r.data || []).length === 1000 && todos.length < (max || 20000)) return pagina(ini + 1000);
                return { data: todos };
            });
        }
        return pagina(0);
    }

    function carregarVendas() {
        vend.carregando = true;
        vendRedesenhar();

        return Promise.all([
            vendPaginar(function () { return sb.from('solidcon_vendas_por_mes').select('mes,valor_centavos,potes,dias_com_venda').order('mes', { ascending: true }); }),
            vendPaginar(function () { return sb.from('solidcon_vendas_por_dia').select('dia,valor_centavos,potes').order('dia', { ascending: true }); }),
            vendPaginar(function () { return sb.from('solidcon_vendas_familia_mes').select('mes,familia,nome_familia,formato,qtd,valor_centavos,potes').order('mes', { ascending: true }).order('familia', { ascending: true }).order('formato', { ascending: true }); }),
            sb.from('solidcon_vendas_sync').select('dia,linhas,status,coletado_em,em,mensagem').order('em', { ascending: false }).limit(100)
        ]).then(function (rs) {
            vend.carregando = false;
            var falha = rs.filter(function (r) { return r.error; })[0];
            vend.ausente = false; vend.erro = null;
            if (falha) {
                if (solidTabelaAusente(falha.error)) vend.ausente = true;
                else vend.erro = String(falha.error.message || falha.error);
                vend.carregado = false;
            } else {
                vend.meses = rs[0].data; vend.dias = rs[1].data; vend.fam = rs[2].data; vend.syncs = rs[3].data || [];
                vend.carregado = true;
                var ult = vend.meses.length ? vend.meses[vend.meses.length - 1].mes : null;
                if (!vend.mesFoco || !vend.meses.some(function (m) { return m.mes === vend.mesFoco; })) vend.mesFoco = ult;
            }
            vend.carregando = false;
            vendRedesenhar();
        }).catch(function (e) {
            vend.carregando = false;
            vend.erro = String(e && e.message || e);
            vendRedesenhar();
        });
    }

    // Vendas do ERP aparecem em Pedidos, Dashboard de vendas e Integração (saúde).
    function vendRedesenhar() {
        dashAtualizarResumo();
        abasParaRedesenhar.pedidos = true;
        abasParaRedesenhar.solidcon = true;
        if (secaoVisivel('vendas') && $('#vendas-erp')) desenharVendasErp();
        else abasParaRedesenhar.vendas = true;
        desenharAbaSeSuja(abaAtual);
    }

    function vendNum(v) { return Number(v) || 0; }

    // "IND - ALHO FRITO TEMPERIO 100G CX 24" -> "Alho Frito"
    function vendLimparNome(n) {
        var s = String(n == null ? '' : n)
            .replace(/^\s*IND\s*-\s*/i, '')
            .replace(/^\s*MP\s+/i, '')
            .replace(/\bTEMPER(?:I)?O\b/gi, '')
            .replace(/\b\d+([.,]\d+)?\s*(KG|G|GR|GRS|ML|L)\b/gi, '')
            .replace(/\bCX\.?\s*\d+\b/gi, '')
            .replace(/\bCAIXA\s*\d*\b/gi, '')
            .replace(/\s*-\s*$/, '')
            .replace(/\s{2,}/g, ' ').trim();
        if (!s) s = String(n == null ? '' : n).trim();
        return s.toLowerCase().replace(/(^|\s)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
    }

    function vendMesRotulo(iso) { return rotuloMes(String(iso).slice(0, 10)); }
    function vendMesAtual() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
    }
    function vendMesAnterior(iso) {
        var p = String(iso).split('-'), m = Number(p[1]) - 1, a = Number(p[0]);
        if (m < 1) { m = 12; a--; }
        return a + '-' + String(m).padStart(2, '0') + '-01';
    }

    // Barras verticais em SVG. itens: [{rot, v, parcial, dica}]; cadaRotulo: mostra 1 rótulo a cada N.
    function vendBarras(itens, desc, cadaRotulo) {
        if (!itens.length) return '<p class="text-sm" style="color:var(--adm-tinta-3)">Sem dados.</p>';
        var W = wGraf(640), H = 190, pl = (W < 640 ? 66 : 46), pr = 8, pt = 8, pb = 22;
        var max = Math.max.apply(null, itens.map(function (i) { return i.v; }).concat([1]));
        var slot = (W - pl - pr) / itens.length, bw = Math.max(1.5, slot * 0.72);
        var y = function (v) { return pt + (H - pt - pb) * (1 - v / max); };
        var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto" role="img" aria-label="' + esc(desc) + '">' +
            '<line x1="' + pl + '" y1="' + y(0) + '" x2="' + (W - pr) + '" y2="' + y(0) + '" stroke="var(--adm-borda-forte)"/>' +
            '<line x1="' + pl + '" y1="' + y(max) + '" x2="' + (W - pr) + '" y2="' + y(max) + '" stroke="var(--adm-borda)" stroke-dasharray="3 3"/>' +
            '<text x="' + (pl - 5) + '" y="' + (y(max) + 4) + '" text-anchor="end" font-size="10" fill="var(--adm-tinta-3)">' + esc(brlCurto(max)) + '</text>' +
            '<text x="' + (pl - 5) + '" y="' + (y(0) + 4) + '" text-anchor="end" font-size="10" fill="var(--adm-tinta-3)">0</text>';
        var cadaRot = W < 640 ? Math.max(cadaRotulo || 1, Math.ceil(56 / slot)) : cadaRotulo;
        itens.forEach(function (it, i) {
            var x = pl + i * slot + (slot - bw) / 2, h = y(0) - y(it.v);
            out += '<rect x="' + x.toFixed(1) + '" y="' + y(it.v).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) +
                   '" rx="1.5" fill="' + (it.parcial ? 'var(--adm-parcial)' : 'var(--adm-dados)') + '"><title>' + esc(it.dica) + '</title></rect>';
            if (i % cadaRot === 0) {
                out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="var(--adm-tinta-3)">' + esc(it.rot) + '</text>';
            }
        });
        return out + '</svg>';
    }

    // Lista com barra horizontal proporcional (formatos, sabores).
    function vendLista(linhas, total) {
        if (!linhas.length) return '<p class="text-sm" style="color:var(--adm-tinta-3)">Sem vendas neste mês.</p>';
        var max = Math.max.apply(null, linhas.map(function (l) { return l.v; }).concat([1]));
        return linhas.map(function (l) {
            var pct = total > 0 ? ' · ' + (l.v / total * 100).toFixed(1).replace('.', ',') + '%' : '';
            return '<div class="mb-3"><div class="flex justify-between gap-3 text-sm mb-1">' +
                '<span style="color:var(--adm-tinta-2)">' + esc(l.rot) + '</span>' +
                '<span class="font-bold" style="white-space:nowrap">' + esc(brl(l.v)) + '<span class="text-xs font-normal" style="color:var(--adm-tinta-3)">' + esc(pct) + '</span></span></div>' +
                '<div style="height:6px;border-radius:99px;background:var(--adm-borda)"><div style="height:6px;border-radius:99px;background:var(--adm-dados);width:' + (l.v / max * 100).toFixed(1) + '%"></div></div></div>';
        }).join('');
    }

    function vendCabecalhoAtualizacao() {
        var ok = null;
        vend.syncs.forEach(function (s) {
            if (s.status !== 'ok') return;
            var t = new Date(s.coletado_em || s.em).getTime();
            if (!ok || t > ok.t) ok = { t: t };
        });
        var ultima = vend.syncs[0] || null;
        var txt = '—', alerta = '';
        if (ok) {
            var min = Math.max(0, Math.round((Date.now() - ok.t) / 60000));
            txt = min < 60 ? 'há ' + min + ' min' : 'há ' + Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '');
        } else {
            alerta = 'Nenhuma sincronização de vendas concluída ainda.';
        }
        if (ultima && ultima.status === 'erro') {
            var m = String(ultima.mensagem || 'sem detalhes');
            alerta = 'A última sincronização de vendas falhou: ' + (m.length > 140 ? m.slice(0, 140) + '…' : m);
        }
        return { txt: txt, alerta: alerta };
    }

    /* ---- Dashboard de vendas (ERP): preço médio praticado e sazonalidade ----
     * Reaproveitam vend.fam (solidcon_vendas_familia_mes, já em cache): sem nova consulta.
     * Pote avulso, caixa 24 e caixa 48 já vêm convertidos em potes, por família (sabor). */
    var VEND_PRECO_MIN = 330;      // mínimo definido pelo dono (R$ 3,30/pote)
    var VEND_PRECO_MESES = 6;      // colunas da tabela de preço
    var VEND_CALOR_MESES = 18;     // colunas do mapa de calor
    var VEND_CALOR_SABORES = 20;

    // Preço de tabela do site (R$ 4,00/pote): lê siteConfig.pedido.precoPorPoteCentavos (js/config.js); 400 se indisponível.
    function vendPrecoSite() {
        var c = (typeof siteConfig !== 'undefined' && siteConfig && siteConfig.pedido) ? Number(siteConfig.pedido.precoPorPoteCentavos) : NaN;
        return c > 0 ? c : 400;
    }

    function vendPct(n) { return n.toFixed(1).replace('.', ','); }

    // Agrupa vend.fam por sabor e mês: { sabores: {fam: {rot, meses: {mes: {potes, valor}}}}, meses: [ordenados] }
    function vendPorSaborMes() {
        var sab = {}, ms = {};
        vend.fam.forEach(function (x) {
            var p = vendNum(x.potes);
            if (p <= 0) return; // sem potes não há preço (evita distorcer com linhas sem conversão)
            var s = sab[x.familia] || (sab[x.familia] = { rot: vendLimparNome(x.nome_familia), meses: {} });
            var m = s.meses[x.mes] || (s.meses[x.mes] = { potes: 0, valor: 0 });
            m.potes += p; m.valor += vendNum(x.valor_centavos);
            ms[x.mes] = true;
        });
        return { sabores: sab, meses: Object.keys(ms).sort() };
    }

    // N meses consecutivos terminando no último mês com venda (meses sem venda ficam na janela, zerados).
    function vendJanela(meses, n) {
        if (!meses.length) return [];
        var p = meses[meses.length - 1].split('-'), a = Number(p[0]), m = Number(p[1]), out = [];
        for (var i = 0; i < n; i++) {
            out.unshift(a + '-' + String(m).padStart(2, '0') + '-01');
            m--; if (m < 1) { m = 12; a--; }
        }
        return out;
    }

    function vendCelulaPreco(potes, valor, site) {
        if (!(potes > 0)) return '<td class="num" style="color:var(--adm-tinta-3)">—</td>';
        var preco = valor / potes, baixo = preco < VEND_PRECO_MIN;
        return '<td class="num" title="' + esc(NUM.format(Math.round(potes)) + ' potes · ' + vendPct((1 - preco / site) * 100) + '% de desconto sobre o site') + '"' +
               (baixo ? ' style="color:var(--adm-ruim);font-weight:700"' : '') + '>' +
               (baixo ? '<i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>' : '') + esc(brl(Math.round(preco))) + '</td>';
    }

    function vendPrecoDados() {
        var site = vendPrecoSite(), d = vendPorSaborMes();
        if (!d.meses.length) return null;
        var cols = vendJanela(d.meses, VEND_PRECO_MESES);
        var linhas = Object.keys(d.sabores).map(function (k) {
            var s = d.sabores[k], p = 0, v = 0;
            cols.forEach(function (m) { if (s.meses[m]) { p += s.meses[m].potes; v += s.meses[m].valor; } });
            return { rot: s.rot, meses: s.meses, potes: p, valor: v };
        }).filter(function (l) { return l.potes > 0; }).sort(function (a, b) { return b.potes - a.potes; });
        var tot = { rot: 'Todos os sabores', meses: {}, potes: 0, valor: 0 };
        linhas.forEach(function (l) {
            cols.forEach(function (m) {
                if (!l.meses[m]) return;
                var t = tot.meses[m] || (tot.meses[m] = { potes: 0, valor: 0 });
                t.potes += l.meses[m].potes; t.valor += l.meses[m].valor;
            });
            tot.potes += l.potes; tot.valor += l.valor;
        });
        var abaixo = linhas.filter(function (l) { return l.valor / l.potes < VEND_PRECO_MIN; });
        return { site: site, cols: cols, linhas: linhas, tot: tot, abaixo: abaixo };
    }

    function vendHtmlPreco() {
        var D = vendPrecoDados();
        if (!D) return '<div class="adm-card p-5"><p class="font-bold">Preço médio praticado</p><p class="text-sm mt-2" style="color:var(--adm-tinta-3)">Sem vendas com potes para calcular.</p></div>';
        var site = D.site, cols = D.cols, linhas = D.linhas, tot = D.tot, abaixo = D.abaixo;
        function descCel(l) {
            if (!(l.potes > 0)) return '<td class="num">—</td>';
            var dsc = (1 - (l.valor / l.potes) / site) * 100;
            return '<td class="num">' + esc(vendPct(Math.abs(dsc)) + '%' + (dsc < 0 ? ' acima' : '')) + '</td>';
        }
        function linhaTab(l, forte) {
            var preco = l.potes > 0 ? l.valor / l.potes : 0, baixo = l.potes > 0 && preco < VEND_PRECO_MIN;
            return '<tr' + (forte ? ' style="font-weight:700"' : '') + '><td>' + esc(l.rot) + '</td>' +
                cols.map(function (m) { var c = l.meses[m]; return vendCelulaPreco(c ? c.potes : 0, c ? c.valor : 0, site); }).join('') +
                vendCelulaPreco(l.potes, l.valor, site) + descCel(l) + '</tr>';
        }
        // Gráfico: preço do período por sabor (mais vendidos), com marcas em R$ 3,30 e no preço do site
        var topo = linhas.slice(0, 12);
        var teto = Math.max(site, VEND_PRECO_MIN, Math.max.apply(null, topo.map(function (l) { return l.valor / l.potes; }).concat([0]))) * 1.05;
        var pos = function (v) { return (v / teto * 100).toFixed(2) + '%'; };
        var grafico = topo.map(function (l) {
            var preco = l.valor / l.potes, baixo = preco < VEND_PRECO_MIN;
            return '<div class="mb-2"><div class="flex justify-between gap-3 text-xs mb-1"><span style="color:var(--adm-tinta-2)">' + esc(l.rot) + '</span>' +
                '<span class="font-bold" style="' + (baixo ? 'color:var(--adm-ruim)' : '') + '">' + esc(brl(Math.round(preco))) + '</span></div>' +
                '<div style="position:relative;height:8px;border-radius:99px;background:var(--adm-borda)">' +
                '<div style="height:8px;border-radius:99px;background:' + (baixo ? 'var(--adm-ruim)' : 'var(--adm-dados)') + ';width:' + pos(preco) + '"></div>' +
                '<div style="position:absolute;top:-3px;bottom:-3px;left:' + pos(VEND_PRECO_MIN) + ';width:2px;background:var(--adm-ruim)"></div>' +
                '<div style="position:absolute;top:-3px;bottom:-3px;left:' + pos(site) + ';width:2px;background:var(--adm-tinta-2)"></div></div></div>';
        }).join('');
        return '<div class="adm-card p-5">' +
            '<p class="font-bold">Preço médio praticado por sabor</p>' +
            '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">Valor vendido ÷ potes (pote avulso, caixa 24 e caixa 48 convertidos), ' + cols.length +
                ' meses (' + vendMesRotulo(cols[0]) + ' a ' + vendMesRotulo(cols[cols.length - 1]) + '; mês sem venda fica em branco). Site: ' + esc(brl(site)) + '/pote. Vermelho: abaixo de ' + esc(brl(VEND_PRECO_MIN)) + ' (mínimo definido).</p>' +
            (abaixo.length
                ? '<div class="text-sm mb-3 p-3" role="status" style="border:1px solid var(--adm-ruim-borda);border-radius:.6rem"><i class="fa-solid fa-triangle-exclamation mr-2" style="color:var(--adm-ruim)"></i>' +
                  NUM.format(abaixo.length) + (abaixo.length === 1 ? ' sabor está' : ' sabores estão') + ' com preço médio abaixo do mínimo no período: ' +
                  esc(abaixo.slice(0, 6).map(function (l) { return l.rot; }).join(', ') + (abaixo.length > 6 ? ' e mais ' + (abaixo.length - 6) : '')) + '.</div>'
                : '') +
            '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Sabor</th>' +
                cols.map(function (m) { return '<th style="text-align:right">' + esc(vendMesRotulo(m)) + (m >= vendMesAtual() ? '*' : '') + '</th>'; }).join('') +
                '<th style="text-align:right">Período</th><th style="text-align:right">Desc. médio</th></tr></thead><tbody>' +
                linhaTab(tot, true) + linhas.map(function (l) { return linhaTab(l, false); }).join('') +
            '</tbody></table></div>' +
            '<p class="text-xs mt-2" style="color:var(--adm-tinta-3)">* mês parcial. Desconto médio = quanto o preço praticado fica abaixo do site.</p>' +
            '<p class="font-bold mt-5 mb-1">Preço no período — 12 sabores mais vendidos</p>' +
            '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">Marca vermelha: ' + esc(brl(VEND_PRECO_MIN)) + ' · marca cinza: site (' + esc(brl(site)) + ')</p>' + grafico +
            '</div>';
    }

    function vendHtmlSazonalidade(idSel, nSab, nMes) {
        idSel = idSel || 'vend-metrica'; nSab = nSab || VEND_CALOR_SABORES; nMes = nMes || VEND_CALOR_MESES;
        var d = vendPorSaborMes(), usaValor = vend.metrica === 'valor';
        function val(c) { return c ? (usaValor ? c.valor : c.potes) : 0; }
        var cols = vendJanela(d.meses, nMes);
        var linhas = Object.keys(d.sabores).map(function (k) {
            var s = d.sabores[k], tot = 0, max = 0;
            cols.forEach(function (m) { var v = val(s.meses[m]); tot += v; if (v > max) max = v; });
            return { rot: s.rot, meses: s.meses, tot: tot, max: max };
        }).filter(function (l) { return l.tot > 0; }).sort(function (a, b) { return b.tot - a.tot; }).slice(0, nSab);
        var seletor = '<label for="' + idSel + '" class="adm-tile-rotulo mr-2">Métrica</label>' +
            '<select id="' + idSel + '" class="adm-input" style="width:auto;padding:.4rem .7rem">' +
            '<option value="potes"' + (usaValor ? '' : ' selected') + '>Potes</option><option value="valor"' + (usaValor ? ' selected' : '') + '>Valor (R$)</option></select>';
        var corpo;
        if (!linhas.length) {
            corpo = '<p class="text-sm" style="color:var(--adm-tinta-3)">Sem vendas para o mapa.</p>';
        } else {
            corpo = '<div class="overflow-x-auto"><table class="adm-tabela" style="font-size:.72rem"><thead><tr><th>Sabor</th>' +
                cols.map(function (m) { return '<th style="text-align:center;padding-left:.25rem;padding-right:.25rem">' + esc(vendMesRotulo(m)) + (m >= vendMesAtual() ? '*' : '') + '</th>'; }).join('') +
                '</tr></thead><tbody>' +
                linhas.map(function (l) {
                    return '<tr><td style="white-space:nowrap">' + esc(l.rot) + '</td>' + cols.map(function (m) {
                        var v = val(l.meses[m]);
                        var a = l.max > 0 ? Math.round(Math.sqrt(v / l.max) * 45) : 0; // relativa ao pico do próprio sabor; teto 45% mantém o texto claro >= 4,5:1 (também no hover)
                        var txt = v > 0 ? (usaValor ? brlCurto(v) : NUM.format(Math.round(v))) : '';
                        var dica = l.rot + ' · ' + vendMesRotulo(m) + ': ' + (usaValor ? brl(Math.round(v)) : NUM.format(Math.round(v)) + ' potes');
                        return '<td title="' + esc(dica) + '" style="text-align:center;padding-left:.25rem;padding-right:.25rem;color:var(--adm-tinta);background:color-mix(in srgb, var(--adm-dados) ' + a + '%, transparent)">' + esc(txt) + '</td>';
                    }).join('') + '</tr>';
                }).join('') + '</tbody></table></div>' +
                '<p class="text-xs mt-2" style="color:var(--adm-tinta-3)">Cada linha é colorida pelo pico do próprio sabor (mais escuro = mês mais forte). * mês parcial.</p>';
        }
        return '<div class="adm-card p-5"><div class="flex items-center flex-wrap gap-3 mb-1"><p class="font-bold">Sazonalidade por sabor</p><span class="ml-auto">' + seletor + '</span></div>' +
            '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">Top ' + nSab + ' sabores por ' + (usaValor ? 'valor' : 'potes') + ', ' + cols.length + ' meses (' + (cols.length ? vendMesRotulo(cols[0]) + ' a ' + vendMesRotulo(cols[cols.length - 1]) : '') + ').</p>' + corpo + '</div>';
    }

    function vendItensMes() {
        var atual = vendMesAtual();
        return vend.meses.map(function (m) {
            return { rot: vendMesRotulo(m.mes), v: vendNum(m.valor_centavos), parcial: m.mes >= atual,
                     dica: vendMesRotulo(m.mes) + ': ' + brl(vendNum(m.valor_centavos)) + (m.mes >= atual ? ' (mês parcial)' : '') };
        });
    }

    function desenharVendasErp() {
        var alvo = $('#vendas-erp');
        if (!alvo) return;
        if (vend.carregando && !vend.carregado) {
            alvo.innerHTML = '<div class="adm-card p-8 text-center text-sm" style="color:var(--adm-tinta-2)">' +
                '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando vendas do SOLIDCON…</div>';
            return;
        }
        if (vend.ausente) {
            alvo.innerHTML = cartaoVazio('Vendas ainda não instaladas',
                'As views de vendas do SOLIDCON não existem neste banco. A migração 022 está pendente de implantação.');
            return;
        }
        if (vend.erro) {
            alvo.innerHTML = '<div class="adm-card p-8"><p class="font-bold mb-2">Não foi possível carregar as vendas</p>' +
                '<p class="text-sm mb-4" style="color:var(--adm-tinta-2)">' + esc(vend.erro) + '</p>' +
                '<button type="button" class="adm-botao-fantasma" id="vend-tentar">Tentar de novo</button></div>';
            $('#vend-tentar').addEventListener('click', carregarVendas);
            return;
        }
        if (!vend.carregado) return;
        if (!vend.meses.length) {
            alvo.innerHTML = cartaoVazio('Nenhuma venda sincronizada ainda', 'Quando a rotina de vendas rodar, os números aparecem aqui.');
            return;
        }

        var atual = vendMesAtual();
        var total = 0, potes = 0;
        vend.meses.forEach(function (m) { total += vendNum(m.valor_centavos); potes += vendNum(m.potes); });
        var completos = vend.meses.filter(function (m) { return m.mes < atual; });
        var media = completos.length ? completos.reduce(function (a, m) { return a + vendNum(m.valor_centavos); }, 0) / completos.length : 0;
        var cab = vendCabecalhoAtualizacao();

        function kpi(r, v, nota) {
            return '<div class="adm-card p-4"><p class="adm-tile-rotulo mb-1">' + r + '</p><p class="adm-tile-valor">' + esc(v) + '</p>' +
                   (nota ? '<p class="text-xs mt-1" style="color:var(--adm-tinta-3)">' + esc(nota) + '</p>' : '') + '</div>';
        }

        // Mês em foco
        var foco = vend.mesFoco;
        var mf = vend.meses.filter(function (m) { return m.mes === foco; })[0];
        var ma = vend.meses.filter(function (m) { return m.mes === vendMesAnterior(foco); })[0];
        var vf = mf ? vendNum(mf.valor_centavos) : 0, va = ma ? vendNum(ma.valor_centavos) : 0;
        var variacao;
        if (!ma || va <= 0) {
            variacao = '<span class="text-sm" style="color:var(--adm-tinta-3)">sem mês anterior para comparar</span>';
        } else {
            var pct = (vf - va) / va * 100, sobe = pct >= 0;
            variacao = '<span class="text-sm font-bold" style="color:' + (sobe ? 'var(--adm-bom)' : 'var(--adm-ruim)') + '">' +
                '<i class="fa-solid ' + (sobe ? 'fa-arrow-up' : 'fa-arrow-down') + ' mr-1"></i>' +
                esc((sobe ? '+' : '') + pct.toFixed(1).replace('.', ',') + '%') + '</span>' +
                '<span class="text-xs ml-2" style="color:var(--adm-tinta-3)">vs ' + esc(vendMesRotulo(vendMesAnterior(foco))) + ' (' + esc(brl(va)) + ')</span>';
        }
        var parcialFoco = foco === atual;

        var fm = vend.fam.filter(function (f) { return f.mes === foco; });
        var porFormato = VEND_FORMATOS.map(function (f) {
            return { rot: f[1], v: fm.filter(function (x) { return x.formato === f[0]; }).reduce(function (a, x) { return a + vendNum(x.valor_centavos); }, 0) };
        });
        var mapaSab = {};
        fm.forEach(function (x) {
            var k = x.familia, o = mapaSab[k] || (mapaSab[k] = { rot: vendLimparNome(x.nome_familia), v: 0 });
            o.v += vendNum(x.valor_centavos);
        });
        var sabores = Object.keys(mapaSab).map(function (k) { return mapaSab[k]; })
            .filter(function (s) { return s.v > 0; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 15);

        // Por mês / por dia / dia da semana
        var itensMes = vendItensMes();
        var ult90 = vend.dias.slice(-90);
        var itensDia = ult90.map(function (d) {
            var p = String(d.dia).split('-');
            return { rot: p[2] + '/' + p[1], v: vendNum(d.valor_centavos), dica: p[2] + '/' + p[1] + '/' + p[0] + ': ' + brl(vendNum(d.valor_centavos)) };
        });
        var soma = [0, 0, 0, 0, 0, 0, 0], cont = [0, 0, 0, 0, 0, 0, 0];
        vend.dias.forEach(function (d) {
            var v = vendNum(d.valor_centavos);
            if (v <= 0) return;
            var q = String(d.dia).split('-'), w = new Date(Number(q[0]), Number(q[1]) - 1, Number(q[2])).getDay();
            soma[w] += v; cont[w]++;
        });
        var itensSemana = [1, 2, 3, 4, 5, 6, 0].map(function (w) {
            var v = cont[w] ? soma[w] / cont[w] : 0;
            return { rot: VEND_DIAS_SEMANA[w], v: v, dica: VEND_DIAS_SEMANA[w] + ': média ' + brl(Math.round(v)) + ' (' + cont[w] + ' dias com venda)' };
        });

        function cartao(titulo, sub, corpo) {
            return '<div class="adm-card p-5"><p class="font-bold">' + esc(titulo) + '</p>' +
                   '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">' + esc(sub) + '</p>' + corpo + '</div>';
        }

        alvo.innerHTML =
            '<div class="flex items-center gap-2 mb-3 text-sm" style="color:var(--adm-tinta-2)"><i class="fa-regular fa-clock"></i><span>Atualizado ' + esc(cab.txt) + '</span></div>' +
            (cab.alerta ? '<div class="adm-card p-4 mb-3 text-sm" role="alert" style="border-color:var(--adm-ruim-borda)"><i class="fa-solid fa-triangle-exclamation mr-2" style="color:var(--adm-ruim)"></i>' + esc(cab.alerta) + '</div>' : '') +
            '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">' +
                kpi('Total no período', brl(total), vendMesRotulo(vend.meses[0].mes) + ' a ' + vendMesRotulo(vend.meses[vend.meses.length - 1].mes)) +
                kpi('Média por mês completo', completos.length ? brl(Math.round(media)) : '—', completos.length + ' meses completos') +
                kpi('Potes vendidos', NUM.format(Math.round(potes)), 'caixas contadas em potes') +
                kpi('Meses no histórico', NUM.format(vend.meses.length), 'mês corrente é parcial') +
            '</div>' +
            '<div class="adm-card p-5 mb-5"><div class="flex items-center flex-wrap gap-3 mb-3">' +
                '<label for="vend-mes" class="adm-tile-rotulo">Mês em foco</label>' +
                '<select id="vend-mes" class="adm-input" style="width:auto;padding:.45rem .7rem">' +
                    vend.meses.slice().reverse().map(function (m) {
                        return '<option value="' + esc(m.mes) + '"' + (m.mes === foco ? ' selected' : '') + '>' + esc(vendMesRotulo(m.mes)) + '</option>';
                    }).join('') + '</select></div>' +
                '<p class="adm-heroi">' + esc(brl(vf)) + '</p>' +
                '<div class="mt-1">' + variacao + '</div>' +
                (parcialFoco ? '<p class="text-xs mt-2" style="color:var(--adm-tinta-3)">Mês em andamento: a comparação é com o mês anterior inteiro.</p>' : '') +
            '</div>' +
            '<div class="grid lg:grid-cols-2 gap-5 mb-5">' +
                cartao('Por formato', 'Vendas do mês em foco', vendLista(porFormato.filter(function (f) { return f.v > 0; }), vf)) +
                cartao('Top 15 sabores', 'Vendas do mês em foco', vendLista(sabores, vf)) +
            '</div>' +
            '<div class="grid gap-5">' +
                cartao('Vendas por mês', 'Mês corrente em cinza (parcial)', vendBarras(itensMes, 'Vendas por mês em reais', 1)) +
                cartao('Vendas por dia', 'Últimos 90 dias', vendBarras(itensDia, 'Vendas por dia nos últimos 90 dias em reais', 10)) +
                cartao('Média por dia da semana', 'Só dias com venda, em todo o histórico', vendBarras(itensSemana, 'Média de vendas por dia da semana em reais', 1)) +
            '</div>' +
            '<div class="grid gap-5 mt-5" id="vend-preco-saz">' + vendHtmlPreco() + vendHtmlSazonalidade() + '</div>' +
            '<p class="text-xs mt-4" style="color:var(--adm-tinta-3)">Somente leitura. Valores do ERP SOLIDCON, em reais.</p>';

        $('#vend-mes').addEventListener('change', function (ev) { vend.mesFoco = ev.target.value; desenharVendasErp(); });
        var met = $('#vend-metrica');
        if (met) met.addEventListener('change', function (ev) { vend.metrica = ev.target.value === 'valor' ? 'valor' : 'potes'; desenharVendasErp(); });
    }


    /* ===================================================================
     * Painel por assunto — junção site x ERP SOLIDCON (somente leitura)
     * Cada aba de assunto ganha um bloco do ERP, com etiqueta de origem.
     * =================================================================== */
    var SELO_ERP = '<span class="adm-selo adm-selo-erp">ERP SOLIDCON</span>';
    var SELO_SITE = '<span class="adm-selo adm-selo-neutro">Site</span>';

    // Carrega sob demanda o que a aba precisa do ERP (uma vez; "Atualizar" força de novo).
    function carregarErpDaAba(qual, forcar) {
        function precisa(o) { return forcar ? !o.carregando : (!o.carregado && !o.carregando && !o.ausente && !o.erro); }
        if ((qual === 'solidcon' || qual === 'vitrine') && precisa(solid)) carregarSolidcon();
        if ((qual === 'solidcon' || qual === 'pedidos' || qual === 'vendas') && precisa(vend)) carregarVendas();
        if ((qual === 'clientes' || qual === 'pedidos') && precisa(scli)) carregarSolidClientes();
        if (qual === 'pedidos' && precisa(kv)) carregarKanbanErp();
        if ((qual === 'clientes' || qual === 'regioes' || qual === 'vendas') && precisa(cmp)) carregarCompras();
        if (qual === 'regioes' && precisa(geo)) carregarGeoClientes();
        if (qual === 'regioes' && papel === 'admin' && precisa(gmap)) carregarMapaClientes();
        if (qual === 'clientes' && papel === 'admin' && precisa(rec)) carregarReceber();
        if (qual === 'vitrine' && precisa(giro)) carregarGiro();
        if (qual === 'vitrine' && precisa(ent)) carregarEntradas();
        if (qual === 'vitrine' && precisa(ins)) carregarInsumos();
        if (qual === 'vendas' && papel === 'admin' && precisa(mg)) carregarMargem();
        if (qual === 'vendas' && papel === 'admin' && precisa(solid)) carregarSolidcon(); // nomes de produto da margem
        if (qual === 'vendas' && precisa(pag)) carregarPagamentos();
        if (qual === 'dashboard') dashCarregarProgressivo(forcar);
    }
    function recarregarErp() { secoesDe(abaAtual).forEach(function (s) { carregarErpDaAba(s, true); }); }

    // ---- Pedidos: vendas registradas no ERP (totais, não pedidos) ----
    function desenharPedidos() {
        var alvo = $('#painel-pedidos');
        desenharPedidosBase();
        alvo.insertAdjacentHTML('beforeend', '<section id="pedidos-erp" class="mt-10"></section>');
        desenharPedidosErp();
    }

    function desenharPedidosErp() {
        var alvo = $('#pedidos-erp');
        if (!alvo) return;
        var cab = '<div class="flex items-center gap-2 mb-2">' + SELO_ERP + '<p class="font-bold">Vendas registradas no SOLIDCON</p></div>' +
            '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">Totais vendidos por dia e por produto no ERP; não se cruzam linha a linha com os pedidos do site acima. ' +
            'O selo "Faturado no ERP" dos cartões vem das vendas por cliente (cupons).</p>';
        if (vend.carregando && !vend.carregado) {
            alvo.innerHTML = cab + '<div class="adm-card p-6 text-center text-sm" style="color:var(--adm-tinta-2)"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando vendas do SOLIDCON…</div>';
            return;
        }
        if (vend.ausente) {
            alvo.innerHTML = cab + cartaoVazio('Vendas do ERP ainda não instaladas', 'As views solidcon_vendas_* não existem neste banco.');
            return;
        }
        if (vend.erro) {
            alvo.innerHTML = cab + '<div class="adm-card p-6"><p class="text-sm mb-3" style="color:var(--adm-tinta-2)">Não foi possível carregar: ' + esc(vend.erro) + '</p>' +
                '<button type="button" class="adm-botao-fantasma" id="pedidos-erp-tentar">Tentar de novo</button></div>';
            $('#pedidos-erp-tentar').addEventListener('click', carregarVendas);
            return;
        }
        if (!vend.carregado) return;
        if (!vend.meses.length) {
            alvo.innerHTML = cab + cartaoVazio('Nenhuma venda sincronizada ainda', 'Quando a rotina de vendas rodar, os totais aparecem aqui.');
            return;
        }

        var ult = vend.meses[vend.meses.length - 1];
        var ant = vend.meses.filter(function (m) { return m.mes === vendMesAnterior(ult.mes); })[0];
        var ult7 = vend.dias.slice(-7).reduce(function (a, d) { return a + vendNum(d.valor_centavos); }, 0);
        var ultimosDias = vend.dias.slice(-10).reverse();
        var porSabor = {};
        vend.fam.filter(function (f) { return f.mes === ult.mes; }).forEach(function (x) {
            var o = porSabor[x.familia] || (porSabor[x.familia] = { rot: vendLimparNome(x.nome_familia), v: 0 });
            o.v += vendNum(x.valor_centavos);
        });
        var top = Object.keys(porSabor).map(function (k) { return porSabor[k]; })
            .filter(function (s) { return s.v > 0; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 5);
        var fmtDia = function (iso) { var q = String(iso).split('-'); return q[2] + '/' + q[1] + '/' + q[0]; };
        function kpi(r, v, nota) {
            return '<div class="adm-card p-4"><p class="adm-tile-rotulo mb-1">' + r + '</p><p class="adm-tile-valor">' + esc(v) + '</p>' +
                   (nota ? '<p class="text-xs mt-1" style="color:var(--adm-tinta-3)">' + esc(nota) + '</p>' : '') + '</div>';
        }
        var podeVerGraficos = papel !== 'vendedor';

        alvo.innerHTML = cab +
            '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">' +
                kpi(vendMesRotulo(ult.mes), brl(vendNum(ult.valor_centavos)), ult.mes >= vendMesAtual() ? 'mês em andamento' : 'mês fechado') +
                kpi('Mês anterior', ant ? brl(vendNum(ant.valor_centavos)) : '—', ant ? vendMesRotulo(ant.mes) : 'sem histórico') +
                kpi('Últimos 7 dias', brl(ult7), 'dias com dado no ERP') +
                kpi('Potes no mês', NUM.format(Math.round(vendNum(ult.potes))), 'caixas contadas em potes') +
            '</div>' +
            '<div class="grid lg:grid-cols-2 gap-5">' +
                '<div class="adm-card p-5"><p class="font-bold mb-3">Total por dia</p>' +
                    '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Dia</th><th class="num">Valor</th><th class="num">Potes</th></tr></thead><tbody>' +
                    ultimosDias.map(function (d) {
                        return '<tr><td>' + esc(fmtDia(d.dia)) + '</td><td class="num">' + esc(brl(vendNum(d.valor_centavos))) + '</td><td class="num">' + esc(NUM.format(Math.round(vendNum(d.potes)))) + '</td></tr>';
                    }).join('') + '</tbody></table></div></div>' +
                '<div class="adm-card p-5"><p class="font-bold">Top 5 produtos</p><p class="text-xs mb-3" style="color:var(--adm-tinta-3)">' + esc(vendMesRotulo(ult.mes)) + '</p>' +
                    vendLista(top, vendNum(ult.valor_centavos)) + '</div>' +
            '</div>' +
            (podeVerGraficos ? '<p class="text-xs mt-4" style="color:var(--adm-tinta-3)">Gráficos e comparativos completos: <button type="button" class="underline" id="pedidos-erp-ir" style="color:var(--adm-acao)">Dashboard de vendas</button>.</p>' : '');
        var ir = $('#pedidos-erp-ir');
        if (ir) ir.addEventListener('click', function () { trocarAba('vendas'); });
    }

    // ---- Dashboard de vendas: Site x ERP ----
    function desenharVendas() {
        var alvo = $('#painel-vendas');
        alvo.innerHTML =
            '<section><div class="flex items-center gap-2 mb-4">' + SELO_SITE + '<p class="font-bold text-lg">Vendas pelo site</p></div><div id="vendas-site"></div></section>' +
            '<section class="mt-12 pt-8" style="border-top:1px solid var(--adm-borda)"><div class="flex items-center gap-2 mb-1">' + SELO_ERP +
                '<p class="font-bold text-lg">Vendas no ERP</p></div>' +
                '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">Total de todas as vendas registradas no SOLIDCON (inclui o que não veio pelo site).</p><div id="vendas-erp"></div></section>' +
            '<section id="vendas-clientes" class="mt-12 pt-8" style="border-top:1px solid var(--adm-borda)"></section>' +
            '<section id="vendas-pagamentos" class="mt-12 pt-8" style="border-top:1px solid var(--adm-borda)"></section>' +
            '<section id="vendas-margem" class="mt-12 pt-8" style="border-top:1px solid var(--adm-borda)"></section>';
        desenharVendasBase();
        desenharVendasErp();
        desenharVendasClientes();
        desenharVendasPagamentos();
        mgLigar($('#vendas-margem'));
        desenharMargem();
    }

    // ---- Clientes: cadastros no ERP (tabela solidcon_clientes, ainda a instalar) ----
    var scli = { carregado: false, carregando: false, ausente: false, erro: null, lista: [], docs: null, busca: '', mostrar: 50, semEndereco: false };
    var SCLI_COLS = 'documento,tipo,nome,telefone,celular,email,cidade,bairro,estado,coletado_em';
    // Erro de coluna inexistente (migração 027 ainda não aplicada): NÃO é tabela ausente.
    function scliColunaAusente(e) {
        return !!e && (String(e.code || '') === '42703' || String(e.code || '') === 'PGRST204' ||
            /column .*(logradouro|numero|complemento|cep)|(logradouro|complemento|cep).*(does not exist|schema cache)/i.test(String(e.message || '')));
    }
    function scliConsulta(cols) {
        return vendPaginar(function () { return sb.from('solidcon_clientes').select(cols).order('nome', { ascending: true }); });
    }

    function docDigitos(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

    // Chave de comparação: só dígitos, completando com zeros conforme o TIPO conhecido
    // ('cnpj' -> 14, 'cpf' -> 11). Sem tipo conhecido, infere pelo tamanho (<=11 CPF, 12-14 CNPJ).
    // Mais que 14 dígitos (ou mais que o tipo comporta) não é documento: sem chave.
    function docNorm(s, tipo) {
        var d = docDigitos(s), t = String(tipo || '').toLowerCase();
        if (!d || /^0+$/.test(d)) return ''; // vazio ou só zeros = consumidor sem identificação
        var n = t === 'cnpj' ? 14 : t === 'cpf' ? 11 : (d.length <= 11 ? 11 : 14);
        if (d.length > n) return '';
        return d.padStart(n, '0');
    }

    function carregarSolidClientes() {
        scli.carregando = true;
        scliRedesenhar();
        // Com endereço completo (027); se as colunas ainda não existem, repete sem elas (lista segue funcionando).
        return scliConsulta(SCLI_COLS + ',logradouro,numero,complemento,cep').then(function (r) {
            if (r.error && scliColunaAusente(r.error)) { scli.semEndereco = true; return scliConsulta(SCLI_COLS); }
            scli.semEndereco = false;
            return r;
        }).then(function (r) {
            scli.carregando = false;
            scli.ausente = false; scli.erro = null;
            if (r.error) {
                if (solidTabelaAusente(r.error)) scli.ausente = true; else scli.erro = String(r.error.message || r.error);
                scli.carregado = false; scli.docs = null;
            } else {
                scli.lista = r.data || [];
                scli.docs = {};
                scli.lista.forEach(function (c) { var d = docNorm(c.documento, c.tipo); if (d) scli.docs[d] = true; });
                scli.carregado = true;
            }
            scliRedesenhar();
        }).catch(function (e) {
            scli.carregando = false; scli.erro = String(e && e.message || e); scli.carregado = false; scli.docs = null; scliRedesenhar();
        });
    }

    function scliRedesenhar() {
        dashAtualizarResumo();
        abasParaRedesenhar.clientes = true;
        abasParaRedesenhar.pedidos = true;
        desenharAbaSeSuja(abaAtual);
    }

    // true se o documento (CNPJ/CPF) do cliente do site já existe no ERP
    function jaNoErp(doc, tipo) {
        var d = docNorm(doc, tipo);
        return !!(scli.docs && d && scli.docs[d]);
    }

    function desenharClientes() {
        var alvo = $('#painel-clientes');
        alvo.innerHTML = '<section id="clientes-lista"></section><section id="clientes-financeiro" class="mt-10"></section><section id="clientes-compras" class="mt-10"></section>';
        recLigar($('#clientes-financeiro'));
        desenharClientesLista();
        desenharClientesFinanceiro();
        desenharClientesCompras();
    }

    // Endereço completo só de CNPJ (CPF nunca é exibido, mesmo que a coluna venha preenchida). Só texto: sem geocodificação.
    function scliCep(v) {
        var d = docDigitos(v);
        return d.length === 8 ? d.slice(0, 5) + '-' + d.slice(5) : String(v || '').trim();
    }
    function scliEndereco(c) {
        if (String(c.tipo || '').toLowerCase() !== 'cnpj') return '—';
        var rua = [String(c.logradouro || '').trim(), String(c.numero || '').trim()].filter(Boolean).join(', ');
        var partes = [rua, String(c.complemento || '').trim()].filter(Boolean).join(' — ');
        var cep = scliCep(c.cep);
        if (!partes && !cep) return scli.semEndereco ? '<span class="text-xs" style="color:var(--adm-tinta-3)">ainda não instalado</span>' : '—';
        return esc(partes || '—') + (cep ? '<br><span class="text-xs" style="color:var(--adm-tinta-3)">CEP ' + esc(cep) + '</span>' : '');
    }

    /* ===================================================================
     * Compras por cliente (ERP) — SOMENTE LEITURA — tabela solidcon_vendas_clientes (migração 026)
     * Uma consulta só (dia, documento, tipo, valor), sob demanda e em cache; tudo o mais é calculado
     * em memória e alimenta Clientes, Regiões (mapa por valor) e Dashboard de vendas.
     * Sem a tabela: aviso "ainda não instalado". Compras sem documento (consumidor) não entram.
     * =================================================================== */
    var CMP_LIMITE = 20000, CMP_MIN_COMPRAS = 3, CMP_FATOR = 1.5, CMP_MIN_DIAS = 30, CMP_PERDIDO = 90, CMP_MESES_VALOR = 6;
    var cmp = { carregado: false, carregando: false, ausente: false, erro: null, truncado: false, por: null, semDoc: 0,
                hoje: '', corte: '', mostrarSumindo: 30 };

    function cmpIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function cmpUtc(iso) { var p = String(iso).split('-'); return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
    function cmpDias(a, b) { return Math.round((cmpUtc(b) - cmpUtc(a)) / 86400000); }
    function cmpSomaDias(iso, n) { return new Date(cmpUtc(iso) + n * 86400000).toISOString().slice(0, 10); }
    function cmpData(iso) { var p = String(iso).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
    // Hoje menos N meses, com o dia limitado ao último dia do mês de destino (31/08 - 6 meses = 28/02).
    function cmpMesesAtras(d, n) {
        var a = d.getFullYear(), m = d.getMonth() - n;
        while (m < 0) { m += 12; a--; }
        var ult = new Date(a, m + 1, 0).getDate();
        return a + '-' + String(m + 1).padStart(2, '0') + '-' + String(Math.min(d.getDate(), ult)).padStart(2, '0');
    }
    function cmpMediana(v) {
        var s = v.slice().sort(function (a, b) { return a - b; }), m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }

    // Agrega por documento: n compras, total e ticket dos últimos 6 meses, frequência típica
    // (mediana do intervalo entre DIAS de compra distintos), valor médio mensal (total ÷ meses entre a 1ª e a última compra, mín. 1).
    function cmpCalcular(linhas) {
        var hoje = cmpIso(new Date()), corte = cmpMesesAtras(new Date(), CMP_MESES_VALOR), por = {}, semDoc = 0;
        linhas.forEach(function (l) {
            var k = docNorm(l.documento, l.tipo);
            if (!k) { semDoc++; return; }
            var dia = String(l.dia).slice(0, 10), v = vendNum(l.valor_centavos);
            var o = por[k] || (por[k] = { doc: k, dias: [], n: 0, total: 0, n6: 0, total6: 0 });
            o.n++; o.total += v; o.dias.push(dia);
            if (dia >= corte) { o.n6++; o.total6 += v; }
        });
        Object.keys(por).forEach(function (k) {
            var o = por[k]; o.dias.sort();
            var un = o.dias.filter(function (d, i) { return i === 0 || d !== o.dias[i - 1]; }), iv = [];
            for (var i = 1; i < un.length; i++) iv.push(cmpDias(un[i - 1], un[i]));
            o.primeira = un[0]; o.ultima = un[un.length - 1];
            o.freq = iv.length ? cmpMediana(iv) : null;
            o.ticket6 = o.n6 ? o.total6 / o.n6 : null;
            o.desde = cmpDias(o.ultima, hoje);
            o.mensal = o.total / Math.max(1, cmpDias(o.primeira, o.ultima) / 30.4375);
        });
        cmp.por = por; cmp.semDoc = semDoc; cmp.hoje = hoje; cmp.corte = corte;
    }

    function carregarCompras() {
        cmp.carregando = true;
        cmpRedesenhar();
        return vendPaginar(function () {
            return sb.from('solidcon_vendas_clientes').select('dia,documento,tipo,valor_centavos')
                .order('dia', { ascending: true }).order('cd_pdv', { ascending: true }).order('nr_cupom', { ascending: true });
        }, CMP_LIMITE).then(function (r) {
            cmp.carregando = false; cmp.ausente = false; cmp.erro = null; cmp.truncado = false;
            if (r.error) {
                if (solidTabelaAusente(r.error)) cmp.ausente = true; else cmp.erro = String(r.error.message || r.error);
                cmp.carregado = false; cmp.por = null;
            } else {
                cmp.truncado = (r.data || []).length >= CMP_LIMITE;
                if (cmp.truncado) { cmp.por = null; } else { cmpCalcular(r.data || []); }
                cmp.carregado = true;
            }
            cmpRedesenhar();
        }).catch(function (e) {
            cmp.carregando = false; cmp.erro = String(e && e.message || e); cmp.carregado = false; cmp.por = null; cmpRedesenhar();
        });
    }

    function cmpRedesenhar() {
        dashAtualizarResumo();
        abasParaRedesenhar.clientes = true; abasParaRedesenhar.regioes = true; abasParaRedesenhar.vendas = true;
        desenharAbaSeSuja(abaAtual);
    }

    // Índice dos cadastros do ERP por documento normalizado (nome, telefone…); refeito só se a lista mudou.
    function cmpCadastros() {
        if (!scli.carregado || !scli.lista) return null;
        if (scli.idxDe !== scli.lista) {
            scli.idx = {}; scli.idxDe = scli.lista;
            scli.lista.forEach(function (c) { var k = docNorm(c.documento, c.tipo); if (k) scli.idx[k] = c; });
        }
        return scli.idx;
    }

    function cmpPronto() { return cmp.carregado && !cmp.erro && !cmp.ausente && !cmp.truncado && !!cmp.por; }

    // Aviso (HTML) quando não há dados utilizáveis; null quando pronto.
    function cmpAviso() {
        if (cmpPronto()) return null;
        if (cmp.ausente) return cartaoVazio('Histórico de compras ainda não instalado', 'A tabela solidcon_vendas_clientes (migração 026) ainda não existe neste banco.');
        if (cmp.erro) return '<div class="adm-card p-6"><p class="text-sm mb-3" style="color:var(--adm-tinta-2)">Não foi possível carregar o histórico de compras: ' + esc(cmp.erro) + '</p>' +
            '<button type="button" class="adm-botao-fantasma" data-cmp-tentar>Tentar de novo</button></div>';
        if (cmp.carregado && cmp.truncado) return cartaoVazio('Histórico grande demais para o painel', 'Há mais de ' + NUM.format(CMP_LIMITE) + ' compras no histórico; os indicadores ficam indisponíveis para não mostrar números incompletos.');
        return '<div class="adm-card p-6 text-center text-sm" style="color:var(--adm-tinta-2)"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando histórico de compras…</div>';
    }
    function cmpLigarTentar(alvo) {
        var b = alvo.querySelector('[data-cmp-tentar]');
        if (b) b.addEventListener('click', carregarCompras);
    }

    // Clientes com >= 3 compras, parados há mais que 1,5x a frequência típica (mín. 30 dias), por valor médio mensal.
    function cmpSumindo() {
        return Object.keys(cmp.por).map(function (k) { return cmp.por[k]; }).filter(function (o) {
            return o.n >= CMP_MIN_COMPRAS && o.freq != null && o.desde > Math.max(CMP_MIN_DIAS, CMP_FATOR * o.freq);
        }).sort(function (a, b) { return b.mensal - a.mensal; });
    }

    function cmpNome(o, cad) {
        var c = cad && cad[o.doc];
        return c && c.nome ? c.nome : '(sem cadastro) ' + o.doc;
    }

    function desenharClientesCompras() {
        var alvo = $('#clientes-compras');
        if (!alvo) return;
        var cab = '<div class="flex items-center gap-2 mb-2">' + SELO_ERP + '<p class="font-bold">Histórico de compras por cliente</p></div>' +
            '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">Compras registradas no SOLIDCON, ligadas ao cadastro pelo CNPJ/CPF (somente leitura). Total e ticket desde ' + (cmp.corte ? esc(cmpData(cmp.corte)) : CMP_MESES_VALOR + ' meses atrás') + ' (' + CMP_MESES_VALOR + ' meses); frequência = mediana de dias entre compras.</p>';
        var av = cmpAviso();
        if (av) { alvo.innerHTML = cab + av; cmpLigarTentar(alvo); return; }
        if (!Object.keys(cmp.por).length) { alvo.innerHTML = cab + cartaoVazio('Nenhuma compra com cliente identificado', 'Quando a rotina de compras rodar, o histórico aparece aqui.'); return; }

        var cad = cmpCadastros(), sum = cmpSumindo();
        var semContato = !cad ? '<p class="text-xs mb-2" style="color:var(--adm-tinta-3)">Contatos indisponíveis: cadastros do ERP ' + (scli.carregando ? 'carregando…' : 'não carregados.') + '</p>' : '';
        var parteSum = sum.slice(0, cmp.mostrarSumindo);
        alvo.innerHTML = cab +
            '<div class="adm-card p-5 mb-5"><p class="font-bold">Clientes sumindo (' + NUM.format(sum.length) + ')</p>' +
            '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">' + CMP_MIN_COMPRAS + '+ compras e sem comprar há mais de ' + String(CMP_FATOR).replace('.', ',') + '× a frequência típica (mínimo ' + CMP_MIN_DIAS + ' dias). Ordenados pelo valor médio mensal. Telefones: uso interno da equipe.</p>' + semContato +
            (sum.length ? '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Cliente</th><th>Telefone</th><th>Última compra</th>' +
                '<th class="num">Frequência</th><th class="num">Compras</th><th class="num">Média/mês</th></tr></thead><tbody>' +
                parteSum.map(function (o) {
                    var c = cad && cad[o.doc], tel = c ? [c.telefone, c.celular].filter(Boolean).join(' / ') : '';
                    return '<tr><td>' + esc(cmpNome(o, cad)) + '</td><td>' + esc(tel || '—') + '</td>' +
                        '<td>' + esc(cmpData(o.ultima)) + ' <span class="text-xs" style="color:var(--adm-tinta-3)">há ' + NUM.format(o.desde) + ' dias</span></td>' +
                        '<td class="num">a cada ' + NUM.format(Math.round(o.freq)) + ' dias</td><td class="num">' + NUM.format(o.n) + '</td><td class="num">' + esc(brl(Math.round(o.mensal))) + '</td></tr>';
                }).join('') + '</tbody></table></div>' +
                (sum.length > parteSum.length ? '<button type="button" class="adm-botao-fantasma mt-3" id="cmp-mais-sum">Mostrar mais</button>' : '')
              : '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhum cliente nessa situação.</p>') + '</div>' +
            (cmp.semDoc ? '<p class="text-xs mt-2" style="color:var(--adm-tinta-3)">' + NUM.format(cmp.semDoc) + ' compras sem CNPJ/CPF informado ficaram de fora.</p>' : '');
        var ms = $('#cmp-mais-sum');
        if (ms) ms.addEventListener('click', function () { cmp.mostrarSumindo += 30; desenharClientesCompras(); });
    }

    // Ativos, novos e perdidos por mês (14 meses terminando no atual). null se não há clientes identificados.
    function cmpDadosMensais() {
        var todos = Object.keys(cmp.por).map(function (k) { return cmp.por[k]; });
        if (!todos.length) return null;
        var mesDe = function (iso) { return String(iso).slice(0, 7) + '-01'; };
        var primeiro = todos.reduce(function (a, o) { return o.primeira < a ? o.primeira : a; }, todos[0].primeira);
        var atual = mesDe(cmp.hoje), meses = [], m = atual, primeiroMes = mesDe(primeiro);
        for (var q = 0; q < 14; q++) { meses.unshift(m); m = vendMesAnterior(m); } // 14 meses terminando no atual
        var ativos = {}, novos = {}, perdidos = {}, agoraPerdidos = 0;
        meses.forEach(function (x) { ativos[x] = 0; novos[x] = 0; perdidos[x] = 0; });
        todos.forEach(function (o) {
            var vistos = {};
            o.dias.forEach(function (d) { var k = mesDe(d); if (!vistos[k]) { vistos[k] = 1; if (k in ativos) ativos[k]++; } });
            var kn = mesDe(o.primeira); if (kn in novos) novos[kn]++;
            var fim = cmpSomaDias(o.ultima, CMP_PERDIDO);
            if (fim <= cmp.hoje) { agoraPerdidos++; var kp = mesDe(fim); if (kp in perdidos) perdidos[kp]++; }
        });
        return { meses: meses, atual: atual, ativos: ativos, novos: novos, perdidos: perdidos, agoraPerdidos: agoraPerdidos,
                 primeiro: primeiro, primeiroMes: primeiroMes, totalClientes: todos.length };
    }

    // Tabela mensal (últimos n meses do cálculo).
    function cmpHtmlTabelaMensal(d, n) {
        var ms = d.meses.slice(-n);
        var maxA = Math.max.apply(null, ms.map(function (x) { return d.ativos[x]; }).concat([1]));
        return '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Mês</th><th class="num">Ativos</th><th style="width:35%"></th><th class="num">Novos</th><th class="num">Perdidos</th></tr></thead><tbody>' +
            ms.map(function (x) {
                var pri = x === d.primeiroMes; // só o primeiro mês REAL do histórico
                return '<tr><td>' + esc(vendMesRotulo(x)) + (x === d.atual ? ' <span class="text-xs" style="color:var(--adm-tinta-3)">(parcial)</span>' : '') + '</td>' +
                    '<td class="num">' + NUM.format(d.ativos[x]) + '</td>' +
                    '<td><div style="height:6px;border-radius:99px;background:var(--adm-borda)"><div style="height:6px;border-radius:99px;background:var(--adm-dados);width:' + (d.ativos[x] / maxA * 100).toFixed(1) + '%"></div></div></td>' +
                    '<td class="num"' + (pri ? ' title="Primeiro mês do histórico: não dá para separar novos de antigos"' : '') + '>' + (pri ? '—' : NUM.format(d.novos[x])) + '</td>' +
                    '<td class="num">' + NUM.format(d.perdidos[x]) + '</td></tr>';
            }).join('') + '</tbody></table></div>';
    }

    // Dashboard de vendas: clientes ativos, novos e perdidos por mês.
    function desenharVendasClientes() {
        var alvo = $('#vendas-clientes');
        if (!alvo) return;
        var cab = '<div class="flex items-center gap-2 mb-1">' + SELO_ERP + '<p class="font-bold text-lg">Clientes por mês</p></div>' +
            '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">Ativo = comprou no mês. Novo = 1ª compra do histórico no mês. Perdido = completou ' + CMP_PERDIDO + ' dias sem comprar naquele mês (e não voltou).</p>';
        var av = cmpAviso();
        if (av) { alvo.innerHTML = cab + av; cmpLigarTentar(alvo); return; }
        var d = cmpDadosMensais();
        if (!d) { alvo.innerHTML = cab + cartaoVazio('Nenhuma compra com cliente identificado', 'Quando a rotina de compras rodar, os números aparecem aqui.'); return; }
        alvo.innerHTML = cab +
            '<div class="grid grid-cols-2 gap-3 mb-4">' +
                '<div class="adm-card p-4"><p class="adm-tile-rotulo mb-1">Ativos no mês atual</p><p class="adm-tile-valor">' + NUM.format(d.ativos[d.atual] || 0) + '</p><p class="text-xs mt-1" style="color:var(--adm-tinta-3)">mês em andamento</p></div>' +
                '<div class="adm-card p-4"><p class="adm-tile-rotulo mb-1">Sem comprar há ' + CMP_PERDIDO + '+ dias</p><p class="adm-tile-valor">' + NUM.format(d.agoraPerdidos) + '</p><p class="text-xs mt-1" style="color:var(--adm-tinta-3)">de ' + NUM.format(d.totalClientes) + ' clientes no histórico</p></div>' +
            '</div>' +
            '<div class="adm-card p-5">' + cmpHtmlTabelaMensal(d, 14) +
            '<p class="text-xs mt-3" style="color:var(--adm-tinta-3)">O histórico começa em ' + esc(cmpData(d.primeiro)) + ': no 1º mês não há como distinguir cliente novo de antigo.</p></div>';
    }

    /* ===================================================================
     * Vitrine — giro de estoque (cobertura, parados, ranking real)
     * Uma única consulta (solidcon_vendas_dia, 180 dias, só leitura), feita
     * sob demanda e guardada em cache; os três blocos são calculados em memória.
     * =================================================================== */
    var GIRO_LIMITE = 80000, GIRO_JANELA = 180, GIRO_DIAS_UTEIS = 30, GIRO_PARADO = 60, GIRO_CRITICO = 7, GIRO_ATENCAO = 15, GIRO_HORIZONTE = 30;
    var giro = { carregado: false, carregando: false, ausente: false, erro: null, linhas: [], truncado: false,
                 porEan: null, rankDias: 90, todos: false, parados: false };

    function giroIsoHoje() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function giroDiaUtc(iso) { var q = String(iso).split('-'); return Date.UTC(Number(q[0]), Number(q[1]) - 1, Number(q[2])); }
    function giroDiasAtras(iso) { return Math.floor((giroDiaUtc(giroIsoHoje()) - giroDiaUtc(iso)) / 86400000); }

    function carregarGiro() {
        giro.carregando = true;
        giroRedesenhar();
        var d = new Date(Date.now() - GIRO_JANELA * 86400000);
        var desde = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        return vendPaginar(function () {
            return sb.from('solidcon_vendas_dia')
                .select('dia,ean,nome,formato,potes_por_unidade,familia,qtd')
                .gte('dia', desde).order('dia', { ascending: true }).order('ean', { ascending: true });
        }, GIRO_LIMITE).then(function (r) {
            giro.carregando = false;
            giro.ausente = false; giro.erro = null;
            if (r.error) {
                if (solidTabelaAusente(r.error)) giro.ausente = true; else giro.erro = String(r.error.message || r.error);
                giro.carregado = false;
            } else {
                giro.linhas = r.data || [];
                giro.truncado = giro.linhas.length >= GIRO_LIMITE; // exatamente no teto = não dá para provar completude
                giroAgregar();
                giro.carregado = true;
            }
            giroRedesenhar();
        }).catch(function (e) {
            giro.carregando = false; giro.erro = String(e && e.message || e); giroRedesenhar();
        });
    }

    function giroRedesenhar() {
        dashAtualizarResumo();
        abasParaRedesenhar.vitrine = true;
        desenharAbaSeSuja(abaAtual);
    }

    // Por EAN: soma dos últimos 30 dias úteis com venda e data da última venda.
    function giroAgregar() {
        var porDia = {};
        giro.linhas.forEach(function (l) {
            if (Number(l.qtd) > 0) porDia[l.dia] = true;
        });
        var uteis = Object.keys(porDia).filter(function (d) {
            var w = new Date(giroDiaUtc(d)).getUTCDay(); return w >= 1 && w <= 5;
        }).sort().slice(-GIRO_DIAS_UTEIS);
        var set = {}; uteis.forEach(function (d) { set[d] = true; });
        var m = {}, f = {};
        giro.linhas.forEach(function (l) {
            var q = Number(l.qtd) || 0;
            if (q <= 0) return;
            var p = q * (Number(l.potes_por_unidade) || 0), dentro = !!set[l.dia];
            var o = m[l.ean] || (m[l.ean] = { p30: 0, ultimo: null });
            if (dentro) o.p30 += p;
            if (!o.ultimo || l.dia > o.ultimo) o.ultimo = l.dia;
            // Por família (pote + cx24 + cx48): família da linha ou derivada do EAN (13 -> left 12, 14 -> substr 2,12).
            var fam = (/^\d{12}$/.test(String(l.familia || '')) ? String(l.familia) : null) || solidCodigoFamilia(l.ean);
            if (fam) {
                var of = f[fam] || (f[fam] = { p30: 0, ultimo: null });
                if (dentro) of.p30 += p;
                if (!of.ultimo || l.dia > of.ultimo) of.ultimo = l.dia;
            }
        });
        giro.porEan = m;
        giro.porFamilia = f;
        giro.diasUteisUsados = uteis.length;
    }

    // Estoque do produto ERP x vendas dos seus EANs (mesma unidade: a do próprio EAN).
    // Vendas dos EANs de um conjunto de itens (família), em potes, e data da última venda.
    // Vendas em potes de um sabor: por família (pote + cx24 + cx48, mesmo sem o pote estar no espelho);
    // sem família, cai para os EANs do item, deduplicados.
    function giroDoGrupo(itens, familia) {
        var p30 = 0, ultimo = null;
        if (familia) {
            var o = giro.porFamilia[familia];
            if (o) { p30 = o.p30; ultimo = o.ultimo; }
        } else {
            var vistos = {};
            itens.forEach(function (p) {
                (p.eans || []).forEach(function (e) {
                    e = String(e);
                    if (vistos[e]) return;
                    vistos[e] = true;
                    var o = giro.porEan[e];
                    if (!o) return;
                    p30 += o.p30;
                    if (!ultimo || o.ultimo > ultimo) ultimo = o.ultimo;
                });
            });
        }
        var media = giro.diasUteisUsados ? p30 / GIRO_DIAS_UTEIS : 0;
        return { media: media, ultimo: ultimo };
    }

    function giroFmt(n, casas) { return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: casas == null ? 1 : casas }); }
    function giroFmtData(iso) { var q = String(iso).split('-'); return q[2] + '/' + q[1] + '/' + q[0]; }

    function giroSeloCobertura(dias, semGiro) {
        if (semGiro) return '<span class="adm-selo adm-selo-neutro"><i class="fa-solid fa-hourglass-half"></i>Sem giro</span>';
        if (dias <= GIRO_CRITICO) return '<span class="adm-selo adm-selo-cancelado"><i class="fa-solid fa-triangle-exclamation"></i>Crítico</span>';
        if (dias <= GIRO_ATENCAO) return '<span class="adm-selo adm-selo-aguardando"><i class="fa-solid fa-arrow-down"></i>Atenção</span>';
        return '<span class="adm-selo adm-selo-confirmado"><i class="fa-solid fa-check"></i>Ok</span>';
    }

    function giroItensCobertura() {
        var itens = [];
        solidGrupos().forEach(function (gr) {
            var est = solidPotes(gr.itens);
            var g = giroDoGrupo(gr.itens, gr.familia);
            if (est <= 0 && g.media <= 0) return;
            var semGiro = g.media <= 0;
            itens.push({ gr: gr, est: est, media: g.media, semGiro: semGiro,
                         dias: semGiro ? Infinity : est / g.media,
                         sug: semGiro ? 0 : Math.max(0, Math.ceil(g.media * GIRO_HORIZONTE - est)) });
        });
        itens.sort(function (a, b) { return a.dias - b.dias || String(a.gr.nome).localeCompare(String(b.gr.nome)); });
        return itens;
    }

    function giroHtmlCobertura() {
        var itens = giroItensCobertura();
        var criticos = itens.filter(function (i) { return !i.semGiro && i.dias <= GIRO_CRITICO; }).length;
        var atencao = itens.filter(function (i) { return !i.semGiro && i.dias > GIRO_CRITICO && i.dias <= GIRO_ATENCAO; }).length;
        var vis = giro.todos ? itens : itens.slice(0, 15);
        var corpo = !itens.length
            ? '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhum sabor com estoque ou giro no período.</p>'
            : '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Sabor</th><th class="num">Estoque (potes)</th><th class="num">Média potes/dia útil</th>' +
              '<th class="num">Acaba em</th><th>Situação</th><th class="num">Repor p/ ' + GIRO_HORIZONTE + ' dias (potes)</th></tr></thead><tbody>' +
              vis.map(function (i) {
                  return '<tr><td>' + esc(i.gr.nome) + '</td><td class="num">' + esc(NUM.format(i.est)) + '</td>' +
                      '<td class="num">' + (i.semGiro ? '—' : esc(giroFmt(i.media, 1))) + '</td>' +
                      '<td class="num">' + (i.semGiro ? '—' : esc(giroFmt(i.dias, 0) + ' dias')) + '</td>' +
                      '<td>' + giroSeloCobertura(i.dias, i.semGiro) + '</td>' +
                      '<td class="num">' + (i.semGiro ? '—' : esc(NUM.format(i.sug))) + '</td></tr>';
              }).join('') + '</tbody></table></div>' +
              (itens.length > 15 ? '<button type="button" class="adm-botao-fantasma mt-3" id="giro-todos">' +
                  (giro.todos ? 'Mostrar só os 15 mais urgentes' : 'Mostrar todos (' + NUM.format(itens.length) + ')') + '</button>' : '');
        return '<div class="adm-card p-5 mb-5"><p class="font-bold">Estoque acaba em quantos dias</p>' +
            '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">Por sabor (família ERP), em potes: caixas 24 e 48 somadas. Cobertura = estoque ÷ média diária das vendas nos últimos ' + GIRO_DIAS_UTEIS +
            ' dias úteis com venda (' + NUM.format(giro.diasUteisUsados || 0) + ' usados). Crítico ≤ ' + GIRO_CRITICO + ' dias, atenção ≤ ' + GIRO_ATENCAO +
            '. Sugestão = média × ' + GIRO_HORIZONTE + ' − estoque.</p>' +
            '<p class="text-sm mb-3"><strong>' + NUM.format(criticos) + '</strong> crítico(s) · <strong>' + NUM.format(atencao) + '</strong> em atenção</p>' + corpo + '</div>';
    }

    function giroItensParados() {
        var itens = [];
        solidGrupos().forEach(function (gr) {
            var est = solidPotes(gr.itens);
            if (est <= 0) return;
            var g = giroDoGrupo(gr.itens, gr.familia);
            var dias = g.ultimo ? giroDiasAtras(g.ultimo) : null;
            if (dias != null && dias < GIRO_PARADO) return;
            itens.push({ gr: gr, est: est, ultimo: g.ultimo, dias: dias });
        });
        itens.sort(function (a, b) {
            return (b.dias == null ? 1e9 : b.dias) - (a.dias == null ? 1e9 : a.dias) || String(a.gr.nome).localeCompare(String(b.gr.nome));
        });
        return itens;
    }

    function giroHtmlParados() {
        var itens = giroItensParados();
        var vis = giro.parados ? itens : itens.slice(0, 10);
        var corpo = !itens.length
            ? '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhum produto parado com estoque.</p>'
            : '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Sabor</th><th class="num">Estoque (potes)</th><th>Última venda</th><th class="num">Sem venda há</th></tr></thead><tbody>' +
              vis.map(function (i) {
                  return '<tr><td>' + esc(i.gr.nome) + '</td><td class="num">' + esc(NUM.format(i.est)) + '</td>' +
                      '<td>' + (i.ultimo ? esc(giroFmtData(i.ultimo)) : 'nenhuma nos últimos ' + GIRO_JANELA + ' dias') + '</td>' +
                      '<td class="num">' + (i.dias == null ? '—' : esc(NUM.format(i.dias) + ' dias')) + '</td></tr>';
              }).join('') + '</tbody></table></div>' +
              (itens.length > 10 ? '<button type="button" class="adm-botao-fantasma mt-3" id="giro-parados">' +
                  (giro.parados ? 'Mostrar só os 10 mais antigos' : 'Mostrar todos (' + NUM.format(itens.length) + ')') + '</button>' : '');
        return '<div class="adm-card p-5 mb-5"><p class="font-bold">Produtos parados</p>' +
            '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">Sabores com estoque e sem venda há ' + GIRO_PARADO + ' dias ou mais (histórico lido: ' + GIRO_JANELA + ' dias).</p>' + corpo + '</div>';
    }

    // Ranking real: potes vendidos por família (pote + cx24 + cx48 somados), janela escolhida.
    function giroRankingLista(corte) {
        var fam = {};
        giro.linhas.forEach(function (l) {
            if (giroDiasAtras(l.dia) >= corte) return;
            var q = Number(l.qtd) || 0, pu = Number(l.potes_por_unidade) || 0;
            if (q <= 0 || pu <= 0) return;
            var k = l.familia || ('ean:' + l.ean);
            var o = fam[k] || (fam[k] = { nome: null, alt: l.nome, potes: 0 });
            o.potes += q * pu;
            if (l.formato === 'pote' && l.nome) o.nome = l.nome;
        });
        var lista = Object.keys(fam).map(function (k) { return { rot: vendLimparNome(fam[k].nome || fam[k].alt), potes: fam[k].potes }; })
            .filter(function (x) { return x.potes > 0; }).sort(function (a, b) { return b.potes - a.potes; });
        return lista;
    }

    function giroHtmlRanking() {
        var lista = giroRankingLista(giro.rankDias);
        var total = lista.reduce(function (a, x) { return a + x.potes; }, 0);
        var topo = lista.slice(0, 30);
        var max = topo.length ? topo[0].potes : 1;
        var chips = [30, 90, 180].map(function (d) {
            return '<button type="button" class="adm-chip' + (giro.rankDias === d ? ' is-ativo' : '') + '" data-giro-rank="' + d + '">' + d + ' dias</button>';
        }).join('');
        var corpo = !topo.length
            ? '<p class="text-sm" style="color:var(--adm-tinta-3)">Sem vendas nesse período.</p>'
            : '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th class="num">#</th><th>Sabor</th><th class="num">Potes</th><th>Participação</th></tr></thead><tbody>' +
              topo.map(function (x, i) {
                  var pct = total > 0 ? x.potes / total * 100 : 0;
                  return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(x.rot) + '</td><td class="num">' + esc(NUM.format(Math.round(x.potes))) + '</td>' +
                      '<td><div style="display:flex;align-items:center;gap:.5rem"><div style="flex:1;min-width:4rem;height:6px;border-radius:99px;background:var(--adm-borda)">' +
                      '<div style="height:6px;border-radius:99px;background:var(--adm-dados);width:' + (x.potes / max * 100).toFixed(1) + '%"></div></div>' +
                      '<span class="text-xs" style="color:var(--adm-tinta-3);white-space:nowrap">' + esc(giroFmt(pct, 1) + '%') + '</span></div></td></tr>';
              }).join('') + '</tbody></table></div>' +
              (lista.length > 30 ? '<p class="text-xs mt-3" style="color:var(--adm-tinta-3)">Top 30 de ' + NUM.format(lista.length) + ' sabores.</p>' : '');
        return '<div class="adm-card p-5 mb-5"><div class="flex items-center justify-between flex-wrap gap-3 mb-1"><p class="font-bold">Ranking real de vendas</p>' +
            '<div class="flex gap-1 flex-wrap">' + chips + '</div></div>' +
            '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">Potes vendidos no ERP nos últimos ' + giro.rankDias + ' dias, somando pote avulso, caixa 24 e caixa 48 do mesmo sabor. Só no painel por enquanto.</p>' + corpo + '</div>';
    }

    function desenharGiro() {
        var alvo = $('#vitrine-giro');
        if (!alvo) return;
        var cab = '<div class="flex items-center gap-2 mb-4"><span class="adm-selo adm-selo-erp">ERP SOLIDCON</span><p class="font-bold">Giro de estoque</p></div>';
        if (giro.ausente) { alvo.innerHTML = cab + cartaoVazio('Vendas do ERP ainda não instaladas', 'A tabela solidcon_vendas_dia não existe neste banco.'); return; }
        if (giro.erro) {
            alvo.innerHTML = cab + '<div class="adm-card p-6 mb-5"><p class="text-sm mb-3" style="color:var(--adm-tinta-2)">Não foi possível carregar as vendas: ' + esc(giro.erro) + '</p>' +
                '<button type="button" class="adm-botao-fantasma" id="giro-tentar">Tentar de novo</button></div>';
            alvo.querySelector('#giro-tentar').addEventListener('click', carregarGiro);
            return;
        }
        if (!giro.carregado) {
            alvo.innerHTML = cab + '<div class="adm-card p-6 mb-5 text-center text-sm" style="color:var(--adm-tinta-2)"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando vendas dos últimos ' + GIRO_JANELA + ' dias…</div>';
            return;
        }
        if (giro.truncado) {
            // Limite atingido: as linhas lidas podem não cobrir os 180 dias; nada é calculado nem recomendado.
            alvo.innerHTML = cab + '<div class="adm-card p-6 mb-5" role="alert" style="border-color:var(--adm-ruim-borda)">' +
                '<p class="font-bold mb-2"><i class="fa-solid fa-triangle-exclamation mr-2" style="color:var(--adm-ruim)"></i>Giro indisponível: limite de ' + NUM.format(GIRO_LIMITE) + ' linhas atingido</p>' +
                '<p class="text-sm" style="color:var(--adm-tinta-2)">O histórico de vendas dos últimos ' + GIRO_JANELA + ' dias é maior do que o painel consegue ler de uma vez, ' +
                'então cobertura, reposição, produtos parados e ranking não são exibidos para não induzir decisão errada.</p></div>';
            return;
        }
        if (!giro.linhas.length) { alvo.innerHTML = cab + cartaoVazio('Nenhuma venda sincronizada ainda', 'Quando a rotina de vendas rodar, o giro aparece aqui.'); return; }
        alvo.innerHTML = cab +
            giroHtmlCobertura() + giroHtmlParados() + giroHtmlRanking();
        var t = alvo.querySelector('#giro-todos');
        if (t) t.addEventListener('click', function () { giro.todos = !giro.todos; desenharGiro(); });
        var pa = alvo.querySelector('#giro-parados');
        if (pa) pa.addEventListener('click', function () { giro.parados = !giro.parados; desenharGiro(); });
        alvo.querySelectorAll('[data-giro-rank]').forEach(function (b) {
            b.addEventListener('click', function () { giro.rankDias = Number(b.getAttribute('data-giro-rank')); desenharGiro(); });
        });
    }


    /* ===================================================================
     * Vitrine — Entradas de estoque (estimativa a partir da foto diária)
     * Fonte: solidcon_estoque_diario (1 foto/dia por produto, só leitura) + vendas por EAN já em cache (giro).
     * Por produto e dia: entrada = estoque(d) - estoque(d-1) + vendido(d), na unidade do produto (caixa).
     * Só entrada > 0 conta; negativo é "saída sem venda" (ajuste/perda), mostrado à parte.
     * Dia sem foto do dia anterior, ou produto fora da lista em um dos dias, = sem estimativa.
     * =================================================================== */
    var ENT_LIMITE = 80000, ENT_JANELA = 90, ENT_DESDE_TXT = '10/11/2026';
    var ent = { carregado: false, carregando: false, ausente: false, erro: null, linhas: [], truncado: false,
                dias: 30, todos: false, memo: null };

    function entIso(t) {
        var d = new Date(t);
        return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }
    function entDiaAnterior(iso) { return entIso(giroDiaUtc(iso) - 86400000); }
    function entSegunda(iso) {
        var t = giroDiaUtc(iso), w = new Date(t).getUTCDay();
        return entIso(t - ((w + 6) % 7) * 86400000);
    }

    function carregarEntradas() {
        ent.carregando = true;
        entRedesenhar();
        var d = new Date(Date.now() - (ENT_JANELA + 1) * 86400000);
        var desde = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        return vendPaginar(function () {
            return sb.from('solidcon_estoque_diario')
                .select('dia,id_produto,estoque_disponivel,presente')
                .gte('dia', desde).order('dia', { ascending: true }).order('id_produto', { ascending: true });
        }, ENT_LIMITE).then(function (r) {
            ent.carregando = false; ent.ausente = false; ent.erro = null;
            if (r.error) {
                if (solidTabelaAusente(r.error)) ent.ausente = true; else ent.erro = String(r.error.message || r.error);
                ent.carregado = false;
            } else {
                ent.linhas = r.data || [];
                ent.truncado = ent.linhas.length >= ENT_LIMITE; // exatamente no teto = não dá para provar completude
                ent.memo = null;
                ent.carregado = true;
            }
            entRedesenhar();
        }).catch(function (e) {
            ent.carregando = false; ent.erro = String(e && e.message || e); ent.carregado = false; entRedesenhar();
        });
    }

    function entRedesenhar() {
        dashAtualizarResumo();
        abasParaRedesenhar.vitrine = true;
        desenharAbaSeSuja(abaAtual);
    }

    // Registros por produto/dia em potes: {dia, chave, nome, ent, sai, vend}. Memoizado pelas fontes.
    function entCalcular() {
        var m = ent.memo;
        if (m && m.s === solid.produtos && m.g === giro.linhas && m.l === ent.linhas) return m.r;
        var porId = {}, gDe = {}, eanIds = {};
        solid.produtos.forEach(function (p) {
            porId[String(p.id_produto)] = p;
            (p.eans || []).forEach(function (e) { e = String(e); (eanIds[e] || (eanIds[e] = {}))[String(p.id_produto)] = true; });
        });
        solidGrupos().forEach(function (g) { g.itens.forEach(function (p) { gDe[String(p.id_produto)] = g; }); });
        var ambig = {}; // EAN (ou código) dividido entre produtos: a venda não se atribui, então os produtos ficam sem estimativa
        Object.keys(eanIds).forEach(function (e) {
            var ids = Object.keys(eanIds[e]);
            if (ids.length > 1) ids.forEach(function (i) { ambig[i] = true; });
        });
        var vendas = {}; // id|dia -> qtd na unidade do EAN
        giro.linhas.forEach(function (l) {
            var q = Number(l.qtd) || 0;
            if (q <= 0) return;
            // O coletor grava no campo ean o EAN ou, no fallback, o código/id do produto: une os dois caminhos.
            var cod = String(l.ean), set = {};
            Object.keys(eanIds[cod] || {}).forEach(function (i) { set[i] = true; });
            if (porId[cod]) set[cod] = true;
            var ids = Object.keys(set);
            if (ids.length > 1) { ids.forEach(function (i) { ambig[i] = true; }); return; }
            if (ids.length !== 1) return;
            var k = ids[0] + '|' + l.dia;
            vendas[k] = (vendas[k] || 0) + q;
        });
        var foto = {}, fotos = {};
        ent.linhas.forEach(function (l) { foto[String(l.id_produto) + '|' + l.dia] = l; fotos[l.dia] = true; });
        var regs = [], semProduto = {}, ignorados = {};
        ent.linhas.forEach(function (l) {
            var id = String(l.id_produto), p = porId[id];
            if (!p) { semProduto[id] = true; return; }
            if (ambig[id]) { ignorados[id] = true; return; }
            var ant = foto[id + '|' + entDiaAnterior(l.dia)];
            if (!ant || l.presente === false || ant.presente === false) return;
            var un = solidCaixa(p) || 1, v = vendas[id + '|' + l.dia] || 0;
            var delta = Number(l.estoque_disponivel) - Number(ant.estoque_disponivel) + v;
            if (Math.abs(delta) < 1e-9) delta = 0;
            var g = gDe[id];
            regs.push({ dia: l.dia, chave: g ? g.chave : 'id:' + id, nome: g ? g.nome : String(p.nome),
                        ent: delta > 0 ? delta * un : 0, sai: delta < 0 ? -delta * un : 0, vend: v * un });
        });
        var f = Object.keys(fotos).sort();
        var r = { regs: regs, primeiraFoto: f[0] || null, semProduto: Object.keys(semProduto).length, ignorados: Object.keys(ignorados).length };
        ent.memo = { s: solid.produtos, g: giro.linhas, l: ent.linhas, r: r };
        return r;
    }

    function entFmt(n) { return NUM.format(Math.round(n)); }
    function entRot(iso) { var q = String(iso).split('-'); return q[2] + '/' + q[1]; }

    // Barras em potes; itens: [{rot, a, b, dica}]; comB = segunda série (vendas) ao lado.
    function entBarras(itens, desc, cada, comB) {
        if (!itens.length) return '<p class="text-sm" style="color:var(--adm-tinta-3)">Sem dados.</p>';
        var W = wGraf(640), H = 190, pl = (W < 640 ? 66 : 46), pr = 8, pt = 8, pb = 22;
        var max = Math.max.apply(null, itens.reduce(function (a, i) { return a.concat([i.a, i.b || 0]); }, [1]));
        var slot = (W - pl - pr) / itens.length, bw = Math.max(1.5, slot * (comB ? 0.38 : 0.72));
        var y = function (v) { return pt + (H - pt - pb) * (1 - v / max); };
        var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto" role="img" aria-label="' + esc(desc) + '">' +
            '<line x1="' + pl + '" y1="' + y(0) + '" x2="' + (W - pr) + '" y2="' + y(0) + '" stroke="var(--adm-borda-forte)"/>' +
            '<line x1="' + pl + '" y1="' + y(max) + '" x2="' + (W - pr) + '" y2="' + y(max) + '" stroke="var(--adm-borda)" stroke-dasharray="3 3"/>' +
            '<text x="' + (pl - 5) + '" y="' + (y(max) + 4) + '" text-anchor="end" font-size="10" fill="var(--adm-tinta-3)">' + esc(entFmt(max)) + '</text>' +
            '<text x="' + (pl - 5) + '" y="' + (y(0) + 4) + '" text-anchor="end" font-size="10" fill="var(--adm-tinta-3)">0</text>';
        var cadaEnt = W < 640 ? Math.max(cada || 1, Math.ceil(56 / slot)) : cada;
        itens.forEach(function (it, i) {
            var x0 = pl + i * slot + (slot - bw * (comB ? 2 : 1)) / 2;
            out += '<rect x="' + x0.toFixed(1) + '" y="' + y(it.a).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, y(0) - y(it.a)).toFixed(1) +
                   '" rx="1.5" fill="var(--adm-dados)"><title>' + esc(it.dica) + '</title></rect>';
            if (comB) out += '<rect x="' + (x0 + bw).toFixed(1) + '" y="' + y(it.b).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, y(0) - y(it.b)).toFixed(1) +
                   '" rx="1.5" fill="var(--adm-tinta-3)"><title>' + esc(it.dica) + '</title></rect>';
            if (i % cadaEnt === 0) out += '<text x="' + (pl + i * slot + slot / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="var(--adm-tinta-3)">' + esc(it.rot) + '</text>';
        });
        return out + '</svg>';
    }

    // Agregados do período escolhido (últimos N dias, hoje incluído).
    function entAgregar(dias) {
        var c = entCalcular(), tot = { ent: 0, sai: 0, vend: 0 }, porDia = {}, porSemana = {}, porSabor = {};
        c.regs.forEach(function (r) {
            if (giroDiasAtras(r.dia) >= dias) return;
            tot.ent += r.ent; tot.sai += r.sai; tot.vend += r.vend;
            var d = porDia[r.dia] || (porDia[r.dia] = { ent: 0, sai: 0, vend: 0 }); d.ent += r.ent; d.sai += r.sai; d.vend += r.vend;
            var sk = entSegunda(r.dia), s = porSemana[sk] || (porSemana[sk] = { ent: 0, sai: 0, vend: 0, dias: {} });
            s.ent += r.ent; s.sai += r.sai; s.vend += r.vend; s.dias[r.dia] = true;
            var o = porSabor[r.chave] || (porSabor[r.chave] = { nome: r.nome, ent: 0, sai: 0, vend: 0, diasEnt: {} });
            o.ent += r.ent; o.sai += r.sai; o.vend += r.vend; if (r.ent > 0) o.diasEnt[r.dia] = true;
        });
        return { c: c, tot: tot, porDia: porDia, porSemana: porSemana,
                 sabores: Object.keys(porSabor).map(function (k) { return porSabor[k]; }).filter(function (o) { return o.ent > 0 || o.sai > 0; })
                     .sort(function (a, b) { return b.ent - a.ent || String(a.nome).localeCompare(String(b.nome)); }) };
    }

    var ENT_SUBTITULO = 'Estimativa de produção da fábrica/compras, a partir do estoque';
    function entAviso() {
        return ENT_SUBTITULO + ' (inclui compras e ajustes); histórico desde ' + ENT_DESDE_TXT +
               '. Entrada do dia = estoque de hoje − estoque de ontem + vendido no dia, em potes (caixa 24/48 convertida). Dia sem foto do dia anterior fica sem estimativa.';
    }

    function entHtml() {
        var A = entAgregar(ent.dias), c = A.c;
        var chips = [7, 30, 90].map(function (d) {
            return '<button type="button" class="adm-chip' + (ent.dias === d ? ' is-ativo' : '') + '" data-ent-dias="' + d + '">' + d + ' dias</button>';
        }).join('');
        var cab = '<div class="flex items-center justify-between flex-wrap gap-3 mb-1"><p class="text-sm" style="color:var(--adm-tinta-2)">Período</p><div class="flex gap-1 flex-wrap">' + chips + '</div></div>' +
            '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">' + esc(entAviso()) + '</p>';
        var nDias = Object.keys(A.porDia).length;
        if (!nDias) {
            return '<div class="adm-card p-5 mb-5">' + cab + '<p class="text-sm" style="color:var(--adm-tinta-3)">Ainda sem estimativa neste período: são necessárias duas fotos diárias consecutivas' +
                (c.primeiraFoto ? ' (primeira foto lida: ' + esc(giroFmtData(c.primeiraFoto)) + ')' : '') + '.</p></div>';
        }
        // Diário: um slot por dia do período; dia sem estimativa fica vazio.
        var diario = [], hoje = giroDiaUtc(giroIsoHoje());
        for (var i = ent.dias - 1; i >= 0; i--) {
            var iso = entIso(hoje - i * 86400000), x = A.porDia[iso];
            diario.push({ rot: entRot(iso), a: x ? x.ent : 0, dica: entRot(iso) + (x ? ': ' + entFmt(x.ent) + ' potes de entrada' : ': sem estimativa') });
        }
        var semanas = Object.keys(A.porSemana).sort(), tabSem = semanas.slice().reverse();
        var barSem = semanas.map(function (k) {
            var s = A.porSemana[k];
            return { rot: entRot(k), a: s.ent, b: s.vend, dica: 'Semana de ' + entRot(k) + ': entradas ' + entFmt(s.ent) + ' · vendas ' + entFmt(s.vend) + ' potes' };
        });
        var vis = ent.todos ? A.sabores : A.sabores.slice(0, 15);
        var tabSab = !A.sabores.length ? '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhum sabor com variação no período.</p>' :
            '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Sabor</th><th class="num">Entradas (potes)</th><th class="num">Dias com entrada</th>' +
            '<th class="num">Vendas (potes)</th><th class="num">Saídas sem venda (potes)</th></tr></thead><tbody>' +
            vis.map(function (o) {
                return '<tr><td>' + esc(o.nome) + '</td><td class="num">' + esc(entFmt(o.ent)) + '</td><td class="num">' + NUM.format(Object.keys(o.diasEnt).length) + '</td>' +
                    '<td class="num">' + esc(entFmt(o.vend)) + '</td><td class="num">' + (o.sai > 0 ? esc(entFmt(o.sai)) : '—') + '</td></tr>';
            }).join('') + '</tbody></table></div>' +
            (A.sabores.length > 15 ? '<button type="button" class="adm-botao-fantasma mt-3" id="ent-todos">' + (ent.todos ? 'Mostrar só os 15 maiores' : 'Mostrar todos (' + NUM.format(A.sabores.length) + ')') + '</button>' : '');
        var tabSemana = '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Semana (segunda)</th><th class="num">Dias estimados</th><th class="num">Entradas (potes)</th>' +
            '<th class="num">Vendas (potes)</th><th class="num">Entradas − vendas</th><th class="num">Saídas sem venda</th></tr></thead><tbody>' +
            tabSem.map(function (k) {
                var s = A.porSemana[k], sal = s.ent - s.vend;
                return '<tr><td>' + esc(giroFmtData(k)) + '</td><td class="num">' + NUM.format(Object.keys(s.dias).length) + '</td><td class="num">' + esc(entFmt(s.ent)) + '</td><td class="num">' + esc(entFmt(s.vend)) +
                    '</td><td class="num">' + (sal > 0 ? '+' : '') + esc(entFmt(sal)) + '</td><td class="num">' + (s.sai > 0 ? esc(entFmt(s.sai)) : '—') + '</td></tr>';
            }).join('') + '</tbody></table></div>';
        var notas = [];
        if (c.ignorados) notas.push(NUM.format(c.ignorados) + ' produto(s) com EAN repetido em outro produto ficaram sem estimativa');
        var saldo = A.tot.ent - A.tot.vend;
        return '<div class="adm-card p-5 mb-5">' + cab +
            '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">' +
            resKpi('Entradas estimadas', entFmt(A.tot.ent), 'potes em ' + NUM.format(nDias) + ' dia(s) com estimativa') +
            resKpi('Vendas no mesmo período', entFmt(A.tot.vend), 'potes dos mesmos produtos e dias') +
            resKpi('Entradas − vendas', (saldo > 0 ? '+' : '') + entFmt(saldo), 'potes') +
            resKpi('Saídas sem venda', entFmt(A.tot.sai), 'potes (ajuste/perda, fora das entradas)') + '</div>' +
            '<p class="adm-tile-rotulo mb-2">Entradas por dia (potes)</p>' + entBarras(diario, 'Entradas de estoque por dia, em potes', ent.dias > 30 ? 7 : 3, false) +
            '<p class="adm-tile-rotulo mt-5 mb-1">Semana: entradas x vendas (potes)</p>' +
            '<p class="text-xs mb-2" style="color:var(--adm-tinta-3)"><span style="color:var(--adm-dados)">■</span> entradas · <span style="color:var(--adm-tinta-3)">■</span> vendas</p>' +
            entBarras(barSem, 'Entradas e vendas por semana, em potes', 1, true) +
            '<div class="mt-4">' + tabSemana + '</div>' +
            '<p class="adm-tile-rotulo mt-5 mb-2">Por sabor</p>' + tabSab +
            (notas.length ? '<p class="text-xs mt-3" style="color:var(--adm-tinta-3)">' + esc(notas.join(' · ')) + '.</p>' : '') + '</div>';
    }

    function desenharEntradas() {
        var alvo = $('#vitrine-entradas');
        if (!alvo) return;
        var cab = '<div class="flex items-center gap-2 mb-4"><span class="adm-selo adm-selo-erp">ERP SOLIDCON</span><p class="font-bold">Entradas de estoque</p></div>';
        var est = resEstado(solid, 'estoque do ERP', 'solid') || resEstado(giro, 'vendas do ERP', 'giro') || resEstado(ent, 'fotos diárias do estoque', 'ent');
        if (est) {
            alvo.innerHTML = cab + '<div class="adm-card p-5 mb-5">' + est + '</div>';
            var b = alvo.querySelector('[data-res-tentar]');
            if (b) b.addEventListener('click', function () { var f = RES_CARREGADORES[b.getAttribute('data-res-tentar')]; if (f) f(); });
            return;
        }
        alvo.innerHTML = cab + entHtml();
        alvo.querySelectorAll('[data-ent-dias]').forEach(function (b) {
            b.addEventListener('click', function () { ent.dias = Number(b.getAttribute('data-ent-dias')); desenharEntradas(); });
        });
        var t = alvo.querySelector('#ent-todos');
        if (t) t.addEventListener('click', function () { ent.todos = !ent.todos; desenharEntradas(); });
    }

    /* ===================================================================
     * Vitrine — Estoque da fábrica (matéria-prima e embalagens) — migração 027, SOMENTE LEITURA
     * Fontes: solidcon_insumos (saldo atual, pode ser negativo) e solidcon_insumos_diario (foto diária).
     * Consumo médio diário = soma das QUEDAS entre fotos de dias consecutivos ÷ nº de pares de dias,
     * nos últimos INS_JANELA_CONSUMO dias (aumento = compra/ajuste, ignorado). Sem 027: "ainda não instalado".
     * =================================================================== */
    var INS_LIMITE = 80000, INS_PRODUTOS_LIMITE = 5000, INS_JANELA = 120, INS_JANELA_CONSUMO = 30, INS_MIN_PARES = 3;
    var ins = { carregado: false, carregando: false, ausente: false, erro: null, produtos: [], diario: [], truncado: false,
                busca: '', categoria: 'todas', soAlerta: false, todos: false, memo: null };

    function carregarInsumos() {
        ins.carregando = true;
        insRedesenhar();
        var d = new Date(Date.now() - INS_JANELA * 86400000);
        var desde = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        return Promise.all([
            vendPaginar(function () {
                return sb.from('solidcon_insumos').select('id_produto,nome,categoria,unidade,estoque,presente,dtalteracao_erp,atualizado_em')
                    .order('nome', { ascending: true }).order('id_produto', { ascending: true });
            }, INS_PRODUTOS_LIMITE),
            vendPaginar(function () {
                return sb.from('solidcon_insumos_diario').select('dia,id_produto,estoque')
                    .gte('dia', desde).order('dia', { ascending: true }).order('id_produto', { ascending: true });
            }, INS_LIMITE)
        ]).then(function (rs) {
            ins.carregando = false;
            var falha = rs.filter(function (r) { return r.error; })[0];
            ins.ausente = false; ins.erro = null;
            if (falha) {
                if (solidTabelaAusente(falha.error)) ins.ausente = true; else ins.erro = String(falha.error.message || falha.error);
                ins.carregado = false;
            } else {
                ins.produtos = rs[0].data || []; ins.diario = rs[1].data || [];
                // Exatamente no teto não prova completude: nada é calculado.
                ins.truncado = ins.produtos.length >= INS_PRODUTOS_LIMITE || ins.diario.length >= INS_LIMITE;
                ins.memo = null;
                ins.carregado = true;
            }
            insRedesenhar();
        }).catch(function (e) {
            ins.carregando = false; ins.erro = String(e && e.message || e); ins.carregado = false; insRedesenhar();
        });
    }

    function insRedesenhar() {
        dashAtualizarResumo();
        abasParaRedesenhar.vitrine = true;
        desenharAbaSeSuja(abaAtual);
    }

    function insFmt(n) { return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 }); }

    // Por insumo: {pares, consumo} nos últimos INS_JANELA_CONSUMO dias. Memoizado pela referência do diário.
    function insConsumos() {
        if (ins.memo && ins.memo.d === ins.diario) return ins.memo.r;
        var foto = {};
        ins.diario.forEach(function (l) { foto[String(l.id_produto) + '|' + l.dia] = Number(l.estoque); });
        var r = {};
        ins.diario.forEach(function (l) {
            if (giroDiasAtras(l.dia) >= INS_JANELA_CONSUMO) return;
            var id = String(l.id_produto), ant = foto[id + '|' + entDiaAnterior(l.dia)], cur = Number(l.estoque);
            if (ant == null || !isFinite(ant) || !isFinite(cur)) return;
            var o = r[id] || (r[id] = { pares: 0, consumo: 0 });
            o.pares++;
            if (ant > cur) o.consumo += ant - cur;
        });
        ins.memo = { d: ins.diario, r: r };
        return r;
    }

    // Itens com situação: negativo, zerado, critico (<=7 dias), atencao (<=15), ok, sem-consumo, sem-historico, fora (fora da lista).
    function insItens() {
        var cons = insConsumos();
        return ins.produtos.map(function (p) {
            var est = Number(p.estoque) || 0, c = cons[String(p.id_produto)];
            var media = c && c.pares >= INS_MIN_PARES ? c.consumo / c.pares : null;
            var dias = media != null && media > 0 && est > 0 ? est / media : null;
            var sit = p.presente === false ? 'fora' : est < 0 ? 'negativo' : est === 0 ? 'zerado' :
                media == null ? 'sem-historico' : media <= 0 ? 'sem-consumo' :
                dias <= GIRO_CRITICO ? 'critico' : dias <= GIRO_ATENCAO ? 'atencao' : 'ok';
            return { p: p, est: est, media: media, dias: dias, sit: sit };
        });
    }
    var INS_ORDEM = { negativo: 0, zerado: 1, critico: 2, atencao: 3, ok: 4, 'sem-consumo': 5, 'sem-historico': 6, fora: 7 };
    function insOrdenar(itens) {
        return itens.slice().sort(function (a, b) {
            return INS_ORDEM[a.sit] - INS_ORDEM[b.sit] || (a.dias == null ? 1e9 : a.dias) - (b.dias == null ? 1e9 : b.dias) ||
                String(a.p.nome).localeCompare(String(b.p.nome));
        });
    }
    function insEhAlerta(i) { return i.sit === 'negativo' || i.sit === 'zerado' || i.sit === 'critico' || i.sit === 'atencao'; }

    function insSelo(sit) {
        var m = {
            negativo: ['adm-selo-cancelado', 'fa-circle-minus', 'Negativo'], zerado: ['adm-selo-cancelado', 'fa-ban', 'Zerado'],
            critico: ['adm-selo-cancelado', 'fa-triangle-exclamation', 'Crítico'], atencao: ['adm-selo-aguardando', 'fa-arrow-down', 'Atenção'],
            ok: ['adm-selo-confirmado', 'fa-check', 'Ok']
        }[sit];
        if (m) return '<span class="adm-selo ' + m[0] + '"><i class="fa-solid ' + m[1] + '"></i>' + m[2] + '</span>';
        var rot = sit === 'fora' ? 'Fora da lista' : sit === 'sem-consumo' ? 'Sem consumo' : 'Sem histórico';
        return '<span class="adm-selo adm-selo-neutro"><i class="fa-solid fa-hourglass-half"></i>' + rot + '</span>';
    }

    function insContagens(itens) {
        var n = { negativo: 0, zerado: 0, critico: 0, atencao: 0 };
        itens.forEach(function (i) { if (n[i.sit] != null) n[i.sit]++; });
        return n;
    }

    function insLinhas(lista) {
        return lista.map(function (i) {
            return '<tr><td>' + esc(i.p.nome) + '</td><td>' + esc(i.p.categoria || '—') + '</td><td>' + esc(i.p.unidade || '—') + '</td>' +
                '<td class="num"' + (i.est < 0 ? ' style="color:var(--adm-ruim)"' : '') + '>' + esc(insFmt(i.est)) + '</td>' +
                '<td class="num">' + (i.media == null ? '—' : esc(insFmt(i.media))) + '</td>' +
                '<td class="num">' + (i.dias == null ? '—' : esc(giroFmt(i.dias, 0) + ' dias')) + '</td>' +
                '<td>' + insSelo(i.sit) + '</td></tr>';
        }).join('');
    }

    function desenharInsumos() {
        var alvo = $('#vitrine-insumos');
        if (!alvo) return;
        var cab = '<div class="flex items-center gap-2 mb-1"><span class="adm-selo adm-selo-erp">ERP SOLIDCON</span><p class="font-bold">Estoque da fábrica</p></div>' +
            '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">Matéria-prima e embalagens (somente leitura).</p>';
        var est = resEstado(ins, 'estoque da fábrica', 'ins');
        if (est) {
            alvo.innerHTML = cab + '<div class="adm-card p-5 mb-5">' + (ins.ausente ? '<p class="text-sm" style="color:var(--adm-tinta-3)">Estoque da fábrica: ainda não instalado neste banco (migração 027).</p>' : est) + '</div>';
            var b = alvo.querySelector('[data-res-tentar]');
            if (b) b.addEventListener('click', function () { var f = RES_CARREGADORES[b.getAttribute('data-res-tentar')]; if (f) f(); });
            return;
        }
        var itens = insItens(), n = insContagens(itens);
        var cats = {}; ins.produtos.forEach(function (p) { if (p.categoria) cats[p.categoria] = true; });
        var catLista = Object.keys(cats).sort();
        if (ins.categoria !== 'todas' && !cats[ins.categoria]) ins.categoria = 'todas';
        var cons = insConsumos(), comHist = Object.keys(cons).some(function (k) { return cons[k].pares >= INS_MIN_PARES; });
        alvo.innerHTML = cab + '<div class="adm-card p-5 mb-5">' +
            '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">' +
            resKpi('Negativos', NUM.format(n.negativo), 'saldo abaixo de zero') + resKpi('Zerados', NUM.format(n.zerado), 'sem saldo') +
            resKpi('Críticos', NUM.format(n.critico), 'acabam em até ' + GIRO_CRITICO + ' dias') + resKpi('Em atenção', NUM.format(n.atencao), 'acabam em até ' + GIRO_ATENCAO + ' dias') + '</div>' +
            '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">Consumo médio = quedas de saldo entre dias consecutivos nos últimos ' + INS_JANELA_CONSUMO + ' dias (compras e aumentos de saldo são ignorados). ' +
            'O histórico diário começa na instalação' + (comHist ? '' : ': ainda não há dias suficientes (mínimo ' + INS_MIN_PARES + ') para calcular o consumo e o “acaba em”') + '.</p>' +
            '<div class="flex items-center flex-wrap gap-3 mb-4">' +
                '<input type="search" id="ins-busca" class="adm-input" style="max-width:16rem;padding:.55rem .7rem" placeholder="Buscar insumo" aria-label="Buscar insumo" value="' + esc(ins.busca) + '">' +
                '<select id="ins-cat" class="adm-input" style="max-width:14rem;padding:.55rem .7rem" aria-label="Filtrar por categoria"><option value="todas">Todas as categorias</option>' +
                    catLista.map(function (c) { return '<option value="' + esc(c) + '"' + (ins.categoria === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
                '<button type="button" class="adm-chip' + (ins.soAlerta ? ' is-ativo' : '') + '" id="ins-alerta">Só alertas</button></div>' +
            '<div id="ins-lista"></div></div>';
        $('#ins-busca').addEventListener('input', function (ev) { ins.busca = ev.target.value; desenharInsLista(); });
        $('#ins-cat').addEventListener('change', function (ev) { ins.categoria = ev.target.value; desenharInsLista(); });
        $('#ins-alerta').addEventListener('click', function () { ins.soAlerta = !ins.soAlerta; desenharInsumos(); });
        desenharInsLista();
    }

    function desenharInsLista() {
        var alvo = $('#ins-lista');
        if (!alvo) return;
        if (!ins.produtos.length) { alvo.innerHTML = '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhum insumo sincronizado ainda.</p>'; return; }
        var q = ins.busca.trim().toLowerCase();
        var lista = insOrdenar(insItens()).filter(function (i) {
            if (ins.soAlerta && !insEhAlerta(i)) return false;
            if (ins.categoria !== 'todas' && i.p.categoria !== ins.categoria) return false;
            return !q || String(i.p.nome || '').toLowerCase().indexOf(q) >= 0 || String(i.p.categoria || '').toLowerCase().indexOf(q) >= 0;
        });
        if (!lista.length) { alvo.innerHTML = '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhum insumo com esses filtros.</p>'; return; }
        var vis = ins.todos ? lista : lista.slice(0, 25);
        alvo.innerHTML = '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Insumo</th><th>Categoria</th><th>Unidade</th><th class="num">Estoque</th>' +
            '<th class="num">Consumo médio/dia</th><th class="num">Acaba em</th><th>Situação</th></tr></thead><tbody>' + insLinhas(vis) + '</tbody></table></div>' +
            '<p class="text-xs mt-3" style="color:var(--adm-tinta-3)">' + NUM.format(vis.length) + ' de ' + NUM.format(lista.length) + ' insumos</p>' +
            (lista.length > 25 ? '<button type="button" class="adm-botao-fantasma mt-3" id="ins-todos">' + (ins.todos ? 'Mostrar só os 25 primeiros' : 'Mostrar todos') + '</button>' : '');
        var t = alvo.querySelector('#ins-todos');
        if (t) t.addEventListener('click', function () { ins.todos = !ins.todos; desenharInsLista(); });
    }

    /* ===================================================================
     * Dashboard de vendas (ERP) — Formas de pagamento (solidcon_vendas_modalidade, migração 027)
     * Valor e quantidade de pagamentos por forma e por mês (barras empilhadas) e % do total.
     * Só leitura; admin (como o resto do ERP financeiro). Sem 027: "ainda não instalado".
     * =================================================================== */
    var PAG_LIMITE = 40000, PAG_LEITURA_MESES = 18, PAG_TOPO = 6;
    var PAG_CORES = ['var(--adm-cat-1)', 'var(--adm-cat-2)', 'var(--adm-cat-3)', 'var(--adm-cat-4)', 'var(--adm-cat-5)', 'var(--adm-cat-6)', 'var(--adm-cat-7)'];
    var pag = { carregado: false, carregando: false, ausente: false, erro: null, linhas: [], truncado: false, metrica: 'valor', memo: null };

    function carregarPagamentos() {
        pag.carregando = true;
        pagRedesenhar();
        var h = new Date(), d = new Date(h.getFullYear(), h.getMonth() - (PAG_LEITURA_MESES - 1), 1);
        var desde = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
        return vendPaginar(function () {
            return sb.from('solidcon_vendas_modalidade').select('dia,id_modalidade,nome,valor_centavos,qtde_pagamentos')
                .gte('dia', desde).order('dia', { ascending: true }).order('id_modalidade', { ascending: true });
        }, PAG_LIMITE).then(function (r) {
            pag.carregando = false; pag.ausente = false; pag.erro = null;
            if (r.error) {
                if (solidTabelaAusente(r.error)) pag.ausente = true; else pag.erro = String(r.error.message || r.error);
                pag.carregado = false;
            } else {
                pag.linhas = r.data || [];
                pag.truncado = pag.linhas.length >= PAG_LIMITE;
                pag.memo = null;
                pag.carregado = true;
            }
            pagRedesenhar();
        }).catch(function (e) {
            pag.carregando = false; pag.erro = String(e && e.message || e); pag.carregado = false; pagRedesenhar();
        });
    }

    function pagRedesenhar() {
        dashAtualizarResumo();
        if (secaoVisivel('vendas') && $('#vendas-pagamentos')) desenharVendasPagamentos();
        else abasParaRedesenhar.vendas = true;
        desenharAbaSeSuja(abaAtual);
    }

    // Janela de n meses consecutivos terminando no último mês com dado; séries = top PAG_TOPO por valor + "Outras".
    function pagDados(n) {
        if (pag.memo && pag.memo.l === pag.linhas && pag.memo.n === n) return pag.memo.r;
        var meses = {}, por = {};
        pag.linhas.forEach(function (l) {
            var m = String(l.dia).slice(0, 7) + '-01';
            meses[m] = true;
            var k = String(l.id_modalidade), s = por[k] || (por[k] = { k: k, nome: l.nome, ultimo: l.dia, v: {}, q: {}, tv: 0, tq: 0 });
            if (l.dia >= s.ultimo && l.nome) { s.nome = l.nome; s.ultimo = l.dia; }
            s.v[m] = (s.v[m] || 0) + vendNum(l.valor_centavos); s.q[m] = (s.q[m] || 0) + vendNum(l.qtde_pagamentos);
        });
        var cols = vendJanela(Object.keys(meses).sort(), n), set = {}; cols.forEach(function (c) { set[c] = true; });
        var lista = Object.keys(por).map(function (k) {
            var s = por[k]; cols.forEach(function (c) { s.tv += s.v[c] || 0; s.tq += s.q[c] || 0; });
            return s;
        }).filter(function (s) { return s.tv > 0 || s.tq > 0; }).sort(function (a, b) { return b.tv - a.tv || b.tq - a.tq; });
        var topo = lista.slice(0, PAG_TOPO), resto = lista.slice(PAG_TOPO);
        if (resto.length) {
            var o = { k: 'outras', nome: 'Outras formas', v: {}, q: {}, tv: 0, tq: 0 };
            resto.forEach(function (s) { cols.forEach(function (c) { o.v[c] = (o.v[c] || 0) + (s.v[c] || 0); o.q[c] = (o.q[c] || 0) + (s.q[c] || 0); }); o.tv += s.tv; o.tq += s.tq; });
            topo.push(o);
        }
        topo.forEach(function (s, i) { s.cor = PAG_CORES[Math.min(i, PAG_CORES.length - 1)]; });
        var r = { cols: cols, series: topo, totV: topo.reduce(function (a, s) { return a + s.tv; }, 0), totQ: topo.reduce(function (a, s) { return a + s.tq; }, 0) };
        pag.memo = { l: pag.linhas, n: n, r: r };
        return r;
    }

    // Barras empilhadas em SVG; m = 'v' (valor) ou 'q' (quantidade).
    function pagBarras(D, m) {
        if (!D.cols.length) return '<p class="text-sm" style="color:var(--adm-tinta-3)">Sem dados.</p>';
        var W = wGraf(640), H = 200, pl = (W < 640 ? 66 : 46), pr = 8, pt = 8, pb = 22, atual = vendMesAtual();
        var tot = D.cols.map(function (c) { return D.series.reduce(function (a, s) { return a + (s[m][c] || 0); }, 0); });
        var max = Math.max.apply(null, tot.concat([1]));
        var slot = (W - pl - pr) / D.cols.length, bw = Math.max(2, slot * 0.7);
        var y = function (v) { return pt + (H - pt - pb) * (1 - v / max); };
        var fmtv = function (v) { return m === 'v' ? brl(v) : NUM.format(Math.round(v)); };
        var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto" role="img" aria-label="' + esc(m === 'v' ? 'Valor por forma de pagamento e mês' : 'Quantidade de pagamentos por forma e mês') + '">' +
            '<line x1="' + pl + '" y1="' + y(0) + '" x2="' + (W - pr) + '" y2="' + y(0) + '" stroke="var(--adm-borda-forte)"/>' +
            '<line x1="' + pl + '" y1="' + y(max) + '" x2="' + (W - pr) + '" y2="' + y(max) + '" stroke="var(--adm-borda)" stroke-dasharray="3 3"/>' +
            '<text x="' + (pl - 5) + '" y="' + (y(max) + 4) + '" text-anchor="end" font-size="10" fill="var(--adm-tinta-3)">' + esc(m === 'v' ? brlCurto(max) : NUM.format(Math.round(max))) + '</text>' +
            '<text x="' + (pl - 5) + '" y="' + (y(0) + 4) + '" text-anchor="end" font-size="10" fill="var(--adm-tinta-3)">0</text>';
        var cadaPag = W < 640 ? Math.ceil(56 / slot) : 1;
        D.cols.forEach(function (c, i) {
            var x = pl + i * slot + (slot - bw) / 2, base = 0;
            D.series.forEach(function (s) {
                var v = s[m][c] || 0;
                if (v <= 0) return;
                var y1 = y(base + v), y0 = y(base);
                out += '<rect x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, y0 - y1).toFixed(1) + '" fill="' + s.cor + '"' +
                    (c === atual ? ' fill-opacity=".6"' : '') + '><title>' + esc(vendMesRotulo(c) + (c === atual ? ' (parcial)' : '') + ' · ' + s.nome + ': ' + fmtv(v)) + '</title></rect>';
                base += v;
            });
            if (i % cadaPag === 0) out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="var(--adm-tinta-3)">' + esc(vendMesRotulo(c)) + '</text>';
        });
        return out + '</svg>';
    }

    function pagLegenda(D) {
        return '<p class="text-xs mb-2 flex flex-wrap gap-x-4 gap-y-1" style="color:var(--adm-tinta-2)">' + D.series.map(function (s) {
            return '<span><span style="color:' + s.cor + '">■</span> ' + esc(s.nome) + '</span>';
        }).join('') + '</p>';
    }

    function pagTabela(D, max) {
        var linhas = D.series.slice(0, max || D.series.length);
        return '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Forma</th><th class="num">Valor</th><th class="num">% do valor</th><th class="num">Pagamentos</th><th class="num">% dos pagamentos</th><th class="num">Valor médio</th></tr></thead><tbody>' +
            linhas.map(function (s) {
                return '<tr><td><span style="color:' + s.cor + '">■</span> ' + esc(s.nome) + '</td><td class="num">' + esc(brl(s.tv)) + '</td>' +
                    '<td class="num">' + esc(D.totV > 0 ? giroFmt(s.tv / D.totV * 100, 1) + '%' : '—') + '</td><td class="num">' + esc(NUM.format(Math.round(s.tq))) + '</td>' +
                    '<td class="num">' + esc(D.totQ > 0 ? giroFmt(s.tq / D.totQ * 100, 1) + '%' : '—') + '</td><td class="num">' + (s.tq > 0 ? esc(brl(Math.round(s.tv / s.tq))) : '—') + '</td></tr>';
            }).join('') + '</tbody></table></div>';
    }

    function pagPeriodoTxt(D) { return D.cols.length ? vendMesRotulo(D.cols[0]) + ' a ' + vendMesRotulo(D.cols[D.cols.length - 1]) : ''; }

    function desenharVendasPagamentos() {
        var alvo = $('#vendas-pagamentos');
        if (!alvo) return;
        var cab = '<div class="flex items-center gap-2 mb-1">' + SELO_ERP + '<p class="font-bold text-lg">Formas de pagamento</p></div>';
        var est = resEstado(pag, 'formas de pagamento', 'pag');
        if (est) {
            alvo.innerHTML = cab + '<div class="adm-card p-5 mt-3">' + (pag.ausente ? '<p class="text-sm" style="color:var(--adm-tinta-3)">Formas de pagamento: ainda não instalado neste banco (migração 027).</p>' : est) + '</div>';
            var b = alvo.querySelector('[data-res-tentar]');
            if (b) b.addEventListener('click', function () { var f = RES_CARREGADORES[b.getAttribute('data-res-tentar')]; if (f) f(); });
            return;
        }
        var D = pagDados(12);
        if (!D.series.length) { alvo.innerHTML = cab + '<div class="adm-card p-5 mt-3"><p class="text-sm" style="color:var(--adm-tinta-3)">Nenhum pagamento sincronizado ainda.</p></div>'; return; }
        var m = pag.metrica === 'qtde' ? 'q' : 'v';
        alvo.innerHTML = cab + '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">Por forma de pagamento no ERP, ' + esc(pagPeriodoTxt(D)) + ' (mês corrente parcial, mais claro). Uma venda pode usar mais de uma forma.</p>' +
            '<div class="adm-card p-5"><div class="flex items-center justify-between flex-wrap gap-3 mb-3"><p class="adm-tile-rotulo">' + (m === 'v' ? 'Valor por mês' : 'Pagamentos por mês') + '</p>' +
            '<select id="pag-metrica" class="adm-input" style="max-width:12rem;padding:.45rem .6rem" aria-label="Métrica"><option value="valor"' + (m === 'v' ? ' selected' : '') + '>Valor (R$)</option><option value="qtde"' + (m === 'q' ? ' selected' : '') + '>Quantidade</option></select></div>' +
            pagLegenda(D) + pagBarras(D, m) + '<div class="mt-5">' + pagTabela(D) + '</div></div>';
        $('#pag-metrica').addEventListener('change', function (ev) { pag.metrica = ev.target.value === 'qtde' ? 'qtde' : 'valor'; desenharVendasPagamentos(); });
    }

    /* ===================================================================
     * Clientes — Financeiro: contas a receber do ERP (solidcon_receber, migração 030) — SOMENTE LEITURA
     * Só admin (dado financeiro). Sem a 030 (tabela ausente) o bloco não aparece. Dias de atraso são
     * recalculados aqui a partir do vencimento (data de São Paulo). Pessoa física e "sem documento"
     * entram agregadas em uma linha cada, sem identificar ninguém e sem expandir.
     * =================================================================== */
    var REC_LIMITE = 10000, REC_POR_PAGINA = 50, REC_STALE_MS = 2 * 60 * 60 * 1000;
    var rec = { carregado: false, carregando: false, ausente: false, erro: null, linhas: [], syncs: [], truncado: false,
                abertos: {}, mostrar: REC_POR_PAGINA, memo: null };

    function carregarReceber() {
        rec.carregando = true;
        recRedesenhar();
        return Promise.all([
            vendPaginar(function () {
                return sb.from('solidcon_receber')
                    .select('id,tipo,documento,documento_titulo,cd_nota,vencimento,valor_aberto_centavos,valor_mora_centavos,valor_multa_centavos,valor_desconto_centavos,categoria,coletado_em')
                    .order('vencimento', { ascending: true }).order('id', { ascending: true });
            }, REC_LIMITE),
            sb.from('solidcon_receber_sync').select('status,linhas,total_aberto_centavos,coletado_em,mensagem,em').order('em', { ascending: false }).limit(20)
        ]).then(function (rs) {
            rec.carregando = false;
            var falha = rs.filter(function (r) { return r.error; })[0];
            rec.ausente = false; rec.erro = null;
            if (falha) {
                if (solidTabelaAusente(falha.error)) rec.ausente = true; else rec.erro = String(falha.error.message || falha.error);
                rec.carregado = false;
            } else {
                rec.linhas = rs[0].data || []; rec.syncs = rs[1].data || [];
                rec.truncado = rec.linhas.length >= REC_LIMITE; // no teto não dá para provar que o total está completo
                rec.memo = null; rec.carregado = true;
            }
            recRedesenhar();
        }).catch(function (e) {
            rec.carregando = false; rec.erro = String(e && e.message || e); rec.carregado = false; recRedesenhar();
        });
    }

    function recDias(n) { return NUM.format(n) + (n === 1 ? ' dia' : ' dias'); }

    function recRedesenhar() {
        dashAtualizarResumo(); // o Hoje usa as parcelas vencidas (início, fim e erro do carregamento)
        abasParaRedesenhar.clientes = true;
        desenharAbaSeSuja(abaAtual);
    }

    // Data de hoje em São Paulo (YYYY-MM-DD).
    function recHoje() {
        try {
            var s = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        } catch (e) { /* sem Intl com fuso: usa o relógio local */ }
        return giroIsoHoje();
    }
    function recAtraso(venc, hoje) {
        var v = String(venc || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 0;
        return Math.max(0, Math.floor((giroDiaUtc(hoje) - giroDiaUtc(v)) / 86400000));
    }
    function recCnpj(d) {
        return d.length === 14 ? d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12) : d;
    }

    // Agrega por CNPJ (documento normalizado); PF e sem documento viram uma linha cada. Memoizado por linhas + dia.
    function recAgregar() {
        var hoje = recHoje();
        if (rec.memo && rec.memo.l === rec.linhas && rec.memo.h === hoje && rec.memo.s === scli.lista) return rec.memo.r;
        var nomes = {};
        if (scli.carregado && !scli.erro && !scli.ausente) scli.lista.forEach(function (c) {
            if (String(c.tipo || '').toLowerCase() !== 'cnpj') return;
            var d = docNorm(c.documento, 'cnpj'); if (d && c.nome) nomes[d] = String(c.nome);
        });
        var por = {}, tot = { aberto: 0, vencido: 0, parcelas: 0 }, pf = null, sd = null;
        function novo(tipo, doc) { return { tipo: tipo, doc: doc, nome: null, aberto: 0, vencido: 0, atraso: 0, prox: null, n: 0, parcelas: [] }; }
        rec.linhas.forEach(function (l) {
            var tipo = String(l.tipo || '').toLowerCase(), v = vendNum(l.valor_aberto_centavos), at = recAtraso(l.vencimento, hoje), venc = String(l.vencimento || '').slice(0, 10);
            var g;
            if (tipo === 'cnpj' && docNorm(l.documento, 'cnpj')) {
                var d = docNorm(l.documento, 'cnpj');
                g = por[d] || (por[d] = novo('cnpj', d));
                g.parcelas.push({ l: l, atraso: at });
            } else if (tipo === 'pf') { g = pf || (pf = novo('pf', null)); }
            else { g = sd || (sd = novo('sd', null)); }
            g.aberto += v; g.n++; tot.aberto += v; tot.parcelas++;
            if (at > 0) { g.vencido += v; tot.vencido += v; if (at > g.atraso) g.atraso = at; }
            else if (venc && (!g.prox || venc < g.prox)) g.prox = venc;
        });
        var cnpjs = Object.keys(por).map(function (d) { var g = por[d]; g.nome = nomes[d] || null; return g; });
        cnpjs.sort(function (a, b) { return b.vencido - a.vencido || b.aberto - a.aberto || String(a.nome || a.doc).localeCompare(String(b.nome || b.doc)); });
        var r = { hoje: hoje, tot: tot, cnpjs: cnpjs, pf: pf, sd: sd, porDoc: por };
        rec.memo = { l: rec.linhas, h: hoje, s: scli.lista, r: r };
        return r;
    }

    function recIdadeTxt(ms) {
        var m = Math.floor(ms / 60000);
        if (m < 1) return 'menos de 1 min';
        if (m < 60) return m + ' min';
        var h = Math.floor(m / 60);
        return h < 48 ? h + ' h' : Math.floor(h / 24) + ' dias';
    }

    function recCabecalho(A) {
        var ok = rec.syncs.filter(function (s) { return s.status === 'ok'; })[0], ult = rec.syncs[0];
        var quando = ok ? new Date(ok.coletado_em || ok.em).getTime() : NaN;
        var idade = isFinite(quando) ? Date.now() - quando : null;
        var atras = idade != null && idade > REC_STALE_MS, erro = !!ult && ult.status !== 'ok';
        var linha = ok && idade != null ? 'Atualizado há ' + recIdadeTxt(idade) + ' (' + dataHora(ok.coletado_em || ok.em) + ')' : 'Sem atualização registrada ainda';
        var aviso = '';
        if (erro) aviso = 'A última atualização falhou' + (ult.mensagem ? ': ' + String(ult.mensagem).slice(0, 300) : '') + '. Os valores abaixo podem estar desatualizados.';
        else if (atras) aviso = 'Os dados têm mais de 2 horas: a rotina de contas a receber pode estar parada.';
        else if (!ok) aviso = 'Nenhuma atualização com sucesso registrada: os valores podem estar incompletos.';
        return '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">' +
            resKpi('Total em aberto', brl(A.tot.aberto), 'parcelas ainda não pagas') +
            resKpi('Total vencido', brl(A.tot.vencido), A.tot.aberto > 0 ? giroFmt(A.tot.vencido / A.tot.aberto * 100, 1) + '% do em aberto' : '') +
            resKpi('Parcelas', NUM.format(A.tot.parcelas), 'em aberto') +
            resKpi('Clientes (CNPJ)', NUM.format(A.cnpjs.length), 'com parcela em aberto') + '</div>' +
            '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">' + esc(linha) + '</p>' +
            (aviso ? '<div class="adm-card p-4 mb-4" role="alert" style="border-color:var(--adm-ruim-borda)"><p class="text-sm"><i class="fa-solid fa-triangle-exclamation mr-2" style="color:var(--adm-ruim)"></i>' + esc(aviso) + '</p></div>' : '');
    }

    function recMoeda(v) { return v == null ? '—' : esc(brl(vendNum(v))); }

    function recParcelas(g) {
        var ps = g.parcelas.slice().sort(function (a, b) { return String(a.l.vencimento).localeCompare(String(b.l.vencimento)); });
        return '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Vencimento</th><th>Título</th><th>Nota</th><th class="num">Valor</th><th class="num">Mora</th><th class="num">Multa</th><th class="num">Desconto</th><th>Categoria</th><th class="num">Atraso</th></tr></thead><tbody>' +
            ps.map(function (p) {
                var l = p.l;
                return '<tr><td>' + esc(giroFmtData(String(l.vencimento).slice(0, 10))) + '</td><td>' + esc(l.documento_titulo || '—') + '</td><td>' + esc(l.cd_nota == null ? '—' : l.cd_nota) + '</td>' +
                    '<td class="num">' + recMoeda(l.valor_aberto_centavos) + '</td><td class="num">' + recMoeda(l.valor_mora_centavos) + '</td><td class="num">' + recMoeda(l.valor_multa_centavos) + '</td>' +
                    '<td class="num">' + recMoeda(l.valor_desconto_centavos) + '</td><td>' + esc(l.categoria || '—') + '</td><td class="num">' + (p.atraso > 0 ? esc(recDias(p.atraso)) : '—') + '</td></tr>';
            }).join('') + '</tbody></table></div>';
    }

    function recLinhaAgregada(g, rotulo) {
        return '<tr><td>' + esc(rotulo + ' (' + NUM.format(g.n) + (g.n === 1 ? ' parcela)' : ' parcelas)')) + '</td><td class="num">' + esc(brl(g.aberto)) + '</td><td class="num">' + esc(brl(g.vencido)) + '</td>' +
            '<td class="num">' + (g.atraso > 0 ? esc(recDias(g.atraso)) : '—') + '</td><td>' + (g.prox ? esc(giroFmtData(g.prox)) : '—') + '</td><td class="num">' + NUM.format(g.n) + '</td><td></td></tr>';
    }

    function desenharClientesFinanceiro() {
        var alvo = $('#clientes-financeiro');
        if (!alvo) return;
        if (papel !== 'admin' || rec.ausente) { alvo.innerHTML = ''; return; } // sem permissão ou sem a 030: bloco não aparece
        var cab = '<div class="flex items-center gap-2 mb-2">' + SELO_ERP + '<p class="font-bold">Financeiro — contas a receber</p></div>';
        if (rec.erro && !rec.carregando) {
            alvo.innerHTML = cab + '<div class="adm-card p-6"><p class="text-sm mb-3" style="color:var(--adm-tinta-2)">Não foi possível carregar as contas a receber: ' + esc(rec.erro) + '</p>' +
                '<button type="button" class="adm-botao-fantasma" data-rec-tentar="1">Tentar de novo</button></div>';
            return;
        }
        if (!rec.carregado) {
            alvo.innerHTML = cab + '<div class="adm-card p-6 text-center text-sm" style="color:var(--adm-tinta-2)"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando contas a receber…</div>';
            return;
        }
        if (rec.truncado) {
            alvo.innerHTML = cab + '<div class="adm-card p-6" role="alert" style="border-color:var(--adm-ruim-borda)"><p class="text-sm"><i class="fa-solid fa-triangle-exclamation mr-2" style="color:var(--adm-ruim)"></i>' +
                'Contas a receber indisponíveis: o limite de ' + esc(NUM.format(REC_LIMITE)) + ' parcelas foi atingido e os totais ficariam incompletos.</p></div>';
            return;
        }
        var A = recAgregar();
        if (!rec.linhas.length) {
            alvo.innerHTML = cab + recCabecalho(A) + '<div class="adm-card p-5"><p class="text-sm" style="color:var(--adm-tinta-3)">Nenhuma parcela em aberto.</p></div>';
            return;
        }
        var vis = A.cnpjs.slice(0, rec.mostrar);
        alvo.innerHTML = cab + recCabecalho(A) +
            '<div class="adm-card p-5"><div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Cliente</th><th class="num">Em aberto</th><th class="num">Vencido</th><th class="num">Maior atraso</th><th>Próx. vencimento</th><th class="num">Parcelas</th><th></th></tr></thead><tbody>' +
            vis.map(function (g, i) {
                var aberto = !!rec.abertos[g.doc], nome = g.nome || recCnpj(g.doc);
                return '<tr><td>' + esc(nome) + (g.nome ? '<br><span class="text-xs" style="color:var(--adm-tinta-3)">' + esc(recCnpj(g.doc)) + '</span>' : '') + '</td>' +
                    '<td class="num">' + esc(brl(g.aberto)) + '</td><td class="num"' + (g.vencido > 0 ? ' style="color:var(--adm-ruim)"' : '') + '>' + esc(brl(g.vencido)) + '</td>' +
                    '<td class="num">' + (g.atraso > 0 ? esc(recDias(g.atraso)) : '—') + '</td><td>' + (g.prox ? esc(giroFmtData(g.prox)) : '—') + '</td><td class="num">' + NUM.format(g.n) + '</td>' +
                    '<td><button type="button" class="adm-botao-fantasma" data-rec-i="' + i + '" aria-expanded="' + aberto + '"><i class="fa-solid ' + (aberto ? 'fa-chevron-up' : 'fa-chevron-down') + ' mr-1"></i>Parcelas</button></td></tr>' +
                    (aberto ? '<tr><td colspan="7">' + recParcelas(g) + '</td></tr>' : '');
            }).join('') +
            (A.pf ? recLinhaAgregada(A.pf, 'Pessoa física') : '') + (A.sd ? recLinhaAgregada(A.sd, 'Sem documento') : '') +
            '</tbody></table></div>' +
            '<p class="text-xs mt-3" style="color:var(--adm-tinta-3)">' + NUM.format(vis.length) + ' de ' + NUM.format(A.cnpjs.length) + ' clientes CNPJ, ordenados pelo maior valor vencido. Pessoa física e parcelas sem documento aparecem somadas, sem identificação. Atraso calculado pelo vencimento (horário de São Paulo).</p>' +
            (A.cnpjs.length > vis.length ? '<button type="button" class="adm-botao-fantasma mt-3" data-rec-mais="1">Mostrar mais</button>' : '') + '</div>';
        alvo.querySelectorAll('[data-rec-i]').forEach(function (b) { b.setAttribute('data-rec-doc', vis[Number(b.getAttribute('data-rec-i'))].doc); });
    }

    // Delegação única no bloco (preservada entre redesenhos porque o ouvinte fica no contêiner fixo).
    function recLigar(alvo) {
        alvo.addEventListener('click', function (ev) {
            var b = ev.target.closest('[data-rec-i]');
            if (b) { var d = b.getAttribute('data-rec-doc'); if (d) { rec.abertos[d] = !rec.abertos[d]; desenharClientesFinanceiro(); } return; }
            if (ev.target.closest('[data-rec-mais]')) { rec.mostrar += REC_POR_PAGINA; desenharClientesFinanceiro(); return; }
            if (ev.target.closest('[data-rec-tentar]') && !rec.carregando) carregarReceber();
        });
    }

    // Resumo de contas a receber de um CNPJ (já normalizado) para o detalhe do cliente; só admin; vazio se não houver dado.
    function recFichasDoDoc(d) {
        if (!recPronto() || !d || d.length !== 14) return '';
        var g = recAgregar().porDoc[d];
        if (!g) return '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">Financeiro (ERP): nenhuma parcela em aberto.</p>';
        return '<div class="grid sm:grid-cols-3 gap-4 mb-4">' + ficha('Em aberto (ERP)', brl(g.aberto), NUM.format(g.n) + (g.n === 1 ? ' parcela' : ' parcelas')) +
            ficha('Vencido (ERP)', brl(g.vencido), g.atraso > 0 ? 'maior atraso: ' + recDias(g.atraso) : 'nada vencido') +
            ficha('Próx. vencimento', g.prox ? giroFmtData(g.prox) : '—', 'contas a receber') + '</div>';
    }

    /* ===================================================================
     * Vitrine — Margem por produto (ERP, migração 031) — SOMENTE LEITURA, só admin
     * Fontes: solidcon_margem_diaria (vendas/custo por dia e código, COM SINAL), solidcon_custos (custo e preço atuais)
     * e solidcon_margem_sync (saúde por parte). Código do ERP casado com solidcon_produtos.id_produto (vínculo não
     * confirmado): sem correspondência aparece como "Produto ERP <código>", nunca escondido. Sem a 031: não aparece.
     * =================================================================== */
    var MG_LIMITE = 50000, MG_JANELA = 90, MG_CUSTOS_LIMITE = 20000, MG_POR_PAGINA = 50, MG_STALE_MS = 2 * 60 * 60 * 1000;
    var mg = { carregado: false, carregando: false, ausente: false, erro: null, diario: [], custos: [], sync: {}, cobertura: {}, truncado: false,
               dias: 30, ord: { col: 'venda', dir: -1 }, abertos: {}, mostrar: MG_POR_PAGINA, todosCustos: false, memo: null };

    function carregarMargem() {
        mg.carregando = true;
        mgRedesenhar();
        var desde = entIso(giroDiaUtc(recHoje()) - (MG_JANELA - 1) * 86400000);
        return Promise.all([
            vendPaginar(function () {
                return sb.from('solidcon_margem_diaria').select('dia,codigo_produto,quantidade,venda_centavos,custo_centavos')
                    .gte('dia', desde).order('dia', { ascending: true }).order('codigo_produto', { ascending: true });
            }, MG_LIMITE),
            vendPaginar(function () {
                return sb.from('solidcon_custos').select('codigo_produto,unidade,custo_medio_centavos,custo_reposicao_centavos,preco_venda_centavos,ultimo_recebimento')
                    .order('codigo_produto', { ascending: true }).order('unidade', { ascending: true });
            }, MG_CUSTOS_LIMITE),
            // Saúde buscada SEPARADO por parte: última tentativa (qualquer status) e último OK de cada uma.
            mgSync('vendas', false), mgSync('vendas', true), mgSync('custos', false), mgSync('custos', true),
            vendPaginar(function () { return sb.from('solidcon_margem_cobertura').select('dia').gte('dia', desde).order('dia', { ascending: true }); }, 1000)
        ]).then(function (rs) {
            mg.carregando = false;
            var falha = rs.filter(function (r) { return r.error; })[0];
            mg.ausente = false; mg.erro = null;
            if (falha) {
                if (solidTabelaAusente(falha.error)) mg.ausente = true; else mg.erro = String(falha.error.message || falha.error);
                mg.carregado = false;
            } else {
                mg.diario = rs[0].data || []; mg.custos = rs[1].data || [];
                var um = function (r) { return (r.data || [])[0] || null; };
                mg.sync = { vendas: { ult: um(rs[2]), ok: um(rs[3]) }, custos: { ult: um(rs[4]), ok: um(rs[5]) } };
                mg.cobertura = {}; (rs[6].data || []).forEach(function (l) { mg.cobertura[String(l.dia).slice(0, 10)] = true; });
                // No teto não há como provar que o período está completo: nada é calculado.
                mg.truncado = mg.diario.length >= MG_LIMITE || mg.custos.length >= MG_CUSTOS_LIMITE;
                mg.memo = null; mg.carregado = true;
            }
            mgRedesenhar();
        }).catch(function (e) {
            mg.carregando = false; mg.erro = String(e && e.message || e); mg.carregado = false; mgRedesenhar();
        });
    }

    function mgSync(parte, soOk) {
        var q = sb.from('solidcon_margem_sync').select('parte,status,linhas,desde,ate,coletado_em,mensagem,em').eq('parte', parte);
        if (soOk) q = q.eq('status', 'ok');
        return q.order('em', { ascending: false }).limit(1);
    }

    function mgRedesenhar() {
        abasParaRedesenhar.vendas = true;
        desenharAbaSeSuja(abaAtual);
    }

    var mgMapa = { ref: null, por: {} };
    function mgNome(cod) {
        if (mgMapa.ref !== solid.produtos) { mgMapa = { ref: solid.produtos, por: {} }; solid.produtos.forEach(function (x) { mgMapa.por[String(x.id_produto)] = x; }); }
        var p = mgMapa.por[String(cod)];
        return p ? { nome: String(p.nome), achou: true } : { nome: 'Produto ERP ' + cod, achou: false };
    }

    // Por código no período: quantidade, venda, custo (somas com sinal) e margem; memoizado.
    function mgAgregar() {
        var hoje = recHoje();
        if (mg.memo && mg.memo.d === mg.diario && mg.memo.n === mg.dias && mg.memo.h === hoje && mg.memo.s === solid.produtos && mg.memo.c === mg.cobertura) return mg.memo.r;
        var corte = entIso(giroDiaUtc(hoje) - (mg.dias - 1) * 86400000), por = {}, tot = { qtd: 0, venda: 0, custo: 0 };
        var porId = {}; solid.produtos.forEach(function (p) { porId[String(p.id_produto)] = p; });
        mg.diario.forEach(function (l) {
            var dia = String(l.dia).slice(0, 10);
            if (dia < corte || dia > hoje || !mg.cobertura[dia]) return; // só dias com cobertura confirmada entram nos números
            var k = String(l.codigo_produto), o = por[k];
            if (!o) {
                var p = porId[k];
                o = por[k] = { cod: k, nome: p ? String(p.nome) : 'Produto ERP ' + k, achou: !!p, qtd: 0, venda: 0, custo: 0 };
            }
            var q = Number(l.quantidade) || 0, v = vendNum(l.venda_centavos), c = vendNum(l.custo_centavos);
            o.qtd += q; o.venda += v; o.custo += c; tot.qtd += q; tot.venda += v; tot.custo += c;
        });
        var linhas = Object.keys(por).map(function (k) {
            var o = por[k]; o.margem = o.venda - o.custo; o.pct = o.venda > 0 ? o.margem / o.venda * 100 : null; return o;
        });
        tot.margem = tot.venda - tot.custo; tot.pct = tot.venda > 0 ? tot.margem / tot.venda * 100 : null;
        var r = { linhas: linhas, tot: tot, cob: mgCobertura(hoje) };
        mg.memo = { d: mg.diario, n: mg.dias, h: hoje, s: solid.produtos, c: mg.cobertura, r: r };
        return r;
    }

    // Cobertura do período escolhido: dias confirmados em solidcon_margem_cobertura (hoje incluso) e início do trecho contíguo.
    function mgCobertura(hoje) {
        var n = mg.dias, base = giroDiaUtc(hoje), dias = [], cobertos = 0;
        for (var i = 0; i < n; i++) { var d = entIso(base - i * 86400000); dias.push(d); if (mg.cobertura[d]) cobertos++; }
        // Trecho contíguo: do dia mais recente coberto para trás.
        var ini = null, i0 = 0;
        while (i0 < n && !mg.cobertura[dias[i0]]) i0++;
        for (var k = i0; k < n && mg.cobertura[dias[k]]; k++) ini = dias[k];
        return { n: n, cobertos: cobertos, completo: cobertos === n, desde: ini };
    }

    function mgOrdenar(linhas) {
        var c = mg.ord.col, d = mg.ord.dir;
        return linhas.slice().sort(function (a, b) {
            var x = c === 'nome' ? String(a.nome).localeCompare(String(b.nome)) : (c === 'pct' ? (a.pct == null ? -1e18 : a.pct) - (b.pct == null ? -1e18 : b.pct) : a[c] - b[c]);
            return (x * d) || String(a.nome).localeCompare(String(b.nome));
        });
    }

    function mgPct(v) { return v == null ? '—' : giroFmt(v, 1) + '%'; }
    function mgNeg(v) { return v < 0 ? ' style="color:var(--adm-ruim)"' : ''; }

    // Linhas de custo/preço atuais. cods = lista de códigos (ou null = todos), ordenadas com alertas primeiro.
    function mgCustos(cods) {
        var lista = mg.custos.filter(function (c) { return !cods || cods.indexOf(String(c.codigo_produto)) >= 0; }).map(function (c) {
            var preco = c.preco_venda_centavos == null ? null : vendNum(c.preco_venda_centavos), med = c.custo_medio_centavos == null ? null : vendNum(c.custo_medio_centavos);
            return { c: c, preco: preco, med: med, rep: c.custo_reposicao_centavos == null ? null : vendNum(c.custo_reposicao_centavos),
                     alerta: preco != null && med != null && med > preco,
                     teorica: preco != null && preco > 0 && med != null ? (preco - med) / preco * 100 : null };
        });
        lista.sort(function (a, b) { return (b.alerta ? 1 : 0) - (a.alerta ? 1 : 0) || String(mgNome(a.c.codigo_produto).nome).localeCompare(String(mgNome(b.c.codigo_produto).nome)); });
        return lista;
    }

    function mgTabelaCustos(lista, comNome) {
        function m(v) { return v == null ? '—' : esc(brl(v)); }
        return '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr>' + (comNome ? '<th>Produto</th>' : '') +
            '<th>Unidade</th><th class="num">Custo médio</th><th class="num">Custo reposição</th><th class="num">Preço de venda</th><th class="num">Margem teórica</th><th>Último recebimento</th><th>Alerta</th></tr></thead><tbody>' +
            lista.map(function (i) {
                var n = mgNome(i.c.codigo_produto);
                return '<tr>' + (comNome ? '<td>' + esc(n.nome) + (n.achou ? '' : ' <span class="text-xs" style="color:var(--adm-tinta-3)">(sem correspondência)</span>') + '</td>' : '') +
                    '<td>' + esc(i.c.unidade || '—') + '</td><td class="num">' + m(i.med) + '</td><td class="num">' + m(i.rep) + '</td><td class="num">' + m(i.preco) + '</td>' +
                    '<td class="num"' + mgNeg(i.teorica == null ? 0 : i.teorica) + '>' + esc(mgPct(i.teorica)) + '</td>' +
                    '<td>' + (i.c.ultimo_recebimento ? esc(giroFmtData(String(i.c.ultimo_recebimento).slice(0, 10))) : '—') + '</td>' +
                    '<td>' + (i.alerta ? '<span class="adm-selo adm-selo-cancelado"><i class="fa-solid fa-triangle-exclamation"></i>Custo acima do preço</span>' : '') + '</td></tr>';
            }).join('') + '</tbody></table></div>';
    }

    // Saúde por parte (vendas / custos), de buscas separadas: última tentativa e último OK. Alerta se a última tentativa
    // é erro, se o último OK passou de 2 h ou se nunca houve OK. Vendas sem nenhum registro só alerta quando já há dados diários.
    function mgSaude() {
        var linhas = [], alertas = [];
        [['vendas', 'Vendas'], ['custos', 'Custos']].forEach(function (pt) {
            var s = mg.sync[pt[0]] || {}, ult = s.ult, ok = s.ok;
            if (!ult) {
                if (pt[0] === 'custos') { linhas.push('Custos: sem atualização registrada'); alertas.push('Custos: nenhuma atualização registrada ainda.'); }
                else if (mg.diario.length) { linhas.push('Vendas: sem atualização registrada'); alertas.push('Vendas: há dados diários, mas nenhum registro de atualização da rotina.'); }
                return;
            }
            var t = ok ? new Date(ok.coletado_em || ok.em).getTime() : NaN;
            linhas.push(pt[1] + ': ' + (isFinite(t) ? 'atualizado há ' + recIdadeTxt(Date.now() - t) : 'sem atualização com sucesso'));
            if (ult.status !== 'ok') alertas.push(pt[1] + ': a última atualização falhou' + (ult.mensagem ? ' — ' + String(ult.mensagem).slice(0, 300) : '') + '.');
            else if (isFinite(t) && Date.now() - t > MG_STALE_MS) alertas.push(pt[1] + ': dados com mais de 2 horas; a rotina pode estar parada.');
            else if (!isFinite(t)) alertas.push(pt[1] + ': nenhuma atualização com sucesso.');
        });
        return (linhas.length ? '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">' + esc(linhas.join(' · ')) + '</p>' : '') +
            (alertas.length ? '<div class="adm-card p-4 mb-4" role="alert" style="border-color:var(--adm-ruim-borda)">' + alertas.map(function (a) {
                return '<p class="text-sm"><i class="fa-solid fa-triangle-exclamation mr-2" style="color:var(--adm-ruim)"></i>' + esc(a) + '</p>';
            }).join('') + '</div>' : '');
    }

    function desenharMargem() {
        var alvo = $('#vendas-margem');
        if (!alvo) return;
        if (papel !== 'admin' || mg.ausente) { alvo.innerHTML = ''; return; } // sem permissão ou sem a 031: não aparece
        var cab = '<div class="flex items-center gap-2 mb-1">' + SELO_ERP + '<p class="font-bold">Margem por produto</p></div>' +
            '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">Venda menos custo do ERP, por código de produto (somente leitura). Devoluções entram com sinal negativo.</p>';
        if (mg.erro && !mg.carregando) {
            alvo.innerHTML = cab + '<div class="adm-card p-5 mb-5"><p class="text-sm mb-3" style="color:var(--adm-tinta-2)">Não foi possível carregar a margem: ' + esc(mg.erro) + '</p>' +
                '<button type="button" class="adm-botao-fantasma" data-mg-tentar="1">Tentar de novo</button></div>';
            return;
        }
        if (!mg.carregado) {
            alvo.innerHTML = cab + '<div class="adm-card p-5 mb-5 text-center text-sm" style="color:var(--adm-tinta-2)"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando margem…</div>';
            return;
        }
        if (mg.truncado) {
            alvo.innerHTML = cab + '<div class="adm-card p-5 mb-5" role="alert" style="border-color:var(--adm-ruim-borda)"><p class="text-sm"><i class="fa-solid fa-triangle-exclamation mr-2" style="color:var(--adm-ruim)"></i>' +
                'Margem indisponível: o limite de linhas foi atingido e os totais ficariam incompletos.</p></div>';
            return;
        }
        var html = cab + mgSaude() + '<div class="adm-card p-5 mb-5">';
        if (!mg.diario.length) {
            html += '<p class="text-sm mb-1"><strong>Vendas por produto ainda não disponíveis.</strong></p>' +
                '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">Enquanto a leitura de venda e custo por produto não for confirmada, só custos e preços atuais são exibidos.</p>';
        } else {
            var A = mgAgregar(), chips = [7, 30, 90].map(function (d) {
                return '<button type="button" class="adm-chip' + (mg.dias === d ? ' is-ativo' : '') + '" data-mg-dias="' + d + '">' + d + ' dias</button>';
            }).join('');
            var corte = entIso(giroDiaUtc(recHoje()) - (mg.dias - 1) * 86400000);
            var cob = A.cob;
            html += '<div class="flex items-center justify-between flex-wrap gap-3 mb-3"><p class="text-sm" style="color:var(--adm-tinta-2)">Período: ' + esc(giroFmtData(corte)) + ' a ' + esc(giroFmtData(recHoje())) + ' (horário de São Paulo)</p>' +
                '<div class="flex gap-1 flex-wrap">' + chips + '</div></div>' +
                (cob.completo ? '' : '<div class="adm-card p-4 mb-4" role="alert" style="border-color:var(--adm-atencao-borda)"><p class="text-sm"><i class="fa-solid fa-triangle-exclamation mr-2" style="color:var(--adm-atencao)"></i>' +
                    esc('Histórico parcial: ' + NUM.format(cob.cobertos) + ' de ' + NUM.format(cob.n) + ' dias confirmados' + (cob.desde ? ' (desde ' + giroFmtData(cob.desde) + ')' : '') +
                    '. Os números abaixo são só dos dias confirmados, não do período inteiro. Rodar o backfill da margem para completar.') + '</p></div>') +
                '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">' +
                resKpi('Venda', brl(A.tot.venda), (cob.completo ? '' : 'dias confirmados · ') + 'quantidade: ' + giroFmt(A.tot.qtd, 3)) + resKpi('Custo', brl(A.tot.custo), 'custo das vendas') +
                resKpi('Margem', brl(A.tot.margem), 'venda − custo') + resKpi('Margem %', mgPct(A.tot.pct), A.tot.venda > 0 ? 'sobre a venda' : 'sem venda no período') + '</div>';
            if (!A.linhas.length) {
                html += '<p class="text-sm" style="color:var(--adm-tinta-3)">' + (cob.cobertos ? 'Nenhuma venda no período.' : 'Nenhum dia do período está confirmado ainda.') + '</p>';
            } else {
                var ord = mgOrdenar(A.linhas), vis = ord.slice(0, mg.mostrar);
                function th(col, rot, num) {
                    var at = mg.ord.col === col;
                    return '<th' + (num ? ' class="num"' : '') + '><button type="button" class="text-xs font-bold uppercase" style="color:inherit" data-mg-ord="' + col + '" aria-label="Ordenar por ' + esc(rot) + '">' + esc(rot) +
                        (at ? (mg.ord.dir < 0 ? ' ↓' : ' ↑') : '') + '</button></th>';
                }
                html += '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr>' + th('nome', 'Produto', false) + th('qtd', 'Quantidade', true) + th('venda', 'Venda', true) +
                    th('custo', 'Custo', true) + th('margem', 'Margem R$', true) + th('pct', 'Margem %', true) + '<th></th></tr></thead><tbody>' +
                    vis.map(function (o) {
                        var aberto = !!mg.abertos[o.cod], custos = mgCustos([o.cod]);
                        return '<tr><td>' + esc(o.nome) + (o.achou ? '' : ' <span class="text-xs" style="color:var(--adm-tinta-3)">(sem correspondência)</span>') + '</td>' +
                            '<td class="num"' + mgNeg(o.qtd) + '>' + esc(giroFmt(o.qtd, 3)) + '</td><td class="num"' + mgNeg(o.venda) + '>' + esc(brl(o.venda)) + '</td><td class="num"' + mgNeg(o.custo) + '>' + esc(brl(o.custo)) + '</td>' +
                            '<td class="num"' + mgNeg(o.margem) + '>' + esc(brl(o.margem)) + '</td><td class="num"' + mgNeg(o.pct == null ? 0 : o.pct) + '>' + esc(mgPct(o.pct)) + '</td>' +
                            '<td><button type="button" class="adm-botao-fantasma" data-mg-cod="' + esc(o.cod) + '" aria-expanded="' + aberto + '"><i class="fa-solid ' + (aberto ? 'fa-chevron-up' : 'fa-chevron-down') + ' mr-1"></i>Custo e preço</button></td></tr>' +
                            (aberto ? '<tr><td colspan="7">' + (custos.length ? mgTabelaCustos(custos, false) : '<p class="text-sm" style="color:var(--adm-tinta-3)">Sem custo cadastrado para este código.</p>') + '</td></tr>' : '');
                    }).join('') + '</tbody></table></div>' +
                    '<p class="text-xs mt-3" style="color:var(--adm-tinta-3)">' + NUM.format(vis.length) + ' de ' + NUM.format(ord.length) + ' produtos. Margem % = margem ÷ venda (— quando a venda é zero ou negativa).</p>' +
                    (ord.length > vis.length ? '<button type="button" class="adm-botao-fantasma mt-3" data-mg-mais="1">Mostrar mais</button>' : '');
            }
        }
        // Custos e preços atuais (sempre que houver), com alerta de custo acima do preço.
        var cs = mgCustos(null);
        html += '<p class="adm-tile-rotulo mt-6 mb-2">Custo e preço atuais' + (cs.length ? ' (' + NUM.format(cs.length) + ')' : '') + '</p>';
        if (!cs.length) html += '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhum custo sincronizado ainda.</p>';
        else {
            var nal = cs.filter(function (i) { return i.alerta; }).length;
            html += '<p class="text-xs mb-2" style="color:var(--adm-tinta-3)">' + (nal ? '<strong>' + NUM.format(nal) + '</strong> com custo médio acima do preço de venda (primeiros da lista). ' : '') + 'Margem teórica = (preço − custo médio) ÷ preço.</p>' +
                mgTabelaCustos(mg.todosCustos ? cs : cs.slice(0, 25), true) +
                (cs.length > 25 ? '<button type="button" class="adm-botao-fantasma mt-3" data-mg-todos="1">' + (mg.todosCustos ? 'Mostrar só os 25 primeiros' : 'Mostrar todos') + '</button>' : '');
        }
        alvo.innerHTML = html + '</div>';
    }

    // Delegação no contêiner (novo a cada desenho completo da Vitrine, sem ouvintes duplicados).
    function mgLigar(alvo) {
        if (!alvo) return;
        alvo.addEventListener('click', function (ev) {
            var t = ev.target;
            var d = t.closest('[data-mg-dias]'), o = t.closest('[data-mg-ord]'), c = t.closest('[data-mg-cod]');
            if (d) { mg.dias = Number(d.getAttribute('data-mg-dias')) || 30; mg.mostrar = MG_POR_PAGINA; desenharMargem(); return; }
            if (o) { var col = o.getAttribute('data-mg-ord'); mg.ord = { col: col, dir: mg.ord.col === col ? -mg.ord.dir : (col === 'nome' ? 1 : -1) }; desenharMargem(); return; }
            if (c) { var k = c.getAttribute('data-mg-cod'); mg.abertos[k] = !mg.abertos[k]; desenharMargem(); return; }
            if (t.closest('[data-mg-mais]')) { mg.mostrar += MG_POR_PAGINA; desenharMargem(); return; }
            if (t.closest('[data-mg-todos]')) { mg.todosCustos = !mg.todosCustos; desenharMargem(); return; }
            if (t.closest('[data-mg-tentar]') && !mg.carregando) carregarMargem();
        });
    }

    /* ===================================================================
     * Banner de integração parada/falhando (topo do painel, todas as abas, só equipe)
     * Só lê a última linha de cada *_sync (1 linha por tabela, sem dado pessoal). Tabela ausente ou erro de
     * leitura = sem alarme (não dá para saber). Amarelo = atraso, vermelho = erro. Fechar esconde por 1 h (localStorage).
     *  - Coletor da API (solidcon_sync): último OK > 90 min (amarelo) ou última execução com erro (vermelho).
     *  - Coletor do banco (solidcon_banco_sync): só alerta se já houve batida; > 20 min (amarelo) ou erro (vermelho).
     *  - Demais rotinas (vendas, clientes, ficha, histórico por cliente, insumos, pagamentos, contas a receber, margem):
     *    só alertam quando a última tentativa é erro (a frequência de cada uma é diferente).
     * =================================================================== */
    var SAUDE_API_STALE_MS = 90 * 60 * 1000, SAUDE_BANCO_STALE_MS = 20 * 60 * 1000, SAUDE_INTERVALO_MS = 5 * 60 * 1000,
        SAUDE_OCULTAR_MS = 60 * 60 * 1000, SAUDE_CHAVE = 'temprio_alerta_integracao_v1';
    var SAUDE_SO_ERRO = [
        ['solidcon_vendas_sync', null, 'Vendas do ERP'], ['solidcon_clientes_sync', null, 'Cadastros de clientes do ERP'],
        ['solidcon_ficha_sync', null, 'Ficha técnica do ERP'], ['solidcon_vendas_clientes_sync', null, 'Histórico de compras por cliente'],
        ['solidcon_insumos_sync', null, 'Estoque da fábrica'], ['solidcon_vendas_modalidade_sync', null, 'Formas de pagamento'],
        ['solidcon_receber_sync', null, 'Contas a receber'], ['solidcon_margem_sync', 'vendas', 'Margem (vendas)'],
        ['solidcon_margem_sync', 'custos', 'Margem (custos)']
    ];
    var saude = { timer: null, itens: [], nivel: 0, carregando: false, sessao: 0, oculto: null };

    function saudeUltima(tabela, colunas, ordem, filtros) {
        var q = sb.from(tabela).select(colunas);
        (filtros || []).forEach(function (f) { q = q.eq(f[0], f[1]); });
        return q.order(ordem, { ascending: false }).limit(1).then(
            function (r) { return r.error ? null : ((r.data || [])[0] || null); },
            function () { return null; });
    }

    // Ocultação: SEMPRE guardada em memória (vale na sessão mesmo sem storage) e, se der, no localStorage (vale após recarregar).
    // Se os dois existem, vale o que expira mais tarde.
    function saudeLerOculto() {
        var s = null;
        try {
            var o = JSON.parse(localStorage.getItem(SAUDE_CHAVE) || 'null');
            if (o && typeof o === 'object') s = { ate: Number(o.ate) || 0, nivel: Number(o.nivel) || 0 };
        } catch (e) { /* storage bloqueado ou inválido: só a memória */ }
        var m = saude.oculto;
        if (m && s) return m.ate >= s.ate ? m : s;
        return m || s;
    }
    function saudeGravarOculto(nivel) {
        saude.oculto = { ate: Date.now() + SAUDE_OCULTAR_MS, nivel: nivel };
        try { localStorage.setItem(SAUDE_CHAVE, JSON.stringify(saude.oculto)); } catch (e) { /* sem armazenamento: vale só nesta sessão */ }
    }

    // Monta a lista de problemas {nivel: 2 erro | 1 atraso, txt} a partir das últimas linhas lidas.
    function saudeHa(ms) {
        var m = Math.max(0, Math.floor(ms / 60000));
        if (m < 1) return 'menos de 1 min';
        if (m < 60) return m + ' min';
        if (m < 48 * 60) return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
        return Math.floor(m / 1440) + ' dias';
    }

    function saudeAvaliar(d) {
        var it = [], agora = Date.now();
        function ha(t) { return saudeHa(agora - new Date(t).getTime()); }
        // Coletor da API
        if (d.api && d.api.ult && d.api.ult.status === 'erro') {
            it.push({ nivel: 2, txt: 'Coletor da API SOLIDCON: última execução falhou há ' + ha(d.api.ult.concluido_em || d.api.ult.em || d.api.ult.coletado_em) });
        } else if (d.api && d.api.ok) {
            var t = new Date(d.api.ok.coletado_em || d.api.ok.concluido_em).getTime();
            if (isFinite(t) && agora - t > SAUDE_API_STALE_MS) it.push({ nivel: 1, txt: 'Coletor da API SOLIDCON: sem execução OK há ' + saudeHa(agora - t) });
        }
        // Coletor do banco: só depois da primeira batida
        if (d.banco) {
            var tb = new Date(d.banco.em).getTime();
            if (d.banco.status === 'erro') it.push({ nivel: 2, txt: 'Coletor do banco SOLIDCON: última batida com erro há ' + ha(d.banco.em) });
            else if (isFinite(tb) && agora - tb > SAUDE_BANCO_STALE_MS) it.push({ nivel: 1, txt: 'Coletor do banco SOLIDCON: sem batida há ' + saudeHa(agora - tb) });
        }
        d.outras.forEach(function (o) {
            if (o.linha && o.linha.status === 'erro') it.push({ nivel: 2, txt: o.rot + ': última atualização falhou há ' + ha(o.linha.em || o.linha.coletado_em) });
        });
        it.sort(function (a, b) { return b.nivel - a.nivel; });
        return it;
    }

    function saudeAtualizar() {
        if (!usuario || !papel || saude.carregando) return Promise.resolve();
        saude.carregando = true;
        var sessao = saude.sessao; // respostas de uma sessão antiga (logout no meio) são descartadas
        return Promise.all([
            saudeUltima('solidcon_sync', 'status,concluido_em,coletado_em', 'concluido_em'),
            saudeUltima('solidcon_sync', 'status,concluido_em,coletado_em', 'concluido_em', [['status', 'ok']]),
            saudeUltima('solidcon_banco_sync', 'status,em', 'em')
        ].concat(SAUDE_SO_ERRO.map(function (s) { return saudeUltima(s[0], 'status,em,coletado_em', 'em', s[1] ? [['parte', s[1]]] : []); }))).then(function (rs) {
            if (sessao !== saude.sessao) return; // sessão encerrada no meio: não publica nem mexe no estado da nova
            saude.carregando = false;
            var d = { api: { ult: rs[0], ok: rs[1] }, banco: rs[2], outras: SAUDE_SO_ERRO.map(function (s, i) { return { rot: s[2], linha: rs[3 + i] }; }) };
            saude.itens = saudeAvaliar(d);
            saude.nivel = saude.itens.reduce(function (m, i) { return Math.max(m, i.nivel); }, 0);
            saudeDesenhar();
        }, function () { if (sessao === saude.sessao) saude.carregando = false; });
    }

    function saudeContainer() {
        var el = document.getElementById('alerta-integracao');
        if (el) return el;
        var header = document.querySelector('#tela-painel > header');
        if (!header) return null;
        el = document.createElement('div');
        el.id = 'alerta-integracao';
        el.hidden = true;
        header.insertAdjacentElement('afterend', el);
        el.addEventListener('click', function (ev) {
            if (ev.target.closest('[data-alerta-fechar]')) { saudeGravarOculto(saude.nivel); saudeDesenhar(); return; }
            if (ev.target.closest('[data-alerta-ir]')) { trocarAba('solidcon'); window.scrollTo(0, 0); }
        });
        return el;
    }

    function saudeDesenhar() {
        dashAtualizarResumo();
        var el = saudeContainer();
        if (!el) return;
        var o = saudeLerOculto();
        if (!saude.itens.length || (o && Date.now() < o.ate && o.nivel >= saude.nivel)) { el.hidden = true; el.innerHTML = ''; return; }
        var vermelho = saude.nivel >= 2, cor = vermelho ? 'var(--adm-ruim)' : 'var(--adm-atencao)', borda = vermelho ? 'var(--adm-ruim-borda)' : 'var(--adm-atencao-borda)';
        var fundo = vermelho ? 'var(--adm-ruim-fundo)' : 'var(--adm-atencao-fundo)';
        el.className = 'max-w-7xl mx-auto px-6 pt-4';
        el.hidden = false;
        el.innerHTML = '<div role="alert" class="adm-card p-4 flex items-start gap-3" style="border-color:' + borda + ';background:' + fundo + '">' +
            '<i class="fa-solid ' + (vermelho ? 'fa-circle-exclamation' : 'fa-triangle-exclamation') + ' mt-1" style="color:' + cor + '"></i>' +
            '<div class="flex-1 min-w-0"><p class="font-bold text-sm mb-1">' + (vermelho ? 'Integração SOLIDCON com falha' : 'Integração SOLIDCON atrasada') + '</p>' +
            '<ul class="text-sm" style="color:var(--adm-tinta-2)">' + saude.itens.slice(0, 6).map(function (i) { return '<li>' + esc(i.txt) + '</li>'; }).join('') + '</ul>' +
            (saude.itens.length > 6 ? '<p class="text-xs mt-1" style="color:var(--adm-tinta-3)">e mais ' + NUM.format(saude.itens.length - 6) + ' aviso(s)</p>' : '') +
            (papel === 'admin' ? '<button type="button" class="text-xs underline mt-2" style="color:' + cor + '" data-alerta-ir="1">Ver aba Integração →</button>' : '') + '</div>' +
            '<button type="button" class="adm-botao-fantasma shrink-0" data-alerta-fechar="1" aria-label="Fechar aviso por 1 hora" title="Fechar por 1 hora"><i class="fa-solid fa-xmark"></i></button></div>';
    }

    // Encerra a sessão do banner: para o intervalo, zera o estado, esconde e invalida consultas em andamento (nova geração).
    function saudeParar() {
        if (saude.timer) { clearInterval(saude.timer); saude.timer = null; }
        saude.sessao++;
        saude.carregando = false; saude.itens = []; saude.nivel = 0; saude.oculto = null;
        var el = document.getElementById('alerta-integracao');
        if (el) { el.hidden = true; el.innerHTML = ''; }
    }

    // Um único intervalo por sessão (reiniciar antes de criar evita duplicar em novo login).
    function saudeIniciar() {
        if (saude.timer) { clearInterval(saude.timer); saude.timer = null; }
        saudeAtualizar();
        saude.timer = setInterval(function () {
            if (!usuario || !papel) { saudeParar(); return; }
            saudeAtualizar();
        }, SAUDE_INTERVALO_MS);
    }

    /* ===================================================================
     * Regiões — mapa de clientes do ERP por bairro (só contagens, sem dado pessoal)
     * Lê só documento/tipo/cidade/bairro/estado de solidcon_clientes (nunca nome ou telefone). O documento fica
     * em memória apenas para somar o valor comprado (cmp) por bairro; nunca é exibido nem enviado ao geocodificador.
     * A agregação (geoAgregar / geoClassificar) é independente do mapa, para reaproveitar
     * numa futura sugestão de rota.
     * =================================================================== */
    var geo = { carregado: false, carregando: false, ausente: false, erro: null, locais: [],
                coords: {}, rodando: false, parar: false, feitos: 0, total: 0, ajustou: false,
                ordem: { col: 'total', dir: -1 }, modo: 'n' };
    var mapaClientes = null, mapaClientesCamada = null;
    var GEO_CACHE_CHAVE = 'temprio_geo_v1', GEO_RETENTAR_MS = 7 * 86400000;

    function geoNorm(s) {
        return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    // [{chave, bairro, cidade, uf, total, cnpj, cpf}] — um por bairro+cidade+UF (grafia mais comum).
    function geoAgregar(linhas) {
        var mapa = {};
        linhas.forEach(function (l) {
            var b = String(l.bairro || '').trim(), c = String(l.cidade || '').trim(), u = String(l.estado || '').trim().toUpperCase();
            var chave = geoNorm(b) + '|' + geoNorm(c) + '|' + u;
            var o = mapa[chave] || (mapa[chave] = { chave: chave, bairro: b, cidade: c, uf: u, total: 0, cnpj: 0, cpf: 0, docs: [], valor: 0, grafias: {} });
            o.total++;
            var dk = docNorm(l.documento, l.tipo); if (dk) o.docs.push(dk);
            if (String(l.tipo).toLowerCase() === 'cnpj') o.cnpj++; else if (String(l.tipo).toLowerCase() === 'cpf') o.cpf++;
            var g = b + '|' + c; o.grafias[g] = (o.grafias[g] || 0) + 1;
        });
        return Object.keys(mapa).map(function (k) {
            var o = mapa[k], melhor = Object.keys(o.grafias).sort(function (a, b) { return o.grafias[b] - o.grafias[a]; })[0].split('|');
            o.bairro = melhor[0]; o.cidade = melhor[1]; delete o.grafias;
            return o;
        });
    }

    // Municípios (fora da capital) que costumam virar região própria. Lista FIXA: o critério não
    // depende de quais clientes foram carregados.
    var GEO_MUNICIPIOS_PROPRIOS = ['niteroi', 'sao goncalo', 'itaborai', 'marica', 'mage', 'guapimirim', 'tangua', 'rio bonito',
        'duque de caxias', 'nova iguacu', 'sao joao de meriti', 'belford roxo', 'nilopolis', 'mesquita', 'queimados',
        'japeri', 'seropedica', 'itaguai', 'paracambi', 'petropolis', 'teresopolis', 'cabo frio'];

    // Região de entrega do local, por NOME (sem polígono: é aproximação).
    // UF diferente de RJ = fora. 1) cidade igual ao nome de uma região; 2) cidade listada nos bairros de uma região;
    // 3) bairro SÓ quando cidade = Rio de Janeiro e UF = RJ, ignorando regiões cujo nome é um município próprio.
    function geoClassificar(local) {
        var nb = geoNorm(local.bairro), nc = geoNorm(local.cidade), uf = String(local.uf || '').toUpperCase();
        if (uf && uf !== 'RJ') return null;
        var regs = dados.regioes.filter(function (r) { return r.bairros && r.bairros.length; })
            .sort(function (a, b) { return (Number(b.prioridade) || 0) - (Number(a.prioridade) || 0); });
        function naLista(r, nome) { return r.bairros.some(function (x) { return geoNorm(x) === nome; }); }
        if (!nc) return null;
        var porCidade = dados.regioes.filter(function (r) { return geoNorm(r.nome) === nc; })[0] ||
                        regs.filter(function (r) { return naLista(r, nc); })[0];
        if (porCidade) return porCidade;
        if (nc !== 'rio de janeiro' || uf !== 'RJ' || !nb) return null;
        return regs.filter(function (r) { return GEO_MUNICIPIOS_PROPRIOS.indexOf(geoNorm(r.nome)) < 0 && naLista(r, nb); })[0] || null;
    }

    function geoLerCache() {
        // Só objeto simples vale: raiz primitiva, null ou array (JSON válido porém inútil) vira cache vazio.
        try {
            var c = JSON.parse(localStorage.getItem(GEO_CACHE_CHAVE) || '{}');
            return (c && typeof c === 'object' && !Array.isArray(c)) ? c : {};
        } catch (e) { return {}; }
    }
    function geoGravarCache(c) {
        try { localStorage.setItem(GEO_CACHE_CHAVE, JSON.stringify(c)); } catch (e) { /* sem cache: segue */ }
    }
    // Texto enviado ao Nominatim: SÓ "bairro, cidade, UF, Brasil".
    function geoTexto(l) { return [l.bairro, l.cidade, l.uf, 'Brasil'].filter(Boolean).join(', '); }

    // Coordenada utilizável: números finitos, dentro do Brasil (evita quebrar o Leaflet com lixo no cache).
    function geoCoordValida(lat, lng) {
        return typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng) &&
               lat >= -34 && lat <= 6 && lng >= -74 && lng <= -28;
    }

    function geoAplicarCache() {
        var c = geoLerCache(), agora = Date.now();
        geo.coords = {};
        geo.locais.forEach(function (l) {
            var e = c[l.chave];
            if (!e || typeof e !== 'object') return;
            if (geoCoordValida(e.lat, e.lng)) geo.coords[l.chave] = { lat: e.lat, lng: e.lng };
            else if (e.nf === 1 && typeof e.ts === 'number' && agora - e.ts < GEO_RETENTAR_MS) geo.coords[l.chave] = null; // não encontrado (cache)
            // qualquer outra coisa: entrada inválida, ignorada — o local fica pendente
        });
    }

    function carregarGeoClientes() {
        geo.carregando = true; geoRedesenhar();
        return vendPaginar(function () {
            return sb.from('solidcon_clientes').select('documento,tipo,cidade,bairro,estado').order('documento', { ascending: true });
        }).then(function (r) {
            geo.carregando = false; geo.ausente = false; geo.erro = null;
            if (r.error) {
                if (solidTabelaAusente(r.error)) geo.ausente = true; else geo.erro = String(r.error.message || r.error);
                geo.carregado = false;
            } else {
                geo.totalClientes = (r.data || []).length;
                geo.locais = geoAgregar(r.data || []);
                geoAplicarCache();
                geo.carregado = true;
            }
            geoRedesenhar();
        }).catch(function (e) { geo.carregando = false; geo.erro = String(e && e.message || e); geoRedesenhar(); });
    }

    // Soma o valor comprado (6 meses) por bairro. false = histórico indisponível (valor fica 0).
    function geoCalcValores() {
        var ok = cmpPronto();
        geo.locais.forEach(function (l) {
            l.valor = 0;
            if (ok) l.docs.forEach(function (k) { var o = cmp.por[k]; if (o) l.valor += o.total6; });
        });
        return ok;
    }

    function geoRedesenhar() {
        dashAtualizarResumo();
        abasParaRedesenhar.regioes = true;
        desenharAbaSeSuja(abaAtual);
    }

    // Geocodifica (>= 1,1 s entre requisições) só os locais ainda sem resposta; resultado vai ao cache.
    // Cada chamada tem timeout (GEO_TIMEOUT_MS) e é abortada por "Parar"; o estado sempre é liberado.
    var GEO_TIMEOUT_MS = 10000, GEO_INTERVALO_MS = 1100;

    function geoFinalizar() {
        geo.rodando = false; geo.parar = false;
        if (geo.liberarTrava) { var lib = geo.liberarTrava; geo.liberarTrava = null; geoResfriar().then(lib); }
        if (geo.timerEspera) { clearTimeout(geo.timerEspera); geo.timerEspera = null; }
        if (geo.abortar) { try { geo.abortar(); } catch (e) { /* já encerrada */ } geo.abortar = null; }
        geoAtualizarMapa();
    }

    function geoParar() {
        if (!geo.rodando) return;
        geo.parar = true;
        if (geo.abortar) { try { geo.abortar(); } catch (e) { /* já encerrada */ } }
        if (geo.timerEspera) { clearTimeout(geo.timerEspera); geo.timerEspera = null; geoFinalizar(); }
    }

    function geoBuscar(url) {
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var expirou = false, timer;
        var limite = new Promise(function (_, rejeita) {
            timer = setTimeout(function () { expirou = true; if (ctrl) ctrl.abort(); rejeita(new Error('timeout')); }, GEO_TIMEOUT_MS);
        });
        geo.abortar = function () { if (ctrl) ctrl.abort(); };
        var req = fetch(url, { headers: { 'Accept-Language': 'pt-BR' }, signal: ctrl ? ctrl.signal : undefined }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        });
        return Promise.race([req, limite]).then(function (v) { clearTimeout(timer); geo.abortar = null; return v; },
                                                function (e) { clearTimeout(timer); geo.abortar = null; throw e; });
    }

    // Mapa antigo por bairro: usa a MESMA trava entre abas do mapa novo (nunca correm juntos).
    function geoLocalizar() {
        if (geo.rodando || gmap.run.rodando) return;
        if (!geoTravaOk()) { geoAtualizarMapa(); var st0 = $('#geo-status'); if (st0) st0.textContent = 'Este navegador não permite a trava entre abas; a localização não roda aqui.'; return; }
        geo.rodando = true;
        navigator.locks.request(GEO_TRAVA, { ifAvailable: true }, function (trava) {
            if (!trava) { geo.rodando = false; geoAtualizarMapa(); return null; }
            return new Promise(function (liberar) { geo.liberarTrava = liberar; geoLocalizarInterno(); });
        });
    }
    function geoLocalizarInterno() {
        var fila = geo.locais.filter(function (l) { return !(l.chave in geo.coords) && l.cidade && l.uf; });
        if (!fila.length) { geoFinalizar(); return; }
        geo.rodando = true; geo.parar = false; geo.feitos = 0; geo.total = fila.length; geo.falhasSeguidas = 0;
        geoAtualizarMapa();
        (function proximo(i) {
            if (geo.parar || i >= fila.length) { geoFinalizar(); return; }
            // Throttle global: respeita o intervalo desde a ÚLTIMA requisição iniciada, mesmo após Parar/abort/reinício.
            var espera = GEO_INTERVALO_MS - (Date.now() - geoUltimo());
            if (espera > 0) {
                geo.timerEspera = setTimeout(function () { geo.timerEspera = null; proximo(i); }, espera);
                return;
            }
            var l = fila[i];
            geoMarcarInicio();
            var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=' + encodeURIComponent(geoTexto(l));
            geoBuscar(url).then(function (res) {
                geo.falhasSeguidas = 0;
                var c = geoLerCache();
                var lat = res && res[0] ? Number(res[0].lat) : NaN, lng = res && res[0] ? Number(res[0].lon) : NaN;
                if (geoCoordValida(lat, lng)) {
                    geo.coords[l.chave] = { lat: lat, lng: lng }; c[l.chave] = { lat: lat, lng: lng, ts: Date.now() };
                } else {
                    geo.coords[l.chave] = null; c[l.chave] = { nf: 1, ts: Date.now() };
                }
                geoGravarCache(c);
            }, function (e) {
                // HTTP 429/403: bloqueio por excesso — para na hora (nenhuma requisição a mais); rede/timeout/abort: não grava, fica pendente
                if (/HTTP (429|403)/.test(String(e && e.message || ''))) { geo.parar = true; geo.bloqueado = true; geo.falhasSeguidas = 3; }
                else geo.falhasSeguidas++;
            }).then(function () {
                geo.feitos = i + 1;
                geoAtualizarMapa();
                if (geo.parar || geo.falhasSeguidas >= 3) { geoFinalizar(); return; }
                proximo(i + 1);
            });
        })(0);
    }

    function geoCor(reg) {
        if (!reg) return corToken('--adm-atencao', '#e3b14b');
        return reg.ativo ? corToken('--adm-dados', '#6fa8e0') : corToken('--adm-tinta-3', '#93a1b1');
    }

    function desenharRegioes() {
        var alvo = $('#painel-regioes');
        if (mapaClientes) { mapaClientes.remove(); mapaClientes = null; mapaClientesCamada = null; gmap.camada = null; gmap.marcadores = {}; }
        desenharRegioesBase();
        alvo.insertAdjacentHTML('afterbegin', '<section id="geo-clientes" class="mb-8"></section>');
        desenharGeoClientes();
    }

    function desenharGeoClientes() {
        var alvo = $('#geo-clientes');
        if (!alvo) return;
        var cab = '<div class="flex items-center gap-2 mb-2">' + SELO_ERP + '<p class="font-bold">Clientes por região</p></div>';
        if (geo.carregando && !geo.carregado) {
            alvo.innerHTML = cab + '<div class="adm-card p-6 text-center text-sm" style="color:var(--adm-tinta-2)"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando cadastros do ERP…</div>';
            return;
        }
        if (geo.ausente) { alvo.innerHTML = cab + cartaoVazio('Cadastros do SOLIDCON não instalados', 'A tabela solidcon_clientes não existe neste banco.'); return; }
        if (geo.erro) {
            alvo.innerHTML = cab + '<div class="adm-card p-6"><p class="text-sm mb-3" style="color:var(--adm-tinta-2)">Não foi possível carregar: ' + esc(geo.erro) + '</p>' +
                '<button type="button" class="adm-botao-fantasma" id="geo-tentar">Tentar de novo</button></div>';
            alvo.querySelector('#geo-tentar').addEventListener('click', carregarGeoClientes);
            return;
        }
        if (!geo.carregado) return;
        if (!geo.locais.length) { alvo.innerHTML = cab + cartaoVazio('Nenhum cadastro sincronizado ainda', 'Quando a rotina de clientes rodar, o mapa aparece aqui.'); return; }

        alvo.innerHTML = cab +
            '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">Contagem de cadastros do ERP por bairro — sem nome, documento ou contato. ' +
            'A região vem do <strong>nome do bairro/cidade</strong> cadastrado em cada região (não há polígono): é uma aproximação. ' +
            'As posições são buscadas no OpenStreetMap (Nominatim) enviando só “bairro, cidade, UF”, e ficam salvas neste navegador.</p>' +
            '<div class="adm-card p-5 mb-5"><div id="geo-tl" class="mb-3">' + gmapControlesHtml() + '</div>' +
                '<div class="flex items-center flex-wrap gap-3 mb-3' + (gmapAtivo() ? ' hidden' : '') + '" id="geo-barra-antiga">' +
                '<button type="button" class="adm-botao" id="geo-localizar">Localizar bairros no mapa</button>' +
                '<button type="button" class="adm-botao-fantasma hidden" id="geo-parar">Parar</button>' +
                '<label for="geo-modo" class="adm-tile-rotulo ml-auto">Tamanho do círculo</label>' +
                '<select id="geo-modo" class="adm-input" style="width:auto;padding:.4rem .7rem"><option value="n"' + (geo.modo === 'n' ? ' selected' : '') + '>Nº de clientes</option>' +
                    '<option value="valor"' + (geo.modo === 'valor' ? ' selected' : '') + '>Valor comprado (' + CMP_MESES_VALOR + ' meses)</option></select>' +
                '<span class="text-xs" id="geo-status" role="status" style="color:var(--adm-tinta-3)"></span></div>' +
                '<p class="text-xs mb-3 hidden" id="geo-modo-aviso" role="status" style="color:var(--adm-tinta-2)"></p>' +
                '<div id="mapa-clientes" class="adm-mapa-escuro" style="height:420px;border-radius:.75rem;overflow:hidden"></div>' +
                (gmapAtivo()
                    ? '<div class="flex gap-4 flex-wrap text-xs mt-3" style="color:var(--adm-tinta-2)">' +
                        '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--adm-dados)"></span> Cliente CNPJ (tamanho = vendido até a data)</span>' +
                        '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;border:1px dashed var(--adm-dados)"></span> Posição aproximada (centro do bairro)</span>' +
                      '</div>'
                    : '<div class="flex gap-4 flex-wrap text-xs mt-3" style="color:var(--adm-tinta-2)">' +
                    '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--adm-dados)"></span> Dentro de região que entrega</span>' +
                    '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--adm-tinta-3)"></span> Região sem entrega</span>' +
                    '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--adm-atencao)"></span> Fora das regiões</span>' +
                    '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;border:2px solid var(--adm-tinta)"></span> Ponto central aproximado da região</span>' +
                '</div>') + '</div>' +
            '<div id="geo-resumo-tempo"></div><div id="geo-resumo"></div><div id="geo-tabela"></div><div id="geo-naoloc"></div>';

        gmapLigar();
        alvo.querySelector('#geo-localizar').addEventListener('click', geoLocalizar);
        alvo.querySelector('#geo-parar').addEventListener('click', geoParar);
        alvo.querySelector('#geo-modo').addEventListener('change', function (ev) { geo.modo = ev.target.value === 'valor' ? 'valor' : 'n'; geoAtualizarMapa(); });
        geoAtualizarMapa();
    }

    // Atualiza mapa, resumo por região, tabela e lista de não localizados (sem refazer a aba).
    function geoAtualizarMapa() {
        if (!$('#geo-clientes') || !geo.carregado) return;
        var cls = {};
        geo.locais.forEach(function (l) { cls[l.chave] = geoClassificar(l); });
        // Valor comprado (6 meses) por bairro: soma das compras dos documentos do bairro; só com o histórico utilizável.
        var temValor = geoCalcValores();
        var usaValor = geo.modo === 'valor' && temValor;
        var avisoModo = $('#geo-modo-aviso');
        if (avisoModo) {
            var motivo = geo.modo === 'valor' && !temValor
                ? (cmp.ausente ? 'Valor indisponível: histórico de compras ainda não instalado.' : cmp.erro ? 'Valor indisponível: falha ao carregar o histórico de compras.' :
                   cmp.truncado ? 'Valor indisponível: histórico grande demais para o painel.' : 'Carregando o histórico de compras…') + ' Círculos por nº de clientes.' : '';
            avisoModo.textContent = motivo; avisoModo.classList.toggle('hidden', !motivo);
        }
        var seletor = $('#geo-modo'); if (seletor) seletor.value = geo.modo;
        function medida(l) { return usaValor ? l.valor : l.total; }
        var pendentes = geo.locais.filter(function (l) { return !(l.chave in geo.coords) && l.cidade && l.uf; }).length;

        var st = $('#geo-status'), bl = $('#geo-localizar'), bp = $('#geo-parar');
        if (st) st.textContent = geo.rodando ? ('Localizando ' + NUM.format(geo.feitos) + ' de ' + NUM.format(geo.total) + '…')
            : ((geo.falhasSeguidas >= 3 ? 'Busca interrompida por falhas de rede. ' : '') + (pendentes ? NUM.format(pendentes) + ' bairro(s) ainda sem posição.' : 'Todos os bairros já foram consultados.'));
        if (bl) { bl.disabled = geo.rodando || !pendentes; }
        if (bp) bp.classList.toggle('hidden', !geo.rodando);

        // ---- mapa ----
        var alvoMapa = $('#mapa-clientes');
        if (alvoMapa && typeof L !== 'undefined') {
            if (!mapaClientes) {
                mapaClientes = L.map('mapa-clientes', { scrollWheelZoom: false }).setView([-22.92, -43.35], 10);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 18 }).addTo(mapaClientes);
            }
            if (mapaClientesCamada) { mapaClientes.removeLayer(mapaClientesCamada); mapaClientesCamada = null; }
            if (gmapAtivo()) { gmapCriarPinos(); gmapPinosAtualizar(); } else {
            mapaClientesCamada = L.layerGroup();
            var maior = Math.max.apply(null, geo.locais.map(medida).concat([1]));
            var pts = [];
            geo.locais.forEach(function (l) {
                var p = geo.coords[l.chave];
                if (!p) return;
                var reg = cls[l.chave], cor = geoCor(reg);
                L.circleMarker([p.lat, p.lng], { radius: 5 + Math.round(Math.sqrt(medida(l) / maior) * 22), color: cor, weight: 1, fillColor: cor, fillOpacity: 0.5 })
                    .bindTooltip(esc((l.bairro ? l.bairro + ', ' : '') + l.cidade + '/' + l.uf) + ': ' + NUM.format(l.total) + (l.total === 1 ? ' cliente' : ' clientes') +
                        ' (' + NUM.format(l.cnpj) + ' CNPJ, ' + NUM.format(l.cpf) + ' CPF)' + (temValor ? ' · ' + esc(brl(l.valor)) + ' em ' + CMP_MESES_VALOR + ' meses' : '') + ' · ' + esc(reg ? reg.nome : 'fora das regiões'))
                    .addTo(mapaClientesCamada);
                pts.push([p.lat, p.lng]);
            });
            dados.regioes.forEach(function (r) {
                if (!REGIAO_COORDS[r.id]) return;
                L.circleMarker(REGIAO_COORDS[r.id], { radius: 6, color: corToken('--adm-tinta', '#e9eef4'), weight: 2, fillOpacity: 0, dashArray: r.ativo ? null : '3 3' })
                    .bindTooltip(esc(r.nome) + (r.ativo ? '' : ' (sem entrega)'), { permanent: true, direction: 'top', opacity: 0.85 })
                    .addTo(mapaClientesCamada);
            });
            mapaClientesCamada.addTo(mapaClientes);
            if (pts.length && !geo.ajustou) { mapaClientes.fitBounds(pts, { padding: [30, 30], maxZoom: 12 }); geo.ajustou = true; }
            }
            setTimeout(function () { if (mapaClientes) mapaClientes.invalidateSize(); }, 50);
        } else if (alvoMapa) {
            alvoMapa.innerHTML = '<p class="adm-vazio">Mapa indisponível (biblioteca não carregou).</p>';
        }

        // ---- resumo por região ----
        var porReg = {}, fora = { total: 0, cnpj: 0, cpf: 0, locais: 0 };
        geo.locais.forEach(function (l) {
            var r = cls[l.chave], o = r ? (porReg[r.id] || (porReg[r.id] = { total: 0, cnpj: 0, cpf: 0, locais: 0 })) : fora;
            o.total += l.total; o.cnpj += l.cnpj; o.cpf += l.cpf; o.locais++;
        });
        var linhasReg = dados.regioes.filter(function (r) { return porReg[r.id]; }).map(function (r) {
            var o = porReg[r.id];
            var faixas = faixasDe(r.id).map(function (f) { return formatarCep(f.cep_inicio) + ' a ' + formatarCep(f.cep_fim); }).join(' · ');
            return '<tr><td>' + esc(r.nome) + '</td><td>' + (r.ativo ? 'Entrega' : 'Sem entrega') + '</td>' +
                '<td class="num">' + esc(brl(r.taxa_centavos)) + '</td><td class="text-xs" style="color:var(--adm-tinta-3)">' + esc(faixas || '—') + '</td>' +
                '<td class="num">' + NUM.format(o.total) + '</td><td class="num">' + NUM.format(o.cnpj) + '</td><td class="num">' + NUM.format(o.cpf) + '</td><td class="num">' + NUM.format(o.locais) + '</td></tr>';
        }).join('');
        var resumo = $('#geo-resumo');
        if (resumo) resumo.innerHTML = '<div class="adm-card p-5 mb-5"><p class="font-bold mb-3">Clientes dentro e fora de cada região</p>' +
            '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Região</th><th>Situação</th><th class="num">Frete</th><th>Faixas de CEP</th>' +
            '<th class="num">Clientes</th><th class="num">CNPJ</th><th class="num">CPF</th><th class="num">Bairros</th></tr></thead><tbody>' + linhasReg +
            '<tr><td><strong>Fora das regiões cadastradas</strong></td><td>—</td><td class="num">—</td><td class="text-xs" style="color:var(--adm-tinta-3)">sem bairro/cidade casando com nenhuma região</td>' +
            '<td class="num">' + NUM.format(fora.total) + '</td><td class="num">' + NUM.format(fora.cnpj) + '</td><td class="num">' + NUM.format(fora.cpf) + '</td><td class="num">' + NUM.format(fora.locais) + '</td></tr>' +
            '</tbody></table></div><p class="text-xs mt-3" style="color:var(--adm-tinta-3)">Os cadastros do ERP não trazem CEP, por isso o enquadramento é pelo nome do bairro/cidade, não pela faixa de CEP.</p></div>';

        // ---- tabela ordenável por bairro ----
        var o = geo.ordem;
        var lista = geo.locais.slice().sort(function (a, b) {
            var va, vb;
            if (o.col === 'local') { va = geoNorm(a.bairro + ' ' + a.cidade); vb = geoNorm(b.bairro + ' ' + b.cidade); return va < vb ? -o.dir : va > vb ? o.dir : 0; }
            if (o.col === 'regiao') { va = cls[a.chave] ? cls[a.chave].nome : 'zzzz'; vb = cls[b.chave] ? cls[b.chave].nome : 'zzzz'; return String(va).localeCompare(String(vb)) * o.dir; }
            return (a[o.col] - b[o.col]) * o.dir || (b.total - a.total);
        });
        function th(col, rot, num) {
            var seta = o.col === col ? (o.dir > 0 ? ' ▲' : ' ▼') : '';
            return '<th' + (num ? ' class="num"' : '') + ' style="cursor:pointer" data-geo-ord="' + col + '" aria-sort="' + (o.col === col ? (o.dir > 0 ? 'ascending' : 'descending') : 'none') + '">' + rot + seta + '</th>';
        }
        var tab = $('#geo-tabela');
        if (tab) {
            tab.innerHTML = '<div class="adm-card p-5 mb-5"><p class="font-bold mb-3">Clientes por bairro</p>' +
                '<div class="overflow-x-auto" style="max-height:26rem;overflow-y:auto"><table class="adm-tabela"><thead><tr>' +
                th('local', 'Bairro / cidade') + th('regiao', 'Região') + th('total', 'Clientes', true) + th('cnpj', 'CNPJ', true) + th('cpf', 'CPF', true) + (temValor ? th('valor', 'Valor ' + CMP_MESES_VALOR + ' meses', true) : '') + '<th>Posição</th></tr></thead><tbody>' +
                lista.map(function (l) {
                    var r = cls[l.chave], p = geo.coords[l.chave];
                    return '<tr><td>' + esc(l.bairro || '(sem bairro)') + ', ' + esc(l.cidade || '—') + (l.uf ? '/' + esc(l.uf) : '') + '</td>' +
                        '<td>' + esc(r ? r.nome : 'Fora das regiões') + '</td><td class="num">' + NUM.format(l.total) + '</td><td class="num">' + NUM.format(l.cnpj) + '</td><td class="num">' + NUM.format(l.cpf) + '</td>' + (temValor ? '<td class="num">' + esc(brl(l.valor)) + '</td>' : '') +
                        '<td class="text-xs" style="color:var(--adm-tinta-3)">' + (p ? 'no mapa' : (l.chave in geo.coords ? 'não localizado' : (l.cidade && l.uf ? 'pendente' : 'sem cidade/UF'))) + '</td></tr>';
                }).join('') + '</tbody></table></div></div>';
            tab.querySelectorAll('[data-geo-ord]').forEach(function (h) {
                h.addEventListener('click', function () {
                    var c = h.getAttribute('data-geo-ord');
                    geo.ordem = { col: c, dir: geo.ordem.col === c ? -geo.ordem.dir : (c === 'local' || c === 'regiao' ? 1 : -1) };
                    geoAtualizarMapa();
                });
            });
        }

        // ---- não localizados ----
        var nao = geo.locais.filter(function (l) { return geo.coords[l.chave] === null || !(l.cidade && l.uf); });
        var nl = $('#geo-naoloc');
        if (nl) nl.innerHTML = nao.length
            ? '<div class="adm-card p-5"><p class="font-bold mb-1">Não localizados no mapa (' + NUM.format(nao.length) + ')</p>' +
              '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">Sem posição no OpenStreetMap ou sem cidade/UF no cadastro. Continuam contados na tabela e nos totais.</p>' +
              '<div class="flex gap-2 flex-wrap">' + nao.map(function (l) {
                  return '<span class="adm-selo adm-selo-neutro">' + esc((l.bairro || '(sem bairro)') + ', ' + (l.cidade || '—') + (l.uf ? '/' + l.uf : '')) + ' · ' + NUM.format(l.total) + '</span>';
              }).join('') + '</div></div>' : '';
    }


    /* ===================================================================
     * Mapa de expansão: UM pino por cliente CNPJ (migração 033) + linha do tempo + geocodificação sob demanda. Só admin.
     * Dados: RPC solidcon_mapa_clientes (1 linha por CNPJ; CPF nunca aparece). Coordenadas vêm do banco (cache compartilhado);
     * o Nominatim só é chamado por clique em "Localizar endereços novos", 1 req/s, só pendentes (solidcon_geo_pendentes),
     * gravando em lotes de 10 via solidcon_gravar_geo_clientes. Para em HTTP 429/403. Sem a 033: mapa antigo por bairro.
     * =================================================================== */
    var GMAP_LOTE_CLIQUE = 100, GMAP_LOTE_GRAVAR = 10, GMAP_PASSO_MS = 800;
    var gmap = { sessao: 0, carregado: false, carregando: false, ausente: false, erro: null, linhas: [], meses: [], idx: 0, fixouIdx: false,
                 tocando: false, timer: null, marcadores: {}, camada: null, max: 1,
                 pend: null, pendErro: null, run: { rodando: false, parar: false, feitos: 0, total: 0, gravados: 0, ignorados: 0, falhas: 0, msg: '' } };

    function gmapRedesenhar() {
        abasParaRedesenhar.regioes = true;
        desenharAbaSeSuja(abaAtual);
    }
    function gmapAusente(e) { return /PGRST202|42883|42P01|PGRST205|does not exist|Could not find the function|Could not find the table/i.test(String((e && e.message) || '') + ' ' + String((e && e.code) || '')); }
    function gmapAtivo() { return papel === 'admin' && gmap.carregado && gmap.linhas.length > 0 && gmap.meses.length > 0; }
    function gmapMesRot(m) { return m.slice(5, 7) + '/' + m.slice(0, 4); }
    function gmapReduzMov() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

    function carregarMapaClientes() {
        if (papel !== 'admin' || gmap.carregando) return Promise.resolve();
        gmap.carregando = true; gmapRedesenhar();
        return vendPaginar(function () { return sb.rpc('solidcon_mapa_clientes').order('documento', { ascending: true }); }, 20000).then(function (r) {
            gmap.carregando = false; gmap.ausente = false; gmap.erro = null;
            if (r.error) {
                if (gmapAusente(r.error)) gmap.ausente = true; else gmap.erro = String(r.error.message || r.error);
                gmap.carregado = false;
            } else { gmapPreparar(r.data || []); gmap.carregado = true; }
            gmapRedesenhar();
            gmapCarregarPendentes();
        }).catch(function (e) { gmap.carregando = false; gmap.erro = String(e && e.message || e); gmap.carregado = false; gmapRedesenhar(); });
    }

    // Lista de meses (do primeiro mês com compra até o atual) e acumulados por cliente alinhados a ela.
    function gmapPreparar(linhas) {
        var hoje = recHoje().slice(0, 7), min = hoje;
        linhas.forEach(function (l) {
            var pc = l.primeira_compra ? String(l.primeira_compra).slice(0, 7) : '';
            if (pc && pc < min) min = pc;
        });
        var meses = [], m = min;
        while (m <= hoje && meses.length < 400) { meses.push(m); var p = m.split('-'), a = Number(p[0]), mm = Number(p[1]) + 1; if (mm > 12) { mm = 1; a++; } m = a + '-' + String(mm).padStart(2, '0'); }
        var max = 1;
        linhas.forEach(function (l) {
            var ms = l.meses && typeof l.meses === 'object' ? l.meses : {}, ac = 0, cu = 0, ult = '';
            l._ac = []; l._cu = []; l._ult = [];
            meses.forEach(function (k) {
                var v = ms[k];
                if (v) { ac += Number(v[0]) || 0; cu += Number(v[1]) || 0; ult = k; }
                l._ac.push(ac); l._cu.push(cu); l._ult.push(ult);
            });
            l._pm = l.primeira_compra ? String(l.primeira_compra).slice(0, 7) : '';
            l._reg = undefined;
            if (ac > max) max = ac;
        });
        gmap.linhas = linhas; gmap.meses = meses; gmap.max = max;
        if (!gmap.fixouIdx || gmap.idx >= meses.length) gmap.idx = meses.length - 1;
    }

    function gmapCarregarPendentes() {
        if (papel !== 'admin') return;
        sb.rpc('solidcon_geo_pendentes', { p_limite: 500 }).then(function (r) {
            if (r.error) { gmap.pend = null; gmap.pendErro = gmapAusente(r.error) ? 'ausente' : String(r.error.message || r.error); }
            else { gmap.pend = (r.data || []).length; gmap.pendErro = null; }
            gmapUI();
        }, function () { gmap.pend = null; });
    }

    // ---- pinos ----
    function gmapPopup(l) {
        var i = gmap.idx, mes = gmap.meses[i];
        var local = [l.bairro, l.cidade].filter(Boolean).join(', ') + (l.estado ? '/' + l.estado : '');
        return '<strong>' + esc(l.nome || '(sem nome)') + '</strong><br>' + esc(local || '—') + '<br>' +
            'Vendido até ' + esc(gmapMesRot(mes)) + ': ' + esc(brl(l._ac[i])) + '<br>' +
            'Compras: ' + NUM.format(l._cu[i]) + '<br>' +
            '1ª compra: ' + (l.primeira_compra ? esc(cmpData(String(l.primeira_compra).slice(0, 10))) : '—') + '<br>' +
            'Última (até a data): ' + (l._ult[i] ? esc(gmapMesRot(l._ult[i])) : '—') +
            (l.precisao === 'bairro' ? '<br><em>Posição aproximada (centro do bairro)</em>' : l.precisao === 'cep' ? '<br><em>Posição pelo CEP</em>' : '');
    }

    function gmapPino(l, i) {
        var visivel = l._pm && l._pm <= gmap.meses[i];
        var raio = 4 + Math.sqrt((l._ac[i] || 0) / gmap.max) * 10;
        var cor = corToken('--adm-dados', '#6fa8e0'), aprox = l.precisao === 'bairro';
        return { visivel: !!visivel, raio: raio, estilo: { color: cor, weight: aprox ? 1.5 : 1, dashArray: aprox ? '3 3' : null, fillColor: cor, fillOpacity: aprox ? 0.18 : 0.55 } };
    }

    // Reposiciona/ajusta os pinos para o mês escolhido (sem refazer o mapa).
    function gmapPinosAtualizar() {
        if (!gmapAtivo() || !mapaClientes || !gmap.camada) return;
        var i = gmap.idx, n = 0, semPos = 0, total = 0;
        gmap.linhas.forEach(function (l) {
            var pino = gmapPino(l, i);
            if (pino.visivel) { n++; total += l._ac[i]; if (!gmap.marcadores[l.documento]) semPos++; }
            var mk = gmap.marcadores[l.documento];
            if (!mk) return;
            if (pino.visivel) {
                mk.setRadius(pino.raio); mk.setStyle(pino.estilo);
                if (!gmap.camada.hasLayer(mk)) gmap.camada.addLayer(mk);
            } else if (gmap.camada.hasLayer(mk)) gmap.camada.removeLayer(mk);
        });
        var rot = $('#geo-tl-rotulo');
        if (rot) rot.textContent = 'Até ' + gmapMesRot(gmap.meses[i]) + ': ' + NUM.format(n) + (n === 1 ? ' cliente' : ' clientes') + ' · ' + brl(total) +
            (semPos ? ' (' + NUM.format(semPos) + ' sem posição no mapa)' : '');
        var barra = $('#geo-tl-barra'); if (barra && Number(barra.value) !== i) barra.value = String(i);
        gmapResumoTempo();
    }

    function gmapCriarPinos() {
        if (!mapaClientes) return;
        if (gmap.camada) { try { mapaClientes.removeLayer(gmap.camada); } catch (e) { /* mapa novo */ } }
        gmap.camada = L.layerGroup().addTo(mapaClientes); gmap.marcadores = {};
        var pts = [];
        gmap.linhas.forEach(function (l) {
            if (l.lat == null || l.lng == null || l.pino_desatualizado) return;
            var lat = Number(l.lat), lng = Number(l.lng);
            if (!geoCoordValida(lat, lng)) return;
            var mk = L.circleMarker([lat, lng], { radius: 5 });
            mk.bindPopup(function () { return gmapPopup(l); });
            gmap.marcadores[l.documento] = mk; pts.push([lat, lng]);
        });
        if (pts.length && !geo.ajustou) { mapaClientes.fitBounds(pts, { padding: [30, 30], maxZoom: 12 }); geo.ajustou = true; }
    }

    // ---- totais por região para a data escolhida ----
    function gmapResumoTempo() {
        var alvo = $('#geo-resumo-tempo');
        if (!alvo || !gmapAtivo()) { if (alvo) alvo.innerHTML = ''; return; }
        var i = gmap.idx, porReg = {}, fora = { n: 0, v: 0, c: 0 };
        gmap.linhas.forEach(function (l) {
            if (!l._pm || l._pm > gmap.meses[i]) return;
            if (l._reg === undefined) l._reg = geoClassificar({ bairro: l.bairro, cidade: l.cidade, uf: l.estado }) || null;
            var o = l._reg ? (porReg[l._reg.id] || (porReg[l._reg.id] = { n: 0, v: 0, c: 0 })) : fora;
            o.n++; o.v += l._ac[i]; o.c += l._cu[i];
        });
        var linhas = dados.regioes.filter(function (r) { return porReg[r.id]; }).map(function (r) {
            var o = porReg[r.id];
            return '<tr><td>' + esc(r.nome) + '</td><td>' + (r.ativo ? 'Entrega' : 'Sem entrega') + '</td><td class="num">' + NUM.format(o.n) + '</td><td class="num">' + esc(brl(o.v)) + '</td><td class="num">' + NUM.format(o.c) + '</td></tr>';
        }).join('');
        alvo.innerHTML = '<div class="adm-card p-5 mb-5"><p class="font-bold mb-1">Clientes CNPJ por região até ' + esc(gmapMesRot(gmap.meses[i])) + '</p>' +
            '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">Só clientes CNPJ com compra até a data escolhida (valores acumulados). A tabela “dentro e fora de cada região” abaixo continua mostrando todos os cadastros do ERP hoje.</p>' +
            '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Região</th><th>Situação</th><th class="num">Clientes</th><th class="num">Vendido até a data</th><th class="num">Compras</th></tr></thead><tbody>' + linhas +
            '<tr><td><strong>Fora das regiões cadastradas</strong></td><td>—</td><td class="num">' + NUM.format(fora.n) + '</td><td class="num">' + esc(brl(fora.v)) + '</td><td class="num">' + NUM.format(fora.c) + '</td></tr>' +
            '</tbody></table></div></div>';
    }

    // ---- controles: linha do tempo + localizar ----
    function gmapControlesHtml() {
        if (papel !== 'admin') return '';
        var cab = '<div class="flex items-center gap-2 mb-2">' + SELO_ERP + '<p class="font-bold text-sm">Expansão: um pino por cliente CNPJ</p></div>';
        if (gmap.carregando && !gmap.carregado) return cab + '<p class="adm-vazio-linha"><i class="fa-solid fa-spinner fa-spin"></i><span class="adm-vazio-texto">Carregando clientes do mapa…</span></p>';
        if (gmap.ausente) return cab + cartaoVazio('Mapa de expansão ainda não instalado', 'As funções da migração 033 não existem neste banco; mostrando o mapa por bairro.', 'erp');
        if (gmap.erro) return cab + '<p class="adm-vazio-linha"><span class="adm-vazio-titulo">Não foi possível carregar o mapa de expansão</span><span class="adm-vazio-texto">' + esc(gmap.erro) + '</span>' +
            '<button type="button" class="adm-botao-fantasma" id="gmap-tentar">Tentar de novo</button></p>';
        if (!gmap.carregado) return '';
        if (!gmap.linhas.length || !gmap.meses.length) return cab + cartaoVazio('Nenhum cliente CNPJ com compras no mapa ainda', 'Quando houver compras ligadas a clientes CNPJ, os pinos aparecem aqui.', 'erp');
        var red = gmapReduzMov();
        return cab +
            '<div class="flex items-center flex-wrap gap-3 mb-3">' +
                '<button type="button" class="adm-botao-fantasma" id="geo-tl-play" aria-label="Reproduzir crescimento"' + (red ? ' disabled title="Reprodução desativada (movimento reduzido): use o controle deslizante"' : '') + '><i class="fa-solid fa-play"></i></button>' +
                '<input type="range" id="geo-tl-barra" class="adm-range" min="0" max="' + (gmap.meses.length - 1) + '" step="1" value="' + gmap.idx + '" aria-label="Mês da linha do tempo">' +
            '</div>' +
            '<p class="text-sm font-bold mb-3" id="geo-tl-rotulo" role="status" aria-live="polite"></p>' +
            '<div class="flex items-center flex-wrap gap-3 mb-3">' +
                '<button type="button" class="adm-botao" id="geo-pend-btn">Localizar endereços novos</button>' +
                '<button type="button" class="adm-botao-fantasma hidden" id="geo-pend-parar">Parar</button>' +
                '<progress id="geo-pend-prog" class="adm-progresso hidden" max="100" value="0"></progress>' +
                '<span class="text-xs" id="geo-pend-status" role="status" style="color:var(--adm-tinta-3)"></span>' +
            '</div>';
    }

    function gmapLigar() {
        var t = $('#gmap-tentar'); if (t) t.addEventListener('click', carregarMapaClientes);
        var barra = $('#geo-tl-barra');
        if (barra) barra.addEventListener('input', function () { gmapParar(); gmap.idx = Number(barra.value) || 0; gmap.fixouIdx = true; gmapPinosAtualizar(); });
        var play = $('#geo-tl-play');
        if (play) play.addEventListener('click', function () { if (gmap.tocando) gmapParar(); else gmapTocar(); });
        var b = $('#geo-pend-btn'); if (b) b.addEventListener('click', gmapGeocodificar);
        var p = $('#geo-pend-parar'); if (p) p.addEventListener('click', function () { gmap.run.parar = true; if (geo.abortar) { try { geo.abortar(); } catch (e) { /* já encerrada */ } } gmapUI(); });
        gmapUI();
    }

    function gmapTocar() {
        if (gmapReduzMov() || !gmapAtivo()) return;
        if (gmap.idx >= gmap.meses.length - 1) gmap.idx = 0;
        gmap.tocando = true; gmap.fixouIdx = true; gmapUIPlay();
        gmap.timer = setInterval(function () {
            if (!gmapAtivo() || !$('#geo-tl-barra') || !usuario || papel !== 'admin' || !secaoVisivel('regioes')) { gmapParar(); return; }
            if (gmap.idx >= gmap.meses.length - 1) { gmapParar(); return; }
            gmap.idx++; gmapPinosAtualizar();
        }, GMAP_PASSO_MS);
        gmapPinosAtualizar();
    }
    function gmapParar() {
        if (gmap.timer) { clearInterval(gmap.timer); gmap.timer = null; }
        if (gmap.tocando) { gmap.tocando = false; gmapUIPlay(); }
    }
    function gmapUIPlay() {
        var p = $('#geo-tl-play');
        if (p) { p.innerHTML = '<i class="fa-solid ' + (gmap.tocando ? 'fa-pause' : 'fa-play') + '"></i>'; p.setAttribute('aria-label', gmap.tocando ? 'Pausar' : 'Reproduzir crescimento'); }
    }

    function gmapUI() {
        var R = gmap.run, b = $('#geo-pend-btn'), p = $('#geo-pend-parar'), pr = $('#geo-pend-prog'), st = $('#geo-pend-status');
        if (!b) return;
        var n = gmap.pend;
        b.textContent = 'Localizar endereços novos' + (n == null ? '' : ' (' + (n >= 500 ? '500+' : NUM.format(n)) + ')');
        b.disabled = R.rodando || geo.rodando || !n;
        if (p) p.classList.toggle('hidden', !R.rodando);
        if (pr) { pr.classList.toggle('hidden', !R.rodando); pr.max = Math.max(1, R.total); pr.value = R.feitos; }
        if (st) st.textContent = R.rodando ? 'Localizando ' + NUM.format(R.feitos) + ' de ' + NUM.format(R.total) + '… (1 por segundo)'
            : (R.msg || (gmap.pendErro === 'ausente' ? 'Pendências indisponíveis (migração 033).' : gmap.pendErro ? 'Falha ao consultar pendências: ' + gmap.pendErro : n === 0 ? 'Todos os endereços já foram localizados.' : ''));
    }

    // ---- geocodificação (Nominatim): 1 req/s, só pendentes, por clique ----
    // Trava entre abas: navigator.locks (posse real, solta sozinha se a aba fechar). Sem suporte: NÃO geocodifica (falha fechado).
    var GEO_TRAVA = 'temprio-geo-nominatim';
    function geoTravaOk() { return typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function'; }
    // Espaçamento de 1 req/s GLOBAL (vale entre donos da trava e entre abas): último início guardado também no localStorage.
    function geoUltimo() {
        var a = geo.ultimoInicio || 0;
        try { var b = Number(localStorage.getItem('temprio_geo_ultimo')) || 0; if (b > a) a = b; } catch (e) { /* só o relógio desta aba */ }
        return a;
    }
    // Antes de SOLTAR a trava, cumpre o que falta do intervalo desde a última requisição desta aba: o 1 req/s entre donos
    // não depende do localStorage (que pode estar bloqueado).
    function geoResfriar() {
        var resto = GEO_INTERVALO_MS - (Date.now() - (geo.ultimoInicio || 0));
        return new Promise(function (res) { setTimeout(res, Math.max(0, resto)); });
    }
    function geoMarcarInicio() {
        geo.ultimoInicio = Date.now();
        try { localStorage.setItem('temprio_geo_ultimo', String(geo.ultimoInicio)); } catch (e) { /* idem */ }
    }
    // Espera o intervalo e, ANTES de liberar a consulta, revalida parada/sessão (cancelado = nenhuma requisição é feita).
    function geoEsperar(sess) {
        var espera = GEO_INTERVALO_MS - (Date.now() - geoUltimo());
        return new Promise(function (res) { setTimeout(res, Math.max(0, espera)); }).then(function () {
            if (gmap.run.parar || sess !== gmap.sessao || !usuario || papel !== 'admin') { var c = new Error('cancelado'); c.cancelado = true; throw c; }
            geoMarcarInicio();
        });
    }
    function gmapDentro(p, x) {
        if (String(p.estado || '').toUpperCase() !== 'RJ') return true;
        return x.lat >= -23.5 && x.lat <= -20.6 && x.lng >= -45 && x.lng <= -40.8;
    }
    // Resolve: {lat,lng} | null (nada achado) | undefined (falha de rede: não grava, fica pendente)
    function gmapNominatim(params, exigeRua, sess) {
        var R = gmap.run;
        return geoEsperar(sess).then(function () {
            return geoBuscar('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&addressdetails=1&' + params);
        }).then(function (res) {
            R.falhas = 0;
            var x = res && res[0]; if (!x) return null;
            var lat = Number(x.lat), lng = Number(x.lon);
            if (!geoCoordValida(lat, lng)) return null;
            if (exigeRua && !(x.address && x.address.road)) return null;
            return { lat: lat, lng: lng };
        }, function (e) {
            if (e && e.cancelado) return undefined; // parado antes de consultar: não conta como falha
            var m = String(e && e.message || '');
            if (/HTTP (429|403)/.test(m)) { var er = new Error('O OpenStreetMap bloqueou as consultas (' + m + '). Pare por agora e tente mais tarde.'); er.parada = true; throw er; }
            if (R.parar) return undefined;
            R.falhas++;
            if (R.falhas >= 3) { var e2 = new Error('Busca interrompida por falhas de rede.'); e2.parada = true; throw e2; }
            return undefined;
        });
    }
    function gmapEnc(s) { return encodeURIComponent(String(s == null ? '' : s).trim()); }

    function gmapResolver(p, sess) {
        var R = gmap.run, base = { documento: p.documento, fonte: 'nominatim', chave_endereco: p.chave_endereco };
        function achou(x, prec) { return { documento: base.documento, lat: Math.round(x.lat * 1e6) / 1e6, lng: Math.round(x.lng * 1e6) / 1e6, precisao: prec, fonte: 'nominatim', chave_endereco: base.chave_endereco }; }
        var cidade = '&city=' + gmapEnc(p.cidade) + '&state=' + gmapEnc(p.estado);
        var cep = docDigitos(p.cep);
        function etapa1() {
            if (R.parar || !String(p.logradouro || '').trim()) return Promise.resolve(null);
            var rua = (String(p.numero || '').trim() ? String(p.numero).trim() + ' ' : '') + String(p.logradouro).trim();
            return gmapNominatim('street=' + gmapEnc(rua) + cidade + (cep.length === 8 ? '&postalcode=' + cep : ''), true, sess).then(function (x) {
                return x === undefined ? undefined : (x && gmapDentro(p, x) ? achou(x, 'endereco') : null);
            });
        }
        function etapa2() {
            if (R.parar || cep.length !== 8) return Promise.resolve(null);
            return gmapNominatim('postalcode=' + cep + cidade, false, sess).then(function (x) {
                return x === undefined ? undefined : (x && gmapDentro(p, x) ? achou(x, 'cep') : null);
            });
        }
        function etapa3() {
            if (R.parar || !String(p.bairro || '').trim()) return Promise.resolve(null);
            var chave = geoNorm(p.bairro) + '|' + geoNorm(p.cidade) + '|' + String(p.estado || '').toUpperCase(), c = geoLerCache()[chave];
            if (c && geoCoordValida(c.lat, c.lng) && gmapDentro(p, c)) return Promise.resolve(achou(c, 'bairro')); // cache local de bairros: sem requisição
            return gmapNominatim('q=' + gmapEnc([p.bairro, p.cidade, p.estado, 'Brasil'].filter(Boolean).join(', ')), false, sess).then(function (x) {
                if (x === undefined) return undefined;
                if (x && gmapDentro(p, x)) {
                    var cc = geoLerCache(); cc[chave] = { lat: x.lat, lng: x.lng, ts: Date.now() }; geoGravarCache(cc);
                    return achou(x, 'bairro');
                }
                return null;
            });
        }
        return etapa1().then(function (r) {
            if (r === undefined) return null;          // falha de rede: segue sem gravar
            if (r) return r;
            return etapa2().then(function (r2) {
                if (r2 === undefined) return null;
                if (r2) return r2;
                return etapa3().then(function (r3) {
                    if (r3 === undefined) return null;
                    if (r3) return r3;
                    if (R.parar) return null;
                    return { documento: base.documento, lat: null, lng: null, precisao: 'nao_encontrado', fonte: 'nominatim', chave_endereco: base.chave_endereco };
                });
            });
        });
    }

    function gmapGeocodificar() {
        var R = gmap.run;
        if (R.rodando || geo.rodando || papel !== 'admin') return;
        if (!geoTravaOk()) { R.msg = 'Este navegador não permite a trava entre abas (navigator.locks); por segurança a localização não roda aqui.'; gmapUI(); return; }
        var sess = gmap.sessao;
        R.rodando = true; R.parar = false; R.feitos = 0; R.total = 0; R.gravados = 0; R.ignorados = 0; R.falhas = 0; R.msg = ''; R.descartar = false;
        gmapUI();
        navigator.locks.request(GEO_TRAVA, { ifAvailable: true }, function (trava) {
            if (!trava) { R.rodando = false; R.msg = 'Outra aba (ou o mapa por bairro) já está localizando endereços.'; gmapUI(); return null; }
            return gmapExecutar(sess).then(geoResfriar, geoResfriar);
        });
    }

    function gmapExecutar(sess) {
        var R = gmap.run, lote = [];
        function viva() { return sess === gmap.sessao && !!usuario; }
        function gravar() {
            if (!lote.length || R.descartar || !viva()) { lote = []; return Promise.resolve(); }
            var itens = lote; lote = [];
            return sb.rpc('solidcon_gravar_geo_clientes', { p_itens: itens }).then(function (g) {
                if (g.error) throw g.error;
                R.gravados += (g.data && Number(g.data.gravados)) || 0;
                R.ignorados += (g.data && g.data.ignorados && g.data.ignorados.length) || 0;
            });
        }
        return sb.rpc('solidcon_geo_pendentes', { p_limite: GMAP_LOTE_CLIQUE }).then(function (r) {
            if (r.error) throw r.error;
            var fila = r.data || [];
            R.total = fila.length; gmapUI();
            function proximo(i) {
                if (R.parar || !viva() || i >= fila.length) return gravar();
                return gmapResolver(fila[i], sess).then(function (item) {
                    if (item && !R.parar && viva()) lote.push(item);   // consulta que terminou depois de Parar não é gravada
                    R.feitos = i + 1; gmapUI();
                    return lote.length >= GMAP_LOTE_GRAVAR ? gravar() : null;
                }).then(function () { return proximo(i + 1); });
            }
            return proximo(0);
        }).catch(function (e) {
            R.msg = e && e.parada ? e.message : 'Falha ao localizar: ' + String(e && e.message || e);
            return gravar().catch(function () { /* o erro principal já está na tela */ });
        }).then(function () {
            R.rodando = false;
            if (!viva()) { R.parar = false; return; }
            if (!R.msg) R.msg = NUM.format(R.gravados) + ' endereço(s) gravado(s)' + (R.ignorados ? ', ' + NUM.format(R.ignorados) + ' ignorado(s) pelo banco' : '') + (R.parar ? ' (parado)' : '') + '.';
            R.parar = false;
            carregarMapaClientes();
        });
    }

    // Sair do painel / deixar Regiões: encerra play, fila de geocodificação, esperas e fetch em andamento; invalida callbacks antigos.
    function gmapEncerrar(descartar) {
        gmapParar();
        gmap.sessao++;
        var R = gmap.run;
        if (R.rodando) { R.parar = true; if (descartar) R.descartar = true; if (geo.abortar) { try { geo.abortar(); } catch (e) { /* já encerrada */ } } }
        if (geo.rodando) geoParar();
    }

    function desenharTudo() {
        ABAS.forEach(function (a) { abasParaRedesenhar[a] = true; });
        desenharAbaSeSuja(abaAtual);
    }

    /* ===================================================================
     * Dashboard
     * =================================================================== */
    var receitaRapidaModo = 'mes';

    /* Soma confirmado+entregue por criado_em, no mesmo critério do resto do
     * painel (resumo_mensal usa a mesma regra). "Personalizado" reaproveita o
     * filtro global de data — não inventa um segundo par de campos de data. */
    function receitaRapida(modo) {
        var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        var de, ate;
        if (modo === 'hoje') { de = new Date(hoje); ate = null; }
        else if (modo === 'semana') { de = new Date(hoje); de.setDate(de.getDate() - 6); ate = null; }
        else if (modo === 'mes') { de = new Date(hoje.getFullYear(), hoje.getMonth(), 1); ate = null; }
        else { de = filtros.de ? new Date(filtros.de + 'T00:00:00') : null;
               ate = filtros.ate ? new Date(filtros.ate + 'T23:59:59') : null; }

        var total = 0, qtd = 0;
        dados.pedidos.forEach(function (p) {
            if (p.status !== 'confirmado' && p.status !== 'entregue') return;
            var d = new Date(p.criado_em);
            if (de && d < de) return;
            if (ate && d > ate) return;
            total += Number(p.valor_centavos);
            qtd++;
        });
        return { total: total, qtd: qtd };
    }

    function desenharCardReceita() {
        var r = receitaRapida(receitaRapidaModo);
        var rotulos = { hoje: 'hoje', semana: 'nos últimos 7 dias', mes: 'este mês', personalizado: 'no período personalizado' };
        $('#receita-valor').textContent = brl(r.total);
        $('#receita-nota').textContent = NUM.format(r.qtd) + (r.qtd === 1 ? ' pedido confirmado ' : ' pedidos confirmados ') + rotulos[receitaRapidaModo];
    }

    /* Receita por dia dos últimos `dias` dias — usa dados.pedidos já
     * carregado, sem ida nova ao banco. Com o filtro de período em "3 meses"
     * ou mais, os últimos 30 dias sempre estão cobertos. */
    function receitaPorDia(dias) {
        var porDia = {};
        var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        for (var i = dias - 1; i >= 0; i--) {
            var d = new Date(hoje); d.setDate(d.getDate() - i);
            porDia[d.toISOString().slice(0, 10)] = 0;
        }
        dados.pedidos.forEach(function (p) {
            if (p.status !== 'confirmado' && p.status !== 'entregue') return;
            var k = String(p.criado_em).slice(0, 10);
            if (k in porDia) porDia[k] += Number(p.valor_centavos);
        });
        return Object.keys(porDia).sort().map(function (k) {
            var d = new Date(k + 'T00:00:00');
            return { rotulo: String(d.getDate()) + '/' + String(d.getMonth() + 1), valor: porDia[k], data: k };
        });
    }

    /* ===================================================================
     * Hoje — "Precisa de você agora", 4 KPIs do mês e 1 gráfico de vendas (6 meses).
     * Só usa o que as abas de origem já calculam (mesmo cache, mesmas funções); carrega em fila serial, uma fonte por vez.
     * Cada item só aparece para quem já vê aquela informação hoje (admin x vendedor inalterado). Sem dado = linha discreta.
     * =================================================================== */
    var dash = { iniciado: false, rodando: false };

    function dashAtualizarResumo() {
        if (secaoVisivel('dashboard') && $('#hoje')) desenharHoje();
        else abasParaRedesenhar.dashboard = true;
    }

    // Carrega, um após o outro, o que o Hoje usa. Não repete o que já está em cache (salvo forcar).
    function dashCarregarProgressivo(forcar) {
        if (dash.rodando) return;
        var adm = papel === 'admin';
        var passos = [];
        if (adm) passos.push([vend, carregarVendas]);
        passos.push([cmp, carregarCompras]);
        passos.push([scli, carregarSolidClientes]);
        if (adm) { passos.push([solid, carregarSolidcon]); passos.push([giro, carregarGiro]); passos.push([ins, carregarInsumos]); passos.push([rec, carregarReceber]); }
        dash.rodando = true;
        (function prox(i) {
            if (i >= passos.length) { dash.rodando = false; return; }
            var o = passos[i][0];
            var precisa = forcar ? !o.carregando : (!o.carregado && !o.carregando && !o.ausente && !o.erro);
            if (!precisa) { prox(i + 1); return; }
            var p;
            try { p = passos[i][1](); } catch (e) { p = null; }
            Promise.resolve(p).then(function () { prox(i + 1); }, function () { prox(i + 1); });
        })(0);
    }

    // Single-flight: clique repetido em "Tentar de novo" não dispara consulta enquanto a anterior roda.
    function resUma(o, fn) { return function () { if (!o.carregando) fn(); }; }
    var RES_CARREGADORES = { vend: resUma(vend, carregarVendas), cmp: resUma(cmp, carregarCompras), scli: resUma(scli, carregarSolidClientes),
                             solid: resUma(solid, carregarSolidcon), giro: resUma(giro, carregarGiro), ent: resUma(ent, carregarEntradas), ins: resUma(ins, carregarInsumos),
                             pag: resUma(pag, carregarPagamentos), geo: resUma(geo, carregarGeoClientes) };

    function resMotivo(o) {
        return o.ausente ? 'ainda não instalado' : o.erro ? 'falha ao carregar' : o.truncado ? 'histórico grande demais' : 'carregando…';
    }

    // HTML de estado (carregando / ausente / erro / limite) ou null quando os dados estão utilizáveis.
    function resEstado(o, rotulo, chave) {
        if (o.ausente) return '<p class="text-sm" style="color:var(--adm-tinta-3)">' + esc(rotulo) + ': ainda não instalado neste banco.</p>';
        if (o.erro && !o.carregando) return '<p class="text-sm mb-2" style="color:var(--adm-tinta-2)">Não foi possível carregar ' + esc(rotulo) + ': ' + esc(o.erro) + '</p>' +
            '<button type="button" class="adm-botao-fantasma" data-res-tentar="' + chave + '">Tentar de novo</button>';
        if (o.truncado && !o.carregando) return '<p class="text-sm" style="color:var(--adm-tinta-3)">' + esc(rotulo) + ': histórico grande demais para o painel; indicadores indisponíveis.</p>';
        if (!o.carregado || o.erro || o.truncado) return '<p class="text-sm" style="color:var(--adm-tinta-2)"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando ' + esc(rotulo) + '…</p>';
        return null;
    }

    function resSeguro(fn) {
        try { return fn(); } catch (e) {
            if (window.console) console.error('[painel] hoje:', e);
            return '<div class="adm-card p-5"><p class="text-sm" style="color:var(--adm-tinta-3)">Não foi possível montar este bloco.</p></div>';
        }
    }

    function resKpi(rot, val, nota) {
        return '<div class="adm-card p-4"><p class="adm-tile-rotulo mb-1">' + esc(rot) + '</p><p class="adm-tile-valor">' + esc(val) + '</p>' +
               (nota ? '<p class="text-xs mt-1" style="color:var(--adm-tinta-3)">' + esc(nota) + '</p>' : '') + '</div>';
    }

    function pronto(o) { return o.carregado && !o.erro && !o.ausente && !o.truncado; }

    // "Precisa de você agora": só entram itens com algo a fazer; fontes indisponíveis viram uma linha discreta.
    function hojeAgora() {
        var itens = [], discretos = [], adm = papel === 'admin';
        function item(icone, cor, txt, nav) {
            itens.push('<li><button type="button" class="adm-agora" data-ir-aba="' + nav + '"><i class="fa-solid ' + icone + '" style="color:' + cor + '"></i>' +
                '<span class="flex-1">' + esc(txt) + '</span><i class="fa-solid fa-chevron-right text-xs" style="color:var(--adm-tinta-3)"></i></button></li>');
        }
        var ag = dados.pedidos.filter(function (p) { return p.status === 'aguardando'; }).length;
        if (ag) item('fa-hourglass-half', 'var(--adm-atencao)', NUM.format(ag) + (ag === 1 ? ' pedido aguardando confirmação' : ' pedidos aguardando confirmação'), 'pedidos');
        var fat = erpv.res ? erpv.res.resumo.paraConfirmar : 0;
        if (fat) item('fa-file-invoice-dollar', 'var(--adm-ok)', NUM.format(fat) + (fat === 1 ? ' pedido já faturado no ERP para confirmar' : ' pedidos já faturados no ERP para confirmar'), 'pedidos');
        else if (erpv.erro && ag) discretos.push('Vendas do ERP para os pedidos: falha ao carregar');

        if (pronto(scli)) {
            var faltam = {}; // clientes distintos (documento tipado), não pedidos
            dados.pedidos.forEach(function (p) {
                if (cadastroErpDoPedido(p) !== 'falta') return;
                faltam[docNorm(p.cnpj, 'cnpj')] = true; // pedidos só têm CNPJ (admin/supabase.sql: cnpj not null)
            });
            var nf = Object.keys(faltam).length;
            if (nf) item('fa-user-plus', 'var(--adm-atencao)', NUM.format(nf) + (nf === 1 ? ' cliente a cadastrar no ERP antes de faturar' : ' clientes a cadastrar no ERP antes de faturar'), 'pedidos');
        } else discretos.push('Cadastros do ERP: ' + resMotivo(scli));

        if (adm) {
            if (pronto(rec)) {
                var A = recAgregar(), nc = A.cnpjs.filter(function (g) { return g.vencido > 0; }).length, outros = (A.pf && A.pf.vencido > 0) || (A.sd && A.sd.vencido > 0);
                if (A.tot.vencido > 0) item('fa-file-invoice-dollar', 'var(--adm-ruim)', brl(A.tot.vencido) + ' em parcelas vencidas' +
                    (nc ? ' · ' + NUM.format(nc) + (nc === 1 ? ' cliente CNPJ' : ' clientes CNPJ') : '') + (outros ? ' · e pessoa física/sem documento' : ''), 'clientes');
            } else if (!rec.ausente) discretos.push('Contas a receber: ' + resMotivo(rec));

            var partes = [];
            if (pronto(solid) && pronto(giro)) {
                if (giro.linhas.length) {
                    var crit = giroItensCobertura().filter(function (i) { return !i.semGiro && i.dias <= GIRO_CRITICO; }).length;
                    if (crit) partes.push(NUM.format(crit) + (crit === 1 ? ' sabor acaba' : ' sabores acabam') + ' em até ' + GIRO_CRITICO + ' dias');
                }
            } else discretos.push('Estoque e giro: ' + resMotivo(!pronto(solid) ? solid : giro));
            if (pronto(ins)) {
                var n = insContagens(insItens()), ni = n.negativo + n.zerado;
                if (ni) partes.push(NUM.format(ni) + (ni === 1 ? ' insumo zerado/negativo' : ' insumos zerados/negativos'));
            } else if (!ins.ausente) discretos.push('Estoque da fábrica: ' + resMotivo(ins));
            if (partes.length) item('fa-boxes-stacked', 'var(--adm-ruim)', partes.join(' · '), 'estoque');
        }

        if (saude.itens.length) {
            var vm = saude.nivel >= 2;
            item(vm ? 'fa-circle-exclamation' : 'fa-triangle-exclamation', vm ? 'var(--adm-ruim)' : 'var(--adm-atencao)',
                'Integração SOLIDCON: ' + NUM.format(saude.itens.length) + (saude.itens.length === 1 ? ' aviso' : ' avisos') + ' — ' + saude.itens[0].txt, 'solidcon');
        }

        return '<ul class="adm-agora-lista">' + (itens.length ? itens.join('') :
                '<li class="text-sm flex items-center gap-2" style="color:var(--adm-tinta-2)"><i class="fa-solid fa-circle-check" style="color:var(--adm-ok)"></i>Nada pendente agora.</li>') + '</ul>' +
            (discretos.length ? '<p class="text-xs mt-2" style="color:var(--adm-tinta-3)">' + esc(discretos.join(' · ')) + '</p>' : '');
    }

    function hojeKpis() {
        var adm = papel === 'admin', atual = vendMesAtual(), k = [];
        var abertos = dados.pedidos.filter(function (p) { return p.status === 'aguardando' || p.status === 'confirmado'; });
        var aguard = abertos.filter(function (p) { return p.status === 'aguardando'; }).length;
        if (adm) {
            if (pronto(vend)) {
                var mf = vend.meses.filter(function (m) { return m.mes === atual; })[0], ma = vend.meses.filter(function (m) { return m.mes === vendMesAnterior(atual); })[0];
                var vf = mf ? vendNum(mf.valor_centavos) : 0, va = ma ? vendNum(ma.valor_centavos) : 0;
                var nota = va > 0 ? ((vf >= va ? '+' : '') + ((vf - va) / va * 100).toFixed(1).replace('.', ',') + '% vs ' + vendMesRotulo(vendMesAnterior(atual)) + ' inteiro') : 'sem mês anterior para comparar';
                k.push(resKpi('Vendas do mês (ERP)', brl(vf), nota + ' · mês parcial'));
            } else k.push(resKpi('Vendas do mês (ERP)', '—', 'vendas do ERP: ' + resMotivo(vend)));
        } else {
            var mesSite = atual.slice(0, 7);
            var fat = dados.resumo.filter(function (r) { return String(r.mes).slice(0, 7) === mesSite; })[0];
            k.push(resKpi('Faturamento do site no mês', brl(fat ? fat.faturamento_centavos : 0), 'pedidos confirmados ou entregues'));
        }
        if (cmpPronto()) {
            var d = cmpDadosMensais();
            k.push(d ? resKpi('Clientes ativos no mês', NUM.format(d.ativos[d.atual] || 0), NUM.format(d.novos[d.atual] || 0) + ' novos · ' + NUM.format(d.perdidos[d.atual] || 0) + ' perdidos')
                     : resKpi('Clientes ativos no mês', '0', 'nenhuma compra identificada'));
        } else k.push(resKpi('Clientes ativos no mês', '—', 'histórico de compras: ' + resMotivo(cmp)));
        k.push(resKpi('Pedidos abertos', NUM.format(abertos.length), NUM.format(aguard) + ' aguardando confirmação'));
        if (adm) {
            if (pronto(solid) && pronto(giro) && giro.linhas.length) {
                var it = giroItensCobertura(), crit = it.filter(function (i) { return !i.semGiro && i.dias <= GIRO_CRITICO; }).length;
                var aten = it.filter(function (i) { return !i.semGiro && i.dias > GIRO_CRITICO && i.dias <= GIRO_ATENCAO; }).length;
                k.push(resKpi('Itens críticos de estoque', NUM.format(crit), 'acabam em até ' + GIRO_CRITICO + ' dias · ' + NUM.format(aten) + ' em atenção'));
            } else {
                var fonte = !pronto(solid) ? ['estoque do ERP', resMotivo(solid)] : ['giro', pronto(giro) && !giro.linhas.length ? 'sem vendas' : resMotivo(giro)];
                k.push(resKpi('Itens críticos de estoque', '—', fonte[0] + ': ' + fonte[1]));
            }
        }
        return k;
    }

    // 1 gráfico: vendas por mês do ERP, últimos 6 meses (admin). O vendedor já vê o faturamento do site no "Detalhe do site".
    function hojeGrafico() {
        if (papel !== 'admin') return '';
        var est = resEstado(vend, 'vendas do ERP', 'vend');
        var corpo = est ? est
            : (!vend.meses.length ? '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhuma venda sincronizada ainda.</p>'
                : vendBarras(vendItensMes().slice(-6), 'Vendas por mês em reais, últimos 6 meses', 1));
        return '<div class="adm-card p-5 mt-5"><div class="flex items-start justify-between gap-3 mb-1"><p class="font-bold">Vendas por mês</p>' +
            '<button type="button" class="text-xs underline shrink-0" style="color:var(--adm-acao)" data-ir-aba="vendas">ver vendas →</button></div>' +
            '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">ERP SOLIDCON · últimos 6 meses · mês corrente em cinza (parcial)</p>' + corpo + '</div>';
    }

    function desenharHoje() {
        var alvo = $('#hoje');
        if (!alvo) return;
        var kpis = resSeguro(hojeKpis);
        alvo.innerHTML =
            '<p class="font-bold text-lg mb-3">Precisa de você agora</p>' + resSeguro(hojeAgora) +
            '<p class="font-bold text-lg mt-8 mb-3">O mês em números</p>' +
            '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">' + (Array.isArray(kpis) ? kpis.join('') : kpis) + '</div>' + resSeguro(hojeGrafico);
    }

    function desenharDashboard() {
        var alvo = $('#painel-dashboard');
        alvo.innerHTML = '<section id="hoje"></section>' +
            '<section class="mt-12 pt-8" style="border-top:1px solid var(--adm-borda)"><div class="mb-4"><p class="font-bold text-lg">Detalhe do site</p>' +
            '<p class="text-xs" style="color:var(--adm-tinta-3)">Faturamento, pedidos e receita por período — pedidos feitos pelo site.</p></div><div id="dash-site-corpo"></div></section>';
        alvo.querySelector('#hoje').addEventListener('click', function (ev) {
            var ir = ev.target.closest('[data-ir-aba]');
            if (ir) { trocarAba(ir.getAttribute('data-ir-aba'), true); window.scrollTo(0, 0); return; }
            var t = ev.target.closest('[data-res-tentar]');
            if (t) { var f = RES_CARREGADORES[t.getAttribute('data-res-tentar')]; if (f) f(); }
        });
        desenharHoje();
        desenharDashboardBase();
        if (!dash.iniciado) { dash.iniciado = true; dashCarregarProgressivo(false); }
    }

    function desenharDashboardBase() {
        var alvo = $('#dash-site-corpo');
        var resumo = dados.resumo;

        if (!resumo.length) {
            alvo.innerHTML = cartaoVazio(
                'Nenhum pedido ainda',
                'O painel começa a contar a partir do primeiro pedido enviado pelo site. ' +
                'Pedidos fechados antes disso estão só nas suas conversas do WhatsApp.'
            );
            return;
        }

        var mesAtual = new Date().toISOString().slice(0, 7);
        var doMes = resumo.filter(function (r) { return String(r.mes).slice(0, 7) === mesAtual; })[0]
                    || { faturamento_centavos: 0, iniciados: 0, confirmados: 0 };

        var totalFat = resumo.reduce(function (a, r) { return a + Number(r.faturamento_centavos); }, 0);
        var totalIni = resumo.reduce(function (a, r) { return a + Number(r.iniciados); }, 0);
        var totalCon = resumo.reduce(function (a, r) { return a + Number(r.confirmados); }, 0);
        var aguardando = dados.pedidos.filter(function (p) { return p.status === 'aguardando'; }).length;
        var ticket = totalCon ? Math.round(totalFat / totalCon) : 0;
        var conversao = totalIni ? Math.round((totalCon / totalIni) * 100) : 0;

        var seteDiasAtras = new Date(); seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
        var pedidos7d = dados.pedidos.filter(function (p) { return new Date(p.criado_em) >= seteDiasAtras; }).length;

        var novosClientesMes = dados.clientes.filter(function (c) {
            return String(c.criado_em).slice(0, 7) === mesAtual;
        }).length;

        var ultimos5 = dados.pedidos.slice(0, 5);

        alvo.innerHTML =
            // Um único número principal por tela.
            '<div class="adm-card p-6 mb-5">' +
                '<p class="adm-tile-rotulo mb-2">Faturamento confirmado neste mês</p>' +
                '<p class="adm-heroi">' + esc(brl(doMes.faturamento_centavos)) + '</p>' +
                '<p class="text-xs mt-3" style="color:var(--adm-tinta-3)">' +
                    'Somando apenas pedidos que você marcou como confirmado ou entregue.' +
                '</p>' +
            '</div>' +

            '<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-5">' +
                ficha('Total de clientes (mês)', NUM.format(novosClientesMes), 'cadastrados este mês') +
                ficha('Pedidos (7 dias)', NUM.format(pedidos7d), 'últimos 7 dias') +
                ficha('Aguardando confirmação', NUM.format(aguardando),
                      aguardando ? 'há pedidos na fila' : 'fila vazia') +
                ficha('Confirmados no período', NUM.format(totalCon), 'de ' + NUM.format(totalIni) + ' iniciados') +
                ficha('Ticket médio confirmado', brl(ticket), 'por pedido fechado') +
                ficha('Taxa de conversão', conversao + '%', 'do clique até a confirmação') +
            '</div>' +

            '<div class="adm-card p-5 mb-7">' +
                '<div class="flex items-start justify-between flex-wrap gap-3 mb-3">' +
                    '<div>' +
                        '<p class="font-bold text-sm mb-1">Receita</p>' +
                        '<p class="text-xs" style="color:var(--adm-tinta-3)">Pedidos confirmados ou entregues, por período rápido.</p>' +
                    '</div>' +
                    '<div class="flex gap-1">' +
                        '<button type="button" class="adm-chip is-ativo" data-receita-rapida="mes">Mês</button>' +
                        '<button type="button" class="adm-chip" data-receita-rapida="semana">Semana</button>' +
                        '<button type="button" class="adm-chip" data-receita-rapida="hoje">Hoje</button>' +
                        '<button type="button" class="adm-chip" data-receita-rapida="personalizado">Personalizado</button>' +
                    '</div>' +
                '</div>' +
                '<p id="receita-valor" class="adm-tile-valor" style="font-size:2rem"></p>' +
                '<p id="receita-nota" class="text-xs mt-1" style="color:var(--adm-tinta-3)"></p>' +
            '</div>' +

            cartaoGrafico('g-vendas30', 'Vendas — últimos 30 dias',
                'Receita confirmada por dia. Uma janela curta para ver picos e vales que o gráfico mensal esconde.',
                't-vendas30') +

            '<div class="adm-card p-5 mb-7">' +
                '<div class="flex items-center justify-between mb-4">' +
                    '<p class="font-bold text-sm">Últimos pedidos</p>' +
                    '<span class="text-xs" style="color:var(--adm-tinta-3)">atualiza sozinho quando chega um novo</span>' +
                '</div>' +
                (ultimos5.length
                    ? '<div class="space-y-2">' + ultimos5.map(linhaUltimoPedido).join('') + '</div>'
                    : '<p class="adm-vazio">Nenhum pedido no período.</p>') +
            '</div>' +

            cartaoGrafico('g-faturamento', 'Faturamento confirmado por mês',
                'Só pedidos confirmados ou entregues. Pedido aguardando não entra.',
                't-faturamento') +

            cartaoGrafico('g-pedidos', 'Pedidos iniciados por mês',
                'Quantos clientes clicaram em enviar — inclui os que não fecharam.',
                't-pedidos');

        desenharColunas($('#g-faturamento'), resumo.map(function (r) {
            return { rotulo: rotuloMes(r.mes), valor: Number(r.faturamento_centavos), extra: r };
        }), {
            formatarEixo: brlCurto,
            formatarRotulo: brlCurto,
            rotularMaior: true,
            descricao: 'Faturamento confirmado por mês',
            dica: function (d) {
                return '<strong>' + esc(d.rotulo) + '</strong><br>' + esc(brl(d.valor)) +
                       '<br>' + NUM.format(d.extra.confirmados) + ' pedidos confirmados';
            }
        });

        tabela($('#t-faturamento'), ['Mês', 'Faturamento', 'Confirmados', 'Iniciados'],
            resumo.map(function (r) {
                return [rotuloMes(r.mes), brl(r.faturamento_centavos),
                        NUM.format(r.confirmados), NUM.format(r.iniciados)];
            }), [false, true, true, true]);

        desenharColunas($('#g-pedidos'), resumo.map(function (r) {
            return { rotulo: rotuloMes(r.mes), valor: Number(r.iniciados), extra: r };
        }), {
            rotularMaior: true,
            descricao: 'Pedidos iniciados por mês',
            dica: function (d) {
                return '<strong>' + esc(d.rotulo) + '</strong><br>' +
                       NUM.format(d.valor) + ' iniciados<br>' +
                       NUM.format(d.extra.confirmados) + ' confirmados';
            }
        });

        tabela($('#t-pedidos'), ['Mês', 'Iniciados', 'Confirmados'],
            resumo.map(function (r) {
                return [rotuloMes(r.mes), NUM.format(r.iniciados), NUM.format(r.confirmados)];
            }), [false, true, true]);

        var v30 = receitaPorDia(30);
        desenharLinha($('#g-vendas30'), v30, {
            formatarEixo: brlCurto,
            descricao: 'Vendas confirmadas nos últimos 30 dias',
            dica: function (d) { return '<strong>' + esc(d.rotulo) + '</strong><br>' + esc(brl(d.valor)); }
        });
        tabela($('#t-vendas30'), ['Dia', 'Receita'], v30.map(function (d) {
            return [d.rotulo, brl(d.valor)];
        }), [false, true]);

        document.querySelectorAll('[data-receita-rapida]').forEach(function (b) {
            b.addEventListener('click', function () {
                document.querySelectorAll('[data-receita-rapida]').forEach(function (o) { o.classList.remove('is-ativo'); });
                b.classList.add('is-ativo');
                receitaRapidaModo = b.getAttribute('data-receita-rapida');
                desenharCardReceita();
            });
        });
        desenharCardReceita();
    }

    function linhaUltimoPedido(p) {
        return '<div class="flex items-center justify-between gap-3 py-2" style="border-bottom:1px solid var(--adm-borda)">' +
            '<div class="min-w-0">' +
                '<p class="text-sm font-bold truncate">' + esc(p.razao_social) + '</p>' +
                '<p class="text-xs" style="color:var(--adm-tinta-3)">' + esc(dataHora(p.criado_em)) + '</p>' +
            '</div>' +
            '<div class="text-right shrink-0">' +
                '<p class="text-sm font-bold">' + esc(brl(p.valor_centavos)) + '</p>' +
                selo(p.status) +
            '</div>' +
        '</div>';
    }

    function ficha(rotulo, valor, nota) {
        return '<div class="adm-card p-4">' +
               '<p class="adm-tile-rotulo mb-1.5">' + esc(rotulo) + '</p>' +
               '<p class="adm-tile-valor">' + esc(valor) + '</p>' +
               (nota ? '<p class="text-[0.65rem] mt-1.5" style="color:var(--adm-tinta-3)">' + esc(nota) + '</p>' : '') +
               '</div>';
    }

    /* Todo gráfico vem com a tabela equivalente, recolhida. Nenhum valor fica
     * acessível só por passar o mouse. */
    function cartaoGrafico(idGrafico, titulo, subtitulo, idTabela) {
        return '<div class="adm-card p-5 mb-5">' +
               '<p class="font-bold text-sm mb-1">' + esc(titulo) + '</p>' +
               '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">' + esc(subtitulo) + '</p>' +
               '<div id="' + idGrafico + '"></div>' +
               '<details class="mt-4">' +
               '<summary class="text-xs cursor-pointer" style="color:var(--adm-tinta-3)">Ver como tabela</summary>' +
               '<div id="' + idTabela + '" class="mt-3 overflow-x-auto"></div>' +
               '</details>' +
               '</div>';
    }

    function tabela(destino, colunas, linhas, numerica) {
        if (!destino) return;
        var html = '<table class="adm-tabela"><thead><tr>' +
            colunas.map(function (c, i) {
                return '<th' + (numerica && numerica[i] ? ' style="text-align:right"' : '') + '>' + esc(c) + '</th>';
            }).join('') +
            '</tr></thead><tbody>' +
            linhas.map(function (l) {
                return '<tr>' + l.map(function (c, i) {
                    return '<td' + (numerica && numerica[i] ? ' class="num"' : '') + '>' + esc(c) + '</td>';
                }).join('') + '</tr>';
            }).join('') +
            '</tbody></table>';
        destino.innerHTML = html;
    }

    // Estado vazio discreto: UMA linha (tag de origem + título + texto em cinza); não ocupa altura de cartão.
    function cartaoVazio(titulo, texto, origem) {
        var ref = String(titulo || '') + ' ' + String(texto || '');
        var o = origem || (/erp|solidcon|instalad|rotina de|sincroniz|migra[cç][aã]o/i.test(ref) ? 'erp'
            : /pedido|venda|vitrine|lead|visita|espera|site/i.test(ref) ? 'site' : '');
        var tag = o === 'erp' ? SELO_ERP : o === 'site' ? SELO_SITE : '';
        return '<p class="adm-vazio-linha" title="' + esc(ref.trim()) + '">' + tag +
            '<span class="adm-vazio-titulo">' + esc(titulo) + '</span>' +
            (texto ? '<span class="adm-vazio-texto">' + esc(texto) + '</span>' : '') + '</p>';
    }

    /* ===================================================================
     * Pedidos — a fila que precisa de decisão
     * =================================================================== */
    var pedidosVista = 'kanban';

    // Raia "Vendas do ERP" (SOMENTE LEITURA): cupons recentes de solidcon_vendas_clientes (026), últimos 3 dias, mais novos primeiro.
    // Não arrasta, não grava, não entra nos filtros. CPF = "Consumidor final" (documento e nome nunca chegam à tela).
    var KV_DIAS = 3, KV_LIMITE = 60;
    var kv = { carregado: false, carregando: false, erro: null, ausente: false, itens: [], seq: 0 };

    function carregarKanbanErp() {
        var seq = ++kv.seq;
        kv.carregando = true;
        var desde = new Date(Date.now() - KV_DIAS * 86400000).toISOString();
        return sb.from('solidcon_vendas_clientes').select('dia,dt,documento,tipo,valor_centavos,cd_pdv,nr_cupom')
            .gte('dt', desde).order('dt', { ascending: false }).limit(KV_LIMITE).then(function (r) {
                if (seq !== kv.seq) return;
                kv.carregando = false;
                if (r.error) {
                    kv.ausente = solidTabelaAusente(r.error);
                    kv.erro = kv.ausente ? null : String(r.error.message || r.error);
                    kv.carregado = false; kv.itens = [];
                } else { kv.ausente = false; kv.erro = null; kv.carregado = true; kv.itens = r.data || []; }
                kvRedesenhar();
            }, function (e) {
                if (seq !== kv.seq) return;
                kv.carregando = false; kv.carregado = false; kv.erro = String(e && e.message || e); kv.itens = []; kvRedesenhar();
            });
    }
    function kvRedesenhar() { if (secaoVisivel('pedidos')) desenharPedidos(); else abasParaRedesenhar.pedidos = true; }

    // Cupons já casados com um pedido do site não repetem na raia (o selo "Faturado no ERP" já está no cartão do site).
    function kvLista() {
        var usados = {};
        if (erpv.res && erpv.res.porPedido) Object.keys(erpv.res.porPedido).forEach(function (id) {
            var r = erpv.res.porPedido[id];
            if (r && r.estado === 'casado' && r.venda) usados[r.venda.dia + '|' + r.venda.cd_pdv + '|' + r.venda.nr_cupom] = true;
        });
        return kv.itens.filter(function (v) { return !usados[v.dia + '|' + v.cd_pdv + '|' + v.nr_cupom]; });
    }
    function kvCnpjMascarado(doc) {
        var d = docNorm(doc, 'cnpj');
        return d ? '**.***.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-**' : '';
    }
    function kvCartao(v) {
        var cnpj = String(v.tipo || '').toLowerCase() === 'cnpj' && docNorm(v.documento, 'cnpj');
        var nome = 'Consumidor final', sub = '';
        if (cnpj) {
            var idx = cmpCadastros(), c = idx && idx[cnpj];
            nome = (c && c.nome) || 'Cliente CNPJ';
            sub = kvCnpjMascarado(v.documento);
        }
        return '<div class="adm-kanban-erpcartao">' +
            '<p class="text-sm font-bold truncate">' + esc(nome) + '</p>' +
            (sub ? '<p class="text-xs mt-0.5 truncate" style="color:var(--adm-tinta-3)">' + esc(sub) + '</p>' : '') +
            '<div class="flex items-center justify-between mt-2"><span class="text-sm font-bold">' + esc(brl(v.valor_centavos)) + '</span>' + SELO_ERP + '</div>' +
            '<p class="text-xs mt-1" style="color:var(--adm-tinta-3)">' + esc(dataHora(v.dt)) + ' · PDV ' + esc(String(v.cd_pdv == null ? '' : v.cd_pdv)) +
                ' · cupom ' + esc(String(v.nr_cupom == null ? '' : v.nr_cupom)) + '</p>' +
        '</div>';
    }
    function kvCorpo() {
        if (kv.carregando && !kv.carregado) return cartaoVazio('Carregando vendas do ERP…', '', 'erp');
        if (kv.ausente) return cartaoVazio('Vendas do ERP ainda não instaladas', 'A tabela solidcon_vendas_clientes (migração 026) não existe neste banco.', 'erp');
        if (kv.erro) return cartaoVazio('Vendas do ERP indisponíveis agora', 'Os pedidos do site seguem normais.', 'erp');
        var l = kvLista();
        if (!l.length) return cartaoVazio('Nenhuma venda do ERP nos últimos ' + KV_DIAS + ' dias', '', 'erp');
        return l.map(kvCartao).join('');
    }
    function kvTemCartoes() { return kv.carregado && !kv.erro && kvLista().length > 0; }
    var kanbanSegmento = 'aguardando'; // celular: uma coluna por vez
    var COLUNAS_KANBAN = [
        { status: 'aguardando', titulo: 'Aguardando' },
        { status: 'confirmado', titulo: 'Confirmado' },
        { status: 'entregue',   titulo: 'Entregue' },
        { status: 'cancelado',  titulo: 'Cancelado' }
    ];

    function desenharPedidosBase() {
        var alvo = $('#painel-pedidos');
        var filtrados = dados.pedidos.filter(pedidoPassaNoFiltro);

        var cabecalho =
            '<div class="flex items-center justify-between flex-wrap gap-3 mb-5">' +
                '<div class="flex gap-1">' +
                    '<button type="button" class="adm-chip' + (pedidosVista === 'kanban' ? ' is-ativo' : '') +
                        '" data-vista-pedidos="kanban"><i class="fa-solid fa-table-columns mr-1"></i>Kanban</button>' +
                    '<button type="button" class="adm-chip' + (pedidosVista === 'tabela' ? ' is-ativo' : '') +
                        '" data-vista-pedidos="tabela"><i class="fa-solid fa-list mr-1"></i>Tabela</button>' +
                '</div>' +
                botoesExportar('pedidos') +
            '</div>';

        if (!filtrados.length && !(pedidosVista === 'kanban' && kvTemCartoes())) {
            alvo.innerHTML = cabecalho + cartaoVazio('Nenhum pedido com esses filtros',
                dados.pedidos.length
                    ? 'Há ' + NUM.format(dados.pedidos.length) + ' pedidos no período — tente limpar os filtros acima.'
                    : 'Pedidos aparecem aqui assim que alguém enviar um pelo site.') +
                (pedidosVista === 'kanban' && (kv.erro || kv.ausente) ? kvCorpo() : ''); // estado do ERP não se perde no vazio
            ligarBotoesExportar(alvo, { pedidos: function () { exportarPedidosCSV(filtrados); } });
            ligarTrocaDeVista(alvo);
            return;
        }

        var notaErp = erpv.carregado
            ? '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)"><i class="fa-solid fa-file-invoice-dollar mr-1"></i>' + esc(ERPV_NOTA) +
              (erpv.res && erpv.res.resumo.paraConfirmar ? ' <strong style="color:var(--adm-tinta-2)">' + NUM.format(erpv.res.resumo.paraConfirmar) +
                  (erpv.res.resumo.paraConfirmar === 1 ? ' pedido já faturado no ERP para confirmar.' : ' pedidos já faturados no ERP para confirmar.') + '</strong>' : '') +
              (Object.keys(erpv.incompletos).length ? ' ' + NUM.format(Object.keys(erpv.incompletos).length) +
                  ' cliente(s) com vendas demais no período ficaram fora do casamento (aparecem como sempre).' : '') + '</p>'
            : erpv.erro ? '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">Vendas do ERP indisponíveis agora: os pedidos aparecem como sempre.</p>' : '';
        alvo.innerHTML = cabecalho + notaErp +
            (pedidosVista === 'kanban' ? htmlKanban(filtrados) : htmlTabelaPedidos(filtrados));

        if (pedidosVista === 'kanban') {
            ligarAcoesDeStatus(alvo); ligarDragDrop(alvo);
            alvo.querySelectorAll('[data-kanban-seg]').forEach(function (b) {
                b.addEventListener('click', function () {
                    kanbanSegmento = b.getAttribute('data-kanban-seg');
                    alvo.querySelectorAll('[data-kanban-seg]').forEach(function (o) {
                        var a = o === b; o.classList.toggle('is-ativo', a); o.setAttribute('aria-selected', String(a));
                    });
                    alvo.querySelectorAll('[data-kanban-col]').forEach(function (c) { c.classList.toggle('is-seg-ativa', c.getAttribute('data-kanban-col') === kanbanSegmento); });
                });
            });
        }
        else { ligarAcoesDeStatus(alvo); }

        ligarTrocaDeVista(alvo);
        ligarBotoesExportar(alvo, { pedidos: function () { exportarPedidosCSV(filtrados); } });
    }

    function ligarTrocaDeVista(raiz) {
        raiz.querySelectorAll('[data-vista-pedidos]').forEach(function (b) {
            b.addEventListener('click', function () {
                pedidosVista = b.getAttribute('data-vista-pedidos');
                desenharPedidos();
            });
        });
    }

    function exportarPedidosCSV(lista) {
        exportarCSV('pedidos', ['Data', 'Cliente', 'CNPJ', 'Cidade', 'UF', 'Status', 'Potes', 'Caixas', 'Valor'],
            lista.map(function (p) {
                return [dataHora(p.criado_em), p.razao_social, p.cnpj, p.cidade, p.uf,
                        STATUS[p.status] ? STATUS[p.status].rotulo : p.status,
                        p.potes, p.caixas, brl(p.valor_centavos)];
            }));
    }

    /* ===================================================================
     * Pedidos — Kanban
     *
     * Arrastar um cartão para outra coluna muda o status — a mesma chamada
     * que os botões da view em lista já fazem, só disparada por soltar em vez
     * de clicar. "Enviado" não é uma coluna: o banco não tem esse status (ver
     * a nota em admin/migracoes/010_realtime_pedidos.sql — decisão tomada
     * para não abrir uma divergência entre o Kanban e o resto do painel, que
     * já depende de aguardando/confirmado/entregue/cancelado em toda parte,
     * do dashboard ao resumo_mensal do banco).
     * =================================================================== */
    // Cartão novo entra com destaque; cartão que mudou de coluna desliza/pisca (comparado ao desenho anterior, sem depender dos filtros).
    var kanbanAnt = null, marcaKanban = {}, marcasValidas = {};
    function htmlKanban(lista) {
        var atual = {}, n = 0, agora = Date.now();
        dados.pedidos.forEach(function (p) { atual[p.id] = p.status; n++; });
        if (kanbanAnt && Object.keys(kanbanAnt).length) {
            dados.pedidos.forEach(function (p) {
                if (kanbanAnt[p.id] === undefined) marcasValidas[p.id] = { c: ' adm-kanban-novo', ate: agora + 4000 };
                else if (kanbanAnt[p.id] !== p.status) marcasValidas[p.id] = { c: ' adm-kanban-moveu', ate: agora + 4000 };
            });
        }
        marcaKanban = {}; // redesenhos seguidos (chegada de dados do ERP) mantêm o destaque por alguns segundos
        Object.keys(marcasValidas).forEach(function (k) {
            if (marcasValidas[k].ate < agora) delete marcasValidas[k]; else marcaKanban[k] = marcasValidas[k].c;
        });
        if (n) kanbanAnt = atual;
        return '<div class="adm-kanban-segmentos" role="tablist" aria-label="Status dos pedidos">' +
            COLUNAS_KANBAN.map(function (col) {
                var n = lista.filter(function (p) { return p.status === col.status; }).length;
                return '<button type="button" role="tab" class="adm-chip' + (kanbanSegmento === col.status ? ' is-ativo' : '') + '" data-kanban-seg="' + col.status +
                    '" aria-selected="' + (kanbanSegmento === col.status) + '">' + esc(col.titulo) + ' <span class="adm-kanban-contagem">' + n + '</span></button>';
            }).join('') +
            '<button type="button" role="tab" class="adm-chip' + (kanbanSegmento === 'erp' ? ' is-ativo' : '') + '" data-kanban-seg="erp" aria-selected="' + (kanbanSegmento === 'erp') +
                '">Vendas do ERP <span class="adm-kanban-contagem">' + (kv.carregado ? kvLista().length : '–') + '</span></button>' +
            '</div>' +
        '<div class="adm-kanban">' +
            COLUNAS_KANBAN.map(function (col) {
                var itens = lista.filter(function (p) { return p.status === col.status; });
                // Aguardando: já faturados no ERP primeiro (ordem estável: o resto mantém a ordem de chegada).
                if (col.status === 'aguardando') itens = itens.filter(erpCasado).concat(itens.filter(function (p) { return !erpCasado(p); }));
                return '<div class="adm-kanban-coluna' + (kanbanSegmento === col.status ? ' is-seg-ativa' : '') + '" data-kanban-col="' + col.status + '">' +
                    '<div class="adm-kanban-cabecalho">' +
                        '<span class="adm-kanban-titulo">' + esc(col.titulo) + '</span>' +
                        '<span class="adm-kanban-contagem">' + itens.length + '</span>' +
                    '</div>' +
                    '<div class="adm-kanban-corpo" data-coluna="' + col.status + '">' +
                        itens.map(function (p) { return cartaoKanban(p, marcaKanban[p.id] || ''); }).join('') +
                    '</div>' +
                '</div>';
            }).join('') +
            '<div class="adm-kanban-coluna adm-kanban-coluna-erp' + (kanbanSegmento === 'erp' ? ' is-seg-ativa' : '') + '" data-kanban-col="erp">' +
                '<div class="adm-kanban-cabecalho"><span class="adm-kanban-titulo">Vendas do ERP</span>' +
                    '<span class="adm-kanban-contagem">' + (kv.carregado ? kvLista().length : '–') + '</span></div>' +
                '<div class="adm-kanban-corpo-erp">' + kvCorpo() + '</div>' +
            '</div>' +
        '</div>';
    }

    function cartaoKanban(p, extra) {
        var destaque = p.status === 'aguardando' && erpCasado(p) ? ' adm-kanban-faturado' : '';
        return '<div class="adm-kanban-cartao' + destaque + (extra || '') + '" draggable="true" data-id="' + esc(p.id) +
                '" data-status-atual="' + esc(p.status) + '">' +
            '<div class="flex items-start justify-between gap-2">' +
                '<p class="text-sm font-bold truncate">' + esc(p.razao_social) + '</p>' +
                '<button type="button" class="shrink-0" data-ver-pedido="' + esc(p.id) + '" ' +
                    'style="color:var(--adm-tinta-3)" title="Ver detalhes"><i class="fa-regular fa-eye"></i></button>' +
            '</div>' +
            '<p class="text-xs mt-0.5 truncate" style="color:var(--adm-tinta-3)">' +
                esc((p.cidade || '') + '/' + (p.uf || '')) + '</p>' +
            '<div class="flex items-center justify-between mt-2">' +
                '<span class="text-sm font-bold">' + esc(brl(p.valor_centavos)) + '</span>' +
                (p.enviado_whatsapp
                    ? '<i class="fa-brands fa-whatsapp" style="color:var(--adm-bom)" title="Mensagem já enviada"></i>'
                    : '') +
            '</div>' +
            '<p class="text-xs mt-1 mb-2" style="color:var(--adm-tinta-3)">' + esc(dataHora(p.criado_em)) + '</p>' +
            (seloErpPedido(p) || seloCadastroErp(p) ? '<div class="mb-2 flex flex-wrap gap-1">' + seloErpPedido(p) + seloCadastroErp(p) + '</div>' : '') +
            '<div class="flex items-center gap-1 flex-wrap pt-2" style="border-top:1px solid var(--adm-borda)">' +
                acoesDeStatus(p) +
            '</div>' +
        '</div>';
    }

    function htmlTabelaPedidos(lista) {
        return '<div class="adm-card p-5">' +
            '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr>' +
                '<th>Data</th><th>Cliente</th><th>Praça</th><th>Status</th>' +
                '<th style="text-align:right">Valor</th><th>Ação</th>' +
            '</tr></thead><tbody>' +
            lista.map(function (p) {
                return '<tr style="cursor:pointer" data-ver-pedido="' + esc(p.id) + '">' +
                    '<td>' + esc(dataHora(p.criado_em)) + '</td>' +
                    '<td>' + esc(p.razao_social) + '</td>' +
                    '<td>' + esc((p.cidade || '') + '/' + (p.uf || '')) + '</td>' +
                    '<td>' + selo(p.status) + ' ' + seloErpPedido(p) + ' ' + seloCadastroErp(p) + '</td>' +
                    '<td class="num">' + esc(brl(p.valor_centavos)) + '</td>' +
                    '<td><div class="flex items-center gap-1 flex-wrap">' + acoesDeStatus(p) + '</div></td>' +
                '</tr>';
            }).join('') +
            '</tbody></table></div>' +
        '</div>';
    }

    function ligarDragDrop(raiz) {
        var arrastando = null;

        raiz.querySelectorAll('.adm-kanban-cartao').forEach(function (cartao) {
            cartao.addEventListener('dragstart', function (ev) {
                arrastando = cartao;
                cartao.classList.add('is-arrastando');
                ev.dataTransfer.effectAllowed = 'move';
                ev.dataTransfer.setData('text/plain', cartao.getAttribute('data-id'));
            });
            cartao.addEventListener('dragend', function () {
                cartao.classList.remove('is-arrastando');
                arrastando = null;
            });
        });

        raiz.querySelectorAll('.adm-kanban-corpo').forEach(function (corpo) {
            corpo.addEventListener('dragover', function (ev) {
                ev.preventDefault();
                ev.dataTransfer.dropEffect = 'move';
                corpo.classList.add('is-zona-de-solta');
            });
            corpo.addEventListener('dragleave', function () { corpo.classList.remove('is-zona-de-solta'); });
            corpo.addEventListener('drop', function (ev) {
                ev.preventDefault();
                corpo.classList.remove('is-zona-de-solta');
                if (!arrastando) return;

                var id = arrastando.getAttribute('data-id');
                var de = arrastando.getAttribute('data-status-atual');
                var para = corpo.getAttribute('data-coluna');
                if (de === para) return;

                if (para === 'cancelado' && !window.confirm('Cancelar este pedido?')) return;

                mudarStatus(id, para, arrastando);
            });
        });
    }

    function cartaoPedido(p) {
        var itens = Array.isArray(p.itens) ? p.itens : [];
        return '<div class="adm-card p-5">' +
            '<div class="flex items-start justify-between gap-4 flex-wrap mb-4">' +
                '<div>' +
                    '<p class="font-bold">' + esc(p.razao_social) + '</p>' +
                    '<p class="text-xs mt-0.5" style="color:var(--adm-tinta-3)">' +
                        'CNPJ ' + esc(p.cnpj) +
                        (p.inscricao_estadual ? ' · IE ' + esc(p.inscricao_estadual) : '') +
                    '</p>' +
                '</div>' +
                '<div class="text-right">' +
                    selo(p.status) + (seloCadastroErp(p) ? '<div class="mt-1.5">' + seloCadastroErp(p) + '</div>' : '') +
                    '<p class="text-xs mt-1.5" style="color:var(--adm-tinta-3)">' + esc(dataHora(p.criado_em)) + '</p>' +
                '</div>' +
            '</div>' +

            '<div class="grid sm:grid-cols-3 gap-4 text-xs mb-4">' +
                '<div>' +
                    '<p class="adm-tile-rotulo mb-1">Contato</p>' +
                    '<p>' + esc(p.responsavel) + '</p>' +
                    '<p style="color:var(--adm-tinta-2)">' + esc(p.telefone) + '</p>' +
                    (p.email ? '<p style="color:var(--adm-tinta-2)">' + esc(p.email) + '</p>' : '') +
                '</div>' +
                '<div>' +
                    '<p class="adm-tile-rotulo mb-1">Entrega</p>' +
                    '<p style="color:var(--adm-tinta-2)">' +
                        esc((p.logradouro || '') + (p.numero ? ', ' + p.numero : '')) +
                        (p.complemento ? ' - ' + esc(p.complemento) : '') + '<br>' +
                        esc((p.bairro || '') + ' · ' + (p.cidade || '') + '/' + (p.uf || '')) +
                        (p.cep ? '<br>CEP ' + esc(p.cep) : '') +
                    '</p>' +
                '</div>' +
                '<div>' +
                    '<p class="adm-tile-rotulo mb-1">Pedido</p>' +
                    '<p class="adm-tile-valor" style="font-size:1.25rem">' + esc(brl((p.valor_centavos || 0) + (Number(p.frete_centavos) || 0))) + '</p>' +
                    '<p style="color:var(--adm-tinta-2)">Produtos ' + esc(brl(p.valor_centavos)) +
                        ' · Frete ' + esc(brl(p.frete_centavos)) + '</p>' +
                    '<p style="color:var(--adm-tinta-2)">' + NUM.format(p.potes) + ' potes · ' +
                        NUM.format(p.caixas) + ' caixas</p>' +
                '</div>' +
            '</div>' +

            (itens.length
                ? '<details class="mb-4"><summary class="text-xs cursor-pointer" style="color:var(--adm-tinta-3)">' +
                  'Ver os ' + itens.length + ' sabores</summary>' +
                  '<ul class="mt-2 text-xs space-y-1" style="color:var(--adm-tinta-2)">' +
                  itens.map(function (i) {
                      return '<li>' + esc(i.nome) + ' — ' + esc(String(i.potes)) + ' potes' +
                             (i.caixas ? ' (' + esc(i.caixas) + ')' : '') + '</li>';
                  }).join('') + '</ul></details>'
                : '') +

            (p.observacoes
                ? '<p class="text-xs mb-4 p-3 rounded-lg" style="background:var(--adm-neutro-fundo);color:var(--adm-tinta-2)">' +
                  '<strong>Obs:</strong> ' + esc(p.observacoes) + '</p>'
                : '') +

            htmlErpPedido(p) +
            '<div id="bloco-solidcon" class="mb-4"></div>' +

            '<div class="flex items-center gap-2 flex-wrap pt-3" style="border-top:1px solid var(--adm-borda)">' +
                acoesDeStatus(p) +
                '<a href="https://wa.me/' + esc(String(p.telefone).replace(/\D/g, '').replace(/^/, '55')) + '"' +
                    ' target="_blank" rel="noopener" class="adm-botao-fantasma ml-auto">' +
                    '<i class="fa-brands fa-whatsapp mr-1"></i> Chamar' +
                '</a>' +
            '</div>' +
        '</div>';
    }

    /* ===================================================================
     * Dados para lançar no SOLIDCON
     *
     * O Marcio digita cada pedido do site no comercial do SOLIDCON. Este
     * bloco junta tudo o que ele precisa em um lugar só (+ "Copiar tudo"),
     * com o código do ERP de cada item (catalogo_produtos.codigo_erp, 024).
     * Não há registro manual de "lançado": quem diz que o pedido foi
     * faturado é o casamento com as vendas do ERP (selo "Faturado no ERP").
     * =================================================================== */
    function abrirPedido(p) {
        abrirModal(cartaoPedido(p));
        carregarBlocoSolidcon(p);
    }

    // Cliente do pedido já existe no ERP? Sem a lista do ERP (carregando, ausente ou erro) não afirma nada.
    // 'ja' | 'falta' | null (sem como afirmar: cancelado, fonte indisponível ou sem documento).
    function cadastroErpDoPedido(p) {
        if (p.status === 'cancelado' || scli.carregando || scli.erro || scli.ausente || !scli.carregado || !scli.docs) return null;
        // Pedidos só têm CNPJ (admin/supabase.sql: cnpj not null; não há coluna cpf em pedidos).
        if (!docNorm(p.cnpj, 'cnpj')) return null;
        return jaNoErp(p.cnpj, 'cnpj') ? 'ja' : 'falta';
    }

    function seloCadastroErp(p) {
        var st = cadastroErpDoPedido(p);
        if (!st) return '';
        return st === 'ja'
            ? '<span class="adm-selo adm-selo-erp" title="O CNPJ/CPF deste pedido tem cadastro no SOLIDCON">' +
              '<i class="fa-solid fa-link"></i>Já cadastrado no ERP</span>'
            : '<span class="adm-selo adm-selo-aguardando" title="Não há cadastro com este CNPJ/CPF no SOLIDCON">' +
              '<i class="fa-solid fa-user-plus"></i>Cadastrar no ERP antes de faturar</span>';
    }

    /* ===================================================================
     * Pedidos × vendas do ERP (Kanban, fase 1) — SOMENTE LEITURA
     *
     * Busca em solidcon_vendas_clientes (026) só os cupons dos CNPJs com pedido
     * aberto e casa com os pedidos pela regra de js/admin-erp-casamento.js
     * (mesma da migração 034). Só SUGERE: nada é gravado aqui; o botão
     * "Confirmar (faturado no ERP)" usa o mudarStatus de sempre. Pedido que
     * não casar fica exatamente como antes.
     * =================================================================== */
    var ERPV_LIMITE = 5000, ERPV_LOTE_DOCS = 100;
    // incompletos: CNPJs cujo lote bateu no teto (ERPV_LIMITE). Resultado parcial não prova que a venda é a única:
    // esses pedidos ficam FORA do casamento (aparecem como sempre), nunca viram "Faturado no ERP".
    var erpv = { carregado: false, carregando: false, erro: null, ausente: false, vendas: [], res: null, seq: 0, incompletos: {} };
    var ERPV_NOTA = 'O casamento usa as vendas registradas no ERP (cupons). Se um pedido não casar, ele fica como hoje.';
    var ERPV_MOTIVO = {
        varias_vendas: 'Mais de uma venda do cliente bate com este pedido',
        venda_disputada: 'A venda bate com mais de um pedido deste cliente',
        valor_diferente: 'Há venda do cliente no período, mas com valor diferente',
        varios_cupons: 'A soma de mais de um cupom bate com o pedido'
    };

    function erpvCalcular() {
        var C = window.TempRioErpCasamento;
        if (!C || !erpv.carregado) { erpv.res = null; return; }
        var inc = erpv.incompletos;
        erpv.res = C.casar(dados.pedidos.filter(function (p) { return !inc[C.docCnpj(p.cnpj)]; }), erpv.vendas);
    }

    function erpvRedesenhar() {
        if (secaoVisivel('pedidos')) desenharPedidos(); else abasParaRedesenhar.pedidos = true;
        dashAtualizarResumo();
    }

    function carregarCasamentoErp() {
        var C = window.TempRioErpCasamento;
        if (!C) return;
        var q = C.consulta(dados.pedidos), seq = ++erpv.seq;
        if (!q) { erpv.vendas = []; erpv.incompletos = {}; erpv.carregado = true; erpv.erro = null; erpvCalcular(); erpvRedesenhar(); return; }
        erpv.carregando = true;
        // Lote no teto (ERPV_LIMITE) não prova que veio inteiro: divide ao meio até isolar o CNPJ; CNPJ sozinho
        // no teto é descartado e fica FORA do casamento. Devolve {vendas, inc} ou {error}.
        function buscarLote(docs) {
            return vendPaginar(function () {
                return sb.from('solidcon_vendas_clientes').select('dia,dt,documento,tipo,valor_centavos,cd_pdv,nr_cupom')
                    .eq('tipo', 'cnpj').in('documento', docs).gte('dia', q.desde)
                    .order('dia', { ascending: true }).order('cd_pdv', { ascending: true }).order('nr_cupom', { ascending: true });
            }, ERPV_LIMITE).then(function (r) {
                if (r.error) return { error: r.error };
                var linhas = r.data || [];
                if (linhas.length < ERPV_LIMITE) return { vendas: linhas, inc: {} };
                if (docs.length === 1) { var um = {}; um[docs[0]] = true; return { vendas: [], inc: um }; }
                var meio = Math.ceil(docs.length / 2);
                return Promise.all([buscarLote(docs.slice(0, meio)), buscarLote(docs.slice(meio))]).then(function (dois) {
                    var e = dois.filter(function (x) { return x.error; })[0];
                    if (e) return e;
                    var inc = {};
                    dois.forEach(function (x) { Object.keys(x.inc).forEach(function (d) { inc[d] = true; }); });
                    return { vendas: dois[0].vendas.concat(dois[1].vendas), inc: inc };
                });
            });
        }
        var lotes = [];
        for (var i = 0; i < q.documentos.length; i += ERPV_LOTE_DOCS) lotes.push(q.documentos.slice(i, i + ERPV_LOTE_DOCS));
        Promise.all(lotes.map(buscarLote)).then(function (rs) {
            if (seq !== erpv.seq) return; // chegou resposta de uma carga mais nova
            erpv.carregando = false;
            var falha = rs.filter(function (r) { return r.error; })[0];
            if (falha) {
                erpv.ausente = solidTabelaAusente(falha.error);
                erpv.erro = erpv.ausente ? null : String(falha.error.message || falha.error);
                erpv.carregado = false; erpv.vendas = []; erpv.incompletos = {};
            } else {
                erpv.ausente = false; erpv.erro = null; erpv.carregado = true;
                var vendas = [], inc = {};
                rs.forEach(function (r) {
                    vendas = vendas.concat(r.vendas);
                    Object.keys(r.inc).forEach(function (d) { inc[d] = true; });
                });
                erpv.vendas = vendas; erpv.incompletos = inc;
            }
            erpvCalcular();
            erpvRedesenhar();
        }).catch(function (e) {
            if (seq !== erpv.seq) return;
            erpv.carregando = false; erpv.carregado = false; erpv.erro = String(e && e.message || e);
            erpvCalcular(); erpvRedesenhar();
        });
    }

    function erpResultado(p) { return (erpv.res && erpv.res.porPedido[p.id]) || null; }
    function erpCasado(p) { var r = erpResultado(p); return !!(r && r.estado === 'casado'); }
    function erpDiaCurto(dia) { var s = String(dia || '').split('-'); return s.length === 3 ? s[2] + '/' + s[1] : String(dia || ''); }

    function seloErpPedido(p) {
        var r = erpResultado(p);
        if (!r) return '';
        if (r.estado === 'casado') {
            var v = r.venda;
            return '<span class="adm-selo adm-selo-confirmado" title="' + esc('Venda no ERP: PDV ' + v.cd_pdv + ', cupom ' + v.nr_cupom +
                    ' (' + (r.alvo === 'produtos_frete' ? 'produtos + frete' : 'produtos') + ', diferença ' + brl(r.diferenca) + '). ' + ERPV_NOTA) + '">' +
                '<i class="fa-solid fa-file-invoice-dollar"></i>Faturado no ERP · cupom ' + esc(String(v.nr_cupom)) + ' · ' +
                esc(erpDiaCurto(v.dia)) + ' · ' + esc(brl(v.valor_centavos)) + '</span>';
        }
        return '<span class="adm-selo adm-selo-aguardando" title="' + esc((ERPV_MOTIVO[r.motivo] || 'Conferir') + '. ' + ERPV_NOTA) + '">' +
            '<i class="fa-solid fa-magnifying-glass"></i>Conferir no ERP</span>';
    }

    // Detalhe no modal: por que casou (ou o que conferir), com as vendas candidatas.
    function htmlErpPedido(p) {
        var r = erpResultado(p);
        var nota = '<p class="text-xs mt-2" style="color:var(--adm-tinta-3)">' + esc(ERPV_NOTA) + '</p>';
        if (!r) {
            if (p.status !== 'aguardando' && p.status !== 'confirmado') return '';
            var txt = erpv.carregando ? 'Procurando a venda no ERP…' : erpv.erro ? 'Vendas do ERP indisponíveis agora.' :
                erpv.ausente ? 'Vendas por cliente do ERP ainda não instaladas neste banco.' : 'Nenhuma venda do ERP casou com este pedido até agora.';
            return '<div class="mb-4 text-xs" style="color:var(--adm-tinta-2)">' + esc(txt) + nota + '</div>';
        }
        var vendas = r.estado === 'casado' ? [r.venda] : (r.candidatos || []);
        var linhas = vendas.map(function (v) {
            return '<tr><td>' + esc(cmpData(v.dia)) + '</td><td>' + esc(String(v.cd_pdv)) + ' / ' + esc(String(v.nr_cupom)) + '</td>' +
                '<td class="num">' + esc(brl(v.valor_centavos)) + '</td></tr>';
        }).join('');
        var titulo = r.estado === 'casado'
            ? 'Faturado no ERP' + (r.alvo === 'produtos_frete' ? ' (valor com frete)' : '') + ' · diferença ' + brl(r.diferenca)
            : 'Conferir no ERP: ' + (ERPV_MOTIVO[r.motivo] || '') + (r.soma_centavos != null ? ' (soma ' + brl(r.soma_centavos) + ')' : '');
        return '<div class="adm-card p-4 mb-4" style="border:1px solid var(--adm-borda)">' +
            '<div class="mb-2">' + seloErpPedido(p) + '</div>' +
            '<p class="text-sm font-bold mb-2">' + esc(titulo) + '</p>' +
            '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Dia</th><th>PDV / cupom</th>' +
            '<th style="text-align:right">Valor</th></tr></thead><tbody>' + linhas + '</tbody></table></div>' + nota + '</div>';
    }

    // Itens com preço congelado (pedido_items) + código do ERP; cai no jsonb se faltar.
    function buscarItensSolidcon(p) {
        return sb.from('pedido_items').select('*').eq('pedido_id', p.id).order('id').then(function (r) {
            var linhas = (!r.error && r.data && r.data.length) ? r.data.map(function (i) {
                return { produto_id: i.produto_id, nome: i.produto_nome, potes: i.quantidade,
                         unit: i.preco_unitario_centavos };
            }) : (Array.isArray(p.itens) ? p.itens : []).map(function (i) {
                return { produto_id: i.id, nome: i.nome, potes: Number(i.potes) || 0, unit: null };
            });
            var ids = linhas.map(function (l) { return l.produto_id; }).filter(Boolean);
            if (!ids.length) return { linhas: linhas, codigos: {}, semColuna: false };
            return sb.from('catalogo_produtos').select('id,codigo_erp').in('id', ids).then(function (c) {
                var codigos = {};
                (c.data || []).forEach(function (x) { codigos[x.id] = x.codigo_erp; });
                return { linhas: linhas, codigos: codigos, semColuna: !!c.error };
            });
        });
    }

    function carregarBlocoSolidcon(p) {
        var alvo = $('#bloco-solidcon');
        if (!alvo) return;
        alvo.setAttribute('data-pedido-id', p.id);
        alvo.innerHTML = '<p class="text-xs" style="color:var(--adm-tinta-3)">Carregando dados do SOLIDCON…</p>';
        buscarItensSolidcon(p).then(function (info) {
            if (alvo.isConnected && alvo.getAttribute('data-pedido-id') === String(p.id)) desenharBlocoSolidcon(alvo, p, info);
        }, function () {
            if (alvo.isConnected && alvo.getAttribute('data-pedido-id') === String(p.id)) desenharBlocoSolidcon(alvo, p, { linhas: [], codigos: {}, semColuna: true });
        });
    }

    function textoParaSolidcon(p, info) {
        var frete = Number(p.frete_centavos) || 0;
        var L = [
            'PEDIDO DO SITE - ' + dataHora(p.criado_em),
            'Vendedor: Marcio',
            'CNPJ: ' + (p.cnpj || ''),
            'Razao social: ' + (p.razao_social || ''),
            'IE: ' + (p.inscricao_estadual || 'ISENTO'),
            'Responsavel: ' + (p.responsavel || ''),
            'Telefone: ' + (p.telefone || ''),
            'E-mail: ' + (p.email || ''),
            'Endereco: ' + (p.logradouro || '') + (p.numero ? ', ' + p.numero : '') +
                (p.complemento ? ' - ' + p.complemento : '') + ' - ' + (p.bairro || '') + ' - ' +
                (p.cidade || '') + '/' + (p.uf || '') + (p.cep ? ' - CEP ' + p.cep : ''),
            '',
            'ITENS (codigo | produto | potes | unitario | subtotal)'
        ];
        info.linhas.forEach(function (l) {
            L.push((info.codigos[l.produto_id] || 'SEM CODIGO') + ' | ' + l.nome + ' | ' + l.potes + ' | ' +
                (l.unit == null ? '-' : brl(l.unit)) + ' | ' + (l.unit == null ? '-' : brl(l.unit * l.potes)));
        });
        L.push('', 'Produtos: ' + brl(p.valor_centavos), 'Frete: ' + brl(frete),
               'TOTAL: ' + brl((p.valor_centavos || 0) + frete));
        if (p.observacoes) L.push('Obs: ' + p.observacoes);
        return L.join('\n');
    }

    function copiarTexto(texto) {
        function plano() {
            var t = document.createElement('textarea');
            t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0';
            document.body.appendChild(t); t.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { /* sem cópia */ }
            t.remove();
            return ok;
        }
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(texto).then(function () { return true; }, function () { return plano(); });
        }
        return Promise.resolve(plano());
    }

    function desenharBlocoSolidcon(alvo, p, info) {
        var frete = Number(p.frete_centavos) || 0;
        var total = (p.valor_centavos || 0) + frete;
        var semCodigo = info.linhas.some(function (l) { return !info.codigos[l.produto_id]; });
        var avisos = '';

        if (info.semColuna) {
            avisos += '<p class="text-xs p-3 rounded-lg mb-3" style="background:var(--adm-neutro-fundo);color:var(--adm-tinta-2)">' +
                'Não foi possível ler os códigos do ERP no catálogo agora: procure os produtos pelo nome.</p>';
        } else if (semCodigo) {
            avisos += '<p class="text-xs p-3 rounded-lg mb-3" style="background:var(--adm-ruim-fundo);color:var(--adm-ruim)">' +
                '<i class="fa-solid fa-circle-exclamation mr-1"></i>Há produto sem código SOLIDCON — procure pelo nome.</p>';
        }

        var campo = function (r, v) {
            return '<div><span style="color:var(--adm-tinta-3)">' + esc(r) + ':</span> ' + esc(v || '—') + '</div>';
        };
        var endereco = (p.logradouro || '') + (p.numero ? ', ' + p.numero : '') + (p.complemento ? ' - ' + p.complemento : '') +
            ' · ' + (p.bairro || '') + ' · ' + (p.cidade || '') + '/' + (p.uf || '') + (p.cep ? ' · CEP ' + p.cep : '');

        alvo.innerHTML = '<div class="adm-card p-4" style="border:1px solid var(--adm-borda)">' +
            '<div class="flex items-center justify-between gap-2 flex-wrap mb-3">' +
                '<p class="font-bold text-sm">Dados para lançar no SOLIDCON</p>' +
                '<button type="button" id="solidcon-copiar" class="adm-botao-fantasma">' +
                    '<i class="fa-regular fa-copy mr-1"></i>Copiar tudo</button>' +
            '</div>' + avisos +
            '<div class="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">' +
                campo('CNPJ', p.cnpj) + campo('Razão social', p.razao_social) +
                campo('IE', p.inscricao_estadual || 'ISENTO') + campo('Responsável', p.responsavel) +
                campo('Telefone', p.telefone) + campo('E-mail', p.email) +
                campo('Vendedor', 'Marcio') +
                '<div class="sm:col-span-2">' + campo('Endereço', endereco) + '</div>' +
            '</div>' +
            '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr>' +
                '<th>Código</th><th>Produto</th><th style="text-align:right">Potes</th>' +
                '<th style="text-align:right">Unit.</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>' +
                (info.linhas.length ? info.linhas.map(function (l) {
                    var cod = info.codigos[l.produto_id];
                    return '<tr><td>' + (cod ? esc(cod) : '<span style="color:var(--adm-ruim)">sem código</span>') + '</td>' +
                        '<td>' + esc(l.nome) + '</td><td class="num">' + esc(NUM.format(l.potes)) + '</td>' +
                        '<td class="num">' + (l.unit == null ? '—' : esc(brl(l.unit))) + '</td>' +
                        '<td class="num">' + (l.unit == null ? '—' : esc(brl(l.unit * l.potes))) + '</td></tr>';
                }).join('') : '<tr><td colspan="5">Sem itens registrados.</td></tr>') +
            '</tbody></table></div>' +
            '<div class="text-xs mt-3 text-right" style="color:var(--adm-tinta-2)">' +
                'Produtos ' + esc(brl(p.valor_centavos)) + ' · Frete ' + esc(brl(frete)) +
                ' · <strong style="color:var(--adm-tinta)">Total ' + esc(brl(total)) + '</strong></div>' +
            (p.observacoes ? '<p class="text-xs mt-2" style="color:var(--adm-tinta-2)"><strong>Obs:</strong> ' + esc(p.observacoes) + '</p>' : '') +
            '</div>';

        var btnCopiar = alvo.querySelector('#solidcon-copiar');
        btnCopiar.addEventListener('click', function () {
            copiarTexto(textoParaSolidcon(p, info)).then(function (ok) {
                btnCopiar.innerHTML = ok ? '<i class="fa-solid fa-check mr-1"></i>Copiado!'
                                         : '<i class="fa-solid fa-xmark mr-1"></i>Não copiou';
                setTimeout(function () { btnCopiar.innerHTML = '<i class="fa-regular fa-copy mr-1"></i>Copiar tudo'; }, 2000);
            });
        });

    }

    function acoesDeStatus(p) {
        var botoes = [];
        if (p.status === 'aguardando') {
            botoes.push(erpCasado(p)
                ? botaoStatus(p.id, 'confirmado', 'Confirmar (faturado no ERP)', 'fa-file-invoice-dollar')
                : botaoStatus(p.id, 'confirmado', 'Confirmar venda', 'fa-circle-check'));
            botoes.push(botaoStatus(p.id, 'cancelado', 'Cancelar', 'fa-circle-xmark'));
        } else if (p.status === 'confirmado') {
            botoes.push(botaoStatus(p.id, 'entregue', 'Marcar entregue', 'fa-truck'));
            botoes.push(botaoStatus(p.id, 'cancelado', 'Cancelar', 'fa-circle-xmark'));
        } else {
            botoes.push(botaoStatus(p.id, 'aguardando', 'Reabrir', 'fa-rotate-left'));
        }
        return botoes.join('');
    }

    function botaoStatus(id, para, rotulo, icone) {
        return '<button type="button" class="adm-botao-fantasma" data-id="' + esc(id) + '"' +
               ' data-status="' + esc(para) + '">' +
               '<i class="fa-solid ' + icone + ' mr-1"></i>' + esc(rotulo) + '</button>';
    }

    function ligarAcoesDeStatus(raiz) {
        raiz.querySelectorAll('button[data-status]').forEach(function (b) {
            b.addEventListener('click', function (ev) {
                ev.stopPropagation(); // o botão mora dentro do cartão/linha que abre o modal
                var novo = b.getAttribute('data-status');
                if (novo === 'cancelado' && !window.confirm('Cancelar este pedido?')) return;
                b.disabled = true;
                mudarStatus(b.getAttribute('data-id'), novo, b);
            });
        });

        raiz.querySelectorAll('[data-ver-pedido]').forEach(function (elemento) {
            elemento.addEventListener('click', function (ev) {
                if (ev.target.closest('button[data-status]')) return; // clique era no botão, não na linha
                var p = dados.pedidos.filter(function (x) { return x.id === elemento.getAttribute('data-ver-pedido'); })[0];
                if (p) abrirPedido(p);
            });
        });
    }

    /* Fonte única da troca de status: usada pelos botões (clique) e pelo
     * Kanban (soltar num cartão). Confirmar dispara o WhatsApp de aviso —
     * ver a nota em abrirWhatsAppConfirmacao sobre por que isso não é
     * automático de verdade num site sem servidor. */
    function mudarStatus(id, novo, elemento) {
        var pedido = dados.pedidos.filter(function (p) { return p.id === id; })[0];
        if (elemento) elemento.style.opacity = '0.5';

        sb.from('pedidos').update({ status: novo }).eq('id', id).then(function (r) {
            if (elemento) { elemento.style.opacity = ''; elemento.disabled = false; }
            if (r.error) {
                window.alert('Não foi possível atualizar: ' + r.error.message);
                return;
            }
            if (novo === 'confirmado' && pedido) abrirWhatsAppConfirmacao(pedido);
            carregar(); // recarrega tudo: o faturamento do mês muda com isto
        });
    }

    /* "Confirmar pedido → envia mensagem automática no WhatsApp": o mais perto
     * disso que um site sem servidor consegue chegar. O WhatsApp não tem uma
     * API pública para enviar sem um clique da pessoa — só a API Business,
     * que exige backend e aprovação comercial. O que dá para fazer, e o que
     * está aqui: ao confirmar, a mensagem já sai pronta e a janela do
     * WhatsApp já abre — falta um clique em Enviar, não escrever nada. */
    function abrirWhatsAppConfirmacao(p) {
        var fone = String(p.telefone || '').replace(/\D/g, '');
        if (fone.length < 10) return; // sem telefone válido, sem link
        if (fone.length <= 11) fone = '55' + fone;

        var msg = 'Olá, ' + (p.responsavel || 'tudo bem') + '! Aqui é da Temp Rio. 🌶️\n\n' +
            'Seu pedido de ' + NUM.format(p.potes) + ' potes (' + brl(p.valor_centavos) + ') foi *confirmado*.\n' +
            'Em breve avisamos com os detalhes da entrega.\n\nObrigado pela confiança!';

        window.open('https://wa.me/' + fone + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
    }

    /* ===================================================================
     * Clientes
     *
     * `usuarios` (tipo cliente) e `clientes` (endereço/região) são tabelas
     * separadas desde a migração 004 — um usuário pode ter mais de uma loja.
     * Junta as duas aqui, na memória, do mesmo jeito que o Histórico já junta
     * pedidos por CNPJ: sem view nova no banco para uma tela que só lê.
     * =================================================================== */
    var clientesPagina = 1;
    var clientesFiltroAtivo = 'todos';
    var POR_PAGINA_CLIENTES = 20;

    function tipoPessoa(u) {
        var doc = String((u && u.cnpj) || '').replace(/\D/g, '');
        return doc.length > 11 ? 'PJ' : 'PF';
    }

    function listaClientesCombinada() {
        var usuariosPorId = {};
        dados.usuarios.forEach(function (u) { usuariosPorId[u.id] = u; });

        return dados.clientes.map(function (c) {
            var u = usuariosPorId[c.usuario_id] || {};
            var pedidosDoCliente = dados.pedidos.filter(function (p) { return p.cliente_id === c.id; });
            var fechados = pedidosDoCliente.filter(function (p) {
                return p.status === 'confirmado' || p.status === 'entregue';
            });
            var gasto = fechados.reduce(function (a, p) { return a + Number(p.valor_centavos); }, 0);

            return {
                clienteId: c.id, usuarioId: u.id, nome: u.nome || '(sem nome)',
                telefone: u.telefone || '', email: u.email || '',
                cnpj: u.cnpj || '', cpf: u.cpf || '', tipo: tipoPessoa(u),
                cidade: c.cidade || '', uf: c.uf || '', bairro: c.bairro || '',
                regiaoId: c.regiao_entrega_id, ativo: c.ativo !== false,
                criadoEm: u.criado_em || c.criado_em,
                pedidos: pedidosDoCliente.length, fechados: fechados.length,
                gasto: gasto, ticket: fechados.length ? Math.round(gasto / fechados.length) : 0,
                observacoes: c.observacoes || ''
            };
        });
    }

    /* ===================================================================
     * Clientes — UMA lista só (site + ERP SOLIDCON)
     * Casamento por CNPJ/CPF normalizado (docNorm). Cada linha pode ter: site (cadastro do site), erp (cadastro em
     * solidcon_clientes) e cmp (compras em solidcon_vendas_clientes, 026). Compras sem cadastro no ERP continuam na lista.
     * Ações de edição/exclusão/WhatsApp só existem para quem é cliente do site. CPF nunca mostra endereço completo.
     * =================================================================== */
    var ucli = { busca: '', origem: 'todos', ordem: { col: 'total', dir: -1 }, base: [], filtradas: [] };

    function ucliDocFmt(d) {
        if (!d) return '';
        if (d.length === 14) return recCnpj(d);
        return d.length === 11 ? d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9) : d;
    }

    // Uma linha por documento; quem não tem documento utilizável fica numa linha própria (nunca é fundido por engano).
    function ucliLinhas() {
        var porKey = {}, linhas = [], cad = cmpPronto() ? cmpSumindo() : [], sumi = {}, ult = {};
        cad.forEach(function (o) { sumi[o.doc] = true; });
        dados.pedidos.forEach(function (p) {
            if (p.status !== 'confirmado' && p.status !== 'entregue') return;
            var d = cmpIso(new Date(p.criado_em));
            if (!ult[p.cliente_id] || d > ult[p.cliente_id]) ult[p.cliente_id] = d;
        });
        function nova(key, doc) { var r = { key: key, doc: doc, site: null, erp: null, cmp: null }; linhas.push(r); return r; }
        function porDoc(d) { return porKey[d] || (porKey[d] = nova(d, d)); }

        listaClientesCombinada().forEach(function (c) {
            var d = docNorm(c.cnpj || c.cpf, c.cnpj ? 'cnpj' : 'cpf');
            var r = d && !(porKey[d] && porKey[d].site) ? porDoc(d) : nova('site:' + c.clienteId, d);
            r.site = c;
        });
        if (scli.carregado && scli.lista) scli.lista.forEach(function (c, i) {
            var d = docNorm(c.documento, c.tipo);
            if (!d) { nova('erp:' + i, '').erp = c; return; }
            var r = porDoc(d);
            if (!r.erp) r.erp = c;
        });
        if (cmpPronto()) Object.keys(cmp.por).forEach(function (k) { porDoc(k).cmp = cmp.por[k]; });

        var A = recPronto() ? recAgregar() : null;
        linhas.forEach(function (r) {
            var s = r.site, e = r.erp, nomeSite = s && s.nome !== '(sem nome)' ? s.nome : '';
            r.nome = nomeSite || (e && e.nome) || (s && s.nome) || ('(sem cadastro) ' + ucliDocFmt(r.doc));
            r.tipo = r.doc ? (r.doc.length === 14 ? 'PJ' : 'PF') : (s ? s.tipo : String((e && e.tipo) || '').toUpperCase() === 'CNPJ' ? 'PJ' : 'PF');
            r.temErp = !!(e || r.cmp);
            r.origem = s && r.temErp ? 'ambos' : s ? 'site' : 'erp';
            r.telefones = [];
            [s && s.telefone, e && e.telefone, e && e.celular].forEach(function (t) { if (t && r.telefones.indexOf(t) < 0) r.telefones.push(t); });
            r.email = (s && s.email) || (e && e.email) || '';
            r.local = s && (s.bairro || s.cidade) ? [s.bairro, s.cidade].filter(Boolean).join(', ') + (s.uf ? '/' + s.uf : '')
                : e ? [e.bairro, e.cidade].filter(Boolean).join(', ') + (e.estado ? '/' + e.estado : '') : '';
            r.pedidos = s ? s.pedidos : 0;
            var us = s ? ult[s.clienteId] : '', ue = r.cmp ? r.cmp.ultima : '';
            r.ultima = us > ue ? us : ue || us || '';
            r.total = r.cmp ? r.cmp.total : s ? s.gasto : null;
            r.totalDe = r.cmp ? 'ERP' : 'site';
            r.sumindo = !!(r.doc && sumi[r.doc]);
            r.n = r.cmp ? r.cmp.n : null; r.total6 = r.cmp ? r.cmp.total6 : null; r.ticket6 = r.cmp ? r.cmp.ticket6 : null; r.freq = r.cmp ? r.cmp.freq : null;
            var g = A && r.doc && r.doc.length === 14 ? A.porDoc[r.doc] : null;
            r.vencido = g ? g.vencido : null;
            r.digitos = [r.doc].concat(r.telefones).join(' ').replace(/[^\d ]/g, '');
            r.busca = [r.nome, r.doc, s && s.cnpj, s && s.cpf, e && e.nome, r.telefones.join(' '), r.email, r.local].join(' ').toLowerCase();
        });
        return linhas;
    }

    function recPronto() { return papel === 'admin' && rec.carregado && !rec.erro && !rec.ausente && !rec.truncado; }

    // Filtros globais valem para a parte "site"; período e região só existem no site, então escondem quem é só do ERP.
    function ucliFiltroDoSiteAtivo() { return !!(filtros.de || filtros.ate || filtros.regioes.length); }

    function ucliFiltrar(linhas) {
        var q = ucli.busca.trim().toLowerCase(), qd = docDigitos(q), siteAtivo = ucliFiltroDoSiteAtivo();
        var od = ucli.ordem, col = od.col;
        var lista = linhas.filter(function (r) {
            if (ucli.origem !== 'todos' && r.origem !== ucli.origem) return false;
            if (clientesFiltroAtivo !== 'todos' && (!r.site || (r.site.ativo ? 'ativos' : 'inativos') !== clientesFiltroAtivo)) return false;
            if (siteAtivo) {
                if (!r.site) return false;
                var c = r.site, dia = String(c.criadoEm).slice(0, 10);
                if (filtros.de && dia < filtros.de) return false;
                if (filtros.ate && dia > filtros.ate) return false;
                if (filtros.regioes.length && filtros.regioes.indexOf(c.regiaoId) === -1) return false;
            }
            if (filtros.tipoCliente !== 'todos' && r.tipo.toLowerCase() !== filtros.tipoCliente) return false;
            if (filtros.busca && r.busca.indexOf(filtros.busca) === -1) return false;
            if (q && r.busca.indexOf(q) === -1 && !(qd.length >= 3 && !/[a-z]/.test(q) && r.digitos.indexOf(qd) >= 0)) return false;
            return true;
        });
        lista.sort(function (a, b) {
            var va = a[col], vb = b[col];
            if (col === 'nome') return String(va).localeCompare(String(vb), 'pt-BR') * od.dir;
            if (!va && va !== 0 && !vb && vb !== 0) return 0;
            if (!va && va !== 0) return 1; // sem valor vai sempre para o fim
            if (!vb && vb !== 0) return -1;
            return (va < vb ? -1 : va > vb ? 1 : 0) * od.dir;
        });
        return lista;
    }

    // Estado das fontes do ERP, numa linha só (o detalhe do histórico de compras continua no bloco abaixo).
    function ucliAviso() {
        var base = '<div class="adm-card p-4 mb-4 text-sm" style="color:var(--adm-tinta-2)">';
        if (scli.carregando && !scli.carregado) return base + '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando cadastros do SOLIDCON…</div>';
        if (scli.ausente) return base + 'Cadastros do SOLIDCON ainda não instalados: a tabela solidcon_clientes ainda não existe neste banco. Enquanto isso a lista mostra só os clientes do site.</div>';
        if (scli.erro) return base + 'Não foi possível carregar os cadastros do SOLIDCON: ' + esc(scli.erro) + ' <button type="button" class="adm-botao-fantasma ml-2" id="scli-tentar">Tentar de novo</button></div>';
        if (!cmpPronto()) return base + (cmp.carregando || !cmp.carregado && !cmp.erro && !cmp.ausente ? '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando histórico de compras do ERP…' :
            'Histórico de compras do ERP indisponível agora (veja o bloco “Histórico de compras por cliente”): Última compra e Total usam só os pedidos do site.') + '</div>';
        return '';
    }

    function ucliChips(attr, opcoes, atual) {
        return opcoes.map(function (o) {
            return '<button type="button" class="adm-chip' + (atual === o[0] ? ' is-ativo' : '') + '" ' + attr + '="' + o[0] + '">' + o[1] + '</button>';
        }).join('');
    }

    function desenharClientesLista() {
        var alvo = $('#clientes-lista');
        if (!alvo) return;
        ucli.base = ucliLinhas();
        if (!ucli.base.length && !(scli.carregando && !scli.carregado)) {
            alvo.innerHTML = ucliAviso() + cartaoVazio('Nenhum cliente ainda',
                'Um cliente entra aqui sozinho assim que o primeiro pedido dele é gravado no site, ou quando existir no cadastro do SOLIDCON.');
            ligarUcliAviso(alvo);
            return;
        }
        alvo.innerHTML =
            '<div class="flex items-center justify-between flex-wrap gap-3 mb-3">' +
                '<div class="flex gap-1 flex-wrap" role="group" aria-label="Origem">' +
                    ucliChips('data-ucli-origem', [['todos', 'Todas as origens'], ['site', 'Só site'], ['erp', 'Só ERP'], ['ambos', 'Site + ERP']], ucli.origem) +
                '</div>' +
                '<div class="flex items-center gap-3 flex-wrap">' + botoesExportar('clientes') + '</div>' +
            '</div>' +
            '<div class="flex items-center justify-between flex-wrap gap-3 mb-4">' +
                '<div class="flex gap-1" role="group" aria-label="Situação (clientes do site)">' +
                    ucliChips('data-clientes-status', [['todos', 'Todos'], ['ativos', 'Ativos'], ['inativos', 'Inativos']], clientesFiltroAtivo) +
                '</div>' +
                '<div class="flex items-center gap-2 flex-wrap">' +
                    '<input type="search" id="ucli-busca" class="adm-input" style="width:16rem;max-width:100%;padding:.55rem .7rem" placeholder="Buscar por nome, documento ou telefone" aria-label="Buscar cliente" value="' + esc(ucli.busca) + '">' +
                    '<select id="ucli-ordem" class="adm-input" style="width:auto;padding:.55rem .7rem" aria-label="Ordenar por">' +
                        [['nome', 'Nome'], ['ultima', 'Última compra'], ['total', 'Total comprado'], ['n', 'Nº de compras (ERP)'], ['total6', 'Total 6 meses (ERP)'], ['ticket6', 'Ticket médio 6 meses (ERP)'], ['freq', 'Frequência típica (ERP)']].concat(papel === 'admin' ? [['vencido', 'Vencido']] : []).map(function (o) {
                            return '<option value="' + o[0] + '"' + (ucli.ordem.col === o[0] ? ' selected' : '') + '>Ordenar: ' + o[1] + '</option>';
                        }).join('') +
                    '</select>' +
                    '<button type="button" class="adm-botao-fantasma" id="ucli-dir" aria-label="Inverter a ordem"><i class="fa-solid ' + (ucli.ordem.dir > 0 ? 'fa-arrow-up-short-wide' : 'fa-arrow-down-wide-short') + '"></i></button>' +
                '</div>' +
            '</div>' +
            ucliAviso() +
            '<div id="ucli-corpo"></div>';

        alvo.querySelectorAll('[data-ucli-origem]').forEach(function (b) {
            b.addEventListener('click', function () { ucli.origem = b.getAttribute('data-ucli-origem'); clientesPagina = 1; desenharClientesLista(); });
        });
        alvo.querySelectorAll('[data-clientes-status]').forEach(function (b) {
            b.addEventListener('click', function () { clientesFiltroAtivo = b.getAttribute('data-clientes-status'); clientesPagina = 1; desenharClientesLista(); });
        });
        $('#ucli-busca').addEventListener('input', function (ev) { ucli.busca = ev.target.value; clientesPagina = 1; desenharUcliCorpo(); });
        $('#ucli-ordem').addEventListener('change', function (ev) {
            var c = ev.target.value; ucli.ordem = { col: c, dir: c === 'nome' ? 1 : -1 }; clientesPagina = 1; desenharClientesLista();
        });
        $('#ucli-dir').addEventListener('click', function () { ucli.ordem.dir = -ucli.ordem.dir; clientesPagina = 1; desenharClientesLista(); });
        ligarBotoesExportar(alvo, { clientes: function () { exportarClientesCSV(ucli.filtradas); } });
        ligarUcliAviso(alvo);
        desenharUcliCorpo();
    }

    function ligarUcliAviso(alvo) {
        var t = alvo.querySelector('#scli-tentar');
        if (t) t.addEventListener('click', carregarSolidClientes);
    }

    function desenharUcliCorpo() {
        var alvo = $('#ucli-corpo');
        if (!alvo) return;
        var filtradas = ucli.filtradas = ucliFiltrar(ucli.base);
        var adm = papel === 'admin';
        var nSite = 0, nErp = 0, nAmbos = 0;
        filtradas.forEach(function (r) { if (r.origem === 'site') nSite++; else if (r.origem === 'erp') nErp++; else nAmbos++; });
        var aviso = ucliFiltroDoSiteAtivo() && ucli.base.some(function (r) { return !r.site; })
            ? '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)"><i class="fa-solid fa-filter mr-1"></i>Filtro de período/região ativo: cadastros que existem só no ERP ficam de fora (esses dados são do site).</p>' : '';
        if (!filtradas.length) {
            alvo.innerHTML = aviso + cartaoVazio('Nenhum cliente com esses filtros', 'Há ' + NUM.format(ucli.base.length) + ' clientes ao todo — tente limpar os filtros ou a busca.');
            return;
        }
        var pag = paginar(filtradas, clientesPagina, POR_PAGINA_CLIENTES);
        clientesPagina = pag.pagina;
        var colunas = adm ? 8 : 7;
        function th(col, rot, num) {
            var ordenavel = !!col;
            return '<th' + (num ? ' class="num"' : '') + (ordenavel ? ' style="cursor:pointer" data-ucli-ord="' + col + '" aria-sort="' + (ucli.ordem.col === col ? (ucli.ordem.dir > 0 ? 'ascending' : 'descending') : 'none') + '"' : '') + '>' +
                rot + (ordenavel && ucli.ordem.col === col ? (ucli.ordem.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>';
        }
        alvo.innerHTML = aviso +
            '<div class="adm-card p-5"><div class="overflow-x-auto"><table class="adm-tabela adm-tabela-lista"><thead><tr>' +
                th('nome', 'Cliente') + th('', 'Contato') + th('', 'Pedidos (site)', true) + th('ultima', 'Última compra', true) + th('total', 'Total', true) +
                (adm ? th('vencido', 'Vencido', true) : '') + th('', 'Ação') +
            '</tr></thead><tbody>' + pag.itens.map(function (r) { return linhaClienteUnico(r, colunas); }).join('') + '</tbody></table></div>' +
            '<p class="text-xs mt-3" style="color:var(--adm-tinta-3)">' + NUM.format(filtradas.length) + ' clientes — ' + NUM.format(nSite) + ' só no site · ' + NUM.format(nErp) + ' só no ERP · ' + NUM.format(nAmbos) + ' nos dois. ' +
                'Total = histórico no ERP (quando existe) ou pedidos fechados do site.</p>' +
            controlesDePaginacao('clientes', pag.pagina, pag.totalPaginas) + '</div>';

        alvo.querySelectorAll('[data-ucli-ord]').forEach(function (h) {
            h.addEventListener('click', function () {
                var c = h.getAttribute('data-ucli-ord');
                ucli.ordem = { col: c, dir: ucli.ordem.col === c ? -ucli.ordem.dir : (c === 'nome' ? 1 : -1) };
                clientesPagina = 1; desenharClientesLista();
            });
        });
        alvo.querySelectorAll('[data-pagina^="clientes:"]').forEach(function (b) {
            b.addEventListener('click', function () { clientesPagina = Number(b.getAttribute('data-pagina').split(':')[1]); desenharUcliCorpo(); });
        });

        // "Detalhes" não abre modal: abre a própria linha, embaixo do cliente clicado (ver linhaClienteUnico).
        alvo.querySelectorAll('[data-ver-cliente]').forEach(function (b) {
            b.addEventListener('click', function () {
                var linhaDetalhe = b.closest('tr').nextElementSibling;
                if (!linhaDetalhe || !linhaDetalhe.classList.contains('adm-linha-detalhe')) return;
                var colapso = linhaDetalhe.querySelector('.adm-detalhe-colapso');
                var aberto = colapso.classList.toggle('is-aberto');
                b.setAttribute('aria-expanded', String(aberto));
                var icone = b.querySelector('[data-icone-detalhe]');
                if (icone) {
                    icone.classList.toggle('fa-chevron-down', !aberto);
                    icone.classList.toggle('fa-chevron-up', aberto);
                }
            });
        });
        alvo.querySelectorAll('[data-editar-cliente]').forEach(function (b) {
            b.addEventListener('click', function () {
                var r = filtradas.filter(function (x) { return x.site && x.site.clienteId === b.getAttribute('data-editar-cliente'); })[0];
                if (r) abrirModal(formEditarCliente(r.site));
            });
        });

        // Reaproveita a mesma RPC da aba LGPD ("Excluir dados"): mantém o pedido (obrigação fiscal de 5 anos), anonimiza
        // nome/telefone/e-mail/endereço em usuarios, clientes e pedidos, e apaga leads com o mesmo documento.
        alvo.querySelectorAll('[data-excluir-cliente]').forEach(function (b) {
            b.addEventListener('click', function () {
                var documento = b.getAttribute('data-documento');
                if (!documento) {
                    window.alert('Este cliente não tem CPF/CNPJ cadastrado — não é possível excluir.');
                    return;
                }
                if (!window.confirm(
                    'Excluir este cliente?\n\n' +
                    'Remove nome, telefone, e-mail e endereço do cadastro. Pedidos já fechados ' +
                    'continuam existindo (obrigação fiscal de 5 anos), mas sem contato nem endereço ' +
                    'ligados a eles.\n\n' +
                    'Não tem como desfazer.'
                )) return;

                b.disabled = true;
                sb.rpc('lgpd_excluir_pessoa', { p_documento: documento }).then(function (r) {
                    b.disabled = false;
                    if (r.error) { window.alert('Não foi possível excluir: ' + r.error.message); return; }
                    carregar();
                });
            });
        });
    }

    function ucliSelos(r) {
        return (r.site ? SELO_SITE : '') + (r.temErp ? (r.site ? ' ' : '') + SELO_ERP : '') +
            (r.site && !r.site.ativo ? ' <span class="adm-selo adm-selo-cancelado">Inativo</span>' : '') +
            (r.sumindo ? ' <span class="adm-selo adm-selo-aguardando" title="Parou de comprar no ritmo habitual">Sumindo</span>' : '');
    }

    function linhaClienteUnico(r, colunas) {
        var s = r.site, adm = papel === 'admin';
        return '<tr>' +
            '<td>' + esc(r.nome) + '<div class="mt-1">' + ucliSelos(r) + '</div>' +
                '<div class="text-xs mt-1" style="color:var(--adm-tinta-3)">' + esc(r.tipo) + (r.doc ? ' ' + esc(ucliDocFmt(r.doc)) : '') + (r.local ? ' · ' + esc(r.local) : '') + '</div></td>' +
            '<td data-rotulo="Contato">' + (r.telefones.length ? esc(r.telefones.join(' / ')) : '—') + (r.email ? '<br><span class="text-xs" style="color:var(--adm-tinta-3)">' + esc(r.email) + '</span>' : '') + '</td>' +
            '<td class="num" data-rotulo="Pedidos (site)">' + (s ? NUM.format(r.pedidos) : '—') + '</td>' +
            '<td class="num" data-rotulo="Última compra">' + (r.ultima ? esc(cmpData(r.ultima)) : '—') + '</td>' +
            '<td class="num" data-rotulo="Total">' + (r.total != null ? esc(brl(Math.round(r.total))) + '<br><span class="text-xs" style="color:var(--adm-tinta-3)">' + r.totalDe + '</span>' : '—') + '</td>' +
            (adm ? '<td class="num" data-rotulo="Vencido"' + (r.vencido > 0 ? ' style="color:var(--adm-ruim)"' : '') + '>' + (r.vencido != null ? esc(brl(r.vencido)) : '—') + '</td>' : '') +
            '<td><div class="flex items-center gap-1 flex-wrap">' +
                '<button type="button" class="adm-botao-fantasma" data-ver-cliente="' + esc(r.key) + '" aria-expanded="false">' +
                    '<i class="fa-solid fa-chevron-down mr-1" data-icone-detalhe></i>Detalhes</button>' +
                (s ? '<button type="button" class="adm-botao-fantasma" data-editar-cliente="' + esc(s.clienteId) + '">' +
                    '<i class="fa-solid fa-pen mr-1"></i>Editar</button>' +
                '<button type="button" class="adm-botao-fantasma" data-excluir-cliente="' + esc(s.clienteId) + '" ' +
                    'data-documento="' + esc(s.cnpj || s.cpf || '') + '" style="color:var(--adm-ruim)">' +
                    '<i class="fa-solid fa-trash mr-1"></i>Excluir</button>' + linkWhats(s.telefone) : '') +
            '</div></td>' +
        '</tr>' +
        // Linha de detalhe: nasce colapsada (CSS), logo depois da linha do cliente.
        '<tr class="adm-linha-detalhe">' +
            '<td colspan="' + colunas + '"><div class="adm-detalhe-colapso">' +
                '<div class="adm-detalhe-conteudo">' + detalheClienteUnico(r) + '</div>' +
            '</div></td>' +
        '</tr>';
    }

    function ucliBloco(titulo, selo, corpo) {
        return '<div class="mb-5"><div class="flex items-center gap-2 mb-3">' + selo + '<p class="font-bold text-sm">' + esc(titulo) + '</p></div>' + corpo + '</div>';
    }

    function detalheClienteUnico(r) {
        var s = r.site, e = r.erp, o = r.cmp, adm = papel === 'admin';
        var h = '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">' + esc(r.tipo === 'PJ' ? 'CNPJ' : 'CPF') + ' ' + esc(r.doc ? ucliDocFmt(r.doc) : '—') +
            (r.local ? ' · ' + esc(r.local) : '') + '</p>';

        // Contato e endereço (endereço completo só de CNPJ, vindo do cadastro do ERP)
        var contato = [];
        if (s && (s.telefone || s.email)) contato.push('<p class="text-sm">' + SELO_SITE + ' ' + esc(s.telefone || '') + (s.email ? ' · ' + esc(s.email) : '') + '</p>');
        if (e) {
            var tel = [e.telefone, e.celular].filter(Boolean).join(' / ');
            contato.push('<p class="text-sm">' + SELO_ERP + ' ' + esc(tel || '—') + (e.email ? ' · ' + esc(e.email) : '') + '</p>');
        }
        h += '<div class="mb-5 space-y-1">' + (contato.join('') || '<p class="text-sm" style="color:var(--adm-tinta-3)">Sem contato cadastrado.</p>') + '</div>';
        if (e && r.tipo === 'PJ') {
            h += '<p class="text-sm mb-5"><span class="adm-tile-rotulo mr-2">Endereço (CNPJ)</span>' + scliEndereco(e) +
                (e.coletado_em ? '<br><span class="text-xs" style="color:var(--adm-tinta-3)">Cadastro coletado em ' + esc(dataHora(e.coletado_em)) + '</span>' : '') + '</p>';
        } else if (e && e.coletado_em) {
            h += '<p class="text-xs mb-5" style="color:var(--adm-tinta-3)">Cadastro do ERP coletado em ' + esc(dataHora(e.coletado_em)) + '</p>';
        }

        // Pedidos do site (como antes)
        if (s) {
            var pedidos = dados.pedidos.filter(function (p) { return p.cliente_id === s.clienteId; })
                .sort(function (a, b) { return new Date(b.criado_em) - new Date(a.criado_em); });
            h += ucliBloco('Pedidos do site', SELO_SITE,
                '<div class="grid sm:grid-cols-3 gap-4 mb-4">' +
                    ficha('Pedidos', NUM.format(s.pedidos), NUM.format(s.fechados) + ' fechados') +
                    ficha('Total comprado', brl(s.gasto), 'confirmado + entregue') +
                    ficha('Ticket médio', brl(s.ticket), 'por pedido fechado') +
                '</div>' +
                (pedidos.length
                    ? '<div class="space-y-2 max-h-64 overflow-y-auto">' + pedidos.map(function (p) {
                        return '<div class="flex items-center justify-between text-sm py-1.5" style="border-bottom:1px solid var(--adm-borda)">' +
                            '<span style="color:var(--adm-tinta-2)">' + esc(new Date(p.criado_em).toLocaleDateString('pt-BR')) + '</span>' +
                            '<span>' + esc(brl(p.valor_centavos)) + '</span>' + selo(p.status) +
                        '</div>';
                    }).join('') + '</div>'
                    : '<p class="adm-vazio">Nenhum pedido no período carregado.</p>'));
        }

        // Histórico de compras no ERP (026)
        if (r.doc || r.temErp) {
            var corpo;
            if (!cmpPronto()) corpo = '<p class="text-sm" style="color:var(--adm-tinta-3)">' + (cmp.carregando || (!cmp.carregado && !cmp.erro && !cmp.ausente) ? 'Carregando histórico de compras…' :
                'Histórico de compras indisponível agora (veja o bloco “Histórico de compras por cliente”).') + '</p>';
            else if (!o) corpo = '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhuma compra identificada no ERP para este documento.</p>';
            else corpo = '<div class="grid sm:grid-cols-3 gap-4">' +
                ficha('Compras', NUM.format(o.n), 'desde ' + cmpData(o.primeira)) +
                ficha('Última compra', cmpData(o.ultima), 'há ' + NUM.format(o.desde) + ' dias') +
                ficha('Total no ERP', brl(o.total), 'média ' + brl(Math.round(o.mensal)) + '/mês') +
                ficha('Total ' + CMP_MESES_VALOR + ' meses', o.n6 ? brl(o.total6) : '—', o.n6 ? NUM.format(o.n6) + (o.n6 === 1 ? ' compra' : ' compras') : 'sem compras') +
                ficha('Ticket médio ' + CMP_MESES_VALOR + ' meses', o.ticket6 != null ? brl(Math.round(o.ticket6)) : '—', 'por compra') +
                ficha('Frequência típica', o.freq != null ? 'a cada ' + NUM.format(Math.round(o.freq)) + ' dias' : '—', r.sumindo ? 'parou de comprar no ritmo' : 'mediana entre compras') +
                '</div>';
            h += ucliBloco('Histórico de compras (ERP)', SELO_ERP, corpo);
        }

        // Contas a receber (030) — só admin, só CNPJ
        if (adm && r.tipo === 'PJ' && r.doc && recPronto()) {
            var g = recAgregar().porDoc[r.doc];
            h += ucliBloco('Contas a receber', SELO_ERP, g
                ? recFichasDoDoc(r.doc) + '<details><summary class="text-xs cursor-pointer" style="color:var(--adm-tinta-3)">Ver parcelas (' + NUM.format(g.n) + ')</summary><div class="mt-3">' + recParcelas(g) + '</div></details>'
                : '<p class="text-sm" style="color:var(--adm-tinta-3)">Nenhuma parcela em aberto.</p>');
        }
        return h;
    }

    /* Edição deliberadamente curta: telefone, e-mail e observações. O resto
     * (endereço, CNPJ, região) vem do próprio pedido do cliente — mudar aqui
     * sem mudar lá deixaria os dois discordando, e o próximo pedido sobrescreve
     * só o que está vazio (ver o gatilho da migração 006), nunca o preenchido. */
    function formEditarCliente(c) {
        return '<h2 class="text-lg font-bold mb-4">Editar ' + esc(c.nome) + '</h2>' +
            '<form id="form-editar-cliente" data-usuario="' + esc(c.usuarioId) + '" data-cliente="' + esc(c.clienteId) + '">' +
                '<label class="adm-tile-rotulo block mb-1.5">Telefone</label>' +
                '<input type="text" id="edit-telefone" class="adm-input mb-4" value="' + esc(c.telefone) + '">' +
                '<label class="adm-tile-rotulo block mb-1.5">E-mail</label>' +
                '<input type="email" id="edit-email" class="adm-input mb-4" value="' + esc(c.email) + '">' +
                '<label class="adm-tile-rotulo block mb-1.5">Observações</label>' +
                '<textarea id="edit-observacoes" class="adm-input mb-5" rows="3">' + esc(c.observacoes) + '</textarea>' +
                '<div class="flex items-center gap-2">' +
                    '<button type="submit" class="adm-botao">Salvar</button>' +
                    '<span id="edit-cliente-erro" class="text-xs hidden" style="color:var(--adm-ruim)"></span>' +
                '</div>' +
            '</form>';
    }

    // Delegado uma vez só: o formulário de edição é recriado a cada abertura
    // do modal, então o listener não pode viver no <form> em si.
    document.addEventListener('submit', function (ev) {
        var form = ev.target.closest('#form-editar-cliente');
        if (!form) return;
        ev.preventDefault();

        var telefone = $('#edit-telefone').value.trim();
        var email = $('#edit-email').value.trim();
        var observacoes = $('#edit-observacoes').value.trim();
        var botao = form.querySelector('button[type="submit"]');
        botao.disabled = true;

        Promise.all([
            sb.from('usuarios').update({ telefone: telefone, email: email || null })
                .eq('id', form.getAttribute('data-usuario')),
            sb.from('clientes').update({ observacoes: observacoes || null })
                .eq('id', form.getAttribute('data-cliente'))
        ]).then(function (rs) {
            botao.disabled = false;
            var falha = rs.filter(function (r) { return r.error; })[0];
            if (falha) {
                var erro = $('#edit-cliente-erro');
                erro.textContent = 'Não foi possível salvar: ' + falha.error.message;
                erro.classList.remove('hidden');
                return;
            }
            fecharModal();
            carregar();
        });
    });

    function exportarClientesCSV(lista) {
        var adm = papel === 'admin';
        exportarCSV('clientes', ['Nome', 'Documento', 'Origem', 'Telefone', 'Tipo', 'Local', 'Pedidos (site)', 'Ticket médio (site)', 'Última compra', 'Total', 'Total de'].concat(adm ? ['Vencido (ERP)'] : []),
            lista.map(function (r) {
                var s = r.site;
                return [r.nome, ucliDocFmt(r.doc), r.origem === 'ambos' ? 'Site + ERP' : r.origem === 'site' ? 'Site' : 'ERP', r.telefones.join(' / '), r.tipo, r.local,
                    s ? s.pedidos : '', s ? brl(s.ticket) : '', r.ultima ? cmpData(r.ultima) : '', r.total != null ? brl(Math.round(r.total)) : '', r.total != null ? r.totalDe : ''].concat(adm ? [r.vencido != null ? brl(r.vencido) : ''] : []);
            }));
    }

    /* ===================================================================
     * Histórico de compras — por cliente
     * =================================================================== */
    function desenharHistorico() {
        var alvo = $('#painel-historico');
        var pedidos = dados.pedidos.filter(pedidoPassaNoFiltro);

        if (!pedidos.length) {
            alvo.innerHTML = cartaoVazio('Sem histórico no período',
                dados.pedidos.length
                    ? 'Há pedidos no período, mas nenhum bate com os filtros acima.'
                    : 'Escolha um período maior no filtro acima, ou aguarde os primeiros pedidos.');
            return;
        }

        // Agrupa por CNPJ: é isto que transforma uma lista de pedidos em
        // histórico de compras de um cliente.
        var porCliente = {};
        pedidos.forEach(function (p) {
            var k = p.cnpj || p.razao_social;
            if (!porCliente[k]) {
                porCliente[k] = {
                    razao: p.razao_social, cnpj: p.cnpj, cidade: p.cidade, uf: p.uf,
                    pedidos: 0, confirmados: 0, gasto: 0, ultimo: p.criado_em
                };
            }
            var c = porCliente[k];
            c.pedidos++;
            if (p.status === 'confirmado' || p.status === 'entregue') {
                c.confirmados++;
                c.gasto += Number(p.valor_centavos);
            }
            if (new Date(p.criado_em) > new Date(c.ultimo)) c.ultimo = p.criado_em;
        });

        var clientes = Object.keys(porCliente).map(function (k) { return porCliente[k]; })
            .sort(function (a, b) { return b.gasto - a.gasto; });

        var encerrados = pedidos.filter(function (p) {
            return p.status === 'entregue' || p.status === 'cancelado';
        });

        alvo.innerHTML =
            '<div class="flex justify-end mb-4">' + botoesExportar('historico') + '</div>' +

            '<div class="adm-card p-5 mb-5">' +
                '<p class="font-bold text-sm mb-1">Clientes no período</p>' +
                '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">' +
                    'Ordenados pelo quanto já compraram de fato. Gasto soma só confirmado e entregue.' +
                '</p>' +
                '<div id="t-clientes" class="overflow-x-auto"></div>' +
            '</div>' +

            '<div class="adm-card p-5">' +
                '<p class="font-bold text-sm mb-1">Pedidos encerrados</p>' +
                '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">' +
                    'Entregues e cancelados. Clique num pedido para ver os itens. ' +
                    'Os que ainda precisam de decisão estão na aba Pedidos.' +
                '</p>' +
                (encerrados.length
                    ? '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr>' +
                      '<th>Data</th><th>Cliente</th><th>Praça</th><th style="text-align:right">Potes</th>' +
                      '<th style="text-align:right">Valor</th><th>Situação</th><th>Ação</th>' +
                      '</tr></thead><tbody>' +
                      encerrados.map(function (p) {
                          return '<tr style="cursor:pointer" data-ver-pedido="' + esc(p.id) + '">' +
                              '<td>' + esc(new Date(p.criado_em).toLocaleDateString('pt-BR')) + '</td>' +
                              '<td>' + esc(p.razao_social) + '</td>' +
                              '<td>' + esc((p.cidade || '') + '/' + (p.uf || '')) + '</td>' +
                              '<td class="num">' + NUM.format(p.potes) + '</td>' +
                              '<td class="num">' + esc(brl(p.valor_centavos)) + '</td>' +
                              '<td>' + selo(p.status) + '</td>' +
                              '<td><button type="button" class="adm-botao-fantasma" data-reenviar-recibo="' + esc(p.id) + '">' +
                                  '<i class="fa-brands fa-whatsapp mr-1"></i>Recibo</button></td>' +
                          '</tr>';
                      }).join('') +
                      '</tbody></table></div>'
                    : '<p class="adm-vazio">Nenhum pedido encerrado ainda.</p>') +
            '</div>';

        tabela($('#t-clientes'),
            ['Cliente', 'CNPJ', 'Praça', 'Pedidos', 'Fechados', 'Total comprado', 'Último'],
            clientes.map(function (c) {
                return [c.razao, c.cnpj, (c.cidade || '') + '/' + (c.uf || ''),
                        NUM.format(c.pedidos), NUM.format(c.confirmados),
                        brl(c.gasto), new Date(c.ultimo).toLocaleDateString('pt-BR')];
            }),
            [false, false, false, true, true, true, false]);

        alvo.querySelectorAll('[data-ver-pedido]').forEach(function (elemento) {
            elemento.addEventListener('click', function (ev) {
                if (ev.target.closest('[data-reenviar-recibo]')) return;
                var p = pedidos.filter(function (x) { return x.id === elemento.getAttribute('data-ver-pedido'); })[0];
                if (p) abrirPedido(p);
            });
        });
        alvo.querySelectorAll('[data-reenviar-recibo]').forEach(function (b) {
            b.addEventListener('click', function (ev) {
                ev.stopPropagation();
                var p = pedidos.filter(function (x) { return x.id === b.getAttribute('data-reenviar-recibo'); })[0];
                if (p) reenviarRecibo(p);
            });
        });
        ligarBotoesExportar(alvo, { historico: function () { exportarPedidosCSV(encerrados); } });
    }

    /* Recibo compacto: itens, total, status. Mais curto que a mensagem de
     * confirmação porque aqui o pedido já é passado — é comprovante, não
     * aviso de novidade. */
    function reenviarRecibo(p) {
        var fone = String(p.telefone || '').replace(/\D/g, '');
        if (fone.length < 10) { window.alert('Este pedido não tem telefone válido.'); return; }
        if (fone.length <= 11) fone = '55' + fone;

        var itens = Array.isArray(p.itens) ? p.itens : [];
        var linhas = itens.map(function (i) { return '• ' + i.nome + ' — ' + i.potes + ' potes'; }).join('\n');

        var msg = 'Recibo Temp Rio — pedido de ' + new Date(p.criado_em).toLocaleDateString('pt-BR') + '\n\n' +
            (linhas ? linhas + '\n\n' : '') +
            'Produtos: ' + brl(p.valor_centavos) + '\n' +
            'Frete: ' + brl(p.frete_centavos) + '\n' +
            'Total: ' + brl((p.valor_centavos || 0) + (Number(p.frete_centavos) || 0)) + '\n' +
            'Situação: ' + (STATUS[p.status] ? STATUS[p.status].rotulo : p.status);

        window.open('https://wa.me/' + fone + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
    }

    /* ===================================================================
     * Dashboard de vendas
     *
     * Diferente do Dashboard principal (que soma tudo, sem quebrar por nada),
     * esta aba responde "vendas de quê, e onde": por região, por produto, e a
     * evolução dia a dia. As duas funções de banco (vendas_por_produto e
     * visitas_por_regiao) já existem desde as migrações 007 e 008 — nasceram
     * pensando exatamente nesta tela, que só chegou agora.
     * =================================================================== */
    function desenharVendasBase() {
        var alvo = $('#vendas-site');

        if (!dados.resumo.length) {
            alvo.innerHTML = cartaoVazio('Nenhuma venda ainda',
                'Este painel de vendas preenche sozinho a partir do primeiro pedido confirmado.');
            return;
        }

        var porRegiao = dados.vendasRegiao
            .filter(function (r) { return Number(r.faturamento_centavos) > 0; })
            .sort(function (a, b) { return b.faturamento_centavos - a.faturamento_centavos; });

        var top10 = dados.vendasProduto.slice(0, 10);

        var v30 = receitaPorDia(30);
        var acumulado = 0;
        var v30Acumulada = v30.map(function (d) {
            acumulado += d.valor;
            return { rotulo: d.rotulo, valor: acumulado };
        });

        // Comparativo mês x mês anterior: as duas últimas linhas do resumo já
        // carregado — nenhuma consulta nova.
        var ultimo = dados.resumo[dados.resumo.length - 1];
        var anterior = dados.resumo.length > 1 ? dados.resumo[dados.resumo.length - 2] : null;

        alvo.innerHTML =
            '<div class="flex justify-end mb-5">' + botoesExportar('vendas') + '</div>' +

            '<div class="grid lg:grid-cols-2 gap-5 mb-5">' +
                '<div class="adm-card p-5">' +
                    '<p class="font-bold text-sm mb-1">Vendas por região</p>' +
                    '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">Faturamento confirmado + entregue, no período do filtro de mês.</p>' +
                    (porRegiao.length
                        ? '<div class="grid sm:grid-cols-2 gap-4 items-center">' +
                          '<div id="g-regiao"></div><div id="leg-regiao" class="space-y-1.5"></div>' +
                          '</div>'
                        : '<p class="adm-vazio">Nenhuma venda com região identificada ainda.</p>') +
                '</div>' +

                '<div class="adm-card p-5">' +
                    '<p class="font-bold text-sm mb-1">Top 10 produtos</p>' +
                    '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">Por faturamento, pedidos confirmados ou entregues.</p>' +
                    (top10.length
                        ? '<div id="t-top10" class="overflow-x-auto"></div>'
                        : '<p class="adm-vazio">Sem vendas por produto no período.</p>') +
                '</div>' +
            '</div>' +

            cartaoGrafico('g-vendasdia', 'Vendas por dia — últimos 30 dias',
                'A mesma janela do dashboard principal, aqui ao lado da quebra por região e produto.',
                't-vendasdia') +

            cartaoGrafico('g-acumulada', 'Receita acumulada — últimos 30 dias',
                'Soma corrida: cada ponto é tudo que entrou até aquele dia.',
                't-acumulada') +

            (anterior
                ? '<div class="adm-card p-5">' +
                      '<p class="font-bold text-sm mb-4">Comparativo — ' + esc(rotuloMes(ultimo.mes)) +
                          ' vs. ' + esc(rotuloMes(anterior.mes)) + '</p>' +
                      '<div id="t-comparativo" class="overflow-x-auto"></div>' +
                  '</div>'
                : '');

        if (porRegiao.length) {
            desenharPizza($('#g-regiao'), $('#leg-regiao'), porRegiao.map(function (r) {
                return { rotulo: r.regiao_nome, valor: Number(r.faturamento_centavos) };
            }), {
                formatarTotal: brlCurto, rotuloTotal: 'faturado', formatarLegenda: brl,
                descricao: 'Vendas por região',
                dica: function (d, pct) {
                    return '<strong>' + esc(d.rotulo) + '</strong><br>' + esc(brl(d.valor)) + ' (' + pct + '%)';
                }
            });
        }

        if (top10.length) {
            tabela($('#t-top10'), ['Produto', 'Pedidos', 'Potes', 'Faturamento'],
                top10.map(function (p) {
                    return [p.produto_nome, NUM.format(p.pedidos), NUM.format(p.potes), brl(p.faturamento_centavos)];
                }), [false, true, true, true]);
        }

        desenharColunas($('#g-vendasdia'), v30, {
            formatarEixo: brlCurto, formatarRotulo: brlCurto, rotularMaior: true,
            descricao: 'Vendas por dia, últimos 30 dias',
            dica: function (d) { return '<strong>' + esc(d.rotulo) + '</strong><br>' + esc(brl(d.valor)); }
        });
        tabela($('#t-vendasdia'), ['Dia', 'Receita'], v30.map(function (d) { return [d.rotulo, brl(d.valor)]; }), [false, true]);

        desenharLinha($('#g-acumulada'), v30Acumulada, {
            formatarEixo: brlCurto,
            descricao: 'Receita acumulada, últimos 30 dias',
            dica: function (d) { return '<strong>' + esc(d.rotulo) + '</strong><br>' + esc(brl(d.valor)) + ' acumulado'; }
        });
        tabela($('#t-acumulada'), ['Dia', 'Acumulado'], v30Acumulada.map(function (d) { return [d.rotulo, brl(d.valor)]; }), [false, true]);

        if (anterior) {
            function variacao(atual, antes) {
                if (!antes) return '—';
                var v = ((atual - antes) / antes) * 100;
                var seta = v > 0 ? '▲' : (v < 0 ? '▼' : '—');
                return seta + ' ' + Math.abs(Math.round(v)) + '%';
            }
            tabela($('#t-comparativo'), ['Indicador', rotuloMes(anterior.mes), rotuloMes(ultimo.mes), 'Variação'], [
                ['Faturamento', brl(anterior.faturamento_centavos), brl(ultimo.faturamento_centavos),
                    variacao(ultimo.faturamento_centavos, anterior.faturamento_centavos)],
                ['Pedidos confirmados', NUM.format(anterior.confirmados), NUM.format(ultimo.confirmados),
                    variacao(ultimo.confirmados, anterior.confirmados)],
                ['Pedidos iniciados', NUM.format(anterior.iniciados), NUM.format(ultimo.iniciados),
                    variacao(ultimo.iniciados, anterior.iniciados)]
            ], [false, true, true, true]);
        }

        ligarBotoesExportar(alvo, {
            vendas: function () {
                exportarCSV('vendas-por-produto', ['Produto', 'Pedidos', 'Potes', 'Faturamento'],
                    dados.vendasProduto.map(function (p) {
                        return [p.produto_nome, p.pedidos, p.potes, brl(p.faturamento_centavos)];
                    }));
            }
        });
    }

    /* ===================================================================
     * Lista de espera
     *
     * Antes vivia numa planilha do Google, separada dos pedidos. Trazida para
     * cá porque a pergunta que ela responde — onde há demanda represada — só
     * faz sentido ao lado do que já é vendido.
     * =================================================================== */
    /* Nome de cidade no eixo. Cortar no meio da palavra ("Belo Horizon")
     * fica pior do que abreviar: vira "Belo H.". O nome inteiro continua na
     * dica de valor e na tabela, então nada se perde. */
    function rotuloPraca(nome) {
        if (nome.length <= 11) return nome;
        var partes = nome.split(' ').filter(function (p) {
            return ['de', 'do', 'da', 'dos', 'das'].indexOf(p.toLowerCase()) === -1;
        });
        if (partes.length > 1) {
            var abrev = partes[0] + ' ' + partes[partes.length - 1].charAt(0) + '.';
            if (abrev.length <= 11) return abrev;
        }
        return nome.slice(0, 10) + '…';
    }

    function desenharEspera() {
        var alvo = $('#painel-espera');
        var lista = dados.espera;

        if (!lista.length) {
            alvo.innerHTML = cartaoVazio('Ninguém na lista de espera',
                'Quando alguém de fora da área de entrega pedir para ser avisado, ' +
                'aparece aqui — junto com o tamanho do pedido que não pôde ser atendido.');
            return;
        }

        var pendentes = lista.filter(function (e) { return !e.atendido; });
        var represado = pendentes.reduce(function (a, e) { return a + Number(e.valor_centavos || 0); }, 0);

        // Agrupa por praça: é isto que transforma uma lista de nomes numa
        // decisão sobre onde abrir entrega primeiro.
        var porPraca = {};
        pendentes.forEach(function (e) {
            var k = (e.cidade || 'Sem cidade') + '/' + (e.uf || '--');
            if (!porPraca[k]) porPraca[k] = { praca: k, uf: e.uf, empresas: 0, potes: 0, valor: 0 };
            porPraca[k].empresas++;
            porPraca[k].potes += Number(e.potes || 0);
            porPraca[k].valor += Number(e.valor_centavos || 0);
        });

        var pracas = Object.keys(porPraca).map(function (k) { return porPraca[k]; })
            .sort(function (a, b) { return b.valor - a.valor; });

        // Mais de 8 colunas viram borrão: o resto vira "Outras".
        var noGrafico = pracas.slice(0, 8);
        if (pracas.length > 8) {
            var resto = pracas.slice(8).reduce(function (a, p) {
                return { praca: 'Outras', empresas: a.empresas + p.empresas,
                         potes: a.potes + p.potes, valor: a.valor + p.valor };
            }, { empresas: 0, potes: 0, valor: 0 });
            noGrafico = noGrafico.concat([resto]);
        }

        var maiorPraca = pracas[0];

        alvo.innerHTML =
            '<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">' +
                ficha('Empresas esperando', NUM.format(pendentes.length),
                      lista.length > pendentes.length
                        ? NUM.format(lista.length - pendentes.length) + ' já atendidas'
                        : 'nenhuma atendida ainda') +
                ficha('Demanda represada', brl(represado), 'soma dos pedidos não atendidos') +
                ficha('Praça com mais demanda', maiorPraca ? maiorPraca.praca : '—',
                      maiorPraca ? brl(maiorPraca.valor) : '') +
                ficha('Praças diferentes', NUM.format(pracas.length), 'cidades aguardando') +
            '</div>' +

            cartaoGrafico('g-espera', 'Demanda represada por praça',
                'Quanto de pedido cada cidade tentou fazer e não pôde ser atendida. ' +
                'A maior barra é por onde vale a pena abrir entrega primeiro.',
                't-espera') +

            '<div class="adm-card p-5">' +
                '<p class="font-bold text-sm mb-1">Quem está esperando</p>' +
                '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">' +
                    'Marque como atendida depois de falar com a empresa.' +
                '</p>' +
                '<div class="space-y-3">' + lista.map(cartaoEspera).join('') + '</div>' +
            '</div>';

        desenharColunas($('#g-espera'), noGrafico.map(function (p) {
            return { rotulo: rotuloPraca(p.praca.split('/')[0]), valor: p.valor, extra: p };
        }), {
            formatarEixo: brlCurto,
            formatarRotulo: brlCurto,
            rotularMaior: true,
            descricao: 'Demanda represada por praça',
            dica: function (d) {
                return '<strong>' + esc(d.extra.praca) + '</strong><br>' + esc(brl(d.valor)) +
                       '<br>' + NUM.format(d.extra.empresas) +
                       (d.extra.empresas === 1 ? ' empresa' : ' empresas') +
                       ' · ' + NUM.format(d.extra.potes) + ' potes';
            }
        });

        tabela($('#t-espera'), ['Praça', 'Empresas', 'Potes', 'Demanda represada'],
            pracas.map(function (p) {
                return [p.praca, NUM.format(p.empresas), NUM.format(p.potes), brl(p.valor)];
            }), [false, true, true, true]);

        ligarAcoesDeEspera(alvo);
    }

    function cartaoEspera(e) {
        return '<div class="adm-card p-4"' + (e.atendido ? ' style="opacity:.55"' : '') + '>' +
            '<div class="flex items-start justify-between gap-4 flex-wrap">' +
                '<div class="min-w-0">' +
                    '<p class="font-bold text-sm">' + esc(e.razao_social || 'Sem razão social') + '</p>' +
                    '<p class="text-xs mt-0.5" style="color:var(--adm-tinta-3)">' +
                        (e.cnpj ? 'CNPJ ' + esc(e.cnpj) + ' · ' : '') +
                        esc((e.cidade || '') + '/' + (e.uf || '')) +
                        ' · ' + esc(new Date(e.criado_em).toLocaleDateString('pt-BR')) +
                    '</p>' +
                    '<p class="text-xs mt-1.5" style="color:var(--adm-tinta-2)">' +
                        esc(e.responsavel || '') + ' · ' + esc(e.telefone || '') +
                        (e.email ? ' · ' + esc(e.email) : '') +
                    '</p>' +
                '</div>' +
                '<div class="text-right shrink-0">' +
                    '<p class="adm-tile-valor" style="font-size:1.1rem">' + esc(brl(e.valor_centavos)) + '</p>' +
                    '<p class="text-xs" style="color:var(--adm-tinta-3)">' +
                        NUM.format(e.potes) + ' potes</p>' +
                '</div>' +
            '</div>' +

            (e.itens
                ? '<p class="text-xs mt-3" style="color:var(--adm-tinta-3)">' + esc(e.itens) + '</p>'
                : '') +

            '<div class="flex items-center gap-2 flex-wrap mt-3 pt-3" style="border-top:1px solid var(--adm-borda)">' +
                (e.atendido
                    ? '<span class="adm-selo adm-selo-entregue"><i class="fa-solid fa-check"></i>Atendida</span>' +
                      '<button type="button" class="adm-botao-fantasma" data-espera="' + esc(e.id) + '" data-atendido="false">Reabrir</button>'
                    : '<button type="button" class="adm-botao-fantasma" data-espera="' + esc(e.id) + '" data-atendido="true">' +
                      '<i class="fa-solid fa-check mr-1"></i>Marcar atendida</button>') +
                '<a href="https://wa.me/' + esc(String(e.telefone || '').replace(/\D/g, '').replace(/^/, '55')) + '"' +
                    ' target="_blank" rel="noopener" class="adm-botao-fantasma ml-auto">' +
                    '<i class="fa-brands fa-whatsapp mr-1"></i>Chamar</a>' +
            '</div>' +
        '</div>';
    }

    function ligarAcoesDeEspera(raiz) {
        raiz.querySelectorAll('button[data-espera]').forEach(function (b) {
            b.addEventListener('click', function () {
                b.disabled = true;
                sb.from('lista_espera')
                    .update({ atendido: b.getAttribute('data-atendido') === 'true' })
                    .eq('id', b.getAttribute('data-espera'))
                    .then(function (r) {
                        b.disabled = false;
                        if (r.error) {
                            window.alert('Não foi possível atualizar: ' + r.error.message);
                            return;
                        }
                        carregar();
                    });
            });
        });
    }

    /* ===================================================================
     * Vitrine "Onde comprar"
     *
     * Aprovar publica a loja do lojista na seção do catálogo, pelo prazo do
     * plano. As datas são calculadas NO BANCO (função decidir_vitrine): assim o
     * prazo não depende do relógio da máquina de quem clicou.
     * =================================================================== */
    var PLANOS = {
        basic:   { rotulo: 'Basic',   icone: 'fa-star' },
        pro:     { rotulo: 'Pro',     icone: 'fa-star-half-stroke' },
        premium: { rotulo: 'Premium', icone: 'fa-crown' }
    };

    function diasRestantes(dataFim) {
        if (!dataFim) return 0;
        var fim = new Date(String(dataFim).slice(0, 10) + 'T00:00:00');
        var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        var d = Math.round((fim - hoje) / 86400000);
        return d < 0 ? 0 : d + 1; // data_fim é o último dia inclusive
    }

    function vigente(v) {
        return v.status === 'aprovado' && diasRestantes(v.data_fim) > 0;
    }

    function desenharVitrineBase() {
        var alvo = $('#lojistas-corpo');
        var lista = dados.vitrines;

        if (!lista.length) {
            alvo.innerHTML = cartaoVazio('Nenhum pedido de destaque',
                'Quando um cliente aceitar o convite no fim do pedido, ele aparece aqui ' +
                'para você aprovar. O convite só é oferecido a partir do segundo pedido ' +
                'ou de pedidos grandes.');
            return;
        }

        var pendentes = lista.filter(function (v) { return v.status === 'pendente'; });
        var noAr = lista.filter(vigente);
        var encerradas = lista.filter(function (v) {
            return v.status === 'aprovado' && !vigente(v);
        });
        var rejeitadas = lista.filter(function (v) { return v.status === 'rejeitado'; });

        alvo.innerHTML =
            '<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">' +
                ficha('Esperando você', NUM.format(pendentes.length),
                      pendentes.length ? 'aprove ou recuse' : 'nada pendente') +
                ficha('No ar agora', NUM.format(noAr.length), 'aparecendo no catálogo') +
                ficha('Já encerradas', NUM.format(encerradas.length), 'prazo cumprido') +
                ficha('Recusadas', NUM.format(rejeitadas.length), '') +
            '</div>' +

            (pendentes.length
                ? '<p class="font-bold text-sm mb-3">Esperando aprovação</p>' +
                  '<div class="space-y-3 mb-8">' + pendentes.map(cartaoVitrine).join('') + '</div>'
                : '') +

            (noAr.length
                ? '<p class="font-bold text-sm mb-3">No ar agora</p>' +
                  '<div class="space-y-3 mb-8">' + noAr.map(cartaoVitrine).join('') + '</div>'
                : '') +

            (encerradas.length + rejeitadas.length
                ? '<details><summary class="text-xs cursor-pointer mb-3" style="color:var(--adm-tinta-3)">' +
                  'Ver encerradas e recusadas (' + (encerradas.length + rejeitadas.length) + ')</summary>' +
                  '<div class="space-y-3 mt-3">' +
                  encerradas.concat(rejeitadas).map(cartaoVitrine).join('') + '</div></details>'
                : '');

        ligarAcoesDeVitrine(alvo);
    }

    function cartaoVitrine(v) {
        var plano = PLANOS[v.tipo] || { rotulo: v.tipo, icone: 'fa-star' };
        var dias = diasRestantes(v.data_fim);
        var estaNoAr = vigente(v);

        var etiqueta;
        if (v.status === 'pendente') {
            etiqueta = '<span class="adm-selo adm-selo-aguardando"><i class="fa-solid fa-clock"></i>Pendente</span>';
        } else if (v.status === 'rejeitado') {
            etiqueta = '<span class="adm-selo adm-selo-cancelado"><i class="fa-solid fa-circle-xmark"></i>Recusada</span>';
        } else if (estaNoAr) {
            etiqueta = '<span class="adm-selo adm-selo-confirmado"><i class="fa-solid fa-circle-check"></i>' +
                       'No ar · ' + dias + (dias === 1 ? ' dia' : ' dias') + '</span>';
        } else {
            etiqueta = '<span class="adm-selo adm-selo-entregue"><i class="fa-solid fa-flag-checkered"></i>Encerrada</span>';
        }

        return '<div class="adm-card p-5"' + (v.status === 'pendente' ? '' : ' style="opacity:.75"') + '>' +
            '<div class="flex items-start justify-between gap-4 flex-wrap mb-3">' +
                '<div>' +
                    '<p class="font-bold">' + esc(v.razao_social) + '</p>' +
                    '<p class="text-xs mt-0.5" style="color:var(--adm-tinta-3)">' +
                        'CNPJ ' + esc(v.cnpj) + ' · ' +
                        esc([v.bairro, v.cidade].filter(Boolean).join(', ')) + '/' + esc(v.uf || '') +
                        ' · ' + esc(new Date(v.criado_em).toLocaleDateString('pt-BR')) +
                    '</p>' +
                '</div>' +
                etiqueta +
            '</div>' +

            '<div class="grid sm:grid-cols-3 gap-4 text-xs mb-4">' +
                '<div>' +
                    '<p class="adm-tile-rotulo mb-1">Plano sugerido</p>' +
                    '<p class="text-white"><i class="fa-solid ' + plano.icone + ' mr-1" ' +
                        'style="color:var(--adm-dados)"></i>' + esc(plano.rotulo) + ' · ' +
                        v.dias + (v.dias === 1 ? ' dia' : ' dias') + '</p>' +
                '</div>' +
                '<div>' +
                    '<p class="adm-tile-rotulo mb-1">Pedido que gerou</p>' +
                    '<p class="text-white">' + NUM.format(v.caixas) + ' caixas · ' +
                        esc(brl(v.valor_centavos)) + '</p>' +
                '</div>' +
                '<div>' +
                    '<p class="adm-tile-rotulo mb-1">Contato</p>' +
                    '<p style="color:var(--adm-tinta-2)">' + esc(v.responsavel || '') + '<br>' +
                        esc(v.telefone || '') + '</p>' +
                '</div>' +
            '</div>' +

            (v.motivos && v.motivos.length
                ? '<p class="text-xs mb-4 p-3 rounded-lg" style="background:var(--adm-neutro-fundo);color:var(--adm-tinta-2)">' +
                  '<strong>Ganhou por:</strong> ' + esc(v.motivos.join(' · ')) + '</p>'
                : '') +

            (v.data_inicio
                ? '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">No ar de ' +
                  esc(new Date(v.data_inicio + 'T00:00:00').toLocaleDateString('pt-BR')) + ' a ' +
                  esc(new Date(v.data_fim + 'T00:00:00').toLocaleDateString('pt-BR')) + '</p>'
                : '') +

            (v.status === 'pendente'
                ? '<div class="flex items-center gap-2 flex-wrap pt-3" style="border-top:1px solid var(--adm-borda)">' +
                      '<button type="button" class="adm-botao" style="padding:.5rem .9rem;font-size:.8rem" ' +
                          'data-vitrine="' + esc(v.id) + '" data-aprovar="true">' +
                          '<i class="fa-solid fa-check mr-1"></i>Publicar no site</button>' +
                      '<button type="button" class="adm-botao-fantasma" ' +
                          'data-vitrine="' + esc(v.id) + '" data-aprovar="false">Recusar</button>' +
                      linkWhats(v.telefone) +
                  '</div>'
                : '') +
        '</div>';
    }

    /* Sem telefone não há botão: um wa.me/55 abre uma conversa vazia e parece
     * um bug do painel. */
    function linkWhats(telefone) {
        var so = String(telefone || '').replace(/\D/g, '');
        if (so.length < 10) return '';
        if (so.length <= 11) so = '55' + so;
        return '<a href="https://wa.me/' + so + '" target="_blank" rel="noopener"' +
               ' class="adm-botao-fantasma ml-auto">' +
               '<i class="fa-brands fa-whatsapp mr-1"></i>Chamar</a>';
    }

    function ligarAcoesDeVitrine(raiz) {
        raiz.querySelectorAll('button[data-vitrine]').forEach(function (b) {
            b.addEventListener('click', function () {
                var aprovar = b.getAttribute('data-aprovar') === 'true';
                if (!aprovar && !window.confirm('Recusar este pedido de destaque?')) return;

                b.disabled = true;
                // decidir_vitrine calcula as datas no banco. Fazer isso aqui
                // deixaria o prazo à mercê do relógio desta máquina.
                sb.rpc('decidir_vitrine', {
                    p_id: b.getAttribute('data-vitrine'),
                    p_aprovar: aprovar,
                    p_observacao: null
                }).then(function (r) {
                    b.disabled = false;
                    if (r.error) { window.alert('Não foi possível decidir: ' + r.error.message); return; }
                    carregar();
                });
            });
        });
    }

    /* ===================================================================
     * Regiões de entrega
     *
     * Ativar e desativar tem efeito imediato no site: a página de pedido lê
     * esta tabela para calcular o frete. Desativar uma região não apaga nada —
     * quem tentar comprar de lá cai na lista de espera, e você reativa depois.
     * =================================================================== */
    function faixasDe(regiaoId) {
        return dados.faixas.filter(function (f) { return f.regiao_id === regiaoId; });
    }

    function formatarCep(c) {
        var d = String(c || '').replace(/\D/g, '');
        return d.length === 8 ? d.slice(0, 5) + '-' + d.slice(5) : d;
    }

    function desenharRegioesBase() {
        var alvo = $('#painel-regioes');
        var lista = dados.regioes;

        if (!lista.length) {
            alvo.innerHTML = cartaoVazio('Nenhuma região cadastrada',
                'Rode admin/supabase-regioes.sql no SQL Editor do Supabase. ' +
                'Enquanto isso, o site usa as regiões do arquivo data/regioes.js.');
            return;
        }

        var ativas = lista.filter(function (r) { return r.ativo; });
        var comFaixa = lista.filter(function (r) { return faixasDe(r.id).length > 0; });

        alvo.innerHTML =
            '<div class="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-7">' +
                ficha('Regiões atendidas', NUM.format(ativas.length),
                      'de ' + NUM.format(lista.length) + ' cadastradas') +
                ficha('Frete médio', ativas.length
                        ? brl(Math.round(ativas.reduce(function (a, r) {
                              return a + Number(r.taxa_centavos); }, 0) / ativas.length))
                        : brl(0),
                      'entre as regiões ativas') +
                ficha('Sem faixa de CEP', NUM.format(lista.length - comFaixa.length),
                      (lista.length - comFaixa.length) ? 'nunca vão casar com um CEP' : 'todas configuradas') +
            '</div>' +

            '<div class="adm-card p-4 mb-5" style="border-color:var(--adm-acao-borda);background:var(--adm-acao-fundo)">' +
                '<p class="text-xs leading-relaxed" style="color:var(--adm-tinta-2)">' +
                    '<strong>As taxas e prazos vieram de um exemplo, não de você.</strong> ' +
                    'As faixas de CEP também são aproximadas, não uma fonte oficial dos Correios. ' +
                    'Confira e ajuste tudo antes de publicar: um limite errado cobra frete errado ' +
                    'ou recusa um cliente válido.' +
                '</p>' +
            '</div>' +

            '<div class="space-y-3">' + lista.map(cartaoRegiao).join('') + '</div>';

        ligarAcoesDeRegiao(alvo);
    }

    function cartaoRegiao(r) {
        var faixas = faixasDe(r.id);

        return '<div class="adm-card p-5"' + (r.ativo ? '' : ' style="opacity:.55"') + '>' +
            '<div class="flex items-start justify-between gap-4 flex-wrap mb-4">' +
                '<div>' +
                    '<p class="font-bold">' + esc(r.nome) + '</p>' +
                    '<p class="text-xs mt-1" style="color:var(--adm-tinta-3)">' +
                        (faixas.length
                            ? faixas.map(function (f) {
                                  return esc(formatarCep(f.cep_inicio)) + ' a ' + esc(formatarCep(f.cep_fim));
                              }).join(' · ')
                            : '<span style="color:var(--adm-ruim)">Sem faixa de CEP — esta região nunca vai casar com um pedido</span>') +
                    '</p>' +
                '</div>' +
                (r.ativo
                    ? '<span class="adm-selo adm-selo-confirmado"><i class="fa-solid fa-circle-check"></i>Entregando</span>'
                    : '<span class="adm-selo adm-selo-cancelado"><i class="fa-solid fa-ban"></i>Sem entrega</span>') +
            '</div>' +

            '<div class="flex items-end gap-4 flex-wrap">' +
                '<div>' +
                    '<label class="adm-tile-rotulo block mb-1" for="taxa-' + esc(r.id) + '">Frete (R$)</label>' +
                    '<input id="taxa-' + esc(r.id) + '" type="number" min="0" step="0.01" ' +
                        'value="' + (Number(r.taxa_centavos) / 100).toFixed(2) + '" ' +
                        'class="adm-input" style="width:110px" data-campo-regiao="taxa" data-id="' + esc(r.id) + '">' +
                '</div>' +
                '<div>' +
                    '<label class="adm-tile-rotulo block mb-1" for="prazo-' + esc(r.id) + '">Prazo (dias úteis)</label>' +
                    '<input id="prazo-' + esc(r.id) + '" type="number" min="0" step="1" ' +
                        'value="' + Number(r.prazo_dias) + '" ' +
                        'class="adm-input" style="width:110px" data-campo-regiao="prazo" data-id="' + esc(r.id) + '">' +
                '</div>' +
                '<button type="button" class="adm-botao" style="padding:.55rem .9rem;font-size:.8rem" ' +
                    'data-salvar-regiao="' + esc(r.id) + '">Salvar</button>' +
                '<button type="button" class="adm-botao-fantasma ml-auto" ' +
                    'data-alternar-regiao="' + esc(r.id) + '" data-ativo="' + (r.ativo ? 'false' : 'true') + '">' +
                    (r.ativo
                        ? '<i class="fa-solid fa-ban mr-1"></i>Suspender entrega'
                        : '<i class="fa-solid fa-play mr-1"></i>Voltar a entregar') +
                '</button>' +
            '</div>' +

            (r.bairros && r.bairros.length
                ? '<p class="text-xs mt-4 pt-3" style="border-top:1px solid var(--adm-borda);color:var(--adm-tinta-3)">' +
                  esc(r.bairros.join(' · ')) + '</p>'
                : '') +
        '</div>';
    }

    function ligarAcoesDeRegiao(raiz) {
        raiz.querySelectorAll('button[data-alternar-regiao]').forEach(function (b) {
            b.addEventListener('click', function () {
                var ativo = b.getAttribute('data-ativo') === 'true';
                if (!ativo && !window.confirm(
                        'Suspender a entrega nesta região?\n\n' +
                        'Quem tentar comprar de lá vai ver a mensagem de indisponibilidade ' +
                        'e a opção de entrar na lista de espera. Nada é apagado.')) return;

                b.disabled = true;
                sb.from('regioes').update({ ativo: ativo })
                    .eq('id', b.getAttribute('data-alternar-regiao'))
                    .then(function (r) {
                        b.disabled = false;
                        if (r.error) { window.alert('Não foi possível atualizar: ' + r.error.message); return; }
                        carregar();
                    });
            });
        });

        raiz.querySelectorAll('button[data-salvar-regiao]').forEach(function (b) {
            b.addEventListener('click', function () {
                var id = b.getAttribute('data-salvar-regiao');
                var taxa = raiz.querySelector('[data-campo-regiao="taxa"][data-id="' + id + '"]');
                var prazo = raiz.querySelector('[data-campo-regiao="prazo"][data-id="' + id + '"]');

                // Centavos inteiros: o preço nunca vira float em lugar nenhum
                // do sistema, e não vai começar aqui.
                var centavos = Math.round(Number(taxa.value) * 100);
                var dias = Math.trunc(Number(prazo.value));
                if (!isFinite(centavos) || centavos < 0) { window.alert('Frete inválido.'); return; }
                if (!isFinite(dias) || dias < 0) { window.alert('Prazo inválido.'); return; }

                b.disabled = true;
                b.textContent = 'Salvando...';
                sb.from('regioes').update({ taxa_centavos: centavos, prazo_dias: dias })
                    .eq('id', id)
                    .then(function (r) {
                        b.disabled = false;
                        b.textContent = 'Salvar';
                        if (r.error) { window.alert('Não foi possível salvar: ' + r.error.message); return; }
                        carregar();
                    });
            });
        });
    }

    /* ===================================================================
     * Visitas
     * =================================================================== */
    function desenharVisitas() {
        var alvo = $('#painel-visitas');
        var v = dados.visitas;

        // O HTML inteiro do painel é substituído logo abaixo — o <div> que o
        // mapa ocupava deixa de existir. Um objeto Leaflet apontando para um
        // nó removido do DOM trava na próxima atualização, então ele morre
        // aqui e nasce de novo em desenharMonitorGeografico().
        if (mapaVisitas) { mapaVisitas.remove(); mapaVisitas = null; mapaVisitasCamada = null; }

        if (!v.length) {
            alvo.innerHTML = cartaoVazio('Nenhuma visita registrada',
                'A contagem começa quando o site com o painel conectado entrar no ar. ' +
                'Cada abertura de página vira um registro seu — sem cookie e sem terceiros.');
            return;
        }

        var totalV = v.reduce(function (a, r) { return a + Number(r.visitas); }, 0);
        var totalS = v.reduce(function (a, r) { return a + Number(r.sessoes); }, 0);
        var porSessao = totalS ? (totalV / totalS).toFixed(1).replace('.', ',') : '0';

        alvo.innerHTML =
            '<div class="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-7">' +
                ficha('Páginas vistas no período', NUM.format(totalV), '') +
                ficha('Sessões', NUM.format(totalS), 'visitas distintas') +
                ficha('Páginas por sessão', porSessao, 'quanto navegam antes de sair') +
            '</div>' +

            cartaoGrafico('g-visitas', 'Sessões por mês',
                'Uma sessão é uma pessoa navegando. Sem cookie, sem terceiros, sem IP guardado.',
                't-visitas') +

            htmlMonitorGeografico();

        desenharLinha($('#g-visitas'), v.map(function (r) {
            return { rotulo: rotuloMes(r.mes), valor: Number(r.sessoes), extra: r };
        }), {
            descricao: 'Sessões por mês',
            dica: function (d) {
                return '<strong>' + esc(d.rotulo) + '</strong><br>' +
                       NUM.format(d.valor) + ' sessões<br>' +
                       NUM.format(d.extra.visitas) + ' páginas vistas';
            }
        });

        tabela($('#t-visitas'), ['Mês', 'Sessões', 'Páginas vistas'],
            v.map(function (r) {
                return [rotuloMes(r.mes), NUM.format(r.sessoes), NUM.format(r.visitas)];
            }), [false, true, true]);

        ligarMonitorGeografico(alvo);
        desenharMonitorGeografico();
    }

    /* ===================================================================
     * Monitor geográfico — mapa e tabela de visitas por região
     *
     * "Onde" vem do CEP que o próprio visitante digita na página de pedido,
     * não de IP nem de geolocalização do navegador — a mesma fonte que a
     * migração 007 já usa para o relatório mensal, aqui só olhada sessão a
     * sessão. Sem coleta nova, sem custo de API paga, sem novo dado pessoal:
     * ver a nota grande no topo de admin/migracoes/007_visitas_regiao.sql.
     *
     * Bolha por região, não ponto por visita: o dado é "essa sessão bateu no
     * CEP tal", não uma coordenada exata — um verdadeiro mapa de calor
     * inventaria uma precisão que a coleta não tem.
     * =================================================================== */
    var REGIAO_COORDS = {
        'centro':            [-22.9068, -43.1729],
        'zona-sul':          [-22.9707, -43.1823],
        'zona-norte':        [-22.9235, -43.2369],
        'barra-jacarepagua': [-22.9990, -43.3652],
        'zona-oeste':        [-22.8756, -43.6217],
        'niteroi':           [-22.8832, -43.1034],
        'sao-goncalo':       [-22.8268, -43.0539],
        'baixada':           [-22.7556, -43.4111]
        // 'resto-rj' fica de fora de propósito: é "todo o resto do estado",
        // sem um ponto único que o represente sem enganar.
    };

    var visitasJanela = '7d';
    var visitasPagina = 1;
    var POR_PAGINA_VISITAS = 20;
    var mapaVisitas = null;
    var mapaVisitasCamada = null;

    function regiaoNome(id) {
        if (!id) return 'Sem CEP informado';
        var r = dados.regioes.filter(function (x) { return x.id === id; })[0];
        return r ? r.nome : id;
    }

    var DISPOSITIVO_ROTULO = { celular: 'Celular', tablet: 'Tablet', computador: 'Computador' };

    function visitaBrutaPassaNaJanela(r) {
        if (visitasJanela === 'tudo') return true;
        var horas = visitasJanela === '24h' ? 24 : (visitasJanela === '7d' ? 24 * 7 : 24 * 30);
        var corte = Date.now() - horas * 60 * 60 * 1000;
        return new Date(r.criado_em).getTime() >= corte;
    }

    function htmlMonitorGeografico() {
        return '<div class="adm-card p-5 mb-7">' +
            '<div class="flex items-start justify-between flex-wrap gap-3 mb-1">' +
                '<div>' +
                    '<p class="font-bold text-sm mb-1">Monitor geográfico</p>' +
                    '<p class="text-xs" style="color:var(--adm-tinta-3)">' +
                        'Por região de CEP consultado na página de pedido — não por IP. ' +
                        'Só conta quem chegou a consultar o frete.' +
                    '</p>' +
                '</div>' +
                '<div class="flex gap-1">' +
                    ['24h', '7d', '30d', 'tudo'].map(function (j) {
                        var rot = j === '24h' ? 'Últimas 24h' : j === '7d' ? '7 dias' : j === '30d' ? '30 dias' : 'Tudo';
                        return '<button type="button" class="adm-chip' + (visitasJanela === j ? ' is-ativo' : '') +
                            '" data-visitas-janela="' + j + '">' + rot + '</button>';
                    }).join('') +
                '</div>' +
            '</div>' +
            '<div id="mapa-visitas" style="height:360px;border-radius:.75rem;margin-top:1rem;overflow:hidden"></div>' +
            '<div id="stats-visitas" class="grid sm:grid-cols-2 gap-4 mt-5"></div>' +
            '<div class="flex items-center justify-between flex-wrap gap-3 mt-6 mb-3">' +
                '<p class="font-bold text-sm">Sessões recentes</p>' +
                botoesExportar('visitas-geo') +
            '</div>' +
            '<p class="text-xs mb-3" style="color:var(--adm-tinta-3)">' +
                'Sessões anônimas — sem nome, sem contato. Vira contato só quando a pessoa preenche o pop-up (aba Leads).' +
            '</p>' +
            '<div id="tabela-visitas-geo"></div>' +
        '</div>';
    }

    function ligarMonitorGeografico(alvo) {
        alvo.querySelectorAll('[data-visitas-janela]').forEach(function (b) {
            b.addEventListener('click', function () {
                visitasJanela = b.getAttribute('data-visitas-janela');
                visitasPagina = 1;
                desenharVisitas();
            });
        });
    }

    function desenharMonitorGeografico() {
        var filtradas = dados.visitasBrutas.filter(visitaBrutaPassaNaJanela);

        // --- Mapa: uma bolha por região, raio proporcional a sessões distintas ---
        var alvoMapa = $('#mapa-visitas');
        if (alvoMapa && typeof L !== 'undefined') {
            if (!mapaVisitas) {
                mapaVisitas = L.map('mapa-visitas', { scrollWheelZoom: false })
                    .setView([-22.92, -43.35], 10);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; OpenStreetMap',
                    maxZoom: 18
                }).addTo(mapaVisitas);
            }
            if (mapaVisitasCamada) { mapaVisitas.removeLayer(mapaVisitasCamada); }

            var porRegiaoMapa = {};
            filtradas.forEach(function (r) {
                if (!r.regiao_id || !REGIAO_COORDS[r.regiao_id]) return;
                porRegiaoMapa[r.regiao_id] = (porRegiaoMapa[r.regiao_id] || 0) + 1;
            });
            var maiorContagem = Math.max.apply(null, Object.keys(porRegiaoMapa).map(function (k) { return porRegiaoMapa[k]; }).concat([1]));

            mapaVisitasCamada = L.layerGroup();
            Object.keys(porRegiaoMapa).forEach(function (id) {
                var n = porRegiaoMapa[id];
                var raio = 8 + Math.round((n / maiorContagem) * 26);
                L.circleMarker(REGIAO_COORDS[id], {
                    radius: raio, color: corToken('--adm-dados', '#6fa8e0'), weight: 1,
                    fillColor: corToken('--adm-dados', '#6fa8e0'), fillOpacity: 0.45
                }).bindTooltip(esc(regiaoNome(id)) + ': ' + NUM.format(n) + (n === 1 ? ' sessão' : ' sessões'))
                  .addTo(mapaVisitasCamada);
            });
            mapaVisitasCamada.addTo(mapaVisitas);
            // Mapa sem bolha nenhuma (nenhum CEP consultado na janela) já é
            // avisado pelo cartão "Por região" logo abaixo — sem duplicar o
            // aviso dentro do próprio mapa.
            setTimeout(function () { if (mapaVisitas) mapaVisitas.invalidateSize(); }, 50);
        } else if (alvoMapa) {
            alvoMapa.innerHTML = '<p class="adm-vazio">Mapa indisponível (biblioteca não carregou).</p>';
        }

        // --- Estatísticas: região e dispositivo, só desta janela ---
        var porRegiao = {}, porDispositivo = {};
        filtradas.forEach(function (r) {
            var rid = r.regiao_id || 'sem-cep';
            porRegiao[rid] = (porRegiao[rid] || 0) + 1;
            var disp = r.dispositivo || 'desconhecido';
            porDispositivo[disp] = (porDispositivo[disp] || 0) + 1;
        });
        var listaRegiao = Object.keys(porRegiao)
            .map(function (id) { return { rotulo: id === 'sem-cep' ? 'Sem CEP informado' : regiaoNome(id), valor: porRegiao[id] }; })
            .sort(function (a, b) { return b.valor - a.valor; });
        var listaDispositivo = Object.keys(porDispositivo)
            .map(function (d) { return { rotulo: DISPOSITIVO_ROTULO[d] || 'Desconhecido', valor: porDispositivo[d] }; })
            .sort(function (a, b) { return b.valor - a.valor; });

        var alvoStats = $('#stats-visitas');
        if (alvoStats) {
            alvoStats.innerHTML =
                '<div class="adm-card p-4">' +
                    '<p class="font-bold text-sm mb-3">Por região</p>' +
                    (listaRegiao.length
                        ? listaRegiao.map(function (d) {
                              return '<div class="flex items-center justify-between text-sm py-1">' +
                                  '<span>' + esc(d.rotulo) + '</span><span style="color:var(--adm-tinta-3)">' + NUM.format(d.valor) + '</span></div>';
                          }).join('')
                        : '<p class="adm-vazio">Sem dados nesta janela.</p>') +
                '</div>' +
                '<div class="adm-card p-4">' +
                    '<p class="font-bold text-sm mb-3">Por dispositivo</p>' +
                    (listaDispositivo.length
                        ? listaDispositivo.map(function (d) {
                              return '<div class="flex items-center justify-between text-sm py-1">' +
                                  '<span>' + esc(d.rotulo) + '</span><span style="color:var(--adm-tinta-3)">' + NUM.format(d.valor) + '</span></div>';
                          }).join('')
                        : '<p class="adm-vazio">Sem dados nesta janela.</p>') +
                '</div>';
        }

        // --- Tabela de sessões recentes ---
        var ordenadas = filtradas.slice().sort(function (a, b) { return new Date(b.criado_em) - new Date(a.criado_em); });
        var pag = paginar(ordenadas, visitasPagina, POR_PAGINA_VISITAS);
        visitasPagina = pag.pagina;

        var alvoTabela = $('#tabela-visitas-geo');
        if (alvoTabela) {
            alvoTabela.innerHTML = ordenadas.length
                ? '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr>' +
                      '<th>Quando</th><th>Página</th><th>Região</th><th>Dispositivo</th>' +
                  '</tr></thead><tbody>' +
                      pag.itens.map(function (r) {
                          return '<tr>' +
                              '<td>' + esc(dataHora(r.criado_em)) + '</td>' +
                              '<td>' + esc(r.pagina || '—') + '</td>' +
                              '<td>' + esc(regiaoNome(r.regiao_id)) + '</td>' +
                              '<td>' + esc(DISPOSITIVO_ROTULO[r.dispositivo] || '—') + '</td>' +
                          '</tr>';
                      }).join('') +
                  '</tbody></table></div>' +
                  controlesDePaginacao('visitasgeo', pag.pagina, pag.totalPaginas)
                : '<p class="adm-vazio">Nenhuma sessão nesta janela.</p>';

            alvoTabela.querySelectorAll('[data-pagina^="visitasgeo:"]').forEach(function (b) {
                b.addEventListener('click', function () {
                    visitasPagina = Number(b.getAttribute('data-pagina').split(':')[1]);
                    desenharMonitorGeografico();
                });
            });
        }

        var raizExportar = $('#painel-visitas');
        if (raizExportar) {
            ligarBotoesExportar(raizExportar, {
                'visitas-geo': function () { exportarVisitasGeoCSV(ordenadas); }
            });
        }
    }

    function exportarVisitasGeoCSV(lista) {
        exportarCSV('visitas-por-regiao', ['Data', 'Página', 'Região', 'CEP', 'Dispositivo', 'Referência'],
            lista.map(function (r) {
                return [dataHora(r.criado_em), r.pagina, regiaoNome(r.regiao_id), r.cep || '', DISPOSITIVO_ROTULO[r.dispositivo] || '', r.referencia || ''];
            }));
    }

    /* ===================================================================
     * Leads — captados pelo pop-up de pré-registro do catálogo
     *
     * Mesmo padrão de tabela/paginação/exportação de Clientes. Diferente de
     * Clientes, um lead não vira cliente sozinho — é só um contato que se
     * ofereceu, ainda sem pedido nenhum (ver admin/migracoes/011).
     * =================================================================== */
    var leadsPagina = 1;
    var POR_PAGINA_LEADS = 20;
    var leadsFiltroTipo = 'todos'; // todos | cpf | cnpj

    function leadPassaNoFiltro(l) {
        if (filtros.de && String(l.criado_em).slice(0, 10) < filtros.de) return false;
        if (filtros.ate && String(l.criado_em).slice(0, 10) > filtros.ate) return false;
        if (leadsFiltroTipo !== 'todos' && l.tipo_documento !== leadsFiltroTipo) return false;
        if (filtros.busca) {
            var alvo = (String(l.nome || '') + ' ' + String(l.telefone || '') + ' ' + String(l.documento || '')).toLowerCase();
            if (alvo.indexOf(filtros.busca) === -1) return false;
        }
        return true;
    }

    function desenharLeads() {
        var alvo = $('#painel-leads');
        var todos = dados.leads;

        if (!todos.length) {
            alvo.innerHTML = cartaoVazio('Nenhum lead ainda',
                'Um lead aparece aqui assim que alguém preenche o pop-up de pré-registro no catálogo — ' +
                'nome, telefone e CPF ou CNPJ, antes mesmo do primeiro pedido.');
            return;
        }

        var filtrados = todos.filter(leadPassaNoFiltro);
        var pag = paginar(filtrados, leadsPagina, POR_PAGINA_LEADS);
        leadsPagina = pag.pagina;

        alvo.innerHTML =
            '<div class="flex items-center justify-between flex-wrap gap-3 mb-5">' +
                '<div class="flex gap-1">' +
                    ['todos', 'cpf', 'cnpj'].map(function (v) {
                        return '<button type="button" class="adm-chip' + (leadsFiltroTipo === v ? ' is-ativo' : '') +
                            '" data-leads-tipo="' + v + '">' + (v === 'todos' ? 'Todos' : v.toUpperCase()) + '</button>';
                    }).join('') +
                '</div>' +
                botoesExportar('leads') +
            '</div>' +

            (filtrados.length
                ? '<div class="adm-card p-5">' +
                  '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr>' +
                      '<th>Quando</th><th>Nome</th><th>Telefone</th><th>Documento</th>' +
                      '<th>Origem</th><th>Ação</th>' +
                  '</tr></thead><tbody>' +
                  pag.itens.map(linhaLead).join('') +
                  '</tbody></table></div>' +
                  controlesDePaginacao('leads', pag.pagina, pag.totalPaginas) +
                  '</div>'
                : cartaoVazio('Nenhum lead com esses filtros',
                      'Há ' + NUM.format(todos.length) + ' leads ao todo — tente limpar os filtros acima.'));

        ligarBotoesExportar(alvo, { leads: function () { exportarLeadsCSV(filtrados); } });

        alvo.querySelectorAll('[data-leads-tipo]').forEach(function (b) {
            b.addEventListener('click', function () {
                leadsFiltroTipo = b.getAttribute('data-leads-tipo');
                leadsPagina = 1;
                desenharLeads();
            });
        });
        alvo.querySelectorAll('[data-pagina^="leads:"]').forEach(function (b) {
            b.addEventListener('click', function () {
                leadsPagina = Number(b.getAttribute('data-pagina').split(':')[1]);
                desenharLeads();
            });
        });
    }

    function linhaLead(l) {
        return '<tr>' +
            '<td>' + esc(dataHora(l.criado_em)) + '</td>' +
            '<td>' + esc(l.nome) + (l.ddd_rio ? ' <span class="adm-selo adm-selo-confirmado" style="margin-left:.4rem">DDD Rio</span>' : '') + '</td>' +
            '<td>' + esc(l.telefone) + '</td>' +
            '<td>' + esc((l.tipo_documento || '').toUpperCase()) + ' ' + esc(l.documento) + '</td>' +
            '<td>' + esc(l.pagina_origem || '—') + '</td>' +
            '<td>' + linkWhats(l.telefone) + '</td>' +
        '</tr>';
    }

    function exportarLeadsCSV(lista) {
        exportarCSV('leads', ['Data', 'Nome', 'Telefone', 'Tipo', 'Documento', 'DDD Rio', 'Página de origem'],
            lista.map(function (l) {
                return [dataHora(l.criado_em), l.nome, l.telefone, (l.tipo_documento || '').toUpperCase(),
                        l.documento, l.ddd_rio ? 'Sim' : 'Não', l.pagina_origem || ''];
            }));
    }

    /* ===================================================================
     * LGPD — pedidos do titular (acesso é self-service, não passa por
     * aqui) e retenção (migração 015)
     *
     * "Corrigir" nunca acontece sozinho: o admin lê a mensagem, edita o
     * cadastro na aba Clientes do jeito que já faz hoje, e só então marca
     * o pedido como atendido aqui. "Excluir" tem um botão que chama a
     * função do banco direto — é a única ação desta aba que muda dado.
     * =================================================================== */
    var lgpdFiltro = 'pendentes'; // pendentes | atendidos | todos

    function lgpdPassaNoFiltro(s) {
        if (lgpdFiltro === 'pendentes') return !s.atendido;
        if (lgpdFiltro === 'atendidos') return s.atendido;
        return true;
    }

    var LGPD_TIPO_ROTULO = { exclusao: 'Exclusão', correcao: 'Correção' };

    function desenharLgpd() {
        var alvo = $('#painel-lgpd');
        var todos = dados.solicitacoesLgpd;

        var pendentes = todos.filter(function (s) { return !s.atendido; }).length;

        var cabecalhoRetencao =
            '<div class="adm-card p-5 mb-7">' +
                '<p class="font-bold text-sm mb-1">Retenção de dados</p>' +
                '<p class="text-xs mb-4" style="color:var(--adm-tinta-3)">' +
                    'Cliente sem pedido há 12 meses é marcado; depois de mais 90 dias sem voltar a comprar, ' +
                    'os dados de contato e endereço são anonimizados (o pedido em si fica — 5 anos, por lei fiscal). ' +
                    'Sem servidor agendado neste projeto, os dois passos são botões — rode de tempos em tempos.' +
                '</p>' +
                '<div class="flex gap-2 flex-wrap">' +
                    '<button type="button" class="adm-botao-fantasma" id="btn-lgpd-marcar">' +
                        '<i class="fa-regular fa-clock mr-1"></i>1. Marcar inativos (12+ meses)</button>' +
                    '<button type="button" class="adm-botao-fantasma" id="btn-lgpd-purgar">' +
                        '<i class="fa-solid fa-broom mr-1"></i>2. Anonimizar marcados (90+ dias)</button>' +
                '</div>' +
                '<p id="lgpd-retencao-resultado" class="text-xs mt-3" style="color:var(--adm-tinta-3)"></p>' +
            '</div>';

        if (!todos.length) {
            alvo.innerHTML = cabecalhoRetencao + cartaoVazio('Nenhum pedido de titular ainda',
                'Pedidos de correção ou exclusão de dados, feitos pelo formulário em /privacidade.html, aparecem aqui. ' +
                'Pedido de acesso não aparece — é self-service, a pessoa vê os próprios dados na hora.');
            ligarBotoesRetencao(alvo);
            return;
        }

        var filtrados = todos.filter(lgpdPassaNoFiltro);

        alvo.innerHTML = cabecalhoRetencao +
            '<div class="flex items-center justify-between flex-wrap gap-3 mb-5">' +
                '<div class="flex gap-1">' +
                    ['pendentes', 'atendidos', 'todos'].map(function (v) {
                        var rotulo = v === 'pendentes' ? 'Pendentes (' + pendentes + ')' : v.charAt(0).toUpperCase() + v.slice(1);
                        return '<button type="button" class="adm-chip' + (lgpdFiltro === v ? ' is-ativo' : '') +
                            '" data-lgpd-filtro="' + v + '">' + rotulo + '</button>';
                    }).join('') +
                '</div>' +
            '</div>' +
            (filtrados.length
                ? '<div class="adm-card p-5"><div class="overflow-x-auto"><table class="adm-tabela"><thead><tr>' +
                      '<th>Quando</th><th>Tipo</th><th>Documento</th><th>Telefone</th><th>Mensagem</th><th>Ação</th>' +
                  '</tr></thead><tbody>' +
                  filtrados.map(linhaLgpd).join('') +
                  '</tbody></table></div></div>'
                : cartaoVazio('Nenhum pedido com esse filtro', 'Troque o filtro acima para ver os demais.'));

        ligarBotoesRetencao(alvo);

        alvo.querySelectorAll('[data-lgpd-filtro]').forEach(function (b) {
            b.addEventListener('click', function () {
                lgpdFiltro = b.getAttribute('data-lgpd-filtro');
                desenharLgpd();
            });
        });

        alvo.querySelectorAll('[data-lgpd-atender]').forEach(function (b) {
            b.addEventListener('click', function () {
                var id = b.getAttribute('data-lgpd-atender');
                sb.from('solicitacoes_lgpd')
                    .update({ atendido: true, atendido_em: new Date().toISOString(), atendido_por: usuario ? usuario.email : null })
                    .eq('id', id)
                    .then(function (r) {
                        if (r.error) { window.alert('Não foi possível marcar: ' + r.error.message); return; }
                        carregar();
                    });
            });
        });

        alvo.querySelectorAll('[data-lgpd-excluir]').forEach(function (b) {
            b.addEventListener('click', function () {
                var id = b.getAttribute('data-lgpd-excluir');
                var documento = b.getAttribute('data-lgpd-documento');
                if (!window.confirm(
                    'Confirmar exclusão dos dados de ' + documento + '?\n\n' +
                    'Isso apaga o cadastro, telefone e endereço. Pedidos já fechados continuam ' +
                    'existindo (obrigação fiscal de 5 anos), mas sem contato nem endereço ligados a eles.\n\n' +
                    'Não tem como desfazer.'
                )) return;

                b.disabled = true;
                sb.rpc('lgpd_excluir_pessoa', { p_documento: documento, p_solicitacao_id: id })
                    .then(function (r) {
                        b.disabled = false;
                        if (r.error) { window.alert('Não foi possível excluir: ' + r.error.message); return; }
                        carregar();
                    });
            });
        });
    }

    function linhaLgpd(s) {
        return '<tr>' +
            '<td>' + esc(dataHora(s.criado_em)) + '</td>' +
            '<td>' + esc(LGPD_TIPO_ROTULO[s.tipo] || s.tipo) + '</td>' +
            '<td>' + esc(s.documento) + '</td>' +
            '<td>' + esc(s.telefone || '—') + (s.contato ? ' · ' + esc(s.contato) : '') + '</td>' +
            '<td class="max-w-xs truncate" title="' + esc(s.mensagem || '') + '">' + esc(s.mensagem || '—') + '</td>' +
            '<td><div class="flex items-center gap-1 flex-wrap">' +
                (s.atendido
                    ? '<span class="adm-selo adm-selo-confirmado">Atendido</span>'
                    : '<button type="button" class="adm-botao-fantasma" data-lgpd-atender="' + esc(s.id) + '">Marcar atendida</button>' +
                      (s.tipo === 'exclusao'
                          ? '<button type="button" class="adm-botao-fantasma" data-lgpd-excluir="' + esc(s.id) +
                            '" data-lgpd-documento="' + esc(s.documento) + '">' +
                            '<i class="fa-solid fa-user-slash mr-1"></i>Excluir dados</button>'
                          : '')) +
            '</div></td>' +
        '</tr>';
    }

    function ligarBotoesRetencao(alvo) {
        var resultado = alvo.querySelector('#lgpd-retencao-resultado');

        var botaoMarcar = alvo.querySelector('#btn-lgpd-marcar');
        if (botaoMarcar) botaoMarcar.addEventListener('click', function () {
            botaoMarcar.disabled = true;
            sb.rpc('lgpd_marcar_inativos').then(function (r) {
                botaoMarcar.disabled = false;
                if (r.error) { window.alert('Não foi possível marcar: ' + r.error.message); return; }
                resultado.textContent = (r.data || 0) + ' cliente(s) marcado(s) como inativo — entram na carência de 90 dias.';
            });
        });

        var botaoPurgar = alvo.querySelector('#btn-lgpd-purgar');
        if (botaoPurgar) botaoPurgar.addEventListener('click', function () {
            if (!window.confirm(
                'Isso anonimiza (apaga contato e endereço, mantém o pedido fiscal) todo cliente marcado ' +
                'há 90 dias ou mais. Não tem como desfazer. Continuar?'
            )) return;
            botaoPurgar.disabled = true;
            sb.rpc('lgpd_purgar_marcados').then(function (r) {
                botaoPurgar.disabled = false;
                if (r.error) { window.alert('Não foi possível anonimizar: ' + r.error.message); return; }
                resultado.textContent = (r.data || 0) + ' cliente(s) anonimizado(s) por retenção vencida.';
                if (r.data > 0) carregar();
            });
        });
    }

    /* ===================================================================
     * Tempo real — sino e "últimos pedidos"
     *
     * Depende da migração 010 (admin/migracoes/010_realtime_pedidos.sql), que
     * liga `pedidos` à publicação que o Realtime escuta. Sem ela, `sb.channel`
     * abre normalmente mas nenhum evento chega — o sino fica mudo, sem travar
     * nada e sem exigir tratamento de erro especial.
     * =================================================================== */
    var pedidosNaoVistos = 0;
    var canalRealtime = null;

    function ligarRealtime() {
        if (!sb || typeof sb.channel !== 'function') return;

        // Sair e entrar de novo sem recarregar a página não pode empilhar um
        // segundo canal escutando por cima do primeiro.
        if (canalRealtime) { sb.removeChannel(canalRealtime); canalRealtime = null; }

        canalRealtime = sb.channel('painel-pedidos')
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'pedidos' },
                function (payload) {
                    var novo = payload.new;
                    dados.pedidos.unshift(novo);
                    atualizarCartaoFiltros();
                    erpvCalcular();
                    pedidosNaoVistos++;
                    atualizarSino();
                    tocarAlerta();
                    if (secaoVisivel('dashboard')) desenharDashboard();
                    if (secaoVisivel('pedidos')) desenharPedidos();
                    if (secaoVisivel('historico')) desenharHistorico();
                })
            .subscribe();
    }

    function atualizarSino() {
        var sino = $('#btn-sino');
        var contagem = $('#sino-contagem');
        contagem.textContent = pedidosNaoVistos > 9 ? '9+' : String(pedidosNaoVistos);
        contagem.classList.toggle('hidden', pedidosNaoVistos === 0);
        if (pedidosNaoVistos > 0) {
            sino.classList.remove('is-tocando');
            void sino.offsetWidth; // reinicia a animação mesmo em pedidos seguidos
            sino.classList.add('is-tocando');
        }
    }

    function marcarNotificacoesLidas() {
        pedidosNaoVistos = 0;
        atualizarSino();
    }

    /* Bipe curto gerado na hora, sem arquivo de áudio: dois tons subindo,
     * hard-fade para não estalar. AudioContext só é criado no primeiro uso —
     * navegador nenhum deixa áudio tocar antes de alguma interação da
     * pessoa, e como o sino já reage a um evento assíncrono, isto pode
     * silenciosamente falhar na primeiríssima notificação da sessão. Sem
     * problema: o sino visual (badge + balanço) continua avisando. */
    var audioCtx = null;
    function tocarAlerta() {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            [880, 1180].forEach(function (freq, i) {
                var osc = audioCtx.createOscillator();
                var ganho = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                var t0 = audioCtx.currentTime + i * 0.11;
                ganho.gain.setValueAtTime(0.0001, t0);
                ganho.gain.exponentialRampToValueAtTime(0.18, t0 + 0.015);
                ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
                osc.connect(ganho).connect(audioCtx.destination);
                osc.start(t0);
                osc.stop(t0 + 0.2);
            });
        } catch (e) { /* áudio bloqueado pelo navegador: sem áudio, sem erro visível */ }
    }

    /* ===================================================================
     * Modal genérico de detalhes
     * =================================================================== */
    function abrirModal(html) {
        $('#modal-detalhe-corpo').innerHTML = html;
        $('#modal-detalhe').classList.remove('hidden');
        window.ScrollLock && window.ScrollLock.acquire('modal-admin');
    }

    function fecharModal() {
        $('#modal-detalhe').classList.add('hidden');
        $('#modal-detalhe-corpo').innerHTML = '';
        window.ScrollLock && window.ScrollLock.release('modal-admin');
    }

    /* ===================================================================
     * Exportação
     * =================================================================== */
    /* CSV com BOM (para o Excel no Windows abrir os acentos certos sem
     * assistente de importação) e ; como separador — é o que o Excel em
     * pt-BR espera por padrão, já que a vírgula aqui é decimal. */
    function exportarCSV(nomeArquivo, colunas, linhas) {
        function campo(v) {
            var s = String(v == null ? '' : v);
            // Injeção de fórmula (Excel/Planilhas): texto começando por = + - @ ou tab/CR/LF ganha apóstrofo.
            // Números e valores monetários (ex.: -12,50 ou -R$ 12,50) seguem intactos.
            if (typeof v !== 'number' && /^[=+\-@\t\r\n]/.test(s) && !/^-?(R\$\s?)?[\d.,]+$/.test(s)) s = "'" + s;
            return '"' + s.replace(/"/g, '""') + '"';
        }
        var csv = colunas.map(campo).join(';') + '\r\n' +
            linhas.map(function (l) { return l.map(campo).join(';'); }).join('\r\n');

        var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = nomeArquivo + '-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    /* PDF sem biblioteca nenhuma: abre o diálogo de impressão do próprio
     * navegador, com uma folha de estilo (@media print em css/admin.css) que
     * esconde cabeçalho, filtros e tudo que não é o relatório. A pessoa
     * escolhe "Salvar como PDF" no próprio diálogo — é o destino final, só
     * que decidido por ela, não escondido atrás de um nome de botão. */
    function exportarPDF() {
        window.print();
    }

    function botoesExportar(idBase) {
        return '<div class="adm-exportar">' +
            '<button type="button" class="adm-botao-fantasma" data-exportar-csv="' + idBase + '">' +
                '<i class="fa-solid fa-file-csv mr-1"></i>CSV</button>' +
            '<button type="button" class="adm-botao-fantasma" data-exportar-pdf="1">' +
                '<i class="fa-solid fa-file-pdf mr-1"></i>PDF</button>' +
        '</div>';
    }

    function ligarBotoesExportar(raiz, exportadores) {
        raiz.querySelectorAll('[data-exportar-csv]').forEach(function (b) {
            b.addEventListener('click', function () {
                var fn = exportadores[b.getAttribute('data-exportar-csv')];
                if (fn) fn();
            });
        });
        raiz.querySelectorAll('[data-exportar-pdf]').forEach(function (b) {
            b.addEventListener('click', exportarPDF);
        });
    }

    /* ===================================================================
     * Paginação
     * =================================================================== */
    function paginar(lista, pagina, porPagina) {
        var totalPaginas = Math.max(1, Math.ceil(lista.length / porPagina));
        pagina = Math.min(Math.max(1, pagina), totalPaginas);
        return {
            pagina: pagina,
            totalPaginas: totalPaginas,
            itens: lista.slice((pagina - 1) * porPagina, pagina * porPagina)
        };
    }

    function controlesDePaginacao(id, pagina, totalPaginas) {
        if (totalPaginas <= 1) return '';
        var botoes = [];
        botoes.push('<button type="button" class="adm-pagina-botao" data-pagina="' + id + ':' + (pagina - 1) + '"' +
            (pagina === 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i></button>');
        for (var p = 1; p <= totalPaginas; p++) {
            if (totalPaginas > 7 && p !== 1 && p !== totalPaginas && Math.abs(p - pagina) > 1) {
                if (p === 2 || p === totalPaginas - 1) botoes.push('<span style="color:var(--adm-tinta-3)">…</span>');
                continue;
            }
            botoes.push('<button type="button" class="adm-pagina-botao' + (p === pagina ? ' is-ativa' : '') +
                '" data-pagina="' + id + ':' + p + '">' + p + '</button>');
        }
        botoes.push('<button type="button" class="adm-pagina-botao" data-pagina="' + id + ':' + (pagina + 1) + '"' +
            (pagina === totalPaginas ? ' disabled' : '') + '><i class="fa-solid fa-chevron-right"></i></button>');
        return '<div class="adm-paginacao">' + botoes.join('') + '</div>';
    }

    /* Redesenha os gráficos quando a janela muda de tamanho: o SVG é medido em
     * pixels na hora do desenho. */
    var timerResize = null;
    window.addEventListener('resize', function () {
        clearTimeout(timerResize);
        timerResize = setTimeout(function () {
            if (usuario) { desenharTudo(); setTimeout(ajustarSvgCelular, 60); } // também sem pedidos do site: há dados do ERP nos gráficos
        }, 200);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
