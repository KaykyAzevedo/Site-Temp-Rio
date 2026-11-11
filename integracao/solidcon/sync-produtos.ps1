#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Config = 'C:\TempRio\solidcon\config.json',
    [string]$ArquivoEntrada,
    [string]$ArquivoEntradaSemSaldo,
    [ValidateRange(1,400)][int]$BackfillDias,
    [string]$ArquivoVendas,
    [string]$ArquivoClientes,
    [string]$ArquivoVendasClientes
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
$ClientesFalhou = $false
$FichaFalhou = $false
$VendasClientesFalhou = $false
$VcHttpStatus = $null
# Teto de GETs GetVendasResumo por execucao (blocos + divisoes por HTTP 500).
$VendasClientesMaxGets = 60
$EstoqueOk = $false
$jsonComSaldo = $null
$jsonSemSaldo = $null
$linhasComSaldo = $null
$linhasSemSaldo = $null
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
    if ($Nome -notin @('solidcon_receber_produtos', 'solidcon_registrar_falha', 'solidcon_receber_vendas', 'solidcon_receber_clientes', 'solidcon_receber_ficha', 'solidcon_receber_vendas_clientes')) { throw 'RPC invalida' }
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
    } elseif ($ArquivoEntrada -or $ArquivoEntradaSemSaldo -or $ArquivoClientes -or $ArquivoVendasClientes) {
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

function Campo-Cliente($Objeto, [string]$Nome) {
    $p = $Objeto.PSObject.Properties[$Nome]
    if ($null -eq $p) { return $null }
    # Nao permitir que o pipeline converta [] em null ou [valor] em escalar.
    return ,$p.Value
}

function Texto-Cliente($Valor, [int]$Limite, [bool]$Obrigatorio = $false) {
    if ($null -eq $Valor) {
        if ($Obrigatorio) { throw 'campo cliente obrigatorio' }
        return $null
    }
    if ($Valor -isnot [string] -or $Valor.Length -gt $Limite -or $Valor -match '[\x00-\x1F\x7F]') {
        throw 'campo cliente invalido'
    }
    $texto = $Valor.Trim()
    if (-not $texto) {
        if ($Obrigatorio) { throw 'campo cliente obrigatorio' }
        return $null
    }
    return $texto
}

function Normalizar-Clientes([string]$Json) {
    if (-not $Json.TrimStart().StartsWith('[') -or $Json.Length -gt 32MB) { throw 'resposta clientes invalida' }
    # PS 5.1 pode devolver um unico objeto que e o array inteiro. Desembrulhar.
    $linhas = @(ConvertFrom-Json -InputObject $Json)
    if ($linhas.Count -eq 1 -and $linhas[0] -is [array]) { $linhas = @($linhas[0]) }
    if ($linhas.Count -eq 0 -or $linhas.Count -gt 10000) { throw 'quantidade clientes invalida' }
    $vistos = @{}; $itens = New-Object Collections.ArrayList
    # Digitos verificadores (modulo 11) de CPF/CNPJ: p1/p2 sao os pesos dos 2 DVs.
    $DvValido = {
        param([string]$d, [int[]]$p1, [int[]]$p2)
        if ($d -match '^(\d)\1+$') { return $false }
        foreach ($pesos in $p1, $p2) {
            $k = $pesos.Count; $s = 0
            for ($i = 0; $i -lt $k; $i++) { $s += [int][string]$d[$i] * $pesos[$i] }
            $r = $s % 11; $dv = if ($r -lt 2) { 0 } else { 11 - $r }
            if ($dv -ne [int][string]$d[$k]) { return $false }
        }
        return $true
    }
    foreach ($l in $linhas) {
        if ($null -eq $l -or $l -isnot [pscustomobject]) { throw 'cliente invalido' }
        $cpf = Campo-Cliente $l 'cpf'
        if ($null -eq $cpf -or ($cpf -isnot [string] -and $cpf -isnot [int] -and $cpf -isnot [long])) {
            throw 'documento ausente ou impreciso'
        }
        $texto = if ($cpf -is [IFormattable]) { $cpf.ToString($null, $Invariant) } else { [string]$cpf }
        if ($texto -notmatch '^[0-9./ -]{1,32}$') { throw 'documento invalido' }
        $digitos = $texto -replace '[^0-9]', ''
        if ($digitos.Length -notin 1..14) { throw 'documento invalido' }
        # ERP usa cpf Int64 para ambos. tipo explicito opcional resolve zeros ambiguos.
        $tipo = Campo-Cliente $l 'tipo'
        if ($null -ne $tipo) {
            if ($tipo -isnot [string] -or $tipo -cnotin @('cpf','cnpj')) { throw 'tipo cliente invalido' }
        } elseif ($digitos.Length -gt 11) {
            $tipo = 'cnpj'
        } else {
            # Ate 11 digitos: um CNPJ com zeros a esquerda perdidos fica igual a um CPF.
            # Desempata pelos digitos verificadores; se ambos ou nenhum baterem, CPF.
            $cpfOk = & $DvValido $digitos.PadLeft(11, [char]'0') @(10..2) @(11..2)
            $cnpjOk = & $DvValido $digitos.PadLeft(14, [char]'0') @(5,4,3,2,9,8,7,6,5,4,3,2) @(6,5,4,3,2,9,8,7,6,5,4,3,2)
            $tipo = if ($cnpjOk -and -not $cpfOk) { 'cnpj' } else { 'cpf' }
        }
        $tamanho = if ($tipo -ceq 'cnpj') { 14 } else { 11 }
        if ($digitos.Length -gt $tamanho) { throw 'tipo e documento divergentes' }
        $documento = $digitos.PadLeft($tamanho, [char]'0')
        if ($vistos.ContainsKey($documento)) { throw 'documento duplicado' }
        $vistos[$documento] = $true
        $endereco = Campo-Cliente $l 'endereco'
        if ($null -ne $endereco -and $endereco -isnot [pscustomobject]) { throw 'endereco invalido' }
        $cidade = $null; $bairro = $null; $estado = $null
        if ($null -ne $endereco) {
            $cidade = Texto-Cliente (Campo-Cliente $endereco 'cidade') 100
            $bairro = Texto-Cliente (Campo-Cliente $endereco 'bairro') 100
            $estado = Texto-Cliente (Campo-Cliente $endereco 'estado') 2
            if ($null -ne $estado) {
                $estado = $estado.ToUpperInvariant()
                if ($estado -cnotmatch '^[A-Z]{2}$') { throw 'estado cliente invalido' }
            }
        }
        # Projecao explicita: nenhum outro campo da resposta ERP e enviado/gravado.
        [void]$itens.Add([ordered]@{
            documento=$documento; tipo=$tipo; nome=(Texto-Cliente (Campo-Cliente $l 'nome') 150 $true)
            telefone=(Texto-Cliente (Campo-Cliente $l 'telefone') 32)
            celular=(Texto-Cliente (Campo-Cliente $l 'celular') 32)
            email=(Texto-Cliente (Campo-Cliente $l 'email') 254)
            cidade=$cidade; bairro=$bairro; estado=$estado
        })
    }
    $normalizados = @($itens | Sort-Object { $_.documento })
    if ([Text.Encoding]::UTF8.GetByteCount((ConvertTo-Json -InputObject $normalizados -Depth 5 -Compress)) -gt 16MB) {
        throw 'payload clientes fora do limite'
    }
    return [pscustomobject]@{ itens=$normalizados }
}

function Ler-ClientesErp {
    # Unica rota de CLIENTES autorizada. Sem retry, proxy, redirect ou URL livre.
    $pedido = [Net.HttpWebRequest]::Create('http://localhost:5100/api/Cliente/GetClientes')
    $pedido.Method = 'GET'; $pedido.Proxy = $null; $pedido.AllowAutoRedirect = $false
    $pedido.Timeout = 120000; $pedido.ReadWriteTimeout = 120000; $pedido.Accept = 'application/json'
    $resposta = $pedido.GetResponse()
    try {
        if ([int]$resposta.StatusCode -ne 200) { throw 'status clientes inesperado' }
        $leitor = New-Object IO.StreamReader($resposta.GetResponseStream(), [Text.Encoding]::UTF8, $true)
        try { return $leitor.ReadToEnd() } finally { $leitor.Dispose() }
    } finally { $resposta.Dispose() }
}

function Sincronizar-Clientes {
    $script:ClientesFalhou = $false
    if ($BackfillDias -gt 0) { return } # Backfill continua exclusivo de vendas.
    $faseClientes = 'agenda'; $reservaGravada = $false; $consulta = $null
    $consultaPath = Join-Path $Pasta 'clientes-consulta.json'
    try {
        if ($ArquivoClientes) {
            $faseClientes = 'arquivo'
            $jsonClientes = Get-Content -LiteralPath $ArquivoClientes -Raw -Encoding UTF8
        } else {
            if ($ArquivoEntrada -or $ArquivoEntradaSemSaldo -or $ArquivoVendas -or $ArquivoVendasClientes) {
                throw 'informe ArquivoClientes para teste offline'
            }
            $agoraSP = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $ZonaSP)
            $dia = $agoraSP.ToString('yyyy-MM-dd')
            if ($agoraSP.Hour -lt 6) { Log 'ADIADO clientes antes de 06:00 America/Sao_Paulo.'; return }
            if (Test-Path -LiteralPath $consultaPath) {
                $consulta = Get-Content -LiteralPath $consultaPath -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($consulta.versao -ne 1 -or $consulta.dia -isnot [string] -or
                    $consulta.status -cnotin @('pendente','ok','erro')) { throw 'estado clientes invalido' }
                $diaAnterior = [DateTime]::ParseExact($consulta.dia, 'yyyy-MM-dd', $Invariant)
                if ($diaAnterior -gt $agoraSP.Date) { throw 'estado clientes futuro' }
                if ($consulta.dia -ceq $dia) {
                    if ($consulta.status -cne 'ok') { $script:ClientesFalhou = $true }
                    Log ('SEM GET clientes consulta ja reservada hoje status={0}.' -f $consulta.status)
                    return
                }
            }
            $consulta = [ordered]@{
                versao=1; dia=$dia; tentativa_em=[DateTimeOffset]::UtcNow.ToString('o'); status='pendente'
            }
            # Reserva duravel ANTES do GET. Timeout/queda do processo nao gera nova consulta hoje.
            # Compartilhada entre teste e real; pastaSaida deve ser unica e persistente.
            $faseClientes = 'reserva'
            Salvar-Json $consulta $consultaPath
            $reservaGravada = $true
            $faseClientes = 'leitura'
            $jsonClientes = Ler-ClientesErp
        }
        $coleta = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", $Invariant)
        $execucao = [guid]::NewGuid().ToString('D')
        $faseClientes = 'normalizacao'
        $normal = Normalizar-Clientes $jsonClientes
        $jsonClientes = $null
        $estadoPathClientes = Join-Path $Pasta ('clientes-ultimo-ok-' + $Cfg.modo + '.json')
        if (Test-Path -LiteralPath $estadoPathClientes) {
            $anterior = Get-Content -LiteralPath $estadoPathClientes -Raw -Encoding UTF8 | ConvertFrom-Json
            $qtdAnterior = Inteiro-Positivo $anterior.linhas
            if ($normal.itens.Count -lt ($qtdAnterior * 0.5)) { throw 'queda clientes maior que 50%' }
        }
        if ($Real) {
            $faseClientes = 'rpc'
            if (-not $script:Token) { $script:Token = Entrar-Supabase }
            $r = Chamar-Rpc 'solidcon_receber_clientes' @{
                p_itens=$normal.itens; p_coletado_em=$coleta; p_execucao_id=$execucao
            }
            if ($r.status -cne 'ok' -or $r.execucao_id -cne $execucao -or $r.linhas -ne $normal.itens.Count -or
                [DateTimeOffset]::Parse($r.coletado_em,$Invariant) -ne [DateTimeOffset]::Parse($coleta,$Invariant)) {
                throw 'clientes nao confirmados'
            }
        } else {
            $faseClientes = 'saida-teste'
            Salvar-Json ([ordered]@{
                coletado_em=$coleta; execucao_id=$execucao; linhas=$normal.itens.Count; itens=$normal.itens
            }) (Join-Path $Pasta 'clientes-normalizados.json')
        }
        $faseClientes = 'estado-local'
        Salvar-Json ([ordered]@{
            linhas=$normal.itens.Count; coletado_em=$coleta; execucao_id=$execucao
        }) $estadoPathClientes
        if ($reservaGravada) { $consulta.status='ok'; Salvar-Json $consulta $consultaPath }
        Log ('OK clientes modo={0} linhas={1} execucao={2} coletado_em={3}' -f $Cfg.modo,$normal.itens.Count,$execucao,$coleta)
    } catch {
        $script:ClientesFalhou = $true
        if ($faseClientes -ceq 'rpc') { $script:Token = $null }
        if ($reservaGravada) {
            try { $consulta.status='erro'; Salvar-Json $consulta $consultaPath } catch {}
        }
        # Nunca corpo ERP/erro bruto: pode conter dado pessoal ou credencial.
        try { Log ('ERRO clientes fase={0}; estoque e vendas preservados; sem novo GET hoje.' -f $faseClientes) } catch {}
    }
}

