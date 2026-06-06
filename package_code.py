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
    "downloads",
    "historical",
    "quarantine_orphans",
    ".local",
    ".selenium-temp",
    "selenium-temp",
    "webdriver",
    "BrowserMetrics",
    "GrShaderCache",
    "ShaderCache",
    "Crashpad",
    "GPUCache",
    "Code Cache",
    "Service Worker",
    "IndexedDB",
    "Session Storage",
    "Local Storage",
    "Extension State",
    "Extension Scripts",
    "Extension Rules",
    "blob_storage",
    "data/audio",
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
    "pack_week4.py",
    "package_code.py",
    "package_ai_code.py",
    "assets",
    "yarn.lock",
    "pnpm-lock.yaml",
    "tsconfig.tsbuildinfo",
    "proxy_pool.txt",
    "storage_state.json",
    "cookies.json",
    "a5_purged_audio_blocklist.json",
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
    content = """# Yellow组 —— ATC系统安装手册

**项目名称：** Alpha · ATC 地空通话语音标注系统  
**交付人：** 冷亚航 · 学号 2023141230141  
**适用对象：** 教师验收、组员复现、答辩演示  
**更新日期：** 2026 年 6 月

本压缩包仅含**源码与配置模板**，不含 `node_modules`、Python 虚拟环境、ASR 模型权重、SQLite 数据库、`.env` / API 密钥等。解压后按下列步骤安装。

## 目录结构

```text
code/
├── readme.md          # 本说明
├── front/             # A4 前端（Next.js）
├── backend/           # A5 数据服务（FastAPI）
└── integration/       # 联调脚本与子模块（A1/A2/A3）
```

下文以解压后的 `code` 目录为工作根目录，记为 `<CODE>`。

---

## 1. 安装前准备

### 1.1 硬件与系统

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10 / 11（64 位） |
| 内存 | 建议 ≥ 8 GB |
| 磁盘 | 解压后约 500 MB；含 npm / Python 依赖后约 2 GB |
| 网络 | 首次安装需联网（npm install、可选 ASR 模型下载） |
| 浏览器 | Chrome 122+（推荐） |

### 1.2 软件环境

| 软件 | 版本 | 用途 |
|------|------|------|
| Node.js | 20.x | 前端 Next.js |
| npm | 随 Node 安装 | 前端依赖 |
| Python | 3.10+ | A5 / A2 / A3 后端与联调脚本 |
| pip | 随 Python 安装 | Python 依赖 |
| PowerShell | 5.1+（系统自带） | 一键启动与健康检查 |

版本检查命令：

```powershell
node -v
npm -v
python --version
pip --version
```

### 1.3 获取源码

解压交付包 `code.zip`，得到上述 `code/` 目录结构。

---

## 2. 安装步骤（推荐顺序）

### 2.1 安装前端依赖

```powershell
cd <CODE>\\front
npm install
```

在 `front` 目录新建文件 `.env.local`，写入：

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

可选（启用千问 AI 智能体时）：

```env
QIANWEN_API_KEY=你的通义千问_API_Key
```

说明：密钥不会随源码包分发，需自行在阿里云 DashScope 控制台申请。

### 2.2 安装 A5 后端依赖

```powershell
cd <CODE>\\backend
pip install -r requirements.txt
```

首次启动 A5 时会自动创建 SQLite 数据库表结构（`backend/data.sqlite3`）。

### 2.3 安装 A2 / A3 依赖（全链路演示建议安装）

```powershell
cd <CODE>\\integration\\ATC-VA-A2
pip install -r requirements.txt

cd <CODE>\\integration\\a3_speech_processing_6
pip install -r requirements.txt
```

A2 首次启动若无 `.env`，可从 `.env.example` 复制（LiveATC 真实下载为可选项，演示可跳过）。

### 2.4 一键启动全部服务

```powershell
cd <CODE>\\integration
.\\start-all.ps1
```

脚本将依次打开多个 PowerShell 窗口，启动：

| 服务 | 端口 | 说明 |
|------|------|------|
| A5 数据库 API | 8000 | 前端唯一数据源 |
| A2 音频服务 | 8001 | 录音文件与媒体 URL |
| A3 语音识别 | 9002 | ASR（首次可能较慢） |
| A1 航迹采集 | — | OpenSky 实时采集（可选） |
| 前端 | 3000 | 标注工作台 |

等待约 15～30 秒（前端冷编译可能需 15～25 秒）。

### 2.5 健康检查

```powershell
cd <CODE>\\integration
.\\health-check.ps1
```

预期输出四项均为 `[OK]`：

- A5 → http://127.0.0.1:8000/health
- A2 → http://127.0.0.1:8001/health
- A3 → http://127.0.0.1:9002/
- Front → http://localhost:3000/

---

## 3. 演示数据准备

源码包不含历史数据库文件。首次演示任选以下方式之一。

**方式 A：快速种子数据（推荐，约 1 分钟）**

A5 已启动（:8000）后执行：

```powershell
cd <CODE>\\integration
python seed_a1_tracks_to_a5.py
python seed_demo_annotations_to_a5.py
```

然后刷新浏览器 http://localhost:3000 。

**方式 B：全链路同步**（需 A1/A2/A3 源库已存在）

若本机已通过联调积累过 A1/A2/A3 数据库：

```powershell
cd <CODE>\\integration
python sync_all_to_a5.py
```

**方式 C：仅前端演示**（零配置兜底）

若 A5 暂不可用，前端会自动回退到内置演示数据，仍可展示界面与基本交互（部分保存功能不可用）。

---

## 4. 验证安装成功

| 序号 | 检查项 | 预期结果 |
|------|--------|----------|
| 1 | 浏览器访问 http://127.0.0.1:8000/health | 返回 `{"ok":true}` |
| 2 | 浏览器访问 http://localhost:3000 | 出现登录页或主界面 |
| 3 | health-check.ps1 | 四项 [OK] |
| 4 | 登录后首页 | 可见录音列表或演示数据 |
| 5 | 点击录音 | 波形、地图、转写区有响应 |

---

## 5. 常见问题

| 现象 | 处理办法 |
|------|----------|
| 端口 8000/3000 被占用 | 关闭占用进程后重跑 start-all.ps1（脚本会先尝试释放端口） |
| 前端 ChunkLoadError | 删除 `front\\.next` 后重新 `npm run dev` |
| npm install 失败 | 检查 Node 版本是否为 20.x；可换国内 npm 镜像 |
| A2/A3 窗口报错缺模块 | 补执行 §2.3 的 `pip install -r requirements.txt` |
| 登录后列表为空 | 执行 §3 种子脚本，或确认 A5 已启动 |
| 千问提示 Missing QIANWEN_API_KEY | 在 `front/.env.local` 配置 Key 并重启前端 |
| CORS / Failed to fetch | 确认 `NEXT_PUBLIC_API_BASE_URL` 为 http://127.0.0.1:8000 |

---

Alpha · ATC 地空通话标注平台 · 演示系统简要安装手册
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
