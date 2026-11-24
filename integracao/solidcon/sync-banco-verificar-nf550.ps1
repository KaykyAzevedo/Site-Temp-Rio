#requires -Version 5.1
# NF550: verificacao autonoma somente SELECT. Nao executa/importa o coletor instalado.
# Copia literal das protecoes do sync-banco publicado; mesmo mutex/lock/transacao/rollback.
# Config lido, nunca alterado. Sem XML/imagem/cadastro/Supabase/agenda/estado/outros modulos.
[CmdletBinding()]
param([string]$Config='C:\TempRio\solidcon\config-banco.json',[switch]$Testar,[switch]$Simular,[switch]$SimularFalha)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Security


$Invariant = [Globalization.CultureInfo]::InvariantCulture

$EntropiaTexto = 'TempRio/solidcon/banco-senha/v1'

$PrefixoArquivo = 'temprio-dpapi-v1:'

$NomeArquivoSenha = 'banco-senha.dpapi'

$SidSystem = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')

$SidAdmins = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')

$SqlSessao = 'SET NOCOUNT ON; SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET LOCK_TIMEOUT 5000; SET DEADLOCK_PRIORITY LOW;'

$SqlProtecoes = 'SELECT @@TRANCOUNT AS transacoes, CAST((SELECT s.transaction_isolation_level FROM sys.dm_exec_sessions AS s WHERE s.session_id = @@SPID) AS int) AS isolamento'

$SqlPermissoes = @'
SELECT
  SUM(CASE WHEN t.v = 1 THEN 1 ELSE 0 END) AS escrita,
  SUM(CASE WHEN t.v IS NULL THEN 1 ELSE 0 END) AS inconclusivo,
  COUNT(*) AS verificados,
  SUM(CASE WHEN t.v = 1 AND t.nivel = 'datareader' THEN 1 ELSE 0 END) AS datareader_gravacao,
  SUM(CASE WHEN t.v = 1 AND t.nivel = 'base' AND t.tipo = 'e' THEN 1 ELSE 0 END) AS base_execucao,
  SUM(CASE WHEN t.v = 1 AND t.nivel = 'base' AND t.tipo = 'g' THEN 1 ELSE 0 END) AS base_gravacao,
  SUM(CASE WHEN t.v = 1 AND t.nivel = 'schema' AND t.tipo = 'e' THEN 1 ELSE 0 END) AS schema_execucao,
  SUM(CASE WHEN t.v = 1 AND t.nivel = 'schema' AND t.tipo = 'g' THEN 1 ELSE 0 END) AS schema_gravacao,
  SUM(CASE WHEN t.v = 1 AND t.nivel = 'objeto' AND t.tipo = 'e' THEN 1 ELSE 0 END) AS objeto_execucao,
  SUM(CASE WHEN t.v = 1 AND t.nivel = 'objeto' AND t.tipo = 'g' THEN 1 ELSE 0 END) AS objeto_gravacao,
  SUM(CASE WHEN t.v = 1 AND t.nivel = 'coluna' THEN 1 ELSE 0 END) AS coluna_gravacao,
  SUM(CASE WHEN t.v = 1 AND t.nivel = 'papel' THEN 1 ELSE 0 END) AS papel_gravacao
