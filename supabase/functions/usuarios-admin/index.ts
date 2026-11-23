// Edge Function usuarios-admin — tela "Usuários" do painel: criar/gerenciar login sem abrir o Supabase.
//
// Chamada (POST JSON, só do painel): Authorization: Bearer <JWT do admin logado>; body {"acao": ..., ...}.
//   listar                       -> { usuarios: [...], veiculos: [...] }   (só id, e-mail, nome, tipo, veículo, marca_rota,
//                                    ativo/banido, criado, último acesso — nada de metadados crus ou tokens)
//   criar {email,nome,tipo,veiculo_id?,marca_rota?} -> { usuario, senha }   (senha gerada AQUI, devolvida uma vez)
//   redefinir_senha {id}         -> { usuario, senha }
//   alterar {id,tipo?,nome?,veiculo_id?,marca_rota?} -> { usuario }
//   desativar {id} / reativar {id,tipo,veiculo_id?,marca_rota?,nome?} -> { usuario }   (reativar: tipo explícito)
// Quem pode: SÓ admin — conferido com o PRÓPRIO JWT do chamador (getUser + rpc eh_admin como ele), nunca pelo corpo,
// e CONFERIDO DE NOVO dentro da RPC usuarios_048_aplicar (048), sob lock, a cada mudança (o papel pode ter caído no meio).
// A chave de serviço (SUPABASE_SERVICE_ROLE_KEY) fica só aqui no servidor.
// Mudança de acesso + auditoria = uma transação na RPC (travas si mesmo / último admin, e-mail EXATO do login como chave).
// Ordem com o Auth = menor privilégio se algo falhar no meio (ver cada ação). Limite de taxa por chamador; CORS só para a
// origem do painel (PAINEL_URL / USUARIOS_ORIGENS) e localhost de teste; erros sem detalhe interno; log SEM senha.
//
// Deploy (o gateway confere o JWT; a função confere de novo e exige admin):
//   supabase functions deploy usuarios-admin
// Secrets opcionais: PAINEL_URL (já usado pela whatsapp-rotinas), USUARIOS_ORIGENS (origens extras separadas por vírgula).

import '../_shared/usuarios-core.js';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

// deno-lint-ignore no-explicit-any
const U = (globalThis as any).TempRioUsuariosCore;
// deno-lint-ignore no-explicit-any
type Sb = any;

const URL_SB = Deno.env.get('SUPABASE_URL') ?? '';
const CHAVE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CHAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const ORIGENS = [U.origemDe(Deno.env.get('PAINEL_URL') ?? '')]
  .concat((Deno.env.get('USUARIOS_ORIGENS') ?? '').split(',').map((s) => U.origemDe(s.trim())))
  .filter(Boolean) as string[];
const sbServico = () => createClient(URL_SB, CHAVE_SERVICO, { auth: { persistSession: false, autoRefreshToken: false } });

const porMinuto = U.limitador(60, 60_000);        // qualquer ação
const sensivelPorMinuto = U.limitador(10, 60_000); // criar / redefinir_senha / desativar / reativar

function cors(origem: string | null) {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin',
  };
  if (origem) h['Access-Control-Allow-Origin'] = origem;
  return h;
}
function resp(origem: string | null, status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...cors(origem), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
function falha(origem: string | null, status: number, codigo: string) { return resp(origem, status, { erro: codigo, mensagem: U.mensagem(codigo) }); }
function curto(e: unknown, n = 160) { return String((e as Error)?.message ?? e).replace(/\s+/g, ' ').slice(0, n); }
function bytes(n: number) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; }

// Estado atual: logins (Auth, paginado), admins, motoristas e veículos.
async function estado(sb: Sb) {
  const users: unknown[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('listUsers: ' + curto(error.message, 80));
    const lote = data?.users ?? [];
    users.push(...lote);
    if (lote.length < 1000) break;
  }
  const [ra, rm, rv] = await Promise.all([
    sb.from('admins').select('email,papel,marca_rota,criado_em'),
    sb.from('rota_motoristas').select('user_id,veiculo_id,nome,ativo'),
    sb.from('rota_veiculos').select('id,nome,ativo,modo').order('ordem', { ascending: true }),
  ]);
  if (ra.error) throw new Error('admins: ' + curto(ra.error.message, 80));
  const motAusente = rm.error && /PGRST205|42P01/.test(String(rm.error.code || ''));
  if (rm.error && !motAusente) throw new Error('rota_motoristas: ' + curto(rm.error.message, 80));
  const lista = U.montarLista(users, ra.data || [], motAusente ? [] : (rm.data || []), Date.now());
  return { users, lista, veiculos: rv.error ? [] : (rv.data || []), motoristas047: !motAusente };
}

