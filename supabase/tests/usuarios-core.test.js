// Testes da lógica pura da Edge Function usuarios-admin (usuarios-core.js). Dados FICTÍCIOS.
// Rodar (da raiz do repo): node --test supabase/tests/usuarios-core.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const U = require('../functions/_shared/usuarios-core.js');

const ID = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const AGORA = Date.parse('2026-11-19T12:00:00Z');
const bytes = (n) => new Uint8Array(crypto.randomBytes(n));

test('validar: ações, e-mail normalizado, nome (texto_seguro), tipo, veículo e marca_rota', () => {
    assert.equal(U.validar({ acao: 'apagar_tudo' }).erro, 'acao_invalida');
    assert.equal(U.validar(null).erro, 'acao_invalida');
    assert.deepEqual(U.validar({ acao: 'listar' }), { ok: true, dados: { acao: 'listar' } });
    const c = U.validar({ acao: 'criar', email: '  Joao.Silva@Ficticio.COM ', nome: '  João   da  Silva ', tipo: 'vendedor', marca_rota: true });
    assert.equal(c.ok, true); assert.equal(c.dados.email, 'joao.silva@ficticio.com'); assert.equal(c.dados.nome, 'João da Silva'); assert.equal(c.dados.marca_rota, true);
    for (const e of ['sem-arroba', 'a@b', 'a b@c.com', '<x>@c.com', 'a@@c.com', 'a..b@c.com', 'x'.repeat(250) + '@c.com']) assert.equal(U.validar({ acao: 'criar', email: e, nome: 'X', tipo: 'admin' }).erro, 'email_invalido', e);
    assert.equal(U.validar({ acao: 'criar', email: 'a@c.com', nome: '<b>X</b>', tipo: 'admin' }).erro, 'nome_invalido');
    assert.equal(U.validar({ acao: 'criar', email: 'a@c.com', nome: '   ', tipo: 'admin' }).erro, 'nome_invalido');
    assert.equal(U.validar({ acao: 'criar', email: 'a@c.com', nome: 'x'.repeat(61), tipo: 'admin' }).erro, 'nome_invalido');
    assert.equal(U.validar({ acao: 'criar', email: 'a@c.com', nome: 'X', tipo: 'root' }).erro, 'tipo_invalido');
    assert.equal(U.validar({ acao: 'criar', email: 'a@c.com', nome: 'X' }).erro, 'tipo_invalido');
    assert.equal(U.validar({ acao: 'criar', email: 'a@c.com', nome: 'X', tipo: 'motorista' }).erro, 'veiculo_obrigatorio');
    assert.equal(U.validar({ acao: 'criar', email: 'a@c.com', nome: 'X', tipo: 'motorista', veiculo_id: 'Strada!' }).erro, 'veiculo_invalido');
    assert.equal(U.validar({ acao: 'criar', email: 'a@c.com', nome: 'X', tipo: 'vendedor', marca_rota: 'sim' }).erro, 'marca_rota_invalida');
    for (const a of ['redefinir_senha', 'alterar', 'desativar', 'reativar']) {
        assert.equal(U.validar({ acao: a, id: 'abc' }).erro, 'id_invalido', a);
        assert.equal(U.validar({ acao: a, id: ID(1).toUpperCase(), tipo: 'vendedor' }).ok, true, a);
    }
    // reativar: o tipo vem SEMPRE explícito do formulário; motorista exige veículo (U5)
    assert.equal(U.validar({ acao: 'reativar', id: ID(1) }).erro, 'tipo_desconhecido');
    assert.equal(U.validar({ acao: 'reativar', id: ID(1), tipo: 'motorista' }).erro, 'veiculo_obrigatorio');
    assert.equal(U.validar({ acao: 'reativar', id: ID(1), tipo: 'motorista', veiculo_id: 'strada', nome: 'Ze' }).dados.veiculo_id, 'strada');
    assert.equal(U.validar({ acao: 'alterar', id: ID(1), nome: '<i>' }).erro, 'nome_invalido');
    // campos extras no corpo são ignorados (não viajam para o Auth)
    assert.deepEqual(Object.keys(U.validar({ acao: 'redefinir_senha', id: ID(1), senha: 'x', app_metadata: {} }).dados).sort(), ['acao', 'id']);
});

