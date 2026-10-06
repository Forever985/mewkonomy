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

/**
 * 本次要计算的**目标强化等级集合**（已排序去重）。
 *
 * 这是**计算参数**而不是事后筛选条件 —— 分解模式实测遍历 20 个等级要 **73.7 秒**，
 * 而只算 1 个等级 ≈ 3.7 秒。用户指定「+10」时只算 +10，节省 95%。
 *
 * 解析来源（按优先级）：
 *  1. `params.calcLevels` —— 显式传入（UI 上的「计算」按钮用）
 *  2. `params.conditions[].steps` —— 面板里填的单个目标等级
 *  3. `params.conditions[].minLevel/maxLevel` —— 区间
 *  4. 什么都没填 ⇒ 默认只算 **+1**（首次进页面最省；要全部等级需显式展开 1~20）
 */
function targetLevelsOf(params: any): number[] {
  const MAX = 20
  const clamp = (n: number) => Math.max(1, Math.min(MAX, Math.round(n)))
  const uniq = (arr: number[]) => [...new Set(arr)].sort((a, b) => a - b)

  // ① 显式传入
  if (Array.isArray(params?.calcLevels) && params.calcLevels.length) {
    return uniq(params.calcLevels.map(Number).filter(Number.isFinite).map(clamp))
  }

  const conds = Array.isArray(params?.conditions) ? params.conditions : []
  const picks: number[] = []
  let hasRange = false
  for (const c of conds) {
    if (!c) continue
    if (c.steps != null && c.steps !== "") {
      const n = Number(c.steps)
      if (Number.isFinite(n)) picks.push(clamp(n))
    }
    if (c.minLevel != null || c.maxLevel != null) {
      hasRange = true
      const lo = c.minLevel != null && c.minLevel !== "" ? clamp(Number(c.minLevel)) : 1
      const hi = c.maxLevel != null && c.maxLevel !== "" ? clamp(Number(c.maxLevel)) : MAX
      for (let n = Math.min(lo, hi); n <= Math.max(lo, hi); n++) picks.push(n)
    }
  }
  if (picks.length) return uniq(picks)
  // 区间条件写了但两端都空 ⇒ 视作不限制
  if (hasRange) return Array.from({ length: MAX }, (_, i) => i + 1)

  // ② 什么都没填 ⇒ 默认只算 +1（**不**默认 1~20，否则又会 73 秒）
  return [1]
}

/**
 * 计算模式签名：任一模式/价格口径/**目标等级集合**变化都必须重算。
 * 等级集合进签名 ⇒ 「只算 +10」与「算全部 1~20」是两份独立缓存，不会互相顶掉。
 */
function modeSignatureOf(mode: { noDecompose?: boolean; materialPriceType?: string; productPriceType?: string; levels?: number[] }) {
  return [
    mode.noDecompose ? "noDecompose" : "decompose",
    `mat=${mode.materialPriceType ?? "ask"}`,
    `prod=${mode.productPriceType ?? "bid"}`,
    `lv=${(mode.levels ?? [1]).join(",")}`
  ].join("|")
}

/** 查 */
export async function getEnhanposerDataApi(params: any) {
  const options = {
    noDecompose: params.noDecompose,
    materialPriceType: params.materialPriceType,
    productPriceType: params.productPriceType,
    // ★ 目标等级作为**计算参数**：只算用户要的档位，而不是全 20 档算完再筛
    levels: targetLevelsOf(params)
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
    ElMessage.success(
      t("计算完成：{0} 个目标等级，耗时{1}秒", [
        options.levels?.length ?? 1,
        (Date.now() - startTime) / 1000
      ])
    )
  }

  /**
   * 「只看目标等级」必须按 **`enhanceLevel`**（强化等级）匹配，**不是** `actionLevel`。
   *
   * ⚠️ 这里曾把 `conditions` 直接交给通用 `handleSearch`，而它的区间判定是
   * `cal.actionLevel`（见 `apis/utils.ts` 的 conditions 分支）——
   * 而本页 `actionLevel === item.itemLevel`（**物品等级**，实测 8700 行全部相同），
   * 于是「目标等级 5」变成去匹配「物品等级 5」，结果永远是 **0 行**。
   *
   * 正确做法与 `enhanposest` 一致：用 `handleConditions` 显式传入取值函数
   * （`item.calculator` 是 `EnhanceCalculator`，`enhanceLevel` 才是目标等级）。
   */
  profitList = handleConditions(profitList, params, (item: WorkflowCalculator) => {
    return (item.calculator as EnhanceCalculator).enhanceLevel
  })
  // conditions 已单独处理，从通用检索参数里剔除，避免其「步数」正则对本页数据误伤
  const searchParams = { ...params }
  delete searchParams.conditions

  return handlePage(handleSort(handleSearch(profitList, searchParams), searchParams), params)
}

function calcEnhanceProfit(options: { noDecompose?: boolean; materialPriceType?: "ask" | "bid"; productPriceType?: "ask" | "bid"; levels?: number[] } = {}) {
  const { noDecompose = false, materialPriceType = "ask", productPriceType = "bid", levels } = options
  // ★ 只算需要的等级（默认 +1）。这是把 73.7 秒压到几秒的关键。
  const targetLevels = (levels?.length ? levels : [1]).slice().sort((a, b) => a - b)
  const gameData = getGameDataApi()
  // 所有物品列表
  const list = Object.values(gameData.itemDetailMap)
  const profitList: WorkflowCalculator[] = []
  list.filter(item => item.enhancementCosts).forEach((item) => {
    if (getUsedPriceOf(item.hrid, 0, "ask") === -1) {
      return
    }
    for (const enhanceLevel of targetLevels) {
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
