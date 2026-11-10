# Espelho SOLIDCON: produtos

Windows PowerShell **5.1**, sem instalar módulos. No servidor interno, faz
somente estes dois GETs sequenciais a cada 30 minutos, nesta ordem:

1. `http://localhost:5100/api/Produto/GetProdutos?ativo=true&estoque=true`
2. `http://localhost:5100/api/Produto/GetProdutos?ativo=true&estoque=false`

As queries são fixas no código. Aceita também `127.0.0.1`, sempre porta 5100,
sem proxy nem redirecionamentos. Não envia nada ao ERP nem modifica o site.
`estoque=true` filtra saldo >0; `estoque=false` filtra saldo <=0.

Filtra filial 4 e as duas categorias CX24/CX48, agrupa por `id_produto` e reúne
EANs como texto. Não soma estoque entre EANs. Divergência entre EANs da mesma
lista aborta. Estoque negativo é aceito e normalizado para zero; preço negativo
continua sendo erro. Preço vira centavos com arredondamento de metade para longe do
zero. Nomes, inclusive U+FFFD recebido da API, permanecem intactos. Datas sem
fuso são interpretadas em São Paulo e enviadas em UTC (confirmar essa convenção
com TI). Esgotado = `estoque_disponivel=0`, ainda `presente=true`.
Ausente das **duas** listas de ativos = `presente=false` (não observado na coleta: pode ser desativado/removido ou, raramente, mudança de saldo entre as duas consultas — volta na próxima coleta),
com estoque zero; `visto_em` conserva a última presença. Preço é por caixa;
conferir no comercial antes de qualquer uso no site.

A filial é validada em **todas** as linhas. Depois, a trava de sobreposição
considera somente as categorias vendáveis CX24/CX48: a mesma caixa com e sem
saldo entre as consultas aborta todo o ciclo, sem escolher nenhuma das linhas.
Insumos sobrepostos ficam fora do espelho e não bloqueiam o ciclo. Uma caixa
sobreposta só terá nova tentativa no próximo agendamento. Falha em qualquer
GET também impede envio parcial.
Cada lista deve respeitar seu filtro. As leituras sequenciais não formam uma
transação no ERP; execute somente um coletor no servidor interno.

## Configuração e teste local

