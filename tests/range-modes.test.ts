import { describe, expect, it } from "vitest"
import {
  applyRankingFilter,
  isRangeActive,
  matchRange,
  RANKING_MODES,
  type RangeQuery
} from "@/common/utils/query-engine"

/**
 * 区间模式扩展的回归测试
 *
 * 背景：原来只有 `any / gte / lte / between` 四种（市场监控那套）。
 * 用户要求「尽可能多提供接口、窗口，用户可以不用，但不能没有」，
 * 因此补了 `outside / near / eq / topN / bottomN`。
 *
 * 一条硬约束贯穿全部：**缺失阈值 ⇒ 条件未启用（不是匹配空集）**。
 * 用户切到某个模式但还没填数字时，列表必须照常显示，不能瞬间变空。
 */

describe("区间模式 · 未启用判定", () => {
  it("any 永远不生效", () => {
    expect(isRangeActive({ mode: "any", min: 5, max: 10 })).toBe(false)
  })

  it("单阈值模式缺阈值 ⇒ 不生效", () => {
    for (const mode of ["gte", "lte", "eq", "topN", "bottomN"] as const) {
      expect(isRangeActive({ mode }), `${mode} 无 min`).toBe(false)
      expect(isRangeActive({ mode, min: Number.NaN }), `${mode} min=NaN`).toBe(false)
      expect(isRangeActive({ mode, min: 1 }), `${mode} 有 min`).toBe(true)
    }
  })

  it("between / outside 全空 ⇒ 不生效；单边 ⇒ 生效", () => {
    for (const mode of ["between", "outside"] as const) {
      expect(isRangeActive({ mode }), `${mode} 全空`).toBe(false)
      expect(isRangeActive({ mode, min: 1 }), `${mode} 只有 min`).toBe(true)
      expect(isRangeActive({ mode, max: 9 }), `${mode} 只有 max`).toBe(true)
    }
  })

  it("未生效时恒匹配（不会把列表清空）", () => {
    expect(matchRange(42, { mode: "gte" })).toBe(true)
    expect(matchRange(42, { mode: "topN" })).toBe(true)
    expect(matchRange(42, { mode: "any", min: 999 })).toBe(true)
  })

  it("条目无该值时，条件启用则不匹配", () => {
    expect(matchRange(null, { mode: "near", min: 5, tolerance: 1 })).toBe(false)
    expect(matchRange(null, { mode: "any" })).toBe(true)
  })
})

describe("区间模式 · outside（在区间之外）", () => {
  it("双边：排除中间那段，端点算在区间内", () => {
    const r: RangeQuery = { mode: "outside", min: 10, max: 20 }
    expect(matchRange(5, r)).toBe(true)
    expect(matchRange(10, r)).toBe(false)
    expect(matchRange(15, r)).toBe(false)
    expect(matchRange(20, r)).toBe(false)
    expect(matchRange(25, r)).toBe(true)
  })

  it("双边自动对调（填反了不改变含义）", () => {
    const r: RangeQuery = { mode: "outside", min: 20, max: 10 }
    expect(matchRange(15, r)).toBe(false)
    expect(matchRange(5, r)).toBe(true)
  })

  it("单边 ⇒ 反向下界 / 上界", () => {
    expect(matchRange(5, { mode: "outside", min: 10 })).toBe(true)
    expect(matchRange(15, { mode: "outside", min: 10 })).toBe(false)
    expect(matchRange(15, { mode: "outside", max: 10 })).toBe(true)
    expect(matchRange(5, { mode: "outside", max: 10 })).toBe(false)
  })

  it("与 between 互为补集（区间内 vs 区间外）", () => {
    const between: RangeQuery = { mode: "between", min: 10, max: 20 }
    const outside: RangeQuery = { mode: "outside", min: 10, max: 20 }
    for (const v of [0, 5, 10, 15, 20, 25, 100]) {
      expect(matchRange(v, between) === matchRange(v, outside), `v=${v}`).toBe(false)
    }
  })
})

