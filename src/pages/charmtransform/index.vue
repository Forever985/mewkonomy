<script lang="ts" setup>
import type { CharmTier, CharmTierResult } from "@/common/apis/charmtransform"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import PriceStatusSelect from "@@/components/PriceStatusSelect/index.vue"
import * as Format from "@@/utils/format"
import { QuestionFilled } from "@element-plus/icons-vue"
import { useI18n } from "vue-i18n"
import { calcCharmFeedChoices, calcCharmTransformApi, calcCharmTransformInsights } from "@/common/apis/charmtransform"
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
 * 催化剂横向对比 + 盈亏平衡线。
 *
 * 用户原话：「用稍弱一些的催化剂，亏损一些成功率但是降低成本，**这些都是要考量的**。」
 * ⇒ 必须能一眼看出哪种组合最优，而不是在三个 radio 之间来回切、自己心算。
 *
 * ⚠️ 性能：`calcCharmTransformInsights` 内部要跑 3 次全档计算（约 15 个计算器），
 * 实测单次 ~2s。它只依赖催化剂档位与买卖价，故只在这些变化时重算。
 */
const insights = computed(() => {
  void gameStore.buyStatus
  void gameStore.sellStatus
  return calcCharmTransformInsights(catalystRank.value)
})
const activeInsight = computed(() => insights.value.find(i => i.tier === activeTier.value))

/**
 * 「投入哪种精华」的横向对比。
 *
 * 转化表对 10 个技能完全对称（每档 10 项各 10%）⇒ **利润只取决于投入哪种精华**。
 * 页面早前把「冲泡」写死在输入侧，没法验证「冲泡最便宜」这个前提在当前数据下
 * 是否还成立。实测（官方实时数据 2026-10-07）：冲泡 285 第 1/10，
 * 且是**唯一盈利**的投入（+8613 万/h），其余 9 种全亏。
 */
const feedChoices = computed(() => {
  void gameStore.buyStatus
  void gameStore.sellStatus
  return calcCharmFeedChoices(activeTier.value, catalystRank.value)
})
/** 按自制成本升序，最便宜的排最前（页面直接展示，无需用户再排序） */
const feedChoicesSorted = computed(() => [...feedChoices.value].sort((a, b) => a.costRank - b.costRank))

/** 投入侧最优（成本最低）的技能 */
const cheapestFeed = computed(() => feedChoicesSorted.value[0])

/** 档位显示名（走 i18n，避免直接拼 key） */
function tierLabel(tier: CharmTier) {
  return t(`CharmTier.${tier}`)
}

/**
 * 催化剂对比表的列定义。
 *
 * `rateText` 在表头就写清成功率 —— 用户原话：「强催化剂提升成功率，但更昂贵」，
 * 这两个数必须**同时**出现，单独看一个会误导。
 * 成功率从 `insights[0].catalysts` 取（三档位同催化剂的成功率恒等）。
 */
const catalystColumns = computed(() => {
  const first = insights.value[0]
  return [0, 1, 2].map(rank => {
    const label = rank === 0 ? t("无催化剂") : rank === 1 ? t("转化催化剂") : t("至高催化剂")
    const rate = first?.catalysts[rank]?.successRate ?? 0
    return { rank, label, rateText: Format.percent(rate) }
  })
})

/** 盈亏平衡 tooltip 文案 */
function breakEvenTip(row: { multipleOfBreakEven: number }) {
  if (row.multipleOfBreakEven >= 1) {
    return t("已越过平衡点，产出护符均价再跌 ") +
      Format.percent(1 - 1 / row.multipleOfBreakEven) + t(" 就开始亏")
  }
  return t("距离平衡点还差 ") + Format.percent(1 / row.multipleOfBreakEven - 1)
}

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
 * 价格来源标签 —— 取价不是永远来自市场，必须标出来。
 *
 * `PriceSource` 有五档（见 `common/apis/game`）：
 *   market   市场真实成交
 *   cross    借了另一端的市价（右价借左价 / 左价借右价）—— 数字是真的，方向是反的
 *   shop     商店价
 *   selfcraft 大全套（自产）成本估值
 *   none     确实无价
 *
 * 不标的话用户会把 `cross` / `selfcraft` 的数字当市价，而这两者都不是能真成交的价格。
 */
