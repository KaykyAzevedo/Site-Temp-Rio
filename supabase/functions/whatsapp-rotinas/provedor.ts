// Provedor de envio de WhatsApp — ISOLADO: trocar de provedor = trocar este arquivo (mesma interface enviar()).
// Implementação: WhatsApp Cloud API oficial da Meta (Graph API POST /{phone_number_id}/messages, mensagem de TEMPLATE
// aprovado — a única permitida para mensagem iniciada pela empresa fora da janela de 24 h).
// Segredos SÓ por variável de ambiente (secrets da Edge Function): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID.
// Nunca registra token, telefone ou corpo no console.

export type ResultadoEnvio = { id: string };
export interface Provedor {
  pronto: boolean;
  motivo: string | null;
  enviar(dest: string, template: string, params: string[], idioma: string): Promise<ResultadoEnvio>;
}

type Busca = (url: string, init: RequestInit) => Promise<Response>;

export function criarProvedorMeta(
  env: { token?: string | null; phoneId?: string | null; versao?: string | null },
  busca: Busca = fetch,
): Provedor {
  const token = (env.token || '').trim();
  const phoneId = (env.phoneId || '').trim();
  const versao = /^v\d{1,3}\.\d$/.test(env.versao || '') ? String(env.versao) : 'v23.0';
  const motivo = !token || !phoneId
    ? 'segredos do WhatsApp ausentes (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)'
    : !/^\d{5,20}$/.test(phoneId) ? 'WHATSAPP_PHONE_NUMBER_ID inválido' : null;
  return {
    pronto: motivo === null,
    motivo,
    async enviar(dest, template, params, idioma) {
      if (motivo) throw new Error(motivo);
      const para = String(dest || '').replace(/\D/g, '');            // E.164 sem o "+"
      if (!/^[1-9]\d{7,14}$/.test(para)) throw new Error('telefone inválido');
      if (!/^[a-z0-9_]{1,250}$/.test(template)) throw new Error('nome de template inválido');
      const corpo = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: para,
        type: 'template',
        template: {
          name: template,
          language: { code: idioma || 'pt_BR' },
          components: [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t) })) }],
        },
      };
      const r = await busca(`https://graph.facebook.com/${versao}/${phoneId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(15000),
      });
      let j: any = null;
      try { j = await r.json(); } catch { /* corpo não-JSON */ }
      if (!r.ok || !j?.messages?.[0]?.id) {
        // Só código e mensagem da Meta (sem eco do pedido: não carrega telefone nem parâmetros).
        const e = j?.error;
        const det = e ? `${e.code ?? ''}${e.error_subcode ? '/' + e.error_subcode : ''} ${String(e.message ?? '').slice(0, 160)}` : `HTTP ${r.status}`;
        throw new Error(`Meta recusou: ${det}`.trim());
      }
      return { id: String(j.messages[0].id) };
    },
  };
}
