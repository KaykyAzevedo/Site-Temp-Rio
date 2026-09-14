# Lista de espera na planilha do Google — caminho alternativo

> **Este não é mais o caminho principal.** A lista de espera passou a viver no
> mesmo banco dos pedidos, e aparece numa aba do painel — veja
> `admin/LEIAME-PAINEL.md`. O site só recorre à planilha quando o Supabase não
> estiver configurado.
>
> Siga este documento apenas se você quiser a planilha como reserva, ou se
> ainda não for montar o painel.


Quem tenta fechar pedido fora da área de entrega vê a mensagem de
indisponibilidade e um botão **"Entrar na lista de espera"**. Este documento
explica como fazer esses cadastros chegarem até você.

## Por que precisa de configuração

O site é estático: HTML, CSS e JavaScript, sem servidor. Tudo o que ele faz
acontece no navegador do cliente.

Uma lista de espera é diferente — ela precisa de um lugar **fora** do navegador
dele. Se o cadastro ficasse guardado na máquina do cliente, você nunca veria.
Por isso o cadastro é enviado para uma planilha sua, e **a planilha é o painel**:
você ordena, filtra, exporta e comenta, sem precisar de sistema nenhum.

Enquanto isto não estiver configurado, o botão continua aparecendo, mas avisa o
cliente que o cadastro não pôde ser enviado e oferece o WhatsApp. Nada quebra.

## Passo a passo (uma vez só, uns 5 minutos)

1. Crie uma planilha nova em <https://sheets.new> e dê um nome, por exemplo
   **Temp Rio — Lista de espera**.

2. Na planilha, vá em **Extensões → Apps Script**.

3. Apague o conteúdo do editor e cole todo o arquivo `admin/lista-espera.gs`
   deste repositório. Salve (o ícone de disquete).

4. Clique em **Implantar → Nova implantação**.
   - Em **Tipo**, escolha **App da Web**.
   - **Executar como:** `Eu`.
   - **Quem pode acessar:** `Qualquer pessoa`.

   Esse "qualquer pessoa" vale para **enviar** um cadastro, não para ler a
   planilha. A planilha continua só sua, atrás do seu login do Google.

5. O Google vai pedir autorização na primeira vez. Como o script é seu, ele
   aparece como "não verificado": clique em **Avançado → Acessar (não seguro)**.
   É o caminho normal para scripts próprios.

6. Copie a **URL do aplicativo web** que aparece no fim (termina em `/exec`).

7. Abra `js/config.js` e cole a URL:

   ```js
   listaEspera: {
       endpoint: "https://script.google.com/macros/s/AKfy.../exec"
   }
   ```

8. Para conferir, abra a URL no navegador. Deve responder algo assim:

   ```json
   {"ok":true,"mensagem":"Lista de espera da Temp Rio ativa.","cadastros":0}
   ```

Pronto. A partir daí cada cadastro vira uma linha nova na aba
**Lista de espera**, criada automaticamente no primeiro envio.

## O que chega em cada linha

| Coluna | Para quê |
|---|---|
| Data, Razão social, CNPJ, Inscrição estadual, Responsável | Quem é a empresa |
| Telefone, E-mail | Como falar com ela |
| CEP, Cidade, UF, Endereço | **Onde está a demanda represada** |
| Potes, Caixas, Valor, Itens | **O tamanho do pedido que você não pôde atender** |
| Observações | O que a pessoa escreveu |

As duas colunas em destaque são as que valem mais. Uma tabela dinâmica por
cidade mostra onde vale a pena abrir entrega primeiro, e quanto de faturamento
está esperando em cada praça.

## Coisas que você precisa saber

**A URL é pública.** Ela fica visível no código-fonte da página, como qualquer
endereço que o navegador precisa chamar. Significa que alguém decidido consegue
mandar linhas falsas para a planilha. Há uma constante `CHAVE` no script que
filtra ruído automatizado, mas ela **não é um segredo** — está no site também.
Se um dia começar a chegar lixo de verdade, o caminho é trocar por um serviço
com proteção real, e eu faço essa migração.

**São dados pessoais.** Nome, CNPJ, telefone, e-mail e endereço de clientes
reais. Ficam na sua planilha, protegidos pelo seu login. Vale evitar
compartilhar a planilha por link aberto — compartilhe por e-mail, pessoa a
pessoa. Foi justamente para não expor esses dados que não existe uma página de
administrador no site: uma página dessas, sem senha, ficaria acessível a
qualquer um que descobrisse o endereço.

**Se a rede falhar na hora do envio**, o cadastro não se perde: fica guardado no
navegador do cliente e sobe sozinho na próxima vez que ele abrir a página de
pedido. Não é garantia — se ele nunca voltar, o cadastro não chega. Por isso o
botão do WhatsApp continua ao lado, como caminho imediato.

## Mudar a área de entrega

Fica em `js/config.js`, num lugar só:

```js
entrega: {
    ufsAtendidas: ["RJ"],
    prazoAtendido: "Entrega em até 7 dias em todo o estado do Rio de Janeiro."
}
```

Para passar a atender São Paulo e Minas, por exemplo:
`ufsAtendidas: ["RJ", "SP", "MG"]`. O site inteiro acompanha — aviso de entrega,
trava do pedido e lista de espera.
