# A-2 测试选型与结构指南

本文面向维护者，说明测试应该放在哪里、为什么要这么分层，以及不同测试方式的使用场景。

## 为什么要补这份指南

仓库已经有 `unit`、`integration`、`network`、`e2e`、`longrun` 等分层，但如果没有明确的选型说明，容易出现以下问题：

- 顶层测试文件看起来像单元测试，实际却依赖真实数据库和跨服务流程。
- fixture 分散在不同目录时，新测试容易重复准备数据或误用作用域。
- 网络测试和长稳测试如果没有明确入口，日常回归会误把它们当成普通测试。

这份指南的目的，是把“测试写到哪”和“为什么这么写”讲清楚。

## 测试类型怎么选

### unit

适合纯业务逻辑、规则计算、状态转换、错误处理等不依赖真实数据库或 HTTP 服务的测试。

特征：

- 使用 mock DB 或 mock client。
- 只验证单个服务函数的输入输出。
- 运行快，适合作为日常回归基础层。

### integration

适合需要真实 `AsyncSession`、真实路由层或多个服务协同时的测试。

特征：

- 使用内存 SQLite 或临时数据库。
- 可能通过 FastAPI `AsyncClient` 访问接口。
- 验证服务和持久层、路由和服务之间的契约。

### integration/flows

适合跨模块链路测试，例如“注册音频 -> 回调写段 -> 查询播放”或 A-3/A-5 的跨服务流程。

为什么单独放这里：

- 这些测试往往比普通路由测试更长。
- 它们不是单点 API 断言，而是业务流验证。
- 归类到 `flows` 后，更容易发现它们依赖了真实 DB 和跨服务状态。

### network

适合会真正访问 LiveATC 或其他外部站点的测试。

为什么要单独标记：

- 受网络波动和站点策略影响大。
- 不应该默认进入日常回归。
- 方便在需要时单独跑真实联调。

### e2e / longrun

适合长时间稳定性和端到端验证。

为什么要单独隔离：

- 运行时间长，容易拖慢普通开发回归。
- 受环境和外部服务影响更大。
- 更适合手动触发或夜间任务。

## 本次结构调整说明

### 1. 顶层 A3/A5 测试下沉到 integration/flows

原来的 `tests/test_a3_a5_integration.py` 使用了真实 `db_session`、真实模型写入和服务调用，语义上属于集成流程测试，不是 unit。

因此把它移动到 [tests/integration/flows/test_a3_a5_integration_flow.py](tests/integration/flows/test_a3_a5_integration_flow.py)，并加上 `pytest.mark.integration`，让目录和语义一致。

### 2. 保留 unit 与 integration 的边界

unit 侧继续使用 `tests/unit/services/conftest.py` 的 mock DB，避免写数据库相关测试时把真实持久层混进来。

integration 侧继续走真实 `db_session`，用于验证服务、路由和数据库契约。

### 3. 继续保留 network / e2e / longrun 的明确入口

LiveATC 网络用例和长稳测试保留独立 marker，避免日常回归中误触发外部依赖。

## 推荐命令

日常回归：

```bash
pytest tests/ -q -m "not network and not e2e and not longrun"
```

查看收集结构：

```bash
pytest --collect-only -q
```

真实网络测试：

```bash
pytest tests/unit/services/test_liveatc_client.py -q -m network
pytest tests/integration/api/test_ingestion_routes.py -q -m network
```

## 维护建议

- 新增只验证业务逻辑的测试优先放 unit。
- 需要真实数据库或跨服务交互的测试放 integration。
- 涉及多步业务链路的测试放 integration/flows。
- 访问外网的测试必须加 `network` marker。
- 长时间运行或稳定性验证测试必须加 `e2e` 或 `longrun` marker。
