# app/engine/sense_voice.py
"""ASR：Windows 上 SenseVoice(sherpa) 易解码失败，默认用 openai-whisper。"""
from __future__ import annotations

import logging
import os
import sys
import tempfile
from typing import Optional

import numpy as np

from app.core.config import settings

logger = logging.getLogger(__name__)

_DEFAULT_BACKEND = "faster_whisper" if sys.platform == "win32" else "auto"


class ASRError(Exception):
    pass


class ModelLoadError(ASRError):
    pass


class RecognitionError(ASRError):
    pass


def _prepare_float32_mono(audio_data, sample_rate: int, target_sr: int = 16000) -> np.ndarray:
    if audio_data is None or len(audio_data) == 0:
        return np.array([], dtype=np.float32)
    wav = np.ascontiguousarray(np.asarray(audio_data, dtype=np.float32).reshape(-1))
    if sample_rate != target_sr and len(wav) > 0:
        n = int(round(len(wav) * target_sr / max(sample_rate, 1)))
        if n > 1:
            x_old = np.arange(len(wav), dtype=np.float64)
            x_new = np.linspace(0, len(wav) - 1, num=n, dtype=np.float64)
            wav = np.interp(x_new, x_old, wav).astype(np.float32)
    return np.clip(wav, -1.0, 1.0)


class FasterWhisperEngine:
    """CTranslate2 Whisper，不依赖 openai-whisper/numba（Windows NumPy2 友好）。"""

    def __init__(self, model_name: str = "tiny"):
        try:
            from faster_whisper import WhisperModel
        except ImportError as e:
            raise ModelLoadError(
                "未安装 faster-whisper，请执行: pip install faster-whisper"
            ) from e
        logger.info("[ASR] 加载 faster-whisper: %s", model_name)
        self._model = WhisperModel(model_name, device="cpu", compute_type="int8")

    def recognize(self, audio_data, sample_rate: int = 16000) -> str:
        wav = _prepare_float32_mono(audio_data, sample_rate)
        if len(wav) == 0:
            return ""
        tmp_path = None
        try:
            import soundfile as sf

            fd, tmp_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)
            sf.write(tmp_path, wav, 16000)
            parts: list[str] = []
            seg_iter, _ = self._model.transcribe(tmp_path, beam_size=1, vad_filter=False)
            for seg in seg_iter:
                t = str(seg.text or "").strip()
                if t:
                    parts.append(t)
            return " ".join(parts).strip()
        except Exception as e:
            raise RecognitionError(f"faster-whisper 识别失败: {e}") from e
        finally:
            if tmp_path:
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass


class WhisperASREngine:
    def __init__(self, model_name: str = "tiny"):
        self.model_name = model_name
        self._model = None

    def _ensure_model(self):
        if self._model is not None:
            return
        try:
            import whisper
        except ImportError as e:
            raise ModelLoadError(
                "未安装 openai-whisper，请执行: pip install openai-whisper"
            ) from e
        logger.info("[ASR] 加载 Whisper 模型: %s", self.model_name)
        self._model = whisper.load_model(self.model_name)

    def recognize(self, audio_data, sample_rate: int = 16000) -> str:
        wav = _prepare_float32_mono(audio_data, sample_rate)
        if len(wav) == 0:
            return ""
        self._ensure_model()
        tmp_path = None
        try:
            import soundfile as sf

            fd, tmp_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)
            sf.write(tmp_path, wav, 16000)
            out = self._model.transcribe(tmp_path, language="en", fp16=False)
            return str(out.get("text") or "").strip()
        except Exception as e:
            raise RecognitionError(f"Whisper 识别失败: {e}") from e
        finally:
            if tmp_path:
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass


