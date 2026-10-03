/**
 * 无市价兜底：**策略模型 + 纯函数解析**（零运行时依赖，可脱开游戏数据单测）
 *
 * ## 为什么不用「A/B/C 三档」
 * 旧模型是一个枚举同时控制左右两侧，想「右价借左价、左价借右价」这类组合就得加档位，
 * 档位一多就出现组合爆炸，而且改一处必然影响另一侧。
 * 这里改成**左右两侧各自独立**描述一条**优先级链**：
 *
 * ```
 * 正常市价  →  （可选）借用另一端的市价  →  （可选）商店价 / 大全套（自产成本）  →  无价 -1
 * ```
 *
 * 于是用户提的四条需求分别对应：
 * - 「需要右价时没有右价就用左价」   ⇒ `bid.cross = true`
 * - 「需要左价时没有左价就用右价」   ⇒ `ask.cross = true`
 * - 「左右都没有就用大全套兜底」     ⇒ `then: "bigset"`
 * - 「需要时手动强制用大全套」       ⇒ `forceBigSet = true`
 *
 * ## 不变量（由单测锁住）
 * **来源与价格永远一致**：标 `market`/`cross`/`shop`/`selfcraft` 的那一侧一定取到了数，
 * 标 `none` 的那���一定真的是 -1。这条以前在 level>0 上不成立（会误标），
 * 现在 price 与 source 由同一个函数一次产出，结构上不可能漂移。
 */

/** 单侧兜底策略：市价缺失时怎么办 */
export interface FallbackSide {
  /** 是否借用**另一端**的市价（左价借右价 / 右价借左价） */
  cross: boolean
  /** 借不到（或不借）时用什么兜底 */
  then: "none" | "shop" | "bigset"
}

export interface PriceFallbackSettings {
  /** 买入端（左价 / ask） */
  ask: FallbackSide
  /** 卖出端（右价 / bid） */
  bid: FallbackSide
  /** 忽略市价，一律按大全套（自产）成本算 —— 「我就想按自产成本估」 */
  forceBigSet: boolean
}

/** 默认：借另一端 → 再用大全套（用户明确要求的那条链） */
export const DEFAULT_PRICE_FALLBACK: PriceFallbackSettings = {
  ask: { cross: true, then: "bigset" },
  bid: { cross: true, then: "bigset" },
  forceBigSet: false
}

export type FallbackSource = "market" | "cross" | "shop" | "selfcraft" | "none"

export interface PriceSidesInput {
  /** 原始市价，缺价为 -1 */
  ask: number
  bid: number
  /** 商店金币购买价（仅买入端有意义），无则 -1 */
  shopAsk: number
  /** 商店回收价（item.sellPrice），无则 -1 */
  shopBid: number
  /** 大全套（自产）成本，无则 -1 */
  bigSet: number
}

export interface PriceSidesResult {
  ask: number
  bid: number
  askSource: FallbackSource
  bidSource: FallbackSource
}

const NONE = -1

function pickSide(
  rawSelf: number,
  rawOther: number,
  side: FallbackSide,
  shop: number,
  bigSet: number,
  forced: boolean
): { price: number, source: FallbackSource } {
  // 1) 强制大全套：无视市价，也不管用户选了什么
  if (forced) {
    return bigSet >= 0 ? { price: bigSet, source: "selfcraft" } : { price: NONE, source: "none" }
  }

  // 2) 市价正常时直接用。
  //    只有当用户把「商店价」选为兜底手段、且商店比市价更便宜时，才改用商店价
  //    （商店能花金币直接买到，是真实可达的买价；旧实现就有这个优化，保留为可选行为）
  if (rawSelf !== NONE) {
    if (side.then === "shop" && shop >= 0 && shop < rawSelf) {
      return { price: shop, source: "shop" }
    }
    return { price: rawSelf, source: "market" }
  }

  // 3) 市价缺失 → 借用另一端的**市价**（刻意用原始值，避免"借来的值再被借一次"）
  if (side.cross && rawOther !== NONE) {
    return { price: rawOther, source: "cross" }
  }

  // 4) 仍无 → 按用户选的兜底手段
  if (side.then === "shop" && shop >= 0) {
    return { price: shop, source: "shop" }
  }
  if (side.then === "bigset" && bigSet >= 0) {
    return { price: bigSet, source: "selfcraft" }
  }
  return { price: NONE, source: "none" }
}

/**
 * 解析左右两侧的最终价格与来源。
 *
 * 纯函数：所有外部依赖（商店价、大全套价）都由调用方算好传进来，
 * 因此可以在没有任何游戏数据的情况下把策略矩阵全部测一遍。
 */
export function resolvePriceSides(
  input: PriceSidesInput,
  settings: PriceFallbackSettings
): PriceSidesResult {
  const forced = settings.forceBigSet
  const ask = pickSide(input.ask, input.bid, settings.ask, input.shopAsk, input.bigSet, forced)
  const bid = pickSide(input.bid, input.ask, settings.bid, input.shopBid, input.bigSet, forced)
  return {
    ask: ask.price,
    bid: bid.price,
    askSource: ask.source,
    bidSource: bid.source
  }
}

/**
 * 设置签名：写进价格缓存的 key。
 *
 * 有了它，切换兜底设置会**自然地 miss 缓存**，不必依赖「异步 watch 去清缓存」那个
 * 有时序窗口的方案（旧实现就因为 `_priceResolutionCache` 的 key 不含模式，
 * 导致同一 tick 内切模式读到旧结果）。
 */
export function priceFallbackSignature(settings: PriceFallbackSettings): string {
  const s = settings
  return `${s.ask.cross ? 1 : 0}${s.ask.then[0]}${s.bid.cross ? 1 : 0}${s.bid.then[0]}${s.forceBigSet ? 1 : 0}`
}

/** 迁移：把旧的 A/B/C 三档映射到新的左右独立链（尽量保持原有行为） */
export function migrateLegacyMode(mode: "A" | "B" | "C"): PriceFallbackSettings {
  if (mode === "A") {
    return { ask: { cross: false, then: "none" }, bid: { cross: false, then: "none" }, forceBigSet: false }
  }
  if (mode === "B") {
    return { ask: { cross: false, then: "none" }, bid: { cross: false, then: "shop" }, forceBigSet: false }
  }
  return { ask: { cross: false, then: "bigset" }, bid: { cross: false, then: "shop" }, forceBigSet: false }
}

/** 把任意来源的输入归一化成合法设置（localStorage 可能被手改） */
export function normalizePriceFallback(input: unknown): PriceFallbackSettings {
  const d = DEFAULT_PRICE_FALLBACK
  if (!input || typeof input !== "object") {
    return { ask: { ...d.ask }, bid: { ...d.bid }, forceBigSet: false }
  }
  const raw = input as Record<string, any>
  const side = (v: any, fallback: FallbackSide): FallbackSide => ({
    cross: typeof v?.cross === "boolean" ? v.cross : fallback.cross,
    then: v?.then === "shop" || v?.then === "bigset" || v?.then === "none" ? v.then : fallback.then
  })
  return {
    ask: side(raw.ask, d.ask),
    bid: side(raw.bid, d.bid),
    forceBigSet: typeof raw.forceBigSet === "boolean" ? raw.forceBigSet : false
  }
}
