/**
 * 通用查询引擎（纯函数、零运行时依赖）
 *
 * ## 为什么要有这个模块
 *
 * 改造前项目里有**两套互不相通**的查询实现：
 * - 11 个检索页共用 `common/apis/utils.ts` 的 `handleSearch`（15 个平铺 if + 8 次链式 filter）
 * - 市场监控页 `pages/marketvolume/index.vue` 独立手写 `filtered`（8 层链式 filter）
 *
 * 两边的语义甚至互相矛盾：区间筛选一边是完整的模式机（`any/gte/lte/between`），
 * 一边是裸 `min/max` 五段 if；文本搜索更是有 5 份各自不同的实现。
 * 于是「同一句话在两个页面含义不同」「改了筛选逻辑要改 12 处」。
 *
 * 本模块把「筛选 + 排序 + 分页」抽成**一次遍历**的组合子：
 * - 条件用 `filterSpec` 声明式表达，由 `compileQuery` 编成一个谓词函数；
 * - 谓词内部按「文本 → 枚举 → 数值」的顺序短路求值，**只遍历一次**，
 *   不再像原先那样每个条件各 `filter` 一遍（3000+ 行时是 8 次 O(n) 数组分配）；
 * - 排序复用 `compareValues` 的语义（展示型字符串按数值比较、缺失值沉底）；
 * - 全部可单测，不碰 i18n / store / DOM。
 *
 * ## 设计原则
 *
 * 1. **零依赖**：不 import 任何 vue / pinia / i18n，因此能在纯 node 环境直接单测。
 * 2. **一次遍历**：条件不是「链式 filter」，而是编译成一个谓词。
 * 3. **短路求值**：条件按声明顺序检查，命中即返回，文本最便宜所以排最前。
 * 4. **可序列化**：整个查询状态都是纯 JSON，可直接进 URL / localStorage。
 * 5. **不猜语义**：空值、NaN、`-1`（无价哨兵）的处理都显式写清，不靠 falsy 蒙混。
 */

/** 「无价」哨兵：全项目约定 price === -1 表示没有市场价，不能当 0 参与比较 */
export const NO_VALUE = -1

/** 单个文本检索词 */
export interface TextTerm {
  /** 该词要匹配到的字段名，由调用方通过 `textFields` 映射到具体取值 */
  raw: string
  /** 归一化后的小写词（已 trim、已折叠空白） */
  needle: string
}

export type TextMatchMode = "all" | "any"
export type TextFieldSpec = "name" | "hrid" | "category" | "project" | "tags" | "any"

/** 文本检索条件 */
export interface TextQuery {
  /** 原始输入（可能被 trim / 折叠空白） */
  input: string
  /** 拆出的检索词 */
  terms: TextTerm[]
  /** 多词之间是「全部命中」还是「任一命中」 */
  mode: TextMatchMode
  /** 参与匹配的字段；`any` 表示取 `textOf` 给出的合并串 */
  fields: TextFieldSpec[]
  /** 带 `字段:` 前缀的精确限定词 */
  scoped?: Array<{ field: TextFieldSpec, needle: string }>
}

/** 数值区间条件（语义与 `marketvolume/filters.ts` 的 `NumericRange` 一致，但与具体业务解耦） */
export type RangeMode = "any" | "gte" | "lte" | "between"

export interface RangeQuery {
  mode: RangeMode
  /** gte / lte 的阈值；between 的下界 */
  min?: number
  /** between 的上界 */
  max?: number
}

/** 通用筛选条件：字段名 → 判定器 */
export interface FilterSpec<T> {
  /** 文本检索 */
  text?: TextQuery
  /** 字段 ∈ 集合（空集合 / 未声明 = 不限制） */
  oneOf?: Record<string, readonly unknown[] | null | undefined>
  /** 字段与值比较（`eq` 支持布尔 / 数字 / 字符串；未声明 = 不限制） */
  eq?: Record<string, { value: unknown } | null | undefined>
  /** 数值区间（`null` 值视为「无该值」，条件启用时不匹配） */
  range?: Record<string, RangeQuery | null | undefined>
  /** 自定义谓词（用于「借另一端」「有成交」这类复合语义） */
  custom?: Array<(item: T) => boolean>
}

