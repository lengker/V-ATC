# a3_speech_processing_3/app/api/v1/export.py - 适配新数据库设计
import os
import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from pydantic import BaseModel, Field, field_validator, ValidationInfo
from datetime import datetime
from typing import Optional

from app.db.session import get_db
from app.db.crud import get_audio_records_by_strategy
from app.engine.export_engine import ExportEngine

router = APIRouter()
exporter = ExportEngine()
logger = logging.getLogger(__name__)

# --- 任务状态内存字典 (模拟 Redis 队列) ---
# 格式: { "task_id": {"status": "排队中/打包中/已完成/失败", "file_path": "...", "progress": 0} }
EXPORT_TASKS = {}


class ExportRequest(BaseModel):
    start_time: datetime
    end_time: datetime
    keyword: Optional[str] = None
    strategy_name: str = Field(default="custom_search", max_length=50)

    @field_validator('end_time')
    def validate_time_range(cls, v, info: ValidationInfo):
        start_time = info.data.get('start_time')
        if start_time and v <= start_time:
            raise ValueError('结束时间必须晚于开始时间')
        return v

    @field_validator('keyword')
    def validate_keyword(cls, v):
        if v and len(v) > 100:
            raise ValueError('关键词长度不能超过100个字符')
        return v


def remove_temp_file(path: str, task_id: str):
    """延迟清理机制：文件下载完毕后，清理磁盘并注销内存任务"""
    try:
        if os.path.exists(path):
            os.remove(path)
            logger.info(f"🧹 [资源释放] 已清理过期ZIP文件: {path}")
    except OSError as e:
        logger.error(f"❌ [资源释放] 清理ZIP文件失败: {path}, 错误: {str(e)}")

    try:
        if task_id in EXPORT_TASKS:
            del EXPORT_TASKS[task_id]
            logger.info(f"🧹 [内存释放] 任务 {task_id} 生命周期结束，已注销。")
    except Exception as e:
        logger.error(f"❌ [内存释放] 注销任务失败: {task_id}, 错误: {str(e)}")


def run_export_worker(task_id: str, request: ExportRequest, db: Session):
    """
    [后台工作节点 Worker]
    独立执行数据库查询与打包，实现 CPU 资源隔离，不阻塞主服务
    """
    try:
        EXPORT_TASKS[task_id]["status"] = "打包中(数据检索)"
        EXPORT_TASKS[task_id]["progress"] = 20

        # 1. 数据库检索 (耗时操作)
        try:
            records = get_audio_records_by_strategy(
                db=db,
                start_time=request.start_time,
                end_time=request.end_time,
                keyword=request.keyword,
                limit=1000
            )
        except SQLAlchemyError as e:
            logger.error(f"❌ [异步任务] 数据库查询失败: {str(e)}")
            EXPORT_TASKS[task_id]["status"] = "失败"
            EXPORT_TASKS[task_id]["message"] = "数据库查询失败"
            return
        except Exception as e:
            logger.error(f"❌ [异步任务] 数据检索异常: {str(e)}")
            EXPORT_TASKS[task_id]["status"] = "失败"
            EXPORT_TASKS[task_id]["message"] = f"数据检索失败: {str(e)}"
            return

        if not records:
            EXPORT_TASKS[task_id]["status"] = "失败"
            EXPORT_TASKS[task_id]["message"] = "当前策略下未检索到音频数据"
            return

        EXPORT_TASKS[task_id]["status"] = "打包中(压缩写入)"
        EXPORT_TASKS[task_id]["progress"] = 60

        # 2. 调用 Engine 层进行 ZIP 压缩 (IO密集型操作)
        try:
            zip_path = exporter.create_export_package(records, strategy_name=request.strategy_name)
        except ValueError as e:
            logger.error(f"❌ [异步任务] 打包参数错误: {str(e)}")
            EXPORT_TASKS[task_id]["status"] = "失败"
            EXPORT_TASKS[task_id]["message"] = str(e)
            return
        except OSError as e:
            logger.error(f"❌ [异步任务] 文件操作失败: {str(e)}")
            EXPORT_TASKS[task_id]["status"] = "失败"
            EXPORT_TASKS[task_id]["message"] = "文件打包失败，磁盘空间不足或权限问题"
            return
        except Exception as e:
            logger.error(f"❌ [异步任务] 打包异常: {str(e)}")
            EXPORT_TASKS[task_id]["status"] = "失败"
            EXPORT_TASKS[task_id]["message"] = f"打包失败: {str(e)}"
            return

        # 3. 任务完成，写入最终状态
        EXPORT_TASKS[task_id]["status"] = "已完成"
        EXPORT_TASKS[task_id]["progress"] = 100
        EXPORT_TASKS[task_id]["file_path"] = zip_path
        logger.info(f"✅ [异步任务] 任务 {task_id} 处理完毕，等待前端拉取。")

    except Exception as e:
        logger.exception(f"❌ [异步任务] 处理异常: {str(e)}")
        try:
            EXPORT_TASKS[task_id]["status"] = "失败"
            EXPORT_TASKS[task_id]["message"] = f"服务器内部错误: {str(e)}"
        except Exception:
            pass


