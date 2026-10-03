import { PRICE_STATUS_LIST, PriceStatus, useGameStoreOutside } from "@/pinia/stores/game"
import { beforeAll, describe, expect, it } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"

/**
 * 价格「档位」口径（左/右 × `-` / 原价 / `+` 共 6 个）的测试。
 *
 * 分两层：
 * 1. **列表层**（不需要数据）：6 个口径齐全、顺序与标签后缀符合约定。
 * 2. **换算层**（需要真实数据）：档位确实按「一档增量」移动，且强化物品（level ≥ 1）是 5 倍。
 *
 * ⚠️ 换算层必须等 `loadTestGameData()` 播完种再**动态**导入 `@/common/apis/game`：
 * 该模块顶层注册了 `watch(..., { immediate: true })` 重建全量索引，
 * 静态导入会先于播种执行，直接抛 `Cannot read properties of null (reading 'actionDetailMap')`。
 * 而 `@/pinia/stores/game`（只含枚举/列表）没有这个依赖，可以静态导入。
 */

const EQUIP = "/items/advanced_alchemy_charm"
/** 与 `common/apis/game/index.ts` 的 PRICE_STEP_RATIO 对应 */
const STEP = 0.00366
/** 与 PRICE_STEP_ENHANCED_MULTIPLIER 对应 */
const ENHANCED_MULTIPLIER = 5
const BIG = 1_000_000

describe("价格档位：选项列表", () => {
  it("提供 6 个口径，覆盖 左/右 × (-, 原价, +)", () => {
    expect(PRICE_STATUS_LIST.map(o => o.value)).toEqual([
      PriceStatus.ASK_LOW,
      PriceStatus.ASK,
      PriceStatus.ASK_HIGH,
      PriceStatus.BID_LOW,
      PriceStatus.BID,
      PriceStatus.BID_HIGH
    ])
    expect(new Set(PRICE_STATUS_LIST.map(o => o.value)).size).toBe(6)
  })

  it("同一报价内按价格由低到高排列，标签后缀与顺序一致", () => {
    const labels = PRICE_STATUS_LIST.map(o => o.label)
    expect(labels).toHaveLength(6)
    // 左组：左价- < 左价 < 左价+
    expect(labels[0].endsWith("-")).toBe(true)
    expect(labels[2].endsWith("+")).toBe(true)
    expect(labels[0].slice(0, -1)).toBe(labels[1])
    expect(labels[1]).toBe(labels[2].slice(0, -1))
    // 右组同理
    expect(labels[3].endsWith("-")).toBe(true)
    expect(labels[5].endsWith("+")).toBe(true)
    expect(labels[3].slice(0, -1)).toBe(labels[4])
    expect(labels[4]).toBe(labels[5].slice(0, -1))
    // 两组是不同的报价
    expect(labels[1]).not.toBe(labels[4])
  })
})

