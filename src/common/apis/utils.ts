import type Calculator from "@/calculator"
import { getEquipmentTypeOf } from "../utils/game"

export function handleSort(profitList: Calculator[], params: any) {
  // 首先进行一次利润排序
  profitList.sort((a, b) => b.result.profitPH - a.result.profitPH)

  // 排序
  if (params.sort && params.sort.order) {
    const props = params.sort.prop.split(".")
    function getValue(c: any) {
      let value = c
      for (let i = 0; i < props.length; ++i) {
        value = value[props[i]]
      }
      return value
    }
    const order = params.sort.order
    profitList.sort((a, b) => {
      return order === "descending" ? getValue(b) - getValue(a) : getValue(a) - getValue(b)
    })
  }
  return profitList
}

export function handlePage(profitList: Calculator[], params: any) {
  return { list: profitList.slice((params.currentPage - 1) * params.size, params.currentPage * params.size), total: profitList.length }
}

export function handlePush(profitList: Calculator[], cal: Calculator) {
  if (!cal.available) return
  if (!cal.result) {
    cal.run()
  }
  profitList.push(cal)
}

export function handleSearch(profitList: Calculator[], params: any) {
  // 多物品名称筛选：name 可为 string 或 string[]，命中任一即保留
  const names = Array.isArray(params.name)
    ? params.name.filter(Boolean)
    : params.name
      ? [params.name]
      : []
  if (names.length) {
    profitList = profitList.filter((cal) => {
      const name = cal.result.name.toLowerCase()
      return names.some((n: string) => name.includes(String(n).toLowerCase()))
    })
  }

  params.project && (profitList = profitList.filter(cal => cal.project.match(params.project!)))
  params.banEquipment && (profitList = profitList.filter(cal => !cal.isEquipment))
  params.banJewelry && (profitList = profitList.filter(cal =>
    getEquipmentTypeOf(cal.item) !== "neck" && getEquipmentTypeOf(cal.item) !== "ring" && getEquipmentTypeOf(cal.item) !== "earrings"))

  // 精确步数筛选：只保留 N 步方案，排除 N-1 / N+1 步
  params.steps && (profitList = profitList.filter((cal) => {
    const m = /^(\d+)步/.exec(cal.project)
    const steps = m ? +m[1] : 1
    return steps === params.steps
  }))

  params.profitRate && (profitList = profitList.filter(cal => cal.result.profitRate >= params.profitRate! / 100))
  params.maxRisk && (profitList = profitList.filter(cal => cal.result.risk <= params.maxRisk))
  return profitList
}

/**
 * 比较模式：按物品名分组，组内按利润降序并标注组内排名，组间按最优利润降序。
 * 使多个物品的方案在列表中相邻，便于横向比较。
 */
export function handleCompare(profitList: Calculator[], params: any) {
  if (!params.compare) {
    return profitList
  }
  const groups = new Map<string, Calculator[]>()
  profitList.forEach((cal) => {
    const key = cal.result.name
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(cal)
  })
  const groupEntries = Array.from(groups.entries()).map(([name, list]) => {
    const sorted = list.sort((a, b) => b.result.profitPH - a.result.profitPH)
    return { name, list: sorted, best: sorted[0]?.result.profitPH || -Infinity }
  })
  groupEntries.sort((a, b) => b.best - a.best)
  const result: Calculator[] = []
  groupEntries.forEach((g) => {
    g.list.forEach((cal, idx) => {
      ;(cal as any).groupRank = idx + 1
      ;(cal as any).groupTotal = g.list.length
    })
    result.push(...g.list)
  })
  return result
}
