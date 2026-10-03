import type { MarketVolumeItem } from "@/common/apis/marketvolume"
import type { MarketRanges, NumericRange } from "@/common/apis/marketvolume/filters"
import { applyRangeFilters, countActiveRanges, createEmptyRanges, isRangeActive, matchesRange, rangeValueOf } from "@/common/apis/marketvolume/filters"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 区间筛选的单元测试。
 *
 * `filters.ts` 是纯函数模块（只 import 类型），所以前四组用例不需要 mock、不需要注入数据。
 * 断言的是**语义**而不是实现：端点是否包含、阈值留空是否等于"不筛选"、值缺失怎么办。
 * 最后一组用 `vi.resetModules()` 重建 store，验证收藏的持久化与坏数据归一化。
 */

function item(p: Partial<MarketVolumeItem> & { hrid: string }): MarketVolumeItem {
  return {
    name: p.hrid,
    category: "resource",
    itemLevel: 1,
    level: "0",
    ask: 100,
    bid: 99,
    price: 100,
    volume: 100,
    turnover: 10000,
    ...p
  }
}

function range(p: Partial<NumericRange> = {}): NumericRange {
  return { mode: "any", ...p }
}

describe("区间筛选：条件是否生效（isRangeActive）", () => {
  it("any / undefined 一律视为未生效", () => {
    expect(isRangeActive(range())).toBe(false)
    expect(isRangeActive(undefined)).toBe(false)
    expect(isRangeActive(null)).toBe(false)
  })

  it("≥ / ≤ 必须填了阈值才算生效", () => {
    expect(isRangeActive(range({ mode: "gte", min: 0 }))).toBe(true)
    expect(isRangeActive(range({ mode: "lte", min: 0 }))).toBe(true)
    expect(isRangeActive(range({ mode: "gte" }))).toBe(false)
    expect(isRangeActive(range({ mode: "gte", min: Number.NaN }))).toBe(false)
  })

  it("区间只要填了任意一边就算生效（等价于单边筛选）", () => {
    expect(isRangeActive(range({ mode: "between", min: 1 }))).toBe(true)
    expect(isRangeActive(range({ mode: "between", max: 1 }))).toBe(true)
    expect(isRangeActive(range({ mode: "between" }))).toBe(false)
  })
})

describe("区间筛选：比较语义（matchesRange）", () => {
  it("≥ / ≤ 都含端点", () => {
    expect(matchesRange(500, range({ mode: "gte", min: 500 }))).toBe(true)
    expect(matchesRange(499, range({ mode: "gte", min: 500 }))).toBe(false)
    expect(matchesRange(500, range({ mode: "lte", min: 500 }))).toBe(true)
    expect(matchesRange(501, range({ mode: "lte", min: 500 }))).toBe(false)
  })

  it("区间含两端", () => {
    const r = range({ mode: "between", min: 10, max: 20 })
    expect(matchesRange(10, r)).toBe(true)
    expect(matchesRange(20, r)).toBe(true)
    expect(matchesRange(15, r)).toBe(true)
    expect(matchesRange(9, r)).toBe(false)
    expect(matchesRange(21, r)).toBe(false)
  })

  it("区间填反了自动对调，而不是筛出空集", () => {
    const r = range({ mode: "between", min: 20, max: 10 })
    expect(matchesRange(15, r)).toBe(true)
    expect(matchesRange(25, r)).toBe(false)
  })

  it("区间只填一边时退化为 ≥ / ≤", () => {
    expect(matchesRange(15, range({ mode: "between", min: 10 }))).toBe(true)
    expect(matchesRange(5, range({ mode: "between", min: 10 }))).toBe(false)
    expect(matchesRange(5, range({ mode: "between", max: 10 }))).toBe(true)
    expect(matchesRange(15, range({ mode: "between", max: 10 }))).toBe(false)
  })

  it("条件未生效时一律通过（包括取不到值的条目）", () => {
    expect(matchesRange(null, range())).toBe(true)
    expect(matchesRange(null, range({ mode: "gte" }))).toBe(true)
    expect(matchesRange(123, undefined)).toBe(true)
  })

  it("条件生效但条目没有该值时不通过（否则「涨跌幅 ≥ 10%」会放进一堆无历史条目）", () => {
    expect(matchesRange(null, range({ mode: "gte", min: 10 }))).toBe(false)
    expect(matchesRange(Number.NaN, range({ mode: "gte", min: 10 }))).toBe(false)
  })
})

