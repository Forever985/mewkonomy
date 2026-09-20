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
 * 因此读取一律走 valueAt() / volumeAt()，不要直接下标。
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
 * 取「时间窗起点前最近一个采样点」。
 * 历史按时间升序，最后一个 `t <= cutoff` 即所求；没有则返回 null。
 */
export function getBaselineSample(windowHours: number, now = Date.now() / 1000): MarketPriceSample | null {
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
 *   因此这里算的是**成交量增量速率**：`(当前累计 − 基准累计) / 间隔小时`，
 *   再与「基准点的历史速率」比较——用上一段间隔做参照，避免跨 UTC 归零时出现负增量。
 *   增量跨归零点为负时判为无效（返回空，不写 map）。
 */
export function getMarketChangeMap(
  list: MarketVolumeItem[],
  windowHours: number,
  metric: MarketChangeMetric = "price",
  now = Date.now() / 1000
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
      const deltaVolume = cur - base
      // 负数 = 跨了 UTC 日切（累计值归零），本窗口内无法比较
      if (deltaVolume < 0) {
        continue
      }
      const hours = Math.max((now - baseSample.t) / 3600, 1 / 60)
      // 基准点自身的历史速率：用基准与它前一个点的增量估算
      let baseRate = 0
      if (prevOfBase) {
        const prevVol = valueAt(prevOfBase, item.hrid, item.level, 2)
        const prevHours = (baseSample.t - prevOfBase.t) / 3600
        if (prevVol != null && prevVol >= 0 && prevHours > 0) {
          const prevDelta = base - prevVol
          baseRate = prevDelta >= 0 ? prevDelta / prevHours : 0
        }
      }
      const rate = deltaVolume / hours
      // 基准速率为 0 时无法算百分比（从无成交到有成交），记为 100% 表示「由静默转活跃」
      const pct = baseRate > 0 ? ((rate - baseRate) / baseRate) * 100 : (rate > 0 ? 100 : 0)
      map.set(`${item.hrid}|${item.level}`, { base, current: cur, pct, hours, deltaVolume })
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
 * 成交量速率（件/小时）：`(当前累计 − 窗口起点累计) / 间隔小时`。
 * 跨 UTC 归零导致负增量时返回 null（UI 显示 `--`）。
 */
export function getVolumeRate(
  item: MarketVolumeItem,
  windowHours: number,
  now = Date.now() / 1000
): number | null {
  const baseSample = getBaselineSample(windowHours, now)
  if (!baseSample) {
    return null
  }
  const base = valueAt(baseSample, item.hrid, item.level, 2)
  if (base == null || base < 0 || item.volume < base) {
    return null
  }
  const hours = (now - baseSample.t) / 3600
  if (hours <= 0) {
    return null
  }
  return (item.volume - base) / hours
}
