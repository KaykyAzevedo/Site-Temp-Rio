# WhatsApp — relatórios e avisos automáticos

O painel monta e (quando ligado) envia pelo WhatsApp:

| Rotina | O que manda | Padrão |
|---|---|---|
| `receber_diario` | Contas a receber: total vencido (parcelas e clientes), vence hoje, próximos 7 dias, 5 maiores vencidos, link do painel | 06:00, seg–sáb |
| `rota_s10` | Rota do dia da S10: paradas em ordem (nome, bairro, caixas) + links do Google Maps por coordenadas, de 4 em 4 (3 paradas + destino, o limite do app no celular). Pedido "tirado da rota" no painel (045) não vai. A S10 **não sai sábado**: nesse dia não manda nada. | 06:00, seg–sex |
| `rota_caminhao` | Caminhão do CEASA: **uma** mensagem com a única parada, o CD CEASA (quantos clientes e o total de caixas; link da sede até o CD). O caminhão não para em bairros no caminho. | 06:00, seg–sáb |
| `rota_<veículo>` (047) | Qualquer veículo da frota (`rota_veiculos`), ex.: `rota_strada` — mesma mensagem da S10 (porta a porta) ou do caminhão (modo `cd_ceasa`), com o nome do veículo. Veículo desativado/inexistente ou dia em que ele não sai: não manda (histórico com o motivo). Sem a 044: só `rota_s10`/`rota_caminhao`. A 047 cria `rota_strada` desligada (simulação, seg–sex). Papel: entregador ou gestor. **Edge Function ainda não publicada com isso.** | 06:00, seg–sex |
| `alertas_marcio` | Pedidos do ERP parados há mais de 7 dias, pedidos do site aguardando há mais de 24 h, coleta do ERP parada há mais de 30 min, estoque crítico das últimas 24 h. **Se não houver nada, não manda.** | 07:00, seg–sáb |

Tudo nasce **desligado** e em **simulação**. Em simulação a mensagem é montada com os dados reais e guardada no histórico (aba **WhatsApp** do painel, só admin), mas **nada é enviado**. O envio real só acontece depois dos passos abaixo, feitos pelo dono.

O "recebido ontem" não entrou: a base do ERP que temos (`solidcon_receber`) é a foto do que está **em aberto**. Título pago simplesmente some dela, então não há dado confiável de recebimento.

## Como funciona

```
pg_cron (a cada 15 min) ──► Edge Function whatsapp-rotinas ──► lê o banco ──► monta o texto
                                  │                                          │
                                  │  horário (Brasília) + dia marcado?       ├─ simulação: grava em whatsapp_envios
                                  │  já rodou hoje? (trava no banco)         └─ real: Meta (template) + grava o resultado
```

- **Nunca 2 vezes no mesmo dia.** Antes de montar, a função reserva (rotina, dia) no banco. Se o cron chamar de novo, a reserva já existe e nada sai.
  - Se o cron atrasar, a rotina das 06:00 ainda sai até 08:59. Depois disso, só no dia seguinte.
  - Se der erro no meio, fica registrado como **erro** no histórico, e a rotina **não** tenta de novo no mesmo dia. Preferimos isso a mandar em dobro.
- **LGPD:** só recebe quem está **ativo** e tem o **consentimento registrado** no painel. Os outros aparecem como "pulado" no histórico.
- **Quem recebe o quê (papel):** contas a receber e alertas vão **só para gestor**. As rotas vão para **entregador ou gestor**. O banco recusa salvar uma rotina com papel errado, e a função confere de novo na hora do envio.
- **Pessoa física nunca aparece pelo nome:** sai como "cliente pessoa física" (ou "cliente sem documento"). Cliente CNPJ aparece pelo nome do cadastro.
- **Prévia e histórico = exatamente o que a Meta entrega:** o texto do template com os parâmetros, todas as mensagens em ordem. Cada mensagem fica abaixo de 1024 caracteres, e uma parada ou um alerta nunca é cortado no meio.
- **Alerta de coleta parada:** cada coletor do ERP é conferido separado, pela última coleta com sucesso, e a mensagem diz qual parou. Os limites são o intervalo próprio + 30 min: pedidos 30 min, estoque 60 min, contas a receber e margem 90 min.
- **Histórico:** apagado automaticamente depois de 90 dias. Ele guarda valores comerciais e só o admin vê.
- **Segredos:** os segredos e os telefones **não** estão no repositório (que é público). Os telefones ficam numa tabela do banco, cadastrados pelo painel. O token da Meta fica nos *secrets* da Edge Function.

