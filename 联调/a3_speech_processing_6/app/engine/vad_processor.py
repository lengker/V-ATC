# app/engine/vad_processor.py
import os
import logging
import librosa
import soundfile as sf
import numpy as np
import gc

logger = logging.getLogger(__name__)


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
    def __init__(self, top_db=20, min_duration=0.3,padding_sec=0.2):
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
            # 动作四：使用 soundfile 读取（比 librosa.load 省大概 40% 内存）
            try:
                audio_data, sr = sf.read(audio_path, dtype='float32')
            except sf.LibsndfileError as e:
                logger.error(f"[VAD] soundfile读取失败: {str(e)}")
                raise AudioLoadError(f"音频文件格式不支持或已损坏: {str(e)}")
            except Exception as e:
                logger.error(f"[VAD] 读取音频文件失败: {str(e)}")
                raise AudioLoadError(f"读取音频文件失败: {str(e)}")

            # 验证音频数据
            if audio_data is None or len(audio_data) == 0:
                raise AudioLoadError("音频数据为空")

            # 兜底：如果是双声道，转为单声道
            if len(audio_data.shape) > 1:
                try:
                    audio_data = np.mean(audio_data, axis=1)
                except Exception as e:
                    raise AudioProcessingError(f"音频声道转换失败: {str(e)}")

            # 兜底：如果采样率不是 SenseVoice 要求的 16000Hz，强制重采样
            if sr != expected_sr:
                logger.info(f"[VAD] 检测到采样率为 {sr}Hz，正在重采样至 {expected_sr}Hz...")
                try:
                    audio_data = librosa.resample(audio_data, orig_sr=sr, target_sr=expected_sr)
                    sr = expected_sr
                except Exception as e:
                    raise AudioProcessingError(f"音频重采样失败: {str(e)}")

            # 核心逻辑：计算能量边界
            try:
                non_silent_intervals = librosa.effects.split(
                    audio_data,
                    top_db=self.top_db,
                    frame_length=2048,
                    hop_length=512
                )
            except Exception as e:
                raise AudioProcessingError(f"VAD分割失败: {str(e)}")

            # 动作一：改用 yield 生成器，每次只在内存中保留一个小切片
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
                    # 抛出包含了 Padding 缓冲的内存切片
                    yield {
                        "start_time": round(start_time, 2),
                        "end_time": round(end_time, 2),
                        "duration": round(duration, 2),
                        "audio_data": audio_data[safe_start:safe_end]
                    }

            logger.info(f"[VAD] 共检测到 {segment_count} 个有效音频片段")

        finally:
            # 遍历结束后，手动销毁几百 MB 的音频原数组，并强制触发垃圾回收
            if audio_data is not None:
                del audio_data
            gc.collect()
            logger.info(f"[VAD] VAD处理结束，底层内存已强制回收。")
