import type Calculator from "@/calculator"
import { pinia } from "@/pinia"
import { defineStore } from "pinia"

/**
 * 「填表计算利润」的手填值持久化。
 *
 * ## 只存**覆盖值**，不存整张表
 * 存下来的只有「你手填过的那几项」（某物品的单价/数量、动作次数、单次耗时），
 * 其余一律每次从计算器现算。这样做的原因：
 * - 你磕了工匠茶、换了触媒、调了强化等级之后，**配方结构会变**；
 *   若把整张表存下来，显示的就是一份过期配方，还会静默算错。
 * - 而「我买的时候是这个价格」这件事**本来就与配方无关**，只该活在价格上。
 *
 * 于是语义正好是用户要的：**填过的价格留着，其余跟着当前配置走。**
 */

const STORAGE_KEY = "profit-form-overrides"

export interface StoredProfitForm {
  /** 物品 key → 手填单价 */
  prices: Record<string, number>
  /** 物品 key → 手填单次数量 */
  counts: Record<string, number>
  /** 手填动作次数 */
  actions?: number
  /** 手填单次耗时（纳秒） */
  timeCostPerAction?: number
}

/** 方案标识：同类计算器 + 同配置才视为"同一个方案" */
export function profitFormPlanKeyOf(calc: Calculator): string {
  const cfg = calc.config as any
  return [
    calc.className,
    calc.id,
    calc.catalystRank ?? "",
    calc.enhanceLevel ?? 0,
    // 保护等级会显著改变成本，不同保护等级必须视为不同方案
    cfg?.protectLevel ?? "",
    cfg?.originLevel ?? ""
  ].join("|")
}

function emptyForm(): StoredProfitForm {
  return { prices: {}, counts: {} }
}

function load(): Record<string, StoredProfitForm> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function save(map: Record<string, StoredProfitForm>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch (e) {
    console.error("填表算利润保存失败:", e)
  }
}

export const useProfitFormStore = defineStore("profitform", () => {
  const map = ref<Record<string, StoredProfitForm>>(load())

  function getOf(planKey: string): StoredProfitForm {
    return map.value[planKey] ?? emptyForm()
  }

  function saveOf(planKey: string, form: StoredProfitForm) {
    map.value[planKey] = form
    save(map.value)
  }

  function clearOf(planKey: string) {
    delete map.value[planKey]
    save(map.value)
  }

  function clearAll() {
    map.value = {}
    save(map.value)
  }

  /** 该方案是否填过东西（用于在 UI 上提示"已保存"） */
  function hasOverride(planKey: string): boolean {
    const f = map.value[planKey]
    if (!f) {
      return false
    }
    return Object.keys(f.prices).length > 0
      || Object.keys(f.counts).length > 0
      || f.actions != null
      || f.timeCostPerAction != null
  }

  return { map, getOf, saveOf, clearOf, clearAll, hasOverride }
})

export function useProfitFormStoreOutside() {
  return useProfitFormStore(pinia)
}
