import type * as Leaderboard from "../leaderboard/type"

import type Calculator from "@/calculator"
import type { StorageCalculatorItem } from "@/pinia/stores/favorite"
import type { Action, ItemDetail } from "~/game"
import { CoinifyCalculator, DecomposeCalculator, TransmuteCalculator } from "@/calculator/alchemy"
import { GatherCalculator } from "@/calculator/gather"
import { ManufactureCalculator } from "@/calculator/manufacture"
import { getStorageCalculatorItem } from "@/calculator/utils"
import { WorkflowCalculator } from "@/calculator/workflow"
import locales, { getTrans } from "@/locales"
import { useGameStoreOutside } from "@/pinia/stores/game"
import { getActionConfigOf } from "../player"
import { getGameDataApi } from "../game"
import { handleBestPerItem, handleCompare, handlePage, handlePush, handleSearch, handleSort } from "../utils"

const { t } = locales.global
/** 查 */
export async function getLeaderboardDataApi(params: Leaderboard.RequestData) {
  let profitList: Calculator[] = []
  if (useGameStoreOutside().getManualchemyCache()) {
    profitList = useGameStoreOutside().getManualchemyCache()
  } else {
    await new Promise(resolve => setTimeout(resolve, 300))
    const startTime = Date.now()
    try {
      profitList = profitList.concat(calcAllFlowProfit())
    } catch (e: any) {
      console.error(e)
    }

    useGameStoreOutside().setManualchemyCache(profitList)
    ElMessage.success(t("计算完成，耗时{0}秒", [(Date.now() - startTime) / 1000]))
  }
  // 比较模式：分组展示，多个物品方案相邻便于横向比较
  if (params.compare) {
    profitList = handleCompare(handleSearch(profitList, params), params)
    return handlePage(profitList, params)
  }
  // 默认每个物品只保留时薪最高的那一条多样产业链；勾选"显示全部多样产业链"后展示该物品所有方案
  if (!params.showAllVariants) {
    profitList = handleBestPerItem(profitList)
  }
  return handlePage(handleSort(handleSearch(profitList, params), params), params)
}

