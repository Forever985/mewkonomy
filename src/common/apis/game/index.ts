import type { EnhancelateResult } from "@/calculator/enhance"
import type { ActionDetail, CommunityBuffDetail, DropTableItem, GameData, ItemDetail, PersonalBuffDetail } from "~/game"
import type { MarketData, MarketItemPrice } from "~/market"
import deepFreeze from "deep-freeze-strict"
import { COIN_HRID, PriceStatus, useGameStoreOutside } from "@/pinia/stores/game"

// 把Proxy扒下来，提高性能
const game = {
  gameData: null as GameData | null,
  marketData: null as MarketData | null
}
let _actionDetailMapCache: Record<string, ActionDetail> = {}
const _itemDetailMapCache: Record<string, ItemDetail> = {}
const _communityBuffTypeDetailMapCache: Record<string, CommunityBuffDetail> = {}
const _personalBuffTypeDetailMapCache: Record<string, PersonalBuffDetail> = {}

let _processingProductMap: Record<string, string> = {}
let _priceCache = {} as Record<string, MarketItemPrice>
/**
 * level=0 的「裸价解析」缓存：只做一次市场/商店/兜底判定，
 * 之后由 getPriceOf 转成买卖状态、由 getPriceSourceOf 读来源，避免两处判定逻辑漂移。
 */
let _priceResolutionCache = {} as Record<string, {
  ask: number
  bid: number
  askSource: PriceSource
  bidSource: PriceSource
}>
// 大全套价格（模式C）：市场无价物品用自产成本兜底
const BIG_SET_PROJECTS = ["cheesesmithing", "crafting", "tailoring", "cooking", "brewing"] as const
const GATHER_ACTION_PREFIXES = ["/actions/milking/", "/actions/foraging/", "/actions/woodcutting/"]
let _bigSetGatherableSet: Set<string> | null = null
let _bigSetPriceCache = {} as Record<string, number>
// 炼金自产反查表（模式C）：itemHrid → 可由哪些物品经转化/分解产出（含数量/掉率/基础成功率）
let _bigSetAlchemySourceMap: Map<string, { xHrid: string; count: number; rate: number; successRate: number }[]> = new Map()
let currentBuyStatus = useGameStoreOutside().buyStatus
let currentSellStatus = useGameStoreOutside().sellStatus
watch(() => useGameStoreOutside().gameData, () => {
  const data = structuredClone(toRaw(useGameStoreOutside().gameData))
  game.gameData = data ? deepFreeze(data) : data
  _actionDetailMapCache = {}
  _priceCache = {}
  initProcessingProductMap()
  initBigSetCache()
}, { immediate: true })
watch(() => useGameStoreOutside().marketData, () => {
  const data = Object.freeze(structuredClone(toRaw(useGameStoreOutside().marketData)))
  game.marketData = data
  _priceCache = {}
  _priceResolutionCache = {}
  _bigSetPriceCache = {}
}, { immediate: true })

watch([() => useGameStoreOutside().buyStatus, () => useGameStoreOutside().sellStatus], () => {
  _priceCache = {}
}, { immediate: true })

watch(() => useGameStoreOutside().priceFallbackMode, () => {
  _priceCache = {}
  _priceResolutionCache = {}
}, { immediate: true })

watch(() => useGameStoreOutside().buyStatus, (newVal) => {
  currentBuyStatus = newVal
}, { immediate: true })

watch(() => useGameStoreOutside().sellStatus, (newVal) => {
  currentSellStatus = newVal
}, { immediate: true })

/** 查 */
export function getGameDataApi() {
  const res = game.gameData
  return res!
}
export function getMarketDataApi() {
  const res = game.marketData
  return res!
}
const SPECIAL_PRICE: Record<string, () => MarketItemPrice> = {
  "/items/cowbell": () => ({
    ask: getPriceOf("/items/bag_of_10_cowbells").ask / 10 || 40000,
    bid: getPriceOf("/items/bag_of_10_cowbells").bid / 10 || 40000
  }),
  "/items/coin": () => ({
    ask: 1,
    bid: 1
  })
}

