#!/bin/bash
# 统一 setup 脚本：安装所有开发和运行依赖
# 被以下使用：
#   - pnpm run setup
#   - GitHub Actions
#   - 开发者初始化
#
# 流程：
#   1. 安装 mise（工具版本管理）
#   2. mise install — 安装 Node.js、Python、Poetry 等（通过 .mise.toml）
#   3. pnpm install — 安装根目录和前端依赖
#   4. poetry install — 安装后端依赖
#   5. setup_base.py — 下载嵌入式 Python + backend pip 依赖 + 引擎 pip_packages + FFmpeg + pandoc

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# ─── 颜色输出 ──────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_step() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

log_done() {
    echo -e "${GREEN}✓ $1${NC}"
}

# ─── 检测操作系统 ──────────────────────────────────────────────────────────
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "mac"
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
        echo "win"
    else
        echo "linux"
    fi
}

OS=$(detect_os)

# ─── 1. 安装 mise（如果未安装）──────────────────────────────────────────────
log_step "1/5 检查并安装 mise"

if command -v mise &> /dev/null; then
    MISE_CMD="mise"
    log_done "mise 已安装"
else
    echo "📥 安装 mise..."
    if [[ "$OS" == "win" ]]; then
        # Windows: 从 GitHub releases 下载 mise 二进制
        MISE_LATEST=$(curl -s https://api.github.com/repos/jdx/mise/releases/latest | sed -n 's/.*"tag_name":"\([^"]*\)".*/\1/p' | head -1)
        if [ -z "$MISE_LATEST" ]; then
            echo "❌ 无法获取 mise 最新版本，使用默认版本 v2025.1.0"
            MISE_LATEST="v2025.1.0"
        fi
        MISE_URL="https://github.com/jdx/mise/releases/download/${MISE_LATEST}/mise-${MISE_LATEST}-windows-x64.zip"
        MISE_ZIP="/tmp/mise.zip"
        MISE_BIN_DIR="$HOME/.local/bin/mise/bin"
        mkdir -p "$MISE_BIN_DIR"
        echo "📥 下载 mise ${MISE_LATEST}..."
        curl -L "$MISE_URL" -o "$MISE_ZIP"
        echo "📦 解压..."
        unzip -o "$MISE_ZIP" -d "$HOME/.local/bin"  # 解压到 ~/.local/bin，得到 mise/bin/mise.exe
        rm -f "$MISE_ZIP"
        export PATH="$MISE_BIN_DIR:$PATH"
        MISE_CMD="mise"  # 现在 mise.exe 已在 PATH 中
    else
        # macOS / Linux
        curl https://mise.jdx.dev/install.sh | sh
        export PATH="$HOME/.local/bin:$PATH"
        MISE_CMD="mise"
    fi
    log_done "mise 安装完成"
fi

# ─── 2. mise install — 安装 Node.js、Python、Poetry 等 ─────────────────────
log_step "2/5 安装 Node.js、Python、Poetry 等（通过 .mise.toml）"
$MISE_CMD install
eval "$($MISE_CMD activate bash)"
log_done "工具安装完成"

# ─── 3. pnpm install — 安装前端和根目录依赖 ────────────────────────────────
log_step "3/5 安装 pnpm 依赖（根目录 + 前端）"
pnpm install
cd "$PROJECT_ROOT/frontend"
pnpm install
cd "$PROJECT_ROOT"
log_done "pnpm 依赖安装完成"

# ─── 4. poetry install — 安装后端依赖 ───────────────────────────────────────
log_step "4/5 安装 Poetry 依赖（后端）"
cd "$PROJECT_ROOT/backend"
if ! $MISE_CMD exec -- poetry install; then
    echo "⚠ poetry install 首次失败，尝试 poetry lock..."
    $MISE_CMD exec -- poetry lock
    $MISE_CMD exec -- poetry install
fi
cd "$PROJECT_ROOT"
log_done "Poetry 依赖安装完成"

# ─── 5. setup_base.py — 下载嵌入式 Python + 后端依赖 + 引擎包 + FFmpeg ─────
log_step "5/5 安装嵌入式 Python 和引擎依赖"
python3 "$SCRIPT_DIR/setup_base.py" "$@"
log_done "所有依赖安装完成"

# ─── 5.5. macOS 上也下载 Windows 运行时（仅 CI 环境）───────────────────────
# CI 环境（build-mac.yml）需要打包两个平台，本地开发不需要
if [[ "$OS" == "mac" ]] && [ -n "$GITHUB_ACTIONS" ]; then
    log_step "5.5/5 下载 Windows 运行时（用于跨平台打包）"

    # 下载 Windows Python
    WINDOWS_PYTHON_URL="https://github.com/astral-sh/python-build-standalone/releases/download/20250317/cpython-3.12.9+20250317-x86_64-pc-windows-msvc-install_only.tar.gz"
    WIN_PYTHON_DIR="$PROJECT_ROOT/runtime/win/python"
    WIN_PYTHON_ZIP="/tmp/windows-python.tar.gz"

    mkdir -p "$WIN_PYTHON_DIR"

    if [ ! -f "$WIN_PYTHON_DIR/python.exe" ]; then
        echo "📥 下载 Windows Python..."
        curl -L "$WINDOWS_PYTHON_URL" -o "$WIN_PYTHON_ZIP"
        echo "📦 解压..."
        tar -xzf "$WIN_PYTHON_ZIP" -C "$WIN_PYTHON_DIR" --strip-components=1
        rm -f "$WIN_PYTHON_ZIP"
        log_done "Windows Python 下载完成"
    else
        log_info "Windows Python 已存在"
    fi

    # 下载 Windows FFmpeg
    WINDOWS_FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    WIN_BIN_DIR="$PROJECT_ROOT/runtime/win/bin"
    WIN_FFMPEG_ZIP="/tmp/windows-ffmpeg.zip"

    mkdir -p "$WIN_BIN_DIR"

    if [ ! -f "$WIN_BIN_DIR/ffmpeg.exe" ]; then
        echo "📥 下载 Windows FFmpeg..."
        curl -L "$WINDOWS_FFMPEG_URL" -o "$WIN_FFMPEG_ZIP"
        echo "📦 解压..."
        unzip -o "$WIN_FFMPEG_ZIP" -d /tmp/ffmpeg-win && cp /tmp/ffmpeg-win/*/bin/ffmpeg.exe "$WIN_BIN_DIR/" 2>/dev/null || true
        rm -f "$WIN_FFMPEG_ZIP"
        log_done "Windows FFmpeg 下载完成"
    else
        log_info "Windows FFmpeg 已存在"
    fi
fi

echo ""
echo -e "${GREEN}✅ setup 完成！${NC}"
echo "下一步：pnpm run ml          (安装 torch、torchaudio 等 ML 包)"
echo "       pnpm run checkpoints  (下载模型权重)"
