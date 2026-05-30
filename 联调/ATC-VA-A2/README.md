# ATC-VA A-2 Voice Processing Service

本项目是课程实践中的 A-2 语音数据采集与管理服务，基于 Python + FastAPI 实现。当前主要目标是从 LiveATC 获取香港机场 VHHH 的实时语音流和历史归档语音，并把文件元数据写入 SQLite 数据库，供后续 A-3 处理流程、A-5 数据模块和前端查询使用。

## 功能概览

- 实时/历史采集登记接口：`/api/v1/ingestion/*`。
- LiveATC 实时语音采集：解析或兜底定位实时流地址，按配置时长保存 mp3 片段。
- LiveATC 历史归档采集：按 LiveATC 归档命名规则生成候选文件，并下载成功的 mp3。
- 低频调度：默认实时每 30 分钟检查一次，历史每 1 小时检查一次。
- 人工行为模拟：每轮访问前加入随机等待，调度间隔加入随机抖动，历史文件之间加入随机间隔。
- 数据管理：语音文件落盘，元数据写入 `voice_files` 表。
- 音频查询/流式播放：`/api/v1/audio/*`。
- 存储容量检测与 LRU 清理：`/api/v1/admin/cleanup`。
- A-3 集成：处理请求、状态查询、失败重试、标注同步。
- A-5 集成：轨迹查询、标注者查询、标注同步、跨模块报告。

## 架构概览

- `app/api`：对外 HTTP 接口，负责接收采集、查询、调度控制请求。
- `app/services/ingestion_scheduler.py`：调度主入口，串联实时采集、历史归档、保存和重试逻辑。
- `app/services/liveatc_client.py`：LiveATC 解析与下载核心，负责页面解析、候选归档推导、浏览器上下文取流、Cookie 处理和回退。
- `app/services/storage_service.py`：磁盘空间检查、容量控制和清理。
- `app/services/ingestion_service.py`：把音频字节写入磁盘并登记数据库元数据。
- `data/audio/`：真实音频落盘目录，按 realtime / historical 和日期分层。

## 当前实现

当前仓库对 LiveATC 下载已经补充了多条回退路径，按优先级大致如下：

- 直接 HTTP 请求，适合未触发 Cloudflare 保护的场景。
- cloudscraper 和浏览器头部对齐，作为传统绕过方式的补充。
- Playwright 持久化 profile 或 storage_state，优先使用真实浏览器会话。
- 浏览器辅助导出 Cookie，允许在真实浏览器中手工完成验证后保存会话。
- 浏览器鼠标和键盘模拟脚本，尝试更接近人工操作流程。
- CloakBrowser 官方入口：安装 `cloakbrowser` 后会自动下载 stealth Chromium，A2 直接使用；仅在需要本地 binary 或下载失败时设置 `CLOAKBROWSER_BINARY_PATH`。

当前历史归档的主路径已经切换为浏览器优先：

- 先打开 `archive.php?m=...`。
- 使用隐藏字段 `#archiveDate` 提交 `date=YYYYMMDD`，并同步 `#archiveDateDisplay` 的 flatpickr 显示值。
- 严格选择 `select[name='time']` 中实际存在的半小时档位。
- 跳转到签名 mp3 后，在同一浏览器上下文里用 `fetch(...).arrayBuffer()` 取回字节，再写入本地音频目录。

如果目标时间不在下拉框里，当前实现会直接跳过该候选，不会静默退回到第一项。

Playwright request context 下载仍保留为回退，代理池也仍然保留，但都不是默认主路径。

## IP 池和代理配置

仓库已经保留了代理池能力，主要配置来自 `app/core/config.py` 和 `app/services/proxy_provider.py`。当前可用的配置项包括：

- `a2_proxy_enabled`：是否启用代理池。
- `a2_proxy_source`：代理来源，支持 `static`、`api`、`mixed`。
- `a2_proxy_mode`：代理选择方式，支持轮询和随机。
- `a2_proxy_file`：静态代理文件路径，默认指向 `./liveatc-downloader/proxy_pool.txt`。
- `a2_proxy_api_enabled`：是否启用代理 API 获取。
- `a2_proxy_api_url`：代理 API 地址。
- `a2_proxy_api_protocol`、`a2_proxy_api_country_code`、`a2_proxy_api_count`：代理 API 过滤条件。