function calcAllFlowProfit() {
  const gameData = getGameDataApi()
  // 所有物品列表
  const list = Object.values(gameData.itemDetailMap)
  const profitList: Calculator[] = []
  const projects: [string, Action][] = [
    [getTrans("锻造"), "cheesesmithing"],
    [getTrans("制造"), "crafting"],
    [getTrans("裁缝"), "tailoring"],
    [getTrans("烹饪"), "cooking"],
    [getTrans("冲泡"), "brewing"]
  ]
  // 采集类生产动作（可作炼金原料自产起点）
  const gatherings: [string, Action][] = [
    [getTrans("挤奶"), "milking"],
    [getTrans("采摘"), "foraging"],
    [getTrans("伐木"), "woodcutting"]
  ]

  // t提前映射，加快运算速度
  const tMap = new Map<string, string>()

  function getT(key: string, args: (string | number)[] = []) {
    const mapKey = [key, ...args].join(",")
    if (tMap.has(mapKey)) {
      return tMap.get(mapKey)!
    }
    const value = t(key, args)
    tMap.set(mapKey, value)
    return value
  }

  // 综利用候选映射：物品 hrid -> 消费它的成品制造动作（无升级链，保证链条终点完整）
  // 用于给主链挂跨项目制造尾，实现"产物被其他制造项目继续加工"的多样综利用链
  const consumeMap = new Map<string, { project: string; outHrid: string; count: number }[]>()
  for (const [actionHrid, actionDetail] of Object.entries(gameData.actionDetailMap)) {
    if (actionDetail.upgradeItemHrid) {
      continue
    }
    const parts = actionHrid.split("/")
    if (parts.length < 3 || !projects.some(([, action]) => action === parts[2])) {
      continue
    }
    const outHrid = actionDetail.outputItems?.[0]?.itemHrid
    if (!outHrid) {
      continue
    }
    for (const input of actionDetail.inputItems || []) {
      const arr = consumeMap.get(input.itemHrid) || []
      arr.push({ project: parts[2], outHrid, count: input.count })
      consumeMap.set(input.itemHrid, arr)
    }
  }

  // 综利用尾全局去重表：同一"主链→下游项目|下游产物"可能从多个起点原料挂出同款尾，
  // 统一在此按 (projectNameTail, outHrid) 去重保留利润最高，末尾一并 flush
  const tailBest = new Map<string, { projectNameTail: string; wf: WorkflowCalculator }>()

  list.forEach((item) => {
    for (const [project, action] of projects) {
      const configs: StorageCalculatorItem[] = []
      let c = new ManufactureCalculator({ hrid: item.hrid, project, action })
      let actionItem = c.actionItem

      while (actionItem?.upgradeItemHrid) {
        configs.unshift(getStorageCalculatorItem(c))

        if (configs.length >= 1) {
          let projectName = getT("{0}步{1}", [configs.length, project])
          const otherProject = configs.find(conf => conf.project !== project)
          otherProject && (projectName += getT("({0})", [otherProject!.project!]))
          // handlePush(profitList, new WorkflowCalculator(configs, projectName))
          calcManualchemyProfit({
            item,
            projectName,
            configs,
            profitList
          })
        }

        // D4更新后，会出现多步动作中出现不同Action组合的情况
        for (const [project, action] of projects) {
          c = new ManufactureCalculator({ hrid: actionItem.upgradeItemHrid, project, action })
          if (c.actionItem) {
            break
          }
        }

        actionItem = c.actionItem
      }
      configs.unshift(getStorageCalculatorItem(c))

      let projectName = getT("{0}步{1}", [configs.length, project])
      const otherProject = configs.find(conf => conf.project !== project)
      otherProject && (projectName += getT("({0})", [otherProject!.project!]))
      // handlePush(profitList, new WorkflowCalculator(configs, projectName))

      calcManualchemyProfit({
        item,
        projectName,
        configs,
        profitList
      })

      // 综利用尾：主链最终产物被其他制造项目的成品动作消费时，
      // 追加下游制造动作，形成"制造→跨项目制造"的综利用链，挂不同尾巴
      // 仅当主链自身可用（item 确实是该项目产物）时才挂尾，避免无效尾巴
      if (c.available) {
        pushCrossProjectTail({
          item,
          projectName,
          configs,
          profitList,
          consumeMap,
          getT,
          mainProject: action,
          tailBest
        })
      }

      // 大全套模式：制造链起点原料可自产时，前插采集动作，原料/中间环节全部自产避税
      pushBigSelfSufficient({
        item,
        projectName,
        configs,
        profitList,
        gatherings,
        getT
      })
    }

    // 采集炼金：可直接采集的物品，接炼金尾（转化/分解/点金）
    for (const [project, action] of gatherings) {
      const c = new GatherCalculator({ hrid: item.hrid, project, action })
      if (!c.available) {
        continue
      }
      calcManualchemyProfit({
        item,
        projectName: project,
        configs: [getStorageCalculatorItem(c)],
        profitList
      })
      // 采集综利用：采集物被其他制造项目消费时，挂跨项目制造尾，
      // 形成"采集→跨项目制造"的综利用链（如李子→冲泡茶、兽皮→制作钥匙）
      pushCrossProjectTail({
        item,
        projectName: project,
        configs: [getStorageCalculatorItem(c)],
        profitList,
        consumeMap,
        getT,
        mainProject: action,
        tailBest
      })
    }
  })

  // 统一 flush 综利用尾：全局去重后一次推入，避免同一产物从多个起点原料挂出重复多样
  // 炼金头多样产业链的链尾也在此统一 flush
  pushAlchemyHeadAll({
    profitList,
    consumeMap,
    getT,
    tailBest
  })
  for (const { projectNameTail, wf } of tailBest.values()) {
    handlePush(profitList, wf)
  }
  return profitList
}

/**
 * 炼金头多样产业链：以炼金作为开头的链（与"制造/采集主链+炼金尾"方向相反）。
 * 反查"由转化/分解某物 X 产出的炼金产物 B"，以期望产出（count×rate）最大的来源作为链头，
 * B 被其他制造项目消费时挂跨项目制造尾，形成"炼金→跨项目制造"的多样链。
 * 链头动作的 hrid 是消耗物（X）而非主产物（B），故用 alignProductHrid 指定流向下一阶段的产物；
 * 且链头产物表含多产物+稀有+精华，须仅将 B 位设为 0 价（其余产物保持市价），
 * 防止 Workflow 按 config.hrid 自动设 0 价、也防止 B 按市价计入链头收入造成虚增。
 * 链头选择按「期望产出 × 成功率」排序（成功率折算进真实收益），避免选到名义产出高但成功率低的来源。
 * 与综利用尾复用 tailBest 去重：同一"链头|下游产物"只保留利润最高一条。
 */
