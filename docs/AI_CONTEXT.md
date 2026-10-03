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
- **市场税率为 4%**（2026/9/28 由 5% 下调，权威来源见 §9）；强化默认目标等级 +10。
- **已建页面清单**（按路由，2026-10-01 逐目录实测校正）：
  - `src/router/routes/public.ts` **只有 4 组路由**：`/redirect/:path(.*)`、`/403`、`/404`（别名 `/:pathMatch(.*)*`）、`/link`（5 条外链）。**所有业务页都已收敛到 `private.ts`**——包括 dashboard / enhancer / enhanposer / sponsor。
  - 私有页（`private.ts` 的 `PRIVATE_ROUTES_START/END` 之间，六大分组）：利润检索（`/dashboard`、`/marketvolume`、`/docs`、`/sponsor`）、强化（`/enhancer`、`/enhancest`、`/enhanceexp`）、强化分解（`/enhanposer`、`/enhanposest`）、生产炼金（`/manualchemy`、`/chainbuilder`、`/charmtransform`）、打野（`/jungle`、`/junglest`、`/junglerit`、`/inherit`、`/decompose`、`/pickout`）、`/demo/**`（hidden）。
  - `src/pages/` 实有 **18 个一级目录，全部有路由引用**，无「未挂路由」的业务目录。
  - 历史下线：英灵殿/埋骨地（`burial`/`valhalla`）——路由、词条与 **`src/pages/burial`、`src/pages/valhalla` 目录均已清理完毕**（2026-10-01 复核：两目录不存在）。仅 `common/config/announcement.ts`、`common/config/freeze.ts` 驱动的旧公告文案里还提到「英灵殿」，属历史文案，且 `freezeConfig` 的有效期是 2025-10-28 ~ 2025-11-04，当前不生效。
- **测试清单**（`tests/`，vitest + happy-dom）：**实测 30 个测试文件 / 182 个用例，全绿**（2026-10-03）。其中市场监控相关占 12 个（`marketvolume-cache`、`-history`、`-history-format`、`-rolling-volume`、`-shard`、`-sort`、`-tiers`、`-verify`、`-volume-rate`，以及提醒的 `-alerts`（21 用例）与 `-alerts-integration`（6 用例）、筛选/收藏/过滤设置的 `-filters`（30 用例））；另有 `price-status-tiers`（7 用例，价格档位口径）、`price-solve`（9 用例，目标时薪反解）、`profit-form`（9 用例，**填表计算利润**：手算样例 + 默认值必须复现计算器 + 动作枚举闭环）、`ban-filter-independence`（2 用例，三开关独立）；其余为 `artisan-tea-level-bonus`、`bigset-c-verify`、`chainbuilder-verify`、`charmtransform-verify`、`condition-level-range`、`cross-project-tail-verify`（+`extended`）、`enhanceexp-profitable`、`handle-best-per-item`、`price-fallback-verify`、`search-panel-checkbox`、`sort-priority`、`demo`、`components/Notify`、`utils/validate`。
  - ⚠️ 跑全量测试时若看到 `Test Files` 数量**少于磁盘上的文件数**、且伴随 `Unhandled Error: EPERM ... open '<TEMP>\...\web\<hash>'`，那是运行器往临时目录写缓存被拒（沙箱限制），会**静默丢掉一整个测试文件**（vitest 自己也会警告 "This might cause false positive tests"）。此时把 `TEMP`/`TMPDIR` 指到工程内可写目录再跑即可恢复。**看到 `Errors 1 error` 就不要只信 `Test Files xx passed`。**

## 4. 核心架构速记

- **Vite 别名**：`@`=src、`@@`=src/common、`~`=src/types（如 `~/game`）。
- **构建模式**：`VITE_BUILD_MODE` = public/private/staging，仅影响 title、`VITE_PUBLIC_PATH`、console 移除。`pnpm dev` 走 private；`build:public` 设 `VITE_PUBLIC_PATH=/mewkonomy/`。
- **价格语义**：`PriceStatus.ASK`=左挂单(ask)、`BID`=右收购(bid)；**共 6 个档位口径** = 左/右 ×（`-` / 原价 / `+`）：`ASK_LOW`(左价-)、`ASK`(左价)、`ASK_HIGH`(左价+)、`BID_LOW`(右价-)、`BID`(右价)、`BID_HIGH`(右价+)。「一档」是**百分比增量**（标准 0.366%、强化 ×5 ≈ 1.83%），见 §9.3 / §12。全局硬规则：**材料/成本 ask、成品/收益 bid**；`EnhanceCalculator.productPriceType` 可局部切换成品计价（默认 bid），但**不覆盖基类 `productListWithPrice`（详情弹窗等多阶段汇总仍固定 bid）**。**税率统一取 `@@/constants/market` 的 `MARKET_TAX_FACTOR`，不要再写死 0.95/0.98。**
- **缓存**：Pinia store 的 `*Cache` 字段按 `marketData.timestamp` + 计算模式分桶存 localStorage；`fetchData/tryFetchData` 集中调 `clearAllCaches()`；`useXxxStoreOutside` 可组件外直连。
- **计算器**：扁平 `src/calculator/*.ts`，基类 `Calculator` + `WorkflowCalculator` 聚合，`CLASS_MAP` 序列化。
- **API**：各域 `src/common/apis/<domain>/index.ts`（game/price/player/favorite/leaderboard/manualchemy/chainbuilder/charmtransform/enhanposer/jungle/marketvolume）；通用检索在 `src/common/apis/utils.ts` `handleSearch`（banEquipment/banJewelry/banCombat/banLife、conditions 组合、等级/利润率/风险双头、steps 精确步数）。
  - `marketvolume/history.ts`（市场历史采样）：`MarketPriceSample`（`{t, p:{hrid:{level:[ask,bid,volume]}}}`）；**双通道历史**——服务端归档 `gh-pages:data/market_history_<UTC日>T<HH>.json`（**v2 字典编码 + UTC 6 小时分片**，滚动保留 7 天 / 168 点；页面用 `shardKeysForWindow()` **按窗口只拉 1~2 片**，一片都没取到才回退读 v1 单文件 `market_history.json`）＋ 本地 `localStorage` 兜底（key `mewkonomy-market-history`，节流 30min、上限 200 条、同样 7 天窗口），两者合并后按 `t` 升序；`getMarketChangeMap(list, windowHours, metric, now)` 以「时间窗起点前最近采样」为基准，key=`hrid|level`。**两种采样长度都要兼容**（旧 `[ask,price]` / 新 `[ask,bid,volume]`），取值一律走内部 `valueAt()` / `priceOf()`，不要直接下标（`price` 口径取 ask/bid **中点**，因为 index 1 在新旧格式里含义不同）。`metric` 可选 `price`（ask/bid 中点）/`ask`/`bid`/`volume`；volume 是**当日累计成交量**，所以比的是**增量速率**，跨 UTC 归零（负增量）时该项不出现。时间相关函数都接受显式 `now` 参数，便于确定性测试。
- **市场监控的三个可选增强（2026-10-02 新增，见 §10 / §11）**：
  - **市场提醒**：`marketvolume/alerts.ts`（**纯函数**规则模型与评估）＋ `pinia/stores/alert.ts`（独立持久化配置）＋ 市场监控页 UI ＋ 「设置 - 市场提醒」分组。规则 = 范围（全部/分类/指定物品）× 指标（价格/涨跌/速率/滚动量/成交额…）× 方向（gte/lte）× 判定（**绝对值 或 相对排行 topN/均值倍数/中位数倍数**），每条规则**独立开关 + 优先级 + 冷却**。
  - **区间筛选**：`marketvolume/filters.ts`（**纯函数**）＋ `common/components/RangeFilter/index.vue`（可复用控件，5 个指标各一个）。语义：`≥`/`≤`/`区间` **一律含端点**；阈值留空 = 该条件不生效；值缺失的条目在条件启用时不匹配。
  - **收藏**：`pinia/stores/marketfavorite.ts`，按 **(物品, 市场档位)** 粒度（行 key `hrid|level`）。**不要**复用 `favorite.ts`（那是生产配方）或 `enhancer.favorite`（那是装备 hrid）。
  - **隐藏小成交量（持久设置）**：`pinia/stores/marketfilter.ts`（`{ hideLowVolume, minVolume }`，key `market-filter-config`，默认**关闭**、阈值 100）。设置面板与市场监控页读写**同一份 store 状态**，改哪边都同步。取值口径与该页「成交量」列一致（`rangeValueOf(item, "volume")`）。
  - **排除开关的独立性（重要，见 §13）**：检索侧的 `banEquipment` / `banJewelry` / `banCharm` 是**三个互相独立**的开关，`banEquipment` **既不吞并首饰也不吞并护符**。改这三者中任何一个前先读 §13 与 `tests/ban-filter-independence.test.ts`。
  - **行 key 的规范定义在 `marketvolume/keys.ts`（零依赖）**，不是 `marketvolume/index.ts`——后者会 `import` `@/common/apis/game`，详见 §6 坑点 11。
