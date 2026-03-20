#!/bin/bash
# 运行时初始化脚本：下载嵌入式 Python、引擎源码、FFmpeg、pandoc
# 被以下使用：
#   - pnpm run runtime
#   - GitHub Actions
#
# 实际工作由 scripts/runtime.py 完成（纯 Python 标准库，无第三方依赖）

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 激活 mise 环境（确保 python3 版本一致）
if command -v mise &> /dev/null; then
    eval "$(mise activate bash)"
fi

python3 "$SCRIPT_DIR/runtime.py" "$@"
