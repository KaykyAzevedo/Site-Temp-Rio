#requires -Version 5.1
# Coleta SOMENTE LEITURA pelo banco SQL Server da SOLIDCON (tarefa propria, a cada 5 min).
# Independente do sync-produtos.ps1 (API HTTP): outro mutex, outra trava, outro log.
# Acordo com a SOLIDCON: so VIEWS liberadas (dbo.VW_*/vw*), nunca tabelas tb*.
# Cada modulo: consulta FIXA (texto no codigo, so views da lista $ViewsPermitidas)
#   -> projecao explicita de colunas -> RPC Supabase propria -> log sem dados pessoais.
# Falha de um modulo nao impede os outros. Modulos: 'saude' (SELECT 1, toda execucao) e
# 'receber' (contas a receber abertas da filial 4, 1x/hora; 15 min apos erro) e
# 'margem' (vendas por dia+produto dos ultimos 3 dias e custos por produto, 1x/hora).
#   Normal:   sync-banco.ps1 [-Config C:\TempRio\solidcon\config-banco.json]
# Config PROPRIO (config-banco.json, com modo proprio). O config.json do sync-produtos so e
# LIDO, e so em modo real, para pegar a conta de integracao do Supabase; nunca e alterado.
#   Offline:  sync-banco.ps1 -Simular [-SimularFalha] [-Forcar]   (sem banco e sem Supabase)
#   -Forcar roda todos os modulos agora, ignorando o intervalo proprio de cada um.
#   Backfill da margem: sync-banco.ps1 -BackfillMargemDesde 2026-05-29 (so vendas da margem,
#   blocos de 31 dias ate hoje; nao mexe na agenda nem nos outros modulos).
[CmdletBinding()]
param(
    [string]$Config = 'C:\TempRio\solidcon\config-banco.json',
    [switch]$Simular,
    [switch]$SimularFalha,
    [switch]$Forcar,
    [ValidatePattern('^20[0-9]{2}-[0-9]{2}-[0-9]{2}$')][string]$BackfillMargemDesde
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

# Unicas views que qualquer modulo pode ler (nome exato, schema dbo), combinadas com a SOLIDCON.
$ViewsPermitidas = @('dbo.VW_RDUPHOLD_CONTASRECEBER_ABERTO', 'dbo.VW_MGN_PARCEIRO', 'dbo.VW_RDUPHOLD_VENDA_ITENS', 'dbo.VW_MGN_ESTOQUE')
# Consultas aprovadas na revisao, LITERAIS, por 'modulo.consulta': uma consulta so roda se o
# texto for identico ao daqui. E a garantia principal; o validador estrutural e defesa auxiliar.
# Toda consulta de dados filtra a FILIAL 4 (Temp Rio); as outras filiais nunca saem do banco.
$ConsultasAprovadas = @{
    'saude.ok' = "SELECT 1 AS ok, CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(32)) AS versao"
    'receber.parcelas' = "SELECT r.cdConta AS cd_conta, r.Documento AS documento_titulo, r.Vencimento AS vencimento, r.Valor_Parcela_Aberto AS valor_aberto, r.Valor_Fatura AS valor_fatura, r.Valor_Pago AS valor_pago, r.Valor_Parcela_Mora AS valor_mora, r.Valor_Parcela_Multa AS valor_multa, r.Valor_Parcela_Desconto AS valor_desconto, r.nmReceDesp AS categoria, r.cdNota AS cd_nota, r.Codigo_Fornecedor AS codigo_parceiro FROM dbo.VW_RDUPHOLD_CONTASRECEBER_ABERTO AS r WHERE r.Codigo_Filial = 4"
    'margem.vendas' = "SELECT CAST(v.DataMovimento AS date) AS dia, v.Codigo_Produto AS codigo_produto, SUM(v.quantidade_produto) AS quantidade, SUM(v.Vlitem) AS venda_soma, SUM(v.Vlitem * v.quantidade_produto) AS venda_x_qtd, SUM(v.Valor_total_unidade * v.quantidade_produto) AS venda_unidade_x_qtd, SUM(v.Valor_total_unidade) AS venda_unidade_soma, SUM(v.CustoItem) AS custo_soma, SUM(v.CustoItem * v.quantidade_produto) AS custo_x_qtd, COUNT(*) AS linhas, SUM(CASE WHEN v.quantidade_produto IS NULL THEN 1 ELSE 0 END) AS nulos_qtd, SUM(CASE WHEN v.Vlitem IS NULL THEN 1 ELSE 0 END) AS nulos_venda, SUM(CASE WHEN v.Valor_total_unidade IS NULL THEN 1 ELSE 0 END) AS nulos_unidade, SUM(CASE WHEN v.CustoItem IS NULL THEN 1 ELSE 0 END) AS nulos_custo FROM dbo.VW_RDUPHOLD_VENDA_ITENS AS v WHERE v.CodigoFilial = 4 AND v.DataMovimento >= @desde AND v.DataMovimento < @ate GROUP BY CAST(v.DataMovimento AS date), v.Codigo_Produto"
    'margem.custos' = "SELECT e.CodigoProduto AS codigo_produto, e.Unidade AS unidade, e.CustoMedioUnitario AS custo_medio, e.CustoReposicaoUnitario AS custo_reposicao, e.PrecoVenda AS preco_venda, e.DataUltimoRecebimento AS ultimo_recebimento FROM dbo.VW_MGN_ESTOQUE AS e WHERE e.CodigoFilial = 4 AND e.EstoqueTipo = 'Produto'"
    'receber.parceiros' = "SELECT p.CodigoParceiro AS codigo_parceiro, p.CNPJ AS documento FROM dbo.VW_MGN_PARCEIRO AS p WHERE p.CodigoParceiro IN (SELECT r.Codigo_Fornecedor FROM dbo.VW_RDUPHOLD_CONTASRECEBER_ABERTO AS r WHERE r.Codigo_Filial = 4)"
}
$RpcsPermitidas = @('solidcon_receber_banco_saude', 'solidcon_receber_contas_receber', 'solidcon_receber_margem_vendas', 'solidcon_receber_custos')
# Semantica de VW_RDUPHOLD_VENDA_ITENS CONFIRMADA pelo probe real da filial 4 (2026-11-12):
#   Vlitem = PRECO UNITARIO; Valor_total_unidade = TOTAL DA LINHA (apesar do nome);
#   CustoItem = CUSTO TOTAL DA LINHA. SUM(Valor_total_unidade) = SUM(Vlitem*qtd) conciliou com o
#   faturamento da API (03,04,09,10,11/11) com diferenca maxima de R$ 0,01 (03/11: 7780,51 x 7780,50);
#   SUM(CustoItem*qtd) daria custo ~17x a receita (absurdo).
#   venda = SUM(Valor_total_unidade) (valor da linha, sem multiplicacao/arredondamento extra);
#   custo = SUM(CustoItem). As demais variantes ficam so para diagnostico; trocar exige revisao.
#   venda: 'venda_unidade_soma' (confirmada) | 'venda_x_qtd' (equivalente) | 'venda_soma' | 'venda_unidade_x_qtd'
#   custo: 'custo_soma' (confirmada) | 'custo_x_qtd'
$SemanticaMargem = @{ venda = 'venda_unidade_soma'; custo = 'custo_soma' }
# Variantes aceitas e as contagens de NULL que precisam ser 0 para o agregado valer.
$VariantesVenda = @{ venda_soma = @('nulos_venda'); venda_x_qtd = @('nulos_venda', 'nulos_qtd'); venda_unidade_x_qtd = @('nulos_unidade', 'nulos_qtd'); venda_unidade_soma = @('nulos_unidade') }
$VariantesCusto = @{ custo_soma = @('nulos_custo'); custo_x_qtd = @('nulos_custo', 'nulos_qtd') }
$DataMinimaMargem = [datetime]'2026-05-29'

# Preparacao fixa de toda sessao (texto interno; nao passa pelo validador de modulos).
$SqlSessao = 'SET NOCOUNT ON; SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET LOCK_TIMEOUT 5000; SET DEADLOCK_PRIORITY LOW;'
# Permissoes EFETIVAS do login (base, schema, objeto, coluna, papeis). Qualquer 1 = pode gravar
# ou executar; NULL = nao deu para conferir. Os dois casos falham fechado. O login so enxerga
# objetos em que tem algum privilegio (visibilidade de metadados), justamente os que poderiam
# ser gravados. Unica excecao: INSERT/UPDATE/DELETE/EXECUTE de nivel SCHEMA em schema cujo dono
# e um papel fixo do banco (principal_id 16384-16393, ex.: 'db_datareader') e que NAO tem nenhum
# objeto (sem objeto, esses direitos nao alcancam nada; um objeto faz voltar a contar).
# ALTER/CONTROL/TAKE OWNERSHIP/CREATE SEQUENCE de schema contam SEMPRE, inclusive nesses schemas:
# CREATE SEQUENCE so exige ALTER/CONTROL no schema (sem CREATE na base) = DDL real.
# Devolve contagens por nivel/tipo.
# Mesmo texto no configurar-senha-banco.ps1. NAO substitui a confirmacao do DBA da SOLIDCON.
$SqlPermissoes = @'
SELECT
  SUM(CASE WHEN t.v = 1 THEN 1 ELSE 0 END) AS escrita,
  SUM(CASE WHEN t.v IS NULL THEN 1 ELSE 0 END) AS inconclusivo,
  COUNT(*) AS verificados,
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
  SELECT 'schema', 'g', HAS_PERMS_BY_NAME(QUOTENAME(s.name), 'SCHEMA', p.n)
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
        $p = Ler-Linhas $cmd ($ColunasPermissoes) 1
        # Login de consulta nunca pode gravar: se puder, ou se nao der para conferir, ninguem coleta.
        if ($p.Count -ne 1 -or $null -eq $p[0].escrita -or $null -eq $p[0].inconclusivo -or
            $null -eq $p[0].verificados -or [int]$p[0].verificados -lt 17) { throw 'permissao-inconclusiva' }
        if ([int]$p[0].escrita -ne 0) { $script:DetalhePermissoes = Resumo-Permissoes $p[0]; throw 'login-com-escrita' }
        if ([int]$p[0].inconclusivo -ne 0) { throw 'permissao-inconclusiva' }
        return @{ simulada = $false; con = $con }
    } catch {
        $con.Dispose()
        throw
    } finally { $senha.Dispose() }
}

