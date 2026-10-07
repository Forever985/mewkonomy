import { describe, it, expect, beforeAll } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"

/**
 * chainbuilder 两个用户实测 bug 的回归测试（2026-10-07）。
 *
 * ## bug 1：新手模式选「转化」，却弹出「保护之镜碎片」，且换任何动作都一样
 *
 * 根因是**两个缺陷叠加**：
 *
 * 1. `getChainMakersOf` 判据错 —— 用 `getChainStepItemOptions(kind, action)` 判断
 *    「该项目能不能做 X」，但那个函数返回的是「该动作可作用于哪些物品」（合法**输入**）。
 *    ⇒ 每个物品都被挂上 转化/分解/点金。
 * 2. `getChainIngredientsOf` 只收 hrid，内部 `break` 只取**第一个** maker
 *    ⇒ 用户选什么都被忽略，永远按第一个（制造）算原料。
 *    而制造保护之镜的原料正是 `/items/shard_of_protection`（保护之镜碎片 ×180）。
 *
 * ## bug 2：进阶模式搜索框完全不生效
 *
 * `el-select` 的 `filter-method` 返回值会被**丢弃**，早前却把过滤结果 return 出去，
 * 选项列表恒为全量。修法：filter-method 只记关键字，列表由关键字算出，
 * 且**空关键字要返回全量**（`filterChainItems` 对空串返回 `[]`，不能直接用）。
 */
