---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 08e8c4f3f93cfbfc76cce2af531ed943_7feba7edaf5811f188ac525400dcc5b3
    ReservedCode1: 7757SlNQxJj9g0e06yT0VpprbL9uBAmNlvoDS6OOp89JKspx4MXic0R3ULvfrf+/BmK74UZSRHy+24hthNID7KPJ1Yopm/G8PpS68LIlA0X809d4tZdfrP8L3o1Qi+n+E5CSB02XYqnsnPl9mH1gh9D76g5W4GZ868ehCuxrTKqsEyyBkzMeo6YEkZU=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 08e8c4f3f93cfbfc76cce2af531ed943_7feba7edaf5811f188ac525400dcc5b3
    ReservedCode2: 7757SlNQxJj9g0e06yT0VpprbL9uBAmNlvoDS6OOp89JKspx4MXic0R3ULvfrf+/BmK74UZSRHy+24hthNID7KPJ1Yopm/G8PpS68LIlA0X809d4tZdfrP8L3o1Qi+n+E5CSB02XYqnsnPl9mH1gh9D76g5W4GZ868ehCuxrTKqsEyyBkzMeo6YEkZU=
---

# MewKonomy（Milkonomy）可复用抽象模块提炼与整合文档

> 定位：本文档在 `MILKONOMY_PROJECT_CONTEXT.md`（项目背景/运行说明）基础上，**聚焦抽象层提炼**，供二次开发直接对照复用。
> 范围：计算器体系、API 封装范式、Pinia store 与缓存、通用组件/组合式函数/工具函数、多语言与路由注册模式、端到端接入示例。
> 结论以 `D:\milkonomy\milkonomy-main` 源码实际结构为准。

---

## 1. 项目模块地图

### 1.1 顶层结构与定位

- 纯前端 Vue3 应用：**Vue3 + Vite6 + TypeScript + Pinia + Vue Router(hash) + Element Plus + UnoCSS + vue-i18n**，包管理 pnpm。
- 数据源：`public/data` 下的官方 JSON（game.json / market.json 等），无后端；所有"API"均为**本地只读数据访问层**，通过 `fetch` 拉 JSON 后注入 Pinia。
- 构建多模式：`.env.public`（公开版，构建时剔除私有路由）与 `.env.private`（私有版/自用版），`VITE_BUILD_MODE` 控制。
- 关键目录速查：

| 路径 | 职责 |
|---|---|
| `src/calculator` | **计算器抽象基类 + 各业务计算器**（扁平 .ts 文件，非子目录） |
| `src/common/apis` | **本地数据访问层（"API"）**：game 数据源、各聚合查询模块 |
| `src/common/composables` | 通用组合式函数（布局/主题/分页/水印等） |
| `src/common/components` | 通用组件（ItemIcon/价格状态/搜索菜单/主题切换等） |
| `src/common/utils` | 工具函数（format/game/css/datetime/validate + cache 封装） |
| `src/common/constants` | 常量（app-key / cache-key） |
| `src/common/config` | 默认配置（默认茶、默认装备、公告、冻结项） |
| `src/pinia/stores` | Pinia store：game（核心数据+缓存）/ price / player / favorite / enhancer / app / settings / permission / tags-view |
| `src/router` | 路由（hash 模式，public/private 拼接，guard 守卫） |
| `src/locales` | i18n（lang/ 语言包 + convert/ + index.ts 实例） |
| `src/layouts` | 布局（Sidebar/NavBar/AppMain/Settings 等 + modes/ 布局模式） |
| `src/pages` | 页面（按业务分组，与 private.ts 路由一一对应） |
| `src/plugins` | 插件入口（ElementPlus 等） |
| `types` | 全局类型（`~/game` 游戏数据结构、auto 自动生成 d.ts） |

### 1.2 Vite 路径别名（阅读源码必知）

`vite.config.ts` `resolve.alias`：

| 别名 | 指向 |
|---|---|
| `@` | `src` |
| `@@` | `src/common` |
| `~` | `types`（含 `~/game` 游戏数据全局类型） |

> 源码大量使用 `@@/utils/format`、`@/common/apis/game`、`~/game`，映射到上述目录，不要误判文件缺失。

### 1.3 核心数据流

```
public/data/*.json --fetch--> game store(gameData/marketData)
        │
        ▼
common/apis/game（只读访问层 + 只读缓存 + 兜底价格）
        │
        ▼
calculator/*（计算器：输入 item + 价格 + 玩家配置 -> result）
        │  WorkflowCalculator 聚合多阶段
        ▼
common/apis/<业务模块>（聚合计算 + handleXxx 筛选分页 + store 时间戳分桶缓存）
        │
        ▼
pages（列表页渲染 result 字段）
```

