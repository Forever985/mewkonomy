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
  /**
   * 只显示这些模式（不传 = 全部 9 种）。
   * 检索页用得上 —— 例如「等级」字段给 topN 没意义，但「成交量」给前 N 很自然。
   */
  modes?: RangeMode[]
  /** 输入框宽度（px）。检索页的区间字段比较紧凑，用小一点的默认值 */
  width?: number
}>(), { unit: "", step: 1, precision: 0, min: undefined })

const emit = defineEmits<{
  "update:modelValue": [value: NumericRange]
  /** 任何输入变化都触发（含模式切换），供外层决定何时重新检索 */
  "change": []
}>()

const { t } = useI18n()

/**
 * 模式选项。
 *
 * 刻意**把全部模式都列出来**（用户要求「尽可能多提供，用户可以不用，但不能没有」）：
 * 常用模式排在前面，不常用的（区间之外 / 接近 / 等于 / 前 N / 后 N）仍可一键切到。
 * 符号模式（≥ ≤）直接用符号而非文字，避免"高于/低于"的端点歧义。
 */
const ALL_MODE_OPTIONS: Array<{ value: RangeMode, label: string }> = [
  { value: "any", label: "不限" },
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" },
  { value: "between", label: "区间" },
  { value: "outside", label: "区间之外" },
  { value: "near", label: "接近" },
  { value: "eq", label: "=" },
  { value: "topN", label: "前 N" },
  { value: "bottomN", label: "后 N" }
]

/**
 * 实际显示的模式列表：`props.modes` 的子集（保持调用方给定的顺序），或全部 9 种。
 *
 * 关键：即使字段**不支持**某个模式，也不该把它从数据里悄悄清掉 ——
 * 只过滤显示，让既有条件原样保留（`normalizeSearchData` 也不会动这些键）。
 */
const MODE_OPTIONS = computed<{ value: RangeMode, label: string }[]>(() => {
  const labels = new Map(ALL_MODE_OPTIONS.map(o => [o.value, o.label]))
  if (props.modes?.length) {
    return props.modes
      .filter(m => labels.has(m))
      .map(m => ({ value: m, label: t(labels.get(m)!) }))
  }
  return ALL_MODE_OPTIONS.map(o => ({ value: o.value, label: t(o.label) }))
})

/**
 * 不直接改 props 对象，统一 emit 一份新对象。
 *
 * 切换模式时**清掉不再适用的阈值**：`between` 用双阈值，切到 `gte` 后若留着
 * 原来的 `max`，`between` 的自动对调逻辑会让「≥」的判定被残留值影响。
 * 残留值是那种「界面上看不见、但一直在影响结果」的隐性 bug。
 */
function patch(part: Partial<NumericRange>) {
  emit("update:modelValue", { ...props.modelValue, ...part })
  emit("change")
}

const mode = computed<RangeMode>({
  get: () => props.modelValue.mode,
  set: (value) => {
    // 切换模式时**清掉不再适用的阈值**：`between` 用双阈值，切到 `gte` 后若留着
    // 原来的 `max`，残留值会继续影响判定 —— 那是「界面上看不见、却一直在影响结果」
    // 的隐性 bug。所以这里重建整个对象而不是 patch。
    //
    // ⚠️ 必须 emit("change")：切模式也是一次输入变化，外层要据此重新检索。
    // 这条路径没走 patch()，所以不能指望 patch 里那行 emit。
    emit("update:modelValue", {
      mode: value,
      // 单阈值模式只留 min；双阈值模式两端都留
      ...(["lte", "eq", "topN", "bottomN"].includes(value)
        ? { min: props.modelValue.min, max: undefined, tolerance: undefined }
        : value === "near"
          // near 要保留容差（第二个输入框就是它）
          ? { min: props.modelValue.min, max: undefined, tolerance: props.modelValue.tolerance }
          : { min: props.modelValue.min, max: props.modelValue.max, tolerance: undefined })
    })
    emit("change")
  }
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

const inputWidth = computed(() => props.width ?? 118)

/** 只需要一个输入框的模式 */
const singleInput = computed(() =>
  ["gte", "lte", "near", "eq", "topN", "bottomN"].includes(props.modelValue.mode)
)

/** 需要两个输入框的模式 */
const dualInput = computed(() => props.modelValue.mode === "between" || props.modelValue.mode === "outside")

/** near 的容差（第二个输入框，语义是「± 多少」） */
const toleranceValue = computed<number | undefined>({
  get: () => props.modelValue.tolerance,
  set: value => patch({ tolerance: toNumber(value) })
})
</script>

<template>
  <div class="range-filter" :class="{ 'range-filter-compact': width }">
    <span class="range-filter-label">{{ label }}</span>
    <el-select v-model="mode" size="small" class="range-filter-mode">
      <el-option v-for="m in MODE_OPTIONS" :key="m.value" :label="m.label" :value="m.value" />
    </el-select>
    <el-input-number
      v-if="singleInput || dualInput"
      v-model="minValue"
      size="small"
      class="range-filter-input" :style="{ width: `${inputWidth}px` }"
      :step="mode === 'topN' || mode === 'bottomN' ? 1 : step"
      :precision="mode === 'topN' || mode === 'bottomN' ? 0 : precision"
      :min="mode === 'topN' || mode === 'bottomN' ? 1 : min"
      :controls="false"
    />
    <span v-if="dualInput" class="range-filter-sep">~</span>
    <el-input-number
      v-if="dualInput"
      v-model="maxValue"
      size="small"
      class="range-filter-input" :style="{ width: `${inputWidth}px` }"
      :step="step"
      :precision="precision"
      :min="min"
      :controls="false"
    />
    <template v-if="mode === 'near'">
      <span class="range-filter-sep">±</span>
      <el-input-number
        v-model="toleranceValue"
        size="small"
        class="range-filter-input" :style="{ width: `${inputWidth}px` }"
        :step="step"
        :precision="precision"
        :min="0"
        :controls="false"
      />
    </template>
    <span v-if="mode === 'topN' || mode === 'bottomN'" class="range-filter-unit">{{ t("项") }}</span>
    <span v-else-if="unit" class="range-filter-unit">{{ unit }}</span>
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

/** 检索页的区间字段更紧凑，允许外部指定输入框宽度 */
.range-filter-compact .range-filter-mode {
  width: 78px;
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
