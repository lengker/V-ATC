# A5 数据库结构与接口对接文档（联调版）

> 历史草案见 `API_数据库对接文档_补充说明.md`；**以本文与当前代码为准**。  
> 接口交叉引用使用 **§ 小节编号**（编辑文档后仍稳定，不采用行号）。

---

## §1 `backend_9.0` 交付包（给后端同学）

### §1.1 目录结构

将 **`backend_9.0`** 文件夹放到你们工程任意位置（可改名为 `backend` 或并入 monorepo 子目录）。推荐保持包名可 import：

```text
backend_9.0/
  requirements.txt          # 运行依赖：fastapi、uvicorn
  app/
    __init__.py
    main.py                 # FastAPI 入口，挂载路由与 /static
    config.py               # APP_DB_PATH、APP_ENV
    api/
      __init__.py
      tables.py             # /tables/* 正式接口
      query.py              # /query/arbitrary
      auth.py               # /users/* 注册、登录、令牌与角色（见 §7.3）
      dev.py                # /dev/*（仅开发环境，正文不展开破坏性路由）
    db/
      __init__.py
      connection.py         # SQLite 连接、PRAGMA foreign_keys=ON
      bootstrap.py          # 启动补表、跨表查询、级联删除等
    tables/                 # 各表 DDL 与 CRUD / 链式业务
      ...
    static/
      .gitkeep              # 目录占位；不含测试用 db_admin.html
```

### §1.2 如何使用

1. **进入目录**：`cd backend_9.0`（或你改名后的路径）。
2. **安装依赖**：`pip install -r requirements.txt`（建议使用 venv）。
3. **（可选）指定数据库文件路径**：环境变量 `APP_DB_PATH`，默认在 **`app` 包上一级** 生成 `data.sqlite3`（即与 `app` 同级的 `data.sqlite3`）。
4. **启动服务**（示例）：

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

5. **联调地址**：`http://127.0.0.1:8000`；交互文档：`http://127.0.0.1:8000/docs`。  
6. **首次启动**：会自动检查 SQLite 中 7 张业务表是否存在，缺则按依赖顺序创建（无需手工建表）。

---

## §2 环境与约定

| 项 | 说明 |
|----|------|
| 请求体 | `Content-Type: application/json`（除 GET 无体外） |
| 数据库 | SQLite，`PRAGMA foreign_keys = ON` |
| `APP_ENV` | 默认 `development`。仅当值为 `dev` / `development` / `local`（大小写不敏感）时，源码中的 `/dev/*` 路由才可用；否则 **403**。正文不列出删表、全库重置等破坏性开发接口；需要时查 `app/api/dev.py`。 |
| `APP_DB_PATH` | 数据库文件绝对或相对路径；父目录不存在时会创建 |
| `APP_AUTH_SECRET` | 签发与校验登录令牌用的 HMAC 密钥；**生产环境务必覆盖**，未设置时源码内为开发占位字符串 |

---

## §3 数据库结构

当前共 **7** 张业务表。

### §3.1 `LNG_AIRPORTS`

- `airport_code` (TEXT，**主键**)
- `name` (TEXT)
- `country_code` (TEXT)
- `airports_latitude` (REAL)
- `airports_longitude` (REAL)

外键：无。

### §3.2 `LNG_USERS`

- `user_id` (INTEGER，**主键，自增**)
- `username` (TEXT，UNIQUE，NOT NULL)
- `password_hash` (TEXT，NOT NULL)
- `role` (TEXT；业务取值建议为 **`admin` / `annotator` / `viewer`**，与 `app/api/auth.py` 中角色校验一致；空值在接口层按 `viewer` 处理)
- `email` (TEXT)

外键：无。

### §3.3 `LNG_TRACKS`

- `track_id` (INTEGER，**主键，自增**)
- `timestamp` (TEXT，NOT NULL)
- `flight_id` (TEXT，NOT NULL)
- `tracks_latitude` / `tracks_longitude` (REAL，NOT NULL)
- `altitude` / `speed` / `heading` (REAL)
- `departure_airport_code` / `arrival_airport_code` (TEXT，外键 → `LNG_AIRPORTS`)
- `next_id` / `prev_id` (INTEGER，自引用外键)

### §3.4 `LNG_AUDIO_RECORDS`

