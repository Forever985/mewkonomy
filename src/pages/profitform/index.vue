<script setup lang="ts">
import type { ProfitFormRow } from "@/common/utils/profit-form"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import { WarningFilled } from "@element-plus/icons-vue"
import { getCalculatorInstance } from "@/calculator/utils"
import { getGameDataApi } from "@/common/apis/game"
import { PROFIT_FORM_ACTIONS, profitFormActionOf, profitFormItemsOf } from "@/common/apis/profitform"
import { computeProfitForm, createFormState } from "@/common/utils/profit-form"
import { profitFormPlanKeyOf, useProfitFormStore } from "@/pinia/stores/profitform"
import * as Format from "@@/utils/format"

/**
 * 填表计算利润。
 *
 * 与其它页面的区别：**这里不读实时市价**（除了作为默认值），
 * 你填进去的就是你的成交价——因为"我买的时候是这个价格，卖的时候是另一个价格"。
 *
 * 关键性质：**什么都不改时，结果与「利润排行」里的数字完全一致**
 * （总成本 = 成本/h、总耗时 = 1 小时、时薪 = 利润/h）。
 * 所以每一格的默认值都是可解释的，改哪格就是覆盖哪格。
 */

const { t } = useI18n()
const formStore = useProfitFormStore()

const ACTIONS = PROFIT_FORM_ACTIONS

const actionKey = ref("decompose")
const itemHrid = ref<string>()
const enhanceLevel = ref(0)
const protectLevel = ref(0)
const catalystRank = ref(0)

const actionDef = computed(() => profitFormActionOf(actionKey.value))