$ColunasPermissoes = @('escrita', 'inconclusivo', 'verificados', 'base_execucao', 'base_gravacao', 'schema_execucao',
    'schema_gravacao', 'objeto_execucao', 'objeto_gravacao', 'coluna_gravacao', 'papel_gravacao')
$DetalhePermissoes = ''

function Resumo-Permissoes($L) {
    # So contagens (nunca nomes de schema/objeto): onde e de que tipo.
    function N($v) { if ($null -eq $v -or $v -is [DBNull]) { '?' } else { [string][int]$v } }
    return ('execucao: base {0}, schema {1}, objeto {2}; gravacao: base {3}, schema {4}, objeto {5}, coluna {6}, papel {7}' -f
        (N $L['base_execucao']), (N $L['schema_execucao']), (N $L['objeto_execucao']),
        (N $L['base_gravacao']), (N $L['schema_gravacao']), (N $L['objeto_gravacao']), (N $L['coluna_gravacao']), (N $L['papel_gravacao']))
}

function Fechar-Sessao($Sessao) {
    if ($Sessao -and $Sessao.con) { $Sessao.con.Dispose() }
}

function Executar-Consulta($Sessao, $Modulo, [string]$Nome, [hashtable]$Valores = @{}) {
    $c = $Modulo.consultas[$Nome]
    $null = Validar-ConsultaFixa ($Modulo.nome + '.' + $Nome) $c.sql
    # Parametros: so os declarados na consulta, so datas, sempre tipados (nunca texto no SQL).
    $declarados = if ($c.ContainsKey('parametros')) { @($c.parametros) } else { @() }
    foreach ($k in $Valores.Keys) { if ($k -cnotin $declarados) { throw 'parametro-invalido' } }
    foreach ($k in $declarados) { if (-not $Valores.ContainsKey($k) -or $Valores[$k] -isnot [datetime]) { throw 'parametro-invalido' } }
    if ($Sessao.simulada) { return ,(& $c.simulacao $Valores) }
    $cmd = $Sessao.con.CreateCommand()
    $cmd.CommandTimeout = 30
    $cmd.CommandText = $c.sql
    foreach ($k in $declarados) {
        $par = $cmd.Parameters.Add('@' + $k, [Data.SqlDbType]::DateTime)
        $par.Value = $Valores[$k]
    }
    return ,(Ler-Linhas $cmd $c.colunas $c.maxLinhas)
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
    }
    if ($m -ceq 'login-com-escrita' -and $script:DetalhePermissoes) { return ($fixas[$m] + ' (' + $script:DetalhePermissoes + ')') }
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
    nome = 'saude'; codigo = 2; intervaloMin = 0; intervaloErroMin = 0
    consultas = [ordered]@{
        ok = @{
            maxLinhas = 1; colunas = @('ok', 'versao')
            sql = "SELECT 1 AS ok, CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(32)) AS versao"
            simulacao = { ,@(@{ ok = 1; versao = '16.0.4135.4' }) }
        }
    }
}