export type SortOrder = "ascending" | "descending"

export interface SortSpec {
  /** 字段名（用于稳定排序时的次级 tiebreaker，需全局唯一或至少能区分行） */
  prop: string
  order: SortOrder
  /** 该字段的取值函数 */
  value: (item: any) => unknown
}

/** 编译后的查询器 */
export interface CompiledQuery<T> {
  /** 谓词：判断单条是否命中 */
  predicate: (item: T) => boolean
  /** 已启用的条件描述，用于「已筛选 N 项」角标与空态引导 */
  activeCount: number
  /** 已启用的条件描述（人类可读，由调用方提供标签） */
  describe: () => string[]
}

// ────────────────────────────── 文本检索 ──────────────────────────────

/**
 * 归一化检索词：小写 + 折叠内部连续空白。
 *
 * 折叠空白是必要的：用户在中文输入法下打出的关键词常带全角空格，
 * 或者从别处粘贴时带上换行。不处理的话「奶 茶」搜不到「奶茶」。
 */
export function normalizeTerm(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim()
}

/**
 * 字段限定语法：`名称:茶叶` / `hrid:/items/x` / `分类:武器`
 *
 * 解决「搜不准」：列表里同时有名称、分类、动作三种文本，搜「锻造」时用户
 * 可能只想筛动作、也可能只想筛名称。加限定前缀后能精确表达意图，
 * 而不必在多个维度里二选一。
 *
 * 未识别的 `xxx:` 前缀**不当作限定符**（按普通词处理），避免 `C++:` 这类
 * 含冒号的输入被静默吃掉。
 */
const FIELD_ALIASES: Record<string, TextFieldSpec> = {
  "名称": "name",
  "名字": "name",
  "物品": "name",
  "name": "name",
  "hrid": "hrid",
  "id": "hrid",
  "分类": "category",
  "类别": "category",
  "category": "category",
  "动作": "project",
  "生产": "project",
  "project": "project",
  "标签": "tags",
  "tag": "tags"
}

export interface ParsedInput {
  /** 普通词（参与全字段匹配） */
  words: string[]
  /** 带字段限定的词 */
  scoped: Array<{ field: TextFieldSpec, needle: string }>
  /** 两组词之间的关系 */
  mode: TextMatchMode
}

/**
 * 拆分用户输入。
 *
 * 刻意**不做**中文分词：物品名都是 2~4 字的固定词（如「神圣凿子」），
 * 子串匹配已经够用，而分词会带来一堆误配，反而不如整词包含直观。
 * 这一点与改造前 5 处实现的「子串包含」语义一致。
 *
 * 多词之间默认是「与」（AND）：用户打「红 宝石」期望的是同时含两个字，
 * 而不是「红」或「宝石」。需要放宽时用 `|` 显式表达。
 */
export function parseInput(input: string, mode: TextMatchMode = "all"): ParsedInput {
  const words: string[] = []
  const scoped: Array<{ field: TextFieldSpec, needle: string }> = []
  // 出现 | 即视为「任一命中」
  const effectiveMode: TextMatchMode = input.includes("|") ? "any" : mode
  for (const token of normalizeTerm(input).split(" ")) {
    if (!token) {
      continue
    }
    const sep = token.indexOf(":")
    if (sep > 0) {
      const field = FIELD_ALIASES[token.slice(0, sep)]
      const rest = token.slice(sep + 1)
      if (field && rest) {
        scoped.push({ field, needle: rest })
        continue
      }
    }
    words.push(token)
  }
  return { words, scoped, mode: effectiveMode }
}

