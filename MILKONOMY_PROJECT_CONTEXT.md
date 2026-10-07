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
| 早期 | 税率改 5% | 市场税费参数由原值调为 5%（**已被 §十四 的 4% 取代**） |
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
| 2026-10-01 | 基础夯实：仓库卫生 + 8 处真实缺陷 + 文档一致性修订 | 详见 §十三 |
| 2026-10-01 | 跟进游戏 2026/9/28 更新：市场税率 5%→4%；价格「档位」改为百分比增量（强化 ×5） | 详见 §十四 |
| 2026-10-02 | 新增「市场提醒」：多条自定义规则（范围×指标×方向×绝对值/相对排行）+ 页面内高亮 + 浏览器通知 | 详见 §十五 |
| 2026-10-02 | 新增市场监控「收藏」与「区间筛选」（成交量/涨跌幅等支持 ≥、≤、区间） | 详见 §十六 |
| 2026-10-02 | 价格档位口径由 4 个补齐为 6 个（新增 `左价+` / `右价-`） | 详见 §十七 |
| 2026-10-02 | 检索面板新增「排除护符」（三开关独立）；新增可开可关的「隐藏小成交量」 | 详见 §十八 |
| 2026-10-03 | 抽取「检索结果页」骨架 `useLeaderboardPage`，8 个页面迁移，重复块 169 → 155 | 详见 §十九 |
| 2026-10-03 | 详情弹窗新增「目标时薪反解」：给定目标时薪算出主要询价物品的临界价与档位对照 | 详见 §二十 |
| 2026-10-03 | 新增独立页面「填表算利润」：用手填成交价算利润，与实时市价解耦 | 详见 §二十一 |

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
## 十二、线上数据流水线修复：市场历史从「8 天没数据」到 20 分钟一采（2026-09-20）

### 12.1 问题：线上市场历史实际是停摆的

排查线上 Pages 站点的数据供给时发现：

| 检查项 | 实测 |
| --- | --- |
| `update-data.yml` 运行记录 | 每 1~2 小时跑一次，**最近 10 次全部 failure** |
| 失败步骤 | 每次都是 `Fetch and deploy data` |
| 线上 `market_history.json` | **只有 1 个采样点，停在 09-14 12:06**（已 6 天无更新） |
| 后果 | 市场监控页的「涨跌」列几乎恒为 `--` |

**根因（本地复现实测）**：脚本配置的两个上游源都已不可用——

| 源 | 实测 |
| --- | --- |
| `silent1b/MWIData/init_client_info.json` | 可达但 **290 秒**；且仓库**最后提交 2025-08-19**，版本停在 `v1.20250818.0` |
| `holychikenz/MWIApi/milkyapi.json` | **5 分钟超时**；内容仅 69KB，**完全不含 `itemDetailMap`/`gameVersion`** |

脚本原为 `HTTP_TIMEOUT=30` + 4 次重试 + `zip(DATA_URL, DATA_FILES)`，轮到 MWIApi 必然耗尽失败。

**更危险的隐患**：线上 `data.json` 是 `v1.20260309.0`（948 物品、含迷宫），而唯一「可达」的 MWIData 是 **`v1.20250818.0`（旧 7 个月）**。原策略「哈希不同就覆盖」意味着**一旦抓取成功就会用旧数据反向覆盖线上新数据**。

### 12.2 修复

**A. 拆解耦合 + 高频采样（核心）**

原先历史采样与游戏数据抓取在**同一个 job** 里，data.json 源一挂，历史采样一起停摆。现在拆成两条 workflow：

| workflow | 频率 | 脚本 | 依赖 |
| --- | --- | --- | --- |
| `market-history.yml` | **每小时第 5 分钟**（`5 * * * *`） | `scripts/sample_market_history.py` | **仅**官方 `marketplace.json`（约 0.4s，稳定） |
| `update-data.yml` | **每天 1 次** | `scripts/fetch_game_data.py` | 上游 data.json / market.json |

**B. 采样内容与窗口升级**

- 窗口：26 小时 → **7 天**（`HISTORY_WINDOW_SEC = 7*24*3600`，上限 520 点；实测官方快照是 1 小时粒度，故稳定产出约 24 点/天）
- 采样点从 `[ask, price]` 扩为 **`[ask, bid, volume]`**；前端**同时兼容两种长度**（历史文件是滚动累积的）
- 本地兜底上限 48 → 200 条，同样 7 天窗口

**C. 两道护栏（防止反向破坏）**

1. **禁止降级**：抓到 `versionTimestamp` 比线上更旧的数据 → 拒绝写入（已验证：能正确拦下 2025-08 的旧数据）
2. **体积/结构校验**：`data.json` 必须含 `itemDetailMap`；`market.json` 正常只有几十 KB，若返回 3MB 级载荷则拒绝（上游仓库结构变化时会返回 data.json 内容）
3. 采样脚本另加护栏：官方快照物品数为 0 时放弃本次采样，**绝不用空快照覆盖 7 天历史**

**D. 前端涨跌口径可选**

`getMarketChangeMap(list, windowHours, metric, now)` 支持四种口径：`price`（ask/bid 中点）/ `ask` / `bid` / `volume`。
市场监控页新增「对比口径」下拉与「成交量/小时」列，时间窗扩到 `1/3/6/12/24/72/168` 小时。

**特别注意 volume 的语义**：官方 `v` 是**当日累计成交量**（UTC 0 点归零），直接比绝对值只能反映「今天过了多久」。因此成交量口径比的是**增量速率**（`(当前累计 − 基准累计) / 间隔小时`），并把基准点的历史速率作为参照；跨 UTC 归零导致负增量时该项不出现（显示 `--`）。

**E. 时间参数化（可测试性）**

`getBaselineSample` / `getMarketChangeMap` / `getVolumeRate` / `recordLocalSample` 都接受显式 `now`。
动机：这些函数原先内部读 `Date.now()`，而测试里 `vi.setSystemTime` 与模块级时序互相干扰，反复产生「期望值与实际值互不自洽」的假失败。显式 `now` 让时间逻辑可以确定性测试。
（`tests/marketvolume-history.test.ts` 中原有一条依赖 mock 时钟的用例即因此删除，其语义由 `tests/marketvolume-history-format.test.ts` 用确定性样本完全覆盖。）

**F. 部署安全规则：`gh-pages:data/` 是多脚本共享目录（重要）**

- **归属划分**：`sample_market_history.py` **只拥有** `data/market_history.json`；`fetch_game_data.py` **只拥有** `data/data.json` 与 `data/market.json`。
- **外科手术式部署**：两者都改为「clone `gh-pages` → 只复制自己负责的文件进去 → commit + push」，**绝不允许 `rmtree` + `copytree` 整个 `data/`**。
- **教训（commit `93f0107`）**：早期采样脚本用 `public/data` 整目录替换线上 `data/`，而 `main` 上的 `public/data` 不含新抓的 `data.json`/`market.json`，结果**每次采样都会误删线上 4MB 的 `data.json` 与 70KB 的 `market.json`**。
- **双保险**：两脚本都调用 `assert_no_unintended_deletions()`，只要 `git status` 出现「本脚本不负责的删除」就中止部署。
- **CI 取脚本方式**：先 `actions/checkout` 检出 `gh-pages`（线上数据落在 `./data/`，供脚本做增量比对），再 `git fetch origin main:main` + `git checkout main -- scripts/<file>` 取回脚本（脚本只在 `main` 上维护）。

### 12.3 上游数据源：多源回退与现状

`fetch_game_data.py` 的 `DATA_SOURCES` 按顺序回退，第一个抓成功即用：**jsDelivr CDN**（`cdn.jsdelivr.net/gh/...`，实测约 25~35 秒）→ **ghproxy**（`ghproxy.net/...`，实测约 35 秒）→ **`raw.githubusercontent.com`**（本网络下取 3MB 级文件要 270~290 秒甚至超时，仅作最后兜底）。`HTTP_TIMEOUT = 120`、`RETRY_TOTAL = 3`；每个源都要过结构校验（见 C.2），不合格的源直接跳过，全源失败才报错。

即便多源回退可用，**当前配置的上游仍不是可靠的完整版 `data.json` 源**。线上那份 4,063,375 字节的完整官方数据（48 个顶层键）来源不明，已核查：

- `silent1b/MWIData`：停在 2025-08，且 `gameVersion = v1.20250818.0`——比线上 `v1.20260309.0` 旧 7 个月，即便抓到也会被「禁止降级」护栏拦下；
- `holychikenz/MWIApi`：不含游戏数据；
- `Polokikiki/Milkonomy` fork：有 `v1.20260309.0`，但只有 **2,744,882 字节**（比完整版小 1.3MB，疑似裁剪版），**不能直接替代**。

因此 `update-data.yml` 目前的状态是：**有护栏保护、不会破坏线上，但也抓不到新数据**。要真正恢复它的自动更新，需要先确认一个能提供完整版 data.json 的可靠源。

## 十三、基础夯实与文档一致性修订（2026-10-01）

本次以「源码 / 数据实测」为准做了一轮打基础改动：**修掉 8 处真实缺陷**，并修正本套文档里已过期的结论。
详细清单与推理过程见 [docs/AI_CONTEXT.md](./docs/AI_CONTEXT.md) §8，此处只记结论。

### 13.1 代码与配置修复

| # | 位置 | 问题 | 处理 |
| --- | --- | --- | --- |
| 1 | 根目录 `assets/`（62 文件 / 约 2.5MB）与 `.vite/deps/` | 被 `deploy:` 提交 `6bacb36` **误跟踪进仓库**的构建产物与 Vite 依赖缓存（`index.html` 引用的是 `/src/main.ts`，正式产物是 `dist/`）。后果：`pnpm lint`（= `eslint . --fix`）会去改写压缩产物并报出 **21.6 万条**错误。 | 补 `.gitignore`（`/assets/`、`/.vite/`）并 `git rm -r --cached`（**文件仍保留在磁盘**，只退出索引） |
| 2 | `eslint.config.js` 的 `ignores` | 原为空数组；且 flat config 的模式只写目录名不生效——**必须带 `/**`，且不能加前导斜杠** | 改为 `"data/**"`、`"public/data/**"` |
| 3 | `src/pinia/stores/game.ts` `hasVolumeField()` | `return` 写在循环体内，只检查第一个条目；该条目缺 `volume` 时会把整份**新**缓存误判为过期并清除 | 改为遍历到找到为止 |
| 4 | 6 处残留调试 `console.log` | 含 `console.log("buffs", buffs)`（每次 buff 重算都打印整个对象） | 全部移除（`catch` 里的 `console.error` 保留） |
| 5 | `common/apis/utils.ts`、`pages/enhanceexp/index.vue` | 未使用导入：`getEquipmentTypeOf` / `Plus` / `SortPriority` | 移除 |
| 6 | `pages/jungle/pickout.vue` | `usePriceStatus()` 的返回值未被使用 | **保留调用**（副作用必需），只去掉未使用的 `const` 绑定 |
| 7 | `.env.staging` | 仍指向改名前的 `/milkonomy/`，staging 构建会整体 404 | 改为 `/mewkonomy/` |
| 8 | `deploy.yml` / `release.yml` | 引用 fork 中并不存在的 `secrets.MILKONOMY`（触发即失败）；deploy 还缺 `permissions: contents: write` | 改用 `secrets.GITHUB_TOKEN` 并补权限 |