// Nota de falha FORA da RPC (best effort; o evento principal já foi gravado na mesma transação da mudança de papel).
async function nota(sb: Sb, ator: { id: string; email: string }, acao: string, alvo: { id?: string | null; email?: string | null }, detalhe: string) {
  try {
    const { error } = await sb.from('usuarios_log').insert({ ator_id: ator.id, ator_email: ator.email, acao, alvo_id: alvo.id ?? null,
      alvo_email: alvo.email ?? null, detalhe: detalhe.replace(/[<>]/g, ' ').slice(0, 200) });
    if (error) console.error('[usuarios] nota não gravada:', curto(error.message, 100));
  } catch (e) { console.error('[usuarios] nota não gravada:', curto(e, 100)); }
}

// A ÚNICA porta de mudança de acesso: RPC usuarios_048_aplicar (048) — numa transação, sob lock, re-confere que o ator
// AINDA é admin, aplica travas, muda admins/rota_motoristas, confere o estado final e grava o log. Erro de rede/SQL = throw.
// deno-lint-ignore no-explicit-any
async function rpc(sb: Sb, ator: { id: string; email: string }, p: Record<string, unknown>): Promise<any> {
  const { data, error } = await sb.rpc('usuarios_048_aplicar', { p: { ...p, ator_id: ator.id, ator_email: ator.email } });
  if (error) throw new Error('rpc: ' + curto(error.message, 100));
  if (!data || typeof data !== 'object') throw new Error('rpc: resposta vazia');
  return data;
}
const STATUS: Record<string, number> = { somente_admin: 403, usuario_nao_encontrado: 404, email_existe: 409, variante_email: 409, si_mesmo: 409,
  ultimo_admin: 409, desativado: 409, ja_ativo: 409, em_andamento: 409, operacao_expirada: 409 };
// deno-lint-ignore no-explicit-any
const recusa = (origem: string | null, r: any) => falha(origem, STATUS[r.erro] || 400, String(r.erro || 'falha'));

// app_metadata atual de um login (só para manter nome/último tipo na exibição).
// deno-lint-ignore no-explicit-any
async function metaAtual(sb: Sb, id: string): Promise<any> {
  try { const { data } = await sb.auth.admin.getUserById(id); return data?.user?.app_metadata || {}; } catch { return {}; }
}

