import json
import os
import subprocess
from pathlib import Path
from typing import Dict, List, Optional

from config import (
    APP_ROOT,
    RESOURCES_ROOT,
    RUNTIME_ROOT,
    WRAPPERS_ROOT,
    _MANIFEST,
    CHECKPOINTS_ROOT,
    ML_PACKAGES_DIR,
)
from logging_setup import logger


# ---------------------------------------------------------------------------
# 引擎レジストリ（データ駆動）
# ---------------------------------------------------------------------------
# 各引擎の探索パスとコマンドテンプレート書式を一元管理する。
#
# candidates      : detect_engine_script() が順番に存在確認するパスリスト
# template_format : 自動構築時のコマンドテンプレート（{script} はスクリプトパスに置換）
# engine_json_key : engine.json 内で読み取るキー名（デフォルト "command"）
#
# engine.json は常に WRAPPERS_ROOT / <engine> / "engine.json" を参照する。

_ENGINE_REGISTRY: Dict[str, dict] = {
    "rvc": {
        "candidates": [
            RUNTIME_ROOT / "engine" / "rvc" / "infer.py",
            WRAPPERS_ROOT / "rvc" / "infer_cli.py",
            APP_ROOT / "rvc" / "infer_cli.py",
            APP_ROOT / "tools" / "rvc" / "infer_cli.py",
        ],
        "template_format": '--input {input} --output {output} --model {model} --index {index}',
        "engine_json_key": "cmd_template",
    },
    "fish_speech": {
        "candidates": [
            WRAPPERS_ROOT / "fish_speech" / "inference.py",
            RUNTIME_ROOT / "engine" / "fish_speech" / "tools" / "inference_engine.py",
            RUNTIME_ROOT / "engine" / "fish_speech" / "fish_speech" / "inference.py",
        ],
        "template_format": '--text {text} --output {output} --voice_ref {voice_ref}',
    },
    "gpt_sovits": {
        "candidates": [
            WRAPPERS_ROOT / "gpt_sovits" / "inference.py",
            RUNTIME_ROOT / "engine" / "gpt_sovits" / "inference.py",
        ],
        "template_format": '--text {text} --output {output} --voice_ref {voice_ref}',
    },
    "seed_vc": {
        "candidates": [
            WRAPPERS_ROOT / "seed_vc" / "inference.py",
            RUNTIME_ROOT / "engine" / "seed_vc" / "inference.py",
            RUNTIME_ROOT / "engine" / "seed_vc" / "run_inference.py",
            RUNTIME_ROOT / "engine" / "seed_vc" / "seed_vc" / "inference.py",
        ],
        "template_format": '--source {input} --target {voice_ref} --output {output}',
    },
    "whisper": {
        "candidates": [
            WRAPPERS_ROOT / "whisper" / "inference.py",
        ],
        "template_format": '--input {input} --output {output} --model {model}',
    },
    "faster_whisper": {
        "candidates": [
            WRAPPERS_ROOT / "faster_whisper" / "inference.py",
        ],
        "template_format": '--input {input} --output {output} --model {model}',
    },
    "got_ocr": {
        "candidates": [
            WRAPPERS_ROOT / "got_ocr" / "inference.py",
        ],
        "template_format": '--input {input} --output {output} --model {model}',
    },
    "liveportrait": {
        "candidates": [
            WRAPPERS_ROOT / "liveportrait" / "inference.py",
        ],
        "template_format": '--source {source} --audio {audio} --output {output}',
    },
    "facefusion": {
        "candidates": [
            WRAPPERS_ROOT / "facefusion" / "inference.py",
            RUNTIME_ROOT / "engine" / "facefusion" / "facefusion.py",
        ],
        "template_format": '--source {source} --target {target} --output {output}',
    },
    "wan": {
        "candidates": [
            WRAPPERS_ROOT / "wan" / "inference.py",
        ],
        "template_format": '--prompt {prompt} --output {output} --model {model}',
    },
    "flux": {
        "candidates": [
            WRAPPERS_ROOT / "flux" / "inference.py",
        ],
        "template_format": '--prompt {prompt} --output {output}',
    },
    "sd": {
        "candidates": [
            WRAPPERS_ROOT / "sd" / "inference.py",
        ],
        "template_format": '--prompt {prompt} --output {output}',
    },
}


