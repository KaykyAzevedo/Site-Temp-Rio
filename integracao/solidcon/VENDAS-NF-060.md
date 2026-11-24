# NF-e de saída — 1B(c), migração060

Base publicada:280c167 (Pronto p/ despacho059 concluído). Entrega para revisão,
sem commit/publicação por Sentinela. Nenhum acesso ao ERP/projeto nos testes locais.

## Fonte e regras

NF550 foi confirmada pelo dono no servidor:1nota/1join, produtos21643,20,
total24211,21,ST2334,58. A divergência dos três flags decorre de NULL; o dono
confirmou NULL=0. O diagnóstico aprovado de hash3065318C é mantido intacto.

O módulo `nf` usa SELECT fixo, filial4, `tbNota n JOIN tbNotaFiscal f JOIN
tbNotaFiscalIdentificacao i` por **filial+cdNota**, `mod='55'`, `tpNF=1`.
Flags `inCancelada/inDenegada/inRejeitada`: `ISNULL(...,0)=0`.
Venda normal: `ISNULL(finNFe,1)=1`; complementares2, ajustes3 e devoluções4
ficam fora deste histórico de compras (revisar essa escolha antes de ativar se
a operação usa complementares para receita de produtos).
Os códigos de finalidade seguem a [NT2013.005, campo B25](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=sddBHHvutwY%3D);
o recorte comercial adotado aqui é uma decisão deste pacote, destacada para revisão.

Data=`i.dEmi` no fusoSP, número=`i.nNF`, série aparada textual, pedido=`n.cdPedido`.
Cliente via `n.cdPessoaComercial -> VW_MGN_PARCEIRO`; apenas CNPJ válido é enviado.
CPF/nome/endereço/XML/imagem/protocolo/chave fiscal não são coletados por este módulo.
Somas usam **f.ICMSTotvProd**, em centavos. Detalhe guarda também `ICMSTotvNF`
e `ICMSTotvST`; ST NULL permanece desconhecida, mostrada como “Não informado”.
Valores desconhecidos dos produtos/total, valores negativos, duplicatas ou teto
de linhas recusam a janela inteira; não enviam valor0 inventado.

`inNFeCupom=1` é tratado conservadoramente como vínculo ao PDV: nota é guardada e
mostrada no detalhe, mas sua venda é somada pelos cupons, sem repetir pelo ladoNF.
Se não houver cupom equivalente no lote carregado, o painel avisa; não inventa
associação fiscal. Não se casa uma NF normal com um cupom independente apenas por
terem valor igual. **A interpretação desse flag precisa ser conferida na revisão**:
o catálogo confirmou nome/tipo, não trouxe a semântica operacional de todas as linhas.

## Coleta e consistência

- `nf_saida` é booleano e desliga por padrão. Não altera os outros módulos.
- Intervalo nominal60min, erro15min (mesmo agendador/mutex/filelock publicados).
- Normal revalida todo o histórico desde29/05/2026, limitado à retenção400dias,
  em janelas de até31datas. Assim um cancelamento antigo pode remover a venda.
- Cada janela lê notas+parceiros na **mesma sessão/transação READ UNCOMMITTED**,
  ApplicationIntent=ReadOnly; rollback/fechamento antes de enviar ao Supabase.
- SQL legado: sem TRY_CONVERT/TRY_CAST/IIF/CONCAT/FORMAT/EOMONTH. As três tabelas
  novas só são permitidas para `nf.*`; a whitelist de pedidos não foi ampliada.
- RPC `solidcon_receber_vendas_nf`: integração autenticada autorizada, lock5100/60,
  validação estrita, substituição atômica do intervalo inclusive vazio, proteção
  contra snapshot antigo e replay idempotente. Chave=`cdNota` dentro da filial fixa4.
- `solidcon_vendas_nf_dias` marca dias completos inclusive sem NF. Não usar ausência
  de linhas como ausência de coleta. A RPC de leitura **stable/invoker**
  `solidcon_ler_vendas_nf()` devolve notas+coverage no mesmo snapshot, sob RLS equipe.