describe("区间模式 · near / eq", () => {
  it("near 按容差带内命中", () => {
    const r: RangeQuery = { mode: "near", min: 30, tolerance: 2 }
    expect(matchRange(30, r)).toBe(true)
    expect(matchRange(32, r)).toBe(true)
    expect(matchRange(28, r)).toBe(true)
    expect(matchRange(33, r)).toBe(false)
    expect(matchRange(20, r)).toBe(false)
  })

  it("near 未填容差 ⇒ 退化为 eq", () => {
    expect(matchRange(30, { mode: "near", min: 30 })).toBe(true)
    expect(matchRange(31, { mode: "near", min: 30 })).toBe(false)
  })

  it("eq 用容差避免浮点误差", () => {
    // 0.1 + 0.2 === 0.30000000000000004，直接比较会不相等
    expect(matchRange(0.1 + 0.2, { mode: "eq", min: 0.3 })).toBe(true)
    expect(matchRange(0.31, { mode: "eq", min: 0.3 })).toBe(false)
  })
})

describe("区间模式 · topN / bottomN（跨条目比较）", () => {
  const rows = [
    { id: "a", vol: 500 },
    { id: "b", vol: 100 },
    { id: "c", vol: 300 },
    { id: "d", vol: 200 },
    { id: "e", vol: null as number | null }
  ]
  const vol = (r: typeof rows[0]) => r.vol

  it("topN 取最大的 N 条", () => {
    const keep = applyRankingFilter(rows, { vol: { mode: "topN", min: 2 } }, vol)
    expect([...keep].map(r => r.id).sort()).toEqual(["a", "c"])
  })

  it("bottomN 取最小的 N 条", () => {
    const keep = applyRankingFilter(rows, { vol: { mode: "bottomN", min: 2 } }, vol)
    expect([...keep].map(r => r.id).sort()).toEqual(["b", "d"])
  })

  it("缺失值永远不入选（无法参与大小比较）", () => {
    for (const n of [1, 3, 10]) {
      const keep = applyRankingFilter(rows, { vol: { mode: "topN", min: n } }, vol)
      expect([...keep].some(r => r.id === "e"), `N=${n}`).toBe(false)
    }
  })

  it("N 超过实际数量时全部入选", () => {
    const keep = applyRankingFilter(rows, { vol: { mode: "topN", min: 99 } }, vol)
    expect(keep.size).toBe(4)
  })

  it("N 非法（0 / 负 / NaN）⇒ 不筛选", () => {
    for (const min of [0, -1, Number.NaN]) {
      const keep = applyRankingFilter(rows, { vol: { mode: "topN", min } }, vol)
      expect(keep.size, `min=${min}`).toBe(rows.length)
    }
  })

  it("多个 ranking 条件取交集", () => {
    const keep = applyRankingFilter(
      rows,
      { vol: { mode: "topN", min: 3 }, id: { mode: "topN", min: 1 } },
      (r, f) => (f === "vol" ? r.vol : r.id === "c" ? 1 : 0.5)
    )
    // vol 前 3 = a,c,d；id 最大 = c ⇒ 交集只有 c
    expect([...keep].map(r => r.id)).toEqual(["c"])
  })

  it("非 ranking 模式被忽略（交由 matchRange 处理）", () => {
    const keep = applyRankingFilter(rows, { vol: { mode: "gte", min: 300 } }, vol)
    expect(keep.size).toBe(rows.length)
  })

  it("RANKING_MODES 与实现一致", () => {
    expect([...RANKING_MODES].sort()).toEqual(["bottomN", "topN"])
  })
})

describe("区间模式 · 与旧语义完全兼容", () => {
  it("gte / lte / between 的边界行为一字未变", () => {
    // 这些断言是上一轮就有的，若行为漂移会立刻暴露
    expect(matchRange(5, { mode: "gte", min: 5 })).toBe(true)
    expect(matchRange(4, { mode: "gte", min: 5 })).toBe(false)
    expect(matchRange(5, { mode: "lte", min: 5 })).toBe(true)
    expect(matchRange(5, { mode: "between", min: 5, max: 10 })).toBe(true)
    expect(matchRange(10, { mode: "between", min: 5, max: 10 })).toBe(true)
    expect(matchRange(7, { mode: "between", min: 10, max: 5 })).toBe(true)
    expect(matchRange(3, { mode: "between", min: 5 })).toBe(false)
    expect(matchRange(7, { mode: "between", min: 5 })).toBe(true)
  })
})