FROM (
  SELECT 'base' AS nivel, CASE WHEN p.n = 'EXECUTE' THEN 'e' ELSE 'g' END AS tipo,
         HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', p.n) AS v
    FROM (VALUES ('INSERT'),('UPDATE'),('DELETE'),('EXECUTE'),('ALTER'),('CONTROL'),('TAKE OWNERSHIP'),
                 ('CREATE TABLE'),('CREATE VIEW'),('CREATE PROCEDURE'),('CREATE FUNCTION'),('CREATE SCHEMA'),
                 ('ALTER ANY SCHEMA'),('ALTER ANY USER'),('ALTER ANY ROLE')) AS p(n)
  UNION ALL
  SELECT CASE WHEN s.name = N'db_datareader'
               AND s.principal_id = DATABASE_PRINCIPAL_ID(N'db_datareader')
               AND NOT EXISTS (SELECT 1 FROM sys.objects AS so WHERE so.schema_id = s.schema_id)
               AND NOT EXISTS (SELECT 1 FROM sys.database_permissions AS dp WHERE dp.class = 3 AND dp.major_id = s.schema_id)
              THEN 'datareader' ELSE 'schema' END,
         'g', HAS_PERMS_BY_NAME(QUOTENAME(s.name), 'SCHEMA', p.n)
    FROM sys.schemas AS s
   CROSS JOIN (VALUES ('ALTER'),('CONTROL'),('TAKE OWNERSHIP'),('CREATE SEQUENCE')) AS p(n)
  UNION ALL
  SELECT 'schema', CASE WHEN p.n = 'EXECUTE' THEN 'e' ELSE 'g' END,
         HAS_PERMS_BY_NAME(QUOTENAME(s.name), 'SCHEMA', p.n)
    FROM sys.schemas AS s
   CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('EXECUTE')) AS p(n)
   WHERE NOT (s.principal_id BETWEEN 16384 AND 16393
              AND NOT EXISTS (SELECT 1 FROM sys.objects AS so WHERE so.schema_id = s.schema_id))
  UNION ALL
  SELECT 'objeto', 'g', HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(o.schema_id)) + '.' + QUOTENAME(o.name), 'OBJECT', p.n)
    FROM sys.objects AS o
   CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('ALTER'),('CONTROL'),('TAKE OWNERSHIP')) AS p(n)
   WHERE o.type IN ('U', 'V')
  UNION ALL
  SELECT 'objeto', CASE WHEN p.n = 'EXECUTE' THEN 'e' ELSE 'g' END,
         HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(o.schema_id)) + '.' + QUOTENAME(o.name), 'OBJECT', p.n)
    FROM sys.objects AS o
   CROSS JOIN (VALUES ('EXECUTE'),('ALTER'),('CONTROL'),('TAKE OWNERSHIP')) AS p(n)
   WHERE o.type IN ('P', 'PC', 'X')
  UNION ALL
  SELECT 'objeto', 'g', HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(o.schema_id)) + '.' + QUOTENAME(o.name), 'OBJECT', p.n)
    FROM sys.objects AS o
   CROSS JOIN (VALUES ('UPDATE'),('ALTER'),('CONTROL'),('TAKE OWNERSHIP')) AS p(n)
   WHERE o.type = 'SO'
  UNION ALL
  SELECT 'coluna', 'g', HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(o.schema_id)) + '.' + QUOTENAME(o.name), 'OBJECT', 'UPDATE', c.name, 'COLUMN')
    FROM sys.columns AS c
    JOIN sys.objects AS o ON o.object_id = c.object_id
   WHERE o.type IN ('U', 'V')
  UNION ALL
  SELECT 'papel', 'g', CASE WHEN IS_SRVROLEMEMBER('sysadmin') = 1 THEN 1 WHEN IS_SRVROLEMEMBER('sysadmin') = 0 THEN 0 END
  UNION ALL
  SELECT 'papel', 'g',
         CASE WHEN IS_ROLEMEMBER('db_owner') = 1 OR IS_ROLEMEMBER('db_datawriter') = 1 OR IS_ROLEMEMBER('db_ddladmin') = 1 THEN 1
              WHEN IS_ROLEMEMBER('db_owner') = 0 AND IS_ROLEMEMBER('db_datawriter') = 0 AND IS_ROLEMEMBER('db_ddladmin') = 0 THEN 0 END
) AS t
'@

$ColunasPermissoes = @('escrita', 'inconclusivo', 'verificados', 'datareader_gravacao', 'base_execucao', 'base_gravacao', 'schema_execucao',
    'schema_gravacao', 'objeto_execucao', 'objeto_gravacao', 'coluna_gravacao', 'papel_gravacao')

$DetalhePermissoes = ''

$LinhaTrava = ''

$TravaLogada = $false

$ProtecoesConfirmadas = $false

$AceitarPermissoesExtras = $false

