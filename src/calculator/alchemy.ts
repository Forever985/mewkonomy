import type { CalculatorConfig, Ingredient, Product } from "."
import { getAlchemyDecomposeEnhancingEssenceOutput, getAlchemyEssenceDropTable, getAlchemyRareDropTable, getCoinifyExp, getCoinifyTimeCost, getDecomposeExp, getDecomposeTimeCost, getPriceOf, getTransmuteExp, getTransmuteTimeCost } from "@/common/apis/game"
import { getAlchemySuccessRatio, getBuffOf, getTeaIngredientList } from "@/common/apis/player"
import { getTrans } from "@/locales"
import { COIN_HRID } from "@/pinia/stores/game"
import Calculator from "."

export interface AlchemyCalculatorConfig extends CalculatorConfig {

}

export type AlchemyCatalyst = "prime_catalyst" | "catalyst_of_transmutation" | "catalyst_of_decomposition" | "catalyst_of_coinification"

abstract class AlchemyCalculator extends Calculator {
  get actionLevel(): number {
    return this.item.itemLevel
  }

  constructor(config: AlchemyCalculatorConfig) {
    super({ ...config, action: "alchemy" })
  }

  get catalystRatio(): number {
    let ratio = getBuffOf(this.action, "Success") || 0
    ratio += (this.catalystRank ? this.catalystRank * 0.1 + 0.05 : 0)
    return ratio
  }

  /**
   * 催化剂的**单次动作期望消耗个数**。
   *
   * 游戏 description 明确写 "One catalyst is consumed on success"
   * （成功时消耗 1 个，失败不消耗）。而 `count` 的口径是**每次动作**
   * （见 `Calculator.cost` 是单次成本、`countPH = count × consumePH`，
   * 且 `consumePH = actionsPH` = 每小时动作数，不是每小时成功数），
   * 所以：
   *
   *     每次动作期望消耗 = sr × 1 + (1 − sr) × 0 = **successRate**
   *
   * 乘上 `consumePH` 之后正好等于 `gainPH`（每小时成功次数）——
   * 「每小时成功几次就消耗几个」，这才是正确的口径。
   *
   * ⚠️ 这里曾写成 `1 / successRate`（提交 e4cb449），那是把两种口径混了：
   * `1/sr` 是「凑成一次成功平均要**尝试**多少次」，而催化剂只在成功那次
   * 消耗 1 个 —— 尝试次数 ≠ 催化剂个数。写成 1/sr 后每小时消耗变成
   * `actionsPH / sr`，比正确值 `actionsPH × sr` **高估 1/sr² 倍**
   * （成功率 60% 时高估 2.78×，72% 时 1.93×）。
   * 方向也反了：那样算出来「成功率越高，每小时用得越少」只对了一半，
   * 绝对值却完全不对。
   */
  get catalystCount(): number {
    // successRate 已被 min(1, …) 封顶且非负，无需额外防护
    return this.successRate
  }

  abstract get baseSuccessRate(): number
  abstract get baseExp(): number

  get successRate(): number {
    return Math.min(1, this.baseSuccessRate * (1 + getAlchemySuccessRatio(this.item) + this.catalystRatio))
  }

  get exp(): number {
    return this.baseExp * (1 + getBuffOf(this.action, "Experience"))
  }
}

export class TransmuteCalculator extends AlchemyCalculator {
  get className() {
    return "TransmuteCalculator"
  }

  constructor(config: AlchemyCalculatorConfig) {
    super({ ...config, project: getTrans("转化") })
  }

  get catalyst(): AlchemyCatalyst | undefined {
    if (this.catalystRank === 1) {
      return "catalyst_of_transmutation"
    } else if (this.catalystRank === 2) {
      return "prime_catalyst"
    }
    return undefined
  }

  get available(): boolean {
    return this.item.alchemyDetail?.transmuteDropTable != null
  }

  get timeCost(): number {
    return getTransmuteTimeCost() / this.speed
  }

  get baseSuccessRate(): number {
    return this.item.alchemyDetail.transmuteSuccessRate
  }

  get baseExp(): number {
    return getTransmuteExp(this.item)
  }

