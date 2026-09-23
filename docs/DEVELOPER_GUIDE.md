---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 08e8c4f3f93cfbfc76cce2af531ed943_4b2344d0af6511f18874525400287e28
    ReservedCode1: 6N6vTtAPkQU4Lls/wdwDWHDFHzt6e5aRzbl6Qir/2N+xPuP5YEL/6PM/ZG4487IkQPnAAWCYzN1m0AoAhYNV0ALjSdO2/syGM3eB7F16btGAicxcpGu3Otwd3zUpZw3R3N6LNphQwFAJv2dDw3rSWRmj61y+LPugQ9I18Ywo3hseZE742RVnnSRtQQk=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 08e8c4f3f93cfbfc76cce2af531ed943_4b2344d0af6511f18874525400287e28
    ReservedCode2: 6N6vTtAPkQU4Lls/wdwDWHDFHzt6e5aRzbl6Qir/2N+xPuP5YEL/6PM/ZG4487IkQPnAAWCYzN1m0AoAhYNV0ALjSdO2/syGM3eB7F16btGAicxcpGu3Otwd3zUpZw3R3N6LNphQwFAJv2dDw3rSWRmj61y+LPugQ9I18Ywo3hseZE742RVnnSRtQQk=
---

# MewKonomy 开发说明书（面向开发者）

> 本文面向**开发者**，讲清楚项目的架构、各模块的开发规范、测试、构建与部署流程。
> 内容侧重「开发流程与规范」；「可复用抽象模块」的提炼见
> [REUSABLE_ABSTRACTION_MODULES.md](./REUSABLE_ABSTRACTION_MODULES.md)，两文呼应、不重复。
> 项目背景与历次改动细节见 [MILKONOMY_PROJECT_CONTEXT.md](./MILKONOMY_PROJECT_CONTEXT.md)。

---

## 一、架构总览

### 1.1 定位与技术栈

- **定位**：Milky Way Idle 玩家自用利润计算工具，**纯前端 SPA，无后端、无账号**。
- **技术栈**：Vue 3.5 + Vite 6 + TypeScript 5.7 + Element Plus 2.9 + Pinia + vue-i18n + vitest + happy-dom。
- **路由**：hash 模式（兼容子路径部署）；`src/router/config.ts` 的 `history` 由构建模式决定。

### 1.2 数据流

```
public/data/data.json ─┐
                       ├─→ Pinia store（game/player/price/enhancer...）
public/data/market.json┘         │ 缓存：localStorage，按 timestamp + 计算模式分桶
                                 ▼
   src/common/apis/*（各域聚合 API：game/price/player/favorite/...）
                                 ▼
   src/calculator/*（纯计算逻辑，Calculator 子类 + WorkflowCalculator 聚合）
                                 ▼
   src/pages/*（页面四件套：页面 / components / api / types）
```

- **数据源**：`data.json`（静态游戏数据，**严禁改动**，含硬上限）+ `market.json`（市场快照 `{market:{名称:{ask,bid,vendor}}, time}`）。
- **价格语义**：`PriceStatus.ASK`=左挂单（ask），`BID`=右收购（bid）。全局规则——**材料/成本用 ask，成品/收益用 bid**（个别页面可切换成品计价口径）。
- **市场历史归档**：`data/market_history.json`（由 GitHub Actions 每小时采样、滚动 7 天）供市场监控页计算涨跌，详见 §4.1；页面另有 localStorage 本地兜底采样。

### 1.3 Vite 别名

| 别名 | 指向 |
| --- | --- |
| `@` | `src` |
| `@@` | `src/common` |
| `~` | `src/types`（游戏数据 TS 类型，如 `~/game`） |

### 1.4 构建多模式

由 `VITE_BUILD_MODE` 控制（`public` / `private` / `staging`），**仅**影响 title、`VITE_PUBLIC_PATH`、是否移除 console。

| 命令 | 模式 | 用途 |
| --- | --- | --- |
| `pnpm dev` | private | 本地开发，完整页面 |
| `pnpm dev:public` | public | 本地预览公开版 |
| `pnpm build` / `build:public` | public | 产出部署包（`VITE_PUBLIC_PATH=/mewkonomy/`） |
| `pnpm build:private` | private | 产出私有包 |

