#requires -Version 5.1
# Coleta SOMENTE LEITURA pelo banco SQL Server da SOLIDCON (tarefa propria, a cada 5 min).
# Independente do sync-produtos.ps1 (API HTTP): outro mutex, outra trava, outro log.
# Acordo com a SOLIDCON: so VIEWS liberadas (dbo.VW_*/vw*), nunca tabelas tb*.
# Cada modulo: consulta FIXA (texto no codigo, so views da lista $ViewsPermitidas)
#   -> projecao explicita de colunas -> RPC Supabase propria -> log sem dados pessoais.
# Falha de um modulo nao impede os outros. Etapa 1: so o modulo 'saude' (SELECT 1).
#   Normal:   sync-banco.ps1 [-Config C:\TempRio\solidcon\config-banco.json]
# Config PROPRIO (config-banco.json, com modo proprio). O config.json do sync-produtos so e
# LIDO, e so em modo real, para pegar a conta de integracao do Supabase; nunca e alterado.
#   Offline:  sync-banco.ps1 -Simular [-SimularFalha]   (sem banco e sem Supabase)
[CmdletBinding()]
param(
    [string]$Config = 'C:\TempRio\solidcon\config-banco.json',
    [switch]$Simular,
    [switch]$SimularFalha
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Security
$Invariant = [Globalization.CultureInfo]::InvariantCulture
$Utf8 = New-Object Text.UTF8Encoding($false)

# Mesmos valores do configurar-senha-banco.ps1 (a entropia nao e segredo; repo publico).
$EntropiaTexto = 'TempRio/solidcon/banco-senha/v1'
$PrefixoArquivo = 'temprio-dpapi-v1:'
$NomeArquivoSenha = 'banco-senha.dpapi'
$SidSystem = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$SidAdmins = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')

# Unicas views que qualquer modulo pode ler (nome exato, schema dbo). Etapa 1: nenhuma.
# Incluir aqui SO views combinadas com a SOLIDCON, ex.: 'dbo.VW_EXEMPLO'.
$ViewsPermitidas = @()
# Consultas aprovadas na revisao, LITERAIS, por modulo: um modulo so roda se o texto da sua
# consulta for identico ao daqui. E a garantia principal; o validador estrutural e defesa
# auxiliar (etapas com views: gramatica restrita antes de liberar consultas novas).
$ConsultasAprovadas = @{
    saude = "SELECT 1 AS ok, CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(32)) AS versao"
}
$RpcsPermitidas = @('solidcon_receber_banco_saude')

# Preparacao fixa de toda sessao (texto interno; nao passa pelo validador de modulos).
$SqlSessao = 'SET NOCOUNT ON; SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET LOCK_TIMEOUT 5000; SET DEADLOCK_PRIORITY LOW;'
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

$Cfg = $null
$Cb = $null
$Sup = $null
$Pasta = $null
$Real = $false
$SupabaseBase = $null
$Token = $null
$Trava = $null
$Mutex = $null
$MutexAdquirido = $false
$ExecucaoId = [guid]::NewGuid().ToString('D')
$Fase = 'configuracao'
$Mensagem = 'Falha de configuracao.'
$CodigoSaida = 1

function Campo($Objeto, [string]$Nome) {
    if ($null -eq $Objeto) { return $null }
    $p = $Objeto.PSObject.Properties[$Nome]
    if ($null -ne $p) { return $p.Value }
    return $null
}

function Salvar-Json($Valor, [string]$Caminho) {
    # Troca atomica: o ultimo estado nunca fica pela metade.
    $temporario = $Caminho + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    $backup = $temporario + '.bak'
    try {
        [IO.File]::WriteAllText($temporario, (ConvertTo-Json -InputObject $Valor -Depth 20), $Utf8)
        if ([IO.File]::Exists($Caminho)) {
            [IO.File]::Replace($temporario, $Caminho, $backup)
        } else {
            [IO.File]::Move($temporario, $Caminho)
        }
    } finally {
        if ([IO.File]::Exists($temporario)) { [IO.File]::Delete($temporario) }
        if ([IO.File]::Exists($backup)) { [IO.File]::Delete($backup) }
    }
}

function Log([string]$Texto) {
    $linha = [DateTimeOffset]::Now.ToString('o') + ' ' + $Texto
    Write-Output $linha
    if ($Pasta) {
        $logPath = Join-Path $Pasta 'sync-banco.log'
        # Arquivo atual de 1 MiB + tres anteriores.
        if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -ge 1MB) {
            for ($i = 2; $i -ge 1; $i--) {
                $anterior = $logPath + '.' + $i
                if (Test-Path -LiteralPath $anterior) {
                    Move-Item -LiteralPath $anterior -Destination ($logPath + '.' + ($i + 1)) -Force
                }
            }
            Move-Item -LiteralPath $logPath -Destination ($logPath + '.1') -Force
        }
        [IO.File]::AppendAllText($logPath, $linha + [Environment]::NewLine, $Utf8)
    }
}

