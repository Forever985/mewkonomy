import type Calculator from "@/calculator"
import { getEquipmentClassOf, getEquipmentTypeOf } from "../utils/game"

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

  // 单值动作筛选（兼容旧调用方：jungle/enhanposer 等）
  params.project && (profitList = profitList.filter(cal => cal.project.match(params.project!)))

  // 组合条件并行筛选：多行 (步数, 动作, 等级区间) 组合，命中任一组合即保留
  // 如「5步锻造」+「3步缝纫」+「转化」可同时检索；等级限制也可作为组合条件之一
  const conditions = Array.isArray(params.conditions)
    ? params.conditions.filter((c: any) => c && ((c.steps != null && c.steps !== "") || c.project || c.minLevel != null || c.maxLevel != null))
    : []
  if (conditions.length) {
    profitList = profitList.filter((cal) => {
      const m = /^(\d+)步/.exec(cal.project)
      const steps = m ? +m[1] : 1
      return conditions.some((cond: any) => {
        if (cond.steps != null && cond.steps !== "" && steps !== cond.steps) return false
        if (cond.project && !cal.project.includes(cond.project)) return false
        if (cond.minLevel != null && cal.actionLevel < cond.minLevel) return false
        if (cond.maxLevel != null && cal.actionLevel > cond.maxLevel) return false
        return true
      })
    })
  }

  params.banEquipment && (profitList = profitList.filter(cal => !cal.isEquipment))
  params.banJewelry && (profitList = profitList.filter(cal =>
    getEquipmentTypeOf(cal.item) !== "neck" && getEquipmentTypeOf(cal.item) !== "ring" && getEquipmentTypeOf(cal.item) !== "earrings"))
  // 排除战斗装备：剔除 combat / both 类（依据 combatStats 派生分类）
  params.banCombat && (profitList = profitList.filter(cal => {
    const cls = getEquipmentClassOf(cal.item)
    return cls !== "combat" && cls !== "both"
  }))
  // 排除生活装备：剔除 life / both 类（依据 noncombatStats 派生分类）
  params.banLife && (profitList = profitList.filter(cal => {
    const cls = getEquipmentClassOf(cal.item)
    return cls !== "life" && cls !== "both"
  }))

  // 反向排除：excludes 为 { name?, project? }[] 组合，命中任一排除组合即剔除
  // - 仅排除某种生产：{ project: "锻造" }
  // - 仅排除某个产品：{ name: "奶酪" }
  // - 排除某产品某生产模式 / 某生产模式中某产品：{ name: "奶酪", project: "锻造" }
  const excludes = Array.isArray(params.excludes)
    ? params.excludes.filter((e: any) => e && (e.name || e.project))
    : []
  if (excludes.length) {
    profitList = profitList.filter((cal) => {
      const name = cal.result.name.toLowerCase()
      return !excludes.some((ex: any) => {
        if (ex.name && !name.includes(String(ex.name).toLowerCase())) return false
        if (ex.project && !cal.project.includes(ex.project)) return false
        return true
      })
    })
  }

  // 精确步数筛选：只保留 N 步方案，排除 N-1 / N+1 步（兼容旧调用方）
  params.steps && (profitList = profitList.filter((cal) => {
    const m = /^(\d+)步/.exec(cal.project)
    const steps = m ? +m[1] : 1
    return steps === params.steps
  }))

  // 利润率区间（%）单值兼容 + min/max 双头
  params.profitRate && (profitList = profitList.filter(cal => cal.result.profitRate >= params.profitRate! / 100))
  if (params.minProfitRate != null) profitList = profitList.filter(cal => cal.result.profitRate >= params.minProfitRate / 100)
  if (params.maxProfitRate != null) profitList = profitList.filter(cal => cal.result.profitRate <= params.maxProfitRate / 100)

  // 风险区间 min/max 双头
  if (params.minRisk != null) profitList = profitList.filter(cal => cal.result.risk >= params.minRisk)
  if (params.maxRisk != null) profitList = profitList.filter(cal => cal.result.risk <= params.maxRisk)
  return profitList
}

/**
 * 多样产业链精简：同一最终产物（result.name 相同）的多条产业链方案中，
 * 只保留时薪（profitPH）最高的一条，便于列表默认突出每个物品的最优方案。
 * 与比较模式（handleCompare）互补：比较模式展示组内全部方案并标排名，本函数只留最优。
 */
export function handleBestPerItem(profitList: Calculator[]) {
  // 兜底：profitPH 可能为 NaN（如迷宫等特殊物品），按 -Infinity 处理不干扰最优判断
  const norm = (v: number) => (Number.isFinite(v) ? v : -Infinity)
  const best = new Map<string, Calculator>()
  for (const cal of profitList) {
    const key = cal.result.name
    const prev = best.get(key)
    if (!prev || norm(cal.result.profitPH) > norm(prev.result.profitPH)) {
      best.set(key, cal)
    }
  }
  return Array.from(best.values())
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
