import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.event import listens_for  # 👈 1. 顶部新增导入这个事件监听器
from app.core.config import settings

# 初始化日志，方便追踪连接池状态
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ================= 1. 引擎创建 (Engine) =================
try:
    # 判断数据库类型：SQLite 不支持连接池参数
    if settings.DATABASE_URL.startswith("sqlite"):
        # SQLite: 不使用连接池参数
        engine = create_engine(
            settings.DATABASE_URL,
            connect_args={"check_same_thread": False},  # 允许多线程访问
            echo=False
        )
        logger.info("✅ SQLite 数据库引擎初始化成功（无连接池）。")
    else:
        # MySQL/PostgreSQL 等：使用连接池参数
        engine = create_engine(
            settings.DATABASE_URL,
            pool_size=settings.DB_POOL_SIZE,
            max_overflow=settings.DB_MAX_OVERFLOW,
            pool_recycle=settings.DB_POOL_RECYCLE,
            pool_pre_ping=settings.DB_POOL_PRE_PING,
            pool_timeout=30,  # 阻塞超时时间
            echo=False
        )
        logger.info("✅ 数据库引擎与连接池初始化成功。")
except Exception as e:
    logger.error(f"❌ 数据库引擎初始化失败: {e}")
    raise

# 👇 2. 新增以下这段代码：强行开启 SQLite 的外键级联约束
@listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")  # 激活外键约束！
    cursor.close()
# ================= 2. 会话工厂 (SessionLocal) =================
# autocommit=False: 开启事务管理
# autoflush=False: 避免在主动执行 commit 之前意外提交数据
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 注意：这里不再定义 Base，Base 统一由 app.db.base 提供！

# ================= 3. DAO 层/路由层依赖生成器 =================
def get_db():
    """
    提供给业务层调用的数据库会话依赖。
    使用 yield 生成器模式，确保把连接安全地“还”回连接池，防止连接泄露。
    """
    db = SessionLocal()
    try:
        yield db
    except Exception as e:
        logger.error(f"⚠️ 数据库操作异常，事务回滚: {e}")
        db.rollback()  # 发生异常时自动回滚事务
        raise
    finally:
        db.close()     # 无论如何，强制释放连接回连接池