from __future__ import annotations

import json
import shutil
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

import numpy as np
import soundfile as sf
from sqlalchemy.orm import Session

from app.core.security import utc_now_iso
from app.models.integration import AsrResult


ENGINE_NAME = "SenseVoice-ONNX"
MODEL_DIR = Path(__file__).resolve().parent / "model"
TARGET_SAMPLE_RATE = 16000
VAD_THRESHOLD = 0.3
VAD_MIN_SILENCE_SECONDS = 0.5
VAD_MIN_SPEECH_SECONDS = 0.1
VAD_MAX_SPEECH_SECONDS = 10.0


class AsrServiceError(RuntimeError):
    pass


@dataclass(frozen=True)
class AsrSegment:
    start: float
    end: float
    text: str
    lang: str = ""

    def to_dict(self) -> dict[str, float | str]:
        return {
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "text": self.text,
            "lang": self.lang,
        }


@dataclass(frozen=True)
class AsrRecognition:
    result_id: str
    unique_id: str
    transcript: str
    start_time: str
    end_time: str
    vad_segments: list[AsrSegment]
    engine: str = ENGINE_NAME

    def to_response(self) -> dict[str, object]:
        return {
            "result_id": self.result_id,
            "unique_id": self.unique_id,
            "transcript": self.transcript,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "engine": self.engine,
            "vad_segments": [segment.to_dict() for segment in self.vad_segments],
        }


def _resample_to_16k(samples: np.ndarray, src_rate: int) -> np.ndarray:
    if src_rate == TARGET_SAMPLE_RATE:
        return samples.astype(np.float32, copy=False)
    if src_rate <= 0 or len(samples) == 0:
        return samples.astype(np.float32, copy=False)
    n_out = max(1, int(round(len(samples) * TARGET_SAMPLE_RATE / src_rate)))
    src_indices = np.linspace(0, len(samples) - 1, n_out)
    idx_floor = np.floor(src_indices).astype(np.int64)
    idx_ceil = np.clip(idx_floor + 1, 0, len(samples) - 1)
    frac = src_indices - idx_floor
    resampled = samples[idx_floor] * (1 - frac) + samples[idx_ceil] * frac
    return resampled.astype(np.float32, copy=False)