- **数据流水线（线上站点如何持续拿到数据）**：全靠 GitHub Actions 写 `gh-pages` 的 `data/`，**不需要本地挂机**：

  | workflow | 频率 | 职责 |
  | --- | --- | --- |
  | `market-history.yml` → `scripts/sample_market_history.py` | **外部定时器（cron-job.org）每小时打 `workflow_dispatch`**；`cron: "5 * * * *"` 仅作兜底；`concurrency: market-history-sampling` 不并发 | 抓官方 `marketplace.json`，写入 **v2 分片** `market_history_<UTC日>T<HH>.json`（UTC 6 小时一块、字典编码、滚动 7 天）。只依赖官方端点（约 0.4s），**与游戏数据抓取完全解耦** |
  | `update-data.yml` → `scripts/fetch_game_data.py` | **每天 1 次**（`20 0 * * *`，游戏数据只在版本更新时变化，原先每小时纯属浪费配额） | 抓上游 `data.json`/`market.json`，带**多源回退**与**禁止降级护栏** |

  - **部署安全红线（共享目录）**：`gh-pages:data/` 由多个脚本共享写入，`sample_market_history.py` **只拥有** `market_history_*.json`（v2 分片）与遗留的 `market_history.json`（v1），`fetch_game_data.py` **只拥有** `data.json`/`market.json`。两者都只把自己的文件复制进 gh-pages 的全新克隆后提交，**严禁 `rmtree` + `copytree` 整个 `data/`**——早期采样脚本用 `public/data` 整目录替换，删掉了线上 4MB `data.json` 与 70KB `market.json`（commit `93f0107`）。两脚本都调用 `assert_no_unintended_deletions()`，`git status` 出现非自己负责的删除即中止部署。CI 先检出 `gh-pages`（线上数据在 `./data/`），再 `git checkout main -- scripts/<file>` 取脚本。
  - **禁止降级护栏**：抓到 `versionTimestamp` 比线上更旧的 data.json 时直接拒绝写入。历史教训：上游 `silent1b/MWIData` 已停在 `v1.20250818.0`（2025-08 后未再更新），而线上是 `v1.20260309.0`，旧的「哈希不同就覆盖」策略会用**旧数据反向覆盖线上新数据**。`version_stamp_of()` 依次取 `versionTimestamp`/`currentTimestamp`/`time`，epoch 数字补零到 20 位（保证字典序 == 时间序）；任一侧取不到版本戳时保守放行，不阻塞正常刷新。
  - **market.json 体积护栏**：该文件正常只有几十 KB，若某源返回 3MB 级载荷（上游仓库结构变化时会发生）直接拒绝；`data.json` 则必须含 `itemDetailMap`，否则跳过该源。
  - **多源回退**：`DATA_SOURCES` 依次尝试 **jsDelivr CDN**（`cdn.jsdelivr.net/gh/...`，约 25~35 秒）→ **ghproxy**（`ghproxy.net/...`，约 35 秒）→ **`raw.githubusercontent.com`**（本网络下取 3MB 级文件要 270~290 秒甚至超时，仅作最后兜底）；`HTTP_TIMEOUT = 120`、`RETRY_TOTAL = 3`。每个源都过上面的结构校验，不合格即跳过。
  - **官方快照实测是 1 小时粒度**：`marketplace.json` 顶层 `timestamp` 是快照自身的生成时间，实测整点、每小时才前进一次（例如 07:06 → 08:06）。因此「市场历史」的有效分辨率就是 1 小时，跑得再密也不会多出采样点（时间戳相同会被去重跳过）。采样脚本另有两道护栏：官方快照物品数为 0 时放弃本次采样（绝不用空快照覆盖 7 天历史）；采样时间戳与线上最后一点相同时跳过。
  - ✅ **2026-10-01 实测：每小时采样确实已生效，但生效起点是 2026-09-26**。证据来自两侧：
    - **数据侧**（下载线上分片统计）：09-25 及以前每天仅 ~5 个采样点、相邻间隔 3~6 小时（= GitHub 自身 `schedule` 被延迟的效果）；09-26 起变密，**09-27 ~ 09-30 连续 4 天每天恰好 24 个采样点、间隔严格 60 分钟（整点 `:06`）**。
    - **触发器侧**（`GET /repos/Forever985/mewkonomy/actions/workflows/market-history.yml/runs`）：共 **170 次运行、100% success**；其中 `workflow_dispatch`（= cron-job.org 打的）**117 次**、`schedule`（GitHub 自带）53 次。`workflow_dispatch` 的时间线：09-20 试了 3 次（07:47 / 08:01 / 08:55，属手动测试）→ **断了整整 6 天**（09-20T08:55 → 09-26T09:19）→ **自 2026-09-26T09:19 恢复，并从 10:00 起严格每小时整点触发；此后 112 次相邻间隔全部为 60 分钟、无缺口**。
    两侧完全吻合，且 `main` 在该时点没有代码提交 → 确认是**外部触发器（cron-job.org）在 09-26 才真正稳定生效**，并非代码改动。
    ⚠️ **风险（值得改进）**：09-20~09-26 那次 6 天断档，GitHub 侧**全部 success、没有任何失败告警**；数据只是从 24 点/天退化成 ~5 点/天（GitHub 自带 cron 仍在兜底），所以极难被发现。若要守住「每小时」这条 SLA，建议加一个健康检查：定时检查 `market_history_*.json` 最新采样点的年龄，超过 N 小时就让 workflow 失败以触发邮件告警。
    结论：服务端归档现在本身就是**真·每小时**，`main.ts` 的 `startMarketAutoSampling()` 只是本地 `localStorage` 兜底，**不再是「唯一能做到每小时」的通道**（旧结论已过期）。
    另：7 天滚动保留也已实测生效——超出窗口的旧片（如 `2026-09-23T18`）返回 404 属预期。
    **端到端验证（2026-10-01，用真实线上分片驱动真实模块）**：`loadMarketHistory(6)` 实际只拉了 3 片（`2026-09-30T12` / `T18` / `2026-10-01T00`）共 **14 个样本，相邻间隔全部 60 分钟**；`getMarketChangeMap` 对 500 个条目在 `price` 口径下返回 **495 条有基准、154 条非零涨跌**（如 `/items/advanced_alchemy_charm|3` 60,000,000 → 65,000,000 = +8.33%）。**1 小时窗口能出满 500 条**（旧稀疏时期会大量显示 `--`）；切到 24h 时页面会再调一次 `loadMarketHistory(24)` 按需补拉，24h 窗口随即有 485 条。即：这条链路是**真在用**，不是「有数据没人读」。
- **入口挂载门控与失败回退（game store）**：`main.ts` 等 `tryFetchData().then(router.isReady)` 才 `mount`。`tryFetchData` 用 **`success` 标志**（**勿用 `retryCount===0`，循环后恒 -1 为死代码**）；全部重试失败时若已有 `gameData`+`marketData` 则**回退使用缓存**，仅完全无数据才抛「强制宕机」；`fetchData` 的 `Promise.all` 带 **15s `AbortController` 超时**。

## 5. 已知待办与未完成项

- [ ] **强化分解详情弹窗价格口径**：`productPriceType` 仅切换了强化成品的独立计价源；基类 `productListWithPrice` 仍固定 bid，多阶段详情弹窗不会随之切换（如需需另行扩展）。
- [x] ~~`src/pages/burial`、`src/pages/valhalla` 残留目录~~ → 2026-10-01 复核：**两目录均已不存在**，此项作废。
- [x] ~~README 仍为原作者「停止维护」声明~~ → 2026-10-01 已更新为 fork 维护说明。
- [ ] **迷宫结论已过期（重要）**：`data.json` 现为 **`v1.20260309.0`**，**已含迷宫数据**（4 件物品 + 2 个分类，详见 §8.3）。原「无迷宫玩法、无需开发」的判断基于旧版数据，**不可再据此回答用户**；是否开发迷宫相关计算，需先确认游戏机制。
- [ ] **`pages/enhanceexp/index.vue` 的 `setPrice` 是死代码**：价格弹窗 `ActionPrice` 存在但没有任何入口调用 `setPrice`，当前不可达（详见 §8.2）。
- [ ] **根目录与 `public/` 的重复静态副本**（`data/`、`sprites/`、`media/`、`app-loading.css`、`detect-ie.js`、`favicon.jpg`）尚未清理（详见 §8.5）。
- [ ] 卷轴：唯一「卷轴」为 Bishop's Scroll（用于制作 Bishop's Codex），本就有市场价、已正常参与利润计算——**无需为此开发新功能**。
- [ ] **zh-tw 语言包系统性缺口（既有问题，非本轮引入）**：`src/**` 引用的 190 个字面量 key 中，`en` 覆盖 **190/190（零缺失）**，而 `zh-tw` 只覆盖 **76/190（缺 114 个）**——缺的集中在**设置面板/布局类 UI 文案**（`显示标签栏`、`设置`、`主题`、`首页`、`确定`、`取消`…），繁体用户在这些位置会看到简体原文。本轮新增的提醒文案已全部补齐（并顺手补了 `确定`/`取消`）。**要做的是成批补齐 zh-tw，而不是遇到一个补一个。**
- [ ] **提醒功能未覆盖的场景**：提醒只在**市场监控页打开时**评估（项目无后端，无法后台常驻）；若日后要「任意页面都提醒」，需把规则与评估下沉到 store/API 层并挂到 `main.ts` 的 60s 轮询上（见 §10.4）。
- [ ] **收藏未做「置顶」**：当前只有星标 + 「只看收藏」过滤，收藏项**不会**在默认排序里浮到最前。若要做，需与 `sortMarketVolumeRows` 组合（收藏优先 + 组内保持原排序），注意别破坏既有的表头点击排序语义（见 §4 `sortKey` 那段注释）。
- [ ] **区间筛选未持久化**：`ranges` 与「只看收藏」都是视图状态、不落盘（与既有的 `onlyActive`/关键词一致）。若希望刷新后保留，需另建一个配置型 store（照 `alert.ts` 的写法）。
- [ ] **`PriceStatusSelect` 有两个副本、内容完全相同**（仅行尾不同）：`common/components/PriceStatusSelect/index.vue` 与 `pages/dashboard/components/PriceStatusSelect.vue`。前者被 charmtransform / enhanceexp / enhanposer / enhanposest / dashboard 引用，后者没有任何引用（死文件）。这是典型的重复收敛机会（该文件只有 34 行，两边都读同一份 `PRICE_STATUS_LIST`）。清理前先确认 dashboard 的 import 指向的是哪一个。
- [ ] **`manualchemy` 仍缺「排除战斗装备 / 排除生活装备」**：本轮按用户要求只给它补了「排除首饰 / 排除护符」。它的 `searchData` 里连 `banCombat` / `banLife` 键都没有（`handleSearch` 读到 undefined 即不生效），要补是两行配置的事，但属另一件事，未擅自扩范围。
- [ ] **「隐藏小成交量」按 (物品×档位) 逐行判定**：实测官方快照 2944 条里，阈值 100 只保留 265 条（隐藏 2679 条）。因为多数强化档本身几乎不成交，这个粒度会把同一件装备的低档位也一并藏掉。若要「按物品聚合后的总量」判定，需先按 hrid 汇总再筛，属另一个需求。