function Modulo-Saude($Modulo) {
    $relogio = [Diagnostics.Stopwatch]::StartNew()
    $status = 'ok'; $versao = $null; $mensagemErro = $null; $sessao = $null
    try {
        $sessao = Abrir-Sessao
        $linhas = Executar-Consulta $sessao $Modulo 'ok'
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
    }) (Join-Path $Pasta ('banco-saude-ultimo-' + (Sufixo-Estado) + '.json'))
    $linhaLog = 'saude modo={0}{1} status={2} duracao_ms={3} versao={4} enviado={5} execucao={6}' -f
        $Cfg.modo, $(if ($Simular) { ' SIMULADO' } else { '' }), $status, $duracao, $(if ($versao) { $versao } else { '-' }), $enviado, $ExecucaoId
    if ($status -eq 'ok') { Log ('OK ' + $linhaLog) }
    else { Log ('ERRO ' + $linhaLog + ' motivo=' + $mensagemErro); throw 'modulo-com-erro' }
}

# ---------- agenda por modulo (intervalo proprio dentro da tarefa de 5 min) ----------
# Simulacao tem arquivos proprios: nunca adia nem antecipa a coleta de verdade.
function Sufixo-Estado { if ($Simular) { $Cfg.modo + '-simulado' } else { $Cfg.modo } }
function Caminho-Agenda([string]$Nome) { Join-Path $Pasta ('banco-' + $Nome + '-agenda-' + (Sufixo-Estado) + '.json') }

function Modulo-Devido($Def) {
    if ($Forcar -or $Def.intervaloMin -le 0) { return $true }
    $caminho = Caminho-Agenda $Def.nome
    # Agenda inexistente = primeira vez. Qualquer outra coisa ilegivel = falha fechado (nao consulta).
    if ([IO.Directory]::Exists($caminho)) { throw 'agenda-invalida' }
    if (-not [IO.File]::Exists($caminho)) { return $true }
    try {
        $a = Get-Content -LiteralPath $caminho -Raw -Encoding UTF8 | ConvertFrom-Json
        $proxima = [DateTimeOffset]::Parse([string]$a.proxima, $Invariant)
    } catch { throw 'agenda-invalida' }
    # Relogio voltou (proxima absurda) = roda; senao respeita a agenda.
    if ($proxima -gt [DateTimeOffset]::UtcNow.AddMinutes($Def.intervaloMin + 5)) { return $true }
    return [DateTimeOffset]::UtcNow -ge $proxima
}

function Agendar-Modulo($Def, [bool]$Ok) {
    if ($Def.intervaloMin -le 0) { return }
    $min = if ($Ok) { $Def.intervaloMin } else { $Def.intervaloErroMin }
    # Folga de 2 min: a tarefa de 5 em 5 min nao escorrega uma rodada por segundos.
    Salvar-Json ([ordered]@{ proxima = [DateTimeOffset]::UtcNow.AddMinutes($min - 2).ToString('o', $Invariant); ok = $Ok }) (Caminho-Agenda $Def.nome)
}

# ---------- receber: contas a receber ABERTAS da filial 4 ----------
function Cnpj-Valido([string]$D) {
    if ($D -notmatch '^[0-9]{14}$' -or $D -match '^(.)\1+$') { return $false }
    foreach ($k in 12, 13) {
        $pesos = if ($k -eq 12) { 5,4,3,2,9,8,7,6,5,4,3,2 } else { 6,5,4,3,2,9,8,7,6,5,4,3,2 }
        $soma = 0
        for ($i = 0; $i -lt $k; $i++) { $soma += [int][string]$D[$i] * $pesos[$i] }
        $r = $soma % 11
        $dv = if ($r -lt 2) { 0 } else { 11 - $r }
        if ($dv -ne [int][string]$D[$k]) { return $false }
    }
    return $true
}

function Centavos-Banco($Valor, [bool]$Obrigatorio) {
    if ($null -eq $Valor -or $Valor -is [DBNull]) { if ($Obrigatorio) { throw 'parcela-invalida' }; return $null }
    if ($Valor -isnot [decimal] -and $Valor -isnot [int] -and $Valor -isnot [long] -and $Valor -isnot [double]) { throw 'parcela-invalida' }
    # Negativo e recusado no valor BRUTO (antes de arredondar: -0,001 nao vira 0).
    if ([decimal]$Valor -lt 0) { throw 'parcela-invalida' }
    $c = [decimal]::Round(([decimal]$Valor) * 100, 0, [MidpointRounding]::AwayFromZero)
    if ($c -gt 999999999999999) { throw 'parcela-invalida' }
    return [long]$c
}

function Inteiro-Banco($Valor) {
    if ($null -eq $Valor -or $Valor -is [DBNull]) { return $null }
    if ($Valor -isnot [int] -and $Valor -isnot [long] -and $Valor -isnot [byte] -and $Valor -isnot [int16] -and $Valor -isnot [decimal]) { throw 'parcela-invalida' }
    $n = [decimal]$Valor
    if ($n -le 0 -or [decimal]::Truncate($n) -ne $n -or $n -gt 999999999999999999) { return $null }
    return [long]$n
}

