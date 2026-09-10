---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 08e8c4f3f93cfbfc76cce2af531ed943_797bbae2ac6a11f1ac01525400e6dd8f
    ReservedCode1: 8iaFzs1DcOiFDiDQcUgq1kjIK/fddwl7gGKUhOjcN8uoxnHSWQL2kqLKETUPc9BdFtCIWUaB1HjG+npVHryzBYPYCTUj+s8MGQdGkT+JyxP5y3HzIhl0tRVofOC/IeHv1XOS/rw/pcV1kEZ3HBU1fuTl7NKZgot4IFTM33nK99f9ScmNgHUIRY489Dk=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 08e8c4f3f93cfbfc76cce2af531ed943_797bbae2ac6a11f1ac01525400e6dd8f
    ReservedCode2: 8iaFzs1DcOiFDiDQcUgq1kjIK/fddwl7gGKUhOjcN8uoxnHSWQL2kqLKETUPc9BdFtCIWUaB1HjG+npVHryzBYPYCTUj+s8MGQdGkT+JyxP5y3HzIhl0tRVofOC/IeHv1XOS/rw/pcV1kEZ3HBU1fuTl7NKZgot4IFTM33nK99f9ScmNgHUIRY489Dk=
---

# MewKonomy 项目持久化上下文

> 本文件用于记录 MewKonomy（原 Milkonomy）的历次改动、关键架构与踩坑，
> 供后来者 / AI 助手快速恢复上下文，防止长对话压缩丢失关键信息。
> 请随每次功能改动同步更新本文件。

## 一、项目概览

- **定位**：Milky Way Idle 玩家自用利润计算工具，纯前端 SPA，无后端。
- **技术栈**：Vue 3.5 + Vite 6 + TypeScript 5.7 + Element Plus 2.9 + Pinia + vue-i18n。
- **路由**：hash 模式（GitHub Pages 子路径部署需要）。
- **数据源**：`public/data/data.json`（静态游戏数据，**严禁改动**，含硬上限）+
  `public/data/market.json`（市场价格快照 `{market:{名称:{ask,bid,vendor}}, time}`）。
- **改名**：原项目名 Milkonomy → **MewKonomy**（`package.json` name、页面 title、远程仓库均已改）。
- **部署**：GitHub Pages，地址 `https://forever985.github.io/mewkonomy/`，
  远程仓库 `https://github.com/Forever985/mewkonomy.git`（分支 `main` + `gh-pages`）。

## 二、历史改动时间线

| 时间/顺序 | 改动 | 说明 |
| --- | --- | --- |
| 早期 | 改名 MewKonomy | 全站标题、仓库名、brand 更新 |
| 早期 | 税率改 5% | 市场税费参数由原值调为 5% |
| 早期 | 移除英灵殿 / 埋骨地页面 | 历史纪念页下线（相关词条与路由已清理） |
| 早期 | 等级 / 利润率 / 风险区间双头筛选 | 检索区支持 min~max 双端范围 |
| 早期 | 组合条件并行检索 | 多物品 / 多条件同时检索（`conditions` 数组） |
| 早期 | GitHub Pages 部署 | 引入 hash 路由、`deploy.ps1` 一键脚本 |
| 早期 | VITE_PUBLIC_PATH | `.env.public` 设 `VITE_PUBLIC_PATH=/mewkonomy/`，修复子路径 404（commit b0ad608） |
| 早期 | helper chunk 修复 | Vite 构建产物 chunk 拆分相关问题修复 |
| 早期 | deploy.ps1 / sync-fast.ps1 | 全量构建部署脚本 + 免编译增量同步脚本 |
| 近期 | 排除战斗 / 生活装备开关 | dashboard 与强化分解检索区新增（见功能1） |
| 近期 | 工匠茶等效等级 +5 | 修正工匠茶 buff 符号（见功能2） |
| 近期 | 强化分解放开负利润过滤 | 负利润方案也写入结果（见功能3） |
| 近期 | 强化分解"不分解模式"+ 价格源切换 | 新子模式与成品计价价格源开关（见功能4） |

## 三、构建与部署系统（关键知识）

### 3.1 双版本构建

- 由 `VITE_BUILD_MODE`（`public` / `private` / `staging`）控制，**仅**影响：
  title、`VITE_PUBLIC_PATH`、是否移除 console。