function Normalizar-Ficha($LinhasCom, $LinhasSem) {
    if ($null -eq $LinhasCom -or $null -eq $LinhasSem) { throw 'linhas de produtos ausentes para ficha' }
    $linhas = @(
        @($LinhasCom | ForEach-Object { $_ })
        @($LinhasSem | ForEach-Object { $_ })
    )
    if ($linhas.Count -eq 0) { throw 'linhas vazias para ficha' }
    $produtos = @{}
    foreach ($l in $linhas) {
        if ($null -eq $l -or $l -isnot [pscustomobject]) { continue }
        if ((Inteiro-Positivo $l.id_loja) -ne $Cfg.filialEsperada) { throw 'filial diferente da esperada' }
        if ($l.classificacao01 -cnotin $Cfg.categorias) { continue }
        $id = Inteiro-Positivo $l.id_produto
        $chave = $id.ToString($Invariant)

        # NCM: 8 digitos ou null
        $ncm = $null
        $ncmVal = Campo $l 'ncm'
        if ($null -ne $ncmVal -and -not [string]::IsNullOrWhiteSpace([string]$ncmVal)) {
            $ncmStr = ([string]$ncmVal).Trim()
            if ($ncmStr -notmatch '^[0-9]{8}$') { throw 'NCM invalido' }
            $ncm = $ncmStr
        }

        # CEST: 7 digitos ou null
        $cest = $null
        $cestVal = Campo $l 'cest'
        if ($null -ne $cestVal -and -not [string]::IsNullOrWhiteSpace([string]$cestVal)) {
            $cestStr = ([string]$cestVal).Trim()
            if ($cestStr -notmatch '^[0-9]{7}$') { throw 'CEST invalido' }
            $cest = $cestStr
        }

        # QTD_MEDIDA: numeric >= 0 ou null
        $qtdMedida = $null
        $qtdVal = Campo $l 'qtd_medida'
        if ($null -ne $qtdVal -and -not [string]::IsNullOrWhiteSpace([string]$qtdVal)) {
            $qtdNum = Numero-Decimal $qtdVal
            if ($qtdNum -lt 0 -or $qtdNum -ge 1000000000) { throw 'qtd_medida fora do limite' }
            $qtdMedida = $qtdNum
        }

        # UNID_MEDIDA: string 1..20 chars sem cntrl ou null
        $unidMedida = $null
        $unidVal = Campo $l 'unid_medida'
        if ($null -ne $unidVal -and -not [string]::IsNullOrWhiteSpace([string]$unidVal)) {
            $unidStr = ([string]$unidVal).Trim()
            if ($unidStr.Length -lt 1 -or $unidStr.Length -gt 20 -or $unidStr -match '[\x00-\x1F\x7F]') {
                throw 'unid_medida invalida'
            }
            $unidMedida = $unidStr
        }

        $item = [ordered]@{
            id_produto = $id
            ncm = $ncm
            cest = $cest
            qtd_medida = $qtdMedida
            unid_medida = $unidMedida
        }

        if ($produtos.ContainsKey($chave)) {
            $ant = $produtos[$chave]
            if ($ant.ncm -cne $item.ncm -or $ant.cest -cne $item.cest -or
                $ant.qtd_medida -ne $item.qtd_medida -or $ant.unid_medida -cne $item.unid_medida) {
                throw 'ficha divergente para o mesmo produto'
            }
        } else {
            $produtos[$chave] = $item
        }
    }
    $itens = @($produtos.Values | Sort-Object { $_.id_produto })
    if ($itens.Count -eq 0 -or $itens.Count -gt 2000) { throw 'quantidade de produtos na ficha invalida' }
    return [pscustomobject]@{ itens = $itens }
}

