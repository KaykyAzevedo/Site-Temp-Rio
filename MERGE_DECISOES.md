# Decisões do merge Temp Rio

A junção parte de A `a69a7fb` e B `fe5dc00`. As alternativas originais
estão no arquivo local de revisão, fora do repositório. O estado interno
do projeto fica ignorado pelo Git.

| Área | A | B | Versão ativa e opção de troca |
|---|---|---|---|
| Home e destaques | Cards estáticos e adição direta da menor caixa. | Destaque interativo com miniaturas e links para pedido e catálogo. | Destaque de B com ação adicional para adicionar a menor caixa do sabor exibido. A escolha do layout completo continua aberta. Para recuperar os cards de A, integrar sua seção e `loadDestaques` a partir da cópia local, preservando o rodapé de privacidade. |
| Seletor de quantidade | Mostra preço por pote e subtotal atualizado no botão. | Mostra o botão com texto fixo. | Preço por pote e subtotal de A no seletor de B. O comportamento do carrinho é o mesmo. A versão com texto fixo está em `fe5dc00:js/cart-ui.js`. |
| Catálogo e pré-registro | Catálogo sem ranking e sem captura de leads. | Ranking, pré-registro e consentimento. | B. Para trocar a apresentação, aproveitar a ordem ou o markup de A em `data/produtos.js` e `js/content-loader.js` da cópia local. Preservar dados de ranking, captura e consentimento. |
| Checkout | Resumo simples, sem sugestão de display ou pedido rápido. | Comodato no RJ e atalhos Top 30/40/50. | Fluxo e payload de B. O checkout chama os validadores compartilhados de B. Uma troca de apresentação pode aproveitar o markup de A mantendo envio, comodato e atalhos. |
| Frete | Em empate final, compara IDs crescentes, como a 021. | Prioridade decrescente e região ativa primeiro. Em empate final, conserva a ordem recebida. | B. As faixas carregadas em produção vêm do banco e são editáveis. Os exemplos do repositório não comprovam equivalência com os dados vigentes. Antes da 021, conferir faixas sobrepostas com mesma prioridade e estado, incluindo efeito no frete e no prazo. Se aprovado, usar ID crescente com a mesma ordem binária de `COLLATE "C"`. |
| Serviços públicos e LGPD | Pedidos, espera e visitas. | Mantém esses serviços e acrescenta leads, consentimentos, política e direitos do titular. | B em `js/db.js` e nos fluxos LGPD. Alterações pontuais devem preservar esses serviços e os links de privacidade. |
| Admin | Kanban, clientes, espelho, histórico, lançamento manual e vendas SOLIDCON. | Núcleo comum, Leads, LGPD, papéis, Leaflet e renderização da aba ativa. | União de 13 abas. Alterar uma aba no seu HTML, JS e CSS, mantendo registro, callback e regras de papel. |
| Total no servidor | A 021 recalcula e guarda auditoria e lançamento manual. | Checkout envia o contrato vigente e o banco tem as validações 013/016. | Contrato B. O painel mantém o bloco de A e avisa que os campos dependem da 021. Validar a convivência com os gatilhos existentes e com o frete antes da implantação. |

## Decisões de papel para o dono

- **Vendedor pode marcar ou desfazer o lançamento no ERP?** Com a 021
  instalada, `marcar_lancado_solidcon` executaria com as permissões de quem
  chama. A política de UPDATE de pedidos de B 014 permite a equipe. Se o
  dono reservar a ação a admin, proteger a RPC e as colunas no banco além de
  ajustar a interface. A 021 segue pendente.
- **Vendedor pode ver a receita do ERP?** A aba Vendas SOLIDCON está disponível
  à equipe e a 022 usa `eh_equipe()` nas tabelas, com views que respeitam RLS.
  Se o dono reservar a receita a admin, ajustar interface e RLS antes da 022.
  A 022 foi aplicada em 2026-11-11; o dono aceitou a receita visível à equipe (hoje 1 pessoa).

## Migrações

B 011–016 mantêm nomes e conteúdo. A 019 e a 020 já foram aplicadas como
012 e 017 de A. Reaplicar a 019 substitui a RPC de recebimento pela versão
anterior à 020 e interrompe histórico e eventos. A 021 (antes 011 de A) e a
022 (antes 018 de A) ainda não foram aplicadas. O coletor atualizado de A
acompanha a 022. Consulte `admin/migracoes/LEIAME.md` para o mapa e a ordem
de implantação.