## 6. 易踩坑点（务必先看）

1. **缓存导致「成交量全 0」**：marketvolume 的成交量来自市场缓存 `volume` 字段。旧结构缓存（只有 ask/bid 无 volume）会被判过期并清除；若页面异常为全 0，先确认是数据刷新问题还是 localStorage 旧缓存残留（`game-market-data` key），必要时清站点缓存。**任何改缓存结构的改动都要做旧缓存兼容**（参照 `marketvolume-cache.test.ts`）。
2. **缓存按 timestamp+模式分桶，非简单列表缓存**：新增/变更计算模式参数（`noDecompose`、`priceType`、`banCombat` 等）后必须 `clearXxxCache()` 重建，否则读到旧结果。`*Cache` 字段定义处与 `fetchData` 调用点相隔较远，通读时要把两者对照。
3. **vue-tsc 报错先排查残留调试产物**：仓库根目录若有临时调试脚本/文件（如 `vitest-out*.txt`、`temp_market.json`、`dev-server.log` 等）参与扫描会触发误报，`vue-tsc --noEmit` 失败时先清理这些再定位真实类型错误。
4. **工匠茶符号**：工匠茶 buff（`/buff_types/action_level`，flatBoost=5）对行动等级是 **+5**（曾误写为 `-=`），勾选后「要求等级」+5 并标红。
5. **负利润不过滤**：`enhanposer`/`enhanposest` 已移除 `!enhancer.profitable` 预筛——**负利润方案也会输出**，勿再「修复」为过滤。
6. **兜底价**：`getPriceOf` 对市场完全无记录的物品（如 back 披风）用 `item.sellPrice` 兜底 ask/bid——查不到价≠无价，可能是兜底显示。
7. **非安全隔离**：路由/页面始终全部打包，私有页只是隐藏 + 守卫；`checkSecret()` 恒 true，**别把敏感逻辑放在前端**。
8. **市场监控涨跌依赖历史采样**：涨跌列 = 当前值 vs「时间窗起点前最近采样」，无历史（未采样且无服务端归档）时显示 `--` 属正常，不是 bug。本地兜底节流 30min、上限 200 条、7 天窗口；线上（GitHub Pages）另有服务端 **v2 分片** `data/market_history_<UTC日>T<HH>.json` 归档（7 天滚动；**2026-10-01 实测已是真·每小时（每天 24 点），生效起点为 2026-09-26**）。页面可选时间窗 `1/3/6/12/24/72/168` 小时，对比口径 `price/ask/bid/volume`。改采样结构需兼容旧 `mewkonomy-market-history` 缓存。
9. **入口挂载与外部数据源**：主界面空白多为外部 `marketplace.json` 不可达且无本地缓存。`tryFetchData` 已用 `success` 标志 + 缓存回退 + 15s 超时兜底；**不要改回 `retryCount===0` 判断**（死代码）。
10. **市场提醒的输入列表必须是 `changeApplied`**：用 `all` 会拿到未回填的 `changePct/volumeRate/volumeRolling`（全 null → 永不命中）；页面内提醒关闭时应**连评估一起跳过**。详见 §10.3。
11. **纯工具别从 `common/apis/<域>/index.ts`（barrel）里引**：这些 barrel 会 `import` `@/common/apis/game`，而 game 在**顶层**注册了 `watch(..., { immediate: true })` 去重建全量索引（`initBigSetCache` 等）。只要在"还没数据"的时机导入（**单测里最容易**），就会以 `Cannot read properties of null (reading 'actionDetailMap')` 直接抛错，表现为"一 import 就炸"。所以：
    - 零依赖的纯工具要单独成文件（如 `marketvolume/keys.ts`），需要它的 store / 纯函数模块**直接从该文件引**，不要走 barrel；
    - 测试里若要 **真数据**，顺序必须是「**先写 localStorage → 再建 store → 最后动态 import 数据层**」。静态 import 任何会拉到 game 的模块都会先于播种执行。
12. **给 store 的状态赋值时不要用「展开 reactive 对象」构造新值**：`@/common/apis/game` 的模块级 watch 会做 `structuredClone(toRaw(store.marketData))`，而 `toRaw` **只解顶层**——`{ ...store.marketData }` 这类写法会把嵌套的 reactive 代理对象原样带进新值，于是直接抛 `DataCloneError: #<Object> could not be cloned`。要改市场数据请赋一个**全新字面量**（或先 `toRaw` 再逐层处理），别从 `store.xxx` 上展开。
13. **`git push` 被拒的真因：token 缺 `workflow` scope（不是网络问题）**（2026-10-03 订正）：
    用 API 实测核实 —— `x-oauth-scopes: repo`，**只有 `repo`**。本次推送会改
    `.github/workflows/deploy.yml` / `release.yml`，而 GitHub 对「会新增/修改 workflow 文件」的推送
    硬性要求 token 带 `workflow` 权限，否则直接拒收：
    `! [remote rejected] main -> main (refusing to allow a Personal Access Token to create or update workflow ... without 'workflow' scope)`。
    - **修复**：给该 classic PAT 勾上 `workflow`（https://github.com/settings/tokens → 点开该 token → 勾选 workflow → Update），重推即可，无需重克隆。
    - **易误判点**：同一时刻 `git push` 可能先报 `Recv failure: Connection was reset` / `Empty reply from server`（见第 14 条），
      只有**连上服务器的那一次**才会露出真正的 `remote rejected`。别一看到 reset 就断定「网络不通」。
14. **本机 `github.com` 被 Steam++（Watt Toolkit）改写了 hosts**（2026-10-03 实测）：
    `C:\Windows\System32\drivers\etc\hosts` 里有 **100+ 条 `127.0.0.1 <域名>`**（github / twitch / steam / huggingface / greasyfork …），
    而本机 `443` 的监听者是 **`Steam++.Accelerator.exe`** —— 它把域名指到本机、再在本地反代出去。
    - 反代**本身是通的**：`GET .../info/refs?service=git-receive-pack` 走 hosts 与走真实 IP 都返回 `401`（=需要认证），
      `git push --dry-run` 也能拿到 `200 OK`。所以它只是**偶发抖动**（push 偶尔 `Connection was reset`），不是根因。
    - 想单独验证链路：`curl -I --resolve github.com:443:20.205.243.166 https://github.com`（绕过 hosts 直连真实 IP）。
    - 若推送老是抖：临时退出 Steam++，或关掉它的 GitHub 加速。
15. **凭据助手有两个来源，会弹 GCM 的「CredentialHelperSelector」框**（2026-10-03 实测）：
    `git config --show-origin --get-all credential.helper` 会同时列出
    `system`（WorkBuddy 自带 PortableGit 的 `etc/gitconfig`）= `helper-selector` 与 `global`（`~/.gitconfig`）= `store`。
    `helper-selector` 被调用时**会弹窗**让你选 `<no helper> / manager / wincred` 并**阻塞等待** —— 表现为「push 卡住不动」。
    想让 `~/.git-credentials` 里的 PAT 直接生效、彻底不再弹窗，把列表显式重置为只有 `store`：
    `git config --global --unset-all credential.helper`，然后
    `git config --global --add credential.helper ""`（空值 = 清空从 system 继承来的列表），再
    `git config --global --add credential.helper store`。
    - 提交照常在本地做；推送可交给仓库根目录的 **`一键推送.bat`**（双击即可；flush DNS → **预检待推提交是否触及 `.github/workflows/`** → `git push`，并按日志分类给出 workflow / 网络 / 凭据三种结论）。
    - **本次的实际收尾**：为立刻解除阻塞，把 `.github/workflows/deploy.yml` / `release.yml` 的改动（改用 `secrets.GITHUB_TOKEN`、补 `permissions: contents: write`）**移出了 main**，其余 4 个提交已成功推送（`a1a908a..cd6c552`）。该改动保留在本地分支 **`pending-workflow-sync`**（另有补丁 `workflow-sync.patch`）；等 token 补上 `workflow` 权限后执行 `git push origin pending-workflow-sync:main` 即可落地。
    - 附带发现：仓库里有一个**损坏的 git 对象** —— `assets/vue-8ikB7t_e.js` 的 blob（`git fsck` 报 `missing blob`，`git fetch` 收尾的 `geometric-repack` 会因此报错）。它是历史误提交的构建产物，已被删除出当前树；**旧提交仍引用它**，如需彻底修复得从远端重新取回该对象。

