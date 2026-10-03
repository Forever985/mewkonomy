import type Calculator from "@/calculator"
import type { DecomposeCalculator } from "@/calculator/alchemy"
import type { EnhanceCalculator } from "@/calculator/enhance"
import type { ManufactureCalculator } from "@/calculator/manufacture"

import type { WorkflowCalculator } from "@/calculator/workflow"
import type { FallbackSide, PriceFallbackSettings } from "@/common/utils/price-fallback"
import type { Action, GameData, NoncombatStatsKey } from "~/game"
import type { Market, MarketData, MarketDataPlain, MarketItemPrice } from "~/market"
import { DEFAULT_PRICE_FALLBACK, migrateLegacyMode, normalizePriceFallback } from "@/common/utils/price-fallback"
import { defineStore } from "pinia"
import locales, { getTrans } from "@/locales"
import { pinia } from "@/pinia"

const { t } = locales.global

export const COIN_HRID = "/items/coin"

export const ACTION_LIST = [
  "milking",
  "foraging",
  "woodcutting",
  "cheesesmithing",
  "crafting",
  "tailoring",
  "cooking",
  "brewing",
  "alchemy",
  "enhancing"
] as const

export const EQUIPMENT_LIST = [
  "head",
  "body",
  "legs",
  "feet",
  "hands",

  "ring",
  "neck",
  "earrings",
  "back",
  "off_hand",
  "pouch",
  // 'main_hand'
  "charm"
] as const

export const COMMUNITY_BUFF_LIST = [
  "experience",
  "gathering_quantity",
  "production_efficiency",
  "enhancing_speed"
]

const DEFAULT_HOUSE = {
  Efficiency: 0.015,
  Experience: 0.0005,
  RareFind: 0.002
}
export const HOUSE_MAP: Record<Action, Partial<Record<NoncombatStatsKey, number>>> = {
  milking: { ...DEFAULT_HOUSE },
  foraging: { ...DEFAULT_HOUSE },
  woodcutting: { ...DEFAULT_HOUSE },
  cheesesmithing: { ...DEFAULT_HOUSE },
  crafting: { ...DEFAULT_HOUSE },
  tailoring: { ...DEFAULT_HOUSE },
  brewing: { ...DEFAULT_HOUSE },
  cooking: { ...DEFAULT_HOUSE },
  alchemy: { ...DEFAULT_HOUSE },
  enhancing: {
    Speed: 0.01,
    Success: 0.0005,
    Experience: 0.0005,
    RareFind: 0.002
  }
}

export enum PriceStatus {
  // 左价（挂单最低价，买入即成交口径）
  ASK = "ASK",
  // 比左价低一档
  ASK_LOW = "ASK_LOW",
  // 比左价高一档
  ASK_HIGH = "ASK_HIGH",
  // 右价（收购最高价，卖出即成交口径）
  BID = "BID",
  // 比右价低一档
  BID_LOW = "BID_LOW",
  // 比右价高一档
  BID_HIGH = "BID_HIGH"
}

/**
 * 价格口径下拉的选项。
 *
 * 排列顺序：同一种报价内**按价格由低到高**（`-` → 原价 → `+`），两种报价各成一组。
 * 这样下拉展开后「档位方向」一眼可见，不用逐个读后缀。
 *
 * 新增档位时同步处只有两处：这里的列表、以及 `common/apis/game/index.ts` 的
 * `STATUS_STEP_SPEC`——后者是 `Record<PriceStatus, ...>`，漏改会被类型检查拦下。
 */
export const PRICE_STATUS_LIST = [
  { value: PriceStatus.ASK_LOW, label: `${getTrans("左价")}-` },
  { value: PriceStatus.ASK, label: getTrans("左价") },
  { value: PriceStatus.ASK_HIGH, label: `${getTrans("左价")}+` },
  { value: PriceStatus.BID_LOW, label: `${getTrans("右价")}-` },
  { value: PriceStatus.BID, label: getTrans("右价") },
  { value: PriceStatus.BID_HIGH, label: `${getTrans("右价")}+` }
]

