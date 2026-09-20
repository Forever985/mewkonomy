---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 08e8c4f3f93cfbfc76cce2af531ed943_4bb80ba7af6511f188ac525400dcc5b3
    ReservedCode1: auz4dcaW7ZSLRKrW7g+SKs0hJoQ0uKVQHDl1E+pSwdiir65wLb7b6bOEWcxuq6vd92CLQjYEjrRVedTkCoOaNk5lKu5pUIXyV7HxGzxDEOkVHjAacPECNAqtIAaB1bvrOkb4jl97u/0tral4jSmHXL17QQMybct2nziQebqGHJ6YUIzNXOHcocA+u1k=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 08e8c4f3f93cfbfc76cce2af531ed943_4bb80ba7af6511f188ac525400dcc5b3
    ReservedCode2: auz4dcaW7ZSLRKrW7g+SKs0hJoQ0uKVQHDl1E+pSwdiir65wLb7b6bOEWcxuq6vd92CLQjYEjrRVedTkCoOaNk5lKu5pUIXyV7HxGzxDEOkVHjAacPECNAqtIAaB1bvrOkb4jl97u/0tral4jSmHXL17QQMybct2nziQebqGHJ6YUIzNXOHcocA+u1k=
---

# MewKonomy 未来 AI 接手上下文（AI_CONTEXT）

> 本文档面向**未来接手本项目的 AI 助手**：目标是在最小阅读量下恢复完整认知并直接动手。
> 整合自 [MILKONOMY_PROJECT_CONTEXT.md](./MILKONOMY_PROJECT_CONTEXT.md)（运行背景）与
> [REUSABLE_ABSTRACTION_MODULES.md](./REUSABLE_ABSTRACTION_MODULES.md)（可复用模块）的精华，
> 并补充当前进度、待办、踩坑与决策约束。信息密度优先，可按需回读上述两文。

---

## 1. 一句话定位

Milky Way Idle 玩家自用的**利润计算工具**：纯前端 SPA、无后端、无账号；Vue 3.5 + Vite 6 + TS 5.7 + Element Plus + Pinia + vue-i18n；hash 路由；数据来自 `public/data/data.json`（静态游戏数据，**严禁改动**）与 `market.json`（市场快照 `{market:{名:{ask,bid,vendor}}, time}`）。

## 2. 关键决策约束（用户偏好，最高优先级）

1. **纯本地自用、不部署、不商用**：默认 `pnpm dev` 运行 + 直接改源码自用，**不提交远程**。部署脚本只是为公开版预留，非日常流程。
2. **最反感绕路/重复读全项目**：接手时先读本文件 + 两篇既有文档，不要从头通读整个仓库；需求不明时直接问，别猜。
3. **复用既有体系，不重造**：新功能优先复用 `Calculator/Workflow/Transmute` 计算体系、`chainbuilder/manualchemy` 页面结构、`private.ts` 路由模板。
4. **新功能独立页 + 小批量改动**：按「`src/common/apis` 建聚合 API + `src/pages` 建页面 + 路由注册 + 多语言追加」的局部 read/edit 模式做，不派发大文件整体重写。
5. **严禁改动 `public/data`**（含硬上限）。所有改动需过 `npx vue-tsc --noEmit`。

## 3. 项目状态快照

- 项目原名 Milkonomy → 已改名 **MewKonomy**（package.json name / title / 仓库名均改）。
- 税率为 5%；强化默认目标等级 +10。
- **已建页面清单**（按路由）：
  - 公开页：`dashboard`（首页/玩家配置，含检索）、`enhancer`（强化计算）、`enhanposer`（强化分解）、`sponsor`（打赏）、`/link`（外部链接）。
  - 私有页（`private.ts` 的 `PRIVATE_ROUTES_START/END` 之间）：`enhancest`（超级强化计算）、`enhanposest`（超级强化分解）、打野工具组（`jungle`/`junglest`/`junglerit`/`inherit`/`decompose`/`pickout`）、`manualchemy`（制作炼金）、`chainbuilder`（手动产业链）、`charmtransform`（护符转化盈利）、`marketvolume`（市场监控）、`demo`。
  - 历史下线：英灵殿/埋骨地（`burial`/`valhalla`）**路由与词条已清理，但 `src/pages/burial`、`src/pages/valhalla` 目录文件仍残留、未路由**——可清理的候选。
