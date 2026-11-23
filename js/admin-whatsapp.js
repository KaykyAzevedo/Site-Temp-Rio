/* =====================================================================
 * Aba "WhatsApp" do painel (SÓ admin): destinatários (com consentimento — LGPD), rotinas (liga/desliga, horário,
 * dias, quem recebe, modo simulação/real), "Gerar prévia agora" e log dos últimos envios.
 * Tabelas da migração 042 (RLS: só eh_admin()). Montagem das mensagens: supabase/functions/_shared/whatsapp-core.js
 * (o MESMO código da Edge Function whatsapp-rotinas). Esta tela NUNCA envia mensagem: a prévia é local (simulação) ou
 * pela função em modo prévia (que também não envia).
 * Tudo que vem do banco é escapado (esc) ou vai por textContent.
 * ===================================================================== */
(function (raiz) {
    'use strict';
    var ROTULO = { receber_diario: 'Contas a receber (diário)', rota_s10: 'Rota da S10', rota_caminhao: 'Rota do caminhão (CEASA)', alertas_marcio: 'Alertas para o Márcio',
                  // 049 (WA-PED)
                  pedidos_dia: 'Pedidos do dia (para o chefe)', rota_chefe: 'Rota do dia e rota sugerida (para o chefe)' };
    var DIAS = [['seg', 'Seg'], ['ter', 'Ter'], ['qua', 'Qua'], ['qui', 'Qui'], ['sex', 'Sex'], ['sab', 'Sáb'], ['dom', 'Dom']];
    var PAPEL = { gestor: 'Gestor', entregador: 'Entregador', outro: 'Outro' };
    var STATUS = { simulado: 'Simulado', enviado: 'Enviado', erro: 'Erro', pulado: 'Pulado' };
    var st = { sb: null, papel: null, alvo: null, confirmar: null, carregando: false, carregado: false, ausente: false, erro: null,
               dest: [], rotinas: [], envios: [], ocupado: {}, msg: '', previa: null, sessao: 0, seqGet: 0 };

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function ausente(e) { return !!e && /PGRST205|42P01|does not exist|Could not find the table/i.test(String(e.code || '') + ' ' + String(e.message || '')); }
    function quando(v) { if (!v) return '—'; var d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    // Telefone: aceita "(21) 99999-0000" (vira +55...) ou já em E.164 (+...). Devolve null se não der.
    function e164(t) {
        var s = String(t || '').trim(), d = s.replace(/\D/g, '');
        if (s.charAt(0) === '+') return /^[1-9]\d{7,14}$/.test(d) ? '+' + d : null;
        if (/^\d{10,11}$/.test(d)) return '+55' + d;
        if (/^55\d{10,11}$/.test(d)) return '+' + d;
        return null;
    }
    function mascarar(t) { var s = String(t || ''); return s.length > 6 ? s.slice(0, 5) + '•••' + s.slice(-4) : s; }

    function sessaoAdmin(sessao) { return !!(st.sb && st.papel === 'admin' && (sessao == null || sessao === st.sessao)); }

    function carregar() {
        if (!sessaoAdmin()) return;
        var sessao = st.sessao, seqGet = ++st.seqGet, sb = st.sb;
        st.carregando = true; st.erro = null; desenhar();
        Promise.all([
            sb.from('whatsapp_destinatarios').select('*').order('nome', { ascending: true }),
            sb.from('whatsapp_rotinas').select('*').order('codigo', { ascending: true }),
            sb.from('whatsapp_envios').select('id,rotina,destinatario_id,origem,status,erro,corpo,meta_id,criado_em').order('criado_em', { ascending: false }).limit(50)
        ]).then(function (rs) {
            if (!sessaoAdmin(sessao) || seqGet !== st.seqGet) return;
            st.carregando = false;
            var e = rs.filter(function (r) { return r.error; })[0];
            if (e) { if (ausente(e.error)) { st.ausente = true; st.carregado = true; } else st.erro = String(e.error.message || e.error); desenhar(); return; }
            st.ausente = false; st.carregado = true;
            st.dest = rs[0].data || []; st.rotinas = rs[1].data || []; st.envios = rs[2].data || [];
            desenhar();
        }, function (e) { if (!sessaoAdmin(sessao) || seqGet !== st.seqGet) return; st.carregando = false; st.erro = String((e && e.message) || e); desenhar(); });
    }

    // Uma ação por chave por vez (sem clique duplo); depois recarrega. A trava ocupado[chave] é sempre liberada no finally.
    function acao(chave, fazer, ok) {
        if (!sessaoAdmin() || st.ocupado[chave]) return;
        var sessao = st.sessao;
        st.ocupado[chave] = true; st.msg = ''; desenhar();
        Promise.resolve().then(fazer).then(function (r) {
            if (!sessaoAdmin(sessao)) return;
            if (r && r.error) { st.msg = 'Não foi possível salvar: ' + String(r.error.message || r.error); return; }
            st.msg = ok || 'Salvo.'; st.carregado = false; carregar();
        }, function (e) {
            if (!sessaoAdmin(sessao)) return;
            st.msg = 'Não foi possível salvar: ' + String((e && e.message) || e);
        }).finally(function () {
            if (!sessaoAdmin(sessao)) return;
            delete st.ocupado[chave];
            desenhar();
        });
    }

    function htmlDest() {
        var linhas = st.dest.map(function (d) {
            var k = 'd:' + d.id, oc = !!st.ocupado[k];
            return '<tr><td>' + esc(d.nome) + '</td><td class="whitespace-nowrap" title="Telefone cadastrado">' + esc(mascarar(d.telefone)) + '</td><td>' + esc(PAPEL[d.papel] || d.papel) + '</td>' +
                '<td><label class="inline-flex items-center gap-2"><input type="checkbox" data-wa-dest-ativo="' + esc(d.id) + '"' + (d.ativo ? ' checked' : '') + (oc ? ' disabled' : '') + '> Ativo</label></td>' +
                '<td><label class="inline-flex items-center gap-2"><input type="checkbox" data-wa-dest-consent="' + esc(d.id) + '"' + (d.consentimento_em ? ' checked' : '') + (oc ? ' disabled' : '') + '> ' +
                (d.consentimento_em ? 'Concordou em ' + esc(quando(d.consentimento_em)) : '<span class="text-amber-500">Sem consentimento: não recebe</span>') + '</label></td>' +
                '<td><button type="button" class="adm-botao-fantasma" data-wa-dest-remover="' + esc(d.id) + '"' + (oc ? ' disabled aria-busy="true"' : '') + '>Remover</button></td></tr>';
        }).join('');
        var oc = !!st.ocupado.novo;
        return '<section class="adm-card p-5 mb-6" aria-labelledby="wa-dest-tit"><h3 id="wa-dest-tit" class="rota-tit"><i class="fa-solid fa-address-book" aria-hidden="true"></i> Quem recebe</h3>' +
            '<p class="rota-sub mb-3">Só recebe quem está <strong>ativo</strong> e <strong>concordou</strong> em receber mensagens do Temp Rio por WhatsApp (LGPD). Telefones ficam só no banco.</p>' +
            (st.dest.length ? '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Nome</th><th>Telefone</th><th>Papel</th><th>Situação</th><th>Consentimento</th><th></th></tr></thead><tbody>' + linhas + '</tbody></table></div>'
                            : '<p class="adm-vazio-linha">Nenhum destinatário cadastrado.</p>') +
            '<form id="wa-novo" class="flex flex-wrap items-end gap-3 mt-4" novalidate>' +
            '<label class="flex flex-col text-sm">Nome<input class="adm-input" name="nome" maxlength="80" required autocomplete="off"></label>' +
            '<label class="flex flex-col text-sm">Telefone (WhatsApp)<input class="adm-input" name="telefone" inputmode="tel" placeholder="(21) 99999-0000" required autocomplete="off"></label>' +
            '<label class="flex flex-col text-sm">Papel<select class="adm-input" name="papel"><option value="gestor">Gestor</option><option value="entregador">Entregador</option><option value="outro">Outro</option></select></label>' +
            '<label class="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="consent"> A pessoa concordou em receber estas mensagens</label>' +
            '<button type="submit" class="adm-botao"' + (oc ? ' disabled aria-busy="true"' : '') + '>Adicionar</button></form></section>';
    }

    function htmlRotinas() {
        var cards = st.rotinas.map(function (r) {
            var k = 'r:' + r.codigo, oc = !!st.ocupado[k], pv = !!st.ocupado['p:' + r.codigo], id = 'wa-r-' + esc(r.codigo);
            var dias = DIAS.map(function (d) { return '<label class="inline-flex items-center gap-1 mr-2"><input type="checkbox" name="dia" value="' + d[0] + '"' + ((r.dias || []).indexOf(d[0]) >= 0 ? ' checked' : '') + '> ' + d[1] + '</label>'; }).join('');
            var quem = st.dest.length ? st.dest.map(function (d) {
                return '<label class="inline-flex items-center gap-1 mr-3"><input type="checkbox" name="dest" value="' + esc(d.id) + '"' + ((r.destinatarios || []).indexOf(d.id) >= 0 ? ' checked' : '') + '> ' + esc(d.nome) +
                    (!d.consentimento_em || !d.ativo ? ' <span class="text-amber-500">(não recebe)</span>' : '') + '</label>';
            }).join('') : '<span class="rota-sub">Cadastre destinatários acima.</span>';
            return '<form class="adm-card p-4 mb-4" data-wa-rotina="' + esc(r.codigo) + '" aria-labelledby="' + id + '" novalidate>' +
                '<div class="flex flex-wrap items-center justify-between gap-2"><h4 id="' + id + '" class="font-bold">' + esc(ROTULO[r.codigo] || r.codigo) + '</h4>' +
                '<span class="adm-chip' + (r.modo === 'real' ? ' is-ativo' : '') + '">' + (r.modo === 'real' ? 'ENVIO REAL' : 'Simulação') + '</span></div>' +
                (r.descricao ? '<p class="rota-sub mb-2">' + esc(r.descricao) + '</p>' : '') +
                '<fieldset' + (oc ? ' disabled' : '') + ' class="flex flex-wrap items-end gap-4 text-sm">' +
                '<label class="inline-flex items-center gap-2"><input type="checkbox" name="ativo"' + (r.ativo ? ' checked' : '') + '> Ligada</label>' +
                '<label class="flex flex-col">Horário (Brasília)<input type="time" class="adm-input" name="horario" value="' + esc(String(r.horario || '06:00').slice(0, 5)) + '" step="900"></label>' +
                '<label class="flex flex-col">Modo<select class="adm-input" name="modo"><option value="simulacao"' + (r.modo !== 'real' ? ' selected' : '') + '>Simulação (não envia)</option><option value="real"' + (r.modo === 'real' ? ' selected' : '') + '>Envio real</option></select></label>' +
                '<label class="flex flex-col">Template na Meta<input class="adm-input" name="template" value="' + esc(r.template || '') + '" maxlength="250" pattern="[a-z0-9_]+" autocomplete="off"></label>' +
                '<div><span class="block mb-1">Dias</span>' + dias + '</div>' +
                '<div class="w-full"><span class="block mb-1">Quem recebe</span>' + quem + '</div></fieldset>' +
                '<div class="flex flex-wrap gap-2 mt-3"><button type="submit" class="adm-botao"' + (oc ? ' disabled aria-busy="true"' : '') + '>Salvar</button>' +
                '<button type="button" class="adm-botao-fantasma" data-wa-previa="' + esc(r.codigo) + '"' + (pv ? ' disabled aria-busy="true"' : '') + '><i class="fa-regular fa-eye" aria-hidden="true"></i> Gerar prévia agora</button>' +
                '<button type="button" class="adm-botao-fantasma" data-wa-previa-funcao="' + esc(r.codigo) + '"' + (pv ? ' disabled aria-busy="true"' : '') + ' title="Testa a Edge Function publicada (também não envia)">Prévia pela função</button></div></form>';
        }).join('');
        return '<section class="mb-6" aria-labelledby="wa-rot-tit"><h3 id="wa-rot-tit" class="rota-tit mb-3"><i class="fa-solid fa-clock" aria-hidden="true"></i> Rotinas</h3>' +
            '<p class="rota-sub mb-3">O banco confere a cada 15 minutos o que está na hora (horário de Brasília) e cada rotina sai no máximo 1 vez por dia. Em <strong>Simulação</strong> a mensagem é montada e guardada no histórico, sem enviar. <strong>Envio real</strong> só funciona depois que o dono configurar a conta da Meta (integracao/whatsapp/LEIAME.md).</p>' +
            (cards || '<p class="adm-vazio-linha">Nenhuma rotina (aplique a migração 042).</p>') + '</section>';
    }

    function htmlPrevia() {
        if (!st.previa) return '';
        return '<section class="adm-card p-5 mb-6" aria-labelledby="wa-pv-tit" id="wa-previa"><div class="flex items-center justify-between gap-2"><h3 id="wa-pv-tit" class="rota-tit"><i class="fa-regular fa-eye" aria-hidden="true"></i> Prévia: ' + esc(ROTULO[st.previa.codigo] || st.previa.codigo) + '</h3>' +
            '<button type="button" class="adm-botao-fantasma" data-wa-previa-fechar>Fechar</button></div>' +
            '<p class="rota-sub mb-2">' + esc(st.previa.origem) + (st.previa.vazio ? ' · não seria enviada: ' + esc(st.previa.vazio) : '') + (st.previa.partes != null ? ' · ' + st.previa.partes + ' mensagem(ns) de template' : '') + '</p>' +
            '<pre class="whitespace-pre-wrap break-words text-sm p-3 rounded-lg" style="background:var(--adm-neutro-fundo-2, rgba(127,127,127,.12));max-width:46rem" data-wa-previa-texto></pre></section>';
    }

    function htmlLog() {
        var nome = {}; st.dest.forEach(function (d) { nome[d.id] = d.nome; });
        var linhas = st.envios.map(function (e) {
            return '<tr><td class="whitespace-nowrap">' + esc(quando(e.criado_em)) + '</td><td>' + esc(ROTULO[e.rotina] || e.rotina) + (e.origem === 'previa' ? ' <span class="rota-sub">(prévia)</span>' : '') + '</td>' +
                '<td>' + esc(e.destinatario_id ? (nome[e.destinatario_id] || 'removido') : '—') + '</td><td>' + esc(STATUS[e.status] || e.status) + '</td><td>' + esc(e.erro || '') + '</td>' +
                '<td>' + (e.corpo ? '<details><summary>Ver texto</summary><pre class="whitespace-pre-wrap break-words text-xs" style="max-width:32rem">' + esc(e.corpo) + '</pre></details>' : '') + '</td></tr>';
        }).join('');
        return '<section class="adm-card p-5 mb-6" aria-labelledby="wa-log-tit"><h3 id="wa-log-tit" class="rota-tit"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> Últimos envios</h3>' +
            '<p class="rota-sub mb-3">50 mais recentes. O histórico guarda valores comerciais e é apagado depois de 90 dias.</p>' +
            (linhas ? '<div class="overflow-x-auto"><table class="adm-tabela"><thead><tr><th>Quando</th><th>Rotina</th><th>Para</th><th>Situação</th><th>Detalhe</th><th>Texto</th></tr></thead><tbody>' + linhas + '</tbody></table></div>'
                    : '<p class="adm-vazio-linha">Nada ainda.</p>') + '</section>';
    }

    function desenhar() {
        var alvo = st.alvo; if (!alvo) return;
        var cab = '<div class="flex flex-wrap items-center justify-between gap-3 mb-5"><div><h2 class="rota-titulo"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> WhatsApp</h2>' +
            '<p class="rota-sub">Relatórios e avisos automáticos. Esta tela não envia nada sozinha.</p></div>' +
            '<button type="button" class="adm-botao-fantasma" data-wa-recarregar' + (st.carregando ? ' disabled aria-busy="true"' : '') + '>Atualizar</button></div>';
        if (st.papel !== 'admin') { alvo.innerHTML = cab + '<div class="adm-card p-6">Somente o administrador acessa esta área.</div>'; return; }
        if (st.erro) { alvo.innerHTML = cab + '<div class="adm-card p-6" role="alert">Não foi possível carregar: ' + esc(st.erro) + '</div>'; return; }
        if (!st.carregado) { alvo.innerHTML = cab + '<div class="adm-card p-6" aria-busy="true">Carregando…</div>'; return; }
        if (st.ausente) { alvo.innerHTML = cab + '<div class="adm-card p-6"><p class="adm-vazio-titulo">WhatsApp ainda não instalado</p><p class="adm-vazio-texto">Falta aplicar a migração 042 (admin/migracoes/042_whatsapp.sql).</p></div>'; return; }
        alvo.innerHTML = cab + '<p class="text-sm mb-4" role="status" aria-live="polite">' + esc(st.msg) + '</p>' + htmlPrevia() + htmlDest() + htmlRotinas() + htmlLog();
        var pre = alvo.querySelector('[data-wa-previa-texto]');
        if (pre && st.previa) pre.textContent = st.previa.texto;   // texto da mensagem: sempre como TEXTO, nunca HTML
    }

    function gerarPrevia(codigo, pelaFuncao) {
        var k = 'p:' + codigo;
        if (!sessaoAdmin() || st.ocupado[k]) return;
        var sessao = st.sessao, sb = st.sb;
        st.ocupado[k] = true; st.msg = ''; desenhar();
        var agora = new Date(), p;
        if (pelaFuncao) {
            p = sb.functions.invoke('whatsapp-rotinas', { body: { acao: 'previa', rotina: codigo } }).then(function (r) {
                if (r.error) throw new Error('a função não respondeu (publicada? ' + String(r.error.message || r.error) + ')');
                return { texto: r.data.texto, vazio: r.data.vazio, partes: (r.data.partes || []).length, origem: 'Gerada pela Edge Function (dados reais, sem envio)' };
            });
        } else {
            var W = raiz.TempRioWhatsCore;
            // mesmo template da rotina gravada (ex.: relatorio_diario_v2) = mesma prévia que a Edge Function gera e envia
            var rot = st.rotinas.filter(function (x) { return x.codigo === codigo; })[0];
            if (!W) p = Promise.reject(new Error('whatsapp-core.js não carregou'));
            else p = W.gerar(sb, codigo, agora, { painelUrl: raiz.location ? raiz.location.origin : '', template: (rot && rot.template) || undefined }).then(function (m) {
                return { texto: m.texto, vazio: m.vazio || null, partes: (m.partes || []).length, origem: 'Gerada agora no painel (simulação, dados reais, sem envio)' };
            });
        }
        var focar = false;
        p.then(function (r) {
            if (!sessaoAdmin(sessao)) return;
            r.codigo = codigo; st.previa = r; focar = true;
        }, function (e) {
            if (!sessaoAdmin(sessao)) return;
            st.msg = 'Prévia indisponível: ' + String((e && e.message) || e);
        }).finally(function () {
            if (!sessaoAdmin(sessao)) return;
            delete st.ocupado[k]; desenhar();
            if (focar) { var s = st.alvo && st.alvo.querySelector('#wa-previa'); if (s && s.scrollIntoView) s.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
        });
    }

    function ligar(alvo) {
        if (alvo._waLigado) return;
        alvo._waLigado = true;
        alvo.addEventListener('click', function (ev) {
            if (!sessaoAdmin()) return;
            var b = ev.target.closest('button'); if (!b || !alvo.contains(b) || b.disabled) return;
            if (b.hasAttribute('data-wa-recarregar')) { st.carregado = false; st.msg = ''; carregar(); return; }
            if (b.hasAttribute('data-wa-previa')) { gerarPrevia(b.getAttribute('data-wa-previa'), false); return; }
            if (b.hasAttribute('data-wa-previa-funcao')) { gerarPrevia(b.getAttribute('data-wa-previa-funcao'), true); return; }
            if (b.hasAttribute('data-wa-previa-fechar')) { st.previa = null; desenhar(); return; }
            var rem = b.getAttribute('data-wa-dest-remover');
            if (rem) {
                var d = st.dest.filter(function (x) { return x.id === rem; })[0]; if (!d) return;
                var sessao = st.sessao, sb = st.sb;
                (st.confirmar ? st.confirmar('Remover ' + d.nome + ' da lista do WhatsApp? O histórico de envios fica.', 'Remover', true, b) : Promise.resolve(false)).then(function (ok) {
                    if (!ok || !sessaoAdmin(sessao)) return;
                    acao('d:' + rem, function () {
                        // Também tira das rotinas (a lista de quem recebe guarda os ids).
                        return Promise.all(st.rotinas.filter(function (r) { return (r.destinatarios || []).indexOf(rem) >= 0; }).map(function (r) {
                            return sb.from('whatsapp_rotinas').update({ destinatarios: r.destinatarios.filter(function (x) { return x !== rem; }) }).eq('codigo', r.codigo);
                        })).then(function (rs) { var e = rs.filter(function (r) { return r.error; })[0]; return e || sb.from('whatsapp_destinatarios').delete().eq('id', rem); });
                    }, 'Destinatário removido.');
                });
            }
        });
        alvo.addEventListener('change', function (ev) {
            if (!sessaoAdmin()) return;
            var el = ev.target, id = el.getAttribute('data-wa-dest-ativo') || el.getAttribute('data-wa-dest-consent');
            if (!id) return;
            var sb = st.sb;
            var campo = el.hasAttribute('data-wa-dest-ativo') ? { ativo: el.checked } : { consentimento_em: el.checked ? new Date().toISOString() : null };
            acao('d:' + id, function () { return sb.from('whatsapp_destinatarios').update(campo).eq('id', id); }, el.hasAttribute('data-wa-dest-ativo') ? 'Situação salva.' : 'Consentimento salvo.');
        });
        alvo.addEventListener('submit', function (ev) {
            ev.preventDefault();
            if (!sessaoAdmin()) return;
            var f = ev.target, sb = st.sb;
            if (f.id === 'wa-novo') {
                var nome = f.nome.value.trim(), tel = e164(f.telefone.value);
                if (!nome) { st.msg = 'Informe o nome.'; desenhar(); return; }
                if (!tel) { st.msg = 'Telefone inválido: use DDD + número, ex.: (21) 99999-0000.'; desenhar(); return; }
                var linha = { nome: nome, telefone: tel, papel: f.papel.value, consentimento_em: f.consent.checked ? new Date().toISOString() : null };
                acao('novo', function () { return sb.from('whatsapp_destinatarios').insert(linha); }, 'Destinatário adicionado.');
                return;
            }
            var cod = f.getAttribute('data-wa-rotina'); if (!cod) return;
            var r = st.rotinas.filter(function (x) { return x.codigo === cod; })[0]; if (!r) return;
            var dias = [].slice.call(f.querySelectorAll('input[name="dia"]:checked')).map(function (i) { return i.value; });
            if (!dias.length) { st.msg = 'Marque pelo menos um dia.'; desenhar(); return; }
            var tpl = f.template.value.trim();
            if (tpl && !/^[a-z0-9_]{1,250}$/.test(tpl)) { st.msg = 'Nome de template: só letras minúsculas, números e _.'; desenhar(); return; }
            var upd = { ativo: f.ativo.checked, horario: f.horario.value || '06:00', modo: f.modo.value, template: tpl || null, dias: dias,
                        destinatarios: [].slice.call(f.querySelectorAll('input[name="dest"]:checked')).map(function (i) { return i.value; }) };
            var virandoReal = upd.modo === 'real' && r.modo !== 'real';
            var botao = f.querySelector('button[type="submit"]');
            var sessao = st.sessao;
            (virandoReal && st.confirmar ? st.confirmar('Ligar o ENVIO REAL de "' + (ROTULO[cod] || cod) + '"? As mensagens passam a ser enviadas pelo WhatsApp (com custo por mensagem na Meta).', 'Ligar envio real', true, botao)
                                         : Promise.resolve(!virandoReal)).then(function (ok) {
                if (!sessaoAdmin(sessao)) return;
                if (!ok) { if (virandoReal) { st.msg = 'Continua em simulação.'; desenhar(); } return; }
                acao('r:' + cod, function () { return sb.from('whatsapp_rotinas').update(upd).eq('codigo', cod); }, 'Rotina salva.');
            });
        });
    }

    raiz.TempRioWhats = {
        desenhar: function (alvo, o) {
            var nvSb = o && o.sb || null, nvPapel = o && o.papel || null;
            if (nvSb !== st.sb || nvPapel !== st.papel) st.sessao++;
            st.alvo = alvo; st.sb = nvSb; st.papel = nvPapel; st.confirmar = (o && o.confirmar) || null;
            if (st.papel !== 'admin') { st.dest = []; st.rotinas = []; st.envios = []; st.previa = null; st.carregado = false; st.carregando = false; st.ocupado = {}; st.msg = ''; st.erro = null; }
            if (alvo) ligar(alvo);
            if (sessaoAdmin() && !st.carregado && !st.carregando) carregar(); else desenhar();
        },
        recarregar: function () { if (!sessaoAdmin()) return; st.carregado = false; carregar(); },
        // Saiu da conta: esquece tudo (telefones e textos não ficam na memória nem no DOM da página).
        sair: function () {
            var a = st.alvo || (typeof document !== 'undefined' && document.getElementById('painel-whatsapp'));
            if (a) a.innerHTML = '';
            st = { sb: null, papel: null, alvo: null, confirmar: null, carregando: false, carregado: false, ausente: false, erro: null,
                   dest: [], rotinas: [], envios: [], ocupado: {}, msg: '', previa: null, sessao: st.sessao + 1, seqGet: 0 };
        },
        _e164: e164
    };
})(typeof window !== 'undefined' ? window : this);
