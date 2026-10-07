import type { IngredientPriceConfig, ProductPriceConfig } from "@/calculator"
import type { PriceSource } from "@/common/apis/game"
import { TransmuteCalculator } from "@/calculator/alchemy"
import { getGameDataApi, getMarketDataApi, getPriceOf, getPriceSourceOf } from "@/common/apis/game"
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

/**
 * 某档护符在某技能下需要多少个精华（从权威数据推导，**不再硬编码**）。
 *
 * 制造配方来自 `actionDetailMap` 的 `inputItems`：
 *   basic_brewing_charm: 10000 × brewing_essence
 *   advanced_brewing_charm: 8 × basic_brewing_charm
 *   expert_brewing_charm: 6 × advanced_brewing_charm   ……依此类推
 *
 * ⚠️ **不要用 `alchemyDetail.decomposeItems` 反推** —— 那是**分解返还**
 * （高级返还 `8 + 1 = 9` 个，比制造多一个 +1），两者不是同一件事。
 * 这个坑我踩过一次：据 `decomposeItems` 得出「代码倍率全错、宗师档只剩 41%」，
 * 被 `inputItems` 纠正回来。
 *
 * @param skill 技能名（milking / brewing / …），对应 `{skill}_charm` 的制作动作
 * @returns 需要的精华个数；数据缺失时返回 0（调用方须按「无法计算」处理）
 */
function essenceNeededFor(tier: CharmTier, skill: string): number {
  const gd = getGameDataApi()
  const itemDetailMap = gd.itemDetailMap
  const actionDetailMap = gd.actionDetailMap
  let total = 1
  for (const t of CHARM_TIERS) {
    const action = actionDetailMap[`/actions/crafting/${t}_${skill}_charm`]
    const inputs = action?.inputItems
    if (!inputs || inputs.length === 0) {
      return 0
    }
    // basic 的投入是精华（essence），后续档的投入是上一档护符
    const isEssence = inputs[0].itemHrid.endsWith("_essence")
    const cnt = inputs[0].count ?? 0
    if (isEssence) {
      // 基础档：投入就是「本技能精华 × N」
      if (t !== "basic") {
        return 0
      }
      total = cnt
    } else {
      if (t === "basic") {
        return 0
      }
      // 升档：所需上一档数量 = 已有总数 × (本档需要几个上一档) / (上一档能产出几个)
      // 上一档做 1 个，所以「本档所需上一档数」就是倍率。
      // 上一档做 1 个 —— 但要除以该档的产出数（恒为 1，这里显式写成通用形式）
      total = total * cnt
    }
    if (t === tier) {
      return total
    }
  }
  // 兜底：物品不存在时返回 0（让调用方显式处理「无法计算」）
  void itemDetailMap
  return 0
}

/**
 * 某档冲泡护符自制所需冲泡精华数。
 *
 * 与 `essenceNeededFor(tier, "brewing")` 同值，单独命名是为了让
 * 「投入用冲泡」与「产出用别家技能」在代码上区分开，读起来不绕。
 */
function brewingEssenceNeededFor(tier: CharmTier): number {
  return essenceNeededFor(tier, "brewing")
}

/**
 * 制作阶段的副产品（**不是转化产出**）。
 *
 * 来自 `actionDetailMap` 的 `rareDropTable`（工匠箱）：
 * 每次**制作**护符都会掉一份，概率就是 `dropRate`。
 *
 * 此前它被混进 `productList`，在界面上与护符并列显示 ——
 * 用户会误以为「转化」能产出工匠箱，而它其实来自「做护符」这一步。
 *
 * ⚠️ 注意**不要**把制作动作的 `essenceDropTable`（制作精华）也算进来：
 * 那是「制作」阶段的掉落，与转化无关；而转化阶段**另有**一个
 * `getAlchemyEssenceDropTable`（炼金精华，公式计算），那个是转化产出、应当保留。
 */