代理当前是显式回退，不建议作为首选路径。默认策略仍是先尝试低频、低并发的直连和浏览器上下文下载，代理只在直连失败或环境确实需要时再启用。

## 浏览器下载与本机配置

为了让浏览器回退真正可用，下面这些本机配置会直接影响成功率：

- CloakBrowser 已安装（`pip install cloakbrowser`），首次使用会自动下载 binary。
- 如需自定义本地 binary 或下载失败，可设置 `CLOAKBROWSER_BINARY_PATH`。
- 若使用浏览器辅助导出 Cookie（Playwright/系统 Chrome），确保目标 profile 未被占用。
- Playwright 仅用于辅助脚本；CloakBrowser 本身不需要 `playwright install chromium`。
- 本机时间、时区和网络连通性。
- 是否有扩展、企业策略或防火墙影响 Cloudflare 页面。

历史归档页面现在是 headed 浏览器优先，因此在服务器或本机上运行时，建议保留可见浏览器上下文，至少在首次验证时不要强制无头模式。相关脚本已经增加了 profile clone、storage_state 导出和模拟鼠标键盘的辅助路径，便于把人工验证后的浏览器状态保存下来继续使用。若启用 CloakBrowser，保持官方默认即可，避免额外的二进制探测逻辑。

- `a2_browser_headless`：浏览器是否无头运行，默认 `true`。

## 安装与启动

```bash
pip install -r requirements.txt
python run.py
```

启动后访问：

```text
http://127.0.0.1:8000/docs
```

如果需要自定义配置，建议在项目根目录创建 `.env`。`.env` 已被 `.gitignore` 忽略，不要提交 Cookie、Token 或本地路径。

## LiveATC 反爬策略

LiveATC 和 `archive.liveatc.net` 可能返回 Cloudflare 403 或挑战页。项目不要使用多线程高频爬取，当前调度器默认采用低频访问：

| 配置项 | 默认值 | 说明 |
| --- | ---: | --- |
| `A2_REALTIME_INTERVAL_SECONDS` | `1800` | 实时采集间隔，30 分钟 |
| `A2_HISTORICAL_INTERVAL_SECONDS` | `3600` | 历史采集间隔，1 小时 |
| `A2_SCHEDULER_INTERVAL_JITTER_SECONDS` | `300` | 每轮间隔随机抖动，正负 5 分钟 |
| `A2_LIVEATC_HUMAN_DELAY_MIN_SECONDS` | `5` | 每次访问前最短随机等待 |
| `A2_LIVEATC_HUMAN_DELAY_MAX_SECONDS` | `45` | 每次访问前最长随机等待 |
| `A2_LIVEATC_DOWNLOAD_GAP_MIN_SECONDS` | `3` | 历史文件之间最短等待 |
| `A2_LIVEATC_DOWNLOAD_GAP_MAX_SECONDS` | `20` | 历史文件之间最长等待 |

历史归档仍然可能遇到 403，但当前实现会优先使用浏览器上下文内的页面跳转和流式取流，不再依赖单独把签名 URL 丢给普通 HTTP 客户端。Cookie 配置仍然保留作为兜底选项：

```powershell
$env:A2_HTTP_COOKIE="你的 Cookie 字符串"
python run.py
```

也可以写入 `.env`：

```env
A2_HTTP_COOKIE=你的 Cookie 字符串
```

Cookie 属于本地敏感信息，不要提交到 Git。

## 关键配置

```env
DB_URL=sqlite+aiosqlite:///./a2_voice.db
A2_ICAO_CODE=VHHH
A2_AUDIO_STORAGE=./data/audio
A2_LIVEATC_MOUNT_IDS=vhhh5
A2_LIVEATC_ARCHIVE_FILE_PREFIXES=VHHH5-App-Dep-Dir-Zone
A2_HISTORICAL_CANDIDATE_SLOTS=8
A2_HISTORICAL_MAX_FILES_PER_RUN=5
A2_REALTIME_CAPTURE_SECONDS=60
A2_REALTIME_CAPTURE_MAX_BYTES=2097152
```