function Sincronizar-Ficha($LinhasCom, $LinhasSem) {
    $script:FichaFalhou = $false
    if ($BackfillDias -gt 0) { return }
    $faseFicha = 'agenda'; $reservaGravada = $false; $consulta = $null
    # Reserva diaria separada por modo: um teste na mesma pasta/dia nunca faz o real pular a RPC.
    $consultaPath = Join-Path $Pasta ('ficha-consulta-' + $Cfg.modo + '.json')
    try {
        if ($null -eq $LinhasCom -or $null -eq $LinhasSem) {
            throw 'dados de produtos ausentes para extracao de ficha'
        }
        $agoraSP = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $ZonaSP)
        $dia = $agoraSP.ToString('yyyy-MM-dd')
        if (Test-Path -LiteralPath $consultaPath) {
            $consulta = Get-Content -LiteralPath $consultaPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($consulta.versao -ne 1 -or $consulta.dia -isnot [string] -or
                $consulta.status -cnotin @('pendente','ok','erro')) { throw 'estado ficha invalido' }
            $diaAnterior = [DateTime]::ParseExact($consulta.dia, 'yyyy-MM-dd', $Invariant)
            if ($diaAnterior -gt $agoraSP.Date) { throw 'estado ficha futuro' }
            if ($consulta.dia -ceq $dia) {
                if ($consulta.status -cne 'ok') { $script:FichaFalhou = $true }
                Log ('SEM ENVIO ficha ja reservada hoje status={0}.' -f $consulta.status)
                return
            }
        }
        $consulta = [ordered]@{
            versao=1; dia=$dia; tentativa_em=[DateTimeOffset]::UtcNow.ToString('o'); status='pendente'
        }
        $faseFicha = 'reserva'
        Salvar-Json $consulta $consultaPath
        $reservaGravada = $true

        $coleta = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", $Invariant)
        $execucao = [guid]::NewGuid().ToString('D')
        $faseFicha = 'normalizacao'
        $normal = Normalizar-Ficha $LinhasCom $LinhasSem
        $estadoPathFicha = Join-Path $Pasta ('ficha-ultimo-ok-' + $Cfg.modo + '.json')
        if ($Real) {
            $faseFicha = 'rpc'
            if (-not $script:Token) { $script:Token = Entrar-Supabase }
            $r = Chamar-Rpc 'solidcon_receber_ficha' @{
                p_itens = $normal.itens; p_coletado_em = $coleta; p_execucao_id = $execucao
            }
            # encontrados = itens presentes no espelho; atualizados (0..N) = linhas que mudaram.
            # "ok" sem confirmar todos os produtos nao e aceito.
            if ($r.status -cne 'ok' -or $r.execucao_id -cne $execucao -or $r.linhas -ne $normal.itens.Count -or
                $r.encontrados -isnot [ValueType] -or $r.encontrados -ne $normal.itens.Count -or
                $r.atualizados -isnot [ValueType] -or $r.atualizados -lt 0 -or $r.atualizados -gt $normal.itens.Count -or
                [DateTimeOffset]::Parse($r.coletado_em, $Invariant) -ne [DateTimeOffset]::Parse($coleta, $Invariant)) {
                throw 'ficha nao confirmada'
            }
        } else {
            $faseFicha = 'saida-teste'
            Salvar-Json ([ordered]@{
                coletado_em=$coleta; execucao_id=$execucao; linhas=$normal.itens.Count; itens=$normal.itens
            }) (Join-Path $Pasta 'ficha-normalizada.json')
        }
        $faseFicha = 'estado-local'
        Salvar-Json ([ordered]@{
            linhas=$normal.itens.Count; coletado_em=$coleta; execucao_id=$execucao
        }) $estadoPathFicha
        if ($reservaGravada) { $consulta.status = 'ok'; Salvar-Json $consulta $consultaPath }
        Log ('OK ficha modo={0} linhas={1} execucao={2} coletado_em={3}' -f $Cfg.modo, $normal.itens.Count, $execucao, $coleta)
    } catch {
        $script:FichaFalhou = $true
        if ($faseFicha -ceq 'rpc') { $script:Token = $null }
        if ($reservaGravada) {
            try { $consulta.status = 'erro'; Salvar-Json $consulta $consultaPath } catch {}
        }
        try { Log ('ERRO ficha fase={0}; estoque, vendas e clientes preservados; sem novo envio hoje.' -f $faseFicha) } catch {}
    }
}

