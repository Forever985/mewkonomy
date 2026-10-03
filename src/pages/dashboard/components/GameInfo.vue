<script lang="ts" setup>
import { getMarketDataApi } from "@/common/apis/game"
import { DEFAULT_PRICE_FALLBACK } from "@/common/utils/price-fallback"
import { Setting } from "@element-plus/icons-vue"
import { useGameStore } from "@/pinia/stores/game"

const version = __APP_VERSION__
const { t } = useI18n()
const gameStore = useGameStore()

type Side = "ask" | "bid"

const settings = computed(() => gameStore.priceFallback)

/** 某一侧的兜底手段文案：借不借另一端 → 借不到时用什么 */
function describe(side: { cross: boolean, then: "none" | "shop" | "bigset" }) {
  const cross = side.cross ? t("借另一端") : t("不借另一端")
  const then = side.then === "bigset" ? t("大全套") : side.then === "shop" ? t("商店价") : t("不兜底")
  return `${cross} → ${then}`
}

const askText = computed(() => describe(settings.value.ask))
const bidText = computed(() => describe(settings.value.bid))

/** 一行摘要，让用户不展开也能知道当前策略 */
const summary = computed(() => {
  if (settings.value.forceBigSet) {
    return t("强制大全套")
  }
  return `${t("左价")} ${askText.value}；${t("右价")} ${bidText.value}`
})

/** 是否已偏离默认（偏离就给个提示，让人知道自己改过） */
const customized = computed(() => {
  const s = settings.value
  const d = DEFAULT_PRICE_FALLBACK
  return s.forceBigSet !== d.forceBigSet
    || s.ask.cross !== d.ask.cross
    || s.ask.then !== d.ask.then
    || s.bid.cross !== d.bid.cross
    || s.bid.then !== d.bid.then
})

function setCross(side: Side, value: boolean | string | number) {
  gameStore.setPriceFallbackSide(side, { cross: value === true })
}
function setThen(side: Side, value: unknown) {
  gameStore.setPriceFallbackSide(side, { then: value as "none" | "shop" | "bigset" })
}
function resetDefault() {
  gameStore.setPriceFallback({
    ask: { ...DEFAULT_PRICE_FALLBACK.ask },
    bid: { ...DEFAULT_PRICE_FALLBACK.bid },
    forceBigSet: false
  })
}

const THEN_OPTIONS = [
  { label: "不兜底（保持 -1）", value: "none" },
  { label: "商店价", value: "shop" },
  { label: "大全套（自产成本）", value: "bigset" }
] as const
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
    <span>{{ t('无市价兜底') }}:</span>
    <el-popover placement="bottom-start" :width="400" trigger="click">
      <template #reference>
        <el-button size="small" text class="price-fallback-trigger">
          {{ summary }}
          <el-icon class="price-fallback-icon"><Setting /></el-icon>
        </el-button>
      </template>

      <div class="pf">
        <div class="pf-tip">
          {{ t('市价缺失时（左价/右价各 -1）按下面的顺序找替代价。左右两侧完全独立，想让哪一侧兜底就单独设哪一侧。') }}
        </div>

        <div class="pf-side">
          <div class="pf-side-title">{{ t('左价（买入口径）') }}</div>
          <div class="pf-row">
            <span class="pf-label">{{ t('市价缺失时借用右价') }}</span>
            <el-switch :model-value="settings.ask.cross" size="small" @change="v => setCross('ask', v)" />
          </div>
          <div class="pf-row">
            <span class="pf-label">{{ t('仍无着落时') }}</span>
            <el-select :model-value="settings.ask.then" size="small" style="width: 160px" @change="v => setThen('ask', v)">
              <el-option v-for="o in THEN_OPTIONS" :key="o.value" :label="t(o.label)" :value="o.value" />
            </el-select>
          </div>
        </div>

        <div class="pf-side">
          <div class="pf-side-title">{{ t('右价（卖出口径）') }}</div>
          <div class="pf-row">
            <span class="pf-label">{{ t('市价缺失时借用左价') }}</span>
            <el-switch :model-value="settings.bid.cross" size="small" @change="v => setCross('bid', v)" />
          </div>
          <div class="pf-row">
            <span class="pf-label">{{ t('仍无着落时') }}</span>
            <el-select :model-value="settings.bid.then" size="small" style="width: 160px" @change="v => setThen('bid', v)">
              <el-option v-for="o in THEN_OPTIONS" :key="o.value" :label="t(o.label)" :value="o.value" />
            </el-select>
          </div>
        </div>

        <div class="pf-side">
          <div class="pf-row">
            <span class="pf-label">{{ t('忽略市价，一律按大全套（自产成本）算') }}</span>
            <el-switch
              :model-value="settings.forceBigSet"
              size="small"
              @change="v => gameStore.setPriceFallbackForceBigSet(v === true)"
            />
          </div>
        </div>

        <div class="pf-foot">
          <el-button size="small" text @click="resetDefault">
            {{ t('恢复默认') }}
          </el-button>
          <span class="pf-foot-note">
            {{ t('被兜底替代的价格会在物品旁标注来源，不会伪装成市场成交价。') }}
          </span>
        </div>
      </div>
    </el-popover>
    <el-tag v-if="customized" size="small" type="warning">
      {{ t("已自定义") }}
    </el-tag>
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
.price-fallback-trigger {
  padding: 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.price-fallback-icon {
  margin-left: 2px;
  vertical-align: -2px;
}
.pf {
  font-size: 13px;
}
.pf-tip {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
  margin-bottom: 8px;
}
.pf-side {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 8px 10px;
  margin-bottom: 8px;
}
.pf-side-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.pf-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 30px;
}
.pf-label {
  color: var(--el-text-color-regular);
}
.pf-foot {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pf-foot-note {
  color: var(--el-text-color-placeholder);
  font-size: 11px;
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

    &:hover {
      opacity: 0.8;
    }
  }
}
</style>
