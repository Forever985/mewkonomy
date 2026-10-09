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

it("⑤ 默认按净率降序，且同价行次序稳定（applySort 的 tiebreaker）", async () => {
    const arb = await import("@/common/apis/marketarb")
    expect(arb.ARB_DEFAULT_SORT_KEY, "用户指定默认按净率").toBe("netRate")
    const list = arb.calcArbList()
    const sort = { key: arb.ARB_DEFAULT_SORT_KEY, order: "descending" } as const
    const sorted = arb.runArbQuery(list, {}, sort)
    console.log("[p] 排序 =", sorted.map(i => `${i.hrid.replace("/items/", "")} ${(i.netRate * 100).toFixed(1)}%${i.suspicious ? "(异常)" : ""}`).join(" | "))
    // 净率降序：那条 860% 的离谱挂单必然在首位（这正是要打「疑似异常」标签的原因），
    // 沼泽精华 8% 紧随其后，丛林精华 4% 垫底。
    expect(sorted[0].hrid, "860% 的离谱挂单排第一").toBe("/items/absurd_ask")
    expect(sorted[0].suspicious, "首位必须被标记为疑似异常").toBe(true)
    expect(sorted[1].hrid, "沼泽精华 8% 紧随其后").toBe("/items/swamp_essence")
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].netRate, "降序不得回退").toBeGreaterThanOrEqual(sorted[i].netRate)
    }
    // 同样输入必得同样输出：重复执行、以及打乱输入顺序，次序都一致
    const again = arb.runArbQuery(list, {}, sort)
    expect(again.map(i => i.hrid), "重复执行结果一致").toEqual(sorted.map(i => i.hrid))
    const viaShuffled = arb.runArbQuery([...list].reverse(), {}, sort)
    expect(viaShuffled.map(i => i.hrid), "输入顺序不同也必须同一输出（唯一键 tiebreaker）")
      .toEqual(sorted.map(i => i.hrid))
  })

  it("⑥ 检索：多物品名(OR) / 分类 / 区间九模式 / 隐藏异常", async () => {
    const arb = await import("@/common/apis/marketarb")
    const list = arb.calcArbList()
    const sort = { key: arb.ARB_DEFAULT_SORT_KEY, order: "descending" } as const
    const run = (params: any) => arb.runArbQuery(list, params, sort)

    // ── 物品名多选：命中任一即保留（与 11 个检索页一致），支持中英名与 hrid ──
    expect(run({ name: ["沼泽"] }).map(i => i.hrid), "中文名").toEqual(["/items/swamp_essence"])
    expect(run({ name: ["swamp"] }).map(i => i.hrid), "英文名").toEqual(["/items/swamp_essence"])
    expect(run({ name: ["/items/swamp"] }).map(i => i.hrid), "hrid").toEqual(["/items/swamp_essence"])
    expect(run({ name: ["沼泽", "丛林"] }).length, "多个名字是 OR").toBe(2)
    expect(run({ name: ["不存在"] }).length, "无命中").toBe(0)
    expect(run({}).length, "无条件 ⇒ 全量").toBe(list.length)

    // ── 分类（面板 select，空 = 不限）──
    const cats = [...new Set(list.map(i => i.category))]
    console.log("[p] 候选的分类 =", cats.join(", "))
    if (cats.length) {
      expect(run({ category: cats[0] }).every(i => i.category === cats[0]), "分类过滤生效").toBe(true)
    }
    expect(run({ category: "__none__" }).length, "不存在的分类 ⇒ 空").toBe(0)

    // ── 净率区间（面板填百分点，执行侧 ÷100）──
    const high = run({ minNetRate: 7.5 })
    console.log("[p] 净率 ≥7.5% =", high.map(i => i.hrid).join(", "))
    expect(high.length, "沼泽 8% 与离谱挂单 860%（丛林 4% 不达标）").toBe(2)
    expect(run({ minNetRate: 5, maxNetRate: 8.5 }).map(i => i.hrid), "净率 5~8.5%").toEqual(["/items/swamp_essence"])

    // 区间模式：面板把模式写进 __mode，这里走 query-engine 的模式机
    expect(run({ minNetRate: 7.5, minNetRate__mode: "gte" }).length, "显式 gte 模式").toBe(2)
    expect(run({ maxNetRate: 5, maxNetRate__mode: "lte" }).map(i => i.hrid), "≤5%").toEqual(["/items/jungle_essence"])
    expect(run({ minNetRate__mode: "any", minNetRate: 99 }).length, "模式 any ⇒ 该条件失效").toBe(list.length)
    const top1 = run({ minNetRate: 1, minNetRate__mode: "topN" })
    expect(top1.length, "净率前 1 名").toBe(1)
    expect(top1[0].hrid).toBe("/items/absurd_ask")
    // ⚠️ 这一条是「排名模式不能进区间判定」的守卫：
    //    净率 8% = 0.08 < 1，若把 topN 的阈值 1 当成普通比较，沼泽会被误杀。
    const top2 = run({ minNetRate: 2, minNetRate__mode: "topN" })
    expect(top2.map(i => i.hrid), "净率前 2 名（8% 的沼泽必须在内）")
      .toEqual(["/items/absurd_ask", "/items/swamp_essence"])
    const bottom1 = run({ minNetRate: 1, minNetRate__mode: "bottomN" })
    expect(bottom1.map(i => i.hrid), "净率后 1 名 = 最低那条").toEqual(["/items/jungle_essence"])

    // ── 其它区间字段 ──
    expect(run({ minVolume: 1 }).length, "成交 ≥1（页面默认）").toBe(2)
    expect(run({ minVolume: 1000 }).map(i => i.hrid), "成交 ≥1000").toEqual(["/items/swamp_essence"])
    expect(run({ minVolume: 999999 }).length, "门槛过高 ⇒ 空").toBe(0)
    expect(run({ minBid: 1000 }).length, "右价 ≥1000 ⇒ 空").toBe(0)

    // ── 自定义谓词：隐藏疑似异常 ──
    expect(run({ hideSuspicious: true }).some(i => i.suspicious), "异常条目应被隐藏").toBe(false)
    expect(run({}).some(i => i.suspicious), "不隐藏时它在池里").toBe(true)

    // ── 条件叠加 ──
    expect(run({ minNetRate: 7.5, hideSuspicious: true }).map(i => i.hrid),
      "净率≥7.5% 且隐藏异常 ⇒ 只剩沼泽").toEqual(["/items/swamp_essence"])
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
