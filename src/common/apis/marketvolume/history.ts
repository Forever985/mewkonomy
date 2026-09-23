import { getMarketDataApi } from "@/common/apis/game"
import type { MarketVolumeItem } from "./index"

/**
 * 市场历史采样与涨跌计算
 *
 * 涨跌需要「时间窗起点」的历史数据作基准，而官方 marketplace.json 只提供当前快照，
 * 因此本模块维护两条历史采样通道（格式统一为 MarketPriceSample，可合并计算）：
 * 1. 服务端归档：GitHub Actions 每 20 分钟拉取官方 marketplace.json 追加到
 *    public/data/market_history.json（**滚动保留最近 7 天**），前端 fetch 使用。
 *    见 .github/workflows/market-history.yml + scripts/sample_market_history.py
 * 2. 本地兜底：每次打开本页/手动采样时把当前快照写入 localStorage
 *    （节流 30 分钟、上限 200 条、同样 7 天窗口），覆盖本地开发/无服务端归档的场景。
 *
 * 采样点结构（**两种长度都要兼容**）：
 *   { t: epoch秒, p: { hrid: { level: [ask, price] } } }            ← 早期版本只存两个
 *   { t: epoch秒, p: { hrid: { level: [ask, bid, volume] } } }      ← 现行版本存三个
 * 因此读取一律走 valueAt() / priceOf()，不要直接下标。
 *
 * volume 语义提醒：官方 `v` 是**当日累计成交量**（每天 UTC 0 点归零），
 * 所以成交量对比要看「增量 / 速率」，不能直接比绝对值。
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
/** 本地兜底保留条数上限（7 天 / 30 分钟 ≈ 336，取 200 控制 localStorage 体积） */
const LOCAL_MAX_SAMPLES = 200
/** 历史保留窗口：与服务端一致，7 天 */
const HISTORY_WINDOW_SEC = 7 * 24 * 3600

const storage: Storage | null = typeof localStorage !== "undefined" ? localStorage : null

let remoteSamples: MarketPriceSample[] | null = null
let localSamples: MarketPriceSample[] = readLocal()

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
 * 把当前市场快照追加为本地采样点（节流）。
 * `force` 跳过节流；`now` 可显式指定时间（便于测试与回填）。返回是否新增。
 */
export function recordLocalSample(force = false, now = Math.floor(Date.now() / 1000)): boolean {
  const market = getMarketDataApi()?.marketData
  if (!market) {
    return false
  }
  const last = localSamples[localSamples.length - 1]
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
    }
  } catch {
    // 本地开发/离线时无服务端历史，忽略
  }
}

/** 合并后的历史序列（服务端 + 本地，按时间升序）。 */
export function getMarketHistory(): MarketPriceSample[] {
  const merged = [...(remoteSamples ?? []), ...localSamples]
  merged.sort((a, b) => a.t - b.t)
  return merged
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

/**
 * 成交量速率（件/小时）。
 *
 * 官方 `volume` 是**当日累计成交量**，所以必须先按 UTC 日边界判断增量含义
 * （见 `volumeDeltaBetween`）：同日取真实增量，跨日退化为「自 0 点起的均值」。
 * 无基准、基准缺 volume、或同日增量为负（数据异常）时返回 null（UI 显示 `--`）。
 *
 * `now` 默认取市场快照时间戳，保证「同一份数据算出的速率稳定不漂移」。
 */
export function getVolumeRate(
  item: MarketVolumeItem,
  windowHours: number,
  now = defaultNow()
): number | null {
  const baseSample = getBaselineSample(windowHours, now)
  if (!baseSample) {
    return null
  }
  const base = valueAt(baseSample, item.hrid, item.level, 2)
  if (base == null || base < 0) {
    return null
  }
  const span = volumeDeltaBetween(baseSample.t, base, now, item.volume)
  if (!span) {
    return null
  }
  return span.delta / span.hours
}
