# LiveATC 历史音频下载完整指南

## 概述

本项目包含一个完整的 LiveATC 历史音频下载解决方案，包括：

1. **liveatc-downloader/** - 独立的 CLI 工具，用于下载 LiveATC 历史音频
2. **app/services/ingestion_service.py** - 主应用的高级异步摄取服务
3. **app/services/ingestion_scheduler.py** - 自动化定时下载任务调度器

## 架构

```text
LiveATC 历史音频下载系统
|-- CLI 工具 (liveatc-downloader/)
|   |-- 适用于手动下载
|   |-- 支持单个、列表、批量下载
|   +-- 返回详细的错误和成功信息
|
+-- 主应用异步系统 (app/)
    |-- 自动定时下载
    |-- 数据库集成
    +-- API 端点支持
```

## 快速开始

### [NEW] VHHH 专用多方式下载工具（推荐）

针对 VHHH（香港赤鱲角）机场的历史音频下载，本项目提供了一个综合的多方式下载工具 **`vhhh_multimethod_download.py`**，集成了所有可能的下载方法。

#### 功能特性

- [OK] **多下载方法**：httpx 直连 + cloudscraper 自动绕过 Cloudflare
- [OK] **多源 URL**：支持主存档 + 备用镜像 URL
- [OK] **自动文件生成**：根据日期自动生成最近 N 个 30 分钟时段的候选文件名
- [OK] **浏览器 Cookie 导出**：支持启动真实浏览器手动完成 Cloudflare 验证
- [OK] **并行下载**：可配置的并发数量加速下载
- [OK] **详细日志**：实时日志输出 + 文件日志记录

#### 回退方法

在原有 httpx 和 cloudscraper 基础上，仓库还新增了这些路径：

- 浏览器辅助 Cookie 导出，在真实浏览器中完成验证后保存会话。
- Playwright 持久化 profile 和 storage_state，复用可用的浏览器上下文。
- 模拟鼠标和键盘的浏览器访问脚本，用于更接近人工的访问流程。
- Playwright request context 下载，尽量利用浏览器会话中的 Cookie。
- 代理池回退，作为网络层补充。

#### IP 池说明

仓库中已经保留代理池相关能力，配置点集中在 `app/core/config.py`、`app/services/proxy_provider.py` 和 `liveatc-downloader/proxy_pool.txt`。当前默认策略仍是先尝试直连和浏览器会话，代理只在需要时作为补充。

#### 本机相关配置

以下项目会影响浏览器和代理回退的成功率：

- Chrome 安装路径和 Playwright channel。
- 本地 profile 是否被占用。
- Playwright 浏览器是否已安装。
- 系统时间、时区、DNS、网络和防火墙。

#### 安装依赖

```bash
cd liveatc-downloader
pip install -r requirements.txt

# 可选：如需浏览器辅助 Cookie 导出
playwright install
```

#### 方法 1：使用已有的 Cookie 文件

```bash
# 默认从 ./.local/liveatc_cookie.txt 读取 Cookie
python vhhh_multimethod_download.py

# 或指定 Cookie 文件位置
python vhhh_multimethod_download.py --cookie-file ~/.liveatc_cookie
```

#### 方法 2：在命令行直接提供 Cookie

```bash
python vhhh_multimethod_download.py --cookie "cf_clearance=xxxxx; sessionid=yyyyy"
```

#### 方法 3：启动浏览器手动导出 Cookie

如果以上方法都没有有效 Cookie，可以启动真实浏览器：

```bash
python vhhh_multimethod_download.py --export-cookie

# 操作步骤：
# 1. 浏览器会打开 https://www.liveatc.net/
# 2. 如果出现 Cloudflare 验证，请手动完成
# 3. 在浏览器加载完成后，返回终端，按 Enter 键
# 4. 脚本会自动提取 Cookie 并保存到 ./.local/liveatc_cookie.txt
```

#### 方法 4：自动检测 + 并行下载多个时段

下载最近 10 个 30 分钟时段（即最近 5 小时）：

```bash
python vhhh_multimethod_download.py --count 10
```

下载特定日期的音频（例如 2024-10-28）：

```bash
python vhhh_multimethod_download.py --date 2024-10-28 --count 8
```

#### 方法 5：使用环境变量

```bash
# 设置 Cookie 环境变量
export LIVEATC_COOKIE="your-cookie-here"

# 或从文件读取
export LIVEATC_COOKIE_FILE=~/.liveatc_cookie

# 运行下载
python vhhh_multimethod_download.py --count 5

# 或指定输出目录
python vhhh_multimethod_download.py --output-dir ./my_downloads --count 5
```

#### 方法 6：指定自定义存档 URL

如果知道备用镜像 URL：

```bash
python vhhh_multimethod_download.py --base-url https://backup-archive.example.com
```

#### 完整使用示例

```bash
# 示例 1: 最简单的用法（假设已有 Cookie）
python vhhh_multimethod_download.py

# 示例 2: 下载最近 24 小时（48 个 30 分钟时段）
python vhhh_multimethod_download.py --count 48

# 示例 3: 下载特定日期范围
python vhhh_multimethod_download.py --date 2024-10-25 --count 12

# 示例 4: 浏览器导出 Cookie 后下载
python vhhh_multimethod_download.py --export-cookie --count 10

# 示例 5: 使用命令行 Cookie 并输出到特定目录
python vhhh_multimethod_download.py \
  --cookie "cf_clearance=xxxx" \
  --output-dir ./vhhh_archive \
  --count 20

# 示例 6: 调试模式（查看详细日志）
python vhhh_multimethod_download.py --count 5 2>&1 | tee debug.log
```

#### 输出文件

下载的音频文件保存在 `./downloads/` 目录（默认）：

```text
downloads/
|-- VHHH5-App-Dep-Dir-Zone-Oct-28-2024-1200Z.mp3
|-- VHHH5-App-Dep-Dir-Zone-Oct-28-2024-1230Z.mp3
|-- VHHH5-Ground-Oct-28-2024-1200Z.mp3
|-- ...
+-- vhhh_download.log
```

#### 日志文件

每次运行都会生成 `downloads/vhhh_download.log` 包含：

```text
2024-10-28 12:34:56 [INFO] VHHH 机场历史音频多方式下载工具
2024-10-28 12:34:56 [INFO] ► 模式: 自动检测 Cookie
2024-10-28 12:34:57 [INFO] [OK] Cookie 已获取（长度: 256 字符）
2024-10-28 12:34:57 [INFO] [OK] 生成了 40 个文件候选
2024-10-28 12:35:00 [INFO] [OK] httpx 下载成功: https://archive.liveatc.net/vhhh/VHHH5-App-Dep-Dir-Zone-Oct-28-2024-1200Z.mp3 (5242880 bytes)
...
2024-10-28 12:45:30 [INFO] 下载完成: 15/40 成功
```

#### 常见问题解答

**Q1: 如何判断是否需要 Cookie？**

```bash
# 尝试不使用 Cookie 下载
python vhhh_multimethod_download.py --count 1

# 如果日志显示 "[FAIL] httpx 遇到 403" 且 "[FAIL] cloudscraper 返回状态码 403"
# 则说明需要 Cookie
```

**Q2: Cookie 已过期怎么办？**

重新运行浏览器导出：

```bash
python vhhh_multimethod_download.py --export-cookie
```

**Q3: 下载速度很慢？**

可以增加并发连接数（需要更多内存）：

```bash
# 修改源码中的 max_concurrent 参数
# 或者提交 issue
```

**Q4: 能否自动定时下载？**

可以使用系统任务调度或本项目的 `ingestion_scheduler.py`：

```bash
# 方式 A：Windows 任务计划
# 方式 B：Linux cron
# 方式 C：本项目内置调度器（见下方）
```

---

### 方式 1：使用 CLI 工具（liveatc-downloader）

#### 安装依赖

```bash
cd liveatc-downloader
pip install -r requirements.txt
```

#### 获取 Cookie（推荐）

某些 LiveATC 节点受 Cloudflare 保护，需要 Cookie：

1. 打开浏览器访问 <https://www.liveatc.net/>
2. 按 F12 打开开发者工具
3. 在"网络"标签中刷新页面
4. 找到任何请求，复制 Cookie 头值
5. 保存到文件：

```bash
echo "your-cookie-value" > ./.local/liveatc_cookie.txt
```

#### Browser-assisted cookie export (optional)

If you want a real browser to capture cookies:

```bash
cd liveatc-downloader
pip install -r requirements.txt
playwright install
python main.py cookie --output ./.local/liveatc_cookie.txt
```

This opens a browser window for manual verification. Press Enter in the terminal to save cookies.

#### 列出机场电台

```bash
# 香港赤鱲角机场 (VHHH)
python main.py stations VHHH --cookie-file ./.local/liveatc_cookie.txt
```

#### 下载单个音频

```bash
# 下载最近的音频
python main.py download vhhh5 -o ./downloads --cookie-file ./.local/liveatc_cookie.txt

# 下载特定日期和时间
python main.py download vhhh5 -d Oct-28-2024 -t 1200Z -o ./downloads --cookie-file ./.local/liveatc_cookie.txt
```

#### 列出可用的历史档案

```bash
python main.py list vhhh5 --cookie-file ./.local/liveatc_cookie.txt
```

#### 下载日期范围内的所有音频

```bash
# 下载 2024 年 10 月 25-28 日的所有音频（所有 30 分钟时段）
python main.py download-range vhhh5 \
  --start-date 2024-10-25 \
  --end-date 2024-10-28 \
  -o ./downloads \
  --cookie-file ./.local/liveatc_cookie.txt

# 只下载指定时间的音频
python main.py download-range vhhh5 \
  --start-date 2024-10-25 \
  --end-date 2024-10-28 \
  --times 0000Z,0600Z,1200Z,1800Z \
  -o ./downloads \
  --cookie-file ./.local/liveatc_cookie.txt
```

#### Archive base URL override (mirror)

```bash
python main.py download vhhh5 -o ./downloads \
  --archive-base-url https://your-mirror.example.com \
  --cookie-file ./.local/liveatc_cookie.txt
```

You can also set `LIVEATC_ARCHIVE_BASE_URL` for a default override.

### 方式 2：使用主应用 API（自动化）

#### 启动定时下载任务

```bash
# 激活应用时自动启动
curl -X POST http://localhost:8000/api/v1/ingestion/scheduler/start
```

#### 查询任务状态

```bash
curl http://localhost:8000/api/v1/ingestion/scheduler/status
```

示例响应：

```json
{
  "running": true,
  "icao_code": "VHHH",
  "last_error": null,
  "last_historical_at": "2024-10-28T12:30:45.123456",
  "last_historical_found": 45,
  "last_historical_downloaded": 3,
  "last_historical_skipped": 42,
  "last_cookie_warmup_ok": true,
  "last_cookie_count": 2
}
```

#### 手动触发一次下载

```bash
curl -X POST http://localhost:8000/api/v1/ingestion/scheduler/trigger/historical
```

#### 注册历史下载

```bash
curl -X POST http://localhost:8000/api/v1/ingestion/historical/register \
  -H "Content-Type: application/json" \
  -d '{
    "file_name": "VHHH5-Oct-28-2024-1200Z.mp3",
    "source_url": "https://archive.liveatc.net/vhhh/VHHH5-Oct-28-2024-1200Z.mp3",
    "start_time_utc": "2024-10-28T12:00:00Z",
    "end_time_utc": "2024-10-28T12:30:00Z"
  }'
```

## 下载逻辑详解

### CLI 工具 (liveatc-downloader) 的下载流程

```text
用户命令
   v
+-------------------------------------+
| 1. 建立 HTTP 会话                    |
|    (包含 User-Agent 和 Cookie)       |
+-------------------------------------+
               v
+-------------------------------------+
| 2. 获取档案页面                      |
|    https://liveatc.net/archive.php  |
|    解析 HTML 获取档案标识符           |
+-------------------------------------+
               v
+-------------------------------------+
| 3. 构建下载 URL                      |
|    https://archive.liveatc.net/vhhh/ |
|    + 文件名 (编码)                   |
+-------------------------------------+
               v
+-------------------------------------+
| 4. 检查文件                          |
|    - 文件是否已存在                  |
|    - 下载后验证大小                  |
+-------------------------------------+
               v
+-------------------------------------+
| 5. 返回结果                          |
|    {                                |
|      'success': true/false,          |
|      'filename': '...',              |
|      'filepath': '...',              |
|      'url': '...',                   |
|      'size': 1234567,                |
|      'error': '...'  # 如果失败      |
|    }                                |
+-------------------------------------+
```

### 主应用异步下载流程

```text
定时任务触发 (每 hour/30min)
   v
+------------------------------+
| 检查存储空间                  |
| (ensure_capacity)             |
+------------------------------+
       v
+------------------------------+
| Cookie 预热                   |
| (ensure_public_session_cookie)|
+------------------------------+
       v
+------------------------------+
| 列出历史链接                  |
| (list_historical_links)       |
+------------------------------+
       v
   +-----------------------+
   | 对每个链接循环         |
   |---------------------|
   | 1. 检查 URL 是否存在   |
   |    (has_source_url)   |
   | 2. 下载文件            |
   | 3. 保存到数据库        |
   |    (register_download) |
   +---------------------+
     v
+------------------------------+
| 记录统计信息                  |
| - 找到的文件数                |
| - 已下载数                    |
| - 跳过数                      |
| - 错误信息                    |
+------------------------------+
```

## 关键特性

### 1. 错误处理和恢复

- Cloudflare 绕过（Cookie + cloudscraper）
- 网络重试机制（指数退避）
- 部分下载清理
- 文件验证

### 2. 数据去重

- 源 URL 检查（避免重复下载）
- 文件名检查
- 数据库集成

### 3. 性能优化

- 异步 HTTP 请求
- 流式下载（避免内存溢出）
- 定时任务调度
- 存储容量管理

### 4. 时间戳处理

- 从文件名提取时间戳
- 自动 UTC 转换
- 半小时段识别

## 配置参数

### 环境变量 (在 .env 中)

```bash
# LiveATC 基础 URL
A2_LIVEATC_BASE_URL=https://www.liveatc.net

# 档案基础 URL
A2_LIVEATC_ARCHIVE_BASE_URL=https://archive.liveatc.net

# 搜索 URL 模板
A2_LIVEATC_SEARCH_URL=https://www.liveatc.net/search/?icao={icao}

# 电台标识符（逗号分隔）
A2_LIVEATC_MOUNT_IDS=vhhh5,vhhh_app,vhhh_gnd

# ICAO 代码
A2_ICAO_CODE=VHHH

# 历史下载配置
A2_HISTORICAL_INTERVAL_SECONDS=3600    # 每小时检查一次
A2_HISTORICAL_MAX_FILES_PER_RUN=10      # 每次最多下载 10 个文件

# 实时流配置
A2_REALTIME_INTERVAL_SECONDS=600       # 每 10 分钟捕获一次
A2_REALTIME_CAPTURE_SECONDS=600        # 每次捕获 10 分钟

# HTTP 配置
A2_HTTP_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64)...
A2_HTTP_COOKIE=cf_clearance=xxx        # 可选的 Cloudflare Cookie
A2_HTTP_MAX_RETRIES=3                  # 重试次数
A2_HTTP_BACKOFF_BASE_SECONDS=2         # 指数退避基数
A2_HTTP_BACKOFF_MAX_SECONDS=60         # 最大等待时间

# 存储配置
A2_AUDIO_STORAGE=./storage/audio
A2_CHUNK_SIZE=8192                     # 下载块大小
```

## 故障排除

### 问题 1: 下载失败，返回 403

**原因**: Cloudflare 保护

**解决方案**:

1. 获取 Cookie 并使用 `--cookie-file`
2. 确保已安装 `pip install cloudscraper`
3. 等待几分钟后重试

### 问题 2: 无法找到电台

**原因**: 电台标识符错误或机场代码错误

**解决方案**:

```bash
python main.py stations VHHH  # 列出所有可用电台
```

### 问题 3: 下载缓慢或超时

**原因**: 网络问题或服务器繁忙

**解决方案**:

1. 检查网络连接
2. 尝试较短的时间范围
3. 增加重试次数: `A2_HTTP_MAX_RETRIES=5`

### 问题 4: 数据库错误

**原因**: 数据库连接问题

**解决方案**:

1. 检查数据库是否运行
2. 验证数据库连接字符串
3. 检查 SQLAlchemy 日志

## 示例脚本

### 批量下载并处理

```python
#!/usr/bin/env python3
import subprocess
from datetime import datetime, timedelta

station = "vhhh5"
start_date = datetime(2024, 10, 25)
end_date = datetime(2024, 10, 28)

cmd = [
    "python", "main.py", "download-range", station,
    "--start-date", start_date.strftime("%Y-%m-%d"),
    "--end-date", end_date.strftime("%Y-%m-%d"),
    "-o", "./downloads",
    "--cookie-file", "./.local/liveatc_cookie.txt"
]

result = subprocess.run(cmd, cwd="./liveatc-downloader/")
print(f"Exit code: {result.returncode}")
```

### API 集成示例

```python
import httpx
import asyncio

async def start_historical_download():
    async with httpx.AsyncClient() as client:
        # 启动定时任务
        await client.post("http://localhost:8000/api/v1/ingestion/scheduler/start")
        
        # 获取状态
        response = await client.get("http://localhost:8000/api/v1/ingestion/scheduler/status")
        print(response.json())
        
        # 手动触发一次
        response = await client.post("http://localhost:8000/api/v1/ingestion/scheduler/trigger/historical")
        print(response.json())

asyncio.run(start_historical_download())
```

## 参考资源

- [LiveATC.net](https://www.liveatc.net)
- [BeautifulSoup 文档](https://www.crummy.com/software/BeautifulSoup/)
- [cloudscraper](https://github.com/VeNoMouS/cloudscraper)

## 许可证

MIT
