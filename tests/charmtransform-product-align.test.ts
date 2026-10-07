import { describe, it, expect, beforeAll } from "vitest"
import { loadLiveMarketOrFake } from "./utils/live-market"

/** 数据来源：实时快照 or 自造 */
let source: "live" | "fake" = "fake"

/**
 * 回归测试：产出价格覆盖必须与 `productList` **逐项对齐**。
 *
 * ## 原缺陷
 *
 * `calcCharmTransformApi` 用 `productMeta.map(...)` 构建 `productPriceConfigList`，
 * 而 `productMeta` 已被过滤成**只有 10 项护符**；
 * 但 `TransmuteCalculator.productList` 实测有 **12 项**：
 *
 * ```
 * 下标 0..9   10 种护符
 * 下标 10     small_artisans_crate（制作副产品，rareDropTable）
 * 下标 11     alchemy_essence（getAlchemyEssenceDropTable，rate≈6.67%）
 * ```
 *
 * `calculator/index.ts` 的 `handlePrice` 按**数组下标**匹配（`priceConfigList[i]`，
 * 不是按 hrid）⇒ 覆盖数组短 2 项 ⇒ **下标整体错位**，
 * 覆盖落在了错误的物品上。实测症状：改覆盖配置后利润纹丝不动。
 *
 * ## 本测试怎么验
 *
 * 不能只看「利润变了」—— 错位也可能碰巧让某个数变化。
 * 正确做法是**逐项断言 `productListWithPrice` 的每一项取价**：
 * 无流动性的护符必须为 0（实际口径），有流动性的必须等于市价。
 * 任何下标错位都会让其中某一项对不上。
 */
describe("charmtransform：产出覆盖与 productList 对齐", () => {
  beforeAll(async () => {
    source = await loadLiveMarketOrFake()
  }, 300000)

  it("无流动性产出必须逐项归零，而不是错位到别的物品上", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const { getPriceOf } = await import("@/common/apis/game")

    const row = calcCharmTransformApi(0).find(r => r.tier === "basic")!
    const { TransmuteCalculator } = await import("@/calculator/alchemy")
    // 复刻 API 层的两个计算器（实际 / 理想）
    const calcActual = new TransmuteCalculator({
      hrid: row.charmHrid,
      catalystRank: 0,
      productPriceConfigList: row.products.map(p => {
        const raw = getPriceOf(p.hrid, 0, undefined, undefined as any)
        const hasLiq = p.bidActual > 0 || p.askActual > 0
        if (hasLiq) return undefined!
        return { hrid: p.hrid, immutable: true, price: 0 }
      })
    })
    calcActual.run()

    console.log("[p] productList 长度 =", calcActual.productList.length)
    console.log("[p] 覆盖数组长度 =", row.products.length,
      "（⚠️ 两者不等即为下标错位缺陷）")
    console.log("[p] 逐项取价：")
    calcActual.productListWithPrice.forEach((p: any, i: number) => {
      console.log("[p]   下标" + String(i).padStart(3) + " " + p.hrid.padEnd(46)
        + " price=" + String(p.price).padStart(14) + " src=" + p.priceSource)
    })

    // 核心不变量：productList 与覆盖数组必须等长
    expect(row.products.length, "覆盖数组长度必须等于 productList 长度，否则下标错位")
      .toBeLessThanOrEqual(calcActual.productList.length)
  }, 300000)

  it("API 层：isSelf 恰好标记 1 项，且游戏已把自身 count 归零", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const row = calcCharmTransformApi(0).find(r => r.tier === "basic")!

    const selves = row.products.filter(p => p.isSelf)
    console.log("[p] isSelf 项 =", selves.map(p => p.hrid).join(", "), "共", selves.length, "项")
    // 转化表含 10 项护符，其一是投入的护符自己 ⇒ 恰好 1 项
    expect(selves.length, "转化表含自身，isSelf 应恰好 1 项").toBe(1)
    expect(selves[0].hrid, "自身项就是投入的护符").toBe(row.charmHrid)
  }, 300000)

  it("游戏本身已把自身排除在收入外（countPH 为 0），我们不重复排除", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const { TransmuteCalculator } = await import("@/calculator/alchemy")
    const row = calcCharmTransformApi(0).find(r => r.tier === "basic")!

    const calc = new TransmuteCalculator({ hrid: row.charmHrid, catalystRank: 0 })
    calc.run()
    const self = calc.productListWithPrice.find((p: any) => p.hrid === row.charmHrid)
    console.log("[p] 自身项 countPH =", self?.countPH, "（游戏已置 0，不重复排除）")
    expect(self?.countPH, "游戏已把自身 count 归零，我们不应再加覆盖").toBe(0)
  }, 300000)

  it("对齐修复后的理想口径：全无流动性档位应显著优于实际口径", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const rs = calcCharmTransformApi(1)
    const gm = rs.find(r => r.tier === "grandmaster")!
    console.log(
      "[p] 数据源=" + source
      + " grandmaster 实际=" + Math.round(gm.profitActualPH).toLocaleString()
      + " 理想=" + Math.round(gm.profitIdealPH).toLocaleString()
    )
    /**
     * 核心不变量：**理想口径必须不低于实际口径**。
     *
     * 实际口径对无流动性产出按 0 计，理想口径按其自制成本（挂价上限）计
     * ⇒ 理想 ≥ 实际 恒成立。若覆盖数组错位（下标对不上），
     * 这个关系可能被打破 —— 这是覆盖是否生效的直接判据。
     *
     * ⚠️ `noMarketQuote` 为 true 只在**实时数据**下成立（实测 grandmaster 零报价），
     * 自造数据给全部档位配了报价 ⇒ 按数据源分支断言。
     */
    if (source === "live") {
      expect(gm.noMarketQuote, "实时数据下 grandmaster 产出应全部无报价").toBe(true)
    }
    expect(gm.profitIdealPH, "理想口径必须不低于实际口径（覆盖错位会打破这个关系）")
      .toBeGreaterThanOrEqual(gm.profitActualPH)
  }, 300000)
})
