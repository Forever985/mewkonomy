<script lang="ts" setup>
import type { ChainStep } from "@/common/apis/chainbuilder"
import { calcChainProfitApi, getChainAlchemyOutputOptions, getChainProjectOptions, getChainStepItemOptions, isAlchemyKind } from "@/common/apis/chainbuilder"
import type Calculator from "@/calculator"
import type { WorkflowCalculator } from "@/calculator/workflow"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import * as Format from "@@/utils/format"
import { ArrowDown, ArrowUp, Delete, MagicStick, Plus } from "@element-plus/icons-vue"
import { useI18n } from "vue-i18n"
import ActionDetail from "../dashboard/components/ActionDetail.vue"
import GameInfo from "../dashboard/components/GameInfo.vue"

const { t } = useI18n()

const projectOptions = getChainProjectOptions()

const steps = ref<ChainStep[]>([
  { project: "", action: "milking", kind: "gather", hrid: "", catalystRank: 0 }
])
const chainName = ref("")
const loading = ref(false)
const result = ref<WorkflowCalculator | null>(null)

function addStep() {
  steps.value.push({ project: "", action: "milking", kind: "gather", hrid: "", catalystRank: 0 })
}
function removeStep(index: number) {
  steps.value.splice(index, 1)
}
function moveStep(index: number, dir: -1 | 1) {
  const target = index + dir
  if (target < 0 || target >= steps.value.length) return
  const arr = steps.value
  ;[arr[index], arr[target]] = [arr[target], arr[index]]
}
function onProjectChange(index: number) {
  const opt = projectOptions.find(o => o.label === steps.value[index].project)
  if (!opt) return
  const step = steps.value[index]
  step.kind = opt.kind
  step.action = opt.action
  step.hrid = ""
  step.catalystRank = 0
  step.outHrid = ""
  result.value = null
}
function itemOptions(step: ChainStep) {
  return step.project ? getChainStepItemOptions(step) : []
}
function alchemyOutputs(step: ChainStep) {
  return getChainAlchemyOutputOptions(step)
}
function catalystLabel(rank: number) {
  if (rank === 1) return t("普通催化剂")
  if (rank === 2) return t("主要催化剂")
  return t("无")
}

function calculate() {
  if (!steps.value.length || steps.value.some(s => !s.hrid)) {
    ElMessage.warning(t("请选择物品"))
    return
  }
  loading.value = true
  try {
    const wf = calcChainProfitApi(steps.value, chainName.value || t("手动产业链"))
    result.value = wf
    if (!wf) {
      ElMessage.warning(t("存在不可用的环节，请检查选择"))
    }
  } catch (e: any) {
    console.error(e)
    ElMessage.error(t("计算失败") + (e?.message ? `: ${e.message}` : ""))
  } finally {
    loading.value = false
  }
}

// 详情弹窗
const detailVisible = ref(false)
const detailData = ref<Calculator>()
function showDetail(row: Calculator) {
  detailData.value = row
  detailVisible.value = true
}
</script>