describe("价格档位：档位换算", () => {
  let getPriceOf: typeof import("@/common/apis/game").getPriceOf

  beforeAll(async () => {
    await loadTestGameData()

    // 只注入这一个物品：`getPriceOf` 的档位换算只依赖 ask/bid 两个数，
    // 而 game data（actionDetailMap 等）已由 loadTestGameData 播好，够用了。
    // ⚠️ 必须赋一个**全新字面量**：game api 的模块级 watch 会对 store.marketData 做
    // `structuredClone(toRaw(...))`，而 `toRaw` 只解顶层——从 reactive 代理上展开出来的
    // 嵌套对象仍是代理，会直接抛 `DataCloneError: could not be cloned`。
    const store = useGameStoreOutside()
    store.marketData = {
      timestamp: 1_700_000_000,
      marketData: {
        [EQUIP]: {
          0: { ask: BIG, bid: BIG - 10_000 },
          3: { ask: BIG, bid: BIG - 10_000 },
          5: { ask: 10, bid: 9 }
        }
      }
    }
    await new Promise(r => setTimeout(r, 0))

    getPriceOf = (await import("@/common/apis/game")).getPriceOf
  }, 300000)

  /** 取某个 (档位, 口径) 下的价：ASK_* 读 ask 侧，BID_* 读 bid 侧 */
  function valueOf(level: number, status: PriceStatus): number {
    const p = getPriceOf(EQUIP, level, status, status)
    return status.startsWith("ASK") ? p.ask : p.bid
  }

  it("0 级（未强化）：三个左价口径严格递增，三个右价口径严格递增", () => {
    const askLow = valueOf(0, PriceStatus.ASK_LOW)
    const ask = valueOf(0, PriceStatus.ASK)
    const askHigh = valueOf(0, PriceStatus.ASK_HIGH)
    expect(askLow).toBeLessThan(ask)
    expect(ask).toBeLessThan(askHigh)

    const bidLow = valueOf(0, PriceStatus.BID_LOW)
    const bid = valueOf(0, PriceStatus.BID)
    const bidHigh = valueOf(0, PriceStatus.BID_HIGH)
    expect(bidLow).toBeLessThan(bid)
    expect(bid).toBeLessThan(bidHigh)
  })

  it("0 级：抬/压一档的幅度就是 0.366%（含端点之外的新口径也走同一档位表）", () => {
    const ask = valueOf(0, PriceStatus.ASK)
    expect(ask).toBe(BIG)
    expect(valueOf(0, PriceStatus.ASK_HIGH) / ask - 1).toBeCloseTo(STEP, 4)
    expect(1 - valueOf(0, PriceStatus.ASK_LOW) / ask).toBeCloseTo(STEP, 4)
    const bid = valueOf(0, PriceStatus.BID)
    expect(valueOf(0, PriceStatus.BID_HIGH) / bid - 1).toBeCloseTo(STEP, 4)
    expect(1 - valueOf(0, PriceStatus.BID_LOW) / bid).toBeCloseTo(STEP, 4)
  })

  it("强化物品（level 3）：一档增量是标准档位的 5 倍", () => {
    const ask0 = valueOf(0, PriceStatus.ASK)
    const step0 = valueOf(0, PriceStatus.ASK_HIGH) / ask0 - 1

    const ask3 = valueOf(3, PriceStatus.ASK)
    expect(ask3).toBe(BIG)
    const step3 = valueOf(3, PriceStatus.ASK_HIGH) / ask3 - 1

    expect(step3).toBeCloseTo(STEP * ENHANCED_MULTIPLIER, 4)
    expect(step3 / step0).toBeCloseTo(ENHANCED_MULTIPLIER, 1)
    // 方向同样正确
    expect(valueOf(3, PriceStatus.ASK_LOW)).toBeLessThan(ask3)
    expect(valueOf(3, PriceStatus.BID_LOW)).toBeLessThan(valueOf(3, PriceStatus.BID))
  })

  it("低价物品一档不足 1 金时，保底移动 1 金（不会原地不动）", () => {
    // 10 × 1.0183 = 10.18 → 取整仍是 10，必须保底到 11
    expect(valueOf(5, PriceStatus.ASK_HIGH)).toBe(11)
    expect(valueOf(5, PriceStatus.ASK_LOW)).toBe(9)
    expect(valueOf(5, PriceStatus.BID_HIGH)).toBe(10)
    expect(valueOf(5, PriceStatus.BID_LOW)).toBe(8)
  })

  it("无价（该档位市场无报价）时任何口径都保持 -1，不虚构价格", () => {
    const store = useGameStoreOutside()
    const previous = store.priceFallbackMode
    // A 模式 = 完全不做兜底，避免 sellPrice / 大全套把 -1 填掉
    store.priceFallbackMode = "A"
    try {
      const p = getPriceOf(EQUIP, 7, PriceStatus.ASK_HIGH, PriceStatus.BID_LOW)
      expect(p.ask).toBe(-1)
      expect(p.bid).toBe(-1)
    } finally {
      store.priceFallbackMode = previous
    }
  })
})
