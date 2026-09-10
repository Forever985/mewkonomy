<script lang="ts" setup>
import type Calculator from "@/calculator"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import { usePagination } from "@@/composables/usePagination"
import { Delete, Edit, Plus, Search } from "@element-plus/icons-vue"
import { ElMessageBox, type FormInstance, type Sort } from "element-plus"
import { cloneDeep, debounce } from "lodash-es"
import { getEnhanposerDataApi } from "@/common/apis/enhanposer"

import { getMarketDataApi } from "@/common/apis/game"
import { useMemory } from "@/common/composables/useMemory"
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
const ldSearchFormRef = ref<FormInstance | null>(null)

const ldSearchData = useMemory("enhanposer-leaderboard-search-data", {
  name: [],
  minLevel: undefined,
  maxLevel: undefined,
  minProfitRate: undefined,
  maxProfitRate: undefined,
  minRisk: undefined,
  maxRisk: undefined,
  conditions: [{ steps: undefined }],
  banEquipment: false,
  banCombat: false,
  banLife: false,
  noDecompose: false,
  priceType: "bid",
  enhanposer: true
})
// 兼容旧版字符串 name，迁移为数组（多物品选择）
if (typeof ldSearchData.value.name === "string") {
  ldSearchData.value.name = ldSearchData.value.name ? [ldSearchData.value.name] : []
}
// 旧数据迁移：conditions 数组 + profitRate → minProfitRate
if (!Array.isArray(ldSearchData.value.conditions)) {
  ldSearchData.value.conditions = [{ steps: undefined }]
}
if (ldSearchData.value.profitRate != null && ldSearchData.value.minProfitRate == null) {
  ldSearchData.value.minProfitRate = ldSearchData.value.profitRate
}
delete ldSearchData.value.project
delete ldSearchData.value.profitRate

/** 目标等级并行选择：多行 (目标强化等级) 组合，命中任一即保留 */
function addCondition() {
  ldSearchData.value.conditions.push({ steps: undefined })
}
function removeCondition(index: number) {
  ldSearchData.value.conditions.splice(index, 1)
}

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
  console.log("va", JSON.stringify(ldSearchData.value))
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
  () => usePlayerStore().config
], getLeaderboardData, { immediate: true })

// #endregion

// #region deepWatch

watch(() => usePriceStore(), () => {
  getLeaderboardData()
}, { deep: true })
// #endregion

// 不分解模式 / 价格源变化：清除旧缓存后重算（缓存基于不同计算模式区分）
watch(() => ldSearchData.value.noDecompose, () => {
  useGameStoreOutside().clearEnhanposerCache()
  handleSearchLD()
})
watch(() => ldSearchData.value.priceType, () => {
  useGameStoreOutside().clearEnhanposerCache()
  handleSearchLD()
})

const currentRow = ref<Calculator>()
const detailVisible = ref<boolean>(false)
async function showDetail(row: Calculator) {
  console.log("showDetail", row)
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
</script>

<template>
  <div class="app-container">
    <div class="game-info">
      <GameInfo />
      <div>
        <ActionConfig :actions="['enhancing']" :equipments="['hands', 'neck', 'earrings', 'ring', 'pouch']" />
      </div>

      <div>
        {{ t('#强化纪念') }}
      </div>
    </div>
    <el-row :gutter="20" class="row">
      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="14">
        <el-card>
          <template #header>
            <el-form class="rank-card" ref="ldSearchFormRef" :inline="true" :model="ldSearchData">
              <div class="title">
                {{ t('利润排行') }}
              </div>
              <el-form-item prop="name" :label="t('物品')" style="width:100%; margin-right:0;">
                <el-select
                  v-model="ldSearchData.name"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  :reserve-keyword="false"
                  :placeholder="t('输入多个物品名，回车添加')"
                  style="width:260px"
                  clearable
                  @change="handleSearchLD"
                />
              </el-form-item>

              <el-form-item :label="t('条件')" style="width:100%; margin-right:0;">
                <div style="display:flex; flex-direction:column; gap:6px; width:100%;">
                  <div v-for="(cond, i) in ldSearchData.conditions" :key="i" style="display:flex; align-items:center; gap:8px;">
                    <el-select v-model="cond.steps" :placeholder="t('目标等级不限')" clearable style="width:130px" @change="handleSearchLD">
                      <el-option v-for="n in 20" :key="n" :label="`${t('目标等级')} ${n}`" :value="n" />
                    </el-select>
                    <el-button v-if="ldSearchData.conditions.length > 1" type="danger" :icon="Delete" link @click="removeCondition(i)" />
                  </div>
                  <el-button size="small" :icon="Plus" @click="addCondition">{{ t('添加条件') }}</el-button>
                </div>
              </el-form-item>

              <el-form-item :label="t('目标等级')">
                <div style="display:flex; align-items:center; gap:4px;">
                  <el-input-number style="width:80px" :min="1" :max="20" v-model="ldSearchData.minLevel" placeholder="1" clearable @change="handleSearchLD" controls-position="right" />
                  <span>~</span>
                  <el-input-number style="width:80px" :min="1" :max="20" v-model="ldSearchData.maxLevel" placeholder="20" clearable @change="handleSearchLD" controls-position="right" />
                </div>
              </el-form-item>

              <el-form-item :label="t('利润率')">
                <div style="display:flex; align-items:center; gap:4px;">
                  <el-input-number v-model="ldSearchData.minProfitRate" :min="0" :controls="false" clearable @change="handleSearchLD" style="width:70px" placeholder="0" />&nbsp;%
                  <span>~</span>
                  <el-input-number v-model="ldSearchData.maxProfitRate" :min="0" :controls="false" clearable @change="handleSearchLD" style="width:70px" placeholder="100" />&nbsp;%
                </div>
              </el-form-item>

              <el-form-item :label="t('风险')">
                <div style="display:flex; align-items:center; gap:4px;">
                  <el-input-number v-model="ldSearchData.minRisk" :min="0" :controls="false" clearable @change="handleSearchLD" style="width:70px" placeholder="0" />
                  <span>~</span>
                  <el-input-number v-model="ldSearchData.maxRisk" :min="0" :controls="false" clearable @change="handleSearchLD" style="width:70px" placeholder="∞" />
                </div>
              </el-form-item>

              <el-form-item>
                <el-checkbox v-model="ldSearchData.banCombat" @change="handleSearchLD">
                  {{ t('排除战斗装备') }}
                </el-checkbox>
              </el-form-item>
              <el-form-item>
                <el-checkbox v-model="ldSearchData.banLife" @change="handleSearchLD">
                  {{ t('排除生活装备') }}
                </el-checkbox>
              </el-form-item>
              <el-form-item>
                <el-checkbox v-model="ldSearchData.noDecompose" @change="handleSearchLD">
                  {{ t('不分解模式') }}
                </el-checkbox>
              </el-form-item>
              <el-form-item :label="t('价格源')">
                <el-select v-model="ldSearchData.priceType" style="width:110px" @change="handleSearchLD">
                  <el-option value="ask" :label="t('左挂单')" />
                  <el-option value="bid" :label="t('右收购')" />
                </el-select>
              </el-form-item>
            </el-form>
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
              <el-table-column prop="result.profitPHFormat" :label="t('利润 / h')" align="center" min-width="120" />
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
                        {{ t('#多步动作利润提示') }}
                        <br>
                        {{ t('#多步动作利润举例') }}
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
.rank-card {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  .title {
    width: 160px;
    margin-bottom: 12px;
  }
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
