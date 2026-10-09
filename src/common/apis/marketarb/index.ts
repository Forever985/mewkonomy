import type { MarketVolumeItem } from "@/common/apis/marketvolume"
import { getMarketVolumeList } from "@/common/apis/marketvolume"
import { MARKET_TAX_FACTOR } from "@@/constants/market"

/**
 * 「炒货」（市场套利）—— 左价挂卖单 / 右价挂买单，两腿排队吃价差。
 *
 * ## 操作模型（用户 2026-10-09 确认）
 *
 *   ① 在【右价】挂**买单**排队，等卖家来成交 → 成本 = 右价
 *   ② 在【左价】挂**卖单**排队，等买家来成交 → 收入 = 左价 × (1 − 税率)
 *
 * 两腿都要等成交 ⇒ 期间左价可能下跌，这就是唯一的风险。
 *
 * ## 口径
 *
 *   毛差   = 左价 − 右价
 *   税额   = 左价 × (1 − MARKET_TAX_FACTOR)   ← 税基是**卖出成交额**，与项目内
 *                                               「收入一律按标价 × 税后系数」一致
 *   净利/件 = 左价 × MARKET_TAX_FACTOR − 右价
 *   净率    = 净利/件 ÷ 基数（基数可切换：右价 = 资金回报率 / 左价 = 毛利率，
 *            见 `ArbRateBase`；默认右价）
 *
 * ⚠️ **双边报价是硬前提**：只有左价时 `净利 = 左价 × 0.96 > 0` 会算成假的盈利，
 *   只有右价时必然为负。所以这里显式要求 `ask > 0 && bid > 0`，而不是只看净利符号。
 *
 * ⚠️ **不提供「总额潜力」**：官方 marketplace 只有 4 个字段
 *   （`a` 左价 / `b` 右价 / `p` 最新成交价 / `v` 当日累计成交量），
 *   **没有挂单队列深度** ⇒ 算不出「我这个单子能不能全吃进去」。
 *   用 `净利 × 当日成交量` 当总额会严重高估（那不是你能吃到的量），
 *   所以这里只给单位指标，`volume` 仅作参考列展示。
 */

/** 市场成交税率（4%）。净利与净率的推导全靠它，别写死数字 */
export const ARB_TAX_RATE = 1 - MARKET_TAX_FACTOR

/**
 * 净率的基数（用户 2026-10-09 确认默认「右价」，但要求可切换）。
 *
 * - `bid`（右价）：净利 ÷ 买入价 = **资金回报率**。沼泽精华 5.12 ÷ 64 = 8%
 * - `ask`（左价）：净利 ÷ 卖出价 = **毛利率**。沼泽精华 5.12 ÷ 72 = 7.11%
 *
 * 做成**参数**而不是页面上二次计算：净率同时是排序键和提醒指标，
 * 若只在界面换算，排序与预警就还是按旧基数在跑，两边会不一致。
 */
export type ArbRateBase = "bid" | "ask"

/** 取净率的分母 */
export function arbRateDenominator(item: { ask: number, bid: number }, base: ArbRateBase): number {
  return base === "bid" ? item.bid : item.ask
}

