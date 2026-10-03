import { describe, expect, it } from "vitest"
import {
  applyPage,
  applySort,
  buildTextQuery,
  compileQuery,
  compareValues,
  decodeQueryState,
  encodeQueryState,
  isEmptyQueryState,
  isRangeActive,
  matchRange,
  matchText,
  parseInput,
  toComparable
} from "@/common/utils/query-engine"

/**
 * 查询引擎的回归测试
 *
 * 覆盖三类性质：
 * 1. **语义正确**：文本/区间/排序/序列化各自的边界语义（大量反例）；
 * 2. **与改造前等价**：原 `marketvolume/filters.ts` 的 25 个用例语义不能被改坏；
 * 3. **确定性**：同样输入必得同样输出（这是改造前真实缺的一条）。
 */

interface Row {
  name: string
  hrid: string
  category: string
  project: string
  level: number
  price: number
  changePct: number | null
  onlyFavorite: boolean
}

function makeRow(over: Partial<Row> = {}): Row {
  return {
    name: "Abyssal Essence",
    hrid: "/items/abyssal_essence",
    category: "/items/material",
    project: "锻造",
    level: 3,
    price: 100,
    changePct: 5,
    onlyFavorite: false,
    ...over
  }
}

describe("query-engine · 文本归一化", () => {
  it("小写化并折叠内部连续空白（中文输入法常带全角空格）", () => {
    expect(parseInput("  Red   GEM  ").words).toEqual(["red", "gem"])
    expect(parseInput("　宝石　").words).toEqual(["宝石"])
  })

  it("纯空白 / 空串 ⇒ 无词", () => {
    expect(parseInput("").words).toEqual([])
    expect(parseInput("   ").words).toEqual([])
    expect(buildTextQuery("   ")).toBeUndefined()
  })

  it("多词默认是「与」；出现 | 则放宽为「或」", () => {
    expect(parseInput("red gem").mode).toBe("all")
    expect(parseInput("red | gem").mode).toBe("any")
  })
})

describe("query-engine · 字段限定语法", () => {
  it("识别中英字段前缀", () => {
    const p = parseInput("名称:茶叶 hrid:/items/tea 分类:weapon project:锻造")
    expect(p.scoped).toEqual([
      { field: "name", needle: "茶叶" },
      { field: "hrid", needle: "/items/tea" },
      { field: "category", needle: "weapon" },
      { field: "project", needle: "锻造" }
    ])
    expect(p.words).toEqual([])
  })

  it("未识别的 xxx: 前缀不当作限定符（保护 C++: 这类输入）", () => {
    const p = parseInput("c++:lang")
    expect(p.scoped).toEqual([])
    expect(p.words).toEqual(["c++:lang"])
  })

  it("限定词与普通词共存：限定词走 AND", () => {
    // category 字段存的是 hrid（英文），所以限定词也要用英文写 ——
    // 真实页面会把本地化名一起塞进 `any` 字段，那是调用方的职责。
    const q = buildTextQuery("category:weapon 宝石")!
    const row = makeRow({ category: "/items/weapon", name: "红宝石剑" })
    const ok = (r: Row) => matchText(q, (f) => String((r as any)[f] ?? ""))
    expect(ok(row)).toBe(true)
    // 分类不符 ⇒ 直接否
    expect(ok(makeRow({ category: "/items/material", name: "红宝石剑" }))).toBe(false)
    // 分类对但名字不含「宝石」⇒ 普通词不命中
    expect(ok(makeRow({ category: "/items/weapon", name: "铁剑" }))).toBe(false)
  })

  it("只有限定词时也能构成有效查询", () => {
    const q = buildTextQuery("category:weapon")!
    expect(q).toBeTruthy()
    expect(q.terms).toEqual([])
    const ok = (r: Row) => matchText(q, (f) => String((r as any)[f] ?? ""))
    expect(ok(makeRow({ category: "/items/weapon" }))).toBe(true)
    expect(ok(makeRow({ category: "/items/material" }))).toBe(false)
  })
})