describe("区间筛选：取值口径（rangeValueOf）", () => {
  it("涨跌幅 / 速率无值时返回 null", () => {
    expect(rangeValueOf(item({ hrid: "/items/a", changePct: null }), "changePct")).toBeNull()
    expect(rangeValueOf(item({ hrid: "/items/a" }), "changePct")).toBeNull()
    expect(rangeValueOf(item({ hrid: "/items/a", volumeRate: null }), "volumeRate")).toBeNull()
  })

  it("成交量优先用时间窗内滚动量，回退官方当日累计量（与表格展示列一致）", () => {
    expect(rangeValueOf(item({ hrid: "/items/a", volume: 100, volumeRolling: 550 }), "volume")).toBe(550)
    expect(rangeValueOf(item({ hrid: "/items/a", volume: 100, volumeRolling: null }), "volume")).toBe(100)
  })

  it("成交额同理", () => {
    expect(rangeValueOf(item({ hrid: "/items/a", turnover: 1, turnoverRolling: 999 }), "turnover")).toBe(999)
    expect(rangeValueOf(item({ hrid: "/items/a", turnover: 1, turnoverRolling: null }), "turnover")).toBe(1)
  })

  it("无价（-1 / 0）不能当成「很便宜」参与比较", () => {
    expect(rangeValueOf(item({ hrid: "/items/a", price: -1 }), "price")).toBeNull()
    expect(rangeValueOf(item({ hrid: "/items/a", price: 0 }), "price")).toBeNull()
    expect(rangeValueOf(item({ hrid: "/items/a", price: 1200 }), "price")).toBe(1200)
  })
})

describe("区间筛选：多条件叠加（applyRangeFilters）", () => {
  const list = [
    item({ hrid: "/items/hot", volume: 5000, volumeRolling: 5000, changePct: 30, price: 1000 }),
    item({ hrid: "/items/cheap", volume: 5000, volumeRolling: 5000, changePct: 30, price: 10 }),
    item({ hrid: "/items/cold", volume: 10, volumeRolling: 10, changePct: 30, price: 1000 }),
    item({ hrid: "/items/nohistory", volume: 5000, volumeRolling: 5000, changePct: null, price: 1000 })
  ]

  it("没有任何生效条件时原样返回（不复制、不排序）", () => {
    const r = createEmptyRanges()
    expect(applyRangeFilters(list, r)).toBe(list)
  })

  it("多个条件之间是「与」", () => {
    const r: MarketRanges = { ...createEmptyRanges(), volume: { mode: "gte", min: 1000 }, price: { mode: "lte", min: 100 } }
    const out = applyRangeFilters(list, r)
    expect(out.map(i => i.hrid)).toEqual(["/items/cheap"])
  })

  it("把涨跌幅条件填上后，无历史基准的条目被排除", () => {
    const r: MarketRanges = { ...createEmptyRanges(), changePct: { mode: "gte", min: 10 } }
    const out = applyRangeFilters(list, r)
    expect(out.map(i => i.hrid)).toEqual(["/items/hot", "/items/cheap", "/items/cold"])
  })

  it("只切了模式但没填阈值 ⇒ 等于没筛（列表不会被清空）", () => {
    const r: MarketRanges = { ...createEmptyRanges(), volume: { mode: "gte" }, changePct: { mode: "between" } }
    expect(applyRangeFilters(list, r)).toBe(list)
    expect(countActiveRanges(r)).toBe(0)
  })

  it("countActiveRanges 统计生效条件数", () => {
    const r: MarketRanges = {
      ...createEmptyRanges(),
      volume: { mode: "gte", min: 1 },
      changePct: { mode: "between", min: 1, max: 2 },
      price: { mode: "gte" }
    }
    expect(countActiveRanges(r)).toBe(2)
  })
})

