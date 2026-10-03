import { describe, expect, it } from "vitest"
import { handleConditions, handleSearch, stepsOfProject } from "@/common/apis/utils"

/**
 * `handleSearch` 的**行为锁定**测试。
 *
 * 目的不是测新功能，而是给改造上一道保险：`handleSearch` 被 11 个检索页共用
 * （dashboard / manualchemy / jungle 系 / enhanposer 系 / decompose / inherit …），
 * 任何语义偏移都会同时影响这些页面，而它们大多没有单测覆盖页面层。
 *
 * 所以这里把「改造前真实存在的语义」逐条钉死，包括一些看起来奇怪但必须保留的行为：
 * - `names` 数组是 **OR**（命中任一即保留），不是 AND；
 * - `minProfitRate` 单值参数与 `profitRate` 单值参数同时存在时两个都会生效；
 * - 排除行的判定是「行内 AND、行间 OR」（命中任一排除组合即剔除）。
 */

function makeCal(over: Record<string, any> = {}) {
  const name = over.name ?? "奶酪"
  return {
    project: over.project ?? "1步锻造",
    actionLevel: over.actionLevel ?? 10,
    isEquipment: over.isEquipment ?? false,
    item: over.item ?? { type: "material" },
    result: {
      name,
      profitPH: over.profitPH ?? 1000,
      profitRate: over.profitRate ?? 0.2,
      risk: over.risk ?? 5
    }
  } as any
}

const names = (list: any[]) => list.map(c => `${c.result.name}/${c.project}/${c.actionLevel}`)

describe("handleSearch · 物品名（多值 OR）", () => {
  it("单个 name 命中", () => {
    const list = [makeCal(), makeCal({ name: "面包" })]
    expect(names(handleSearch(list, { name: "奶酪" }))).toEqual(["奶酪/1步锻造/10"])
  })

  it("name 传数组时是 OR（命中任一即保留），不是 AND", () => {
    const list = [makeCal({ name: "奶酪" }), makeCal({ name: "面包" }), makeCal({ name: "石头" })]
    const out = handleSearch(list, { name: ["奶酪", "面包"] })
    expect(names(out)).toEqual(["奶酪/1步锻造/10", "面包/1步锻造/10"])
  })

  it("字符串形态的 name 等价于单元素数组", () => {
    const list = [makeCal({ name: "奶酪" }), makeCal({ name: "面包" })]
    expect(names(handleSearch(list, { name: "面包" }))).toEqual(["面包/1步锻造/10"])
  })

  it("空数组 / 空串 = 不限制", () => {
    const list = [makeCal(), makeCal({ name: "面包" })]
    expect(handleSearch(list, { name: [] })).toHaveLength(2)
    expect(handleSearch(list, { name: "" })).toHaveLength(2)
  })

  it("大小写不敏感", () => {
    const list = [makeCal({ name: "CHEESE" })]
    expect(handleSearch(list, { name: "cheese" })).toHaveLength(1)
  })

  it("子串匹配（搜「酪」能命中「奶酪」）", () => {
    const list = [makeCal({ name: "奶酪" }), makeCal({ name: "面包" })]
    expect(handleSearch(list, { name: "酪" })).toHaveLength(1)
  })
})

describe("handleSearch · 动作与组合条件", () => {
  it("单值 project 命中（子串包含）", () => {
    const list = [makeCal({ project: "1步锻造" }), makeCal({ project: "1步缝纫" })]
    expect(handleSearch(list, { project: "锻造" })).toHaveLength(1)
  })

  it("组合条件：行内 AND、行间 OR", () => {
    const list = [
      makeCal({ project: "5步锻造", actionLevel: 50 }),
      makeCal({ project: "3步缝纫", actionLevel: 20 }),
      makeCal({ project: "1步锻造", actionLevel: 10 })
    ]
    const out = handleSearch(list, {
      conditions: [
        { steps: 5, minLevel: 40 },
        { steps: 3, maxLevel: 30 }
      ]
    })
    // 第 1 行：5 步 + 等级≥40 ⇒ 第 1 条命中
    // 第 2 行：3 步 + 等级≤30 ⇒ 第 2 条命中
    expect(out).toHaveLength(2)
  })

  it("组合条件同时约束步数与动作", () => {
    const list = [
      makeCal({ project: "5步锻造", actionLevel: 50 }),
      makeCal({ project: "5步缝纫", actionLevel: 50 })
    ]
    const out = handleSearch(list, { conditions: [{ steps: 5, project: "锻造" }] })
    expect(out).toHaveLength(1)
    expect(out[0].project).toBe("5步锻造")
  })

  it("空条件行被忽略，不会把列表清空", () => {
    const list = [makeCal()]
    expect(handleSearch(list, { conditions: [{}, { steps: "" }] })).toHaveLength(1)
  })
})