def detect_engine_script(engine: str) -> str:
    """汎用エンジンスクリプト探索。

    _ENGINE_REGISTRY に登録された候補パスを順番に確認し、
    最初に見つかったスクリプトの絶対パスを返す。見つからなければ空文字列。
    """
    cfg = _ENGINE_REGISTRY.get(engine)
    if cfg is None:
        logger.warning("[detect-%s] レジストリに未登録のエンジン", engine)
        return ""
    candidates: List[Path] = cfg["candidates"]
    for p in candidates:
        exists = p.exists()
        logger.debug("[detect-%s] 检查 %s -> %s", engine, p, "OK" if exists else "NG")
        if exists:
            logger.debug("[detect-%s] 找到脚本: %s", engine, p)
            return str(p.resolve())
    logger.warning("[detect-%s] 未找到任何推理脚本，检查路径: %s", engine, [str(c) for c in candidates])
    return ""


def get_engine_command_template(engine: str) -> str:
    """汎用コマンドテンプレート取得。

    解析優先度:
    1) wrappers/<engine>/engine.json の command (または engine_json_key で指定されたキー)
    2) 自動探索スクリプト + 嵌入式 Python からテンプレートを構築
    """
    cfg = _ENGINE_REGISTRY.get(engine)
    if cfg is None:
        logger.warning("[%s-cmd] レジストリに未登録のエンジン", engine)
        return ""

    engine_json_key: str = cfg.get("engine_json_key", "command")
    engine_json_path = WRAPPERS_ROOT / engine / "engine.json"

    # 1) engine.json から読み取り
    logger.debug("[%s-cmd] engine.json=%s exists=%s", engine, engine_json_path, engine_json_path.exists())
    if engine_json_path.exists():
        try:
            data = json.loads(engine_json_path.read_text(encoding="utf-8"))
            cmd = (data.get(engine_json_key) or "").strip()
            if cmd:
                logger.debug("[%s-cmd] engine.json %s: %s", engine, engine_json_key, cmd)
                return cmd
            logger.debug("[%s-cmd] engine.json %s 为空，转入自动探测", engine, engine_json_key)
        except Exception as e:
            logger.warning("[%s-cmd] engine.json 读取失败: %s", engine, e)

    # 2) 自動探索 + テンプレート構築
    script = detect_engine_script(engine)
    if script:
        try:
            py = get_embedded_python()
            tpl = f'"{py}" "{script}" {cfg["template_format"]}'
            logger.debug("[%s-cmd] 自动构建命令模板: %s", engine, tpl)
            return tpl
        except RuntimeError as e:
            logger.error("[%s-cmd] 获取嵌入式 Python 失败: %s", engine, e)
            return ""
    logger.warning("[%s-cmd] 未找到推理脚本，本地推理不可用", engine)
    return ""


# ---------------------------------------------------------------------------
# 後方互換エイリアス — 既存の呼び出し元がそのまま動作するように維持
# ---------------------------------------------------------------------------

def detect_rvc_infer_script() -> str:
    return detect_engine_script("rvc")

def detect_fish_speech_script() -> str:
    return detect_engine_script("fish_speech")

def detect_gpt_sovits_script() -> str:
    return detect_engine_script("gpt_sovits")

def detect_seed_vc_script() -> str:
    return detect_engine_script("seed_vc")

def detect_whisper_script() -> str:
    return detect_engine_script("whisper")

def detect_faster_whisper_script() -> str:
    return detect_engine_script("faster_whisper")

def detect_got_ocr_script() -> str:
    return detect_engine_script("got_ocr")

def detect_liveportrait_script() -> str:
    return detect_engine_script("liveportrait")

def detect_facefusion_script() -> str:
    return detect_engine_script("facefusion")

def detect_wan_script() -> str:
    return detect_engine_script("wan")

def detect_flux_script() -> str:
    return detect_engine_script("flux")

