import { DecomposeCalculator } from "@/calculator/alchemy"
import { EnhanceCalculator } from "@/calculator/enhance"
import { getStorageCalculatorItem } from "@/calculator/utils"
import { WorkflowCalculator } from "@/calculator/workflow"
import locales, { getTrans } from "@/locales"
import { useGameStoreOutside } from "@/pinia/stores/game"
import { getGameDataApi } from "../game"

import { getUsedPriceOf } from "../price"
import { handlePage, handlePush, handleSearch, handleSort } from "../utils"

const { t } = locales.global
/** 查 */
export async function getEnhanposerDataApi(params: any) {
  let profitList: WorkflowCalculator[] = []
  if (useGameStoreOutside().getEnhanposerCache()) {
    profitList = useGameStoreOutside().getEnhanposerCache()
  } else {
    await new Promise(resolve => setTimeout(resolve, 300))
    const startTime = Date.now()
    try {
      profitList = profitList.concat(calcEnhanceProfit({ noDecompose: params.noDecompose, priceType: params.priceType }))
    } catch (e: any) {
      console.error(e)
    }
    useGameStoreOutside().setEnhanposerCache(profitList)
    ElMessage.success(t("计算完成，耗时{0}秒", [(Date.now() - startTime) / 1000]))
  }

  console.log("params", params)
  profitList = profitList.filter(item => params.maxLevel ? (item.calculator as DecomposeCalculator).enhanceLevel <= params.maxLevel : true)
  profitList = profitList.filter(item => params.minLevel ? (item.calculator as DecomposeCalculator).enhanceLevel >= params.minLevel : true)

  // 多元组合条件：目标强化等级并行（OR），命中任一等级即保留
  // 强化分解方案 project 形如「强化分解+N」，无步数语义，故 conditions.steps 映射为目标强化等级
  const conditions = Array.isArray(params.conditions)
    ? params.conditions.filter((c: any) => c && c.steps != null && c.steps !== "")
    : []
  if (conditions.length) {
    profitList = profitList.filter(item => {
      const enhanceLevel = (item.calculator as DecomposeCalculator).enhanceLevel
      return conditions.some((cond: any) => enhanceLevel === cond.steps)
    })
  }
  // 剔除 conditions 后再走通用 handleSearch，避免其「步数」正则对本页数据误伤
  const searchParams = { ...params }
  delete searchParams.conditions
  return handlePage(handleSort(handleSearch(profitList, searchParams), searchParams), params)
}

function calcEnhanceProfit(options: { noDecompose?: boolean; priceType?: "ask" | "bid" } = {}) {
  const { noDecompose = false, priceType = "bid" } = options
  const gameData = getGameDataApi()
  // 所有物品列表
  const list = Object.values(gameData.itemDetailMap)
  const profitList: WorkflowCalculator[] = []
  list.filter(item => item.enhancementCosts).forEach((item) => {
    if (getUsedPriceOf(item.hrid, 0, "ask") === -1) {
      return
    }
    for (let enhanceLevel = 1; enhanceLevel <= 20; enhanceLevel++) {
      if (getUsedPriceOf(item.hrid, 0, "ask") === -1) {
        continue
      }

      let bestProfit = -Infinity
      let bestCal: WorkflowCalculator | undefined
      for (let protectLevel = (enhanceLevel > 2 ? 2 : enhanceLevel); protectLevel <= enhanceLevel; protectLevel++) {
        const enhancer = new EnhanceCalculator({ enhanceLevel, protectLevel, hrid: item.hrid, productPriceType: priceType })
        for (let catalystRank = 0; catalystRank <= 2; catalystRank++) {
          if (!useGameStoreOutside().checkSecret() && item.itemLevel > 1) {
            continue
          }

          // protectLevel = enhanceLevel 时表示不用垫子
          const steps = [getStorageCalculatorItem(enhancer)]
          if (!noDecompose) {
            const decomposer = new DecomposeCalculator({ enhanceLevel, hrid: item.hrid, catalystRank })
            if (!decomposer.available) {
              continue
            }
            steps.push(getStorageCalculatorItem(decomposer))
          }

          const c = new WorkflowCalculator(steps, `${getTrans("强化分解")}+${enhanceLevel}`)

          c.run()

          if (c.result.profitPH > bestProfit) {
            bestProfit = c.result.profitPH
            bestCal = c
          }
        }
      }
      bestCal && handlePush(profitList, bestCal)
    }
  })
  return profitList
}