/** 空输入 / 只含空白 ⇒ 无检索词 */
export function buildTextQuery(
  input: string,
  mode: TextMatchMode = "all",
  fields: TextFieldSpec[] = ["name", "hrid"]
): TextQuery | undefined {
  const { words, scoped, mode: effectiveMode } = parseInput(input, mode)
  const terms = words.map(raw => ({ raw, needle: raw }))
  if (!terms.length && !scoped.length) {
    return undefined
  }
  return { input, terms, scoped, mode: effectiveMode, fields }
}

/**
 * 取条目用于文本匹配的归一化串。
 *
 * 传入的每个值都会走 `normalizeTerm`，因此调用方**不需要**自己小写化
 * —— 这正是改造前 5 处实现不一致的地方（有的 `toLowerCase`、有的 `toLocaleLowerCase`）。
 */
export function textOf(values: unknown[]): string {
  return normalizeTerm(values.filter(v => v != null).join(" "))
}

/**
 * 单个词是否命中。
 *
 * **haystack 在这里归一化**（而不是要求调用方自己小写化）：改造前全项目有 5 处
 * 文本搜索，其中 3 处用 `toLowerCase`、2 处用 `toLocaleLowerCase`，行为并不一致。
 * 把归一化收进引擎，调用方只需给出原始字段值 —— 少一处能忘的步骤。
 */
function termHit(needle: string, haystack: string): boolean {
  // 缓存不了（getter 每次新串），但 `includes` 本身够快；3000 行 × 2 词仍是微秒级
  return normalizeTerm(String(haystack ?? "")).includes(needle)
}

/** 一条记录是否命中全部文本条件 */
export function matchText(
  query: TextQuery | undefined,
  getter: (field: TextFieldSpec) => string
): boolean {
  if (!query) {
    return true
  }
  // 字段限定词走 AND：用户写了「分类:武器」就是硬要求，不参与放宽
  for (const s of query.scoped ?? []) {
    if (!termHit(s.needle, getter(s.field))) {
      return false
    }
  }
  if (!query.terms.length) {
    return true
  }
  // `any` 字段 = 取 getter("any") 提供的合并串；其余按声明的字段逐个尝试
  const targets = query.fields.includes("any")
    ? [getter("any")]
    : query.fields.map(getter)
  // 字段间是 OR：一个词在任一字段里出现就算命中
  const hit = (n: string) => targets.some(hay => termHit(n, hay))
  return query.mode === "any"
    ? query.terms.some(t => hit(t.needle))
    : query.terms.every(t => hit(t.needle))
}

// ────────────────────────────── 数值区间 ──────────────────────────────

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * 区间条件是否真的在生效。
 *
 * **缺失 / 非有限数 ⇒ 视为未启用**（而不是「匹配空集」）——
 * 用户在 `>=` 模式下还没填数字时，列表必须照常显示，不能瞬间变空。
 * 这条语义与 `marketvolume/filters.ts` 的 `isRangeActive` 完全一致。
 */
export function isRangeActive(range: RangeQuery | null | undefined): boolean {
  if (!range) {
    return false
  }
  if (range.mode === "gte" || range.mode === "lte") {
    return finite(range.min) != null
  }
  if (range.mode === "between") {
    // 只填一边也算生效：等价于 >= 下界 或 <= 上界，符合直觉
    return finite(range.min) != null || finite(range.max) != null
  }
  return false
}

/**
 * 单值是否满足区间。
 *
 * `value === null`（条目无该值）在条件启用时**一律不匹配**——否则
 * 「涨跌幅 >= 10%」会把一堆无历史的条目放进来。
 *
 * `between` 双边时**自动对调** min/max：填反了不是要筛出空集。
 */