function priceSourceLabel(s: string) {
  if (s === "cross") return t("借价")
  if (s === "selfcraft") return t("自产估值")
  if (s === "shop") return t("商店价")
  if (s === "none") return t("无价")
  return ""
}
function priceSourceTip(s: string) {
  if (s === "cross") return t("该物品市场只有一端报价，这个数字借自另一端，不是真实可成交价。")
  if (s === "selfcraft") return t("市场无报价，按「用对应精华从零自制」的成本估算 —— 是价格上限，不是能卖到的价。")
  if (s === "shop") return t("取自商店价格。")
  if (s === "none") return t("市场与兜底都给不出价格，这一档无法计算。")
  return t("取自市场真实成交价。")
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
        <span class="text-sm text-gray-400 ml-2">
          {{ t("投入价按上面的买价口径取；市场无报价时由 GameInfo 里的兜底策略决定（可切成自产成本估值）") }}
        </span>
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
        <el-table-column :label="t('投入价（按上面选的口径）')" align="center" min-width="170">
          <template #default="{ row }">
            <el-tooltip placement="top" effect="light" :show-after="120">
              <template #content>
                <div class="max-w-360px leading-5">
                  {{ priceSourceTip(row.charmPriceSourceNow) }}
                  <div class="mt-1 text-gray-400">
                    {{ t("自制成本（仅对照）") }}：{{ row.essenceCost > 0 ? Format.money(row.essenceCost) : t("无法估算") }}
                  </div>
                </div>
              </template>
              <span>
                {{ row.charmPriceNow > 0 ? Format.money(row.charmPriceNow) : "--" }}
                <el-tag v-if="row.charmPriceSourceNow !== 'market'" size="small" type="warning" class="ml-1">
                  {{ priceSourceLabel(row.charmPriceSourceNow) }}
                </el-tag>
              </span>
            </el-tooltip>
          </template>
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
        <el-table-column :label="t('价格口径')" align="center" min-width="130">
          <template #default="{ row }">
            <el-tag v-if="row.isSelf" size="small">{{ t("转回自己") }}</el-tag>
            <el-tag v-else-if="row.isIdeal" type="warning" size="small">{{ t("主宰挂价") }}</el-tag>
            <el-tag v-else type="success" size="small">{{ t("市场价") }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <div class="text-xs text-gray-400 mt-2">
        {{ t("「转回自己」= 转化表里含投入的护符本身（各 10%）。它要再转一次才能变现，不算收益。") }}
      </div>
    </el-card>

    <!-- ══════════════ 催化剂横向对比 ══════════════ -->
    <el-card class="mt-3">
      <template #header>
        <div class="flex items-center gap-2 flex-wrap">
          <span>{{ t("催化剂怎么选") }}</span>
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-420px leading-5">
                {{ t("催化剂说明") }}
                <div class="mt-1 text-gray-300">
                  {{ t("强催化剂提升成功率，但本身有成本 —— 最优解不一定是最高成功率那档。") }}
                </div>
              </div>
            </template>
            <el-icon class="cursor-help text-gray-400"><QuestionFilled /></el-icon>
          </el-tooltip>
          <span class="text-sm text-gray-400">{{ t("横向列出三种配置，直接看哪档最赚") }}</span>
        </div>
      </template>
      <el-table :data="insights" size="small">
        <el-table-column :label="t('护符档位')" min-width="120">
          <template #default="{ row }">
            <span :class="row.tier === activeTier ? 'font-bold' : ''">{{ tierLabel(row.tier) }}</span>
          </template>
        </el-table-column>
        <el-table-column v-for="c in catalystColumns" :key="c.rank" align="center" min-width="185">
          <template #header>
            <div class="leading-4">
              <div>{{ c.label }}</div>
              <div class="text-xs text-gray-400">{{ t("成功率") }} {{ c.rateText }}</div>
            </div>
          </template>
          <template #default="{ row }">
            <div class="leading-5">
              <div :class="[profitClass(row.catalysts[c.rank].profitIdealPH), row.catalysts[c.rank].isBest ? 'font-bold' : '']">
                {{ row.catalysts[c.rank].profitIdealPH > 0
                  ? Format.money(row.catalysts[c.rank].profitIdealPH)
                  : t("亏") }}
              </div>
              <div class="text-xs text-gray-400">
                {{ t("成本") }} {{ Format.money(row.catalysts[c.rank].costPH) }}
              </div>
              <el-tag v-if="row.catalysts[c.rank].isBest" size="small" type="success" class="mt-1">{{ t("最优") }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="t('盈亏平衡均价')" align="center" min-width="150">
          <template #default="{ row }">
            <el-tooltip placement="top" effect="light" :show-after="120">
              <template #content>
                <div class="max-w-360px leading-5">{{ t("产出护符的平均卖价至少要到这个值，这档才不亏。") }}</div>
              </template>
              <span>{{ row.breakEvenBid > 0 ? Format.money(row.breakEvenBid) : "--" }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column :label="t('现均价 / 平衡线')" align="center" min-width="150">
          <template #default="{ row }">
            <el-tooltip v-if="row.currentAvgBid > 0" placement="top" effect="light" :show-after="120">
              <template #content>
                <div class="max-w-360px leading-5">
                  {{ t("现均价") }}：{{ Format.money(row.currentAvgBid) }}
                  <div class="mt-1">{{ breakEvenTip(row) }}</div>
                </div>
              </template>
              <span :class="row.multipleOfBreakEven >= 1 ? 'success' : 'error'">
                {{ Format.number(row.multipleOfBreakEven, 2) }}&times;
              </span>
            </el-tooltip>
            <span v-else class="text-gray-400">{{ t("无报价") }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="text-xs text-gray-400 mt-2">
        {{ t("「理想利润」按无流动性护符的挂价上限（其自身精华的自制成本）计 —— 它是价格天花板，需要有人接盘才成立。") }}
      </div>
    </el-card>

    <!-- ══════════════ 投入哪种精华 ══════════════ -->
    <el-card class="mt-3">
      <template #header>
        <div class="flex items-center gap-2 flex-wrap">
          <span>{{ t("投入哪种精华最划算") }}</span>
          <el-tooltip placement="top" effect="light" :show-after="120">
            <template #content>
              <div class="max-w-420px leading-5">
                {{ t("转化表对 10 个技能完全对称（各 10%），所以利润只取决于投入哪种精华。") }}
              </div>
            </template>
            <el-icon class="cursor-help text-gray-400"><QuestionFilled /></el-icon>
          </el-tooltip>
          <span class="text-sm text-gray-400">
            {{ t("档位") }}：{{ tierLabel(activeTier) }} · {{ t("催化剂") }}：{{ catalystLabel(catalystRank) }}
          </span>
        </div>
      </template>
      <div v-if="cheapestFeed" class="text-sm mb-2">
        <el-tag type="success" size="small" class="mr-2">{{ t("最便宜") }}</el-tag>
        <span>{{ cheapestFeed.essenceName }}</span>
        <span class="text-gray-500 ml-2">
          {{ Format.money(cheapestFeed.essencePrice) }} &times; {{ Format.number(cheapestFeed.essenceCount, 0) }}
          = {{ Format.money(cheapestFeed.selfCraftCost) }}
        </span>
      </div>
      <el-table :data="feedChoicesSorted" size="small">
        <el-table-column :label="t('投入技能')" min-width="130">
          <template #default="{ row }">
            <span>{{ row.essenceName }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('精华单价')" align="center" min-width="100">
          <template #default="{ row }">{{ row.essencePrice > 0 ? Format.money(row.essencePrice) : "--" }}</template>
        </el-table-column>
        <el-table-column :label="t('所需精华')" align="center" min-width="90">
          <template #default="{ row }">{{ Format.number(row.essenceCount, 0) }}</template>
        </el-table-column>
        <el-table-column :label="t('自制成本')" align="center" min-width="120">
          <template #default="{ row }">
            <span :class="row.costRank === 1 ? 'font-bold' : ''">
              {{ row.selfCraftCost > 0 ? Format.money(row.selfCraftCost) : "--" }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="t('自制投入的利润 / h')" align="center" min-width="170">
          <template #default="{ row }">
            <span :class="profitClass(row.profitIdealIfSelfCraft)">
              {{ row.profitIdealIfSelfCraft > 0 ? Format.money(row.profitIdealIfSelfCraft) : t("亏") }}
            </span>
          </template>
        </el-table-column>
      </el-table>
      <div class="text-xs text-gray-400 mt-2">
        {{ t("按自制成本升序。通常只有最便宜的那种能盈利 —— 这就是「用最便宜的精华投入」这条经验法则的来源。") }}
      </div>
    </el-card>
  </div>
</template>