function Ler-ConfigBanco($Cfg) {
    $banco = Campo $Cfg 'banco'
    if ($null -eq $banco) { throw 'config sem a secao banco' }
    $servidor = [string](Campo $banco 'servidor')
    $base = [string](Campo $banco 'base')
    $usuario = [string](Campo $banco 'usuario')
    foreach ($v in @($servidor, $base, $usuario)) { if ($v -match 'PREENCHER') { throw 'secao banco do config-banco.json nao preenchida' } }
    # Nome/IP com porta ou instancia opcionais; nada de ; = ' ou espacos na string de conexao.
    if ($servidor -notmatch '^[A-Za-z0-9][A-Za-z0-9.\-]{0,252}(\\[A-Za-z0-9_$]{1,16})?(,[0-9]{1,5})?$') { throw 'banco.servidor invalido ou nao preenchido' }
    if ($base -notmatch '^[A-Za-z0-9_]{1,128}$') { throw 'banco.base invalida' }
    if ($usuario -notmatch '^[A-Za-z0-9_]{1,128}$') { throw 'banco.usuario invalido' }
    return @{ servidor = $servidor; base = $base; usuario = $usuario }
}

# ---------- senha (DPAPI maquina + ACL SYSTEM/Administradores) ----------
function SecureString-DeBytes([byte[]]$Bytes) {
    $s = New-Object Security.SecureString
    for ($i = 0; $i -lt $Bytes.Length; $i += 2) { $s.AppendChar([char]([int]$Bytes[$i] -bor ([int]$Bytes[$i + 1] -shl 8))) }
    $s.MakeReadOnly()
    return $s
}

function Conferir-AclRestrita([string]$Caminho) {
    $acl = [IO.File]::GetAccessControl($Caminho)
    if (-not $acl.AreAccessRulesProtected) { throw 'ACL do arquivo de senha herda permissoes' }
    foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($r.IdentityReference -ne $SidSystem -and $r.IdentityReference -ne $SidAdmins) { throw 'ACL do arquivo de senha tem outra conta' }
    }
}

function Ler-SenhaBanco {
    $caminho = Join-Path $Pasta $NomeArquivoSenha
    if (-not [IO.File]::Exists($caminho)) { throw 'senha-ausente' }
    # Arquivo com acesso amplo = senha possivelmente exposta: falha fechado.
    try { Conferir-AclRestrita $caminho } catch { throw 'senha-acl' }
    try { $texto = [IO.File]::ReadAllText($caminho).Trim() } catch { throw 'senha-acesso' }
    if (-not $texto.StartsWith($PrefixoArquivo, [StringComparison]::Ordinal)) { throw 'senha-formato' }
    try {
        $cifrado = [Convert]::FromBase64String($texto.Substring($PrefixoArquivo.Length))
        $claro = [Security.Cryptography.ProtectedData]::Unprotect($cifrado, [Text.Encoding]::UTF8.GetBytes($EntropiaTexto), [Security.Cryptography.DataProtectionScope]::LocalMachine)
    } catch { throw 'senha-decifrar' }
    try {
        if ($claro.Length -eq 0 -or ($claro.Length % 2) -ne 0) { throw 'senha-formato' }
        return SecureString-DeBytes $claro
    } finally { [Array]::Clear($claro, 0, $claro.Length) }
}

