# ============================================================
#  MewKonomy 一键部署脚本 — 由 一键部署.bat 双击调用
#
#  流程：pnpm build:public -> push main -> gh-pages
#  网络：固定直连（不再探测通道）
# ============================================================

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "========== [1/4] Network channel ==========" -ForegroundColor Cyan
$sel    = 'Direct connect'
$selSsl = $true
Write-Host "  Selected: direct connect" -ForegroundColor Green

# ---------- 构建 ----------
Write-Host ""
Write-Host "========== [2/4] Build (pnpm build:public) ==========" -ForegroundColor Cyan
& pnpm build:public
if ($LASTEXITCODE -ne 0) { Write-Host "  BUILD FAILED" -ForegroundColor Red; exit 1 }
Write-Host "  Build OK" -ForegroundColor Green

# ---------- push main ----------
Write-Host ""
Write-Host "========== [3/4] Push main ==========" -ForegroundColor Cyan
$base = @('-c','http.proxy=','-c','https.proxy=')
& git @base push origin main 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "  PUSH main FAILED" -ForegroundColor Red; exit 1 }
Write-Host "  Push main OK" -ForegroundColor Green

# ---------- push gh-pages ----------
Write-Host ""
Write-Host "========== [4/4] Push gh-pages ==========" -ForegroundColor Cyan
$tmp = Join-Path $env:TEMP ("mewkonomy-ghpages-" + [guid]::NewGuid().ToString('N') + ".cfg")
git config --file $tmp http.proxy  ''
git config --file $tmp https.proxy ''
git config --file $tmp http.sslVerify  $selSsl
git config --file $tmp https.sslVerify $selSsl
git config --file $tmp credential.helper store
$gName  = & git config --global --get user.name  2>$null
$gEmail = & git config --global --get user.email 2>$null
if ($gName)  { git config --file $tmp user.name  $gName  }
if ($gEmail) { git config --file $tmp user.email $gEmail }
$env:GIT_CONFIG_GLOBAL   = $tmp
$env:GIT_CONFIG_NOSYSTEM = '1'
& npx --yes gh-pages -d dist -b gh-pages --repo https://github.com/Forever985/mewkonomy 2>&1 | Out-Host
$ghExit = $LASTEXITCODE
Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
if ($ghExit -ne 0) { Write-Host "  PUSH gh-pages FAILED" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "========== DEPLOY DONE ==========" -ForegroundColor Green
Write-Host "  Page: https://forever985.github.io/mewkonomy/" -ForegroundColor Green
exit 0