function Texto-Curto($Valor, [int]$Max, [string]$Padrao) {
    if ($null -eq $Valor -or $Valor -is [DBNull]) { return $null }
    $t = ([string]$Valor).Trim()
    if ($t.Length -eq 0 -or $t.Length -gt $Max -or $t -notmatch $Padrao) { return $null }
    return $t
}

function Id-Parcela([long]$Conta, [string]$Vencimento, [string]$Titulo) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $h = $sha.ComputeHash($Utf8.GetBytes(('{0}|{1}|{2}' -f $Conta, $Vencimento, $Titulo)))
    } finally { $sha.Dispose() }
    return (-join ($h[0..15] | ForEach-Object { $_.ToString('x2') }))
}

function Normalizar-Receber($Parcelas, $Parceiros) {
    # Parceiro -> CNPJ so digitos. Codigo repetido com documentos diferentes = sem documento.
    $docs = @{}
    foreach ($p in $Parceiros) {
        $cod = Inteiro-Banco $p.codigo_parceiro
        if ($null -eq $cod) { continue }
        $d = if ($null -eq $p.documento -or $p.documento -is [DBNull]) { '' } else { ([string]$p.documento) -replace '[^0-9]', '' }
        if ($docs.ContainsKey($cod) -and $docs[$cod] -cne $d) { $docs[$cod] = '' } else { $docs[$cod] = $d }
    }
    $itens = New-Object Collections.ArrayList
    $ids = @{}
    $cont = @{ cnpj = 0; pf = 0; sem_documento = 0 }
    foreach ($l in $Parcelas) {
        $conta = Inteiro-Banco $l.cd_conta
        if ($null -eq $conta -or $l.vencimento -isnot [datetime]) { throw 'parcela-invalida' }
        $venc = $l.vencimento.ToString('yyyy-MM-dd', $Invariant)
        $tituloBruto = if ($null -eq $l.documento_titulo -or $l.documento_titulo -is [DBNull]) { '' } else { ([string]$l.documento_titulo).Trim() }
        $id = Id-Parcela $conta $venc $tituloBruto
        if ($ids.ContainsKey($id)) { throw 'parcelas-duplicadas' }
        $ids[$id] = $true
        $cod = Inteiro-Banco $l.codigo_parceiro
        $doc = if ($null -ne $cod -and $docs.ContainsKey($cod)) { $docs[$cod] } else { '' }
        $tipo = if ($doc.Length -eq 14 -and (Cnpj-Valido $doc)) { 'cnpj' } elseif ($doc.Length -eq 11) { 'pf' } else { 'sem_documento' }
        $cont[$tipo]++
        $titulo = Texto-Curto $l.documento_titulo 30 '^[0-9A-Za-z./ -]+$'
        $nota = Inteiro-Banco $l.cd_nota
        $item = [ordered]@{
            id = $id; tipo = $tipo
            documento = $(if ($tipo -eq 'cnpj') { $doc } else { $null })
            codigo_parceiro = $(if ($tipo -eq 'cnpj') { [long]$cod } else { $null })
            # Pessoa fisica: so valores e vencimento (nada que identifique).
            documento_titulo = $(if ($tipo -eq 'pf') { $null } else { $titulo })
            cd_nota = $(if ($tipo -eq 'pf') { $null } else { $nota })
            vencimento = $venc
            valor_aberto = Centavos-Banco $l.valor_aberto $true
            valor_fatura = Centavos-Banco $l.valor_fatura $false
            valor_pago = Centavos-Banco $l.valor_pago $false
            valor_mora = Centavos-Banco $l.valor_mora $false
            valor_multa = Centavos-Banco $l.valor_multa $false
            valor_desconto = Centavos-Banco $l.valor_desconto $false
            categoria = Texto-Curto $l.categoria 100 '^[^\x00-\x1F\x7F]+$'
        }
        [void]$itens.Add($item)
    }
    return @{ itens = [object[]]$itens.ToArray(); contagens = $cont }
}

$ModuloReceber = @{
    nome = 'receber'; codigo = 3; intervaloMin = 60; intervaloErroMin = 15
    consultas = [ordered]@{
        parcelas = @{
            maxLinhas = 10000
            colunas = @('cd_conta', 'documento_titulo', 'vencimento', 'valor_aberto', 'valor_fatura', 'valor_pago',
                        'valor_mora', 'valor_multa', 'valor_desconto', 'categoria', 'cd_nota', 'codigo_parceiro')
            sql = "SELECT r.cdConta AS cd_conta, r.Documento AS documento_titulo, r.Vencimento AS vencimento, r.Valor_Parcela_Aberto AS valor_aberto, r.Valor_Fatura AS valor_fatura, r.Valor_Pago AS valor_pago, r.Valor_Parcela_Mora AS valor_mora, r.Valor_Parcela_Multa AS valor_multa, r.Valor_Parcela_Desconto AS valor_desconto, r.nmReceDesp AS categoria, r.cdNota AS cd_nota, r.Codigo_Fornecedor AS codigo_parceiro FROM dbo.VW_RDUPHOLD_CONTASRECEBER_ABERTO AS r WHERE r.Codigo_Filial = 4"
            # Dados FICTICIOS para -Simular (CNPJ de exemplo valido, nenhum cliente real).
            simulacao = {
                $d = [datetime]::Today
                ,@(
                    @{ cd_conta = 101; documento_titulo = 'NF100/1'; vencimento = $d.AddDays(-12); valor_aberto = [decimal]150.5; valor_fatura = [decimal]301; valor_pago = [decimal]150.5; valor_mora = [decimal]0; valor_multa = [decimal]0; valor_desconto = [decimal]0; categoria = 'VENDA A PRAZO'; cd_nota = 900; codigo_parceiro = 1 },
                    @{ cd_conta = 101; documento_titulo = 'NF100/2'; vencimento = $d.AddDays(18); valor_aberto = [decimal]150.5; valor_fatura = [decimal]301; valor_pago = $null; valor_mora = $null; valor_multa = $null; valor_desconto = $null; categoria = 'VENDA A PRAZO'; cd_nota = 900; codigo_parceiro = 1 },
                    @{ cd_conta = 102; documento_titulo = 'NF101'; vencimento = $d.AddDays(5); valor_aberto = [decimal]80; valor_fatura = [decimal]80; valor_pago = $null; valor_mora = $null; valor_multa = $null; valor_desconto = $null; categoria = 'VENDA A PRAZO'; cd_nota = 901; codigo_parceiro = 2 },
                    @{ cd_conta = 103; documento_titulo = $null; vencimento = $d.AddDays(1); valor_aberto = [decimal]10; valor_fatura = $null; valor_pago = $null; valor_mora = $null; valor_multa = $null; valor_desconto = $null; categoria = $null; cd_nota = $null; codigo_parceiro = 3 }
                )
            }
        }
        parceiros = @{
            maxLinhas = 10000
            colunas = @('codigo_parceiro', 'documento')
            sql = "SELECT p.CodigoParceiro AS codigo_parceiro, p.CNPJ AS documento FROM dbo.VW_MGN_PARCEIRO AS p WHERE p.CodigoParceiro IN (SELECT r.Codigo_Fornecedor FROM dbo.VW_RDUPHOLD_CONTASRECEBER_ABERTO AS r WHERE r.Codigo_Filial = 4)"
            simulacao = { ,@(@{ codigo_parceiro = 1; documento = '11.222.333/0001-81' }, @{ codigo_parceiro = 2; documento = '00000000191' }) }
        }
    }
}

