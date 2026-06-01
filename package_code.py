# -*- coding: utf-8 -*-
"""Pack project source into code.zip (English dirs, single readme.md, no env artifacts)."""
from __future__ import annotations

import os
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STAGING_PARENT = ROOT / "_pack_tmp"
STAGING = STAGING_PARENT / "code"
ZIP_PATH = ROOT / "code.zip"

SKIP_DIR_NAMES = {
    "node_modules",
    ".next",
    "__pycache__",
    ".git",
    ".idea",
    ".vscode",
    "_pack_tmp",
    ".venv",
    "venv",
    ".asr-venv",
    "out",
    "dist",
    "build",
    "models",
    "vosk-models",
    "quarantine_orphans",
    "test_wavs",
    "loadtest",
    "image",
    "tests",
    ".github",
    "teamwork",
    "code_1",
    "code_2",
    "code_3",
    ".cloakbrowser-cache",
    ".playwright",
    ".pytest_cache",
    "playwright",
    "cache",
    "logs",
    "coverage",
    ".turbo",
    ".cache",
    "htmlcov",
    ".mypy_cache",
    ".ruff_cache",
}

SKIP_FILE_SUFFIXES = {
    ".pyc",
    ".pyo",
    ".sqlite3",
    ".db",
    ".zip",
    ".tar",
    ".bz2",
    ".onnx",
    ".mdl",
    ".fst",
    ".wav",
    ".mp3",
    ".docx",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".md",
}

SKIP_FILE_NAMES = {
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".DS_Store",
    "code.zip",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "tsconfig.tsbuildinfo",
    "proxy_pool.txt",
}

INCLUDE_ROOT_DIRS = ("front", "backend")
INTEGRATION_SRC = ROOT / "联调"
INTEGRATION_DST_NAME = "integration"


def should_skip(name: str, is_dir: bool) -> bool:
    if is_dir and name in SKIP_DIR_NAMES:
        return True
    if not is_dir:
        if name in SKIP_FILE_NAMES:
            return True
        lower = name.lower()
        for suf in SKIP_FILE_SUFFIXES:
            if lower.endswith(suf):
                return True
    return False


