# MewKonomy 代码审计报告

**审计日期**：2026-11-02
**代码版本**：`d590284`（v1.3.386）
**审计范围**：`src/` 180 个源文件约 36k 行、`tests/` 54 个测试文件、构建与 CI 配置
**方法**：8 个维度并行审计（计算口径 / 死代码 / 类型安全 / 性能 / 测试质量 / 数据层 / UI+i18n / 工程基建），
每条结论要求 `文件:行号` 证据；标注「已实测」的条目由本人复核代码或数据确认。

---

## 摘要：最该先看的 10 件事

| # | 问题 | 位置 | 影响 | 证据等级 |
|---|---|---|---|---|
| 1 | 检索面板「接近 ±X」模式**完全失效**（写 `__mode__tolerance`，读 `__tolerance`） | `SearchPanel/index.vue:75` ↔ `apis/utils.ts:164` | 11 个检索页的 near 模式退化成「精确等于」，结果看起来合理所以无人发现 | 已实测 |
| 2 | 大全套兜底价的「转化」来源**全部为 0**（`maxCount-minCount`，而数据里 min 恒等于 max） | `apis/game/index.ts:315` | 3323/3323 条掉落被丢弃，转化兜底价整体失效 | 已实测 |
| 3 | 市场数据的「缺价回填上一小时」是**死代码**（条件写反） | `pinia/stores/game.ts:368` | 薄流动性档位缺价时直接 -1，不沿用上次真实价 | 已实测 |
| 4 | 产业链「每小时产出」漏乘动作成功率 | `apis/chainbuilder/index.ts:591` | 高估 1/sr（sr=0.5 时 2 倍） | 已实测 |
| 5 | 护符转化「盈亏平衡价」漏成功率 + 漏 4% 税 | `apis/charmtransform/index.ts:603` | 平衡价只有真值的约 50%，「离回本还差多少」高估约 2 倍 | 静态确认 |
| 6 | 首访数据拉取失败 → **应用永不挂载，白屏无提示** | `main.ts:54` | 离线/被墙/404 时用户面对纯白页 | 静态确认 |
| 7 | `localStorage` 的 `JSON.parse` 无 try/catch，坏数据 → **整站白屏** | `pinia/stores/game.ts:439` | 用户无法自救（无清缓存入口） | 静态确认 |
| 8 | 强化练级页收入**未扣 4% 市场税** | `apis/enhanceexp/index.ts:152` | 收入高 4%，临界方案从亏翻成赚 | 静态确认 |
| 9 | 每 60 秒无条件把 4MB 数据 `JSON.stringify` + 写 `localStorage` | `pinia/stores/game.ts:184` | 主线程周期性卡顿；4.8MB 逼近 5MB 配额 | 静态确认 |
| 10 | ESLint 2188 个问题从未清理；pre-commit 未安装；CI 的 push 触发被注释 | 工程配置 | 名义 4 道防线实际生效 1 道（部署时 vue-tsc） | 已实测 |

---

## P0 · 确认的计算错误（会算错数）

### P0-1 检索面板的容差键名与读取端不一致

```ts
// 写入端 SearchPanel/index.vue:67-75
const mk = modeKeyOf(field)                    // "minRisk__mode"
raw[mk] = value.mode
raw[`${mk}__tolerance`] = value.tolerance      // ← 实际写入 "minRisk__mode__tolerance"

// 读取端 apis/utils.ts:164
const toleranceKey = `${minKey}__tolerance`    // ← 实际读取 "minRisk__tolerance"
```

两边差一个 `__mode`，`tolerance` 永远 `undefined` ⇒ `query-engine` 的 `near` 模式：
`const tol = finite(r.tolerance) ?? 0` ⇒ 容差 0 ⇒ 退化为 `value === min`。

**讽刺之处**：`utils.ts:160-163` 的注释明确记录了「早期版本这里拼成了 `${metaKey}__tolerance`」这个坑——
但当年只改了**读取端**，写入端至今仍在写错。测试 `search-range-modes.test.ts:97` 用手工构造的 params 直接调
`handleSearch`，绕过了组件写入端，所以测不出来。

**影响面**：所有 case 为 `range` 的面板字段（利润率/风险/等级/净率/净利/左价/右价/成交等），
11 个检索页 + 炒货页。「接近 30 ± 2」返回的结果等于「等于 30」。