// deno-lint-ignore no-explicit-any
async function executar(origem: string | null, ator: { id: string; email: string }, d: any) {
  const sb = sbServico();
  // Resposta final: relê a lista; se a releitura falhar, a operação JÁ aconteceu — devolve ok (e a senha) sem o usuário.
  const devolver = async (id: string, extra: Record<string, unknown> = {}) => {
    try {
      const e2 = await estado(sb);
      // deno-lint-ignore no-explicit-any
      return resp(origem, 200, { ok: true, usuario: e2.lista.find((x: any) => x.id === id) || null, ...extra });
    } catch (e) { console.error('[usuarios] releitura:', curto(e, 100)); return resp(origem, 200, { ok: true, usuario: null, ...extra }); }
  };
  const meta = (nome: unknown, tipo: unknown, marca: unknown, veiculo: unknown) => ({ tr_nome: nome ?? null, tr_tipo: tipo ?? null, tr_marca_rota: !!marca, tr_veiculo: veiculo ?? null });

  if (d.acao === 'listar') {
    const est = await estado(sb);
    return resp(origem, 200, { ok: true, usuarios: est.lista, veiculos: est.veiculos.filter((v: { modo: string }) => v.modo === 'porta'), motoristas: est.motoristas047 });
  }

  if (d.acao === 'criar') {
    // 1) confere (ator admin agora, e-mail livre, veículo) -> 2) login SEM acesso -> 3) RPC dá o papel + log.
    //    Falhou o 3: apaga o login; se nem isso der, sobra um login SEM acesso (menor privilégio) e fica a nota.
    const c = await rpc(sb, ator, { fase: 'checar', acao: 'criar', email: d.email, tipo: d.tipo, veiculo_id: d.veiculo_id ?? null });
    if (!c.ok) return recusa(origem, c);
    const senha = U.gerarSenha(bytes);
    const { data, error } = await sb.auth.admin.createUser({ email: d.email, password: senha, email_confirm: true,
      app_metadata: meta(d.nome, d.tipo, d.tipo === 'vendedor' && d.marca_rota, d.tipo === 'motorista' ? d.veiculo_id : null) });
    if (error || !data?.user) {
      if (/already|exists|registered/i.test(String(error?.message || ''))) return falha(origem, 409, 'email_existe');
      console.error('[usuarios] createUser:', curto(error?.message, 100)); return falha(origem, 500, 'falha');
    }
    const novo = { id: data.user.id as string, email: String(data.user.email || d.email) };
    // deno-lint-ignore no-explicit-any
    let r: any = null;
    try { r = await rpc(sb, ator, { fase: 'aplicar', acao: 'criar', alvo_id: novo.id, tipo: d.tipo, veiculo_id: d.veiculo_id ?? null, marca_rota: d.marca_rota ?? null, nome: d.nome }); }
    catch (e) { console.error('[usuarios] criar/papel:', curto(e, 100)); }
    if (!r || !r.ok) {
      // deno-lint-ignore no-explicit-any
      const del: any = await sb.auth.admin.deleteUser(novo.id).catch((e: unknown) => ({ error: e }));
      if (del?.error) {
        console.error('[usuarios] login novo não apagado:', curto(del.error?.message ?? del.error, 100));
        await nota(sb, ator, 'criar', novo, 'login criado SEM acesso (papel falhou e o login nao foi apagado)');
        return falha(origem, 500, 'parcial_criar');
      }
      return r ? recusa(origem, r) : falha(origem, 500, 'falha');
    }
    return await devolver(novo.id, { senha });
  }

  if (d.acao === 'redefinir_senha') {
    // RPC confere (ator admin agora, alvo ativo, sem operação em andamento) e grava o pedido; depois o Auth troca a senha.
    const r = await rpc(sb, ator, { fase: 'aplicar', acao: 'redefinir_senha', alvo_id: d.id });
    if (!r.ok) return recusa(origem, r);
    const senha = U.gerarSenha(bytes);
    const { error } = await sb.auth.admin.updateUserById(d.id, { password: senha });
    if (error) {
      console.error('[usuarios] senha:', curto(error.message, 100));
      await nota(sb, ator, 'redefinir_senha', { id: d.id, email: r.email }, 'senha nova FALHOU: a senha antiga continua');
      return falha(origem, 500, 'falha');
    }
    return await devolver(d.id, { senha });
  }

  if (d.acao === 'alterar') {
    // Só banco (RPC). O app_metadata (nome/último tipo) é exibição: se falhar, o acesso já está certo e avisamos.
    const r = await rpc(sb, ator, { fase: 'aplicar', acao: 'alterar', alvo_id: d.id, tipo: d.tipo ?? null, veiculo_id: d.veiculo_id ?? null,
      marca_rota: d.marca_rota ?? null, nome: d.nome ?? null });
    if (!r.ok) return recusa(origem, r);
    const am = await metaAtual(sb, d.id);
    const { error } = await sb.auth.admin.updateUserById(d.id, { app_metadata: meta(d.nome ?? am.tr_nome, r.depois,
      r.depois === 'vendedor' ? (d.marca_rota ?? am.tr_marca_rota) : false, r.depois === 'motorista' ? (d.veiculo_id ?? am.tr_veiculo) : null) });
    if (error) { console.error('[usuarios] metadata:', curto(error.message, 100)); return await devolver(d.id, { aviso: U.mensagem('aviso_nome') }); }
    return await devolver(d.id);
  }

  if (d.acao === 'desativar') {
    // 1) RPC tira o papel (acesso aos dados cai na hora, até para JWT já emitido) + log + reserva
    // 2) Auth bloqueia o login  3) RPC fecha a reserva. Se 2 falhar: fica SEM acesso e não bloqueado (menor privilégio).
    const r = await rpc(sb, ator, { fase: 'reservar', acao: 'desativar', alvo_id: d.id });
    if (!r.ok) return recusa(origem, r);
    const am = await metaAtual(sb, d.id);
    const ultimo = r.antes && r.antes !== 'sem_acesso' ? r.antes : am.tr_tipo;
    // deno-lint-ignore no-explicit-any
    const ban: any = await sb.auth.admin.updateUserById(d.id, { ban_duration: U.BAN_LONGO, app_metadata: meta(am.tr_nome, ultimo, am.tr_marca_rota, am.tr_veiculo) })
      .catch((e: unknown) => ({ error: e }));
    const fim = await rpc(sb, ator, { fase: 'concluir', acao: 'desativar', alvo_id: d.id, token: r.token, falhou: !!ban?.error })
      .catch((e: unknown) => { console.error('[usuarios] concluir:', curto(e, 100)); return null; });
    if (!fim?.ok) console.error('[usuarios] reserva não fechada (expira em 2 min)');
    if (ban?.error) { console.error('[usuarios] ban:', curto(ban.error?.message ?? ban.error, 100)); return falha(origem, 500, 'parcial'); }
    return await devolver(d.id);
  }

  if (d.acao === 'reativar') {
    // 1) RPC confere tipo/veículo e reserva  2) Auth libera o login (ainda SEM papel)  3) RPC devolve o papel + log.
    // Se 2 falhar: nada mudou. Se 3 falhar: login liberado SEM acesso (menor privilégio) — use Alterar/Dar acesso.
    const r = await rpc(sb, ator, { fase: 'reservar', acao: 'reativar', alvo_id: d.id, tipo: d.tipo ?? null, veiculo_id: d.veiculo_id ?? null });
    if (!r.ok) return recusa(origem, r);
    const am = await metaAtual(sb, d.id);
    // deno-lint-ignore no-explicit-any
    const lib: any = await sb.auth.admin.updateUserById(d.id, { ban_duration: 'none',
      app_metadata: meta(d.nome ?? am.tr_nome, d.tipo, d.tipo === 'vendedor' && d.marca_rota, d.tipo === 'motorista' ? d.veiculo_id : null) })
      .catch((e: unknown) => ({ error: e }));
    if (lib?.error) {
      console.error('[usuarios] unban:', curto(lib.error?.message ?? lib.error, 100));
      await rpc(sb, ator, { fase: 'cancelar', acao: 'reativar', alvo_id: d.id, token: r.token }).catch(() => null);
      return falha(origem, 500, 'falha');
    }
    // deno-lint-ignore no-explicit-any
    let r2: any = null;
    try { r2 = await rpc(sb, ator, { fase: 'aplicar', acao: 'reativar', alvo_id: d.id, token: r.token, tipo: d.tipo ?? null,
      veiculo_id: d.veiculo_id ?? null, marca_rota: d.marca_rota ?? null, nome: d.nome ?? null }); }
    catch (e) { console.error('[usuarios] reativar/papel:', curto(e, 100)); }
    if (!r2 || !r2.ok) {
      // a transação do papel voltou inteira; fecha a reserva para o admin poder usar "Dar acesso" já
      await rpc(sb, ator, { fase: 'cancelar', acao: 'reativar', alvo_id: d.id, token: r.token }).catch(() => null);
      return falha(origem, r2 ? (STATUS[r2.erro] || 409) : 500, 'parcial_reativar');
    }
    return await devolver(d.id);
  }
  return falha(origem, 400, 'acao_invalida');
}

