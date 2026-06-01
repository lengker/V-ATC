from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.core.security import utc_now_iso
from app.models.integration import AsrResult

DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[4] / "A-3" / "model"
MODEL_DIR = Path(os.getenv("ALPHA_ASR_MODEL_DIR", str(DEFAULT_MODEL_DIR)))

VAD_THRESHOLD = 0.3
VAD_MIN_SILENCE_MS = 500
VAD_MAX_SPEECH_S = 10.0

_np: Any = None
_sf: Any = None
_sherpa_onnx: Any = None


def _load_asr_dependencies() -> tuple[Any, Any, Any]:
    global _np, _sf, _sherpa_onnx
    if _np is None or _sf is None or _sherpa_onnx is None:
        try:
            import numpy as np
            import sherpa_onnx
            import soundfile as sf
        except ImportError as exc:
            raise RuntimeError(
                "ASR dependencies are not installed. Install numpy, soundfile, and sherpa-onnx for Alpha."
            ) from exc
        _np = np
        _sf = sf
        _sherpa_onnx = sherpa_onnx
    return _np, _sf, _sherpa_onnx


def _resample_to_16k(samples: Any, src_rate: int) -> Any:
    np, _, _ = _load_asr_dependencies()
    if src_rate == 16000:
        return samples
    n_out = int(len(samples) * 16000 / src_rate)
    src_indices = np.linspace(0, len(samples) - 1, n_out)
    idx_floor = np.floor(src_indices).astype(int)
    idx_ceil = np.clip(idx_floor + 1, 0, len(samples) - 1)
    frac = src_indices - idx_floor
    return samples[idx_floor] * (1 - frac) + samples[idx_ceil] * frac