**修法**：写入端改成 `raw[`${field.minKey ?? field.maxKey}__tolerance`]`，与读取端对齐；
并补一条「经组件写入 → 经 handleSearch 读取」的集成测试，而不是只测引擎。

---

### P0-2 大全套兜底价：转化来源恒为 0

```ts
// apis/game/index.ts:315
const count = ((drop.maxCount ?? 1) - (drop.minCount ?? 0)) * (alch.bulkMultiplier ?? 1)
if (count <= 0 || rate <= 0) return
```

实测 `data.json`：`transmuteDropTable` 共 **3323 条，minCount === maxCount 的有 3323 条（100%）**
⇒ `maxCount - minCount` 恒为 0 ⇒ 全部被 `return` 丢弃。

**后果**：`_bigSetAlchemySourceMap` 里没有任何「转化」来源，炼金兜底价只剩分解来源；
转化物品在缺市价时会落到更外层的兜底或直接 -1。

**修法**：`count` 应为 `maxCount × bulkMultiplier`（单次成功产出），与 `manualchemy` 的同款写法对齐。

---

### P0-3 `updateMarketData` 的旧值回填是死分支

```ts
// pinia/stores/game.ts:368-385
for (const hrid in newMarket) {
  if (isEquipmentMap[hrid] || oldMarket[hrid]) {   // ← 本意是 !oldMarket[hrid]
    continue
  }
  for (const level in newMarket[hrid]) {
    if (price.ask === -1) price.ask = (oldMarket[hrid]?.[level])?.ask || -1   // 恒为 undefined
```

能进入内层循环的只有「旧数据里**没有**这个 hrid」的物品，此时 `oldMarket[hrid]` 必然 undefined
⇒ 四段回填（ask/bid/volume）全部拿到 `undefined` ⇒ 整段无效。

**后果**：某个强化档位临时无人挂单（快照里 `a=-1`）时，价格直接变 -1，**不会**沿用上一小时的价。
`volume` 在 UTC 0 点归零后也无法沿用。注释里写明这是原实现的目的，但实际从未生效。

**修法**：条件改为 `if (isEquipmentMap[hrid] || !oldMarket[hrid]) continue`。

---

### P0-4 产业链「每小时产出」漏乘成功率

```ts
// apis/chainbuilder/index.ts:569,591
const perHour = Math.round(cal.actionsPH)      // 每小时【动作】数
targetPerHour: perHour * successRate           // 应为 actionsPH × sr × rate
```

对比基类定义（`calculator/index.ts:251`）：`gainPH = actionsPH × successRate`，即每小时**成功**次数。
而 `productList` 的 `countPH = count × gainPH × rate`——产出必须走 `gainPH`。

注释里的理由「dropRate 已经包含了它与基础成功率的关系（实测两者都是 0.5，而 dropRate 各项之和为 1）」
是**错误推理**：两个数恰好都等于 0.5 不代表 dropRate 含 sr；dropRate 各项和 = 1 恰恰说明它是**纯概率分布**。

**影响**：sr=0.5 的转化环节，产出预测高估 2 倍；上游投入（`:406` 的 `count: 1 / rate`）少算 1/sr
（「平均要做 200 次」实为 400 次动作）。且 `tests/chainbuilder-newbie-api.test.ts:49` 把这套错误行为锁死了。

---

### P0-5 护符转化「盈亏平衡价」漏成功率与税

```ts
// apis/charmtransform/index.ts:603-604
const breakEvenBid = costPH / (actionsPH * Σrate)
// 应为 costPH / (actionsPH × sr × Σrate × MARKET_TAX_FACTOR)
```

平衡价只有真值的 `sr × 0.96`（sr≈0.525 时约 0.50×），`multipleOfBreakEven` 与页面「离回本还差多少」
系统性高估约 2 倍。现有测试（`charmtransform-decision.test.ts:59`）只断言 `breakEvenBid > 0`，所以从未被发现。

---

### P0-6 强化练级页收入未扣市场税

```ts
// apis/enhanceexp/index.ts:152
saleValue = Σ(count × price × rate)      // 缺 × MARKET_TAX_FACTOR
```

