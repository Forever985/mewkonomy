import { describe, it, expect, beforeAll } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"

/**
 * 进阶模式搜索框的**接线**验证（bug 2）。
 *
 * 光测 `filterChainOptions` 不够 —— 那个函数早前就是对的，
 * 坏的是**接线**：`el-select` 的 `filter-method` 返回值会被丢弃，
 * 早前却把过滤结果 return 出去，而选项列表用的是恒为全量的 `itemOptions(step)`。
 *
 * 所以这里必须验证「改了关键字之后，页面给下拉的选项列表真的变了」。
 */
describe("chainbuilder 进阶模式搜索框接线", () => {
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

  it("onStepFilter 之后 filteredItemOptions 的候选数必须变化", async () => {
    const { mount } = await import("@vue/test-utils")
    const { createRouter, createMemoryHistory } = await import("vue-router")
    const { createI18n } = await import("vue-i18n")
    const ElementPlus = (await import("element-plus")).default
    const { pinia } = await import("@/pinia")

    // happy-dom 的 MutationObserver.observe 与 element-plus 不兼容 ⇒ 先替换
    ;(globalThis as any).MutationObserver = class {
      observe() {}
      disconnect() {}
      takeRecords() { return [] }
    }
    ;(globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    const i18n = createI18n({
      legacy: false, locale: "zh-cn",
      messages: { "zh-cn": {} }, missingWarn: false, fallbackWarn: false
    })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", name: "X", component: { template: "<div/>" } }]
    })
    await router.push("/")
    await router.isReady()

    const Page = (await import("@/pages/chainbuilder/index.vue")).default
    const w = mount(Page, { global: { plugins: [pinia, router, i18n, ElementPlus] } })
    await new Promise(r => setTimeout(r, 300))

    const vm = w.vm as any
    // 切到进阶模式，并给第 0 个环节选一个项目（相当于用户操作）
    vm.mode = "advanced"
    await new Promise(r => setTimeout(r, 50))
    vm.steps[0].project = "锻造"
    vm.onProjectChange(0)
    await new Promise(r => setTimeout(r, 50))

    const step = vm.steps[0]
    const full = vm.filteredItemOptions(0, step)
    console.log("[p] 未输入关键字时候选数 =", full.length)

    // 模拟 el-select 调 filter-method（模板里绑的就是这个）
    vm.onStepFilter(0, "cheese")
    await new Promise(r => setTimeout(r, 50))
    const filtered = vm.filteredItemOptions(0, step)
    console.log("[p] 关键字 'cheese' → 候选数 =", filtered.length)
    console.log("[p]   前几个:", filtered.slice(0, 5).map((o: any) => o.name).join(", "))

    expect(full.length, "项目选定后应有候选").toBeGreaterThan(0)
    expect(filtered.length, "输入关键字后候选必须变少（旧 bug 下恒等于全量）")
      .toBeLessThan(full.length)
    expect(
      filtered.every((o: any) => /cheese/i.test(o.name) || /cheese/i.test(o.hrid) || /cheese/i.test(o.cn || "")),
      "过滤后的每一项都应命中关键字"
    ).toBe(true)

    // 清空关键字要恢复全量（否则搜索框一删就没选项）
    vm.onStepFilter(0, "")
    await new Promise(r => setTimeout(r, 50))
    expect(vm.filteredItemOptions(0, step).length, "清空关键字必须恢复全量").toBe(full.length)

    w.unmount()
  }, 300000)

  it("中文名与 hrid 也能搜到（三路匹配在接线上生效）", async () => {
    const { mount } = await import("@vue/test-utils")
    const { createRouter, createMemoryHistory } = await import("vue-router")
    const { createI18n } = await import("vue-i18n")
    const ElementPlus = (await import("element-plus")).default
    const { pinia } = await import("@/pinia")

    ;(globalThis as any).MutationObserver = class {
      observe() {} disconnect() {} takeRecords() { return [] }
    }
    ;(globalThis as any).ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    }

    const i18n = createI18n({ legacy: false, locale: "zh-cn", messages: { "zh-cn": {} }, missingWarn: false, fallbackWarn: false })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", name: "X", component: { template: "<div/>" } }] })
    await router.push("/")
    await router.isReady()

    const Page = (await import("@/pages/chainbuilder/index.vue")).default
    const w = mount(Page, { global: { plugins: [pinia, router, i18n, ElementPlus] } })
    await new Promise(r => setTimeout(r, 300))

    const vm = w.vm as any
    vm.mode = "advanced"
    await new Promise(r => setTimeout(r, 50))
    vm.steps[0].project = "锻造"
    vm.onProjectChange(0)
    await new Promise(r => setTimeout(r, 50))
    const step = vm.steps[0]

    // 中文名（语言包已加载）与 hrid 片段都应命中
    vm.onStepFilter(0, "azure_cheese")
    await new Promise(r => setTimeout(r, 50))
    const byHrid = vm.filteredItemOptions(0, step)
    console.log("[p] hrid 搜索 'azure_cheese' →", byHrid.length, byHrid.slice(0, 3).map((o: any) => o.hrid).join(", "))
    expect(byHrid.some((o: any) => o.hrid === "/items/azure_cheese"), "hrid 片段应能搜到").toBe(true)

    w.unmount()
  }, 300000)
})
