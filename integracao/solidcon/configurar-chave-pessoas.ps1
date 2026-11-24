#requires -Version 5.1
[CmdletBinding()]param([string]$Arquivo)
$ErrorActionPreference='Stop'
# PS5.1 ainda nao preenche PSScriptRoot ao avaliar defaults do param.
if(-not $PSBoundParameters.ContainsKey('Arquivo')){$Arquivo=Join-Path $PSScriptRoot 'pessoas-chave.dpapi'}
. (Join-Path $PSScriptRoot 'pessoas-pedido.ps1')
Add-Type -AssemblyName System.Security
$identidade=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identidade)
if(-not $identidade.IsSystem -and -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Execute como administrador ou SYSTEM; nenhuma chave foi criada.'}
if(-not [IO.Path]::IsPathRooted($Arquivo)){throw 'Informe caminho absoluto'}
if(Test-Path -LiteralPath $Arquivo){$c=Ler-ChavePessoas $Arquivo;[Array]::Clear($c,0,$c.Length);Write-Output 'Chave existente validada; nao foi rotacionada.';exit 0}
$chave=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
try {
 $rng.GetBytes($chave)
 $enc=[Security.Cryptography.ProtectedData]::Protect($chave,[Text.Encoding]::UTF8.GetBytes('TempRio/pessoas/hmac/v1'),[Security.Cryptography.DataProtectionScope]::LocalMachine)
 $acl=New-Object Security.AccessControl.FileSecurity
 $acl.SetAccessRuleProtection($true,$false)
 foreach($sid in @('S-1-5-18','S-1-5-32-544')){
  $regra=New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)),'FullControl','Allow');$acl.AddAccessRule($regra)
 }
 # CreateNew + ACL na criacao: nao sobrescreve segredo existente nem cria janela de ACL ampla.
 $fs=New-Object IO.FileStream($Arquivo,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$acl)
 try{$b=[Text.Encoding]::UTF8.GetBytes('temprio-pessoas-v1:'+[Convert]::ToBase64String($enc));$fs.Write($b,0,$b.Length);$fs.Flush($true)}finally{$fs.Dispose()}
 Write-Output 'Chave criada com DPAPI da maquina e ACL SYSTEM/Administradores. Use o mesmo arquivo nos dois coletores; nao rotacione.'
} finally{[Array]::Clear($chave,0,$chave.Length);$rng.Dispose()}
