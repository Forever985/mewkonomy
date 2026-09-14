import { getMarketDataApi } from "@/common/apis/game"
import type { MarketVolumeItem } from "./index"

/**
 * 市场历史采样与涨跌计算
 *
 * 涨跌需要「时间窗起点」的历史价格作基准，而官方 marketplace.json 只提供当前快照，
 * 因此本模块维护两条历史采样通道（格式统一为 MarketPriceSample，可合并计算）：
 * 1. 服务端归档：GitHub Actions 定时拉取官方 marketplace.json 追加到
 *    public/data/market_history.json（滚动保留最近 26 小时），前端 fetch 使用。
 * 2. 本地兜底：每次打开本页/手动采样时，把当前市场快照写入 localStorage
 *    （节流 30 分钟、上限 48 条），覆盖本地开发/手动部署等无服务端历史的场景。
 *
 * 采样点结构：
 *   { t: epoch秒, p: { hrid: { level: [ask, price] } } }
 *   price 取官方 p 字段，缺失时用 ask 兜底；保证与 MarketVolumeItem 的当前价口径一致。
 */

export interface MarketPriceSample {
  /** 采样时间（epoch 秒，与 marketplace.json 的 timestamp 同口径） */
  t: number
  /** hrid → level → [ask, price] */
  p: Record<string, Record<string, [number, number]>>
}

export interface MarketChange {
  /** 基准价 */
  base: number
  /** 涨跌百分比（相对基准价） */
  pct: number
}

const HISTORY_FILE_URL = `${import.meta.env.BASE_URL}data/market_history.json`
const LOCAL_KEY = "mewkonomy-market-history"
/** 本地兜底采样节流间隔 */
const LOCAL_INTERVAL_SEC = 30 * 60
/** 本地兜底保留条数上限 */
const LOCAL_MAX_SAMPLES = 48
/** 历史保留窗口 */
const HISTORY_WINDOW_SEC = 26 * 3600

const storage: Storage | null = typeof localStorage !== "undefined" ? localStorage : null

let remoteSamples: MarketPriceSample[] | null = null
let localSamples: MarketPriceSample[] = readLocal()

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

/** 把当前市场快照追加为本地采样点（节流）。返回是否新增。 */
export function recordLocalSample(force = false): boolean {
  const market = getMarketDataApi()?.marketData
  if (!market) {
    return false
  }
  const now = Math.floor(Date.now() / 1000)
  const last = localSamples[localSamples.length - 1]
  if (!force && last && now - last.t < LOCAL_INTERVAL_SEC) {
    return false
  }
  const p: MarketPriceSample["p"] = {}
  for (const hrid in market) {
    const entry = market[hrid]
    const pp: Record<string, [number, number]> = {}
    for (const level in entry) {
      const e = entry[level]
      const ask = e.ask ?? -1
      const price = e.price ?? ask
      pp[level] = [ask, price]
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

/** 最近一次采样时间（epoch 秒）；无历史时返回 null */
export function getLastSampleTime(): number | null {
  const all = getMarketHistory()
  return all.length ? all[all.length - 1].t : null
}

/** 当前是否已加载到服务端历史 */
export function hasRemoteHistory(): boolean {
  return !!remoteSamples?.length
}

function priceOf(sample: MarketPriceSample, hrid: string, level: string): number | null {
  const lv = sample.p[hrid]?.[level]
  if (!lv) {
    return null
  }
  const price = lv[1] > 0 ? lv[1] : lv[0]
  return price > 0 ? price : null
}

/**
 * 计算指定时间窗内的涨跌：当前价 vs 「时间窗起点前最近一个采样点」的基准价。
 * 返回 key=`hrid|level` → { base, pct }；无足够历史或基准价缺失时该项不出现。
 * 当前价口径：MarketVolumeItem.price（官方 p），缺失用 ask 兜底。
 */
export function getMarketChangeMap(list: MarketVolumeItem[], windowHours: number): Map<string, MarketChange> {
  const map = new Map<string, MarketChange>()
  const history = getMarketHistory()
  if (!history.length) {
    return map
  }
  const now = Date.now() / 1000
  const cutoff = now - windowHours * 3600
  // 取时间窗起点前最近的一个采样点作为基准（历史按时间升序，最后一个 t<=cutoff 即所求）
  let baseSample: MarketPriceSample | null = null
  for (const s of history) {
    if (s.t <= cutoff) {
      baseSample = s
    }
  }
  if (!baseSample) {
    return map
  }
  for (const item of list) {
    const cur = item.price > 0 ? item.price : item.ask
    if (cur <= 0) {
      continue
    }
    const base = priceOf(baseSample, item.hrid, item.level)
    if (base == null || base <= 0) {
      continue
    }
    map.set(`${item.hrid}|${item.level}`, { base, pct: ((cur - base) / base) * 100 })
  }
  return map
}