> 注意：**非安全隔离**——路由与页面始终全部打包，私有页靠侧边栏权限 + freeze 守卫控制可见性；`checkSecret()` 已恒返回 `true`，私有页无密钥校验。

---

## 二、模块开发规范

### 2.1 页面「四件套」

新增一个独立功能页，按既有模式小批量落地，保持风格统一：

1. **API 聚合**：`src/common/apis/<feature>/index.ts`（如 `manualchemy`、`chainbuilder`、`charmtransform`、`marketvolume`、`enhanposer`）。只做「取数 + 组织 + 调用计算器」，返回纯数据。
2. **页面**：`src/pages/<feature>/index.vue`（复杂场景可再拆子组件，如 `enhanposer` 的 `enhanposest.vue`）。
3. **组件**：可复用的检索/展示片段放 `src/pages/<feature>/components/` 或 `src/common/components/`。
4. **类型**：`src/types/<feature>.ts`（游戏数据相关）或就近在 `src/common/apis/<feature>/` 内定义局部类型。

参考既有模板：`chainbuilder` / `manualchemy` 页结构最典型。

### 2.2 计算器子类

- 计算逻辑放 `src/calculator/*.ts`（**扁平文件，非子目录**），继承 `Calculator` 基类；多阶段用 `WorkflowCalculator` 聚合。
- 序列化用 `CLASS_MAP`（便于跨模块恢复实例类型）。
- 新增计算参数（如价格口径、模式开关）时，遵循既有约定：新增字段给默认值以保持旧行为。
- **价格硬规则**：基类 `ingredientListWithPrice` 固定 `ask`，`productListWithPrice` 固定 `bid`。如 `EnhanceCalculator.productPriceType` 这类「局部覆盖成品计价」的扩展，**不会**影响基类 `productListWithPrice`（多阶段详情弹窗仍走 bid）——改造前需明确边界。

### 2.3 API 聚合

