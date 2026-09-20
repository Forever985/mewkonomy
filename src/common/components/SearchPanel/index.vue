<script lang="ts" setup>
import { useI18n } from "vue-i18n"
import { Delete, Plus } from "@element-plus/icons-vue"
import type { PanelField, PanelProjectOptions, PanelSearchData } from "./types"

/**
 * 通用「多变搜索」面板
 *
 * 由配置驱动渲染，替代各检索页里那份 80~100 行、相似度 91%~100% 的手写表单。
 * 页面只需给出 `fields` 配置与 `config.title`，并监听 @change。
 *
 * 注意：
 * - 组件直接操作传入的 searchData（增删 conditions/excludes 行、写各字段值），
 *   与原手写模板行为一致，不引入额外的响应式包装。
 * - 所有交互统一 emit("change")，页面照旧调自己的 handleSearchLD。
 */
const props = defineProps<{
  modelValue: PanelSearchData
  fields: PanelField[]
  /** 面板标题 */
  title?: string
}>()

const emit = defineEmits<{ change: [] }>()

const { t } = useI18n()

/** 标签 = 前缀 + t(label) + 后缀；在模板里求值才能跟随语言切换 */
function fieldLabel(field: { label: string, labelPrefix?: string, labelSuffix?: string }) {
  return `${field.labelPrefix ?? ""}${t(field.label)}${field.labelSuffix ?? ""}`
}

/** 求出可选项数组（支持传函数，便于用页面里已有的 computed） */
function resolveOptions(source: PanelProjectOptions | Array<{ label: string, value: string | number }> | (() => Array<{ label: string, value: string | number }>)): any[] {
  const raw = typeof source === "function" ? source() : source
  if (!Array.isArray(raw)) return []
  // 字符串数组统一转成 {label,value}；此时 label 走 t() 翻译
  return raw.map((o: any) => (typeof o === "string" ? { label: t(o), value: o, plain: true } : o))
}

/** 条件行：首列选项 */
function conditionStepOptions(field: Extract<PanelField, { type: "conditions" }>) {
  const n = field.stepsCount ?? 20
  return Array.from({ length: n }, (_, i) => i + 1)
}

function conditionStepLabel(field: Extract<PanelField, { type: "conditions" }>, n: number) {
  return field.stepLabel ? field.stepLabel(n) : `${t("目标等级")} ${n}`
}

function addCondition(condField: Extract<PanelField, { type: "conditions" }>) {
  const arr = props.modelValue.conditions ?? (props.modelValue.conditions = [])
  arr.push(
    condField.levelRange
      ? { steps: undefined, minLevel: undefined, maxLevel: undefined }
      : { steps: undefined, project: undefined }
  )
  emit("change")
}

function removeCondition(index: number) {
  props.modelValue.conditions?.splice(index, 1)
  emit("change")
}

function addExclude() {
  const arr = props.modelValue.excludes ?? (props.modelValue.excludes = [])
  arr.push({ name: undefined, project: undefined })
  emit("change")
}

function removeExclude(index: number) {
  props.modelValue.excludes?.splice(index, 1)
  emit("change")
}
</script>

