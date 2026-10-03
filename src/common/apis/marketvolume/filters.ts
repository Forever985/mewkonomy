import type { MarketVolumeItem } from "."

/**
 * 市场监控「区间筛选」的模型与判定。
 *
 * 与 `alerts.ts` 一样是**纯函数模块**：不碰副作用、不碰 i18n、不读 store，
 * 因此可以直接用普通数组断言；「怎么显示这些控件」由页面决定。
 *
 * ## 边界语义（这是最容易产生"看起来坏了"的地方，先定清楚）
 *
 * 1. **端点一律包含**：`不低于` 是 `>=`、`不高于` 是 `<=`、`区间` 是 `min <= v <= max`。
 *    刻意与提醒规则的 `gte`/`lte` 保持同一语义（那边叫「达到或高于」），避免同一个项目里
 *    出现两套"高于"的理解。选项文案也据此写成 `不低于`/`不高于`，而不是含糊的"高于"。
 * 2. **阈值缺失 / 非有限数 ⇒ 该条件视为未启用**，而不是"匹配空集"。用户在 `>` 模式下
 *    还没填数字时，列表必须照常显示，不能瞬间变空。
 * 3. `区间` 模式下 `min > max` 时**自动对调**：这是填反了，不是要筛出空集。
 * 4. **取值缺失的条目在条件启用时一律不匹配**：`changePct` 无历史基准（null）、
 *    价格无价（-1）等。否则「涨跌幅 ≥ 10%」会把一堆无历史的条目放进来。
 */

/** 区间模式。`any` = 不限（该条件关闭） */
export type RangeMode = "any" | "gte" | "lte" | "between"

export const RANGE_MODES: readonly RangeMode[] = ["any", "gte", "lte", "between"]

export interface NumericRange {
  mode: RangeMode
  /** `gte` / `lte` 的阈值；`between` 的下界 */
  min?: number
  /** `between` 的上界 */
  max?: number
}

/** 可被区间筛选的字段 */
export type MarketRangeField = "changePct" | "volume" | "turnover" | "volumeRate" | "price"

export const MARKET_RANGE_FIELDS: readonly MarketRangeField[] = [
  "changePct",
  "volume",
  "turnover",
  "volumeRate",
  "price"
]

export type MarketRanges = Record<MarketRangeField, NumericRange>

export function createEmptyRanges(): MarketRanges {
  return {
    changePct: { mode: "any" },
    volume: { mode: "any" },
    turnover: { mode: "any" },
    volumeRate: { mode: "any" },
    price: { mode: "any" }
  }
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * 某个区间条件是否真的在生效（模式非 any **且** 该模式需要的阈值都填了）。
 * 页面用它来决定"是否显示为已筛选"、以及是否要在结果为空时给出提示。
 */
export function isRangeActive(range: NumericRange | undefined | null): boolean {
  if (!range) {
    return false
  }
  if (range.mode === "gte" || range.mode === "lte") {
    return finite(range.min) != null
  }
  if (range.mode === "between") {
    // 只填了一边也算生效：等价于 >= 下界 或 <= 上界，符合直觉
    return finite(range.min) != null || finite(range.max) != null
  }
  return false
}

/**
 * 取某条目某字段用于筛选的**数值**。返回 null 表示"这个条目没有该值"。
 *
 * 成交量/成交额与表格**展示的那一列**保持一致（优先时间窗内滚动量、回退官方当日累计量），
 * 否则会出现"屏幕上写着 0，却因为底层 volume 非 0 而被筛出来"这种自相矛盾。
 */
export function rangeValueOf(item: MarketVolumeItem, field: MarketRangeField): number | null {
  switch (field) {
    case "changePct":
      return finite(item.changePct)
    case "volume":
      return finite(item.volumeRolling) ?? finite(item.volume)
    case "turnover":
      return finite(item.turnoverRolling) ?? finite(item.turnover)
    case "volumeRate":
      return finite(item.volumeRate)
    case "price":
      // 项目约定 price === -1 表示无价，不能当成"价格很低"参与比较
      return item.price > 0 ? finite(item.price) : null
    default:
      return null
  }
}

/** 单个值是否满足区间条件。`value === null`（条目无该值）在条件启用时一律不匹配。 */
export function matchesRange(value: number | null, range: NumericRange | undefined | null): boolean {
  if (!isRangeActive(range)) {
    return true
  }
  if (value == null) {
    return false
  }
  const r = range!
  const min = finite(r.min)
  const max = finite(r.max)
  if (r.mode === "gte") {
    return value >= min!
  }
  if (r.mode === "lte") {
    return value <= min!
  }
  // between：单边时退化为 >= / <=；双边时自动对调，避免"填反了就空列表"
  if (min != null && max != null) {
    const lo = Math.min(min, max)
    const hi = Math.max(min, max)
    return value >= lo && value <= hi
  }
  if (min != null) {
    return value >= min
  }
  return value <= max!
}

/** 按多个区间条件过滤（各条件之间是「与」） */
export function applyRangeFilters(list: MarketVolumeItem[], ranges: MarketRanges): MarketVolumeItem[] {
  const active = MARKET_RANGE_FIELDS.filter(field => isRangeActive(ranges[field]))
  if (!active.length) {
    return list
  }
  return list.filter(item => active.every(field => matchesRange(rangeValueOf(item, field), ranges[field])))
}

/** 当前生效的区间条件数量（用于「筛选 N 项」角标） */
export function countActiveRanges(ranges: MarketRanges): number {
  return MARKET_RANGE_FIELDS.filter(field => isRangeActive(ranges[field])).length
}