- 各域在 `src/common/apis/<domain>/index.ts` 聚合，页面只 import 该入口。
- `src/common/apis/utils.ts` 提供通用检索 `handleSearch`（支持 `banEquipment` / `banJewelry` / `banCombat` / `banLife`、`conditions` 组合条件、等级/利润率/风险双头、`steps` 精确步数等）。
- 检索类 API 使用 `usePagination` 组合式做分页，页码/大小状态可持久化到 localStorage。
- **页面级辅助模块可内聚在域目录下**：如 `marketvolume/history.ts` 维护「市场历史采样」——`MarketPriceSample`（`{t, p:{hrid:{level:[ask,bid,volume]}}}`；**旧样本只有 `[ask,price]` 两个元素，两种长度都要兼容**，取值必须走内部 `valueAt()` / `priceOf()`，不要直接下标）、`recordLocalSample`（localStorage 兜底，节流 30min、上限 200 条、7 天滚动窗口）、`loadMarketHistory`（拉取服务端归档 `gh-pages:data/market_history.json`，页面按 `<BASE_URL>data/market_history.json` 请求）、`getMarketChangeMap(list, windowHours, metric, now)`（基准 = 时间窗起点前最近采样，key=`hrid|level`，无基准 / 当前值无效时该项不出现）。`metric` 可选 `price`（ask/bid **中点**）/`ask`/`bid`/`volume`；`volume` 是官方**当日累计成交量**（UTC 0 点归零），比的是**增量速率**而非绝对值。

  **市场历史模块的硬约束（都踩过坑，改动前先读）**：

  1. **时间基准统一为「快照时间戳」**：`t` 一律取 `defaultNow()`（= 官方 `marketData.timestamp`，取不到才回落墙钟）。早期 `recordLocalSample` 写墙钟，导致同一份快照在本地样本与线上归档里是两个时刻，增量区间的分母直接失真；**「成交量/小时」的分母也不能用 `Date.now()`**，否则页面开着不动数字自己往下漂。
  2. **同一 `t` 只保留一条**：`recordLocalSample` 在写入前比对上一条（相同则返回 `false`，`force` 也不例外，这样「立即采样」能诚实提示「已是最新」）；`getMarketHistory()` 合并归档与本地时再按 `t` 去重一次（本地优先）。重复点会让「上一点」变成同一时刻，把区间分母算成 0。
  3. **`getMarketHistory()` 结果带缓存**（页面每行都要算速率，原实现每次重建 Map + 排序是 O(n log n)）。样本只在 `recordLocalSample` / `loadMarketHistory` 变化，**新增写入点必须同步置空 `mergedCache`**，否则页面读到旧历史。

  跨 UTC 归零点判断统一走 `volumeDeltaBetween(startT, startVol, endT, endVol)`：**同日**取真实增量（为负判无效），**跨日**只能用 `endVol`（自今日 0 点起的累计）并把计时起点改到 0 点；直接把昨天的累计当今天增量会算出虚高速率。UI 侧 `getVolumeRateDetail` 额外返回实际区间小时数与是否跨日，用于在采样稀疏时提示「这个速率不是按你选的时间窗算的」。

  4. **成交量展示用「时间窗内滚动成交量」，不是官方当日累计量**：官方 `v` 每天 UTC 0 点归零，直接展示会让刚过零点的所有物品都变成小数字、跨时刻不可比。`getRollingVolumeDetail(item, windowHours, now)` 在自有归档上把相邻采样点的增量滚动累加，返回 `{volume, hours, knownHours, coverage, crossings}`；`hours` 是**实际**统计区间（列头用的就是它，而不是所选窗口），`coverage < 1` 表示跨了归零点、0 点前那段无法还原（页面用 `el-alert` 提示）。价格涨跌**不**走这条路径（必须严格按窗口取基准），`findVolumeAnchor` 只服务成交量类指标。

  **采样频率的真相（决定了上面的精度上限）**：官方 `marketplace.json` 每 60s 轮询一次（`main.ts`），而官方快照是**整点小时粒度**；GitHub Actions 的 `schedule` 是 best-effort 的 —— 本仓库实测声明 60min、实际相邻间隔 143~466min（中位 307，全部 success，是触发器被延迟而不是脚本失败）。所以**每小时采样只能靠浏览器**：`startMarketAutoSampling()`（在 `main.ts` 调用一次）监听 `marketData.timestamp` 变化，快照一前进就落一个本地采样点，不受 Actions 延迟影响。本地上限 200 条 ≥ 7 天 × 24 点 = 168，够用。

  **市场档位 `level` 是强化等级，不是物品等级**：官方结构是 `marketData[hrid][level]`，`level ∈ 0..20` 表示 +N（比如 `/items/holy_chisel` 有 0/2/3/4/5/6/7/8/10/11/12 共 11 档），而 `itemLevel` 是物品自身的推荐等级（神圣凿子恒为 80）。同一件装备每个有报价的档位都是列表里的**独立一行**，显示后缀一律走 `enhanceLevelSuffix(level)`（`+N`，0 级为空）—— 曾经有一处错写成 `Lv{{ itemLevel }}`，导致 11 个档位全部渲染成同一个「神圣凿子 Lv80」，无法区分。

### 2.4 Pinia store 与 timestamp 缓存（重点）

- 数据 store（`game` 等）负责拉取 `data.json` / `market.json`，并做 **localStorage 缓存**。
- **缓存按 `marketData.timestamp`（市场快照时间戳）+ 计算模式分桶**，不是简单列表缓存。新增/变更计算模式参数（如 `noDecompose`、`priceType`、`banCombat`）后，**必须调用对应 `clearXxxCache()` 再重算**，否则读到旧结果。
- `clearAllCaches()` 在 `fetchData`/`tryFetchData` 中集中调用；`useXxxStoreOutside` 可在组件外全局直连 store（如 `marketvolume` 页响应式依赖 `gameStore.marketData` 自动重算）。
- **入口挂载门控与失败回退**：`main.ts` 需等 `tryFetchData().then(router.isReady)` 才 `mount`，外部数据源不可达会阻塞主界面。`tryFetchData` 用 **`success` 标志**判定整体是否成功（**勿用 `retryCount===0` 判断——循环后恒为 -1，是死代码**）；全部重试失败时，若本地缓存（`gameData` + `marketData`）已存在则**回退使用缓存**，仅完全无数据才抛「强制宕机」。`fetchData` 内的 `Promise.all` 请求带 **15s `AbortController` 超时**，避免网络挂起时一直阻塞挂载。
- 缓存结构变更需做**旧缓存兼容**：`marketvolume-cache.test.ts` 即验证「旧结构（无 `volume`）被判过期清除，新结构（含 `volume`）保留」。

