#!/bin/bash
# 统一上传脚本：压缩 Zip + 上传到又拍云 + 创建 GitHub Release
# 被以下使用：
#   - 本地手动上传（开发者）
#   - GitHub Actions workflow
#
# 前置条件：
#   - 必须先运行 dist.sh 生成 Zip 文件
#   - 环境变量：UPYUN_AK、UPYUN_SK（又拍云上传）
#   - 环境变量：GITHUB_TOKEN（GitHub Release）
#
# 用法：
#   scripts/upload.sh --mac                      # 自动检测和上传 Zip
#   scripts/upload.sh --win
#   scripts/upload.sh --mac --upyun-only         # 只上传到又拍云
#   scripts/upload.sh --mac --release-only       # 只创建 GitHub Release
#   scripts/upload.sh --mac --no-compress        # Zip 已存在，直接上传

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# ─── 颜色输出 ──────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
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

log_error() {
    echo -e "${RED}✗ $1${NC}"
}

# ─── 参数解析 ──────────────────────────────────────────────────────────────
TARGET=""
UPYUN_ONLY=false
RELEASE_ONLY=false
NO_COMPRESS=false

for arg in "$@"; do
    case $arg in
        --mac)
            TARGET="mac"
            ;;
        --win)
            TARGET="win"
            ;;
        --upyun-only)
            UPYUN_ONLY=true
            ;;
        --release-only)
            RELEASE_ONLY=true
            ;;
        --no-compress)
            NO_COMPRESS=true
            ;;
        *)
            echo "未知参数: $arg"
            echo "用法: upload.sh [--mac|--win] [--upyun-only|--release-only] [--no-compress]"
            exit 1
            ;;
    esac
done

if [ -z "$TARGET" ]; then
    log_error "必须指定 --mac 或 --win"
    exit 1
fi

# ─── 获取版本号 ────────────────────────────────────────────────────────────
TAG="${CI_COMMIT_TAG:-$(git describe --tags 2>/dev/null || echo 'dev')}"
TAG="${TAG#v}"  # 移除 v 前缀
[ -z "$TAG" ] && TAG="dev"

# ─── 1. 压缩 Zip（如果需要）────────────────────────────────────────────────
if [ "$NO_COMPRESS" != "true" ]; then
    log_step "1/3 压缩产物"

    if [ "$TARGET" = "mac" ]; then
        ZIP_NAME="AI-Workshop-mac-${TAG}.zip"
        DIST_PATH="dist/mac-arm64/AI Workshop.app"

        if [ ! -d "$DIST_PATH" ]; then
            log_error "未找到 dist 目录：$DIST_PATH"
            log_info "请先运行: pnpm run dist"
            exit 1
        fi

        log_info "压缩: $DIST_PATH → $ZIP_NAME"
        ditto -c -k --sequesterRsrc --keepParent "$DIST_PATH" "$ZIP_NAME"
        log_done "macOS 压缩完成"

    elif [ "$TARGET" = "win" ]; then
        ZIP_NAME="AI-Workshop-win-${TAG}.zip"

        if [ ! -d "dist" ]; then
            log_error "未找到 dist 目录"
            log_info "请先运行: pnpm run dist:win"
            exit 1
        fi

        log_info "压缩: dist → $ZIP_NAME"
        if command -v 7z &> /dev/null; then
            7z a -tzip "$ZIP_NAME" "dist/"
        elif command -v 7zr &> /dev/null; then
            7zr a -tzip "$ZIP_NAME" "dist/"
        elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
            powershell -NoProfile -Command @"
Compress-Archive -Path 'dist/*unpacked' -DestinationPath '$ZIP_NAME' -Force
"@
        else
            tar -czf "${ZIP_NAME%.zip}.tar.gz" "dist/"
            ZIP_NAME="${ZIP_NAME%.zip}.tar.gz"
        fi
        log_done "Windows 压缩完成"
    fi
else
    # 查找已有的 Zip 文件
    if [ "$TARGET" = "mac" ]; then
        ZIP_NAME="AI-Workshop-mac-${TAG}.zip"
    else
        ZIP_NAME="AI-Workshop-win-${TAG}.zip"
    fi

    if [ ! -f "$ZIP_NAME" ]; then
        log_error "未找到 Zip 文件：$ZIP_NAME"
        exit 1
    fi
    log_info "使用现有 Zip 文件：$ZIP_NAME"
fi

# ─── 验证 Zip 存在 ──────────────────────────────────────────────────────────
if [ ! -f "$ZIP_NAME" ]; then
    log_error "压缩失败或 Zip 文件不存在"
    exit 1
fi

ZIP_SIZE=$(du -h "$ZIP_NAME" | cut -f1)
log_info "Zip 文件：$ZIP_NAME（$ZIP_SIZE）"

# ─── 2. 上传到又拍云 ────────────────────────────────────────────────────────
if [ "$RELEASE_ONLY" != "true" ]; then
    log_step "2/3 上传到又拍云"

    if [ -z "$UPYUN_AK" ] || [ -z "$UPYUN_SK" ]; then
        log_info "⚠ 环境变量 UPYUN_AK 或 UPYUN_SK 未设置，跳过上传"
    else
        # 安装 requests 库（如果需要）
        python3 -c "import requests" 2>/dev/null || pip install requests -q

        REMOTE_PATH="/releases/$TAG/$ZIP_NAME"
        log_info "上传到又拍云："
        log_info "  文件：$ZIP_NAME"
        log_info "  路径：$REMOTE_PATH"

        if python3 "$SCRIPT_DIR/upload_to_upyun.py" "audio1" "$UPYUN_AK" "$UPYUN_SK" "$ZIP_NAME" "$REMOTE_PATH"; then
            log_done "又拍云上传完成"
        else
            log_error "又拍云上传失败"
            exit 1
        fi
    fi
fi

# ─── 3. 创建 GitHub Release ─────────────────────────────────────────────────
if [ "$UPYUN_ONLY" != "true" ]; then
    log_step "3/3 创建 GitHub Release"

    if [ -z "$GITHUB_TOKEN" ]; then
        log_info "⚠ 环境变量 GITHUB_TOKEN 未设置，跳过 Release 创建"
    else
        # 检查是否有 gh 命令
        if ! command -v gh &> /dev/null; then
            log_info "⚠ gh 命令未安装，跳过 Release 创建"
        else
            log_info "创建 Release：$TAG"

            # 检查 tag 是否存在
            if git rev-parse "$TAG" &> /dev/null; then
                log_info "创建 Release 并上传 Zip..."

                if gh release create "$TAG" "$ZIP_NAME" \
                    --title "Release $TAG" \
                    --notes "AI Workshop $TAG

下载说明：安装包已附在本页面的 Assets 中。

> AI 模型（约 6 GB）将在首次启动时弹窗引导下载，支持设置 HuggingFace 镜像。" \
                    2>/dev/null || gh release upload "$TAG" "$ZIP_NAME" --clobber; then
                    log_done "GitHub Release 创建完成"
                else
                    log_error "GitHub Release 创建失败"
                    exit 1
                fi
            else
                log_info "⚠ tag 不存在：$TAG，跳过 Release 创建"
            fi
        fi
    fi
fi

echo ""
echo -e "${GREEN}✅ 上传完成！${NC}"
echo "产物：$ZIP_NAME"