- `audio_id` (INTEGER，**主键，自增**)
- `source_url` (TEXT，NOT NULL)
- `start_time_utc` / `end_time_utc` (TEXT，NOT NULL，且 `end_time_utc >= start_time_utc`)
- `duration_ms` (INTEGER，NOT NULL)
- `file_name` / `file_path` (TEXT，NOT NULL)
- `file_size` (INTEGER，可空)
- `status` (INTEGER，NOT NULL，默认 0，**CHECK：`IN (0,1,2,3)`**；具体业务含义由组内约定，库层不解释)
- `last_access_at` (TEXT；**读/列表/部分写**时由服务刷新)
- `track_id` (INTEGER，NOT NULL，外键 → `LNG_TRACKS`)
- `next_id` / `prev_id` (INTEGER，自引用，链式维护)

### §3.5 `LNG_ANNOTATIONS`

- `annotation_id` (INTEGER，**主键，自增**)
- `label_type` (TEXT)
- `author_id` (INTEGER，NOT NULL，外键 → `LNG_USERS`)
- `audio_id` (INTEGER，NOT NULL，外键 → `LNG_AUDIO_RECORDS`)
- `relative_start` / `relative_end` (REAL；需满足 `relative_start <= relative_end` 若二者均有)
- `abs_start_time` / `abs_end_time` (TEXT；需满足 `abs_end_time >= abs_start_time` 若二者均有)
- `asr_content` (TEXT)
- `vad_confidence` (REAL)
- `is_annotated` (INTEGER，NOT NULL，默认 0，**CHECK：`IN (0,1)`**；0/1 业务含义由组内约定)
- `annotation_text` / `annotation_time` (TEXT；创建/更新时 `annotation_time` 可由服务维护)
- `storage_tag` (TEXT)
- `next_id` / `prev_id` (INTEGER，自引用)

### §3.6 `LNG_VSP_DATA`

- `vsp_id` (INTEGER，**主键，自增**)
- `airport_code` (TEXT，NOT NULL，外键 → `LNG_AIRPORTS`)
- `region` / `runway` / `taxiway` / `vor_id` / `waypoint` / `approach_type` / `gate` / `holding_point` / `sector_name` (TEXT，可空)

### §3.7 `LNG_STORAGE_LOG`

- `id` (INTEGER，**主键，自增**)
- `action_type` (TEXT，NOT NULL，**`IN ('CLEANUP','ARCHIVE')`**)
- `source_url` (TEXT，NOT NULL)
- `released_space` (INTEGER，NOT NULL)
- `op_time` (TEXT，NOT NULL)

---

## §4 表 key 一览（`table_key`）

接口路径中的 `table_key` 只能是：

| `table_key` | 物理表 | 主键列 |
|-------------|--------|--------|
| `airports` | `LNG_AIRPORTS` | `airport_code`（字符串，非自增） |
| `users` | `LNG_USERS` | `user_id` |
| `tracks` | `LNG_TRACKS` | `track_id` |
| `audio_records` | `LNG_AUDIO_RECORDS` | `audio_id` |
| `annotations` | `LNG_ANNOTATIONS` | `annotation_id` |
| `vsp_data` | `LNG_VSP_DATA` | `vsp_id` |
| `storage_log` | `LNG_STORAGE_LOG` | `id` |

---

## §5 按表 API 速查（正式接口）

下列涵盖 **`/tables/...`**、**`/users/*`**（用户与鉴权，见 §5.9）、以及 **`/health`**、**`/query/arbitrary`** 等速查，不依赖 `APP_ENV`（`/dev/*` 除外，见 §13）。

### §5.1 `airports`（`LNG_AIRPORTS`）

| 接口 | 功能 | 详见 |
|------|------|------|
| `POST /tables/airports` | 新增一条 | §6.1 |
| `GET /tables/airports/{item_id}` | 按主键查询 | §6.1 |
| `GET /tables/airports?limit=&offset=` | 分页列表 | §6.1 |
| `PUT /tables/airports/{item_id}` | 按主键更新 | §6.1 |
| `DELETE /tables/airports/{item_id}` | 按主键删除；若仍有 tracks/vsp 引用该机场，**外键约束下会失败（400）** | §6.1 |

### §5.2 `users`（`LNG_USERS`）

