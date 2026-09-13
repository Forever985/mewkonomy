import { describe, expect, it, vi, beforeEach } from "vitest"

// 与 game.ts 内 KEY_PREFIX 保持一致
const KEY = "game-market-data"

describe("marketvolume 旧缓存兼容（getMarketData 过期检测）", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  async function loadStore() {
    const { useGameStoreOutside } = await import("@/pinia/stores/game")
    return useGameStoreOutside()
  }

  it("旧结构缓存（仅 ask/bid，无 volume）被判定过期并清除", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        timestamp: 1234567890,
        marketData: { "/items/apple": { 0: { ask: 100, bid: 90 } } }
      })
    )
    const store = await loadStore()
    expect(store.marketData).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it("新结构缓存（含 volume 字段）保留并正常读取", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        timestamp: 1234567890,
        marketData: { "/items/apple": { 0: { ask: 100, bid: 90, price: 95, volume: 1200 } } }
      })
    )
    const store = await loadStore()
    expect(store.marketData).not.toBeNull()
    expect(store.marketData!.marketData["/items/apple"]["0"].volume).toBe(1200)
  })

  it("无缓存时返回 null", async () => {
    const store = await loadStore()
    expect(store.marketData).toBeNull()
  })
})
