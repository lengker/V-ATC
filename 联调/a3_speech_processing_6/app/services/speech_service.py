import os
import re
import gc
import logging
import requests
from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from app.engine.vad_processor import VADEngine
from app.engine.sense_voice import ASREngine
from app.db.crud import create_audio_record, create_annotation, get_audio_record

logger = logging.getLogger(__name__)


class SpeechServiceError(Exception):
    """语音服务自定义异常基类"""
    pass


class AudioDownloadError(SpeechServiceError):
    """音频下载异常"""
    pass


class AudioProcessingError(SpeechServiceError):
    """音频处理异常"""
    pass


class DatabaseOperationError(SpeechServiceError):
    """数据库操作异常"""
    pass


class SpeechService:
    def __init__(self):
        try:
            self.vad = VADEngine(top_db=20)
            self.asr = ASREngine()
            logger.info("✅ SpeechService 初始化成功")
        except Exception as e:
            logger.error(f"❌ SpeechService 初始化失败: {str(e)}")
            raise SpeechServiceError(f"语音服务初始化失败: {str(e)}")

    def extract_callsign(self, text: str) -> str:
        """[任务 1: 结构化解析] 提取航班呼号"""
        if not text:
            return ""
        try:
            # 匹配大写字母+数字，如 CPA123
            match = re.search(r'([A-Z]{2,3}\d{2,4})', text)
            return match.group(1) if match else ""
        except re.error as e:
            logger.warning(f"正则表达式匹配航班呼号时出错: {str(e)}")
            return ""

    def extract_flight_id(self, text: str) -> str:
        """从文本中提取航班ID"""
        if not text:
            return ""
        try:
            # 匹配航班号格式，如 CCA123, CSN1234
            match = re.search(r'([A-Z]{2,3}\d{2,4})', text)
            return match.group(1) if match else "UNKNOWN"
        except re.error as e:
            logger.warning(f"正则表达式匹配航班ID时出错: {str(e)}")
            return "UNKNOWN"

    def validate_asr_result(self, text: str, duration: float) -> bool:
        """[任务 3: 数据异常校验] 拦截底噪导致的脏数据"""
        if not text or text.strip() == "":
            return False
        # 逻辑：时间挺长但没识别出几个字，通常是电流声杂音
        if duration > 2.0 and len(text.strip()) <= 2:
            return False
        return True

    def clean_vhhh_text(self, text: str) -> str:
        """
        [W8 核心任务: 真实场景数据清洗]
        因为 VHHH 是纯英文环境，SenseVoice 在遇到电台底噪时极易产生中日韩乱码。
        此函数将强行剔除所有非 ASCII 字符，只保留英文、数字和基础标点。
        """
        if not text:
            return ""
        try:
            # 魔法正则：[^\x00-\x7F]+ 代表所有非 ASCII 字符（中文、日文假名等）
            # 我们把它们全部替换成空字符串
            cleaned_text = re.sub(r'[^\x00-\x7F]+', '', text)
            return cleaned_text.strip()
        except re.error as e:
            logger.warning(f"清洗文本时正则表达式出错: {str(e)}")
            return text.strip() if text else ""

    def process_and_save_audio(self, db: Session, file_path: str) -> List[dict]:
        """
        [V2 优化版核心流] - 适配新数据库设计
        1. 创建音频记录到LNG_AUDIO_RECORDS表（每个音频文件只创建一条）
        2. 创建标注记录到LNG_ANNOTATIONS表（每个VAD片段创建一条，关联到同一音频记录）
        3. 关联航迹数据

        Args:
            db: 数据库会话
            file_path: 音频文件路径

        Returns:
            List[dict]: 处理结果列表

        Raises:
            DatabaseOperationError: 数据库操作失败
            AudioProcessingError: 音频处理失败
        """
        logger.info(f"========== 开始处理并入库任务: {file_path} ==========")
        saved_results = []

        # 验证文件是否存在
        if not os.path.exists(file_path):
            logger.error(f"❌ 音频文件不存在: {file_path}")
            raise AudioProcessingError(f"音频文件不存在: {file_path}")

        # 获取文件基本信息
        try:
            file_size = os.path.getsize(file_path)
            current_time = datetime.now(timezone.utc)
        except OSError as e:
            logger.error(f"❌ 获取文件信息失败: {str(e)}")
            raise AudioProcessingError(f"获取文件信息失败: {str(e)}")

        # 使用生成器模式，一次只处理一个片段，内存恒定
        try:
            segment_generator = self.vad.process_generator(file_path)
        except Exception as e:
            logger.error(f"❌ VAD处理初始化失败: {str(e)}")
            raise AudioProcessingError(f"VAD处理初始化失败: {str(e)}")

        # [优化] 先收集所有有效片段，计算音频总时长
        valid_segments = []
        total_duration = 0.0
        
        for i, seg in enumerate(segment_generator):
            raw_text = ""
            try:
                # 1. 引擎识别
                try:
                    raw_text = self.asr.recognize(seg["audio_data"])
                except Exception as e:
                    logger.error(f"❌ ASR识别失败 [片段 {i}]: {str(e)}")
                    continue

                # 2. VHHH 纯英文清洗
                clean_text = self.clean_vhhh_text(raw_text)
                duration = seg["end_time"] - seg["start_time"]

                # 3. 容错校验
                if not self.validate_asr_result(clean_text, duration):
                    logger.warning(f"⚠️ [拦截] 片段 {i} 判定为底噪或被清洗为空，直接丢弃: (原音:{raw_text})")
                    continue

                # 4. 结构化解析
                callsign = self.extract_callsign(clean_text)
                flight_id = self.extract_flight_id(clean_text)

                # 保存有效片段信息
                valid_segments.append({
                    "segment": seg,
                    "clean_text": clean_text,
                    "callsign": callsign,
                    "flight_id": flight_id,
                    "index": i
                })
                
                # 更新总时长（取最后一个片段的结束时间作为音频总时长）
                total_duration = max(total_duration, seg["end_time"])

            except Exception as e:
                logger.error(f"❌ [片段 {i} 处理失败]: {str(e)}")
            finally:
                # 内存优化
                if "audio_data" in seg:
                    del seg["audio_data"]
                gc.collect()

        # 如果没有有效片段，直接返回
        if not valid_segments:
            logger.info("⚠️ 未找到有效音频片段，跳过创建音频记录")
            return []

        # [优化] 创建音频记录 - 每个音频文件只创建一条
        audio_data = {
            "source_url": file_path,
            "start_time_utc": current_time,
            "end_time_utc": current_time,
            "duration_ms": int(total_duration * 1000),
            "file_name": f"{os.path.basename(file_path)}",
            "file_path": file_path,
            "file_size": file_size,
            "status": 1,  # 处理完成状态
            "last_access_at": current_time,
            "track_id": 1,  # 默认关联第一个航迹，后续可根据航班号关联
            "next_id": None,  # 链表结构，初始为None
            "prev_id": None,  # 链表结构，初始为None
        }

        try:
            saved_audio = create_audio_record(db=db, audio_data=audio_data)
            logger.info(f"✅ 音频记录创建成功: audio_id={saved_audio.audio_id}")
        except SQLAlchemyError as e:
            logger.error(f"❌ 创建音频记录失败: {str(e)}")
            raise DatabaseOperationError(f"创建音频记录失败: {str(e)}")

        # [优化] 为每个有效片段创建标注记录 - 都关联到同一条音频记录
        audio_id = saved_audio.audio_id
        for item in valid_segments:
            seg = item["segment"]
            clean_text = item["clean_text"]
            callsign = item["callsign"]
            flight_id = item["flight_id"]
            i = item["index"]

            # 创建标注记录
            annotation_data = {
                "label_type": "ATC_COMMUNICATION",
                "author_id": 1,  # 默认用户ID
                "audio_id": audio_id,  # 所有annotation关联到同一条音频记录
                "relative_start": seg["start_time"],
                "relative_end": seg["end_time"],
                "abs_start_time": current_time,
                "abs_end_time": current_time,
                "asr_content": clean_text,
                "vad_confidence": seg.get("confidence", 0.8),
                "is_annotated": 0,  # 未标注
                "annotation_text": None,
                "annotation_time": None,
                "storage_tag": f"{flight_id}_{i}",
                "next_id": None,  # 链表结构，初始为None
                "prev_id": None,  # 链表结构，初始为None
            }

            try:
                saved_annotation = create_annotation(db=db, annotation_data=annotation_data)
            except SQLAlchemyError as e:
                logger.error(f"❌ 创建标注记录失败 [片段 {i}]: {str(e)}")
                raise DatabaseOperationError(f"创建标注记录失败: {str(e)}")

            saved_results.append({
                "audio_id": audio_id,
                "annotation_id": saved_annotation.annotation_id,
                "text": clean_text,
                "callsign": callsign,
                "flight_id": flight_id,
                "start": seg["start_time"],
                "end": seg["end_time"],
                "confidence": seg.get("confidence", 0.8)
            })
            logger.info(f"✅ [{seg['start_time']:.2f}s] 标注记录创建成功: {clean_text}")

        logger.info(f"========== 任务完成！音频记录: 1条, 标注记录: {len(saved_results)}条 ==========")
        return saved_results


    def process_existing_audio_record(self, db: Session, audio_id: int, source_url: str) -> List[dict]:
        """
        处理数据库中已存在的音频记录
        从source_url获取音频数据，进行识别，仅创建新的标注记录

        Args:
            db: 数据库会话
            audio_id: 音频记录ID
            source_url: 音频文件URL

        Returns:
            list: 处理结果列表

        Raises:
            DatabaseOperationError: 数据库操作失败
            AudioProcessingError: 音频处理失败
            AudioDownloadError: 音频下载失败
        """
        logger.info(f"========== 开始处理现有音频记录: audio_id={audio_id}, source_url={source_url} ==========")

        # 验证音频记录是否存在
        try:
            audio_record = get_audio_record(db, audio_id)
        except SQLAlchemyError as e:
            logger.error(f"❌ 查询音频记录失败: audio_id={audio_id}, 错误: {str(e)}")
            raise DatabaseOperationError(f"查询音频记录失败: {str(e)}")

        if not audio_record:
            logger.error(f"❌ 音频记录不存在: audio_id={audio_id}")
            return []

        
        # 本地文件路径直接读取，
        audio_file_path = source_url
        
        # 验证本地文件
        if not os.path.exists(audio_file_path):
            logger.error(f"❌ 本地音频文件不存在: {audio_file_path}")
            raise AudioProcessingError(f"本地音频文件不存在: {audio_file_path}")
        
        if os.path.getsize(audio_file_path) == 0:
            logger.error(f"❌ 本地音频文件为空: {audio_file_path}")
            raise AudioProcessingError(f"本地音频文件为空: {audio_file_path}")
        
        logger.info(f"✅ 使用本地音频文件: {audio_file_path}")
        need_cleanup = False

        saved_results = []

        # 使用生成器模式处理音频
        try:
            segment_generator = self.vad.process_generator(audio_file_path)
        except Exception as e:
            logger.error(f"❌ VAD处理初始化失败: {str(e)}")
            raise AudioProcessingError(f"VAD处理初始化失败: {str(e)}")

        for i, seg in enumerate(segment_generator):
            raw_text = ""
            try:
                # 1. 引擎识别
                try:
                    raw_text = self.asr.recognize(seg["audio_data"])
                except Exception as e:
                    logger.error(f"❌ ASR识别失败 [片段 {i}]: {str(e)}")
                    continue

                # 2. VHHH 纯英文清洗
                clean_text = self.clean_vhhh_text(raw_text)
                duration = seg["end_time"] - seg["start_time"]

                # 3. 容错校验
                if not self.validate_asr_result(clean_text, duration):
                    logger.warning(f"⚠️ [拦截] 片段 {i} 判定为底噪或被清洗为空，直接丢弃: (原音:{raw_text})")
                    continue

                # 4. 结构化解析
                callsign = self.extract_callsign(clean_text)
                flight_id = self.extract_flight_id(clean_text)

                # 5. 创建标注记录（不创建新的音频记录）- 适配数据库模型
                current_time = datetime.utcnow()
                annotation_data = {
                    "label_type": "ATC_COMMUNICATION",
                    "author_id": 1,  # 默认用户ID
                    "audio_id": audio_id,  # 使用现有的音频ID
                    "relative_start": seg["start_time"],
                    "relative_end": seg["end_time"],
                    "abs_start_time": current_time,
                    "abs_end_time": current_time,
                    "asr_content": clean_text,
                    "vad_confidence": seg.get("confidence", 0.8),
                    "is_annotated": 0,  # 未标注
                    "annotation_text": None,
                    "annotation_time": None,
                    "storage_tag": f"{flight_id}_{i}",
                    "next_id": None,  # 链表结构，初始为None
                    "prev_id": None,  # 链表结构，初始为None
                }

                try:
                    saved_annotation = create_annotation(db=db, annotation_data=annotation_data)
                except SQLAlchemyError as e:
                    logger.error(f"❌ 创建标注记录失败 [片段 {i}]: {str(e)}")
                    raise DatabaseOperationError(f"创建标注记录失败: {str(e)}")

                saved_results.append({
                    "audio_id": audio_id,
                    "annotation_id": saved_annotation.annotation_id,
                    "text": clean_text,
                    "callsign": callsign,
                    "flight_id": flight_id,
                    "start": seg["start_time"],
                    "end": seg["end_time"],
                    "confidence": seg.get("confidence", 0.8)
                })
                logger.info(f"✅ [{seg['start_time']:.2f}s] 标注记录创建成功: {clean_text}")

            except DatabaseOperationError:
                raise
            except Exception as e:
                logger.error(f"❌ [片段 {i} 处理失败]: {str(e)}")
            finally:
                # 内存优化
                if "audio_data" in seg:
                    del seg["audio_data"]
                gc.collect()

        logger.info(f"========== 现有音频处理完成！共创建 {len(saved_results)} 条标注记录 ==========")
        return saved_results