test('gerarSenha: 16 símbolos legíveis em 4 grupos, com minúscula/maiúscula/dígito, sem 0 O 1 l I, sempre diferente', () => {
    const vistas = new Set();
    for (let i = 0; i < 400; i++) {
        const s = U.gerarSenha(bytes);
        assert.match(s, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
        assert.ok(/[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s));
        assert.ok(!/[0O1lIio]/.test(s), s);
        vistas.add(s);
    }
    assert.equal(vistas.size, 400);
    assert.throws(() => U.gerarSenha(() => new Uint8Array(64).fill(255)));   // fonte ruim não gera senha fraca
});

function cenario() {
    const users = [
        { id: ID(1), email: 'dono@ficticio.com', created_at: '2026-01-01T00:00:00Z', last_sign_in_at: '2026-11-19T10:00:00Z', app_metadata: { provider: 'email', tr_nome: 'Dono' }, user_metadata: { segredo: 'x' }, identities: [{}], phone: '+55' },
        { id: ID(2), email: 'marcio@ficticio.com', created_at: '2026-02-01T00:00:00Z', app_metadata: { tr_nome: 'Márcio', tr_tipo: 'vendedor' } },
        { id: ID(3), email: 'moto@ficticio.com', created_at: '2026-03-01T00:00:00Z', app_metadata: {} },
        { id: ID(4), email: 'saiu@ficticio.com', banned_until: '2126-01-01T00:00:00Z', app_metadata: { tr_tipo: 'motorista', tr_nome: 'Ex Motorista', tr_veiculo: 'strada' } },
        { id: ID(5), email: 'solto@ficticio.com', app_metadata: {} },
        { id: ID(6), email: 'admin2@ficticio.com', app_metadata: {} },
        { id: ID(7), email: 'mix@ficticio.com', app_metadata: {} },
    ];
    const admins = [{ email: 'dono@ficticio.com', papel: 'admin', marca_rota: false }, { email: 'marcio@ficticio.com', papel: 'vendedor', marca_rota: true },
                    { email: 'admin2@ficticio.com', papel: 'admin', marca_rota: false }, { email: 'semlogin@ficticio.com', papel: 'vendedor', marca_rota: false, criado_em: '2026-01-02T00:00:00Z' },
                    { email: 'Mix@Ficticio.com', papel: 'admin', marca_rota: false }];
    const motoristas = [{ user_id: ID(3), veiculo_id: 'strada', nome: 'Moto <b>', ativo: true }, { user_id: ID(4), veiculo_id: 'strada', nome: 'Ex', ativo: false }];
    return { users, admins, motoristas };
}

test('montarLista: tipo/ativo/banido corretos, só os campos permitidos, linha de admins sem login', () => {
    const c = cenario();
    const l = U.montarLista(c.users, c.admins, c.motoristas, AGORA);
    const por = Object.fromEntries(l.map((x) => [x.email, x]));
    assert.equal(por['dono@ficticio.com'].tipo, 'admin'); assert.equal(por['dono@ficticio.com'].ativo, true); assert.equal(por['dono@ficticio.com'].marca_rota, true);
    assert.equal(por['marcio@ficticio.com'].tipo, 'vendedor'); assert.equal(por['marcio@ficticio.com'].marca_rota, true); assert.equal(por['marcio@ficticio.com'].nome, 'Márcio');
    assert.equal(por['moto@ficticio.com'].tipo, 'motorista'); assert.equal(por['moto@ficticio.com'].veiculo_id, 'strada');
    assert.equal(por['moto@ficticio.com'].nome, null, 'nome inseguro do banco não volta');
    assert.equal(por['saiu@ficticio.com'].banido, true); assert.equal(por['saiu@ficticio.com'].ativo, false); assert.equal(por['saiu@ficticio.com'].ultimo_tipo, 'motorista');
    assert.equal(por['solto@ficticio.com'].tipo, 'sem_acesso'); assert.equal(por['solto@ficticio.com'].ativo, false);
    assert.equal(por['semlogin@ficticio.com'].sem_login, true); assert.equal(por['semlogin@ficticio.com'].id, null); assert.equal(por['semlogin@ficticio.com'].variante, false);
    // U3: chave EXATA como no eh_admin de produção — 'Mix@...' em admins NÃO dá admin ao login 'mix@...'
    assert.equal(por['mix@ficticio.com'].tipo, 'sem_acesso');
    assert.equal(por['Mix@Ficticio.com'].sem_login, true); assert.equal(por['Mix@Ficticio.com'].variante, true); assert.equal(por['Mix@Ficticio.com'].email, 'Mix@Ficticio.com', 'chave real preservada');
    const CAMPOS = ['ativo', 'banido', 'criado', 'email', 'id', 'marca_rota', 'nome', 'sem_login', 'tipo', 'ultimo_acesso', 'ultimo_tipo', 'variante', 'veiculo_id'];
    l.forEach((x) => assert.deepEqual(Object.keys(x).sort(), CAMPOS));
    assert.ok(!JSON.stringify(l).includes('segredo') && !JSON.stringify(l).includes('identities') && !JSON.stringify(l).includes('+55'));
    assert.deepEqual(l.filter((x) => x.ativo).map((x) => x.tipo), ['admin', 'admin', 'vendedor', 'motorista'], 'ativos primeiro, por tipo');
    assert.deepEqual(U.adminsAtivos(l).sort(), [ID(1), ID(6)]);
});

test('travas: não desativa/rebaixa a si mesmo; nunca fica sem admin ativo; desativado/sem login/já ativo', () => {
    const c = cenario();
    const l = U.montarLista(c.users, c.admins, c.motoristas, AGORA), por = Object.fromEntries(l.map((x) => [x.email, x]));
    const ativos = U.adminsAtivos(l);
    assert.equal(U.trava('desativar', ID(1), por['dono@ficticio.com'], null, ativos), 'si_mesmo');
    assert.equal(U.trava('alterar', ID(1), por['dono@ficticio.com'], 'vendedor', ativos), 'si_mesmo');
    assert.equal(U.trava('alterar', ID(1), por['dono@ficticio.com'], 'admin', ativos), null, 'mudar o próprio nome pode');
    assert.equal(U.trava('redefinir_senha', ID(1), por['dono@ficticio.com'], null, ativos), null);
    assert.equal(U.trava('desativar', ID(1), por['admin2@ficticio.com'], null, ativos), null, 'outro admin, sobra 1');
    assert.equal(U.trava('desativar', ID(9), por['admin2@ficticio.com'], null, [ID(6)]), 'ultimo_admin');
    assert.equal(U.trava('alterar', ID(9), por['admin2@ficticio.com'], 'motorista', [ID(6)]), 'ultimo_admin');
    assert.equal(U.trava('alterar', ID(1), por['saiu@ficticio.com'], 'vendedor', ativos), 'desativado');
    assert.equal(U.trava('redefinir_senha', ID(1), por['saiu@ficticio.com'], null, ativos), 'desativado');
    assert.equal(U.trava('reativar', ID(1), por['marcio@ficticio.com'], null, ativos), 'ja_ativo');
    assert.equal(U.trava('reativar', ID(1), por['saiu@ficticio.com'], null, ativos), null);
    assert.equal(U.trava('desativar', ID(1), por['semlogin@ficticio.com'], null, ativos), 'sem_login');
    assert.equal(U.trava('desativar', ID(1), null, null, ativos), 'usuario_nao_encontrado');
    assert.equal(U.trava('desativar', ID(1), por['marcio@ficticio.com'], null, ativos), null);
});

test('detalheLog: nunca leva senha nem texto inseguro', () => {
    assert.equal(U.detalheLog('criar', null, { tipo: 'motorista', veiculo_id: 'strada' }), 'tipo motorista/strada');
    assert.equal(U.detalheLog('alterar', { tipo: 'vendedor', marca_rota: true }, { tipo: 'motorista', veiculo_id: 's10' }), 'vendedor+rota → motorista/s10');
    assert.equal(U.detalheLog('redefinir_senha', {}, {}), 'senha nova gerada');
    const d = U.detalheLog('alterar', { tipo: '<script>' }, { tipo: 'admin', senha: 'Abcd-1234' });
    assert.ok(!/[<>]/.test(d) && !/Abcd/.test(d));
});

test('CORS: só a origem do painel e localhost de teste; limite de taxa por chamador', () => {
    const perm = [U.origemDe('https://temprio.example/admin.html')];
    assert.equal(U.origemPermitida('https://temprio.example', perm), 'https://temprio.example');
    assert.equal(U.origemPermitida('http://localhost:8766', perm), 'http://localhost:8766');
    assert.equal(U.origemPermitida('http://127.0.0.1:5500', perm), 'http://127.0.0.1:5500');
    for (const o of ['https://evil.example', 'https://temprio.example.evil.com', 'http://localhost.evil.com', 'null', '']) assert.equal(U.origemPermitida(o, perm), null, o);
    const lim = U.limitador(3, 60000);
    assert.deepEqual([1, 2, 3, 4].map((i) => lim('a', 1000 + i)), [true, true, true, false]);
    assert.equal(lim('b', 1005), true, 'por chamador');
    assert.equal(lim('a', 62000), true, 'janela anda');
    assert.ok(Object.keys(U.MENSAGENS).every((k) => !/<[a-z/]/i.test(U.mensagem(k))));
    assert.equal(U.mensagem('nao_existe'), U.MENSAGENS.falha);
});
