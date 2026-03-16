#!/usr/bin/env bash
# launch-dist.sh — 以最小环境变量启动 Mac dist，模拟真实用户环境
# 前置条件：已运行 pnpm run setup && pnpm run dist

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_BIN="$SCRIPT_DIR/dist/mac-arm64/AI Workshop.app/Contents/MacOS/AI Tool"

if [ ! -f "$APP_BIN" ]; then
  echo "ERROR: App 不存在，请先运行 pnpm run dist"
  exit 1
fi

PYTHON_BIN="$SCRIPT_DIR/dist/mac-arm64/AI Workshop.app/Contents/Resources/runtime/mac/python/bin/python3"
if [ ! -f "$PYTHON_BIN" ]; then
  echo "WARN: 内置 Python 未找到，backend 将无法启动（请先 pnpm run setup）"
fi

echo "启动: $APP_BIN"
exec env -i \
  HOME="$HOME" \
  USER="${USER:-$(id -un)}" \
  TMPDIR="${TMPDIR:-/tmp}" \
  PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
  LANG="${LANG:-zh_CN.UTF-8}" \
  TERM="${TERM:-xterm-256color}" \
  "$APP_BIN"
