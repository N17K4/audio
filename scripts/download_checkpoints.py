#!/usr/bin/env python3
"""
检查并下载 Fish Speech / Seed-VC / Whisper / RVC 所需的 checkpoint 文件。
从 runtime/manifest.json 读取文件清单，仅下载缺失的文件。
下载完成后自动计算 sha256 并写回 manifest.json，后续运行自动校验完整性。

pip 依赖安装和 FFmpeg 下载由 scripts/setup-engines.py 负责（pnpm run setup 阶段）。

用法：
    python scripts/download_checkpoints.py                       # 检查并下载所有缺失
    python scripts/download_checkpoints.py --engine fish_speech  # 只处理某个引擎
    python scripts/download_checkpoints.py --check-only          # 只检查，不下载
    python scripts/download_checkpoints.py --force               # 强制重新下载所有
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
from pathlib import Path

# ─── Windows 控制台 UTF-8 修复 ────────────────────────────────────────────────
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ─── CI 环境检测：非 TTY 时禁用 HuggingFace hub 进度条 ─────────────────────
_IS_TTY: bool = sys.stdout.isatty()
if not _IS_TTY:
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

# ─── HuggingFace 镜像端点（中国用户可设置 HF_ENDPOINT=https://hf-mirror.com）──
HF_ENDPOINT: str = os.getenv("HF_ENDPOINT", "https://huggingface.co").rstrip("/")


def apply_hf_endpoint(url: str) -> str:
    """将 URL 中的 huggingface.co 替换为配置的镜像端点。"""
    if HF_ENDPOINT != "https://huggingface.co":
        return url.replace("https://huggingface.co", HF_ENDPOINT)
    return url


# ─── JSON Lines 进度输出（供 Electron IPC 使用）────────────────────────────
_JSON_MODE: bool = False


def emit(msg_type: str, **kwargs) -> None:
    """输出结构化进度消息。--json-progress 时输出 JSON Lines，否则普通打印。"""
    if _JSON_MODE:
        print(json.dumps({"type": msg_type, **kwargs}, ensure_ascii=False), flush=True)
    elif msg_type == "log":
        print(kwargs.get("message", ""), flush=True)



def parse_hf_url(url: str) -> tuple[str, str, str] | None:
    """从 HuggingFace resolve URL 解析出 (repo_id, filename, revision)。"""
    prefix = "https://huggingface.co/"
    if not url.startswith(prefix):
        return None
    rest = url[len(prefix):]
    parts = rest.split("/")
    if len(parts) < 5 or parts[2] != "resolve":
        return None
    repo_id = f"{parts[0]}/{parts[1]}"
    revision = parts[3]  # commit SHA 或 "main"
    filename = "/".join(parts[4:])
    return repo_id, filename, revision


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def get_hf_token() -> str | None:
    token = os.getenv("HF_TOKEN", "").strip()
    if token:
        return token
    token_file = Path.home() / ".cache" / "huggingface" / "token"
    if token_file.exists():
        return token_file.read_text().strip() or None
    return None


_hf_login_done = False


def ensure_hf_login() -> bool:
    global _hf_login_done
    if _hf_login_done:
        return get_hf_token() is not None
    print()
    print("  ── HuggingFace 登录 ────────────────────────────────────────")
    print("  下载需要 HuggingFace 账号。请前往以下地址生成 Read token：")
    print("  https://huggingface.co/settings/tokens")
    print()
    try:
        import getpass
        token = getpass.getpass("  粘贴 token（输入不可见，直接回车跳过）: ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return False
    if not token:
        _hf_login_done = True
        return False
    from huggingface_hub import login
    login(token=token)
    _hf_login_done = True
    return True


def download_via_hf_hub(repo_id: str, filename: str, dest_dir: Path, revision: str = "main") -> Path:
    from huggingface_hub import hf_hub_download
    token = get_hf_token()
    print(f"  [HF] {repo_id}/{filename}  revision={revision}"
          + ("  (已登录)" if token else "  (未登录)"))
    local_path = hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        revision=revision,
        local_dir=str(dest_dir),
        token=token,
    )
    return Path(local_path)


def download_via_requests(url: str, dest_path: Path) -> None:
    import requests
    url = apply_hf_endpoint(url)
    print(f"  [HTTP] {url}")
    emit("log", message=f"  [HTTP] {url}")
    resp = requests.get(url, stream=True, timeout=60)
    resp.raise_for_status()
    total = int(resp.headers.get("content-length", 0))
    done = 0
    last_reported = -1
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    with open(dest_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=65536):
            f.write(chunk)
            done += len(chunk)
            if total:
                pct = done * 100 // total
                mb = done / 1024 / 1024
                if _IS_TTY and not _JSON_MODE:
                    print(f"\r  {pct}% ({mb:.1f} MB)", end="", flush=True)
                elif pct // 2 != last_reported:
                    last_reported = pct // 2
                    if not _JSON_MODE:
                        print(f"  {pct}% ({mb:.1f} MB)", flush=True)
                    emit("progress", file=dest_path.name, pct=pct,
                         mb=round(mb, 1), total_mb=round(total / 1024 / 1024, 1))
    if not _JSON_MODE:
        print()


def check_and_download(
    engine_name: str,
    cfg: dict,
    resources_root: Path,
    check_only: bool,
    force: bool,
    sha256_updates: dict,
    checkpoints_base: "Path | None" = None,
) -> bool:
    checkpoint_dir_rel = cfg.get("checkpoint_dir", f"checkpoints/{engine_name}")
    if checkpoints_base is not None and checkpoint_dir_rel.startswith("checkpoints/"):
        checkpoint_dir = checkpoints_base / checkpoint_dir_rel[len("checkpoints/"):]
    else:
        checkpoint_dir = resources_root / checkpoint_dir_rel
    checkpoint_files: list[dict] = cfg.get("checkpoint_files", [])

    if not checkpoint_files:
        print(f"  [{engine_name}] 无 checkpoint 文件定义，跳过")
        return True

    all_ok = True
    for file_cfg in checkpoint_files:
        rel_path: str = file_cfg["path"]
        required: bool = file_cfg.get("required", True)
        url: str = file_cfg.get("url", "")
        expected_sha256: str = file_cfg.get("sha256", "")
        size_mb: float = file_cfg.get("size_mb", 0)

        dest = checkpoint_dir / rel_path

        if force and dest.exists():
            print(f"  --force: 删除旧文件 {rel_path}")
            dest.unlink()

        if dest.exists() and dest.stat().st_size > 0:
            if expected_sha256:
                actual = sha256_file(dest)
                if actual != expected_sha256:
                    print(f"  ✗ {rel_path}  SHA256 不匹配（预期={expected_sha256[:8]}… 实际={actual[:8]}…）")
                    if check_only:
                        all_ok = False
                        continue
                    print(f"    SHA256 不匹配，重新下载...")
                    dest.unlink()
                else:
                    print(f"  ✓ {rel_path}  ({dest.stat().st_size // 1024 // 1024} MB)  sha256={expected_sha256[:12]}…")
                    continue
            else:
                actual = sha256_file(dest)
                sha256_updates.setdefault(engine_name, {})[rel_path] = actual
                print(f"  ✓ {rel_path}  ({dest.stat().st_size // 1024 // 1024} MB)  sha256 已记录")
                continue

        size_str = f"~{size_mb:.0f} MB" if size_mb else "未知大小"
        status = "必填" if required else "可选"
        print(f"  ✗ {rel_path}  [{status}] {size_str}")
        emit("file_start", engine=engine_name, file=rel_path, size_mb=size_mb)

        if check_only:
            if required:
                all_ok = False
            continue

        if not url:
            print(f"    没有下载链接，请手动放置到: {dest}")
            if required:
                all_ok = False
            continue

        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            hf_info = parse_hf_url(url)
            if hf_info:
                repo_id, filename, revision = hf_info
                if _JSON_MODE:
                    # JSON 模式优先走 HTTP 直连，进度条实时更新；鉴权失败再回退 hf_hub
                    try:
                        download_via_requests(url, dest)
                    except Exception as http_err:
                        if "401" in str(http_err) or "403" in str(http_err):
                            emit("log", message=f"    需要认证，尝试 hf_hub_download…")
                            downloaded = download_via_hf_hub(repo_id, filename, checkpoint_dir, revision)
                            if downloaded.resolve() != dest.resolve():
                                downloaded.rename(dest)
                        else:
                            raise
                else:
                    try:
                        downloaded = download_via_hf_hub(repo_id, filename, checkpoint_dir, revision)
                        if downloaded.resolve() != dest.resolve():
                            downloaded.rename(dest)
                    except Exception as hf_err:
                        is_auth_err = ("401" in str(hf_err) or "403" in str(hf_err)
                                       or "authentication" in str(hf_err).lower()
                                       or "Unauthorized" in str(hf_err))
                        is_import_err = isinstance(hf_err, ImportError)
                        if is_import_err:
                            print(f"    [提示] huggingface_hub 未安装，回退到 HTTP 直连下载")
                            download_via_requests(url, dest)
                        elif is_auth_err:
                            try:
                                download_via_requests(url, dest)
                            except Exception as http_err:
                                if "401" in str(http_err) or "403" in str(http_err):
                                    if ensure_hf_login():
                                        print(f"  [HF] 重试下载 {filename}")
                                        downloaded = download_via_hf_hub(repo_id, filename, checkpoint_dir, revision)
                                        if downloaded.resolve() != dest.resolve():
                                            downloaded.rename(dest)
                                    else:
                                        raise http_err
                                else:
                                    raise http_err
                        else:
                            raise
            else:
                download_via_requests(url, dest)

            if dest.exists() and dest.stat().st_size > 0:
                actual = sha256_file(dest)
                sha256_updates.setdefault(engine_name, {})[rel_path] = actual
                print(f"    ✓ 下载完成  {dest.stat().st_size // 1024 // 1024} MB  sha256={actual[:12]}…")
                emit("file_done", engine=engine_name, file=rel_path, ok=True)
                if expected_sha256 and actual != expected_sha256:
                    print(f"    ⚠ SHA256 与 manifest 预期不符，文件可能已更新，已记录新哈希")
            else:
                print(f"    ✗ 下载后文件异常")
                emit("file_done", engine=engine_name, file=rel_path, ok=False, error="下载后文件异常")
                if required:
                    all_ok = False
        except Exception as e:
            print(f"    ✗ 下载失败: {e}")
            emit("file_done", engine=engine_name, file=rel_path, ok=False, error=str(e))
            if "401" in str(e) or "403" in str(e):
                print(f"    提示：可设置环境变量 HF_TOKEN=xxx 后重试")
            if required:
                all_ok = False

    return all_ok


def save_sha256_to_manifest(manifest: dict, manifest_path: Path, sha256_updates: dict) -> None:
    changed = False
    for engine_name, file_hashes in sha256_updates.items():
        engine_cfg = manifest.get("engines", {}).get(engine_name, {})
        for file_cfg in engine_cfg.get("checkpoint_files", []):
            rel_path = file_cfg["path"]
            if rel_path in file_hashes and not file_cfg.get("sha256"):
                file_cfg["sha256"] = file_hashes[rel_path]
                changed = True
    if changed:
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  manifest.json 已更新（sha256 写入）")


def download_hf_cache(
    engine_name: str,
    cfg: dict,
    resources_root: Path,
    check_only: bool,
    force: bool,
    checkpoints_base: "Path | None" = None,
) -> bool:
    downloads: list[dict] = cfg.get("hf_cache_downloads", [])
    if not downloads:
        return True

    try:
        from huggingface_hub import hf_hub_download, snapshot_download
    except ImportError:
        print(f"  [{engine_name}] huggingface_hub 未安装，跳过 HF 缓存下载")
        return False

    token = get_hf_token()
    all_ok = True

    for item in downloads:
        repo_id: str = item["repo_id"]
        filename: str = item.get("filename", "")
        cache_dir_rel: str = item.get("cache_dir_rel", "checkpoints/hf_cache")
        size_mb: float = item.get("size_mb", 0)
        note: str = item.get("note", "")
        if checkpoints_base is not None and cache_dir_rel.startswith("checkpoints/"):
            cache_dir = checkpoints_base / cache_dir_rel[len("checkpoints/"):]
        else:
            cache_dir = resources_root / cache_dir_rel

        size_str = f"~{size_mb:.0f} MB" if size_mb else "未知大小"
        label = f"{repo_id}/{filename}" if filename else repo_id

        marker_dir = cache_dir / f"models--{repo_id.replace('/', '--')}"
        blobs_dir = marker_dir / "blobs"
        already_cached = blobs_dir.exists() and any(blobs_dir.iterdir())

        if already_cached and not force:
            print(f"  ✓ {label}  (已缓存)  {note}")
            continue

        size_indicator = f"[{size_str}]" if size_mb else ""
        print(f"  ✗ {label}  {size_indicator} {note}")
        if check_only:
            all_ok = False
            continue

        cache_dir.mkdir(parents=True, exist_ok=True)
        revision: str = item.get("revision", "main")
        try:
            if filename:
                print(f"  [HF单文件] {repo_id}  {filename}  revision={revision}  cache_dir={cache_dir}")
                hf_hub_download(
                    repo_id=repo_id,
                    filename=filename,
                    revision=revision,
                    cache_dir=str(cache_dir),
                    token=token,
                )
            else:
                ignore_patterns: list[str] = item.get("ignore_patterns", [])
                print(f"  [HF快照] {repo_id}  revision={revision}  cache_dir={cache_dir}"
                      + (f"  忽略: {ignore_patterns}" if ignore_patterns else ""))
                snapshot_download(
                    repo_id=repo_id,
                    revision=revision,
                    cache_dir=str(cache_dir),
                    token=token,
                    ignore_patterns=ignore_patterns or None,
                )
            print(f"    ✓ 下载完成: {label}")
        except Exception as e:
            print(f"    ✗ 下载失败: {e}")
            all_ok = False

    return all_ok


def get_embedded_python(project_root: Path) -> str:
    """返回嵌入式 Python 可执行路径，找不到返回空串。"""
    if platform.system() == "Windows":
        p = project_root / "runtime" / "win" / "python" / "python.exe"
    else:
        p = project_root / "runtime" / "mac" / "python" / "bin" / "python3"
    return str(p) if p.exists() else ""


def prefetch_rvc_base_models(project_root: Path) -> None:
    """触发 rvc-python 的 base_model 预下载（hubert_base.pt / rmvpe.pt / rmvpe.onnx）。"""
    py = get_embedded_python(project_root)
    if not py:
        print("  [rvc] 嵌入式 Python 未找到，跳过 RVC base model 预下载")
        return

    # 检查 rvc-python 是否已安装（setup-engines.py 负责安装）
    check = subprocess.run([py, "-c", "from rvc_python.infer import RVCInference"],
                           capture_output=True)
    if check.returncode != 0:
        print("  [rvc] rvc-python 未安装，跳过 base model 预下载（请先运行 pnpm run setup）")
        return

    rvc_pkg = subprocess.run(
        [py, "-c", "import rvc_python, os; print(os.path.dirname(rvc_python.__file__))"],
        capture_output=True, text=True,
    )
    if rvc_pkg.returncode != 0:
        return

    base_model_dir = Path(rvc_pkg.stdout.strip()) / "base_model"
    models_needed = ["hubert_base.pt", "rmvpe.pt", "rmvpe.onnx"]
    missing = [f for f in models_needed if not (base_model_dir / f).exists()]
    if not missing:
        print("  ✓ RVC base_model 文件已就绪")
        return

    print(f"  [rvc] 预下载 {', '.join(missing)} ...")
    r = subprocess.run(
        [py, "-c", "from rvc_python.infer import RVCInference; RVCInference()"],
        capture_output=True, text=True, timeout=600,
    )
    if r.returncode == 0:
        print("    ✓ RVC 基础模型已就绪")
    else:
        print(f"    ✗ 预下载失败（可能需要联网）: {r.stderr.strip()[:200]}")


def prefetch_faster_whisper_model(
    project_root: Path,
    cfg: dict,
    resources_root: Path,
    checkpoints_base: "Path | None",
    check_only: bool = False,
    model: str = "base",
) -> bool:
    """预下载 faster-whisper 模型到 checkpoint_dir/{model}/。

    与 prefetch_rvc_base_models 模式一致：使用嵌入式 Python 触发下载，
    要求 pnpm run setup 已安装 faster-whisper。
    """
    checkpoint_dir_rel = cfg.get("checkpoint_dir", "checkpoints/faster_whisper")
    if checkpoints_base is not None and checkpoint_dir_rel.startswith("checkpoints/"):
        checkpoint_dir = checkpoints_base / checkpoint_dir_rel[len("checkpoints/"):]
    else:
        checkpoint_dir = resources_root / checkpoint_dir_rel

    model_dir = checkpoint_dir / model
    model_bin = model_dir / "model.bin"

    if model_bin.exists() and model_bin.stat().st_size > 0:
        size_mb = model_bin.stat().st_size // 1024 // 1024
        print(f"  ✓ faster-whisper/{model}  ({size_mb} MB)")
        return True

    size_hint = {"tiny": 40, "base": 150, "small": 490, "medium": 1500,
                 "large-v2": 3100, "large-v3": 3100, "large-v3-turbo": 1600}.get(model, 0)
    size_str = f"~{size_hint} MB" if size_hint else "未知大小"
    print(f"  ✗ faster-whisper/{model}  [{size_str}]")
    emit("file_start", engine="faster_whisper", file=f"{model}/model.bin", size_mb=size_hint)

    if check_only:
        return False

    py = get_embedded_python(project_root)
    if not py:
        print("  [faster-whisper] 嵌入式 Python 未找到，跳过模型预下载（请先运行 pnpm run setup）")
        return False

    check = subprocess.run([py, "-c", "import faster_whisper"], capture_output=True)
    if check.returncode != 0:
        print("  [faster-whisper] faster-whisper 未安装，跳过模型预下载（请先运行 pnpm run setup）")
        return False

    print(f"  [faster-whisper] 下载 {model} 模型到 {model_dir} ...")
    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    r = subprocess.run(
        [py, "-c",
         f"from faster_whisper import WhisperModel; "
         f"WhisperModel({model!r}, device='cpu', compute_type='int8', download_root={str(checkpoint_dir)!r}); "
         f"print('done')"],
        capture_output=True, text=True, timeout=600,
    )
    if r.returncode == 0 and model_bin.exists() and model_bin.stat().st_size > 0:
        size_mb = model_bin.stat().st_size // 1024 // 1024
        print(f"    ✓ faster-whisper/{model} 下载完成 ({size_mb} MB)")
        emit("file_done", engine="faster_whisper", file=f"{model}/model.bin", ok=True)
        return True
    else:
        stderr = (r.stderr or "").strip()[:300]
        print(f"    ✗ 下载失败: {stderr}")
        emit("file_done", engine="faster_whisper", file=f"{model}/model.bin", ok=False, error=stderr)
        return False


def _bootstrap_download_deps() -> None:
    """确保 huggingface_hub 和 requests 已安装（下载阶段必要工具）。"""
    needed = []
    try:
        import huggingface_hub  # noqa: F401
    except ImportError:
        needed.append("huggingface_hub")
    try:
        import requests  # noqa: F401
    except ImportError:
        needed.append("requests")

    if not needed:
        return

    print(f"[bootstrap] 安装下载依赖: {', '.join(needed)}")
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", *needed, "--quiet"],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode == 0:
        print(f"[bootstrap] 安装成功")
    else:
        print(f"[bootstrap] 安装失败（将继续尝试）: {result.stderr.strip()[:200]}")


def main() -> int:
    global _JSON_MODE
    parser = argparse.ArgumentParser(description="检查并下载 AI 引擎 checkpoint 文件")
    parser.add_argument("--engine", help="只处理指定引擎（fish_speech / seed_vc / faster_whisper / whisper / rvc）")
    parser.add_argument("--check-only", action="store_true", help="只检查，不下载")
    parser.add_argument("--force", action="store_true", help="强制重新下载（覆盖已有文件）")
    parser.add_argument("--json-progress", action="store_true",
                        help="以 JSON Lines 格式输出进度（供 Electron IPC 使用）")
    parser.add_argument("--hf-endpoint", default="",
                        help="HuggingFace 镜像端点（如 https://hf-mirror.com）")
    args = parser.parse_args()
    _JSON_MODE = args.json_progress

    # CLI 参数优先于环境变量
    if args.hf_endpoint:
        global HF_ENDPOINT
        HF_ENDPOINT = args.hf_endpoint.rstrip("/")

    if not args.check_only:
        _bootstrap_download_deps()

    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent

    resources_root_env = os.getenv("RESOURCES_ROOT", "")
    resources_root = Path(resources_root_env).resolve() if resources_root_env else project_root

    checkpoints_dir_env = os.getenv("CHECKPOINTS_DIR", "").strip()
    checkpoints_base: "Path | None" = Path(checkpoints_dir_env).resolve() if checkpoints_dir_env else None

    manifest_path = resources_root / "runtime" / "manifest.json"
    if not manifest_path.exists():
        manifest_path = project_root / "runtime" / "manifest.json"
        resources_root = project_root

    if not manifest_path.exists():
        print(f"✗ 找不到 manifest.json: {manifest_path}")
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    engines: dict = manifest.get("engines", {})

    if args.engine and args.engine not in engines:
        print(f"✗ 引擎 '{args.engine}' 不在 manifest 中，可用: {list(engines)}")
        return 1

    mode = "检查" if args.check_only else "检查并下载"
    print(f"=== {mode} checkpoint 文件 ===")
    print(f"resources_root: {resources_root}\n")

    sha256_updates: dict = {}
    all_ready = True

    for engine_name, cfg in engines.items():
        if args.engine and engine_name != args.engine:
            continue
        print(f"▶ {engine_name} (v{cfg.get('version', '?')})")
        emit("engine_start", engine=engine_name, version=cfg.get("version", "?"))

        # 下载 manifest checkpoint_files
        ok = check_and_download(engine_name, cfg, resources_root, args.check_only, args.force,
                                sha256_updates, checkpoints_base=checkpoints_base)
        if not ok:
            all_ready = False

        # 下载额外 HF 缓存模型
        if cfg.get("hf_cache_downloads"):
            ok2 = download_hf_cache(engine_name, cfg, resources_root, args.check_only, args.force,
                                    checkpoints_base=checkpoints_base)
            if not ok2:
                all_ready = False

        # faster-whisper 模型预下载（需 setup 阶段已装好 faster-whisper）
        if engine_name == "faster_whisper":
            ok3 = prefetch_faster_whisper_model(
                project_root, cfg, resources_root, checkpoints_base,
                check_only=args.check_only,
            )
            if not ok3:
                all_ready = False

        # RVC base model 预下载（rvc-python 触发内置下载，需 setup 阶段已装好 rvc-python）
        if engine_name == "rvc" and not args.check_only:
            prefetch_rvc_base_models(project_root)

        print()

    if sha256_updates and not args.check_only:
        save_sha256_to_manifest(manifest, manifest_path, sha256_updates)
        print()

    if all_ready:
        print("✓ 所有必填 checkpoint 文件就绪")
        emit("all_done", ok=True)
        return 0
    else:
        print("✗ 存在缺失的必填 checkpoint 文件")
        emit("all_done", ok=False)
        return 1


if __name__ == "__main__":
    sys.exit(main())