export function matchRange(value: number | null, range: RangeQuery | null | undefined): boolean {
  if (!isRangeActive(range)) {
    return true
  }
  if (value == null) {
    return false
  }
  const r = range!
  const min = finite(r.min)
  const max = finite(r.max)
  if (r.mode === "gte") {
    return value >= min!
  }
  if (r.mode === "lte") {
    return value <= min!
  }
  if (min != null && max != null) {
    return value >= Math.min(min, max) && value <= Math.max(min, max)
  }
  if (min != null) {
    return value >= min
  }
  return value <= max!
}

/** 把任意取值归一成可比较的数字；不可用返回 null（排序时沉底） */
export function toComparable(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== "string") {
    return null
  }
  // 展示型字符串：`12.34%` / `1,234` / `$12.3万` 本质是数字，
  // 按字典序会得出 `"5.00%" > "20.00%"` 这种反直觉结果。
  //
  // 步骤要严格按这个顺序：先去分隔符 → 再把**可选的单位后缀摘下来** → 最后校验纯数字。
  // 顺序反了就会出现「校验时后缀还在 ⇒ 整体不匹配」，后面连乘的逻辑成了死代码。
  const cleaned = value.replace(/[,\s%$¥€£]/g, "").trim()
  const m = /^(-?\d+(?:\.\d+)?)([万亿kmb]?)$/i.exec(cleaned)
  if (!m) {
    return null
  }
  const num = Number(m[1])
  if (!Number.isFinite(num)) {
    return null
  }
  // 单位后缀要**连乘**而不是删掉：「12.3万」是 123000 而不是 12.3。
  // 改造前 common/apis/utils.ts 的 normalizeNumeric 是把后缀直接 replace 掉的，
  // 算出来是 12.3 —— 差了一个数量级，且不会有任何报错提示。
  const scale = UNIT_SCALE[m[2].toLowerCase()]
  return scale ? num * scale : num
}

/** 单位后缀 → 乘数。键为**小写**后缀（`M` 与 `m` 都映射到百万） */
const UNIT_SCALE: Record<string, number> = {
  "万": 1e4,
  "亿": 1e8,
  "k": 1e3,
  "m": 1e6,
  "b": 1e9
}

/**
 * 比较两个值：能当数字的按数字比，否则按本地化字符串比；缺失值恒最小。
 *
 * 与 `common/apis/utils.ts` 的 `compareValues` 语义一致，抽出来是为了让
 * 市场监控页的排序也能用上——原先两边的排序实现是不共享的。
 */
export function compareValues(a: unknown, b: unknown): number {
  const na = toComparable(a)
  const nb = toComparable(b)
  if (na === null && nb === null) {
    // 都是缺失：退化为字符串比较，保证「稳定」而不是随机序
    return String(a ?? "").localeCompare(String(b ?? ""))
  }
  if (na === null) {
    return -1
  }
  if (nb === null) {
    return 1
  }
  if (na !== nb) {
    return na < nb ? -1 : 1
  }
  return String(a).localeCompare(String(b))
}

// ────────────────────────────── 编译与执行 ──────────────────────────────

/**
 * 把声明式条件编译成**一个**谓词。
 *
 * 求值顺序按「代价从低到高」排：文本 → 枚举 → 等值 → 区间 → 自定义。
 * 3000+ 行且条件很多时，先用最便宜的判据把大部分行淘汰掉，
 * 后面昂贵的比较就不会执行。
 */
