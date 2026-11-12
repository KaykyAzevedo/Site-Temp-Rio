#requires -Version 5.1
# Guarda a senha do login de CONSULTA do banco SOLIDCON para o sync-banco.ps1.
# Rodar UMA vez, como Administrador, no servidor. A senha e pedida numa janela do
# Windows (Get-Credential): nunca vai na linha de comando, no config-banco.json nem no log.
# Fica cifrada com DPAPI da MAQUINA (so decifra neste servidor) num arquivo da
# pasta de dados com acesso so de SYSTEM e Administradores.
#   Gravar:  configurar-senha-banco.ps1 [-Config C:\TempRio\solidcon\config-banco.json]
#   Testar:  configurar-senha-banco.ps1 -Testar   (conecta e faz SELECT 1; nao pede senha)
[CmdletBinding()]
param(
    [string]$Config = 'C:\TempRio\solidcon\config-banco.json',
    [switch]$Testar
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

# Mesmo valor no sync-banco.ps1. Nao e segredo (repo publico): so separa este
# arquivo de outros blobs DPAPI da maquina. A protecao real e DPAPI + ACL.
$EntropiaTexto = 'TempRio/solidcon/banco-senha/v1'
$PrefixoArquivo = 'temprio-dpapi-v1:'
$NomeArquivoSenha = 'banco-senha.dpapi'
$SidSystem = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$SidAdmins = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
# Permissoes EFETIVAS do login (base, schema, objeto, coluna, papeis). Qualquer 1 = pode gravar;
# NULL = nao deu para conferir. Os dois casos falham fechado. O login so enxerga objetos em que
# tem algum privilegio (visibilidade de metadados), justamente os que poderiam ser gravados.
# Mesmo texto no configurar-senha-banco.ps1. NAO substitui a confirmacao do DBA da SOLIDCON.
$SqlPermissoes = @'
SELECT
  SUM(CASE WHEN t.v = 1 THEN 1 ELSE 0 END) AS escrita,
  SUM(CASE WHEN t.v IS NULL THEN 1 ELSE 0 END) AS inconclusivo,
  COUNT(*) AS verificados
FROM (
  SELECT HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', p.n) AS v
    FROM (VALUES ('INSERT'),('UPDATE'),('DELETE'),('EXECUTE'),('ALTER'),('CONTROL'),('TAKE OWNERSHIP'),
                 ('CREATE TABLE'),('CREATE VIEW'),('CREATE PROCEDURE'),('CREATE FUNCTION'),('CREATE SCHEMA'),
                 ('ALTER ANY SCHEMA'),('ALTER ANY USER'),('ALTER ANY ROLE')) AS p(n)
  UNION ALL
  SELECT HAS_PERMS_BY_NAME(QUOTENAME(s.name), 'SCHEMA', p.n)
    FROM sys.schemas AS s
   CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('EXECUTE'),('ALTER'),('CONTROL'),('TAKE OWNERSHIP')) AS p(n)
  UNION ALL
  SELECT HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(o.schema_id)) + '.' + QUOTENAME(o.name), 'OBJECT', p.n)
    FROM sys.objects AS o
   CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('ALTER'),('CONTROL'),('TAKE OWNERSHIP')) AS p(n)
   WHERE o.type IN ('U', 'V')
  UNION ALL
  SELECT HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(o.schema_id)) + '.' + QUOTENAME(o.name), 'OBJECT', p.n)
    FROM sys.objects AS o
   CROSS JOIN (VALUES ('EXECUTE'),('ALTER'),('CONTROL'),('TAKE OWNERSHIP')) AS p(n)
   WHERE o.type IN ('P', 'PC', 'X')
  UNION ALL
  SELECT HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(o.schema_id)) + '.' + QUOTENAME(o.name), 'OBJECT', p.n)
    FROM sys.objects AS o
   CROSS JOIN (VALUES ('UPDATE'),('ALTER'),('CONTROL'),('TAKE OWNERSHIP')) AS p(n)
   WHERE o.type = 'SO'
  UNION ALL
  SELECT HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(o.schema_id)) + '.' + QUOTENAME(o.name), 'OBJECT', 'UPDATE', c.name, 'COLUMN')
    FROM sys.columns AS c
    JOIN sys.objects AS o ON o.object_id = c.object_id
   WHERE o.type IN ('U', 'V')
  UNION ALL
  SELECT CASE WHEN IS_SRVROLEMEMBER('sysadmin') = 1 THEN 1 WHEN IS_SRVROLEMEMBER('sysadmin') = 0 THEN 0 END
  UNION ALL
  SELECT CASE WHEN IS_ROLEMEMBER('db_owner') = 1 OR IS_ROLEMEMBER('db_datawriter') = 1 OR IS_ROLEMEMBER('db_ddladmin') = 1 THEN 1
              WHEN IS_ROLEMEMBER('db_owner') = 0 AND IS_ROLEMEMBER('db_datawriter') = 0 AND IS_ROLEMEMBER('db_ddladmin') = 0 THEN 0 END
) AS t
'@

