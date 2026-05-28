import json
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import soundfile as sf
import sherpa_onnx
from sqlalchemy.orm import Session

from app.models.integration import AsrResult
from app.core.security import utc_now_iso


UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

MODEL_DIR = Path(__file__).parent / "model"

# Silero VAD 参数 
VAD_THRESHOLD = 0.3
VAD_MIN_SILENCE_MS = 500
VAD_MAX_SPEECH_S = 10.0


def _resample_to_16k(samples: np.ndarray, src_rate: int) -> np.ndarray:
    if src_rate == 16000:
        return samples
    n_out = int(len(samples) * 16000 / src_rate)
    src_indices = np.linspace(0, len(samples) - 1, n_out)
    idx_floor = np.floor(src_indices).astype(int)
    idx_ceil = np.clip(idx_floor + 1, 0, len(samples) - 1)
    frac = src_indices - idx_floor
    return samples[idx_floor] * (1 - frac) + samples[idx_ceil] * frac


def _silero_vad_split(samples: np.ndarray, sample_rate: int,
                      vad_model_path: str) -> list[tuple[int, int, list[float]]]:
    """Silero VAD 分段，返回 [(start_sample, end_sample, segment_samples), ...]"""
    vad_config = sherpa_onnx.VadModelConfig()
    vad_config.silero_vad.model = vad_model_path
    vad_config.silero_vad.threshold = VAD_THRESHOLD
    vad_config.silero_vad.min_silence_duration = VAD_MIN_SILENCE_MS / 1000.0
    vad_config.silero_vad.min_speech_duration = 0.1
    vad_config.silero_vad.max_speech_duration = VAD_MAX_SPEECH_S
    vad_config.sample_rate = sample_rate

    buffer_secs = len(samples) / sample_rate + 5
    vad = sherpa_onnx.VoiceActivityDetector(vad_config, buffer_size_in_seconds=buffer_secs)

    # 流式喂入：每次 512 个采样点
    chunk_size = 512
    for offset in range(0, len(samples), chunk_size):
        chunk = samples[offset:offset + chunk_size].tolist()
        vad.accept_waveform(chunk)
    vad.flush()

    segments = []
    while not vad.empty():
        seg = vad.front
        segments.append((seg.start, seg.start + len(seg.samples), seg.samples))
        vad.pop()

    return segments


class SenseVoiceRecognizer:
    _instance = None
    _recognizer = None
    _vad_model_path = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._init_recognizer()
        return cls._instance

    def _init_recognizer(self):
        model_path = MODEL_DIR / "model.onnx"
        tokens_path = MODEL_DIR / "tokens.txt"
        if not model_path.exists():
            model_path = MODEL_DIR / "model_finetuned.onnx"
            tokens_path = MODEL_DIR / "tokens_finetuned.txt"

        if not model_path.exists() or not tokens_path.exists():
            raise FileNotFoundError("模型文件缺失")

        self._recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(model_path),
            tokens=str(tokens_path),
            language="en",
            use_itn=True,
            num_threads=4,
            provider="cpu",
            sample_rate=16000,
        )
        print(f"SenseVoice model loaded: {model_path.name}")

        # Silero VAD 模型路径
        vad_path = MODEL_DIR / "silero_vad.onnx"
        if vad_path.exists():
            self._vad_model_path = str(vad_path)
            print("Silero VAD model found")
        else:
            print("Silero VAD model not found, using fallback")

    def recognize_audio(self, audio_path: str, recording_start_time: str | None = None):
        samples, sample_rate = sf.read(audio_path)
        if len(samples.shape) > 1:
            samples = samples.mean(axis=1)

        # 峰值归一化
        max_val = np.abs(samples).max()
        if max_val > 0:
            samples = samples * (0.95 / max_val)

        # 重采样到 16kHz
        samples = _resample_to_16k(samples, sample_rate)
        sample_rate = 16000

        # VAD 分段：优先 Silero VAD，回退到整段识别
        if self._vad_model_path:
            segments = _silero_vad_split(samples, sample_rate, self._vad_model_path)
        else:
            segments = []

        if not segments:
            segments = [(0, len(samples), samples.tolist())]

        # 对每段分别识别
        full_text_parts = []
        segment_info = []  # (start_sec, end_sec, text) for vad_segments
        start_time = time.time()

        for seg_start, seg_end, seg_samples in segments:
            seg_arr = np.array(seg_samples, dtype=np.float32)
            stream = self._recognizer.create_stream()
            stream.accept_waveform(sample_rate, seg_arr)
            self._recognizer.decode_streams([stream])
            result = stream.result

            text = result.text.strip()
            if text:
                full_text_parts.append(text)
                segment_info.append({
                    "start": round(seg_start / sample_rate, 2),
                    "end": round(seg_end / sample_rate, 2),
                    "text": text,
                    "lang": result.lang if hasattr(result, "lang") else "",
                })

        elapsed = time.time() - start_time

        full_text = " ".join(full_text_parts)

        # 时间戳
        rel_start = 0.0
        rel_end = len(samples) / sample_rate
        if segment_info:
            rel_start = segment_info[0]["start"]
            rel_end = segment_info[-1]["end"]

        if recording_start_time:
            try:
                fmt = "%Y-%m-%d %H:%M:%S.%f" if "." in recording_start_time else "%Y-%m-%d %H:%M:%S"
                start_dt = datetime.strptime(recording_start_time, fmt)
            except Exception:
                start_dt = datetime.now()
        else:
            start_dt = datetime.now()

        start_abs = start_dt + timedelta(seconds=rel_start)
        end_abs = start_dt + timedelta(seconds=rel_end)

        return {
            "text": full_text,
            "start_time": start_abs.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            "end_time": end_abs.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            "vad_segments": json.dumps(segment_info, ensure_ascii=False),
            "engine": "SenseVoice-ONNX",
            "elapsed_sec": round(elapsed, 2),
        }


class AsrService:
    def __init__(self, db: Session):
        self.db = db

    def recognize_audio(self, audio_path: str, unique_id: str | None, recording_start_time: str | None = None):
        if unique_id is None:
            unique_id = str(uuid.uuid4())

        recognizer = SenseVoiceRecognizer()
        res = recognizer.recognize_audio(audio_path, recording_start_time)

        result_id = str(uuid.uuid4())

        asr_result = AsrResult(
            result_id=result_id,
            unique_id=unique_id,
            vad_segments=res["vad_segments"],
            transcript=res["text"],
            engine=res["engine"],
            start_time=res["start_time"],
            end_time=res["end_time"],
            created_at=utc_now_iso(),
        )
        self.db.add(asr_result)
        self.db.commit()

        return {
            "result_id": result_id,
            "unique_id": unique_id,
            "transcript": res["text"],
            "start_time": res["start_time"],
            "end_time": res["end_time"],
            "engine": res["engine"]
        }
