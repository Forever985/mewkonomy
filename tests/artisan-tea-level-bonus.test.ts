import { describe, expect, it, beforeAll } from "vitest"
import { toRaw, nextTick } from "vue"
import { loadTestGameData } from "./utils/load-game-data"

/**
 * 工匠茶的「装备要求等级 +5」是**代价**，不应该被暴饮（drinkConcentration）放大。
 *
 * 游戏数据里工匠茶（/items/artisan_tea）一次给两个 buff：
 *   /buff_types/artisan      flatBoost 0.1  ← 有益增益，**吃**暴饮浓度
 *   /buff_types/action_level flatBoost 5    ← 代价：要求等级 +5，**不吃**暴饮浓度
 * 早期实现在 getActionLevelBonusOf 里也对它乘了 (1 + 浓度)，
 * 于是穿上暴饮之囊（drinkConcentration +0.1）后门槛变成 +5.5，是错的。
 */
describe("工匠茶的要求等级加成不受暴饮影响", () => {
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

  /** 穿上/脱下暴饮之囊：config 的 watch 不是 deep，必须整体换一个 config 引用才会重算 buff */
  async function setPouch(hrid: string | null) {
    const { usePlayerStore } = await import("@/pinia/stores/player")
    const store = usePlayerStore()
    const raw = structuredClone(toRaw(store.config))
    raw.specialEquimentMap = new Map(raw.specialEquimentMap as any)
    if (hrid) {
      raw.specialEquimentMap.set("pouch", { type: "pouch", hrid, enhanceLevel: 0 } as any)
    } else {
      raw.specialEquimentMap.delete("pouch")
    }
    store.config = raw as any
    await nextTick()
    await new Promise(r => setTimeout(r, 0))
  }

  it("工匠茶的要求等级加成恒为 +5；暴饮只放大它的有益增益", async () => {
    const player = await import("@/common/apis/player")

    // 先确认这个动作确实默认喝工匠茶（crafting 的茶配置含 artisan_tea）
    expect(player.getActionConfigOf("crafting").tea).toContain("/items/artisan_tea")

    await setPouch(null)
    const concWithout = player.getDrinkConcentration()
    const bonusWithout = player.getActionLevelBonusOf("crafting")
    const artisanWithout = player.getBuffOf("crafting", "Artisan")

    await setPouch("/items/guzzling_pouch")
    const concWith = player.getDrinkConcentration()
    const bonusWith = player.getActionLevelBonusOf("crafting")
    const artisanWith = player.getBuffOf("crafting", "Artisan")

    // eslint-disable-next-line no-console
    console.log(
      `浓度 ${concWithout} -> ${concWith}`
      + ` | 要求等级加成 ${bonusWithout} -> ${bonusWith}`
      + ` | artisan 增益 ${artisanWithout} -> ${artisanWith}`
    )

    // 暴饮之囊确实生效（否则本用例没有验证力）
    expect(concWith).toBeGreaterThan(concWithout)
    // 关键断言①：要求等级加成不受浓度影响，穿囊前后都是 5
    expect(bonusWithout).toBe(5)
    expect(bonusWith).toBe(5)
    // 关键断言②：有益增益（artisan）确实被浓度放大了
    expect(artisanWith).toBeGreaterThan(artisanWithout)

    await setPouch(null)
  }, 300000)
})
