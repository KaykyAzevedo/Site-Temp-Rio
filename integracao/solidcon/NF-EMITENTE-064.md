# NF-e por emitente — migração 064

## Problema

`tbNota` com `tpNF=1` (saída) inclui NF-e de **terceiros**: compras importadas, que o
fornecedor emitiu como saída dele. Até a 060/062 elas entravam como venda e o fornecedor
virava "cliente" (ex.: um fornecedor de grãos aparecia como maior cliente).

## Regra (decisão do dono, 25/11)

Guardar tudo, cada nota no seu lugar. A classe é uma coluna gerada em `solidcon_vendas_nf`:

| classe | quando | onde aparece |
|---|---|---|
| `venda` | emitente = nosso CNPJ e natureza sem "Bonifica" | total do cliente, mapa, rankings |
| `bonificacao` | emitente = nosso CNPJ e natureza com "Bonifica" (sem diferenciar maiúsculas) | à parte, no detalhe do cliente; **não soma** |
| `compra` | emitente ≠ nosso CNPJ | seção "Notas de fornecedores / compras" (Clientes → Fornecedores) |
| `legado` | linha gravada pelo coletor antigo (sem emitente) | soma como antes, até o reenvio do histórico |

A exclusão manual de `solidcon_fornecedores` continua valendo como segunda proteção.

## Coletor (`sync-banco.ps1`)

- `nf.lista` ganhou `LEFT JOIN dbo.tbNotaFiscalEmitente AS e` por **filial+nota** (só `e.CNPJ`)
  e `i.natOp`. A whitelist das NF (`$TabelasNF`) ganhou essa tabela, e só ela. `nf.clientes` não mudou.
  Continua sem funções novas de SQL (nada de TRY_CONVERT/IIF/CONCAT…), sem XML e sem imagem.
- `cnpj_emitente` no `config-banco.json` (14 dígitos, CNPJ válido) é **obrigatório** com
  `nf_saida=true` ou `-TestarNF`. Sem ele a execução para antes de abrir o banco.
- Cada nota envia mais 4 campos: `emitente` (só dígitos), `natureza` (aparada, sem caracteres de controle, até 60),
  `bonificacao` e `proprio`.
- Para nota de terceiro, o `documento` enviado é o próprio emitente. Se o parceiro (`cdPessoaComercial`)
  tiver outro CNPJ, isso só é **contado** em `terceiro_parceiro_difere`, para conferência.
- Uma nota sem emitente válido (sem linha no LEFT JOIN, ou CNPJ inválido) **recusa a janela inteira**,
  com o motivo `NF sem emitente…`. A janela que já estava gravada fica como estava.
- O log continua só com contagens: `venda= bonificacao= terceiros= terceiro_parceiro_difere=`.

## Supabase (064)

- Migração aditiva. As colunas novas aceitam nulo (= `legado`), com uma restrição de coerência:
  ou as 4 vêm juntas ou nenhuma vem, e `bonificacao` tem de bater com a natureza.
- `solidcon_receber_vendas_nf` aceita dois formatos, nunca misturados no mesmo envio:
  - **antigo** (11 campos): aceito só enquanto nenhuma nota tiver emitente. Depois disso responde
    `coletor_antigo` e não mexe em nada (reinstalar ou repetir o coletor velho não apaga a classificação).
    Janela vazia é aceita nos dois formatos.
  - **064** (15 campos): recusa com `emitente_invalido`, `natureza_invalida` ou `emitente_inconsistente`.
    Este último cobre: dois CNPJs "nossos" no mesmo envio, um CNPJ nosso diferente do que já está gravado,
    ou um terceiro com o nosso CNPJ.
  - O resto continua igual: a janela é substituída por inteiro, há proteção contra snapshot antigo e
    o replay é idempotente.
- `solidcon_ler_vendas_nf()` mantém o contrato. `notas` traz só `venda` e `legado`, então o painel antigo já soma certo.
  Chaves novas: `bonificacoes` e `legado` (quantas notas ainda faltam reenviar).
- `solidcon_ler_compras_nf()` (stable/invoker, só equipe) devolve `fornecedores` (total por emitente),
  `notas` (até 5000), `legado` e `truncado`.
- `solidcon_mapa_clientes()` = 062 somando só as NF `venda`/`legado`.
- Rollback `064_rollback.sql`: devolve exatamente o receber da 060, o ler e o mapa da 062, e remove o
  `ler_compras`. Colunas e dados ficam. O coletor tem de voltar junto, porque o RPC da 060 recusa os
  campos novos com `campos_invalidos`, sem apagar nada.

## Roteiro (só Tech Lead/dono, depois da revisão)

Ordem obrigatória: 062 aplicada → 064 → coletor novo → teste → reenvio do histórico → painel.

1. No SQL Editor, aplicar `admin/migracoes/064_nf_emitente.sql`. Ela recusa se a 062 não estiver aplicada.
   O coletor instalado continua funcionando, porque o formato antigo é aceito enquanto tudo é legado.
2. Pausar a tarefa e copiar **somente** o `sync-banco.ps1` novo para `C:\TempRio\solidcon\`. O hash tem de dar `49D8915EEE3496ECF9C31C5879D6C6F6CB28274D9E9049E380DF95FA987097D5`:

```powershell
Disable-ScheduledTask -TaskName 'TempRio SOLIDCON banco' | Out-Null
Copy-Item "$env:USERPROFILE\Downloads\sync-banco-nf064.ps1" 'C:\TempRio\solidcon\sync-banco.ps1' -Force
(Get-FileHash 'C:\TempRio\solidcon\sync-banco.ps1' -Algorithm SHA256).Hash
```

3. No `C:\TempRio\solidcon\config-banco.json`, acrescentar a linha abaixo, como texto entre aspas,
   mantendo todo o resto:
   `"cnpj_emitente": "63671696000106",`
4. Teste somente leitura dos últimos dias (não envia nada nem mexe na agenda):

```powershell
Set-Location 'C:\TempRio\solidcon'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\sync-banco.ps1 -Config .\config-banco.json -TestarNF
```

   Esperado: `OK nf ... venda=N bonificacao=N terceiros=N terceiro_parceiro_difere=N`.
   `ERRO nf fase=consulta motivo=NF sem emitente` = parar e trazer a saída.
   `terceiro_parceiro_difere` maior que 0 = trazer a saída (o parceiro não é o fornecedor emitente).
5. Reenviar o histórico (só o módulo NF, sem agenda) e reativar a tarefa:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\sync-banco.ps1 -Config .\config-banco.json -BackfillNFDesde 2026-05-29
Enable-ScheduledTask -TaskName 'TempRio SOLIDCON banco' | Out-Null
```

   Sucesso = saída 0 e uma linha `OK nf` por janela. A soma de `venda` desde 29/05 deve bater com
   cerca de 655 notas próprias (venda + bonificação) e `terceiros` com cerca de 66.
6. Conferir no SQL Editor: `select classe,count(*),sum(valor_centavos) from solidcon_vendas_nf group by 1;`
   Não pode sobrar nenhuma linha `legado`.
7. Publicar `js/admin.js` + `js/admin-compras.js` juntos e conferir no painel:
   - o fornecedor de grãos fora da lista de Clientes;
   - Clientes → Fornecedores → "Notas de fornecedores / compras";
   - a bonificação no detalhe de um cliente que tenha recebido uma.
