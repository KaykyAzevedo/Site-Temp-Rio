# Guard offline: ERP com compatibilidade <110. Nao conecta nem executa os coletores.
param([string[]]$Arquivos)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$repo=Split-Path (Split-Path $PSScriptRoot)
if(-not $PSBoundParameters.ContainsKey('Arquivos')){
 $Arquivos=@(Get-ChildItem -LiteralPath (Join-Path $repo 'integracao/solidcon') -Filter 'sync-*.ps1' -File | ForEach-Object {$_.FullName})
}
function Funcoes-IncompativeisSQL([string]$Sql){
 # Nomes em comentarios/literais nao sao chamadas SQL.
 $limpo=[regex]::Replace($Sql,"(?s)/\*.*?\*/|--[^\r\n]*|'(?:''|[^'])*'",' ')
 return @([regex]::Matches($limpo,'(?i)\b(TRY_CONVERT|TRY_CAST|IIF|CONCAT|FORMAT|EOMONTH)\s*\(') | ForEach-Object {$_.Groups[1].Value.ToUpperInvariant()})
}
$checks=0
foreach($nome in @('TRY_CONVERT','TRY_CAST','IIF','CONCAT','FORMAT','EOMONTH')){
 if(@(Funcoes-IncompativeisSQL ('SELECT '+$nome.ToLowerInvariant()+"`n(x) FROM dbo.t")).Count -ne 1){throw ('guard nao detectou '+$nome)}
 $checks++
}
if(@(Funcoes-IncompativeisSQL "SELECT 'FORMAT(x)', 1 /* TRY_CAST(x) */ -- IIF(x)`nFROM dbo.t").Count){throw 'falso positivo de literal/comentario'}
$checks++
$consultas=0
foreach($arquivo in $Arquivos){
 $tokens=$null;$erros=$null
 $ast=[Management.Automation.Language.Parser]::ParseFile($arquivo,[ref]$tokens,[ref]$erros)
 if($erros.Count){throw ('PS5.1 invalido: '+[IO.Path]::GetFileName($arquivo))}
 $literais=$ast.FindAll({param($x)
  ($x -is [Management.Automation.Language.StringConstantExpressionAst] -or $x -is [Management.Automation.Language.ExpandableStringExpressionAst]) -and
   $x.Value -match '(?i)\b(SELECT|WITH|FROM|WHERE|JOIN|DECLARE|EXECUTE|EXEC|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|SET)\b'
 },$true)
 foreach($sql in $literais){
  $ruins=@(Funcoes-IncompativeisSQL $sql.Value)
  if($ruins.Count){throw ('SQL incompativel: '+[IO.Path]::GetFileName($arquivo)+':'+$sql.Extent.StartLineNumber+' '+($ruins -join ','))}
  $consultas++
 }
 $checks++
}
if(-not $Arquivos.Count -or -not $consultas){throw 'nenhum script/SQL conferido'}
"PASS $checks checks SQL legado; $($Arquivos.Count) scripts sync-*; $consultas literais com palavras SQL; sem banco/rede"