class SenseVoiceRecognizer:
    _instance: "SenseVoiceRecognizer | None" = None
    _recognizer = None
    _vad_model_path: str | None = None

    def __new__(cls, model_dir: Path = MODEL_DIR):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance.model_dir = model_dir
            cls._instance._init_recognizer()
        return cls._instance

    def _init_recognizer(self) -> None:
        try:
            import sherpa_onnx
        except Exception as exc:
            raise AsrServiceError("Missing dependency: sherpa_onnx") from exc

        model_path, tokens_path = self._find_model_files()
        try:
            self._recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=str(model_path),
                tokens=str(tokens_path),
                language="en",
                use_itn=True,
                num_threads=4,
                provider="cpu",
                sample_rate=TARGET_SAMPLE_RATE,
            )
        except TypeError:
            self._recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=str(model_path),
                tokens=str(tokens_path),
                num_threads=4,
                use_itn=True,
                debug=False,
                provider="cpu",
            )
        except Exception as exc:
            raise AsrServiceError(f"Failed to load ASR model: {exc}") from exc

        vad_path = self.model_dir / "silero_vad.onnx"
        self._vad_model_path = str(vad_path) if vad_path.exists() else None

    def _find_model_files(self) -> tuple[Path, Path]:
        pairs = (
            ("model_finetuned.onnx", "tokens_finetuned.txt"),
            ("model.onnx", "tokens.txt"),
            ("model.int8.onnx", "tokens.txt"),
        )
        for model_name, tokens_name in pairs:
            model_path = self.model_dir / model_name
            tokens_path = self.model_dir / tokens_name
            if model_path.exists() and tokens_path.exists():
                return model_path, tokens_path
        raise AsrServiceError(f"ASR model files not found in {self.model_dir}")

    def recognize_file(self, audio_path: Path, recording_start_time: str | None = None) -> dict[str, object]:
        try:
            samples, sample_rate = sf.read(str(audio_path), dtype="float32", always_2d=False)
        except Exception as exc:
            raise AsrServiceError(f"Failed to read audio: {exc}") from exc

        if getattr(samples, "ndim", 1) > 1:
            samples = samples.mean(axis=1)
        samples = np.asarray(samples, dtype=np.float32)
        if len(samples) == 0:
            raise AsrServiceError("Uploaded audio is empty")

        peak = float(np.max(np.abs(samples)))
        if peak > 0:
            samples = samples * (0.95 / peak)

        samples_16k = _resample_to_16k(samples, int(sample_rate))
        duration_seconds = len(samples_16k) / TARGET_SAMPLE_RATE
        vad_segments = self._split_with_vad(samples_16k)
        if not vad_segments:
            vad_segments = [(0, len(samples_16k), samples_16k)]

        start_clock = time.time()
        segments: list[AsrSegment] = []
        for start_sample, end_sample, segment_samples in vad_segments:
            text, lang = self._recognize_segment(segment_samples)
            if not text:
                continue
            segments.append(
                AsrSegment(
                    start=start_sample / TARGET_SAMPLE_RATE,
                    end=end_sample / TARGET_SAMPLE_RATE,
                    text=text,
                    lang=lang,
                )
            )

        if not segments:
            segments = [AsrSegment(start=0.0, end=duration_seconds, text="")]

        transcript = " ".join(segment.text for segment in segments if segment.text).strip()
        rel_start = segments[0].start if segments else 0.0
        rel_end = segments[-1].end if segments else duration_seconds
        start_dt = self._parse_recording_start_time(recording_start_time)

        return {
            "text": transcript,
            "start_time": self._format_datetime(start_dt + timedelta(seconds=rel_start)),
            "end_time": self._format_datetime(start_dt + timedelta(seconds=rel_end)),
            "vad_segments": segments,
            "engine": ENGINE_NAME,
            "elapsed_sec": round(time.time() - start_clock, 2),
        }

    def _split_with_vad(self, samples: np.ndarray) -> list[tuple[int, int, np.ndarray]]:
        if not self._vad_model_path:
            return []
        try:
            import sherpa_onnx

            vad_config = sherpa_onnx.VadModelConfig()
            vad_config.silero_vad.model = self._vad_model_path
            vad_config.silero_vad.threshold = VAD_THRESHOLD
            vad_config.silero_vad.min_silence_duration = VAD_MIN_SILENCE_SECONDS
            vad_config.silero_vad.min_speech_duration = VAD_MIN_SPEECH_SECONDS
            vad_config.silero_vad.max_speech_duration = VAD_MAX_SPEECH_SECONDS
            vad_config.sample_rate = TARGET_SAMPLE_RATE
            vad = sherpa_onnx.VoiceActivityDetector(
                vad_config,
                buffer_size_in_seconds=max(10.0, len(samples) / TARGET_SAMPLE_RATE + 5.0),
            )
            for offset in range(0, len(samples), 512):
                vad.accept_waveform(samples[offset : offset + 512].tolist())
            vad.flush()

            segments: list[tuple[int, int, np.ndarray]] = []
            while not vad.empty():
                segment = vad.front
                seg_samples = np.asarray(segment.samples, dtype=np.float32)
                start = int(segment.start)
                segments.append((start, start + len(seg_samples), seg_samples))
                vad.pop()
            return segments
        except Exception:
            return []

    def _recognize_segment(self, samples: np.ndarray) -> tuple[str, str]:
        stream = self._recognizer.create_stream()
        stream.accept_waveform(TARGET_SAMPLE_RATE, samples.astype(np.float32, copy=False))
        try:
            if hasattr(self._recognizer, "decode_streams"):
                self._recognizer.decode_streams([stream])
            else:
                self._recognizer.decode_stream(stream)
            result = getattr(stream, "result", None)
            if result is None and hasattr(self._recognizer, "get_result"):
                result = self._recognizer.get_result(stream)
        except Exception as exc:
            raise AsrServiceError(f"ASR recognition failed: {exc}") from exc

        text = (getattr(result, "text", "") or "").strip()
        lang = (getattr(result, "lang", "") or "").strip()
        return text, lang

    @staticmethod
    def _parse_recording_start_time(value: str | None) -> datetime:
        if value:
            clean = value.strip().replace("T", " ")
            for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
                try:
                    return datetime.strptime(clean, fmt)
                except ValueError:
                    continue
        return datetime.now()

    @staticmethod
    def _format_datetime(value: datetime) -> str:
        return value.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


class AsrService:
    def __init__(self, db: Session, model_dir: Path | None = None):
        self.db = db
        self.model_dir = model_dir or MODEL_DIR

    def recognize_upload(
        self,
        file_obj,
        filename: str | None,
        unique_id: str | None,
        recording_start_time: str | None,
    ) -> AsrRecognition:
        if file_obj is None:
            raise AsrServiceError("No uploaded audio file")

        business_id = unique_id.strip() if unique_id and unique_id.strip() else uuid4().hex
        suffix = Path(filename or "audio.wav").suffix or ".wav"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = Path(tmp.name)
            shutil.copyfileobj(file_obj, tmp)

        try:
            result = SenseVoiceRecognizer(self.model_dir).recognize_file(tmp_path, recording_start_time)
        finally:
            tmp_path.unlink(missing_ok=True)

        recognition = AsrRecognition(
            result_id=uuid4().hex,
            unique_id=business_id,
            transcript=str(result["text"]),
            start_time=str(result["start_time"]),
            end_time=str(result["end_time"]),
            vad_segments=list(result["vad_segments"]),
        )
        self._save_result(recognition)
        return recognition

    def _save_result(self, recognition: AsrRecognition) -> None:
        row = AsrResult(
            result_id=recognition.result_id,
            unique_id=recognition.unique_id,
            vad_segments=json.dumps([segment.to_dict() for segment in recognition.vad_segments], ensure_ascii=False),
            transcript=recognition.transcript,
            engine=recognition.engine,
            start_time=recognition.start_time,
            end_time=recognition.end_time,
            created_at=utc_now_iso(),
        )
        self.db.add(row)
        self.db.commit()
