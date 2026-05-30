# PR：清理前端遗留 HTTP 层（`api.ts`）

> **关联任务**：WBS 5 — 清理前端遗留 HTTP 层  
> **目标分支**：`main`（合并后）  
> **影响范围**：`front/src/lib/api.ts` 及调用方

---

## 1. 变更摘要

本 PR 将 A4 前端 HTTP 访问收敛为 **「读走 `backend-api.ts`，写走 ext 接口」** 的双层结构，移除早期 Next.js 占位路由 `/api/audio/*`、`/api/adsb/*`、`/api/annotations/*` 对组员的误导。

| 层级 | 文件 | 职责 |
|------|------|------|
| **A5 适配层（唯一真实出口）** | `lib/backend-api.ts` | 登录、三表聚合读、标注/录音/航迹 ext CRUD |
| **UI 兼容层（薄封装）** | `lib/api.ts` | 保留 `ApiResponse<T>` 形状，供标注页写回；内部转调 `annotationsExtApi` |

### 1.1 `api.ts` 改动说明

| 方法 | 改动前 | 改动后 | 状态 |
|------|--------|--------|------|
| `audioAPI.getAudioList` | `GET /api/audio/list` | **已废弃**（无调用方） | 待删除 |
| `audioAPI.getAudio` | `GET /api/audio/:id` | **已废弃**（无调用方） | 待删除 |
| `audioAPI.updateTimestamp` | `PUT /api/audio/:id/timestamps` | 转调 `POST /tables/annotations/ext/update/{annotation_id}` | ✅ 已改写 |
| `audioAPI.deleteTimestamp` | `DELETE /api/audio/.../timestamps/:id` | **已废弃** | 待删除 |
| `adsbAPI.*` | `GET /api/adsb/*` | **已废弃**（读改由 `fetchAnnotationBundle`） | 待删除 |
| `annotationAPI.getAnnotations` | `GET /api/annotations/:audioId` | **已废弃** | 待删除 |
| `annotationAPI.createAnnotation` | `POST /api/annotations` | 转调 `POST /tables/annotations/ext/create` | ✅ 已改写 |
| `annotationAPI.updateAnnotation` | `PUT /api/annotations/:id` | 转调 `POST /tables/annotations/ext/update/{id}` | ✅ 已改写 |
| `annotationAPI.deleteAnnotation` | `DELETE /api/annotations/:id` | 转调 `POST /tables/annotations/ext/delete-one` | ✅ 已改写 |

> **合并标准**：删除所有仍指向 `/api/*` 的只读占位方法；`api.ts` 仅保留标注写回薄封装（或后续整体迁入 `backend-api.ts` 后删除本文件）。

### 1.2 字段映射（写回 ext 时）

| 前端 `VoiceTimestamp` / `Annotation` | A5 `annotations` 列 |
|--------------------------------------|------------------------|
| `id` | `annotation_id`（必须为数字） |
| `startTime` / `timestamp` | `relative_start` |
| `endTime` | `relative_end` |
| `text` | `annotation_text` |
| `audioId`（创建时） | `audio_id` |
| `edited` → `is_annotated` | `1` / `0` |

---

## 2. 调用方调整说明

### 2.1 已迁移（无需再改）

| 调用方 | 原依赖 | 现依赖 | 说明 |
|--------|--------|--------|------|
| `app/page.tsx` | （曾计划 `audioAPI.getAudioList`） | `fetchAnnotationBundle()` | 并行 `GET /tables/audio_records`、`tracks`、`annotations`，limit=1000 |
| `context/AuthContext.tsx` | — | `loginWithBackend` / `registerWithBackend` / `getCurrentUser` | Token 键 `alpha.auth.token` |
| `components/auth-guard.tsx` | — | `AuthContext` | 未登录跳转 `/login` |

### 2.2 仍使用 `api.ts`（当前唯一调用方）

**文件**：`components/annotation-page.tsx`

```typescript
import { audioAPI } from "@/lib/api";

// handleSaveTimestamp 内：
const response = await audioAPI.updateTimestamp(audioData.id, updatedTimestamp);
```

**行为**：
- `timestamp.id` 必须是后端返回的 `annotation_id`（数字字符串）；否则返回 `{ success: false, error: "当前时间戳不是后端 annotation_id..." }`。
- 失败时仍 fallback 到 `localStorage`（`alpha.timestamps.*`），保证标注员工作不丢。