- **非安全隔离**：路由与页面文件始终全部打包；私有页靠侧边栏权限 + freeze 守卫
  控制可见性。`checkSecret()` 已改为恒返回 `true`，私有页不再有密钥校验。
- 默认 `pnpm dev` 走 private 模式，`pnpm build` / `build:public` 走 public 模式。
- `.env.public`：`VITE_BUILD_MODE=public`，`VITE_PUBLIC_PATH=/mewkonomy/`。

### 3.2 部署脚本

- **`deploy.ps1`（全量）**：`build:public` → 提交 main（`--no-verify` 跳过 husky）
  → `npx gh-pages -d dist` 推 gh-pages。
  - 网络策略：先探测 GitHub 直连，不可用则回退本地代理 `http://127.0.0.1:10808`；
  - git 凭据助手设为 `wincred`（规避 GCM 崩溃）。
- **`sync-fast.ps1`（免编译增量）**：仅适用于**只改了 `public/` 静态文件**
  （data.json / market.json / 图片 / SVG 等）的场景：比对 `public\` 与 `dist\`，
  按哈希增量复制变更文件后推 gh-pages。
  - 内置保护：检测 `src/`、`vite.config.ts`、`package.json`、
    `pnpm-lock.yaml`、`.env.public`、`uno.config.ts`、`tsconfig.json`
    是否有文件晚于上次构建 → 有则警告应改用全量构建。
  - `dist` 缺失时提示先跑 `deploy.ps1`。

## 四、核心代码地图（涉及本次改动）

- 装备分类工具：`src/common/utils/game.ts`
  - `getEquipmentTypeOf(item)`：返回装备**部位类型**（`neck/ring/earrings/hands/...`），
    无战斗/生活语义。
  - `getEquipmentClassOf(item)`（**新增，派生分类**）：依据
    `equipmentDetail.combatStats / noncombatStats` 判定装备用途分类：
    `combat`（仅战斗）/ `life`（仅生活）/ `both` / `none`。
    分布实测（data.json 518 件装备）：combat 338、life 169、both 11。
- 检索过滤：`src/common/apis/utils.ts` 的 `handleSearch`
  - 已有：`banEquipment`（排除装备）、`banJewelry`（排除首饰）、
    `conditions`、等级/利润率/风险双头、`steps` 精确步数。
  - **新增**：`banCombat`（排除战斗装备）、`banLife`（排除生活装备），
    基于 `getEquipmentClassOf` 过滤，`both` 类同时被两项排除。
- 计算器体系：`src/calculator/`
  - `index.ts`：`Calculator` 基类。`ingredientListWithPrice` 固定用 `ask`，
    `productListWithPrice` 固定用 `bid`（注意：这是**全局规则**，功能4只改强化成品源）。
  - `enhance.ts`：`EnhanceCalculator`。新增配置 `productPriceType?: "ask" | "bid"`，
    默认 `"bid"`（保持旧行为）；`productList` 中本体与逃逸体价格由 `.bid`
    改为 `getPriceOf(...)[this.productPriceType]`。
  - `alchemy.ts`：`DecomposeCalculator` 等，原料 `ask`、产物 `bid`。
  - `workflow.ts`：`WorkflowCalculator` 聚合多阶段（强化+分解），
    `actionLevel` 取各阶段最大值。
- 强化分解 API：`src/common/apis/enhanposer/index.ts`
  - `calcEnhanceProfit({ noDecompose, priceType })`：
    - **已移除** `if (!enhancer.profitable) continue` 预筛（负利润也写入结果）。
    - `noDecompose=true` 时 `WorkflowCalculator` 仅含强化阶段（不叠加分解收益）。
    - `priceType` 传入 `EnhanceCalculator.productPriceType`。
  - `src/common/apis/enhanposer/enhanposest.ts`：同样移除了 `!enhancer.profitable`，
    保留 `!enhancer.available`。
- 玩家 buff：`src/common/apis/player/index.ts` 的 `initBuffMap`
  - 工匠茶（`/items/artisan_tea`，zh-cn 词条"工匠茶"）buff：
    `/buff_types/action_level`，`flatBoost = 5`。
  - **修正**：原实现 `buffs[${action}Level] -= buff.flatBoost`（等级 debuff，与游戏机制相反），
    现改为 `+=`，即勾选工匠茶后玩家等效行动等级 **+5**。
  - 另含 `/buff_types/artisan`、`/buff_types/${action}_level`（正常累加）等分支。
- 页面：
  - `src/pages/dashboard/index.vue`：搜索区已有"排除装备/排除首饰"，
    **新增"排除战斗装备/排除生活装备"** checkbox，绑定 `banCombat/banLife`。
    要求等级列显示 `row.actionLevel` 并与 `playerLevel` 比较标红。
  - `src/pages/enhanposer/index.vue`：搜索区**新增**"排除战斗装备/排除生活装备"、
    "不分解模式"checkbox 与"价格源"select（`左挂单=ask` / `右收购=bid`，默认 bid）。
    监听 `noDecompose / priceType` 变化 → `clearEnhanposerCache()` 后重算
    （缓存按计算模式区分，模式切换必须清缓存）。
  - `src/pages/enhanposer/enhanposest.vue`：搜索区**新增**"排除战斗装备/排除生活装备"。
- 价格语义：`src/pinia/stores/game.ts`
  - `PriceStatus` 枚举：`ASK`=左价（挂单卖价），`BID`=右价（收购单价）。
  - `getPriceOf(hrid, level, buyStatus, sellStatus)` 用 `convertPriceOfStatus`
    将 market 的 ask/bid 按 PriceStatus 转换。全局 `buyStatus/sellStatus` 默认 ASK/BID。
  - `getEnhanposerCache / setEnhanposerCache / clearEnhanposerCache` 按
    marketData 时间戳存取，价格变化 / 模式变化均需清缓存。
- 词条：`src/locales/lang/zh-cn.ts`（中文 key 即显示文本，未改动）、
  `src/locales/lang/en.ts`（**新增** `排除战斗装备/排除生活装备/价格源/左挂单/右收购/不分解模式`）。

## 五、本次四点改造详情（功能1~5）

### 功能1：排除战斗 / 生活装备开关

- **数据核实结论**：`data.json` 的装备**无独立"战斗/生活"分类字段**；
  `itemDetailMap` 的 `item` 顶层无 category 区分，`equipmentDetail`
  仅有 `type`（部位）、`combatStats`、`noncombatStats`。
- **实现方式**：从 `equipmentDetail.combatStats / noncombatStats` **派生**分类
  （`getEquipmentClassOf`），语义等价于"战斗装备/生活装备"：
  - `combatStats` 非空 → 战斗属性（攻击/命中/防御等）；
  - `noncombatStats` 非空 → 生活属性（采集/制作/经验加成等）；
  - 两者皆非空 → `both`，两个排除开关均会剔除。
- **接入**：`handleSearch` 新增 `banCombat / banLife` 过滤；dashboard、
  enhanposer、enhanposest 检索区均提供两个独立开关。
- **说明**：由于依赖派生字段（非常驻顶层分类），若未来数据源结构调整
  （如新增 `categoryHrid` 战斗/生活子类），应优先改用原生字段。

### 功能2：工匠茶所需等级 +5

- 定位：`src/common/apis/player/index.ts` `initBuffMap` 的
  `/buff_types/action_level` 分支（仅工匠茶含该 buff）。
- 改动：`-= buff.flatBoost` → `+= buff.flatBoost`。
- 效果：勾选工匠茶时玩家等效行动等级 +5（对应"所需等级 +5"）；未勾选逻辑不受影响。
- 约束：未改动 `data.json` 中茶的数据与硬上限（buff 数据仍为 flatBoost=5）。

### 功能3：强化分解放开负利润过滤

- 过滤点定位：`enhanposer/index.ts` 与 `enhanposest.ts` 的
  `calcEnhanceProfit` 中 `if (!enhancer.profitable) continue`。
- 改动：两处均移除该预筛；`enhanposest` 保留 `!enhancer.available`（不可用方案仍需跳过）。
- 效果：负利润方案也会写入结果并参与排序展示；价格缺失
  （`getUsedPriceOf(...) === -1`）的防护保留不变。

### 功能4：强化分解"不分解模式" + 价格源切换

- **价格源字段核实**：强化分解页利润计算中，原料/成本走 `getPriceOf(...).ask`（左挂单），
  强化成品（本体/逃逸体）收益走 `.bid`（右收购单）。这正是需求的
  A（左挂单出售给他人）/ B（右收购单出售）两个价格源。
- 改动：
  - `EnhanceCalculatorConfig` 新增 `productPriceType?: "ask" | "bid"`，
    类字段默认 `"bid"`（保持现有行为），`productList` 本体/逃逸体价格改用该字段。
  - `enhanposer/index.ts` 的 `calcEnhanceProfit` 接收 `{ noDecompose, priceType }`：
    - `noDecompose=true` 时工作流仅含强化阶段；
    - `priceType` 透传给强化计算器成品计价。
  - 页面新增"不分解模式"checkbox 与"价格源"select（左挂单 ask / 右收购 bid，默认 bid）。
  - 模式/价格源变化时清 enhanposer 缓存并重算。
- 注意：基类 `productListWithPrice` 仍固定 `bid`（影响强化**详情弹窗**等多阶段汇总），
  本次仅切换强化成品的独立计价源；如需详情弹窗同步切换，需另行扩展（不在本次范围）。

### 功能5：本持久化文档

- 本文件即功能5产物，汇总历史时间线、构建部署、核心代码地图与本次四点改造。

## 六、约束与红线（务必遵守）

1. **严禁改动 `public/data` 中的游戏数据与硬上限**（data.json / market.json）。
2. 旧版筛选字段需做数据迁移兼容（如 dashboard 中 `name` 字符串→数组、
   `actionLevel → minLevel`、`profitRate → minProfitRate` 等已有迁移逻辑，
   新增字段缺失时按 undefined/falsy 处理，不破坏旧存储）。
3. 所有改动需通过 `npx vue-tsc --noEmit` 类型检查。
4. 部署走本地脚本（拒绝全自动 CI）：只改 public 静态文件用 `sync-fast.ps1`，
   改源码用 `deploy.ps1`。
5. 缓存（enhanposerCache / jungleCache 等）按时间戳 + 计算模式区分，
   引入新模式参数时必须清理缓存，否则读到旧计算结果。

## 七、验证方式

- 类型检查：`cd D:\milkonomy\milkonomy-main && npx vue-tsc --noEmit`
- 本地预览：`pnpm dev:public`（或 `pnpm dev`），浏览器打开 hash 路由页面，
  检查各搜索区新开关、工匠茶等级、负利润展示与价格源切换。
- 部署：`powershell -ExecutionPolicy Bypass -File .\deploy.ps1`
*（内容由AI生成，仅供参考）*


## 八、强化分解多元搜索 + 工匠茶等级 +5 + 披风可查（2026-09-10）

### 功能A：强化分解页多元搜索
- enhanposer / enhanposest 检索区对齐 dashboard：多物品多选、conditions 条件行（目标强化等级 OR 并行）、目标等级/利润率/风险区间。
- `enhanposer/index.ts` 与 `enhanposest.ts`：conditions.steps 映射为目标强化等级过滤，剔除 conditions 后走通用 handleSearch。

### 功能B：工匠茶「装备要求等级 +5」
- 语义修正：饮用工匠茶（/buff_types/action_level, flatBoost=5）后，制作/锻造/缝纫装备的「要求等级」门槛 +5（如 80→85），不改变玩家自身等级。
- 实现：`player/index.ts` 新增 `getActionLevelBonusOf(action)`，匹配 action_config.tea 中 /buff_types/action_level buff；`calculator/manufacture.ts` `actionLevel = levelRequirement.level + getActionLevelBonusOf(action)`。
- 展示：dashboard / manualchemy「要求等级」列随工匠茶勾选 +5，>playerLevel 标红。

### 功能C：披风可查（市场无价装备 sellPrice 兜底）
- 问题：Sinister Cape / Enchanted Cloak / Chimerical Quiver 等 back 披风在市场（marketplace.json）无任何 ask/bid 交易价，被 enhanposer 预筛 `getUsedPriceOf(...)===-1` 过滤，利润网查不到。
- 修复：`common/apis/game/index.ts` `getPriceOf` 对「市场完全无该物品记录」时用 `item.sellPrice`（卖商店价）兜底 ask/bid（level 0 与 level>0 分支均已处理）。

### 功能D：卷轴排查结论
- 迷宫玩法在当前 data.json（gameVersion v1.20250818.0）中不存在（无 maze/labyrinth/dungeon 相关物品）。
- 唯一「卷轴」为 Bishop's Scroll（resource, lv95），用于制作 Bishop's Codex 法典（crafting lv94 / 104），二者本就有市场价、已在利润计算中。