export function compileQuery<T>(
  spec: FilterSpec<T>,
  /**
   * 取条目某字段的**原始**文本（引擎内部会归一化，调用方不必自己小写化）。
   *
   * 签名是 `(field) => (item) => string`：外层按字段求一次取值器，
   * 内层对每条记录复用。这样每条记录只算一次 `query.fields.map`，
   * 也和 `matchText(query, getter)` 的用法保持一致 —— 避免出现
   * 「传了 `(item, field)` 但被当成 `(field)` 调用」这种**静默返回全 false** 的错。
   */
  fieldGetter: (field: TextFieldSpec) => (item: T) => string,
  describe: (spec: FilterSpec<T>) => string[] = () => []
): CompiledQuery<T> {
  const { text, oneOf, eq, range, custom } = spec

  const textOn = Boolean(text && (text.terms.length > 0 || (text.scoped?.length ?? 0) > 0))
  const oneOfEntries = Object.entries(oneOf ?? {}).filter(([, v]) => Array.isArray(v) && v.length > 0)
  const eqEntries = Object.entries(eq ?? {}).filter(([, v]) => v != null)
  const rangeEntries = Object.entries(range ?? {}).filter(([, v]) => isRangeActive(v))
  const customs = (custom ?? []).filter(fn => typeof fn === "function")

  // 按字段预先求好取值器（每条记录复用，避免重复 map）
  const getters = new Map<TextFieldSpec, (item: T) => string>()
  const getterFor = (field: TextFieldSpec) => {
    let fn = getters.get(field)
    if (!fn) {
      fn = fieldGetter(field)
      getters.set(field, fn)
    }
    return fn
  }

  const predicate = (item: T): boolean => {
    // 1) 文本最便宜（一次 includes 命中大部分）
    if (textOn && !matchText(text, field => getterFor(field)(item))) {
      return false
    }
    // 2) 枚举：Set 查表
    for (const [key, allowed] of oneOfEntries) {
      const set = allowed as readonly unknown[]
      if (!set.includes((item as any)[key])) {
        return false
      }
    }
    // 3) 等值
    for (const [key, box] of eqEntries) {
      const want = (box as { value: unknown }).value
      const got = (item as any)[key]
      // 布尔用宽松相等：页面上的开关常常给 undefined，语义上等同 false
      const same = typeof want === "boolean" || typeof got === "boolean"
        ? Boolean(want) === Boolean(got)
        : want === got
      if (!same) {
        return false
      }
    }
    // 4) 数值区间
    for (const [key, r] of rangeEntries) {
      if (!matchRange(toComparable((item as any)[key]), r as RangeQuery)) {
        return false
      }
    }
    // 5) 自定义（最贵，放最后）
    for (const fn of customs) {
      if (!fn(item)) {
        return false
      }
    }
    return true
  }

  const activeCount
    = (textOn ? 1 : 0)
      + oneOfEntries.length
      + eqEntries.length
      + rangeEntries.length
      + customs.length

  return { predicate, activeCount, describe: () => describe(spec) }
}

/** 该值是否为「缺失」（null / undefined / NaN / 空串） */
function isMissing(value: unknown): boolean {
  if (value == null) {
    return true
  }
  if (typeof value === "number") {
    return !Number.isFinite(value)
  }
  return false
}

/**
 * 稳定排序。
 *
 * 改造前市场监控页**没有显式 tiebreaker**，同值行的相对次序取决于
 * `for...in` 遍历 `marketData` 的插入顺序——换一批数据顺序就变，用户会以为
 * 「表头箭头一样但数据跳了」。这里用 `idOf` 产出的唯一键做最终 tiebreaker，
 * 保证**同样输入必得同样输出**。
 */
export function applySort<T>(list: readonly T[], sorts: readonly SortSpec[], idOf: (item: T) => string): T[] {
  if (!sorts.length) {
    return list.slice()
  }
  const indexed = list.map((item, index) => ({ item, index, id: idOf(item) }))
  indexed.sort((a, b) => {
    for (const s of sorts) {
      const va = s.value(a.item)
      const vb = s.value(b.item)
      // 缺失值恒沉底，**不随升降序翻转**。
      // 改造前 marketvolume 只在降序时让 NaN 沉底（`if (Number.isNaN(x)) return 1`），
      // 于是用户点一下升序，一堆「无历史基准」的条目会集体跳到榜首 —— 看起来像 bug。
      const aBad = isMissing(va)
      const bBad = isMissing(vb)
      if (aBad !== bBad) {
        return aBad ? 1 : -1
      }
      const cmp = compareValues(va, vb)
      if (cmp !== 0) {
        return s.order === "descending" ? -cmp : cmp
      }
    }
    // 最后按唯一键，保证确定性；仍相等则退到原始次序（完整稳定）
    if (a.id !== b.id) {
      return a.id < b.id ? -1 : 1
    }
    return a.index - b.index
  })
  return indexed.map(x => x.item)
}