def get_fish_speech_command_template() -> str:
    return get_engine_command_template("fish_speech")

def get_gpt_sovits_command_template() -> str:
    return get_engine_command_template("gpt_sovits")

def get_seed_vc_command_template() -> str:
    return get_engine_command_template("seed_vc")

def get_whisper_command_template() -> str:
    return get_engine_command_template("whisper")

def get_faster_whisper_command_template() -> str:
    return get_engine_command_template("faster_whisper")

def get_default_rvc_command_template() -> str:
    return get_engine_command_template("rvc")

def get_got_ocr_command_template() -> str:
    return get_engine_command_template("got_ocr")

def get_liveportrait_command_template() -> str:
    return get_engine_command_template("liveportrait")

def get_facefusion_command_template() -> str:
    return get_engine_command_template("facefusion")

def get_wan_command_template() -> str:
    return get_engine_command_template("wan")

def get_flux_command_template() -> str:
    return get_engine_command_template("flux")


# ---------------------------------------------------------------------------
# ユーティリティ（固有ロジックのためリファクタリング対象外）
# ---------------------------------------------------------------------------

def get_embedded_python() -> str:
    """返回平台对应的嵌入式 Python 路径。

    Linux / Docker 环境：直接返回当前解释器（sys.executable），无需嵌入式 Python。
    macOS / Windows：查找 runtime/python/{mac,win}/ 下的嵌入式 Python。
    找不到则抛出 RuntimeError。
    """
    import sys as _sys
    # Linux（含 Docker 容器）：容器自身的 Python 即可用，无需嵌入式二进制
    if _sys.platform == "linux":
        logger.debug("[embedded-python] Linux 环境，使用 sys.executable: %s", _sys.executable)
        return _sys.executable
    if _sys.platform == "win32":
        candidates = [
            RUNTIME_ROOT / "python" / "win" / "python.exe",
        ]
        platform_name = "win"
    else:
        candidates = [
            RUNTIME_ROOT / "python" / "mac" / "bin" / "python3",
            RUNTIME_ROOT / "python" / "mac" / "bin" / "python",
        ]
        platform_name = "mac"
    for p in candidates:
        exists = p.exists()
        logger.debug("[embedded-python] 检查 %s → %s", p, "✓" if exists else "✗")
        if exists:
            resolved = str(p.resolve())
            logger.debug("[embedded-python] 使用 %s", resolved)
            return resolved
    msg = f"嵌入式 Python 未找到。请将对应平台的 Python 放置于 runtime/python/{platform_name}/ 目录。"
    logger.error("[embedded-python] %s", msg)
    raise RuntimeError(msg)


def get_ffmpeg_binary() -> str:
    """返回 FFmpeg 可执行路径。优先打包的静态二进制，开发模式回退到系统 ffmpeg。"""
    import sys as _sys
    import shutil as _shutil
    if _sys.platform == "win32":
        bundled = RUNTIME_ROOT / "bin" / "win" / "ffmpeg.exe"
    elif _sys.platform == "linux":
        bundled = RUNTIME_ROOT / "bin" / "linux" / "ffmpeg"
    else:
        bundled = RUNTIME_ROOT / "bin" / "mac" / "ffmpeg"
    if bundled.exists():
        logger.debug("[ffmpeg] 使用打包二进制: %s", bundled)
        return str(bundled.resolve())
    system_ffmpeg = _shutil.which("ffmpeg")
    if system_ffmpeg:
        logger.debug("[ffmpeg] 使用系统 ffmpeg: %s", system_ffmpeg)
        return system_ffmpeg
    logger.warning("[ffmpeg] 未找到 FFmpeg，媒体转换功能不可用")
    return ""


