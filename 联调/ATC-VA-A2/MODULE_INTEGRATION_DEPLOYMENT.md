# A-2 对接与部署说明

本文档给 A-3、A-4、A-5 以及部署方使用，集中说明 A-2 的职责、数据库、接口、运行约束和服务器部署前提。

## 1. 模块职责

A-2 是语音采集与落盘模块，负责从 LiveATC 获取实时语音和历史归档语音，写入本地磁盘并登记数据库元数据。上游模块可以把它当作“音频来源服务”，下游模块可以把它当作“音频文件索引服务”。

## 2. 目录与数据结构

默认音频目录：

```text
data/audio/
```

实时音频：

```text
data/audio/realtime/YYYYMMDD/vhhh_YYYYMMDDTHHMMSSZ.mp3
```

历史音频：

```text
data/audio/historical/YYYYMMDD/VHHH5-App-Dep-Dir-Zone-Mon-DD-YYYY-HHMMZ.mp3
```

历史音频示例：

```text
data/audio/historical/20260525/VHHH5-App-Dep-Dir-Zone-May-25-2026-1200Z.mp3
```

数据库默认文件：

```text
a2_voice.db
```

每个成功保存的音频文件都会在 `voice_files` 表中登记：

- `file_name`
- `file_path`
- `icao_code`
- `start_time_utc`
- `end_time_utc`
- `file_size`
- `source_url`
- `status`
- `duration_ms`
- `a3_process_status`

## 3. 环境变量

核心配置示例：

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

浏览器与反爬相关配置：

- `A2_LIVEATC_BROWSER_ARCHIVE_FLOW_ENABLED`：启用浏览器归档流。
- `A2_LIVEATC_BROWSER_FLOW_TIMEOUT_SECONDS`：浏览器归档流超时。
- `A2_BROWSER_HEADLESS`：是否无头运行。
- `A2_PLAYWRIGHT_USER_DATA_DIR`：持久化 profile 目录。
- `A2_PLAYWRIGHT_STORAGE_STATE_FILE`：可选的 storage state 文件。
- `A2_HTTP_COOKIE` / `A2_HTTP_COOKIE_FILE`：HTTP Cookie 兜底。
- `CLOAKBROWSER_BINARY_PATH`：自定义 CloakBrowser binary。

代理相关配置仍然可用，但不是默认主路径。

## 4. 调度与 API

调度 API：

```text
POST /api/v1/ingestion/scheduler/start
POST /api/v1/ingestion/scheduler/stop
GET  /api/v1/ingestion/scheduler/status
POST /api/v1/ingestion/scheduler/trigger/realtime
POST /api/v1/ingestion/scheduler/trigger/historical
```

`status` 里和采集相关的字段：

- `last_realtime_at`
- `last_historical_at`
- `last_historical_found`
- `last_historical_downloaded`
- `last_historical_failed`
- `last_historical_first_failed_status`
- `last_cookie_warmup_ok`
- `last_cookie_count`

其他模块常用接口：

### A-3

```text
POST /api/v1/a3/request-processing
GET  /api/v1/a3/status/{voice_file_id}
POST /api/v1/a3/retry/{voice_file_id}
POST /api/v1/a3/sync-annotations/{voice_file_id}
GET  /api/v1/a3/queue
```

### A-5

```text
GET  /api/v1/tracks/{track_id}/metadata
GET  /api/v1/users/{author_id}/metadata
GET  /api/v1/audio/by-track/{track_id}
GET  /api/v1/audio/by-annotator/{author_id}
POST /api/v1/a5/sync-annotations-to-a5/{voice_file_id}
POST /api/v1/a5/sync-annotations-from-a5/{voice_file_id}
GET  /api/v1/a5/cross-module-report
```

## 5. 下载策略

当前历史归档的主路径是浏览器优先：

1. 打开 `archive.php?m=...`。
2. 通过 `#archiveDateDisplay` / `#archiveDate` 设置 UTC 日期。
3. 严格选择 `select[name='time']` 中存在的半小时档位。
4. 跳转到签名 mp3 后，在同一浏览器上下文里用 `fetch(...).arrayBuffer()` 取回字节。
5. 将字节写入本地 `data/audio/historical/YYYYMMDD/`。

如果目标时间不存在于下拉框中，当前实现会直接放弃该候选，不会退回到第一项。

## 6. 服务器部署

### 6.1 推荐前提

- 服务器可以运行一个真正的浏览器上下文。
- `data/`、数据库文件和 profile 目录都使用持久化磁盘。
- 如果服务器是 Linux，优先准备 headed 浏览器运行环境或 Xvfb。
- 如果服务器是 Windows 服务，优先使用“交互式会话”或改为计划任务/普通进程，而不是严格后台服务。

### 6.2 有头浏览器怎么办

历史归档页面当前依赖 headed 浏览器上下文，部署时可以按下面几种方式处理：

1. **Windows 服务器**：用普通桌面会话启动 `python run.py`，或者用任务计划在用户登录后启动。
2. **Linux 服务器**：用 Xvfb / xvfb-run 提供显示环境，再启动服务进程。
3. **容器部署**：只有在容器里已经准备好图形环境、Chromium 依赖和持久化 profile 时才建议使用。

如果你无法提供 headed 环境，可以把历史归档任务单独放到可交互的 worker 机器上，API 服务器只提供查询和调度入口。

### 6.3 部署顺序

1. 配好 `.env`。
2. 确认 `data/audio/` 和数据库文件目录可写。
3. 先手动调用一次历史触发接口，确认能落盘真实 mp3。
4. 再开启自动调度。
5. 检查 `GET /api/v1/ingestion/scheduler/status` 的 `last_error`、`last_historical_downloaded`。

### 6.4 常见问题

- 403：优先检查浏览器 profile、Cookie 和 headed 环境。
- 文件不落盘：优先检查 `A2_AUDIO_STORAGE` 和磁盘权限。
- 只拿到链接：说明浏览器上下文没有完成最终 fetch，应检查 challenge、时间选择和页面是否真的提交成功。

## 7. 与其他模块的建议约定

- A-3 / A-5 不要直接依赖 LiveATC 页面结构，只依赖 A-2 的数据库和 API。
- 上游模块如果要做联调，优先通过 `/api/v1/ingestion/scheduler/trigger/historical` 和 `/api/v1/ingestion/scheduler/status` 验证音频是否可用。
- 下游模块如果只关心音频索引，应只读 `voice_files` 和相关查询 API，不要读取浏览器 profile 或 Cookie。