# ---------- consultas fixas ----------
function Validar-ConsultaFixa([string]$Nome, [string]$Sql) {
    if ([string]::IsNullOrWhiteSpace($Sql) -or $Sql.Length -gt 8000) { throw 'consulta vazia ou grande' }
    if (-not $ConsultasAprovadas.ContainsKey($Nome) -or $ConsultasAprovadas[$Nome] -cne $Sql) { throw 'consulta nao aprovada' }
    # Defesa auxiliar (texto fixo e aprovado): barra engano em modulos futuros.
    if ($Sql -notmatch '^\s*SELECT\s') { throw 'consulta deve comecar com SELECT' }
    if ($Sql -match ';|--|/\*|\*/') { throw 'consulta com ; ou comentario' }
    $proibidas = '\b(INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|DENY|INTO|OPENROWSET|OPENQUERY|OPENDATASOURCE|OPENXML|BULK|WAITFOR|SHUTDOWN|DBCC|BACKUP|RESTORE|USE|SET|DECLARE|KILL|RECONFIGURE)\b|\bOPEN\w*|\bNEXT\s+VALUE\b|\b(xp|sp)_\w*|\btb\w*|\bsys\s*\.|INFORMATION_SCHEMA|@@'
    if ($Sql -match $proibidas) { throw 'consulta com comando ou objeto proibido' }
    # Funcao com schema (dbo.fn(...)) le objetos sem passar por FROM.
    if ($Sql -match '[\w\]]\s*\.\s*\[?\w+\]?\s*\(') { throw 'chamada de funcao com schema nao permitida' }
    # FROM a, b (juncao por virgula) esconderia o segundo objeto do validador.
    if ($Sql -match '(?i)\bFROM\b\s*[^\s(]+(\s+(AS\s+)?\w+)?\s*,') { throw 'juncao por virgula nao permitida' }
    $usadas = @()
    foreach ($m in [regex]::Matches($Sql, '(?i)\b(FROM|JOIN|APPLY)\b\s*([^\s(),]+)')) {
        $nome = $m.Groups[2].Value.Replace('[', '').Replace(']', '')
        $permitida = $false
        foreach ($v in $ViewsPermitidas) {
            if ($v -match '^dbo\.(VW_|vw)\w+$' -and [string]::Equals($v, $nome, [StringComparison]::OrdinalIgnoreCase)) { $permitida = $true }
        }
        if (-not $permitida) { throw 'objeto fora da lista de views permitidas' }
        $usadas += $nome
    }
    return ,$usadas
}

function Nova-ConexaoBanco([Security.SecureString]$Senha) {
    $b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
    $b['Data Source'] = $Cb.servidor
    $b['Initial Catalog'] = $Cb.base
    $b['Application Name'] = 'TempRio sync-banco'
    $b['ApplicationIntent'] = 'ReadOnly'
    $b['Connect Timeout'] = 10
    $b['Encrypt'] = $true
    $b['TrustServerCertificate'] = $true
    $b['Pooling'] = $false
    $b['MultipleActiveResultSets'] = $false
    $cred = New-Object System.Data.SqlClient.SqlCredential($Cb.usuario, $Senha)
    return New-Object System.Data.SqlClient.SqlConnection($b.ConnectionString, $cred)
}

function Ler-Linhas($Comando, [string[]]$Colunas, [int]$MaxLinhas) {
    # Projecao explicita: so as colunas declaradas; coluna faltando = erro; extra = ignorada.
    $linhas = New-Object Collections.ArrayList
    $r = $Comando.ExecuteReader()
    try {
        $indices = @{}
        for ($i = 0; $i -lt $r.FieldCount; $i++) { $indices[$r.GetName($i).ToLowerInvariant()] = $i }
        foreach ($c in $Colunas) { if (-not $indices.ContainsKey($c.ToLowerInvariant())) { throw 'coluna-ausente' } }
        while ($r.Read()) {
            if ($linhas.Count -ge $MaxLinhas) { throw 'linhas-demais' }
            $l = @{}
            foreach ($c in $Colunas) {
                $i = $indices[$c.ToLowerInvariant()]
                $l[$c] = if ($r.IsDBNull($i)) { $null } else { $r.GetValue($i) }
            }
            [void]$linhas.Add($l)
        }
    } finally { $r.Close() }
    return ,$linhas.ToArray()
}

