<script lang="ts" setup>
import type { ArbQueryParams, ArbRateBase, ArbSortKey } from "@/common/apis/marketarb"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import SearchPanel from "@@/components/SearchPanel/index.vue"
import type { PanelField, PanelSearchData } from "@@/components/SearchPanel/types"
import * as Format from "@@/utils/format"
import { QuestionFilled } from "@element-plus/icons-vue"
import { useI18n } from "vue-i18n"
import {
  ARB_DEFAULT_SORT_KEY,
  ARB_SORT_KEYS,
  ARB_TAX_RATE,
  calcArbList,
  getArbCategoryOptions,
  getArbSummary,
  runArbQuery
} from "@/common/apis/marketarb"
import { enhanceLevelSuffix } from "@/common/apis/marketvolume"
import {
  alertKeyOf,
  createEmptyRule,
  evaluateAlerts,
  type AlertHit,
  type AlertMetric,
  type AlertOperator,
  type AlertScopeType
} from "@/common/apis/marketvolume/alerts"
import { useMemory } from "@@/composables/useMemory"
import { normalizeSearchData } from "@@/composables/useSearchPanel"
import { useAlertStore } from "@/pinia/stores/alert"
import { pushAlertNotifications } from "@@/utils/alert-notify"
import GameInfo from "../dashboard/components/GameInfo.vue"

/**
 * 炒货：把「左价与右价之间的差价扣掉税之后还有多少」列出来。
 *
 * 操作口径（用户 2026-10-09 确认）：
 *   ① 在【右价】挂买单排队等成交 → 成本 = 右价
 *   ② 在【左价】挂卖单排队等成交 → 收入 = 左价 × (1 − 4% 成交税)
 * 两腿都要等 ⇒ 期间左价可能下跌，这就是唯一的风险。
 *
 * ⚠️ 官方 marketplace 只有 4 个字段（a/b/p/v），**没有挂单队列深度**，
 *    所以本页**不给「总额潜力」**——用「净利 × 当日成交量」会严重高估
 *    （那不是你能吃到的量）。`volume` 只作参考列。
 */
const { t } = useI18n()
const alertStore = useAlertStore()

/**
 * 检索条件：走**标准多变搜索面板**（`SearchPanel` + `PanelField` 配置），
 * 与利润排行 / 市场监控同一套 UI 与引擎。
 *
 * 面板把 range 的模式/容差写在 `__mode` / `__tolerance` 里，
 * 执行侧由 `runArbQuery` → `rangeQueryFromFlat` 还原成区间条件。
 *
 * 默认值里唯一非空的是 `minVolume: 1`（当日成交 ≥1）：
 * 实测不设门槛时 967 个候选的净率榜首全是 0 成交的离谱挂单
 * （星空锅铲 左 43.2 亿 / 右 500 万，净率 82844%）；设成 1 后降到 264 条，
 * 沼泽精华排名 #420 → #81。实测 10 → 117 条、100 → 66 条。
 */
const searchData = useMemory("marketarb-search-data", {
  name: [],
  category: "",
  minNetRate: undefined,
  maxNetRate: undefined,
  minNetPerUnit: undefined,
  maxNetPerUnit: undefined,
  minAsk: undefined,
  maxAsk: undefined,
  minBid: undefined,
  maxBid: undefined,
  minVolume: 1,
  maxVolume: undefined,
  hideSuspicious: false,
  rateBase: "bid"
}) as Ref<ArbQueryParams & { rateBase?: ArbRateBase }>
normalizeSearchData(searchData.value as PanelSearchData)

/**
 * 净率基数（用户 2026-10-09 确认默认右价，但要求可调）。
 *
 * 必须在**计算层**就按它算，而不是界面二次换算 ——
 * 净率同时是排序键、提醒指标、面板的净率区间，三处都读它。
 */
const rateBase = computed<ArbRateBase>(() => (searchData.value.rateBase === "ask" ? "ask" : "bid"))
const RATE_BASE_OPTIONS: { value: ArbRateBase, label: string }[] = [
  { value: "bid", label: "右价（资金回报率）" },
  { value: "ask", label: "左价（毛利率）" }
]
const rateBaseLabel = computed(() => RATE_BASE_OPTIONS.find(o => o.value === rateBase.value)?.label ?? "")