  _ingredientList?: Ingredient[]
  get ingredientList(): Ingredient[] {
    if (!this._ingredientList) {
      let list = [
        {
          hrid: this.item.hrid,
          count: this.item.alchemyDetail.bulkMultiplier * (1 - this.sameItemCounter),
          counterCount: this.item.alchemyDetail.bulkMultiplier * this.sameItemCounter,
          marketPrice: getPriceOf(this.item.hrid).ask
        },
        {
          hrid: COIN_HRID,
          count: this.item.alchemyDetail.bulkMultiplier,
          marketPrice: Math.max(Math.floor(this.item.sellPrice / 5), 50)
        }
      ]
      this.catalyst && list.push({
        hrid: `/items/${this.catalyst}`,
        // 成功才消耗 ⇒ 单次期望个数 = 成功率 × 1（见 catalystCount）
        count: this.catalystCount,
        marketPrice: getPriceOf(`/items/${this.catalyst}`).ask
      })

      list = list.concat(getTeaIngredientList(this))

      this._ingredientList = list
    }
    return this._ingredientList
  }

  _productList?: Product[]
  get productList(): Product[] {
    if (!this._productList) {
      const dropTable = this.item.alchemyDetail.transmuteDropTable
      this._productList = dropTable.map(drop => ({
        hrid: drop.itemHrid,
        count: (drop.maxCount - (drop.itemHrid === this.item.hrid ? drop.maxCount : 0)) * this.item.alchemyDetail.bulkMultiplier,
        counterCount: (drop.itemHrid === this.item.hrid ? drop.maxCount : 0) * this.item.alchemyDetail.bulkMultiplier,
        rate: drop.dropRate,
        marketPrice: getPriceOf(drop.itemHrid).bid
      })).concat(getAlchemyRareDropTable(this.item, getTransmuteTimeCost()).map(drop => ({
        hrid: drop.itemHrid,
        count: (drop.minCount + drop.maxCount) / 2 / this.successRate,
        counterCount: 0,
        rate: drop.dropRate * (1 + this.rareRatio),
        marketPrice: getPriceOf(drop.itemHrid).bid
      }))).concat(getAlchemyEssenceDropTable(this.item, getTransmuteTimeCost()).map(drop => ({
        hrid: drop.itemHrid,
        count: (drop.minCount + drop.maxCount) / 2 / this.successRate,
        counterCount: 0,
        rate: drop.dropRate * (1 + this.essenceRatio),
        marketPrice: getPriceOf(drop.itemHrid).bid
      })))
    }
    return this._productList
  }

  get sameItemCounter(): number {
    const product = this.item.alchemyDetail.transmuteDropTable.find(p => p.itemHrid === this.item.hrid)
    if (!product) return 0
    return Math.min(1, product.maxCount * (product.dropRate || 1) * this.successRate)
  }
}
export class DecomposeCalculator extends AlchemyCalculator {
  get className() {
    return "DecomposeCalculator"
  }

  enhanceLevel: number
  constructor(config: AlchemyCalculatorConfig) {
    super({ ...config, project: getTrans("分解") })
    this.enhanceLevel = config.enhanceLevel || 0
  }

  get catalyst(): AlchemyCatalyst | undefined {
    if (this.catalystRank === 1) {
      return "catalyst_of_decomposition"
    } else if (this.catalystRank === 2) {
      return "prime_catalyst"
    }
    return undefined
  }

  get available(): boolean {
    return this.item.alchemyDetail?.decomposeItems != null
  }

  get timeCost(): number {
    return getDecomposeTimeCost() / this.speed
  }

  get baseSuccessRate(): number {
    return 0.6
  }

  get baseExp(): number {
    return getDecomposeExp(this.item)
  }

  _ingredientList?: Ingredient[]
  get ingredientList(): Ingredient[] {
    if (!this._ingredientList) {
      let list = [
        {
          hrid: this.item.hrid,
          count: this.item.alchemyDetail.bulkMultiplier,
          marketPrice: getPriceOf(this.item.hrid, this.enhanceLevel).ask,
          level: this.enhanceLevel
        },
        {
          hrid: COIN_HRID,
          count: this.item.alchemyDetail.bulkMultiplier,
          marketPrice: 50 + 5 * this.item.itemLevel
        }

      ]
      if (this.catalyst) {
        list.push({
          hrid: `/items/${this.catalyst}`,
          // 成功才消耗 ⇒ 单次期望个数 = 成功率 × 1（见 catalystCount）
          count: this.catalystCount,
          marketPrice: getPriceOf(`/items/${this.catalyst}`).ask
        })
      }

      list = list.concat(getTeaIngredientList(this))
      this._ingredientList = list
    }
    return this._ingredientList
  }