/**
 * 每个价格口径 =（基准报价, 档位方向）。
 *
 * 用 `Record<PriceStatus, ...>` 而不是 `switch`：**漏掉一个枚举成员会被类型检查直接拦下**。
 * 这在加了 `ASK_HIGH`/`BID_LOW` 之后尤其重要——只改 UI 列表、忘了改计算分支，
 * 会表现成「下拉里能选、但算出来的价格没变化」这种很难发现的静默错误。
 *
 * `dir`：`0` = 取原价；`+1` = 抬一档（价格更高）；`-1` = 压一档（价格更低）。
 */
const STATUS_STEP_SPEC: Record<PriceStatus, { base: "ask" | "bid", dir: -1 | 0 | 1 }> = {
  [PriceStatus.ASK]: { base: "ask", dir: 0 },
  [PriceStatus.ASK_LOW]: { base: "ask", dir: -1 },
  [PriceStatus.ASK_HIGH]: { base: "ask", dir: 1 },
  [PriceStatus.BID]: { base: "bid", dir: 0 },
  [PriceStatus.BID_LOW]: { base: "bid", dir: -1 },
  [PriceStatus.BID_HIGH]: { base: "bid", dir: 1 }
}

function convertPriceOfStatus(price: MarketItemPrice, buyStatus: PriceStatus, sellStatus: PriceStatus, enhanced = false) {
  function convert(status: PriceStatus) {
    const result = { price: -1 }
    // 断言成可空：状态值可能来自 localStorage（`usePriceStatus` 按页记忆），
    // 手工改过的旧值不在枚举里。旧实现的 switch 没有 default，同样会静默返回 -1。
    const spec = STATUS_STEP_SPEC[status] as { base: "ask" | "bid", dir: -1 | 0 | 1 } | undefined
    if (!spec) {
      return result
    }
    result.price = spec.base === "ask" ? price.ask : price.bid
    // 无价（≤ 0）保持原样、不参与档位移动（与旧实现一致：-1 传进去只会得到 -1）
    if (spec.dir !== 0 && result.price > 0) {
      result.price = priceStepOf(result.price, spec.dir > 0, enhanced)
    }
    return result
  }

  return {
    ask: convert(buyStatus).price,
    bid: convert(sellStatus).price
  }
}

/**
 * 市场价「一档」的相对增量。
 *
 * 权威来源（2026/9/28 补丁原文，随客户端一并分发）：
 *   - 标准物品：相邻挂单价相差 **0.33% ~ 0.44%**（此前为 0.17% ~ 0.5%）；
 *   - 强化物品（+1 及以上）：流动性低，增量**大 5 倍**，即 1.67% ~ 2.22%。
 * 实测核对（2026-10-01 官方 marketplace.json：754 对 0 级、756 对强化档的 ask−bid 价差）：
 *   标准 ≈ 0.366%、强化 ≈ 1.852%，两者之比 5.06 ≈ 5×，与补丁一致。
 * 故此处取实测值作为「一档」的点估计，5 倍关系按补丁的整数倍实现。
 *
 * 另注：游戏本身并没有全局固定档位——每个 (物品, 强化等级) 各有一个服务端下发的
 * 「交易区间」[bandMin, bandMax]（客户端 `priceBandMins` / `priceBandMaxs`），输入价只是被
 * `deriveWorkingPrice` 夹进该区间；区间每 60 分钟校准一次、每次最多移动 1%
 * （`recalibrationIntervalMinutes: 60` / `bandMaxMovePerPassFactor: 1.01`）。
 * 我们手上只有 ask / bid 两个点，因此用「一档增量」来近似表达「压一档 / 抬一档」。
 *
 * 历史：本函数原先是「按十进制归一化后取 1/2/5/10 的粗档位表」，隐含增量约 1%~5%，
 * 比游戏真实增量大 3~10 倍，已在 2026-10-01 依官方数据改正。
 */
const PRICE_STEP_RATIO = 0.00366
/** 强化物品的档位倍数（补丁：5×） */
const PRICE_STEP_ENHANCED_MULTIPLIER = 5

