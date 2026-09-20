import type { SortField } from "@@/components/SortPriority/index.vue"

/**
 * 各列表页「排序优先级」可选字段清单
 *
 * 集中定义的原因：这些 `prop` 是 **Calculator 实例上的取值路径**（不是表格列的字符串），
 * 与表格列的 `prop` 可能不同（例如表格显示 `result.profitRateFormat`，排序要用数值 `result.profitRate`）。
 * 分散在 11 个页面里极易写错，且难以核对，因此统一收口。
 *
 * `formatted: true` 表示按**展示精度**排序（如「利润率 12.34%」），
 * 这样「先按利润率分组、组内再按时薪排」会按用户看到的百分比分组，更符合直觉。
 */
export const DASHBOARD_SORT_FIELDS: SortField[] = [
  { prop: "result.profitPH", label: "利润 / h" },
  { prop: "result.profitRate", label: "利润率" },
  { prop: "result.profitRateFormat", label: "利润率（按显示精度分组）", formatted: true },
  { prop: "result.profitPP", label: "利润 / 次" },
  { prop: "actionLevel", label: "要求等级" },
  { prop: "result.expPH", label: "经验 / h" },
  { prop: "result.risk", label: "风险" },
  { prop: "result.selfProduceRatio", label: "自产比例" },
  { prop: "item.itemLevel", label: "物品等级" }
]

export const MANUALCHEMY_SORT_FIELDS: SortField[] = [
  { prop: "result.profitPH", label: "利润 / h" },
  { prop: "result.profitRate", label: "利润率" },
  { prop: "result.profitRateFormat", label: "利润率（按显示精度分组）", formatted: true },
  { prop: "result.profitPP", label: "利润 / 次" },
  { prop: "actionLevel", label: "要求等级" },
  { prop: "result.expPH", label: "经验 / h" },
  { prop: "result.risk", label: "风险" },
  { prop: "result.selfProduceRatio", label: "自产比例" },
  { prop: "item.itemLevel", label: "物品等级" }
]

export const ENHANPOSER_SORT_FIELDS: SortField[] = [
  { prop: "result.profitPH", label: "利润 / h" },
  { prop: "result.profitRate", label: "利润率" },
  { prop: "result.profitRateFormat", label: "利润率（按显示精度分组）", formatted: true },
  { prop: "result.profitPP", label: "利润 / 次" },
  { prop: "actionLevel", label: "要求等级" },
  { prop: "result.expPH", label: "经验 / h" },
  { prop: "result.risk", label: "风险" },
  { prop: "item.itemLevel", label: "物品等级" }
]

/** 强化分解方案没有「要求等级」列（等级即目标强化等级），故用 enhanceLevel */
export const ENHANPOSEST_SORT_FIELDS: SortField[] = [
  { prop: "result.profitPH", label: "利润 / h" },
  { prop: "result.profitRate", label: "利润率" },
  { prop: "result.profitRateFormat", label: "利润率（按显示精度分组）", formatted: true },
  { prop: "result.profitPP", label: "利润 / 次" },
  { prop: "result.expPH", label: "经验 / h" },
  { prop: "result.risk", label: "风险" },
  { prop: "item.itemLevel", label: "物品等级" }
]

export const JUNGLE_SORT_FIELDS: SortField[] = [
  { prop: "result.profitPH", label: "利润 / h" },
  { prop: "result.profitRate", label: "利润率" },
  { prop: "result.profitRateFormat", label: "利润率（按显示精度分组）", formatted: true },
  { prop: "result.profitPP", label: "利润 / 次" },
  { prop: "result.risk", label: "风险" },
  { prop: "item.itemLevel", label: "物品等级" }
]

/** 打野组：目标强化等级取自末尾强化阶段 */
export const JUNGLE_ENHANCE_LEVEL_SORT_FIELDS: SortField[] = [
  { prop: "calculator.enhanceLevel", label: "目标等级" },
  ...JUNGLE_SORT_FIELDS
]

/** 打野（jungle）：多步方案的目标等级在 workflow 计算器列表末尾，单步方案则在 calculator 上 */
export const JUNGLE_TARGET_LEVEL_SORT_FIELDS: SortField[] = [
  { prop: "targetEnhanceLevel", label: "目标等级" },
  ...JUNGLE_SORT_FIELDS
]

export const INHERIT_SORT_FIELDS: SortField[] = [
  { prop: "result.profitPH", label: "利润 / h" },
  { prop: "result.profitRate", label: "利润率" },
  { prop: "result.profitRateFormat", label: "利润率（按显示精度分组）", formatted: true },
  { prop: "result.profitPP", label: "利润 / 次" },
  { prop: "originLevel", label: "初始等级" },
  { prop: "item.itemLevel", label: "物品等级" }
]

export const JUNGLERIT_SORT_FIELDS: SortField[] = [
  { prop: "result.profitPH", label: "利润 / h" },
  { prop: "result.profitRate", label: "利润率" },
  { prop: "result.profitRateFormat", label: "利润率（按显示精度分组）", formatted: true },
  { prop: "result.profitPP", label: "利润 / 次" },
  { prop: "calculator.enhanceLevel", label: "目标等级" },
  { prop: "result.risk", label: "风险" },
  { prop: "item.itemLevel", label: "物品等级" }
]

/**
 * 强化练级性价比：核心指标是「每次经验成本」（越小越好，净成本为负时也是负数，升序即赚钱方案优先）。
 * 「是否赚钱」用数值化的 `result.profitableRank`（1/0）而非布尔 `result.profitable`——
 * `handleSort` 的 compareValues 把布尔当缺失值，直接用布尔的排序是空操作。
 */
export const ENHANCEEXP_SORT_FIELDS: SortField[] = [
  { prop: "result.costPerExp", label: "每次经验成本" },
  { prop: "result.profitableRank", label: "是否赚钱" },
  { prop: "result.exp", label: "总经验" },
  { prop: "result.netCost", label: "净成本" },
  { prop: "result.saleValue", label: "售价" },
  { prop: "result.enhanceLevel", label: "目标等级" },
  { prop: "actionLevel", label: "要求等级" },
  { prop: "result.actions", label: "次数" }
]
