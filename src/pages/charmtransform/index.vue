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

/**
 * 催化剂标签 —— 用**游戏内的真实物品名**。
 *
 * 此前写的是「普通催化剂 / 主要催化剂」，但 `data.json` 里根本没有这两个物品：
 * 转化这一步能用的是「转化催化剂」（+15%，成功时消耗 1 个）与
 * 「至高催化剂」（+25%，任意炼金通用）。
 * 玩家按界面的名字去游戏里找是找不到的。
 */
function catalystLabel(rank: number) {
  if (rank === 1) return t("转化催化剂")
  if (rank === 2) return t("至高催化剂")
  return t("无")
}
function onRowClick(row: CharmTierResult) {
  activeTier.value = row.tier
}
function profitClass(v: number) {
  return v > 0 ? "success" : v < 0 ? "error" : ""
}

/**
 * 五档是否**全部**无市场报价。
 *
 * 实测 `market.json` 里所有护符（冲泡 + 其它技能）ask/bid 都是 -1，
 * 即市场上**一件都卖不掉**。此时「理想利润」只是**理论上限** ——
 * 假设你能按自制成本价卖得掉。
 *
 * 不标注的话，页面会给用户一个不存在的收益预期 ⇒ 这正是「效果不好」的来源。
 */
const allNoQuote = computed(() => result.value.length > 0 && result.value.every(r => r.noMarketQuote))
/** 有市场报价的档位数（用于提示文案） */
const quotedCount = computed(() => result.value.filter(r => !r.noMarketQuote).length)
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

        <el-alert
          v-if="allNoQuote"
          type="warning"
          :closable="false"
          show-icon
          class="mb-3"
        >
          <template #title>
            {{ t("当前市场没有任何护符报价") }}
          </template>
          <div class="text-xs leading-5">
            {{ t("五档产出护符在市场上一件都卖不掉（买价与卖价均为空），所以「实际利润」按 0 计价。") }}
            {{ t("「理想利润」只是理论上限——它假设你能按「用对应精华从零制作的成本」卖出去。") }}
            {{ t("转化本身不创造利润，只是把冲泡精华换成别的技能精华；真正盈利的前提是市场愿意给高于自制成本的价格。") }}
          </div>
        </el-alert>
        <el-alert
          v-else
          type="info"
          :closable="false"
          show-icon
          class="mb-3"
        >
          <template #title>
            {{ t("有市场报价的档位") }}：{{ quotedCount }} / {{ result.length }}
          </template>
        </el-alert>

        <div class="flex items-center gap-3 mb-3">
          <span class="text-sm">{{ t("催化剂") }}：</span>
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-360px leading-5">{{ t("催化剂说明") }}</div>
            </template>
            <el-radio-group v-model="catalystRank">
              <el-radio-button v-for="r in [0, 1, 2]" :key="r" :value="r">{{ catalystLabel(r) }}</el-radio-button>
            </el-radio-group>
          </el-tooltip>
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
              <el-tooltip
                :disabled="!row.noMarketQuote"
                placement="top"
                effect="light"
                :show-after="120"
              >
                <template #content>
                  <div class="max-w-360px leading-5">{{ t("该档产出护符无市场报价，此数字是理论上限") }}</div>
                </template>
                <span :class="profitClass(row.profitIdealPH)">{{ row.valid ? Format.money(row.profitIdealPH) : "--" }}</span>
              </el-tooltip>
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
