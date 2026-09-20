<script lang="ts" setup>
import type Calculator from "@/calculator"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import { usePagination } from "@@/composables/usePagination"
import { Delete, Edit, Plus, Search } from "@element-plus/icons-vue"
import { ElMessageBox, type FormInstance, type Sort } from "element-plus"
import { cloneDeep, debounce } from "lodash-es"
import { getEnhanceExpDataApi } from "@/common/apis/enhanceexp"

import { getMarketDataApi } from "@/common/apis/game"
import { getActionConfigOf } from "@/common/apis/player"
import SortPriority, { type SortRule } from "@@/components/SortPriority/index.vue"
import { ENHANCEEXP_SORT_FIELDS } from "@/common/constants/sort-fields"
import { useMemory } from "@/common/composables/useMemory"
import { usePriceStatus } from "@/common/composables/usePriceStatus"
import * as Format from "@@/utils/format"
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
const { paginationData: paginationDataLD, handleCurrentChange: handleCurrentChangeLD, handleSizeChange: handleSizeChangeLD } = usePagination({}, "enhanceexp-leaderboard-pagination")
const leaderboardData = ref<Calculator[]>([])
const ldSearchFormRef = ref<FormInstance | null>(null)

const ldSearchData = useMemory("enhanceexp-leaderboard-search-data", {
  name: [],
  // 目标强化等级并行筛选（与超级强化分解页同构；行内 steps/区间 AND、行间 OR）
  conditions: [{ steps: undefined, minLevel: undefined, maxLevel: undefined }],
  // 本页专用筛选：经验性价比 ≠ 利润率，独立成字段（含义见 #强化练级说明）
  onlyProfitable: false,
  minExp: undefined,
  maxCostPerExp: undefined,
  banEquipment: false,
  banJewelry: false,
  banCombat: false,
  banLife: false,
  materialPriceType: "ask",
  productPriceType: "bid",
  // 排序优先级：第 0 项为主优先级（分组依据），第 1 项起在组内继续排序；空数组 = 默认按每次经验成本升序
  sortRules: [] as SortRule[]
})
// 兼容旧版字符串 name，迁移为数组（多物品选择）
if (typeof ldSearchData.value.name === "string") {
  ldSearchData.value.name = ldSearchData.value.name ? [ldSearchData.value.name] : []
}
if (!Array.isArray(ldSearchData.value.conditions)) {
  ldSearchData.value.conditions = [{ steps: undefined, minLevel: undefined, maxLevel: undefined }]
}
// 旧数据迁移：单向 priceType → 拆分的 materialPriceType / productPriceType（成品售价沿用旧 priceType）
if (ldSearchData.value.priceType != null && ldSearchData.value.productPriceType == null) {
  ldSearchData.value.productPriceType = ldSearchData.value.priceType
}
delete ldSearchData.value.priceType
delete ldSearchData.value.minLevel
delete ldSearchData.value.maxLevel

/** 目标强化等级从 1~20 并行选择 */
function addCondition() {
  ldSearchData.value.conditions.push({ steps: undefined, minLevel: undefined, maxLevel: undefined })
}
function removeCondition(index: number) {
  ldSearchData.value.conditions.splice(index, 1)
}

const priceTypeOptions = computed(() => [
  { value: "ask", label: `${t("左挂单")}(${t("左价")})` },
  { value: "bid", label: `${t("右收购")}(${t("右价")})` }
])

