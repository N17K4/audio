import shutil
import subprocess
import tempfile
from pathlib import Path


def concat_audio_files(paths: list, output_path: Path) -> None:
    """拼接多个音频文件到 output_path。

    单文件直接复制；多文件用 ffmpeg concat 合并。
    失败抛 RuntimeError。
    """
    from utils.engine import get_ffmpeg_binary

    valid = [p for p in paths if p and Path(p).exists() and Path(p).stat().st_size > 0]
    if not valid:
        raise RuntimeError("没有有效的参考音频文件")

    if len(valid) == 1:
        shutil.copy2(valid[0], output_path)
        return

    ffmpeg = get_ffmpeg_binary()
    if not ffmpeg:
        raise RuntimeError("FFmpeg 未找到，无法拼接多个音频文件")

    list_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False, encoding="utf-8"
        ) as f:
            list_path = f.name
            for p in valid:
                escaped = p.replace("'", "'\\''")
                f.write(f"file '{escaped}'\n")

        result = subprocess.run(
            [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", list_path,
             "-c", "copy", str(output_path)],
            capture_output=True,
            timeout=120,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode(errors="replace").strip()[:2000]
            raise RuntimeError(f"FFmpeg concat 失败: {stderr}")
    finally:
        if list_path:
            try:
                Path(list_path).unlink(missing_ok=True)
            except Exception:
                pass