| 接口 | 功能 | 详见 |
|------|------|------|
| `POST/GET/PUT/DELETE /tables/users/...` | 标准 CRUD + 列表（可直接写 `password_hash` 等列；**联调创建登录账号建议走 §7.3 的 `/users/register`**） | §6.1 |
| `POST /users/register`、`POST /users/login`、`GET /users/me` 等 | 密码哈希、Bearer 令牌、当前用户与角色维护 | §7.3 |

### §5.3 `tracks`（`LNG_TRACKS`）

| 接口 | 功能 | 详见 |
|------|------|------|
| `POST/GET/PUT/DELETE /tables/tracks/...` | 标准 CRUD + 列表 | §6.1 |
| `POST /tables/tracks/ext/create` | 按机场序列拆段建链 | §8.1 |
| `POST /tables/tracks/ext/delete` | 删整条 track 链 | §8.2 |
| `POST /tables/tracks/ext/update/{item_id}` | 链上字段同步更新 | §8.3 |
| `POST /tables/tracks/ext/search` | 条件查 track，聚合为链维度 | §8.4 |

### §5.4 `audio_records`（`LNG_AUDIO_RECORDS`）

| 接口 | 功能 | 详见 |
|------|------|------|
| `POST/GET/PUT/DELETE /tables/audio_records/...` | 标准 CRUD + 列表（读/列表会刷新 `last_access_at`） | §6.1、§11 |
| `POST /tables/audio_records/ext/create` | 顺序追加建链（维护 `prev_id/next_id`） | §9.1 |
| `POST /tables/audio_records/ext/delete-chain` | 删整条音频链（每条走级联删除逻辑） | §9.2、§11 |
| `POST /tables/audio_records/ext/delete-one` | 删一条并重连邻居 | §9.3、§11 |
| `POST /tables/audio_records/ext/search-all` | 多链/单链聚合查询 | §9.4 |
| `POST /tables/audio_records/ext/search-one` | 单链查询；多链命中 **400** | §9.5 |
| `POST /tables/audio_records/ext/update/{item_id}` | 只改单条业务字段，禁止改链指针 | §9.6 |

### §5.5 `annotations`（`LNG_ANNOTATIONS`）

| 接口 | 功能 | 详见 |
|------|------|------|
| `POST/GET/PUT/DELETE /tables/annotations/...` | 标准 CRUD + 列表 | §6.1 |
| `POST /tables/annotations/ext/create` | 按 `audio_id` 顺序追加建链 | §10.1 |
| `POST /tables/annotations/ext/delete-chain` | 删整条标注链 | §10.2 |
| `POST /tables/annotations/ext/delete-one` | 删一条并重连 | §10.3 |
| `POST /tables/annotations/ext/search-all` | 多链/单链聚合 | §10.4 |
| `POST /tables/annotations/ext/search-one` | 单链；多链 **400** | §10.5 |
| `POST /tables/annotations/ext/update/{item_id}` | 单条更新，禁止改链指针 | §10.6 |

### §5.6 `vsp_data`（`LNG_VSP_DATA`）

| 接口 | 功能 | 详见 |
|------|------|------|
| `POST/GET/PUT/DELETE /tables/vsp_data/...` | 标准 CRUD + 列表 | §6.1 |

### §5.7 `storage_log`（`LNG_STORAGE_LOG`）

| 接口 | 功能 | 详见 |
|------|------|------|
| `POST/GET/PUT/DELETE /tables/storage_log/...` | 标准 CRUD + 列表（一般由系统写入，见 §11） | §6.1 |

### §5.8 全局（不绑定单表）

| 接口 | 功能 | 详见 |
|------|------|------|
| `GET /health` | 存活检查 | §7.1 |
| `POST /query/arbitrary` | 跨表任意字段查询 | §7.2 |

### §5.9 用户与鉴权（`/users/*`）

前缀 **`/users`**，实现见 `app/api/auth.py`。**需在 `app/main.py` 中执行 `app.include_router(auth_router)`（从 `app.api.auth` 导入 `router` 并命名）后**，下列路由才会随服务启动；若未挂载，仅文档约定无效。

