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
- **市场历史归档**：`data/market_history_<UTC日>T<HH>.json`（由 GitHub Actions + 外部定时器每小时采样，UTC 6 小时分片、滚动 7 天 / 168 点）供市场监控页计算涨跌与时间窗内成交量，详见 §2.3.1 与 §4.1；页面另有 localStorage 本地兜底采样。

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
- **页面级辅助模块可内聚在域目录下**：如 `marketvolume/history.ts` 维护「市场历史采样」——`MarketPriceSample`（`{t, p:{hrid:{level:[ask,bid,volume]}}}`；**旧样本只有 `[ask,price]` 两个元素，两种长度都要兼容**，取值必须走内部 `valueAt()` / `priceOf()`，不要直接下标）、`recordLocalSample`（localStorage 兜底，节流 30min、上限 200 条、7 天滚动窗口）、`loadMarketHistory(windowHours)`（按所选时间窗**按需拉取**服务端分片 `gh-pages:data/market_history_<UTC日>T<HH>.json`，见 §2.3.1；一片都没取到时回退读 v1 单文件 `market_history.json`）、`getMarketChangeMap(list, windowHours, metric, now)`（基准 = 时间窗起点前最近采样，key=`hrid|level`，无基准 / 当前值无效时该项不出现）。`metric` 可选 `price`（ask/bid **中点**）/`ask`/`bid`/`volume`；`volume` 是官方**当日累计成交量**（UTC 0 点归零），比的是**增量速率**而非绝对值。

  **市场历史模块的硬约束（都踩过坑，改动前先读）**：

  1. **时间基准统一为「快照时间戳」**：`t` 一律取 `defaultNow()`（= 官方 `marketData.timestamp`，取不到才回落墙钟）。早期 `recordLocalSample` 写墙钟，导致同一份快照在本地样本与线上归档里是两个时刻，增量区间的分母直接失真；**「成交量/小时」的分母也不能用 `Date.now()`**，否则页面开着不动数字自己往下漂。
  2. **同一 `t` 只保留一条**：`recordLocalSample` 在写入前比对上一条（相同则返回 `false`，`force` 也不例外，这样「立即采样」能诚实提示「已是最新」）；`getMarketHistory()` 合并归档与本地时再按 `t` 去重一次（本地优先）。重复点会让「上一点」变成同一时刻，把区间分母算成 0。
  3. **`getMarketHistory()` 结果带缓存**（页面每行都要算速率，原实现每次重建 Map + 排序是 O(n log n)）。样本只在 `recordLocalSample` / `loadMarketHistory` 变化，**新增写入点必须同步置空 `mergedCache`**，否则页面读到旧历史。

  跨 UTC 归零点判断统一走 `volumeDeltaBetween(startT, startVol, endT, endVol)`：**同日**取真实增量（为负判无效），**跨日**只能用 `endVol`（自今日 0 点起的累计）并把计时起点改到 0 点；直接把昨天的累计当今天增量会算出虚高速率。UI 侧 `getVolumeRateDetail` 额外返回实际区间小时数与是否跨日，用于在采样稀疏时提示「这个速率不是按你选的时间窗算的」。

  4. **成交量展示用「时间窗内滚动成交量」，不是官方当日累计量**：官方 `v` 每天 UTC 0 点归零，直接展示会让刚过零点的所有物品都变成小数字、跨时刻不可比。`getRollingVolumeDetail(item, windowHours, now)` 在自有归档上把相邻采样点的增量滚动累加，返回 `{volume, hours, knownHours, coverage, crossings}`；`hours` 是**实际**统计区间（列头用的就是它，而不是所选窗口），`coverage < 1` 表示跨了归零点、0 点前那段无法还原（页面用 `el-alert` 提示）。价格涨跌**不**走这条路径（必须严格按窗口取基准），`findVolumeAnchor` 只服务成交量类指标。

  **采样频率的真相（决定了上面的精度上限）**：官方 `marketplace.json` 每 60s 轮询一次（`main.ts`），而官方快照是**整点小时粒度**；GitHub Actions 的 `schedule` 是 best-effort 的 —— 本仓库实测声明 60min、实际相邻间隔 143~466min（中位 307，全部 success，是触发器被延迟而不是脚本失败）。所以**每小时采样只能靠浏览器**：`startMarketAutoSampling()`（在 `main.ts` 调用一次）监听 `marketData.timestamp` 变化，快照一前进就落一个本地采样点，不受 Actions 延迟影响。本地上限 200 条 ≥ 7 天 × 24 点 = 168，够用。

  > ⚠️ **2026-10-01 实测更新（本条结论已变，勿再照抄上面那段旧推断）**：
  > 上面「每小时只能靠浏览器」是基于「外部定时器尚未生效、只剩 GitHub 自身 `schedule`」的时期。
  > **数据侧**：09-25 及以前每天仅 ~5 个采样点、相邻间隔 3~6 小时；09-26 起变密，
  > 09-27 ~ 09-30 连续 4 天每天恰好 24 个采样点、间隔严格 60 分钟（整点 `:06`）。
  > **触发器侧**（GitHub API 拉运行记录）：本 workflow 共 170 次运行、全部 success，
  > 其中 `workflow_dispatch`（cron-job.org 打的）117 次、`schedule` 53 次；
  > `workflow_dispatch` 在 09-20 试了 3 次后**断了 6 天**，自 **2026-09-26T09:19 恢复**，
  > 并从 10:00 起严格整点触发，此后 112 次相邻间隔全部为 60 分钟、无缺口。
  > 该时点 `main` 上并无对应代码提交 → 确认是**外部触发器在 09-26 才真正稳定生效**，非代码改动。
  > ⚠️ 那次 6 天断档期间 GitHub 侧全部 success、**无任何告警**（数据只是从 24 点/天退化为 ~5 点/天，
  > 被 GitHub 自带 cron 兜底掩盖）。若要守住「每小时」SLA，建议加健康检查：
  > 定时校验 `market_history_*.json` 最新采样点年龄，超阈值即让 workflow 失败以触发邮件告警。
  > 因此服务端归档现在本身就是真·每小时，`startMarketAutoSampling()` 已降级为「本地兜底/离线补点」，而非唯一通道。

