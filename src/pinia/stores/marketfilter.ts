import { pinia } from "@/pinia"
import { defineStore } from "pinia"

/**
 * 市场监控页的「可开可关」过滤设置。
 *
 * 目前只有一项：**隐藏小成交量**。市场里大量物品一天只成交个位数，
 * 混在列表里会淹没真正可交易的品种，所以给一个持久化的下限，
 * 打开市场监控时默认就按它过滤。
 *
 * ## 为什么单独一个 store，而不是塞进别处
 * - 不进 `layoutsConfig`：那是**布局**配置，「重置布局配置」不该顺手改掉业务过滤条件；
 * - 不进 `alert.ts`：那是提醒规则的配置，语义无关；
 * - 也不要用 `useMemory`：设置面板与市场监控页要同时读写它，`useMemory` 每处调用各持一个
 *   独立 ref，改一处另一处不会更新，必须有一个共享的响应式来源。
 *
 * 持久化 key 与结构都带版本号，旧数据缺字段按默认补齐（不做一次性迁移脚本）。
 */

const STORAGE_KEY = "market-filter-config"
const CONFIG_VERSION = 1

/** 默认成交量下限（件）。默认关闭，所以这个值只在用户打开开关时才生效 */
export const DEFAULT_MIN_VOLUME = 100

export interface MarketFilterConfig {
  version: number
  /** 是否隐藏成交量低于 `minVolume` 的条目 */
  hideLowVolume: boolean
  /**
   * 成交量下限（件）。
   *
   * 口径与市场监控页「成交量」列**完全一致**：时间窗内滚动量优先、回退官方当日累计量
   * （见 `marketvolume/filters.ts` 的 `rangeValueOf(item, "volume")`）。
   * 用同一口径是为了避免「屏幕上写着 0、却因为底层累计量非 0 而被留下」这种自相矛盾。
   */
  minVolume: number
}

function defaultConfig(): MarketFilterConfig {
  return {
    version: CONFIG_VERSION,
    // 默认关闭：宁可默认不动用户的列表，也不要一上线就把东西藏起来
    hideLowVolume: false,
    minVolume: DEFAULT_MIN_VOLUME
  }
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

/** 把任意来源的数据规整成合法配置（缺字段补默认，坏字段丢弃） */
function normalizeConfig(input: unknown): MarketFilterConfig {
  const fallback = defaultConfig()
  if (!input || typeof input !== "object") {
    return fallback
  }
  const raw = input as Partial<MarketFilterConfig>
  return {
    version: CONFIG_VERSION,
    hideLowVolume: raw.hideLowVolume === true,
    // 负数下限没有意义，且会让 .filter 的语义反过来，这里夹到 ≥ 0
    minVolume: Math.max(0, toFiniteNumber(raw.minVolume, fallback.minVolume))
  }
}

function loadConfig(): MarketFilterConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return normalizeConfig(raw ? JSON.parse(raw) : null)
  } catch {
    return defaultConfig()
  }
}

function saveConfig(config: MarketFilterConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch (e) {
    console.error("市场过滤设置保存失败:", e)
  }
}

export const useMarketFilterStore = defineStore("marketfilter", () => {
  const initial = loadConfig()

  const hideLowVolume = ref(initial.hideLowVolume)
  const minVolume = ref(initial.minVolume)

  // 两处开关（设置面板 / 市场监控页）共用这一份状态，改动必然同步
  watch([hideLowVolume, minVolume], () => {
    saveConfig({ version: CONFIG_VERSION, hideLowVolume: hideLowVolume.value, minVolume: minVolume.value })
  })

  function reset() {
    const next = defaultConfig()
    hideLowVolume.value = next.hideLowVolume
    minVolume.value = next.minVolume
  }

  return { hideLowVolume, minVolume, reset }
})

/** 组件外直连（与项目其它 store 保持一致的写法） */
export function useMarketFilterStoreOutside() {
  return useMarketFilterStore(pinia)
}
