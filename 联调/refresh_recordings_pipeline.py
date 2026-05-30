"""
A2 拉取新录音 + 同步 A5（供前端轮询 / A5 POST /sync/a2-to-a5 调用）。

用法:
  python 联调/refresh_recordings_pipeline.py
  python 联调/refresh_recordings_pipeline.py --full   # 含历史归档（较慢）
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A2_BASE, A2_ROOT, A5_BASE

from sync_a2_to_a5 import _media_url, run_sync
from process_a2_via_a3 import run_a3_asr_for_a5
from purge_recordings_without_transcript import run_purge, unblock_a2_files_with_local_media


def _post_empty(url: str, timeout: int) -> dict | list:
    req = Request(url, data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def _register_realtime_file(
    file_name: str,
    rel_path: str,
    file_size: int,
    duration_ms: int = 60_000,
) -> dict | None:
    end = datetime.now(timezone.utc)
    start = end - timedelta(seconds=max(1, duration_ms // 1000))
    media_url = _media_url(rel_path)
    body = json.dumps(
        {
            "file_name": file_name,
            "file_path": rel_path.replace("\\", "/"),
            "start_time_utc": start.isoformat(),
            "end_time_utc": end.isoformat(),
            "source_url": media_url,
            "file_size": file_size,
            "duration_ms": duration_ms,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    req = Request(
        f"{A2_BASE}/api/v1/ingestion/realtime/register",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except URLError:
        return None


def _import_orphan_mp3() -> dict[str, int]:
    """扫描 A2 data/audio 与 liveatc downloads，未入库的 mp3 登记到 A2。"""
    import sqlite3
    from module_paths import A2_DB

    known: set[str] = set()
    if A2_DB.exists():
        conn = sqlite3.connect(A2_DB)
        known = {r[0] for r in conn.execute("SELECT file_name FROM t_a2_voice_files").fetchall()}
        conn.close()

    registered = 0
    scanned = 0
    candidates: list[Path] = []
    audio_root = A2_ROOT / "data" / "audio"
    if audio_root.is_dir():
        candidates.extend(audio_root.rglob("*.mp3"))
    dl_dir = A2_ROOT / "liveatc-downloader" / "downloads"
    if dl_dir.is_dir():
        for mp3 in dl_dir.glob("*.mp3"):
            day = datetime.now(timezone.utc).strftime("%Y%m%d")
            dest_dir = audio_root / "historical" / day
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest = dest_dir / mp3.name
            if not dest.exists():
                shutil.copy2(mp3, dest)
            candidates.append(dest)

    for path in candidates:
        scanned += 1
        if path.name in known:
            continue
        try:
            rel = path.relative_to(A2_ROOT).as_posix()
        except ValueError:
            continue
        out = _register_realtime_file(path.name, rel, path.stat().st_size)
        if out and out.get("voice_file_id"):
            known.add(path.name)
            registered += 1

    return {"scanned": scanned, "registered": registered}


def trigger_a2_downloads(*, full: bool) -> dict[str, object]:
    out: dict[str, object] = {}
    try:
        out["realtime"] = _post_empty(
            f"{A2_BASE}/api/v1/ingestion/scheduler/trigger/realtime",
            120,
        )
    except Exception as exc:  # noqa: BLE001
        out["realtime"] = {"error": str(exc)}
    if full:
        try:
            out["historical"] = _post_empty(
                f"{A2_BASE}/api/v1/ingestion/scheduler/trigger/historical",
                300,
            )
        except Exception as exc:  # noqa: BLE001
            out["historical"] = {"error": str(exc)}
    return out


def _pending_audio_ids() -> list[int]:
    """A5 中尚无 annotations 的 audio_id（供前端实时更新）。"""
    try:
        from purge_recordings_without_transcript import _list_all, _audio_ids_with_annotations

        aud = _list_all("audio_records")
        with_ann = _audio_ids_with_annotations(_list_all("annotations"))
    except Exception:  # noqa: BLE001
        return []
    out: list[int] = []
    for row in aud:
        try:
            aid = int(row["audio_id"])
        except (KeyError, TypeError, ValueError):
            continue
        if aid not in with_ann:
            out.append(aid)
    return sorted(out)


def run_pipeline(
    *,
    full: bool = False,
    download: bool = True,
    a3_asr: bool = True,
    a3_limit: int = 5,
) -> dict[str, object]:
    """download=False 时仅扫描落盘 mp3 并同步 A5（供 30s 轮询，秒级返回）。"""
    result: dict[str, object] = {"ok": 1}
    if download:
        try:
            result["a2_trigger"] = trigger_a2_downloads(full=full)
        except Exception as exc:  # noqa: BLE001
            result["a2_trigger"] = {"error": str(exc)}
    else:
        result["a2_trigger"] = {"skipped": True}
    manual_refresh = download and a3_limit == 0
    if manual_refresh:
        result["unblock"] = unblock_a2_files_with_local_media()
    result["a2_import"] = _import_orphan_mp3()
    result["sync"] = run_sync(ignore_blocklist=manual_refresh)
    sync = result.get("sync") if isinstance(result.get("sync"), dict) else {}
    result["a5_total"] = sync.get("a5_total", 0)
    result["a2_total"] = sync.get("a2_total", 0)
    result["synced"] = sync.get("synced", 0)
    result["updated"] = sync.get("updated", 0)
    result["blocked"] = sync.get("blocked", 0)
    if a3_asr and download and a3_limit > 0:
        try:
            # 仅在含 A2 下载的同步轮跑批量 ASR；前端「立即更新」用 a3_limit=0，单条走 /sync/a3-asr
            result["a3_asr"] = run_a3_asr_for_a5(limit=a3_limit)
        except Exception as exc:  # noqa: BLE001
            result["a3_asr"] = {"ok": 0, "error": str(exc)}
    elif a3_asr:
        result["a3_asr"] = {"skipped": True, "reason": "poll_sync_only_use_frontend_asr"}
    # 前端「实时更新」用 a3_limit=0 逐条 ASR；此轮若 purge 会删掉刚同步、尚未转写的录音
    if a3_limit > 0 or not download:
        try:
            result["purge_without_transcript"] = run_purge(dry_run=False)
        except Exception as exc:  # noqa: BLE001
            result["purge_without_transcript"] = {"ok": 0, "error": str(exc)}
    else:
        result["purge_without_transcript"] = {"skipped": True, "reason": "frontend_asr_pending"}
    result["pending_audio_ids"] = _pending_audio_ids()
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true", help="同时触发历史归档下载（慢）")
    parser.add_argument("--sync-only", action="store_true", help="不触发 A2 下载，仅导入落盘并同步 A5")
    parser.add_argument("--no-a3", action="store_true", help="跳过 A3 语音转文本")
    parser.add_argument("--a3-limit", type=int, default=5, help="本轮 A3 ASR 最多处理条数")
    args = parser.parse_args()
    print(
        json.dumps(
            run_pipeline(
                full=args.full,
                download=not args.sync_only,
                a3_asr=not args.no_a3,
                a3_limit=max(1, args.a3_limit),
            ),
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