def get_pandoc_binary() -> str:
    """返回 pandoc 可执行路径。优先打包的静态二进制，开发模式回退到系统 pandoc。"""
    import sys as _sys
    import shutil as _shutil
    if _sys.platform == "win32":
        bundled = RUNTIME_ROOT / "bin" / "win" / "pandoc.exe"
    elif _sys.platform == "linux":
        bundled = RUNTIME_ROOT / "bin" / "linux" / "pandoc"
    else:
        bundled = RUNTIME_ROOT / "bin" / "mac" / "pandoc"
    if bundled.exists():
        logger.debug("[pandoc] 使用打包二进制: %s", bundled)
        return str(bundled.resolve())
    system_pandoc = _shutil.which("pandoc")
    if system_pandoc:
        logger.debug("[pandoc] 使用系统 pandoc: %s", system_pandoc)
        return system_pandoc
    logger.warning("[pandoc] 未找到 pandoc，文档互转功能不可用")
    return ""


def build_engine_env(engine: str) -> Dict[str, str]:
    """为子进程构建包含 CHECKPOINT_DIR 注入的环境变量字典。"""
    engines = (_MANIFEST.get("engines") or {})
    cfg = engines.get(engine, {})
    env_key = cfg.get("env_key") or f"{engine.upper()}_CHECKPOINT_DIR"
    # HF 缓存：统一在 checkpoints/hf_cache/ 下，与其他模型权重同级管理
    hf_cache = str(CHECKPOINTS_ROOT / "hf_cache")
    # os.environ を継承するが、PYTHONPATH から backend/ 本体を除外する。
    # backend/models.py が GPT-SoVITS 等の engine 内 models パッケージと衝突するため。
    # Docker 環境では PYTHONPATH=/app/backend が設定されており、これが衝突の原因になる。
    _clean_env = dict(os.environ)
    _backend_dir = str(Path(__file__).resolve().parent.parent)
    _old_pypath = _clean_env.get("PYTHONPATH", "")
    if _old_pypath:
        _clean_env["PYTHONPATH"] = os.pathsep.join(
            p for p in _old_pypath.split(os.pathsep) if p != _backend_dir
        )
    merged = {
        **_clean_env,
        env_key: get_checkpoint_dir(engine),
        "HF_HUB_CACHE": hf_cache,
        "HUGGINGFACE_HUB_CACHE": hf_cache,   # 兼容旧版
        "TOKENIZERS_PARALLELISM": "false",
    }
    # 全引擎强制离线：所有 HF 模型须通过 pnpm run checkpoints 预先下载。
    # seed_vc: worker 起動時に refs/main 補完 + hf_utils.py で直接キャッシュ検索により
    # オフラインでも from_pretrained() が動作する。
    merged["HF_HUB_OFFLINE"] = "1"
    merged["TRANSFORMERS_OFFLINE"] = "1"
    # macOS ARM CPU 下 fairseq/HuBERT 在不启用 MPS fallback 时会 SIGSEGV；
    # 对所有引擎统一开启，允许 MPS 不支持的算子自动降级到 CPU
    merged["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
    # fairseq（RVC 依赖）会导入 tensorboardX，而 tensorboardX 使用 protobuf C 扩展
    # 新版 protobuf (>=4.x) 的 C 扩展禁用了 Descriptor 直接创建，导致 ImportError。
    # 强制使用纯 Python 实现以规避此问题（对所有引擎无副作用）。
    merged["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"
    # Windows 子进程 stderr/stdout 默认使用系统编码（cp1252/cp932 等），
    # 导致中文错误信息丢失或乱码。强制 UTF-8 保证诊断输出完整。
    merged["PYTHONIOENCODING"] = "utf-8"
    # OpenBLAS/OMP スレッド制限：VM や低メモリ環境で
    # "Memory allocation still failed after 10 retries" を防止。
    # 推理は主に GPU（CUDA/MPS）で行うため、CPU 側のスレッド削減は影響なし。
    merged.setdefault("OPENBLAS_NUM_THREADS", "1")
    merged.setdefault("OMP_NUM_THREADS", "4")
    merged.setdefault("MKL_NUM_THREADS", "4")
    ffmpeg_bin = get_ffmpeg_binary()
    if ffmpeg_bin:
        ffmpeg_dir = str(Path(ffmpeg_bin).resolve().parent)
        merged["PATH"] = ffmpeg_dir + os.pathsep + merged.get("PATH", "")
        merged.setdefault("FFMPEG_BINARY", ffmpeg_bin)
    # runtime/ml/ を PYTHONPATH に追加（torch, torchaudio 等の ML パッケージ）
    ml_dir = str(ML_PACKAGES_DIR)
    existing_pypath = merged.get("PYTHONPATH", "")
    if os.path.isdir(ml_dir) and ml_dir not in existing_pypath.split(os.pathsep):
        merged["PYTHONPATH"] = ml_dir + (os.pathsep + existing_pypath if existing_pypath else "")
    # Windows: --target でインストールした numpy の C 拡張（.pyd）が依存する DLL は
    # numpy.libs/ に格納される。Python 3.8+ では DLL 検索パスが制限されているため、
    # PATH に追加しないと「numpy._core has no attribute 'multiarray'」エラーになる。
    if os.name == "nt" and os.path.isdir(ml_dir):
        numpy_libs = os.path.join(ml_dir, "numpy.libs")
        torch_lib = os.path.join(ml_dir, "torch", "lib")
        for dll_dir in (numpy_libs, torch_lib):
            if os.path.isdir(dll_dir):
                merged["PATH"] = dll_dir + os.pathsep + merged.get("PATH", "")
    # backend/wrappers/ を PYTHONPATH に追加（_common.py を import するため）
    # backend/ 全体を入れると backend/models.py が GPT-SoVITS engine の models パッケージと衝突する
    wrappers_dir = str(WRAPPERS_ROOT)
    existing_pypath = merged.get("PYTHONPATH", "")
    if wrappers_dir not in existing_pypath.split(os.pathsep):
        merged["PYTHONPATH"] = wrappers_dir + (os.pathsep + existing_pypath if existing_pypath else "")
    if engine == "facefusion":
        # FaceFusion 独立 site-packages：
        #   dev:  runtime/engine/facefusion/.packages/
        #   prod: _USER_DATA_BASE/runtime/engine/facefusion/.packages/
        # _checkpoint_download.py の get_facefusion_packages_dir() と同じロジック。
        facefusion_pkgs = RUNTIME_ROOT / "engine" / "facefusion" / ".packages"
        if not facefusion_pkgs.is_dir():
            # prod: CHECKPOINTS_ROOT = <USER_DATA_BASE>/checkpoints
            #       → .parent = <USER_DATA_BASE> → runtime/engine/facefusion/.packages
            facefusion_pkgs = CHECKPOINTS_ROOT.parent / "runtime" / "engine" / "facefusion" / ".packages"
        merged["PYTHONPATH"] = str(facefusion_pkgs) + os.pathsep + merged.get("PYTHONPATH", "")
        merged["PYTHONNOUSERSITE"] = "1"
    return merged


def get_checkpoint_dir(engine: str) -> str:
    """从 manifest 读取引擎的 checkpoint 目录，返回绝对路径字符串。

    解析优先级：
    1) 引擎专属环境变量（如 SEED_VC_CHECKPOINT_DIR）
    2) resources/checkpoints/<engine>/ — 打包时预置的 checkpoint（默认安装引擎）
    3) CHECKPOINTS_ROOT/<engine>/ — userData，用于用户事后通过引导下载的可选引擎
    """
    engines = (_MANIFEST.get("engines") or {})
    cfg = engines.get(engine, {})
    env_key = cfg.get("env_key") or f"{engine.upper()}_CHECKPOINT_DIR"
    env_val = os.getenv(env_key, "").strip()
    if env_val:
        return env_val
    rel = cfg.get("checkpoint_dir", f"runtime/checkpoints/{engine}")
    sub = rel[len("runtime/checkpoints/"):] if rel.startswith("runtime/checkpoints/") else None
    # checkpoints は常にユーザーディレクトリ（CHECKPOINTS_ROOT）から読み取る。
    # アプリバンドル内の残骸よりユーザーが最新ダウンロードしたものを優先する。
    if sub is not None:
        return str((CHECKPOINTS_ROOT / sub).resolve())
    return str((RESOURCES_ROOT / rel).resolve())


# ---------------------------------------------------------------------------
# FFmpeg 硬件加速探测
# ---------------------------------------------------------------------------

# 探测顺序：按优先级排列，第一个可用的胜出
# (hwaccel_decode, encoder, 说明)
_HW_CANDIDATES = [
    ("videotoolbox", "h264_videotoolbox", "Apple VideoToolbox (Mac)"),
    ("cuda",         "h264_nvenc",         "NVIDIA NVENC"),
    ("qsv",          "h264_qsv",           "Intel Quick Sync"),
    ("d3d11va",      "h264_amf",           "AMD AMF"),
]

_ffmpeg_hw_cache: "dict | None" = None


def detect_ffmpeg_hwaccel() -> dict:
    """探测当前机器可用的 FFmpeg 硬件加速编码器。

    返回字典：
      {
        "hwaccel":  "videotoolbox" | "cuda" | ... | None,
        "encoder":  "h264_videotoolbox" | "h264_nvenc" | ... | "libx264",
        "label":    "Apple VideoToolbox (Mac)" | ... | "软件编码 (libx264)",
      }
    结果在进程内缓存，多次调用不重复探测。
    """
    global _ffmpeg_hw_cache
    if _ffmpeg_hw_cache is not None:
        return _ffmpeg_hw_cache

    ffmpeg = get_ffmpeg_binary()
    if not ffmpeg:
        _ffmpeg_hw_cache = {"hwaccel": None, "encoder": "libx264", "label": "软件编码 (libx264，ffmpeg 未找到)"}
        return _ffmpeg_hw_cache

    import tempfile, sys as _sys

    # 生成一个 1 帧黑色测试视频（lavfi），用于编码探测
    for hwaccel, encoder, label in _HW_CANDIDATES:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            out = tmp.name
        try:
            result = subprocess.run(
                [
                    ffmpeg, "-y",
                    "-f", "lavfi", "-i", "color=black:s=64x64:r=1:d=0.1",
                    "-c:v", encoder,
                    "-frames:v", "1",
                    "-f", "null", "-",
                ],
                capture_output=True, timeout=10,
            )
            if result.returncode == 0:
                logger.info("[ffmpeg-hw] 使用硬件加速: %s (%s)", encoder, label)
                _ffmpeg_hw_cache = {"hwaccel": hwaccel, "encoder": encoder, "label": label}
                return _ffmpeg_hw_cache
        except Exception:
            pass
        finally:
            try:
                Path(out).unlink(missing_ok=True)
            except Exception:
                pass

    logger.info("[ffmpeg-hw] 无可用硬件加速，回退软件编码 libx264")
    _ffmpeg_hw_cache = {"hwaccel": None, "encoder": "libx264", "label": "软件编码 (libx264)"}
    return _ffmpeg_hw_cache


def build_ffmpeg_video_encode_flags(hw_accel: str = "auto") -> list:
    """返回 FFmpeg 视频编码参数列表。

    hw_accel 取值：
      "auto"          — 自动探测最优硬件加速
      "videotoolbox"  — Apple VideoToolbox（Mac）
      "nvenc"         — NVIDIA NVENC
      "qsv"           — Intel Quick Sync
      "amf"           — AMD AMF
      "software"      — 纯软件 libx264
    """
    preset = (hw_accel or "auto").strip().lower()
    _PRESET_MAP = {
        "videotoolbox": ["-c:v", "h264_videotoolbox"],
        "nvenc":        ["-c:v", "h264_nvenc"],
        "qsv":          ["-c:v", "h264_qsv"],
        "amf":          ["-c:v", "h264_amf"],
        "software":     ["-c:v", "libx264", "-preset", "fast", "-crf", "23"],
    }
    if preset in _PRESET_MAP:
        logger.info("[ffmpeg-hw] 用户指定加速方式: %s", preset)
        return _PRESET_MAP[preset]
    # auto
    hw = detect_ffmpeg_hwaccel()
    if hw["hwaccel"]:
        return ["-c:v", hw["encoder"]]
    return ["-c:v", "libx264", "-preset", "fast", "-crf", "23"]
