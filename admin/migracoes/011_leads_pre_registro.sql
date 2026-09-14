-- 011 — Leads do pop-up de pré-registro
--
-- ============================================================================
-- O QUE ESTE POP-UP FAZ, E O LIMITE DELE
-- ============================================================================
--
-- Ao entrar no catálogo, o visitante vê um convite pedindo nome, telefone e
-- CPF ou CNPJ, com um botão "Continuar navegando". Diferente da Vitrine (que
-- só aparece DEPOIS de um pedido, como cortesia), este aparece ANTES de
-- qualquer compra — é captação de contato (lead), não recibo de cliente.
--
-- Por ser dado pessoal pedido de quem ainda não comprou nada, a política de
-- INSERT abaixo funciona de propósito diferente da de `pedidos`: aqui a
-- pessoa está literalmente digitando os próprios dados num formulário que diz
-- para que servem (ver o texto de consentimento em js/pre-registro.js) — não
-- é um dado coletado nas costas dela, como IP ou geolocalização teriam sido
-- (ver o porquê dessas duas ficarem de fora, na migração 007).
--
-- ============================================================================
-- 1. Leads
-- ============================================================================
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),

  nome text not null,
  telefone text not null,

  -- Documento em dígitos puros, como em toda outra tabela do sistema.
  documento text not null,
  tipo_documento text not null check (tipo_documento in ('cpf', 'cnpj')),

  -- DDD 21 ou 24: reconhece que o contato provavelmente já está na área de
  -- entrega. Não bloqueia os outros — é informação para o vendedor, não regra
  -- de negócio; a área de entrega de verdade é decidida pelo CEP no pedido.
  ddd_rio boolean not null default false,

  pagina_origem text,
  sessao text,                 -- liga com visitas.sessao, quando existir

  sms_enviado boolean not null default false,
  sms_enviado_em timestamptz,

  observacoes text
);

create index if not exists leads_criado_em_idx on public.leads (criado_em desc);
create index if not exists leads_documento_idx on public.leads (documento);
create index if not exists leads_sessao_idx on public.leads (sessao);

alter table public.leads enable row level security;

-- O site grava. Só isso — mesmo padrão de pedidos e lista_espera.
drop policy if exists "site registra lead" on public.leads;
create policy "site registra lead"
  on public.leads for insert
  to anon, authenticated
  with check (true);

drop policy if exists "admin le leads" on public.leads;
create policy "admin le leads"
  on public.leads for select
  to authenticated
  using (public.eh_admin());

-- Só para marcar sms_enviado ou anotar observação — nunca para reescrever
-- nome/telefone/documento, que são o que a pessoa efetivamente digitou.
drop policy if exists "admin atualiza leads" on public.leads;
create policy "admin atualiza leads"
  on public.leads for update
  to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

-- ============================================================================
-- 2. `visitas_site.pre_registro` — pedido explicitamente, como coluna jsonb
-- ============================================================================
-- A tabela já existente se chama `visitas` (ver migração 001); é a
-- `visitas_site` que a especificação nomeia. Guarda um retrato compacto do
-- pop-up (nome, telefone, tipo de documento) na MESMA linha da visita que o
-- gerou — não os dados completos, que já estão em `leads` com política
-- própria. O site preenche isto com um PATCH filtrando por `sessao`, do
-- mesmo jeito que já faz para `segundos` (migração 007) — ver
-- js/db.js:atualizarVisita().
alter table public.visitas add column if not exists pre_registro jsonb;

-- ============================================================================
-- 3. Envio de SMS — NÃO implementado aqui, de propósito
-- ============================================================================
-- A especificação pede, como opção, mandar um SMS de boas-vindas (Twilio ou
-- similar). A coluna `sms_enviado` acima existe para isso, mas o envio em si
-- não está implementado, por dois motivos que não têm solução dentro deste
-- arquivo:
--
-- 1. Precisa de credencial de verdade (Twilio Account SID, Auth Token, um
--    número de origem comprado) que eu não tenho e não posso inventar — é a
--    mesma razão pela qual a chave do Supabase teve que ser colada por você.
-- 2. Enviar SMS a partir do navegador do visitante expõe essa credencial a
--    qualquer pessoa que abrir o DevTools. Precisa rodar num lugar que
--    guarda segredo — uma Supabase Edge Function, que HOJE não existe neste
--    projeto (o site inteiro é estático).
--
-- Quando/se decidir ligar isso: crie uma Edge Function que roda depois do
-- INSERT em `leads` (trigger de banco chamando a função via `pg_net`, ou um
-- Database Webhook nativo do Supabase), guarda SID/token como *secret* da
-- função, e marca `sms_enviado = true` só depois da Twilio confirmar o envio.
