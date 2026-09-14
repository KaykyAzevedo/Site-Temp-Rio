-- 010 — Realtime em pedidos
--
-- Liga a tabela `pedidos` à publicação que o Supabase Realtime escuta. Sem
-- isto, o sino de notificação e a lista "últimos pedidos" do dashboard nunca
-- recebem um evento — ficam mudos até alguém apertar Atualizar.
--
-- O RLS continua valendo em cima do Realtime: o evento de INSERT só chega a
-- quem, pela política "admin le pedidos" (migração 001), teria permissão de
-- ler aquela linha. Um visitante anônimo nunca recebe o evento.
--
-- Idempotente: pg_publication_tables é consultado antes de tentar adicionar,
-- porque `alter publication ... add table` dá erro se a tabela já está lá.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pedidos'
  ) then
    alter publication supabase_realtime add table public.pedidos;
  end if;
end $$;