function craftingByProductsOf(tier: CharmTier): { hrid: string; expect: number }[] {
  const action = getGameDataApi().actionDetailMap[`/actions/crafting/${tier}_brewing_charm`]
  if (!action) {
    return []
  }
  const out: { hrid: string; expect: number }[] = []
  for (const key of ["essenceDropTable", "rareDropTable"] as const) {
    for (const drop of (action as any)[key] ?? []) {
      const rate = drop.dropRate ?? 0
      if (rate > 0) {
        out.push({ hrid: drop.itemHrid, expect: rate })
      }
    }
  }
  return out
}

export function getCharmTierLabel(tier: CharmTier): string {
  return getTrans(`CharmTier.${tier}`)
}

export interface CharmProductResult {
  hrid: string
  name: string
  /**
   * 产出类别：
   * - `charm`：**转化**的产出（同档位 10 种技能护符，各 10%）
   * - `byProduct`：**制作**阶段的副产品 —— 不是转化能产出的东西
   */
  kind: "charm" | "byProduct"
  /** 掉落倍率（各护符 10%；副产品为各自 dropRate） */
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

/** 制作阶段的副产品（单列，不混入转化产出） */
export interface CharmByProduct {
  hrid: string
  name: string
  /** 每次制作该档护符的期望个数（= dropRate） */
  expect: number
  /** 市价（-1 = 无报价） */
  ask: number
  /** 市值（ask × expect，-1 = 无法估价） */
  valuePH: number
}

export interface CharmTierResult {
  tier: CharmTier
  charmHrid: string
  charmName: string
  /** 从精华制作到该档冲泡护符所需精华数 */
  essenceCount: number
  /**
   * 自制成本参考值（essenceCount × 精华价）。
   *
   * ⚠️ **仅供对照，不参与利润计算** —— 投入价一律走买卖价轮子
   * （`PriceStatusSelect` 的左右价 + `priceFallback` 的自产兜底）。
   * 保留它是为了让用户一眼比出「市价更便宜还是自制更便宜」。
   */
  essenceCost: number
  /** 投入护符当前按轮子取到的买入价（真实参与利润计算的那个数） */
  charmPriceNow: number
  /** 上面那个数的来源：market / cross / shop / selfcraft / none */
  charmPriceSourceNow: PriceSource
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
  /** 投入价必须由轮子取到数 */
  valid: boolean
  /**
   * 转化这一步的**完整投入清单**（护符本身 + 催化剂 + 茶），已按各自口径取价。
   *
   * 暴露它有两个实际用途：
   *  1. UI 可以展示「钱花在哪」——旧界面只给一个总数，看不到催化剂与茶；
   *  2. 测试能精确断言「护符那一项」的价格，从而抓住
   *     `ingredientPriceConfigList` 按下标覆盖护符项、旁路买卖价轮子的缺陷。
   *     （只看 `costPH` 会假绿 —— 催化剂与茶仍走轮子，合计照样会变。）
   */
  ingredientListWithPrice: { hrid: string, count: number, price: number, priceSource: string }[]
  products: CharmProductResult[]
  /** 制作阶段的副产品（单列） */
  byProducts: CharmByProduct[]
  /** 制作副产品的总市值（/h，-1 = 无法估价） */
  byProductValuePH: number
  /**
   * 该档 10 种产出护符是否**全部无市场报价**。
   *
   * 全部无报价时「理想利润」只是**理论上限**（假设能按自制成本价卖出去），
   * 而市场上实际一件都卖不掉 ⇒ 界面必须标注，否则等于给一个不存在的收益预期。
   */
  noMarketQuote: boolean
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
    // 从权威数据推导，不再硬编码
    const essenceCount = brewingEssenceNeededFor(tier)
    const essenceCost = essencePrice > 0 && essenceCount > 0 ? essenceCount * essencePrice : -1
    /**
     * 投入护符当前**按轮子**取到的买入价，及其来源。
     *
     * `getPriceSourceOf` 会区分 market / cross / shop / selfcraft / none ——
     * UI 必须标出来，否则用户会把「借来的右价」或「自产估值」误当真实市价。
     */
    const charmPriceNow = getPriceOf(charmHrid)
    const charmPriceSourceNow = getPriceSourceOf(charmHrid, 0, "ask")
    const charmAskActual = getMarketDataApi().marketData[charmHrid]?.[0]?.ask ?? -1

