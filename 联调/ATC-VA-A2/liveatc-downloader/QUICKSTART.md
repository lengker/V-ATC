# VHHH 多方式下载工具 - 快速开始指南

## 环境要求

- Python 3.7+
- Windows / macOS / Linux
- 项目根目录中的 `.venv` 虚拟环境

## 当前支持的下载回退

- 直接 HTTP 下载。
- cloudscraper 和浏览器头部对齐。
- 浏览器辅助导出 Cookie。
- Playwright 持久化 profile 和 storage_state。
- 模拟鼠标和键盘的浏览器访问。
- 代理池作为最后补充。

## 本机配置检查

如果浏览器回退失败，通常优先检查：

- Chrome 是否安装且可用。
- 目标 profile 是否被占用。
- Playwright 浏览器是否安装完整。
- 本地网络是否可访问 LiveATC 和 Cloudflare。
- 系统时间是否准确。

## 第一步：创建虚拟环境（仅需一次）

在项目根目录运行：

```bash
# Windows
python -m venv .venv
.venv\Scripts\activate

# macOS / Linux
python3 -m venv .venv
source .venv/bin/activate
```

## 第二步：安装依赖（仅需一次）

```bash
cd liveatc-downloader
pip install -r requirements.txt
```

## 第三步：运行下载工具

### Windows (PowerShell)

```powershell
# 最简单的方式 - 使用现有 Cookie
.\run.ps1

# 浏览器导出 Cookie
.\run.ps1 --export-cookie --count 5

# 下载特定日期
.\run.ps1 --date 2024-10-28 --count 8

# 使用自定义 Cookie
.\run.ps1 --cookie "your-cookie-here"
```

### macOS / Linux (Bash)

```bash
# 最简单的方式 - 使用现有 Cookie
bash run.sh

# 浏览器导出 Cookie
bash run.sh --export-cookie --count 5

# 下载特定日期
bash run.sh --date 2024-10-28 --count 8

# 使用自定义 Cookie
bash run.sh --cookie "your-cookie-here"
```

### 手动运行（如需完全控制）

```bash
# 激活虚拟环境
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate

# 运行脚本
python vhhh_multimethod_download.py --help
python vhhh_multimethod_download.py --count 5
```

## Cookie 获取方式

### 方式 1：浏览器导出（推荐）

```bash
# Windows
.\run.ps1 --export-cookie --count 1

# macOS/Linux
bash run.sh --export-cookie --count 1
```

然后：

1. 在浏览器窗口中完成 Cloudflare 验证（如需）
2. 返回终端按 Enter 键
3. Cookie 自动保存到 `.local/liveatc_cookie.txt`

### 方式 2：手动保存 Cookie

1. 打开浏览器访问 <https://www.liveatc.net/>
2. 按 F12 打开开发者工具 -> 网络标签
3. 刷新页面，找到任何请求
4. 复制 Cookie 头值
5. 保存到文件：

```bash
mkdir .local
echo "your-cookie-value" > .local/liveatc_cookie.txt
```

## 常见用法示例

```bash
# 快速下载最近 5 个时段
.\run.ps1

# 下载最近 24 小时（48 个 30 分钟时段）
.\run.ps1 --count 48

# 下载特定日期的所有音频
.\run.ps1 --date 2024-10-28 --count 48

# 查看所有可用选项
.\run.ps1 --help
```

## 输出文件

所有下载的文件存储在 `liveatc-downloader/downloads/` 目录：

```text
downloads/
├── VHHH5-App-Dep-Dir-Zone-Oct-28-2024-1200Z.mp3
├── VHHH5-App-Dep-Dir-Zone-Oct-28-2024-1230Z.mp3
├── ...
└── vhhh_download.log
```

## 查看日志

```bash
# Windows
Get-Content downloads/vhhh_download.log -Tail 50

# macOS/Linux
tail -50 downloads/vhhh_download.log
```

## 常见问题

Q1: 没有虚拟环境怎么办？

```bash
# 创建虚拟环境
python -m venv .venv

# 激活虚拟环境
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate

# 安装依赖
cd liveatc-downloader
pip install -r requirements.txt
```

Q2: 缺少依赖怎么办？

```bash
# 激活虚拟环境后
pip install -r requirements.txt
```

Q3: Cookie 过期了怎么办？

```bash
# 重新导出 Cookie
.\run.ps1 --export-cookie --count 1
```

Q4: 下载失败，日志显示 403 错误？

- 检查 Cookie 是否有效
- 重新导出 Cookie：`.\run.ps1 --export-cookie`
- 检查网络连接

## 环境变量（可选）

```bash
# 设置 Cookie（覆盖文件）
set LIVEATC_COOKIE=your-cookie-here

# 设置 Cookie 文件路径
set LIVEATC_COOKIE_FILE=%CD%\.local\liveatc_cookie.txt
```

## 系统要求

### 必需

- Python 3.7+
- pip 包管理器
- 互联网连接

### 可选

- Playwright（用于浏览器 Cookie 导出）

  ```bash
  pip install playwright
  playwright install chromium
  ```

## 下一步

- 查看 `VHHH_MULTIMETHOD_README.md` 获取详细文档
- 查看日志文件排查问题：`downloads/vhhh_download.log`
- 运行诊断：`python test_environment.py`

---

**注意**：所有脚本现在自动使用项目的 `.venv` 虚拟环境，确保依赖版本一致。
