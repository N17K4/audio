#!/bin/bash
# 找到嵌入式 Python 并调用 checkpoints_base.py 或 checkpoints_extra.py
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 检测嵌入式 Python
if [[ "$OSTYPE" == "darwin"* ]]; then
    PYTHON="$PROJECT_ROOT/runtime/python/mac/bin/python3"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    PYTHON="$PROJECT_ROOT/runtime/python/win/python.exe"
else
    PYTHON="$PROJECT_ROOT/runtime/python/linux/bin/python3"
fi

if [[ ! -x "$PYTHON" ]]; then
    echo "❌ 嵌入式 Python 未找到: $PYTHON"
    echo "请先运行: pnpm run setup"
    exit 1
fi

"$PYTHON" "$SCRIPT_DIR/checkpoints_base.py" "$@"