## 7. 常规工作流（AI 接手后）

1. 先读本文件 → 必要时回读 `MILKONOMY_PROJECT_CONTEXT.md`（历史改动/代码地图）与 `REUSABLE_ABSTRACTION_MODULES.md`（可复用模块）。
2. 改代码走小批量：`apis` 聚合 → 页面 → `private.ts` 注册 → 双语言 key。
3. 本地验证：`pnpm dev` 手测 → `pnpm test`（相关 verify）→ `npx vue-tsc --noEmit`。
4. 改动完成后同步更新上述三篇 docs 文档。
5. 需要发布公开版才走 `deploy.ps1` / `sync-fast.ps1`（纯静态文件变更才用后者）。

---

## 8. 仓库卫生与文档一致性修订（2026-10-01）

本节记录一次「打基础」改动：**以源码实测为准**，修掉若干真实缺陷，并修正本套文档里已过期的结论。
接手时若发现代码与该文档仍然对不上，请以代码为准并顺手更新本节。

### 8.1 修掉的真实缺陷

| # | 位置 | 问题 | 处理 |
| --- | --- | --- | --- |
| 1 | 根目录 `assets/`（62 文件 / 约 2.5MB）与 `.vite/deps/` | 某次 `deploy:` 提交（`6bacb36`）**误把构建产物与 Vite 依赖缓存提交进仓库**。它们不被 `index.html` 引用（入口是 `/src/main.ts`），真正的构建输出是 `dist/`。直接后果：`pnpm lint`（= `eslint . --fix`）会去「修复」这些压缩产物并报出 **21.6 万条**错误。 | 补进 `.gitignore`（`/assets/`、`/.vite/`）并 `git rm -r --cached`（**文件保留在磁盘**，只从索引移除） |
| 2 | `eslint.config.js` 的 `ignores` | 原本是空数组。另外 flat config 有两个坑（本次实测）：模式必须带 `/**` 才会忽略目录内容；**不能加前导斜杠**（`/data/**` 在此版本匹配不到任何文件）。 | 改为 `"data/**"`、`"public/data/**"`（`data.json` 约 4MB，属数据非代码）；产物类目录交给 `.gitignore` 自动生效 |
| 3 | `src/pinia/stores/game.ts` `hasVolumeField()` | `return` 写在循环体内，实际只检查「第一个物品的第一个档位」。一旦该条目恰好缺 `volume`，整份**新**缓存会被误判为过期并清除 → 每次进页面都重拉一次市场数据。 | 改为遍历到找到为止 |
| 4 | `apis/{game,player,price}`、`components/Globalization`、`pages/dashboard/components/ManualPriceCard.vue`、`calculator/enhance.ts` | 6 处残留调试 `console.log`，其中 `console.log("buffs", buffs)` 会在每次 buff 重算时打印整个对象；另有 2 行被注释掉的 log。 | 全部移除（`catch` 块里的 `console.error` 保留） |
| 5 | `src/common/apis/utils.ts`、`pages/enhanceexp/index.vue` | 未使用的导入：`getEquipmentTypeOf`、`Plus`、`SortPriority`。 | 移除（`getEquipmentTypeOf` 在其它文件仍在用） |
| 6 | `src/pages/jungle/pickout.vue` | `usePriceStatus(...)` 的返回值未被使用（模板里的 `PriceStatusSelect` 已被注释）。 | **保留调用**——它有 `onBeforeMount` 固定全局价格口径、`onBeforeRouteLeave` 复位的副作用；只去掉未使用的 `const` 绑定 |
| 7 | `.env.staging` | `VITE_PUBLIC_PATH = /milkonomy/` 仍是**改名前的旧路径**，staging 构建会整体 404。 | 改为 `/mewkonomy/` |
| 8 | `.github/workflows/deploy.yml`、`release.yml` | 仍引用自定义 secret `secrets.MILKONOMY`（fork 中并不存在，触发即失败）；`deploy.yml` 还缺少 `permissions: contents: write`。 | 改用 `secrets.GITHUB_TOKEN` 并补 `permissions`，与 `update-data.yml` 的既有做法一致 |

### 8.2 记录在案、但**有意不改**的三处

1. **`SearchPanel` 的 `vue/no-mutating-props`（4 处）**：面板通过 `v-model` 拿到对象型 `modelValue` 后就地改其字段。这是本项目既定的配置驱动写法，11 个检索页都依赖它，改动风险远大于收益。
2. **`pages/enhanceexp/index.vue` 的 `setPrice` 是死代码**：函数与 `ActionPrice` 弹窗都在（`priceVisible` / `currentPriceRow` 被模板使用），但**没有任何入口调用 `setPrice`**，即该价格弹窗当前不可达。这属于「未完成的功能」而非缺陷，接线方式需要产品决策，故未擅自改。
3. **约 300 条 `src/` 与 `tests/` 的排版风格错误**（`perfectionist/sort-imports`、`member-delimiter-style`、`arrow-parens`、`vue/singleline-html-element-content-newline` 等）：**没有跑整体 `eslint --fix`**。原因是 `vue/singleline-html-element-content-newline` 会给模板元素插换行，可能在 `el-tag` 这类行内元素里引入空白文本节点、影响渲染。需要时请按页小批量处理并肉眼复核。

### 8.3 本次修正的文档过期结论（原文已就地更新）

- **页面清单**：`public.ts` 其实只有 4 组路由（`/redirect`、`/403`、`/404`、`/link`）；dashboard / enhancer / enhanposer / sponsor 等业务页**全部**在 `private.ts`。`src/pages/` 18 个一级目录**全部有路由引用**。
- **`burial` / `valhalla`**：目录**早已删除**（原文档记为「仍残留、待清理」）。
- **迷宫（重要）**：`data.json` 已从 `v1.20250818.0` 升到 **`v1.20260309.0`**（948 物品 / 532 件装备），**已含迷宫数据**——`labyrinth_essence`、`labyrinth_token`、`labyrinth_refinement_chest`、`labyrinth_refinement_shard`，以及 `/item_categories/labyrinth`、`/item_categories/dungeon_key`。原「无迷宫玩法、无需开发」的结论**已失效**。
- **市场历史归档**：已从 v1 单文件升级为 **v2 分片**（`market_history_<UTC日>T<HH>.json`，UTC 6 小时一块、字典编码、7 天 / 168 点，按窗口按需拉 1~2 片）。
- **`game.ts` 规模**：**443 行**（`REUSABLE_ABSTRACTION_MODULES.md` 原写「约 1.2 万行」）。
- **测试规模**：**24 个文件 / 100 个用例**（本节审计时的数据；**当前基线见 §3 —— 30 文件 / 182 用例**）。
- **`BUILD_SYSTEM.md`**：原称「构建时排除私有页面文件」，与实现矛盾，已校正为「非安全隔离」（`remove-private-code` 插件整段被注释）。

### 8.4 本次改动后的验证（实测）

```bash
npx vue-tsc --noEmit     # 通过，无输出
npx vitest run           # 24 个测试文件 / 100 个用例，全绿（§8 审计当时；当前见 §3）
npx eslint .             # 仅剩排版类问题（构建产物造成的 21.6 万条误报已消除）
```

### 8.5 仍可继续清理（本次未做，非必要）

- 根目录与 `public/` **重复**的静态副本：`app-loading.css`、`detect-ie.js`、`favicon.jpg`、`data/`（其中 `data/market.json` 还是旧快照）、`sprites/`、`media/`。都是 tracked 的重复文件，理论上可删，但涉及 6MB+ 资源，未擅自处理。
- 根目录三个空壳目录：`gh-pages-restore-temp/`、`_deploy_path_test/`、`_guard_test/`（只含空 `.git`，未被 git 跟踪）。
- `index.html` 里有一段把 `luyh7.github.io` 重定向到 `milkonomy.pages.dev` 的旧域名脚本（原作者遗留，对本 fork 的 `forever985.github.io` 无影响）。

---

## 9. 游戏机制变更记录：2026/9/28「库存优化与其他改动」

游戏在 2026/9/28 的一次小型更新中调整了**市场税率**与**价格档位**，两项都直接影响本项目的计算口径。
本节记下权威来源与由此产生的代码改动，避免后人再被旧文档/旧实测误导。

### 9.1 权威来源（别猜，去读客户端）

- **客户端常量**（`www.milkywayidle.com/static/js/main.<hash>.chunk.js`，2026-10-01 实读）：
  ```js
  var br = { TAX_RATE: .04, COWBELL_TAX_RATE: .18, ... }
  getTaxRate(e) { return e === BagOf10CowbellsItemHrid ? this.COWBELL_TAX_RATE : this.TAX_RATE }
  ```
- **补丁说明内联在同一个 bundle 里**，可直接全文检索，原文三条：
  - 「The standard market tax has been lowered from 5% to 4%.」
  - 「listing prices are now 0.33% to 0.44% apart at every price level, compared to 0.17% to 0.5% previously.」
  - 「Enhanced items (+1 and above) have lower liquidity, so they now use price increments 5x larger (1.67% to 2.22% apart) to avoid excessive undercutting.」
  - 以及「Trading ranges are slightly wider by one price increment on each side.」
