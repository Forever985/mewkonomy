import { getGameDataApi } from "@/common/apis/game"

/**
 * 「填表计算利润」各动作的可选范围。
 *
 * 抽成独立模块而不是写在页面里，是因为**这是逻辑不是 UI**：
 * 物品筛选条件写错会导致选择器列不出东西（或列出不能用的物品），
 * 而这类错误只有拿真实数据跑一遍才看得见，所以必须可被单测直接调用。
 *
 * ## 各动作的判定依据（都来自 data.json 的真实字段）
 * | 动作 | 判定 |
 * | --- | --- |
 * | 强化 | 物品有 `enhancementCosts` |
 * | 分解 | `alchemyDetail.decomposeItems` |
 * | 转化 | `alchemyDetail.transmuteDropTable` |
 * | 点金 | `alchemyDetail.isCoinifiable` |
 * | 制造 | `actionDetailMap` 里存在 `/actions/<专业>/<物品key>`，专业取 5 种制作类 |
 * | 采集 | 同上，专业取 3 种采集类 |
 *
 * 制造与采集的物品是**按专业区分**的，所以额外提供 `actionOf` 把物品反推回具体动作。
 */

export interface ProfitFormActionDef {
  key: string
  /** 菜单里的中文名（走 t()） */
  label: string
  /** `getCalculatorInstance` 用的类名 */
  className: string
  /** 计算器的 action 字段默认值 */
  action: string
  match: (item: any) => boolean
  actionOf?: (item: any) => string | undefined
  /** 需要「目标强化等级」（强化 / 分解） */
  needEnhanceLevel?: boolean
  /** 目标强化等级的默认值 */
  enhanceLevelDefault?: number
  /**
   * 需要「保护等级」。
   *
   * ⚠️ 强化计算器的 `available` 要求 `originLevel < enhanceLevel && escapeLevel < originLevel
   * && protectLevel <= enhanceLevel` 同时成立。`protectLevel` 在配置里是**必填**，
   * 不传就会让 `available` 为 false —— 表现成"选择器列得出物品、却被判定不支持该动作"。
   */
  needProtectLevel?: boolean
  /** 需要「触媒等级」（炼金三件套） */
  needCatalyst?: boolean
}

export const MANUFACTURE_PROFESSIONS = ["cheesesmithing", "crafting", "tailoring", "brewing", "cooking"]
export const GATHER_PROFESSIONS = ["foraging", "milking", "woodcutting"]

/** 物品 hrid → 末段 key（计算器内部也是这么取 key 的） */
export function profitFormKeyOf(hrid: string): string {
  return hrid.substring(hrid.lastIndexOf("/") + 1)
}

/** `专业|物品key` → 专业。用于把制造/采集的物品映射回具体动作 */
function buildProfessionIndex(): Map<string, string> {
  const index = new Map<string, string>()
  const adm = getGameDataApi().actionDetailMap ?? {}
  for (const path of Object.keys(adm)) {
    const m = /^\/actions\/([^/]+)\/(.+)$/.exec(path)
    if (m) {
      index.set(`${m[1]}|${m[2]}`, m[1])
    }
  }
  return index
}

let cachedIndex: Map<string, string> | undefined
function professionIndexOf(hrid: string, professions: string[]): string | undefined {
  cachedIndex ??= buildProfessionIndex()
  const key = profitFormKeyOf(hrid)
  return professions.find(p => cachedIndex!.has(`${p}|${key}`))
}

export const PROFIT_FORM_ACTIONS: ProfitFormActionDef[] = [
  {
    key: "enhance",
    label: "强化",
    className: "EnhanceCalculator",
    action: "enhancing",
    match: (i: any) => !!i.enhancementCosts,
    needEnhanceLevel: true,
    // 从 +0 强化到 +1 是最小可用配置；强化计算器要求 protectLevel 必填且 ≤ 目标等级
    enhanceLevelDefault: 1,
    needProtectLevel: true
  },
  {
    key: "decompose",
    label: "分解",
    className: "DecomposeCalculator",
    action: "alchemy",
    match: (i: any) => !!i.alchemyDetail?.decomposeItems,
    needEnhanceLevel: true,
    needCatalyst: true
  },
  {
    key: "transmute",
    label: "转化",
    className: "TransmuteCalculator",
    action: "alchemy",
    match: (i: any) => !!i.alchemyDetail?.transmuteDropTable,
    needCatalyst: true
  },
  {
    key: "coinify",
    label: "点金",
    className: "CoinifyCalculator",
    action: "alchemy",
    match: (i: any) => !!i.alchemyDetail?.isCoinifiable,
    needCatalyst: true
  },
  {
    key: "manufacture",
    label: "制造",
    className: "ManufactureCalculator",
    action: "cheesesmithing",
    match: (i: any) => !!professionIndexOf(i.hrid, MANUFACTURE_PROFESSIONS),
    actionOf: (i: any) => professionIndexOf(i.hrid, MANUFACTURE_PROFESSIONS)
  },
  {
    key: "gather",
    label: "采集",
    className: "GatherCalculator",
    action: "foraging",
    match: (i: any) => !!professionIndexOf(i.hrid, GATHER_PROFESSIONS),
    actionOf: (i: any) => professionIndexOf(i.hrid, GATHER_PROFESSIONS)
  }
]

export function profitFormActionOf(key: string): ProfitFormActionDef {
  const found = PROFIT_FORM_ACTIONS.find(a => a.key === key)
  if (!found) {
    throw new Error(`未知的动作: ${key}`)
  }
  return found
}

/** 某动作下可选的物品（未排序；名称翻译交给调用方） */
export function profitFormItemsOf(actionKey: string): any[] {
  const def = profitFormActionOf(actionKey)
  const gd = getGameDataApi()
  const items = Object.values(gd.itemDetailMap as Record<string, any>)
  return items.filter(i => def.match(i))
}
