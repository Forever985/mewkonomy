import { getGameDataApi, getMarketDataApi } from "@/common/apis/game"

/**
 * 市场贸易量监控
 *
 * 数据来源：官方 marketplace.json 中每个价格档的 `v`（成交量）与 `p`（当前价）字段，
 * store 层（updateMarketData）已将原始 a/b/p/v 保留为 ask/bid/price/volume。
 * 本模块负责把扁平 marketData 聚合为可展示的条目列表，供「市场监控」页面使用。
 */

export interface MarketVolumeItem {
  hrid: string
  /** 物品名（i18n key 原文，页面用 t() 翻译） */
  name: string
  /** 分类末段（如 equipment / resource / consumable） */
  category: string
  itemLevel: number
  /** 市场档位 key（如 "0"） */
  level: string
  ask: number
  bid: number
  price: number
  volume: number
  /** 估算成交额 = 当前价 × 成交量（无价时 0） */
  turnover: number
  /** 涨跌百分比（相对时间窗基准）；null 表示该条目无历史基准 */
  changePct?: number | null
  /** 涨跌基准值（口径由页面选择：价格 / 左挂单 / 右收购 / 成交量） */
  changeBase?: number | null
  /** 成交量速率（件/小时，窗口内增量均值）；null 表示无基准或跨了 UTC 归零点 */
  volumeRate?: number | null
  /**
   * 成交量速率**实际**使用的小时数。
   * 快照按小时采集，选「1 小时」窗口时最近基准点常在数小时之前，
   * UI 用它提示「这个速率并不是按 1 小时算出来的」。
   */
  volumeRateHours?: number | null
  /**
   * 该速率是否跨了 UTC 归零点（true 表示只统计了自上一天 0 点以来的累计量）。
   */
  volumeRateCrossDay?: boolean
  /**
   * **时间窗内滚动成交量**（页面按所选时间窗回填）。
   *
   * 与 `volume`（官方当日累计量、UTC 0 点归零）不同：它是把自有采样归档上相邻
   * 采样点的增量滚动累加得到的，不归零、跨时刻可比。见 `getRollingVolumeDetail`。
   */
  volumeRolling?: number | null
  /** 滚动成交量对应的**成交额**估算（滚动量 × 当前价） */
  turnoverRolling?: number | null
  /** 滚动成交量实际统计的小时数（= now - 基准点，恒 ≥ 所选窗口） */
  volumeRollingHours?: number | null
  /** 滚动成交量里「增量可精确得知」的比例（<1 表示区间跨了 UTC 归零点） */
  volumeRollingCoverage?: number | null
}

/** 聚合全部市场条目（含价格档展开）。读失败/未加载时返回空数组。 */
export function getMarketVolumeList(): MarketVolumeItem[] {
  const market = getMarketDataApi()?.marketData
  const items = getGameDataApi()?.itemDetailMap
  if (!market || !items) {
    return []
  }
  const list: MarketVolumeItem[] = []
  for (const hrid in market) {
    const item = items[hrid]
    const name = item?.name ?? hrid
    const category = (item?.categoryHrid ?? "").replace("/item_categories/", "")
    const itemLevel = item?.itemLevel ?? 0
    const entry = market[hrid]
    for (const level in entry) {
      const p = entry[level]
      const price = p.price ?? -1
      const volume = p.volume ?? 0
      list.push({
        hrid,
        name,
        category,
        itemLevel,
        level,
        ask: p.ask ?? -1,
        bid: p.bid ?? -1,
        price,
        volume,
        turnover: price > 0 && volume > 0 ? price * volume : 0,
        volumeRate: null
      })
    }
  }
  return list
}

/** 分类选项（去重排序），用于筛选下拉 */
export function getMarketCategoryOptions(list: MarketVolumeItem[]): string[] {
  const set = new Set<string>()
  list.forEach((i) => i.category && set.add(i.category))
  return Array.from(set).sort()
}

/**
 * 市场档位的显示后缀：`level` 是**强化等级**（官方 0~20），不是物品等级。
 *
 * 全站用 `+N` 表示强化等级（见 `ActionDetailCard.vue` 的 `+{{ row.level }}`），
 * 0 级不加后缀。集中在这里是因为这个后缀在表格、Top10、汇总卡片三处都要用，
 * 各写一遍正是之前那个 bug 的来源 —— 有一处错写成 `Lv{{ itemLevel }}`，
 * 于是同一件装备的十几个强化档全部显示成同一个「神圣凿子 Lv80」。
 */
export function enhanceLevelSuffix(level: string | number): string {
  const lv = String(level)
  return !lv || lv === "0" ? "" : `+${lv}`
}

