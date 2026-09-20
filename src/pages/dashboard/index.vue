<script lang="ts" setup>
import type Calculator from "@/calculator"
import { getLeaderboardDataApi } from "@@/apis/leaderboard"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import PagerFooter from "@@/components/PagerFooter/index.vue"
import SearchPanel from "@@/components/SearchPanel/index.vue"
import type { PanelField } from "@@/components/SearchPanel/types"
import { usePagination } from "@@/composables/usePagination"
import { normalizeSearchData } from "@@/composables/useSearchPanel"
import { Delete, Edit, Search, Star, StarFilled, Warning } from "@element-plus/icons-vue"
import { ElMessageBox, type Sort } from "element-plus"
import { cloneDeep, debounce } from "lodash-es"
import { WorkflowCalculator } from "@/calculator/workflow"

import { addFavoriteApi, deleteFavoriteApi, getFavoriteDataApi } from "@/common/apis/favorite"
import { getActionConfigOf, getActionLevelBonusOf } from "@/common/apis/player"
import { useMemory } from "@/common/composables/useMemory"
import { usePriceStatus } from "@/common/composables/usePriceStatus"
import { useFavoriteStore } from "@/pinia/stores/favorite"
import { useGameStore } from "@/pinia/stores/game"
import { usePlayerStore } from "@/pinia/stores/player"
import { usePriceStore } from "@/pinia/stores/price"
import ActionConfig from "./components/ActionConfig.vue"
import ActionDetail from "./components/ActionDetail.vue"

import ActionPrice from "./components/ActionPrice.vue"
import GameInfo from "./components/GameInfo.vue"
import ManualPriceCard from "./components/ManualPriceCard.vue"
import PriceStatusSelect from "@@/components/PriceStatusSelect/index.vue"

// #region 查
const favoriteStore = useFavoriteStore()
const { paginationData: paginationDataLD, handleCurrentChange: handleCurrentChangeLD, handleSizeChange: handleSizeChangeLD } = usePagination({}, "dashboard-leaderboard-pagination")
const leaderboardData = ref<Calculator[]>([])

const ldSearchData = useMemory("dashboard-leaderboard-search-data", {
  name: [],
  minProfitRate: undefined,
  maxProfitRate: undefined,
  minRisk: undefined,
  maxRisk: undefined,
  minLevel: undefined,
  maxLevel: undefined,
  // 组合条件 = 并行检索行：每行（步数 + 动作）为一个生产模式，行间 OR、行内 AND
  conditions: [{ steps: undefined, project: undefined }],
  // 反向排除：命中任一组合（产品×生产模式）即剔除；name 缺省=排除该生产全部，project 缺省=排除该产品全部
  excludes: [{ name: undefined, project: undefined }],
  banEquipment: true,
  banJewelry: false,
  banCombat: false,
  banLife: false,
  compare: false
})
// 兼容旧版字符串 name，迁移为数组（多物品选择）
if (typeof ldSearchData.value.name === "string") {
  ldSearchData.value.name = ldSearchData.value.name ? [ldSearchData.value.name] : []
}
// 旧数据迁移：project/steps → conditions；actionLevel → minLevel；profitRate → minProfitRate
if (!Array.isArray(ldSearchData.value.conditions)) {
  const old = ldSearchData.value
  ldSearchData.value.conditions = [{
    steps: old.steps ?? undefined,
    project: old.project || undefined
  }]
}
if (!Array.isArray(ldSearchData.value.excludes)) {
  ldSearchData.value.excludes = [{ name: undefined, project: undefined }]
}
if (ldSearchData.value.actionLevel != null && ldSearchData.value.minLevel == null) {
  ldSearchData.value.minLevel = ldSearchData.value.actionLevel
}
if (ldSearchData.value.profitRate != null && ldSearchData.value.minProfitRate == null) {
  ldSearchData.value.minProfitRate = ldSearchData.value.profitRate
}
// 组合条件只承载「步数 + 动作」；要求等级由本页顶层 minLevel/maxLevel 承担（由 leaderboard API 过滤），
// 历史版本曾把等级塞进 conditions[i]，会导致「选了动作就搜不到」的静默失效，这里按层清理
ldSearchData.value.conditions.forEach((c: any) => {
  delete c.minLevel
  delete c.maxLevel
})
// 收尾的通用清理（name 归一、conditions/excludes 补数组、profitRate 归一）统一走共用实现
normalizeSearchData(ldSearchData.value)