describe("query-engine · 文本匹配", () => {
  it("空查询恒匹配（不能因为没输关键词就把列表清空）", () => {
    expect(matchText(undefined, () => "任意")).toBe(true)
  })

  it("大小写不敏感，且不依赖调用方自己小写化", () => {
    const q = buildTextQuery("ABYSSAL")!
    expect(matchText(q, () => "abyssal essence")).toBe(true)
    expect(matchText(q, () => "Abyssal Essence")).toBe(true)
  })

  it("字段间是 OR：一个词在任一字段命中即可", () => {
    const q = buildTextQuery("tea")!
    const ok = (r: Row) => matchText(q, f => String((r as any)[f] ?? ""))
    expect(ok(makeRow({ name: "Tea Leaves" }))).toBe(true)
    expect(ok(makeRow({ name: "Other", hrid: "/items/tea_stone" }))).toBe(true)
    expect(ok(makeRow({ name: "Other", hrid: "/items/rock" }))).toBe(false)
  })

  it("多词是 AND：必须同时含两个字", () => {
    const q = buildTextQuery("red gem")!
    const ok = (r: Row) => matchText(q, f => String((r as any)[f] ?? ""))
    expect(ok(makeRow({ name: "Red Gem" }))).toBe(true)
    expect(ok(makeRow({ name: "Red Stone" }))).toBe(false)
  })

  it("多词用 | 放宽为 OR", () => {
    const q = buildTextQuery("red | gem")!
    const ok = (r: Row) => matchText(q, f => String((r as any)[f] ?? ""))
    expect(ok(makeRow({ name: "Red Stone" }))).toBe(true)
    expect(ok(makeRow({ name: "Blue Gem" }))).toBe(true)
    expect(ok(makeRow({ name: "Blue Stone" }))).toBe(false)
  })
})

describe("query-engine · 数值区间", () => {
  it("未启用（mode=any / 缺阈值）时恒匹配，而不是匹配空集", () => {
    expect(isRangeActive({ mode: "any", min: 5 })).toBe(false)
    expect(isRangeActive({ mode: "gte" })).toBe(false)
    expect(isRangeActive({ mode: "gte", min: Number.NaN })).toBe(false)
    expect(isRangeActive(null)).toBe(false)
    expect(matchRange(1, { mode: "gte" })).toBe(true)
    expect(matchRange(1, undefined)).toBe(true)
  })

  it("between 只填一边也算生效（等价于单边比较）", () => {
    expect(isRangeActive({ mode: "between", min: 5 })).toBe(true)
    expect(isRangeActive({ mode: "between", max: 5 })).toBe(true)
    expect(matchRange(7, { mode: "between", min: 5 })).toBe(true)
    expect(matchRange(3, { mode: "between", min: 5 })).toBe(false)
    expect(matchRange(3, { mode: "between", max: 5 })).toBe(true)
  })

  it("between 双边自动对调（填反了不是要筛出空集）", () => {
    expect(matchRange(7, { mode: "between", min: 10, max: 5 })).toBe(true)
    expect(matchRange(3, { mode: "between", min: 10, max: 5 })).toBe(false)
  })

  it("端点一律包含（与提醒规则的 gte/lte 同一语义）", () => {
    expect(matchRange(5, { mode: "gte", min: 5 })).toBe(true)
    expect(matchRange(5, { mode: "lte", min: 5 })).toBe(true)
    expect(matchRange(5, { mode: "between", min: 5, max: 10 })).toBe(true)
    expect(matchRange(10, { mode: "between", min: 5, max: 10 })).toBe(true)
  })

  it("条目无该值（null）时，条件启用则不匹配", () => {
    expect(matchRange(null, { mode: "gte", min: 1 })).toBe(false)
    expect(matchRange(null, { mode: "any" })).toBe(true)
  })
})

