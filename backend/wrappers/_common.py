"""wrapper 脚本共通ユーティリティ。

全 wrapper が子プロセスとして実行されるため、backend.config は import 不可。
__file__ ベースでプロジェクトルートを解決する。
"""

import os
import sys
from pathlib import Path

# wrapper 脚本は backend/wrappers/{engine}/ にある → 3 段上がると backend/
# さらに 1 段上がるとプロジェクトルート（dev / prod 共通）
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def get_root() -> Path:
    """runtime/ 等が存在するルートディレクトリを返す。"""
    return _PROJECT_ROOT


def get_runtime_root() -> Path:
    return get_root() / "runtime"


def get_embedded_python() -> str:
    """嵌入式 Python パスを返す。見つからなければ sys.exit(1)。"""
    # Linux（含 Docker 容器）：容器自身の Python をそのまま使う
    if sys.platform == "linux":
        return sys.executable
    rt = get_runtime_root()
    if sys.platform == "win32":
        candidates = [rt / "python" / "win" / "python.exe"]
        platform_name = "win"
    else:
        candidates = [
            rt / "python" / "mac" / "bin" / "python3",
            rt / "python" / "mac" / "bin" / "python",
        ]
        platform_name = "mac"
    for p in candidates:
        if p.exists():
            return str(p)
    print(
        f"嵌入式 Python 未找到，请将 Python 放置于 runtime/python/{platform_name}/",
        file=sys.stderr,
    )
    sys.exit(1)


def get_engine_dir(engine: str) -> Path:
    """runtime/engine/{engine}/ のパスを返す（存在チェックなし）。"""
    return get_runtime_root() / "engine" / engine


def get_checkpoint_dir(engine: str) -> Path:
    """checkpoint ディレクトリを返す。環境変数 > CHECKPOINTS_DIR > runtime/checkpoints/{engine}。"""
    env_key = f"{engine.upper()}_CHECKPOINT_DIR"
    env_val = os.environ.get(env_key, "").strip()
    if env_val:
        return Path(env_val)
    ckpt_env = os.environ.get("CHECKPOINTS_DIR", "").strip()
    if ckpt_env:
        return Path(ckpt_env) / engine
    return get_runtime_root() / "checkpoints" / engine
