import { describe, expect, it } from "vitest"
import type { FallbackSide, PriceFallbackSettings } from "@/common/utils/price-fallback"


/**
 * 兜底策略矩阵测试（纯函数，零游戏数据依赖）
 *
 * 覆盖用户提的四条需求：
 * 1. 需要右价时没有右价就用左价
 * 2. 需要左价时没有左价就用右价
 * 3. 左右都没有就用大全套兜底
 * 4. 需要时可以手动强制用大全套
 * 以及「左右解耦」：改一侧不影响另一侧。
 */

const NONE = -1

function side(cross: boolean, then: "none" | "shop" | "bigset"): FallbackSide {
  return { cross, then }
}

function cfg(ask: FallbackSide, bid: FallbackSide, forceBigSet = false): PriceFallbackSettings {
  return { ask, bid, forceBigSet }
}

async function load() {
  return await import("@/common/utils/price-fallback")
}

describe("兜底策略：借用另一端", () => {
  it("左价缺失、右价有 → 左价借右价，来源标 cross", async () => {
    const { resolvePriceSides } = await load()
    const r = resolvePriceSides(
      { ask: NONE, bid: 800, shopAsk: NONE, shopBid: NONE, bigSet: NONE },
      cfg(side(true, "none"), side(true, "none"))
    )
    expect(r.ask).toBe(800)
    expect(r.askSource).toBe("cross")
    expect(r.bid).toBe(800)
    expect(r.bidSource).toBe("market")
  })

  it("右价缺失、左价有 → 右价借左价", async () => {
    const { resolvePriceSides } = await load()
    const r = resolvePriceSides(
      { ask: 1200, bid: NONE, shopAsk: NONE, shopBid: NONE, bigSet: NONE },
      cfg(side(true, "none"), side(true, "none"))
    )
    expect(r.bid).toBe(1200)
    expect(r.bidSource).toBe("cross")
    expect(r.ask).toBe(1200)
    expect(r.askSource).toBe("market")
  })

  it("关掉 cross 就不借（哪怕另一端有价）", async () => {
    const { resolvePriceSides } = await load()
    const r = resolvePriceSides(
      { ask: NONE, bid: 800, shopAsk: NONE, shopBid: NONE, bigSet: NONE },
      cfg(side(false, "none"), side(true, "none"))
    )
    expect(r.ask).toBe(NONE)
    expect(r.askSource).toBe("none")
  })

  it("借用取的是「原始市价」，不会把借来的值再被借一次形成链", async () => {
    const { resolvePriceSides } = await load()
    // ask 缺、bid 缺，但 shopAsk 有值：借不到 → 走 then=shop
    const r = resolvePriceSides(
      { ask: NONE, bid: NONE, shopAsk: 555, shopBid: NONE, bigSet: NONE },
      cfg(side(true, "shop"), side(true, "none"))
    )
    expect(r.ask).toBe(555)
    expect(r.askSource).toBe("shop")
  })
})

describe("兜底策略：两端都没有时用大全套", () => {
  it("then=bigset：两端皆无 → 用大全套，来源 selfcraft", async () => {
    const { resolvePriceSides } = await load()
    const r = resolvePriceSides(
      { ask: NONE, bid: NONE, shopAsk: NONE, shopBid: NONE, bigSet: 4242 },
      cfg(side(true, "bigset"), side(true, "bigset"))
    )
    expect(r.ask).toBe(4242)
    expect(r.bid).toBe(4242)
    expect(r.askSource).toBe("selfcraft")
    expect(r.bidSource).toBe("selfcraft")
  })

  it("优先级：先借另一端，借不到才用大全套", async () => {
    const { resolvePriceSides } = await load()
    // ask 缺、bid 有 → 应该借 bid（800），而不是直接跳到 bigSet
    const r = resolvePriceSides(
      { ask: NONE, bid: 800, shopAsk: NONE, shopBid: NONE, bigSet: 4242 },
      cfg(side(true, "bigset"), side(true, "bigset"))
    )
    expect(r.ask).toBe(800)
    expect(r.askSource).toBe("cross")
  })

  it("大全套也不可得 → 才是无价", async () => {
    const { resolvePriceSides } = await load()
    const r = resolvePriceSides(
      { ask: NONE, bid: NONE, shopAsk: NONE, shopBid: NONE, bigSet: NONE },
      cfg(side(true, "bigset"), side(true, "bigset"))
    )
    expect(r.ask).toBe(NONE)
    expect(r.askSource).toBe("none")
  })
})