describe("handleSearch · 步数解析（中英兼容）", () => {
  it("中文「N步」", () => {
    expect(stepsOfProject("5步锻造")).toBe(5)
  })

  it("英文 \"N steps \"（en.ts 两侧带空格）", () => {
    expect(stepsOfProject("5 steps Smithing")).toBe(5)
    expect(stepsOfProject("5 steps ")).toBe(5)
  })

  it("单步动作 = 1", () => {
    expect(stepsOfProject("锻造")).toBe(1)
  })

  it("解析不出时按 1 处理（不返回 NaN）", () => {
    expect(stepsOfProject("")).toBe(1)
    expect(stepsOfProject("abc")).toBe(1)
  })

  it("单值 steps 精确匹配", () => {
    const list = [makeCal({ project: "5步锻造" }), makeCal({ project: "3步锻造" })]
    expect(handleSearch(list, { steps: 5 })).toHaveLength(1)
  })
})

describe("handleSearch · 排除行", () => {
  it("只写 name 即排除该产品全部方案", () => {
    const list = [makeCal({ name: "奶酪" }), makeCal({ name: "面包" })]
    expect(names(handleSearch(list, { excludes: [{ name: "奶酪" }] }))).toEqual(["面包/1步锻造/10"])
  })

  it("name + project 同时给 = 精确排除该组合", () => {
    const list = [
      makeCal({ name: "奶酪", project: "1步锻造" }),
      makeCal({ name: "奶酪", project: "1步缝纫" })
    ]
    const out = handleSearch(list, { excludes: [{ name: "奶酪", project: "锻造" }] })
    expect(out).toHaveLength(1)
    expect(out[0].project).toBe("1步缝纫")
  })

  it("行间 OR（命中任一排除组合即剔除）", () => {
    const list = [makeCal({ name: "奶酪" }), makeCal({ name: "面包" }), makeCal({ name: "石头" })]
    const out = handleSearch(list, { excludes: [{ name: "奶酪" }, { name: "石头" }] })
    expect(names(out)).toEqual(["面包/1步锻造/10"])
  })
})

describe("handleSearch · 排除装备 / 首饰 / 护符（三个开关互相独立）", () => {
  // 装备部位走 `equipmentDetail.type`（形如 `/equipment_types/neck`，取末段），
  // **不是** `item.type` —— 后者是物品大类（material 等），不区分部位。
  const equip = (part: string, over: Record<string, any> = {}) => makeCal({
    isEquipment: true,
    item: { type: "equipment", equipmentDetail: { type: `/equipment_types/${part}` } },
    ...over
  })

  it("banEquipment 保留首饰（首饰由 banJewelry 负责）", () => {
    for (const part of ["neck", "ring", "earrings"]) {
      expect(handleSearch([equip(part)], { banEquipment: true }), part).toHaveLength(1)
    }
  })

  it("banEquipment 剔除护符以外的装备", () => {
    expect(handleSearch([equip("charm")], { banEquipment: true })).toHaveLength(1)
    expect(handleSearch([equip("chest")], { banEquipment: true })).toHaveLength(0)
  })

  it("banJewelry 单独生效（三种首饰部位都被剔除）", () => {
    for (const part of ["neck", "ring", "earrings"]) {
      const list = [equip(part), equip("chest")]
      expect(handleSearch(list, { banJewelry: true }), part).toHaveLength(1)
    }
  })

  it("banCharm 单独生效", () => {
    const list = [equip("charm"), equip("neck")]
    const out = handleSearch(list, { banCharm: true })
    expect(out).toHaveLength(1)
    expect(out[0]?.item?.equipmentDetail?.type).toBe("/equipment_types/neck")
  })

  it("三个都勾 = 全部装备都被排除", () => {
    const list = [equip("chest"), equip("neck"), equip("charm")]
    expect(handleSearch(list, { banEquipment: true, banJewelry: true, banCharm: true })).toHaveLength(0)
  })

  it("非装备物品不被 banEquipment 影响", () => {
    const list = [makeCal({ isEquipment: false })]
    expect(handleSearch(list, { banEquipment: true })).toHaveLength(1)
  })
})

