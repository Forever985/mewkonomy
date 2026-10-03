import type Calculator from "@/calculator"
import { MARKET_TAX_FACTOR } from "@@/constants/market"
import { COIN_HRID } from "@/pinia/stores/game"

/**
 * 「目标时薪 → 临界单价」反解。
 *
 * ## 为什么能精确反解
 * 计算器的时薪是**对每个单价都线性**的：
 * ```
 * costPH   = Σ countPH_i × price_i                    （材料/成本侧）
 * incomePH = Σ (税后系数 / 金币系数) × countPH_j × price_j   （成品/收益侧）
 * profitPH = incomePH − costPH
 * ```
 * 所以单价涨 1 金币，时薪的变化量是个常数（就是「偏导系数」），反解是闭式解、无需迭代：
 * ```
 * 临界单价 = 当前单价 + (目标时薪 − 当前时薪) / 系数
 * ```
 * 材料侧系数为**负**（买贵了利润下降），成品侧为**正**。
 *
 * ## 本模块的定位
 * **零运行时依赖**（只 import 类型与常量），因此可以脱开游戏数据独立单测；
 * 物品名、市场档位价这些需要数据层的东西，由调用方（组件）负责补上。
 */

/** 反解的是成本侧（材料买价）还是收益侧（成品卖价） */
export type SolveSide = "ingredient" | "product"

export interface SolveCandidate {
  /** 唯一标识 `hrid|level`，供 UI 选择 */
  key: string
  hrid: string
  level?: number
  side: SolveSide
  /** 每小时用量（材料）/ 产量（成品）——系数就是由它换算出来的 */
  countPH: number
  /** 方案当前采用的价格 */
  price: number
  /** 原始市价（未套用买卖口径的参考值） */
  marketPrice: number
  /** 价格来源，非 market 时说明它不是真实市价（如自产估值） */
  priceSource?: string
  /** 单价每涨 1 金币，时薪的变化量：材料为负、成品为正 */
  coefficient: number
}

export interface SolveResult {
  candidate: SolveCandidate
  /** 达成目标时薪的临界单价 */
  criticalPrice: number
  /** 当前时薪 */
  currentProfitPH: number
  /** 目标时薪 */
  targetProfitPH: number
  /** 临界价 − 当前价（材料侧为正 = 还能买更贵；成品侧为正 = 还能卖更贵） */
  priceGap: number
  /**
   * 目标是否在当前市场下不可能达成。
   * 材料侧：临界价 ≤ 0（白送都达不到）；成品侧：临界价 ≤ 0（卖不出正价）。
   */
  impossible: boolean
}

export function solveCandidateKeyOf(hrid: string, level?: number): string {
  return `${hrid}|${level ?? 0}`
}

/**
 * 单价每涨 1 金币对应的时薪变化量。
 * - 材料侧：`costPH` 里是 `+countPH × price` → 系数 `−countPH`
 * - 成品侧：`incomePH` 里是 `+(税后系数/金币系数) × countPH × price`
 *   金币不课税（源码里先除税后系数再乘回来抵消），故金币的系数不带税率
 */
function coefficientOf(side: SolveSide, countPH: number, hrid: string): number {
  if (side === "ingredient") {
    return -countPH
  }
  return countPH * (hrid === COIN_HRID ? 1 : MARKET_TAX_FACTOR)
}

/** 材料列表：`countPH` 缺省时按 `count × consumePH` 兜底 */
export function ingredientCandidatesOf(calc: Calculator): SolveCandidate[] {
  return calc.ingredientListWithPrice
    .filter(ing => ing.countPH !== 0)
    .map((ing) => {
      const countPH = ing.countPH ?? ing.count * calc.consumePH
      return {
        key: solveCandidateKeyOf(ing.hrid, ing.level),
        hrid: ing.hrid,
        level: ing.level,
        side: "ingredient" as const,
        countPH,
        price: ing.price,
        marketPrice: ing.marketPrice,
        priceSource: ing.priceSource,
        coefficient: coefficientOf("ingredient", countPH, ing.hrid)
      }
    })
}

/** 成品列表：`countPH` 缺省时按 `count × gainPH × rate` 兜底 */
export function productCandidatesOf(calc: Calculator): SolveCandidate[] {
  return calc.productListWithPrice
    .filter(p => p.countPH !== 0)
    .map((p) => {
      const rate = p.rate || 1
      const countPH = p.countPH ?? p.count * calc.gainPH * rate
      return {
        key: solveCandidateKeyOf(p.hrid, p.level),
        hrid: p.hrid,
        level: p.level,
        side: "product" as const,
        countPH,
        price: p.price,
        marketPrice: p.marketPrice,
        priceSource: p.priceSource,
        coefficient: coefficientOf("product", countPH, p.hrid)
      }
    })
}

/** 全部可反解的物品：材料在前、成品在后 */
export function solveCandidatesOf(calc: Calculator): SolveCandidate[] {
  return [...ingredientCandidatesOf(calc), ...productCandidatesOf(calc)]
}

/**
 * 「主要询价物品」= 方案的第 1 个材料（本体/主料）。
 *
 * 约定来源：`cost4Mat` 明确「从第 2 个原料开始计算」，即 `ingredientList[0]` 是本体；
 * 详情弹窗里强化平均耗时也用它算。
 * 语义上它就是「你真正要去买的那件东西」——分解茶叶时是茶叶、转化宝石时是宝石。
 */
export function primaryCandidateOf(calc: Calculator): SolveCandidate | undefined {
  return solveCandidatesOf(calc)[0]
}

/**
 * 反解临界单价。
 *
 * @param profitPH 当前时薪（`calc.result.profitPH`）
 * @param targetProfitPH 目标时薪
 */
export function solvePriceForTarget(
  profitPH: number,
  candidate: SolveCandidate,
  targetProfitPH: number
): SolveResult | null {
  if (!Number.isFinite(profitPH) || !Number.isFinite(targetProfitPH)) {
    return null
  }
  if (candidate.coefficient === 0) {
    return null
  }
  const criticalPrice = candidate.price + (targetProfitPH - profitPH) / candidate.coefficient
  return {
    candidate,
    criticalPrice,
    currentProfitPH: profitPH,
    targetProfitPH,
    priceGap: criticalPrice - candidate.price,
    impossible: criticalPrice <= 0
  }
}