const all = computed(() => calcArbList(rateBase.value))
const summary = computed(() => getArbSummary())
const categoryOptions = computed(() => getArbCategoryOptions(all.value))

/** 搜索面板配置：字段顺序 / 文案 / 边界（与其它检索页同一套渲染） */
const panelFields: PanelField[] = [
  { type: "name", key: "name", label: "物品", tip: "炒货物品说明", width: 240 },
  {
    type: "range",
    label: "净率",
    tip: "净率区间说明",
    minKey: "minNetRate",
    maxKey: "maxNetRate",
    unit: "%",
    min: 0,
    step: 0.5,
    precision: 2,
    placeholderMin: "0",
    placeholderMax: "不限"
  },
  {
    type: "range",
    label: "税后净利 / 件",
    tip: "单件净利说明",
    minKey: "minNetPerUnit",
    maxKey: "maxNetPerUnit",
    min: 0,
    precision: 2,
    placeholderMin: "0",
    placeholderMax: "不限"
  },
  {
    type: "range",
    label: "左价",
    tip: "左价说明",
    minKey: "minAsk",
    maxKey: "maxAsk",
    min: 0,
    placeholderMin: "0",
    placeholderMax: "不限"
  },
  {
    type: "range",
    label: "右价",
    tip: "右价说明",
    minKey: "minBid",
    maxKey: "maxBid",
    min: 0,
    placeholderMin: "0",
    placeholderMax: "不限"
  },
  {
    type: "range",
    label: "当日成交",
    tip: "当日成交说明",
    minKey: "minVolume",
    maxKey: "maxVolume",
    min: 0,
    step: 1,
    placeholderMin: "1",
    placeholderMax: "不限"
  },
  {
    type: "select",
    key: "category",
    label: "分类",
    tip: "分类筛选说明",
    options: () => [{ label: "全部分类", value: "" }, ...categoryOptions.value.map(c => ({
      label: `item_category.${c}`,
      value: c
    }))],
    width: 140
  },
  { type: "select", key: "rateBase", label: "净率基数", tip: "净率基数说明", options: RATE_BASE_OPTIONS, width: 180 },
  { type: "checkbox", key: "hideSuspicious", label: "隐藏疑似异常报价" }
]

/* ───────────────────────── 排序 ───────────────────────── */
/** 默认按净率降序（用户指定）——单位百分比最能一眼看出「哪个品种的差价盖得住税」 */
const sortKey = ref<ArbSortKey>(ARB_DEFAULT_SORT_KEY)
const sortOrder = ref<"ascending" | "descending">("descending")
const rows = computed(() => runArbQuery(all.value, searchData.value, { key: sortKey.value, order: sortOrder.value }))

/** 已生效的筛选条件数（面板上提示用；口径与市场监控一致） */
const activeFilterCount = computed(() => {
  const p = searchData.value as Record<string, unknown>
  let n = 0
  if (Array.isArray(p.name) && p.name.length) n++
  for (const k of ["minNetRate", "maxNetRate", "minNetPerUnit", "maxNetPerUnit", "minAsk", "maxAsk", "minBid", "maxBid", "maxVolume"]) {
    if (p[k] != null) n++
  }
  // minVolume 默认 1，不算「用户设的条件」
  if (p.minVolume != null && p.minVolume !== 1) n++
  if (p.category) n++
  if (p.hideSuspicious) n++
  return n
})

function resetFilter() {
  searchData.value = {
    name: [],
    category: "",
    minNetRate: undefined,
    maxNetRate: undefined,
    minNetPerUnit: undefined,
    maxNetPerUnit: undefined,
    minAsk: undefined,
    maxAsk: undefined,
    minBid: undefined,
    maxBid: undefined,
    minVolume: 1,
    maxVolume: undefined,
    hideSuspicious: false,
    rateBase: "bid"
  }
}

/**
 * 表头排序。
 *
 * ⚠️ 必须过 `ARB_SORT_KEYS` 白名单：`el-table` 的 `sortable="custom"` 会把
 * **列的 prop** 原样派发过来，白名单外的键会被当成合法值写进 `sortKey`，
 * 表现是「表头箭头变了、数据却没变」。
 * （市场监控页的 `MARKET_VOLUME_SORT_KEYS` 就是为这个存在的。）
 */