### 2.5 多语言 key

- 文案 key 在 `src/locales/lang/zh-cn.ts`（中文 key 即显示文本）与 `src/locales/lang/en.ts`。
- **新增/修改文案必须同时维护两个语言文件**（en 新增 key 不能缺）。页面里用 `t(key)` 取文案。

### 2.6 路由注册

- 私有页在 `src/router/routes/private.ts` 注册；公开页在 `public.ts` 注册。
- `private.ts` 中 `PRIVATE_ROUTES_START` / `PRIVATE_ROUTES_END` 注释供 Vite 插件识别，**新页面加在这两个注释之间**。
- 路由 meta 需给 `title`（用于侧边栏与面包屑）、`svgIcon`/`elIcon`。

### 2.7 玩家配置与 buff

- 玩家配置集中在 `src/pages/dashboard/components/`（GameInfo / ActionConfig / ActionDetail / ActionPrice / ManualPriceCard / SinglePrice 等），各计算页通过引入这些组件复用全局配置。
- buff 逻辑在 `src/common/apis/player/index.ts` 的 `initBuffMap` / `getActionLevelBonusOf`：如工匠茶（`/buff_types/action_level`）给对应行动等级 **+5**（计算时 `actionLevel = levelRequirement.level + bonus`）。

### 2.8 通用「多变搜索」面板（SearchPanel，重点）

**背景**：11 个检索页原先各自手写一份搜索表单，实测重复度极高（Jaccard 相似度）——
`jungle` / `decompose` / `inherit` / `junglest` 系列两两 **91%~100%**，
`dashboard` ↔ `manualchemy` **94%**，`enhanposer` ↔ `enhanposest` **100%**；
其中 12 个字段（`name`/`conditions`/`banEquipment`/`minProfitRate`/`maxProfitRate`/
`banJewelry`/`banCombat`/`banLife`/`maxRisk`/`minLevel`/`maxLevel`/`excludes`）
在 9~11 个页面反复出现。另有「旧数据迁移」样板在 10 个页面逐字重复。
因此把这套东西收敛成**配置驱动**的复用模块。

**两个复用单元**：
- `src/common/components/SearchPanel/index.vue` + `types.ts` —— 由 `fields: PanelField[]` 配置驱动渲染。
  支持 7 种字段（各字段的差异都只是「标签文案 + 取值范围 + 是否显示 + 可选项」）：

  | type | 说明 | 关键配置 |
  | --- | --- | --- |
  | `name` | 物品名多选（可自由输入） | `width`、`placeholder` |
  | `conditions` | 可增删的「步数/等级 + 动作」行 | `stepsCount`、`stepLabel`、`projectOptions`、`levelRange`、`hint`、`minRows` |
  | `excludes` | 可增删的「产品名 + 生产动作」行 | `namePlaceholder`、`projectPlaceholder`、`projectOptions` |
  | `range` | 数值区间（双头或单头） | `minKey`/`maxKey`、`unit`、`separator`、`min`/`max`、`placeholder*`、`width` |
  | `checkbox` | 复选开关 | `key`、`disabled`、`onChange`（额外回调） |
  | `select` | 下拉 | `key`、`options`、`width` |
  | `sort` | 排序优先级编辑器 | `key`、`fields`、`defaultProp` |

- `src/common/composables/useSearchPanel.ts` 的 `normalizeSearchData()` ——
  统一的**旧结构迁移**（`name` 字符串转数组、`conditions`/`excludes` 补数组、
  `profitRate` → `minProfitRate`、清理已废弃的 `project`/`profitRate`/`steps`）。

