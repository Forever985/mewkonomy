<script setup lang="ts">
import type Calculator from "@/calculator"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import * as Format from "@@/utils/format"
import { getItemDetailOf, getPriceOf, getPriceSourceOf, type PriceSource } from "@/common/apis/game"
import { getManualPriceOf, setPriceApi } from "@/common/apis/price"
import { COIN_HRID } from "@/pinia/stores/game"

/** 编辑弹窗内市价来源标注（原料=ask 端，产品=bid 端） */
function sourceOf(row: { hrid: string; level?: number }, type: "ask" | "bid"): PriceSource | undefined {
  if (row.hrid === COIN_HRID) {
    return undefined
  }
  return getPriceSourceOf(row.hrid, row.level || 0, type)
}
function sourceLabel(s?: PriceSource) {
  switch (s) {
    case "selfcraft": return "自产"
    case "shop": return "商店"
    case "none": return "无价"
    default: return ""
  }
}
function sourceTip(s?: PriceSource) {
  switch (s) {
    case "selfcraft": return "市场无价，按大全套自产成本估值（非真实成交价）"
    case "shop": return "市场无价，按商店价格兜底（非真实成交价）"
    case "none": return "无价（-1），暂无法定价"
    default: return ""
  }
}
function sourceTagType(s?: PriceSource) {
  switch (s) {
    case "selfcraft": return "warning"
    case "shop": return "info"
    case "none": return "danger"
    default: return "info"
  }
}

const props = defineProps<{
  modelValue: boolean
  data?: Calculator
}>()

const emit = defineEmits(["update:modelValue"])
const visible: Ref<boolean> = computed({
  get() {
    return props.modelValue
  },
  set(val) {
    emit("update:modelValue", val)
  }
})

const currentProductPriceConfigList = ref<Calculator["productPriceConfigList"]>([])
const currentIngredientPriceConfigList = ref<Calculator["ingredientPriceConfigList"]>([])

watch(() => props.data, (row) => {
  currentIngredientPriceConfigList.value = []
  currentProductPriceConfigList.value = []
  if (row) {
    currentIngredientPriceConfigList.value = getPriceConfigList(row, "ingredient")
    currentProductPriceConfigList.value = getPriceConfigList(row, "product")
  }
}, { immediate: true })

function getPriceConfigList(row: Calculator, type: "product" | "ingredient") {
  return row[`${type}ListWithPrice`].map((item, i) => {
    const priceConfig = row[`${type}PriceConfigList`][i]
    const hasManualPrice = getManualPriceOf(item.hrid, item.level)?.[type === "ingredient" ? "ask" : "bid"]?.manual
    const manualPrice = getManualPriceOf(item.hrid, item.level)?.[type === "ingredient" ? "ask" : "bid"]?.manualPrice
    const price = priceConfig?.immutable ? priceConfig.price! : hasManualPrice ? manualPrice! : item.marketPrice
    return {
      hrid: item.hrid,
      level: item.level,
      price,
      manual: priceConfig?.manual || hasManualPrice || false,
      immutable: priceConfig?.immutable
    }
  })
}

function onConfirm() {
  try {
    setPriceApi(props.data!, currentIngredientPriceConfigList.value, currentProductPriceConfigList.value)
    visible.value = false
  } catch (e: any) {
    ElMessage.error(e.message)
  }
}
const { t } = useI18n()
</script>

<template>
  <el-dialog v-model="visible" :show-close="false" width="80%">
    <el-row :gutter="20">
      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="12">
        <el-card>
          <el-table :data="currentIngredientPriceConfigList">
            <el-table-column width="54">
              <template #default="{ row }">
                <ItemIcon :hrid="row.hrid" />
              </template>
            </el-table-column>
            <el-table-column :label="t('物品')">
              <template #default="{ row }">
                {{ t(getItemDetailOf(row.hrid).name) }}
                {{ row.level ? `+${row.level}` : '' }}
              </template>
            </el-table-column>
            <el-table-column prop="price" :label="t('市场价格')">
              <template #default="{ row }">
                <div v-if="row.hrid === COIN_HRID">
                  {{ Format.price(row.price) }}
                </div>
                <div v-else>
                  {{ Format.price(getPriceOf(row.hrid, row.level).ask) }} / {{ Format.price(getPriceOf(row.hrid, row.level).bid) }}
                  <el-tooltip v-if="sourceOf(row, 'ask')" :content="sourceTip(sourceOf(row, 'ask'))" placement="top">
                    <el-tag size="small" style="margin-left:4px" :type="sourceTagType(sourceOf(row, 'ask'))">
                      {{ sourceLabel(sourceOf(row, 'ask')) }}
                    </el-tag>
                  </el-tooltip>
                </div>
              </template>
            </el-table-column>

            <el-table-column :label="t('自定义价格')">
              <template #default="{ row }">
                <el-checkbox style="margin-right: 10px;" v-show="row.hrid !== COIN_HRID" v-model="row.manual" />
                <el-input-number v-show="row.manual" v-model="row.price" :controls="false" />
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="24" :md="24" :lg="24" :xl="12">
        <el-card>
          <el-table :data="currentProductPriceConfigList">
            <el-table-column prop="name" width="54">
              <template #default="{ row }">
                <ItemIcon :hrid="row.hrid" />
              </template>
            </el-table-column>
            <el-table-column prop="name" :label="t('物品')">
              <template #default="{ row }">
                {{ t(getItemDetailOf(row.hrid).name) }}
                {{ row.level ? `+${row.level}` : '' }}
              </template>
            </el-table-column>
            <el-table-column prop="price" :label="t('市场价格')">
              <template #default="{ row }">
                <div v-if="row.hrid === COIN_HRID">
                  {{ Format.price(row.price) }}
                </div>
                <div v-else>
                  {{ Format.price(getPriceOf(row.hrid, row.level).ask) }} / {{ Format.price(getPriceOf(row.hrid, row.level).bid) }}
                  <el-tooltip v-if="sourceOf(row, 'bid')" :content="sourceTip(sourceOf(row, 'bid'))" placement="top">
                    <el-tag size="small" style="margin-left:4px" :type="sourceTagType(sourceOf(row, 'bid'))">
                      {{ sourceLabel(sourceOf(row, 'bid')) }}
                    </el-tag>
                  </el-tooltip>
                </div>
              </template>
            </el-table-column>
            <el-table-column :label="t('自定义价格')">
              <template #default="{ row }">
                <el-checkbox style="margin-right: 10px;" v-show="row.hrid !== COIN_HRID" v-model="row.manual" />
                <el-input-number v-show="row.manual" v-model="row.price" :controls="false" />
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
    <template #footer>
      <div style="text-align: center;">
        <el-button type="primary" @click="onConfirm">
          {{ t('保存') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style lang="scss" scoped>

</style>
