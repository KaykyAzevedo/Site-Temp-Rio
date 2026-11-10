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
    var CORES_FATIA = ['#F28C52', '#38BDF8', '#4ADE80', '#FDE047', '#A78BFA', '#FB7185', 'rgba(255,255,255,0.25)'];

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
    var abaAtual = 'dashboard';
    var dados = { resumo: [], visitas: [], pedidos: [], espera: [],
                  regioes: [], faixas: [], vitrines: [], usuarios: [], clientes: [],
                  vendasRegiao: [], vendasProduto: [] };

    var ABAS = ['dashboard', 'pedidos', 'clientes', 'historico', 'vendas',
                'espera', 'vitrine', 'regioes', 'visitas', 'solidcon'];

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
            carregar();
            if (abaAtual === 'solidcon') carregarSolidcon();
        });
        $('#filtro-periodo').addEventListener('change', function () { carregar(); });

        document.querySelectorAll('.adm-aba').forEach(function (b) {
            b.addEventListener('click', function () { trocarAba(b.getAttribute('data-aba')); });
        });

        ligarFiltrosGlobais();
        $('#btn-sino').addEventListener('click', function () {
            marcarNotificacoesLidas();
            trocarAba('pedidos');
        });
        $('#btn-fechar-modal').addEventListener('click', fecharModal);
        $('#modal-detalhe').addEventListener('click', function (ev) {
            if (ev.target.id === 'modal-detalhe') fecharModal();
        });
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') fecharModal();
        });
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
        $('#btn-filtros').addEventListener('click', function () {
            var corpo = $('#corpo-filtros');
            var aberto = !corpo.classList.contains('hidden');
            corpo.classList.toggle('hidden', aberto);
            $('#icone-filtros').classList.toggle('fa-chevron-down', aberto);
            $('#icone-filtros').classList.toggle('fa-chevron-up', !aberto);
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

        desenharPedidos();
        desenharClientes();
        desenharVendas();
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
        if (canalRealtime) { sb.removeChannel(canalRealtime); canalRealtime = null; }
        sb.auth.signOut().then(function () {
            usuario = null;
            mostrarTela('login');
        });
    }

    function abrirPainel() {
        mostrarTela('painel');
        $('#quem').textContent = usuario ? usuario.email : '';
        carregar();
        ligarRealtime();
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
            sb.rpc('visitas_por_regiao', { meses: meses })
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
            dados.espera = rs[3].data || [];
            dados.regioes = rs[4].data || [];
            dados.faixas = rs[5].data || [];
            dados.vitrines = rs[6].data || [];
            dados.usuarios = rs[7].data || [];
            dados.clientes = rs[8].data || [];
            dados.vendasProduto = rs[9].data || [];
            dados.vendasRegiao = rs[10].data || [];
            montarChipsDeFiltro();
            desenharTudo();
        });
    }

    function mostrarFalha(erro) {
        var msg = String(erro && erro.message || erro);
        // Zero linhas com política ativa é o sintoma de e-mail fora da tabela
        // admins — vale dizer isso em vez de "erro desconhecido".
        $('#painel-' + abaAtual).innerHTML =
            '<div class="adm-card p-8">' +
            '<p class="font-bold mb-2">Não foi possível carregar os dados</p>' +
            '<p class="text-sm mb-3" style="color:var(--adm-tinta-2)">' + esc(msg) + '</p>' +
            '<p class="text-xs" style="color:var(--adm-tinta-3)">' +
            'Se a mensagem fala de permissão, confira se o seu e-mail está na tabela ' +
            '<strong>admins</strong> do banco. É o passo 5a do admin/LEIAME-PAINEL.md.</p>' +
            '</div>';
    }

    function trocarAba(qual) {
        abaAtual = qual;
        document.querySelectorAll('.adm-aba').forEach(function (b) {
            b.classList.toggle('is-ativa', b.getAttribute('data-aba') === qual);
        });
        ABAS.forEach(function (a) {
            $('#painel-' + a).classList.toggle('hidden', a !== qual);
        });
        if (qual === 'solidcon' && !solid.carregado && !solid.carregando) carregarSolidcon();
    }

    /* ===================================================================
     * SOLIDCON — espelho SOMENTE LEITURA (migração 012)
     * Carrega sob demanda (ao abrir a aba) e isolado do carregar() geral:
     * sem a 012 aplicada, só esta aba mostra o aviso; as demais não mudam.
     * =================================================================== */
    var solid = { carregado: false, carregando: false, produtos: [], syncs: [],
                  erro: null, ausente: false, busca: '', situacao: 'todos', caixa: 'todas',
                  extra: false, eventos: [], limite: 5, ehAdmin: null, tipoEvento: 'todos' };
    var SOLID_BAIXO = 5;
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
        $('#painel-solidcon').innerHTML = '<div class="adm-card p-8 text-center text-sm" style="color:var(--adm-tinta-2)">' +
            '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando produtos do SOLIDCON…</div>';

        Promise.all([
            sb.from('solidcon_produtos')
                .select('id_produto,nome,categoria,preco_centavos,estoque_disponivel,presente,eans,dtalteracao_erp,atualizado_em')
                .order('nome', { ascending: true }).limit(5000),
            sb.from('solidcon_sync')
                .select('status,concluido_em,coletado_em,qtd_recebida,qtd_presente,mensagem')
                .order('concluido_em', { ascending: false }).limit(200)
        ]).then(function (rs) {
            solid.carregando = false;
            var falha = rs.filter(function (r) { return r.error; })[0];
            solid.ausente = false; solid.erro = null;
            if (falha) {
                if (solidTabelaAusente(falha.error)) solid.ausente = true;
                else solid.erro = String(falha.error.message || falha.error);
                solid.carregado = false;
            } else {
                solid.produtos = rs[0].data || [];
                solid.syncs = rs[1].data || [];
                solid.carregado = true;
            }
            if (!solid.carregado) { desenharSolidcon(); return; }
            return carregarSolidExtra().then(desenharSolidcon);
        }).catch(function (e) {
            solid.carregando = false;
            solid.erro = String(e && e.message || e);
            desenharSolidcon();
        });
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
               '</div>' +
               alertas.map(function (a) {
                   return '<div class="adm-card p-4 mb-3 text-sm" role="alert" style="border-color:rgba(239,68,68,.45)">' +
                          '<i class="fa-solid fa-triangle-exclamation mr-2" style="color:#FCA5A5"></i>' + esc(a) + '</div>';
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
                'Aplique a migração 012 (admin/migracoes/012_solidcon_espelho.sql) para ativar esta aba.');
            return;
        }
        if (solid.erro) {
            alvo.innerHTML = '<div class="adm-card p-8"><p class="font-bold mb-2">Não foi possível carregar o SOLIDCON</p>' +
                '<p class="text-sm mb-4" style="color:var(--adm-tinta-2)">' + esc(solid.erro) + '</p>' +
                '<button type="button" class="adm-botao-fantasma" id="solid-tentar">Tentar de novo</button></div>';
            $('#solid-tentar').addEventListener('click', carregarSolidcon);
            return;
        }
        if (!solid.carregado) return;

        function chips(attr, atual, itens) {
            return itens.map(function (i) {
                return '<button type="button" class="adm-chip' + (atual === i[0] ? ' is-ativo' : '') +
                       '" ' + attr + '="' + i[0] + '">' + i[1] + '</button>';
            }).join('');
        }
        alvo.innerHTML = solidCabecalho() + (solid.extra ? solidBlocoAtencao() : '') + solidContadores() +
            '<div class="flex items-center flex-wrap gap-3 mb-4">' +
                '<input type="search" id="solid-busca" class="adm-input" style="max-width:18rem;padding:.55rem .7rem" ' +
                    'placeholder="Buscar por nome ou código" aria-label="Buscar produto" value="' + esc(solid.busca) + '">' +
                '<div class="flex gap-1 flex-wrap">' +
                    chips('data-solid-sit', solid.situacao, [['todos', 'Todos'], ['disponiveis', 'Disponíveis'], ['esgotados', 'Esgotados']]) +
                '</div>' +
                '<div class="flex gap-1 flex-wrap">' +
                    chips('data-solid-cx', solid.caixa, [['todas', 'Todas as caixas'], ['24', 'CX 24'], ['48', 'CX 48']]) +
                '</div>' +
            '</div>' +
            '<div id="solid-lista"></div>' + (solid.extra ? '<div class="mt-5">' + solidBlocoEventos() + '</div>' : '') +
            '<p class="text-xs mt-3" style="color:var(--adm-tinta-3)">Somente leitura. O preço do ERP é apenas referência — não altera o preço do site.</p>';

        $('#solid-busca').addEventListener('input', function (ev) {
            solid.busca = ev.target.value; desenharSolidLista();
        });
        alvo.querySelectorAll('[data-solid-sit]').forEach(function (b) {
            b.addEventListener('click', function () { solid.situacao = b.getAttribute('data-solid-sit'); desenharSolidcon(); });
        });
        alvo.querySelectorAll('[data-solid-cx]').forEach(function (b) {
            b.addEventListener('click', function () { solid.caixa = b.getAttribute('data-solid-cx'); desenharSolidcon(); });
        });
        alvo.querySelectorAll('[data-solid-tipo]').forEach(function (b) {
            b.addEventListener('click', function () { solid.tipoEvento = b.getAttribute('data-solid-tipo'); desenharSolidcon(); });
        });
        var sv = $('#solid-limite-salvar');
        if (sv) sv.addEventListener('click', salvarSolidLimite);
        desenharSolidLista();
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
        produto_novo:   { rotulo: 'Produto novo',      icone: 'fa-star',        cls: '', estilo: 'background:rgba(168,85,247,.14);color:#D8B4FE' },
        sumiu:          { rotulo: 'Sumiu da lista',    icone: 'fa-eye-slash',   cls: '', estilo: 'background:rgba(255,255,255,.08);color:var(--adm-tinta-2)' },
        reapareceu:     { rotulo: 'Reapareceu',        icone: 'fa-eye',         cls: '', estilo: 'background:rgba(255,255,255,.08);color:var(--adm-tinta-2)' }
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
        var esg = solid.produtos.filter(solidEsgotado);
        var baixo = solid.produtos.filter(function (p) {
            var e = Number(p.estoque_disponivel); return !solidEsgotado(p) && e > 0 && e <= lim;
        });
        var corte = Date.now() - 86400000;
        var ev24 = solid.eventos.filter(function (e) { return new Date(e.em).getTime() >= corte; });

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
        function prod(p) { return '<li>' + esc(p.nome) + ' <span style="color:var(--adm-tinta-3)">(' + esc(p.id_produto) + ')</span></li>'; }

        return '<div class="adm-card p-5 mb-5"><p class="font-bold mb-4"><i class="fa-solid fa-bell mr-2" style="color:var(--adm-marca)"></i>Atenção</p>' +
            '<div class="grid sm:grid-cols-3 gap-5">' +
            col('Esgotados', esg.length, lista(esg, prod)) +
            col('Estoque baixo (≤ ' + NUM.format(lim) + ')', baixo.length,
                lista(baixo, function (p) {
                    return '<li>' + esc(p.nome) + ' <span style="color:var(--adm-tinta-3)">— ' + esc(NUM.format(Number(p.estoque_disponivel))) + ' cx</span></li>';
                })) +
            col('Eventos nas últimas 24h', ev24.length,
                lista(ev24, function (e) { return '<li>' + solidSeloTipo(e.tipo) + ' ' + esc(e.nome) + '</li>'; })) +
            '</div>' + solidControleLimite() + '</div>';
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
            desenharSolidcon();
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

    function solidGrafico(dias) {
        var W = 600, H = 170, pl = 36, pr = 10, pt = 10, pb = 22;
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
            '<polyline fill="none" stroke="var(--adm-marca)" stroke-width="2" stroke-linejoin="round" points="' + pts.join(' ') + '"/>' +
            dias.map(function (x, i) {
                return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(Number(x.estoque_disponivel)).toFixed(1) +
                       '" r="2.5" fill="var(--adm-marca)"><title>' + esc(rot(x.dia) + ': ' + NUM.format(Number(x.estoque_disponivel)) + ' cx') + '</title></circle>';
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


    function desenharTudo() {
        desenharDashboard();
        desenharPedidos();
        desenharClientes();
        desenharHistorico();
        desenharVendas();
        desenharEspera();
        desenharVitrine();
        desenharRegioes();
        desenharVisitas();
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

    function desenharDashboard() {
        var alvo = $('#painel-dashboard');
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

    function cartaoVazio(titulo, texto) {
        return '<div class="adm-card p-10 text-center">' +
               '<i class="fa-regular fa-folder-open text-2xl mb-4" style="color:var(--adm-tinta-3)"></i>' +
               '<p class="font-bold mb-2">' + esc(titulo) + '</p>' +
               '<p class="text-sm max-w-md mx-auto" style="color:var(--adm-tinta-2)">' + esc(texto) + '</p>' +
               '</div>';
    }

    /* ===================================================================
     * Pedidos — a fila que precisa de decisão
     * =================================================================== */
    var pedidosVista = 'kanban';
    var COLUNAS_KANBAN = [
        { status: 'aguardando', titulo: 'Aguardando' },
        { status: 'confirmado', titulo: 'Confirmado' },
        { status: 'entregue',   titulo: 'Entregue' },
        { status: 'cancelado',  titulo: 'Cancelado' }
    ];

    function desenharPedidos() {
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

        if (!filtrados.length) {
            alvo.innerHTML = cabecalho + cartaoVazio('Nenhum pedido com esses filtros',
                dados.pedidos.length
                    ? 'Há ' + NUM.format(dados.pedidos.length) + ' pedidos no período — tente limpar os filtros acima.'
                    : 'Pedidos aparecem aqui assim que alguém enviar um pelo site.');
            ligarBotoesExportar(alvo, { pedidos: function () { exportarPedidosCSV(filtrados); } });
            ligarTrocaDeVista(alvo);
            return;
        }

        alvo.innerHTML = cabecalho +
            (pedidosVista === 'kanban' ? htmlKanban(filtrados) : htmlTabelaPedidos(filtrados));

        if (pedidosVista === 'kanban') { ligarAcoesDeStatus(alvo); ligarDragDrop(alvo); }
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
    function htmlKanban(lista) {
        return '<div class="adm-kanban">' +
            COLUNAS_KANBAN.map(function (col) {
                var itens = lista.filter(function (p) { return p.status === col.status; });
                return '<div class="adm-kanban-coluna">' +
                    '<div class="adm-kanban-cabecalho">' +
                        '<span class="adm-kanban-titulo">' + esc(col.titulo) + '</span>' +
                        '<span class="adm-kanban-contagem">' + itens.length + '</span>' +
                    '</div>' +
                    '<div class="adm-kanban-corpo" data-coluna="' + col.status + '">' +
                        itens.map(cartaoKanban).join('') +
                    '</div>' +
                '</div>';
            }).join('') +
        '</div>';
    }

    function cartaoKanban(p) {
        return '<div class="adm-kanban-cartao" draggable="true" data-id="' + esc(p.id) +
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
            (seloSolidcon(p) ? '<div class="mb-2">' + seloSolidcon(p) + '</div>' : '') +
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
                    '<td>' + selo(p.status) + ' ' + seloSolidcon(p) + '</td>' +
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
                    selo(p.status) +
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
                ? '<p class="text-xs mb-4 p-3 rounded-lg" style="background:rgba(255,255,255,0.04);color:var(--adm-tinta-2)">' +
                  '<strong>Obs:</strong> ' + esc(p.observacoes) + '</p>'
                : '') +

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
     * Lançar no SOLIDCON
     *
     * O Marcio digita cada pedido do site no comercial do SOLIDCON. Este
     * bloco junta tudo o que ele precisa em um lugar só (+ "Copiar tudo") e
     * registra o número do pedido lançado. Depende da migração 011: sem ela,
     * as colunas novas não vêm no select('*') e o bloco avisa em vez de quebrar.
     * =================================================================== */
    function abrirPedido(p) {
        abrirModal(cartaoPedido(p));
        carregarBlocoSolidcon(p);
    }

    function lancadoNoSolidcon(p) { return !!p.lancado_solidcon_em; }

    // Sem a coluna (migração 011 pendente) não há selo: não dá para afirmar nada.
    function seloSolidcon(p) {
        if (!('lancado_solidcon_em' in p) || p.status === 'cancelado') return '';
        return lancadoNoSolidcon(p)
            ? '<span class="adm-selo adm-selo-confirmado" title="Pedido ' + esc(p.numero_solidcon || '') + '">' +
              '<i class="fa-solid fa-check"></i>Lançado no SOLIDCON</span>'
            : '<span class="adm-selo adm-selo-aguardando"><i class="fa-regular fa-clock"></i>Falta lançar</span>';
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
        var temColuna = 'lancado_solidcon_em' in p;
        var frete = Number(p.frete_centavos) || 0;
        var total = (p.valor_centavos || 0) + frete;
        var semCodigo = info.linhas.some(function (l) { return !info.codigos[l.produto_id]; });
        var avisos = '';

        // O que o cliente viu no site pode divergir do gravado (preço recalculado no servidor).
        var difValor = p.valor_site_centavos != null && Number(p.valor_site_centavos) !== Number(p.valor_centavos);
        var difFrete = p.frete_site_centavos != null && Number(p.frete_site_centavos) !== frete;
        if (difValor || difFrete) {
            avisos += '<p class="text-xs p-3 rounded-lg mb-3" style="background:rgba(234,179,8,0.14);color:#FDE047">' +
                '<i class="fa-solid fa-triangle-exclamation mr-1"></i>O valor que o cliente viu era ' +
                (difValor ? 'produtos ' + esc(brl(p.valor_site_centavos)) + ' (gravado ' + esc(brl(p.valor_centavos)) + ')' : '') +
                (difValor && difFrete ? ' e ' : '') +
                (difFrete ? 'frete ' + esc(brl(p.frete_site_centavos)) + ' (gravado ' + esc(brl(frete)) + ')' : '') +
                '. Confirme com o cliente antes de lançar.</p>';
        }
        if (!temColuna || info.semColuna) {
            avisos += '<p class="text-xs p-3 rounded-lg mb-3" style="background:rgba(255,255,255,0.04);color:var(--adm-tinta-2)">' +
                'Migração 011 ainda não aplicada no banco: códigos SOLIDCON e o registro de lançamento ficam indisponíveis.</p>';
        } else if (semCodigo) {
            avisos += '<p class="text-xs p-3 rounded-lg mb-3" style="background:rgba(239,68,68,0.14);color:#FCA5A5">' +
                '<i class="fa-solid fa-circle-exclamation mr-1"></i>Há produto sem código SOLIDCON — procure pelo nome.</p>';
        }

        var campo = function (r, v) {
            return '<div><span style="color:var(--adm-tinta-3)">' + esc(r) + ':</span> ' + esc(v || '—') + '</div>';
        };
        var endereco = (p.logradouro || '') + (p.numero ? ', ' + p.numero : '') + (p.complemento ? ' - ' + p.complemento : '') +
            ' · ' + (p.bairro || '') + ' · ' + (p.cidade || '') + '/' + (p.uf || '') + (p.cep ? ' · CEP ' + p.cep : '');

        var lancamento = !temColuna ? '' :
            '<div class="pt-3 mt-3" style="border-top:1px solid var(--adm-borda)">' +
                '<label class="adm-tile-rotulo block mb-1" for="solidcon-numero">Nº do pedido no SOLIDCON</label>' +
                '<div class="flex gap-2 flex-wrap items-center">' +
                    '<input id="solidcon-numero" class="adm-input" style="max-width:14rem;padding:.55rem .7rem" ' +
                        'inputmode="numeric" autocomplete="off" value="' + esc(p.numero_solidcon || '') + '">' +
                    '<button type="button" id="solidcon-marcar" class="adm-botao">' +
                        '<i class="fa-solid fa-check mr-1"></i>Marcar como lançado</button>' +
                    (lancadoNoSolidcon(p)
                        ? '<button type="button" id="solidcon-desfazer" class="adm-botao-fantasma">' +
                          '<i class="fa-solid fa-rotate-left mr-1"></i>Desfazer</button>' : '') +
                '</div>' +
                '<p id="solidcon-msg" class="text-xs mt-2" role="status" style="color:var(--adm-tinta-2)">' +
                    (lancadoNoSolidcon(p)
                        ? '<i class="fa-solid fa-circle-check mr-1" style="color:var(--adm-bom)"></i>Lançado em ' +
                          esc(dataHora(p.lancado_solidcon_em)) + (p.numero_solidcon ? ' · pedido ' + esc(p.numero_solidcon) : '')
                        : 'Ainda não lançado.') +
                '</p>' +
            '</div>';

        alvo.innerHTML = '<div class="adm-card p-4" style="border:1px solid var(--adm-borda)">' +
            '<div class="flex items-center justify-between gap-2 flex-wrap mb-3">' +
                '<p class="font-bold text-sm">Lançar no SOLIDCON ' + seloSolidcon(p) + '</p>' +
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
                    return '<tr><td>' + (cod ? esc(cod) : '<span style="color:#FCA5A5">sem código</span>') + '</td>' +
                        '<td>' + esc(l.nome) + '</td><td class="num">' + esc(NUM.format(l.potes)) + '</td>' +
                        '<td class="num">' + (l.unit == null ? '—' : esc(brl(l.unit))) + '</td>' +
                        '<td class="num">' + (l.unit == null ? '—' : esc(brl(l.unit * l.potes))) + '</td></tr>';
                }).join('') : '<tr><td colspan="5">Sem itens registrados.</td></tr>') +
            '</tbody></table></div>' +
            '<div class="text-xs mt-3 text-right" style="color:var(--adm-tinta-2)">' +
                'Produtos ' + esc(brl(p.valor_centavos)) + ' · Frete ' + esc(brl(frete)) +
                ' · <strong style="color:var(--adm-tinta)">Total ' + esc(brl(total)) + '</strong></div>' +
            (p.observacoes ? '<p class="text-xs mt-2" style="color:var(--adm-tinta-2)"><strong>Obs:</strong> ' + esc(p.observacoes) + '</p>' : '') +
            lancamento + '</div>';

        var btnCopiar = alvo.querySelector('#solidcon-copiar');
        btnCopiar.addEventListener('click', function () {
            copiarTexto(textoParaSolidcon(p, info)).then(function (ok) {
                btnCopiar.innerHTML = ok ? '<i class="fa-solid fa-check mr-1"></i>Copiado!'
                                         : '<i class="fa-solid fa-xmark mr-1"></i>Não copiou';
                setTimeout(function () { btnCopiar.innerHTML = '<i class="fa-regular fa-copy mr-1"></i>Copiar tudo'; }, 2000);
            });
        });

        if (!temColuna) return;
        function gravar(numero) {
            var msg = alvo.querySelector('#solidcon-msg');
            var botoes = alvo.querySelectorAll('#solidcon-marcar, #solidcon-desfazer');
            botoes.forEach(function (b) { b.disabled = true; });
            msg.style.color = 'var(--adm-tinta-2)';
            msg.textContent = 'Salvando…';
            // A resposta pode chegar com outro pedido aberto: o bloco só é
            // tocado se ainda for o deste pedido; o objeto em memória sempre.
            var aindaAberto = function () {
                return alvo.isConnected && alvo.getAttribute('data-pedido-id') === String(p.id);
            };
            var falha = function (texto) {
                if (!aindaAberto()) return;
                botoes.forEach(function (b) { b.disabled = false; });
                msg.style.color = '#FCA5A5';
                msg.textContent = texto;
            };
            sb.rpc('marcar_lancado_solidcon', { p_pedido: p.id, p_numero: numero }).then(function (r) {
                if (r.error) { falha('Não foi possível salvar: ' + r.error.message); return; }
                // A RPC devolve a linha do pedido; NULL = pedido não visível/inexistente.
                var linha = Array.isArray(r.data) ? r.data[0] : r.data;
                if (!linha || String(linha.id) !== String(p.id)) {
                    falha('Não foi possível salvar: o pedido não foi encontrado ou você não tem acesso.');
                    return;
                }
                p.numero_solidcon = linha.numero_solidcon || null;
                p.lancado_solidcon_em = linha.lancado_solidcon_em || null;
                if (aindaAberto()) desenharBlocoSolidcon(alvo, p, info);
                desenharPedidos(); // atualiza o selo na lista/Kanban
            }, function (e) {
                falha('Falha de rede: ' + (e && e.message || e));
            });
        }
        alvo.querySelector('#solidcon-marcar').addEventListener('click', function () {
            var n = alvo.querySelector('#solidcon-numero').value.trim();
            if (!n) {
                var m = alvo.querySelector('#solidcon-msg');
                m.style.color = '#FCA5A5';
                m.textContent = 'Informe o nº do pedido no SOLIDCON.';
                return;
            }
            gravar(n);
        });
        var desf = alvo.querySelector('#solidcon-desfazer');
        if (desf) desf.addEventListener('click', function () { gravar(''); });
    }

    function acoesDeStatus(p) {
        var botoes = [];
        if (p.status === 'aguardando') {
            botoes.push(botaoStatus(p.id, 'confirmado', 'Confirmar venda', 'fa-circle-check'));
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

    function clientePassaNoFiltro(c) {
        if (filtros.de && String(c.criadoEm).slice(0, 10) < filtros.de) return false;
        if (filtros.ate && String(c.criadoEm).slice(0, 10) > filtros.ate) return false;
        if (filtros.regioes.length && filtros.regioes.indexOf(c.regiaoId) === -1) return false;
        if (filtros.tipoCliente !== 'todos' && c.tipo.toLowerCase() !== filtros.tipoCliente) return false;
        if (clientesFiltroAtivo !== 'todos' && (c.ativo ? 'ativos' : 'inativos') !== clientesFiltroAtivo) return false;
        if (filtros.busca) {
            var alvo = (c.nome + ' ' + c.cnpj + ' ' + c.cpf + ' ' + c.telefone).toLowerCase();
            if (alvo.indexOf(filtros.busca) === -1) return false;
        }
        return true;
    }

    function desenharClientes() {
        var alvo = $('#painel-clientes');
        var todos = listaClientesCombinada();

        if (!todos.length) {
            alvo.innerHTML = cartaoVazio('Nenhum cliente ainda',
                'Um cliente entra aqui sozinho assim que o primeiro pedido dele é gravado — ' +
                'não existe cadastro separado no site.');
            return;
        }

        var filtrados = todos.filter(clientePassaNoFiltro)
            .sort(function (a, b) { return b.gasto - a.gasto; });
        var pag = paginar(filtrados, clientesPagina, POR_PAGINA_CLIENTES);
        clientesPagina = pag.pagina;

        alvo.innerHTML =
            '<div class="flex items-center justify-between flex-wrap gap-3 mb-5">' +
                '<div class="flex gap-1">' +
                    ['todos', 'ativos', 'inativos'].map(function (v) {
                        return '<button type="button" class="adm-chip' + (clientesFiltroAtivo === v ? ' is-ativo' : '') +
                            '" data-clientes-status="' + v + '">' + v.charAt(0).toUpperCase() + v.slice(1) + '</button>';
                    }).join('') +
                '</div>' +
                botoesExportar('clientes') +
            '</div>' +

            (filtrados.length
                ? '<div class="adm-card p-5">' +
                  '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr>' +
                      '<th>Nome</th><th>Telefone</th><th>Tipo</th><th style="text-align:right">Pedidos</th>' +
                      '<th style="text-align:right">Ticket médio</th><th>Ação</th>' +
                  '</tr></thead><tbody>' +
                  pag.itens.map(linhaCliente).join('') +
                  '</tbody></table></div>' +
                  controlesDePaginacao('clientes', pag.pagina, pag.totalPaginas) +
                  '</div>'
                : cartaoVazio('Nenhum cliente com esses filtros',
                      'Há ' + NUM.format(todos.length) + ' clientes ao todo — tente limpar os filtros acima.'));

        ligarBotoesExportar(alvo, { clientes: function () { exportarClientesCSV(filtrados); } });

        alvo.querySelectorAll('[data-clientes-status]').forEach(function (b) {
            b.addEventListener('click', function () {
                clientesFiltroAtivo = b.getAttribute('data-clientes-status');
                clientesPagina = 1;
                desenharClientes();
            });
        });

        alvo.querySelectorAll('[data-pagina^="clientes:"]').forEach(function (b) {
            b.addEventListener('click', function () {
                clientesPagina = Number(b.getAttribute('data-pagina').split(':')[1]);
                desenharClientes();
            });
        });

        alvo.querySelectorAll('[data-ver-cliente]').forEach(function (b) {
            b.addEventListener('click', function () {
                var c = filtrados.filter(function (x) { return x.clienteId === b.getAttribute('data-ver-cliente'); })[0];
                if (c) abrirModal(detalheCliente(c));
            });
        });
        alvo.querySelectorAll('[data-editar-cliente]').forEach(function (b) {
            b.addEventListener('click', function () {
                var c = filtrados.filter(function (x) { return x.clienteId === b.getAttribute('data-editar-cliente'); })[0];
                if (c) abrirModal(formEditarCliente(c));
            });
        });
    }

    function linhaCliente(c) {
        return '<tr>' +
            '<td>' + esc(c.nome) + (c.ativo ? '' : ' <span class="adm-selo adm-selo-cancelado" style="margin-left:.4rem">Inativo</span>') + '</td>' +
            '<td>' + esc(c.telefone || '—') + '</td>' +
            '<td>' + esc(c.tipo) + '</td>' +
            '<td class="num">' + NUM.format(c.pedidos) + '</td>' +
            '<td class="num">' + esc(brl(c.ticket)) + '</td>' +
            '<td><div class="flex items-center gap-1 flex-wrap">' +
                '<button type="button" class="adm-botao-fantasma" data-ver-cliente="' + esc(c.clienteId) + '">' +
                    '<i class="fa-regular fa-eye mr-1"></i>Detalhes</button>' +
                '<button type="button" class="adm-botao-fantasma" data-editar-cliente="' + esc(c.clienteId) + '">' +
                    '<i class="fa-solid fa-pen mr-1"></i>Editar</button>' +
                linkWhats(c.telefone) +
            '</div></td>' +
        '</tr>';
    }

    function detalheCliente(c) {
        var pedidosDoCliente = dados.pedidos.filter(function (p) { return p.cliente_id === c.clienteId; })
            .sort(function (a, b) { return new Date(b.criado_em) - new Date(a.criado_em); });

        return '<h2 class="text-lg font-bold mb-1">' + esc(c.nome) + '</h2>' +
            '<p class="text-xs mb-5" style="color:var(--adm-tinta-3)">' +
                esc(c.tipo === 'PJ' ? 'CNPJ ' + c.cnpj : 'CPF ' + c.cpf) +
                (c.bairro || c.cidade ? ' · ' + esc([c.bairro, c.cidade].filter(Boolean).join(', ')) + '/' + esc(c.uf || '') : '') +
            '</p>' +
            '<div class="grid sm:grid-cols-3 gap-4 mb-5">' +
                ficha('Pedidos', NUM.format(c.pedidos), NUM.format(c.fechados) + ' fechados') +
                ficha('Total comprado', brl(c.gasto), 'confirmado + entregue') +
                ficha('Ticket médio', brl(c.ticket), 'por pedido fechado') +
            '</div>' +
            (c.telefone || c.email
                ? '<p class="text-sm mb-5">' + esc(c.telefone) + (c.email ? ' · ' + esc(c.email) : '') + '</p>'
                : '') +
            '<p class="font-bold text-sm mb-3">Pedidos</p>' +
            (pedidosDoCliente.length
                ? '<div class="space-y-2 max-h-64 overflow-y-auto">' +
                  pedidosDoCliente.map(function (p) {
                      return '<div class="flex items-center justify-between text-sm py-1.5" style="border-bottom:1px solid var(--adm-borda)">' +
                          '<span style="color:var(--adm-tinta-2)">' + esc(new Date(p.criado_em).toLocaleDateString('pt-BR')) + '</span>' +
                          '<span>' + esc(brl(p.valor_centavos)) + '</span>' + selo(p.status) +
                      '</div>';
                  }).join('') + '</div>'
                : '<p class="adm-vazio">Nenhum pedido no período carregado.</p>') +
            (linkWhats(c.telefone)
                ? '<div class="mt-5 pt-4" style="border-top:1px solid var(--adm-borda)">' + linkWhats(c.telefone) + '</div>'
                : '');
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
                    '<span id="edit-cliente-erro" class="text-xs hidden" style="color:#FCA5A5"></span>' +
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
        exportarCSV('clientes', ['Nome', 'Telefone', 'Tipo', 'Cidade', 'UF', 'Pedidos', 'Ticket médio', 'Total comprado'],
            lista.map(function (c) {
                return [c.nome, c.telefone, c.tipo, c.cidade, c.uf, c.pedidos, brl(c.ticket), brl(c.gasto)];
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
    function desenharVendas() {
        var alvo = $('#painel-vendas');

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

    function desenharVitrine() {
        var alvo = $('#painel-vitrine');
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
                        'style="color:var(--adm-marca)"></i>' + esc(plano.rotulo) + ' · ' +
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
                ? '<p class="text-xs mb-4 p-3 rounded-lg" style="background:rgba(255,255,255,.04);color:var(--adm-tinta-2)">' +
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

    function desenharRegioes() {
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

            '<div class="adm-card p-4 mb-5" style="border-color:rgba(242,140,82,.3);background:rgba(242,140,82,.06)">' +
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
                            : '<span style="color:#FCA5A5">Sem faixa de CEP — esta região nunca vai casar com um pedido</span>') +
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
                't-visitas');

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
                    pedidosNaoVistos++;
                    atualizarSino();
                    tocarAlerta();
                    if (abaAtual === 'dashboard') desenharDashboard();
                    if (abaAtual === 'pedidos') desenharPedidos();
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
            var s = String(v == null ? '' : v).replace(/"/g, '""');
            return '"' + s + '"';
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
            if (usuario && dados.resumo.length) desenharTudo();
        }, 200);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
