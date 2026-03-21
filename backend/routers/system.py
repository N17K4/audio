"""系统管理 API — 磁盘占用查询、缓存清理、补充安装。

统一 Electron / Docker / Web 三种运行模式，不再依赖 Electron IPC。
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, List

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from config import (
    APP_ROOT,
    RESOURCES_ROOT,
    RUNTIME_ROOT,
    CHECKPOINTS_ROOT,
    ML_PACKAGES_DIR,
    WRAPPERS_ROOT,
    USER_DATA_ROOT,
    CACHE_DIR,
    LOGS_DIR,
    HF_CACHE_DIR,
    _MANIFEST,
    load_settings,
)
from logging_setup import logger

router = APIRouter(prefix="/system", tags=["system"])


# ─── ヘルパー ──────────────────────────────────────────────────────────────────

def _dir_size(p: Path) -> int:
    """ディレクトリの合計サイズ（バイト）。存在しなければ 0。

    Windows: robocopy /L で高速取得（Python 再帰の 5〜10 倍速）
    macOS/Linux: du -s で高速取得
    """
    if not p.exists():
        return 0
    try:
        if sys.platform == "win32":
            # robocopy /L（リストのみ、コピーしない）で合計サイズを取得
            r = subprocess.run(
                ["robocopy", str(p), "NUL", "/L", "/S", "/BYTES", "/NFL", "/NDL", "/NJH"],
                capture_output=True, text=True, timeout=30,
            )
            # 最終行 "Bytes : XXXXXXXX" を探す
            # robocopy はカンマ区切り（例: 1,234,567）で出力するため strip する
            for line in reversed(r.stdout.splitlines()):
                if "Bytes" in line:
                    parts = line.split()
                    for part in parts:
                        cleaned = part.strip().replace(",", "")
                        if cleaned.isdigit() and int(cleaned) > 0:
                            return int(cleaned)
            return 0
        else:
            # macOS / Linux: du -s -b（バイト単位）
            flag = "-sb" if sys.platform == "linux" else "-sk"
            r = subprocess.run(
                ["du", flag, str(p)],
                capture_output=True, text=True, timeout=30,
            )
            if r.returncode == 0 and r.stdout.strip():
                val = int(r.stdout.split()[0])
                return val if sys.platform == "linux" else val * 1024
            return 0
    except Exception:
        return 0


def _rm_dir(p: Path) -> str | None:
    """ディレクトリを再帰的に削除。成功なら None、失敗ならエラーメッセージ。"""
    if not p.exists():
        return None
    try:
        shutil.rmtree(p)
        return None
    except Exception as e:
        return f"{p}: {e}"


def _eng(name: str) -> dict:
    return (_MANIFEST.get("engines") or {}).get(name, {})


def _ui(name: str) -> dict:
    return _eng(name).get("ui", {})


def _label(name: str, suffix: str = "") -> str:
    return f"{_ui(name).get('label', name)} {suffix}".strip()




# ─── クリア対象ディレクトリ定義 ─────────────────────────────────────────────

def _clearable_dirs() -> Dict[str, Path | None]:
    return {
        "fish_speech_engine":  RUNTIME_ROOT / "engine" / "fish_speech",
        "seed_vc_engine":      RUNTIME_ROOT / "engine" / "seed_vc",
        "gpt_sovits_engine":   RUNTIME_ROOT / "engine" / "gpt_sovits",
        "liveportrait_engine": RUNTIME_ROOT / "engine" / "liveportrait",
        "seed_vc_hf_root":     None,  # 特殊処理
        "fish_speech_ckpt":    CHECKPOINTS_ROOT / "fish_speech",
        "gpt_sovits_ckpt":     CHECKPOINTS_ROOT / "gpt_sovits",
        "seed_vc_ckpt":        CHECKPOINTS_ROOT / "seed_vc",
        "rvc_ckpt":            CHECKPOINTS_ROOT / "rvc",
        "faster_whisper_ckpt": CHECKPOINTS_ROOT / "faster_whisper",
        "facefusion_ckpt":     RUNTIME_ROOT / "engine" / "facefusion",
        "cosyvoice_ckpt":      CHECKPOINTS_ROOT / "cosyvoice",
        "sd_ckpt":             CHECKPOINTS_ROOT / "sd",
        "flux_ckpt":           CHECKPOINTS_ROOT / "flux",
        "wan_ckpt":            HF_CACHE_DIR / "models--Wan-AI--Wan2.1-T2V-1.3B-Diffusers",
        "got_ocr_ckpt":        HF_CACHE_DIR / "models--stepfun-ai--GOT-OCR-2.0-hf",
        "liveportrait_ckpt":   HF_CACHE_DIR / "models--KwaiVGI--LivePortrait",
        "whisper_ckpt":        CHECKPOINTS_ROOT / "whisper",
        "voices":              USER_DATA_ROOT / "rvc" / "user",
        "cache":               CACHE_DIR,
        "logs":                LOGS_DIR,
    }


STAGE_CLEAR_KEYS = {
    "ml_base":           ["python_packages"],
    "ml_extra":          ["python_packages"],
    "checkpoints_base":  ["fish_speech_ckpt", "gpt_sovits_ckpt", "seed_vc_ckpt",
                          "rvc_ckpt", "faster_whisper_ckpt", "facefusion_ckpt",
                          "seed_vc_hf_root", "voices"],
    "checkpoints_extra": ["cosyvoice_ckpt", "sd_ckpt", "flux_ckpt", "wan_ckpt",
                          "got_ocr_ckpt", "liveportrait_ckpt", "whisper_ckpt"],
}


# ─── GET /system/disk-usage ────────────────────────────────────────────────

@router.get("/disk-usage")
async def disk_usage():
    """各コンポーネントの実サイズを返す（OS ネイティブコマンドで高速取得）。"""
    def _build():
        rows: List[dict] = []

        def add(key: str, label: str, sub: str, size: int, *,
                stage: str = "", desc: str = "", clearable: bool = False,
                estimated_size_mb: int = 0):
            rows.append({
                "key": key, "label": label, "sub": sub, "size": size,
                "stage": stage, "desc": desc, "clearable": clearable,
                "estimatedSizeMb": estimated_size_mb,
            })

        # ── setup 阶段 ──────────────────────────────────────────────────────
        _py_dir = RUNTIME_ROOT / "python"
        _eng_dir = RUNTIME_ROOT / "engine"
        _bin_dir = RUNTIME_ROOT / "bin"
        add("setup_python", "嵌入式 Python + 后端依赖 + 引擎 pip 包",
            str(_py_dir), _dir_size(_py_dir),
            stage="setup", estimated_size_mb=300,
            desc="python-build-standalone + pyproject.toml + manifest pip_packages")
        add("setup_engine", "引擎源码",
            str(_eng_dir), _dir_size(_eng_dir),
            stage="setup", estimated_size_mb=200,
            desc="Fish Speech · Seed-VC · GPT-SoVITS · FaceFusion · LivePortrait 等")
        add("setup_bin", "FFmpeg + Pandoc",
            str(_bin_dir), _dir_size(_bin_dir),
            stage="setup", estimated_size_mb=100,
            desc="音视频处理 + 文档转换")

        # ── ml_base 阶段 ────────────────────────────────────────────────────
        _ml_size = _dir_size(ML_PACKAGES_DIR)
        add("python_packages", "ML 依赖包合计",
            str(ML_PACKAGES_DIR), _ml_size,
            stage="ml_base", estimated_size_mb=3000,
            desc="所有引擎 runtime_pip_packages 汇总去重安装到 runtime/ml/")
        # 按引擎列出各自的 runtime_pip_packages（大小无法按引擎拆分，仅展示包列表）
        for eng_name in ["fish_speech", "seed_vc", "rvc", "facefusion"]:
            pkgs = _eng(eng_name).get("runtime_pip_packages", [])
            if pkgs:
                add(f"ml_base_{eng_name}", _label(eng_name),
                    "", 0,
                    stage="ml_base",
                    desc=" · ".join(pkgs))

        # ── ml_extra 阶段 ─────────────────────────────────────────────────
        # ml_extra 与 ml_base 共享 ML_PACKAGES_DIR，无法独立计算大小，按组显示
        add("ml_extra_rag", "RAG（llama-index · faiss）",
            str(ML_PACKAGES_DIR), 0,
            stage="ml_extra", estimated_size_mb=300,
            desc="pnpm run ml:rag — 向量索引 + 检索增强生成")
        add("ml_extra_agent", "Agent（langgraph · langchain）",
            str(ML_PACKAGES_DIR), 0,
            stage="ml_extra", estimated_size_mb=100,
            desc="pnpm run ml:agent — 智能体工具调用")
        add("ml_extra_lora", "LoRA（peft · trl · datasets）",
            str(ML_PACKAGES_DIR), 0,
            stage="ml_extra", estimated_size_mb=200,
            desc="pnpm run ml:lora — 参数高效微调")

        # ── checkpoints_base 阶段 ───────────────────────────────────────────
        for engine in ["fish_speech", "gpt_sovits", "seed_vc", "rvc", "faster_whisper"]:
            d = CHECKPOINTS_ROOT / engine
            add(f"{engine}_ckpt", _label(engine, "模型权重"),
                str(d), _dir_size(d),
                stage="checkpoints_base",
                estimated_size_mb=_eng(engine).get("checkpoint_files", [{}])[0].get("size_mb", 500))

        # FaceFusion checkpoint 在 engine/.assets/models 下
        ff_dir = RUNTIME_ROOT / "engine" / "facefusion" / ".assets" / "models"
        add("facefusion_ckpt", _label("facefusion", "ONNX 模型"),
            str(ff_dir), _dir_size(ff_dir),
            stage="checkpoints_base", estimated_size_mb=540)

        # Seed-VC 附属模型（HF cache）
        seed_vc_hf_size = 0
        for rid in ["nvidia/bigvgan_v2_22khz_80band_256x", "openai/whisper-small"]:
            seed_vc_hf_size += _dir_size(HF_CACHE_DIR / f"models--{rid.replace('/', '--')}")
        for name in ["models--lj1995--VoiceConversionWebUI", "models--funasr--campplus"]:
            seed_vc_hf_size += _dir_size(CHECKPOINTS_ROOT / name)
        add("seed_vc_hf_root", "Seed-VC 附属模型（bigvgan · whisper · rmvpe · campplus）",
            str(CHECKPOINTS_ROOT), seed_vc_hf_size,
            stage="checkpoints_base", estimated_size_mb=940)

        # 内置音色
        voices_dir = USER_DATA_ROOT / "rvc"
        add("voices", "内置音色（hutao-jp · Ayayaka · tsukuyomi 等）",
            str(voices_dir), _dir_size(voices_dir),
            stage="checkpoints_base", estimated_size_mb=325)

        # ── checkpoints_extra 阶段 ──────────────────────────────────────────
        for engine, sub, est_mb in [
            ("cosyvoice", "cosyvoice", 3000),
            ("sd", "sd", 2300),
            ("flux", "flux", 16500),
            ("whisper", "whisper", 1500),
        ]:
            d = CHECKPOINTS_ROOT / sub
            size = _dir_size(d)
            for item in _eng(engine).get("hf_cache_downloads", []):
                rid = item.get("repo_id", "")
                if rid:
                    size += _dir_size(HF_CACHE_DIR / f"models--{rid.replace('/', '--')}")
            add(f"{engine}_ckpt", _label(engine, "模型"),
                str(d), size,
                stage="checkpoints_extra", estimated_size_mb=est_mb)

        # HF cache 独立条目
        for engine, repo_id, est_mb in [
            ("wan", "Wan-AI/Wan2.1-T2V-1.3B-Diffusers", 15600),
            ("got_ocr", "stepfun-ai/GOT-OCR-2.0-hf", 1500),
            ("liveportrait", "KwaiVGI/LivePortrait", 1800),
        ]:
            hf_dir = HF_CACHE_DIR / f"models--{repo_id.replace('/', '--')}"
            add(f"{engine}_ckpt", _label(engine, "模型"),
                str(HF_CACHE_DIR), _dir_size(hf_dir),
                stage="checkpoints_extra", estimated_size_mb=est_mb)

        # ── 缓存 ────────────────────────────────────────────────────────────
        add("cache", "缓存", str(CACHE_DIR), _dir_size(CACHE_DIR), clearable=True)
        add("logs", "日志文件", str(LOGS_DIR), _dir_size(LOGS_DIR), clearable=True)

        return rows

    try:
        return await asyncio.to_thread(_build)
    except Exception as exc:
        logger.error("[disk-usage] 计算失败: %s", exc, exc_info=True)
        return []


# ─── POST /system/clear/{key} ──────────────────────────────────────────────

@router.post("/clear/{key}")
async def clear_item(key: str):
    """指定された key のディレクトリを削除。"""
    dirs = _clearable_dirs()

    if key == "seed_vc_hf_root":
        errors = []
        for name in ["models--lj1995--VoiceConversionWebUI", "models--funasr--campplus"]:
            err = _rm_dir(CHECKPOINTS_ROOT / name)
            if err:
                errors.append(err)
        for name in ["models--nvidia--bigvgan_v2_22khz_80band_256x",
                      "models--openai--whisper-small"]:
            err = _rm_dir(HF_CACHE_DIR / name)
            if err:
                errors.append(err)
        return {"ok": len(errors) == 0, "error": "\n".join(errors)} if errors else {"ok": True}

    if key not in dirs:
        return {"ok": False, "error": f"未知 key：{key}"}

    target = dirs[key]
    if target is None:
        return {"ok": False, "error": f"key {key} 无关联目录"}

    # 清空目录内容（保留目录本身）
    if not target.exists():
        return {"ok": True}
    errors = []
    try:
        for entry in target.iterdir():
            try:
                if entry.is_dir():
                    shutil.rmtree(entry)
                else:
                    entry.unlink()
            except Exception as e:
                errors.append(f"{entry}: {e}")
    except Exception as e:
        errors.append(str(e))

    return {"ok": len(errors) == 0, "error": "\n".join(errors)} if errors else {"ok": True}


# ─── POST /system/reset ────────────────────────────────────────────────────

@router.post("/reset")
async def reset_all():
    """ML 依赖 + 全模型権重 + 缓存を削除（运行环境は保留）。"""
    errors = []
    all_keys = []
    for keys in STAGE_CLEAR_KEYS.values():
        all_keys.extend(keys)

    dirs = _clearable_dirs()
    for key in all_keys:
        if key == "seed_vc_hf_root":
            for name in ["models--lj1995--VoiceConversionWebUI", "models--funasr--campplus"]:
                err = _rm_dir(CHECKPOINTS_ROOT / name)
                if err:
                    errors.append(err)
        else:
            d = dirs.get(key)
            if d and d.exists():
                err = _rm_dir(d)
                if err:
                    errors.append(err)

    # checkpoints ルートも削除
    err = _rm_dir(CHECKPOINTS_ROOT)
    if err:
        errors.append(err)

    return {"ok": len(errors) == 0, "error": "\n".join(errors)} if errors else {"ok": True}


# ─── POST /system/install/{stage} (SSE) ────────────────────────────────────

STAGE_SCRIPTS = {
    "setup":             ["scripts/runtime.py"],
    "ml_base":           ["scripts/ml_base.py"],
    "ml_extra":          ["scripts/ml_extra.py"],
    "checkpoints_base":  ["scripts/checkpoints_base.py"],
    "checkpoints_extra": ["scripts/checkpoints_extra.py"],
}


# 当前正在运行的安装进程（stage → subprocess.Popen）
_INSTALL_PROCS: dict[str, subprocess.Popen] = {}


@router.post("/install/{stage}")
async def install_stage(stage: str):
    """指定されたステージのスクリプトを実行し、SSE でログを配信。"""
    scripts = STAGE_SCRIPTS.get(stage)
    if not scripts:
        return {"ok": False, "error": f"未知阶段：{stage}"}

    if stage in _INSTALL_PROCS and _INSTALL_PROCS[stage].poll() is None:
        return {"ok": False, "error": f"阶段 {stage} 正在运行中"}

    try:
        py_cmd = sys.executable
    except Exception:
        return {"ok": False, "error": "Python 解释器未找到"}

    # 从 settings 读取镜像源配置
    settings = load_settings()
    pip_mirror = settings.get("pip_mirror", "").strip()
    hf_endpoint = settings.get("hf_endpoint", "").strip().rstrip("/")

    # ログファイル：logs/download-{stage}.log（毎回クリアして新規作成）
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_file_path = LOGS_DIR / f"download-{stage}.log"

    def generate():
        # 每次下载前清空旧日志
        log_fp = open(log_file_path, "w", encoding="utf-8")

        def _emit(msg: str):
            """同时写入 SSE 和日志文件。"""
            log_fp.write(msg + "\n")
            log_fp.flush()
            return f"data: {json.dumps({'log': msg})}\n\n"

        env = os.environ.copy()
        env["PYTHONPATH"] = str(APP_ROOT)
        env["PYTHONUNBUFFERED"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"

        # 将 HF 镜像端点通过环境变量传递（_checkpoint_download.py 读取 HF_ENDPOINT）
        if hf_endpoint:
            env["HF_ENDPOINT"] = hf_endpoint

        for script_rel in scripts:
            script_path = APP_ROOT / script_rel
            if not script_path.exists():
                yield _emit(f"✗ 脚本不存在：{script_rel}")
                continue

            yield _emit(f"▶ 运行脚本: {script_rel}")

            # 构建命令行参数：传递镜像源（各脚本支持的参数不同）
            extra_args: list[str] = []
            # ml_base / ml_extra: --target でインストール先を指定
            if stage in ("ml_base", "ml_extra"):
                extra_args += ["--target", str(ML_PACKAGES_DIR)]
            if pip_mirror:
                extra_args += ["--pypi-mirror", pip_mirror]
            # --hf-endpoint 仅 checkpoints 脚本支持
            if hf_endpoint and stage in ("checkpoints_base", "checkpoints_extra"):
                extra_args += ["--hf-endpoint", hf_endpoint]

            try:
                proc = subprocess.Popen(
                    [py_cmd, "-u", str(script_path), *extra_args],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                    env=env,
                    encoding="utf-8",
                    errors="replace",
                )
                _INSTALL_PROCS[stage] = proc

                for line in iter(proc.stdout.readline, ""):
                    if line:
                        yield _emit(line.rstrip())

                returncode = proc.wait()
                _INSTALL_PROCS.pop(stage, None)

                for line in iter(proc.stderr.readline, ""):
                    if line:
                        yield _emit(f"[STDERR] {line.rstrip()}")

                if returncode == 0:
                    yield _emit(f"✓ {script_rel} 执行完成")
                elif returncode < 0:
                    yield _emit(f"⚠ {script_rel} 已中止")
                else:
                    yield _emit(f"✗ {script_rel} 失败（退出码：{returncode}）")

            except Exception as e:
                _INSTALL_PROCS.pop(stage, None)
                yield _emit(f"✗ 异常：{e}")

        yield f"data: {json.dumps({'done': True})}\n\n"
        log_fp.close()

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/install/{stage}/abort")
async def abort_install(stage: str):
    """正在运行的安装进程を中止する。"""
    proc = _INSTALL_PROCS.pop(stage, None)
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        return {"ok": True, "message": f"阶段 {stage} 已中止"}
    return {"ok": False, "error": f"阶段 {stage} 未在运行"}


# ─── GET /system/browse-dir ────────────────────────────────────────────────

@router.get("/browse-dir")
async def browse_dir(path: str = ""):
    """指定パスのサブディレクトリ一覧を返す。パス未指定時はホームディレクトリ。"""
    import platform

    if not path:
        path = str(Path.home())

    target = Path(path).resolve()

    if not target.exists():
        return {"ok": False, "error": f"路径不存在：{path}"}
    if not target.is_dir():
        return {"ok": False, "error": f"不是目录：{path}"}

    dirs: List[dict] = []
    try:
        for entry in sorted(target.iterdir(), key=lambda e: e.name.lower()):
            if entry.name.startswith("."):
                continue
            if entry.is_dir():
                dirs.append({"name": entry.name, "path": str(entry)})
    except PermissionError:
        return {"ok": False, "error": f"无权限访问：{path}"}

    parent = str(target.parent) if target.parent != target else None

    # 提供常用快捷目录
    shortcuts: List[dict] = []
    home = Path.home()
    for name, p in [
        ("主目录", home),
        ("桌面", home / "Desktop"),
        ("下载", home / "Downloads"),
        ("文档", home / "Documents"),
    ]:
        if p.exists():
            shortcuts.append({"name": name, "path": str(p)})

    return {
        "ok": True,
        "current": str(target),
        "parent": parent,
        "dirs": dirs,
        "shortcuts": shortcuts,
    }


# ─── GET /system/logs ──────────────────────────────────────────────────────

@router.get("/logs")
async def list_logs():
    """ログファイル一覧とディレクトリパスを返す。"""
    files = []
    if LOGS_DIR.exists():
        files = sorted(
            [f.name for f in LOGS_DIR.iterdir() if f.is_file() and f.suffix == ".log"],
            reverse=True,
        )
    return {"dir": str(LOGS_DIR), "files": files}


@router.get("/logs/{filename}")
async def read_log(filename: str):
    """指定されたログファイルの内容を返す。"""
    # パストラバーサル防止
    if "/" in filename or "\\" in filename or ".." in filename:
        return {"ok": False, "content": "不正なファイル名"}
    log_path = LOGS_DIR / filename
    if not log_path.exists():
        return {"ok": False, "content": f"（{filename} 暂不存在）"}
    try:
        content = log_path.read_text(encoding="utf-8", errors="replace")
        return {"ok": True, "content": content}
    except Exception as e:
        return {"ok": False, "content": f"读取失败：{e}"}
