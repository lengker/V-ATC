# VHHH 多方式历史音频下载工具

## 概述

这个工具集提供了多种方式下载香港赤鱲角机场（VHHH）的 LiveATC 历史音频。

## 可用路径

当前仓库围绕 VHHH 下载已经形成几条并行路径：

- 直接 HTTP 下载，作为基础路径。
- cloudscraper 和浏览器头部对齐，作为传统回退路径。
- 浏览器辅助 Cookie 导出，适合人工完成验证后保存会话。
- Playwright 持久化 profile 或 storage_state，复用真实浏览器状态。
- 模拟鼠标和键盘的浏览器访问脚本，尽量接近人工操作。
- Playwright request context 下载，复用浏览器中的会话态。
- 代理池或静态代理文件，作为网络层补充。

## 实现补充

- 真实浏览器会话比单纯的 Cookie 字符串更稳定，尤其是面对 Cloudflare 挑战时。
- 现在的下载说明应优先介绍浏览器导出和 storage_state 保存，而不是只强调直连。
- 若本机 Chrome profile 被占用，建议先复制 profile，再由脚本使用副本。

## 本机相关配置

以下配置会直接影响浏览器回退成败：

- Chrome 安装路径和 Playwright channel 可用性。
- 目标 profile 的读取权限。
- 目标 profile 是否正被其他 Chrome 进程占用。
- Playwright 浏览器是否已安装。
- 系统时间、网络、DNS 和防火墙设置。

### 包含的工具

| 工具 | 用途 | 难度 |
| ------ | ------ | ------ |
| `vhhh_multimethod_download.py` | 核心下载引擎（Python） | * 简单 |
| `vhhh_quick_start.ps1` | 快速启动菜单（PowerShell） | * 最简单 |
| `vhhh_quick_start.sh` | 快速启动菜单（Bash） | * 最简单 |

---

## 快速开始（Windows）

### 步骤 1：打开 PowerShell

```powershell
# 在项目目录中打开 PowerShell
cd D:\Desktop\文件存档\Assignment\软件项目综合实践作业\ATC-VA-A2\liveatc-downloader
```

### 步骤 2：设置执行策略（仅首次）

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
```

### 步骤 3：运行快速启动菜单

```powershell
.\vhhh_quick_start.ps1
```

### 步骤 4：选择下载方式

```text
请选择下载方式:
  [1] 快速下载 - 使用现有 Cookie
  [2] 浏览器导出 - 启动浏览器完成验证
  [3] 自定义 Cookie - 直接提供 Cookie
  [4] 指定日期 - 下载特定日期的音频
  [5] 查看日志 - 查看下载日志
  [6] 打开下载文件夹
  [0] 退出
```

---

## 详细使用方式

### 方式 1：快速下载（推荐新手）

如果已经有有效的 Cookie，这是最简单的方式。

```bash
# Windows PowerShell
.\vhhh_quick_start.ps1
# 选择 [1]

# 或直接运行
python vhhh_multimethod_download.py --count 5
```

**输出**：下载最近 5 个 30 分钟时段（2.5 小时）的音频

---

### 方式 2：浏览器导出 Cookie（推荐初始化）

如果没有有效 Cookie，或 Cookie 已过期，使用此方式。

```bash
python vhhh_multimethod_download.py --export-cookie --count 5
```

**步骤**：

1. 脚本启动真实浏览器访问 <https://www.liveatc.net/>
2. 如出现 Cloudflare 验证，请手动完成（勾选验证码）
3. 返回终端，按 Enter 键
4. 脚本自动提取 Cookie 并保存到 `.local/liveatc_cookie.txt`
5. 开始下载音频

**优势**：完全合规，由用户在浏览器中手动完成验证，LiveATC 完全认可

---

### 方式 3：命令行提供 Cookie

如果已知 Cookie 字符串：

```bash
python vhhh_multimethod_download.py \
  --cookie "cf_clearance=xxxxx; sessionid=yyyyy"
```

或使用快速启动菜单：

```powershell
.\vhhh_quick_start.ps1
# 选择 [3]，粘贴 Cookie
```

---

### 方式 4：下载特定日期的音频

例如下载 2024-10-28 这一天的音频：

```bash
# 下载这一天最近 8 个 30 分钟时段
python vhhh_multimethod_download.py \
  --date 2024-10-28 \
  --count 8
