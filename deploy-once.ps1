# ============================================================
#  MewKonomy 一键部署（由 一键部署.bat 双击调用，也可直接跑）
#
#  为什么需要专门的网络处理：
#    本机用 Watt Toolkit(Steam++) 的「hosts 劫持 + 443 MITM」模式加速 GitHub，
#    hosts 把 github.com 指向 127.0.0.1:443。但 Git for Windows 的 libcurl
#    **不读 hosts 文件**（实测会直连真实 IP 然后超时），而把 git 直接指向
#    127.0.0.1:443 当代理也不行（Watt 对 CONNECT 请求返回 302，
#    它只处理被劫持的直连流量，不做隧道）。
#
#  本脚本的解法：
#    启动本地 HTTPS CONNECT 反代 scripts/local-github-proxy.mjs，
#    由它读 hosts 并把流量转给 Watt；git / gh-pages 只需认这个普通 HTTP 代理。
#    反代启动时会自检（SELFTEST_OK），通道不通时脚本立刻停下并给出提示：
#    绝不空推，也绝不把「连不上」误报成「部署成功」。
#
#  流程：[0]环境 -> [1]通道 -> [2]构建 -> [3]推 main -> [4]推 gh-pages -> [5]清理
# ============================================================

param(
    [int]$ProxyPort = 7899,
    [int]$MaxAttempts = 3,
    [switch]$SkipBuild,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$Remote = 'https://github.com/Forever985/mewkonomy.git'
$Site   = 'https://forever985.github.io/mewkonomy/'
$PLog   = Join-Path $env:TEMP 'mewkonomy-proxy.log'

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

function Test-PortOpen([int]$port) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $iar = $c.BeginConnect('127.0.0.1', $port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(500)
        if ($ok) { $c.EndConnect($iar) }
        $c.Close()
        return $ok
    } catch { return $false }
}

