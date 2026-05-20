"""
时序检索引擎 (Query Engine) - 适配新数据库设计
整合数据模型、CRUD操作和查询逻辑
"""
import logging
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from datetime import datetime
from typing import List, Optional

from app.db.models import LngAudioRecords
from app.db.crud import get_audio_records_by_strategy

logger = logging.getLogger(__name__)


# ==================== 自定义异常 ====================

class QueryEngineError(Exception):
    """查询引擎异常基类"""
    pass


class ValidationError(QueryEngineError):
    """参数验证异常"""
    pass


class DatabaseQueryError(QueryEngineError):
    """数据库查询异常"""
    pass


class DataConversionError(QueryEngineError):
    """数据转换异常"""
    pass


# ==================== 数据模型 ====================

class AudioRecordItem(BaseModel):
    """单条语音记录"""
    audio_id: int = Field(..., description="音频ID")
    file_name: str = Field(..., description="文件名")
    file_path: str = Field(..., description="文件路径")
    duration_ms: int = Field(..., description="音频时长(毫秒)")
    source_url: str = Field(..., description="源URL")
    start_time_utc: datetime = Field(..., description="开始时间")
    end_time_utc: datetime = Field(..., description="结束时间")
    status: int = Field(..., description="状态")
    track_id: int = Field(..., description="关联航迹ID")

    class Config:
        from_attributes = True


class TimeRangeResponse(BaseModel):
    """时序检索响应"""
    total: int = Field(..., description="总记录数")
    page: int = Field(..., description="当前页码")
    page_size: int = Field(..., description="每页条数")
    data: List[AudioRecordItem] = Field(..., description="语音记录列表")


class AnnotationSegment(BaseModel):
    """标注片段"""
    annotation_id: int = Field(..., description="标注ID")
    relative_start: float = Field(..., description="相对开始时间")
    relative_end: float = Field(..., description="相对结束时间")
    abs_start_time: datetime = Field(..., description="绝对开始时间")
    abs_end_time: datetime = Field(..., description="绝对结束时间")
    asr_content: Optional[str] = Field(None, description="ASR识别内容")
    annotation_text: Optional[str] = Field(None, description="标注文本")
    vad_confidence: Optional[float] = Field(None, description="VAD置信度")
    is_annotated: int = Field(..., description="是否已标注")


class AudioDetailResponse(BaseModel):
    """音频详情响应"""
    audio_id: int
    file_name: str
    file_path: str
    duration_ms: int
    source_url: str
    start_time_utc: datetime
    end_time_utc: datetime
    status: int
    track_id: int
    annotations: List[AnnotationSegment] = Field([], description="标注片段列表")


# ==================== 查询引擎 ====================

