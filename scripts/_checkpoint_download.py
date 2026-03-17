#!/usr/bin/env python3
"""
检查并下载 Fish Speech / Seed-VC / Whisper / RVC 所需的 checkpoint 文件。
从 runtime/manifest.json 读取文件清单，仅下载缺失的文件。
下载完成后自动计算 sha256 并写回 manifest.json，后续运行自动校验完整性。

pip 依赖安装和 FFmpeg 下载由 scripts/setup_base.py 负责（pnpm run setup 阶段）。

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
import queue
import subprocess
import sys
import threading
import time
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
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    # 断点续传：如果文件已存在，从当前字节位置继续
    resume_pos = dest_path.stat().st_size if dest_path.exists() else 0
    headers = {"Range": f"bytes={resume_pos}-"} if resume_pos > 0 else {}
    if resume_pos > 0:
        msg = f"  [HTTP] 续传（已有 {resume_pos/1024/1024:.1f} MB）→ {url}"
    else:
        msg = f"  [HTTP] {url}"
    emit("log", message=msg)

    resp = requests.get(url, stream=True, timeout=60, headers=headers)
    # 服务器不支持 Range（返回 200）时从头下载
    if resume_pos > 0 and resp.status_code == 200:
        resume_pos = 0
    resp.raise_for_status()

    total_from_server = int(resp.headers.get("content-length", 0))
    total = resume_pos + total_from_server if total_from_server else 0
    done = resume_pos
    last_reported = -1
    mode = "ab" if resume_pos > 0 else "wb"
    with open(dest_path, mode) as f:
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
    explicit: bool = False,
) -> bool:
    checkpoint_dir_rel = cfg.get("checkpoint_dir", f"checkpoints/{engine_name}")
    if checkpoints_base is not None and checkpoint_dir_rel.startswith("checkpoints/"):
        checkpoint_dir = checkpoints_base / checkpoint_dir_rel[len("checkpoints/"):]
    else:
        checkpoint_dir = resources_root / checkpoint_dir_rel
    checkpoint_files: list[dict] = cfg.get("checkpoint_files", [])

    if not checkpoint_files:
        msg = f"  [{engine_name}] 无 checkpoint_files 定义，跳过（依赖 hf_cache_downloads）"
        emit("log", message=msg)
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

        if not required and not explicit:
            print(f"    跳过（required=false，如需下载请用 --force 或 --engine {engine_name}）")
            continue

        emit("file_start", engine=engine_name, file=rel_path, size_mb=size_mb)

        if check_only:
            all_ok = False
            continue

        # 支持 repo_id + filename + repo_type 格式（HF dataset 等）
        repo_id_field: str = file_cfg.get("repo_id", "")
        filename_field: str = file_cfg.get("filename", "")
        repo_type_field: str = file_cfg.get("repo_type", "model")

        if not url and not repo_id_field:
            print(f"    没有下载链接，请手动放置到: {dest}")
            if required:
                all_ok = False
            continue

        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            # repo_id 直接下载模式（支持 dataset / model 等 repo_type）
            if repo_id_field and filename_field and not url:
                from huggingface_hub import hf_hub_download as _hf_dl
                token = get_hf_token()
                print(f"  [HF {repo_type_field}] {repo_id_field}/{filename_field}")
                downloaded = _hf_dl(
                    repo_id=repo_id_field,
                    filename=filename_field,
                    repo_type=repo_type_field,
                    local_dir=str(dest.parent),
                    token=token,
                )
                dl_path = Path(downloaded)
                if dl_path.resolve() != dest.resolve() and dl_path.exists():
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dl_path.rename(dest)
                if dest.exists() and dest.stat().st_size > 0:
                    actual = sha256_file(dest)
                    sha256_updates.setdefault(engine_name, {})[rel_path] = actual
                    print(f"    ✓ 下载完成  {dest.stat().st_size // 1024 // 1024} MB")
                    emit("file_done", engine=engine_name, file=rel_path, ok=True)
                    if expected_sha256 and actual != expected_sha256:
                        print(f"    ⚠ SHA256 与 manifest 预期不符，已记录新哈希")
                else:
                    print(f"    ✗ 下载后文件异常")
                    emit("file_done", engine=engine_name, file=rel_path, ok=False, error="下载后文件异常")
                    if required:
                        all_ok = False
                continue

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
            err_str = str(e)
            print(f"    ✗ 下载失败: {err_str}")
            emit("log", message=f"    ✗ 下载失败: {err_str[:300]}")
            emit("file_done", engine=engine_name, file=rel_path, ok=False, error=err_str)
            if "401" in err_str or "403" in err_str:
                print(f"    提示：可设置环境变量 HF_TOKEN=xxx 后重试")
                emit("log", message=f"    提示：可设置环境变量 HF_TOKEN=xxx 后重试")
            if required:
                all_ok = False

    return all_ok


def save_sha256_to_manifest(manifest: dict, manifest_path: Path, sha256_updates: dict) -> None:
    changed = False
    for engine_name, file_hashes in sha256_updates.items():
        engine_cfg = manifest.get("engines", {}).get(engine_name, {})
        for file_cfg in engine_cfg.get("checkpoint_files", []):
            rel_path = file_cfg["path"]
            if rel_path in file_hashes and file_cfg.get("sha256") != file_hashes[rel_path]:
                file_cfg["sha256"] = file_hashes[rel_path]
                changed = True
    if changed:
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  manifest.json 已更新（sha256 写入）")


def _monitor_hf_cache_progress(cache_dir: Path, label: str, size_mb: float, stop_event: threading.Event) -> None:
    """后台线程：每 4 秒报告一次 HF cache 目录已下载大小（用于 snapshot_download 等无进度回调的场景）。"""
    if not size_mb:
        return
    while not stop_event.wait(timeout=4.0):
        try:
            current = sum(
                f.stat().st_size for f in cache_dir.rglob("*") if f.is_file()
            ) / 1024 / 1024
            pct = min(99, int(current / size_mb * 100))
            emit("progress", file=label, pct=pct,
                 mb=round(current, 1), total_mb=float(size_mb))
        except Exception:
            pass


def download_hf_cache(
    engine_name: str,
    cfg: dict,
    resources_root: Path,
    check_only: bool,
    force: bool,
    checkpoints_base: "Path | None" = None,
    explicit: bool = False,
) -> bool:
    downloads: list[dict] = cfg.get("hf_cache_downloads", [])
    if not downloads:
        return True

    try:
        from huggingface_hub import hf_hub_download, snapshot_download
    except ImportError:
        msg = f"  [{engine_name}] huggingface_hub 未安装，跳过 HF 缓存下载"
        emit("log", message=msg)
        return False

    # 确保下载时不受 HF_HUB_OFFLINE / TRANSFORMERS_OFFLINE 影响（后端推理进程会设置这些变量）
    os.environ.pop("HF_HUB_OFFLINE", None)
    os.environ.pop("TRANSFORMERS_OFFLINE", None)

    token = get_hf_token()
    emit("log", message=f"  [{engine_name}] HF 缓存下载 · {len(downloads)} 个项目  token={'已配置' if token else '未配置（公开仓库无需）'}")
    all_ok = True

    for item in downloads:
        repo_id: str = item["repo_id"]
        filename: str = item.get("filename", "")
        cache_dir_rel: str = item.get("cache_dir_rel", "checkpoints/hf_cache")
        size_mb: float = item.get("size_mb", 0)
        note: str = item.get("note", "")
        hf_token_required: bool = item.get("hf_token_required", False)
        if checkpoints_base is not None and cache_dir_rel.startswith("checkpoints/"):
            cache_dir = checkpoints_base / cache_dir_rel[len("checkpoints/"):]
        else:
            cache_dir = resources_root / cache_dir_rel

        required: bool = item.get("required", True)
        size_str = f"~{size_mb:.0f} MB" if size_mb else "未知大小"
        label = f"{repo_id}/{filename}" if filename else repo_id

        marker_dir = cache_dir / f"models--{repo_id.replace('/', '--')}"
        blobs_dir = marker_dir / "blobs"

        def _is_size_sufficient(actual_bytes: int) -> bool:
            """判断已下载字节数是否足够（大模型需接近预期大小，小模型有 >1 MB 即可）。"""
            if size_mb and size_mb > 100:
                return actual_bytes >= int(size_mb * 1024 * 1024 * 0.85)
            return actual_bytes > 1024 * 1024

        # HF cache blobs 目录（排除 .lock / .incomplete / 0-byte 残留文件）
        blobs_real_size = 0
        if blobs_dir.exists():
            for _f in blobs_dir.iterdir():
                if _f.is_file() and not _f.name.endswith(('.lock', '.incomplete')) and _f.stat().st_size > 0:
                    blobs_real_size += _f.stat().st_size
        blobs_cached = _is_size_sufficient(blobs_real_size)

        # 直接下载模式（HTTP 单文件直接放在 cache_dir/<filename>）
        direct_file = cache_dir / filename if filename else None
        direct_size = direct_file.stat().st_size if (direct_file and direct_file.exists()) else 0
        direct_cached = _is_size_sufficient(direct_size)

        already_cached = blobs_cached or direct_cached

        if already_cached and not force:
            cached_size_mb = max(blobs_real_size, direct_size) / 1024 / 1024
            msg = f"  ✓ {label}  (已缓存 {cached_size_mb:.0f} MB)  {note}"
            emit("log", message=msg)
            continue

        size_indicator = f"[{size_str}]" if size_mb else ""
        status = "必填" if required else "可选"
        partial_hint = ""
        if blobs_real_size > 0 or direct_size > 0:
            partial_mb = max(blobs_real_size, direct_size) / 1024 / 1024
            partial_hint = f"  (已有 {partial_mb:.1f} MB 部分数据，将继续下载)"
        msg = f"  ✗ {label}  {size_indicator} [{status}]{partial_hint}  {note}"
        emit("log", message=msg)

        if not required and not force and not explicit:
            skip_msg = f"    跳过（required=false，如需下载请用 --force 或 --engine {engine_name}）"
            emit("log", message=skip_msg)
            continue

        if check_only:
            all_ok = False
            continue

        # 门控仓库：提前检查 token
        if hf_token_required and not token:
            warn = (f"    ⚠ {repo_id} 是门控仓库（gated），需要 HuggingFace token。\n"
                    f"    请前往 https://huggingface.co/settings/tokens 生成 token，\n"
                    f"    然后设置环境变量 HF_TOKEN=hf_xxx 后重新安装。")
            print(warn)
            emit("log", message=warn)
            all_ok = False
            continue

        cache_dir.mkdir(parents=True, exist_ok=True)
        revision: str = item.get("revision", "main")

        # 清理上次失败遗留的 .lock / .incomplete / 0-byte 文件，避免 HF hub 误判为进行中
        _stale_cleaned = 0
        if blobs_dir.exists():
            for _f in list(blobs_dir.iterdir()):
                if _f.is_file() and (_f.name.endswith(('.lock', '.incomplete')) or _f.stat().st_size == 0):
                    try:
                        _f.unlink()
                        _stale_cleaned += 1
                    except Exception:
                        pass
        if _stale_cleaned:
            msg_clean = f"    已清理 {_stale_cleaned} 个残留文件（.lock/.incomplete）"
            print(msg_clean)
            emit("log", message=msg_clean)

        emit("file_start", engine=engine_name, file=label, size_mb=size_mb)

        try:
            if filename:
                # 单文件：JSON 模式用 HTTP 直连以获得实时进度，否则用 hf_hub_download
                if _JSON_MODE:
                    hf_url = f"{HF_ENDPOINT}/{repo_id}/resolve/{revision}/{filename}"
                    # HTTP 下载到临时路径，完成后移入 HF cache 格式目录
                    tmp_dest = cache_dir / filename
                    msg2 = f"  [HTTP 单文件] {hf_url}"
                    print(msg2)
                    emit("log", message=msg2)
                    try:
                        download_via_requests(hf_url, tmp_dest)
                    except Exception as http_err:
                        emit("log", message=f"    HTTP 下载失败 ({http_err.__class__.__name__})，回退 hf_hub_download…")
                        hf_hub_download(
                            repo_id=repo_id, filename=filename,
                            revision=revision, cache_dir=str(cache_dir), token=token,
                        )
                else:
                    msg2 = f"  [HF单文件] {repo_id}  {filename}  revision={revision}  cache_dir={cache_dir}"
                    print(msg2)
                    emit("log", message=msg2)
                    hf_hub_download(
                        repo_id=repo_id, filename=filename,
                        revision=revision, cache_dir=str(cache_dir), token=token,
                    )
            else:
                ignore_patterns: list[str] = item.get("ignore_patterns", [])
                msg2 = (f"  [HF快照] {repo_id}  revision={revision}  cache_dir={cache_dir}"
                        + (f"\n    忽略文件: {ignore_patterns}" if ignore_patterns else "")
                        + f"\n    预计大小: {size_str}，请耐心等待（可能需要几分钟）…")
                print(msg2)
                emit("log", message=msg2)

                # 后台监控已下载大小，每 4 秒上报一次进度
                stop_monitor = threading.Event()
                if _JSON_MODE and size_mb:
                    monitor = threading.Thread(
                        target=_monitor_hf_cache_progress,
                        args=(cache_dir, label, size_mb, stop_monitor),
                        daemon=True,
                    )
                    monitor.start()
                else:
                    monitor = None

                try:
                    snapshot_download(
                        repo_id=repo_id, revision=revision,
                        cache_dir=str(cache_dir), token=token,
                        ignore_patterns=ignore_patterns or None,
                    )
                finally:
                    stop_monitor.set()
                    if monitor:
                        monitor.join(timeout=5)

            done_msg = f"    ✓ 下载完成: {label}"
            emit("log", message=done_msg)
            emit("file_done", engine=engine_name, file=label, ok=True)
            # 创建 refs/main（若不存在），使 hf_hub_download 离线模式可在不指定
            # revision 参数时找到已缓存的文件（refs/main 是 HF 缓存格式的入口指针）。
            if revision:
                refs_dir = marker_dir / "refs"
                refs_main = refs_dir / "main"
                if not refs_main.exists():
                    refs_dir.mkdir(parents=True, exist_ok=True)
                    refs_main.write_text(revision, encoding="utf-8")
            # 同时在 hf_cache 目录创建软链接，使绝对路径 HF_HUB_CACHE 也能找到该缓存
            # （当 cache_dir_rel != "checkpoints/hf_cache" 时，模型存于 checkpoints/ 根目录）
            if cache_dir_rel != "checkpoints/hf_cache":
                hf_cache_dir = (checkpoints_base or (resources_root / "checkpoints")) / "hf_cache"
                hf_cache_dir.mkdir(parents=True, exist_ok=True)
                link_target = hf_cache_dir / marker_dir.name
                if not link_target.exists():
                    link_target.symlink_to(os.path.relpath(marker_dir, hf_cache_dir))
        except Exception as e:
            err_str = str(e)
            err_msg = f"    ✗ 下载失败: {err_str[:300]}"
            emit("log", message=err_msg)
            is_gated = "gated" in err_str.lower() or "access to model" in err_str.lower()
            is_auth = "401" in err_str or "403" in err_str
            if is_gated and (is_auth or token):
                hint = (f"    提示：{repo_id} 是受限模型（gated repo），需先同意使用条款后才能下载。\n"
                        f"    请前往 https://huggingface.co/{repo_id} 登录并点击 \"Agree and access repository\"，\n"
                        f"    然后确保已设置有效的 HF_TOKEN 环境变量后重试。")
                print(hint)
                emit("log", message=hint)
            elif is_auth:
                hint = f"    提示：{repo_id} 需要 HF token，请设置 HF_TOKEN 环境变量后重试"
                print(hint)
                emit("log", message=hint)
            emit("file_done", engine=engine_name, file=label, ok=False, error=err_str[:200])
            if required:
                all_ok = False

    return all_ok


def get_embedded_python(project_root: Path) -> str:
    """返回嵌入式 Python 可执行路径，找不到返回空串。"""
    if platform.system() == "Windows":
        p = project_root / "runtime" / "win" / "python" / "python.exe"
    else:
        p = project_root / "runtime" / "mac" / "python" / "bin" / "python3"
    return str(p) if p.exists() else ""


# clone 后删除的开发专用目录和文件（不影响运行时）
_FACEFUSION_RM = [
    ".github",
    "tests",
    ".coveragerc",
    ".editorconfig",
    ".flake8",
    ".gitignore",
    "mypy.ini",
    "README.md",
    "LICENSE.md",
]


def setup_facefusion_engine(project_root: Path, resources_root: Path, pypi_mirror: str = "") -> bool:
    """克隆 FaceFusion 3.5.4 并精简到运行时所需文件，再运行 install.py。

    与 setup-engines.py 里 fish_speech / seed_vc 的模式一致：
    git clone --depth 1 --branch 3.5.4 → 删除开发目录 → python install.py
    """
    import shutil

    # 优先用 resources_root（打包后指向 app.asar 旁的资源目录）
    runtime_root = resources_root if (resources_root / "runtime").exists() else project_root
    engine_dir = runtime_root / "runtime" / "facefusion" / "engine"
    sentinel = engine_dir / "facefusion" / "__init__.py"

    # ── Step 1: git clone ───────────────────────────────────────────────────
    if sentinel.exists():
        emit("log", message="  ✓ FaceFusion 引擎目录已存在，跳过 clone")
        print(f"  ✓ FaceFusion 引擎已存在（{sentinel}）")
    else:
        emit("log", message="  正在克隆 FaceFusion 3.5.4（仅 HEAD，约 10 MB）...")
        print(f"  [facefusion] git clone --depth 1 --branch 3.5.4 → {engine_dir}")
        if engine_dir.exists():
            shutil.rmtree(engine_dir)
        r = subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", "3.5.4",
             "https://github.com/facefusion/facefusion.git", str(engine_dir)],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            msg = r.stderr.strip()[:300]
            print(f"  ✗ clone 失败: {msg}")
            emit("log", message=f"  ✗ clone 失败: {msg}")
            return False

        # 删除开发专用目录和文件
        for name in _FACEFUSION_RM:
            p = engine_dir / name
            if p.is_dir():
                shutil.rmtree(p, ignore_errors=True)
            elif p.is_file():
                p.unlink(missing_ok=True)

        n = sum(1 for _ in engine_dir.rglob("*") if _.is_file())
        print(f"  ✓ clone 完成，已精简（{n} 个文件）")
        emit("log", message="  ✓ 克隆完成，开发文件已清理")

    # ── Step 2: 找嵌入式 Python ─────────────────────────────────────────────
    py = get_embedded_python(project_root) or get_embedded_python(resources_root)
    if not py:
        msg = "嵌入式 Python 未找到，请先运行 pnpm run setup"
        print(f"  [facefusion] ✗ {msg}")
        emit("log", message=f"  ✗ {msg}")
        return False

    # ── Step 3: 直接用嵌入式 pip 安装依赖（绕过 install.py 的 conda 检查）──────
    # FaceFusion 的 install.py 需要 conda，但我们用的是嵌入式 Python，直接读 requirements.txt
    req_file = engine_dir / "requirements.txt"
    if not req_file.exists():
        print(f"  ✗ 找不到 requirements.txt: {req_file}")
        emit("log", message="  ✗ 找不到 requirements.txt")
        return False

    # 读取 requirements.txt，跳过 onnxruntime（我们指定版本），补充 onnxruntime==1.24.1
    packages: list[str] = []
    for line in req_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("onnxruntime"):
            packages.append(line)
    packages.append("onnxruntime==1.24.1")

    print(f"  [facefusion] 安装 {len(packages)} 个依赖包（可能需要 3-10 分钟）...")
    emit("log", message=f"  正在安装 FaceFusion 依赖（{len(packages)} 个包，可能需要 3-10 分钟）…")

    pip_cmd = [py, "-m", "pip", "install", "--quiet"] + packages
    if pypi_mirror:
        pip_cmd += ["--index-url", pypi_mirror, "--extra-index-url", "https://pypi.org/simple"]
    proc = subprocess.Popen(
        pip_cmd,
        cwd=str(engine_dir),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    line_q: "queue.Queue[str | None]" = queue.Queue()

    def _reader():
        try:
            assert proc.stdout is not None
            for ln in proc.stdout:
                line_q.put(ln)
        finally:
            line_q.put(None)

    threading.Thread(target=_reader, daemon=True).start()

    deadline = time.time() + 900
    returncode = -1
    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            proc.kill()
            emit("log", message="  ✗ 依赖安装超时（15 分钟），已终止")
            return False
        try:
            ln = line_q.get(timeout=min(remaining, 2.0))
        except queue.Empty:
            continue
        if ln is None:
            proc.wait()
            returncode = proc.returncode
            break
        ln = ln.rstrip()
        if ln:
            print(f"    {ln}")
            emit("log", message=f"    {ln}")

    if returncode != 0:
        print(f"  ✗ 依赖安装失败（exit {returncode}）")
        emit("log", message=f"  ✗ 依赖安装失败（exit {returncode}）")
        return False

    print(f"  ✓ FaceFusion 安装完成")
    emit("log", message="  ✓ FaceFusion 安装完成")
    return True


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

    # 用 faster_whisper.utils.download_model(output_dir=...) 直接下载到指定目录（非 HF cache 格式）
    # 回退：huggingface_hub.snapshot_download(local_dir=...) 也会直接写入目标目录
    script = f"""