function Campo($Objeto, [string]$Nome) {
    if ($null -eq $Objeto) { return $null }
    $p = $Objeto.PSObject.Properties[$Nome]
    if ($null -ne $p) { return $p.Value }
    return $null
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
    # PROTECOES (sempre, com ou sem a chave): ApplicationIntent=ReadOnly, READ UNCOMMITTED e TODA
    # leitura dentro de uma transacao explicita que sempre termina em Rollback (Fechar-Sessao).
    if ($Simular) {
        if ($SimularFalha) { throw 'simulada' }
        return @{ simulada = $true; con = $null; tx = $null }
    }
    $senha = Ler-SenhaBanco
    $con = Nova-ConexaoBanco $senha
    $tx = $null
    try {
        $con.Open()
        $cmd = $con.CreateCommand(); $cmd.CommandTimeout = 15; $cmd.CommandText = $SqlSessao
        [void]$cmd.ExecuteNonQuery()
        $tx = $con.BeginTransaction([Data.IsolationLevel]::ReadUncommitted)
        # Confere no proprio servidor que as protecoes estao valendo nesta sessao; senao, nada le.
        $cmd = $con.CreateCommand(); $cmd.CommandTimeout = 15; $cmd.Transaction = $tx; $cmd.CommandText = $SqlProtecoes
        $pr = Ler-Linhas $cmd @('transacoes', 'isolamento') 1
        $intencao = (New-Object System.Data.SqlClient.SqlConnectionStringBuilder($con.ConnectionString)).ApplicationIntent
        if ($pr.Count -ne 1 -or $null -eq $pr[0].transacoes -or [int]$pr[0].transacoes -ne 1 -or
            $null -eq $pr[0].isolamento -or [int]$pr[0].isolamento -ne 1 -or
            [string]$intencao -cne 'ReadOnly') { $script:LinhaTrava = 'TRAVA bloqueada: protecoes nao confirmadas'; throw 'protecao-inativa' }
        $script:ProtecoesConfirmadas = $true
        $cmd = $con.CreateCommand(); $cmd.CommandTimeout = 30; $cmd.Transaction = $tx; $cmd.CommandText = $SqlPermissoes
        $p = Ler-Linhas $cmd ($ColunasPermissoes) 1
        # Inconclusivo bloqueia SEMPRE (a chave do dono nao cobre o que nao deu para conferir).
        if ($p.Count -ne 1 -or $null -eq $p[0].escrita -or $null -eq $p[0].inconclusivo -or
            $null -eq $p[0].verificados -or [int]$p[0].verificados -lt 17) { $script:LinhaTrava = 'TRAVA bloqueada: permissoes inconclusivas'; throw 'permissao-inconclusiva' }
        $script:DetalhePermissoes = Resumo-Permissoes $p[0]
        if ([int]$p[0].inconclusivo -ne 0) { $script:LinhaTrava = 'TRAVA bloqueada: permissoes inconclusivas'; throw 'permissao-inconclusiva' }
        if ([int]$p[0].escrita -ne 0) {
            if (-not $script:AceitarPermissoesExtras) { $script:LinhaTrava = 'TRAVA bloqueada: login pode gravar ou executar (' + $script:DetalhePermissoes + ')'; throw 'login-com-escrita' }
            # Chave do dono (aceitar_permissoes_extras=true) + protecoes confirmadas acima: segue com AVISO.
            $script:LinhaTrava = 'AVISO trava liberada pelo dono: ' + $script:DetalhePermissoes
        } else {
            $script:LinhaTrava = 'TRAVA liberada: nenhuma gravacao/execucao (' + $script:DetalhePermissoes + ')'
        }
        # Uma linha por execucao no log (nao por modulo). No -Testar so imprime (nada grava).
        if (-not $script:TravaLogada -and -not $Testar) { Log $script:LinhaTrava | Out-Host; $script:TravaLogada = $true }
        return @{ simulada = $false; con = $con; tx = $tx }
    } catch {
        Fechar-Sessao @{ con = $con; tx = $tx }
        throw
    } finally { $senha.Dispose() }
}

