import type { Sort } from "element-plus"
import type Calculator from "@/calculator"

export interface RequestData {
  /** 当前页码 */
  currentPage: number
  /** 查询条数 */
  size: number
  /** 查询参数：名称（支持数组多物品，命中任一即保留） */
  name?: string | string[]
  /** 查询参数：项目（单值，兼容旧调用方） */
  project?: string
  /** 查询参数：组合条件（多行「步数+动作」并行检索，命中任一组合即保留） */
  conditions?: Array<{ steps?: number | string; project?: string }>
  /** 查询参数：利润率%下限（含） */
  minProfitRate?: number
  /** 查询参数：利润率%上限（含） */
  maxProfitRate?: number
  /** 查询参数：利润率%（兼容旧调用方，已弃用，请用 minProfitRate/maxProfitRate） */
  profitRate?: number
  /** 查询参数：排除装备 */
  banEquipment?: boolean
  /** 查询参数：精确步数（如 3 = 只看 3 步方案，排除 2/4 步） */
  steps?: number
  /** 查询参数：风险系数下限 */
  minRisk?: number
  /** 查询参数：最大风险系数 */
  maxRisk?: number
  /** 比较模式：按物品分组标注组内排名 */
  compare?: boolean
  enhanposer?: boolean
  sort?: Sort
  /** 要求等级下限（兼容旧单值 actionLevel 作为下限） */
  actionLevel?: number
  /** 要求等级下限 */
  minLevel?: number
  /** 要求等级上限 */
  maxLevel?: number
}

export type ResponseData = ApiResponseData<{
  list: LeaderboardData[]
  total: number
}>

export interface LeaderboardData {
  calculator: Calculator
  // todo
  calculatorList?: Calculator[]
  resultList?: any[]
  workMultiplier?: number[]

  hrid: string
  name: string
  project: string
  successRate: number
  costPH: number
  consumePH: number
  gainPH: number
  incomePH: number
  profitPH: number
  profitRate: number

  costPHFormat: string
  incomePHFormat: string
  profitPHFormat: string
  profitPDFormat: string
  profitRateFormat: string
  efficiencyFormat: string
  timeCostFormat: string
  successRateFormat: string

}