---

## 2. 抽象层 A：计算器体系（src/calculator）

### 2.1 抽象基类 `Calculator`（src/calculator/index.ts）

核心设计：**每个"利润方案"是一个 Calculator 实例**。子类只需声明"成本/产出/耗时/成功率"，基类统一折算为 `result`（时薪、利润率、风险等）。

**入参 `CalculatorConfig`**（关键字段）：

| 字段 | 说明 |
|---|---|
| `hrid` | 物品 id（如 `/items/xxx`） |
| `project` | 项目显示名（"锻造"/"转化"/…），用于分组/筛选 |
| `action` | 动作类型（`cooking`/`alchemy`/`enhancing`/`milking`…） |
| `item` | 可选，直接注入 ItemDetail（缺省按 hrid 解析） |
| `enhanceLevel` / `originLevel` | 强化相关等级 |
| `catalystRank` | 炼金催化剂 0=无 1=普通 2=主要 |
| `ingredientPriceConfigList` / `productPriceConfigList` | 价格覆盖配置 `{ hrid, immutable, price }`，用于 0 价流转/理想价 |

**基类提供的通用能力**（子类直接继承）：

- 属性：`item`（解析后的 ItemDetail）、`id`（uuid）、`key`（hrid 末段）、`name`、`project`、`action`、`isEquipment`。
- 通用指标 getter：`efficiency` / `speed`（效率与速度，含玩家等级/装备/茶加成）、`ingredientListWithPrice` / `productListWithPrice`（注入价格后的带价清单）、`cost` / `cost4Mat` / `income`、`actionsPH` / `consumePH` / `gainPH`、`valid`、`selfProduceStat`（自产统计）、`exp`、`successRate`、`rareRatio` / `essenceRatio`（稀有/精华掉落加成）。
- `handlePrice(list, …, side)`：**统一价格来源处理**——内部/手动/市场价三态合并（`immutable` 固定价、手动价优先、市场价兜底），是"价格覆盖"体系的核心入口。
- `run()`：执行计算，产出 `result`（`CalculatorResult`）。**先 `run()` 再读 `result`** 是调用方铁律（见 `handlePush`）。
- `result` 结构（`CalculatorResult`）：`hrid / name / project / successRate / costPH / consumePH / gainPH / incomePH / profitPH / profitRate / risk / selfProduceStat` + 格式化字段（`costPHFormat / incomePHFormat / profitPHFormat / profitPDFormat / profitRateFormat / efficiencyFormat / timeCostFormat / successRateFormat`）。

**子类必须实现**（抽象契约）：

```
timeCost        耗时（秒/次）
ingredientList  成本清单 Ingredient[]
productList     产出清单 Product[]
successRate     成功率
available       是否可用（缺数据/等级不满足时 false，调用方据此跳过）
actionLevel     动作要求等级
className       类名（用于实例重建，见 StorageCalculatorItem）
```

`Ingredient` / `Product` 结构：`{ hrid, count, marketPrice, level?, rate?, counterCount? }`（count 为单次数量，marketPrice 由 handlePrice 注入）。

### 2.2 子类家族

| 类（文件） | 业务 | 特点 |
|---|---|---|
| `GatherCalculator`（gather.ts） | 采集（挤奶/采摘/伐木） | `actionItem` 特例（彩虹牛奶→unicow），采集茶/加工茶补正（Gathering/Processing buff） |
| `ManufactureCalculator`（manufacture.ts） | 制造（锻造/制造/裁缝/烹饪/冲泡） | 升级链（upgradeItemHrid）多步、工匠茶抬升要求等级、双倍茶 Gourmet、精炼继承等级（`isRefined`）、非整数目标等级拆分产出 |
| `AlchemyCalculator`（alchemy.ts，抽象） | 炼金基类 | 固定 `action="alchemy"`，`catalystRatio` 催化剂+Success buff，`successRate = base×(1+等级差修正+催化剂)` |
| └ `TransmuteCalculator` | 转化 | `transmuteDropTable` 产出，`sameItemCounter` 自噬返回 |
| └ `DecomposeCalculator` | 分解 | 基础成功率 0.6，`enhanceLevel` 产出强化精华 |
| └ `CoinifyCalculator` | 点金 | 基础成功率 0.7，产出金币 |
| `EnhanceCalculator`（enhance.ts） | 强化+分解 | 见 2.3 |
| `WorkflowCalculator`（workflow.ts） | 多阶段聚合 | 见 2.4 |

