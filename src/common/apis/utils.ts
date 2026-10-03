import type Calculator from "@/calculator"
import { buildTextQuery, compileQuery, normalizeTerm, toComparable } from "@/common/utils/query-engine"
import { allNamesOf, aliasSearchTextOf } from "@/common/utils/multilang-search"
import { getEquipmentClassOf, isCharm, isJewelry } from "../utils/game"

/**
 * 单条排序规则
 *
 * `rules[0]` 是**第一优先级**（分组依据），`rules[1]` 在第一优先级取值相同的结果内生效，以此类推。
 * 这与 Element Plus 表头点击（单列排序）等价于「只有一条规则」。
 */
export interface SortRule {
  /** Calculator 上的取值路径，如 `result.profitPH`、`actionLevel` */
  prop: string
  order: "ascending" | "descending"
}

/** 从任意嵌套对象按 `a.b.c` 路径取值 */
function valueAtPath(target: any, path: string): any {
  let value = target
  for (const key of path.split(".")) {
    if (value == null) {
      return undefined
    }
    value = value[key]
  }
  return value
}

/** 把「数字、或形如 12.34% / 1,234 / $12.3万 / 1.2M 的字符串」归一成 number；无法解析时返回 null。 */
function normalizeNumeric(value: any): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== "string") {
    return null
  }
  const cleaned = value.replace(/[,\s%$¥€£]/g, "").replace(/万$|亿$|M$|K$|B$/i, "")
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return null
  }
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

/**
 * 比较两个值。
 *
 * 字符串会先尝试按「带格式的数字」比较——展示型列（`12.34%`、`1,234`）本质是数字，
 * 按字典序会得出 `"5.00%" > "20.00%"` 这种反直觉结果。
 * 按展示值比较意味着**相等判定发生在显示精度上**，正好符合「先按利润率分组、组内再按时薪排」的直觉。
 * 缺失值（null / undefined / NaN）统一视为最小。
 */
function compareValues(a: any, b: any): number {
  const na = normalizeNumeric(a)
  const nb = normalizeNumeric(b)
  if (na === null && nb === null) return 0
  if (na === null) return -1
  if (nb === null) return 1
  if (typeof na === "number" && typeof nb === "number") {
    return na - nb
  }
  return String(a).localeCompare(String(b))
}

/**
 * 把排序参数统一成规则数组（向后兼容旧的单条 `sort: { prop, order }` 形态）。
 * - `params.sortRules` 优先（多级排序）；
 * - 否则回落到 `params.sort`（Element Plus 表头点击的原生形态）。
 */
export function parseSortRules(params: any): SortRule[] {
  const raw = Array.isArray(params?.sortRules) && params.sortRules.length
    ? params.sortRules
    : params?.sort?.prop && params.sort?.order
      ? [params.sort]
      : []
  return raw
    .filter((r: any) => r && r.prop && (r.order === "ascending" || r.order === "descending"))
    .map((r: any) => ({ prop: String(r.prop), order: r.order as SortRule["order"] }))
}