function pushAlchemyHeadAll({
  profitList,
  consumeMap,
  getT,
  tailBest
}: {
  profitList: Calculator[]
  consumeMap: Map<string, { project: string; outHrid: string; count: number }[]>
  getT: (key: string, args?: (string | number)[]) => string
  tailBest: Map<string, { projectNameTail: string; wf: WorkflowCalculator }>
}) {
  const gameData = getGameDataApi()
  const list = Object.values(gameData.itemDetailMap)
  // 反查表：炼金产物 B -> 由转化/分解某物 X 产出它的来源
  const headMap = new Map<string, { xHrid: string; via: "转化" | "分解"; count: number; rate: number; successRate: number; xName: string }[]>()
  for (const item of list) {
    const alch = item.alchemyDetail
    if (!alch) continue
    if (alch.transmuteDropTable) {
      for (const drop of alch.transmuteDropTable) {
        if (drop.itemHrid === item.hrid) continue
        const arr = headMap.get(drop.itemHrid) || []
        arr.push({
          xHrid: item.hrid,
          via: "转化",
          count: (drop.maxCount - (drop.itemHrid === item.hrid ? drop.maxCount : 0)) * alch.bulkMultiplier,
          rate: drop.dropRate || 1,
          successRate: Math.min(1, alch.transmuteSuccessRate ?? 1),
          xName: item.name
        })
        headMap.set(drop.itemHrid, arr)
      }
    }
    if (alch.decomposeItems) {
      for (const drop of alch.decomposeItems) {
        if (drop.itemHrid === item.hrid) continue
        const arr = headMap.get(drop.itemHrid) || []
        arr.push({
          xHrid: item.hrid,
          via: "分解",
          count: drop.count * alch.bulkMultiplier,
          rate: 1,
          // 分解基础成功率固定 0.6（同 DecomposeCalculator.baseSuccessRate）
          successRate: 0.6,
          xName: item.name
        })
        headMap.set(drop.itemHrid, arr)
      }
    }
  }

  // 每个 B：期望产出（count×rate×successRate）最大的来源做链头，挂全部跨项目制造尾
  for (const item of list) {
    const consumers = consumeMap.get(item.hrid)
    if (!consumers?.length) continue
    const sources = headMap.get(item.hrid)
    if (!sources?.length) continue
    sources.sort((a, b) => b.count * b.rate * b.successRate - a.count * a.rate * a.successRate)
    const src = sources[0]
    const headCal = src.via === "转化"
      ? new TransmuteCalculator({ hrid: src.xHrid, catalystRank: 0 })
      : new DecomposeCalculator({ hrid: src.xHrid, catalystRank: 0 })
    if (!headCal.available) continue
    // 链头产物 B 定位：把 B 位设为 0 价（内部流转进下游），其余副产物（稀有/精华等）仍按市价
    const headProducts = headCal.productList
    const headProductIndex = headProducts.findIndex(p => p.hrid === item.hrid)
    if (headProductIndex === -1) continue
    const headConfig = getStorageCalculatorItem(headCal)
    headConfig.alignProductHrid = item.hrid
    headConfig.productPriceConfigList = headProducts.map((p, i) =>
      i === headProductIndex ? { immutable: true, price: 0, hrid: item.hrid } : undefined
    ) as any
    for (const consumer of consumers) {
      const downCal = new ManufactureCalculator({
        hrid: consumer.outHrid,
        project: consumer.project as Action,
        action: consumer.project as Action
      })
      if (!downCal.available) continue
      const downConfig = getStorageCalculatorItem(downCal)
      downConfig.alignHrid = item.hrid
      const projectNameTail = `${src.via}-${getTrans(src.xName)}→${getT(consumer.project)}`
      const wf = new WorkflowCalculator([headConfig, downConfig], projectNameTail)
      if (!wf.available) continue
      const key = `${projectNameTail}|${consumer.outHrid}`
      const prev = tailBest.get(key)
      if (!prev) {
        tailBest.set(key, { projectNameTail, wf })
      } else {
        if (!wf.result) wf.run()
        if (!prev.wf.result) prev.wf.run()
        if ((wf.result?.profitPH ?? -Infinity) > (prev.wf.result?.profitPH ?? -Infinity)) {
          tailBest.set(key, { projectNameTail, wf })
        }
      }
    }
  }
}

/**
 * 大全套模式：当制造链最底层制造的首个非茶原料可采集时，
 * 在该原料前插入对应的采集动作，形成"采集→制造→…→炼金"全自产链。
 * 自产起点无市场买入成本，中间环节以 0 价内部流转，仅终点卖出交一次税。
 */
