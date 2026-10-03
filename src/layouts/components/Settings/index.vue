<script lang="ts" setup>
import { useAlertStore } from "@/pinia/stores/alert"
import { useMarketFilterStore } from "@/pinia/stores/marketfilter"
import { useSettingsStore } from "@/pinia/stores/settings"
import { useLayoutMode } from "@@/composables/useLayoutMode"
import { removeLayoutsConfig } from "@@/utils/cache/local-storage"
import { Refresh } from "@element-plus/icons-vue"
// ElMessage 走自动导入，ElMessageBox 不在自动导入清单里，需显式引入
import { ElMessageBox } from "element-plus"
import SelectLayoutMode from "./SelectLayoutMode.vue"

const { isLeft } = useLayoutMode()

const settingsStore = useSettingsStore()

// 使用 storeToRefs 将提取的属性保持其响应性
const {
  showTagsView,
  showLogo,
  fixedHeader,
  showFooter,
  showThemeSwitch,
  showScreenfull,
  cacheTagsView,
  showWatermark,
  showGreyMode,
  showColorWeakness
} = storeToRefs(settingsStore)

const { t } = useI18n()
/** 定义 switch 设置项 */
const switchSettings = {
  [t("显示标签栏")]: showTagsView,
  [t("显示 Logo")]: showLogo,
  [t("固定 Header")]: fixedHeader,
  [t("显示页脚")]: showFooter,
  // [t("显示消息通知")]: showNotify,
  [t("显示切换主题按钮")]: showThemeSwitch,
  [t("显示全屏按钮")]: showScreenfull,
  // [t("显示搜索按钮")]: showSearchMenu,
  [t("是否缓存标签栏")]: cacheTagsView,
  [t("开启系统水印")]: showWatermark,
  [t("显示灰色模式")]: showGreyMode,
  [t("显示色弱模式")]: showColorWeakness
}

// 非左侧模式时，Header 都是 fixed 布局
watchEffect(() => {
  !isLeft.value && (fixedHeader.value = true)
})

/** 重置项目配置 */
function resetLayoutsConfig() {
  removeLayoutsConfig()
  location.reload()
}

/**
 * 市场监控提醒配置。
 *
 * 这里只放**全局层面**的东西（两个通道的开关、冷却、默认阈值）；
 * 具体的多条规则属于业务数据，放在「市场监控」页的规则面板里配置。
 */
const alertStore = useAlertStore()
const { inPageEnabled, notifyEnabled, cooldownMinutes, thresholds } = storeToRefs(alertStore)

/**
 * 浏览器通知需要授权。被拒绝或浏览器不支持时把开关拨回去，
 * 否则会出现「开关开着、其实永远收不到」的假象。
 * 参数类型跟随 el-switch 的 change 事件（string | number | boolean）。
 */
async function handleNotifyToggle(value: string | number | boolean) {
  if (value !== true) {
    return
  }
  if (typeof Notification === "undefined") {
    notifyEnabled.value = false
    ElMessage.warning(t("当前浏览器不支持系统通知"))
    return
  }
  if (Notification.permission === "granted") {
    return
  }
  const permission = await Notification.requestPermission()
  if (permission !== "granted") {
    notifyEnabled.value = false
    ElMessage.warning(t("未获得系统通知权限，浏览器通知已关闭"))
  }
}

/** 按默认阈值重建预置规则（会替换现有规则，需二次确认） */
function handleResetAlertRules() {
  ElMessageBox.confirm(t("这会用默认阈值重建预置规则，并替换现有的全部提醒规则，确定继续？"), t("重建预置规则"), {
    confirmButtonText: t("确定"),
    cancelButtonText: t("取消"),
    closeOnClickModal: true
  }).then(() => {
    alertStore.resetRulesFromThresholds()
    ElMessage.success(t("已按默认阈值重建预置规则"))
  }).catch(() => {})
}

/**
 * 市场监控的显示过滤。
 *
 * 与上面的提醒配置分开一个 store：提醒是「什么时候通知我」，这里是「列表显示什么」，
 * 语义无关。市场监控页的开关读写的是**同一份状态**，所以哪边改都会立刻同步。
 */
