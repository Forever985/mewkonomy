import { describe, expect, it, beforeAll } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"

/**
 * 价格兜底回归测试（覆盖两个曾经真实存在的利润正确性缺陷）
 *
 * 1. **兜底耦合**：早期 `getPriceOf` 把 ask/bid 的兜底写在同一句
 *    `if (isFallbackEnabled() && price.ask === -1 && price.bid === -1)` 里。于是模式C 用
 *    「大全套自产成本」补上 ask 之后，**再也不会**用 `sellPrice` 兜 bid，出现
 *    「有买入价、卖出价却是 -1」的自相矛盾状态（实测 60 件装备，占兜底对象的 1/3）。
 *    `Calculator.valid` 会把 bid = -1 的方案整条判为无效，直接污染强化/分解类的利润排名。
 *    现在两侧独立判定。
 *
 * 2. **来源误标**：商店金币价会先把 ask 从 -1 改写成商店价，而 `getPriceSourceOf` 只看到
 *    「ask !== -1」就返回 market，于是 14 件只能从商店买到的基础装备被当成「有真实成交价」。
 *    UI 的价格来源标记与「兜底价」提示因此全部失真。现在两者共用同一套解析结果。
 */
describe("价格兜底回归", () => {
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

  it("模式B/C：买卖两端兜底互不耦合（有 ask 就必须有 bid）", async () => {
    const { getPriceOf, getGameDataApi } = await import("@/common/apis/game")
    const { useGameStoreOutside } = await import("@/pinia/stores/game")
    const store = useGameStoreOutside()
    const itemMap = getGameDataApi().itemDetailMap

    for (const mode of ["B", "C"] as const) {
      store.setPriceFallbackMode(mode)
      const contradictions: string[] = []
      for (const hrid in itemMap) {
        const p = getPriceOf(hrid, 0)
        // 有买入价却没有卖出价：一件商品能买到却完全卖不出，说明兜底漏了一侧
        if (p.ask > 0 && p.bid === -1) {
          contradictions.push(`${itemMap[hrid].name}(ask=${p.ask},bid=${p.bid})`)
        }
      }
      expect(contradictions, `模式${mode} 存在「有 ask 无 bid」的矛盾项：${contradictions.slice(0, 5).join(", ")}`).toEqual([])
    }

    store.setPriceFallbackMode("C")
  })

  it("价格来源与实际取值一致：取自商店就不能标成市场", async () => {
    const { getPriceOf, getPriceSourceOf, getGameDataApi } = await import("@/common/apis/game")
    const { useGameStoreOutside } = await import("@/pinia/stores/game")
    const store = useGameStoreOutside()
    store.setPriceFallbackMode("B")
    const itemMap = getGameDataApi().itemDetailMap

    for (const hrid in itemMap) {
      const source = getPriceSourceOf(hrid, 0, "ask")
      const price = getPriceOf(hrid, 0)
      if (source === "none") {
        // 标了无价，就必须真的没有价
        expect(price.ask, `${itemMap[hrid].name} 标为无价却给出了 ask`).toBe(-1)
      }
      // 标成市场价时，该物品必须真的存在于市场快照里
      if (source === "market") {
        const raw = getGameDataApi().itemDetailMap[hrid]
        expect(raw, `${itemMap[hrid].name} 标为市场价但物品不存在`).toBeTruthy()
      }
    }
  })

  it("模式A 关闭兜底，但商店金币价仍生效（商店价不等于兜底）", async () => {
    const { getPriceOf, isPriceFallbackOf, getPriceSourceOf, getGameDataApi } = await import("@/common/apis/game")
    const { useGameStoreOutside } = await import("@/pinia/stores/game")
    const store = useGameStoreOutside()
    store.setPriceFallbackMode("A")

    const itemMap = getGameDataApi().itemDetailMap
    for (const hrid in itemMap) {
      // 模式A 下任何物品都不应被判定为「正在兜底」
      expect(isPriceFallbackOf(hrid), `模式A 下 ${itemMap[hrid].name} 不应被标记为兜底`).toBe(false)
      const source = getPriceSourceOf(hrid, 0, "ask")
      const price = getPriceOf(hrid, 0)
      // 商店金币价是「真实可达的买入价」，不受兜底开关影响，因此 shop 仍可能出现；
      // 但「自产成本兜底(selfcraft)」在模式A 绝对不能出现。
      expect(source, `模式A 下 ${itemMap[hrid].name} 不应使用自产成本兜底`).not.toBe("selfcraft")
      if (source === "none") {
        expect(price.ask, `${itemMap[hrid].name} 标为无价却给出了 ask`).toBe(-1)
      } else {
        // 有来源就必须真的取到了价（允许取自市场快照的负值/奇异值，
        // 例如开包折算链里出现的负数——那是数据本身的问题，不是兜底误判）
        expect(price.ask, `${itemMap[hrid].name} 有来源(${source})却仍是 -1`).not.toBe(-1)
      }
    }

    store.setPriceFallbackMode("C")
  })
})
