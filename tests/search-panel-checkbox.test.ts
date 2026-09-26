import { describe, expect, it } from "vitest"
import { mount } from "@vue/test-utils"
import { reactive } from "vue"
import ElementPlus from "element-plus"
import { createI18n } from "vue-i18n"
import SearchPanel from "@@/components/SearchPanel/index.vue"

/**
 * SearchPanel 的复选框字段必须把值写回传入的 searchData，并 emit change。
 *
 * 这是「仅看赚钱方案」这类纯布尔开关的命脉：API 侧过滤逻辑再正确，
 * 只要这里没写回去，勾选就是**静默无效**（界面无任何变化，最容易被当成"没生效"）。
 * 第二种情形模拟真实碰到的坑：localStorage 里存的是**加这个字段之前**的旧对象，
 * 于是 `modelValue[key]` 一开始是 undefined —— el-checkbox 仍必须能把它切成 true。
 */
const i18n = createI18n({
  legacy: false,
  locale: "zh-cn",
  messages: { "zh-cn": {} },
  missingWarn: false,
  fallbackWarn: false
})

function mountPanel(model: Record<string, any>) {
  return mount(SearchPanel, {
    props: {
      modelValue: model,
      fields: [{ type: "checkbox", key: "onlyProfitable", label: "仅看赚钱方案" }]
    },
    global: { plugins: [ElementPlus, i18n] }
  })
}

describe("SearchPanel 复选框绑定", () => {
  it("默认 false 时勾选会写回 true 并 emit change", async () => {
    const model = reactive({ onlyProfitable: false })
    const wrapper = mountPanel(model)
    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(model.onlyProfitable).toBe(true)
    expect(wrapper.emitted("change")).toBeTruthy()
  })

  it("字段在旧存档里缺失（undefined）时，勾选同样能写回 true", async () => {
    const model = reactive({} as Record<string, any>)
    const wrapper = mountPanel(model)
    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(model.onlyProfitable).toBe(true)
    expect(wrapper.emitted("change")).toBeTruthy()
  })

  it("再取消勾选会写回 false", async () => {
    const model = reactive({ onlyProfitable: true })
    const wrapper = mountPanel(model)
    await wrapper.find('input[type="checkbox"]').setValue(false)
    expect(model.onlyProfitable).toBe(false)
  })
})
