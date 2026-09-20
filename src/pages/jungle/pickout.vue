<script lang="ts" setup>
import type Calculator from "@/calculator"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import PagerFooter from "@@/components/PagerFooter/index.vue"
import SearchPanel from "@@/components/SearchPanel/index.vue"
import type { PanelField } from "@@/components/SearchPanel/types"
import { usePagination } from "@@/composables/usePagination"
import { normalizeSearchData } from "@@/composables/useSearchPanel"
import { Edit, Search } from "@element-plus/icons-vue"
import { ElMessageBox, type Sort } from "element-plus"
import { cloneDeep, debounce } from "lodash-es"

import { getDataApi } from "@/common/apis/jungle"
import { useMemory } from "@/common/composables/useMemory"
import { usePriceStatus } from "@/common/composables/usePriceStatus"
import * as Format from "@/common/utils/format"
import { PriceStatus, useGameStore } from "@/pinia/stores/game"
import { usePlayerStore } from "@/pinia/stores/player"
import { usePriceStore } from "@/pinia/stores/price"
import ActionConfig from "../dashboard/components/ActionConfig.vue"
import ActionDetail from "../dashboard/components/ActionDetail.vue"
import ActionPrice from "../dashboard/components/ActionPrice.vue"
import GameInfo from "../dashboard/components/GameInfo.vue"
import ManualPriceCard from "../dashboard/components/ManualPriceCard.vue"

// #region 查
const { paginationData: paginationDataLD, handleCurrentChange: handleCurrentChangeLD, handleSizeChange: handleSizeChangeLD } = usePagination({}, "pickout-leaderboard-pagination")
const leaderboardData = ref<Calculator[]>([])