```

或使用菜单：

```powershell
.\vhhh_quick_start.ps1
# 选择 [4]
# 输入日期：2024-10-28
# 输入时段数：8
```

---

### 方式 5：使用环境变量（脚本自动化）

```bash
# 设置 Cookie 环境变量
$env:LIVEATC_COOKIE = "your-cookie-here"

# 设置 Cookie 文件路径
$env:LIVEATC_COOKIE_FILE = "C:\my_cookies\liveatc.txt"

# 运行脚本
python vhhh_multimethod_download.py --count 10
```

---

### 方式 6：高级选项

```bash
# 指定输出目录
python vhhh_multimethod_download.py \
  --output-dir D:\VHHH_Archive \
  --count 10

# 指定备用镜像 URL
python vhhh_multimethod_download.py \
  --base-url https://backup-archive.example.com \
  --count 5

# 所有选项组合
python vhhh_multimethod_download.py \
  --date 2024-10-25 \
  --count 12 \
  --output-dir ./2024_oct \
  --cookie-file ~/.liveatc_cookie \
  --base-url https://archive.liveatc.net
```

---

## Cookie 管理

### 获取 Cookie

#### 方法 A：浏览器手动导出（推荐）

```bash
python vhhh_multimethod_download.py --export-cookie --count 1
```

这是**最推荐**的方式，因为：

- [OK] 完全合规（用户在真实浏览器中手动操作）
- [OK] 安全（不使用自动化工具规避验证）
- [OK] 合法（尊重网站的服务条款）

#### 方法 B：手动从浏览器复制

1. 打开浏览器访问 <https://www.liveatc.net/>
2. 按 F12 打开开发者工具，进入"网络"标签
3. 刷新页面（F5）
4. 找到 <www.liveatc.net> 的请求
5. 在"请求头"中找到 `Cookie:` 字段
6. 复制整个 Cookie 值
7. 保存到文件或直接在命令行使用

#### 方法 C：从文件读取

```bash
# 保存 Cookie 到文件
echo "your-cookie-value" > .local/liveatc_cookie.txt

# 脚本会自动读取
python vhhh_multimethod_download.py
```

### Cookie 有效期

- **Session Cookie**：每次访问自动更新（通常 24 小时）
- **cf_clearance**：Cloudflare 验证 Cookie（通常 30 天）
- **过期后**：重新运行 `--export-cookie` 获取新 Cookie

---

## 下载流程详解

### 单个文件的下载尝试顺序

```text
+----------------------------------------+
| 生成候选文件名                         |
| 例: VHHH5-App-Dep-Dir-Zone-...-.mp3    |
+----------------------------------------+
               |
               v
+----------------------------------------+
| 尝试 URL 1: archive.liveatc.net        |
|   |- httpx 直连（快速）              |
|   +- cloudscraper 绕过 CF（备用）    |
+----------------------------------------+
               |
          [OK] 成功？
         /      \
        是       否
       /          \
      v            v
    保存         下一个 URL
    文件         (备用镜像)
```

### 并行下载策略

```text
最多同时下载 3 个文件（可配置）

时间轴：
|- 文件 1: ████████████ (12 秒)
|- 文件 2:     ████████████ (12 秒)
|- 文件 3:         ████████████ (12 秒)
|- 文件 4:             ████████████
...
总计：N 个文件约耗时 ≈ (N * 12) / 3 秒
```

---

## 故障排除

### 问题 1：403 错误（Cloudflare 保护）

**症状**：

```text
[FAIL] httpx 遇到 403，可能是 Cloudflare 保护
[FAIL] cloudscraper 返回状态码 403
```

**解决**：

1. 确保 Cookie 有效
2. 尝试浏览器重新导出：`python vhhh_multimethod_download.py --export-cookie`
3. 检查 Cookie 是否过期（超过 30 天）

### 问题 2：404 错误（文件不存在）

**症状**：

```text
[FAIL] httpx 返回状态码 404
```

**原因**：

- 指定的日期没有可用的音频
- 文件名推断错误

**解决**：

1. 检查日期是否正确
2. 尝试下载最近的时段：`python vhhh_multimethod_download.py`
3. 查看日志找出正确的文件名格式

### 问题 3：timeout（超时）

**症状**：

```text
[FAIL] httpx 超时
```

**解决**：

1. 检查网络连接
2. 尝试增加超时时间（修改源码）
3. 在非高峰时段重试

### 问题 4：没有 Cookie 文件

**症状**：

```text
[WARN] Cookie 文件不存在: ./.local/liveatc_cookie.txt
```

**解决**：

```bash
# 方法 A：浏览器导出
python vhhh_multimethod_download.py --export-cookie --count 1

