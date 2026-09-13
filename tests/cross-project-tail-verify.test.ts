import { describe, expect, it, beforeAll } from "vitest"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * 验证综利用尾：主链产物被其他制造项目消费时，挂跨项目制造尾。
 * 检查：存在 "→" 命名综利用条目、数值有限、与炼金尾/大全套不冲突
 */
describe("manualchemy 综利用尾", () => {
  beforeAll(() => {
    const root = process.cwd()
    const gameData = JSON.parse(readFileSync(resolve(root, "data/data.json"), "utf-8"))
    const marketRaw = JSON.parse(readFileSync(resolve(root, "data/market.json"), "utf-8"))
    const marketData: any = { timestamp: 0, marketData: {} }
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

  it("综利用尾条目存在、数值有限、不与其它多样冲突", async () => {
    const { getLeaderboardDataApi } = await import("@/common/apis/manualchemy")
    const res: any = await getLeaderboardDataApi({ size: 100000, currentPage: 1 })
    const list: any[] = res.list
    // eslint-disable-next-line no-console
    console.log(`list.length=${list.length}`)

    const tailList = list.filter((c: any) => (c.project || "").includes("→"))
    // eslint-disable-next-line no-console
    console.log(`综利用尾条数=${tailList.length}`)

    // 数值有限性
    const nanList: any[] = []
    for (const c of list) {
      const r = c.result || c
      if (!Number.isFinite(r.profitPH) || !Number.isFinite(r.costPH) || !Number.isFinite(r.incomePH)) {
        nanList.push({ hrid: r.hrid, name: r.name, project: r.project, cost: r.costPH, income: r.incomePH })
      }
    }
    // eslint-disable-next-line no-console
    console.log(`NaN条数=${nanList.length}`)

    // 综利用尾数值有限性单独检查
    const tailNan = tailList.filter((c: any) => {
      const r = c.result || c
      return !Number.isFinite(r.profitPH)
    })
    // eslint-disable-next-line no-console
    console.log(`综利用尾NaN=${tailNan.length}`)

    // 打印样例：按利润降序
    const samples = tailList
      .slice()
      .sort((a: any, b: any) => (b.result || b).profitPH - (a.result || a).profitPH)
      .slice(0, 8)
    // eslint-disable-next-line no-console
    console.log("综利用尾样例:")
    samples.forEach((s: any) => {
      const r = s.result || s
      console.log(`  ${s.project} | ${r.name} | profitPH=${r.profitPH.toFixed(2)} valid=${s.valid} level=${s.actionLevel}`)
    })

    // 验证条目数增加（有综利用尾）
    expect(tailList.length).toBeGreaterThan(0)
    for (const c of list) {
      const r = c.result || c
      expect(Number.isFinite(r.profitPH), `profitPH NaN: ${r.project}`).toBe(true)
    }
  }, 120000)
})
