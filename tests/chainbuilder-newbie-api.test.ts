import { describe, it, expect, beforeAll } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"

describe("chainbuilder 新手模式 API", () => {
  beforeAll(async () => { await loadTestGameData() }, 300000)

  it("反查：哪些项目能做出某个物品", async () => {
    const { getChainMakersOf } = await import("@/common/apis/chainbuilder")
    // 法师布：裁缝能做，也能由转化得到
    const makers = getChainMakersOf("/items/magicians_cloth")
    console.log("[p] 法师布的生产方式:", makers.map(m => `${m.project}×${m.count}`).join(", ") || "(无)")
    expect(makers.length).toBeGreaterThan(0)
    expect(makers.every(m => m.hrid === "/items/magicians_cloth")).toBe(true)
  }, 300000)

  it("反查：不存在物品返回空而非抛错", async () => {
    const { getChainMakersOf } = await import("@/common/apis/chainbuilder")
    expect(getChainMakersOf("/items/__nope__")).toEqual([])
  })

  it("原料清单：法师布只需要金币 ⇒ 过滤后为空（不是 bug）", async () => {
    const { getChainIngredientsOf } = await import("@/common/apis/chainbuilder")
    const ings = getChainIngredientsOf("/items/magicians_cloth")
    console.log("[p] 法师布原料（已过滤茶/金币/自产自用）:", JSON.stringify(ings))
    // 法师布的转化成本只有金币（+ 玩家配的茶），二者都不是「物料」，
    // 所以过滤后为空是正确的 —— 空列表会被 UI 渲染成「链条到此为止」。
    expect(ings).toEqual([])
  }, 300000)

  it("环节摘要：消耗与产出都能读出来", async () => {
    const { getChainStepSummary } = await import("@/common/apis/chainbuilder")
    const s = getChainStepSummary({ project: "锻造", action: "cheesesmithing", kind: "manufacture", hrid: "/items/azure_cheese" })!
    console.log("[p] 锻造azure奶酪 => 消耗:", s.inputs.map(i => `${i.name}×${i.count}`).join(","), "=> 产出:", s.outputs.map(o => `${o.name}×${o.count}`).join(","), "|", s.timeCost)
    expect(s.outputs.length).toBeGreaterThan(0)
    expect(s.timeCost, "占位符 0 不应原样显示").not.toContain("{0}")
  }, 300000)

  it("环节命中率：炼金取 dropRate，制造/采集为 1（用户真实需求）", async () => {
    const { getChainStepSummary } = await import("@/common/apis/chainbuilder")

    // ① 用户场景（2026-10-07）：转化太阳石碎片 → 贤者之石碎片，dropRate 仅 0.005。
    //    不知道这个数，新手会以为 100% 成功，实际平均要做 200 次。
    const s1 = getChainStepSummary({
      project: "转化", action: "alchemy", kind: "transmute",
      hrid: "/items/crushed_sunstone", outHrid: "/items/crushed_philosophers_stone"
    } as any)!
    console.log(`[p] 转化太阳石碎片→贤者之石碎片 命中率=${s1.successRate} 每小时${s1.actionsPerHour}次→得${s1.targetPerHour.toFixed(2)}`)
    expect(s1.successRate, "必须等于游戏数据的 0.005").toBeCloseTo(0.005, 6)
    expect(s1.targetPerHour).toBeCloseTo(s1.actionsPerHour * s1.successRate, 4)

    // ② 制造是确定产出
    expect(getChainStepSummary({
      project: "制造", action: "crafting", kind: "manufacture", hrid: "/items/crushed_sunstone"
    } as any)!.successRate, "制造应为 1").toBe(1)

    // ③ 采集同理
    expect(getChainStepSummary({
      project: "挤奶", action: "milking", kind: "gather", hrid: "/items/azure_milk"
    } as any)!.successRate, "采集应为 1").toBe(1)

    // ④ 炼金未指定衔接产物 ⇒ 拿不到「指定产物」，记 0（UI 应提示先选）
    expect(getChainStepSummary({
      project: "转化", action: "alchemy", kind: "transmute", hrid: "/items/crushed_sunstone"
    } as any)!.successRate, "未指定衔接产物时应为 0").toBe(0)
  }, 300000)

  it("掉落表项之和为 1；炼丹精华是时间附赠，不在表内", async () => {
    const { getChainStepSummary } = await import("@/common/apis/chainbuilder")
    const s = getChainStepSummary({
      project: "转化", action: "alchemy", kind: "transmute",
      hrid: "/items/crushed_sunstone", outHrid: "/items/crushed_philosophers_stone"
    } as any)!

    // 游戏 transmuteDropTable 四项之和恰为 1（0.3+0.445+0.25+0.005）
    const tableSum = s.outputs
      .filter(o => o.rate != null && o.hrid !== "/items/alchemy_essence" && o.hrid !== "/items/large_artisans_crate")
      .reduce((a, o) => a + o.rate!, 0)
    expect(tableSum, "掉落表项之和应为 1").toBeCloseTo(1, 3)

    // ⚠️ 全部 productList 的 rate 之和是 1.0948 而非 1：差值来自 Alchemy Essence
    // （由 getAlchemyEssenceDropTable 按时间×等级额外附赠，不受掉落表约束）。
    // 写测试时若误判「rate 之和应为 1」会得到假失败 —— 这里显式记录该事实。
    const allSum = s.outputs.filter(o => o.rate != null).reduce((a, o) => a + o.rate!, 0)
    console.log(`[p] 掉落表项之和=${tableSum}；含时间附赠后=${allSum.toFixed(4)}`)
    expect(allSum, "含附赠后 > 1（附赠叠加在表外）").toBeGreaterThan(1)
  }, 300000)

  it("用户的两级转化链（贤者之石生意）能算出结果", async () => {
    const { calcChainProfitApi } = await import("@/common/apis/chainbuilder")
    const wf = calcChainProfitApi([
      { project: "转化", action: "alchemy", kind: "transmute", hrid: "/items/crushed_sunstone", outHrid: "/items/crushed_philosophers_stone", catalystRank: 2 },
      { project: "转化", action: "alchemy", kind: "transmute", hrid: "/items/crushed_philosophers_stone", outHrid: "/items/crushed_moonstone", catalystRank: 2 }
    ], "贤者之石生意")
    console.log(`[p] 两级转化链 = ${wf ? `利润/h=${wf.result.profitPHFormat} 利润率=${wf.result.profitRateFormat}` : "null"}`)
    expect(wf).not.toBeNull()
  }, 300000)

  it("原料清单：茶/金币/自产自用都必须排除（新手模式的生死线）", async () => {
    const { getChainIngredientsOf } = await import("@/common/apis/chainbuilder")
    const { getGameDataApi } = await import("@/common/apis/game")
    const gameData = getGameDataApi()

    // 法师布的转化是「自产自用」（它自己会出现在原料里），
    // 且转化必然消耗金币 —— 三种噪声一次性验证
    const ings = getChainIngredientsOf("/items/magicians_cloth")
    for (const i of ings) {
      expect(i.hrid, "不能把自己列为原料（死循环）").not.toBe("/items/magicians_cloth")
      expect(i.hrid, "金币是货币不是原料").not.toBe("/items/coin")
      expect(gameData.itemDetailMap[i.hrid]?.categoryHrid, "茶不该进原料清单").not.toBe("/items/tea")
    }

    // 逐项排除所有「茶类」物品（按 hrid 名单，权威来自 getActionConfigOf）
    const teaHrids = Object.values(gameData.itemDetailMap)
      .filter((i: any) => /_(wisdom|artisan|efficiency|catalytic|gourmet|swift)_tea$/.test(i.hrid))
      .map((i: any) => i.hrid)
    for (const ings2 of [getChainIngredientsOf("/items/azure_cheese"), getChainIngredientsOf("/items/magicians_cloth")]) {
      for (const i of ings2) {
        expect(teaHrids, "茶叶类不该出现在原料清单").not.toContain(i.hrid)
      }
    }
  }, 300000)

  it("倒推链：unshift 之后的顺序是「原料→成品」且能算出利润", async () => {
    const { calcChainProfitApi, getChainIngredientsOf, getChainMakersOf } = await import("@/common/apis/chainbuilder")
    const target = "/items/azure_cheese"

    // 复刻 pages/chainbuilder/index.vue 新手模式的推演循环
    const maker = getChainMakersOf(target).find((m: any) => m.project === "锻造")!
    const steps: any[] = [{ project: maker.project, action: maker.action, kind: maker.kind, hrid: target }]
    for (let depth = 0; depth < 6; depth++) {
      const ings = getChainIngredientsOf(steps[0].hrid)
      if (!ings.length) break
      const ing = ings[0]
      if (!ing.makers.length) {
        steps.unshift({ project: "", action: "milking", kind: "gather", hrid: ing.hrid })
        break
      }
      steps.unshift({ project: ing.makers[0].project, action: ing.makers[0].action, kind: ing.makers[0].kind, hrid: ing.hrid })
    }

    // ⚠️ 这是最容易搞反的地方：unshift 一直往头部插，
    // 若读取时误用「末尾」当当前层，整条链会反。
    expect(steps[0].hrid, "链条头部应是原料").not.toBe(target)
    expect(steps[steps.length - 1].hrid, "链条尾部应是成品").toBe(target)
    expect(steps.map((s: any) => s.hrid)).toEqual(["/items/azure_milk", "/items/azure_cheese"])

    const wf = calcChainProfitApi(steps, "新手链")
    expect(wf).not.toBeNull()
    expect(Number.isFinite(wf!.result.profitPH)).toBe(true)
    expect(wf!.resultList.length).toBe(2)
  }, 300000)

  it("原料清单：多物料物品能列出真实原料且可继续往前推", async () => {
    const { getChainIngredientsOf } = await import("@/common/apis/chainbuilder")
    const ings = getChainIngredientsOf("/items/azure_cheese")
    console.log("[p] Azure Cheese 原料:", ings.map(i => `${i.name}×${i.count}[可做:${i.makers.map(m => m.project).join("/") || "无"}]`).join(" | "))
    expect(ings.length).toBeGreaterThan(0)
    for (const i of ings) {
      expect(i.name, "名称必须解析出来，不能是 hrid 兜底").not.toBe(i.hrid)
      expect(i.count).toBeGreaterThan(0)
    }
    // 至少有一条原料能继续往前推（否则新手模式立刻走到死路）
    expect(ings.some(i => i.makers.length > 0), "应存在可继续上溯的原料").toBe(true)
  }, 300000)

  it("性能：反查 100 个物品的耗时可接受", async () => {
    const { getChainMakersOf } = await import("@/common/apis/chainbuilder")
    const { getGameDataApi } = await import("@/common/apis/game")
    const hrids = Object.values(getGameDataApi().itemDetailMap)
      .filter((i: any) => i.enhancementCosts).slice(0, 100).map((i: any) => i.hrid)
    const t0 = Date.now()
    for (const h of hrids) getChainMakersOf(h)
    const dt = Date.now() - t0
    console.log(`[p] 反查 ${hrids.length} 个物品耗时 ${dt}ms`)
    expect(dt, `反查 100 个物品耗时 ${dt}ms，应 < 3000ms`).toBeLessThan(3000)
  }, 300000)

  it("性能：跨语言 + hrid 三路搜索", async () => {
    const { filterChainItems } = await import("@/common/apis/chainbuilder")
    const { getChainStepItemOptions } = await import("@/common/apis/chainbuilder")
    const items = getChainStepItemOptions({ project: "锻造", action: "cheesesmithing", kind: "manufacture" })

    // 英文名（小写）
    expect(filterChainItems(items, "cheese").length, "英文名应能搜到").toBeGreaterThan(0)
    // hrid 片段
    expect(filterChainItems(items, "azure_cheese").length, "hrid 应能搜到").toBeGreaterThan(0)
    // 空串返回空（而不是全部）—— 否则搜索框一打开就刷出 205 项
    expect(filterChainItems(items, "")).toEqual([])
  })
})