try {
    Write-Host ""
    Write-Host "  MewKonomy 一键部署" -ForegroundColor White
    Write-Host "  仓库 : $Remote"
    Write-Host "  站点 : $Site"

    # ---------------------------------------------------------- [0/5] 环境
    Step "[0/5] 环境检查"
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "找不到 node，请先安装 Node.js 并加入 PATH" }
    if (-not (Get-Command git  -ErrorAction SilentlyContinue)) { throw "找不到 git" }
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw "找不到 pnpm，请执行: npm i -g pnpm" }
    $proxyScript = Join-Path $PSScriptRoot 'scripts\local-github-proxy.mjs'
    if (-not (Test-Path $proxyScript)) { throw "缺少 scripts\local-github-proxy.mjs" }
    if (-not (Test-Path (Join-Path $PSScriptRoot 'package.json'))) { throw "当前目录不是项目根目录" }
    Info ("node " + (node --version))
    Info (& git --version)
    Ok "环境就绪"

    # ---------------------------------------------------------- [1/5] 通道
    Step "[1/5] 启动加速通道并自检"
    if (Test-PortOpen $ProxyPort) {
        Info "端口 $ProxyPort 已在监听，复用已有反代"
    } else {
        Info "启动本地反代 ..."
        if (Test-Path $PLog) { Remove-Item $PLog -Force -ErrorAction SilentlyContinue }
        $proxyProc = Start-Process -FilePath 'node' -ArgumentList @($proxyScript, "$ProxyPort") `
            -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $PLog -RedirectStandardError "$PLog.err"
        $proxyOwned = $true
        $waited = 0
        while ($waited -lt 15 -and -not (Test-PortOpen $ProxyPort)) {
            Start-Sleep -Seconds 1
            $waited++
        }
        if (-not (Test-PortOpen $ProxyPort)) {
            if (Test-Path $PLog) { Get-Content $PLog -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "      $_" } }
            throw "反代启动超时（15 秒）"
        }
        Ok "反代已监听 127.0.0.1:$ProxyPort（等待 ${waited}s）"
    }

    # 自检结论（反代启动时会把 SELFTEST_OK / SELFTEST_FAIL 写进日志）
    if (Test-Path $PLog) {
        $logText = (Get-Content $PLog -Raw -ErrorAction SilentlyContinue)
        if ($logText -match 'SELFTEST_OK') { Ok "加速通道自检通过" }
        elseif ($logText -match 'SELFTEST_FAIL') { Warn "通道自检未通过 —— 请确认 Watt Toolkit 已开启且「GitHub 加速」已勾选" }
    }

    # 临时 git 配置：走本地反代 + 放行 Watt 自签证书 + 凭据 wincred + 大仓库 postBuffer
    $tmpCfg = Join-Path $env:TEMP ("mewkonomy-deploy-" + [guid]::NewGuid().ToString('N') + ".cfg")
    & git config --file $tmpCfg http.proxy  "http://127.0.0.1:$ProxyPort"
    & git config --file $tmpCfg https.proxy "http://127.0.0.1:$ProxyPort"
    & git config --file $tmpCfg http.sslVerify  false
    & git config --file $tmpCfg https.sslVerify false
    & git config --file $tmpCfg credential.helper wincred
    & git config --file $tmpCfg http.postBuffer 524288000
    # 本仓库目录属主可能不是当前用户（例如曾被管理员账户操作过），
    # 那会让所有 git 写操作以 "detected dubious ownership" 失败；
    # gh-pages 内部还会 clone 到临时目录，同样会撞上。
    # 在临时配置里放行即可，不改动用户的全局配置。
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

    # ---------------------------------------------------------- [2/5] 构建
    Step "[2/5] 构建 public 版本（含 vue-tsc 类型检查）"
    if ($SkipBuild) {
        Warn "已指定 -SkipBuild，跳过构建"
    } else {
        & pnpm build:public
        if ($LASTEXITCODE -ne 0) { throw "构建失败，已中止（未推送任何东西）" }
        if (-not (Test-Path (Join-Path $PSScriptRoot 'dist\index.html'))) { throw "构建完成但缺少 dist\index.html" }
        Ok "构建完成"
    }

    # ---------------------------------------------------------- [3/5] main
    Step "[3/5] 提交并推送源码到 main"
    $attempt = 0
    while ($true) {
        $attempt++
        & git add -A
        if ($LASTEXITCODE -ne 0) { throw "git add 失败" }

        $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        & git commit --no-verify -m "deploy: $stamp" *> $null
        if ($LASTEXITCODE -eq 0) { Ok "已提交: deploy: $stamp" } else { Info "没有新的源码改动，跳过提交" }

        Info "推送 main（第 $attempt 次）..."
        # 注意：git 会把「进度/统计」写到 stderr。若让 PowerShell 把它当错误记录，
        # 配合 $ErrorActionPreference='Stop' 会在 push **成功**时误抛异常。
        # 因此这里临时降级错误策略，只用 $LASTEXITCODE 判定成败。
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $pushOut = & git push origin main 2>&1
        $pushExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEap

        if ($pushExit -eq 0) { Ok "main 推送完成"; break }
        if (($pushOut -join "`n") -match 'Everything up-to-date') { Ok "main 已是最新"; break }

        Warn "main 推送失败："
        $pushOut | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
        if ($attempt -ge $MaxAttempts) { throw "main 推送连续失败 $MaxAttempts 次，已中止" }
        Info "2 秒后重试 ..."
        Start-Sleep -Seconds 2
    }

    # ---------------------------------------------------------- [4/5] gh-pages
    Step "[4/5] 推送构建产物到 gh-pages"

    # 用自带的发布器而不是 `npx gh-pages`：后者默认 CLEAN=true 会清空整条分支，
    # 把线上由 Actions 每 20 分钟维护的 data/ 一起冲掉
    # （实测 a4192aa 把 market_history.json 从 2 个采样点覆盖回 1 个）。
    # scripts/publish-gh-pages.mjs 只同步非 data 文件，并在推送前断言没有删除 data/。
    $attempt = 0
    while ($true) {
        $attempt++
        Info "node scripts\publish-gh-pages.mjs（第 $attempt 次）..."
        # 同上：git 会往 stderr 写进度，不能让它触发终止性错误
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & node (Join-Path $PSScriptRoot 'scripts\publish-gh-pages.mjs') --dir dist --repo $Remote
        $pagesExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEap

        if ($pagesExit -eq 0) { Ok "gh-pages 推送完成"; break }
        Warn "gh-pages 推送失败"
        if ($attempt -ge $MaxAttempts) {
            throw "gh-pages 连续失败 $MaxAttempts 次。`n       注意：main 已推送成功，只是静态站未更新 —— 稍后重跑本脚本即可（无源码变化时会跳过提交，只重推 gh-pages）"
        }
        Info "3 秒后重试 ..."
        Start-Sleep -Seconds 3
    }

    # ---------------------------------------------------------- [5/5] 完成
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  部署完成" -ForegroundColor Green
    Write-Host ""
    Write-Host "  站点地址：$Site" -ForegroundColor Green
    Write-Host "  提示：GitHub Pages 的 CDN 会缓存数十秒。若没看到更新，"
    Write-Host "        请按 Ctrl+F5 强制刷新，或等 1 分钟再试。"
    Write-Host "==========================================================" -ForegroundColor Green
    $exitCode = 0
}
catch {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Red
    Write-Host "  部署失败 —— 未完成，请按上方提示排查" -ForegroundColor Red
    Write-Host ""
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  本脚本不会产生半成品状态：构建失败则完全没推送；" -ForegroundColor DarkGray
    Write-Host "  main 成功但 gh-pages 失败时，直接重跑即可补推。" -ForegroundColor DarkGray
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
}

if (-not $NoPause) {
    Write-Host ""
    Read-Host "按回车键关闭窗口"
}
exit $exitCode
