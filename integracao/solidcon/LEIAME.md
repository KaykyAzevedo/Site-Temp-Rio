# Situação das migrações

O espelho e o histórico já estão instalados como 012 e 017 de A. Os arquivos
foram renumerados para 019 e 020 no repositório unificado. A 022 de vendas está
aplicada desde 2026-11-11 (registro em admin/migracoes/LEIAME.md). A 023 de
clientes ainda NÃO foi aplicada. Este coletor é a versão candidata com
clientes; a implantação futura da 023 precede sua atualização no servidor.

Reaplicar a 019 substitui a RPC `solidcon_receber_produtos` pela versão
anterior à 020 e interrompe a atualização do histórico e dos eventos.

# Espelho SOLIDCON: produtos, vendas e clientes

Windows PowerShell **5.1**, sem instalar módulos. No servidor interno, faz
estes dois GETs de estoque a cada 30 minutos, nesta ordem:

1. `http://localhost:5100/api/Produto/GetProdutos?ativo=true&estoque=true`
2. `http://localhost:5100/api/Produto/GetProdutos?ativo=true&estoque=false`

Após o estoque, tenta vendas de hoje e ontem no endpoint resumo-produtos-data,
com filial 4 e data gerada pelo script (seção 022 abaixo). Depois, quando
devidos, tenta clientes uma única vez por dia após 06:00 (seção 023).
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
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File C:\TempRio\solidcon\sync-produtos.ps1 -Config C:\TempRio\solidcon\config.json -ArquivoEntrada C:\caminho\com-saldo.json -ArquivoEntradaSemSaldo C:\caminho\sem-saldo.json -ArquivoVendas C:\caminho\vendas-por-dia.json -ArquivoClientes C:\caminho\clientes-ficticios.json -ArquivoVendasClientes C:\caminho\vendas-clientes-ficticios.json -ArquivoModalidades C:\caminho\modalidades-ficticias.json
```

Informe **os dois arquivos de estoque ou nenhum**; uso parcial é recusado sem GET.
Para teste totalmente offline, inclua também -ArquivoVendas, -ArquivoClientes, -ArquivoVendasClientes e -ArquivoModalidades.
Com arquivos locais, a ausência do arquivo do fluxo gera falha isolada, sem
GET implícito de vendas/clientes. Informe sempre os dois arquivos de estoque.
Sem arquivos, faz os dois GETs locais. Arquivos locais são permitidos somente
em modo teste. Em teste **não faz nenhuma chamada ao Supabase**, nem login nem
log de falha. Produz `produtos-normalizados.json`,
`resumo.json` e `ultimo-ok-teste.json` em `pastaSaida`. Saídas de teste são
substituídas em cada sucesso; log tem rotação de 1 MiB e três arquivos antigos.
Exit 0 = fluxos OK (inclui clientes e ficha ainda não devidos ou já concluídos hoje);
exit 1 = configuração/mutex/estoque falhou; exit 3 = vendas falhou;
exit 4 = somente clientes falhou; exit 5 = somente ficha técnica falhou;
**exit 6 = somente histórico de vendas por cliente falhou**; exit 7 = somente insumos (estoque da fábrica);
exit 8 = somente formas de pagamento.
Precedência: 1 > 3 > 4 > 5 > 6 > 7 > 8. Os logs de cada fluxo identificam as falhas quando ocorrer mais de uma.
A ficha técnica é enviada 1x/dia aproveitando dados já presentes em GetProdutos (nenhuma chamada nova ao ERP).
Vendas por cliente executa 1 GET por ciclo cobrindo ontem e hoje; -BackfillDias divide em blocos mensais com pausa de 700ms.
Em backfill, 0 = vendas OK, 3 = falha de vendas, 6 = falha de vendas por cliente, 8 = falha de formas de pagamento, 1 = inicialização inválida.
A ficha só roda no ciclo normal e com o estoque confirmado no mesmo ciclo; backfill nunca roda ficha (nem reserva o dia).
A RPC da ficha só é aceita com `encontrados` = linhas enviadas.
Reserva diária da ficha por modo (`ficha-consulta-teste.json` / `ficha-consulta-real.json`): teste na mesma pasta e dia não bloqueia o envio real.
Não há senha/token nos logs.

Em sobreposição, grava somente `resumo-rejeitado.json` e diagnóstico no log,
preservando payload/resumo de sucesso/estado anteriores. As contagens são por
produto vendável distinto: `com_saldo` vem da primeira lista; `zerados` vem da
segunda (inclui negativos normalizados); `zerados_erp` conta somente saldo
original igual a zero e `negativos` conta original <0. Há contagens de linhas
negativas totais/filtradas. `sobrepostos` conta caixas; `sobrepostos_todos`
inclui insumos e é somente diagnóstico: **apenas `sobrepostos` bloqueia**.
Em diagnóstico rejeitado, um ID pode integrar ambos os lados;
essas contagens não representam um snapshot aceito.

Em PowerShell 5.1, amostras de horários diferentes com uma caixa sobreposta
foram rejeitadas com `fase=sobreposicao` e código 1. Uma cópia de teste com
apenas insumos sobrepostos passou. Os insumos ficaram fora do payload e o
saldo negativo das caixas foi normalizado para zero.

Também verificados: EAN com zeros, múltiplos EANs sem somar estoque,
arredondamento para centavos, filial errada inclusive em insumo, array vazio/objeto, categoria
sem vendáveis, conflito entre EANs, host/porta/caminho recusados, arquivo local
proibido em real, queda >50% bloqueada, queda exatamente 50% aceita, repetição
e rotação do log. Regressão repetida após correções: metadados UTC/UUID e
mutex global entre pastas testados em processos PowerShell separados.
Também testados: negativos para zero, preço negativo recusado, filtros de saldo,
listas vazias individuais, sobreposição preservando o último sucesso e queda
sobre o total da união. As travas
SQL de queda/ordem/janela foram verificadas por parser e simulação estática
(não por execução em banco). Nenhuma chamada HTTP nesses testes.

## Modo real (configuração de referência)

A 019 requer `eh_equipe()` e `eh_admin()` com os papéis de produção e aborta
se faltar qualquer helper. Há drift com o SQL base do repo: **não reaplicar
`admin/supabase.sql`**. Equipe lê produtos/logs; só admin lê autorizações.
Detalhes e rollback estão na seção 019 dos documentos do banco.

Em um ambiente novo com o espelho instalado, crie uma conta dedicada em Auth e
cadastre seu UUID em `integracoes_autorizadas` via SQL owner. **Nunca inclua
o email em `admins`**, nem conceda outro papel à conta. Preencha URL HTTPS,
anon key pública, email e senha no arquivo externo e altere `modo` para `real`.
Não use service_role. A conta só recebe a autorização nova das duas RPCs;
as permissões públicas existentes do site continuam disponíveis a qualquer
identidade (auditoria detalhada em `admin/ESTRUTURA-BANCO.md`, seção 019).

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

O comando usa SYSTEM; para outra identidade, configure a conta
e a execução independente de login no Agendador de Tarefas. Não coloque senha
na linha de comando. Comece agendando em teste; confira saída e Last Run Result
antes de habilitar real. Nenhuma tarefa foi criada nesta entrega.

## 022 — Vendas: hoje/ontem e carga inicial manual

Funcionalidade aprovada. A migração 022 e este coletor ainda aguardam implantação.
No futuro, aplicar primeiro 022 e só depois substituir o script do servidor,
preservando cópia anterior. Configuração externa e agendamento não mudam.

Única rota adicional autorizada, somente GET, loopback:5100, sem proxy/redirect:

```text
/api/Vendas/resumo-produtos-data?idFilial=4&data=YYYY-MM-DD
```

No ciclo normal, roda APÓS estoque, sucesso ou falha. Faz um GET e uma RPC por
dia (hoje e ontem em São Paulo), com UUID/coleta próprios. Falha de um dia não
impede tentar o outro. Erros de GET/normalização/RPC ficam em `ERRO vendas ...`;
nunca apagam nem desfazem estoque já salvo. Falhas antes da RPC não fingem
resposta vazia nem criam log remoto de sucesso.

Enriquece usando as duas respostas GetProdutos já coletadas, por EAN/código
interno/cdProduto. Pote em processo=1, CX24=24, CX48=48; demais=outro/NULL.
Reconhece a categoria de pote com o U+FFFD real da API, sem corrigir textos.
EAN13 de pote usa a base de 12 dígitos; GTIN14 de caixa usa posições 2..13.
Catálogo ausente/inválido ou item sem correspondência: nome/categoria/família/
fator NULL, formato outro. Receita é sempre mantida; os potes equivalentes
incluem apenas os fatores conhecidos. Nenhuma embalagem é inferida só pelo EAN.

Dinheiro usa centavos, arredondamento de metade para longe de zero; qtd pode
ser fracionária. Agrega linhas repetidas por EAN/dia. idProduto int64 ou EAN
textual continua texto, preservando zeros existentes. qtDesconto não é valor
monetário: desconto vem de vlDescontoPromocaoCombinada.

Em teste grava envelopes `vendas-hoje.json` e `vendas-ontem.json`:
dia/coleta/UUID, itens normalizados, linhas, total centavos, potes conhecidos e
contagem sem catálogo. `vendas-resumo.json` soma o período. Nenhuma chamada ao
Supabase em teste. Os arquivos continuam fora do repo e são ignorados no Git.

### Backfill manual (não executar agora)

`-BackfillDias N` aceita 1..400, incluindo hoje, mais antigo primeiro. É só vendas:
não chama a RPC de estoque nem altera seu estado; os dois GETs de produtos
servem apenas ao enriquecimento. Pausa 700ms entre GETs de dias, não entre
leituras de arquivo; mantém o mesmo mutex global durante todo o lote.
Continuar após erro não significa sucesso: exit 3 se algum dia falhou.

```powershell
# Futuro, no servidor, depois da revisao/022: consulta ERP e envia ao Supabase.
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File C:\TempRio\solidcon\sync-produtos.ps1 -Config C:\TempRio\solidcon\config.json -BackfillDias 180
```

Para teste **sem rede**, modo teste, passando os três arquivos:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\integracao\solidcon\sync-produtos.ps1 -Config C:\TempRio\solidcon\config-teste.json -ArquivoEntrada C:\amostras\estoque-true.json -ArquivoEntradaSemSaldo C:\amostras\estoque-false.json -ArquivoVendas C:\amostras\vendas-por-dia.json -BackfillDias 180
```

