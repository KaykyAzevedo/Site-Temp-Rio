# Painel de administrador — como ligar

O painel fica em `admin.html`. Ele mostra pedidos, histórico por cliente,
dashboard de vendas mensal, lista de espera, visitas (com monitor geográfico) e
leads captados pelo pop-up de pré-registro do catálogo.

**Leia a primeira seção antes de qualquer coisa.** Ela explica por que o painel
começa vazio, e por que "vendas" não é a mesma coisa que "pedidos".

## O painel começa vazio, e isso é esperado

Até agora o site nunca registrou que um pedido existiu: ele montava um texto e
abria o WhatsApp. O pedido virava uma conversa, e a conversa não voltava para o
site.

A partir desta versão, todo pedido enviado passa a ser gravado. Mas **não há
histórico para importar**: tudo que foi vendido antes está apenas nas suas
conversas. O painel conta do zero, a partir do dia em que entrar no ar.

## "Vendas" só conta o que você confirmar

O site sabe que alguém clicou em enviar. Ele não tem como saber se o cliente
desistiu, sumiu, ou negociou metade na conversa.

Por isso todo pedido nasce como **Aguardando**, e o gráfico de faturamento soma
**apenas** o que você marcou como **Confirmado** ou **Entregue**. É um clique
por pedido, na aba Pedidos, e é o que faz o número do dashboard corresponder ao
seu caixa em vez de a uma intenção de compra.

O dashboard mostra os dois lados de propósito: "Pedidos iniciados por mês" ao
lado do faturamento, e uma **taxa de fechamento**. A diferença entre os dois é
quanto se perde entre o clique e o negócio fechado — costuma ser o número mais
útil da tela.

## Passo a passo

### 1. Criar o projeto

1. Entre em <https://supabase.com> e crie uma conta (o plano gratuito atende de
   sobra o volume de um negócio deste porte).
2. **New project**. Escolha a região **South America (São Paulo)** — o banco
   fica perto dos seus clientes e as consultas respondem mais rápido.
3. Guarde a senha do banco que ele pedir. Você não vai usá-la no site, mas
   perdê-la dá trabalho.

### 2. Criar as tabelas

1. No projeto, abra **SQL Editor**.
2. Cole e rode **na ordem**, um de cada vez, clicando em **Run** e conferindo
   que termina sem erro antes de passar para o próximo:

   | Ordem | Arquivo | O que cria |
   |---|---|---|
   | 1º | `admin/supabase.sql` | `pedidos`, `visitas`, `admins`, `lista_espera`, as políticas de segurança e as funções do dashboard |
   | 2º | `admin/supabase-regioes.sql` | `regioes` e as faixas de CEP que calculam o frete |
   | 3º | `admin/supabase-vitrine.sql` | `vitrines` e a seção "Onde comprar" |
   | 4º a 8º | `admin/migracoes/004` a `008` | cadastro de clientes, catálogo, itens de pedido e relatórios |
   | 10º | `admin/migracoes/010_realtime_pedidos.sql` | sino de notificação e "últimos pedidos" ao vivo no dashboard |
   | 11º | `admin/migracoes/011_leads_pre_registro.sql` | `leads` — contatos do pop-up de pré-registro do catálogo |
   | 12º | `admin/migracoes/012_completar_visita_rpc.sql` | corrige o preenchimento de tempo de sessão, CEP e pré-registro em `visitas` |

   A ordem importa: todos os outros usam a função `eh_admin()`, que nasce no
   primeiro. Rodar fora de ordem dá erro de função inexistente.

   A pasta `admin/migracoes/` tem um LEIAME próprio com o que cada arquivo faz,
   como conferir que deu certo e como desfazer. O nono arquivo é opcional e o
   cabeçalho dele explica por que não deve ser rodado sem pensar.

   O mapa completo do banco, com diagrama, está em `admin/ESTRUTURA-BANCO.md`.

### 3. Pegar as chaves

Em **Project Settings → API**, copie:

- **Project URL** (algo como `https://abcdefgh.supabase.co`)
- **anon public** key (uma chave longa)

Abra `js/config.js` e preencha:

```js
supabase: {
    url: "https://abcdefgh.supabase.co",
    anonKey: "eyJhbGciOi..."
}
```

