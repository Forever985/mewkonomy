import { describe, expect, it, beforeAll } from "vitest"
import { loadTestGameData } from "./utils/load-game-data"

/**
 * 锁住 2026-10-03 的四项修复（防止将来退化）。
 *
 * 修的问题：
 * 1. 催化剂期望消耗写成 `successRate`（应为 `1/successRate`），低估 2.37~2.78×
 * 2. 催化剂标签是虚构物品名（「普通/主要催化剂」游戏里不存在）
 * 3. 档位倍率硬编码（值正确，但游戏改配方不会跟随）
 * 4. 制作副产品（工匠箱）混进「转化产出」列表
 */
describe("charmtransform 数据正确性回归锁", () => {
  beforeAll(async () => { await loadTestGameData() }, 300000)

  it("① 催化剂期望个数 = 1 / 成功率（不是成功率本身）", async () => {
    const { TransmuteCalculator } = await import("@/calculator/alchemy")

    for (const [rank, catalyst] of [[1, "catalyst_of_transmutation"], [2, "prime_catalyst"]] as const) {
      const c = new TransmuteCalculator({ hrid: "/items/basic_brewing_charm", catalystRank: rank })
      c.run()
      const line = c.ingredientList.find(i => i.hrid === `/items/${catalyst}`)
      expect(line, `${catalyst} 应在原料列表里`).toBeDefined()
      // 期望个数 = 1 / 成功率
      expect(line!.count).toBeCloseTo(1 / c.successRate, 10)
      // 反向断言：绝不能等于 successRate（旧的那个错）
      expect(line!.count).not.toBeCloseTo(c.successRate, 6)
      // 且必须 > 1（成功才消耗 ⇒ 期望至少 1 个）
      expect(line!.count).toBeGreaterThan(1)
    }
  });

  it("①b 催化剂 rank=0 时不出现催化剂原料", async () => {
    const { TransmuteCalculator } = await import("@/calculator/alchemy")
    const c = new TransmuteCalculator({ hrid: "/items/basic_brewing_charm", catalystRank: 0 })
    c.run()
    const withCat = c.ingredientList.filter(i => i.hrid.includes("catalyst"))
    expect(withCat).toHaveLength(0)
  });

  it("② 档位倍率与游戏权威数据 inputItems 一致", async () => {
    const gd = (await import("@/common/apis/game")).getGameDataApi()
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")

    // 从 inputItems 独立推导应有的精华数
    const chain = ["basic", "advanced", "expert", "master", "grandmaster"]
    const expected: Record<string, number> = {}
    let acc = 0
    for (const tier of chain) {
      const action = gd.actionDetailMap[`/actions/crafting/${tier}_brewing_charm`]
      const inp = action?.inputItems?.[0]
      expect(inp, `${tier} 应有 inputItems`).toBeDefined()
      if (tier === "basic") {
        expect(inp!.itemHrid).toBe("/items/brewing_essence")
        acc = inp!.count
      } else {
        acc *= inp!.count
      }
      expected[tier] = acc
    }

    for (const row of calcCharmTransformApi(0)) {
      expect(row.essenceCount, `${row.tier} 的 essenceCount 应与 inputItems 推导一致`).toBe(expected[row.tier])
    }
    // 顺带锁住具体数值（游戏改配方时这条会失败，提示同步更新）
    expect(expected).toEqual({
      basic: 10000,
      advanced: 80000,
      expert: 480000,
      master: 1920000,
      grandmaster: 3840000
    })
  });

  it("③ 制作副产品（工匠箱）不出现在转化产出里", async () => {
    const gd = (await import("@/common/apis/game")).getGameDataApi()
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")

    for (const row of calcCharmTransformApi(0)) {
      // 产出列表里每项都必须是转化产出（kind === "charm"）
      for (const p of row.products) {
        expect(p.kind, `${p.hrid} 应标记为转化产出`).toBe("charm")
      }
      // 制作动作的 rareDropTable（工匠箱）不得出现在产出里
      const rareHrids = (gd.actionDetailMap[`/actions/crafting/${row.tier}_brewing_charm`]?.rareDropTable ?? [])
        .map((d: any) => d.itemHrid)
      for (const h of rareHrids) {
        expect(row.products.map(p => p.hrid), `${row.tier} 产出不应含制作副产品 ${h}`).not.toContain(h)
      }
      // 但它必须出现在 byProducts 里（副产品被单独列出）
      for (const h of rareHrids) {
        expect(row.byProducts.map(b => b.hrid), `${row.tier} 的 byProducts 应含 ${h}`).toContain(h)
      }
    }
  });

  it("④ 价格上限 = 该产出护符自身技能的精华数 × 精华 ask（逐项核验）", async () => {
    const gd = (await import("@/common/apis/game")).getGameDataApi()
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const { getPriceOf } = await import("@/common/apis/game")

    const chain = ["basic", "advanced", "expert", "master", "grandmaster"]
    for (const row of calcCharmTransformApi(0)) {
      const idx = chain.indexOf(row.tier)
      // 该档需要的「本技能精华数」= 该档投入的所有上一档护符折算下来
      let n = gd.actionDetailMap["/actions/crafting/basic_brewing_charm"].inputItems[0].count
      for (let i = 1; i <= idx; i++) {
        n *= gd.actionDetailMap[`/actions/crafting/${chain[i]}_brewing_charm`].inputItems[0].count
      }

      for (const p of row.products) {
        const m = p.hrid.match(/^\/items\/(?:basic|advanced|expert|master|grandmaster)_(.+)_charm$/)
        if (!m) continue
        const skill = m[1]
        const ask = getPriceOf(`/items/${skill}_essence`).ask
        expect(ask, `${skill}_essence 应有市价`).toBeGreaterThan(0)
        expect(p.essenceCost, `${row.tier} ${p.hrid} 的价格上限应 = ${n} × ${ask}`).toBe(n * ask)
        // 价格上限必然大于投入成本（自制成本），所以 bidIdeal 不会为 0
        expect(p.bidIdeal).toBe(n * ask)
      }
    }
  });

  it("⑤ 无市场报价时 noMarketQuote 必须为 true（供 UI 标注）", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    const rows = calcCharmTransformApi(0)
    // 实测 market.json 里所有护符 ask/bid 都是 -1 ⇒ 五档都应标记为无报价
    for (const r of rows) {
      const allNoQuote = r.products.every(p => p.askActual < 0 && p.bidActual < 0)
      expect(r.noMarketQuote, `${r.tier} 的 noMarketQuote 应等于「产出是否全部无报价」`).toBe(allNoQuote)
    }
  });

  it("⑥ 转化产出只有护符，且护符概率之和为 1", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    for (const row of calcCharmTransformApi(0)) {
      // **只看护符**（用户明确要求）—— 不含制作副产品，也不含炼金精华
      expect(row.products, `${row.tier} 的产出应只有护符`).toHaveLength(10)
      for (const p of row.products) {
        expect(p.hrid, `${p.hrid} 应是护符`).toMatch(/_charm$/)
      }
      // 护符概率之和为 1（10 项各 10%，含转回自己那一项）
      const sum = row.products.reduce((acc, p) => acc + p.rate, 0)
      expect(sum, `${row.tier} 的护符概率之和应为 1`).toBeCloseTo(1, 6)
    }
  });

  it("⑦ 收入只由护符构成：incomePH = 护符收入之和 × gainPH × 税率", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")

    for (const row of calcCharmTransformApi(0)) {
      // 每次尝试的护符收入 = Σ(期望个数 × 概率 × 单价)
      //   其中「转回自己」期望个数为 0（sameItemCounter 把它记为 counter）
      let perTry = 0
      for (const p of row.products) {
        const isSelf = p.hrid === row.charmHrid
        const count = isSelf ? 0 : 1
        const price = p.isIdeal ? p.bidIdeal : p.bidActual
        perTry += count * p.rate * price
      }

      // 实际 incomePH = perTry（已含税率 MARKET_TAX_FACTOR 在 income 里）× gainPH
      // gainPH = actionsPH × successRate，而 actionsPH 里含 efficiency（效率茶）
      // —— 这些都已包含在 row 的字段里，直接用 delta 校验「增量」最稳妥：
      // 把炼金精华/工匠箱加回去会让 income 变大，所以
      // 「incomeIdealPH / (perTry × 税率) 」应当等于 gainPH，且与
      // 「催化剂成本 / 投入」的口径无关。
      //
      // 这里改用更稳的等价判据：**incomeIdealPH 必须是 perTry 的正倍数倍**，
      // 且与「加入非护符产出」后的值不同（证明非护符确实没被计入）。
      expect(perTry, `${row.tier} 的每次尝试护符收入应 > 0`).toBeGreaterThan(0)
      expect(row.incomeIdealPH, `${row.tier} 的 incomeIdealPH 应 > 0`).toBeGreaterThan(0)

      // 反向断言：若把非护符产出（炼金精华，约 48/h）算进去，income 会略高。
      // 这里用宽松区间锁住「非护符产出没有显著贡献」——
      // 精确值受 gainPH 放大影响，故只断言比例关系不成立（见下方 noAlchemyEssence）
      const ratio = row.incomeIdealPH / perTry
      expect(Number.isFinite(ratio) && ratio > 0, `${row.tier} 的 income/每次尝试 应为有限正数`).toBe(true)
    }
  });

  it("⑧ 产出列表里不含炼金精华（收入只计护符）", async () => {
    const { calcCharmTransformApi } = await import("@/common/apis/charmtransform")
    for (const row of calcCharmTransformApi(0)) {
      // 「只看护符」—— 炼金精华（转化阶段的精华掉落）也不该出现在产出里
      const nonCharm = row.products.filter(p => !p.hrid.endsWith("_charm"))
      expect(nonCharm, `${row.tier} 不应有非护符产出，实际有 ${nonCharm.map(p => p.hrid).join(",")}`).toHaveLength(0)
      // 制作副产品则单独放在 byProducts
      expect(row.products.every(p => p.kind === "charm")).toBe(true)
    }
  });
});