Copie o script e `config.exemplo.json` para `C:\TempRio\solidcon`, renomeando o
exemplo para `config.json`. Configuração, saída, estado e logs devem ficar
**fora do repositório público**. Restrinja as permissões NTFS dessa pasta à
conta da tarefa e administradores; não use transcrição PowerShell com segredos.
Deixe `modo="teste"`: os campos Supabase podem continuar como placeholders.

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File C:\TempRio\solidcon\sync-produtos.ps1 -Config C:\TempRio\solidcon\config.json -ArquivoEntrada C:\caminho\com-saldo.json -ArquivoEntradaSemSaldo C:\caminho\sem-saldo.json
```

Informe **os dois arquivos ou nenhum**; uso parcial é recusado sem GET.
Sem arquivos, faz os dois GETs locais. Arquivos locais são permitidos somente
em modo teste. Em teste **não faz nenhuma chamada ao Supabase**, nem login nem
log de falha. Produz `produtos-normalizados.json`,
`resumo.json` e `ultimo-ok-teste.json` em `pastaSaida`. Saídas de teste são
substituídas em cada sucesso; log tem rotação de 1 MiB e três arquivos antigos.
Exit 0 = sucesso; exit 1 = falha. Não há senha/token nos logs.

Em sobreposição, grava somente `resumo-rejeitado.json` e diagnóstico no log,
preservando payload/resumo de sucesso/estado anteriores. As contagens são por
produto vendável distinto: `com_saldo` vem da primeira lista; `zerados` vem da
segunda (inclui negativos normalizados); `zerados_erp` conta somente saldo
original igual a zero e `negativos` conta original <0. Há contagens de linhas
negativas totais/filtradas. `sobrepostos` conta caixas; `sobrepostos_todos`
inclui insumos e é somente diagnóstico: **apenas `sobrepostos` bloqueia**.
Em diagnóstico rejeitado, um ID pode integrar ambos os lados;
essas contagens não representam um snapshot aceito.

Validação local (PowerShell 5.1), usando as duas amostras originais de
10/11/2026, manhã com saldo e tarde sem saldo:

```text
DIAGNOSTICO linhas=557 filtradas=145 produtos=144 CX24=72 CX48=72
com_saldo=97 zerados=48 zerados_erp=23 negativos=25 sobrepostos=1 sobrepostos_todos=4
ERRO fase=sobreposicao
exit=1
```

Resultado esperado: amostras de horários diferentes sobrepõem a caixa
`7901035` e três insumos (`50161`, `7898472`, `7898479`). Não foi produzido
payload aceito a partir desse par: a caixa sobreposta continua bloqueando.
Em cópia sintética só para teste, retirando apenas a caixa `7901035` da segunda
lista e mantendo os três insumos sobrepostos, passou com 144 produtos
(72 CX24/72 CX48): 97 com saldo e 47 zerados normalizados, incluindo 25 negativos
originais. Resumo: `sobrepostos=0` e `sobrepostos_todos=3`; nenhum insumo
apareceu no payload. Insumo com filial errada continua abortando.
Essa manipulação de fixture não existe no coletor; as amostras foram preservadas.

Também verificados: EAN com zeros, múltiplos EANs sem somar estoque, 1.005 →
101 centavos, filial errada inclusive em insumo, array vazio/objeto, categoria
sem vendáveis, conflito entre EANs, host/porta/caminho recusados, arquivo local
proibido em real, queda >50% bloqueada, queda exatamente 50% aceita, repetição
e rotação do log. Regressão repetida após correções: metadados UTC/UUID e
mutex global entre pastas testados em processos PowerShell separados.
Também testados: negativos para zero, preço negativo recusado, filtros de saldo,
listas vazias individuais, sobreposição preservando o último sucesso e queda
sobre o total da união. As travas
SQL de queda/ordem/janela foram verificadas por parser e simulação estática
(não por execução em banco). Nenhuma chamada HTTP nesses testes.

## Modo real (preparação futura, não executada nesta entrega)

A 012 requer `eh_equipe()` e `eh_admin()` com os papéis de produção e aborta
se faltar qualquer helper. Há drift com o SQL base do repo: **não reaplicar
`admin/supabase.sql`**. Equipe lê produtos/logs; só admin lê autorizações.
Detalhes e rollback estão na seção 012 dos documentos do banco.

Após revisão e aplicação manual da 012, crie uma conta dedicada em Auth e
cadastre seu UUID em `integracoes_autorizadas` via SQL owner. **Nunca inclua
o email em `admins`**, nem conceda outro papel à conta. Preencha URL HTTPS,
anon key pública, email e senha no arquivo externo e altere `modo` para `real`.
Não use service_role. A conta só recebe a autorização nova das duas RPCs;
as permissões públicas existentes do site continuam disponíveis a qualquer
identidade (auditoria detalhada em `admin/ESTRUTURA-BANCO.md`, seção 012).

Login é `/auth/v1/token?grant_type=password`; o JWT fica somente em memória.
O envio usa `solidcon_receber_produtos`; falhas tentam
`solidcon_registrar_falha`, se houver configuração/credencial válida. Nunca são
gravados corpos de erro HTTP, senha ou token. Cada GET, login e RPC tem
timeout de 60s.

Zero produtos na união ou queda **maior que 50%** do total da união frente ao
último sucesso interrompem
o envio. A primeira execução não tem base comparativa. Estado de teste e real
são separados; em real, só se atualiza `ultimo-ok-real.json` após confirmação
da RPC. Não apague esse estado para contornar uma queda sem investigar.
A RPC também compara com a contagem persistida de `presente=true` dentro do
lock: queda superior a 50% é rejeitada mesmo usando outra pasta/estado local.
Os dois lados incluem todos os presentes, inclusive esgotados/negativos
normalizados; a regra da RPC continua coerente sem mudança de schema.

O script envia `p_coletado_em` em UTC (fim da segunda resposta, antes de
normalizar/login) e `p_execucao_id` UUID; ambos aparecem no resumo/estado/log.
A RPC persiste os metadados no log de sucesso. Sob o mesmo lock, rejeita coleta
anterior ou igual ao último sucesso, UUID já aceito, data não finita, mais
antiga que 24h ou mais de 5min no futuro. Mantenha o relógio do servidor correto.
Essas rejeições gravam log `erro`, devolvem `status='erro'`/`motivo` e preservam
o espelho e a referência aceita. O script sai com 1, sem avançar estado nem
duplicar o registro remoto. Não confundir HTTP 200 com snapshot aceito.

Falha de transporte pode ocorrer após commit remoto: o resultado fica incerto
até conferir o log do banco pelo UUID. Repetir o mesmo snapshot é rejeitado;
a próxima execução faz nova coleta/UUID. Logs de sucesso guardam a referência
de ordenação e devem ser preservados.

O mutex nomeado `Global\TempRioSolidconSync` bloqueia execuções simultâneas
na máquina inteira, inclusive sessões/pastas diferentes. Use a mesma identidade
da tarefa para acesso ao mutex; acesso negado falha fechado. Há também lock de
arquivo na pasta. O banco serializa os envios, mas a garantia de ordem vale
apenas para **um único coletor** (este servidor). Não rode o sincronizador em
outra máquina: duas coletas paralelas em máquinas diferentes podem gravar um
estado mais antigo por cima de um mais novo.

## Agendamento futuro: a cada 30 minutos

Execute **no servidor**, com a identidade que tem acesso à pasta externa:

```cmd
schtasks /Create /TN "TempRio SOLIDCON produtos" /SC MINUTE /MO 30 /RU "SYSTEM" /TR "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\TempRio\solidcon\sync-produtos.ps1 -Config C:\TempRio\solidcon\config.json" /F
```

O comando usa a conta atual; para rodar sem sessão aberta, configure a conta
e a execução independente de login no Agendador de Tarefas. Não coloque senha
na linha de comando. Comece agendando em teste; confira saída e Last Run Result
antes de habilitar real. Nenhuma tarefa foi criada nesta entrega.