> **A chave `service_role` NUNCA entra aqui.** Ela ignora todas as políticas de
> segurança. Se ela for para o site, qualquer visitante passa a ter acesso total
> ao banco. Use só a **anon public**.

### 4. Criar o seu usuário

1. **Authentication → Users → Add user**.
2. Informe o e-mail e a senha que você vai usar para entrar no painel.
3. Marque **Auto Confirm User** (senão o Supabase espera a confirmação por
   e-mail).

### 5. Autorizar esse e-mail

Duas coisas, e **as duas importam**:

**a) Cadastre o e-mail como administrador.** No SQL Editor:

```sql
insert into public.admins (email) values ('voce@exemplo.com');
```

Sem isso o login funciona, mas o painel não mostra nada — e a mensagem de erro
na tela vai apontar justamente para este passo.

**b) Desligue o cadastro público.** Em **Authentication → Providers → Email**,
desmarque **Enable Sign Ups**.

Sem isso, qualquer pessoa cria conta no seu projeto. As políticas ainda barram a
leitura (por causa da tabela `admins`), mas cadastro aberto é porta que não
precisa existir.

### 5a. Dar acesso a um vendedor (opcional)

Desde a migração 014, `admins` tem uma coluna `papel`: `admin` (acesso total,
o padrão) ou `vendedor` (só as abas Dashboard, Pedidos, Clientes e Histórico —
o resto do painel some da tela, e o banco recusa a leitura mesmo que alguém
tente pela API direto).

Os passos são os mesmos 4 e 5a acima (criar o usuário no Supabase, confirmar
o e-mail), e no SQL Editor:

```sql
insert into public.admins (email, papel) values ('vendedor@exemplo.com', 'vendedor');
```

Para promover a admin (ou voltar a vendedor) depois:

```sql
update public.admins set papel = 'admin' where email = 'vendedor@exemplo.com';
```

### 6. Conferir

Abra `admin.html`, faça login e o painel deve carregar. Sem pedidos ainda, ele
mostra "Nenhum pedido ainda" — o que é o correto.

Para testar de ponta a ponta: monte um pedido no site, envie, e ele aparece na
aba **Pedidos** como Aguardando.

## Por que a segurança está no banco, e não no site

A chave `anon` é pública: ela vai no código da página e qualquer visitante
consegue lê-la. Isso é o desenho normal do Supabase.

Quem protege os dados são as políticas de **Row Level Security** em
`admin/supabase.sql`:

| Quem | Pode |
|---|---|
| Site (visitante anônimo) | **Só inserir** pedido e visita |
| Site (visitante anônimo) | **Não pode ler nada** |
| Logado, papel `vendedor` | Ler e atualizar pedidos, clientes e usuários — só isso |
| Logado, papel `admin` | Tudo: o de cima, mais região, vitrine, catálogo, visitas, leads |

Três consequências que valem saber:

**Esconder um botão não protege dado nenhum.** Por isso a proteção está no
banco, não na interface — mesmo quem editar o JavaScript da página no próprio
navegador não consegue ler um pedido.

**Qualquer pessoa pode inserir um pedido falso.** É o preço de um site estático
sem servidor: para o site poder gravar, a permissão de gravar tem que ser
pública. É a mesma condição da lista de espera. Na prática o risco é baixo (não
há o que ganhar com isso), e um pedido falso é visível na hora na aba Pedidos —
você cancela. Se algum dia virar problema, o caminho é um servidor próprio
intermediando a gravação, e eu faço essa mudança.

**O login em si não é feito à mão.** Senha, token de sessão e a renovação
automática dele são do Supabase Auth, não deste código — é a mesma
infraestrutura que projetos muito maiores usam, e reescrever isso por conta
própria (senha em bcrypt, token JWT, refresh) seria pior segurança que a de
hoje, não melhor. A única coisa configurável que este projeto não conseguiu
apertar é o *tempo* de expiração da sessão (hoje no padrão do Supabase, cerca
de 1 hora) — **Authentication → Sessions**, no painel do Supabase, tem os
campos certos ("Time-box user sessions", "Inactivity timeout"), mas eles só
funcionam no plano **Pro** ou acima; no plano Free ficam bloqueados,
mostrando "Upgrade to Pro". Se algum dia migrar de plano, vale voltar lá e
apertar esse número.

## Por que CPF/CNPJ, telefone e endereço NÃO são criptografados

