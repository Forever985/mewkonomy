import { getMarketDataApi } from "@/common/apis/game"
import { watch } from "vue"
import type { MarketVolumeItem } from "./index"

/**
 * 市场历史采样与涨跌计算
 *
 * 涨跌需要「时间窗起点」的历史数据作基准，而官方 marketplace.json 只提供当前快照，
 * 因此本模块维护两条历史采样通道（格式统一为 MarketPriceSample，可合并计算）：
 * 1. 服务端归档：GitHub Actions 定时拉取官方 marketplace.json 追加到
 *    public/data/market_history.json（**滚动保留最近 7 天**），前端 fetch 使用。
 *    见 .github/workflows/market-history.yml + scripts/sample_market_history.py
 *    ⚠️ Actions 的 schedule 是 best-effort 的：本仓库声明每小时一次，实测相邻
 *    间隔 143~466 分钟（中位 307），全部运行都 success —— 是**触发器被延迟**，
 *    不是脚本失败。所以不能只依赖它。
 * 2. 本地兜底 + **真正的每小时采样**：页面直连官方 marketplace.json（main.ts 里
 *    每 60s 轮询），快照每次前进（官方是整点小时粒度）就记一个点。
 *    这条通道只要页面开着就精确到小时，不受 Actions 延迟影响，见
 *    `startMarketAutoSampling`。localStorage 上限 200 条 ≥ 7 天 × 24 点 = 168。
 *
 * 采样点结构（**两种长度都要兼容**）：
 *   { t: epoch秒, p: { hrid: { level: [ask, price] } } }            ← 早期版本只存两个
 *   { t: epoch秒, p: { hrid: { level: [ask, bid, volume] } } }      ← 现行版本存三个
 * 因此读取一律走 valueAt() / priceOf()，不要直接下标。
 *
 * volume 语义提醒：官方 `v` 是**当日累计成交量**（每天 UTC 0 点归零），
 * 所以成交量对比要看「增量 / 速率」，不能直接比绝对值；界面上的「时间窗内成交量」
 * 用 `getRollingVolumeDetail` 把增量滚动累加起来，因而没有归零问题。
 */

/** 单个价格档的原始三元组：旧格式为 [ask, price]，新格式为 [ask, bid, volume] */
export type SampleLevel = [number, number] | [number, number, number]

export interface MarketPriceSample {
  /** 采样时间（epoch 秒，与 marketplace.json 的 timestamp 同口径） */
  t: number
  /** hrid → level → [ask(, bid, volume)] */
  p: Record<string, Record<string, SampleLevel>>
}

/** 涨跌口径 */
export type MarketChangeMetric = "price" | "ask" | "bid" | "volume"

export interface MarketChange {
  /** 基准值（volume 口径下为基准采样点的累计成交量） */
  base: number
  /** 当前值 */
  current: number
  /** 涨跌百分比（相对基准）。volume 口径下为「增量速率」变化，而非累计值变化 */
  pct: number
  /** 采样间隔（小时），仅 volume 口径使用 */
  hours?: number
  /** 成交量增量（仅 volume 口径；为负说明跨了 UTC 归零点，已判为无效） */
  deltaVolume?: number
}

const HISTORY_FILE_URL = `${import.meta.env.BASE_URL}data/market_history.json`
const LOCAL_KEY = "mewkonomy-market-history"
/** 本地兜底采样节流间隔 */
const LOCAL_INTERVAL_SEC = 30 * 60
/**
 * 本地兜底保留条数上限。
 * 上限按「7 天 × 每小时 1 点 = 168」再留余量取 200：官方快照是整点小时粒度，
 * 页面自动采样（见 startMarketAutoSampling）最多产出 168 个点，不会触顶。
 */
const LOCAL_MAX_SAMPLES = 200
/** 历史保留窗口：与服务端一致，7 天 */
const HISTORY_WINDOW_SEC = 7 * 24 * 3600

const storage: Storage | null = typeof localStorage !== "undefined" ? localStorage : null