### 13.2 文档已被就地修正的过期结论

- **页面清单**：`public.ts` 实际只有 4 组路由（`/redirect`、`/403`、`/404`、`/link`）；dashboard / enhancer / enhanposer / sponsor 等业务页**全部**在 `private.ts`。`src/pages/` 18 个一级目录全部有路由引用。
- **`burial` / `valhalla`**：目录**早已删除**（原文档记为「仍残留、待清理」）。
- **迷宫（重要）**：`data.json` 已是 **`v1.20260309.0`**（948 物品 / 532 件装备），**已含迷宫数据**——`labyrinth_essence`、`labyrinth_token`、`labyrinth_refinement_chest`、`labyrinth_refinement_shard`，以及 `/item_categories/labyrinth`、`/item_categories/dungeon_key`。§八「功能D：卷轴排查结论」里「当前 data.json 无迷宫玩法」的判断**基于旧版本，已失效**。
- **市场历史（§12 的补充）**：归档已从 v1 单文件 `market_history.json` 升级为 **v2 分片** `market_history_<UTC日>T<HH>.json`（UTC 6 小时一块、字典编码、滚动 7 天 / 168 点；前端按窗口**按需只拉 1~2 片**，取不到才回退 v1 文件）。§12.2 中「上限 520 点」「前端按 `<BASE_URL>data/market_history.json` 拉取」已不适用于 v2。
- **`game.ts` 行数**：**443 行**（`REUSABLE_ABSTRACTION_MODULES.md` 原写「约 1.2 万行」）。
- **测试规模**：**24 个文件 / 100 个用例**（§13 审计当时的数据；**当前基线为 39 文件 / 350 用例**，见 §二十一）。
- **`BUILD_SYSTEM.md`**：原称「构建时排除私有页面文件」，与实现矛盾，已校正为「非安全隔离」（`remove-private-code` 插件整段被注释）。

### 13.3 有意不改的项

`SearchPanel` 的 `vue/no-mutating-props`（既定写法，11 个检索页依赖）、`enhanceexp` 里未接线的价格弹窗 `setPrice`（属未完成功能，接线方式需产品决策）、约 300 条 `src/`+`tests/` 排版风格问题（**不做**整体 `eslint --fix`，避免模板空白变更影响渲染）。

### 13.4 验证（本次改动后实测）

```bash
npx vue-tsc --noEmit   # 通过，无输出
npx vitest run         # 24 个测试文件 / 100 个用例，全绿（§13 审计当时；当前 32 / 209，见 §二十一）
npx eslint .           # 仅剩排版类问题（构建产物造成的 21.6 万条误报已消除）
```

## 十四、跟进游戏 2026/9/28 更新：税率 4% + 价格档位改为百分比增量（2026-10-01）

游戏在 2026/9/28 的小型更新里调整了**市场税率**与**价格档位**，两项都直接影响本项目的计算口径。
权威来源、实测数据与完整推理见 [docs/AI_CONTEXT.md](./docs/AI_CONTEXT.md) §9，此处只记结论与改动。

### 14.1 权威来源（不要靠猜）

- **游戏客户端常量**：`www.milkywayidle.com/static/js/main.<hash>.chunk.js` 里
  `br = { TAX_RATE: .04, COWBELL_TAX_RATE: .18 }`，且
  `getTaxRate(hrid) = hrid === BagOf10Cowbells ? COWBELL_TAX_RATE : TAX_RATE`。
- **补丁说明内联在同一个 bundle 中**，原文：「The standard market tax has been lowered from 5% to 4%.」
  「listing prices are now 0.33% to 0.44% apart at every price level, compared to 0.17% to 0.5% previously.」
  「Enhanced items (+1 and above) … now use price increments 5x larger (1.67% to 2.22% apart)…」
- **官方快照** `https://www.milkywayidle.com/game_data/marketplace.json` 用于实测复核。
- 抓取技巧：`git` 到 github.com 会被 Windows 吊销检查挡住（`CRYPT_E_REVOCATION_OFFLINE`），
  改用 **`curl --ssl-no-revoke`** 访问 HTTPS 一切正常。

### 14.2 税率：5% → 4%（已修）

- 标准税率 **4%**；`COWBELL_TAX_RATE = 18%` 仅作用于 `/items/bag_of_10_cowbells`，本项目不涉及。
- 客户端结算**向下取整**：`quantity * Math.floor((1 - taxRate) * price)`；本项目沿用既有口径未做 floor。
- ⚠️ 修复前本项目**内部不一致**：计算器按 5%（`0.95`），强化计算/强化页按 2%（`0.98` / `MARKET_TAX_PERCENT = 2`）。
- 现统一到 **`src/common/constants/market.ts`** 的 `MARKET_TAX_RATE` / `MARKET_TAX_FACTOR`；
  三语文案里的「2% / 98%」同步为「4% / 96%」。

### 14.3 价格「档位」：原粗档位表错误（已修）

- 游戏**没有全局固定档位**：每个 (物品, 强化等级) 有服务端下发的**交易区间** `[bandMin, bandMax]`，
  输入价只被夹进区间（`deriveWorkingPrice`）；区间每 **60 分钟**校准、每次最多移动 **1%**
  （`recalibrationIntervalMinutes: 60` / `bandMaxMovePerPassFactor: 1.01`）。
- 相邻挂单价间距（一档）：标准 **0.33% ~ 0.44%**，强化 **×5（1.67% ~ 2.22%）**。
- **实测**（754 对 0 级 / 756 对强化档）：标准 ≈ **0.366%**、强化 ≈ **1.852%**，比值 **5.06 ≈ 5×** ✓。
- 原 `priceStepOf` 用「十进制归一化 + 1/2/5/10」粗表，隐含一档 **1%~5%**，比真实**大 3~10 倍**。
  已改为百分比增量（`PRICE_STEP_RATIO = 0.00366`，强化 ×5），并处理低价物品「一档不足 1 金币」的取整。

### 14.4 影响与验证

- 界面「左价−」与「右价+」两个口径取值变化（属修正）；税率下调使利润数值整体上升约 1%。
- `npx vue-tsc --noEmit` 通过；`npx vitest run` 24 文件 / 100 用例全绿。

---

## 十五、新增「市场提醒」（2026-10-02）

### 15.1 需求与取舍
需求：市场监控能主动提醒——某物品价格跌破/涨过某值、某产品的涨跌幅、成交量、以及**交易量过高的产品**。
四点已与用户对齐：**页面内 + 浏览器通知都要**（开关/阈值放「设置」）、**仅市场监控页生效**（应用无后端）、
**多条自定义规则且高度解耦**（独立开关/优先级/冷却）、**绝对值与相对排行都支持**。

### 15.2 新增文件
- `src/common/apis/marketvolume/alerts.ts` —— **纯函数**：`AlertRule`/`AlertHit` 类型、
  `evaluateRule`/`evaluateAlerts`/`evaluateAlertsByRule`、`createPresetRules`/`createEmptyRule`、`metricValueOf`。
  不碰副作用与 i18n，因此可独立单测。
- `src/pinia/stores/alert.ts` —— 独立持久化（key `market-alert-config`，带 `version` + 归一化）。
  **刻意不放进 `layoutsConfig`**，否则「重置布局配置」会清掉用户规则。
- `tests/marketvolume-alerts.test.ts`（21 用例）、`tests/marketvolume-alerts-integration.test.ts`（6 用例）。

### 15.3 规则模型
范围（全部 / 分类 / 指定物品）× 指标（price/ask/bid/changePct/volumeRate/volumeRolling/volume/turnoverRolling）
× 方向（`gte` / `lte`）× 判定（**绝对值** 或 **相对排行**：前 N 名 / 超均值 k 倍 / 超中位数 k 倍）
＋ 独立 `enabled`、`priority`、`cooldownMinutes`、`onlyActive`。

### 15.4 三个容易做错的点（已按正确语义实现）
- **输入必须是 `changeApplied`**：提醒依赖的涨跌/速率/滚动量是页面上一步回填的，用 `all` 会全是 null。
- **每行只留一条命中**（优先级优先、其次**显著度**），否则表格行会拿到互相矛盾的标记；
  但「展开明细」走 `evaluateAlertsByRule` 保留全量，不丢信息。
- **显著度不能一律按值降序**：`lte` 类规则（如「跌幅 ≥ 20%」）里最该被看到的是**最低**值。

### 15.5 验证
- `npx vue-tsc --noEmit` 通过；`npx vitest run` **26 文件 / 127 用例全绿**（新增 27 个）。
- `vite build --mode public`（13.1s）与 `--mode private`（11.6s）均成功；dev server 下三个新/改模块均能被 Vite 正常编译。
- 集成测试用真实 `getMarketVolumeList()` 输出驱动预置规则，验证「每行一条 + 优先级取胜 + `onlyActive` 挡住无价条目」。

---

## 十六、市场监控：收藏 与 区间筛选（2026-10-02）

### 16.1 需求
市场监控页要能**收藏**条目，并支持对数值列做**区间筛选**：
交易量高于/低于/在两值之间、涨跌幅高于/低于/在两值之间。

### 16.2 新增文件
- `src/common/apis/marketvolume/filters.ts` —— **纯函数**：`NumericRange`/`RangeMode`、
  `rangeValueOf`/`matchesRange`/`applyRangeFilters`/`countActiveRanges`/`createEmptyRanges`。
- `src/common/components/RangeFilter/index.vue` —— 可复用控件（5 个指标复用同一套渲染）。
- `src/pinia/stores/marketfavorite.ts` —— 收藏（key `market-favorite-items`），按 `hrid|level`。
- `src/common/apis/marketvolume/keys.ts` —— **零依赖**的 `marketRowKeyOf`（全站行 key 的规范定义）。
- `tests/marketvolume-filters.test.ts`（25 用例）。

### 16.3 为什么收藏要新建一个 store
项目已有两套「收藏」都不是市场条目：`favorite.ts`（key `manual-list`）收藏的是**生产配方**、
`enhancer.favorite` 收藏的是**装备 hrid**。市场条目的粒度是 **(物品, 官方市场档位)**，
且市场里有材料/消耗品（不只是装备），硬塞进任一个都会把语义搅混。

### 16.4 区间语义（刻意定的三条）
1. **端点一律包含**（`≥` / `≤` / `区间` 都含端点）——选项写成符号而非"高于/低于"以消除歧义，
   并与提醒规则的 `gte`/`lte` 统一理解。
2. **阈值留空 = 该条件不生效**，不是"匹配空集"（否则刚切模式、还没填数字时列表会整片变空）。
3. **值缺失的条目在条件启用时不匹配**（`changePct` 无历史、`price === -1` 无价）；
   `区间` 填反时自动对调；成交量/成交额取值与表格展示列一致（优先滚动量、回退累计量）。

### 16.5 顺带修掉的一处架构耦合
`marketRowKeyOf` 原本放在 `common/apis/marketvolume/index.ts`，而这个 barrel 会 `import`
`@/common/apis/game`——game 在**顶层**注册了 `watch(..., { immediate: true })` 重建全量索引，
在没有数据的时机（单测最容易）导入即抛 `Cannot read properties of null (reading 'actionDetailMap')`。
已把它抽到零依赖的 `keys.ts`，store / 纯函数模块直接引该文件，**顺带让收藏 store 可独立单测**。

