<script lang="ts" setup>
import { getMarketVolumeList, getMarketCategoryOptions, getMarketVolumeSummary, sortMarketVolumeRows, enhanceLevelSuffix, marketRowKeyOf, MARKET_VOLUME_SORT_KEYS, type MarketVolumeItem, type MarketVolumeSortKey } from "@/common/apis/marketvolume"
import { MARKET_RANGE_FIELDS, applyRangeFilters, countActiveRanges, createEmptyRanges, rangeValueOf, type MarketRanges } from "@/common/apis/marketvolume/filters"
import { ALERT_METRICS, alertKeyOf, createEmptyRule, evaluateAlerts, evaluateAlertsByRule, type AlertHit, type AlertMetric, type AlertRule } from "@/common/apis/marketvolume/alerts"
import { recordLocalSample, loadMarketHistory, getMarketChangeMap, getLocalSampleCount, getLastSampleTime, hasRemoteHistory, getHistorySpanHours, getRemoteSampleCount, getVolumeRateDetail, getRollingVolumeDetail, type MarketChangeMetric } from "@/common/apis/marketvolume/history"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import RangeFilter from "@@/components/RangeFilter/index.vue"
import * as Format from "@@/utils/format"
import { QuestionFilled, Star, StarFilled } from "@element-plus/icons-vue"
import { useAlertStore } from "@/pinia/stores/alert"
import { useGameStoreOutside } from "@/pinia/stores/game"
import { useMarketFavoriteStore } from "@/pinia/stores/marketfavorite"
import { useMarketFilterStore } from "@/pinia/stores/marketfilter"
import { useI18n } from "vue-i18n"
import GameInfo from "../dashboard/components/GameInfo.vue"

const { t } = useI18n()
const gameStore = useGameStoreOutside()

// 响应式依赖 store，数据刷新后自动重算
const all = computed(() => {
  void gameStore.marketData
  void gameStore.gameData
  return getMarketVolumeList()
})

const categoryOptions = computed(() => getMarketCategoryOptions(all.value))

const keyword = ref("")
const category = ref("")
// 默认只看有成交：避免 3000+ 条无成交量记录淹没热门物品
const onlyActive = ref(true)
/**
 * 强化等级筛选（官方市场档位 level，0~20）。
 *
 * 装备在官方市场里是**按强化等级分档报价**的，一件装备最多能展开出十几个档位
 * （holy_chisel 有 0/2/3/4/5/6/7/8/10/11/12 共 11 档），所以需要能按档位筛选，
 * 否则「神圣凿子」会在列表里出现十几次。空数组 = 不限。
 */
const enhanceLevels = ref<string[]>([])
const enhanceLevelOptions = computed(() => {
  const set = new Set<string>()
  all.value.forEach((i) => set.add(i.level))
  return Array.from(set).sort((a, b) => Number(a) - Number(b))
})

// 涨跌时间窗（小时）
const WINDOW_OPTIONS = [1, 3, 6, 12, 24, 72, 168]
const windowHours = ref(6)
// 涨跌口径：价格 / 左挂单 / 右收购 / 成交量（成交量比的是增量速率）
const changeMetric = ref<MarketChangeMetric>("price")
const metricOptions = computed(() => [
  { value: "price", label: t("当前价") },
  { value: "ask", label: t("左挂单") },
  { value: "bid", label: t("右收购") },
  { value: "volume", label: `${t("成交量")}(${t("速率")})` }
])
/** 涨跌列表头用的口径名 */
const metricLabel = computed(() => metricOptions.value.find(m => m.value === changeMetric.value)?.label ?? t("当前价"))
// 涨跌方向筛选
const changeDir = ref<"all" | "up" | "down" | "flat">("all")
// 服务端历史加载完成标记（触发涨跌重算）
const historyReady = ref(false)
/** 正在补拉分片（切换时间窗会按需拉更多片） */
const historyLoading = ref(false)
const sampling = ref(false)

/**
 * 按所选时间窗拉取服务端归档分片。
 *
 * 归档按 UTC 6 小时分片，这里只取窗口覆盖到的片（已载入的会缓存），
 * 所以默认 6 小时窗只有 1~2 个请求；把时间窗调到 7 天才会补拉全部 30 片。
 */
async function refreshHistory() {
  historyLoading.value = true
  try {
    await loadMarketHistory(windowHours.value)
  } finally {
    historyReady.value = true
    historyLoading.value = false
  }
}

onMounted(async () => {
  recordLocalSample()
  await refreshHistory()
})

// 时间窗变了要补拉更长/更短范围的历史（已载入的片不会重复请求）
watch(windowHours, () => {
  void refreshHistory()
})

function handleSampleNow() {
  sampling.value = true
  try {
    const added = recordLocalSample(true)
    if (!added) {
      ElMessage.warning(t("本地采样已是最新，无需重复记录"))
    } else {
      ElMessage.success(t("已记录历史采样点"))
    }
  } finally {
    sampling.value = false
  }
}

