# Seed-VC 运行目录说明

本目录是 Seed-VC 声音转换引擎的适配层。

## 快速开始

1. 克隆 seed-vc 官方仓库到 `engine/` 子目录：
   ```bash
   git clone https://github.com/Plachtaa/seed-vc engine/
   ```

2. 在 `engine/` 目录下安装依赖：
   ```bash
   cd engine && pip install -r requirements.txt
   ```

3. 下载模型权重（参考官方文档），放置于 `engine/checkpoints/` 下。

4. 完成后直接使用即可，后端会自动探测以下脚本：
   - `engine/inference.py`（官方入口）
   - `engine/run_inference.py`
   - `engine/infer.py`

## 自定义命令（高级）

编辑 `engine.json` 中的 `command` 字段：
```json
{
  "command": "\"/path/to/python\" \"engine/inference.py\" --source {input} --target {voice_ref} --output {output} --diffusion-steps 10"
}
```

## 占位符

| 占位符 | 说明 |
|---|---|
| `{input}` | 源音频路径（要转换的声音） |
| `{voice_ref}` | 目标音色参考音频路径 |
| `{output}` | 输出音频路径 |
| `{diffusion_steps}` | 扩散步数（质量 vs 速度，默认 10） |

## 嵌入式 Python

若存在 `runtime/python/` 目录，适配器会自动使用其中的 Python，无需系统安装。