收入高 4%，`netCost` / `costPerExp` / `profitable` 全链路偏乐观，临界方案会从「亏」翻成「赚」。
项目其他所有收入路径（`income`、`marketarb`、`price-solve`）都扣了这 4%，此处是唯一漏网点。

---

### P0-7 手工价「开启了但没填金额」→ NaN 利润

```ts
// calculator/index.ts:89-94
const hasManualPrice = getManualPriceOf(...)?.[type]?.manual
const manualPrice = getManualPriceOf(...)?.[type]?.manualPrice
const price = ... : hasManualPrice ? manualPrice! : item.marketPrice
```

`manual: true` 与 `manualPrice` 有值之间没有任何约束：
`SinglePrice.vue:50` 是 `el-input-number`，清空即 `undefined`；`price.ts:68` 的 `JSON.stringify`
会把 `undefined` 字段直接丢掉，落库后只剩 `{ manual: true }`。

⇒ `price === undefined` ⇒ 成本 `count × undefined = NaN` ⇒ 整条利润显示 NaN；
且 `getUsedPriceOf` 的 `=== -1` 判断失效（`undefined !== -1`），把「无价」误判为「有价」。

**修法**：`setPrice` 里校验 `Number.isFinite(manualPrice) && manualPrice >= 0`，不合法就落 `manual: false`；
`calculator/index.ts:94` 改为 `Number.isFinite(manualPrice) ? manualPrice : item.marketPrice`。

---

## P1 · 稳定性与性能

### 稳定性

| 问题 | 位置 | 说明 |
|---|---|---|
| 首访失败白屏 | `main.ts:54` | `tryFetchData()` 5 次全败且无缓存时 `throw`，`.then` 不执行 ⇒ `app.mount` 永不调用，无任何 UI 提示 |
| localStorage 解析无兜底 | `pinia/stores/game.ts:439`、`cache/local-storage.ts:10,41,53` | 坏数据在**模块 import 期**抛错，pinia store 初始化失败 ⇒ 整站白屏。对照 `price.ts:56` 有 try/catch，属遗漏 |
| 60 秒定时器无互斥 | `main.ts:37` | 单轮最坏 5×15s=75s > 60s ⇒ 必然叠跑；返回的 Promise 无 catch ⇒ 离线时每分钟一条未捕获拒绝 |
| 无全局错误处理 | 全项目 | 无 `app.config.errorHandler` / `window.onerror` / `unhandledrejection`，任何未捕获异常只留在 console |
| 18 处错误被 `console.error` 吞掉 | 9 个 `getDataApi` + 4 个 store + 5 处 composable | 其中 **11 处计算抛错后仍弹「计算完成，耗时 X 秒」**，用户看到空结果是以为数据为空 |
| 自动采样实际是死代码 | `marketvolume/history.ts:383` | `watch(() => getMarketDataApi()?.timestamp)` 的源是**普通模块变量**不是响应式 ⇒ 依赖集合为空 ⇒ 只在启动时跑一次 |
| 采样上限按条数算 | `marketvolume/history.ts:174` | `LOCAL_MAX_SAMPLES = 200`，但每个采样点约 91KB ⇒ 200 点 ≈ 17.5MB，远超 5MB 配额；超限后 `slice(-len/2)` 静默截半 |
| `getGameDataApi()` 谎报非空 | `apis/game/index.ts:79` | `return res!`，运行时可能是 `null`；同项目 `player/index.ts:292` 自己就在 `if (!getGameDataApi()) return` 防它 |

### 性能

| 问题 | 位置 | 量化 |
|---|---|---|
| 4MB 数据每 60 秒无条件写盘 | `pinia/stores/game.ts:184` | 写盘发生在 timestamp 早退（:187）**之前** ⇒ 每分钟一次 `stringify(4MB)` + 同步 `setItem` |
| 4 次整份深拷贝 | `apis/player/index.ts:57-64` | 连续 4 次 `structuredClone(Object.values(itemDetailMap))`（948 物品 ≈3.8MB），filter 后只留 188/532/64/12 条 ⇒ 97% 白拷；实测 45ms，移动端 150~250ms |
| 榜单每次请求全量重算 | `apis/leaderboard/index.ts:35` | 9300 行 × 收藏数线性扫描（F=30 时 28 万次比较）+ 全量 filter + 全量排序（约 12 万次比较），翻一页就重跑 |
| 市场监控每行 O(H) 扫历史 | `pages/marketvolume/index.vue:113-133` | 3000 行 × 200 采样点 ≈ 60 万次扫描/刷新，而「锚点与物品无关」本可只算一次 |
| 计算器实例进 pinia state | `game.ts:116`、`useLeaderboardPage.ts:132` | 上万个实例被深度响应式代理，全仓 `markRaw`/`shallowRef` 只有 1 处 |
| 分包策略静默失效 | `vite.config.ts:82` | `id.includes("vue")` 先于 element 分支命中（pnpm 路径含 `vue`）⇒ 从未产出 `element-*.js`，750KB JS + 338KB CSS 塞进单一 `vue` chunk |

