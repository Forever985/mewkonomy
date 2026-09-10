# ============================================================
#  MewKonomy 一键部署到 GitHub Pages（增强版）
#  用法：
#     powershell -ExecutionPolicy Bypass -File .\deploy.ps1
#  功能：
#     1) 构建 public 版产物  ->  pnpm build:public（输出到 ./dist）
#     2) 提交源码到 main     ->  git commit --no-verify（跳过 husky/lint-staged）
#     3) 推送产物到 gh-pages ->  npx gh-pages -d dist
#  健壮性：
#     - 先探测 GitHub 直连，不可用时自动切换本地代理 127.0.0.1:10808
#     - git 凭据助手优先 wincred（规避 GCM 崩溃）
#     - 每步分步日志，失败即停并给出明确错误提示
# ============================================================
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# ---------- 可调参数 ----------
$ProxyUrl      = 'http://127.0.0.1:10808'
$RemoteRepo    = 'https://github.com/Forever985/mewkonomy.git'
$BranchMain    = 'main'
$BranchPages   = 'gh-pages'
$DistDir       = 'dist'
$ProbeRepo     = 'https://github.com/octocat/Hello-World.git'  # 仅用于探测连通性（公开仓库，无需凭据）
# ------------------------------

function Write-Step([string]$Title) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor DarkCyan
    Write-Host " $Title" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor DarkCyan
}

# 用 git 真实网络栈探测连通性（不走本仓库凭据，公开仓库探测）
# $proxy: '' 表示强制直连；非空则走该代理
function Test-GitHubConnect([string]$proxy) {
    & git -c http.proxy="$proxy" -c http.lowSpeedLimit=1 -c http.lowSpeedTime=15 `
         ls-remote --heads $ProbeRepo 2>$null
    return ($LASTEXITCODE -eq 0)
}

# 凭据助手：优先 wincred（本地生效，不覆盖全局），规避 GCM 崩溃
function Set-GitCredentialHelper {
    & git config --local credential.helper wincred
    if ($LASTEXITCODE -ne 0) { throw "设置 git 凭据助手 wincred 失败" }
    Write-Host "  凭据助手已设为 wincred（本地仓库）" -ForegroundColor Green
}

try {
    # ============ [0/4] 网络与凭据环境 ============
    Write-Step "[0/4] 检测网络与凭据环境"
    Write-Host "  remote: $RemoteRepo"
    Write-Host "  当前分支: $(git branch --show-current)"
    Set-GitCredentialHelper

    $useProxy = $false
    Write-Host "  探测 GitHub 直连 ..." -NoNewline
    if (Test-GitHubConnect '') {
        Write-Host " 可用" -ForegroundColor Green
        Write-Host "  将使用直连推送" -ForegroundColor DarkGray
        $useProxy = $false
    }
    else {
        Write-Host " 不可用"
        Write-Host "  尝试本地代理 $ProxyUrl ..." -NoNewline
        if (Test-GitHubConnect $ProxyUrl) {
            Write-Host " 可用" -ForegroundColor Green
            Write-Host "  将使用代理 $ProxyUrl 推送" -ForegroundColor DarkGray
            $useProxy = $true
        }
        else {
            throw "GitHub 直连与代理 ($ProxyUrl) 均不可达，请检查网络后重试"
        }
    }

    # 将代理选择写入本地 git 配置，保证 git push 与 gh-pages 内部 git 均遵循
    if ($useProxy) {
        & git config --local http.proxy $ProxyUrl
        if ($LASTEXITCODE -ne 0) { throw "写入本地代理配置失败" }
    }
    else {
        & git config --local http.proxy ''   # 空串 = 直连，覆盖全局代理
        if ($LASTEXITCODE -ne 0) { throw "写入直连配置失败" }
    }

    # ============ [1/4] 构建 public 版本 ============
    Write-Step "[1/4] 构建 public 版本 (pnpm build:public)"
    & pnpm build:public
    if ($LASTEXITCODE -ne 0) { throw "pnpm build:public 构建失败，请检查上方报错" }
    if (-not (Test-Path $DistDir)) { throw "构建完成但未找到产物目录：$DistDir" }
    Write-Host "  构建完成，产物目录: $PSScriptRoot\$DistDir" -ForegroundColor Green

    # ============ [2/4] 提交源码到 main ============
    Write-Step "[2/4] 提交源码到 main"
    & git add .
    if ($LASTEXITCODE -ne 0) { throw "git add 失败，请检查文件权限" }
    $staged = (& git diff --cached --name-only | Where-Object { $_ -ne '' }).Count
    Write-Host "  已暂存 $staged 个文件变更" -ForegroundColor DarkGray

    $commitMsg = "deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    & git commit --no-verify -m $commitMsg 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  （无源码变更，跳过提交）" -ForegroundColor DarkGray
    }
    else {
        Write-Host "  已提交: $commitMsg" -ForegroundColor Green
    }

    Write-Host "  推送 main -> origin/$BranchMain ..."
    & git push origin $BranchMain
    if ($LASTEXITCODE -ne 0) { throw "main 推送失败，请检查 GitHub 认证与网络" }
    Write-Host "  main 推送成功" -ForegroundColor Green

    # ============ [3/4] 推送产物到 gh-pages ============
    Write-Step "[3/4] 推送构建产物到 gh-pages"
    Write-Host "  npx gh-pages -d $DistDir -b $BranchPages ..."
    & npx --yes gh-pages -d $DistDir -b $BranchPages
    if ($LASTEXITCODE -ne 0) { throw "gh-pages 推送失败，请检查网络/凭据" }
    Write-Host "  gh-pages 推送成功" -ForegroundColor Green

    # ============ 完成 ============
    Write-Host ""
    Write-Host "  ✔ 部署完成！" -ForegroundColor Green
    Write-Host "    页面地址: https://forever985.github.io/mewkonomy/" -ForegroundColor Green
    Write-Host "    （若首次部署，请确认 GitHub 仓库 Settings -> Pages 已选 $BranchPages 分支）" -ForegroundColor DarkYellow
}
catch {
    Write-Host ""
    Write-Host "  ✘ 部署失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    # 恢复本地代理配置，避免影响用户日常使用（凭据 wincred 保留）
    & git config --local --unset-all http.proxy 2>$null
}

Write-Host ""
Read-Host "按回车键关闭窗口"
