/**
 * 市场条目的行 key。
 *
 * 单独成文件而不是放在 `marketvolume/index.ts` 里，是为了让**不依赖游戏数据层**的模块
 * （如 `pinia/stores/marketfavorite.ts`、`marketvolume/filters.ts`）能直接引用它：
 * 那个 barrel 会 `import` `@/common/apis/game`，而 game 模块在顶层注册了
 * `watch(..., { immediate: true })` 去重建全量索引 —— 一旦在没有数据的环境（例如单元测试）
 * 里被拉起，就会以 `Cannot read properties of null (reading 'actionDetailMap')` 直接抛错。
 * 一个纯字符串拼接工具没有任何理由把整条数据层拖进模块图。
 *
 * ## 为什么 key 里必须带 level
 * `level` 是**官方市场档位**（强化等级 0~20），同一件装备的不同档位是**不同的市场条目**
 * （holy_chisel 能展开出 11 档）。只按 hrid 做键会把十几个档位当成同一条。
 *
 * 全站统一使用这套 `hrid|level`：涨跌 map（`getMarketChangeMap`）、提醒命中的去重、
 * 收藏的存储键、页面上各种 `Map`。`alerts.ts` 的 `alertKeyOf` 是本函数的别名（保留旧名）。
 */
export function marketRowKeyOf(hrid: string, level: string | number): string {
  return `${hrid}|${level}`
}