  _productList?: Product[]
  get productList(): Product[] {
    if (!this._productList) {
      let list = []
      if (this.enhanceLevel > 0) {
        list.push({
          hrid: `/items/enhancing_essence`,
          count: getAlchemyDecomposeEnhancingEssenceOutput(this.item, this.enhanceLevel),
          marketPrice: getPriceOf(`/items/enhancing_essence`).bid
        })
      }

      list = list.concat(this.item.alchemyDetail.decomposeItems.map(drop => ({
        hrid: drop.itemHrid,
        count: drop.count * this.item.alchemyDetail.bulkMultiplier,
        marketPrice: getPriceOf(drop.itemHrid).bid
      }))).concat(getAlchemyRareDropTable(this.item, getDecomposeTimeCost()).map(drop => ({
        hrid: drop.itemHrid,
        rate: drop.dropRate * (1 + this.rareRatio),
        count: (drop.minCount + drop.maxCount) / 2 / this.successRate,
        marketPrice: getPriceOf(drop.itemHrid).bid
      }))).concat(getAlchemyEssenceDropTable(this.item, getDecomposeTimeCost()).map(drop => ({
        hrid: drop.itemHrid,
        count: (drop.minCount + drop.maxCount) / 2 / this.successRate,
        rate: drop.dropRate * (1 + this.essenceRatio),
        marketPrice: getPriceOf(drop.itemHrid).bid
      })))
      this._productList = list
    }
    return this._productList
  }
}

export class CoinifyCalculator extends AlchemyCalculator {
  get className() {
    return "CoinifyCalculator"
  }

  constructor(config: AlchemyCalculatorConfig) {
    super({ ...config, project: getTrans("点金") })
  }

  get catalyst(): AlchemyCatalyst | undefined {
    if (this.catalystRank === 1) {
      return "catalyst_of_coinification"
    } else if (this.catalystRank === 2) {
      return "prime_catalyst"
    }
    return undefined
  }

  get available(): boolean {
    return this.item.alchemyDetail?.isCoinifiable
  }

  get timeCost(): number {
    return getCoinifyTimeCost() / this.speed
  }

  get baseSuccessRate(): number {
    return 0.7
  }

  get baseExp(): number {
    return getCoinifyExp(this.item)
  }

  _ingredientList?: Ingredient[]
  get ingredientList(): Ingredient[] {
    if (!this._ingredientList) {
      let list = [
        {
          hrid: this.item.hrid,
          count: this.item.alchemyDetail.bulkMultiplier,
          marketPrice: getPriceOf(this.item.hrid).ask
        }
      ]
      this.catalyst && list.push({
        hrid: `/items/${this.catalyst}`,
        // 成功才消耗 ⇒ 单次期望个数 = 成功率 × 1（见 catalystCount）
        count: this.catalystCount,
        marketPrice: getPriceOf(`/items/${this.catalyst}`).ask
      })

      list = list.concat(getTeaIngredientList(this))

      this._ingredientList = list
    }
    return this._ingredientList
  }

  _productList?: Product[]
  get productList(): Product[] {
    if (!this._productList) {
      this._productList = [{
        hrid: COIN_HRID,
        count: 1,
        marketPrice: this.item.sellPrice * 5 * this.item.alchemyDetail.bulkMultiplier
      }].concat(getAlchemyRareDropTable(this.item, getCoinifyTimeCost()).map(drop => ({
        hrid: drop.itemHrid,
        count: (drop.minCount + drop.maxCount) / 2 / this.successRate,
        rate: drop.dropRate * (1 + this.rareRatio),
        marketPrice: getPriceOf(drop.itemHrid).bid
      }))).concat(getAlchemyEssenceDropTable(this.item, getCoinifyTimeCost()).map(drop => ({
        hrid: drop.itemHrid,
        count: (drop.minCount + drop.maxCount) / 2 / this.successRate,
        rate: drop.dropRate * (1 + this.essenceRatio),
        marketPrice: getPriceOf(drop.itemHrid).bid
      })))
    }
    return this._productList
  }
}
