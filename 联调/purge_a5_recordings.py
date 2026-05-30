"""
清空 A5 中全部录音与标注（前端录音列表会变空）。

用法（需 A5 :8000 已启动）:
  python 联调/purge_a5_recordings.py --yes
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A5_BASE


def _get_json(url: str) -> list:
    with urlopen(url, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        return data if isinstance(data, list) else []


def _list_all(table: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    page = 1000
    while True:
        batch = _get_json(f"{A5_BASE}/tables/{table}?limit={page}&offset={offset}")
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


def _post_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{exc.code} {url} {detail}") from exc


def run_purge_all_recordings() -> dict[str, int | str]:
    try:
        annotations = _list_all("annotations")
        audios = _list_all("audio_records")
    except URLError as exc:
        return {"ok": 0, "error": str(exc), "deleted_annotations": 0, "deleted_audio": 0}

    deleted_ann = 0
    ann_errors: list[str] = []
    for row in annotations:
        ann_id = int(row["annotation_id"])
        try:
            _post_json(f"{A5_BASE}/tables/annotations/ext/delete-one", {"id": ann_id})
            deleted_ann += 1
        except Exception as exc:  # noqa: BLE001
            ann_errors.append(f"annotation {ann_id}: {exc}")

    deleted_audio = 0
    audio_errors: list[str] = []
    chain_heads = {int(r["audio_id"]) for r in audios if r.get("prev_id") is None}
    for head in sorted(chain_heads, reverse=True):
        try:
            _post_json(f"{A5_BASE}/tables/audio_records/ext/delete-chain", {"id": head})
            deleted_audio += 1
        except Exception as exc:  # noqa: BLE001
            audio_errors.append(f"chain head {head}: {exc}")

    leftovers = _list_all("audio_records")
    for row in sorted(leftovers, key=lambda r: int(r.get("audio_id") or 0), reverse=True):
        audio_id = int(row["audio_id"])
        try:
            _post_json(f"{A5_BASE}/tables/audio_records/ext/delete-one", {"id": audio_id})
            deleted_audio += 1
        except Exception as exc:  # noqa: BLE001
            audio_errors.append(f"audio {audio_id}: {exc}")

    remaining = len(_list_all("audio_records"))
    return {
        "ok": 1 if remaining == 0 and not ann_errors and not audio_errors else 0,
        "deleted_annotations": deleted_ann,
        "deleted_audio": deleted_audio,
        "remaining_audio": remaining,
        "ann_errors": ann_errors[:5],
        "audio_errors": audio_errors[:5],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="清空 A5 全部录音与标注")
    parser.add_argument("--yes", action="store_true", help="确认执行（不可恢复）")
    args = parser.parse_args()
    if not args.yes:
        print("将删除 A5 中全部 annotations 与 audio_records。请加 --yes 确认。")
        return 1

    result = run_purge_all_recordings()
    if not result.get("ok"):
        print(f"失败: {result.get('error')}", file=sys.stderr)
        return 1
    print(
        f"已删除标注 {result['deleted_annotations']} 条、录音链/条 {result['deleted_audio']} 次；"
        f"A5 剩余录音 {result['remaining_audio']} 条。"
    )
    if result.get("ann_errors"):
        print("标注删除部分失败:", *result["ann_errors"], sep="\n  ")
    if result.get("audio_errors"):
        print("录音删除部分失败:", *result["audio_errors"], sep="\n  ")
    print("刷新前端；新录音请用「立即更新」或 python sync_a2_to_a5.py 同步。")
    return 0 if int(result.get("remaining_audio", 1)) == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