| 接口 | 认证 | 功能 | 详见 |
|------|------|------|------|
| `POST /users/register` | 无 | 注册账号（**禁止**将 `role` 设为 `admin`） | §7.3 |
| `POST /users/login` | 无 | 校验用户名密码，返回 Bearer `token` 与 `user_info` | §7.3 |
| `GET /users/me` | Bearer | 返回当前登录用户公开信息 | §7.3 |
| `GET /users/permissions/check/{required_role}` | Bearer | 判断当前角色是否 **≥** 路径中的目标角色 | §7.3 |
| `PATCH /users/{user_id}/role` | Bearer，**且角色须为 `admin`** | 修改指定用户的 `role` | §7.3 |
| `GET /users/permissions/rules` | 无 | 返回权限规则说明文案（设计约定） | §7.3 |

---

## §6 通用 CRUD（`/tables/{table_key}`）

### §6.1 规则汇总

| 方法 | 路径 | 作用 | 返回（成功） |
|------|------|------|----------------|
| POST | `/tables/{table_key}` | 新增 | `{"id": <主键值>}`；`airports` 的 `id` 为字符串 `airport_code` |
| GET | `/tables/{table_key}/{item_id}` | 按主键查一条 | 行对象 JSON；不存在 **404** |
| GET | `/tables/{table_key}?limit=100&offset=0` | 列表 | 数组；`limit` 默认 100，范围 **1～1000**；`offset` **≥0** |
| PUT | `/tables/{table_key}/{item_id}` | 部分字段更新 | `{"updated": true}`；无改动或不存在 **404** |
| DELETE | `/tables/{table_key}/{item_id}` | 按主键删除 | `{"deleted": true}`；不存在 **404** |

**Body（POST/PUT）**：JSON 对象，字段名须为该表**可写列**子集（与 `app/tables/lng_*.py` 中 `WRITABLE_COLUMNS` 一致）。违反 NOT NULL / UNIQUE / FOREIGN KEY / CHECK 时 **400**。

**主键**：

- `airports`：**必须**提供 `airport_code`。
- 其余表：主键自增，**不要**在 POST 中传主键（除非你们明确要自定义且库允许）。

**`audio_records` 特例**：

- `GET` 单条、`GET` 列表命中行会更新 `last_access_at` 为当前 UTC ISO 时间（与响应中一致）。

---

## §7 全局接口

### §7.1 `GET /health`

- **入参**：无  
- **返回**：`{"ok": true}`  

### §7.2 `POST /query/arbitrary`

- **作用**：按「外键图」从某张表的字段定位行，再选出跨表字段。  
- **Body（JSON）**：

```json
{
  "reference": { "字段名": "值" },
  "select": ["字段A", "字段B"]
}
```

- **约束**：
  - `reference`：至少 1 个键值对；字段可跨表，须在图内可解析。
  - `select`：至少 1 个字段名；可跨表。
  - 字段不存在 → **400**（`Unknown field` 等）；跨表歧义 → **400**（`ambiguous across tables`）。
- **返回**：`[{...}, ...]`，每行为所选字段的扁平对象。

### §7.3 用户注册、登录与鉴权（`/users/*`）

与 §5.9 路径一致。本组接口的**成功响应**统一为：

```json
{ "code": 0, "message": "success", "data": { ... } }
```

**失败**时 HTTP 状态码多为 **400 / 401 / 403 / 404 / 409 / 500**。响应体为 FastAPI 常见形式，业务码在 **`detail` 对象**内：

```json
{ "detail": { "code": <整数业务码>, "message": "<说明>", "data": {} } }
```

常见 `code`：**1001** 参数或业务规则错误；**1002** 未授权、令牌无效/过期、权限不足；**2001** 用户不存在；**2002** 用户名已存在；**3001** 服务端创建用户失败。  
另：请求体不符合 Pydantic 字段约束时，也可能返回 **422**，`detail` 为 FastAPI 默认的校验错误列表（与上表结构不同）。

#### §7.3.1 `POST /users/register`

- **Body（JSON）**  

| 字段 | 类型 | 约束 |
|------|------|------|
| `username` | string | 去首尾空格后非空；长度 3～64 |
| `password` | string | 长度 6～128；服务端存 **PBKDF2-HMAC-SHA256**（20 万次迭代）哈希，不存明文 |
| `email` | string 或省略 | 合法邮箱；可省略 |
| `role` | string，可选 | 默认 `viewer`；仅允许 **`annotator`** 或 **`viewer`**（**不允许 `admin`**，否则 400） |

- **成功 `data`**：`user_id`, `username`, `email`, `role`（与库中一致；无邮箱则为 JSON `null`）。  
- **409**：用户名唯一约束冲突（`code` 2002）。