### 16.6 一处需要更正的旧结论
上一轮（§十五）在报告里写过「`vite build --mode public` 会剔除私有路由，`marketvolume` 只出现在
private 产物里」——**这是错的**。实测在 public 产物里 grep 得到 `market-favorite-items`、
`market-alert-config`、`区间筛选` 等字符串，说明**私有页代码照样打包**（`remove-private-code` 插件
本就是被注释掉的，见 §十三/`BUILD_SYSTEM.md`），public 模式只是不注册路由。**这再次印证「非安全隔离」。**

### 16.7 验证
- `vue-tsc` 通过；`vitest` **27 文件 / 152 用例全绿**（新增 25 个）。
- `vite build --mode public`（13.6s）与 `--mode private`（13.3s）均成功；dev server 下 5 个新/改模块均可编译。
- **真实官方快照验证**（872 物品 / 3707 条目）：成交量最大 3,745,189、中位 39；
  「成交量 ≥ 10000」→130 条、「≤ 100」→2679 条、「1000~100000」→141 条、「价格 ≥ 100000」→2263 条、
  「成交额 ≥ 1e8」→141 条、两条件叠加 →8 条；阈值取最大值时仍命中 1 条（验证含端点）；阈值留空返回同一引用。
- ⚠️ `public/data/market.json` **只有 `ask/bid/vendor`、没有 `price/volume`**，用它验成交量会得到全 0，
  别据此判断筛选坏了。

---

## 十七、价格档位口径补齐为 6 个（2026-10-02）

### 17.1 变更
原为 4 个（`ASK` / `ASK_LOW` / `BID` / `BID_HIGH`），现补齐为
**左/右 ×（`-` / 原价 / `+`）共 6 个**，新增 `ASK_HIGH`（标签 `左价+`）与 `BID_LOW`（标签 `右价-`）：

| 枚举 | 标签 | 含义 |
| --- | --- | --- |
| `ASK_LOW` | 左价- | ask 压一档 |
| `ASK` | 左价 | ask 原价（默认买价） |
| `ASK_HIGH` | 左价+ | ask 抬一档 ← 新增 |
| `BID_LOW` | 右价- | bid 压一档 ← 新增 |
| `BID` | 右价 | bid 原价（默认卖价） |
| `BID_HIGH` | 右价+ | bid 抬一档 |

### 17.2 只改两处，其余自动生效
1. `pinia/stores/game.ts`：枚举 + `PRICE_STATUS_LIST`（顺序＝同一报价内价格由低到高，`-` → 原价 → `+`）。
2. `common/apis/game/index.ts`：`convertPriceOfStatus` 的 `switch` 换成
   **`STATUS_STEP_SPEC: Record<PriceStatus, { base, dir }>`**。

`STATUS_STEP_SPEC` 用 `Record` 而不是 `switch` 是刻意的：**漏掉枚举成员会被类型检查拦下**。
写成 `switch` 且无 `default` 时，最容易出的错是「下拉能选、价格却没变化」这种静默失败。

其余全部自动生效：所有价格下拉都是 `v-for="item in PRICE_STATUS_LIST"`
（`enhancer` 买价×2、`enhancest` 买价/卖价，以及 9 个页面共用的
`common/components/PriceStatusSelect/index.vue`）。`priceStepOf(price, high, enhanced)` 无需改动，
强化物品的 ×5 增量自动适用；`_priceCache` 的 key 已含 `buyStatus|sellStatus`，新口径自带缓存桶。

### 17.3 验证
- `vue-tsc` 通过；`vitest` **28 文件 / 159 用例全绿**（新增 `price-status-tiers` 7 用例）。
- 实测：0 级三个左价口径严格递增、抬/压幅度 = **0.366%**；`level 3` 幅度 = **1.83%**、与 0 级之比 **= 5**；
  10 金物品一档不足 1 金时保底移动 1 金（→ 11 / 9）；无报价档位在 A 模式下任何口径都保持 **-1**。
- `vite build` public/private 均成功；产物中可读到 6 个枚举、6 项列表与 6 条 `{base, dir}`。

### 17.4 顺带发现（未处理）
`PriceStatusSelect` 有两个**内容完全相同、仅行尾不同**的副本：
`common/components/PriceStatusSelect/index.vue` 与 `pages/dashboard/components/PriceStatusSelect.vue`。
**前者被 9 个页面引用，后者零引用（死文件）**，可安全删除。

---

## 十八、排除护符（三开关独立）与「隐藏小成交量」（2026-10-02）

### 18.1 排除护符
护符在数据里不是分类而是**部位**（`equipmentDetail.type === "/equipment_types/charm"`），
实测 **102 件**，占 532 件装备的 19%——是最大的装备类别。它原被「排除装备」一并剔除，
所以直接加一个「排除护符」会**永远没反应**（与当年「排除首饰」踩的坑同源）。

因此三个开关改为**互相独立**，新增 `isCharm` / `banCharm`：

| 勾选 | 去掉 | 保留 |
| --- | --- | --- |
| 排除装备 | 既非首饰也非护符的装备 | 首饰、护符 |
| 排除首饰 | 项链/戒指/耳环 | 其余 |
| 排除护符 | 护符 | 其余 |
| 三个都勾 | 全部装备 | 只剩非装备 |

⚠️ **`banEquipment` 不再吞并护符**（此前会）。为让**各页默认行为完全不变**，`banCharm` 的默认值
一律取与该页 `banEquipment` 相同：`dashboard` / `manualchemy`（`banEquipment: true`）默认也排除护符，
其余页面两者都是 `false`。**不主动改开关就不会看到列表变化。**

改动点：`common/utils/game.ts`（判定）、`common/apis/utils.ts`（`handleSearch`）、
`common/apis/favorite/index.ts`（收藏夹路径同一语义）、`leaderboard/type.d.ts`、
`SearchPanel/types.ts`、11 个页面的默认值 + `panelFields`、`enhanceexp` 的生效条件摘要。
顺带给 `manualchemy` 补上了它原先缺失的「排除首饰」。

### 18.2 隐藏小成交量（可开可关的持久设置）
新 store `pinia/stores/marketfilter.ts`（`{ hideLowVolume, minVolume }`，key `market-filter-config`）：
默认**关闭**、阈值 `100`；设置面板新增「市场监控」分组，市场监控页头部有一个**同源**开关。

- 取值口径与该页「成交量」列一致（`rangeValueOf(item, "volume")`：滚动量优先、回退当日累计量）。
- 与页面上已有的**手动区间筛选**是两回事（长期设置 vs 本次会话临时条件），两者叠加。

**实测效果**（官方快照，2944 条 = 物品×档位）：阈值 1 → 保留 623；10 → 415；50 → 311；
**100（默认）→ 保留 265 / 隐藏 2679**；1000 → 180；10000 → 118。
注意是按**行（物品×档位）**判定，多数强化档本身不成交，故同一装备的低档位也会被藏掉。

### 18.3 验证
- `vue-tsc` 通过；`vitest` **28 文件 / 164 用例全绿**。
- `ban-filter-independence` 真实数据验证：样本 532 = 首饰 23 + 护符 102 + 普通装备 407；
  leaderboard base 8760 条（首饰 161 / 护符 1015）→「仅排除装备」后首饰与护符**计数一个不变**，
  「仅排除护符」正好少 1015 条；三者都勾 = `onlyEquip + onlyJewelry + onlyCharm - 2*base`。
- `marketvolume-filters` 新增 5 用例覆盖过滤设置的默认值/持久化/坏数据归一化/reset。
- `vite build` public/private 均成功。

---

## 十九、抽取「检索结果页」骨架 useLeaderboardPage（2026-10-03）

### 19.1 先量再改
写了一个「行级最长公共块」扫描器（最小 8 行、跨 ≥2 文件）：全仓 **169 处重复块**，
最大单块 **40 行 × 8 个文件**。重复重心不是搜索面板（那个早已收敛成 `SearchPanel`），
而是**页面骨架**：分页、检索条件缓存、防抖检索、条件变化回第一页、排序、自动重算 watch、
详情弹窗、价格弹窗、买卖价状态。

最直观的样本：`jungle/index.vue` 与 `junglest/index.vue` 共约 850 行，**只差 217 行**，
差异几乎全是 API 路径、缓存 key、几个字段与注释 —— **三分之二完全相同**。

### 19.2 交付
新文件 `src/common/composables/useLeaderboardPage.ts`，把上述骨架全部收进一个 composable，
页面通过**别名解构**取用（`searchData: ldSearchData`、`list: leaderboardData`、`loading: loadingLD` …），
因此**模板一行都不用改**，改动只落在 `<script>`。

已迁移 8 页：`junglest/index`、`enhanceexp`、`enhanposer/index`、`enhanposer/enhanposest`、
`inherit`、`jungle/index`、`junglest/inherit`、`manualchemy`（共减少约 **453 行**）。

暂未迁移 3 页（结构确实不同，不可照抄）：`dashboard`（一页两套检索）、
`jungle/pickout`（接口多一个实参 + `usePriceStatus` 带第二参数）、
`decompose`（不用买卖价状态，需 `withPriceStatus: false`）。

### 19.3 顺手修掉的 bug
`manualchemy` 的分页缓存 key 历史上**误用了 `dashboard-leaderboard-pagination`**（复制粘贴产物），
会与 dashboard 共享分页状态。已改为自己的 key。

### 19.4 ⚠️ 过程中踩的两个坑（都写进开发指南了）
1. **「骨架区域」里混着各页特有逻辑**：实测 4 个页面在骨架之间夹着自己的业务逻辑
   （`enhanceexp` 的排序优先级联动 + 整行高亮、`enhanposer`/`enhanposest` 的模式缓存 watch、
   `junglerit` 的不逃逸回调）。按整段替换会**把它们一起删掉，而且 tsc 查不出来**
   （未被引用的函数删了不报错）。补救办法：算「各页该区域行的交集」找出特有行，
   替换后再对比**顶层声明集合**逐一确认。
2. **大段替换会改写文件行尾**：编辑器的大块替换会把 CRLF 文件整份转成 LF，
   `git diff` 立刻多出成百行噪声。改完必须 `git diff --stat` 与
   `git diff --ignore-cr-at-eol --stat` 对比复核。

另外还暴露了自己脚本的一个 bug：拼装替换块时**少了一个闭合花括号**，
6 个页面直接语法错误 —— 说明这类批量改写**必须先 dry-run 打印计划**再落地。

### 19.5 验证
- `vue-tsc` 通过；`vitest` **28 文件 / 164 用例全绿**；`vite build` public/private 均成功。
- 复扫重复块：**169 处 → 155 处**；已迁移页面参与重复的行数合计减少约 **3700 行**。
- lint 非风格问题保持在基线 3 条（均为 `enhanceexp` 既有问题）。

### 19.6 还剩什么
1. **模板侧的 40 行表格列块仍重复 8 次**（`t('经验 / h')` 那一段）—— 现在最大的单块重复；
2. 9 个页面重复的 `.row` 样式；
3. `dashboard` / `pickout` / `decompose` 三页的骨架迁移。

---

## 二十、目标时薪反解（2026-10-03）

### 20.1 需求
「如果我想要实现时薪多少多少，则最多或最少以某个价格买入。」
关键在于用户点出的**主要询价物品**：分解虚空茶叶→询价虚空茶叶，转化太阳石→询价太阳石。

