# A1 / A2 / A3 / A5 / 前端 全链路联调说明

## 1. 模块与端口（避免 8000 冲突）

| 模块 | 目录 | 默认端口 | 说明 |
|------|------|----------|------|
| **A5 数据库** | `backend/` | **8000** | 前端唯一数据源：`/tables/*`、`/users/*` |
| **A2 语音采集** | `联调/ATC-VA-A2/` | **8001** | `/api/v1/ingestion/*`、`/api/v1/audio/*`、A3/A5 集成 |
| **A3 语音预处理** | `联调/a3_speech_processing_6/` | **9002** | `/api/v1/process`（ASR/VAD） |
| **A1 ADSB 实时采集** | `联调/a1_live_collector.py` | — | OpenSky 香港 bbox → A1 `LNG_TRACKS` → `sync_a1_db_to_a5`；`start-all.ps1` 自动启动 |
| **A1 说明页** | `联调/ATC-ADSB-Receiver/` | — | 静态说明（采集请用 Python 脚本） |
| **前端标注** | `front/` | **3000** | `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000` |

数据流（目标形态）：

```text
A1 航迹（OpenSky 实时 / 历史库）→ sync → LNG_TRACKS (A5) → 前端地图每 10s 刷新
A2 录音 → voice_files (A2) ──sync──► LNG_AUDIO_RECORDS (A5) ──► 前端列表/波形
A2 ──请求──► A3 识别 ──回调/同步──► LNG_ANNOTATIONS (A5) ──► 前端标注
```

## 2. 一键启动

```powershell
Set-Location "e:\软件项目管理\qt\联调"
.\start-all.ps1
```

健康检查：

```powershell
.\health-check.ps1
```

## 3. 数据准备（直接调用三模块数据库）

前端只读 **A5**（`backend/data.sqlite3`）。三模块各自库文件：

| 模块 | 数据库文件 |
|------|------------|
| A1 ADSB | `联调/ATC-ADSB-Receiver/backend/backend/app/data.sqlite3` |
| A2 语音 | `联调/ATC-VA-A2/a2_voice.db` |
| A3 ASR | `联调/a3_speech_processing_6/backend/data.sqlite3` |

**一键导入到 A5**（推荐，需 A5 :8000 已启动）：

```powershell
cd 联调
python sync_all_to_a5.py
```

或分步：

```powershell
python sync_a1_db_to_a5.py   # A1 → LNG_TRACKS（约 3343 条航迹）
python sync_a2_to_a5.py        # A2 → LNG_AUDIO_RECORDS
python sync_a3_db_to_a5.py     # A3 → 录音 + ASR 标注（真实识别文本）
```

然后刷新 http://localhost:3000 。

### 3.1 前端「文本 / Transcriptions」从哪来？

前端**不读 A2/A3 库**，只读 A5 的 `LNG_ANNOTATIONS`（字段 `annotation_text` / `asr_content`，按 `audio_id` 关联）。

| 现象 | 原因 |
|------|------|
| 有录音、无文字 | 只同步了 `audio_records`，未写入 `annotations` |
| 只有一条测试字 | 库内仅 `audio_id=1` 有旧测试标注，与 A2 同步的 `audio_id=9/10` 无关 |

**联调演示标注**（秒级时间轴，非真实 ASR）：

```powershell
python 联调/seed_demo_annotations_to_a5.py
```

真实文本需走 **A3 识别 → A2 `sync-annotations-to-a5` → A5**（见 §4）。

## 4. A3 联调（可选，需模型与耗时）

1. 确保 A3 已启动（9002），A2 `.env` 中 `A3_SERVICE_BASE_URL=http://127.0.0.1:9002`
2. 对某条 A2 录音：`POST http://127.0.0.1:8001/api/v1/a3/request-processing`（Header: `X-A3-Token`，与 A2 配置一致）
3. 将 mp3 提交 A3：`POST http://127.0.0.1:9002/api/v1/process`（multipart 上传）
4. 同步标注到 A5：`POST http://127.0.0.1:8001/api/v1/a5/sync-annotations-to-a5/{voice_file_id}`（Header: `X-Api-Token`）

> A2 当前 `request-processing` 多为状态标记；完整闭环需 A3 实现与 A2 的 HTTP 回调对接（见 `ATC-VA-A2/A3_A5_INTEGRATION.md`）。

## 5. A1 兼容说明

`ATC-ADSB-Receiver/adsb-receiver.js` 调用 `POST /query` 传原始 SQL，**与当前 A5 的 `POST /query/arbitrary` 不兼容**。联调航迹数据请用：

- 本仓库 `seed_a1_tracks_to_a5.py` 写入 `LNG_TRACKS`，或
- A1 后端若单独起在 8000，会与 A5 **端口冲突**，不要与 `backend` 同时占用 8000。

## 6. 真实数据一键联调（A2 Cloudflare 已绕过后）

```powershell
cd 联调
# 1) 先 start-all.ps1 或单独起 A5 + A2(:8001)
# 2) 配置 联调/ATC-VA-A2/.env（从 .env.example 复制，填写 Cookie 或启用浏览器归档流）
.\bootstrap_realdata.ps1
```

脚本会：触发 `POST :8001/.../trigger/historical` 下载真实 mp3 → `sync_all_to_a5.py` → 校验 `:8001/media` 可访问。

**A2 必须挂载 `/media`**（`app/main.py` 已配置），`source_url` 形如 `http://127.0.0.1:8001/media/historical/YYYYMMDD/xxx.mp3`。

**LiveATC 真实 mp3（你已绕过 Cloudflare）**：在 `联调/ATC-VA-A2/.env` 中配置 `A2_HTTP_COOKIE` 或 `A2_PLAYWRIGHT_STORAGE_STATE_FILE`，然后：

```powershell
POST http://127.0.0.1:8001/api/v1/ingestion/scheduler/trigger/historical
# 或 liveatc-downloader: python vhhh_multimethod_download.py --cookie-file .local/liveatc_cookie.txt
python 联调/import_liveatc_downloads_to_a2.py
python 联调/sync_a2_to_a5.py
```

当前环境若无 Cookie，可先使用 `python 联调/seed_a2_real_files.py` 导入 **A3 真实 wav**（en/yue/zh）完成播放联调。

## 7. 验收清单

- [ ] `http://127.0.0.1:8000/health` → `{"ok":true}`
- [ ] `http://127.0.0.1:8001/health` → A2 正常
- [ ] `http://127.0.0.1:9002/` → A3 running
- [ ] `http://localhost:3000` 可打开，登录后能看到录音列表
- [ ] 执行 `sync_a2_to_a5.py` 后列表含 A2 同步条目
- [ ] 地图上有航迹点（执行 `seed_a1_tracks_to_a5.py` 或库内已有 tracks）
