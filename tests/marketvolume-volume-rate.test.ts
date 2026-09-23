import { describe, expect, it, beforeEach, beforeAll, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { loadTestGameData, seedGameData } from "./utils/load-game-data"

/**
 * 市场监控「成交量 / 小时」的正确性回归
 *
 * 官方 `volume` 是**当日累计成交量**（每天 UTC 0 点归零），这带来两个曾经出错的地方：
 *
 * 1. **分母用了墙钟**：速率算成 `(当前累计 − 基准累计) / (Date.now() − 基准时刻)`。
 *    后果是页面开着不动，分母持续变大 —— 同一份数据算出的「成交量/小时」自己往下漂；
 *    快照过期时也会被算小。正确做法是在市场快照自身的时间轴（`marketData.timestamp`）上算。
 *
 * 2. **跨 UTC 归零点时增量算错**：
 *    - 若今天的累计量还小于昨天基准（`cur < base`），旧实现直接返回 null，
 *      即使今天确实有成交（显示 `--`）；
 *    - 若今天的累计量已经超过昨天基准，旧实现把 `cur − base` 当成"今天新增"，
 *      但 `cur` 其实已经包含"今天 0 点起"的全部量，于是分母多算了跨日的时长、增量也错。
 *    跨日时正确含义是：`cur` 本身就是「自今天 0 点起」的增量，分母应取「自 0 点起」的时长。
 */
const DAY = 86400 * 20000 // 恰好落在某个 UTC 0 点
/** 前一天 23:00 的采样（作为跨日基准） */
const PREV_2300 = DAY - 3600
/** 「现在」＝当天 02:00（快照时间） */
const NOW = DAY + 7200

const SAMPLES = [
  { t: DAY - 7200, p: { "/items/apple": { "0": [100, 100, 300] } } },
  { t: PREV_2300, p: { "/items/apple": { "0": [100, 100, 1000] } } },
  // 同一天 01:00 的采样：用于验证「同一 UTC 日」分支仍按真实增量计算
  { t: DAY + 3600, p: { "/items/apple": { "0": [100, 100, 200] } } }
]

function item(overrides: Record<string, any> = {}) {
  return {
    hrid: "/items/apple",
    name: "Apple",
    category: "resource",
    itemLevel: 1,
    level: "0",
    ask: 100,
    bid: 100,
    price: 100,
    volume: 1000,
    turnover: 0,
    volumeRate: null,
    ...overrides
  } as any
}

async function loadModule(snapshotTimestamp: number) {
  vi.resetModules()
  const root = process.cwd()
  const gameData = JSON.parse(readFileSync(resolve(root, "public/data/data.json"), "utf-8"))
  await seedGameData(gameData, { timestamp: snapshotTimestamp, marketData: {} })
  return import("@/common/apis/marketvolume/history")
}

describe("成交量/小时 的正确性", () => {
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem("mewkonomy-market-history", JSON.stringify(SAMPLES))
  })

  it("前置：确认基准点落在「前一天 23:00」（确实跨了 UTC 日）", async () => {
    const mod = await loadModule(NOW)
    // 窗口 3h → cutoff = NOW - 3h = 前一天 23:00 → 基准正是那一点
    expect(mod.getBaselineSample(3, NOW)?.t).toBe(PREV_2300)
    // 两点的 UTC 日序号必须不同，否则这个用例没测到跨日分支
    expect(Math.floor(PREV_2300 / 86400)).not.toBe(Math.floor(NOW / 86400))
  })

  it("跨 UTC 日：今日累计小于昨日基准时，仍应算出「自 0 点起」的速率（旧实现返回 null）", async () => {
    const mod = await loadModule(NOW)
    // 今日 0 点起成交量 500，到 02:00 经过 2 小时 → 250 件/小时
    expect(mod.getVolumeRate(item({ volume: 500 }), 3, NOW)).toBeCloseTo(250, 5)
    // 旧实现因为 500 < 1000 会返回 null（界面显示 --），这正是"有问题"的表现之一
  })

  it("跨 UTC 日：增量应取「今日累计」而非「今日累计 − 昨日累计」", async () => {
    const mod = await loadModule(NOW)
    // 今日自 0 点起 1500 件 / 2 小时 = 750
    // 旧实现：(1500 − 1000) / 3 小时 ≈ 166.7（分母多算了跨日的一小时）
    expect(mod.getVolumeRate(item({ volume: 1500 }), 3, NOW)).toBeCloseTo(750, 5)
  })

  it("不传 now 时，默认以市场快照时间戳为基准（避免用墙钟导致速率随时间漂移）", async () => {
    const mod = await loadModule(NOW)
    const explicit = mod.getVolumeRate(item({ volume: 1500 }), 3, NOW)
    const byDefault = mod.getVolumeRate(item({ volume: 1500 }), 3)
    expect(byDefault).not.toBeNull()
    expect(byDefault).toBeCloseTo(explicit!, 10)
  })

  it("getBaselineSample 不传 now 时同样默认用快照时间戳", async () => {
    const mod = await loadModule(NOW)
    expect(mod.getBaselineSample(3)?.t).toBe(mod.getBaselineSample(3, NOW)?.t)
  })

  it("同一 UTC 日内：仍按真实增量计算，并保留非负校验", async () => {
    const mod = await loadModule(NOW)
    // NOW=02:00，窗口 0.5h → cutoff=01:30 → 基准 = 当天 01:00（volume=200），同一 UTC 日
    expect(mod.getBaselineSample(0.5, NOW)?.t).toBe(DAY + 3600)
    // 当前 500 − 基准 200 = 300，间隔 1 小时 → 300 件/小时
    expect(mod.getVolumeRate(item({ volume: 500 }), 0.5, NOW)).toBeCloseTo(300, 5)
    // 同一天内累计值不应减少：出现负增量判为数据异常 → null（UI 显示 --）
    expect(mod.getVolumeRate(item({ volume: 100 }), 0.5, NOW)).toBeNull()
  })
})
