import type Calculator from "@/calculator"
import type { StorageCalculatorItem } from "@/pinia/stores/favorite"
import type { Action } from "~/game"
import { CoinifyCalculator, DecomposeCalculator, TransmuteCalculator } from "@/calculator/alchemy"
import { GatherCalculator } from "@/calculator/gather"
import { ManufactureCalculator } from "@/calculator/manufacture"
import { getStorageCalculatorItem } from "@/calculator/utils"
import { WorkflowCalculator } from "@/calculator/workflow"
import { getActionConfigOf, getDrinkConcentration, getDrinkSlotCount } from "@/common/apis/player"
import { usePlayerStoreOutside } from "@/pinia/stores/player"
import { getTrans } from "@/locales"
import { COIN_HRID } from "@/pinia/stores/game"
import { getGameDataApi } from "../game"

/**
 * 手动产业链：用户按「项目+动作+物品」逐节点缀连，自动跨环节 0 价流转并整链核算利润。
 * 采集(挤奶/采摘/伐木) → GatherCalculator
 * 制造(锻造/制造/裁缝/烹饪/冲泡) → ManufactureCalculator
 * 炼金(转化/分解/点金) → Transmute/Decompose/CoinifyCalculator
 */
export interface ChainStep {
  /** 项目显示名（如 制造/转化），用于 Calculator.project */
  project: string
  action: Action
  kind: "gather" | "manufacture" | "transmute" | "decompose" | "coinify"
  /** 物品 hrid */
  hrid: string
  /** 炼金催化剂 0=无 1=普通 2=主要 */
  catalystRank?: number
  /** 炼金环节非末尾时：指定"流向下一阶段"的产物 hrid */
  outHrid?: string
}

export interface ChainProjectOption {
  label: string
  action: Action
  kind: ChainStep["kind"]
}

export interface ChainItemOption {
  hrid: string
  name: string
  /** 中文名（来自游戏语言包），用于展示与搜索 */
  cn?: string
}

/**
 * 在候选物品里做多路匹配：**英文名 / 中文名 / hrid 片段**。
 *
 * ⚠️ 三路都要的原因：玩家接触这个游戏的入口不同 ——
 * 中文玩家打「奶酪」，从 Wiki 或别人分享里来的人打 `/items/azure_cheese`，
 * 英文玩家打 `Azure Cheese`。只支持一种，另外两种人就「搜不到」。
 *
 * 与 `common/utils/multilang-search.ts` 的 `normalizeTerm` 同思路（都做小写化），
 * 但这里只需要「包含」判定，不需要多词 AND/OR 语法，故不复用整套引擎。
 */
export function filterChainItems<T extends ChainItemOption>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return items.filter((i) =>
    i.name.toLowerCase().includes(q)
    || (i.cn && i.cn.includes(query.trim()))
    || i.hrid.toLowerCase().includes(q)
  )
}

/**
 * 下拉框用的过滤：**空关键字返回全量**。
 *
 * ⚠️ 不要把它和 `filterChainItems` 混用：后者的语义是「搜索」，空串返回 `[]`
 * （那样调用方才分得清「没搜到」和「没搜索」）。
 * 而 `el-select` 的选项列表需要「过滤」语义 —— 输入框一清空就该显示全部候选，
 * 否则用户会看到「搜索框一删就什么选项都没有」。
 *
 * 这个区别曾经真实踩坑：早前进阶模式把 `filterChainItems` 的结果直接丢弃
 * （`filter-method` 的返回值无效），搜索框完全不生效，详见页面里的注释。
 */
export function filterChainOptions<T extends ChainItemOption>(items: T[], query: string): T[] {
  return query.trim() ? filterChainItems(items, query) : items
}

/** 可选项目列表 */
export function getChainProjectOptions(): ChainProjectOption[] {
  return [
    { label: getTrans("挤奶"), action: "milking", kind: "gather" },
    { label: getTrans("采摘"), action: "foraging", kind: "gather" },
    { label: getTrans("伐木"), action: "woodcutting", kind: "gather" },
    { label: getTrans("锻造"), action: "cheesesmithing", kind: "manufacture" },
    { label: getTrans("制造"), action: "crafting", kind: "manufacture" },
    { label: getTrans("裁缝"), action: "tailoring", kind: "manufacture" },
    { label: getTrans("烹饪"), action: "cooking", kind: "manufacture" },
    { label: getTrans("冲泡"), action: "brewing", kind: "manufacture" },
    { label: getTrans("转化"), action: "alchemy", kind: "transmute" },
    { label: getTrans("分解"), action: "alchemy", kind: "decompose" },
    { label: getTrans("点金"), action: "alchemy", kind: "coinify" }
  ]
}