class SherpaSenseVoiceEngine:
    def __init__(self):
        import sherpa_onnx

        current_file_dir = os.path.dirname(os.path.abspath(__file__))
        root_dir = os.path.dirname(os.path.dirname(current_file_dir))
        model_abs_path = os.path.join(root_dir, settings.SENSEVOICE_MODEL)
        tokens_abs_path = os.path.join(root_dir, settings.SENSEVOICE_TOKENS)
        if not os.path.exists(model_abs_path):
            raise ModelLoadError(f"模型文件不存在: {model_abs_path}")
        if not os.path.exists(tokens_abs_path):
            raise ModelLoadError(f"Token文件不存在: {tokens_abs_path}")

        lib_dir = os.path.join(os.path.dirname(sherpa_onnx.__file__), "lib")
        if sys.platform == "win32" and os.path.isdir(lib_dir):
            os.add_dll_directory(lib_dir)

        self.recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=model_abs_path,
            tokens=tokens_abs_path,
            num_threads=settings.ASR_THREADS,
            use_itn=False,
        )
        logger.info("[ASR] SenseVoice(sherpa-onnx) 已加载")

    def recognize(self, audio_data, sample_rate: int = 16000) -> str:
        wav = _prepare_float32_mono(audio_data, sample_rate)
        if len(wav) == 0:
            return ""
        stream = self.recognizer.create_stream()
        try:
            stream.accept_waveform(16000, wav)
            self.recognizer.decode_stream(stream)
            return (stream.result.text or "").strip()
        except Exception as e:
            raise RecognitionError(f"SenseVoice 识别失败: {e}") from e
        finally:
            del stream


class ASREngine:
    """统一 ASR 入口：优先按 ASR_BACKEND，失败时自动降级 Whisper。"""

    def __init__(self):
        backend = (settings.ASR_BACKEND or _DEFAULT_BACKEND).strip().lower()
        self._backend = backend
        self._whisper: Optional[WhisperASREngine] = None
        self._faster: Optional[FasterWhisperEngine] = None
        self._sherpa: Optional[SherpaSenseVoiceEngine] = None

        if backend in ("faster_whisper", "faster-whisper"):
            self._init_faster()
            self._backend = "faster_whisper"
            return

        if backend in ("whisper", "openai-whisper"):
            self._init_whisper()
            self._backend = "whisper"
            return

        if backend == "sensevoice":
            self._init_sherpa()
            self._backend = "sensevoice"
            return

        # auto
        try:
            self._init_sherpa()
            if self._probe_sherpa():
                self._backend = "sensevoice"
                logger.info("✅ ASR 使用 SenseVoice")
                return
        except Exception as e:
            logger.warning("SenseVoice 不可用: %s", e)

        try:
            self._init_faster()
            self._backend = "faster_whisper"
            logger.info("✅ ASR 使用 faster-whisper（%s）", settings.WHISPER_MODEL)
            return
        except ModelLoadError as e:
            logger.warning("faster-whisper 不可用: %s", e)

        self._init_whisper()
        self._backend = "whisper"
        logger.info("✅ ASR 使用 Whisper（%s）", settings.WHISPER_MODEL)

    def _init_faster(self):
        self._faster = FasterWhisperEngine(settings.WHISPER_MODEL)

    def _init_whisper(self):
        self._whisper = WhisperASREngine(settings.WHISPER_MODEL)

    def _init_sherpa(self):
        self._sherpa = SherpaSenseVoiceEngine()

    def _probe_sherpa(self) -> bool:
        """启动时试识别 0.5s 静音，失败则不要用 sherpa。"""
        try:
            probe = np.zeros(8000, dtype=np.float32)
            text = self._sherpa.recognize(probe, 16000)
            return True
        except RecognitionError:
            return False

    def recognize(self, audio_data, sample_rate: int = 16000) -> str:
        if self._backend == "faster_whisper" and self._faster:
            return self._faster.recognize(audio_data, sample_rate)

        if self._backend == "whisper" and self._whisper:
            return self._whisper.recognize(audio_data, sample_rate)

        if self._sherpa:
            try:
                return self._sherpa.recognize(audio_data, sample_rate)
            except RecognitionError as e:
                logger.warning("SenseVoice 失败，降级 Whisper: %s", e)
                if self._whisper is None:
                    self._init_whisper()
                self._backend = "whisper"
                return self._whisper.recognize(audio_data, sample_rate)

        if self._whisper:
            return self._whisper.recognize(audio_data, sample_rate)
        raise RecognitionError("无可用 ASR 引擎")
