<script setup lang="ts">
import type Calculator from "@/calculator"
import type { SolveCandidate } from "@/common/utils/price-solve"
import * as Format from "@@/utils/format"
import { getItemDetailOf, getPriceOf } from "@/common/apis/game"
import { primaryCandidateOf, solveCandidatesOf, solvePriceForTarget } from "@/common/utils/price-solve"
import { PRICE_STATUS_LIST, PriceStatus } from "@/pinia/stores/game"
import { QuestionFilled } from "@element-plus/icons-vue"

/**
 * 「目标时薪 → 临界单价」反解面板。
 *
 * 语义（用户原话）：想要实现多少时薪，则**最多以多少钱买入**（材料侧），
 * 或**最少要卖多少钱**（成品侧）。默认询价物品是方案的**主要物品**——
 * 也就是你真正会去买的那件东西：分解茶叶时是茶叶、转化宝石时是宝石。
 *
 * 实现上只做两件事：
 * 1. 调 `common/utils/price-solve` 拿到临界单价（那边是纯函数、已单测覆盖）；
 * 2. 把临界价放进「档位」这套既有语汇里——列出该物品各档位的实际价格，
 *    标出哪些档位仍能达标，这样就能直接回答「我能买到哪个档位」。
 */

const props = defineProps<{
  data?: Calculator
}>()

const { t } = useI18n()

/** 可反解的物品：材料在前、成品在后 */
const candidates = computed(() => (props.data ? solveCandidatesOf(props.data) : []))

const selectedKey = ref<string>()
const targetProfitPH = ref<number>()

// 换方案 / 首次拿到方案时，重置为「主要物品 + 当前时薪」
watch(
  () => props.data,
  (data) => {
    if (!data) {
      return
    }
    selectedKey.value = primaryCandidateOf(data)?.key ?? candidates.value[0]?.key
    targetProfitPH.value = Math.round(data.result.profitPH)
  },
  { immediate: true }
)

const candidate = computed<SolveCandidate | undefined>(() =>
  candidates.value.find(c => c.key === selectedKey.value) ?? candidates.value[0]
)

const solveResult = computed(() => {
  const data = props.data
  const cand = candidate.value
  if (!data || !cand || targetProfitPH.value == null) {
    return undefined
  }
  return solvePriceForTarget(data.result.profitPH, cand, targetProfitPH.value)
})

/**
 * 档位对照。
 *
 * 材料侧看**左挂单**三档（你买入要付 ask），成品侧看**右收购**三档（你卖出收 bid）。
 * 每档的价格都由 `getPriceOf` 按该档位口径算出来，和别处显示的价格同源。
 */
const tiers = computed(() => {
  const cand = candidate.value
  const result = solveResult.value
  if (!cand || !result) {
    return []
  }
  const statuses = cand.side === "ingredient"
    ? [PriceStatus.ASK_LOW, PriceStatus.ASK, PriceStatus.ASK_HIGH]
    : [PriceStatus.BID_LOW, PriceStatus.BID, PriceStatus.BID_HIGH]

  return statuses.map((status) => {
    const price = cand.side === "ingredient"
      ? getPriceOf(cand.hrid, cand.level, status, PriceStatus.BID).ask
      : getPriceOf(cand.hrid, cand.level, PriceStatus.ASK, status).bid
    // 材料：实际买价 ≤ 临界价才能达标；成品：实际卖价 ≥ 临界价才能达标
    const ok = price > 0 && (cand.side === "ingredient" ? price <= result.criticalPrice : price >= result.criticalPrice)
    return {
      status,
      label: PRICE_STATUS_LIST.find(o => o.value === status)?.label ?? status,
      price,
      ok,
      diff: cand.side === "ingredient" ? price - result.criticalPrice : result.criticalPrice - price
    }
  })
})

const sideLabel = computed(() => (candidate.value?.side === "ingredient" ? t("最高可买价") : t("最低可卖价")))

function nameOf(hrid: string) {
  return hrid === "/items/coin" ? t("金币") : t(getItemDetailOf(hrid)?.name ?? hrid)
}

const selectedName = computed(() => (candidate.value ? nameOf(candidate.value.hrid) : ""))
</script>

