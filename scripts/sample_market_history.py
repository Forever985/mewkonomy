"""
MewKonomy 市场历史采样脚本

作用：
  定时抓取官方 marketplace.json 快照，追加一个采样点到 gh-pages 的
  data/market_history_<UTC日>T<HH>.json 分片（按 UTC 6 小时分块，滚动保留 7 天），
  供线上（GitHub Pages）页面的「市场监控」使用。

为什么要独立成一个脚本：
  历史上历史采样和 data.json 抓取写在同一个 workflow 里，只要游戏数据源挂掉，
  历史采样就一起停摆 —— 实测线上因此连续 8 天没有任何新采样点。
  本脚本只依赖官方 marketplace.json（端点快且稳定），与游戏数据抓取完全解耦。

----------------------------------------------------------------------------
归档格式 v2：按 UTC 6 小时分片 + hrid 字典编码
----------------------------------------------------------------------------
为什么改：官方快照 872 件物品 × 平均 3.4 个强化档 = 每点约 2992 个条目，
沿用 `{"hrid":{"level":[ask,bid,volume]}}` 的朴素结构是 **90.6 KB/点**，
7 天 168 点就是 14.5 MiB —— 而市场监控页每次打开都要把它下载+解析（实测过卡顿）。
字典编码把 hrid 只存一次、并省掉空字段，实测降到 **65.3 KB/点（72%）**、gzip 后 30%；
再按 6 小时分片后，页面只取所选时间窗覆盖到的分片（默认 6 小时窗只要 1~2 片 ≈ 125 KB）。

分片文件：`data/market_history_YYYY-MM-DDTHH.json`，HH ∈ {00,06,12,18}（UTC）
  {
    "v": 2,
    "d": ["/items/apple", ...],          // hrid 字典，整片只出现一次
    "s": [                               // 采样点，按时间升序
      [t, [[i, l, a], [i, l, a, b], [i, l, a, b, v]], ...]]
    ]
  }
行（row）是**变长**的，靠长度区分，规则如下（a/b/v 缺省分别表示 -1/-1/0）：
  [i,l,a]        → ask=a,  bid=-1, volume=0      （只有左挂单）
  [i,l,a,b]      → volume=0                      （有买卖报价、当日无成交）
  [i,l,-1,b]     → 只有右收购
  [i,l,a,b,v]    → 三者齐全
  `i` 是 hrid 在字典里的下标，`l` 是**强化等级**（0~20，不是物品等级）。
  完全空白的条目（a<0 且 b<0 且 v<=0）不写 —— 实测占比 0%，省不出体积但逻辑齐全。

  前端解码见 src/common/apis/marketvolume/history.ts 的 `decodeShard`，
  两边格式必须同步；tests/marketvolume-shard.test.ts 用本脚本产出的 fixture 做往返校验。

采样点 `t` 取自官方 marketplace.json 的顶层 `timestamp` 字段，即**市场快照本身的生成时间**，
不是「本脚本运行的时间」。因此若官方快照尚未刷新，连续两次运行会拿到同一个 `t`，
此时按下面的去重规则跳过 —— 这是**预期行为**（同一个快照重复写没有意义），
并不代表流水线停摆。

实测该快照是**整点、每小时**才前进一次（连续 18 分钟观察同一个值不变），
所以「市场历史」的有效分辨率就是 1 小时。

  为什么仍要外部触发（cron-job.org → workflow_dispatch）：
  GitHub Actions 的 `schedule` 是 best-effort 的：本仓库实测声明 60 分钟一次，
  实际相邻间隔 143~466 分钟（中位 307），19 次运行全部 success —— 是**触发器被延迟**，
  不是脚本失败。所以真正的每小时靠外部按时打 workflow_dispatch，本 workflow 的 cron
  只作为兜底。详见 docs/DEVELOPER_GUIDE.md「服务端归档」。

  官方 marketplace.json 顶层只有 `timestamp` 与 `marketData` 两个字段；
  `marketData[hrid][level]` 形如 `{"a": ask, "b": bid, "p": price, "v": volume}`，
  其中 `v` 是当日累计成交量。本脚本只取 a/b/v（p 可由 a/b 推出）。

  兼容说明：v1（`data/market_history.json`）是单文件、朴素结构、最多 520 点。
  保留期结束后本脚本**不再更新**它，但也不会删除（回退用）；前端在没有分片时才读它。

运行方式：
  - CI：.github/workflows/market-history.yml 每小时调用
        需要环境变量 GITHUB_REPOSITORY 与 GITHUB_TOKEN
  - 本地：python scripts/sample_market_history.py
          只抓取不推送：DRY_RUN=1 python scripts/sample_market_history.py
"""
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

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
# 线上数据读取目录（CI 检出 gh-pages → ./data；本地在 main 上跑 → ./public/data）
READ_DIRS = ("./data", "./public/data")

