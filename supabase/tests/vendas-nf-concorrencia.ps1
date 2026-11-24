# PG18 LOCAL apenas. Executar depois vendas-nf.sql numa DB nova sentinela_nf_*.
param([ValidatePattern('^sentinela_nf_[a-zA-Z0-9_]+$')][string]$Banco='sentinela_nf_02')
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$psql='C:/Program Files/PostgreSQL/18/bin/psql.exe'
$alvo=@(& $psql -h 127.0.0.1 -p 55439 -U qa -d $Banco -t -A -c "select current_database() ~ '^sentinela_nf_' and inet_server_addr()='127.0.0.1'::inet")
if($LASTEXITCODE -ne 0 -or ($alvo -join '').Trim() -cne 't'){throw 'somente PG local isolado'}
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sentinela-nf-race-'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($pasta)|Out-Null
function Sql-Race([int]$Codigo,[int]$Valor,[string]$Coleta,[bool]$Segurar){
 $nota=@(@{cd_nota=$Codigo;numero=550;serie='1';dia='2026-06-27';dt='2026-06-27T12:00:00-03:00';documento='11222333000181';cd_pedido=$null;valor_centavos=$Valor;total_nota_centavos=$Valor;st_centavos=0;nf_cupom=$false})|ConvertTo-Json -Depth 6 -Compress
 # ConvertTo-Json no PS5.1 desenrola array unitario no pipeline. A RPC exige array explicito.
 if(-not $nota.StartsWith('[')){$nota='['+$nota+']'}
 $hold=if($Segurar){'select pg_sleep(3);'}else{''}
 return "begin;set qa.uid='11111111-1111-4111-8111-111111111111';select public.solidcon_receber_vendas_nf('2026-06-27','2026-06-27','$nota','$Coleta',gen_random_uuid());$hold commit;"
}
$n=0
foreach($ordem in @('antigo-primeiro','novo-primeiro')){
 $cod=if($n -eq 0){999081}else{999082}
 $velho=[DateTimeOffset]::UtcNow.AddMinutes(-5).ToString('o');$novo=[DateTimeOffset]::UtcNow.AddMinutes(-4).ToString('o')
 $primeiro=if($n -eq 0){Sql-Race $cod 100 $velho $true}else{Sql-Race $cod 300 $novo $true}
 $segundo=if($n -eq 0){Sql-Race $cod 200 $novo $false}else{Sql-Race $cod 100 $velho $false}
 $f1=Join-Path $pasta ($ordem+'-1.sql');$f2=Join-Path $pasta ($ordem+'-2.sql')
 [IO.File]::WriteAllText($f1,$primeiro);[IO.File]::WriteAllText($f2,$segundo)
 $p1=Start-Process -FilePath $psql -ArgumentList @('-h','127.0.0.1','-p','55439','-U','qa','-d',$Banco,'-v','ON_ERROR_STOP=1','-f',$f1) -RedirectStandardOutput ($f1+'.out') -RedirectStandardError ($f1+'.err') -WindowStyle Hidden -PassThru
 $null=$p1.Handle # PS5.1: manter handle para ExitCode continuar acessivel apos o processo terminar.
 $lock=$false
 for($i=0;$i -lt 30;$i++){
  $l=@(& $psql -h 127.0.0.1 -p 55439 -U qa -d $Banco -t -A -c 'select exists(select 1 from pg_locks where locktype=''advisory'' and classid=5100 and objid=60 and granted)')
  if(($l -join '').Trim() -ceq 't'){$lock=$true;break}
  Start-Sleep -Milliseconds 50
 }
 if(-not $lock){throw 'primeira transacao nao adquiriu lock'}
 $sw=[Diagnostics.Stopwatch]::StartNew()
 $r=@(& $psql -h 127.0.0.1 -p 55439 -U qa -d $Banco -v ON_ERROR_STOP=1 -f $f2)
 if($LASTEXITCODE -ne 0){throw 'segunda transacao falhou'}
 $sw.Stop();$p1.WaitForExit()
 if($p1.ExitCode -ne 0 -or $sw.ElapsedMilliseconds -lt 300){throw ('nao houve concorrencia serializada real ms='+$sw.ElapsedMilliseconds+' exit='+$p1.ExitCode)}
 $v=@(& $psql -h 127.0.0.1 -p 55439 -U qa -d $Banco -t -A -c ('select valor_centavos from public.solidcon_vendas_nf where cd_nota='+$cod))
 $esperado=if($n -eq 0){200}else{300}
 if(($v -join '').Trim() -cne [string]$esperado){throw 'snapshot velho ganhou corrida'}
 if($n -eq 1 -and ($r -join '') -notmatch 'snapshot_antigo'){throw 'snapshot antigo nao recebeu motivo claro'}
 $n++;Write-Output ('PASS corrida '+$ordem+' espera_ms='+$sw.ElapsedMilliseconds+' valor_final='+$esperado)
}
"PASS $n corridas PG18 isolado; evidencias em $pasta"
