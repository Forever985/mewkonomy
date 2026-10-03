import type { PriceFallbackSettings } from "@/common/utils/price-fallback"
import { useGameStoreOutside } from "@/pinia/stores/game"

/**
 * 测试里构造兜底设置的便捷入口。
 *
 * 新模型是「左右两侧各自一条优先级链」，直接手写对象太啰嗦；
 * 这里用 `[是否借另一端, 仍无着落时用啥]` 的元组表达，顺带把旧 A/B/C 三档
 * 作为具名预设保留下来，让**旧用例的测试意图原样保留**。
 */

/** cross = 是否借用另一端；then = 借不到时用什么（none / shop / bigset） */
export function fallbackSettings(
  ask: [boolean, "none" | "shop" | "bigset"],
  bid: [boolean, "none" | "shop" | "bigset"],
  forceBigSet = false
): PriceFallbackSettings {
  return {
    ask: { cross: ask[0], then: ask[1] },
    bid: { cross: bid[0], then: bid[1] },
    forceBigSet
  }
}

/** 与旧 A/B/C 三档等价的预设（旧实现已删除，这里只为保留旧用例的语义） */
export const LEGACY_FALLBACK = {
  /** 旧 A：完全不兜底 */
  off: fallbackSettings([false, "none"], [false, "none"]),
  /** 旧 B：卖出端用商店价兜底 */
  shop: fallbackSettings([false, "none"], [false, "shop"]),
  /** 旧 C：卖出端商店价 + 买入端大全套 */
  bigset: fallbackSettings([false, "bigset"], [false, "shop"]),
  /** 现行默认：左价借右价 / 右价借左价，两端都没有则大全套 */
  chain: fallbackSettings([true, "bigset"], [true, "bigset"])
}

export function applyFallback(settings: PriceFallbackSettings) {
  useGameStoreOutside().setPriceFallback(settings)
}
