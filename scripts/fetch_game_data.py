"""
MewKonomy 游戏数据抓取与部署脚本。

作用：
  1. 抓取上游 data.json / market.json，与线上（gh-pages 分支的 data/）比对，有变化才更新；
  2. 有变化时把 public/data 部署到 gh-pages 分支的 data/ 目录。

**本脚本不再负责市场历史采样**（原先它同时做这件事，导致 data.json 源一挂、
历史采样就一起停摆——实测线上因此连续 8 天没有新采样点）。
历史采样已迁到独立的高频 workflow：
  scripts/sample_market_history.py + .github/workflows/market-history.yml

**安全护栏（重要）**：
  抓到的 data.json 若 `versionTimestamp` 比线上已部署的**更旧**，则拒绝写入。
  历史上本脚本用「哈希不同就覆盖」的策略，而上游源可能停留在旧版本
  （实测 silent1b/MWIData 停在 v1.20250818.0，比线上 v1.20260309.0 旧 7 个月），
  一旦抓取成功就会**用旧数据覆盖线上新数据**。现在这种降级会被直接拦下。

运行方式：
  - CI：.github/workflows/update-data.yml 每天调用；
        需要环境变量 GITHUB_REPOSITORY 与 GITHUB_TOKEN
  - 本地：python scripts/fetch_game_data.py
          只抓取不推送：DRY_RUN=1 python scripts/fetch_game_data.py
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
from typing import Any, Dict, List, Tuple

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

# 上游数据源候选：(url, 输出文件名)，按顺序尝试，第一个成功即用。
# 之所以给多源：raw.githubusercontent.com 在本网络下极不稳定
# （实测同一个文件要 270~290 秒，甚至直接超时），而 jsDelivr / ghproxy 快得多。
DATA_SOURCES: List[Tuple[str, str]] = [
    # jsDelivr CDN（实测 24~35 秒拿到 3MB 级文件）
    ("https://cdn.jsdelivr.net/gh/silent1b/MWIData@main/init_client_info.json", "data.json"),
    ("https://cdn.jsdelivr.net/gh/silent1b/MWIData@main/init_client_info.json", "market.json"),
    # ghproxy 转发（实测 35 秒）
    ("https://ghproxy.net/https://raw.githubusercontent.com/silent1b/MWIData/main/init_client_info.json", "data.json"),
    ("https://ghproxy.net/https://raw.githubusercontent.com/silent1b/MWIData/main/init_client_info.json", "market.json"),
    # 原始通道兜底（慢且易超时，放最后）
    ("https://raw.githubusercontent.com/silent1b/MWIData/main/init_client_info.json", "data.json"),
    ("https://raw.githubusercontent.com/silent1b/MWIData/main/init_client_info.json", "market.json"),
]

# 待部署目录（与本地 `pnpm build` 的产物结构一致：public/data → dist/data → gh-pages:data）
OUTPUT_DIR = "./public/data"
# 线上数据读取目录，按顺序取第一个存在的：
#   CI 检出的是 gh-pages 分支 → ./data；本地在 main 分支跑 → ./data 或 ./public/data
READ_DIRS = ("./data", "./public/data")
DATA_FILES = ("data.json", "market.json")
# 单次 HTTP 请求超时与重试（大文件 + 慢通道，超时给足）
HTTP_TIMEOUT = 120
RETRY_TOTAL = 3

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


def fetch_first_available(filename: str) -> Any:
    """按 DATA_SOURCES 顺序尝试，返回第一个成功抓取到的 JSON（要求是 dict）。"""
    last_error: Exception | None = None
    for url, target in DATA_SOURCES:
        if target != filename:
            continue
        try:
            print(f"   尝试 {url}")
            data = fetch_data(url)
            if not isinstance(data, dict) or not data:
                print("   [!] 返回内容不是非空对象，跳过该源")
                continue
            # data.json 必须含物品表，否则视为无效响应（防止被错误页/空对象覆盖）
            if filename == "data.json" and not data.get("itemDetailMap"):
                print("   [!] 缺少 itemDetailMap，跳过该源")
                continue
            # market.json 是「名称 → 行情」的扁平表，正常只有几十 KB；
            # 若某源返回 3MB 级的 data.json 载荷（上游仓库结构变化时会发生），直接拒绝，
            # 否则会把 3.8MB 的错误文件推到线上 data/ 目录。
            if filename == "market.json":
                top_keys = list(data.keys())[:5]
                if "itemDetailMap" in data or len(json.dumps(data)) > 2_000_000:
                    print(f"   [!] 内容不像 market.json（顶层键示例 {top_keys}），跳过该源")
                    continue
            return data
        except Exception as e:  # noqa: BLE001 - 逐源容错，最后统一报错
            last_error = e
            print(f"   [!] 该源失败：{type(e).__name__}: {e}")
    raise RuntimeError(f"{filename} 的全部上游源均不可达，最后一个错误：{last_error}")


def save_as_json(data: Any, output_file: str, compact: bool = False) -> None:
    """保存数据为 JSON 文件；compact=True 时用紧凑格式"""
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


def version_stamp_of(data: Any) -> str:
    """取数据的版本时间戳，用于「禁止降级」比较。取不到时返回空串（视为未知）。"""
    if not isinstance(data, dict):
        return ""
    for key in ("versionTimestamp", "currentTimestamp", "time"):
        v = data.get(key)
        if isinstance(v, str) and v:
            return v
        if isinstance(v, (int, float)) and v:
            # epoch 秒统一成 20 位零填充字符串，保证字典序 == 时间序
            return f"{int(v):020d}"
    return ""


def is_downgrade(new_data: Any, existing_data: Any) -> bool:
    """
    判断新数据是否比线上已部署的更旧（降级）。
    只在两边都能取到版本戳时才有结论；取不到时保守放行（不阻塞正常更新）。
    """
    new_stamp = version_stamp_of(new_data)
    old_stamp = version_stamp_of(existing_data)
    if not new_stamp or not old_stamp:
        return False
    return new_stamp < old_stamp


def assert_no_unintended_deletions(repo_dir: str, owned_files: set) -> None:
    """
    确认本次改动只涉及 owned_files：若 git status 里出现本脚本不负责的删除，直接失败。

    gh-pages 的 data/ 由多个脚本共享写入，谁都不该顺手删掉别人的文件
    （历史上曾因整目录替换把 data.json / market.json 删掉）。
    """
    result = subprocess.run(
        ["git", "status", "--porcelain"], cwd=repo_dir, capture_output=True, text=True, check=True
    )
    offending = [line for line in result.stdout.splitlines() if "D" in line[:2] and os.path.basename(line[3:].strip()) not in owned_files]
    if offending:
        raise SystemExit(
            "[x] 拒绝部署：本次改动删除了非本脚本负责的文件，已中止以免误删线上数据：\n"
            + "\n".join("    " + o for o in offending)
        )


def push_with_retry(repo_dir: str, branch: str = "gh-pages", attempts: int = 3) -> None:
    """
    推送 gh-pages，被抢占时 rebase 后重试。

    为什么需要：update-data.yml 与 market-history.yml 用的是**不同的** concurrency group，
    两者可能在同一个时间窗口内先后推送 gh-pages。后推的一方若直接失败，这次更新就白跑了。
    rebase 后重试成本极低。
    """
    for attempt in range(1, attempts + 1):
        push = subprocess.run(["git", "push", "origin", branch], cwd=repo_dir, capture_output=True, text=True)
        if push.returncode == 0:
            return
        print(f"   [!] 推送失败（第 {attempt}/{attempts} 次）：{(push.stderr or '').strip()[-200:]}")
        if attempt == attempts:
            raise SystemExit(f"[x] gh-pages 推送连续 {attempts} 次失败，放弃本次部署")
        subprocess.run(["git", "pull", "--rebase", "--autostash", "origin", branch], cwd=repo_dir, check=True)


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

        # —— 只覆盖本脚本负责的文件，绝不整目录替换 ——
        # gh-pages 的 data/ 是「多来源共享目录」：market_history.json 由
        # sample_market_history.py 高频写入。整目录 rmtree+copytree 会在
        # OUTPUT_DIR 不完整时误删别人的文件，因此改为按文件合并。
        target_data_dir = os.path.join(temp_dir, "data")
        os.makedirs(target_data_dir, exist_ok=True)
        for filename in DATA_FILES:
            source_file = os.path.join(OUTPUT_DIR, filename)
            if os.path.exists(source_file):
                shutil.copy2(source_file, os.path.join(target_data_dir, filename))

        # 双保险：确认没有意外删除本脚本不负责的文件
        assert_no_unintended_deletions(temp_dir, set(DATA_FILES))

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
        push_with_retry(temp_dir)
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

    for filename in DATA_FILES:
        output_file = os.path.join(OUTPUT_DIR, filename)
        print(f"-> 抓取 {filename}")
        try:
            new_data = fetch_first_available(filename)
        except Exception as e:  # noqa: BLE001
            print(f"   [x] {filename} 抓取失败，跳过该文件：{e}")
            continue

        existing_data = load_deployed_json(filename)

        # —— 禁止降级：绝不用更旧的数据覆盖线上 ——
        if is_downgrade(new_data, existing_data):
            print(
                f"   [!] 拒绝写入：抓到的是旧版本"
                f"（新 {version_stamp_of(new_data)} < 线上 {version_stamp_of(existing_data)}）"
            )
            continue

        if existing_data is None:
            print(f"   [OK] 首次写入 {output_file}")
            has_changes = True
        elif get_file_hash(new_data) != get_file_hash(existing_data):
            print(
                f"   [OK] 数据有更新"
                f"（新 {version_stamp_of(new_data) or 'n/a'} / 旧 {version_stamp_of(existing_data) or 'n/a'}）"
            )
            has_changes = True
        else:
            print("   = 数据无变化")

        # 无论是否有变化都写入暂存目录，保证部署时 gh-pages:data/ 内容完整。
        # 注意：market_history.json 由高频采样 workflow 独占维护，本脚本不碰它。
        save_as_json(new_data, output_file)

    if has_changes:
        deploy_to_gh_pages()
    else:
        print("无任何变化，跳过部署")


if __name__ == "__main__":
    main()