export function isAlchemyKind(kind: ChainStep["kind"]): boolean {
  return kind === "transmute" || kind === "decompose" || kind === "coinify"
}

/** 按环节类型实例化对应计算器 */
export function buildChainCalculator(step: ChainStep): Calculator {
  const { project, action, hrid, catalystRank = 0 } = step
  switch (step.kind) {
    case "gather":
      return new GatherCalculator({ hrid, project, action })
    case "manufacture":
      return new ManufactureCalculator({ hrid, project, action })
    case "transmute":
      return new TransmuteCalculator({ hrid, catalystRank })
    case "decompose":
      return new DecomposeCalculator({ hrid, catalystRank })
    case "coinify":
      return new CoinifyCalculator({ hrid, catalystRank })
  }
}

/** 缓存：kind-action -> 可选物品列表 */
const itemOptionCache = new Map<string, ChainItemOption[]>()

/** 某项目下可用的物品候选（懒生成+缓存） */
export function getChainStepItemOptions(step: Pick<ChainStep, "project" | "action" | "kind">): ChainItemOption[] {
  const key = `${step.kind}-${step.action}`
  const cached = itemOptionCache.get(key)
  if (cached) return cached

  const gameData = getGameDataApi()
  const options: ChainItemOption[] = []
  for (const item of Object.values(gameData.itemDetailMap)) {
    const cal = buildChainCalculator({ ...step, hrid: item.hrid, catalystRank: 0 } as ChainStep)
    if (cal.available) {
      // cn：游戏语言包里的中文名，供搜索与展示（getTrans 在英文界面原样返回英文名）
      options.push({ hrid: item.hrid, name: item.name, cn: getTrans(item.name) as string })
    }
  }
  options.sort((a, b) => a.name.localeCompare(b.name))
  itemOptionCache.set(key, options)
  return options
}

/** 炼金环节的衔接产物候选（供非末尾炼金指定下游产物） */
export function getChainAlchemyOutputOptions(step: ChainStep): ChainItemOption[] {
  if (!step.hrid) return []
  const cal = buildChainCalculator(step)
  if (!cal.available) return []
  const gameData = getGameDataApi()
  return cal.productList
    .filter(p => p.hrid && p.hrid !== step.hrid)
    .map(p => ({
      hrid: p.hrid,
      name: gameData.itemDetailMap[p.hrid]?.name || p.hrid
    }))
}

/* ──────────────────────────────────────────────────────────────────────────
 * 以下是给「新手模式」加的能力（2026-10-07）
 *
 * 改造前的实测问题：11 个项目里单个下拉最多 **889 项**（点金），
 * 且要用户先想清楚「我的原料是什么」。而新手的心智是
 * 「我想做这个东西，划算吗」—— 所以下面这套是**从成品倒推**。
 * ────────────────────────────────────────────────────────────────────────── */

/** 一个物品能被哪些「项目」生产出来（反向查询）。用于「我想做 X」的入口。 */
export interface ChainMakerOption extends ChainItemOption {
  project: string
  action: Action
  kind: ChainStep["kind"]
  /** 该环节 1 次产出里，这个物品占多少 */
  count: number
  /**
   * 该填进 `ChainStep.hrid` 的物品 —— **不一定等于 `hrid`**。
   *
   * ⚠️ 两类计算器的解析方向**相反**：
   * - 采集 / 制造：`hrid` 是**产物**（配方按产出查）⇒ `stepHrid === hrid`
   * - 炼金（转化/分解/点金）：`hrid` 是**投入**（掉落表按投入查）
   *   ⇒ 想得到 X，要投入的是**别的东西**，`stepHrid` 是那个投入品
   *
   * 早前实现把两者混为一谈，导致炼金环节被完全算错（详见 getChainMakersOf 注释）。
   */
  stepHrid: string
  /** 炼金环节：这一步拿到 `hrid` 的命中率（0~1）。非炼金为 undefined（视为 1） */
  rate?: number
}

