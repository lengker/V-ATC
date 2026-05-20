# LiveATC Downloader

从 LiveATC.net 下载存档的 ATC 录音。

**注意**: 这是一个正在开发中的工具，可能不适用于所有机场。

## 功能

- 列出电台 - 查看指定机场的所有可用电台
- 单个下载 - 下载特定电台在特定日期/时间的音频
- 批量列表 - 列出电台的所有历史音频档案
- 日期范围下载 - 一次性下载指定日期范围内的所有音频
- Cloudflare 绕过 - 支持 Cookie 或 cloudscraper 库绕过 Cloudflare
- 完整错误处理 - 详细的错误提示和日志

## 下载策略

当前工具链支持的回退顺序如下：

- 直接 HTTP 下载，作为默认首选。
- cloudscraper 或头部对齐，用于部分 Cloudflare 场景。
- 浏览器辅助导出 Cookie，在真实浏览器中手工完成验证后保存会话。
- Playwright 持久化 profile 或 storage_state，尽量复用浏览器上下文。
- 模拟鼠标和键盘的浏览器交互脚本，尝试更接近人工访问行为。
- Playwright request context 下载，尽量沿用浏览器中的 cookie 和 header 状态。
- 代理池回退，作为网络层补充，不作为默认路径。

## IP 池说明

仓库内已经保留代理池能力，主要由 `app/core/config.py`、`app/services/proxy_provider.py` 和 `liveatc-downloader/proxy_pool.txt` 协同工作。可用的配置方向包括静态代理文件、代理 API 获取和轮询或随机选择。

当直连和浏览器回退都失败时，可以再考虑代理池。但从当前验证结果看，Cloudflare 更依赖完整浏览器会话，代理本身并不能替代有效 Cookie 或 storage_state。

## 本机相关配置

如果要在本机稳定运行浏览器回退，建议确认以下内容：

- Chrome 已安装并能被 Playwright 识别。
- 目标 profile 没有被正在运行的 Chrome 占用。
- Playwright 浏览器已经安装。
- 本地时钟、时区和网络连通正常。
- 浏览器扩展和企业策略不会阻止验证页面。

## 当前可用的导出方式

- 手工在浏览器中复制 Cookie。
- 运行浏览器辅助导出脚本保存 Cookie 文件。
- 运行 Playwright 相关脚本保存 storage_state。

这些方式不会删除原有流程，只是增加了更多可选的验证和保存路径。

## 安装

```bash
pip install -r requirements.txt
```

依赖项：

- `requests` - HTTP 请求
- `beautifulsoup4` - HTML 解析
- `cloudscraper` - 绕过 Cloudflare（可选）

## 使用方法

### 1. 列出机场的电台

```bash
python main.py stations VHHH --cookie-file ./.local/liveatc_cookie.txt
python main.py stations KPDX
```

输出示例：

```text
[vhhh5] - Hong Kong RXJ_5 (Radar)
 Director - 135.6
 Tower - 118.1
 Ground - 121.9
...
```

### 2. 下载单个音频文件

下载最后一个 30 分钟时段的音频：

```bash
python main.py download vhhh5 -o ./downloads --cookie-file ./.local/liveatc_cookie.txt
```

下载特定日期和时间的音频：

```bash
python main.py download vhhh5 -d Oct-01-2021 -t 2000Z -o ./downloads --cookie-file ./.local/liveatc_cookie.txt
```

### 3. 列出电台的历史档案

```bash
python main.py list vhhh5 --cookie-file ./.local/liveatc_cookie.txt
```

输出示例：

```text
找到 120 个档案:

1. VHHH5-Oct-28-2021-0000Z.mp3 (Oct-28-2021 0000Z)
2. VHHH5-Oct-28-2021-0030Z.mp3 (Oct-28-2021 0030Z)
...
```

### 4. 下载日期范围内的所有音频

下载 2021 年 10 月 1-5 日的所有 30 分钟时段音频：