Backfill em teste grava `vendas-YYYY-MM-DD.json` para cada data e resumo geral.
ArquivoVendas aceita array histórico dia/ean/qtd/valor/valor_bruto/desconto ou
array bruto da API com dtCupom/idProduto/qtItem/valores. Datas fora do período
solicitado não entram na saída. Dias sem linhas no arquivo são tratados como
vazios somente nesse teste; o arquivo não informa falhas da coleta original.
Todos os arquivos de entrada são recusados em modo real.

### Resultado da amostra e limites

Amostra real de 180 dias conferida linha a linha (totais, unidades, potes e
formatos idênticos à origem; valores comerciais ficam fora do repositório, que
é público). Identificadores sem catálogo: receita preservada,
formato outro. Esses potes não foram estimados.

Parser/execução PS5.1, regressão estoque e fluxos simulados passaram, sem HTTP
real. PostgreSQL18 local: substituição, vazio, ordem/UUID, RLS, views e rollback
após DELETE testados; carga completa local bateu nas três views.
Nenhuma alteração em Supabase, ERP, tarefa ou arquivo do servidor.

A RPC rejeita [] se já há linhas naquele dia; não há override nesta fase.
Troca de coleta antiga/UUID repetido também é recusada. SQL/logs não dependem
do estado local de estoque. DDL/rollback completos: seção 022 de
admin/migracoes/LEIAME.md. Ao desfazer 022, restaurar também o script pré-022;
caso contrário, estoque continua e vendas sinalizam exit 3.