Foi cogitado (e descartado) guardar CPF/CNPJ como hash irreversível e
telefone/endereço como texto cifrado (AES). Três motivos pesaram contra,
nessa ordem:

**São dados operacionais, não só cadastro.** O CNPJ real é exigido por lei
para emitir nota fiscal — um hash não volta a ser número, então a loja
perderia a capacidade de faturar o próprio cliente. O telefone é o que vira o
link do WhatsApp (`linkWhats()`, em `js/admin.js`) — cifrado, o botão
"Chamar" não tem para onde ligar. O endereço é para onde o produto é
entregue. Cifrar esses três campos não protege o negócio: impede o negócio.

**bcrypt quebraria a própria unicidade que o sistema já usa.** `bcrypt` gera
um hash diferente a cada vez, mesmo para o mesmo CPF (salt aleatório de
propósito) — o índice único `usuarios.documento` (migração 004), que existe
para não duplicar cliente, deixaria de funcionar, e as checagens de dígito
verificador de CPF/CNPJ (migração 013) ficariam impossíveis de rodar sobre um
hash.

**Não existe onde guardar a chave de verdade.** O site não tem servidor —
qualquer chave de criptografia reversível (AES) que morasse no JavaScript da
página estaria visível a qualquer pessoa que abrisse o DevTools. Não seria
criptografia, seria só ofuscação. Fazer isso de verdade exigiria rodar a
cifra dentro do banco (o Supabase tem `pgcrypto` e um cofre de segredos,
o Vault, para isso) — uma peça de infraestrutura nova, não uma função
isolada, e cada leitura de telefone/endereço (WhatsApp, entrega) passaria a
depender dela.

**O que já protege esses dados, sem nada disso:**

- **RLS** (ver a tabela acima) — visitante anônimo não lê nada; só quem está
  logado e cadastrado em `admins` (papel `admin` ou `vendedor`) enxerga CPF,
  CNPJ, telefone e endereço.
- **Criptografia em repouso do próprio banco.** O Postgres do Supabase roda
  sobre infraestrutura que já cifra o disco — isso é automático, da
  plataforma, e não depende de nada escrito neste projeto.

Se um dia isso precisar mudar — por exigência legal (LGPD) ou por escala —,
o caminho certo é `pgcrypto` + Vault no banco, não uma biblioteca de
criptografia rodando no navegador.

## Força bruta no login e abuso do formulário

**O que está ligado.** Em **Authentication → Rate Limits**, no painel do
Supabase, "Rate limit for sign-ups and sign-ins" veio configurado pela
plataforma em 30 tentativas a cada 5 minutos por IP (360/hora) — solto demais
para um painel de uma pessoa só. Está em **5 a cada 5 minutos (60/hora)**: um
adivinhador de senha não passa de 5 tentativas antes de esperar; você, errando
a senha de verdade, dificilmente bate nesse teto.

**O que falta, e por que não entrou:**

- **CAPTCHA no login.** O Supabase suporta de verdade (hCaptcha ou Cloudflare
  Turnstile, em **Authentication → Attack Protection → Enable Captcha
  protection**), mas exige uma chave secreta de uma conta sua nesses serviços
  — não é algo que eu possa criar por você. Passo a passo, quando quiser
  ligar: (1) crie uma conta grátis em hCaptcha.com ou
  developers.cloudflare.com/turnstile; (2) cadastre o domínio do site e pegue
  a **site key** e a **secret key**; (3) cole a secret key na tela de Attack
  Protection do Supabase e salve; (4) me peça para colocar o widget no
  formulário de login (`admin.html`) e passar o token pro
  `signInWithPassword({ options: { captchaToken } })` — é um passo de código
  pequeno, só depende de você ter as chaves primeiro.
- **Bloqueio automático de conta + aviso "tentativa suspeita".** O rate
  limit acima já reduz bastante o espaço de tentativas, mas um bloqueio de
  conta específico com notificação exigiria um Edge Function do Supabase
  reagindo a login falho (via Auth Hook) — é infraestrutura nova, não uma
  função isolada, e este projeto não tem nenhuma Edge Function hoje. Fica
  para quando/se isso virar necessidade real.
