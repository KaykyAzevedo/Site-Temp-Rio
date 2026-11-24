# Regressao PS5.1: executa param+resolucao+dot-source reais em processo filho.
# Interrompe a copia temporaria antes de crypto/admin/gravacao; nunca cria/rotaciona chave.
# Rodar: powershell.exe -NoProfile -File supabase/tests/chave-pessoas-caminho.ps1
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$repo=Split-Path (Split-Path $PSScriptRoot)
$origem=Join-Path $repo 'integracao/solidcon'
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sentinela-caminho-chave '+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($pasta)|Out-Null
$teste=Join-Path $pasta 'provisionar copia.ps1'
$src=[IO.File]::ReadAllText((Join-Path $origem 'configurar-chave-pessoas.ps1'))
$marcador='Add-Type -AssemblyName System.Security'
if(([regex]::Matches($src,[regex]::Escape($marcador))).Count -ne 1){throw 'ponto de instrumentacao alterado'}
$sonda=@'
[Console]::WriteLine((@{arquivo=$Arquivo;helper=[bool](Get-Command Hmac-PessoaPedido -ErrorAction SilentlyContinue);versao=$PSVersionTable.PSVersion.ToString()}|ConvertTo-Json -Compress))
exit 0
'@
[IO.File]::WriteAllText($teste,$src.Replace($marcador,$sonda),(New-Object Text.UTF8Encoding($false)))
Copy-Item -LiteralPath (Join-Path $origem 'pessoas-pedido.ps1') -Destination $pasta
$n=0
function Check($ok,$msg){if(-not $ok){throw $msg};$script:n++}
function Rodar([string]$Extras=''){
 $pi=New-Object Diagnostics.ProcessStartInfo
 $pi.FileName=(Join-Path $PSHOME 'powershell.exe')
 $pi.Arguments='-NoProfile -File "'+$teste+'" '+$Extras
 $pi.WorkingDirectory=$repo # diferente da pasta do script; defaults nao podem usar o cwd.
 $pi.UseShellExecute=$false;$pi.CreateNoWindow=$true;$pi.RedirectStandardOutput=$true;$pi.RedirectStandardError=$true
 $p=New-Object Diagnostics.Process;$p.StartInfo=$pi
 try{
  [void]$p.Start();$saida=$p.StandardOutput.ReadToEnd();$erro=$p.StandardError.ReadToEnd();$p.WaitForExit()
  Check ($p.ExitCode -eq 0) ('processo PS5.1 falhou: '+$erro)
  return ($saida|ConvertFrom-Json)
 }finally{$p.Dispose()}
}
$padrao=Rodar
Check ($padrao.arquivo -ceq (Join-Path $pasta 'pessoas-chave.dpapi')) 'sem-Arquivo usa pasta do script, inclusive com espacos'
Check ($padrao.helper -eq $true) 'helper localizado junto ao provisionador'
Check ($padrao.versao.StartsWith('5.1.')) 'regressao executada no Windows PowerShell5.1'
$explicito=Join-Path $pasta 'chave personalizada.dpapi'
$r=Rodar ('-Arquivo "'+$explicito+'"')
Check ($r.arquivo -ceq $explicito) 'caminho absoluto explicito preservado'
Check (@(Get-ChildItem -LiteralPath $pasta -Filter '*.dpapi').Count -eq 0) 'nenhuma chave criada/lida/alterada'
# Previne repeticao em defaults de parametros do provisionador, helper e coletores.
foreach($nome in @('configurar-chave-pessoas.ps1','pessoas-pedido.ps1','sync-banco.ps1','sync-produtos.ps1')){
 $tokens=$null;$erros=$null
 $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $origem $nome),[ref]$tokens,[ref]$erros)
 Check ($erros.Count -eq 0) ('parse '+$nome)
 $ruins=@($ast.FindAll({param($x)
  $x -is [Management.Automation.Language.ParameterAst] -and $null -ne $x.DefaultValue -and
  @($x.DefaultValue.FindAll({param($v)$v -is [Management.Automation.Language.VariableExpressionAst] -and $v.VariablePath.UserPath -ieq 'PSScriptRoot'},$true)).Count -gt 0
 },$true))
 Check ($ruins.Count -eq 0) ('PSScriptRoot em default de parametro: '+$nome)
}
"PASS $n checks caminho/provisionador em Windows PowerShell5.1; sem chave/rede/banco"