### 2.3.1 服务端归档：分片格式 v2 与外部定时触发

服务端归档（`gh-pages:data/market_history_<UTC日>T<HH>.json`）解决的是**多设备共享**：浏览器本地采样只覆盖当前这一台设备。

**为什么分片 + 字典编码**：官方快照 872 件物品 × 平均 3.4 个强化档 ≈ **2992 个条目/点**。沿用朴素结构（`{hrid:{level:[ask,bid,volume]}}`）实测是 **90.6 KB/点**，7 天 168 点就是 **14.5 MiB** —— 而市场监控页每次打开都要下载并解析，正是「数据量太大卡顿」的来源。改进后：

| 方案 | 每点 | 168 点合计 | 页面实际取用 |
|---|---|---|---|
| 朴素结构（v1 单文件） | 90.6 KB | 14.5 MiB | 整份 |
| **v2 字典 + 变长行** | **65.3 KB**（72%） | 10.4 MiB | — |
| **v2 + UTC 6 小时分片** | — | 10.4 MiB（28~30 片） | **只取窗口覆盖到的 1~2 片**（≈125 KB/片 gzip） |

差分编码（只写变化项）实测只能到 35 KB/点（36.8% 的报价每小时都在变），收益不如分片，故未采用。

**格式（`v:2`，Python `encode_shard` ↔ TS `decodeShard` 成对）**：

```json
{"v":2,"d":["/items/apple", …],"s":[[t,[[i,l,a],[i,l,a,b],[i,l,a,b,v]],…]]}
```

行是**变长**的，靠长度区分（缺省分别表示 -1/-1/0）：`[i,l,a]` 只有左挂单、`[i,l,a,b]` 有报价无成交、`[i,l,-1,b]` 只有右收购、`[i,l,a,b,v]` 齐全。`i` 是 hrid 在 `d` 里的下标，`l` 是**强化等级**（0~20）。全空白条目不写；字典里可能有未被引用的项，解码只按行取值，无害。

> ⚠️ 改这个格式必须**同时**改 Python 与 TS 两侧，并重跑 `python scripts/dev/gen_shard_fixture.py` 更新 `tests/fixtures/market-history-shard.json` —— `tests/marketvolume-shard.test.ts` 用「Python 编码 → TS 解码」的 fixture 做跨语言断言，是防漂移的唯一护栏。

**客户端的按需加载**：`loadMarketHistory(windowHours)` 用 `shardKeysForWindow()` 算出所需块键，只补拉缺失的片并缓存（切窗口只拉差量）。取片范围 = 窗口起点所在块再往前一块（基准点可能落在前一块）。**一片都没取到时**才回退读 v1 单文件 `market_history.json`（迁移期的安全网，之后可择机从 gh-pages 删掉）。v1 文件现在**既不再更新也不删除**。

**真正做到每小时：外部触发器**。Actions 自带的 `schedule` 实测只有约 5 小时一次，所以用 **cron-job.org 每小时打 `workflow_dispatch`**，workflow 里的 cron 降级为兜底。配置：

