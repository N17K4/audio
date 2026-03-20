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
    WRAPPERS_ROOT,
    USER_DATA_ROOT,
    CACHE_DIR,
    LOGS_DIR,
    HF_CACHE_DIR,
    _MANIFEST,
)
from logging_setup import logger

router = APIRouter(prefix="/system", tags=["system"])


# ─── ヘルパー ──────────────────────────────────────────────────────────────────

def _dir_size(p: Path) -> int:
    """ディレクトリの合計サイズ（バイト）。存在しなければ 0。"""
    if not p.exists():
        return 0
    total = 0
    try:
        for entry in p.rglob("*"):
            if entry.is_file():
                try:
                    total += entry.stat().st_size
                except OSError:
                    pass
    except OSError:
        pass
    return total


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


def _measure_hf_cache(*repo_ids: str) -> int:
    total = 0
    for repo_id in repo_ids:
        d = HF_CACHE_DIR / f"models--{repo_id.replace('/', '--')}"
        if d.exists():
            total += _dir_size(d)
    return total


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
    """各コンポーネントの磁盘占用を返す。"""
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
        add("engine_runtime", "引擎运行环境",
            str(RUNTIME_ROOT / "engine"),
            _dir_size(RUNTIME_ROOT / "engine"),
            stage="setup", estimated_size_mb=100,
            desc="引擎源码（Fish Speech · GPT-SoVITS · Seed-VC · FaceFusion · LivePortrait 等）")

        # ── ml_base 阶段 ────────────────────────────────────────────────────
        ml_dir = RUNTIME_ROOT / "ml"
        add("python_packages", "ML 依赖包（torch · torchaudio · transformers 等）",
            str(ml_dir),
            _dir_size(ml_dir),
            stage="ml_base", estimated_size_mb=3000,
            desc="runtime_pip_packages 汇总去重安装")

        # ── checkpoints_base 阶段 ───────────────────────────────────────────
        for engine in ["fish_speech", "gpt_sovits", "seed_vc", "rvc", "faster_whisper"]:
            d = CHECKPOINTS_ROOT / engine
            add(f"{engine}_ckpt", _label(engine, "模型权重"),
                str(d), _dir_size(d),
                stage="checkpoints_base",
                estimated_size_mb=_eng(engine).get("checkpoint_files", [{}])[0].get("size_mb", 500))

        # FaceFusion checkpoint 在 engine 目录下
        ff_dir = RUNTIME_ROOT / "engine" / "facefusion"
        add("facefusion_ckpt", _label("facefusion", "ONNX 模型"),
            str(ff_dir), _dir_size(ff_dir),
            stage="checkpoints_base", estimated_size_mb=540)

        # Seed-VC 附属模型（HF cache）
        seed_vc_hf_size = _measure_hf_cache(
            "nvidia/bigvgan_v2_22khz_80band_256x", "openai/whisper-small",
        )
        for name in ["models--lj1995--VoiceConversionWebUI", "models--funasr--campplus"]:
            d = CHECKPOINTS_ROOT / name
            if d.exists():
                seed_vc_hf_size += _dir_size(d)
        add("seed_vc_hf_root", "Seed-VC 附属模型（bigvgan · whisper · rmvpe · campplus）",
            str(CHECKPOINTS_ROOT), seed_vc_hf_size,
            stage="checkpoints_base", estimated_size_mb=940)

        # 内置音色
        voices_dir = USER_DATA_ROOT / "rvc"
        add("voices", "内置音色（hutao-jp · Ayayaka · tsukuyomi 等）",
            str(voices_dir), _dir_size(voices_dir),
            stage="checkpoints_base", estimated_size_mb=325)

        # ── checkpoints_extra 阶段 ──────────────────────────────────────────
        extra_engines = [
            ("cosyvoice", "cosyvoice", 3000),
            ("sd", "sd", 2300),
            ("flux", "flux", 16500),
            ("whisper", "whisper", 1500),
        ]
        for engine, sub, est_mb in extra_engines:
            d = CHECKPOINTS_ROOT / sub
            size = _dir_size(d)
            # 加上 HF cache 中的模型
            hf_map = {e.get("repo_id", ""): True
                      for e in _eng(engine).get("hf_cache_downloads", [])}
            for repo_id in hf_map:
                if repo_id:
                    size += _measure_hf_cache(repo_id)
            add(f"{engine}_ckpt", _label(engine, "模型"),
                str(d), size,
                stage="checkpoints_extra", estimated_size_mb=est_mb)

        # HF cache 独立条目
        for engine, repo_id, est_mb in [
            ("wan", "Wan-AI/Wan2.1-T2V-1.3B-Diffusers", 15600),
            ("got_ocr", "stepfun-ai/GOT-OCR-2.0-hf", 1500),
            ("liveportrait", "KwaiVGI/LivePortrait", 1800),
        ]:
            add(f"{engine}_ckpt", _label(engine, "模型"),
                str(HF_CACHE_DIR), _measure_hf_cache(repo_id),
                stage="checkpoints_extra", estimated_size_mb=est_mb)

        # ── 缓存 ────────────────────────────────────────────────────────────
        add("cache", "缓存", str(CACHE_DIR), _dir_size(CACHE_DIR), clearable=True)
        add("logs", "日志文件", str(LOGS_DIR), _dir_size(LOGS_DIR), clearable=True)

        return rows

    return await asyncio.to_thread(_build)


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


@router.post("/install/{stage}")
async def install_stage(stage: str):
    """指定されたステージのスクリプトを実行し、SSE でログを配信。"""
    scripts = STAGE_SCRIPTS.get(stage)
    if not scripts:
        return {"ok": False, "error": f"未知阶段：{stage}"}

    try:
        py_cmd = sys.executable
    except Exception:
        return {"ok": False, "error": "Python 解释器未找到"}

    def generate():
        env = os.environ.copy()
        env["PYTHONPATH"] = str(APP_ROOT)
        env["PYTHONUNBUFFERED"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        env["RESOURCES_ROOT"] = str(RESOURCES_ROOT)
        env["CHECKPOINTS_DIR"] = str(CHECKPOINTS_ROOT)

        for script_rel in scripts:
            script_path = APP_ROOT / script_rel
            if not script_path.exists():
                yield f"data: {json.dumps({'log': f'✗ 脚本不存在：{script_rel}'})}\n\n"
                continue

            yield f"data: {json.dumps({'log': f'▶ 运行脚本: {script_rel}'})}\n\n"

            try:
                proc = subprocess.Popen(
                    [py_cmd, "-u", str(script_path)],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                    env=env,
                    encoding="utf-8",
                    errors="replace",
                )

                for line in iter(proc.stdout.readline, ""):
                    if line:
                        yield f"data: {json.dumps({'log': line.rstrip()})}\n\n"

                returncode = proc.wait()

                for line in iter(proc.stderr.readline, ""):
                    if line:
                        yield f"data: {json.dumps({'log': f'[STDERR] {line.rstrip()}'})}\n\n"

                if returncode == 0:
                    yield f"data: {json.dumps({'log': f'✓ {script_rel} 执行完成'})}\n\n"
                else:
                    yield f"data: {json.dumps({'log': f'✗ {script_rel} 失败（退出码：{returncode}）'})}\n\n"

            except Exception as e:
                yield f"data: {json.dumps({'log': f'✗ 异常：{e}'})}\n\n"

        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
