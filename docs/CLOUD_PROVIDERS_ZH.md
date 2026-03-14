# 云端 Provider 接入说明（中文）

本文件说明 Voice Changer 在云端模式下如何使用 `elevenlabs / aws / azure / custom`。

## 1. 当前能力

- `local_rvc`：本地模型推理（离线）
- `elevenlabs`：官方语音转换 API
- `aws`：通用 AWS API Gateway/自建服务入口（按 `x-api-key` 默认鉴权）
- `azure`：通用 Azure API Management/自建服务入口（按 `api-key` 默认鉴权）
- `custom`：完全自定义 endpoint + 鉴权

注意：`aws` 和 `azure` 在本项目里是“云端服务接入模式”，不是自动托管训练。你需要准备可访问的云端转换接口。

## 2. UI 该怎么填

在 Voice Changer 页面选择云端 provider（非 `local_rvc`）后：

1. `API Key`：填你的云服务密钥  
2. `Custom Endpoint`：填你的转换接口 URL（`elevenlabs` 可留空走默认官方地址）

请求时会上传：

- `file`（音频文件）
- `voice_id`（除 elevenlabs 外会放在 form data）
- provider 相关鉴权头

## 3. 不同 Provider 默认鉴权头

- `elevenlabs` -> `xi-api-key: <API_KEY>`
- `azure` -> `api-key: <API_KEY>`
- `aws` -> `x-api-key: <API_KEY>`
- 其他 -> `Authorization: Bearer <API_KEY>`

## 4. 高级 API Key 写法（可覆盖默认鉴权）

你可以在 `API Key` 输入框使用以下格式：

- `bearer:xxxxx`
  - 强制发送 `Authorization: Bearer xxxxx`
- `header:Header-Name:xxxxx`
  - 强制发送自定义头，例如：
  - `header:Ocp-Apim-Subscription-Key:xxxxx`
  - `header:Authorization:Bearer xxxxx`

## 5. 你需要保证的云端接口返回

推荐返回 JSON：

```json
{
  "result_url": "https://your-cdn-or-api/result.wav"
}
```

或直接返回音频二进制（`audio/wav` / `audio/mpeg`），本项目会自动落盘并生成可播放 URL。

## 6. 常见错误

- `cloud_endpoint is required in cloud mode`
  - 没填 Endpoint（elevenlabs 除外）
- `api_key is required in cloud mode`
  - 没填 Key
- `Cloud provider error 4xx/5xx`
  - 云端接口鉴权或参数错误，先看后端返回 detail

