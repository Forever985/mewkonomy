import { describe, it, expect, beforeAll } from "vitest"
import { loadTestGameData, seedGameData } from "./utils/load-game-data"

/**
 * 回归测试：charmtransform 的投入成本必须**走买卖价轮子**。
 *
 * ## 原缺陷
 *
 * `calcCharmTransformApi` 曾传
 *   `ingredientPriceConfigList: [{ hrid: charmHrid, immutable: true, price: essenceCost }]`
 * 把投入价硬编码成自制成本。而 `calculator/index.ts` 的 `handlePrice`
 * 会用它**覆盖** `ingredientList[0]`（护符本身）的取价，
 * 默认取价本来是 `getPriceOf(hrid).ask`
 * ⇒ **轮子被旁路**，页面上的「买价」下拉对护符成本项完全没有作用。
 *
 * ⚠️ 缺陷的表现很隐蔽：`handlePrice` 是**按数组下标**覆盖的，而
 * `TransmuteCalculator.ingredientList` 结构是 `[护符, 催化剂?, ...茶]`，
 * 催化剂与茶仍走 `getPriceOf().ask`
 * ⇒ **整体 `costPH` 依然会随买价口径变化**，只看总数会误判为「轮子正常」。
 *
 * ## 本测试为什么自造市场数据
 *
 * 官方实时快照里 basic/advanced/expert 有市价、master/grandmaster 没有；
 * 仓库快照里护符可能全部无报价。依赖任一份都会让测试在换数据后悄悄失效
 * （我第一版就踩了这个坑：挑了无市价的档位，回退源码后测试仍然全绿）。
 *
 * 所以这里**显式注入**一份最小市价：给五档冲泡护符都造 ask/bid，
 * 且**刻意让市价 ≠ 自制成本**，这样「护符项被写死」必然表现为数值对不上。
 *
 * ## 铁律（写在这里防止后来者重犯）
 *
 * 1. **不要加「字段缺失就 fallback 到别处取」的兜底** ——
 *    我加过一次，结果回退源码后测试全绿（假绿灯），缺陷被吞掉。
 * 2. **断言必须精确到「护符那一项」**，不能只看 `costPH` 合计。
 * 3. **数据前提要显式断言**（市价 ≠ 自制成本），否则换个数据就假通过。
 */

/** 造一份市价：与自制成本刻意不同，便于区分「取到了市价」还是「被写死成自制」 */
function buildFakeMarket(charmHrids: string[], essencePrice: number) {
  const md: Record<string, Record<string, { ask: number, bid: number, volume: number }>> = {}
  // 冲泡精华给一个明确价格，`getBigSetPriceOf` 算自产成本时才有确定基数
  md["/items/brewing_essence"] = { 0: { ask: essencePrice, bid: essencePrice, volume: 10 } }
  for (const hrid of charmHrids) {
    md[hrid] = { 0: { ask: 777, bid: 555, volume: 10 } }
  }

  /**
   * 催化剂与茶也必须给价。
   *
   * `Calculator.valid` 的判定是「**所有**投入项 `price !== -1`」
   * ⇒ 只造护符的价会让 `valid === false`，测试挂在无关的原因上。
   * 顺带这也是 §31 的教训：断言要落在**目标缺陷**上，
   * 否则会被别的失效条件掩盖。
   *
   * 取价来源是 `getTeaIngredientList`（玩家冲泡配置）与 `this.catalyst`，
   * 这里按它们实际会用到的 hrid 逐个补齐。
   */
  for (const hrid of [
    "/items/catalyst_of_transmutation",
    "/items/prime_catalyst",
    "/items/catalyst_of_decomposition",
    "/items/catalyst_of_coinification",
    "/items/wisdom_tea",
    "/items/efficiency_tea",
    "/items/catalytic_tea",
    "/items/alchemy_tea"
  ]) {
    md[hrid] = { 0: { ask: 1000, bid: 900, volume: 10 } }
  }
  return { timestamp: 1, marketData: md }
}