`AlchemyCatalyst` 映射：rank1 = `catalyst_of_*`（按业务），rank2 = `prime_catalyst`。

### 2.3 `EnhanceCalculator`（强化+分解，含马尔科夫链）

- 入参 `EnhanceCalculatorConfig`：在基类基础上追加 `originLevel?`、`escapeLevel?`（默认 -1=不逃逸）、`protectLevel`（保护等级）、`productPriceType?`（成品计价源，默认 `"bid"`）、`materialPriceType?`（材料计价源，默认 `"ask"`）。
- 垫子自动选择：保护道具列表 + 镜子，取**单价最低者**。
- 核心 `enhancelate(): EnhancelateResult`：用 **mathjs 构造转移矩阵，`(I-P)^-1` 求期望**，返回 `{ actions, protects, targetRate, leapRate, escapeRate, exp }`；结果按 `(enhanceLevel, protectLevel, itemLevel, originLevel, escapeLevel)` 键走 **enhancelate 缓存**（game API 层）。
- `maxProfitApproximate`：以强化→分解全链近似利润作为可用性门槛（内部 new `DecomposeCalculator`）。
- `available`：有 enhancementCosts 且 `originLevel < enhanceLevel` 且 `escapeLevel < originLevel` 且 `protectLevel <= enhanceLevel`。
- 强化成功 buff：`getEnhanceSuccessRatio(item)`（等级差修正）+ Success buff；Blessed buff 决定跳跃率。

### 2.4 `WorkflowCalculator`（多阶段利润聚合器）

- 入参：`configs: StorageCalculatorItem[]`（各阶段配置）+ `project`（整链名，如"3步锻造-转化"）。
- 关键机制：通过 **`immutable` 价格配置**把中间环节产物设为 **0 价内部流转**（避免跨环节重复计税），末环卖出交一次税；`alignHrid` 指定对齐原料（综利用尾、炼金头），`alignProductHrid` 指定流向下一阶段的产物；`workMultiplier` 支持倍率（炼金头按产物对倍率）。
- 属性：`calculatorList`（各阶段实例）、`workMultiplier`、`available`（任一步不可用即 false）。

### 2.5 工厂与序列化（calculator/utils.ts）

```
CLASS_MAP                 Record<className, Calculator 子类构造器>
getCalculatorInstance(config: StorageCalculatorItem): Calculator   按 className 重建实例
getStorageCalculatorItem(cal): StorageCalculatorItem               { className, id, ...config } 序列化快照
```

**StorageCalculatorItem**（`src/pinia/stores/favorite.ts` 定义）：`extends CalculatorConfig` + `{ id, className?, alignHrid?, alignProductHrid? }`。它是"把任意计算器实例存入收藏/工作流/缓存"的统一可序列化形态，WorkflowCalculator / favorite / manualchemy 全链路复用。

### 2.6 新增计算器模板

```ts
import Calculator, { type CalculatorConfig, type Ingredient, type Product } from "."
export class MyCalculator extends Calculator {
  get className() { return "MyCalculator" }          // 必须：实例重建用
  constructor(config: CalculatorConfig) { super({ ...config, project: "我的项目", action: "myaction" }) }
  get actionLevel() { return this.item.itemLevel }    // 要求等级
  get available() { return !!this.item.someField }    // 可用性
  get timeCost() { return base / this.speed }         // 耗时
  get ingredientList(): Ingredient[] { return [{ hrid, count, marketPrice }] }
  get productList(): Product[] { return [{ hrid, count, marketPrice, rate }] }
}
// 之后：
// 1. 在 CLASS_MAP 注册 className
// 2. 聚合 API 用 new MyCalculator({hrid, ...}) + handlePush(list, cal) 入列
// 3. 价格覆盖/0 价流转复用 handlePrice 与 ingredientPriceConfigList/productPriceConfigList
```

---

## 3. 抽象层 B：API 封装范式（src/common/apis）

> 统一惯例：目录名 = 业务域，`index.ts` 导出 `getXxxDataApi(params)`（查/算）+ 私有 `calcXxx()` 全量计算 + 复用 `../utils.ts` 的筛选分页链 + store 时间戳缓存。函数名带 `Api` 后缀表示"页面直接调用入口"。

### 3.1 数据源与只读缓存（game/index.ts）

