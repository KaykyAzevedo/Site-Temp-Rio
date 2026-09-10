-- 012 — Corrige o "completar visita" que nunca funcionou
--
-- ============================================================================
-- O QUE ESTAVA QUEBRADO, E COMO FOI DESCOBERTO
-- ============================================================================
--
-- A migração 007 criou a política "site completa a visita" (UPDATE, para
-- anon) com a intenção de deixar o site atualizar a PRÓPRIA linha de visita
-- mais tarde — tempo de sessão, CEP consultado, e agora também o retrato do
-- pop-up de pré-registro (migração 011).
--
-- Essa política NUNCA funcionou. Testado agora, na mão: mesmo com a condição
-- do USING avaliando verdadeiro para a linha certa, e com a permissão de
-- UPDATE concedida à role anon, o PATCH afetava ZERO linhas — sem erro, sem
-- aviso, silenciosamente. `explain` no UPDATE revelou a causa:
-- `One-Time Filter: false`, ou seja, o Postgres decidia em tempo de
-- planejamento que NENHUMA linha poderia satisfazer a operação.
--
-- O motivo: um UPDATE sob Row Level Security precisa, além da política de
-- UPDATE, de uma política de SELECT aplicável à mesma role — é o SELECT que
-- decide quais linhas existem para o UPDATE mirar. A migração 007 só criou a
-- política de UPDATE. Sem SELECT, a combinação equivale a "nenhuma linha é
-- visível", e o UPDATE nunca tinha o que atualizar.
--
-- ============================================================================
-- POR QUE A CORREÇÃO NÃO É "ADICIONAR UMA POLÍTICA DE SELECT"
-- ============================================================================
--
-- Seria o conserto óbvio, mas abre uma porta que hoje não existe: qualquer
-- visitante anônimo passaria a conseguir listar `visitas` inteira dentro da
-- janela de 6 horas (`GET /visitas?select=*`), vendo página, sessão,
-- dispositivo e CEP de TODOS os outros visitantes recentes — não só o
-- próprio. A política de UPDATE já aceitava um risco parecido (quem souber o
-- `sessao` de outra pessoa pode alterar a visita dela — documentado na 007),
-- mas isso exige CONHECER o valor; uma política de SELECT sem filtro por
-- sessao permite ENUMERAR todo mundo, sem conhecer nada. É uma categoria de
-- exposição diferente, e maior.
--
-- ============================================================================
-- A CORREÇÃO: uma função seguindo o mesmo padrão de decidir_vitrine()
-- ============================================================================
--
-- `security definer` roda com os direitos de quem criou a função — passa por
-- cima do RLS por dentro, mas só faz exatamente o que o corpo da função diz,
-- nada mais. O chamador continua precisando saber o `sessao` (mesmo requisito
-- de antes), e não ganha a capacidade de listar visitas de outras pessoas —
-- a função nunca devolve dado nenhum, só confirma que atualizou.
create or replace function public.completar_visita(
  p_sessao text,
  p_segundos integer default null,
  p_cep text default null,
  p_pre_registro jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_sessao is null or length(trim(p_sessao)) = 0 then
    return; -- sem sessão não há o que mirar; não é erro, só nada a fazer
  end if;

  update public.visitas
     set segundos = coalesce(p_segundos, segundos),
         cep = coalesce(p_cep, cep),
         pre_registro = coalesce(p_pre_registro, pre_registro)
   where sessao = p_sessao
     and criado_em > now() - interval '6 hours'; -- mesma janela da política antiga
end;
$$;

grant execute on function public.completar_visita(text, integer, text, jsonb) to anon, authenticated;

-- A política antiga nunca fazia nada (ver acima) — mantê-la só confundiria
-- quem lesse o schema achando que ela é o mecanismo em uso. O mecanismo agora
-- é a função acima, chamada pelo site como RPC (ver js/db.js).
drop policy if exists "site completa a visita" on public.visitas;