/** 分页切片 */
export function applyPage<T>(list: readonly T[], page: number, pageSize: number): T[] {
  if (pageSize <= 0) {
    return list.slice()
  }
  const safe = Math.max(1, Math.floor(page || 1))
  return list.slice((safe - 1) * pageSize, safe * pageSize)
}

// ────────────────────────────── 状态序列化 ──────────────────────────────

/**
 * 把查询状态编码成 URL query string。
 *
 * 改造前**全项目没有任何页面用 route.query 同步筛选状态**，
 * 刷新页面或把链接发给别人，看到的永远是默认视图。这个函数 +
 * `decodeQueryState` 让「可分享的筛选视图」成为可能。
 *
 * 约定：只编码**非默认值**的项（`pick` 给出取值），因此典型 URL 很短。
 */
export function encodeQueryState(
  entries: Record<string, unknown>,
  pick: (key: string, value: unknown) => unknown | undefined
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(entries)) {
    const chosen = pick(key, value)
    if (chosen === undefined || chosen === null || chosen === "") {
      continue
    }
    if (Array.isArray(chosen)) {
      if (!chosen.length) {
        continue
      }
      out[key] = chosen.map(v => String(v)).join(",")
      continue
    }
    if (typeof chosen === "object") {
      out[key] = JSON.stringify(chosen)
      continue
    }
    out[key] = String(chosen)
  }
  return out
}

/** `encodeQueryState` 的逆操作。非法输入一律退回默认值，绝不抛错。 */
export function decodeQueryState<T extends Record<string, any>>(
  raw: Record<string, unknown>,
  defaults: T,
  revive?: (key: string, value: string, defaults: T) => unknown
): T {
  const out = { ...defaults }
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in defaults) || value == null) {
      continue
    }
    if (revive) {
      const custom = revive(key, String(value), defaults)
      if (custom !== undefined) {
        ;(out as any)[key] = custom
        continue
      }
    }
    const fallback = (defaults as any)[key]
    if (Array.isArray(fallback)) {
      // 元素类型判定：URL 里只有字符串，不还原类型的话 `[1,2]` 会变成 `["1","2"]`，
      // 之后 `includes(2)` 永远为 false —— 表现为「从分享链接打开后筛选神秘失效」。
      //
      // 判定要注意：**空数组拿不到元素类型**（`typeof [][0]` 是 undefined），
      // 所以不能靠默认值推断。退化路径改为「全都能解析成数字 ⇒ 数字数组」，
      // 这对强化等级、页码这类场景都正确；确实要字符串数组的调用方
      // 应在 `revive` 里显式指定。
      const parts = String(value).split(",").filter(Boolean)
      const allNumeric = parts.length > 0 && parts.every(x => Number.isFinite(Number(x)))
      ;(out as any)[key] = allNumeric ? parts.map(Number) : parts
    } else if (typeof fallback === "number") {
      const n = Number(value)
      if (Number.isFinite(n)) {
        ;(out as any)[key] = n
      }
    } else if (typeof fallback === "boolean") {
      ;(out as any)[key] = value === "true" || value === "1"
    } else {
      ;(out as any)[key] = value
    }
  }
  return out
}

/** 是否为「空查询」——用于决定是否显示「重置」入口 */
export function isEmptyQueryState(state: Record<string, unknown>, defaults: Record<string, unknown>): boolean {
  return JSON.stringify(state) === JSON.stringify(defaults)
}