- `getGameDataApi(): GameData`：itemDetailMap / actionDetailMap / enhancementLevelSuccessRateTable / enhancementLevelTotalBonusMultiplierTable 等全量游戏数据。**模块级 watch 快照**：`watch(gameStore.gameData)` 重建只读副本，`structuredClone + Object.freeze` 防污染。
- `getMarketDataApi(): { marketData }`：市场行情，`marketData[hrid][level] = { ask, bid, price, volume }`。
- `getItemDetailOf(hrid)` / `getActionDetailOf(actionHrid)`：详情 **Map 缓存**。
- **`getPriceOf(hrid, level?)` 价格兜底体系（核心）**，返回 `{ ask, bid }`：
  - A：手动价（price store）→ B：市场价 → C：**大全套自产价**（原料可自产时按自产成本递归计价，避免市场无价/高价干扰）；
  - 特殊价：`SPECIAL_PRICE`（loot 开包价）、商店价（`sellPrice` 相关）、`priceStepOf`（分档价）；
  - `getPriceSourceOf(hrid, level)` / `isPriceFallbackOf(...)`：价格来源判定工具（UI 标记用）。
- 掉落表：`getAlchemyRareDropTable / getAlchemyEssenceDropTable / getAlchemyDecomposeEnhancingEssenceOutput / getEnhancingRareDropTable / getEnhancingEssenceDropTable / getProcessingProduct`。
- 时间/经验：`getEnhanceTimeCost / getTransmuteTimeCost / getDecomposeTimeCost / getCoinifyTimeCost / getEnhancementExp / getTransmuteExp / getDecomposeExp / getCoinifyExp`。
- **enhancelate 缓存**：`getEnhancelateCache(key) / setEnhancelateCache(key, result) / clearEnhancelateCache()`——马尔科夫强化期望结果的模块级 Map 缓存，玩家配置变更时清空。

### 3.2 价格手动覆盖 API（price/index.ts）

- `getManualPriceOf(hrid, level?)` / `hasManualPriceOf(...)` / `getManualPriceActivated()`：手动价读取。
- `getUsedPriceOf(hrid, level, side: "ask" | "bid"): number`：**返回实际生效价（手动优先），-1 表示无价**。计算器侧跳过无价方案的关键判据。
- 写：`setPriceApi(row)` / `setSinglePriceApi(...)` / `deletePriceApi(row)` / `getPriceDataApi()`。
- 数据在 price store（Map + localStorage），写入后**必须触发 `clearAllCaches()`**。

### 3.3 玩家/加成 API（player/index.ts）

- **性能快照范式**（本模块最有代表性的抽象）：模块级缓存 `playerConfig / defaultPlayerConfig / equipmentList / allEquipmentList / teaList / sealList / buffs`，`watch(gameData)` 与 `watch(playerStore.config)` 重建，避免每次 getter 遍历全量数据。
- 读取：`getActionConfigOf(action)`、`getToolListOf / getEquipmentList / getEquipmentListOf(action, type) / getSpecialEquipmentList(Of) / getSpecialEquipmentOf(type)`、`getCommunityBuffOf(type)`、`getSealsOf / getSealList`。
- 茶：`getTeaListOf(action)`、`getTeaIngredientList(cal)`（按消耗量折算茶成本，所有计算器共用）。
- **buff 中心**：`getBuffOf(action, key)`（装备+社区 buff+房子+茶+封印全量聚合）、`getDrinkConcentration()`、`getPlayerLevelOf(action)`、`getActionLevelBonusOf(action)`（工匠茶抬升要求等级）。
- 等级差修正：`getAlchemySuccessRatio(item)` / `getEnhanceSuccessRatio(item)`。
- 写：`setActionConfigApi(config, index)`（改后 commit 持久化）。

### 3.4 收藏 API（favorite/index.ts）

- `calcProfit(list: StorageCalculatorItem[])`：遍历收藏配置 → `getCalculatorInstance` 重建 → `run()` → 返回 Calculator[]（favorite 页复用列表渲染管线）。

### 3.5 各聚合查询模块（接口契约速查）