**后续可选优化**（非本 PR 阻塞）：
- 将 `audioAPI.updateTimestamp` 改为直接 `annotationsExtApi.update`，然后删除 `api.ts`。
- 时间轴「删除片段」目前仅本地 `emit` + debounce 存 localStorage；若要持久化到 A5，需在 `handleSetTimestamps`  diff 后调用 `annotationAPI.deleteAnnotation` / `createAnnotation`。

### 2.3 新代码规范（组员必读）

1. **禁止**在组件内 `fetch('http://localhost:8000/...')` 或硬编码端口。  
2. **读数据**：使用 `backend-api.ts` 导出函数（如 `listTableItems`、`fetchAnnotationBundle`）。  
3. **写标注**：使用 `annotationsExtApi` 或 `api.ts` 薄封装（过渡期）。  
4. **媒体 URL**：必须经过 `resolveBrowserAudioUrl(source_url)` 再交给 WaveSurfer。

---

## 3. 自测清单

**前置**：A5 已启动（`uvicorn`，默认 `:8000`），已执行 `联调/sync_all_to_a5.py`，前端 `.env.local` 中 `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000`。

| # | 场景 | 操作步骤 | 预期结果 | 通过 |
|---|------|----------|----------|------|
| **T-Login-01** | 登录 | 访问 `/login`，输入有效账号密码，提交 | 跳转首页；`localStorage['alpha.auth.token']` 有值；Network 见 `POST /users/login` 200 | ☐ |
| **T-Login-02** | 未登录拦截 | 清除 token 后访问 `/` | 重定向 `/login?next=...` | ☐ |
| **T-Login-03** | 离线兜底 | 后端不可用时用离线账号（若启用） | 可进演示页，Toast 提示演示数据 | ☐ |
| **T-List-01** | 录音列表 | 登录后打开首页 | 左侧列表 ≥1 条；Network 见 3 个 `GET /tables/{audio_records\|tracks\|annotations}` | ☐ |
| **T-List-02** | 切换录音 | 点击另一条录音 | URL `?audioId=` 变化；波形/时间轴/地图刷新 | ☐ |
| **T-List-03** | 后端失败降级 | 停 A5 后刷新 | Toast「已切回演示数据」；页面仍可用 mock | ☐ |
| **T-Edit-01** | 改标注文本 | 选中时间戳 → 编辑文本 → 保存 | Toast「时间戳已更新」；Network 见 `POST .../annotations/ext/update/{id}`；刷新后文本仍在 | ☐ |
| **T-Edit-02** | 改时间范围 | 时间轴拖拽片段边界 → 触发保存 | `relative_start` / `relative_end` 在后端更新（可用 `/docs` 或 DB 核对） | ☐ |
| **T-Edit-03** | 非法 id | mock 模式下保存（无 `audioData.url`） | Toast「已本地保存」，**不**发 ext 请求 | ☐ |
| **T-Del-01** | 删标注（API） | 浏览器控制台：`annotationAPI.deleteAnnotation('<annotation_id>')` 或通过后续 UI 接线 | Network 见 `POST .../annotations/ext/delete-one`；刷新后该段消失 | ☐ |
| **T-Del-02** | 删标注（UI 本地） | 时间轴编辑模式 → 多选 → 删除 | UI 片段消失；localStorage 有 `alpha.timestamps.full.*`；**若未接 ext 删链则刷新可能恢复**（已知限制） | ☐ |

### 3.1 快速命令（联调健康检查）

```powershell
cd 联调
.\health-check.ps1
```

### 3.2 回归范围

- [ ] `npm run build` 无 TypeScript 错误  
- [ ] 登录 / 列表 / 改标注 / 删标注（API 层）四项自测全部勾选  
- [ ] `front/README.md` 与 `API_数据库对接文档.md` §15 接口表与实现一致  

---

## 4. 合并检查项（Reviewer）

- [ ] 仓库内无新增对 `/api/audio`、`/api/adsb`、`/api/annotations` 的 `fetch` 调用  
- [ ] `api.ts` 中遗留占位 GET/DELETE 已删除或标注 `@deprecated`  
- [ ] 文档已更新（README + A5 附录 §15）  
- [ ] 自测清单已由提交者在 PR 描述中粘贴勾选结果  

---

*A4 前端 · Alpha 项目组*
