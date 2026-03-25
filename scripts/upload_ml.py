#!/usr/bin/env python3
"""将 runtime/ml (macOS) 和 runtime/ml-win (Windows) 压缩后上传到 HuggingFace。

需要: pip install huggingface_hub
需要: HF_TOKEN 环境变量 或 --token 参数

用法:
    python scripts/upload_ml.py                  # 上传 mac + win 两个包
    python scripts/upload_ml.py --mac-only       # 只上传 macOS 包
    python scripts/upload_ml.py --win-only       # 只上传 Windows 包
    HF_TOKEN=xxx python scripts/upload_ml.py     # 通过环境变量传 token
"""

from __future__ import annotations

import argparse
import os
import sys
import tarfile
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

HF_REPO = "N17K4/ai-workshop-assets"


def _compress(src_dir: Path, out_path: Path) -> None:
    paths = sorted(p for p in src_dir.rglob("*"))
    total = len(paths)
    print(f"  压缩 {src_dir.name}/ ({total} 个文件) → {out_path.name} ...", flush=True)
    with tarfile.open(out_path, "w:gz", compresslevel=6) as tf:
        for i, path in enumerate(paths, 1):
            tf.add(path, arcname=path.relative_to(src_dir))
            if i % 5000 == 0:
                pct = i * 100 // total
                print(f"    {pct}%  ({i}/{total})", flush=True)
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"  ✓ 压缩完成: {size_mb:.0f} MB", flush=True)


def _upload(local_path: Path, path_in_repo: str, repo_id: str, token: str) -> None:
    try:
        from huggingface_hub import HfApi
    except ImportError:
        print("错误: 请先安装 huggingface_hub: pip install huggingface_hub")
        sys.exit(1)

    api = HfApi(token=token)
    size_mb = local_path.stat().st_size / 1024 / 1024
    print(f"  上传 {local_path.name} ({size_mb:.0f} MB) → {repo_id}/{path_in_repo} ...", flush=True)
    api.upload_file(
        path_or_fileobj=str(local_path),
        path_in_repo=path_in_repo,
        repo_id=repo_id,
        repo_type="model",
        commit_message=f"Upload {path_in_repo}",
    )
    print(f"  ✓ 上传完成: {path_in_repo}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="上传预构建 ML 包到 HuggingFace")
    parser.add_argument("--token", default=os.environ.get("HF_TOKEN"), help="HuggingFace token")
    parser.add_argument("--repo", default=HF_REPO, help=f"HF repo ID（默认: {HF_REPO}）")
    parser.add_argument("--mac-only", action="store_true", help="只上传 macOS 包")
    parser.add_argument("--win-only", action="store_true", help="只上传 Windows 包")
    args = parser.parse_args()

    if not args.token:
        print("错误: 需要 HuggingFace token（环境变量 HF_TOKEN 或 --token 参数）")
        sys.exit(1)

    targets: list[tuple[str, str]] = []
    if not args.win_only:
        targets.append(("ml", "ml-mac.tar.gz"))
    if not args.mac_only:
        targets.append(("ml-win", "ml-win.tar.gz"))

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        for dir_name, archive_name in targets:
            src = PROJECT_ROOT / "runtime" / dir_name
            if not src.exists():
                print(f"跳过: {src} 不存在")
                continue
            out = tmp / archive_name
            print(f"\n=== {dir_name} → {archive_name} ===")
            _compress(src, out)
            _upload(out, archive_name, args.repo, args.token)

    print("\n全部上传完成。")


if __name__ == "__main__":
    main()