describe("charmtransform：投入成本走买卖价轮子", () => {
  beforeAll(async () => {
    await loadTestGameData()
    const { useGameStoreOutside } = await import("@/pinia/stores/game")
    const gameData = useGameStoreOutside().gameData

    // 五档冲泡护符：市价统一给 777（ask）/ 555（bid）。
    // ⚠️ 777 是刻意选的「不像任何自制成本」的值 —— 若护符项最终等于 777，
    //    说明真的走了轮子；若等于自制成本（= 10000×精华价 等），说明被写死。
    await seedGameData(gameData, buildFakeMarket([
      "/items/basic_brewing_charm",
      "/items/advanced_brewing_charm",
      "/items/expert_brewing_charm",
      "/items/master_brewing_charm",
      "/items/grandmaster_brewing_charm"
    ], 286))
  }, 300000)

  /**
   * 数据前提：三档市价存在，且**市价 ≠ 自制成本**。
   *
   * 不断言这条，测试就会在「市价恰好等于自制成本」的数据上假通过。
   */
  async function assertPreconditions() {
    const { getMarketDataApi } = await import("@/common/apis/game")
    const md = getMarketDataApi().marketData
    for (const t of ["basic", "advanced", "expert", "master", "grandmaster"]) {
      const l0 = md[`/items/${t}_brewing_charm`]?.[0]
      expect(l0?.ask, `${t}_brewing_charm 应有市价`).toBe(777)
      expect(l0?.bid, `${t}_brewing_charm 应有右价`).toBe(555)
    }
    // 自制成本 = 10000 × 286 = 2,860,000 ≫ 777，两者必须不同
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const { useGameStoreOutside, PriceStatus } = await import("@/pinia/stores/game")
    const game = useGameStoreOutside()
    game.buyStatus = PriceStatus.ASK
    game.sellStatus = PriceStatus.BID
    await new Promise(r => setTimeout(r, 10))
    const basic = calcCharmTransformApi(0).find(r => r.tier === "basic")!
    expect(basic.essenceCost, "自制成本参考值应可算出").toBeGreaterThan(0)
    expect(basic.essenceCost, "前提：市价(777) 必须与自制成本不同，否则本测试无区分力")
      .not.toBe(777)
    return { tier: "basic" as const, charmHrid: "/items/basic_brewing_charm" }
  }

  /**
   * 核心断言：**投入护符本身**那一项的价格必须随买价口径变化。
   *
   * ⚠️ 必须精确到「护符那一项」：`costPH` 合计在修复前也会变
   * （催化剂与茶仍走轮子），只看合计是假绿灯。
   */
  it("投入护符本身那一项的价格必须随买价口径变化（原缺陷点）", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const { getPriceOf } = await import("@/common/apis/game")
    const { useGameStoreOutside, PriceStatus } = await import("@/pinia/stores/game")
    const game = useGameStoreOutside()

    const { tier, charmHrid } = await assertPreconditions()

    /** 该档投入护符那一项的取价 —— 只从 API 层取，不加任何兜底 */
    async function ingredientPriceOf(status: (typeof PriceStatus)[keyof typeof PriceStatus]) {
      game.buyStatus = status
      game.sellStatus = PriceStatus.BID
      // currentBuyStatus 是模块级快照，靠 watch 同步 —— 必须等一拍
      await new Promise(r => setTimeout(r, 10))
      const row = calcCharmTransformApi(1).find(r => r.tier === tier)!
      const ing = row.ingredientListWithPrice.find((i: any) => i.hrid === charmHrid)
      return { ing, expected: getPriceOf(charmHrid).ask, row }
    }

    const a = await ingredientPriceOf(PriceStatus.ASK)
    const hi = await ingredientPriceOf(PriceStatus.ASK_HIGH)
    const lo = await ingredientPriceOf(PriceStatus.ASK_LOW)

    console.log(
      "[p] " + tier + " 护符项取价: ASK=" + a.ing?.price
      + " ASK_HIGH=" + hi.ing?.price
      + " ASK_LOW=" + lo.ing?.price
      + "（自制成本参考 =", a.row.essenceCost, "）"
    )

    expect(a.ing, "投入列表里必须能找到护符本身").toBeTruthy()
    expect(a.ing!.price, "护符项取价必须等于 getPriceOf 的结果（修复前被写死为 essenceCost）")
      .toBe(a.expected)
    expect(hi.ing!.price, "抬一档买价应抬高护符项取价").toBeGreaterThan(a.ing!.price)
    expect(lo.ing!.price, "压一档买价应压低护符项取价").toBeLessThan(a.ing!.price)
    expect(new Set([a.ing!.price, hi.ing!.price, lo.ing!.price]).size,
      "三种买价口径应给出三种不同的护符项取价；若恒相同说明覆盖仍在旁路轮子。"
    ).toBe(3)
  }, 300000)

  it("护符项的价格来源必须是 market（internal 即表示被覆盖）", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const { useGameStoreOutside, PriceStatus } = await import("@/pinia/stores/game")
    const game = useGameStoreOutside()
    game.buyStatus = PriceStatus.ASK
    game.sellStatus = PriceStatus.BID
    await new Promise(r => setTimeout(r, 10))

    const row = calcCharmTransformApi(1).find(r => r.tier === "basic")!
    console.log(
      "[p] basic 投入清单:",
      row.ingredientListWithPrice.map((i: any) =>
        i.hrid.replace("/items/", "") + "@" + i.price + "(" + i.priceSource + ")"
      ).join(" ")
    )
    expect(row.ingredientListWithPrice.length, "投入清单不应为空").toBeGreaterThan(0)
    const charm = row.ingredientListWithPrice.find((i: any) => i.hrid === "/items/basic_brewing_charm")!
    expect(charm.priceSource, "internal 表示被 ingredientPriceConfigList 覆盖（缺陷状态）")
      .not.toBe("internal")
    expect(charm.priceSource, "市价存在时来源应为 market").toBe("market")
  }, 300000)

  it("自制成本降为纯参考列：与投入价不同也不影响 valid 判定", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const { useGameStoreOutside, PriceStatus } = await import("@/pinia/stores/game")
    const game = useGameStoreOutside()
    game.buyStatus = PriceStatus.ASK
    game.sellStatus = PriceStatus.BID
    await new Promise(r => setTimeout(r, 10))

    const basic = calcCharmTransformApi(0).find(r => r.tier === "basic")!
    console.log("[p] basic 投入价=" + basic.charmPriceNow + " 自制成本(仅对照)=" + basic.essenceCost)
    expect(basic.essenceCost, "自制成本应仍作为参考列保留").toBeGreaterThan(0)
    expect(basic.charmPriceNow, "投入价应来自市价(777) 而非自制成本")
      .toBe(777)
    expect(basic.valid, "只要轮子取到价就该可算，不能再判 essenceCost").toBe(true)
  }, 300000)
})