function Campo($Objeto, [string]$Nome) {
    if ($null -eq $Objeto) { return $null }
    $p = $Objeto.PSObject.Properties[$Nome]
    if ($null -ne $p) { return $p.Value }
    return $null
}

function Ler-ConfigBanco([string]$Caminho) {
    $cfg = Get-Content -LiteralPath $Caminho -Raw -Encoding UTF8 | ConvertFrom-Json
    $pasta = [string](Campo $cfg 'pastaSaida')
    if ([string]::IsNullOrWhiteSpace($pasta) -or -not [IO.Path]::IsPathRooted($pasta)) { throw 'pastaSaida deve ser absoluta' }
    $banco = Campo $cfg 'banco'
    if ($null -eq $banco) { throw 'config sem a secao banco' }
    $servidor = [string](Campo $banco 'servidor')
    $base = [string](Campo $banco 'base')
    $usuario = [string](Campo $banco 'usuario')
    foreach ($v in @($servidor, $base, $usuario)) { if ($v -match 'PREENCHER') { throw 'secao banco do config-banco.json nao preenchida' } }
    # Nome/IP com porta ou instancia opcionais; nada de ; = ' ou espacos na string de conexao.
    if ($servidor -notmatch '^[A-Za-z0-9][A-Za-z0-9.\-]{0,252}(\\[A-Za-z0-9_$]{1,16})?(,[0-9]{1,5})?$') { throw 'banco.servidor invalido ou nao preenchido' }
    if ($base -notmatch '^[A-Za-z0-9_]{1,128}$') { throw 'banco.base invalida' }
    if ($usuario -notmatch '^[A-Za-z0-9_]{1,128}$') { throw 'banco.usuario invalido' }
    return @{
        servidor = $servidor; base = $base; usuario = $usuario
        pasta = [IO.Path]::GetFullPath($pasta)
        arquivoSenha = Join-Path ([IO.Path]::GetFullPath($pasta)) $NomeArquivoSenha
    }
}

function Bytes-DeSecureString([Security.SecureString]$Seguro) {
    # Copia UTF-16 direto da memoria nao gerenciada: a senha nunca vira [string].
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Seguro)
    try {
        $bytes = New-Object byte[] ($Seguro.Length * 2)
        [Runtime.InteropServices.Marshal]::Copy($ptr, $bytes, 0, $bytes.Length)
        return ,$bytes
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($ptr) }
}

function SecureString-DeBytes([byte[]]$Bytes) {
    $s = New-Object Security.SecureString
    for ($i = 0; $i -lt $Bytes.Length; $i += 2) { $s.AppendChar([char]([int]$Bytes[$i] -bor ([int]$Bytes[$i + 1] -shl 8))) }
    $s.MakeReadOnly()
    return $s
}

