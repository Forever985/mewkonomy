# ============================================================
#  MewKonomy 一键推送（由 一键推送.bat 双击调用，也可直接跑）
#
#  与 deploy-once.ps1 的分工：那个脚本会先构建、并推 gh-pages；
#  本脚本只做一件事 —— 把本地已有的提交推到 GitHub。
#
#  网络与凭据方案**完全复用 deploy-once.ps1 里验证过的那一套**，不自创：
#    [网络] 启动本地 HTTPS CONNECT 反代 scripts/local-github-proxy.mjs（默认 7899）。
#           本机用 Watt Toolkit(Steam++) 的「hosts 劫持 + 443 MITM」模式加速 GitHub，
#           hosts 把 github.com 指向 127.0.0.1:443；但 Git for Windows 的 libcurl
#           不读 hosts，直连真实 IP 会超时。让 git 只认这个普通 HTTP 代理，
#           DNS 交给反代进程解析（Node 会读 hosts），通道即通。
#    [凭据] 用临时 GIT_CONFIG_GLOBAL 注入 credential.helper=wincred —— 读 Windows
#           凭据管理器里已存的 git:https://github.com；并设 GIT_CONFIG_NOSYSTEM=1，
#           避开系统级 credential.helper=helper-selector（那个会弹 GCM 选择框并阻塞）。
#           **全程不改动用户的任何全局配置**，退出时恢复。
#
#  流程：[0/3]环境 -> [1/3]通道 -> [2/3]推送 -> [3/3]清理
# ============================================================

param(
    [int]$ProxyPort = 0,
    [int]$MaxAttempts = 3,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$Remote = 'https://github.com/Forever985/mewkonomy.git'
$PLog   = Join-Path $env:TEMP 'mewkonomy-push-proxy.log'

$proxyProc  = $null
$proxyOwned = $false
$tmpCfg     = $null

function Step([string]$t) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor DarkCyan
    Write-Host " $t" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor DarkCyan
}
function Ok([string]$m)   { Write-Host "  [OK] $m"   -ForegroundColor Green }
function Info([string]$m) { Write-Host "  [i]  $m"   -ForegroundColor DarkGray }
function Warn([string]$m) { Write-Host "  [!]  $m"   -ForegroundColor Yellow }
function Bad([string]$m)  { Write-Host "  [X]  $m"   -ForegroundColor Red }

# 运行 git 并安全取回 (输出, 退出码)。
# native 命令把进度/错误写到 stderr；在 $ErrorActionPreference='Stop' 下会被当成
# 终止性错误，从而把「命令失败」误报成「脚本崩溃」。这里临时把 EAP 降级。
function Invoke-GitCapture([string[]]$gitArgs) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & git @gitArgs 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    return [pscustomobject]@{ Out = @($out); Code = $code }
}

function Test-PortOpen([int]$port) {
    # 兼容旧调用点：实际实现已挪到 scripts\proxy-probe.ps1（Test-ProxyPortOpen）
    return (Test-ProxyPortOpen $port)
}

# ── 代理探测：从共用模块引入（scripts\proxy-probe.ps1）────────────────
#
# 该模块同时被 deploy-once.ps1 使用；**不要在这里另写一份**，
# 复制粘贴必然随时间漂移（这次就是因为两份脚本各写死 7899 才出的问题）。
. (Join-Path $PSScriptRoot 'scripts\proxy-probe.ps1')