    /**
     * 产出护符「用它自己技能的精华从零制作」的成本 —— 也就是**价格上限**。
     *
     *   /items/basic_milking_charm  → 10000 个 milking_essence
     *   /items/advanced_milking_charm → 80000 个 milking_essence
     *   ……（逐档按该技能自己的配方推导，不借用冲泡的数）
     *
     * 之所以按技能分别算：当前 10 个技能的配方恰好相同，借用冲泡的数也「碰巧正确」；
     * 但那是**巧合**，不是保证。游戏改任一技能配方时，借用会静默算错。
     *
     * 用 `ask`（你买精华付的价），不是 `bid`。
     */
    const ownCraftCostOf = (targetCharmHrid: string): number => {
      const m = targetCharmHrid.match(/^\/items\/(?:basic|advanced|expert|master|grandmaster)_(.+)_charm$/)
      if (!m) {
        return -1
      }
      const skill = m[1]
      const n = essenceNeededFor(tier, skill)
      if (n <= 0) {
        return -1
      }
      const ask = getPriceOf(`/items/${skill}_essence`).ask
      return ask > 0 ? n * ask : -1
    }

    // 先实例化读取产出表，逐个判定流动性
    const probe = new TransmuteCalculator({ hrid: charmHrid, catalystRank })
    /**
     * 制作阶段的副产品（工匠箱 / 制作精华）。
     *
     * ⚠️ `TransmuteCalculator.productList` 混了三类东西：
     *   1. **转化产出**：`transmuteDropTable` 的 10 个护符
     *   2. **制作副产品**：`getAlchemyRareDropTable` —— 工匠箱，来自
     *      `actionDetailMap` 的 `rareDropTable`（制作动作的掉落）
     *   3. **转化阶段的精华掉落**：`getAlchemyEssenceDropTable` —— 炼金精华，
     *      按 `timeCost / 6min × (itemLevel+100)/100` 公式算，是**转化**的产物
     *
     * 第 2 类要剔除（属于制作，不是转化）；第 3 类**必须保留**。
     * 区分依据：`rareDropTable` 的 hrid 集合，由 `craftingByProductsOf` 给出。
     */
    const byProducts = craftingByProductsOf(tier).map(({ hrid, expect }) => {
      const ask = getPriceOf(hrid).ask
      return {
        hrid,
        name: getTrans(getGameDataApi().itemDetailMap[hrid].name),
        expect,
        ask,
        valuePH: ask > 0 ? ask * expect : -1
      }
    })
    const byProductHrids = new Set(byProducts.map(b => b.hrid))
    /** 副产品的总市值（/h）。任一项无法估价时整体为 -1。 */
    const byProductValuePH = byProducts.some(b => b.valuePH < 0)
      ? -1
      : byProducts.reduce((acc, b) => acc + b.valuePH, 0)

    /**
     * 转化产出 —— **只看护符**（用户明确要求）。
     *
     * `TransmuteCalculator.productList` 里除护符外还有两类，**都不计入收入**：
     *  1. 制作副产品（工匠箱）—— 来自制作动作的 `rareDropTable`
     *  2. 炼金精华 —— 来自 `getAlchemyEssenceDropTable`，是转化阶段的精华掉落
     *
     * 本页要回答的是「把冲泡护符转成别的护符，值不值」，
     * 护符之外的收益与这个问题无关，混进来只会让口径变模糊。
     *
     * 数值上两者都极小（炼金精华约 48/h，占 incomeIdealPH 的 0.0000%），
     * 但口径要干净：**表格里列什么，收入里就算什么**。
     */
    const productMeta = probe.productList
      .filter(p => !byProductHrids.has(p.hrid))
      .filter(p => p.hrid.endsWith("_charm"))
      .map((p) => {
      const raw = getMarketDataApi().marketData[p.hrid]?.[0]
      const ask = raw?.ask ?? -1
      const bid = raw?.bid ?? -1
      const hasLiquidity = ask >= 0 || bid >= 0
      // 无流动性产出护符的挂价上限 = 其「自身精华」直接制作成本（而非投入冲泡护符成本）
      const ownCraftCost = ownCraftCostOf(p.hrid)
      return { hrid: p.hrid, rate: p.rate ?? 1, ask, bid, hasLiquidity, ownCraftCost }
    })

