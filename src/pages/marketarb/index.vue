<script lang="ts" setup>
import type { ArbSortKey } from "@/common/apis/marketarb"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import * as Format from "@@/utils/format"
import { QuestionFilled } from "@element-plus/icons-vue"
import { useI18n } from "vue-i18n"
import {
  ARB_DEFAULT_SORT_KEY,
  ARB_TAX_RATE,
  calcArbList,
  filterArbItems,
  getArbCategoryOptions,
  getArbSummary,
  sortArbRows
} from "@/common/apis/marketarb"
import { enhanceLevelSuffix } from "@/common/apis/marketvolume"
import {
  alertKeyOf,
  createEmptyRule,
  evaluateAlerts,
  type AlertMetric,
  type AlertOperator,
  type AlertScopeType
} from "@/common/apis/marketvolume/alerts"
import { useAlertStore } from "@/pinia/stores/alert"
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

const all = computed(() => calcArbList())
const summary = computed(() => getArbSummary())

/* ───────────────────────── 筛选 ───────────────────────── */
const keyword = ref("")
const minNetRatePct = ref(0)
const minNetPerUnit = ref(0)
const minBid = ref(0)
/**
 * 默认**开启**「只看当日有成交的」。
 *
 * 实测（官方实时数据 2026-10-09）：不开启时 967 个候选里，净率榜首全是
 * 0 成交的离谱挂单（星空锅铲 左 43.2 亿 / 右 500 万，净率 82844%）——
 * 那是有人挂了个没人接的卖单，不是真实价差。开启后降到 264 条，
 * 沼泽精华的排名从 #420 提到 #81。
 */
const onlyTraded = ref(true)
const minVolume = ref(0)
const hideSuspicious = ref(false)
const categories = ref<string[]>([])
const categoryOptions = computed(() => getArbCategoryOptions(all.value))

const filtered = computed(() => filterArbItems(all.value, {
  keyword: keyword.value,
  minNetRate: minNetRatePct.value > 0 ? minNetRatePct.value / 100 : undefined,
  minNetPerUnit: minNetPerUnit.value > 0 ? minNetPerUnit.value : undefined,
  minBid: minBid.value > 0 ? minBid.value : undefined,
  onlyTraded: onlyTraded.value,
  minVolume: minVolume.value > 0 ? minVolume.value : undefined,
  hideSuspicious: hideSuspicious.value,
  categories: categories.value
}, n => String(t(n))))

function resetFilter() {
  keyword.value = ""
  minNetRatePct.value = 0
  minNetPerUnit.value = 0
  minBid.value = 0
  minVolume.value = 0
  hideSuspicious.value = false
  onlyTraded.value = true
  categories.value = []
}
const filterActive = computed(() => !!(keyword.value || minNetRatePct.value || minNetPerUnit.value
  || minBid.value || minVolume.value || !onlyTraded.value || hideSuspicious.value
  || categories.value.length))

/* ───────────────────────── 排序 ───────────────────────── */
/** 默认按净率降序（用户指定）——单位百分比最能一眼看出「哪个品种的差价盖得住税」 */
const sortKey = ref<ArbSortKey>(ARB_DEFAULT_SORT_KEY)
const sortDesc = ref(true)
const rows = computed(() => sortArbRows(filtered.value, sortKey.value, sortDesc.value))

function onSortChange(payload: { prop: string | null, order: string | null }) {
  if (!payload.prop || !payload.order) {
    // 取消排序 ⇒ 回到默认列，否则表头箭头消失了数据顺序却不变
    sortKey.value = ARB_DEFAULT_SORT_KEY
    sortDesc.value = true
    return
  }
  sortKey.value = payload.prop as ArbSortKey
  sortDesc.value = payload.order === "descending"
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
                {{ t("净利 = 左价 × (1 − 税率) − 右价；净率 = 净利 ÷ 右价（以买入价为基数）。") }}
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

    <!-- ══════════════ 筛选 ══════════════ -->
    <el-card class="mt-3">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex items-center gap-1">
          <span class="text-sm text-gray-500">{{ t("净率 ≥") }}</span>
          <el-input-number v-model="minNetRatePct" :min="0" :max="1000" :step="1" size="small" style="width: 110px" />
          <span class="text-sm text-gray-500">%</span>
        </div>
        <div class="flex items-center gap-1">
          <span class="text-sm text-gray-500">{{ t("单件净利 ≥") }}</span>
          <el-input-number v-model="minNetPerUnit" :min="0" :step="1" size="small" style="width: 130px" />
        </div>
        <div class="flex items-center gap-1">
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-320px leading-5">
                {{ t("过滤掉「1 个金币赚 0.6」这种看着热闹、实则没意义的条目。") }}
              </div>
            </template>
            <span class="text-sm text-gray-500">{{ t("右价 ≥") }}</span>
          </el-tooltip>
          <el-input-number v-model="minBid" :min="0" :step="1" size="small" style="width: 130px" />
        </div>
        <el-select
          v-model="categories"
          multiple
          collapse-tags
          collapse-tags-tooltip
          clearable
          size="small"
          :placeholder="t('分类（可多选）')"
          style="width: 220px"
        >
          <el-option v-for="c in categoryOptions" :key="c" :label="t('item_category.' + c)" :value="c" />
        </el-select>
        <el-input
          v-model="keyword"
          size="small"
          clearable
          :placeholder="t('物品（可搜中文名 / 英文名 / hrid）')"
          style="width: 240px"
        />
        <div class="flex items-center gap-1">
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-360px leading-5">
                {{ t("官方当日累计成交量。挂单两腿都要成交，从没人成交过的品种说明这不是真实价差 —— 实测不开这个门槛时，净率榜首全是 0 成交的离谱挂单。") }}
              </div>
            </template>
            <span class="text-sm text-gray-500">{{ t("当日成交 ≥") }}</span>
          </el-tooltip>
          <el-input-number v-model="minVolume" :min="0" :step="10" size="small" style="width: 120px" />
        </div>
        <el-checkbox v-model="onlyTraded" size="small">{{ t("只看当日有成交的") }}</el-checkbox>
        <el-checkbox v-model="hideSuspicious" size="small">{{ t("隐藏疑似异常报价") }}</el-checkbox>
        <el-button v-if="filterActive" size="small" @click="resetFilter">{{ t("重置筛选") }}</el-button>
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
                  {{ t("净率阈值按百分比填（例如 20 表示 20%）。命中的行会在表格里打标签。") }}
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
                <div class="max-w-320px leading-5">{{ t("净利 ÷ 右价，以买入价为基数。") }}</div>
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
        <span v-if="all.length && filterActive">{{ t("试试放宽筛选。") }}</span>
        <span v-else>{{ t("当前市场上双边有报价的 ") }}{{ summary.quoted }}{{ t(" 个品种里，一个都没有扣完税还有差价。") }}</span>
      </div>

      <div class="text-xs text-gray-400 mt-2">
        {{ t("「当日成交」是官方口径的当日累计量（UTC 0 点归零），只能当热度参考；") }}
        {{ t("本页刻意不给「总额潜力」—— 官方不公布挂单队列深度，用净利 × 成交量会严重高估你能吃到的量。") }}
      </div>
    </el-card>
  </div>
</template>