<template>
  <el-form class="rank-card" :inline="true" :model="modelValue">
    <div v-if="title" class="title">
      {{ t(title) }}
    </div>

    <template v-for="(field, fi) in fields" :key="fi">
      <template v-if="!field.when || field.when()">
        <!-- 物品名多选（可自由输入） -->
        <el-form-item v-if="field.type === 'name'" prop="name" :label="fieldLabel(field)">
          <el-select
            v-model="(modelValue[field.key] as any)"
            multiple
            filterable
            allow-create
            default-first-option
            :reserve-keyword="false"
            :placeholder="t(field.placeholder || '输入多个物品名，回车添加')"
            :style="{ width: `${field.width || 220}px` }"
            clearable
            @change="emit('change')"
          />
        </el-form-item>

        <!-- 组合条件行 -->
        <el-form-item
          v-else-if="field.type === 'conditions'"
          :label="fieldLabel(field)"
          style="width:100%; margin-right:0;"
        >
          <div style="display:flex; flex-direction:column; gap:6px; width:100%;">
            <div
              v-for="(cond, i) in (modelValue.conditions || [])"
              :key="i"
              style="display:flex; align-items:center; gap:8px;"
            >
              <el-select
                v-model="cond.steps"
                :placeholder="t(field.stepsPlaceholder || '不限（默认全部）')"
                clearable
                style="width:130px"
                @change="emit('change')"
              >
                <el-option
                  v-for="n in conditionStepOptions(field)"
                  :key="n"
                  :label="conditionStepLabel(field, n)"
                  :value="n"
                />
              </el-select>

              <!-- 等级区间型（enhanceexp） -->
              <template v-if="field.levelRange">
                <el-input-number
                  v-model="cond.minLevel"
                  :min="field.levelRange.min"
                  :max="field.levelRange.max"
                  :controls="false"
                  clearable
                  style="width:60px"
                  :placeholder="field.levelRange.placeholderMin || '1'"
                  @change="emit('change')"
                />
                <span>~</span>
                <el-input-number
                  v-model="cond.maxLevel"
                  :min="field.levelRange.min"
                  :max="field.levelRange.max"
                  :controls="false"
                  clearable
                  style="width:60px"
                  :placeholder="field.levelRange.placeholderMax || '20'"
                  @change="emit('change')"
                />
              </template>

              <!-- 动作型 -->
              <el-select
                v-else
                v-model="cond.project"
                :placeholder="t(field.projectPlaceholder || '动作不限')"
                clearable
                style="width:130px"
                @change="emit('change')"
              >
                <el-option
                  v-for="p in resolveOptions(field.projectOptions)"
                  :key="p.value"
                  :label="p.label"
                  :value="p.value"
                />
              </el-select>

              <el-button
                v-if="(modelValue.conditions || []).length > (field.minRows ?? 1)"
                type="danger"
                :icon="Delete"
                link
                @click="removeCondition(i)"
              />
            </div>
            <div v-if="field.hint" style="color:#909399; font-size:12px;">
              {{ t(field.hint) }}
            </div>
            <el-button size="small" :icon="Plus" @click="addCondition(field)">
              {{ t('添加条件') }}
            </el-button>
          </div>
        </el-form-item>

        <!-- 排除行 -->
        <el-form-item
          v-else-if="field.type === 'excludes'"
          :label="fieldLabel(field)"
          style="width:100%; margin-right:0;"
        >
          <div style="display:flex; flex-direction:column; gap:6px; width:100%;">
            <div
              v-for="(ex, i) in (modelValue.excludes || [])"
              :key="i"
              style="display:flex; align-items:center; gap:8px;"
            >
              <el-select
                v-model="ex.name"
                filterable
                allow-create
                default-first-option
                :reserve-keyword="false"
                :placeholder="t(field.namePlaceholder || '排除的产品名')"
                clearable
                style="width:220px"
                @change="emit('change')"
              />
              <el-select
                v-model="ex.project"
                :placeholder="t(field.projectPlaceholder || '排除的生产动作，留空=该产品全部')"
                clearable
                style="width:280px"
                @change="emit('change')"
              >
                <el-option
                  v-for="p in resolveOptions(field.projectOptions)"
                  :key="p.value"
                  :label="p.label"
                  :value="p.value"
                />
              </el-select>
              <el-button
                v-if="(modelValue.excludes || []).length > (field.minRows ?? 1)"
                type="danger"
                :icon="Delete"
                link
                @click="removeExclude(i)"
              />
            </div>
            <el-button size="small" :icon="Plus" @click="addExclude">
              {{ t('添加排除') }}
            </el-button>
          </div>
        </el-form-item>

        <!-- 数值区间 -->
        <el-form-item v-else-if="field.type === 'range'" :label="fieldLabel(field)">
          <div style="display:flex; align-items:center; gap:4px;">
            <template v-if="field.minKey">
              <el-input-number
                v-model="(modelValue[field.minKey] as any)"
                :min="field.min"
                :max="field.max"
                :controls="false"
                clearable
                :style="{ width: `${field.width || 70}px` }"
                :placeholder="field.placeholderMin"
                @change="emit('change')"
              />
              <span v-if="field.unit">&nbsp;{{ field.unit }}</span>
            </template>
            <span v-if="field.minKey">{{ field.separator ?? '~' }}</span>
            <el-input-number
              v-model="(modelValue[field.maxKey] as any)"
              :min="field.min"
              :max="field.max"
              :controls="false"
              clearable
              :style="{ width: `${field.width || 70}px` }"
              :placeholder="field.placeholderMax"
              @change="emit('change')"
            />
            <span v-if="field.unit">&nbsp;{{ field.unit }}</span>
          </div>
        </el-form-item>

        <!-- 复选 -->
        <el-form-item v-else-if="field.type === 'checkbox'">
          <el-checkbox
            v-model="(modelValue[field.key] as any)"
            :disabled="field.disabled"
            @change="emit('change'); field.onChange?.()"
          >
            {{ fieldLabel(field) }}
          </el-checkbox>
        </el-form-item>

        <!-- 下拉 -->
        <el-form-item v-else-if="field.type === 'select'" :label="fieldLabel(field)">
          <el-select
            v-model="(modelValue[field.key] as any)"
            :style="{ width: `${field.width || 150}px` }"
            @change="emit('change')"
          >
            <el-option
              v-for="opt in resolveOptions(field.options)"
              :key="opt.value"
              :label="opt.plain ? opt.label : t(opt.label)"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>

        <!-- 排序优先级 -->
        <el-form-item v-else-if="field.type === 'sort'" :label="fieldLabel(field)">
          <SortPriority
            v-model="modelValue[field.key] as any"
            :fields="field.fields"
            :default-prop="field.defaultProp"
            @change="emit('change')"
          />
        </el-form-item>
      </template>
    </template>
  </el-form>
</template>

<!--
  非 scoped：.rank-card 原先由每个检索页在自己的 <style scoped> 里重复定义一份
  （decompose / junglest / junglest-inherit 三处一字不差）。现在表单由本组件渲染，
  页面级 scoped 样式无法作用到组件内部，所以把这份布局样式收敛到这里统一定义。
-->
<style lang="scss">
.rank-card {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;

  .title {
    width: 160px;
    margin-bottom: 12px;
  }
}
</style>
