$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$repo=Split-Path (Split-Path $PSScriptRoot)
. (Join-Path $repo 'integracao/solidcon/pessoas-pedido.ps1')
$n=0;function Check($ok,$m){if(-not $ok){throw $m};$script:n++}
$key=[byte[]](0..31)
$h=Hmac-PessoaPedido '01234567890' $key
Check ($h -ceq '736468c578d422d3cb9514dd3a2e22bb3d4a153f50b54bd991498857027c20f1') 'vetor HMAC fixo'
Check ((Hmac-PessoaPedido '01234567890' ([byte[]](1..32))) -cne $h) 'segredo diferente altera identificador'
Check ((Documento-PessoaPedido '1234567890').documento -ceq '01234567890') 'zero CPF canonico'
Check ((Documento-PessoaPedido '11222333000181').tipo -ceq 'cnpj') 'CNPJ nao vira CPF'
Check ((Pessoas-PedidoAtivo ([pscustomobject]@{})) -eq $false) 'flag desligada por padrao'
Check ((Caminho-ChavePessoas ([pscustomobject]@{}) 'C:/TempRio/solidcon') -match 'pessoas-chave.dpapi$') 'caminho comum nao depende nome do coletor'
Add-Type -AssemblyName System.Security
$entropia=[Text.Encoding]::UTF8.GetBytes('TempRio/pessoas/hmac/v1')
$enc=[Security.Cryptography.ProtectedData]::Protect($key,$entropia,[Security.Cryptography.DataProtectionScope]::LocalMachine)
$dec=[Security.Cryptography.ProtectedData]::Unprotect($enc,$entropia,[Security.Cryptography.DataProtectionScope]::LocalMachine)
Check ([BitConverter]::ToString($dec) -ceq [BitConverter]::ToString($key)) 'DPAPI LocalMachine ida/volta em memoria'
[Array]::Clear($dec,0,$dec.Length)
foreach($name in @('sync-banco.ps1','sync-produtos.ps1')){
 $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $repo ('integracao/solidcon/'+$name)),[ref]$tokens,[ref]$errors)
 Check ($errors.Count -eq 0) ('parse '+$name)
 $ast.FindAll({param($x)$x -is [Management.Automation.Language.FunctionDefinitionAst]},$false)|ForEach-Object {Invoke-Expression $_.Extent.Text}
}
$Invariant=[Globalization.CultureInfo]::InvariantCulture
$json='[{"cpf":1234567890,"tipo":"cpf","nome":"Pessoa Ficticia","endereco":{"logradouro":"Rua QA","numero":"20","complemento":"Casa","cep":"01001-000","bairro":"Centro","cidade":"Sao Paulo","estado":"SP"}}]'
$antigo=Normalizar-Clientes $json
$novo=Normalizar-Clientes $json $key
Check ($antigo.itens[0].logradouro -eq $null -and -not $antigo.itens[0].Contains('pessoa_chave')) 'cadastro antigo preservado'
Check ($novo.itens[0].logradouro -ceq 'Rua QA' -and $novo.itens[0].cep -ceq '01001000' -and $novo.itens[0].pessoa_chave -ceq $h) 'cadastro CPF endereco e HMAC opcionais'
$EtapasPedido=@('aberto','na_carga','separando','separado','conferido','saiu','atendido');$EnviarCaixas=$false
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'integracao/solidcon/sync-banco.ps1'),[ref]$tokens,[ref]$errors)
$ast.FindAll({param($x)$x -is [Management.Automation.Language.FunctionDefinitionAst]},$false)|ForEach-Object {Invoke-Expression $_.Extent.Text}
$l=@{cd_pedido=1;dt_pedido=[datetime]'2026-11-24';dt_atendido=$null;cd_carga=$null;dt_carga=$null;dt_partida=$null;dt_nota=$null;dt_cancelada=$null;dt_sep_inicio=$null;dt_sep_fim=$null;dt_conferencia=$null;dt_carregou=$null;saidas_abertas=$null;cd_cliente=42}
$r=Normalizar-Pedidos @($l) @(@{codigo_parceiro=42;documento='1234567890'}) $null $null $key
Check ($r.itens[0].cliente_tipo -ceq 'cpf' -and $r.itens[0].pessoa_chave -ceq $h -and $null -eq $r.itens[0].documento) 'pedido liga CPF com zero sem enviar documento'
Check (($r.itens|ConvertTo-Json -Depth 10 -Compress) -notmatch '01234567890|1234567890|Pessoa Ficticia|Rua QA') 'payload pedido nao contem documento/nome/endereco'
# Leitura/DPAPI de arquivo sintetico; ACL consultada por stub (terminal nao elevado).
# O provisionador real foi verificado recusando terminal nao administrador.
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sentinela-cpf-flow-'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($pasta)|Out-Null
$arqChave=Join-Path $pasta 'chave.dpapi';[IO.File]::WriteAllText($arqChave,'temprio-pessoas-v1:'+[Convert]::ToBase64String($enc))
$script:aclFake=New-Object Security.AccessControl.FileSecurity;$script:aclFake.SetAccessRuleProtection($true,$false)
$script:aclFake.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-18')),'FullControl','Allow')))
function Get-Acl { param($LiteralPath) return $script:aclFake }
$lida=Ler-ChavePessoas $arqChave
Check ([BitConverter]::ToString($lida) -ceq [BitConverter]::ToString($key)) 'arquivo DPAPI/formato/header roundtrip com ACL stub'
[Array]::Clear($lida,0,$lida.Length)
# Fluxo real de clientes (sem main), arquivo sintetico e modo teste: dot-source/HMAC/saida funcionam.
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'integracao/solidcon/sync-produtos.ps1'),[ref]$tokens,[ref]$errors)
$ast.FindAll({param($x)$x -is [Management.Automation.Language.FunctionDefinitionAst]},$false)|ForEach-Object {Invoke-Expression $_.Extent.Text}
$Pasta=$pasta;$PastaColetor=Join-Path $repo 'integracao/solidcon';$Real=$false;$BackfillDias=0;$ArquivoClientes=Join-Path $pasta 'clientes.json'
$Utf8=New-Object Text.UTF8Encoding($false);$Cfg=[pscustomobject]@{pessoas_pedido=$true;chave_pessoas_arquivo=$arqChave;modo='teste'}
[IO.File]::WriteAllText($ArquivoClientes,$json);$null=Sincronizar-Clientes
Check (-not $script:ClientesFalhou) 'fluxo clientes com flagtrue/helper local funciona sem rede'
$gravado=Get-Content -LiteralPath (Join-Path $pasta 'clientes-normalizados.json') -Raw -Encoding UTF8|ConvertFrom-Json
Check ($gravado.itens[0].pessoa_chave -ceq $h -and $gravado.itens[0].logradouro -ceq 'Rua QA') 'fluxo grava apenas fixture CPF+HMAC esperada'
"PASS $n checks pessoas/coletores offline"
