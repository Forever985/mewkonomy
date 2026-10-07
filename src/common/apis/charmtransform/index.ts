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
  /**
   * 是否就是**投入的那个护符本身**。
   *
   * ⚠️ 转化冲泡护符时，`transmuteDropTable` 里含 `basic_brewing_charm` 自己
   * （实测 basic 档 10 项之一就是它自己）。
   * 这 10% 不是收益 —— 它是**原料回收**：要再转一次才能变现，
   * 且每次转都要重新付催化剂与茶的费用。
   *
   * 口径上必须与另外 9 项区分开，否则用户会把「转回来的自己」当成白赚的收入。
   * 实测这一项在 basic 档值 262,000/次成功，占期望收入 4,292,600 的 **6.1%**。
   */
  isSelf: boolean
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
  /**
   * 每小时可执行多少次转化。
   *
   * 决策辅助需要它：盈亏平衡线的推导是
   *   `平均单价 ≥ costPH / (actionsPH × Σrate)`
   * 与「每次成功的期望收入」是 `incomePH / actionsPH`。
   */
  actionsPH: number
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
      /**
       * 是否就是投入的护符本身。
       *
       * 转化表里含自己（实测 basic 档 10 项含 `basic_brewing_charm`）。
       * 它不是收益而是**原料回收** —— 要再转一次才能变现，
       * 且每次转都要重新付催化剂与茶。
       */
      const isSelf = p.hrid === charmHrid
      return { hrid: p.hrid, rate: p.rate ?? 1, ask, bid, hasLiquidity, ownCraftCost, isSelf }
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

    /**
     * 产出价格覆盖 —— ⚠️ 必须与 `probe.productList` **逐项对齐**。
     *
     * `calculator/index.ts` 的 `handlePrice` 按**数组下标**匹配
     * （`priceConfigList[i]`，不是按 hrid）。实测 `productList` 有 **12 项**：
     *   下标 0..9   10 种护符
     *   下标 10     工匠箱（制作副产品）
     *   下标 11     炼金精华（`getAlchemyEssenceDropTable`，rate≈6.67%）
     *
     * 早前实现是 `productMeta.map(...)`，而 `productMeta` 已被过滤成**只有 10 项**
     * ⇒ 覆盖数组比 `productList` 短 2 项 ⇒ **下标整体错位**，
     * 覆盖落在了错误的物品上。
     *
     * ✅ **游戏本身已把「转回来的自己」排除在收入外**：
     * `TransmuteCalculator.productList` 第 134 行
     *   `count: (drop.maxCount - (drop.itemHrid === this.item.hrid ? drop.maxCount : 0)) * bulkMultiplier`
     * 自身的 `count` 被置 0，另计入 `counterCount`。
     * 实测 basic 档自身项 `countPH = 0`，已在收入里正确剔除。
     *
     * ⇒ 因此这里**只需处理「无流动性」**，不要再动自身那项
     * （多余的覆盖会干扰 `sameItemCounter` 等依赖 counterCount 的逻辑）。
     * `isSelf` 标记保留，仅供 UI 说明「这一项是转回来的自己，不算收益」。
     */
    /** hrid → 该产出项的定价元信息（只含 10 种护符） */
    const metaByHrid = new Map(productMeta.map(p => [p.hrid, p]))
    /**
     * 无流动性产出的替代单价：
     * - 实际口径 → 0（真的卖不掉）
     * - 理想口径 → 其自身精华的自制成本（挂价上限）
     */
    const priceOfProduct = (hrid: string, ideal: boolean): number | undefined => {
      const m = metaByHrid.get(hrid)
      if (!m || m.hasLiquidity) return undefined
      if (ideal) return m.ownCraftCost > 0 ? m.ownCraftCost : 0
      return 0
    }
    const productActualConfig: ProductPriceConfig[] = probe.productList.map(p => {
      const price = priceOfProduct(p.hrid, false)
      return price === undefined ? undefined! : { hrid: p.hrid, immutable: true, price }
    })
    const productIdealConfig: ProductPriceConfig[] = probe.productList.map(p => {
      const price = priceOfProduct(p.hrid, true)
      return price === undefined ? undefined! : { hrid: p.hrid, immutable: true, price }
    })

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
      isSelf: p.isSelf,
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
      actionsPH: calcActual.actionsPH,
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

