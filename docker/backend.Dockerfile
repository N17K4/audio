# ── AI Workshop Backend（Docker 用） ──────────────────────────────────────────
# 设计思路：マルチステージビルド
#   builder: venv 内で全依存をビルド（コンパイラ付き）
#   runtime: slim イメージに venv だけコピー（コンパイラ不要、イメージ軽量）
#   checkpoints 不打入镜像，通过 volume 挂载

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

# backend Python 依赖（poetry export → pip install）
RUN pip install --no-cache-dir poetry poetry-plugin-export
COPY backend/pyproject.toml backend/poetry.lock ./backend/
RUN cd backend && poetry export -f requirements.txt --without-hashes -o requirements.txt \
    && pip install --no-cache-dir -r requirements.txt

# 引擎 runtime_pip_packages（ML 重型包）
COPY backend/wrappers/manifest.json ./backend/wrappers/manifest.json
RUN python <<'PYEOF' && pip install --no-cache-dir -r /tmp/engine_reqs.txt
import json
m = json.load(open('backend/wrappers/manifest.json'))
engines = m.get('engines', {})
SKIP = {'rvc-python', 'fairseq'}
pkgs = set()
for e in engines.values():
    for p in e.get('runtime_pip_packages', []):
        name = p.split('==')[0].split('>=')[0].split('<=')[0].split('<')[0].split('>')[0]
        if name not in SKIP:
            pkgs.add(p)
pkgs = sorted(pkgs)
print(f'安装 {len(pkgs)} 个运行时 ML 依赖...')
open('/tmp/engine_reqs.txt', 'w').write('\n'.join(pkgs))
PYEOF

# numpy バージョン統一（torch/transformers/seed_vc が numpy 2.x C API を要求）
# poetry export で入る numpy 1.x を強制的に 2.2.x へ上げる
RUN pip install --no-cache-dir "numpy>=2.2,<2.3"

# RVC 特殊安装（fairseq + rvc-python）
RUN pip install --no-cache-dir setuptools'<72' \
    && pip install --no-cache-dir --no-deps fairseq==0.12.2 \
    && pip install --no-cache-dir bitarray \
    && pip install --no-cache-dir --no-deps rvc-python==0.1.5

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
