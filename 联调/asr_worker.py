"""
独立 ASR 子进程（Vosk + ASCII 工作目录，避免中文路径导致引擎崩溃）。

用法:
  python 联调/asr_worker.py <audio_id> <mp3_or_wav_path> [replace_existing=1]
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import wave
import zipfile
from pathlib import Path
from urllib.request import urlretrieve

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A5_DB, LIAN_DIAO

VOSK_ZIP_URL = "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
VOSK_DIR_NAME = "vosk-model-small-en-us-0.15"


def _ascii_work_root() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()) / "qt-asr"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _bundled_vosk_src() -> Path | None:
    for cand in (
        LIAN_DIAO / "vosk-models" / VOSK_DIR_NAME,
        LIAN_DIAO / "vosk-models" / "small-en-us",
    ):
        if (cand / "am" / "final.mdl").is_file():
            return cand
    zip_path = LIAN_DIAO / "vosk-models" / "small-en-us.zip"
    if zip_path.is_file():
        dest = LIAN_DIAO / "vosk-models"
        dest.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(dest)
        extracted = dest / VOSK_DIR_NAME
        if (extracted / "am" / "final.mdl").is_file():
            return extracted
    return None


def _ensure_vosk_model() -> Path:
    """模型放在 %LOCALAPPDATA%\\qt-asr\\...（纯 ASCII 路径）。"""
    cache = _ascii_work_root() / VOSK_DIR_NAME
    if (cache / "am" / "final.mdl").is_file():
        return cache

    src = _bundled_vosk_src()
    if src is None:
        zip_path = _ascii_work_root() / "small-en-us.zip"
        if not zip_path.is_file():
            urlretrieve(VOSK_ZIP_URL, zip_path)  # noqa: S310
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(_ascii_work_root())
        if not (cache / "am" / "final.mdl").is_file():
            raise FileNotFoundError("vosk model download/extract failed")
        return cache

    if cache.exists():
        shutil.rmtree(cache, ignore_errors=True)
    shutil.copytree(src, cache)
    return cache


def _to_wav_16k_ascii(src: Path, audio_id: int) -> Path:
    out = _ascii_work_root() / f"audio_{audio_id}.wav"
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-ar",
        "16000",
        "-ac",
        "1",
        "-f",
        "wav",
        str(out),
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=120)
    return out


def _words_to_segments(words: list[dict], *, gap: float = 0.55) -> list[tuple[float, float, str]]:
    if not words:
        return []
    segments: list[tuple[float, float, str]] = []
    chunk: list[str] = []
    start = float(words[0].get("start", 0))
    prev_end = float(words[0].get("end", start))

    def flush(end_t: float) -> None:
        nonlocal chunk, start
        text = " ".join(chunk).strip()
        if text:
            segments.append((start, max(end_t, start + 0.3), text))
        chunk = []

    chunk.append(str(words[0].get("word", "")))
    for w in words[1:]:
        ws = float(w.get("start", prev_end))
        we = float(w.get("end", ws))
        if ws - prev_end > gap and chunk:
            flush(prev_end)
            start = ws
        chunk.append(str(w.get("word", "")))
        prev_end = we
    flush(prev_end)
    return segments


def _transcribe_vosk(wav_path: Path) -> list[tuple[float, float, str]]:
    from vosk import KaldiRecognizer, Model

    model = Model(str(_ensure_vosk_model()))
    with wave.open(str(wav_path), "rb") as wf:
        rec = KaldiRecognizer(model, wf.getframerate())
        rec.SetWords(True)
        all_words: list[dict] = []
        while True:
            data = wf.readframes(4000)
            if not data:
                break
            if rec.AcceptWaveform(data):
                part = json.loads(rec.Result())
                all_words.extend(part.get("result") or [])
        final = json.loads(rec.FinalResult())
        all_words.extend(final.get("result") or [])

    segs = _words_to_segments(all_words)
    if segs:
        return segs
    text = str(final.get("text") or "").strip()
    if text:
        with wave.open(str(wav_path), "rb") as wf:
            dur = wf.getnframes() / float(wf.getframerate() or 16000)
        return [(0.0, max(dur, 1.0), text)]
    return []


def _insert_segments(
    audio_id: int, rows: list[tuple[float, float, str]], replace: bool
) -> int:
    import sqlite3
    from datetime import datetime, timezone

    if replace and A5_DB.exists():
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
        for i, (start, end, text) in enumerate(rows):
            text = text.strip()
            if not text:
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
                    max(end, start + 0.3),
                    now,
                    now,
                    text,
                    text,
                    f"vosk_{audio_id}_{i}",
                ),
            )
            created += 1
        conn.commit()
    finally:
        conn.close()
    return created


def run(audio_id: int, audio_path: Path, replace_existing: bool = True) -> dict:
    if not audio_path.is_file():
        return {"ok": 0, "error": "file_not_found", "annotations": 0}

    wav_tmp: Path | None = None
    try:
        try:
            import vosk  # noqa: F401
        except ImportError:
            return {
                "ok": 0,
                "error": "missing_vosk",
                "hint": "联调\\.asr-venv\\Scripts\\pip install vosk",
                "annotations": 0,
            }

        wav_tmp = _to_wav_16k_ascii(audio_path.resolve(), audio_id)
        rows = _transcribe_vosk(wav_tmp)
        if not rows:
            return {"ok": 1, "annotations": 0, "mode": "vosk_empty"}

        n = _insert_segments(audio_id, rows, replace_existing)
        return {"ok": 1, "annotations": n, "mode": "vosk"}
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", "ignore")[:300]
        return {"ok": 0, "error": "ffmpeg_failed", "detail": err}
    except Exception as e:  # noqa: BLE001
        return {"ok": 0, "error": str(e), "annotations": 0}
    finally:
        if wav_tmp and wav_tmp.exists():
            try:
                wav_tmp.unlink()
            except OSError:
                pass


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"ok": 0, "error": "usage: asr_worker.py audio_id path [replace]"}))
        return 1
    audio_id = int(sys.argv[1])
    path = Path(sys.argv[2])
    replace = sys.argv[3].strip() not in ("0", "false", "False") if len(sys.argv) > 3 else True
    out = run(audio_id, path, replace)
    print(json.dumps(out, ensure_ascii=False))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
