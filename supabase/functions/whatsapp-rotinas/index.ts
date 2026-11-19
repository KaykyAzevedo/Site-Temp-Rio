// Edge Function whatsapp-rotinas — rotinas de WhatsApp (contas a receber, rota dos entregadores, alertas).
//
// Chamadas aceitas (POST):
//   1) pg_cron a cada 15 min (migração 042): header x-cron-token = segredo 'whatsapp_cron_token' do Vault; body {"acao":"agendado"}.
//      Validação (cronAutorizado): pelo banco, rpc whatsapp_043_cron_ok (043) — o token fica SÓ no Vault, ninguém copia.
//      Compatibilidade: se o secret CRON_TOKEN existir, vale a comparação local (como antes).
//      Decide o que está no horário (São Paulo), reserva (rotina, dia) no banco (nunca 2x no mesmo dia), monta e
//      envia (modo 'real') ou só registra (modo 'simulacao'). Tudo vai para whatsapp_envios.
//   2) Painel, admin logado (Authorization: Bearer <JWT do usuário>): {"acao":"previa","rotina":"receber_diario"}.
//      Monta com os dados reais e devolve o texto; registra como 'previa'/'simulado'; NUNCA envia.
//
// Deploy SEM verificação de JWT do gateway (o cron não manda JWT; a função autentica sozinha):
//   supabase functions deploy whatsapp-rotinas --no-verify-jwt
// Secrets (Dashboard > Edge Functions > Secrets, nunca no repositório):
//   CRON_TOKEN (DESCONTINUADO/opcional: sem ele a validação é pelo Vault via 043; se existir, ≥ 32 e igual ao do Vault),
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID (só para o modo real), opcionais WHATSAPP_GRAPH_VERSION, PAINEL_URL.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY já existem no ambiente das Edge Functions.

import '../_shared/rota-core.js';
import '../_shared/whatsapp-core.js';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { criarProvedorMeta } from './provedor.ts';

