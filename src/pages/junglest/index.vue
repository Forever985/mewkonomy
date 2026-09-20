<script lang="ts" setup>
import type Calculator from "@/calculator"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import SearchPanel from "@@/components/SearchPanel/index.vue"
import type { PanelField } from "@@/components/SearchPanel/types"
import { usePagination } from "@@/composables/usePagination"
import { normalizeSearchData } from "@@/composables/useSearchPanel"
import { Edit, Search } from "@element-plus/icons-vue"
import { ElMessageBox, type Sort } from "element-plus"
import { cloneDeep, debounce } from "lodash-es"

import { getDataApi } from "@/common/apis/jungle/junglest"
import { useMemory } from "@/common/composables/useMemory"
import { usePriceStatus } from "@/common/composables/usePriceStatus"
import * as Format from "@/common/utils/format"
import { useGameStore } from "@/pinia/stores/game"
import { usePlayerStore } from "@/pinia/stores/player"
import { usePriceStore } from "@/pinia/stores/price"
import ActionConfig from "../dashboard/components/ActionConfig.vue"
import ActionDetail from "../dashboard/components/ActionDetail.vue"
import ActionPrice from "../dashboard/components/ActionPrice.vue"
import GameInfo from "../dashboard/components/GameInfo.vue"
import ManualPriceCard from "../dashboard/components/ManualPriceCard.vue"
import PriceStatusSelect from "@@/components/PriceStatusSelect/index.vue"

// #region
const { paginationData: paginationDataLD, handleCurrentChange: handleCurrentChangeLD, handleSizeChange: handleSizeChangeLD } = usePagination({}, "junglest-leaderboard-pagination")
const leaderboardData = ref<Calculator[]>([])

const ldSearchData = useMemory("junglest-leaderboard-search-data", {
  name: [],
  // 组合条件 = 并行检索行：每行（目标强化等级 + 动作）
  conditions: [{ steps: undefined, project: undefined }],
  excludes: [{ name: undefined, project: undefined }],
  minProfitRate: undefined,
  maxProfitRate: undefined,
  maxRisk: undefined,
  maxLevel: 20,
  minLevel: 1,
  banEquipment: false,
  banJewelry: false,
  banCombat: false,
  banLife: false
})
// 历史结构迁移统一走 normalizeSearchData（原先这里手写了 5 步迁移）
normalizeSearchData(ldSearchData.value)

/** 可检索的动作列表（专业） */
const projectOptions = ["锻造", "制造", "裁缝", "强化"]