```bash
python main.py download-range vhhh5 \
  --start-date 2021-10-01 \
  --end-date 2021-10-05 \
  -o ./downloads \
  --cookie-file ./.local/liveatc_cookie.txt
```

下载特定时间（例如仅下载整点和半点）：

```bash
python main.py download-range vhhh5 \
  --start-date 2021-10-01 \
  --end-date 2021-10-05 \
  --times 0000Z,0030Z,0100Z,0130Z \
  -o ./downloads \
  --cookie-file ./.local/liveatc_cookie.txt
```

### Archive base URL override (mirror)

If you have a mirror or local cache, override the archive host:

```bash
python main.py download vhhh5 -o ./downloads \
  --archive-base-url https://your-mirror.example.com \
  --cookie-file ./.local/liveatc_cookie.txt
```

You can also set `LIVEATC_ARCHIVE_BASE_URL` to apply it by default.

## Cookie 认证

某些 LiveATC 节点受 Cloudflare 保护，可能需要手动提供 Cookie：

### 获取 Cookie（使用浏览器开发者工具）

1. 打开 <https://www.liveatc.net/>
2. 按 F12 打开开发者工具
3. 切换到"网络"（Network）标签
4. 刷新页面
5. 查找任何请求（例如 search.php）
6. 在"请求标头"中找到 `Cookie` 字段
7. 复制整个 Cookie 值
8. 保存到文件：

```bash
echo "your-cookie-here" > ./.local/liveatc_cookie.txt
```

### 使用 Cookie

在任何命令中添加 `--cookie-file` 参数：

```bash
python main.py download vhhh5 -o ./downloads --cookie-file ./.local/liveatc_cookie.txt
```

或直接使用 `--cookie` 参数：

```bash
python main.py download vhhh5 -o ./downloads --cookie "cf_clearance=xxx; session=yyy"
```

### Browser-assisted cookie export (optional)

If you prefer a real browser session to capture cookies:

```bash
pip install -r requirements.txt
playwright install
python main.py cookie --output ./.local/liveatc_cookie.txt
```

This opens a browser window so you can complete any verification manually.
Once ready, press Enter in the terminal to save the Cookie file.

安全建议：不要将 Cookie 硬编码到代码或提交到仓库。推荐的安全做法：

- 将 Cookie 存为本地文件（例如 `./.local/liveatc_cookie.txt`），或在运行时通过环境变量传入。
- 在自动化或测试脚本中使用环境变量 `LIVEATC_COOKIE` 来提供 Cookie，例如：

```powershell
$env:LIVEATC_COOKIE = 'cf_clearance=...; other=...'
d:/path/to/venv/Scripts/python.exe main.py download vhhh5 -o ./downloads
```

- 确保 `.gitignore` 包含私密 Cookie 文件（例如 `/.local/`），避免误提交。

脚本和测试已改为优先从环境变量 `LIVEATC_COOKIE` 读取 Cookie，增强安全性。

## 注意事项

- **30 天限制**: LiveATC 仅保存最近 30 天的档案
- **时间格式**: 所有时间均为 Zulu（UTC）时间
- **日期格式**: 档案日期格式为 `Oct-01-2021` (月-日-年)
- **平台兼容性**: 在 Windows、macOS 和 Linux 上测试过

## 常见问题

### Q: 下载过程中遇到 403 错误怎么办？

A: 这通常是 Cloudflare 保护导致的。尝试：

1. 使用 `--cookie-file` 参数提供 Cookie
2. 确保安装了 `cloudscraper`: `pip install cloudscraper`
3. 等待几分钟后重试

### Q: 如何找到正确的电台标识符？

A: 使用 `stations` 命令列出所有电台：

```bash
python main.py stations VHHH
```

### Q: 为什么某些文件下载失败？

A: 可能的原因：

- 该时段没有可用的档案
- 网络连接问题
- Cookie 已过期

## 故障排除

启用详细日志（在代码中）并查看终端输出获取更多信息。

## 许可证

MIT