代码里这个语义已经有现成对应：`ingredientList[0].hrid === this.item.hrid`
（`cost4Mat` 注释「从第 2 个原料开始计算」也印证 `[0]` 是本体），
所以主要询价物品直接取 `ingredientListWithPrice[0]`。

### 20.2 为什么是闭式解
时薪对每个单价都是线性的（`profitPH = Σ系数×countPH×price − ΣcountPH×price`），
单价涨 1 金币对时薪的影响是常数，于是：

**临界单价 = 当前单价 + (目标时薪 − 当前时薪) / 系数**
- 材料侧 系数 = `−countPH`（买贵了利润降）
- 成品侧 系数 = `+countPH × 税后系数`（金币不课税，系数不含税率）

`countPH` 由计算器直接给出，不需要重新推导任何公式。

### 20.3 交付
- `src/common/utils/price-solve.ts`（纯函数，零运行时依赖）：`solveCandidatesOf` /
  `primaryCandidateOf` / `solvePriceForTarget`，输出还带 `priceGap` 与 `impossible`。
- `src/pages/dashboard/components/ActionSolveCard.vue`：详情弹窗内的反解面板 ——
  目标时薪输入、询价物品下拉（默认主要物品）、临界价大字结论，以及**档位对照**：
  材料侧列 `左价-/左价/左价+`、成品侧列 `右价-/右价/右价+`，逐档标出是否达标。
  这样就把临界价翻译成了「我能买到哪个档位」。
- `ActionDetail.vue` 底部挂载（所有检索页共用该弹窗，一处接入全站可用）。

### 20.4 验证
- `vue-tsc` 通过；`vitest` **39 文件 / 350 用例全绿**；`vite build` 双模式成功；
  dev server 下三个新/改模块均可被 Vite 正常编译。
- 手算样例验算：材料 `countPH=2 @100`、成品 `countPH=1 @1000`、时薪 760；
  目标 500 → 材料临界价 230、成品临界价 729.1667，代回利润均精确等于 500 ✓
- 真实计算器上，系数模型对 `costPH` / `incomePH` 的相对误差 **< 1e-9**
  （decompose 实测 2239964909.2155 对 2239964909.2155）—— 模型被验过，反解才可信。
- 真实数据可读性：如「转化 Artisan Tea 现价 2800 → 要做到 1.69M/h 需买价 ≤ 1716（便宜 1084）」；
  临界价 ≤ 0 的情形标为不可达（本身就是"该方案已到极限"的有用信息）。

⚠️ 构造计算器后必须调 `run()`，`result`（含 `profitPH`）由它填充。

---

### 20.2 同日改进：时薪 / 日薪切换 + 修掉「输入框清空则面板消失」

用户反馈两点：（1）**重要** 时薪输入框一清零，整张面板就消失；（2）希望有时薪/日薪切换。

- **bug 根因**：`el-input-number` 清空时把 v-model 置为 `undefined`，而面板根节点是
  `v-if="... && solveResult"` ⇒ 整块从 DOM 消失，用户没法重新填。
  改法：**留空回落到当前收益**并给出提示。配套注意判空要用 `== null` 而非 falsy
  ——`0` 是有效目标（解「不亏本」的临界价）。
- **日薪口径**沿用项目既有定义 `profitPDFormat = profitPH × 24`（`Calculator.run()`），
  **内部只以时薪计算**，输入框仅做单位换算，因此两种模式解出的临界价**必然完全一致**。
  新增纯函数 `SolveUnit` / `HOURS_PER_DAY` / `toProfitPHOf` / `fromProfitPHOf` / `resolveTargetProfitPH`。
- 测试从 9 个用例增到 **15 个**：新增「日薪 = 时薪 × 24 与往返一致」「两种口径解出的临界价相同」
  「留空回落当前值」「**0 是有效目标**」「日薪数额换算成时薪」5 项。
- 验证：`vue-tsc` 通过；`vitest` **39 文件 / 350 用例全绿**；`vite build` public/private 均成功；
  dev server 下两个模块均编译通过；lint 非风格问题 0。
- 顺带：`i18n` 的 key 就是中文原文，所以改中文文案等于**换 key**——
  新键已补进 `en.ts` / `zh-tw.ts`，被替换的旧键同时删除（不留孤儿键）。


## 二十一、填表算利润（非实时，2026-10-03）

### 21.1 需求
「填入购买时的价格等，就能获得利润等。**非实时的**——因为实时的不准确，价格会变，
我买的时候是这个价格，但是卖的时候是另外的价格。」

→ 独立页面（路由 `/profitform`，菜单「填表算利润」，归在「利润检索」组），
用自己填的成交价算利润，**实时市价只作为默认值**。

### 21.2 设计地基：默认值必须精确复现计算器
```
总成本 ≡ calc.result.costPH      总收入 ≡ calc.result.incomePH
总利润 ≡ calc.result.profitPH    总耗时 ≡ 1 小时      时薪 ≡ calc.result.profitPH
```
做法：`perActionCount = countPH / actionsPH`、`actions` 默认 = `actionsPH`、
`timeCostPerAction` 默认 = `NS_PER_HOUR / actionsPH`（两者相乘恰好 1 小时）。
这样"改哪格就是覆盖哪格"，且这条性质**可被单测直接断言**。

### 21.3 交付
| 文件 | 职责 |
| --- | --- |
| `common/utils/profit-form.ts` | 纯函数：生成默认值 + 算结果 |
| `common/apis/profitform/index.ts` | 6 个动作的可选物品枚举（要读 actionDetailMap，故放 API 层） |
| `pinia/stores/profitform.ts` | 手填值持久化（**只存覆盖值**，配方结构保持实时） |
| `pages/profitform/index.vue` | 页面 |

表单可改：**单价 / 单次数量 / 动作次数 / 单次耗时**（用户要求四项都可改）。

### 21.4 ⚠️ 一个只有跑测试才能发现的坑
强化计算器的 `available` 要求 `escapeLevel < originLevel < enhanceLevel` 且
**`protectLevel ≤ enhanceLevel`**，而 `protectLevel` 在配置里是**必填**。
不传 → `available = false` → 表现成「选择器列得出物品、却提示不支持该动作」。
「动作枚举闭环」测试（选择器列出的物品必须被计算器判定可用）**一上来就抓到了它**，
纯读代码是看不出来的。

各动作的判定依据：强化 `enhancementCosts` / 分解 `decomposeItems` /
转化 `transmuteDropTable` / 点金 `isCoinifiable` / 制造与采集看
`actionDetailMap` 里的 `/actions/<专业>/<物品key>`（制造 5 种、采集 3 种专业，
需由物品反推 action）。

### 21.5 验证
- `vue-tsc` 通过；`vitest` **39 文件 / 350 用例全绿**；`vite build` 双模式成功；dev server 编译通过。
- 默认值复现：decompose 成本 `2239964909.22` 对 `2239964909.22`、总耗时 **1.000000 小时**；transmute 同。
- 枚举闭环：6 个动作样本全部 `available = true`；制造样本反推为 `tailoring`、采集为 `foraging`。
  数量：强化 532 / 分解 742 / 转化 622 / 点金 889 / 制造 647 / 采集 26。
- 手算样例：材料 2@100 + 成品 1@1000 → 成本 200、收入 960、利润 760、时薪 760、利润率 3.8；
  材料改 230 → 利润恰为 500（与「目标时薪反解」的临界价 230 互为佐证）。

---

## 二十二、推送受阻的真实原因与 `一键推送.bat`（2026-10-03，含同日订正）

> **订正**：本轮最初把推送失败归因为「出口代理按域名白名单放行、`github.com` 不在名单里」。
> **那个结论是错的** —— 当时的探测跑在受沙箱代理影响的 shell 里，测的是沙箱出口，不是本机。
> 同日重测后的正确结论如下。

1. **真正的阻塞：PAT 缺 `workflow` scope。** API 实测 `x-oauth-scopes: repo`（只有 `repo`）。
   本次推送会改 `.github/workflows/deploy.yml` / `release.yml`，GitHub 对这类推送硬性要求 token 带
   `workflow`，否则 `! [remote rejected] ... without 'workflow' scope`。
   **加权限即可**（https://github.com/settings/tokens），**与网络无关**。
2. **网络是「偶发抖动」，不是不通。** `hosts` 被 **Steam++（Watt Toolkit）** 写入 100+ 条
   `127.0.0.1 <域名>`（github / twitch / steam / huggingface …），本机 `443` 的监听者是
   `Steam++.Accelerator.exe`。但它的本地反代是通的：走 hosts 与走真实 IP 探测 `git-receive-pack`
   都返回 `401`（=需要认证），`git push --dry-run` 能拿到 `200`。只是偶尔 `Connection was reset`。
3. **另有凭据助手打架**：`PortableGit/etc/gitconfig` 的 `credential.helper=helper-selector` 与
   `~/.gitconfig` 的 `store` 并存；前者被调用时会弹 GCM 的「CredentialHelperSelector」窗并**阻塞等待**，
   表现为 push 卡住。想只用 `~/.git-credentials` 里的 PAT，把列表显式重置为 `""`（清空）+ `store`。

**因此新增仓库根目录的 `一键推送.bat`**（双击即可，与既有 `一键部署.bat` 同一套约定）：
清 DNS → 校验 git 与远程 → **预检待推提交是否触及 `.github/workflows/`** → `git push`；
失败时按日志**分类**给结论（workflow scope / 网络 / 凭据），而不是笼统地说「网络问题」。
脚本 ASCII-only + CRLF，开头 `chcp 65001` 让中文提交标题可读。

⚠️ 另有历史遗留的 git 对象损坏（`assets/vue-8ikB7t_e.js` 的 blob，`git fsck` 报 `missing blob`），
已从当前树删除但旧提交仍引用，`git fetch` 收尾的 `geometric-repack` 会因此报错。

## 二十三、无市价兜底重做：从 A/B/C 三档改为左右解耦的优先级链（2026-10-03）

起因：用户要求「需要右价时没右价就用左价、需要左价时没左价就用右价、两端都没有就用大全套、
还能手动强制用大全套」，要**灵活、自由度高、可选解耦**。旧的一个枚举同时管两侧，表达不了这些组合。

### 23.1 新模型

| 位置 | 内容 |
| --- | --- |
| `src/common/utils/price-fallback.ts`（新增，纯函数） | `resolvePriceSides` 是唯一解析出口；另有 `priceFallbackSignature`（进缓存 key）、`migrateLegacyMode`、`normalizePriceFallback` |
| `src/pinia/stores/game.ts` | `priceFallbackMode` → `priceFallback: PriceFallbackSettings`（左右各一条链 + `forceBigSet`）；localStorage key 由 `price-fallback-mode` 迁到 `price-fallback`（**旧 key 保留**，可回退） |
| `src/common/apis/game/index.ts` | `resolveLevel0Price` + level>0 内联分支 → **统一为 `resolvePriceOf(hrid, level)`**，`getPriceOf` 与 `getPriceSourceOf` 共用 |
| `src/pages/dashboard/components/GameInfo.vue` | 原「三档下拉」→ 弹出式设置：**左价 / 右价各自独立**的「借另一端」开关 + 「仍无着落时用啥」下拉，外加「强制大全套」与「恢复默认」 |

默认链 = `ask: {cross:true, then:"bigset"}`、`bid: {cross:true, then:"bigset"}`。
商店价保留为可选手段（`then: "shop"`），**并且**保留旧实现里"商店比市价便宜时改用商店价"这个
真实可达买价的优化（现在是可选项，不是默认行为）。