let remoteSamples: MarketPriceSample[] | null = null
let localSamples: MarketPriceSample[] = readLocal()
/** `getMarketHistory()` 的合并结果缓存，样本变化时置空 */
let mergedCache: MarketPriceSample[] | null = null

/** 越过这个点数就该考虑清理，避免 localStorage 长期膨胀 */
export function getHistoryWindowHours(): number {
  return Math.round(HISTORY_WINDOW_SEC / 3600)
}

function readLocal(): MarketPriceSample[] {
  if (!storage) {
    return []
  }
  try {
    const raw = storage.getItem(LOCAL_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as MarketPriceSample[]
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s.t === "number" && s.p) : []
  } catch {
    return []
  }
}

function writeLocal(samples: MarketPriceSample[]) {
  if (!storage) {
    return
  }
  try {
    storage.setItem(LOCAL_KEY, JSON.stringify(samples))
  } catch {
    // 容量超限：丢弃最旧一半再试一次
    try {
      storage.setItem(LOCAL_KEY, JSON.stringify(samples.slice(-Math.floor(samples.length / 2))))
    } catch {
      // 忽略：降级为本次不落盘
    }
  }
}

function pruneLocal() {
  const now = Date.now() / 1000
  localSamples = localSamples.filter((s) => now - s.t < HISTORY_WINDOW_SEC)
  if (localSamples.length > LOCAL_MAX_SAMPLES) {
    localSamples = localSamples.slice(-LOCAL_MAX_SAMPLES)
  }
}

/**
 * 把当前市场快照追加为本地采样点（节流）。返回是否新增。
 *
 * `now` 默认取**市场快照自身的时间戳**（见 `defaultNow`），而不是墙钟。
 * 这点很关键：服务端归档写入的 `t` 是快照时间，本地采样若用墙钟，
 * 两者就处在**不同时间轴**上（同一份快照会被记成两个不同时刻），
 * 混在一起会让增量区间失真。快照取不到时间戳时才回落到墙钟。
 *
 * `force` 只跳过节流（对应界面上的「立即采样」）；若快照时间戳与上一条相同，
 * 仍然不写入并返回 `false`。
 */
export function recordLocalSample(force = false, now = defaultNow()): boolean {
  const market = getMarketDataApi()?.marketData
  if (!market) {
    return false
  }
  const last = localSamples[localSamples.length - 1]
  // 同一份快照不重复记录（`force` 也不例外）：时间戳没前进就说明数据没变，
  // 再写一条只是噪声，还会让后续按 `t` 去重时被丢弃。
  // 这也让「立即采样」能给出诚实的反馈——没新增就提示“已是最新”。
  if (last && last.t === now) {
    return false
  }
  if (!force && last && now - last.t < LOCAL_INTERVAL_SEC) {
    return false
  }
  const p: MarketPriceSample["p"] = {}
  for (const hrid in market) {
    const entry = market[hrid]
    const pp: Record<string, SampleLevel> = {}
    for (const level in entry) {
      const e = entry[level]
      const ask = e.ask ?? -1
      const bid = e.bid ?? -1
      const volume = e.volume ?? 0
      // 与采样脚本保持同一结构：始终写三个元素
      pp[level] = [ask, bid, volume]
    }
    p[hrid] = pp
  }
  localSamples.push({ t: now, p })
  pruneLocal()
  writeLocal(localSamples)
  mergedCache = null
  return true
}

/** 加载服务端历史（market_history.json）。文件不存在/加载失败时静默降级为空。 */
export async function loadMarketHistory(): Promise<void> {
  try {
    const res = await fetch(HISTORY_FILE_URL, { cache: "no-store" })
    if (!res.ok) {
      return
    }
    const data = (await res.json()) as MarketPriceSample[]
    if (Array.isArray(data)) {
      remoteSamples = data.filter((s) => typeof s.t === "number" && s.p)
      mergedCache = null
    }
  } catch {
    // 本地开发/离线时无服务端历史，忽略
  }
}

let autoSamplingStarted = false