function pushBigSelfSufficient({
  item,
  projectName,
  configs,
  profitList,
  gatherings,
  getT
}: {
  item: ItemDetail
  projectName?: string
  configs: StorageCalculatorItem[]
  profitList: Calculator[]
  gatherings: [string, Action][]
  getT: (key: string, args?: (string | number)[]) => string
}) {
  if (!configs.length) {
    return
  }
  // 最底层制造动作（链条起点）
  const baseConfig = configs[0]
  const baseCal = new ManufactureCalculator(baseConfig)
  // 升级链断裂时的占位制造（5 个制造动作均无匹配），无真实底层动作，直接跳过
  if (!baseCal.available) {
    return
  }
  // 起点主原料：第一个非茶原料
  const teaSet = new Set(getActionConfigOf(baseCal.action).tea || [])
  const firstIng = baseCal.ingredientList.find(ing => !teaSet.has(ing.hrid))
  if (!firstIng) {
    return
  }
  // 该原料是否可被采集，且采集主产物与原料匹配
  for (const [gatherProject, gatherAction] of gatherings) {
    const gc = new GatherCalculator({ hrid: firstIng.hrid, project: gatherProject, action: gatherAction })
    if (!gc.available) {
      continue
    }
    const dropProduct = gc.productList.find(p => p.hrid === firstIng.hrid)
    if (!dropProduct) {
      continue
    }
    calcManualchemyProfit({
      item,
      projectName: `${getTrans("大全套")}-${gatherProject}+${projectName}`,
      configs: [getStorageCalculatorItem(gc), ...configs],
      profitList
    })
    break
  }
}

/**
 * 综利用尾：主链最终产物被其他制造项目的成品动作消费时，把下游制造动作拼到主链末尾，
 * 形成"主链制造→跨项目制造"的综利用链。下游制造动作通过 alignHrid 指定主链产物为对齐原料，
 * Workflow 按 hrid 匹配即可把主链产物 0 价流转进下游制造，无需主链产物在下游原料的第 0 位。
 */
function pushCrossProjectTail({
  item,
  projectName,
  configs,
  profitList,
  consumeMap,
  getT,
  mainProject,
  tailBest
}: {
  item: ItemDetail
  projectName?: string
  configs: StorageCalculatorItem[]
  profitList: Calculator[]
  consumeMap: Map<string, { project: string; outHrid: string; count: number }[]>
  getT: (key: string, args?: (string | number)[]) => string
  mainProject: string
  tailBest: Map<string, { projectNameTail: string; wf: WorkflowCalculator }>
}) {
  if (!configs.length) {
    return
  }
  const consumers = consumeMap.get(item.hrid)
  if (!consumers?.length) {
    return
  }
  const cross = new Set(consumers.map((c) => c.project))
  // 跳过与主链同项目的重复组合；同一产物的每个跨项目消费动作都生成尾巴，
  // 让同一条主链挂出更多综利用多样（如兽皮→钥匙/护符/靴子……）
  // 同一下游产物可能被同项目多个动作消费（多配方），按 (project, outHrid) 去重保留利润最高
  const tailConsumers = consumers.filter((c) => c.project !== mainProject)
  for (const consumer of tailConsumers) {
    const downCal = new ManufactureCalculator({ hrid: consumer.outHrid, project: consumer.project as Action, action: consumer.project as Action })
    if (!downCal.available) {
      continue
    }
    const downConfig = getStorageCalculatorItem(downCal)
    // 指定主链产物为下游制造的对齐原料（0 价流转），下游其它原料按市场价买入
    downConfig.alignHrid = item.hrid
    const projectNameTail = `${projectName}→${getT(consumer.project)}`
    const wf = new WorkflowCalculator([...configs, downConfig], projectNameTail)
    if (!wf.available) {
      continue
    }
    // 全局去重：同"主链→下游项目|下游产物"可能从多个起点原料挂出，只保留利润最高的一条
    const key = `${projectNameTail}|${consumer.outHrid}`
    const prev = tailBest.get(key)
    if (!prev) {
      tailBest.set(key, { projectNameTail, wf })
    } else {
      if (!wf.result) {
        wf.run()
      }
      if (!prev.wf.result) {
        prev.wf.run()
      }
      if ((wf.result?.profitPH ?? -Infinity) > (prev.wf.result?.profitPH ?? -Infinity)) {
        tailBest.set(key, { projectNameTail, wf })
      }
    }
  }
}

function calcManualchemyProfit({
  item,
  projectName,
  configs,
  profitList
}: {
  item: ItemDetail
  projectName?: string
  configs: StorageCalculatorItem[]
  profitList: Calculator[]
}) {
  // 迷宫等特殊物品无 itemLevel（null），炼金成功率/效率计算会得到 NaN，
  // 且其 alchemyDetail 无真实转化/分解内容，直接跳过炼金尾链，避免污染利润网
  if (!Number.isFinite(item.itemLevel)) {
    return
  }
  const cList = []
  for (let catalystRank = 0; catalystRank <= 2; catalystRank++) {
    cList.push(new TransmuteCalculator({
      hrid: item.hrid,
      catalystRank
    }))
    cList.push(new DecomposeCalculator({
      hrid: item.hrid,
      catalystRank
    }))
    cList.push(new CoinifyCalculator({
      hrid: item.hrid,
      catalystRank
    }))
  }
  for (const c of cList) {
    const alcheConfig = getStorageCalculatorItem(c)
    handlePush(profitList, new WorkflowCalculator([...configs, alcheConfig], `${projectName}-${c.project}`))
  }
}
