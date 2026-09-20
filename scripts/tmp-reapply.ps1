param([string]$Root = 'D:\milkonomy\milkonomy-main')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $Root
$utf8 = New-Object Text.UTF8Encoding($false)

function Apply([string]$path, [string]$old, [string]$new, [string]$label) {
    $full = Join-Path $Root $path
    if (-not (Test-Path -LiteralPath $full)) { Write-Host "  [SKIP ] $label (file missing)"; return }
    $t = [IO.File]::ReadAllText($full, [Text.Encoding]::UTF8)
    if ($t.Contains($new.Substring(0, [Math]::Min(40, $new.Length)))) { Write-Host "  [DONE ] $label (already applied)"; return }
    if (-not $t.Contains($old)) { Write-Host "  [FAIL ] $label (anchor not found)"; return }
    $t = $t.Replace($old, $new)
    [IO.File]::WriteAllText($full, $t, $utf8)
    Write-Host "  [OK   ] $label"
}

Write-Host "===== A) vite.config.ts: 放宽测试超时 ====="
Apply 'vite.config.ts' @'
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

Write-Host "`n===== B) locales/lang/en.ts: 排序优先级 + 练级页词条 ====="
Apply 'src/locales/lang/en.ts' @'
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

Apply 'src/locales/lang/en.ts' @'
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
  "总成本": "Total Cost",
  "售价": "Selling Price",
  "#强化练级说明": "Level up by enhancing: plans are ranked by Cost per EXP (lower is better). Total EXP = attempts x EXP per enhance; Net Cost = total material cost - sale value of the enhanced gear. A negative net cost means the gear sells for more than the whole investment, so you gain EXP and profit at the same time; those plans are highlighted and listed first.",
'@ 'leveling keys'

Write-Host "`n===== C) router/routes/private.ts: 强化分组加练级页 ====="
Apply 'src/router/routes/private.ts' @'
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
'@ 'enhanceexp route'

Write-Host "`n===== D) pinia/stores/enhancer.ts: 件数 + 成功期望 ====="
Apply 'src/pinia/stores/enhancer.ts' @'
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

Write-Host "`n===== E) pages/enhancer/index.vue: 默认值 + 计算 + 控件 + 列 ====="
Apply 'src/pages/enhancer/index.vue' @'
const defaultConfig = {
  hourlyRate: 5000000,
  taxRate: 5,
  enhanceLevel: 10
}
'@ @'
const defaultConfig = {
  hourlyRate: 5000000,
  taxRate: 5,
  enhanceLevel: 10,
  pieceCount: 1,
  expectationFactor: 1
}
'@ 'defaultConfig'

$oldCalc = @'
    const { actions, protects } = calc.enhancelate()
    const matCost
        = enhancementCosts.value.reduce((acc, item) => {
          const price = typeof item.price === "number" ? item.price : item.originPrice
          return acc + (price * item.count * actions)
        }, 0) + (typeof currentItem.value.protection?.price === "number"
          ? currentItem.value.protection!.price
          : currentItem.value.protection!.originPrice) * protects

    const totalCostNoHourly = matCost + (typeof currentItem.value?.price === "number"
      ? currentItem.value!.price
      : currentItem.value!.originPrice)
    let totalCost = totalCostNoHourly + (enhancerStore.hourlyRate ?? defaultConfig.hourlyRate) * (actions / calc.actionsPH)
    totalCost *= (1 + (enhancerStore.taxRate ?? defaultConfig.taxRate) / 100)

    const productPrice = typeof currentItem.value.productPrice === "number"
      ? currentItem.value.productPrice
      : getPriceOf(currentItem.value.hrid, enhanceLevel).bid

    const hourlyCost = (productPrice * 0.98 - totalCostNoHourly) / actions * calc.actionsPH
    const profitPP = productPrice * 0.98 - totalCostNoHourly

    const seconds = actions / calc.actionsPH * 3600
    result.push({
      actions,
      actionsFormatted: Format.number(actions, 2),
      protects,
      protectsFormatted: Format.number(protects, 2),
      protectLevel: i,
      time: Format.costTime(seconds * 1000000000),
      expPHFormat: Format.money(calc.exp * calc.actionsPH),
      matCost: Format.money(matCost),
      totalCostFormatted: Format.money(totalCost),
      totalCost,
      totalCostNoHourly,
      matCostPH: `${Format.money(matCost / seconds * 3600)} / h`,
      hourlyCost,
      hourlyCostFormatted: Format.money(hourlyCost),
      profitPPFormatted: Format.money(profitPP),
      profitRateFormatted: Format.percent(profitPP / totalCostNoHourly)
    })