const makerCache = new Map<string, ChainMakerOption[]>()

/**
 * 炼金「产出 → 投入」反查表（按 kind 缓存）。
 *
 * 为什么必须反查：炼金计算器是按**投入**解析的 ——
 * `buildChainCalculator({kind:'transmute', hrid: A})` 给你「把 A 转化能出什么」。
 * 所以想知道「谁能做出 X」，不能拿 X 当投入去试（那只能得到 X 自己的回流），
 * 必须扫全部可投入物品，看谁的产出表里有 X。
 *
 * 成本实测（2026-10-07）：transmute 622 个输入 36ms、decompose 742 个 18ms、
 * coinify 889 个 11ms —— 总计约 65ms，可接受，故直接缓存全表。
 */
const alchemyReverseCache = new Map<string, Map<string, { inputHrid: string, rate: number, count: number }[]>>()

function getAlchemyReverseIndex(kind: "transmute" | "decompose" | "coinify") {
  const cached = alchemyReverseCache.get(kind)
  if (cached) return cached

  const idx = new Map<string, { inputHrid: string, rate: number, count: number }[]>()
  const inputs = getChainStepItemOptions({ project: "", action: "alchemy", kind } as Pick<ChainStep, "project" | "action" | "kind">)
  for (const o of inputs) {
    let cal: Calculator
    try {
      cal = buildChainCalculator({ project: "", action: "alchemy", kind, hrid: o.hrid } as ChainStep)
    } catch {
      continue
    }
    if (!cal.available) continue
    for (const p of cal.productList) {
      const cnt = p.count ?? 0
      if (cnt <= 0) continue
      // 自我回流不算「能做出它」：转 1 个 A 拿回 0.74 个 A 是净亏，不是生产
      if (p.hrid === o.hrid) continue
      const arr = idx.get(p.hrid) || []
      arr.push({ inputHrid: o.hrid, rate: p.rate ?? 1, count: cnt })
      idx.set(p.hrid, arr)
    }
  }
  alchemyReverseCache.set(kind, idx)
  return idx
}

/**
 * 「哪些做法能做出这个物品」。
 *
 * ## ⚠️ 旧实现的判据是错的（2026-10-07 修）
 *
 * 旧代码用 `getChainStepItemOptions({kind, action})` 判断「该项目能不能做 X」，
 * 但那个函数返回的是「该动作**可作用于**哪些物品」（合法**输入**），不是产出。
 * ⇒ 每个物品都会被错误地挂上 转化 / 分解 / 点金：
 *
 * ```
 * getChainMakersOf(原奶)     → [挤奶, 转化, 分解, 点金]   ← 后三个全错
 * getChainMakersOf(保护之镜) → [制造, 转化, 分解, 点金]   ← 用户实测踩到
 * ```
 *
 * 用户实测症状：「不管选转化还是分解还是点金，出来的都是保护之镜碎片」——
 * 因为下游 `getChainIngredientsOf` 永远取列表里的**第一个** maker（制造），
 * 而制造保护之镜的原料正是 `/items/shard_of_protection`（保护之镜碎片 ×180）。
 *
 * 现在按**真实产出**判定：
 * - 采集 / 制造：计算器按产物解析，直接用 `hrid = X` 建，看 productList 里有没有 X
 * - 炼金：查反查表（见 getAlchemyReverseIndex）
 */
