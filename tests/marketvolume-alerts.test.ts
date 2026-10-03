import type { MarketVolumeItem } from "@/common/apis/marketvolume"
import type { AlertRule } from "@/common/apis/marketvolume/alerts"
import { alertKeyOf, createPresetRules, evaluateAlerts, evaluateAlertsByRule, metricValueOf } from "@/common/apis/marketvolume/alerts"
import { describe, expect, it } from "vitest"

/**
 * 市场提醒规则评估的单元测试。
 *
 * `alerts.ts` 是纯函数模块（只 import 类型），所以这里不需要 mock game store / 不需要注入数据。
 * 断言的都是**语义**而非实现细节：命中集合、阈值来源、去重优先级、边界（null/空/零基准）。
 */

/** 默认给足成交，避免 onlyActive 把用例悄悄过滤掉 */
function item(p: Partial<MarketVolumeItem> & { hrid: string }): MarketVolumeItem {
  return {
    name: p.hrid,
    category: "resource",
    itemLevel: 1,
    level: "0",
    ask: 100,
    bid: 99,
    price: 100,
    volume: 100,
    turnover: 10000,
    ...p
  }
}

function rule(p: Partial<AlertRule> = {}): AlertRule {
  return {
    id: "r1",
    enabled: true,
    priority: 100,
    scopeType: "all",
    metric: "volumeRate",
    operator: "gte",
    judge: "absolute",
    threshold: 0,
    onlyActive: true,
    cooldownMinutes: 30,
    ...p
  }
}

describe("市场提醒：绝对值判定", () => {
  const list = [
    item({ hrid: "/items/a", volumeRate: 100 }),
    item({ hrid: "/items/b", volumeRate: 300 }),
    item({ hrid: "/items/c", volumeRate: 500 }),
    item({ hrid: "/items/d", volumeRate: 700 })
  ]

  it("gte：只保留达到阈值的条目", () => {
    const hits = evaluateAlerts(list, [rule({ threshold: 500 })])
    expect(hits.map(h => h.hrid)).toEqual(["/items/d", "/items/c"])
  })

  it("lte：跌幅类规则用负数阈值", () => {
    const rows = [
      item({ hrid: "/items/x", changePct: -5 }),
      item({ hrid: "/items/y", changePct: -25 })
    ]
    const hits = evaluateAlerts(rows, [rule({ metric: "changePct", operator: "lte", threshold: -20 })])
    expect(hits.map(h => h.hrid)).toEqual(["/items/y"])
  })

  it("关闭的规则完全不参与评估", () => {
    expect(evaluateAlerts(list, [rule({ enabled: false, threshold: 0 })])).toEqual([])
  })

  it("阈值为空/非有限数时不产生命中（不把 undefined 当成 0）", () => {
    expect(evaluateAlerts(list, [rule({ threshold: undefined })])).toEqual([])
    expect(evaluateAlerts(list, [rule({ threshold: Number.NaN })])).toEqual([])
  })
})

describe("市场提醒：范围与候选过滤", () => {
  const list = [
    item({ hrid: "/items/sword", category: "equipment", volumeRate: 900 }),
    item({ hrid: "/items/apple", category: "resource", volumeRate: 800 }),
    item({ hrid: "/items/zero", category: "resource", volumeRate: 700, volume: 0, volumeRolling: 0 })
  ]

  it("按分类限定", () => {
    const hits = evaluateAlerts(list, [rule({ scopeType: "category", scopeValue: "resource" })])
    expect(hits.map(h => h.hrid)).toEqual(["/items/apple"])
  })

  it("按指定物品限定", () => {
    const hits = evaluateAlerts(list, [rule({ scopeType: "item", scopeValue: "/items/sword" })])
    expect(hits.map(h => h.hrid)).toEqual(["/items/sword"])
  })

  it("onlyActive=true 时排除零成交条目；关掉后包含", () => {
    const withActive = evaluateAlerts(list, [rule({ onlyActive: true })])
    expect(withActive.map(h => h.hrid)).not.toContain("/items/zero")
    const withoutActive = evaluateAlerts(list, [rule({ onlyActive: false })])
    expect(withoutActive.map(h => h.hrid)).toContain("/items/zero")
  })

  it("指标取不到值（null/undefined）的条目被跳过", () => {
    const rows = [
      item({ hrid: "/items/has", changePct: 30 }),
      item({ hrid: "/items/null", changePct: null }),
      item({ hrid: "/items/missing" })
    ]
    const hits = evaluateAlerts(rows, [rule({ metric: "changePct" })])
    expect(hits.map(h => h.hrid)).toEqual(["/items/has"])
  })
})