function onSortChange(payload: { prop: string | null, order: string | null }) {
  const allowed = (ARB_SORT_KEYS as readonly string[]).includes(payload.prop ?? "")
  if (!payload.prop || !payload.order || !allowed) {
    // 取消排序 / 未知列 ⇒ 回到默认列
    sortKey.value = ARB_DEFAULT_SORT_KEY
    sortOrder.value = "descending"
    return
  }
  sortKey.value = payload.prop as ArbSortKey
  sortOrder.value = payload.order === "descending" ? "descending" : "ascending"
}

/* ───────────────────────── 价差提醒（复用市场监控的规则引擎） ───────────────────────── */
/** 本页行上有值的指标就这两个；其余指标在这里恒为 null，建了也永不命中 */
const METRIC_OPTIONS: { value: AlertMetric, label: string }[] = [
  { value: "netRate", label: "净率" },
  { value: "netPerUnit", label: "税后净利/件" }
]
const METRIC_LABEL: Record<AlertMetric, string> = {
  netRate: "净率",
  netPerUnit: "税后净利/件",
  price: "价格",
  ask: "左挂单",
  bid: "右收购",
  changePct: "涨跌",
  volumeRate: "成交量速率",
  volumeRolling: "时间窗内成交量",
  volume: "当日累计成交量",
  turnoverRolling: "时间窗内成交额"
}
const OPERATOR_OPTIONS: { value: AlertOperator, label: string }[] = [
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" }
]
const SCOPE_OPTIONS: { value: AlertScopeType, label: string }[] = [
  { value: "all", label: "全部" },
  { value: "category", label: "按分类" },
  { value: "item", label: "按物品" }
]

const newRule = reactive({
  metric: "netRate" as AlertMetric,
  operator: "gte" as AlertOperator,
  threshold: 20,
  scopeType: "all" as AlertScopeType,
  scopeValue: ""
})

function addRule() {
  const rule = createEmptyRule()
  rule.metric = newRule.metric
  rule.operator = newRule.operator
  // 净率用百分比存（20 = 20%），与界面输入一致；引擎按行上的 netRate 比较
  rule.threshold = newRule.metric === "netRate" ? newRule.threshold / 100 : newRule.threshold
  rule.scopeType = newRule.scopeType
  rule.scopeValue = newRule.scopeType === "all" ? undefined : newRule.scopeValue
  rule.label = undefined
  rule.priority = 50
  alertStore.addRule(rule)
  newRule.threshold = 20
}

const alertRules = computed(() => alertStore.rules)
const alertHits = computed(() => evaluateAlerts(rows.value, alertRules.value))
const alertHitMap = computed(() => {
  const map = new Map<string, string>()
  for (const hit of alertHits.value) {
    map.set(alertKeyOf(hit.hrid, hit.level), `${METRIC_LABEL[hit.metric]} ${formatMetric(hit.metric, hit.value)}`)
  }
  return map
})

function formatMetric(metric: AlertMetric, value: number): string {
  return metric === "netRate" ? Format.percent(value, 2) : Format.number(value, 2)
}

function ruleText(rule: { metric: AlertMetric, operator: AlertOperator, threshold?: number, scopeType: AlertScopeType, scopeValue?: string }): string {
  const cmp = rule.operator === "gte" ? "≥" : "≤"
  const val = rule.threshold == null ? "?" : formatMetric(rule.metric, rule.threshold)
  const scope = rule.scopeType === "all"
    ? t("全部")
    : `${rule.scopeType === "category" ? t("分类") : t("物品")}：${rule.scopeValue ?? "-"}`
  return `${METRIC_LABEL[rule.metric]} ${cmp} ${val} · ${scope}`
}

/* ───────────────────────── 展示辅助 ───────────────────────── */
/**
 * 浏览器通知：**实现已抽到 `common/utils/alert-notify`**（与市场监控共用）。
 *
 * 之前这里只打了页内标签，用户在市场监控页开的「通知」对炒货命中不生效 ——
 * 这正是「提醒引擎共用、通知实现不共用」留下的缺口。
 */
