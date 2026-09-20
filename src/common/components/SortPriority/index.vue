<script lang="ts" setup>
import type { Sort } from "element-plus"
import { ArrowDown, ArrowUp, Delete, Plus, Sort as SortIcon } from "@element-plus/icons-vue"

/**
 * 排序优先级规则
 *
 * 排序列表的第 0 项是**第一优先级**，其值是分组依据；第 1 项在第一优先级取值相同的结果内部生效，
 * 以此类推。例：`[利润率↓, 利润/h↓]` = 先按利润率把方案分组，组内再按时薪从高到低排。
 * 这与 Element Plus 表头点击（单列排序）等价于「只有一条规则」。
 */
export interface SortRule {
  /** Calculator 上的取值路径，如 `result.profitPH`、`actionLevel` */
  prop: string
  order: "ascending" | "descending"
}

export interface SortField {
  prop: string
  label: string
  /** 是否按显示值（格式化后的字符串/百分比）排序，默认按原始数值 */
  formatted?: boolean
}

const props = withDefaults(defineProps<{
  /** 排序规则（v-model），第一项为主优先级 */
  modelValue: SortRule[]
  /** 本页可选的排序字段 */
  fields: SortField[]
  /** 规则为空时的默认排序字段（用于文案提示） */
  defaultProp?: string
}>(), {
  defaultProp: "result.profitPH"
})

const emit = defineEmits<{
  (e: "update:modelValue", value: SortRule[]): void
  /** 规则变化后触发（父页面据此重新查询） */
  (e: "change"): void
}>()

const { t } = useI18n()

const rules = computed(() => props.modelValue ?? [])

function fieldLabel(prop: string) {
  return props.fields.find(f => f.prop === prop)?.label ?? prop
}

/** 当前排序摘要（面板标题与触发按钮上显示） */
const summary = computed(() => {
  if (!rules.value.length) {
    return `${t("默认排序")}：${t(fieldLabel(props.defaultProp))}${t("降序")}`
  }
  const desc = (r: SortRule) => `${t(fieldLabel(r.prop))}${r.order === "descending" ? "↓" : "↑"}`
  const [first, ...rest] = rules.value
  // 把「第一优先级 = 分组依据，其余 = 组内排序」这层语义直白讲出来
  return `${t("先按")} ${desc(first)} ${t("分组")}${rest.length ? `，${t("组内再按")} ${rest.map(desc).join(" → ")}` : ""}`
})

function commit(next: SortRule[]) {
  emit("update:modelValue", next)
  emit("change")
}

function addRule() {
  // 默认追加「利润率」这类次要指标：优先挑一个还没用过的字段
  const used = new Set(rules.value.map(r => r.prop))
  const candidate = props.fields.find(f => !used.has(f.prop)) ?? props.fields[0]
  if (!candidate) {
    return
  }
  commit([...rules.value, { prop: candidate.prop, order: "descending" }])
}

function removeRule(index: number) {
  const next = [...rules.value]
  next.splice(index, 1)
  commit(next)
}

function moveRule(index: number, dir: -1 | 1) {
  const target = index + dir
  if (target < 0 || target >= rules.value.length) {
    return
  }
  const next = [...rules.value]
  ;[next[index], next[target]] = [next[target], next[index]]
  commit(next)
}

function changeProp(index: number, prop: string) {
  const next = rules.value.map((r, i) => (i === index ? { ...r, prop } : r))
  commit(next)
}

function toggleOrder(index: number) {
  const next = rules.value.map((r, i) =>
    i === index ? { ...r, order: r.order === "descending" ? "ascending" : "descending" as SortRule["order"] } : r
  )
  commit(next)
}

function clearRules() {
  commit([])
}

/**
 * 把 Element Plus 表头点击结果并入优先级列表。
 * 规则：单列排序（清空排序）→ 整体替换并清空优先级；多列排序 → 点击的列插到最前成为新的主优先级。
 */
function applyHeaderSort(sort: Sort): SortRule[] {
  if (!sort || !sort.prop || !sort.order) {
    const next: SortRule[] = []
    emit("update:modelValue", next)
    return next
  }
  const rule: SortRule = { prop: sort.prop, order: sort.order as SortRule["order"] }
  const rest = rules.value.filter(r => r.prop !== rule.prop)
  const next = [rule, ...rest]
  emit("update:modelValue", next)
  return next
}

defineExpose({ applyHeaderSort })
</script>

<template>
  <el-popover placement="bottom-start" :width="380" trigger="click">
    <template #reference>
      <el-button :icon="SortIcon" :type="rules.length ? 'primary' : 'default'" plain>
        {{ t("排序优先级") }}<template v-if="rules.length">：{{ rules.length }}</template>
      </el-button>
    </template>

    <div class="sort-priority">
      <div class="sort-priority-tip">
        {{ t("第一优先级用于分组，其余优先级在同一组内继续排序") }}
      </div>

      <div v-if="!rules.length" class="sort-priority-empty">
        {{ t("默认排序") }}：{{ t(fieldLabel(defaultProp)) }}
      </div>

      <div v-else class="sort-priority-list">
        <div v-for="(rule, i) in rules" :key="`${rule.prop}-${i}`" class="sort-priority-row">
          <span class="sort-priority-rank">{{ i + 1 }}</span>
          <el-select :model-value="rule.prop" size="small" style="width:150px" @change="(v: string) => changeProp(i, v)">
            <el-option v-for="f in fields" :key="f.prop" :label="t(f.label)" :value="f.prop" />
          </el-select>
          <el-button size="small" text @click="toggleOrder(i)">
            {{ rule.order === "descending" ? t("降序") : t("升序") }}
          </el-button>
          <el-button-group>
            <el-button size="small" :icon="ArrowUp" :disabled="i === 0" @click="moveRule(i, -1)" />
            <el-button size="small" :icon="ArrowDown" :disabled="i === rules.length - 1" @click="moveRule(i, 1)" />
          </el-button-group>
          <el-button size="small" type="danger" text :icon="Delete" @click="removeRule(i)" />
        </div>
      </div>

      <div class="sort-priority-actions">
        <el-button size="small" :icon="Plus" :disabled="rules.length >= fields.length" @click="addRule">
          {{ t("添加优先级") }}
        </el-button>
        <el-button size="small" :disabled="!rules.length" @click="clearRules">
          {{ t("恢复默认排序") }}
        </el-button>
      </div>

      <div class="sort-priority-summary">
        {{ summary }}
      </div>
    </div>
  </el-popover>
</template>

<style lang="scss" scoped>
.sort-priority {
  display: flex;
  flex-direction: column;
  gap: 8px;

  .sort-priority-tip {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    line-height: 1.5;
  }

  .sort-priority-empty {
    font-size: 13px;
    color: var(--el-text-color-secondary);
    padding: 6px 0;
  }

  .sort-priority-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sort-priority-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .sort-priority-rank {
    width: 18px;
    height: 18px;
    flex: none;
    border-radius: 50%;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 12px;
    line-height: 18px;
    text-align: center;
  }

  .sort-priority-actions {
    display: flex;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid var(--el-border-color-lighter);
  }

  .sort-priority-summary {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    word-break: break-all;
  }
}
</style>
