import type { Equipment, ItemDetail } from "~/game"

export function getKeyOf(hrid?: string) {
  return hrid?.split("/").pop()
}
export function getTypeOf(hrid?: string) {
  return hrid?.split("/")[1]
}
export function getIconOf(hrid?: string) {
  const type = getTypeOf(hrid)
  const key = getKeyOf(hrid)
  return `${import.meta.env.BASE_URL}sprites/${type}.svg#${key}`
}

export function getEquipmentTypeOf(item: ItemDetail): Equipment {
  return item.equipmentDetail?.type?.split("/").pop() as Equipment
}

/** 首饰部位：项链 / 戒指 / 耳环 */
export const JEWELRY_EQUIPMENT_TYPES = ["neck", "ring", "earrings"] as const

/**
 * 是否为首饰（项链/戒指/耳环）。
 *
 * 单独抽出来是因为「排除装备」与「排除首饰」必须是**互相独立**的两个开关：
 * 搜索过滤里 banEquipment 只处理非首饰装备，首饰交给 banJewelry。
 * 若两处各自手写部位判断，很容易再次退化成包含关系（历史上就是这样，
 * 导致勾了「排除装备」后「排除首饰」彻底失效）。
 */
export function isJewelry(item?: ItemDetail): boolean {
  if (!item) {
    return false
  }
  return (JEWELRY_EQUIPMENT_TYPES as readonly string[]).includes(getEquipmentTypeOf(item) as string)
}

export type EquipmentClass = "combat" | "life" | "both" | "none"

/**
 * 装备用途分类（派生分类，非数据原生字段）：
 * 依据 equipmentDetail.combatStats / noncombatStats 判定
 * - combat: 仅含战斗属性（combatStats 非空）
 * - life: 仅含生活/生产属性（noncombatStats 非空）
 * - both: 战斗与生活属性兼具
 * - none: 两者皆无（罕见）
 */
export function getEquipmentClassOf(item: ItemDetail): EquipmentClass {
  const hasCombat = !!item.equipmentDetail?.combatStats && Object.keys(item.equipmentDetail.combatStats).length > 0
  const hasLife = !!item.equipmentDetail?.noncombatStats && Object.keys(item.equipmentDetail.noncombatStats).length > 0
  if (hasCombat && hasLife) return "both"
  if (hasCombat) return "combat"
  if (hasLife) return "life"
  return "none"
}

export function isRefined(item: ItemDetail) {
  return item.hrid.endsWith("_refined")
}
