import type { MarketVolumeItem } from "@/common/apis/marketvolume"
import { createPresetRules, evaluateAlerts, evaluateAlertsByRule } from "@/common/apis/marketvolume/alerts"
import { describe, expect, it, vi, beforeEach } from "vitest"

/**
 * 市场提醒的**集成测试**：走页面真实的那条链路
 * `getMarketVolumeList()` → 回填涨跌/速率/滚动量 → 预置规则 → 命中。
 *
 * 为什么要单独一个文件：`marketvolume-alerts.test.ts` 只用**手工构造**的条目断言纯函数语义，
 * 而这里要挡住的是"两块拼起来才暴露"的问题——列表产出的字段名/类型与规则消费的指标对不对得上、
 * `onlyActive` 会不会把真实数据里的无价条目误当有成交、预置规则的优先级在真实数据上是否合理。
 *
 * 数据刻意做成"每种命中各一条 + 一条谁都不命中"，这样断言可以精确到行与规则。
 */

vi.mock("@/common/apis/game", () => ({
  getGameDataApi: vi.fn(),
  getMarketDataApi: vi.fn()
}))

import { getGameDataApi, getMarketDataApi } from "@/common/apis/game"
import { getMarketVolumeList } from "@/common/apis/marketvolume"

const itemDetailMap = {
  "/items/hoarded": { name: "Hoarded", categoryHrid: "/item_categories/resource", itemLevel: 1 },
  "/items/dumped": { name: "Dumped", categoryHrid: "/item_categories/resource", itemLevel: 1 },
  "/items/quiet": { name: "Quiet", categoryHrid: "/item_categories/resource", itemLevel: 1 },
  "/items/enchanted": { name: "Enchanted", categoryHrid: "/item_categories/equipment", itemLevel: 60 },
  "/items/unsold": { name: "Unsold", categoryHrid: "/item_categories/resource", itemLevel: 1 }
}

/** 市场侧只有官方本来就有的字段：ask / bid / price / volume（`-1` = 无价） */
const marketData = {
  "/items/hoarded": { 0: { ask: 1000, bid: 990, price: 1000, volume: 6000 } },
  "/items/dumped": { 0: { ask: 10, bid: 9, price: 10, volume: 500 } },
  "/items/quiet": { 0: { ask: 50, bid: 49, price: 50, volume: 2 } },
  "/items/enchanted": {
    0: { ask: 2000, bid: 1900, price: 2000, volume: 100 },
    1: { ask: 3000, bid: 2900, price: 3000, volume: 50 }
  },
  "/items/unsold": { 0: { ask: -1, bid: -1, price: -1, volume: 0 } }
}

/**
 * 页面在 `changeApplied` 里回填的那些字段（涨跌 / 速率 / 滚动量）。
 * 这里按 (hrid, level) 手工补上，模拟"历史已加载完"的状态。
 */
const backfill: Record<string, Partial<MarketVolumeItem>> = {
  "/items/hoarded|0": { changePct: 25, volumeRate: 900, volumeRolling: 5400, turnoverRolling: 5_400_000 },
  "/items/dumped|0": { changePct: -30, volumeRate: 80, volumeRolling: 480, turnoverRolling: 4800 },
  "/items/quiet|0": { changePct: 0, volumeRate: 20, volumeRolling: 12, turnoverRolling: 600 },
  "/items/enchanted|0": { changePct: 5, volumeRate: 900, volumeRolling: 5400, turnoverRolling: 12_000_000 },
  "/items/enchanted|1": { changePct: 40, volumeRate: 30, volumeRolling: 180, turnoverRolling: 540_000 },
  "/items/unsold|0": { changePct: null, volumeRate: null, volumeRolling: null, turnoverRolling: null }
}

function buildList(): MarketVolumeItem[] {
  return getMarketVolumeList().map(i => ({ ...i, ...backfill[`${i.hrid}|${i.level}`] }))
}

