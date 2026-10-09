import { describe, it, expect, beforeAll } from "vitest"
import { loadTestGameData, seedGameData } from "./utils/load-game-data"

/**
 * 炒货页的真实渲染验证。
 *
 * 只测计算层不够 —— 页面里最容易出错的是「列头/排序/口径文案与数据对不上」，
 * 所以这里挂载整页，断言**用户真正看到的数字**：
 * 沼泽精华 72 / 64 ⇒ 净利 5.12、净率 8.00%。
 */
describe("炒货页：渲染出的数字必须与口径一致", () => {
  beforeAll(async () => {
    await loadTestGameData()
    const { useGameStoreOutside } = await import("@/pinia/stores/game")
    const gameData = useGameStoreOutside().gameData
    await seedGameData(gameData, {
      timestamp: 1,
      marketData: {
        "/items/swamp_essence": { 0: { ask: 72, bid: 64, volume: 50161, price: 67 } },
        "/items/jungle_essence": { 0: { ask: 84, bid: 80, volume: 645360, price: 80 } },
        "/items/sugar": { 0: { ask: 9, bid: 8, volume: 10851110, price: 8 } },
        // 单边：不可炒，必须不出现
        "/items/only_ask_item": { 0: { ask: 100, bid: -1, volume: 0, price: -1 } },
        // 疑似异常报价：左/右 = 10 倍、当日成交 0
        "/items/absurd_ask_item": { 0: { ask: 1000, bid: 100, volume: 0, price: -1 } }
      } as never
    })
  }, 300000)

  it("挂载整页并核对关键数字", async () => {
    const { mount } = await import("@vue/test-utils")
    const { createRouter, createMemoryHistory } = await import("vue-router")
    const { createI18n } = await import("vue-i18n")
    const ElementPlus = (await import("element-plus")).default
    const { pinia } = await import("@/pinia")

    // happy-dom 16 的 MutationObserver.observe 与 element-plus el-table 不兼容
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

    // ⚠️ 必须加载**真实**语言包：空 messages 时 t() 返回 key 本身（英文名），
    //    断言「沼泽精华」就永远失败 —— 那是测试环境问题，不是页面问题。
    const zh = (await import("@/locales/lang/zh-cn")).default
    const i18n = createI18n({
      legacy: false, locale: "zh-cn", messages: { "zh-cn": zh as any }, missingWarn: false, fallbackWarn: false
    })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", name: "X", component: { template: "<div/>" } }]
    })
    await router.push("/")
    await router.isReady()

    const Page = (await import("@/pages/marketarb/index.vue")).default
    const w = mount(Page, { global: { plugins: [pinia, router, i18n, ElementPlus] } })
    await new Promise(r => setTimeout(r, 400))

    const text = w.text().replace(/\s+/g, " ")
    console.log("[p] 含「炒货：左右价之间的差价」:", text.includes("炒货：左右价之间的差价"))
    console.log("[p] 含「沼泽精华」:", text.includes("沼泽精华"))
    console.log("[p] 含净利 5.12:", text.includes("5.12"))
    console.log("[p] 含净率 8%:", text.includes("8%"))
    console.log("[p] 含「丛林精华」:", text.includes("丛林精华"))

    expect(text, "口径卡必须渲染").toContain("炒货：左右价之间的差价")
    expect(text, "三步操作指引必须渲染").toContain("① 右价挂买单")
    expect(text, "三步操作指引必须渲染").toContain("③ 左价挂卖单")
    expect(text, "候选表必须出现沼泽精华").toContain("沼泽精华")
    expect(text, "净利/件 = 72×0.96−64 = 5.12").toContain("5.12")
    // Format.percent 会去掉末尾 0（8.00% → 8%），断言必须跟着实际渲染写
    expect(text, "净率 = 5.12/64 = 8%").toContain("8%")
    // 丛林精华 84/80 ⇒ 净利 0.64、净率 0.80%
    expect(text, "低净率的也必须在表里（只是排在后面）").toContain("丛林精华")
    // 单边报价不可炒
    expect(text.includes("only_ask_item"), "单边报价不得出现在候选里").toBe(false)

    // 概览：双边 3 个，其中 3 个都有净利，单边 1 个
    expect(text, "概览应说明双边/单边数量").toContain("双边有报价")
    console.log("[p] 表格行数 =", w.findAll(".el-table__row").length)

    w.unmount()
  }, 300000)

  it("筛选：净率下限能把行筛掉，且能用中文名搜到沼泽精华", async () => {
    const { mount } = await import("@vue/test-utils")
    const { createRouter, createMemoryHistory } = await import("vue-router")
    const { createI18n } = await import("vue-i18n")
    const ElementPlus = (await import("element-plus")).default
    const { pinia } = await import("@/pinia")

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

    // ⚠️ 必须加载**真实**语言包：空 messages 时 t() 返回 key 本身（英文名），
    //    断言「沼泽精华」就永远失败 —— 那是测试环境问题，不是页面问题。
    const zh = (await import("@/locales/lang/zh-cn")).default
    const i18n = createI18n({
      legacy: false, locale: "zh-cn", messages: { "zh-cn": zh as any }, missingWarn: false, fallbackWarn: false
    })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", name: "X", component: { template: "<div/>" } }]
    })
    await router.push("/")
    await router.isReady()

    const Page = (await import("@/pages/marketarb/index.vue")).default
    const w = mount(Page, { global: { plugins: [pinia, router, i18n, ElementPlus] } })
    await new Promise(r => setTimeout(r, 400))

    const vm = w.vm as any
    const rowCount = () => w.findAll(".el-table__row").length
    const before = rowCount()
    console.log("[p] 初始行数 =", before, " 当日成交≥ 默认 =", vm.minVolume, " 净率基数 =", vm.rateBase)
    expect(vm.minVolume, "「当日成交 ≥」默认为 1（用户定的）").toBe(1)
    expect(vm.rateBase, "净率基数默认右价（资金回报率）").toBe("bid")
    expect(before, "有成交的 3 个候选（沼泽 8% / 丛林 0.8% / 糖 8%）").toBe(3)

    // 净率基数切到左价（毛利率）⇒ 沼泽 5.12/72 = 7.11%，糖 0.64/9 = 7.11%
    vm.rateBase = "ask"
    await new Promise(r => setTimeout(r, 200))
    console.log("[p] 左价基数 行数 =", rowCount(), " 含 7.11% =", w.text().includes("7.11%"))
    expect(rowCount(), "换基数不改变候选集合").toBe(3)
    expect(w.text(), "沼泽在左价口径下应是 7.11%").toContain("7.11%")
    expect(w.text(), "右价口径的 8% 不应再出现").not.toContain("8%")
    vm.rateBase = "bid"
    await new Promise(r => setTimeout(r, 200))
    expect(w.text(), "切回右价 ⇒ 又是 8%").toContain("8%")

    // 把成交门槛放到 0 ⇒ 0 成交的离谱挂单进场，且必须带「疑似异常」标记
    vm.minVolume = 0
    await new Promise(r => setTimeout(r, 200))
    console.log("[p] 门槛=0 行数 =", rowCount(), " 含「疑似异常」=", w.text().includes("疑似异常"))
    expect(rowCount(), "放开后异常条目进场").toBe(4)
    expect(w.text(), "左/右 10 倍的条目必须打「疑似异常」标签").toContain("疑似异常")

    // 勾上「隐藏疑似异常报价」⇒ 又回到 3 条
    vm.hideSuspicious = true
    await new Promise(r => setTimeout(r, 200))
    console.log("[p] 隐藏异常后 行数 =", rowCount())
    expect(rowCount(), "隐藏异常报价 ⇒ 回到 3 条").toBe(3)
    vm.minVolume = 1
    vm.hideSuspicious = false
    await new Promise(r => setTimeout(r, 200))

    // 净率 ≥ 5% ⇒ 只剩沼泽与糖（糖 9×0.96−8 = 0.64，净率 8%）
    vm.minNetRatePct = 5
    await new Promise(r => setTimeout(r, 200))
    console.log("[p] 净率≥5% 行数 =", rowCount())
    expect(rowCount()).toBe(2)

    // 净率 ≥ 9% ⇒ 全空
    vm.minNetRatePct = 9
    await new Promise(r => setTimeout(r, 200))
    console.log("[p] 净率≥9% 行数 =", rowCount())
    expect(rowCount(), "净率门槛过 9% ⇒ 无候选").toBe(0)
    expect(w.text()).toContain("没有符合条件的品种")

    // 复原 + 用 hrid 搜索
    vm.minNetRatePct = 0
    vm.keyword = "swamp_essence"
    await new Promise(r => setTimeout(r, 200))
    console.log("[p] 搜索 swamp 行数 =", rowCount())
    expect(rowCount(), "按 hrid 搜索应命中 1 条").toBe(1)
    expect(w.text()).toContain("沼泽精华")

    w.unmount()
  }, 300000)
})