- **官方市场快照** `https://www.milkywayidle.com/game_data/marketplace.json`（约 0.3s、244KB）可用来**实测验证**。

> 抓取技巧：本机 git 到 github.com 会被 Windows 证书吊销检查挡住（`CRYPT_E_REVOCATION_OFFLINE`），
> 但 **`curl --ssl-no-revoke` 访问 HTTPS 正常**，验证类查询优先用 curl。

### 9.2 税率 5% → 4%（已修）

- 标准税率 **4%**（原 5%）；另有 `COWBELL_TAX_RATE = 18%`，**仅**作用于
  `/items/bag_of_10_cowbells` 这一件物品，本项目不涉及。
- 客户端结算是**向下取整**：`quantity * Math.floor((1 - taxRate) * price)`；本项目为保持既有价格口径未做 floor。
- ⚠️ **修复前本项目内部并不一致**：计算器按 5%（`0.95`）计，而强化计算 `enhance.ts`、强化页
  `enhancer/index.vue`、超级强化页 `enhancest/index.vue` 按 2%（`0.98` / `MARKET_TAX_PERCENT = 2`）计
  —— 同一个市场两套税率，强化算出来的收益被高估约 3%。
- 现状：统一到新文件 **`src/common/constants/market.ts`** 的 `MARKET_TAX_RATE` / `MARKET_TAX_FACTOR`，
  全部引用点（`calculator/index.ts` ×3、`calculator/enhance.ts` ×1、`pages/enhancer/index.vue` ×2、
  `pages/enhancest/index.vue` ×4）改用它，三语文案里的「2% / 98%」同步为「4% / 96%」。

### 9.3 价格「档位」：原来的粗档位表是错的（已修）

**游戏真实机制**（与项目原先的假设不同）：

- **没有全局固定档位**。每个 **(物品, 强化等级)** 各有一个服务端下发的**交易区间** `[bandMin, bandMax]`
  （客户端字段 `priceBandMins` / `priceBandMaxs`）；输入价只是被 `deriveWorkingPrice` **夹进**该区间，
  超出只给提示（`pegSellNotice` / `pegBuyNotice`）。
- 区间**每 60 分钟校准一次**，每次最多移动 **1%**
  （`recalibrationIntervalMinutes: 60` / `bandMaxMovePerPassFactor: 1.01`）。
- 相邻挂单价间距（= 一档）：**标准 0.33% ~ 0.44%**；**强化物品 5 倍，即 1.67% ~ 2.22%**。

**实测核对**（2026-10-01 官方快照；754 对 0 级、756 对强化档的 ask−bid 价差）：

| 档位 | 实测「一档」 | 补丁声明 |
| --- | --- | --- |
| 标准（level 0） | ≈ **0.366%** | 0.33% ~ 0.44% |
| 强化（level ≥ 1） | ≈ **1.852%** | 1.67% ~ 2.22% |
| 两者比值 | **5.06** | **5×** |

**原实现的问题**：`src/common/apis/game/index.ts` 的 `priceStepOf` 用「按十进制归一化后取 1/2/5/10」
的粗档位表，隐含一档约 **1% ~ 5%**，比真实增量**大 3~10 倍**（例：1000 金时旧实现给 +5%，
真实只有 +0.37%）。该表是上游 Milkonomy 时代留下的，对应更早的「固定增量 2-5%」时期。

**修复**：改为百分比增量（`PRICE_STEP_RATIO = 0.00366`，强化 ×5），并按
「低价物品一档不足 1 金币时保底移动 1 金」处理整数取整；强化与否由 `getPriceOf` 的
`level > 0` 透传给 `convertPriceOfStatus`。因为手上只有 `ask`/`bid` 两个点，
这里用「一档增量」近似表达「压一档 / 抬一档」。

### 9.4 影响面与验证

- 界面「左价−」(`ASK_LOW`) 与「右价+」(`BID_HIGH`) 两个口径的取值会变化 —— 这是**修正**，不是回归。
- 税率下调会让所有利润数值上升约 1%（收入端）。
- 验证：`npx vue-tsc --noEmit` 通过；`npx vitest run` **24 个文件 / 100 用例全绿**（§9 税率那一轮当时；当前见 §3）。

---

## 10. 市场提醒（2026-10-02 新增功能）

### 10.1 需求与已确认的取舍
用户要的是「市场监控能主动提醒」：某物品价格跌破/涨过某值、某产品的涨跌幅、某产品的成交量、以及**交易量过高的产品**。四点设计已与用户对齐：

1. **提醒方式**：**页面内（命中行高亮 + 顶部横幅可展开明细）与浏览器通知两者都要**，且开关/阈值放在「设置」里可调。
2. **生效范围**：仅市场监控页（应用无后端，无法后台常驻；全局化留作后续，见 §10.4）。
3. **规则粒度**：**多条自定义规则，彼此高度解耦**（各自独立开关 / 优先级 / 冷却），不做一组写死的全局阈值。
4. **「量过高」判定**：**绝对值与相对排行都要支持**（相对排行 = 排进前 N / 超过均值或中位数的 k 倍）。

### 10.2 文件与职责

| 文件 | 职责 |
| --- | --- |
| `src/common/apis/marketvolume/alerts.ts` | **纯函数**：规则/命中的类型、`evaluateRule`、`evaluateAlerts`、`evaluateAlertsByRule`、`createPresetRules`、`createEmptyRule`、`metricValueOf`。只 import 类型，**不碰副作用、不碰 i18n**，因此可单独单测。 |
| `src/pinia/stores/alert.ts` | 独立持久化（key `market-alert-config`，带 `version`）：`inPageEnabled` / `notifyEnabled` / `cooldownMinutes` / `thresholds` / `rules`。**不塞进 `layoutsConfig`**——否则「重置布局配置」会顺手清掉用户的提醒规则。 |
| `src/layouts/components/Settings/index.vue` | 「市场提醒」分组：两个开关（通知开关开启时申请权限，失败自动拨回）、通知冷却、三个默认阈值、「按默认阈值重建预置规则」。 |
| `src/pages/marketvolume/index.vue` | 命中横幅（含按规则分组的明细）、表格命中行高亮、规则编辑抽屉（增删/开关/优先级/范围/指标/方向/判定/阈值/冷却）、浏览器通知（按规则冷却去重）。 |

### 10.3 设计要点（改这块前务必先懂）

- **输入必须是 `changeApplied`，不是 `all`**。提醒依赖的 `changePct` / `volumeRate` / `volumeRolling` / `turnoverRolling` 都是页面**上一步回填**的；用 `all` 会拿到还没算好的值（全是 null → 永远不命中）。
- **每行只保留一条命中**（`evaluateAlerts` 按 `priority` 升序、其次**显著度**降序去重）：否则一个物品命中多条规则时，表格行会拿到互相矛盾的标记。**但明细不丢信息**——「展开明细」走 `evaluateAlertsByRule` 拿逐条规则的全量命中。
- **显著度不能一律按值降序**：`lte` 类规则（如「跌幅 ≥ 20%」）里最该被看到的是**最低**的值，按降序反而把最温和的排在最前。方向由规则的 `operator` 决定（`notabilityOf`）。
- **相对判定的基准从候选集合自身算出**（`topN` 取第 N 名取值、倍数类取均值/中位数 × k），所以「超过均值 3 倍」只在相对意义上成立；候选集为空或基准 ≤ 0 时不产生命中（避免无意义阈值与除零）。
- **`onlyActive` 默认 true**：市场里 3000+ 条零成交记录，不挡掉会把结果淹掉。页面同时把「范围 + onlyActive + 指标可取到值」作为候选过滤。
- **浏览器通知要两层过滤**：只在**命中集合的形状变化**时触发（watch 的是 `ruleId|hrid|level` 串联串，只改数值不重复弹），且按**每条规则的冷却时间**对同一 (规则, 物品) 去重——行情每次刷新都会重算，不做这两层页面开着就会一直弹。
- **阈值**：`threshold` 为空/非有限数时**不产生命中**，不要退化成把它当 0（否则 `threshold: undefined` 会命中全表）。跌幅规则用**负数阈值**，`createPresetRules` 里写成 `-Math.abs(...)`，阈值填负数也不会写反。

### 10.4 已知边界与后续可做
- 只在市场监控页打开时评估（`inPageEnabled` 关闭时连评估都跳过，省掉每轮全量开销）。要「任意页面都提醒」，需把规则/评估下沉并挂到 `main.ts` 的轮询上。
- 通知只在页面存活期间发出，**关掉页面就收不到**——这是纯前端应用的固有边界，不是缺陷。
- 可扩展方向：规则导入/导出、按规则自定义提示音、把「命中历史」落盘以便回看。

### 10.5 验证（当时实测，2026-10-02；全量数字随 §11 上线后已更新为 27 文件 / 152 用例）
- `npx vue-tsc --noEmit` 通过；`npx vitest run` **26 文件 / 127 用例全绿**（新增 27 个：`marketvolume-alerts` 21 + `marketvolume-alerts-integration` 6）。
- `vite build --mode public`（13.1s）与 `--mode private`（11.6s）均成功；dev server 下 `marketvolume/index.vue`、`alerts.ts`、`pinia/stores/alert.ts` 三个模块均能被 Vite 正常编译（HTTP 200）。
- 集成测试用真实 `getMarketVolumeList()` 输出驱动预置规则，验证了「每行一条 + 优先级取胜 + `onlyActive` 挡住无价条目」在真实形状的数据上成立。