export const useGameStore = defineStore("game", {
  state: () => ({
    gameData: getGameData(),
    marketData: getMarketData(),
    leaderboardCache: {} as { [time: number]: Calculator[] },
    manualchemyCache: {} as { [time: number]: Calculator[] },
    jungleCache: {} as { [key: string]: WorkflowCalculator[] },
    /** 计算模式签名缓存：modeKey → { signature, list }，签名不符即视为未命中（见 getModeCache 注释） */
    modeCache: {} as { [key: string]: { signature: string; list: Calculator[] } },
    junglestCache: {} as { [time: number]: EnhanceCalculator[] },
    inheritCache: {} as { [time: number]: ManufactureCalculator[] },
    decomposeCache: {} as { [time: number]: DecomposeCalculator[] },
    secret: loadSecret(),
    buyStatus: loadBuyStatus(),
    sellStatus: loadSellStatus(),
    priceFallback: loadPriceFallback()
  }),
  actions: {
    async tryFetchData() {
      let retryCount = 5
      let success = false
      while (retryCount--) {
        try {
          await this.fetchData(retryCount)
          success = true
          break
        } catch (e) {
          console.error(`获取数据第${5 - retryCount}次失败`, e)
          ElMessage.error(t("获取数据第{0}次失败，正在重试...", [5 - retryCount]))
        }
      }
      // 全部请求均失败：若有本地缓存则回退使用，避免主界面因外部数据源不可达而无法挂载
      if (!success) {
        if (this.gameData && this.marketData) {
          ElMessage.error(t("数据获取失败，直接使用缓存数据"))
          return
        }
        ElMessage.error(t("数据获取失败，请检查网络连接"))
        throw new Error("强制宕机")
      }
    },
    async fetchData(offset: number) {
      // 如果数据time晚于30min前，无需更新，减少流量
      // if (this.gameData && this.marketData && this.marketData.timestamp * 1000 > Date.now() - 1000 * 60 * 30) {
      //   return
      // }
      const url = import.meta.env.MODE === "development" ? "/" : "./"
      const MARKET_URLS = [
        // "https://mooket.qi-e.top/market/api.json",
        "https://www.milkywayidle.com/game_data/marketplace.json"
      ]
      // const LAST_MARKET_URL = `${url}data/market.json`
      const DATA_URL = `${url}data/data.json`
      const marketUrl = MARKET_URLS[(4 - offset) % MARKET_URLS.length]

      // 外部数据源请求设置超时，避免网络挂起时阻塞主界面挂载
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      try {
        const response = await Promise.all([
          fetch(DATA_URL, { signal: controller.signal }),
          fetch(marketUrl, { signal: controller.signal })
        ])
        if (!response[0].ok || !response[1].ok) {
          throw new Error("Response not ok")
        }
        const newGameData = await response[0].json()
        const newMarketData = await response[1].json()
        // 如果有缓存数据，则不更新gameData，防止国际化数据被覆
        if (!this.gameData) {
          this.gameData = newGameData
        }
        setGameData(newGameData)

        // 如果缓存数据的时间戳与新数据相同，则不更新
        if (this.marketData?.timestamp && this.marketData?.timestamp === newMarketData.timestamp) {
          return
        }

        this.marketData = updateMarketData(this.marketData, newMarketData, newGameData)
        this.clearAllCaches()
      } finally {
        clearTimeout(timeoutId)
      }
    },

    savePriceStatus() {
      // saveBuyStatus(this.buyStatus)
      // saveSellStatus(this.sellStatus)
      this.clearAllCaches()
    },
    /** 整份设置替换（左右两侧 + 强制大全套） */
    setPriceFallback(settings: PriceFallbackSettings) {
      this.priceFallback = settings
      savePriceFallback(settings)
      // 检索类缓存要清；价格缓存的 key 含设置签名，会自然 miss，不依赖清缓存时机
      this.clearAllCaches()
    },
    /** 只改单侧 —— 左右解耦，UI 上就是两个独立控件 */
    setPriceFallbackSide(side: "ask" | "bid", patch: Partial<FallbackSide>) {
      this.setPriceFallback({
        ...this.priceFallback,
        [side]: { ...this.priceFallback[side], ...patch }
      })
    },
    setPriceFallbackForceBigSet(force: boolean) {
      this.setPriceFallback({ ...this.priceFallback, forceBigSet: force })
    },
    resetPriceStatus() {
      this.buyStatus = loadBuyStatus()
      this.sellStatus = loadSellStatus()
    },
    getLeaderboardCache() {
      return this.leaderboardCache[this.marketData!.timestamp]
    },
    setLeaderBoardCache(list: Calculator[]) {
      this.clearLeaderBoardCache()
      this.leaderboardCache[this.marketData!.timestamp] = list
    },
    clearLeaderBoardCache() {
      this.leaderboardCache = {}
    },
    /**
     * 强化分解缓存：保留对外方法名（页面/clearAllCaches 均在用），
     * 内部改用模式签名缓存（modeCache），确保 noDecompose / 价格口径切换后必然重算。
     */
    clearEnhanposerCache() {
      this.clearModeCache("enhanposer")
    },
    getManualchemyCache() {
      return this.manualchemyCache[this.marketData!.timestamp]
    },
    setManualchemyCache(list: Calculator[]) {
      this.clearManualchemyCache()
      this.manualchemyCache[this.marketData!.timestamp] = list
    },
    clearManualchemyCache() {
      this.manualchemyCache = {}
    },
    getJungleCache(key: string) {
      return this.jungleCache[key]
    },
    setJungleCache(list: WorkflowCalculator[], key: string) {
      this.jungleCache[key] = list
    },
    clearJungleCache(key?: string) {
      if (key) {
        delete this.jungleCache[key]
      } else {
        this.jungleCache = {}
      }
    },
    /**
     * 计算模式签名缓存（用于按 key 分桶的页内模式参数）
     *
     * 背景：`jungleCache` 按 key 分桶只能区分「不同页面」，无法区分「同一页面的不同计算模式」。
     * 例如 enhanposer 的 `noDecompose` / `materialPriceType` / `productPriceType`、
     * junglerit 的 `noEscape`：切换后若仍命中同一桶，就会读到按旧模式算出的结果。
     * 这里把「模式签名」与结果一起存，读取时签名不一致即视为未命中（自动重算）。
     */
    getModeCache<T extends Calculator = Calculator>(modeKey: string, signature: string): T[] | undefined {
      const entry = this.modeCache[modeKey]
      if (!entry || entry.signature !== signature) {
        return undefined
      }
      return entry.list as T[]
    },
    setModeCache(modeKey: string, signature: string, list: Calculator[]) {
      this.modeCache[modeKey] = { signature, list }
    },
    clearModeCache(modeKey?: string) {
      if (modeKey) {
        delete this.modeCache[modeKey]
      } else {
        this.modeCache = {}
      }
    },
    getJunglestCache() {
      return this.junglestCache[this.marketData!.timestamp]
    },
    setJunglestCache(list: EnhanceCalculator[]) {
      this.clearJunglestCache()
      this.junglestCache[this.marketData!.timestamp] = list
    },
    clearJunglestCache() {
      this.junglestCache = {}
    },
    getInheritCache() {
      return this.inheritCache[this.marketData!.timestamp]
    },
    setInheritCache(list: ManufactureCalculator[]) {
      this.clearInheritCache()
      this.inheritCache[this.marketData!.timestamp] = list
    },
    clearInheritCache() {
      this.inheritCache = {}
    },
    getDecomposeCache() {
      return this.decomposeCache[this.marketData!.timestamp]
    },
    setDecomposeCache(list: DecomposeCalculator[]) {
      this.clearDecomposeCache()
      this.decomposeCache[this.marketData!.timestamp] = list
    },
    clearDecomposeCache() {
      this.decomposeCache = {}
    },
    setSecret(value: string) {
      this.secret = value
      saveSecret(value)
    },
    checkSecret() {
      return true
      // return import.meta.env.VITE_BUILD_MODE === "private"
    },

    clearAllCaches() {
      this.clearLeaderBoardCache()
      this.clearManualchemyCache()
      this.clearInheritCache()
      this.clearDecomposeCache()
      this.clearEnhanposerCache()
      this.clearJungleCache()
      this.clearJunglestCache()
      this.clearModeCache()
    }
  }
})