def copy_tree(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    dst.mkdir(parents=True, exist_ok=True)
    for root, dirs, files in os.walk(src):
        root_path = Path(root)
        dirs[:] = [d for d in dirs if not should_skip(d, True)]
        rel = root_path.relative_to(src)
        target_root = dst / rel
        target_root.mkdir(parents=True, exist_ok=True)
        for fname in files:
            if should_skip(fname, False):
                continue
            shutil.copy2(root_path / fname, target_root / fname)


def patch_module_paths(integration_dir: Path) -> None:
    path = integration_dir / "module_paths.py"
    if not path.exists():
        return
    text = path.read_text(encoding="utf-8")
    text = text.replace('QT_ROOT / "联调"', 'QT_ROOT / "integration"')
    text = text.replace('"联调"', '"integration"')
    path.write_text(text, encoding="utf-8")


def write_readme(target: Path) -> None:
    content = """# Alpha · ATC Voice Annotation Platform

可视化 ATC 地空通话语音标注系统（A-4 前端 + A5 数据服务 + 全链路联调脚本）。

本压缩包仅含**源码与配置模板**，不含运行环境（`node_modules`、Python 虚拟环境、ASR 模型、数据库文件等）。解压后按下列步骤安装依赖并启动。

## 目录结构

```text
code/
├── readme.md          # 本说明（唯一文档）
├── front/             # A4 前端（Next.js 15 + TypeScript）
├── backend/           # A5 数据服务（FastAPI + SQLite）
└── integration/     # 联调脚本与子模块（A1/A2/A3）
    ├── start-all.ps1
    ├── health-check.ps1
    ├── sync_all_to_a5.py
    ├── ATC-VA-A2/           # A2 音频采集（:8001）
    ├── a3_speech_processing_6/  # A3 语音识别（:9002，需自行下载模型）
    └── ATC-ADSB-Receiver/   # A1 说明与采集辅助
```

## 环境要求

| 组件 | 版本 |
|------|------|
| Node.js | 20.x |
| Python | 3.10+ |
| 操作系统 | Windows 10/11（联调脚本为 PowerShell） |
| 浏览器 | Chrome 122+ |

## 快速开始（推荐）

### 1. 安装前端依赖

```powershell
cd front
npm install
```

在 `front/` 下创建 `.env.local`：

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

可选（千问 AI 智能体）：

```env
QIANWEN_API_KEY=你的通义千问_API_Key
```

### 2.1 安装 A2 / A3 依赖（全链路演示建议）

```powershell
cd integration/ATC-VA-A2
pip install -r requirements.txt

cd ../a3_speech_processing_6
pip install -r requirements.txt
```

### 2.2 安装 A5 后端依赖

```powershell
cd backend
pip install -r requirements.txt
```

### 3. 一键启动全链路（Windows）

```powershell
cd integration
.\\start-all.ps1
```

等待约 15 秒后健康检查：

```powershell
.\\health-check.ps1
```

浏览器打开：<http://localhost:3000>

### 4. 演示数据准备

**方式 A（推荐，空库快速演示）** — A5 已启动后：

```powershell
cd integration
python seed_a1_tracks_to_a5.py
python seed_demo_annotations_to_a5.py
```

**方式 B（全链路同步，需 A1/A2/A3 源库已存在）：**

```powershell
cd integration
python sync_all_to_a5.py
```

**方式 C：** 登录前端后点击左侧 **「实时更新」**，自动从 A2 拉取新录音并触发 ASR（需 A2 :8001 运行）。

然后刷新浏览器 `http://localhost:3000`。

## 服务端口

| 服务 | 目录 | 端口 |
|------|------|------|
| A5 数据库 API | `backend/` | 8000 |
| A2 音频服务 | `integration/ATC-VA-A2/` | 8001 |
| A3 语音识别 | `integration/a3_speech_processing_6/` | 9002 |
| 前端 | `front/` | 3000 |

## 单独启动（调试用）

**A5：**

```powershell
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

**前端：**

```powershell
cd front
npm run dev
```

**A2：**

```powershell
cd integration/ATC-VA-A2
pip install -r requirements.txt
python run.py
```

**A3：** 首次使用需安装依赖；ASR 模型（如 faster-whisper `tiny`）在首次识别时自动下载。

```powershell
cd integration/a3_speech_processing_6
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 9002
```

## 数据流

```text
A1 航迹 → sync → LNG_TRACKS (A5) → 前端地图
A2 录音 → sync → LNG_AUDIO_RECORDS (A5) → 列表/波形
A3 ASR  → sync → LNG_ANNOTATIONS (A5) → 转写时间轴
```

前端**只读 A5**（`NEXT_PUBLIC_API_BASE_URL`），不直连 A2/A3 数据库。

## 常用联调脚本

| 脚本 | 说明 |
|------|------|
| `integration/start-all.ps1` | 启动 A5、A2、A3、前端、A1 采集 |
| `integration/health-check.ps1` | 检查四服务 HTTP 可达 |
| `integration/sync_all_to_a5.py` | 一键同步 A1/A2/A3 → A5 |
| `integration/sync_a2_to_a5.py` | 仅同步 A2 音频 |
| `integration/purge_recordings_without_transcript.py` | 清理无转写录音 |
| `integration/seed_a1_tracks_to_a5.py` | 写入示例航迹 |
| `integration/seed_demo_annotations_to_a5.py` | 写入演示转写 |

## 登录与验收

1. 访问 `http://127.0.0.1:8000/health` 应返回 `{"ok":true}`
2. 前端注册/登录（角色 `annotator` 或 `viewer`）
3. 同步数据后首页应出现录音列表、航迹与标注
4. 可播放波形、编辑转写、查看地图、导出 JSON/CSV

后端不可用时，可使用离线演示账号（若前端已启用）：`offline@alpha.local` / `offline123`

## 生产构建（可选）

```powershell
cd front
npm run build
npm start
```

## 未包含内容（需自行准备）

- `node_modules`、`.next`、Python `venv`
- SQLite 数据库文件（`*.sqlite3`、`*.db`），运行 sync 脚本生成
- A3 大型 ASR 模型权重（首次运行按环境变量下载）
- `.env` / `.env.local`（含密钥，请本地创建）

## 主要源码入口

| 模块 | 路径 |
|------|------|
| 前端主页 | `front/src/app/page.tsx` |
| 后端 API | `backend/app/main.py` |
| 前端数据层 | `front/src/lib/backend-api.ts` |
| 登录鉴权 | `front/src/context/AuthContext.tsx` |
| 联调路径配置 | `integration/module_paths.py` |

---

Alpha · ATC 地空通话标注平台 · 课程设计交付源码包
"""
    (target / "readme.md").write_text(content, encoding="utf-8")


def make_zip(staging: Path, zip_path: Path) -> None:
    if zip_path.exists():
        zip_path.unlink()
    root_name = staging.name
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, dirs, files in os.walk(staging):
            dirs.sort()
            for fname in sorted(files):
                full = Path(root) / fname
                rel = full.relative_to(staging.parent)
                zf.write(full, rel.as_posix())


def main() -> None:
    if STAGING_PARENT.exists():
        shutil.rmtree(STAGING_PARENT)
    STAGING.mkdir(parents=True)

    for name in INCLUDE_ROOT_DIRS:
        copy_tree(ROOT / name, STAGING / name)

    copy_tree(INTEGRATION_SRC, STAGING / INTEGRATION_DST_NAME)
    patch_module_paths(STAGING / INTEGRATION_DST_NAME)
    write_readme(STAGING)

    make_zip(STAGING, ZIP_PATH)
    shutil.rmtree(STAGING_PARENT)

    size_mb = ZIP_PATH.stat().st_size / (1024 * 1024)
    with zipfile.ZipFile(ZIP_PATH) as zf:
        n_files = len(zf.namelist())
    print(f"Created {ZIP_PATH} ({size_mb:.2f} MB, {n_files} entries)")


if __name__ == "__main__":
    main()
