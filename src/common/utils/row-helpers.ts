/**
 * 表格行的通用小工具 —— 供多个 API 模块共用。
 *
 * ## 为什么要抽出来
 *
 * 「按字段排序」与「取分类选项」这两件事，市场监控与炒货两个模块都要做，
 * 而实现细节完全一样（name 用 localeCompare、数值比较、NaN 沉底）。
 * 早前两边各写一份，其中一份改了 NaN 的处理另一份不会跟着改 ——
 * 这类复制粘贴必然漂移，所以收在这里。
 *
 * 刻意**没有**复用 `common/utils/query-engine`：
 * 那个引擎面向「文本 + 区间 + 排序条件」的可组合查询（`TextQuery` / `RangeQuery` /
 * `SortSpec`），而这里的排序只有一个键、分类只是去重取并集。
 * 把两行代码塞进那套引擎反而更难读 —— 「该复用的没复用」和「不该复用的乱复用」
 * 一样是问题。
 */

/** 排序方向（与 element-plus 的 `sort-change` 事件取值一致） */
export type RowSortOrder = "ascending" | "descending"

/**
 * 按字段排序。
 *
 * - `key === "name"` 时按 `nameOf(name)` 本地化比较（显示名排序）
 * - 其余字段按数值比较；取不到值（`null` / `undefined` / 非有限数）一律**沉底**。
 *   沉底而不是当 0：涨跌这类字段「无数据」和「真的是 0」必须分开，
 *   否则无数据的行会插在中间，看着像有值。
 */
export function sortRowsByField<T extends Record<string, unknown>>(
  list: T[],
  key: string,
  order: RowSortOrder,
  nameOf: (name: string) => string = n => n
): T[] {
  const dir = order === "ascending" ? 1 : -1
  return [...list].sort((a, b) => {
    if (key === "name") {
      return nameOf(String(a.name)).localeCompare(nameOf(String(b.name))) * dir
    }
    const av = numericOrNaN(a[key])
    const bv = numericOrNaN(b[key])
    const aNaN = Number.isNaN(av)
    const bNaN = Number.isNaN(bv)
    if (aNaN || bNaN) {
      return aNaN && bNaN ? 0 : aNaN ? 1 : -1
    }
    return (av - bv) * dir
  })
}

function numericOrNaN(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : Number.NaN
}

/** 取分类选项（去重 + 排序），供筛选下拉使用。空分类不产出选项 */
export function categoryOptionsOf<T extends { category?: string }>(list: T[]): string[] {
  const set = new Set<string>()
  for (const item of list) {
    if (item.category) set.add(item.category)
  }
  return Array.from(set).sort()
}