import sys, os
# 确保不受外部 HF_HUB_OFFLINE 影响
os.environ.pop("HF_HUB_OFFLINE", None)
os.environ.pop("TRANSFORMERS_OFFLINE", None)
output_dir = {str(model_dir)!r}
try:
    from faster_whisper.utils import download_model
    download_model({model!r}, output_dir=output_dir, local_files_only=False)
    print("ok:download_model")
except Exception as e1:
    # 回退到 huggingface_hub
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id="Systran/faster-whisper-{model}",
            local_dir=output_dir,
            local_dir_use_symlinks=False,
        )
        print("ok:snapshot_download")
    except Exception as e2:
        print(f"err1={{e1}}", file=sys.stderr)
        print(f"err2={{e2}}", file=sys.stderr)
        sys.exit(1)
"""
    # 传入干净的环境（去掉 HF_HUB_OFFLINE，保留其余环境变量）
    clean_env = {k: v for k, v in os.environ.items() if k not in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE")}
    r = subprocess.run(
        [py, "-c", script],
        capture_output=True, text=True, timeout=600,
        env=clean_env,
    )
    if r.returncode == 0 and model_bin.exists() and model_bin.stat().st_size > 0:
        size_mb = model_bin.stat().st_size // 1024 // 1024
        print(f"    ✓ faster-whisper/{model} 下载完成 ({size_mb} MB)")
        emit("file_done", engine="faster_whisper", file=f"{model}/model.bin", ok=True)
        return True
    else:
        err = ((r.stderr or "") + (r.stdout or "")).strip()[:300]
        print(f"    ✗ 下载失败: {err}")
        emit("file_done", engine="faster_whisper", file=f"{model}/model.bin", ok=False, error=err)
        return False


def _bootstrap_download_deps() -> None:
    """确保 huggingface_hub 和 requests 已安装且版本满足要求。"""
    # huggingface_hub >= 0.38 才有 is_offline_mode（transformers / diffusers 依赖）
    HF_HUB_MIN = (0, 38, 0)
    needed = []
    try:
        import huggingface_hub  # noqa: F401
        ver_str = getattr(huggingface_hub, "__version__", "0")
        ver = tuple(int(x) for x in ver_str.split(".")[:3] if x.isdigit())
        if ver < HF_HUB_MIN:
            needed.append(f"huggingface_hub>={'.'.join(str(x) for x in HF_HUB_MIN)}")
    except ImportError:
        needed.append(f"huggingface_hub>={'.'.join(str(x) for x in HF_HUB_MIN)}")
    try:
        import requests  # noqa: F401
    except ImportError:
        needed.append("requests")

    if not needed:
        return

    print(f"[bootstrap] 安装/升级下载依赖: {', '.join(needed)}")
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
    parser.add_argument("--pypi-mirror", default="", dest="pypi_mirror",
                        help="PyPI 镜像地址（如 https://pypi.tuna.tsinghua.edu.cn/simple）")
    parser.add_argument("--engines", default="",
                        help="逗号分隔的引擎列表（仅处理这些引擎）；省略则处理所有")
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
        manifest_path = resources_root / "wrappers" / "manifest.json"
    if not manifest_path.exists():
        manifest_path = project_root / "wrappers" / "manifest.json"
        resources_root = project_root

    if not manifest_path.exists():
        print(f"✗ 找不到 manifest.json: {manifest_path}")
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    engines: dict = manifest.get("engines", {})

    if args.engine and args.engine not in engines:
        print(f"✗ 引擎 '{args.engine}' 不在 manifest 中，可用: {list(engines)}")
        return 1

    # 处理 --engines 过滤列表
    engines_filter = set(e.strip() for e in args.engines.split(",") if e.strip()) if args.engines else None
    if engines_filter:
        invalid = engines_filter - set(engines.keys())
        if invalid:
            print(f"✗ 无效的引擎: {invalid}，可用: {list(engines)}")
            return 1
        engines = {k: v for k, v in engines.items() if k in engines_filter}

    mode = "检查" if args.check_only else "检查并下载"
    print(f"=== {mode} checkpoint 文件 ===")
    print(f"resources_root: {resources_root}\n")

    sha256_updates: dict = {}
    all_ready = True

    # 明确指定 --engine 或 --engines 时视为用户主动请求，required=false 的项目也要下载
    explicit = bool(args.engine or args.engines)

    for engine_name, cfg in engines.items():
        if args.engine and engine_name != args.engine:
            continue
        print(f"▶ {engine_name} (v{cfg.get('version', '?')})")
        emit("engine_start", engine=engine_name, version=cfg.get("version", "?"))

        # FaceFusion：先 clone 引擎源码，再下载模型（clone 会删除 engine/ 目录，必须先 clone）
        if engine_name == "facefusion" and not args.check_only:
            ok_ff = setup_facefusion_engine(project_root, resources_root, pypi_mirror=args.pypi_mirror)
            if not ok_ff:
                all_ready = False

        # 下载 manifest checkpoint_files
        ok = check_and_download(engine_name, cfg, resources_root, args.check_only, args.force,
                                sha256_updates, checkpoints_base=checkpoints_base,
                                explicit=explicit)
        if not ok:
            all_ready = False

        # 下载额外 HF 缓存模型
        if cfg.get("hf_cache_downloads"):
            ok2 = download_hf_cache(engine_name, cfg, resources_root, args.check_only, args.force,
                                    checkpoints_base=checkpoints_base, explicit=explicit)
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

    # 强制升级 huggingface_hub 到 >=1.3.0，覆盖 gradio 等包引入的旧版本约束。
    # transformers / diffusers / seed_vc / wan / flux / got_ocr 等引擎均需要 >=1.3.0。
    # 必须在所有引擎 pip 安装完成后执行，确保最终版本满足要求。
    if not args.check_only:
        py = get_embedded_python(project_root)
        if py:
            print("── 修复 huggingface_hub 版本（强制升级至 >=1.3.0）──")
            r = subprocess.run(
                [py, "-m", "pip", "install", "huggingface_hub>=1.3.0,<2.0",
                 "--force-reinstall", "--quiet"],
                capture_output=True, text=True, timeout=120,
            )
            if r.returncode == 0:
                # 验证安装版本
                ver_check = subprocess.run(
                    [py, "-c",
                     "import huggingface_hub; print(huggingface_hub.__version__)"],
                    capture_output=True, text=True,
                )
                ver = ver_check.stdout.strip()
                print(f"  ✓ huggingface_hub=={ver}")
            else:
                print(f"  ✗ 升级失败: {r.stderr.strip()[:200]}")
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
