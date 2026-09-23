import { describe, expect, it, beforeAll } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"

/**
 * 利润排行：组合条件「按行限定要求等级区间」
 *
 * 需求：不同生产能接受的等级区间不同，需要能分别限定。
 *   例如第 1 行「锻造 50~80」、第 2 行「裁缝 20~60」，命中任一即可。
 *
 * 背景：`handleSearch` 的组合条件分支一直支持 `cond.minLevel/maxLevel`（比对 `cal.actionLevel`），
 * 但本页此前**无条件删掉**了 conditions 上的等级字段（当时界面没有对应输入框，残留值会静默失效）。
 * 现在条件行提供了可见的等级区间输入，字段不再被清理，于是这个能力真正可用。
 */
describe("利润排行 按行限定要求等级区间", () => {
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

  it("两行不同生产各自限定不同等级区间，命中任一即保留", async () => {
    const { getLeaderboardDataApi } = await import("@/common/apis/leaderboard")

    const all = await getLeaderboardDataApi({ currentPage: 1, size: 50000 } as any)

    // 从真实数据里挑两个有足够等级分布的生产，避免硬编码过时
    const byProject = new Map<string, number[]>()
    for (const c of all.list as any[]) {
      const p = String(c.project)
      if (!byProject.has(p)) byProject.set(p, [])
      byProject.get(p)!.push(c.actionLevel)
    }
    const candidates = [...byProject.entries()]
      .filter(([p, lv]) => /锻造|裁缝|制造/.test(p) && new Set(lv).size >= 3)
      .slice(0, 2)
    expect(candidates.length, "应能找到至少两个等级分布足够的生产").toBeGreaterThanOrEqual(1)

    const [first, second] = candidates
    const rangeOf = (lv: number[]) => {
      const lo = Math.min(...lv)
      const hi = Math.max(...lv)
      // 取一个真子区间，确保确实有过滤效果
      const mid = Math.round((lo + hi) / 2)
      return { lo, hi, min: mid, max: hi }
    }
    const r1 = rangeOf(first[1])
    const r2 = second ? rangeOf(second[1]) : null

    const conditions: any[] = [{ project: first[0], minLevel: r1.min, maxLevel: r1.max }]
    if (second && r2) {
      conditions.push({ project: second[0], minLevel: r2.min, maxLevel: r2.max })
    }

    const filtered = await getLeaderboardDataApi({ currentPage: 1, size: 50000, conditions } as any)

    const matches = (c: any) => {
      const lv = c.actionLevel
      const p = String(c.project)
      if (p.includes(first[0]) && lv >= r1.min && lv <= r1.max) return true
      if (second && r2 && p.includes(second[0]) && lv >= r2.min && lv <= r2.max) return true
      return false
    }

    const wrong = (filtered.list as any[]).filter((c) => !matches(c))
    console.log(
      `[cond] 条件=${JSON.stringify(conditions)} 命中=${filtered.total}（无过滤 ${all.total}）`
    )
    expect(filtered.total, "带等级区间的条件应产生过滤效果").toBeLessThan(all.total)
    expect(
      wrong.slice(0, 5).map((c) => `${c.project}@${c.actionLevel}`),
      "结果中有不满足任一条件行的条目"
    ).toEqual([])
  })

  it("行间是 OR：只给等级区间而不给动作，也能按等级过滤", async () => {
    const { getLeaderboardDataApi } = await import("@/common/apis/leaderboard")
    const all = await getLeaderboardDataApi({ currentPage: 1, size: 50000 } as any)
    const levels = [...new Set((all.list as any[]).map((c) => c.actionLevel))].sort((a, b) => a - b)
    const lo = levels[0]
    const hi = levels[0]

    const filtered = await getLeaderboardDataApi({
      currentPage: 1,
      size: 50000,
      conditions: [{ minLevel: lo, maxLevel: hi }]
    } as any)
    const outside = (filtered.list as any[]).filter((c) => c.actionLevel < lo || c.actionLevel > hi)
    console.log(`[cond] 仅等级区间 ${lo}~${hi} → 命中=${filtered.total}（无过滤 ${all.total}）`)
    expect(filtered.total).toBeGreaterThan(0)
    expect(outside.length, "仅按等级区间过滤时不应出现区间外条目").toBe(0)
  })

  it("全局「要求等级」与按行区间并存时都会生效", async () => {
    const { getLeaderboardDataApi } = await import("@/common/apis/leaderboard")
    const all = await getLeaderboardDataApi({ currentPage: 1, size: 50000 } as any)
    const levels = [...new Set((all.list as any[]).map((c) => c.actionLevel))].sort((a, b) => a - b)
    const mid = levels[Math.floor(levels.length / 2)]

    // 全局下限 = mid，行内上限 = mid → 只应剩下 actionLevel === mid 附近的条目
    const filtered = await getLeaderboardDataApi({
      currentPage: 1,
      size: 50000,
      minLevel: mid,
      conditions: [{ maxLevel: mid }]
    } as any)
    const bad = (filtered.list as any[]).filter((c) => c.actionLevel < mid || c.actionLevel > mid)
    console.log(`[cond] 全局下限=${mid} 且 行内上限=${mid} → 命中=${filtered.total}`)
    expect(filtered.total).toBeGreaterThan(0)
    expect(bad.slice(0, 5).map((c: any) => `${c.project}@${c.actionLevel}`), "两个层级都应生效").toEqual([])
  })
})
