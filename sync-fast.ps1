# ============================================================
#  MewKonomy 快速增量同步（免编译版）
#  用法：powershell -ExecutionPolicy Bypass -File .\sync-fast.ps1
#  适用：仅改动了 public/ 下的静态文件（data/data.json、market.json、
#        图片、SVG、音频等）。此类文件不经过编译，可直接增量同步到线上。
#  注意：若改动了 src/ 源码或 vite.config.ts 等，必须改用 deploy.ps1
#        全量构建（线上跑的是编译产物，hash 文件名，源码不编译不生效）。
#  流程：比对 public 与 dist -> 增量复制变更文件 -> 网络通道探测
#        -> 生成临时 git 全局配置 -> 推送 gh-pages
#  关键规避：
#     - gh-pages 内部 git 会读取全局失效代理，用 GIT_CONFIG_GLOBAL 指向
#       临时配置文件（空 proxy + sslVerify + credential.helper=wincred）
#       覆盖，不改动用户真实全局/本地 git 配置（不再写 local 配置）。
#     - 通道自动探测：直连 GitHub -> 常见本地代理端口逐个试（含旧 10808）。
# ============================================================
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$tmpCfg                 = ''    # 临时 git 配置文件路径
$channelLog             = [System.Collections.Generic.List[string]]::new()
$env:GIT_CONFIG_GLOBAL  = ''
$env:GIT_CONFIG_NOSYSTEM = '1'  # 忽略系统级 git 配置，进一步隔离干扰

# ---------- 可调参数 ----------
$ProxyPorts    = @(7897, 7890, 10808, 10809, 1080, 8118)       # 常见本地代理端口，逐个试（含旧 10808）
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

# 用 git 真实网络栈探测指定通道连通性（公开仓库探测，不走本仓库凭据）
# $cfgArgs: git -c 参数数组；$desc: 通道描述
function Test-Channel([string[]]$cfgArgs, [string]$desc) {
    $start = Get-Date
    Write-Host "  尝试 [$desc] ..." -NoNewline
    & git @cfgArgs -c http.lowSpeedLimit=1 -c http.lowSpeedTime=15 ls-remote --heads $ProbeRepo 2>$null | Out-Null
    $ok   = ($LASTEXITCODE -eq 0)
    $el   = ((Get-Date) - $start).TotalSeconds
    $mark = if ($ok) { 'OK' } else { 'FAIL' }
    $channelLog.Add(("{0,-42} -> {1,-4} ({2,4:N1}s)" -f $desc, $mark, $el))
    if ($ok) {
        Write-Host " 可用 (${el:N1}s)" -ForegroundColor Green
    } else {
        Write-Host " 不可用 (${el:N1}s)" -ForegroundColor DarkGray
    }
    return $ok
}

# 生成临时 git 全局配置文件（覆盖全局失效代理，供 gh-pages 内部 git 使用，不改动真实配置）
function New-TempGitConfig([string]$cfgPath, [bool]$sslVerify) {
    & git config --file $cfgPath http.proxy  ''
    & git config --file $cfgPath https.proxy ''
    & git config --file $cfgPath http.sslVerify  $sslVerify
    & git config --file $cfgPath https.sslVerify $sslVerify
    & git config --file $cfgPath credential.helper wincred
    # 继承全局提交身份（GIT_CONFIG_GLOBAL 会替代 ~/.gitconfig，否则提交身份丢失）
    $gName  = & git config --global --get user.name  2>$null
    $gEmail = & git config --global --get user.email 2>$null
    if ($gName)  { & git config --file $cfgPath user.name  $gName  }
    if ($gEmail) { & git config --file $cfgPath user.email $gEmail }
    if ($LASTEXITCODE -ne 0) { throw "生成临时 git 配置失败: $cfgPath" }
}

# 通道探测汇总文本（用于报错/结束报告）
function Get-ChannelSummary {
    return ($channelLog -join "`n")
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

    # ============ [2/4] 网络通道探测与临时 git 配置 ============
    Write-Step "[2/4] 检测网络通道并准备临时 git 配置"
    $selected = $null
    $selSsl   = $true

    # ① 直连 GitHub（严格证书校验）
    if (Test-Channel @('-c','http.proxy=','-c','https.proxy=','-c','http.sslVerify=true','-c','https.sslVerify=true') '直连 GitHub') {
        $selected = '直连 GitHub'
        $selSsl   = $true
    }
    # ② 常见本地代理端口自动探测
    else {
        foreach ($port in $ProxyPorts) {
            $p = "http://127.0.0.1:$port"
            if (Test-Channel @('-c',"http.proxy=$p",'-c',"https.proxy=$p",'-c','http.sslVerify=true','-c','https.sslVerify=true') "本地代理 $p") {
                $selected = "本地代理 $p"
                $selSsl   = $true
                break
            }
        }
    }

    if (-not $selected) {
        throw "全部通道均不可达，已尝试：`n$(Get-ChannelSummary)"
    }
    Write-Host ""
    Write-Host "  >>> 选中通道: $selected" -ForegroundColor Green

    # 生成临时 git 全局配置（空 proxy 覆盖全局失效代理，供 gh-pages 内部 git 读取）
    $tmpCfg = Join-Path $env:TEMP ("mewkonomy-gitconfig-" + [guid]::NewGuid().ToString('N') + ".cfg")
    New-TempGitConfig $tmpCfg $selSsl
    $env:GIT_CONFIG_GLOBAL = $tmpCfg
    Write-Host "  临时 git 配置已生效: $tmpCfg（不写本地仓库配置、不污染真实配置）" -ForegroundColor DarkGray

    # 清理旧版脚本写入的本地仓库残留配置（credential.helper / http.proxy）
    & git config --local --unset-all credential.helper 2>$null
    & git config --local --unset-all http.proxy 2>$null
    Write-Host "  已清理本地仓库残留代理/凭据配置" -ForegroundColor DarkGray

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
    # 清理临时 git 配置（环境变量随进程退出自然失效，无需还原）
    if ($tmpCfg -and (Test-Path $tmpCfg)) {
        Remove-Item -LiteralPath $tmpCfg -Force -ErrorAction SilentlyContinue
    }
    # 兜底清理本地仓库残留配置（与"不污染真实配置"原则一致）
    & git config --local --unset-all http.proxy 2>$null
    & git config --local --unset-all credential.helper 2>$null
}

Write-Host ""
Read-Host "按回车键关闭窗口"
