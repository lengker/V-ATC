# app/engine/vad_processor.py
import os
import logging
import librosa
import soundfile as sf
import numpy as np
import gc

logger = logging.getLogger(__name__)


def _resample_mono(y: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """不依赖 librosa 的线性重采样（兼容 NumPy 2.x）。"""
    if orig_sr == target_sr:
        return np.asarray(y, dtype=np.float32)
    y = np.asarray(y, dtype=np.float32)
    if y.ndim > 1:
        y = np.mean(y, axis=1)
    n = int(round(len(y) * target_sr / max(orig_sr, 1)))
    if n <= 1 or len(y) <= 1:
        return y
    x_old = np.arange(len(y), dtype=np.float64)
    x_new = np.linspace(0, len(y) - 1, num=n, dtype=np.float64)
    return np.interp(x_new, x_old, y).astype(np.float32)


def _load_audio_mono_16k(audio_path: str, expected_sr: int = 16000) -> tuple[np.ndarray, int]:
    """优先 soundfile；mp3 失败时用 whisper.load_audio（ffmpeg），避免 librosa+NumPy2 崩溃。"""
    try:
        audio_data, sr = sf.read(audio_path, dtype="float32")
    except (sf.LibsndfileError, OSError, RuntimeError) as e:
        logger.warning(f"[VAD] soundfile 读取失败 ({e})，尝试 whisper.load_audio: {audio_path}")
        try:
            import whisper

            audio_data = whisper.load_audio(audio_path)
            return np.asarray(audio_data, dtype=np.float32), expected_sr
        except Exception as le:
            logger.error(f"[VAD] whisper.load_audio 失败: {le}")
            raise AudioLoadError(f"音频文件格式不支持或已损坏: {audio_path}") from le
    if audio_data is None or len(audio_data) == 0:
        raise AudioLoadError("音频数据为空")
    if len(audio_data.shape) > 1:
        audio_data = np.mean(audio_data, axis=1)
    if int(sr) != expected_sr:
        logger.info(f"[VAD] 重采样 {sr}Hz -> {expected_sr}Hz（numpy）")
        audio_data = _resample_mono(audio_data, int(sr), expected_sr)
        sr = expected_sr
    return np.asarray(audio_data, dtype=np.float32), int(sr)


class VADError(Exception):
    """VAD处理异常基类"""
    pass


class AudioLoadError(VADError):
    """音频加载异常"""
    pass


class AudioProcessingError(VADError):
    """音频处理异常"""
    pass


class VADEngine:
    def __init__(self, top_db=25, min_duration=0.25, padding_sec=0.25):
        """
        初始化静音剔除引擎

        Args:
            top_db: 静音阈值（分贝）
            min_duration: 最小片段时长（秒）
        """
        self.top_db = top_db
        self.min_duration = min_duration
        self.padding_sec = padding_sec

    def process_generator(self, audio_path: str, expected_sr: int = 16000):
        """
        [动作一 & 动作四核心改造]
        使用 yield 生成器按需返回波形，并使用 soundfile 替代 librosa.load 节省内存

        Args:
            audio_path: 音频文件路径
            expected_sr: 期望的采样率

        Yields:
            dict: 包含音频片段信息的字典

        Raises:
            AudioLoadError: 音频加载失败
            AudioProcessingError: 音频处理失败
        """
        logger.info(f"[VAD] 正在使用低内存模式读取音频: {audio_path}")

        # 验证文件存在性
        if not os.path.exists(audio_path):
            raise AudioLoadError(f"音频文件不存在: {audio_path}")

        # 验证文件大小
        try:
            file_size = os.path.getsize(audio_path)
            if file_size == 0:
                raise AudioLoadError(f"音频文件为空: {audio_path}")
            if file_size > 500 * 1024 * 1024:  # 500MB限制
                logger.warning(f"[VAD] 音频文件过大 ({file_size / 1024 / 1024:.1f}MB): {audio_path}")
        except OSError as e:
            raise AudioLoadError(f"读取文件信息失败: {str(e)}")

        audio_data = None
        sr = None

        try:
            audio_data, sr = _load_audio_mono_16k(audio_path, expected_sr)
            non_silent_intervals = self._split_intervals(audio_data, sr)

            segment_count = 0
            # 在循环外，先把留白时间换算成采样点个数
            padding_samples = int(self.padding_sec * sr)
            total_samples = len(audio_data)

            # 开始切片循环
            for start_idx, end_idx in non_silent_intervals:
                # 【核心抗噪改造】向外扩张，并绝对保证不越界
                safe_start = max(0, start_idx - padding_samples)
                safe_end = min(total_samples, end_idx + padding_samples)

                # 根据安全边界重新计算时间戳
                start_time = safe_start / sr
                end_time = safe_end / sr
                duration = end_time - start_time

                if duration >= self.min_duration:
                    segment_count += 1
                    yield {
                        "start_time": round(start_time, 2),
                        "end_time": round(end_time, 2),
                        "duration": round(duration, 2),
                        "confidence": 0.85,
                        "audio_data": audio_data[safe_start:safe_end],
                    }

            if segment_count == 0 and len(audio_data) > 0:
                logger.warning("[VAD] 未切出片段，整段作为单条送入 ASR（LiveATC/低音量兜底）")
                yield {
                    "start_time": 0.0,
                    "end_time": round(len(audio_data) / sr, 2),
                    "duration": round(len(audio_data) / sr, 2),
                    "confidence": 0.6,
                    "audio_data": audio_data,
                }
                segment_count = 1

            logger.info(f"[VAD] 共输出 {segment_count} 个有效音频片段")

        finally:
            # 遍历结束后，手动销毁几百 MB 的音频原数组，并强制触发垃圾回收
            if audio_data is not None:
                del audio_data
            gc.collect()
            logger.info(f"[VAD] VAD处理结束，底层内存已强制回收。")

    def _split_intervals(self, audio_data: np.ndarray, sr: int) -> np.ndarray:
        """LiveATC mp3 音量偏低时逐级放宽 top_db；librosa 不可用时用能量 VAD。"""
        for top_db in (self.top_db, 30, 35, 40, 45):
            try:
                intervals = librosa.effects.split(
                    audio_data,
                    top_db=top_db,
                    frame_length=2048,
                    hop_length=512,
                )
            except Exception as e:
                logger.warning(f"[VAD] librosa.split 失败 ({e})，改用 numpy 能量切分")
                return self._split_intervals_numpy(audio_data, sr, top_db=top_db)
            if len(intervals) > 0:
                logger.info(f"[VAD] top_db={top_db} -> {len(intervals)} 段")
                return intervals
        return self._split_intervals_numpy(audio_data, sr, top_db=45)

    def _split_intervals_numpy(
        self, audio_data: np.ndarray, sr: int, *, top_db: float = 30
    ) -> np.ndarray:
        """纯 numpy 能量 VAD，不依赖 librosa/numba。"""
        frame_length = 2048
        hop_length = 512
        y = np.asarray(audio_data, dtype=np.float32)
        if y.size < frame_length:
            return np.array([[0, len(y)]], dtype=int)
        frames = []
        for start in range(0, len(y) - frame_length + 1, hop_length):
            chunk = y[start : start + frame_length]
            rms = float(np.sqrt(np.mean(chunk * chunk) + 1e-12))
            frames.append((start, rms))
        if not frames:
            return np.empty((0, 2), dtype=int)
        ref = max(max(r for _, r in frames), 1e-8)
        thresh = ref * (10 ** (-top_db / 20.0))
        intervals: list[list[int]] = []
        cur_start: int | None = None
        for start, rms in frames:
            idx = start
            if rms >= thresh:
                if cur_start is None:
                    cur_start = idx
            elif cur_start is not None:
                intervals.append([cur_start, idx + frame_length])
                cur_start = None
        if cur_start is not None:
            intervals.append([cur_start, len(y)])
        if not intervals:
            return np.empty((0, 2), dtype=int)
        logger.info(f"[VAD] numpy 能量切分 top_db={top_db} -> {len(intervals)} 段")
        return np.asarray(intervals, dtype=int)