---

## P2 · 架构债

### 死代码

- **30 个未使用导出**（485 个中 6.2%），最值得删：`constants/sort-fields.ts` 的 8 个 `*_SORT_FIELDS`（文件头宣称「统一收口」，实际 8 个模块已改页面内联，改它不生效）、`cache/cookies.ts` 整文件、`utils/datetime.ts` 整文件、`router/index.ts` 的 `resetRouter`、`query-engine.ts` 的 `textOf` / `NO_VALUE`
- **15 处真实死变量**：`manualchemy/index.ts:213,230,339,393,415`（5 处）、`marketvolume/index.ts:1,141`、`chainbuilder/index.vue:220,299,518`、`charmtransform/index.vue:42`、`enhanceexp/index.vue:6,10,43`
- 其中 `marketvolume/index.ts:157` 的注释还写着「`numericValueOf` 仍在本文件保留」——注释自己承认这是残留

### 重复实现

80 对函数体相似度 ≥70%（32 对 ≥90%），最严重的：

| 重复对 | 相似度 | 说明 |
|---|---|---|
| `pages/decompose/index.vue` ↔ `pages/jungle/pickout.vue` | **0.95**（整文件） | script 块仅 48 行差异 |
| `pages/inherit/index.vue` ↔ `pages/junglest/inherit.vue` | 0.923 | 4 页互抄成环 |
| `setPrice`（3 份） | **1.000** | dashboard / decompose / pickout 逐字相同 |
| 右键菜单定位（4 份） | 1.000 / 0.980 / 0.972 | TagsView / enhancer / enhancest / ActionConfig |
| `getDataApi` 缓存样板（9 份） | 0.69~0.99 | 全同一结构：cache → setTimeout 300 → 成功提示 → handleSearch |
| 制造动作常量表（8 处） | **1.000** | `projects: [string, Action][]` 五项逐字复制 |

### 测试质量

- **约 22 条假测试**（占 5%），其中 3 条**零断言**（`bigset-c-verify.test.ts` 只 console.log）
- **12 项覆盖缺口**，最严重的：`enhance.ts` 的逃逸/继承概率矩阵**零覆盖**（`escapeRate`/`leapRate` 在 tests 中 0 命中）；`price` store 零覆盖；`fetchData` 失败路径零覆盖；`calculator/index.ts` 的 `valid=false` 哨兵值零断言
- 断言偏弱：`toBeGreaterThan(0)` 48 处、`Number.isFinite` 14 处——只能挡 NaN，挡不住符号错
- 4 个测试依赖本地 `live_market_tmp.json` 是否存在 ⇒ **同一份代码在两台机器上断言集合不同**
- `marketarb-ui.test.ts` 用了 11 次 `setTimeout(200)` 等待，累计 2.2s 纯等待，是最易 flaky 的文件

### i18n

- **129 个 key 三个语言包全无**（如 `getTrans("挤奶")`、`t("计算完成：{0} 个目标等级，耗时{1}秒")`）
- zh-cn 缺 506 个被 `t()` 引用的 key；en 缺 180；zh-tw 缺 445
- 51 处模板内硬编码中文（`ActionDetailCard.vue` 的表头「物品/掉率/数量」、`TagsView` 右键菜单 4 项）
- `App.vue:19-25` 的 `elLocale` 只判 `zhCn` 和 `en`，**zh-tw 落到 en** ⇒ 繁体用户看到英文分页
- 31 条死文案（语言包有、代码零引用）

---