export function getChainMakersOf(itemHrid: string): ChainMakerOption[] {
  const cached = makerCache.get(itemHrid)
  if (cached) return cached

  const gameData = getGameDataApi()
  const item = gameData.itemDetailMap[itemHrid]
  const out: ChainMakerOption[] = []
  if (!item) {
    makerCache.set(itemHrid, out)
    return out
  }
  const base = {
    hrid: itemHrid,
    name: item.name,
    cn: getTrans(item.name) as string
  }

  for (const p of getChainProjectOptions()) {
    if (isAlchemyKind(p.kind)) {
      const idx = getAlchemyReverseIndex(p.kind as "transmute" | "decompose" | "coinify")
      for (const hit of idx.get(itemHrid) ?? []) {
        out.push({
          ...base,
          project: p.label,
          action: p.action,
          kind: p.kind,
          count: hit.count,
          stepHrid: hit.inputHrid,
          rate: hit.rate
        })
      }
      continue
    }

    let cal: Calculator
    try {
      cal = buildChainCalculator({ project: p.label, action: p.action, kind: p.kind, hrid: itemHrid } as ChainStep)
    } catch {
      continue
    }
    if (!cal.available) continue
    const hit = cal.productList.find(x => x.hrid === itemHrid)
    if (!hit || !((hit.count ?? 0) > 0)) continue
    out.push({
      ...base,
      project: p.label,
      action: p.action,
      kind: p.kind,
      count: hit.count ?? 1,
      stepHrid: itemHrid
    })
  }

  // 确定的配方（采集/制造，rate 视为 1）排最前，炼金按命中率降序
  out.sort((a, b) => (b.rate ?? 1) - (a.rate ?? 1))
  makerCache.set(itemHrid, out)
  return out
}

/**
 * 某个物品的「原料清单」（它是谁做出来的、要做它需要什么）。
 * 用于新手模式下把链条一环一环往前推。
 */
export interface ChainIngredientInfo {
  hrid: string
  name: string
  count: number
  level?: number
  /** 该原料自身能由哪些项目产出（空 ⇒ 一级原料，需采集/外购） */
  makers: ChainMakerOption[]
}

/**
 * 判定一个物品是否属于「玩家冲泡配置」带来的消耗（茶）。
 *
 * ⚠️ 这类物品**不是配方原料**：`getTeaIngredientList` 是按玩家在「冲泡」面板里
 * 勾选的茶动态算出来的（`getActionConfigOf(action).tea`），每个人配的茶不同、
 * 数量极小（实测 0.008~0.023 份/次，来自「1 小时 / 300s / 时钟」口径）。
 *
 * 它们不该出现在新手模式的「原料清单」里 —— 新手会把「智慧茶」当成需要自己做的工序，
 * 从而被 3~5 个茶类物品淹没。
 *
 * ⚠️ **不能按 categoryHrid 判定**：茶的真实类目是 `/item_categories/drink`
 * （和奶酒同大类，见 data.json 实测），按类目过滤会连正常饮品一起误杀。
 * 这里直接比对「玩家该动作配置的茶清单」—— 权威来源，且天然随玩家配置变化。
 *
 * @param action 该环节的动作；同一个物品对不同动作的判定可能不同
 */
function isTeaIngredientOf(action: Action, hrid: string): boolean {
  const tea = getActionConfigOf(action)?.tea
  return Array.isArray(tea) && tea.includes(hrid)
}

/** 由「谁能做它」的一项构造出可用的 ChainStep（两种模式共用） */
export function buildStepFromMaker(maker: ChainMakerOption): ChainStep {
  return {
    project: maker.project,
    action: maker.action,
    kind: maker.kind,
    hrid: maker.stepHrid,
    // 炼金：产出的是 maker.hrid，必须显式声明「这一样交给下一步」
    outHrid: isAlchemyKind(maker.kind) ? maker.hrid : undefined,
    catalystRank: 0
  }
}

/**
 * 「再做它需要什么原料」—— 用于新手模式把链条一环环往前推。
 *
 * ## ⚠️ 旧实现的两个致命缺陷（2026-10-07 修）
 *
 * 1. **忽略用户的选择**：函数只收 `itemHrid`，内部 `for (const maker of getChainMakersOf(...))`
 *    之后无条件 `break` —— 永远只取列表**第一个** maker。
 *    于是用户选了「转化」，界面却按「制造」算原料。
 *
 *    用户实测症状：「选保护之镜 + 转化，弹出来的是保护之镜碎片，而且不管选
 *    转化/分解/点金都一样」—— 因为第一个 maker 恒为「制造」，
 *    而制造保护之镜的原料正是 `/items/shard_of_protection`（保护之镜碎片 ×180）。
 *
 * 2. **炼金环节语义错**：炼金的「原料」就是它**投入的那个物品**，
 *    而且必须按命中率放大（1 个产物平均需要 1/命中率 个投入）。
 *    实测「太阳石碎片 --转化(0.005)--> 贤者之石碎片」需要 **200 个碎片**才出 1 个。
 *    漏掉这个倍数，整条链看起来就像稳赚。
 *
 * @param input 优先传完整的 ChainStep（尊重用户选的做法）；传字符串时退回第一个 maker
 */
