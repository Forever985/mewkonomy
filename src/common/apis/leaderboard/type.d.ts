import type { Sort } from "element-plus"
import type Calculator from "@/calculator"

export interface RequestData {
  /** 当前页码 */
  currentPage: number
  /** 查询条数 */
  size: number
  /** 查询参数：名称（支持数组多物品，命中任一即保留） */
  name?: string | string[]
  /** 查询参数：项目 */
  project?: string
  /** 查询参数：利润率% */
  profitRate?: number
  /** 查询参数：排除装备 */
  banEquipment?: boolean
  /** 查询参数：精确步数（如 3 = 只看 3 步方案，排除 2/4 步） */
  steps?: number
  /** 查询参数：最大风险系数 */
  maxRisk?: number
  /** 比较模式：按物品分组标注组内排名 */
  compare?: boolean
  enhanposer?: boolean
  sort?: Sort
  actionLevel?: number
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