/**
 * 开启「快照前进就记一个点」的自动采样。在 `main.ts` 里调用一次。
 *
 * 这是唯一能真正做到**每小时一个采样点**的路径：
 *   - GitHub Actions 的 `schedule` 是 best-effort 的（本仓库实测声明 60min、
 *     实际中位 307min），服务端归档因此平均 5 小时才有一个点；
 *   - 而 `main.ts` 每 60s 直接轮询官方 marketplace.json，官方快照本身是
 *     **整点小时粒度**，所以只要页面开着，快照一出现就会在 1 分钟内落盘。
 *
 * 只依赖 `marketData.timestamp` 变化触发：`recordLocalSample` 本身会按时间戳去重，
 * 所以重复触发（多标签页/反复往返路由）不会写出重复点，也不会重复写盘。
 */
export function startMarketAutoSampling(): void {
  if (autoSamplingStarted) {
    return
  }
  autoSamplingStarted = true
  watch(
    () => getMarketDataApi()?.timestamp,
    (ts) => {
      if (ts) {
        recordLocalSample()
      }
    },
    { immediate: true }
  )
}

/**
 * 合并后的历史序列（服务端归档 + 本地兜底，按时间升序，同一时间戳去重）。
 *
 * 去重的必要性：本地采样点会与服务端归档点重合 —— 例如归档里已经有某次快照，
 * 用户随后打开页面又记了一条本地采样。同一 `t` 的重复点会让「上一点」变成同一时刻，
 * 从而把增量区间的分母算成 0（或让基准点选择错位）。同一时间戳只保留最后一个
 * （本地采样在拼接时排在归档之后）。
 *
 * 结果带缓存：页面每行都要算速率，而本函数每次重建 Map + 排序是 O(n log n)。
 * 样本只在 `loadMarketHistory` / `recordLocalSample` 时变化，由那两处失效缓存。
 */
export function getMarketHistory(): MarketPriceSample[] {
  if (mergedCache) {
    return mergedCache
  }
  const byTime = new Map<number, MarketPriceSample>()
  for (const s of remoteSamples ?? []) {
    byTime.set(s.t, s)
  }
  for (const s of localSamples) {
    byTime.set(s.t, s)
  }
  mergedCache = [...byTime.values()].sort((a, b) => a.t - b.t)
  return mergedCache
}

/** 本地采样点数量 */
export function getLocalSampleCount(): number {
  return localSamples.length
}

/** 服务端归档采样点数量（未加载时为 0） */
export function getRemoteSampleCount(): number {
  return remoteSamples?.length ?? 0
}

/** 最近一次采样时间（epoch 秒）；无历史时返回 null */
export function getLastSampleTime(): number | null {
  const all = getMarketHistory()
  return all.length ? all[all.length - 1].t : null
}

/** 历史覆盖时长（小时）；不足两点时为 0 */
export function getHistorySpanHours(): number {
  const all = getMarketHistory()
  if (all.length < 2) {
    return 0
  }
  return (all[all.length - 1].t - all[0].t) / 3600
}

/** 当前是否已加载到服务端历史 */
export function hasRemoteHistory(): boolean {
  return !!remoteSamples?.length
}

/** 取某档位的量值：index 0=ask 1=bid 2=volume（旧样本只有 0/1） */
function valueAt(sample: MarketPriceSample, hrid: string, level: string, index: 0 | 1 | 2): number | null {
  const lv = sample.p[hrid]?.[level]
  if (!lv) {
    return null
  }
  const v = lv[index]
  return typeof v === "number" ? v : null
}

/**
 * `price`（当前价）口径的取值。
 *
 * 不用固定下标，是因为 index 1 的含义随结构长度变化：
 *   旧：`[ask, price]`      → index 1 是官方当前价
 *   新：`[ask, bid, volume]` → index 1 是右收购
 * 固定取 index 1 会让新样本把 bid 当成 price（差一个买卖价差）。
 * 这里改为「买卖价中点」：ask 与 bid 都存在时取平均，只有一个时取那个，
 * 对新旧格式都成立，也不会引入量级错误。
 */
