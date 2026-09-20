import { describe, expect, it } from "vitest"
import { handleSort, parseSortRules } from "@/common/apis/utils"

/**
 * 多级排序（排序优先级）验证
 *
 * 语义：`sortRules[0]` 是主优先级（分组依据），`sortRules[1]` 在主优先级取值相同的结果内生效。
 * 这里用最小假对象直接验证比较逻辑，不依赖真实游戏数据。
 */
function fake(profitPH: number, profitRateFormat: string, actionLevel = 1) {
  return { result: { profitPH, profitRateFormat }, actionLevel } as any
}

describe("handleSort 多级排序", () => {
  it("单条规则：按利润率展示值分组，组内保持时薪降序（默认兜底）", () => {
    const list = [
      fake(300, "10.00%"),
      fake(500, "10.00%"),
      fake(100, "20.00%"),
      fake(900, "5.00%")
    ]
    handleSort(list, { sortRules: [{ prop: "result.profitRateFormat", order: "descending" }] })
    // 第一优先级把结果分成 20% / 10% / 5% 三组；组内按默认的时薪降序
    expect(list.map(i => `${i.result.profitRateFormat}:${i.result.profitPH}`)).toEqual([
      "20.00%:100",
      "10.00%:500",
      "10.00%:300",
      "5.00%:900"
    ])
  })

  it("两级优先级：主优先级分组、次优先级在组内排序", () => {
    const list = [
      fake(300, "10.00%"),
      fake(500, "10.00%"),
      fake(100, "20.00%"),
      fake(400, "20.00%")
    ]
    handleSort(list, {
      sortRules: [
        { prop: "result.profitRateFormat", order: "descending" },
        { prop: "result.profitPH", order: "ascending" }
      ]
    })
    expect(list.map(i => `${i.result.profitRateFormat}:${i.result.profitPH}`)).toEqual([
      "20.00%:100",
      "20.00%:400",
      "10.00%:300",
      "10.00%:500"
    ])
  })

  it("多级优先级：前序全部相等时才轮到后面的规则", () => {
    const list = [
      { result: { profitPH: 10, profitRateFormat: "1%" }, actionLevel: 2 },
      { result: { profitPH: 10, profitRateFormat: "1%" }, actionLevel: 1 },
      { result: { profitPH: 10, profitRateFormat: "2%" }, actionLevel: 5 },
      { result: { profitPH: 50, profitRateFormat: "1%" }, actionLevel: 3 }
    ] as any
    handleSort(list, {
      sortRules: [
        { prop: "result.profitPH", order: "descending" },
        { prop: "result.profitRateFormat", order: "descending" },
        { prop: "actionLevel", order: "ascending" }
      ]
    })
    expect(list.map((i: any) => `${i.result.profitPH}/${i.result.profitRateFormat}/${i.actionLevel}`)).toEqual([
      "50/1%/3",
      "10/2%/5",
      "10/1%/1",
      "10/1%/2"
    ])
  })

  it("规则为空时回落到默认的时薪降序", () => {
    const list = [fake(100, "1%"), fake(900, "1%"), fake(500, "1%")]
    handleSort(list, { sortRules: [] })
    expect(list.map(i => i.result.profitPH)).toEqual([900, 500, 100])
  })

  it("向后兼容：旧的单条 sort 参数仍然生效", () => {
    const list = [fake(100, "1%"), fake(900, "2%"), fake(500, "3%")]
    handleSort(list, { sort: { prop: "result.profitPH", order: "ascending" } })
    expect(list.map(i => i.result.profitPH)).toEqual([100, 500, 900])
  })

  it("parseSortRules 会过滤非法规则，并优先采用 sortRules", () => {
    expect(parseSortRules({ sortRules: [] })).toEqual([])
    expect(parseSortRules({ sort: { prop: "a", order: "bogus" } })).toEqual([])
    expect(parseSortRules({ sortRules: [{ prop: "a" }, { prop: "b", order: "ascending" }] })).toEqual([
      { prop: "b", order: "ascending" }
    ])
    expect(parseSortRules({ sortRules: [{ prop: "x", order: "descending" }], sort: { prop: "y", order: "ascending" } })).toEqual([
      { prop: "x", order: "descending" }
    ])
  })

  it("缺失值不参与比较方向，统一排在前面（null 视为最小）", () => {
    const list = [
      { result: { profitPH: 10, profitRateFormat: "1%" }, actionLevel: undefined },
      { result: { profitPH: 10, profitRateFormat: "1%" }, actionLevel: 7 }
    ] as any
    handleSort(list, { sortRules: [{ prop: "actionLevel", order: "descending" }] })
    expect(list.map((i: any) => i.actionLevel)).toEqual([7, undefined])
  })
})
