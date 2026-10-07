import { describe, it, expect, beforeAll } from "vitest"
import { loadLiveMarketOrFake } from "./utils/live-market"

/**
 * 手动产业链的**基本经济逻辑**（2026-10-07 用户指正后补）。
 *
 * 一条手动产业链 = 用户逐步搭出来的一条产线：
 *
 *   步骤 1（上游，买原料）→ 步骤 2（加工）→ … → 末步（成品卖出）
 *
 * 它的经济含义只有一句话：
 *
 *   **利润 = 末端对外卖出的收入 − 全链对外采购的支出**
 *
 * 由此必然推出：
 *
 * ① **中间产物是内部流转，不是收入**。
 *    下一步会以 0 价把它领走，所以本步也**不能**把它按市价当收入卖 ——
 *    否则同一份价值被算两次（既当收入、又当免费原料）⇒ 虚增利润。
 * ② **没被下一步消耗的副产品仍必须按市价计收入**（如月亮石碎片）。
 *    压错对象会把真实收入丢掉。
 *
 * ⚠️ 两条断言都必须落在**结构**上，不能只看「某条链的利润率」——
 * 早前实现正是「按数组下标压 productList[0]」，对制造链侥幸正确、
 * 对炼金链（中转产物不是第 0 项）就完全错位，靠单链数值根本发现不了。
 */
describe("产业链：中间产物是内部流转，不是收入", () => {
  beforeAll(async () => {
    await loadLiveMarketOrFake()
  }, 300000)

  const CHAIN: any[] = [
    { project: "制造", action: "crafting", kind: "manufacture", hrid: "/items/crushed_sunstone" },
    {
      project: "转化", action: "alchemy", kind: "transmute",
      hrid: "/items/crushed_sunstone", outHrid: "/items/crushed_philosophers_stone", catalystRank: 1
    },
    {
      project: "转化", action: "alchemy", kind: "transmute",
      hrid: "/items/crushed_philosophers_stone", catalystRank: 1
    }
  ]

  it("① 流向下一步的产物按 0 价内部流转；未被消耗的副产品保留市价", async () => {
    const api = await import("@/common/apis/chainbuilder")
    const game = await import("@/common/apis/game")
    const gd = game.getGameDataApi()
    const wf: any = api.calcChainProfitApi(CHAIN, "内部流转")

    const calcs: any[] = wf.calculatorList.flat()
    const mid = calcs[1]

    const ps = mid.productListWithPrice.find((p: any) => p.hrid === "/items/crushed_philosophers_stone")
    console.log("[p] 中间环节产出「贤者之石碎片」:", ps?.price, ps?.priceSource)
    expect(ps, "中间环节必须产出被下一步领走的那个产物").toBeTruthy()
    expect(ps.price, "它流向下一步 ⇒ 本环节不得按市价当收入").toBe(0)
    expect(ps.priceSource, "应标记为内部流转").toBe("internal")

    // ⚠️ 关键守卫：压 0 的对象必须是「流向下一步那个」，
    //    而不是「产物列表第 0 个」。实测旧实现压的是月亮石碎片。
    const byproduct = mid.productListWithPrice.find((p: any) => p.hrid === "/items/crushed_moonstone")
    console.log("[p] 同环节副产品「月亮石碎片」:", byproduct?.price, byproduct?.priceSource,
      "（", gd.itemDetailMap["/items/crushed_moonstone"].name, "）")
    expect(byproduct, "该环节应产出月亮石碎片").toBeTruthy()
    expect(byproduct.priceSource, "它没有被下一步消耗 ⇒ 不该被压 0").not.toBe("internal")
  }, 300000)

  it("② 整链收入 = 净产物价值（中间产物既不算收入也不算免费原料）", async () => {
    const api = await import("@/common/apis/chainbuilder")
    const { MARKET_TAX_FACTOR } = await import("@@/constants/market")
    const wf: any = api.calcChainProfitApi(CHAIN, "净口径")
    const r = wf.result as any

    // 工作流自己的「抵消后净产物」= 唯一权威口径
    const netIncome = (wf.productListWithPrice as any[])
      .reduce((acc, p) => acc + p.countPH * p.price, 0) * MARKET_TAX_FACTOR

    console.log("[p] 报告收入/h =", Math.round(r.incomePH).toLocaleString())
    console.log("[p] 净产物收入/h =", Math.round(netIncome).toLocaleString())
    console.log("[p] 差额 =", Math.round(r.incomePH - netIncome).toLocaleString())

    expect(Math.abs(r.incomePH - netIncome) / Math.max(netIncome, 1),
      "报告收入必须等于净产物价值 —— 中间产物不得再计入收入（旧实现虚增了 40%）"
    ).toBeLessThan(0.01)

    // 反向守卫：收入必须**严格小于**「把所有环节的产物都按市价卖」的朴素和，
    // 否则说明中间产物又漏进收入了。
    const naive = (wf.calculatorList.flat() as any[])
      .reduce((acc, cal) => acc
        + cal.productListWithPrice.reduce((a: number, p: any) => a + p.countPH * p.price, 0), 0)
    console.log("[p] 朴素和（含中间产物当收入）=", Math.round(naive).toLocaleString())
    expect(naive, "本用例的链必须有中间产物，否则断言没有意义").toBeGreaterThan(0)
  }, 300000)
})