**使用方式**（照抄即可）：
```ts
import SearchPanel from "@@/components/SearchPanel/index.vue"
import type { PanelField } from "@@/components/SearchPanel/types"
import { normalizeSearchData } from "@@/composables/useSearchPanel"

const ldSearchData = useMemory("xxx-leaderboard-search-data", { /* 默认值 */ })
normalizeSearchData(ldSearchData.value)

const projectOptions = [/* 该页可用的动作 */]
const panelFields: PanelField[] = [ /* 声明字段 */ ]
```
```vue
<SearchPanel v-model="ldSearchData" :fields="panelFields" title="利润排行" @change="handleSearchLD" />
```

**两个必须注意的点**：
1. **标签不要写成 `` `${t("风险")} ≤` ``**。`t()` 会在 `setup` 阶段求值一次，切换语言时不会更新。
   带符号的标签请用 `label: "风险"` + `labelSuffix: " ≤"`（或 `labelPrefix`），
   由组件在模板里拼接，才能保持响应式。`conditions.stepLabel` 是函数，不受此限。
2. **面板不改动数据结构**，只负责增删 `conditions`/`excludes` 行并写各字段值；
   取值的 `min`/`max` 边界由配置给出，其余一律透传。所有交互统一 `emit("change")`，
   页面照旧调自己的 `handleSearchLD`。
3. `.rank-card` 布局样式已收敛到 `SearchPanel` 内部（非 scoped）。页面**不要再**自己定义
   同名样式——页面级 scoped 样式也作用不到组件内部。

**迁移进度**：**11 个检索页已全部迁移**——`decompose` / `junglest` / `junglest-inherit` / `inherit` /
`jungle-pickout` / `manualchemy` / `enhanceexp` / `jungle` / `enhanposer` / `enhanposest` / `dashboard`（含主排行与收藏夹两个表单）。

**唯一未迁移的是 `pages/dashboard/components/ManualPriceCard.vue`**，这是有意的：它只有 2 个控件
（一个绑定 price store 的 `<el-switch>` + 一个**单字符串**的物品名输入），既不是多变检索表单，
也复用了 `name` 的单值语义。为它加一个 switch 字段类型 + 单字符串 name 变体，改动量大于它自身那 9 行，不划算。

**迁移时务必逐控件核对**（复选框含 `disabled` 与各自的 handler、区间字段、条件首列文案、价格口径下拉），
只比 `:label` 会漏掉类似 `junglest/inherit` 的 `noEscape` 复选框 —— 本次就漏过一次。

**行尾注意**：批量脚本改写 `.vue` 时容易把 LF 文件写成 CRLF，导致整文件进 diff。
改完用 `git diff --stat` 自查，必要时按基线行尾归一。

### 2.9 通用分页脚（PagerFooter）

同样由重复度调查发现：**12 个页面的分页块逐字相同**，且 `.pager-wrapper` 样式各自写了一份
（12 处写法完全一致）。已收敛为 `src/common/components/PagerFooter/index.vue`，配合 `usePagination()` 使用：

```vue
<template #footer>
  <PagerFooter
    :pagination="paginationDataLD"
    @size-change="handleSizeChangeLD"
    @current-change="handleCurrentChangeLD"
  />
</template>
```

- 共替换 13 处分页块（`dashboard` 有两个列表）、删除 12 处重复样式，净减约 138 行。
- `.pager-wrapper` 样式随组件走（非 scoped），页面**不要再**自行定义。
- `pages/marketvolume/index.vue` 仍直接使用 `<el-pagination>`：它自带独立的摘要区与
  「只看有成交」开关，分页块并非同一形态，未强行统一。

---

## 三、测试

