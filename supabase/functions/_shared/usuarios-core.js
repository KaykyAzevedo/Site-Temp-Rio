/* =====================================================================
 * USUÁRIOS — NÚCLEO PURO (sem rede). Usado pela Edge Function usuarios-admin (Deno: import com efeito colateral,
 * globalThis.TempRioUsuariosCore) e pelos testes (node: require). Nada aqui fala com o banco nem com o Auth.
 *
 * Tipos de acesso: 'admin' | 'vendedor' (linha em public.admins, papel) | 'motorista' (public.rota_motoristas ativo,
 * 047; NÃO entra em admins) | 'sem_acesso' (login sem papel). Nome e "último tipo" do usuário ficam no app_metadata do
 * Auth (só o servidor escreve): tr_nome, tr_tipo, tr_marca_rota, tr_veiculo — é o que o "Reativar" usa para devolver o
 * acesso. Senha NUNCA é guardada nem registrada: é gerada aqui e devolvida uma vez ao admin.
 * ===================================================================== */
(function (raiz) {
    'use strict';
    var TIPOS = ['admin', 'vendedor', 'motorista'];
    var ACOES = ['listar', 'criar', 'redefinir_senha', 'alterar', 'desativar', 'reativar'];
    var ACOES_LOG = ['criar', 'redefinir_senha', 'alterar', 'desativar', 'reativar'];
    var BAN_LONGO = '876000h';   // ~100 anos ("desativado"); 'none' tira o ban
    var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    var VEIC = /^[a-z0-9_]{2,20}$/;
    // Senha legível: sem 0/O/o, 1/l/I/i (confundem ao ditar/copiar no WhatsApp). 4 grupos de 4 = 16 sorteios de 54
    // símbolos (~92 bits), sempre com minúscula, maiúscula e dígito.
    var ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

    function temProp(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
    function normalizarEmail(e) {
        var s = String(e == null ? '' : e).trim().toLowerCase();
        if (!s || s.length > 254) return null;
        // local@dominio.tld, sem espaço/aspas/< >; domínio com ponto e TLD de 2+ letras
        if (!/^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(s) || s.indexOf('..') >= 0) return null;
        return s;
    }
    // Mesmo critério do texto_seguro (013): sem < >, tamanho; espaços colapsados. Vazio = null.
    function nomeLimpo(n, max) {
        var s = String(n == null ? '' : n).replace(/\s+/g, ' ').trim();
        if (!s) return '';
        if (s.length > (max || 60) || /[<>]/.test(s)) return null;
        return s;
    }
    function erro(codigo, campo) { return { erro: codigo, campo: campo || null }; }

    // Valida o corpo de cada ação. Devolve { ok: true, dados } ou { erro, campo }.
    function validar(corpo) {
        corpo = corpo && typeof corpo === 'object' ? corpo : {};
        var acao = String(corpo.acao || '');
        if (ACOES.indexOf(acao) < 0) return erro('acao_invalida', 'acao');
        var d = { acao: acao };
        if (acao === 'listar') return { ok: true, dados: d };
        if (acao !== 'criar') {
            var id = String(corpo.id || '').toLowerCase();
            if (!UUID.test(id)) return erro('id_invalido', 'id');
            d.id = id;
        }
        if (acao === 'criar') {
            d.email = normalizarEmail(corpo.email);
            if (!d.email) return erro('email_invalido', 'email');
            d.nome = nomeLimpo(corpo.nome, 60);
            if (d.nome === null || d.nome === '') return erro('nome_invalido', 'nome');
        } else if (corpo.nome !== undefined && corpo.nome !== null && (acao === 'alterar' || acao === 'reativar')) {
            d.nome = nomeLimpo(corpo.nome, 60);
            if (d.nome === null || d.nome === '') return erro('nome_invalido', 'nome');
        }
        if (acao === 'criar' || acao === 'alterar' || acao === 'reativar') {
            if (corpo.tipo !== undefined && corpo.tipo !== null && corpo.tipo !== '') {
                if (TIPOS.indexOf(String(corpo.tipo)) < 0) return erro('tipo_invalido', 'tipo');
                d.tipo = String(corpo.tipo);
            } else if (acao === 'criar' || acao === 'reativar') return erro(acao === 'reativar' ? 'tipo_desconhecido' : 'tipo_invalido', 'tipo');
            if (corpo.veiculo_id !== undefined && corpo.veiculo_id !== null && corpo.veiculo_id !== '') {
                if (!VEIC.test(String(corpo.veiculo_id))) return erro('veiculo_invalido', 'veiculo_id');
                d.veiculo_id = String(corpo.veiculo_id);
            }
            if (d.tipo === 'motorista' && (acao === 'criar' || acao === 'reativar') && !d.veiculo_id) return erro('veiculo_obrigatorio', 'veiculo_id');
            if (corpo.marca_rota !== undefined && corpo.marca_rota !== null) {
                if (typeof corpo.marca_rota !== 'boolean') return erro('marca_rota_invalida', 'marca_rota');
                d.marca_rota = corpo.marca_rota;
            }
        }
        return { ok: true, dados: d };
    }

    // randomBytes(n) -> Uint8Array (crypto.getRandomValues no Deno). Rejeição para não enviesar (256 % 54 != 0).
    function gerarSenha(randomBytes) {
        var lim = 256 - (256 % ALFABETO.length);
        for (var tent = 0; tent < 50; tent++) {
            var out = '', bytes = randomBytes(64), i = 0;
            while (out.replace(/-/g, '').length < 16 && i < bytes.length) {
                var b = bytes[i++];
                if (b >= lim) continue;
                if (out.length && out.replace(/-/g, '').length % 4 === 0) out += '-';
                out += ALFABETO.charAt(b % ALFABETO.length);
            }
            if (out.replace(/-/g, '').length === 16 && /[a-z]/.test(out) && /[A-Z]/.test(out) && /[0-9]/.test(out)) return out;
        }
        throw new Error('não foi possível gerar a senha');
    }

    function banido(u, agoraMs) {
        var b = u && u.banned_until ? Date.parse(u.banned_until) : NaN;
        return isFinite(b) && b > agoraMs;
    }
    // Tipo atual de um login: admins (e-mail EXATO, como o eh_admin de produção compara com o JWT) > motorista ativo > sem acesso.
    function papelDe(u, adminsPorEmail, motPorId) {
        var email = String((u && u.email) || '');
        var a = temProp(adminsPorEmail, email) ? adminsPorEmail[email] : null;
        var m = u && temProp(motPorId, u.id) ? motPorId[u.id] : null;
        if (a && (a.papel === 'admin' || a.papel === 'vendedor')) return { tipo: a.papel, marca_rota: a.papel === 'admin' ? true : !!a.marca_rota, veiculo_id: null };
        if (m && m.ativo) return { tipo: 'motorista', marca_rota: false, veiculo_id: m.veiculo_id || null };
        return { tipo: 'sem_acesso', marca_rota: false, veiculo_id: m ? m.veiculo_id || null : null };
    }
    function indice(lista, chave, minusculo) {
        var o = Object.create(null);
        (lista || []).forEach(function (l) { if (l && l[chave] != null) o[minusculo ? String(l[chave]).toLowerCase() : l[chave]] = l; });
        return o;
    }
    // Lista para o painel: SÓ estes campos (nada de metadados crus, identidades, tokens, telefone).
    function montarLista(users, admins, motoristas, agoraMs) {
        var aPor = indice(admins, 'email'), mPor = indice(motoristas, 'user_id'), vistos = Object.create(null), out = [];
        var authMin = Object.create(null);
        (users || []).forEach(function (u) { if (u && u.email) authMin[String(u.email).toLowerCase()] = true; });
        (users || []).forEach(function (u) {
            if (!u || !u.id) return;
            var email = String(u.email || ''), p = papelDe(u, aPor, mPor), am = u.app_metadata || {};
            var m = temProp(mPor, u.id) ? mPor[u.id] : null, ban = banido(u, agoraMs);
            vistos[email] = true;
            out.push({ id: u.id, email: email, nome: nomeLimpo(am.tr_nome || (m && m.nome) || '', 60) || null,
                       tipo: p.tipo, veiculo_id: p.veiculo_id, marca_rota: p.marca_rota, banido: ban, ativo: !ban && p.tipo !== 'sem_acesso',
                       ultimo_tipo: TIPOS.indexOf(am.tr_tipo) >= 0 ? am.tr_tipo : null,
                       criado: u.created_at || null, ultimo_acesso: u.last_sign_in_at || null, sem_login: false, variante: false });
        });
        // Linha em admins sem login com o MESMO e-mail exato (cadastrada à mão): aparece para o admin saber. Se só difere
        // em maiúsculas/minúsculas de um login (variante), ela NÃO dá acesso a ninguém (o JWT traz o e-mail exato do login).
        (admins || []).forEach(function (a) {
            var email = String(a.email || '');
            if (!email || vistos[email]) return;
            out.push({ id: null, email: email, nome: null, tipo: a.papel === 'vendedor' ? 'vendedor' : 'admin', veiculo_id: null,
                       marca_rota: a.papel === 'admin' ? true : !!a.marca_rota, banido: false, ativo: false, ultimo_tipo: null,
                       criado: a.criado_em || null, ultimo_acesso: null, sem_login: true,
                       variante: !!authMin[email.toLowerCase()] || email !== email.toLowerCase() });
        });
        var ordemTipo = { admin: 0, vendedor: 1, motorista: 2, sem_acesso: 3 };
        out.sort(function (x, y) { return (x.ativo === y.ativo ? 0 : x.ativo ? -1 : 1) || (ordemTipo[x.tipo] - ordemTipo[y.tipo]) || (x.email < y.email ? -1 : x.email > y.email ? 1 : 0); });
        return out;
    }
    // Admins ATIVOS (linha admin + login existente e não banido) — base da trava "nunca ficar sem admin".
    function adminsAtivos(lista) { return (lista || []).filter(function (u) { return u.tipo === 'admin' && u.ativo && u.id; }).map(function (u) { return u.id; }); }

    // Travas (espelho para a tela/testes). A regra que VALE está na RPC usuarios_048_aplicar (048), sob lock.
    // alvo = item de montarLista; novoTipo = tipo depois da ação (null = sem acesso).
    // Devolve null (pode) ou o código do bloqueio.
    function trava(acao, chamadorId, alvo, novoTipo, ativosIds) {
        if (!alvo) return 'usuario_nao_encontrado';
        if (alvo.sem_login) return 'sem_login';
        var ehSi = alvo.id && alvo.id === chamadorId;
        var perdeAdmin = alvo.tipo === 'admin' && alvo.ativo && (acao === 'desativar' || (acao === 'alterar' && novoTipo && novoTipo !== 'admin'));
        if (ehSi && (acao === 'desativar' || perdeAdmin)) return 'si_mesmo';
        if (perdeAdmin) {
            var restam = (ativosIds || []).filter(function (id) { return id !== alvo.id; });
            if (!restam.length) return 'ultimo_admin';
        }
        if ((acao === 'alterar' || acao === 'redefinir_senha') && alvo.banido) return 'desativado';
        if (acao === 'reativar' && alvo.ativo) return 'ja_ativo';
        return null;
    }

    // Detalhe do log: só tipo/veículo/marca (NUNCA senha, nunca token). Texto curto, sem < >.
    function detalheLog(acao, antes, depois) {
        function d(p) { return p ? (p.tipo || '-') + (p.veiculo_id ? '/' + p.veiculo_id : '') + (p.tipo === 'vendedor' && p.marca_rota ? '+rota' : '') : '-'; }
        var t = acao === 'criar' ? 'tipo ' + d(depois) : acao === 'redefinir_senha' ? 'senha nova gerada' : d(antes) + ' → ' + d(depois);
        return String(t).replace(/[<>]/g, ' ').slice(0, 200);
    }

    // Limite de taxa simples por chamador (janela deslizante em memória: vale por instância da função).
    function limitador(maximo, janelaMs) {
        var marcas = Object.create(null);
        return function (chave, agoraMs) {
            var l = (marcas[chave] || []).filter(function (t) { return agoraMs - t < janelaMs; });
            if (l.length >= maximo) { marcas[chave] = l; return false; }
            l.push(agoraMs); marcas[chave] = l; return true;
        };
    }
    // CORS: só a origem do site (PAINEL_URL e extras) e localhost/127.0.0.1 de teste. Devolve a origem permitida ou null.
    function origemPermitida(origin, permitidas) {
        if (!origin) return null;
        var o = String(origin);
        if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(o)) return o;
        return (permitidas || []).some(function (p) { return p && p === o; }) ? o : null;
    }
    function origemDe(url) { try { return new URL(url).origin; } catch (e) { return null; } }

    // Mensagens para o painel (curtas, sem detalhe interno).
    var MENSAGENS = {
        acao_invalida: 'Ação inválida.', id_invalido: 'Usuário inválido.', email_invalido: 'E-mail inválido.',
        nome_invalido: 'Nome: 1 a 60 caracteres, sem < >.', tipo_invalido: 'Escolha o tipo de acesso.',
        veiculo_invalido: 'Veículo inválido.', veiculo_obrigatorio: 'Motorista precisa de um veículo.', veiculo_inativo: 'Escolha um veículo ativo da frota.',
        marca_rota_invalida: 'Valor inválido para "pode marcar rota".', usuario_nao_encontrado: 'Usuário não encontrado.',
        si_mesmo: 'Você não pode desativar nem tirar o seu próprio acesso de administrador.', ultimo_admin: 'Precisa ficar pelo menos um administrador ativo.',
        desativado: 'Usuário desativado: reative antes.', ja_ativo: 'Usuário já está ativo.', sem_login: 'Este e-mail não tem login: use "Novo usuário" com o mesmo e-mail.',
        email_existe: 'Já existe um login com esse e-mail.', tipo_desconhecido: 'Informe o tipo de acesso para reativar.',
        nao_autorizado: 'Faça login de novo.', somente_admin: 'Só o administrador gerencia usuários.', muitas_tentativas: 'Muitas ações seguidas: espere um minuto.',
        origem: 'Origem não permitida.', falha: 'Não foi possível concluir. Tente de novo; se continuar, confira o Supabase.',
        parcial: 'O acesso aos dados foi retirado, mas o login não foi bloqueado. Tente Desativar de novo.',
        parcial_criar: 'O login foi criado SEM acesso e não deu para apagá-lo. Use "Dar acesso" nele ou tente de novo.',
        parcial_reativar: 'O login foi liberado, mas SEM acesso. Use "Dar acesso" para escolher o tipo.',
        variante_email: 'Há uma linha em admins com este e-mail em maiúsculas/minúsculas diferentes. Corrija no banco antes.',
        em_andamento: 'Outra mudança neste usuário está em andamento. Espere um pouco e atualize.',
        operacao_expirada: 'A operação demorou demais e foi cancelada. Atualize e tente de novo.',
        aviso_nome: 'O acesso mudou, mas o nome exibido não atualizou. Tente Alterar de novo depois.'
    };
    function mensagem(codigo) { return MENSAGENS[codigo] || MENSAGENS.falha; }

    var Core = { TIPOS: TIPOS, ACOES: ACOES, ACOES_LOG: ACOES_LOG, BAN_LONGO: BAN_LONGO, ALFABETO: ALFABETO,
        normalizarEmail: normalizarEmail, nomeLimpo: nomeLimpo, validar: validar, gerarSenha: gerarSenha, banido: banido,
        papelDe: papelDe, montarLista: montarLista, adminsAtivos: adminsAtivos, trava: trava, detalheLog: detalheLog,
        limitador: limitador, origemPermitida: origemPermitida, origemDe: origemDe, mensagem: mensagem, MENSAGENS: MENSAGENS };
    raiz.TempRioUsuariosCore = Core;
    if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
