param(
  [string]$Repositorio = 'C:/Users/emporio/Downloads/TempRio-trabalho/worktrees/temp-rio-068',
  [string]$Database = 'sentinela_separando_cpf_forja068cr2',
  [string]$Migracao = '',
  [string]$Template = '',
  [switch]$Preparar
)
$ErrorActionPreference = 'Stop'
if ($Database -cnotmatch '^sentinela_separando_cpf_forja068cr2[a-z0-9_]*$') { throw 'Nome fora da fixture A' }
if ($Template -and $Template -cnotmatch '^sentinela_separando_cpf_forja068cr2[a-z0-9_]*$') { throw 'Template fora da fixture A' }
$psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
$pacote = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$conn = 'host=127.0.0.1 port=55439 user=qa connect_timeout=5'
& $psql "$conn dbname=postgres" -X -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $Database WITH (FORCE)"
if ($LASTEXITCODE) { throw 'Falha reset database local' }
$sql = "CREATE DATABASE $Database"
if ($Template) { $sql += " TEMPLATE $Template" }
& $psql "$conn dbname=postgres" -X -v ON_ERROR_STOP=1 -q -c $sql
if ($LASTEXITCODE) { throw 'Falha create database local' }
$params = @("$conn dbname=$Database",'-X','-v','ON_ERROR_STOP=1','-v',"fixture068=$Repositorio/supabase/tests/rota-semana-065.sql",'-v',"base045=$Repositorio/admin/migracoes/045_rota_pedido_ignorado.sql",'-f',"$PSScriptRoot/entrega-automatica-068.sql")
$params += @('-v',"baseF2=C:/Users/emporio/Downloads/TempRio-trabalho/forja/pacote_068F2_fora_do_site_20261126/admin/migracoes/068_f_fora_do_site.sql")
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
