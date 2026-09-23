import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/common/apis/game", () => ({
  getGameDataApi: vi.fn(),
  getMarketDataApi: vi.fn()
}))

import { getGameDataApi, getMarketDataApi } from "@/common/apis/game"
import { getMarketVolumeList, enhanceLevelSuffix } from "@/common/apis/marketvolume"

/**
 * 市场档位 = 强化等级。
 *
 * 官方 marketplace.json 的结构是 `marketData[hrid][level]`，其中 `level` 是
 * **强化等级**（0~20），不是物品等级 —— 同一件装备每个有报价的档位都是一条独立
 * 记录（例如 /items/holy_chisel 有 0/2/3/4/5/6/7/8/10/11/12 共 11 档）。
 *
 * 之前页面在名称后面拼的是 `itemLevel`，于是这 11 档全部显示成同一个
 * 「神圣凿子 Lv80」：既看不出是强化档，档位之间也无法区分。
 * 这里把「一行一档、level 与 itemLevel 是两个不同的东西」钉住。
 */
describe("市场监控的强化档位", () => {
  beforeEach(() => {
    vi.mocked(getGameDataApi).mockReturnValue({
      itemDetailMap: {
        "/items/holy_chisel": {
          hrid: "/items/holy_chisel",
          name: "Holy Chisel",
          categoryHrid: "/item_categories/equipment",
          itemLevel: 80
        }
      }
    } as any)
    // 仿官方结构：只有部分档位有报价
    vi.mocked(getMarketDataApi).mockReturnValue({
      timestamp: 0,
      marketData: {
        "/items/holy_chisel": {
          0: { ask: 1370000, bid: 1350000, price: 1360000, volume: 13 },
          2: { ask: 1500000, bid: -1, price: 1500000, volume: 1 },
          10: { ask: 9_000_000, bid: -1, price: 9_000_000, volume: 0 }
        }
      }
    } as any)
  })

  it("每个强化档位各自成行，level 是档位、itemLevel 保持不变", () => {
    const rows = getMarketVolumeList()
    expect(rows.map((r) => r.level)).toEqual(["0", "2", "10"])
    // 同一件装备的所有档位共用同一个物品等级
    expect(rows.every((r) => r.itemLevel === 80)).toBe(true)
    // 档位之间必须可区分（这正是原 bug 破坏的性质）
    // 模板里是「名称 + 空格 + 后缀」，这里按同样方式拼出显示文本
    const labels = rows.map((r) => [r.name, enhanceLevelSuffix(r.level)].filter(Boolean).join(" "))
    expect(new Set(labels).size).toBe(3)
    expect(labels).toEqual(["Holy Chisel", "Holy Chisel +2", "Holy Chisel +10"])
  })

  it("行 key（hrid + level）唯一，不会因为同物品多档而互相覆盖", () => {
    const keys = getMarketVolumeList().map((r) => r.hrid + r.level)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("enhanceLevelSuffix 只反映强化等级，与物品等级无关", () => {
    expect(enhanceLevelSuffix("0")).toBe("")
    expect(enhanceLevelSuffix(0)).toBe("")
    expect(enhanceLevelSuffix("")).toBe("")
    expect(enhanceLevelSuffix("2")).toBe("+2")
    expect(enhanceLevelSuffix("10")).toBe("+10")
    expect(enhanceLevelSuffix(20)).toBe("+20")
    // 关键：绝不能把物品等级（80）当成强化等级混进来
    expect(enhanceLevelSuffix("80")).toBe("+80")
  })
})