const notifyEnabled = computed(() => alertStore.notifyEnabled)
const ruleById = computed(() => new Map(alertRules.value.map(r => [r.id, r])))
function pushBrowserNotifications(hits: AlertHit[]) {
  pushAlertNotifications(hits, {
    enabled: notifyEnabled.value,
    title: t("价差提醒"),
    bodyOf: hit => `${t(hit.name)} ${METRIC_LABEL[hit.metric]} ${formatMetric(hit.metric, hit.value)}`,
    bodyOfMany: count => t("有 {0} 条新的价差提醒", [count]),
    cooldownMinutesOf: ruleId => ruleById.value.get(ruleId)?.cooldownMinutes ?? alertStore.cooldownMinutes
  })
}
// 只在「命中集合的形状」变化时通知（只改数值不重复弹）
watch(
  () => alertHits.value.map(h => `${h.ruleId}|${h.hrid}|${h.level}`).join(","),
  () => pushBrowserNotifications(alertHits.value)
)

function netClass(v: number) {
  return v > 0 ? "success" : "error"
}
function levelSuffix(level: string) {
  return enhanceLevelSuffix(level)
}
</script>

<template>
  <div>
    <GameInfo />

    <!-- ══════════════ 口径说明 ══════════════ -->
    <el-card>
      <template #header>
        <div class="flex items-center gap-2 flex-wrap">
          <span>{{ t("炒货：左右价之间的差价") }}</span>
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-460px leading-5">
                {{ t("左价 = 市场挂卖单的最低价，你挂单能卖出的价；右价 = 市场收购的最高价，你挂买单能买到的价。") }}
                <div class="mt-1">
                  {{ t("炒货就是在右价挂买单排队等成交，再在左价挂卖单排队等卖出，赚中间的差价。") }}
                </div>
                <div class="mt-1 text-gray-300">
                  {{ t("两腿都要等成交，等待期左价可能下跌 —— 这是唯一的风险，也是本页不给「总额潜力」的原因：官方只公布当日累计成交量，没有挂单队列深度，算不出你能吃下多少。") }}
                </div>
              </div>
            </template>
            <el-icon class="cursor-help text-gray-400"><QuestionFilled /></el-icon>
          </el-tooltip>
          <span class="text-sm text-gray-400">{{ t("已扣市场成交税") }} {{ Format.percent(ARB_TAX_RATE) }}</span>
        </div>
      </template>

      <div class="flex items-center gap-2 flex-wrap text-sm mb-3">
        <el-tag size="small" type="info">{{ t("① 右价挂买单") }}</el-tag>
        <span class="text-gray-400">→</span>
        <el-tag size="small">{{ t("② 等成交（承担时间与跌价风险）") }}</el-tag>
        <span class="text-gray-400">→</span>
        <el-tag size="small" type="success">{{ t("③ 左价挂卖单") }}</el-tag>
      </div>

      <el-descriptions :column="3" border size="small">
        <el-descriptions-item :label="t('毛差')">
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-320px leading-5">{{ t("左价 − 右价，还没扣税。") }}</div>
            </template>
            <span>{{ t("左价 − 右价") }}</span>
          </el-tooltip>
        </el-descriptions-item>
        <el-descriptions-item :label="t('成交税')">
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-360px leading-5">
                {{ t("税基是卖出成交额：左价 × 4%。买入不征税，所以右价是净成本。") }}
              </div>
            </template>
            <span>{{ t("左价 × ") }} {{ Format.percent(ARB_TAX_RATE) }}</span>
          </el-tooltip>
        </el-descriptions-item>
        <el-descriptions-item :label="t('净利 / 件')">
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-360px leading-5">
                {{ t("净利 = 左价 × (1 − 税率) − 右价；净率 = 净利 ÷ 基数（基数可在下方切换）。") }}
              </div>
            </template>
            <span class="font-bold">{{ t("左价 × ") }}{{ Format.number(1 - ARB_TAX_RATE, 2) }} − {{ t("右价") }}</span>
          </el-tooltip>
        </el-descriptions-item>
      </el-descriptions>

      <div class="text-xs text-gray-400 mt-2">
        <span v-if="summary.quoted > 0">
          {{ t("双边有报价 ") }}{{ summary.quoted }}{{ t(" 个品种，其中 ") }}
          <span class="text-success font-bold">{{ summary.profitable }}</span>
          {{ t(" 个扣完税还有差价；") }}{{ summary.singleSide }}{{ t(" 个只有单边报价（不可炒）。") }}
        </span>
      </div>
    </el-card>

    <!-- ══════════════ 多变搜索面板（与利润排行 / 市场监控同一套）══════════════ -->
    <el-card class="mt-3">
      <SearchPanel v-model="searchData" :fields="panelFields" title="炒货筛选" @change="() => {}" />
      <div class="flex items-center gap-2 flex-wrap mt-2">
        <el-tag v-if="activeFilterCount" size="small" type="info">
          {{ t("已启用 ") }}{{ activeFilterCount }}{{ t(" 个条件") }}
        </el-tag>
        <el-button v-if="activeFilterCount" size="small" @click="resetFilter">{{ t("重置全部条件") }}</el-button>
        <span class="text-xs text-gray-400">
          {{ t("区间条件支持 9 种模式（≥ / ≤ / 区间 / 区间之外 / 接近 / = / 前 N / 后 N），与其它检索页一致。") }}
        </span>
      </div>
    </el-card>

    <!-- ══════════════ 价差提醒 ══════════════ -->
    <el-card class="mt-3">
      <template #header>
        <div class="flex items-center gap-2 flex-wrap">
          <span>{{ t("价差提醒") }}</span>
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-420px leading-5">
                {{ t("与「市场监控」共用同一套提醒规则（同一个存储）。这里新增两个指标：税后净利/件、净率。") }}
                <div class="mt-1 text-gray-300">
                  {{ t("净率阈值按百分比填（例如 20 表示 20%），并按**当前净率基数**解释 —— 切换基数后，同一条规则的含义会跟着变。命中的行会在表格里打标签。") }}
                </div>
              </div>
            </template>
            <el-icon class="cursor-help text-gray-400"><QuestionFilled /></el-icon>
          </el-tooltip>
          <el-tag v-if="alertHits.length" size="small" type="danger">
            {{ t("命中 ") }}{{ alertHits.length }}{{ t(" 条") }}
          </el-tag>
        </div>
      </template>

      <div class="flex items-center gap-2 flex-wrap text-sm">
        <el-select v-model="newRule.metric" size="small" style="width: 130px">
          <el-option v-for="m in METRIC_OPTIONS" :key="m.value" :label="t(m.label)" :value="m.value" />
        </el-select>
        <el-select v-model="newRule.operator" size="small" style="width: 80px">
          <el-option v-for="o in OPERATOR_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-input-number v-model="newRule.threshold" :min="0" :step="1" size="small" style="width: 120px" />
        <span class="text-xs text-gray-400">{{ newRule.metric === "netRate" ? "%" : "" }}</span>
        <el-select v-model="newRule.scopeType" size="small" style="width: 110px">
          <el-option v-for="s in SCOPE_OPTIONS" :key="s.value" :label="t(s.label)" :value="s.value" />
        </el-select>
        <el-input
          v-if="newRule.scopeType !== 'all'"
          v-model="newRule.scopeValue"
          size="small"
          :placeholder="newRule.scopeType === 'category' ? t('分类末段，如 equipment') : t('hrid')"
          style="width: 220px"
        />
        <el-button size="small" type="primary" @click="addRule">{{ t("新增规则") }}</el-button>
      </div>

      <div v-if="alertRules.length" class="mt-2 flex items-center gap-2 flex-wrap">
        <span class="text-xs text-gray-500">{{ t("已有规则") }}</span>
        <el-tag
          v-for="r in alertRules"
          :key="r.id"
          size="small"
          :type="r.enabled ? 'info' : 'info'"
          closable
          @close="alertStore.removeRule(r.id)"
        >
          {{ ruleText(r) }}
        </el-tag>
      </div>
      <div v-else class="text-xs text-gray-400 mt-2">
        {{ t("还没有规则。规则与「市场监控」共享，会一直保存。") }}
      </div>
    </el-card>

    <!-- ══════════════ 结果 ══════════════ -->
    <el-card class="mt-3">
      <template #header>
        <div class="flex items-center gap-2 flex-wrap">
          <span>
            {{ t("符合条件 ") }}<span class="font-bold">{{ rows.length }}</span>{{ t(" 个品种") }}
          </span>
          <span class="text-sm text-gray-400">
            {{ t("默认按净率降序；点表头可切换。净利已扣税。") }}
          </span>
        </div>
      </template>

      <el-table
        :data="rows"
        size="small"
        :default-sort="{ prop: ARB_DEFAULT_SORT_KEY, order: 'descending' }"
        @sort-change="onSortChange"
      >
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="text-xs leading-6 px-2 py-1">
              <div class="font-bold mb-1">{{ t("怎么炒这条") }}</div>
              <div>
                ① 在 <span class="font-bold">{{ t("右价 ") }}{{ Format.price(row.bid) }}</span>
                {{ t("挂买单排队，等卖家来成交（成本就是右价，买入不征税）") }}
              </div>
              <div>
                ② 成交后再去 <span class="font-bold">{{ t("左价 ") }}{{ Format.price(row.ask) }}</span>
                {{ t("挂卖单排队，等买家来成交") }}
              </div>
              <div>
                ③ 每件到手 <span class="font-bold">{{ Format.price(Math.round(row.ask * (1 - ARB_TAX_RATE))) }}</span>
                （已扣 {{ Format.percent(ARB_TAX_RATE) }} 税），{{ t("净赚") }}
                <span class="font-bold" :class="netClass(row.netPerUnit)">{{ Format.number(row.netPerUnit, 2) }}</span>
                {{ t("／件，净率") }} {{ Format.percent(row.netRate) }}
              </div>
              <div class="text-gray-400 mt-1">
                {{ t("风险：两腿都要等成交。若等待期左价跌到") }}
                {{ Format.price(Math.floor(row.bid / (1 - ARB_TAX_RATE))) }}
                {{ t("以下，这笔就白等了（那是盈亏平衡价）。") }}
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column :label="t('物品')" prop="name" min-width="180" sortable="custom">
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <ItemIcon :hrid="row.hrid" />
              <div class="leading-5">
                <div>{{ t(row.name) }}<span v-if="levelSuffix(row.level)" class="text-gray-400">{{ levelSuffix(row.level) }}</span></div>
                <div class="text-xs text-gray-400">{{ t("item_category." + row.category) }}</div>
              </div>
              <el-tag v-if="alertHitMap.get(row.hrid + '|' + row.level)" size="small" type="danger" class="ml-1">
                {{ alertHitMap.get(row.hrid + "|" + row.level) }}
              </el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column :label="t('左价（挂卖单）')" prop="ask" align="right" min-width="120" sortable="custom">
          <template #default="{ row }">
            <el-tooltip placement="top" effect="light" :show-after="120">
              <template #content>
                <div class="max-w-300px leading-5">{{ t("市场挂卖单的最低价，你挂单能卖出的价。") }}</div>
              </template>
              <span>{{ Format.price(row.ask) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>

        <el-table-column :label="t('右价（挂买单）')" prop="bid" align="right" min-width="120" sortable="custom">
          <template #default="{ row }">
            <el-tooltip placement="top" effect="light" :show-after="120">
              <template #content>
                <div class="max-w-300px leading-5">{{ t("市场收购的最高价，你挂买单能买到的价。") }}</div>
              </template>
              <span>{{ Format.price(row.bid) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>

        <el-table-column :label="t('最新成交')" prop="price" align="right" min-width="110" sortable="custom">
          <template #default="{ row }">
            <el-tooltip placement="top" effect="light" :show-after="120">
              <template #content>
                <div class="max-w-300px leading-5">{{ t("官方 p 字段：最近一笔成交价。用来判断当前挂单价是不是刚被砸过。") }}</div>
              </template>
              <span :class="row.price > 0 ? '' : 'text-gray-400'">
                {{ row.price > 0 ? Format.price(row.price) : "--" }}
              </span>
            </el-tooltip>
          </template>
        </el-table-column>

        <el-table-column :label="t('毛差')" prop="grossSpread" align="right" min-width="90" sortable="custom">
          <template #default="{ row }">{{ Format.number(row.grossSpread, 2) }}</template>
        </el-table-column>

        <el-table-column :label="`成交税（${Format.percent(ARB_TAX_RATE)}）`" prop="taxAmount" align="right" min-width="110" sortable="custom">
          <template #default="{ row }">
            <span class="text-gray-400">-{{ Format.number(row.taxAmount, 2) }}</span>
          </template>
        </el-table-column>

        <el-table-column :label="t('净利 / 件')" prop="netPerUnit" align="right" min-width="110" sortable="custom">
          <template #default="{ row }">
            <span class="font-bold" :class="netClass(row.netPerUnit)">{{ Format.number(row.netPerUnit, 2) }}</span>
            <el-tooltip v-if="row.subUnit" placement="top" effect="light" :show-after="120">
              <template #content>
                <div class="max-w-320px leading-5">
                  {{ t("单件净利不足 1（金币）：按 4% 税后多半要被取整，这种「有价差但吃不到」的条目别当成能赚。") }}
                </div>
              </template>
              <el-tag size="small" type="warning" class="ml-1">{{ t("不足 1") }}</el-tag>
            </el-tooltip>
          </template>
        </el-table-column>

        <el-table-column :label="t('净率')" prop="netRate" align="right" min-width="100" sortable="custom">
          <template #default="{ row }">
            <el-tooltip placement="top" effect="light" :show-after="120">
              <template #content>
                <div class="max-w-360px leading-5">
                  {{ t("当前基数：") }}{{ rateBaseLabel }}
                  <div class="mt-1">
                    {{ t("沼泽精华 5.12 ÷ 64 = 8%（右价口径）；÷ 72 = 7.11%（左价口径）。") }}
                  </div>
                  <div class="mt-1 text-gray-300">
                    {{ t("净率同时是排序键与提醒指标，所以切换会同时影响三处，不是只改显示。") }}
                  </div>
                </div>
              </template>
              <span class="font-bold">{{ Format.percent(row.netRate) }}</span>
            </el-tooltip>
            <el-tooltip v-if="row.suspicious" placement="top" effect="light" :show-after="120">
              <template #content>
                <div class="max-w-400px leading-5">
                  {{ t("左价是右价的 ") }}{{ Format.number(row.leftRightRatio, 1) }}{{ t(" 倍。真实市场的买卖价差不会到几倍 —— 这多半是有人挂了个没人接的离谱卖单，而不是真有这么大利润。") }}
                  <div class="mt-1 text-gray-300">
                    {{ t("实测官方市场里这类条目几乎都是当日成交 0。勾选上面的「隐藏疑似异常报价」可把它们滤掉。") }}
                  </div>
                </div>
              </template>
              <el-tag size="small" type="danger" class="ml-1">{{ t("疑似异常") }}</el-tag>
            </el-tooltip>
          </template>
        </el-table-column>

        <el-table-column :label="t('当日成交')" prop="volume" align="right" min-width="120" sortable="custom">
          <template #default="{ row }">
            <el-tooltip placement="top" effect="light" :show-after="120">
              <template #content>
                <div class="max-w-360px leading-5">
                  {{ t("官方 v 字段：当日累计成交量（UTC 0 点归零）。") }}
                  <div class="mt-1 text-gray-300">
                    {{ t("⚠️ 这不是「你能吃下的量」—— 官方不公布挂单队列深度，所以本页不给总额潜力。") }}
                  </div>
                </div>
              </template>
              <span :class="row.volume > 0 ? '' : 'text-gray-400'">
                {{ row.volume > 0 ? Format.number(row.volume, 0) : t("无成交") }}
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="!rows.length" class="text-sm text-gray-400 mt-2">
        {{ t("没有符合条件的品种。") }}
        <span v-if="all.length && activeFilterCount">{{ t("试试放宽条件。") }}</span>
        <span v-else>{{ t("当前市场上双边有报价的 ") }}{{ summary.quoted }}{{ t(" 个品种里，一个都没有扣完税还有差价。") }}</span>
      </div>

      <div class="text-xs text-gray-400 mt-2">
        {{ t("「当日成交」是官方口径的当日累计量（UTC 0 点归零），只能当热度参考；") }}
        {{ t("本页刻意不给「总额潜力」—— 官方不公布挂单队列深度，用净利 × 成交量会严重高估你能吃到的量。") }}
      </div>
    </el-card>
  </div>
</template>
