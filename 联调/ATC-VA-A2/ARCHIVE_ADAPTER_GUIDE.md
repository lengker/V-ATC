# A-2 模块集成指南：多源 ATC 音频存档支持

## 概述

本文档说明 A-2 模块如何支持多个 ATC 音频存档源，包括 LiveATC.net（主要）、Broadcastify（官方 API）、本地镜像等。

## 推荐的使用优先级

| 优先级 | 来源 | 状态 | 说明 |
| -------- | ------ | ------ | ------ |
| [1] | Broadcastify 官方 API | [NOTE] 待实现 | **最推荐**：完全合规，需高级订阅 + API 密钥 |
| [2] | LiveATC + 手工 Cookie | [OK] 已实现 | 目前的主要方案；需检查 ToS 合规性 |
| [3] | 本地镜像 | [WARN]️ 部分支持 | 自建缓存，需配置基 URL |
| [4] | 直接录制（SDR） | [NOTE] 待研究 | 第一方内容，最私密 |

## 架构

```text
+-----------------------------------------+
|  ingestion_scheduler.py                 |
|  (主调度循环)                           |
+-----------------------------------------+
             |
             v
    +--------------------+
    | ArchiveAdapterFactory|
    | (适配器工厂)        |
    +--------------------+
             |
      +-----------------------------------+
      v             v          v          v
  LiveATCAdapter Broadcastify LocalMirror ...
  (现有)          Adapter     Adapter
                  (新增)      (配置)
```

## 当前实现状态

### LiveATCAdapter（已有）

**位置**: `app/services/liveatc_client.py`

**特点**:

- [OK] 已实现核心下载逻辑
- [OK] Cookie 和 cloudscraper 回退
- [WARN]️ **需检查官方 ToS 合规性**

### 辅助能力

仓库里已经具备下面这些面向 LiveATC 的辅助能力：

- 浏览器辅助 Cookie 导出。
- Playwright 持久化 profile 和 storage_state。
- 模拟鼠标和键盘的浏览器访问脚本。
- Playwright request context 下载回退。
- 代理池和静态代理文件支持。

这些能力并不改变适配器分层，只是让 LiveATC 这一侧更容易复用真实浏览器状态和网络环境。

**使用**:

```python
from app.services.liveatc_client import LiveATCHTTPClient

client = LiveATCHTTPClient()
# 配置通过 .env: A2_HTTP_COOKIE 或 A2_HTTP_COOKIE_FILE
```

### 新增框架（待实现）

**位置**: `app/services/archive_adapter.py`（新）

**接口**:

```python
class ArchiveAdapter(ABC):
    async def authenticate(credentials) -> bool: ...
    async def probe_availability() -> bool: ...
    async def list_archives(icao, start, end) -> List[ArchiveLink]: ...
    async def download(link, output_path) -> Tuple[bool, Optional[str]]: ...
```

## 配置示例

### .env 配置

```bash
# 选择优先适配器列表（逗号分隔，从高到低）
A2_ARCHIVE_ADAPTERS=liveatc,broadcastify,local_mirror

# LiveATC 配置（现有）
A2_HTTP_COOKIE_FILE=./.local/liveatc_cookie.txt
A2_LIVEATC_ARCHIVE_BASE_URLS=https://archive.liveatc.net

# Broadcastify 配置（新）
A2_BROADCASTIFY_API_KEY=your-api-key-here
A2_BROADCASTIFY_API_SECRET=

# 本地镜像配置
A2_LOCAL_MIRROR_BASE_URL=https://your-mirror.example.com
```

### Python 使用示例

```python
# 工厂模式创建适配器
from app.services.archive_adapter import ArchiveAdapterFactory

factory = ArchiveAdapterFactory()

# 创建 Broadcastify 适配器
broadcastify = factory.create("broadcastify")
await broadcastify.authenticate({"api_key": "xxx"})
archives = await broadcastify.list_archives("VHHH", start_date, end_date)

# 创建本地镜像适配器
mirror = factory.create("local_mirror", base_url="https://archive.example.com")
await mirror.authenticate({})
```

## 集成步骤（建议路线）

### Phase 1：验证与文档

- [OK] 梳理主要来源：[ATC_SOURCES_RESEARCH.md](ATC_SOURCES_RESEARCH.md)
- [OK] 定义适配器接口：`archive_adapter.py`
- 联系 LiveATC 官方了解 API 访问政策

### Phase 2：实现 Broadcastify

**优势**：

- 官方 API，100% 合规
- 支持 7,000+ 源，覆盖全球
- 已提供开发者文档

**步骤**：

1. 在 Broadcastify 开发者门户注册应用（radioreference.com）
2. 获取 API 密钥
3. 实现 `BroadcastifyAdapter::list_archives()` 和 `download()`
4. 添加单元测试（mock API 响应）
5. 文档化 API 密钥管理

### Phase 3：适配器选择策略

```python
class ArchiveAdapterSelector:
    """按配置优先级轮询适配器"""
    
    def __init__(self, adapter_types: List[str], credentials: dict):
        self.adapters = [
            factory.create(t, **credentials.get(t, {}))
            for t in adapter_types
        ]
    
    async def list_archives_with_fallback(self, icao, start, end):
        """尝试每个适配器，直到成功"""
        for adapter in self.adapters:
            try:
                if not await adapter.probe_availability():
                    continue
                return await adapter.list_archives(icao, start, end)
            except Exception as e:
                logger.warning(f"{adapter.name} failed: {e}")
        return []
```

## 相关文件清单

| 文件 | 用途 | 状态 |
| ------ | ------ | ------ |
| `ATC_SOURCES_RESEARCH.md` | 信息源研究与合规指南 | [FILE] 新增 |
| `app/services/archive_adapter.py` | 适配器接口定义 | [FILE] 新增 |
| `app/services/liveatc_client.py` | LiveATC 实现 | [OK] 现有 |
| `app/core/config.py` | 配置管理 | 可扩展 |
| `app/services/ingestion_scheduler.py` | 主调度循环 | 可集成 |

## 下一步行动

### 短期

1. 获取 Broadcastify 开发者账户
2. 测试 API 端点（使用 curl/postman）
3. 确认 LiveATC ToS 允许自动化（或联系官方）

### 中期

1. 实现 `BroadcastifyAdapter`
2. 整合到 `ingestion_scheduler`
3. 添加单元测试

### 当前建议

如果继续推进多源架构，建议把浏览器会话导出和代理池选择做成可插拔策略，而不是把它们硬编码在单一下载实现里。

### 长期

1. 研究学术合作或 FOIA 申请（官方渠道）
2. 构建本地 SDR 录制基础设施

## 参考链接

- **Broadcastify 论坛**: <https://www.radioreference.com/forums/>
- **Broadcastify Calls API**: <https://forums.radioreference.com/threads/broadcastify-calls-developer-apis-available.484055/>
- **LiveATC ToS**: <https://www.liveatc.net/terms/>
- **本项目适配器框架**: `app/services/archive_adapter.py`
- **研究总结**: `ATC_SOURCES_RESEARCH.md`