/** 可检索的动作列表（专业） */
const projectOptions = ["挤奶", "采摘", "伐木", "锻造", "制造", "裁缝", "烹饪", "冲泡", "点金", "分解", "转化"]
/** 搜索面板配置：字段顺序/文案/边界与原手写模板完全一致 */
const mainPanelFields: PanelField[] = [
  { type: "name", key: "name", label: "物品" },
  {
    type: "conditions",
    label: "条件",
    projectOptions,
    stepsCount: 10,
    stepsWidth: 110,
    stepLabel: n => `${n}${t("步")}`
  },
  {
    type: "range",
    label: "要求等级",
    minKey: "minLevel",
    maxKey: "maxLevel",
    min: 0,
    max: 120,
    placeholderMin: "0",
    placeholderMax: "120"
  },
  {
    type: "range",
    label: "利润率",
    minKey: "minProfitRate",
    maxKey: "maxProfitRate",
    min: 0,
    unit: "%",
    placeholderMin: "0",
    placeholderMax: "100"
  },
  {
    type: "range",
    label: "风险",
    minKey: "minRisk",
    maxKey: "maxRisk",
    min: 0,
    placeholderMin: "0",
    placeholderMax: "∞"
  },
  {
    type: "excludes",
    label: "排除",
    projectOptions,
    namePlaceholder: "排除的产品名",
    projectPlaceholder: "排除的生产动作，留空=该产品全部"
  },
  { type: "checkbox", key: "banEquipment", label: "排除装备" },
  { type: "checkbox", key: "banJewelry", label: "排除首饰" },
  { type: "checkbox", key: "banCombat", label: "排除战斗装备" },
  { type: "checkbox", key: "banLife", label: "排除生活装备" },
  { type: "checkbox", key: "compare", label: "比较模式" }
]

/** 收藏夹的搜索面板：物品名 + 动作（原模板的 11 个动作选项即 projectOptions） */
const favoritePanelFields: PanelField[] = [
  { type: "name", key: "name", label: "物品" },
  {
    type: "select",
    key: "project",
    label: "动作",
    width: 100,
    options: () => projectOptions
  }
]

const loadingLD = ref(false)

const getLeaderboardData = debounce(() => {
  loadingLD.value = true
  getLeaderboardDataApi({
    currentPage: paginationDataLD.currentPage,
    size: paginationDataLD.pageSize,
    ...ldSearchData.value,
    sort: sortLD.value
  }).then((data) => {
    paginationDataLD.total = data.total
    leaderboardData.value = data.list
  }).catch((e) => {
    console.error(e)
    leaderboardData.value = []
  }).finally(() => {
    loadingLD.value = false
  })
}, 300)

function handleSearchLD() {
  paginationDataLD.currentPage === 1 ? getLeaderboardData() : (paginationDataLD.currentPage = 1)
}

const sortLD: Ref<Sort | undefined> = ref()
function handleSortLD(sort: Sort) {
  sortLD.value = sort
  getLeaderboardData()
}

// 监听分页参数的变化
watch([
  () => paginationDataLD.currentPage,
  () => paginationDataLD.pageSize,
  () => useGameStore().marketData,
  () => usePlayerStore().config,
  () => useGameStore().buyStatus,
  () => useGameStore().sellStatus
], getLeaderboardData, { immediate: true })

const { paginationData: paginationDataMN, handleCurrentChange: handleCurrentChangeFR, handleSizeChange: handleSizeChangeFR } = usePagination({}, "dashboard-favorite-pagination")
const favoriteData = ref<Calculator[]>([])
const frSearchData = useMemory("dashboard-favorite-search-data", {
  name: [],
  project: ""
})
// 兼容旧版字符串 name，迁移为数组（多物品选择）
if (typeof frSearchData.value.name === "string") {
  frSearchData.value.name = frSearchData.value.name ? [frSearchData.value.name] : []
}