## 023 — Clientes: no máximo um GET por dia (NÃO IMPLANTADA)

Finalidade aprovada: atendimento B2B e conferência de cadastro. A migração 023
é candidata e **não deve ser aplicada nesta entrega**. Revisar e instalar
manualmente no futuro antes de trocar o coletor do servidor. Não alterar o
script operacional sendo implantado para vendas até a liberação dessa versão.

Depois de estoque e vendas, o primeiro ciclo a partir de **06:00 em
America/Sao_Paulo** tenta somente:

`GET http://localhost:5100/api/Cliente/GetClientes`

Sem parâmetros, proxy, redirecionamento ou retry. Não consulta outras rotas de
clientes, não faz POST/PUT no ERP. As rotas existentes de estoque e vendas
continuam iguais. `-BackfillDias` continua somente vendas: não lê arquivo,
estado nem ERP de clientes e não executa a RPC de clientes.

Antes do GET grava atomicamente `clientes-consulta.json` na pasta de saída,
com dia local, horário, versão e status pendente. A reserva vale mesmo se o
GET der timeout, o processo morrer ou normalização/login/RPC falharem. Status
final ok/erro; pendente ou erro no mesmo dia não gera novo GET e mantém falha
de clientes nos ciclos seguintes. Uma execução concluída é ignorada até o
próximo dia. Antes das 06h apenas adia. Estado inválido/futuro ou falha ao
gravar reserva falha fechado: **zero GET**, exit 4 se os outros fluxos OK.

