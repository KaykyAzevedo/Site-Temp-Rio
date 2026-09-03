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
            t.textContent = NUM.format(Math.round(v));
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

    /* ===================================================================
     * Estado
     * =================================================================== */
    var sb = null;
    var usuario = null;
    var abaAtual = 'dashboard';
    var dados = { resumo: [], visitas: [], pedidos: [] };

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
        $('#btn-atualizar').addEventListener('click', function () { carregar(); });
        $('#filtro-periodo').addEventListener('change', function () { carregar(); });

        document.querySelectorAll('.adm-aba').forEach(function (b) {
            b.addEventListener('click', function () { trocarAba(b.getAttribute('data-aba')); });
        });
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
        sb.auth.signOut().then(function () {
            usuario = null;
            mostrarTela('login');
        });
    }

    function abrirPainel() {
        mostrarTela('painel');
        $('#quem').textContent = usuario ? usuario.email : '';
        carregar();
    }

    /* ===================================================================
     * Carregamento
     * =================================================================== */
    function marcarCarregando(sim) {
        ['dashboard', 'pedidos', 'historico', 'visitas'].forEach(function (a) {
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
                .order('criado_em', { ascending: false })
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
        ['dashboard', 'pedidos', 'historico', 'visitas'].forEach(function (a) {
            $('#painel-' + a).classList.toggle('hidden', a !== qual);
        });
    }

    function desenharTudo() {
        desenharDashboard();
        desenharPedidos();
        desenharHistorico();
        desenharVisitas();
    }

    /* ===================================================================
     * Dashboard
     * =================================================================== */
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

        alvo.innerHTML =
            // Um único número principal por tela.
            '<div class="adm-card p-6 mb-5">' +
                '<p class="adm-tile-rotulo mb-2">Faturamento confirmado neste mês</p>' +
                '<p class="adm-heroi">' + esc(brl(doMes.faturamento_centavos)) + '</p>' +
                '<p class="text-xs mt-3" style="color:var(--adm-tinta-3)">' +
                    'Somando apenas pedidos que você marcou como confirmado ou entregue.' +
                '</p>' +
            '</div>' +

            '<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">' +
                ficha('Aguardando sua confirmação', NUM.format(aguardando),
                      aguardando ? 'Há pedidos parados na fila' : 'Fila vazia') +
                ficha('Confirmados no período', NUM.format(totalCon), 'de ' + NUM.format(totalIni) + ' iniciados') +
                ficha('Ticket médio confirmado', brl(ticket), 'por pedido fechado') +
                ficha('Taxa de fechamento', conversao + '%', 'do clique até a confirmação') +
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
    function desenharPedidos() {
        var alvo = $('#painel-pedidos');
        var fila = dados.pedidos.filter(function (p) {
            return p.status === 'aguardando' || p.status === 'confirmado';
        });

        if (!fila.length) {
            alvo.innerHTML = cartaoVazio('Nenhum pedido na fila',
                'Pedidos aguardando confirmação e já confirmados aparecem aqui. ' +
                'Os encerrados ficam na aba Histórico.');
            return;
        }

        alvo.innerHTML = '<div class="space-y-4">' + fila.map(cartaoPedido).join('') + '</div>';
        ligarAcoesDeStatus(alvo);
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
                    '<p class="adm-tile-valor" style="font-size:1.25rem">' + esc(brl(p.valor_centavos)) + '</p>' +
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

            '<div class="flex items-center gap-2 flex-wrap pt-3" style="border-top:1px solid var(--adm-borda)">' +
                acoesDeStatus(p) +
                '<a href="https://wa.me/' + esc(String(p.telefone).replace(/\D/g, '').replace(/^/, '55')) + '"' +
                    ' target="_blank" rel="noopener" class="adm-botao-fantasma ml-auto">' +
                    '<i class="fa-brands fa-whatsapp mr-1"></i> Chamar' +
                '</a>' +
            '</div>' +
        '</div>';
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
            b.addEventListener('click', function () {
                var id = b.getAttribute('data-id');
                var novo = b.getAttribute('data-status');

                if (novo === 'cancelado' && !window.confirm('Cancelar este pedido?')) return;

                b.disabled = true;
                sb.from('pedidos').update({ status: novo }).eq('id', id).then(function (r) {
                    b.disabled = false;
                    if (r.error) {
                        window.alert('Não foi possível atualizar: ' + r.error.message);
                        return;
                    }
                    carregar(); // recarrega tudo: o faturamento do mês muda com isto
                });
            });
        });
    }

    /* ===================================================================
     * Histórico de compras — por cliente
     * =================================================================== */
    function desenharHistorico() {
        var alvo = $('#painel-historico');
        var pedidos = dados.pedidos;

        if (!pedidos.length) {
            alvo.innerHTML = cartaoVazio('Sem histórico no período',
                'Escolha um período maior no filtro acima, ou aguarde os primeiros pedidos.');
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
                    'Entregues e cancelados. Os que ainda precisam de decisão estão na aba Pedidos.' +
                '</p>' +
                (encerrados.length
                    ? '<div id="t-encerrados" class="overflow-x-auto"></div>'
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

        if (encerrados.length) {
            tabela($('#t-encerrados'),
                ['Data', 'Cliente', 'Praça', 'Potes', 'Valor', 'Situação'],
                encerrados.map(function (p) {
                    return [new Date(p.criado_em).toLocaleDateString('pt-BR'), p.razao_social,
                            (p.cidade || '') + '/' + (p.uf || ''), NUM.format(p.potes),
                            brl(p.valor_centavos), STATUS[p.status] ? STATUS[p.status].rotulo : p.status];
                }),
                [false, false, false, true, true, false]);
        }
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
