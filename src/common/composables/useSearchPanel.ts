import type { PanelSearchData } from "@@/components/SearchPanel/types"

/**
 * 归一化搜索数据：把历史版本留下的旧结构迁移成现行结构。
 *
 * 背景：这段迁移逻辑原先在 10 个检索页里逐字重复了一遍 ——
 *   dashboard / decompose / inherit / jungle / pickout / junglest / junglest-inherit
 *   / manualchemy / enhanposer / enhanposest
 * 每份都是同样的 5 步：name 字符串转数组、conditions 补数组、excludes 补数组、
 * profitRate 迁移到 minProfitRate、删掉已废弃的 project / profitRate。
 * 迁移规则一旦要改就得改 10 处，所以抽到这里统一维护。
 *
 * 就地修改传入的对象（与原先各页写法一致），并返回同一个引用便于链式使用。
 */
export function normalizeSearchData(data: PanelSearchData): PanelSearchData {
  // 1) 旧版 name 是单个字符串，现行为多物品数组
  if (typeof data.name === "string") {
    data.name = data.name ? [data.name] : []
  }
  if (!Array.isArray(data.name)) {
    data.name = []
  }

  // 2) 组合条件：旧版是顶层单值 project / steps，现行为「行数组」
  if (!Array.isArray(data.conditions)) {
    data.conditions = [
      {
        steps: (data.steps as number | undefined) ?? undefined,
        project: (data.project as string | undefined) ?? undefined
      }
    ]
  }

  // 3) 排除行同样补成数组（仅当该页确实声明了 excludes 字段时）
  if (Object.prototype.hasOwnProperty.call(data, "excludes") && !Array.isArray(data.excludes)) {
    data.excludes = [{ name: undefined, project: undefined }]
  }

  // 4) profitRate（单值）迁移为 minProfitRate
  if (data.profitRate != null && data.minProfitRate == null) {
    data.minProfitRate = data.profitRate as number
  }

  // 5) 清理已废弃的顶层键，避免残留旧值参与检索
  delete data.project
  delete data.profitRate
  delete data.steps

  return data
}