describe("市场收藏 store：按 hrid|level 隔离并持久化", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  async function loadStore() {
    const { useMarketFavoriteStoreOutside } = await import("@/pinia/stores/marketfavorite")
    return useMarketFavoriteStoreOutside()
  }

  it("初始为空，toggle 可往返切换", async () => {
    const store = await loadStore()
    expect(store.count).toBe(0)
    expect(store.toggle("/items/apple", "0")).toBe(true)
    expect(store.has("/items/apple", "0")).toBe(true)
    expect(store.count).toBe(1)
    expect(store.toggle("/items/apple", "0")).toBe(false)
    expect(store.has("/items/apple", "0")).toBe(false)
    expect(store.count).toBe(0)
  })

  it("同一物品的不同市场档位互不影响（+0 与 +3 是两条市场条目）", async () => {
    const store = await loadStore()
    store.add("/items/holy_chisel", "0")
    expect(store.has("/items/holy_chisel", "0")).toBe(true)
    expect(store.has("/items/holy_chisel", "3")).toBe(false)
    store.add("/items/holy_chisel", "3")
    expect(store.count).toBe(2)
  })

  it("重复 add 不会产生重复项", async () => {
    const store = await loadStore()
    store.add("/items/apple", "0")
    store.add("/items/apple", "0")
    expect(store.count).toBe(1)
  })

  it("落盘后能被新的 store 实例读回", async () => {
    const first = await loadStore()
    first.add("/items/apple", "0")
    first.add("/items/pear", "2")
    vi.resetModules()
    const second = await loadStore()
    expect(second.count).toBe(2)
    expect(second.has("/items/pear", "2")).toBe(true)
  })

  it("坏数据被丢弃而不是导致崩溃（非数组 / 非字符串 / 缺 | / 重复）", async () => {
    localStorage.setItem(
      "market-favorite-items",
      JSON.stringify(["/items/ok|0", 123, null, "no-separator", "|0", "/items/x|", "/items/ok|0", "/items/ok|0"])
    )
    const store = await loadStore()
    expect(store.keys).toEqual(["/items/ok|0"])
  })

  it("localStorage 里是非法 JSON 时退化为空列表", async () => {
    localStorage.setItem("market-favorite-items", "{not json")
    const store = await loadStore()
    expect(store.count).toBe(0)
  })

  it("clear 清空全部", async () => {
    const store = await loadStore()
    store.add("/items/apple", "0")
    store.add("/items/pear", "1")
    store.clear()
    expect(store.count).toBe(0)
    expect(localStorage.getItem("market-favorite-items")).toBe("[]")
  })
})

describe("市场过滤设置 store：隐藏小成交量（可开可关、持久化）", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  async function loadFilterStore() {
    const { useMarketFilterStoreOutside } = await import("@/pinia/stores/marketfilter")
    return useMarketFilterStoreOutside()
  }

  it("默认关闭，阈值为 100（默认不动用户的列表）", async () => {
    const store = await loadFilterStore()
    expect(store.hideLowVolume).toBe(false)
    expect(store.minVolume).toBe(100)
  })

  it("开关与阈值落盘后能被新实例读回", async () => {
    const first = await loadFilterStore()
    first.hideLowVolume = true
    first.minVolume = 250
    // store 里的 watch 是异步刷新的，等一拍再重建模块，否则读到的还是旧值
    await new Promise(r => setTimeout(r, 0))
    vi.resetModules()
    const second = await loadFilterStore()
    expect(second.hideLowVolume).toBe(true)
    expect(second.minVolume).toBe(250)
  })

  it("坏数据被归一化：负数阈值夹到 0、非数字回落默认、非布尔开关视为关闭", async () => {
    localStorage.setItem(
      "market-filter-config",
      JSON.stringify({ version: 1, hideLowVolume: "yes", minVolume: -50 })
    )
    const store = await loadFilterStore()
    expect(store.hideLowVolume).toBe(false)
    expect(store.minVolume).toBe(0)

    localStorage.setItem("market-filter-config", JSON.stringify({ minVolume: "abc" }))
    vi.resetModules()
    const store2 = await loadFilterStore()
    expect(store2.minVolume).toBe(100)
  })

  it("非法 JSON / 缺字段时退化为默认值，而不是崩溃", async () => {
    localStorage.setItem("market-filter-config", "{not json")
    const store = await loadFilterStore()
    expect(store.hideLowVolume).toBe(false)
    expect(store.minVolume).toBe(100)
  })

  it("reset 恢复默认", async () => {
    const store = await loadFilterStore()
    store.hideLowVolume = true
    store.minVolume = 999
    store.reset()
    expect(store.hideLowVolume).toBe(false)
    expect(store.minVolume).toBe(100)
  })
})
