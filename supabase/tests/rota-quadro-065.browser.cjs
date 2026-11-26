'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const repo = path.resolve(__dirname, '../..');
const outDesktop = 'C:/Users/emporio/Downloads/quadro-semana-065-desktop.png';
const outMobile = 'C:/Users/emporio/Downloads/quadro-semana-065-mobile.png';
const outDesktop066 = 'C:/Users/emporio/Downloads/quadro-semana-066-desktop.png';
const outMobile066 = 'C:/Users/emporio/Downloads/quadro-semana-066-mobile.png';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ws, session, id = 0, checks = 0;
const pending = new Map(), errors = [];

function send(method, params = {}, s = session) {
    return new Promise((resolve, reject) => {
        const n = ++id;
        pending.set(n, { resolve, reject });
        ws.send(JSON.stringify({ id: n, method, params, ...(s ? { sessionId: s } : {}) }));
    });
}
async function run(expression) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
}
function check(ok, msg) { assert.ok(ok, msg); checks++; }

(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vitral-quadro-065-'));
    const child = spawn(
        process.env.CHROME_EXE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'],
        { windowsHide: true, stdio: 'ignore' }
    );
    try {
        const active = path.join(profile, 'DevToolsActivePort');
        for (let i = 0; !fs.existsSync(active) && i < 100; i++) await sleep(100);
        const [port, endpoint] = fs.readFileSync(active, 'utf8').trim().split(/\r?\n/);
        ws = new WebSocket('ws://127.0.0.1:' + port + endpoint);
        await new Promise((resolve, reject) => {
            ws.addEventListener('open', resolve, { once: true });
            ws.addEventListener('error', reject, { once: true });
        });
        ws.addEventListener('message', ev => {
            const m = JSON.parse(ev.data);
            if (m.id) {
                const p = pending.get(m.id);
                pending.delete(m.id);
                if (p) m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
            } else if (m.method === 'Runtime.exceptionThrown') {
                errors.push(m.params.exceptionDetails);
            }
        });

        const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, null);
        session = (await send('Target.attachToTarget', { targetId, flatten: true }, null)).sessionId;
        await send('Runtime.enable');
        await send('Page.enable');
        await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });

        const cssAdmin = fs.readFileSync(path.join(repo, 'css/admin.css'), 'utf8');
        const cssRota = fs.readFileSync(path.join(repo, 'css/admin-rota.css'), 'utf8');
        const cssQuadro = fs.readFileSync(path.join(repo, 'css/admin-rota-quadro.css'), 'utf8');
        const jsCore = fs.readFileSync(path.join(repo, 'supabase/functions/_shared/rota-core.js'), 'utf8');
        const jsEntrega = fs.readFileSync(path.join(repo, 'js/entrega-admin.js'), 'utf8');
        const jsQuadro = fs.readFileSync(path.join(repo, 'js/admin-rota-quadro.js'), 'utf8');
        const jsRota = fs.readFileSync(path.join(repo, 'js/admin-rota.js'), 'utf8');

        const utilCss = `
            body.admin { margin: 0; padding: 20px; background: var(--adm-fundo); color: var(--adm-tinta); font-family: 'Segoe UI', system-ui, sans-serif; }
            * { box-sizing: border-box; }
            .p-4 { padding: 1rem; }
            .mb-4 { margin-bottom: 1rem; }
            .mb-5 { margin-bottom: 1.25rem; }
            .flex { display: flex; }
            .flex-wrap { flex-wrap: wrap; }
            .gap-1 { gap: 0.25rem; }
            .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
        `;

        await run(`
            document.documentElement.lang = 'pt-BR';
            document.documentElement.innerHTML = '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="admin"><main id="painel-rotas"></main></body>';
            const st = document.createElement('style');
            st.textContent = ${JSON.stringify(cssAdmin + '\n' + cssRota + '\n' + cssQuadro + '\n' + utilCss)};
            document.head.appendChild(st);
        `);
        await run(jsCore);
        await run(jsEntrega);
        await run(jsQuadro);
        await run(jsRota);

        await run(`
            window.chamadasRpc = [];
            const ex = window.TempRioRotaQuadro.dadosExemplo();
            const pedidos = [];
            const clientes = {};
            const padroes = {};
            const itens065 = [];
            let docSeq = 10000000000000;
            function addCard(c, dia, ord, rem) {
                const doc = String(++docSeq);
                const temGeo = Array.isArray(c.pos) && c.pos.length >= 2;
                clientes[doc] = {
                    nome: c.cliente,
                    bairro: c.bairro,
                    cidade: c.cidade,
                    lat: temGeo ? c.pos[0] : null,
                    lng: temGeo ? c.pos[1] : null,
                    precisao: temGeo ? 'exata' : null
                };
                if (c.veiculo) padroes[doc] = c.veiculo;
                const dtPorPrazo = {
                    '2026-11-23': '2026-11-19T08:00:00-03:00',
                    '2026-11-24': '2026-11-20T08:00:00-03:00',
                    '2026-11-25': '2026-11-23T08:00:00-03:00',
                    '2026-11-26': '2026-11-24T08:00:00-03:00',
                    '2026-11-27': '2026-11-25T08:00:00-03:00',
                    '2026-11-28': '2026-11-26T08:00:00-03:00'
                };
                pedidos.push({
                    cd_pedido: c.cd_pedido,
                    documento: doc,
                    cliente_nome: c.cliente,
                    etapa: 'aberto',
                    dt_pedido: dtPorPrazo[c.prazo] || '2026-11-23T08:00:00-03:00',
                    caixas_24: c.c24 || 0,
                    caixas_48: c.c48 || 0,
                    caixas_outras: 0
                });
                if (dia) {
                    itens065.push({ cd_pedido: c.cd_pedido, dia, veiculo_id: c.veiculo || 's10', ordem: ord, removido: !!rem });
                }
            }
            ex.dias.forEach(d => {
                let ordS10 = 0;
                d.cartoes.forEach(c => {
                    const ord = c.veiculo === 'caminhao' ? null : (++ordS10);
                    addCard(c, d.dia, ord, false);
                });
            });
            ex.bandeja.forEach(c => {
                addCard(c, c.origemDia === 'removido' ? c.diaAnterior : null, null, c.origemDia === 'removido');
            });
            // Pedido extra #1599 ja confirmado como Recebido na 063 (nao deve aparecer na bandeja nem nos dias)
            pedidos.push({
                cd_pedido: 1599,
                documento: '10000000001599',
                cliente_nome: 'Cliente Já Recebido 063',
                etapa: 'atendido',
                dt_pedido: '2026-11-23T08:00:00-03:00',
                dt_saida: '2026-11-24T15:00:00-03:00',
                caixas_24: 50,
                caixas_48: 0,
                caixas_outras: 0
            });

            const T = {
                solidcon_pedidos_erp: pedidos,
                solidcon_pedidos_erp_sync: [{ coletado_em: '2026-11-25T14:00:00-03:00' }],
                rota_config: [{ id: 1, hora_saida: '08:00', canhoto_desde: '2026-01-01T00:00:00Z' }],
                rota_cliente_veiculo: Object.keys(padroes).map(documento => ({ documento, veiculo: padroes[documento] })),
                rota_pedido_veiculo: [],
                rota_cliente_regras: [],
                rota_pedido_ignorado: [],
                rota_plano_semana: [],
                rota_veiculos: [
                    { id: 's10', nome: 'S10', modo: 'porta', capacidade_volume: 2700, dias_sem_saida: [0, 6], ativo: true, ordem: 10, cor: '#2563eb' },
                    { id: 'caminhao', nome: 'Caminhão (CEASA)', modo: 'cd_ceasa', capacidade_volume: null, dias_sem_saida: [0], ativo: true, ordem: 20, cor: '#b45309' },
                    { id: 'strada', nome: 'Strada', modo: 'porta', capacidade_volume: null, dias_sem_saida: [0, 6], ativo: false, ordem: 30, cor: '#059669' }
                ],
                rota_saida: [],
                rota_saida_progresso: [],
                pedido_canhoto: [],
                solidcon_clientes: Object.keys(clientes).map(documento => ({ documento, ...clientes[documento] }))
            };

            const sb = {
                from(t) {
                    const q = {
                        select() { return q; }, in() { return q; }, order() { return q; }, gte() { return q; },
                        is() { return q; }, eq() { return q; }, limit() { return q; }, range() { return q; },
                        then(ok, er) { return Promise.resolve({ data: T[t] || [], error: null }).then(ok, er); }
                    };
                    return q;
                },
                rpc(n, a) {
                    window.chamadasRpc.push({ n, a });
                    if (n === 'solidcon_mapa_clientes') return this.from('solidcon_mapa_clientes');
                    if (n === 'pode_marcar_rota') return Promise.resolve({ data: true, error: null });
                    if (n === 'rota_050_ler') return Promise.resolve({ data: null, error: null });
                    if (n === 'solidcon_rota_posicoes') return Promise.resolve({ data: T.solidcon_clientes, error: null });
                    if (n === 'rota_063_ler_entregas') {
                        return Promise.resolve({ data: [{ cd_pedido: 1599, id: 1, confirmado_em: '2026-11-25T10:00:00-03:00', confirmado_nome: 'Márcio' }], error: null });
                    }
                    if (n === 'rota_065_ler_semana') {
                        return Promise.resolve({
                            data: {
                                status: 'ok',
                                inicio: a.p_inicio,
                                hoje: '2026-11-25',
                                versao: 3,
                                itens: itens065,
                                sem_saida: [],
                                fechados: ['2026-11-25']
                            },
                            error: null
                        });
                    }
                    if (n === 'rota_065_salvar_semana') {
                        return Promise.resolve({ data: { status: 'ok', versao: 4, itens: a.p_itens.length }, error: null });
                    }
                    return Promise.resolve({ data: [], error: null });
                }
            };

            window.TempRioRota.desenhar(document.getElementById('painel-rotas'), { sb, papel: 'admin' });
        `);

        for (let i = 0; i < 40; i++) {
            if (await run(`!!document.querySelector('#rota-semana-quadro [data-rq-quadro="1"]')`)) break;
            await sleep(50);
        }

        // 066: Aba Rotas abre DIRETO na Semana (sem precisar clicar na aba Semana)
        check(await run(`!!document.querySelector('#rota-semana-quadro [data-rq-quadro="1"]')`), 'aba Rotas abre direto no quadro 065/066 da Semana');
        check(await run(`document.querySelectorAll('[data-rq-coluna]').length === 6`), '6 colunas de dias (Seg..Sab)');
        check(await run(`document.querySelectorAll('[data-rq-bandeja-item]').length === 4`), '4 cartoes iniciais na bandeja (sem o #1599 Recebido 063)');
        check(await run(`!document.querySelector('[data-rq-cartao="1599"]')`), 'pedido #1599 Recebido 063 ausente do quadro e da bandeja');
        check(await run(`!!document.querySelector('[data-rq-alerta-cap="2026-11-27"]')`), 'alerta visual de capacidade excedida na sexta 27/11');
        check(await run(`!!document.querySelector('[data-rq-contador-atraso]')`), 'contador de atraso no topo da coluna');
        check(await run(`!!document.querySelector('[data-rq-selo-atraso="1"]')`), 'selo vermelho Atrasa 1 dia visivel no cartao apos o prazo');
        check(await run(`!!document.querySelector('[data-rq-sem-geo="1545"]')`), 'cartao #1545 sem coordenadas exibe icone/selo Sem localizacao');
        check(await run(`document.querySelectorAll('[data-rq-mapa-linha]').length >= 5`), 'legenda do mapa da semana lista as linhas por dia/veiculo');
        check(await run(`document.querySelectorAll('[data-rq-svg-dia]').length >= 5 && !!document.querySelector('[data-rq-svg-deposito]')`), 'polylines das rotas e marcador do deposito desenhados no mapa');
        // 066: Passar o mouse num dia destaca so a linha daquele dia no mapa
        await run(`document.querySelector('[data-rq-coluna="2026-11-26"]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
        check(await run(`document.querySelector('[data-rq-svg-dia="2026-11-26"]').getAttribute('stroke-opacity') === '1' && document.querySelector('[data-rq-svg-dia="2026-11-27"]').getAttribute('stroke-opacity') === '0.16'`), 'passar o mouse num dia destaca so a linha dele');
        await run(`document.querySelector('[data-rq-coluna="2026-11-26"]').dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))`);
        check(await run(`!!document.querySelector('[data-rq-sug-cartao]') && !!document.querySelector('[data-rq-sug-coluna]')`), 'chips discretos de sugestao 066 no cartao e na coluna');
        check(await run(`!document.querySelector('[data-rq-veic-filtro="strada"]')`), 'Strada inativa oculta no filtro');
        check(await run(`parseFloat(getComputedStyle(document.querySelector('[data-rq-pilha="2026-11-26"] .rq-cartao + .rq-cartao')).marginTop) < -15`), 'pilha compacta tipo baralho com sobreposicao negativa');

        // 066: Clicar num dia abre o detalhe daquele dia, e clicar em "Voltar para a semana" retorna ao quadro
        await run(`document.querySelector('[data-rq-abrir-dia="2026-11-26"]').click()`);
        check(await run(`!!document.querySelector('#rota-voltar-semana') && !document.querySelector('#rota-semana-quadro')`), 'clicar num dia abre o detalhe daquele dia com botao Voltar para a semana');
        await run(`document.querySelector('#rota-voltar-semana').click()`);
        check(await run(`!!document.querySelector('#rota-semana-quadro [data-rq-quadro="1"]')`), 'Voltar para a semana retorna ao quadro da Semana');

        // Abre um menu "Programar para..." na bandeja e verifica que nao cobre o cabecalho da bandeja
        await run(`
            const menuBandeja = document.querySelector('[data-rq-cartao="1534"] details.rq-menu');
            menuBandeja.setAttribute('open', '');
            menuBandeja.closest('.rq-cartao').classList.add('is-menu-aberto');
        `);
        check(await run(`{
            const h = document.getElementById('rq-bandeja-tit').getBoundingClientRect();
            const p = document.querySelector('[data-rq-cartao="1534"] .rq-menu-painel').getBoundingClientRect();
            p.top >= h.bottom;
        }`), 'menu Programar para nao cobre o cabecalho da bandeja');

        const shotDesktop = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        fs.writeFileSync(outDesktop, Buffer.from(shotDesktop.data, 'base64'));
        fs.writeFileSync(outDesktop066, Buffer.from(shotDesktop.data, 'base64'));

        // Testa acao acessivel de programar pelo menu: #1534 -> Sexta 27/11 (atrasa 3 dias pois prazo e 24/11)
        await run(`document.querySelector('[data-rq-cartao="1534"] [data-rq-programar-dia="2026-11-27"]').click()`);
        check(await run(`document.querySelectorAll('[data-rq-bandeja-item]').length === 3`), 'programar pelo menu tira da bandeja');
        check(await run(`!!document.querySelector('[data-rq-coluna="2026-11-27"] [data-rq-cartao="1534"][data-rq-atraso="3"]')`), 'cartao #1534 entrou na sexta 27/11 com aviso Atrasa 3 dias');

        // Testa chip de sugestao 066 (Aceitar sugestao de #1540 na bandeja)
        await run(`document.querySelector('[data-rq-sug-aceitar="1540"]').click()`);
        check(await run(`document.querySelectorAll('[data-rq-bandeja-item]').length === 2`), 'Aceitar chip de sugestao programa #1540 no rascunho');

        // Testa remover #1539 de Quinta 26/11 para a bandeja
        await run(`document.querySelector('[data-rq-cartao="1539"] [data-rq-remover="1539"]').click()`);
        check(await run(`document.querySelectorAll('[data-rq-bandeja-item]').length === 3`), 'tirar do dia devolve para a bandeja');

        // 066: Botao Salvar semana exibe confirmacao leve ("N pedidos programados depois do prazo") e confirmar grava via RPC
        await run(`document.querySelector('[data-rq-acao="salvar"]').click()`);
        check(await run(`!!document.querySelector('[data-rq-confirma-atraso]')`), 'confirmacao leve ao salvar exibe N pedidos programados depois do prazo');
        await run(`document.querySelector('[data-rq-acao="confirmar-salvar"]').click()`);
        await sleep(50);
        check(await run(`window.chamadasRpc.some(c => c.n === 'rota_065_salvar_semana' && c.a.p_versao_base === 3)`), 'confirmar-salvar chama rota_065_salvar_semana com p_versao_base=3');
        check(await run(`document.querySelector('[data-rq-quadro]').getAttribute('data-rq-versao') === '4'`), 'versao atualizada para 4 apos salvar');

        // Testa mobile (390x844) sem overflow horizontal
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        check(await run(`document.documentElement.scrollWidth <= 390`), 'mobile sem overflow horizontal');
        const shotMobile = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(outMobile, Buffer.from(shotMobile.data, 'base64'));
        fs.writeFileSync(outMobile066, Buffer.from(shotMobile.data, 'base64'));

        check(errors.length === 0, 'zero excecoes JS no browser');
        console.log(JSON.stringify({ ok: true, checks, outDesktop, outMobile }));
    } finally {
        if (ws) { try { await send('Browser.close', {}, null); } catch {} ws.close(); }
        child.kill();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
