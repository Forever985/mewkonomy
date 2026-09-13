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
  console.log("raw marketData changed")
  const data = Object.freeze(structuredClone(toRaw(useGameStoreOutside().marketData)))
  game.marketData = data
  _priceCache = {}
  _bigSetPriceCache = {}
}, { immediate: true })

watch([() => useGameStoreOutside().buyStatus, () => useGameStoreOutside().sellStatus], () => {
  _priceCache = {}
}, { immediate: true })

watch(() => useGameStoreOutside().priceFallbackMode, () => {
  _priceCache = {}
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

function convertPriceOfStatus(price: MarketItemPrice, buyStatus: PriceStatus, sellStatus: PriceStatus) {
  function convert(status: PriceStatus) {
    const result = { price: -1 }
    switch (status) {
      case PriceStatus.ASK:
        result.price = price.ask
        break
      case PriceStatus.BID:
        result.price = price.bid
        break
      case PriceStatus.ASK_LOW:
        result.price = price.ask
        if (result.price > 0) {
          result.price = priceStepOf(result.price, false)
        }
        break
      case PriceStatus.BID_HIGH:
        result.price = price.bid
        if (result.price > 0) {
          result.price = priceStepOf(result.price, true)
        }
        break
    }
    return result
  }

  return {
    ask: convert(buyStatus).price,
    bid: convert(sellStatus).price
  }
}

const priceStep = [
  [0, 1],
  [50, 2],
  [100, 5],
  [300, 10]
  // [500,20],
  // [1000,50]
  // ...
]
/**
 * 举例：
 * priceStepOf(300,true) = 310
 * priceStepOf(300,false) = 295
 * priceStepOf(1000,true) = 1050
 * priceStepOf(1000,false) = 980
 * priceStepOf(100000,true) = 105000
 * priceStepOf(100000,false) = 98000
 * @param price 原价
 * @param high true加价, false减价
 */
function priceStepOf(price: number, high: boolean = true) {
  if (price <= 0) {
    return -1
  }
  // 先将price按十进制转为0~300的范围
  let dec = 0
  while (price > 300) {
    price /= 10
    dec += 1
  }
  // 找到对应的step和stepIndex
  let highStepIndex = 0
  let lowStepIndex = 0
  for (let i = 0; i < priceStep.length; i++) {
    if (price <= priceStep[i][0]) {
      highStepIndex = lowStepIndex = i - 1
      if (price === priceStep[i][0]) {
        highStepIndex = i
      }
      break
    }
  }
  return high ? (price + priceStep[highStepIndex][1]) * 10 ** dec : (price - priceStep[lowStepIndex][1]) * 10 ** dec
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
    if (isFallbackEnabled() && !marketItem && price.ask === -1 && price.bid === -1) {
      if ((item.sellPrice ?? 0) > 0) {
        price.bid = item.sellPrice
      }
      if (useGameStoreOutside().priceFallbackMode === "C") {
        const bigSetPrice = getBigSetPriceOf(item.hrid)
        if (bigSetPrice >= 0) {
          price.ask = bigSetPrice
        }
      }
    }
    return convertPriceOfStatus(price, buyStatus, sellStatus)
  }

  // 缓存 key 含价格模式与买卖状态：切换模式/状态后即使 watch 异步清缓存，也不会命中旧值
  const cacheKey = `${hrid}|${useGameStoreOutside().priceFallbackMode}|${buyStatus}|${sellStatus}`
  if (_priceCache[cacheKey]) {
    return _priceCache[cacheKey]
  }
  if (SPECIAL_PRICE[hrid]) {
    _priceCache[cacheKey] = SPECIAL_PRICE[hrid]()
    return _priceCache[cacheKey]
  }
  if (isLoot(hrid) && hrid !== "/items/bag_of_10_cowbells") {
    _priceCache[cacheKey] = getLootPrice(hrid)
    return _priceCache[cacheKey]
  }
  const shopItem = getGameDataApi().shopItemDetailMap[`/shop_items/${item.hrid.split("/").pop()}`]
  const price = (getMarketDataApi().marketData[item.hrid]?.[0]) || { ask: -1, bid: -1 }

  if (shopItem && shopItem.costs[0].itemHrid === COIN_HRID) {
    price.ask = price.ask === -1 ? shopItem.costs[0].count : Math.min(price.ask, shopItem.costs[0].count)
  }
  // 市场无买卖价（如披风/稀有掉落装备无交易记录）时兜底：
  // - 卖出端(bid)：卖商店价(sellPrice)真实可达，始终保底（B/C 模式）
  // - 买入端(ask)：模式C 用大全套（自产）成本替代；模式B 保持 -1（买不到不虚报）
  if (isFallbackEnabled() && price.ask === -1 && price.bid === -1) {
    if ((item.sellPrice ?? 0) > 0) {
      price.bid = item.sellPrice
    }
    if (useGameStoreOutside().priceFallbackMode === "C") {
      const bigSetPrice = getBigSetPriceOf(item.hrid)
      if (bigSetPrice >= 0) {
        price.ask = bigSetPrice
      }
    }
  }
  _priceCache[cacheKey] = convertPriceOfStatus(price, buyStatus, sellStatus)

  return _priceCache[cacheKey]
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
  if (SPECIAL_PRICE[hrid]) {
    return "market"
  }
  if (isLoot(hrid) && hrid !== "/items/bag_of_10_cowbells") {
    return "market"
  }
  const marketPrice = getMarketDataApi().marketData[item.hrid]?.[0]
  const ask = marketPrice?.ask ?? -1
  const bid = marketPrice?.bid ?? -1
  if (type === "bid") {
    if (bid !== -1) {
      return "market"
    }
    // 卖出端兜底：仅 sellPrice（B/C），无自产成本兜底
    return isFallbackEnabled() && (item.sellPrice ?? 0) > 0 ? "shop" : "none"
  }
  if (ask !== -1 || bid !== -1) {
    // 商店金币价更便宜且 getPriceOf 实际取用商店价时，按商店价标注
    const shopCost = shopCoinCostOf(hrid)
    if (ask !== -1 && shopCost >= 0 && shopCost < ask) {
      return "shop"
    }
    return "market"
  }
  // 市场无记录：走兜底
  if (isFallbackEnabled()) {
    if (useGameStoreOutside().priceFallbackMode === "C" && getBigSetPriceOf(item.hrid) >= 0) {
      return "selfcraft"
    }
    if ((item.sellPrice ?? 0) > 0) {
      return "shop"
    }
  }
  return "none"
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
  let s = 0
  if (item.itemLevel < 35) {
    dropHrid = "/items/small_artisans_crate"
    s = (item.itemLevel + 100) / 100
  } else if (item.itemLevel < 70) {
    dropHrid = "/items/medium_artisans_crate"
    s = (item.itemLevel - 35 + 100) / 150
  } else {
    dropHrid = "/items/large_artisans_crate"
    s = (item.itemLevel - 70 + 100) / 200
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
    dropRate: 1 * timeCost / (6 * TIMEVALUES.MINUTE) * ((item.itemLevel + 100) / 100),
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
  return 1 * (10 + item.itemLevel)
}
export function getDecomposeExp(item: ItemDetail) {
  return 1.4 * (10 + item.itemLevel)
}
export function getTransmuteExp(item: ItemDetail) {
  return 1.6 * (10 + item.itemLevel)
}

// #endregion