const marketFilterStore = useMarketFilterStore()
const { hideLowVolume, minVolume } = storeToRefs(marketFilterStore)
</script>

<template>
  <div class="setting-container">
    <h4>{{ t('布局配置') }}</h4>
    <SelectLayoutMode />
    <el-divider />
    <h4>{{ t('功能配置') }}</h4>
    <div v-for="(settingValue, settingName, index) in switchSettings" :key="index" class="setting-item">
      <span class="setting-name">{{ settingName }}</span>
      <el-switch v-model="settingValue.value" :disabled="!isLeft && settingName === '固定 Header'" />
    </div>
    <el-divider />
    <h4>{{ t('市场监控') }}</h4>
    <div class="setting-item">
      <span class="setting-name">{{ t('隐藏小成交量') }}</span>
      <el-switch v-model="hideLowVolume" />
    </div>
    <div class="setting-item setting-item--stack">
      <span class="setting-name">{{ t('最小成交量(件)') }}</span>
      <el-input-number v-model="minVolume" class="setting-number" :min="0" :step="50" size="small" controls-position="right" />
    </div>
    <div class="setting-hint">
      {{ t('打开后，市场监控页会隐藏成交量低于该值的物品。成交量口径与表格列一致（时间窗内成交量）；要按区间手筛请到该页的「区间筛选」。') }}
    </div>
    <el-divider />
    <h4>{{ t('市场提醒') }}</h4>
    <div class="setting-item">
      <span class="setting-name">{{ t('页面内提醒') }}</span>
      <el-switch v-model="inPageEnabled" />
    </div>
    <div class="setting-item">
      <span class="setting-name">{{ t('浏览器通知') }}</span>
      <el-switch v-model="notifyEnabled" @change="handleNotifyToggle" />
    </div>
    <!-- 数值项纵向排布：抽屉只有 300px 宽，横排会把标签截断 -->
    <div class="setting-item setting-item--stack">
      <span class="setting-name">{{ t('通知冷却(分钟)') }}</span>
      <el-input-number v-model="cooldownMinutes" class="setting-number" :min="0" :max="1440" :step="5" size="small" controls-position="right" />
    </div>
    <div class="setting-item setting-item--stack">
      <span class="setting-name">{{ t('涨跌幅阈值(%)') }}</span>
      <el-input-number v-model="thresholds.changePct" class="setting-number" :min="0" :step="5" size="small" controls-position="right" />
    </div>
    <div class="setting-item setting-item--stack">
      <span class="setting-name">{{ t('成交量速率阈值(件/小时)') }}</span>
      <el-input-number v-model="thresholds.volumeRate" class="setting-number" :min="0" :step="100" size="small" controls-position="right" />
    </div>
    <div class="setting-item setting-item--stack">
      <span class="setting-name">{{ t('成交额阈值(金币)') }}</span>
      <el-input-number v-model="thresholds.turnover" class="setting-number" :min="0" :step="1000000" size="small" controls-position="right" />
    </div>
    <div class="setting-hint">
      {{ t('以上阈值只用于「重建预置规则」；要按物品/分类分别设条件，请到「市场监控」页配置多条规则') }}
    </div>
    <el-button size="small" @click="handleResetAlertRules">
      {{ t('按默认阈值重建预置规则') }}
    </el-button>
    <el-button type="danger" :icon="Refresh" @click="resetLayoutsConfig">
      {{ t('重置') }}
    </el-button>
  </div>
</template>

<style lang="scss" scoped>
@import "@@/assets/styles/mixins.scss";

.setting-container {
  padding: 20px;
  .setting-item {
    font-size: 14px;
    color: var(--el-text-color-regular);
    padding: 5px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    .setting-name {
      @extend %ellipsis;
    }
  }
  .el-button {
    margin-top: 40px;
    width: 100%;
  }
  // 市场提醒分组：数值项纵向排布（抽屉仅 300px 宽）
  .setting-item--stack {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    .setting-name {
      overflow: visible;
      text-overflow: clip;
      white-space: normal;
    }
  }
  .setting-number {
    width: 100%;
  }
  .setting-hint {
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
    padding: 6px 0 0;
  }
}
</style>
