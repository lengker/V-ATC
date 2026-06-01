# -*- coding: utf-8 -*-
"""Pack Qianwen / A-4 agent source only into ai-code.zip (no API keys or env files)."""
from __future__ import annotations

import os
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STAGING_PARENT = ROOT / "_pack_ai_tmp"
STAGING = STAGING_PARENT / "ai-code"
ZIP_PATH = ROOT / "ai-code.zip"

# Paths relative to repo root (forward slashes)
AI_FILES = [
    "front/src/app/api/qianwen/agent/route.ts",
    "front/src/components/qianwen-agent-widget.tsx",
    "front/src/components/qianwen-agent-panel.tsx",
    "front/src/lib/agent-workspace-context.ts",
    "front/src/lib/agent-transcript-ops.ts",
    "front/src/mock/vsp-aip.ts",
    "front/QIANWEN_ENV.md",
]

SKIP_NAMES = {".env", ".env.local", ".env.development", ".env.production"}


def write_readme(target: Path) -> None:
    content = """# Alpha · A-4 千问智能体源码包

仅含千问（DashScope）智能体相关实现，**不含** API 密钥、`.env.local`、`node_modules`。

## 文件清单

| 路径 | 说明 |
|------|------|
| `front/src/app/api/qianwen/agent/route.ts` | Next.js API：组装 prompt、调用 DashScope、解析 JSON |
| `front/src/components/qianwen-agent-widget.tsx` | 浮动对话 UI（改写/总结/合并/说话人） |
| `front/src/components/qianwen-agent-panel.tsx` | 旧版面板（可选） |
| `front/src/lib/agent-workspace-context.ts` | 工作区快照（转写/地图/录音列表） |
| `front/src/lib/agent-transcript-ops.ts` | 合并段、改说话人、改文本的应用逻辑 |
| `front/src/mock/vsp-aip.ts` | VHHH 地标/SID/航司简字（注入 system prompt） |
| `front/QIANWEN_ENV.md` | 环境变量说明（需自行配置 Key） |

## 配置密钥（本地，勿提交）

在宿主项目的 `front/.env.local` 中：

```env
QIANWEN_API_KEY=你的通义千问_Key
QIANWEN_MODEL=qwen-plus
```

或在智能体窗口内临时粘贴 Key（存浏览器 `localStorage`，仅本机）。

## 接入主界面（摘要）

在 `annotation-page.tsx` 中：

1. `buildAgentWorkspaceSnapshot({ ... })` 构建 `workspace`
2. 渲染 `<QianwenAgentWidget workspace={...} onApplyTranscriptOps={...} onApplySuggestedText={...} />`
3. `applyAgentTranscriptOps` 写入转写列表

依赖宿主项目：`@/types`（`VoiceTimestamp`）、`@/components/ui/*`、`@/hooks/use-toast`、`@/lib/utils` 等。

## API

- `POST /api/qianwen/agent` — body 含 `mode`、`userCommand`、`workspace` 等
- `GET /api/qianwen/agent` — 检查是否已配置 `QIANWEN_API_KEY`（不返回密钥）

---

Alpha · ATC A-4 模块 · 2026
"""
    (target / "readme.md").write_text(content, encoding="utf-8")


def copy_ai_files(staging: Path) -> int:
    n = 0
    for rel in AI_FILES:
        src = ROOT / rel.replace("/", os.sep)
        if not src.is_file():
            print(f"WARN missing: {rel}")
            continue
        if src.name in SKIP_NAMES:
            continue
        dst = staging / rel.replace("/", os.sep)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        n += 1
    return n


def make_zip(staging: Path, zip_path: Path) -> None:
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, _dirs, files in os.walk(staging):
            for fname in sorted(files):
                full = Path(root) / fname
                rel = full.relative_to(staging.parent)
                zf.write(full, rel.as_posix())


def main() -> None:
    if STAGING_PARENT.exists():
        shutil.rmtree(STAGING_PARENT)
    STAGING.mkdir(parents=True)
    copied = copy_ai_files(STAGING)
    write_readme(STAGING)
    make_zip(STAGING, ZIP_PATH)
    shutil.rmtree(STAGING_PARENT)
    size_kb = ZIP_PATH.stat().st_size / 1024
    with zipfile.ZipFile(ZIP_PATH) as zf:
        entries = len(zf.namelist())
    print(f"Created {ZIP_PATH} ({size_kb:.1f} KB, {entries} entries, {copied} source files)")


if __name__ == "__main__":
    main()