1. 建 **fine-grained PAT**：只勾这一个仓库，权限只需 **Actions: Read and write**（其余全不勾），设一个过期时间。
2. cron-job.org 新建任务：
   - URL：`https://api.github.com/repos/Forever985/mewkonomy/actions/workflows/market-history.yml/dispatches`
   - Method：`POST`，Schedule：`0 * * * *`（每小时整点；快照整点生成，脚本按 timestamp 去重，早跑晚跑都落到同一个点）
   - Header：`Accept: application/vnd.github+json`、`Authorization: Bearer <PAT>`、`Content-Type: application/json`
   - Body：`{"ref":"main"}`
   - 开启失败通知（邮箱），这样触发器挂了能立刻知道。
3. 验证：Actions 页面应出现 `workflow_dispatch` 触发的运行记录；若返回 `401/403` 就是 PAT 权限或过期问题。

**GitHub 侧的成本与限制**（实测/查证）：公开仓库 Actions 分钟数免费无限；每小时一次 ≈ 720 次/月 × 约 25 秒，私有仓库也仅约 300 分钟/月（免费额度 2000）。cron 最小粒度 5 分钟；公开仓库的定时工作流在仓库 60 天无活动后会被停用，但本工作流自己会提交，算作活动。往自己的仓库提交数据、用外部定时器调 `workflow_dispatch` 都是正常用法。

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

### 2.10 市场提醒（纯函数 + 独立 store 的分层写法）

新增业务能力时值得照抄的**分层模板**——把「逻辑」与「配置」与「展示」彻底分开：

```
common/apis/marketvolume/alerts.ts   ← 纯函数：规则模型 + 评估（只 import 类型，可单测）
pinia/stores/alert.ts                ← 配置持久化（localStorage，带 version，缺字段补默认）
pages/marketvolume/index.vue         ← 只负责：把列表喂进评估、渲染命中、发通知
layouts/components/Settings/index.vue ← 只负责：渲染开关并把改动写回 store
```

三条经验：

1. **副作用不要进纯函数模块**。`alerts.ts` 不碰 localStorage、不碰 i18n、不读 store，所以
   `evaluateAlerts` 可以直接用普通数组断言；页面决定"怎么显示、要不要弹系统通知"。
2. **配置单独一个 store，别塞进既有 store**。提醒配置放进 `layoutsConfig` 会被
   「重置布局配置」误删；独立 key（`market-alert-config`）也让"缺字段补默认"的归一化更简单。
3. **持久化配置一律写归一化函数**（`normalizeConfig`/`normalizeRules`）：`localStorage` 里可能是
   旧版本、被手改、或字段类型不对的数据，读取时逐字段兜底，**不要写一次性迁移脚本**。

⚠️ 该功能的输入列表必须用页面回填后的 `changeApplied`（不是 `all`），详见 `AI_CONTEXT.md` §10.3。

### 2.11 数值区间筛选（RangeFilter）与「纯工具不要走 barrel」

同一套「逻辑下沉 + 可复用控件」的写法，市场监控的**区间筛选**是另一个例子：

```
common/apis/marketvolume/filters.ts        ← 纯函数：NumericRange 模型 + matchesRange/applyRangeFilters
common/components/RangeFilter/index.vue    ← 可复用控件：模式下拉 + 1~2 个数字输入（被 5 个指标复用）
```

控件只负责**采集输入**，判定全在 `filters.ts`。这样 5 个指标不会各写一遍选项文案与 v-model 逻辑，
也不会把"端点是否包含"这种语义散落在模板里。

定义区间语义时踩过的两个坑，值得照抄结论：

- 选项文案用 **`≥` / `≤` / `区间`** 而不是"高于/低于"——后者会让人反复纠结端点；
  实现上一律**含端点**，并与提醒规则的 `gte`/`lte` 保持同一理解。
- **阈值留空必须等于"不筛选"**，不能等于"匹配空集"。否则用户把模式切成 `≥`、还没填数字的那一瞬间，
  列表会整片变空，看起来像坏了。

> ⚠️ **零依赖的纯工具要单独成文件，不要放进 `common/apis/<域>/index.ts`。**
> 那个 barrel 会 `import @/common/apis/game`，而 game 在顶层注册了
> `watch(..., { immediate: true })` 重建全量索引 —— 在没有数据的时机（**单元测试最容易**）
> 导入它就会以 `Cannot read properties of null (reading 'actionDetailMap')` 直接抛错。
> 所以行 key 这种纯字符串工具落在 `common/apis/marketvolume/keys.ts`，需要它的 store / 纯函数
> **直接从该文件引**。判断标准很简单：*这个模块需要游戏数据吗？* 不需要就别让它有能力把数据层拖进来。

### 2.12 加价格档位口径时改哪里

价格口径目前是 **左/右 ×（`-` / 原价 / `+`）共 6 个**（`PriceStatus`）。新增一个口径只动两处：

1. `pinia/stores/game.ts`：`PriceStatus` 枚举 + `PRICE_STATUS_LIST`（标签用 `${getTrans("左价")}+` 这种后缀语法）。
2. `common/apis/game/index.ts`：`STATUS_STEP_SPEC`。

