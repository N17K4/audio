# syntax=docker/dockerfile:1
# ── AI Workshop Backend（Docker 用） ──────────────────────────────────────────
# 设计思路：マルチステージビルド
#   builder: venv 内で全依存をビルド（コンパイラ付き）
#   runtime: slim イメージに venv だけコピー（コンパイラ不要、イメージ軽量）
#   checkpoints 不打入镜像，通过 volume 挂载
#
# レイヤー順序の方針：
#   変更頻度が低く重いもの（torch 等 ML）を先に、
#   変更頻度が高く軽いもの（backend deps）を後に。
#   pip cache mount で再ダウンロードを回避。

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Stage 1: builder — コンパイラ付き、venv 内で全依存をインストール
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FROM python:3.12-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        git \
    && rm -rf /var/lib/apt/lists/*

# venv を作成（全 pip install が同じ環境を共有 → 依存解決が正確）
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# ── Layer 1: ML 重型包（最も遅い・最も変わらない → 最上位） ─────────────────
# manifest.json だけ先に COPY → ML パッケージだけ変わらなければキャッシュヒット
COPY backend/wrappers/manifest.json ./backend/wrappers/manifest.json
RUN --mount=type=cache,target=/root/.cache/pip \
    python <<'PYEOF' && pip install -r /tmp/engine_reqs.txt
import json
m = json.load(open('backend/wrappers/manifest.json'))
engines = m.get('engines', {})
SKIP = {'rvc-python', 'fairseq'}
pkgs = set()
for p in m.get('shared_runtime_pip_packages', []):
    pkgs.add(p)
for e in engines.values():
    for p in e.get('runtime_pip_packages', []):
        name = p.split('==')[0].split('>=')[0].split('<=')[0].split('<')[0].split('>')[0]
        if name not in SKIP:
            pkgs.add(p)
pkgs = sorted(pkgs)
print(f'安装 {len(pkgs)} 个运行时 ML 依赖...')
open('/tmp/engine_reqs.txt', 'w').write('\n'.join(pkgs))
PYEOF

# ── Layer 2: ML 追加依存（gradio 等、変更少） ─────────────────────────────
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install gradio sacrebleu soundfile python-multipart "tokenizers>=0.21,<0.22" "setuptools<72"

# torchaudio 2.6+ は torchcodec をデフォルトで要求するが、
# linux/arm64 に torchcodec wheel がないため _torchcodec.py をパッチし
# torchcodec 未インストール時は soundfile にフォールバック
RUN python <<'PYEOF'
import pathlib, sys
sp = pathlib.Path(sys.prefix) / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages"
tc = sp / "torchaudio" / "_torchcodec.py"
if not tc.exists():
    print("[patch] torchaudio/_torchcodec.py not found, skip"); sys.exit(0)
t = tc.read_text()
if "raise ImportError" in t and "soundfile fallback" not in t:
    # ImportError を raise する代わりに soundfile で読み込む
    t = t.replace(
        'raise ImportError(\n            "TorchCodec is required for load_with_torchcodec. Please install torchcodec to use this function."',
        '# soundfile fallback（torchcodec unavailable on this platform）\n'
        '            import soundfile as _sf, torch as _torch, numpy as _np\n'
        '            _data, _sr = _sf.read(str(filepath))\n'
        '            if _data.ndim == 1: _data = _data.reshape(1, -1)\n'
        '            else: _data = _data.T\n'
        '            return _torch.from_numpy(_np.array(_data, copy=True)).float(), _sr  # soundfile fallback'
    )
    tc.write_text(t)
    print("[patch] torchaudio: torchcodec → soundfile fallback applied")
else:
    print("[patch] torchaudio: already patched or no raise found, skip")
PYEOF

# ── Layer 3: RVC 特殊安装 + fairseq patch（変更少） ────────────────────────
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install setuptools'<72' \
    && pip install --no-deps fairseq==0.12.2 \
    && pip install bitarray \
    && pip install --no-deps rvc-python==0.1.5

# fairseq 0.12.2 + Python 3.12 互換パッチ（dataclass / hydra の _MISSING_TYPE エラー回避）
RUN python <<'PYEOF'
import pathlib, re, sys
venv = pathlib.Path(sys.prefix) / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages"
fairseq_dir = venv / "fairseq"
if not fairseq_dir.exists():
    print("[patch] fairseq not found, skip"); sys.exit(0)
init_py = fairseq_dir / "__init__.py"
if init_py.exists():
    t = init_py.read_text()
    if "hydra_init()" in t and "pass  # Py3.12" not in t:
        t = t.replace("hydra_init()", "try:\n    hydra_init()\nexcept Exception:\n    pass  # Py3.12")
        init_py.write_text(t)
for f in [fairseq_dir / "dataclass" / "configs.py",
          fairseq_dir / "models" / "transformer" / "transformer_config.py"]:
    if not f.exists(): continue
    t = f.read_text()
    t = re.sub(r'^(\s+\w+:\s+\w+)\s*=\s*([A-Z]\w+)\(\)$',
               lambda m: f'{m.group(1)} = field(default_factory={m.group(2)})' if m.group(2) not in ('Optional','List','Dict','Tuple','Any') else m.group(0),
               t, flags=re.MULTILINE)
    t = re.sub(r'field\(default=([A-Z]\w+)\(\)\)', r'field(default_factory=\1)', t)
    f.write_text(t)
print("[patch] fairseq Python 3.12 patch applied")
PYEOF

# ── Layer 4: backend 軽量依存（pyproject.toml 変更時のみ再実行） ───────────
RUN pip install --no-cache-dir poetry poetry-plugin-export
COPY backend/pyproject.toml backend/poetry.lock ./backend/
RUN --mount=type=cache,target=/root/.cache/pip \
    cd backend && poetry export -f requirements.txt --without-hashes -o requirements.txt \
    && pip install -r requirements.txt

# numpy バージョン統一（ML + backend 両方のインストール後に最終調整）
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install "numpy>=2.2,<2.3"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Stage 2: runtime — コンパイラなし、軽量イメージ
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FROM python:3.12-slim AS runtime

WORKDIR /app

# ── 実行時システム依赖のみ（コンパイラなし） ────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        git \
        curl \
        libsndfile1 \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# ── builder の venv をコピー（全パッケージが正しく解決済み） ──────────────────
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# ── 引擎源码 clone（通过 runtime.py --engines-only） ─────────────────────────
COPY backend/wrappers/ ./backend/wrappers/
COPY scripts/runtime.py scripts/_checkpoint_download.py ./scripts/
RUN python scripts/runtime.py --engines-only

# ── engine パッチ（HF オフライン対応） ──────────────────────────────────────
# Seed-VC hf_utils.py: HF_HUB_CACHE から直接検索（オフラインモード対応）
# Seed-VC BigVGAN: HF repo_id → ローカル snapshot パスに自動変換
RUN python <<'PYEOF'
import pathlib, os

# 1) hf_utils.py パッチ
hf = pathlib.Path("/app/runtime/engine/seed_vc/hf_utils.py")
if hf.exists():
    hf.write_text('''import os
from pathlib import Path
from huggingface_hub import hf_hub_download

def _find_in_cache(cache_dir, repo_id, filename):
    marker = Path(cache_dir) / f"models--{repo_id.replace('/', '--')}"
    snapshots = marker / "snapshots"
    if snapshots.is_dir():
        for commit_dir in snapshots.iterdir():
            candidate = commit_dir / filename
            if candidate.is_file() and candidate.stat().st_size > 0:
                return str(candidate)
    direct = Path(cache_dir) / filename
    if direct.is_file() and direct.stat().st_size > 0:
        return str(direct)
    return None

def load_custom_model_from_hf(repo_id, model_filename="pytorch_model.bin", config_filename=None):
    _cache = os.environ.get("HF_HUB_CACHE") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "checkpoints", "hf_cache")
    os.makedirs(_cache, exist_ok=True)
    model_path = _find_in_cache(_cache, repo_id, model_filename)
    if not model_path:
        model_path = hf_hub_download(repo_id=repo_id, filename=model_filename, cache_dir=_cache)
    if config_filename is None:
        return model_path
    config_path = _find_in_cache(_cache, repo_id, config_filename)
    if not config_path:
        config_path = hf_hub_download(repo_id=repo_id, filename=config_filename, cache_dir=_cache)
    return model_path, config_path
''')
    print("[patch] seed_vc/hf_utils.py patched")

# 2) BigVGAN パッチ: from_pretrained で HF cache snapshot を自動解決
bv = pathlib.Path("/app/runtime/engine/seed_vc/modules/bigvgan/bigvgan.py")
if bv.exists():
    t = bv.read_text()
    patch = '''
        # === PATCH: HF repo_id → ローカル cache snapshot パスに変換 ===
        if not os.path.isdir(model_id):
            _hf_cache = os.environ.get("HF_HUB_CACHE", "")
            if _hf_cache:
                _marker = os.path.join(_hf_cache, f"models--{model_id.replace('/', '--')}", "snapshots")
                if os.path.isdir(_marker):
                    _snaps = [d for d in os.listdir(_marker) if os.path.isdir(os.path.join(_marker, d))]
                    if _snaps:
                        model_id = os.path.join(_marker, _snaps[0])
        # === END PATCH ===
'''
    if "=== PATCH:" not in t:
        t = t.replace(
            '"""Load Pytorch pretrained weights and return the loaded model."""',
            '"""Load Pytorch pretrained weights and return the loaded model."""' + patch)
        bv.write_text(t)
        print("[patch] seed_vc BigVGAN from_pretrained patched")
PYEOF

# ── backend 源码 ─────────────────────────────────────────────────────────────
COPY backend/ ./backend/

# ── 环境变量 ─────────────────────────────────────────────────────────────────
ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=8000
ENV PYTHONPATH=/app/backend
ENV PYTHONIOENCODING=utf-8

# ── 数据目录（运行时 volume 挂载） ──────────────────────────────────────────
VOLUME ["/app/runtime/checkpoints", "/app/user_data", "/app/cache", "/app/logs"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["python", "backend/main.py"]