describe("市场提醒：相对排行判定", () => {
  const list = [10, 20, 30, 40, 50].map((v, i) =>
    item({ hrid: `/items/v${i}`, volumeRate: v })
  )

  it("topN + gte：取最大的 N 个，阈值记为第 N 名的取值", () => {
    const hits = evaluateAlerts(list, [
      rule({ judge: "relative", relativeMode: "topN", relativeValue: 2 })
    ])
    expect(hits.map(h => h.hrid)).toEqual(["/items/v4", "/items/v3"])
    // 第 2 名的值 40 就是阈值来源
    expect(hits.every(h => h.threshold === 40)).toBe(true)
  })

  it("topN + lte：取最小的 N 个", () => {
    const hits = evaluateAlerts(list, [
      rule({ judge: "relative", relativeMode: "topN", relativeValue: 2, operator: "lte" })
    ])
    expect(hits.map(h => h.hrid)).toEqual(["/items/v0", "/items/v1"])
  })

  it("meanMultiple：阈值 = 候选集合均值 × k", () => {
    // 均值 30；k=1.5 → 45 → 只有 50 达标
    const hits = evaluateAlerts(list, [
      rule({ judge: "relative", relativeMode: "meanMultiple", relativeValue: 1.5 })
    ])
    expect(hits.map(h => h.hrid)).toEqual(["/items/v4"])
    expect(hits[0].threshold).toBeCloseTo(45)
  })

  it("medianMultiple：阈值 = 候选集合中位数 × k", () => {
    // 中位数 30；k=1.5 → 45 → 只有 50 达标
    const hits = evaluateAlerts(list, [
      rule({ judge: "relative", relativeMode: "medianMultiple", relativeValue: 1.5 })
    ])
    expect(hits.map(h => h.hrid)).toEqual(["/items/v4"])
  })

  it("相对判定的参数非法时（N<1 / k<=0 / 缺参）不产生命中", () => {
    expect(evaluateAlerts(list, [rule({ judge: "relative", relativeMode: "topN", relativeValue: 0 })])).toEqual([])
    expect(evaluateAlerts(list, [rule({ judge: "relative", relativeMode: "meanMultiple", relativeValue: 0 })])).toEqual([])
    expect(evaluateAlerts(list, [rule({ judge: "relative", relativeMode: "topN", relativeValue: undefined })])).toEqual([])
  })

  it("基准为 0（全零候选）时不产生命中，避免无意义阈值", () => {
    const zeros = [item({ hrid: "/items/z1", volumeRate: 0 }), item({ hrid: "/items/z2", volumeRate: 0 })]
    expect(evaluateAlerts(zeros, [rule({ judge: "relative", relativeMode: "meanMultiple", relativeValue: 2 })])).toEqual([])
  })
})

describe("市场提醒：多规则的合并与优先级", () => {
  const list = [
    item({ hrid: "/items/a", volumeRate: 900, changePct: 50 }),
    item({ hrid: "/items/b", volumeRate: 100, changePct: 1 })
  ]

  it("同一行命中多条规则时，按优先级取最高的一条作为行标记", () => {
    const rules = [
      rule({ id: "low", priority: 50, metric: "volumeRate", threshold: 0 }),
      rule({ id: "high", priority: 10, metric: "changePct", threshold: 0 })
    ]
    const hits = evaluateAlerts(list, rules)
    const rowA = hits.find(h => h.hrid === "/items/a")
    expect(rowA?.ruleId).toBe("high")
    // 每条规则都命中了 a 与 b，但去重后每行只留一条
    expect(hits.length).toBe(2)
  })

  it("去重不会丢信息：evaluateAlertsByRule 仍能给出逐条规则的全量命中", () => {
    const rules = [
      rule({ id: "low", priority: 50 }),
      rule({ id: "high", priority: 10, metric: "changePct", threshold: 40 })
    ]
    const groups = evaluateAlertsByRule(list, rules)
    expect(groups.map(g => g.rule.id)).toEqual(["low", "high"])
    expect(groups.find(g => g.rule.id === "high")?.hits.map(h => h.hrid)).toEqual(["/items/a"])
    expect(groups.find(g => g.rule.id === "low")?.hits.length).toBe(2)
  })

  it("结果按优先级升序、其次指标值降序排列", () => {
    // 两条规则命中集合不重叠：changePct 只命中 a（优先 10），volumeRate 只命中 b（优先 20）
    const rules = [
      rule({ id: "p20", priority: 20, metric: "volumeRate", threshold: 0 }),
      rule({ id: "p10", priority: 10, metric: "changePct", threshold: 40 })
    ]
    const hits = evaluateAlerts(list, rules)
    expect(hits.map(h => h.hrid)).toEqual(["/items/a", "/items/b"])
    expect(hits[0].priority).toBe(10)
    expect(hits[hits.length - 1].priority).toBe(20)
  })

  it("没有启用任何规则时返回空数组", () => {
    expect(evaluateAlerts(list, [])).toEqual([])
    expect(evaluateAlertsByRule(list, [rule({ enabled: false })])).toEqual([])
  })
})

describe("市场提醒：预置规则与工具函数", () => {
  it("createPresetRules 会消费三个阈值并生成 4 条规则（涨/跌/速率/成交额）", () => {
    const rules = createPresetRules({ changePct: 15, volumeRate: 200, turnover: 5000 })
    expect(rules).toHaveLength(4)
    expect(rules.map(r => r.metric)).toEqual(["changePct", "changePct", "volumeRate", "turnoverRolling"])
    const changeRules = rules.filter(r => r.metric === "changePct")
    expect(changeRules[0].operator).toBe("gte")
    expect(changeRules[0].threshold).toBe(15)
    expect(changeRules[1].operator).toBe("lte")
    // 跌幅规则用负数阈值，且写成 -abs(阈值)，阈值填负数也不会写反
    expect(changeRules[1].threshold).toBe(-15)
    expect(rules.find(r => r.metric === "volumeRate")?.threshold).toBe(200)
    expect(rules.find(r => r.metric === "turnoverRolling")?.threshold).toBe(5000)
    // 预置规则各自有独立 id，便于单独开关/删除
    expect(new Set(rules.map(r => r.id)).size).toBe(4)
  })

  it("metricValueOf 只接受有限数值", () => {
    const row = item({ hrid: "/items/a", volumeRate: 12.5 })
    expect(metricValueOf(row, "volumeRate")).toBe(12.5)
    expect(metricValueOf(item({ hrid: "/items/b", changePct: null }), "changePct")).toBeNull()
    expect(metricValueOf(item({ hrid: "/items/c" }), "turnoverRolling")).toBeNull()
  })

  it("alertKeyOf 与页面的 hrid|level 约定一致", () => {
    expect(alertKeyOf("/items/sword", "3")).toBe("/items/sword|3")
  })
})