class QueryEngine:
    """
    时序检索引擎
    封装所有查询相关的业务逻辑
    """

    def __init__(self, db: Session):
        """
        初始化查询引擎

        Args:
            db: 数据库会话

        Raises:
            ValidationError: 数据库会话无效
        """
        if db is None:
            raise ValidationError("数据库会话不能为None")
        self.db = db

    def _validate_pagination_params(self, page: int, page_size: int) -> None:
        """
        验证分页参数

        Args:
            page: 页码
            page_size: 每页条数

        Raises:
            ValidationError: 参数验证失败
        """
        if page < 1:
            raise ValidationError("页码必须大于等于1")
        if page_size < 1:
            raise ValidationError("每页条数必须大于等于1")
        if page_size > 1000:
            raise ValidationError("每页条数不能超过1000")

    def _validate_time_range(self, start_time: datetime, end_time: datetime) -> None:
        """
        验证时间范围参数

        Args:
            start_time: 开始时间
            end_time: 结束时间

        Raises:
            ValidationError: 参数验证失败
        """
        if not isinstance(start_time, datetime):
            raise ValidationError("开始时间必须是datetime类型")
        if not isinstance(end_time, datetime):
            raise ValidationError("结束时间必须是datetime类型")
        if start_time >= end_time:
            raise ValidationError("开始时间必须早于结束时间")

    def search_audio_records(
        self,
        start_time: datetime,
        end_time: datetime,
        keyword: Optional[str] = None,
        page: int = 1,
        page_size: int = 20
    ) -> TimeRangeResponse:
        """
        高级时序检索：支持关键词过滤

        Args:
            start_time: 开始时间
            end_time: 结束时间
            keyword: 关键词
            page: 页码
            page_size: 每页条数

        Returns:
            TimeRangeResponse 包含总数和分页数据

        Raises:
            ValidationError: 参数验证失败
            DatabaseQueryError: 数据库查询失败
            DataConversionError: 数据转换失败
        """
        try:
            # 参数验证
            self._validate_time_range(start_time, end_time)
            self._validate_pagination_params(page, page_size)

            # 验证关键词长度
            if keyword and len(keyword) > 100:
                raise ValidationError("关键词长度不能超过100个字符")

        except ValidationError:
            raise
        except Exception as e:
            logger.error(f"参数验证时发生未预期错误: {str(e)}")
            raise ValidationError(f"参数验证失败: {str(e)}")

        # 计算分页偏移
        skip = (page - 1) * page_size

        try:
            # 使用CRUD操作进行查询
            records = get_audio_records_by_strategy(
                db=self.db,
                start_time=start_time,
                end_time=end_time,
                keyword=keyword,
                skip=skip,
                limit=page_size
            )

            total_count = len(records)
        except SQLAlchemyError as e:
            logger.error(f"数据库查询失败 (分页数据): {str(e)}")
            raise DatabaseQueryError(f"查询分页数据失败: {str(e)}")
        except Exception as e:
            logger.error(f"查询分页数据时发生未预期错误: {str(e)}")
            raise DatabaseQueryError(f"查询分页数据失败: {str(e)}")

        # 转换为响应模型
        try:
            data = []
            for record in records:
                try:
                    item = AudioRecordItem.model_validate(record)
                    data.append(item)
                except Exception as e:
                    logger.warning(f"转换记录失败，跳过该记录: {str(e)}")
                    continue
        except Exception as e:
            logger.error(f"数据转换失败: {str(e)}")
            raise DataConversionError(f"数据转换失败: {str(e)}")

        return TimeRangeResponse(
            total=total_count,
            page=page,
            page_size=page_size,
            data=data
        )

    def get_record_by_id(self, audio_id: int) -> Optional[LngAudioRecords]:
        """
        根据音频ID获取单条记录

        Args:
            audio_id: 音频ID

        Returns:
            LngAudioRecords 或 None

        Raises:
            ValidationError: 参数验证失败
            DatabaseQueryError: 数据库查询失败
        """
        # 参数验证
        if audio_id <= 0:
            raise ValidationError("audio_id 必须是正整数")

        try:
            from app.db.crud import get_audio_record
            return get_audio_record(self.db, audio_id)
        except SQLAlchemyError as e:
            logger.error(f"查询音频记录失败 (audio_id={audio_id}): {str(e)}")
            raise DatabaseQueryError(f"查询音频记录失败: {str(e)}")
        except Exception as e:
            logger.error(f"查询音频记录时发生未预期错误 (audio_id={audio_id}): {str(e)}")
            raise DatabaseQueryError(f"查询音频记录失败: {str(e)}")

    def get_record_detail(self, audio_id: int) -> Optional[AudioDetailResponse]:
        """
        获取单条语音记录的详细信息

        Args:
            audio_id: 音频ID

        Returns:
            AudioDetailResponse 或 None (记录不存在)

        Raises:
            ValidationError: 参数验证失败
            DatabaseQueryError: 数据库查询失败
            DataConversionError: 数据转换失败
        """
        # 参数验证
        if not isinstance(audio_id, int):
            raise ValidationError("audio_id 必须是整数")
        if audio_id <= 0:
            raise ValidationError("audio_id 必须是正整数")

        try:
            record = self.get_record_by_id(audio_id)
        except (ValidationError, DatabaseQueryError):
            raise
        except Exception as e:
            logger.error(f"获取记录详情时发生未预期错误: {str(e)}")
            raise DatabaseQueryError(f"获取记录详情失败: {str(e)}")

        if not record:
            return None

        # 获取关联的标注信息
        try:
            from app.db.crud import get_annotations_by_audio
            annotations = get_annotations_by_audio(self.db, audio_id)
        except SQLAlchemyError as e:
            logger.error(f"查询标注信息失败 (audio_id={audio_id}): {str(e)}")
            raise DatabaseQueryError(f"查询标注信息失败: {str(e)}")
        except Exception as e:
            logger.error(f"查询标注信息时发生未预期错误 (audio_id={audio_id}): {str(e)}")
            raise DatabaseQueryError(f"查询标注信息失败: {str(e)}")

        # 转换为响应模型
        try:
            annotation_segments = []
            for anno in annotations:
                try:
                    segment = AnnotationSegment(
                        annotation_id=anno.annotation_id,
                        relative_start=anno.relative_start,
                        relative_end=anno.relative_end,
                        abs_start_time=anno.abs_start_time,
                        abs_end_time=anno.abs_end_time,
                        asr_content=anno.asr_content,
                        annotation_text=anno.annotation_text,
                        vad_confidence=anno.vad_confidence,
                        is_annotated=anno.is_annotated
                    )
                    annotation_segments.append(segment)
                except Exception as e:
                    logger.warning(f"转换标注记录失败，跳过 (annotation_id={getattr(anno, 'annotation_id', 'unknown')}): {str(e)}")
                    continue

            return AudioDetailResponse(
                audio_id=record.audio_id,
                file_name=record.file_name,
                file_path=record.file_path,
                duration_ms=record.duration_ms,
                source_url=record.source_url,
                start_time_utc=record.start_time_utc,
                end_time_utc=record.end_time_utc,
                status=record.status,
                track_id=record.track_id,
                annotations=annotation_segments
            )
        except Exception as e:
            logger.error(f"构建详情响应失败 (audio_id={audio_id}): {str(e)}")
            raise DataConversionError(f"构建详情响应失败: {str(e)}")


# ==================== 便捷函数 ====================

def get_query_engine(db: Session) -> QueryEngine:
    """
    获取查询引擎实例

    Args:
        db: 数据库会话

    Returns:
        QueryEngine: 查询引擎实例

    Raises:
        ValidationError: 数据库会话无效
    """
    if db is None:
        raise ValidationError("数据库会话不能为None")
    return QueryEngine(db)
