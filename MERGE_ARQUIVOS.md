# Arquivos do merge Temp Rio

A base é `a69a7fb` de A e `fe5dc00` de B. Os originais foram arquivados
fora do repositório para revisão. A tabela compara os arquivos de origem e
indica a implementação presente no ramo. Consulte `MERGE_DECISOES.md` para as
alternativas e as decisões pendentes.

O teste local usou dados fictícios, Supabase e ViaCEP simulados e bloqueio
de conexões externas do aplicativo. No navegador foram verificados home,
catálogo com pré-registro e consentimento, checkout, privacidade e as 13 abas do admin, com mapa Leaflet e
papel vendedor. O checkout gerou o mesmo payload de B, campo a campo, com
Top 40 e comodato. Foram verificadas a adição direta no destaque e a
atualização do subtotal no seletor, além dos avisos de espelho indisponível
e de 022 pendente. Os testes de sintaxe cobriram os 23 arquivos JavaScript e
o coletor em PowerShell 5.1. O banco de produção não foi acessado.

Arquivos novos de organização: `.gitignore`, `.gitattributes`,
`MERGE_DECISOES.md` e este inventário.

| Arquivo fonte / destino | Diff A × B | Fonte ativa | Efeito funcional |
|---|---|---|---|
| Estado interno | Só A | Fora do repositório | Ignorado pelo Git. |
| `admin.html` | Funcional | Composto | União de navegação, painéis SOLIDCON, Leads e LGPD; CSS/JS Leaflet de B. |
| `admin/ESTRUTURA-BANCO.md` | Funcional | Composto | Estrutura B com seções de A e mapa de aplicação conferido. |
| `admin/LEIAME-PAINEL.md` | Funcional | Composto | Painel B acrescido do espelho, histórico e vendas de A. |
| `admin/LEIAME.md` | Só CRLF/LF | Composto | Aviso de revisão e de migrations já aplicadas. |
| `admin/limpar-dados-ficticios.sql` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `admin/lista-espera.gs` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `admin/migracoes/004_usuarios_clientes.sql` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `admin/migracoes/005_catalogo_produtos.sql` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `admin/migracoes/006_pedido_items.sql` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `admin/migracoes/007_visitas_regiao.sql` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `admin/migracoes/008_crud.sql` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `admin/migracoes/009_opcional_ip_geo.sql` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `admin/migracoes/010_realtime_pedidos.sql` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `admin/migracoes/011_total_servidor_solidcon.sql` → `admin/migracoes/021_total_servidor_solidcon.sql` | Só A | A com novo nome/cabeçalho | Pendente; não aplicada. |
| `admin/migracoes/012_solidcon_espelho.sql` → `admin/migracoes/019_solidcon_espelho.sql` | Só A | A com novo nome/cabeçalho | Já aplicada com número anterior. |
| `admin/migracoes/017_solidcon_historico.sql` → `admin/migracoes/020_solidcon_historico.sql` | Só A | A com novo nome/cabeçalho | Já aplicada com número anterior. |
| `admin/migracoes/018_solidcon_vendas.sql` → `admin/migracoes/022_solidcon_vendas.sql` | Só A | A com novo nome/cabeçalho | Pendente; não aplicada. |
| `admin/migracoes/LEIAME.md` | Funcional | Composto | Ordem histórica B 011–016 e A 019–022, com instruções de reversão. |
| `admin/supabase-regioes.sql` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `admin/supabase-vitrine.sql` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `admin/supabase.sql` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/Display Final.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/display 140 cm.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/display 80cm.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/display personalizado.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/hero-video.mp4` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/logo.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/parceiros/casa-frutas-logo.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/parceiros/logo-emporio.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/parceiros/logo-rio-sul.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/parceiros/logo-super-rede.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/parceiros/logo_super_compras.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/parceiros/morangao-logo.jpg` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/parceiros/rede-varejao-logo.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/parceiros/sabor-da-vila-logo.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/parceiros/super-market-logo.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/parceiros/super-mercados-unidos-logo.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/alho-em-po.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/alho-frito.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/ana-maria.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/baiano.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/bicarbonato-de-sodio.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/cacau-em-po.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/caldo-de-bacon.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/caldo-de-carne.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/caldo-de-galinha.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/caldo-de-legumes.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/camomila.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/canela-em-pau.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/canela-em-po.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/carne-fit.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/chia.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/chimichurri-com-pimenta.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/chimichurri-defumado.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/chimichurri.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/churrasco.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/coentro-em-po.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/coloral-temperado.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/colorau-colorifico.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/cominho-em-po.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/completo-fit.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/conquista-sogra.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/cravo-em-flor.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/curcuma.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/curry.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/do-chefe.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/dry-hub.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/edu.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/ervas-finas.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/familia.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/fazenda.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/frango-fit.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/fumaca-em-po.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/gengibre-em-po.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/gergelim-preto.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/hibisco-em-flor.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/lemon-pepper.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/limao-com-ervas.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/limao-e-oregano.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/linhaca-dourada.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/louro.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/manjericao.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/mineiro.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/mostarda-em-po.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/natural.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/orange-pepper.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/oregano-peruano.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/paprica-defumada-picante.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/paprica-defumada.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/paprica-doce.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/paprica-picante.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/para-feijao.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/pega-esposa.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/pega-marido.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/peixe.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/pimenta-calabresa-em-graos.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/pimenta-em-po.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/pimenta-preta-em-graos.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/pimenta-preta-em-po.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/pimenta-rosa-em-graos.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/psyllium-husk.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/sabor-do-nordeste.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/sal-de-ouro.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/sal-rosa-do-himalaia-fino.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/sal-rosa-do-himalaia-grosso.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/salsa-cebola-e-alho.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/salsa-cebola-e-bacon.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/sirio.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/tartaro.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/tempera-tudo.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/produtos/vinagrete.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `assets/images/temperos-fundo.png` | Igual | A+B | Mesmo conteúdo, sem mudança funcional. |
| `catalogo.html` | Funcional | B | Ranking, pré-registro, consentimento e rodapé de B. |
| `css/admin.css` | Funcional | B | Estilos SOLIDCON de A e RBAC/Leads/LGPD/mapa de B. |
| `css/animations.css` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `css/base.css` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `css/cart.css` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `css/components.css` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `css/glass.css` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `data/depoimentos.js` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `data/faq.js` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `data/parceiros.js` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `data/produtos.js` | Funcional | B | Ranking de B para catálogo e pedido rápido. |
| `data/regioes.js` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `index.html` | Funcional | B + A | Destaque interativo e privacidade de B, com adição direta do lote mínimo. |
| `integracao/solidcon/.gitignore` | Só A | A | Preservado integralmente. |
| `integracao/solidcon/LEIAME.md` | Só A | Composto | Procedimentos de A e referências atualizadas ao número 022. |
| `integracao/solidcon/config.exemplo.json` | Só A | A | Preservado integralmente. |
| `integracao/solidcon/sync-produtos.ps1` | Só A | A | Coletor de estoque e vendas com a correção de -BackfillDias 1, SHA-256 08b7c809… |
| `js/admin.js` | Funcional | Composto | Kanban e SOLIDCON de A, Leads/LGPD/Leaflet/RBAC de B; desenha a aba ativa. |
| `js/cart-ui.js` | Funcional | B + A | Preço por pote e subtotal dinâmico de A no seletor de B. |
| `js/cart.js` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `js/config.js` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `js/content-loader.js` | Funcional | B | Render de ranking e seletores de B; grid da home de A arquivado. |
| `js/counters.js` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `js/db.js` | Funcional | B | Cliente de B com os métodos comuns, leads, consentimentos e RPCs LGPD. |
| `js/entrega.js` | Funcional | B | Frete de B. A decisão sobre o desempate da 021 está em MERGE_DECISOES.md. |
| `js/faq.js` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `js/main.js` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `js/pedido.js` | Funcional | Composto | Payload, fluxos e totais de B; máscaras e checagens delegadas a Validadores. |
| `js/product-modal.js` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `js/sliders.js` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `js/vitrine.js` | Só CRLF/LF | A+B | Mesmo conteúdo, sem mudança funcional. |
| `pedido.html` | Funcional | Composto | Checkout, display, Top 30/40/50 e rodapé de B; carrega Validadores. |
| `admin/migracoes/011_leads_pre_registro.sql` | Só B | B | Migração B aplicada; nome e bytes preservados. |
| `admin/migracoes/012_completar_visita_rpc.sql` | Só B | B | Migração B aplicada; nome e bytes preservados. |
| `admin/migracoes/013_validacao_seguranca.sql` | Só B | B | Migração B aplicada; nome e bytes preservados. |
| `admin/migracoes/014_papel_vendedor.sql` | Só B | B | Migração B aplicada; nome e bytes preservados. |
| `admin/migracoes/015_lgpd.sql` | Só B | B | Migração B aplicada; nome e bytes preservados. |
| `admin/migracoes/016_corrige_validacao_retroativa.sql` | Só B | B | Migração B aplicada; nome e bytes preservados. |
| `assets/images/hero/alho-frito.jpg` | Só B | B | Preservado integralmente. |
| `assets/images/hero/chimichurri.jpg` | Só B | B | Preservado integralmente. |
| `assets/images/hero/curcuma.jpg` | Só B | B | Preservado integralmente. |
| `assets/images/hero/curry.jpg` | Só B | B | Preservado integralmente. |
| `assets/images/hero/edu.jpg` | Só B | B | Preservado integralmente. |
| `assets/images/hero/lemon-pepper.jpg` | Só B | B | Preservado integralmente. |
| `assets/images/hero/paprica-defumada.jpg` | Só B | B | Preservado integralmente. |
| `assets/images/hero/paprica-picante.jpg` | Só B | B | Preservado integralmente. |
| `assets/images/hero/thumbs/alho-frito.jpg` | Só B | B | Preservado integralmente. |
| `assets/images/hero/thumbs/chimichurri.jpg` | Só B | B | Preservado integralmente. |
| `assets/images/hero/thumbs/curcuma.jpg` | Só B | B | Preservado integralmente. |
| `assets/images/hero/thumbs/curry.jpg` | Só B | B | Preservado integralmente. |
| `assets/images/hero/thumbs/edu.jpg` | Só B | B | Preservado integralmente. |
| `assets/images/hero/thumbs/lemon-pepper.jpg` | Só B | B | Preservado integralmente. |
| `assets/images/hero/thumbs/paprica-defumada.jpg` | Só B | B | Preservado integralmente. |
| `assets/images/hero/thumbs/paprica-picante.jpg` | Só B | B | Preservado integralmente. |
| `css/destaques.css` | Só B | B + A | Estilos de B e do botão de adição direta. |
| `js/destaques.js` | Só B | B + A | Destaque de B com a adição direta da menor caixa do sabor exibido. |
| `js/pre-registro.js` | Só B | B | Cadastro de leads e registro de consentimento de B. |
| `js/privacidade.js` | Só B | B | Solicitações LGPD de B. |
| `js/validadores.js` | Só B | B | Máscaras e validação de CPF, CNPJ, telefone e e-mail de B. |
| `privacidade.html` | Só B | B | Política e exercício dos direitos do titular de B. |