function Modulo-Receber($Modulo) {
    $relogio = [Diagnostics.Stopwatch]::StartNew()
    $sessao = $null
    try {
        $sessao = Abrir-Sessao
        $parcelas = Executar-Consulta $sessao $Modulo 'parcelas'
        $parceiros = Executar-Consulta $sessao $Modulo 'parceiros'
        $coleta = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", $Invariant)
    } catch {
        $motivo = Descrever-Erro $_
        Log ('ERRO receber modo={0} fase=consulta motivo={1} execucao={2}' -f $Cfg.modo, $motivo, $ExecucaoId)
        throw 'modulo-com-erro'
    } finally { Fechar-Sessao $sessao }
    try { $normal = Normalizar-Receber $parcelas $parceiros }
    catch {
        Log ('ERRO receber modo={0} fase=normalizacao motivo={1} execucao={2}' -f $Cfg.modo, (Descrever-Erro $_), $ExecucaoId)
        throw 'modulo-com-erro'
    }
    $c = $normal.contagens
    $enviado = 'nao'
    if ($Real -and -not $Simular) {
        $script:Fase = 'envio'
        $resposta = Chamar-Rpc 'solidcon_receber_contas_receber' @{ p_itens = $normal.itens; p_coletado_em = $coleta; p_execucao_id = $ExecucaoId }
        if ((Campo $resposta 'status') -cne 'ok') {
            $mot = [string](Campo $resposta 'motivo')
            if ($mot -notmatch '^[a-z0-9_]{1,40}$') { $mot = 'sem_motivo' }
            Log ('ERRO receber modo={0} fase=rpc motivo={1} linhas={2} execucao={3}' -f $Cfg.modo, $mot, $normal.itens.Count, $ExecucaoId)
            throw 'modulo-com-erro'
        }
        $enviado = 'sim'
    } elseif (-not $Real) {
        # Modo teste: o lote que SERIA enviado fica so na pasta de saida, para conferencia.
        $script:Fase = 'estado-local'
        Salvar-Json ([ordered]@{ coletado_em = $coleta; execucao_id = $ExecucaoId; simulado = [bool]$Simular; itens = $normal.itens }) (Join-Path $Pasta 'banco-receber-teste.json')
    }
    $relogio.Stop()
    Log ('OK receber modo={0}{1} linhas={2} cnpj={3} pf={4} sem_documento={5} duracao_ms={6} enviado={7} execucao={8}' -f
        $Cfg.modo, $(if ($Simular) { ' SIMULADO' } else { '' }), $normal.itens.Count, $c.cnpj, $c.pf, $c.sem_documento,
        $relogio.ElapsedMilliseconds, $enviado, $ExecucaoId)
}


# ---------- margem: vendas por dia+produto e custos por produto da filial 4 ----------
function Centavos-Assinado($Valor) {
    # Vendas do dia podem ser negativas (devolucao): sinal preservado, arredondamento simetrico.
    # Desconhecido nunca vira zero (margem de 100% inventada): falha a janela.
    if ($null -eq $Valor -or $Valor -is [DBNull]) { throw 'margem-incompleta' }
    if ($Valor -isnot [decimal] -and $Valor -isnot [int] -and $Valor -isnot [long] -and $Valor -isnot [double]) { throw 'margem-invalida' }
    $c = [decimal]::Round(([decimal]$Valor) * 100, 0, [MidpointRounding]::AwayFromZero)
    if ([Math]::Abs($c) -gt 999999999999999) { throw 'margem-invalida' }
    return [long]$c
}

function Janelas-Margem([datetime]$Desde, [datetime]$Ate) {
    # Blocos [desde, ate) de ate 31 dias (a RPC aceita ate 62).
    $j = New-Object Collections.ArrayList
    $d = $Desde.Date
    while ($d -lt $Ate) {
        $f = $d.AddDays(31); if ($f -gt $Ate) { $f = $Ate }
        [void]$j.Add(@{ desde = $d; ate = $f }); $d = $f
    }
    return ,$j.ToArray()
}

function Hoje-SaoPaulo {
    $z = [TimeZoneInfo]::FindSystemTimeZoneById('E. South America Standard Time')
    return [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $z).Date
}

function Estado-Semantica {
    # 'pendente' = as duas $null (conhecido, nao falha no ciclo normal); 'ok'; 'invalida' = falha fechado.
    if ($null -eq $SemanticaMargem.venda -and $null -eq $SemanticaMargem.custo) { return 'pendente' }
    if ($SemanticaMargem.venda -is [string] -and $SemanticaMargem.custo -is [string] -and
        $VariantesVenda.ContainsKey($SemanticaMargem.venda) -and $VariantesCusto.ContainsKey($SemanticaMargem.custo)) { return 'ok' }
    return 'invalida'
}

