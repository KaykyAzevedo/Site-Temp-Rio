# Sem SQL Server/rede/credenciais: leitor ADO real sobre DataTableReader e main -Simular.
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$repo=Split-Path (Split-Path $PSScriptRoot)
$arquivo=Join-Path $repo 'integracao/solidcon/sync-banco-verificar-nf550.ps1'
$tokens=$null;$erros=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($arquivo,[ref]$tokens,[ref]$erros)
if($erros.Count){throw ($erros|Out-String)}
. $arquivo
$n=0;function Check($ok,$msg){if(-not $ok){throw $msg};$script:n++}
# Guardas e leitores literalmente iguais aos publicados, sem importar/executar o coletor.
$base=[Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'integracao/solidcon/sync-banco.ps1'),[ref]$tokens,[ref]$erros)
foreach($nome in @('Campo','Ler-ConfigBanco','SecureString-DeBytes','Conferir-AclRestrita','Ler-SenhaBanco','Nova-ConexaoBanco','Ler-Linhas','Abrir-Sessao','Resumo-Permissoes','Fechar-Sessao','Descrever-Erro')){
 $a=$ast.FindAll({param($x)$x -is [Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -ceq $nome},$false)
 $b=$base.FindAll({param($x)$x -is [Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -ceq $nome},$false)
 Check ($a.Count -eq 1 -and $b.Count -eq 1 -and $a[0].Extent.Text.Replace("`r`n","`n") -ceq $b[0].Extent.Text.Replace("`r`n","`n")) ('paridade '+$nome)
}
foreach($nome in @('SqlSessao','SqlProtecoes','SqlPermissoes','EntropiaTexto','PrefixoArquivo','NomeArquivoSenha','ColunasPermissoes')){
 $a=$ast.EndBlock.Statements|Where-Object{$_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left -is [Management.Automation.Language.VariableExpressionAst] -and $_.Left.VariablePath.UserPath -ceq $nome}
 $b=$base.EndBlock.Statements|Where-Object{$_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left -is [Management.Automation.Language.VariableExpressionAst] -and $_.Left.VariablePath.UserPath -ceq $nome}
 Check ($a.Extent.Text.Replace("`r`n","`n") -ceq $b.Extent.Text.Replace("`r`n","`n")) ('paridade constante '+$nome)
}
Check ($SqlReferenciaNF550 -match 'f.cdPessoaFilial=n.cdPessoaFilial AND f.cdNota=n.cdNota' -and $SqlReferenciaNF550 -match 'i.cdPessoaFilial=n.cdPessoaFilial AND i.cdNota=n.cdNota') 'joins por chave composta filial+nota'
Check ($SqlReferenciaNF550 -match 'n.cdPessoaFilial=@filial' -and $SqlReferenciaNF550 -match 'i.nNF=@numero' -and $SqlReferenciaNF550 -match "LTRIM\(RTRIM\(i\.serie\)\) IN \('1','01','001'\)" -and $SqlReferenciaNF550 -match 'i.\[mod\]=@modelo' -and $SqlReferenciaNF550 -match 'i.tpNF=@saida') 'identidade fiscal requerida; serie1 textual compativel com ERP antigo'
Check ($SqlReferenciaNF550 -notmatch 'XML|Canhoto|image|Destinatario|CNPJ|CPF|NFeChave|Protocolo|SELECT\s+\*|\bSUM\(|\bMIN\(|\bMAX\(') 'sem campos sensiveis/valores brutos/XML/imagem'
Check ($SqlReferenciaNF550 -match 'valores_juntos' -and $SqlReferenciaNF550 -match 'ICMSTotvProd=@produtos AND f.ICMSTotvNF=@total AND f.ICMSTotvST=@st') 'tres valores conferem na mesma linha'
& (Join-Path $PSScriptRoot 'sqlserver-legado.ps1')
foreach($caso in @(@('1',$true),@('01',$true),@('001',$true),@(' 01 ',$true),@('2',$false),@('1x',$false),@('',$false),@('0001',$false))){
 Check ((@('1','01','001') -ccontains ([string]$caso[0]).Trim(' ')) -eq $caso[1]) ('serie textual permitida: ['+$caso[0]+']')
}

function CmdTabela($dt){
 $ado=New-Object Data.SqlClient.SqlCommand
 $cmd=[pscustomobject]@{Transaction=$null;CommandTimeout=0;CommandText='';Parameters=$ado.Parameters;Tabela=$dt}
 $cmd|Add-Member ScriptMethod ExecuteReader {if($script:falhaSQL){throw 'simulada'};return ,$this.Tabela.CreateDataReader()}
 $cmd|Add-Member ScriptMethod Dispose {$script:cmdDescartado=$true}
 return $cmd
}
# Repro das duas falhas da descoberta anterior, com multiplos objetos e leitor original real.
$dt=New-Object Data.DataTable
foreach($c in @('esquema','objeto','coluna','tipo')){[void]$dt.Columns.Add($c,[string])}
[void]$dt.Rows.Add('dbo','tbNota','Numero','int');[void]$dt.Rows.Add('dbo','tbNotaFiscal','ICMSTotvProd','money')
$script:cmdMeta=CmdTabela $dt;$script:falhaSQL=$false
function Ler-MetaRegressao {return ,(Ler-Linhas $script:cmdMeta @('esquema','objeto','coluna','tipo') 10)}
$velho=@(Ler-MetaRegressao);Check ($velho.Count -eq 1 -and $velho[0] -is [array]) 'repro @() aninha array do leitor'
$plano=Ler-MetaRegressao;Check ($plano.Count -eq 2 -and $plano[0] -is [hashtable]) 'atribuicao direta preserva2linhas reais'
$gruposRuins=@($plano|Group-Object esquema,objeto -CaseSensitive)
Check ($gruposRuins.Count -eq 1 -and $gruposRuins[0].Count -eq 2) 'repro Group-Object nao usa chaves de Hashtable'
$gruposBons=@($plano|ForEach-Object{[pscustomobject]$_}|Group-Object esquema,objeto -CaseSensitive)
Check ($gruposBons.Count -eq 2) 'PSCustomObject separa objetos se catalogo precisar agrupar'

function Abrir-Sessao {
 $tx=[pscustomobject]@{Connection=$true}
 $tx|Add-Member ScriptMethod Rollback {$script:rollback=$true}
 $tx|Add-Member ScriptMethod Dispose {$script:txDescartada=$true}
 $con=New-Object PSObject
 $con|Add-Member ScriptMethod CreateCommand {
  $dt=New-Object Data.DataTable
  foreach($c in $ColunasReferenciaNF550){[void]$dt.Columns.Add($c,[long])}
  $valores=@();foreach($c in $ColunasReferenciaNF550){$valores+=[long]$script:cenario[$c]}
  [void]$dt.Rows.Add($valores)
  if($script:duplicarResultado){[void]$dt.Rows.Add($valores)}
  $script:cmdNF=CmdTabela $dt;return $script:cmdNF
 }
 $con|Add-Member ScriptMethod Dispose {$script:conDescartada=$true}
 $script:txNF=$tx;return @{simulada=$false;con=$con;tx=$tx}
}
$Testar=$true;$Simular=$false
function RodarCenario($valores){
 $script:cenario=$valores;$script:rollback=$false;$script:txDescartada=$false;$script:conDescartada=$false;$script:cmdDescartado=$false
 return ,@(Testar-ReferenciaNF550)
}
$bom=@{linhas=1;notas=1;produtos_conferem=1;total_confere=1;st_confere=1;valores_juntos=1;status_validos=1}
$script:duplicarResultado=$false
$saida=RodarCenario $bom
Check ($script:CodigoReferencia -eq 0 -and ($saida -join "`n") -match 'RESULTADO: REFERENCIA_CONFERE') 'leitura ADO real confirma referencia sem aninhar array'
Check ([object]::ReferenceEquals($script:cmdNF.Transaction,$script:txNF)) 'consulta na mesma transacao aberta'
Check ($script:rollback -and $script:txDescartada -and $script:conDescartada -and $script:cmdDescartado) 'sucesso fecha leitor/comando e rollback/conexao'
$p=$script:cmdNF.Parameters
Check ($p['@filial'].Value -eq 4 -and $p['@numero'].Value -eq 550 -and $p['@serie'].Value -eq 1 -and $p['@modelo'].Value -ceq '55' -and $p['@saida'].Value -eq $true) 'parametros fiscais exatos'
Check ($p['@modelo'].SqlDbType -eq [Data.SqlDbType]::Char -and $p['@modelo'].Size -eq 2 -and $p['@saida'].SqlDbType -eq [Data.SqlDbType]::Bit) 'tipos modelo char e saida bit'
Check ($p['@produtos'].Value -eq [decimal]21643.20 -and $p['@total'].Value -eq [decimal]24211.21 -and $p['@st'].Value -eq [decimal]2334.58 -and $p['@produtos'].Scale -eq 4) 'tres valores decimais exatos'
Check ($p['@emissao'].Value -eq [datetime]'2026-06-25' -and $p['@emissao_ate'].Value -eq [datetime]'2026-06-26') 'dia de emissao SP inclusivo/exclusivo'
foreach($campo in @('linhas','valores_juntos','status_validos')){
 $v=$bom.Clone();if($campo -ceq 'linhas'){$v[$campo]=2}else{$v[$campo]=0}
 $null=RodarCenario $v;Check ($script:CodigoReferencia -eq 2 -and $script:rollback) ('divergencia/ambiguidade preserva rollback: '+$campo)
}
$zero=@{};foreach($c in $ColunasReferenciaNF550){$zero[$c]=0};$null=RodarCenario $zero
Check ($script:CodigoReferencia -eq 2 -and $script:rollback) 'nenhuma nota nao vira sucesso'
$script:duplicarResultado=$true
$erroLeitura=$null;try{$null=RodarCenario $bom}catch{$erroLeitura=$_}
Check ($null -ne $erroLeitura -and $erroLeitura.Exception.Message -ceq 'linhas-demais' -and $script:rollback -and $script:conDescartada -and $script:cmdDescartado) 'resultado inesperado e recusado e fecha transacao'
$script:duplicarResultado=$false;$script:falhaSQL=$true
$erroLeitura=$null;try{$null=RodarCenario $bom}catch{$erroLeitura=$_}
Check ($null -ne $erroLeitura -and $erroLeitura.Exception.ToString() -match 'simulada' -and $script:CodigoReferencia -eq 2 -and $script:rollback -and $script:conDescartada -and $script:cmdDescartado) 'erro SQL nao vira sucesso e fecha mesma transacao'
$script:falhaSQL=$false

# Processo filho testa entrada inteira com mutex/filelock, sem SQL Server/Supabase.
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sentinela-nf550-'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($pasta)|Out-Null
$config=Join-Path $pasta 'config.json';$out=Join-Path $pasta 'saida';[IO.Directory]::CreateDirectory($out)|Out-Null
@{modo='real';pastaSaida=$out;banco=@{servidor='localhost';base='qa_offline';usuario='qa'}}|ConvertTo-Json|Set-Content -LiteralPath $config -Encoding UTF8
$copia=Join-Path $pasta 'copia independente.ps1';Copy-Item -LiteralPath $arquivo -Destination $copia
$resultado=@(& powershell.exe -NoProfile -File $copia -Config $config -Testar -Simular)
Check ($LASTEXITCODE -eq 0 -and ($resultado -join "`n") -match 'SIMULACAO SINTETICA' -and ($resultado -join "`n") -match 'REFERENCIA_CONFERE') 'main independente em PS5.1, renomeado e sem dependencias locais'
$arquivos=@(Get-ChildItem -LiteralPath $out -File);Check ($arquivos.Count -eq 1 -and $arquivos[0].Name -ceq 'sync-banco.lock') 'so trava; sem agenda/estado/log/Supabase'
$trava=[IO.File]::Open((Join-Path $out 'sync-banco.lock'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try{$ocupado=@(& powershell.exe -NoProfile -File $copia -Config $config -Testar -Simular);Check ($LASTEXITCODE -eq 1 -and ($ocupado -join "`n") -match 'outra coleta esta ativa') 'lock ocupado recusa antes de consultar'}finally{$trava.Dispose()}
$negado=@(& powershell.exe -NoProfile -File $copia -Config (Join-Path $pasta 'nao-existe.json') -Simular)
Check ($LASTEXITCODE -eq 1 -and ($negado -join "`n") -match 'parametro de consulta invalido' -and ($negado -join "`n") -notmatch 'REFERENCIA_CONFERE') 'sem-Testar recusa antes de tentar config inexistente'
"PASS $n checks NF550 PowerShell5.1; leitor real, mocks de conexao e main simulado; sem banco/rede"
