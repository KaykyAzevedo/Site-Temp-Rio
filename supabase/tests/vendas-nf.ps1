# PS5.1 offline. Nao conecta SQL Server/Supabase nem le configuracao do projeto.
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$repo=Split-Path (Split-Path $PSScriptRoot);$arquivo=Join-Path $repo 'integracao/solidcon/sync-banco.ps1'
. $arquivo
$n=0;function Check($ok,$texto){if(-not $ok){throw $texto};$script:n++}
$desde=[datetime]'2026-05-29';$ate=[datetime]'2026-06-26'
$linha=@{filial=4;cd_nota=550;numero=550;serie=' 1 ';dt=[datetime]'2026-06-25T18:30:00';cd_cliente=900;cd_pedido=538;produtos=[decimal]21643.20;total=[decimal]24211.21;st=[decimal]2334.58;nf_cupom=$false}
$clientes=@(@{codigo_parceiro=900;documento='37893563000166'})
$r=Normalizar-NF @($linha) $clientes $desde $ate
Check ($r.itens.Count -eq 1 -and $r.itens[0].valor_centavos -eq 2164320 -and $r.itens[0].total_nota_centavos -eq 2421121 -and $r.itens[0].st_centavos -eq 233458) 'NF550 valores distintos exatos'
Check ($r.itens[0].dia -ceq '2026-06-25' -and $r.itens[0].dt -ceq '2026-06-25T18:30:00.000-03:00' -and $r.itens[0].serie -ceq '1' -and $r.itens[0].cd_pedido -eq 538) 'dataSP serie aparada vinculo pedido'
Check ($r.itens[0].documento -ceq '37893563000166' -and $r.itens[0].Keys.Count -eq 11) 'projecao minima sem nome CPF XML imagem'
$q=$linha.Clone();$q.nf_cupom=$true;$r=Normalizar-NF @($q) $clientes $desde $ate
Check ($r.itens[0].nf_cupom -eq $true -and $r.contagens.nf_pdv -eq 1) 'flagPDV preservada para reconciliacao no painel'
$r=Normalizar-NF @($linha) @(@{codigo_parceiro=900;documento='00000000191'}) $desde $ate
Check ($r.itens.Count -eq 0 -and $r.contagens.sem_cnpj -eq 1) 'CPF nunca e enviado na NF comercial'
foreach($campo in @('produtos','total','nf_cupom','dt','numero','filial','serie')){
 $q=$linha.Clone();$q[$campo]=$null;$e=$null
 try{$null=Normalizar-NF @($q) $clientes $desde $ate}catch{$e=$_}
 Check ($null -ne $e) ('campo invalido falha lote inteiro '+$campo)
}
$q=$linha.Clone();$q.st=$null;$r=Normalizar-NF @($q) $clientes $desde $ate
Check ($null -eq $r.itens[0].st_centavos -and $r.itens[0].valor_centavos -eq 2164320) 'ST desconhecida preservada sem inventar0 e sem perder produtos'
foreach($campo in @('produtos','total','st')){
 $q=$linha.Clone();$q[$campo]=[decimal]'-0.001';$e=$null
 try{$null=Normalizar-NF @($q) $clientes $desde $ate}catch{$e=$_}
 Check ($null -ne $e) ('negativo nao arredonda para zero '+$campo)
}
$e=$null;try{$null=Normalizar-NF @($linha,$linha) $clientes $desde $ate}catch{$e=$_};Check ($null -ne $e) 'duplicata ERP nao soma cabecalho'
$e=$null;try{$null=Normalizar-NF @($linha) @($clientes[0],@{codigo_parceiro=900;documento='11222333000181'}) $desde $ate}catch{$e=$_};Check ($null -ne $e) 'parceiro ambiguo falha antes apagar janela'
foreach($consulta in $ModuloNF.consultas.Keys){$usadas=Validar-ConsultaFixa ('nf.'+$consulta) $ModuloNF.consultas[$consulta].sql;Check ($usadas -contains 'dbo.tbNota' -and $usadas -contains 'dbo.tbNotaFiscal' -and $usadas -contains 'dbo.tbNotaFiscalIdentificacao') ('whitelist nova restrita '+$consulta)}
foreach($flag in @('inCancelada','inDenegada','inRejeitada')){Check ($ConsultasAprovadas['nf.lista'].Contains('ISNULL(n.'+$flag+',0) = 0')) ('NULL como0 confirmado '+$flag)}
Check ($ConsultasAprovadas['nf.lista'] -match "i\.\[mod\] = '55'" -and $ConsultasAprovadas['nf.lista'] -match 'i.tpNF = 1' -and $ConsultasAprovadas['nf.lista'] -match 'ISNULL\(i.finNFe,1\) = 1') 'so venda normal modelo55 saida sem devolucao/ajuste/complemento'
foreach($caso in @(@('margem.qa',$ConsultasAprovadas['nf.lista']),@('nf.qa','SELECT p.cdPedido FROM dbo.tbPedido AS p WHERE p.cdPessoaFilial = 4'),@('nf.qa','SELECT TRY_CONVERT(int,1) FROM dbo.tbNota AS n WHERE n.cdPessoaFilial = 4'))){
 $ConsultasAprovadas[$caso[0]]=$caso[1];$e=$null;try{$null=Validar-ConsultaFixa $caso[0] $caso[1]}catch{$e=$_};Check ($null -ne $e) 'nao alarga tabelas nem aceitaSQL2012+'
}
function Hoje-SaoPaulo{return [datetime]'2026-06-25'}
$script:conferencias=0;$script:fechou=$false;$script:enviou=0;$script:logs=@();$script:rpcStatus='ok'
function Abrir-Sessao {$script:fechou=$false;$script:sessaoTeste=@{id=[guid]::NewGuid()};return $script:sessaoTeste}
function Executar-Consulta($Sessao,$Modulo,[string]$Nome,[hashtable]$Valores=@{}){
 Check ([object]::ReferenceEquals($Sessao,$script:sessaoTeste)) 'mesma sessao lista e parceiros'
 if($Nome -ceq 'lista'){return ,@($script:linha)}else{return ,$script:clientes}
}
function Fechar-Sessao($Sessao){$script:fechou=$true}
function Chamar-Rpc([string]$Nome,$Dados){Check ($script:fechou -and $Nome -ceq 'solidcon_receber_vendas_nf') 'rollback antes de HTTP';$script:enviou++;return [pscustomobject]@{status=$script:rpcStatus;motivo='snapshot_antigo'}}
function Log([string]$Texto){$script:logs+= $Texto}
$Cfg=[pscustomobject]@{modo='real'};$Real=$true;$Simular=$false;$Testar=$false;$TestarNF=$false;$ExecucaoId=[guid]::NewGuid().ToString()
try{Modulo-NF $ModuloNF}catch{Write-Output ($script:logs -join "`n");throw}
Check ($script:enviou -eq 1 -and $script:logs[-1] -match '^OK nf' -and $script:logs[-1] -notmatch '37893563|21643|24211|2334') 'somente contagens no log'
$script:rpcStatus='erro';$e=$null;try{Modulo-NF $ModuloNF}catch{$e=$_}
Check ($null -ne $e -and $script:logs[-1] -match 'fase=rpc motivo=snapshot_antigo') 'recusa RPC com codigo seguro; nunca sucesso falso'
$script:rpcStatus='ok'
$TestarNF=$true;$Testar=$true;$script:enviou=0
Modulo-NF $ModuloNF
Check ($script:enviou -eq 0 -and $script:fechou) 'TestarNF nao envia e fecha sessao'