- **测试清单**（`tests/`，vitest + happy-dom）：`bigset-c-verify`、`chainbuilder-verify`、`charmtransform-verify`、`cross-project-tail-verify`（+`extended`）、`handle-best-per-item`、`marketvolume-cache`、`marketvolume-verify`、`marketvolume-history`（4 用例，`vi.resetModules` 重建模块）、`demo`、`components/Notify`、`utils/validate`。

## 4. 核心架构速记

- **Vite 别名**：`@`=src、`@@`=src/common、`~`=src/types（如 `~/game`）。
- **构建模式**：`VITE_BUILD_MODE` = public/private/staging，仅影响 title、`VITE_PUBLIC_PATH`、console 移除。`pnpm dev` 走 private；`build:public` 设 `VITE_PUBLIC_PATH=/mewkonomy/`。
- **价格语义**：`PriceStatus.ASK`=左挂单(ask)、`BID`=右收购(bid)。全局硬规则：**材料/成本 ask、成品/收益 bid**；`EnhanceCalculator.productPriceType` 可局部切换成品计价（默认 bid），但**不覆盖基类 `productListWithPrice`（详情弹窗等多阶段汇总仍固定 bid）**。
- **缓存**：Pinia store 的 `*Cache` 字段按 `marketData.timestamp` + 计算模式分桶存 localStorage；`fetchData/tryFetchData` 集中调 `clearAllCaches()`；`useXxxStoreOutside` 可组件外直连。
- **计算器**：扁平 `src/calculator/*.ts`，基类 `Calculator` + `WorkflowCalculator` 聚合，`CLASS_MAP` 序列化。
- **API**：各域 `src/common/apis/<domain>/index.ts`（game/price/player/favorite/leaderboard/manualchemy/chainbuilder/charmtransform/enhanposer/jungle/marketvolume）；通用检索在 `src/common/apis/utils.ts` `handleSearch`（banEquipment/banJewelry/banCombat/banLife、conditions 组合、等级/利润率/风险双头、steps 精确步数）。
  - `marketvolume/history.ts`（市场历史采样）：`MarketPriceSample`（`{t, p:{hrid:{level:[ask,bid,volume]}}}`）；**双通道历史**——服务端归档 `gh-pages:data/market_history.json`（**7 天滚动**、上限 520 点，页面按 `<BASE_URL>data/market_history.json` 拉取）＋ 本地 `localStorage` 兜底（key `mewkonomy-market-history`，节流 30min、上限 200 条、同样 7 天窗口），两者合并后按 `t` 升序；`getMarketChangeMap(list, windowHours, metric, now)` 以「时间窗起点前最近采样」为基准，key=`hrid|level`。**两种采样长度都要兼容**（旧 `[ask,price]` / 新 `[ask,bid,volume]`），取值一律走内部 `valueAt()` / `priceOf()`，不要直接下标（`price` 口径取 ask/bid **中点**，因为 index 1 在新旧格式里含义不同）。`metric` 可选 `price`（ask/bid 中点）/`ask`/`bid`/`volume`；volume 是**当日累计成交量**，所以比的是**增量速率**，跨 UTC 归零（负增量）时该项不出现。时间相关函数都接受显式 `now` 参数，便于确定性测试。