Deno.serve(async (req) => {
  const origemReq = req.headers.get('origin');
  const origem = U.origemPermitida(origemReq, ORIGENS);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origem) });
  if (origemReq && !origem) return falha(null, 403, 'origem');
  if (req.method !== 'POST') return resp(origem, 405, { erro: 'use POST' });
  if (!URL_SB || !CHAVE_SERVICO || !CHAVE_ANON) return falha(origem, 500, 'falha');
  const auth = req.headers.get('authorization') || '';
  const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!jwt) return falha(origem, 401, 'nao_autorizado');
  // Quem chama: pelo próprio JWT (nunca pelo corpo). eh_admin() roda COMO ele (RLS/claims).
  const sbUsuario = createClient(URL_SB, CHAVE_ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const [{ data: quem, error: e1 }, { data: admin, error: e2 }] = await Promise.all([sbUsuario.auth.getUser(jwt), sbUsuario.rpc('eh_admin')]);
  if (e1 || !quem?.user) return falha(origem, 401, 'nao_autorizado');
  if (e2 || admin !== true) return falha(origem, 403, 'somente_admin');
  // e-mail EXATO como o JWT traz (é a chave de admins/eh_admin em produção; nada de normalizar aqui)
  const ator = { id: quem.user.id as string, email: String(quem.user.email || '') };
  // deno-lint-ignore no-explicit-any
  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  const v = U.validar(corpo);
  if (v.erro) return resp(origem, 400, { erro: v.erro, campo: v.campo, mensagem: U.mensagem(v.erro) });
  const agora = Date.now();
  if (!porMinuto(ator.id, agora)) return falha(origem, 429, 'muitas_tentativas');
  if (['criar', 'redefinir_senha', 'desativar', 'reativar'].includes(v.dados.acao) && !sensivelPorMinuto(ator.id, agora)) return falha(origem, 429, 'muitas_tentativas');
  try { return await executar(origem, ator, v.dados); }
  catch (e) { console.error('[usuarios]', v.dados.acao, curto(e, 160)); return falha(origem, 500, 'falha'); }
});
