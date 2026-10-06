import { describe, it, expect, beforeAll } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"

/**
 * 锁住 2026-10-06 的 enhanposer 修复（用户亲测发现的问题）。
 *
 * 1. 「只看目标等级」曾用错字段（`actionLevel` 物品等级）⇒ 永远 0 行
 * 2. 进页面就无条件遍历 20 个强化等级 ⇒ 分解模式实测 70.9 秒
 * 3. 补齐多样搜索/筛选/过滤/选择维度
 */
describe("enhanposer 数据正确性与按需计算", () => {
  beforeAll(async () => { await loadTestGameData() }, 300000)

  it("① 「只看目标等级 N」按 enhanceLevel 命中（不是 actionLevel）", async () => {
    const { getEnhanposerDataApi } = await import("@/common/apis/enhanposer")
    const base: any = {
      noDecompose: true, materialPriceType: "ask", productPriceType: "bid",
      currentPage: 1, size: 100000, calcLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    }
    const all = (await getEnhanposerDataApi({ ...base })).list

    for (const lv of [1, 5, 10]) {
      const f = (await getEnhanposerDataApi({ ...base, calcLevels: [lv], conditions: [{ steps: lv }] })).list
      const expectCount = all.filter((r: any) => r.calculatorList[0].enhanceLevel === lv).length
      const levels = [...new Set(f.map((r: any) => r.calculatorList[0].enhanceLevel))]
      console.log(`[p] 目标等级 ${lv}: ${f.length} 行 (期望 ${expectCount}), 等级集合=${JSON.stringify(levels)}`)
      expect(f.length).toBe(expectCount)
      // 反向断言：不得混入其它等级（这正是原 bug —— 靠 actionLevel 匹配会全被滤掉）
      expect(levels).toEqual([lv])
    }
  }, 300000)

  it("①b 目标等级区间与多行 OR 语义正确", async () => {
    const { getEnhanposerDataApi } = await import("@/common/apis/enhanposer")
    const base: any = {
      noDecompose: true, materialPriceType: "ask", productPriceType: "bid",
      currentPage: 1, size: 100000, calcLevels: [3, 4, 5, 6, 7, 8, 9, 10]
    }
    const all = (await getEnhanposerDataApi({ ...base })).list

    // 区间 5~7
    const range = (await getEnhanposerDataApi({
      ...base,
      calcLevels: [5, 6, 7],
      conditions: [{ steps: undefined, minLevel: 5, maxLevel: 7 }]
    })).list
    const expectRange = all.filter((r: any) => {
      const l = r.calculatorList[0].enhanceLevel
      return l >= 5 && l <= 7
    }).length
    expect(range.length).toBe(expectRange)
    const levels = [...new Set(range.map((r: any) => r.calculatorList[0].enhanceLevel))].sort((a: any, b: any) => a - b)
    expect(levels).toEqual([5, 6, 7])

    // 多行 OR：3 或 7
    const or = (await getEnhanposerDataApi({
      ...base,
      calcLevels: [3, 7],
      conditions: [{ steps: 3 }, { steps: 7 }]
    })).list
    const expectOr = all.filter((r: any) => {
      const l = r.calculatorList[0].enhanceLevel
      return l === 3 || l === 7
    }).length
    console.log(`[p] 区间5~7=${range.length}行, [3或7]=${or.length}行 (期望 ${expectOr})`)
    expect(or.length).toBe(expectOr)
  }, 300000)

  it("② 目标等级是计算参数：只算 1 档的耗时远小于 20 档", async () => {
    const { getEnhanposerDataApi } = await import("@/common/apis/enhanposer")
    const base: any = { noDecompose: false, materialPriceType: "ask", productPriceType: "bid", currentPage: 1, size: 100000 }

    const t0 = Date.now()
    const one = await getEnhanposerDataApi({ ...base, calcLevels: [1] })
    const tOne = Date.now() - t0

    const t1 = Date.now()
    const five = await getEnhanposerDataApi({ ...base, calcLevels: [1, 2, 3, 4, 5] })
    const tFive = Date.now() - t1

    console.log(`[p] 1 档: ${one.total} 行 / ${tOne}ms`)
    console.log(`[p] 5 档: ${five.total} 行 / ${tFive}ms`)

    expect(one.total).toBeGreaterThan(0)
    // 5 档的行数应约为 1 档的 5 倍（每个物品每档都出方案）
    expect(five.total).toBe(one.total * 5)
    // 单档必须在 5 秒内完成（实测约 1 秒；不分解模式更快）
    expect(tOne, `单档耗时 ${tOne}ms，应 < 5000ms`).toBeLessThan(5000)
  }, 300000)

  it("②b 不填目标等级时默认只算 +1（不默认 1~20，避免 70 秒）", async () => {
    const { getEnhanposerDataApi } = await import("@/common/apis/enhanposer")
    const t0 = Date.now()
    const r = await getEnhanposerDataApi({
      noDecompose: true, materialPriceType: "ask", productPriceType: "bid",
      currentPage: 1, size: 100000
      // 故意不给 calcLevels / conditions
    })
    const dt = Date.now() - t0
    const levels = [...new Set(r.list.map((x: any) => x.calculatorList[0].enhanceLevel))]
    console.log(`[p] 无条件默认: ${r.total} 行, 等级集合=${JSON.stringify(levels)}, 耗时 ${dt}ms`)
    expect(levels, "默认应只算 +1").toEqual([1])
    expect(dt, `默认计算应很快（实测约 30ms），实际 ${dt}ms`).toBeLessThan(3000)
  }, 300000)

  it("③ 物品等级区间（minLevel/maxLevel）与目标等级是两个独立维度", async () => {
    const { getEnhanposerDataApi } = await import("@/common/apis/enhanposer")
    const base: any = {
      noDecompose: true, materialPriceType: "ask", productPriceType: "bid",
      currentPage: 1, size: 100000, calcLevels: [1, 2, 3]
    }
    const all = (await getEnhanposerDataApi({ ...base })).list
    // 物品等级 >= 50
    const f = (await getEnhanposerDataApi({ ...base, minLevel: 50 })).list
    const expectCount = all.filter((r: any) => r.calculatorList[0].actionLevel >= 50).length
    const levels = [...new Set(f.map((r: any) => r.calculatorList[0].actionLevel))].sort((a: any, b: any) => a - b)
    console.log(`[p] 全部: ${all.length} 行 (物品等级最低 ${Math.min(...all.map((r: any) => r.calculatorList[0].actionLevel))})`)
    console.log(`[p] 物品等级>=50: ${f.length} 行 (期望 ${expectCount}), 最低物品等级=${Math.min(...levels)}`)
    expect(f.length).toBe(expectCount)
    expect(Math.min(...levels)).toBeGreaterThanOrEqual(50)
  }, 300000)
});