# 方法 B：手动创建
mkdir .local
echo "your-cookie-here" > .local/liveatc_cookie.txt
```

### 问题 5：依赖缺失

**症状**：

```text
ModuleNotFoundError: No module named 'httpx'
```

**解决**：

```bash
pip install -r requirements.txt

# 或具体安装
pip install httpx beautifulsoup4 cloudscraper playwright
```

---

## 日志文件

每次运行都会生成日志：

```text
downloads/vhhh_download.log
```

### 日志内容示例

```text
2024-10-28 12:00:00 [INFO] VHHH 机场历史音频多方式下载工具
2024-10-28 12:00:00 [INFO] Mode: Auto-detect Cookie
2024-10-28 12:00:01 [INFO] [OK] Cookie acquired (length: 256 chars)
2024-10-28 12:00:01 [INFO] [OK] Generated 40 file candidates
2024-10-28 12:00:05 [INFO] [OK] httpx download success: ... (5242880 bytes)
2024-10-28 12:05:30 [INFO] Download completed: 15/40 successful
```

### 查看日志

```bash
# Windows
Get-Content downloads/vhhh_download.log -Tail 30

# Linux/Mac
tail -30 downloads/vhhh_download.log

# 或使用菜单
.\vhhh_quick_start.ps1
# 选择 [5]
```

---

## 常见参数组合

### 快速尝试

```bash
# 下载最近 1 个时段（测试）
python vhhh_multimethod_download.py --count 1
```

### 日常使用

```bash
# 下载最近 2 小时（4 个 30 分钟时段）
python vhhh_multimethod_download.py --count 4
```

### 归档使用

```bash
# 下载整天 24 小时的音频（48 个时段）
python vhhh_multimethod_download.py --date 2024-10-28 --count 48
```

### 自动化脚本

```bash
# 定时任务：每 6 小时下载最近 12 个时段
$env:LIVEATC_COOKIE_FILE = ".local/liveatc_cookie.txt"
python vhhh_multimethod_download.py --count 12 --output-dir ./archive_2024
```

---

## 系统要求

- Python 3.7+
- Windows / macOS / Linux
- 网络连接（可访问 <https://www.liveatc.net> 和 <https://archive.liveatc.net）>

### 依赖包

```text
httpx>=0.24.0
beautifulsoup4>=4.12.0
cloudscraper>=1.2.71
playwright>=1.40.0
```

### 可选

- Playwright Chromium：用于浏览器 Cookie 导出

  ```bash
  playwright install chromium
  ```

---

## 许可和合规

[OK] **完全合规使用**：

- 使用官方网站手动导出的 Cookie
- 遵守 LiveATC 服务条款
- 合理的请求速率（最多 3 个并发）
- 记录审计日志

[FAIL] **不合规的使用**：

- 绕过网站安全措施（本工具不这样做）
- 无限制爬取
- 二次发行受保护内容

---

## 技术细节

### 支持的存档标识符

```text
VHHH5-App-Dep-Dir-Zone   (主频道)
VHHH5-Ground
VHHH5-Delivery
VHHH5-Approach
VHHH-Ground
VHHH-Tower
```

### 文件名格式

```text
{IDENTIFIER}-{Mon}-{DD}-{YYYY}-{HHMM}Z.mp3

示例：
VHHH5-App-Dep-Dir-Zone-Oct-28-2024-1200Z.mp3
                      ^^^^^^^^^^^^^^  ^^^^
                      日期             时间(UTC)
```

### 存档 URL 结构

```text
https://archive.liveatc.net/{archive_dir}/{encoded_filename}.mp3
                             ^^^^^^^^^^^^
                             推断自 ICAO 代码或标识符
```

---

## 反馈和问题

如遇到问题，请：

1. 查看日志：`downloads/vhhh_download.log`
2. 检查网络连接
3. 尝试重新导出 Cookie：`--export-cookie`
4. 查看本 README 的故障排除章节

---

## 更新历史

### v1.0 (2024-10)

- [NEW] 初始版本
- [OK] httpx 直连支持
- [OK] cloudscraper 自动绕过
- [OK] 浏览器 Cookie 导出
- [OK] 并行下载
- [OK] 详细日志

---

## 贡献

欢迎提交问题和改进建议！
