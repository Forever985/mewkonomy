<script lang="ts" setup>
import { getMarketVolumeList, getMarketCategoryOptions, getMarketVolumeSummary, sortMarketVolumeRows, enhanceLevelSuffix, MARKET_VOLUME_SORT_KEYS, type MarketVolumeItem, type MarketVolumeSortKey } from "@/common/apis/marketvolume"
import { recordLocalSample, loadMarketHistory, getMarketChangeMap, getLocalSampleCount, getLastSampleTime, hasRemoteHistory, getHistorySpanHours, getRemoteSampleCount, getVolumeRateDetail, getRollingVolumeDetail, type MarketChangeMetric } from "@/common/apis/marketvolume/history"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import * as Format from "@@/utils/format"
import { QuestionFilled } from "@element-plus/icons-vue"
import { useGameStoreOutside } from "@/pinia/stores/game"
import { useI18n } from "vue-i18n"
import GameInfo from "../dashboard/components/GameInfo.vue"

const { t } = useI18n()
const gameStore = useGameStoreOutside()

// 响应式依赖 store，数据刷新后自动重算
const all = computed(() => {
  void gameStore.marketData
  void gameStore.gameData
  return getMarketVolumeList()
})

const categoryOptions = computed(() => getMarketCategoryOptions(all.value))

const keyword = ref("")
const category = ref("")
// 默认只看有成交：避免 3000+ 条无成交量记录淹没热门物品
const onlyActive = ref(true)
/**
 * 强化等级筛选（官方市场档位 level，0~20）。
 *
 * 装备在官方市场里是**按强化等级分档报价**的，一件装备最多能展开出十几个档位
 * （holy_chisel 有 0/2/3/4/5/6/7/8/10/11/12 共 11 档），所以需要能按档位筛选，
 * 否则「神圣凿子」会在列表里出现十几次。空数组 = 不限。
 */
const enhanceLevels = ref<string[]>([])
const enhanceLevelOptions = computed(() => {
  const set = new Set<string>()
  all.value.forEach((i) => set.add(i.level))
  return Array.from(set).sort((a, b) => Number(a) - Number(b))
})

// 涨跌时间窗（小时）
const WINDOW_OPTIONS = [1, 3, 6, 12, 24, 72, 168]
const windowHours = ref(6)
// 涨跌口径：价格 / 左挂单 / 右收购 / 成交量（成交量比的是增量速率）
const changeMetric = ref<MarketChangeMetric>("price")
const metricOptions = computed(() => [
  { value: "price", label: t("当前价") },
  { value: "ask", label: t("左挂单") },
  { value: "bid", label: t("右收购") },
  { value: "volume", label: `${t("成交量")}(${t("速率")})` }
])
/** 涨跌列表头用的口径名 */
const metricLabel = computed(() => metricOptions.value.find(m => m.value === changeMetric.value)?.label ?? t("当前价"))
// 涨跌方向筛选
const changeDir = ref<"all" | "up" | "down" | "flat">("all")
// 服务端历史加载完成标记（触发涨跌重算）
const historyReady = ref(false)
/** 正在补拉分片（切换时间窗会按需拉更多片） */
const historyLoading = ref(false)
const sampling = ref(false)

/**
 * 按所选时间窗拉取服务端归档分片。
 *
 * 归档按 UTC 6 小时分片，这里只取窗口覆盖到的片（已载入的会缓存），
 * 所以默认 6 小时窗只有 1~2 个请求；把时间窗调到 7 天才会补拉全部 30 片。
 */
async function refreshHistory() {
  historyLoading.value = true
  try {
    await loadMarketHistory(windowHours.value)
  } finally {
    historyReady.value = true
    historyLoading.value = false
  }
}

onMounted(async () => {
  recordLocalSample()
  await refreshHistory()
})

// 时间窗变了要补拉更长/更短范围的历史（已载入的片不会重复请求）
watch(windowHours, () => {
  void refreshHistory()
})

function handleSampleNow() {
  sampling.value = true
  try {
    const added = recordLocalSample(true)
    if (!added) {
      ElMessage.warning(t("本地采样已是最新，无需重复记录"))
    } else {
      ElMessage.success(t("已记录历史采样点"))
    }
  } finally {
    sampling.value = false
  }
}

