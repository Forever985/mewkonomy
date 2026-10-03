import { beforeAll, describe, expect, it } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"

/**
 * 「目标时薪 → 临界单价」反解的测试。
 *
 * 分两层：
 * 1. **手算样例**：用完全可控的假计算器对象，把期望的临界价先手推出来再断言 ——
 *    这是独立于实现的验证，能真正证明公式没写反。
 * 2. **真实计算器**：验证「系数模型」能精确复现计算器自己的 costPH / incomePH。
 *    这一步很关键：反解是建立在线性模型上的，只要模型对，反解就对。
 */

/** 手算样例：材料 countPH=2 @100；成品 countPH=1 @1000；税率 4% */
const SAMPLE = {
  consumePH: 1,
  gainPH: 1,
  ingredientListWithPrice: [
    { hrid: "/items/tea_leaf", count: 2, countPH: 2, price: 100, marketPrice: 100 }
  ],
  productListWithPrice: [
    { hrid: "/items/sunstone", count: 1, countPH: 1, price: 1000, marketPrice: 1000, rate: 1 }
  ],
  // profitPH = 0.96×1000 − 2×100 = 760
  result: { profitPH: 760 }
}

describe("反解：手算样例", () => {
  it("材料侧：目标 500 时，最高可买单价 = 230", async () => {
    const { primaryCandidateOf, solvePriceForTarget } = await import("@/common/utils/price-solve")
    const calc = SAMPLE as any
    const cand = primaryCandidateOf(calc)!
    expect(cand.side).toBe("ingredient")
    expect(cand.coefficient, "材料侧系数应为负的每小时用量").toBe(-2)

    const r = solvePriceForTarget(760, cand, 500)!
    // 手算：100 + (500−760)/(−2) = 230；代回成本 2×230=460，利润 960−460=500 ✓
    expect(r.criticalPrice).toBe(230)
    expect(r.priceGap).toBe(130)
    expect(r.impossible).toBe(false)
  })

  it("成品侧：目标 500 时，最低可卖单价 = 729.166…", async () => {
    const { solveCandidatesOf, solvePriceForTarget } = await import("@/common/utils/price-solve")
    const cand = solveCandidatesOf(SAMPLE as any).find(c => c.side === "product")!
    expect(cand.coefficient, "成品侧系数应含 4% 税率").toBeCloseTo(0.96, 10)

    const r = solvePriceForTarget(760, cand, 500)!
    // 手算：1000 − 260/0.96 = 729.1666…；代回收入 0.96×729.1667=700，利润 700−200=500 ✓
    expect(r.criticalPrice).toBeCloseTo(729.1667, 3)
    expect(r.priceGap).toBeLessThan(0)
  })

  it("目标高于当前时薪时：材料临界价下降、成品临界价上升", async () => {
    const { solveCandidatesOf, solvePriceForTarget } = await import("@/common/utils/price-solve")
    const [ing, prod] = solveCandidatesOf(SAMPLE as any)
    expect(solvePriceForTarget(760, ing, 1000)!.criticalPrice).toBe(-20) // 白送都达不到
    expect(solvePriceForTarget(760, ing, 1000)!.impossible).toBe(true)
    expect(solvePriceForTarget(760, prod, 1000)!.criticalPrice).toBeCloseTo(1250, 6)
  })

  it("目标恰好等于当前时薪时，临界价就是当前价（恒等）", async () => {
    const { solveCandidatesOf, solvePriceForTarget } = await import("@/common/utils/price-solve")
    for (const cand of solveCandidatesOf(SAMPLE as any)) {
      expect(solvePriceForTarget(760, cand, 760)!.criticalPrice).toBeCloseTo(cand.price, 10)
    }
  })

  it("金币不课税：作为成品时系数不含税率", async () => {
    const { solveCandidatesOf } = await import("@/common/utils/price-solve")
    const coinCalc = {
      ...SAMPLE,
      productListWithPrice: [{ hrid: "/items/coin", count: 100, countPH: 100, price: 1, marketPrice: 1, rate: 1 }]
    }
    const coin = solveCandidatesOf(coinCalc as any).find(c => c.side === "product")!
    expect(coin.coefficient).toBe(100)
  })

  it("系数为 0（该物品不影响时薪）时返回 null，不返回一个看似合理的假数", async () => {
    const { solveCandidatesOf } = await import("@/common/utils/price-solve")
    const zeroCalc = {
      ...SAMPLE,
      ingredientListWithPrice: [{ hrid: "/items/x", count: 0, countPH: 0, price: 100, marketPrice: 100 }],
      productListWithPrice: []
    }
    expect(solveCandidatesOf(zeroCalc as any)).toHaveLength(0)
  })
})