### 23.2 顺带修掉的两个真实缺陷（都是这次调查实测出来的）

1. **level>0 来源标记与价格漂移**：旧实现 level>0 单独写判定，条件与 level=0 不一致
   （ask 兜底多要求 `!marketItem`；来源却对 ask 也返回 `shop`，而 level>0 的 ask 根本不存在商店价路径）。
   实测：**模式 B 1402 条、模式 C 1404 条**（bid 端 0 条），UI 表现为「-1 却标成【商店】/【自产】」。
   数字本身是对的（走 `getPriceOf`），且 `selfProduceStat` 有 `ing.price <= 0 → continue` 守卫，
   所以**只是标签问题**。现在两侧共用一个解析函数，结构上不可能再漂移。
2. **切换设置后同一 tick 读到旧结果**：旧 `_priceResolutionCache` 的 key 只有 hrid，
   清缓存靠异步 watch。现在兜底设置签名进了 key。

`PriceSource` 相应增加 `cross`（借用另一端），UI 标注【借另一端】并提示「方向相反，仅供参考」。

### 23.3 验证

- `vue-tsc` 通过；`vitest` **39 文件 / 350 用例全绿**
- 新增 `tests/price-fallback-strategies.test.ts`（17 用例，纯函数，含 **360 组策略矩阵**不变量断言）
  与 `tests/price-fallback-integration.test.ts`（4 用例，真实数据）
- 实测：全物品 × 多等级共 **2163 个组合，来源与价格 0 漂移**；来源分布
  `market 1306 / selfcraft 2506 / cross 76 / none 438`
- 旧 A/B/C 行为**无损保留**：`bigset-c-verify` 在新预设下仍为「兜底对象 144 件、ask 全被大全套覆盖、
  bid=sellPrice」；「模式 A 无任何兜底」仍为 0
- `vite build` public/private 均成功；lint 非风格问题 0（`ActionPrice.vue` 那条 `define-macros-order` 是既有问题）
- i18n：新增 19~22 个键，并**删掉 8 个因 A/B/C 下线而失效的旧键**
  （用全仓扫描 `t("...")` 确认无引用，不靠印象）

## 二十四、多样搜索 / 筛选 / 查询的深层优化（2026-10-03）

起因：用户要求「更合理、更科学、效率更高、更好用、更贴近实际情况、更聪明、更符合人机交互」。

### 24.1 诊断结论

问题不在某个页面筛得不好，而是**有两套互不相同的查询系统**：
11 个检索页共用 `common/apis/utils.ts` 的 `handleSearch`，市场监控页独立手写 `filtered`，
两边**零共享**且语义互相矛盾（区间筛选一边是完整模式机、一边是裸 min/max 五段 if）。
另有 5 份各不相同的文本搜索实现。视图状态（keyword/排序/分页）全在组件 `ref` 里，
刷新即丢，全项目**没有任何页面用 route.query 同步筛选状态**。

### 24.2 新增

- `src/common/utils/query-engine.ts`：通用查询引擎（纯函数、零依赖）。多词检索 + 字段限定、
  一次遍历的短路谓词、稳定的显式 tiebreaker 排序、状态 ↔ URL 序列化。
- `src/common/utils/multilang-search.ts`：三语名称检索。物品名在数据里只有英文，
  中文/繁体在语言包里；改造前只匹配当前语言那一个，**切英文界面后搜中文名搜不到**。
- `src/pages/marketvolume/index.vue`：接入引擎 + 新增「结果计数」「重置筛选（N）」UI。
- `src/common/apis/utils.ts` 的 `handleSearch`：改为引擎谓词，**行为逐条不变**（34 用例锁定）。

### 24.3 顺带修掉的四个真实缺陷

1. `toComparable("12.3万")` 算成 **12.3**（差一个数量级，无任何报错）——单位后缀被直接删掉而非连乘。
2. **升序时缺失值翻到榜首**——原先只在降序时让 NaN 沉底。
3. **URL 往返把 `[1,2]` 变成 `["1","2"]`**，之后 `includes(2)` 恒为 false。
4. `compileQuery` 字段取值器签名反了会**静默返回全 false**（不报错），已调整签名。

### 24.4 验证

`vue-tsc` 通过；`vitest` **39 文件 / 350 用例全绿**（上轮 209，+90）；
`vite build` public/private 均成功（2961 模块）；lint 非风格问题 0。

## 二十五、区间条件模式化：4 种 → 9 种，检索页与监控页共用一套（2026-10-03）

起因：用户要求「第六条区间条件补齐模式补一下，这个正是我所推崇的，
一定要尽可能多的提供接口、窗口，**用户可以不用，但不能没有**」。

### 25.1 改造前的分裂

同一个「数值区间」有两套实现：检索页是**两个裸输入框拼 min~max，只能表达区间**；
市场监控页是 `RangeFilter` 组件 + `filters.ts` 的 `matchesRange`（4 种模式）。
判定也分两处（`handleSearch` 五段硬编码 `>=`/`<=` vs `matchesRange` 模式机）。

### 25.2 现状

- `query-engine` 的 `RangeMode` 扩到 **9 种**：在 `between` 之上加
  `outside`（区间之外）、`near`（带容差）、`eq`（浮点相等）、`topN` / `bottomN`（跨条目排行）。
- `SearchPanel` 的 range 字段改用 `RangeFilter` 组件 ⇒ 检索页与监控页**同一控件、同一判定**。
- `marketvolume/filters.ts` 的 `isRangeActive` / `matchesRange` **改为从 query-engine 再导出**，
  消除重复实现；`applyRangeFilters` 额外处理 `topN`/`bottomN` 的整表语义。
- `handleSearch` 新增 `rangeFromFlat` / `numOk`，把平铺 min/max + `__mode` 组装成 `RangeQuery`。

### 25.3 向后兼容

`SearchPanel` 做双向映射（模式存 `${minKey}__mode`，`minKey`/`maxKey` 照旧读写），
所以 11 个页面 / 29 个 range 字段的声明**一行未改**、历史本地条件**照常可用**。
`handle-search-parity` 的 34 个行为锁定用例全绿，证明旧语义未漂移。

### 25.4 顺带修掉的隐性 bug

`handleSearch` 读容差的键名是 `${minKey}__mode__tolerance`，`SearchPanel` 写的是
`${minKey}__tolerance` ⇒ 容差永远读不到、`near` 静默退化成 `=`。
**两种情况都返回"看起来合理"的结果**，靠"带容差/不带容差"对照才暴露。

### 25.5 验证

`vue-tsc` 通过；`vitest` **39 文件 / 350 用例全绿**（上轮 299，+37）；
`vite build` 双模式成功；新增 `tests/range-modes.test.ts`（21）与
`tests/search-range-modes.test.ts`（16）。

## 二十六、「到强化计算页查看」入口（2026-10-03）

起因：用户提到「『到强化工具中查看』这个功能你也并没有复制过去」。
实测**全仓搜索「强化工具」零命中** —— 它在当前代码里**不存在**，是新建而非补齐。

### 26.1 交互形态（用户确认）

- **位置**：每一行（每个项目）的最后，与「查看」并排
- **行为**：跳转到强化计算页，**并把当前行的装备带过去**（写 `enhancerStore.config.hrid`）
- **覆盖**：11 个含强化功能的利润页（强化页本身除外）

### 26.2 这里曾经做错过一次（重要教训）

首次实现是**纯路由跳转、不带任何参数**，当时的理由是：

> 强化页的配置本来就持久化在 localStorage（`pinia/stores/enhancer.ts:91`），
> 是玩家每个预设写好的。传参过去反而会覆盖它。

**这个推理是错的**，而且错在一个很典型的点上：
它只证明了「**持久化存在**」，却没回答「**持久化的值是不是用户此刻想看的那一件**」。

用户后来说得更直接：

> 「我要去强化，那么我点了之后，我要能在强化里面看到我要强化的这个东西。
> 不然我点了干嘛，不还得我手动输入一遍？」

⇒ 点的是**某一行**，期望看到的就是**那一件**。
只跳不带 ⇒ 看到的是上次残留的装备 ⇒ 还得手动重选 ⇒ **这个按钮没有意义**。

**修正后的做法**（见 §二十八）：只覆盖 `hrid`，其余配置保持玩家预设不变，
既满足「看到这一件」，又不抹掉玩家调好的计算条件。

⇒ **教训**：论证「要不要覆盖已持久化的状态」时，
「状态已持久化」**不构成**「不该覆盖」的充分理由，还要问一句：
**这个持久化的值，是用户此刻想要的吗？**

### 26.3 实现

`useLeaderboardPage` 新增 `gotoEnhancer`（8 个用 composable 的页面直接拿到）：

```ts
function gotoEnhancer() {
  router.push({ name: "Enhancer" })
}
```

另 3 个手写骨架的页面（`dashboard` / `decompose` / `jungle-pickout`）各自实现一份
—— 它们没用这个 composable（`dashboard` 一页有两套检索、`pickout` 接口多一个实参、
`decompose` 不用买卖价状态），本来就不该硬塞进来。

**覆盖的 12 处入口**（dashboard 有两个表格）：
`dashboard`×2、`decompose`、`jungle`、`jungle/pickout`、`junglest`、`junglest/inherit`、
`enhanposer`、`enhanposer/enhanposest`、`enhanceexp`、`inherit`、`manualchemy`。

图标用 `MagicStick`（强化页路由 `meta.elIcon` 用的就是它，chainbuilder 也在用）。
链接带 tooltip 说明「自动选中这一行的装备，计算条件沿用你的预设」。

### 26.4 验证

`vue-tsc` 通过；`vitest` **39 文件 / 350 用例全绿**；`vite build` 成功，
产物中可 grep 到 `去强化` / `To enhancer` / `Enhancer` / `去强化说明`。

## 二十七、行尾配置与 warning 消除（2026-10-03）

### 27.1 问题
`超级一键部署` 的 `[3/3]` 阶段刷出**近百行**
`warning: in the working copy of 'assets/xxx.js', LF will be replaced by CRLF`，
把真正的输出（同步了哪些文件、发布成功与否）完全淹掉。

### 27.2 根因（三层叠加）
1. 本机 `core.autocrlf=true` —— **系统级**默认，Git for Windows 安装时设的
2. 项目**没有 `.gitattributes`** ⇒ git 只能靠全局配置**无差别**转换所有文本文件
3. 被转的正好是**不该转的**：`gh-pages` 上全是 `assets/*.js|css`，
   文件名带内容 hash，转换只有坏处没有好处

顺带查出**历史污染**（不是本次引入的，是 `autocrlf` 长期作用的结果）：
- **39 个文件以 CRLF 存入索引**（`README.md`、几份文档、十几个 `.ts`）
- **9 个文件行尾混杂** —— `src/pages/jungle/index.vue` 是 **394 行 CRLF + 1 行 LF**

### 27.3 改动（提交 `e445ffe`）
- **新增 `.gitattributes`**：`* text=auto eol=lf`；构建产物 / 二进制 / 锁文件排除
- **`scripts/publish-gh-pages.mjs`**：clone 之后立刻
  `git config core.autocrlf false` + `core.safecrlf false`
  —— 不带 `--global` 时**只写该临时仓库的 `.git/config`**
