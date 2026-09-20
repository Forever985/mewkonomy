<div align="center">
  <img alt="logo" width="120" height="120" src="./src/common/assets/images/layouts/logo.png">
  <h1>Milkonomy</h1>
</div>

## 介绍

牛牛放置利润计算

本项目因个人原因已停止维护

## 数据更新

站点数据发布在 `gh-pages` 分支的 `data/` 目录，由 GitHub Actions 自动维护，无需本地挂机：

- `.github/workflows/market-history.yml`：每小时抓取官方 `marketplace.json`，向 `data/market_history.json` 追加一个行情采样点（滚动保留 7 天、最多 520 点）。官方快照本身是 1 小时粒度，重复运行会按时间戳自动去重。
- `.github/workflows/update-data.yml`：每天抓取上游 `data.json` / `market.json`，带多源回退与「禁止降级」护栏。

两条 workflow 互相独立，各自只覆盖自己负责的数据文件（`gh-pages:data/` 为多脚本共享目录，不整目录替换）。

## 许可

[MIT](./LICENSE) License © 2025 [luyh7](https://github.com/luyh7)