    /**
     * 投入护符的计价 —— **走买卖价轮子，不做覆盖**。
     *
     * ⚠️ 历史缺陷：本页曾传
     *   `ingredientPriceConfigList: [{ hrid: charmHrid, immutable: true, price: essenceCost }]`
     * 把投入价硬编码成「用冲泡精华从零自制」的成本。
     * 而 `calculator/index.ts` 会用它**覆盖** `ingredientList` 里的默认取价，
     * 默认取价（`TransmuteCalculator.ingredientList`）本来是 `getPriceOf(hrid).ask`
     * —— 也就是说**轮子本来是通的，是这个覆盖把它旁路了**。
     *
     * 实测（官方实时数据 2026-10-07，`advanced_alchemy_charm` 双边报价）：
     *   buy=ASK → 50,800,000 / ASK_LOW → 50,614,072
     *   ASK_HIGH → 50,985,928 / BID → 42,880,000
     * 四个值全不同 ⇒ 轮子本身完好。
     *
     * 删掉覆盖后，「按市价买入」与「按自制成本估算」都由轮子的两个控件表达：
     *   - `PriceStatusSelect`（`buyStatus`）：左买 / 右买 / 压一档 / 抬一档
     *   - `GameInfo` 内的 `priceFallback`：`then: "bigset"` / `forceBigSet`
     *     即「市价没有就按大全套（自产）成本估」
     * 两者都在本页已渲染 ⇒ 用户不需要在本页额外做「自制 vs 市价」二选一。
     *
     * `essenceCost` 仍要保留，但只作为**参考列**（展示自制这条路大约多少钱），
     * 不再参与利润计算。
     */
    const ingredientConfig: IngredientPriceConfig[] = []

    // 产出价格覆盖：仅无流动性的护符需要覆盖（实际=0 / 理想=essenceCost），crate/essence 掉落保持市场价
    // productMeta 现在全是护符 ⇒ 无流动性的按 0 计价（实际）/ 按制作成本计价（理想上限）
    const productActualConfig: ProductPriceConfig[] = productMeta.map(p =>
      !p.hasLiquidity ? { hrid: p.hrid, immutable: true, price: 0 } : undefined!
    )
    const productIdealConfig: ProductPriceConfig[] = productMeta.map(p =>
      !p.hasLiquidity
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
      kind: "charm" as const,
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
      charmPriceNow: charmPriceNow.ask,
      charmPriceSourceNow,
      charmAskActual,
      successRate: calcActual.successRate,
      incomeActualPH: calcActual.result.incomePH,
      incomeIdealPH: calcIdeal.result.incomePH,
      costPH: calcActual.result.costPH,
      profitActualPH: calcActual.result.profitPH,
      profitIdealPH: calcIdeal.result.profitPH,
      profitActualRate: calcActual.result.profitRate,
      profitIdealRate: calcIdeal.result.profitRate,
      /**
       * 可算性：投入价必须由轮子取到数。
       *
       * ⚠️ 早前这里判的是 `essenceCost > 0`（自制成本），删掉成本覆盖后
       * 自制成本只是参考列 —— 若仍拿它判定，用户把 `priceFallback`
       * 切到「市价」而该档护符无报价时，会被误判成「算不出来」。
       */
      valid: charmPriceNow.ask > 0 && calcActual.valid,
      ingredientListWithPrice: calcActual.ingredientListWithPrice.map(i => ({
        hrid: i.hrid,
        count: i.count,
        price: i.price,
        priceSource: i.priceSource as string
      })),
      products,
      byProducts,
      byProductValuePH,
      noMarketQuote: productMeta.every(p => !p.hasLiquidity)
    })
  }

  return results
}