#### §7.3.2 `POST /users/login`

- **Body**：`username`（同上非空规则）、`password`（6～128）。  
- **成功 `data`**：  
  - `token`：Bearer 用令牌（见 §7.3.5）  
  - `token_type`：固定 `"bearer"`  
  - `user_info`：同注册成功后的用户公开字段  
- **401**：用户名不存在或密码错误（统一文案，防枚举）。

#### §7.3.3 `GET /users/me`

- **请求头**：`Authorization: Bearer <token>`  
- **成功 `data`**：当前用户 `user_id`, `username`, `email`, `role`。

#### §7.3.4 `GET /users/permissions/check/{required_role}`

- **请求头**：`Authorization: Bearer <token>`  
- **路径**：`required_role` 为 **`admin` | `annotator` | `viewer`** 之一（大小写不敏感，服务端会规范为小写）。  
- **成功 `data`**：`allowed`（bool）、`required_role`、`current_role`。比较规则：角色等级 **viewer(1) < annotator(2) < admin(3)**，`allowed` 为「当前等级 ≥ 目标等级」。

#### §7.3.5 `PATCH /users/{user_id}/role`

- **请求头**：`Authorization: Bearer <token>`，且令牌对应用户 **`role` 必须为 `admin`**，否则 **403**。  
- **Body**：`{ "role": "admin" | "annotator" | "viewer" }`（正则校验，大小写不敏感，存库为小写）。  
- **成功 `data`**：更新后的用户公开信息。  
- **404**：`user_id` 不存在。

#### §7.3.6 `GET /users/permissions/rules`

- **认证**：不需要。  
- **成功 `data`**：`{ "rules": [ "<说明字符串>", ... ] }`（与源码中维护的说明一致；**标注写接口是否在后端强制校验角色，以各业务路由是否挂载 `require_annotation_permission` 等依赖为准**，当前 `tables` 路由未统一挂载时，客户端可按规则自行控制）。

#### §7.3.7 令牌格式与有效期

- 令牌为 **三段** `header.payload.signature`，均为 **Base64URL**（无填充）；`header` 为 `{"alg":"HS256","typ":"JWT"}`，`payload` 含 `uid`（用户 id）、`role`、`exp`（Unix 秒级过期时间）。  
- **有效期**：自签发起 **24 小时**（与源码中 `_TOKEN_TTL_SECONDS` 一致）。  
- 校验使用环境变量 **`APP_AUTH_SECRET`**（见 §2）；密钥变更会导致旧令牌全部失效。

---

## §8 `tracks` 扩展接口

### §8.1 `POST /tables/tracks/ext/create`

- **入参**：单对象 `{...}` 或数组 `[{...}, ...]`。  
- **单条必填**：`timestamp`, `flight_id`, `tracks_latitude`, `tracks_longitude`, `altitude`, `speed`, `heading`, **`airport_code`**（**字符串数组，长度 ≥2**，相邻元素拆成多段 track）。  
- **禁止传入**：`departure_airport_code`, `arrival_airport_code`, `next_id`, `prev_id`（由服务端推导）。  
- **返回**：单段 `{"id": n, "track_id": n}` 或多段 `{"id": n, "track_id": [n, m, ...]}`；批量外层为数组。  
- **错误**：缺字段、数组过短、传入禁止字段等 → **400**。

### §8.2 `POST /tables/tracks/ext/delete`

- **Body**：`{"id": <track_id>}`，`id` 为链上任意一段的 `track_id`。  
- **返回**：`{"deleted": true, "ids": [...], "count": N}`（整条链的 id）。  

### §8.3 `POST /tables/tracks/ext/update/{item_id}`

- **路径**：`item_id` 为整数 `track_id`。  
- **Body**：`{"values": {...}}` 或直接字段对象；**禁止**更新 `next_id` / `prev_id`。  
- **语义**：普通标量字段会同步整条链；改 `departure_airport_code` / `arrival_airport_code` 会联动相邻段边界。  
- **返回**：`{"updated": true, "id": item_id, "chain_ids": [...]}`（以代码为准）。

### §8.4 `POST /tables/tracks/ext/search`