'@
$newCalc = @'
    const { actions, protects } = calc.enhancelate()
    // 「几件装备」：材料与本体成本按件数线性放大（每件都独立从 0 强化到目标等级）
    const pieceCount = Math.max(1, enhancerStore.config.pieceCount ?? defaultConfig.pieceCount)
    // 「成功期望」：1 = 马尔科夫链算出的平均期望次数；1.2 = 假设 1.2 倍期望才成功，
    // 于是材料与保护消耗整体上浮 20%（只放大消耗，不改成功率与产出）
    const expectationFactor = Math.max(0.1, enhancerStore.config.expectationFactor ?? defaultConfig.expectationFactor)
    // 实际会消耗的强化次数与保护次数（含期望系数与件数）
    const scaledActions = actions * expectationFactor * pieceCount
    const scaledProtects = protects * expectationFactor * pieceCount

    const protectionPrice = typeof currentItem.value.protection?.price === "number"
      ? currentItem.value.protection!.price
      : currentItem.value.protection!.originPrice

    const matCost
        = enhancementCosts.value.reduce((acc, item) => {
          const price = typeof item.price === "number" ? item.price : item.originPrice
          return acc + (price * item.count * scaledActions)
        }, 0) + protectionPrice * scaledProtects

    const piecePrice = typeof currentItem.value?.price === "number"
      ? currentItem.value!.price
      : currentItem.value!.originPrice

    // 单件口径（不受件数影响，用于「单个利润」）
    const matCostPerPiece = matCost / pieceCount
    const totalCostNoHourlyPerPiece = matCostPerPiece + piecePrice
    // 全批口径：本体（买/做 N 件）+ 材料
    const totalCostNoHourly = totalCostNoHourlyPerPiece * pieceCount
    const hourlyTotal = (enhancerStore.hourlyRate ?? defaultConfig.hourlyRate) * (scaledActions / calc.actionsPH)
    let totalCost = totalCostNoHourly + hourlyTotal
    totalCost *= (1 + (enhancerStore.taxRate ?? defaultConfig.taxRate) / 100)

    // 产出：每件都强化成功后售出，件数线性放大
    const productPrice = typeof currentItem.value.productPrice === "number"
      ? currentItem.value.productPrice
      : getPriceOf(currentItem.value.hrid, enhanceLevel).bid

    const incomeTotal = productPrice * 0.98 * pieceCount
    const hourlyCost = (incomeTotal - totalCostNoHourly) / scaledActions * calc.actionsPH
    const profitPP = productPrice * 0.98 - totalCostNoHourlyPerPiece
    const profitTotal = incomeTotal - totalCostNoHourly

    const seconds = scaledActions / calc.actionsPH * 3600
    result.push({
      actions,
      scaledActions,
      scaledActionsFormatted: Format.number(scaledActions, 2),
      actionsFormatted: Format.number(actions, 2),
      protects,
      scaledProtects,
      protectsFormatted: Format.number(scaledProtects, 2),
      protectLevel: i,
      time: Format.costTime(seconds * 1000000000),
      expPHFormat: Format.money(calc.exp * calc.actionsPH),
      matCost: Format.money(matCost),
      matCostPerPiece,
      matCostPerPieceFormatted: Format.money(matCostPerPiece),
      totalCostFormatted: Format.money(totalCost),
      totalCost,
      totalCostNoHourly,
      totalCostNoHourlyFormatted: Format.money(totalCostNoHourly),
      gearCostFormatted: Format.money(piecePrice * pieceCount),
      matCostPH: `${Format.money(matCost / seconds * 3600)} / h`,
      hourlyCost,
      hourlyCostFormatted: Format.money(hourlyCost),
      profitPPFormatted: Format.money(profitPP),
      profitTotal,
      profitTotalFormatted: Format.money(profitTotal),
      profitRateFormatted: Format.percent(profitPP / totalCostNoHourlyPerPiece)
    })
'@
Apply 'src/pages/enhancer/index.vue' $oldCalc $newCalc 'results computed'

Apply 'src/pages/enhancer/index.vue' @'
    actions: number
    actionsFormatted: string
    protects: number
'@ @'
    actions: number
    actionsFormatted: string
    scaledActions: number
    scaledActionsFormatted: string
    protects: number
'@ 'ResultItem interface'

Apply 'src/pages/enhancer/index.vue' 'Format.number(item.count * result.actions)' 'Format.number(item.count * result.scaledActions)' 'columnWidths scaledActions'

Apply 'src/pages/enhancer/index.vue' @'
          </ElTable>
        </el-card>
      </el-col>
    </el-row>
'@ @'
          </ElTable>
          <el-divider class="mt-2 mb-2" />
          <ElTable :data="[{}]" :show-header="false" style="--el-table-border-color:none" :cell-style="{ padding: '4px 0' }">
            <el-table-column>
              <template #default>
                {{ t('件数') }}:
              </template>
            </el-table-column>
            <el-table-column />
            <el-table-column min-width="120" align="center">
              <template #default>
                <el-input-number
                  v-model="enhancerStore.config.pieceCount"
                  :min="1"
                  :max="9999"
                  :step="1"
                  :placeholder="String(defaultConfig.pieceCount)"
                  controls-position="right"
                  class="max-w-100%"
                />
              </template>
            </el-table-column>
          </ElTable>
          <ElTable :data="[{}]" :show-header="false" style="--el-table-border-color:none" :cell-style="{ padding: '4px 0' }">
            <el-table-column>
              <template #default>
                {{ t('成功期望') }}:
              </template>
            </el-table-column>
            <el-table-column />
            <el-table-column min-width="120" align="center">
              <template #default>
                <el-input-number
                  v-model="enhancerStore.config.expectationFactor"
                  :min="0.1"
                  :max="10"
                  :step="0.1"
                  :precision="2"
                  :placeholder="String(defaultConfig.expectationFactor)"
                  controls-position="right"
                  class="max-w-100%"
                />
              </template>
            </el-table-column>
          </ElTable>
          <div class="text-12px color-gray-500 mt-1 leading-4">
            {{ t('#件数与期望说明') }}
          </div>
        </el-card>
      </el-col>
    </el-row>
