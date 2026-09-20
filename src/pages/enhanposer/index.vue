<script lang="ts" setup>
import type Calculator from "@/calculator"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import SearchPanel from "@@/components/SearchPanel/index.vue"
import type { PanelField } from "@@/components/SearchPanel/types"
import { usePagination } from "@@/composables/usePagination"
import { Edit, Search } from "@element-plus/icons-vue"
import { ElMessageBox, type Sort } from "element-plus"
import { cloneDeep, debounce } from "lodash-es"
import { getEnhanposerDataApi } from "@/common/apis/enhanposer"

import { getMarketDataApi } from "@/common/apis/game"
import { useMemory } from "@/common/composables/useMemory"
import { usePriceStatus } from "@/common/composables/usePriceStatus"
import PriceStatusSelect from "@@/components/PriceStatusSelect/index.vue"
import { useGameStoreOutside } from "@/pinia/stores/game"
import { usePlayerStore } from "@/pinia/stores/player"
import { usePriceStore } from "@/pinia/stores/price"
import ActionConfig from "../dashboard/components/ActionConfig.vue"
import ActionDetail from "../dashboard/components/ActionDetail.vue"
import ActionPrice from "../dashboard/components/ActionPrice.vue"
import GameInfo from "../dashboard/components/GameInfo.vue"
import ManualPriceCard from "../dashboard/components/ManualPriceCard.vue"
// #region 查
const { paginationData: paginationDataLD, handleCurrentChange: handleCurrentChangeLD, handleSizeChange: handleSizeChangeLD } = usePagination({}, "enhanposer-leaderboard-pagination")
const leaderboardData = ref<Calculator[]>([])

const ldSearchData = useMemory("enhanposer-leaderboard-search-data", {
  name: [],
  minProfitRate: undefined,
  maxProfitRate: undefined,
  minRisk: undefined,
  maxRisk: undefined,
  // 目标强化等级并行筛选（与超级强化分解页同构；行内 steps/区间 AND、行间 OR）
  conditions: [{ steps: undefined, minLevel: undefined, maxLevel: undefined }],
  banEquipment: false,
  banJewelry: false,
  banCombat: false,
  banLife: false,
  noDecompose: false,
  materialPriceType: "ask",
  productPriceType: "bid"
})
// 兼容旧版字符串 name，迁移为数组（多物品选择）
if (typeof ldSearchData.value.name === "string") {
  ldSearchData.value.name = ldSearchData.value.name ? [ldSearchData.value.name] : []
}
// 旧数据迁移：profitRate → minProfitRate；project/单值等级 → conditions
if (ldSearchData.value.profitRate != null && ldSearchData.value.minProfitRate == null) {
  ldSearchData.value.minProfitRate = ldSearchData.value.profitRate
}
if (!Array.isArray(ldSearchData.value.conditions)) {
  ldSearchData.value.conditions = [{
    steps: ldSearchData.value.targetLevel ?? undefined,
    minLevel: ldSearchData.value.minLevel ?? undefined,
    maxLevel: ldSearchData.value.maxLevel ?? undefined
  }]
}
// 旧数据迁移：单向 priceType → 拆分的 materialPriceType / productPriceType（成品售价沿用旧 priceType）
if (ldSearchData.value.priceType != null && ldSearchData.value.productPriceType == null) {
  ldSearchData.value.productPriceType = ldSearchData.value.priceType
}
delete ldSearchData.value.project
delete ldSearchData.value.profitRate
delete ldSearchData.value.priceType
delete ldSearchData.value.targetLevel
delete ldSearchData.value.minLevel
delete ldSearchData.value.maxLevel

/** 材料买价 / 成品售价可选口径（须在 panelFields 之前声明，否则配置求值时处于暂时性死区） */
const priceTypeOptions = computed(() => [
  { value: "ask", label: `${t("左挂单")}(${t("左价")})` },
  { value: "bid", label: `${t("右收购")}(${t("右价")})` }
])

