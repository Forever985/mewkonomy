import { marketRowKeyOf } from "@/common/apis/marketvolume/keys"
import { pinia } from "@/pinia"
import { defineStore } from "pinia"

/**
 * 市场监控「收藏」。
 *
 * ## 为什么不复用已有的两个 favorite
 * 项目里已经有两套「收藏」，但都不是市场条目：
 *  - `pinia/stores/favorite.ts`（key `manual-list`）：收藏的是**生产配方/项目**（`StorageCalculatorItem`），
 *    用于 dashboard 的「收藏夹」页签；
 *  - `pinia/stores/enhancer.ts` 的 `favorite`：收藏的是**装备 hrid**（`string[]`），只服务强化页。
 *
 * 市场条目的粒度是 **(物品, 官方市场档位)** —— 同一件装备的 +0 与 +3 是两个不同的市场条目，
 * 且市场里还有材料/消耗品（不只是装备）。硬塞进上面任一个都会把语义搅混，故单独一个 store。
 *
 * ## 存储
 * 存 `string[]`，元素是 `hrid|level`（与 `marketRowKeyOf` / 涨跌 map / 提醒命中共用同一套行 key）。
 * 读取时做一次归一化：`localStorage` 可能是旧版本、被手改或塞进了非字符串，坏数据直接丢弃，
 * 但**不写一次性迁移脚本**（与本项目其它配置型 store 保持一致的做法）。
 */

const STORAGE_KEY = "market-favorite-items"

function normalize(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return []
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== "string") {
      continue
    }
    const key = raw.trim()
    // 必须形如 hrid|level（两段都非空），否则是坏数据
    const sep = key.indexOf("|")
    if (sep <= 0 || sep === key.length - 1) {
      continue
    }
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(key)
  }
  return out
}

function loadKeys(): string[] {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"))
  } catch {
    return []
  }
}

function saveKeys(keys: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
  } catch (e) {
    console.error("市场收藏保存失败:", e)
  }
}

export const useMarketFavoriteStore = defineStore("marketfavorite", () => {
  /** 收藏的行 key 列表，插入顺序 = 收藏顺序 */
  const keys = ref<string[]>(loadKeys())
  const keySet = computed(() => new Set(keys.value))
  const count = computed(() => keys.value.length)

  function has(hrid: string, level: string | number): boolean {
    return keySet.value.has(marketRowKeyOf(hrid, level))
  }

  function add(hrid: string, level: string | number): void {
    const key = marketRowKeyOf(hrid, level)
    if (keySet.value.has(key)) {
      return
    }
    keys.value = [...keys.value, key]
    saveKeys(keys.value)
  }

  function remove(hrid: string, level: string | number): void {
    const key = marketRowKeyOf(hrid, level)
    if (!keySet.value.has(key)) {
      return
    }
    keys.value = keys.value.filter(k => k !== key)
    saveKeys(keys.value)
  }

  /** 切换收藏，返回切换后的状态（true = 当前已收藏） */
  function toggle(hrid: string, level: string | number): boolean {
    if (has(hrid, level)) {
      remove(hrid, level)
      return false
    }
    add(hrid, level)
    return true
  }

  function clear(): void {
    keys.value = []
    saveKeys(keys.value)
  }

  return { keys, count, has, add, remove, toggle, clear }
})

/** 组件外直连（与项目其它 store 保持一致的写法） */
export function useMarketFavoriteStoreOutside() {
  return useMarketFavoriteStore(pinia)
}