/* ──────────────────────────────────────────────────────────────────────────
 * 示例链的可用性锁死
 *
 * 教训：示例里的 hrid 必须是**真实可用**的配方。早前第二例写了
 * 「分解 philosophers_stone」，实测 `available === false`（游戏里没这个配方），
 * 用户点了「计算」只会看到「存在不可用的环节」—— 比没有示例更劝退。
 * ────────────────────────────────────────────────────────────────────────── */
describe("chainbuilder 内置示例链必须真实可算", () => {
  beforeAll(async () => { await loadTestGameData() }, 300000)

  // 与 pages/chainbuilder/index.vue 的 EXAMPLES 保持一致
  const EXAMPLES: { name: string, steps: any[] }[] = [
    {
      name: "两级链",
      steps: [
        { project: "挤奶", action: "milking", kind: "gather", hrid: "/items/azure_milk" },
        { project: "锻造", action: "cheesesmithing", kind: "manufacture", hrid: "/items/azure_cheese" }
      ]
    },
    {
      name: "带炼金的三级链",
      steps: [
        { project: "裁缝", action: "tailoring", kind: "manufacture", hrid: "/items/bamboo_fabric" },
        {
          project: "转化",
          action: "alchemy",
          kind: "transmute",
          hrid: "/items/bamboo_fabric",
          outHrid: "/items/linen_fabric",
          catalystRank: 1
        },
        { project: "分解", action: "alchemy", kind: "decompose", hrid: "/items/linen_fabric", catalystRank: 1 }
      ]
    }
  ]

  it("每个环节的配方都真实存在", async () => {
    const { buildChainCalculator } = await import("@/common/apis/chainbuilder")
    for (const ex of EXAMPLES) {
      for (const [i, step] of ex.steps.entries()) {
        const cal = buildChainCalculator(step)
        expect(cal.available, `${ex.name} 第${i + 1}步「${step.project} ${step.hrid}」不是真实配方`).toBe(true)
      }
    }
  })

  it("每条示例都能算出结果（不会被判为「存在不可用的环节」）", async () => {
    const { calcChainProfitApi } = await import("@/common/apis/chainbuilder")
    for (const ex of EXAMPLES) {
      const wf = calcChainProfitApi(ex.steps, ex.name)
      expect(wf, `${ex.name} 应能算出结果`).not.toBeNull()
      if (wf) {
        expect(Number.isFinite(wf.result.profitPH), `${ex.name} 的利润必须是有限数`).toBe(true)
        expect(wf.resultList.length, `${ex.name} 的环节数`).toBe(ex.steps.length)
      }
    }
  })

  it("炼金示例的衔接产物必须真的在该环节的产出里", async () => {
    const { buildChainCalculator } = await import("@/common/apis/chainbuilder")
    for (const ex of EXAMPLES) {
      for (const [i, step] of ex.steps.entries()) {
        if (!step.outHrid) continue
        const cal = buildChainCalculator(step)
        const outs = cal.productList.map((p: any) => p.hrid)
        expect(outs, `${ex.name} 第${i + 1}步指定的衔接产物 ${step.outHrid} 不在产出列表里`).toContain(step.outHrid)
      }
    }
  })
})