export interface ArbItem {
  hrid: string
  /** 物品名（i18n key 原文，页面用 t() 翻译） */
  name: string
  category: string
  itemLevel: number
  /** 市场档位 key（"0" / "1" …），是强化等级不是物品等级 */
  level: string
  /** 左价 = 挂卖单能卖出的价 */
  ask: number
  /** 右价 = 挂买单能买到的价 */
  bid: number
  /** 最新成交价（官方 `p`，无则 −1） */
  price: number
  /** 当日累计成交量（官方 `v`）。**仅参考**，不是你能吃到的量 */
  volume: number
  /** 税率，如 0.04 */
  taxRate: number
  /** 毛差 = 左价 − 右价 */
  grossSpread: number
  /** 税 = 左价 × 税率 */
  taxAmount: number
  /** 净利/件 = 左价 × 税后系数 − 右价 */
  netPerUnit: number
  /** 净率 = 净利/件 ÷ 基数（基数由调用方按 `ArbRateBase` 决定，默认右价） */
  netRate: number
  /**
   * 单件净利不足 1 —— 成交额按 4% 税后多半要被取整，这种「有价差但吃不到」的
   * 条目必须标出来，否则用户会以为每件都能赚到那 0.64。
   */
  subUnit: boolean
  /** 左价 ÷ 右价。真实市场的买卖价差不会到几倍，见 `suspicious` */
  leftRightRatio: number
  /**
   * 疑似异常报价（左价 ≥ 右价 3 倍）。
   *
   * 实测官方市场里存在这种条目：`/items/star_ladle` 左价 43.2 亿、右价 500 万，
   * 净率 82844%、**当日成交 0** —— 那是有人挂了个没人接的离谱卖单，
   * 你既不可能在那个价卖掉，也说明不了「有 82844% 的利润」。
   *
   * 不把它剔除（剔除＝替用户决定），而是**标出来**并说明原因。
   */
  suspicious: boolean
}

/** 从市场行算出炒货候选；只保留**双边有报价且扣税后仍有净利**的条目 */
export function calcArbList(base: ArbRateBase = "bid"): ArbItem[] {
  const out: ArbItem[] = []
  for (const row of getMarketVolumeList()) {
    const item = toArbItem(row, base)
    // 双边报价是硬前提：单边时净利符号没有意义（见文件头注释）
    if (item.ask <= 0 || item.bid <= 0) continue
    if (item.netPerUnit <= 0) continue
    out.push(item)
  }
  return out
}

/** 单行换算；不做过滤，交给调用方决定要不要（测试要能单独看一行的值） */
export function toArbItem(row: MarketVolumeItem, base: ArbRateBase = "bid"): ArbItem {
  const ask = row.ask
  const bid = row.bid
  const netPerUnit = ask * MARKET_TAX_FACTOR - bid
  const denominator = arbRateDenominator({ ask, bid }, base)
  return {
    hrid: row.hrid,
    name: row.name,
    category: row.category,
    itemLevel: row.itemLevel,
    level: row.level,
    ask,
    bid,
    price: row.price ?? -1,
    volume: row.volume ?? 0,
    taxRate: ARB_TAX_RATE,
    grossSpread: ask - bid,
    taxAmount: ask * ARB_TAX_RATE,
    netPerUnit,
    netRate: denominator > 0 ? netPerUnit / denominator : Number.NaN,
    subUnit: netPerUnit > 0 && netPerUnit < 1,
    leftRightRatio: bid > 0 ? ask / bid : Number.NaN,
    // 3 倍是「真实市场几乎不可能」的量级：净利率 ≈ 3×0.96−1 = 188%
    suspicious: bid > 0 && ask / bid >= 3
  }
}

/** 疑似异常报价的左/右 倍数门槛（实测 3 倍以上全是 0 成交的离谱挂单） */
export const ARB_SUSPICIOUS_RATIO = 3

/** 分类选项（去重排序），用于筛选下拉 */
export function getArbCategoryOptions(list: ArbItem[]): string[] {
  const set = new Set<string>()
  list.forEach((i) => i.category && set.add(i.category))
  return Array.from(set).sort()
}

/** 概览：双边有报价的条目里，有多少真的扣完税还有差价 */
export interface ArbSummary {
  /** 双边都有报价的条目数 */
  quoted: number
  /** 扣税后仍有净利的条目数 */
  profitable: number
  /** 单边有报价（挂单能成交但对面没挂）的条目数 —— 不可炒 */
  singleSide: number
}