const loadingFR = ref(false)
function getFavoriteData() {
  loadingFR.value = true
  getFavoriteDataApi({
    currentPage: paginationDataMN.currentPage,
    size: paginationDataMN.pageSize,
    ...frSearchData.value
  }).then((data) => {
    paginationDataMN.total = data.total
    favoriteData.value = data.list
  }).catch(() => {
    favoriteData.value = []
  }).finally(() => {
    loadingFR.value = false
  })
}

function handleSearchMN() {
  paginationDataMN.currentPage === 1 ? getFavoriteData() : (paginationDataMN.currentPage = 1)
}
// 监听分页参数的变化
watch([
  () => paginationDataMN.currentPage,
  () => paginationDataMN.pageSize,
  () => useGameStore().marketData,
  () => usePlayerStore().config,
  () => useGameStore().buyStatus,
  () => useGameStore().sellStatus
], getFavoriteData, { immediate: true })

// #endregion

// #region deepWatch
watch(() => favoriteStore.list, () => {
  getLeaderboardData()
  getFavoriteData()
}, { deep: true })

watch(() => usePriceStore(), () => {
  getLeaderboardData()
  getFavoriteData()
}, { deep: true })
// #endregion

const currentRow = ref<Calculator>()
const detailVisible = ref<boolean>(false)
async function showDetail(row: Calculator) {
  currentRow.value = cloneDeep(row)
  detailVisible.value = true
}
function addFavorite(row: Calculator) {
  const r = row || currentRow.value!
  try {
    addFavoriteApi(r)
    detailVisible.value = false
  } catch (e: any) {
    ElMessage.error(e.message)
  }
}

function deleteFavorite(row: Calculator) {
  try {
    deleteFavoriteApi(row)
  } catch (e: any) {
    ElMessage.error(e.message)
  }
}
const priceVisible = ref<boolean>(false)
const currentPriceRow = ref<Calculator>()
function setPrice(row: Calculator) {
  const activated = usePriceStore().activated
  if (!activated) {
    ElMessageBox.confirm(t("是否确定开启自定义价格？"), t("需先开启自定义价格"), {
      confirmButtonText: t("确定"),
      cancelButtonText: t("取消"),
      closeOnClickModal: true
    }).then(() => {
      usePriceStore().setActivated(true)
    })
    return
  }
  currentPriceRow.value = cloneDeep(row)
  priceVisible.value = true
}

const { t } = useI18n()

const onPriceStatusChange = usePriceStatus("dashboard-price-status")
// 离开页面时重置
</script>

<template>
  <div class="app-container">
    <div class="game-info">
      <GameInfo />
      <div>
        <ActionConfig />
      </div>

      <PriceStatusSelect
        @change="onPriceStatusChange"
      />
    </div>
    <el-row :gutter="20" class="row">
      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="16">
        <el-card>
          <template #header>