**`STATUS_STEP_SPEC` 是 `Record<PriceStatus, { base, dir }>` 而不是 `switch`，这是刻意的**：
漏掉新枚举成员会**直接编译失败**。如果写成 `switch`，很容易出现「UI 下拉里能选、但价格没变化」
这种静默错误（因为没有 `default` 分支，编译器不会提醒）。

- `dir`：`0` = 原价、`+1` = 抬一档、`-1` = 压一档；`base` = 读 `ask` 还是 `bid`。
- `priceStepOf(price, high, enhanced)` 不用改——它只认"抬/压"方向，强化物品的 ×5 自动适用。
- 价格缓存不用清：`_priceCache` 的 key 含 `buyStatus|sellStatus`，新口径自带一个桶。
- 所有下拉都是 `v-for="item in PRICE_STATUS_LIST"`，所以 UI 会自动多出选项（含共用组件
  `common/components/PriceStatusSelect/index.vue`）。

> ⚠️ 写测试时若要给 `store.marketData` 注入自定义报价：**必须赋一个全新字面量**。
> `{ ...store.marketData }` 这类"展开 reactive 对象"的写法会把嵌套的 reactive 代理带进新值，
> 而 game 的模块级 watch 会做 `structuredClone(toRaw(...))`（`toRaw` 只解顶层），
> 于是抛 `DataCloneError: #<Object> could not be cloned`。

### 2.13 加「排除某类」开关：必须是独立开关，不能做成包含关系

检索侧的 `banEquipment` / `banJewelry` / `banCharm` **三者互相独立**，`banEquipment`
只负责「既非首饰、也非护符」的装备。这不是洁癖，是被真实 bug 教出来的：

> 最初 `banEquipment` 直接按 `isEquipment` 剔除，而首饰（项链/戒指/耳环）的 categoryHrid
> 同样是 `/item_categories/equipment`，于是首饰被一并剔掉。后果是**只要勾了「排除装备」，
> 「排除首饰」就永远没反应**。而 dashboard / manualchemy 的 `banEquipment` 默认就是 `true`，
> 用户在这两页上怎么点都看不到变化，报成「排除首饰没用」。护符（`/equipment_types/charm`，
> 102 件）后来也按同一原则摘了出来。

新增一个「排除 X」时要同步的地方（一处漏改就会退化成包含关系或彻底不生效）：

1. `common/utils/game.ts`：加判定函数（参照 `isJewelry` / `isCharm`），
   并把它从 `banEquipment` 的过滤条件里**放行**（`!isEquipment || isJewelry(x) || isCharm(x)`）。
2. `common/apis/utils.ts` 的 `handleSearch`：加过滤分支。
3. `common/apis/favorite/index.ts`：**收藏夹是另一条检索路径**，必须保持同一语义
   （历史上两条路径对「排除装备」的理解就分叉过）。
4. 类型：`common/apis/leaderboard/type.d.ts`（`RequestData`）与 `SearchPanel/types.ts`（`PanelSearchData`）。
5. 各页 `searchData` 默认值 + `panelFields`；`enhanceexp` 还有一个「生效条件」摘要列表要补。
6. **默认值要让默认行为不变**：新开关的默认值取与该页 `banEquipment` 相同
   （`banEquipment: true` 的页面默认也排除），否则改完一刷新，用户的列表内容就变了。

### 2.14 「可开可关」的显示过滤放哪：一个独立 store，别用 `useMemory`

市场监控的「隐藏小成交量」需要**设置面板和市场监控页同时读写**。

- ❌ `useMemory(key, ...)`：每处调用各持一个独立 ref，在设置里改了，页面不会更新（要等刷新）。
- ❌ 塞进 `layoutsConfig`：「重置布局配置」会顺手把业务过滤条件一起重置。
- ✅ 单独一个 store（`pinia/stores/marketfilter.ts`），两处 `v-model` 同一份状态，天然同步。

另外，过滤用的**数值口径要与 UI 展示的那一列一致**（这里复用 `rangeValueOf(item, "volume")`），
否则会出现「屏幕上写着 0、却因为底层另一个字段非 0 而被留下」这种自相矛盾。

### 2.15 新增一个「检索结果页」：不要手抄骨架，用 `useLeaderboardPage`

新建检索页（或迁移老页面）时，**不要**再手写分页 / 检索调用 / 排序 / 详情弹窗那一段。
它们已经收敛到 `src/common/composables/useLeaderboardPage.ts`：