Arquivos:

- `admin/migracoes/042_whatsapp.sql`: tabelas, RLS e agendamento. Requer a 041.
- `supabase/functions/whatsapp-rotinas/index.ts`: Edge Function.
- `supabase/functions/whatsapp-rotinas/provedor.ts`: único arquivo que fala com a Meta. Para trocar de provedor, troque este arquivo e mantenha a função `enviar(dest, template, params)`.
- `supabase/functions/_shared/whatsapp-core.js`: monta as mensagens. É o mesmo código da "Gerar prévia" do painel.
- `supabase/functions/_shared/rota-core.js`: planejador da rota. É o mesmo da aba Rotas.
- `js/admin-whatsapp.js`: aba WhatsApp do painel.

## Passo a passo para ligar (dono)

### 1. Banco (Supabase, SQL Editor) — pode ser feito já, continua tudo em simulação

1. Em **Database → Extensions**, ative **pg_cron** e **pg_net**. O Vault já vem ativo nos projetos atuais.
2. Rode a **041** (se ainda não rodou), depois a **042** e a **043**.
   - Se aparecer o aviso "pg_cron/pg_net nao instalados", ative as extensões e rode a 042 de novo. Ela pode ser repetida.
3. Crie os 2 segredos do agendamento no Vault, trocando os valores:
   ```sql
   select vault.create_secret('https://SEU-PROJETO.supabase.co', 'project_url');
   select vault.create_secret('COLE-AQUI-UM-TOKEN-ALEATORIO-DE-64-CARACTERES', 'whatsapp_cron_token');
   ```
   - Para gerar o token no PowerShell: `-join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })`
   - Melhor ainda: gere o token **dentro do banco**, sem copiar nada: `select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'whatsapp_cron_token');`. Com a 043, ninguém precisa ver o token.
4. Confira o agendamento: `select jobname, schedule from cron.job;` deve mostrar `whatsapp-rotinas` (a cada 15 min) e `whatsapp-limpeza` (diário).

### 2. Edge Function (Supabase CLI) — continua em simulação

1. Instale a Supabase CLI e faça login com um **token de acesso com escopo limitado** ao projeto. Evite o login de navegador, que dá acesso à conta inteira.
2. Publique a função **sem** verificação de JWT do gateway. O cron não manda JWT; a função confere o `x-cron-token` ou, na prévia, o login de admin.
   ```
   supabase functions deploy whatsapp-rotinas --no-verify-jwt --project-ref SEU-PROJETO
   ```
3. Secrets da função (Dashboard → Edge Functions → Secrets, ou `supabase secrets set`):
   - `CRON_TOKEN`: **descontinuado, não crie.** Com a migração **043** aplicada, a função confere o token do cron direto no Vault (`whatsapp_043_cron_ok`, que só responde sim/não). O token fica **só** no banco e ninguém precisa copiá-lo. Se um `CRON_TOKEN` antigo existir, ele ainda vale, mas tem de ser igual ao do Vault; o recomendado é apagá-lo.
   - `PAINEL_URL`: endereço do site, sem barra no fim (ex.: `https://www.seusite.com.br`). Serve para o link do painel nas mensagens e para o CORS.
4. No painel, aba **WhatsApp**:
   - cadastre o Márcio e o chefe, marcando o consentimento só depois de eles concordarem;
   - escolha quem recebe cada rotina;
   - ligue a rotina, ainda em **Simulação**;
   - use **"Prévia pela função"** para testar a função publicada.
   - No dia seguinte, confira em **Últimos envios** que apareceu "Simulado" às 06:00.

### 3. Conta da Meta (WhatsApp Cloud API oficial) — só o dono

1. Crie (ou use) um **Business Portfolio** em business.facebook.com e um **app** do tipo *Business* em developers.facebook.com, com o produto **WhatsApp**.
2. Adicione um **número de telefone** que **não** esteja em uso no WhatsApp comum nem no WhatsApp Business do celular. Pode ser um chip novo.
   - Verifique o número por SMS ou ligação.
   - Anote o **Phone number ID**. Não é o número de telefone: é um código de dígitos que aparece em *WhatsApp → API Setup*.