// 涨跌：当前值 vs 时间窗基准（口径可选，成交量走增量速率）
const changeMap = computed(() => getMarketChangeMap(all.value, windowHours.value, changeMetric.value))
const changeApplied = computed(() =>
  all.value.map((i) => {
    const c = changeMap.value.get(`${i.hrid}|${i.level}`)
    i.changePct = c?.pct ?? null
    i.changeBase = c?.base ?? null
    // 用 detail 版本：除了速率，还拿到「实际用了多长区间」与「是否跨了 UTC 归零点」，
    // 供 UI 解释这个数字的来源（采样稀疏时实际区间会明显大于所选时间窗）
    const d = getVolumeRateDetail(i, windowHours.value)
    i.volumeRate = d?.rate ?? null
    i.volumeRateHours = d?.hours ?? null
    i.volumeRateCrossDay = d?.sameDay === false
    // 时间窗内滚动成交量：把归档上相邻采样点的增量滚起来，因此不受 UTC 归零影响，
    // 表格里的「成交量」列展示的是它（官方当日累计量在列头悬停里作为补充说明）。
    const r = getRollingVolumeDetail(i, windowHours.value)
    i.volumeRolling = r?.volume ?? null
    i.volumeRollingHours = r?.hours ?? null
    i.volumeRollingCoverage = r?.coverage ?? null
    i.turnoverRolling = r && i.price > 0 ? r.volume * i.price : null
    return i
  })
)
/** 当前选中的时间窗是否与「实际用于估算的区间」明显不符（用于给出提示） */
const rateIntervalHint = computed(() => {
  const withRate = changeApplied.value.filter((i) => i.volumeRate != null && i.volumeRateHours != null)
  if (!withRate.length) {
    return null
  }
  const hours = withRate.map((i) => i.volumeRateHours!).sort((a, b) => a - b)
  const median = hours[Math.floor(hours.length / 2)]
  return { median, window: windowHours.value, mismatch: median > windowHours.value * 1.5 }
})
/**
 * 滚动成交量的覆盖率提示。
 * 跨 UTC 归零点的那一段只能统计到 0 点之后，采样越疏丢得越多，
 * 所以这里给出「整列里最低的覆盖率」，低于 100% 时提示原因。
 */
const rollingCoverageHint = computed(() => {
  const rows = changeApplied.value.filter((i) => i.volumeRollingCoverage != null)
  if (!rows.length) {
    return null
  }
  const min = Math.min(...rows.map((i) => i.volumeRollingCoverage!))
  const hours = rows.map((i) => i.volumeRollingHours!).filter((h) => h != null)
  const span = hours.length ? Math.max(...hours) : windowHours.value
  return { min, span, window: windowHours.value, lossy: min < 0.999 }
})
/**
 * 「时间窗内成交量」列头。
 *
 * 用**实际区间**而不是所选时间窗来写列头：两者可能不一致（采样稀疏时实际区间更长；
 * 历史覆盖不足时更短），把它写进列头，数字才不会看起来像「按所选窗口算的」。
 */
const rollingHeaderLabel = computed(() => {
  const span = rollingCoverageHint.value?.span
  if (span == null) {
    return t("时间窗内成交量")
  }
  return `${t("近")} ${span.toFixed(1)} ${t("小时")}${t("成交量")}`
})
/** 历史是否已经能支撑滚动成交量（否则汇总与筛选退回官方当日累计口径） */
const rollingReady = computed(() => changeApplied.value.some((i) => i.volumeRolling != null))
/**
 * 汇总统计。
 * 放在 changeApplied / rollingReady 之后定义（而不是文件顶部）：
 * computed 的取值是惰性的，写前面也能跑，但一旦有人在 setup 阶段就读它就会踩
 * 「block-scoped variable used before declaration」的 TDZ —— 这里已经因此踩过两次坑。
 */
const summary = computed(() =>
  getMarketVolumeSummary(changeApplied.value, rollingReady.value ? "volumeRolling" : "volume")
)

const localCount = computed(() => getLocalSampleCount())
const lastSampleTime = computed(() => {
  const t = getLastSampleTime()
  return t ? new Date(t * 1000).toLocaleString() : "--"
})
// 依赖 historyReady：服务端历史是异步加载的，加载完成后这两个值要跟着刷新
const remoteCount = computed(() => {
  void historyReady.value
  return getRemoteSampleCount()
})
const historySpanHours = computed(() => {
  void historyReady.value
  return getHistorySpanHours()
})