/** 搜索面板配置：字段顺序/文案/边界与原手写模板完全一致 */
const panelFields: PanelField[] = [
  { type: "name", key: "name", label: "物品", width: 220 },
  {
    type: "conditions",
    label: "只看目标等级",
    stepsCount: 20,
    stepLabel: n => `${t("目标等级")} ${n}`,
    levelRange: { min: 1, max: 20, placeholderMin: "1", placeholderMax: "20" }
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
  { type: "checkbox", key: "banEquipment", label: "排除装备" },
  { type: "checkbox", key: "banJewelry", label: "排除首饰" },
  { type: "checkbox", key: "banCombat", label: "排除战斗装备" },
  { type: "checkbox", key: "banLife", label: "排除生活装备" },
  { type: "checkbox", key: "noDecompose", label: "不分解模式" },
  { type: "select", key: "materialPriceType", label: "材料买价", options: () => priceTypeOptions.value },
  { type: "select", key: "productPriceType", label: "成品售价", options: () => priceTypeOptions.value }
]



const loadingLD = ref(false)
const getLeaderboardData = debounce(() => {
  loadingLD.value = true
  getEnhanposerDataApi({
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
  () => getMarketDataApi(),
  () => usePlayerStore().config,
  () => useGameStoreOutside().buyStatus,
  () => useGameStoreOutside().sellStatus
], getLeaderboardData, { immediate: true })

// #endregion

// #region deepWatch

watch(() => usePriceStore(), () => {
  getLeaderboardData()
}, { deep: true })
// #endregion

// 影响「计算模式」的参数变化：清缓存后重算（缓存按模式签名校验，签名不符也会自动重算）
watch([
  () => ldSearchData.value.noDecompose,
  () => ldSearchData.value.materialPriceType,
  () => ldSearchData.value.productPriceType
], () => {
  useGameStoreOutside().clearEnhanposerCache()
  handleSearchLD()
})

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

const onPriceStatusChange = usePriceStatus("enhanposer-price-status")
const { t } = useI18n()
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
        {{ t('强化纪念') }}
      </div>
    </div>
    <el-row :gutter="20" class="row">
      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="14">
        <el-card>
          <template #header>
            <SearchPanel v-model="ldSearchData" :fields="panelFields" title="利润排行" @change="handleSearchLD" />
          </template>
          <template #default>
            <el-table :data="leaderboardData" v-loading="loadingLD" @sort-change="handleSortLD">
              <el-table-column width="54" fixed="left">
                <template #default="{ row }">
                  <ItemIcon :hrid="row.hrid" />
                </template>
              </el-table-column>
              <el-table-column prop="result.name" :label="t('物品')" />
              <el-table-column min-width="70">
                <template #default="{ row }">
                  <div style="display:flex;">
                    <ItemIcon v-if="row.calculatorList && row.calculatorList[0].protectLevel < row.calculatorList[0].enhanceLevel" :hrid="row.calculatorList[0].protectionItem.hrid" />
                    <ItemIcon v-if="row.catalyst" :hrid="`/items/${row.catalyst}`" />
                  </div>
                  <div v-if="row.calculatorList && row.calculatorList[0].protectLevel < row.calculatorList[0].enhanceLevel">
                    {{ t('从{0}保护', [row.calculatorList[0].protectLevel]) }}
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="project" :label="t('动作')" />
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
              <el-table-column prop="result.profitRate" :label="t('利润率')" min-width="100" align="center" sortable="custom" :sort-orders="['descending', null]">
                <template #default="{ row }">
                  {{ row.result.profitRateFormat }}
                </template>
              </el-table-column>
              <el-table-column align="center" min-width="100">
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

      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="10">
        <ManualPriceCard memory-key="enhanposer" />
      </el-col>
    </el-row>
    <ActionDetail v-model="detailVisible" :data="currentRow" />

    <ActionPrice v-model="priceVisible" :data="currentPriceRow" />
  </div>
</template>

<style lang="scss" scoped>
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