describe("query-engine · 展示型数值归一", () => {
  it("百分号 / 千分位 / 万 / M 都能解析成数字", () => {
    expect(toComparable("12.34%")).toBeCloseTo(12.34)
    expect(toComparable("1,234")).toBe(1234)
    expect(toComparable("12.3万")).toBe(123000)
    expect(toComparable("1.2M")).toBe(1200000)
    expect(toComparable(5)).toBe(5)
  })

  it("无法解析 ⇒ null（排序时沉底）", () => {
    expect(toComparable("abc")).toBeNull()
    expect(toComparable(null)).toBeNull()
    expect(toComparable(undefined)).toBeNull()
    expect(toComparable(Infinity)).toBeNull()
    expect(toComparable(Number.NaN)).toBeNull()
  })

  it("按展示值比较，避免 5.00% > 20.00% 的反直觉结果", () => {
    expect(compareValues("5.00%", "20.00%")).toBeLessThan(0)
    expect(compareValues("1,000", "999")).toBeGreaterThan(0)
  })

  it("缺失值恒最小，不因升降序而翻到顶部", () => {
    expect(compareValues(null, 5)).toBeLessThan(0)
    expect(compareValues(5, null)).toBeGreaterThan(0)
    expect(compareValues(null, undefined)).toBe(0)
  })
})

describe("query-engine · 编译后的谓词", () => {
  const fieldGetter = (field: string) => (r: Row) => String((r as any)[field] ?? "")

  it("空 spec ⇒ 全部命中，activeCount 为 0", () => {
    const q = compileQuery<Row>({}, fieldGetter as any)
    expect(q.predicate(makeRow())).toBe(true)
    expect(q.activeCount).toBe(0)
  })

  it("一次遍历完成全部条件（谓词而非链式 filter）", () => {
    const q = compileQuery<Row>(
      {
        text: buildTextQuery("abyssal"),
        oneOf: { category: ["/items/material"] },
        range: { price: { mode: "gte", min: 50 } }
      },
      fieldGetter as any
    )
    expect(q.activeCount).toBe(3)
    expect(q.predicate(makeRow({ price: 100 }))).toBe(true)
    expect(q.predicate(makeRow({ price: 10 }))).toBe(false)
    expect(q.predicate(makeRow({ category: "/items/other" }))).toBe(false)
    // 只改 name 不改 hrid 是不够的 —— 默认 hrid 是 /items/abyssal_essence，
    // 本身含 "abyssal"，文本条件照样命中。要否掉必须让 name 与 hrid 都不含。
    expect(q.predicate(makeRow({ name: "Totally Different", hrid: "/items/zzz" }))).toBe(false)
  })

  it("枚举 / 区间 / 自定义 都会被计入 activeCount", () => {
    const q = compileQuery<Row>(
      {
        oneOf: { level: [1, 2, 3] },
        eq: { onlyFavorite: { value: true } },
        range: { changePct: { mode: "lte", min: 0 } },
        custom: [r => r.price > 1]
      },
      fieldGetter as any
    )
    expect(q.activeCount).toBe(4)
    expect(q.predicate(makeRow({ onlyFavorite: true, changePct: -1 }))).toBe(true)
    expect(q.predicate(makeRow({ onlyFavorite: false, changePct: -1 }))).toBe(false)
  })

  it("未生效的区间不计入 activeCount 也不参与过滤", () => {
    const q = compileQuery<Row>({ range: { price: { mode: "any", min: 999 } } }, fieldGetter as any)
    expect(q.activeCount).toBe(0)
    expect(q.predicate(makeRow({ price: 1 }))).toBe(true)
  })

  it("空集合 / 未声明的枚举条件 = 不限制", () => {
    const q = compileQuery<Row>({ oneOf: { category: [] } }, fieldGetter as any)
    expect(q.activeCount).toBe(0)
    expect(q.predicate(makeRow())).toBe(true)
  })

  it("布尔等值用宽松比较（undefined 视同 false）", () => {
    const q = compileQuery<Row>({ eq: { onlyFavorite: { value: false } } }, fieldGetter as any)
    expect(q.predicate(makeRow({ onlyFavorite: false }))).toBe(true)
    expect(q.predicate({ ...makeRow(), onlyFavorite: undefined } as any)).toBe(true)
    expect(q.predicate(makeRow({ onlyFavorite: true }))).toBe(false)
  })

  it("短路求值：文本先判，后面的昂贵条件不再执行", () => {
    let customCalls = 0
    const q = compileQuery<Row>(
      {
        text: buildTextQuery("不存在的词"),
        custom: [() => {
          customCalls++
          return true
        }]
      },
      fieldGetter as any
    )
    expect(q.predicate(makeRow())).toBe(false)
    expect(customCalls, "文本已否掉时不应执行自定义谓词").toBe(0)
  })

  it("组合语义：结果与「逐条件链式 filter」完全一致（大量随机组合）", () => {
    const rows: Row[] = []
    for (let i = 0; i < 60; i++) {
      rows.push(makeRow({
        name: i % 3 === 0 ? "红宝石" : i % 3 === 1 ? "Blue Tea" : "Plain Rock",
        category: i % 2 === 0 ? "/items/weapon" : "/items/material",
        level: i % 4,
        price: i * 7 - 10,
        changePct: i % 5 === 0 ? null : i - 20,
        onlyFavorite: i % 6 === 0
      }))
    }
    for (let seed = 0; seed < 40; seed++) {
      const spec = {
        text: buildTextQuery(seed % 2 === 0 ? "宝石" : "blue | rock"),
        oneOf: seed % 3 === 0 ? { category: ["/items/material"] } : {},
        range: seed % 4 === 0 ? { price: { mode: "gte" as const, min: 100 } } : {},
        eq: seed % 5 === 0 ? { onlyFavorite: { value: false } } : {}
      }
      // 参考实现：老老实实链式 filter
      const reference = rows.filter((r) => {
        const g = (f: string) => String((r as any)[f] ?? "")
        if (!matchText(spec.text, g as any)) {
          return false
        }
        if (spec.oneOf.category && !spec.oneOf.category.includes(r.category)) {
          return false
        }
        if (spec.range.price && !matchRange(toComparable(r.price), spec.range.price)) {
          return false
        }
        if (spec.eq.onlyFavorite && Boolean(spec.eq.onlyFavorite.value) !== r.onlyFavorite) {
          return false
        }
        return true
      })
      const q = compileQuery<Row>(spec, fieldGetter as any)
      const actual = rows.filter(q.predicate)
      expect(actual.map(r => r.price), `seed=${seed}`).toEqual(reference.map(r => r.price))
    }
  })
})

