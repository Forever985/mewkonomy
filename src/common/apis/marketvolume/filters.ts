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

/**
 * 区间模式。`any` = 不限（该条件关闭）。
 *
 * 原本只有 4 种（any/gte/lte/between），现补齐为 9 种 —— 语义与判定
 * **统一由 `common/utils/query-engine` 的 `RangeMode` / `matchRange` / `applyRankingFilter`
 * 实现**，本文件只做类型再导出与市场监控特有的取值口径，避免两处判定逻辑漂移。
 *
 * 完整语义见 query-engine 的 `RangeMode` 声明（含每种模式的适用场景表）。
 */
import type { RangeMode as EngineRangeMode } from "@/common/utils/query-engine"
import { RANKING_MODES, applyRankingFilter, isRangeActive, matchRange } from "@/common/utils/query-engine"

// 判定实现统一到 query-engine，这里做再导出，保持本文件的既有引用面不变。
// ⚠️ 注意：必须**同时**写 import 与 export-from —— 只有 export-from 时
// 本文件内拿不到 `matchRange` 这个绑定（`ReferenceError: matchRange is not defined`）。
export type { RangeMode } from "@/common/utils/query-engine"
export { RANKING_MODES, applyRankingFilter, isRangeActive, matchRange }

export const RANGE_MODES: readonly EngineRangeMode[] = [
  "any",
  "gte",
  "lte",
  "between",
  "outside",
  "near",
  "eq",
  "topN",
  "bottomN"
]

export interface NumericRange {
  mode: EngineRangeMode
  /** `gte`/`lte`/`near`/`eq`/`topN`/`bottomN` 的阈值；`between`/`outside` 的下界 */
  min?: number
  /** `between` / `outside` 的上界 */
  max?: number
  /** `near` 模式的容差（半宽）。未填时 `near` 退化为 `eq` */
  tolerance?: number
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
 * 区间判定与「是否生效」**已上移到 query-engine**。
 *
 * 原因：市场监控页与利润检索页现在共用同一套区间语义（`RangeFilter` 组件也是共用的），
 * 判定逻辑只留一份。原先这里是独立实现，检索页另有一套裸 min/max 五段 if，
 * 两边语义会漂移。
 */

// ── 语义说明（判定实现在 query-engine）────────────────────────────────
//  1. **端点一律包含**：`不低于` 是 `>=`、`不高于` 是 `<=`、`区间` 是 `min <= v <= max`。
//  2. **阈值缺失 / 非有限数 ⇒ 该条件视为未启用**，而不是"匹配空集"。
//  3. `区间` 模式下 `min > max` 时**自动对调**：这是填反了，不是要筛出空集。
//  4. **取值缺失的条目在条件启用时一律不匹配**（`changePct` 无历史基准、价格为 -1 等）。
//  5. `topN` / `bottomN` 需要跨条目比较，由 `applyRankingFilter` 在整表层面处理。

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
  return matchRange(value, range)
}

/** 按多个区间条件过滤（各条件之间是「与」） */
export function applyRangeFilters(list: MarketVolumeItem[], ranges: MarketRanges): MarketVolumeItem[] {
  const active = MARKET_RANGE_FIELDS.filter(field => isRangeActive(ranges[field]))
  if (!active.length) {
    return list
  }
  // `topN`/`bottomN` 跨条目比较，必须在整表层面做
  const rankingKeys = active.filter(f => RANKING_MODES.includes(ranges[f].mode))
  const hasRanking = rankingKeys.length > 0
  const pointActive = active.filter(f => !RANKING_MODES.includes(ranges[f].mode))

  let out = pointActive.length
    ? list.filter(item => pointActive.every(field => matchesRange(rangeValueOf(item, field), ranges[field])))
    : list

  if (hasRanking) {
    const rangeMap: Record<string, NumericRange> = {}
    for (const f of rankingKeys) {
      rangeMap[f] = ranges[f]
    }
    const keep = applyRankingFilter(out, rangeMap, (item, field) =>
      rangeValueOf(item, field as MarketRangeField)
    )
    out = out.filter(item => keep.has(item))
  }
  return out
}

/** 当前生效的区间条件数量（用于「筛选 N 项」角标） */
export function countActiveRanges(ranges: MarketRanges): number {
  return MARKET_RANGE_FIELDS.filter(field => isRangeActive(ranges[field])).length
}