function Resumo-Permissoes($L) {
    # So contagens (nunca nomes de schema/objeto): onde e de que tipo.
    function N($v) { if ($null -eq $v -or $v -is [DBNull]) { '?' } else { [string][int]$v } }
    $t = 'execucao: base {0}, schema {1}, objeto {2}; gravacao: base {3}, schema {4}, objeto {5}, coluna {6}, papel {7}' -f
        (N $L['base_execucao']), (N $L['schema_execucao']), (N $L['objeto_execucao']),
        (N $L['base_gravacao']), (N $L['schema_gravacao']), (N $L['objeto_gravacao']), (N $L['coluna_gravacao']), (N $L['papel_gravacao'])
    # Diagnostico (NAO isenta): CONTROL herdado no schema vazio db_datareader ainda permite CREATE SEQUENCE.
    if ($null -ne $L['datareader_gravacao'] -and $L['datareader_gravacao'] -isnot [DBNull] -and [int]$L['datareader_gravacao'] -gt 0) {
        $t += '; schema_db_datareader {0} (dono = role db_datareader, vazio: CONTROL permite CREATE SEQUENCE; SOLIDCON: tirar o login do db_datareader e dar GRANT SELECT ON SCHEMA::dbo, ou ALTER AUTHORIZATION ON SCHEMA::db_datareader TO dbo)' -f (N $L['datareader_gravacao'])
    }
    return $t
}

function Fechar-Sessao($Sessao) {
    # Rollback SEMPRE (sucesso ou erro): nada feito nesta sessao pode deixar efeito no ERP.
    if (-not $Sessao) { return }
    try {
        if ($Sessao.tx) {
            try { if ($Sessao.tx.Connection) { $Sessao.tx.Rollback() } } finally { $Sessao.tx.Dispose() }
        }
    } finally {
        # Fechar a conexao (Pooling=false) tambem desfaz no servidor qualquer transacao que sobrar.
        if ($Sessao.con) { $Sessao.con.Dispose() }
    }
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
                207 { 'coluna inexistente' }
                208 { 'tabela ou view inexistente' }
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
        'login-com-escrita' = 'login de consulta pode gravar ou executar; coleta suspensa'
        'permissao-inconclusiva' = 'nao foi possivel confirmar que o login nao grava; coleta suspensa'
        'coluna-ausente' = 'consulta sem coluna esperada'
        'linhas-demais' = 'consulta devolveu linhas demais'
        'resposta-invalida' = 'resposta inesperada do banco'
        'simulada' = 'falha simulada'
        'parcelas-duplicadas' = 'parcelas repetidas na view (mesma conta/vencimento/titulo)'
        'parcela-invalida' = 'parcela com conta, vencimento ou valor invalido'
        'parametro-invalido' = 'parametro de consulta invalido'
        'margem-invalida' = 'linha de venda com produto, dia, quantidade ou valor invalido'
        'margem-duplicada' = 'mesmo dia/produto repetido na consulta'
        'margem-incompleta' = 'venda, custo ou quantidade nulos na janela; janela anterior preservada'
        'semantica-invalida' = 'semantica de venda/custo invalida no script'
        'semantica-pendente' = 'semantica de venda/custo pendente'
        'custos-duplicados' = 'mesmo produto/unidade com custos diferentes'
        'custo-invalido' = 'linha de custo com produto invalido'
        'pedido-invalido' = 'pedido com codigo, data ou carga invalidos'
        'protecao-inativa' = 'transacao com rollback, READ UNCOMMITTED ou ReadOnly nao confirmados; nada lido'
        'pedidos-duplicados' = 'mesmo pedido repetido na consulta'
    }
    if ($m -ceq 'login-com-escrita' -and $script:DetalhePermissoes) { return ($fixas[$m] + ' (' + $script:DetalhePermissoes + ')') }
    if ($fixas.ContainsKey($m)) { return $fixas[$m] }
    return 'falha local'
}

# Console somente; Abrir-Sessao nao chama Log com Testar=true. Nenhum arquivo de log interno.
function Log([string]$Texto){Write-Output $Texto}

