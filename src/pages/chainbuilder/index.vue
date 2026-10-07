<script lang="ts" setup>
import type { ChainMakerOption, ChainPlayerConfigSummary, ChainStep, ChainStepSummary } from "@/common/apis/chainbuilder"
import type Calculator from "@/calculator"
import type { WorkflowCalculator } from "@/calculator/workflow"
import {
  buildStepFromMaker,
  calcChainProfitApi,
  clearChainBuilderCache,
  filterChainOptions,
  getChainAlchemyOutputOptions,
  getChainIngredientsOf,
  getChainMakersOf,
  getChainPlayerConfigSummary,
  getChainProjectOptions,
  getChainStepItemOptions,
  getChainStepSummary,
  isAlchemyKind
} from "@/common/apis/chainbuilder"
import { getGameDataApi, getItemDetailOf } from "@/common/apis/game"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import PriceStatusSelect from "@@/components/PriceStatusSelect/index.vue"
import * as Format from "@@/utils/format"
import { getTrans } from "@/locales"
import { usePriceStatus } from "@@/composables/usePriceStatus"
import { ArrowDown, ArrowUp, Delete, MagicStick, Plus, QuestionFilled, Search } from "@element-plus/icons-vue"
import { useI18n } from "vue-i18n"
import { useGameStore } from "@/pinia/stores/game"
import { usePlayerStore } from "@/pinia/stores/player"
import ActionDetail from "../dashboard/components/ActionDetail.vue"
import GameInfo from "../dashboard/components/GameInfo.vue"

const { t } = useI18n()
const gameStore = useGameStore()

/**
 * 买卖价口径（左价 / 右价）—— **不是本页面独有的小控件，而是全局既有的轮子**。
 *
 * 用户的原话：「市场收购环节类型就算了……左买右卖、左买左卖、右买右卖、右买左卖，
 * 这个在利润排行里已经用烂了」。实测确认：
 * `PriceStatusSelect` 被 **11 个页面**使用（dashboard / jungle / enhanposer / manualchemy …），
 * 本页是唯一漏挂的 —— 所以「右收（用右价买）」在本页一直无法表达。
 *
 * 挂上它即可，无需给 ChainStep 新增「市场收购」类型：
 * `buyStatus = BID` 就是右收，`ASK` 就是左买；`sellStatus` 同理。
 * 底层由 `Calculator` 的 `getPriceOf(hrid, level, buyStatus, sellStatus)` 统一处理，
 * 链头外购、链内原料、成品出售三种口径自动一起切换。
 */
const onPriceStatusChange = usePriceStatus("chainbuilder-price-status")

/* ══════════════════════════════════════════════════════════════════════════
 * 面向新手的改造（2026-10-07）
 *
 * ## 改造前实测的三个障碍
 *
 * 1. **入口方向反了**。新手的心智是「我想做这个东西，划算吗」，
 *    而原界面逼他先答「我的原料是什么」—— 于是第一屏就是一个空环节 + 11 个陌生项目。
 * 2. **候选爆炸**。实测单个下拉的候选数：
 *    挤奶 7 / 烹饪 31 / 冲泡 70 / 裁缝 143 / 制造 198 / 锻造 205 /
 *    转化 622 / 分解 742 / **点金 889**。让新学生在 889 项里找东西 = 劝退。
 * 3. **黑话无解释**。「内部流转」「衔接产物」「倍率」「alignHrid」，
 *    界面上一个都没解释。
 *
 * ## 改造后的两条路
 *
 * - **新手模式（默认）**：先选「我想做的成品」，系统反查「谁能做它」，
 *    再顺着原料一层层往前推。每层候选被**上一层的产物**收敛，不再是全量列表。
 * - **进阶模式**：保留原来的正向逐环节编辑（一行一个环节，自由组合）。
 *    老玩家不会被新界面束缚，两种模式共享同一份结果区。
 * ══════════════════════════════════════════════════════════════════════════ */

const mode = ref<"newbie" | "advanced">("newbie")

/* ───────────────────── 示例链：让新手先看到「长什么样」 ───────────────────── */

/**
 * 内置示例链 —— 新手最缺的不是功能，是**参照物**。
 *
 * 空白的「环节 1 + 11 个项目」无法自解释，而「挤奶→锻造→转化→分解」这种
 * 具体链路一看就懂。所以每条示例都直接给出完整 steps，一键载入后可计算、可改。
 *
 * ⚠️ **示例里的每个 hrid 都必须真实可用**（`buildChainCalculator(...).available === true`），
 * 否则点了「计算」只会得到一句「存在不可用的环节」，比没有示例更糟。
 * 早前第二例写成「裁缝斗篷 → 转化贤者之石 → 分解贤者之石」，实测
 * `DecomposeCalculator(philosophers_stone).available === false`（游戏里不能分解它），
 * 已被 `tests/chainbuilder-examples.test.ts` 锁死。
 */
const EXAMPLES: { name: string, desc: string, steps: ChainStep[] }[] = [
  {
    name: "示例：两级链（最常见）",
    desc: "挤奶得原奶 → 锻造得奶酪。教你「一步喂给下一步」",
    steps: [
      { project: "挤奶", action: "milking", kind: "gather", hrid: "/items/azure_milk" },
      { project: "锻造", action: "cheesesmithing", kind: "manufacture", hrid: "/items/azure_cheese" }
    ]
  },
  {
    name: "示例：带炼金的三级链",
    desc: "裁缝得竹布 → 转化得亚麻布 → 分解。教你炼金环节怎么衔接（带催化剂加成）",
    steps: [
      { project: "裁缝", action: "tailoring", kind: "manufacture", hrid: "/items/bamboo_fabric" },
      {
        project: "转化",
        action: "alchemy",
        kind: "transmute",
        hrid: "/items/bamboo_fabric",
        outHrid: "/items/linen_fabric",
        catalystRank: 1
      },
      { project: "分解", action: "alchemy", kind: "decompose", hrid: "/items/linen_fabric", catalystRank: 1 }
    ]
  }
]

