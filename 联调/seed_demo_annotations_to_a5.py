"""
为 A5 中已同步的 A2 录音写入【演示】标注（假文本，非 A3 ASR）。
联调展示请用 process_a2_via_a3.py；勿在生产/实时链路中调用本脚本。

用法:
  python 联调/seed_demo_annotations_to_a5.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A5_BASE

DEFAULT_AUTHOR_ID = 3

DEMO_SEGMENTS: dict[int, list[tuple[float, float, str]]] = {}


def _post_json(url: str, payload: dict | list) -> dict | list:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get_json(url: str) -> list:
    with urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _demo_text_for_file(file_name: str, idx: int) -> str:
    base = file_name.replace(".mp3", "").replace(".wav", "").upper()
    samples = [
        f"{base}: Hong Kong Tower, good morning, wind 070 at 8 knots.",
        f"{base}: Cathay 456, line up and wait runway 07R.",
        f"{base}: Cleared for takeoff runway 07R, Cathay 456.",
        f"{base}: Roger, cleared for takeoff 07R, Cathay 456.",
    ]
    return samples[idx % len(samples)]


def _build_segments(duration_sec: float, file_name: str) -> list[tuple[float, float, str]]:
    d = max(3.0, duration_sec)
    if d <= 8:
        return [
            (0.0, min(2.5, d - 0.5), _demo_text_for_file(file_name, 0)),
            (2.5, min(5.5, d - 0.3), _demo_text_for_file(file_name, 1)),
            (max(0, d - 2.5), d, _demo_text_for_file(file_name, 2)),
        ]
    step = d / 4
    return [
        (i * step, min((i + 1) * step - 0.2, d), _demo_text_for_file(file_name, i))
        for i in range(4)
    ]


def _is_a2_media_url(source_url: str) -> bool:
    s = str(source_url or "")
    return "127.0.0.1:8001/media" in s or "localhost:8001/media" in s


def run_seed_annotations(*, only_audio_ids: set[int] | None = None) -> dict[str, int | str]:
    """为尚无标注的 A2 同步录音写入演示 VAD/ASR 段，供前端文本时间轴展示。"""
    try:
        audios = _get_json(f"{A5_BASE}/tables/audio_records?limit=1000")
    except URLError as exc:
        return {"ok": 0, "error": str(exc), "created": 0, "skipped": 0, "audios": 0}

    targets = [a for a in audios if _is_a2_media_url(str(a.get("source_url", "")))]
    if only_audio_ids is not None:
        targets = [a for a in targets if int(a.get("audio_id") or 0) in only_audio_ids]

    by_name: dict[str, dict] = {}
    for a in targets:
        name = str(a.get("file_name") or "")
        aid = int(a["audio_id"])
        if name not in by_name or aid > int(by_name[name]["audio_id"]):
            by_name[name] = a

    try:
        existing = _get_json(f"{A5_BASE}/tables/annotations?limit=1000")
    except URLError as exc:
        return {"ok": 0, "error": str(exc), "created": 0, "skipped": 0, "audios": len(by_name)}

    has_anno = {int(x["audio_id"]) for x in existing if x.get("audio_id") is not None}

    created = 0
    skipped = 0
    seeded_audios = 0
    for a in by_name.values():
        audio_id = int(a["audio_id"])
        if audio_id in has_anno:
            skipped += 1
            continue

        duration_sec = max(1, int(a.get("duration_ms") or 1000) / 1000)
        file_name = str(a.get("file_name") or f"audio_{audio_id}")
        segments = DEMO_SEGMENTS.get(audio_id) or _build_segments(duration_sec, file_name)

        batch = [
            {
                "audio_id": audio_id,
                "author_id": DEFAULT_AUTHOR_ID,
                "label_type": "ATC",
                "relative_start": round(start, 2),
                "relative_end": round(end, 2),
                "asr_content": text,
                "annotation_text": text,
                "vad_confidence": 0.92,
                "is_annotated": 1,
                "storage_tag": "demo_seed",
            }
            for start, end, text in segments
        ]

        _post_json(f"{A5_BASE}/tables/annotations/ext/create", batch)
        created += len(batch)
        seeded_audios += 1

    return {
        "ok": 1,
        "created": created,
        "skipped": skipped,
        "seeded_audios": seeded_audios,
        "audios": len(by_name),
    }


def main() -> int:
    result = run_seed_annotations()
    if not result.get("ok"):
        print(f"失败: {result.get('error')}", file=sys.stderr)
        return 1
    print(
        f"完成：为 {result.get('seeded_audios', 0)} 条录音新建 {result.get('created', 0)} 条标注，"
        f"跳过 {result.get('skipped', 0)} 条已有标注。"
        f"\n请刷新 http://localhost:3000 ，在 Transcriptions 面板查看文本时间轴。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
