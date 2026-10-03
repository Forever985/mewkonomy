import { describe, expect, it, beforeAll, beforeEach } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"
import { applyFallback, fallbackSettings, LEGACY_FALLBACK } from "./utils/price-fallback"

/**
 * 兜底机制的**集成**回归（跑在真实游戏数据上）。
 *
 * 这里锁的是两条曾经真实存在的缺陷，纯函数测试覆盖不到：
 *
 * 1. **level>0 的来源标记与实际价格漂移**：旧实现 level>0 单独写了兜底判定，
 *    条件与 level=0 不一致（ask 多要求 `!marketItem`、来源却对 ask 也返回 shop），
 *    于是 UI 出现「价格 -1 却标成【商店】/【自产】」。实测旧实现：
 *    模式B 1402 条、模式C 1404 条（bid 端 0 条）。
 *
 * 2. **切换兜底设置后同一 tick 内读到旧结果**：旧实现 `_priceResolutionCache`
 *    的 key 不含兜底设置，清缓存又依赖异步 watch。
 *    现在签名进了 key，切换后同步读也能立刻反映新设置。
 */
describe("兜底集成：来源与价格必须一致（含 level>0）", () => {
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

  beforeEach(() => {
    applyFallback(LEGACY_FALLBACK.chain)
  })

  it("全物品 × 多个等级：标了来源就一定取到了数，标 none 就真的是 -1", async () => {
    const { getPriceOf, getPriceSourceOf, getMarketDataApi } = await import("@/common/apis/game")
    const market: Record<string, Record<string, { ask: number, bid: number }>> =
      (getMarketDataApi() as any)?.marketData ?? {}
    const hrids = Object.keys(market)
    expect(hrids.length, "夹具应种了市场数据").toBeGreaterThan(100)

    const bad: string[] = []
    const kinds: Record<string, number> = {}
    let checked = 0

    for (const hrid of hrids) {
      const levels = new Set<number>([0, 8, 9])
      for (const lv of Object.keys(market[hrid] ?? {})) levels.add(Number(lv))
      for (const level of levels) {
        const price = getPriceOf(hrid, level)
        checked++
        for (const type of ["ask", "bid"] as const) {
          const source = getPriceSourceOf(hrid, level, type)
          kinds[source] = (kinds[source] ?? 0) + 1
          const p = price[type]
          if (source === "none" && p !== -1) {
            bad.push(`${hrid}(lv${level},${type}) 标无价却有价 ${p}`)
          }
          if (source !== "none" && p === -1) {
            bad.push(`${hrid}(lv${level},${type}) 标 ${source} 却是 -1`)
          }
        }
      }
    }

    console.log(`[fallback-api] 检查 ${checked} 个 (物品,等级) 组合，来源分布：${JSON.stringify(kinds)}`)
    expect(bad, `来源与价格漂移：\n${bad.slice(0, 6).join("\n")}`).toEqual([])
  }, 600000)

  it("「借另一端」在真实数据上确实生效：两端都缺时才用大全套", async () => {
    const { getPriceOf, getPriceSourceOf, getMarketDataApi } = await import("@/common/apis/game")
    const market: Record<string, Record<string, { ask: number, bid: number }>> =
      (getMarketDataApi() as any)?.marketData ?? {}
    const hrids = Object.keys(market)

    let cross = 0
    let selfcraft = 0
    let bothMissingButCrossed = 0
    for (const hrid of hrids) {
      for (const level of [0, 8]) {
        const raw = market[hrid]?.[level]
        const rawAsk = raw?.ask ?? -1
        const rawBid = raw?.bid ?? -1
        const askSrc = getPriceSourceOf(hrid, level, "ask")
        const bidSrc = getPriceSourceOf(hrid, level, "bid")
        if (askSrc === "cross") {
          cross++
          // 借来的值必须正好等于另一端的**原始市价**
          expect(getPriceOf(hrid, level).ask, `${hrid}(lv${level}) 借来的左价应等于原始右价`).toBe(rawBid)
          if (rawAsk === -1 && rawBid === -1) bothMissingButCrossed++
        }
        if (askSrc === "selfcraft") selfcraft++
        if (bidSrc === "cross") {
          expect(getPriceOf(hrid, level).bid, `${hrid}(lv${level}) 借来的右价应等于原始左价`).toBe(rawAsk)
        }
      }
    }
    console.log(
      `[fallback-api] 借另一端命中：ask ${cross} 次、selfcraft ${selfcraft} 次；` +
      `「两端都缺却借到值」的异常 ${bothMissingButCrossed} 次`
    )
    expect(cross, "默认配置下应当大量命中「借另一端」").toBeGreaterThan(0)
    expect(bothMissingButCrossed, "两端原始市价都缺时不可能借到值").toBe(0)
  }, 600000)

  it("切换兜底设置后，同一 tick 内同步读价格就能拿到新结果（不再读到旧模式）", async () => {
    const { getPriceOf, getMarketDataApi } = await import("@/common/apis/game")
    const market: Record<string, Record<string, { ask: number, bid: number }>> =
      (getMarketDataApi() as any)?.marketData ?? {}
    // 必须挑一个**本身无市价**的物品：它的价格才会随兜底设置变化
    const hrid = Object.keys(market).find(h => (market[h]?.[0]?.ask ?? -1) === -1)
    expect(hrid, "夹具里应存在无市价的物品").toBeTruthy()

    // 先用「不兜底」把缓存填成 -1
    applyFallback(LEGACY_FALLBACK.off)
    const offAsk = getPriceOf(hrid!, 0).ask
    expect(offAsk, "不兜底时无市价物品应确实是 -1").toBe(-1)

    // 紧接着（同一 tick，不 await）切到新链并同步读
    applyFallback(LEGACY_FALLBACK.chain)
    const chainAsk = getPriceOf(hrid!, 0).ask

    // 再切回不兜底
    applyFallback(LEGACY_FALLBACK.off)
    const offAgain = getPriceOf(hrid!, 0).ask

    console.log(`[fallback-api] 同一 tick 切换：off=${offAsk} → chain=${chainAsk} → off=${offAgain}`)
    expect(chainAsk, "切换后同步读必须已经是新设置的结果（说明缓存 key 含了设置签名）").not.toBe(-1)
    expect(offAgain, "切回不兜底应立刻恢复 -1").toBe(-1)
  })

  it("forceBigSet 会让有市价的物品也被标成 selfcraft", async () => {
    const { getPriceOf, getPriceSourceOf, getMarketDataApi } = await import("@/common/apis/game")
    const market: Record<string, Record<string, { ask: number, bid: number }>> =
      (getMarketDataApi() as any)?.marketData ?? {}
    const withMarket = Object.keys(market).find(h => (market[h]?.[0]?.ask ?? -1) !== -1)!
    expect(getPriceSourceOf(withMarket, 0, "ask")).toBe("market")

    applyFallback(fallbackSettings([true, "bigset"], [true, "bigset"], true))
    expect(getPriceSourceOf(withMarket, 0, "ask")).toBe("selfcraft")
    expect(getPriceOf(withMarket, 0).ask, "强制大全套后价格应来自自产成本").not.toBe(-1)
  })
})
