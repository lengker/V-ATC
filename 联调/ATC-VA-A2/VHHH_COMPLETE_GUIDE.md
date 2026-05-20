# VHHH LiveATC 历史音频下载 - 完整使用指南

## 项目概述

本项目提供了针对香港赤鱲角机场（VHHH）的 LiveATC 历史音频多方式下载解决方案。

### 核心特性

- [OK] 多种下载方法（httpx 直连 + cloudscraper 自动绕过）
- [OK] 多源 URL 支持（主存档 + 备用镜像）
- [OK] 浏览器辅助 Cookie 导出（完全合规）
- [OK] 自动文件名生成（基于日期和时段）
- [OK] 并行下载（可配置并发数）
- [OK] 详细日志记录
- [OK] 自动虚拟环境支持

## 绕过与回退路径

- 浏览器辅助 Cookie 导出。
- Playwright 持久化 profile 和 storage_state。
- 模拟鼠标和键盘的浏览器访问。
- Playwright request context 下载回退。
- 代理池和静态代理文件作为网络补充。

## 本机相关配置

这些配置会直接影响能否成功导出和复用浏览器会话：

- Chrome 安装路径和 Playwright channel。
- 本地 profile 是否被其他 Chrome 进程占用。
- Playwright 浏览器是否已安装。
- 本机时间、网络、DNS 和防火墙。
- 浏览器扩展和企业策略是否会影响 Cloudflare 页面。

---

## 快速入门（5 分钟）

### 第 1 步：设置虚拟环境（仅需一次）

```powershell
# Windows PowerShell
cd D:\Desktop\文件存档\Assignment\软件项目综合实践作业\ATC-VA-A2
python -m venv .venv
.venv\Scripts\activate
cd liveatc-downloader
pip install -r requirements.txt
```

```bash
# macOS / Linux
cd ~/path/to/ATC-VA-A2
python3 -m venv .venv
source .venv/bin/activate
cd liveatc-downloader
pip install -r requirements.txt
```

### 第 2 步：获取 Cookie

#### 方法 A：浏览器导出（推荐）

```powershell
# Windows
.\run.ps1 --export-cookie --count 1
```

```bash
# macOS/Linux
bash run.sh --export-cookie --count 1
```

然后：

1. 在浏览器中完成 Cloudflare 验证（如需）
2. 返回终端按 Enter 键
3. Cookie 自动保存

#### 方法 B：手动保存 Cookie

1. 打开 <https://www.liveatc.net/> 在浏览器中
2. 按 F12 -> 网络标签 -> 刷新页面
3. 找到任何请求，复制 Cookie 头值
4. 创建文件：

```powershell
# Windows
mkdir .local
"your-cookie-value" | Set-Content .local\liveatc_cookie.txt
```

```bash
# macOS/Linux
mkdir -p .local
echo "your-cookie-value" > .local/liveatc_cookie.txt
```

### 第 3 步：运行下载

```powershell
# Windows - 最简单
cd liveatc-downloader
.\run.ps1
```

```bash
# macOS/Linux - 最简单
cd liveatc-downloader
bash run.sh
```

---

## 详细使用示例

### 基础用法

```powershell
# 下载最近 5 个 30 分钟时段（2.5 小时）
.\run.ps1

# 下载最近 10 个时段（5 小时）
.\run.ps1 --count 10

# 下载整个工作日（8 小时）
.\run.ps1 --count 16

# 下载完整 24 小时
.\run.ps1 --count 48
```

### 特定日期下载

```powershell
# 下载 2024-10-28 的 12 个时段
.\run.ps1 --date 2024-10-28 --count 12

# 下载 2024-10-28 整天
.\run.ps1 --date 2024-10-28 --count 48

# 下载 2024-10 整个月（需要多次运行或自动化）
for($day = 1; $day -le 31; $day++) {
    .\run.ps1 --date "2024-10-$($day.ToString('D2'))" --count 8
}
```

### 高级用法

```powershell
# 指定输出目录
.\run.ps1 --count 10 --output-dir D:\VHHH_Archive

# 使用自定义 Cookie
.\run.ps1 --cookie "your-cookie-here" --count 5

# 指定备用镜像 URL
.\run.ps1 --base-url https://backup-archive.example.com --count 5

# 所有选项组合
.\run.ps1 `
  --date 2024-10-28 `
  --count 12 `
  --output-dir ./2024_october `
  --cookie-file .local/liveatc_cookie.txt
```

### 手动运行（完全控制）

```powershell
# 不使用启动器，直接调用
python vhhh_multimethod_download.py --help
python vhhh_multimethod_download.py --count 5 --date 2024-10-28
```

---

## 文件结构

```text
ATC-VA-A2/
├── .venv/                                  # 虚拟环境
├── liveatc-downloader/
│   ├── run.ps1                            # PowerShell 启动器
│   ├── run.sh                             # Bash 启动器
│   ├── vhhh_multimethod_download.py       # 核心下载脚本
│   ├── VHHH_MULTIMETHOD_README.md         # 详细文档
│   ├── QUICKSTART.md                      # 快速开始
│   ├── downloads/                         # 下载输出目录
│   │   ├── VHHH5-App-Dep-Dir-Zone-*.mp3
│   │   └── vhhh_download.log              # 下载日志
│   └── .local/
│       └── liveatc_cookie.txt             # Cookie 文件
├── app/
│   ├── services/
│   │   ├── archive_adapter.py             # 多源适配器框架
│   │   ├── liveatc_client.py
│   │   └── ingestion_scheduler.py
│   └── core/
│       └── config.py
├── IMPROVEMENTS_SUMMARY.md                # 本轮改进总结
├── QUICKSTART.md                          # 项目级快速开始
├── clean_symbols.py                       # 符号清理工具
└── README.md
```