function Abrir-Sessao {
    # Uma sessao por modulo: falha de conexao/consulta de um nao contamina o outro.
    if ($Simular) {
        if ($SimularFalha) { throw 'simulada' }
        return @{ simulada = $true; con = $null }
    }
    $senha = Ler-SenhaBanco
    $con = Nova-ConexaoBanco $senha
    try {
        $con.Open()
        $cmd = $con.CreateCommand(); $cmd.CommandTimeout = 15; $cmd.CommandText = $SqlSessao
        [void]$cmd.ExecuteNonQuery()
        $cmd = $con.CreateCommand(); $cmd.CommandTimeout = 30; $cmd.CommandText = $SqlPermissoes
        $p = Ler-Linhas $cmd @('escrita', 'inconclusivo', 'verificados') 1
        # Login de consulta nunca pode gravar: se puder, ou se nao der para conferir, ninguem coleta.
        if ($p.Count -ne 1 -or $null -eq $p[0].escrita -or $null -eq $p[0].inconclusivo -or
            $null -eq $p[0].verificados -or [int]$p[0].verificados -lt 17) { throw 'permissao-inconclusiva' }
        if ([int]$p[0].escrita -ne 0) { throw 'login-com-escrita' }
        if ([int]$p[0].inconclusivo -ne 0) { throw 'permissao-inconclusiva' }
        return @{ simulada = $false; con = $con }
    } catch {
        $con.Dispose()
        throw
    } finally { $senha.Dispose() }
}

function Fechar-Sessao($Sessao) {
    if ($Sessao -and $Sessao.con) { $Sessao.con.Dispose() }
}

function Executar-Consulta($Sessao, $Modulo) {
    $null = Validar-ConsultaFixa $Modulo.nome $Modulo.sql
    if ($Sessao.simulada) { return ,(& $Modulo.simulacao) }
    $cmd = $Sessao.con.CreateCommand()
    $cmd.CommandTimeout = 15
    $cmd.CommandText = $Modulo.sql
    return ,(Ler-Linhas $cmd $Modulo.colunas $Modulo.maxLinhas)
}

function Descrever-Erro($Registro) {
    # So textos fixos: nunca a mensagem do SQL/HTTP (pode citar servidor, usuario ou dados).
    $e = $Registro.Exception
    while ($e) {
        if ($e -is [System.Data.SqlClient.SqlException]) {
            $n = [int]$e.Number
            $texto = switch ($n) {
                18456 { 'login recusado' }
                4060 { 'base inacessivel para o login' }
                { $_ -in @(-2, 121, 258) } { 'tempo esgotado' }
                1222 { 'tempo de bloqueio esgotado' }
                229 { 'sem permissao de leitura' }
                default { if ($n -in @(-1, 2, 26, 40, 53, 10054, 10060, 10061, 11001, 11004)) { 'servidor inacessivel' } else { 'erro SQL' } }
            }
            return ('{0} (sql {1})' -f $texto, $n)
        }
        $e = $e.InnerException
    }
    $m = [string]$Registro.Exception.Message
    $fixas = @{
        'senha-ausente' = 'senha do banco nao configurada (rodar configurar-senha-banco.ps1)'
        'senha-acl' = 'arquivo de senha com permissao ampla; recusado'
        'senha-formato' = 'arquivo de senha invalido'
        'senha-acesso' = 'sem acesso ao arquivo de senha (a tarefa deve rodar como SYSTEM)'
        'senha-decifrar' = 'senha nao decifra neste servidor'
        'login-com-escrita' = 'login de consulta tem permissao de escrita; coleta suspensa'
        'permissao-inconclusiva' = 'nao foi possivel confirmar que o login nao grava; coleta suspensa'
        'coluna-ausente' = 'consulta sem coluna esperada'
        'linhas-demais' = 'consulta devolveu linhas demais'
        'resposta-invalida' = 'resposta inesperada do banco'
        'simulada' = 'falha simulada'
    }
    if ($fixas.ContainsKey($m)) { return $fixas[$m] }
    return 'falha local'
}

# ---------- Supabase ----------
function Entrar-Supabase {
    $corpo = @{ email = $Sup.syncEmail; password = $Sup.syncSenha } | ConvertTo-Json -Compress
    $opcoes = @{
        Uri = ($SupabaseBase + '/auth/v1/token?grant_type=password')
        Method = 'Post'; Headers = @{ apikey = $Sup.anonKey }
        ContentType = 'application/json; charset=utf-8'
        Body = [Text.Encoding]::UTF8.GetBytes($corpo); TimeoutSec = 30; MaximumRedirection = 0
    }
    $resposta = Invoke-RestMethod @opcoes
    if (-not $resposta.access_token) { throw 'login sem token' }
    return [string]$resposta.access_token
}

