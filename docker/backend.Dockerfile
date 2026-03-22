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
    pip install gradio sacrebleu soundfile

# torchaudio 2.6+ は torchcodec をデフォルトで要求するが、
# linux/arm64 に torchcodec wheel がないためパッチで soundfile に回避
RUN python <<'PYEOF'
import pathlib, sys
ta = pathlib.Path(sys.prefix) / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages" / "torchaudio" / "__init__.py"
if not ta.exists():
    print("[patch] torchaudio not found, skip"); sys.exit(0)
t = ta.read_text()
if "load_with_torchcodec" in t:
    # load() 内の torchcodec 呼び出しを soundfile fallback に置換
    t = t.replace(
        "return load_with_torchcodec(",
        "return _load_impl("  # _load_impl は sox/soundfile backend を使う
    )
    ta.write_text(t)
    print("[patch] torchaudio: torchcodec → soundfile fallback applied")
else:
    print("[patch] torchaudio: no torchcodec call found, skip")
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
        pandoc \
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
