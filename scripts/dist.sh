#!/bin/bash
# 构建脚本：构建前端 + 打包 Electron
# 被以下使用：
#   - pnpm run dist / dist:win / dist:both
#   - GitHub Actions
#
# 用法：
#   scripts/dist.sh --mac               # 构建 macOS
#   scripts/dist.sh --win               # 构建 Windows
#   scripts/dist.sh --mac --publish     # 构建并上传（需要设置签名）
#
# 输出：
#   - dist/mac-arm64/         (macOS)
#   - dist/win-unpacked/      (Windows)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 激活 mise 环境（确保 pnpm、node 等可用）
if command -v mise &> /dev/null; then
    eval "$(mise activate bash)"
fi

# ─── 颜色输出 ──────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_step() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

log_done() {
    echo -e "${GREEN}✓ $1${NC}"
}

log_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# ─── 参数解析 ──────────────────────────────────────────────────────────────
TARGET=""
PUBLISH_FLAG=""

for arg in "$@"; do
    case $arg in
        --mac)
            TARGET="mac"
            ;;
        --win)
            TARGET="win"
            ;;
        --both)
            TARGET="both"
            ;;
        --publish)
            PUBLISH_FLAG="--publish"
            ;;
        *)
            echo "未知参数: $arg"
            echo "用法: dist.sh [--mac|--win|--both] [--publish]"
            exit 1
            ;;
    esac
done

# ─── 检测默认目标平台 ──────────────────────────────────────────────────────
if [ -z "$TARGET" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        TARGET="mac"
        log_info "未指定平台，检测到 macOS，默认构建 --mac"
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
        TARGET="win"
        log_info "未指定平台，检测到 Windows，默认构建 --win"
    else
        echo "✗ 无法检测平台，请手动指定 --mac、--win 或 --both"
        exit 1
    fi
fi

# ─── 1. 构建前端静态文件 ────────────────────────────────────────────────────
log_step "1/2 构建前端"
cd "$PROJECT_ROOT/frontend"
pnpm build
cd "$PROJECT_ROOT"
log_done "前端构建完成"

# ─── 2. 打包 Electron ──────────────────────────────────────────────────────
log_step "2/2 打包 Electron"
if [ "$TARGET" = "mac" ] || [ "$TARGET" = "both" ]; then
    log_info "构建 macOS..."
    npx electron-builder --mac $PUBLISH_FLAG
    log_done "macOS 打包完成"
fi

if [ "$TARGET" = "win" ] || [ "$TARGET" = "both" ]; then
    log_info "构建 Windows..."
    npx electron-builder --win $PUBLISH_FLAG
    log_done "Windows 打包完成"
fi

echo ""
echo -e "${GREEN}✅ 构建完成！${NC}"
echo "产物目录: $DIST_PATH"
echo ""
echo "下一步："
echo "  bash scripts/upload.sh --$TARGET  # 压缩 Zip + 上传到又拍云 + 创建 Release"
