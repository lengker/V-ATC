# app/api/v1/recognize.py - 适配新数据库设计
import os
import shutil
import logging
from fastapi import APIRouter, UploadFile, File, Depends, Request, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from app.db.session import get_db

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/process")
async def recognize_atc_audio(
        request: Request,
        file: UploadFile = File(...),
        db: Session = Depends(get_db)
):
    """
    语音识别接口 - 适配新数据库设计cond
    处理上传的ATC音频文件，进行语音识别并保存到数据库
    """
    temp_path = None

    try:
        # 验证文件
        if not file.filename:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="文件名不能为空"
            )

        # 验证文件类型
        allowed_extensions = {'.wav', '.mp3', '.flac', '.ogg', '.m4a'}
        file_ext = os.path.splitext(file.filename.lower())[1]
        if file_ext not in allowed_extensions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"不支持的文件格式: {file_ext}，支持的格式: {', '.join(allowed_extensions)}"
            )

        # 创建存储目录
        try:
            os.makedirs("storage", exist_ok=True)
        except OSError as e:
            logger.error(f"创建存储目录失败: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="服务器存储空间初始化失败"
            )

        temp_path = f"storage/{file.filename}"

        # 保存上传的文件
        try:
            with open(temp_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
        except (IOError, OSError) as e:
            logger.error(f"保存上传文件失败: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="文件保存失败"
            )

        # 验证文件是否成功保存
        if not os.path.exists(temp_path) or os.path.getsize(temp_path) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="上传的文件为空或保存失败"
            )

        # 从全局生命周期中提取已经加载好的模型单例
        if not hasattr(request.app.state, 'speech_handler') or request.app.state.speech_handler is None:
            logger.error("语音处理引擎未初始化")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="语音识别服务暂时不可用，请稍后重试"
            )

        speech_handler = request.app.state.speech_handler

        # 调用核心业务流
        try:
            results = speech_handler.process_and_save_audio(db=db, file_path=temp_path)
        except SQLAlchemyError as e:
            logger.error(f"数据库操作失败: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="数据保存失败，请稍后重试"
            )
        except Exception as e:
            logger.error(f"语音处理失败: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"语音处理失败: {str(e)}"
            )

        return {
            "code": 200,
            "message": "success",
            "filename": file.filename,
            "data": {
                "total_records": len(results),
                "audio_records": results
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"处理音频文件时发生未预期错误: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"服务器内部错误: {str(e)}"
        )
    finally:
        # 清理临时文件
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
                logger.debug(f"临时文件已清理: {temp_path}")
            except OSError as e:
                logger.warning(f"清理临时文件失败: {temp_path}, 错误: {str(e)}")


@router.post("/process_existing")
async def recognize_existing_atc_audio(
        request: Request,
        audio_id: int,
        source_url: str,
        file_path: str | None = None,
        file_name: str | None = None,
        replace_existing: bool = True,
        db: Session = Depends(get_db)
):
    """
    处理数据库中已存在的音频记录
    从source_url获取音频数据，进行识别，仅创建新的标注记录

    Args:
        audio_id: 音频记录ID
        source_url: 音频文件URL
    """
    try:
        # 参数验证
        if audio_id <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="audio_id 必须是正整数"
            )

        if not source_url or not source_url.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="source_url 不能为空"
            )

        # # 验证 source_url 格式
        # if not (source_url.startswith("file://") or source_url.startswith("http://") or source_url.startswith("https://")):
        #     raise HTTPException(
        #         status_code=status.HTTP_400_BAD_REQUEST,
        #         detail="source_url 格式不正确，必须以 file://、http:// 或 https:// 开头"
        #     )

        # 从全局生命周期中提取已经加载好的模型单例
        if not hasattr(request.app.state, 'speech_handler') or request.app.state.speech_handler is None:
            logger.error("语音处理引擎未初始化")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="语音识别服务暂时不可用，请稍后重试"
            )

        speech_handler = request.app.state.speech_handler

        # 调用处理现有音频记录的函数
        try:
            results = speech_handler.process_existing_audio_record(
                db=db,
                audio_id=audio_id,
                source_url=source_url,
                file_path=file_path,
                file_name=file_name,
                replace_existing=replace_existing,
            )
        except SQLAlchemyError as e:
            logger.error(f"数据库操作失败: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="数据保存失败，请稍后重试"
            )
        except Exception as e:
            logger.error(f"处理现有音频记录失败: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"处理失败: {str(e)}"
            )

        return {
            "code": 200,
            "message": "success",
            "data": {
                "audio_id": audio_id,
                "total_annotations": len(results),
                "annotations": results
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"处理现有音频记录时发生未预期错误: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"服务器内部错误: {str(e)}"
        )
