import { describe, it, expect, beforeAll } from "vitest"
import { nextTick, toRaw } from "vue"
import { loadTestGameData } from "./utils/load-game-data"

/**
 * 用户提的两个问题（2026-10-07）：
 *
 * ① 「利润 / h」是净利还是毛利？抠掉成本之后会不会是负的？
 * ② 没考虑玩家配置？我有暴饮之囊呢？
 *
 * 结论：
 * ① `profitPH = incomePH − costPH`（calculator/index.ts:328）—— **已是净利**。
 *    界面上原本只给「利润」和「成本」两个数，没给「收入」，用户无从验算 ⇒ 已补收入列。
 * ② 玩家配置**本来就生效**（饮品来自 getActionConfigOf(action).tea，
 *    饮品浓度来自特殊装备）—— 但茶被从原料清单里过滤掉了，界面上看不到，
 *    用户合理地怀疑没算。现已把配置显式展示出来。
 */
describe("chainbuilder：利润口径 + 玩家配置", () => {
  beforeAll(async () => {
    await loadTestGameData()
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

  /** 穿上/脱下暴饮之囊（config 的 watch 不是 deep，必须整体换 config 引用） */
  async function setPouch(hrid: string | null) {
    const { usePlayerStore } = await import("@/pinia/stores/player")
    const store = usePlayerStore()
    const raw = structuredClone(toRaw(store.config))
    raw.specialEquimentMap = new Map(raw.specialEquimentMap as any)
    if (hrid) {
      raw.specialEquimentMap.set("pouch", { type: "pouch", hrid, enhanceLevel: 0 } as any)
    } else {
      raw.specialEquimentMap.delete("pouch")
    }
    store.config = raw as any
    await nextTick()
    await new Promise(r => setTimeout(r, 0))
  }

  it("① 利润 = 收入 − 成本（净利），不是毛利", async () => {
    const api = await import("@/common/apis/chainbuilder")
    const wf = api.calcChainProfitApi(CHAIN, "口径测试")!
    const r = wf.result as any

    console.log("[p] 收入/h =", r.incomePH.toFixed(2))
    console.log("[p] 成本/h =", r.costPH.toFixed(2))
    console.log("[p] 利润/h =", r.profitPH.toFixed(2))
    console.log("[p] 收入 − 成本 =", (r.incomePH - r.costPH).toFixed(2))

    // 核心：利润已经扣过成本
    expect(r.profitPH, "利润必须等于 收入 − 成本（净利口径）")
      .toBeCloseTo(r.incomePH - r.costPH, 6)
    // 且成本 > 0 才谈得上「扣没扣」；实测这条链是亏的，正好验证符号
    expect(r.costPH, "成本应为正数").toBeGreaterThan(0)
    expect(r.incomePH, "收入应为正数").toBeGreaterThan(0)
    console.log("[p] 本链亏损 ⇒", r.profitPH < 0 ? "利润确为负，说明确实扣了成本" : "盈利")
    expect(r.profitPH, "本链实测亏损，利润应为负").toBeLessThan(0)
  }, 300000)

  it("② 玩家配置能列出：饮品 + 饮品浓度 + 特殊装备", async () => {
    const api = await import("@/common/apis/chainbuilder")
    await setPouch("/items/guzzling_pouch")

    const cfg = api.getChainPlayerConfigSummary(CHAIN)
    console.log("[p] 饮品浓度 =", cfg.drinkConcentration)
    console.log("[p] 特殊装备 =", cfg.specialEquipment.map(e => `${e.name}+${e.enhanceLevel}`).join(", ") || "（无）")
    for (const a of cfg.byAction) {
      console.log(`[p]   ${a.label}(${a.action}) 饮品: ${a.teas.map(t => t.name).join(", ") || "（无）"}`)
    }

    expect(cfg.drinkConcentration, "装上暴饮之囊后浓度应为 0.1").toBeCloseTo(0.1, 6)
    expect(cfg.specialEquipment.some(e => e.hrid === "/items/guzzling_pouch"),
      "摘要里必须出现暴饮之囊").toBe(true)
    // 本链涉及 crafting + alchemy 两个动作
    expect(cfg.byAction.length, "应覆盖链里出现的动作").toBeGreaterThanOrEqual(2)
    expect(cfg.byAction.some(a => a.teas.length > 0), "至少一个动作为配了饮品").toBe(true)
  }, 300000)

  it("② 配置**确实影响**整链成本（不是摆设）", async () => {
    const api = await import("@/common/apis/chainbuilder")

    await setPouch(null)
    const noPouch = api.calcChainProfitApi(CHAIN, "无囊")!
    const costNo = noPouch.result.costPH
    const dcNo = api.getChainPlayerConfigSummary(CHAIN).drinkConcentration

    await setPouch("/items/guzzling_pouch")
    const withPouch = api.calcChainProfitApi(CHAIN, "有囊")!
    const costYes = withPouch.result.costPH
    const dcYes = api.getChainPlayerConfigSummary(CHAIN).drinkConcentration

    console.log("[p] 无囊：浓度 =", dcNo, " 成本/h =", costNo.toFixed(0))
    console.log("[p] 有囊：浓度 =", dcYes, " 成本/h =", costYes.toFixed(0))
    console.log("[p] 成本差 =", (costYes - costNo).toFixed(0))

    expect(dcNo, "未装备时浓度应为 0").toBe(0)
    expect(dcYes, "装备后浓度应为 0.1").toBeCloseTo(0.1, 6)
    /**
     * 暴饮之囊让饮品「效果 ×(1+浓度)、时长 ÷(1+浓度)」⇒ 喝得更频繁 ⇒ 饮品成本上升。
     * 实测（2026-10-07）：成本由 17,516,088 变为 17,530,214（+14,125）。
     * 关键是**成本必须变**，否则说明配置没接进计算。
     */
    expect(costYes, "装上暴饮之囊后成本必须变化（否则配置没生效）").not.toBe(costNo)
    expect(costYes, "时长按 1+浓度 缩短 ⇒ 饮品消耗增加 ⇒ 成本上升").toBeGreaterThan(costNo)

    await setPouch(null)
  }, 300000)

  it("② 每步的饮品出现在 stepSummary.teas（不再被完全隐藏）", async () => {
    const api = await import("@/common/apis/chainbuilder")
    const sum = api.getChainStepSummary(CHAIN[1])!
    console.log("[p] 转化 crushed_sunstone 的饮品:", sum.teas.map(t => `${t.name}×${t.count.toFixed(4)}`).join(", "))
    console.log("[p] （对照）原料:", sum.inputs.map(i => i.name).join(", "))

    expect(sum.teas.length, "该动作配了饮品，stepsSummary 里应能列出").toBeGreaterThan(0)
    const teaHrids = new Set(sum.teas.map(t => t.hrid))
    // 饮品与「配方原料」是两个集合，不应混在一起（否则新手会以为要自己造茶）
    for (const i of sum.inputs) {
      expect(teaHrids.has(i.hrid), `饮品 ${i.hrid} 不该同时出现在 inputs 里`).toBe(false)
    }
  }, 300000)

  it("② 页面上真的渲染出「玩家配置」卡与「收入 / h」列", async () => {
    const { mount } = await import("@vue/test-utils")
    const { createRouter, createMemoryHistory } = await import("vue-router")
    const { createI18n } = await import("vue-i18n")
    const ElementPlus = (await import("element-plus")).default
    const { pinia } = await import("@/pinia")

    ;(globalThis as any).MutationObserver = class {
      observe() {} disconnect() {} takeRecords() { return [] }
    }
    ;(globalThis as any).ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    }

    await setPouch("/items/guzzling_pouch")

    const i18n = createI18n({
      legacy: false, locale: "zh-cn",
      messages: { "zh-cn": {} }, missingWarn: false, fallbackWarn: false
    })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", name: "X", component: { template: "<div/>" } }]
    })
    await router.push("/")
    await router.isReady()

    const Page = (await import("@/pages/chainbuilder/index.vue")).default
    const w = mount(Page, { global: { plugins: [pinia, router, i18n, ElementPlus] } })
    await new Promise(r => setTimeout(r, 300))

    const vm = w.vm as any
    // 用进阶模式塞进用户那条链，再算一次
    vm.mode = "advanced"
    await new Promise(r => setTimeout(r, 50))
    vm.steps = [
      { project: "制造", action: "crafting", kind: "manufacture", hrid: "/items/crushed_sunstone" },
      { project: "转化", action: "alchemy", kind: "transmute", hrid: "/items/crushed_sunstone", outHrid: "/items/crushed_philosophers_stone", catalystRank: 1 },
      { project: "转化", action: "alchemy", kind: "transmute", hrid: "/items/crushed_philosophers_stone", catalystRank: 1 }
    ]
    await new Promise(r => setTimeout(r, 50))
    vm.calculate()
    await new Promise(r => setTimeout(r, 200))

    const text = w.text().replace(/\s+/g, " ")
    console.log("[p] 含「玩家配置」:", text.includes("玩家配置"))
    console.log("[p] 含「饮品浓度」:", text.includes("饮品浓度"))
    console.log("[p] 含「Guzzling Pouch / 暴饮之囊」:", /Guzzling Pouch|暴饮之囊/.test(text))
    console.log("[p] 含「收入 / h」:", text.includes("收入 / h"))
    console.log("[p] 含「利润 / h（净）」:", text.includes("利润 / h（净）"))

    expect(text, "必须渲染出玩家配置卡").toContain("玩家配置")
    expect(text, "必须显示饮品浓度（用户关心的暴饮之囊）").toContain("饮品浓度")
    expect(text, "必须显式给出收入，用户才能验算利润口径").toContain("收入 / h")
    expect(text, "利润要标成净利，消除口径歧义").toContain("利润 / h（净）")

    await setPouch(null)
    w.unmount()
  }, 300000)
})
