/**
 * 市场（Marketplace）相关常量。
 *
 * ## 税率
 *
 * 权威来源 1 —— 游戏客户端常量（2026-10-01 从 `www.milkywayidle.com/static/js/main.*.chunk.js` 读出）：
 * ```js
 * var br = { TAX_RATE: .04, COWBELL_TAX_RATE: .18, ... }
 * getTaxRate(e) { return e === BagOf10CowbellsItemHrid ? this.COWBELL_TAX_RATE : this.TAX_RATE }
 * ```
 * 权威来源 2 —— 游戏内 2026/9/28 补丁说明原文：
 * 「The standard market tax has been lowered from 5% to 4%.」
 *
 * 因此标准税率是 **4%**。另有 `COWBELL_TAX_RATE = 18%`，但只作用于
 * `/items/bag_of_10_cowbells` 这一件物品，本项目未涉及其定价，故不实现。
 *
 * ⚠️ 2026-10-01 之前本项目内部是**不一致**的：计算器按 5%（`0.95`）计，
 * 而强化计算与强化页按 2%（`0.98` / `MARKET_TAX_PERCENT = 2`）计。现已统一到本文件。
 *
 * 另：客户端结算用的是**向下取整**
 * （`quantity * Math.floor((1 - taxRate) * price)`，见 `marketplacePanel.youGetOrMore`）；
 * 本项目为保持既有价格口径未做 floor，只使用税后系数。
 */

/** 标准市场成交税率（4%）。 */
export const MARKET_TAX_RATE = 0.04

/** 税后系数 = 1 − 税率。收入一律按「标价 × MARKET_TAX_FACTOR」计。 */
export const MARKET_TAX_FACTOR = 1 - MARKET_TAX_RATE