---

## 11. 市场监控：收藏与区间筛选（2026-10-02 新增功能）

### 11.1 需求
在 §10 的提醒之外，市场监控页还需要两件"看数据"的能力：**收藏**条目，以及对数值列做**区间筛选**
（成交量高于/低于/在某两值之间、涨跌幅高于/低于/在某两值之间）。

### 11.2 文件与职责

| 文件 | 职责 |
| --- | --- |
| `src/common/apis/marketvolume/filters.ts` | **纯函数**：`NumericRange`/`RangeMode` 模型、`rangeValueOf`、`matchesRange`、`applyRangeFilters`、`countActiveRanges`、`createEmptyRanges`。不碰副作用/i18n，可独立单测。 |
| `src/common/components/RangeFilter/index.vue` | 单个指标一行控件（标签 + 模式下拉 + 1~2 个数字输入 + 单位），`v-model` 绑 `NumericRange`。**显式 import** 使用（项目未配置 components 自动导入的 `dirs`）。 |
| `src/pinia/stores/marketfavorite.ts` | 收藏（key `market-favorite-items`）：按 `hrid|level` 存 `string[]`，读取时归一化丢弃坏数据。 |
| `src/common/apis/marketvolume/keys.ts` | **零依赖**的 `marketRowKeyOf`（`hrid|level`）。全站行 key 的规范定义处；`alerts.ts` 的 `alertKeyOf` 是它的别名。 |

### 11.3 语义（改这块前先读）

- **端点一律包含**：`≥` / `≤` / `区间` 都含端点。选项文案刻意写成符号而不是"高于/低于"，
  就是为了消除端点歧义；也与提醒规则的 `gte`/`lte`（"达到或高于"）保持同一理解。
- **阈值留空 ⇒ 该条件不生效**，而不是匹配空集。用户刚把模式切成 `≥` 还没填数字时，列表必须照常显示。
- **`区间` 填反了自动对调**（`min > max` 视为填反），避免"筛出空列表"这种看起来像坏了的体验。
- **值缺失的条目在条件启用时不匹配**：`changePct` 无历史（null）、`price === -1` 无价。
  否则「涨跌幅 ≥ 10%」会把一堆无历史条目放进来。
- **成交量/成交额的取值与表格展示列一致**（优先时间窗内滚动量 `volumeRolling`，回退官方当日累计 `volume`）。
  否则会出现"屏幕上写着 0、却因为底层 volume 非 0 被筛出来"。
- **收藏粒度 = 行粒度**（物品 + 市场档位），不是只按物品：同一件装备的 +0 与 +3 是两条不同的市场条目。
- **`只看收藏` 开关不落盘**：收藏是数据、开关是视图状态（与 `onlyActive`、涨跌方向一致）。

### 11.4 页面接线（`pages/marketvolume/index.vue`）
- `filtered` 的过滤顺序：关键词 → 分类 → 强化档位 → 只看有成交 → 涨跌方向 → **只看收藏** → **区间筛选**。
- 分页复位 watch 里加了 `onlyFavorite` 与 `rangeSignature`。`ranges` 是嵌套对象，**不要**把对象塞进
  那个 ref 数组（会需要 `deep: true`、把整组变成深监听）；用签名字符串代替，代价小且精确。
- 模板里所有行 key 都走 `rowKeyOf(row)`（= `marketRowKeyOf`），**不要再手拼 `row.hrid + '|' + row.level`**。

### 11.5 验证（当时实测，2026-10-02；全量数字随 §12 上线后已更新为 28 文件 / 159 用例）
- `npx vue-tsc --noEmit` 通过；`npx vitest run` **27 文件 / 152 用例全绿**。
- `vite build --mode public`（13.6s）与 `--mode private`（13.3s）均成功；dev server 下
  `marketvolume/index.vue`、`filters.ts`、`keys.ts`、`RangeFilter/index.vue`、`marketfavorite.ts` 五个模块均可被 Vite 正常编译。
- **真实数据验证**（用官方 `marketplace.json` 快照驱动真实 `getMarketVolumeList()`，872 物品 / 3707 条目）：
  成交量最大 3,745,189、中位 39；「成交量 ≥ 10000」→130 条、「≤ 100」→2679 条、「1000~100000」→141 条、
  「价格 ≥ 100000」→2263 条、「成交额 ≥ 1e8」→141 条、两条件叠加 →8 条；
  把阈值取成最大值时仍命中 1 条（**验证含端点**）；阈值留空时返回**同一引用**（不加筛选）。
- ⚠️ 注意：`public/data/market.json` 里**只有 `ask/bid/vendor`，没有 `price/volume`**，
  用它做数据验证会得到"成交量全 0"，别据此判断筛选坏了——要验成交量必须用官方快照或 `market_history` 分片。

---

## 12. 价格档位口径扩展到 6 个（2026-10-02）

### 12.1 变更
原来只有 4 个价格口径，现补齐为 **左/右 ×（`-` / 原价 / `+`）共 6 个**：

| 枚举 | 标签 | 含义 |
| --- | --- | --- |
| `ASK_LOW` | 左价- | ask 压一档 |
| `ASK` | 左价 | ask 原价（默认买价） |
| `ASK_HIGH` | 左价+ | ask 抬一档 ← **新增** |
| `BID_LOW` | 右价- | bid 压一档 ← **新增** |
| `BID` | 右价 | bid 原价（默认卖价） |
| `BID_HIGH` | 右价+ | bid 抬一档 |

### 12.2 改了两处（新增档位时需要同步的地方就这两处）

1. **`pinia/stores/game.ts`**：`PriceStatus` 枚举加 `ASK_HIGH` / `BID_LOW`；`PRICE_STATUS_LIST` 扩到 6 项。
   排列顺序是**同一报价内按价格由低到高**（`-` → 原价 → `+`），两种报价各成一组，
   下拉展开时档位方向一眼可见。
2. **`common/apis/game/index.ts`**：`convertPriceOfStatus` 里的 `switch` 换成了
   **`STATUS_STEP_SPEC: Record<PriceStatus, { base, dir }>` 表**。这样做的好处是
   **漏掉枚举成员会被类型检查直接拦下** —— 只改 UI 列表、忘了改计算分支的话，
   会表现成「下拉里能选、但价格没变化」这种极难发现的静默错误。
   `dir`：`0` 原价、`+1` 抬一档、`-1` 压一档；`base` 决定读 ask 还是 bid。

**其余地方全部自动生效**：所有价格下拉都是 `v-for="item in PRICE_STATUS_LIST"`，
包括 `enhancer`（买价×2）、`enhancest`（买价/卖价）、以及共用组件
`common/components/PriceStatusSelect/index.vue`（被 dashboard / charmtransform / enhanceexp /
enhanposer / enhanposest / inherit / jungle / junglest / manualchemy 引用）。
`priceStepOf(price, high, enhanced)` **无需改动**——它本来就只接受"抬/压"方向，
新口径复用同一函数，因此强化物品的 ×5 增量也自动适用。

**价格缓存无需处理**：`_priceCache` 的 key 是 `${hrid}|${mode}|${buyStatus}|${sellStatus}`，
新口径天然落在自己的桶里；`_priceResolutionCache` 只存"未做状态转换"的裸价，与档位无关。

### 12.3 验证（实测）
- `npx vue-tsc --noEmit` 通过；`npx vitest run` **28 文件 / 159 用例全绿**。
- 新增 `tests/price-status-tiers.test.ts`（7 用例）：列表 6 项且顺序/标签后缀符合约定；
  0 级下三个左价口径严格递增、抬/压幅度 = **0.366%**；`level 3` 下幅度 = **0.366%×5 = 1.83%**，
  与 0 级之比 **= 5**；低价物品（10 金）一档不足 1 金时**保底移动 1 金**（10 → 11 / 9）；
  无报价档位在 A 模式（不做兜底）下任何口径都保持 **-1**。
- `vite build` public/private 均成功；产物中可直接读到 6 个枚举、6 项选项列表、
  以及 `STATUS_STEP_SPEC` 的 6 条 `{base, dir}` —— 确认真的编译进去了。

⚠️ 测试注意：给 `store.marketData` 赋值时必须用**全新字面量**，不能从 store 上展开
（`toRaw` 只解顶层，嵌套 reactive 代理会让 `structuredClone` 抛 `DataCloneError`），详见 §6 坑点 12。

---

## 13. 排除护符（三开关独立）与「隐藏小成交量」（2026-10-02）

### 13.1 需求
1. 多选检索面板里增加**排除护符**（并给 `manualchemy` 补上它缺的**排除首饰**）。
2. 一个**可开可关**的设置，用来**隐藏成交量小**的市场条目。

### 13.2 排除护符：为什么要做成「独立开关」

护符在数据里不是分类，而是**部位**：`equipmentDetail.type === "/equipment_types/charm"`，
实测 **102 件**（532 件装备的 19%，是最大的装备类别，比 main_hand 的 69 件还多）。
它原本被「排除装备」一并剔除，所以照原样再加一个「排除护符」会**永远没反应**——
这与当年「排除首饰」踩过的坑是同一个（见 `tests/ban-filter-independence.test.ts` 的注释）。

因此三者改成**互相独立**（`common/utils/game.ts` 新增 `CHARM_EQUIPMENT_TYPE` / `isCharm`）：

