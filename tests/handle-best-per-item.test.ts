import { describe, expect, it } from "vitest"
import { handleBestPerItem } from "../src/common/apis/utils"

function fakeCal(name: string, profitPH: number): any {
  return {
    project: `p-${name}-${profitPH}`,
    result: { name, profitPH }
  }
}

describe("handleBestPerItem", () => {
  it("同一物品多条方案只保留时薪最高一条", () => {
    const list = [
      fakeCal("奶酪", 50),
      fakeCal("奶酪", 80),
      fakeCal("奶酪", 60),
      fakeCal("红茶", 30),
      fakeCal("红茶", 90)
    ]
    const out = handleBestPerItem(list)
    expect(out).toHaveLength(2)
    const cheese = out.find(c => c.result.name === "奶酪")
    const tea = out.find(c => c.result.name === "红茶")
    expect(cheese!.result.profitPH).toBe(80)
    expect(tea!.result.profitPH).toBe(90)
  })

  it("不同物品互不影响", () => {
    const list = [fakeCal("小麦", 10), fakeCal("矿石", 20)]
    expect(handleBestPerItem(list)).toHaveLength(2)
  })

  it("空列表返回空", () => {
    expect(handleBestPerItem([])).toHaveLength(0)
  })

  it("profitPH 为 NaN 时兜底不干扰最优判断", () => {
    const list = [
      fakeCal("红茶", NaN),
      fakeCal("红茶", 42)
    ]
    const out = handleBestPerItem(list)
    expect(out).toHaveLength(1)
    expect(out[0].result.profitPH).toBe(42)
  })
})
