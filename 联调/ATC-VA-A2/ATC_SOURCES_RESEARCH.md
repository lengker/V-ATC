# ATC 音频存档来源与替代方案研究

## 一、公开可用的 ATC/航空通信音频来源

### 1. **LiveATC.net**（主要来源）

**特征**：

- 提供实时和历史 ATC 音频流
- 30 天历史存档（免费用户）
- 受 Cloudflare 保护
- 需要 Session Cookie 进行持续访问

**访问方式**：

- 直接浏览器访问
- 需要 Cookie 获取历史音频

**合规性**：

- 检查服务条款（ToS）确认自动化下载的合法性
- 建议联系官方获取 API 访问权限

---

### 2. **Broadcastify.com**（官方替代方案）

**特征**：

- 7,000+ 实时音频源
- 免费和高级订阅
- 高级用户可访问 365 天历史存档
- 提供官方开发者 API（Broadcastify Calls API）
- 支持移动网页访问

**官方 API**：

- **Broadcastify Calls API**：事件驱动音频（应急/事件响应）
- **Feed Listener API**：获取订阅和统计数据
- 需要开发者账户和 API 密钥

如果后续需要把 IP 池和浏览器回退进一步抽象，Broadcastify 这类官方 API 来源更适合作为长期替代方案，因为它们更容易纳入标准化的认证和配额管理。

**适配器机会**：

```text
BroadcastifyAdapter:
  - auth: API key based
  - methods: list_feeds(), get_archive(feed_id, date_range)
  - premium_access: subscription check
  - compliance: Official API usage
```

**文档参考**：

- <https://www.radioreference.com/forums/（官方论坛）>
- Broadcastify developer portal（需注册）

---

### 3. **RadioReference.com**

**特征**：

- 基础数据库（频率、机构、电台代码）
- 社区驱动的 wiki
- 论坛讨论频繁提及 API 和工具

**可能性**：

- 查找 Broadcastify 高级订阅信息
- 获取机场/电台代码参考

---

### 4. **VATSIM / IVAO 网络**（模拟）

**注意**：这些是模拟平台，不是真实 ATC

- **VATSIM**：虚拟航空网络模拟，有音频存档
- **IVAO**：国际虚拟航空组织

---

### 5. **OpenSky Network**

**特征**：

- 飞行轨迹和元数据（不是音频）
- 提供 REST API
- 学术使用友好

**不适用原因**：

- 存储航迹数据，不存储 ATC 音频

---

### 6. **国家 / 区域机构直属存档**

**可能的官方来源**：

| 地区 | 机构 | 网站 | API |
| ------ | ------ | ------ | ----- |
| 美国 | FAA | faa.gov | 部分限制 |
| 香港 | Civil Aviation Department | cad.gov.hk | 需联系 |
| 英国 | CAA | caa.co.uk | 需申请 |
| 欧洲 | EUROCONTROL | eurocontrol.int | 仅研究用 |
| 日本 | JCAB | mlit.go.jp | 需申请 |

**获取方式**：

- 官方信息自由法（FOIA、信息公开）
- 研究/学术合作协议
- 直接联系相关部门

## 近期实现补充

- 已实现浏览器辅助 Cookie 导出。
- 已实现 Playwright 持久化 profile 和 storage_state 保存。
- 已实现模拟鼠标和键盘的浏览器访问脚本。
- 已实现 Playwright request context 的下载回退。
- 已保留代理池配置，作为网络层补充。

## 本机相关配置

这些本地配置会直接影响研究里提到的回退方式是否可用：

- Chrome 安装位置和 Playwright 浏览器是否已安装。
- 本机 profile 的读写权限和占用情况。
- 系统时间、网络、DNS 和防火墙。
- 浏览器扩展和企业策略对验证页面的影响。
