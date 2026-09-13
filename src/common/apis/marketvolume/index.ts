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
        turnover: price > 0 && volume > 0 ? price * volume : 0
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

export function getMarketVolumeSummary(list: MarketVolumeItem[]): MarketVolumeSummary {
  let active = 0
  let topVolume: MarketVolumeItem | null = null
  let topTurnover: MarketVolumeItem | null = null
  for (const i of list) {
    if (i.volume > 0) {
      active++
      if (!topVolume || i.volume > topVolume.volume) {
        topVolume = i
      }
    }
    if (i.turnover > 0 && (!topTurnover || i.turnover > topTurnover.turnover)) {
      topTurnover = i
    }
  }
  const sorted = [...list].sort((a, b) => b.volume - a.volume)
  const topVolumeSum = sorted.slice(0, 10).reduce((s, i) => s + i.volume, 0)
  return { total: list.length, active, topVolume, topTurnover, topVolumeSum }
}
