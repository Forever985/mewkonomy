# ============================================================
#  MewKonomy 一键部署到 GitHub Pages（手动同步版）
#  用法：双击运行，或在项目目录执行  powershell -File deploy.ps1
#  功能：构建 public 版 -> 提交源码到 main -> 推送构建产物到 gh-pages
# ============================================================
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "== [1/3] 构建 public 版本 ==" -ForegroundColor Cyan
pnpm build:public
if ($LASTEXITCODE -ne 0) { throw "构建失败，请检查上方报错"; exit 1 }

Write-Host ""
Write-Host "== [2/3] 提交并推送源码到 main ==" -ForegroundColor Cyan
git add .
$commitMsg = "deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
git commit --no-verify -m $commitMsg 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "（无源码变更，跳过提交）" -ForegroundColor DarkGray
}
git push origin main
if ($LASTEXITCODE -ne 0) { throw "main 推送失败，请检查 GitHub 认证"; exit 1 }

Write-Host ""
Write-Host "== [3/3] 推送构建产物到 gh-pages 分支 ==" -ForegroundColor Cyan
npx gh-pages -d dist
if ($LASTEXITCODE -ne 0) { throw "gh-pages 推送失败"; exit 1 }

Write-Host ""
Write-Host "✔ 部署完成！" -ForegroundColor Green
Write-Host "   页面地址: https://forever985.github.io/mewkonomy/" -ForegroundColor Green
Write-Host "   （首次请确认 GitHub 仓库 Settings -> Pages 已选 gh-pages 分支）" -ForegroundColor DarkYellow
Write-Host ""
Read-Host "按回车键关闭窗口"
