import { describe, expect, it } from "vitest"
import { allNamesOf, aliasSearchTextOf, buildAliasIndex } from "@/common/utils/multilang-search"
import { buildTextQuery, compileQuery } from "@/common/utils/query-engine"

/**
 * 多语言检索的回归测试
 *
 * 核心断言只有一条：**用户知道的东西叫什么，就能搜到它 —— 与当前界面语言无关。**
 * 改造前只匹配 `t(i.name)`（当前语言那一个），切到英文界面后输中文名就搜不到。
 */

describe("multilang-search · 别名收集", () => {
  it("同一 key 拿到简体 / 繁体 / 英文三套名", () => {
    const names = allNamesOf("Abyssal Essence")
    expect(names).toContain("地狱精华")
    expect(names).toContain("地獄精華")
    expect(names).toContain("Abyssal Essence")
  })

  it("译名缺失时至少返回原文（不能变成空数组）", () => {
    expect(allNamesOf("Some UI Label")).toContain("Some UI Label")
    expect(allNamesOf("")).toEqual([])
  })

  it("去重（大小写不敏感）且顺序稳定", () => {
    const a = allNamesOf("Abyssal Essence")
    const b = allNamesOf("Abyssal Essence")
    expect(a).toEqual(b)
    expect(new Set(a.map(s => s.toLowerCase())).size).toBe(a.length)
  })
})

describe("multilang-search · 索引", () => {
  const rows = [
    { hrid: "/items/a", name: "Abyssal Essence" },
    { hrid: "/items/b", name: "Red Gem" },
    { hrid: "/items/c", name: "Abyssal Essence" }
  ]

  it("按记录去重建索引（同一 name 只查一次翻译）", () => {
    const index = buildAliasIndex(rows, r => r.name)
    expect(index.size).toBe(2)
    expect(index.get("Abyssal Essence")).toContain("地狱精华")
  })

  it("拼出的检索串含全部语言且已归一", () => {
    const index = buildAliasIndex(rows, r => r.name)
    const text = aliasSearchTextOf(index.get("Abyssal Essence"))
    expect(text).toContain("地狱精华")
    expect(text).toContain("地獄精華")
    expect(text).toContain("abyssal essence")
    expect(text).not.toMatch(/\s{2,}/)
  })

  it("空别名不抛错", () => {
    expect(aliasSearchTextOf(undefined)).toBe("")
    expect(aliasSearchTextOf([])).toBe("")
  })
})

describe("multilang-search · 跨语言搜索（核心诉求）", () => {
  const rows = [
    { hrid: "/items/abyssal_essence", name: "Abyssal Essence" },
    { hrid: "/items/red_gem", name: "Red Gem" }
  ]
  const index = buildAliasIndex(rows, r => r.name)
  // 关键：**不传**当前语言，直接用「原文 + 全部译名」
  const getter = () => (r: typeof rows[0]) => aliasSearchTextOf(index.get(r.name))

  const hit = (keyword: string) => {
    const q = compileQuery<typeof rows[0]>({ text: buildTextQuery(keyword) }, getter as any)
    return rows.filter(q.predicate).map(r => r.name)
  }

  it("英文界面下也能用简体中文名搜到", () => {
    expect(hit("地狱精华")).toEqual(["Abyssal Essence"])
  })

  it("英文界面下也能用繁体中文名搜到", () => {
    expect(hit("地獄精華")).toEqual(["Abyssal Essence"])
  })

  it("中文界面下也能用英文名搜到", () => {
    expect(hit("abyssal")).toEqual(["Abyssal Essence"])
  })

  it("中文名搜不到时不会误命中别的物品", () => {
    expect(hit("宝石")).toEqual([])
  })

  it("多语言串不会造成误配（整串包含，不是分词）", () => {
    // 拼进检索串的是「地狱精华 地獄精華 abyssal essence」，
    // 所以「精华地獄」这种跨语言碎片**不该**命中 —— 那是分词才会有的行为。
    expect(hit("精华地獄")).toEqual([])
  })

  it("hrid 仍可搜（调试时很有用）", () => {
    const withHrid = compileQuery<typeof rows[0]>(
      { text: buildTextQuery("red_gem", "all", ["name", "hrid"]) },
      ((field: string) => (r: typeof rows[0]) => (field === "hrid" ? r.hrid : aliasSearchTextOf(index.get(r.name)))) as any
    )
    expect(rows.filter(withHrid.predicate).map(r => r.name)).toEqual(["Red Gem"])
  })
})