describe("query-engine · 稳定排序", () => {
  const rows = [
    { id: "a", name: "A", v: 10 },
    { id: "b", name: "B", v: 10 },
    { id: "c", name: "C", v: 30 },
    { id: "d", name: "D", v: null as number | null }
  ]
  const idOf = (r: typeof rows[0]) => r.id
  const byV = { prop: "v", order: "descending" as const, value: (r: typeof rows[0]) => r.v }

  it("按数值降序，缺失值沉底（不因降序而翻到顶部）", () => {
    const out = applySort(rows, [byV], idOf)
    expect(out.map(r => r.id)).toEqual(["c", "a", "b", "d"])
  })

  it("同值行有确定次序（显式 tiebreaker），不依赖输入顺序", () => {
    const shuffled = [rows[1], rows[3], rows[0], rows[2]]
    const out = applySort(shuffled, [byV], idOf)
    expect(out.map(r => r.id)).toEqual(["c", "a", "b", "d"])
  })

  it("反复排序结果恒等（幂等）", () => {
    const once = applySort(rows, [byV], idOf).map(r => r.id)
    const twice = applySort(applySort(rows, [byV], idOf), [byV], idOf).map(r => r.id)
    expect(twice).toEqual(once)
  })

  it("多级排序：前者相等才看后者", () => {
    const data = [
      { g: 1, v: 5, id: "x" },
      { g: 1, v: 9, id: "y" },
      { g: 2, v: 1, id: "z" }
    ]
    const out = applySort(data, [
      { prop: "g", order: "ascending", value: (r: any) => r.g },
      { prop: "v", order: "descending", value: (r: any) => r.v }
    ], r => r.id)
    expect(out.map(r => r.id)).toEqual(["y", "x", "z"])
  })

  it("空排序规则 ⇒ 原样返回副本", () => {
    const out = applySort(rows, [], idOf)
    expect(out).not.toBe(rows)
    expect(out.map(r => r.id)).toEqual(["a", "b", "c", "d"])
  })

  it("升序时缺失值仍沉底", () => {
    const out = applySort(rows, [{ ...byV, order: "ascending" }], idOf)
    expect(out[out.length - 1].id).toBe("d")
  })
})

