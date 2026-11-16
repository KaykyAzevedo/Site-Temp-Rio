# WhatsApp — relatórios e avisos automáticos

O painel monta e (quando ligado) envia pelo WhatsApp:

| Rotina | O que manda | Padrão |
|---|---|---|
| `receber_diario` | Contas a receber: total vencido (parcelas e clientes), vence hoje, próximos 7 dias, 5 maiores vencidos, link do painel | 06:00, seg–sáb |
| `rota_s10` | Rota do dia da S10: paradas em ordem (nome, bairro, caixas) + links do Google Maps por coordenadas, de 4 em 4 (3 paradas + destino, o limite do app no celular) | 06:00, seg–sáb |
| `rota_caminhao` | Mesma coisa para o caminhão do CEASA | 06:00, seg–sáb |
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
2. Rode a **041** (se ainda não rodou) e depois a **042**.
   - Se aparecer o aviso "pg_cron/pg_net nao instalados", ative as extensões e rode a 042 de novo. Ela pode ser repetida.
3. Crie os 2 segredos do agendamento no Vault, trocando os valores:
   ```sql
   select vault.create_secret('https://SEU-PROJETO.supabase.co', 'project_url');
   select vault.create_secret('COLE-AQUI-UM-TOKEN-ALEATORIO-DE-64-CARACTERES', 'whatsapp_cron_token');
   ```
   - Para gerar o token no PowerShell: `-join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })`
   - Guarde o token: ele vai também no passo 2.3.
4. Confira o agendamento: `select jobname, schedule from cron.job;` deve mostrar `whatsapp-rotinas` (a cada 15 min) e `whatsapp-limpeza` (diário).

### 2. Edge Function (Supabase CLI) — continua em simulação

1. Instale a Supabase CLI e faça login com um **token de acesso com escopo limitado** ao projeto. Evite o login de navegador, que dá acesso à conta inteira.
2. Publique a função **sem** verificação de JWT do gateway. O cron não manda JWT; a função confere o `x-cron-token` ou, na prévia, o login de admin.
   ```
   supabase functions deploy whatsapp-rotinas --no-verify-jwt --project-ref SEU-PROJETO
   ```
3. Secrets da função (Dashboard → Edge Functions → Secrets, ou `supabase secrets set`):
   - `CRON_TOKEN`: o **mesmo** token do Vault, com no mínimo 32 caracteres.
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
   - **`relatorio_diario`**
     ```
     Contas a receber — {{1}}
     Vencido: {{2}}
     Vence hoje: {{3}}
     Próximos 7 dias: {{4}}
     Maiores vencidos: {{5}}
     {{6}}
     Painel: {{7}}
     Mensagem automática do Temp Rio.
     ```
   - **`rota_do_dia`**: usado pela S10 e pelo caminhão. Cada mensagem leva até 4 paradas.
     ```
     Rota {{1}} de {{2}} ({{3}}): {{4}}
     Mapa: {{5}}
     Mensagem automática do Temp Rio.
     ```
   - **`alertas_operacao`**
     ```
     Alertas de {{1}}: {{2}}
     Painel: {{3}}
     Mensagem automática do Temp Rio.
     ```

   A Meta pede exemplos para cada `{{n}}`: use a "Gerar prévia" do painel para copiar exemplos realistas. Se usar outro nome de template, troque no campo "Template na Meta" da rotina, no painel.
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
