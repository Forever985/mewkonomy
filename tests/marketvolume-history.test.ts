import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/common/apis/game", () => ({
  getGameDataApi: vi.fn(),
  getMarketDataApi: vi.fn()
}))

import { getMarketDataApi } from "@/common/apis/game"
import type { MarketVolumeItem } from "@/common/apis/marketvolume"

function item(hrid: string, level: string, ask: number, price: number, volume: number): MarketVolumeItem {
  return { hrid, level, name: hrid, category: "x", itemLevel: 1, ask, bid: ask - 1, price, volume, turnover: price * volume }
}

// history.ts 顶层持有模块级 localSamples 缓存，为保证用例相互独立，
// 每个用例通过 vi.resetModules + 动态 import 重建模块（同时复用 vi.mock 的 game mock）。
type HistoryMod = typeof import("@/common/apis/marketvolume/history")

const BASE_MARKET = {
  marketData: {
    "/items/apple": { 0: { ask: 100, bid: 90, price: 95, volume: 1200 } },
    "/items/sword": { 0: { ask: 5000, bid: 4800, price: 4900, volume: 3 } }
  },
  timestamp: 0
} as any

describe("marketvolume history 涨跌计算验证", () => {
  let mod: HistoryMod

  beforeEach(async () => {
    vi.mocked(getMarketDataApi).mockReturnValue(BASE_MARKET)
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-14T12:00:00Z"))
    vi.resetModules()
    mod = await import("@/common/apis/marketvolume/history")
  })

  it("本地采样把当前市场快照写入历史（节流生效）", () => {
    expect(mod.getLocalSampleCount()).toBe(0)
    expect(mod.recordLocalSample()).toBe(true)
    expect(mod.getLocalSampleCount()).toBe(1)
    // 30 分钟内重复采样被节流
    expect(mod.recordLocalSample()).toBe(false)
    // 强制采样跳过节流
    expect(mod.recordLocalSample(true)).toBe(true)
    const history = mod.getMarketHistory()
    expect(history.length).toBe(2)
    expect(history[0].p["/items/apple"]["0"]).toEqual([100, 95])
    expect(history[0].p["/items/sword"]["0"]).toEqual([5000, 4900])
  })

  it("无历史时 changeMap 为空", () => {
    const list = [item("/items/apple", "0", 100, 95, 1200)]
    expect(mod.getMarketChangeMap(list, 6).size).toBe(0)
  })

  it("时间窗内算出涨跌百分比", () => {
    // 先造两条历史采样：6h 前 100、2h 前 105
    vi.setSystemTime(new Date("2026-09-14T06:00:00Z"))
    vi.mocked(getMarketDataApi).mockReturnValue({
      marketData: { "/items/apple": { 0: { ask: 100, bid: 90, price: 100, volume: 1200 } } },
      timestamp: 0
    } as any)
    expect(mod.recordLocalSample()).toBe(true)
    vi.setSystemTime(new Date("2026-09-14T10:00:00Z"))
    vi.mocked(getMarketDataApi).mockReturnValue({
      marketData: { "/items/apple": { 0: { ask: 105, bid: 95, price: 105, volume: 1200 } } },
      timestamp: 0
    } as any)
    expect(mod.recordLocalSample()).toBe(true)

    // 回到"现在"，当前价已变为 110
    vi.setSystemTime(new Date("2026-09-14T12:00:00Z"))
    vi.mocked(getMarketDataApi).mockReturnValue({
      marketData: { "/items/apple": { 0: { ask: 110, bid: 100, price: 110, volume: 1200 } } },
      timestamp: 0
    } as any)
    const list = [item("/items/apple", "0", 110, 110, 1200)]

    // 6 小时窗：基准取窗口起点（06:00）前最近采样 = 100 → +10%
    const map6 = mod.getMarketChangeMap(list, 6)
    expect(map6.size).toBe(1)
    expect(map6.get("/items/apple|0")!.base).toBe(100)
    expect(map6.get("/items/apple|0")!.pct).toBeCloseTo(10, 5)

    // 1 小时窗：基准取窗口起点（11:00）前最近采样 = 10:00 的 105 → ~+4.76%
    const map1 = mod.getMarketChangeMap(list, 1)
    expect(map1.size).toBe(1)
    expect(map1.get("/items/apple|0")!.base).toBe(105)
    expect(map1.get("/items/apple|0")!.pct).toBeCloseTo(110 / 105 * 100 - 100, 5)
  })

  it("基准价缺失或当前价无效时不进入涨跌", () => {
    vi.setSystemTime(new Date("2026-09-14T06:00:00Z"))
    vi.mocked(getMarketDataApi).mockReturnValue({
      marketData: { "/items/apple": { 0: { ask: 100, bid: 90, price: 100, volume: 1200 } } },
      timestamp: 0
    } as any)
    expect(mod.recordLocalSample()).toBe(true)
    vi.setSystemTime(new Date("2026-09-14T12:00:00Z"))
    const list = [
      item("/items/apple", "0", 110, 110, 1),
      item("/items/no_base", "0", 50, 50, 1),
      item("/items/no_price", "0", -1, -1, 1)
    ]
    const map = mod.getMarketChangeMap(list, 6)
    expect(map.has("/items/apple|0")).toBe(true)
    expect(map.has("/items/no_base|0")).toBe(false)
    expect(map.has("/items/no_price|0")).toBe(false)
  })
})
