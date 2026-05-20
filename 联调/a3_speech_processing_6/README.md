# 🎙️ 可视化ATC地空通话语音标注系统 - A3语音预处理模块

![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-green.svg)
![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2.0+-red.svg)
![ONNX](https://img.shields.io/badge/Sherpa--ONNX-Engine-orange.svg)

## 1. 项目概述
本项目为 A-3 语音预处理模块，是 VHHH（香港赤鱲角国际机场）数据采集与处理系统的核心组件。其主要职责是接收 A-2 模块的语音流，执行 VAD（静音检测）与 ASR（语音识别），生成带时间戳的结构化文本，并提供高效的时序检索与导出服务。

**🎯 已完成阶段（第 8 周）：大容量异步导出架构重构**
引入基于 `BackgroundTasks` 的轻量级异步任务分发机制，彻底解除大文件打包时的主线程阻塞。创新性地设计了基于 UUID 的内存状态机（Task Status Polling）与延迟释放钩子，实现了“毫秒级接单 -> 实时进度轮询 -> 磁盘无损清理”的工业级异步闭环。

**🚀 当前阶段（第 9 周）：底层数据库高频查询调优**
针对系统运行中后期海量语音记录带来的“慢查询”瓶颈，本周核心是对底层表结构进行深度调优。通过在 ORM 模型层为 `created_at`、`channel` 等高频筛选参数精准挂载 B-Tree 索引，配合基数压测验证，将极大提升时序检索与策略导出 API 的响应极限。

---

## 2. 核心技术栈
* **Web 框架**: FastAPI + Uvicorn (配合 Lifespan 全局生命周期管理)
* **数据库架构**: SQLAlchemy 2.0 (高并发连接池 + DAO 模式 + B-Tree 索引优化)
* **任务队列**: 内存级状态机 + BackgroundTasks 异步执行器
* **AI 语音引擎**: Sherpa-ONNX (SenseVoice int8 量化模型) + 显式内存释放

---

## 3. 目录结构

```text
a3_speech_processing/
├── app/
│   ├── api/                 # 【前台】Web 接口路由
│   │   ├── deps.py          # 通用依赖项 (如数据库 Session 生成器)
│   │   └── v1/
│   │       ├── recognize.py # 语音识别入库接口
│   │       ├── query.py     # 时序检索接口
│   │       └── export.py    # 异步策略导出接口 (轮询/下载/清理)
│   ├── core/                # 【配置层】系统参数与环境管理
│   ├── db/                  # 【数据访问层】
│   │   ├── base.py          # ORM 基类
│   │   ├── session.py       # 连接池管理
│   │   ├── models.py        # 业务表结构 (已实施高频字段索引优化)
│   │   └── crud.py          # 复杂 DAO 查询逻辑封装
│   ├── engine/              # 【算法与处理引擎】
│   │   ├── sense_voice.py   # ASR 识别引擎加载与单例封装
│   │   ├── vad_processor.py # VAD 静音切分引擎
│   │   └── export_engine.py # ZIP 打包与 CSV 索引生成引擎
│   ├── services/            # 【业务调度层】
│   │   └── speech_service.py# 串联“切分->识别->容错校验->入库”流
│   └── main.py              # 【总控】应用入口、路由挂载与模型预热
├── storage/                 # 【临时存储区】存放导出 ZIP 与音频缓冲
├── test_wavs/               # 【测试样例】多语种语音样本 (APP/TWR 等频道)
├── requirements.txt         # 项目依赖清单
└── README.md                # 项目说明文档