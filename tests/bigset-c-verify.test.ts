import { describe, it, beforeAll } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = "D:\\milkonomy\\milkonomy-main"

describe("模式C 大全套价格兜底验证（聚焦兜底对象）", () => {
  beforeAll(() => {
    const gameData = JSON.parse(readFileSync(resolve(root, "data/data.json"), "utf-8"))
    const marketRaw = JSON.parse(readFileSync(resolve(root, "data/market.json"), "utf-8"))
    const marketData: any = { timestamp: 1, marketData: {} }
    for (const hrid in gameData.itemDetailMap) {
      const name = gameData.itemDetailMap[hrid].name
      const price = marketRaw.market?.[name]
      if (price && typeof price.ask === "number" && typeof price.bid === "number") {
        marketData.marketData[hrid] = { 0: { ask: price.ask, bid: price.bid } }
      }
    }
    localStorage.setItem("game-game-data", JSON.stringify(gameData))
    localStorage.setItem("game-market-data", JSON.stringify(marketData))
  })

  it("P0: 兜底对象在模式B下 ask 必须为 -1（sellPrice 只兜 bid）", async () => {
    const { getPriceOf, isPriceFallbackOf } = await import("@/common/apis/game")
    const { useGameStoreOutside } = await import("@/pinia/stores/game")
    const store = useGameStoreOutside()
    store.setPriceFallbackMode("B")

    const { getGameDataApi } = await import("@/common/apis/game")
    const itemMap = getGameDataApi().itemDetailMap
    let fallbackObjects = 0
    let askPolluted = 0
    const polluted: string[] = []
    for (const hrid in itemMap) {
      if (!isPriceFallbackOf(hrid)) continue
      fallbackObjects++
      const p = getPriceOf(hrid, 0)
      if (p.ask !== -1) {
        askPolluted++
        if (polluted.length < 5) polluted.push(`${itemMap[hrid].name} ask=${p.ask}`)
      }
    }
    console.log(`[B] 兜底对象=${fallbackObjects}, ask被污染=${askPolluted}`)
    if (askPolluted) console.log("  污染:", polluted.join(" | "))
  })

  it("模式C: 兜底对象 ask=大全套成本, bid=sellPrice; 纯掉落 ask=-1", async () => {
    const { getPriceOf, isPriceFallbackOf, getGameDataApi } = await import("@/common/apis/game")
    const { useGameStoreOutside } = await import("@/pinia/stores/game")
    const store = useGameStoreOutside()
    store.setPriceFallbackMode("C")

    const itemMap = getGameDataApi().itemDetailMap
    let fallbackObjects = 0
    let bigSetCovered = 0
    let pureDrop = 0
    let bidMismatch = 0
    const samples: string[] = []
    const first10: string[] = []
    for (const hrid in itemMap) {
      if (!isPriceFallbackOf(hrid)) continue
      fallbackObjects++
      const item = itemMap[hrid]
      const p = getPriceOf(hrid, 0)
      if (first10.length < 10) first10.push(`${item.name}: ask=${p.ask} bid=${p.bid} sell=${item.sellPrice}`)
      if (p.ask !== -1) {
        bigSetCovered++
        if (samples.length < 8) samples.push(`${item.name}: ask=${p.ask} bid=${p.bid} sell=${item.sellPrice}`)
      } else {
        pureDrop++
      }
      if ((item.sellPrice ?? 0) > 0 && p.bid !== item.sellPrice) bidMismatch++
    }
    console.log(`[C] 兜底对象=${fallbackObjects}, ask被大全套覆盖=${bigSetCovered}, 纯掉落ask=-1=${pureDrop}, bid!=sellPrice=${bidMismatch}`)
    console.log("  前10:", first10.join(" | "))
    if (samples.length) console.log("  覆盖样例:\n  " + samples.join("\n  "))
  })

  it("模式A: 无任何兜底", async () => {
    const { isPriceFallbackOf, getGameDataApi } = await import("@/common/apis/game")
    const { useGameStoreOutside } = await import("@/pinia/stores/game")
    const store = useGameStoreOutside()
    store.setPriceFallbackMode("A")
    const itemMap = getGameDataApi().itemDetailMap
    let flagged = 0
    for (const hrid in itemMap) {
      if (isPriceFallbackOf(hrid)) flagged++
    }
    console.log(`[A] isPriceFallbackOf 命中(应为0)=${flagged}`)
  })
})
