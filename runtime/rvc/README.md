RVC 运行目录说明

本目录包含本地推理适配器：
- infer_cli.py
- engine.json

推荐做法：
1) 把真实 RVC 引擎脚本放到 `runtime/rvc/engine/` 目录
2) 后端会自动探测以下文件名：
   - infer.py
   - infer_cli.py
   - run_infer.py
   - infer.bat

如果自动探测失败：
- 再修改 `engine.json` 中的 `cmd_template`（高级选项）

占位符：
- {input} {output} {model} {index} {voice_dir}
