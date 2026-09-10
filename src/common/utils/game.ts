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
