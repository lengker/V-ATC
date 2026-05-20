# a3_speech_processing_3/app/engine/export_engine.py - 适配新数据库设计
import os
import zipfile
import csv
import logging
from datetime import datetime
from typing import List
from app.db.models import LngAudioRecords

logger = logging.getLogger(__name__)


class ExportError(Exception):
    """导出异常基类"""
    pass


class ExportValidationError(ExportError):
    """导出数据验证异常"""
    pass


class ExportFileError(ExportError):
    """导出文件操作异常"""
    pass


class ExportEngine:
    def __init__(self, storage_dir: str = "storage"):
        """
        初始化导出引擎

        Args:
            storage_dir: 存储目录路径
        """
        self.storage_dir = storage_dir
        try:
            os.makedirs(self.storage_dir, exist_ok=True)
        except OSError as e:
            logger.error(f"❌ 创建存储目录失败: {self.storage_dir}, 错误: {str(e)}")
            raise ExportFileError(f"创建存储目录失败: {str(e)}")

    def create_export_package(self, records: List[LngAudioRecords], strategy_name: str = "custom") -> str:
        """
        创建导出包（ZIP文件）

        Args:
            records: 音频记录列表
            strategy_name: 策略名称

        Returns:
            str: 生成的ZIP文件路径

        Raises:
            ExportValidationError: 数据验证失败
            ExportFileError: 文件操作失败
        """
        # 数据验证
        if not records:
            raise ExportValidationError("没有找到符合条件的数据，无法打包。")

        if not isinstance(records, list):
            raise ExportValidationError("记录数据格式不正确，必须是列表类型。")

        # 验证存储目录可写
        if not os.path.exists(self.storage_dir):
            try:
                os.makedirs(self.storage_dir, exist_ok=True)
            except OSError as e:
                raise ExportFileError(f"创建存储目录失败: {str(e)}")

        if not os.access(self.storage_dir, os.W_OK):
            raise ExportFileError(f"存储目录没有写入权限: {self.storage_dir}")

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        zip_filename = f"export_{strategy_name}_{timestamp}.zip"
        zip_filepath = os.path.join(self.storage_dir, zip_filename)
        csv_filename = "index.csv"
        csv_filepath = os.path.join(self.storage_dir, csv_filename)

        zipf = None
        csv_file = None

        try:
            # 1. 临时生成 CSV 索引文件 - 适配新数据库字段
            try:
                csv_file = open(csv_filepath, mode='w', newline='', encoding='utf-8-sig')
                writer = csv.writer(csv_file)
                writer.writerow([
                    "Audio_ID", "File_Name", "Source_URL", "Start_Time_UTC",
                    "End_Time_UTC", "Duration_MS", "File_Size", "Status", "Track_ID"
                ])

                valid_records = 0
                for r in records:
                    try:
                        # 验证记录数据完整性
                        if not hasattr(r, 'audio_id'):
                            logger.warning(f"⚠️ 跳过无效记录: 缺少audio_id")
                            continue

                        writer.writerow([
                            r.audio_id,
                            getattr(r, 'file_name', ''),
                            getattr(r, 'source_url', ''),
                            r.start_time_utc.strftime("%Y-%m-%d %H:%M:%S") if hasattr(r, 'start_time_utc') and r.start_time_utc else '',
                            r.end_time_utc.strftime("%Y-%m-%d %H:%M:%S") if hasattr(r, 'end_time_utc') and r.end_time_utc else '',
                            getattr(r, 'duration_ms', 0),
                            getattr(r, 'file_size', 0),
                            getattr(r, 'status', 0),
                            getattr(r, 'track_id', 0)
                        ])
                        valid_records += 1
                    except Exception as e:
                        logger.warning(f"⚠️ 写入CSV记录时出错 (audio_id={getattr(r, 'audio_id', 'unknown')}): {str(e)}")
                        continue

                if valid_records == 0:
                    raise ExportValidationError("没有有效的记录可以导出")

                logger.info(f"✅ CSV索引文件生成完成，包含 {valid_records} 条记录")

            except (IOError, OSError) as e:
                raise ExportFileError(f"创建CSV索引文件失败: {str(e)}")
            except ExportValidationError:
                raise
            except Exception as e:
                raise ExportFileError(f"写入CSV数据时出错: {str(e)}")
            finally:
                if csv_file:
                    try:
                        csv_file.close()
                    except Exception as e:
                        logger.warning(f"⚠️ 关闭CSV文件时出错: {str(e)}")

            # 2. 将音频文件和 CSV 打包进 ZIP
            try:
                zipf = zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED)

                # 添加CSV文件
                if os.path.exists(csv_filepath):
                    zipf.write(csv_filepath, arcname=csv_filename)

                # 添加音频文件
                audio_count = 0
                missing_files = 0
                for r in records:
                    try:
                        file_path = getattr(r, 'file_path', None)
                        if file_path and os.path.exists(file_path):
                            arcname = f"audio/{os.path.basename(file_path)}"
                            zipf.write(file_path, arcname=arcname)
                            audio_count += 1
                        else:
                            if file_path:
                                logger.warning(f"⚠️ 音频文件不存在，跳过: {file_path}")
                                missing_files += 1
                    except Exception as e:
                        logger.warning(f"⚠️ 添加音频文件到ZIP时出错: {str(e)}")
                        continue

                logger.info(f"✅ ZIP打包完成，包含 {audio_count} 个音频文件，{missing_files} 个文件缺失")

            except (IOError, OSError) as e:
                raise ExportFileError(f"创建ZIP文件失败: {str(e)}")
            except Exception as e:
                raise ExportFileError(f"打包过程出错: {str(e)}")
            finally:
                if zipf:
                    try:
                        zipf.close()
                    except Exception as e:
                        logger.warning(f"⚠️ 关闭ZIP文件时出错: {str(e)}")

            # 3. 验证生成的ZIP文件
            if not os.path.exists(zip_filepath):
                raise ExportFileError("ZIP文件生成失败，文件不存在")

            zip_size = os.path.getsize(zip_filepath)
            if zip_size == 0:
                raise ExportFileError("ZIP文件生成失败，文件大小为0")

            logger.info(f"✅ 导出包生成成功: {zip_filepath} (大小: {zip_size / 1024 / 1024:.2f}MB)")
            return zip_filepath

        except ExportError:
            # 清理失败的文件
            self._cleanup_files(csv_filepath, zip_filepath)
            raise
        except Exception as e:
            # 清理失败的文件
            self._cleanup_files(csv_filepath, zip_filepath)
            logger.exception(f"❌ 导出过程发生未预期错误: {str(e)}")
            raise ExportError(f"导出失败: {str(e)}")
        finally:
            # 无论打包成功与否，清理临时的 CSV 文件
            if os.path.exists(csv_filepath):
                os.remove(csv_filepath)