const changeStat = computed(() => {
  let up = 0
  let down = 0
  let flat = 0
  for (const i of changeApplied.value) {
    if (i.changePct == null) {
      continue
    }
    if (i.changePct > 0) {
      up++
    } else if (i.changePct < 0) {
      down++
    } else {
      flat++
    }
  }
  return { up, down, flat }
})

/**
 * 可排序列。`name` 是文本列（按本地化后的名称比较），其余都是数值列。
 *
 * `name` 必须在这个白名单里：`el-table` 给「物品」列标了 `sortable="custom"`，
 * 点表头会派发 `sort-change`，白名单若不认这个 prop，之前的实现会把排序重置成
 * 「成交量降序」——表头箭头变了、数据却没按名称排，看起来就像点了没反应。
 */
const sortKey = ref<MarketVolumeSortKey>("volumeRolling")
const sortOrder = ref<"descending" | "ascending">("descending")

function handleSortChange({ prop, order }: { prop: string, order: string | null }) {
  if (prop && order && (MARKET_VOLUME_SORT_KEYS as readonly string[]).includes(prop)) {
    sortKey.value = prop as MarketVolumeSortKey
    sortOrder.value = order as typeof sortOrder.value
    return
  }
  sortKey.value = "volumeRolling"
  sortOrder.value = "descending"
}

const filtered = computed(() => {
  let r = changeApplied.value
  const kw = keyword.value.trim().toLowerCase()
  if (kw) {
    r = r.filter((i) => t(i.name).toLowerCase().includes(kw) || i.hrid.toLowerCase().includes(kw))
  }
  if (category.value) {
    r = r.filter((i) => i.category === category.value)
  }
  if (enhanceLevels.value.length) {
    r = r.filter((i) => enhanceLevels.value.includes(i.level))
  }
  if (onlyActive.value) {
    // 「有成交」= 今日有累计量，**或**时间窗内有成交。
    // 取并集而不是只看滚动量：窗口选小（默认 6 小时）时只看滚动量会把「今天早些
    // 时候成交过、但最近几小时安静」的物品整批藏掉，默认列表会莫名变短。
    r = r.filter((i) => i.volume > 0 || (i.volumeRolling ?? 0) > 0)
  }
  if (changeDir.value === "up") {
    r = r.filter((i) => i.changePct != null && i.changePct > 0)
  } else if (changeDir.value === "down") {
    r = r.filter((i) => i.changePct != null && i.changePct < 0)
  } else if (changeDir.value === "flat") {
    r = r.filter((i) => i.changePct != null && i.changePct === 0)
  }
  // 排序规则抽到 API 层（sortMarketVolumeRows），便于单测覆盖 NaN/空值沉底等边界
  return sortMarketVolumeRows(r, sortKey.value, sortOrder.value, (n) => t(n))
})

// 分页：避免全量渲染 3000+ 行
const page = ref(1)
const pageSize = ref(50)
const total = computed(() => filtered.value.length)
const list = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
watch(
  [keyword, category, onlyActive, changeDir, windowHours, historyReady, sortKey, sortOrder, all],
  () => {
    page.value = 1
  }
)

/**
 * 「成交活跃 Top10」。
 *
 * 优先按**成交量/小时（速率）**排序，而不是当日累计量：
 * 累计量每天 UTC 0 点归零，刚过零点时所有物品都只剩很小的数字，
 * 排序会退化成"谁在零点后先成交过"，看不出真实热度。
 * 速率对归零免疫，更能代表"最近多热"。
 * 历史尚未加载（速率拿不到）时，退回按累计量排序。
 */
const top10 = computed(() => {
  // 必须用 changeApplied（已写入 volumeRate 的列表）建立显式依赖：
  // 若读 all，就只依赖 all 本身，volumeRate 是否已算好会变成隐式的时序巧合。
  const active = changeApplied.value.filter((i) => i.volume > 0)
  if (!active.some((i) => i.volumeRate != null)) {
    return [...active].sort((a, b) => b.volume - a.volume).slice(0, 10)
  }
  // 有速率的按速率排；速率相同（或都拿不到）时用累计量兜底
  const rank = (i: MarketVolumeItem) => (i.volumeRate != null ? i.volumeRate : 0)
  return [...active]
    .sort((a, b) => rank(b) - rank(a) || b.volume - a.volume)
    .slice(0, 10)
})
/** Top10 当前是按速率还是按累计量排序（用于标题说明） */
const top10ByRate = computed(() => changeApplied.value.some((i) => i.volumeRate != null))

