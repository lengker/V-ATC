# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.api.v1 import recognize
from app.api.v1 import export
from app.api.v1 import query
from app.services.speech_service import SpeechService

# 动作三：引入全局 Lifespan 生命周期管理
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[lifespan] starting service, loading ASR/VAD models...")
    # 将模型实例挂载到 FastAPI 的 app.state 上
    app.state.speech_handler = SpeechService()
    print("[lifespan] models ready")

    yield  # 这里是应用运行时的停顿点

    # 接收到关闭指令时，彻底释放内存
    print("[lifespan] shutting down, releasing models...")
    del app.state.speech_handler


# 挂载 lifespan
app = FastAPI(title="VHHH ATC Speech Analysis System", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(recognize.router, prefix="/api/v1", tags=["Speech Recognition"])
app.include_router(export.router, prefix="/api/v1/export", tags=["Data Export"])
app.include_router(query.router, prefix="/api/v1/query", tags=["Data Query"])

@app.get("/")
async def root():
    return {"status": "running", "module": "A-3 Speech Pre-processing", "message": "高性能内存优化版本已启动"}