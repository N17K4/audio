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
        MISE_DIR="$HOME/.local/bin"
        mkdir -p "$MISE_DIR"
        echo "📥 下载 mise ${MISE_LATEST}..."
        curl -L "$MISE_URL" -o "$MISE_ZIP"
        echo "📦 解压..."
        unzip -o "$MISE_ZIP" -d "$MISE_DIR"
        rm -f "$MISE_ZIP"
        export PATH="$MISE_DIR/mise/bin:$PATH"
        MISE_CMD="$MISE_DIR/mise/bin/mise.exe"
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

echo ""
echo -e "${GREEN}✅ setup 完成！${NC}"
echo "下一步：pnpm run ml          (安装 torch、torchaudio 等 ML 包)"
echo "       pnpm run checkpoints  (下载模型权重)"