// 涨跌：当前值 vs 时间窗基准（口径可选，成交量走增量速率）
const changeMap = computed(() => getMarketChangeMap(all.value, windowHours.value, changeMetric.value))
const changeApplied = computed(() =>
  all.value.map((i) => {
    const c = changeMap.value.get(`${i.hrid}|${i.level}`)
    i.changePct = c?.pct ?? null
    i.changeBase = c?.base ?? null
    // 用 detail 版本：除了速率，还拿到「实际用了多长区间」与「是否跨了 UTC 归零点」，
    // 供 UI 解释这个数字的来源（采样稀疏时实际区间会明显大于所选时间窗）
    const d = getVolumeRateDetail(i, windowHours.value)
    i.volumeRate = d?.rate ?? null
    i.volumeRateHours = d?.hours ?? null
    i.volumeRateCrossDay = d?.sameDay === false
    // 时间窗内滚动成交量：把归档上相邻采样点的增量滚起来，因此不受 UTC 归零影响，
    // 表格里的「成交量」列展示的是它（官方当日累计量在列头悬停里作为补充说明）。
    const r = getRollingVolumeDetail(i, windowHours.value)
    i.volumeRolling = r?.volume ?? null
    i.volumeRollingHours = r?.hours ?? null
    i.volumeRollingCoverage = r?.coverage ?? null
    i.turnoverRolling = r && i.price > 0 ? r.volume * i.price : null
    return i
  })
)
/** 当前选中的时间窗是否与「实际用于估算的区间」明显不符（用于给出提示） */
const rateIntervalHint = computed(() => {
  const withRate = changeApplied.value.filter((i) => i.volumeRate != null && i.volumeRateHours != null)
  if (!withRate.length) {
    return null
  }
  const hours = withRate.map((i) => i.volumeRateHours!).sort((a, b) => a - b)
  const median = hours[Math.floor(hours.length / 2)]
  return { median, window: windowHours.value, mismatch: median > windowHours.value * 1.5 }
})
/**
 * 滚动成交量的覆盖率提示。
 * 跨 UTC 归零点的那一段只能统计到 0 点之后，采样越疏丢得越多，
 * 所以这里给出「整列里最低的覆盖率」，低于 100% 时提示原因。
 */
const rollingCoverageHint = computed(() => {
  const rows = changeApplied.value.filter((i) => i.volumeRollingCoverage != null)
  if (!rows.length) {
    return null
  }
  const min = Math.min(...rows.map((i) => i.volumeRollingCoverage!))
  const hours = rows.map((i) => i.volumeRollingHours!).filter((h) => h != null)
  const span = hours.length ? Math.max(...hours) : windowHours.value
  return { min, span, window: windowHours.value, lossy: min < 0.999 }
})
/**
 * 「时间窗内成交量」列头。
 *
 * 用**实际区间**而不是所选时间窗来写列头：两者可能不一致（采样稀疏时实际区间更长；
 * 历史覆盖不足时更短），把它写进列头，数字才不会看起来像「按所选窗口算的」。
 */
const rollingHeaderLabel = computed(() => {
  const span = rollingCoverageHint.value?.span
  if (span == null) {
    return t("时间窗内成交量")
  }
  return `${t("近")} ${span.toFixed(1)} ${t("小时")}${t("成交量")}`
})
/** 历史是否已经能支撑滚动成交量（否则汇总与筛选退回官方当日累计口径） */
const rollingReady = computed(() => changeApplied.value.some((i) => i.volumeRolling != null))
/**
 * 汇总统计。
 * 放在 changeApplied / rollingReady 之后定义（而不是文件顶部）：
 * computed 的取值是惰性的，写前面也能跑，但一旦有人在 setup 阶段就读它就会踩
 * 「block-scoped variable used before declaration」的 TDZ —— 这里已经因此踩过两次坑。
 */
const summary = computed(() =>
  getMarketVolumeSummary(changeApplied.value, rollingReady.value ? "volumeRolling" : "volume")
)

const localCount = computed(() => getLocalSampleCount())
const lastSampleTime = computed(() => {
  const t = getLastSampleTime()
  return t ? new Date(t * 1000).toLocaleString() : "--"
})
// 依赖 historyReady：服务端历史是异步加载的，加载完成后这两个值要跟着刷新
const remoteCount = computed(() => {
  void historyReady.value
  return getRemoteSampleCount()
})
const historySpanHours = computed(() => {
  void historyReady.value
  return getHistorySpanHours()
})

const changeStat = computed(() => {
  let up = 0
  let down = 0
  let flat = 0
  for (const i of changeApplied.value) {
    if (i.changePct == null) {
      continue
    }
    if (i.changePct > 0) {
      up++
    } else if (i.changePct < 0) {
      down++
    } else {
      flat++
    }
  }
  return { up, down, flat }
})

/**
 * 可排序列。`name` 是文本列（按本地化后的名称比较），其余都是数值列。
 *
 * `name` 必须在这个白名单里：`el-table` 给「物品」列标了 `sortable="custom"`，
 * 点表头会派发 `sort-change`，白名单若不认这个 prop，之前的实现会把排序重置成
 * 「成交量降序」——表头箭头变了、数据却没按名称排，看起来就像点了没反应。
 */
const sortKey = ref<MarketVolumeSortKey>("volumeRolling")
const sortOrder = ref<"descending" | "ascending">("descending")

function handleSortChange({ prop, order }: { prop: string, order: string | null }) {
  if (prop && order && (MARKET_VOLUME_SORT_KEYS as readonly string[]).includes(prop)) {
    sortKey.value = prop as MarketVolumeSortKey
    sortOrder.value = order as typeof sortOrder.value
    return
  }
  sortKey.value = "volumeRolling"
  sortOrder.value = "descending"
}

// ---------------- 收藏与区间筛选 ----------------

const favoriteStore = useMarketFavoriteStore()
/**
 * 「隐藏小成交量」（持久设置，见「设置 - 市场监控」）。
 *
 * 与下面的**手动区间筛选**是两回事：这个是长期生效的下限，那个是这次会话里临时手填的条件。
 * 两者会叠加（都满足才留下），互不覆盖。
 */
const marketFilterStore = useMarketFilterStore()
/** 该过滤条件的签名，供分页复位使用（避免把整个 store 放进 watch 数组） */
const volumeFilterSignature = computed(() => `${marketFilterStore.hideLowVolume}:${marketFilterStore.minVolume}`)
/**
 * 只看收藏。
 *
 * 收藏（`marketfavorite` store）是**数据**、会落盘；这个开关只是**视图状态**，
 * 因此刻意不持久化 —— 与旁边同样不落盘的 `onlyActive` / 涨跌方向保持一致。
 */
const onlyFavorite = ref(false)

/** 区间筛选条件。`ranges.xxx` 直接 v-model 给 RangeFilter */
const ranges = ref<MarketRanges>(createEmptyRanges())
const activeRangeCount = computed(() => countActiveRanges(ranges.value))
const rangePanelVisible = ref(false)
/**
 * 区间条件的签名。
 * 分页复位那个 watch 收的是一组 ref，而 `ranges` 是个嵌套对象——直接把对象放进去
 * 需要 `deep: true`（会把整组 watch 都变成深监听）；这里用签名串代替，代价小且精确。
 */
