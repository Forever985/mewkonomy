<script lang="ts" setup>
import type Calculator from "@/calculator"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import { usePagination } from "@@/composables/usePagination"
import { Delete, Edit, Plus, Search } from "@element-plus/icons-vue"
import { ElMessageBox, type FormInstance, type Sort } from "element-plus"
import { cloneDeep, debounce } from "lodash-es"

import { getDataApi } from "@/common/apis/jungle"
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

// #region 查
const { paginationData: paginationDataLD, handleCurrentChange: handleCurrentChangeLD, handleSizeChange: handleSizeChangeLD } = usePagination({}, "jungle-leaderboard-pagination")
const leaderboardData = ref<Calculator[]>([])
const ldSearchFormRef = ref<FormInstance | null>(null)

const ldSearchData = useMemory("jungle-leaderboard-search-data", {
  name: [],
  // 组合条件 = 并行检索行：每行（目标强化等级 + 动作）为一个方案族，行间 OR、行内 AND
  conditions: [{ steps: undefined, project: undefined }],
  // 反向排除：命中任一组合（产品×动作）即剔除
  excludes: [{ name: undefined, project: undefined }],
  minProfitRate: undefined,
  maxProfitRate: undefined,
  maxRisk: undefined,
  minSellPrice: undefined,
  maxSellPrice: undefined,
  minItemLevel: undefined,
  maxLevel: 20,
  minLevel: 1,
  banEquipment: false,
  banJewelry: false,
  banCombat: false,
  banLife: false,
  bestManufacture: false
})
// 兼容旧版字符串 name，迁移为数组（多物品选择）
if (typeof ldSearchData.value.name === "string") {
  ldSearchData.value.name = ldSearchData.value.name ? [ldSearchData.value.name] : []
}
// 旧数据迁移：project → conditions、profitRate → minProfitRate
if (!Array.isArray(ldSearchData.value.conditions)) {
  ldSearchData.value.conditions = [{ steps: undefined, project: ldSearchData.value.project || undefined }]
}
if (!Array.isArray(ldSearchData.value.excludes)) {
  ldSearchData.value.excludes = [{ name: undefined, project: undefined }]
}
if (ldSearchData.value.profitRate != null && ldSearchData.value.minProfitRate == null) {
  ldSearchData.value.minProfitRate = ldSearchData.value.profitRate
}
delete ldSearchData.value.project
delete ldSearchData.value.profitRate

/** 可检索的动作列表（专业） */
const projectOptions = ["锻造", "制造", "裁缝", "强化"]
function addCondition() {
  ldSearchData.value.conditions.push({ steps: undefined, project: undefined })
}
function removeCondition(index: number) {
  ldSearchData.value.conditions.splice(index, 1)
}
function addExclude() {
  ldSearchData.value.excludes.push({ name: undefined, project: undefined })
}
function removeExclude(index: number) {
  ldSearchData.value.excludes.splice(index, 1)
}

const loadingLD = ref(false)

// 防抖处理
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

const onPriceStatusChange = usePriceStatus("jungle-price-status")
</script>