function loadExample(ex: typeof EXAMPLES[number]) {
  mode.value = "advanced"
  steps.value = JSON.parse(JSON.stringify(ex.steps))
  chainName.value = ex.name.replace(/^示例：/, "")
  result.value = null
  ElMessage.success(t("已载入示例，可直接点「计算」，也可以改成你自己的链路"))
}

/* ───────────────────────── 新手模式：从成品倒推 ───────────────────────── */

/** 目标成品（新手模式的起点） */
const targetHrid = ref("")
const targetSearch = ref("")
/** 已排好的链条（从原料到成品，与进阶模式 steps 同构，可直接复用 calcChainProfitApi） */
const newbieSteps = ref<ChainStep[]>([])
/** 正在展开的层级：0 = 目标成品层，1..N = 逐层往前 */
const expandLevel = ref(0)

/** 目标物品本身能由哪些项目产出 —— 候选被真实数据收敛，通常 1~5 项 */
const targetMakers = computed<ChainMakerOption[]>(() => {
  return targetHrid.value ? getChainMakersOf(targetHrid.value) : []
})

/**
 * 「谁能做它」列表默认展示前几条。
 *
 * 加上炼金反查后，某些物品的候选会到几十条（实测「贤者之石碎片」有 42 个投入品
 * 都能转化出它）—— 一次全铺开会把页面淹掉，但全部隐藏又会让用户找不到
 * 自己知道的那条路。所以默认给前几条，剩下的折叠。
 */
const MAKER_PREVIEW = 8
const showAllMakers = ref(false)
const visibleMakers = computed(() =>
  showAllMakers.value ? targetMakers.value : targetMakers.value.slice(0, MAKER_PREVIEW)
)

/**
 * maker 的展示文案。
 *
 * ⚠️ 必须区分两类，否则同名项目会互相混淆：
 * **同一个「转化」可以来自多个不同投入品**（转 太阳石碎片 和 转 月亮石碎片是两条不同的路）。
 * 只写「转化」两个字的选项在列表里会看起来完全一样，用户无从选择。
 *
 * - 采集/制造：`制造 · 1 次得 1`
 * - 炼金：`转化 ← 太阳石碎片 · 0.5%`
 */
function makerLabel(m: ChainMakerOption) {
  if (m.stepHrid === m.hrid) {
    return `${t(m.project)} · ${t("1 次得 ")}${Format.number(m.count, 2)}`
  }
  const input = t(getItemDetailOf(m.stepHrid)?.name || m.stepHrid)
  const rate = m.rate != null ? ` · ${Format.percent(m.rate)}` : ""
  return `${t(m.project)} ← ${input}${rate}`
}

const targetItem = computed(() => (targetHrid.value ? getItemDetailOf(targetHrid.value) : undefined))

/**
 * 全部可搜索物品（新手模式下唯一需要面对的大列表，但支持多路模糊搜索）。
 *
 * ⚠️ 候选必须支持 **hrid / 中文名 / 英文名** 三路匹配：
 * 中文玩家打「奶酪」，从 Wiki 或别人分享链接来的人打 `/items/azure_cheese`，
 * 英文玩家打 `Azure Cheese`。只支持一种，另外两种人就「搜不到」。
 */