function Inteiro-NaoNegativo($Valor, [long]$Maximo) {
    # Sem arredondamento: 1.5 e rejeitado (nao vira 2).
    $numero = Numero-Decimal $Valor
    if ($numero -lt 0 -or [decimal]::Truncate($numero) -ne $numero -or $numero -gt $Maximo) {
        throw 'inteiro invalido'
    }
    return [long]$numero
}

function Dt-VendaCliente($Valor) {
    if ($Valor -isnot [string] -or
        $Valor -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})?$') {
        throw 'dtCupom invalido'
    }
    if ($Valor -match '(Z|[+-]\d{2}:\d{2})$') {
        $sp = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::Parse($Valor, $Invariant), $ZonaSP)
    } else {
        # Hora sem fuso = estabelecimento em Sao Paulo (mesma regra de Data-Erp).
        $local = [DateTime]::SpecifyKind([DateTime]::Parse($Valor, $Invariant, [Globalization.DateTimeStyles]::None), [DateTimeKind]::Unspecified)
        if ($ZonaSP.IsInvalidTime($local) -or $ZonaSP.IsAmbiguousTime($local)) { throw 'dtCupom ambiguo' }
        $sp = New-Object DateTimeOffset($local, $ZonaSP.GetUtcOffset($local))
    }
    return [pscustomobject]@{
        dia = $sp.ToString('yyyy-MM-dd', $Invariant)
        dt  = $sp.ToString("yyyy-MM-dd'T'HH:mm:sszzz", $Invariant)
    }
}