O mesmo arquivo controla consultas reais ao ERP em modo teste e real; testar
com ERP consome a consulta daquele dia e não permite reenviar em modo real no
mesmo dia. Use uma única instalação, máquina, tarefa e `pastaSaida` persistente;
preserve a pasta nas atualizações, não apague o estado para forçar repetição e
não altere o relógio. O mutex global já existente impede execução simultânea.
O limite não coordena outras máquinas ou pastas de saída independentes.

Normalização faz **projeção explícita**, incluindo somente documento, tipo,
nome, telefone, celular, email e `endereco.cidade/bairro/estado` (estes três
campos ficam planos no payload). Nunca envia ou grava dtCadastro, nascimento,
sexo; logradouro, número, complemento e CEP só para CNPJ desde a 027 (ver seção 027). O corpo bruto fica só em memória.
Em modo real não grava arquivo com dados pessoais; log e estado contêm apenas
metadados técnicos. Mensagens de falha são fixas, sem resposta ERP/SQLERRM.

O ERP chama de `cpf` o documento de ambos os tipos. Valores inteiros/textuais
são mantidos como texto, removendo apenas máscara e completando zeros para
11/14 posições; float/bool, duplicatas ou documento inválido abortam o lote.
Sem `tipo` explícito, mais de 11 dígitos indica CNPJ. Com até 11 dígitos, o
coletor confere os dígitos verificadores: se só o CNPJ (completado a 14) for
válido, grava CNPJ; nos demais casos, CPF. **Limitação residual:** quando os
dois são válidos (raro), fica CPF. `tipo` explícito cpf/cnpj, se fornecido
na origem, é respeitado; não se inventa dígito nem se valida titularidade pelo
documento. Conferir essa limitação com a TI antes da implantação.

Nome obrigatório até 150 caracteres; telefone/celular 32 cada, email 254,
cidade/bairro 100 cada, UF 2 letras normalizadas para maiúsculas; opcionais
vazios viram NULL, tipos inesperados/controles/tamanhos excessivos abortam o
lote, sem truncar ou descartar clientes silenciosamente. Resposta máxima
32 MiB de texto, payload 10.000 clientes/16 MiB; vazio sempre rejeitado.
Queda >50% contra último OK local ou remoto é rejeitada. Não lê outros campos
do endereço. PS 5.1 desembrulha explicitamente o array de ConvertFrom-Json.

