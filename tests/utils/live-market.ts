import { readFileSync, existsSync } from "node:fs"
import { loadTestGameData, seedGameData } from "./load-game-data"

/**
 * 装载**官方实时市场数据**（可选）。
 *
 * ## 为什么需要它
 *
 * 仓库自带的 `public/data/market.json` 是 2025-01-21 的旧快照，
 * 里面**所有护符零报价**（见 MILKONOMY_PROJECT_CONTEXT §33）。
 * 用它测「护符转化的盈亏平衡」毫无意义 —— 分母恒为 0。
 *
 * ## 为什么不是硬依赖
 *
 * 实时数据要从 `https://www.milkywayidle.com/game_data/marketplace.json` 拉，
 * CI 与离线环境都拿不到。**测试不能因为网络问题而失败。**
 *
 * 所以策略是：
 * 1. 若仓库根目录存在 `live_market_tmp.json`（开发者手动 curl 下来的）⇒ 用它；
 * 2. 否则**自造**一份最小市价，让测试仍然能跑完并保持有意义。
 *
 * ## 自造数据的关键约束
 *
 * 护符必须**双边有报价**且**市价 ≠ 自制成本**，否则：
 * - 只有单边报价时 `priceFallback` 默认 `cross: true` 会借另一端，
 *   三种买价口径算出同一个数 ⇒ 断言「随口径变化」会假通过；
 * - 市价恰好等于自制成本时，「是否走了轮子」无法区分。
 */
export async function loadLiveMarketOrFake(): Promise<"live" | "fake"> {
  await loadTestGameData()
  const { useGameStoreOutside } = await import("@/pinia/stores/game")
  const gameData = useGameStoreOutside().gameData

  // ── 1) 有本地实时快照就用它 ──
  if (existsSync("live_market_tmp.json")) {
    const live = JSON.parse(readFileSync("live_market_tmp.json", "utf-8"))
    const md: Record<string, Record<string, { ask: number, bid: number, volume: number }>> = {}
    for (const hrid in live.marketData) {
      md[hrid] = {}
      for (const level in live.marketData[hrid]) {
        const r = live.marketData[hrid][level]
        md[hrid][level] = { ask: r.a ?? -1, bid: r.b ?? -1, volume: r.v ?? 0 }
      }
    }
    await seedGameData(gameData, { timestamp: live.timestamp, marketData: md })
    return "live"
  }

  // ── 2) 否则自造：护符双边报价 + 催化剂与茶也造价 ──
  const md: Record<string, Record<string, { ask: number, bid: number, volume: number }>> = {}
  md["/items/brewing_essence"] = { 0: { ask: 285, bid: 280, volume: 100 } }
  for (const skill of [
    "milking", "foraging", "woodcutting", "cheesesmithing", "crafting",
    "tailoring", "cooking", "alchemy", "enhancing"
  ]) {
    md[`/items/${skill}_essence`] = { 0: { ask: 900, bid: 880, volume: 100 } }
  }
  // 护符：ask=777 / bid=555 —— 刻意不等于任何自制成本（10000×285 = 285 万）
  for (const tier of ["basic", "advanced", "expert", "master", "grandmaster"]) {
    md[`/items/${tier}_brewing_charm`] = { 0: { ask: 777, bid: 555, volume: 50 } }
    for (const skill of [
      "milking", "foraging", "woodcutting", "cheesesmithing", "crafting",
      "tailoring", "cooking", "brewing", "alchemy", "enhancing"
    ]) {
      md[`/items/${tier}_${skill}_charm`] = { 0: { ask: 800, bid: 600, volume: 50 } }
    }
  }
  // 催化剂与茶：`Calculator.valid` 要求**所有**投入项 price !== -1
  for (const hrid of [
    "/items/catalyst_of_transmutation",
    "/items/prime_catalyst",
    "/items/catalyst_of_decomposition",
    "/items/catalyst_of_coinification",
    "/items/wisdom_tea",
    "/items/efficiency_tea",
    "/items/catalytic_tea",
    "/items/alchemy_tea"
  ]) {
    md[hrid] = { 0: { ask: 1000, bid: 900, volume: 100 } }
  }
  await seedGameData(gameData, { timestamp: 1, marketData: md })
  return "fake"
}