/**
 * 把价格移动一档。
 * @param price 原价
 * @param high true = 抬一档（价格更高，如 `左价+` / `右价+`）；false = 压一档（价格更低，如 `左价-` / `右价-`）
 * @param enhanced 是否强化物品（强化等级 ≥ 1），决定增量倍数
 */
function priceStepOf(price: number, high: boolean = true, enhanced = false) {
  if (price <= 0) {
    return -1
  }
  const ratio = PRICE_STEP_RATIO * (enhanced ? PRICE_STEP_ENHANCED_MULTIPLIER : 1)
  const stepped = Math.round(high ? price * (1 + ratio) : price * (1 - ratio))
  // 市场价是整数金币；低价物品的一档可能不足 1 金币（如 10 金 × 0.366% = 0.037），
  // 此时取整会原地不动，但游戏的最小价格栅格就是 1 金币，所以保底移动 1 金。
  if (stepped === price) {
    return Math.max(1, high ? price + 1 : price - 1)
  }
  return Math.max(1, stepped)
}

export function getPriceOf(hrid: string, level: number = 0, buyStatus: PriceStatus = currentBuyStatus, sellStatus: PriceStatus = currentSellStatus): MarketItemPrice {
  if (!hrid) {
    return {
      ask: -1,
      bid: -1
    }
  }
  const item = getItemDetailOf(hrid)
  if (level) {
    const marketItem = game.marketData?.marketData[hrid]
    const priceItem = marketItem ? marketItem[level] : undefined

    const price = {
      ask: priceItem?.ask || -1,
      bid: priceItem?.bid || -1
    }
    // 该物品在市场完全没有交易记录时（如披风等稀有掉落装备）兜底：
    // - 卖出端(bid)：卖商店价(sellPrice)真实可达，始终保底（B/C 模式）
    // - 买入端(ask)：模式C 用大全套（自产，含炼金折算）成本替代；模式B 保持 -1（买不到不虚报）
    // 高等级（level>0）的兜底：买卖两端**独立**判定，避免「补了 ask 就不补 bid」的耦合缺陷。
    // - 卖出端(bid)：卖商店价(sellPrice)真实可达，始终保底（B/C 模式）
    // - 买入端(ask)：模式C 下该等级市场完全无记录时用大全套（自产）成本替代；
    //   模式B 保持 -1（买不到不虚报）
    if (isFallbackEnabled()) {
      if ((item.sellPrice ?? 0) > 0 && price.bid === -1) {
        price.bid = item.sellPrice
      }
      if (price.ask === -1 && !marketItem && useGameStoreOutside().priceFallbackMode === "C") {
        const bigSetPrice = getBigSetPriceOf(item.hrid)
        if (bigSetPrice >= 0) {
          price.ask = bigSetPrice
        }
      }
    }
    // level > 0 即强化物品（+1 及以上），档位增量大 5 倍
    return convertPriceOfStatus(price, buyStatus, sellStatus, true)
  }

  // 缓存 key 含价格模式与买卖状态：切换模式/状态后即使 watch 异步清缓存，也不会命中旧值
  const cacheKey = `${hrid}|${useGameStoreOutside().priceFallbackMode}|${buyStatus}|${sellStatus}`
  if (_priceCache[cacheKey]) {
    return _priceCache[cacheKey]
  }
  const resolved = resolveLevel0Price(hrid)
  _priceCache[cacheKey] = convertPriceOfStatus({ ask: resolved.ask, bid: resolved.bid }, buyStatus, sellStatus, false)
  return _priceCache[cacheKey]
}

