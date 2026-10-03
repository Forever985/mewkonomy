import { describe, expect, it, beforeAll } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"

/**
 * 「排除装备 / 排除首饰 / 排除护符」三者互相独立的回归测试
 *
 * 修正前的缺陷（用户报「排除首饰没用」）：
 *   两者是**包含关系** —— `banEquipment` 直接按 `isEquipment` 剔除，而首饰（项链/戒指/耳环）
 *   的 categoryHrid 同样是 /item_categories/equipment，于是首饰被一并剔除。
 *   后果：只要勾了「排除装备」，「排除首饰」就完全变成空操作。
 *   而 利润排行(dashboard) 与 制作炼金(manualchemy) 的默认值恰好是 `banEquipment: true`，
 *   所以这两页上勾「排除首饰」**永远看不到任何变化**。
 *
 * 2026-10-02 又把**护符**（`/equipment_types/charm`，实测 102 件、占全部装备 19%）按同一原则
 * 摘出来做成 `banCharm`。因此本文件的期望值一并调整：
 *   banEquipment 现在**既不吞并首饰、也不吞并护符**。
 *
 * 现行语义：
 *   排除装备 -> 只去掉「既非首饰、也非护符」的装备，保留项链/戒指/耳环/**护符**
 *   排除首饰 -> 只去掉项链/戒指/耳环
 *   排除护符 -> 只去掉护符
 *   三个都勾 -> 排除全部装备（与最早「只勾排除装备」的结果一致，保持兼容）
 *
 * ⚠️ 为保持各页**默认行为不变**，`banCharm` 的默认值取与同页 `banEquipment` 相同
 * （dashboard / manualchemy 默认 true，其余 false）。本文件只测过滤语义，不测各页默认值。
 */
