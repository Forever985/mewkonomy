import { describe, expect, it, vi } from "vitest"

// marketvolume/index.ts 会 import game API，而该模块顶层有 watch(immediate)
// 会去读 gameData.actionDetailMap。测试里不加载真实游戏数据，直接 mock 掉，
// 只测纯排序函数（与 marketvolume-history.test.ts 同一手法）。
vi.mock("@/common/apis/game", () => ({
  getGameDataApi: vi.fn(),
  getMarketDataApi: vi.fn()
}))

import { sortMarketVolumeRows, MARKET_VOLUME_SORT_KEYS, type MarketVolumeItem } from "@/common/apis/marketvolume"

/**
 * 市场监控的列排序。
 *
 * 这段逻辑原先写在页面里，出过两个问题，所以抽到 API 层用纯函数测：
 *   1. 「物品」列标了 sortable="custom"，但白名单里没有 `name` —— 点表头会把排序
 *      重置成默认列，表头箭头变了数据却没变，看起来像点了没反应；
 *   2. `null`/`undefined` 表示「无数据」（缺历史基准的涨跌、缺速率的成交量），
 *      直接 Number() 会得到 0，和真的 0 混在一起。
 */
function row(name: string, over: Partial<MarketVolumeItem> = {}): MarketVolumeItem {
  return {
    hrid: `/items/${name.toLowerCase()}`,
    name,
    category: "resource",
    itemLevel: 1,
    level: "0",
    ask: 0,
    bid: 0,
    price: 0,
    volume: 0,
    turnover: 0,
    ...over
  }
}

describe("sortMarketVolumeRows", () => {
  it("物品列按显示名排序（升/降序都生效，不再被重置）", () => {
    const list = [row("Cherry"), row("Apple"), row("Banana")]
    expect(sortMarketVolumeRows(list, "name", "ascending").map((i) => i.name)).toEqual(["Apple", "Banana", "Cherry"])
    expect(sortMarketVolumeRows(list, "name", "descending").map((i) => i.name)).toEqual(["Cherry", "Banana", "Apple"])
  })

  it("nameOf 决定比较用的名字（页面传 t，于是按界面语言排序）", () => {
    const list = [row("apple"), row("banana")]
    const zh: Record<string, string> = { apple: "苹果", banana: "香蕉" }
    // 按拼音/中文码位：苹(p) < 香(x)
    expect(sortMarketVolumeRows(list, "name", "ascending", (n) => zh[n]).map((i) => i.name))
      .toEqual(["apple", "banana"])
  })

  it("数值列降序/升序", () => {
    const list = [row("a", { volume: 10 }), row("b", { volume: 300 }), row("c", { volume: 50 })]
    expect(sortMarketVolumeRows(list, "volume", "descending").map((i) => i.volume)).toEqual([300, 50, 10])
    expect(sortMarketVolumeRows(list, "volume", "ascending").map((i) => i.volume)).toEqual([10, 50, 300])
  })

  it("无数据的行（null / undefined）无论升序降序都排在末尾", () => {
    const list = [
      row("none", { volumeRate: null }),
      row("low", { volumeRate: 5 }),
      row("missing"), // volumeRate 未定义
      row("high", { volumeRate: 900 })
    ]
    const desc = sortMarketVolumeRows(list, "volumeRate", "descending").map((i) => i.name)
    expect(desc.slice(0, 2)).toEqual(["high", "low"])
    expect(desc.slice(2).sort()).toEqual(["missing", "none"])

    const asc = sortMarketVolumeRows(list, "volumeRate", "ascending").map((i) => i.name)
    expect(asc.slice(0, 2)).toEqual(["low", "high"])
    expect(asc.slice(2).sort()).toEqual(["missing", "none"])
    // 无数据的行不能被当成 0 混进有效值里
    expect(asc[0]).toBe("low")
  })

  it("不修改原数组", () => {
    const list = [row("a", { volume: 1 }), row("b", { volume: 2 })]
    sortMarketVolumeRows(list, "volume", "descending")
    expect(list.map((i) => i.name)).toEqual(["a", "b"])
  })

  it("白名单包含表格里标了 sortable 的每一列", () => {
    // 页面上的 sortable="custom" 列：物品(name)/等级(itemLevel)/价格(price)/
    // 涨跌(changePct)/卖价(ask)/买价(bid)/成交量(volume)/成交量每小时(volumeRate)/成交额(turnover)
    expect([...MARKET_VOLUME_SORT_KEYS].sort()).toEqual(
      ["ask", "bid", "changePct", "itemLevel", "name", "price", "turnover", "volume", "volumeRate"]
    )
  })
})