try {
    Write-Host ""
    Write-Host "  MewKonomy 一键推送" -ForegroundColor White
    Write-Host "  仓库 : $Remote"

    # ---------------------------------------------------------- [0/3] 环境
    Step "[0/3] 环境检查"
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "找不到 node，请先安装 Node.js 并加入 PATH" }
    if (-not (Get-Command git  -ErrorAction SilentlyContinue)) { throw "找不到 git" }
    $proxyScript = Join-Path $PSScriptRoot 'scripts\local-github-proxy.mjs'
    if (-not (Test-Path $proxyScript)) { throw "缺少 scripts\local-github-proxy.mjs" }
    if (-not (Test-Path (Join-Path $PSScriptRoot 'package.json'))) { throw "当前目录不是项目根目录" }
    Info ("node " + (node --version))
    Info (& git --version)
    $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
    Info "当前分支：$branch"
    Ok "环境就绪"

    # ---------------------------------------------------------- [1/3] 通道
    Step "[1/3] 探测可用加速通道"

    $channel = Resolve-GitHubChannel -Remote $Remote -ProxyScript $proxyScript -Log $PLog -ExplicitPort $ProxyPort
    $ProxyPort = $channel.Port
    $proxyProc = $channel.Proc
    $proxyOwned = $channel.Owned

    # 临时 git 配置：走本地反代 + 放行 Watt 自签证书 + 凭据 wincred + 大仓库 postBuffer
    # 与 deploy-once.ps1 保持一致（同样的坑，同样的解法）
    $tmpCfg = Join-Path $env:TEMP ("mewkonomy-push-" + [guid]::NewGuid().ToString('N') + ".cfg")
    & git config --file $tmpCfg http.proxy  "http://127.0.0.1:$ProxyPort"
    & git config --file $tmpCfg https.proxy "http://127.0.0.1:$ProxyPort"
    & git config --file $tmpCfg http.sslVerify  false
    & git config --file $tmpCfg https.sslVerify false
    & git config --file $tmpCfg credential.helper wincred
    & git config --file $tmpCfg http.postBuffer 524288000
    # 本仓库目录属主可能不是当前用户，会让 git 以 "detected dubious ownership" 失败
    & git config --file $tmpCfg --add safe.directory '*'
    & git config --file $tmpCfg --add safe.directory ($PSScriptRoot -replace '\\', '/')
    $gName  = & git config --global --get user.name  2>$null
    $gEmail = & git config --global --get user.email 2>$null
    if ($gName)  { & git config --file $tmpCfg user.name  $gName }
    if ($gEmail) { & git config --file $tmpCfg user.email $gEmail }
    $env:GIT_CONFIG_GLOBAL   = $tmpCfg
    $env:GIT_CONFIG_NOSYSTEM = '1'
    $env:GIT_TERMINAL_PROMPT = '0'

    Info "验证远程连通性 ..."
    & git ls-remote --heads $Remote *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "仍无法访问 GitHub。请检查：`n        - Watt Toolkit 是否已打开，且「网络加速 - GitHub」已勾选启用`n        - 或在 Watt Toolkit 中改用「系统代理」模式后重试"
    }
    Ok "GitHub 可达"

    # ---------------------------------------------------------- [2/3] 推送
    Step "[2/3] 推送到 origin/$branch"

    # 取基线：origin/<分支> 可能还不存在（首次推一个新分支），那时退回 origin/main。
    $base = $null
    foreach ($cand in @("origin/$branch", 'origin/main')) {
        $probe = Invoke-GitCapture @('rev-parse', '--verify', '--quiet', $cand)
        if ($probe.Code -eq 0) { $base = $cand; break }
    }

    $diffFiles = @()
    $pending   = @()
    if ($base) {
        $diffFiles = @((Invoke-GitCapture @('diff', '--name-only', "$base..$branch")).Out)
        $pending   = @((Invoke-GitCapture @('log', '--oneline', "$base..$branch")).Out)
    }

    # 预检：本次推送是否会触及 .github/workflows/（GitHub 对此有 PAT 权限要求）
    $wfFiles = @($diffFiles | Where-Object { $_ -match '^\.github/workflows/' })
    if ($wfFiles.Count -gt 0) {
        Warn "本次推送会改动以下 workflow 文件（基线 $base）："
        $wfFiles | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
        Warn "GitHub 规定：这类推送要求 PAT 带 workflow 权限，否则会被 remote rejected。"
        Info "权限页面：https://github.com/settings/tokens"
    }

    if ($pending.Count -eq 0) {
        Info "没有待推提交（相对 $base）"
    } else {
        Info "待推提交（相对 $base）："
        $pending | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
    }

    $attempt = 0
    while ($true) {
        $attempt++
        Info "推送中（第 $attempt 次）..."
        # git 会把进度/统计写到 stderr；此处临时降级错误策略，只用 $LASTEXITCODE 判成败，
        # 否则 push 成功时也会被 $ErrorActionPreference='Stop' 误抛异常。
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $pushOut = & git push origin $branch 2>&1
        $pushExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEap
        $text = ($pushOut -join "`n")

        if ($pushExit -eq 0) { Ok "推送完成"; break }
        if ($text -match 'Everything up-to-date') { Ok "$branch 已是最新，无需推送"; break }

        Write-Host ""
        $pushOut | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
        Write-Host ""

        if ($text -match 'workflow' -and $text -match 'scope') {
            Bad "被 GitHub 拒绝：token 缺 workflow 权限。"
            Bad "这不是网络问题，也不是仓库问题 —— 是权限不足。"
            Info "修复：打开 https://github.com/settings/tokens → 点开该 token → 勾选 workflow → Update token。"
            Info "备选：直接在 GitHub 网页上编辑这两个文件（网页操作不需要 token 权限）。"
            Info "要立刻推其余内容，可把 workflow 改动单独拎出去（见 docs/AI_CONTEXT.md 坑点 13）。"
            throw "推送被拒：token 缺 workflow 权限"
        }
        if ($text -match 'Could not resolve|Failed to connect|Connection (was )?reset|Recv failure|Empty reply|timed out|Connection closed') {
            Warn "看起来是网络错误（通道偶发抖动）。"
            if ($attempt -ge $MaxAttempts) {
                throw "网络重试 $MaxAttempts 次仍失败。请确认 Watt Toolkit 已开启且「GitHub 加速」已勾选，再重跑本脚本。"
            }
            Info "3 秒后重试 ..."
            Start-Sleep -Seconds 3
            continue
        }
        if ($text -match 'Authentication failed|Permission denied|403|invalid username or password') {
            Bad "认证被拒：凭据可能过期或已被撤销。"
            Info "到 https://github.com/settings/tokens 重新签发一个，下次推送时让它重新存入凭据管理器。"
            throw "推送被拒：认证失败"
        }
        Warn "推送失败，错误未被归类（原文见上）。"
        if ($attempt -ge $MaxAttempts) { throw "连续失败 $MaxAttempts 次，已中止" }
        Info "3 秒后重试 ..."
        Start-Sleep -Seconds 3
    }

    # ---------------------------------------------------------- [3/3] 完成
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  推送完成" -ForegroundColor Green
    Write-Host ""
    & git --no-pager log --oneline -3
    Write-Host "==========================================================" -ForegroundColor Green
    $exitCode = 0
}
catch {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Red
    Write-Host "  推送失败 —— 未完成，请按上方提示排查" -ForegroundColor Red
    Write-Host ""
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  本地提交一直安全，没有任何丢失。" -ForegroundColor DarkGray
    Write-Host "==========================================================" -ForegroundColor Red
    $exitCode = 1
}
finally {
    # 只关掉本脚本自己启动的反代，复用的不动
    if ($proxyOwned -and $proxyProc -and -not $proxyProc.HasExited) {
        Stop-Process -Id $proxyProc.Id -Force -ErrorAction SilentlyContinue
        Write-Host "  [i]  已关闭本次启动的本地反代" -ForegroundColor DarkGray
    }
    if ($tmpCfg -and (Test-Path $tmpCfg)) { Remove-Item $tmpCfg -Force -ErrorAction SilentlyContinue }
    $env:GIT_CONFIG_GLOBAL   = $null
    $env:GIT_CONFIG_NOSYSTEM = $null
    $env:GIT_TERMINAL_PROMPT = $null
}

if (-not $NoPause) {
    Write-Host ""
    Read-Host "按回车键关闭窗口"
}
exit $exitCode