## P3 · 工程规范

| 项 | 现状 |
|---|---|
| ESLint | **2188 个问题（1959 error）**，1959 个里约 1900 个是可 `--fix` 的格式问题；真实问题约 30 条（死变量/未用导入/props 变异） |
| lint 范围 | 把 `docs/*.md` 和根目录 markdown 当代码格式化，贡献了 981 条噪音 |
| pre-commit | **钩子根本没装**（`core.hooksPath` 未设、`.husky/_` 不存在）；即使装上也会挂（`tsx` 不在依赖里） |
| 部署脚本 | `deploy.ps1:11` 用 `git commit --no-verify` **主动绕过钩子** |
| CI | `deploy.yml` 的 `push` 触发**整段被注释**，只剩手工 dispatch；且只跑 `pnpm install && pnpm build`，无 lint/test/`--frozen-lockfile` |
| test 脚本 | `"test": "vitest"`（watch 模式，无 `--run`）⇒ 430 个用例没有任何自动化入口 |
| 依赖冗余 | `axios` 仅 1 处（第三方表格）、`mathjs` 仅 1 处（强化矩阵）、`path-to-regexp`/`screenfull`/`mitt`/`js-cookie`/`dayjs` 各 1 处；`gh-pages` 零引用 |
| 数据目录 | 根目录 `data/` 是**无人引用**的旧副本（`market.json` 比 `public/data/` 旧 4 个月），需要专门 ignore 才能过 lint |

---

## 附：审计中被否定 / 无法判定的项

诚实起见，以下结论**没有**坐实，不应据此改动：

1. **未发现可利用的 XSS 链路**。5 处 `v-html` 里 4 处是静态翻译串，1 处（`docs/index.vue`）渲染构建期 `?raw` 导入的 markdown。无用户输入污点。缺 dompurify 是「本可以更稳」，不是漏洞。
2. **未发现两个模块共用同一 localStorage key**。只有 `price-list` / `price-activated` / `manual-list` 三个无前缀 key 在同源多应用部署时有覆盖风险。
3. **催化剂消耗公式已在上一次提交修正**（`4331666`），`count = successRate` 正确；本次审计未发现新的同型错误在该处。
4. **炼金稀有/精华掉落到底是「按动作」还是「按成功」**——仓库内两处证据互相矛盾（chainbuilder 的注释说 rate 含 sr，同文件的测试说掉落率之和 = 1 即按成功）。**无客户端代码可核，标为无法判定**，不建议现在改。
5. **催化剂 +15% 与等级惩罚是加算还是乘算**——两份 wiki 公式冲突；玩家 100 级时不触发惩罚，影响 ≈ 0。
6. `@ts-expect-error` 实测 **4 处**（不是 5 处），逐条看过，都不掩盖业务错误。
7. 性能里的毫秒数来自 node 实测 + 移动端 3~5× 的外推，**不是真机浏览器数据**。

---

## 建议的修复顺序

**第一批（会算错数，影响用户决策）**
1. P0-1 容差键名（改一行 + 补集成测试）
2. P0-4 / P0-5 chainbuilder 与 charmtransform 漏 sr（同时改掉那条锁死错误行为的测试）
3. P0-2 大全套转化 count
4. P0-6 强化练级页补税
5. P0-3 marketData 回填条件

**第二批（会白屏/丢数据）**
6. `main.ts` 挂载链加 catch + 显示错误态
7. `game.ts` 的 `JSON.parse` / `setItem` 加 try/catch 与配额降级
8. P0-7 手工价校验
9. 全局 `errorHandler` + `unhandledrejection`

**第三批（性能）**
10. 4MB 写盘加 timestamp 去重（一行）
11. 4 次 `structuredClone` 合并成 1 次
12. 市场监控锚点提到循环外

**第四批（工程防线）**
13. 装 pre-commit + 补 CI 的 lint/test job + `test` 脚本加 `--run`
14. 清理 2188 个 lint 问题（先 `--fix` 格式，再人工处理 30 条真实问题），并把 `docs/*.md` 移出 lint 范围
15. 修 `manualChunks` 的分支顺序

---

*本报告的每条 P0 都可用 `git show` + 对应文件行号复核；P0-1/2/3/4 已由本人直接读代码或统计 `data.json` 确认。*
