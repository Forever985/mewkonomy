import * as Format from "@@/utils/format"
import { EnhanceCalculator } from "@/calculator/enhance"
import locales from "@/locales"
import { useGameStoreOutside } from "@/pinia/stores/game"
import { getGameDataApi } from "../game"

import { getUsedPriceOf } from "../price"
import { handleConditions, handlePage, handlePush, handleSearch, handleSort, parseSortRules } from "../utils"

const { t } = locales.global

/** 计算模式签名：任一价格口径变化都必须重算（缓存按签名校验，不匹配即视为未命中） */
function modeSignatureOf(mode: { materialPriceType?: string; productPriceType?: string }) {
  return [`mat=${mode.materialPriceType ?? "ask"}`, `prod=${mode.productPriceType ?? "bid"}`].join("|")
}

/**
 * 本页在 `Calculator.result` 上追加的「练级性价比」字段
 *
 * 选择挂在 `result` 而不是实例顶层：`handleSort` 支持 `result.xxx` 点路径，
 * 而 `handleSearch` / `handlePage` / `handlePush` 都按 Calculator 处理，无需为此新增抽象。
 */
export interface EnhanceExpResult {
  enhanceLevel: number
  protectLevel: number
  actionLevel: number
  /** 强化到目标等级的期望动作次数（整批口径） */
  actions: number
  /** 其中需要消耗保护道具的次数 */
  protects: number
  /** 整批获得的总经验 = actions × 单次经验（单次经验已含经验 buff） */
  exp: number
  /** 整批材料总成本（含本体与保护道具） */
  totalCost: number
  /** 整批强化成品的售价（含逃逸体与稀有/精华掉落） */
  saleValue: number
  /** 净成本 = totalCost - saleValue；为负表示「强化完卖掉反而赚钱」 */
  netCost: number
  /** 核心指标：每次经验成本 = netCost / exp，越小越好，赚钱时为负 */
  costPerExp: number
  /** 每次经验成本的倒数 = exp / netCost；赚钱（净成本 <= 0）时为 +∞ */
  expPerCost: number
  profitable: boolean
  /**
   * `profitable` 的数值化排序键（赚钱 = 1，纯消耗 = 0）
   *
   * `handleSort` 的 `compareValues` 对布尔值判定为「缺失」，直接用 `result.profitable` 排序是空操作，
   * 因此单独挂一个数值字段供「排序优先级」使用。
   */
  profitableRank: number
  totalCostFormat: string
  saleValueFormat: string
  netCostFormat: string
  costPerExpFormat: string
}

/** 查 */
export async function getEnhanceExpDataApi(params: any) {
  const options = {
    materialPriceType: params.materialPriceType,
    productPriceType: params.productPriceType
  }
  const signature = modeSignatureOf(options)
  const store = useGameStoreOutside()
  let planList: EnhanceCalculator[] = store.getModeCache<EnhanceCalculator>("enhanceexp", signature) ?? []
  if (!planList.length) {
    await new Promise(resolve => setTimeout(resolve, 300))
    const startTime = Date.now()
    try {
      planList = calcEnhanceExp(options)
    } catch (e: any) {
      console.error(e)
    }
    store.setModeCache("enhanceexp", signature, planList)
    ElMessage.success(t("计算完成，耗时{0}秒", [(Date.now() - startTime) / 1000]))
  }

  // 多行组合条件：目标强化等级并行（行间 OR、行内 AND）
  // 本页没有「N步」语义，steps 映射为目标等级相等匹配，min/maxLevel 为等级区间
  planList = handleConditions(planList, params, item => item.enhanceLevel)
  // 剔除 conditions 后再走通用 handleSearch，避免其「步数」正则对本页数据误伤
  const searchParams = { ...params }
  delete searchParams.conditions

  // 本页专用筛选：经验性价比与「利润率」不是一回事，独立成字段自行过滤，不硬塞进 handleSearch
  if (params.onlyProfitable) {
    planList = planList.filter(item => item.result.profitable)
  }
  if (params.minExp != null && params.minExp !== "") {
    planList = planList.filter(item => item.result.exp >= params.minExp)
  }
  if (params.maxCostPerExp != null && params.maxCostPerExp !== "") {
    planList = planList.filter(item => item.result.costPerExp <= params.maxCostPerExp)
  }

  // 默认排序：每次经验成本升序 —— 净成本为负的「赚钱」方案自然排在最前面
  // 用户一旦显式配置了排序优先级，就完全交给 handleSort（含表头点击并入的规则）
  const sortParams = parseSortRules(params).length
    ? params
    : { ...params, sortRules: [{ prop: "result.costPerExp", order: "ascending" }] }

  return handlePage(handleSort(handleSearch(planList, searchParams), sortParams), params)
}