<template>
  <div>
    <GameInfo />
    <el-card>
      <template #header>
        <div class="flex items-center gap-2">
          <span>{{ t("手动产业链") }}</span>
          <span class="text-sm text-gray-400">{{ t("项目+动作逐节点缀连，自动内部流转并整链核算") }}</span>
        </div>
      </template>

      <!-- 环节编辑 -->
      <div class="chain-steps">
        <div v-for="(step, index) in steps" :key="index" class="chain-step">
          <div class="chain-step-no">{{ t("环节") }} {{ index + 1 }}</div>
          <el-select
            :model-value="step.project"
            :placeholder="t('项目')"
            style="width: 110px"
            @update:model-value="step.project = $event; onProjectChange(index)"
          >
            <el-option v-for="p in projectOptions" :key="p.label" :label="p.label" :value="p.label" />
          </el-select>
          <el-select
            v-model="step.hrid"
            filterable
            :disabled="!step.project"
            :placeholder="t('物品')"
            style="flex: 1"
            @change="step.outHrid = ''"
          >
            <el-option v-for="opt in itemOptions(step)" :key="opt.hrid" :label="t(opt.name)" :value="opt.hrid" />
          </el-select>
          <el-select v-if="isAlchemyKind(step.kind)" v-model="step.catalystRank" style="width: 120px">
            <el-option v-for="r in [0, 1, 2]" :key="r" :label="catalystLabel(r)" :value="r" />
          </el-select>
          <el-select
            v-if="isAlchemyKind(step.kind) && index < steps.length - 1"
            v-model="step.outHrid"
            filterable
            :disabled="!step.hrid"
            :placeholder="t('衔接产物')"
            style="width: 180px"
          >
            <el-option v-for="opt in alchemyOutputs(step)" :key="opt.hrid" :label="t(opt.name)" :value="opt.hrid" />
          </el-select>
          <el-button-group>
            <el-button :icon="ArrowUp" :disabled="index === 0" @click="moveStep(index, -1)" />
            <el-button :icon="ArrowDown" :disabled="index === steps.length - 1" @click="moveStep(index, 1)" />
          </el-button-group>
          <el-button :icon="Delete" type="danger" text @click="removeStep(index)" />
        </div>
      </div>

      <!-- 操作 -->
      <div class="flex items-center gap-2 mt-3">
        <el-button :icon="Plus" @click="addStep">{{ t("添加环节") }}</el-button>
        <el-input v-model="chainName" :placeholder="t('产业链名称')" style="width: 200px" clearable />
        <el-button type="primary" :icon="MagicStick" :loading="loading" @click="calculate">{{ t("计算") }}</el-button>
      </div>
    </el-card>

    <!-- 结果 -->
    <el-card v-if="result" class="mt-3">
      <template #header>
        <div class="flex items-center justify-between">
          <span>{{ t("计算结果") }}：{{ result.project }}</span>
          <el-button type="primary" text @click="showDetail(result)">{{ t("查看详情") }}</el-button>
        </div>
      </template>
      <el-descriptions :column="4" border>
        <el-descriptions-item :label="t('利润 / h')">
          <span :class="result.result.profitPH > 0 ? 'success' : 'error'">{{ result.result.profitPHFormat }}</span>
        </el-descriptions-item>
        <el-descriptions-item :label="t('利润率')">{{ result.result.profitRateFormat }}</el-descriptions-item>
        <el-descriptions-item :label="t('自产比例')">{{ result.result.selfProduceRatioFormat || "--" }}</el-descriptions-item>
        <el-descriptions-item :label="t('成本 / h')">{{ result.result.costPHFormat }}</el-descriptions-item>
      </el-descriptions>

      <el-table :data="result.resultList.flat()" class="mt-3" size="small">
        <el-table-column width="44">
          <template #default="{ row }">
            <ItemIcon :hrid="row.hrid" />
          </template>
        </el-table-column>
        <el-table-column prop="name" :label="t('物品')" min-width="120" />
        <el-table-column prop="project" :label="t('项目')" min-width="80" />
        <el-table-column :label="t('倍率')" align="center" min-width="80">
          <template #default="{ row }">{{ Format.number(row.workMultiplier, 2) }}</template>
        </el-table-column>
        <el-table-column prop="profitPHFormat" :label="t('利润 / h')" align="center" min-width="110" />
        <el-table-column prop="profitRateFormat" :label="t('利润率')" align="center" min-width="90" />
        <el-table-column prop="expPHFormat" :label="t('经验 / h')" align="center" min-width="110" />
        <el-table-column prop="timeCostFormat" :label="t('单次耗时')" align="center" min-width="100" />
      </el-table>
    </el-card>

    <ActionDetail v-model="detailVisible" :data="detailData" />
  </div>
</template>

<style scoped>
.chain-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chain-step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}
.chain-step-no {
  min-width: 52px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
