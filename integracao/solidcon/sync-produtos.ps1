#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Config = 'C:\TempRio\solidcon\config.json',
    [string]$ArquivoEntrada,
    [string]$ArquivoEntradaSemSaldo,
    [ValidateRange(1,400)][int]$BackfillDias,
    [string]$ArquivoVendas
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Invariant = [Globalization.CultureInfo]::InvariantCulture
$Utf8 = New-Object Text.UTF8Encoding($false)
$CategoriasPermitidas = @('TEMPERO - CAIXA 24 UN', 'TEMPERO - CAIXA 48 UN')
$Token = $null
$Cfg = $null
$Pasta = $null
$Trava = $null
$Mutex = $null
$MutexAdquirido = $false
$FalhaRegistrada = $false
$ExecucaoId = [guid]::NewGuid().ToString('D')
$Fase = 'configuracao'
$Mensagem = 'Falha de configuracao.'
$SupabasePronto = $false
$Real = $false
$CodigoSaida = 1
$VendasFalhou = $false
$EstoqueOk = $false
$jsonComSaldo = $null
$jsonSemSaldo = $null
$ZonaSP = [TimeZoneInfo]::FindSystemTimeZoneById('E. South America Standard Time')

function Salvar-Json($Valor, [string]$Caminho) {
    # Troca atomica: o ultimo OK nunca fica pela metade.
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
        $logPath = Join-Path $Pasta 'sync.log'
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

function Numero-Decimal($Valor) {
    if ($null -eq $Valor -or $Valor -is [bool]) { throw 'numero obrigatorio' }
    if ($Valor -is [double] -or $Valor -is [single]) {
        $texto = $Valor.ToString('R', $Invariant)
    } elseif ($Valor -is [IFormattable]) {
        $texto = $Valor.ToString($null, $Invariant)
    } else {
        $texto = [string]$Valor
    }
    if ($texto -notmatch '^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$') { throw 'numero invalido' }
    return [decimal]::Parse($texto, [Globalization.NumberStyles]::Float, $Invariant)
}

function Inteiro-Positivo($Valor) {
    $numero = Numero-Decimal $Valor
    if ($numero -le 0 -or [decimal]::Truncate($numero) -ne $numero -or $numero -gt [long]::MaxValue) {
        throw 'identificador invalido'
    }
    return [long]$numero
}

function Data-Erp($Valor) {
    if ($null -eq $Valor -or [string]::IsNullOrWhiteSpace([string]$Valor)) { return $null }
    $texto = [string]$Valor
    if ($texto -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})?$') {
        throw 'data ERP invalida'
    }
    # Hora ERP sem fuso = estabelecimento em Sao Paulo, nao a maquina de teste.
    if ($texto -notmatch '(Z|[+-]\d{2}:\d{2})$') {
        $local = [DateTime]::Parse($texto, $Invariant, [Globalization.DateTimeStyles]::None)
        $local = [DateTime]::SpecifyKind($local, [DateTimeKind]::Unspecified)
        $zona = [TimeZoneInfo]::FindSystemTimeZoneById('E. South America Standard Time')
        if ($zona.IsInvalidTime($local) -or $zona.IsAmbiguousTime($local)) { throw 'hora ERP ambigua' }
        return [TimeZoneInfo]::ConvertTimeToUtc($local, $zona).ToString('o', $Invariant)
    }
    return [DateTimeOffset]::Parse($texto, $Invariant).ToUniversalTime().ToString('o', $Invariant)
}

function Ean-Texto($Valor) {
    if ($null -eq $Valor -or $Valor -is [bool] -or $Valor -is [double] -or $Valor -is [single]) {
        throw 'EAN ausente ou sem precisao garantida'
    }
    $texto = if ($Valor -is [IFormattable]) { $Valor.ToString($null, $Invariant) } else { [string]$Valor }
    if ($texto -notmatch '^[0-9]{1,32}$') { throw 'EAN invalido' }
    return $texto
}

function Ler-RespostaErp([bool]$ComSaldo, [string]$Caminho) {
    if ($Caminho) {
        return Get-Content -LiteralPath $Caminho -Raw -Encoding UTF8
    }
    # Somente estas DUAS rotas fixas; GET, sem proxy nem redirecionamento.
    $rota = if ($ComSaldo) {
        '/api/Produto/GetProdutos?ativo=true&estoque=true'
    } else {
        '/api/Produto/GetProdutos?ativo=true&estoque=false'
    }
    $url = $api.GetLeftPart([UriPartial]::Authority) + $rota
    $pedido = [Net.HttpWebRequest]::Create($url)
    $pedido.Method = 'GET'
    $pedido.Proxy = $null
    $pedido.AllowAutoRedirect = $false
    $pedido.Timeout = 60000
    $pedido.ReadWriteTimeout = 60000
    $pedido.Accept = 'application/json'
    $resposta = $pedido.GetResponse()
    try {
        if ([int]$resposta.StatusCode -ne 200) { throw 'status ERP inesperado' }
        $leitor = New-Object IO.StreamReader($resposta.GetResponseStream(), [Text.Encoding]::UTF8, $true)
        try { return $leitor.ReadToEnd() } finally { $leitor.Dispose() }
    } finally { $resposta.Dispose() }
}