<template>
  <div class="app-container">
    <div class="game-info">
      <GameInfo />
      <div>
        <ActionConfig :actions="['enhancing', 'cheesesmithing', 'crafting', 'tailoring']" :equipments="['off_hand', 'hands', 'neck', 'earrings', 'ring', 'pouch']" />
      </div>
      <PriceStatusSelect
        @change="onPriceStatusChange"
      />
      <div>
        {{ t('打野爽！') }}
      </div>
    </div>
    <el-row :gutter="20" class="row">
      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="16">
        <el-card>
          <template #header>
            <el-form class="rank-card" ref="ldSearchFormRef" :inline="true" :model="ldSearchData">
              <div class="title">
                {{ t('利润排行') }}
              </div>
              <el-form-item prop="name" :label="t('物品')">
                <el-select
                  v-model="ldSearchData.name"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  :reserve-keyword="false"
                  :placeholder="t('输入多个物品名，回车添加')"
                  style="width:220px"
                  clearable
                  @change="handleSearchLD"
                />
              </el-form-item>

              <el-form-item :label="t('条件')" style="width:100%; margin-right:0;">
                <div style="display:flex; flex-direction:column; gap:6px; width:100%;">
                  <div v-for="(cond, i) in ldSearchData.conditions" :key="i" style="display:flex; align-items:center; gap:8px;">
                    <el-select v-model="cond.steps" :placeholder="t('不限（默认全部）')" clearable style="width:130px" @change="handleSearchLD">
                      <el-option v-for="n in 20" :key="n" :label="`${t('目标等级')} ${n}`" :value="n" />
                    </el-select>
                    <el-select v-model="cond.project" :placeholder="t('动作不限')" clearable style="width:130px" @change="handleSearchLD">
                      <el-option v-for="p in projectOptions" :key="p" :label="t(p)" :value="t(p)" />
                    </el-select>
                    <el-button v-if="ldSearchData.conditions.length > 1" type="danger" :icon="Delete" link @click="removeCondition(i)" />
                  </div>
                  <el-button size="small" :icon="Plus" @click="addCondition">{{ t('添加条件') }}</el-button>
                </div>
              </el-form-item>

              <el-form-item :label="t('目标等级从')">
                <el-input-number style="width:80px" :min="1" :max="20" v-model="ldSearchData.minLevel" placeholder="1" clearable @change="handleSearchLD" controls-position="right" />&nbsp;{{ t('到') }}&nbsp;
                <el-input-number style="width:80px" :min="1" :max="20" v-model="ldSearchData.maxLevel" placeholder="20" clearable @change="handleSearchLD" controls-position="right" />
              </el-form-item>

              <el-form-item :label="`${t('售价')} ≥`">
                <el-input-number style="width:80px" v-model="ldSearchData.minSellPrice" placeholder="0" clearable @change="handleSearchLD" :controls="false" />&nbsp;M
              </el-form-item>

              <el-form-item :label="`${t('售价')} ≤`">
                <el-input-number style="width:80px" v-model="ldSearchData.maxSellPrice" placeholder="∞" clearable @change="handleSearchLD" :controls="false" />&nbsp;M
              </el-form-item>

              <el-form-item :label="`${t('物品等级')} ≥`">
                <el-input-number style="width:80px" v-model="ldSearchData.minItemLevel" placeholder="0" clearable @change="handleSearchLD" :controls="false" />
              </el-form-item>

              <el-form-item :label="`${t('风险')} ≤`">
                <el-input-number style="width:80px" v-model="ldSearchData.maxRisk" clearable @change="handleSearchLD" :controls="false" />
              </el-form-item>

              <el-form-item :label="t('利润率')">
                <div style="display:flex; align-items:center; gap:4px;">
                  <el-input-number v-model="ldSearchData.minProfitRate" :controls="false" clearable @change="handleSearchLD" style="width:70px" placeholder="-100" />&nbsp;%
                  <span>~</span>
                  <el-input-number v-model="ldSearchData.maxProfitRate" :controls="false" clearable @change="handleSearchLD" style="width:70px" placeholder="100" />&nbsp;%
                </div>
              </el-form-item>

              <el-form-item :label="t('排除')" style="width:100%; margin-right:0;">
                <div style="display:flex; flex-direction:column; gap:6px; width:100%;">
                  <div v-for="(ex, i) in ldSearchData.excludes" :key="i" style="display:flex; align-items:center; gap:8px;">
                    <el-select
                      v-model="ex.name"
                      filterable
                      allow-create
                      default-first-option
                      :reserve-keyword="false"
                      :placeholder="t('排除的产品名')"
                      clearable
                      style="width:220px"
                      @change="handleSearchLD"
                    />
                    <el-select v-model="ex.project" :placeholder="t('排除的生产动作，留空=该产品全部')" clearable style="width:280px" @change="handleSearchLD">
                      <el-option v-for="p in projectOptions" :key="p" :label="t(p)" :value="t(p)" />
                    </el-select>
                    <el-button v-if="ldSearchData.excludes.length > 1" type="danger" :icon="Delete" link @click="removeExclude(i)" />
                  </div>
                  <el-button size="small" :icon="Plus" @click="addExclude">{{ t('添加排除') }}</el-button>
                </div>
              </el-form-item>

              <el-form-item>
                <el-checkbox v-model="ldSearchData.banEquipment" @change="handleSearchLD">
                  {{ t('排除装备') }}
                </el-checkbox>
              </el-form-item>
              <el-form-item>
                <el-checkbox v-model="ldSearchData.banJewelry" @change="handleSearchLD">
                  {{ t('排除首饰') }}
                </el-checkbox>
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
                <el-checkbox v-model="ldSearchData.bestManufacture" @change="handleSearchLD">
                  {{ t('最佳制作方案') }}
                </el-checkbox>
              </el-form-item>
            </el-form>
          </template>
          <template #default>
            <!-- 数据表格 -->
            <el-table :data="leaderboardData" v-loading="loadingLD" @sort-change="handleSortLD">
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
                  {{ row.result.cost4EnhancePHFormat }}
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
              <el-table-column align="center" :label="t('利润率')">
                <template #default="{ row }">
                  <span :class="row.hasManualPrice ? 'manual' : ''">
                    {{ row.result.profitRateFormat }}&nbsp;
                  </span>
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

      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="8">
        <ManualPriceCard memory-key="jungle" />
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
.rank-card {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  .title {
    width: 160px;
    margin-bottom: 12px;
  }
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
