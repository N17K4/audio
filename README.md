# AI Tool

基于 Electron + Next.js + FastAPI 的桌面音频工具。

## 功能
- Voice Changer（本地/云）
- Train Voice Pack（训练入口，当前为流程占位）
- TTS/STT（OpenAI + Gemini 最小接入）
- Realtime Dialogue / Audio Understanding（路由骨架）

## 项目结构
```text
test001/
- main.js
- preload.js
- package.json
- frontend/pages/index.tsx
- backend/main.py
- models/
  - MODEL_SETUP.txt
  - rvc_runtime.json
  - voices/default_female/
  - voices/default_male/
  - voices/default_kid/
  - uploads/
- runtime/
  - rvc/
    - README.md
    - infer_cli.py
    - engine.json
```

## 安装
```bash
pnpm run setup
```

`setup` 会自动处理后端依赖：
- 先执行 `poetry install`
- 如 lock 不匹配，自动执行 `poetry lock && poetry install`

## 运行
```bash
cd frontend
pnpm dev
cd ..
npx electron .
```

## 打包
```bash
pnpm run dist
```

## 后端健康检查
- 接口：`GET /health`
- 前端 `Backend Connected` 状态基于 `/health`
- 菜单：`View -> Open Backend Health`

## 本地模型目录
默认目录：
- `models/voices/default_female/`
- `models/voices/default_male/`
- `models/voices/default_kid/`

每个目录至少应有：
- `model.pth`
- `index.index`（可选）
- `meta.json`

## 本地真实推理（不需要逐个音色手写命令）
- 后端默认自动探测项目内引擎脚本：
  - `runtime/rvc/engine/infer.py`
  - `runtime/rvc/engine/infer_cli.py`
  - `runtime/rvc/engine/run_infer.py`
  - `runtime/rvc/engine/infer.bat`
- 如果自动探测失败，再考虑修改 `runtime/rvc/engine.json`（高级选项）

## RVC 引擎下载（项目内使用）
推荐入口：
- 官方 Releases：
  https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI/releases
- 直接包（官方提供）：
  - Nvidia：
    https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/RVC1006Nvidia.7z
  - AMD/Intel：
    https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/RVC1006AMD_Intel.7z

下载后解压到：
- `runtime/rvc/engine/`

## 新手模型下载指引
请直接打开：
- `models/MODEL_SETUP.txt`
- `models/voices/default_female/DOWNLOAD.txt`
- `models/voices/default_male/DOWNLOAD.txt`
- `models/voices/default_kid/DOWNLOAD.txt`

## 云端换声（ElevenLabs）
- 文档：
  https://elevenlabs.io/docs/api-reference/speech-to-speech/convert
- 定价：
  https://elevenlabs.io/pricing/api
- 计费说明：
  https://help.elevenlabs.io/hc/en-us/articles/24938328105873-How-much-does-Voice-Changer-cost

## 常见问题
1. `ERR_CONNECTION_REFUSED`
- 通常是后端未启动或端口不一致
- 等待顶部显示 `Backend Connected`
- 打开 `/health` 检查

2. 模型已放入但没有变声
- 检查所选音色目录是否有 `model.pth`
- 检查 `runtime/rvc/engine/` 是否有可识别脚本
- 先在终端手动运行引擎命令验证

3. 训练页面不再要求输入 `voice_id`
- 现在只输入 `Voice Name`
- `voice_id` 自动生成