- 框架：**vitest + happy-dom**（`pnpm test`）。测试文件在 `tests/` 下。
- **Mock 策略**：用 `vi` 控制模块（`vi.resetModules()` + 动态 `import` 重新加载 store / 模块，见 `marketvolume-cache.test.ts`、`marketvolume-history.test.ts`）；纯计算逻辑（calculator）可直接断言数值；涉及 localStorage 的用例先 `localStorage.clear()`。
- 既有测试清单（`tests/`）：
  - `bigset-c-verify`（大批量组合检索校验）
  - `chainbuilder-verify`（手动产业链计算）
  - `charmtransform-verify`（护符转化盈利）
  - `cross-project-tail-verify`（及 `extended`，跨项目尾段校验）
  - `handle-best-per-item`（每物品最优方案）
  - `marketvolume-cache` / `marketvolume-verify`（市场监控缓存兼容与结果）
  - `marketvolume-history`（涨跌历史：本地采样节流/强制、无历史空 map、时间窗涨跌百分比、基准/当前价缺失过滤；4 用例 `vi.resetModules` 重建模块隔离）
  - `demo`、`components/Notify`、`utils/validate`
- **改动涉及缓存/价格/过滤逻辑时，建议补充对应 verify 测试**，与既有命名风格保持一致。

---

## 四、构建与部署

- **类型检查**：所有改动需通过 `npx vue-tsc --noEmit`（构建脚本 `build:private` = `vue-tsc && vite build`）。
- **本地预览**：`pnpm dev`（private 完整版）或 `pnpm dev:public`（public 版）。
- **部署脚本**（项目自带，用于 GitHub Pages）：
  - `deploy.ps1`（全量）：`pnpm build:public` → 提交 main（`--no-verify` 跳过 husky）→ `npx gh-pages -d dist` 推 `gh-pages`。内置网络通道探测与回退（Steam++ 443 / 直连 / 本地代理），并用临时 git 配置覆盖全局失效代理、`sslVerify` 按通道设置、凭据 `wincred`。
  - `sync-fast.ps1`（免编译增量）：仅当**只改 `public/` 静态文件**时使用，按哈希增量复制到 `dist` 后推 gh-pages；若检测到 `src/`、`vite.config.ts` 等有变更会警告改用全量部署。
- 上述两个脚本负责**站点产物**；`gh-pages:data/` 下的数据另由 GitHub Actions 维护（见 4.1）。

### 4.1 线上数据流水线（GitHub Actions）

两条 workflow **刻意解耦**，各自只依赖自己的数据源，任一源故障不会连带拖停另一条：

| workflow | 频率 | 脚本 | 职责与产出 |
| --- | --- | --- | --- |
| `market-history.yml`（Market History Sampling） | 每小时第 5 分钟（`cron: "5 * * * *"`）+ 手动 `workflow_dispatch`；`concurrency: market-history-sampling` 保证不并发 | `scripts/sample_market_history.py` | 抓官方 `https://www.milkywayidle.com/game_data/marketplace.json`（约 0.4s、极稳定），追加采样点到 `gh-pages:data/market_history.json`；滚动 7 天、上限 520 点 |
| `update-data.yml`（Update Game Data） | 每天 UTC 00:20（`cron: "20 0 * * *"`）+ 手动 `workflow_dispatch` | `scripts/fetch_game_data.py` | 抓上游 `data.json` / `market.json`，只负责这两个文件 |

- **为什么拆开**：历史采样与游戏数据抓取原先共用一个 job，`data.json` 上游一挂，历史采样一起停摆——线上曾因此**连续 8 天没有任何新采样点**。
- **为什么游戏数据改为每天一次**：游戏数据只在游戏版本更新时变化，原先每小时跑一次纯属浪费 Actions 配额。
- **官方快照实际是 1 小时粒度（实测）**：`marketplace.json` 顶层 `timestamp` 代表**市场快照本身的生成时间**，实测它以**整点、每小时**为粒度前进（例如 07:06:00 → 08:06:00），而不是每 20 分钟。因此：
  - 因此稳定产出约 **24 个采样点/天**；更频繁的运行会因时间戳相同被去重跳过（属预期行为，不是故障）。cron 仍取每小时第 5 分钟并保留手动触发，作为对 GitHub 调度延迟（实测 2~4 倍）的容错；
  - 7 天窗口下约 168 点，远低于 520 的上限，所以上限目前不会触发；
  - 这意味着「涨跌」基准点的最细分辨率是 1 小时：**1 小时时间窗常常找不到更早的基准点而显示 `--`**，属正常现象；3 小时及以上的窗口才有稳定意义。