| 模块 | 入口函数 | 数据源 | 缓存（store 时间戳分桶） | 内部算法要点 |
|---|---|---|---|---|
| **game** | `getGameDataApi / getMarketDataApi / getPriceOf / getItemDetailOf / getActionDetailOf` | JSON | 模块级 Map + watch 快照 | 价格 A/B/C 兜底、大全套自产价递归、enhancelate 缓存 |
| **price** | `getPriceDataApi / setPriceApi / setSinglePriceApi / deletePriceApi / getUsedPriceOf / getManualPriceOf` | price store + localStorage | 写后 `clearAllCaches` | 手动价优先 |
| **player** | 见 3.3 | player store + watch 快照 | buff 模块级缓存 | 全量 buff 聚合 |
| **favorite** | `calcProfit(list)` | favorite store | — | 实例重建 + run |
| **leaderboard** | `getLeaderboardDataApi(params: RequestData)` | game | `leaderboardCache` | `calcProfit`（单步全物品×炼金3档+制造5项目+采集3项目）+ `calcAllFlowProfit`（多步升级链 Workflow）；favorite 标记 |
| **manualchemy** | `getLeaderboardDataApi(params)` | game | `manualchemyCache` | `calcAllFlowProfit`：制造链×炼金尾×采集炼金×**跨项目综利用尾**（`pushCrossProjectTail`）×**炼金头多样链**（`pushAlchemyHeadAll`，期望产出×成功率选头）×**大全套自产**（`pushBigSelfSufficient`）；`tailBest` 全局去重 |
| **chainbuilder** | `getChainProjectOptions / buildChainCalculator / getChainStepItemOptions / getChainAlchemyOutputOptions / calcChainProfitApi(steps, chainName)` | game | `itemOptionCache`（Map 懒生成） | 手动产业链：`ChainStep[]` 逐节点缀连 → `WorkflowCalculator` 自动 0 价流转 |
| **charmtransform** | `calcCharmTransformApi(catalystRank=0): CharmTierResult[]` | game + market | 无（纯函数） | 5 档冲泡护符（basic→grandmaster 固定倍数）实际/理想双口径：无流动性护符 实际=0 / 理想=精华自产成本 |
| **enhanposer** | `getEnhanposerDataApi(params)` | game | `enhanposerCache` | `calcEnhanceProfit({noDecompose, materialPriceType, productPriceType})`：逐级强化+分解 Workflow，per-level 取最优保护/催化剂 |
| **jungle** | `getDataApi(params, cacheKey="jungle")` | game | `jungleCache`（**按 cacheKey 分桶**） | 强化+制造多步 Workflow（charm 支持 7 步），`bestManufacture` 去重；筛选 maxLevel/minLevel/minSellPrice/maxSellPrice/minItemLevel |
| **marketvolume** | `getMarketVolumeList() / getMarketCategoryOptions(list) / getMarketVolumeSummary(list)` | market（`v` 成交量） | 无（纯聚合） | `updateMarketData` 已保留 volume → 聚合成条目 + 成交额 |

> `jungle/junglest`、`enhanposer`、`manualchemy`、`leaderboard`、`chainbuilder`、`charmtransform`、`marketvolume` 均以 **`src/common/apis/<域>/index.ts`** 为唯一出口，页面只 import 该目录。

### 3.6 通用查询管线（common/apis/utils.ts，最强复用件）

所有列表类 API 统一走这一套纯函数管线，输入/输出均为 `Calculator[]`：

| 函数 | 作用 |
|---|---|
| `handleSort(list, params)` | 先按 profitPH 降序，再按 params.sort 任意字段升降序 |
| `handlePage(list, params)` | `{ list: slice, total }` 分页 |
| `handlePush(list, cal)` | **入列守卫**：`available` 才 push，未 run 先 run |
| `handleSearch(list, params)` | 名称（支持多物品数组）、project、多行组合条件 `conditions`、`excludes` 反向排除、步数、利润率区间、风险区间、banEquipment/banJewelry/banCombat/banLife（装备分类派生） |
| `handleBestPerItem(list)` | 同 final 产物只保留时薪最高一条（多样产业链默认视图） |
| `handleCompare(list, params)` | 按物品分组标组内排名（比较模式） |

> 页面新增列表 = `calcXxx()` 产出全量 → 套 `handleSearch → handleSort → handlePage`（或 Compare/BestPerItem），**不要重写筛选逻辑**。

---

## 4. 抽象层 C：Pinia store 范式（src/pinia）

### 4.1 全局直连（脱离组件使用）

```ts
// store 底部统一导出
export function useGameStoreOutside() { return useGameStore(pinia) }
```
API 层与计算器**不依赖组件上下文**，通过 `useXxxStoreOutside()` 直取 store（`pinia` 实例在 `src/pinia/index.ts` 单例导出）。计算器侧严禁直接 new pinia。

### 4.2 timestamp 分桶缓存（game store，核心抽象）