- **Body**：`{"filters": {...}, "limit": 100}`；也可把过滤字段放在顶层（与 `filters` 等价）；`filters` 必须是对象。主键过滤会被忽略（与开发态 search 一致）。  
- **返回**：
  - 无命中：`[]`
  - 单条链：一个聚合对象，字段包括 `track_id`（数组）、`airport_code`（数组）、以及链头段的 `timestamp`, `flight_id`, `tracks_latitude`, `tracks_longitude`, `altitude`, `speed`, `heading`
  - 多条链：`[ 聚合对象, ... ]`

---

## §9 `audio_records` 扩展接口

### §9.1 `POST /tables/audio_records/ext/create`

- **作用**：在同一 `track_id` 下**顺序追加**到链尾；自动维护 `prev_id`/`next_id`。  
- **入参**：单对象或对象数组；**不得**传 `prev_id`/`next_id`。  
- **可写字段**：除 `prev_id`/`next_id` 外的业务列（含 `track_id` 等）；服务端会写 `last_access_at`。  
- **返回**：单条 `{"id": x, "audio_id": x}` 或批量 `{"id": 首id, "audio_id": [..]}` 等（与代码 `create_items_chain_extended` 一致）。  
- **错误**：同 `track_id` 批量必须连续分组；违反约束 → **400**。

### §9.2 `POST /tables/audio_records/ext/delete-chain`

- **Body**：`{"id": <audio_id>}`（链上任意节点）。  
- **行为**：对链上每个 `audio_id` 调用与开发态一致的级联删除（含子 `annotations`、`LNG_STORAGE_LOG` 记录等，见 §11）。  
- **返回**：`{"deleted": true, "ids": [...], "count": N}`。

### §9.3 `POST /tables/audio_records/ext/delete-one`

- **Body**：`{"id": <audio_id>}`。  
- **行为**：先重连前后节点再删当前行；删除仍走 `db_ui_delete_row`（写 storage 日志等）。  
- **返回**：`{"deleted": true, "id", "prev_id", "next_id", "relinked": bool}`。

### §9.4 `POST /tables/audio_records/ext/search-all`

- **Body**：`{"filters": {...}, "limit": 100}`（`filters` 须为对象）。  
- **返回**：0 条链 → `[]`；1 条链 → 该链有序数组；多条链 → 二维数组 `[链1[], 链2[], ...]`。链内顺序从 `prev_id IS NULL` 的头结点走起。

### §9.5 `POST /tables/audio_records/ext/search-one`

- **Body**：同 §9.4。  
- **返回**：0 条链 → `[]`；1 条链 → 一维有序数组。  
- **多链命中**：**400**（`Multiple audio chains matched...`）。

### §9.6 `POST /tables/audio_records/ext/update/{item_id}`

- **路径**：`item_id` 为 `audio_id`。  
- **Body**：`{"values": {...}}` 或直接对象。  
- **禁止**：`next_id`, `prev_id`。  
- **允许字段**：与扩展创建相同的可写业务列子集（不可写链指针）。  
- **返回**：`{"updated": true, "id": item_id}`。

---

## §10 `annotations` 扩展接口

语义与 `audio_records` 链式接口对称，**按 `audio_id` 分链**。

### §10.1 `POST /tables/annotations/ext/create`

- 顺序追加到同一 `audio_id` 链尾；禁止客户端传 `prev_id`/`next_id`。详见 §9.1 对应说明（字段换为 annotations 业务列）。

### §10.2～§10.5 `delete-chain` / `delete-one` / `search-all` / `search-one`

- 路径分别为：`/tables/annotations/ext/delete-chain`、`delete-one`、`search-all`、`search-one`。  
- **多链命中** `search-one` 时 **400**（`Multiple annotation chains matched...`）。  
- 其余规则同 §9.2～§9.5（将 audio 换为 annotation）。

### §10.6 `POST /tables/annotations/ext/update/{item_id}`

- 禁止 `prev_id`/`next_id`；返回 `{"updated": true, "id": annotation_id}`。

---

## §11 联动与数据维护（联调必看）

### §11.1 `last_access_at`（`audio_records`）

在 **GET 单条**、**GET 列表**、**通用 PUT**、**扩展 create/update** 以及 **扩展 search** 命中行等路径中，服务会刷新 `last_access_at`（UTC ISO）。

### §11.2 `annotation_time`（`annotations`）