describe("排除装备 / 排除首饰 互相独立", () => {
  beforeAll(async () => {
    await loadTestGameData()
  }, 300000)

  it("handleSearch：五个开关可自由组合，互不吞并", async () => {
    const { handleSearch } = await import("@/common/apis/utils")
    const { isCharm, isJewelry, getEquipmentTypeOf } = await import("@/common/utils/game")
    const { EnhanceCalculator } = await import("@/calculator/enhance")
    const { getGameDataApi } = await import("@/common/apis/game")

    const gd = getGameDataApi()
    // 用全部可强化物品构造计算器（不手工挑样本，避免单点样本失真）
    const all = Object.values(gd.itemDetailMap)
      .filter((i: any) => i.enhancementCosts)
      .map((i: any) => new EnhanceCalculator({ hrid: i.hrid, enhanceLevel: 1, protectLevel: 1 } as any))
      .filter((c) => c.available)

    const jewelry = all.filter((c) => isJewelry(c.item))
    const charm = all.filter((c) => isCharm(c.item))
    // 「普通装备」= 既非首饰也非护符的那部分，这才是 banEquipment 现在负责的范围
    const plainEquip = all.filter((c) => c.isEquipment && !isJewelry(c.item) && !isCharm(c.item))
    const nonEquip = all.filter((c) => !c.isEquipment)

    console.log(
      `[ban] 样本 总数=${all.length} 首饰=${jewelry.length} 护符=${charm.length} 普通装备=${plainEquip.length} 非装备=${nonEquip.length}`
    )
    // 前置：样本里各类都要有，否则测试没有意义
    expect(jewelry.length, "样本中应存在首饰").toBeGreaterThan(0)
    expect(charm.length, "样本中应存在护符").toBeGreaterThan(0)
    expect(plainEquip.length, "样本中应存在普通装备").toBeGreaterThan(0)
    expect(jewelry.every((c) => ["neck", "ring", "earrings"].includes(getEquipmentTypeOf(c.item) as string))).toBe(true)
    expect(charm.every((c) => getEquipmentTypeOf(c.item) === "charm")).toBe(true)
    // 两类互不相交：否则「独立开关」的前提就不成立
    expect(jewelry.filter((c) => isCharm(c.item)).length, "首饰与护符不应重叠").toBe(0)

    const kept = (params: any) => handleSearch(all, params)

    // 1) 不过滤：全部保留
    expect(kept({}).length).toBe(all.length)

    // 2) 只排除首饰：首饰归零，其余全保留
    const onlyJewelry = kept({ banJewelry: true })
    expect(onlyJewelry.filter((c) => isJewelry(c.item)).length, "banJewelry 后不应有首饰").toBe(0)
    expect(onlyJewelry.length).toBe(all.length - jewelry.length)

    // 3) 只排除护符：护符归零，首饰不动（新增能力的关键断言）
    const onlyCharm = kept({ banCharm: true })
    expect(onlyCharm.filter((c) => isCharm(c.item)).length, "banCharm 后不应有护符").toBe(0)
    expect(onlyCharm.filter((c) => isJewelry(c.item)).length, "banCharm 不应影响首饰").toBe(jewelry.length)
    expect(onlyCharm.length).toBe(all.length - charm.length)

    // 4) 只排除装备：普通装备归零，**首饰与护符都必须保留**
    //    （修正前这里会连首饰一起剔掉；护符则是 2026-10-02 才摘出来的）
    const onlyEquip = kept({ banEquipment: true })
    expect(onlyEquip.filter((c) => c.isEquipment && !isJewelry(c.item) && !isCharm(c.item)).length, "banEquipment 应剔除普通装备").toBe(0)
    expect(
      onlyEquip.filter((c) => isJewelry(c.item)).length,
      "banEquipment 不应吞并首饰（否则「排除首饰」会变成空操作）"
    ).toBe(jewelry.length)
    expect(
      onlyEquip.filter((c) => isCharm(c.item)).length,
      "banEquipment 不应吞并护符（否则「排除护符」会变成空操作）"
    ).toBe(charm.length)

    // 5) 排除装备 + 排除首饰：只剩护符与非装备
    const equipAndJewelry = kept({ banEquipment: true, banJewelry: true })
    expect(equipAndJewelry.filter((c) => isJewelry(c.item)).length, "应无首饰").toBe(0)
    expect(equipAndJewelry.filter((c) => isCharm(c.item)).length, "此时护符仍应保留").toBe(charm.length)

    // 6) 三个都勾：全部装备被排除（与最早「只勾排除装备」的结果一致，保持兼容）
    const allThree = kept({ banEquipment: true, banJewelry: true, banCharm: true })
    expect(allThree.filter((c) => c.isEquipment).length, "三个都勾应排除全部装备").toBe(0)
    expect(allThree.length).toBe(nonEquip.length)
  })

  it("leaderboard API：banEquipment 不再吞并首饰与护符，三个都勾才等于「排除全部装备」", async () => {
    const { getLeaderboardDataApi } = await import("@/common/apis/leaderboard")
    const { isCharm, isJewelry } = await import("@/common/utils/game")

    const call = async (extra: any) => {
      const r = await getLeaderboardDataApi({ currentPage: 1, size: 50000, ...extra } as any)
      const jw = r.list.filter((c: any) => isJewelry(c.item)).length
      const ch = r.list.filter((c: any) => isCharm(c.item)).length
      return { total: r.total, jewelry: jw, charm: ch }
    }

    const base = await call({})
    const onlyEquip = await call({ banEquipment: true })
    const onlyJewelry = await call({ banJewelry: true })
    const onlyCharm = await call({ banCharm: true })
    const equipAndJewelry = await call({ banEquipment: true, banJewelry: true })
    const allThree = await call({ banEquipment: true, banJewelry: true, banCharm: true })

    console.log(
      `[ban] base=${base.total}(首饰${base.jewelry}/护符${base.charm})`
      + ` 仅排除装备=${onlyEquip.total}(首饰${onlyEquip.jewelry}/护符${onlyEquip.charm})`
      + ` 仅排除首饰=${onlyJewelry.total} 仅排除护符=${onlyCharm.total}`
      + ` 装备+首饰=${equipAndJewelry.total} 三者=${allThree.total}`
    )

    expect(base.jewelry, "无过滤时应存在首饰条目").toBeGreaterThan(0)
    expect(base.charm, "无过滤时应存在护符条目").toBeGreaterThan(0)
    // 修正前 onlyEquip.jewelry === 0（首饰被吞并）；现在必须保留
    expect(onlyEquip.jewelry, "banEquipment 后应仍保留首饰").toBeGreaterThan(0)
    expect(onlyEquip.charm, "banEquipment 后应仍保留护符").toBeGreaterThan(0)
    expect(onlyJewelry.jewelry, "banJewelry 后不应有首饰").toBe(0)
    expect(onlyCharm.charm, "banCharm 后不应有护符").toBe(0)
    expect(onlyCharm.jewelry, "banCharm 不应影响首饰").toBe(base.jewelry)
    expect(equipAndJewelry.jewelry, "排除首饰后不应有首饰").toBe(0)
    expect(equipAndJewelry.charm, "此时护符仍应保留").toBeGreaterThan(0)
    expect(allThree.jewelry + allThree.charm, "三者都勾后不应有首饰与护符").toBe(0)

    // 集合关系：设 E=普通装备, J=首饰, C=护符
    //   onlyEquip/base 去掉 E；onlyJewelry 去掉 J；onlyCharm 去掉 C
    //   => allThree = onlyEquip + onlyJewelry + onlyCharm - 2*base
    expect(
      allThree.total,
      "三者都勾应等于三个集合的并集被排除"
    ).toBe(onlyEquip.total + onlyJewelry.total + onlyCharm.total - 2 * base.total)
  })
})
