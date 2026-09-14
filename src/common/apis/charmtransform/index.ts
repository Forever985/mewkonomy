import type { IngredientPriceConfig, ProductPriceConfig } from "@/calculator"
import { TransmuteCalculator } from "@/calculator/alchemy"
import { getGameDataApi, getMarketDataApi, getPriceOf } from "@/common/apis/game"
import { getTrans } from "@/locales"

/**
 * 冲泡护符转化盈利（理想价格 / 实际价格）
 *
 * 链路：冲泡精华 → 冲泡护符（逐级合成 basic→advanced→expert→master→grandmaster）→ 转化
 * - 实际价格：产出护符按市场真实成交价（bid）计；无流动性的护符按 0 价值（卖不出）
 * - 理想价格：产出护符若市场无人买/无人卖（无流动性），视为市场由用户主宰，
 *   挂价上限 = 该产出护符「自身精华直接制作成本」（essenceCount × 该护符精华ask），
 *   有流动性的护符仍按市场价计
 */

const CHARM_TIERS = ["basic", "advanced", "expert", "master", "grandmaster"] as const
export type CharmTier = (typeof CHARM_TIERS)[number]

/** 制造链：basic=10000 精华，advanced=8×basic，expert=6×advanced，master=4×expert，grandmaster=2×master */
const TIER_ESSENCE_COUNT: Record<CharmTier, number> = {
  basic: 10000,
  advanced: 10000 * 8,
  expert: 10000 * 8 * 6,
  master: 10000 * 8 * 6 * 4,
  grandmaster: 10000 * 8 * 6 * 4 * 2
}

export function getCharmTierLabel(tier: CharmTier): string {
  return getTrans(`CharmTier.${tier}`)
}

export interface CharmProductResult {
  hrid: string
  name: string
  /** 掉落倍率（各护符 10%） */
  rate: number
  /** 市场真实成交价（-1 = 无流动性） */
  askActual: number
  bidActual: number
  /** 该产出护符自身精华直接制作成本（挂价上限） */
  essenceCost: number
  /** 是否无流动性（市场无人买卖）→ 由用户主宰挂价 */
  isIdeal: boolean
  /** 理想挂价（无流动性=essenceCost，否则=市场bid） */
  bidIdeal: number
}

export interface CharmTierResult {
  tier: CharmTier
  charmHrid: string
  charmName: string
  /** 从精华制作到该档冲泡护符所需精华数 */
  essenceCount: number
  /** 精华成本（essenceCount × 精华ask，-1 表示精华无价不可算） */
  essenceCost: number
  /** 该档冲泡护符市场买入价（参考） */
  charmAskActual: number
  successRate: number
  incomeActualPH: number
  incomeIdealPH: number
  costPH: number
  profitActualPH: number
  profitIdealPH: number
  profitActualRate: number
  profitIdealRate: number
  valid: boolean
  products: CharmProductResult[]
}

/**
 * 计算各档冲泡护符转化的盈利（实际/理想双口径）
 * @param catalystRank 催化剂 0=无 1=普通 2=主要
 */
export function calcCharmTransformApi(catalystRank: number = 0): CharmTierResult[] {
  const essencePrice = getPriceOf("/items/brewing_essence").ask
  const results: CharmTierResult[] = []

  for (const tier of CHARM_TIERS) {
    const charmHrid = `/items/${tier}_brewing_charm`
    const charmItem = getGameDataApi().itemDetailMap[charmHrid]
    const essenceCount = TIER_ESSENCE_COUNT[tier]
    const essenceCost = essencePrice > 0 ? essenceCount * essencePrice : -1
    const charmAskActual = getMarketDataApi().marketData[charmHrid]?.[0]?.ask ?? -1

    // 产出护符自身精华直接制作成本：/items/basic_milking_charm → /items/milking_essence
    const ownCraftCostOf = (charmHrid: string): number => {
      const essenceHrid = charmHrid.replace(/\/items\/[^_]+_(.+)_charm$/, "/items/$1_essence")
      const ask = getPriceOf(essenceHrid).ask
      return ask > 0 ? essenceCount * ask : -1
    }

    // 先实例化读取产出表，逐个判定流动性
    const probe = new TransmuteCalculator({ hrid: charmHrid, catalystRank })
    const productMeta = probe.productList.map((p) => {
      const raw = getMarketDataApi().marketData[p.hrid]?.[0]
      const ask = raw?.ask ?? -1
      const bid = raw?.bid ?? -1
      const hasLiquidity = ask >= 0 || bid >= 0
      // 无流动性产出护符的挂价上限 = 其「自身精华」直接制作成本（而非投入冲泡护符成本）
      const ownCraftCost = p.hrid.endsWith("_charm") ? ownCraftCostOf(p.hrid) : -1
      return { hrid: p.hrid, rate: p.rate ?? 1, ask, bid, hasLiquidity, ownCraftCost }
    })

    // 投入护符自产成本注入（用户自制作冲泡护符，不按市场买入价）
    const ingredientConfig: IngredientPriceConfig[] = essenceCost > 0
      ? [{ hrid: charmHrid, immutable: true, price: essenceCost }]
      : []

    // 产出价格覆盖：仅无流动性的护符需要覆盖（实际=0 / 理想=essenceCost），crate/essence 掉落保持市场价
    const productActualConfig: ProductPriceConfig[] = productMeta.map(p =>
      p.hrid.endsWith("_charm") && !p.hasLiquidity ? { hrid: p.hrid, immutable: true, price: 0 } : undefined!
    )
    const productIdealConfig: ProductPriceConfig[] = productMeta.map(p =>
      p.hrid.endsWith("_charm") && !p.hasLiquidity
        ? { hrid: p.hrid, immutable: true, price: p.ownCraftCost > 0 ? p.ownCraftCost : 0 }
        : undefined!
    )

    const calcActual = new TransmuteCalculator({
      hrid: charmHrid,
      catalystRank,
      ingredientPriceConfigList: ingredientConfig,
      productPriceConfigList: productActualConfig
    })
    const calcIdeal = new TransmuteCalculator({
      hrid: charmHrid,
      catalystRank,
      ingredientPriceConfigList: ingredientConfig,
      productPriceConfigList: productIdealConfig
    })
    calcActual.run()
    calcIdeal.run()

    const products: CharmProductResult[] = productMeta.map(p => ({
      hrid: p.hrid,
      name: getTrans(getGameDataApi().itemDetailMap[p.hrid].name),
      rate: p.rate,
      askActual: p.ask,
      bidActual: p.bid,
      essenceCost: p.ownCraftCost > 0 ? p.ownCraftCost : -1,
      isIdeal: !p.hasLiquidity,
      bidIdeal: p.hasLiquidity ? p.bid : (p.ownCraftCost > 0 ? p.ownCraftCost : 0)
    }))

    results.push({
      tier,
      charmHrid,
      charmName: getTrans(charmItem.name),
      essenceCount,
      essenceCost,
      charmAskActual,
      successRate: calcActual.successRate,
      incomeActualPH: calcActual.result.incomePH,
      incomeIdealPH: calcIdeal.result.incomePH,
      costPH: calcActual.result.costPH,
      profitActualPH: calcActual.result.profitPH,
      profitIdealPH: calcIdeal.result.profitPH,
      profitActualRate: calcActual.result.profitRate,
      profitIdealRate: calcIdeal.result.profitRate,
      valid: essenceCost > 0 && calcActual.valid,
      products
    })
  }

  return results
}
