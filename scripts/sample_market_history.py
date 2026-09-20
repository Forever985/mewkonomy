"""
MewKonomy 市场历史高频采样脚本

作用：
  定时抓取官方 marketplace.json 快照，追加一个采样点到 public/data/market_history.json
  （滚动保留最近 7 天），供线上（GitHub Pages）页面的「市场监控 - 涨跌」使用。

为什么要独立成一个脚本：
  历史上历史采样和 data.json 抓取写在同一个 workflow 里，只要游戏数据源挂掉，
  历史采样就一起停摆 —— 实测线上因此连续 8 天没有任何新采样点。
  本脚本只依赖官方 marketplace.json（端点快且稳定），与游戏数据抓取完全解耦。

采样点结构：
  { "t": epoch秒, "p": { hrid: { level: [ask, bid, volume] } } }

  兼容说明：早期版本只写 [ask, price]（两个元素），前端已同时兼容两种长度。
  volume 是官方当日累计成交量，因此前端做成交量对比时要看「增量/速率」而不是绝对值。

运行方式：
  - CI：.github/workflows/market-history.yml 每 20 分钟调用
        需要环境变量 GITHUB_REPOSITORY 与 GITHUB_TOKEN
  - 本地：python scripts/sample_market_history.py
          只抓取不推送：DRY_RUN=1 python scripts/sample_market_history.py
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from typing import Any, Dict, List

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Windows 控制台默认 GBK，遇到无法编码的字符会抛 UnicodeEncodeError 中断脚本
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass

MARKETPLACE_URL = "https://www.milkywayidle.com/game_data/marketplace.json"

OUTPUT_DIR = "./public/data"
HISTORY_FILE = "market_history.json"
# 线上数据读取目录（CI 检出 gh-pages → ./data；本地在 main 上跑 → ./public/data）
READ_DIRS = ("./data", "./public/data")

# 保留窗口与上限：7 天 / 每 20 分钟一个点 → 7*24*3 = 504
HISTORY_WINDOW_SEC = 7 * 24 * 3600
HISTORY_MAX_SAMPLES = 520

# 同一时间戳不重复采样（CI 偶发重跑时避免刷出一堆重复点）
HTTP_TIMEOUT = 30
RETRY_TOTAL = 4

DRY_RUN = os.environ.get("DRY_RUN") == "1"

_session = requests.Session()
_session.headers.update({"User-Agent": "mewkonomy-market-sampler/1.0 (+https://github.com/Forever985/mewkonomy)"})
_retry = Retry(
    total=RETRY_TOTAL,
    connect=RETRY_TOTAL,
    read=RETRY_TOTAL,
    status=RETRY_TOTAL,
    backoff_factor=1.2,
    status_forcelist=(429, 500, 502, 503, 504),
    allowed_methods=frozenset(["GET"]),
)
_session.mount("https://", HTTPAdapter(max_retries=_retry))
_session.mount("http://", HTTPAdapter(max_retries=_retry))


def load_json(path: str) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as e:
        print(f"   [!] 忽略损坏的 JSON：{path}（{e}）")
        return None


def load_deployed_history() -> List[Dict[str, Any]]:
    """读取线上已有的历史（gh-pages 的 data/ 优先，本地 public/data 兜底）。"""
    for directory in READ_DIRS:
        path = os.path.join(directory, HISTORY_FILE)
        if not os.path.exists(path):
            continue
        data = load_json(path)
        if isinstance(data, list):
            print(f"   -> 读取既有历史：{path}（{len(data)} 个采样点）")
            return data
    return []


def save_history(history: List[Dict[str, Any]], output_file: str) -> None:
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    # 紧凑写入：采样点很多，缩进会显著放大文件体积
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, separators=(",", ":"))


def build_sample(marketplace: Dict[str, Any]) -> Dict[str, Any]:
    """把官方 marketplace 快照压成一个采样点：hrid → level → [ask, bid, volume]"""
    md = marketplace.get("marketData") or {}
    sample: Dict[str, Any] = {"t": int(marketplace.get("timestamp") or marketplace.get("time") or time.time()), "p": {}}
    for hrid, entry in (md.items() if isinstance(md, dict) else []):
        if not isinstance(entry, dict):
            continue
        levels: Dict[str, List[int]] = {}
        for level, e in entry.items():
            if not isinstance(e, dict):
                continue
            ask = e.get("a")
            bid = e.get("b")
            vol = e.get("v")
            levels[level] = [
                ask if isinstance(ask, (int, float)) else -1,
                bid if isinstance(bid, (int, float)) else -1,
                vol if isinstance(vol, (int, float)) else 0,
            ]
        sample["p"][hrid] = levels
    return sample


def deploy_to_gh_pages() -> None:
    if DRY_RUN:
        print("[DRY_RUN] 跳过部署（数据已写入 " + OUTPUT_DIR + "）")
        return

    github_repository = os.environ.get("GITHUB_REPOSITORY")
    github_token = os.environ.get("GITHUB_TOKEN")
    if not github_repository or not github_token:
        raise SystemExit(
            "[x] 缺少 GITHUB_REPOSITORY / GITHUB_TOKEN，无法推送 gh-pages。\n"
            "   本地只想抓取时请用：DRY_RUN=1 python scripts/sample_market_history.py"
        )

    temp_dir = "gh-pages-temp"
    try:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)

        subprocess.run(
            [
                "git", "clone", "--branch", "gh-pages", "--single-branch",
                f"https://x-access-token:{github_token}@github.com/{github_repository}.git",
                temp_dir,
            ],
            check=True,
        )

        target_dir = os.path.join(temp_dir, "data")
        if os.path.exists(target_dir):
            shutil.rmtree(target_dir)
        shutil.copytree(OUTPUT_DIR, target_dir)

        status = subprocess.run(
            ["git", "status", "--porcelain"], cwd=temp_dir, capture_output=True, text=True, check=True
        )
        if not status.stdout.strip():
            print("[=] 线上无差异，跳过部署")
            return

        subprocess.run(["git", "config", "user.name", "github-actions[bot]"], cwd=temp_dir, check=True)
        subprocess.run(
            ["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
            cwd=temp_dir, check=True,
        )
        subprocess.run(["git", "add", "--", "data"], cwd=temp_dir, check=True)
        subprocess.run(
            ["git", "commit", "-m", "chore(data): market history sample", "--", "data"],
            cwd=temp_dir, check=True,
        )
        subprocess.run(["git", "push", "origin", "gh-pages"], cwd=temp_dir, check=True)
        print("[OK] 已部署到 gh-pages")
    except subprocess.CalledProcessError as e:
        print(f"[x] 部署失败：{e}")
        raise
    finally:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)


def main() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    output_file = os.path.join(OUTPUT_DIR, HISTORY_FILE)

    print(f"-> 抓取官方市场快照：{MARKETPLACE_URL}")
    response = _session.get(MARKETPLACE_URL, timeout=HTTP_TIMEOUT)
    response.raise_for_status()
    marketplace = response.json()

    market_item_count = len(marketplace.get("marketData") or {})
    if market_item_count == 0:
        # 关键护栏：绝不用「空快照」覆盖已有历史，否则一次异常就把 7 天数据清空
        print("[!] 抓到的 marketplace 没有任何物品，判定为异常响应，放弃本次采样（不覆盖线上）")
        raise SystemExit(0)

    sample = build_sample(marketplace)
    print(f"   [OK] 快照 timestamp={sample['t']}，物品数={market_item_count}")

    history = load_deployed_history()
    # 过滤结构不完整的旧采样点
    history = [
        s for s in history
        if isinstance(s, dict) and isinstance(s.get("t"), (int, float)) and isinstance(s.get("p"), dict)
    ]

    if history and history[-1].get("t") == sample["t"]:
        print(f"   [=] 时间戳 {sample['t']} 与上一点相同，不重复采样")
        save_history(history, output_file)
        return

    history.append(sample)

    now = time.time()
    # 先按时间窗裁剪，再按条数上限兜底
    history = [h for h in history if now - h["t"] < HISTORY_WINDOW_SEC]
    if len(history) > HISTORY_MAX_SAMPLES:
        history = history[-HISTORY_MAX_SAMPLES:]

    save_history(history, output_file)
    span_hours = (history[-1]["t"] - history[0]["t"]) / 3600 if len(history) > 1 else 0
    print(f"   [OK] 历史已更新：{len(history)} 个采样点，覆盖 {span_hours:.1f} 小时")

    deploy_to_gh_pages()


if __name__ == "__main__":
    main()