<SearchPanel v-model="ldSearchData" :fields="mainPanelFields" title="利润排行" @change="handleSearchLD" />
          </template>
          <template #default>
            <el-table :data="leaderboardData" v-loading="loadingLD" @sort-change="handleSortLD">
              <el-table-column width="54" fixed="left">
                <template #default="{ row }">
                  <ItemIcon :hrid="row.hrid" />
                </template>
              </el-table-column>
              <el-table-column prop="result.name" :label="t('物品')" />
              <el-table-column v-if="ldSearchData.compare" :label="t('组内排行')" align="center" width="90">
                <template #default="{ row }">
                  <span :class="row.groupRank === 1 ? 'group-best' : ''">
                    {{ row.groupRank }}/{{ row.groupTotal }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column width="54">
                <template #default="{ row }">
                  <ItemIcon v-if="row.catalyst" :hrid="`/items/${row.catalyst}`" />
                </template>
              </el-table-column>
              <el-table-column prop="project" :label="t('动作')" />
              <el-table-column prop="actionLevel" :label="t('要求等级')" align="center" sortable="custom" :sort-orders="['ascending', null]">
                <template #default="{ row }">
                  <div :class="row.actionLevel > getActionConfigOf(row.action).playerLevel ? 'red' : ''">
                    <template v-if="getActionLevelBonusOf(row.action) > 0">
                      <el-tooltip placement="top" effect="light">
                        <template #content>{{ t('工匠茶：装备要求等级+5（动作速度将降低）') }}</template>
                        <span>{{ row.actionLevel - getActionLevelBonusOf(row.action) }}+{{ getActionLevelBonusOf(row.action) }}({{ t('工匠茶') }})</span>
                      </el-tooltip>
                    </template>
                    <template v-else>{{ row.actionLevel }}</template>
                  </div>
                </template>
              </el-table-column>
              <el-table-column :label="t('利润 / 天')" align="center" min-width="120">
                <template #default="{ row }">
                  <span :class="row.hasManualPrice ? 'manual' : ''">
                    {{ row.result.profitPDFormat }}&nbsp;
                  </span>
                  <el-link type="primary" :icon="Edit" @click="setPrice(row)">
                    {{ t('自定义') }}
                  </el-link>
                </template>
              </el-table-column>
              <el-table-column prop="result.profitPH" :label="t('利润 / h')" align="center" min-width="120" sortable="custom" :sort-orders="['descending', null]">
                <template #default="{ row }">
                  <span :class="row.hasManualPrice ? 'manual' : ''">{{ row.result.profitPHFormat }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="result.profitRate" :label="t('利润率')" min-width="120" align="center" sortable="custom" :sort-orders="['descending', null]">
                <template #default="{ row }">
                  {{ row.result.profitRateFormat }}
                </template>
              </el-table-column>

              <el-table-column :label="t('自产比例')" align="center" min-width="100">
                <template #default="{ row }">
                  <el-tooltip
                    v-if="row.result.selfProduceRatioFormat"
                    placement="top"
                    :content="t('自产比例=自产原料成本÷(自产+外购)成本；自产含大全套自产成本估值与0成本采集料，随市价动态变化。无自产/外购原料时显示 -')"
                  >
                    <el-text type="warning">{{ row.result.selfProduceRatioFormat }}</el-text>
                  </el-tooltip>
                  <span v-else>-</span>
                </template>
              </el-table-column>

              <el-table-column align="center" min-width="120">
                <template #header>
                  <div style="display: flex; justify-content: center; align-items: center; gap: 5px">
                    <div>{{ t('利润 / 次') }}</div>
                    <el-tooltip placement="top" effect="light">
                      <template #content>
                        {{ t('单次动作产生的利润。') }}
                        <br>
                        {{ t('多步动作利润提示') }}
                        <br>
                        {{ t('多步动作利润举例') }}
                      </template>
                      <el-icon>
                        <Warning />
                      </el-icon>
                    </el-tooltip>
                  </div>
                </template>
                <template #default="{ row }">
                  <span :class="row.hasManualPrice ? 'manual' : ''">
                    {{ row.result.profitPPFormat }}&nbsp;
                  </span>
                </template>
              </el-table-column>
              <el-table-column min-width="120" :label="t('经验 / h')" align="center">
                <template #default="{ row }">
                  <div style="display: flex; justify-content: center; align-items: center; gap: 5px">
                    <div>{{ row.result.expPHFormat }}</div>
                    <el-tooltip v-if="row.expList?.length > 1" placement="top" effect="light">
                      <template #content>
                        <div v-for="(item, i) in row.expList" :key="i" style="display: flex; gap:10px">
                          <div>
                            {{ t(item.action) }}
                          </div>
                          <div>
                            {{ item.expPHFormat }}
                          </div>
                        </div>
                      </template>
                      <el-icon>
                        <Warning />
                      </el-icon>
                    </el-tooltip>
                  </div>
                </template>
              </el-table-column>

              <el-table-column :label="t('详情')" align="center">
                <template #default="{ row }">
                  <el-link type="primary" :icon="Search" @click="showDetail(row)">
                    {{ t('查看') }}
                  </el-link>
                </template>
              </el-table-column>

              <el-table-column prop="favorite" :label="t('收藏')" align="center" sortable="custom" :sort-orders="['descending', null]">
                <template #default="{ row }">
                  <template v-if="!(row instanceof WorkflowCalculator)">
                    <el-link v-if="!favoriteStore.hasFavorite(row)" :underline="false" type="warning" :icon="Star" @click="addFavorite(row)" style="font-size:24px" />
                    <el-link v-else :underline="false" :icon="StarFilled" type="warning" @click="deleteFavorite(row)" style="font-size:28px" />
                  </template>
                  <template v-else />
                </template>
              </el-table-column>
            </el-table>
          </template>
          <template #footer>
            <PagerFooter
              :pagination="paginationDataLD"
              @size-change="handleSizeChangeLD"
              @current-change="handleCurrentChangeLD"
            />
          </template>
        </el-card>
      </el-col>

      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="8">
        <ManualPriceCard memory-key="dashboard" />
      </el-col>

      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="16">
        <el-card>
          <template #header>
<SearchPanel v-model="frSearchData" :fields="favoritePanelFields" title="收藏夹" @change="handleSearchMN" />
          </template>
          <template #default>
            <el-table :data="favoriteData" v-loading="loadingFR">
              <el-table-column width="54" fixed="left">
                <template #default="{ row }">
                  <ItemIcon :hrid="row.hrid" />
                </template>
              </el-table-column>
              <el-table-column prop="result.name" :label="t('物品')" />
              <el-table-column width="54">
                <template #default="{ row }">
                  <ItemIcon v-if="row.catalyst" :hrid="`/items/${row.catalyst}`" />
                </template>
              </el-table-column>
              <el-table-column prop="project" :label="t('动作')" />
              <el-table-column :label="t('利润 / 天')">
                <template #default="{ row }">
                  <span :class="row.hasManualPrice ? 'manual' : ''">
                    {{ row.result.profitPDFormat }}&nbsp;
                  </span>
                  <el-link v-if="usePriceStore().activated" type="primary" :icon="Edit" @click="setPrice(row)">
                    {{ t('自定义') }}
                  </el-link>
                </template>
              </el-table-column>
              <el-table-column prop="result.profitPHFormat" :label="t('利润 / h')" align="center" min-width="120" />
              <el-table-column prop="result.profitRateFormat" :label="t('利润率')" align="center" min-width="120" />
              <el-table-column align="center" min-width="120">
                <template #header>
                  <div style="display: flex; justify-content: center; align-items: center; gap: 5px">
                    <div>{{ t('利润 / 次') }}</div>
                    <el-tooltip placement="top" effect="light">
                      <template #content>
                        {{ t('单次动作产生的利润。') }}
                        <br>
                        {{ t('多步动作利润提示') }}
                        <br>
                        {{ t('多步动作利润举例') }}
                      </template>
                      <el-icon>
                        <Warning />
                      </el-icon>
                    </el-tooltip>
                  </div>
                </template>
                <template #default="{ row }">
                  <span :class="row.hasManualPrice ? 'manual' : ''">
                    {{ row.result.profitPPFormat }}&nbsp;
                  </span>
                </template>
              </el-table-column>
              <el-table-column :label="t('详情')">
                <template #default="{ row }">
                  <el-link type="primary" :icon="Search" @click="showDetail(row)">
                    {{ t('查看') }}
                  </el-link>
                </template>
              </el-table-column>
              <el-table-column :label="t('操作')">
                <template #default="{ row }">
                  <el-link type="danger" :icon=" Delete" @click="deleteFavorite(row)">
                    {{ t('删除') }}
                  </el-link>
                </template>
              </el-table-column>
            </el-table>
          </template>
          <template #footer>
            <PagerFooter
              :pagination="paginationDataMN"
              @size-change="handleSizeChangeFR"
              @current-change="handleCurrentChangeFR"
            />
          </template>
        </el-card>
      </el-col>
    </el-row>
    <ActionDetail v-model="detailVisible" :data="currentRow" />

    <ActionPrice v-model="priceVisible" :data="currentPriceRow" />
  </div>
</template>

<style lang="scss" scoped>
.row {
  .el-col {
    margin-bottom: 20px;
  }
}
// 蓝色
.manual {
  color: #409eff;
}

.red {
  color: #f56c6c;
}
.green {
  color: #67c23a;
}
.group-best {
  color: #67c23a;
  font-weight: 600;
}
</style>