function Chamar-Rpc([string]$Nome, $Dados) {
    if ($Nome -cnotin $RpcsPermitidas) { throw 'RPC invalida' }
    if (-not $script:Token) { $script:Token = Entrar-Supabase }
    $corpo = ConvertTo-Json -InputObject $Dados -Depth 10 -Compress
    $opcoes = @{
        Uri = ($SupabaseBase + '/rest/v1/rpc/' + $Nome); Method = 'Post'
        Headers = @{ apikey = $Sup.anonKey; Authorization = ('Bearer ' + $script:Token) }
        ContentType = 'application/json; charset=utf-8'
        Body = [Text.Encoding]::UTF8.GetBytes($corpo); TimeoutSec = 30; MaximumRedirection = 0
    }
    return Invoke-RestMethod @opcoes
}

# ---------- modulos ----------
# saude: SELECT 1 + versao do servidor. Nao le nenhum dado do ERP.
$ModuloSaude = @{
    nome = 'saude'; codigo = 2; maxLinhas = 1
    sql = "SELECT 1 AS ok, CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(32)) AS versao"
    colunas = @('ok', 'versao')
    simulacao = { ,@(@{ ok = 1; versao = '16.0.4135.4' }) }
}

function Modulo-Saude($Modulo) {
    $relogio = [Diagnostics.Stopwatch]::StartNew()
    $status = 'ok'; $versao = $null; $mensagemErro = $null; $sessao = $null
    try {
        $sessao = Abrir-Sessao
        $linhas = Executar-Consulta $sessao $Modulo
        if ($linhas.Count -ne 1 -or $null -eq $linhas[0].ok -or [int]$linhas[0].ok -ne 1) { throw 'resposta-invalida' }
        $v = [string]$linhas[0].versao
        if ($v -match '^[0-9]{1,4}(\.[0-9]{1,6}){1,3}$') { $versao = $v }
    } catch {
        $status = 'erro'; $mensagemErro = Descrever-Erro $_
    } finally {
        Fechar-Sessao $sessao
        $relogio.Stop()
    }
    $duracao = [int][Math]::Min($relogio.ElapsedMilliseconds, 600000)
    $enviado = 'nao'
    if ($Real -and -not $Simular) {
        $script:Fase = 'envio'
        $resposta = Chamar-Rpc 'solidcon_receber_banco_saude' @{
            p_status = $status; p_duracao_ms = $duracao; p_versao = $versao
            p_mensagem = $mensagemErro; p_execucao_id = $ExecucaoId
        }
        if ((Campo $resposta 'ok') -ne $true) { throw 'RPC sem confirmacao' }
        $enviado = 'sim'
    }
    $script:Fase = 'estado-local'
    Salvar-Json ([ordered]@{
        modulo = 'saude'; status = $status; duracao_ms = $duracao; versao = $versao
        mensagem = $mensagemErro; execucao_id = $ExecucaoId; enviado = ($enviado -eq 'sim')
        simulado = [bool]$Simular; em = [DateTimeOffset]::UtcNow.ToString('o', $Invariant)
    }) (Join-Path $Pasta ('banco-saude-ultimo-' + $Cfg.modo + '.json'))
    $linhaLog = 'saude modo={0}{1} status={2} duracao_ms={3} versao={4} enviado={5} execucao={6}' -f
        $Cfg.modo, $(if ($Simular) { ' SIMULADO' } else { '' }), $status, $duracao, $(if ($versao) { $versao } else { '-' }), $enviado, $ExecucaoId
    if ($status -eq 'ok') { Log ('OK ' + $linhaLog) }
    else { Log ('ERRO ' + $linhaLog + ' motivo=' + $mensagemErro); throw 'modulo-com-erro' }
}

$Modulos = @(
    @{ def = $ModuloSaude; funcao = 'Modulo-Saude' }
)

# Dot-source (testes) carrega so as funcoes e definicoes.
if ($MyInvocation.InvocationName -eq '.') { return }

