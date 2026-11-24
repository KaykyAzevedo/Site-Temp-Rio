# Entrega do consumidor final (058)

Fonte confirmada: `GET http://localhost:5100/api/Cliente/GetClientes`, a mesma chamada diária do sync-produtos. Usa nome e endereço **cadastral**; não foi confirmada uma tabela de endereço específico da venda no SQL Server. Nenhuma consulta SQL ERP ou chamada REST nova.

O pedido leva apenas `pessoa_chave` (HMAC-SHA256), tipo e os campos técnicos que já levava; `documento` de CPF continua sempre `null`. O servidor une essa chave ao cadastro e copia nome, logradouro, número, complemento, bairro, cidade, UF e CEP para campos `entrega_*`. A publicação para o motorista contém só nome/endereço/caixas/pedidos; não contém CPF, HMAC nem valor.

## Instalação após revisão do pacote

1. Aplicar `admin/migracoes/058_entrega_cpf.sql`, depois da057. Confirmar o job `solidcon-cpf-retencao` (`17 * * * *`) e a rotina de limpeza já existente das rotas. A058 não aplica extensões automaticamente. Sem pg_cron, há fallback na RPC de pedidos; para garantir prazo com coletor parado, instalar/configurar o cron antes de ativar a funcionalidade.
2. Copiar `pessoas-pedido.ps1`, `configurar-chave-pessoas.ps1`, `sync-produtos.ps1` e `sync-banco.ps1` para `C:\TempRio\solidcon\`, mantendo as flags desligadas.
3. No **PowerShell como administrador**, no servidor ERP:

```powershell
Set-Location 'C:\TempRio\solidcon'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\configurar-chave-pessoas.ps1
```

O arquivo `pessoas-chave.dpapi` é criado uma vez, com32bytes aleatórios, DPAPI LocalMachine e ACL somente SYSTEM/Administradores. Rodar de novo valida a chave e preserva o segredo. Terminal sem elevação é recusado antes da criação. Não apagar/substituir/rotacionar: os identificadores dependem dessa chave. Guardar cópia protegida no backup do próprio servidor; o arquivo DPAPI sozinho não migra para outra máquina. Não enviar chave nem config com credenciais para revisão.

4. Em `config.json`, acrescentar `"pessoas_pedido": true`. Manter o coletor de clientes com o limite atual: uma consulta por dia, após06hSP. Se ele já consultou hoje, o endereço completo chegará na próxima consulta permitida. Não apagar a reserva para provocar outro GET. O protocolo novo continua enviando o documento apenas no cadastro023 que já o armazenava, nunca no pedido.
5. Após a coleta de clientes nova ter concluído, em `config-banco.json` acrescentar `"pessoas_pedido": true`. A próxima coleta de pedidos usa HMAC. Ambos devem ler **o mesmo arquivo**. Se scripts estiverem em pastas diferentes, configurar nos dois JSONs `"chave_pessoas_arquivo": "C:\\TempRio\\solidcon\\pessoas-chave.dpapi"`.
6. Publicar `js/admin.js`, `js/admin-rota.js` e `supabase/functions/_shared/rota-core.js`. `motorista.html/js/css` já exibem nome/endereço e navegação por endereço; não foram modificados. A UI recua para a leitura antiga se058 ainda não estiver instalada.
7. Rotas já enviadas ao motorista mantêm a publicação anterior. Depois de conferir os dados novos, usar o fluxo normal de publicação da rota; o sync não reescreve versões já enviadas nem pendências offline.

Segredo ausente/corrompido/ACL ampla falha sem enviar identificador falso; os outros módulos dos coletores continuam independentes. A checagem da chave de clientes acontece antes do GET/reserva, evitando consumir a consulta diária por configuração incompleta. Credenciais e chave não são impressas.

## Retenção e compatibilidade

- Fonte por pedido: dados pessoais e HMAC são apagados **após180dias** do faturamento, em São Paulo, usando `dt_saida > dt_nota > dt_atendido`. Sem faturamento, não inventa uma data. A própria recepção também anonimiza um pedido vencido; o guard039 de32dias para data do pedido continua vigente.
- Cadastro CPF: conserva enquanto houver pedido aberto sem faturamento presente ou até180dias do último faturamento conhecido. Sem histórico conhecido, usa a primeira observação, sem renovar o prazo em cada importação. Ao vencer, remove a linha inteira do cadastro, incluindo documento e contatos. CNPJ permanece com o comportamento anterior.
- Memória técnica privada `solidcon_pessoa_retencao`: HMAC, primeira observação e último faturamento. Sem documento/nome/endereço/contato, sem leitura por equipe/anon. Conservada para a poda de30dias e a API diária não reiniciarem o prazo e ressuscitarem dados expirados. A equipe não executa a rotina de expurgo diretamente.
- O receptor aceita payloads023/027/039 antigos. Depois de ativado HMAC, CPF sem chave nova/anterior conhecida não volta ao cadastro: a recepção acusa sucesso do processamento, mas pode armazenar menos linhas por retenção. `linhas` continua quantidade recebida, para preservar a confirmação do coletor. Antes da ativação, cadastro legado segue igual.
- Cadastro chegando depois do pedido completa a cópia por trigger; pedido novo de um CPF previamente expurgado volta a receber seus dados na próxima coleta diária permitida. Essa espera pode chegar ao dia seguinte; nenhum GET extra foi introduzido.
- Arquivo057 conserva comprovante e snapshot por1ano após último canhoto, inclusive CPF, sem copiar o documento. Anonimizar a fonte em180dias não apaga esse arquivo. A origem é registrada como `cadastro`.
- Não há coordenadas confirmadas de CPF na fonte atual. Rota mantém endereço/bairro/cidade, sem estimar pino, e o motorista navega pelo endereço no Maps/Waze. Dois pedidos sem documento continuam separados mesmo se nome/endereço coincidirem.
- Rollback058 com memória de retenção é recusado (`55006`), evitando reiniciar o prazo e reimportar expirados. Para recuar a UI/flags, manter058 e seu cron. Desinstalação completa só com memória vazia; arquivo057 é preservado.

## Conferências sem dados pessoais

Após publicar, conferir logs `OK clientes` e `OK pedidos`, contagens técnicas de chaves e o job. Não exportar documentos, cadastros completos, arquivo DPAPI ou URLs assinadas. Testes do pacote usam exclusivamente fixtures sintéticas e PG18/Chrome locais.