---

## 输出文件

所有下载的音频文件存储在：

```text
liveatc-downloader/downloads/
├── VHHH5-App-Dep-Dir-Zone-Oct-28-2024-1200Z.mp3
├── VHHH5-App-Dep-Dir-Zone-Oct-28-2024-1230Z.mp3
├── VHHH5-Ground-Oct-28-2024-1200Z.mp3
├── ...
└── vhhh_download.log
```

### 文件名格式

```text
{IDENTIFIER}-{Mon}-{DD}-{YYYY}-{HHMM}Z.mp3

示例：
VHHH5-App-Dep-Dir-Zone-Oct-28-2024-1200Z.mp3
                      ^^^^^^^^^^^^^^  ^^^^
                      日期             时间 (UTC)
```

---

## 查看日志

### Windows

```powershell
# 查看最后 50 行
Get-Content liveatc-downloader/downloads/vhhh_download.log -Tail 50

# 实时监看
Get-Content liveatc-downloader/downloads/vhhh_download.log -Wait
```

### macOS/Linux

```bash
tail -50 liveatc-downloader/downloads/vhhh_download.log
tail -f liveatc-downloader/downloads/vhhh_download.log  # 实时监看
```

---

## 常见问题解答

### Q1：虚拟环境设置问题

**Q: 虚拟环境不存在**

```bash
python -m venv .venv
```

**Q: 如何激活虚拟环境？**

```powershell
# Windows
.venv\Scripts\activate

# macOS/Linux
source .venv/bin/activate
```

**Q: 如何检查虚拟环境是否激活？**

看命令行是否显示 `(.venv)` 前缀。

### Q2：依赖问题

**Q: 缺少依赖**

```bash
pip install -r liveatc-downloader/requirements.txt
```

**Q: 依赖版本冲突**

```bash
pip install --upgrade --force-reinstall -r liveatc-downloader/requirements.txt
```

### Q3：Cookie 问题

**Q: 没有 Cookie 文件**

```bash
.\run.ps1 --export-cookie --count 1
```

**Q: Cookie 过期了（返回 403）**

```bash
# 重新导出新 Cookie
.\run.ps1 --export-cookie --count 1
```

**Q: 如何验证 Cookie 是否有效？**

```bash
# 尝试下载 1 个文件，查看日志
.\run.ps1 --count 1
Get-Content liveatc-downloader/downloads/vhhh_download.log | Select-Object -Last 20
```

### Q4：下载问题

**Q: 返回 403 错误**

- Cookie 无效或过期
- 检查网络连接
- 尝试重新导出 Cookie

**Q: 返回 404 错误**

- 指定的日期没有可用音频
- 尝试更近的日期
- 检查文件名格式是否正确

**Q: 超时（timeout）**

- 网络连接较慢
- 尝试减少并发（修改源码）
- 在非高峰时段重试

**Q: 下载很慢**

- 此为正常行为（1-2 分钟/文件）
- 可以增加 `--count` 以利用并行下载
- 检查网络带宽

### Q5：诊断和调试

**Q: 如何运行环境诊断？**

```bash
cd liveatc-downloader
python test_environment.py
```

**Q: 如何查看详细错误？**

```bash
# 查看完整日志
Get-Content liveatc-downloader/downloads/vhhh_download.log

# 或直接运行脚本（不使用启动器）
python liveatc-downloader/vhhh_multimethod_download.py
```

---

## 环境变量（可选）

```powershell
# 设置 Cookie（覆盖文件）
$env:LIVEATC_COOKIE = "your-cookie-here"

# 设置 Cookie 文件路径
$env:LIVEATC_COOKIE_FILE = "$PWD\.local\liveatc_cookie.txt"

# 然后运行
.\run.ps1
```

---

## 系统要求

### 必需

- Python 3.7+
- pip 包管理器
- 互联网连接
- 虚拟环境（.venv）

### 可选

- Playwright（用于浏览器 Cookie 导出）

```bash
pip install playwright
playwright install chromium
```

---

## 相关文档

- [详细技术文档](VHHH_MULTIMETHOD_README.md) - 完整功能说明
- [快速开始指南](QUICKSTART.md) - 第一步指南
- [改进总结](IMPROVEMENTS_SUMMARY.md) - 本轮改动说明
- [ATC 来源研究](../ATC_SOURCES_RESEARCH.md) - 替代方案分析
- [适配器框架指南](../ARCHIVE_ADAPTER_GUIDE.md) - 多源架构

---

## 获得帮助

1. **查看日志**：`liveatc-downloader/downloads/vhhh_download.log`
2. **运行诊断**：`python liveatc-downloader/test_environment.py`
3. **查看文档**：`VHHH_MULTIMETHOD_README.md`
4. **查看示例**：`QUICKSTART.md`

---

## 许可和合规

此工具完全合规使用 LiveATC 服务：

- [OK] 使用官方网站导出的 Cookie（浏览器）
- [OK] 遵守 LiveATC 服务条款
- [OK] 合理的请求速率（最多 3 个并发）
- [OK] 记录审计日志

---

**开始下载**：

```powershell
cd liveatc-downloader
.\run.ps1 --count 5
```
