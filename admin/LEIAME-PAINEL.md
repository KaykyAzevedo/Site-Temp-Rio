# Painel de administrador — como ligar

O painel fica em `admin.html`. Ele mostra pedidos, histórico por cliente,
dashboard de vendas mensal, lista de espera e visitas.

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

   A ordem importa: os dois últimos usam a função `eh_admin()`, que nasce no
   primeiro. Rodar fora de ordem dá erro de função inexistente.

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
| Você, logado e na tabela `admins` | Ler e atualizar pedidos |

Duas consequências que valem saber:

**Esconder um botão não protege dado nenhum.** Por isso a proteção está no
banco, não na interface — mesmo quem editar o JavaScript da página no próprio
navegador não consegue ler um pedido.

**Qualquer pessoa pode inserir um pedido falso.** É o preço de um site estático
sem servidor: para o site poder gravar, a permissão de gravar tem que ser
pública. É a mesma condição da lista de espera. Na prática o risco é baixo (não
há o que ganhar com isso), e um pedido falso é visível na hora na aba Pedidos —
você cancela. Se algum dia virar problema, o caminho é um servidor próprio
intermediando a gravação, e eu faço essa mudança.

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
