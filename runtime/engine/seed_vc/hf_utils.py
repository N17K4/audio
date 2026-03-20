import os
from huggingface_hub import hf_hub_download


def load_custom_model_from_hf(repo_id, model_filename="pytorch_model.bin", config_filename=None):
    # 优先使用 HF_HUB_CACHE 环境变量（由 build_engine_env 注入绝对路径）；
    # 回退到脚本所在目录上推三级的 checkpoints/hf_cache
    _cache = os.environ.get("HF_HUB_CACHE") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "checkpoints", "hf_cache"
    )
    os.makedirs(_cache, exist_ok=True)
    model_path = hf_hub_download(repo_id=repo_id, filename=model_filename, cache_dir=_cache)
    if config_filename is None:
        return model_path
    config_path = hf_hub_download(repo_id=repo_id, filename=config_filename, cache_dir=_cache)

    return model_path, config_path