const ldSearchData = useMemory("pickout-leaderboard-search-data", {
  name: [],
  // 组合条件 = 并行检索行：每行（目标强化等级 + 动作）
  conditions: [{ steps: undefined, project: undefined }],
  excludes: [{ name: undefined, project: undefined }],
  minProfitRate: undefined,
  maxProfitRate: undefined,
  maxRisk: undefined,
  maxLevel: 20,
  minLevel: 1,
  minItemLevel: 90,
  banEquipment: false,
  banJewelry: true,
  banCombat: false,
  banLife: false,
  bestManufacture: true
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
  { type: "range", label: "物品等级", labelSuffix: " ≥", maxKey: "minItemLevel", width: 80, placeholderMax: "0" },
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
  { type: "checkbox", key: "bestManufacture", label: "最佳制作方案", disabled: true },
  { type: "checkbox", key: "banEquipment", label: "排除装备" },
  { type: "checkbox", key: "banJewelry", label: "排除首饰" },
  { type: "checkbox", key: "banCombat", label: "排除战斗装备" },
  { type: "checkbox", key: "banLife", label: "排除生活装备" }
]


const loadingLD = ref(false)

// 防抖处理
const getLeaderboardData = debounce(() => {
  loadingLD.value = true

  getDataApi({
    currentPage: paginationDataLD.currentPage,
    size: paginationDataLD.pageSize,
    ...ldSearchData.value,
    sort: sortLD.value
  }, "pickout").then((data) => {
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

const sortLD: Ref<Sort | undefined> = ref({
  prop: "result.profitPH",
  order: "ascending"
})
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

const onPriceStatusChange = usePriceStatus("pickout-price-status", {
  sellStatus: PriceStatus.ASK
})
</script>

<template>
  <div class="app-container">
    <div class="game-info">
      <GameInfo />
      <div>
        <ActionConfig :actions="['enhancing', 'cheesesmithing', 'crafting', 'tailoring']" :equipments="['off_hand', 'hands', 'neck', 'earrings', 'ring', 'pouch']" />
      </div>
      <!-- <PriceStatusSelect
        @change="onPriceStatusChange"
      /> -->
      <div>
        {{ t('打野爽！') }}
      </div>
    </div>
    <el-row :gutter="20" class="row">
      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="16">
        <el-card>
          <template #header>
            <SearchPanel v-model="ldSearchData" :fields="panelFields" title="利润排行" @change="handleSearchLD" />
          </template>
          <template #default>
            <!-- 数据表格 -->
            <el-table :data="leaderboardData" v-loading="loadingLD" @sort-change="handleSortLD" :default-sort="{ prop: 'result.profitPH', order: 'ascending' }">
              <el-table-column width="54">
                <template #default="{ row }">
                  <ItemIcon :hrid="row.hrid" />
                </template>
              </el-table-column>
              <el-table-column prop="result.name" :label="t('物品')" />
              <el-table-column min-width="70">
                <template #default="{ row }">
                  <div style="display:flex;">
                    <ItemIcon v-if="row.calculatorList && row.calculatorList[row.calculatorList.length - 1].protectLevel < row.calculatorList[row.calculatorList.length - 1].enhanceLevel" :hrid="row.calculatorList[row.calculatorList.length - 1].protectionItem.hrid" />
                    <ItemIcon v-if=" row.protectLevel < row.enhanceLevel" :hrid="row.protectionItem.hrid" />
                    <ItemIcon v-if="row.catalyst" :hrid="`/items/${row.catalyst}`" />
                  </div>
                  <div v-if="row.calculatorList && row.calculatorList[row.calculatorList.length - 1].protectLevel < row.calculatorList[row.calculatorList.length - 1].enhanceLevel">
                    {{ t('从{0}保护', [row.calculatorList[row.calculatorList.length - 1].protectLevel]) }}
                  </div>

                  <div v-if="row.protectLevel < row.enhanceLevel">
                    {{ t('从{0}保护', [row.protectLevel]) }}
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="project" :label="t('动作')" />

              <el-table-column prop="result.profitPH" :label="t('利润 / h')" align="center" min-width="120" sortable="custom" :sort-orders="['ascending', null]">
                <template #default="{ row }">
                  <span :class="row.hasManualPrice ? 'manual' : ''">
                    {{ row.result.profitPHFormat }}&nbsp;
                  </span>
                  <el-link type="primary" :icon="Edit" @click="setPrice(row)">
                    {{ t('自定义') }}
                  </el-link>
                </template>
              </el-table-column>

              <el-table-column :label="t('损耗 / h')" align="center">
                <template #default="{ row }">
                  {{ row.calculator.result.cost4MatPHFormat }}
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
              <el-table-column :label="t('售价')" align="center">
                <template #default="{ row }">
                  <span>
                    {{ Format.price(row.calculator.productListWithPrice[0].price) }}
                  </span>
                </template>
              </el-table-column>

              <!-- <el-table-column :label="t('时效')" align="center">
                <template #header>
                  <div style="display: flex; justify-content: center; align-items: center; gap: 5px">
                    <div>{{ t('时效') }}</div>
                    <el-tooltip placement="top" effect="light">
                      <template #content>
                        {{ t('收单市场时间距离现在多久') }}
                      </template>
                      <el-icon>
                        <Warning />
                      </el-icon>
                    </el-tooltip>
                  </div>
                </template>
                <template #default="{ row }">
                  <el-tooltip placement="top" effect="light">
                    <template #content>
                      {{ t('市场时间') }}: {{ new Date(row.calculator.productListWithPrice[0].marketTime * 1000).toLocaleString() }}
                    </template>
                    <span>
                      {{ Format.number((new Date().getTime() - row.calculator.productListWithPrice[0].marketTime * 1000) / (1000 * 60 * 60), 2) }}h
                    </span>
                  </el-tooltip>
                </template>
              </el-table-column> -->
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
            <PagerFooter
              :pagination="paginationDataLD"
              @size-change="handleSizeChangeLD"
              @current-change="handleCurrentChangeLD"
            />
          </template>
        </el-card>
      </el-col>

      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="8">
        <ManualPriceCard memory-key="pickout" />
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
.calculation-loading {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 350px;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  border-radius: 12px;
  margin: 20px 0;

  .loading-content {
    text-align: center;
    padding: 40px;
    max-width: 400px;

    .loading-icon {
      font-size: 56px;
      color: #409eff;
      margin-bottom: 24px;
      animation: rotate 2s linear infinite;
    }

    .loading-title {
      font-size: 20px;
      font-weight: 600;
      color: #303133;
      margin-bottom: 20px;
    }

    .loading-tips {
      font-size: 14px;
      color: #606266;
      line-height: 1.8;
      text-align: left;

      div {
        margin-bottom: 8px;
        padding-left: 8px;
      }
    }
  }
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
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