describe("兜底策略：商店价", () => {
  it("then=shop：卖出端用商店回收价，买入端用商店金币价", async () => {
    const { resolvePriceSides } = await load()
    const r = resolvePriceSides(
      { ask: NONE, bid: NONE, shopAsk: 300, shopBid: 120, bigSet: NONE },
      cfg(side(false, "shop"), side(false, "shop"))
    )
    expect(r.ask).toBe(300)
    expect(r.bid).toBe(120)
    expect(r.askSource).toBe("shop")
    expect(r.bidSource).toBe("shop")
  })

  it("市价正常时默认用市价；选了 shop 才在「商店更便宜」时改用商店价", async () => {
    const { resolvePriceSides } = await load()
    const market = { ask: 100, bid: 90, shopAsk: 300, shopBid: 90, bigSet: 1 }
    const withCross = resolvePriceSides(market, cfg(side(false, "none"), side(false, "none")))
    expect(withCross.askSource).toBe("market")
    const withShop = resolvePriceSides(market, cfg(side(false, "shop"), side(false, "none")))
    expect(withShop.askSource, "商店价更贵时不该换").toBe("market")
    const cheapShop = resolvePriceSides({ ...market, shopAsk: 50 }, cfg(side(false, "shop"), side(false, "none")))
    expect(cheapShop.ask).toBe(50)
    expect(cheapShop.askSource, "商店更便宜时应改用商店价").toBe("shop")
  })
})

describe("兜底策略：强制大全套", () => {
  it("forceBigSet：无视市价，两端都用大全套", async () => {
    const { resolvePriceSides } = await load()
    const r = resolvePriceSides(
      { ask: 100, bid: 90, shopAsk: 50, shopBid: 45, bigSet: 9999 },
      cfg(side(false, "none"), side(false, "none"), true)
    )
    expect(r.ask).toBe(9999)
    expect(r.bid).toBe(9999)
    expect(r.askSource).toBe("selfcraft")
    expect(r.bidSource).toBe("selfcraft")
  })

  it("forceBigSet 但大全套不可得 → 无价（不会退回市价）", async () => {
    const { resolvePriceSides } = await load()
    const r = resolvePriceSides(
      { ask: 100, bid: 90, shopAsk: 50, shopBid: 45, bigSet: NONE },
      cfg(side(false, "none"), side(false, "none"), true)
    )
    expect(r.ask).toBe(NONE)
    expect(r.askSource).toBe("none")
  })
})

describe("兜底策略：左右解耦", () => {
  it("只改左价策略不影响右价结果", async () => {
    const { resolvePriceSides } = await load()
    const input = { ask: NONE, bid: 500, shopAsk: NONE, shopBid: 200, bigSet: 7777 }
    const a = resolvePriceSides(input, cfg(side(false, "none"), side(false, "shop")))
    const b = resolvePriceSides(input, cfg(side(true, "bigset"), side(false, "shop")))
    expect(a.bid, "右价两次应完全相同").toBe(b.bid)
    expect(a.bidSource).toBe(b.bidSource)
    expect(a.ask, "左价应随策略改变").not.toBe(b.ask)
  })

  it("默认配置 = 借另一端 → 大全套（用户要的那条链）", async () => {
    const { resolvePriceSides, DEFAULT_PRICE_FALLBACK: d } = await load()
    expect(d.ask.cross).toBe(true)
    expect(d.bid.cross).toBe(true)
    expect(d.ask.then).toBe("bigset")
    expect(d.bid.then).toBe("bigset")
    const r = resolvePriceSides(
      { ask: NONE, bid: 500, shopAsk: NONE, shopBid: NONE, bigSet: 7777 },
      d
    )
    expect(r.ask).toBe(500)
    expect(r.askSource).toBe("cross")
  })
})

