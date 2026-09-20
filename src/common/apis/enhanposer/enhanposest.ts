import { DecomposeCalculator } from "@/calculator/alchemy"
import { EnhanceCalculator } from "@/calculator/enhance"
import { getStorageCalculatorItem } from "@/calculator/utils"
import { WorkflowCalculator } from "@/calculator/workflow"
import locales, { getTrans } from "@/locales"
import { useGameStoreOutside } from "@/pinia/stores/game"
import { getGameDataApi } from "../game"

import { getUsedPriceOf } from "../price"
import { handleConditions, handlePage, handlePush, handleSearch, handleSort } from "../utils"

const { t } = locales.global

/** 计算模式签名：价格口径变化必须重算（缓存按签名校验，不匹配即视为未命中） */
function modeSignatureOf(mode: { materialPriceType?: string; productPriceType?: string }) {
  return [`mat=${mode.materialPriceType ?? "ask"}`, `prod=${mode.productPriceType ?? "bid"}`].join("|")
}

/** 查 */
export async function getEnhanposestDataApi(params: any) {
  const options = {
    materialPriceType: params.materialPriceType,
    productPriceType: params.productPriceType
  }
  const signature = modeSignatureOf(options)
  const store = useGameStoreOutside()
  let profitList: WorkflowCalculator[] = store.getModeCache<WorkflowCalculator>("enhanposest", signature) ?? []
  if (!profitList.length) {
    await new Promise(resolve => setTimeout(resolve, 300))
    const startTime = Date.now()
    try {
      profitList = profitList.concat(calcEnhanceProfit(options))
    } catch (e: any) {
      console.error(e)
    }
    store.setModeCache("enhanposest", signature, profitList)
    ElMessage.success(t("计算完成，耗时{0}秒", [(Date.now() - startTime) / 1000]))
  }

  profitList = profitList.filter(item => params.maxLevel ? (item.calculator as DecomposeCalculator).enhanceLevel <= params.maxLevel : true)
  profitList = profitList.filter(item => params.minLevel ? (item.calculator as DecomposeCalculator).enhanceLevel >= params.minLevel : true)

  // 多元组合条件：目标强化等级并行（OR），命中任一组合即保留
  // 强化分解方案无「N步」语义，steps 映射为目标强化等级相等匹配，min/maxLevel 为等级区间
  profitList = handleConditions(profitList, params, item => (item.calculator as DecomposeCalculator).enhanceLevel)
  // 剔除 conditions 后再走通用 handleSearch，避免其「步数」正则对本页数据误伤
  const searchParams = { ...params }
  delete searchParams.conditions
  return handlePage(handleSort(handleSearch(profitList, searchParams), searchParams), params)
}

function calcEnhanceProfit(options: { materialPriceType?: "ask" | "bid"; productPriceType?: "ask" | "bid" } = {}) {
  const { materialPriceType = "ask", productPriceType = "bid" } = options
  const gameData = getGameDataApi()
  // 所有物品列表
  const list = Object.values(gameData.itemDetailMap)
  const profitList: WorkflowCalculator[] = []
  const escapeLevels = [-1, 0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
  const originLevels = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
  // 注意：这里必须用不修改原数组的降序遍历。历史实现写成 `targetLevels.reverse()`，
  // 会在每个物品上原地翻转一次数组，导致相邻物品的等级遍历顺序来回颠倒（首级方案随机丢失）。
  const targetLevels = [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10]

  list.filter(item => item.enhancementCosts).forEach((item) => {
    for (const enhanceLevel of targetLevels) {
      let bestProfit = -Infinity
      let bestCal: WorkflowCalculator | undefined

      for (const originLevel of originLevels) {
        if (getUsedPriceOf(item.hrid, originLevel, "ask") === -1) {
          continue
        }
        for (const escapeLevel of escapeLevels) {
          if (originLevel >= enhanceLevel || escapeLevel >= originLevel) {
            continue
          }
          for (let protectLevel = (enhanceLevel > 2 ? 2 : enhanceLevel); protectLevel <= enhanceLevel; protectLevel++) {
            const enhancer = new EnhanceCalculator({ enhanceLevel, escapeLevel, originLevel, protectLevel, hrid: item.hrid, materialPriceType, productPriceType })
            // 仅保留可用方案；放开负利润过滤（功能3：负利润也写入结果）
            if (!enhancer.available) {
              continue
            }

            for (let catalystRank = 0; catalystRank <= 2; catalystRank++) {
              // protectLevel = enhanceLevel 时表示不用垫子
              const c = new WorkflowCalculator([
                getStorageCalculatorItem(enhancer),
                getStorageCalculatorItem(new DecomposeCalculator({ enhanceLevel, hrid: item.hrid, catalystRank }))
              ], `+${originLevel} ${getTrans("→")} +${enhanceLevel}`)

              c.run()

              if (c.result.profitPH > bestProfit) {
                bestProfit = c.result.profitPH
                bestCal = c
              }
            }
          }
        }
      }

      bestCal && handlePush(profitList, bestCal)
    }
  })
  return profitList
}
