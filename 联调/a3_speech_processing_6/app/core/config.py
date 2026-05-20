"""
【配置】项目全局配置文件（模型路径、数据库地址）
"""
import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 项目基础配置
    PROJECT_NAME: str = "A-3 语音预处理模块"
    VERSION: str = "1.0.0"
    
    # 数据库配置
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./backend/data.sqlite3")
    
    # 模型路径配置
    MODEL_PATH: str = os.getenv("MODEL_PATH", "./models")
    SENSEVOICE_MODEL: str = os.getenv("SENSEVOICE_MODEL", "models/model.int8.onnx")
    SENSEVOICE_TOKENS: str = os.getenv("SENSEVOICE_TOKENS", "models/tokens.txt")
    # 新增：ASR 引擎并发线程数
    ASR_THREADS: int = int(os.getenv("ASR_THREADS", 2))
    # 存储路径配置
    STORAGE_PATH: str = os.getenv("STORAGE_PATH", "./storage")

    # 连接池参数 [针对 A-3 语音数据吞吐量调优]
    DB_POOL_SIZE: int = 10  # 基础连接数
    DB_MAX_OVERFLOW: int = 20  # 最大允许溢出连接数
    DB_POOL_RECYCLE: int = 3600  # 连接回收时间(秒)
    DB_POOL_PRE_PING: bool = True  # 借出连接前先检查存活
    
    class Config:
        env_file = ".env"


settings = Settings()
