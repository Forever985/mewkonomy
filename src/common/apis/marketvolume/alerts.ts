import type { MarketVolumeItem } from "."
import { marketRowKeyOf } from "./keys"

/**
 * 市场监控「提醒规则」的模型与评估。
 *
 * 设计要点（都来自实际使用需求）：
 * 1. **规则可多条、彼此解耦**：每条规则自带 `enabled`（独立开关）与 `priority`（优先级），
 *    作用范围、被监控指标、判定方式、阈值都各写各的，互不影响；删掉一条不会动其它条。
 * 2. **判定方式两种**：`absolute`（绝对值阈值，如「成交量/小时 ≥ 500」）与
 *    `relative`（相对排行，如「排进成交量前 10」「超过均值的 3 倍」）。
 *    后者不需要每次手调阈值，适合「交易量过高的产品」这类没有固定基准的场景。
 * 3. **只在市场监控页评估**：这里只做纯函数计算，不碰副作用、不碰 i18n，
 *    因此可以单独做单元测试；提醒的「怎么显示 / 要不要弹系统通知」由页面决定。
 */

/** 规则作用范围 */
export type AlertScopeType = "all" | "category" | "item"

/**
 * 可被监控的指标。字段都取自 `MarketVolumeItem` 上已由页面回填的那部分，
 * 因此评估时拿到的是「已经算好涨跌/速率/滚动量」的列表。
 */
export type AlertMetric =
  | "price"
  | "ask"
  | "bid"
  | "changePct"
  | "volumeRate"
  | "volumeRolling"
  | "volume"
  | "turnoverRolling"

export const ALERT_METRICS: readonly AlertMetric[] = [
  "price",
  "ask",
  "bid",
  "changePct",
  "volumeRate",
  "volumeRolling",
  "volume",
  "turnoverRolling"
]

/** 比较方向：`gte` = 达到或高于，`lte` = 达到或低于 */
export type AlertOperator = "gte" | "lte"

/** 判定方式：绝对值阈值 / 相对排行 */
export type AlertJudge = "absolute" | "relative"

/** 相对判定的口径 */
export type AlertRelativeMode = "topN" | "meanMultiple" | "medianMultiple"

export const ALERT_RELATIVE_MODES: readonly AlertRelativeMode[] = ["topN", "meanMultiple", "medianMultiple"]

export interface AlertRule {
  id: string
  /** 独立开关：关掉即不参与评估，但规则本身保留 */
  enabled: boolean
  /** 优先级：数字越小越优先。同一条目命中多条规则时，用优先级最高的那条作为行标记 */
  priority: number
  /** 自定义显示名；留空时页面用指标+条件自动描述 */
  label?: string
  scopeType: AlertScopeType
  /** `category` 时是分类末段（如 equipment）；`item` 时是 hrid */
  scopeValue?: string
  metric: AlertMetric
  operator: AlertOperator
  judge: AlertJudge
  /** `judge = absolute` 时的阈值 */
  threshold?: number
  /** `judge = relative` 时的口径 */
  relativeMode?: AlertRelativeMode
  /** `judge = relative` 时的参数：topN 的 N，或 mean/median 的倍数 k */
  relativeValue?: number
  /** 只考虑「有成交」的条目（默认 true）——否则 3000+ 条零成交记录会把结果淹掉 */
  onlyActive: boolean
  /** 同一条规则对同一物品的重复提醒间隔（分钟）；仅用于浏览器通知去重 */
  cooldownMinutes: number
}

/** 一条命中 */
export interface AlertHit {
  ruleId: string
  /** 命中时规则的显示名（自定义名优先；为空则回退为规则描述 key 所需的信息由页面拼） */
  ruleLabel?: string
  priority: number
  hrid: string
  level: string
  /** 物品名（i18n key 原文） */
  name: string
  metric: AlertMetric
  /** 触发方向。排序时用来判断「越显著」是值越大还是越小 */
  operator: AlertOperator
  /** 实际取到的指标值 */
  value: number
  /** 触发所对照的阈值（绝对值，或相对判定算出来的阈值） */
  threshold: number
  judge: AlertJudge
  relativeMode?: AlertRelativeMode
}

/** 行标记用的 key。**别名**——规范定义在 `marketRowKeyOf`（见 `marketvolume/index.ts`）。 */
export function alertKeyOf(hrid: string, level: string): string {
  return marketRowKeyOf(hrid, level)
}