const rangeSignature = computed(() =>
  MARKET_RANGE_FIELDS.map((f) => {
    const r = ranges.value[f]
    return `${f}:${r.mode}:${r.min ?? ""}:${r.max ?? ""}`
  }).join("|")
)

function resetRanges() {
  ranges.value = createEmptyRanges()
}

function toggleFavorite(row: MarketVolumeItem) {
  favoriteStore.toggle(row.hrid, row.level)
}

/** 全站统一的行 key（`hrid|level`），不要在模板里手拼 */
function rowKeyOf(row: MarketVolumeItem) {
  return marketRowKeyOf(row.hrid, row.level)
}

const filtered = computed(() => {
  let r = changeApplied.value
  const kw = keyword.value.trim().toLowerCase()
  if (kw) {
    r = r.filter((i) => t(i.name).toLowerCase().includes(kw) || i.hrid.toLowerCase().includes(kw))
  }
  if (category.value) {
    r = r.filter((i) => i.category === category.value)
  }
  if (enhanceLevels.value.length) {
    r = r.filter((i) => enhanceLevels.value.includes(i.level))
  }
  if (onlyActive.value) {
    // 「有成交」= 今日有累计量，**或**时间窗内有成交。
    // 取并集而不是只看滚动量：窗口选小（默认 6 小时）时只看滚动量会把「今天早些
    // 时候成交过、但最近几小时安静」的物品整批藏掉，默认列表会莫名变短。
    r = r.filter((i) => i.volume > 0 || (i.volumeRolling ?? 0) > 0)
  }
  if (changeDir.value === "up") {
    r = r.filter((i) => i.changePct != null && i.changePct > 0)
  } else if (changeDir.value === "down") {
    r = r.filter((i) => i.changePct != null && i.changePct < 0)
  } else if (changeDir.value === "flat") {
    r = r.filter((i) => i.changePct != null && i.changePct === 0)
  }
  if (onlyFavorite.value) {
    // 收藏粒度 = 行粒度（物品 + 市场档位），这里必须用同一个行 key 判断
    r = r.filter((i) => favoriteStore.has(i.hrid, i.level))
  }
  // 持久设置：隐藏小成交量。取值口径与「成交量」列一致（时间窗内滚动量优先、回退当日累计量），
  // 否则会出现「屏幕上写着 0、却因为底层累计量非 0 而被留下」这种自相矛盾。
  if (marketFilterStore.hideLowVolume) {
    const min = marketFilterStore.minVolume
    r = r.filter((i) => (rangeValueOf(i, "volume") ?? 0) >= min)
  }
  // 区间筛选放最后：前面的条件先缩小集合，再逐条比较数值
  r = applyRangeFilters(r, ranges.value)
  // 排序规则抽到 API 层（sortMarketVolumeRows），便于单测覆盖 NaN/空值沉底等边界
  return sortMarketVolumeRows(r, sortKey.value, sortOrder.value, (n) => t(n))
})

// 分页：避免全量渲染 3000+ 行
const page = ref(1)
const pageSize = ref(50)
const total = computed(() => filtered.value.length)
const list = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
watch(
  [keyword, category, onlyActive, changeDir, windowHours, historyReady, sortKey, sortOrder, all, onlyFavorite, rangeSignature, volumeFilterSignature],
  () => {
    page.value = 1
  }
)

/**
 * 「成交活跃 Top10」。
 *
 * 优先按**成交量/小时（速率）**排序，而不是当日累计量：
 * 累计量每天 UTC 0 点归零，刚过零点时所有物品都只剩很小的数字，
 * 排序会退化成"谁在零点后先成交过"，看不出真实热度。
 * 速率对归零免疫，更能代表"最近多热"。
 * 历史尚未加载（速率拿不到）时，退回按累计量排序。
 */
const top10 = computed(() => {
  // 必须用 changeApplied（已写入 volumeRate 的列表）建立显式依赖：
  // 若读 all，就只依赖 all 本身，volumeRate 是否已算好会变成隐式的时序巧合。
  const active = changeApplied.value.filter((i) => i.volume > 0)
  if (!active.some((i) => i.volumeRate != null)) {
    return [...active].sort((a, b) => b.volume - a.volume).slice(0, 10)
  }
  // 有速率的按速率排；速率相同（或都拿不到）时用累计量兜底
  const rank = (i: MarketVolumeItem) => (i.volumeRate != null ? i.volumeRate : 0)
  return [...active]
    .sort((a, b) => rank(b) - rank(a) || b.volume - a.volume)
    .slice(0, 10)
})
/** Top10 当前是按速率还是按累计量排序（用于标题说明） */
const top10ByRate = computed(() => changeApplied.value.some((i) => i.volumeRate != null))

const marketTime = computed(() => {
  const ts = gameStore.marketData?.timestamp
  return ts ? new Date(ts * 1000).toLocaleString() : "--"
})

// ---------------- 市场提醒 ----------------

const alertStore = useAlertStore()
const alertRules = computed<AlertRule[]>(() => alertStore.rules)
const inPageAlertEnabled = computed(() => alertStore.inPageEnabled)
const notifyEnabled = computed(() => alertStore.notifyEnabled)

/**
 * 命中评估。
 *
 * 输入用 `changeApplied`：提醒依赖的 changePct / volumeRate / volumeRolling / turnoverRolling
 * 都是页面在上一步回填的，用 `all` 会拿到还没算好的值。
 * 只在「页面内提醒」开启时才评估——关闭后既不高亮也不通知，同时省掉每轮的全量评估开销。
 */