- **数据流水线（线上站点如何持续拿到数据）**：全靠 GitHub Actions 写 `gh-pages` 的 `data/`，**不需要本地挂机**：

  | workflow | 频率 | 职责 |
  | --- | --- | --- |
  | `market-history.yml` → `scripts/sample_market_history.py` | **每小时第 5 分钟**（`5 * * * *`）+ 手动；`concurrency: market-history-sampling` 不并发 | 抓官方 `marketplace.json`，追加 `market_history.json` 采样点（7 天滚动、约 520 点）。只依赖官方端点（约 0.4s），**与游戏数据抓取完全解耦** |
  | `update-data.yml` → `scripts/fetch_game_data.py` | **每天 1 次**（`20 0 * * *`，游戏数据只在版本更新时变化，原先每小时纯属浪费配额） | 抓上游 `data.json`/`market.json`，带**多源回退**与**禁止降级护栏** |

  - **部署安全红线（共享目录）**：`gh-pages:data/` 由多个脚本共享写入，`sample_market_history.py` **只拥有** `market_history.json`，`fetch_game_data.py` **只拥有** `data.json`/`market.json`。两者都只把自己的文件复制进 gh-pages 的全新克隆后提交，**严禁 `rmtree` + `copytree` 整个 `data/`**——早期采样脚本用 `public/data` 整目录替换，删掉了线上 4MB `data.json` 与 70KB `market.json`（commit `93f0107`）。两脚本都调用 `assert_no_unintended_deletions()`，`git status` 出现非自己负责的删除即中止部署。CI 先检出 `gh-pages`（线上数据在 `./data/`），再 `git checkout main -- scripts/<file>` 取脚本。
  - **禁止降级护栏**：抓到 `versionTimestamp` 比线上更旧的 data.json 时直接拒绝写入。历史教训：上游 `silent1b/MWIData` 已停在 `v1.20250818.0`（2025-08 后未再更新），而线上是 `v1.20260309.0`，旧的「哈希不同就覆盖」策略会用**旧数据反向覆盖线上新数据**。`version_stamp_of()` 依次取 `versionTimestamp`/`currentTimestamp`/`time`，epoch 数字补零到 20 位（保证字典序 == 时间序）；任一侧取不到版本戳时保守放行，不阻塞正常刷新。
  - **market.json 体积护栏**：该文件正常只有几十 KB，若某源返回 3MB 级载荷（上游仓库结构变化时会发生）直接拒绝；`data.json` 则必须含 `itemDetailMap`，否则跳过该源。
  - **多源回退**：`DATA_SOURCES` 依次尝试 **jsDelivr CDN**（`cdn.jsdelivr.net/gh/...`，约 25~35 秒）→ **ghproxy**（`ghproxy.net/...`，约 35 秒）→ **`raw.githubusercontent.com`**（本网络下取 3MB 级文件要 270~290 秒甚至超时，仅作最后兜底）；`HTTP_TIMEOUT = 120`、`RETRY_TOTAL = 3`。每个源都过上面的结构校验，不合格即跳过。
  - **官方快照实测是 1 小时粒度**：`marketplace.json` 顶层 `timestamp` 是快照自身的生成时间，实测整点、每小时才前进一次（连测 18 分钟同一值不变）。因此「市场历史」的有效分辨率就是 1 小时，跑得再密也不会多出采样点。cron 仍刻意跑得偏频繁作为容错，因为 GitHub 对本仓库的定时任务实测会延迟 2~4 倍（update-data 声明每小时时实际间隔 111~278 分钟），被延迟或跳过时同小时内的其它运行仍能补上。采样脚本另有两道护栏：官方快照物品数为 0 时放弃本次采样（绝不用空快照覆盖 7 天历史）；采样时间戳与线上最后一点相同时跳过。
- **入口挂载门控与失败回退（game store）**：`main.ts` 等 `tryFetchData().then(router.isReady)` 才 `mount`。`tryFetchData` 用 **`success` 标志**（**勿用 `retryCount===0`，循环后恒 -1 为死代码**）；全部重试失败时若已有 `gameData`+`marketData` 则**回退使用缓存**，仅完全无数据才抛「强制宕机」；`fetchData` 的 `Promise.all` 带 **15s `AbortController` 超时**。

## 5. 已知待办与未完成项