`clientes-ultimo-ok-teste.json` / `clientes-ultimo-ok-real.json` são referências
separadas só de contagem/coleta/UUID. A confirmação da RPC exige status, linhas,
coleta e UUID coincidentes; timeout/retorno divergente não promove estado OK.
O espelho remoto anterior permanece em rejeições e falhas transacionais; se
houve timeout de confirmação, o remoto pode ter concluído. Em ambos os casos,
não repete GET hoje: nova tentativa somente no dia seguinte após 06h.

Falha de clientes não cancela estoque/vendas concluídos nem chama a RPC de
falha de estoque. Códigos: 0 OK/adiado/já OK; 1 inicialização/estoque; 3 vendas;
4 somente clientes. Se vendas e clientes falharem, sai 3 e loga ambos; se
estoque também falhar, sai 1. Não há nova configuração ou segredo.

### Teste totalmente offline

Use modo teste e os quatro arquivos locais no comando da seção Configuração.
`-ArquivoClientes` aceita array bruto no formato do ERP (`cpf`, `nome`, contatos,
`endereco`), com **dados exclusivamente fictícios**. Testa independentemente do
horário, sem consumir/gravar a reserva diária e sem chamar ERP/Supabase para
clientes. Grava só a projeção permitida em `clientes-normalizados.json` (envelope
com linhas/coleta/UUID/itens), substituída a cada sucesso. Qualquer arquivo de
entrada, inclusive este, é recusado em modo real antes de rede. Em backfill o
arquivo de clientes é ignorado, pois o fluxo é exclusivo de vendas.

Não salvar amostras reais, saídas pessoais, credenciais ou estado neste repo
público. Entradas e pasta de saída ficam fora dele, com ACL local restrita à
conta da tarefa e administradores. O espelho é substituído diariamente, sem
histórico pessoal; se a coleta falhar, conserva o último espelho válido até a
próxima coleta válida. Acesso no painel apenas pela equipe via RLS; o cadastro
ERP não é sincronizado com autenticação nem autoriza acesso por CNPJ/CPF.

## 026 — Vendas por cliente: histórico e conformidade LGPD (NÃO IMPLANTADA)

A migração `026_solidcon_vendas_clientes.sql` é candidata e **não deve ser aplicada nesta entrega**.
Permite a visualização do histórico de compras de clientes no painel administrativo pela equipe de vendas.

### Endpoint do ERP e ciclo de coleta

Endpoint exclusivo autorizado (somente leitura):
`GET http://localhost:5100/api/Vendas/CNPJ/63671696000106/INICIO/{yyyy-MM-dd}/FIM/{yyyy-MM-dd}/GetVendasResumo`

- **Ciclo regular:** 1 GET por ciclo cobrindo `ontem` e `hoje` (`INICIO = ontem`, `FIM = hoje`), capturando as vendas do dia e do dia anterior à medida que são registradas nos PDVs.
- **Modo `-BackfillDias`:** para carga inicial de histórico (até 400 dias), divide o período em blocos mensais consecutivos (máximo 31 dias por bloco), executando 1 GET e 1 RPC por bloco com pausa de 700ms entre as requisições ao ERP.
- **HTTP 500 do ERP (bug de dado em algum dia):** o intervalo é dividido ao meio recursivamente até 1 dia (pausa de 700ms entre GETs; teto de 60 GETs por execução, `$VendasClientesMaxGets`). Cada sub-intervalo que responder 200 é enviado à RPC normalmente (valem `snapshot_antigo`/sobreposição). Dia único que ainda der 500 é **pulado sem RPC** (dados já gravados desse dia ficam intactos); o log local registra só a data (`AVISO vendas-clientes ERP http=500 dia=AAAA-MM-DD`) e, no fim, `AVISO vendas-clientes dias_com_erro_erp=N dias=...`. Se algo foi gravado, exit 0 com aviso; se nada foi gravado, exit 6. Teto atingido = exit 6 (o que já foi gravado fica). Vale para o ciclo normal (ontem+hoje) e para o backfill. Período sem vendas = HTTP 200 `[]` (0 itens, sucesso).
- **Outros erros do ERP** (4xx, 5xx diferente de 500, timeout/sem resposta, corpo que não é array) falham o fluxo (exit 6) sem dividir; o log mostra só `http=<número>`, nunca o corpo.
- **Validação estrita (lote inteiro rejeitado, exit 6):** resposta que não seja array JSON (ex.: objeto de erro HTTP), item que não seja objeto, `dtCupom` ausente/inválido, `vlCupom` ausente, `totalItens`/`cdPDV`/`nrCupom` ausentes, negativos ou fracionários (sem arredondar), cupom fora do intervalo consultado e mesma chave `(dia, cdPDV, nrCupom)` com dados diferentes. Repetição idêntica é ignorada. Só a ausência/invalidade de `cdCliente` descarta o cupom (consumidor sem documento).
- **Teste offline:** o arquivo `-ArquivoVendasClientes` é validado inteiro antes de dividir em blocos; cupom fora dos blocos (ex.: além de `-BackfillDias`) falha o fluxo. O parâmetro `-ArquivoVendasClientes` permite alimentar o sincronizador com amostras de testes sintéticas sem qualquer tráfego de rede ou consulta ao ERP.