/** 搜索面板配置：字段顺序/文案/边界与原手写模板完全一致 */
const panelFields: PanelField[] = [
  { type: "name", key: "name", label: "物品" },
  {
    type: "conditions",
    label: "条件",
    projectOptions,
    stepsCount: 20,
    stepLabel: n => `${t("目标等级")} ${n}`
  },
  {
    type: "range",
    label: "目标等级从",
    minKey: "minLevel",
    maxKey: "maxLevel",
    min: 1,
    max: 20,
    width: 80,
    separator: "到",
    placeholderMin: "1",
    placeholderMax: "20"
  },
  { type: "range", label: "风险", labelSuffix: " ≤", maxKey: "maxRisk", width: 80 },
  {
    type: "range",
    label: "利润率",
    minKey: "minProfitRate",
    maxKey: "maxProfitRate",
    unit: "%",
    placeholderMin: "-100",
    placeholderMax: "100"
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
  { type: "checkbox", key: "banLife", label: "排除生活装备" }
]

const loadingLD = ref(false)
const getLeaderboardData = debounce(() => {
  loadingLD.value = true
  getDataApi({
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

// #endregion

// #region deepWatch

watch(() => usePriceStore(), () => {
  getLeaderboardData()
}, { deep: true })
// #endregion

const currentRow = ref<Calculator>()
const detailVisible = ref<boolean>(false)
async function showDetail(row: Calculator) {
  currentRow.value = cloneDeep(row)
  detailVisible.value = true
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

const onPriceStatusChange = usePriceStatus("junglest-price-status")
</script>

<template>
  <div class="app-container">
    <div class="game-info">
      <GameInfo />

      <div>
        <ActionConfig :actions="['enhancing']" :equipments="['hands', 'neck', 'earrings', 'ring', 'pouch']" />
      </div>

      <PriceStatusSelect @change="onPriceStatusChange" />
      <div>
        {{ t('打野爽！') }}
      </div>
    </div>
    <el-row :gutter="20" class="row">
      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="24">
        <el-card>
          <template #header>
            <SearchPanel v-model="ldSearchData" :fields="panelFields" title="利润排行" @change="handleSearchLD" />
          </template>
          <template #default>
            <el-table :data="leaderboardData" v-loading="loadingLD" @sort-change="handleSortLD">
              <el-table-column width="54">
                <template #default="{ row }">
                  <ItemIcon :hrid="row.hrid" />
                </template>
              </el-table-column>
              <el-table-column prop="result.name" :label="t('物品')">
                <template #default="{ row }">
                  {{ row.result.name }}
                  <!-- {{ row.originLevel ? `+${row.originLevel}` : '' }} -->
                </template>
              </el-table-column>
              <el-table-column min-width="70">
                <template #default="{ row }">
                  <div style="display:flex;">
                    <ItemIcon v-if="row.protectLevel < row.enhanceLevel" :hrid="row.protectionItem.hrid" />
                  </div>
                  <div v-if="row.protectLevel < row.enhanceLevel">
                    {{ t('从{0}保护', [row.protectLevel]) }}
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="project" :label="t('动作')" min-width="100" />
              <el-table-column prop="realEscapeLevel" :label="t('逃逸')" min-width="60" />
              <!-- <el-table-column :label="t('利润 / 天')" align="center" min-width="120">
                <template #default="{ row }">
                  <span :class="row.hasManualPrice ? 'manual' : ''">
                    {{ row.result.profitPDFormat }}&nbsp;
                  </span>
                  <el-link type="primary" :icon="Edit" @click="setPrice(row)">
                    {{ t('自定义') }}
                  </el-link>
                </template>
              </el-table-column> -->

              <el-table-column prop="result.profitPHFormat" :label="t('利润 / h')" align="center" min-width="120">
                <template #default="{ row }">
                  <span :class="row.hasManualPrice ? 'manual' : ''">
                    {{ row.result.profitPHFormat }}&nbsp;
                  </span>
                  <el-link type="primary" :icon="Edit" @click="setPrice(row)">
                    {{ t('自定义') }}
                  </el-link>
                </template>
              </el-table-column>

              <el-table-column align="center" min-width="120">
                <template #header>
                  <div style="display: flex; justify-content: center; align-items: center; gap: 5px">
                    <div>{{ t('损耗 / h') }}</div>
                    <el-tooltip placement="top" effect="light">
                      <template #content>
                        {{ t('材料损耗+逃逸损耗') }}
                      </template>
                      <el-icon>
                        <Warning />
                      </el-icon>
                    </el-tooltip>
                  </div>
                </template>
                <template #default="{ row }">
                  <span>
                    {{ row.result.cost4EnhancePHFormat }}
                  </span>
                </template>
              </el-table-column>

              <el-table-column align="center" min-width="120">
                <template #header>
                  <div style="display: flex; justify-content: center; align-items: center; gap: 5px">
                    <div>{{ t('风险系数') }}</div>
                    <el-tooltip placement="top" effect="light">
                      <template #content>
                        {{ t('损耗 ÷ 利润') }}
                      </template>
                      <el-icon>
                        <Warning />
                      </el-icon>
                    </el-tooltip>
                  </div>
                </template>

                <template #default="{ row }">
                  <!-- 7以上是红色，5以下是绿色 -->
                  <span
                    :class="{
                      error: row.result.risk > 7,
                      success: row.result.risk < 5,
                    }"
                  >
                    {{ row.result.profitPH > 0 ? row.result.riskFormat : '' }}
                  </span>
                </template>
              </el-table-column>

              <el-table-column align="center" min-width="120">
                <template #header>
                  <div style="display: flex; justify-content: center; align-items: center; gap: 5px">
                    <div>{{ t('利润 / 件') }}</div>
                    <el-tooltip placement="top" effect="light">
                      <template #content>
                        {{ t('每件初始装备产生的利润。') }}
                      </template>
                      <el-icon>
                        <Warning />
                      </el-icon>
                    </el-tooltip>
                  </div>
                </template>
                <template #default="{ row }">
                  <span :class="row.hasManualPrice ? 'manual' : ''">
                    {{ Format.money(row.result.profitPH / row.ingredientListWithPrice[0].countPH) }}&nbsp;
                  </span>
                </template>
              </el-table-column>

              <el-table-column prop="result.profitRate" :label="t('利润率')" align="center" sortable="custom" :sort-orders="['descending', null]">
                <template #default="{ row }">
                  {{ row.result.profitRateFormat }}
                </template>
              </el-table-column>

              <el-table-column :label="t('售价')" align="center">
                <template #default="{ row }">
                  <span>
                    {{ Format.price(row.productListWithPrice[0].price) }}
                  </span>
                </template>
              </el-table-column>

              <el-table-column prop="result.targetRateFormat" :label="t('成功率')" align="center">
                <template #header>
                  <div style="display: flex; justify-content: center; align-items: center; gap: 5px">
                    <div>{{ t('成功率') }}</div>
                    <el-tooltip placement="top" effect="light">
                      <template #content>
                        {{ t('单件装备成功率') }}
                      </template>
                      <el-icon>
                        <Warning />
                      </el-icon>
                    </el-tooltip>
                  </div>
                </template>
                <template #default="{ row }">
                  {{ row.result.targetRateFormat }}
                </template>
              </el-table-column>
              <el-table-column prop="result.expPHFormat" :label="t('经验 / h')" />
              <el-table-column :label="t('详情')" align="center">
                <template #default="{ row }">
                  <el-link type="primary" :icon="Search" @click="showDetail(row)">
                    {{ t('查看') }}
                  </el-link>
                </template>
              </el-table-column>
            </el-table>
          </template>
          <template #footer>
            <div class="pager-wrapper">
              <el-pagination
                background
                :layout="paginationDataLD.layout"
                :page-sizes="paginationDataLD.pageSizes"
                :total="paginationDataLD.total"
                :page-size="paginationDataLD.pageSize"
                :current-page="paginationDataLD.currentPage"
                @size-change="handleSizeChangeLD"
                @current-change="handleCurrentChangeLD"
              />
            </div>
          </template>
        </el-card>
      </el-col>

      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="24">
        <ManualPriceCard memory-key="junglest" />
      </el-col>
    </el-row>
    <ActionDetail v-model="detailVisible" :data="currentRow" />

    <ActionPrice v-model="priceVisible" :data="currentPriceRow" />
  </div>
</template>

<style lang="scss" scoped>
.error {
  color: #f56c6c;
}
.success {
  color: #67c23a;
}
.pager-wrapper {
  display: flex;
  justify-content: center;
}

.row {
  .el-col {
    margin-bottom: 20px;
  }
}
// 蓝色
.manual {
  color: #409eff;
}
</style>
