"""
MewKonomy 线上游戏数据抓取与部署脚本。

作用：
  1. 抓取上游 data.json / market.json，与线上（gh-pages 分支的 data/）比对，有变化才更新；
  2. 抓取官方 marketplace.json，追加一个市场历史采样点到 market_history.json
     （滚动保留最近 26 小时，供前端「涨跌」计算使用）；
  3. 有变化时把 public/data 整体部署到 gh-pages 分支的 data/ 目录。

运行方式：
  - CI：.github/workflows/update-data.yml 每小时调用；
        需要环境变量 GITHUB_REPOSITORY 与 GITHUB_TOKEN
        （workflow 传入内置 token，配合 permissions: contents: write 即可推送 gh-pages）。
  - 本地：python scripts/fetch_game_data.py
          只抓取不推送：DRY_RUN=1 python scripts/fetch_game_data.py
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from typing import Any, Dict

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Windows 控制台默认 GBK，遇到无法编码的字符会直接抛 UnicodeEncodeError 中断脚本，
# 这里降级成替换字符（日志仍可读，不会因为打印而失败）。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass

DATA_URL = [
    "https://raw.githubusercontent.com/silent1b/MWIData/main/init_client_info.json",
    "https://raw.githubusercontent.com/holychikenz/MWIApi/main/milkyapi.json",
]

# 官方市场快照（与前端展示同源），用于涨跌历史归档
MARKETPLACE_URL = "https://www.milkywayidle.com/game_data/marketplace.json"

# 待部署目录（与本地 `pnpm build` 的产物结构一致：public/data → dist/data → gh-pages:data）
OUTPUT_DIR = "./public/data"
# 线上数据读取目录，按顺序取第一个存在的：
#   CI 检出的是 gh-pages 分支 → ./data；本地在 main 分支跑 → ./data 或 ./public/data
READ_DIRS = ("./data", "./public/data")
DATA_FILES = ("data.json", "market.json")
HISTORY_FILE = "market_history.json"
# 历史采样窗口（与前端 history.ts 保持一致）
HISTORY_WINDOW_SEC = 26 * 3600
# 历史采样点数量硬上限（正常窗口内约 26 个）
HISTORY_MAX_SAMPLES = 26
# 单次 HTTP 请求超时与重试（上游偶发掐断连接，重试可自愈）
HTTP_TIMEOUT = 30
RETRY_TOTAL = 4

DRY_RUN = os.environ.get("DRY_RUN") == "1"

_session = requests.Session()
_session.headers.update({"User-Agent": "mewkonomy-update-data/1.0 (+https://github.com/Forever985/mewkonomy)"})
_retry = Retry(
    total=RETRY_TOTAL,
    connect=RETRY_TOTAL,
    read=RETRY_TOTAL,
    status=RETRY_TOTAL,
    backoff_factor=1.5,
    status_forcelist=(429, 500, 502, 503, 504),
    allowed_methods=frozenset(["GET"]),
)
_session.mount("https://", HTTPAdapter(max_retries=_retry))
_session.mount("http://", HTTPAdapter(max_retries=_retry))


def get_file_hash(data: Any) -> str:
    """计算数据的 MD5 哈希值"""
    json_str = json.dumps(data, sort_keys=True)
    return hashlib.md5(json_str.encode()).hexdigest()


def fetch_data(url: str) -> Any:
    """从远程获取 JSON 数据（带超时与重试）"""
    response = _session.get(url, timeout=HTTP_TIMEOUT)
    response.raise_for_status()
    return response.json()


def save_as_json(data: Any, output_file: str, compact: bool = False) -> None:
    """保存数据为 JSON 文件；compact=True 时用紧凑格式（历史文件体积小很多）"""
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        if compact:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(data, f, ensure_ascii=False, indent=2)


def load_json(file_path: str) -> Any:
    """读取 JSON 文件；不存在或损坏时返回 None"""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as e:
        print(f"   [!] 忽略损坏的 JSON：{file_path}（{e}）")
        return None


def load_deployed_json(filename: str) -> Any:
    """读取线上（gh-pages 的 data/）已有数据，本地 public/data 兜底。"""
    for directory in READ_DIRS:
        path = os.path.join(directory, filename)
        if not os.path.exists(path):
            continue
        data = load_json(path)
        if data is not None:
            print(f"   -> 读取既有数据：{path}")
            return data
    return None


def update_market_history(marketplace_data: Dict[str, Any]) -> bool:
    """将官方 marketplace 快照追加为历史采样点（滚动保留最近 26h）。返回是否新增。"""
    md = marketplace_data.get("marketData")
    timestamp = marketplace_data.get("timestamp") or marketplace_data.get("time")
    output_file = os.path.join(OUTPUT_DIR, HISTORY_FILE)
    if not md or not timestamp:
        print("   [!] marketplace 数据缺少 marketData/timestamp，跳过历史采样")
        return False

    existing = load_deployed_json(HISTORY_FILE)
    history = existing if isinstance(existing, list) else []
    # 过滤掉结构不完整的旧采样点，避免 KeyError
    history = [
        s
        for s in history
        if isinstance(s, dict) and isinstance(s.get("t"), (int, float)) and isinstance(s.get("p"), dict)
    ]

    if history and history[-1].get("t") == timestamp:
        print(f"   = 市场历史：时间戳 {timestamp} 与上一点相同，不重复采样")
        save_as_json(history, output_file, compact=True)  # 仍落盘，保证部署目录完整
        return False

    sample = {"t": timestamp, "p": {}}
    for hrid, entry in (md.items() if isinstance(md, dict) else []):
        pp = {}
        if isinstance(entry, dict):
            for level, e in entry.items():
                if isinstance(e, dict):
                    pp[level] = [e.get("a"), e.get("p")]
        sample["p"][hrid] = pp

    history.append(sample)
    now = time.time()
    history = [h for h in history if now - h["t"] < HISTORY_WINDOW_SEC][-HISTORY_MAX_SAMPLES:]
    save_as_json(history, output_file, compact=True)
    print(f"   [OK] 市场历史：新增采样 t={timestamp}，当前共 {len(history)} 个采样点")
    return True


def deploy_to_gh_pages() -> None:
    """部署 public/data 到 gh-pages 分支"""
    if DRY_RUN:
        print("[DRY_RUN] 跳过部署（数据已写入 " + OUTPUT_DIR + "）")
        return

    github_repository = os.environ.get("GITHUB_REPOSITORY")
    github_token = os.environ.get("GITHUB_TOKEN")
    if not github_repository or not github_token:
        raise SystemExit(
            "[x] 缺少 GITHUB_REPOSITORY / GITHUB_TOKEN 环境变量，无法推送 gh-pages。\n"
            "   本地只想抓取数据时请用：DRY_RUN=1 python scripts/fetch_game_data.py"
        )

    temp_dir = "gh-pages-temp"
    try:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)

        subprocess.run(
            [
                "git",
                "clone",
                "--branch",
                "gh-pages",
                "--single-branch",
                f"https://x-access-token:{github_token}@github.com/{github_repository}.git",
                temp_dir,
            ],
            check=True,
        )

        target_data_dir = os.path.join(temp_dir, "data")
        if os.path.exists(target_data_dir):
            shutil.rmtree(target_data_dir)
        shutil.copytree(OUTPUT_DIR, target_data_dir)

        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=temp_dir,
            capture_output=True,
            text=True,
            check=True,
        )
        if not result.stdout.strip():
            print("[!] 线上无差异，跳过部署")
            return

        subprocess.run(["git", "config", "user.name", "github-actions[bot]"], cwd=temp_dir, check=True)
        subprocess.run(
            ["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
            cwd=temp_dir,
            check=True,
        )
        subprocess.run(["git", "add", "--", "data"], cwd=temp_dir, check=True)
        subprocess.run(
            ["git", "commit", "-m", "Update data files via GitHub Actions", "--", "data"],
            cwd=temp_dir,
            check=True,
        )
        subprocess.run(["git", "push", "origin", "gh-pages"], cwd=temp_dir, check=True)
        print("[OK] 已部署到 gh-pages 分支")
    except subprocess.CalledProcessError as e:
        print(f"[x] 部署失败：{e}")
        raise
    finally:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)


def main() -> None:
    has_changes = False
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 1) 上游游戏数据
    for url, filename in zip(DATA_URL, DATA_FILES):
        output_file = os.path.join(OUTPUT_DIR, filename)
        print(f"-> 抓取 {filename}：{url}")
        new_data = fetch_data(url)
        existing_data = load_deployed_json(filename)

        if existing_data is None:
            print(f"   [OK] 首次写入 {output_file}")
            has_changes = True
        elif get_file_hash(new_data) != get_file_hash(existing_data):
            print(f"   [OK] 数据有更新（新 time={new_data.get('time')} / 旧 time={existing_data.get('time')}）")
            has_changes = True
        else:
            print("   = 数据无变化")

        # 无论是否有变化都写入暂存目录，保证部署时 gh-pages:data/ 内容完整
        save_as_json(new_data, output_file)

    # 2) 市场历史采样（失败不影响其它数据更新）
    try:
        print(f"-> 抓取官方市场快照归档历史：{MARKETPLACE_URL}")
        marketplace = fetch_data(MARKETPLACE_URL)
        if update_market_history(marketplace):
            has_changes = True
    except Exception as e:
        print(f"   [!] 市场历史更新失败（不影响其它数据）：{type(e).__name__}: {e}")

    # 3) 有变化才部署
    if has_changes:
        deploy_to_gh_pages()
    else:
        print("无任何变化，跳过部署")


if __name__ == "__main__":
    main()