function Entrar-Supabase {
    $corpo = @{ email = $Cfg.syncEmail; password = $Cfg.syncSenha } | ConvertTo-Json -Compress
    $opcoes = @{
        Uri = ($SupabaseBase + '/auth/v1/token?grant_type=password')
        Method = 'Post'; Headers = @{ apikey = $Cfg.anonKey }
        ContentType = 'application/json; charset=utf-8'
        Body = [Text.Encoding]::UTF8.GetBytes($corpo); TimeoutSec = 60; MaximumRedirection = 0
    }
    $resposta = Invoke-RestMethod @opcoes
    if (-not $resposta.access_token) { throw 'login sem token' }
    return [string]$resposta.access_token
}

function Chamar-Rpc([string]$Nome, $Dados) {
    if ($Nome -notin @('solidcon_receber_produtos', 'solidcon_registrar_falha', 'solidcon_receber_vendas')) { throw 'RPC invalida' }
    $corpo = ConvertTo-Json -InputObject $Dados -Depth 20 -Compress
    $opcoes = @{
        Uri = ($SupabaseBase + '/rest/v1/rpc/' + $Nome); Method = 'Post'
        Headers = @{ apikey = $Cfg.anonKey; Authorization = ('Bearer ' + $Token) }
        ContentType = 'application/json; charset=utf-8'
        Body = [Text.Encoding]::UTF8.GetBytes($corpo); TimeoutSec = 60; MaximumRedirection = 0
    }
    return Invoke-RestMethod @opcoes
}

function Campo($Objeto, [string]$Nome) {
    $p = $Objeto.PSObject.Properties[$Nome]
    if ($null -ne $p) { return $p.Value }
    return $null
}

function Centavos-Venda($Valor) {
    $n = Numero-Decimal $Valor
    if ($n -lt 0) { throw 'valor negativo' }
    $c = [decimal]::Round(($n * 100), 0, [MidpointRounding]::AwayFromZero)
    if ($c -gt [long]::MaxValue) { throw 'valor excede bigint' }
    return [long]$c
}

function Dia-Venda($Linha) {
    $dia = Campo $Linha 'dia'
    if ($null -ne $dia) {
        if ($dia -isnot [string] -or $dia -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'dia invalido' }
        return [DateTime]::ParseExact($dia, 'yyyy-MM-dd', $Invariant).ToString('yyyy-MM-dd')
    }
    $dt = Campo $Linha 'dtCupom'
    if ($dt -isnot [string] -or $dt -notmatch '^\d{4}-\d{2}-\d{2}(T|$)') { throw 'data cupom invalida' }
    if ($dt -match '(Z|[+-]\d{2}:\d{2})$') {
        return [TimeZoneInfo]::ConvertTime([DateTimeOffset]::Parse($dt, $Invariant), $ZonaSP).ToString('yyyy-MM-dd')
    }
    return [DateTime]::Parse($dt, $Invariant).ToString('yyyy-MM-dd')
}

function Familia-Venda([string]$Ean, [string]$Formato) {
    if ($Formato -ceq 'pote' -and $Ean.Length -eq 13) { return $Ean.Substring(0,12) }
    if ($Formato -cin @('cx24','cx48') -and $Ean.Length -eq 14) { return $Ean.Substring(1,12) }
    return $null
}

function Adicionar-CatalogoVendas($Mapa, [string]$Chave, $Info) {
    if (-not $Mapa.ContainsKey($Chave)) {
        $Mapa[$Chave] = @{
            nome=$Info.nome; categoria=$Info.categoria; formato=$Info.formato
            fator=$Info.fator; familia=$Info.familia; familiaAmbigua=$false
        }
    } else {
        $atual = $Mapa[$Chave]
        if ($null -eq $atual) { return } # Ambiguidade nao e resolvida pela ultima linha.
        if ($atual.nome -cne $Info.nome -or $atual.categoria -cne $Info.categoria) {
            $Mapa[$Chave] = $null
        } elseif (-not $atual.familiaAmbigua) {
            if ($null -eq $atual.familia) { $atual.familia = $Info.familia }
            elseif ($null -ne $Info.familia -and $atual.familia -cne $Info.familia) {
                $atual.familia = $null; $atual.familiaAmbigua = $true
            }
        }
    }
}