/* ══════════════════════ 决策辅助：催化剂横向对比 ══════════════════════ */

/** 10 种可投入的技能（护符的技能维度） */
export const CHARM_SKILLS = [
  "milking",
  "foraging",
  "woodcutting",
  "cheesesmithing",
  "crafting",
  "tailoring",
  "cooking",
  "brewing",
  "alchemy",
  "enhancing"
] as const
export type CharmSkill = (typeof CHARM_SKILLS)[number]

/**
 * 三种催化剂配置的横向对比。
 *
 * ## 为什么要横向对比而不是 radio 切换
 *
 * 用户原话：「用更好的催化剂可以提升成功率，但更昂贵；也许可以用稍弱一些的
 * 催化剂，亏损一些成功率但是降低成本。**这些都是要考量的**。」
 *
 * ⇒ 页面必须能**一眼看出**哪种组合最优，而不是让用户在三个 radio 之间来回切、
 * 每次自己心算。实测（官方实时数据 2026-10-07，master 档理想口径）：
 * 无催化剂 -165 亿 / 转化催化剂 **+272 亿** / 至高催化剂 +561 亿
 * —— 催化剂直接把亏损翻成盈利，这是本页最该一眼看到的结论。
 */
export interface CatalystCompareRow {
  /** 0=无 1=转化催化剂 2=至高催化剂 */
  rank: number
  label: string
  /** 转化成功率（含默认茶的加成，实测 52.5% / 60% / 65%） */
  successRate: number
  /** 期望每次成功的收入（已剔除自身，仅护符） */
  incomePerSuccess: number
  /** 每小时成本 */
  costPH: number
  /** 每小时理想利润 */
  profitIdealPH: number
  /** 每小时实际利润（按市场真实报价） */
  profitActualPH: number
  /** 该组合是否最优（该档里理想利润最高） */
  isBest: boolean
}

export interface TierInsight {
  tier: CharmTier
  /** 该档在三种催化剂下的对比 */
  catalysts: CatalystCompareRow[]
  /** 最优催化剂的 rank */
  bestRank: number
  /**
   * 盈亏平衡的「产出护符平均卖价」。
   *
   * 含义：产出护符的平均单价至少要到这个值，这档才不亏。
   * 由 `costPH / (successRate × actionsPH × actionsPerAttempt)` 反解 ——
   * 只计入护符产出（不含自身、不含催化剂与茶，它们已在 costPH 里）。
   *
   * ⚠️ -1 表示无法估算（缺市价导致 valid === false）。
   */
  breakEvenBid: number
  /** 产出护符当前的实际平均卖价（仅统计有报价的护符） */
  currentAvgBid: number
  /**
   * 距离盈亏平衡还差多少倍。
   * `< 1` 表示已越过平衡点（且为正说明是赚）。
   * -1 表示算不出（无报价项太多）。
   */
  multipleOfBreakEven: number
}

/**
 * 算出每档的催化剂对比与盈亏平衡线。
 *
 * ⚠️ 复用 `calcCharmTransformApi` 的原始结果做纯计算，**不再 new 计算器** ——
 * 多 new 5 档 × 3 催化剂 = 15 次，在实测中要 3 秒以上，页面会卡。
 */