function Cifrar-Senha([Security.SecureString]$Seguro) {
    $claro = Bytes-DeSecureString $Seguro
    try {
        $entropia = [Text.Encoding]::UTF8.GetBytes($EntropiaTexto)
        $cifrado = [Security.Cryptography.ProtectedData]::Protect($claro, $entropia, [Security.Cryptography.DataProtectionScope]::LocalMachine)
        return $PrefixoArquivo + [Convert]::ToBase64String($cifrado)
    } finally { [Array]::Clear($claro, 0, $claro.Length) }
}

function Decifrar-Senha([string]$Texto) {
    $Texto = $Texto.Trim()
    if (-not $Texto.StartsWith($PrefixoArquivo, [StringComparison]::Ordinal)) { throw 'arquivo de senha em formato desconhecido' }
    $cifrado = [Convert]::FromBase64String($Texto.Substring($PrefixoArquivo.Length))
    $entropia = [Text.Encoding]::UTF8.GetBytes($EntropiaTexto)
    $claro = [Security.Cryptography.ProtectedData]::Unprotect($cifrado, $entropia, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    try {
        if ($claro.Length -eq 0 -or ($claro.Length % 2) -ne 0) { throw 'senha decifrada invalida' }
        return SecureString-DeBytes $claro
    } finally { [Array]::Clear($claro, 0, $claro.Length) }
}

function Nova-AclRestrita {
    # Sem heranca; somente SYSTEM e Administradores (SIDs: independe do idioma do Windows).
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($SidSystem, $SidAdmins)) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')))
    }
    return $acl
}

function Conferir-AclRestrita([string]$Caminho) {
    $acl = [IO.File]::GetAccessControl($Caminho)
    if (-not $acl.AreAccessRulesProtected) { throw 'ACL do arquivo de senha herda permissoes' }
    foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($r.IdentityReference -ne $SidSystem -and $r.IdentityReference -ne $SidAdmins) { throw 'ACL do arquivo de senha tem outra conta' }
    }
}

function Gravar-ArquivoSenha([string]$Caminho, [string]$Conteudo) {
    $pasta = Split-Path -Parent $Caminho
    [IO.Directory]::CreateDirectory($pasta) | Out-Null
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($Conteudo)
    # Recriado do zero (operacao manual unica; se cair no meio, e so rodar de novo).
    # O arquivo ja nasce com a ACL restrita: nao existe instante com a heranca da pasta.
    if ([IO.File]::Exists($Caminho)) { [IO.File]::Delete($Caminho) }
    $fs = [IO.File]::Create($Caminho, 4096, [IO.FileOptions]::WriteThrough, (Nova-AclRestrita))
    try { $fs.Write($bytes, 0, $bytes.Length) } finally { $fs.Dispose() }
    [IO.File]::SetAccessControl($Caminho, (Nova-AclRestrita))
    Conferir-AclRestrita $Caminho
}

function Nova-ConexaoBanco($Cb, [Security.SecureString]$Senha) {
    $b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
    $b['Data Source'] = $Cb.servidor
    $b['Initial Catalog'] = $Cb.base
    $b['Application Name'] = 'TempRio configurar-senha-banco'
    $b['ApplicationIntent'] = 'ReadOnly'
    $b['Connect Timeout'] = 10
    $b['Encrypt'] = $true
    $b['TrustServerCertificate'] = $true
    $b['Pooling'] = $false
    $cred = New-Object System.Data.SqlClient.SqlCredential($Cb.usuario, $Senha)
    return New-Object System.Data.SqlClient.SqlConnection($b.ConnectionString, $cred)
}

