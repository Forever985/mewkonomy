import { describe, expect, it, beforeEach, beforeAll, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { loadTestGameData, seedGameData } from "./utils/load-game-data"

/**
 * 市场历史：新旧采样格式兼容 + 涨跌口径
 *
 * 采样点结构在演进中变过一次：
 *   旧：{ t, p: { hrid: { level: [ask, price] } } }
 *   新：{ t, p: { hrid: { level: [ask, bid, volume] } } }
 * 线上归档是滚动累积的，两种会同时存在，所以读取必须两种都认。
 * 另外 volume 是「当日累计成交量」，涨跌必须比增量速率而不是累计绝对值。
 *
 * 测试手法：把历史样本直接写进 localStorage（模块级 localSamples 是**懒读取**，
 * `vi.resetModules()` + 动态 import 后必然读到），并给所有时间相关函数显式传 `now`。
 * 这样完全不需要 mock fetch / mock 时钟。
 */
const T0 = 1_000_000
const SAMPLES = [
  // 旧格式：只有两个元素 [ask, price]
  { t: T0, p: { "/items/apple": { "0": [100, 100] } } },
  // 新格式：三个元素 [ask, bid, volume]
  { t: T0 + 3600, p: { "/items/apple": { "0": [110, 105, 1000] } } },
  { t: T0 + 7200, p: { "/items/apple": { "0": [120, 130, 3000] } } }
]
/** 「现在」＝ 最后一个采样点之后 1 小时 */
const NOW = T0 + 7200 + 3600

function item(overrides: Record<string, any> = {}) {
  return {
    hrid: "/items/apple",
    name: "Apple",
    category: "resource",
    itemLevel: 1,
    level: "0",
    ask: 120,
    bid: 130,
    price: 120,
    volume: 3000,
    turnover: 360000,
    volumeRate: null,
    ...overrides
  } as any
}

async function loadModule() {
  vi.resetModules()
  // resetModules 会丢弃 store 实例，必须重新注入数据，
  // 否则 game API 的模块级 watch 初始化时会读到 null 的 gameData
  const root = process.cwd()
  const gameData = JSON.parse(readFileSync(resolve(root, "public/data/data.json"), "utf-8"))
  const marketData: any = { timestamp: 0, marketData: {} }
  await seedGameData(gameData, marketData)
  return import("@/common/apis/marketvolume/history")
}

describe("marketvolume history 新旧格式与口径", () => {
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

  beforeEach(() => {
    localStorage.clear()
    // 关键：样本必须先落 localStorage，模块 import 时会懒读取它
    localStorage.setItem("mewkonomy-market-history", JSON.stringify(SAMPLES))
  })

  it("窗口起点前最近一个采样点被选为基准（新旧格式都能读）", async () => {
    const mod = await loadModule()
    // now = T0+10800；窗口 2h → cutoff = T0+3600 → 基准是新格式那一点
    expect(mod.getBaselineSample(2, NOW)?.t).toBe(T0 + 3600)
    // 窗口 3h → cutoff = T0 → 基准落到**旧格式**样本，价格仍要读得到
    expect(mod.getBaselineSample(3, NOW)?.t).toBe(T0)
    const change = mod.getMarketChangeMap([item()], 3, "price", NOW).get("/items/apple|0")
    expect(change).toBeTruthy()
    expect(change!.base).toBe(100)
    expect(change!.pct).toBeCloseTo(20, 5)
  })

  it("口径切换：price / ask / bid 各自取到对应字段", async () => {
    const mod = await loadModule()
    // 窗口 2h → 基准 = T0+3600 的新格式样本：[ask=110, bid=105, volume=1000]
    // price 口径取 ask/bid 中点（对旧格式 [ask, price] 同样成立，避免把 bid 当价）
    const price = mod.getMarketChangeMap([item({ price: 120 })], 2, "price", NOW).get("/items/apple|0")
    expect(price!.base).toBeCloseTo((110 + 105) / 2, 5)
    expect(price!.current).toBe(120)
    const ask = mod.getMarketChangeMap([item({ ask: 130 })], 2, "ask", NOW).get("/items/apple|0")
    expect(ask!.base).toBe(110) // index 0
    expect(ask!.current).toBe(130)
    const bid = mod.getMarketChangeMap([item({ bid: 140 })], 2, "bid", NOW).get("/items/apple|0")
    expect(bid!.base).toBe(105) // index 1
    expect(bid!.current).toBe(140)
  })

  it("volume 口径比的是增量速率，而不是累计绝对值", async () => {
    const mod = await loadModule()
    // 基准 volume=1000（T0+3600），当前 3000 → 增量 2000；间隔 = NOW - T0+3600 = 2 小时
    const change = mod.getMarketChangeMap([item({ volume: 3000 })], 2, "volume", NOW).get("/items/apple|0")
    expect(change).toBeTruthy()
    expect(change!.base).toBe(1000)
    expect(change!.deltaVolume).toBe(2000)
    expect(change!.current).toBe(3000)
    expect(change!.hours).toBeCloseTo(2, 5)
  })

  it("成交量速率：跨 UTC 归零（增量为负）时返回 null", async () => {
    const mod = await loadModule()
    expect(mod.getVolumeRate(item({ volume: 500 }), 2, NOW)).toBeNull()
    // 增量 2000 ÷ 2 小时 = 1000 件/小时
    expect(mod.getVolumeRate(item({ volume: 3000 }), 2, NOW)).toBeCloseTo(1000, 0)
  })

  it("旧格式样本没有 volume 时，成交量口径不产出结果（不报错）", async () => {
    const mod = await loadModule()
    // 窗口 3h → 基准是旧格式样本（无 volume）→ volume 口径应跳过
    expect(mod.getMarketChangeMap([item()], 3, "volume", NOW).has("/items/apple|0")).toBe(false)
    // 同一次调用下价格口径仍然正常
    expect(mod.getMarketChangeMap([item()], 3, "price", NOW).has("/items/apple|0")).toBe(true)
  })

  it("本地采样写入的是三元素新格式", async () => {
    const mod = await loadModule()
    const { useGameStoreOutside } = await import("@/pinia/stores/game")
    useGameStoreOutside().marketData = {
      timestamp: 1,
      marketData: { "/items/apple": { 0: { ask: 10, bid: 9, price: 10, volume: 7 } } }
    } as any
    await new Promise(r => setTimeout(r, 0))
    expect(mod.recordLocalSample(true)).toBe(true)
    const stored = JSON.parse(localStorage.getItem("mewkonomy-market-history") || "[]")
    // 注意：本地采样会追加到已存在的 SAMPLES 之后
    const last = stored[stored.length - 1]
    expect(last.p["/items/apple"]["0"]).toEqual([10, 9, 7])
  })
})
