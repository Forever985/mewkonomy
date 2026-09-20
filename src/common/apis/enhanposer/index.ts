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

/** 计算模式签名：任一模式/价格口径变化都必须重算（缓存按签名校验，不匹配即视为未命中） */
function modeSignatureOf(mode: { noDecompose?: boolean; materialPriceType?: string; productPriceType?: string }) {
  return [
    mode.noDecompose ? "noDecompose" : "decompose",
    `mat=${mode.materialPriceType ?? "ask"}`,
    `prod=${mode.productPriceType ?? "bid"}`
  ].join("|")
}

/** 查 */
export async function getEnhanposerDataApi(params: any) {
  const options = {
    noDecompose: params.noDecompose,
    materialPriceType: params.materialPriceType,
    productPriceType: params.productPriceType
  }
  const signature = modeSignatureOf(options)
  const store = useGameStoreOutside()
  let profitList: WorkflowCalculator[] = store.getModeCache<WorkflowCalculator>("enhanposer", signature) ?? []
  if (!profitList.length) {
    await new Promise(resolve => setTimeout(resolve, 300))
    const startTime = Date.now()
    try {
      profitList = profitList.concat(calcEnhanceProfit(options))
    } catch (e: any) {
      console.error(e)
    }
    store.setModeCache("enhanposer", signature, profitList)
    ElMessage.success(t("计算完成，耗时{0}秒", [(Date.now() - startTime) / 1000]))
  }

  return handlePage(handleSort(handleSearch(profitList, params), params), params)
}

function calcEnhanceProfit(options: { noDecompose?: boolean; materialPriceType?: "ask" | "bid"; productPriceType?: "ask" | "bid" } = {}) {
  const { noDecompose = false, materialPriceType = "ask", productPriceType = "bid" } = options
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
        const enhancer = new EnhanceCalculator({ enhanceLevel, protectLevel, hrid: item.hrid, materialPriceType, productPriceType })
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