- **Limite geral de 100 req/min na API pública.** As tabelas com INSERT
  anônimo (`pedidos`, `leads`, `lista_espera`) não têm um limite de
  requisições configurável no plano Free além do que a Rate Limits acima já
  cobre para login — um limite genérico por IP em qualquer tabela exigiria
  um proxy na frente da API (Cloudflare, ou Edge Function) ou o plano Pro.
  O risco de hoje (pedido/lead falso) já é mitigado do jeito descrito na
  seção de RLS: aparece na hora no painel, para cancelar.
- **Upload de arquivo.** Não existe em lugar nenhum do site — nada a
  limitar.

## Lista de espera

Quem tenta fechar pedido fora da área de entrega entra nesta lista. Ela ficava
numa planilha do Google à parte; agora vive no mesmo banco dos pedidos, e o
painel a mostra numa aba própria — um lugar só para acompanhar.

A aba responde a pergunta que interessa: **onde há demanda represada**. O
gráfico soma, por cidade, o valor dos pedidos que não puderam ser atendidos. A
maior barra é por onde vale a pena abrir entrega primeiro.

Depois de falar com uma empresa, marque **Atendida** — ela sai da conta de
demanda represada mas continua na lista.

Se você já tinha configurado a planilha do Google, ela continua funcionando
como reserva: o site só recorre a ela quando o Supabase não estiver
configurado. Os cadastros que já estão na planilha não migram sozinhos; se
quiser trazê-los, dá para digitá-los ou eu escrevo um importador.

## Visitas

Cada abertura de página grava uma linha com: **qual página, quando, e um id de
sessão aleatório** gerado no navegador, que vive só enquanto a aba estiver
aberta.

Não guardamos IP, não usamos cookie, não há terceiro recebendo dado dos seus
visitantes. Por isso o site não precisa de aviso de cookies por causa disso.

"Sessões" é a aproximação de quantas pessoas navegaram; "páginas vistas" é
quantas telas foram abertas no total.

### Monitor geográfico

Dentro da própria aba Visitas, um mapa do Rio com uma bolha por região — maior
bolha, mais sessões. **A fonte é o CEP que o próprio visitante digita** na
página de pedido para calcular o frete, não IP nem geolocalização do
navegador. A nota completa do porquê está no topo de
`admin/migracoes/007_visitas_regiao.sql`; resumindo: IP é dado pessoal e, no
Brasil, costuma indicar a cidade errada — o CEP que a pessoa digita por
vontade própria, para saber o frete, é exato e não pede aviso de cookies.

**O custo honesto da escolha:** só entra no mapa quem chegou a consultar o
CEP. Quem só passou pelo catálogo e saiu conta no total de visitas, mas
aparece como "Sem CEP informado" nas estatísticas por região — não como um
ponto no mapa.

Os filtros **24h / 7 dias / 30 dias / Tudo**, acima do mapa, são locais a essa
seção — não mexem no resto da tela nem no filtro de período do topo. Abaixo do
mapa: contagem por região e por dispositivo, e uma tabela de sessões recentes
(página, região, dispositivo, quando — sem nome, sem contato, porque a sessão
ainda não tem um). Botão **CSV** exporta a tabela como está, já filtrada.

## Leads — o pop-up de pré-registro

Ao entrar no catálogo, o visitante vê um convite pedindo nome, telefone e CPF
ou CNPJ, com o botão "Continuar navegando" — aparece uma vez por sessão, 3
segundos depois de a página carregar, e nunca por cima do modal de produto ou
do carrinho. É captação de contato, diferente da Vitrine (que só aparece
**depois** de um pedido, como cortesia): aqui a pessoa ainda não comprou nada.

Quem preenche vira uma linha na aba **Leads** do painel — mesmo formato de
tabela, filtro e exportação da aba Clientes. O selo **DDD Rio** marca quando o
telefone é da área (21 ou 24): é só uma pista para o vendedor, não uma regra —
quem realmente decide a área de entrega é o CEP no pedido.

**Envio de SMS de boas-vindas não está ligado.** A coluna `sms_enviado`
existe no banco para isso, mas mandar SMS a partir do navegador do visitante
exporia a credencial da Twilio a qualquer pessoa que abrisse o DevTools —
precisa de uma Supabase Edge Function, que este site (todo estático) ainda não
tem. O cabeçalho de `admin/migracoes/011_leads_pre_registro.sql` explica o
caminho para ligar isso, se um dia fizer sentido.

