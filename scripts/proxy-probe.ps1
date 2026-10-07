# ============================================================
#  代理通道探测（被 push-once.ps1 / deploy-once.ps1 dot-source 引入）
#
#  ## 为什么需要它（2026-10-07 实测记录）
#
#  Watt Toolkit(Steam++) 有两种工作模式，走的端口完全不同：
#
#  ① **hosts 劫持 + 443 MITM**
#     hosts 把 github.com 指向 127.0.0.1:443。但 **Git for Windows 的
#     libcurl 不读 hosts 文件**（实测直连真实 IP 20.205.243.166 超时），
#     而把 git 指向 127.0.0.1:443 当代理时 Watt 对 CONNECT 返回 302
#     （它只处理被劫持的直连流量，不做隧道）。
#     ⇒ 这条路必须靠 scripts/local-github-proxy.mjs 起一个 CONNECT 中继。
#
#  ② **系统代理模式**
#     Watt 直接开一个普通 HTTP 代理端口（实测本机是 **10808**，
#     curl 与 git 走它都通，github 返回 200）。
#     ⇒ 这种情况下**根本不需要本地中继**，直接把 git 指过去即可。
#
#  ## 旧实现的 bug
#
#  push-once.ps1 / deploy-once.ps1 都**写死 7899**、只认路径 ①。
#  于是用户在 ② 模式下无论怎么开关 Watt Toolkit 都没用：
#  7899 无人监听 → git 连不上 → 报「请确认 Watt Toolkit 是否已开启」，
#  而真实原因是「你在另一种模式下，端口根本不对」。
#
#  ## 另一个坑：环境变量里的「死端口」
#
#  实测本机 HTTP_PROXY=http://127.0.0.1:9044：该端口**在监听
#  （PID 2976）但完全不响应**，curl 走它 10 秒超时返回 http_code=000。
#  而 **git 没有自己的 proxy 配置时会读环境变量**，于是被它带进沟里
#  （实测 git ls-remote 直接 exit=128）。
#
#  ⚠️ **端口开着 ≠ 能连**。所以判定必须用**真实的 git 调用**，
# 不能只测 TCP 连接 —— 这正是 9044 会骗过 Test-ProxyPortOpen 的原因。
#
#  ## 用法
#
#     . (Join-Path $PSScriptRoot 'scripts\proxy-probe.ps1')
#     $port = Find-UsableProxyPort -Remote $Remote -Candidates @(10808, 7899)
#     if ($port -eq 0) { $port = Start-LocalConnectProxy -Port 7899 -Script $proxyScript -Log $PLog }
# ============================================================

# 候选端口，按「实测最可能可用」排序。
# 10808/7890/7897/1080/10809 是常见 Watt / Clash / v2rayN 系端口；
# 7899 是本项目本地中继的默认端口；9044 放最后（实测常是死端口）。
$script:ProxyCandidatePorts = @(10808, 7890, 7897, 1080, 10809, 7899, 9044)

function Test-ProxyPortOpen([int]$port) {
    if ($port -le 0) { return $false }
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $iar = $c.BeginConnect('127.0.0.1', $port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(500)
        if ($ok) { $c.EndConnect($iar) }
        $c.Close()
        return $ok
    } catch { return $false }
}

# 用**真实 git 调用**判定端口可用（端口开着 ≠ 能连，9044 就是反例）
function Test-GitViaProxy([int]$port, [string]$remote) {
    if (-not (Test-ProxyPortOpen $port)) { return $false }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    # lowSpeedLimit/Time 让「连得上但传不动」也能在 15 秒内判死
    $null = & git -c "http.proxy=http://127.0.0.1:$port" `
                  -c "https.proxy=http://127.0.0.1:$port" `
                  -c http.sslVerify=false `
                  -c http.lowSpeedLimit=1 -c http.lowSpeedTime=15 `
                  ls-remote --heads $remote main 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    return ($code -eq 0)
}

# 读出环境变量里指向 127.0.0.1 的代理端口（用于提示用户「它们会被覆盖」）
function Get-LocalEnvProxyPorts {
    $r = @()
    foreach ($n in 'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy') {
        $v = [Environment]::GetEnvironmentVariable($n)
        if ($v -and $v -match '127\.0\.0\.1:(\d+)' -and $r -notcontains $Matches[1]) {
            $r += $Matches[1]
        }
    }
    return $r
}

