"""
删除 A5 中「无转写」（LNG_ANNOTATIONS 为空）的录音，并写入阻止再同步名单。

用法（需 A5 :8000 已启动）:
  python 联调/purge_recordings_without_transcript.py --yes
  python 联调/purge_recordings_without_transcript.py --yes --dry-run
  python 联调/purge_recordings_without_transcript.py --sync-blocklist-only
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A2_DB, A2_ROOT, A5_BASE, LIAN_DIAO

BLOCKLIST_PATH = LIAN_DIAO / "a5_purged_audio_blocklist.json"


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


def _audio_ids_with_annotations(annotations: list[dict]) -> set[int]:
    out: set[int] = set()
    for row in annotations:
        try:
            out.add(int(row["audio_id"]))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def load_blocklist() -> set[str]:
    if not BLOCKLIST_PATH.exists():
        return set()
    try:
        data = json.loads(BLOCKLIST_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return set()
    names = data.get("file_names") if isinstance(data, dict) else data
    if not isinstance(names, list):
        return set()
    return {str(n).strip() for n in names if str(n).strip()}


def save_blocklist(names: set[str]) -> None:
    BLOCKLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    BLOCKLIST_PATH.write_text(
        json.dumps({"file_names": sorted(names)}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def add_to_blocklist(names: set[str] | list[str]) -> int:
    cur = load_blocklist()
    before = len(cur)
    cur.update(str(n).strip() for n in names if str(n).strip())
    save_blocklist(cur)
    return len(cur) - before


def unblock_a2_files_with_local_media() -> dict[str, object]:
    """从阻止名单移除 A2 中文件仍在磁盘上的条目（供用户主动「实时更新」）。"""
    if not A2_DB.exists():
        return {"ok": 0, "error": "a2_db_missing", "removed": 0}

    blocklist = load_blocklist()
    if not blocklist:
        return {"ok": 1, "removed": 0, "remaining": 0}

    conn = sqlite3.connect(A2_DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT file_name, file_path FROM t_a2_voice_files"
    ).fetchall()
    conn.close()

    removable: set[str] = set()
    for row in rows:
        fname = str(row["file_name"] or "").strip()
        if not fname or fname not in blocklist:
            continue
        fp = str(row["file_path"] or "")
        if fp and not Path(fp).is_absolute():
            fp_abs = (A2_ROOT / fp).resolve()
        else:
            fp_abs = Path(fp).resolve() if fp else None
        if fp_abs and fp_abs.exists():
            removable.add(fname)

    if removable:
        blocklist -= removable
        save_blocklist(blocklist)

    return {
        "ok": 1,
        "removed": len(removable),
        "remaining": len(blocklist),
        "unblocked_sample": sorted(removable)[:8],
    }


def sync_blocklist_from_a2_kept() -> dict[str, object]:
    """A2 中凡无 A5 转写对应的 file_name 一律加入阻止名单（防止 sync 再写入）。"""
    try:
        annotations = _list_all("annotations")
        audios = _list_all("audio_records")
    except URLError as exc:
        return {"ok": 0, "error": str(exc)}

    with_ann = _audio_ids_with_annotations(annotations)
    kept_names = {
        str(r.get("file_name") or "").strip()
        for r in audios
        if int(r["audio_id"]) in with_ann and str(r.get("file_name") or "").strip()
    }

    a2_names: set[str] = set()
    if A2_DB.exists():
        conn = sqlite3.connect(A2_DB)
        try:
            a2_names = {
                str(row[0]).strip()
                for row in conn.execute("SELECT file_name FROM t_a2_voice_files").fetchall()
                if row[0]
            }
        finally:
            conn.close()

    to_block = a2_names - kept_names
    added = add_to_blocklist(to_block) if to_block else 0
    total = len(load_blocklist())
    return {
        "ok": 1,
        "a2_total": len(a2_names),
        "kept_with_transcript": len(kept_names),
        "newly_blocked": added,
        "blocklist_total": total,
    }


def run_purge(*, dry_run: bool = False) -> dict[str, object]:
    try:
        annotations = _list_all("annotations")
        audios = _list_all("audio_records")
    except URLError as exc:
        return {"ok": 0, "error": str(exc)}

    with_ann = _audio_ids_with_annotations(annotations)
    to_delete = [r for r in audios if int(r["audio_id"]) not in with_ann]

    if dry_run:
        return {
            "ok": 1,
            "dry_run": True,
            "total_audio": len(audios),
            "with_transcript": len(with_ann),
            "to_delete": len(to_delete),
            "ids": [int(r["audio_id"]) for r in to_delete],
            "files": [str(r.get("file_name") or "") for r in to_delete],
        }

    deleted = 0
    deleted_names: list[str] = []
    errors: list[str] = []
    for row in sorted(to_delete, key=lambda r: int(r["audio_id"]), reverse=True):
        audio_id = int(row["audio_id"])
        fname = str(row.get("file_name") or "").strip()
        try:
            _post_json(f"{A5_BASE}/tables/audio_records/ext/delete-one", {"id": audio_id})
            deleted += 1
            if fname:
                deleted_names.append(fname)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"audio {audio_id}: {exc}")

    if deleted_names:
        add_to_blocklist(deleted_names)
    block_sync = sync_blocklist_from_a2_kept()

    remaining = _list_all("audio_records")
    remaining_ids = {int(r["audio_id"]) for r in remaining}
    still_without = [aid for aid in (int(r["audio_id"]) for r in to_delete) if aid in remaining_ids]

    return {
        "ok": 1 if not errors else 0,
        "deleted": deleted,
        "attempted": len(to_delete),
        "remaining_audio": len(remaining),
        "remaining_without_transcript": len(still_without),
        "kept_with_transcript": len(with_ann & remaining_ids),
        "blocklist": block_sync,
        "errors": errors[:10],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="删除 A5 中无转写的录音")
    parser.add_argument("--yes", action="store_true", help="确认执行（不可恢复）")
    parser.add_argument("--dry-run", action="store_true", help="只列出将删除的条目")
    parser.add_argument(
        "--sync-blocklist-only",
        action="store_true",
        help="不删库，仅根据 A2/A5 刷新阻止再同步名单",
    )
    args = parser.parse_args()

    if args.sync_blocklist_only:
        result = sync_blocklist_from_a2_kept()
        if result.get("ok") != 1:
            print(f"失败: {result.get('error')}", file=sys.stderr)
            return 1
        print(
            f"阻止名单共 {result['blocklist_total']} 个文件名；"
            f"本次新增 {result['newly_blocked']}（A2 {result['a2_total']}，保留有转写 {result['kept_with_transcript']}）"
        )
        return 0

    if not args.yes and not args.dry_run:
        print("将删除所有无 LNG_ANNOTATIONS 的录音。请加 --yes 或 --dry-run。")
        return 1

    result = run_purge(dry_run=args.dry_run)
    if result.get("ok") != 1 and result.get("error"):
        print(f"失败: {result['error']}", file=sys.stderr)
        return 1

    if args.dry_run:
        print(f"共 {result['total_audio']} 条录音，{result['with_transcript']} 条有转写")
        print(f"将删除 {result['to_delete']} 条: {result['ids']}")
        return 0

    print(
        f"已删除 {result['deleted']}/{result['attempted']} 条无转写录音；"
        f"A5 剩余 {result['remaining_audio']} 条（其中保留有转写 {result['kept_with_transcript']} 条）。"
    )
    blk = result.get("blocklist") if isinstance(result.get("blocklist"), dict) else {}
    if blk:
        print(
            f"阻止再同步名单 {blk.get('blocklist_total', '?')} 个文件名"
            f"（本次新增 {blk.get('newly_blocked', 0)}）。"
        )
    if result.get("errors"):
        print("部分失败:", *result["errors"], sep="\n  ")
        return 2
    print("请刷新前端 http://localhost:3000")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