describe("兜底策略：全矩阵不变量（来源与价格必须一致）", () => {
  it("穷举 3×3×3 策略 × 5 种市场形态，标了来源就一定取到了数、标 none 就真的是 -1", async () => {
    const { resolvePriceSides } = await load()
    const strategies: FallbackSide[] = []
    for (const cross of [false, true]) {
      for (const then of ["none", "shop", "bigset"] as const) {
        strategies.push({ cross, then })
      }
    }
    const markets = [
      { ask: 100, bid: 90, shopAsk: NONE, shopBid: NONE, bigSet: NONE }, // 两端都有
      { ask: NONE, bid: 90, shopAsk: NONE, shopBid: NONE, bigSet: NONE }, // 只缺左价
      { ask: 100, bid: NONE, shopAsk: NONE, shopBid: NONE, bigSet: NONE }, // 只缺右价
      { ask: NONE, bid: NONE, shopAsk: NONE, shopBid: NONE, bigSet: NONE }, // 两端都缺
      { ask: NONE, bid: NONE, shopAsk: 300, shopBid: 120, bigSet: 7777 } // 兜底手段齐备
    ]

    let checked = 0
    const bad: string[] = []
    for (const ask of strategies) {
      for (const bid of strategies) {
        for (const forceBigSet of [false, true]) {
          for (const m of markets) {
            const r = resolvePriceSides(m, cfg(ask, bid, forceBigSet))
            checked++
            for (const sideName of ["ask", "bid"] as const) {
              const price = r[sideName]
              const source = r[`${sideName}Source`]
              if (source === "none" && price !== NONE) {
                bad.push(`${sideName}: 标 none 却有价 ${price} (ask=${JSON.stringify(ask)} bid=${JSON.stringify(bid)} force=${forceBigSet})`)
              }
              if (source !== "none" && price === NONE) {
                bad.push(`${sideName}: 标 ${source} 却是 -1 (ask=${JSON.stringify(ask)} bid=${JSON.stringify(bid)} force=${forceBigSet})`)
              }
            }
          }
        }
      }
    }
    // 6 种单侧策略（cross 2 × then 3）× 左右组合 × forceBigSet 2 × 5 种市场形态
    expect(checked).toBe(6 * 6 * 2 * 5)
    expect(bad, `来源与价格不一致：\n${bad.slice(0, 5).join("\n")}`).toEqual([])
    console.log(`[fallback] 策略矩阵校验 ${checked} 组，来源与价格全部一致`)
  })
})

describe("兜底设置：签名与迁移", () => {
  it("不同设置必须产出不同签名（否则缓存会串）", async () => {
    const { priceFallbackSignature, DEFAULT_PRICE_FALLBACK: d } = await load()
    const sigs = new Set([
      priceFallbackSignature(d),
      priceFallbackSignature({ ...d, ask: { ...d.ask, cross: !d.ask.cross } }),
      priceFallbackSignature({ ...d, ask: { ...d.ask, then: "shop" } }),
      priceFallbackSignature({ ...d, bid: { ...d.bid, cross: !d.bid.cross } }),
      priceFallbackSignature({ ...d, bid: { ...d.bid, then: "none" } }),
      priceFallbackSignature({ ...d, forceBigSet: true })
    ])
    expect(sigs.size, "6 种设置应有 6 个不同签名").toBe(6)
  })

  it("旧 A/B/C 迁移：尽量保持原行为", async () => {
    const { migrateLegacyMode } = await load()
    expect(migrateLegacyMode("A")).toEqual(cfg(side(false, "none"), side(false, "none")))
    expect(migrateLegacyMode("B")).toEqual(cfg(side(false, "none"), side(false, "shop")))
    expect(migrateLegacyMode("C")).toEqual(cfg(side(false, "bigset"), side(false, "shop")))
  })

  it("normalize：脏数据（手改 localStorage）不会炸，且退回默认", async () => {
    const { normalizePriceFallback, DEFAULT_PRICE_FALLBACK: d } = await load()
    expect(normalizePriceFallback(null)).toEqual(d)
    expect(normalizePriceFallback("垃圾")).toEqual(d)
    expect(normalizePriceFallback({ ask: { cross: "yes", then: "瞎写" } })).toEqual(d)
    expect(normalizePriceFallback({ ask: { cross: true, then: "shop" }, forceBigSet: true })).toEqual(
      cfg(side(true, "shop"), d.bid, true)
    )
  })
})
