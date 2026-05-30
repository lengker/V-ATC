# 前后端联调说明（A5）

本文用于说明当前项目如何进行前后端联调，包括：
- 前后端各自需要做什么
- 联调顺序
- 接口清单
- 验收标准与常见问题

---

## 一、目录说明

- `front/`：前端（Next.js）工程，联调主入口
- `backend/`：后端文档与后端交付说明目录
- `careercompass/`：历史集成目录，本次联调不作为主路径

---

## 二、前后端职责分工

### 后端需要完成

- 启动服务并保证可访问：
  - `GET /health` 返回 `{"ok": true}`
  - `http://127.0.0.1:8000/docs` 可访问
- 确保 `users` 路由已挂载（`/users/*` 可用）
- 准备联调数据（至少保证：
  - `LNG_USERS` 有可登录用户，或可通过 `/users/register` 注册
  - `LNG_AUDIO_RECORDS` 有至少 1 条记录
  - `LNG_TRACKS`、`LNG_ANNOTATIONS` 有对应关联数据）
- 明确环境变量：
  - `APP_DB_PATH`
  - `APP_AUTH_SECRET`
  - `APP_ENV`

### 前端需要完成

- 配置后端地址：
  - `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000`
- 启动前端并验证登录、列表、编辑链路
- 对接 API 统一通过 `front/src/lib/backend-api.ts`
- 登录态与 token 统一由 `front/src/context/AuthContext.tsx` 管理

---

## 三、联调启动步骤（建议严格按顺序）

1. 启动后端
   - 在后端目录运行：
   - `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`

2. 验证后端健康
   - 打开：`http://127.0.0.1:8000/health`
   - 打开：`http://127.0.0.1:8000/docs`

3. 启动前端
   - 在 `front/` 目录运行：
   - `npm install`
   - `npm run dev`

4. 登录验证
   - 优先使用后端注册账号登录
   - 若后端不可用，可用离线保底账号：
     - 用户名：`offline@alpha.local`
     - 密码：`offline123`

5. 业务联调验证
   - 首页数据能加载（audio/tracks/annotations）
   - 时间戳编辑可保存并回显
   - 切换录音与地图展示正常

---

## 四、接口清单（按模块）

以下为当前联调应重点使用接口（来源：`backend/API_数据库对接文档.md`）。

### 4.1 健康检查与通用查询

- `GET /health`：服务存活检查
- `POST /query/arbitrary`：跨表查询

### 4.2 用户与鉴权（`/users/*`）

- `POST /users/register`：注册（role 仅 `annotator` / `viewer`）
- `POST /users/login`：登录，返回 Bearer token
- `GET /users/me`：获取当前用户
- `GET /users/permissions/check/{required_role}`：权限检查
- `PATCH /users/{user_id}/role`：管理员改角色
- `GET /users/permissions/rules`：权限规则说明

### 4.3 通用表 CRUD（`/tables/{table_key}`）

`table_key` 支持：
- `airports`
- `users`
- `tracks`
- `audio_records`
- `annotations`
- `vsp_data`
- `storage_log`

通用接口：
- `POST /tables/{table_key}`
- `GET /tables/{table_key}/{item_id}`
- `GET /tables/{table_key}?limit=&offset=`
- `PUT /tables/{table_key}/{item_id}`
- `DELETE /tables/{table_key}/{item_id}`

### 4.4 tracks 扩展接口

- `POST /tables/tracks/ext/create`
- `POST /tables/tracks/ext/delete`
- `POST /tables/tracks/ext/update/{item_id}`
- `POST /tables/tracks/ext/search`

### 4.5 audio_records 扩展接口

- `POST /tables/audio_records/ext/create`
- `POST /tables/audio_records/ext/delete-chain`
- `POST /tables/audio_records/ext/delete-one`
- `POST /tables/audio_records/ext/search-all`
- `POST /tables/audio_records/ext/search-one`
- `POST /tables/audio_records/ext/update/{item_id}`

### 4.6 annotations 扩展接口

- `POST /tables/annotations/ext/create`
- `POST /tables/annotations/ext/delete-chain`
- `POST /tables/annotations/ext/delete-one`
- `POST /tables/annotations/ext/search-all`
- `POST /tables/annotations/ext/search-one`
- `POST /tables/annotations/ext/update/{item_id}`

---

## 五、当前前端对接代码位置

- `front/src/lib/backend-api.ts`
  - 后端 API 统一封装（users / health / query / tables / ext）
- `front/src/context/AuthContext.tsx`
  - 登录、token 存储、用户态恢复、离线保底账号
- `front/src/app/page.tsx`
  - 首页拉取后端聚合数据（失败回退 demo）
- `front/src/lib/api.ts`
  - 时间戳与标注相关写操作封装

---

## 六、联调验收标准（最小闭环）

满足以下 5 条即视为联调闭环完成：

1. 后端 `health` 正常
2. 前端可登录（后端账号或离线账号）
3. 首页可展示后端数据（至少一条录音与轨迹）
4. 标注/时间戳编辑后可保存
5. 刷新页面后数据状态符合预期（后端成功时回显后端结果）

---

## 七、常见问题排查

- 登录失败
  - 先确认后端 `/users/login` 可用
  - 优先输入用户名（非邮箱别名）
  - 清理浏览器本地 token 后重试

- 前端 500 / 模块找不到
  - 删除 `front/.next` 后重启 `npm run dev`
  - 重新执行 `npm install`

- 数据为空
  - 检查后端数据库是否已有 `audio_records/tracks/annotations`
  - 检查前端 `NEXT_PUBLIC_API_BASE_URL` 是否正确

- 删除语义不一致
  - 业务删除优先使用 `ext/delete-one` / `ext/delete-chain`
  - 避免直接用通用 `DELETE /tables/audio_records/{id}` 处理业务链删除

# 启动
```
  cd "e:\软件项目管理\qt\联调"
  .\start-all.ps1
```