function Normalizar-MargemVendas($Linhas, [datetime]$Desde, [datetime]$Ate) {
    $estado = Estado-Semantica
    if ($estado -ne 'ok') { throw ('semantica-' + $estado) }
    $exigidas = @('nulos_qtd') + $VariantesVenda[$SemanticaMargem.venda] + $VariantesCusto[$SemanticaMargem.custo]
    $itens = New-Object Collections.ArrayList
    $vistos = @{}
    foreach ($l in $Linhas) {
        $cod = Inteiro-Banco $l.codigo_produto
        if ($null -eq $cod -or $cod -gt 2147483647 -or $l.dia -isnot [datetime]) { throw 'margem-invalida' }
        if ($l.dia.Date -lt $Desde -or $l.dia.Date -ge $Ate) { throw 'margem-invalida' }
        $dia = $l.dia.ToString('yyyy-MM-dd', $Invariant)
        $chave = $dia + '|' + $cod
        if ($vistos.ContainsKey($chave)) { throw 'margem-duplicada' }
        $vistos[$chave] = $true
        if ($null -eq $l.quantidade -or $l.quantidade -is [DBNull] -or $l.quantidade -isnot [decimal]) { throw 'margem-invalida' }
        $q = [decimal]::Round([decimal]$l.quantidade, 3, [MidpointRounding]::AwayFromZero)
        if ([Math]::Abs($q) -ge 1000000000000) { throw 'margem-invalida' }
        $n = Inteiro-Banco $l.linhas
        if ($null -eq $n) { throw 'margem-invalida' }
        # Completude: SUM ignora NULL; com qualquer linha nula na variante usada o agregado seria parcial.
        foreach ($k in ($exigidas | Select-Object -Unique)) {
            $z = $l[$k]
            if ($null -eq $z -or $z -is [DBNull] -or ($z -isnot [int] -and $z -isnot [long] -and $z -isnot [decimal])) { throw 'margem-incompleta' }
            if ([decimal]$z -ne 0) { throw 'margem-incompleta' }
        }
        [void]$itens.Add([ordered]@{
            dia = $dia; codigo_produto = [long]$cod; quantidade = $q
            venda = Centavos-Assinado $l[$SemanticaMargem.venda]
            custo = Centavos-Assinado $l[$SemanticaMargem.custo]
            linhas = [long]$n
        })
    }
    return ,$itens.ToArray()
}

function Normalizar-Custos($Linhas) {
    $mapa = [ordered]@{}
    $negativos = 0
    foreach ($l in $Linhas) {
        $cod = Inteiro-Banco $l.codigo_produto
        if ($null -eq $cod -or $cod -gt 2147483647) { throw 'custo-invalido' }
        $un = Texto-Curto $l.unidade 20 '^[0-9A-Za-z./ -]+$'
        if ($null -eq $un) { $un = '-' }
        $vals = @{}
        foreach ($k in 'custo_medio', 'custo_reposicao', 'preco_venda') {
            $v = $l[$k]
            if ($null -eq $v -or $v -is [DBNull]) { $vals[$k] = $null; continue }
            if ($v -isnot [decimal] -and $v -isnot [double] -and $v -isnot [int] -and $v -isnot [long]) { throw 'custo-invalido' }
            # Custo/preco negativo no ERP (estoque negativo etc.): fica sem valor, contado no log.
            if ([decimal]$v -lt 0) { $vals[$k] = $null; $negativos++; continue }
            $vals[$k] = Centavos-Banco $v $true
        }
        $rec = $null
        if ($l.ultimo_recebimento -is [datetime] -and $l.ultimo_recebimento.Year -ge 1990 -and $l.ultimo_recebimento.Year -le 2099) {
            $rec = $l.ultimo_recebimento.ToString('yyyy-MM-dd', $Invariant)
        }
        $item = [ordered]@{
            codigo_produto = [long]$cod; unidade = $un
            custo_medio = $vals.custo_medio; custo_reposicao = $vals.custo_reposicao; preco_venda = $vals.preco_venda
            ultimo_recebimento = $rec
        }
        $chave = [string]$cod + '|' + $un
        if ($mapa.Contains($chave)) {
            # Linha repetida identica e ignorada; repetida com valores diferentes falha a coleta.
            if ((ConvertTo-Json $mapa[$chave] -Compress) -cne (ConvertTo-Json $item -Compress)) { throw 'custos-duplicados' }
            continue
        }
        $mapa[$chave] = $item
    }
    return @{ itens = [object[]]@($mapa.Values); negativos = $negativos }
}