### Declaração de Conformidade com a LGPD (Lei 13.709/2018)

1. **Finalidade Legítima:** Gestão comercial B2B, apuração de ticket médio, frequência e análise de recorrência de compras de clientes no painel interno.
2. **Minimização de Dados (Necessidade):**
   - Compras anônimas (consumidor final sem CPF/CNPJ) são descartadas na origem e não são gravadas.
   - Metadados fiscais desnecessários como chave NF-e (`nfCeChave`), modalidades de pagamento e CNPJ de filial são sumariamente descartados e não entram no payload nem no banco de dados.
   - Apenas os campos indispensáveis são armazenados: `dia`, `dt`, `documento`, `tipo`, `valor_centavos`, `total_itens`, `cd_pdv`, `nr_cupom`, `coletado_em`.
3. **Acesso Restrito:** A tabela `solidcon_vendas_clientes` e seu histórico são protegidos por Row Level Security (RLS) concedida estritamente a usuários autenticados com papel de equipe (`public.eh_equipe()`). Acesso público ou anônimo é revogado (`revoke all`).
4. **Retenção Bounded e Descarte Automático (400 dias):**
   - Retenção máxima estipulada em 400 dias de histórico (adequada para ciclos sazonais e anuais B2B).
   - A RPC `solidcon_receber_vendas_clientes` executa expurgo automático a cada chamada bem-sucedida (`delete from solidcon_vendas_clientes where dia < (v_hoje - 400) and dia is not null;`), garantindo que dados mais antigos sejam eliminados sem intervenção manual.
5. **Segurança e Isolamento de Falhas:**
   - RPC SECURITY DEFINER restrita a tokens de integração cadastrados em `integracoes_autorizadas`.
   - Substituição atômica de intervalo com `DELETE ... WHERE` compatível com a extensão `safeupdate`.
   - Falha isolada gera código de saída **6**, preservando intactos o estoque, as vendas gerais, o cadastro de clientes e a ficha técnica (precedência `1 > 3 > 4 > 5 > 6`).

## 027 — Estoque da fábrica, endereço CNPJ e formas de pagamento (NÃO IMPLANTADA)

Requer a migração 027 aplicada **antes** de trocar o coletor no servidor (o RPC antigo de
clientes recusa o payload de 13 campos e as RPCs novas não existem).

### Estoque da fábrica (insumos) — exit 7

- **Nenhum GET novo:** reaproveita as duas respostas de `GetProdutos` do estoque.
- Roda a cada ciclo normal, **depois** do estoque vendável confirmado no mesmo ciclo; não roda
  em `-BackfillDias` nem se o estoque falhou. Não altera em nada o fluxo/RPC de estoque vendável.
- Itens = todas as linhas fora de `config.categorias` (matéria-prima, embalagens etc.).
  Projeção: id, nome, categoria, unidade (`unid_medida`, senão `emb`), estoque bruto (negativo
  mantido), `dtalteracao` (mesma regra de fuso do estoque).
