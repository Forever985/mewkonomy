import { describe, expect, it, beforeAll } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"

/**
 * 「排除装备 / 排除首饰」互相独立的回归测试
 *
 * 修正前的缺陷（用户报「排除首饰没用」）：
 *   两者是**包含关系** —— `banEquipment` 直接按 `isEquipment` 剔除，而首饰（项链/戒指/耳环）
 *   的 categoryHrid 同样是 /item_categories/equipment，于是首饰被一并剔除。
 *   后果：只要勾了「排除装备」，「排除首饰」就完全变成空操作。
 *   而 利润排行(dashboard) 与 制作炼金(manualchemy) 的默认值恰好是 `banEquipment: true`，
 *   所以这两页上勾「排除首饰」**永远看不到任何变化**。
 *
 * 修正后的语义（并保持「两个都勾 = 排除全部装备」与修正前一致）：
 *   排除装备 -> 只去掉非首饰装备，保留项链/戒指/耳环
 *   排除首饰 -> 只去掉项链/戒指/耳环
 *   两个都勾 -> 排除全部装备
 */
describe("排除装备 / 排除首饰 互相独立", () => {
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

  it("handleSearch：四个开关可自由组合，互不吞并", async () => {
    const { handleSearch } = await import("@/common/apis/utils")
    const { isJewelry, getEquipmentTypeOf } = await import("@/common/utils/game")
    const { EnhanceCalculator } = await import("@/calculator/enhance")
    const { getGameDataApi } = await import("@/common/apis/game")

    const gd = getGameDataApi()
    // 用全部可强化物品构造计算器（不手工挑样本，避免单点样本失真）
    const all = Object.values(gd.itemDetailMap)
      .filter((i: any) => i.enhancementCosts)
      .map((i: any) => new EnhanceCalculator({ hrid: i.hrid, enhanceLevel: 1, protectLevel: 1 } as any))
      .filter((c) => c.available)

    const jewelry = all.filter((c) => isJewelry(c.item))
    const nonJewelryEquip = all.filter((c) => c.isEquipment && !isJewelry(c.item))
    const nonEquip = all.filter((c) => !c.isEquipment)

    console.log(
      `[ban] 样本 总数=${all.length} 首饰=${jewelry.length} 非首饰装备=${nonJewelryEquip.length} 非装备=${nonEquip.length}`
    )
    // 前置：样本里三类都要有，否则测试没有意义
    expect(jewelry.length, "样本中应存在首饰").toBeGreaterThan(0)
    expect(nonJewelryEquip.length, "样本中应存在非首饰装备").toBeGreaterThan(0)
    expect(jewelry.every((c) => ["neck", "ring", "earrings"].includes(getEquipmentTypeOf(c.item) as string))).toBe(true)

    const kept = (params: any) => handleSearch(all, params)

    // 1) 不过滤：全部保留
    expect(kept({}).length).toBe(all.length)

    // 2) 只排除首饰：首饰归零，非首饰装备与非装备都保留 —— 修正前后都正常
    const onlyJewelry = kept({ banJewelry: true })
    expect(onlyJewelry.filter((c) => isJewelry(c.item)).length, "banJewelry 后不应有首饰").toBe(0)
    expect(onlyJewelry.length).toBe(all.length - jewelry.length)

    // 3) 只排除装备：非首饰装备归零，**首饰必须保留** —— 修正前这里是错的
    const onlyEquip = kept({ banEquipment: true })
    expect(onlyEquip.filter((c) => c.isEquipment && !isJewelry(c.item)).length, "banEquipment 应剔除非首饰装备").toBe(0)
    expect(
      onlyEquip.filter((c) => isJewelry(c.item)).length,
      "banEquipment 不应吞并首饰（否则「排除首饰」会变成空操作）"
    ).toBe(jewelry.length)

    // 4) 两个都勾：全部装备被排除（与修正前「只勾排除装备」的结果一致，保持兼容）
    const both = kept({ banEquipment: true, banJewelry: true })
    expect(both.filter((c) => c.isEquipment).length, "两个都勾应排除全部装备").toBe(0)
    expect(both.length).toBe(nonEquip.length)
  })

  it("leaderboard API：banEquipment 不再吞并首饰，两个都勾才等于「排除全部装备」", async () => {
    const { getLeaderboardDataApi } = await import("@/common/apis/leaderboard")
    const { isJewelry } = await import("@/common/utils/game")

    const call = async (extra: any) => {
      const r = await getLeaderboardDataApi({ currentPage: 1, size: 50000, ...extra } as any)
      const jw = r.list.filter((c: any) => isJewelry(c.item)).length
      return { total: r.total, jewelry: jw }
    }

    const base = await call({})
    const onlyEquip = await call({ banEquipment: true })
    const onlyJewelry = await call({ banJewelry: true })
    const both = await call({ banEquipment: true, banJewelry: true })

    console.log(`[ban] base=${base.total}(首饰${base.jewelry}) 仅排除装备=${onlyEquip.total}(首饰${onlyEquip.jewelry}) 仅排除首饰=${onlyJewelry.total} 两者=${both.total}`)

    expect(base.jewelry, "无过滤时应存在首饰条目").toBeGreaterThan(0)
    // 修正前 onlyEquip.jewelry === 0（首饰被吞并）；现在必须保留
    expect(onlyEquip.jewelry, "banEquipment 后应仍保留首饰").toBeGreaterThan(0)
    expect(onlyJewelry.jewelry, "banJewelry 后不应有首饰").toBe(0)
    expect(both.jewelry, "两个都勾后不应有首饰").toBe(0)

    // 集合关系：设 E=非首饰装备, J=首饰；onlyEquip=base-E, onlyJewelry=base-J, both=base-E-J
    //   => both = onlyEquip + onlyJewelry - base
    expect(both.total, "两者都勾应等于两个集合的并集被排除").toBe(onlyEquip.total + onlyJewelry.total - base.total)
  })
})
