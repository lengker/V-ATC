# A-3 和 A-5 模块集成说明

本文档说明如何使用新增的A-3预处理模块和A-5数据库模块集成功能。

## A-3 集成功能

A-3集成服务处理语音预处理模块的协调工作：

说明：上游音频采集现在可以通过浏览器会话、storage_state 和代理池获得更稳定的输入文件。

### 1. 发起A-3处理请求

```bash
POST /api/v1/a3/request-processing
Header: X-A3-Token: <a3_callback_token>

{
  "voice_file_id": 1
}

Response (202 Accepted):
{
  "voice_file_id": 1,
  "status": 1,  # 0: not_started, 1: processing, 2: completed, 3: failed
  "file_name": "vhhh_20260428T120000Z.mp3",
  "start_time_utc": "2026-04-28T12:00:00+00:00",
  "end_time_utc": "2026-04-28T12:30:00+00:00",
  "message": "Processing request sent to A-3 module"
}
```

### 2. 查询A-3处理状态

```bash
GET /api/v1/a3/status/{voice_file_id}

Response (200 OK):
{
  "voice_file_id": 1,
  "file_name": "vhhh_20260428T120000Z.mp3",
  "a3_process_status": 2,
  "status_text": "completed",
  "segment_count": 5,
  "annotated_count": 2,
  "error_log": null,
  "updated_at": "2026-04-28T12:35:00+00:00"
}
```

### 3. 重试失败的A-3处理

```bash
POST /api/v1/a3/retry/{voice_file_id}
Header: X-A3-Token: <a3_callback_token>

{
  "voice_file_id": 1,
  "attempt": 0
}

Response (202 Accepted):
{
  "voice_file_id": 1,
  "attempt": 1,
  "delay_seconds": 2.5,
  "status": 1,
  "message": "Retry request submitted to A-3 module"
}
```

带指数退避和随机抖动的重试逻辑：

- 基础延迟：2秒
- 最大延迟：60秒
- 最多重试次数：5次
- 公式：delay = min(base * 2^attempt + random(0, base), max_wait)

### 4. 同步段落标注状态

```bash
POST /api/v1/a3/sync-annotations/{voice_file_id}

Response (200 OK):
{
  "voice_file_id": 1,
  "total_segments": 5,
  "ready_for_annotation": 3,
  "already_annotated": 2,
  "pending_asr": 0
}
```

### 5. 查看A-3处理队列

```bash
GET /api/v1/a3/queue?status_filter=1&limit=20

Response (200 OK):
{
  "queue_size": 3,
  "items": [
    {
      "voice_file_id": 1,
      "file_name": "vhhh_20260428T120000Z.mp3",
      "a3_process_status": 1,
      "status_text": "processing",
      "created_at": "2026-04-28T12:00:00+00:00"
    }
  ]
}
```

Status codes:

- 0: not_started
- 1: processing
- 2: completed
- 3: failed

---

## A-5 集成功能

A-5集成服务处理与数据库模块的协调工作：

### 1. 获取轨迹元数据

```bash
GET /api/v1/tracks/{track_id}/metadata

Response (200 OK):
{
  "track_id": 12345,
  "flight_number": "FLT12345",
  "aircraft_type": "B738",
  "callsign": "CATHAY",
  "departure": "VHHH",
  "arrival": "RJTT",
  "timestamp": "2026-04-28T12:35:00+00:00"
}
```

### 2. 获取用户/标注者元数据

```bash
GET /api/v1/users/{author_id}/metadata

Response (200 OK):
{
  "author_id": 999,
  "username": "annotator_999",
  "email": "user999@example.com",
  "role": "data_annotator",
  "active": true,
  "created_at": "2026-03-01T10:00:00+00:00"
}
```

### 3. 按轨迹ID查询音频

```bash
GET /api/v1/audio/by-track/{track_id}?limit=50

Response (200 OK):
{
  "track_id": 12345,
  "file_count": 3,
  "files": [
    {
      "voice_file_id": 1,
      "file_name": "vhhh_20260428T120000Z.mp3",
      "track_id": 12345,
      "start_time_utc": "2026-04-28T12:00:00+00:00",
      "end_time_utc": "2026-04-28T12:30:00+00:00",
      "file_size": 1024000,
      "segment_count": 5,
      "annotated_count": 2,
      "a3_process_status": 2,
      "source_url": "https://liveatc.net/..."
    }
  ]
}
```

### 4. 按标注者查询音频

```bash
GET /api/v1/audio/by-annotator/{author_id}?limit=50

Response (200 OK):
{
  "author_id": 999,
  "annotation_count": 10,
  "segments": [
    {
      "segment_id": 1,
      "voice_file_id": 1,
      "file_name": "vhhh_20260428T120000Z.mp3",
      "author_id": 999,
      "abs_start_time": "2026-04-28T12:05:00+00:00",
      "abs_end_time": "2026-04-28T12:10:00+00:00",
      "duration": 300.0,
      "asr_content": "Clear to land runway 25 left",
      "annotation_text": "Landing clearance",
      "is_annotated": true,
      "label_type": "clearance"
    }
  ]
}
```

### 5. 同步标注到A-5

