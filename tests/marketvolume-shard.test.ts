import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// history.ts 会 import game API，而该模块顶层 watch(immediate) 要读 gameData；
// 本用例只做纯解码，直接 mock 掉（与 marketvolume-history.test.ts 同一手法）。
vi.mock("@/common/apis/game", () => ({
  getGameDataApi: vi.fn(),
  getMarketDataApi: vi.fn()
}))

import { decodeShard, shardKeyOf, shardKeysForWindow, SHARD_HOURS } from "@/common/apis/marketvolume/history"

/**
 * 服务端归档分片（v2 紧凑格式）的解码。
 *
 * fixture 由 **Python 采样器真正的 `encode_shard`** 产出
 * （tests/fixtures/market-history-shard.json，用 `python scripts/dev/gen_shard_fixture.py`
 * 重新生成），所以这个测试实际是在跨语言校验格式：Python 编码 → TS 解码必须逐字段一致。
 * 两边任何一方改了行编码规则而没改另一方，这里就会红。
 */
const FIXTURE = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/fixtures/market-history-shard.json"), "utf-8")
)

describe("服务端归档分片解码（Python 编码 → TS 解码）", () => {
  it("解出两个采样点，且关键字段逐一对上", () => {
    const samples = decodeShard(FIXTURE)!
    expect(samples).toHaveLength(2)
    expect(samples[0].t).toBe(1790161200)
    expect(samples[1].t).toBe(1790164800)

    const s0 = samples[0].p
    // 5 元素行：ask+bid+volume 齐全
    expect(s0["/items/holy_chisel"]["0"]).toEqual([1370000, 1350000, 13])
    // 5 元素行但 bid 缺省 → -1（不是 0，也不是 undefined）
    expect(s0["/items/holy_chisel"]["2"]).toEqual([1500000, -1, 1])
    // 3 元素行：只有 ask → bid=-1, volume=0
    expect(s0["/items/apple"]["0"]).toEqual([100, -1, 0])
    // 3 元素行且是大数字（> 2^32）
    expect(s0["/items/holy_chisel"]["10"]).toEqual([9000000000, -1, 0])
    // 4 元素行：ask+bid，volume 缺省 → 0
    expect(s0["/items/banana"]["0"]).toEqual([200, 190, 0])
    // 4 元素行且 ask 缺省 → [-1, bid]
    expect(s0["/items/cherry"]["0"]).toEqual([-1, 55, 7])
    // 5 元素行：只有 volume
    expect(s0["/items/durian"]["0"]).toEqual([-1, -1, 42])
  })

  it("强化等级按字典/整型还原成字符串 key，同一件装备的多个档位各自独立", () => {
    const levels = Object.keys(decodeShard(FIXTURE)![0].p["/items/holy_chisel"])
    expect(levels).toEqual(["0", "2", "10"])
  })

  it("未被任何行引用的字典项不产出条目", () => {
    // fixture 的字典里有 /items/empty，但它全空白、编码时被丢掉，因此不应出现
    expect(FIXTURE.d).toContain("/items/empty")
    expect(decodeShard(FIXTURE)![0].p["/items/empty"]).toBeUndefined()
  })

  it("结构不合法时返回 null，而不是抛错或产出脏数据", () => {
    expect(decodeShard(null)).toBeNull()
    expect(decodeShard([])).toBeNull()
    expect(decodeShard({ v: 1, d: [], s: [] })).toBeNull()
    expect(decodeShard({ v: 2, d: "x", s: [] })).toBeNull()
    // 行里引用了不存在的字典下标 → 跳过该行，其它行照常
    const broken = { v: 2, d: ["/items/a"], s: [[1, [[9, 0, 5], [0, 0, 7]]]] }
    expect(decodeShard(broken)![0].p).toEqual({ "/items/a": { 0: [7, -1, 0] } })
  })
})

describe("分片键与取片范围", () => {
  it("块键按 UTC 6 小时对齐（必须与 Python shard_key 完全一致）", () => {
    // 2026-09-23T12:34:56Z → 12 点块
    expect(shardKeyOf(Date.UTC(2026, 8, 23, 12, 34, 56) / 1000)).toBe("2026-09-23T12")
    expect(shardKeyOf(Date.UTC(2026, 8, 23, 17, 59, 59) / 1000)).toBe("2026-09-23T12")
    expect(shardKeyOf(Date.UTC(2026, 8, 23, 18, 0, 0) / 1000)).toBe("2026-09-23T18")
    // 跨 UTC 日：23:59 属于当天的 18 点块，00:01 属于次日的 00 点块
    expect(shardKeyOf(Date.UTC(2026, 8, 23, 23, 59) / 1000)).toBe("2026-09-23T18")
    expect(shardKeyOf(Date.UTC(2026, 8, 24, 0, 1) / 1000)).toBe("2026-09-24T00")
    expect(SHARD_HOURS).toBe(6)
  })

  it("取片范围覆盖窗口起点（含基准片）到 now，且不含更早的片", () => {
    const now = Date.UTC(2026, 8, 23, 13, 30) / 1000
    // 6 小时窗：窗口起点 07:30 → 06 点块，再往前一块兜基准 → 00 点块
    const keys = shardKeysForWindow(6, now)
    expect(keys).toEqual(["2026-09-23T00", "2026-09-23T06", "2026-09-23T12"])
    // 168 小时窗：窗口起点在 09-16T13:30 → 从 09-16T06 块起算；
    // 每块 6 小时、共 7 天 + 一个兜底块 → 30 片（不是 28，多的 2 片是窗口首尾的半块）
    const long = shardKeysForWindow(168, now)
    expect(long.length).toBe(30)
    expect(long[0]).toBe("2026-09-16T06")
    expect(long[long.length - 1]).toBe("2026-09-23T12")
    // 升序且不重复
    expect([...long].sort()).toEqual(long)
    expect(new Set(long).size).toBe(long.length)
    // 窗口越长取片越多（单调），保证「按需加载」真的按需
    expect(shardKeysForWindow(24, now).length).toBeLessThan(long.length)
  })
})
