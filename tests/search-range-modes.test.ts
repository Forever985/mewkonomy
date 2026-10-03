import { describe, expect, it } from "vitest"
import { handleSearch } from "@/common/apis/utils"

/**
 * 检索页区间条件的**模式化行为**测试
 *
 * 上一轮 `handle-search-parity.test.ts` 锁的是「改造前的旧语义」，本文件锁的是
 * 「接入 9 种模式后，新语义确实生效，且旧语义一字未变」。
 *
 * 模式元数据放在 `${minKey}__mode` / `${minKey}__tolerance`，
 * 而 `minKey` / `maxKey` 两个平铺字段照旧读写 —— 这是向后兼容的关键。
 */

function makeCal(over: Record<string, any> = {}) {
  return {
    project: "1步锻造",
    actionLevel: over.actionLevel ?? 10,
    isEquipment: false,
    item: { type: "material" },
    result: {
      name: "奶酪",
      profitPH: 1000,
      profitRate: over.profitRate ?? 0.2,
      risk: over.risk ?? 5
    }
  } as any
}

/** 利润率统一按百分数传入（面板里就是百分数） */
const rate = (v: number) => makeCal({ profitRate: v / 100 })

describe("检索页区间 · 无 __mode 时走旧路径", () => {
  it("只给 minProfitRate ⇒ 相当于 ≥（与改造前一致）", () => {
    const list = [rate(10), rate(30)]
    expect(handleSearch(list, { minProfitRate: 20 })).toHaveLength(1)
  })

  it("只给 maxProfitRate ⇒ 相当于 ≤", () => {
    const list = [rate(10), rate(30)]
    expect(handleSearch(list, { maxProfitRate: 20 })).toHaveLength(1)
  })

  it("两端都给 ⇒ 闭区间", () => {
    const list = [rate(10), rate(20), rate(30)]
    expect(handleSearch(list, { minProfitRate: 20, maxProfitRate: 30 })).toHaveLength(2)
  })

  it("mode=any ⇒ 关闭该条件", () => {
    const list = [rate(10), rate(30)]
    expect(handleSearch(list, { minProfitRate: 20, maxProfitRate: 20, minProfitRate__mode: "any" })).toHaveLength(2)
  })
})

describe("检索页区间 · ≥ / ≤ / = 模式", () => {
  it("≥ 不低于（含端点）", () => {
    const list = [rate(20), rate(30)]
    const out = handleSearch(list, { minProfitRate: 20, minProfitRate__mode: "gte" })
    expect(out).toHaveLength(2)
  })

  it("≤ 不高于（含端点）", () => {
    const list = [rate(20), rate(30)]
    const out = handleSearch(list, { minProfitRate: 20, minProfitRate__mode: "lte" })
    expect(out).toHaveLength(1)
  })

  it("= 等于（单值模式只看 min 侧）", () => {
    const list = [rate(20), rate(30)]
    const out = handleSearch(list, { minProfitRate: 20, minProfitRate__mode: "eq" })
    expect(out).toHaveLength(1)
    expect(out[0].result.profitRate).toBeCloseTo(0.2)
  })
})

describe("检索页区间 · 区间之外", () => {
  it("排除中间那段，端点算在区间内", () => {
    const list = [rate(10), rate(20), rate(30), rate(40)]
    const out = handleSearch(list, {
      minProfitRate: 20,
      maxProfitRate: 30,
      minProfitRate__mode: "outside"
    })
    expect(out.map(c => Math.round(c.result.profitRate * 100))).toEqual([10, 40])
  })

  it("只给一侧 ⇒ 反向下界", () => {
    const list = [rate(10), rate(20)]
    const out = handleSearch(list, { minProfitRate: 20, minProfitRate__mode: "outside" })
    expect(out).toHaveLength(1)
    expect(out[0].result.profitRate).toBeCloseTo(0.1)
  })
})

describe("检索页区间 · 接近（带容差）", () => {
  it("容差内命中，容差外不命中", () => {
    const list = [rate(28), rate(30), rate(35)]
    // 容差键名是 `${minKey}__tolerance`（与 SearchPanel 写入的一致）。
    // 曾经写成 `${minKey}__mode__tolerance`，于是容差读不到、near 静默退化成 =，
    // 而两种情况**都返回了看起来合理的结果**——只有对比"带/不带容差"才暴露。
    const out = handleSearch(list, {
      minProfitRate: 30,
      minProfitRate__mode: "near",
      minProfitRate__tolerance: 2
    })
    expect(out.map(c => Math.round(c.result.profitRate * 100))).toEqual([28, 30])
    // 同一份数据去掉容差 ⇒ 退化为等于，只剩 30
    expect(handleSearch(list, { minProfitRate: 30, minProfitRate__mode: "near" }))
      .toHaveLength(1)
  })

  it("未填容差 ⇒ 退化为 =", () => {
    const list = [rate(30), rate(31)]
    const out = handleSearch(list, { minProfitRate: 30, minProfitRate__mode: "near" })
    expect(out).toHaveLength(1)
  })
})

describe("检索页区间 · 风险与等级也走同一套模式", () => {
  it("风险用 outside 模式", () => {
    const list = [makeCal({ risk: 1 }), makeCal({ risk: 10 }), makeCal({ risk: 50 })]
    const out = handleSearch(list, { minRisk: 5, maxRisk: 40, minRisk__mode: "outside" })
    expect(out.map(c => c.result.risk)).toEqual([1, 50])
  })

  it("要求等级用 ≥ 模式（actionLevel）", () => {
    const list = [makeCal({ actionLevel: 5 }), makeCal({ actionLevel: 30 }), makeCal({ actionLevel: 60 })]
    const out = handleSearch(list, { minLevel: 30, minLevel__mode: "gte" })
    expect(out.map(c => c.actionLevel)).toEqual([30, 60])
  })
})

describe("检索页区间 · 缺失值与未启用", () => {
  it("条件启用但记录缺该值 ⇒ 不命中（不会把空值放进来）", () => {
    const list = [{ ...makeCal(), result: { name: "x", profitPH: 1 } } as any]
    // profitRate 缺失 + 条件启用 ⇒ 排除
    expect(handleSearch(list, { minProfitRate: 10, minProfitRate__mode: "gte" })).toHaveLength(0)
  })

  it("只切了模式没填阈值 ⇒ 条件未生效（列表不被清空）", () => {
    const list = [rate(10), rate(30)]
    expect(handleSearch(list, { minProfitRate__mode: "gte" })).toHaveLength(2)
    expect(handleSearch(list, { minProfitRate__mode: "outside" })).toHaveLength(2)
    expect(handleSearch(list, { minProfitRate__mode: "near" })).toHaveLength(2)
  })

  it("非法模式字符串 ⇒ 退回旧路径，不抛错", () => {
    const list = [rate(10), rate(30)]
    expect(handleSearch(list, { minProfitRate: 20, minProfitRate__mode: "乱写" as any })).toHaveLength(1)
  })
})