3. Faça a **verificação da empresa** (Business Verification) se a Meta pedir, para sair dos limites iniciais de envio.
4. Crie os **templates** em *WhatsApp Manager → Message templates*. Use a categoria **Utility**, idioma **Portuguese (BR) / pt_BR** e exatamente estes nomes e textos:
   Regras da Meta para o corpo (sem elas a Meta recusa com o erro 2388293, "muitas variáveis para a extensão"):
   - não começar nem terminar com `{{n}}`;
   - dois `{{n}}` nunca lado a lado, separados só por espaço ou pontuação;
   - pelo menos 3 palavras fixas para cada `{{n}}`;
   - no máximo 1 linha em branco seguida;
   - corpo final (texto fixo + parâmetros) com até 1024 caracteres. O código corta cada `{{n}}` no limite dele para caber no pior caso.

   Os textos abaixo são os mesmos do código (`supabase/functions/_shared/whatsapp-core.js`, MODELOS): a prévia e o histórico mostram exatamente o que a Meta entrega. Os exemplos são fictícios e servem para o campo de exemplo de cada `{{n}}` na Meta.
   - **`relatorio_diario`**
     ```
     Resumo das contas a receber de {{1}}.
     Total vencido em aberto: {{2}}.
     Total que vence hoje: {{3}}.
     Total a vencer nos próximos 7 dias: {{4}}.
     Maiores valores vencidos por cliente: {{5}}.
     Dados do ERP: {{6}}.
     Mais detalhes no painel: {{7}}
     Mensagem automática do Temp Rio.
     ```
     Exemplos:
     - `{{1}}` segunda, 16/11
     - `{{2}}` R$ 5.020,00 (4 parcelas, 2 clientes + 1 parcela de pessoa física/sem documento)
     - `{{3}}` R$ 123,45 (1 parcela)
     - `{{4}}` R$ 100,00 (1 parcela)
     - `{{5}}` 1) Mercado Exemplo Ltda R$ 3.000,00 (1d); 2) Padaria Modelo R$ 2.000,00 (15d); 3) cliente pessoa física R$ 20,00 (46d)
     - `{{6}}` coleta de 16/11 05:50 (com a coleta velha: "ATENÇÃO, coleta antiga de 14/11 05:50")
     - `{{7}}` https://www.exemplo.com.br/admin.html#clientes (contas a receber ficam em Clientes > Financeiro)
   - **`relatorio_diario_v2`**: categoria **Utility**, cadastrado em 23/11/2026 (em análise). Mesmo conteúdo do `relatorio_diario`, em blocos e com 1 cliente por linha. O `relatorio_diario` segue em uso até a aprovação; para trocar, basta gravar `relatorio_diario_v2` em `whatsapp_rotinas.template` da rotina `receber_diario` (painel WhatsApp > rotina > "Template na Meta"). Nenhum parâmetro leva quebra de linha, tab ou 4+ espaços seguidos; zero aparece como frase ("nada vencido"), nunca vazio.
     ```
     📊 *Resumo das contas a receber — {{1}}*
     
     🔴 *Vencido em aberto*
     {{2}}
     
     🟡 *Vence hoje*
     {{3}}
     
     🟢 *A vencer nos próximos 7 dias*
     {{4}}
     
     ━━━━━━━━━━━━
     🏆 *Maiores valores vencidos por cliente*
     1. {{5}}
     2. {{6}}
     3. {{7}}
     4. {{8}}
     5. {{9}}
     ━━━━━━━━━━━━
     
     Dados do ERP: coleta de {{10}}
     👉 Mais detalhes no painel: {{11}}
     
     _Mensagem automática do Temp Rio._
     ```
     Exemplos:
     - `{{1}}` segunda, 23/11
     - `{{2}}` R$ 68.533,31 · 32 parcelas · 28 clientes (sem nada vencido: "nada vencido")
     - `{{3}}` R$ 2.074,94 · 1 parcela (sem nada: "nada vence hoje")
     - `{{4}}` R$ 96.121,43 · 35 parcelas (sem nada: "nada vence nos próximos 7 dias")
     - `{{5}}` PETRO FRUTAS - NOGUEIRA — R$ 8.226,22 (4 dias) (sem nenhum vencido: "nenhum valor vencido")
     - `{{6}}` Mercado Exemplo Ltda — R$ 3.000,00 (1 dia)
     - `{{7}}` cliente pessoa física — R$ 20,00 (46 dias)
     - `{{8}}` — (vaga sem cliente)
     - `{{9}}` —
     - `{{10}}` 23/11 às 08:28 (coleta velha: "14/11 às 05:50 (ATENÇÃO, coleta antiga)")
     - `{{11}}` https://www.exemplo.com.br/admin.html#clientes
   - **`pedidos_do_dia`**: categoria **Utility**, cadastrado em 23/11/2026 (em análise). Rotina `pedidos_dia` (049, 17:00, seg a sáb, desligada). Fonte: `solidcon_pedidos_erp`, as etapas do Kanban "Pedidos". Entrou = `dt_pedido` no dia; Tá pronto = etapa `conferido` agora; Enviou = `saiu` com `dt_saida` no dia ou `atendido` com `dt_atendido` no dia (dia de São Paulo). Só gestor.
     ```
     📦 *Resumo dos pedidos do dia — {{1}}*
     
     📥 *Entrou* (pedidos que chegaram no ERP)
     {{2}}
     Principais clientes: {{3}}
     
     ✅ *Tá pronto* (conferido, aguardando saída)
     {{4}}
     Principais clientes: {{5}}
     
     🚚 *Enviou* (saiu ou foi entregue)
     {{6}}
     Principais clientes: {{7}}
     
     👉 Mais detalhes no painel: {{8}}
     
     _Mensagem automática do Temp Rio._
     ```
     Exemplos:
     - `{{1}}` segunda, 23/11 às 17:00 (coleta do ERP atrasada: "segunda, 23/11 às 17:00 (ATENÇÃO, ERP de 14:10)")
     - `{{2}}` 8 pedidos · R$ 12.340,00 (nenhum: "nenhum pedido")
     - `{{3}}` PETRO FRUTAS · RIO SUL ITAGUAI · MULTIMARKET · +5 (nenhum: "nenhum"; pessoa física aparece como "cliente pessoa física")
     - `{{4}}` 3 pedidos · 42 caixas
     - `{{5}}` MULTIMARKET · Mercado Exemplo
     - `{{6}}` 16 pedidos · R$ 25.870,00
     - `{{7}}` Padaria Modelo · +15
     - `{{8}}` https://www.exemplo.com.br/admin.html#pedidos
   - **`rota_paradas`**: categoria **Utility**, cadastrado em 23/11/2026 (em análise). Rotina `rota_chefe` (049): as entregas do dia, 6 por mensagem, na ordem da rota de cada veículo porta a porta (na ordem da frota) e depois as cargas do CD do CEASA. Mesmo plano da aba Rotas. O nome deste template é fixo no código; `whatsapp_rotinas.template` da `rota_chefe` é o da `rota_sugerida`. Só gestor.
     ```
     📍 *Pedidos para sair — {{1}} (parte {{2}})*
     Cliente, pedidos, caixas, endereço e prioridade de cada entrega:
     
     1. {{3}}
     
     2. {{4}}
     
     3. {{5}}
     
     4. {{6}}
     
     5. {{7}}
     
     6. {{8}}
     
     A rota sugerida chega na última mensagem. Mensagem automática do Temp Rio.
     ```
     Exemplos:
     - `{{1}}` segunda, 23/11
     - `{{2}}` 1 de 3
     - `{{3}}` PETRO FRUTAS - NOGUEIRA · 2 pedidos · 18 cx — Rua Ficticia, 123, Nogueira, Petrópolis · prioridade alta · recebe 07:00–10:00
     - `{{4}}` Mercado Exemplo · 1 pedido · 6 cx + 3 potes — Rua Exemplo, 45, Itaipava, Petrópolis
     - `{{5}}` cliente pessoa física (pedido 48120) · 1 pedido · 2 cx — endereço no painel · sem posição no mapa
     - `{{6}}` MULTIMARKET · 1 pedido · 12 cx — entrega no CEASA (Caminhão)
     - `{{7}}` — (vaga sem entrega)
     - `{{8}}` —
   - **`rota_sugerida`**: categoria **Utility**, cadastrado em 23/11/2026 (em análise). Rotina `rota_chefe` (049, 06:00, seg a sáb, desligada): enviada POR ÚLTIMO, depois das `rota_paradas`. **Atenção:** `{{3}}`, `{{4}}` e `{{5}}` ficam separados só por quebra de linha, o mesmo padrão que a Meta já recusou (erro 2388293) num texto antigo; se a Meta recusar, cadastre um texto com palavras entre eles e troque aqui e no código.
     ```
     🗺️ *Rota sugerida — {{1}}*
     
     📦 Total para sair: {{2}}
     
     🚚 *Por veículo*
     {{3}}
     {{4}}
     {{5}}
     
     Ordem sugerida das entregas porta a porta: {{6}}
     
     ⚠️ Prioridades do dia: {{7}}
     
     👉 Rota completa e mapa no painel: {{8}}
     
     _Mensagem automática do Temp Rio._
     ```
     Exemplos:
     - `{{1}}` segunda, 23/11
     - `{{2}}` 14 pedidos · 11 entregas · 168 cx · 2 pedidos aguardando marcação (corte: começa com "+N entregas só no painel"; sem nada: "nenhum pedido para sair")
     - `{{3}}` Caminhão (CEASA): 4 pedidos · 3 clientes
     - `{{4}}` S10: 10 pedidos · 8 paradas · ~42 km
     - `{{5}}` — (com mais de 3 veículos ativos, os demais juntos aqui, separados por " | "; veículo inativo não aparece)
     - `{{6}}` Nogueira → Itaipava → Corrêas → volta ao depósito (+1 entrega sem posição no mapa)
     - `{{7}}` 2 clientes com prioridade alta · 1 com horário fixo (sem nada: "nenhuma")
     - `{{8}}` https://www.exemplo.com.br/admin.html#rotas
   - **`rota_do_dia`**: usado pela S10 e pelo caminhão. Cada mensagem leva até 4 paradas.
     ```
     Rota do dia do veículo {{1}}, saída de {{2}}.
     Trecho desta mensagem: {{3}}.
     Paradas em ordem de entrega: {{4}}
     Mapa ou painel deste trecho: {{5}}
     Mensagem automática do Temp Rio.
     ```
     Exemplos:
     - `{{1}}` S10 (ou "Caminhão CEASA")
     - `{{2}}` segunda, 16/11
     - `{{3}}` paradas 1–3 de 3 (outros casos: "sem posição no mapa, 5–6 de 6", "parada 7 de 7 (última)", "aviso")
     - `{{4}}` 1) ~07:04 Mercado Exemplo — Barra da Tijuca — 5 cx24; 2) ~07:24 Hortifruti Ficticio — Jacarepaguá — 3 cx24; 3) ~07:57 Padaria Modelo — Recreio dos Bandeiran… — 2 cx24 + 1 cx48 — recebe 08:00–11:00
     - `{{5}}` https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=-23.00300,-43.32640&destination=-22.99900,-43.38640&waypoints=-22.99100%2C-43.33040%7C-22.96300%2C-43.32640 (sem posição: "sem link (cliente sem posição no mapa)"; no aviso de rota longa: o link do painel)
   - **`alertas_operacao_v2`**: categoria **Utility**. O 1º texto (`alertas_operacao`) foi reclassificado pela Meta como Marketing e fica parado lá; por isso o tom é seco, sem emoji e sem palavra de chamada. Rotina ainda gravada com `alertas_operacao` manda `alertas_operacao_v2`.
     ```
     Aviso de operação do Temp Rio em {{1}}.
     Itens para conferir hoje: {{2}}
     Detalhes no painel interno: {{3}}
     Mensagem automática do Temp Rio.
     ```
     Exemplos:
     - `{{1}}` segunda, 16/11 06:10
     - `{{2}}` 1 pedido do ERP parado há mais de 7 dias: #48120 Padaria Modelo (13d) | Coleta do ERP parada: pedidos (há 70 min, última 16/11 05:00)
     - `{{3}}` https://www.exemplo.com.br/admin.html

   Se usar outro nome de template, troque no campo "Template na Meta" da rotina, no painel.
