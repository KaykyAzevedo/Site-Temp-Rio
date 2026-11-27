param(
  [string]$Repositorio = 'C:/Users/emporio/Downloads/TempRio-trabalho/worktrees/temp-rio-068d',
  [string]$Database = 'sentinela_separando_cpf_brasa068d',
  [int]$Port = 55439,
  [switch]$IniciarPgTemporario
)
$ErrorActionPreference = 'Stop'
if ($Database -notmatch '^sentinela_separando_cpf_brasa068d[a-z0-9_]*$') { throw 'Nome fora da fixture 068D r2' }
$pgBin = 'C:/Program Files/PostgreSQL/18/bin'
$psql = Join-Path $pgBin 'psql.exe'
$pacote = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$conn = "host=127.0.0.1 port=$Port user=qa connect_timeout=5"
$pgTempDir = $null

function Test-PgOnline {
  $ErrorActionPreference = 'Continue'
  & $psql "$conn dbname=postgres" -X -q -c 'select 1' *> $null
  $ok = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = 'Stop'
  return $ok
}

try {
  if (-not (Test-PgOnline)) {
    if (-not $IniciarPgTemporario) {
      throw "PG18 local nao responde em 127.0.0.1:$Port (use -IniciarPgTemporario para subir cluster efemero)."
    }
    $pgTempDir = Join-Path $env:TEMP ("brasa-pg18-068d-" + [System.Diagnostics.Process]::GetCurrentProcess().Id)
    if (Test-Path $pgTempDir) { Remove-Item -Recurse -Force $pgTempDir }
    $pInit = Start-Process -FilePath (Join-Path $pgBin 'initdb.exe') -ArgumentList @('-D', $pgTempDir, '-U', 'qa', '-A', 'trust', '--encoding=UTF8', '--locale=C') -Wait -PassThru -WindowStyle Hidden
    if ($pInit.ExitCode -ne 0) { throw "Falha initdb PG18 temporario (exit=$($pInit.ExitCode))" }
    Add-Content -Path (Join-Path $pgTempDir 'postgresql.conf') -Value "`nport = $Port`nlisten_addresses = '127.0.0.1'`n"
    $pgLog = Join-Path $pgTempDir 'pg.log'
    $pgErr = Join-Path $pgTempDir 'pg.err.log'
    $pSrv = Start-Process -FilePath (Join-Path $pgBin 'postgres.exe') -ArgumentList @('-D', $pgTempDir) -RedirectStandardOutput $pgLog -RedirectStandardError $pgErr -PassThru -WindowStyle Hidden
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-PgOnline)) {
      if ($pSrv.HasExited -or $sw.Elapsed.TotalSeconds -gt 15) {
        $errTxt = if (Test-Path $pgErr) { Get-Content $pgErr -Raw } else { '' }
        throw "Falha postgres.exe start: $errTxt"
      }
      Start-Sleep -Milliseconds 150
    }
  }

  & $psql "$conn dbname=postgres" -X -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $Database WITH (FORCE)"
  if ($LASTEXITCODE) { throw 'Falha reset database local' }
  & $psql "$conn dbname=postgres" -X -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $Database"
  if ($LASTEXITCODE) { throw 'Falha create database local' }

  $log = Join-Path $pacote "$Database.log"
  $params = @(
    "$conn dbname=$Database", '-X', '-v', 'ON_ERROR_STOP=1',
    '-v', "fixture065=$Repositorio/supabase/tests/rota-semana-065.sql",
    '-v', "base044=$Repositorio/admin/migracoes/044_rota_marcacao_horarios.sql",
    '-v', "base044047=$Repositorio/supabase/tests/044-047-base.sql",
    '-v', "base045=$Repositorio/admin/migracoes/045_rota_pedido_ignorado.sql",
    '-v', "base068f=$Repositorio/admin/migracoes/068_f_fora_do_site.sql",
    '-v', "base068a=$Repositorio/admin/migracoes/068_a_trocar_veiculo.sql",
    '-v', "base068c=$Repositorio/admin/migracoes/068_c_entrega_automatica.sql",
    '-v', "base068h=$Repositorio/admin/migracoes/068_h_mover_nao_historico.sql",
    '-v', "base070=$Repositorio/admin/migracoes/070_previsao_definitiva.sql",
    '-f', "$PSScriptRoot/historico-lote-068.sql"
  )
  $ErrorActionPreference = 'Continue'
  & $psql @params 2>&1 | Out-File -LiteralPath $log -Encoding utf8 -Width 4096
  $codigo = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  Get-Content -LiteralPath $log -Tail 15
  if ($codigo) { throw "FAIL PG $Database (exit=$codigo); log=$log" }
  Write-Output "PASS PG $Database; log=$log"
} finally {
  if ($pgTempDir -and (Test-Path $pgTempDir)) {
    $ErrorActionPreference = 'Continue'
    Start-Process -FilePath (Join-Path $pgBin 'pg_ctl.exe') -ArgumentList @('-D', $pgTempDir, '-m', 'immediate', 'stop') -Wait -WindowStyle Hidden | Out-Null
    Start-Sleep -Milliseconds 300
    Remove-Item -Recurse -Force $pgTempDir -ErrorAction SilentlyContinue
    $ErrorActionPreference = 'Stop'
  }
}
