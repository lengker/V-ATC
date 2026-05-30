# ATC 语音标注系统前端

可视化 ATC 地空通话语音标注系统的前端应用（A-4 模块）。

## 功能特性

- ✅ **语音数据可视化** - 使用 WaveSurfer.js 显示音频波形
- ✅ **ADSB 航迹可视化** - 使用 Leaflet 地图显示飞机航迹
- ✅ **时间戳可视化** - 显示和管理语音识别的时间戳
- ✅ **语音文本可视化** - 显示和编辑识别文本
- ✅ **辅助标注信息可视化** - 显示音频和飞机相关信息
- ✅ **标注信息修改** - 支持编辑时间戳和文本
- ✅ **时间漫游** - 通过进度条控制播放时间，同步显示航迹

## 技术栈

- **Next.js 15** - React 框架
- **TypeScript** - 类型安全
- **Tailwind CSS** - 样式框架
- **Radix UI** - 无障碍组件库
- **WaveSurfer.js** - 音频波形可视化
- **React Leaflet** - 地图组件
- **Lucide React** - 图标库

## 项目结构

```
front/
├── src/
│   ├── app/              # Next.js 应用路由
│   │   ├── layout.tsx    # 根布局
│   │   ├── page.tsx      # 主页面
│   │   └── globals.css   # 全局样式
│   ├── components/        # React 组件
│   │   ├── ui/           # 基础 UI 组件
│   │   ├── audio-waveform.tsx    # 音频波形组件
│   │   ├── adsb-map.tsx           # ADSB 地图组件
│   │   ├── timestamp-list.tsx     # 时间戳列表组件
│   │   ├── text-editor.tsx        # 文本编辑器组件
│   │   ├── auxiliary-info.tsx     # 辅助信息组件
│   │   └── annotation-page.tsx    # 主标注页面
│   ├── lib/              # 工具函数
│   │   ├── utils.ts      # 通用工具
│   │   └── api.ts        # API 接口
│   ├── hooks/            # React Hooks
│   │   └── use-toast.ts  # Toast 通知 Hook
│   └── types/            # TypeScript 类型定义
│       └── index.ts
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── next.config.ts
```

## 安装和运行

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

应用将在 http://localhost:3000 启动。

### 构建生产版本

```bash
npm run build
npm start
```

## 环境变量

创建 `.env.local` 文件：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

## API 接口（A5 真实路由）

前端 **仅** 通过 `src/lib/backend-api.ts`（读 + 认证）与 `src/lib/api.ts`（标注写回薄封装）访问 A5。**不存在** `/api/audio/*` 等 Next 占位路由。

详细契约见仓库根目录 [`backend/API_数据库对接文档.md`](../backend/API_数据库对接文档.md) **§15 附录**。

### 标注员工作台 — 最小接口对照表

| 功能 | 前端函数 | HTTP | 调用方 |
|------|----------|------|--------|
| 健康检查 | `getHealth()` | `GET /health` | 联调脚本 |
| 登录 | `loginWithBackend()` | `POST /users/login` | `AuthContext` |
| 注册 | `registerWithBackend()` | `POST /users/register` | 登录页 |
| 当前用户 | `getCurrentUser()` | `GET /users/me` | `AuthContext` |
| 录音+航迹+标注列表 | `fetchAnnotationBundle()` | `GET /tables/audio_records`<br>`GET /tables/tracks`<br>`GET /tables/annotations` | `app/page.tsx` |
| 音频文件 | `resolveBrowserAudioUrl()` | GET `source_url`（绝对 URL） | `AudioWaveform` |
| 改标注 | `audioAPI.updateTimestamp()` → ext | `POST /tables/annotations/ext/update/{id}` | `annotation-page.tsx` |
| 增标注 | `annotationAPI.createAnnotation()` → ext | `POST /tables/annotations/ext/create` | （预留） |
| 删标注 | `annotationAPI.deleteAnnotation()` → ext | `POST /tables/annotations/ext/delete-one` | （预留；UI 删片段暂存 localStorage） |

> 写操作自动附带 `Authorization: Bearer <token>`（见 `backend-api.ts` 内 `requestJson`）。

## 使用说明

1. **访问标注页面**
   - 直接访问 `http://localhost:3000` 会尝试加载默认音频
   - 或使用 `?audioId=xxx` 参数指定音频 ID

2. **播放音频**
   - 点击播放按钮开始播放
   - 使用进度条拖动到指定时间点
   - 地图和航迹会自动同步到当前时间

3. **编辑时间戳**
   - 点击时间戳列表中的任意项查看详情
   - 点击"编辑"按钮修改文本和时间范围
   - 保存后更新会同步到后端

4. **查看航迹**
   - 地图上显示所有飞机的航迹线
   - 点击飞机标记查看详细信息
   - 选择特定飞机后，航迹线会高亮显示

5. **辅助信息**
   - 右侧面板显示音频元数据和飞机信息
   - 切换标签页查看不同类型的信息

## 设计风格

本项目参考了 CareerCompass 项目的设计风格：
- 使用相同的颜色系统和 Tailwind 配置
- 采用 Radix UI 组件库
- 现代化的卡片式布局
- 响应式设计，支持移动端

## 开发注意事项

1. **地图组件**：需要确保 Leaflet CSS 正确加载
2. **音频组件**：WaveSurfer.js 需要 Web Audio API 支持
3. **API 对接**：确保后端 API 接口符合预期格式
4. **类型安全**：所有 API 调用都有 TypeScript 类型定义

## 许可证

MIT License
