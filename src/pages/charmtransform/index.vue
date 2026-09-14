<script lang="ts" setup>
import type { CharmTier, CharmTierResult } from "@/common/apis/charmtransform"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import PriceStatusSelect from "@@/components/PriceStatusSelect/index.vue"
import * as Format from "@@/utils/format"
import { useI18n } from "vue-i18n"
import { calcCharmTransformApi } from "@/common/apis/charmtransform"
import { usePriceStatus } from "@/common/composables/usePriceStatus"
import { useGameStoreOutside } from "@/pinia/stores/game"
import GameInfo from "../dashboard/components/GameInfo.vue"

const { t } = useI18n()
const gameStore = useGameStoreOutside()

const catalystRank = ref(0)
const activeTier = ref<CharmTier>("basic")

const onPriceStatusChange = usePriceStatus("charmtransform-price-status")
// 依赖左右价（买价/卖价）状态：切换后重算，缓存由 game api 按状态键自动区分
const result = computed<CharmTierResult[]>(() => {
  void gameStore.buyStatus
  void gameStore.sellStatus
  return calcCharmTransformApi(catalystRank.value)
})
const activeResult = computed(() => result.value.find(r => r.tier === activeTier.value))

function catalystLabel(rank: number) {
  if (rank === 1) return t("普通催化剂")
  if (rank === 2) return t("主要催化剂")
  return t("无")
}
function onRowClick(row: CharmTierResult) {
  activeTier.value = row.tier
}
function profitClass(v: number) {
  return v > 0 ? "success" : v < 0 ? "error" : ""
}
</script>

<template>
  <div>
    <GameInfo />
    <el-card>
      <template #header>
        <div class="flex items-center gap-2 flex-wrap">
          <span>{{ t("冲泡护符转化盈利") }}</span>
          <span class="text-sm text-gray-400">{{ t("冲泡精华→冲泡护符→转化，双口径对比理想价格与实际价格") }}</span>
        </div>
      </template>

      <div class="flex items-center gap-3 mb-3">
        <span class="text-sm">{{ t("催化剂") }}：</span>
        <el-radio-group v-model="catalystRank">
          <el-radio-button v-for="r in [0, 1, 2]" :key="r" :value="r">{{ catalystLabel(r) }}</el-radio-button>
        </el-radio-group>
        <PriceStatusSelect @change="onPriceStatusChange" />
        <span class="text-sm text-gray-400 ml-2">{{ t("理想价格") }}：{{ t("市场无人买卖时由你主宰，挂价上限=产出护符自身精华直接制作成本") }}</span>
      </div>

      <el-table :data="result" size="small" highlight-current-row :row-class-name="() => ''" @row-click="onRowClick">
        <el-table-column width="44">
          <template #default="{ row }">
            <ItemIcon :hrid="row.charmHrid" />
          </template>
        </el-table-column>
        <el-table-column :label="t('护符档位')" min-width="120">
          <template #default="{ row }">{{ row.charmName }}</template>
        </el-table-column>
        <el-table-column :label="t('所需精华')" align="center" min-width="90">
          <template #default="{ row }">{{ Format.number(row.essenceCount, 0) }}</template>
        </el-table-column>
        <el-table-column :label="t('精华成本')" align="center" min-width="110">
          <template #default="{ row }">{{ row.essenceCost > 0 ? Format.money(row.essenceCost) : "--" }}</template>
        </el-table-column>
        <el-table-column :label="t('成功率')" align="center" min-width="80">
          <template #default="{ row }">{{ Format.percent(row.successRate) }}</template>
        </el-table-column>
        <el-table-column :label="t('实际利润 / h')" align="center" min-width="120">
          <template #default="{ row }">
            <span :class="profitClass(row.profitActualPH)">{{ row.valid ? Format.money(row.profitActualPH) : "--" }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('理想利润 / h')" align="center" min-width="120">
          <template #default="{ row }">
            <span :class="profitClass(row.profitIdealPH)">{{ row.valid ? Format.money(row.profitIdealPH) : "--" }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('实际利润率')" align="center" min-width="90">
          <template #default="{ row }">{{ row.valid ? Format.percent(row.profitActualRate) : "--" }}</template>
        </el-table-column>
        <el-table-column :label="t('理想利润率')" align="center" min-width="90">
          <template #default="{ row }">{{ row.valid ? Format.percent(row.profitIdealRate) : "--" }}</template>
        </el-table-column>
      </el-table>
      <div class="text-xs text-gray-400 mt-2">
        {{ t("提示") }}：{{ t("实际价格为当前市场成交价，无流动性护符按0计；理想价格为无市场时按精华直接制作成本挂价，点击行查看产出明细") }}
      </div>
    </el-card>

    <el-card v-if="activeResult" class="mt-3">
      <template #header>
        <div class="flex items-center justify-between">
          <span>{{ t("产出明细") }}：{{ activeResult.charmName }}（{{ t("转化") }}）</span>
          <span class="text-sm text-gray-400">{{ t("每档10种护符各10%产出") }}</span>
        </div>
      </template>
      <el-table :data="activeResult.products" size="small">
        <el-table-column width="44">
          <template #default="{ row }">
            <ItemIcon :hrid="row.hrid" />
          </template>
        </el-table-column>
        <el-table-column prop="name" :label="t('产出护符')" min-width="140" />
        <el-table-column :label="t('掉率')" align="center" min-width="70">
          <template #default="{ row }">{{ Format.percent(row.rate) }}</template>
        </el-table-column>
        <el-table-column :label="t('市场买价')" align="center" min-width="100">
          <template #default="{ row }">{{ row.askActual >= 0 ? Format.money(row.askActual) : "--" }}</template>
        </el-table-column>
        <el-table-column :label="t('实际卖价')" align="center" min-width="100">
          <template #default="{ row }">{{ row.bidActual >= 0 ? Format.money(row.bidActual) : "--" }}</template>
        </el-table-column>
        <el-table-column :label="t('理想挂价')" align="center" min-width="120">
          <template #default="{ row }">
            <span>{{ row.bidIdeal >= 0 ? Format.money(row.bidIdeal) : "--" }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('价格口径')" align="center" min-width="110">
          <template #default="{ row }">
            <el-tag v-if="row.isIdeal" type="warning" size="small">{{ t("主宰挂价") }}</el-tag>
            <el-tag v-else type="success" size="small">{{ t("市场价") }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
