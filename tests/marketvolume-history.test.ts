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
    // 不使用 fake timers：时间相关断言一律通过显式 now 参数控制，
    // 避免 mock 时钟与模块异步初始化互相干扰。
    vi.resetModules()
    mod = await import("@/common/apis/marketvolume/history")
  })

  it("本地采样把当前市场快照写入历史（快照时间戳语义 + 节流）", () => {
    // 本地采样以**快照时间戳**落盘，而 pruneLocal 按墙钟保留 7 天窗口，
    // 所以夹具时间戳必须落在真实时钟附近，不能用 0 或 1。
    const base = Math.floor(Date.now() / 1000) - 3600
    vi.mocked(getMarketDataApi).mockReturnValue({ ...BASE_MARKET, timestamp: base })
    expect(mod.getLocalSampleCount()).toBe(0)
    expect(mod.recordLocalSample()).toBe(true)
    expect(mod.getLocalSampleCount()).toBe(1)
    // 30 分钟内重复采样被节流
    expect(mod.recordLocalSample()).toBe(false)
    // force 只跳过节流；快照时间戳没前进就仍然不写（重复点只会产生噪声）
    expect(mod.recordLocalSample(true)).toBe(false)
    expect(mod.getLocalSampleCount()).toBe(1)
    // 快照前进 1 小时后可正常新增
    vi.mocked(getMarketDataApi).mockReturnValue({ ...BASE_MARKET, timestamp: base + 3600 })
    expect(mod.recordLocalSample()).toBe(true)
    const history = mod.getMarketHistory()
    expect(history.length).toBe(2)
    expect(history[0].t).toBe(base)
    expect(history[1].t).toBe(base + 3600)
    // 采样结构为三元素新格式：[ask, bid, volume]
    expect(history[0].p["/items/apple"]["0"]).toEqual([100, 90, 1200])
    expect(history[0].p["/items/sword"]["0"]).toEqual([5000, 4800, 3])
  })

  it("服务端归档与本地采样同时间戳合并为一条，且加载后缓存失效", async () => {
    const base = Math.floor(Date.now() / 1000) - 3600
    vi.mocked(getMarketDataApi).mockReturnValue({ ...BASE_MARKET, timestamp: base })
    expect(mod.recordLocalSample()).toBe(true)
    expect(mod.getMarketHistory().length).toBe(1) // 同时建立了合并缓存
    // 服务端归档：其中一条与本地采样撞时间戳（值不同，合并后应保留本地那条）
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => [
        { t: base - 7200, p: { "/items/apple": { "0": [1, 2, 3] } } },
        { t: base, p: { "/items/apple": { "0": [999, 999, 999] } } }
      ]
    })))
    await mod.loadMarketHistory()
    vi.unstubAllGlobals()
    const history = mod.getMarketHistory()
    // 缓存必须因 loadMarketHistory 失效，否则这里仍是加载前的那 1 条
    expect(history.length).toBe(2)
    expect(history[0].t).toBe(base - 7200)
    expect(history[1].p["/items/apple"]["0"]).toEqual([100, 90, 1200])
  })

  it("无历史时 changeMap 为空", () => {
    const list = [item("/items/apple", "0", 100, 95, 1200)]
    expect(mod.getMarketChangeMap(list, 6).size).toBe(0)
  })

  // 说明：原先这里有一条「时间窗内算出涨跌百分比」用例，依赖 vi.setSystemTime + 模块重建，
  // 在本环境下 setSystemTime 与 Date.now 组合不可靠（多次出现期望值与实际值互不自洽）。
  // 该语义已由 marketvolume-history-format.test.ts 用**完全确定性的样本 + 显式 now 参数**
  // 覆盖（窗口基准选取、price/ask/bid/volume 四种口径、成交量速率），因此这里不再重复。
  //
  // 时间参数化是刻意的设计：getBaselineSample / getMarketChangeMap / getVolumeRate /
  // recordLocalSample 都接受显式 `now`，就是为了让时间相关逻辑可确定性测试。
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