try {
    $Cfg = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Cfg.modo -cnotin @('teste', 'real')) { throw 'modo invalido' }
    $Real = $Cfg.modo -ceq 'real'
    if ($SimularFalha -and -not $Simular) { throw '-SimularFalha exige -Simular' }
    if ([string]::IsNullOrWhiteSpace([string](Campo $Cfg 'pastaSaida')) -or -not [IO.Path]::IsPathRooted($Cfg.pastaSaida)) {
        throw 'pastaSaida deve ser absoluta'
    }
    $Fase = 'configuracao-banco'
    $Mensagem = 'Secao banco do config-banco.json invalida (servidor, base, usuario).'
    $Cb = Ler-ConfigBanco $Cfg
    # Nome proprio: roda em paralelo ao sync-produtos, nunca consigo mesmo.
    $Fase = 'mutex'
    $Mensagem = 'Outra execucao do sync-banco esta ativa ou o mutex global nao esta acessivel.'
    $Mutex = New-Object Threading.Mutex($false, 'Global\TempRioSolidconBanco')
    try {
        $MutexAdquirido = $Mutex.WaitOne(0)
    } catch [Threading.AbandonedMutexException] {
        $MutexAdquirido = $true
    }
    if (-not $MutexAdquirido) { throw 'execucao simultanea' }
    $Pasta = [IO.Path]::GetFullPath($Cfg.pastaSaida)
    [IO.Directory]::CreateDirectory($Pasta) | Out-Null
    $Fase = 'trava'
    $Mensagem = 'Outra execucao esta ativa ou a pasta de saida nao permite escrita.'
    $Trava = [IO.File]::Open((Join-Path $Pasta 'sync-banco.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    if ($Real -and -not $Simular) {
        $Fase = 'configuracao-supabase'
        $Mensagem = 'Configuracao Supabase invalida (configSupabase aponta para o config.json do sync-produtos).'
        $caminhoSup = [string](Campo $Cfg 'configSupabase')
        if ([string]::IsNullOrWhiteSpace($caminhoSup) -or -not [IO.Path]::IsPathRooted($caminhoSup)) { throw 'configSupabase deve ser absoluto' }
        # So leitura; o arquivo do sync-produtos nunca e gravado por este script.
        $lido = Get-Content -LiteralPath $caminhoSup -Raw -Encoding UTF8 | ConvertFrom-Json
        $Sup = @{}
        foreach ($campo in @('supabaseUrl', 'anonKey', 'syncEmail', 'syncSenha')) { $Sup[$campo] = [string](Campo $lido $campo) }
        $lido = $null
        $supabase = [uri]$Sup.supabaseUrl
        if (-not $supabase.IsAbsoluteUri -or $supabase.Scheme -cne 'https' -or $supabase.Port -ne 443 -or
            $supabase.AbsolutePath -ne '/' -or $supabase.Query -or $supabase.Fragment -or $supabase.UserInfo) {
            throw 'Supabase deve usar HTTPS sem caminho'
        }
        foreach ($campo in @('anonKey', 'syncEmail', 'syncSenha')) {
            if ([string]::IsNullOrWhiteSpace($Sup[$campo]) -or $Sup[$campo] -match 'PREENCHER') {
                throw 'credencial nao preenchida'
            }
        }
        $SupabaseBase = $supabase.GetLeftPart([UriPartial]::Authority)
    }
    $falhos = @()
    foreach ($m in $Modulos) {
        $Fase = 'modulo-' + $m.def.nome
        try {
            # Consulta fora da whitelist: o modulo nem abre conexao.
            $null = Validar-ConsultaFixa $m.def.nome $m.def.sql
            & $m.funcao $m.def
        } catch {
            $falhos += $m.def
            if ([string]$_.Exception.Message -cne 'modulo-com-erro') {
                # Falha fora da consulta (validacao, envio, estado local): so fase fixa no log.
                try { Log ('ERRO {0} fase={1}; outros modulos preservados.' -f $m.def.nome, $Fase) } catch {}
            }
        }
    }
    $CodigoSaida = if ($falhos.Count -gt 0) { [int]$falhos[0].codigo } else { 0 }
} catch {
    try { Log ('ERRO fase=' + $Fase + ': ' + $Mensagem) } catch {}
    $CodigoSaida = 1
} finally {
    $Token = $null
    $Sup = $null
    if ($Trava) { $Trava.Dispose() }
    if ($MutexAdquirido) { $Mutex.ReleaseMutex() }
    if ($Mutex) { $Mutex.Dispose() }
}

exit $CodigoSaida