function Criar-CatalogoVendas([string]$JsonCom, [string]$JsonSem) {
    if (-not $JsonCom -or -not $JsonSem -or -not $JsonCom.TrimStart().StartsWith('[') -or
        -not $JsonSem.TrimStart().StartsWith('[') -or $JsonCom.Length -gt 32MB -or $JsonSem.Length -gt 32MB) {
        throw 'catalogo incompleto'
    }
    $linhas = @(
        ConvertFrom-Json -InputObject $JsonCom | ForEach-Object { $_ }
        ConvertFrom-Json -InputObject $JsonSem | ForEach-Object { $_ }
    )
    foreach ($l in $linhas) {
        if ((Inteiro-Positivo $l.id_loja) -ne 4) { throw 'filial de catalogo invalida' }
    }
    $mapas = @{ ean=@{}; codigo=@{} }
    $catPote = 'TEMPERO - MAT' + [char]0x00C9 + 'RIA PRIMA EM PROCESSO'
    $catPoteApi = 'TEMPERO - MAT' + [char]0xFFFD + 'RIA PRIMA EM PROCESSO'
    foreach ($l in $linhas) {
        if ($l.produto -isnot [string] -or [string]::IsNullOrWhiteSpace($l.produto) -or $l.produto.Length -gt 1000 -or
            $l.classificacao01 -isnot [string] -or [string]::IsNullOrWhiteSpace($l.classificacao01) -or $l.classificacao01.Length -gt 200) { continue }
        $ean = Ean-Texto $l.codigo_ean
        $codigo = (Inteiro-Positivo $l.id_produto).ToString($Invariant)
        $formato = 'outro'; $fator = $null
        if ($l.classificacao01 -ceq $catPote -or $l.classificacao01 -ceq $catPoteApi) { $formato='pote'; $fator=1 }
        elseif ($l.classificacao01 -ceq 'TEMPERO - CAIXA 24 UN') { $formato='cx24'; $fator=24 }
        elseif ($l.classificacao01 -ceq 'TEMPERO - CAIXA 48 UN') { $formato='cx48'; $fator=48 }
        $info = @{
            nome=$l.produto; categoria=$l.classificacao01; formato=$formato; fator=$fator
            familia=(Familia-Venda $ean $formato)
        }
        Adicionar-CatalogoVendas $mapas.ean $ean $info
        Adicionar-CatalogoVendas $mapas.codigo $codigo $info
    }
    return $mapas
}

function Ler-VendasErp([string]$Dia) {
    # Unica rota de vendas autorizada. Data gerada internamente; nao e URL livre.
    if ($Dia -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'dia invalido' }
    $url = $api.GetLeftPart([UriPartial]::Authority) + '/api/Vendas/resumo-produtos-data?idFilial=4&data=' + $Dia
    $pedido = [Net.HttpWebRequest]::Create($url)
    $pedido.Method = 'GET'; $pedido.Proxy = $null; $pedido.AllowAutoRedirect = $false
    $pedido.Timeout = 60000; $pedido.ReadWriteTimeout = 60000; $pedido.Accept = 'application/json'
    $resposta = $pedido.GetResponse()
    try {
        if ([int]$resposta.StatusCode -ne 200) { throw 'status vendas inesperado' }
        $leitor = New-Object IO.StreamReader($resposta.GetResponseStream(), [Text.Encoding]::UTF8, $true)
        try { return $leitor.ReadToEnd() } finally { $leitor.Dispose() }
    } finally { $resposta.Dispose() }
}

function Normalizar-Vendas($Linhas, [string]$Dia, $Catalogo) {
    $agrupados = @{}; $semCatalogo = @{}
    foreach ($l in $Linhas) {
        if ((Dia-Venda $l) -cne $Dia) { throw 'resposta de outro dia' }
        $offline = $null -ne $l.PSObject.Properties['ean']
        if ($offline) {
            $ean = Ean-Texto (Campo $l 'ean')
            $qtd = Numero-Decimal (Campo $l 'qtd')
            $valor = Centavos-Venda (Campo $l 'valor')
            $bruto = Centavos-Venda (Campo $l 'valor_bruto')
            $desconto = Centavos-Venda (Campo $l 'desconto')
        } else {
            $ean = Ean-Texto (Campo $l 'idProduto')
            $qtd = Numero-Decimal (Campo $l 'qtItem')
            $valor = Centavos-Venda (Campo $l 'vlCupom')
            $bruto = Centavos-Venda (Campo $l 'vlCupomSemDescontoAcrescimo')
            $desconto = Centavos-Venda (Campo $l 'vlDescontoPromocaoCombinada')
        }
        if ($qtd -lt 0) { throw 'quantidade negativa' }
        $info = $null
        if ($Catalogo.ean.ContainsKey($ean)) { $info = $Catalogo.ean[$ean] }
        elseif ($Catalogo.codigo.ContainsKey($ean)) { $info = $Catalogo.codigo[$ean] }
        elseif (-not $offline) {
            $cd = Campo $l 'cdProduto'
            if ($null -ne $cd -and -not [string]::IsNullOrWhiteSpace([string]$cd)) {
                $chaveCd = Ean-Texto $cd
                if ($Catalogo.codigo.ContainsKey($chaveCd)) { $info = $Catalogo.codigo[$chaveCd] }
            }
        }
        $nome=$null; $categoria=$null; $formato='outro'; $fator=$null; $familia=$null
        if ($null -ne $info) {
            $nome=$info.nome; $categoria=$info.categoria; $formato=$info.formato
            $fator=$info.fator; $familia=$info.familia
        } else { $semCatalogo[$ean]=$true }
        if (-not $agrupados.ContainsKey($ean)) {
            $agrupados[$ean] = [ordered]@{
                ean=$ean; nome=$nome; categoria=$categoria; formato=$formato
                potes_por_unidade=$fator; familia=$familia; qtd=[decimal]0
                valor_centavos=[long]0; valor_bruto_centavos=[long]0; desconto_centavos=[long]0
            }
        }
        $item = $agrupados[$ean]
        if ($item.formato -cne $formato -or $item.familia -cne $familia -or $item.nome -cne $nome) { throw 'enriquecimento ambiguo' }
        $item.qtd = [decimal]$item.qtd + $qtd
        foreach ($par in @(@('valor_centavos',$valor),@('valor_bruto_centavos',$bruto),@('desconto_centavos',$desconto))) {
            $soma = [decimal]$item[$par[0]] + [decimal]$par[1]
            if ($soma -gt [long]::MaxValue) { throw 'total do item excede bigint' }
            $item[$par[0]] = [long]$soma
        }
    }
    $itens = @($agrupados.Values | Sort-Object { $_.ean })
    if ($itens.Count -gt 2000) { throw 'mais de 2000 EANs' }
    [decimal]$total=0; [decimal]$potes=0
    foreach ($item in $itens) {
        $total += [decimal]$item.valor_centavos
        if ($null -ne $item.potes_por_unidade) { $potes += $item.qtd * $item.potes_por_unidade }
    }
    if ($total -gt [long]::MaxValue) { throw 'total diario excede bigint' }
    return [pscustomobject]@{ itens=$itens; valor_total_centavos=[long]$total; potes=$potes; sem_catalogo=$semCatalogo.Count }
}