function priceOf(sample: MarketPriceSample, hrid: string, level: string): number | null {
  const ask = valueAt(sample, hrid, level, 0)
  const second = valueAt(sample, hrid, level, 1)
  const hasAsk = ask != null && ask > 0
  const hasSecond = second != null && second > 0
  if (hasAsk && hasSecond) {
    return (ask! + second!) / 2
  }
  if (hasAsk) {
    return ask
  }
  return hasSecond ? second : null
}

function currentValueOf(item: MarketVolumeItem, metric: MarketChangeMetric): number {
  switch (metric) {
    case "ask":
      return item.ask
    case "bid":
      return item.bid
    case "volume":
      return item.volume
    default:
      return item.price > 0 ? item.price : item.ask
  }
}

function baseValueOf(sample: MarketPriceSample, item: MarketVolumeItem, metric: MarketChangeMetric): number | null {
  switch (metric) {
    case "ask":
      return valueAt(sample, item.hrid, item.level, 0)
    case "bid":
      return valueAt(sample, item.hrid, item.level, 1)
    case "volume":
      return valueAt(sample, item.hrid, item.level, 2)
    default:
      return priceOf(sample, item.hrid, item.level)
  }
}

/**
 * 时间类函数默认使用的「当前时刻」。
 *
 * **不要用墙钟 `Date.now()`**：成交量是**当日累计值**，比较的是「当前快照 vs 历史采样」。
 * 用墙钟当分母会有两个后果：
 *   1. 页面开着不动，分母持续变大，于是「成交量/小时」会自己往下漂（同一份数据每秒都在变）；
 *   2. 快照若已过期，分母被算大，速率被低估。
 * 市场数据自带 `timestamp`（快照生成时间），它才是与累计量同一时间轴上的「现在」。
 */
function defaultNow(): number {
  const ts = getMarketDataApi()?.timestamp
  return typeof ts === "number" && ts > 0 ? ts : Date.now() / 1000
}

const SECONDS_PER_DAY = 86400

/** 取 epoch 秒所在的 UTC 日序号（用于判断是否跨了 UTC 归零点） */
function utcDayIndex(t: number): number {
  return Math.floor(t / SECONDS_PER_DAY)
}

/**
 * 计算 `startT→endT` 之间的成交量增量与经过小时数。
 *
 * 官方 `volume` 是**当日累计成交量**（每天 UTC 0 点归零），所以：
 * - **同一 UTC 日**：增量 = `endVol − startVol`，是本区间内真实的成交量；
 *   若为负说明数据异常（同一天内累计值不该减少），判为无效。
 * - **跨越 UTC 日**：0 点之前的部分已经被归零，无法还原。此时 `endVol` 本身就是
 *   「自今天 0 点起」的累计增量，因此直接用它，并把计时起点改到 0 点 ——
 *   否则会把昨天的累计当成今天的增量（旧实现即如此，跨日时会算出虚高的速率）。
 */
function volumeDeltaBetween(
  startT: number,
  startVol: number,
  endT: number,
  endVol: number
): { delta: number, hours: number, sameDay: boolean } | null {
  if (!(endT > startT)) {
    return null
  }
  if (utcDayIndex(startT) === utcDayIndex(endT)) {
    const delta = endVol - startVol
    if (delta < 0) {
      return null
    }
    return { delta, hours: (endT - startT) / 3600, sameDay: true }
  }
  const dayStart = utcDayIndex(endT) * SECONDS_PER_DAY
  const hours = (endT - dayStart) / 3600
  if (hours <= 0) {
    return null
  }
  return { delta: endVol, hours, sameDay: false }
}

/**
 * 取「时间窗起点前最近一个采样点」。
 * 历史按时间升序，最后一个 `t <= cutoff` 即所求；没有则返回 null。
 */
