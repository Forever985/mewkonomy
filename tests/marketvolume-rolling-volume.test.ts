import { describe, expect, it, vi } from "vitest"

// marketvolume/index.ts 引 game API，其模块顶层有 watch(immediate) 会读 gameData；
// 本用例只测纯计算，直接 mock 掉（与 marketvolume-history.test.ts 同一手法）。
vi.mock("@/common/apis/game", () => ({
  getGameDataApi: vi.fn(),
  getMarketDataApi: vi.fn()
}))

import { getMarketDataApi } from "@/common/apis/game"
import type { MarketVolumeItem } from "@/common/apis/marketvolume"

/**
 * 时间窗内**滚动成交量**。
 *
 * 官方 `v` 是「当日累计成交量」（UTC 0 点归零），所以：
 *   - 同一 UTC 日：相邻采样点相减 = 该区间真实成交量，精确；
 *   - 跨 UTC 归零点：0 点之前的累计量已被官方抹掉、无法还原，只能拿到
 *     「自今日 0 点起」的累计，因此覆盖率 < 100%。
 * 这些用例把两种情形都钉住，避免以后又把「昨天的累计」当今天的增量。
 */
const HOUR = 3600
const DAY = 24 * HOUR
/** 用一个固定的 UTC 零点做基准，保证跨日判断与真实日历无关 */
const MIDNIGHT = Math.floor(1_700_000_000 / DAY) * DAY

type HistoryMod = typeof import("@/common/apis/marketvolume/history")

function sample(t: number, ask: number, bid: number, volume: number) {
  return { t, p: { "/items/apple": { "0": [ask, bid, volume] } } }
}

function item(volume: number, over: Partial<MarketVolumeItem> = {}): MarketVolumeItem {
  return {
    hrid: "/items/apple",
    level: "0",
    name: "apple",
    category: "resource",
    itemLevel: 1,
    ask: 100,
    bid: 90,
    price: 95,
    volume,
    turnover: 0,
    ...over
  } as MarketVolumeItem
}

async function loadWith(samples: unknown[]) {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem("mewkonomy-market-history", JSON.stringify(samples))
  vi.mocked(getMarketDataApi).mockReturnValue({ timestamp: 0, marketData: {} } as any)
  return (await import("@/common/apis/marketvolume/history")) as HistoryMod
}

describe("getRollingVolumeDetail（时间窗内滚动成交量）", () => {
  it("同一 UTC 日：精确累加相邻采样点的增量，覆盖率为 1", async () => {
    // 三个采样点都在同一天：+0h=100, +2h=160, +4h=260
    const mod = await loadWith([
      sample(MIDNIGHT + 1 * HOUR, 100, 90, 100),
      sample(MIDNIGHT + 3 * HOUR, 100, 90, 160),
      sample(MIDNIGHT + 5 * HOUR, 100, 90, 260)
    ])
    const now = MIDNIGHT + 5 * HOUR
    // 窗口 4h → 基准 = 窗口起点前最近的点 = +1h（vol 100）
    const d = mod.getRollingVolumeDetail(item(260), 4, now)!
    expect(d).toBeTruthy()
    // 增量 = (160-100) + (260-160) = 160
    expect(d.volume).toBe(160)
    expect(d.hours).toBeCloseTo(4, 5)
    expect(d.knownHours).toBeCloseTo(4, 5)
    expect(d.coverage).toBeCloseTo(1, 5)
    expect(d.crossings).toBe(0)
  })

  it("跨 UTC 归零点：只统计 0 点之后的部分，覆盖率如实下降", async () => {
    // 前一天 22:00 记到 300；次日 02:00 变 50（已归零，自 0 点起成交 50）
    const mod = await loadWith([
      sample(MIDNIGHT - 2 * HOUR, 100, 90, 300),
      sample(MIDNIGHT + 2 * HOUR, 100, 90, 50)
    ])
    const now = MIDNIGHT + 2 * HOUR
    const d = mod.getRollingVolumeDetail(item(50), 4, now)!
    expect(d).toBeTruthy()
    // 只说得出「0 点后成交了 50」；0 点前那 2 小时无从得知
    expect(d.volume).toBe(50)
    expect(d.hours).toBeCloseTo(4, 5)
    expect(d.knownHours).toBeCloseTo(2, 5)
    expect(d.coverage).toBeCloseTo(0.5, 5)
    expect(d.crossings).toBe(1)
  })

  it("一天当中任何时刻都可比：滚动量不因 UTC 归零而整体变小", async () => {
    // 场景：跨过 UTC 零点后，官方累计量从 0 重新开始。
    // 若直接显示官方累计量，零点前后会从 900 掉到 20（看起来像「突然没人买」）；
    // 滚动量则继续累加，不出现这种断崖。
    const samples = [
      sample(MIDNIGHT - 3 * HOUR, 100, 90, 600),
      sample(MIDNIGHT - 1 * HOUR, 100, 90, 900),
      sample(MIDNIGHT + 2 * HOUR, 100, 90, 20)
    ]
    const mod = await loadWith(samples)
    // 零点前：窗口 2h，基准 = −3h(600) → 增量 300
    const before = mod.getRollingVolumeDetail(item(900), 2, MIDNIGHT - 1 * HOUR)!
    expect(before.volume).toBe(300)
    // 零点后 2 小时：窗口 2h，基准 = −1h(900)，跨日 → 只拿得到今天的 20
    const after = mod.getRollingVolumeDetail(item(20), 2, MIDNIGHT + 2 * HOUR)!
    expect(after.volume).toBe(20)
    expect(after.crossings).toBe(1)
  })

  it("同日累计量减少（数据异常）时该段不计入，也不抛错", async () => {
    const mod = await loadWith([
      sample(MIDNIGHT + 1 * HOUR, 100, 90, 500),
      sample(MIDNIGHT + 3 * HOUR, 100, 90, 400) // 同一天却变少 → 异常
    ])
    const d = mod.getRollingVolumeDetail(item(400), 2, MIDNIGHT + 3 * HOUR)!
    expect(d.volume).toBe(0)
    expect(d.coverage).toBe(0)
  })

  it("历史覆盖不足时退回最老采样点，而不是整列变成 --", async () => {
    // 只有 3 小时历史，却要 168 小时窗口
    const mod = await loadWith([
      sample(MIDNIGHT + 1 * HOUR, 100, 90, 100),
      sample(MIDNIGHT + 3 * HOUR, 100, 90, 250)
    ])
    const d = mod.getRollingVolumeDetail(item(250), 168, MIDNIGHT + 3 * HOUR)!
    expect(d).toBeTruthy()
    expect(d.volume).toBe(150)
    // hours 如实反映「实际只统计了 2 小时」，UI 据此写列头
    expect(d.hours).toBeCloseTo(2, 5)
  })

  it("完全没有历史时返回 null（UI 显示 --）", async () => {
    const mod = await loadWith([])
    expect(mod.getRollingVolumeDetail(item(10), 6, MIDNIGHT)).toBeNull()
  })

  it("旧格式样本（没有 volume 元素）不参与累加，也不报错", async () => {
    const mod = await loadWith([
      { t: MIDNIGHT + 1 * HOUR, p: { "/items/apple": { "0": [100, 100] } } },
      sample(MIDNIGHT + 3 * HOUR, 100, 90, 200)
    ])
    const d = mod.getRollingVolumeDetail(item(200), 2, MIDNIGHT + 3 * HOUR)!
    // 基准点缺 volume → 无从起算（返回 null），而不是把 undefined 当 0
    expect(d).toBeNull()
  })
})