const loadingLD = ref(false)
const getLeaderboardData = debounce(() => {
  loadingLD.value = true
  getEnhanceExpDataApi({
    currentPage: paginationDataLD.currentPage,
    size: paginationDataLD.pageSize,
    ...ldSearchData.value
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

/** 排序优先级控件：表头点击会并入优先级列表（清空排序则整体重置） */
const sortPriorityRef = ref<InstanceType<typeof SortPriority> | null>(null)
function handleSortLD(sort: Sort) {
  sortPriorityRef.value?.applyHeaderSort(sort)
  getLeaderboardData()
}

/** 赚钱方案（强化后卖出比总投入还贵）整行高亮 */
function rowClassName({ row }: { row: Calculator }) {
  return row.result.profitable ? "profitable-row" : ""
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
  () => ldSearchData.value.materialPriceType,
  () => ldSearchData.value.productPriceType
], () => {
  useGameStoreOutside().clearModeCache("enhanceexp")
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

const onPriceStatusChange = usePriceStatus("enhanceexp-price-status")
const { t } = useI18n()
/**
 * 说明文案：key 采用项目统一的 `#` 前缀（说明性词条）。
 * zh-cn 未收录时 vue-i18n 会回落显示 key 本身，这里去掉前导 `#`，保证中文界面文案干净。
 */
const levelingTip = computed(() => t("强化练级说明"))
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
        {{ levelingTip }}
      </div>
    </div>
    <el-row :gutter="20" class="row">
      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="14">
        <el-card>
          <template #header>
            <el-form class="rank-card" ref="ldSearchFormRef" :inline="true" :model="ldSearchData">
              <div class="title">
                {{ t('经验性价比') }}
              </div>
              <el-form-item :label="t('排序优先级')">
                <SortPriority
                  ref="sortPriorityRef"
                  v-model="ldSearchData.sortRules"
                  :fields="ENHANCEEXP_SORT_FIELDS"
                  default-prop="result.costPerExp"
                  @change="handleSearchLD"
                />
              </el-form-item>
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

              <el-form-item :label="t('只看目标等级')" style="width:100%; margin-right:0;">
                <div style="display:flex; flex-direction:column; gap:6px; width:100%;">
                  <div v-for="(cond, i) in ldSearchData.conditions" :key="i" style="display:flex; align-items:center; gap:8px;">
                    <el-select v-model="cond.steps" :placeholder="t('不限（默认全部）')" clearable style="width:130px" @change="handleSearchLD">
                      <el-option v-for="n in 20" :key="n" :label="`${t('目标等级')} ${n}`" :value="n" />
                    </el-select>
                    <el-input-number v-model="cond.minLevel" :min="1" :max="20" :controls="false" clearable @change="handleSearchLD" style="width:60px" placeholder="1" />
                    <span>~</span>
                    <el-input-number v-model="cond.maxLevel" :min="1" :max="20" :controls="false" clearable @change="handleSearchLD" style="width:60px" placeholder="20" />
                    <el-button v-if="ldSearchData.conditions.length > 1" type="danger" :icon="Delete" link @click="removeCondition(i)" />
                  </div>
                  <div style="color:#909399; font-size:12px;">{{ t('多选后仅显示这些强化等级的方案') }}</div>
                  <el-button size="small" :icon="Plus" @click="addCondition">{{ t('添加条件') }}</el-button>
                </div>
              </el-form-item>

              <el-form-item>
                <el-checkbox v-model="ldSearchData.onlyProfitable" @change="handleSearchLD">
                  {{ t('仅看赚钱方案') }}
                </el-checkbox>
              </el-form-item>

              <el-form-item :label="t('最少经验')">
                <el-input-number v-model="ldSearchData.minExp" :min="0" :controls="false" clearable @change="handleSearchLD" style="width:110px" placeholder="0" />
              </el-form-item>

              <el-form-item :label="t('每次经验成本 ≤')">
                <el-input-number v-model="ldSearchData.maxCostPerExp" :controls="false" clearable @change="handleSearchLD" style="width:110px" placeholder="∞" />
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

              <el-form-item :label="t('材料买价')">
                <el-select v-model="ldSearchData.materialPriceType" style="width:150px" @change="handleSearchLD">
                  <el-option v-for="opt in priceTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
              </el-form-item>
              <el-form-item :label="t('成品售价')">
                <el-select v-model="ldSearchData.productPriceType" style="width:150px" @change="handleSearchLD">
                  <el-option v-for="opt in priceTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
              </el-form-item>
            </el-form>
          </template>
          <template #default>
            <el-table :data="leaderboardData" v-loading="loadingLD" :row-class-name="rowClassName" @sort-change="handleSortLD">
              <el-table-column width="54" fixed="left">
                <template #default="{ row }">
                  <ItemIcon :hrid="row.hrid" />
                </template>
              </el-table-column>
              <el-table-column prop="result.name" :label="t('物品')" />
              <el-table-column prop="result.enhanceLevel" :label="t('目标等级')" align="center" width="100" sortable="custom" :sort-orders="['descending', null]">
                <template #default="{ row }">
                  {{ row.result.enhanceLevel }}
                </template>
              </el-table-column>
              <el-table-column :label="t('保护档位')" align="center" min-width="90">
                <template #default="{ row }">
                  <template v-if="row.result.protectLevel < row.result.enhanceLevel">
                    <ItemIcon :hrid="row.protectionItem.hrid" />
                    <div>{{ t('从{0}保护', [row.result.protectLevel]) }}</div>
                  </template>
                  <template v-else>
                    <div>{{ t('不保护') }}</div>
                  </template>
                </template>
              </el-table-column>
              <el-table-column prop="actionLevel" :label="t('要求等级')" align="center" width="100" sortable="custom" :sort-orders="['ascending', null]">
                <template #default="{ row }">
                  <div :class="row.actionLevel > getActionConfigOf(row.action).playerLevel ? 'red' : ''">
                    {{ row.actionLevel }}
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="result.actions" :label="t('次数')" align="center" width="100" sortable="custom" :sort-orders="['ascending', null]">
                <template #default="{ row }">
                  {{ Format.number(row.result.actions, 2) }}
                </template>
              </el-table-column>
              <el-table-column prop="result.exp" :label="t('总经验')" align="center" min-width="110" sortable="custom" :sort-orders="['descending', null]">
                <template #default="{ row }">
                  {{ Format.number(row.result.exp, 2) }}
                </template>
              </el-table-column>
              <el-table-column :label="t('总成本')" align="center" min-width="110">
                <template #default="{ row }">
                  {{ row.result.totalCostFormat }}
                </template>
              </el-table-column>
              <el-table-column prop="result.saleValue" :label="t('售价')" align="center" min-width="110" sortable="custom" :sort-orders="['descending', null]">
                <template #default="{ row }">
                  {{ row.result.saleValueFormat }}
                </template>
              </el-table-column>
              <el-table-column prop="result.netCost" :label="t('净成本')" align="center" min-width="110" sortable="custom" :sort-orders="['ascending', null]">
                <template #default="{ row }">
                  <span :class="row.result.profitable ? 'success' : ''">{{ row.result.netCostFormat }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="result.costPerExp" :label="t('每次经验成本')" align="center" min-width="130" sortable="custom" :sort-orders="['ascending', null]">
                <template #default="{ row }">
                  <span :class="row.result.profitable ? 'success' : ''">{{ row.result.costPerExpFormat }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="result.profitableRank" :label="t('是否赚钱')" align="center" width="110" sortable="custom" :sort-orders="['descending', null]">
                <template #default="{ row }">
                  <el-tag :type="row.result.profitable ? 'success' : 'info'" effect="light">
                    {{ row.result.profitable ? t('赚钱') : t('纯消耗') }}
                  </el-tag>
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
        <ManualPriceCard memory-key="enhanceexp" />
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
.red {
  color: #f56c6c;
}
.success {
  color: #67c23a;
}
// 蓝色
.manual {
  color: #409eff;
}
// 强化完卖掉反而赚钱的方案：整行淡绿高亮，与「赚钱」标签呼应
// 同时覆盖 Element Plus 的 --el-table-tr-bg-color，否则 `.el-table tr` 的默认底色会盖掉 background-color
:deep(.profitable-row) {
  --el-table-tr-bg-color: var(--el-color-success-light-9);
  background-color: var(--el-color-success-light-9);
}
</style>