function Sincronizar-Vendas($Catalogo) {
    $script:VendasFalhou = $false
    $porDia = @{}
    $hoje = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $ZonaSP).Date
    $dias = if ($BackfillDias -gt 0) {
        @((($BackfillDias-1)..0) | ForEach-Object { $hoje.AddDays(-$_).ToString('yyyy-MM-dd') })
    } else { @($hoje.ToString('yyyy-MM-dd'),$hoje.AddDays(-1).ToString('yyyy-MM-dd')) }
    # O pipeline do if desembrulha a lista de um unico dia em String; forca array.
    [string[]]$dias = @($dias)
    if ($ArquivoVendas) {
        try {
            $jsonArquivo = Get-Content -LiteralPath $ArquivoVendas -Raw -Encoding UTF8
            if (-not $jsonArquivo.TrimStart().StartsWith('[') -or $jsonArquivo.Length -gt 64MB) { throw 'arquivo vendas invalido' }
            foreach ($l in @(ConvertFrom-Json -InputObject $jsonArquivo | ForEach-Object { $_ })) {
                $diaLinha = Dia-Venda $l
                if (-not $porDia.ContainsKey($diaLinha)) { $porDia[$diaLinha] = New-Object Collections.ArrayList }
                [void]$porDia[$diaLinha].Add($l)
            }
        } catch {
            $script:VendasFalhou=$true; Log 'ERRO vendas arquivo offline invalido.'; return
        }
    } elseif ($ArquivoEntrada -or $ArquivoEntradaSemSaldo) {
        $script:VendasFalhou=$true; Log 'ERRO vendas informe -ArquivoVendas para manter o teste totalmente offline.'; return
    }
    [decimal]$totalPeriodo=0; [decimal]$potesPeriodo=0; $linhasPeriodo=0; $diasComLinhas=0; $falhas=0
    for ($d=0; $d -lt $dias.Count; $d++) {
        $dia=$dias[$d]; $etapa='leitura'
        try {
            if ($ArquivoVendas) {
                $linhas=@()
                if ($porDia.ContainsKey($dia)) { $linhas=@($porDia[$dia] | ForEach-Object { $_ }) }
            } else {
                $jsonDia = Ler-VendasErp $dia
                if (-not $jsonDia.TrimStart().StartsWith('[') -or $jsonDia.Length -gt 32MB) { throw 'resposta vendas invalida' }
                $linhas=@(ConvertFrom-Json -InputObject $jsonDia | ForEach-Object { $_ })
            }
            $coleta=[DateTimeOffset]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", $Invariant)
            $execucao=[guid]::NewGuid().ToString('D')
            $etapa='normalizacao'
            $normal = Normalizar-Vendas $linhas $dia $Catalogo
            $envelope=[ordered]@{
                dia=$dia; coletado_em=$coleta; execucao_id=$execucao
                linhas=$normal.itens.Count; valor_total_centavos=$normal.valor_total_centavos
                potes=$normal.potes; sem_catalogo=$normal.sem_catalogo; itens=$normal.itens
            }
            if ($Real) {
                $etapa='rpc'
                if (-not $script:Token) { $script:Token=Entrar-Supabase }
                $r = Chamar-Rpc 'solidcon_receber_vendas' @{
                    p_dia=$dia; p_itens=$normal.itens; p_coletado_em=$coleta; p_execucao_id=$execucao
                }
                if ($r.status -cne 'ok' -or $r.dia -cne $dia -or $r.execucao_id -cne $execucao -or
                    $r.linhas -ne $normal.itens.Count -or $r.valor_total_centavos -ne $normal.valor_total_centavos -or
                    [DateTimeOffset]::Parse($r.coletado_em,$Invariant) -ne [DateTimeOffset]::Parse($coleta,$Invariant)) {
                    throw 'vendas nao confirmadas'
                }
            } else {
                $etapa='saida'
                $nomeArquivo=if ($BackfillDias -gt 0) { 'vendas-'+$dia+'.json' } elseif ($d -eq 0) { 'vendas-hoje.json' } else { 'vendas-ontem.json' }
                Salvar-Json $envelope (Join-Path $Pasta $nomeArquivo)
            }
            $totalPeriodo += $normal.valor_total_centavos; $potesPeriodo += $normal.potes
            $linhasPeriodo += $normal.itens.Count
            if ($normal.itens.Count -gt 0) { $diasComLinhas++ }
            Log ('OK vendas dia={0} linhas={1} centavos={2} potes={3} sem_catalogo={4}' -f
                $dia,$normal.itens.Count,$normal.valor_total_centavos,$normal.potes,$normal.sem_catalogo)
        } catch {
            $script:VendasFalhou=$true; $falhas++
            if ($etapa -ceq 'rpc') { $script:Token=$null }
            Log ('ERRO vendas dia={0} fase={1}; estoque preservado.' -f $dia,$etapa)
        }
        if ($BackfillDias -gt 0 -and -not $ArquivoVendas -and $d -lt $dias.Count-1) { Start-Sleep -Milliseconds 700 }
    }
    if (-not $Real) {
        Salvar-Json ([ordered]@{
            dias_solicitados=$dias.Count; dias_com_linhas=$diasComLinhas; falhas=$falhas
            linhas=$linhasPeriodo; valor_total_centavos=$totalPeriodo; potes=$potesPeriodo
        }) (Join-Path $Pasta 'vendas-resumo.json')
    }
}

