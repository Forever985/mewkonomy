import type Calculator from "@/calculator"
import type { StorageCalculatorItem } from "@/pinia/stores/favorite"
import type { Action } from "~/game"
import { CoinifyCalculator, DecomposeCalculator, TransmuteCalculator } from "@/calculator/alchemy"
import { GatherCalculator } from "@/calculator/gather"
import { ManufactureCalculator } from "@/calculator/manufacture"
import { getStorageCalculatorItem } from "@/calculator/utils"
import { WorkflowCalculator } from "@/calculator/workflow"
import { getTrans } from "@/locales"
import { getGameDataApi } from "../game"

/**
 * 手动产业链：用户按「项目+动作+物品」逐节点缀连，自动跨环节 0 价流转并整链核算利润。
 * 采集(挤奶/采摘/伐木) → GatherCalculator
 * 制造(锻造/制造/裁缝/烹饪/冲泡) → ManufactureCalculator
 * 炼金(转化/分解/点金) → Transmute/Decompose/CoinifyCalculator
 */
export interface ChainStep {
  /** 项目显示名（如 制造/转化），用于 Calculator.project */
  project: string
  action: Action
  kind: "gather" | "manufacture" | "transmute" | "decompose" | "coinify"
  /** 物品 hrid */
  hrid: string
  /** 炼金催化剂 0=无 1=普通 2=主要 */
  catalystRank?: number
  /** 炼金环节非末尾时：指定"流向下一阶段"的产物 hrid */
  outHrid?: string
}

export interface ChainProjectOption {
  label: string
  action: Action
  kind: ChainStep["kind"]
}

export interface ChainItemOption {
  hrid: string
  name: string
}

/** 可选项目列表 */
export function getChainProjectOptions(): ChainProjectOption[] {
  return [
    { label: getTrans("挤奶"), action: "milking", kind: "gather" },
    { label: getTrans("采摘"), action: "foraging", kind: "gather" },
    { label: getTrans("伐木"), action: "woodcutting", kind: "gather" },
    { label: getTrans("锻造"), action: "cheesesmithing", kind: "manufacture" },
    { label: getTrans("制造"), action: "crafting", kind: "manufacture" },
    { label: getTrans("裁缝"), action: "tailoring", kind: "manufacture" },
    { label: getTrans("烹饪"), action: "cooking", kind: "manufacture" },
    { label: getTrans("冲泡"), action: "brewing", kind: "manufacture" },
    { label: getTrans("转化"), action: "alchemy", kind: "transmute" },
    { label: getTrans("分解"), action: "alchemy", kind: "decompose" },
    { label: getTrans("点金"), action: "alchemy", kind: "coinify" }
  ]
}

export function isAlchemyKind(kind: ChainStep["kind"]): boolean {
  return kind === "transmute" || kind === "decompose" || kind === "coinify"
}

/** 按环节类型实例化对应计算器 */
export function buildChainCalculator(step: ChainStep): Calculator {
  const { project, action, hrid, catalystRank = 0 } = step
  switch (step.kind) {
    case "gather":
      return new GatherCalculator({ hrid, project, action })
    case "manufacture":
      return new ManufactureCalculator({ hrid, project, action })
    case "transmute":
      return new TransmuteCalculator({ hrid, catalystRank })
    case "decompose":
      return new DecomposeCalculator({ hrid, catalystRank })
    case "coinify":
      return new CoinifyCalculator({ hrid, catalystRank })
  }
}

/** 缓存：kind-action -> 可选物品列表 */
const itemOptionCache = new Map<string, ChainItemOption[]>()

/** 某项目下可用的物品候选（懒生成+缓存） */
export function getChainStepItemOptions(step: Pick<ChainStep, "project" | "action" | "kind">): ChainItemOption[] {
  const key = `${step.kind}-${step.action}`
  const cached = itemOptionCache.get(key)
  if (cached) return cached

  const gameData = getGameDataApi()
  const options: ChainItemOption[] = []
  for (const item of Object.values(gameData.itemDetailMap)) {
    const cal = buildChainCalculator({ ...step, hrid: item.hrid, catalystRank: 0 } as ChainStep)
    if (cal.available) {
      options.push({ hrid: item.hrid, name: item.name })
    }
  }
  options.sort((a, b) => a.name.localeCompare(b.name))
  itemOptionCache.set(key, options)
  return options
}

/** 炼金环节的衔接产物候选（供非末尾炼金指定下游产物） */
export function getChainAlchemyOutputOptions(step: ChainStep): ChainItemOption[] {
  if (!step.hrid) return []
  const cal = buildChainCalculator(step)
  if (!cal.available) return []
  const gameData = getGameDataApi()
  return cal.productList
    .filter(p => p.hrid && p.hrid !== step.hrid)
    .map(p => ({
      hrid: p.hrid,
      name: gameData.itemDetailMap[p.hrid]?.name || p.hrid
    }))
}

/** 环节的衔接产物：制造/采集=物品本身；炼金=用户指定的 outHrid */
function getStepOutputHrid(step: ChainStep): string | undefined {
  return isAlchemyKind(step.kind) ? step.outHrid : step.hrid
}

/** 计算整条手动产业链，返回 WorkflowCalculator（已 run），无效时返回 null */
export function calcChainProfitApi(steps: ChainStep[], chainName: string): WorkflowCalculator | null {
  if (!steps.length) return null
  const configs: StorageCalculatorItem[] = []
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (!step.hrid) return null
    const cal = buildChainCalculator(step)
    if (!cal.available) return null
    const config = getStorageCalculatorItem(cal)
    // 下游环节：把上游衔接产物设为 0 价内部流转
    if (i > 0) {
      const prevOut = getStepOutputHrid(steps[i - 1])
      if (prevOut) {
        config.alignHrid = prevOut
      }
    }
    // 炼金环节非末尾：指定流向下一阶段的产物（workMultiplier 按该产物对倍率）
    if (isAlchemyKind(step.kind) && i < steps.length - 1) {
      const cal2 = buildChainCalculator(step)
      config.alignProductHrid = step.outHrid || cal2.productList[0]?.hrid
    }
    configs.push(config)
  }
  const wf = new WorkflowCalculator(configs, chainName)
  wf.run()
  return wf
}