> 全项目性能命脉：聚合计算（遍历全物品 × 多方案）耗时秒级，结果按"时间桶"缓存，仅当数据变更时清桶。

**结构**：state 中形如

```ts
// game store（src/pinia/stores/game.ts）
leaderboardCache: { [time: number]: Calculator[] } | null
enhanposerCache:  { [time: number]: Calculator[] } | null
manualchemyCache: { [time: number]: Calculator[] } | null
jungleCache:      Record<string, { [time: number]: Calculator[] }>   // 按 key 分桶
// 另：junglest / inherit / decomposeCache 等同构
```

**存取模式**（API 层统一写法，见 leaderboard/enhanposer/manualchemy/jungle）：

```ts
export async function getXxxDataApi(params) {
  let list = useGameStoreOutside().getXxxCache()      // 命中直接返回
  if (!list) {
    await delay(300)                                   // 防抖，避免首帧卡顿
    try { list = calcXxx() } catch (e) { console.error(e) }
    useGameStoreOutside().setXxxCache(list)            // 写入新桶（set 前自动清旧桶）
    ElMessage.success(t("计算完成，耗时{0}秒", [...]))
  }
  return handlePage(handleSort(handleSearch(list, params), params), params)
}
```

**store 内实现要点**：

- 每次 `set` 前先 `clear`（单桶场景只保留最新一份）；`jungle` 按 `cacheKey` 分多桶。
- **必须清空缓存的时机**（统一收敛在 `clearAllCaches()`）：价格写入/删除/切换手动价开关、玩家配置/预设切换、游戏数据重拉、`playerStore.setPresetIndex`（另调 `clearEnhancelateCache()`）。
- 价格模式（manual/实时）切换清缓存，保证计算口径一致。
- `updateMarketData` 保留 `volume` 字段（marketvolume 依赖）。

### 4.3 store 清单与职责

| Store | 文件 | 职责 / 关键字段 |
|---|---|---|
| **game** | game.ts（约 1.2 万行） | 核心：`gameData / marketData` 拉取、`COIN_HRID / PriceStatus / ACTION_LIST / EQUIPMENT_LIST / COMMUNITY_BUFF_LIST / HOUSE_MAP`、**全部时间戳分桶缓存与 clearAllCaches**、`checkSecret()` |
| **price** | price.ts | `map: Map<priceKey, StoragePriceItem>`、`activated`；`commit/setPrice/deletePrice/setActivated`；localStorage `price-list` / `price-activated`；`priceKeyOf(hrid, level)` |
| **player** | player.ts | `config: ActionConfig`、`presets`（≤5 预设）、`presetIndex`；`setActionConfig/switchTo/removePreset/setPresetIndex`；`defaultActionConfig`；类型 `ActionConfig/ActionConfigItem/PlayerEquipmentItem/CommunityBuffItem` |
| **favorite** | favorite.ts | `list: StorageCalculatorItem[]`；`addFavorite/deleteFavorite/hasFavorite/findFavorite`（id+catalystRank 判重）；localStorage `manual-list`；**StorageCalculatorItem 类型源头** |
| **enhancer** | enhancer.ts | 强化专用 store（强化页配置/缓存联动） |
| app / settings / permission / tags-view | 布局类 | 侧边栏/标签页/权限/设置，通用后台骨架，二次开发一般不改 |

---

## 5. 抽象层 D：通用组件 / 组合式函数 / 工具函数 / 常量

### 5.1 通用组件（src/common/components）

| 组件 | 复用场景 |
|---|---|
| `ItemIcon` | 物品图标（统一渲染 item hrid → 图标，全项目列表通用） |
| `PriceStatusSelect` | 价格状态选择（ask/bid/价格源） |
| `SearchMenu` | 列表搜索菜单（名称/项目/多条件组合） |
| `AnnouncementBanner` / `FreezeBanner` | 公告/冻结提示（config/announcement.ts、freeze.ts 驱动） |
| `Globalization` | 语言切换 |
| `Notify` | 通知封装 |
| `Screenfull` / `ThemeSwitch` | 全屏/主题切换 |
| `TombstoneCard` | 墓碑卡片（占位） |

### 5.2 组合式函数（src/common/composables）

`useDevice`（响应式设备）、`useFetchSelect`（下拉远程数据）、`useFullscreenLoading`、`useGreyAndColorWeakness`（灰度/色弱）、`useLayoutMode`、`useMemory`、`usePagination`、`usePriceStatus`（价格状态联动）、`useRouteListener`、`useTheme`、`useTitle`、`useWatermark`。布局侧另有 `src/layouts/composables/useResize`。