describe("handleSearch · 数值区间（单值 + min/max 双头）", () => {
  const list = [
    makeCal({ profitRate: 0.1, risk: 3 }),
    makeCal({ profitRate: 0.5, risk: 20 })
  ]

  it("minProfitRate 下限", () => {
    expect(handleSearch(list, { minProfitRate: 20 })).toHaveLength(1)
  })

  it("maxProfitRate 上限", () => {
    expect(handleSearch(list, { maxProfitRate: 20 })).toHaveLength(1)
  })

  it("min+max 构成闭区间", () => {
    expect(handleSearch(list, { minProfitRate: 10, maxProfitRate: 10 })).toHaveLength(1)
  })

  it("单值 profitRate 等价于 minProfitRate 下限", () => {
    expect(handleSearch(list, { profitRate: 20 })).toHaveLength(1)
    expect(handleSearch(list, { profitRate: 5 })).toHaveLength(2)
  })

  it("profitRate 与 minProfitRate 同时给时两者都生效（取更严的下限）", () => {
    // profitRate=5%（=0.05 下限）+ minProfitRate=20% ⇒ 等价于下限 20%
    expect(handleSearch(list, { profitRate: 5, minProfitRate: 20 })).toHaveLength(1)
  })

  it("【已知边界】profitRate=0 是 falsy，单值参数会被 `&&` 短路掉（不生效）", () => {
    // 这不是 bug 断言，是**如实记录现状**：第 219 行写作
    // `params.profitRate && (...)`，所以 0 不会过滤任何东西。
    // 迁移到查询引擎时要保持这个行为，否则 11 个页面的边界结果会变。
    expect(handleSearch(list, { profitRate: 0 })).toHaveLength(2)
    // 而 minProfitRate 用 `!= null` 判定，0 是生效的 —— 两者并不对称
    expect(handleSearch(list, { minProfitRate: 0 })).toHaveLength(2)
  })

  it("风险区间", () => {
    expect(handleSearch(list, { maxRisk: 10 })).toHaveLength(1)
    expect(handleSearch(list, { minRisk: 10 })).toHaveLength(1)
  })

  it("不设条件 = 全部保留", () => {
    expect(handleSearch(list, {})).toHaveLength(2)
  })
})

describe("handleConditions · 强化类页面的等级条件", () => {
  const data = [
    { project: "锻造", calculator: { enhanceLevel: 3 }, actionLevel: 10 },
    { project: "锻造", calculator: { enhanceLevel: 7 }, actionLevel: 10 }
  ] as any[]

  it("steps 映射为「目标强化等级」相等匹配", () => {
    const out = handleConditions(data, { conditions: [{ steps: 7 }] }, (c: any) => c.calculator.enhanceLevel)
    expect(out).toHaveLength(1)
    expect(out[0].calculator.enhanceLevel).toBe(7)
  })

  it("无有效条件时原样返回（不能返回空集）", () => {
    expect(handleConditions(data, {}, (c: any) => c.calculator.enhanceLevel)).toHaveLength(2)
    expect(handleConditions(data, { conditions: [] }, (c: any) => c.calculator.enhanceLevel)).toHaveLength(2)
  })
})
