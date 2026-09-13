import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/common/apis/game", () => ({
  getGameDataApi: vi.fn(),
  getMarketDataApi: vi.fn()
}))

import { getGameDataApi, getMarketDataApi } from "@/common/apis/game"
import { getMarketVolumeList, getMarketCategoryOptions, getMarketVolumeSummary } from "@/common/apis/marketvolume"

describe("marketvolume 市场贸易量监控验证", () => {
  beforeEach(() => {
    vi.mocked(getGameDataApi).mockReturnValue({
      itemDetailMap: {
        "/items/apple": { name: "Apple", categoryHrid: "/item_categories/consumable", itemLevel: 1 },
        "/items/sword": { name: "Sword", categoryHrid: "/item_categories/equipment", itemLevel: 5 }
      }
    } as any)
    vi.mocked(getMarketDataApi).mockReturnValue({
      marketData: {
        "\/items\/apple": { 0: { ask: 100, bid: 90, price: 95, volume: 1200 } },
        "\/items\/sword": { 0: { ask: 5000, bid: 4800, price: 4900, volume: 3 }, 1: { ask: 5100, bid: 4900, price: 5000, volume: 8 } }
      },
      timestamp: 0
    } as any)
  })

  it("按物品+档位展开为条目，保留 name/category/itemLevel", () => {
    const list = getMarketVolumeList()
    expect(list.length).toBe(3)
    const apple = list.find((i) => i.hrid === "/items/apple")
    expect(apple?.name).toBe("Apple")
    expect(apple?.category).toBe("consumable")
    expect(apple?.itemLevel).toBe(1)
    const sword0 = list.find((i) => i.hrid === "/items/sword" && i.level === "0")
    expect(sword0?.category).toBe("equipment")
    expect(sword0?.itemLevel).toBe(5)
  })

  it("volume/turnover 计算正确", () => {
    const list = getMarketVolumeList()
    const apple = list.find((i) => i.hrid === "/items/apple")!
    expect(apple.volume).toBe(1200)
    expect(apple.turnover).toBe(95 * 1200)
    const sword1 = list.find((i) => i.hrid === "/items/sword" && i.level === "1")!
    expect(sword1.turnover).toBe(5000 * 8)
  })

  it("价格缺失时 turnover 为 0", () => {
    vi.mocked(getMarketDataApi).mockReturnValue({
      marketData: {
        "\/items\/apple": { 0: { ask: -1, bid: -1, price: -1, volume: 500 } }
      },
      timestamp: 0
    } as any)
    const apple = getMarketVolumeList().find((i) => i.hrid === "/items/apple")!
    expect(apple.price).toBe(-1)
    expect(apple.turnover).toBe(0)
  })

  it("分类选项去重排序", () => {
    const list = getMarketVolumeList()
    expect(getMarketCategoryOptions(list)).toEqual(["consumable", "equipment"])
  })

  it("汇总：active / topVolume / topTurnover", () => {
    const list = getMarketVolumeList()
    const summary = getMarketVolumeSummary(list)
    expect(summary.total).toBe(3)
    expect(summary.active).toBe(3)
    expect(summary.topVolume?.hrid).toBe("/items/apple")
    expect(summary.topTurnover?.hrid).toBe("/items/apple")
    expect(summary.topVolumeSum).toBe(1200 + 8 + 3)
  })

  it("无成交条目不进入 active，topVolume 为 null", () => {
    vi.mocked(getMarketDataApi).mockReturnValue({
      marketData: {
        "\/items\/apple": { 0: { ask: 100, bid: 90, price: 95, volume: 0 } },
        "\/items\/sword": { 0: { ask: 5000, bid: 4800, price: 4900, volume: 0 } }
      },
      timestamp: 0
    } as any)
    const summary = getMarketVolumeSummary(getMarketVolumeList())
    expect(summary.active).toBe(0)
    expect(summary.topVolume).toBeNull()
  })

  it("数据未加载时返回空列表", () => {
    vi.mocked(getGameDataApi).mockReturnValue(null as any)
    vi.mocked(getMarketDataApi).mockReturnValue(null as any)
    expect(getMarketVolumeList()).toEqual([])
    expect(getMarketVolumeSummary([]).total).toBe(0)
  })
})