export function getChainIngredientsOf(input: ChainStep | string): ChainIngredientInfo[] {
  const gameData = getGameDataApi()
  const itemHrid = typeof input === "string" ? input : input.hrid
  if (!itemHrid) return []

  let step: ChainStep
  if (typeof input === "string") {
    const first = getChainMakersOf(input)[0]
    if (!first) return []
    step = buildStepFromMaker(first)
  } else {
    step = input
  }

  const out: ChainIngredientInfo[] = []
  const seen = new Set<string>()

  // ── 炼金：投入品即原料，且按命中率放大 ──
  if (isAlchemyKind(step.kind)) {
    const cal = buildChainCalculator(step)
    if (!cal.available) return []
    const targetHrid = step.outHrid || cal.productList[0]?.hrid
    const target = targetHrid ? cal.productList.find(p => p.hrid === targetHrid) : undefined
    const rate = target?.rate ?? 0
    if (rate <= 0) return []
    out.push({
      hrid: step.hrid,
      name: gameData.itemDetailMap[step.hrid]?.name || step.hrid,
      count: 1 / rate,
      makers: getChainMakersOf(step.hrid)
    })
    return out
  }

  // ── 采集 / 制造：用配方本身的原料清单 ──
  const cal = buildChainCalculator(step)
  if (!cal.available) return []
  for (const ing of cal.ingredientList) {
    const key = `${ing.hrid}|${ing.level || 0}`
    if (seen.has(key)) continue
    // 过滤茶：它们来自玩家的冲泡配置，不是配方的一环
    if (isTeaIngredientOf(step.action, ing.hrid)) continue
    // 过滤「自产自用」：炼金转化会把自己列为原料（1 - 成功率 的那部分留在手里），
    // 实测法师布的原料清单第一条就是「Magician's Cloth×0.85825」——它自己。
    // 对新手这是死循环，必须排除。
    if (ing.hrid === itemHrid) continue
    // 过滤金币：它是系统货币，不是「一环工序」。若不过滤，它既没有上游，
    // 又会被 `isBaseMaterial` 判成「一级原料」而把新手引到「金币怎么获取」的死路。
    // 金币成本由 `Calculator.cost` 单独计入，不会因为这里过滤而丢失。
    if (ing.hrid === COIN_HRID) continue
    seen.add(key)
    const detail = gameData.itemDetailMap[ing.hrid]
    out.push({
      hrid: ing.hrid,
      name: detail?.name || ing.hrid,
      count: ing.count,
      level: ing.level,
      makers: getChainMakersOf(ing.hrid)
    })
  }
  return out
}

/** 环节的「说明」：这一步在干什么、消耗什么、产出什么。给新手看的白话摘要。 */
export interface ChainStepSummary {
  inputs: { hrid: string, name: string, count: number }[]
  outputs: { hrid: string, name: string, count: number, rate?: number }[]
  timeCost: string
  /**
   * **本环节要拿到「指定产物」的成功率**（0~1）。
   *
   * ⚠️ 这是新手最需要、也最容易漏掉的信息。实测真实案例：
   * 「转化太阳石碎片 → 贤者之石碎片」的 `transmuteDropTable[].dropRate` 是 **0.005**，
   * 即平均要做 **200 次**转化才出 1 个碎片，其余全变成月亮石碎片 / 星星碎片 / 太阳石碎片。
   * 只显示「产出：贤者之石碎片 ×1」会让人误以为 100% 成功。
   *
   * - 炼金环节：指定 `outHrid` 在掉落表里的 `dropRate`
   * - 制造/采集环节：配方确定产出，恒为 1
   */
  successRate: number
  /** 「指定产物」在全部产出里的期望占比（与 successRate 同值，语义更直白，供 UI 文案用） */
  targetShare: number
  /** 该环节每小时的期望产出个数（按指定产物算） */
  targetPerHour: number
  /** 该环节每小时的**动作次数**（不是产出个数） */
  actionsPerHour: number
  /**
   * 这一步按**玩家配置**消耗的饮品（茶 / 咖啡）。
   *
   * ⚠️ 它们**已计入成本**（`Calculator.cost` 里含 `getTeaIngredientList`），
   * 但刻意**不在 `inputs` 里** —— 因为它们不是「配方的一环」，
   * 而是玩家在 dashboard 的「玩家配置」里勾选的增益。
   *
   * 之所以要单独列出：早前实现把它们从所有展示位都过滤掉了
   * ⇒ 用户根本看不到茶，也就无从判断「我有暴饮之囊，算了没有？」
   * 于是合理地怀疑「玩家配置没被考虑」。实际是算了但没显示。
   */
  teas: { hrid: string, name: string, count: number }[]
}