```ts
import { useLeaderboardPage } from "@/common/composables/useLeaderboardPage"

const {
  searchData: ldSearchData,
  list: leaderboardData,
  loading: loadingLD,
  paginationData: paginationDataLD,
  handleCurrentChange: handleCurrentChangeLD,
  handleSizeChange: handleSizeChangeLD,
  handleSearch: handleSearchLD,
  handleSortChange: handleSortLD,
  currentRow, detailVisible, showDetail,
  priceVisible, currentPriceRow, setPrice,
  onPriceStatusChange
} = useLeaderboardPage({
  key: "yourpage",              // 缓存 key 前缀
  api: getYourDataApi,
  searchData: { /* 本页检索条件默认值 */ }
})
```

三条纪律：

1. **`key` 决定三个 localStorage key**（检索条件 / 分页 / 买卖价状态）。
   默认派生自 `key`，**与历史 key 不一致时必须用 `memoryKey` / `paginationKey` / `priceStatusKey` 覆盖**，
   否则用户的条件与分页会"看起来丢了"。新页面直接用默认值即可。
2. **别名解构，别改模板**。全站模板都在用 `ldSearchData` / `paginationDataLD` / `loadingLD` 这套命名，
   沿用它们能让改动只落在 `<script>` 里。
3. **本页特有逻辑留在页面里**。骨架不覆盖的（表头点击并入排序优先级、模式缓存重算、
   行高亮、只读回调等）写在调用之后；需要"改骨架某个行为"时，用别名接住原函数再包一层，例如
   `handleSortChange: applyHeaderSortLD` + 自己定义 `handleSortLD`。

### 2.16 批量替换「重复区块」时：区域里常混着各页特有代码

**动手前先跑仓库自带的扫描器**（不需要装任何依赖）：

```bash
python scripts/dup-scan.py                  # 默认最小 8 行、跨 ≥2 文件
python scripts/dup-scan.py --min-lines 12   # 只看更大的块
python scripts/dup-scan.py --src src/pages  # 只扫页面
```

输出两个榜单：「重复行数最多的文件」（重构收益最大的目标）与「出现在最多文件里的重复块」
（最该优先抽成公共模块的轮子）。**先量再改**，不要凭印象挑目标。

抽公共逻辑时最容易出的事故不是语法错误，而是**把夹在骨架之间的业务逻辑一起删掉**，
而且**类型检查查不出来**（没被引用的函数删了不报错）。

实测例子：某页的「骨架区域」里夹着 `rowClassName`（整行高亮）、`searchPanelRef`（排序优先级联动）、
以及两个「改价格口径就清模式缓存」的 watch —— 它们都在骨架函数之间，位置很"像"骨架。

做法：

1. 先算出「各页该区域行的**交集**」——只出现在 1~2 个页面里的行就是各页特有逻辑，必须保留；
2. 替换后除了 `tsc`，还要**对比迁移前后的顶层声明集合**（`function`/`const` 名），
   确认消失的每一个都能解释清楚（"搬进公共模块了"），而不是"不知道去哪了"；
3. 若某个骨架函数的**行为被某页重载过**（如上例的 `handleSortLD`），
   公共模块要允许用别名接住原函数、由页面包一层，而不是把页面那版删掉。

### 2.17 想加「反解某价格」类功能：先看 `common/utils/price-solve.ts`

时薪对**每个单价都是线性的**（`profitPH = incomePH − costPH`，两项都是单价的一次式），
所以「给定目标时薪 → 临界单价」是**闭式解**，不要写迭代或二分：

**临界单价 = 当前单价 + (目标时薪 − 当前时薪) / 系数**
- 材料侧系数 = `−countPH`（买贵了利润降）
- 成品侧系数 = `+countPH × MARKET_TAX_FACTOR`（金币不课税，系数不带税率）

`countPH`（每小时用量/产量）计算器已经算好，直接取即可，**不要自己重新推导游戏公式**。

```ts
import { primaryCandidateOf, solveCandidatesOf, solvePriceForTarget } from "@/common/utils/price-solve"

const cand = primaryCandidateOf(calc)!          // 主要询价物品 = ingredientList[0]（本体/主料）
const r = solvePriceForTarget(calc.result.profitPH, cand, 目标时薪)!
r.criticalPrice  // 临界单价
r.impossible     // 临界价 ≤ 0 = 即使白送也达不到
```

三条注意：

1. **`calc.run()` 必须先调**——`result`（含 `profitPH`）是它填充的，否则拿到 `undefined`。
2. 该模块是**纯函数**（零运行时依赖），物品名与档位价由调用方补；
   要显示「哪个档位」用 `getPriceOf(hrid, level, status, ...)` + `PRICE_STATUS_LIST`，别硬编码档位文案。
3. 反解的正确性**建立在线性模型上**，所以测试要验模型本身：
   断言 `Σ countPH×price ≈ calc.result.costPH`、`Σ 系数×countPH×price ≈ calc.result.incomePH`
   （应精确到 1e-9 量级）。只验"临界价代回等于目标"是自证循环，证明不了什么。