/** 取某条目某指标的值；取不到（null/undefined/非有限数）返回 null，调用方需跳过 */
export function metricValueOf(item: MarketVolumeItem, metric: AlertMetric): number | null {
  const raw = item[metric as keyof MarketVolumeItem]
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null
  }
  return raw
}

/** 条目是否落在规则的作用范围内 */
export function matchesScope(item: MarketVolumeItem, rule: AlertRule): boolean {
  switch (rule.scopeType) {
    case "category":
      return item.category === rule.scopeValue
    case "item":
      return item.hrid === rule.scopeValue
    default:
      return true
  }
}

/** 该指标在「越高越值得关注」还是「越低越值得关注」上没有先验，方向完全由 `operator` 决定 */
function satisfies(value: number, operator: AlertOperator, threshold: number): boolean {
  return operator === "gte" ? value >= threshold : value <= threshold
}

function mean(values: number[]): number {
  if (!values.length) {
    return 0
  }
  return values.reduce((a, b) => a + b, 0) / values.length
}

function median(values: number[]): number {
  if (!values.length) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** 单条规则的候选集合（范围 + onlyActive + 指标可取到值） */
function candidatesOf(list: MarketVolumeItem[], rule: AlertRule): { item: MarketVolumeItem, value: number }[] {
  const out: { item: MarketVolumeItem, value: number }[] = []
  for (const item of list) {
    if (rule.onlyActive && !(item.volume > 0 || (item.volumeRolling ?? 0) > 0)) {
      continue
    }
    if (!matchesScope(item, rule)) {
      continue
    }
    const value = metricValueOf(item, rule.metric)
    if (value == null) {
      continue
    }
    out.push({ item, value })
  }
  return out
}

/**
 * 评估单条规则，返回命中列表。
 *
 * 相对判定的语义：
 * - `topN`：按指标排序取前 N（`gte` 取最大 N 个，`lte` 取最小 N 个）；命中阈值记为第 N 名的取值。
 * - `meanMultiple` / `medianMultiple`：以候选集合的均值/中位数为基准，阈值 = 基准 × k。
 *   注意基准**从候选集合自身算出**，所以「超过均值 3 倍」永远只在相对意义上成立，
 *   候选集合为空或基准为 0 时不产生命中（避免除零/无意义阈值）。
 */
export function evaluateRule(list: MarketVolumeItem[], rule: AlertRule): AlertHit[] {
  if (!rule.enabled) {
    return []
  }
  const candidates = candidatesOf(list, rule)
  if (!candidates.length) {
    return []
  }

  const base = (hit: { item: MarketVolumeItem, value: number }, threshold: number): AlertHit => ({
    ruleId: rule.id,
    ruleLabel: rule.label,
    priority: rule.priority,
    hrid: hit.item.hrid,
    level: hit.item.level,
    name: hit.item.name,
    metric: rule.metric,
    operator: rule.operator,
    value: hit.value,
    threshold,
    judge: rule.judge,
    relativeMode: rule.judge === "relative" ? rule.relativeMode : undefined
  })

  if (rule.judge === "absolute") {
    const threshold = rule.threshold
    if (threshold == null || !Number.isFinite(threshold)) {
      return []
    }
    return candidates.filter(c => satisfies(c.value, rule.operator, threshold)).map(c => base(c, threshold))
  }

  const n = rule.relativeValue
  if (n == null || !Number.isFinite(n)) {
    return []
  }

  if (rule.relativeMode === "topN") {
    const count = Math.floor(n)
    if (count < 1) {
      return []
    }
    const sorted = [...candidates].sort((a, b) => (rule.operator === "gte" ? b.value - a.value : a.value - b.value))
    const picked = sorted.slice(0, count)
    if (!picked.length) {
      return []
    }
    // 阈值取「最后一名的取值」：这样命中列表与「进了前 N」严格一致
    const threshold = picked[picked.length - 1].value
    return picked.map(c => base(c, threshold))
  }

  if (rule.relativeMode === "meanMultiple" || rule.relativeMode === "medianMultiple") {
    if (n <= 0) {
      return []
    }
    const values = candidates.map(c => c.value)
    const center = rule.relativeMode === "meanMultiple" ? mean(values) : median(values)
    if (!(center > 0)) {
      return []
    }
    const threshold = center * n
    return candidates.filter(c => satisfies(c.value, rule.operator, threshold)).map(c => base(c, threshold))
  }

  return []
}

/**
 * 「越显著」的排序权重。
 *
 * 不能一律按值降序：`lte` 类规则（例如「跌幅 ≥ 20%」）里最该被看到的是**最低**的值，
 * 按降序反而把最温和的排在最前。所以方向由规则的 `operator` 决定。
 */
function notabilityOf(hit: AlertHit): number {
  return hit.operator === "gte" ? hit.value : -hit.value
}

/**
 * 评估全部规则。
 *
 * 同一 (hrid, level) 只保留**一条**落点（按 `priority` 升序、其次显著度降序），
 * 否则一个物品命中多条规则时表格行会拿到互相矛盾的标记；
 * 页面上的「命中明细」仍通过 `evaluateAlertsByRule` 逐条拿全量，不丢信息。
 */
export function evaluateAlerts(list: MarketVolumeItem[], rules: AlertRule[]): AlertHit[] {
  const all: AlertHit[] = []
  for (const rule of rules) {
    all.push(...evaluateRule(list, rule))
  }
  const byRow = new Map<string, AlertHit>()
  for (const hit of all) {
    const key = alertKeyOf(hit.hrid, hit.level)
    const prev = byRow.get(key)
    if (!prev || hit.priority < prev.priority || (hit.priority === prev.priority && notabilityOf(hit) > notabilityOf(prev))) {
      byRow.set(key, hit)
    }
  }
  // 展示顺序：优先级 → 显著度降序，保证同一次评估结果稳定
  return [...byRow.values()].sort((a, b) => a.priority - b.priority || notabilityOf(b) - notabilityOf(a))
}

/** 逐条规则的全量命中（页面「按规则分组」的明细用，不做每行去重） */
export function evaluateAlertsByRule(list: MarketVolumeItem[], rules: AlertRule[]): { rule: AlertRule, hits: AlertHit[] }[] {
  return rules
    .filter(r => r.enabled)
    .map(rule => ({ rule, hits: evaluateRule(list, rule) }))
    .filter(g => g.hits.length > 0)
}

/** 由默认阈值生成的一组预置规则（设置面板里的三个阈值就喂给它们） */
export interface AlertDefaultThresholds {
  /** 涨跌幅阈值（%），会生成「涨幅 ≥ X」「跌幅 ≤ −X」两条规则 */
  changePct: number
  /** 成交量速率阈值（件/小时） */
  volumeRate: number
  /** 时间窗内成交额阈值（金币） */
  turnover: number
}

export const DEFAULT_ALERT_THRESHOLDS: AlertDefaultThresholds = {
  changePct: 20,
  volumeRate: 500,
  turnover: 10000000
}

export const DEFAULT_ALERT_COOLDOWN_MINUTES = 30

let idSeed = 0
/** 生成规则 id（不用 crypto.randomUUID：它在非安全上下文/测试环境里不一定存在） */
export function newAlertRuleId(): string {
  idSeed += 1
  return `rule-${Date.now().toString(36)}-${idSeed}`
}

function baseRule(partial: Partial<AlertRule>): AlertRule {
  return {
    id: newAlertRuleId(),
    enabled: true,
    priority: 100,
    scopeType: "all",
    metric: "volumeRate",
    operator: "gte",
    judge: "absolute",
    onlyActive: true,
    cooldownMinutes: DEFAULT_ALERT_COOLDOWN_MINUTES,
    ...partial
  }
}

/** 由阈值生成预置规则（新建配置时用；已存在的规则不会被覆盖） */
export function createPresetRules(thresholds: AlertDefaultThresholds): AlertRule[] {
  return [
    baseRule({
      priority: 10,
      metric: "changePct",
      operator: "gte",
      threshold: thresholds.changePct
    }),
    baseRule({
      priority: 11,
      metric: "changePct",
      operator: "lte",
      threshold: -Math.abs(thresholds.changePct)
    }),
    baseRule({
      priority: 20,
      metric: "volumeRate",
      operator: "gte",
      threshold: thresholds.volumeRate
    }),
    baseRule({
      priority: 30,
      metric: "turnoverRolling",
      operator: "gte",
      threshold: thresholds.turnover
    })
  ]
}

/** 一条空白规则（页面「新增规则」用） */
export function createEmptyRule(): AlertRule {
  return baseRule({ priority: 100, judge: "absolute", threshold: 0 })
}