5. Crie um **token permanente**:
   - *Business Settings → Users → System users*: crie um usuário de sistema e atribua o app e a conta do WhatsApp;
   - gere o token com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`, sem expiração.
   - **Não** use o token temporário de 24 h da tela de teste.
6. Coloque nos secrets da Edge Function:
   - `WHATSAPP_TOKEN` = o token permanente;
   - `WHATSAPP_PHONE_NUMBER_ID` = o Phone number ID;
   - opcional: `WHATSAPP_GRAPH_VERSION`, a versão da Graph API (padrão `v23.0`; a documentação da Meta mostra exemplos em versões mais novas, e a Meta descontinua versões antigas, então confira a versão atual).
7. **Só com os templates APROVADOS:** no painel, troque a rotina para **Envio real**. O painel pede confirmação.
   - Comece por uma rotina e um destinatário.
   - Confira em **Últimos envios** se ficou **Enviado**. Se ficou **Erro**, a coluna Detalhe mostra o código da Meta.
   - Se os secrets faltarem, sai **Erro** "segredos do WhatsApp ausentes" e nada é enviado.

## Custos (aproximados — o dono deve conferir)

- Desde **1º/07/2025**, a Meta cobra **por mensagem de template entregue**, conforme a **categoria** (Marketing, Utility, Authentication) e o **país do destinatário** (Brasil, +55). Todas estas rotinas são **Utility**.
- Atualizações publicadas na página oficial:
  - **desde 1º/10/2026**, mensagem Utility enviada dentro da janela de atendimento de 24 h **também é cobrada**;
  - a tabela do Brasil passou a ser publicada **em BRL**.
- A Meta só muda preço no 1º dia de cada trimestre, com 1 mês de aviso.
- **Não coloquei valor em reais aqui de propósito**: a tabela muda e o valor certo está nos arquivos oficiais:
  - Preços: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing (seção *Rate cards and volume tiers*)
  - Tabela por país: https://business.whatsapp.com/products/platform-pricing
- **Como estimar:** (mensagens por dia) × (dias por mês) × (preço Utility do Brasil).
  - Cada destinatário conta separado.
  - `receber_diario` e `alertas_marcio` = 1 mensagem por pessoa por dia; os alertas só saem se houver alerta.
  - As rotas mandam **1 mensagem a cada 4 paradas**, mais 1 se houver cliente sem posição. Uma S10 com 20 paradas = 5 mensagens por entregador por dia.
  - Exemplo de conta (2 gestores no relatório, 1 entregador por veículo, 26 dias): 2 × 26 + (5 + 2) × 26 ≈ 234 mensagens/mês × preço Utility.

## Riscos

- **Template rejeitado ou recategorizado.**
  - A Meta pode recusar o template ou mudá-lo para Marketing, que é mais caro.
  - Evite texto de propaganda e mantenha o "Mensagem automática do Temp Rio".
  - Se for recusado, ajuste o texto e reenvie. A rotina continua em simulação até lá.
- **Número bloqueado ou qualidade baixa.**
  - Se destinatários bloquearem ou denunciarem, a Meta baixa a qualidade do número e pode limitar ou bloquear os envios.
  - Mande só para quem concordou (é a regra do painel) e não use o número para outras coisas.
- **Número no app comum.** O número da API **não pode** estar no WhatsApp do celular ao mesmo tempo.
- **Token vazado.**
  - Quem tem o `WHATSAPP_TOKEN` envia mensagens em nome da empresa.
  - Ele só pode existir nos secrets da função, **nunca** no código, no chat ou em print.
  - Se vazar: gere outro token no usuário de sistema e troque o secret.
- **Parâmetros:** a Meta não aceita quebra de linha dentro de `{{n}}`. O código já junta as linhas com " · " e corta textos longos.
- **Dados velhos.** O relatório usa a última coleta do ERP. Se ela tiver mais de 26 h, a mensagem avisa "ATENÇÃO" com a hora da coleta.
- **Cron atrasado ou parado.** Se o pg_cron parar, nada sai. O histórico mostra o último envio. O alerta de "coleta parada" vigia o ERP, não o cron.