describe("反解：真实计算器的线性模型校验", () => {
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

  it("主要询价物品 = 被处理的那件东西（分解茶叶→茶叶、转化宝石→宝石）", async () => {
    const [{ DecomposeCalculator, TransmuteCalculator }, { primaryCandidateOf }] = await Promise.all([
      import("@/calculator/alchemy"),
      import("@/common/utils/price-solve")
    ])
    const decompose = new DecomposeCalculator({ hrid: "/items/acrobats_ribbon" } as any)
    const transmute = new TransmuteCalculator({ hrid: "/items/abyssal_essence" } as any)

    expect(decompose.available, "样本应可分解").toBe(true)
    expect(transmute.available, "样本应可转化").toBe(true)

    // 这正是用户描述的语义：分解虚空茶叶，主要询价物品就是虚空茶叶本身
    expect(primaryCandidateOf(decompose)!.hrid, "分解的主要询价物品应是被分解的物品").toBe("/items/acrobats_ribbon")
    expect(primaryCandidateOf(transmute)!.hrid, "转化的主要询价物品应是被转化的物品").toBe("/items/abyssal_essence")
  })

  it("costPH 与 incomePH 可由 countPH 与价格系数精确复现", async () => {
    const [{ DecomposeCalculator, TransmuteCalculator }, { solveCandidatesOf }] = await Promise.all([
      import("@/calculator/alchemy"),
      import("@/common/utils/price-solve")
    ])
    const { MARKET_TAX_FACTOR } = await import("@@/constants/market")

    const relErr = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b))

    for (const calc of [
      new DecomposeCalculator({ hrid: "/items/acrobats_ribbon" } as any).run(),
      new TransmuteCalculator({ hrid: "/items/abyssal_essence" } as any).run()
    ]) {
      expect(calc.valid, `${calc.className} 样本应有效`).toBe(true)
      const cands = solveCandidatesOf(calc)
      const cost = cands.filter(c => c.side === "ingredient").reduce((s, c) => s + c.countPH * c.price, 0)
      const income = cands.filter(c => c.side === "product").reduce((s, c) => {
        const rate = c.hrid === "/items/coin" ? 1 : MARKET_TAX_FACTOR
        return s + rate * c.countPH * c.price
      }, 0)

      console.log(
        `[solve] ${calc.className}: costPH 实际=${calc.result.costPH.toFixed(4)} 模型=${cost.toFixed(4)}`
        + ` | incomePH 实际=${calc.result.incomePH.toFixed(4)} 模型=${income.toFixed(4)}`
      )
      expect(relErr(cost, calc.result.costPH), "成本模型应精确复现 costPH").toBeLessThan(1e-9)
      expect(relErr(income, calc.result.incomePH), "收入模型应精确复现 incomePH").toBeLessThan(1e-9)
      expect(relErr(income - cost, calc.result.profitPH), "时薪 = 收入 − 成本").toBeLessThan(1e-9)
    }
  })

  it("真实数据上：反解出的临界价代回模型即得目标时薪", async () => {
    const [{ DecomposeCalculator }, { primaryCandidateOf, solvePriceForTarget }] = await Promise.all([
      import("@/calculator/alchemy"),
      import("@/common/utils/price-solve")
    ])
    const calc = new DecomposeCalculator({ hrid: "/items/acrobats_ribbon" } as any).run()
    const cand = primaryCandidateOf(calc)!
    const target = calc.result.profitPH + 5_000_000

    const r = solvePriceForTarget(calc.result.profitPH, cand, target)!
    expect(r.impossible, "样本应仍可达成").toBe(false)
    // 用已验证过的线性模型复算
    const back = calc.result.profitPH + cand.coefficient * (r.criticalPrice - cand.price)
    expect(back).toBeCloseTo(target, 4)
    // 目标高于当前时薪时，材料必须买得更便宜
    expect(r.criticalPrice).toBeLessThan(cand.price)
    console.log(
      `[solve] 主要询价物品 ${cand.hrid} 当前 ${cand.price} → 目标时薪 ${target} 需买价 ≤ ${r.criticalPrice.toFixed(2)}`
    )
  })
})