const allItems = computed(() => {
  const map = getGameDataApi().itemDetailMap
  return Object.values(map)
    .filter(i => i.enhancementCosts || i.alchemyDetail || i.categoryHrid === "/item_categories/equipment")
    .map(i => ({ hrid: i.hrid, name: i.name, cn: getTrans(i.name) as string }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

const targetCandidates = computed(() => filterChainOptions(allItems.value, targetSearch.value).slice(0, 60))

/**
 * 当前待展开层的原料列表。
 *
 * 关键：这里返回的是「上一步的产物所对应的下一层原料」，
 * 而非全量候选 —— 这就是把 889 项收敛到个位数的关键。
 *
 * ⚠️ 必须把**完整 step** 传进去（不只是 hrid）：
 * 早前只传 hrid，函数内部永远取第一个 maker，于是用户选了「转化」却按「制造」算原料
 * —— 这就是「选保护之镜的转化，却弹出保护之镜碎片」的根因。
 */
const currentIngredients = computed(() => {
  if (!newbieSteps.value.length) return []
  return getChainIngredientsOf(newbieSteps.value[0])
})

/** 该层的原料里，哪些是「一级原料」（没有更上游 ⇒ 需要采集或外购） */
function isBaseMaterial(makers: ChainMakerOption[]) {
  return makers.length === 0
}

const currentStepSummary = computed<ChainStepSummary | null>(() => {
  if (!newbieSteps.value.length) return null
  return getChainStepSummary(newbieSteps.value[0])
})

/**
 * 每个环节的摘要（两种模式通用）。
 *
 * 用途：把「这一步到底靠不靠谱」显式说出来。实测用户案例
 * 「转化太阳石碎片 → 贤者之石碎片」命中率仅 **0.005**（平均 200 次出 1 个），
 * 而旧界面只写「产出：贤者之石碎片 ×1」—— 新手会误以为稳赚。
 */
function summaryOf(step: ChainStep): ChainStepSummary | null {
  return getChainStepSummary(step)
}

/** 命中率的口径文案：低命中率必须显眼地警告 */
function rateLevelOf(rate: number): "certain" | "high" | "low" | "tiny" {
  if (rate >= 1) return "certain"
  if (rate >= 0.5) return "high"
  if (rate >= 0.05) return "low"
  return "tiny"
}
const RATE_TAG_TYPE: Record<ReturnType<typeof rateLevelOf>, string> = {
  certain: "success",
  high: "success",
  low: "warning",
  tiny: "danger"
}

/** 「平均多少次出 1 个」—— 比百分比更直观（用户看到 200 次立刻明白有多难） */
function attemptsPerOf(rate: number): number {
  if (!rate || rate <= 0) {
    return 0
  }
  if (rate >= 1) {
    return 1
  }
  return Math.round(1 / rate)
}

/** 换目标成品 ⇒ 清空整条链重新开始 */
watch(targetHrid, () => {
  newbieSteps.value = []
  expandLevel.value = 0
  result.value = null
})

/**
 * 在目标层选「用哪个项目做」。
 *
 * ⚠️ 用 `buildStepFromMaker` 而不是手工拼 project/action/kind/hrid：
 * 炼金环节的 `ChainStep.hrid` 是**投入品**（不是产物），
 * maker 里用 `stepHrid` 表达，并靠 `outHrid` 指明「这一样交给下一步」。
 * 早前把 maker.hrid 直接当 step.hrid，炼金环节整条都算错了。
 */
function onPickMaker(maker: ChainMakerOption) {
  if (!targetHrid.value) return
  newbieSteps.value = [buildStepFromMaker(maker)]
  expandLevel.value = 1
  result.value = null
}

/** 把某个原料接成新的最上游环节 */
function onPickIngredient(hrid: string, maker?: ChainMakerOption) {
  if (!newbieSteps.value.length) return
  if (!maker) {
    // 一级原料：没有更上游，作为链条起点。
    // project 留空 —— 它是「采集 / 外购」而非某个生产动作，
    // 界面上已按「外购 / 采集」展示，不该硬塞一个假项目。
    newbieSteps.value.unshift({ project: "", action: "milking", kind: "gather", hrid })
    result.value = null
    return
  }
  newbieSteps.value.unshift(buildStepFromMaker(maker))
  result.value = null
}

/** 一键把当前层能自动识别的原料都补齐（多原料时全接；新手最常用） */
function onAutoExpand() {
  const ings = currentIngredients.value
  const targets = ings.filter(i => i.makers.length > 0)
  if (!targets.length) return
  // 逐个插入到最上游（makers 已按「先配方、后炼金命中率降序」排好，第一个即推荐做法）
  for (const ing of targets.reverse()) {
    newbieSteps.value.unshift(buildStepFromMaker(ing.makers[0]))
  }
  result.value = null
}

/** 手动挑一个环节（覆盖自动推断） */
function onOverrideStep(maker: ChainMakerOption) {
  if (!newbieSteps.value.length) return
  newbieSteps.value[0] = buildStepFromMaker(maker)
  result.value = null
}

/* ───────────────────────── 进阶模式：正向逐环节 ───────────────────────── */

const projectOptions = getChainProjectOptions()
const steps = ref<ChainStep[]>([
  { project: "", action: "milking", kind: "gather", hrid: "", catalystRank: 0 }
])
const chainName = ref("")
const loading = ref(false)
const result = ref<WorkflowCalculator | null>(null)

function addStep() {
  steps.value.push({ project: "", action: "milking", kind: "gather", hrid: "", catalystRank: 0 })
}
function removeStep(index: number) {
  steps.value.splice(index, 1)
}
function moveStep(index: number, dir: -1 | 1) {
  const target = index + dir
  if (target < 0 || target >= steps.value.length) return
  const arr = steps.value
  ;[arr[index], arr[target]] = [arr[target], arr[index]]
}
function onProjectChange(index: number) {
  const opt = projectOptions.find(o => o.label === steps.value[index].project)
  if (!opt) return
  const step = steps.value[index]
  step.kind = opt.kind
  step.action = opt.action
  step.hrid = ""
  step.catalystRank = 0
  step.outHrid = ""
  // 换项目后候选集完全变了，旧关键字必须清掉，否则新候选会被旧词过滤成空
  const next = { ...stepQuery.value }
  delete next[index]
  stepQuery.value = next
  result.value = null
}
function itemOptions(step: ChainStep) {
  return step.project ? getChainStepItemOptions(step) : []
}

/**
 * 进阶模式的物品搜索。
 *
 * ## ⚠️ 早前「搜索框完全不生效」的根因
 *
 * 写的是
 * ```html
 * <el-select filterable :filter-method="(q) => filterStepItems(step, q)">
 *   <el-option v-for="opt in itemOptions(step)" ... />
 * ```
 * 但 Element Plus 的 `filter-method` 语义是「**你自己去过滤数据**」的回调 ——
 * **它的返回值会被直接丢弃**。上面那么写，过滤结果 return 出去就没了，
 * 而 `itemOptions(step)` 永远返回全量 ⇒ 输入关键字列表毫无变化。
 *
 * 正确做法：`filter-method` 只负责**记下关键字**，选项列表由关键字**计算得出**。
 */
const stepQuery = ref<Record<number, string>>({})

function onStepFilter(index: number, q: string) {
  stepQuery.value = { ...stepQuery.value, [index]: q }
}

function filteredItemOptions(index: number, step: ChainStep) {
  // filterChainOptions：空关键字返回**全量**（不是 []），否则搜索框一清空就没选项
  return filterChainOptions(itemOptions(step), stepQuery.value[index] ?? "")
}
function alchemyOutputs(step: ChainStep) {
  return getChainAlchemyOutputOptions(step)
}

/**
 * 催化剂标签 —— 用**游戏内的真实物品名**，且随炼金类型变化。
 *
 * 四种催化剂（`data.json` 原文 description）：
 *   点金 +15% coinifying / 分解 +15% decomposition / 转化 +15% transmutation
 *   / 至高 +25% any action（通用）
 *
 * 三种炼金各用自己的那种，**买错无效** ⇒ 标签必须跟着 `step.kind` 走。
 * 此前写的是「普通 / 主要催化剂」，游戏里不存在这两个物品。
 */
const CATALYST_BY_KIND: Record<string, string> = {
  transmute: "转化催化剂",
  decompose: "分解催化剂",
  coinify: "点金催化剂"
}
function catalystLabel(rank: number, kind?: string) {
  if (rank === 1) return t(CATALYST_BY_KIND[kind ?? ""] ?? "催化剂")
  if (rank === 2) return t("至高催化剂")
  return t("无")
}

/**
 * 玩家配置摘要 —— **它是计算的输入，不是装饰**。
 *
 * 每个动作勾的饮品、以及特殊装备（暴饮之囊 +10% 饮品浓度）都会进成本与产出：
 *   饮品消耗/动作 = 3600 / 300 × (1 + 浓度) ÷ 每小时动作数
 * 浓度同时放大饮品增益强度（时长相应缩短 ⇒ 喝得更频繁），两个方向都影响结果。
 *
 * ⚠️ 早前这些茶被从原料清单里过滤掉了（它们是玩家配置而非配方原料），
 * 于是界面上**完全看不到**它们 —— 用户合理地怀疑「我有暴饮之囊，到底算了没有」。
 * 实际算了，但没显示。这个卡片就是把它摆出来。
 */
const playerStore = usePlayerStore()
const playerConfig = computed<ChainPlayerConfigSummary>(() => {
  // 读一下 config 让 computed 随玩家配置变化重算
  // （getDrinkConcentration 读的是模块级 buffs，由 watcher 重算，本身不可响应）
  void playerStore.config
  return getChainPlayerConfigSummary(activeSteps.value)
})
/** 暴饮之囊（若有）—— 浓度那块要标出它来自哪件装备 */
const pouch = computed(() => playerConfig.value.specialEquipment.find(e => e.hrid === "/items/guzzling_pouch"))

/* ───────────────────────── 统一计算与结果 ───────────────────────── */

/** 当前生效的环节（两种模式共用一条计算链） */
const activeSteps = computed<ChainStep[]>(() => {
  if (mode.value === "newbie") {
    return newbieSteps.value.filter(s => s.hrid)
  }
  return steps.value
})

/**
 * 结果表里每一行对应的环节摘要，key = `项目 + 物品 hrid`。
 *
 * ⚠️ 必须自己按当前链条重算，不能直接用 `resultList[].successRate`：
 * 那个字段是**动作成功率**（炼金恒 50%，制造恒 100%），
 * 而用户真正要知道的是「多少次出 1 个我要的东西」（实测低至 0.5%）。两者差 100 倍。
 */
const resultChainSteps = computed<Record<string, ChainStepSummary>>(() => {
  const map: Record<string, ChainStepSummary> = {}
  for (const step of activeSteps.value) {
    const sum = getChainStepSummary(step)
    if (sum) {
      map[step.project + step.hrid] = sum
    }
  }
  return map
})

/** 炼金环节的产出分布（只有炼金才会一次出 6 样东西，需要单独展示） */
const alchemyBreakdown = computed<Record<string, ChainStepSummary>>(() => {
  const map: Record<string, ChainStepSummary> = {}
  for (const step of activeSteps.value) {
    if (!isAlchemyKind(step.kind)) {
      continue
    }
    const sum = getChainStepSummary(step)
    // 只展示「真有多产物」的：单产出的制造/采集环节不需要
    if (sum && sum.outputs.filter(o => o.rate != null).length > 1) {
      map[step.hrid] = sum
    }
  }
  return map
})

function calculate() {
  const use = activeSteps.value
  if (!use.length || use.some(s => !s.hrid)) {
    ElMessage.warning(t("请选择物品"))
    return
  }
  loading.value = true
  try {
    const wf = calcChainProfitApi(use, chainName.value || t("手动产业链"))
    result.value = wf
    if (!wf) {
      ElMessage.warning(t("存在不可用的环节，请检查选择"))
    }
  } catch (e: any) {
    console.error(e)
    ElMessage.error(t("计算失败") + (e?.message ? `: ${e.message}` : ""))
  } finally {
    loading.value = false
  }
}

// 游戏数据刷新后，物品/价格变了 ⇒ 候选缓存与结果一并失效
watch(() => gameStore.marketData, () => {
  clearChainBuilderCache()
  result.value = null
})

// 详情弹窗
const detailVisible = ref(false)
const detailData = ref<Calculator>()
function showDetail(row: Calculator) {
  detailData.value = row
  detailVisible.value = true
}

/* ───────────────────────── 术语 tooltip ───────────────────────── */

const TERM_TIPS: Record<string, string> = {
  环节说明: "产业链由若干「环节」串起来：一步做一件事，前一步的产物自动作为后一步的原料（0 价内部流转，不重复计入成本）。",
  衔接产物: "一次炼金可能产出多种东西（转化/分解/点金各有掉落）。这里要指定「哪一样交给下一步」，其余仍按市价计入收入。",
  倍率说明: "整条链不是各环节独立相加，而是按「上一环节产出 ÷ 下一环节消耗」算出每步的相对倍数，这样才不会出现「产 10 个只够做 1 个」的时间失真。",
  目标成品: "先选你最终想卖的东西。系统会告诉你「谁能做它」，然后顺着原料一层层往前推。",
  一级原料: "这个物品没有更上游的工序了 —— 它要么靠采集得到，要么直接外购。它就是整条链的起点。"
}
</script>

<template>
  <div>
    <GameInfo />
    <!-- 买卖价口径：左价/右价。与其余 11 个页面同一个轮子，
         「右收」= 买价选右价。 -->
    <PriceStatusSelect @change="onPriceStatusChange" />
    <el-card>
      <template #header>
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2">
            <span>{{ t("手动产业链") }}</span>
            <el-radio-group v-model="mode" size="small">
              <el-radio-button value="newbie">
                <span class="flex items-center gap-1">
                  {{ t("新手模式") }}
                </span>
              </el-radio-button>
              <el-radio-button value="advanced">
                {{ t("进阶模式") }}
              </el-radio-button>
            </el-radio-group>
          </div>
          <span class="text-sm text-gray-400">
            {{ mode === "newbie" ? t("先选成品，再顺着原料往前推；每层只列上一层能用到的东西") : t("项目+动作逐节点缀连，自动内部流转并整链核算") }}
          </span>
        </div>
      </template>

      <!-- ═══════════════ 新手模式：从成品倒推 ═══════════════ -->
      <div v-if="mode === 'newbie'">
        <!-- 首屏引导：先说清「这是什么」，再给两个示例当参照物 -->
        <el-alert type="info" :closable="false" show-icon class="mb-3">
          <template #title>
            <span class="text-sm">
              {{ t("产业链 = 把「做东西」的几步串起来，算出整条链每小时赚多少。") }}
              {{ t("下面选你最终想卖的东西，剩下的交给工具。") }}
            </span>
          </template>
        </el-alert>

        <el-steps :active="newbieSteps.length ? (currentIngredients.length ? 1 : 2) : 0" simple finish-status="success">
          <el-step :title="t('① 选成品')" />
          <el-step :title="t('② 选谁能做')" />
          <el-step :title="t('③ 往前推原料')" />
        </el-steps>

        <div class="mt-4">
          <el-input
            v-model="targetSearch"
            :placeholder="t('搜索你想做的东西：中文名 / 英文名 / hrid 都行，例如「奶酪」或 azure_cheese')"
            clearable
            size="large"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <div v-if="targetCandidates.length" class="target-hints mt-2">
            <el-tag
              v-for="opt in targetCandidates"
              :key="opt.hrid"
              class="cursor-pointer mr-1 mb-1"
              @click="targetHrid = opt.hrid"
            >
              <span>{{ t(opt.name) }}</span>
              <!-- 中文名与英文名不同时都显示，否则新手只认得其中一种 -->
              <span v-if="opt.cn && opt.cn !== opt.name" class="text-xs opacity-70">{{ opt.cn }}</span>
            </el-tag>
          </div>
        </div>

        <div v-if="targetItem" class="mt-3 flex items-center gap-2 p-2 rounded bg-gray-50">
          <ItemIcon :hrid="targetItem.hrid" :width="32" :height="32" />
          <span class="font-medium">{{ t(targetItem.name) }}</span>
          <span class="text-xs text-gray-500">{{ targetItem.hrid }}</span>
        </div>

        <!-- 第 2 步：选「谁能做」 -->
        <div v-if="targetItem && !newbieSteps.length" class="mt-3">
          <div class="text-sm mb-1">{{ t("下面这些做法能做出它，选一个：") }}</div>
          <div class="text-xs text-gray-400 mb-2">
            {{ t("同一个物品常有多种做法（如制造/转化/分解/点金），它们的速度、命中率、投入都不一样，选你实际会做的那一种。") }}
          </div>
          <div v-if="!targetMakers.length" class="text-sm text-gray-500">{{ t("这个物品不能生产（或需要先强化）") }}</div>
          <template v-else>
            <div class="flex flex-col gap-2">
              <div
                v-for="(m, i) in visibleMakers"
                :key="`${m.project}|${m.stepHrid}`"
                class="flex items-center gap-2 p-2 rounded border flex-wrap"
              >
                <ItemIcon v-if="m.stepHrid !== m.hrid" :hrid="m.stepHrid" :width="22" :height="22" />
                <span class="font-medium min-w-70px">{{ m.project }}</span>

                <!-- 炼金：说明「投入什么」+ 命中率（用户最需要看到的信息） -->
                <template v-if="m.stepHrid !== m.hrid">
                  <span class="text-sm">{{ t("投入") }}</span>
                  <span class="text-sm text-gray-700">
                    {{ t(getItemDetailOf(m.stepHrid)?.name || m.stepHrid) }}
                  </span>
                  <el-tag
                    v-if="m.rate != null"
                    size="small"
                    :type="RATE_TAG_TYPE[rateLevelOf(m.rate)] as any"
                  >
                    {{ Format.percent(m.rate) }}
                  </el-tag>
                  <span v-if="m.rate != null" class="text-xs text-gray-500">
                    {{ t("平均 ") }}{{ attemptsPerOf(m.rate) }} {{ t(" 次出 1 个") }}
                  </span>
                </template>
                <span v-else class="text-xs text-gray-500">
                  {{ t("1 次得 ") }}{{ Format.number(m.count, 2) }}
                </span>

                <el-button size="small" type="primary" text @click="onPickMaker(m)">
                  {{ t("用这个") }}
                </el-button>
              </div>
            </div>
            <el-button
              v-if="targetMakers.length > MAKER_PREVIEW"
              size="small"
              text
              class="mt-1"
              @click="showAllMakers = !showAllMakers"
            >
              {{ showAllMakers
                ? t("收起")
                : t("还有 {0} 种做法（多为别的物品转化而来），展开看看", [String(targetMakers.length - MAKER_PREVIEW)]) }}
            </el-button>
          </template>
        </div>

        <!-- 第 3 步：往前推原料 -->
        <div v-if="newbieSteps.length" class="mt-4">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium">{{ t("当前链条（从原料到成品）") }}</span>
            <el-button size="small" text @click="newbieSteps = []">
              {{ t("重新选成品") }}
            </el-button>
          </div>

          <div v-for="(step, index) in [...newbieSteps].reverse()" :key="index" class="chain-step">
            <div class="chain-step-no">{{ t("环节") }} {{ newbieSteps.length - index }}</div>
            <ItemIcon :hrid="step.hrid" :width="22" :height="22" />
            <span class="flex-1">{{ t(getItemDetailOf(step.hrid)?.name || step.hrid) }}</span>
            <span class="text-xs text-gray-500">{{ step.project || t("外购 / 采集") }}</span>
            <el-tooltip placement="top" effect="light" :show-after="120">
              <template #content>
                <div class="max-w-320px leading-5">
                  {{ t("这一步的产物会自动作为下一步的原料（0 价内部流转，不重复计入成本）") }}
                </div>
              </template>
              <el-tag size="small" type="info">{{ t("→ 交给下一步") }}</el-tag>
            </el-tooltip>
          </div>

          <!-- 往上一层原料 -->
          <div v-if="currentIngredients.length" class="mt-4 p-3 rounded border">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-medium">
                {{ t("『") }}{{ t(currentStepSummary ? getItemDetailOf(currentStepSummary.outputs[0]?.hrid || "")?.name || '' : '') }}{{ t("』需要这些原料") }}
              </span>
              <el-button size="small" :icon="MagicStick" @click="onAutoExpand">
                {{ t("自动补齐") }}
              </el-button>
            </div>
            <div class="flex flex-col gap-2">
              <div v-for="ing in currentIngredients" :key="ing.hrid + (ing.level || 0)" class="flex items-center gap-2">
                <ItemIcon :hrid="ing.hrid" :width="22" :height="22" />
                <span class="flex-1">{{ t(ing.name) }}</span>
                <span class="text-xs text-gray-500">{{ t("需要 ") }}{{ Format.number(ing.count, 2) }}</span>
                <!-- 一级原料：作为链条起点 -->
                <el-tag v-if="isBaseMaterial(ing.makers)" size="small" type="info" class="cursor-pointer" @click="onPickIngredient(ing.hrid)">
                  {{ t("作为起点（外购/采集）") }}
                </el-tag>
                <!-- 有上游：列出可选做法 -->
                <!-- ⚠️ 用**下标**做 value 而不是 project：同一个「转化」可能有多条
                     （转太阳石碎片 / 转月亮石碎片…），按 project 匹配永远命中第一个，
                     用户选了 B 也会接上 A。 -->
                <el-select
                  v-else
                  :model-value="undefined"
                  :placeholder="t('选谁来做')"
                  size="small"
                  style="width: 200px"
                  @update:model-value="(mi: number) => onPickIngredient(ing.hrid, ing.makers[mi])"
                >
                  <el-option
                    v-for="(m, mi) in ing.makers"
                    :key="mi"
                    :label="makerLabel(m)"
                    :value="mi"
                  />
                </el-select>
              </div>
            </div>
          </div>
          <div v-else class="mt-3 text-sm text-gray-500">{{ t("已推到一级原料，链条完成") }}</div>
        </div>
      </div>

      <!-- ═══════════════ 进阶模式：正向逐环节 ═══════════════ -->
      <div v-else>
        <!-- 示例链：新手与老玩家都需要一个「参照物」，空白表单无法自解释 -->
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <span class="text-sm text-gray-500">{{ t("没思路？载入示例改改看：") }}</span>
          <el-button v-for="ex in EXAMPLES" :key="ex.name" size="small" @click="loadExample(ex)">
            {{ t(ex.name) }}
          </el-button>
          <el-tooltip v-for="ex in EXAMPLES" :key="`${ex.name}-tip`" placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-280px leading-5">{{ t(ex.desc) }}</div>
            </template>
            <el-icon class="cursor-help text-gray-400" :size="14"><QuestionFilled /></el-icon>
          </el-tooltip>
        </div>

        <div class="chain-steps">
          <div v-for="(step, index) in steps" :key="index" class="chain-step">
          <div class="chain-step-no">
            {{ t("环节") }} {{ index + 1 }}
          </div>
          <el-select
            :model-value="step.project"
            :placeholder="t('项目')"
            style="width: 110px"
            @update:model-value="step.project = $event; onProjectChange(index)"
          >
            <el-option v-for="p in projectOptions" :key="p.label" :label="t(p.label)" :value="p.label" />
          </el-select>
          <el-select
            v-model="step.hrid"
            filterable
            :filter-method="(q: string) => onStepFilter(index, q)"
            :disabled="!step.project"
            :placeholder="t('物品（可搜中文名 / hrid）')"
            style="flex: 1"
            @change="step.outHrid = ''"
          >
            <el-option v-for="opt in filteredItemOptions(index, step)" :key="opt.hrid" :label="t(opt.name)" :value="opt.hrid" />
          </el-select>
          <el-select v-if="isAlchemyKind(step.kind)" v-model="step.catalystRank" style="width: 120px">
            <el-option v-for="r in [0, 1, 2]" :key="r" :label="catalystLabel(r, step.kind)" :value="r" />
          </el-select>
          <el-select
            v-if="isAlchemyKind(step.kind) && index < steps.length - 1"
            v-model="step.outHrid"
            filterable
            :disabled="!step.hrid"
            :placeholder="t('衔接产物')"
            style="width: 180px"
          >
            <el-option v-for="opt in alchemyOutputs(step)" :key="opt.hrid" :label="t(opt.name)" :value="opt.hrid" />
          </el-select>
          <el-button-group>
            <el-button :icon="ArrowUp" :disabled="index === 0" @click="moveStep(index, -1)" />
            <el-button :icon="ArrowDown" :disabled="index === steps.length - 1" @click="moveStep(index, 1)" />
          </el-button-group>
            <el-button :icon="Delete" type="danger" text @click="removeStep(index)" />
          </div>

          <div class="flex items-center gap-2 mt-3">
            <el-button :icon="Plus" @click="addStep">
              {{ t("添加环节") }}
            </el-button>
          </div>
        </div>
      </div>

      <!-- 统一操作栏 -->
      <div class="flex items-center gap-2 mt-4">
        <el-input v-model="chainName" :placeholder="t('产业链名称（可留空）')" style="width: 200px" clearable />
        <el-button type="primary" :icon="MagicStick" :loading="loading" @click="calculate">
          {{ t("计算") }}
        </el-button>
      </div>
    </el-card>

    <!-- ══════════════ 玩家配置（计算的输入之一）══════════════ -->
    <el-card class="mt-3">
      <template #header>
        <div class="flex items-center gap-2 flex-wrap">
          <span>{{ t("玩家配置（已计入成本与产出）") }}</span>
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-400px leading-5">
                {{ t("饮品与特殊装备是这个工具的输入：每个动作勾选的饮品直接进成本；暴饮之囊等装备同时放大饮品增益强度、缩短饮品时长（喝得更频繁）。") }}
                <div class="mt-1">{{ t("要改配置，去主面板的「玩家配置」。") }}</div>
              </div>
            </template>
            <el-icon class="cursor-help text-gray-400"><QuestionFilled /></el-icon>
          </el-tooltip>
        </div>
      </template>

      <el-descriptions :column="2" border size="small">
        <el-descriptions-item :label="t('饮品浓度')">
          <span>{{ Format.percent(playerConfig.drinkConcentration) }}</span>
          <el-tag v-if="pouch" size="small" type="success" class="ml-2">
            {{ t(pouch.name) }}<span v-if="pouch.enhanceLevel">+{{ pouch.enhanceLevel }}</span>
          </el-tag>
          <span v-else-if="playerConfig.drinkConcentration > 0" class="ml-2 text-xs text-gray-500">
            {{ t("（来自特殊装备）") }}
          </span>
          <span v-else class="ml-2 text-xs text-gray-400">{{ t("（未装备暴饮之囊）") }}</span>
        </el-descriptions-item>
        <el-descriptions-item :label="t('特殊装备')">
          <span v-if="!playerConfig.specialEquipment.length" class="text-gray-400">{{ t("无") }}</span>
          <template v-else>
            <el-tag
              v-for="eq in playerConfig.specialEquipment"
              :key="eq.type"
              size="small"
              class="mr-1"
            >
              {{ t(eq.name) }}<span v-if="eq.enhanceLevel">+{{ eq.enhanceLevel }}</span>
            </el-tag>
          </template>
        </el-descriptions-item>
      </el-descriptions>

      <div class="mt-2 text-sm">
        <template v-if="playerConfig.byAction.length">
          <div
            v-for="a in playerConfig.byAction"
            :key="a.action"
            class="flex items-center gap-2 flex-wrap mb-1"
          >
            <span class="text-gray-500 min-w-70px">{{ t(a.label) }}</span>
            <span v-if="!a.teas.length" class="text-gray-400">{{ t("未配饮品") }}</span>
            <el-tag v-for="tea in a.teas" :key="tea.hrid" size="small" type="info" class="mr-1">
              {{ t(tea.name) }}
            </el-tag>
          </div>
        </template>
        <span v-else class="text-gray-400">
          {{ t("还没有环节 —— 选好物品后，这里会列出对应动作的饮品配置") }}
        </span>
      </div>

      <div class="text-xs text-gray-400 mt-2">
        {{ t("饮品消耗 / 动作 = 3600 ÷ 300 秒 × (1 + 饮品浓度) ÷ 每小时动作数；浓度同时放大饮品增益强度（时长按 1+浓度 缩短，喝得更频繁）。这些都是逐项计入成本的。") }}
      </div>
    </el-card>

    <!-- 结果 -->
    <el-card v-if="result" class="mt-3">
      <template #header>
        <div class="flex items-center justify-between">
          <span>{{ t("计算结果") }}：{{ result.project }}</span>
          <el-button type="primary" text @click="showDetail(result)">
            {{ t("查看详情") }}
          </el-button>
        </div>
      </template>
      <!-- ⚠️ 「利润」是**净利**：= 收入 − 成本（成本含原料 / 饮品 / 催化剂 / 金币）。
           把 收入 与 成本 并排摆在它前面，用户可以自己一眼验算，不必猜口径。 -->
      <el-descriptions :column="5" border>
        <el-descriptions-item :label="t('收入 / h')">{{ result.result.incomePHFormat }}</el-descriptions-item>
        <el-descriptions-item :label="t('成本 / h')">{{ result.result.costPHFormat }}</el-descriptions-item>
        <el-descriptions-item :label="t('利润 / h（净）')">
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-360px leading-5">
                {{ t("净利 = 收入 − 成本。成本已包含全部投入：原料、饮品（按玩家配置）、催化剂、金币。") }}
                <div class="mt-1">
                  {{ t("口径：") }}{{ result.result.incomePHFormat }} − {{ result.result.costPHFormat }}
                  = {{ result.result.profitPHFormat }}
                </div>
              </div>
            </template>
            <span :class="result.result.profitPH > 0 ? 'success' : 'error'">{{ result.result.profitPHFormat }}</span>
          </el-tooltip>
        </el-descriptions-item>
        <el-descriptions-item :label="t('利润率')">{{ result.result.profitRateFormat }}</el-descriptions-item>
        <el-descriptions-item :label="t('自产比例')">{{ result.result.selfProduceRatioFormat || "--" }}</el-descriptions-item>
      </el-descriptions>

      <el-table :data="result.resultList.flat()" class="mt-3" size="small">
        <el-table-column width="44">
          <template #default="{ row }">
            <ItemIcon :hrid="row.hrid" />
          </template>
        </el-table-column>
        <el-table-column prop="name" :label="t('物品')" min-width="120" />
        <el-table-column prop="project" :label="t('项目')" min-width="80" />
        <el-table-column :label="t('倍率')" align="center" min-width="80">
          <template #default="{ row }">{{ Format.number(row.workMultiplier, 2) }}</template>
        </el-table-column>
        <!-- ⚠️ 「产出命中率」与「动作成功率」是两个数，新手极易混淆：
             动作成功率 = 这一步会不会成功（炼金恒 50%）；
             产出命中率 = 成功后能不能拿到**你要的那个**产物（实测低至 0.5%）。
             只显示后者会被误判成「稳赚」，所以两列并排给出。 -->
        <el-table-column :label="t('动作成功率')" align="center" min-width="100">
          <template #default="{ row }">
            <span :class="row.successRate >= 1 ? 'text-gray-400' : 'text-orange-500'">
              {{ Format.percent(row.successRate) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="t('产出命中率')" align="center" min-width="150">
          <template #default="{ row }">
            <el-tooltip
              v-if="resultChainSteps[row.project + row.hrid]"
              placement="top"
              effect="light"
              :show-after="120"
            >
              <template #content>
                <div class="max-w-360px leading-5">
                  {{ t("这一步每小时做 {0} 次，平均每 {1} 次出 1 个你要的产物。", [
                    String(resultChainSteps[row.project + row.hrid].actionsPerHour),
                    String(attemptsPerOf(resultChainSteps[row.project + row.hrid].successRate))
                  ]) }}
                </div>
              </template>
              <el-tag
                size="small"
                :type="RATE_TAG_TYPE[rateLevelOf(resultChainSteps[row.project + row.hrid].successRate)] as any"
              >
                {{ Format.percent(resultChainSteps[row.project + row.hrid].successRate) }}
              </el-tag>
            </el-tooltip>
            <span v-else class="text-gray-400">--</span>
          </template>
        </el-table-column>
        <el-table-column prop="profitPHFormat" :label="t('利润 / h')" align="center" min-width="110" />
        <el-table-column prop="profitRateFormat" :label="t('利润率')" align="center" min-width="90" />
        <el-table-column prop="expPHFormat" :label="t('经验 / h')" align="center" min-width="110" />
        <el-table-column prop="timeCostFormat" :label="t('单次耗时')" align="center" min-width="100" />
      </el-table>

      <!-- 炼金产出分布：让「0.5% 才有我要的东西」这件事看得见 -->
      <div
        v-for="(sum, key) in alchemyBreakdown"
        :key="key"
        class="mt-3 p-3 rounded border"
      >
        <div class="text-sm font-medium mb-1">
          {{ t("『") }}{{ t(getItemDetailOf(key)?.name || String(key)) }}{{ t("』的完整产出分布") }}
          <span class="text-xs text-gray-500 font-normal ml-1">
            {{ t("每 1000 次转化大约得到：") }}
          </span>
        </div>
        <div class="flex flex-wrap gap-2 text-sm">
          <span
            v-for="o in sum.outputs.filter(x => x.rate != null)"
            :key="o.hrid"
            class="inline-flex items-center gap-1"
          >
            <ItemIcon :hrid="o.hrid" :width="18" :height="18" />
            <span>{{ t(o.name) }}</span>
            <span class="text-gray-500">×{{ Math.round(o.rate! * 1000) }}</span>
          </span>
        </div>
      </div>
    </el-card>

    <ActionDetail v-model="detailVisible" :data="detailData" />
  </div>
</template>

<style scoped>
.chain-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chain-step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}
.chain-step-no {
  min-width: 52px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.target-hints {
  max-height: 140px;
  overflow-y: auto;
}
.success {
  color: #67c23a;
}
.error {
  color: #f56c6c;
}
</style>