export function getBaselineSample(windowHours: number, now = defaultNow()): MarketPriceSample | null {
  const history = getMarketHistory()
  if (!history.length) {
    return null
  }
  const cutoff = now - windowHours * 3600
  let baseSample: MarketPriceSample | null = null
  for (const s of history) {
    if (s.t <= cutoff) {
      baseSample = s
    }
  }
  return baseSample
}

/**
 * 成交量类指标（速率 / 滚动成交量）的锚点。
 *
 * 优先取「窗口起点之前最近的采样点」（= `getBaselineSample`，严格窗口语义）；
 * 若历史覆盖不足（最老的点比窗口起点还新，例如归档只有 76 小时却选了 168 小时窗），
 * 退回**最老的点**：宁可给出一个「实际区间比所选窗口短」的数（区间长度由返回值
 * 里的 `hours` 如实带上），也不要让整列变成 `--`。
 *
 * 注意：锚点与物品无关，所有行走的是同一个点，所以列内仍然可比。
 * 价格涨跌不走这里（它必须严格按窗口取基准，否则「涨跌」会变成另一个时间段的涨跌）。
 */
function findVolumeAnchor(
  windowHours: number,
  now: number
): { sample: MarketPriceSample, withinWindow: boolean } | null {
  const strict = getBaselineSample(windowHours, now)
  if (strict) {
    return { sample: strict, withinWindow: true }
  }
  const oldest = getMarketHistory().find((s) => s.t < now)
  return oldest ? { sample: oldest, withinWindow: false } : null
}

/**
 * 计算指定时间窗内的涨跌。
 *
 * 返回 key=`hrid|level` → MarketChange。无足够历史或基准值缺失时该项不出现（UI 显示 `--`）。
 *
 * 各口径的当前值来源：
 * - `price`/`ask`/`bid`：直接比价格。
 * - `volume`：官方 `v` 是**当日累计成交量**，直接比绝对值只能反映「今天过了多久」。
 *   因此这里算的是**成交量增量速率**，再与「基准点的历史速率」比较。
 *   跨 UTC 归零点时按 `volumeDeltaBetween` 的规则退化为「自 0 点起的均值」。
 *
 * `now` 默认取市场快照自身的 `timestamp`（见 `defaultNow`）。
 */
export function getMarketChangeMap(
  list: MarketVolumeItem[],
  windowHours: number,
  metric: MarketChangeMetric = "price",
  now = defaultNow()
): Map<string, MarketChange> {
  const map = new Map<string, MarketChange>()
  const baseSample = getBaselineSample(windowHours, now)
  if (!baseSample) {
    return map
  }
  const history = getMarketHistory()
  const baseIdx = history.indexOf(baseSample)
  // 基准点的「上一个」采样点，用于估算基准时刻的成交量速率
  const prevOfBase = baseIdx > 0 ? history[baseIdx - 1] : null

  for (const item of list) {
    const cur = currentValueOf(item, metric)
    if (cur == null || cur <= 0) {
      continue
    }
    const base = baseValueOf(baseSample, item, metric)
    if (base == null || base <= 0) {
      continue
    }

    if (metric === "volume") {
      const span = volumeDeltaBetween(baseSample.t, base, now, cur)
      if (!span) {
        continue
      }
      // 基准点自身的历史速率：用它与前一个点的增量估算（同样要判同日，否则会跨归零点）
      let baseRate = 0
      if (prevOfBase) {
        const prevVol = valueAt(prevOfBase, item.hrid, item.level, 2)
        if (prevVol != null && prevVol >= 0) {
          const prevSpan = volumeDeltaBetween(prevOfBase.t, prevVol, baseSample.t, base)
          if (prevSpan && prevSpan.sameDay) {
            baseRate = prevSpan.delta / prevSpan.hours
          }
        }
      }
      const rate = span.delta / span.hours
      // 基准速率为 0 时无法算百分比（从无成交到有成交），记为 100% 表示「由静默转活跃」
      const pct = baseRate > 0 ? ((rate - baseRate) / baseRate) * 100 : (rate > 0 ? 100 : 0)
      map.set(`${item.hrid}|${item.level}`, {
        base,
        current: cur,
        pct,
        hours: span.hours,
        deltaVolume: span.delta
      })
      continue
    }

    map.set(`${item.hrid}|${item.level}`, {
      base,
      current: cur,
      pct: ((cur - base) / base) * 100
    })
  }
  return map
}