/**
 * level=0 的裸价解析（不做买卖状态转换）。
 *
 * 修复了两个会直接影响利润正确性的缺陷：
 * 1. **兜底耦合**：早期实现把 ask/bid 的兜底写在同一个 `if (ask === -1 && bid === -1)` 里，
 *    导致「模式C 已用大全套成本补上 ask」之后就再也不会用 sellPrice 兜 bid，
 *    出现「有买入价、却卖不出去(-1)」的自相矛盾状态（实测 60 件装备）。
 *    `Calculator.valid` 会把 bid = -1 的方案整条判为无效，直接污染强化/分解排名。
 * 2. **来源误标**：商店金币价会先把 ask 从 -1 改成商店价，而 getPriceSourceOf 看到 ask !== -1
 *    就判定为「市场真实成交价」，于是 14 件只能从商店买的基础装备被标成市价。
 *    现在来源在同一个函数里一次性确定，两处结果不可能再漂移。
 */
function resolveLevel0Price(hrid: string) {
  const cached = _priceResolutionCache[hrid]
  if (cached) {
    return cached
  }

  const item = getItemDetailOf(hrid)
  const fallback = isFallbackEnabled()
  const mode = useGameStoreOutside().priceFallbackMode

  // 特殊定价（牛铃按 10 个一包折算、金币恒 1）
  if (SPECIAL_PRICE[hrid]) {
    const special = SPECIAL_PRICE[hrid]()
    const result = { ask: special.ask, bid: special.bid, askSource: "market" as PriceSource, bidSource: "market" as PriceSource }
    _priceResolutionCache[hrid] = result
    return result
  }

  // 开包（loot）：按掉落表期望折算，视为市价
  if (isLoot(hrid) && hrid !== "/items/bag_of_10_cowbells") {
    const loot = getLootPrice(hrid)
    const result = { ask: loot.ask, bid: loot.bid, askSource: "market" as PriceSource, bidSource: "market" as PriceSource }
    _priceResolutionCache[hrid] = result
    return result
  }

  // 注意：必须拷贝，不能直接改 getMarketDataApi() 的冻结快照
  const market = getMarketDataApi().marketData[item.hrid]?.[0]
  let ask = market?.ask ?? -1
  let bid = market?.bid ?? -1
  let askSource: PriceSource = ask !== -1 ? "market" : "none"
  let bidSource: PriceSource = bid !== -1 ? "market" : "none"

  // 卖出端兜底：卖商店价真实可达，与买入端无关（B/C 模式）
  if (fallback && bid === -1 && (item.sellPrice ?? 0) > 0) {
    bid = item.sellPrice
    bidSource = "shop"
  }

  // 买入端：商店可金币购买时，取「市场价与商店价中更便宜的一个」
  const shopCost = shopCoinCostOf(hrid)
  if (shopCost >= 0 && (ask === -1 || shopCost < ask)) {
    ask = shopCost
    askSource = "shop"
  }

  // 买入端兜底：模式C 用大全套（自产）成本替代；模式B 保持 -1（买不到不虚报）
  if (fallback && ask === -1 && mode === "C") {
    const bigSetPrice = getBigSetPriceOf(item.hrid)
    if (bigSetPrice >= 0) {
      ask = bigSetPrice
      askSource = "selfcraft"
    }
  }

  const result = { ask, bid, askSource, bidSource }
  _priceResolutionCache[hrid] = result
  return result
}

function isFallbackEnabled() {
  return useGameStoreOutside().priceFallbackMode !== "A"
}

/**
 * 价格来源（运行时实时判定，随 marketData / 兜底模式动态变化，不写死任何物品）：
 * - market：市场有真实成交记录（含开包折算、特殊定价）
 * - shop：市场无记录，价格来自商店（卖出端 bid 用 sellPrice 兜底 或 买入端商店金币购买价）
 * - selfcraft：仅买入端(ask)：市场无记录，被大全套（自产）成本兜底（模式C）
 * - none：市场无记录、无商店价、不可自产 → -1（无价）
 */
export type PriceSource = "market" | "shop" | "selfcraft" | "none"