- `A2_LIVEATC_MOUNT_IDS` 是 LiveATC 的频道 mount id，香港机场当前默认使用 `vhhh5`。
- `A2_LIVEATC_ARCHIVE_FILE_PREFIXES` 用于历史归档兜底拼接，例如生成 `VHHH5-App-Dep-Dir-Zone-May-11-2026-0330Z.mp3`。
- `A2_HISTORICAL_CANDIDATE_SLOTS` 表示从最近已完成的半小时归档开始，向前尝试多少个半小时文件。

## 数据存储方式

默认语音文件目录：

```text
data/audio/
```

实时采集文件：

```text
data/audio/realtime/YYYYMMDD/vhhh_YYYYMMDDTHHMMSSZ.mp3
```

历史归档文件：

```text
data/audio/historical/YYYYMMDD/VHHH5-App-Dep-Dir-Zone-Mon-DD-YYYY-HHMMZ.mp3
```

示例文件：

```text
data/audio/historical/20260526/VHHH5-App-Dep-Dir-Zone-May-26-2026-1130Z.mp3
```

数据库默认文件：

```text
a2_voice.db
```

每个成功保存的语音文件会在 `voice_files` 表中登记 `file_name`、`file_path`、`icao_code`、`start_time_utc`、`end_time_utc`、`file_size`、`source_url`、`status`、`duration_ms` 和 `a3_process_status`。

`data/`、`*.db`、`.env` 和本地 Cookie 目录都已加入 `.gitignore`，所以你在 Git 里看不到下载文件是正常的，但它们会保留在本地磁盘上。

## 调度 API

```text
POST /api/v1/ingestion/scheduler/start
POST /api/v1/ingestion/scheduler/stop
GET  /api/v1/ingestion/scheduler/status
POST /api/v1/ingestion/scheduler/trigger/realtime
POST /api/v1/ingestion/scheduler/trigger/historical
```

`status` 中和 LiveATC 相关的字段：

- `last_realtime_at`：最近一次实时采集成功时间。
- `last_historical_at`：最近一次历史检查完成时间。
- `last_historical_found`：本轮找到或生成的历史候选数量。
- `last_historical_downloaded`：本轮成功下载数量。
- `last_historical_failed`：本轮下载失败数量。
- `last_historical_first_failed_status`：首个失败 HTTP 状态码，例如 `403`。
- `last_cookie_warmup_ok` / `last_cookie_count`：预热会话 Cookie 的结果。

## A-3 和 A-5 模块集成

更完整的对接、部署、数据库和 API 说明请见 [MODULE_INTEGRATION_DEPLOYMENT.md](MODULE_INTEGRATION_DEPLOYMENT.md)。

A-2 模块支持与 A-3 预处理模块和 A-5 数据库模块集成。

A-3 集成接口：

- `POST /api/v1/a3/request-processing`：发起处理请求。
- `GET /api/v1/a3/status/{voice_file_id}`：查询处理状态。
- `POST /api/v1/a3/retry/{voice_file_id}`：重试失败的处理。
- `POST /api/v1/a3/sync-annotations/{voice_file_id}`：同步标注状态。
- `GET /api/v1/a3/queue`：查看处理队列。

A-5 集成接口：

- `GET /api/v1/tracks/{track_id}/metadata`：获取轨迹元数据。
- `GET /api/v1/users/{author_id}/metadata`：获取用户元数据。
- `GET /api/v1/audio/by-track/{track_id}`：按轨迹查询音频。
- `GET /api/v1/audio/by-annotator/{author_id}`：按标注者查询音频。
- `POST /api/v1/a5/sync-annotations-to-a5/{voice_file_id}`：同步标注到 A-5。
- `POST /api/v1/a5/sync-annotations-from-a5/{voice_file_id}`：从 A-5 接收更新。
- `GET /api/v1/a5/cross-module-report`：生成系统报告。

## 手动验证下载

为了避免高频访问，真实网络验证时建议临时缩短采集时长，并限制历史文件数量：

```powershell
$env:A2_AUTO_START_SCHEDULER="false"
$env:A2_AUDIO_STORAGE="data/liveatc_verification/audio"
$env:DB_URL="sqlite+aiosqlite:///./data/liveatc_verification/a2_verify.db"
$env:A2_REALTIME_CAPTURE_SECONDS="5"
$env:A2_REALTIME_CAPTURE_MAX_BYTES="65536"
$env:A2_HISTORICAL_MAX_FILES_PER_RUN="1"
python run.py
```

