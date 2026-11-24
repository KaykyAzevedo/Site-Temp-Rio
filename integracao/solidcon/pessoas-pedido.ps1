# Funcoes compartilhadas. Nenhuma rede/efeito ao carregar; segredo somente no servidor.
function Hmac-PessoaPedido([string]$Cpf, [byte[]]$Chave) {
    if ($Cpf -cnotmatch '^[0-9]{11}$' -or $null -eq $Chave -or $Chave.Length -ne 32) { throw 'pessoas-chave-invalida' }
    $h = New-Object Security.Cryptography.HMACSHA256
    try {
        $h.Key = $Chave
        return ([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes('TempRio/pessoa/cpf/v1:' + $Cpf)))).Replace('-','').ToLowerInvariant()
    } finally { $h.Dispose() }
}
function Documento-PessoaPedido([string]$Digitos) {
    if ($Digitos -cnotmatch '^[0-9]{1,14}$') { return @{tipo='indefinido'; documento=$null} }
    # View nao informa tipo: <=11 continua pessoa fisica como no coletor anterior.
    # Nunca promover um possivel CPF a CNPJ por coincidencia de DV. So recupera zero do CPF.
    if($Digitos.Length -gt 11){return @{tipo='cnpj';documento=$Digitos.PadLeft(14,[char]'0')}}
    return @{tipo='cpf';documento=$Digitos.PadLeft(11,[char]'0')}
}
function Caminho-ChavePessoas($Cfg, [string]$Diretorio) {
    $p=$Cfg.PSObject.Properties['chave_pessoas_arquivo']
    $arq=if($null -ne $p -and $p.Value){[string]$p.Value}else{Join-Path $Diretorio 'pessoas-chave.dpapi'}
    if(-not [IO.Path]::IsPathRooted($arq)){throw 'pessoas-chave-caminho'}
    return [IO.Path]::GetFullPath($arq)
}
function Ler-ChavePessoas([string]$Arquivo) {
    Add-Type -AssemblyName System.Security
    $acl=Get-Acl -LiteralPath $Arquivo
    if(-not $acl.AreAccessRulesProtected){throw 'pessoas-chave-acl'}
    foreach($r in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -cnotin @('S-1-5-18','S-1-5-32-544')){throw 'pessoas-chave-acl'}
    }
    try {$texto=[IO.File]::ReadAllText($Arquivo)} catch {throw 'pessoas-chave-acesso'}
    if(-not $texto.StartsWith('temprio-pessoas-v1:')){throw 'pessoas-chave-formato'}
    $entropia=[Text.Encoding]::UTF8.GetBytes('TempRio/pessoas/hmac/v1')
    $chave=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($texto.Substring(19)),$entropia,[Security.Cryptography.DataProtectionScope]::LocalMachine)
    if($chave.Length -ne 32){[Array]::Clear($chave,0,$chave.Length);throw 'pessoas-chave-invalida'}
    return ,$chave
}
function Pessoas-PedidoAtivo($Cfg) {
    $p=$Cfg.PSObject.Properties['pessoas_pedido'];if($null -eq $p){return $false}
    if($p.Value -isnot [bool]){throw 'pessoas_pedido deve ser true ou false'}
    return ($p.Value -eq $true)
}