/** 成交量速率及其**实际**计算区间（UI 需要据此说明「这个数不是按你选的时间窗算的」） */
export interface VolumeRateDetail {
  /** 速率（件/小时） */
  rate: number
  /** 实际参与计算的小时数。采样点稀疏时它会明显大于所选时间窗 */
  hours: number
  /** 基准点是否与当前快照同为 UTC 日（false = 跨了归零点，只统计自 0 点起） */
  sameDay: boolean
  /** 基准点累计成交量 */
  baseVolume: number
  /** 当前累计成交量 */
  currentVolume: number
  /** 基准点时间（epoch 秒） */
  baseT: number
}

/**
 * 成交量速率详情。
 *
 * 为什么需要「详情」而不是只返回一个数：采样是**按小时快照**的（线上实测间隔中位数
 * 约 5 小时），所以选「1 小时」窗口时，实际能拿到的最近基准点往往在几小时之前 ——
 * 速率其实是按那段更长的区间平均出来的。只显示一个数字会让人误以为它是 1 小时的量。
 */
export function getVolumeRateDetail(
  item: MarketVolumeItem,
  windowHours: number,
  now = defaultNow()
): VolumeRateDetail | null {
  const anchor = findVolumeAnchor(windowHours, now)
  if (!anchor) {
    return null
  }
  const base = valueAt(anchor.sample, item.hrid, item.level, 2)
  if (base == null || base < 0) {
    return null
  }
  const span = volumeDeltaBetween(anchor.sample.t, base, now, item.volume)
  if (!span) {
    return null
  }
  return {
    rate: span.delta / span.hours,
    hours: span.hours,
    sameDay: span.sameDay,
    baseVolume: base,
    currentVolume: item.volume,
    baseT: anchor.sample.t
  }
}

/**
 * 成交量速率（件/小时）。
 *
 * 官方 `volume` 是**当日累计成交量**，所以必须先按 UTC 日边界判断增量含义
 * （见 `volumeDeltaBetween`）：同日取真实增量，跨日退化为「自 0 点起的均值」。
 * 无基准、基准缺 volume、或同日增量为负（数据异常）时返回 null（UI 显示 `--`）。
 *
 * `now` 默认取市场快照时间戳，保证「同一份数据算出的速率稳定不漂移」。
 * 若还需要知道实际用了多长区间，用 `getVolumeRateDetail`。
 */
export function getVolumeRate(
  item: MarketVolumeItem,
  windowHours: number,
  now = defaultNow()
): number | null {
  return getVolumeRateDetail(item, windowHours, now)?.rate ?? null
}

/** 时间窗内**滚动成交量**及其可信度 */
export interface RollingVolumeDetail {
  /** 窗口内成交量（滚动累加，不受 UTC 归零影响） */
  volume: number
  /**
   * 实际统计区间（小时）= `now - 基准点时间`。
   * 基准点取「窗口起点之前最近的一个采样点」，所以它 ≥ 所选窗口；
   * 但**与物品无关**，所有行用的是同一个基准点，因此行与行之间仍然可比。
   */
  hours: number
  /** 其中「增量可精确得知」的小时数（跨 UTC 归零点的那一段只能算到 0 点之后） */
  knownHours: number
  /** 覆盖率 = knownHours / hours（1 表示整段区间都是精确增量） */
  coverage: number
  /** 区间内跨过的 UTC 归零点个数（>0 时区间首尾各有一段无法还原） */
  crossings: number
}

