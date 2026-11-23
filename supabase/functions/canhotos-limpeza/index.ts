// Deploy: supabase functions deploy canhotos-limpeza --no-verify-jwt
// Autenticacao propria: token do cron no Vault, validado pela 043. Nao aceita chave anon/JWT do painel.
import '../_shared/canhotos-limpeza-core.js';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
// deno-lint-ignore no-explicit-any
const C = (globalThis as any).TempRioCanhotosLimpeza;
Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return new Response('ambiente incompleto', { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return await C.responder(req, sb);
});