| 勾选 | 去掉什么 | 保留什么 |
| --- | --- | --- |
| 排除装备 | 既非首饰也非护符的装备（护甲/武器/工具/披风/袋子…） | 首饰、护符 |
| 排除首饰 | 项链 / 戒指 / 耳环 | 其余全部 |
| 排除护符 | 护符 | 其余全部 |
| 三个都勾 | **全部装备** | 只剩非装备 |

⚠️ **`banEquipment` 的语义变了**：它现在**不再吞并护符**（此前会）。为让**各页默认行为完全不变**，
新增的 `banCharm` 默认值一律取与同页 `banEquipment` 相同——`dashboard` 与 `manualchemy`
默认 `banEquipment: true`，故它们的 `banCharm` 也默认 `true`（护符照旧被排除）；
其余页面两者都是 `false`。所以**除非你主动改开关，列表内容不会变**。

改动点（新增排除开关时要同步的地方）：
`common/utils/game.ts`（判定）、`common/apis/utils.ts` 的 `handleSearch`、
`common/apis/favorite/index.ts`（收藏夹那条路径要保持同一语义）、
`common/apis/leaderboard/type.d.ts` 与 `SearchPanel/types.ts`（类型）、
11 个页面的 `searchData` 默认值 + `panelFields`、以及 `enhanceexp` 的「生效条件」摘要列表。

### 13.3 隐藏小成交量：一个可开可关的持久设置
- 新 store `pinia/stores/marketfilter.ts`：`{ hideLowVolume, minVolume }`，key `market-filter-config`。
  **默认关闭**、阈值 `100`。字段归一化：负阈值夹到 0、非数字回落默认、非布尔视为关闭。
- 设置面板新增「市场监控」分组（开关 + 阈值 + 说明）；市场监控页头部也有一个**同源**开关
  （读写同一个 store，改哪边都同步）。这就是「可选过滤 / 可开可关」的落点。
- 页面在 `filtered` 里应用，取值口径与该页「成交量」列**完全一致**
  （`rangeValueOf(item, "volume")` = 时间窗内滚动量优先、回退官方当日累计量），
  否则会出现「屏幕上写着 0、却因为底层累计量非 0 而被留下」。
- 与页面上的**手动区间筛选是两个东西**：这个是长期设置，那个是本次会话临时条件，两者叠加（AND）。

**实测效果**（官方快照，2944 条 = 物品×档位）：

| minVolume | 保留 | 隐藏 |
| --- | --- | --- |
| 1 | 623 | 2321 |
| 10 | 415 | 2529 |
| 50 | 311 | 2633 |
| **100（默认）** | **265** | **2679** |
| 1000 | 180 | 2764 |
| 10000 | 118 | 2826 |

⚠️ 注意这是**按行（物品×档位）**判定：多数强化档本身几乎不成交，所以阈值一开，
同一件装备的低档位也会被藏掉。若想要「按物品汇总后的总量」判定，是另一个需求（见 §5 待办）。

### 13.4 验证（实测）
- `npx vue-tsc --noEmit` 通过；`npx vitest run` **28 文件 / 164 用例全绿**。
- `ban-filter-independence` 用真实数据验证：样本 532 = 首饰 23 + 护符 102 + 普通装备 407；
  leaderboard 侧 base 8760 条（首饰 161 / 护符 1015）→「仅排除装备」后首饰与护符**计数一个不变**，
  「仅排除护符」正好少掉 1015 条；三者都勾 = `onlyEquip + onlyJewelry + onlyCharm - 2*base`。
- `marketvolume-filters` 新增 5 个用例覆盖过滤设置的默认值、持久化、坏数据归一化与 reset。
- `vite build` public/private 均成功。

---

## 14. 「检索结果页」骨架抽取：`useLeaderboardPage`（2026-10-03）

### 14.1 为什么做（先量再改）
用「行级最长公共块」扫全仓（`src/` 166 个文件），**≥8 行且跨 ≥2 文件**的重复块共 **169 处**，
其中最大的重复是 **40 行 × 8 个文件**。重复的重心不是面板（那个早已收敛成 `SearchPanel`），
而是**页面骨架**：分页、检索条件缓存、防抖检索、条件变化回第一页、排序、自动重算 watch、
详情弹窗、价格弹窗、买卖价状态 —— 这些在 10~11 个页面里逐字重复。

最直观的样本：`jungle/index.vue` 与 `junglest/index.vue` 共约 850 行，**只差 217 行**，
且差异几乎全是 API 路径、缓存 key、几个字段与注释 —— **三分之二完全相同**。

### 14.2 轮子在哪
`src/common/composables/useLeaderboardPage.ts`。

```ts
const {
  searchData: ldSearchData,          // 检索条件（useMemory + normalizeSearchData 迁移）
  list: leaderboardData,
  loading: loadingLD,
  paginationData: paginationDataLD,
  handleCurrentChange: handleCurrentChangeLD,
  handleSizeChange: handleSizeChangeLD,
  handleSearch: handleSearchLD,      // 条件变化 → 回第一页再查
  handleSortChange: handleSortLD,
  currentRow, detailVisible, showDetail,
  priceVisible, currentPriceRow, setPrice,
  onPriceStatusChange
} = useLeaderboardPage({ key: "jungle", api: getDataApi, searchData: { ... } })
```

**别名解构是刻意的**：所有页面的模板都用 `ldSearchData` / `paginationDataLD` / `loadingLD` …
这套命名，别名让**模板一行都不用改**，改动只落在 `<script>` 里，风险和 review 成本都小得多。

### 14.3 ⚠️ 缓存 key 的派生规则（迁移时最容易踩）
`key` 只用来派生三个 localStorage key，**默认值必须与历史 key 一致**，否则用户的
搜索条件与分页会看起来"丢了"。不一致时逐个覆盖：

| 选项 | 默认值 |
| --- | --- |
| `memoryKey` | `${key}-leaderboard-search-data` |
| `paginationKey` | `${key}-leaderboard-pagination` |
| `priceStatusKey` | `${key}-price-status` |

- `manualchemy` 的 memoryKey 历史上是 `dashboard-manualchemy-search-data`，必须显式传。
- `manualchemy` 的分页 key 历史上**误用了 `dashboard-leaderboard-pagination`**（复制粘贴产物，
  会与 dashboard 共享分页状态）。已改为自己的 key —— 这是修 bug，不是迁移副作用。
- 需要额外实参的接口在页面里包一层：`api: params => getDataApi(params, "pickout")`。

### 14.4 已迁移 / 未迁移

**已迁移 8 个**：`junglest/index`、`enhanceexp`、`enhanposer/index`、`enhanposer/enhanposest`、
`inherit`、`jungle/index`、`junglest/inherit`、`manualchemy`。

**暂未迁移 3 个**（结构确实不同，不要照抄）：
- `dashboard/index`：一页有 **两套**检索（利润排行 + 收藏），且第二套的 memoryKey 是
  `dashboard-favorite-search-data`（不带 `-leaderboard-`）；
- `jungle/pickout`：接口多一个实参，且 `usePriceStatus("pickout-price-status", {...})`
  带第二参数、不接收返回值（模板里的 `PriceStatusSelect` 已注释，但那个副作用是必需的）；
- `decompose`：不用买卖价状态（需要 `withPriceStatus: false`）。

### 14.5 ⚠️ 各页特有逻辑必须留在页面里
**最容易犯的错：把整个"骨架区域"当纯骨架删掉。** 实测有 4 个页面在骨架之间夹着自己的业务逻辑：

| 页面 | 特有的东西 |
| --- | --- |
| `enhanceexp` | `searchPanelRef` + 表头点击并入「排序优先级」 + `rowClassName`（赚钱高亮）+ 模式 watch（清 `enhanceexp` 缓存） |
| `enhanposer` | 模式 watch（`noDecompose`/价格口径 → `clearEnhanposerCache`） |
| `enhanposest` | 模式 watch（价格口径 → `clearModeCache("enhanposest")`） |
| `junglest/inherit` | `handleChangeEscape`（不逃逸 → 清 `junglerit` 模式缓存） |

其中 `enhanceexp` 的 `handleSortLD` **本身就是骨架函数的重载版**（要先并入优先级再排序），
所以它的写法是：`handleSortChange: applyHeaderSortLD` + 页面自己包一层 `handleSortLD`。

**迁移后必做的两步核查**（否则会静默丢功能）：
1. `npx vue-tsc --noEmit` —— 模板里引用的名字没了会报错；
2. **对比迁移前后的「顶层声明集合」**（`function`/`const` 名），确认消失的都是搬进 composable 的
   （`sortLD` / `getLeaderboardData` / `activated`），而不是业务逻辑。**tsc 查不出没被引用的丢失**。

### 14.6 验证（实测）
- `vue-tsc` 通过；`vitest` **28 文件 / 164 用例全绿**；`vite build` public/private 均成功。
- 8 个页面共减少约 **453 行**（单个 −48 ~ −64 行）。
- 复扫重复块：**169 处 → 155 处**；已迁移页面参与重复的行数合计减少约 **3700 行**
  （该指标会重复计入交叠块，只能看趋势）。
- lint 非风格问题**保持在基线 3 条**（全在 `enhanceexp`，均为既有问题：`Plus`/`SortPriority` 未使用、
  `setPrice` 未被引用）。迁移引入的 `getMarketDataApi` 未使用与注释块风格已清理。

### 14.7 还剩什么（按价值排序）
1. **模板侧的 40 行表格列块仍重复 8 次**（`t('经验 / h')` 那一段）—— 这是现在最大的单块重复，
   适合抽成「计算器结果列」组件；
