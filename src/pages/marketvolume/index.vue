<script lang="ts" setup>
import { getMarketVolumeList, getMarketCategoryOptions, getMarketVolumeSummary, type MarketVolumeItem } from "@/common/apis/marketvolume"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import * as Format from "@@/utils/format"
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

const NUMERIC_SORT_KEYS = ["volume", "turnover", "price", "ask", "bid", "itemLevel"] as const
type NumericSortKey = (typeof NUMERIC_SORT_KEYS)[number]
const sortKey = ref<NumericSortKey>("volume")
const sortOrder = ref<"descending" | "ascending">("descending")

function handleSortChange({ prop, order }: { prop: string; order: string | null }) {
  if (!prop || !order || !(NUMERIC_SORT_KEYS as readonly string[]).includes(prop)) {
    sortKey.value = "volume"
    sortOrder.value = "descending"
    return
  }
  sortKey.value = prop as NumericSortKey
  sortOrder.value = order as typeof sortOrder.value
}

const filtered = computed(() => {
  let r = all.value
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
  const dir = sortOrder.value === "ascending" ? 1 : -1
  return [...r].sort((a, b) => (Number(a[sortKey.value]) - Number(b[sortKey.value])) * dir)
})

// 分页：避免全量渲染 3000+ 行
const page = ref(1)
const pageSize = ref(50)
const total = computed(() => filtered.value.length)
const list = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
watch(
  [keyword, category, onlyActive, sortKey, sortOrder, all],
  () => {
    page.value = 1
  }
)

const top10 = computed(() =>
  [...all.value]
    .filter((i) => i.volume > 0)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10)
)

const marketTime = computed(() => {
  const ts = gameStore.marketData?.timestamp
  return ts ? new Date(ts * 1000).toLocaleString() : "--"
})

function fmtTime(value: number) {
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
          <span class="text-sm text-gray-400">{{ t("监控各物品市场成交量与成交额，按成交量实时排行") }}</span>
        </div>
      </template>

      <!-- 摘要 -->
      <el-row :gutter="12">
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">{{ t("市场物品") }}</div>
            <div class="stat-value">{{ fmtTime(summary.total) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">{{ t("有成交") }}</div>
            <div class="stat-value success">{{ fmtTime(summary.active) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">{{ t("成交量最高") }}</div>
            <div class="stat-value text-sm" v-if="summary.topVolume">
              {{ t(summary.topVolume.name) }}<span class="text-gray-400"> · {{ fmtTime(summary.topVolume.volume) }}</span>
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
        <div class="text-sm font-semibold mb-2">{{ t("成交量 Top10") }}</div>
        <div class="top10-grid">
          <div v-for="(i, idx) in top10" :key="i.hrid + i.level" class="top10-item" :class="{ 'top3': idx < 3 }">
            <ItemIcon :hrid="i.hrid" :width="22" :height="22" />
            <span class="top10-rank">{{ idx + 1 }}</span>
            <span class="top10-name">{{ t(i.name) }}<span v-if="i.level !== '0'" class="text-gray-400"> Lv{{ i.itemLevel }}</span></span>
            <span class="top10-vol">{{ fmtTime(i.volume) }}</span>
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
            <el-option v-for="c in categoryOptions" :key="c" :label="c" :value="c" />
          </el-select>
          <el-switch v-model="onlyActive" :active-text="t('只看有成交')" />
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
            <el-tag size="small" type="info">{{ row.category }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="itemLevel" :label="t('等级')" align="center" min-width="70" sortable="custom" />
        <el-table-column prop="price" :label="t('价格')" align="right" min-width="100" sortable="custom">
          <template #default="{ row }">{{ row.price > 0 ? Format.number(row.price, 0) : "--" }}</template>
        </el-table-column>
        <el-table-column prop="ask" :label="t('卖价')" align="right" min-width="100" sortable="custom">
          <template #default="{ row }">{{ row.ask > 0 ? Format.number(row.ask, 0) : "--" }}</template>
        </el-table-column>
        <el-table-column prop="bid" :label="t('买价')" align="right" min-width="100" sortable="custom">
          <template #default="{ row }">{{ row.bid > 0 ? Format.number(row.bid, 0) : "--" }}</template>
        </el-table-column>
        <el-table-column prop="volume" :label="t('成交量')" align="right" min-width="110" sortable="custom">
          <template #default="{ row }">
            <span :class="row.volume > 0 ? 'success' : 'text-gray-400'">{{ fmtTime(row.volume) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="turnover" :label="t('成交额')" align="right" min-width="120" sortable="custom">
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
</style>
