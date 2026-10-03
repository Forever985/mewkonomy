<script lang="ts" setup>
import ItemIcon from "@@/components/ItemIcon/index.vue"
import PagerFooter from "@@/components/PagerFooter/index.vue"
import SearchPanel from "@@/components/SearchPanel/index.vue"
import type { PanelField } from "@@/components/SearchPanel/types"
import { Edit, Search } from "@element-plus/icons-vue"

import { getDataApi } from "@/common/apis/jungle/junglest"
import { useLeaderboardPage } from "@/common/composables/useLeaderboardPage"
import * as Format from "@/common/utils/format"
import ActionConfig from "../dashboard/components/ActionConfig.vue"
import ActionDetail from "../dashboard/components/ActionDetail.vue"
import ActionPrice from "../dashboard/components/ActionPrice.vue"
import GameInfo from "../dashboard/components/GameInfo.vue"
import ManualPriceCard from "../dashboard/components/ManualPriceCard.vue"
import PriceStatusSelect from "@@/components/PriceStatusSelect/index.vue"

const { t } = useI18n()

/** 可检索的动作列表（专业） */
const projectOptions = ["锻造", "制造", "裁缝", "强化"]

/** 搜索面板配置：字段顺序/文案/边界与原手写模板完全一致 */
const panelFields: PanelField[] = [
  { type: "name", key: "name", label: "物品" },
  {
    type: "conditions",
    label: "条件",
    tip: "条件说明",
    projectOptions,
    stepsCount: 20,
    stepLabel: n => `${t("目标等级")} ${n}`
  },
  {
    type: "range",
    label: "目标等级从",
    tip: "目标等级说明",
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
    tip: "利润率说明",
    minKey: "minProfitRate",
    maxKey: "maxProfitRate",
    unit: "%",
    placeholderMin: "-100",
    placeholderMax: "100"
  },
  {
    type: "excludes",
    label: "排除",
    tip: "排除说明",
    projectOptions,
    namePlaceholder: "排除的产品名",
    projectPlaceholder: "排除的生产动作，留空=该产品全部"
  },
  { type: "checkbox", key: "banEquipment", label: "排除装备" },
  { type: "checkbox", key: "banJewelry", label: "排除首饰" },
  { type: "checkbox", key: "banCharm", label: "排除护符" },
  { type: "checkbox", key: "banCombat", label: "排除战斗装备" },
  { type: "checkbox", key: "banLife", label: "排除生活装备" }
]

/**
 * 检索结果页骨架：分页 / 检索条件缓存 / 防抖检索 / 排序 / 详情与价格弹窗 / 买卖价状态。
 * 用别名解构，模板里的变量名（ldSearchData、paginationDataLD…）保持不变。
 */
const {
  searchData: ldSearchData,
  list: leaderboardData,
  loading: loadingLD,
  paginationData: paginationDataLD,
  handleCurrentChange: handleCurrentChangeLD,
  handleSizeChange: handleSizeChangeLD,
  handleSearch: handleSearchLD,
  handleSortChange: handleSortLD,
  currentRow,
  detailVisible,
  showDetail,
  priceVisible,
  currentPriceRow,
  setPrice,
  onPriceStatusChange
} = useLeaderboardPage({
  key: "junglest",
  api: getDataApi,
  searchData: {
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
    banCharm: false,
    banCombat: false,
    banLife: false
  }
})
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
                    <el-tooltip placement="top" effect="light" :show-after="120">
                      <template #content>
                        <div class="max-w-380px leading-5" v-html="t('风险系数说明')" />
                      </template>
                      <el-icon class="cursor-help color-gray-400">
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
            <PagerFooter
              :pagination="paginationDataLD"
              @size-change="handleSizeChangeLD"
              @current-change="handleCurrentChangeLD"
            />
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
