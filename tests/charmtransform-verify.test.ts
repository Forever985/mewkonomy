import { describe, expect, it, beforeAll } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("charmtransform 冲泡护符转化盈利验证", () => {
  beforeAll(() => {
    const root = process.cwd()
    const gameData = JSON.parse(readFileSync(resolve(root, "data/data.json"), "utf-8"))
    const marketRaw = JSON.parse(readFileSync(resolve(root, "data/market.json"), "utf-8"))
    const marketData: any = { timestamp: 0, marketData: {} }
    for (const hrid in gameData.itemDetailMap) {
      const name = gameData.itemDetailMap[hrid].name
      const price = marketRaw.market?.[name]
      if (price && typeof price.ask === "number" && typeof price.bid === "number") {
        marketData.marketData[hrid] = { 0: { ask: price.ask, bid: price.bid, price: price.ask, volume: 1 } }
      }
    }
    localStorage.setItem("game-game-data", JSON.stringify(gameData))
    localStorage.setItem("game-market-data", JSON.stringify(marketData))
  })

  it("返回 5 档且各档数值有效", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const rows = calcCharmTransformApi(2)
    expect(rows.length).toBe(5)
    for (const r of rows) {
      expect(r.valid).toBe(true)
      expect(r.essenceCost).toBeGreaterThan(0)
      expect(r.successRate).toBeGreaterThan(0)
      expect(r.successRate).toBeLessThanOrEqual(1)
      expect(Number.isFinite(r.profitActualPH)).toBe(true)
      expect(Number.isFinite(r.profitIdealPH)).toBe(true)
      expect(r.products.length).toBeGreaterThanOrEqual(10)
    }
    // 档位升级：所需精华递增
    const counts = rows.map(r => r.essenceCount)
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1])
  })

  it("理想利润 >= 实际利润（无流动性护符挂高价）", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const rows = calcCharmTransformApi(2)
    for (const r of rows) {
      expect(r.profitIdealPH).toBeGreaterThanOrEqual(r.profitActualPH - 1e-6)
      expect(r.incomeIdealPH).toBeGreaterThanOrEqual(r.incomeActualPH - 1e-6)
    }
  })

  it("产出明细：理想挂价 <= 精华成本上限，无流动性标记正确", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const rows = calcCharmTransformApi(2)
    for (const r of rows) {
      for (const p of r.products) {
        if (p.isIdeal && p.hrid.endsWith("_charm")) {
          // 无流动性护符 → 挂到「产出护符自身精华直接制作成本」上限
          expect(p.essenceCost).toBeGreaterThan(0)
          expect(p.bidIdeal).toBe(p.essenceCost)
          expect(p.bidActual).toBe(-1)
        } else if (!p.isIdeal) {
          expect(p.bidIdeal).toBe(p.bidActual)
        }
      }
    }
  })

  it("不同催化剂对成功率/利润有影响", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const r0 = calcCharmTransformApi(0)
    const r2 = calcCharmTransformApi(2)
    for (let i = 0; i < r0.length; i++) {
      expect(r2[i].successRate).toBeGreaterThanOrEqual(r0[i].successRate)
    }
  })

  it("左右价（买价/卖价）状态应影响计算结果", async () => {
    const { nextTick } = await import("vue")
    const { useGameStoreOutside, PriceStatus } = await import("@/pinia/stores/game")
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const store = useGameStoreOutside()
    // 默认 ASK/BID
    const base = calcCharmTransformApi(2)
    // 切到 左价低一档/右价高一档
    store.buyStatus = PriceStatus.ASK_LOW
    store.sellStatus = PriceStatus.BID_HIGH
    await nextTick()
    const changed = calcCharmTransformApi(2)
    let diffCount = 0
    for (let i = 0; i < base.length; i++) {
      if (base[i].profitActualPH !== changed[i].profitActualPH) diffCount++
    }
    // 复位
    store.buyStatus = PriceStatus.ASK
    store.sellStatus = PriceStatus.BID
    await nextTick()
    console.log("左右价切换后利润发生变化的档数：", diffCount, "/", base.length)
    expect(diffCount).toBeGreaterThan(0)
  })
})
