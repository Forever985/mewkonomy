#!/usr/bin/env python3
"""重复代码扫描：找出跨文件的重复代码块，用于 DRY 重构前的「先量再改」。

用法（在仓库根目录执行）：
    python scripts/dup-scan.py                # 默认最小 8 行、跨 ≥2 文件
    python scripts/dup-scan.py --min-lines 12 # 只看更大的块
    python scripts/dup-scan.py --src src/pages

## 为什么不用现成的 jscpd
jscpd 需要装依赖且对 .vue 的模板/脚本混排不够友好；这里只需要「行级最长公共块」这一个判断，
几十行 Python 就够，还能按需调整归一化规则。

## 算法
1. **逐行归一化**：去缩进、压空白、丢空行与纯注释行 —— 这样「换个缩进抄一遍」也能匹配上。
2. **滑窗哈希预筛文件对**：N 行窗口的哈希 → 倒排索引 → 只在共享 ≥2 个窗口的文件对之间做精确比对。
   （166 个文件两两全比是 1.4 万对，预筛后只剩几十对。）
3. 对候选文件对跑 `difflib.SequenceMatcher.get_matching_blocks()` 求**最长公共块** ——
   比"统计雷同行"准，且不会因为交叠窗口把同一段重复报告几十次。
4. 相同内容的块按文本聚合，一处列出它的全部位置。

## 输出怎么读
- 「重复行数最多的文件」：**重构收益最大的文件**（该指标会把交叠块重复计入，只看趋势与排序）；
- 「出现在最多文件里的重复块」：**最该优先抽出来的轮子**（跨文件数越多，抽出去越划算）。

⚠️ 抽取前务必先看「各页特有逻辑」：把待替换区域**逐行求跨页交集**，
只出现在 1~2 个页面里的行是各页私有逻辑，整段替换会把它们一起删掉，
而且**类型检查查不出来**（未被引用的函数被删不报错）。详见 docs/DEVELOPER_GUIDE.md。
"""

import argparse
import collections
import difflib
import os
import re
import sys

COMMENT_ONLY = re.compile(r"^\s*(//|/\*|\*|#|<!--)")


def collect(root):
    files = []
    for dirpath, dirnames, names in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in {".git", "node_modules", "dist", "temp", "__pycache__"}]
        for n in names:
            if n.endswith((".vue", ".ts", ".tsx", ".js", ".mjs")):
                files.append(os.path.join(dirpath, n).replace("\\", "/"))
    return sorted(files)


def normalized_lines(path):
    """返回归一化后的行文本列表（丢弃空行与纯注释行）"""
    raw = open(path, "rb").read().decode("utf-8", errors="replace")
    out = []
    for line in raw.splitlines():
        s = line.strip()
        if not s or COMMENT_ONLY.match(s):
            continue
        out.append(re.sub(r"\s+", " ", s))
    return out


def find_blocks(files, min_lines, min_files):
    data = {f: normalized_lines(f) for f in files}

    # 1) 滑窗哈希 → 倒排索引 → 候选文件对
    win_files = collections.defaultdict(set)
    for f, lines in data.items():
        for i in range(len(lines) - min_lines + 1):
            win_files[hash("\n".join(lines[i:i + min_lines]))].add(f)

    pair_share = collections.Counter()
    for fs in win_files.values():
        if len(fs) < 2:
            continue
        fs = sorted(fs)
        for a in range(len(fs)):
            for b in range(a + 1, len(fs)):
                pair_share[(fs[a], fs[b])] += 1

    # 2) 候选对求最长公共块
    blocks = collections.defaultdict(list)
    dup_lines = collections.Counter()
    for (fa, fb), share in pair_share.items():
        if share < 2:  # 至少 2 个窗口共享 ⇒ 真有成段重复
            continue
        la, lb = data[fa], data[fb]
        for m in difflib.SequenceMatcher(None, la, lb, autojunk=False).get_matching_blocks():
            if m.size < min_lines:
                continue
            blocks["\n".join(la[m.a:m.a + m.size])].append(fa)
            blocks["\n".join(la[m.a:m.a + m.size])].append(fb)
            dup_lines[fa] += m.size
            dup_lines[fb] += m.size

    merged = []
    for text, locs in blocks.items():
        owners = sorted(set(locs))
        if len(owners) < min_files:
            continue
        merged.append((len(text.split("\n")), len(owners), text, owners))
    merged.sort(key=lambda x: (-x[1], -x[0]))
    return merged, dup_lines, len(files)


def main():
    ap = argparse.ArgumentParser(description="扫描跨文件重复代码块")
    ap.add_argument("--src", default="src", help="扫描目录，默认 src")
    ap.add_argument("--min-lines", type=int, default=8, help="最小重复块行数，默认 8")
    ap.add_argument("--min-files", type=int, default=2, help="至少出现在几个文件里，默认 2")
    ap.add_argument("--top", type=int, default=20, help="每个榜单显示条数，默认 20")
    args = ap.parse_args()

    if not os.path.isdir(args.src):
        sys.exit(f"目录不存在: {args.src}")

    merged, dup_lines, n_files = find_blocks(collect(args.src), args.min_lines, args.min_files)

    print(f"#### 扫描 {n_files} 个文件，重复块（≥{args.min_lines} 行、跨 ≥{args.min_files} 文件）共 {len(merged)} 处\n")

    print(f"#### 重复行数最多的文件 Top {args.top}")
    print("（重构收益最大的目标；该指标会重复计入交叠块，只看排序与趋势）")
    for f, n in dup_lines.most_common(args.top):
        print(f"   {n:6d} 行参与重复   {f}")

    print(f"\n#### 出现在最多文件里的重复块 Top {args.top}")
    print("（跨文件越多越该优先抽成公共模块）")
    for size, nfiles, text, owners in merged[:args.top]:
        first = text.split("\n")[0][:72]
        print(f"\n--- {size} 行 × {nfiles} 个文件 | 首行: {first}")
        for f in owners[:8]:
            print(f"      {f}")
        if len(owners) > 8:
            print(f"      ... 另有 {len(owners) - 8} 个文件")


if __name__ == "__main__":
    main()