4. **加「时薪 / 日薪」这类单位切换时，内部只保留一个口径。** 本模块的
   `toProfitPHOf` / `fromProfitPHOf` / `resolveTargetProfitPH` 就是干这个的：
   内部一律按 `HOURS_PER_DAY = 24` 换算（与 `Calculator.run()` 里 `profitPDFormat` 同口径，
   **别自己另立标准**），于是两种模式解出的临界价必然一致——这条已单测。
5. ⚠️ **`el-input-number` 被清空时会把 v-model 置为 `undefined`。**
   如果面板根节点是 `v-if="... && 目标值"`，**整张卡片连输入框自己会一起从 DOM 消失**，
   用户想重新填数字都没有地方填。正确做法是**留空回落到当前值**；
   并且**判空必须用 `== null` 而不是 falsy 判断**——`0` 是有效目标
   （解「不亏本」的临界价），被当成空就会悄悄显示成当前值。


### 2.18 「填表算利润」页：新增动作或改表单时看这里

页面在 `pages/profitform/index.vue`，算钱的逻辑在 `common/utils/profit-form.ts`（纯函数）。

**改动前必守的两条**：

1. **默认值必须精确复现计算器**。表单默认值全部来自 `createFormState(calc)`，
   不改任何格子时应满足
   `总成本 ≡ costPH`、`总收入 ≡ incomePH`、`总利润 ≡ profitPH`、`总耗时 ≡ 1 小时`。
   这条有单测盯着（`tests/profit-form.test.ts`），改完必须仍然成立——
   **它是"改哪格就是覆盖哪格"这个承诺的地基**。

2. **加动作时，物品枚举必须过「可用性闭环」测试**。新动作要在
   `common/apis/profitform/index.ts` 的 `PROFIT_FORM_ACTIONS` 里声明 `match`，
   并如实标注必填参数（`needEnhanceLevel` / `needProtectLevel` / `needCatalyst`）。
   ⚠️ **"能列出"与"能用"是两件事**：强化计算器的 `protectLevel` 是必填，
   不传会让 `available` 为 false，表现成"选择器里有这件物品，却提示不支持该动作"。
   测试里那条「选择器列出的物品，计算器必须真的接受」就是专门拦这个的。

**持久化只存覆盖值**（`stores/profitform.ts`）：存的是"你手填过的那几项"，
不是整张表。因为配方（工匠茶/触媒/强化等级）会变，存整张表会显示过期配方且静默算错。

---

### 2.19 改「无市价兜底」前必读：模型、优先级与那条不变量

逻辑全部在 `common/utils/price-fallback.ts`（**纯函数、零运行时依赖**），设置在 `game store.priceFallback`。

**模型：左右两侧各一条独立优先级链**

```
正常市价 →（可选）借用另一端的市价 →（可选）商店价 / 大全套 → 无价 -1
```

- `PriceFallbackSettings.ask` / `.bid`：各含 `cross`（是否借另一端）与 `then`（借不到时用
  `none` / `shop` / `bigset`）。
- `forceBigSet`：无视市价，一律按大全套（自产成本）算。
- 解析只有 `resolvePriceSides` 一个出口，**不要在别处再写一套判定**。

**必须守住的不变量：来源与价格永远一致。**
`source === "none"` ⇔ `price === -1`；其余来源都必须真的取到了数。
这条以前在 level>0 上不成立（旧实现两套判定条件不一致，实测漂移 1402~1404 条，UI 出现
「-1 却标成【商店】/【自产】」）。现在 `getPriceOf` 与 `getPriceSourceOf` 共用 `resolvePriceOf`，
价格与来源一次产出。**改动解析逻辑时，务必跑 `tests/price-fallback-integration.test.ts`**，
它会在全物品 × 多等级上把这条不变量扫一遍。

**加新兜底手段时**：在 `FallbackSide.then` 里加枚举值 → 在 `pickSide` 里加分支 →
在 `tests/price-fallback-strategies.test.ts` 的市场形态表里加一种组合。
矩阵测试会自动覆盖新手段，**不需要手写新用例**。

**换设置后不要指望「缓存被清了」**：价格缓存的 key 里含 `priceFallbackSignature(settings)`，
所以切换会自然 miss。旧实现只靠异步 watch 清 `_priceResolutionCache`，
曾导致同一 tick 内切模式读到旧结果（`tests/price-fallback-integration.test.ts` 守着这条）。


## 三、测试