export function handleSort(profitList: Calculator[], params: any) {
  // 默认先按时薪降序，保证任何情况下列表都不是随机序
  profitList.sort((a, b) => b.result.profitPH - a.result.profitPH)

  const rules = parseSortRules(params)
  if (!rules.length) {
    return profitList
  }

  // 逐级比较：第 i 条规则仅在前 i-1 条全部相等时生效
  return profitList.sort((a, b) => {
    for (const rule of rules) {
      const cmp = compareValues(valueAtPath(a, rule.prop), valueAtPath(b, rule.prop))
      if (cmp !== 0) {
        return rule.order === "descending" ? -cmp : cmp
      }
    }
    return 0
  })
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

/**
 * 从 project 名称里解析「生产步数」。
 *
 * project 由 `t("{0}步{1}", [n, 动作])` 生成（leaderboard / manualchemy 都是如此），
 * 即长这样：`5步锻造`。但「步」在 en.ts 里被翻译成了 `" steps "`（注意两侧空格），
 * 英文界面下 project 会变成 `5 steps Smithing`。原先这里写死 `/^(\d+)步/`，
 * 英文模式下正则失配 → 所有方案的步数都被当成 1 → 步数筛选与组合条件全面失效。
 *
 * 所以这里同时接受中英两种写法，并且允许数字与单位之间有空白。
 * 解析不出步数时按 1 处理（与「单步动作」的原语义一致）。
 */
export function stepsOfProject(project: string): number {
  const m = /^\s*(\d+)\s*(?:步|steps?)/i.exec(project)
  return m ? +m[1] : 1
}

export function handleSearch(profitList: Calculator[], params: any) {
  // ── 改造说明 ──────────────────────────────────────────────────────────────
  // 改造前这里是 15 个平铺的 `params.x && (list = list.filter(...))`：
  //   - 每个条件各遍历一次全量。11 个检索页每次检索都是 N 遍 O(n)；
  //   - 条件散在函数体里，无法统一计数、无法声明式复用、无法统一序列化；
  //   - 文本归一化在调用方各写一遍，全项目有 5 份不一致的实现。
  //
  // 现在编成**一个**谓词（query-engine 的 compileQuery）：按代价从低到高短路求值、
  // 只遍历一次；文本匹配由引擎统一归一化，调用方不必自己小写化。
  //
  // ⚠️ **语义必须与改造前逐条一致**（11 个页面共用）。已由
  // `tests/handle-search-parity.test.ts` 锁定 34 个用例，其中包含两条
  // 看起来「不理想」但必须保留的既有行为：
  //   1. `name` 传数组时是 **OR**，不是 AND；
  //   2. 单值 `params.profitRate` 用 `&&` 判定，**传 0 不生效**（falsy 短路），
  //      而 `minProfitRate` 用 `!= null` 判定、传 0 生效 —— 两者并不对称，是现状。

  /** 该方案的展示名（含三语别名，供文本检索用） */
  function searchTextOf(cal: Calculator): string {
    return aliasSearchTextOf(allNamesOf(cal.result.name))
  }

  // 多物品名称筛选：name 可为 string 或 string[]，命中任一即保留（OR）。
  // 把多个名称用 `|` 交给引擎的「任一命中」模式，而不是循环 filter。
  const names = Array.isArray(params.name)
    ? params.name.filter(Boolean)
    : params.name
      ? [params.name]
      : []
  const nameQuery = names.length
    ? buildTextQuery(names.map((n: string) => String(n)).join(" | "), "any", ["name"])
    : undefined

  // 组合条件：多行 (步数, 动作, 等级区间)，**行内 AND、行间 OR**
  const conditions = Array.isArray(params.conditions)
    ? params.conditions.filter((c: any) => c && ((c.steps != null && c.steps !== "") || c.project || c.minLevel != null || c.maxLevel != null))
    : []

  // 反向排除：{ name?, project? }[]，命中任一排除组合即剔除
  const excludes = Array.isArray(params.excludes)
    ? params.excludes.filter((e: any) => e && (e.name || e.project))
    : []

  // 利润率 / 风险：藏在 `cal.result` 里，而引擎的 range 走顶层字段，
  // 所以用自定义谓词处理（range 只适合顶层数值字段）。
  const rateMin1 = params.profitRate ? Number(params.profitRate) / 100 : undefined
  const rateMin2 = params.minProfitRate != null ? params.minProfitRate / 100 : undefined
  const rateMax = params.maxProfitRate != null ? params.maxProfitRate / 100 : undefined
  const riskMin = params.minRisk != null ? params.minRisk : undefined
  const riskMax = params.maxRisk != null ? params.maxRisk : undefined
  const hasRate = rateMin1 !== undefined || rateMin2 !== undefined || rateMax !== undefined
  const hasRisk = riskMin !== undefined || riskMax !== undefined

  /** 利润率是否达标。两个下限同时给时取更严的（等价于改造前两次 filter 依次生效）。 */
  function rateOk(cal: Calculator): boolean {
    const v = toComparable(cal.result.profitRate)
    if (v == null) {
      return false
    }
    const lo = rateMin1 !== undefined && rateMin2 !== undefined
      ? Math.max(rateMin1, rateMin2)
      : (rateMin1 ?? rateMin2)
    if (lo !== undefined && v < lo) {
      return false
    }
    return rateMax === undefined || v <= rateMax
  }

  /** 风险是否达标 */
  function riskOk(cal: Calculator): boolean {
    const v = toComparable(cal.result.risk)
    if (v == null) {
      return false
    }
    if (riskMin !== undefined && v < riskMin) {
      return false
    }
    return riskMax === undefined || v <= riskMax
  }

  const query = compileQuery<Calculator>(
    {
      text: nameQuery,
      custom: [
        // 单值动作筛选（兼容旧调用方：jungle / enhanposer 等）。
        // 用 includes 而非 match：params.project 是用户选中的项目名，可能含正则元字符，
        // 且 match 是子串包含语义，includes 更贴切也更安全。
        ...(params.project ? [(cal: Calculator) => cal.project.includes(params.project)] : []),

        // 精确步数筛选：只保留 N 步方案，排除 N-1 / N+1 步
        ...(params.steps
          ? [(cal: Calculator) => stepsOfProject(cal.project) === params.steps]
          : []),

        // 组合条件：行内 AND、行间 OR
        ...(conditions.length
          ? [(cal: Calculator) => {
              const steps = stepsOfProject(cal.project)
              return conditions.some((cond: any) => {
                if (cond.steps != null && cond.steps !== "" && steps !== cond.steps) return false
                if (cond.project && !cal.project.includes(cond.project)) return false
                if (cond.minLevel != null && cal.actionLevel < cond.minLevel) return false
                if (cond.maxLevel != null && cal.actionLevel > cond.maxLevel) return false
                return true
              })
            }]
          : []),

        // 反向排除：
        // - 仅排除某种生产：{ project: "锻造" }
        // - 仅排除某个产品：{ name: "奶酪" }
        // - 排除某产品某生产模式：{ name: "奶酪", project: "锻造" }
        ...(excludes.length
          ? [(cal: Calculator) => {
              const name = searchTextOf(cal)
              return !excludes.some((ex: any) => {
                if (ex.name && !name.includes(normalizeTerm(String(ex.name)))) return false
                if (ex.project && !cal.project.includes(ex.project)) return false
                return true
              })
            }]
          : []),

        // ── 排除装备 / 排除首饰 / 排除护符：三个开关**互相独立**，可任意组合 ──
        // 关键：banEquipment 只负责「既不是首饰、也不是护符的那部分装备」，
        // 首饰交给 banJewelry、护符交给 banCharm。
        //
        // 修正前是包含关系（banEquipment 一并剔除首饰），后果是：只要勾了「排除装备」，
        // 「排除首饰」就变成空操作。而 利润排行(dashboard) 与 制作炼金(manualchemy) 的默认值
        // 恰好是 banEquipment=true —— 于是这两页上勾「排除首饰」**永远看不到任何变化**，
        // 表现为「排除首饰没用」。
        //
        // 现在的语义（保持「三个都勾 = 排除全部装备」与修正前勾「排除装备」的结果一致）：
        //   排除装备   -> 只去掉护甲/武器/工具/披风/袋子等，保留项链/戒指/耳环/**护符**
        //   排除首饰   -> 只去掉项链/戒指/耳环
        //   排除护符   -> 只去掉护符（实测 102 件，占全部装备 19%）
        //   三个都勾   -> 全部装备都被排除
        ...(params.banEquipment
          ? [(cal: Calculator) => !cal.isEquipment || isJewelry(cal.item) || isCharm(cal.item)]
          : []),
        ...(params.banJewelry ? [(cal: Calculator) => !isJewelry(cal.item)] : []),
        ...(params.banCharm ? [(cal: Calculator) => !isCharm(cal.item)] : []),

        // 排除战斗装备：剔除 combat / both 类（依据 combatStats 派生分类）
        ...(params.banCombat
          ? [(cal: Calculator) => {
              const cls = getEquipmentClassOf(cal.item)
              return cls !== "combat" && cls !== "both"
            }]
          : []),

        // 排除生活装备：剔除 life / both 类（依据 noncombatStats 派生分类）
        ...(params.banLife
          ? [(cal: Calculator) => {
              const cls = getEquipmentClassOf(cal.item)
              return cls !== "life" && cls !== "both"
            }]
          : []),

        ...(hasRate ? [rateOk] : []),
        ...(hasRisk ? [riskOk] : [])
      ]
    },
    () => searchTextOf
  )

  return profitList.filter(query.predicate)
}

/**
 * 多行组合条件（并行检索）通用过滤
 *
 * 语义与各处检索区一致：**行间 OR、行内 AND**。
 * 同一个 `conditions` 数组在不同页面的字段含义不同，因此由调用方提供 `levelOf` 取值函数：
 * - dashboard / manualchemy：`steps` = 生产步数（`N步X` 的 project 前缀），无等级字段
 * - enhanposer / enhanposest / jungle 组：无步数语义，`steps` 映射为「目标强化等级」相等匹配，
 *   `minLevel` / `maxLevel` 为等级区间
 *
 * 注意：`handleSearch` 里的组合条件走的是「步数」正则，对强化类数据会误伤，
 * 因此那些页面必须先调用本函数做条件过滤，再把 `conditions` 从入参中剔除后交给 handleSearch。
 */
export function handleConditions<T extends Calculator>(
  profitList: T[],
  params: any,
  levelOf: (cal: T) => number
): T[] {
  const conditions = Array.isArray(params?.conditions)
    ? params.conditions.filter((c: any) => c && ((c.steps != null && c.steps !== "") || c.project || c.minLevel != null || c.maxLevel != null))
    : []
  if (!conditions.length) {
    return profitList
  }
  return profitList.filter((cal) => {
    const level = levelOf(cal)
    return conditions.some((cond: any) => {
      if (cond.steps != null && cond.steps !== "" && level !== cond.steps) return false
      if (cond.project && !cal.project.includes(cond.project)) return false
      if (cond.minLevel != null && level < cond.minLevel) return false
      if (cond.maxLevel != null && level > cond.maxLevel) return false
      return true
    })
  })
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