# $Json: corpo JSON (ERP ou arquivo). Precisa ser array; objeto/erro HTTP nunca vira lote vazio.
# $Inicio/$Fim vazios = sem intervalo (arquivo offline inteiro); preenchidos = cupom fora do
# intervalo consultado rejeita o lote (nao e descartado em silencio).
function Normalizar-VendasClientes([string]$Json, [string]$Inicio, [string]$Fim) {
    if ([string]::IsNullOrEmpty($Json) -or -not $Json.TrimStart().StartsWith('[') -or $Json.Length -gt 32MB) {
        throw 'resposta vendas-clientes invalida'
    }
    $itensRaw = @(ConvertFrom-Json -InputObject $Json)
    if ($itensRaw.Count -eq 1 -and $itensRaw[0] -is [array]) { $itensRaw = @($itensRaw[0]) }
    if ($itensRaw.Count -gt 10000) { throw 'quantidade vendas-clientes fora do limite' }

    # Digitos verificadores (modulo 11) de CPF/CNPJ: p1/p2 sao os pesos dos 2 DVs.
    $DvValido = {
        param([string]$d, [int[]]$p1, [int[]]$p2)
        if ($d -match '^(\d)\1+$') { return $false }
        foreach ($pesos in $p1, $p2) {
            $k = $pesos.Count; $s = 0
            for ($i = 0; $i -lt $k; $i++) { $s += [int][string]$d[$i] * $pesos[$i] }
            $r = $s % 11; $dv = if ($r -lt 2) { 0 } else { 11 - $r }
            if ($dv -ne [int][string]$d[$k]) { return $false }
        }
        return $true
    }

    $itensPorChave = @{}
    $semDoc = 0
    [decimal]$totalCentavos = 0

    foreach ($l in $itensRaw) {
        if ($null -eq $l -or $l -isnot [pscustomobject]) { throw 'item vendas-clientes invalido' }

        # Campos estruturais validados em TODAS as linhas, antes de descartar sem documento:
        # objeto de erro/lixo nunca e contado como "consumidor sem CPF".
        $data = Dt-VendaCliente (Campo $l 'dtCupom')
        if ($Inicio -and $Fim -and ($data.dia -lt $Inicio -or $data.dia -gt $Fim)) {
            throw 'cupom fora do intervalo consultado'
        }
        $vlCupom = Campo $l 'vlCupom'
        if ($null -eq $vlCupom) { throw 'vlCupom obrigatorio' }
        $centavos = Centavos-Venda $vlCupom
        $totalItensNum = Inteiro-NaoNegativo (Campo $l 'totalItens') ([int]::MaxValue)
        $cdPdv = Inteiro-NaoNegativo (Campo $l 'cdPDV') ([int]::MaxValue)
        $nrCupom = Inteiro-NaoNegativo (Campo $l 'nrCupom') ([long]::MaxValue)

        $cdCliente = Campo $l 'cdCliente'
        if ($null -eq $cdCliente) { $semDoc++; continue }
        $textoDoc = if ($cdCliente -is [IFormattable]) { $cdCliente.ToString($null, $Invariant) } else { [string]$cdCliente }
        $digitos = $textoDoc -replace '[^0-9]', ''
        if ($digitos.Length -notin 1..14 -or $digitos -match '^0+$') { $semDoc++; continue }

        # ERP envia cdCliente sem zeros a esquerda (10-14 digitos).
        # Desempata CPF/CNPJ com as regras de DV de Normalizar-Clientes.
        $tipo = $null; $documento = $null
        if ($digitos.Length -gt 11) {
            $doc14 = $digitos.PadLeft(14, [char]'0')
            if (& $DvValido $doc14 @(5,4,3,2,9,8,7,6,5,4,3,2) @(6,5,4,3,2,9,8,7,6,5,4,3,2)) {
                $tipo = 'cnpj'; $documento = $doc14
            } else {
                $semDoc++; continue
            }
        } else {
            $cpfPad = $digitos.PadLeft(11, [char]'0')
            $cnpjPad = $digitos.PadLeft(14, [char]'0')
            $cpfOk = & $DvValido $cpfPad @(10..2) @(11..2)
            $cnpjOk = & $DvValido $cnpjPad @(5,4,3,2,9,8,7,6,5,4,3,2) @(6,5,4,3,2,9,8,7,6,5,4,3,2)
            if ($cnpjOk -and -not $cpfOk) {
                $tipo = 'cnpj'; $documento = $cnpjPad
            } elseif ($cpfOk) {
                $tipo = 'cpf'; $documento = $cpfPad
            } else {
                $semDoc++; continue
            }
        }

        $item = [ordered]@{
            dia            = $data.dia
            dt             = $data.dt
            documento      = $documento
            tipo           = $tipo
            valor_centavos = $centavos
            total_itens    = $totalItensNum
            cd_pdv         = $cdPdv
            nr_cupom       = $nrCupom
        }
        # Chave unica / primaria: (dia, cd_pdv, nr_cupom). Repeticao identica e ignorada;
        # repeticao com qualquer campo diferente rejeita o lote (nunca substitui em silencio).
        $chave = '{0}#{1}#{2}' -f $data.dia, $cdPdv, $nrCupom
        if ($itensPorChave.ContainsKey($chave)) {
            $ant = $itensPorChave[$chave]
            foreach ($campo in @($item.Keys)) {
                if ($ant[$campo] -cne $item[$campo]) { throw 'cupom conflitante no lote' }
            }
            continue
        }
        $itensPorChave[$chave] = $item
    }

    $itensOrdenados = @($itensPorChave.Values | Sort-Object { $_.dia }, { $_.cd_pdv }, { $_.nr_cupom })
    foreach ($it in $itensOrdenados) { $totalCentavos += $it.valor_centavos }
    if ($totalCentavos -gt [long]::MaxValue) { throw 'total vendas-clientes excede bigint' }
    if ([Text.Encoding]::UTF8.GetByteCount((ConvertTo-Json -InputObject $itensOrdenados -Depth 5 -Compress)) -gt 16MB) {
        throw 'payload vendas-clientes fora do limite'
    }
    return [pscustomobject]@{
        itens                = $itensOrdenados
        valor_total_centavos = [long]$totalCentavos
        sem_documento        = $semDoc
    }
}

