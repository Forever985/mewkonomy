param([string]$Root = 'D:\milkonomy\milkonomy-main')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $Root
$utf8 = New-Object Text.UTF8Encoding($false)

function Read-Norm([string]$p) { return ([IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)) -replace "`r`n", "`n" }
function Write-Norm([string]$p, [string]$t) { [IO.File]::WriteAllText($p, ($t -replace "`r`n", "`n"), $utf8) }

function Rep([string]$path, [string]$old, [string]$new, [string]$label) {
    $full = Join-Path $Root $path
    if (-not (Test-Path -LiteralPath $full)) { Write-Host "  [SKIP] $label"; return }
    $t = Read-Norm $full
    $oldN = $old -replace "`r`n", "`n"
    $newN = $new -replace "`r`n", "`n"
    if ($t.Contains($newN)) { Write-Host "  [DONE] $label"; return }
    if (-not $t.Contains($oldN)) { Write-Host "  [MISS] $label  <-- anchor not found"; return }
    $n = ([regex]::Matches($t, [regex]::Escape($oldN))).Count
    if ($n -ne 1) { Write-Host "  [MISS] $label  <-- anchor matches $n times"; return }
    Write-Norm $full ($t.Replace($oldN, $newN))
    Write-Host "  [OK  ] $label"
}

Write-Host "===== 1) vite.config.ts ====="
Rep 'vite.config.ts' @'
      environment: "happy-dom",
      server: {
'@ @'
      environment: "happy-dom",
      // 首次 import 会连带加载 game store + 全量 data.json（3.9MB）并重建游戏索引，
      // 并发跑时 5s 默认超时会误报失败。统一放宽，不掩盖真正的卡死。
      testTimeout: 60000,
      hookTimeout: 60000,
      server: {
'@ 'testTimeout/hookTimeout'

Write-Host "===== 2) router: enhanceexp 路由 ====="
Rep 'src/router/routes/private.ts' @'
      {
        path: "enhancest",
        component: () => import("@/pages/enhancest/index.vue"),
        name: "Enhancest",
        meta: {
          title: t("超级强化计算"),
          affix: false,
          elIcon: "MagicStick"
        }
      }
    ]
'@ @'
      {
        path: "enhancest",
        component: () => import("@/pages/enhancest/index.vue"),
        name: "Enhancest",
        meta: {
          title: t("超级强化计算"),
          affix: false,
          elIcon: "MagicStick"
        }
      },
      {
        path: "enhanceexp",
        component: () => import("@/pages/enhanceexp/index.vue"),
        name: "Enhanceexp",
        meta: {
          title: t("强化练级"),
          affix: false,
          elIcon: "TrendCharts"
        }
      }
    ]
'@ 'enhanceexp route'

Write-Host "===== 3) enhancer store: 件数 + 成功期望 ====="
Rep 'src/pinia/stores/enhancer.ts' @'
  hrid?: string
  tab?: string
}
'@ @'
  hrid?: string
  tab?: string
  /** 本次要强化的同种装备件数（材料与本体按件数汇总） */
  pieceCount?: number
  /**
   * 期望成功系数：`1` = 按马尔科夫链算出的「平均期望次数」；
   * `1.2` = 假设自己在 1.2 倍期望前后才成功，材料与保护消耗整体上浮 20%。
   */
  expectationFactor?: number
}
'@ 'pieceCount/expectationFactor'

Write-Host "===== 4) en.ts: 排序优先级 + 练级 + 件数词条 ====="
Rep 'src/locales/lang/en.ts' @'
  "初始等级从": "Initial Level from",
'@ @'
  "初始等级从": "Initial Level from",

  // 排序优先级
  "排序优先级": "Sort Priority",
  "第一优先级用于分组，其余优先级在同一组内继续排序": "The first priority groups results; the remaining priorities sort within each group.",
  "添加优先级": "Add Priority",
  "恢复默认排序": "Reset to Default",
  "默认排序": "Default Sort",
  "优先": "then",
  "先按": "Group by",
  "分组": "",
  "组内再按": "then sort within group by",
  "升序": "Asc",
  "降序": "Desc",
  "利润率（按显示精度分组）": "Profit Rate (group by shown precision)",
  "目标等级": "Target Level",
'@ 'sort-priority keys'

Rep 'src/locales/lang/en.ts' @'
  "单个利润": "Single Profit",
'@ @'
  "单个利润": "Single Profit",
  "件数": "Pieces",
  "成功期望": "Success Expectation",
  "实际次数": "Actual Actions",
  "材料 / 件": "Material / Piece",
  "全批总成本": "Batch Total Cost",
  "全批利润": "Batch Profit",
  "#件数与期望说明": "Pieces: enhance this many identical items (materials & gear cost scale with the count). Success Expectation: 1 = the average expected attempts from the Markov chain; 1.2 means you assume you finish at 1.2x the expected attempts, so materials and protections are scaled up by 20%.",
'@ 'pieces/expectation keys'

Rep 'src/locales/lang/en.ts' @'
  "AI 上下文": "AI Context",
'@ @'
  "AI 上下文": "AI Context",

  // Enhance Leveling (强化练级性价比)
  "强化练级": "Enhance Leveling",
  "经验性价比": "EXP Value",
  "每次经验成本": "Cost / EXP",
  "每次经验成本 ≤": "Cost / EXP ≤",
  "总经验": "Total EXP",
  "净成本": "Net Cost",
  "保护档位": "Protect From",
  "不保护": "No Protection",
  "是否赚钱": "Profitable",
  "赚钱": "Profits",
  "纯消耗": "Pure Cost",
  "仅看赚钱方案": "Profitable Only",
  "最少经验": "Min EXP",
  "售价": "Selling Price",
  "#强化练级说明": "Level up by enhancing: plans are ranked by Cost per EXP (lower is better). Total EXP = attempts x EXP per enhance; Net Cost = total material cost - sale value of the enhanced gear. A negative net cost means the gear sells for more than the whole investment, so you gain EXP and profit at the same time; those plans are highlighted and listed first.",
'@ 'leveling keys'

Write-Host "`nDone."