describe("chainbuilder 修复：makers 判据 + 炼金原料 + 下拉过滤", () => {
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

  it("bug2 修复：filterChainOptions 空关键字返回全量，非空才过滤", async () => {
    const { filterChainOptions, filterChainItems } = await import("@/common/apis/chainbuilder")
    const items = [
      { hrid: "/items/azure_cheese", name: "Azure Cheese", cn: "蓝纹奶酪" },
      { hrid: "/items/azure_milk", name: "Azure Milk", cn: "蓝纹奶" }
    ]

    // 空关键字：下拉框要看到全部候选
    expect(filterChainOptions(items, "").length, "空关键字必须返回全量").toBe(2)
    expect(filterChainOptions(items, "   ").length, "纯空格也算空").toBe(2)

    // 非空：三路匹配（英文名 / 中文名 / hrid）
    expect(filterChainOptions(items, "cheese").map(i => i.hrid)).toEqual(["/items/azure_cheese"])
    expect(filterChainOptions(items, "奶酪").map(i => i.hrid)).toEqual(["/items/azure_cheese"])
    expect(filterChainOptions(items, "azure_milk").map(i => i.hrid)).toEqual(["/items/azure_milk"])

    // 对照：filterChainItems 是「搜索」语义 —— 空串返回 []，两个函数不可混用
    expect(filterChainItems(items, ""), "filterChainItems 对空串返回空（搜索语义）").toEqual([])
  }, 300000)

  it("bug1-a 修复：炼金 maker 的 stepHrid 必须是「投入品」，不能等于产物", async () => {
    const api = await import("@/common/apis/chainbuilder")

    for (const hrid of ["/items/azure_milk", "/items/azure_cheese", "/items/mirror_of_protection"]) {
      for (const m of api.getChainMakersOf(hrid)) {
        if (api.isAlchemyKind(m.kind)) {
          // 炼金：hrid 是投入品 ⇒ 想产出目标物，投入的一定是**别的**东西
          expect(m.stepHrid, `${hrid} 的炼金 maker 不该把产物自己当投入（旧 bug）`)
            .not.toBe(m.hrid)
          // 自我回流（转 A 得回 A）不是生产，必须被排除
          expect(m.stepHrid, `${hrid} 的炼金 maker 出现了自我回流`).not.toBe(hrid)
        } else {
          // 采集/制造：计算器按产物解析 ⇒ stepHrid 就是产物本身
          expect(m.stepHrid, `${hrid} 的配方 maker 的 stepHrid 应等于产物`).toBe(m.hrid)
        }
      }
    }
  }, 300000)

  it("bug1-a 修复：原奶/奶酪/保护之镜 能识别出真实配方", async () => {
    const api = await import("@/common/apis/chainbuilder")

    const milk = api.getChainMakersOf("/items/azure_milk")
    expect(milk.some(m => m.project === "挤奶"), "原奶应由「挤奶」产出").toBe(true)

    const cheese = api.getChainMakersOf("/items/azure_cheese")
    expect(cheese.some(m => m.project === "锻造"), "奶酪应由「锻造」产出").toBe(true)

    const mirror = api.getChainMakersOf("/items/mirror_of_protection")
    expect(mirror.some(m => m.project === "制造" && m.stepHrid === m.hrid), "保护之镜应由「制造」产出").toBe(true)
  }, 300000)

  it("bug1-a 修复：反查能找到「转化出来的」物品（贤者之石碎片 ← 太阳石碎片）", async () => {
    const api = await import("@/common/apis/chainbuilder")

    const makers = api.getChainMakersOf("/items/crushed_philosophers_stone")
    const viaSunstone = makers.find(m =>
      m.kind === "transmute" && m.stepHrid === "/items/crushed_sunstone"
    )
    console.log("[p] 贤者之石碎片的转化来源（前若干）:",
      makers.filter(m => api.isAlchemyKind(m.kind)).slice(0, 6)
        .map(m => `${m.stepHrid.replace("/items/", "")}@${m.rate}`).join(", "))

    expect(viaSunstone, "必须能反查到「太阳石碎片 --转化--> 贤者之石碎片」这条件").toBeTruthy()
    // 实测 dropRate = 0.005（平均 200 次出 1 个）
    expect(viaSunstone!.rate, "太阳石碎片转化出贤者之石碎片的命中率应为 0.005").toBeCloseTo(0.005, 6)
  }, 300000)

  it("bug1-b 修复：getChainIngredientsOf 尊重用户选的做法（保护之镜）", async () => {
    const api = await import("@/common/apis/chainbuilder")

    // 选「制造」：原料应是 保护之镜碎片 ×180
    const byCraft = api.getChainIngredientsOf({
      project: "制造", action: "crafting", kind: "manufacture", hrid: "/items/mirror_of_protection"
    } as any)
    console.log("[p] 制造保护之镜的原料:", byCraft.map(i => `${i.hrid}×${i.count}`).join(", "))
    const shard = byCraft.find(i => i.hrid === "/items/shard_of_protection")
    expect(shard, "制造保护之镜的原料应是 保护之镜碎片").toBeTruthy()
    expect(shard!.count, "实测每 1 个保护之镜需要 180 个碎片").toBe(180)

    /**
     * ★ 关键：选一个**不是第一个** maker，验证原料真的跟着选择走。
     *
     * 保护之镜的 makers 顺序是 [制造, 转化←贤者之石, 转化←贤者之石碎片]，
     * 而「制造」恰好是第一个 —— 所以只断言「选制造得到碎片」抓不到
     * 「永远取第一个 maker」这个 bug（两种实现结果相同）。
     * 必须选第二个及以后的，才能区分。
     */
    const makers = api.getChainMakersOf("/items/mirror_of_protection")
    const alchemyMaker = makers.find(m => api.isAlchemyKind(m.kind))
    expect(alchemyMaker, "保护之镜应存在炼金类做法").toBeTruthy()

    const byAlchemy = api.getChainIngredientsOf(api.buildStepFromMaker(alchemyMaker!))
    console.log("[p] 用炼金做法时原料:", byAlchemy.map(i => `${i.hrid}×${i.count.toFixed(2)}`).join(", "))
    console.log("[p]   该做法的投入品 =", alchemyMaker!.stepHrid, " 命中率 =", alchemyMaker!.rate)

    // 原料必须是**这个做法的投入品**，而不是第一个 maker（制造）的原料「保护之镜碎片」
    expect(byAlchemy.length, "炼金环节应给出一条原料").toBe(1)
    expect(byAlchemy[0].hrid, "原料必须是所选做法的投入品（旧 bug 下会退回第一个 maker 的碎片）")
      .toBe(alchemyMaker!.stepHrid)
    expect(byAlchemy.some(i => i.hrid === "/items/shard_of_protection"),
      "旧 bug 的特征：拿到的原料是保护之镜碎片").toBe(false)
  }, 300000)

  it("bug1-b 修复：炼金原料 = 投入品 × (1/命中率)（用户真实链）", async () => {
    const api = await import("@/common/apis/chainbuilder")

    // 太阳石碎片 --转化(0.005)--> 贤者之石碎片 ⇒ 平均要 200 个碎片
    const ings = api.getChainIngredientsOf({
      project: "转化", action: "alchemy", kind: "transmute",
      hrid: "/items/crushed_sunstone", outHrid: "/items/crushed_philosophers_stone"
    } as any)

    console.log("[p] 转化链原料:", ings.map(i => `${i.hrid}×${i.count.toFixed(1)}`).join(", "))
    expect(ings.length, "炼金环节应恰好给出一条原料（它投入的那个物品）").toBe(1)
    expect(ings[0].hrid, "原料应是投入品（太阳石碎片）").toBe("/items/crushed_sunstone")
    expect(ings[0].count, "命中率 0.005 ⇒ 平均需要 200 个投入品").toBeCloseTo(200, 6)
  }, 300000)

  it("buildStepFromMaker：炼金 maker 要自动带上 outHrid", async () => {
    const api = await import("@/common/apis/chainbuilder")

    const maker = api.getChainMakersOf("/items/crushed_philosophers_stone")
      .find(m => m.stepHrid === "/items/crushed_sunstone")!
    const step = api.buildStepFromMaker(maker)

    expect(step.kind).toBe("transmute")
    expect(step.hrid, "炼金步骤的 hrid 是投入品").toBe("/items/crushed_sunstone")
    expect(step.outHrid, "必须声明「这一样交给下一步」").toBe("/items/crushed_philosophers_stone")

    // 非炼金：不该有 outHrid
    const craft = api.getChainMakersOf("/items/crushed_sunstone").find(m => m.project === "制造")!
    expect(api.buildStepFromMaker(craft).outHrid, "制造环节不该有衔接产物").toBeUndefined()
  }, 300000)

  it("用户真实链可算：太阳石→碎片→贤者之石碎片→转化", async () => {
    const api = await import("@/common/apis/chainbuilder")

    const steps: any[] = [
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
    const wf = api.calcChainProfitApi(steps, "贤者之石碎片链")
    expect(wf, "链必须是可算的（三个环节都可用）").not.toBeNull()
    console.log("[p] 结果:", wf!.result.profitPHFormat, wf!.result.profitRateFormat)
    expect(wf!.resultList.flat().length, "应有三行环节明细").toBe(3)
  }, 300000)
})