# ==============================================================
#  API 1: 提交异步导出任务 (秒回 Task ID)
# ==============================================================
@router.post("/strategy/submit")
async def submit_export_task(
        request: ExportRequest,
        background_tasks: BackgroundTasks,
        db: Session = Depends(get_db)
):
    """提交异步导出任务"""
    try:
        # 生成唯一任务 ID
        task_id = str(uuid.uuid4())

        # 初始化任务状态
        EXPORT_TASKS[task_id] = {
            "status": "排队中",
            "progress": 0,
            "file_path": None,
            "message": ""
        }

        # 将繁重任务推入后台队列
        background_tasks.add_task(run_export_worker, task_id, request, db)

        return {
            "code": 200,
            "message": "导出任务已成功派发至后台",
            "task_id": task_id
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"提交导出任务时发生未预期错误: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"提交任务失败: {str(e)}"
        )


# ==============================================================
#  API 2: 状态轮询接口 (解决前端接口假死)
# ==============================================================
@router.get("/status/{task_id}")
async def get_task_status(task_id: str):
    """获取导出任务状态"""
    try:
        # 验证 task_id 格式
        if not task_id or len(task_id) < 10:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="无效的任务ID格式"
            )

        if task_id not in EXPORT_TASKS:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="任务ID不存在或已过期失效"
            )

        task_info = EXPORT_TASKS[task_id]
        return {
            "code": 200,
            "task_id": task_id,
            "status": task_info["status"],
            "progress": task_info["progress"],
            "message": task_info.get("message", "")
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"获取任务状态时发生未预期错误: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取任务状态失败: {str(e)}"
        )


# ==============================================================
#  API 3: 延迟下载与清理接口
# ==============================================================
@router.get("/download/{task_id}")
async def download_exported_file(task_id: str, background_tasks: BackgroundTasks):
    """下载导出的文件"""
    try:
        # 验证 task_id 格式
        if not task_id or len(task_id) < 10:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="无效的任务ID格式"
            )

        task_info = EXPORT_TASKS.get(task_id)

        if not task_info:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="任务ID不存在或已过期失效"
            )

        if task_info["status"] == "失败":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"打包任务执行失败: {task_info.get('message', '未知错误')}"
            )

        if task_info["status"] != "已完成":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"打包任务尚未完成，当前状态: {task_info['status']}"
            )

        file_path = task_info.get("file_path")
        if not file_path:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="导出文件路径丢失"
            )

        if not os.path.exists(file_path):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="导出文件已过期被清理或丢失"
            )

        # 核心设计：前端只要调用了下载，就在后台触发"延迟清理"，保护硬盘不被挤爆
        background_tasks.add_task(remove_temp_file, file_path, task_id)

        return FileResponse(
            path=file_path,
            filename=os.path.basename(file_path),
            media_type="application/x-zip-compressed"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"下载导出文件时发生未预期错误: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"下载文件失败: {str(e)}"
        )
