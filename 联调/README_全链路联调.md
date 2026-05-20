# A1 / A2 / A3 / A5 / 前端 全链路联调说明

## 1. 模块与端口（避免 8000 冲突）

| 模块 | 目录 | 默认端口 | 说明 |
|------|------|----------|------|
| **A5 数据库** | `backend/` | **8000** | 前端唯一数据源：`/tables/*`、`/users/*` |
| **A2 语音采集** | `联调/ATC-VA-A2/` | **8001** | `/api/v1/ingestion/*`、`/api/v1/audio/*`、A3/A5 集成 |
| **A3 语音预处理** | `联调/a3_speech_processing_6/` | **9002** | `/api/v1/process`（ASR/VAD） |
| **A1 ADSB 演示页** | `联调/ATC-ADSB-Receiver/` | — | 静态页 + `adsb-receiver.js`（见下文兼容说明） |
| **前端标注** | `front/` | **3000** | `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000` |

数据流（目标形态）：

```text
A1 航迹 → LNG_TRACKS (A5)
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

## 3. 数据准备（前端能看到 A2 录音）

A2 数据在 `ATC-VA-A2/a2_voice.db`，**不会自动出现在前端**，需同步到 A5：

```powershell
python 联调/sync_a2_to_a5.py
```

可选：写入示例航迹（供地图/列表）：

```powershell
python 联调/seed_a1_tracks_to_a5.py
```

然后刷新 http://localhost:3000 。

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

## 6. 验收清单

- [ ] `http://127.0.0.1:8000/health` → `{"ok":true}`
- [ ] `http://127.0.0.1:8001/health` → A2 正常
- [ ] `http://127.0.0.1:9002/` → A3 running
- [ ] `http://localhost:3000` 可打开，登录后能看到录音列表
- [ ] 执行 `sync_a2_to_a5.py` 后列表含 A2 同步条目
- [ ] 地图上有航迹点（执行 `seed_a1_tracks_to_a5.py` 或库内已有 tracks）
