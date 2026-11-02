import { describe, expect, it } from "vitest"
import { handleSearch } from "@/common/apis/utils"

/**
 * 行级「启用」开关（`conditions[].enabled` / `excludes[].enabled`）。
 *
 * 需求（用户 2026-11-02）：想换一套检索时，不希望把旧的条件删掉重建 ——
 * 于是每行前面加勾选框，勾掉 = 内容保留、**不参与检索**，下次勾回来即恢复。
 *
 * 这里锁三件事：
 * 1. `enabled === false` 的行必须被跳过；
 * 2. **没有 `enabled` 键 = 启用**（历史本地条件全都没有这个键，
 *    写成 `=== true` 会让它们的检索条件整体失效、列表变全量）；
 * 3. 跳过后其它行的 OR / AND 语义不变。
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

const names = (list: any[]) => list.map(c => c.result.name)

describe("行级开关 · 组合条件行", () => {
  it("停用的行不参与检索，条目不会被它筛掉", () => {
    const list = [makeCal({ name: "奶酪", project: "5步锻造" }), makeCal({ name: "面包", project: "3步缝纫" })]
    // 「3 步 + 缝纫」这行停用 ⇒ 只剩「5 步 + 锻造」生效
    const out = handleSearch(list, {
      conditions: [
        { steps: 5, project: "锻造" },
        { steps: 3, project: "缝纫", enabled: false }
      ]
    })
    expect(names(out), "被停用的「3 步缝纫」不该再命中面包").toEqual(["奶酪"])
  })

  it("没有 enabled 键的行照常生效（历史数据必须兼容）", () => {
    const list = [makeCal({ name: "奶酪", project: "5步锻造" }), makeCal({ name: "面包", project: "3步缝纫" })]
    const out = handleSearch(list, {
      conditions: [
        { steps: 5, project: "锻造" },
        { steps: 3, project: "缝纫" }
      ]
    })
    expect(names(out), "两行都是 OR 生效").toEqual(["奶酪", "面包"])
  })

  it("enabled: true 与缺省等价", () => {
    const list = [makeCal({ name: "奶酪", project: "5步锻造" })]
    const withTrue = handleSearch(list, { conditions: [{ steps: 5, enabled: true }] })
    const without = handleSearch(list, { conditions: [{ steps: 5 }] })
    expect(names(withTrue)).toEqual(names(without))
    expect(withTrue).toHaveLength(1)
  })

  it("全部行停用 ⇒ 组合条件为空 ⇒ 不过滤（既有语义：空条件 = 不限）", () => {
    const list = [makeCal({ name: "奶酪" }), makeCal({ name: "面包" }), makeCal({ name: "石头" })]
    const out = handleSearch(list, {
      conditions: [
        { steps: 5, enabled: false },
        { steps: 3, enabled: false }
      ]
    })
    expect(names(out), "没有任何生效条件时应返回全量").toEqual(["奶酪", "面包", "石头"])
  })

  it("停用一行不影响另一行的行内 AND（步数 + 等级同时约束）", () => {
    const list = [
      makeCal({ name: "A", project: "5步锻造", actionLevel: 50 }),
      makeCal({ name: "B", project: "5步锻造", actionLevel: 20 }),
      makeCal({ name: "C", project: "3步锻造", actionLevel: 50 })
    ]
    const out = handleSearch(list, {
      conditions: [
        { steps: 5, minLevel: 40 },
        { steps: 3, enabled: false }
      ]
    })
    expect(names(out), "只剩「5 步且等级≥40」").toEqual(["A"])
  })
})

describe("行级开关 · 排除行", () => {
  it("停用的排除项不生效（该产品留在结果里）", () => {
    const list = [makeCal({ name: "奶酪" }), makeCal({ name: "面包" })]
    const out = handleSearch(list, {
      excludes: [{ name: "面包", enabled: false }]
    })
    expect(names(out), "排除项被停用 ⇒ 面包不该被剔除").toEqual(["奶酪", "面包"])
  })

  it("没有 enabled 键的排除项照常生效", () => {
    const list = [makeCal({ name: "奶酪" }), makeCal({ name: "面包" })]
    const out = handleSearch(list, { excludes: [{ name: "面包" }] })
    expect(names(out)).toEqual(["奶酪"])
  })

  it("多行排除可以只停用其中一行", () => {
    const list = [makeCal({ name: "奶酪" }), makeCal({ name: "面包" }), makeCal({ name: "石头" })]
    const out = handleSearch(list, {
      excludes: [
        { name: "面包" },
        { name: "石头", enabled: false }
      ]
    })
    expect(names(out), "只排除面包，石头被停用的那行不管").toEqual(["奶酪", "石头"])
  })
})

describe("行级开关 · 模拟「勾掉 → 勾回」的完整往返", () => {
  it("勾掉再勾回，检索结果必须回到原样（内容不丢）", () => {
    const list = [makeCal({ name: "奶酪", project: "5步锻造" }), makeCal({ name: "面包", project: "3步缝纫" })]
    const row: any = { steps: 3, project: "缝纫" }
    const base = handleSearch(list, { conditions: [{ steps: 5, project: "锻造" }, row] })
    expect(names(base), "初始两行都生效").toEqual(["奶酪", "面包"])

    // 勾掉：写 enabled = false（组件 `setRowEnabled` 的行为）
    row.enabled = false
    expect(names(handleSearch(list, { conditions: [{ steps: 5, project: "锻造" }, row] }))).toEqual(["奶酪"])

    // 勾回：**删除** enabled 键，而不是写 true
    delete row.enabled
    expect(names(handleSearch(list, { conditions: [{ steps: 5, project: "锻造" }, row] })), "勾回后必须完全恢复")
      .toEqual(names(base))
    expect(Object.prototype.hasOwnProperty.call(row, "enabled"), "勾回后不该留下 enabled 键").toBe(false)
  })
})
