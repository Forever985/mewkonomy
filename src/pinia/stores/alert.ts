import type { AlertDefaultThresholds, AlertRule } from "@/common/apis/marketvolume/alerts"
import { DEFAULT_ALERT_COOLDOWN_MINUTES, DEFAULT_ALERT_THRESHOLDS, createPresetRules, newAlertRuleId } from "@/common/apis/marketvolume/alerts"
import { pinia } from "@/pinia"
import { defineStore } from "pinia"

/**
 * 市场监控「提醒」配置。
 *
 * 为什么单独一个 store，而不是塞进 `layoutsConfig`：
 * `layoutsConfig` 的语义是**布局**配置（侧边栏/标签栏/水印…），而提醒配置是业务数据
 * （规则列表、阈值），塞进去会让「重置布局配置」顺手把用户的提醒规则清掉。
 * 这里独立持久化，设置面板只负责渲染开关并把改动写回来。
 *
 * 持久化 key 与结构都带版本号，旧数据缺字段时按默认值补齐（不做一次性迁移脚本）。
 */

const STORAGE_KEY = "market-alert-config"
const CONFIG_VERSION = 1

export interface AlertConfig {
  version: number
  /** 页面内提醒：命中行高亮 + 顶部横幅 */
  inPageEnabled: boolean
  /** 浏览器通知（需要用户授权；授权失败不影响页面内提醒） */
  notifyEnabled: boolean
  /** 同一条规则对同一物品的浏览器通知冷却（分钟） */
  cooldownMinutes: number
  /** 设置面板里的默认阈值，同时是「新增规则」时的预填值 */
  thresholds: AlertDefaultThresholds
  rules: AlertRule[]
}

function defaultConfig(): AlertConfig {
  const thresholds = { ...DEFAULT_ALERT_THRESHOLDS }
  return {
    version: CONFIG_VERSION,
    inPageEnabled: true,
    // 浏览器通知默认关闭：需要授权，且默认开启容易在首次使用时就弹一堆
    notifyEnabled: false,
    cooldownMinutes: DEFAULT_ALERT_COOLDOWN_MINUTES,
    thresholds,
    rules: createPresetRules(thresholds)
  }
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

/** 把任意来源的数据规整成合法配置（缺字段补默认，坏字段丢弃） */
function normalizeRules(input: unknown): AlertRule[] | null {
  if (!Array.isArray(input)) {
    return null
  }
  const rules: AlertRule[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== "object") {
      continue
    }
    const r = raw as Partial<AlertRule>
    if (r.scopeType !== "all" && r.scopeType !== "category" && r.scopeType !== "item") {
      continue
    }
    rules.push({
      id: typeof r.id === "string" && r.id ? r.id : newAlertRuleId(),
      enabled: r.enabled !== false,
      priority: toFiniteNumber(r.priority, 100),
      label: typeof r.label === "string" ? r.label : undefined,
      scopeType: r.scopeType,
      scopeValue: typeof r.scopeValue === "string" ? r.scopeValue : undefined,
      metric: (r.metric ?? "volumeRate") as AlertRule["metric"],
      operator: r.operator === "lte" ? "lte" : "gte",
      judge: r.judge === "relative" ? "relative" : "absolute",
      threshold: typeof r.threshold === "number" ? r.threshold : undefined,
      relativeMode: r.relativeMode,
      relativeValue: typeof r.relativeValue === "number" ? r.relativeValue : undefined,
      onlyActive: r.onlyActive !== false,
      cooldownMinutes: toFiniteNumber(r.cooldownMinutes, DEFAULT_ALERT_COOLDOWN_MINUTES)
    })
  }
  // 空数组说明用户确实把规则都删了，此时尊重用户选择，不强行灌回预置规则
  return rules
}

function normalizeConfig(input: unknown): AlertConfig {
  const fallback = defaultConfig()
  if (!input || typeof input !== "object") {
    return fallback
  }
  const raw = input as Partial<AlertConfig>
  const thresholds: AlertDefaultThresholds = {
    changePct: toFiniteNumber(raw.thresholds?.changePct, fallback.thresholds.changePct),
    volumeRate: toFiniteNumber(raw.thresholds?.volumeRate, fallback.thresholds.volumeRate),
    turnover: toFiniteNumber(raw.thresholds?.turnover, fallback.thresholds.turnover)
  }
  const rules = normalizeRules(raw.rules)
  return {
    version: CONFIG_VERSION,
    inPageEnabled: raw.inPageEnabled !== false,
    notifyEnabled: raw.notifyEnabled === true,
    cooldownMinutes: toFiniteNumber(raw.cooldownMinutes, fallback.cooldownMinutes),
    thresholds,
    // 从未配置过（没有 rules 字段）时才给预置规则；显式存了空数组就保持为空
    rules: rules ?? createPresetRules(thresholds)
  }
}

function loadConfig(): AlertConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return normalizeConfig(raw ? JSON.parse(raw) : null)
  } catch {
    return defaultConfig()
  }
}

function saveConfig(config: AlertConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch (e) {
    console.error("市场提醒配置保存失败:", e)
  }
}

export const useAlertStore = defineStore("alert", () => {
  const initial = loadConfig()

  const inPageEnabled = ref(initial.inPageEnabled)
  const notifyEnabled = ref(initial.notifyEnabled)
  const cooldownMinutes = ref(initial.cooldownMinutes)
  const thresholds = ref<AlertDefaultThresholds>({ ...initial.thresholds })
  const rules = ref<AlertRule[]>(initial.rules)

  /** 汇总为可持久化的结构 */
  function snapshot(): AlertConfig {
    return {
      version: CONFIG_VERSION,
      inPageEnabled: inPageEnabled.value,
      notifyEnabled: notifyEnabled.value,
      cooldownMinutes: cooldownMinutes.value,
      thresholds: { ...thresholds.value },
      rules: rules.value
    }
  }

  // 任何一处改动都整体落盘：结构小（几条规则），不必做字段级 diff
  watch([inPageEnabled, notifyEnabled, cooldownMinutes, thresholds, rules], () => saveConfig(snapshot()), { deep: true })

  function addRule(rule: AlertRule) {
    rules.value.push(rule)
  }

  function removeRule(id: string) {
    rules.value = rules.value.filter(r => r.id !== id)
  }

  /** 把默认阈值重新灌成一组预置规则（会**替换**现有规则，调用前需二次确认） */
  function resetRulesFromThresholds() {
    rules.value = createPresetRules(thresholds.value)
  }

  function resetAll() {
    const next = defaultConfig()
    inPageEnabled.value = next.inPageEnabled
    notifyEnabled.value = next.notifyEnabled
    cooldownMinutes.value = next.cooldownMinutes
    thresholds.value = { ...next.thresholds }
    rules.value = next.rules
  }

  return {
    inPageEnabled,
    notifyEnabled,
    cooldownMinutes,
    thresholds,
    rules,
    addRule,
    removeRule,
    resetRulesFromThresholds,
    resetAll
  }
})

/** 组件外直连（与项目其它 store 保持一致的写法） */
export function useAlertStoreOutside() {
  return useAlertStore(pinia)
}