- Painel: PDV+NF oficial; fallback1A só nos dias não cobertos, e nunca repete um
  pedido já vinculado a uma NF existente. Dia coberto vazio não ressuscita cancelada.
- Detalhe: todas as NF do período carregado acessíveis por busca de nota/série/pedido
  e paginação25 local. Totais do cliente não mudam ao filtrar essa lista.
- Enquanto faltar cobertura, aviso com o número de dias ainda não consultados;
  não apresentar o histórico de6meses como completo antes de concluir o backfill.
- Leitura NF limitada a20000notas/402dias: teto ou erro recusa total parcial.
  RPC ausente usa1A; timeout/permissão/retorno inválido não faz fallback silencioso.
- Retenção400dias SP na RPC e job diário `solidcon-vendas-nf-retencao` (pg_cron).
  Logs técnicos90dias; limpeza usa try-advisory-lock. Sem pg_cron, RPC também limpa,
  mas o job deve ser configurado antes de publicar.

## Rollout — só Tech Lead/dono após revisão

1. Aplicar `admin/migracoes/060_solidcon_vendas_nf.sql`. Conferir tabelas3, RLS3,
   RPCs ler/receber, helperlimpar, ausência de SELECT anon e apenas1job do nome acima.
2. Copiar **somente** `sync-banco.ps1` novo para `C:\TempRio\solidcon\`, preservando
   config-banco.json, config.json, senha DPAPI, chave HMAC, helpers e agenda existentes.
   Não copiar o diagnóstico NF550 por cima do coletor. Não mexer no banco ERP.
3. Teste somente leitura dos últimos3dias (sem envio/agenda/dados em arquivo;
   mantém o log técnico padrão de contagens):

```powershell
Set-Location 'C:\TempRio\solidcon'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\sync-banco.ps1 -Config .\config-banco.json -TestarNF
```

4. No **config-banco.json**, acrescentar `"nf_saida": true` (booleano, não string),
   mantendo `modo: "real"` e todos os demais valores. Não alterar o config da API.
   Rodar o backfill isolado; ele não muda agenda nem executa os outros módulos:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\sync-banco.ps1 -Config .\config-banco.json -BackfillNFDesde 2026-05-29
```

Sucesso=saída0 e linhas `OK nf` para todas as janelas. Falha do módulo=saída6;
janela anterior permanece. Se outra coleta ocupa trava, esperar/repetir, não matar
a tarefa de produção. Normal continua na agenda existente de5min; NF roda no
intervalo próprio, os módulos anteriores mantêm seus intervalos.

5. Publicar `js/admin.js` + `js/admin-compras.js` juntos. Não há redeploy de Edge
   neste pacote. Conferir NF550 no detalhe: produtosR$21.643,20; totalR$24.211,21;
   STR$2.334,58; pedido538;25/06/2026. Conferir cada CNPJ da rede separadamente.
   Conferir `nf_cupom` e o aviso de cupons equivalentes antes de aceitar o total.

Sem060 o painel mantém1A explicitamente; tabelaNF vazia/sem cobertura mantém
fallback nas lacunas até a carga. O backfill é recomendado antes de publicar UI.

## Reversão

Desligar `nf_saida`, restaurar coletor/site da base280c167 e aplicar
`060_rollback.sql`. Ele remove RPCs/job, **preserva notas, cobertura e logs**
para auditoria/reaplicação. Durante reversão o expurgo automático desse módulo
fica desligado; reativar060 ou programar limpeza antes de manter o arquivo parado.

## Testes locais reproduzíveis

```powershell
powershell.exe -NoProfile -File supabase/tests/sqlserver-legado.ps1
powershell.exe -NoProfile -File supabase/tests/nf550-verificacao.ps1
powershell.exe -NoProfile -File supabase/tests/vendas-nf.ps1
node --test --test-concurrency=1 supabase/tests/*.test.js
node supabase/tests/vendas-nf.browser.cjs
```

PG18: `vendas-nf.sql` exige127.0.0.1 e DB`sentinela_nf_*`; usar DB nova vazia.
`vendas-nf-concorrencia.ps1 -Banco sentinela_nf_04` exige o mesmo host/port55439,
depois da fixture. São testes isolados; nunca apontar para o projeto.