'@ 'piece/expectation inputs'

Apply 'src/pages/enhancer/index.vue' @'
        {{ Format.money(item.count * row.actions) }}
'@ @'
        {{ Format.money(item.count * row.scaledActions) }}
'@ 'material column scaled'

Apply 'src/pages/enhancer/index.vue' @'
        <el-table-column prop="actionsFormatted" :label="t('次数')" :min-width="columnWidths.actionsFormatted" header-align="center" align="right" />
        <el-table-column prop="time" :label="t('时间')" :min-width="columnWidths.time" align="right" />
'@ @'
        <el-table-column prop="actionsFormatted" :label="t('次数')" :min-width="columnWidths.actionsFormatted" header-align="center" align="right" />
        <el-table-column prop="scaledActionsFormatted" :label="t('实际次数')" :min-width="100" header-align="center" align="right" />
        <el-table-column prop="time" :label="t('时间')" :min-width="columnWidths.time" align="right" />
'@ 'actual actions column'

Apply 'src/pages/enhancer/index.vue' @'
        <el-table-column prop="matCost" :label="t('材料费用')" :min-width="100" header-align="center" align="right" />
        <el-table-column prop="matCostPH" :label="t('损耗')" :min-width="120" header-align="center" align="right" />
'@ @'
        <el-table-column prop="matCost" :label="t('材料费用')" :min-width="100" header-align="center" align="right" />
        <el-table-column v-if="gearManufacture" prop="matCostPerPieceFormatted" :label="t('材料 / 件')" :min-width="100" header-align="center" align="right" />
        <el-table-column prop="matCostPH" :label="t('损耗')" :min-width="120" header-align="center" align="right" />
'@ 'material per piece column'

Apply 'src/pages/enhancer/index.vue' @'
        <el-table-column v-else prop="totalCostFormatted" :label="t('总费用')" :min-width="120" header-align="center" align="right" />
'@ @'
        <el-table-column prop="totalCostNoHourlyFormatted" :label="t('全批总成本')" :min-width="120" header-align="center" align="right" />
        <el-table-column prop="profitTotalFormatted" :label="t('全批利润')" :min-width="120" header-align="center" align="right" />
        <el-table-column v-if="enhancerStore.config.tab !== '1' " prop="totalCostFormatted" :label="t('总费用')" :min-width="120" header-align="center" align="right" />
'@ 'batch columns'

Write-Host "`n===== F) locales/lang/en.ts: 件数/期望词条 ====="
Apply 'src/locales/lang/en.ts' @'
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

Write-Host "`n===== G) constants/sort-fields.ts: 补练级字段 ====="
$sf = Join-Path $Root 'src/common/constants/sort-fields.ts'
if (Test-Path -LiteralPath $sf) {
    $t = [IO.File]::ReadAllText($sf, [Text.Encoding]::UTF8)
    if ($t.Contains('ENHANCEEXP_SORT_FIELDS')) { Write-Host "  [DONE ] ENHANCEEXP_SORT_FIELDS (already present)" }
    else {
        $t = $t.TrimEnd() + @'


/**
 * 强化练级性价比：核心指标是「每次经验成本」（越小越好；净成本为负时也是负数，升序即赚钱方案优先）。
 * 「是否赚钱」用数值化的 `result.profitableRank`（1/0）而非布尔 `result.profitable`——
 * `handleSort` 的 compareValues 把布尔当缺失值，直接用布尔的排序是空操作。
 */
export const ENHANCEEXP_SORT_FIELDS: SortField[] = [
  { prop: "result.costPerExp", label: "每次经验成本" },
  { prop: "result.profitableRank", label: "是否赚钱" },
  { prop: "result.exp", label: "总经验" },
  { prop: "result.netCost", label: "净成本" },
  { prop: "result.saleValue", label: "售价" },
  { prop: "result.enhanceLevel", label: "目标等级" },
  { prop: "actionLevel", label: "要求等级" },
  { prop: "result.actions", label: "次数" }
]
'@
        [IO.File]::WriteAllText($sf, $t, $utf8)
        Write-Host "  [OK   ] ENHANCEEXP_SORT_FIELDS"
    }
} else { Write-Host "  [SKIP ] sort-fields.ts missing" }

Write-Host "`nDone."