describe("市场提醒集成：真实列表 → 预置规则 → 命中", () => {
  beforeEach(() => {
    vi.mocked(getGameDataApi).mockReturnValue({ itemDetailMap } as any)
    vi.mocked(getMarketDataApi).mockReturnValue({ marketData, timestamp: 0 } as any)
  })

  it("列表按物品+档位展开，回填后条目数正确", () => {
    const list = buildList()
    // hoarded 1 + dumped 1 + quiet 1 + enchanted 2 + unsold 1 = 6
    expect(list).toHaveLength(6)
    expect(list.map(i => `${i.hrid}|${i.level}`).sort()).toEqual([
      "/items/dumped|0",
      "/items/enchanted|0",
      "/items/enchanted|1",
      "/items/hoarded|0",
      "/items/quiet|0",
      "/items/unsold|0"
    ])
  })

  it("预置规则在真实数据上命中预期的行，且每行只留一条（优先级最高）", () => {
    const rules = createPresetRules({ changePct: 20, volumeRate: 500, turnover: 10_000_000 })
    const hits = evaluateAlerts(buildList(), rules)

    // 每行一条，按优先级升序、同优先级按显著度降序
    expect(hits.map(h => `${h.hrid}|${h.level}`)).toEqual([
      "/items/enchanted|1", // 涨幅 40%（优先级 10，同组内最显著）
      "/items/hoarded|0", // 涨幅 25%（优先级 10）
      "/items/dumped|0", // 跌幅 -30%（优先级 11）
      "/items/enchanted|0" // 成交额 1200 万（优先级 30）+ 速率（优先级 20）→ 取 20
    ])

    // hoarded 同时命中「涨幅」与「速率」两条，最终落点是优先级更高的涨幅
    expect(hits.find(h => h.hrid === "/items/hoarded")?.metric).toBe("changePct")
    // enchanted|0 同时命中「速率」与「成交额」，取优先级 20 的速率
    expect(hits.find(h => h.hrid === "/items/enchanted" && h.level === "0")?.metric).toBe("volumeRate")
  })

  it("quiet（速率 20、涨幅 0）与 unsold（无价无成交）都不命中", () => {
    const rules = createPresetRules({ changePct: 20, volumeRate: 500, turnover: 10_000_000 })
    const keys = evaluateAlerts(buildList(), rules).map(h => `${h.hrid}|${h.level}`)
    expect(keys).not.toContain("/items/quiet|0")
    expect(keys).not.toContain("/items/unsold|0")
  })

  it("onlyActive 挡住无价条目：即使阈值设成 0 也不该把 unsold 捞出来", () => {
    const rules = createPresetRules({ changePct: 0, volumeRate: 0, turnover: 0 })
    const keys = evaluateAlerts(buildList(), rules).map(h => `${h.hrid}|${h.level}`)
    expect(keys).not.toContain("/items/unsold|0")
    // 其余 5 条都有成交，应该都在
    expect(keys).toHaveLength(5)
  })

  it("逐条规则的明细保留全量，不会因每行去重而丢信息", () => {
    const rules = createPresetRules({ changePct: 20, volumeRate: 500, turnover: 10_000_000 })
    const groups = evaluateAlertsByRule(buildList(), rules)
    const rateGroup = groups.find(g => g.rule.metric === "volumeRate")
    // 速率 ≥ 500：hoarded 900 与 enchanted|0 900（enchanted|1 只有 30）
    expect(rateGroup?.hits.map(h => `${h.hrid}|${h.level}`).sort()).toEqual([
      "/items/enchanted|0",
      "/items/hoarded|0"
    ])
    const upGroup = groups.find(g => g.rule.metric === "changePct" && g.rule.operator === "gte")
    expect(upGroup?.hits.map(h => h.hrid).sort()).toEqual(["/items/enchanted", "/items/hoarded"])
  })

  it("页面在「页面内提醒」关闭时传空规则 → 不产生任何命中", () => {
    expect(evaluateAlerts(buildList(), [])).toEqual([])
  })
})