- 框架：**vitest + happy-dom**（`pnpm test`）。测试文件在 `tests/` 下。
- **Mock 策略**：用 `vi` 控制模块（`vi.resetModules()` + 动态 `import` 重新加载 store / 模块，见 `marketvolume-cache.test.ts`、`marketvolume-history.test.ts`）；纯计算逻辑（calculator）可直接断言数值；涉及 localStorage 的用例先 `localStorage.clear()`。
- 既有测试清单（`tests/`，2026-10-03 实测：**32 个文件 / 209 个用例，全部通过**）：
  - 市场监控家族（12 个，当前测试重心）：`marketvolume-cache`（旧缓存结构兼容）、`marketvolume-history`（涨跌历史：本地采样节流/强制、无历史空 map、时间窗涨跌百分比、基准/当前价缺失过滤）、`marketvolume-history-format`、`marketvolume-rolling-volume`、`marketvolume-shard`（Python 编码 → TS 解码的**跨语言**防漂移断言）、`marketvolume-sort`、`marketvolume-tiers`、`marketvolume-verify`、`marketvolume-volume-rate`、`marketvolume-alerts`（**提醒纯函数语义**：绝对值/相对排行、范围与 onlyActive、多规则去重与优先级、非法参数与零基准边界）、`marketvolume-alerts-integration`（**列表→预置规则→命中**的真实链路）、`marketvolume-filters`（**区间筛选语义**：端点包含、阈值留空=不筛选、填反自动对调、null/-1 值处理、多条件叠加；外加收藏 store 的持久化与坏数据归一化）
  - 业务校验：`bigset-c-verify`（大批量组合检索）、`ban-filter-independence`（**排除装备/首饰/护符三开关互相独立**）、`chainbuilder-verify`（手动产业链）、`charmtransform-verify`（护符转化）、`cross-project-tail-verify`（及 `extended`，跨项目尾段）、`handle-best-per-item`（每物品最优方案）、`enhanceexp-profitable`（仅看赚钱方案）、`condition-level-range`（按行限定要求等级区间）、`artisan-tea-level-bonus`（工匠茶 +5）、`price-fallback-verify`（价格兜底回归）、`price-fallback-strategies`（**兜底策略矩阵**：6 种单侧策略 × 左右组合 × 强制开关，穷举 360 组断言「标了来源就一定取到价」）、`price-fallback-integration`（**真实数据上来源与价格必须一致**，含 level>0 与「同一 tick 切换设置」）、`price-status-tiers`（**价格档位口径**：6 个口径递增性、0.366% 与强化 ×5 的幅度、低价保底 1 金、无价保持 -1）、`price-solve`（**目标时薪反解**：手算样例验符号、真实计算器验线性模型精确到 1e-9、**时薪/日薪两种口径解出的临界价必须一致**、**输入框留空回落当前值而 0 仍是有效目标**）、`profit-form`（**填表算利润**：手算样例、默认值必须精确复现计算器的 costPH/incomePH/profitPH、动作枚举的**可用性闭环**）、`sort-priority`、`search-panel-checkbox`
  - 基础：`demo`、`components/Notify`、`utils/validate`
- **改动涉及缓存/价格/过滤逻辑时，建议补充对应 verify 测试**，与既有命名风格保持一致。
- **纯逻辑与集成分开写**：像市场提醒那样，把「可单测的纯函数」（`alerts.ts`）与「接线后才有意义的部分」拆成两个文件——前者断言语义，后者用 `vi.mock` 注入真实形状的数据走完整条链路。只写后者会因数据构造复杂而漏掉边界；只写前者会漏掉"两块拼起来才暴露"的问题。
- ⚠️ **看到 `Errors 1 error` 不要只看 `Test Files xx passed`**：运行器往临时目录写缓存被拒（`EPERM ... open '<TEMP>\...\web\<hash>'`）时会**静默丢掉一整个测试文件**，vitest 自己的警告原文就是 "This might cause false positive tests"。把 `TEMP`/`TMPDIR` 指向工程内可写目录后重跑即可恢复。
- ⚠️ **测试里要"真数据"时的导入顺序**：`@/common/apis/<域>/index.ts` 这类 barrel 会拉到 `@/common/apis/game`，而它在**顶层**就注册了 `watch(..., { immediate: true })` 重建全量索引。必须「**先写 `localStorage` → 再建 / 播种 store → 最后动态 `import()` 数据层**」；任何把数据层放到模块顶层静态 import 的写法都会以 `Cannot read properties of null (reading 'actionDetailMap')` 直接炸在收集阶段。

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
| `market-history.yml`（Market History Sampling） | **外部定时器（cron-job.org）每小时打 `workflow_dispatch`**；`cron: "5 * * * *"` 仅作兜底；`concurrency: market-history-sampling` 保证不并发 | `scripts/sample_market_history.py` | 抓官方 `https://www.milkywayidle.com/game_data/marketplace.json`（约 0.4s、极稳定），写入 `gh-pages:data/market_history_<UTC日>T<HH>.json` 分片（UTC 6 小时一块，v2 字典编码）；滚动 7 天 / 168 点。配置见 §2.3.1 |
| `update-data.yml`（Update Game Data） | 每天 UTC 00:20（`cron: "20 0 * * *"`）+ 手动 `workflow_dispatch` | `scripts/fetch_game_data.py` | 抓上游 `data.json` / `market.json`，只负责这两个文件 |