# Blocos de ate um mes civil (no maximo 31 datas, limite da RPC).
# Saida desenrolada no pipeline; chamadores SEMPRE recolhem com @() (1 ou N blocos).
function Obter-BlocosMensais([datetime]$DataInicio, [datetime]$DataFim) {
    $blocos = New-Object Collections.ArrayList
    $atual = $DataInicio.Date
    $limite = $DataFim.Date
    while ($atual -le $limite) {
        $fimMes = New-Object DateTime($atual.Year, $atual.Month, [DateTime]::DaysInMonth($atual.Year, $atual.Month))
        $fimBloco = if ($fimMes -lt $limite) { $fimMes } else { $limite }
        [void]$blocos.Add([pscustomobject]@{
            Inicio = $atual.ToString('yyyy-MM-dd', $Invariant)
            Fim    = $fimBloco.ToString('yyyy-MM-dd', $Invariant)
        })
        $atual = $fimBloco.AddDays(1)
    }
    return $blocos.ToArray()
}

function Ler-VendasClientesErp([string]$Inicio, [string]$Fim) {
    if ($Inicio -notmatch '^\d{4}-\d{2}-\d{2}$' -or $Fim -notmatch '^\d{4}-\d{2}-\d{2}$') {
        throw 'datas vendas-clientes invalidas'
    }
    # Unica rota de vendas por cliente autorizada. GET, sem proxy ou redirecionamento.
    $url = ('http://localhost:5100/api/Vendas/CNPJ/63671696000106/INICIO/{0}/FIM/{1}/GetVendasResumo' -f $Inicio, $Fim)
    $pedido = [Net.HttpWebRequest]::Create($url)
    $pedido.Method = 'GET'; $pedido.Proxy = $null; $pedido.AllowAutoRedirect = $false
    $pedido.Timeout = 120000; $pedido.ReadWriteTimeout = 120000; $pedido.Accept = 'application/json'
    $script:VcHttpStatus = $null
    try {
        $resposta = $pedido.GetResponse()
    } catch {
        # 4xx/5xx: guardar status e corpo para a decisao exata; sem resposta (rede/timeout) = falha.
        # PS 5.1 embrulha a WebException (MethodInvocationException): procurar na cadeia.
        $ex = $_.Exception
        while ($null -ne $ex -and $ex -isnot [Net.WebException]) { $ex = $ex.InnerException }
        if ($null -eq $ex -or $null -eq $ex.Response) { throw 'ERP vendas-clientes sem resposta' }
        $resposta = $ex.Response
    }
    try {
        $script:VcHttpStatus = [int]$resposta.StatusCode
        $leitor = New-Object IO.StreamReader($resposta.GetResponseStream(), [Text.Encoding]::UTF8, $true)
        try { $corpo = $leitor.ReadToEnd() } finally { $leitor.Dispose() }
    } finally { $resposta.Dispose() }
    return [pscustomobject]@{ status = $script:VcHttpStatus; corpo = [string]$corpo }
}

