"""
调用 A3（:9002）对 A2 同步到 A5 的录音做 VAD+ASR，写入 A5 annotations 供前端文本时间轴。

推荐 A3 与 A5 共用库（start-all.ps1 已设 DATABASE_URL → backend/data.sqlite3）：
  POST /api/v1/process_existing?audio_id=&source_url=<本地 mp3 绝对路径>

若 A3 使用独立库，则回退 POST /api/v1/process 上传文件，再 sync_a3_db_to_a5 按 file_name 对齐。

用法:
  python 联调/process_a2_via_a3.py
  python 联调/process_a2_via_a3.py --limit 5
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A2_ROOT, A3_BASE, A3_ROOT, A5_BASE, A5_DB


def _get_json(url: str, timeout: int = 30) -> list | dict:
    with urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _post_json(url: str, payload: dict, timeout: int = 60) -> dict | list:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _post_empty(url: str, timeout: int = 600) -> dict:
    req = Request(url, data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def _post_multipart_file(url: str, file_path: Path, timeout: int = 600) -> dict:
    boundary = f"----Boundary{uuid.uuid4().hex}"
    filename = file_path.name
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    file_bytes = file_path.read_bytes()
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")
    req = Request(
        url,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _is_a2_media_url(source_url: str) -> bool:
    s = str(source_url or "")
    return "127.0.0.1:8001/media" in s or "localhost:8001/media" in s


def _download_media_to_cache(source_url: str, file_name: str) -> Path | None:
    """A5 file_path 不可用时，从 A2 /media URL 拉取到本地缓存供 A3 读取。"""
    cache_dir = A2_ROOT / "data" / "audio" / "_a3_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / file_name
    if dest.exists() and dest.stat().st_size > 0:
        return dest.resolve()
    try:
        req = Request(source_url, method="GET")
        with urlopen(req, timeout=120) as resp:
            dest.write_bytes(resp.read())
        return dest.resolve() if dest.stat().st_size > 0 else None
    except (URLError, HTTPError, OSError):
        return None


def resolve_a2_local_path(row: dict) -> Path | None:
    file_path = str(row.get("file_path") or "").strip()
    if file_path:
        p = Path(file_path)
        if p.is_file():
            return p.resolve()
        if not p.is_absolute():
            for base in (A2_ROOT, A2_ROOT / "data" / "audio"):
                cand = (base / file_path.replace("\\", "/")).resolve()
                if cand.is_file():
                    return cand

    source_url = str(row.get("source_url") or "")
    for marker in ("8001/media/", "8001\\media\\"):
        if marker.replace("\\", "/") in source_url.replace("\\", "/"):
            rel = source_url.split("8001/media/", 1)[-1].split("8001\\media\\", 1)[-1]
            rel = rel.split("?", 1)[0].lstrip("/").replace("\\", "/")
            candidate = (A2_ROOT / "data" / "audio" / rel).resolve()
            if candidate.exists():
                return candidate

    file_name = str(row.get("file_name") or "")
    if file_name:
        audio_root = A2_ROOT / "data" / "audio"
        if audio_root.is_dir():
            hits = list(audio_root.rglob(file_name))
            if hits:
                return hits[0].resolve()

    if source_url and file_name and _is_a2_media_url(source_url):
        return _download_media_to_cache(source_url, file_name)
    return None


def _is_demo_like_text(text: str) -> bool:
    t = text.strip()
    if not t:
        return False
    markers = (
        "Hong Kong Tower, good morning",
        "Cathay 456, line up and wait",
        "Cleared for takeoff runway 07R",
        "Roger, cleared for takeoff",
    )
    return any(m in t for m in markers) and ":" in t[:40]


def _has_real_asr(annotations: list, audio_id: int) -> bool:
    for a in annotations:
        if int(a.get("audio_id") or 0) != audio_id:
            continue
        tag = str(a.get("storage_tag") or "")
        if tag == "demo_seed":
            continue
        text = str(a.get("asr_content") or a.get("annotation_text") or "").strip()
        if text and not _is_demo_like_text(text):
            return True
    return False


def _clear_demo_annotations(audio_id: int) -> int:
    rows = _get_json(f"{A5_BASE}/tables/annotations?limit=1000")
    if not isinstance(rows, list):
        return 0
    deleted = 0
    for a in rows:
        if int(a.get("audio_id") or 0) != audio_id:
            continue
        if str(a.get("storage_tag") or "") != "demo_seed":
            continue
        ann_id = int(a["annotation_id"])
        _post_json(f"{A5_BASE}/tables/annotations/ext/delete-one", {"id": ann_id})
        deleted += 1
    return deleted


def _a3_health_ok() -> bool:
    try:
        data = _get_json(f"{A3_BASE}/", timeout=5)
        return isinstance(data, dict) and data.get("status") == "running"
    except (URLError, HTTPError, TimeoutError, json.JSONDecodeError):
        return False


def _call_a3_process_existing(audio_id: int, row: dict, local_path: Path) -> dict:
    path_str = str(local_path.resolve())
    source_url = str(row.get("source_url") or path_str)
    file_path = str(row.get("file_path") or path_str)
    file_name = str(row.get("file_name") or local_path.name)
    url = (
        f"{A3_BASE}/api/v1/process_existing"
        f"?audio_id={audio_id}"
        f"&source_url={quote(source_url, safe='')}"
        f"&file_path={quote(file_path, safe='')}"
        f"&file_name={quote(file_name, safe='')}"
        f"&replace_existing=true"
    )
    return _post_empty(url, timeout=600)


def _call_a3_process_upload(local_path: Path) -> dict:
    return _post_multipart_file(f"{A3_BASE}/api/v1/process", local_path, timeout=600)


def _insert_asr_segments_to_a5(
    audio_id: int,
    segments: list[tuple[float, float, str]],
    *,
    replace_existing: bool = True,
    tag_prefix: str = "fw",
) -> int:
    import sqlite3
    from datetime import datetime, timezone

    if replace_existing and A5_DB.exists():
        conn = sqlite3.connect(A5_DB)
        try:
            conn.execute("DELETE FROM LNG_ANNOTATIONS WHERE audio_id = ?", (audio_id,))
            conn.commit()
        finally:
            conn.close()

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    created = 0
    conn = sqlite3.connect(A5_DB)
    try:
        for i, (start, end, text) in enumerate(segments):
            text = text.strip()
            if len(text) < 1:
                continue
            conn.execute(
                """
                INSERT INTO LNG_ANNOTATIONS (
                    label_type, author_id, audio_id,
                    relative_start, relative_end,
                    abs_start_time, abs_end_time,
                    asr_content, vad_confidence, is_annotated,
                    annotation_text, storage_tag
                ) VALUES ('ATC_COMMUNICATION', 1, ?, ?, ?, ?, ?, ?, 0.85, 0, ?, ?)
                """,
                (
                    audio_id,
                    start,
                    max(end, start + 0.5),
                    now,
                    now,
                    text,
                    text,
                    f"{tag_prefix}_{audio_id}_{i}",
                ),
            )
            created += 1
        conn.commit()
    finally:
        conn.close()
    return created


def _asr_venv_python() -> Path | None:
    p = Path(__file__).resolve().parent / ".asr-venv" / "Scripts" / "python.exe"
    return p if p.is_file() else None


def _run_asr_worker_subprocess(
    audio_id: int,
    local_path: Path,
    *,
    replace_existing: bool = True,
) -> dict[str, object] | None:
    """在独立 venv 子进程跑 asr_worker.py，隔离主环境 NumPy/numba 问题。"""
    worker = Path(__file__).resolve().parent / "asr_worker.py"
    if not worker.is_file():
        return None
    py = _asr_venv_python() or Path(sys.executable)
    env = {**os.environ}
    env.setdefault("WHISPER_MODEL", "tiny")
    try:
        proc = subprocess.run(
            [
                str(py),
                str(worker),
                str(audio_id),
                str(local_path.resolve()),
                "1" if replace_existing else "0",
            ],
            capture_output=True,
            text=True,
            timeout=600,
            cwd=str(worker.parent),
            env=env,
        )
        lines = [ln.strip() for ln in (proc.stdout or "").splitlines() if ln.strip()]
        if not lines:
            return {
                "ok": 0,
                "error": "asr_worker_no_output",
                "stderr": (proc.stderr or "")[-500:],
            }
        out = json.loads(lines[-1])
        if proc.returncode != 0 and out.get("ok") != 1:
            out.setdefault("error", out.get("error") or f"exit_{proc.returncode}")
            if proc.stderr:
                out["stderr"] = proc.stderr[-500:]
        return out
    except subprocess.TimeoutExpired:
        return {"ok": 0, "error": "asr_timeout"}
    except (json.JSONDecodeError, OSError) as exc:
        return {"ok": 0, "error": str(exc)}


def _run_faster_whisper_to_a5(
    audio_id: int,
    local_path: Path,
    *,
    replace_existing: bool = True,
) -> int:
    """
    faster-whisper 整文件转写直写 A5。
    返回写入条数；-1 表示未安装/需运行 setup_asr_venv.ps1。
    """
    if not local_path.is_file():
        return 0

    sub = _run_asr_worker_subprocess(
        audio_id, local_path, replace_existing=replace_existing
    )
    if sub is not None:
        if sub.get("ok") == 1:
            return int(sub.get("annotations") or 0)
        err = str(sub.get("error") or "")
        if err in ("missing_faster_whisper", "missing_vosk", "asr_worker_no_output"):
            return -1
        return 0

    return -1


def _run_a3_local_process_existing(audio_id: int, row: dict, local_path: Path) -> int:
    """A3 服务未就绪时，本进程直接 Whisper+VAD 写 A5 库。"""
    os.environ.setdefault("ASR_BACKEND", "whisper")
    os.environ.setdefault("WHISPER_MODEL", "tiny")
    db_url = f"sqlite:///{A5_DB.as_posix()}"
    os.environ["DATABASE_URL"] = db_url

    a3_root = str(A3_ROOT.resolve())
    if a3_root not in sys.path:
        sys.path.insert(0, a3_root)

    from app.db.session import SessionLocal
    from app.services.speech_service import SpeechService

    db = SessionLocal()
    try:
        svc = SpeechService()
        results = svc.process_existing_audio_record(
            db,
            audio_id,
            str(local_path.resolve()),
            file_path=str(row.get("file_path") or local_path),
            file_name=str(row.get("file_name") or local_path.name),
            replace_existing=True,
        )
        return len(results)
    finally:
        db.close()


def _process_one_audio(
    audio_id: int,
    row: dict,
    *,
    annotations: list,
    replace_demo: bool,
    prefer_http: bool,
) -> dict:
    file_name = str(row.get("file_name") or "")
    if _has_real_asr(annotations, audio_id):
        return {"status": "skipped", "audio_id": audio_id, "file_name": file_name}

    local_path = resolve_a2_local_path(row)
    if not local_path or not local_path.exists():
        return {"status": "failed", "audio_id": audio_id, "file_name": file_name, "error": "file_not_found"}

    if replace_demo:
        _clear_demo_annotations(audio_id)

    # 优先 faster-whisper 直写 A5（Windows NumPy2 + openai-whisper/numba 会 500）
    fw_count = _run_faster_whisper_to_a5(
        audio_id, local_path, replace_existing=replace_demo
    )
    if fw_count > 0:
        return {
            "status": "processed",
            "audio_id": audio_id,
            "file_name": file_name,
            "mode": "vosk",
            "annotations": fw_count,
        }
    if fw_count == -1:
        return {
            "status": "failed",
            "audio_id": audio_id,
            "file_name": file_name,
            "error": "asr_env_missing",
            "hint": "在 联调 目录执行: .\\setup_asr_venv.ps1",
            "annotations": 0,
        }
    if fw_count == 0:
        return {
            "status": "processed",
            "audio_id": audio_id,
            "file_name": file_name,
            "mode": "vosk_empty",
            "annotations": 0,
            "error": "no_speech_detected",
        }

    ann_count = 0
    mode = "process_existing"
    if prefer_http and _a3_health_ok():
        try:
            out = _call_a3_process_existing(audio_id, row, local_path)
            ann_count = int(out.get("data", {}).get("total_annotations") or 0)
            if ann_count == 0:
                mode = "process_upload"
                upload_out = _call_a3_process_upload(local_path)
                ann_count = int(upload_out.get("data", {}).get("total_records") or 0)
                if ann_count > 0:
                    from sync_a3_db_to_a5 import run_sync_a3_to_a5

                    sync_out = run_sync_a3_to_a5(only_file_names={file_name})
                    ann_count = int(sync_out.get("created_annos") or ann_count)
        except (URLError, HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            ann_count = _run_a3_local_process_existing(audio_id, row, local_path)
            mode = f"local_whisper_after_http_error:{exc}"
    else:
        ann_count = _run_a3_local_process_existing(audio_id, row, local_path)
        mode = "local_whisper"

    return {
        "status": "processed",
        "audio_id": audio_id,
        "file_name": file_name,
        "mode": mode,
        "annotations": ann_count,
    }


def run_a3_asr_for_audio_id(*, audio_id: int, replace_demo: bool = True) -> dict[str, object]:
    """为单条 A5 录音生成 ASR（HTTP A3 或本机 Whisper）。"""
    try:
        audios = _get_json(f"{A5_BASE}/tables/audio_records?limit=1000")
        annotations = _get_json(f"{A5_BASE}/tables/annotations?limit=1000")
    except URLError as exc:
        return {"ok": 0, "error": str(exc)}

    if not isinstance(audios, list):
        return {"ok": 0, "error": "invalid_audio_list"}
    row = next((a for a in audios if int(a.get("audio_id") or 0) == audio_id), None)
    if not row:
        return {"ok": 0, "error": f"audio_id={audio_id} not found"}
    if not isinstance(annotations, list):
        annotations = []

    prefer_http = _a3_health_ok()
    detail = _process_one_audio(
        audio_id, row, annotations=annotations, replace_demo=replace_demo, prefer_http=prefer_http
    )
    return {
        "ok": 1 if detail.get("status") != "failed" else 0,
        "audio_id": audio_id,
        "details": [detail],
        "annotations": int(detail.get("annotations") or 0),
    }


def run_a3_asr_for_a5(*, limit: int = 5, replace_demo: bool = True) -> dict[str, int | str | list]:
    """对尚无真实 ASR 的 A2→A5 录音调用 A3，返回统计。"""
    prefer_http = _a3_health_ok()

    purge_deleted = 0
    if replace_demo:
        from purge_demo_annotations import run_purge_demo_annotations

        purge = run_purge_demo_annotations()
        purge_deleted = int(purge.get("deleted") or 0)

    try:
        audios = _get_json(f"{A5_BASE}/tables/audio_records?limit=1000")
        annotations = _get_json(f"{A5_BASE}/tables/annotations?limit=1000")
    except URLError as exc:
        return {"ok": 0, "error": str(exc), "processed": 0, "skipped": 0, "annotations": 0}

    if not isinstance(audios, list):
        audios = []
    if not isinstance(annotations, list):
        annotations = []

    targets = [a for a in audios if _is_a2_media_url(str(a.get("source_url", "")))]
    targets.sort(key=lambda x: int(x.get("audio_id") or 0), reverse=True)

    processed = 0
    skipped = 0
    failed = 0
    total_annotations = 0
    details: list[dict] = []

    for row in targets:
        if processed >= limit:
            break
        audio_id = int(row["audio_id"])
        file_name = str(row.get("file_name") or "")

        detail = _process_one_audio(
            audio_id,
            row,
            annotations=annotations,
            replace_demo=replace_demo,
            prefer_http=prefer_http,
        )
        st = detail.get("status")
        if st == "skipped":
            skipped += 1
            continue
        if st == "failed":
            failed += 1
            details.append(detail)
            continue

        processed += 1
        ann_count = int(detail.get("annotations") or 0)
        total_annotations += ann_count
        details.append(detail)

    return {
        "ok": 1,
        "purge_demo_deleted": purge_deleted,
        "processed": processed,
        "skipped": skipped,
        "failed": failed,
        "annotations": total_annotations,
        "a3_http": prefer_http,
        "details": details,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="A2→A5 录音经 A3 做 VAD+ASR")
    parser.add_argument("--limit", type=int, default=3, help="本轮最多处理几条（ASR 较慢）")
    parser.add_argument("--audio-id", type=int, default=None, help="仅处理指定 A5 audio_id")
    args = parser.parse_args()
    if args.audio_id is not None:
        result = run_a3_asr_for_audio_id(audio_id=int(args.audio_id))
    else:
        result = run_a3_asr_for_a5(limit=max(1, args.limit))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