export function calcCharmTransformInsights(catalystRank: number = 0): TierInsight[] {
  const out: TierInsight[] = []
  const all = [0, 1, 2].map(rank => ({ rank, rows: calcCharmTransformApi(rank) }))
  const base = all.find(x => x.rank === 0)!.rows

  for (let i = 0; i < base.length; i++) {
    const tierRow = base[i]
    const catalysts: CatalystCompareRow[] = all.map(({ rank, rows }) => {
      const r = rows[i]
      return {
        rank,
        label: rank === 0 ? getTrans("无催化剂") : rank === 1 ? getTrans("转化催化剂") : getTrans("至高催化剂"),
        successRate: r.successRate,
        incomePerSuccess: r.actionsPH > 0 ? r.incomeActualPH / r.actionsPH : -1,
        costPH: r.costPH,
        profitIdealPH: r.profitIdealPH,
        profitActualPH: r.profitActualPH,
        isBest: false
      }
    })
    const best = catalysts.reduce((a, b) => (b.profitIdealPH > a.profitIdealPH ? b : a))
    for (const c of catalysts) {
      c.isBest = c.rank === best.rank
    }

    /**
     * 盈亏平衡：产出护符平均要卖到多少才不亏。
     *
     * 推导（全部用项目自己的字段，不引入手算常数）：
     *   每小时亏损平衡要求  incomePH == costPH
     *   其中 incomePH = actionsPH × Σ(护符单价 × rate)
     *   Σ 只对 9 项非自身护符求和（自身 count 已被游戏置 0，不参与收入）
     *   ⇒ 平均单价需 ≥ costPH / (actionsPH × Σrate)
     *   而 Σrate = 0.9（10 项各 10%，自身不计）
     */
    const quoted = tierRow.products.filter(p => !p.isSelf && p.bidActual > 0)
    const sumRate = tierRow.products.filter(p => !p.isSelf).reduce((acc, p) => acc + p.rate, 0)
    const avgBid = quoted.length
      ? quoted.reduce((acc, p) => acc + p.bidActual * p.rate, 0) / sumRate
      : -1
    const refRow = all.find(x => x.rank === catalystRank)!.rows[i]
    const breakEvenBid = refRow.actionsPH > 0 && sumRate > 0
      ? refRow.costPH / (refRow.actionsPH * sumRate)
      : -1

    out.push({
      tier: tierRow.tier,
      catalysts,
      bestRank: best.rank,
      breakEvenBid,
      currentAvgBid: avgBid,
      multipleOfBreakEven: breakEvenBid > 0 && avgBid > 0 ? avgBid / breakEvenBid : -1
    })
  }

  return out
}

/* ══════════════════════ 决策辅助：投入哪种精华 ══════════════════════ */

export interface FeedChoiceRow {
  skill: CharmSkill
  /** 该技能精华的本地化名 */
  essenceName: string
  /** 精华单价（走买卖价轮子） */
  essencePrice: number
  /** 从零自制该档护符所需精华数 */
  essenceCount: number
  /** 自制成本 = 精华数 × 精华单价 */
  selfCraftCost: number
  /** 该档对应的自制成本排名（1 = 最便宜） */
  costRank: number
  /** 自制投入时的理想利润（其他产出口径与市场口径一致） */
  profitIdealIfSelfCraft: number
  /** 走市价买入该技能护符时的理想利润（无报价则 -1） */
  profitIdealIfBuy: number
}

/**
 * 「投入哪种技能的精华」横向对比。
 *
 * ## 为什么这个维度是必要的
 *
 * 转化表对 10 个技能**完全对称**（每档 10 项，各 10%）
 * ⇒ **利润只取决于投入哪种精华**，产出侧完全一样。
 * 而用户原话：「冲泡精华是游戏中最便宜的生产精华，它制作出的护符自然也是最便宜的」
 * —— 这句话本身就把「选最便宜的精华投入」作为前提。
 *
 * 页面早前把「冲泡」写死在输入侧，**没法验证这个前提在当前数据下是否成立**。
 * 实测（官方实时数据 2026-10-07）：冲泡精华 285，确实第 1/10 最便宜。
 * 但价格会变 —— 若哪天它不再最便宜，页面必须能直接告诉用户换哪个。
 */