# So 200 com corpo array segue (periodo sem vendas = 200 "[]"). Todo o resto lanca (exit 6).
# HTTP 500 e tratado antes, em Sincronizar-VendasClientes (divisao do intervalo).
function Corpo-VendasClientes($Http) {
    $corpo = if ($null -eq $Http.corpo) { '' } else { [string]$Http.corpo }
    if ($Http.status -eq 200 -and $corpo.TrimStart().StartsWith('[')) { return $corpo }
    throw 'resposta vendas-clientes nao reconhecida'
}

function Sincronizar-VendasClientes {
    $script:VendasClientesFalhou = $false
    $faseVc = 'inicio'
    try {
        $hoje = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $ZonaSP).Date
        if ($BackfillDias -gt 0) {
            $blocos = @(Obter-BlocosMensais $hoje.AddDays(-($BackfillDias - 1)) $hoje)
        } else {
            # Ciclo normal: 1 GET cobrindo ontem + hoje
            $blocos = @([pscustomobject]@{
                Inicio = $hoje.AddDays(-1).ToString('yyyy-MM-dd', $Invariant)
                Fim    = $hoje.ToString('yyyy-MM-dd', $Invariant)
            })
        }

        $itensArquivo = $null
        if ($ArquivoVendasClientes) {
            # Arquivo inteiro validado de uma vez: qualquer linha invalida falha o fluxo.
            $faseVc = 'arquivo'
            $jsonVc = Get-Content -LiteralPath $ArquivoVendasClientes -Raw -Encoding UTF8
            $itensArquivo = @((Normalizar-VendasClientes $jsonVc '' '').itens)
            if ($BackfillDias -le 0 -and $itensArquivo.Count -gt 0) {
                # Teste offline sem -BackfillDias: se o arquivo sair de ontem..hoje, cobrir seus dias.
                $dias = @($itensArquivo | ForEach-Object { $_.dia } | Sort-Object)
                if ($dias[0] -lt $blocos[0].Inicio -or $dias[-1] -gt $blocos[0].Fim) {
                    $blocos = @(Obter-BlocosMensais ([DateTime]::ParseExact($dias[0], 'yyyy-MM-dd', $Invariant)) ([DateTime]::ParseExact($dias[-1], 'yyyy-MM-dd', $Invariant)))
                }
            }
        } elseif ($ArquivoEntrada -or $ArquivoEntradaSemSaldo -or $ArquivoVendas -or $ArquivoClientes) {
            throw 'informe ArquivoVendasClientes para teste offline'
        }

        $totalItensSincronizados = 0
        $totalCentavosSincronizados = [decimal]0
        $itensArquivoUsados = 0
        $intervalosGravados = 0
        $getsErp = 0
        $diasComErroErp = New-Object Collections.ArrayList
        for ($b = 0; $b -lt $blocos.Count; $b++) {
            $bInicio = [string]$blocos[$b].Inicio
            $bFim = [string]$blocos[$b].Fim
            if ($bInicio -notmatch '^\d{4}-\d{2}-\d{2}$' -or $bFim -notmatch '^\d{4}-\d{2}-\d{2}$' -or $bInicio -gt $bFim) {
                throw 'bloco vendas-clientes invalido'
            }

            # Pilha de sub-intervalos: HTTP 500 divide o intervalo ao meio ate 1 dia.
            # Primeira metade sempre processada antes (ordem cronologica).
            $pilha = New-Object Collections.Stack
            $pilha.Push([pscustomobject]@{ Inicio = $bInicio; Fim = $bFim })
            while ($pilha.Count -gt 0) {
                $iv = $pilha.Pop()
                $faseVc = 'leitura'
                if ($ArquivoVendasClientes) {
                    $itensBloco = @($itensArquivo | Where-Object { $_.dia -ge $iv.Inicio -and $_.dia -le $iv.Fim })
                    [decimal]$somaBloco = 0
                    foreach ($it in $itensBloco) { $somaBloco += $it.valor_centavos }
                    $itensArquivoUsados += $itensBloco.Count
                    $normal = [pscustomobject]@{ itens = $itensBloco; valor_total_centavos = [long]$somaBloco; sem_documento = 0 }
                } else {
                    if ($getsErp -ge $VendasClientesMaxGets) { throw 'teto de GETs vendas-clientes' }
                    # Pausa de 700ms entre GETs ao ERP (blocos e sub-intervalos).
                    if ($getsErp -gt 0) { Start-Sleep -Milliseconds 700 }
                    $getsErp++
                    $http = Ler-VendasClientesErp $iv.Inicio $iv.Fim
                    if ($http.status -eq 500) {
                        if ($iv.Inicio -ceq $iv.Fim) {
                            # Dia que quebra o ERP: pulado, sem RPC; dados ja gravados desse dia ficam.
                            [void]$diasComErroErp.Add($iv.Inicio)
                            Log ('AVISO vendas-clientes ERP http=500 dia={0}; dia pulado, dados existentes preservados.' -f $iv.Inicio)
                            continue
                        }
                        $d0 = [DateTime]::ParseExact($iv.Inicio, 'yyyy-MM-dd', $Invariant)
                        $d1 = [DateTime]::ParseExact($iv.Fim, 'yyyy-MM-dd', $Invariant)
                        $meio = $d0.AddDays([Math]::Floor(($d1 - $d0).TotalDays / 2))
                        $pilha.Push([pscustomobject]@{ Inicio = $meio.AddDays(1).ToString('yyyy-MM-dd', $Invariant); Fim = $iv.Fim })
                        $pilha.Push([pscustomobject]@{ Inicio = $iv.Inicio; Fim = $meio.ToString('yyyy-MM-dd', $Invariant) })
                        continue
                    }
                    $jsonErp = Corpo-VendasClientes $http
                    $faseVc = 'normalizacao'
                    $normal = Normalizar-VendasClientes $jsonErp $iv.Inicio $iv.Fim
                }

                $coleta = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", $Invariant)
                $execucao = [guid]::NewGuid().ToString('D')

                if ($Real) {
                    $faseVc = 'rpc'
                    if (-not $script:Token) { $script:Token = Entrar-Supabase }
                    $r = Chamar-Rpc 'solidcon_receber_vendas_clientes' @{
                        p_inicio      = $iv.Inicio
                        p_fim         = $iv.Fim
                        p_itens       = @($normal.itens)
                        p_coletado_em = $coleta
                        p_execucao_id = $execucao
                    }
                    if ($r.status -cne 'ok' -or $r.execucao_id -cne $execucao -or
                        $r.inicio -cne $iv.Inicio -or $r.fim -cne $iv.Fim -or
                        $r.linhas -ne @($normal.itens).Count -or
                        $r.valor_total_centavos -ne $normal.valor_total_centavos) {
                        throw 'vendas-clientes nao confirmadas pela RPC'
                    }
                } else {
                    $faseVc = 'saida-teste'
                    Salvar-Json @($normal.itens) (Join-Path $Pasta ('vendas-clientes-normalizadas-' + $iv.Inicio + '_' + $iv.Fim + '.json'))
                }
                $intervalosGravados++
                $totalItensSincronizados += @($normal.itens).Count
                $totalCentavosSincronizados += $normal.valor_total_centavos
            }
        }
        if ($ArquivoVendasClientes -and $itensArquivoUsados -ne $itensArquivo.Count) {
            # Cupom do arquivo fora dos blocos (ex.: alem do -BackfillDias) nao some em silencio.
            throw 'arquivo vendas-clientes com cupons fora dos blocos'
        }

        if (-not $Real) {
            $faseVc = 'saida-teste'
            Salvar-Json ([ordered]@{
                blocos               = $blocos.Count
                intervalos_gravados  = $intervalosGravados
                gets_erp             = $getsErp
                itens_total          = $totalItensSincronizados
                valor_total_centavos = [long]$totalCentavosSincronizados
                dias_com_erro_erp    = @($diasComErroErp)
                execucao_id          = $ExecucaoId
            }) (Join-Path $Pasta 'vendas-clientes-resumo.json')
        }

        if ($diasComErroErp.Count -gt 0) {
            Log ('AVISO vendas-clientes dias_com_erro_erp={0} dias={1}' -f $diasComErroErp.Count, ($diasComErroErp -join ','))
            # Nada gravado e so dias com erro: falha (exit 6). Com algo gravado: exit 0 com aviso.
            if ($intervalosGravados -eq 0) { $faseVc = 'erp-500'; throw 'nenhum intervalo gravado' }
        }
        Log ('OK vendas-clientes blocos={0} intervalos={1} gets={2} cupons_clientes={3} total_centavos={4}' -f $blocos.Count, $intervalosGravados, $getsErp, $totalItensSincronizados, [long]$totalCentavosSincronizados)
    } catch {
        $script:VendasClientesFalhou = $true
        if ($faseVc -ceq 'rpc') { $script:Token = $null }
        # Mensagem fixa por fase: nunca $_ nem corpo (poderia conter documento/valor recebido).
        # So o numero do status HTTP: diagnostico de erro do ERP.
        $httpLog = if ($null -ne $script:VcHttpStatus) { ' http=' + [int]$script:VcHttpStatus } else { '' }
        try { Log ('ERRO vendas-clientes fase={0}{1}; outros fluxos preservados.' -f $faseVc, $httpLog) } catch {}
    }
}