### 5.3 工具函数（src/common/utils）

| 文件 | 内容 |
|---|---|
| `format.ts` | 数字/金额/百分比/格式化（`@@/utils/format` 全项目复用，含 `percent` 等） |
| `game.ts` | 游戏数据派生工具：`getEquipmentClassOf / getEquipmentTypeOf / getKeyOf / isRefined` 等（装备分类用于 ban 筛选） |
| `css.ts` / `datetime.ts` / `validate.ts` | 样式/时间/校验 |
| `cache/local-storage.ts` | localStorage 封装（键值 + JSON + 失效） |
| `cache/cookies.ts` | cookie 封装 |

### 5.4 常量与默认配置

- `src/common/constants/cache-key.ts`：**布局缓存 Key 类**（如 sidebar 状态等，非业务缓存，业务缓存见 game store）。
- `src/common/constants/app-key.ts`：应用级 key。
- `src/common/config/index.ts`：`DEFAULT_TEA`（各动作默认茶）、`DEFAULT_SPECIAL_EQUIPMENT_LIST`、`DEFAULT_COMMUNITY_BUFF_LIST`。
- `src/common/config/announcement.ts` / `freeze.ts`：公告文案 / 冻结配置。

---

## 6. 抽象层 E：多语言与路由注册模式

### 6.1 i18n（src/locales）

- `locales/index.ts`：导出 i18n 实例（含 ElementPlus locale 同步）与 **`getTrans(key)`**——直接取当前语言的翻译文本（**性能优化**，计算器在渲染循环里高频调用，避免 `t()` 响应式开销；`getTrans` 返回纯字符串）。
- `locales/lang/`：各语言包（zh-CN 等）；`locales/convert/`：语言包转换脚本。
- 新增文案流程：在 `lang/<lang>.ts` 对应 key 下追加 → 页面 `t("key")` 或计算器 `getTrans("key")`。计算器中用 `t` 预生成 `tMap`（见 manualchemy）避免重复插值。

### 6.2 路由注册（src/router）

- **hash 模式**（适配 GitHub Pages 静态托管）；`config.ts`（基础配置）/ `guard.ts`（权限/标题守卫）/ `helper.ts`（菜单构建工具）/ `index.ts`（入口）。
- **public/private 拼接**：`routes/public.ts`（公开路由）+ `routes/private.ts`（私有/自用路由）。`index.ts` 中：

```ts
// PRIVATE_ROUTES_START
routes.push(...privateRoutes)
// PRIVATE_ROUTES_END
```

> 该注释标记是构建期剔除私有路由的锚点（`.env.public` 模式 `esbuild` 清理 console，另有 remove-private-code 插件方案），**新增路由时不得改动标记行**。

- **private.ts 路由项模板**（新增页面照抄）：

```ts
{
  path: "/xxx",
  name: "Xxx",
  component: () => import("@/pages/xxx/index.vue"),
  meta: { title: t("xxx"), icon: "xxx", activeMenu: "/xxx" }
}
```

- `meta.title` 用 `t()` 多语言；`meta` 还承载 icon/权限/keepAlive 等布局信息（由 Sidebar/Breadcrumb 消费）。

---

## 7. 二次开发接入示例

### 示例 A：新增"XX 盈利"页面（完整闭环，推荐最小改动路径）

1. **聚合 API**：`src/common/apis/xxx/index.ts`
   - `calcXxxProfit()`：遍历 `getGameDataApi().itemDetailMap`，`new <已有或新增>Calculator({...})` + `handlePush(list, cal)`；
   - `getXxxDataApi(params)`：套"防抖 → 缓存命中 → calc → setXxxCache → handleSearch/handleSort/handlePage"，并复用 `common/apis/utils.ts`；
   - game store 增加 `xxxCache` 桶 + 接入 `clearAllCaches`。
2. **页面**：`src/pages/xxx/index.vue`，复用 `ItemIcon`、`SearchMenu`、`handleXxx` 返回的 `{ list, total }` + Element Plus 表格渲染 `result` 字段。
3. **路由**：`src/router/routes/private.ts` 追加 `{ path, name, component, meta:{ title:t(...), icon } }`（在 `PRIVATE_ROUTES_START/END` 之间）。
4. **多语言**：`locales/lang/<lang>.ts` 追加页面标题与列头 key。
5. 复用既有 store 直连 `useXxxStoreOutside()`，不要新建全局状态除非确有跨页需要。

### 示例 B：新增计算器子类

