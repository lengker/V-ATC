"""
存放通用的依赖项
"""
import logging
from typing import Generator
from sqlalchemy.exc import SQLAlchemyError
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)


def get_db() -> Generator:
    """
    获取数据库会话的依赖函数

    Yields:
        Session: SQLAlchemy 数据库会话

    Raises:
        通过 HTTPException 向上层传递数据库连接错误
    """
    db = SessionLocal()
    try:
        yield db
        # 如果操作成功，提交事务
        try:
            db.commit()
        except SQLAlchemyError as e:
            logger.error(f"数据库提交失败: {str(e)}")
            try:
                db.rollback()
            except Exception as rollback_err:
                logger.error(f"数据库回滚失败: {str(rollback_err)}")
            raise
    except SQLAlchemyError as e:
        logger.error(f"数据库操作失败: {str(e)}")
        try:
            db.rollback()
        except Exception as rollback_err:
            logger.error(f"数据库回滚失败: {str(rollback_err)}")
        raise
    except Exception as e:
        logger.error(f"数据库会话发生未预期错误: {str(e)}")
        try:
            db.rollback()
        except Exception as rollback_err:
            logger.error(f"数据库回滚失败: {str(rollback_err)}")
        raise
    finally:
        # 确保会话始终被关闭
        try:
            db.close()
        except Exception as e:
            logger.error(f"关闭数据库会话失败: {str(e)}")
