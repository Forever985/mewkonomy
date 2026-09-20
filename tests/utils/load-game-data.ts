import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * 测试用数据装载（公共 helper）
 *
 * 解决的三个反复踩坑的问题：
 * 1. 数据实际在 `public/data/`，早期测试写的是 `data/`，beforeAll 直接抛异常
 *    → 整个文件的所有用例"失败"，看起来像计算逻辑坏了，其实是测试没装数据。
 * 2. 本地 `market.json` 是 `{ market: { 物品名: { ask, bid, vendor } }, time }` 形态，
 *    而运行时用的是 `{ marketData: { hrid: { level: { ask, bid } } }, timestamp }`，必须转换。
 * 3. game API 的只读快照（`game.gameData` / `game.marketData`）依赖**模块级 watch**，
 *    而 watch 是异步触发的。只写 localStorage 不够，必须显式注入 store 状态并等一拍，
 *    否则 `getMarketDataApi()` 一直是 null。
 *
 * 另外：全量跑测试时多个文件共用一个 fork，重复注入会反复触发 game API 的全量索引重建
 * （大全套可采集集合 + 炼金反查表），足以把 beforeAll 拖到超时——因此模块内做一次性守卫。
 */
let loaded = false

/**
 * 把已抓好的数据注入 game store（**不**做模块重置）。
 *
 * 用于 `vi.resetModules()` 之后重新填充 store：resetModules 会丢弃 store 实例，
 * 而 game API 的模块级 watch 在重新 import 时立刻需要 gameData，否则 initBigSetCache
 * 会因 `getGameDataApi()` 为 null 而抛 "Cannot read properties of null (reading 'actionDetailMap')"。
 */
export async function seedGameData(gameData: unknown, marketData: unknown): Promise<void> {
  const { useGameStoreOutside } = await import("@/pinia/stores/game")
  const store = useGameStoreOutside()
  store.gameData = gameData as any
  store.marketData = marketData as any
  // 等模块级 watch 完成只读快照重建
  await new Promise(r => setTimeout(r, 0))
}

export async function loadTestGameData(): Promise<void> {
  if (loaded) {
    return
  }
  loaded = true

  const root = process.cwd()
  const gameData = JSON.parse(readFileSync(resolve(root, "public/data/data.json"), "utf-8"))
  const marketRaw = JSON.parse(readFileSync(resolve(root, "public/data/market.json"), "utf-8"))

  const marketData: { timestamp: number, marketData: Record<string, Record<string, { ask: number, bid: number }>> } = {
    timestamp: 0,
    marketData: {}
  }

  const nameToHrid: Record<string, string> = {}
  for (const hrid in gameData.itemDetailMap) {
    nameToHrid[gameData.itemDetailMap[hrid].name] = hrid
  }
  for (const name in marketRaw.market) {
    const price = marketRaw.market[name]
    const hrid = nameToHrid[name]
    if (hrid && price && typeof price.ask === "number" && typeof price.bid === "number") {
      marketData.marketData[hrid] = { 0: { ask: price.ask, bid: price.bid } }
    }
  }

  localStorage.setItem("game-game-data", JSON.stringify(gameData))
  localStorage.setItem("game-market-data", JSON.stringify(marketData))

  await seedGameData(gameData, marketData)
}