- **为什么拆开**：历史采样与游戏数据抓取原先共用一个 job，`data.json` 上游一挂，历史采样一起停摆——线上曾因此**连续 8 天没有任何新采样点**。
- **为什么游戏数据改为每天一次**：游戏数据只在游戏版本更新时变化，原先每小时跑一次纯属浪费 Actions 配额。
- **官方快照实际是 1 小时粒度（实测）**：`marketplace.json` 顶层 `timestamp` 代表**市场快照本身的生成时间**，实测它以**整点、每小时**为粒度前进（例如 07:06:00 → 08:06:00），而不是每 20 分钟。因此：
  - 因此稳定产出约 **24 个采样点/天**；更频繁的运行会因时间戳相同被去重跳过（属预期行为，不是故障）。cron 仍取每小时第 5 分钟并保留手动触发，作为对 GitHub 调度延迟的容错；
  - 7 天窗口下约 168 点；v2 分片按**分片**滚动清理，不会触发旧的上限。线上实测：超出 7 天窗口的旧片（如 `2026-09-23T18`）已返回 404，属预期行为；
  - 「涨跌」基准点的最细分辨率是 1 小时。**2026-10-01 线上实测：归档已是真·每小时（每天 24 点，起点 2026-09-26），所以 1 小时时间窗现在也能取到基准点、正常出数**——原先「1 小时窗口常显示 `--`、3 小时以上才有稳定意义」的说法对应的是 2026-09-26 之前的稀疏时期，**已不成立**。
- **部署安全红线（必读）**：`gh-pages` 的 `data/` 是**多脚本共享目录**——`sample_market_history.py` **只拥有** `market_history.json`（v1 遗留）与 `market_history_*.json`（v2 分片），`fetch_game_data.py` **只拥有** `data.json` / `market.json`。两脚本都只把自己的文件复制进 `gh-pages` 的全新克隆再提交，**绝不允许 `rmtree` + `copytree` 整个 `data/`**：早期采样脚本用 `public/data` 整目录替换线上目录，而 `main` 的 `public/data` 不含新抓的 `data.json`/`market.json`，导致**每次采样都会删掉线上 4MB 的 `data.json` 与 70KB 的 `market.json`**（commit `93f0107`）。两脚本另调用 `assert_no_unintended_deletions()`，`git status` 一旦出现本脚本不负责的删除就中止部署。分片版仍遵守这条：只写 / 只删 `market_history_*.json`，且删除目标（超出保留期的旧片）会显式加入 `owned_files` 白名单。
- **CI 执行顺序**：先 `actions/checkout` 检出 `gh-pages`（线上数据落在 `./data/`，供脚本做增量比对），再 `git fetch origin main:main` + `git checkout main -- scripts/<file>` 取回脚本（脚本只在 `main` 上维护）。
- **本地部署也必须守同一条红线**：`gh-pages` 的 `data/` 同样**不能被本地部署覆盖**。原先 `deploy.ps1` / `deploy-once.ps1` / `sync-fast.ps1` 都用 `npx gh-pages -d dist`，而该命令默认 `CLEAN=true`，会**先清空整条 gh-pages 分支**再上传 `dist`；`dist/data/` 只是仓库里 `public/data/` 的静态副本，于是每次本地部署都把 Actions 采样的历史文件覆盖回旧快照（实测 commit `a4192aa` 把 2 个采样点覆盖回 1 个）。`.github/workflows/deploy.yml` 早就用 `rm -rf dist/data` + `CLEAN: false` 规避，本地脚本此前漏了。
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
8. **`pnpm lint` 的作用域与两个坑（2026-10-01 修正）**：`eslint.config.js` 的 `ignores` 只显式列了 `data/**` 与 `public/data/**`（`data.json` 约 4MB，属数据非代码）；`dist/`、`temp/`、`.vite/`、根目录 `assets/` 这些产物目录靠 `.gitignore` 自动生效——`@antfu/eslint-config` 会读取 `.gitignore`。务必记住两点：flat config 的忽略模式**必须带 `/**`** 才会连目录内容一起忽略（只写目录名不生效），并且**不要加前导斜杠**（`/data/**` 不会被归一化，反而匹配不到任何文件）。另：根目录 `assets/`（62 个压缩产物 / 约 2.5MB）是历史某次 `deploy` 提交误跟踪进仓库的构建产物，已补 `.gitignore` 并用 `git rm -r --cached` 退出索引（**文件仍在磁盘**）；修之前 `pnpm lint` 会去「修复」这些产物并报出 21.6 万条错误。

---

*（本文基于当前源码整理，随功能更新请同步维护。）*
*（内容由AI生成，仅供参考）*
