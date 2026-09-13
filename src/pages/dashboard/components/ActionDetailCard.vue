<script setup lang="ts">
import type Calculator from "@/calculator"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import { getItemDetailOf } from "@/common/apis/game"
import * as Format from "@/common/utils/format"
import type { PriceSourceWithState } from "@/calculator"

defineProps<{
  data: Calculator
  type: "ingredient" | "product"
  simple?: boolean
  workMultiplier?: number
}>()

const { t } = useI18n()

/** 非真实市价的来源标注（不打扰正常市场价，仅对兜底/自定义/内部流转出标） */
function priceSourceLabel(source?: PriceSourceWithState) {
  switch (source) {
    case "selfcraft": return t("自产")
    case "shop": return t("商店")
    case "none": return t("无价")
    case "manual": return t("自定义")
    case "internal": return t("流转")
    default: return ""
  }
}
function priceSourceTip(source?: PriceSourceWithState) {
  switch (source) {
    case "selfcraft": return t("市场无价，按大全套自产成本估值（非真实成交价）")
    case "shop": return t("市场无价，按商店价格兜底（非真实成交价）")
    case "none": return t("无价（-1），暂无法定价")
    case "manual": return t("自定义价格")
    case "internal": return t("工作流内部流转，成本已互相抵消")
    default: return ""
  }
}
function priceSourceTagType(source?: PriceSourceWithState) {
  switch (source) {
    case "selfcraft": return "warning"
    case "shop": return "info"
    case "none": return "danger"
    case "manual": return "primary"
    case "internal": return "success"
    default: return "info"
  }
}
</script>

<template>
  <el-card>
    <el-table :data="data[`${type}ListWithPrice`]" :show-header="false">
      <el-table-column width="44">
        <template #default="{ row }">
          <ItemIcon :hrid="row.hrid" />
        </template>
      </el-table-column>
      <el-table-column label="物品">
        <template #default="{ row }">
          {{ t(getItemDetailOf(row.hrid).name) }}
          <template v-if="row.level">
            +{{ row.level }}
          </template>
        </template>
      </el-table-column>

      <el-table-column v-if="!simple && type === 'product'" prop="rate" label="掉率">
        <template #default="{ row }">
          <div v-if="row.rate < 1" style="min-width:60px">
            {{ Math.floor(row.rate * 1000000) / 10000 }}%
          </div>
        </template>
      </el-table-column>

      <el-table-column v-if="!simple" prop="count" label="数量">
        <template #default="{ row }">
          <span>{{ Format.number(row.count, 3) }}{{ t('个') }}</span>
          &nbsp;<el-text v-if="row.counterCount" style="color:#999;" tag="del">
            {{ Format.number((row.counterCount + row.count), 3) }}{{ t('个') }}
          </el-text>
        </template>
      </el-table-column>

      <el-table-column prop="price" label="价格">
        <template #default="{ row }">
          <span v-if="type === 'ingredient'" :class="row.price < row.marketPrice ? row.price > row.marketPrice ? 'green' : 'red' : ''">
            ¥{{ Format.price(row.price) }}
          </span>
          <span v-else :class="row.price > row.marketPrice ? row.price < row.marketPrice ? 'green' : 'red' : ''">
            ¥{{ Format.price(row.price) }}
          </span>
          <el-tooltip v-if="row.priceSource && row.priceSource !== 'market'" :content="priceSourceTip(row.priceSource)" placement="top">
            <el-tag size="small" style="margin-left:4px" :type="priceSourceTagType(row.priceSource)">
              {{ priceSourceLabel(row.priceSource) }}
            </el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column prop="countPH" label="数量">
        <template #default="{ row }">
          <span>{{ Format.number(row.countPH! * (workMultiplier || 1), 3) }} / h</span>
          &nbsp;<el-text v-if="row.counterCountPH" style="color:#999;" tag="del">
            {{ Format.number((row.counterCountPH + row.countPH) * (workMultiplier || 1), 3) }} / h
          </el-text>
        </template>
      </el-table-column>
    </el-table>
    <div class="footer-wrapper">
      <span v-if="type === 'ingredient'">
        {{ `${t('成本')}：${Format.money(data.result.costPH * (workMultiplier || 1))}` }}
        <el-tooltip v-if="data.result.selfProduceRatioFormat" :content="t('自产比例=自产原料成本÷(自产+外购)成本；自产含大全套自产成本估值与0成本采集料，随市价动态变化')" placement="top">
          <el-text type="warning" style="margin-left:8px">
            {{ t('自产') }}：{{ data.result.selfProduceRatioFormat }}
          </el-text>
        </el-tooltip>
      </span>
      <span v-else>{{ `${t('收入')}：${Format.money(data.result.incomePH * (workMultiplier || 1))}` }} / h</span>
    </div>
  </el-card>
</template>

<style lang="scss" scoped>
.footer-wrapper {
  margin: 15px 0 0 15px;
}
.green {
  color: #67c23a;
}
.red {
  color: #f56c6c;
}
</style>
