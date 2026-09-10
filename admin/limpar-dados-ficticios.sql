-- Remove os dados fictícios criados para testar o painel.
--
-- Todos foram marcados com a tag '[DADOS FICTÍCIOS - TESTE]' na hora de
-- criar, especificamente para isto: um filtro só que apaga tudo, sem tocar
-- em pedido de verdade nenhum.
--
-- Ordem: pedido_items depende de pedidos (on delete cascade já cuidaria
-- disso sozinho, mas apagar explícito deixa claro o que está acontecendo).
-- Vitrines e usuários/clientes que só existem por causa dos pedidos fake
-- ficam órfãos depois — o segundo bloco limpa isso.

delete from public.vitrines
 where razao_social in (
   select distinct razao_social from public.pedidos
    where observacoes like '%FICT%'
 );

delete from public.pedidos where observacoes like '%FICT%';

delete from public.lista_espera where observacoes like '%FICT%';

delete from public.visitas where sessao like 'fake-sessao-%';

-- Clientes/usuários que ficaram sem nenhum pedido depois da limpeza acima
-- (ou seja, só existiam por causa dos dados fictícios).
delete from public.clientes c
 where not exists (select 1 from public.pedidos p where p.cliente_id = c.id);

delete from public.usuarios u
 where u.tipo = 'cliente'
   and not exists (select 1 from public.clientes c where c.usuario_id = u.id);

-- Conferência: deve voltar tudo zerado.
select 'pedidos restantes com a tag' as verificacao, count(*)::text as n
  from public.pedidos where observacoes like '%FICT%'
union all
select 'visitas fake restantes', count(*)::text
  from public.visitas where sessao like 'fake-sessao-%';