$ModuloMargem = @{
    nome = 'margem'; codigo = 4; intervaloMin = 60; intervaloErroMin = 15
    consultas = [ordered]@{
        vendas = @{
            maxLinhas = 50000; parametros = @('desde', 'ate')
            colunas = @('dia', 'codigo_produto', 'quantidade', 'venda_soma', 'venda_x_qtd', 'venda_unidade_x_qtd', 'venda_unidade_soma', 'custo_soma', 'custo_x_qtd', 'linhas',
                        'nulos_qtd', 'nulos_venda', 'nulos_unidade', 'nulos_custo')
            sql = "SELECT CAST(v.DataMovimento AS date) AS dia, v.Codigo_Produto AS codigo_produto, SUM(v.quantidade_produto) AS quantidade, SUM(v.Vlitem) AS venda_soma, SUM(v.Vlitem * v.quantidade_produto) AS venda_x_qtd, SUM(v.Valor_total_unidade * v.quantidade_produto) AS venda_unidade_x_qtd, SUM(v.Valor_total_unidade) AS venda_unidade_soma, SUM(v.CustoItem) AS custo_soma, SUM(v.CustoItem * v.quantidade_produto) AS custo_x_qtd, COUNT(*) AS linhas, SUM(CASE WHEN v.quantidade_produto IS NULL THEN 1 ELSE 0 END) AS nulos_qtd, SUM(CASE WHEN v.Vlitem IS NULL THEN 1 ELSE 0 END) AS nulos_venda, SUM(CASE WHEN v.Valor_total_unidade IS NULL THEN 1 ELSE 0 END) AS nulos_unidade, SUM(CASE WHEN v.CustoItem IS NULL THEN 1 ELSE 0 END) AS nulos_custo FROM dbo.VW_RDUPHOLD_VENDA_ITENS AS v WHERE v.CodigoFilial = 4 AND v.DataMovimento >= @desde AND v.DataMovimento < @ate GROUP BY CAST(v.DataMovimento AS date), v.Codigo_Produto"
            # FICTICIO: 2 produtos por dia da janela (um com devolucao).
            simulacao = {
                param($v)
                $r = New-Object Collections.ArrayList
                for ($d = $v.desde; $d -lt $v.ate; $d = $d.AddDays(1)) {
                    [void]$r.Add(@{ dia = $d; codigo_produto = 501; quantidade = [decimal]3; venda_soma = [decimal]90; venda_x_qtd = [decimal]270; venda_unidade_x_qtd = [decimal]810; venda_unidade_soma = [decimal]270; custo_soma = [decimal]54.3; custo_x_qtd = [decimal]162.9; linhas = 2; nulos_qtd = 0; nulos_venda = 0; nulos_unidade = 0; nulos_custo = 0 })
                    [void]$r.Add(@{ dia = $d; codigo_produto = 502; quantidade = [decimal]-1; venda_soma = [decimal]-25.5; venda_x_qtd = [decimal]25.5; venda_unidade_x_qtd = [decimal]25.5; venda_unidade_soma = [decimal]-25.5; custo_soma = [decimal]-12; custo_x_qtd = [decimal]12; linhas = 1; nulos_qtd = 0; nulos_venda = 0; nulos_unidade = 0; nulos_custo = 0 })
                }
                ,$r.ToArray()
            }
        }
        custos = @{
            maxLinhas = 20000
            colunas = @('codigo_produto', 'unidade', 'custo_medio', 'custo_reposicao', 'preco_venda', 'ultimo_recebimento')
            sql = "SELECT e.CodigoProduto AS codigo_produto, e.Unidade AS unidade, e.CustoMedioUnitario AS custo_medio, e.CustoReposicaoUnitario AS custo_reposicao, e.PrecoVenda AS preco_venda, e.DataUltimoRecebimento AS ultimo_recebimento FROM dbo.VW_MGN_ESTOQUE AS e WHERE e.CodigoFilial = 4 AND e.EstoqueTipo = 'Produto'"
            simulacao = {
                param($v)
                ,@(
                    @{ codigo_produto = 501; unidade = 'CX'; custo_medio = [decimal]18.1; custo_reposicao = [decimal]19; preco_venda = [decimal]30; ultimo_recebimento = [datetime]::Today.AddDays(-4) },
                    @{ codigo_produto = 502; unidade = 'CX'; custo_medio = [decimal]-2; custo_reposicao = [decimal]12; preco_venda = [decimal]25.5; ultimo_recebimento = [datetime]'1899-12-30' },
                    @{ codigo_produto = 503; unidade = $null; custo_medio = $null; custo_reposicao = $null; preco_venda = [decimal]10; ultimo_recebimento = $null }
                )
            }
        }
    }
}

function Enviar-Lote([string]$Rpc, $Dados, [string]$Rotulo) {
    $resposta = Chamar-Rpc $Rpc $Dados
    if ((Campo $resposta 'status') -cne 'ok') {
        $mot = [string](Campo $resposta 'motivo')
        if ($mot -notmatch '^[a-z0-9_]{1,40}$') { $mot = 'sem_motivo' }
        Log ('ERRO margem {0} modo={1} fase=rpc motivo={2} execucao={3}' -f $Rotulo, $Cfg.modo, $mot, $ExecucaoId) | Out-Host
        return $false
    }
    return $true
}

function Margem-Vendas($Sessao, $Modulo, $Janelas) {
    $estado = Estado-Semantica
    if ($estado -eq 'invalida') {
        Log ('ERRO margem vendas modo={0} fase=configuracao motivo=semantica de venda/custo invalida no script; nada consultado.' -f $Cfg.modo)
        $script:MargemOk = $false
        return
    }
    if ($estado -eq 'pendente') {
        # Configuracao conhecida e pendente: avisa sem consultar a view nem enviar.
        Log ('AVISO margem vendas modo={0}: semantica de Vlitem/CustoItem ainda nao confirmada; nada consultado nem enviado.' -f $Cfg.modo)
        # No ciclo normal e pendencia conhecida (nao falha); no backfill pedido explicitamente, falha.
        if ($BackfillMargemDesde) { $script:MargemOk = $false }
        return
    }
    foreach ($j in $Janelas) {
        $rot = 'vendas {0}..{1}' -f $j.desde.ToString('yyyy-MM-dd'), $j.ate.AddDays(-1).ToString('yyyy-MM-dd')
        try {
            $linhas = Executar-Consulta $Sessao $Modulo 'vendas' @{ desde = $j.desde; ate = $j.ate }
            $coleta = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", $Invariant)
            $itens = Normalizar-MargemVendas $linhas $j.desde $j.ate
        } catch {
            Log ('ERRO margem {0} modo={1} fase=consulta motivo={2} execucao={3}' -f $rot, $Cfg.modo, (Descrever-Erro $_), $ExecucaoId)
            $script:MargemOk = $false; continue
        }
        $enviado = 'nao'
        $fasePart = 'envio'
        try {
            if ($Real -and -not $Simular) {
                if (-not (Enviar-Lote 'solidcon_receber_margem_vendas' @{ p_desde = $j.desde.ToString('yyyy-MM-dd'); p_ate = $j.ate.ToString('yyyy-MM-dd'); p_itens = [object[]]$itens; p_coletado_em = $coleta; p_execucao_id = $ExecucaoId } $rot)) { $script:MargemOk = $false; continue }
                $enviado = 'sim'
            } elseif (-not $Real) {
                $fasePart = 'estado-local'
                Salvar-Json ([ordered]@{ desde = $j.desde.ToString('yyyy-MM-dd'); ate = $j.ate.ToString('yyyy-MM-dd'); coletado_em = $coleta; simulado = [bool]$Simular; itens = [object[]]$itens }) (Join-Path $Pasta 'banco-margem-vendas-teste.json')
            }
        } catch {
            # Transporte/HTTP/disco: so fase fixa (nunca corpo/mensagem); segue para os proximos blocos e custos.
            Log ('ERRO margem {0} modo={1} fase={2} execucao={3}' -f $rot, $Cfg.modo, $fasePart, $ExecucaoId)
            $script:MargemOk = $false; continue
        }
        Log ('OK margem {0} modo={1}{2} linhas={3} enviado={4} execucao={5}' -f $rot, $Cfg.modo, $(if ($Simular) { ' SIMULADO' } else { '' }), $itens.Count, $enviado, $ExecucaoId)
    }
}