try {
    $Cfg = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Cfg.modo -cnotin @('teste', 'real')) { throw 'modo invalido' }
    $Real = $Cfg.modo -ceq 'real'
    if ($Real -and ($ArquivoEntrada -or $ArquivoEntradaSemSaldo -or $ArquivoVendas)) { throw 'arquivos locais so podem ser usados em teste' }
    if ([bool]$ArquivoEntrada -ne [bool]$ArquivoEntradaSemSaldo) { throw 'informar os dois arquivos ou nenhum' }
    if ((Inteiro-Positivo $Cfg.filialEsperada) -ne 4) { throw 'filial deve ser 4' }
    if ($Cfg.categorias -isnot [array] -or $Cfg.categorias.Count -ne 2) { throw 'categorias invalidas' }
    foreach ($categoria in $CategoriasPermitidas) {
        if ($categoria -cnotin $Cfg.categorias) { throw 'categorias diferentes das autorizadas' }
    }
    $api = [uri]$Cfg.apiBase
    if (-not $api.IsAbsoluteUri -or $api.Scheme -cne 'http' -or $api.Port -ne 5100 -or
        $api.Host -cnotin @('localhost', '127.0.0.1') -or $api.AbsolutePath -ne '/' -or
        $api.Query -or $api.Fragment -or $api.UserInfo) { throw 'apiBase deve ser loopback porta 5100' }
    if ([string]::IsNullOrWhiteSpace([string]$Cfg.pastaSaida) -or -not [IO.Path]::IsPathRooted($Cfg.pastaSaida)) {
        throw 'pastaSaida deve ser absoluta'
    }
    # Mesmo nome para todas as pastas/configuracoes e sessoes desta maquina.
    # Se outro usuario nao permitir abrir o mutex, falhar fechado.
    $Fase = 'mutex'
    $Mensagem = 'Outra execucao SOLIDCON esta ativa ou o mutex global nao esta acessivel.'
    $Mutex = New-Object Threading.Mutex($false, 'Global\TempRioSolidconSync')
    try {
        $MutexAdquirido = $Mutex.WaitOne(0)
    } catch [Threading.AbandonedMutexException] {
        # Processo anterior morreu; WaitOne concede a posse nesse caso.
        $MutexAdquirido = $true
    }
    if (-not $MutexAdquirido) { throw 'execucao simultanea' }
    $Pasta = [IO.Path]::GetFullPath($Cfg.pastaSaida)
    [IO.Directory]::CreateDirectory($Pasta) | Out-Null
    $Fase = 'trava'
    $Mensagem = 'Outra execucao esta ativa ou a pasta de saida nao permite escrita.'
    $Trava = [IO.File]::Open((Join-Path $Pasta 'sync.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    if ($Real) {
        $Fase = 'configuracao-supabase'
        $Mensagem = 'Configuracao Supabase invalida.'
        $supabase = [uri]$Cfg.supabaseUrl
        if (-not $supabase.IsAbsoluteUri -or $supabase.Scheme -cne 'https' -or $supabase.Port -ne 443 -or
            $supabase.AbsolutePath -ne '/' -or $supabase.Query -or $supabase.Fragment -or $supabase.UserInfo) {
            throw 'Supabase deve usar HTTPS sem caminho'
        }
        foreach ($campo in @('anonKey', 'syncEmail', 'syncSenha')) {
            if ([string]::IsNullOrWhiteSpace([string]$Cfg.$campo) -or [string]$Cfg.$campo -match 'PREENCHER') {
                throw 'credencial nao preenchida'
            }
        }
        $SupabaseBase = $supabase.GetLeftPart([UriPartial]::Authority)
        $SupabasePronto = $true
    }
    if ($BackfillDias -gt 0) {
        # So vendas: ler catalogo para enriquecer, sem RPC nem estado de estoque.
        try {
            $jsonComSaldo = Ler-RespostaErp $true $ArquivoEntrada
            $jsonSemSaldo = Ler-RespostaErp $false $ArquivoEntradaSemSaldo
        } catch { Log 'AVISO vendas catalogo indisponivel no backfill; itens sem metadados.' }
        $EstoqueOk = $true
    } else {
    try {
    $Fase = 'leitura'
    $Mensagem = 'Falha lendo as duas respostas ERP (arquivos/GETs locais, timeout 60s cada).'
    $jsonComSaldo = Ler-RespostaErp $true $ArquivoEntrada
    $jsonSemSaldo = Ler-RespostaErp $false $ArquivoEntradaSemSaldo
    # Instante apos receber os DOIS corpos, antes de normalizar/autenticar.
    # Arquivos locais em teste usam o instante da leitura, sem Supabase.
    $ColetadoEm = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", $Invariant)
    $Fase = 'normalizacao'
    $Mensagem = 'Resposta ERP invalida: arrays, filial, filtro de saldo, preco, tipos, EANs ou linhas conflitantes. Espelho preservado.'
    foreach ($json in @($jsonComSaldo, $jsonSemSaldo)) {
        if (-not $json.TrimStart().StartsWith('[') -or $json.Length -gt 32MB) { throw 'cada resposta deve ser array ate 32 MiB' }
    }
    $linhasComSaldo = ConvertFrom-Json -InputObject $jsonComSaldo
    $linhasSemSaldo = ConvertFrom-Json -InputObject $jsonSemSaldo
    if ($linhasComSaldo -isnot [array] -or $linhasSemSaldo -isnot [array]) { throw 'respostas devem ser arrays' }
    $produtos = @{}
    $EstoquesOriginais = @{}
    $TodosComSaldo = @{}
    $TodosSemSaldo = @{}
    $VendaveisComSaldo = @{}
    $VendaveisSemSaldo = @{}
    $ZeradosErp = @{}
    $NegativosErp = @{}
    $LinhasNegativasErp = 0
    $LinhasNegativasFiltradas = 0
    $filtradas = 0
    foreach ($grupo in @(
        @{ comSaldo = $true; linhas = $linhasComSaldo },
        @{ comSaldo = $false; linhas = $linhasSemSaldo }
    )) {
      foreach ($linha in $grupo.linhas) {
        # Conferir TODAS as linhas antes de filtrar insumos.
        if ((Inteiro-Positivo $linha.id_loja) -ne $Cfg.filialEsperada) { throw 'filial diferente da esperada' }
        $id = Inteiro-Positivo $linha.id_produto
        $chave = $id.ToString($Invariant)
        $estoqueErp = Numero-Decimal $linha.qtd_produto
        if (($grupo.comSaldo -and $estoqueErp -le 0) -or (-not $grupo.comSaldo -and $estoqueErp -gt 0)) {
            throw 'API nao respeitou o filtro de saldo'
        }
        if ($grupo.comSaldo) { $TodosComSaldo[$chave] = $true } else { $TodosSemSaldo[$chave] = $true }
        if ($estoqueErp -lt 0) { $LinhasNegativasErp++ }
        if ($linha.classificacao01 -cnotin $Cfg.categorias) { continue }
        $filtradas++
        if ($grupo.comSaldo) { $VendaveisComSaldo[$chave] = $true } else { $VendaveisSemSaldo[$chave] = $true }
        if ($estoqueErp -eq 0) { $ZeradosErp[$chave] = $true }
        if ($estoqueErp -lt 0) { $NegativosErp[$chave] = $true; $LinhasNegativasFiltradas++ }
        # Caixa vendavel nas duas respostas tem prioridade: registrar diagnostico
        # completo e abortar o ciclo abaixo, sem escolher uma das linhas.
        if ($produtos.ContainsKey($chave) -and -not $grupo.comSaldo -and $VendaveisComSaldo.ContainsKey($chave)) { continue }
        if ($linha.ativo -isnot [bool] -or -not $linha.ativo) { throw 'produto inativo na consulta de ativos' }
        if ($linha.produto -isnot [string] -or $linha.produto.Length -notin 1..1000 -or
            $linha.emb -isnot [string] -or $linha.emb.Length -gt 100) { throw 'nome ou embalagem invalida' }
        $preco = Numero-Decimal $linha.vl_produto
        if ($preco -lt 0) { throw 'preco negativo' }
        $estoque = [Math]::Max($estoqueErp, [decimal]0)
        $centavos = [decimal]::Round(($preco * 100), 0, [MidpointRounding]::AwayFromZero)
        if ($centavos -gt [long]::MaxValue) { throw 'preco excede bigint' }
        $ean = Ean-Texto $linha.codigo_ean
        $data = Data-Erp $linha.dtalteracao
        $item = [ordered]@{
            id_produto = $id; id_loja = [int]$Cfg.filialEsperada
            nome = $linha.produto; categoria = $linha.classificacao01; emb = $linha.emb
            preco_centavos = [long]$centavos; estoque_disponivel = $estoque
            eans = @($ean); dtalteracao_erp = $data
        }
        if ($produtos.ContainsKey($chave)) {
            $anterior = $produtos[$chave]
            # EAN nao multiplica estoque/preco. Divergencia aborta o snapshot.
            if ($EstoquesOriginais[$chave] -ne $estoqueErp) { throw 'estoques ERP do mesmo produto divergem' }
            foreach ($campo in @('nome', 'categoria', 'emb', 'preco_centavos', 'estoque_disponivel', 'dtalteracao_erp')) {
                if ($anterior[$campo] -cne $item[$campo]) { throw 'linhas do mesmo produto divergem' }
            }
            $anterior.eans = @(@($anterior.eans) + @($ean) | Sort-Object -Unique)
        } else { $produtos[$chave] = $item; $EstoquesOriginais[$chave] = $estoqueErp }
      }
    }
    $itens = @($produtos.Values | Sort-Object { $_.id_produto })
    $SobrepostosTodos = @($TodosComSaldo.Keys | Where-Object { $TodosSemSaldo.ContainsKey($_) } | Sort-Object)
    $Sobrepostos = @($VendaveisComSaldo.Keys | Where-Object { $VendaveisSemSaldo.ContainsKey($_) } | Sort-Object)
    $instante = [DateTimeOffset]::UtcNow.ToString('o')
    $resumo = [ordered]@{
        status = 'ok'; modo = $Cfg.modo; executado_em = $instante; coletado_em = $ColetadoEm
        execucao_id = $ExecucaoId; linhas_recebidas = ($linhasComSaldo.Count + $linhasSemSaldo.Count)
        linhas_com_saldo = $linhasComSaldo.Count; linhas_sem_saldo = $linhasSemSaldo.Count
        linhas_filtradas = $filtradas; qtd_presente = $itens.Count
        caixas24 = @($itens | Where-Object { $_.categoria -ceq $CategoriasPermitidas[0] }).Count
        caixas48 = @($itens | Where-Object { $_.categoria -ceq $CategoriasPermitidas[1] }).Count
        com_saldo = $VendaveisComSaldo.Count; zerados = $VendaveisSemSaldo.Count
        zerados_erp = $ZeradosErp.Count; negativos = $NegativosErp.Count
        linhas_negativas_erp = $LinhasNegativasErp; linhas_negativas_filtradas = $LinhasNegativasFiltradas
        sobrepostos = $Sobrepostos.Count; sobrepostos_todos = $SobrepostosTodos.Count
        ids_sobrepostos = $Sobrepostos; ids_sobrepostos_todos = $SobrepostosTodos
        eans = (@($itens | ForEach-Object { $_.eans }).Count)
    }
    $contagens = ('linhas={0} filtradas={1} produtos={2} CX24={3} CX48={4} com_saldo={5} zerados={6} zerados_erp={7} negativos={8} sobrepostos={9} sobrepostos_todos={10}' -f
        $resumo.linhas_recebidas, $filtradas, $itens.Count, $resumo.caixas24, $resumo.caixas48,
        $resumo.com_saldo, $resumo.zerados, $resumo.zerados_erp, $resumo.negativos, $resumo.sobrepostos, $resumo.sobrepostos_todos)
    # Insumos sobrepostos sao apenas diagnostico; nao entram no espelho.
    if ($Sobrepostos.Count -gt 0) {
        $Fase = 'sobreposicao'
        $Mensagem = 'Caixa vendavel apareceu com e sem saldo entre as consultas. Ciclo abortado; tentar novamente na proxima execucao.'
        $resumo.status = 'erro'
        $resumo.Add('motivo', 'sobreposicao_entre_consultas')
        Salvar-Json $resumo (Join-Path $Pasta 'resumo-rejeitado.json')
        Log ('DIAGNOSTICO ' + $contagens)
        throw 'consultas sobrepostas'
    }
    $Fase = 'sanidade'
    $Mensagem = 'Trava de sanidade: zero produtos, mais de 2000 ou queda superior a 50% vs ultimo OK. Espelho preservado.'
    if ($itens.Count -eq 0 -or $itens.Count -gt 2000) { throw 'quantidade invalida' }
    # Testes jamais substituem a referencia de producao.
    $estadoPath = Join-Path $Pasta ('ultimo-ok-' + $Cfg.modo + '.json')
    if (Test-Path -LiteralPath $estadoPath) {
        $estado = Get-Content -LiteralPath $estadoPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $anteriorQtd = Inteiro-Positivo $estado.qtd_presente
        if ($estado.filial -ne 4 -or $estado.apiBase -cne $api.AbsoluteUri) { throw 'estado de outra origem' }
        if ($itens.Count -lt ($anteriorQtd * 0.5)) { throw 'queda maior que 50%' }
    }
    if (-not $Real) {
        $Fase = 'saida-teste'
        $Mensagem = 'Falha gravando arquivos de teste.'
        Salvar-Json $itens (Join-Path $Pasta 'produtos-normalizados.json')
        Salvar-Json $resumo (Join-Path $Pasta 'resumo.json')
    } else {
        $Fase = 'login'
        $Mensagem = 'Falha no login Supabase. Verificar conta e configuracao local.'
        $Token = Entrar-Supabase
        $Fase = 'rpc'
        $Mensagem = 'Falha na RPC/confirmacao Supabase. Resultado remoto pode ser incerto; proxima execucao reenvia snapshot.'
        $resultado = Chamar-Rpc 'solidcon_receber_produtos' @{
            p_itens = $itens; p_coletado_em = $ColetadoEm; p_execucao_id = $ExecucaoId
        }
        if ($resultado.status -ceq 'erro') {
            # A RPC confirmou a rejeicao E gravou seu log; nao duplicar falha.
            $FalhaRegistrada = $true
            $Mensagem = 'Snapshot recusado e registrado pela RPC; espelho preservado.'
            throw 'snapshot recusado'
        }
        if ($resultado.status -cne 'ok' -or $resultado.qtd_presente -ne $itens.Count -or
            $resultado.qtd_recebida -ne $itens.Count -or $resultado.execucao_id -cne $ExecucaoId -or
            [DateTimeOffset]::Parse($resultado.coletado_em, $Invariant) -ne [DateTimeOffset]::Parse($ColetadoEm, $Invariant)) {
            throw 'confirmacao invalida'
        }
    }
    $Fase = 'estado-local'
    $Mensagem = 'Snapshot concluido, mas falhou a gravacao do estado/log local. Conferir antes da proxima execucao.'
    Salvar-Json ([ordered]@{
        qtd_presente = $itens.Count; concluido_em = $instante; coletado_em = $ColetadoEm
        execucao_id = $ExecucaoId; filial = 4; apiBase = $api.AbsoluteUri
    }) $estadoPath
    Log ('OK modo={0} {1} EANs={2} execucao={3} coletado_em={4}' -f
        $Cfg.modo, $contagens, $resumo.eans, $ExecucaoId, $ColetadoEm)
    $EstoqueOk = $true
    } catch {
    # Somente mensagens fixas; nunca $_, corpo HTTP, configuracao, senha ou token.
    $falha = 'ERRO fase=' + $Fase + ': ' + $Mensagem
    try { Log $falha } catch { Write-Output $falha }
    if ($Real -and $SupabasePronto -and $Trava -and -not $FalhaRegistrada) {
        try {
            if (-not $Token) { $Token = Entrar-Supabase }
            $null = Chamar-Rpc 'solidcon_registrar_falha' @{ p_msg = $falha }
        } catch {
            try { Log 'ERRO nao foi possivel registrar falha no Supabase.' } catch {}
        }
    }
    }
    }
    $catalogoVendas = @{ ean=@{}; codigo=@{} }
    try { $catalogoVendas = Criar-CatalogoVendas $jsonComSaldo $jsonSemSaldo }
    catch { Log 'AVISO vendas catalogo indisponivel; nomes/categorias nulos e formato outro.' }
    try { Sincronizar-Vendas $catalogoVendas }
    catch { $VendasFalhou=$true; Log 'ERRO vendas falha local; estoque preservado.' }
    $CodigoSaida = if (-not $EstoqueOk) { 1 } elseif ($VendasFalhou) { 3 } else { 0 }
} catch {
    # Configuracao/mutex invalidos impedem ambos os fluxos, sem chamadas extras.
    try { Log ('ERRO fase=' + $Fase + ': ' + $Mensagem) } catch {}
    $CodigoSaida = 1

} finally {
    $Token = $null
    if ($Trava) { $Trava.Dispose() }
    if ($MutexAdquirido) { $Mutex.ReleaseMutex() }
    if ($Mutex) { $Mutex.Dispose() }
}

exit $CodigoSaida