$SqlReferenciaNF550=@'
SELECT COUNT_BIG(*) AS linhas, COUNT_BIG(DISTINCT n.cdNota) AS notas,
 COUNT_BIG(CASE WHEN f.ICMSTotvProd=@produtos THEN 1 END) AS produtos_conferem,
 COUNT_BIG(CASE WHEN f.ICMSTotvNF=@total THEN 1 END) AS total_confere,
 COUNT_BIG(CASE WHEN f.ICMSTotvST=@st THEN 1 END) AS st_confere,
 COUNT_BIG(CASE WHEN f.ICMSTotvProd=@produtos AND f.ICMSTotvNF=@total AND f.ICMSTotvST=@st THEN 1 END) AS valores_juntos,
 COUNT_BIG(CASE WHEN n.inCancelada=0 AND n.inDenegada=0 AND n.inRejeitada=0 THEN 1 END) AS status_validos
FROM dbo.tbNota AS n
JOIN dbo.tbNotaFiscal AS f ON f.cdPessoaFilial=n.cdPessoaFilial AND f.cdNota=n.cdNota
JOIN dbo.tbNotaFiscalIdentificacao AS i ON i.cdPessoaFilial=n.cdPessoaFilial AND i.cdNota=n.cdNota
WHERE n.cdPessoaFilial=@filial AND i.nNF=@numero AND LTRIM(RTRIM(i.serie)) IN ('1','01','001')
 AND i.[mod]=@modelo AND i.tpNF=@saida AND i.dEmi>=@emissao AND i.dEmi<@emissao_ate
'@
$ColunasReferenciaNF550=@('linhas','notas','produtos_conferem','total_confere','st_confere','valores_juntos','status_validos')

function Ler-ReferenciaNF550($Sessao){
 $cmd=$Sessao.con.CreateCommand()
 try{
  $cmd.Transaction=$Sessao.tx;$cmd.CommandTimeout=30;$cmd.CommandText=$SqlReferenciaNF550
  foreach($p in @(@('filial',4),@('numero',550),@('serie',1))){$cmd.Parameters.Add('@'+$p[0],[Data.SqlDbType]::Int).Value=[int]$p[1]}
  $par=$cmd.Parameters.Add('@modelo',[Data.SqlDbType]::Char,2);$par.Value='55'
  $cmd.Parameters.Add('@saida',[Data.SqlDbType]::Bit).Value=$true
  foreach($p in @(@('produtos',[decimal]21643.20),@('total',[decimal]24211.21),@('st',[decimal]2334.58))){
   $par=$cmd.Parameters.Add('@'+$p[0],[Data.SqlDbType]::Decimal);$par.Precision=19;$par.Scale=4;$par.Value=$p[1]
  }
  $cmd.Parameters.Add('@emissao',[Data.SqlDbType]::DateTime).Value=[datetime]'2026-06-25'
  $cmd.Parameters.Add('@emissao_ate',[Data.SqlDbType]::DateTime).Value=[datetime]'2026-06-26'
  return ,(Ler-Linhas $cmd $ColunasReferenciaNF550 1)
 }finally{$cmd.Dispose()}
}