见 2.6 模板。要点：实现 6 个抽象契约、`className` 注册进 `CLASS_MAP`（可序列化重建）、复用 `handlePrice` 与 `getPriceOf`/`getBuffOf`/`getTeaIngredientList`，成本产出走 `ingredientList/productList`，不要绕过基类直接算 result。

### 示例 C：新增带时间戳缓存的聚合 API

```ts
// game store
xxxCache: null as { [time: number]: Calculator[] } | null,
getXxxCache() { return this.xxxCache ? Object.values(this.xxxCache)[0] : undefined },
setXxxCache(list) { this.xxxCache = { [Date.now()]: list } },   // 写入前自动覆盖旧桶
clearXxxCache() { this.xxxCache = null },
// clearAllCaches() 中追加 this.clearXxxCache()

// api
export async function getXxxDataApi(params: any) {
  let list = useGameStoreOutside().getXxxCache()
  if (!list) {
    await new Promise(r => setTimeout(r, 300))
    try { list = calcXxx() } catch (e) { console.error(e) }
    useGameStoreOutside().setXxxCache(list)
    ElMessage.success(t("计算完成，耗时{0}秒", [(Date.now() - start) / 1000]))
  }
  return handlePage(handleSort(handleSearch(list, params), params), params)
}
```

---

## 8. 复用清单速查表

| 抽象层 | 关键文件 | 复用要点 |
|---|---|---|
| 计算器基类 | `src/calculator/index.ts` | `CalculatorConfig` / 6 个抽象契约 / `handlePrice` / `run()`→`result` |
| 计算器子类 | `alchemy.ts` / `gather.ts` / `manufacture.ts` / `enhance.ts` | 各自业务模板；Enhance 马尔科夫链可复用 |
| 多阶段聚合 | `src/calculator/workflow.ts` | 0 价流转 / alignHrid / alignProductHrid / workMultiplier |
| 实例工厂 | `src/calculator/utils.ts` | `CLASS_MAP` / `getCalculatorInstance` / `getStorageCalculatorItem` |
| 数据源与价格 | `src/common/apis/game` | `getPriceOf` 三态兜底 / 大全套自产价 / drop 表 / enhancelate 缓存 |
| 查询管线 | `src/common/apis/utils.ts` | `handleSearch/Sort/Page/Push/BestPerItem/Compare` |
| 玩家 buff | `src/common/apis/player` | watch 快照 + `getBuffOf` 全量聚合 |
| 手动价 | `src/common/apis/price` + price store | `getUsedPriceOf` / 写后清缓存 |
| 聚合查询 | leaderboard / manualchemy / chainbuilder / charmtransform / enhanposer / jungle / marketvolume / favorite | 接口见 3.5 表 |
| store 缓存 | `src/pinia/stores/game.ts` | timestamp 分桶 + `clearAllCaches` + `useXxxStoreOutside` |
| 全局直连 | `src/pinia/index.ts` + 各 store 底部 | 无组件上下文取 store |
| 通用组件 | `src/common/components/*` | ItemIcon / SearchMenu / PriceStatusSelect 等 |
| 组合式函数 | `src/common/composables/*` | usePagination / useTheme / useDevice 等 |
| 工具函数 | `src/common/utils/*` | format / game / cache 封装 |
| 多语言 | `src/locales` | `getTrans(key)` 高性能取词 |
| 路由 | `src/router` | hash 模式 / public+private 注释拼接 / `t()` 标题 / meta |

---

## 9. 二次开发总则（本项目心法）

1. **不重造计算逻辑**：一切利润数字走 `Calculator` 家族，价格取 `getPriceOf/getUsedPriceOf`，加成取 `getBuffOf`，新方案 = 新 Calculator 或 WorkflowCalculator 组合。
2. **新页面四件套**：`common/apis/<域>/index.ts`（聚合+缓存）+ `pages/<域>`（列表渲染）+ `router/routes/private.ts` 注册 + `locales` 补 key。
3. **缓存纪律**：任何会影响价格/玩家配置/游戏数据的写入动作，末尾必须 `useGameStoreOutside().clearAllCaches()`（必要时加 `clearEnhancelateCache()`）。
4. **可序列化**：凡需收藏/工作流/缓存的方案，统一转 `StorageCalculatorItem`（含 `className`），重建走 `getCalculatorInstance`。
5. **只读数据防污染**：对外暴露的 game/market/player 数据一律 `structuredClone + freeze` 快照，计算器只读不写。
*（内容由AI生成，仅供参考）*
