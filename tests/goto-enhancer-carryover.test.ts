import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest"
import { createRouter, createMemoryHistory } from "vue-router"
import { createI18n } from "vue-i18n"
import ElementPlus from "element-plus"
import { loadTestGameData } from "./utils/load-game-data"

/**
 * ⚠️ 下面两个 store / 组件**不能提到顶层 import**：
 * `@/common/apis/game` 有模块级 `watch(..., { immediate: true })`，import 的瞬间就会
 * 调 `initBigSetCache()` → `getGameDataApi()`；若此时 gameData 还没注入就是
 * `Cannot read properties of null (reading 'actionDetailMap')`。
 * 所以一律在 `beforeAll` 装完数据之后再动态 import。
 */
const i18n = createI18n({
  legacy: false,
  locale: "zh-cn",
  messages: { "zh-cn": {} },
  missingWarn: false,
  fallbackWarn: false
})

const Blank = { template: "<div/>" }

let store: any
let A = ""
let B = ""

/** 两个真实装备：必须有 enhancementCosts，否则不是可强化物 */
function twoEquipments() {
  return import("@/common/apis/game").then(({ getGameDataApi }) => {
    const items = Object.values(getGameDataApi().itemDetailMap).filter((i: any) => i.enhancementCosts)
    return { A: (items[10] as any).hrid, B: (items[20] as any).hrid }
  })
}

async function mountEnhancer() {
  const { shallowMount } = await import("@vue/test-utils")
  const { pinia } = await import("@/pinia")
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: Blank }, { path: "/enhancer", name: "Enhancer", component: Blank }]
  })
  await router.push("/")
  await router.isReady()
  const Enhancer = (await import("@/pages/enhancer/index.vue")).default
  const w = shallowMount(Enhancer, { global: { plugins: [pinia, router, i18n, ElementPlus] } })
  await new Promise(r => setTimeout(r, 100))
  return w
}

describe("去强化：目标装备带入（组件复用场景）", () => {
  beforeAll(async () => {
    await loadTestGameData()
    const { useEnhancerStore } = await import("@/pinia/stores/enhancer")
    const { pinia } = await import("@/pinia")
    store = useEnhancerStore(pinia)
    const eq = await twoEquipments()
    A = eq.A
    B = eq.B
  }, 300000)

  beforeEach(() => {
    const local: Record<string, string> = {}
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => local[k] ?? null,
      setItem: (k: string, v: string) => { local[k] = String(v) },
      removeItem: (k: string) => { delete local[k] }
    } as any)
  })

  it("同一实例不卸载时，外部连续改 hrid 都应跟随（原缺陷点）", async () => {
    store.config.hrid = A
    const w = await mountEnhancer()
    const shown = () => (w.vm as any).currentItem?.hrid
    expect(shown(), "首次进入应带入 store 里的装备").toBe(A)

    // 关键回归点：实例未销毁（keep-alive 命中时就是这个状态），
    // 再次「去强化」写入新 hrid —— 修复前 onMounted 不会重跑，界面仍停在 A。
    store.config.hrid = B
    await new Promise(r => setTimeout(r, 100))
    expect(shown(), "同一实例内第二次点击去强化，应带入第二件装备").toBe(B)

    // 再切回第一件，验证不是「单向生效」
    store.config.hrid = A
    await new Promise(r => setTimeout(r, 100))
    expect(shown(), "第三次点击应再次跟随").toBe(A)

    // 不应自激循环：onSelect 会把 config.hrid 写回 item.hrid，
    // 若监听器无条件响应就会无限自我触发。
    await new Promise(r => setTimeout(r, 200))
    expect(shown(), "静置后不应继续变化（无自激循环）").toBe(A)

    w.unmount()
  }, 300000)

  it("只覆盖 hrid：玩家原有的等级/件数/时薪等预设必须保留", async () => {
    store.config.hrid = A
    store.config.enhanceLevel = 13
    store.config.pieceCount = 4
    store.config.hourlyRate = 8_888_888
    const w = await mountEnhancer()

    // 复刻 useLeaderboardPage.gotoEnhancer：只写 hrid
    store.config.hrid = B
    await new Promise(r => setTimeout(r, 100))

    expect((w.vm as any).currentItem?.hrid).toBe(B)
    const cfg = (w.vm as any).enhancerStore.config
    expect(cfg.enhanceLevel, "目标等级是玩家调好的计算条件，不该被跳转覆盖").toBe(13)
    expect(cfg.pieceCount, "件数同理").toBe(4)
    expect(cfg.hourlyRate, "工时费同理").toBe(8_888_888)

    w.unmount()
  }, 300000)

  it("store.hrid 解析不出物品时不崩、不清空当前选择", async () => {
    store.config.hrid = A
    const w = await mountEnhancer()
    expect((w.vm as any).currentItem?.hrid).toBe(A)

    // 写入一个不存在的 hrid：onSelect 会因 !item 直接 return
    store.config.hrid = "/items/__not_exist__"
    await new Promise(r => setTimeout(r, 100))
    expect((w.vm as any).currentItem?.hrid, "无效 hrid 不应把已有选择清掉").toBe(A)

    w.unmount()
  }, 300000)
})