# 依次探测候选端口，返回第一个 git 真能连的；全不行返回 0
function Find-UsableProxyPort {
    param(
        [Parameter(Mandatory = $true)][string]$Remote,
        [int[]]$Candidates = $script:ProxyCandidatePorts
    )
    $t0 = Get-Date
    foreach ($p in $Candidates) {
        if (-not (Test-ProxyPortOpen $p)) { continue }
        Write-Host "      端口 $p 在监听，实测 git ..."
        if (Test-GitViaProxy $p $Remote) {
            Write-Host "  [OK] 可用代理 127.0.0.1:$p" -ForegroundColor Green
            return $p
        }
        Write-Host "  [X] 端口 $p 开着但 git 连不通（死端口）" -ForegroundColor Red
    }
    Write-Host ("  [i] 已探测 " + $Candidates.Count + " 个端口，均不可用（耗时 " +
        [int]((Get-Date) - $t0).TotalSeconds + "s）") -ForegroundColor DarkGray
    return 0
}

# 启动 scripts/local-github-proxy.mjs（hosts 劫持模式下唯一可行的路）
# 返回 @{ Port = <int>; Proc = <Process> }；失败抛异常。
function Start-LocalConnectProxy {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$Script,
        [string]$Log
    )
    if (Test-ProxyPortOpen $Port) {
        Write-Host "  [i] 端口 $Port 已在监听，复用已有反代" -ForegroundColor DarkGray
        return @{ Port = $Port; Proc = $null }
    }
    if ($Log -and (Test-Path $Log)) { Remove-Item $Log -Force -ErrorAction SilentlyContinue }
    $p = Start-Process -FilePath 'node' -ArgumentList @($Script, "$Port") `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $Log -RedirectStandardError "$Log.err"
    $waited = 0
    while ($waited -lt 15 -and -not (Test-ProxyPortOpen $Port)) {
        Start-Sleep -Seconds 1
        $waited++
    }
    if (-not (Test-ProxyPortOpen $Port)) {
        if ($Log -and (Test-Path $Log)) {
            Get-Content $Log -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "      $_" }
        }
        throw "反代启动超时（15 秒）"
    }
    Write-Host "  [OK] 反代已监听 127.0.0.1:$Port（等待 ${waited}s）" -ForegroundColor Green
    if ($Log -and (Test-Path $Log)) {
        $logText = (Get-Content $Log -Raw -ErrorAction SilentlyContinue)
        if ($logText -match 'SELFTEST_OK') { Write-Host "  [OK] 加速通道自检通过" -ForegroundColor Green }
        elseif ($logText -match 'SELFTEST_FAIL') { Write-Host "  [!] 通道自检未通过 —— 请确认 Watt Toolkit 已开启且「GitHub 加速」已勾选" -ForegroundColor Yellow }
    }
    return @{ Port = $Port; Proc = $p }
}

# ── 一站式：优先复用现成代理，没有才起本地中继 ──
function Resolve-GitHubChannel {
    param(
        [Parameter(Mandatory = $true)][string]$Remote,
        [Parameter(Mandatory = $true)][string]$ProxyScript,
        [string]$Log,
        [int]$ExplicitPort = 0,
        [int[]]$Candidates = $script:ProxyCandidatePorts
    )

    $envPorts = Get-LocalEnvProxyPorts
    if ($envPorts.Count -gt 0) {
        Write-Host "  [!] 环境变量代理指向 $($envPorts -join ', ')，推送期间将被显式覆盖" -ForegroundColor Yellow
        Write-Host "      （这类端口常是『在监听但不响应』的死端口）" -ForegroundColor DarkGray
    }

    if ($ExplicitPort -gt 0) {
        Write-Host "  [i] 已指定端口 $ExplicitPort，测试中 ..."
        if (Test-GitViaProxy $ExplicitPort $Remote) {
            Write-Host "  [OK] 端口 $ExplicitPort 可用" -ForegroundColor Green
            return @{ Port = $ExplicitPort; Proc = $null; Owned = $false }
        }
        Write-Host "  [!] 端口 $ExplicitPort 不可用，回退到自动探测" -ForegroundColor Yellow
    }

    $found = Find-UsableProxyPort -Remote $Remote -Candidates $Candidates
    if ($found -gt 0) {
        return @{ Port = $found; Proc = $null; Owned = $false }
    }

    # 都没有 → 起本地 CONNECT 中继（这是 hosts 劫持模式的前提）
    Write-Host "  [i] 没有现成代理端口，改为启动本地反代（hosts 劫持模式）..." -ForegroundColor DarkGray
    $fallbackPort = if ($ExplicitPort -gt 0) { $ExplicitPort } else { 7899 }
    $started = Start-LocalConnectProxy -Port $fallbackPort -Script $ProxyScript -Log $Log
    return @{ Port = $started.Port; Proc = $started.Proc; Owned = ($null -ne $started.Proc) }
}