/** 当前动作下可选的物品（按名称排序，交给 el-select 的 filterable 搜索） */
const itemOptions = computed(() => {
  const gd = getGameDataApi()
  return profitFormItemsOf(actionKey.value)
    .map(i => ({ hrid: i.hrid, name: t(gd.itemDetailMap[i.hrid]?.name ?? i.hrid) }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

/** 当前方案（构造失败或不可用则为 undefined） */
const calculator = computed<{ calc: any, error?: string } | undefined>(() => {
  const def = actionDef.value
  const hrid = itemHrid.value
  if (!hrid) {
    return undefined
  }
  try {
    const config: any = { hrid, className: def.className }
    const action = def.actionOf ? def.actionOf({ hrid }) : def.action
    if (action) {
      config.action = action
    }
    if (def.needEnhanceLevel) {
      config.enhanceLevel = enhanceLevel.value
    }
    // 强化计算器的 available 要求 protectLevel ≤ 目标等级，不传会直接判定不可用
    if (def.needProtectLevel) {
      config.protectLevel = protectLevel.value
    }
    if (def.needCatalyst && catalystRank.value) {
      config.catalystRank = catalystRank.value
    }
    const calc = getCalculatorInstance(config)
    if (!calc.available) {
      return { calc, error: t("该物品不支持这个动作，请换一个物品") }
    }
    return { calc: calc.run() }
  } catch {
    // 构造失败（配置不合法）时当作"没有方案"，由页面提示先选动作与物品
    return undefined
  }
})

// ── 表单状态：默认值来自计算器，你改过的值来自 localStorage ──────────────
const rows = ref<ProfitFormRow[]>([])
const actions = ref(0)
const timeCostS = ref(0)

const planKey = computed(() => (calculator.value?.calc ? profitFormPlanKeyOf(calculator.value.calc) : ""))

/** 用计算器重建默认值，并把手填覆盖值叠上去 */
function rebuild() {
  const calc = calculator.value?.calc
  if (!calc) {
    rows.value = []
    actions.value = 0
    timeCostS.value = 0
    return
  }
  const base = createFormState(calc)
  const saved = formStore.getOf(profitFormPlanKeyOf(calc))

  rows.value = base.rows.map(r => ({
    ...r,
    price: saved.prices[r.key] ?? r.price,
    perActionCount: saved.counts[r.key] ?? r.perActionCount
  }))
  actions.value = saved.actions ?? base.actions
  timeCostS.value = (saved.timeCostPerAction ?? base.timeCostPerAction) / 1e9
}

// 换动作/物品/参数 → 重建（并重新读取该方案存过的填法）
watch([actionKey, itemHrid, enhanceLevel, protectLevel, catalystRank], rebuild, { immediate: true })
// 换动作时：清空物品 + 把参数恢复成该动作的最小可用默认值
watch(actionKey, () => {
  itemHrid.value = undefined
  const def = profitFormActionOf(actionKey.value)
  enhanceLevel.value = def.enhanceLevelDefault ?? 0
  protectLevel.value = def.enhanceLevelDefault ?? 0
  catalystRank.value = 0
})

const result = computed(() => computeProfitForm({
  rows: rows.value,
  actions: actions.value,
  timeCostPerAction: timeCostS.value * 1e9
}))

/** 只把「与默认值不同」的格子存下来 —— 这样配方变化时不会存下过期数值 */
function persist() {
  const calc = calculator.value?.calc
  if (!calc) {
    return
  }
  const base = createFormState(calc)
  const baseByKey = new Map(base.rows.map(r => [r.key, r]))

  const prices: Record<string, number> = {}
  const counts: Record<string, number> = {}
  for (const row of rows.value) {
    const b = baseByKey.get(row.key)
    if (!b) {
      continue
    }
    if (row.price !== b.price) {
      prices[row.key] = row.price
    }
    if (row.perActionCount !== b.perActionCount) {
      counts[row.key] = row.perActionCount
    }
  }

  formStore.saveOf(profitFormPlanKeyOf(calc), {
    prices,
    counts,
    actions: Math.abs(actions.value - base.actions) > 1e-9 ? actions.value : undefined,
    timeCostPerAction: Math.abs(timeCostS.value * 1e9 - base.timeCostPerAction) > 1e-6
      ? timeCostS.value * 1e9
      : undefined
  })
}

let saveTimer: any
function persistDebounced() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(persist, 300)
}

function resetForm() {
  const calc = calculator.value?.calc
  if (!calc) {
    return
  }
  formStore.clearOf(profitFormPlanKeyOf(calc))
  rebuild()
}

const savedHint = computed(() => {
  const key = planKey.value
  return !!key && formStore.hasOverride(key)
})

function nameOf(hrid: string) {
  return hrid === "/items/coin" ? t("金币") : t(getGameDataApi().itemDetailMap[hrid]?.name ?? hrid)
}

/** 表格小计：材料进成本、成品进收入（金币不课税） */
function subtotalOf(row: ProfitFormRow) {
  const rate = row.side === "ingredient" ? -1 : (row.hrid === "/items/coin" ? 1 : 0.96)
  return rate * row.perActionCount * actions.value * row.price
}
</script>

<template>
  <div class="app-container">
    <h4>{{ t('填表计算利润') }}</h4>
    <div class="page-hint">
      {{ t('这里不读实时市价——除了默认值。把你这笔交易的真实买价/卖价填进去即可。默认值与「利润排行」完全一致（总耗时 = 1 小时），改哪一格就是覆盖哪一格。填过的数字会按方案保存。') }}
    </div>

    <el-card class="solve-card">
      <div class="picker-row">
        <div class="picker-item">
          <span class="picker-label">{{ t('动作') }}</span>
          <el-select v-model="actionKey" style="width:120px">
            <el-option v-for="a in ACTIONS" :key="a.key" :value="a.key" :label="t(a.label)" />
          </el-select>
        </div>
        <div class="picker-item picker-item--wide">
          <span class="picker-label">{{ t('物品') }}</span>
          <el-select v-model="itemHrid" filterable :placeholder="t('搜索物品')" style="width:280px">
            <el-option v-for="o in itemOptions" :key="o.hrid" :value="o.hrid" :label="o.name" />
          </el-select>
        </div>
        <div v-if="actionDef.needEnhanceLevel" class="picker-item">
          <span class="picker-label">{{ t('目标强化等级') }}</span>
          <el-input-number v-model="enhanceLevel" :min="1" :max="20" size="small" controls-position="right" style="width:110px" />
        </div>
        <div v-if="actionDef.needProtectLevel" class="picker-item">
          <span class="picker-label">{{ t('保护等级') }}</span>
          <el-input-number v-model="protectLevel" :min="0" :max="20" size="small" controls-position="right" style="width:110px" />
        </div>
        <div v-if="actionDef.needCatalyst" class="picker-item">
          <span class="picker-label">{{ t('触媒等级') }}</span>
          <el-input-number v-model="catalystRank" :min="0" :max="2" size="small" controls-position="right" style="width:110px" />
        </div>
        <el-button v-if="savedHint" size="small" type="warning" plain @click="resetForm">
          {{ t('清除本方案的填写') }}
        </el-button>
      </div>

      <el-alert v-if="calculator?.error" :title="calculator.error" type="warning" :closable="false" show-icon />

      <template v-if="rows.length">
        <div class="param-row">
          <div class="picker-item">
            <span class="picker-label">{{ t('动作次数') }}</span>
            <el-input-number v-model="actions" :min="0" :step="10" size="small" controls-position="right" style="width:160px" @change="persistDebounced" />
          </div>
          <div class="picker-item">
            <span class="picker-label">{{ t('单次耗时(秒)') }}</span>
            <el-input-number v-model="timeCostS" :min="0" :step="0.5" :precision="3" size="small" controls-position="right" style="width:140px" @change="persistDebounced" />
          </div>
          <span class="param-hint">
            {{ t('总耗时') }} ≈ {{ Format.costTime(result.totalTimeNs) }}
          </span>
        </div>

        <el-table :data="rows" class="form-table">
          <el-table-column width="54">
            <template #default="{ row }">
              <ItemIcon :hrid="row.hrid" />
            </template>
          </el-table-column>
          <el-table-column :label="t('物品')" min-width="160">
            <template #default="{ row }">
              {{ nameOf(row.hrid) }}
              <span v-if="row.level" class="lvl">+{{ row.level }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('类型')" width="90">
            <template #default="{ row }">
              <el-tag :type="row.side === 'ingredient' ? 'info' : 'success'" size="small">
                {{ row.side === 'ingredient' ? t('买') : t('卖') }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t('单价(可改)')" width="180">
            <template #default="{ row }">
              <el-input-number v-model="row.price" :min="0" :step="10" size="small" controls-position="right" style="width:150px" @change="persistDebounced" />
            </template>
          </el-table-column>
          <el-table-column :label="t('单次数量(可改)')" width="170">
            <template #default="{ row }">
              <el-input-number v-model="row.perActionCount" :min="0" :step="1" :precision="4" size="small" controls-position="right" style="width:140px" @change="persistDebounced" />
            </template>
          </el-table-column>
          <el-table-column :label="t('小计')" min-width="130" align="right">
            <template #default="{ row }">
              <span :class="subtotalOf(row) < 0 ? 'neg' : 'pos'">
                {{ Format.money(subtotalOf(row)) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column width="70" align="center">
            <template #default="{ row }">
              <el-tooltip v-if="row.priceSource && row.priceSource !== 'market'" :content="t('默认值不是真实市价（自产估值/商店价），记得改成你的实际成交价')" placement="top">
                <el-icon><WarningFilled /></el-icon>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>

        <div class="result-row">
          <div class="result-item">
            <span class="result-label">{{ t('总成本') }}</span>
            <span class="result-value">{{ Format.money(result.cost) }}</span>
          </div>
          <div class="result-item">
            <span class="result-label">{{ t('总收入') }}</span>
            <span class="result-value">{{ Format.money(result.income) }}</span>
          </div>
          <div class="result-item">
            <span class="result-label">{{ t('总利润') }}</span>
            <span class="result-value" :class="result.profit >= 0 ? 'pos' : 'neg'">{{ Format.money(result.profit) }}</span>
          </div>
          <div class="result-item">
            <span class="result-label">{{ t('单次利润') }}</span>
            <span class="result-value" :class="result.perActionProfit >= 0 ? 'pos' : 'neg'">{{ Format.money(result.perActionProfit) }}</span>
          </div>
          <div class="result-item">
            <span class="result-label">{{ t('时薪') }}</span>
            <span class="result-value" :class="result.profitPH >= 0 ? 'pos' : 'neg'">{{ Format.money(result.profitPH) }}</span>
          </div>
          <div class="result-item">
            <span class="result-label">{{ t('利润率') }}</span>
            <span class="result-value" :class="(result.profitRate ?? 0) >= 0 ? 'pos' : 'neg'">
              {{ result.profitRate == null ? t('无成本') : Format.percent(result.profitRate) }}
            </span>
          </div>
        </div>

        <div class="action-row">
          <el-button size="small" type="primary" @click="persist">
            {{ t('保存这道表的填法') }}
          </el-button>
          <span v-if="savedHint" class="saved-hint">{{ t('已按方案保存：下次打开这个方案，你填过的价格还在') }}</span>
        </div>
      </template>
      <el-empty v-else-if="!calculator?.error" :description="t('先选动作与物品')" />
    </el-card>
  </div>
</template>

<style lang="scss" scoped>
.page-hint {
  margin: 8px 0 14px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.solve-card {
  max-width: 1200px;
}
.picker-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  margin-bottom: 12px;
}
.picker-item {
  display: flex;
  align-items: center;
  gap: 6px;
  .picker-label {
    color: var(--el-text-color-regular);
    font-size: 13px;
    white-space: nowrap;
  }
}
.param-row {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  align-items: center;
  margin-bottom: 10px;
  .param-hint {
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
}
.form-table {
  margin-bottom: 12px;
  .lvl {
    color: var(--el-text-color-secondary);
  }
}
.result-row {
  display: flex;
  flex-wrap: wrap;
  gap: 28px;
  padding: 10px 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 6px;
  .result-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    .result-label {
      color: var(--el-text-color-secondary);
      font-size: 13px;
    }
    .result-value {
      font-size: 16px;
      font-weight: 600;
    }
  }
}
.pos {
  color: var(--el-color-success);
}
.neg {
  color: var(--el-color-danger);
}
.action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  .saved-hint {
    color: var(--el-color-warning);
    font-size: 12px;
  }
}
</style>