const alertHits = computed<AlertHit[]>(() =>
  inPageAlertEnabled.value ? evaluateAlerts(changeApplied.value, alertRules.value) : []
)
/** 逐条规则的全量命中（「展开明细」用，不做每行去重） */
const alertGroups = computed(() =>
  inPageAlertEnabled.value ? evaluateAlertsByRule(changeApplied.value, alertRules.value) : []
)
const alertHitMap = computed(() => {
  const map = new Map<string, AlertHit>()
  for (const hit of alertHits.value) {
    map.set(alertKeyOf(hit.hrid, hit.level), hit)
  }
  return map
})
const alertCount = computed(() => alertHits.value.length)
const alertExpanded = ref(false)
const enabledRuleCount = computed(() => alertRules.value.filter(r => r.enabled).length)

/** 指标显示名与取值格式 */
const ALERT_METRIC_LABEL_KEYS: Record<AlertMetric, string> = {
  price: "价格",
  ask: "左挂单",
  bid: "右收购",
  changePct: "涨跌",
  volumeRate: "成交量速率",
  volumeRolling: "时间窗内成交量",
  volume: "当日累计成交量",
  turnoverRolling: "时间窗内成交额"
}
function alertMetricLabel(metric: AlertMetric) {
  return t(ALERT_METRIC_LABEL_KEYS[metric])
}
function formatAlertValue(metric: AlertMetric, value: number) {
  if (metric === "changePct") {
    return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
  }
  if (metric === "volumeRate") {
    return `${Format.number(value, 0)}/h`
  }
  return Format.number(value, 0)
}

/** 每行要显示的提醒标签（提前拼好，避免模板里反复调函数） */
const alertLabelMap = computed(() => {
  const map = new Map<string, string>()
  for (const hit of alertHits.value) {
    map.set(alertKeyOf(hit.hrid, hit.level), `${alertMetricLabel(hit.metric)} ${formatAlertValue(hit.metric, hit.value)}`)
  }
  return map
})

/** 表格行高亮 */
function rowClassName({ row }: { row: MarketVolumeItem }) {
  return alertHitMap.value.has(alertKeyOf(row.hrid, row.level)) ? "alert-row" : ""
}

/** 规则面板 */
const ruleDrawerVisible = ref(false)
function addAlertRule() {
  alertStore.addRule(createEmptyRule())
}
function removeAlertRule(id: string) {
  alertStore.removeRule(id)
}
/** hrid → 物品名（i18n key 原文），把规则的「指定物品」显示成人话 */
const hridNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const i of all.value) {
    if (!map.has(i.hrid)) {
      map.set(i.hrid, i.name)
    }
  }
  return map
})
/** 「指定物品」下拉的可选项（同名只留一个，按本地化后的名字排序） */
const alertItemOptions = computed(() => {
  const seen = new Map<string, string>()
  for (const i of all.value) {
    if (!seen.has(i.hrid)) {
      seen.set(i.hrid, i.name)
    }
  }
  return [...seen.entries()]
    .map(([hrid, name]) => ({ hrid, name }))
    .sort((a, b) => t(a.name).localeCompare(t(b.name)))
})

/** 规则的一句话描述（规则名留空时用它） */
function describeAlertRule(rule: AlertRule) {
  let scope = t("全部物品")
  if (rule.scopeType === "category") {
    scope = `${t("分类")}：${rule.scopeValue ? t(rule.scopeValue) : "--"}`
  } else if (rule.scopeType === "item") {
    const name = rule.scopeValue ? (hridNameMap.value.get(rule.scopeValue) ?? rule.scopeValue) : "--"
    scope = `${t("物品")}：${t(name)}`
  }
  let cond: string
  if (rule.judge === "relative") {
    const modeLabel = rule.relativeMode === "topN"
      ? t("前 N 名")
      : rule.relativeMode === "meanMultiple" ? t("超过均值倍数") : t("超过中位数倍数")
    cond = `${modeLabel} ${rule.relativeValue ?? "--"}`
  } else {
    cond = `${rule.operator === "gte" ? "≥" : "≤"} ${rule.threshold ?? "--"}`
  }
  return `${scope} · ${alertMetricLabel(rule.metric)} ${cond}`
}

/**
 * 浏览器通知。
 *
 * 只对「新出现的命中」发，并按每条规则的冷却时间对同一 (规则, 物品) 去重——
 * 行情每次刷新都会重算 changeApplied，若不做这两层过滤，页面开着时会一直弹。
 */
const notifiedAtMap = new Map<string, number>()
const ruleById = computed(() => new Map(alertRules.value.map(r => [r.id, r])))
function pushBrowserNotifications(hits: AlertHit[]) {
  if (!notifyEnabled.value || typeof Notification === "undefined" || Notification.permission !== "granted") {
    return
  }
  const now = Date.now()
  const fresh: AlertHit[] = []
  for (const hit of hits) {
    const key = `${hit.ruleId}|${hit.hrid}|${hit.level}`
    const cooldownMinutes = ruleById.value.get(hit.ruleId)?.cooldownMinutes ?? alertStore.cooldownMinutes
    if (now - (notifiedAtMap.get(key) ?? 0) < Math.max(0, cooldownMinutes) * 60_000) {
      continue
    }
    notifiedAtMap.set(key, now)
    fresh.push(hit)
  }
  if (!fresh.length) {
    return
  }
  if (fresh.length === 1) {
    const hit = fresh[0]
    // 用 `void` 承接结果：Notification 的返回值无用，但直接 `new Notification(...)` 作为
    // 表达式语句会被 no-new 判为"为副作用而 new"。
    void new Notification(t("市场提醒"), {
      body: `${t(hit.name)} ${alertMetricLabel(hit.metric)} ${formatAlertValue(hit.metric, hit.value)}`
    })
    return
  }
  void new Notification(t("市场提醒"), { body: t("有 {0} 条新的市场提醒", [fresh.length]) })
}

// 只在「命中集合的形状」变化时通知（只改数值不重复弹）
watch(
  () => alertHits.value.map(h => `${h.ruleId}|${h.hrid}|${h.level}`).join(","),
  () => pushBrowserNotifications(alertHits.value)
)

function fmtCount(value: number) {
  return Format.number(value, 0)
}
</script>