- 顺带更正了脚本里一段会误导人的注释（原文把「差异仅为行尾规范化」写成
  `无需发布` 的**原因**，实际那描述的是历史现象；关掉 autocrlf 后它只是**双保险**）

### 27.4 验证（对照实验，非 dry-run）

在临时仓库里构造与 `gh-pages` 相同的情形（**仓库里有 CRLF 索引文件 + 工作区放 LF 版本**）：

| | warning |
| --- | --- |
| A) 不带 `.gitattributes` | **2 行** |
| B) 带 `.gitattributes` | **0 行** |

⚠️ 第一次的验证是**错的**：在新建的空仓库里测，A/B 都是 0 ——
没有已跟踪的 CRLF 文件，git 压根不报 warning，**等于没验证**。

### 27.5 刻意不做 renormalize
`git add --renormalize` 会列出 344 个文件，但**只有 48 个内容真会变**
（39 CRLF + 9 mixed），其余 296 个只是被列出、内容不变。
按「最小变更」原则本次不执行 ⇒ 那 48 个继续以 CRLF/mixed 存索引。
代价：别的平台 clone 会看到整文件行尾变化。**若要归一，单独提一个 commit 更清晰。**

## 二十八、「去强化」带上当前行的装备（2026-10-03 修正）

起因：用户反馈「『去强化』这个 icon 做的不错……只是没有带进去啊。
我能理解吗，就是我要去强化，那么我点了之后，我要能在强化里面看到我要强化的这个东西。
不然我点了干嘛，不还得我手动输入一遍？」

⇒ 首次实现（`f0af1b2`）只做 `router.push({ name: "Enhancer" })`（**不传参**）是**错的**，
错因见 §26.2。

### 28.1 机制（全部实测确认）

| 事实 | 位置 |
| --- | --- |
| `enhancerStore.hrid` 是 `config.hrid` 的 **getter**（同一个值） | `pinia/stores/enhancer.ts:67` |
| 强化页**监听** `hrid` 变化并自动选中装备 | `pages/enhancer/index.vue`：`watch(() => enhancerStore.hrid, syncFromStore, { immediate: true })` + `onActivated(syncFromStore)`（2026-10-06 由 `onMounted` 改监听，见 §31） |
| 每行的 `row.hrid` 现成可用 | 模板里已在用：`jungle/index.vue:155` 的 `<ItemIcon :hrid="row.hrid" />` |
| `Calculator` 实例的 `hrid` 来自构造参数第��项 | `src/calculator/index.ts:40-42` |

⇒ **跳转前写 `config.hrid = row.hrid`，强化页会自己选中那一件。**

⚠️ **2026-10-06 修正**：本节原先写的是「强化页**挂载时**读它」，
即目标页只在 `onMounted` 读一次。该实现在目标页实例被复用时失效
（表现为「第二次点击去强化带不进装备」），已改为**监听 hrid 变化**。
详见 §31；上面的表已同步为修复后的表述。

### 28.2 实现

```ts
// useLeaderboardPage（8 个页面共用）+ 3 个手写页各一份
function gotoEnhancer(row: Calculator) {
  if (row?.hrid) {
    useEnhancerStoreOutside().config.hrid = row.hrid
  }
  router.push({ name: "Enhancer" })
}
```

**新增 `useEnhancerStoreOutside()`**（`pinia/stores/enhancer.ts`）——
composable / 路由跳转这类**组件 setup 之外**的场景拿不到当前 pinia 实例，
必须显式传应用级 `pinia`。写法与既有的 `usePlayerStoreOutside` 一致。

模板 12 处由 `@click="gotoEnhancer()"` 改为 `@click="gotoEnhancer(row)"`。

### 28.3 为什么**只**覆盖 hrid，其余不动

起始/目标等级、逃逸等级、时薪、税率、件数、期望成功次数
都是玩家自己调好的**计算条件**，换了装备后沿用同一套才有可比性。
全覆盖等于抹掉玩家的预设。

持久化会同步落盘（`config` 有 `deep watch` → `saveConfig`），
但这与「在强化页手动选装备」的结果完全一致 —— 都是「最后一次看的装备」，
**刻意保持同步，不引入一次性状态**。

### 28.4 验证（四层）

| 层 | 结果 |
| --- | --- |
| `vue-tsc` | **0 报错** |
| `vitest` | **39 文件 / 350 用例全绿** |
| `vite build --mode public` | 成功；产物中 `config.hrid` 命中 6 个 chunk、新文案命中 1 个 |
| dev server 编译 | 7 个相关模块全部 **HTTP 200** |
| **运行时链路**（最关键） | 编译产物里逐段确认：<br>① `gotoEnhancer(row)` 里 `useEnhancerStoreOutside().config.hrid = row.hrid`<br>② store 产物里 `hrid` getter + `useEnhancerStoreOutside` 各 1 处<br>③ 强化页产物里读取 `enhancerStore.hrid` 并调用 `onSelect`<br>④ 模板 4 个抽验页均传 `row` |

⚠️ **2026-10-06 修正**：③④ 原先逐字锁定的是 `onMounted(...)` 那段代码。
「锁定具体实现」本身没错，但**当那段实现被证明有缺陷时，它就成了枷锁** ——
测试全绿却漏掉了「第二次点击失效」。现已改为按**行为**（hrid 变化 → 选中跟随）
锁定，见 §31 与 `tests/goto-enhancer-carryover.test.ts`。

### 28.5 顺带修正的过时表述（9 处）

首次实现把「不传参」的理由写进了 **3 处代码注释 + 6 处文档**
（`AI_CONTEXT §20.6`、`PROJECT_CONTEXT §26.1/26.2/26.3`、tooltip 文案）。
本轮全部改为「带 hrid」的正确描述；§26.2 保留**旧说法的引用**作为历史记录
（那节本身就是记录这个错误的），并补上教训。

tooltip 文案也改了：原来写「只跳转、不会覆盖你的预设」（与新行为相反），
现为「自动选中**这一行**的装备。起始与目标等级、逃逸等级、时薪、税率等
计算条件沿用你自己设的预设，不受影响」。

## 二十九、冲泡护符转化的数据正确性修复（2026-10-03）

起因：用户要求「全部修复，让结果符合游戏实际」。

### 29.1 修的五处（全部有实测依据）

| # | 问题 | 修法 | 验证 |
| --- | --- | --- | --- |
| 1 | **催化剂期望消耗写成 `successRate`**（应为 `1/successRate`） | `AlchemyCalculator` 新增 `catalystCount` getter，三处炼金共用 | 实测：转化催化剂 0.6 → **1.667**、至高 0.65 → **1.538**（原低估 2.37~2.78×） |
| 2 | **催化剂标签是虚构物品名** | 「普通/主要催化剂」→「转化/至高催化剂」；`chainbuilder` 按 `step.kind` 分派 | 游戏 `data.json` 只有四种催化剂，正确的两个 key 三个语言包全缺，已补 |
| 3 | **档位倍率硬编码** | `TIER_ESSENCE_COUNT` → 从 `actionDetailMap.inputItems` 推导 | 数值**完全不变**（证明只是消除隐患，行为一致） |
| 4 | **制作副产品混进转化产出** | 新增 `byProducts` / `byProductValuePH`，按 hrid 剔除 | 工匠箱（`rareDropTable`）不再出现在 `products` 里 |
| 5 | **市价缺失未标注** | 新增 `noMarketQuote`，UI 加警示条 + 理想利润列 tooltip | 实测五档 10 种护符全部 `ask/bid = -1` |

### 29.2 用户追加要求：副产品的利润不算进来

用户原话：「副产物的利润就别加进来了。只看护符。」

⇒ 收入口径收紧为**只计护符**。`productMeta` 加一道 `.filter(p => p.hrid.endsWith("_charm"))`，
把 `TransmuteCalculator.productList` 里的三类东西区分清楚：

| 来源 | 内容 | 本页处理 |
| --- | --- | --- |
| `transmuteDropTable` | 10 个同档位护符 | ✅ **计入** |
| `actionDetailMap.rareDropTable` | 工匠箱（制作阶段的副产品） | ❌ 剔除，列入 `byProducts` |
| `getAlchemyEssenceDropTable` | 炼金精华（转化阶段精华掉落，约 48/h） | ❌ **剔除**（用户要求只看护符） |

⚠️ 第三项我一度判错：先以为它也是制作副产品，查了
`game/index.ts:606-613` 才发现它是**按 `timeCost / 6min × (itemLevel+100)/100`
公式算的转化阶段掉落**。数值极小（占 incomeIdealPH 的 0.0000%），
但既然口径要干净，就一并剔除。

### 29.3 一个必须说明的事实：按「价格上限」算，利润是负的

修完后实测（`charmtransform` 五档 × 三档催化剂，**全部为负**）：

| 催化剂 | 基础档利润率 | 宗师档利润率 |
| --- | ---: | ---: |
| 无 | −25.6% | −24.6% |
| 转化催化剂 | −15.0% | −13.2% |
| 至高催化剂 | −14.5% | −5.5% |

**这不是 bug，是「价格上限」这个定义本身决定的。**

「价格上限 = 用对应精华从零制作的成本」⇒ 意味着**你最多只能按自制成本卖掉**。
而转化有 47.5%~35% 的失败率（收入乘成功率，成本不乘）⇒ 每做一次都亏。

手算验证（基础档、无催化剂）：
```
投入  = 10,000 冲泡精华 × 285 = 2,850,000
期望收入 = Σ(9 个护符上限) × 10% × 0.525 = 4,045,000 × 0.525 = 2,123,625
⇒ 每次尝试亏 25.5%
```

⇒ **转化本身不创造利润，它只是把「冲泡精华」换成「别的技能精华」。**
真正盈利的前提是**市场愿意给高于自制成本的价格**（供不应求），
而实测市场上一件都卖不掉 ⇒ 前提不成立。

所以 UI 上加了警示条，明确写清这件事，而不是给一个不存在的收益预期。

### 29.4 测试

新增 `tests/charmtransform-data-correctness.test.ts`（**9 个用例**），
逐条锁住本轮的修复，防退化：

1. 催化剂期望个数 = `1/successRate`，且 **> 1**，且 ≠ `successRate`（反向断言）
2. `catalystRank=0` 时不出现催化剂原料
3. 档位倍率与 `inputItems` 独立推导一致 + 锁住具体数值（10000/80000/480000/1920000/3840000）
4. 制作副产品不在 `products` 里但在 `byProducts` 里
5. 价格上限逐项核验 = `本技能精华数 × 精华 ask`
6. `noMarketQuote` 与「产出是否全部无报价」一致
7. 转化产出只有护符（10 个）
8. 产出里不含非护符
9. 护符概率之和为 1

**过程中我写错过一次测试期望**：`⑥ 概率之和` 最初把炼金精华也算进去了，
失败后查 `productList` 组成才发现三者并存 ⇒ 改成「只累加护符」。
另一处 `⑦ 收入` 我按 `Σ(cap×rate) × 税率` 手算，差了 425 倍 ——
**是我漏了 `gainPH = actionsPH × successRate`**，代码是对的、我手算错。

### 29.5 验证

`vue-tsc` **0 报错**；`vitest` **39 文件 / 350 用例全绿**（上轮 336，+9）；
`vite build --mode public` 成功（12.40s，2961 模块）；
三份改动文件**零行尾 churn**。

### 29.6 未改（有意保留）