describe("反解：时薪 / 日薪两种口径", () => {
  it("日薪 = 时薪 × 24，且与项目既有的 profitPDFormat 口径一致", async () => {
    const { HOURS_PER_DAY, fromProfitPHOf, toProfitPHOf } = await import("@/common/utils/price-solve")
    expect(HOURS_PER_DAY, "一天的小时数").toBe(24)
    for (const ph of [0, 1, 760, 2239964909.2155, -12.5]) {
      expect(toProfitPHOf(fromProfitPHOf(ph, "day"), "day")).toBeCloseTo(ph, 8)
      expect(fromProfitPHOf(ph, "day")).toBeCloseTo(ph * 24, 8)
      // 时薪口径是恒等变换
      expect(toProfitPHOf(ph, "hour")).toBe(ph)
      expect(fromProfitPHOf(ph, "hour")).toBe(ph)
    }
  })

  it("核心不变量：同一目标收益下，日薪模式与时薪模式解出的临界价完全相同", async () => {
    const { solveCandidatesOf, solvePriceForTarget, toProfitPHOf, HOURS_PER_DAY } = await import(
      "@/common/utils/price-solve"
    )
    for (const cand of solveCandidatesOf(SAMPLE as any)) {
      for (const targetPH of [0, 500, 760, 5000]) {
        const byHour = solvePriceForTarget(760, cand, targetPH)!
        // 同一个目标，改用「日薪」这个数额来写（×24），换算回来必须完全一致
        const byDay = solvePriceForTarget(760, cand, toProfitPHOf(targetPH * HOURS_PER_DAY, "day"))!
        expect(byDay.criticalPrice, `${cand.key} 目标时薪 ${targetPH}`).toBeCloseTo(byHour.criticalPrice, 8)
        expect(byDay.impossible, `${cand.key} 目标时薪 ${targetPH} 的可达性`).toBe(byHour.impossible)
      }
    }
  })

  it("输入框留空 → 回落到当前时薪（面板不能因此消失）", async () => {
    const { resolveTargetProfitPH } = await import("@/common/utils/price-solve")
    // el-input-number 清空时给的是 undefined；也要兜住 null 与 NaN
    for (const blank of [undefined, null, Number.NaN]) {
      expect(resolveTargetProfitPH(760, blank, "hour"), "留空=按当前时薪").toBe(760)
      expect(resolveTargetProfitPH(760, blank, "day"), "留空=按当前时薪（换口径后仍是 760）").toBe(760)
    }
  })

  it("输入框填 0 是有效目标，不能被当成空", async () => {
    const { resolveTargetProfitPH } = await import("@/common/utils/price-solve")
    // 这是最容易写错的一处：若用 `!input` 判空，0 会被误当成"没填"而回落到当前时薪
    expect(resolveTargetProfitPH(760, 0, "hour")).toBe(0)
    expect(resolveTargetProfitPH(760, 0, "day")).toBe(0)
  })

  it("日薪口径下输入框的数额会换算成时薪", async () => {
    const { resolveTargetProfitPH } = await import("@/common/utils/price-solve")
    expect(resolveTargetProfitPH(760, 700, "hour")).toBe(700)
    expect(resolveTargetProfitPH(760, 16_800, "day"), "日薪 16800 = 时薪 700").toBe(700)
  })

  it("目标为 0 时解出的是「不亏本」的临界价（不是不可能）", async () => {
    const { solveCandidatesOf, solvePriceForTarget } = await import("@/common/utils/price-solve")
    // 样例自身是自洽的：材料 2 个/h @100、成本 200；成品 1 个/h @500、收入 500×0.96=480
    // ⇒ 当前时薪 = 480 − 200 = 280
    const sample = {
      ingredientListWithPrice: [{ hrid: "/items/x", count: 2, countPH: 2, price: 100, marketPrice: 100 }],
      productListWithPrice: [{ hrid: "/items/y", count: 1, countPH: 1, rate: 1, price: 500, marketPrice: 500 }],
      consumePH: 1
    }
    const cand = solveCandidatesOf(sample as any)[0]
    const currentPH = 500 * 0.96 - 2 * 100
    expect(currentPH, "样例当前时薪").toBeCloseTo(280, 8)

    const r = solvePriceForTarget(currentPH, cand, 0)!
    expect(r.impossible, "目标 0 是可达的（不亏本即可）").toBe(false)
    // 材料买价涨到 240 时：成本 480、收入 480 ⇒ 利润恰好 0
    expect(r.criticalPrice).toBeCloseTo(240, 8)
    const back = currentPH + cand.coefficient * (r.criticalPrice - cand.price)
    expect(back, "代回线性模型应恰好为 0").toBeCloseTo(0, 8)
  })
})