function Margem-Custos($Sessao, $Modulo) {
    try {
        $linhas = Executar-Consulta $Sessao $Modulo 'custos'
        $coleta = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", $Invariant)
        $n = Normalizar-Custos $linhas
    } catch {
        Log ('ERRO margem custos modo={0} fase=consulta motivo={1} execucao={2}' -f $Cfg.modo, (Descrever-Erro $_), $ExecucaoId)
        $script:MargemOk = $false; return
    }
    $enviado = 'nao'
    $fasePart = 'envio'
    try {
        if ($Real -and -not $Simular) {
            if (-not (Enviar-Lote 'solidcon_receber_custos' @{ p_itens = $n.itens; p_coletado_em = $coleta; p_execucao_id = $ExecucaoId } 'custos')) { $script:MargemOk = $false; return }
            $enviado = 'sim'
        } elseif (-not $Real) {
            $fasePart = 'estado-local'
            Salvar-Json ([ordered]@{ coletado_em = $coleta; simulado = [bool]$Simular; itens = $n.itens }) (Join-Path $Pasta 'banco-margem-custos-teste.json')
        }
    } catch {
        Log ('ERRO margem custos modo={0} fase={1} execucao={2}' -f $Cfg.modo, $fasePart, $ExecucaoId)
        $script:MargemOk = $false; return
    }
    Log ('OK margem custos modo={0}{1} linhas={2} valores_negativos_descartados={3} enviado={4} execucao={5}' -f $Cfg.modo, $(if ($Simular) { ' SIMULADO' } else { '' }), $n.itens.Count, $n.negativos, $enviado, $ExecucaoId)
}

function Modulo-Margem($Modulo) {
    $sessao = $null
    try {
        try { $sessao = Abrir-Sessao }
        catch {
            Log ('ERRO margem modo={0} fase=conexao motivo={1} execucao={2}' -f $Cfg.modo, (Descrever-Erro $_), $ExecucaoId)
            throw 'modulo-com-erro'
        }
        # As partes registram falha em $script:MargemOk (o Log escreve na saida: nada de retorno booleano).
        $script:MargemOk = $true
        if ($BackfillMargemDesde) {
            Margem-Vendas $sessao $Modulo $script:JanelasBackfill
        } else {
            $hoje = Hoje-SaoPaulo
            Margem-Vendas $sessao $Modulo (Janelas-Margem $hoje.AddDays(-2) $hoje.AddDays(1))
            # Partes independentes: falha em vendas nao impede custos (e vice-versa).
            Margem-Custos $sessao $Modulo
        }
    } finally { Fechar-Sessao $sessao }
    if (-not $script:MargemOk) { throw 'modulo-com-erro' }
}

$Modulos = @(
    @{ def = $ModuloSaude; funcao = 'Modulo-Saude' }
    @{ def = $ModuloReceber; funcao = 'Modulo-Receber' }
    @{ def = $ModuloMargem; funcao = 'Modulo-Margem' }
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
    $listaModulos = $Modulos
    if ($BackfillMargemDesde) {
        $Fase = 'backfill'
        $Mensagem = 'Backfill da margem: data invalida (minimo 2026-05-29, nao futura).'
        $desdeBf = [datetime]::ParseExact($BackfillMargemDesde, 'yyyy-MM-dd', $Invariant)
        $ateBf = (Hoje-SaoPaulo).AddDays(1)
        if ($desdeBf -lt $DataMinimaMargem -or $desdeBf -ge $ateBf) { throw 'backfill invalido' }
        $script:JanelasBackfill = Janelas-Margem $desdeBf $ateBf
        # Backfill: so a margem, sem agenda (nao adia nem antecipa o ciclo normal).
        $listaModulos = @($Modulos | Where-Object { $_.def.nome -ceq 'margem' })
    }
    foreach ($m in $listaModulos) {
        $Fase = 'modulo-' + $m.def.nome
        # Agenda: ler e RESERVAR antes de consultar (grava o intervalo de erro). Se o estado
        # local nao pode ser lido ou gravado, o modulo nao consulta (sem limite = sem coleta).
        try {
            if (-not $BackfillMargemDesde) {
                if (-not (Modulo-Devido $m.def)) { continue }
                Agendar-Modulo $m.def $false
            }
        } catch {
            $falhos += $m.def
            try { Log ('ERRO {0} fase=agenda: agenda local ilegivel ou sem gravacao; modulo nao rodou.' -f $m.def.nome) } catch {}
            continue
        }
        try {
            # Consulta fora da whitelist/aprovacao: o modulo nem abre conexao.
            foreach ($nc in $m.def.consultas.Keys) { $null = Validar-ConsultaFixa ($m.def.nome + '.' + $nc) $m.def.consultas[$nc].sql }
            & $m.funcao $m.def
            try { if (-not $BackfillMargemDesde) { Agendar-Modulo $m.def $true } }
            catch {
                # Coletou, mas a agenda de sucesso nao gravou: vale a reserva (15 min) e o modulo sai com erro.
                $falhos += $m.def
                try { Log ('ERRO {0} fase=agenda: coleta feita, agenda nao gravou; proxima tentativa pela reserva.' -f $m.def.nome) } catch {}
            }
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
