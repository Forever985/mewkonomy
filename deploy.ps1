# ============================================================
#  MewKonomy 一键部署到 GitHub Pages（多渠道自动推送版）
#  用法：
#     powershell -ExecutionPolicy Bypass -File .\deploy.ps1          # 交互式（结束回车关闭）
#     powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -NoWait  # 非交互 / Agent 复用
#  功能：
#     1) 通道自动探测与回退（按优先级，任一可用即继续）：
#         ① Steam++/Watt Toolkit 本地 443 加速通道（hosts 劫持 + 自签 MITM，需放行证书）
#         ② GitHub 直连（严格证书校验；hosts 劫持/自签场景下会失败，属预期）
#         ③ 常见本地代理端口自动探测（7897 Clash / 10808 旧代理 / 7890 / 10809 / 1080 / 8118）
#     2) 完整部署链路：pnpm build:public -> git commit --no-verify -> push main
#                       -> npx gh-pages -d dist -b gh-pages
#  关键规避：
#     - gh-pages 内部 git 会读取全局失效代理，用 GIT_CONFIG_GLOBAL 指向临时配置文件
#       （空 http/https.proxy + sslVerify + credential.helper=wincred）覆盖，
#       不改动用户真实全局/本地 git 配置
#     - 走 Steam++ 443 自签通道时放行证书（sslVerify=false）
#     - 结束自动清理临时配置文件，环境变量随进程退出自然失效，不污染环境
# ============================================================
param(
    [switch]$NoWait,          # 跳过结束回车等待（供 Agent / 非交互复用）
    [switch]$KeepTmpConfig    # 调试用：结束保留临时 git 配置（默认清理）
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# ---------- 可调参数 ----------
$RemoteRepo  = 'https://github.com/Forever985/mewkonomy.git'
$BranchMain  = 'main'
$BranchPages = 'gh-pages'
$DistDir     = 'dist'
$ProbeRepo   = 'https://github.com/octocat/Hello-World.git'  # 仅用于探测连通性（公开仓库，无需凭据）
$ProxyPorts  = @(7897, 7890, 10808, 10809, 1080, 8118)       # 常见本地代理端口，逐个试
# ------------------------------

$tmpCfg          = ''   # 临时 git 配置文件路径
$channelLog      = [System.Collections.Generic.List[string]]::new()
$env:GIT_CONFIG_GLOBAL  = ''
$env:GIT_CONFIG_NOSYSTEM = '1'   # 忽略系统级 git 配置，进一步隔离干扰

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

# 生成临时 git 全局配置文件（覆盖全局失效代理，供 push 与 gh-pages 内部 git 共同使用）
function New-TempGitConfig([string]$cfgPath, [bool]$sslVerify) {
    & git config --file $cfgPath http.proxy  ''
    & git config --file $cfgPath https.proxy ''
    & git config --file $cfgPath http.sslVerify  $sslVerify
    & git config --file $cfgPath https.sslVerify $sslVerify
    & git config --file $cfgPath credential.helper wincred
    # 继承全局提交身份（GIT_CONFIG_GLOBAL 会替代 ~/.gitconfig，否则 commit 报 Author identity unknown）
    $gName  = & git config --global --get user.name  2>$null
    $gEmail = & git config --global --get user.email 2>$null
    if ($gName)  { & git config --file $cfgPath user.name  $gName  }
    if ($gEmail) { & git config --file $cfgPath user.email $gEmail }
    if ($LASTEXITCODE -ne 0) { throw "生成临时 git 配置失败: $cfgPath" }
}

# 通道探测汇总文本（用于结束报告）
function Get-ChannelSummary {
    return ($channelLog -join "`n")
}

try {
    # ============ [0/5] 网络环境检查与通道探测 ============
    Write-Step "[0/5] 检测网络环境与通道探测"
    Write-Host "  remote : $RemoteRepo"
    Write-Host "  分支   : $BranchMain (push) / $BranchPages (npx 推送)"
    $gProxy = & git config --global --get http.proxy 2>$null
    Write-Host "  全局代理: $($gProxy -join '') （gh-pages 内部 git 会读取，下方用临时配置覆盖）" -ForegroundColor DarkGray
    Write-Host ""

    # 仅提示本地残留，不改动（防御旧版脚本遗留）
    $localProxy = & git config --local --get http.proxy 2>$null
    if ($localProxy) {
        Write-Host "  [!] 仓库本地配置存在 http.proxy=$localProxy（可能为旧版脚本残留），" -ForegroundColor Yellow
        Write-Host "      脚本不会改动它；若推送失败可手动执行: git config --local --unset-all http.proxy" -ForegroundColor Yellow
    }

    # ---------- 通道探测（按优先级） ----------
    $selected = $null
    $selSsl   = $true

    # ① Steam++/Watt Toolkit 本地 443 加速通道（hosts 劫持 + 自签 MITM，放行证书）
    if (Test-Channel @('-c','http.proxy=','-c','https.proxy=','-c','http.sslVerify=false','-c','https.sslVerify=false') 'Steam++/Watt Toolkit 443 加速') {
        $selected = 'Steam++/Watt Toolkit 443 加速'
        $selSsl   = $false
    }
    # ② 直连 GitHub（严格证书校验；hosts 劫持/自签场景下失败，属预期）
    elseif (Test-Channel @('-c','http.proxy=','-c','https.proxy=','-c','http.sslVerify=true','-c','https.sslVerify=true') '直连 GitHub') {
        $selected = '直连 GitHub'
        $selSsl   = $true
    }
    # ③ 常见本地代理端口自动探测
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

    # ---------- 生成临时 git 全局配置并写入环境变量 ----------
    $tmpCfg = Join-Path $env:TEMP ("mewkonomy-gitconfig-" + [guid]::NewGuid().ToString('N') + ".cfg")
    New-TempGitConfig $tmpCfg $selSsl
    $env:GIT_CONFIG_GLOBAL = $tmpCfg
    Write-Host "  临时 git 配置已生效: $tmpCfg" -ForegroundColor DarkGray
    Write-Host "  （空 proxy 覆盖全局失效代理; sslVerify=$selSsl; 凭据 wincred; 不污染真实配置）" -ForegroundColor DarkGray

    # ============ [1/5] 构建 public 版本 ============
    Write-Step "[1/5] 构建 public 版本 (pnpm build:public)"
    $t = Get-Date
    & pnpm build:public
    if ($LASTEXITCODE -ne 0) { throw "pnpm build:public 构建失败，请检查上方报错" }
    if (-not (Test-Path $DistDir)) { throw "构建完成但未找到产物目录：$DistDir" }
    Write-Host "  构建完成，产物目录: $PSScriptRoot\$DistDir  (耗时 $([math]::Round(((Get-Date)-$t).TotalSeconds,1))s)" -ForegroundColor Green

    # ============ [2/5] 提交源码到 main ============
    Write-Step "[2/5] 提交源码到 main"
    $t = Get-Date
    & git add .
    if ($LASTEXITCODE -ne 0) { throw "git add 失败，请检查文件权限" }
    $staged = (& git diff --cached --name-only | Where-Object { $_ -ne '' }).Count
    Write-Host "  已暂存 $staged 个文件变更" -ForegroundColor DarkGray

    $commitMsg = "deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    & git commit --no-verify -m $commitMsg 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  （无源码变更，跳过提交）" -ForegroundColor DarkGray
    } else {
        Write-Host "  已提交: $commitMsg" -ForegroundColor Green
    }

    Write-Host "  推送 main -> origin/$BranchMain ..."
    & git push origin $BranchMain
    if ($LASTEXITCODE -ne 0) { throw "main 推送失败，请检查 GitHub 认证与网络（当前通道: $selected）" }
    Write-Host "  main 推送成功 (耗时 $([math]::Round(((Get-Date)-$t).TotalSeconds,1))s)" -ForegroundColor Green

    # ============ [3/5] 推送产物到 gh-pages ============
    Write-Step "[3/5] 推送构建产物到 gh-pages"
    $t = Get-Date
    Write-Host "  npx gh-pages -d $DistDir -b $BranchPages ..."
    & npx --yes gh-pages -d $DistDir -b $BranchPages
    if ($LASTEXITCODE -ne 0) { throw "gh-pages 推送失败，请检查网络/凭据（当前通道: $selected）" }
    Write-Host "  gh-pages 推送成功 (耗时 $([math]::Round(((Get-Date)-$t).TotalSeconds,1))s)" -ForegroundColor Green

    # ============ [4/5] 通道探测汇总 ============
    Write-Step "[4/5] 通道探测汇总"
    Write-Host (Get-ChannelSummary)
    Write-Host ""
    Write-Host "  最终通道: $selected" -ForegroundColor Green

    # ============ 完成 ============
    Write-Step "[5/5] 完成"
    Write-Host "  ✔ 部署完成！" -ForegroundColor Green
    Write-Host "    页面地址: https://forever985.github.io/mewkonomy/" -ForegroundColor Green
    Write-Host "    （若首次部署，请确认 GitHub 仓库 Settings -> Pages 已选 $BranchPages 分支）" -ForegroundColor DarkYellow
}
catch {
    Write-Host ""
    Write-Host "  ✘ 部署失败：$($_.Exception.Message)" -ForegroundColor Red
    if ($channelLog.Count -gt 0) {
        Write-Host ""
        Write-Host "  已尝试通道：" -ForegroundColor Yellow
        Write-Host (Get-ChannelSummary)
    }
    exit 1
}
finally {
    # 清理临时 git 配置（环境变量随进程退出自然失效，无需还原）
    if ($tmpCfg -and (Test-Path $tmpCfg) -and -not $KeepTmpConfig) {
        Remove-Item -LiteralPath $tmpCfg -Force -ErrorAction SilentlyContinue
    }
}

if (-not $NoWait) {
    Read-Host "按回车键关闭窗口"
}