- **coin 成本公式**（转化 `sellPrice/5`、分解 `50+5×itemLevel`）：游戏
  `inputItems` 为 null，无权威数据，三个炼金公式都是项目经验值，量级占 1~8%
- **`Catalytic Tea` / 暴饮之囊**：实测已正确计入（52.5% = 0.5 × (1+0.05)）
- **等级惩罚**：已实现；玩家炼金等级 100 ⇒ 五档 `levelRatio` 全为 0，不触发

## 三十、enhanposer（强化分解）数据正确性 + 按需计算（2026-10-06）

起因：用户亲测发现「有问题」，并明确指出 **「只看目标等级」问题最严重**、
**「不分解模式好像可以正常运行」**（实测确认，见 §30.2）、以及
**网友反馈「点进这个页面就要运算很久」**。

### 30.1 ① 「只看目标等级」永远返回 0 行（最严重）

**根因**：本页把 `conditions` 直接交给通用 `handleSearch`，
而它的区间判定是 `cal.actionLevel`（`apis/utils.ts:276-277, 336`）。
但本页 `actionLevel === item.itemLevel`（**物品等级**，实测 8700 行全部相同），
于是「目标等级 5」变成去匹配「**物品等级** 5」—— 本页没有物品等级 5 的装备
（最低 1、绝大多数 90+）⇒ **0 行**。

**修法**：与同架构的 `enhanposest` 一致，用 `handleConditions` 显式传入取值函数：

```ts
profitList = handleConditions(profitList, params, (item: WorkflowCalculator) => {
  return (item.calculator as EnhanceCalculator).enhanceLevel
})
const searchParams = { ...params }
delete searchParams.conditions   // 避免通用检索的「步数」正则误伤
```

**实测验证**（修复后）：

| 条件 | 结果 | 期望 |
| --- | --- | --- |
| 目标等级 1 / 5 / 10 / 20 | 各 435 行，等级集合 `[N]` | 一致 |
| 区间 8~10 | 1305 行，等级集合 `[8,9,10]` | 一致 |
| 多行 `[3 或 7]` | 870 行 | 一致 |

> 💡 **`enhanposest` 早就用对了**（它传了 `item.calculator.enhanceLevel`），
> 只有 `enhanposer` 漏了。这是同架构两页不一致的典型案例。

### 30.2 ② 「不分解模式效果不错」—— 实测确认，且它揭示了性能根因

用户直觉准确，实测：

| 模式 | 行数 | **首次计算耗时** |
| --- | --- | ---: |
| **不分解**（`noDecompose: true`） | 8,700 | **27 ms** |
| 分解（默认） | 8,360 | **73,654 ms（73.7 秒）** |

⇒ 两者**快 2700 倍**，原因不是「分解计算慢一点」，而是：
`noDecompose` 走**独立分支**（`steps = [EnhanceCalculator]` 只 1 步），
而分解是 `steps = [Enhance, Decompose]` 2 步。
**分解里还有 `getAlchemyRareDropTable` / `getAlchemyEssenceDropTable` 等重计算。**

### 30.3 ③ 「进页面就运算很久」—— 两处一起改

**问题**：`calcEnhanceProfit` 无条件 `for (enhanceLevel = 1; <= 20)`，
≈ 435 物品 × 20 档 × protectLevel × catalystRank ≈ 5 万次 `WorkflowCalculator`。

**修法 A：把目标等级从「筛选条件」改成「计算参数」**

```ts
function targetLevelsOf(params) {
  // ① params.calcLevels（UI 的「计算」按钮用）
  // ② conditions[].steps
  // ③ conditions[].minLevel/maxLevel
  // ④ 都没填 ⇒ 默认只算 +1（**不**默认 1~20，否则又是 73 秒）
}
```

`modeSignature` 加入 `lv=...` ⇒ 不同等级集合是**独立缓存**，不会互相顶掉。

**实测提速**（分解模式）：

| 计算范围 | 耗时 | 行数 |
| --- | ---: | ---: |
| 只算 +1 | **999 ms** | 418 |
| 算 +1~+5 | 6,958 ms | 2,090 |
| 算全部 20 档 | 70,863 ms | 8,360 |

⇒ **73.7 秒 → 不到 1 秒（省 98.6%）**

**修法 B：加「计算」按钮（按需计算）**

`useLeaderboardPage` 新增 `immediate?: boolean`（默认 `true` ⇒ **其它 10 个页面
行为完全不变**）。`enhanposer` 传 `immediate: false`，
进页面不再自动计算，显示「尚未计算」提示 + 「计算」按钮 + 「全部等级」开关。

> ⚠️ `immediate: false` 只影响**首次**取数；分页/市场数据/买卖价变化的 watch
> 仍然照常触发，所以分页切换、买卖价切换都不受影响。

**UI 提示**（避免用户盲等）：
- 「将计算的目标等级：1、5、10」+ 预估秒数
- 勾「全部等级」时明示「约需 70 秒」

### 30.4 ④ 补齐多样搜索 / 筛选 / 过滤 / 选择

对比同架构其它页，enhanposer 缺 `excludes`（反向排除），range 只有 2 个（其它页 3~5）。已补：

| 维度 | 类型 | 说明 |
| --- | --- | --- |
| 多物品选择 | `name: string[]` | 已有 |
| **只看目标等级** | `conditions` | 已有（**本轮修好**） |
| **排除（产品名 + 生产动作）** | `excludes` | **新增** |
| 物品等级区间 | `range: minLevel/maxLevel` | **新增** |
| 利润/天区间 | `range: minProfitPD/maxProfitPD` | **新增** |
| 利润率 / 风险 | `range` | 已有 |
| 5 个排除开关 + 不分解模式 | `checkbox` | 已有 |
| 材料买价 / 成品售价口径 | `select` | 已有 |

⚠️ **「物品等级」与「目标等级」是两件事，文案已写清**：
- `conditions` ⇒ 强化到 +N（**决定算什么**）
- `minLevel` ⇒ 装备本身等级（**决定看哪些装备**）

### 30.5 测试

新增 `tests/enhanposer-fix.test.ts`（**5 个用例**）：
1. 目标等级按 `enhanceLevel` 命中（含反向断言：不混入其它等级 —— 正是原 bug）
2. 区间与多行 OR 语义
3. 目标等级是计算参数（单档 < 5s；5 档行数 = 1 档 × 5）
4. 不填条件时**默认只算 +1**（防回归到 1~20）
5. 物品等级区间与目标等级相互独立

### 30.6 验证

`vue-tsc` **0 报错**；`vitest` **39 文件 / 350 用例全绿**（上轮 345，+5）；
`vite build --mode public` 成功（12.68s）；改动文件零行尾 churn。

### 30.7 过程中我犯的两次错（都是测试写错、代码对）
1. 探针里 `const expect = all.filter(...)` **遮蔽了 vitest 的 `expect` 函数**
   ⇒ `expect2 is not a function`。改名 `expectCount` 后通过。
2. 全量测试时忘删 `tests/_probe-fix.test.ts`，被算进 39 个文件里报 3 个失败
   ⇒ 删掉后 38/345 全绿。**探针文件用完必须删**。

---

## 三十一、「去强化」第二次点击带不进装备（2026-10-06）

### 31.1 现象

用户亲测：在 `enhanposer` 页第二次点击行尾「去强化」，强化页**没有带上**该行的装备。
第一次点击正常。

### 31.2 根因（实测确认，非推断）

「去强化」是**写 store / 读 store** 的跨页契约：

```ts
// 写入侧（useLeaderboardPage.gotoEnhancer，11 个利润页共用）
useEnhancerStoreOutside().config.hrid = row.hrid
router.push({ name: "Enhancer" })

// 读取侧（pages/enhancer/index.vue）—— 缺陷所在
onMounted(() => {
  enhancerStore.hrid && onSelect(getItemDetailOf(enhancerStore.hrid))
})
```

**写入侧一直是对的**（实测两次点击后 `store.config.hrid` 均正确）。
问题在读取侧：**只在 `onMounted` 读一次**。
只要目标页实例被复用，`onMounted` 就不再执行 ⇒ 界面停在上一次的装备。

**关键实测（`vitest` + `vite` transformRequest）**：

| 环节 | 实测结果 |
| --- | --- |
| `pages/enhancer/index.vue` 编译后组件名 | `__name: "index"`（由**文件名** `index.vue` 推断） |
| `AppMain` 的 `keep-alive :include` 传的值 | **路由名** `"Enhancer"`（`tagsViewStore.cachedViews`） |
| 两者是否匹配 | **对不上** ⇒ 缓存是否命中取决于构建产物细节 |

也就是说「目标页会不会被复用」本身是**隐式且不可依赖**的行为 ——
即便当前构建恰好每次都重建，换个构建配置就会静默失效。
**结论：不能把「一定会重新挂载」当作前提。**

### 31.3 为什么之前的四层验证没抓到

§28 的验证逐字锁定了产物里的 `onMounted(...)` 那段代码，测试全绿却漏掉了这个缺陷：
**锁定「实现」在实现有缺陷时就是枷锁**。测试应锁「行为」——
「hrid 变化 ⇒ 选中跟随」，而不是「某段代码存在」。

### 31.4 修复

`pages/enhancer/index.vue` 与 `pages/enhancest/index.vue`（超级强化，同款缺陷）：

```ts
const carriedHrid = ref<string>()

function syncFromStore() {
  const hrid = enhancerStore.hrid
  if (hrid && hrid !== carriedHrid.value) {
    carriedHrid.value = hrid
    onSelect(getItemDetailOf(hrid))
  }
}

watch(() => enhancerStore.hrid, syncFromStore, { immediate: true })
onActivated(syncFromStore)
```

要点：
1. **`immediate: true`** 覆盖首次进入；**后续变化**覆盖组件被复用时的再次点击；
   **`onActivated`** 兜住 keep-alive 激活路径。三条路径都成立。
2. **`carriedHrid` 用来切断自激循环**：`onSelect` 内会执行
   `config.hrid = item.hrid`（第 145 行），若监听器无条件响应就会无限自我触发。
   只有「与当前显示不同」才重新选中。
3. 命名避开 `enhancer/index.vue` 中既有的局部变量 `selectedHrid`（保护符选中项，第 381 行），
   故新变量叫 `carriedHrid`（"带过来的 hrid"）。

### 31.5 测试

新增 `tests/goto-enhancer-carryover.test.ts`（**3 个用例**）：
1. **原缺陷点**：同一实例不卸载，外部连续改 hrid 两次都应跟随；静置后不自激
2. **只覆盖 hrid**：目标等级 / 件数 / 工时费等玩家预设必须保留（守住 §28.3 的设计）
3. **无效 hrid 不崩、不清空当前选择**（`onSelect` 的 `!item` 早退路径）

**反向验证**：`git stash` 回退源码后重跑 ⇒ **2 failed | 1 passed**，
失败信息正是 `expected '...advanced_foraging_charm' to be '...alchemists_bottoms'`
（第二次点击仍停在第一件装备）。**测试确实能抓住这个 bug，不是摆设。**

### 31.6 验证

`vue-tsc` **0 报错**；`vitest` **40 文件 / 353 用例全绿**（上轮 39/350，+1 文件 +3 用例）；
`vite build --mode private` 成功（12.71s）。

### 31.7 过程中的一次误判（记录下来）

