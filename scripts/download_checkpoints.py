#!/usr/bin/env python3
"""
检查并下载 Fish Speech / Seed-VC / Whisper 所需的 checkpoint 文件。
从 runtime/manifest.json 读取文件清单，仅下载缺失的文件。
下载完成后自动计算 sha256 并写回 manifest.json，后续运行自动校验完整性。

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
import sys
from pathlib import Path

# ─── 版本锁定（锁定到具体 commit hash，防止仓库更新导致文件变化）─────────────────
# 从 HuggingFace 仓库 Files → History 页面获取 commit hash
REVISION_PINS: dict[str, str] = {
    "fishaudio/fish-speech-1.5": "main",  # 建议锁定：填入具体 commit hash
    "Plachta/Seed-VC":           "main",  # 建议锁定：填入具体 commit hash
}


def parse_hf_url(url: str) -> tuple[str, str] | None:
    """从 HuggingFace resolve URL 解析出 repo_id 和 filename。"""
    prefix = "https://huggingface.co/"
    if not url.startswith(prefix):
        return None
    rest = url[len(prefix):]
    parts = rest.split("/")
    if len(parts) < 5 or parts[2] != "resolve":
        return None
    repo_id = f"{parts[0]}/{parts[1]}"
    filename = "/".join(parts[4:])
    return repo_id, filename


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def get_hf_token() -> str | None:
    """读取 HuggingFace token：环境变量 > ~/.cache/huggingface/token"""
    token = os.getenv("HF_TOKEN", "").strip()
    if token:
        return token
    token_file = Path.home() / ".cache" / "huggingface" / "token"
    if token_file.exists():
        return token_file.read_text().strip() or None
    return None


_hf_login_done = False  # 同一次运行只触发一次登录

def ensure_hf_login() -> bool:
    """遇到 401 时交互式登录，成功返回 True。同一次运行只登录一次。"""
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


def download_via_hf_hub(repo_id: str, filename: str, dest_dir: Path) -> Path:
    from huggingface_hub import hf_hub_download
    revision = REVISION_PINS.get(repo_id, "main")
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
    print(f"  [HTTP] {url}")
    resp = requests.get(url, stream=True, timeout=60)
    resp.raise_for_status()
    total = int(resp.headers.get("content-length", 0))
    done = 0
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    with open(dest_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=65536):
            f.write(chunk)
            done += len(chunk)
            if total:
                pct = done * 100 // total
                mb = done / 1024 / 1024
                print(f"\r  {pct}% ({mb:.1f} MB)", end="", flush=True)
    print()


def check_and_download(
    engine_name: str,
    cfg: dict,
    resources_root: Path,
    check_only: bool,
    force: bool,
    sha256_updates: dict,   # {engine_name: {rel_path: sha256}} 收集需要写回的哈希
) -> bool:
    checkpoint_dir_rel = cfg.get("checkpoint_dir", f"checkpoints/{engine_name}")
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

        # ── force 模式删除旧文件 ───────────────────────────────────────────
        if force and dest.exists():
            print(f"  --force: 删除旧文件 {rel_path}")
            dest.unlink()

        # ── 文件已存在 ────────────────────────────────────────────────────
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
                    # 继续往下走下载流程
                else:
                    print(f"  ✓ {rel_path}  ({dest.stat().st_size // 1024 // 1024} MB)  sha256={expected_sha256[:12]}…")
                    continue
            else:
                # 首次运行已有文件但无 sha256：计算并记录，下次可校验
                actual = sha256_file(dest)
                sha256_updates.setdefault(engine_name, {})[rel_path] = actual
                print(f"  ✓ {rel_path}  ({dest.stat().st_size // 1024 // 1024} MB)  sha256 已记录")
                continue

        # ── 文件缺失，准备下载 ────────────────────────────────────────────
        size_str = f"~{size_mb:.0f} MB" if size_mb else "未知大小"
        status = "必填" if required else "可选"
        print(f"  ✗ {rel_path}  [{status}] {size_str}")

        if check_only:
            if required:
                all_ok = False
            continue

        if not url:
            print(f"    没有下载链接，请手动放置到: {dest}")
            if required:
                all_ok = False
            continue

        # ── 下载 ─────────────────────────────────────────────────────────
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            hf_info = parse_hf_url(url)
            if hf_info:
                repo_id, filename = hf_info
                try:
                    downloaded = download_via_hf_hub(repo_id, filename, checkpoint_dir)
                    if downloaded.resolve() != dest.resolve():
                        downloaded.rename(dest)
                except Exception as hf_err:
                    is_auth_err = ("401" in str(hf_err) or "403" in str(hf_err)
                                   or "authentication" in str(hf_err).lower()
                                   or "Unauthorized" in str(hf_err))
                    if is_auth_err:
                        # 先尝试直接 HTTP（部分仓库无需登录）
                        try:
                            download_via_requests(url, dest)
                        except Exception as http_err:
                            if "401" in str(http_err) or "403" in str(http_err):
                                # 直接 HTTP 也需要认证 → 触发交互式登录并重试
                                if ensure_hf_login():
                                    print(f"  [HF] 重试下载 {filename}")
                                    downloaded = download_via_hf_hub(repo_id, filename, checkpoint_dir)
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
                if expected_sha256 and actual != expected_sha256:
                    print(f"    ⚠ SHA256 与 manifest 预期不符，文件可能已更新，已记录新哈希")
            else:
                print(f"    ✗ 下载后文件异常")
                if required:
                    all_ok = False
        except Exception as e:
            print(f"    ✗ 下载失败: {e}")
            if "401" in str(e) or "403" in str(e):
                print(f"    提示：可设置环境变量 HF_TOKEN=xxx 后重试")
            if required:
                all_ok = False

    return all_ok


def save_sha256_to_manifest(manifest: dict, manifest_path: Path, sha256_updates: dict) -> None:
    """将计算好的 sha256 写回 manifest.json。"""
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
) -> bool:
    """下载需要写入 HF 缓存格式的额外模型（如 campplus、BigVGAN、Whisper-small）。"""
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
        cache_dir = resources_root / cache_dir_rel

        size_str = f"~{size_mb:.0f} MB" if size_mb else "未知大小"
        label = f"{repo_id}/{filename}" if filename else repo_id

        # 检测：看 HF 缓存目录中是否已有该 repo 的 blobs（HF 缓存文件名为哈希，无后缀）
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
        try:
            if filename:
                # 单文件下载
                print(f"  [HF单文件] {repo_id}  {filename}  cache_dir={cache_dir}")
                hf_hub_download(
                    repo_id=repo_id,
                    filename=filename,
                    cache_dir=str(cache_dir),
                    token=token,
                )
            else:
                # 整仓库快照下载
                ignore_patterns: list[str] = item.get("ignore_patterns", [])
                print(f"  [HF快照] {repo_id}  cache_dir={cache_dir}"
                      + (f"  忽略: {ignore_patterns}" if ignore_patterns else ""))
                snapshot_download(
                    repo_id=repo_id,
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
    import platform
    if platform.system() == "Windows":
        candidates = [project_root / "runtime" / "win" / "python" / "python.exe"]
    else:
        candidates = [
            project_root / "runtime" / "mac" / "python" / "bin" / "python3",
            project_root / "runtime" / "mac" / "python" / "bin" / "python",
        ]
    for p in candidates:
        if p.exists():
            return str(p)
    return ""


def setup_pip_packages(engine_name: str, cfg: dict, project_root: Path, check_only: bool) -> bool:
    """为引擎安装 manifest 中声明的 pip_packages 到嵌入式 Python 环境。"""
    packages: list[str] = cfg.get("pip_packages", [])
    if not packages:
        return True

    py = get_embedded_python(project_root)
    if not py:
        print(f"  [{engine_name}] 嵌入式 Python 未找到，跳过 pip 安装")
        return False

    all_ok = True
    for pkg in packages:
        # 检查是否已安装（把包名转为模块名：rvc-python → rvc_python）
        module_name = pkg.replace("-", "_").split("==")[0].split(">=")[0]
        try:
            import subprocess
            check = subprocess.run(
                [py, "-c", f"import {module_name}"],
                capture_output=True,
            )
            already = check.returncode == 0
        except Exception:
            already = False

        if already:
            print(f"  ✓ {pkg}  (已安装)")
            continue

        print(f"  ✗ {pkg}  (未安装)")
        if check_only:
            all_ok = False
            continue

        print(f"  [pip] 安装 {pkg} ...")
        try:
            import subprocess
            result = subprocess.run(
                [py, "-m", "pip", "install", pkg, "--quiet"],
                capture_output=True, text=True, timeout=300,
            )
            if result.returncode == 0:
                print(f"    ✓ 安装成功: {pkg}")
            else:
                print(f"    ✗ 安装失败: {result.stderr.strip()[:200]}")
                all_ok = False
        except Exception as e:
            print(f"    ✗ 安装异常: {e}")
            all_ok = False

    return all_ok


def _patch_fairseq_for_py312(py: str) -> None:
    """修补 fairseq 以兼容 Python 3.12 + 新版 omegaconf。"""
    import subprocess, re

    # 找到 fairseq 安装目录
    result = subprocess.run(
        [py, "-c", "import fairseq; import os; print(os.path.dirname(fairseq.__file__))"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        return
    fairseq_dir = Path(result.stdout.strip())

    # 1. 修补 __init__.py：把批量 import 包在 try/except 里（跳过 Python 3.12 不兼容模块）
    init_py = fairseq_dir / "__init__.py"
    if init_py.exists():
        text = init_py.read_text(encoding="utf-8")
        # hydra_init 包 try/except
        if "hydra_init()" in text and "try:\n    hydra_init()" not in text:
            text = text.replace("hydra_init()", "try:\n    hydra_init()\nexcept Exception:\n    pass  # Py3.12 兼容跳过")
        # 把批量 import fairseq.X 替换为 try/except 循环
        bulk_imports = re.findall(r"^import fairseq\.\S+.*$", text, re.MULTILINE)
        if bulk_imports:
            block = "\n".join(bulk_imports)
            loop = (
                "for _m in " + repr([b.replace("import ", "").replace("  # noqa", "").strip()
                                      for b in bulk_imports]) + ":\n"
                "    try:\n"
                "        import importlib as _il; _il.import_module(_m)\n"
                "    except Exception:\n"
                "        pass\n"
            )
            text = text.replace(block, loop)
        init_py.write_text(text, encoding="utf-8")

    def _fix_mutable_defaults(py_file: Path) -> None:
        """把文件中所有 FieldName = ClassName() 和 field(default=ClassName()) 替换为 field(default_factory=ClassName)。"""
        if not py_file.exists():
            return
        text = py_file.read_text(encoding="utf-8")
        # 模式 1：`    field: Type = ClassName()`
        pattern1 = r'^(\s+\w+:\s+\w+)\s*=\s*(\w+)\(\)$'
        def _rep1(m: re.Match) -> str:
            prefix, typename = m.group(1), m.group(2)
            if typename[0].isupper() and typename not in ("Optional", "List", "Dict", "Tuple", "Any"):
                return f"{prefix} = field(default_factory={typename})"
            return m.group(0)
        text = re.sub(pattern1, _rep1, text, flags=re.MULTILINE)
        # 模式 2：`field(default=ClassName())`
        text = re.sub(r'field\(default=([A-Z]\w+)\(\)\)', r'field(default_factory=\1)', text)
        py_file.write_text(text, encoding="utf-8")

    # 2. 修补所有 fairseq dataclass 文件（含 transformer_config.py）
    for rel in [
        "dataclass/configs.py",
        "models/transformer/transformer_config.py",
    ]:
        _fix_mutable_defaults(fairseq_dir / rel)

    print("    ✓ fairseq Python 3.12 兼容补丁已应用")


def _install_rvc_python(py: str) -> bool:
    """安装 rvc-python 及其依赖（含 fairseq 兼容处理）。"""
    import subprocess

    def pip(*args: str) -> bool:
        r = subprocess.run([py, "-m", "pip", "install", *args, "--quiet"],
                           capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            print(f"    ✗ pip install {' '.join(args)} 失败: {r.stderr.strip()[:200]}")
        return r.returncode == 0

    # 降级 setuptools 以恢复 pkg_resources（pyworld 依赖）
    pip("setuptools<72")

    # 安装 fairseq（跳过依赖冲突：omegaconf 版本问题）
    print("  [pip] 安装 fairseq (--no-deps) ...")
    if not pip("fairseq==0.12.2", "--no-deps"):
        return False

    # 修补 fairseq 兼容 Python 3.12
    _patch_fairseq_for_py312(py)

    # 安装 bitarray（fairseq 推理需要）
    pip("bitarray")

    # 安装 rvc-python 本体（跳过 fairseq 依赖冲突）
    print("  [pip] 安装 rvc-python (--no-deps) ...")
    if not pip("rvc-python", "--no-deps"):
        return False

    # 安装 rvc-python 其余依赖（排除 fairseq/numpy 等已有包）
    print("  [pip] 安装 rvc-python 运行时依赖 ...")
    pip("av", "faiss-cpu", "ffmpeg-python", "praat-parselmouth", "pyworld", "torchcrepe")

    return True


def _prefetch_rvc_base_models(py: str) -> None:
    """触发 rvc-python 的 base_model 预下载（hubert_base.pt / rmvpe.pt / rmvpe.onnx）。"""
    import subprocess
    print("  [rvc] 预下载 hubert_base.pt / rmvpe.pt / rmvpe.onnx ...")
    r = subprocess.run(
        [py, "-c",
         "from rvc_python.infer import RVCInference; RVCInference()"],
        capture_output=True, text=True, timeout=600,
    )
    if r.returncode == 0:
        print("    ✓ RVC 基础模型已就绪")
    else:
        print(f"    ✗ 预下载失败（可能需要联网）: {r.stderr.strip()[:200]}")


def setup_rvc_engine(project_root: Path, check_only: bool) -> bool:
    """安装 rvc-python、生成推理脚本、预下载 base 模型。"""
    engine_dir = project_root / "runtime" / "rvc" / "engine"
    infer_script = engine_dir / "infer.py"

    py = get_embedded_python(project_root)
    if not py:
        print("  [rvc] 嵌入式 Python 未找到，跳过 RVC 安装")
        return False

    # 检查 rvc-python 是否已安装
    import subprocess
    check = subprocess.run([py, "-c", "from rvc_python.infer import RVCInference"],
                           capture_output=True)
    rvc_installed = (check.returncode == 0)

    if rvc_installed:
        print("  ✓ rvc-python  (已安装)")
    else:
        print("  ✗ rvc-python  (未安装)")
        if not check_only:
            if _install_rvc_python(py):
                print("    ✓ rvc-python 安装完成")
            else:
                print("    ✗ rvc-python 安装失败，RVC 功能不可用")

    # 检查并生成 engine/infer.py
    if infer_script.exists():
        print(f"  ✓ runtime/rvc/engine/infer.py  (已存在)")
    else:
        print(f"  ✗ runtime/rvc/engine/infer.py  (缺失)")
        if not check_only:
            engine_dir.mkdir(parents=True, exist_ok=True)
            script_content = '''#!/usr/bin/env python3
"""
RVC 推理脚本（使用 rvc-python 库）
由 download_checkpoints.py 自动生成，请勿手动修改。
"""
import argparse
import sys
from pathlib import Path


def detect_version(model_path: str) -> str:
    """从 checkpoint 自动检测 v1/v2，避免 emb_phone 尺寸不匹配。"""
    try:
        import torch
        cpt = torch.load(model_path, map_location="cpu", weights_only=False)
        version = cpt.get("version", "")
        if version in ("v1", "v2"):
            return version
        emb = cpt.get("weight", {}).get("enc_p.emb_phone.weight")
        if emb is not None:
            return "v2" if emb.shape[1] == 768 else "v1"
    except Exception:
        pass
    return "v2"


def main() -> int:
    parser = argparse.ArgumentParser(description="RVC 语音转换")
    parser.add_argument("--input",  required=True, help="输入音频路径")
    parser.add_argument("--output", required=True, help="输出音频路径")
    parser.add_argument("--model",  required=True, help="模型 .pth 路径")
    parser.add_argument("--index",  default="",    help="索引文件路径（可选）")
    args = parser.parse_args()

    try:
        from rvc_python.infer import RVCInference
    except ImportError:
        print("[rvc] 缺少 rvc-python 包，请重新运行 pnpm run checkpoints。", file=sys.stderr)
        return 1

    input_path  = str(Path(args.input).resolve())
    output_path = str(Path(args.output).resolve())
    model_path  = str(Path(args.model).resolve())
    index_path  = str(Path(args.index).resolve()) if args.index else ""

    version = detect_version(model_path)

    try:
        rvc = RVCInference(device="cpu")
        rvc.load_model(model_path, version=version, index_path=index_path)
        rvc.infer_file(input_path, output_path)
    except Exception as e:
        print(f"[rvc] 推理失败: {e}", file=sys.stderr)
        return 1

    if not Path(output_path).exists() or Path(output_path).stat().st_size == 0:
        print("[rvc] 输出文件缺失或为空", file=sys.stderr)
        return 1

    print(f"[rvc] ok -> {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
'''
            infer_script.write_text(script_content, encoding="utf-8")
            print(f"    ✓ 已创建 runtime/rvc/engine/infer.py")

    # 预下载 base_model（hubert_base.pt 等）
    if not check_only and rvc_installed:
        rvc_pkg = subprocess.run(
            [py, "-c", "import rvc_python, os; print(os.path.dirname(rvc_python.__file__))"],
            capture_output=True, text=True,
        )
        if rvc_pkg.returncode == 0:
            base_model_dir = Path(rvc_pkg.stdout.strip()) / "base_model"
            models_needed = ["hubert_base.pt", "rmvpe.pt", "rmvpe.onnx"]
            missing = [f for f in models_needed if not (base_model_dir / f).exists()]
            if missing:
                _prefetch_rvc_base_models(py)
            else:
                print("  ✓ RVC base_model 文件已就绪")

    return True


def download_ffmpeg(project_root: Path, check_only: bool, force: bool) -> bool:
    """下载 FFmpeg 静态二进制到 runtime/{mac|win}/bin/。"""
    import platform
    import urllib.request
    import zipfile
    import tarfile

    system = platform.system()
    machine = platform.machine().lower()

    if system == "Darwin":
        # Mac arm64 / x86_64 均使用 evermeet.cx 提供的静态包
        bin_dir = project_root / "runtime" / "mac" / "bin"
        dest = bin_dir / "ffmpeg"
        # evermeet.cx 只提供 arm64 版本（Apple Silicon），x86_64 需要其他源
        # 使用 John Van Sickle 的静态构建（支持 x86_64 Linux），或 evermeet.cx（macOS）
        if machine in ("arm64", "aarch64"):
            url = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip"
        else:
            # x86_64 Mac 使用 evermeet.cx
            url = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip"
    elif system == "Windows":
        bin_dir = project_root / "runtime" / "win" / "bin"
        dest = bin_dir / "ffmpeg.exe"
        # BtbN 提供的 Windows 静态包
        url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    else:
        print(f"  [ffmpeg] 不支持的平台: {system}，跳过")
        return True

    if dest.exists() and not force:
        size_mb = dest.stat().st_size / 1024 / 1024
        print(f"  ✓ FFmpeg 已存在（{size_mb:.1f} MB）: {dest}")
        # 确保可执行
        if system != "Windows":
            dest.chmod(0o755)
        return True

    print(f"  ✗ FFmpeg 未找到: {dest}")
    if check_only:
        return False

    print(f"  [ffmpeg] 下载中（~50-80 MB）: {url}")
    bin_dir.mkdir(parents=True, exist_ok=True)
    tmp_archive = bin_dir / "_ffmpeg_tmp_archive"

    try:
        # 下载压缩包
        def _reporthook(count: int, block_size: int, total_size: int) -> None:
            if total_size > 0:
                mb = count * block_size / 1024 / 1024
                pct = min(100, int(count * block_size * 100 / total_size))
                print(f"\r  {pct}% ({mb:.1f} MB)", end="", flush=True)

        urllib.request.urlretrieve(url, str(tmp_archive), _reporthook)
        print()

        # 解压 ffmpeg 二进制
        if url.endswith(".zip"):
            with zipfile.ZipFile(tmp_archive, "r") as zf:
                # 在 zip 内搜索 ffmpeg 或 ffmpeg.exe
                target_name = "ffmpeg.exe" if system == "Windows" else "ffmpeg"
                found = None
                for name in zf.namelist():
                    basename = Path(name).name
                    if basename == target_name and not name.endswith("/"):
                        found = name
                        break
                if not found:
                    print(f"    ✗ 压缩包内未找到 {target_name}")
                    return False
                with zf.open(found) as src, open(dest, "wb") as dst:
                    dst.write(src.read())
        elif url.endswith(".tar.xz") or url.endswith(".tar.gz") or url.endswith(".tar.bz2"):
            with tarfile.open(tmp_archive) as tf:
                found = None
                for member in tf.getmembers():
                    if Path(member.name).name in ("ffmpeg", "ffmpeg.exe") and member.isfile():
                        found = member
                        break
                if not found:
                    print("    ✗ 压缩包内未找到 ffmpeg")
                    return False
                f_obj = tf.extractfile(found)
                if f_obj:
                    with open(dest, "wb") as dst:
                        dst.write(f_obj.read())
        else:
            # 直接是二进制
            import shutil
            shutil.move(str(tmp_archive), str(dest))
            tmp_archive = None  # type: ignore

        if not dest.exists() or dest.stat().st_size == 0:
            print("    ✗ 提取后文件缺失或为空")
            return False

        # 设置可执行权限（Mac/Linux）
        if system != "Windows":
            dest.chmod(0o755)

        size_mb = dest.stat().st_size / 1024 / 1024
        print(f"    ✓ FFmpeg 下载完成（{size_mb:.1f} MB）: {dest}")
        return True

    except Exception as e:
        print(f"    ✗ FFmpeg 下载失败: {e}")
        print("      提示：可手动下载 ffmpeg 静态二进制并放置到上述路径")
        return False
    finally:
        if tmp_archive and Path(str(tmp_archive)).exists():
            try:
                Path(str(tmp_archive)).unlink()
            except Exception:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description="检查并下载 AI 引擎 checkpoint 文件")
    parser.add_argument("--engine", help="只处理指定引擎（fish_speech / seed_vc / whisper / rvc）")
    parser.add_argument("--check-only", action="store_true", help="只检查，不下载")
    parser.add_argument("--force", action="store_true", help="强制重新下载（覆盖已有文件）")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent

    resources_root_env = os.getenv("RESOURCES_ROOT", "")
    resources_root = Path(resources_root_env).resolve() if resources_root_env else project_root

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

        # 1. 下载 manifest checkpoint_files
        ok = check_and_download(engine_name, cfg, resources_root, args.check_only, args.force, sha256_updates)
        if not ok:
            all_ready = False

        # 2. 下载额外 HF 缓存模型（如 seed_vc 的 campplus / BigVGAN / Whisper-small）
        if cfg.get("hf_cache_downloads"):
            ok2 = download_hf_cache(engine_name, cfg, resources_root, args.check_only, args.force)
            if not ok2:
                all_ready = False

        # 3. 安装 pip 包（manifest 中声明的）
        if cfg.get("pip_packages"):
            if engine_name == "rvc":
                # RVC 需要特殊处理（fairseq 兼容 + base_model 预下载）
                setup_rvc_engine(project_root, args.check_only)
            else:
                setup_pip_packages(engine_name, cfg, project_root, args.check_only)
        elif engine_name == "rvc":
            # rvc 即使无 pip_packages 也要跑引擎初始化
            setup_rvc_engine(project_root, args.check_only)

        print()

    if sha256_updates and not args.check_only:
        save_sha256_to_manifest(manifest, manifest_path, sha256_updates)
        print()

    # FFmpeg 静态二进制（仅在无 --engine 过滤时处理）
    if not args.engine:
        print("▶ ffmpeg")
        ok_ffmpeg = download_ffmpeg(project_root, args.check_only, args.force)
        if not ok_ffmpeg:
            all_ready = False
        print()

    if all_ready:
        print("✓ 所有必填 checkpoint 文件就绪")
        return 0
    else:
        print("✗ 存在缺失的必填 checkpoint 文件")
        return 1


if __name__ == "__main__":
    sys.exit(main())