## LGPD — consentimento, direitos do titular e retenção

A página `/privacidade.html` é o centro disso: explica o que coletamos, por
quanto tempo, e tem um formulário para exercer os três direitos que a LGPD
garante e que fazem sentido aqui (acesso, correção, exclusão). O checkbox do
pop-up de pré-registro (aba Leads) agora linka para essa página, e cada aceite
gera uma linha em `consentimentos` — data e versão da política, sem IP (ver o
porquê no cabeçalho de `admin/migracoes/015_lgpd.sql`).

**Acesso é self-service.** A pessoa digita CPF/CNPJ + telefone (os dois
juntos, como segunda confirmação) e vê os próprios dados na hora — cadastro,
endereço e pedidos. Não passa pelo painel, não precisa de você.

**Correção e exclusão passam pela aba LGPD.** Aparecem como pedidos
pendentes; nada muda sozinho. Para **correção**, edite o cadastro na aba
Clientes do jeito que já faz hoje e depois clique **Marcar atendida** na aba
LGPD, só para fechar o registro. Para **exclusão**, o botão **Excluir dados**
já chama a função do banco que anonimiza tudo de uma vez — pede confirmação,
porque não tem como desfazer.

**O que "excluir" realmente apaga:** nome, telefone, e-mail, CPF/CNPJ e
endereço, em `usuarios`/`clientes`; o mesmo tipo de dado nos pedidos já
fechados dessa pessoa (telefone, e-mail, endereço, nome do responsável); e os
pré-registros (`leads`) dela por completo. **O que fica:** o pedido em si
(CNPJ, razão social, valor, itens, status) — é obrigação fiscal de 5 anos, e
a própria LGPD prevê essa exceção (art. 16) para quando há lei específica
exigindo a guarda.

**Retenção também é manual, pelos dois botões no topo da aba LGPD** — este
projeto não tem cron nem Edge Function para rodar isso sozinho:

1. **Marcar inativos**: acha todo cliente sem pedido há 12 meses ou mais e
   marca a data. Rode de vez em quando (uma vez por mês já cobre bem).
2. **Anonimizar marcados**: quem foi marcado há 90 dias ou mais e continua
   sem comprar é anonimizado — mesma limpeza da exclusão manual, só que em
   lote.