2. 9 个页面重复的 `.row` 样式（8~9 行）；
3. `dashboard` / `pickout` / `decompose` 三页的骨架迁移（见 §14.4）；
4. 别名解构块本身（约 20 行）在 8 个页面重复 —— 属于**声明式接线**而非逻辑，
   与 import 同类，可以接受；若要消除只能改模板命名，得不偿失。

---

## 15. 目标时薪反解：「想要多少时薪，最多以多少钱买入」（2026-10-03）

### 15.1 需求
用户原话：「如果我想要实现时薪多少多少，则最多或最少以某个价格买入」。
关键是**每个方案都有一个天然的「主要询价物品」**——分解虚空茶叶时是虚空茶叶、转化太阳石时是太阳石。

代码里这个语义是现成的：`ingredientList[0].hrid === this.item.hrid`
（`cost4Mat` 的注释「从第 2 个原料开始计算」也印证 `[0]` 是本体）。
所以 **主要询价物品 = `ingredientListWithPrice[0]`**，不用另建映射。

### 15.2 为什么能精确反解（不用迭代）
时薪对**每个单价都是线性的**：
```
costPH   = Σ countPH_i × price_i                       （材料/成本侧）
incomePH = Σ (税后系数/金币系数) × countPH_j × price_j    （成品/收益侧）
profitPH = incomePH − costPH
```
所以单价涨 1 金币对时薪的影响是个常数（偏导系数），反解是闭式解：
```
临界单价 = 当前单价 + (目标时薪 − 当前时薪) / 系数
```
- 材料侧系数 = **−countPH**（买贵了利润下降）
- 成品侧系数 = **+countPH × 税后系数**（金币不课税，故金币的系数不带税率）

`countPH` 由计算器直接给出（材料 = `count × consumePH`，成品 = `count × gainPH × rate`），
所以**不需要重新推导任何公式**。

### 15.3 文件与职责

| 文件 | 职责 |
| --- | --- |
| `src/common/utils/price-solve.ts` | **纯函数**（零运行时依赖，只 import 类型与常量）：`solveCandidatesOf` / `primaryCandidateOf` / `solvePriceForTarget`。不碰物品名与市场档位，因此能脱开游戏数据独立单测 |
| `src/pages/dashboard/components/ActionSolveCard.vue` | 详情弹窗里的反解面板：目标时薪输入、询价物品下拉、临界价 + **档位对照** |
| `src/pages/dashboard/components/ActionDetail.vue` | 在弹窗底部挂载上面的面板（所有检索页共用这个弹窗，所以一处接入即全站可用） |

**档位对照**复用了 §12 的价格档位：材料侧列 `左价- / 左价 / 左价+`，成品侧列 `右价- / 右价 / 右价+`，
逐档标出「达标 / 差多少」，这样就把临界价翻译成了「我能买到哪个档位」。
档位价由 `getPriceOf` 按各档位口径算出，与别处显示的价格同源。

### 15.4 验证（实测）
- `vue-tsc` 通过；`vitest` **29 文件 / 173 用例全绿**；`vite build` public/private 均成功；
  dev server 下 `ActionSolveCard.vue` / `price-solve.ts` / `ActionDetail.vue` 三个模块均能被 Vite 正常编译。
- `tests/price-solve.test.ts` 分两层：
  1. **手算样例**（完全可控的假计算器）：材料 `countPH=2 @100`、成品 `countPH=1 @1000`、时薪 760；
     目标 500 → 材料临界价 **230**（代回 2×230=460，利润 960−460=500 ✓）、
     成品临界价 **729.1667**（代回 0.96×729.1667=700，利润 700−200=500 ✓）；目标 1000 时材料临界价 −20 → 标为不可达。
  2. **真实计算器**：验证系数模型能**精确复现**计算器自己的聚合值——
     `Σ countPH×price` 对 `costPH`、`Σ 系数×countPH×price` 对 `incomePH`，相对误差 **< 1e-9**
     （实测 decompose 的 `2239964909.2155` 对 `2239964909.2155`）。这步很关键：反解建立在线性模型上，模型对被验过了，反解才对。
- 真实数据上的可读性检查（临时探针，已删）：例如
  「转化 Artisan Tea：当前时薪 1.13M、现价 2800 → 要做到 1.69M/h 需买价 ≤ 1716（得便宜 1084）」；
  而临界价 ≤ 0 的情形（如「分解 Apple Gummy 现价才 12，翻 1.5 倍需倒贴」）会被标成**不可达**，
  这本身就是有用信息：说明该方案靠"买得更便宜"已经到极限。

⚠️ 使用注意：`result` 由 `calc.run()` 填充，构造计算器后**必须调 `run()`** 才能拿到 `profitPH` 等聚合值
（写测试时踩过：不调 `run()` 会拿到 `undefined`）。

---

## 16. 填表计算利润（非实时）（2026-10-03）

### 16.1 需求
「填入购买时的价格等，就能获得利润等。**非实时的**——因为实时的不准确，
价格会变，我买的时候是这个价格，但是卖的时候是另外的价格。」

结论：做一个**独立页面**，用你自己填的成交价算利润，与实时市价解耦
（市价只作为默认值）。

### 16.2 关键性质：默认值必须精确复现计算器
表单每行的默认值都来自计算器，因此**什么都不改时**：
```
总成本 ≡ calc.result.costPH      总收入 ≡ calc.result.incomePH
总利润 ≡ calc.result.profitPH    总耗时 ≡ 1 小时      时薪 ≡ calc.result.profitPH
```
这条是设计的地基：**只有默认值可解释，"改哪格就是覆盖哪格"才成立**，
而且它可被单测直接断言（见下）。实现方式：
- `perActionCount = countPH / actionsPH`（每小时量 ÷ 每小时动作数 = 每次动作量）
- `actions` 默认 = `calc.actionsPH`，`timeCostPerAction` 默认 = `NS_PER_HOUR / actionsPH`
  → 两者相乘恰好 1 小时

### 16.3 文件与职责

| 文件 | 职责 |
| --- | --- |
| `common/utils/profit-form.ts` | **纯函数**：`createFormState(calc)` 生成默认值、`computeProfitForm(state)` 算结果。零运行时依赖 |
| `common/apis/profitform/index.ts` | 各动作的**可选物品枚举**（`PROFIT_FORM_ACTIONS` / `profitFormItemsOf`）。放 API 层是因为它要读 `actionDetailMap` |
| `pinia/stores/profitform.ts` | 手填值持久化，按方案 key 存 |
| `pages/profitform/index.vue` | 页面（路由 `/profitform`，菜单「填表算利润」，归在「利润检索」组） |

**只存覆盖值，不存整张表**：存下来的只有「你手填过的那几项」（某物品单价/数量、
动作次数、单次耗时），其余每次从计算器现算。因为磕了工匠茶、换了触媒后**配方会变**，
存整张表会显示过期配方还算错；而"我买的时候是这个价格"本就和配方无关。

### 16.4 ⚠️ 各动作的构造参数（易漏）
| 动作 | 判定依据 | 必填参数 |
| --- | --- | --- |
| 强化 | `item.enhancementCosts` | `enhanceLevel` **且 `protectLevel`**（`available` 要求 `escLevel < originLevel < enhanceLevel` 且 `protectLevel ≤ enhanceLevel`） |
| 分解 | `alchemyDetail.decomposeItems` | `enhanceLevel`（分解目标等级） |
| 转化 | `alchemyDetail.transmuteDropTable` | `catalystRank`（可选） |
| 点金 | `alchemyDetail.isCoinifiable` | `catalystRank`（可选） |
| 制造 | `actionDetailMap` 里有 `/actions/<5 种制作专业>/<物品key>` | `action` = 具体专业（由物品反推） |
| 采集 | 同上（`foraging`/`milking`/`woodcutting`） | `action` = 具体专业（由物品反推） |

**强化最容易踩**：`protectLevel` 在配置里是必填，不传会让 `available` 直接为 false，
表现成**"选择器列得出物品、却被判定不支持该动作"**。这个坑是测试抓出来的（见 16.5 第 3 条）。

### 16.5 验证（实测）
- `vue-tsc` 通过；`vitest` **30 文件 / 182 用例全绿**；`vite build` 双模式成功；
  dev server 下 3 个新模块均编译通过。
- **默认值复现**（真实计算器）：decompose 的成本 `2239964909.22` 对 `2239964909.22`、
  收入与利润同样精确相等，**总耗时 = 1.000000 小时**；transmute 同样精确。
- **动作枚举闭环**（`tests/profit-form.test.ts`）：选择器列出的物品**必须被计算器判定可用**。
  这条一上来就抓到了上面那个 `protectLevel` 缺失的 bug——纯靠读代码是看不出来的。
  实测 6 个动作的枚举数量：强化 532 / 分解 742 / 转化 622 / 点金 889 / 制造 647 / 采集 26，
  且制造样本被正确反推为 `tailoring`、采集样本为 `foraging`。
- 手算样例：材料 2 个 @100、成品 1 个 @1000、税率 4% → 成本 200、收入 960、利润 760、
  时薪 760、利润率 3.8；把材料改成 230 → 利润恰为 500
  （与「目标时薪反解」里 760→500 的临界价 230 互为佐证）。

---

*（本文档为 AI 接手上下文，随项目演进持续更新。）*
*（内容由AI生成，仅供参考）*
