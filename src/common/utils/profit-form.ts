import type Calculator from "@/calculator"
import type { SolveSide } from "./price-solve"
import { MARKET_TAX_FACTOR } from "@@/constants/market"
import { COIN_HRID } from "@/pinia/stores/game"
import { solveCandidatesOf } from "./price-solve"

/**
 * 「填表计算利润」的纯计算部分。
 *
 * ## 设计要点：默认值必须精确复现计算器自己的数字
 * 表单里每一行的默认值都直接来自计算器，因此**什么都不改时**：
 * ```
 * 总成本 ≡ calc.result.costPH     总收入 ≡ calc.result.incomePH
 * 总利润 ≡ calc.result.profitPH   总耗时 ≡ 1 小时    时薪 ≡ calc.result.profitPH
 * ```
 * 于是「改哪个就是覆盖哪个」变得可验证 —— 这是本模块最重要的性质，
 * 单测里直接断言这四个等式（见 tests/profit-form.test.ts）。
 *
 * ## 为什么不需要碰市场数据
 * 利润对每个单价都是线性的（同 `price-solve` 的结论），
 * 只要拿到每个物品的「每小时用量」`countPH`，换成「每次动作数量」后
 * 就能用任意一组手填价格算出利润，与实时市价完全解耦 —— 这正是"非实时"想要的效果。
 */

/** 1 小时 = 3600 × 1e9 纳秒（计算器的时间单位是纳秒） */
export const NS_PER_HOUR = 60 * 60 * 1_000_000_000

export interface ProfitFormRow {
  /** 物品唯一标识，用于对齐用户的手填值 */
  key: string
  hrid: string
  level?: number
  side: SolveSide
  /** 每次动作的期望数量（已含成功率/掉率/工匠补正），可手改 */
  perActionCount: number
  /** 单价，可手改 */
  price: number
  /** 价格来源；非 market 说明当前不是真实市价（自产估值/商店价） */
  priceSource?: string
}

export interface ProfitFormState {
  rows: ProfitFormRow[]
  /** 动作次数 */
  actions: number
  /** 单次动作耗时（纳秒） */
  timeCostPerAction: number
}

export interface ProfitFormResult {
  /** 总成本（金币） */
  cost: number
  /** 总收入（已课税） */
  income: number
  /** 总利润 */
  profit: number
  /** 总耗时（纳秒） */
  totalTimeNs: number
  /** 总耗时（小时） */
  hours: number
  /** 折合时薪 */
  profitPH: number
  /** 利润率；成本为 0 时为 null（不是 0，避免"免费材料"被显示成 0% 利润） */
  profitRate: number | null
  /** 单次利润 */
  perActionProfit: number
}

/** 该行的单价系数：材料进成本、成品进收入（金币不课税） */
export function rowRateOf(row: ProfitFormRow): number {
  if (row.side === "ingredient") {
    return -1
  }
  return row.hrid === COIN_HRID ? 1 : MARKET_TAX_FACTOR
}

/**
 * 用计算器生成表单初始状态（**默认值 = 完全复现计算器**）。
 *
 * `perActionCount = countPH / actionsPH`：因为 `countPH` 是「每小时」的量，
 * 除以每小时动作数就得到「每次动作的量」；配合默认的 `actions = actionsPH`，
 * 总量又正好回到 `countPH`。
 */
export function createFormState(calc: Calculator): ProfitFormState {
  const actionsPH = calc.actionsPH
  const rows: ProfitFormRow[] = solveCandidatesOf(calc).map(c => ({
    key: c.key,
    hrid: c.hrid,
    level: c.level,
    side: c.side,
    perActionCount: actionsPH > 0 ? c.countPH / actionsPH : 0,
    price: c.price,
    priceSource: c.priceSource
  }))
  return {
    rows,
    actions: actionsPH,
    timeCostPerAction: actionsPH > 0 ? NS_PER_HOUR / actionsPH : 0
  }
}

export function computeProfitForm(state: ProfitFormState): ProfitFormResult {
  const { rows, actions, timeCostPerAction } = state

  let cost = 0
  let income = 0
  for (const row of rows) {
    const total = row.perActionCount * actions * row.price
    const rate = rowRateOf(row)
    if (rate < 0) {
      cost += -rate * total
    } else {
      income += rate * total
    }
  }

  const profit = income - cost
  const totalTimeNs = actions * timeCostPerAction
  const hours = totalTimeNs / NS_PER_HOUR

  return {
    cost,
    income,
    profit,
    totalTimeNs,
    hours,
    profitPH: hours > 0 ? profit / hours : 0,
    profitRate: cost > 0 ? profit / cost : null,
    perActionProfit: actions > 0 ? profit / actions : 0
  }
}
