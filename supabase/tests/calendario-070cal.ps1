param(
  [string]$Repositorio = 'C:/Users/emporio/Downloads/TempRio-trabalho/worktrees/temp-rio-070cal',
  [string]$Database = 'sentinela_separando_brasa070cal',
  [int]$Port = 55439,
  [switch]$IniciarPgTemporario
)
$ErrorActionPreference = 'Stop'
if ($Database -notmatch '^sentinela_separando_brasa070cal[a-z0-9_]*$') { throw 'Nome fora da fixture 070-CAL' }
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
    $pgTempDir = Join-Path $env:TEMP ("brasa-pg18-070cal-" + [System.Diagnostics.Process]::GetCurrentProcess().Id)
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

  $py = Join-Path $PSScriptRoot 'calendario-070cal-pg.py'
  $mig = Join-Path $pacote 'admin/migracoes/070_cal_sem_veiculo.sql'
  $rb = Join-Path $pacote 'admin/migracoes/070_cal_rollback.sql'
  $env:TEMPRIO070CAL_DB = $Database
  python $py $Repositorio $mig $rb $Port
  if ($LASTEXITCODE -ne 0) { throw "FAIL PG18 070-CAL (exit=$LASTEXITCODE)" }
  Write-Output "PASS PG $Database"
} finally {
  if ($pgTempDir -and (Test-Path $pgTempDir)) {
    $ErrorActionPreference = 'Continue'
    Start-Process -FilePath (Join-Path $pgBin 'pg_ctl.exe') -ArgumentList @('-D', $pgTempDir, '-m', 'immediate', 'stop') -Wait -WindowStyle Hidden | Out-Null
    Start-Sleep -Milliseconds 300
    Remove-Item -Recurse -Force $pgTempDir -ErrorAction SilentlyContinue
    $ErrorActionPreference = 'Stop'
  }
}
