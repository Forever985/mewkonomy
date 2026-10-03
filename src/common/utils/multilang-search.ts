/**
 * 多语言名称检索（纯函数、零运行时依赖）
 *
 * ## 要解决的问题
 *
 * 物品名在 `data.json` 里**只有英文**（`Abyssal Essence`），中文/繁体译名分别放在
 * `zh-cn.ts`（`地狱精华`）与 `zh-tw.ts`（`地獄精華`）。页面通过 `t(name)` 拿到
 * **当前语言**的那一个。
 *
 * 改造前的搜索一律只匹配 `t(i.name)`，于是：
 * - 界面切到英文时，输「地狱精华」搜不到任何东西；
 * - 界面切到中文时，输 `Abyssal` 也搜不到（除非恰好匹配 hrid）。
 *
 * 用户的真实需求是「我知道这个东西叫什么，帮我找到它」，而不是
 * 「我必须先知道界面语言是什么」。所以搜索应当**三套名一起匹配**。
 *
 * ## 为什么可以直接 import 语言包
 *
 * `locales/lang/index.ts` 是一个纯对象（`{ en, zhCn, zhTw }`），不依赖
 * vue-i18n 实例。直接读它就能拿到全部译名，避免为了搜索去 `useI18n()` ——
 * 纯函数模块才能在 node 环境下直接单测。
 */

import allLocales from "@/locales/lang"

/** 全部语言包（`en` / `zhCn` / `zhTw`） */
const LOCALES: Record<string, Record<string, string>> = allLocales as unknown as Record<string, Record<string, string>>

/** 展示顺序：中文简体 → 繁体 → 英文。命中高亮的可读性更好。 */
const LOCALE_ORDER = ["zhCn", "zhTw", "en"] as const

/**
 * 取某个 key 在**所有语言**下的译名（含原文兜底）。
 *
 * 例：`allNamesOf("Abyssal Essence")` → `["地狱精华", "地獄精華", "Abyssal Essence"]`
 *
 * 去重且保持顺序稳定，因此可以直接当索引用（Map 天然去重）。
 * 查不到的 key 返回 `[key]` 本身 —— 物品名一定在英文包里（key 就是英文名），
 * 但 UI 文案（如「搜索物品」）不一定有英文译名，这时至少要能按原文搜到。
 */
export function allNamesOf(key: string): string[] {
  if (!key) {
    return []
  }
  const out: string[] = []
  const seen = new Set<string>()
  const push = (v: unknown) => {
    if (typeof v !== "string") {
      return
    }
    const s = v.trim()
    if (!s) {
      return
    }
    const k = s.toLowerCase()
    if (seen.has(k)) {
      return
    }
    seen.add(k)
    out.push(s)
  }
  for (const locale of LOCALE_ORDER) {
    push(LOCALES[locale]?.[key])
  }
  // 原文兜底：英文包缺该 key 时，仍要能按 key 本身搜到
  push(key)
  return out
}

/**
 * 一次取多个 key 的全部别名，**同一份数据只建一次索引**。
 *
 * 列表页有几千条记录，若每条都调 `allNamesOf`，就是几千次对象查找 × 3 语言。
 * 先把所有 key 收集起来批量建索引，再用 `index.get(hrid)` 查，
 * 后续每条记录只是一次 Map 查找。
 *
 * @param keysOf 从记录取「用于翻译的 key」（通常是 `name` 字段）
 * @param records 待索引的记录
 * @param keyOf 从记录取 key
 */
export function buildAliasIndex<T>(
  records: readonly T[],
  keyOf: (item: T) => string
): Map<string, string[]> {
  const keys = new Set<string>()
  for (const item of records) {
    const k = keyOf(item)
    if (k) {
      keys.add(k)
    }
  }
  const index = new Map<string, string[]>()
  for (const k of keys) {
    index.set(k, allNamesOf(k))
  }
  return index
}

/**
 * 把一条记录的「原文 + 全部译名」拼成可搜索串（小写、空白折叠）。
 *
 * 之所以预先拼好而不是每次搜索现拼：3000 行 × 3 语言 = 9000 次翻译查表，
 * 而实际只需要每个唯一 key 查一次（见 `buildAliasIndex`）。
 */
export function aliasSearchTextOf(aliases: readonly string[] | undefined): string {
  if (!aliases?.length) {
    return ""
  }
  return aliases.join(" ").toLowerCase().replace(/\s+/g, " ").trim()
}
