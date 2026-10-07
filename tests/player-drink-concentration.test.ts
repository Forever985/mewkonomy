import { describe, it, expect, beforeAll } from "vitest"
import { nextTick, toRaw } from "vue"
import { loadLiveMarketOrFake } from "./utils/live-market"

/**
 * 暴饮之囊（`/items/guzzling_pouch`）的「饮品浓度」语义 —— 用户 2026-10-07 追问：
 * 「怎么感觉你的暴饮之囊的浓度是直接相加的呢？」
 *
 * ## 结论：是**乘数**（×(1+浓度)），不是加数（+浓度）
 *
 * 官方客户端原文（`main.*.chunk.js`，物品说明表）：
 *   「Drink Concentration: Increases drink effect. Reduces duration and cooldown.」
 *
 * 两个方向都**乘 (1+浓度)**：
 *   ① 增益强度 × (1 + 浓度)  —— 效率茶 10% ⇒ **11%**（**不是** 10% + 10% = 20%）
 *   ② 时长     ÷ (1 + 浓度)  —— 300 秒 ⇒ 272.7 秒 ⇒ 喝得更频繁：12 杯/h ⇒ **13.2 杯/h**
 *
 * ## 唯一合理的「相加」在哪
 *
 * 装备属性 = **基础值 + 强化加成**（官方数据里的模型）：
 *   `noncombatStats.drinkConcentration = 0.1`
 *   `noncombatEnhancementBonuses.drinkConcentration = 0.002`
 *   强化 `+10` 时乘 `enhancementLevelTotalBonusMultiplierTable[10] = 14.5`
 *   ⇒ 0.1 + 0.002 × 14.5 = **0.129**
 * 这与「浓度本身被相加」是两码事 —— 前者是装备属性模型，后者是错的。
 */
describe("暴饮之囊：浓度是乘数，不是加数", () => {
  beforeAll(async () => {
    await loadLiveMarketOrFake()
  }, 300000)

  /** 穿上/脱下暴饮之囊（config 的 watch 不是 deep，必须整体换 config 引用） */
  async function setPouch(hrid: string | null, enhanceLevel = 0) {
    const { usePlayerStore } = await import("@/pinia/stores/player")
    const store = usePlayerStore()
    const raw = structuredClone(toRaw(store.config))
    raw.specialEquimentMap = new Map(raw.specialEquimentMap as any)
    if (hrid) {
      raw.specialEquimentMap.set("pouch", { type: "pouch", hrid, enhanceLevel } as any)
    } else {
      raw.specialEquimentMap.delete("pouch")
    }
    store.config = raw as any
    await nextTick()
    await new Promise(r => setTimeout(r, 0))
  }

  it("① 浓度来源 = 基础值 + 强化加成（装备属性模型）", async () => {
    const player = await import("@/common/apis/player")
    const game = await import("@/common/apis/game")
    const gd = game.getGameDataApi()
    const table = gd.enhancementLevelTotalBonusMultiplierTable as unknown as number[]

    await setPouch(null)
    console.log("[p] 无囊 dc =", player.getDrinkConcentration())
    expect(player.getDrinkConcentration(), "没装囊就不该有浓度").toBe(0)

    await setPouch("/items/guzzling_pouch", 0)
    const base = player.getDrinkConcentration()
    console.log("[p] 暴饮之囊 +0 dc =", base)
    expect(base).toBeCloseTo(0.1, 9)

    await setPouch("/items/guzzling_pouch", 10)
    const withEnh = player.getDrinkConcentration()
    const expected = 0.1 + 0.002 * table[10]
    console.log("[p] 暴饮之囊 +10 dc =", withEnh, " 期望 0.1 + 0.002 ×", table[10], "=", expected)
    expect(withEnh).toBeCloseTo(expected, 9)

    await setPouch(null)
  }, 300000)

  it("② 增益强度是 ×(1+浓度)，不是 +(浓度)", async () => {
    const player = await import("@/common/apis/player")
    const game = await import("@/common/apis/game")
    const gd = game.getGameDataApi()
    const action = "alchemy" as any

    // 效率茶 flatBoost = 0.1（官方数据）
    const tea = gd.itemDetailMap["/items/efficiency_tea"].consumableDetail!.buffs![0]
    console.log("[p] 效率茶 flatBoost =", tea.flatBoost)
    expect(tea.flatBoost).toBeCloseTo(0.1, 9)

    await setPouch(null)
    const noPouch = player.getBuffOf(action, "Efficiency")

    await setPouch("/items/guzzling_pouch", 0)
    const dc = player.getDrinkConcentration()
    const withPouch = player.getBuffOf(action, "Efficiency")

    const delta = withPouch - noPouch
    console.log("[p] 效率 buff: 无囊 =", noPouch, " 带囊 =", withPouch, " 增量 =", delta)
    console.log("[p] 乘算预期 = flatBoost × dc =", tea.flatBoost! * dc)
    console.log("[p] 加算预期 = dc =", dc, "（若增量等于它，说明写成了相加）")

    // 乘算：(1+dc) 只把 0.1 放大到 0.11 ⇒ 增量 = 0.1 × 0.1 = 0.01
    expect(delta, "增益增量必须等于 flatBoost × dc（乘算）").toBeCloseTo(tea.flatBoost! * dc, 9)
    // ⚠️ 反向守卫：加算会让增量 = dc = 0.1，两者差一个数量级
    expect(delta, "若等于 dc 本身，就是被写成了『直接相加』").toBeLessThan(dc / 2)

    await setPouch(null)
  }, 300000)

  it("③ 饮品消耗也是 ×(1+浓度)：12 杯/h ⇒ 13.2 杯/h", async () => {
    const player = await import("@/common/apis/player")
    const api = await import("@/common/apis/chainbuilder")
    const cal: any = api.buildChainCalculator({
      project: "转化", action: "alchemy", kind: "transmute",
      hrid: "/items/crushed_philosophers_stone", catalystRank: 1
    } as any)

    await setPouch(null)
    const cups0 = player.getTeaIngredientList(cal).map(i => i.count * cal.consumePH)
    console.log("[p] 无囊 杯/h =", cups0.map(v => v.toFixed(3)).join(", "))

    await setPouch("/items/guzzling_pouch", 0)
    const dc = player.getDrinkConcentration()
    const cups1 = player.getTeaIngredientList(cal).map(i => i.count * cal.consumePH)
    console.log("[p] 带囊 杯/h =", cups1.map(v => v.toFixed(3)).join(", "),
      " 比值 =", (cups1[0] / cups0[0]).toFixed(6))

    expect(cups0[0], "基准应是 3600/300 = 12 杯/h").toBeCloseTo(12, 6)
    expect(cups1[0], "带 +10% 浓度 ⇒ 12 × 1.1 = 13.2").toBeCloseTo(12 * (1 + dc), 6)

    await setPouch(null)
  }, 300000)
})
