<script lang="ts" setup>
import { getMarketVolumeList, getMarketCategoryOptions, getMarketVolumeSummary, sortMarketVolumeRows, MARKET_VOLUME_SORT_KEYS, type MarketVolumeItem, type MarketVolumeSortKey } from "@/common/apis/marketvolume"
import { recordLocalSample, loadMarketHistory, getMarketChangeMap, getLocalSampleCount, getLastSampleTime, hasRemoteHistory, getHistorySpanHours, getRemoteSampleCount, getVolumeRateDetail, type MarketChangeMetric } from "@/common/apis/marketvolume/history"
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

const summary = computed(() => getMarketVolumeSummary(all.value))
const categoryOptions = computed(() => getMarketCategoryOptions(all.value))

const keyword = ref("")
const category = ref("")
// 默认只看有成交：避免 3000+ 条无成交量记录淹没热门物品
const onlyActive = ref(true)

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
const sampling = ref(false)

onMounted(async () => {
  recordLocalSample()
  await loadMarketHistory()
  historyReady.value = true
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
const sortKey = ref<MarketVolumeSortKey>("volume")
const sortOrder = ref<"descending" | "ascending">("descending")

function handleSortChange({ prop, order }: { prop: string, order: string | null }) {
  if (prop && order && (MARKET_VOLUME_SORT_KEYS as readonly string[]).includes(prop)) {
    sortKey.value = prop as MarketVolumeSortKey
    sortOrder.value = order as typeof sortOrder.value
    return
  }
  sortKey.value = "volume"
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
  if (onlyActive.value) {
    r = r.filter((i) => i.volume > 0)
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
          <span class="text-sm text-gray-400">{{ t("监控各物品市场成交量与成交额，按当日累计成交量排行") }}</span>
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
            <div class="stat-label">{{ t("有成交") }}</div>
            <div class="stat-value success">{{ fmtCount(summary.active) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">{{ t("成交量最高") }}</div>
            <div class="stat-value text-sm" v-if="summary.topVolume">
              {{ t(summary.topVolume.name) }}<span class="text-gray-400"> · {{ fmtCount(summary.topVolume.volume) }}</span>
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
            <span class="top10-name">{{ t(i.name) }}<span v-if="i.level !== '0'" class="text-gray-400"> Lv{{ i.itemLevel }}</span></span>
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
          </span>
        </div>
        <div v-if="!hasRemoteHistory()" class="text-xs text-gray-400 mt-1">
          {{ t("无线上历史提示") }}
        </div>
      </template>

      <el-table :data="list" size="small" :default-sort="{ prop: 'volume', order: 'descending' }" @sort-change="handleSortChange">
        <el-table-column width="44">
          <template #default="{ row }">
            <ItemIcon :hrid="row.hrid" />
          </template>
        </el-table-column>
        <el-table-column :label="t('物品')" min-width="150" sortable="custom" prop="name">
          <template #default="{ row }">
            <span>{{ t(row.name) }}</span>
            <span v-if="row.level !== '0'" class="text-gray-400 text-xs"> Lv{{ row.itemLevel }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="category" :label="t('分类')" min-width="100">
          <template #default="{ row }">
            <el-tag size="small" type="info">{{ t(row.category) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="itemLevel" :label="t('等级')" align="center" min-width="70" sortable="custom" />
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
        <el-table-column prop="volume" :label="t('成交量')" align="right" min-width="110" sortable="custom">
          <template #header>
            <div class="flex items-center justify-end gap-1">
              <span>{{ t('成交量') }}</span>
              <el-tooltip placement="top" effect="light" :show-after="120">
                <template #content>
                  <div class="max-w-380px leading-5">{{ t('成交量口径说明') }}</div>
                </template>
                <el-icon class="cursor-help color-gray-400">
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </div>
          </template>
          <template #default="{ row }">
            <span :class="row.volume > 0 ? 'success' : 'text-gray-400'">{{ fmtCount(row.volume) }}</span>
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
        <el-table-column prop="turnover" :label="t('成交额')" align="right" min-width="120" sortable="custom">
          <template #header>
            <div class="flex items-center justify-end gap-1">
              <span>{{ t('成交额') }}</span>
              <el-tooltip placement="top" effect="light" :show-after="120">
                <template #content>
                  <div class="max-w-380px leading-5">{{ t('成交额口径说明') }}</div>
                </template>
                <el-icon class="cursor-help color-gray-400">
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </div>
          </template>
          <template #default="{ row }">{{ row.turnover > 0 ? Format.number(row.turnover, 0) : "--" }}</template>
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
