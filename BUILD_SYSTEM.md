# Milkonomy 双版本构建系统

本项目支持构建两个不同的版本：

## 版本说明

### 公开版本 (Public Version)

- 只包含公开可访问的页面和功能
- 适合部署到公开网站
- 不包含需要特殊权限的页面
- 构建包更小，只包含必要的功能

### 私有版本 (Private Version)

- 包含所有页面和功能
- 包含私有页面和高级功能
- 适合内部部署或授权用户使用
- 功能完整的版本

## 构建命令

### 开发环境

```bash
# 启动公开版本开发服务器
pnpm dev:public

# 启动私有版本开发服务器
pnpm dev:private

# 默认启动私有版本
pnpm dev
```

### 生产构建

```bash
# 构建公开版本
pnpm build:public

# 构建私有版本
pnpm build:private

# 默认构建公开版本
pnpm build
```

## 技术实现

### 环境变量配置

- `.env.public` - 公开版本环境变量
- `.env.private` - 私有版本环境变量
- `VITE_BUILD_MODE` - 控制构建模式的关键变量

### 路由分离

- `src/router/routes/public.ts` - 公开路由配置
- `src/router/routes/private.ts` - 私有路由配置
- `src/router/index.ts` - 根据构建模式动态组合路由

### 构建优化

- Vite 插件在公开版本构建时排除私有页面文件
- 条件编译确保私有代码不会被打包到公开版本
- Tree shaking 移除未使用的代码

### 私有页面列表

以下页面只在私有版本中可用：

- 超级强化计算 (`/enhancest`)
- 超级强化分解 (`/enhanposest`)
- 打野工具 (`/jungle`)
- 超级打野工具 (`/junglest`)
- 继承打野工具 (`/junglerit`)
- 继承 (`/inherit`)
- 分解 (`/decompose`)
- 捡漏工具 (`/pickout`)
- 制作炼金 (`/manualchemy`)
- 示例集合 (`/demo/*`)

## 注意事项

1. 在开发新功能时，请明确该功能属于哪个版本
2. 私有功能应放在 `private.ts` 路由文件中
3. 公开功能应放在 `public.ts` 路由文件中
4. 测试时请确保两个版本都能正常构建和运行
5. 部署时请使用对应的部署命令以避免混淆

## 数据更新流水线（GitHub Actions）

线上站点 `gh-pages:data/` 下的数据由两条**互相独立**的 workflow 维护，与上面的本地构建/部署命令无关：

| workflow | 频率 | 职责 | 负责的数据文件 |
| --- | --- | --- | --- |
| `market-history.yml`（Market History Sampling） | 每 20 分钟（`*/20 * * * *`）+ 手动触发 | 抓官方 `marketplace.json`（约 0.4s）追加采样点，滚动 7 天、上限 520 点 | `data/market_history.json` |
| `update-data.yml`（Update Game Data） | 每天 UTC 00:20（`20 0 * * *`） | 抓上游 `data.json` / `market.json`，多源回退 + 「禁止降级」护栏 | `data/data.json`、`data/market.json` |

- **刻意解耦**：历史采样与游戏数据抓取原先共用一个 job，`data.json` 上游一挂，历史采样会一起停摆（线上曾连续 8 天没有新采样点）。
- **共享目录红线**：`gh-pages` 的 `data/` 由多个脚本写入，每个脚本只覆盖自己负责的文件，禁止整目录替换，并在提交前用 `assert_no_unintended_deletions()` 校验（历史事故 commit `93f0107` 曾误删线上 4MB 的 `data.json` 与 70KB 的 `market.json`）。
- 两条 workflow 都先检出 `gh-pages` 分支，再 `git checkout main -- scripts/<file>` 取 `main` 上的脚本执行。