最初怀疑是 keep-alive 缓存命中，于是写了「include 传路由名 vs 组件名」的探针，
**结论是「未命中」**，与用户现象矛盾。又写了「真实 `Enhanposer` 页 + 真实路由 + 真实点击」
的探针，**两次点击都正常**。

真正的定位靠的是**换提问方式**：不再问「为什么会复用」，而是问
「如果复用了会怎样」—— 一旦确认「复用在当前构建下不可依赖」，
就不需要复现出复用场景也能定位缺陷。
**探针用于验证假设，不能用于否定假设。**

---

## 三十二、chainbuilder（手动产业链）面向新手的重构（2026-10-07）

用户反馈：「我不太会用这个，对于一个初学者来说实在是摸不着头脑一头雾水。」

### 32.1 先量化问题（探针实测，不凭感觉）

| 项目 | 候选物品数 |  | 项目 | 候选物品数 |
| --- | --- | --- | --- | --- |
| 挤奶 | 7 | | 冲泡 | 70 |
| 伐木 | 7 | | 裁缝 | 143 |
| 烹饪 | 31 | | 制造 | 198 |
| | | | 锻造 | 205 |
| **转化** | **622** | | **分解** | **742** |
| **点金** | **889** | | | |

三个障碍：

1. **入口方向反了**。新手心智是「我想做这东西划算吗」，原界面逼他先答「我的原料是什么」。
2. **候选爆炸**。单个下拉最多 **889 项**。
3. **黑话无解释**。「内部流转」「衔接产物」「倍率」界面一个都没解释。

### 32.2 新增 API（`common/apis/chainbuilder`）

| 函数 | 作用 |
| --- | --- |
| `getChainMakersOf(hrid)` | **反查**「哪些项目能做出它」，候选通常 1~5 项 |
| `getChainIngredientsOf(hrid)` | 原料清单，每条附 `makers`（可继续上溯与否） |
| `getChainStepSummary(step)` | 环节白话摘要（消耗 → 产出 → 次数/小时） |
| `filterChainItems(items, q)` | **中文名 / 英文名 / hrid** 三路匹配 |
| `clearChainBuilderCache()` | 市场数据刷新后清缓存 |

实测性能：反查 100 个物品 **< 3s**（实测约 1.4s）。

### 32.3 原料清单的三重过滤（新手模式的生死线）

`getChainIngredientsOf` 必须排除三类噪声，否则新手会被误导：

| 排除项 | 判据 | 为什么 |
| --- | --- | --- |
| **茶** | `getActionConfigOf(action).tea` | 来自玩家「冲泡」面板勾选，**不是配方原料**。实测单次用量 0.008~0.023 份 |
| **金币** | `hrid === COIN_HRID` | 系统货币不是物料；且它没有上游，会被误判成「一级原料」，把新手引到「金币怎么获取」的死路 |
| **自产自用** | `ing.hrid === itemHrid` | 炼金转化会把自己列为原料。实测法师布的原料第一条就是「Magician's Cloth×0.85825」——它自己 |

⚠️ **茶不能按 `categoryHrid` 过滤**：实测茶的类目是 `/item_categories/drink`（与奶酒同大类），按类目会连正常饮品一起误杀。权威来源只能是 `getActionConfigOf`。

### 32.4 UI 改造：双模式

- **新手模式（默认）**：搜成品 → 系统反查「谁能做」 → 顺着原料一层层往前推，
  每层候选被**上一层产物**收敛到个位数，末尾可「自动补齐」。
- **进阶模式**：保留原正向逐环节编辑，老玩家不受束缚。
- 两种模式共享同一条 `calcChainProfitApi` 计算链与结果区。

实测闭环：`挤奶 Azure Milk → 锻造 Azure Cheese` ⇒ 利润 **666K/h**，链条顺序正确（头部原料、尾部成品）。

### 32.5 内置示例链 —— 教训最重的一处

**示例里的每个 hrid 必须真实可用**，否则用户点「计算」只会得到
「存在不可用的环节」，比没有示例更劝退。

早前第二例写成「裁缝斗篷 → 转化贤者之石 → **分解贤者之石**」，
实测 `DecomposeCalculator(philosophers_stone).available === false`
——**游戏里根本不能分解它**。已改为探针搜出的真实可用组合
「裁缝竹布 → 转化亚麻布 → 分解亚麻布」，并由
`tests/chainbuilder-newbie-api.test.ts` 三条用例锁死
（配方真实存在 / 能算出结果 / 衔接产物真在产出列表里）。

### 32.6 顺带修掉的历史缺陷

- `getChainStepSummary.timeCost` 原用 `getTrans("...{0}...", [...])`，
  但本文件拿不到 vue-i18n 运行时实例 ⇒ 占位符 `{0}` 原样显示。改为直接拼数值。
- 候选物品只有英文名，中文玩家打「奶酪」搜不到 ⇒ 加中文名 + hrid 三路匹配。

### 32.7 测试

新增 `tests/chainbuilder-newbie-api.test.ts`（**12 个用例**）：

- 反查存在性 / 不存在返回空 / 多物料可继续上溯 / 无效 hrid 不崩
- 三重过滤（茶、金币、自产自用）
- **倒推链顺序**（`unshift` 一直往头部插，误用「末尾」当当前层就会整条链反）
- 三路搜索（英文名 / hrid / 空串返回空而非全部）
- 示例链可用性 ×3

### 32.8 过程中踩的测试环境坑（勿重复踩）

1. **happy-dom 16 的 `MutationObserver` 与 element-plus `el-table` 不兼容**
   （`Cannot read private member #destroyed`）。mount 真实页面需在 setup 阶段
   （任何 mount / element-plus 导入之前）替换掉它。
2. **happy-dom 下 `el-radio-button` 点击不触发 `v-model`**（实测点 `__inner` 后
   `vm.mode` 不变）。这是环境问题**不是页面缺陷** ——
   `el-radio-button value=` 的用法与项目其他 5 处一致。
   验证模式切换应直接改 `vm.mode`，不要用点击。
3. 顶层 `import` chainbuilder 会让它的模块级 watch 先于 `loadTestGameData()` 执行 ⇒
   `Cannot read properties of null (reading 'actionDetailMap')`。必须动态 import。

### 32.9 验证

`vue-tsc` **0 报错**；`vitest` **41 文件 / 365 用例全绿**（上轮 40/361，+1 文件 +12 用例）；
`vite build --mode private` 成功（13.60s）；两个源文件行尾与 HEAD 一致（CRLF），无格式 churn。

---

## 三十三、chainbuilder 补「右收」与「产出命中率」（2026-10-07）

用户提了一个真实业务链：
> 我想做贤者之石碎片转化的生意，转化太阳石碎片获得贤者之石碎片，
> 太阳石碎片则通过**右收**或从太阳石制作过来。

### 33.1 用户纠正了我两次（都记下来）

1. **「市场收购环节类型就算了」** ——
   左买右卖/左买左卖/右买右卖/右买左卖在**利润排行里已经用烂了**，
   不该给 `ChainStep` 新造一个 kind。实测确认：`PriceStatusSelect` 被 **11 个页面**使用
   （dashboard / jungle / jungle×3 / enhanposer×2 / manualchemy / charmtransform / inherit / enhanceexp），
   chainbuilder 是**唯一漏挂的**。⇒ 不是缺功能，是漏挂轮子。
   挂上 `usePriceStatus("chainbuilder-price-status")` + `<PriceStatusSelect>` 即解决，
   `buyStatus = BID` 就是右收，底层由 `getPriceOf(hrid, level, buyStatus, sellStatus)` 统一处理。

2. **不要自己造轮子** —— 有现成的就该用（用户一贯原则）。

### 33.2 实测：他的每一步在游戏里都成立

| 步骤 | hrid | 实测 |
| --- | --- | --- |
| 转化太阳石碎片 → 贤者之石碎片 | `crushed_sunstone` → `crushed_philosophers_stone` | ✅ `dropRate = 0.005` |
| 贤者之石碎片 → 转化成品 | `crushed_philosophers_stone` | ✅ 可得月亮石碎片 0.25 / 太阳石碎片 0.25 / 星星碎片 0.25 / 镜之碎片 0.25 |
| 太阳石 → 制造 → 太阳石碎片 | `sunstone` → `crushed_sunstone` | ✅ 配方存在 |
| 太阳石碎片右收 | 市场 `ask=8400 bid=8200` | ✅（现由 PriceStatusSelect 表达） |

### 33.3 ★ 关键事实：他的转化命中率只有 **0.5%**

`transmuteDropTable` 里 `crushed_philosophers_stone` 的 `dropRate = 0.005`
⇒ **平均 200 次转化才出 1 个**，其余 99.5% 变成月亮石碎片 / 星星碎片 / 太阳石碎片。

而改造前的界面只写「产出：贤者之石碎片 ×1」—— 新手必然误以为稳赚。
这是本轮最该修的东西。

### 33.4 新增字段（`ChainStepSummary`）

```ts
successRate: number      // 拿到「指定产物」的期望概率（炼金取 dropRate；制造/采集恒 1）
targetShare: number      // 同值，语义更直白，供 UI 文案
targetPerHour: number    // 每小时期望产出个数 = actionsPerHour × successRate
actionsPerHour: number   // 每小时动作次数
```

⚠️ **不能用 `getTrans("...{0}...", [...])`**：本文件拿不到 vue-i18n 运行时实例，
占位符会原样显示（§32.6 已记过一次，这里再次确认）。

⚠️ **不能用 `resultList[].successRate` 当命中率**：那个字段是**动作成功率**
（炼金恒 50%、制造恒 100%），而用户真正要的是「多少次出 1 个我要的东西」（0.5%），
两者差 100 倍。UI 故把两列并排给出：`动作成功率` / `产出命中率`。

### 33.5 一个容易写错的断言：掉落率之和 ≠ 1

实测「全部产出 rate 之和 = **1.0948**」，而游戏 `transmuteDropTable` 四项之和恰为 **1.0**
（0.3 + 0.445 + 0.25 + 0.005）。

差值 **0.0948 = Alchemy Essence**：炼丹精华由 `getAlchemyEssenceDropTable`
按「时间 × 物品等级」**额外附赠**，不在掉落表内。

⇒ 断言必须写成「**掉落表项**之和为 1」，不能写「全部 rate 之和为 1」，否则假失败。
已由 `tests/chainbuilder-newbie-api.test.ts` 显式记录该事实。

### 33.6 UI 改动

- 买卖价选择器（挂在 `GameInfo` 下方，与其余 11 页同位置）
- 结果表新增两列：**动作成功率** / **产出命中率**（后者带 tooltip 说明「平均 N 次出 1 个」）
- 命中率分级染色：`≥1` 灰（确定）/ `≥0.5` 绿 / `≥0.05` 橙 / `<0.05` 红
- 炼金产出分布区块：「每 1000 次转化大约得到：月亮石碎片 ×300、太阳石碎片 ×445、
  星星碎片 ×250、贤者之石碎片 **×5**、……」

实测用户链路（转化太阳石碎片 → 转化贤者之石碎片 → 转化月亮石碎片）：
两环命中率 **0.005 / 0.25**，产出分布 2 条，页面可见 `0.5%` 与分布区块。

### 33.7 验证

`vue-tsc` **0 报错**；`vitest` **41 文件 / 368 用例全绿**（上轮 365，+3）；
`vite build --mode private` 成功（12.27s）；三个文件行尾与 HEAD 一致（CRLF），无 churn。