<template>
  <div>
    <GameInfo />
    <el-card>
      <template #header>
        <div class="flex items-center gap-2">
          <span>{{ t("市场监控") }}</span>
          <span class="text-sm text-gray-400">{{ t("监控各物品市场成交量与成交额，成交量按时间窗滚动统计") }}</span>
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-380px leading-5">
                {{ t("市场监控口径说明") }}
              </div>
            </template>
            <el-icon class="cursor-help color-gray-400">
              <QuestionFilled />
            </el-icon>
          </el-tooltip>
        </div>
      </template>

      <!-- 采样稀疏时的区间提示：选的时间窗与实际估算区间不一致时说明清楚 -->
      <el-alert
        v-if="rateIntervalHint && rateIntervalHint.mismatch"
        type="info"
        :closable="false"
        show-icon
        class="mb-2"
      >
        <template #title>
          {{ t("成交量速率区间提示", [rateIntervalHint.median.toFixed(1), rateIntervalHint.window]) }}
        </template>
      </el-alert>

      <!-- 滚动成交量的覆盖率提示：跨 UTC 归零点的那段统计不全 -->
      <el-alert
        v-if="rollingCoverageHint && rollingCoverageHint.lossy"
        type="info"
        :closable="false"
        show-icon
        class="mb-2"
      >
        <template #title>
          {{ t("滚动成交量覆盖率提示", [(rollingCoverageHint.min * 100).toFixed(0), rollingCoverageHint.span.toFixed(1)]) }}
        </template>
      </el-alert>

      <!-- 提醒命中横幅：只在「页面内提醒」开启且确有命中时出现 -->
      <el-alert
        v-if="inPageAlertEnabled && alertCount"
        type="warning"
        :closable="false"
        show-icon
        class="mb-2"
      >
        <template #title>
          <div class="flex flex-wrap items-center gap-2">
            <span>{{ t("命中 {0} 条市场提醒", [alertCount]) }}</span>
            <el-button size="small" text type="primary" @click="alertExpanded = !alertExpanded">
              {{ alertExpanded ? t("收起明细") : t("展开明细") }}
            </el-button>
            <el-button size="small" text type="primary" @click="ruleDrawerVisible = true">
              {{ t("提醒规则") }}
            </el-button>
            <span v-if="!notifyEnabled" class="text-xs text-gray-400">
              {{ t("浏览器通知未开启（可在右侧「设置」里打开）") }}
            </span>
          </div>
        </template>
        <div v-if="alertExpanded" class="alert-detail">
          <div v-for="g in alertGroups" :key="g.rule.id" class="alert-detail-group">
            <div class="alert-detail-rule">
              {{ g.rule.label || describeAlertRule(g.rule) }}
              <span class="text-gray-400"> · {{ t("命中 {0} 条", [g.hits.length]) }}</span>
            </div>
            <div class="alert-detail-items">
              <span v-for="h in g.hits.slice(0, 20)" :key="alertKeyOf(h.hrid, h.level)" class="alert-detail-item">
                {{ t(h.name) }}<template v-if="enhanceLevelSuffix(h.level)"> {{ enhanceLevelSuffix(h.level) }}</template>
                <span class="alert-detail-value">{{ formatAlertValue(h.metric, h.value) }}</span>
              </span>
              <span v-if="g.hits.length > 20" class="text-gray-400">{{ t("等共 {0} 条", [g.hits.length]) }}</span>
            </div>
          </div>
        </div>
      </el-alert>

      <!-- 摘要 -->
      <el-row :gutter="12">
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">{{ t("市场物品") }}</div>
            <div class="stat-value">{{ fmtCount(summary.total) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">
              {{ t("有成交") }}
              <span class="text-gray-400 font-normal">· {{ rollingReady ? t("时间窗内") : t("今日累计") }}</span>
            </div>
            <div class="stat-value success">{{ fmtCount(summary.active) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">{{ t("成交量最高") }}</div>
            <div class="stat-value text-sm" v-if="summary.topVolume">
              {{ t(summary.topVolume.name) }}<span
                v-if="enhanceLevelSuffix(summary.topVolume.level)"
                class="text-gray-400"
              > {{ enhanceLevelSuffix(summary.topVolume.level) }}</span>
              <span class="text-gray-400"> · {{ fmtCount(summary.topVolume.volumeRolling ?? summary.topVolume.volume) }}</span>
            </div>
            <div class="stat-value" v-else>--</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">{{ t("数据时间") }}</div>
            <div class="stat-value text-sm">{{ marketTime }}</div>
          </div>
        </el-col>
      </el-row>

      <!-- 成交活跃 Top10 -->
      <div class="mt-3">
        <div class="text-sm font-semibold mb-2">
          {{ t("成交活跃 Top10") }}
          <span class="text-gray-400 font-normal">
            · {{ top10ByRate ? t("按成交量速率排序") : t("按当日累计成交量排序") }}
          </span>
        </div>
        <div class="top10-grid">
          <div v-for="(i, idx) in top10" :key="i.hrid + i.level" class="top10-item" :class="{ 'top3': idx < 3 }">
            <ItemIcon :hrid="i.hrid" :width="22" :height="22" />
            <span class="top10-rank">{{ idx + 1 }}</span>
            <span class="top10-name">{{ t(i.name) }}<span v-if="enhanceLevelSuffix(i.level)" class="text-gray-400"> {{ enhanceLevelSuffix(i.level) }}</span></span>
            <!-- 按速率排序时展示速率，否则展示累计量，与排序口径保持一致 -->
            <span class="top10-vol">
              {{ top10ByRate && i.volumeRate != null ? `${Format.number(i.volumeRate, 0)}/h` : fmtCount(i.volume) }}
            </span>
          </div>
        </div>
        <el-empty v-if="!top10.length" :description="t('暂无数据，请等待市场数据加载')" :image-size="60" />
      </div>
    </el-card>

    <!-- 明细表格 -->
    <el-card class="mt-3">
      <template #header>
        <div class="flex flex-wrap items-center gap-2">
          <el-input v-model="keyword" :placeholder="t('搜索物品')" clearable style="width: 220px" />
          <el-select v-model="category" :placeholder="t('分类')" clearable filterable style="width: 160px">
            <el-option v-for="c in categoryOptions" :key="c" :label="t(c)" :value="c" />
          </el-select>
          <el-select
            v-model="enhanceLevels"
            :placeholder="t('强化等级')"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            style="width: 200px"
          >
            <el-option v-for="lv in enhanceLevelOptions" :key="lv" :label="lv === '0' ? t('未强化') : `+${lv}`" :value="lv" />
          </el-select>
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-380px leading-5">{{ t('强化等级说明') }}</div>
            </template>
            <el-icon class="cursor-help color-gray-400">
              <QuestionFilled />
            </el-icon>
          </el-tooltip>
          <el-switch v-model="onlyActive" :active-text="t('只看有成交')" />
          <el-switch
            v-model="onlyFavorite"
            :active-text="favoriteStore.count ? `${t('只看收藏')} (${favoriteStore.count})` : t('只看收藏')"
          />
          <!-- 持久过滤（设置面板与这里读写同一份 store 状态，改哪边都同步） -->
          <el-switch
            v-model="marketFilterStore.hideLowVolume"
            :active-text="`${t('隐藏小成交量')} (<${marketFilterStore.minVolume})`"
          />
          <el-button
            size="small"
            :type="activeRangeCount ? 'primary' : 'default'"
            @click="rangePanelVisible = !rangePanelVisible"
          >
            {{ t("区间筛选") }}<template v-if="activeRangeCount"> ({{ activeRangeCount }})</template>
          </el-button>
        </div>
        <div class="flex flex-wrap items-center gap-2 mt-2">
          <span class="text-sm text-gray-400">{{ t("时间窗") }}</span>
          <el-radio-group v-model="windowHours" size="small">
            <el-radio-button v-for="w in WINDOW_OPTIONS" :key="w" :value="w">{{ w }}{{ t("小时") }}</el-radio-button>
          </el-radio-group>
          <span class="text-sm text-gray-400">{{ t("对比口径") }}</span>
          <el-select v-model="changeMetric" size="small" style="width: 150px">
            <el-option v-for="m in metricOptions" :key="m.value" :label="m.label" :value="m.value" />
          </el-select>
          <el-select v-model="changeDir" size="small" style="width: 110px">
            <el-option :label="t('全部涨跌')" value="all" />
            <el-option :label="t('上涨')" value="up" />
            <el-option :label="t('下跌')" value="down" />
            <el-option :label="t('持平')" value="flat" />
          </el-select>
          <span class="text-xs text-gray-400">
            {{ t("涨") }} <span class="up">{{ changeStat.up }}</span> ·
            {{ t("跌") }} <span class="down">{{ changeStat.down }}</span> ·
            {{ t("平") }} <span class="flat">{{ changeStat.flat }}</span>
          </span>
          <div class="flex-1" />
          <el-button size="small" :loading="sampling" @click="handleSampleNow">{{ t("立即采样") }}</el-button>
          <el-button size="small" @click="ruleDrawerVisible = true">
            {{ t("提醒规则") }}<template v-if="alertCount"> ({{ alertCount }})</template>
          </el-button>
          <span class="text-xs text-gray-400">
            {{ t("历史采样点") }}：{{ localCount }}<template v-if="hasRemoteHistory()"> + {{ t("线上历史") }} {{ remoteCount }}</template>
            · {{ t("覆盖") }} {{ historySpanHours.toFixed(1) }}{{ t("小时") }}
            · {{ t("最近采样") }}：{{ lastSampleTime }}
            <template v-if="historyLoading"> · {{ t("正在加载历史分片…") }}</template>
          </span>
        </div>
        <div v-if="!hasRemoteHistory()" class="text-xs text-gray-400 mt-1">
          {{ t("无线上历史提示") }}
        </div>
        <!-- 区间筛选：对数值列做「不低于 / 不高于 / 在两者之间」的筛选 -->
        <div v-if="rangePanelVisible" class="range-panel">
          <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
            <RangeFilter v-model="ranges.changePct" :label="t('涨跌幅')" unit="%" :step="1" :precision="2" :min="-100" />
            <RangeFilter v-model="ranges.volume" :label="t('成交量')" :unit="t('件')" :step="100" :min="0" />
            <RangeFilter v-model="ranges.turnover" :label="t('成交额')" :unit="t('金币')" :step="1000000" :min="0" />
            <RangeFilter v-model="ranges.volumeRate" :label="t('成交量速率')" :unit="`${t('件')}/${t('小时')}`" :step="100" :min="0" />
            <RangeFilter v-model="ranges.price" :label="t('价格')" :unit="t('金币')" :step="100" :min="0" />
          </div>
          <div class="flex flex-wrap items-center gap-2 mt-2">
            <span class="text-xs text-gray-400">{{ t("区间筛选说明") }}</span>
            <div class="flex-1" />
            <el-button size="small" :disabled="!activeRangeCount" @click="resetRanges">{{ t("清空区间") }}</el-button>
          </div>
        </div>
      </template>

      <el-table :data="list" size="small" :default-sort="{ prop: 'volumeRolling', order: 'descending' }" :row-class-name="rowClassName" @sort-change="handleSortChange">
        <!-- 收藏列：收藏粒度 = 行粒度（物品 + 市场档位），点星标切换 -->
        <el-table-column width="46" align="center">
          <template #header>
            <el-tooltip placement="top" effect="light" :show-after="120">
              <template #content>
                <div class="max-w-380px leading-5">{{ t('收藏说明') }}</div>
              </template>
              <el-icon class="cursor-help color-gray-400">
                <QuestionFilled />
              </el-icon>
            </el-tooltip>
          </template>
          <template #default="{ row }">
            <el-link
              :underline="false"
              type="warning"
              class="favorite-star"
              :class="{ 'is-favorite': favoriteStore.has(row.hrid, row.level) }"
              :icon="favoriteStore.has(row.hrid, row.level) ? StarFilled : Star"
              @click="toggleFavorite(row)"
            />
          </template>
        </el-table-column>
        <el-table-column width="44">
          <template #default="{ row }">
            <ItemIcon :hrid="row.hrid" />
          </template>
        </el-table-column>
        <el-table-column :label="t('物品')" min-width="170" sortable="custom" prop="name">
          <template #default="{ row }">
            <span>{{ t(row.name) }}</span>
            <!-- 市场档位 level 是**强化等级**（官方 0~20），不是物品等级：
                 这里必须用 level，且用全站统一的 "+N" 写法。
                 原实现显示的是 itemLevel（例如神圣凿子恒为 80），于是同一件装备的
                 11 个强化档（holy_chisel 有 0/2/3/4/5/6/7/8/10/11/12）全部渲染成
                 一模一样的「神圣凿子 Lv80」，既看不出是强化档，也互相无法区分。 -->
            <el-tag v-if="enhanceLevelSuffix(row.level)" size="small" type="warning" effect="plain" class="ml-1">
              {{ enhanceLevelSuffix(row.level) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="category" :label="t('分类')" min-width="100">
          <template #default="{ row }">
            <el-tag size="small" type="info">{{ t(row.category) }}</el-tag>
          </template>
        </el-table-column>
        <!-- 提醒列：命中时给出「哪条规则式的条件被触发」的最短信息，未命中留空 -->
        <el-table-column :label="t('提醒')" min-width="150">
          <template #default="{ row }">
            <el-tag v-if="alertLabelMap.get(rowKeyOf(row))" size="small" type="danger" effect="plain">
              {{ alertLabelMap.get(rowKeyOf(row)) }}
            </el-tag>
            <span v-else class="text-gray-400">--</span>
          </template>
        </el-table-column>
        <el-table-column prop="itemLevel" :label="t('物品等级')" align="center" min-width="80" sortable="custom">
          <template #header>
            <div class="flex items-center justify-center gap-1">
              <span>{{ t('物品等级') }}</span>
              <el-tooltip placement="top" effect="light" :show-after="120">
                <template #content>
                  <div class="max-w-380px leading-5">{{ t('物品等级说明') }}</div>
                </template>
                <el-icon class="cursor-help color-gray-400">
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="price" :label="t('价格')" align="right" min-width="100" sortable="custom">
          <template #default="{ row }">{{ row.price > 0 ? Format.number(row.price, 0) : "--" }}</template>
        </el-table-column>
        <el-table-column prop="changePct" :label="`${t('涨跌')}(${t(metricLabel)})`" align="right" min-width="130" sortable="custom">
          <template #default="{ row }">
            <span v-if="row.changePct == null" class="text-gray-400">--</span>
            <span v-else :class="row.changePct > 0 ? 'up' : row.changePct < 0 ? 'down' : 'flat'">
              {{ row.changePct > 0 ? "+" : "" }}{{ row.changePct.toFixed(2) }}%
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="ask" :label="t('卖价')" align="right" min-width="100" sortable="custom">
          <template #default="{ row }">{{ row.ask > 0 ? Format.number(row.ask, 0) : "--" }}</template>
        </el-table-column>
        <el-table-column prop="bid" :label="t('买价')" align="right" min-width="100" sortable="custom">
          <template #default="{ row }">{{ row.bid > 0 ? Format.number(row.bid, 0) : "--" }}</template>
        </el-table-column>
        <el-table-column prop="volumeRolling" :label="rollingHeaderLabel" align="right" min-width="150" sortable="custom">
          <template #header>
            <div class="flex items-center justify-end gap-1">
              <span>{{ rollingHeaderLabel }}</span>
              <el-tooltip placement="top" effect="light" :show-after="120">
                <template #content>
                  <div class="max-w-380px leading-5">{{ t('滚动成交量说明') }}</div>
                </template>
                <el-icon class="cursor-help color-gray-400">
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </div>
          </template>
          <template #default="{ row }">
            <span v-if="row.volumeRolling == null" class="text-gray-400">--</span>
            <span v-else :class="row.volumeRolling > 0 ? 'success' : 'text-gray-400'">{{ fmtCount(row.volumeRolling) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="volumeRate" :label="`${t('成交量')}/${t('小时')}`" align="right" min-width="120" sortable="custom">
          <template #header>
            <div class="flex items-center justify-end gap-1">
              <span>{{ t('成交量') }}/{{ t('小时') }}</span>
              <el-tooltip placement="top" effect="light" :show-after="120">
                <template #content>
                  <div class="max-w-380px leading-5">{{ t('成交量速率口径说明') }}</div>
                </template>
                <el-icon class="cursor-help color-gray-400">
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </div>
          </template>
          <template #default="{ row }">
            <span v-if="row.volumeRate == null" class="text-gray-400">--</span>
            <span v-else>{{ Format.number(row.volumeRate, 0) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="turnoverRolling" :label="`${t('成交额')}(${t('时间窗内')})`" align="right" min-width="140" sortable="custom">
          <template #header>
            <div class="flex items-center justify-end gap-1">
              <span>{{ t('成交额') }}({{ t('时间窗内') }})</span>
              <el-tooltip placement="top" effect="light" :show-after="120">
                <template #content>
                  <div class="max-w-380px leading-5">{{ t('滚动成交额说明') }}</div>
                </template>
                <el-icon class="cursor-help color-gray-400">
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </div>
          </template>
          <template #default="{ row }">
            <span v-if="row.turnoverRolling == null" class="text-gray-400">--</span>
            <span v-else>{{ row.turnoverRolling > 0 ? Format.number(row.turnoverRolling, 0) : "--" }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="mt-2 flex justify-end">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[20, 50, 100, 200]"
          layout="total, sizes, prev, pager, next"
          background
        />
      </div>
    </el-card>

    <!-- 提醒规则面板：规则多条、彼此独立（各自的开关/优先级/条件/阈值） -->
    <el-drawer v-model="ruleDrawerVisible" :title="t('市场提醒规则')" size="560px">
      <div class="text-xs text-gray-400 mb-3 leading-5">
        {{ t("规则说明") }}
      </div>
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <el-button size="small" type="primary" @click="addAlertRule">{{ t("新增规则") }}</el-button>
        <span class="text-xs text-gray-400">
          {{ t("共 {0} 条，已启用 {1} 条", [alertRules.length, enabledRuleCount]) }}
        </span>
      </div>

      <div v-for="rule in alertRules" :key="rule.id" class="alert-rule">
        <div class="flex flex-wrap items-center gap-2">
          <el-switch v-model="rule.enabled" size="small" />
          <el-input v-model="rule.label" size="small" :placeholder="t('规则名（可空）')" style="width: 140px" />
          <span class="text-xs text-gray-400">{{ t("优先级") }}</span>
          <el-input-number v-model="rule.priority" size="small" :min="0" :max="999" controls-position="right" style="width: 110px" />
          <div class="flex-1" />
          <el-button size="small" type="danger" text @click="removeAlertRule(rule.id)">{{ t("删除") }}</el-button>
        </div>

        <div class="flex flex-wrap items-center gap-2 mt-2">
          <el-select v-model="rule.scopeType" size="small" style="width: 110px">
            <el-option :label="t('全部物品')" value="all" />
            <el-option :label="t('按分类')" value="category" />
            <el-option :label="t('指定物品')" value="item" />
          </el-select>
          <el-select
            v-if="rule.scopeType === 'category'"
            v-model="rule.scopeValue"
            size="small"
            clearable
            filterable
            :placeholder="t('分类')"
            style="width: 150px"
          >
            <el-option v-for="c in categoryOptions" :key="c" :label="t(c)" :value="c" />
          </el-select>
          <el-select
            v-if="rule.scopeType === 'item'"
            v-model="rule.scopeValue"
            size="small"
            clearable
            filterable
            :placeholder="t('物品')"
            style="width: 200px"
          >
            <el-option v-for="i in alertItemOptions" :key="i.hrid" :label="t(i.name)" :value="i.hrid" />
          </el-select>
          <el-select v-model="rule.metric" size="small" style="width: 170px">
            <el-option v-for="m in ALERT_METRICS" :key="m" :label="alertMetricLabel(m)" :value="m" />
          </el-select>
          <el-select v-model="rule.operator" size="small" style="width: 110px">
            <el-option :label="t('达到或高于')" value="gte" />
            <el-option :label="t('达到或低于')" value="lte" />
          </el-select>
        </div>

        <div class="flex flex-wrap items-center gap-2 mt-2">
          <el-select v-model="rule.judge" size="small" style="width: 120px">
            <el-option :label="t('绝对值')" value="absolute" />
            <el-option :label="t('相对排行')" value="relative" />
          </el-select>
          <el-input-number
            v-if="rule.judge === 'absolute'"
            v-model="rule.threshold"
            size="small"
            controls-position="right"
            style="width: 170px"
          />
          <template v-else>
            <el-select v-model="rule.relativeMode" size="small" style="width: 170px">
              <el-option :label="t('前 N 名')" value="topN" />
              <el-option :label="t('超过均值倍数')" value="meanMultiple" />
              <el-option :label="t('超过中位数倍数')" value="medianMultiple" />
            </el-select>
            <el-input-number v-model="rule.relativeValue" size="small" :min="0" controls-position="right" style="width: 130px" />
          </template>
          <el-checkbox v-model="rule.onlyActive" size="small">{{ t("只看有成交") }}</el-checkbox>
          <span class="text-xs text-gray-400">{{ t("冷却(分)") }}</span>
          <el-input-number v-model="rule.cooldownMinutes" size="small" :min="0" :max="1440" controls-position="right" style="width: 110px" />
        </div>

        <div class="alert-rule-desc">{{ describeAlertRule(rule) }}</div>
      </div>

      <el-empty
        v-if="!alertRules.length"
        :description="t('还没有规则：点「新增规则」，或到右侧「设置 - 市场提醒」按默认阈值重建预置规则')"
        :image-size="60"
      />
    </el-drawer>
  </div>
</template>

<style scoped>
.stat-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 10px 14px;
}
.stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}
.stat-value {
  font-size: 18px;
  font-weight: 600;
}
.top10-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 6px;
}
.top10-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  font-size: 13px;
}
.top10-item.top3 {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.top10-rank {
  min-width: 16px;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.top10-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.top10-vol {
  color: var(--el-color-success);
  font-weight: 600;
}
/* 涨跌配色：红涨绿跌（A 股习惯） */
.up {
  color: #f56c6c;
  font-weight: 600;
}
.down {
  color: #67c23a;
  font-weight: 600;
}
.flat {
  color: var(--el-text-color-secondary);
}
/* 提醒命中行的底色。Element Plus 的行底色取自 --el-table-tr-bg-color，
   只写 background 会被它盖掉，因此两个都设。 */
:deep(.el-table .alert-row) {
  --el-table-tr-bg-color: var(--el-color-danger-light-9);
}
:deep(.el-table .alert-row > td.el-table__cell) {
  background: var(--el-color-danger-light-9);
}
.alert-detail {
  padding-top: 4px;
}
.alert-detail-group + .alert-detail-group {
  margin-top: 6px;
}
.alert-detail-rule {
  font-size: 12px;
  font-weight: 600;
}
.alert-detail-items {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 12px;
  margin-top: 2px;
}
.alert-detail-item {
  white-space: nowrap;
}
.alert-detail-value {
  color: var(--el-color-danger);
  font-weight: 600;
}
.alert-rule {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 10px;
}
.alert-rule + .alert-rule {
  margin-top: 10px;
}
.alert-rule-desc {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed var(--el-border-color-lighter);
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
/* 区间筛选面板：浅底与表头上方分隔，避免和筛选控件挤成一片 */
.range-panel {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
}
/* 收藏星标：未收藏用常规字号，已收藏略放大以强化「已标记」的对比 */
.favorite-star {
  font-size: 18px;
  line-height: 1;
}
.favorite-star.is-favorite {
  font-size: 20px;
}
</style>