def _read_audio(audio_path: str) -> tuple[Any, int]:
    _, sf, _ = _load_asr_dependencies()
    try:
        return sf.read(audio_path)
    except Exception as first_error:
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError(f"failed to read audio and ffmpeg is unavailable: {first_error}") from first_error

        converted = Path(tempfile.gettempdir()) / f"alpha_asr_{uuid.uuid4().hex}.wav"
        try:
            subprocess.run(
                [ffmpeg, "-y", "-i", audio_path, "-ac", "1", "-ar", "16000", str(converted)],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            return sf.read(str(converted))
        except subprocess.CalledProcessError as exc:
            stderr = exc.stderr.decode("utf-8", errors="ignore").strip()
            raise RuntimeError(f"ffmpeg failed to decode audio: {stderr or first_error}") from exc
        finally:
            converted.unlink(missing_ok=True)


def _silero_vad_split(samples: Any, sample_rate: int, vad_model_path: str) -> list[tuple[int, int, list[float]]]:
    _, _, sherpa_onnx = _load_asr_dependencies()
    vad_config = sherpa_onnx.VadModelConfig()
    vad_config.silero_vad.model = vad_model_path
    vad_config.silero_vad.threshold = VAD_THRESHOLD
    vad_config.silero_vad.min_silence_duration = VAD_MIN_SILENCE_MS / 1000.0
    vad_config.silero_vad.min_speech_duration = 0.1
    vad_config.silero_vad.max_speech_duration = VAD_MAX_SPEECH_S
    vad_config.sample_rate = sample_rate

    buffer_secs = len(samples) / sample_rate + 5
    vad = sherpa_onnx.VoiceActivityDetector(vad_config, buffer_size_in_seconds=buffer_secs)

    chunk_size = 512
    for offset in range(0, len(samples), chunk_size):
        vad.accept_waveform(samples[offset : offset + chunk_size].tolist())
    vad.flush()

    segments: list[tuple[int, int, list[float]]] = []
    while not vad.empty():
        segment = vad.front
        segments.append((segment.start, segment.start + len(segment.samples), segment.samples))
        vad.pop()

    return segments


class SenseVoiceRecognizer:
    _instance: "SenseVoiceRecognizer | None" = None
    _recognizer: Any = None
    _vad_model_path: str | None = None

    def __new__(cls) -> "SenseVoiceRecognizer":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._init_recognizer()
        return cls._instance

    def _init_recognizer(self) -> None:
        _, _, sherpa_onnx = _load_asr_dependencies()
        model_path = MODEL_DIR / "model.onnx"
        tokens_path = MODEL_DIR / "tokens.txt"
        if not model_path.exists():
            model_path = MODEL_DIR / "model_finetuned.onnx"
            tokens_path = MODEL_DIR / "tokens_finetuned.txt"
        if not model_path.exists() or not tokens_path.exists():
            raise FileNotFoundError(str(MODEL_DIR))

        self._recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(model_path),
            tokens=str(tokens_path),
            language="en",
            use_itn=True,
            num_threads=4,
            provider="cpu",
            sample_rate=16000,
        )

        vad_path = MODEL_DIR / "silero_vad.onnx"
        if vad_path.exists():
            self._vad_model_path = str(vad_path)

    def recognize_audio(self, audio_path: str, recording_start_time: str | None = None) -> dict[str, Any]:
        np, _, _ = _load_asr_dependencies()
        samples, sample_rate = _read_audio(audio_path)
        if len(samples.shape) > 1:
            samples = samples.mean(axis=1)

        max_val = np.abs(samples).max()
        if max_val > 0:
            samples = samples * (0.95 / max_val)

        samples = _resample_to_16k(samples, sample_rate)
        sample_rate = 16000

        segments = _silero_vad_split(samples, sample_rate, self._vad_model_path) if self._vad_model_path else []
        if not segments:
            segments = [(0, len(samples), samples.tolist())]

        full_text_parts: list[str] = []
        segment_info: list[dict[str, Any]] = []
        start_time = time.time()

        for segment_start, segment_end, segment_samples in segments:
            segment_array = np.array(segment_samples, dtype=np.float32)
            stream = self._recognizer.create_stream()
            stream.accept_waveform(sample_rate, segment_array)
            self._recognizer.decode_streams([stream])
            result = stream.result
            text = result.text.strip()
            if text:
                full_text_parts.append(text)
                segment_info.append(
                    {
                        "start": round(segment_start / sample_rate, 2),
                        "end": round(segment_end / sample_rate, 2),
                        "text": text,
                        "lang": result.lang if hasattr(result, "lang") else "",
                    }
                )

        full_text = " ".join(full_text_parts)
        elapsed = time.time() - start_time

        rel_start = segment_info[0]["start"] if segment_info else 0.0
        rel_end = segment_info[-1]["end"] if segment_info else len(samples) / sample_rate
        start_dt = _parse_recording_start(recording_start_time)
        start_abs = start_dt + timedelta(seconds=rel_start)
        end_abs = start_dt + timedelta(seconds=rel_end)

        return {
            "text": full_text,
            "start_time": start_abs.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            "end_time": end_abs.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            "vad_segments": segment_info,
            "engine": "SenseVoice-ONNX",
            "elapsed_sec": round(elapsed, 2),
        }


def _parse_recording_start(value: str | None) -> datetime:
    if value:
        try:
            fmt = "%Y-%m-%d %H:%M:%S.%f" if "." in value else "%Y-%m-%d %H:%M:%S"
            return datetime.strptime(value, fmt)
        except ValueError:
            pass
    return datetime.now()


class AsrService:
    def __init__(self, db: Session):
        self.db = db

    def recognize_audio(self, audio_path: str, unique_id: str | None, recording_start_time: str | None = None) -> dict[str, Any]:
        audio_id = unique_id or str(uuid.uuid4())
        recognizer = SenseVoiceRecognizer()
        recognized = recognizer.recognize_audio(audio_path, recording_start_time)
        result_id = str(uuid.uuid4())

        asr_result = AsrResult(
            result_id=result_id,
            unique_id=audio_id,
            vad_segments=json.dumps(recognized["vad_segments"], ensure_ascii=False),
            transcript=recognized["text"],
            engine=recognized["engine"],
            start_time=recognized["start_time"],
            end_time=recognized["end_time"],
            created_at=utc_now_iso(),
        )
        self.db.add(asr_result)
        self.db.commit()

        return {
            "result_id": result_id,
            "unique_id": audio_id,
            "transcript": recognized["text"],
            "start_time": recognized["start_time"],
            "end_time": recognized["end_time"],
            "engine": recognized["engine"],
            "vad_segments": recognized["vad_segments"],
        }
