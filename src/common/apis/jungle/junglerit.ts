import type { Action } from "~/game"
import { EnhanceCalculator } from "@/calculator/enhance"

import { ManufactureCalculator } from "@/calculator/manufacture"
import { getStorageCalculatorItem } from "@/calculator/utils"
import { WorkflowCalculator } from "@/calculator/workflow"
import { getEquipmentTypeOf, isRefined } from "@/common/utils/game"
import locales, { getTrans } from "@/locales"
import { useGameStoreOutside } from "@/pinia/stores/game"
import { getGameDataApi } from "../game"
import { getUsedPriceOf } from "../price"
import { handleConditions, handlePage, handlePush, handleSearch, handleSort } from "../utils"

const { t } = locales.global
/** 查 */
export async function getDataApi(params: any) {
  // noEscape 属于「计算模式」：必须参与缓存签名，否则勾选/取消后仍会命中按旧模式算出的结果
  const signature = params.noEscape ? "noEscape" : "escape"
  const store = useGameStoreOutside()
  let profitList: WorkflowCalculator[] = store.getModeCache<WorkflowCalculator>("junglerit", signature) ?? []
  if (!profitList.length) {
    await new Promise(resolve => setTimeout(resolve, 300))
    const startTime = Date.now()
    try {
      profitList = profitList.concat(calcEnhanceProfit(params))
    } catch (e: any) {
      console.error(e)
    }
    store.setModeCache("junglerit", signature, profitList)
    ElMessage.success(t("计算完成，耗时{0}秒", [(Date.now() - startTime) / 1000]))
  }

  profitList = profitList.filter(item => params.maxLevel ? item.calculator.enhanceLevel <= params.maxLevel : true)
  profitList = profitList.filter(item => params.minLevel ? item.calculator.enhanceLevel >= params.minLevel : true)

  // 组合条件（目标强化等级/动作，行间 OR、行内 AND）；先处理再剔除，避免 handleSearch 的步数正则误伤
  profitList = handleConditions(profitList, params, item => item.calculator.enhanceLevel)
  const searchParams = { ...params }
  delete searchParams.conditions
  return handlePage(handleSort(handleSearch(profitList, searchParams), searchParams), params)
}

function calcEnhanceProfit(params: any) {
  const gameData = getGameDataApi()
  // 所有物品列表
  const list = Object.values(gameData.itemDetailMap)
  const profitList: WorkflowCalculator[] = []
  let escapeLevels = Array.from({ length: 20 }, (_, i) => i)
  if (params.noEscape) {
    escapeLevels = [-1]
  }
  list.filter(item => item.enhancementCosts)
    .filter(item => !isRefined(item))
    .filter(item => getEquipmentTypeOf(item) === "charm" || item.itemLevel >= 90)
    .forEach((item) => {
      for (let inheritOrgLvl = 1; inheritOrgLvl <= 20; inheritOrgLvl++) {
        const projects: [string, Action][] = [
          [getTrans("锻造"), "cheesesmithing"],
          [getTrans("制造"), "crafting"],
          [getTrans("裁缝"), "tailoring"]
        ]
        for (const [project, action] of projects) {
          const mc = new ManufactureCalculator({ hrid: item.hrid, project, action, originLevel: inheritOrgLvl })
          const actionItem = mc.actionItem
          if (!actionItem?.upgradeItemHrid) {
            continue
          }
          if (getUsedPriceOf(actionItem.upgradeItemHrid, inheritOrgLvl, "ask") === -1) {
            continue
          }

          const originLevel = Math.floor(mc.targetLevel)

          for (let enhanceLevel = originLevel + 1; enhanceLevel <= 20; ++enhanceLevel) {
            if (getUsedPriceOf(item.hrid, enhanceLevel, "bid") === -1) {
              continue
            }

            let bestProfit = -Infinity
            let bestCal: WorkflowCalculator | undefined

            for (const escapeLevel of escapeLevels) {
              if (originLevel >= enhanceLevel || escapeLevel >= originLevel) {
                continue
              }
              for (let protectLevel = Math.max(2, escapeLevel + 1); protectLevel <= enhanceLevel; protectLevel++) {
                const ec = new EnhanceCalculator({ originLevel, enhanceLevel, protectLevel, hrid: item.hrid, escapeLevel })
                let ecUp: EnhanceCalculator | undefined
                if (!ec.available) {
                  continue
                }
                if (mc.targetLevel % 1 > 0) {
                  ecUp = new EnhanceCalculator({ originLevel: originLevel + 1, enhanceLevel, protectLevel, hrid: item.hrid, escapeLevel })
                  if (originLevel + 1 === enhanceLevel) {
                    ecUp = undefined
                  } else if (!ecUp.available) {
                    continue
                  }
                }
                const c = new WorkflowCalculator([
                  getStorageCalculatorItem(mc),
                  ecUp
                    ? [getStorageCalculatorItem(ec), getStorageCalculatorItem(ecUp)]
                    : getStorageCalculatorItem(ec)
                ], `${project}+${inheritOrgLvl} ${getTrans("强化")}+${enhanceLevel}`)

                c.run()

                if (c.result.profitPH > bestProfit) {
                  bestProfit = c.result.profitPH
                  bestCal = c
                }
              }
            }
            // 只取最优的保护情况
            bestCal && handlePush(profitList, bestCal)
          }
        }
      }
    })
  return profitList
}