/**
 * 本链用到的**玩家配置**摘要。
 *
 * 「玩家配置」是这个工具的输入之一，不是可有可无的装饰：
 * - 每个动作勾选的饮品（茶 / 咖啡）→ 直接进成本
 * - 特殊装备（如**暴饮之囊** +10% 饮品浓度）→ 同时影响
 *   ① 饮品增益强度（× (1 + 浓度)）② 饮品时长（÷ (1 + 浓度)，即喝得更频繁）
 *   ⇒ 两个方向都进成本与产出
 *
 * 实测（2026-10-07）：装上暴饮之囊后整链成本/h 由 17,516,088 变为 17,530,214，
 * 即配置**确实生效**。此接口把它显式暴露给界面，避免用户以为没算。
 */
export interface ChainPlayerConfigSummary {
  /** 本链涉及的动作 → 各自配了哪些饮品 */
  byAction: {
    action: Action
    /** 展示用标签（优先用该动作在链里的项目名，如「转化」） */
    label: string
    teas: { hrid: string, name: string }[]
  }[]
  /** 饮品浓度（来自特殊装备，如暴饮之囊）+10% 即 0.1 */
  drinkConcentration: number
  /**
   * **可同时生效的饮品种数**（官方公式：基础 1 + 囊的 `drinkSlots` 加成）。
   *
   * | 囊 | 总槽位 |
   * | --- | --- |
   * | 无囊 / Small | 1 |
   * | Medium / Large | 2 |
   * | Giant / Gluttonous / **暴饮之囊** | 3 |
   *
   * ⚠️ 实测项目默认配置给每个动作配了 **3 种茶** —— 那要求 Giant 及以上级别的囊。
   * 没有囊的玩家只能喝 1 种，按 3 种算会高估产出与茶成本。
   */
  drinkSlotCount: number
  /**
   * **配置的饮品种数超过槽位数的动作** —— 这些配置实际跑不起来。
   *
   * 出现了不代表计算器会做特殊处理（它仍按配置算），而是提醒用户：
   * 要么去减配置，要么去换囊，否则结果偏乐观。
   */
  overCapacity: { action: Action, label: string, configured: number, slots: number }[]
  /** 提供加成的特殊装备 */
  specialEquipment: { type: string, hrid: string, name: string, enhanceLevel: number }[]
}

export function getChainPlayerConfigSummary(steps: ChainStep[]): ChainPlayerConfigSummary {
  const gameData = getGameDataApi()
  const nameOf = (h: string) => gameData.itemDetailMap[h]?.name || h
  const seen = new Set<string>()
  const byAction: ChainPlayerConfigSummary["byAction"] = []

  for (const s of steps) {
    if (!s.action || seen.has(s.action)) continue
    seen.add(s.action)
    const teas = Array.from(getActionConfigOf(s.action)?.tea ?? []).map(h => ({ hrid: h, name: nameOf(h) }))
    byAction.push({ action: s.action, label: s.project || s.action, teas })
  }

  const store = usePlayerStoreOutside()
  const specialEquipment: ChainPlayerConfigSummary["specialEquipment"] = []
  for (const [type, item] of store.config.specialEquimentMap as Map<string, { hrid?: string, enhanceLevel?: number }>) {
    if (!item?.hrid) continue
    specialEquipment.push({
      type: String(type),
      hrid: item.hrid,
      name: nameOf(item.hrid),
      enhanceLevel: item.enhanceLevel ?? 0
    })
  }

  const slots = getDrinkSlotCount()
  const overCapacity = byAction
    .filter(a => a.teas.length > slots)
    .map(a => ({ action: a.action, label: a.label, configured: a.teas.length, slots }))

  return {
    byAction,
    drinkConcentration: getDrinkConcentration(),
    drinkSlotCount: slots,
    overCapacity,
    specialEquipment
  }
}

