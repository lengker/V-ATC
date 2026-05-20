# app/engine/sense_voice.py
import os
import logging
import sherpa_onnx
from app.core.config import settings

logger = logging.getLogger(__name__)


class ASRError(Exception):
    """ASR识别异常基类"""
    pass


class ModelLoadError(ASRError):
    """模型加载异常"""
    pass


class RecognitionError(ASRError):
    """识别过程异常"""
    pass


class ASREngine:
    def __init__(self):
        try:
            # 1. 获取项目根目录绝对路径，防止路径错误
            current_file_dir = os.path.dirname(os.path.abspath(__file__))
            root_dir = os.path.dirname(os.path.dirname(current_file_dir))

            # 2. 拼接出模型的绝对路径
            model_abs_path = os.path.join(root_dir, settings.SENSEVOICE_MODEL)
            tokens_abs_path = os.path.join(root_dir, settings.SENSEVOICE_TOKENS)

            # 3. 验证模型文件存在性
            if not os.path.exists(model_abs_path):
                raise ModelLoadError(f"模型文件不存在: {model_abs_path}")
            if not os.path.exists(tokens_abs_path):
                raise ModelLoadError(f"Token文件不存在: {tokens_abs_path}")

            # 4. 彻底告别 hardcode，直接使用 settings 中的变量加载引擎
            try:
                self.recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                    model=model_abs_path,
                    tokens=tokens_abs_path,
                    num_threads=settings.ASR_THREADS,
                    use_itn=True
                )
            except Exception as e:
                raise ModelLoadError(f"加载SenseVoice模型失败: {str(e)}")

            logger.info(f"✅ [A-3 Engine] SenseVoice 模型大脑加载成功！(使用配置: {settings.ASR_THREADS} 线程)")

        except ModelLoadError:
            raise
        except Exception as e:
            logger.error(f"❌ ASREngine 初始化失败: {str(e)}")
            raise ModelLoadError(f"ASR引擎初始化失败: {str(e)}")

    def recognize(self, audio_data, sample_rate=16000) -> str:
        """
        对音频数据进行语音识别

        Args:
            audio_data: 音频数据（numpy数组）
            sample_rate: 采样率，默认16000Hz

        Returns:
            str: 识别出的文本

        Raises:
            RecognitionError: 识别过程出错
        """
        # 验证音频数据
        if audio_data is None or len(audio_data) == 0:
            logger.warning("[ASR] 音频数据为空")
            return ""

        stream = None
        try:
            # 1. 创建推理流
            try:
                stream = self.recognizer.create_stream()
            except Exception as e:
                raise RecognitionError(f"创建识别流失败: {str(e)}")

            # 2. 送入音频数据
            try:
                stream.accept_waveform(sample_rate, audio_data)
            except Exception as e:
                raise RecognitionError(f"送入音频数据失败: {str(e)}")

            # 3. 执行识别
            try:
                self.recognizer.decode_stream(stream)
            except Exception as e:
                raise RecognitionError(f"识别解码失败: {str(e)}")

            # 4. 获取结果
            try:
                result = stream.result.text
                return result if result else ""
            except Exception as e:
                raise RecognitionError(f"获取识别结果失败: {str(e)}")

        except RecognitionError:
            raise
        except Exception as e:
            logger.error(f"❌ ASR识别过程发生未预期错误: {str(e)}")
            raise RecognitionError(f"识别失败: {str(e)}")
        finally:
            # 动作二核心：强制销毁 stream。
            # 这是为了触发 sherpa-onnx 底层的 C++ 析构函数，瞬间清空缓存区
            if stream is not None:
                try:
                    del stream
                except Exception as e:
                    logger.warning(f"[ASR] 销毁识别流时出错: {str(e)}")

    def recognize_batch(self, audio_data_list: list, sample_rate: int = 16000) -> list:
        """
        多流并行批处理识别 (Batch Processing)
        将 VAD 产出的多个切片打包成 List 传入，一次性并发推断，大幅提升处理速度。
        """
        import numpy as np

        if not audio_data_list:
            return []

        # 1. 为每段音频创建独立的底层 Stream
        streams = [self.recognizer.create_stream() for _ in audio_data_list]

        try:
            # 2. 将数据喂给对应的 Stream
            for stream, audio_data in zip(streams, audio_data_list):
                # 确保内存连续，防止 C++ 底层指针错乱
                audio_data = np.ascontiguousarray(audio_data, dtype=np.float32)
                stream.accept_waveform(sample_rate, audio_data)

            # 3. 触发 C++ 引擎的并发 Decode
            self.recognizer.decode_streams(streams)

            # 4. 提取并返回所有结果的列表
            return [stream.result.text for stream in streams]
        finally:
            # 【核心护城河】无论如何，强制批量清空 C++ 内存指针，防止泄漏
            for stream in streams:
                del stream