try {
    $Cfg = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Cfg.modo -cnotin @('teste', 'real')) { throw 'modo invalido' }
    $Real = $Cfg.modo -ceq 'real'
    if ($Real -and ($ArquivoEntrada -or $ArquivoEntradaSemSaldo -or $ArquivoVendas -or $ArquivoClientes -or $ArquivoVendasClientes)) { throw 'arquivos locais so podem ser usados em teste' }
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
    try { Sincronizar-Clientes }
    catch { $ClientesFalhou=$true; try { Log 'ERRO clientes falha local; estoque e vendas preservados.' } catch {} }
    # Ficha so no ciclo normal e com estoque confirmado neste ciclo (mesmo GetProdutos).
    # Backfill nunca roda ficha; estoque com falha ja sai com 1.
    if ($EstoqueOk -and $BackfillDias -le 0) {
        try { Sincronizar-Ficha $linhasComSaldo $linhasSemSaldo }
        catch { $FichaFalhou=$true; try { Log 'ERRO ficha falha local; estoque, vendas e clientes preservados.' } catch {} }
    }
    try { Sincronizar-VendasClientes }
    catch { $VendasClientesFalhou=$true; try { Log 'ERRO vendas-clientes falha local; estoque, vendas, clientes e ficha preservados.' } catch {} }
    $CodigoSaida = if (-not $EstoqueOk) { 1 } elseif ($VendasFalhou) { 3 } elseif ($ClientesFalhou) { 4 } elseif ($FichaFalhou) { 5 } elseif ($VendasClientesFalhou) { 6 } else { 0 }
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