/** 该物品当前价格的真实来源（ask=买入端 / bid=卖出端）；用于 UI 标注「非真实市场价」的场景，杜绝把兜底价误当市价。 */
export function getPriceSourceOf(hrid: string, level: number = 0, type: "ask" | "bid" = "ask"): PriceSource {
  if (!hrid) {
    return "none"
  }
  const item = getItemDetailOf(hrid)
  if (level) {
    const priceItem = game.marketData?.marketData[hrid]?.[level]
    if (priceItem && (type === "bid" ? priceItem.bid !== -1 : priceItem.ask !== -1)) {
      return "market"
    }
    // 市场无该等级记录：卖出端用 sellPrice 兜底（B/C）；买入端模式C 用大全套（含炼金折算）兜底
    if (isFallbackEnabled()) {
      if (type === "ask" && useGameStoreOutside().priceFallbackMode === "C" && getBigSetPriceOf(item.hrid) >= 0) {
        return "selfcraft"
      }
      if ((item.sellPrice ?? 0) > 0) {
        return "shop"
      }
    }
    return "none"
  }
  if (SPECIAL_PRICE[hrid] || (isLoot(hrid) && hrid !== "/items/bag_of_10_cowbells")) {
    return "market"
  }
  // 与 getPriceOf 共用同一套解析结果，杜绝「价格取自商店、来源却标成市场」的漂移
  const resolved = resolveLevel0Price(hrid)
  return type === "bid" ? resolved.bidSource : resolved.askSource
}

/** 该物品当前是否正被兜底（价格来源非市场价）。方案A下恒为 false。 */
export function isPriceFallbackOf(hrid: string, level: number = 0): boolean {
  if (!isFallbackEnabled()) {
    return false
  }
  const source = getPriceSourceOf(hrid, level)
  return source === "shop" || source === "selfcraft"
}

// #region 大全套价格（模式C：市场无价物品用自产成本兜底）
function initBigSetCache() {
  _bigSetGatherableSet = new Set<string>()
  _bigSetPriceCache = {}
  _bigSetAlchemySourceMap = new Map()
  const actionMap = getGameDataApi().actionDetailMap
  Object.values(actionMap).forEach((action) => {
    if (GATHER_ACTION_PREFIXES.some(prefix => action.hrid.startsWith(prefix)) && action.dropTable) {
      action.dropTable.forEach((drop) => {
        _bigSetGatherableSet!.add(drop.itemHrid)
      })
    }
  })
  // 构建炼金自产反查表：转化（transmuteDropTable）与分解（decomposeItems）产出物 → 来源物品
  // 仅登记产出物 != 消耗物的条目（自身循环无兜底意义）；成功率取基础值（不含 buff/催化加成，偏保守）
  Object.values(getGameDataApi().itemDetailMap).forEach((item) => {
    const alch = item.alchemyDetail
    if (!alch) {
      return
    }
    if (alch.transmuteDropTable) {
      const successRate = Math.min(1, alch.transmuteSuccessRate ?? 1)
      alch.transmuteDropTable.forEach((drop: { itemHrid: string; minCount: number; maxCount: number; dropRate?: number }) => {
        if (drop.itemHrid === item.hrid) {
          return
        }
        const count = ((drop.maxCount ?? 1) - (drop.minCount ?? 0)) * (alch.bulkMultiplier ?? 1)
        const rate = drop.dropRate ?? 1
        if (count <= 0 || rate <= 0) {
          return
        }
        const arr = _bigSetAlchemySourceMap.get(drop.itemHrid) || []
        arr.push({ xHrid: item.hrid, count, rate, successRate })
        _bigSetAlchemySourceMap.set(drop.itemHrid, arr)
      })
    }
    if (alch.decomposeItems) {
      alch.decomposeItems.forEach((drop: { itemHrid: string; count: number }) => {
        if (drop.itemHrid === item.hrid) {
          return
        }
        const count = (drop.count ?? 1) * (alch.bulkMultiplier ?? 1)
        if (count <= 0) {
          return
        }
        const arr = _bigSetAlchemySourceMap.get(drop.itemHrid) || []
        arr.push({ xHrid: item.hrid, count, rate: 1, successRate: 0.6 })
        _bigSetAlchemySourceMap.set(drop.itemHrid, arr)
      })
    }
  })
}

/** 裸市场买入价（不走任何兜底），用于大全套递归中的原料外购判定 */
function rawMarketAskOf(hrid: string) {
  return getMarketDataApi().marketData[hrid]?.[0]?.ask ?? -1
}

