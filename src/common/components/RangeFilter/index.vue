<script lang="ts" setup>
import type { NumericRange, RangeMode } from "@/common/apis/marketvolume/filters"

/**
 * 数值区间筛选控件（单个指标一行）。
 *
 * 背景：市场监控页需要对若干数值列做「不低于 / 不高于 / 在两者之间」的筛选，
 * 每个指标的控件形态完全相同，逐处手写会重复 5 遍 —— 与 `PagerFooter` 收敛
 * 12 处分页块、`SearchPanel` 收敛 11 个检索表单是同一类重复。
 *
 * 用法：
 *   <RangeFilter v-model="ranges.volume" :label="t('成交量')" unit="件" />
 *
 * 关键语义（由 `filters.ts` 的 `matchesRange` 实现，这里只负责采集输入）：
 *  - `≥` / `≤` **含端点**（写成符号而不是"高于/低于"，避免端点歧义）；
 *  - `区间` 两端都含；只填一边时退化为 `≥` 或 `≤`；
 *  - 阈值留空 ⇒ 该条件**不生效**（列表不会突然变空）。
 */
const props = withDefaults(defineProps<{
  modelValue: NumericRange
  /** 已翻译的指标名 */
  label: string
  /** 单位后缀（如 `%`、`件`） */
  unit?: string
  step?: number
  /** 小数位（涨跌幅这类用 0.1，成交量/成交额/价格用 0） */
  precision?: number
  /** 允许的最小输入值（价格、成交量这类不应为负） */
  min?: number
}>(), { unit: "", step: 1, precision: 0, min: undefined })

const emit = defineEmits<{ "update:modelValue": [value: NumericRange] }>()

const { t } = useI18n()

const MODE_OPTIONS = computed<{ value: RangeMode, label: string }[]>(() => [
  { value: "any", label: t("不限") },
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" },
  { value: "between", label: t("区间") }
])

/** 不直接改 props 对象，统一 emit 一份新对象 */
function patch(part: Partial<NumericRange>) {
  emit("update:modelValue", { ...props.modelValue, ...part })
}

const mode = computed<RangeMode>({
  get: () => props.modelValue.mode,
  set: value => patch({ mode: value })
})

/** el-input-number 清空时会给 null，这里统一收敛成 undefined（= 未填） */
function toNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

const minValue = computed<number | undefined>({
  get: () => props.modelValue.min,
  set: value => patch({ min: toNumber(value) })
})

const maxValue = computed<number | undefined>({
  get: () => props.modelValue.max,
  set: value => patch({ max: toNumber(value) })
})

/** 只有一个阈值输入框的模式 */
const singleInput = computed(() => props.modelValue.mode === "gte" || props.modelValue.mode === "lte")
</script>

<template>
  <div class="range-filter">
    <span class="range-filter-label">{{ label }}</span>
    <el-select v-model="mode" size="small" class="range-filter-mode">
      <el-option v-for="m in MODE_OPTIONS" :key="m.value" :label="m.label" :value="m.value" />
    </el-select>
    <el-input-number
      v-if="singleInput || mode === 'between'"
      v-model="minValue"
      size="small"
      class="range-filter-input"
      :step="step"
      :precision="precision"
      :min="min"
      :controls="false"
    />
    <span v-if="mode === 'between'" class="range-filter-sep">~</span>
    <el-input-number
      v-if="mode === 'between'"
      v-model="maxValue"
      size="small"
      class="range-filter-input"
      :step="step"
      :precision="precision"
      :min="min"
      :controls="false"
    />
    <span v-if="unit" class="range-filter-unit">{{ unit }}</span>
  </div>
</template>

<style scoped>
.range-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.range-filter-label {
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
.range-filter-mode {
  width: 92px;
}
.range-filter-input {
  width: 118px;
}
.range-filter-sep {
  color: var(--el-text-color-secondary);
}
.range-filter-unit {
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
</style>
