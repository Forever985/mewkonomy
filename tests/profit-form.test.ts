import { beforeAll, describe, expect, it } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"

/**
 * 「填表计算利润」的测试。
 *
 * 最重要的性质：**什么都不改时，结果必须与计算器自己的数字完全一致**
 * （总成本 ≡ costPH、总收入 ≡ incomePH、总利润 ≡ profitPH、总耗时 ≡ 1 小时）。
 * 只要这条成立，"改哪格就是覆盖哪格"才是可解释的。
 *
 * 分两层：手算样例（完全可控）+ 真实计算器（端到端一致性）。
 */

/** 手算样例：材料 2 个 @100、成品 1 个 @1000、税率 4%、1 小时 1 次动作 */
const SAMPLE_STATE = {
  rows: [
    { key: "a", hrid: "/items/tea_leaf", side: "ingredient" as const, perActionCount: 2, price: 100 },
    { key: "p", hrid: "/items/sunstone", side: "product" as const, perActionCount: 1, price: 1000 }
  ],
  actions: 1,
  timeCostPerAction: 3.6e12 // 正好 1 小时
}

describe("填表计算利润：手算样例", () => {
  it("成本/收入/利润/时薪 与手算一致", async () => {
    const { computeProfitForm } = await import("@/common/utils/profit-form")
    const r = computeProfitForm(SAMPLE_STATE)
    expect(r.cost).toBe(200) // 2 × 100
    expect(r.income).toBeCloseTo(960, 10) // 1 × 1000 × 0.96
    expect(r.profit).toBeCloseTo(760, 10)
    expect(r.hours).toBeCloseTo(1, 10)
    expect(r.profitPH).toBeCloseTo(760, 10)
    expect(r.perActionProfit).toBeCloseTo(760, 10)
    expect(r.profitRate).toBeCloseTo(3.8, 10) // 760 / 200
  })

  it("改一格价格，利润按「单价系数 × 数量 × 次数」精确变化", async () => {
    const { computeProfitForm } = await import("@/common/utils/profit-form")
    const edited = {
      ...SAMPLE_STATE,
      rows: SAMPLE_STATE.rows.map(r => (r.key === "a" ? { ...r, price: 230 } : r))
    }
    // 材料从 100 涨到 230：成本 2×230=460，利润 960−460=500
    // 这也正好是「目标时薪反解」里 760→500 算出的临界价 230，两个功能互为佐证
    expect(computeProfitForm(edited).profit).toBeCloseTo(500, 10)
  })

  it("成本为 0 时利润率返回 null（而不是 0，避免把免费材料显示成 0% 利润）", async () => {
    const { computeProfitForm } = await import("@/common/utils/profit-form")
    const free = { ...SAMPLE_STATE, rows: SAMPLE_STATE.rows.filter(r => r.side === "product") }
    expect(computeProfitForm(free).profitRate).toBeNull()
  })

  it("动作次数只放大总量、不改变时薪（时薪对规模不变）", async () => {
    const { computeProfitForm } = await import("@/common/utils/profit-form")
    const one = computeProfitForm(SAMPLE_STATE)
    const many = computeProfitForm({ ...SAMPLE_STATE, actions: 100 })
    expect(many.cost).toBeCloseTo(one.cost * 100, 6)
    expect(many.profitPH).toBeCloseTo(one.profitPH, 6)
  })

  it("金币不课税", async () => {
    const { computeProfitForm } = await import("@/common/utils/profit-form")
    const coin = {
      ...SAMPLE_STATE,
      rows: [{ key: "c", hrid: "/items/coin", side: "product" as const, perActionCount: 100, price: 1 }]
    }
    expect(computeProfitForm(coin).income).toBeCloseTo(100, 10)
  })
})