/**
 * 可排序列 = 表格里标了 `sortable="custom"` 的每一列，不多不少。
 *
 * `name` 是文本列（按显示名比较），其余都是数值列。
 * `name` 必须在白名单里：表格给「物品」列标了 `sortable="custom"`，点表头会派发
 * `sort-change`；白名单若不认它，排序会被重置成默认列 —— 表头箭头变了、数据却没变。
 *
 * 注意这里**不含**官方的 `volume` / `turnover`：表格展示的是滚动口径
 * （`volumeRolling` / `turnoverRolling`），没有对应的列就不该出现在白名单里，
 * 否则「表头能点但没这列」会被误认为支持排序。
 */
export const MARKET_VOLUME_SORT_KEYS = [
  "name",
  "volumeRolling",
  "turnoverRolling",
  "price",
  "ask",
  "bid",
  "itemLevel",
  "changePct",
  "volumeRate"
] as const
export type MarketVolumeSortKey = (typeof MARKET_VOLUME_SORT_KEYS)[number]

function numericValueOf(i: MarketVolumeItem, key: Exclude<MarketVolumeSortKey, "name">): number {
  const v = (i as unknown as Record<string, unknown>)[key]
  // `null`/`undefined` 表示「无数据」（涨跌缺基准、速率缺历史），
  // 而 Number(null) 是 0，会跟真的 0 混在一起，所以显式转成 NaN 统一沉底。
  return v == null ? Number.NaN : Number(v)
}

/**
 * 按列排序（返回新数组，不改原数组）。
 *
 * `nameOf` 让调用方决定用哪个名字比较（页面传 `t` 以按界面语言排序，测试可省略）。
 * 无数据的行不分升降序一律排在末尾，否则升序时一屏 `--` 会顶在最前面。
 */
export function sortMarketVolumeRows(
  list: MarketVolumeItem[],
  key: MarketVolumeSortKey,
  order: "descending" | "ascending",
  nameOf: (name: string) => string = (n) => n
): MarketVolumeItem[] {
  const dir = order === "ascending" ? 1 : -1
  return [...list].sort((a, b) => {
    if (key === "name") {
      return nameOf(a.name).localeCompare(nameOf(b.name)) * dir
    }
    const av = numericValueOf(a, key)
    const bv = numericValueOf(b, key)
    const aNaN = Number.isNaN(av)
    const bNaN = Number.isNaN(bv)
    if (aNaN || bNaN) {
      return aNaN && bNaN ? 0 : aNaN ? 1 : -1
    }
    return (av - bv) * dir
  })
}

export interface MarketVolumeSummary {
  /** 市场条目总数（含各档位） */
  total: number
  /** 有成交量的条目数 */
  active: number
  /** 成交量最大的条目 */
  topVolume: MarketVolumeItem | null
  /** 成交额最大的条目 */
  topTurnover: MarketVolumeItem | null
  /** 成交量 Top 条目的成交量之和（整体活跃度参考） */
  topVolumeSum: number
}

/** 汇总口径：官方当日累计量，或时间窗内滚动量 */
export type MarketVolumeMetric = "volume" | "volumeRolling"

/**
 * 汇总统计。
 *
 * `metric` 决定「有成交 / 成交量最高」按哪个口径算：
 * 默认 `volume`（官方当日累计，可能因 UTC 归零而偏小）；
 * 页面传 `volumeRolling` 以与表格里展示的滚动成交量保持一致。
 * 该字段由页面回填，缺失时按 0 处理。
 */
export function getMarketVolumeSummary(
  list: MarketVolumeItem[],
  metric: MarketVolumeMetric = "volume"
): MarketVolumeSummary {
  const valueOf = (i: MarketVolumeItem) => (metric === "volumeRolling" ? i.volumeRolling ?? 0 : i.volume)
  let active = 0
  let topVolume: MarketVolumeItem | null = null
  let topTurnover: MarketVolumeItem | null = null
  let topValue = 0
  for (const i of list) {
    const v = valueOf(i)
    if (v > 0) {
      active++
      if (!topVolume || v > topValue) {
        topVolume = i
        topValue = v
      }
    }
    if (i.turnover > 0 && (!topTurnover || i.turnover > topTurnover.turnover)) {
      topTurnover = i
    }
  }
  const sorted = [...list].sort((a, b) => valueOf(b) - valueOf(a))
  const topVolumeSum = sorted.slice(0, 10).reduce((s, i) => s + valueOf(i), 0)
  return { total: list.length, active, topVolume, topTurnover, topVolumeSum }
}
