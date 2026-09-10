# ============================================================
#  MewKonomy 快速增量同步（免编译版）
#  用法：powershell -ExecutionPolicy Bypass -File .\sync-fast.ps1
#  适用：仅改动了 public/ 下的静态文件（data/data.json、market.json、
#        图片、SVG、音频等）。此类文件不经过编译，可直接增量同步到线上。
#  注意：若改动了 src/ 源码或 vite.config.ts 等，必须改用 deploy.ps1
#        全量构建（线上跑的是编译产物，hash 文件名，源码不编译不生效）。
#  流程：比对 public 与 dist -> 增量复制变更文件 -> 推送 gh-pages
# ============================================================
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# ---------- 可调参数 ----------
$ProxyUrl      = 'http://127.0.0.1:10808'
$BranchPages   = 'gh-pages'
$DistDir       = 'dist'
$ProbeRepo     = 'https://github.com/octocat/Hello-World.git'  # 连通性探测（公开仓库，无需凭据）
# 以下为"需要重新编译"的源码路径，用于检测是否误用本脚本
$SourcePaths   = @('src', 'vite.config.ts', 'package.json', 'pnpm-lock.yaml', '.env.public', 'uno.config.ts', 'tsconfig.json')
# ------------------------------

function Write-Step([string]$Title) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor DarkCyan
    Write-Host " $Title" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor DarkCyan
}

function Test-GitHubConnect([string]$proxy) {
    & git -c http.proxy="$proxy" -c http.lowSpeedLimit=1 -c http.lowSpeedTime=15 `
         ls-remote --heads $ProbeRepo 2>$null
    return ($LASTEXITCODE -eq 0)
}

try {
    # ============ [0/4] 前置检查 ============
    Write-Step "[0/4] 前置检查"
    if (-not (Test-Path "$DistDir\index.html")) {
        throw "dist 产物缺失（未找到 $DistDir\index.html）。请先运行 deploy.ps1 完成一次全量构建。"
    }
    $distTime = (Get-Item "$DistDir\index.html").LastWriteTime
    Write-Host "  dist 构建时间: $distTime" -ForegroundColor DarkGray

    # 源码比产物新 -> 警告可能未编译
    $srcNewer = @()
    foreach ($sp in $SourcePaths) {
        if (Test-Path $sp) {
            $item = Get-Item $sp -ErrorAction SilentlyContinue
            if ($item.PSIsContainer) {
                $latest = Get-ChildItem $sp -Recurse -File -ErrorAction SilentlyContinue |
                          Sort-Object LastWriteTime -Descending | Select-Object -First 1
                if ($latest -and $latest.LastWriteTime -gt $distTime) { $srcNewer += $sp }
            }
            elseif ($item.LastWriteTime -gt $distTime) { $srcNewer += $sp }
        }
    }
    if ($srcNewer.Count -gt 0) {
        Write-Host "  [!] 以下源码晚于上次构建，改动可能未反映到线上：" -ForegroundColor Yellow
        $srcNewer | ForEach-Object { Write-Host "      - $_" -ForegroundColor Yellow }
        Write-Host "      若本次改的是逻辑代码，请改用 deploy.ps1 全量构建；只改 public 静态文件可忽略。" -ForegroundColor Yellow
    }

    # ============ [1/4] 增量比对并复制 public -> dist ============
    Write-Step "[1/4] 增量比对 public -> dist（不编译）"
    $pubRoot = (Resolve-Path 'public').Path
    $changed = @()
    $pubFiles = Get-ChildItem 'public' -Recurse -File
    foreach ($f in $pubFiles) {
        $rel = $f.FullName.Substring($pubRoot.Length + 1)
        $target = Join-Path $DistDir $rel
        if (Test-Path $target) {
            $h1 = (Get-FileHash $f.FullName -Algorithm SHA256).Hash
            $h2 = (Get-FileHash $target -Algorithm SHA256).Hash
            if ($h1 -eq $h2) { continue }
        }
        New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
        Copy-Item $f.FullName $target -Force
        $changed += $rel
    }

    if ($changed.Count -eq 0) {
        Write-Host "  无 public 静态文件变更，无需同步。" -ForegroundColor Green
        exit 0
    }
    Write-Host "  本次需同步 $($changed.Count) 个文件：" -ForegroundColor Cyan
    $changed | ForEach-Object { Write-Host "    + $_" -ForegroundColor DarkGray }

    # ============ [2/4] 网络与凭据环境 ============
    Write-Step "[2/4] 检测网络与凭据环境"
    & git config --local credential.helper wincred
    if ($LASTEXITCODE -ne 0) { throw "设置 git 凭据助手 wincred 失败" }
    Write-Host "  凭据助手已设为 wincred（本地仓库）" -ForegroundColor Green

    $useProxy = $false
    Write-Host "  探测 GitHub 直连 ..." -NoNewline
    if (Test-GitHubConnect '') {
        Write-Host " 可用" -ForegroundColor Green
        $useProxy = $false
    }
    else {
        Write-Host " 不可用"
        Write-Host "  尝试本地代理 $ProxyUrl ..." -NoNewline
        if (Test-GitHubConnect $ProxyUrl) {
            Write-Host " 可用" -ForegroundColor Green
            $useProxy = $true
        }
        else { throw "GitHub 直连与代理 ($ProxyUrl) 均不可达，请检查网络后重试" }
    }
    if ($useProxy) {
        & git config --local http.proxy $ProxyUrl
        if ($LASTEXITCODE -ne 0) { throw "写入本地代理配置失败" }
    }
    else {
        & git config --local http.proxy ''
        if ($LASTEXITCODE -ne 0) { throw "写入直连配置失败" }
    }

    # ============ [3/4] 推送产物到 gh-pages ============
    Write-Step "[3/4] 推送构建产物到 gh-pages"
    Write-Host "  npx gh-pages -d $DistDir -b $BranchPages ..."
    & npx --yes gh-pages -d $DistDir -b $BranchPages
    if ($LASTEXITCODE -ne 0) { throw "gh-pages 推送失败，请检查网络/凭据" }
    Write-Host "  gh-pages 推送成功" -ForegroundColor Green

    # ============ 完成 ============
    Write-Host ""
    Write-Host "  ✔ 增量同步完成！" -ForegroundColor Green
    Write-Host "    页面地址: https://forever985.github.io/mewkonomy/" -ForegroundColor Green
    Write-Host "    （静态资源 CDN 可能缓存数十秒，稍后刷新即可看到更新）" -ForegroundColor DarkGray
}
catch {
    Write-Host ""
    Write-Host "  ✘ 同步失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    & git config --local --unset-all http.proxy 2>$null
}

Write-Host ""
Read-Host "按回车键关闭窗口"