- Mesmo id em várias linhas (vários EANs ou nas duas consultas) só é aceito se idêntico; senão
  o lote inteiro falha (exit 7) e repete no próximo ciclo. Zero insumos, mais de 10.000, nome
  vazio/controle ou dados inválidos também = exit 7. Queda >50% contra o último OK local
  (`insumos-ultimo-ok-<modo>.json`) ou remoto é rejeitada.
- Teste: grava `insumos-normalizados.json`. Real: RPC `solidcon_receber_insumos`, conferida por
  status/execução/linhas/coleta.
- `coletado_em` dos insumos = **instante do mesmo GetProdutos do estoque** (não a hora do envio,
  que vem depois de vendas/clientes/026): a foto diária cai no dia SP em que o estoque foi lido,
  mesmo na virada da meia-noite. Sem fallback: instante ausente, fora do formato ou fora da janela
  (-23h/+5min) = exit 7 sem RPC.

### Endereço de clientes CNPJ (mesmo GET diário de clientes)

- Para CNPJ, lê de `endereco`: `logradouro` (≤100), `numero` (≤30), `complemento` (≤60) e `cep`
  (limites do `vmEndereco` do Swagger). Texto com trim; vazio vira null; tipo diferente de
  string, controle ou acima do limite falha o lote (exit 4). CEP: só dígitos, **sem completar
  zeros**; exatamente 8 dígitos ou null.
- Para **CPF nunca lê nem envia** endereço (os 4 campos vão null). `cdMunicipio` e demais campos
  continuam descartados.

### Formas de pagamento — exit 8

- **Única rota nova:** `GET http://localhost:5100/api/Vendas/resumo-modalidade-data?idFilial=4&data=AAAA-MM-DD`
  (sem proxy/redirect, timeout 60s).
- Ciclo normal: 1×/dia, primeiro ciclo após **06:00 America/Sao_Paulo**, busca **ontem**.
  Reserva durável antes do GET em `modalidades-consulta-<modo>.json` (por modo, como a ficha):
  pendente/erro no mesmo dia não gera novo GET e mantém exit 8; estado inválido/futuro = zero GET.
- `-BackfillDias N`: 1 GET por dia para os N dias **até ontem** (hoje fica de fora, dia aberto),
  pausa de 700ms entre GETs, sem reserva.
- Projeção: `idModalidade`, `nmModalidade`, `vlModalidade` (centavos), `qtdePagamentos`.
  `vlSangria`/`vlFundo` **nunca são lidos nem enviados**.
- HTTP 500 num dia = dia pulado com `AVISO modalidades ERP http=500 dia=...` (dados já gravados
  ficam); se nada foi gravado, exit 8; senão exit 0 com `AVISO modalidades dias_com_erro_erp=N dias=...`.
  Outros status, timeout e corpo que não seja array = exit 8 (log só `http=<número>`).
- **Suposições documentadas** (Swagger não descreve a resposta; amostra real de 2026-11-10 tinha
  1 objeto): resposta é array JSON; `idModalidade` inteiro ≥0; `vlModalidade` ≥0 — **negativo
  rejeita o dia (exit 8)**; `qtdePagamentos` inteiro ≥0; dia sem venda = `[]` (0 linhas, sucesso);
  modalidade repetida no dia = exit 8. Se o ERP fugir disso, o fluxo falha fechado sem gravar.
- Teste offline: `-ArquivoModalidades` com array de linhas no formato do ERP mais o campo `dia`
  (cada dia precisa estar no período: ontem, ou os N dias do backfill). Exige os arquivos de
  produtos. Grava `modalidades-AAAA-MM-DD.json` e `modalidades-resumo.json`; sem reserva/horário.
  Em teste com qualquer arquivo local e sem `-ArquivoModalidades`, o fluxo falha (exit 8) sem GET.

### Códigos de saída

0 OK; 1 configuração/estoque; 3 vendas; 4 clientes; 5 ficha; 6 vendas por cliente;
**7 somente insumos; 8 somente formas de pagamento**. Precedência **1 > 3 > 4 > 5 > 6 > 7 > 8**.