- **正式接口** `POST /tables/annotations`、`PUT /tables/annotations/{id}`：表模块**不会**自动写入 `annotation_time`，需调用方在 JSON 里自行传入（若业务需要）。
- **开发态** `POST /dev/db-ui/rows/create/annotations` 创建时会补 `annotation_time`；`POST /dev/db-ui/rows/update/annotations` 在 `values` 非空时会刷新 `annotation_time`（见 `db_ui_create_row` / `db_ui_update_row`）。

### §11.3 删除 `audio_records` 与 `LNG_STORAGE_LOG`

当通过 **`db_ui_delete_row`** 路径删除音频（包括 **`ext/delete-chain` / `ext/delete-one`** 内部）时，会插入一条日志：

- `action_type = "CLEANUP"`
- `source_url` = 被删行的 `source_url`
- `released_space` = `file_size` 转 int，缺省为 **0**
- `op_time` = 当前时间（ISO）

**注意**：**通用 `DELETE /tables/audio_records/{id}`** 走表模块的 `delete_item`（简单 DELETE），**不会**自动写上述 `LNG_STORAGE_LOG`，也不会应用 `db_ui_delete_row` 的级联；联调若要与管理端一致，优先使用 **扩展删除** 或保证无外键子行。

### §11.4 删除 `airports`（正式 `DELETE`）

**正式** `DELETE /tables/airports/{code}` 仅执行单行删除；**不会**走 `bootstrap._delete_row_cascade`。存在下游引用时由 SQLite 外键拒绝删除。  
**开发态** `POST /dev/db-ui/rows/delete/airports` 才会走级联删除逻辑（见源码 `db_ui_delete_row`）。

### §11.5 `airports` 主键更新

仅 **`/dev/db-ui/rows/update/airports`**（开发态）支持 `new_id` 改 `airport_code` 并级联更新引用；**正式 `PUT /tables/airports/{code}`** 不按该逻辑改主键。

---

## §12 常见 HTTP 状态

| 码 | 含义 |
|----|------|
| 400 | 参数非法、业务规则错误、约束失败 |
| 401 | §7.3 登录失败、缺少或非法/过期的 Bearer 令牌 |
| 403 | 非开发环境访问 `/dev/*`；或 §7.3 中角色不满足要求（如非 `admin` 调角色变更） |
| 404 | 未知 `table_key` 或资源不存在 |
| 409 | §7.3 注册时用户名已存在 |
| 500 | §7.3 等路径中极少见的内部错误 |
| 422 | 请求 JSON 字段类型/格式未通过 Pydantic 校验（含 `/users/*` 的邮箱、字段长度等） |

**错误体**：`/tables/*`、`/query/*`、`/health` 等多为 FastAPI 默认 `{"detail": "..."}` 或校验错误列表。**`/users/*`** 的业务错误多为 `{"detail": {"code": <int>, "message": "<str>", "data": {}}}`（见 §7.3）。

---

## §13 开发态接口（略表）

源码中另有前缀 **`/dev/*`**（见 `app/api/dev.py`）：在 **`APP_ENV` 为 dev/development/local** 时可用，用于快照、补表、行级 CRUD、以及与正式规则相同的 `tracks` / `audio_records` / `annotations` 扩展镜像等。  

**本文故意不写**：删表（`drop`）、级联重置（`reset` / `reset-all`）等破坏性接口；避免误用在联调/生产环境。需要时请直接阅读源码。

---

## §14 快速示例

### §14.1 新增机场（字段名与库一致）

`POST /tables/airports`

```json
{
  "airport_code": "VHHH",
  "name": "Hong Kong International",
  "country_code": "CN",
  "airports_latitude": 22.308,
  "airports_longitude": 113.918
}
```

返回示例：`{"id": "VHHH"}`。

### §14.2 跨表查询示例

`POST /query/arbitrary`

```json
{
  "reference": {"username": "alice"},
  "select": ["annotation_text", "file_name"]
}
```

（字段须在外键图内可解析；示例仅作格式参考。）

### §14.3 用户注册与登录（`/users/*`，须已在 `main.py` 挂载路由）

`POST /users/register`

```json
{
  "username": "alice",
  "password": "secret12",
  "email": "alice@example.com",
  "role": "annotator"
}
```

成功时响应形如：`{"code":0,"message":"success","data":{"user_id":1,"username":"alice","email":"alice@example.com","role":"annotator"}}`。

`POST /users/login`

```json
{
  "username": "alice",
  "password": "secret12"
}
```

成功时 `data` 内含 `token`、`token_type`、`user_info`；后续请求头携带：`Authorization: Bearer <token>`。