// deno-lint-ignore no-explicit-any
const W = (globalThis as any).TempRioWhatsCore;

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('PAINEL_URL') || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};
function resp(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function iguais(a: string, b: string) {   // comparação em tempo constante
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
function curto(e: unknown, n = 300) { return String((e as Error)?.message ?? e).replace(/\s+/g, ' ').slice(0, n); }

const URL_SB = Deno.env.get('SUPABASE_URL') ?? '';
const CHAVE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CHAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const PAINEL_URL = Deno.env.get('PAINEL_URL') ?? '';
const sbServico = () => createClient(URL_SB, CHAVE_SERVICO, { auth: { persistSession: false, autoRefreshToken: false } });

// deno-lint-ignore no-explicit-any
type Sb = any;

// Grava 1 ou várias linhas em whatsapp_envios numa chamada. corpo passa por corpoLog (só marca '[histórico resumido]'
// se um dia passar de 6000; uma parte tem no máximo 1024).
async function registrar(sb: Sb, linhas: Record<string, unknown> | Record<string, unknown>[]) {
  const lista = (Array.isArray(linhas) ? linhas : [linhas]).map((l) => ({
    ...l,
    corpo: typeof l.corpo === 'string' ? W.corpoLog(l.corpo) : null,
    erro: typeof l.erro === 'string' ? (l.erro as string).slice(0, 300) : null,
  }));
  if (!lista.length) return;
  const { error } = await sb.from('whatsapp_envios').insert(lista);
  if (error) console.error('[whatsapp] falha ao gravar log:', curto(error.message, 120));
}
// Uma linha por parte da mensagem (parte N de M), com os campos comuns.
// deno-lint-ignore no-explicit-any
function porParte(msg: any, comum: Record<string, unknown>) {
  // deno-lint-ignore no-explicit-any
  return W.linhasDeLog(msg).map((l: any) => ({ ...comum, parte: l.parte, partes: l.partes, corpo: l.corpo }));
}

// deno-lint-ignore no-explicit-any
async function executarRotina(sb: Sb, rotina: any, dia: string, agora: Date, destinatarios: any[]) {
  const provedor = criarProvedorMeta({
    token: Deno.env.get('WHATSAPP_TOKEN'), phoneId: Deno.env.get('WHATSAPP_PHONE_NUMBER_ID'), versao: Deno.env.get('WHATSAPP_GRAPH_VERSION'),
  });
  const cont = { simulado: 0, enviado: 0, erro: 0, pulado: 0 };
  const base = { rotina: rotina.codigo, origem: 'agendado' };
  let msg;
  try {
    msg = await W.gerar(sb, rotina.codigo, agora, { painelUrl: PAINEL_URL, template: rotina.template || undefined });
  } catch (e) {
    await registrar(sb, { ...base, status: 'erro', erro: 'falha ao montar: ' + curto(e, 200) });
    cont.erro++; return cont;
  }
  if (msg.vazio) { await registrar(sb, { ...base, status: 'pulado', erro: msg.vazio, corpo: msg.texto }); cont.pulado++; return cont; }
  const f = W.filtrarDestinatarios(rotina.destinatarios, destinatarios, rotina.codigo);   // papel + ativo + consentimento
  for (const p of f.pulados) { await registrar(sb, { ...base, destinatario_id: p.dest.id, status: 'pulado', erro: p.motivo }); cont.pulado++; }
  if (!f.ok.length && !f.pulados.length) { await registrar(sb, porParte(msg, { ...base, status: 'pulado', erro: 'rotina sem destinatários' })); cont.pulado++; }
  for (const d of f.ok) {
    const comum = { ...base, destinatario_id: d.id };
    if (rotina.modo !== 'real') { await registrar(sb, porParte(msg, { ...comum, status: 'simulado' })); cont.simulado++; continue; }
    if (!provedor.pronto) { await registrar(sb, porParte(msg, { ...comum, status: 'erro', erro: provedor.motivo })); cont.erro++; continue; }
    // Envio parte a parte; cada parte vira uma linha (enviado + meta_id, ou erro). Se uma parte falhar, as seguintes
    // NÃO são enviadas e ficam registradas como erro, com o texto (o histórico mostra exatamente o que faltou).
    const linhas = porParte(msg, comum);
    let falhou = 0;
    for (let i = 0; i < msg.partes.length; i++) {
      const parte = msg.partes[i];
      if (falhou) { Object.assign(linhas[i], { status: 'erro', erro: `não enviada: a parte ${falhou} de ${msg.partes.length} falhou` }); continue; }
      try {
        const r = await provedor.enviar(d.telefone, parte.template, parte.params, rotina.idioma || 'pt_BR');
        Object.assign(linhas[i], { status: 'enviado', meta_id: r.id.slice(0, 200) });
      } catch (e) {
        falhou = i + 1;
        Object.assign(linhas[i], { status: 'erro', erro: curto(e, 280) });
      }
    }
    await registrar(sb, linhas);
    if (falhou) cont.erro++; else cont.enviado++;
  }
  return cont;
}

async function agendado(agora: Date) {
  const sb = sbServico();
  const [rr, rd] = await Promise.all([
    sb.from('whatsapp_rotinas').select('*'),
    sb.from('whatsapp_destinatarios').select('id,telefone,papel,ativo,consentimento_em'),
  ]);
  if (rr.error || rd.error) throw new Error('não foi possível ler rotinas/destinatários: ' + curto((rr.error || rd.error)!.message, 120));
  const devidas = W.rotinasDevidas(rr.data, agora);
  const feitas: Record<string, unknown> = {};
  for (const { rotina, dia } of devidas) {
    const { data: reservou, error } = await sb.rpc('whatsapp_042_reservar', { p_rotina: rotina.codigo, p_dia: dia });
    if (error) { feitas[rotina.codigo] = 'erro na trava'; continue; }
    if (!reservou) { feitas[rotina.codigo] = 'já rodou hoje'; continue; }
    feitas[rotina.codigo] = await executarRotina(sb, rotina, dia, agora, rd.data);
  }
  return { ok: true, devidas: devidas.length, rotinas: feitas };   // só contagens (sem telefone/valor)
}

async function previa(jwt: string, rotina: string, agora: Date) {
  if (!W.rotinaConhecida(rotina)) return resp(400, { erro: 'rotina desconhecida' });   // 047: tambem rota_<id do veiculo>
  // Só admin: confere com o próprio JWT do usuário (eh_admin() lê as claims), antes de usar a chave de serviço.
  const sbUsuario = createClient(URL_SB, CHAVE_ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data: admin, error } = await sbUsuario.rpc('eh_admin');
  if (error || admin !== true) return resp(403, { erro: 'somente admin' });
  const sb = sbServico();
  const { data: r } = await sb.from('whatsapp_rotinas').select('template').eq('codigo', rotina).maybeSingle();
  try {
    const msg = await W.gerar(sb, rotina, agora, { painelUrl: PAINEL_URL, template: r?.template || undefined });
    await registrar(sb, porParte(msg, { rotina, origem: 'previa', status: 'simulado', erro: msg.vazio || null }));
    return resp(200, { texto: msg.texto, partes: msg.partes, vazio: msg.vazio || null });
  } catch (e) {
    return resp(500, { erro: 'falha ao montar: ' + curto(e, 200) });
  }
}

// x-cron-token: com o secret CRON_TOKEN (legado) compara aqui; sem ele pergunta ao banco (043, só true/false).
// Nunca registra o token (nem em erro: a mensagem do PostgREST não ecoa parâmetros, e só logamos ela encurtada).
async function cronAutorizado(token: string): Promise<boolean> {
  const legado = Deno.env.get('CRON_TOKEN');
  if (legado) return legado.length >= 32 && iguais(token, legado);
  if (token.length < 32 || token.length > 512) return false;
  const { data, error } = await sbServico().rpc('whatsapp_043_cron_ok', { p_token: token });
  if (error) { console.error('[whatsapp] validação do cron pelo Vault falhou (043 aplicada?):', curto(error.message, 120)); return false; }
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resp(405, { erro: 'use POST' });
  if (!URL_SB || !CHAVE_SERVICO) return resp(500, { erro: 'ambiente da função incompleto' });
  let corpo: { acao?: string; rotina?: string } = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  const agora = new Date();
  const tokenCron = req.headers.get('x-cron-token');
  if (tokenCron !== null) {
    if (!(await cronAutorizado(tokenCron))) return resp(401, { erro: 'não autorizado' });
    if (corpo.acao !== 'agendado') return resp(400, { erro: 'ação inválida' });
    try { return resp(200, await agendado(agora)); }
    catch (e) { console.error('[whatsapp] agendado:', curto(e, 160)); return resp(500, { erro: 'falha no agendamento' }); }
  }
  const auth = req.headers.get('authorization') || '';
  const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!jwt) return resp(401, { erro: 'não autorizado' });
  if (corpo.acao === 'previa') return await previa(jwt, String(corpo.rotina || ''), agora);
  return resp(400, { erro: 'ação inválida' });
});