- **部署安全红线（必读）**：`gh-pages` 的 `data/` 是**多脚本共享目录**——`sample_market_history.py` **只拥有** `market_history.json`，`fetch_game_data.py` **只拥有** `data.json` / `market.json`。两脚本都只把自己的文件复制进 `gh-pages` 的全新克隆再提交，**绝不允许 `rmtree` + `copytree` 整个 `data/`**：早期采样脚本用 `public/data` 整目录替换线上目录，而 `main` 的 `public/data` 不含新抓的 `data.json`/`market.json`，导致**每次采样都会删掉线上 4MB 的 `data.json` 与 70KB 的 `market.json`**（commit `93f0107`）。两脚本另调用 `assert_no_unintended_deletions()`，`git status` 一旦出现本脚本不负责的删除就中止部署。
- **CI 执行顺序**：先 `actions/checkout` 检出 `gh-pages`（线上数据落在 `./data/`，供脚本做增量比对），再 `git fetch origin main:main` + `git checkout main -- scripts/<file>` 取回脚本（脚本只在 `main` 上维护）。
- **本地部署也必须守同一条红线**：`gh-pages` 的 `data/` 同样**不能被本地部署覆盖**。原先 `deploy.ps1` / `deploy-once.ps1` / `sync-fast.ps1` 都用 `npx gh-pages -d dist`，而该命令默认 `CLEAN=true`，会**先清空整条 gh-pages 分支**再上传 `dist`；`dist/data/` 只是仓库里 `public/data/` 的静态副本，于是每次本地部署都把 Actions 每 20 分钟采样的 `market_history.json` 覆盖回旧快照（实测 commit `a4192aa` 把 2 个采样点覆盖回 1 个）。`.github/workflows/deploy.yml` 早就用 `rm -rf dist/data` + `CLEAN: false` 规避，本地脚本此前漏了。
  - 现统一改用自带发布器 **`scripts/publish-gh-pages.mjs`**：只同步「非 `data/`」文件，推送前断言受保护文件既未消失、也未改大小，并检查 `git status` / 暂存区里没有任何 `D data/...`，一旦发现立即中止。
  - 调试可用 `DRY_RUN=1 node scripts/publish-gh-pages.mjs --dir dist --repo <url>`。
- **本地调试**：`DRY_RUN=1 python scripts/<script>.py` 只抓取 + 写本地，不推送。
- **注意 PowerShell 脚本必须以 UTF-8 + BOM 保存**：Windows PowerShell 5.1 在没有 BOM 时按 ANSI 读取，中文注释会破坏语法并报出与真实原因无关的解析错误（`Unexpected token`、`missing terminator` 等）。改完 `.ps1` 后务必确认 BOM 还在、且用 `[System.Management.Automation.Language.Parser]::ParseFile()` 复核为 0 错误。

---

## 五、代码风格与约束

1. **纯本地自用、不部署、不商用**：默认 `pnpm dev` 使用、改动直接改源码、不提交远程。部署脚本仅供需要发布公开版时使用，**非日常流程**。
2. **严禁改动 `public/data`**：`data.json`（含硬上限）与 `market.json` 是游戏数据源，任何情况不得修改。
3. **风格统一**：新页面复用既有 Calculator / Workflow / Transmute 体系、`chainbuilder`/`manualchemy` 页面结构与 `private.ts` 路由模板，**不重造计算逻辑**。
4. **小批量改动**：新增功能优先「独立页 + 聚合 API + 路由注册 + 多语言追加」的局部改动，避免大文件整体重写。
5. **旧数据迁移兼容**：新增筛选字段时需兼容旧 localStorage（如 `name` 字符串→数组、`actionLevel→minLevel`、`profitRate→minProfitRate` 的迁移逻辑），缺失字段按 undefined/falsy 处理。
6. **缓存红线**：引入新计算模式参数必须清对应缓存（见 §2.4）。
7. **改动后更新文档**：涉及架构/功能改动时，同步维护本文件、`MILKONOMY_PROJECT_CONTEXT.md` 与 `REUSABLE_ABSTRACTION_MODULES.md`。

---

*（本文基于当前源码整理，随功能更新请同步维护。）*
*（内容由AI生成，仅供参考）*