export function getChainStepSummary(step: ChainStep): ChainStepSummary | null {
  if (!step.hrid) return null
  const cal = buildChainCalculator(step)
  if (!cal.available) return null
  const gameData = getGameDataApi()
  const nameOf = (h: string) => gameData.itemDetailMap[h]?.name || h
  const perHour = Math.round(cal.actionsPH)

  // 「本环节要拿到哪个产物」：炼金看用户指定的衔接产物，其余看物品本身
  const targetHrid = isAlchemyKind(step.kind) ? step.outHrid : step.hrid
  const targetProduct = targetHrid ? cal.productList.find(p => p.hrid === targetHrid) : undefined
  // ⚠️ 必须用 productList 里**实际**那条的 rate，不能自己乘 successRate：
  // 炼金的 dropRate 已经包含了它与基础成功率的关系（实测两者都是 0.5，
  // 而 dropRate 各项之和为 1）。制造/采集环节的 rate 是 undefined ⇒ 恒定产出，记 1。
  const successRate = targetProduct ? (targetProduct.rate ?? 1) : 0

  return {
    inputs: cal.ingredientList
      // 与 getChainIngredientsOf 同款过滤：茶来自玩家冲泡配置、金币是货币、
      // 都不是「这一步在消耗某种物品」意义上的原料
      .filter(i => !isTeaIngredientOf(step.action, i.hrid) && i.hrid !== COIN_HRID)
      .map(i => ({ hrid: i.hrid, name: nameOf(i.hrid), count: i.count })),
    outputs: cal.productList.map(p => ({ hrid: p.hrid, name: nameOf(p.hrid), count: p.count, rate: p.rate })),
    // ⚠️ 不能用 getTrans 的占位符语法：它在本文件里拿不到 vue-i18n 的运行时实例，
    // 早前版本导致 "{0}" 原样显示。这里直接输出已算好的数值。
    timeCost: `${perHour} ${getTrans("次 / 小时")}`,
    successRate,
    targetShare: successRate,
    targetPerHour: perHour * successRate,
    actionsPerHour: perHour,
    // 饮品单独列出（它们已在 cost 里，但不是「配方的一环」）
    teas: cal.ingredientList
      .filter(i => isTeaIngredientOf(step.action, i.hrid))
      .map(i => ({ hrid: i.hrid, name: nameOf(i.hrid), count: i.count }))
  }
}

/** 清空缓存（游戏数据刷新后调用，避免拿到旧数据） */
export function clearChainBuilderCache() {
  itemOptionCache.clear()
  makerCache.clear()
  alchemyReverseCache.clear()
}


/** 环节的衔接产物：制造/采集=物品本身；炼金=用户指定的 outHrid */
function getStepOutputHrid(step: ChainStep): string | undefined {
  return isAlchemyKind(step.kind) ? step.outHrid : step.hrid
}

/** 计算整条手动产业链，返回 WorkflowCalculator（已 run），无效时返回 null */
export function calcChainProfitApi(steps: ChainStep[], chainName: string): WorkflowCalculator | null {
  if (!steps.length) return null
  const configs: StorageCalculatorItem[] = []
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (!step.hrid) return null
    const cal = buildChainCalculator(step)
    if (!cal.available) return null
    const config = getStorageCalculatorItem(cal)
    // 下游环节：把上游衔接产物设为 0 价内部流转
    if (i > 0) {
      const prevOut = getStepOutputHrid(steps[i - 1])
      if (prevOut) {
        config.alignHrid = prevOut
      }
    }
    // 炼金环节非末尾：指定流向下一阶段的产物（workMultiplier 按该产物对倍率）
    if (isAlchemyKind(step.kind) && i < steps.length - 1) {
      const cal2 = buildChainCalculator(step)
      config.alignProductHrid = step.outHrid || cal2.productList[0]?.hrid
    }
    configs.push(config)
  }
  const wf = new WorkflowCalculator(configs, chainName)
  wf.run()
  return wf
}