function Testar-ReferenciaNF550 {
 if(-not $Testar){throw 'parametro-invalido'}
 $sessao=$null;$script:CodigoReferencia=2
 try{
  $sessao=Abrir-Sessao
  if($sessao.simulada){Write-Output 'SIMULACAO SINTETICA: nenhum banco consultado; nao confirma a nota real.'}
  else{Write-Output $script:LinhaTrava}
  Write-Output 'REFERENCIA: filial4; nNF550; serie1; mod55; tpNF1(saida); emissao25/06/2026 localSP.'
  Write-Output 'ESPERADO: produtos=21643.20; total_nota=24211.21; ICMS_ST=2334.58. So contagens de coincidencias, sem valores inesperados.'
  if($sessao.simulada){$linhas=@(@{linhas=[long]1;notas=[long]1;produtos_conferem=[long]1;total_confere=[long]1;st_confere=[long]1;valores_juntos=[long]1;status_validos=[long]1})}
  else{
   # Leitor retorna um array como unico objeto: atribuicao direta, NUNCA @(Ler-...).
   # Evita o array aninhado que derrubou a descoberta real. Nao ha agrupamento/plano generico.
   $linhas=Ler-ReferenciaNF550 $sessao
  }
  if($linhas.Count -ne 1 -or $linhas[0] -isnot [hashtable]){throw 'resposta-invalida'}
  $r=$linhas[0]
  foreach($c in $ColunasReferenciaNF550){
   if(-not $r.ContainsKey($c) -or $r[$c] -isnot [long] -or $r[$c] -lt 0){throw 'resposta-invalida'}
   if($c -cne 'linhas' -and $r[$c] -gt $r.linhas){throw 'resposta-invalida'}
  }
  Write-Output ('CONTAGEM: notas={0}; linhas_join={1}; sem_cancelamento_denegacao_rejeicao={2}' -f $r.notas,$r.linhas,$r.status_validos)
  Write-Output ('CONFERE_REFERENCIA: produtos_21643.20={0}; total_24211.21={1}; ST_2334.58={2}; tres_na_mesma_linha={3}' -f $r.produtos_conferem,$r.total_confere,$r.st_confere,$r.valores_juntos)
  if($r.notas -eq 1 -and $r.linhas -eq 1 -and $r.valores_juntos -eq 1 -and $r.status_validos -eq 1){
   Write-Output 'RESULTADO: REFERENCIA_CONFERE (uma nota, uma linha, tres valores e status validos).'
   $script:CodigoReferencia=0
  }else{
   Write-Output 'RESULTADO: CONFERENCIA_PENDENTE (ausencia, duplicidade, valor ou status divergente). Nenhum dado enviado.'
  }
 }finally{
  Fechar-Sessao $sessao
  if($sessao){Write-Output $(if($sessao.simulada){'FIM: simulacao encerrada; sem transacao real.'}else{'FIM: rollback/fechamento concluidos; nenhuma coleta/enviada.'})}
 }
}

# Dot-source so para testes: carrega definicoes, sem config/rede/trava/arquivo.
if($MyInvocation.InvocationName -eq '.'){return}
$mutexNF=$null;$mutexAdquiridoNF=$false;$travaNF=$null;$CodigoSaidaNF=1;$Pasta=$null
try{
 if(-not $Testar){throw 'parametro-invalido'}
 if($SimularFalha -and -not $Simular){throw 'parametro-invalido'}
 $Cfg=Get-Content -LiteralPath $Config -Raw -Encoding UTF8|ConvertFrom-Json
 if($Cfg.modo -cnotin @('teste','real')){throw 'parametro-invalido'}
 $extra=Campo $Cfg 'aceitar_permissoes_extras'
 if($null -ne $extra -and $extra -isnot [bool]){throw 'parametro-invalido'}
 $script:AceitarPermissoesExtras=($extra -eq $true)
 $pastaCfg=[string](Campo $Cfg 'pastaSaida')
 if([string]::IsNullOrWhiteSpace($pastaCfg) -or -not [IO.Path]::IsPathRooted($pastaCfg)){throw 'parametro-invalido'}
 $Cb=Ler-ConfigBanco $Cfg;$Pasta=[IO.Path]::GetFullPath($pastaCfg)
 $mutexNF=New-Object Threading.Mutex($false,'Global\TempRioSolidconBanco')
 try{$mutexAdquiridoNF=$mutexNF.WaitOne(0)}catch [Threading.AbandonedMutexException]{$mutexAdquiridoNF=$true}
 if(-not $mutexAdquiridoNF){throw 'nf550-ocupado'}
 if(-not [IO.Directory]::Exists($Pasta)){throw 'parametro-invalido'}
 try{$travaNF=[IO.File]::Open((Join-Path $Pasta 'sync-banco.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{throw 'nf550-ocupado'}
 Testar-ReferenciaNF550
 $CodigoSaidaNF=$script:CodigoReferencia
}catch{
 if($script:LinhaTrava){Write-Output $script:LinhaTrava}
 $motivo=if($_.Exception.Message -ceq 'nf550-ocupado'){'outra coleta esta ativa; repetir depois'}else{Descrever-Erro $_}
 Write-Output ('ERRO NF550: '+$motivo+'; verificacao nao concluida, nenhum dado enviado.')
}finally{
 if($travaNF){$travaNF.Dispose()}
 if($mutexAdquiridoNF){$mutexNF.ReleaseMutex()}
 if($mutexNF){$mutexNF.Dispose()}
}
exit $CodigoSaidaNF