- [ ] **强化分解详情弹窗价格口径**：`productPriceType` 仅切换了强化成品的独立计价源；基类 `productListWithPrice` 仍固定 bid，多阶段详情弹窗不会随之切换（如需需另行扩展）。
- [ ] **`src/pages/burial`、`src/pages/valhalla` 残留目录**：已无路由引用，属死代码，可择机清理（清理前确认无被 import 引用）。
- [ ] **README 仍为原作者「停止维护」声明**：本地 fork 继续维护，README 未更新。
- [ ] 迷宫/卷轴：`data.json`（gameVersion v1.20250818.0）**无迷宫玩法**；唯一「卷轴」为 Bishop's Scroll（用于制作 Bishop's Codex），已正常参与利润计算——**无需为此开发新功能**。

## 6. 易踩坑点（务必先看）

1. **缓存导致「成交量全 0」**：marketvolume 的成交量来自市场缓存 `volume` 字段。旧结构缓存（只有 ask/bid 无 volume）会被判过期并清除；若页面异常为全 0，先确认是数据刷新问题还是 localStorage 旧缓存残留（`game-market-data` key），必要时清站点缓存。**任何改缓存结构的改动都要做旧缓存兼容**（参照 `marketvolume-cache.test.ts`）。
2. **缓存按 timestamp+模式分桶，非简单列表缓存**：新增/变更计算模式参数（`noDecompose`、`priceType`、`banCombat` 等）后必须 `clearXxxCache()` 重建，否则读到旧结果。`*Cache` 字段定义处与 `fetchData` 调用点相隔较远，通读时要把两者对照。
3. **vue-tsc 报错先排查残留调试产物**：仓库根目录若有临时调试脚本/文件（如 `vitest-out*.txt`、`temp_market.json`、`dev-server.log` 等）参与扫描会触发误报，`vue-tsc --noEmit` 失败时先清理这些再定位真实类型错误。
4. **工匠茶符号**：工匠茶 buff（`/buff_types/action_level`，flatBoost=5）对行动等级是 **+5**（曾误写为 `-=`），勾选后「要求等级」+5 并标红。
5. **负利润不过滤**：`enhanposer`/`enhanposest` 已移除 `!enhancer.profitable` 预筛——**负利润方案也会输出**，勿再「修复」为过滤。
6. **兜底价**：`getPriceOf` 对市场完全无记录的物品（如 back 披风）用 `item.sellPrice` 兜底 ask/bid——查不到价≠无价，可能是兜底显示。
7. **非安全隔离**：路由/页面始终全部打包，私有页只是隐藏 + 守卫；`checkSecret()` 恒 true，**别把敏感逻辑放在前端**。
8. **市场监控涨跌依赖历史采样**：涨跌列 = 当前值 vs「时间窗起点前最近采样」，无历史（未采样且无服务端归档）时显示 `--` 属正常，不是 bug。本地兜底节流 30min、上限 200 条、7 天窗口；线上（GitHub Pages）另有服务端 `data/market_history.json` 归档（同样 7 天、最多 520 点，约每小时一点）。页面可选时间窗 `1/3/6/12/24/72/168` 小时，对比口径 `price/ask/bid/volume`。改采样结构需兼容旧 `mewkonomy-market-history` 缓存。
9. **入口挂载与外部数据源**：主界面空白多为外部 `marketplace.json` 不可达且无本地缓存。`tryFetchData` 已用 `success` 标志 + 缓存回退 + 15s 超时兜底；**不要改回 `retryCount===0` 判断**（死代码）。

## 7. 常规工作流（AI 接手后）

1. 先读本文件 → 必要时回读 `MILKONOMY_PROJECT_CONTEXT.md`（历史改动/代码地图）与 `REUSABLE_ABSTRACTION_MODULES.md`（可复用模块）。
2. 改代码走小批量：`apis` 聚合 → 页面 → `private.ts` 注册 → 双语言 key。
3. 本地验证：`pnpm dev` 手测 → `pnpm test`（相关 verify）→ `npx vue-tsc --noEmit`。
4. 改动完成后同步更新上述三篇 docs 文档。
5. 需要发布公开版才走 `deploy.ps1` / `sync-fast.ps1`（纯静态文件变更才用后者）。

---

*（本文档为 AI 接手上下文，随项目演进持续更新。）*
*（内容由AI生成，仅供参考）*