const marketTime = computed(() => {
  const ts = gameStore.marketData?.timestamp
  return ts ? new Date(ts * 1000).toLocaleString() : "--"
})

function fmtCount(value: number) {
  return Format.number(value, 0)
}
</script>

<template>
  <div>
    <GameInfo />
    <el-card>
      <template #header>
        <div class="flex items-center gap-2">
          <span>{{ t("市场监控") }}</span>
          <span class="text-sm text-gray-400">{{ t("监控各物品市场成交量与成交额，成交量按时间窗滚动统计") }}</span>
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-380px leading-5">
                {{ t("市场监控口径说明") }}
              </div>
            </template>
            <el-icon class="cursor-help color-gray-400">
              <QuestionFilled />
            </el-icon>
          </el-tooltip>
        </div>
      </template>

      <!-- 采样稀疏时的区间提示：选的时间窗与实际估算区间不一致时说明清楚 -->
      <el-alert
        v-if="rateIntervalHint && rateIntervalHint.mismatch"
        type="info"
        :closable="false"
        show-icon
        class="mb-2"
      >
        <template #title>
          {{ t("成交量速率区间提示", [rateIntervalHint.median.toFixed(1), rateIntervalHint.window]) }}
        </template>
      </el-alert>

      <!-- 滚动成交量的覆盖率提示：跨 UTC 归零点的那段统计不全 -->
      <el-alert
        v-if="rollingCoverageHint && rollingCoverageHint.lossy"
        type="info"
        :closable="false"
        show-icon
        class="mb-2"
      >
        <template #title>
          {{ t("滚动成交量覆盖率提示", [(rollingCoverageHint.min * 100).toFixed(0), rollingCoverageHint.span.toFixed(1)]) }}
        </template>
      </el-alert>

      <!-- 摘要 -->
      <el-row :gutter="12">
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">{{ t("市场物品") }}</div>
            <div class="stat-value">{{ fmtCount(summary.total) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">
              {{ t("有成交") }}
              <span class="text-gray-400 font-normal">· {{ rollingReady ? t("时间窗内") : t("今日累计") }}</span>
            </div>
            <div class="stat-value success">{{ fmtCount(summary.active) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">{{ t("成交量最高") }}</div>
            <div class="stat-value text-sm" v-if="summary.topVolume">
              {{ t(summary.topVolume.name) }}<span
                v-if="enhanceLevelSuffix(summary.topVolume.level)"
                class="text-gray-400"
              > {{ enhanceLevelSuffix(summary.topVolume.level) }}</span>
              <span class="text-gray-400"> · {{ fmtCount(summary.topVolume.volumeRolling ?? summary.topVolume.volume) }}</span>
            </div>
            <div class="stat-value" v-else>--</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">{{ t("数据时间") }}</div>
            <div class="stat-value text-sm">{{ marketTime }}</div>
          </div>
        </el-col>
      </el-row>

      <!-- 成交活跃 Top10 -->
      <div class="mt-3">
        <div class="text-sm font-semibold mb-2">
          {{ t("成交活跃 Top10") }}
          <span class="text-gray-400 font-normal">
            · {{ top10ByRate ? t("按成交量速率排序") : t("按当日累计成交量排序") }}
          </span>
        </div>
        <div class="top10-grid">
          <div v-for="(i, idx) in top10" :key="i.hrid + i.level" class="top10-item" :class="{ 'top3': idx < 3 }">
            <ItemIcon :hrid="i.hrid" :width="22" :height="22" />
            <span class="top10-rank">{{ idx + 1 }}</span>
            <span class="top10-name">{{ t(i.name) }}<span v-if="enhanceLevelSuffix(i.level)" class="text-gray-400"> {{ enhanceLevelSuffix(i.level) }}</span></span>
            <!-- 按速率排序时展示速率，否则展示累计量，与排序口径保持一致 -->
            <span class="top10-vol">
              {{ top10ByRate && i.volumeRate != null ? `${Format.number(i.volumeRate, 0)}/h` : fmtCount(i.volume) }}
            </span>
          </div>
        </div>
        <el-empty v-if="!top10.length" :description="t('暂无数据，请等待市场数据加载')" :image-size="60" />
      </div>
    </el-card>

    <!-- 明细表格 -->
    <el-card class="mt-3">
      <template #header>
        <div class="flex flex-wrap items-center gap-2">
          <el-input v-model="keyword" :placeholder="t('搜索物品')" clearable style="width: 220px" />
          <el-select v-model="category" :placeholder="t('分类')" clearable filterable style="width: 160px">
            <el-option v-for="c in categoryOptions" :key="c" :label="t(c)" :value="c" />
          </el-select>
          <el-select
            v-model="enhanceLevels"
            :placeholder="t('强化等级')"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            style="width: 200px"
          >
            <el-option v-for="lv in enhanceLevelOptions" :key="lv" :label="lv === '0' ? t('未强化') : `+${lv}`" :value="lv" />
          </el-select>
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-380px leading-5">{{ t('强化等级说明') }}</div>
            </template>
            <el-icon class="cursor-help color-gray-400">
              <QuestionFilled />
            </el-icon>
          </el-tooltip>
          <el-switch v-model="onlyActive" :active-text="t('只看有成交')" />
        </div>
        <div class="flex flex-wrap items-center gap-2 mt-2">
          <span class="text-sm text-gray-400">{{ t("时间窗") }}</span>
          <el-radio-group v-model="windowHours" size="small">
            <el-radio-button v-for="w in WINDOW_OPTIONS" :key="w" :value="w">{{ w }}{{ t("小时") }}</el-radio-button>
          </el-radio-group>
          <span class="text-sm text-gray-400">{{ t("对比口径") }}</span>
          <el-select v-model="changeMetric" size="small" style="width: 150px">
            <el-option v-for="m in metricOptions" :key="m.value" :label="m.label" :value="m.value" />
          </el-select>
          <el-select v-model="changeDir" size="small" style="width: 110px">
            <el-option :label="t('全部涨跌')" value="all" />
            <el-option :label="t('上涨')" value="up" />
            <el-option :label="t('下跌')" value="down" />
            <el-option :label="t('持平')" value="flat" />
          </el-select>
          <span class="text-xs text-gray-400">
            {{ t("涨") }} <span class="up">{{ changeStat.up }}</span> ·
            {{ t("跌") }} <span class="down">{{ changeStat.down }}</span> ·
            {{ t("平") }} <span class="flat">{{ changeStat.flat }}</span>
          </span>
          <div class="flex-1" />
          <el-button size="small" :loading="sampling" @click="handleSampleNow">{{ t("立即采样") }}</el-button>
          <span class="text-xs text-gray-400">
            {{ t("历史采样点") }}：{{ localCount }}<template v-if="hasRemoteHistory()"> + {{ t("线上历史") }} {{ remoteCount }}</template>
            · {{ t("覆盖") }} {{ historySpanHours.toFixed(1) }}{{ t("小时") }}
            · {{ t("最近采样") }}：{{ lastSampleTime }}
            <template v-if="historyLoading"> · {{ t("正在加载历史分片…") }}</template>
          </span>
        </div>
        <div v-if="!hasRemoteHistory()" class="text-xs text-gray-400 mt-1">
          {{ t("无线上历史提示") }}
        </div>
      </template>

      <el-table :data="list" size="small" :default-sort="{ prop: 'volumeRolling', order: 'descending' }" @sort-change="handleSortChange">
        <el-table-column width="44">
          <template #default="{ row }">
            <ItemIcon :hrid="row.hrid" />
          </template>
        </el-table-column>
        <el-table-column :label="t('物品')" min-width="170" sortable="custom" prop="name">
          <template #default="{ row }">
            <span>{{ t(row.name) }}</span>
            <!-- 市场档位 level 是**强化等级**（官方 0~20），不是物品等级：
                 这里必须用 level，且用全站统一的 "+N" 写法。
                 原实现显示的是 itemLevel（例如神圣凿子恒为 80），于是同一件装备的
                 11 个强化档（holy_chisel 有 0/2/3/4/5/6/7/8/10/11/12）全部渲染成
                 一模一样的「神圣凿子 Lv80」，既看不出是强化档，也互相无法区分。 -->
            <el-tag v-if="enhanceLevelSuffix(row.level)" size="small" type="warning" effect="plain" class="ml-1">
              {{ enhanceLevelSuffix(row.level) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="category" :label="t('分类')" min-width="100">
          <template #default="{ row }">
            <el-tag size="small" type="info">{{ t(row.category) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="itemLevel" :label="t('物品等级')" align="center" min-width="80" sortable="custom">
          <template #header>
            <div class="flex items-center justify-center gap-1">
              <span>{{ t('物品等级') }}</span>
              <el-tooltip placement="top" effect="light" :show-after="120">
                <template #content>
                  <div class="max-w-380px leading-5">{{ t('物品等级说明') }}</div>
                </template>
                <el-icon class="cursor-help color-gray-400">
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="price" :label="t('价格')" align="right" min-width="100" sortable="custom">
          <template #default="{ row }">{{ row.price > 0 ? Format.number(row.price, 0) : "--" }}</template>
        </el-table-column>
        <el-table-column prop="changePct" :label="`${t('涨跌')}(${t(metricLabel)})`" align="right" min-width="130" sortable="custom">
          <template #default="{ row }">
            <span v-if="row.changePct == null" class="text-gray-400">--</span>
            <span v-else :class="row.changePct > 0 ? 'up' : row.changePct < 0 ? 'down' : 'flat'">
              {{ row.changePct > 0 ? "+" : "" }}{{ row.changePct.toFixed(2) }}%
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="ask" :label="t('卖价')" align="right" min-width="100" sortable="custom">
          <template #default="{ row }">{{ row.ask > 0 ? Format.number(row.ask, 0) : "--" }}</template>
        </el-table-column>
        <el-table-column prop="bid" :label="t('买价')" align="right" min-width="100" sortable="custom">
          <template #default="{ row }">{{ row.bid > 0 ? Format.number(row.bid, 0) : "--" }}</template>
        </el-table-column>
        <el-table-column prop="volumeRolling" :label="rollingHeaderLabel" align="right" min-width="150" sortable="custom">
          <template #header>
            <div class="flex items-center justify-end gap-1">
              <span>{{ rollingHeaderLabel }}</span>
              <el-tooltip placement="top" effect="light" :show-after="120">
                <template #content>
                  <div class="max-w-380px leading-5">{{ t('滚动成交量说明') }}</div>
                </template>
                <el-icon class="cursor-help color-gray-400">
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </div>
          </template>
          <template #default="{ row }">
            <span v-if="row.volumeRolling == null" class="text-gray-400">--</span>
            <span v-else :class="row.volumeRolling > 0 ? 'success' : 'text-gray-400'">{{ fmtCount(row.volumeRolling) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="volumeRate" :label="`${t('成交量')}/${t('小时')}`" align="right" min-width="120" sortable="custom">
          <template #header>
            <div class="flex items-center justify-end gap-1">
              <span>{{ t('成交量') }}/{{ t('小时') }}</span>
              <el-tooltip placement="top" effect="light" :show-after="120">
                <template #content>
                  <div class="max-w-380px leading-5">{{ t('成交量速率口径说明') }}</div>
                </template>
                <el-icon class="cursor-help color-gray-400">
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </div>
          </template>
          <template #default="{ row }">
            <span v-if="row.volumeRate == null" class="text-gray-400">--</span>
            <span v-else>{{ Format.number(row.volumeRate, 0) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="turnoverRolling" :label="`${t('成交额')}(${t('时间窗内')})`" align="right" min-width="140" sortable="custom">
          <template #header>
            <div class="flex items-center justify-end gap-1">
              <span>{{ t('成交额') }}({{ t('时间窗内') }})</span>
              <el-tooltip placement="top" effect="light" :show-after="120">
                <template #content>
                  <div class="max-w-380px leading-5">{{ t('滚动成交额说明') }}</div>
                </template>
                <el-icon class="cursor-help color-gray-400">
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </div>
          </template>
          <template #default="{ row }">
            <span v-if="row.turnoverRolling == null" class="text-gray-400">--</span>
            <span v-else>{{ row.turnoverRolling > 0 ? Format.number(row.turnoverRolling, 0) : "--" }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="mt-2 flex justify-end">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[20, 50, 100, 200]"
          layout="total, sizes, prev, pager, next"
          background
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.stat-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 10px 14px;
}
.stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}
.stat-value {
  font-size: 18px;
  font-weight: 600;
}
.top10-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 6px;
}
.top10-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  font-size: 13px;
}
.top10-item.top3 {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.top10-rank {
  min-width: 16px;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.top10-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.top10-vol {
  color: var(--el-color-success);
  font-weight: 600;
}
/* 涨跌配色：红涨绿跌（A 股习惯） */
.up {
  color: #f56c6c;
  font-weight: 600;
}
.down {
  color: #67c23a;
  font-weight: 600;
}
.flat {
  color: var(--el-text-color-secondary);
}
</style>