/**
 * 时间窗内**滚动成交量**。
 *
 * 为什么需要它：官方 `v` 是当日累计量，每天 UTC 0 点归零，于是「刚过零点所有物品
 * 都只剩很小的数字」，跨时刻完全不可比。这里改为在自有采样归档上把**相邻采样点的
 * 增量滚动累加**，得到一个不归零、可比的窗口成交量。
 *
 * 累加规则（与 `volumeDeltaBetween` 同一套判断）：
 * - **同一 UTC 日**：增量 = `vol(end) − vol(start)`，精确，整段计入 `knownHours`；
 *   若为负（同日累计不该减少）判为异常，该段不计入。
 * - **跨 UTC 日**：0 点前的累计已被归零、无法还原，只能拿到 `vol(end)`（自今日 0 点
 *   起的累计），所以只把「0 点之后的小时数」计入 `knownHours`，并把 `crossings` +1。
 *   这正是采样越密越准的原因：点足够密时，丢失的「0 点前那一小段」可以忽略。
 *
 * 返回 null 的情形：没有基准点、基准点缺 volume、实际区间不为正。
 */
export function getRollingVolumeDetail(
  item: MarketVolumeItem,
  windowHours: number,
  now = defaultNow()
): RollingVolumeDetail | null {
  const anchor = findVolumeAnchor(windowHours, now)
  if (!anchor) {
    return null
  }
  const hours = (now - anchor.sample.t) / 3600
  if (hours <= 0) {
    return null
  }
  const history = getMarketHistory()
  // 用时间找锚点在序列中的下标，而不是 indexOf(anchor.sample)：
  // 锚点来自 getBaselineSample/findVolumeAnchor，若两者之间历史被写过（缓存失效重建），
  // 对象引用就对不上了，indexOf 会返回 -1 并从序列开头累加，把窗口算错。
  let startIdx = -1
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].t <= anchor.sample.t) {
      startIdx = i
      break
    }
  }
  if (startIdx < 0) {
    return null
  }
  let prevT = anchor.sample.t
  let prevVol = valueAt(anchor.sample, item.hrid, item.level, 2)
  if (prevVol == null || prevVol < 0) {
    return null
  }

  let volume = 0
  let knownHours = 0
  let crossings = 0

  /** 累加一段 `[fromT, vol(fromT)] → [toT, vol(toT)]`；`vol(toT)` 已确认有效 */
  const addSegment = (toT: number, toVol: number) => {
    if (prevVol == null || !(toT > prevT)) {
      return
    }
    if (utcDayIndex(prevT) === utcDayIndex(toT)) {
      const delta = toVol - prevVol
      if (delta >= 0) {
        volume += delta
        knownHours += (toT - prevT) / 3600
      }
    } else {
      // 跨归零点：只拿得到「自 toT 当天 0 点起」的累计
      volume += toVol
      knownHours += (toT - utcDayIndex(toT) * SECONDS_PER_DAY) / 3600
      crossings++
    }
  }

  for (let i = startIdx + 1; i < history.length; i++) {
    const s = history[i]
    if (s.t > now) {
      break
    }
    const vol = valueAt(s, item.hrid, item.level, 2)
    if (vol == null || vol < 0) {
      // 该点没有 volume（旧格式样本）：断开链条，从这一点重新起算
      prevT = s.t
      prevVol = null
      continue
    }
    if (prevVol == null) {
      prevT = s.t
      prevVol = vol
      continue
    }
    addSegment(s.t, vol)
    prevT = s.t
    prevVol = vol
  }

  // 最后一个采样点到「现在」这一段：当前快照就是 now 时刻的量
  if (prevVol != null && now > prevT && item.volume >= 0) {
    addSegment(now, item.volume)
  }

  return {
    volume,
    hours,
    knownHours,
    coverage: Math.max(0, Math.min(1, knownHours / hours)),
    crossings
  }
}

/**
 * 时间窗内滚动成交量（件）。语义与 `getRollingVolumeDetail` 相同，只取数值。
 */
export function getRollingVolume(
  item: MarketVolumeItem,
  windowHours: number,
  now = defaultNow()
): number | null {
  return getRollingVolumeDetail(item, windowHours, now)?.volume ?? null
}
