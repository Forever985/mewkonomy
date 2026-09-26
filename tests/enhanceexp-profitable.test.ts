import { describe, expect, it, beforeAll } from "vitest"
import { loadTestGameData, seedGameData } from "./utils/load-game-data"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * 强化练级（enhanceexp）的「仅看赚钱方案」筛选。
 *
 * 本页的「赚钱」有明确定义：**净成本 = 总成本 − 成品售价 ≤ 0**，即强化完卖掉反而赚、
 * 经验白拿（EnhanceExpResult.netCost / profitable）。它与 `Calculator.profitable`
 * （强化利润 maxProfitApproximate > 0）不是一回事。
 *
 * 夹具注意：公共 `loadTestGameData()` 只给每件物品种了 **level 0** 的价格，
 * 而本页要求 0 级本体有买价、并且要能算出强化到 1~20 级的成品售价，
 * 所以这里额外把强化等级的报价也补上（否则整页恒为 0 行，测不出任何东西）。
 */
async function seedEnhancedPrices() {
  const root = process.cwd()
  const gameData = JSON.parse(readFileSync(resolve(root, "public/data/data.json"), "utf-8"))
  const { useGameStoreOutside } = await import("@/pinia/stores/game")
  const store = useGameStoreOutside()
  const marketData = JSON.parse(JSON.stringify(store.marketData))
  let added = 0
  for (const hrid of Object.keys(marketData.marketData)) {
    const item = gameData.itemDetailMap[hrid]
    if (!item?.enhancementCosts) {
      continue
    }
    const base = marketData.marketData[hrid]["0"]
    if (!base || !(base.ask > 0)) {
      continue
    }
    for (let level = 1; level <= 20; level++) {
      const ask = Math.round(base.ask * (1 + 0.35 * level))
      marketData.marketData[hrid][String(level)] = { ask, bid: Math.round(ask * 0.9) }
      added++
    }
  }
  await seedGameData(gameData, marketData)
  store.clearAllCaches()
  return added
}

describe("enhanceexp 仅看赚钱方案", () => {
  beforeAll(async () => {
    await loadTestGameData()
    const added = await seedEnhancedPrices()
    // eslint-disable-next-line no-console
    console.log(`补种的强化等级报价条数=${added}`)
  }, 300000)

  async function fetchAll(extra: Record<string, unknown> = {}) {
    const { getEnhanceExpDataApi } = await import("@/common/apis/enhanceexp")
    const res: any = await getEnhanceExpDataApi({
      size: 100000,
      currentPage: 1,
      materialPriceType: "ask",
      productPriceType: "bid",
      conditions: [],
      name: [],
      ...extra
    })
    return res.list as any[]
  }

  it("勾选 onlyProfitable 后只返回净成本 <= 0 的方案", async () => {
    const all = await fetchAll()
    const r = (x: any) => x.result ?? x
    const expProfit = all.filter(x => r(x).profitable)
    const profit = await fetchAll({ onlyProfitable: true })
    // eslint-disable-next-line no-console
    console.log(
      `全部=${all.length} 赚钱=${expProfit.length} 筛选后=${profit.length}`
      + ` 误留=${profit.filter(x => r(x).netCost > 0).length}`
    )
    expect(all.length).toBeGreaterThan(0)
    expect(expProfit.length).toBeGreaterThan(0)
    // 关键断言：筛选结果条数必须等于「净成本<=0」的条数，且没有纯消耗方案漏进来
    expect(profit.length).toBe(expProfit.length)
    expect(profit.filter(x => r(x).netCost > 0)).toEqual([])
    expect(profit.every(x => r(x).profitable)).toBe(true)
  }, 300000)

  it("筛选外的其它条件不受影响（等级区间 + 仅看赚钱 可叠加）", async () => {
    const r = (x: any) => x.result ?? x
    const both = await fetchAll({
      onlyProfitable: true,
      conditions: [{ steps: undefined, minLevel: 5, maxLevel: 5 }]
    })
    // eslint-disable-next-line no-console
    console.log(`仅等级5且赚钱=${both.length}`)
    expect(both.every(x => r(x).enhanceLevel === 5)).toBe(true)
    expect(both.every(x => r(x).profitable)).toBe(true)
  }, 300000)
})