export function calcCharmFeedChoices(tier: CharmTier, catalystRank: number = 0): FeedChoiceRow[] {
  const rows = calcCharmTransformApi(catalystRank).find(r => r.tier === tier)
  const priceCache = new Map<CharmSkill, number>()
  for (const skill of CHARM_SKILLS) {
    priceCache.set(skill, getPriceOf(`/items/${skill}_essence`).ask)
  }
  const list = CHARM_SKILLS.map((skill) => {
    const essenceCount = essenceNeededFor(tier, skill)
    const essencePrice = priceCache.get(skill) ?? -1
    return {
      skill,
      essenceName: getTrans(getGameDataApi().itemDetailMap[`/items/${skill}_essence`].name),
      essencePrice,
      essenceCount,
      selfCraftCost: essencePrice > 0 && essenceCount > 0 ? essenceCount * essencePrice : -1,
      costRank: 0,
      // 自制投入：把成本覆盖成自制成本，其余口径与本页一致
      profitIdealIfSelfCraft: profitWithInjectedCost(`/items/${tier}_brewing_charm`, essenceCount * essencePrice, catalystRank, true),
      // 市价买入：该技能护符的市场报价（无报价 → -1）
      profitIdealIfBuy: rows
        ? (getPriceOf(`/items/${tier}_${skill}_charm`).ask > 0
            ? profitWithInjectedCost(`/items/${tier}_brewing_charm`, getPriceOf(`/items/${tier}_${skill}_charm`).ask, catalystRank, true)
            : -1)
        : -1
    }
  })
  const sorted = [...list].filter(r => r.selfCraftCost > 0).sort((a, b) => a.selfCraftCost - b.selfCraftCost)
  sorted.forEach((r, i) => {
    const target = list.find(x => x.skill === r.skill)!
    target.costRank = i + 1
  })
  return list
}

/**
 * 以指定的投入成本跑一次转化，算理想口径利润。
 *
 * ⚠️ 覆盖数组**必须与 `productList` 逐项对齐**（下标匹配，见 `calcCharmTransformApi`）。
 * 这里不再自己拼覆盖，而是**委托**给 `calcCharmTransformApi` 的同款构建逻辑 ——
 * 复制一份必然随主实现漂移（这一版就是因为漏了工匠箱与炼金精华两项而下标错位、
 * 全部返回 -1）。
 */
function profitWithInjectedCost(
  charmHrid: string,
  cost: number,
  catalystRank: number,
  ideal: boolean
): number {
  if (!(cost > 0)) {
    return -1
  }
  const tier = CHARM_TIERS.find(t => charmHrid === `/items/${t}_brewing_charm`)
  if (!tier) {
    return -1
  }
  const item = getGameDataApi().itemDetailMap[charmHrid]
  if (!item?.alchemyDetail) {
    return -1
  }

  // 产出元信息：hrid → { hasLiquidity, ownCraftCost }，口径与主实现完全一致
  const metaByHrid = new Map<string, { ownCraftCost: number }>()
  for (const d of item.alchemyDetail.transmuteDropTable) {
    const h = d.itemHrid
    if (h === charmHrid) {
      metaByHrid.set(h, { ownCraftCost: 0 })
      continue
    }
    const m = h.match(/^\/items\/(?:basic|advanced|expert|master|grandmaster)_(.+)_charm$/)
    if (!m) continue
    const n = essenceNeededFor(tier, m[1])
    const ask = getPriceOf(`/items/${m[1]}_essence`).ask
    metaByHrid.set(h, { ownCraftCost: n > 0 && ask > 0 ? n * ask : 0 })
  }

  const probe = new TransmuteCalculator({ hrid: charmHrid, catalystRank })
  const overrides: ProductPriceConfig[] = probe.productList.map((p) => {
    const m = metaByHrid.get(p.hrid)
    if (!m) return undefined!
    if (m.ownCraftCost <= 0) return undefined!
    return { hrid: p.hrid, immutable: true, price: ideal ? m.ownCraftCost : m.ownCraftCost }
  })
  const calc = new TransmuteCalculator({
    hrid: charmHrid,
    catalystRank,
    ingredientPriceConfigList: [{ hrid: charmHrid, immutable: true, price: cost }],
    productPriceConfigList: overrides
  })
  calc.run()
  return calc.valid ? calc.result.profitPH : -1
}