然后在 Swagger 或 HTTP 客户端中调用：

```text
POST http://127.0.0.1:8000/api/v1/ingestion/scheduler/trigger/realtime
POST http://127.0.0.1:8000/api/v1/ingestion/scheduler/trigger/historical
GET  http://127.0.0.1:8000/api/v1/ingestion/scheduler/status
```

本次实测结果：

- 实时下载成功，生成 `data/liveatc_verification/audio/realtime/20260511/vhhh_20260511T042548Z.mp3`。
- 历史下载已通过浏览器上下文成功落盘，示例文件：`data/audio/historical/20260526/VHHH5-App-Dep-Dir-Zone-May-26-2026-1130Z.mp3`，文件大小 7,664,520 字节。
- 另外也验证过 `2026/5/25 12:00-12:30` 对应的历史音频可正常下载，说明当前归档链路能稳定处理具体半小时档位。

## 部署说明

当前模块已经可以满足课程 A-2 的历史/实时采集主流程，但直接部署到服务器前仍建议确认这些前提：

- 服务器允许一个真实浏览器上下文运行，或能提供与当前 CloakBrowser 配置兼容的 headed 环境。
- `data/`、数据库文件和本地浏览器 profile 目录都使用持久化磁盘，而不是临时目录。
- 如果服务器网络环境更严格，仍然可能需要配置代理、Cookie 或本地浏览器 profile。
- 先做一次 `POST /api/v1/ingestion/scheduler/trigger/historical` 的冒烟测试，再切换到自动调度。

推荐的服务器部署检查顺序是：

1. 确认 `.env` 中的 `DB_URL`、`A2_AUDIO_STORAGE`、`A2_ICAO_CODE` 和浏览器相关配置正确。
2. 先手动调用一次历史触发接口，确认能在 `data/audio/historical/YYYYMMDD/` 下看到真实 mp3。
3. 再启动自动调度，观察 `GET /api/v1/ingestion/scheduler/status` 的 `last_historical_downloaded` 和 `last_error`。

## 独立下载脚本

项目保留了 `liveatc-downloader/` 作为独立脚本，可用于人工验证 station 和历史归档下载：

```bash
cd liveatc-downloader
python main.py stations VHHH --cookie-file ./.local/liveatc_cookie.txt
python main.py download vhhh5 -o ./downloads --cookie-file ./.local/liveatc_cookie.txt
python main.py cookie --output ./.local/liveatc_cookie.txt
```

其中 `liveatc-downloader/.local/` 已被忽略，可用于保存本地 Cookie 文件。

## 测试

测试说明已集中到 [tests/README.md](tests/README.md)。

日常回归优先执行测试目录中的离线单元/集成测试，长稳、网络和 e2e 相关测试默认跳过。

常规测试入口：

```bash
pytest tests/ -v -m "not network and not e2e and not longrun"
```

## GitHub 分支保护

仓库已经补了 main 的审核约束配置：

- [.github/CODEOWNERS](.github/CODEOWNERS) 会把全仓库默认指派给 `@Relentless-Machine`。
- [.github/workflows/require-main-owner-review.yml](.github/workflows/require-main-owner-review.yml) 会在 PR 目标分支为 `main` 时检查是否已有你的批准。

## ATC 音频来源与多源支持

本项目支持多个 ATC 音频存档来源。推荐优先级和集成指南详见：

- [ATC_SOURCES_RESEARCH.md](ATC_SOURCES_RESEARCH.md)（来源研究、合规指南）
- [ARCHIVE_ADAPTER_GUIDE.md](ARCHIVE_ADAPTER_GUIDE.md)（适配器框架、配置示例）
- [app/services/archive_adapter.py](app/services/archive_adapter.py)（适配器接口定义）

**当前支持的来源**：

- LiveATC（主要，需 Cookie）
- Broadcastify（推荐，需官方 API）
- 本地镜像（可配置）
- 直接录制（SDR，待研究）

## 后续任务

- [ ] 接入 A-1 航迹数据实时同步，自动匹配 `track_id`。
- [ ] A-4 前端界面对接，支持音频流播放、轨迹展示和标注编辑。
- [ ] 实现 Broadcastify 官方 API 适配器（推荐优先）。
- [ ] 支持适配器链式回退（多源尝试）。
