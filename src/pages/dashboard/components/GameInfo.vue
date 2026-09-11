<script lang="ts" setup>
import { getMarketDataApi } from "@/common/apis/game"
import { useGameStore } from "@/pinia/stores/game"

const version = __APP_VERSION__
const { t } = useI18n()
const gameStore = useGameStore()
</script>

<template>
  <div> {{ t('MewKonomy') }} v{{ version }}</div>
  <div
    :class="{
      error: getMarketDataApi()?.timestamp * 1000 < Date.now() - 1000 * 60 * 120,
      success: getMarketDataApi()?.timestamp * 1000 > Date.now() - 1000 * 60 * 120,
    }"
  >
    <a href="https://www.milkywayidle.com/game_data/marketplace.json" target="_blank" rel="noopener noreferrer">{{ t('市场数据来源(MilkyWayIdle)') }} : {{ new Date(useGameStore().marketData?.timestamp! * 1000).toLocaleString() }}</a>
  </div>
  <div class="price-fallback-row">
    <span>{{ t('无市价兜底模式') }}:</span>
    <el-tooltip placement="top">
      <template #content>
        <span>
          {{ t('方案A：物品无市价（-1）时直接显示 -1，保持原样。') }}
          <br />
          {{ t('方案B：物品无市价（-1）时使用该物品的 sellPrice 作为参考价展示。') }}
        </span>
      </template>
      <el-select :model-value="gameStore.priceFallbackMode" style="width: 170px" @change="(value) => gameStore.setPriceFallbackMode(value)">
        <el-option label="A - 显示 -1（不兜底）" value="A" />
        <el-option label="B - 使用 sellPrice 兜底" value="B" />
      </el-select>
    </el-tooltip>
  </div>
</template>

<style lang="scss" scoped>
.price-fallback-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 13px;
}
.error {
  color: #f56c6c;

  a {
    color: inherit;
    // text-decoration: underline;

    &:hover {
      opacity: 0.8;
    }
  }
}
.success {
  color: #67c23a;

  a {
    color: inherit;
    // text-decoration: underline;

    &:hover {
      opacity: 0.8;
    }
  }
}
</style>