function updateMarketData(oldData: MarketData | null, newData: MarketDataPlain, newGameData: GameData): MarketData {
  const oldMarket = oldData?.marketData || {}
  const newMarket: Market = { }

  // 将 MarketDataPlain 转成 MarketData 的结构（保留官方 price/volume 字段用于贸易量监控）
  for (const hrid in newData.marketData) {
    if (newData.marketData[hrid]) {
      newMarket[hrid] = {}
    }
    for (const level in newData.marketData[hrid]) {
      const raw = newData.marketData[hrid][level]
      newMarket[hrid][level] = {
        ask: raw.a ?? -1,
        bid: raw.b ?? -1,
        price: raw.p ?? -1,
        volume: raw.v ?? 0
      }
    }
  }

  // 取得name->isEquipment的映射
  const itemDetailMap = newGameData.itemDetailMap
  const isEquipmentMap: Record<string, boolean> = {}
  for (const key in itemDetailMap) {
    const item = itemDetailMap[key]
    isEquipmentMap[item.hrid] = item.categoryHrid === "/item_categories/equipment"
  }
  for (const hrid in newMarket) {
    // 如果是装备，则不保留旧值
    if (isEquipmentMap[hrid] || oldMarket[hrid]) {
      continue
    }
    for (const level in newMarket[hrid]) {
      const price = newMarket[hrid][level]
      if (price.ask === -1) {
        price.ask = (oldMarket[hrid]?.[level] as MarketItemPrice)?.ask || -1
      }
      if (price.bid === -1) {
        price.bid = (oldMarket[hrid]?.[level] as MarketItemPrice)?.bid || -1
      }
      if (!price.volume) {
        price.volume = (oldMarket[hrid]?.[level] as MarketItemPrice)?.volume || 0
      }
    }
  }

  // 有些物品可能是oldMarket有的，newMarket没有的
  // for (const key in oldMarket) {
  //   if (!newMarket[key] && !isEquipmentMap[key]) {
  //     newMarket[key] = JSON.parse(JSON.stringify(oldMarket[key]))
  //   }
  // }

  const result = {
    timestamp: newData.timestamp,
    marketData: newMarket
  }
  setMarketData(result)

  return result
}