SHARD_PREFIX = "market_history_"
SHARD_SUFFIX = ".json"
# v1 单文件（只读兼容 + 迁移来源，本脚本不再写它）
LEGACY_FILE = "market_history.json"

# 保留窗口：7 天 / 官方快照 1 小时粒度 → 168 个点
HISTORY_WINDOW_SEC = 7 * 24 * 3600
HISTORY_MAX_SAMPLES = 168
# 分片粒度：UTC 6 小时一块 → 7 天 = 28 片，每片 6 个点
SHARD_HOURS = 6

HTTP_TIMEOUT = 30
RETRY_TOTAL = 4

DRY_RUN = os.environ.get("DRY_RUN") == "1"

_session = requests.Session()
_session.headers.update({"User-Agent": "mewkonomy-market-sampler/2.0 (+https://github.com/Forever985/mewkonomy)"})
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


# ---------------------------------------------------------------------------
# 分片格式 v2：编解码
# ---------------------------------------------------------------------------
def shard_key(t: int) -> str:
    """epoch 秒 → 所属 UTC 6 小时块键，如 "2026-09-23T18" """
    dt = datetime.fromtimestamp(int(t), tz=timezone.utc)
    hour = (dt.hour // SHARD_HOURS) * SHARD_HOURS
    return f"{dt.year:04d}-{dt.month:02d}-{dt.day:02d}T{hour:02d}"


def shard_filename(key: str) -> str:
    return f"{SHARD_PREFIX}{key}{SHARD_SUFFIX}"


def is_shard_filename(name: str) -> bool:
    return name.startswith(SHARD_PREFIX) and name.endswith(SHARD_SUFFIX)


def encode_shard(samples: List[Dict[str, Any]]) -> Dict[str, Any]:
    """[MarketPriceSample] → v2 紧凑结构（hrid 字典 + 变长行），保持时间升序。"""
    items: List[str] = []
    index: Dict[str, int] = {}
    rows_by_sample: List[List[Any]] = []

    for sample in samples:
        rows: List[List[int]] = []
        for hrid, levels in (sample.get("p") or {}).items():
            idx = index.get(hrid)
            if idx is None:
                idx = len(items)
                index[hrid] = idx
                items.append(hrid)
            for level, triple in levels.items():
                ask = int(triple[0]) if len(triple) > 0 and isinstance(triple[0], (int, float)) else -1
                bid = int(triple[1]) if len(triple) > 1 and isinstance(triple[1], (int, float)) else -1
                vol = int(triple[2]) if len(triple) > 2 and isinstance(triple[2], (int, float)) else 0
                if ask < 0 and bid < 0 and vol <= 0:
                    continue
                lv = int(level)
                if vol > 0:
                    rows.append([idx, lv, ask, bid, vol])
                elif bid >= 0:
                    rows.append([idx, lv, ask, bid])
                else:
                    rows.append([idx, lv, ask])
        rows_by_sample.append([int(sample["t"]), rows])

    return {"v": 2, "d": items, "s": rows_by_sample}


def decode_shard(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """v2 紧凑结构 → [MarketPriceSample]（与前端 decodeShard 必须行为一致）。"""
    items = payload.get("d") or []
    out: List[Dict[str, Any]] = []
    for entry in payload.get("s") or []:
        t, rows = entry[0], entry[1]
        prices: Dict[str, Dict[str, List[int]]] = {}
        for row in rows:
            hrid = items[row[0]]
            level = str(row[1])
            ask = row[2] if len(row) > 2 else -1
            bid = row[3] if len(row) > 3 else -1
            vol = row[4] if len(row) > 4 else 0
            prices.setdefault(hrid, {})[level] = [ask, bid, vol]
        out.append({"t": int(t), "p": prices})
    return out


# ---------------------------------------------------------------------------
# 读写
# ---------------------------------------------------------------------------
def load_json(path: str) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as e:
        print(f"   [!] 忽略损坏的 JSON：{path}（{e}）")
        return None


def _first_existing(directory_candidates, filename: str) -> Optional[str]:
    for directory in directory_candidates:
        path = os.path.join(directory, filename)
        if os.path.exists(path):
            return path
    return None


def load_legacy_history() -> List[Dict[str, Any]]:
    """读取 v1 单文件历史（迁移来源 + 回退兼容）。"""
    path = _first_existing(READ_DIRS, LEGACY_FILE)
    if not path:
        return []
    data = load_json(path)
    if isinstance(data, list):
        print(f"   -> 读取 v1 单文件历史：{path}（{len(data)} 个采样点）")
        return [s for s in data if isinstance(s, dict) and isinstance(s.get("t"), (int, float)) and isinstance(s.get("p"), dict)]
    return []


def load_shards() -> Dict[str, List[Dict[str, Any]]]:
    """读取已有分片：{块键: [采样点]}，来源目录以第一个存在分片的为准。"""
    for directory in READ_DIRS:
        if not os.path.isdir(directory):
            continue
        names = sorted(n for n in os.listdir(directory) if is_shard_filename(n))
        if not names:
            continue
        shards: Dict[str, List[Dict[str, Any]]] = {}
        for name in names:
            key = name[len(SHARD_PREFIX):-len(SHARD_SUFFIX)]
            payload = load_json(os.path.join(directory, name))
            if isinstance(payload, dict) and payload.get("v") == 2:
                samples = decode_shard(payload)
                if samples:
                    shards[key] = samples
        print(f"   -> 读取既有分片：{directory}（{len(shards)} 片，{sum(len(v) for v in shards.values())} 个采样点）")
        return shards
    return {}


def write_shard(path: str, samples: List[Dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = encode_shard(samples)
    # 紧凑写入：缩进会显著放大体积
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))


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


# ---------------------------------------------------------------------------
# 合并与裁剪（纯函数，便于单测/推演）
# ---------------------------------------------------------------------------
def merge_samples(shards: Dict[str, List[Dict[str, Any]]], extra: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """把 extra 采样点并入分片字典，按 `t` 去重（后写覆盖）。"""
    buckets: Dict[str, Dict[int, Dict[str, Any]]] = {
        key: {int(s["t"]): s for s in samples} for key, samples in shards.items()
    }
    for sample in extra:
        key = shard_key(sample["t"])
        buckets.setdefault(key, {})[int(sample["t"])] = sample
    return {key: [v[k] for k in sorted(v)] for key, v in buckets.items() if v}


def prune_samples(shards: Dict[str, List[Dict[str, Any]]], now: float) -> Dict[str, List[Dict[str, Any]]]:
    """裁掉保留窗口之外的点；再按总条数上限兜底（超限时丢最老的）。"""
    cutoff = now - HISTORY_WINDOW_SEC
    kept: Dict[str, List[Dict[str, Any]]] = {}
    for key, samples in shards.items():
        alive = [s for s in samples if s["t"] >= cutoff]
        if alive:
            kept[key] = alive

    total = sum(len(v) for v in kept.values())
    if total > HISTORY_MAX_SAMPLES:
        # 从最老的块开始整块丢，直到不超限
        for key in sorted(kept):
            if total <= HISTORY_MAX_SAMPLES:
                break
            total -= len(kept.pop(key))
    return dict(sorted(kept.items()))


# ---------------------------------------------------------------------------
# 部署
# ---------------------------------------------------------------------------
def assert_no_unintended_deletions(repo_dir: str, owned_files: set) -> None:
    """
    确认本次改动只涉及 owned_files：若 git status 里出现本脚本不负责的删除/修改，直接失败。

    gh-pages 的 data/ 由多个脚本共享写入，谁都不该顺手删掉别人的文件。
    """
    result = subprocess.run(
        ["git", "status", "--porcelain"], cwd=repo_dir, capture_output=True, text=True, check=True
    )
    offending = []
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        code, path = line[:2], line[3:].strip()
        name = os.path.basename(path)
        # 只允许「新增/修改/未跟踪」本脚本负责的文件；任何删除都算越权
        if "D" in code and name not in owned_files:
            offending.append(line)
        elif path.startswith("data/") and name not in owned_files and "D" not in code and code.strip() not in ("", "??"):
            offending.append(line)
    if offending:
        raise SystemExit(
            "[x] 拒绝部署：本次改动波及了非本脚本负责的文件，已中止以免误删线上数据：\n"
            + "\n".join("    " + o for o in offending)
        )


def push_with_retry(repo_dir: str, branch: str = "gh-pages", attempts: int = 3) -> None:
    """
    推送 gh-pages，被抢占时 rebase 后重试。

    为什么需要：update-data.yml 与 market-history.yml 用的是**不同的** concurrency group，
    两者可能先后推送 gh-pages。后推的一方若直接失败，这一次采样就白跑了
    （外部触发器下一小时才会再来）。rebase 后重试成本极低。
    """
    for attempt in range(1, attempts + 1):
        push = subprocess.run(["git", "push", "origin", branch], cwd=repo_dir, capture_output=True, text=True)
        if push.returncode == 0:
            return
        print(f"   [!] 推送失败（第 {attempt}/{attempts} 次）：{(push.stderr or '').strip()[-200:]}")
        if attempt == attempts:
            raise SystemExit(f"[x] gh-pages 推送连续 {attempts} 次失败，放弃本次部署")
        subprocess.run(["git", "pull", "--rebase", "--autostash", "origin", branch], cwd=repo_dir, check=True)


def deploy_to_gh_pages(local_files: Dict[str, str]) -> None:
    """把本地分片同步到 gh-pages/data：新增/更新指定分片，并删除超出保留期的旧分片。"""
    if DRY_RUN:
        print(f"[DRY_RUN] 跳过部署（数据已写入 {OUTPUT_DIR}，本次 {len(local_files)} 个分片）")
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

        # —— 只动本脚本负责的分片，绝不整目录替换 ——
        # 教训：早期版本这里是 `rmtree(data/) + copytree(public/data)`，
        # 而 public/data 只含历史文件，于是每次采样都会把线上
        # data/data.json 与 data/market.json 一起删掉（93f0107 实测删了 4MB）。
        # gh-pages 的 data/ 是「多来源共享目录」，任何一方都无权清空它。
        target_dir = os.path.join(temp_dir, "data")
        os.makedirs(target_dir, exist_ok=True)

        wanted = {os.path.basename(p) for p in local_files.values()}
        for name, local_path in local_files.items():
            shutil.copy2(local_path, os.path.join(target_dir, name))

        # 删除超出保留期的旧分片（只删本脚本自己的分片文件）
        removed = []
        for name in os.listdir(target_dir):
            if is_shard_filename(name) and name not in wanted:
                os.remove(os.path.join(target_dir, name))
                removed.append(name)
        if removed:
            print(f"   [OK] 清理过期分片：{len(removed)} 个（{', '.join(sorted(removed)[:3])}...）")

        # 双保险：确认没有意外删除本脚本不负责的文件
        assert_no_unintended_deletions(temp_dir, wanted | set(removed))

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
            ["git", "commit", "-m", "chore(data): market history shard", "--", "data"],
            cwd=temp_dir, check=True,
        )
        push_with_retry(temp_dir)
        print("[OK] 已部署到 gh-pages")
    except subprocess.CalledProcessError as e:
        print(f"[x] 部署失败：{e}")
        raise
    finally:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)


def main() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)

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
    print(f"   [OK] 快照 timestamp={sample['t']}（{shard_key(sample['t'])} 块），物品数={market_item_count}")

    shards = load_shards()
    # 首次迁移：把 v1 单文件里的历史并进分片，迁移后不再更新该文件
    legacy = load_legacy_history()
    if legacy:
        shards = merge_samples(shards, legacy)

    known = {int(s["t"]) for samples in shards.values() for s in samples}
    if sample["t"] in known:
        print(f"   [=] 时间戳 {sample['t']} 已存在，不重复采样")
        return

    shards = merge_samples(shards, [sample])
    shards = prune_samples(shards, time.time())

    # 把裁剪后的结果全部落到本地（分片粒度小，整块重写比增量改更不容易出错）
    local_files: Dict[str, str] = {}
    for key, samples in shards.items():
        name = shard_filename(key)
        path = os.path.join(OUTPUT_DIR, name)
        write_shard(path, samples)
        local_files[name] = path

    # 本地也清掉过期分片，避免 public/data 里留下会被误提交的旧文件
    for name in os.listdir(OUTPUT_DIR):
        if is_shard_filename(name) and name not in local_files:
            os.remove(os.path.join(OUTPUT_DIR, name))

    total = sum(len(v) for v in shards.values())
    all_t = [s["t"] for v in shards.values() for s in v]
    span_hours = (max(all_t) - min(all_t)) / 3600 if len(all_t) > 1 else 0
    size_kb = sum(os.path.getsize(p) for p in local_files.values()) / 1024
    print(
        f"   [OK] 归档已更新：{len(local_files)} 个分片 / {total} 个采样点，"
        f"覆盖 {span_hours:.1f} 小时，共 {size_kb:.0f} KB"
    )

    deploy_to_gh_pages(local_files)


if __name__ == "__main__":
    main()
