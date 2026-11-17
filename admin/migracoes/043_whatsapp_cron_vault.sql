-- 043: a Edge Function whatsapp-rotinas valida o header x-cron-token contra o segredo do VAULT, sem copia em secret.
-- APLICADA em 2026-11-17 (via MCP; conferida: token errado = false; EXECUTE so service_role). Idempotente.
-- Requer 042 (agendamento), Vault (vault.decrypted_secrets com 'whatsapp_cron_token') e pgcrypto em extensions
-- (extensions.digest). O token foi gerado DENTRO do banco e ninguem o copia: o cron le do Vault e manda no header; a
-- funcao pergunta ao banco "este token confere?" e recebe so true/false.
-- whatsapp_043_cron_ok(p_token): compara o SHA-256 do token recebido com o SHA-256 do segredo (hashes de tamanho fixo:
-- nao vaza o segredo nem o tamanho dele por tempo de comparacao). false se token nulo/curto (< 32) ou longo (> 512),
-- ou se o segredo nao existir/for curto. SECURITY DEFINER (precisa ler o Vault); EXECUTE SO service_role.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.whatsapp_envios') is null
     or to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception '043 requer 042, Vault (vault.decrypted_secrets) e pgcrypto em extensions (extensions.digest). Nada foi aplicado.';
  end if;
end;
$$;

select pg_catalog.pg_advisory_xact_lock(5100, 43);

create or replace function public.whatsapp_043_cron_ok(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_segredo text;
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 512 then
    return false;
  end if;
  select s.decrypted_secret into v_segredo
    from vault.decrypted_secrets s
   where s.name = 'whatsapp_cron_token'
   limit 1;
  if v_segredo is null or char_length(v_segredo) < 32 then
    return false;
  end if;
  return extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
       = extensions.digest(convert_to(v_segredo, 'UTF8'), 'sha256');
end;
$$;
revoke all on function public.whatsapp_043_cron_ok(text) from public, anon, authenticated;
grant execute on function public.whatsapp_043_cron_ok(text) to service_role;

commit;