---

## §15 附录：标注员工作台最小接口集（A4 前端对照）

> **确认范围**：与 A5 后端对齐的「标注员工作台」联调最小集；前端实现见 `front/src/lib/backend-api.ts`、`front/src/lib/api.ts`。  
> **原则**：前端 **只连 A5**；不存在 `/api/audio/*` 等 Next 占位路由。媒体文件通过 `source_url` 绝对 HTTP(S) 地址加载。

### §15.1 按业务场景

| 场景 | 前端入口 | A5 HTTP | 认证 | 说明 |
|------|----------|---------|------|------|
| 健康检查 | `getHealth()` | `GET /health` | 否 | 联调脚本 `health-check.ps1` 使用 |
| 登录 | `loginWithBackend` | `POST /users/login` | 否 | 见 §7.3.2 |
| 注册 | `registerWithBackend` | `POST /users/register` | 否 | 见 §7.3.1 |
| 会话恢复 | `getCurrentUser` | `GET /users/me` | Bearer | 见 §7.3.3 |
| 权限探测 | `checkPermission` | `GET /users/permissions/check/{role}` | Bearer | 可选；见 §7.3.4 |
| **首页三表加载** | `fetchAnnotationBundle` | `GET /tables/audio_records?limit=1000&offset=0`<br>`GET /tables/tracks?limit=1000&offset=0`<br>`GET /tables/annotations?limit=1000&offset=0` | Bearer（若后端挂载） | 并行拉取后在前端 join；航迹沿 `prev_id`/`next_id` 扩展 |
| 音频播放 | `resolveBrowserAudioUrl` | 直接 GET `source_url` | — | 须为浏览器可请求的绝对 URL；相对路径拼 `NEXT_PUBLIC_API_BASE_URL` |
| **改标注** | `audioAPI.updateTimestamp` → `annotationsExtApi.update` | `POST /tables/annotations/ext/update/{annotation_id}` | Bearer | Body: `{ "values": { "relative_start", "relative_end", "annotation_text", ... } }`；见 §10.6 |
| **增标注** | `annotationAPI.createAnnotation` → `annotationsExtApi.create` | `POST /tables/annotations/ext/create` | Bearer | 必填 `audio_id`；禁止传 `prev_id`/`next_id`；见 §10.1 |
| **删标注** | `annotationAPI.deleteAnnotation` → `annotationsExtApi.deleteOne` | `POST /tables/annotations/ext/delete-one` | Bearer | Body: `{ "id": <annotation_id> }`；见 §10.2～§10.3 |

### §15.2 前端类型 ↔ 库字段（读路径）

| 前端类型 | 来源表 | 关键映射 |
|----------|--------|----------|
| `AudioData.id` | `audio_records.audio_id` | `String(audio_id)` |
| `AudioData.url` | `audio_records.source_url` | 经 `resolveBrowserAudioUrl` |
| `AudioData.duration` | `audio_records.duration_ms` | `÷ 1000` 秒 |
| `VoiceTimestamp.id` | `annotations.annotation_id` | 写回时须为数字 id |
| `VoiceTimestamp.startTime` | `annotations.relative_start` | |
| `VoiceTimestamp.endTime` | `annotations.relative_end` | |
| `VoiceTimestamp.text` | `annotations.annotation_text` 或 `asr_content` | |
| `ADSBData.*` | `tracks` | 按录音关联 `track_id` 及链式邻居聚合 |

### §15.3 明确不在最小集内（后续迭代）

| 能力 | 说明 |
|------|------|
| `GET /api/audio/*`、`GET /api/adsb/*` | 早期前端占位，**A5 未实现**；已从联调路径移除 |
| `POST /query/arbitrary` | 管理/报表用；工作台 MVP 未使用 |
| `audio_records` / `tracks` ext 写接口 | 同步脚本（`sync_*.py`）使用；标注员 UI 只读 |
| 时间轴 UI「删除/拆分/合并」全量 ext 同步 | 当前以 localStorage 草稿为主；删链需补调 `delete-one` / `create` |

### §15.4 环境变量

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `NEXT_PUBLIC_API_BASE_URL` | `http://127.0.0.1:8000` | 前端 REST 与媒体基址 |
| `APP_AUTH_SECRET` | （A5 侧） | JWT 签发；见 §7.3.7 |
