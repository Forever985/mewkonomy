import { describe, it, expect, beforeAll } from "vitest"
import { loadTestGameData, seedGameData } from "./utils/load-game-data"

/**
 * 「炒货」页的计算层测试。
 *
 * 重点是**排除逻辑**而不是某个具体数字：
 * 候选池的入口条件是「双边有报价」+「扣税后仍有净利」，
 * 这两条一旦松掉就会放进大量假条目（尤其「只有左价」时净利恒为正）。
 */
describe("炒货：价差候选的判定", () => {
  beforeAll(async () => {
    await loadTestGameData()
    const { useGameStoreOutside } = await import("@/pinia/stores/game")
    const gameData = useGameStoreOutside().gameData

    // 自造市价：每个条目都对应一条边界情况
    await seedGameData(gameData, {
      timestamp: 1,
      marketData: {
        // 正常候选：72 / 64 ⇒ 净利 72×0.96−64 = 5.12，净率 8%
        "/items/swamp_essence": { 0: { ask: 72, bid: 64, volume: 50161, price: 67 } },
        // 候选但单件净利不足 1：13×0.96−12 = 0.48（净率 4%，与沼泽的 8% 区分开）
        "/items/jungle_essence": { 0: { ask: 13, bid: 12, volume: 100, price: 12 } },
        // ⚠️ 只有左价：净利算出来是正的（96），但根本没人接你的买单 ⇒ 必须排除
        "/items/only_ask": { 0: { ask: 100, bid: -1, volume: 0, price: -1 } },
        // ⚠️ 只有右价：排除
        "/items/only_bid": { 0: { ask: -1, bid: 50, volume: 0, price: -1 } },
        // ⚠️ 毛差为正但盖不住税：100−97 = 3 > 0，而 96−97 = −1 ⇒ 必须排除
        "/items/spread_not_cover_tax": { 0: { ask: 100, bid: 97, volume: 10, price: 98 } },
        // ⚠️ 净利恰好 0：100×0.96−96 = 0 ⇒ 边际无意义，排除
        "/items/zero_net": { 0: { ask: 100, bid: 96, volume: 10, price: 98 } },
        // ⚠️ 完全无报价
        "/items/no_quote": { 0: { ask: -1, bid: -1, volume: 0, price: -1 } },
        // 疑似异常报价：左/右 = 10 倍、净率 860%、当日成交 0
        // （实测官方市场里净率榜首就是这种条目，必须能识别出来）
        "/items/absurd_ask": { 0: { ask: 1000, bid: 100, volume: 0, price: -1 } }
      } as never
    })
  }, 300000)

  it("① 只保留「双边有报价且扣税后仍有净利」的条目", async () => {
    const arb = await import("@/common/apis/marketarb")
    const hrids = new Set(arb.calcArbList().map(i => i.hrid))

    console.log("[p] 候选 =", [...hrids].join(", "))
    expect(hrids.has("/items/swamp_essence"), "沼泽精华应入选").toBe(true)
    expect(hrids.has("/items/jungle_essence"), "净利 0.64 > 0，应入选").toBe(true)
    // ⚠️ 这三条是本页最容易出错的地方
    expect(hrids.has("/items/only_ask"), "只有左价必须排除（否则净利恒为正）").toBe(false)
    expect(hrids.has("/items/only_bid"), "只有右价必须排除").toBe(false)
    expect(hrids.has("/items/spread_not_cover_tax"), "毛差盖不住 4% 税 ⇒ 必须排除").toBe(false)
    expect(hrids.has("/items/zero_net"), "净利恰好 0 ⇒ 排除").toBe(false)
    expect(hrids.has("/items/no_quote"), "无报价 ⇒ 排除").toBe(false)
    // 疑似异常**不剔除**，只标记（剔除＝替用户决定）
    expect(hrids.has("/items/absurd_ask"), "疑似异常报价仍留在池里，但必须被标记").toBe(true)
    const absurd = arb.calcArbList().find(i => i.hrid === "/items/absurd_ask")!
    expect(absurd.leftRightRatio, "左/右 = 10 倍").toBeCloseTo(10, 6)
    expect(absurd.suspicious, "左 ≥ 右 3 倍 ⇒ 标记为疑似异常").toBe(true)
    expect(absurd.netRate, "净率 = (1000×0.96−100)/100 = 8.6").toBeCloseTo(8.6, 6)
    // 正常条目不该被误标
    expect(arb.calcArbList().find(i => i.hrid === "/items/swamp_essence")!.suspicious).toBe(false)
  })

  it("② 净利 / 净率公式与手算一致", async () => {
    const arb = await import("@/common/apis/marketarb")
    const { MARKET_TAX_FACTOR } = await import("@@/constants/market")
    const swamp = arb.calcArbList().find(i => i.hrid === "/items/swamp_essence")!

    console.log("[p] 沼泽精华 左", swamp.ask, "右", swamp.bid,
      "毛差", swamp.grossSpread, "税", swamp.taxAmount.toFixed(2),
      "净利", swamp.netPerUnit.toFixed(2), "净率", (swamp.netRate * 100).toFixed(2) + "%")

    expect(MARKET_TAX_FACTOR, "税后系数 = 0.96（4% 成交税）").toBeCloseTo(0.96, 9)
    expect(swamp.grossSpread).toBe(8)
    expect(swamp.taxAmount).toBeCloseTo(72 * 0.04, 9)
    expect(swamp.netPerUnit, "净利 = 左价 × 0.96 − 右价").toBeCloseTo(5.12, 9)
    expect(swamp.netRate, "净率以买入价（右价）为基数").toBeCloseTo(5.12 / 64, 9)
    expect(swamp.subUnit).toBe(false)
  })

  it("③ 单件净利不足 1 必须打标（否则用户以为每件都赚得到那 0.64）", async () => {
    const arb = await import("@/common/apis/marketarb")
    const jungle = arb.calcArbList().find(i => i.hrid === "/items/jungle_essence")!
    console.log("[p] 丛林精华 净利", jungle.netPerUnit.toFixed(4), " subUnit =", jungle.subUnit)
    expect(jungle.netPerUnit).toBeCloseTo(0.48, 9)
    expect(jungle.subUnit, "净利 < 1 ⇒ 必须打标").toBe(true)
  })

  it("④ 概览把「不可炒」的单边条目单独计数", async () => {
    const arb = await import("@/common/apis/marketarb")
    const s = arb.getArbSummary()
    console.log("[p] 概览 =", JSON.stringify(s))
    expect(s.quoted, "双边有报价的条目").toBe(5)
    expect(s.profitable, "其中扣税后有净利的（含那条离谱挂单）").toBe(3)
    expect(s.singleSide, "单边有报价的").toBe(2)
  })

  it("⑤ 默认按净率降序", async () => {
    const arb = await import("@/common/apis/marketarb")
    expect(arb.ARB_DEFAULT_SORT_KEY, "用户指定默认按净率").toBe("netRate")
    const list = arb.calcArbList()
    const sorted = arb.sortArbRows(list, arb.ARB_DEFAULT_SORT_KEY, true)
    console.log("[p] 排序 =", sorted.map(i => `${i.hrid.replace("/items/", "")} ${(i.netRate * 100).toFixed(1)}%${i.suspicious ? "(异常)" : ""}`).join(" | "))
    // 净率降序：那条 860% 的离谱挂单必然在首位（这正是要打「疑似异常」标签的原因），
    // 沼泽精华 8% 紧随其后，丛林精华 4% 垫底。
    expect(sorted[0].hrid, "860% 的离谱挂单排第一").toBe("/items/absurd_ask")
    expect(sorted[0].suspicious, "首位必须被标记为疑似异常").toBe(true)
    expect(sorted[1].hrid, "沼泽精华 8% 紧随其后").toBe("/items/swamp_essence")
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].netRate, "降序不得回退").toBeGreaterThanOrEqual(sorted[i].netRate)
    }
  })

  it("⑥ 筛选：净率下限 / 只看有成交 / 分类 / 三路关键词", async () => {
    const arb = await import("@/common/apis/marketarb")
    const list = arb.calcArbList()
    const t = (n: string) => n

    const high = arb.filterArbItems(list, { minNetRate: 0.075 }, t)
    console.log("[p] 净率 ≥7.5% =", high.map(i => i.hrid).join(", "))
    expect(high.length, "沼泽 8% 与离谱挂单 860%（丛林 4% 不达标）").toBe(2)
    expect(high.some(i => i.hrid === "/items/swamp_essence")).toBe(true)
    expect(high.some(i => i.hrid === "/items/absurd_ask")).toBe(true)

    // 叠加「隐藏疑似异常」⇒ 离谱挂单被滤掉
    const clean = arb.filterArbItems(list, { minNetRate: 0.075, hideSuspicious: true }, t)
    console.log("[p] 再隐藏异常 =", clean.map(i => i.hrid).join(", "))
    expect(clean.some(i => i.hrid === "/items/absurd_ask"), "异常条目应被滤掉").toBe(false)

    const traded = arb.filterArbItems(list, { onlyTraded: true }, t)
    expect(traded.length, "沼泽 50161 / 丛林 100 有成交，0 成交的离谱挂单被滤掉").toBe(2)
    expect(traded.some(i => i.hrid === "/items/absurd_ask"), "0 成交的不该在「有成交」结果里").toBe(false)

    const noTrade = arb.filterArbItems(list, { onlyTraded: false, minBid: 1000 }, t)
    expect(noTrade.length, "右价门槛过 1000 ⇒ 空").toBe(0)

    // 成交门槛：沼泽 50161 / 丛林 100 / 离谱挂单 0
    const heavy = arb.filterArbItems(list, { minVolume: 1000 }, t)
    expect(heavy.map(i => i.hrid), "成交 ≥1000 只剩沼泽").toEqual(["/items/swamp_essence"])
    expect(arb.filterArbItems(list, { minVolume: 999999 }, t).length, "门槛过高 ⇒ 空").toBe(0)

    const notAbsurd = arb.filterArbItems(list, { hideSuspicious: true }, t)
    expect(notAbsurd.some(i => i.hrid === "/items/absurd_ask"), "hideSuspicious 生效").toBe(false)

    // 三路匹配：hrid / 英文名 / 中文名（中文由 translate 回调提供）
    // ⚠️ 回调必须按名字逐个翻译，不能对所有条目返回同一个中文名 ——
    //    否则「沼泽」会同时命中两条，断言看着过了其实没在测匹配。
    const cn = (n: string) => (n === "Swamp Essence" ? "沼泽精华" : n === "Jungle Essence" ? "丛林精华" : n)
    expect(arb.filterArbItems(list, { keyword: "swamp" }, t).length, "英文名").toBe(1)
    expect(arb.filterArbItems(list, { keyword: "/items/swamp" }, t).length, "hrid").toBe(1)
    expect(arb.filterArbItems(list, { keyword: "沼泽" }, cn).length, "中文名").toBe(1)
    expect(arb.filterArbItems(list, { keyword: "丛林" }, cn).length, "中文名").toBe(1)
    expect(arb.filterArbItems(list, { keyword: "不存在" }, t).length).toBe(0)
  })

  it("⑦ 提醒指标：税后净利与净率能取到值（供 alerts 复用）", async () => {
    const arb = await import("@/common/apis/marketarb")
    const list = arb.calcArbList()
    expect(list.every(i => Number.isFinite(i.netPerUnit))).toBe(true)
    expect(list.every(i => Number.isFinite(i.netRate))).toBe(true)
  })

  it("⑧ 净率基数可切换：右价 = 资金回报率，左价 = 毛利率", async () => {
    const arb = await import("@/common/apis/marketarb")

    const byBid = arb.calcArbList("bid").find(i => i.hrid === "/items/swamp_essence")!
    const byAsk = arb.calcArbList("ask").find(i => i.hrid === "/items/swamp_essence")!
    console.log("[p] 沼泽 净利", byBid.netPerUnit,
      " 右价口径", (byBid.netRate * 100).toFixed(3) + "%",
      " 左价口径", (byAsk.netRate * 100).toFixed(3) + "%")

    expect(byBid.netRate, "右价口径 = 净利 ÷ 买入价 = 5.12/64").toBeCloseTo(5.12 / 64, 9)
    expect(byAsk.netRate, "左价口径 = 净利 ÷ 卖出价 = 5.12/72").toBeCloseTo(5.12 / 72, 9)
    expect(byAsk.netRate, "左价口径一定更低（分母更大）").toBeLessThan(byBid.netRate)

    // ⚠️ 换基数**不得**改变净利与候选集合 —— 只有净率的分母变
    expect(byAsk.netPerUnit).toBe(byBid.netPerUnit)
    expect(arb.calcArbList("ask").length, "候选数量与基数无关").toBe(arb.calcArbList("bid").length)

    // 默认就是右价
    const def = arb.calcArbList()
    expect(arb.ARB_DEFAULT_SORT_KEY).toBe("netRate")
    expect(def.map(i => i.netRate)).toEqual(arb.calcArbList("bid").map(i => i.netRate))
  })
})
