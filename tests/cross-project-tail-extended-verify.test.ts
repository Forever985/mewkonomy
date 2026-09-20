import { describe, expect, it, beforeAll } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"

describe("manualchemy 综利用尾扩展验证", () => {
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

  it("综利用尾无重复多样、跨项目组合健康", async () => {
    const { getLeaderboardDataApi } = await import("@/common/apis/manualchemy")
    const res: any = await getLeaderboardDataApi({ size: 100000, currentPage: 1 })
    const list: any[] = res.list
    const tailList = list.filter((c: any) => (c.project || "").includes("→"))

    // 1. 检查同一 project 名内是否有重复的最终产物名
    const seen = new Map<string, Set<string>>()
    let dupCount = 0
    for (const c of list) {
      const r = c.result || c
      const key = c.project
      if (!seen.has(key)) seen.set(key, new Set())
      const set = seen.get(key)!
      if (set.has(r.name)) dupCount++
      else set.add(r.name)
    }
    // eslint-disable-next-line no-console
    console.log(`重复(project,产物名)对数=${dupCount}`)

    // 2. 综利用尾自身的重复检查（同 project + 同产物名）
    const seenTail = new Set<string>()
    let tailDup = 0
    for (const c of tailList) {
      const r = c.result || c
      const key = `${c.project}|${r.name}`
      if (seenTail.has(key)) tailDup++
      seenTail.add(key)
    }
    // eslint-disable-next-line no-console
    console.log(`综利用尾重复对数=${tailDup}`)

    // 3. 综利用尾项目命名样本
    const projSet = new Set(tailList.map((c: any) => c.project))
    // eslint-disable-next-line no-console
    console.log(`综利用尾不同 project 名数=${projSet.size}`)
    const projSamples = [...projSet].filter((p: any) => !p.includes("大全套")).slice(0, 20)
    // eslint-disable-next-line no-console
    console.log(`project 名样本=${JSON.stringify(projSamples)}`)

    // 4. 占比统计
    // eslint-disable-next-line no-console
    console.log(`综利用尾占比=${(tailList.length / list.length * 100).toFixed(1)}%`)

    expect(tailDup).toBe(0)
    expect(tailList.length).toBeGreaterThan(100)
  }, 120000)
})
