#!/usr/bin/env python3
"""
检查并下载 Fish Speech / Seed-VC / Whisper / RVC 所需的 checkpoint 文件。
从 runtime/manifest.json 读取文件清单，仅下载缺失的文件。
下载完成后自动计算 sha256 并写回 manifest.json，后续运行自动校验完整性。

pip 依赖安装和 FFmpeg 下载由 scripts/runtime.py 负责（pnpm run runtime 阶段）。

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
import queue
import shutil
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


def _mask_url(url: str) -> str:
    """隐藏 URL / repo_id，避免个人 HF/GitHub 地址泄露到日志。
    例: "https://huggingface.co/user/repo/resolve/main/file.pt" → "https://hf/***/file.pt"
        "N17K4/ai-workshop-assets" → "***/***"
    """
    if url.startswith(("http://", "https://")):
        # 提取文件名用于提示
        basename = url.rstrip("/").rsplit("/", 1)[-1] if "/" in url else url
        return f"<hidden-url>/{basename}"
    # repo_id 形式
    return "<hidden-repo>"


def apply_hf_endpoint(url: str) -> str:
    """将 URL 中的 huggingface.co 替换为配置的镜像端点。"""
    if HF_ENDPOINT != "https://huggingface.co":
        return url.replace("https://huggingface.co", HF_ENDPOINT)
    return url


# ─── JSON Lines 进度输出（供 Electron IPC 使用）────────────────────────────
_JSON_MODE: bool = False
_REAL_STDOUT = sys.stdout  # emit() 专用：保留原始 stdout 引用

# ─── 全局文件计数器（线程安全）────────────────────────────────────────────
_file_counter = 0
_file_total = 0
_file_counter_lock = threading.Lock()


def _next_file_index() -> int:
    """线程安全地递增并返回当前文件序号。"""
    global _file_counter
    with _file_counter_lock:
        _file_counter += 1
        return _file_counter


def _fmt_tag(idx, total=None) -> str:
    total = total or _file_total
    return f"[{idx}/{total}]" if total else f"[{idx}]"


def emit(msg_type: str, **kwargs) -> int:
    """输出结构化进度消息。返回 file_start 的序号 idx（其余返回 0）。"""
    idx = 0
    if msg_type == "file_start":
        idx = _next_file_index()
        kwargs["idx"] = idx
        kwargs["total"] = _file_total
    if _JSON_MODE:
        _REAL_STDOUT.write(json.dumps({"type": msg_type, **kwargs}, ensure_ascii=False) + "\n")
        _REAL_STDOUT.flush()
    else:
        if msg_type == "log":
            print(kwargs.get("message", ""), flush=True)
        elif msg_type == "file_start":
            size = f"  ~{kwargs['size_mb']:.0f} MB" if kwargs.get("size_mb") else ""
            print(f"  {_fmt_tag(idx)} ↓ {kwargs.get('file', '')}{size}", flush=True)
        elif msg_type == "file_done":
            tag = _fmt_tag(kwargs.get("idx", "?"))
            if kwargs.get("ok"):
                print(f"  {tag} ✓ {kwargs.get('file', '')} 完成", flush=True)
            else:
                print(f"  {tag} ✗ {kwargs.get('file', '')} 失败: {kwargs.get('error', '')}", flush=True)
    return idx



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
    print(f"  [HF] {_mask_url(repo_id)}/{filename}  revision={revision}"
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
    # 日志中只显示文件名，隐藏完整 URL
    _basename = url.rstrip("/").rsplit("/", 1)[-1] if "/" in url else url
    if resume_pos > 0:
        msg = f"  [HTTP] 续传（已有 {resume_pos/1024/1024:.1f} MB）→ {_basename}"
    else:
        msg = f"  [HTTP] {_basename}"
    emit("log", message=msg)

    resp = requests.get(url, stream=True, timeout=60, headers=headers)
    # 服务器不支持 Range（返回 200）时从头下载
    if resume_pos > 0 and resp.status_code == 200:
        resume_pos = 0
    resp.raise_for_status()

    total_from_server = int(resp.headers.get("content-length", 0))
    total = resume_pos + total_from_server if total_from_server else 0
    done = resume_pos
    mode = "ab" if resume_pos > 0 else "wb"
    with open(dest_path, mode) as f:
        for chunk in resp.iter_content(chunk_size=1048576):  # 1 MB chunks
            f.write(chunk)
            done += len(chunk)
            if total and _IS_TTY and not _JSON_MODE:
                pct = done * 100 // total
                mb = done / 1024 / 1024
                print(f"\r  {pct}% ({mb:.1f} MB)", end="", flush=True)
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
    checkpoint_dir_rel = cfg.get("checkpoint_dir", f"runtime/checkpoints/{engine_name}")
    if checkpoints_base is not None and checkpoint_dir_rel.startswith("runtime/checkpoints/"):
        checkpoint_dir = checkpoints_base / checkpoint_dir_rel[len("runtime/checkpoints/"):]
    elif checkpoints_base is not None and checkpoint_dir_rel.startswith("user_data/"):
        # user_data/ もユーザーディレクトリに保存（アプリ更新でデータ消失しない）
        # checkpoints_base = <USER_DATA_BASE>/checkpoints → .parent = <USER_DATA_BASE>
        checkpoint_dir = checkpoints_base.parent / checkpoint_dir_rel
    else:
        # runtime/engine/ 等はアプリバンドル内に保存
        checkpoint_dir = resources_root / checkpoint_dir_rel
    checkpoint_files: list[dict] = cfg.get("checkpoint_files", [])

    if not checkpoint_files:
        msg = f"  [{engine_name}] 无需 checkpoint_files，继续检查 HF 缓存/本地模型"
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
                    _skip_idx = _next_file_index()
                    _skip_tag = _fmt_tag(_skip_idx)
                    print(f"  {_skip_tag} ✓ {rel_path}  ({dest.stat().st_size // 1024 // 1024} MB)  sha256={expected_sha256[:12]}…")
                    emit("log", message=f"  {_skip_tag} ✓ {rel_path}  (已安装)")
                    continue
            else:
                actual = sha256_file(dest)
                sha256_updates.setdefault(engine_name, {})[rel_path] = actual
                _skip_idx = _next_file_index()
                _skip_tag = _fmt_tag(_skip_idx)
                print(f"  {_skip_tag} ✓ {rel_path}  ({dest.stat().st_size // 1024 // 1024} MB)  sha256 已记录")
                emit("log", message=f"  {_skip_tag} ✓ {rel_path}  (已安装)")
                continue

        if not required and not explicit:
            _skip_idx = _next_file_index()
            _skip_tag = _fmt_tag(_skip_idx)
            print(f"  {_skip_tag} 跳过（required=false，如需下载请用 --force 或 --engine {engine_name}）")
            emit("log", message=f"  {_skip_tag} 跳过 {rel_path}（可选）")
            continue

        _idx = emit("file_start", engine=engine_name, file=rel_path, size_mb=size_mb)

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
                print(f"  [HF {repo_type_field}] {_mask_url(repo_id_field)}/{filename_field}")
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
                    emit("file_done", engine=engine_name, file=rel_path, ok=True, idx=_idx)
                    if expected_sha256 and actual != expected_sha256:
                        print(f"    ⚠ SHA256 与 manifest 预期不符，已记录新哈希")
                else:
                    emit("file_done", engine=engine_name, file=rel_path, ok=False, error="下载后文件异常", idx=_idx)
                    if required:
                        all_ok = False
                continue

            hf_info = parse_hf_url(url)
            if hf_info:
                repo_id, filename, revision = hf_info
                # 统一优先 hf_hub_download（支持 HF_ENDPOINT 镜像、连接池、CDN），
                # 失败时回退 HTTP 直连
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
                        emit("log", message=f"    需要认证，回退 HTTP 直连…")
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
                        # 其他错误（网络超时等）：回退 HTTP 直连
                        emit("log", message=f"    hf_hub_download 失败 ({hf_err.__class__.__name__})，回退 HTTP 直连…")
                        download_via_requests(url, dest)
            else:
                download_via_requests(url, dest)

            if dest.exists() and dest.stat().st_size > 0:
                actual = sha256_file(dest)
                sha256_updates.setdefault(engine_name, {})[rel_path] = actual
                emit("file_done", engine=engine_name, file=rel_path, ok=True, idx=_idx)
                if expected_sha256 and actual != expected_sha256:
                    print(f"    ⚠ SHA256 与 manifest 预期不符，文件可能已更新，已记录新哈希")
            else:
                emit("file_done", engine=engine_name, file=rel_path, ok=False, error="下载后文件异常", idx=_idx)
                if required:
                    all_ok = False
        except Exception as e:
            err_str = str(e)
            emit("log", message=f"    ✗ 下载失败: {err_str[:300]}")
            emit("file_done", engine=engine_name, file=rel_path, ok=False, error=err_str, idx=_idx)
            if "401" in err_str or "403" in err_str:
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
        cache_dir_rel: str = item.get("cache_dir_rel", "runtime/checkpoints/hf_cache")
        size_mb: float = item.get("size_mb", 0)
        note: str = item.get("note", "")
        hf_token_required: bool = item.get("hf_token_required", False)
        if checkpoints_base is not None and cache_dir_rel.startswith("runtime/checkpoints/"):
            cache_dir = checkpoints_base / cache_dir_rel[len("runtime/checkpoints/"):]
        elif checkpoints_base is not None:
            cache_dir = checkpoints_base / "hf_cache"
        else:
            cache_dir = resources_root / cache_dir_rel

        required: bool = item.get("required", True)
        size_str = f"~{size_mb:.0f} MB" if size_mb else "未知大小"
        label = f"{_mask_url(repo_id)}/{filename}" if filename else _mask_url(repo_id)

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
            _skip_idx = _next_file_index()
            _skip_tag = _fmt_tag(_skip_idx)
            msg = f"  {_skip_tag} ✓ {label}  (已缓存 {cached_size_mb:.0f} MB)  {note}"
            emit("log", message=msg)
            continue

        size_indicator = f"[{size_str}]" if size_mb else ""
        status = "必填" if required else "可选"
        partial_hint = ""
        if blobs_real_size > 0 or direct_size > 0:
            partial_mb = max(blobs_real_size, direct_size) / 1024 / 1024
            partial_hint = f"  (已有 {partial_mb:.1f} MB 部分数据，将继续下载)"
        if not required and not force and not explicit:
            _skip_idx = _next_file_index()
            _skip_tag = _fmt_tag(_skip_idx)
            skip_msg = f"  {_skip_tag} 跳过 {label}（可选）"
            emit("log", message=skip_msg)
            continue

        if check_only:
            all_ok = False
            continue

        # 门控仓库：提前检查 token
        if hf_token_required and not token:
            warn = (f"    ⚠ {_mask_url(repo_id)} 是门控仓库（gated），需要 HuggingFace token。\n"
                    f"    请前往 https://huggingface.co/settings/tokens 生成 token，\n"
                    f"    然后设置环境变量 HF_TOKEN=hf_xxx 后重新安装。")
            print(warn)
            emit("log", message=warn)
            all_ok = False
            continue

        # Windows で相対パスだと HF Hub 内部の DLL ロードやキャッシュ参照が失敗するため絶対パスに変換
        cache_dir = cache_dir.resolve()
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

        _idx = emit("file_start", engine=engine_name, file=label, size_mb=size_mb)

        try:
            if filename:
                final_dest = cache_dir / filename
                final_dest.parent.mkdir(parents=True, exist_ok=True)
                # 清理直接下载模式下的残留 .incomplete 文件
                for _sf in final_dest.parent.iterdir():
                    if _sf.is_file() and _sf.name.endswith(('.incomplete', '.lock')) and _sf.name.startswith(final_dest.name):
                        try:
                            _sf.unlink()
                        except Exception:
                            pass
                # 统一优先 hf_hub_download（支持镜像、CDN），失败时回退 HTTP 直连
                msg2 = f"  [HF单文件] {_mask_url(repo_id)}  {filename}  revision={revision}"
                print(msg2)
                emit("log", message=msg2)
                try:
                    downloaded = Path(hf_hub_download(
                        repo_id=repo_id, filename=filename,
                        revision=revision, cache_dir=str(cache_dir), token=token,
                    ))
                    if downloaded.resolve() != final_dest.resolve():
                        shutil.copy2(downloaded, final_dest)
                except Exception as hf_err:
                    emit("log", message=f"    hf_hub_download 失败 ({hf_err.__class__.__name__})，回退 HTTP 直连…")
                    hf_url = f"{HF_ENDPOINT}/{repo_id}/resolve/{revision}/{filename}"
                    download_via_requests(hf_url, final_dest)

                if not final_dest.exists() or final_dest.stat().st_size <= 0:
                    raise FileNotFoundError(f"下载完成后目标文件不存在: {final_dest}")
            else:
                ignore_patterns: list[str] = item.get("ignore_patterns", [])
                msg2 = (f"  [HF快照] {_mask_url(repo_id)}  revision={revision}"
                        + (f"\n    忽略文件: {ignore_patterns}" if ignore_patterns else "")
                        + f"\n    预计大小: {size_str}，请耐心等待（可能需要几分钟）…")
                print(msg2)
                emit("log", message=msg2)

                snapshot_download(
                    repo_id=repo_id, revision=revision,
                    cache_dir=str(cache_dir), token=token,
                    ignore_patterns=ignore_patterns or None,
                )

            done_msg = f"    ✓ 下载完成: {label}"
            emit("log", message=done_msg)
            emit("file_done", engine=engine_name, file=label, ok=True, idx=_idx)
            # 创建 refs/main（若不存在），使 hf_hub_download 离线模式可在不指定
            # revision 参数时找到已缓存的文件（refs/main 是 HF 缓存格式的入口指针）。
            if revision:
                refs_dir = marker_dir / "refs"
                refs_main = refs_dir / "main"
                if not refs_main.exists():
                    refs_dir.mkdir(parents=True, exist_ok=True)
                    refs_main.write_text(revision, encoding="utf-8")
            # 同时在 hf_cache 目录创建软链接，使绝对路径 HF_HUB_CACHE 也能找到该缓存
            # （当 cache_dir_rel != "runtime/checkpoints/hf_cache" 时，模型存于 runtime/checkpoints/ 根目录）
            hf_cache_dir = (checkpoints_base or (resources_root / "checkpoints")) / "hf_cache"
            if cache_dir_rel != "runtime/checkpoints/hf_cache":
                hf_cache_dir.mkdir(parents=True, exist_ok=True)
                link_target = hf_cache_dir / marker_dir.name
                try:
                    if not os.path.lexists(link_target):
                        link_target.symlink_to(os.path.relpath(marker_dir, hf_cache_dir))
                except FileExistsError:
                    pass
                except OSError:
                    # Windows では管理者権限なしで symlink 作成できない場合がある。
                    # junction（ディレクトリジャンクション）またはコピーで代替する。
                    if os.name == "nt" and not os.path.lexists(link_target):
                        try:
                            import _winapi
                            _winapi.CreateJunction(str(marker_dir), str(link_target))
                        except Exception:
                            shutil.copytree(marker_dir, link_target, dirs_exist_ok=True)
        except Exception as e:
            err_str = str(e)
            err_msg = f"    ✗ 下载失败: {err_str[:300]}"
            emit("log", message=err_msg)
            is_gated = "gated" in err_str.lower() or "access to model" in err_str.lower()
            is_auth = "401" in err_str or "403" in err_str
            if is_gated and (is_auth or token):
                hint = (f"    提示：{_mask_url(repo_id)} 是受限模型（gated repo），需先同意使用条款后才能下载。\n"
                        f"    请前往模型页面登录并点击 \"Agree and access repository\"，\n"
                        f"    然后确保已设置有效的 HF_TOKEN 环境变量后重试。")
                print(hint)
                emit("log", message=hint)
            elif is_auth:
                hint = f"    提示：{_mask_url(repo_id)} 需要 HF token，请设置 HF_TOKEN 环境变量后重试"
                print(hint)
                emit("log", message=hint)
            emit("file_done", engine=engine_name, file=label, ok=False, error=err_str[:200], idx=_idx)
            if required:
                all_ok = False

    return all_ok



def get_facefusion_packages_dir(project_root: Path, checkpoints_base: "Path | None" = None) -> Path:
    """返回 FaceFusion 独立 site-packages 目录。

    与 backend/utils/engine.py build_engine_env() 保持一致：
    开发：runtime/engine/facefusion/.packages/
    生产：<RESOURCES_ROOT>/runtime/engine/facefusion/.packages/

    FaceFusion packages 与引擎源码同级，避免 runtime 根目录污染。
    """
    if checkpoints_base is not None:
        # checkpoints_base = <USER_DATA_BASE>/checkpoints → .parent = <USER_DATA_BASE>
        return checkpoints_base.parent / "runtime" / "engine" / "facefusion" / ".packages"
    checkpoints_dir_env = os.getenv("CHECKPOINTS_DIR", "").strip()
    if checkpoints_dir_env:
        return Path(checkpoints_dir_env).resolve().parent / "runtime" / "engine" / "facefusion" / ".packages"
    return project_root / "runtime" / "engine" / "facefusion" / ".packages"


def setup_facefusion_engine(
    project_root: Path,
    resources_root: Path,
    checkpoints_base: "Path | None" = None,
    pypi_mirror: str = "",
) -> bool:
    """为 FaceFusion 安装 pip 依赖到独立 .packages 目录。

    引擎源码由 runtime 阶段（pnpm run runtime）clone，打包时通过
    extraResources 同梱，此处仅负责安装 Python 依赖。
    """
    # 优先用 resources_root（打包后指向 app.asar 旁的资源目录）
    runtime_root = resources_root if (resources_root / "runtime").exists() else project_root
    engine_dir = runtime_root / "runtime" / "engine" / "facefusion"
    sentinel = engine_dir / "facefusion" / "__init__.py"

    if not sentinel.exists():
        print(f"  ✗ FaceFusion 引擎未找到（{sentinel}），请先运行 pnpm run runtime")
        emit("log", message="  ✗ FaceFusion 引擎未找到，请先运行 pnpm run runtime")
        return False

    print(f"  ✓ FaceFusion 引擎已存在（{sentinel}）")

    py = sys.executable

    # ── 直接用嵌入式 pip 安装依赖（绕过 install.py 的 conda 检查）──────
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
    target_dir = get_facefusion_packages_dir(project_root, checkpoints_base)
    target_dir.mkdir(parents=True, exist_ok=True)

    print(f"  [facefusion] 安装 {len(packages)} 个依赖包（可能需要 3-10 分钟）...")
    emit("log", message=f"  正在安装 FaceFusion 依赖（{len(packages)} 个包，可能需要 3-10 分钟）…")
    emit("log", message=f"  FaceFusion 独立环境目录：{target_dir}")

    pip_cmd = [
        py, "-m", "pip", "install",
        "--quiet",
        "--disable-pip-version-check",
        "--no-warn-conflicts",
        "--target", str(target_dir),
        "--upgrade",
    ] + packages
    if pypi_mirror:
        pip_cmd += ["--index-url", pypi_mirror, "--extra-index-url", "https://pypi.org/simple"]
    pip_env = {
        **os.environ,
        "PYTHONPATH": str(target_dir),
        "PYTHONNOUSERSITE": "1",
    }
    proc = subprocess.Popen(
        pip_cmd,
        cwd=str(engine_dir),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=pip_env,
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


def prefetch_rvc_base_models(project_root: Path, resources_root: Path) -> None:
    """RVC checkpoint 文件已在 manifest 中完整声明（hubert_base.pt、f0G40k.pth），无需额外 prefetch。"""
    # 本函数保留但不执行任何操作。RVC 基础模型已通过 manifest checkpoint_files 下载。
    # 若来自 setup 或 ml 阶段的 rvc-python 内蔵缓存，会在首次 rvc 推理时自动初始化。
    pass


def prefetch_faster_whisper_model(
    project_root: Path,
    cfg: dict,
    resources_root: Path,
    checkpoints_base: "Path | None",
    check_only: bool = False,
    model: str = "large-v3",
) -> bool:
    """预下载 faster-whisper 模型到 checkpoint_dir/{model}/。

    与 prefetch_rvc_base_models 模式一致：使用嵌入式 Python 触发下载，
    要求 pnpm run setup 已安装 faster-whisper。
    """
    checkpoint_dir_rel = cfg.get("checkpoint_dir", "runtime/checkpoints/faster_whisper")
    if checkpoints_base is not None and checkpoint_dir_rel.startswith("runtime/checkpoints/"):
        checkpoint_dir = checkpoints_base / checkpoint_dir_rel[len("runtime/checkpoints/"):]
    else:
        checkpoint_dir = resources_root / checkpoint_dir_rel

    model_dir = checkpoint_dir / model
    model_bin = model_dir / "model.bin"

    if model_bin.exists() and model_bin.stat().st_size > 0:
        size_mb = model_bin.stat().st_size // 1024 // 1024
        _skip_idx = _next_file_index()
        _skip_tag = _fmt_tag(_skip_idx)
        print(f"  {_skip_tag} ✓ faster-whisper/{model}  ({size_mb} MB)")
        emit("log", message=f"  {_skip_tag} ✓ faster-whisper/{model}  (已安装)")
        return True

    size_hint = {"tiny": 40, "base": 150, "small": 490, "medium": 1500,
                 "large-v2": 3100, "large-v3": 3100, "large-v3-turbo": 1600}.get(model, 0)
    size_str = f"~{size_hint} MB" if size_hint else "未知大小"
    _idx = emit("file_start", engine="faster_whisper", file=f"{model}/model.bin", size_mb=size_hint)

    if check_only:
        return False

    py = sys.executable

    runtime_env = dict(os.environ)

    print(f"  [faster-whisper] 下载 {model} 模型到 {model_dir} ...")
    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    # 优先使用 faster_whisper.utils.download_model（如果已安装），
    # 否则回退到 huggingface_hub.snapshot_download（不依赖 faster-whisper 包）。
    # 这样即使 checkpoint 与 ml-base 并行运行（faster-whisper 尚未安装）也能下载。
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
    # 回退到 huggingface_hub（不需要 faster-whisper 已安装）
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
    clean_env = {k: v for k, v in runtime_env.items() if k not in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE")}
    r = subprocess.run(
        [py, "-c", script],
        capture_output=True, text=True, timeout=1800,
        env=clean_env,
    )
    if r.returncode == 0 and model_bin.exists() and model_bin.stat().st_size > 0:
        size_mb = model_bin.stat().st_size // 1024 // 1024
        emit("file_done", engine="faster_whisper", file=f"{model}/model.bin", ok=True, idx=_idx)
        return True
    else:
        err = ((r.stderr or "") + (r.stdout or "")).strip()[:300]
        emit("file_done", engine="faster_whisper", file=f"{model}/model.bin", ok=False, error=err, idx=_idx)
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
    # JSON 模式：print() 重定向到 stderr，只有 emit() 通过 _REAL_STDOUT 写 JSON Lines
    if _JSON_MODE:
        sys.stdout = sys.stderr

    # CLI 参数优先于环境变量
    if args.hf_endpoint:
        global HF_ENDPOINT
        HF_ENDPOINT = args.hf_endpoint.rstrip("/")

    if not args.check_only:
        _bootstrap_download_deps()

    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent

    resources_root = project_root

    checkpoints_dir_env = os.getenv("CHECKPOINTS_DIR", "").strip()
    checkpoints_base: "Path | None" = Path(checkpoints_dir_env).resolve() if checkpoints_dir_env else None

    manifest_path = resources_root / "runtime" / "manifest.json"
    if manifest_path.exists():
        active_root = resources_root
    else:
        manifest_path = project_root / "runtime" / "manifest.json"
        if manifest_path.exists():
            active_root = project_root
        else:
            manifest_path = resources_root / "backend" / "wrappers" / "manifest.json"
            if manifest_path.exists():
                active_root = resources_root
            else:
                manifest_path = project_root / "backend" / "wrappers" / "manifest.json"
                active_root = project_root

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
    sha256_lock = threading.Lock()
    all_ready = True
    ready_lock = threading.Lock()

    # 明确指定 --engine 或 --engines 时视为用户主动请求，required=false 的项目也要下载
    explicit = bool(args.engine or args.engines)

    # 预计算全局文件总数（checkpoint_files + hf_cache_downloads + faster_whisper 模型）
    global _file_total, _file_counter
    _file_counter = 0
    total = 0
    for ename, ecfg in engines.items():
        if args.engine and ename != args.engine:
            continue
        total += len(ecfg.get("checkpoint_files", []))
        total += len(ecfg.get("hf_cache_downloads", []))
        if ename == "faster_whisper":
            total += 2  # large-v3 + base
    _file_total = total

    def _process_engine(engine_name: str, cfg: dict) -> bool:
        """处理单个引擎的 checkpoint 下载。返回是否全部就绪。"""
        engine_ready = True
        print(f"▶ {engine_name} (v{cfg.get('version', '?')})")
        emit("engine_start", engine=engine_name, version=cfg.get("version", "?"))

        # FaceFusion：先 clone 引擎源码，再下载模型
        if engine_name == "facefusion" and not args.check_only:
            ok_ff = setup_facefusion_engine(
                project_root,
                resources_root,
                checkpoints_base=checkpoints_base,
                pypi_mirror=args.pypi_mirror,
            )
            if not ok_ff:
                engine_ready = False

        # 下载 manifest checkpoint_files（线程安全：sha256_updates 用锁保护）
        local_sha256: dict = {}
        ok = check_and_download(engine_name, cfg, resources_root, args.check_only, args.force,
                                local_sha256, checkpoints_base=checkpoints_base,
                                explicit=explicit)
        if local_sha256:
            with sha256_lock:
                sha256_updates.update(local_sha256)
        if not ok:
            engine_ready = False

        # 下载额外 HF 缓存模型
        if cfg.get("hf_cache_downloads"):
            ok2 = download_hf_cache(engine_name, cfg, resources_root, args.check_only, args.force,
                                    checkpoints_base=checkpoints_base, explicit=explicit)
            if not ok2:
                engine_ready = False

        # faster-whisper 模型预下载（large-v3 用于生产，base 用于烟雾测试等轻量场景）
        if engine_name == "faster_whisper":
            for _fw_model in ("large-v3", "base"):
                ok3 = prefetch_faster_whisper_model(
                    project_root, cfg, resources_root, checkpoints_base,
                    check_only=args.check_only,
                    model=_fw_model,
                )
                if not ok3:
                    engine_ready = False

        # RVC base model 预下载
        if engine_name == "rvc" and not args.check_only:
            prefetch_rvc_base_models(project_root, resources_root)

        print()
        return engine_ready

    # 并行下载各引擎 checkpoint（I/O 密集型，线程池显著提升速度）
    engine_items = [(k, v) for k, v in engines.items()
                    if not args.engine or k == args.engine]

    if len(engine_items) <= 1:
        # 单引擎时无需线程池
        for engine_name, cfg in engine_items:
            if not _process_engine(engine_name, cfg):
                all_ready = False
    else:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        # 限制并发数为 3，避免带宽和连接数过高
        max_workers = min(3, len(engine_items))
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {
                pool.submit(_process_engine, name, cfg): name
                for name, cfg in engine_items
            }
            for future in as_completed(futures):
                engine_name = futures[future]
                try:
                    if not future.result():
                        all_ready = False
                except Exception as exc:
                    print(f"  ✗ {engine_name} 处理异常: {exc}")
                    emit("log", message=f"  ✗ {engine_name} 处理异常: {str(exc)[:200]}")
                    all_ready = False

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
