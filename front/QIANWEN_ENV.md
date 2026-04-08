# Qianwen（DashScope）环境变量说明

把千问密钥放在前端服务端环境变量里，避免在浏览器端暴露密钥。

## 必填

- `QIANWEN_API_KEY`：你的千问（DashScope）API Key

## 可选

- `QIANWEN_MODEL`：默认 `qwen-plus`
- `QIANWEN_API_BASE_URL`：默认 `https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation`

## 放置位置

- 在 `front/.env.local` 中添加上述变量