export function getArbSummary(): ArbSummary {
  let quoted = 0
  let profitable = 0
  let singleSide = 0
  for (const row of getMarketVolumeList()) {
    const hasAsk = row.ask > 0
    const hasBid = row.bid > 0
    if (hasAsk && hasBid) {
      quoted++
      if (row.ask * MARKET_TAX_FACTOR - row.bid > 0) profitable++
    } else if (hasAsk || hasBid) {
      singleSide++
    }
  }
  return { quoted, profitable, singleSide }
}

export interface ArbFilter {
  /** 净率下限（比例，如 0.08 = 8%） */
  minNetRate?: number
  /** 单件净利下限 */
  minNetPerUnit?: number
  /** 右价下限：过滤掉「1 个金币赚 0.6」这种看着热闹的条目 */
  minBid?: number
  /** 分类（空 = 不限） */
  categories?: string[]
  /** 关键词：中文名 / 英文名 / hrid 三路模糊匹配 */
  keyword?: string
  /** 只要当日有成交的 */
  onlyTraded?: boolean
  /** 当日成交下限（官方 v 字段）。挂单两腿都要成交，从没人成交过的品种说明这不是真实价差 */
  minVolume?: number
  /** 隐藏疑似异常报价（左价 ≥ 右价 3 倍） */
  hideSuspicious?: boolean
}

/** 多路模糊匹配：中文玩家打「沼泽」，英文玩家打 Swamp，抄链接的打 hrid */
export function filterArbItems(list: ArbItem[], filter: ArbFilter, translate: (name: string) => string): ArbItem[] {
  const q = (filter.keyword ?? "").trim()
  const cats = filter.categories?.length ? new Set(filter.categories) : null
  return list.filter((i) => {
    if (filter.minNetRate != null && !(i.netRate >= filter.minNetRate)) return false
    if (filter.minNetPerUnit != null && !(i.netPerUnit >= filter.minNetPerUnit)) return false
    if (filter.minBid != null && !(i.bid >= filter.minBid)) return false
    if (filter.onlyTraded && !(i.volume > 0)) return false
    if (filter.minVolume != null && !(i.volume >= filter.minVolume)) return false
    if (filter.hideSuspicious && i.suspicious) return false
    if (cats && !cats.has(i.category)) return false
    if (q) {
      const lower = q.toLowerCase()
      const cn = translate(i.name)
      if (!i.name.toLowerCase().includes(lower)
        && !String(cn).toLowerCase().includes(q)
        && !i.hrid.toLowerCase().includes(lower)) {
        return false
      }
    }
    return true
  })
}

/**
 * 可排序列 = 表格里标了 `sortable="custom"` 的每一列，不多不少。
 * 白名单外的键会被重置成默认列（表头箭头变了、数据却没变）。
 */
export const ARB_SORT_KEYS = [
  "name",
  "ask",
  "bid",
  "price",
  "grossSpread",
  "taxAmount",
  "netPerUnit",
  "netRate",
  "volume"
] as const
export type ArbSortKey = (typeof ARB_SORT_KEYS)[number]

/** 默认按净率降序 —— 单位百分比最能一眼看出「哪个品种的差价盖得住税」 */
export const ARB_DEFAULT_SORT_KEY: ArbSortKey = "netRate"

export function sortArbRows(list: ArbItem[], key: ArbSortKey, desc: boolean): ArbItem[] {
  const dir = desc ? -1 : 1
  const sorted = [...list].sort((a, b) => {
    if (key === "name") {
      return a.name.localeCompare(b.name) * dir
    }
    const va = (a as unknown as Record<string, unknown>)[key]
    const vb = (b as unknown as Record<string, unknown>)[key]
    const na = typeof va === "number" && Number.isFinite(va) ? va : Number.NaN
    const nb = typeof vb === "number" && Number.isFinite(vb) ? vb : Number.NaN
    // NaN 沉底，避免「无数据」被排到最前面
    if (Number.isNaN(na) && Number.isNaN(nb)) return 0
    if (Number.isNaN(na)) return 1
    if (Number.isNaN(nb)) return -1
    return (na - nb) * dir
  })
  return sorted
}