/** 商店金币购买价；非金币购买或不可买返回 -1 */
function shopCoinCostOf(hrid: string) {
  const shopItem = getGameDataApi().shopItemDetailMap[`/shop_items/${hrid.split("/").pop()}`]
  if (shopItem && shopItem.costs[0].itemHrid === COIN_HRID) {
    return shopItem.costs[0].count
  }
  return -1
}

/**
 * 大全套（自产）价格：市场买不到时的买入端成本估值。
 * - 可采集 → 0（自己采，无成本）
 * - 可制造 → 各制造动作原料成本之和的最小值；原料按「可采集→0 / 市场有价→外购价 / 商店可买→商店价 / 否则递归自产」计算
 * - 不可采集也不可制造 → 商店可买则取商店价，否则 -1（纯掉落，自产不可行）
 * 结果带 memo 缓存；visited 防循环依赖。
 */
function getBigSetPriceOf(hrid: string, visited: Set<string> = new Set()): number {
  if (Object.prototype.hasOwnProperty.call(_bigSetPriceCache, hrid)) {
    return _bigSetPriceCache[hrid]
  }
  if (_bigSetGatherableSet!.has(hrid)) {
    _bigSetPriceCache[hrid] = 0
    return 0
  }
  if (visited.has(hrid)) {
    return Infinity
  }
  const key = hrid.split("/").pop()!
  let best = Infinity
  for (const project of BIG_SET_PROJECTS) {
    const action = getGameDataApi().actionDetailMap[`/actions/${project}/${key}`]
    if (!action) {
      continue
    }
    visited.add(hrid)
    let cost = 0
    let ok = true
    for (const ing of action.inputItems) {
      if (ing.itemHrid === COIN_HRID) {
        cost += ing.count
        continue
      }
      const rawAsk = rawMarketAskOf(ing.itemHrid)
      if (rawAsk > 0) {
        cost += rawAsk * ing.count
        continue
      }
      const shopCost = shopCoinCostOf(ing.itemHrid)
      if (shopCost >= 0) {
        cost += shopCost * ing.count
        continue
      }
      const sub = getBigSetPriceOf(ing.itemHrid, visited)
      if (sub < 0 || sub === Infinity) {
        ok = false
        break
      }
      cost += sub * ing.count
    }
    visited.delete(hrid)
    if (ok) {
      best = Math.min(best, cost)
    }
  }
  if (best !== Infinity) {
    _bigSetPriceCache[hrid] = best
    return _bigSetPriceCache[hrid]
  }
  // 不可采集、不可制造（或原料链断裂）时，尝试炼金自产折算（模式C）
  const alchBest = getBigSetAlchemyPriceOf(hrid, visited)
  if (alchBest >= 0) {
    _bigSetPriceCache[hrid] = alchBest
    return _bigSetPriceCache[hrid]
  }
  const shopCost = shopCoinCostOf(hrid)
  _bigSetPriceCache[hrid] = shopCost >= 0 ? shopCost : -1
  return _bigSetPriceCache[hrid]
}

/**
 * 炼金自产折算：由来源物品 X 经转化/分解产出该物时的原料成本估值。
 * 成本 = X 的大全套成本 / 期望产出（count × rate × 成功率）；多个来源取最小。
 * visited 与 getBigSetPriceOf 共享防环；缓存语义一致。
 */
function getBigSetAlchemyPriceOf(hrid: string, visited: Set<string>): number {
  const sources = _bigSetAlchemySourceMap.get(hrid)
  if (!sources?.length || visited.has(hrid)) {
    return -1
  }
  visited.add(hrid)
  let best = Infinity
  for (const src of sources) {
    const xPrice = getBigSetPriceOf(src.xHrid, visited)
    if (xPrice < 0 || xPrice === Infinity) {
      continue
    }
    const expected = src.count * src.rate * src.successRate
    if (expected <= 0) {
      continue
    }
    best = Math.min(best, xPrice / expected)
  }
  visited.delete(hrid)
  return best === Infinity ? -1 : best
}
// #endregion

