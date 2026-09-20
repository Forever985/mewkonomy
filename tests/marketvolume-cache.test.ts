import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"

// 与 game.ts 内 KEY_PREFIX 保持一致
const KEY = "game-market-data"

describe("marketvolume 旧缓存兼容（getMarketData 过期检测）", () => {
  /**
   * 预热 game store 的模块图（locales / element-plus 等重依赖）。
   *
   * 本文件的用例靠 `vi.resetModules()` + 动态 import 重建 store；首次 import 在冷启动时
   * 需要数秒（转换 element-plus / auto-import 依赖图），并发跑全量用例时会撞上默认 5s 的
   * testTimeout（vite.config.ts 中 testTimeout 那行被上一条注释吞掉，实际未生效；
   * hookTimeout=60s 仍然生效）。把这次冷启动放进 beforeAll（hook 超时 60s）里完成，
   * 用例本身只做 localStorage 形态断定，语义完全不变。
   */
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

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
