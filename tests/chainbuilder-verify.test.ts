import { describe, expect, it, beforeAll } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"

describe("chainbuilder 手动产业链验证", () => {
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

  it("项目枚举与可用物品候选", async () => {
    const { getChainProjectOptions, getChainStepItemOptions } = await import("@/common/apis/chainbuilder")
    const projects = getChainProjectOptions()
    expect(projects.length).toBe(11)
    const gatherOpts = getChainStepItemOptions({ project: projects[0].label, action: projects[0].action, kind: projects[0].kind })
    expect(gatherOpts.length).toBeGreaterThan(0)
    expect(gatherOpts.some(o => o.hrid === "/items/azure_milk")).toBe(true)
  })

  it("采集->制造 跨项目链：挤奶 azure_milk -> 奶酪制造 azure_cheese", async () => {
    const { calcChainProfitApi } = await import("@/common/apis/chainbuilder")
    const wf = calcChainProfitApi(
      [
        { project: "挤奶", action: "milking", kind: "gather", hrid: "/items/azure_milk" },
        { project: "锻造", action: "cheesesmithing", kind: "manufacture", hrid: "/items/azure_cheese" }
      ],
      "测试链1"
    )
    expect(wf).not.toBeNull()
    if (wf) {
      expect(Number.isFinite(wf.result.profitPH)).toBe(true)
      expect(Number.isFinite(wf.result.incomePH)).toBe(true)
      expect(wf.resultList.length).toBe(2)
      // 第2段衔接：alignHrid 指向 azure_milk，且下游原料价格被覆盖为 0（内部流转）
      const cal1 = wf.calculatorList[1] as any
      expect(cal1.config?.alignHrid).toBe("/items/azure_milk")
      const cfgList = cal1.ingredientPriceConfigList || []
      expect(cfgList.some((c: any) => c.price === 0)).toBe(true)
      // 下游实际原料价格应为 0（azure_milk 是 azure_cheese 的原料）
      const ing = cal1.ingredientListWithPrice?.find((x: any) => x.hrid === "/items/azure_milk")
      expect(ing?.price ?? null).toBe(0)
    }
  })

  it("制造2段升级链：arcane_lumber -> arcane_bow", async () => {
    const { calcChainProfitApi } = await import("@/common/apis/chainbuilder")
    const wf = calcChainProfitApi(
      [
        { project: "制造", action: "crafting", kind: "manufacture", hrid: "/items/arcane_lumber" },
        { project: "制造", action: "crafting", kind: "manufacture", hrid: "/items/arcane_bow" }
      ],
      "测试链2"
    )
    expect(wf).not.toBeNull()
    if (wf) {
      expect(Number.isFinite(wf.result.profitPH)).toBe(true)
      expect(wf.resultList.length).toBe(2)
      const cal1 = wf.calculatorList[1] as any
      expect(cal1.config?.alignHrid).toBe("/items/arcane_lumber")
      const cfgList = cal1.ingredientPriceConfigList || []
      expect(cfgList.some((c: any) => c.price === 0)).toBe(true)
    }
  })

  it("制造->转化->制造 3段链：acrobatic_hood -> philosophers_stone -> crushed_philosophers_stone", async () => {
    const { calcChainProfitApi } = await import("@/common/apis/chainbuilder")
    const wf = calcChainProfitApi(
      [
        { project: "裁缝", action: "tailoring", kind: "manufacture", hrid: "/items/acrobatic_hood" },
        { project: "转化", action: "alchemy", kind: "transmute", hrid: "/items/acrobatic_hood", outHrid: "/items/philosophers_stone" },
        { project: "制造", action: "crafting", kind: "manufacture", hrid: "/items/crushed_philosophers_stone" }
      ],
      "测试链3"
    )
    expect(wf).not.toBeNull()
    if (wf) {
      expect(Number.isFinite(wf.result.profitPH)).toBe(true)
      expect(wf.resultList.length).toBe(3)
      // 炼金中间环节 alignProductHrid 已指定下游产物
      expect((wf.calculatorList[1] as any).config?.alignProductHrid).toBe("/items/philosophers_stone")
    }
  })

  it("无效环节返回 null（物品不属于该项目可用物）", async () => {
    const { calcChainProfitApi } = await import("@/common/apis/chainbuilder")
    // 奶酪不是挤奶动作的可用物（挤奶仅奶牛类）
    const wf = calcChainProfitApi(
      [{ project: "挤奶", action: "milking", kind: "gather", hrid: "/items/azure_cheese" }],
      "测试链4"
    )
    expect(wf).toBeNull()
    expect(calcChainProfitApi([], "空")).toBeNull()
  })
})