/**
 * 构造「装备 × 目标强化等级」的全部练级方案
 *
 * 每个目标等级下，protectLevel 从 `enhanceLevel > 2 ? 2 : enhanceLevel` 逐档试到 `enhanceLevel`
 * （`protectLevel === enhanceLevel` 即不用垫子），取「单位经验净成本最低」的一档作为该等级的方案。
 */
function calcEnhanceExp(options: { materialPriceType?: "ask" | "bid"; productPriceType?: "ask" | "bid" } = {}) {
  const { materialPriceType = "ask", productPriceType = "bid" } = options
  const gameData = getGameDataApi()
  const planList: EnhanceCalculator[] = []
  Object.values(gameData.itemDetailMap).filter(item => item.enhancementCosts).forEach((item) => {
    // 可行性门槛：0 级本体买不到价（-1）时整条方案无从谈起（与强化分解页 calcEnhanceProfit 一致）
    if (getUsedPriceOf(item.hrid, 0, "ask") === -1) {
      return
    }
    for (let enhanceLevel = 1; enhanceLevel <= 20; enhanceLevel++) {
      let bestCal: EnhanceCalculator | undefined
      let bestCostPerExp = Number.POSITIVE_INFINITY
      for (let protectLevel = (enhanceLevel > 2 ? 2 : enhanceLevel); protectLevel <= enhanceLevel; protectLevel++) {
        const cal = new EnhanceCalculator({ enhanceLevel, protectLevel, hrid: item.hrid, materialPriceType, productPriceType })
        if (!cal.available) {
          continue
        }
        cal.run()
        const { costPerExp } = attachEnhanceExpResult(cal)
        if (!bestCal || costPerExp < bestCostPerExp) {
          bestCal = cal
          bestCostPerExp = costPerExp
        }
      }
      bestCal && handlePush(planList, bestCal)
    }
  })
  return planList
}

/**
 * 把「练级性价比」字段挂到 `calc.result` 上
 */
function attachEnhanceExpResult(cal: EnhanceCalculator): EnhanceExpResult {
  const { actions, protects } = cal.enhancelate()
  // `EnhanceCalculator.exp` 是单次强化经验（内部已除以 actions，并含经验 buff）
  const exp = actions * cal.exp
  // 整批总成本：本体 count = 1/actions、保护道具 count = protects/actions，
  // 乘 actions 后恰好还原为「一件本体 + protects 个垫子 + 整批强化材料」的口径
  const totalCost = cal.ingredientListWithPrice.reduce((acc, item) => acc + item.count * item.price, 0) * actions
  // 整批成品售价：同理，productListWithPrice 的 count 已含 1/actions 比例，乘 actions 还原为「一件成品」口径
  const saleValue = cal.productListWithPrice.reduce((acc, item) => acc + item.count * item.price * (item.rate || 1), 0) * actions
  const netCost = totalCost - saleValue
  const profitable = netCost <= 0
  const costPerExp = exp > 0 ? netCost / exp : Number.POSITIVE_INFINITY
  const result: EnhanceExpResult = {
    enhanceLevel: cal.enhanceLevel,
    protectLevel: cal.protectLevel,
    actionLevel: cal.actionLevel,
    actions,
    protects,
    exp,
    totalCost,
    saleValue,
    netCost,
    costPerExp,
    // 净成本 <= 0：强化完卖掉反而赚钱，经验白拿，性价比无穷大
    expPerCost: profitable ? Number.POSITIVE_INFINITY : exp / netCost,
    profitable,
    profitableRank: profitable ? 1 : 0,
    totalCostFormat: Format.money(totalCost),
    saleValueFormat: Format.money(saleValue),
    netCostFormat: Format.money(netCost),
    costPerExpFormat: Format.money(costPerExp)
  }
  Object.assign(cal.result, result)
  return result
}
