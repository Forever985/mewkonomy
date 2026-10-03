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

/** 护符部位（`/equipment_types/charm`） */
export const CHARM_EQUIPMENT_TYPE = "charm"

/**
 * 是否为护符。
 *
 * 与 `isJewelry` 同理：护符必须能从「排除装备」里**单独摘出来**，否则
 * 「排除护符」在勾了「排除装备」时就会彻底失效（首饰当年正是踩了这个坑才改成独立开关的）。
 *
 * 值得单列一个开关的量级：实测 `data.json` 里护符有 **102 件**，是最大的装备类别
 * （532 件装备里占 19%，比 main_hand 的 69 件还多）。
 */
export function isCharm(item?: ItemDetail): boolean {
  if (!item) {
    return false
  }
  return getEquipmentTypeOf(item) === CHARM_EQUIPMENT_TYPE
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
