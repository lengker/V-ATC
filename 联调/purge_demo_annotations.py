"""
删除 A5 中 storage_tag=demo_seed 的演示标注（假 ATC 文本），以便改用 A3 真实 ASR。

用法:
  python 联调/purge_demo_annotations.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A5_BASE


def _get_json(url: str) -> list:
    with urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _post_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def run_purge_demo_annotations() -> dict[str, int | str]:
    try:
        rows = _get_json(f"{A5_BASE}/tables/annotations?limit=1000")
    except URLError as exc:
        return {"ok": 0, "error": str(exc), "deleted": 0}

    deleted = 0
    for row in rows:
        if str(row.get("storage_tag") or "") != "demo_seed":
            continue
        ann_id = int(row["annotation_id"])
        _post_json(f"{A5_BASE}/tables/annotations/ext/delete-one", {"id": ann_id})
        deleted += 1
    return {"ok": 1, "deleted": deleted}


def main() -> int:
    result = run_purge_demo_annotations()
    if not result.get("ok"):
        print(f"失败: {result.get('error')}", file=sys.stderr)
        return 1
    print(f"已删除 {result.get('deleted', 0)} 条 demo_seed 演示标注。请运行 process_a2_via_a3.py 生成真实 ASR。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