```bash
POST /api/v1/a5/sync-annotations-to-a5/{voice_file_id}
Header: X-API-Token: <api_token>

Response (200 OK):
{
  "voice_file_id": 1,
  "total_segments": 5,
  "synced_count": 2,
  "message": "Synchronized 2 annotations to A-5 database",
  "timestamp": "2026-04-28T12:35:00+00:00"
}
```

### 6. 从A-5接收标注更新

```bash
POST /api/v1/a5/sync-annotations-from-a5/{voice_file_id}
Header: X-API-Token: <api_token>

{
  "voice_file_id": 1,
  "annotations": [
    {
      "segment_id": 1,
      "author_id": 999,
      "annotation_text": "Updated annotation from A-5",
      "label_type": "instruction"
    }
  ]
}

Response (200 OK):
{
  "voice_file_id": 1,
  "updated_count": 1,
  "message": "Applied 1 annotation updates from A-5",
  "timestamp": "2026-04-28T12:35:00+00:00"
}
```

### 7. 生成跨模块报告

```bash
GET /api/v1/a5/cross-module-report?start_time=2026-04-28T00:00:00Z&end_time=2026-04-28T23:59:59Z

Response (200 OK):
{
  "time_range": {
    "start": "2026-04-28T00:00:00+00:00",
    "end": "2026-04-28T23:59:59+00:00"
  },
  "file_count": 48,
  "processed_files": 42,
  "failed_files": 2,
  "total_segments": 156,
  "annotated_segments": 89,
  "annotation_rate": 57.05,
  "generated_at": "2026-04-28T12:35:00+00:00"
}
```

---

## 集成工作流示例

### 完整的处理流程

```text

1. 实时或历史音频注册到A-2
   ↓
2. A-2发起A-3处理请求
   POST /api/v1/a3/request-processing
   ↓
3. A-3处理音频，生成VAD和ASR结果
   ↓
4. A-3调用A-2的回调接口
   POST /api/v1/a3/callback (existing)
   ↓
5. A-2存储A-3结果到数据库
   ↓
6. A-2查询A-3处理状态
   GET /api/v1/a3/status/{voice_file_id}
   ↓
7. A-4前端通过A-2查询音频和标注
   GET /api/v1/audio/stream?start=...&end=...
   ↓
8. 用户完成标注
   ↓
9. A-2将标注同步到A-5
   POST /api/v1/a5/sync-annotations-to-a5/{voice_file_id}
   ↓
10. A-5存储标注数据

```

### 跨轨迹查询示例

```python
# 获取特定航班的所有音频
GET /api/v1/audio/by-track/12345

# 获取特定标注者的所有标注
GET /api/v1/audio/by-annotator/999

# 生成系统报告
GET /api/v1/a5/cross-module-report?start_time=...&end_time=...
```

---

## 配置和认证

在 `.env` 文件中设置：

```env
# A-3集成
A3_CALLBACK_TOKEN=your-secure-token-here
A3_SERVICE_BASE_URL=http://localhost:9000

# A-5集成
API_TOKEN=your-secure-api-token-here
A5_SERVICE_BASE_URL=http://localhost:8080
```

所有集成端点都需要相应的认证令牌（通过 `X-A3-Token` 或 `X-API-Token` 头传递）。

---

## 实现细节

### A-3集成服务类位置

- 主服务：[app/services/a3_integration_service.py](../app/services/a3_integration_service.py)
- 路由定义：[app/api/routes/a3_integration.py](../app/api/routes/a3_integration.py)
- Schema定义：[app/schemas/a3_integration.py](../app/schemas/a3_integration.py)

### A-5集成服务类位置

- 主服务：[app/services/a5_integration_service.py](../app/services/a5_integration_service.py)
- 路由定义：[app/api/routes/a5_integration.py](../app/api/routes/a5_integration.py)
- Schema定义：[app/schemas/a5_integration.py](../app/schemas/a5_integration.py)

### 数据库模型

- VoiceFile 模型已包含 track_id 和 duration_ms 字段
- VoiceSegment 模型已包含 author_id、label_type、annotation_text 字段

### 依赖项

- 所有集成功能都基于现有的SQLAlchemy ORM和FastAPI框架
- 无需额外的第三方依赖

---

## 测试覆盖

完整的测试套件包含：

### A-3集成测试

- test_a3_request_processing - 发起处理请求
- test_a3_get_processing_status - 查询处理状态
- test_a3_retry_processing - 重试失败的处理
- test_a3_sync_annotation_status - 同步标注状态

### A-5集成测试

- test_a5_list_audio_by_track - 按轨迹查询
- test_a5_list_audio_by_annotator - 按标注者查询
- test_a5_sync_annotations_to_a5 - 同步到A-5
- test_a5_sync_annotations_from_a5 - 从A-5接收更新
- test_a5_cross_module_report - 生成系统报告

运行测试：

```bash
pytest tests/test_a3_a5_integration.py -v
```

---

## 需求映射

本集成实现了以下系统需求：

- RQ-A-3-10：发起A-3预处理请求
- RQ-A-3-30：查询处理状态
- RQ-A-3-40：实现重试机制
- RQ-A-5-40：用户管理API接口
- RQ-A-5-50：管理各模块间的API接口

所有功能都遵循异步非阻塞设计，符合512MB内存限制的需求。
"""
