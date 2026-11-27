param(
  [string]$Repositorio = 'C:/Users/emporio/Downloads/TempRio-trabalho/worktrees/temp-rio-068b-r8',
  [string]$Database = 'sentinela_separando_brasa068b',
  [int]$Port = 55439,
  [switch]$IniciarPgTemporario
)
$ErrorActionPreference = 'Stop'
if ($Database -notmatch '^sentinela_separando_brasa068b[a-z0-9_]*$') { throw 'Nome fora da fixture 068B' }
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
    $pgTempDir = Join-Path $env:TEMP ("brasa-pg18-068b-" + [System.Diagnostics.Process]::GetCurrentProcess().Id)
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

  # 1) Suite principal 068B sobre 066 (incluindo R4-A, R4-B, fallback CH r3, dias_prazo, rollback 2x)
  & $psql "$conn dbname=postgres" -X -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $Database WITH (FORCE)"
  if ($LASTEXITCODE) { throw 'Falha reset database local' }
  & $psql "$conn dbname=postgres" -X -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $Database"
  if ($LASTEXITCODE) { throw 'Falha create database local' }
  $log = Join-Path $pacote "$Database.log"
  $fix066 = "$Repositorio/supabase/tests/rota-sugestoes-066.sql"
  $ErrorActionPreference = 'Continue'
  & $psql "$conn dbname=$Database" -X -v ON_ERROR_STOP=1 -v "fixture066=$fix066" -f "$PSScriptRoot/prazo-flexivel-068b.sql" 2>&1 | Out-File -LiteralPath $log -Encoding utf8 -Width 4096
  $codigo = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  Get-Content -LiteralPath $log -Tail 12
  if ($codigo) { throw "FAIL PG $Database (exit=$codigo); log=$log" }

  # 2) Regressao concorrente B068-R5-C (2 sessoes)
  $uid = "set qa.uid='22222222-2222-4222-8222-222222222222';set qa.role='authenticated';set role authenticated;"
  $psiB = [System.Diagnostics.ProcessStartInfo]::new($psql, "`"$conn dbname=$Database`" -X -A -t -q -v ON_ERROR_STOP=1")
  $psiB.UseShellExecute = $false; $psiB.RedirectStandardInput = $true; $psiB.RedirectStandardOutput = $true; $psiB.RedirectStandardError = $true
  $psiA = [System.Diagnostics.ProcessStartInfo]::new($psql, "`"$conn dbname=$Database`" -X -A -t -q -v ON_ERROR_STOP=1 -c `"set application_name='brasa_068b_r5c';$uid select rota_068_prazo_padrao_salvar(3, null);`"")
  $psiA.UseShellExecute = $false; $psiA.RedirectStandardOutput = $true; $psiA.RedirectStandardError = $true
  $procB = $null; $procA = $null
  try {
    & $psql "$conn dbname=$Database" -X -A -t -q -v ON_ERROR_STOP=1 -c "update rota_config set prazo_ideal_dias=2, prazo_dias_uteis_semana='{1,2,3,4,5}' where id=1;" | Out-Null
    $procB = [System.Diagnostics.Process]::Start($psiB)
    $procB.StandardInput.WriteLine("begin;$uid select pg_advisory_xact_lock(5100,6802);select rota_068_prazo_padrao_salvar(2,array[6]);select 'B_READY';")
    $procB.StandardInput.Flush()
    do {
      $ln = $procB.StandardOutput.ReadLine()
      if ($null -eq $ln) { throw "Sessao B encerrou antes da barreira: $($procB.StandardError.ReadToEnd())" }
    } until ($ln -match 'B_READY')

    $procA = [System.Diagnostics.Process]::Start($psiA)
    $sw2 = [System.Diagnostics.Stopwatch]::StartNew()
    do {
      $esperando = (& $psql "$conn dbname=$Database" -X -A -t -q -v ON_ERROR_STOP=1 -c "select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='brasa_068b_r5c' and l.locktype='advisory' and not l.granted)").Trim()
      if ($sw2.Elapsed.TotalSeconds -gt 10) { throw 'Sessao A nao aguardou lock 6802' }
      if ($esperando -ne 't') { Start-Sleep -Milliseconds 100 }
    } until ($esperando -eq 't')

    $procB.StandardInput.WriteLine("commit;")
    $procB.StandardInput.WriteLine("\q")
    $procB.StandardInput.Close()
    if (-not $procB.WaitForExit(10000) -or $procB.ExitCode -ne 0) { throw "Sessao B falhou: $($procB.StandardError.ReadToEnd())" }
    if (-not $procA.WaitForExit(10000) -or $procA.ExitCode -ne 0) { throw "Sessao A falhou: $($procA.StandardError.ReadToEnd())" }
    $resA = $procA.StandardOutput.ReadToEnd().Trim()
    $estadoFinal = (& $psql "$conn dbname=$Database" -X -A -t -q -v ON_ERROR_STOP=1 -c "select prazo_ideal_dias || '|' || array_to_string(prazo_dias_uteis_semana, ',') from rota_config where id=1").Trim()
    if ($estadoFinal -ne '3|6') { throw "FAIL B068-R5-C concorrencia: esperado 3|6, obtido $estadoFinal (resA=$resA)" }
    Write-Output "PASS B068-R5-C concorrencia 2 sessoes: estado=$estadoFinal"
  } finally {
    if ($procA -and -not $procA.HasExited) { $procA.Kill() }
    if ($procB -and -not $procB.HasExited) { $procB.Kill() }
    & $psql "$conn dbname=$Database" -X -A -t -q -c "update rota_config set prazo_ideal_dias=2, prazo_dias_uteis_semana='{1,2,3,4,5}' where id=1;" | Out-Null
  }

  # 3) Integracao com pilha real 216d678 (070 + 068C/H r3 + 068D) + foto real c8c88e54 (196 pedidos)
  $fotoPy = Join-Path $PSScriptRoot 'prazo-068b-foto-070.py'
  if (Test-Path $fotoPy) {
    $migB = Join-Path $pacote 'admin/migracoes/068_b_prazo_flexivel.sql'
    $rbB = Join-Path $pacote 'admin/migracoes/068_b_rollback.sql'
    python $fotoPy $Repositorio $migB $rbB $Port
    if ($LASTEXITCODE -ne 0) { throw "FAIL foto real c8c88e54 / integracao 070 (exit=$LASTEXITCODE)" }
  }

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