function isLoot(hrid: string) {
  return getItemDetailOf(hrid).categoryHrid === "/item_categories/loot"
}

const _lootVisiting = new Set<string>()

function getLootPrice(hrid: string): MarketItemPrice {
  if (_lootVisiting.has(hrid)) {
    // 开包链成环（如 purples_gift 掉落表包含自身）时不再贡献，避免无限递归爆栈
    return { ask: 0, bid: 0 }
  }
  const drop = getGameDataApi().openableLootDropMap[hrid]
  _lootVisiting.add(hrid)
  const result = drop.reduce((acc, cur) => {
    const count = (cur.maxCount + cur.minCount) / 2
    const item = getPriceOf(cur.itemHrid)
    acc.ask += item.ask * count * cur.dropRate
    acc.bid += item.bid * count * cur.dropRate
    return acc
  }, { ask: 0, bid: 0 })
  _lootVisiting.delete(hrid)
  return result
}

export function getItemDetailOf(hrid: string) {
  let result = _itemDetailMapCache[hrid]
  if (!result) {
    result = getGameDataApi().itemDetailMap[hrid]
    result && (_itemDetailMapCache[hrid] = result)
  }
  return result
}

export function getActionDetailOf(key: string) {
  let result = _actionDetailMapCache[key]
  if (!result) {
    result = getGameDataApi().actionDetailMap[key]
    result && (_actionDetailMapCache[key] = result)
  }
  return result
}

export function getCommunityBuffDetailOf(hrid: string) {
  let result = _communityBuffTypeDetailMapCache[hrid]
  if (!result) {
    result = getGameDataApi().communityBuffTypeDetailMap[hrid]
    result && (_communityBuffTypeDetailMapCache[hrid] = result)
  }
  return result
}

export function getPersonalBuffDetailOf(hrid: string) {
  let result = _personalBuffTypeDetailMapCache[hrid]
  if (!result) {
    const map = getGameDataApi().personalBuffTypeDetailMap
    if (!map) {
      return undefined
    }
    result = map[hrid]
    result && (_personalBuffTypeDetailMapCache[hrid] = result)
  }
  return result
}

export function getTransmuteTimeCost() {
  return getActionDetailOf("/actions/alchemy/transmute").baseTimeCost
}

export function getDecomposeTimeCost() {
  return getActionDetailOf("/actions/alchemy/decompose").baseTimeCost
}

export function getCoinifyTimeCost() {
  return getActionDetailOf("/actions/alchemy/coinify").baseTimeCost
}

export function getEnhanceTimeCost() {
  return getActionDetailOf("/actions/enhancing/enhance").baseTimeCost
}

export function enhancementLevelSuccessRateTable() {
  return getGameDataApi().enhancementLevelSuccessRateTable
}

export function initProcessingProductMap() {
  _processingProductMap = {}
  game.gameData && Object.entries(game.gameData.actionDetailMap).forEach(([key, value]) => {
    if (key.match(/fabric$/) || key.match(/lumber$/) || key.match(/cheese$/)) {
      _processingProductMap[value.inputItems[0].itemHrid] = value.outputItems[0].itemHrid
    }
  })
  _processingProductMap["/items/rainbow_milk"] = "/items/rainbow_cheese"
}

export function getProcessingProduct(hrid: string) {
  return _processingProductMap[hrid]
}

// #region enhancelate
let enhancelateCache = {} as Record<string, EnhancelateResult>
export interface EnhancelateCacheParams {
  enhanceLevel: number
  protectLevel: number
  itemLevel: number
  originLevel: number
  escapeLevel: number
}
export function getEnhancelateCache(params: EnhancelateCacheParams) {
  return enhancelateCache[`${params.originLevel}-${params.enhanceLevel}-${params.protectLevel}-${params.itemLevel}-${params.escapeLevel}`]
}
export function setEnhancelateCache(params: EnhancelateCacheParams, result: EnhancelateResult) {
  enhancelateCache[`${params.originLevel}-${params.enhanceLevel}-${params.protectLevel}-${params.itemLevel}-${params.escapeLevel}`] = result
}
export function clearEnhancelateCache() {
  enhancelateCache = {}
}
// #region 游戏内代码
const TIMEVALUES = {
  SECOND: 1e9,
  MINUTE: 6e10,
  HOUR: 36e11,
  NANOSECONDS_IN_MILLISECOND: 1e6,
  NANOSECONDS_IN_SECOND: 1e9,
  SECONDS_IN_YEAR: 31536e3,
  SECONDS_IN_DAY: 86400,
  SECONDS_IN_HOUR: 3600,
  SECONDS_IN_MINUTE: 60
}