const KEY_PREFIX = "game-"

function getMarketData() {
  const raw = localStorage.getItem(`${KEY_PREFIX}market-data`)
  if (!raw) {
    return null
  }
  const data = JSON.parse(raw) as MarketData | null
  // 旧版缓存结构只有 ask/bid，缺少 price/volume（贸易量监控依赖字段），
  // 判定为过期缓存，清除后由 fetchData 重新拉取官方 marketplace.json 补全。
  if (data && !hasVolumeField(data.marketData)) {
    localStorage.removeItem(`${KEY_PREFIX}market-data`)
    return null
  }
  return data
}

function hasVolumeField(market: Market): boolean {
  // 新版 updateMarketData 必定为每条报价写出 number 类型的 volume 字段，旧版缓存则整份都没有。
  // 注意必须「遍历到找到为止」：原实现把 return 写在循环体内，实际只检查了第一个物品的第一个档位，
  // 一旦该条目恰好缺 volume，就会把整份新缓存误判为过期并清除（每次进入页面都要重拉一次市场数据）。
  for (const hrid in market) {
    for (const level in market[hrid]) {
      const p = market[hrid][level] as MarketItemPrice
      if (typeof p.volume === "number") {
        return true
      }
    }
  }
  return false
}
function setMarketData(value: MarketData) {
  localStorage.setItem(`${KEY_PREFIX}market-data`, JSON.stringify(value))
}

function getGameData() {
  return JSON.parse(localStorage.getItem(`${KEY_PREFIX}game-data`) || "null") as GameData | null
}
function setGameData(value: GameData) {
  localStorage.setItem(`${KEY_PREFIX}game-data`, JSON.stringify(value))
}

function loadSecret() {
  return localStorage.getItem(`${KEY_PREFIX}secrete`) || ""
}

function saveSecret(value: string) {
  localStorage.setItem(`${KEY_PREFIX}secrete`, value)
}

function loadBuyStatus() {
  return PriceStatus.ASK
}
function loadSellStatus() {
  return PriceStatus.BID
}

/**
 * 读取兜底设置。
 *
 * 迁移：旧版是 A/B/C 三档（一个枚举同时控制左右两侧）。这里把用户**当年显式选过**的档位
 * 映射成最接近的新配置，**不擅自改他的意图**；从没设置过的走新默认链（借另一端 → 大全套）。
 * 旧 key 保留不删，万一要回退还能用。
 */
function loadPriceFallback(): PriceFallbackSettings {
  const raw = localStorage.getItem(`${KEY_PREFIX}price-fallback`)
  if (raw) {
    try {
      return normalizePriceFallback(JSON.parse(raw))
    } catch {
      // 落库数据被手改坏时退回默认，不让整个应用起不来
    }
  }
  const legacy = localStorage.getItem(`${KEY_PREFIX}price-fallback-mode`)
  if (legacy === "A" || legacy === "B" || legacy === "C") {
    return migrateLegacyMode(legacy)
  }
  return {
    ask: { ...DEFAULT_PRICE_FALLBACK.ask },
    bid: { ...DEFAULT_PRICE_FALLBACK.bid },
    forceBigSet: false
  }
}
function savePriceFallback(settings: PriceFallbackSettings) {
  localStorage.setItem(`${KEY_PREFIX}price-fallback`, JSON.stringify(settings))
}

export function useGameStoreOutside() {
  return useGameStore(pinia)
}