describe("填表计算利润：动作 → 可选物品的枚举", () => {
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

  it("每个动作都能列出物品，且数量与数据条件一致", async () => {
    const { PROFIT_FORM_ACTIONS, profitFormItemsOf } = await import("@/common/apis/profitform")
    const { getGameDataApi } = await import("@/common/apis/game")
    const gd = getGameDataApi()
    const items = Object.values(gd.itemDetailMap as Record<string, any>)

    // 独立地从原始数据重算期望值，避免"用实现验实现"
    const expected: Record<string, number> = {
      enhance: items.filter(i => !!i.enhancementCosts).length,
      decompose: items.filter(i => !!i.alchemyDetail?.decomposeItems).length,
      transmute: items.filter(i => !!i.alchemyDetail?.transmuteDropTable).length,
      coinify: items.filter(i => !!i.alchemyDetail?.isCoinifiable).length
    }

    for (const def of PROFIT_FORM_ACTIONS) {
      const list = profitFormItemsOf(def.key)
      console.log(`[form] 动作 ${def.key}(${def.label}) 可选物品 ${list.length} 个`)
      expect(list.length, `${def.key} 应能列出物品（列不出来选择器就废了）`).toBeGreaterThan(0)
      if (expected[def.key] != null) {
        expect(list.length, `${def.key} 的数量应与数据条件一致`).toBe(expected[def.key])
      }
    }
  })

  it("选择器列出的物品，计算器必须真的接受（可用性闭环）", async () => {
    const { PROFIT_FORM_ACTIONS, profitFormItemsOf, profitFormKeyOf } = await import("@/common/apis/profitform")
    const { getCalculatorInstance } = await import("@/calculator/utils")

    for (const def of PROFIT_FORM_ACTIONS) {
      const sample = profitFormItemsOf(def.key)[0]
      const config: any = { hrid: sample.hrid, className: def.className }
      const action = def.actionOf ? def.actionOf(sample) : def.action
      if (action) {
        config.action = action
      }
      // 强化计算器的 available 要求这几个等级参数同时成立，缺 protectLevel 会直接判不可用
      if (def.needEnhanceLevel) {
        config.enhanceLevel = def.enhanceLevelDefault ?? 1
      }
      if (def.needProtectLevel) {
        config.protectLevel = def.enhanceLevelDefault ?? 1
      }
      const calc = getCalculatorInstance(config)
      console.log(`[form] ${def.key} 样本 ${sample.hrid} → action=${action} available=${calc.available}`)
      expect(
        calc.available,
        `${def.key} 列出的样本 "${sample.hrid}" 被计算器判定为不可用，说明筛选条件或参数写错了`
      ).toBe(true)
      // action 必须能从物品正确反推出来，否则制造/采集会构造出错误的配方
      if (def.actionOf) {
        expect(action, `${def.key} 应能反推出专业`).toBeTruthy()
        expect(profitFormKeyOf(sample.hrid)).toBeTruthy()
      }
    }
  })
})


describe("填表计算利润：真实计算器的默认值必须与之一致", () => {
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

  it("不改任何格子时，四项聚合值与计算器完全相等", async () => {
    const [{ DecomposeCalculator, TransmuteCalculator }, { computeProfitForm, createFormState }] = await Promise.all([
      import("@/calculator/alchemy"),
      import("@/common/utils/profit-form")
    ])
    const { NS_PER_HOUR } = await import("@/common/utils/profit-form")

    const calcs = [
      new DecomposeCalculator({ hrid: "/items/acrobats_ribbon", enhanceLevel: 0 } as any).run(),
      new TransmuteCalculator({ hrid: "/items/abyssal_essence" } as any).run()
    ]

    const relErr = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b))

    for (const calc of calcs) {
      expect(calc.valid, `${calc.className} 样本应有效`).toBe(true)
      const state = createFormState(calc)
      const r = computeProfitForm(state)

      console.log(
        `[form] ${calc.className}: 成本 ${r.cost.toFixed(2)} vs ${calc.result.costPH.toFixed(2)}`
        + ` | 收入 ${r.income.toFixed(2)} vs ${calc.result.incomePH.toFixed(2)}`
        + ` | 利润 ${r.profit.toFixed(2)} vs ${calc.result.profitPH.toFixed(2)}`
        + ` | 总耗时 ${(r.totalTimeNs / NS_PER_HOUR).toFixed(6)} 小时`
      )

      expect(relErr(r.cost, calc.result.costPH), "总成本应等于 costPH").toBeLessThan(1e-9)
      expect(relErr(r.income, calc.result.incomePH), "总收入应等于 incomePH").toBeLessThan(1e-9)
      expect(relErr(r.profit, calc.result.profitPH), "总利润应等于 profitPH").toBeLessThan(1e-9)
      // 默认动作次数 = 每小时动作数 ⇒ 总耗时恰好 1 小时 ⇒ 时薪 = 利润/h = profitPH
      expect(r.hours, "默认应恰好是 1 小时").toBeCloseTo(1, 9)
      expect(relErr(r.profitPH, calc.result.profitPH), "时薪应等于 profitPH").toBeLessThan(1e-9)
    }
  })

  it("手填买价后，差额等于「数量 × 系数 × 差价」（与实时价格无关）", async () => {
    const [{ DecomposeCalculator }, { computeProfitForm, createFormState }] = await Promise.all([
      import("@/calculator/alchemy"),
      import("@/common/utils/profit-form")
    ])
    const calc = new DecomposeCalculator({ hrid: "/items/acrobats_ribbon", enhanceLevel: 0 } as any).run()
    const state = createFormState(calc)
    const base = computeProfitForm(state)

    // 只改「主要询价物品」那一格的单价，加价 1000
    const target = state.rows[0]
    const edited = {
      ...state,
      rows: state.rows.map(r => (r.key === target.key ? { ...r, price: r.price + 1000 } : r))
    }
    const after = computeProfitForm(edited)

    const expectedDelta = -target.perActionCount * state.actions * 1000
    console.log(
      `[form] 主要物品 ${target.hrid} 单次数量=${target.perActionCount.toFixed(6)} 次数=${state.actions.toFixed(2)}`
      + ` → 加价 1000 使利润变化 ${(after.profit - base.profit).toFixed(2)}（期望 ${expectedDelta.toFixed(2)}）`
    )
    expect(after.profit - base.profit).toBeCloseTo(expectedDelta, 4)
  })
})