**Auditoria.** A tabela `auditoria` guarda quem (e-mail do admin, ou "self-
service" quando é a própria pessoa consultando os dados) fez o quê e quando,
para exclusões, purgas e consultas de acesso — é o rastro que a LGPD pede
para ações consequentes sobre dado pessoal. **Não é um log de toda leitura do
painel**: o Postgres não dispara gatilho em `SELECT`, e forçar isso (extensão
`pgAudit`, ou reescrever toda tela do painel para passar por uma função)
custaria mais do que vale para as telas de relatório. Se um auditor pedir
"todo acesso, sempre", esse é o limite honesto do que este projeto entrega
hoje.

**Se um dia vazar dado de verdade:** a LGPD exige avisar a ANPD (Autoridade
Nacional de Proteção de Dados) em até 72 horas da confirmação do incidente, e
avisar as pessoas afetadas. Isso é um processo seu, não algo que o código
faz sozinho — mas a tabela `auditoria` e os logs do próprio Supabase
(Authentication → Audit Logs) são o primeiro lugar a olhar para entender o
que aconteceu e quando.

## Clientes, Kanban, Dashboard de vendas e filtros

**Clientes.** Uma tabela com todo lojista que já fez pedido — o cadastro se
preenche sozinho, não existe formulário de "novo cliente" em lugar nenhum.
Busca por nome, CNPJ, CPF ou telefone; **Detalhes** mostra o histórico
completo de pedidos; **Editar** só altera telefone, e-mail e observações — o
endereço e o resto vêm do próprio pedido, e editar aqui não reescreve o que já
está preenchido lá (ver a nota da migração 006).

**Pedidos em Kanban.** Quatro colunas — Aguardando, Confirmado, Entregue,
Cancelado — as mesmas que já existiam. Arraste um cartão para mudar o status,
ou use os botões de dentro do cartão, se preferir clicar a arrastar. O botão
**Tabela**, ao lado do Kanban, troca para a lista em linhas, com os mesmos
filtros. Confirmar um pedido abre o WhatsApp com uma mensagem de aviso já
escrita — falta só clicar em enviar, porque um site sem servidor não tem como
mandar mensagem sozinho, sem alguém apertar o botão.

**Dashboard de vendas.** Vendas por região, os 10 produtos mais vendidos,
vendas por dia e receita acumulada nos últimos 30 dias, e a comparação com o
mês anterior — tudo a partir do mesmo período que você já escolhe no filtro.

**Filtros.** No topo, acima das abas: data, busca por cliente, região e status
do pedido. Afetam Pedidos, Clientes e Histórico ao mesmo tempo — mude um filtro
e as três telas atualizam juntas, sem precisar refazer a busca em cada uma.

**Exportar.** Nas abas que têm tabela, os botões **CSV** e **PDF** no canto
exportam exatamente o que está na tela, já filtrado. O PDF é o diálogo de
impressão do próprio navegador — escolha "Salvar como PDF" nele.

**O sino.** Quando chega um pedido novo, o sino no topo pisca, conta e toca um
bipe curto (o navegador só libera som depois da primeira coisa que você clica
na página — normal não tocar exatamente no primeiro pedido da sessão). Clicar
no sino leva para a aba Pedidos e zera a contagem.

## Vitrine "Onde comprar"

Cortesia pelo volume: a loja do cliente aparece numa seção do catálogo, por
alguns dias, para quem procura os temperos encontrar onde comprar.

**Como funciona.** Depois de enviar o pedido pelo WhatsApp — nunca antes, para
não atravessar a compra —, o cliente que se qualifica recebe um convite na tela.
Se ele aceitar, o pedido cai na aba **Vitrine** como Pendente. Nada vai ao ar
sem você aprovar.

**Quem se qualifica.** Basta um dos dois gatilhos:

| Gatilho | Valor |
|---|---|
| Pedido grande | 21 caixas ou mais |
| Cliente que volta | 2º pedido ou mais |

O tamanho do pedido define o plano; dois bônus podem subir um nível cada:

| Plano | Pedido | Dias no ar |
|---|---|---|
| Basic | até 20 caixas | 1 |
| Pro | 21 a 60 caixas | 3 |
| Premium | acima de 60 caixas | 7 |

| Bônus | Sobe um nível |
|---|---|
| 3 pedidos ou mais | sim |
| Pedido acima de R$ 5.760,00 | sim |

**Só no Rio.** A regra está em `js/config.js` e também como restrição no banco,
que recusa qualquer vitrine de outro estado — uma checagem só na tela seria
contornável por quem editasse a página.

**O prazo é contado no banco**, na hora que você aprova, e o último dia conta
inteiro: um plano de 3 dias aprovado hoje sai do ar depois de amanhã, à
meia-noite. O cliente vê a contagem regressiva no próprio site.

**O que o visitante vê.** Só o nome da loja e o endereço. Telefone, e-mail e
CNPJ do comprador ficam no banco e não saem na parte pública — a seção lê uma
*view* com essas colunas de fora, não a tabela.

Quando não há nenhuma vitrine aprovada e vigente, a seção some do catálogo
sozinha: um título com o vazio embaixo seria pior do que nada.

## Se algo não funcionar

**"Painel ainda não conectado"** → `siteConfig.supabase` está vazio em
`js/config.js`, ou a biblioteca do Supabase não carregou (sem internet).

**Login entra mas não aparece nada** → o seu e-mail não está na tabela `admins`.
Passo 5a.

**"E-mail ou senha incorretos"** → confira em Authentication → Users se o
usuário existe e está confirmado.

**Pedido enviado não apareceu** → o registro não trava o envio do WhatsApp de
propósito. Se a gravação falhar, o pedido fica guardado no navegador do cliente
e sobe na próxima vez que ele abrir a página de pedido. Confira também se
`js/config.js` tem as chaves certas.

## Onde ficam as regras

Tudo num arquivo só, `js/config.js`:

```js
entrega:     { ufsAtendidas: ["RJ"], ... }   // onde você entrega
pedido:      { precoPorPoteCentavos, caixas, minimoPotes }
listaEspera: { endpoint }                    // planilha, só como reserva
supabase:    { url, anonKey }                // banco do painel
vitrine:     { planos, caixasParaSugerir, ... }  // quem ganha destaque
```