describe("query-engine · 分页", () => {
  const rows = Array.from({ length: 25 }, (_, i) => i + 1)

  it("切片正确", () => {
    expect(applyPage(rows, 1, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(applyPage(rows, 3, 10)).toEqual([21, 22, 23, 24, 25])
  })

  it("页码越界 / 非法值不抛错", () => {
    expect(applyPage(rows, 99, 10)).toEqual([])
    expect(applyPage(rows, 0, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(applyPage(rows, -5, 10)[0]).toBe(1)
    expect(applyPage(rows, 1, 0)).toEqual(rows)
  })
})

describe("query-engine · 状态序列化（可分享的筛选视图）", () => {
  const defaults = { keyword: "", category: "", level: 0, onlyFavorite: false, enhanceLevels: [] as number[] }

  it("只编码非默认值", () => {
    const out = encodeQueryState({ keyword: "宝石", category: "", level: 0 }, (k, v) => (v ? v : undefined))
    expect(out).toEqual({ keyword: "宝石" })
  })

  it("数组用逗号连接，空数组不编码", () => {
    const out = encodeQueryState({ enhanceLevels: [1, 3] }, (k, v) => v)
    expect(out).toEqual({ enhanceLevels: "1,3" })
    expect(encodeQueryState({ enhanceLevels: [] }, (k, v) => v)).toEqual({})
  })

  it("encode → decode 往返一致（这是 URL 同步的正确性保证）", () => {
    const state = { keyword: "红 宝石", category: "/items/weapon", level: 7, onlyFavorite: true, enhanceLevels: [1, 2] }
    // 只编码「非默认值」：空串 / 0 / false / 空数组都跳过
    const isDefault = (v: unknown) => v === "" || v === 0 || v === false || v == null || (Array.isArray(v) && !v.length)
    const encoded = encodeQueryState(state, (k, v) => (isDefault(v) ? undefined : v))
    const decoded = decodeQueryState(encoded, defaults)
    expect(decoded).toEqual(state)
  })

  it("数组元素类型跟随默认值（URL 往返不能把 [1,2] 变成 [\"1\",\"2\"]）", () => {
    // 这是一条真实会咬人的坑：URL 里只有字符串，类型不还原的话
    // enhanceLevels.includes(2) 恒为 false，表现为「从分享链接打开后筛选失效」。
    const out = decodeQueryState({ enhanceLevels: "1,2,3" }, defaults)
    expect(out.enhanceLevels).toEqual([1, 2, 3])
    expect(out.enhanceLevels.includes(2)).toBe(true)
    // 字符串数组则保持字符串
    const strOut = decodeQueryState({ tags: "a,b" }, { tags: [] as string[] })
    expect(strOut.tags).toEqual(["a", "b"])
    // 混入非数字项时**保守地当字符串数组**（全数字才转数字）。
    // 这是有意的：宁可让筛选条件一个都不命中（用户看得见），
    // 也不要悄悄把 "x" 丢掉、留下一个用户没要求过的子集。
    const dirty = decodeQueryState({ enhanceLevels: "1,x,3" }, defaults)
    expect(dirty.enhanceLevels).toEqual(["1", "x", "3"])
    // 确实要字符串数组时，调用方可在 revive 里显式指定。
    // 注意 revive 只对 **defaults 里已声明** 的键生效 —— 未知键一律忽略（安全设计）。
    const withStr = { ...defaults, tags: [] as string[] }
    const revived = decodeQueryState({ tags: "1,2" }, withStr, (k, v, d) => {
      if (k === "tags" && (d as any).tags.length === 0) {
        return v.split(",")
      }
      return undefined
    })
    expect(revived.tags).toEqual(["1", "2"])
  })

  it("未知键被忽略；缺字段回落默认值", () => {
    const out = decodeQueryState({ 不存在: "x", keyword: "茶" }, defaults)
    expect(out).toEqual({ ...defaults, keyword: "茶" })
  })

  it("非法数字不覆盖默认值（不让 NaN 进状态）", () => {
    const out = decodeQueryState({ level: "abc" }, defaults)
    expect(out.level).toBe(0)
    expect(Number.isNaN(out.level)).toBe(false)
  })

  it("空查询判定", () => {
    expect(isEmptyQueryState(defaults, defaults)).toBe(true)
    expect(isEmptyQueryState({ ...defaults, keyword: "x" }, defaults)).toBe(false)
  })
})