# Main real em filho PS5.1, somente SIMULACAO: mutex/lock e flags sem importar helpers/config do projeto.
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sentinela-nf-'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($pasta)|Out-Null
$config=Join-Path $pasta 'config.json';$saida=Join-Path $pasta 'saida'
@{modo='teste';pastaSaida=$saida;banco=@{servidor='localhost';base='qa_offline';usuario='qa'}}|ConvertTo-Json|Set-Content -LiteralPath $config -Encoding UTF8
$res=@(& powershell.exe -NoProfile -File $arquivo -Config $config -TestarNF -Simular)
Check ($LASTEXITCODE -eq 0 -and ($res -join "`n") -match 'OK nf' -and ($res -join "`n") -notmatch 'OK pedidos|OK margem|OK receber|OK saude') 'TestarNF isolado dos demais modulos'
Check (@(Get-ChildItem -LiteralPath $saida -File | Where-Object {$_.Name -cnotin @('sync-banco.lock','sync-banco.log')}).Count -eq 0 -and (Test-Path (Join-Path $saida 'sync-banco.lock'))) 'TestarNF somente trava/log tecnico; sem agenda/estado/arquivo de notas'
$res=@(& powershell.exe -NoProfile -File $arquivo -Config $config -Testar -Simular)
Check ($LASTEXITCODE -eq 0 -and ($res -join "`n") -notmatch 'OK nf') 'Testar antigo continua so pedidos; NF desligada por padrao'
$res=@(& powershell.exe -NoProfile -File $arquivo -Config $config -Forcar -Simular)
Check ($LASTEXITCODE -eq 0 -and ($res -join "`n") -match 'OK pedidos' -and ($res -join "`n") -match 'OK receber' -and ($res -join "`n") -notmatch 'OK nf') 'ciclo normal antigo preservado com NF desligada'
@{modo='teste';nf_saida=$true;pastaSaida=$saida;banco=@{servidor='localhost';base='qa_offline';usuario='qa'}}|ConvertTo-Json|Set-Content -LiteralPath $config -Encoding UTF8
$res=@(& powershell.exe -NoProfile -File $arquivo -Config $config -BackfillNFDesde 2026-05-29 -Simular)
Check ($LASTEXITCODE -eq 0 -and ($res -join "`n") -match 'OK nf' -and ($res -join "`n") -notmatch 'OK pedidos|OK receber|OK margem|OK saude' -and -not (Test-Path (Join-Path $saida 'banco-nf-agenda-teste-simulado.json'))) 'backfill habilitado soNF sem agenda nem demais modulos'
"PASS $n checks NF1B PS5.1 offline"
