import { describe, expect, it } from "vitest"
import { mount } from "@vue/test-utils"
import { reactive } from "vue"
import ElementPlus from "element-plus"
import { createI18n } from "vue-i18n"
import SearchPanel from "@@/components/SearchPanel/index.vue"
import type { PanelField } from "@@/components/SearchPanel/types"

/**
 * 行级「启用」勾选框（`rowToggle`）的界面行为。
 *
 * 这层测试必须做，因为 API 侧的跳过逻辑（`handleSearch` 里的 `enabled !== false`）
 * 再正确，只要勾选框没把 `enabled` 写回 `searchData`，功能就是**静默无效** ——
 * 界面上行变灰了、结果却一点没变，是最难排查的那类 bug。
 *
 * 同时要守住：`rowToggle` 缺省时**不许渲染**勾选框。
 * SearchPanel 被 11 个检索页共用，多出来的复选框会挤乱那些页面的布局。
 */
const i18n = createI18n({
  legacy: false,
  locale: "zh-cn",
  messages: { "zh-cn": {} },
  missingWarn: false,
  fallbackWarn: false
})

const conditionsField = (rowToggle?: boolean): PanelField[] => [{
  type: "conditions",
  label: "条件",
  projectOptions: ["锻造", "缝纫"],
  stepsCount: 10,
  ...(rowToggle === undefined ? {} : { rowToggle })
}]

function mountPanel(model: Record<string, any>, fields: PanelField[]) {
  return mount(SearchPanel, {
    props: { modelValue: model, fields },
    global: { plugins: [ElementPlus, i18n] }
  })
}

/** 只取条件行里的勾选框（排除「排除行」等其它复选框） */
const rowCheckboxes = (w: any) => w.findAll(".el-form-item .el-checkbox")

describe("SearchPanel · 条件行的启用勾选框", () => {
  it("rowToggle 缺省时不渲染勾选框（保护其他 11 个检索页）", () => {
    const model = reactive<Record<string, any>>({ conditions: [{ steps: 5, project: "锻造" }] })
    const w = mountPanel(model, conditionsField())
    expect(rowCheckboxes(w)).toHaveLength(0)
  })

  it("rowToggle: true 时每行前面都有一个勾选框，历史数据默认显示为已勾选", () => {
    const model = reactive<Record<string, any>>({
      conditions: [
        { steps: 5, project: "锻造" },     // 没有 enabled 键 = 历史数据
        { steps: 3, project: "缝纫" }
      ]
    })
    const w = mountPanel(model, conditionsField(true))
    const boxes = rowCheckboxes(w)
    expect(boxes, "两行各一个勾选框").toHaveLength(2)
    // undefined 必须显示为**已勾选**，否则用户会以为旧条件已经被关掉了
    expect((boxes[0].find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
    expect(w.findAll(".row-off")).toHaveLength(0)
  })

  it("勾掉写入 enabled: false，且行本身与其内容都保留", async () => {
    const model = reactive<Record<string, any>>({ conditions: [{ steps: 5, project: "锻造" }, { steps: 3, project: "缝纫" }] })
    const w = mountPanel(model, conditionsField(true))

    await rowCheckboxes(w)[1].find('input[type="checkbox"]').setValue(false)

    expect(model.conditions.length, "行不能被删除").toBe(2)
    expect(model.conditions[1].steps, "内容必须保留").toBe(3)
    expect(model.conditions[1].project, "内容必须保留").toBe("缝纫")
    expect(model.conditions[1].enabled, "必须写回 enabled: false").toBe(false)
    expect(model.conditions[0].enabled, "另一行不受影响").toBeUndefined()
    expect(w.emitted("change"), "必须通知页面重新检索").toBeTruthy()

    // 视觉反馈：停用的行带 .row-off（变灰）
    expect(w.findAll(".row-off")).toHaveLength(1)
  })

  it("再勾回来会删除 enabled 键（不是写 true），数据回到原形状", async () => {
    const model = reactive<Record<string, any>>({ conditions: [{ steps: 3, project: "缝纫", enabled: false }] })
    const w = mountPanel(model, conditionsField(true))
    expect(w.findAll(".row-off"), "初始就是停用态").toHaveLength(1)

    await rowCheckboxes(w)[0].find('input[type="checkbox"]').setValue(true)

    expect(Object.prototype.hasOwnProperty.call(model.conditions[0], "enabled"),
      "勾回后不该留下 enabled 键").toBe(false)
    expect(model.conditions[0].steps, "内容仍在").toBe(3)
    expect(w.findAll(".row-off"), "变灰样式应撤销").toHaveLength(0)
  })
})

describe("SearchPanel · 排除行的启用勾选框", () => {
  it("停用排除行同样只写 enabled: false，不删行", async () => {
    const model = reactive<Record<string, any>>({
      excludes: [{ name: "面包" }, { name: "石头" }]
    })
    const w = mountPanel(model, [{
      type: "excludes",
      label: "排除",
      projectOptions: ["锻造"],
      rowToggle: true
    }] as PanelField[])

    const boxes = rowCheckboxes(w)
    expect(boxes, "两个排除行各一个勾选框").toHaveLength(2)

    await boxes[0].find('input[type="checkbox"]').setValue(false)
    expect(model.excludes[0].name).toBe("面包")
    expect(model.excludes[0].enabled).toBe(false)
    expect(model.excludes[1].enabled).toBeUndefined()
    expect(w.findAll(".row-off")).toHaveLength(1)
  })

  it("rowToggle 缺省时排除行不渲染勾选框", () => {
    const model = reactive<Record<string, any>>({ excludes: [{ name: "面包" }] })
    const w = mountPanel(model, [{ type: "excludes", label: "排除", projectOptions: ["锻造"] }] as PanelField[])
    expect(rowCheckboxes(w)).toHaveLength(0)
  })
})
