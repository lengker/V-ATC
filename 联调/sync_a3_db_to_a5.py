"""
从 A3 模块库导入录音与 ASR 标注到 A5（供前端文本时间轴）。

数据源: 联调/a3_speech_processing_6/backend/data.sqlite3
目标:   A5 HTTP API (需 :8000)；音频 URL 指向 A3 :9002/media

用法:
  python 联调/sync_a3_db_to_a5.py
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A2_ROOT, A3_DB, A3_MEDIA_BASE, A3_ROOT, A5_BASE


def _post_json(url: str, payload: dict | list) -> dict | list:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get_json(url: str) -> list:
    with urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _resolve_audio_file(file_name: str, file_path: str) -> Path | None:
    candidates: list[Path] = []
    if file_path:
        p = Path(file_path)
        if p.is_absolute() and p.exists():
            return p
        candidates.append(A3_ROOT / file_path)
        candidates.append(A3_ROOT / "storage" / Path(file_path).name)
    candidates.append(A3_ROOT / "test_wavs" / file_name)
    candidates.append(A3_ROOT / "quarantine_orphans" / file_name)
    candidates.append(A2_ROOT / "data" / "audio" / "realtime" / "20260513" / file_name)
    for c in candidates:
        if c.exists():
            return c.resolve()
    return None


def _media_url_for_file(resolved: Path) -> str:
    try:
        rel = resolved.relative_to(A3_ROOT).as_posix()
        return f"{A3_MEDIA_BASE}/{rel}"
    except ValueError:
        pass
    # A2 文件走 A2 media（若落在 A2 目录）
    try:
        rel = resolved.relative_to(A2_ROOT / "data" / "audio").as_posix()
        return f"http://127.0.0.1:8001/media/{rel}"
    except ValueError:
        return f"{A3_MEDIA_BASE}/test_wavs/{resolved.name}"


def _a5_audio_by_filename() -> dict[str, int]:
    rows = _get_json(f"{A5_BASE}/tables/audio_records?limit=1000")
    out: dict[str, int] = {}
    for r in rows:
        name = str(r.get("file_name") or "")
        aid = int(r["audio_id"])
        if name not in out or aid > out[name]:
            out[name] = aid
    return out


def _a5_has_annotations(audio_id: int) -> bool:
    rows = _get_json(f"{A5_BASE}/tables/annotations?limit=1000")
    return any(int(x.get("audio_id") or 0) == audio_id for x in rows)


def _default_track_id() -> int:
    rows = _get_json(f"{A5_BASE}/tables/tracks?limit=1")
    if rows:
        return int(rows[0]["track_id"])
    return 1


def run_sync_a3_to_a5(*, only_file_names: set[str] | None = None) -> dict[str, int | str]:
    """从 A3 库导入 ASR 标注到 A5（按 file_name 对齐已有 A5 录音）。"""
    if not A3_DB.exists():
        return {"ok": 0, "error": "a3_db_missing", "created_audio": 0, "created_annos": 0}

    conn = sqlite3.connect(A3_DB)
    conn.row_factory = sqlite3.Row
    audios = conn.execute(
        "SELECT audio_id, source_url, start_time_utc, end_time_utc, duration_ms, "
        "file_name, file_path, file_size, status, track_id FROM LNG_AUDIO_RECORDS ORDER BY audio_id"
    ).fetchall()
    annos = conn.execute(
        "SELECT annotation_id, audio_id, label_type, author_id, relative_start, relative_end, "
        "asr_content, annotation_text, vad_confidence, is_annotated, storage_tag "
        "FROM LNG_ANNOTATIONS ORDER BY audio_id, annotation_id"
    ).fetchall()
    conn.close()

    if not audios:
        return {"ok": 0, "error": "a3_no_audios", "created_audio": 0, "created_annos": 0}

    by_a3_audio: dict[int, list[sqlite3.Row]] = {}
    for a in annos:
        by_a3_audio.setdefault(int(a["audio_id"]), []).append(a)

    name_to_a5 = _a5_audio_by_filename()
    default_track_id = _default_track_id()
    created_audio = 0
    created_annos = 0

    for row in audios:
        a3_id = int(row["audio_id"])
        file_name = str(row["file_name"] or f"audio_{a3_id}")
        if only_file_names is not None and file_name not in only_file_names:
            continue

        if file_name in name_to_a5:
            a5_id = name_to_a5[file_name]
        else:
            resolved = _resolve_audio_file(file_name, str(row["file_path"] or ""))
            if not resolved:
                continue
            source_url = _media_url_for_file(resolved)
            payload = {
                "source_url": source_url,
                "start_time_utc": row["start_time_utc"],
                "end_time_utc": row["end_time_utc"],
                "duration_ms": int(row["duration_ms"] or 0) or 6000,
                "file_name": file_name,
                "file_path": str(resolved),
                "file_size": int(row["file_size"] or 0) or resolved.stat().st_size,
                "status": int(row["status"] or 1),
                "track_id": default_track_id,
            }
            try:
                created = _post_json(f"{A5_BASE}/tables/audio_records/ext/create", payload)
                a5_id = int(created.get("audio_id", created.get("id")))
                name_to_a5[file_name] = a5_id
                created_audio += 1
            except Exception:  # noqa: BLE001
                continue

        if _a5_has_annotations(name_to_a5[file_name]):
            rows_chk = _get_json(f"{A5_BASE}/tables/annotations?limit=1000")
            only_demo = all(
                (x.get("storage_tag") or "") in ("demo_seed", "")
                for x in rows_chk
                if int(x.get("audio_id") or 0) == name_to_a5[file_name]
            )
            if not only_demo:
                continue

        batch = []
        for a in by_a3_audio.get(a3_id, []):
            text = a["annotation_text"] or a["asr_content"] or ""
            if not str(text).strip():
                continue
            conf = a["vad_confidence"]
            try:
                conf_f = float(str(conf).rstrip("%")) if conf is not None else 0.85
                if conf_f > 1:
                    conf_f /= 100.0
            except (TypeError, ValueError):
                conf_f = 0.85
            batch.append(
                {
                    "audio_id": name_to_a5[file_name],
                    "author_id": int(a["author_id"] or 1),
                    "label_type": a["label_type"] or "ASR",
                    "relative_start": float(a["relative_start"] or 0),
                    "relative_end": float(a["relative_end"] or 1),
                    "asr_content": text,
                    "annotation_text": text,
                    "vad_confidence": conf_f,
                    "is_annotated": int(a["is_annotated"] or 0),
                    "storage_tag": a["storage_tag"] or "a3_import",
                }
            )
        if not batch:
            continue
        try:
            _post_json(f"{A5_BASE}/tables/annotations/ext/create", batch)
            created_annos += len(batch)
        except Exception:  # noqa: BLE001
            pass

    return {
        "ok": 1,
        "created_audio": created_audio,
        "created_annos": created_annos,
    }


def main() -> int:
    result = run_sync_a3_to_a5()
    if not result.get("ok"):
        print(f"失败: {result.get('error')}", file=sys.stderr)
        return 1
    print(
        f"\n完成：新建录音 {result.get('created_audio', 0)} 条，"
        f"导入标注 {result.get('created_annos', 0)} 条。刷新前端查看。"
    )
    return 0 if (result.get("created_audio") or result.get("created_annos")) else 2


if __name__ == "__main__":
    raise SystemExit(main())