export function getAlchemyRareDropTable(item: ItemDetail, baseTimeCost: number): DropTableItem[] {
  let dropHrid = "/items/small_artisans_crate"
  const i = 1 * baseTimeCost / (8 * TIMEVALUES.HOUR)
  const itemLevel = item.itemLevel || 0
  let s = 0
  if (itemLevel < 35) {
    dropHrid = "/items/small_artisans_crate"
    s = (itemLevel + 100) / 100
  } else if (itemLevel < 70) {
    dropHrid = "/items/medium_artisans_crate"
    s = (itemLevel - 35 + 100) / 150
  } else {
    dropHrid = "/items/large_artisans_crate"
    s = (itemLevel - 70 + 100) / 200
  }
  return [{
    itemHrid: dropHrid,
    dropRate: i * s,
    minCount: 1,
    maxCount: 1
  }]
}

export function getAlchemyEssenceDropTable(item: ItemDetail, timeCost: number): DropTableItem[] {
  return [{
    itemHrid: "/items/alchemy_essence",
    dropRate: 1 * timeCost / (6 * TIMEVALUES.MINUTE) * (((item.itemLevel || 0) + 100) / 100),
    minCount: 1,
    maxCount: 1
  }]
}

// 分解强化物品
export function getAlchemyDecomposeEnhancingEssenceOutput(item: ItemDetail, enhancementLevel: number) {
  return enhancementLevel === 0
    ? 0
    : Math.round(2 * (0.5 + 0.1 * 1.05 ** (item.itemLevel || 0)) * 2 ** enhancementLevel)
}

export function getAlchemyDecomposeCoinCost(item: ItemDetail) {
  const itemLevel = item.itemLevel || 0
  return Math.floor(5 * (10 + itemLevel))
}

export function getEnhancingEssenceDropTable(item: ItemDetail, timeCost: number) {
  const a = 1 * timeCost / (2 * TIMEVALUES.MINUTE) * ((item.itemLevel + 100) / 100)
  return [{
    itemHrid: "/items/enhancing_essence",
    dropRate: a,
    minCount: 1,
    maxCount: 1
  }]
}

export function getEnhancingRareDropTable(item: ItemDetail, timeCost: number) {
  let dropHird = "/items/small_artisans_crate"
  const i = 1 * timeCost / (4 * TIMEVALUES.HOUR)
  let s = 0
  if (item.itemLevel < 35) {
    dropHird = "/items/small_artisans_crate"
    s = (item.itemLevel + 100) / 100
  } else if (item.itemLevel < 70) {
    dropHird = "/items/medium_artisans_crate"
    s = (item.itemLevel - 35 + 100) / 150
  } else {
    dropHird = "/items/large_artisans_crate"
    s = (item.itemLevel - 70 + 100) / 200
  }
  return [{
    itemHrid: dropHird,
    dropRate: i * s,
    minCount: 1,
    maxCount: 1
  }]
}

export function getEnhancementExp(item: ItemDetail, enhancementLevel: number) {
  return 1.4 * (1 + enhancementLevel) * (10 + item.itemLevel)
}

export function getCoinifyExp(item: ItemDetail) {
  return 1 * (10 + (item.itemLevel || 0))
}
export function getDecomposeExp(item: ItemDetail) {
  return 1.4 * (10 + item.itemLevel)
}
export function getTransmuteExp(item: ItemDetail) {
  return 1.6 * (10 + item.itemLevel)
}

// #endregion
