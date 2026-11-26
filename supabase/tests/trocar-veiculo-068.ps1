param(
  [string]$Repositorio = 'C:/Users/emporio/Downloads/TempRio-trabalho/worktrees/temp-rio-068',
  [string]$Database = 'sentinela_separando_cpf_forja068a',
  [string]$Migracao = '',
  [string]$Template = '',
  [switch]$Preparar
)
$ErrorActionPreference = 'Stop'
if ($Database -notmatch '^sentinela_separando_cpf_forja068a[a-z0-9_]*$') { throw 'Nome fora da fixture A' }
if ($Template -and $Template -notmatch '^sentinela_separando_cpf_forja068a[a-z0-9_]*$') { throw 'Template fora da fixture A' }
$psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
$pacote = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$conn = 'host=127.0.0.1 port=55439 user=qa connect_timeout=5'
& $psql "$conn dbname=postgres" -X -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $Database WITH (FORCE)"
if ($LASTEXITCODE) { throw 'Falha reset database local' }
$sql = "CREATE DATABASE $Database"
if ($Template) { $sql += " TEMPLATE $Template" }
& $psql "$conn dbname=postgres" -X -v ON_ERROR_STOP=1 -q -c $sql
if ($LASTEXITCODE) { throw 'Falha create database local' }
$params = @("$conn dbname=$Database",'-X','-v','ON_ERROR_STOP=1','-v',"fixture068=$Repositorio/supabase/tests/rota-semana-065.sql",'-v',"base044=$Repositorio/admin/migracoes/044_rota_marcacao_horarios.sql",'-f',"$PSScriptRoot/trocar-veiculo-068.sql")
if ($Migracao) { $params += @('-v',"migracao068=$Migracao") }
if ($Template) { $params += @('-v','qa_base_pronta=1') }
if ($Preparar) { $params += @('-v','qa_preparar=1') }
$log = Join-Path $pacote "$Database.log"
$ErrorActionPreference = 'Continue'
& $psql @params 2>&1 | Out-File -LiteralPath $log -Encoding utf8 -Width 4096
$codigo = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Get-Content -LiteralPath $log -Tail 12
if ($codigo) { throw "FAIL PG $Database (exit=$codigo); log=$log" }
Write-Output "PASS PG $Database; log=$log"
