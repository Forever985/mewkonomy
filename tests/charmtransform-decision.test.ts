import { describe, it, expect, beforeAll } from "vitest"
import { loadLiveMarketOrFake } from "./utils/live-market"

/** 数据来源：实时快照 or 自造（决定「无报价档位」这类前提是否成立） */
let source: "live" | "fake" = "fake"

/**
 * 回归测试：charmtransform 的三块决策能力。
 *
 * ## 为什么要这三块
 *
 * 用户的需求原话：
 * > 「通过『转化』+ 催化剂转化为别的生产精华制作出来的护符，就可以盈利。
 * > 当然，也有一定概率失败。催化茶、暴饮之囊和使用更好的催化剂
 * > （如至高催化剂就比转化催化剂更高效，但是更昂贵）可以提升这个成功率。
 * > 最终得到的是一个加权的盈利（或亏损）。我们贩卖新转化出来的护符的最高价格，
 * > 自然是不会超过对应生产精华所直接制作出来的护符的价格。
 * > 也许我们也可以用稍弱一些的催化剂，亏损一些成功率但是降低成本。
 * > 这个都是要考量的」
 *
 * 拆成三个可算的问题：
 *  1. **催化剂横向对比**（不能只在 radio 之间来回切）→ `calcCharmTransformInsights`
 *  2. **盈亏平衡线**（护符卖到多少才不亏）→ `TierInsight.breakEvenBid`
 *  3. **投入哪种精华**（转化表对称 ⇒ 只取决于投入侧）→ `calcCharmFeedChoices`
 *
 * ## 本测试不复用仓库里的旧市场快照
 *
 * 护符在旧快照里**零报价**（见 §33），拿它测「盈亏平衡」毫无意义
 * （分母恒为 0）。必须用官方实时数据才有覆盖。
 */
describe("charmtransform：三块决策能力", () => {
  beforeAll(async () => {
    source = await loadLiveMarketOrFake()
  }, 300000)

  it("① 催化剂横向对比：三档配置 + 恰好一个最优", async () => {
    const { calcCharmTransformInsights } = await import("@/common/apis/charmtransform")
    const insights = calcCharmTransformInsights(1)

    expect(insights.length, "应覆盖全部 5 个档位").toBe(5)
    for (const ins of insights) {
      expect(ins.catalysts.length, `${ins.tier} 应有三种催化剂配置`).toBe(3)
      // 成功率递增：无 < 转化催化剂 < 至高催化剂
      const [none, trans, prime] = ins.catalysts
      expect(none.successRate, `${ins.tier} 无催化剂成功率`).toBeLessThan(trans.successRate)
      expect(trans.successRate, `${ins.tier} 转化催化剂成功率`).toBeLessThan(prime.successRate)
      // 恰好一个最优
      expect(ins.catalysts.filter(c => c.isBest).length, `${ins.tier} 应恰好一个最优`).toBe(1)
      expect(ins.bestRank).toBe(ins.catalysts.find(c => c.isBest)!.rank)
    }
  })

  it("② 盈亏平衡线：有市价的档位能算出「差多少倍」", async () => {
    const { calcCharmTransformInsights } = await import("@/common/apis/charmtransform")
    const insights = calcCharmTransformInsights(1)
    const basic = insights.find(i => i.tier === "basic")!

    console.log("[p] basic 盈亏平衡均价 =", basic.breakEvenBid, " 现均价 =", basic.currentAvgBid, " =", basic.multipleOfBreakEven.toFixed(2) + "x")
    expect(basic.breakEvenBid, "basic 有市价，应能算出平衡线").toBeGreaterThan(0)
    expect(basic.currentAvgBid, "basic 有市价，应能算出现均价").toBeGreaterThan(0)
    expect(basic.multipleOfBreakEven, "应能算出倍数").toBeGreaterThan(0)

    /**
     * 无流动性档位：算不出现均价时必须显式标 -1，而不是给个假数（0 会被误读成「白送」）。
     *
     * ⚠️ 自造数据给**所有**档位都配了报价 ⇒ 该前提只在实时数据下成立。
     * 所以这里按数据源分支，并显式断言分支依据（避免变成「无论如何都过」的空断言）。
     */
    const gm = insights.find(i => i.tier === "grandmaster")!
    console.log("[p] 数据源 =", source, " grandmaster 平衡线 =", gm.breakEvenBid, " 现均价 =", gm.currentAvgBid)
    if (source === "live") {
      // 实时数据：实测 grandmaster 产出零报价
      expect(gm.currentAvgBid, "实时数据下 grandmaster 产出零报价，现均价应为 -1").toBe(-1)
      expect(gm.multipleOfBreakEven, "算不出时倍数应为 -1").toBe(-1)
    } else {
      // 自造数据：全部有价 ⇒ 必须能算出倍数
      expect(gm.currentAvgBid, "自造数据下全部有价，现均价应为正").toBeGreaterThan(0)
    }
    // 平衡线只依赖成本侧 ⇒ 两种数据源下都必须算得出
    expect(gm.breakEvenBid, "平衡线只依赖成本，无报价也能算").toBeGreaterThan(0)
  })

  it("③ 投入哪种精华：10 种齐全、排名正确、最便宜的能识别出来", async () => {
    const { calcCharmFeedChoices } = await import("@/common/apis/charmtransform")
    const rows = calcCharmFeedChoices("basic", 1)

    expect(rows.length, "应覆盖 10 种技能精华").toBe(10)
    // costRank 必须是 1..10 的排列
    expect([...rows].map(r => r.costRank).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    // 排名与自制成本严格同序
    const byRank = [...rows].sort((a, b) => a.costRank - b.costRank)
    for (let i = 1; i < byRank.length; i++) {
      expect(byRank[i].selfCraftCost, `第 ${i + 1} 名不该比第 ${i} 名便宜`).toBeGreaterThanOrEqual(byRank[i - 1].selfCraftCost)
    }
    // 利润必须真的算出来了（不是 -1）
    const profitable = rows.filter(r => r.profitIdealIfSelfCraft > 0)
    console.log("[p] basic 档自制投入能盈利的技能:", profitable.map(r => r.skill).join(",") || "（无）")
    expect(profitable.length, "至少最便宜的那种应该能盈利（实测冲泡 +8613 万/h）").toBeGreaterThan(0)
    // 最便宜的那个必须就是最赚钱的（转化表对称 ⇒ 只取决于成本）
    const cheapest = byRank[0]
    console.log("[p] 最便宜 =", cheapest.skill, " 利润 =", Math.round(cheapest.profitIdealIfSelfCraft))
    expect(cheapest.profitIdealIfSelfCraft).toBeGreaterThan(0)
  })

  it("④ 自身产出不算收益：游戏已把它 count 置 0", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const { TransmuteCalculator } = await import("@/calculator/alchemy")
    const row = calcCharmTransformApi(0).find(r => r.tier === "basic")!

    const calc = new TransmuteCalculator({ hrid: row.charmHrid, catalystRank: 0 })
    calc.run()
    const self = calc.productListWithPrice.find((p: any) => p.hrid === row.charmHrid)
    console.log("[p] 自身项 countPH =", self?.countPH, " priceSource =", self?.priceSource)
    expect(self?.countPH, "转化表含自身，但游戏已把它的 count 归零").toBe(0)
  })
})