function Testar-Conexao($Cb) {
    if (-not [IO.File]::Exists($Cb.arquivoSenha)) { throw 'arquivo de senha nao existe; rode sem -Testar primeiro' }
    Conferir-AclRestrita $Cb.arquivoSenha
    $senha = Decifrar-Senha ([IO.File]::ReadAllText($Cb.arquivoSenha))
    $con = Nova-ConexaoBanco $Cb $senha
    try {
        $con.Open()
        $cmd = $con.CreateCommand()
        $cmd.CommandTimeout = 15
        $cmd.CommandText = 'SELECT 1'
        if ([int]$cmd.ExecuteScalar() -ne 1) { throw 'SELECT 1 sem resposta' }
        Write-Host ('OK: conectou e o SELECT 1 respondeu. Versao do SQL Server: ' + $con.ServerVersion)
        # Mesma conferencia do sync-banco: permissoes efetivas em base/schema/objeto/coluna/papeis.
        $cmd = $con.CreateCommand(); $cmd.CommandTimeout = 30; $cmd.CommandText = $SqlPermissoes
        $r = $cmd.ExecuteReader()
        try {
            if (-not $r.Read() -or $r.IsDBNull(0) -or $r.IsDBNull(1) -or $r.IsDBNull(2)) { $escrita = -1; $nulos = -1; $total = 0 }
            else { $escrita = [int]$r.GetValue(0); $nulos = [int]$r.GetValue(1); $total = [int]$r.GetValue(2) }
        } finally { $r.Close() }
        if ($escrita -gt 0) {
            Write-Host ('ATENCAO: o login PODE gravar (' + $escrita + ' permissoes de escrita encontradas). Peca a SOLIDCON para remover; o sync-banco se recusa a rodar assim.')
            return 3
        }
        if ($escrita -lt 0 -or $nulos -ne 0 -or $total -lt 17) {
            Write-Host 'ATENCAO: nao foi possivel confirmar que o login nao grava. O sync-banco se recusa a rodar assim; peca ao DBA da SOLIDCON para conferir.'
            return 3
        }
        Write-Host ('OK: nenhuma permissao de escrita encontrada (' + $total + ' verificacoes em base, schemas, objetos, colunas e papeis).')
        Write-Host 'Mesmo assim, peca ao DBA da SOLIDCON a confirmacao por escrito de que o login so le as views combinadas.'
        return 0
    } finally { $con.Dispose(); $senha.Dispose() }
}

# Dot-source (testes) carrega so as funcoes.
if ($MyInvocation.InvocationName -eq '.') { return }

$codigo = 1
try {
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) { throw 'abra o PowerShell como Administrador' }
    $cb = Ler-ConfigBanco $Config
    if ($Testar) {
        $codigo = Testar-Conexao $cb
    } else {
        $cred = Get-Credential -UserName $cb.usuario -Message 'Senha do login de CONSULTA do banco SOLIDCON (fica cifrada neste servidor)'
        if (-not $cred) { throw 'cancelado' }
        if ($cred.UserName.TrimStart('\') -cne $cb.usuario) { throw 'usuario diferente de banco.usuario do config-banco.json' }
        if ($cred.Password.Length -eq 0) { throw 'senha vazia' }
        Gravar-ArquivoSenha $cb.arquivoSenha (Cifrar-Senha $cred.Password)
        $cred.Password.Dispose(); $cred = $null
        Write-Output ('OK: senha guardada (cifrada) em ' + $cb.arquivoSenha + '. Agora rode de novo com -Testar.')
        $codigo = 0
    }
} catch [System.Data.SqlClient.SqlException] {
    # Sem a mensagem do SQL (pode citar servidor/usuario): so o numero do erro.
    Write-Output ('ERRO: nao conectou no banco (erro SQL ' + $_.Exception.Number + '). Confira servidor/base no config-banco.json, a rede e a senha.')
    $codigo = 2
} catch [Security.Cryptography.CryptographicException] {
    Write-Output 'ERRO: nao foi possivel decifrar a senha neste servidor. Rode o script sem -Testar para gravar de novo.'
    $codigo = 1
} catch {
    Write-Output ('ERRO: ' + $_.Exception.Message)
    $codigo = 1
}
exit $codigo
