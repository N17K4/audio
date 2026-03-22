import os
from pathlib import Path
from huggingface_hub import hf_hub_download


def _find_in_cache(cache_dir: str, repo_id: str, filename: str):
    """HF キャッシュ内のファイルを直接探す（refs/main 不要）。"""
    marker = Path(cache_dir) / f"models--{repo_id.replace('/', '--')}"
    # blobs/ 内のファイル（ハッシュ名）→ snapshots/ 内に filename で存在するか確認
    snapshots = marker / "snapshots"
    if snapshots.is_dir():
        for commit_dir in snapshots.iterdir():
            candidate = commit_dir / filename
            if candidate.is_file() and candidate.stat().st_size > 0:
                return str(candidate)
    # checkpoints スクリプトが直接ダウンロードしたファイル（cache_dir/filename）
    direct = Path(cache_dir) / filename
    if direct.is_file() and direct.stat().st_size > 0:
        return str(direct)
    return None


def load_custom_model_from_hf(repo_id, model_filename="pytorch_model.bin", config_filename=None):
    # 优先使用 HF_HUB_CACHE 环境变量（由 build_engine_env 注入绝对路径）；
    # 回退到脚本所在目录上推三级的 checkpoints/hf_cache
    _cache = os.environ.get("HF_HUB_CACHE") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "checkpoints", "hf_cache"
    )
    os.makedirs(_cache, exist_ok=True)

    # まずキャッシュ内を直接探す（オフライン対応、refs/main 不要）
    model_path = _find_in_cache(_cache, repo_id, model_filename)
    if not model_path:
        model_path = hf_hub_download(repo_id=repo_id, filename=model_filename, cache_dir=_cache)

    if config_filename is None:
        return model_path

    config_path = _find_in_cache(_cache, repo_id, config_filename)
    if not config_path:
        config_path = hf_hub_download(repo_id=repo_id, filename=config_filename, cache_dir=_cache)

    return model_path, config_path