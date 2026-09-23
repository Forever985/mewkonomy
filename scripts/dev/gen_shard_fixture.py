"""
生成「市场历史分片」的前端解码 fixture（开发用，CI 不跑）。

为什么需要它：归档分片是 v2 紧凑格式，编码在 Python（scripts/sample_market_history.py
的 `encode_shard`）、解码在 TypeScript（src/common/apis/marketvolume/history.ts 的
`decodeShard`）。两份实现跨语言，最容易出的问题就是「一边改了行编码规则、另一边没改」。
所以这里用**真正的 Python 编码器**产出一份覆盖所有行变体的 fixture，
交给 tests/marketvolume-shard.test.ts 用 TypeScript 解码并逐字段断言 ——
任何一边漂移，测试立刻变红。

用法（仓库根目录）：
  python scripts/dev/gen_shard_fixture.py
产物：tests/fixtures/market-history-shard.json
"""
import json
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts"))

from sample_market_history import decode_shard, encode_shard  # noqa: E402

OUTPUT = os.path.join(REPO_ROOT, "tests", "fixtures", "market-history-shard.json")

# 覆盖每一种行变体（长度 3/4/5、缺 ask、缺 bid、缺 volume、全空白、大数字、多强化档）
SAMPLES = [
    {
        "t": 1790161200,
        "p": {
            # 同一件装备的多个强化档（level 是强化等级，不是物品等级）
            "/items/holy_chisel": {
                "0": [1370000, 1350000, 13],   # 5 元素：ask+bid+volume
                "2": [1500000, -1, 1],         # ask 有、bid 缺
                "10": [9_000_000_000, -1, 0],  # 大数字（> 2^32）
            },
            "/items/apple": {"0": [100, -1, 0]},    # 3 元素：只有 ask
            "/items/banana": {"0": [200, 190, 0]},  # 4 元素：ask+bid，无成交
            "/items/cherry": {"0": [-1, 55, 7]},    # 4 元素：只有 bid
            "/items/durian": {"0": [-1, -1, 42]},   # 5 元素：只有 volume
            "/items/empty": {"0": [-1, -1, 0]},     # 全空白 → 必须被丢掉（但会留在字典里）
        },
    },
    {
        "t": 1790164800,
        "p": {
            "/items/holy_chisel": {"0": [1375000, 1350000, 20]},
            "/items/apple": {"0": [105, -1, 3]},
            # 新出现的字典项；第 0 点出现过的项在第 1 点不出现时不应产出空对象
            "/items/new_item": {"0": [1, 2, 99999999]},
        },
    },
]


def main() -> None:
    payload = encode_shard(SAMPLES)
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    # 自检：Python 侧往返必须完全一致（忽略被丢弃的全空条目）
    expected = []
    for sample in SAMPLES:
        prices = {}
        for hrid, levels in sample["p"].items():
            kept = {}
            for level, triple in levels.items():
                ask = triple[0] if len(triple) > 0 and triple[0] is not None else -1
                bid = triple[1] if len(triple) > 1 and triple[1] is not None else -1
                vol = triple[2] if len(triple) > 2 and triple[2] is not None else 0
                if ask < 0 and bid < 0 and vol <= 0:
                    continue
                kept[level] = [ask, bid, vol]
            if kept:
                prices[hrid] = kept
        expected.append({"t": sample["t"], "p": prices})

    decoded = decode_shard(payload)
    if decoded != expected:
        raise SystemExit("[x] Python 侧编解码往返不一致，fixture 不可信")
    print(f"[OK] {OUTPUT}（{os.path.getsize(OUTPUT)} B）")
    print(f"[OK] Python 往返自检通过：{len(decoded)} 个采样点，字典 {len(payload['d'])} 项")


if __name__ == "__main__":
    main()