<template>
  <div v-if="data && candidate && solveResult" class="solve-wrapper">
    <div class="solve-header">
      <span class="solve-title">
        {{ t('目标时薪反解') }}
      </span>
      <el-tooltip
        :content="t('利润对每个单价都是线性的，所以能精确反解：给定目标时薪，算出这个物品的临界单价，并告诉你哪些档位仍能达标')"
        placement="top"
      >
        <el-icon class="solve-help">
          <QuestionFilled />
        </el-icon>
      </el-tooltip>
    </div>

    <div class="solve-controls">
      <div class="solve-control">
        <span class="solve-label">{{ t('目标时薪') }}</span>
        <el-input-number
          v-model="targetProfitPH"
          class="solve-number"
          :step="10000"
          controls-position="right"
          size="small"
        />
        <span class="solve-unit">{{ t('金币/小时') }}</span>
      </div>
      <div class="solve-control">
        <span class="solve-label">{{ t('询价物品') }}</span>
        <el-select v-model="selectedKey" size="small" style="width: 240px">
          <el-option
            v-for="c in candidates"
            :key="c.key"
            :value="c.key"
            :label="`${nameOf(c.hrid)}${c.side === 'ingredient' ? '' : ` (${t('成品')})`}`"
          />
        </el-select>
      </div>
      <div class="solve-control solve-control--muted">
        {{ t('当前时薪') }}：{{ Format.money(data.result.profitPH) }}
      </div>
    </div>

    <div class="solve-answer">
      <span class="solve-answer-label">{{ selectedName }} · {{ sideLabel }}</span>
      <span class="solve-answer-value" :class="solveResult.impossible ? 'solve-bad' : 'solve-good'">
        ¥{{ Format.price(solveResult.criticalPrice) }}
      </span>
      <span class="solve-answer-hint">
        {{ t('当前价') }} ¥{{ Format.price(candidate.price) }}
        <template v-if="solveResult.priceGap !== 0">
          · {{ solveResult.priceGap > 0 ? t('还可再高') : t('需要更低') }}
          ¥{{ Format.price(Math.abs(solveResult.priceGap)) }}
        </template>
      </span>
    </div>

    <div v-if="solveResult.impossible" class="solve-warn">
      {{ t('即使这个物品白送，也达不到目标时薪——请降低目标，或换一个方案') }}
    </div>

    <div class="solve-tiers">
      <div class="solve-tiers-title">
        {{ t('档位对照') }}
        <span class="solve-tiers-note">{{ candidate.side === 'ingredient' ? t('左挂单（买入口径）') : t('右收购（卖出口径）') }}</span>
      </div>
      <div class="solve-tier-row">
        <span class="solve-tier-label">{{ candidate.side === 'ingredient' ? t('档位') : t('档位') }}</span>
        <span v-for="row in tiers" :key="row.status" class="solve-tier" :class="row.ok ? 'solve-tier--ok' : 'solve-tier--bad'">
          <span class="solve-tier-name">{{ row.label }}</span>
          <span class="solve-tier-price">¥{{ Format.price(row.price) }}</span>
          <span class="solve-tier-verdict">
            {{ row.ok ? t('达标') : `✗ ${Format.price(Math.abs(row.diff))}` }}
          </span>
        </span>
      </div>
      <div class="solve-tiers-hint">
        {{ t('档位价由当前市场挂单推算（一档约 0.37%，强化品 5 倍），用于把临界价换算成你熟悉的口径') }}
      </div>
    </div>

    <div v-if="candidate.priceSource && candidate.priceSource !== 'market'" class="solve-warn solve-warn--soft">
      {{ t('注：该物品当前采用的是非市场价（自产估值/商店价），反解结果仅供参考') }}
    </div>
  </div>
</template>

<style lang="scss" scoped>
.solve-wrapper {
  margin: 12px 20px 0;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
}
.solve-header {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
  .solve-title {
    font-weight: 600;
    font-size: 14px;
  }
  .solve-help {
    margin-left: 6px;
    color: var(--el-text-color-secondary);
    cursor: help;
  }
}
.solve-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  margin-bottom: 10px;
  .solve-control {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .solve-label {
    color: var(--el-text-color-regular);
    font-size: 13px;
  }
  .solve-unit,
  .solve-control--muted {
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
  .solve-number {
    width: 150px;
  }
}
.solve-answer {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  .solve-answer-label {
    color: var(--el-text-color-regular);
    font-size: 13px;
  }
  .solve-answer-value {
    font-size: 20px;
    font-weight: 700;
  }
  .solve-good {
    color: var(--el-color-success);
  }
  .solve-bad {
    color: var(--el-color-danger);
  }
  .solve-answer-hint {
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
}
.solve-warn {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-color-danger);
  &--soft {
    color: var(--el-color-warning);
  }
}
.solve-tiers {
  margin-top: 12px;
  .solve-tiers-title {
    font-size: 13px;
    color: var(--el-text-color-regular);
    margin-bottom: 6px;
  }
  .solve-tiers-note {
    margin-left: 8px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
  .solve-tier-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .solve-tier-label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
  .solve-tier {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 12px;
    border: 1px solid transparent;
    &--ok {
      background: var(--el-color-success-light-9);
      border-color: var(--el-color-success-light-5);
    }
    &--bad {
      background: var(--el-fill-color);
      color: var(--el-text-color-secondary);
    }
    .solve-tier-name {
      font-weight: 600;
    }
  }
  .solve-tiers-hint {
    margin-top: 6px;
    font-size: 11px;
    color: var(--el-text-color-placeholder);
  }
}
</style>
