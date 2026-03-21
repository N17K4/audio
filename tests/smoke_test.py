"""基础功能烟雾测试

测试项目（7 大引擎 13 项测试）：
  1.   Fish Speech TTS
  2-1. GPT-SoVITS TTS 合成
  2-2. GPT-SoVITS 创建音色
  2-3. GPT-SoVITS 高级参数
  3-1. Seed-VC 音色转换
  3-2. Seed-VC 高级参数（pitch_shift / diffusion_steps / f0_condition / cfg_rate）
  4-1. RVC 音色转换
  4-2. RVC 转换高级参数（pitch_shift / f0_method / filter_radius / index_rate / protect）
  4-3. RVC 训练（创建音色）
  4-4. RVC 训练高级参数（epochs / f0_method / sample_rate）
  5.   Faster Whisper STT
  6.   FaceFusion 换脸
  7.   FFmpeg 媒体转换

運行：
  cd test001 && python tests/smoke_test.py
"""

import json
import os
import sys
import tempfile
from pathlib import Path
from io import BytesIO

# 添加 backend 到 Python path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))


# ──────────────────────────────────────────────────────────────────────────────
# 工具函数
# ──────────────────────────────────────────────────────────────────────────────

def create_test_wav(duration_sec: int = 1) -> bytes:
    """创建一个简单的 8kHz 16 位单声道 WAV 文件"""
    import struct

    sample_rate = 8000
    num_samples = 8000 * duration_sec
    num_channels = 1
    bits_per_sample = 16

    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    data_size = num_samples * block_align

    buf = BytesIO()
    buf.write(b'RIFF')
    buf.write(struct.pack('<I', 36 + data_size))
    buf.write(b'WAVE')
    buf.write(b'fmt ')
    buf.write(struct.pack('<I', 16))
    buf.write(struct.pack('<H', 1))
    buf.write(struct.pack('<H', num_channels))
    buf.write(struct.pack('<I', sample_rate))
    buf.write(struct.pack('<I', byte_rate))
    buf.write(struct.pack('<H', block_align))
    buf.write(struct.pack('<H', bits_per_sample))
    buf.write(b'data')
    buf.write(struct.pack('<I', data_size))
    buf.write(b'\x00' * data_size)
    return buf.getvalue()


def create_test_png() -> bytes:
    """创建一个最小的 1x1 白色 PNG 文件。"""
    import struct
    import zlib

    def _chunk(chunk_type: bytes, data: bytes) -> bytes:
        raw = chunk_type + data
        return struct.pack(">I", len(data)) + raw + struct.pack(">I", zlib.crc32(raw) & 0xFFFFFFFF)

    header = b"\x89PNG\r\n\x1a\n"
    ihdr = _chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw_data = zlib.compress(b"\x00\xFF\xFF\xFF")
    idat = _chunk(b"IDAT", raw_data)
    iend = _chunk(b"IEND", b"")
    return header + ihdr + idat + iend


_BASE_URL = f"http://127.0.0.1:{os.environ.get('BACKEND_PORT', '8000')}"


def check_backend_running(base_url: str = _BASE_URL) -> bool:
    try:
        import httpx
        with httpx.Client(timeout=2) as client:
            resp = client.get(f"{base_url}/health")
            return resp.status_code == 200
    except Exception:
        return False


def _ok(tag: str, name: str, body: dict) -> bool:
    job_id = body.get("job_id", "")
    suffix = f" [job_id: {job_id}]" if job_id else ""
    print(f"✅ {tag} 通过 — {name}{suffix}")
    return True


def _fail(tag: str, name: str, status: int, text: str):
    print(f"❌ {tag} 失败 — {name} (HTTP {status})")
    print(f"   响应：{text}")
    raise AssertionError("test failed")


# ──────────────────────────────────────────────────────────────────────────────
# 1. Fish Speech TTS
# ──────────────────────────────────────────────────────────────────────────────

def test_1_fish_speech_tts():
    import httpx
    TAG = "[1]"
    print(f"\n{TAG} Fish Speech TTS")

    with httpx.Client(timeout=30) as client:
        data = {"text": "烟雾测试文本合成", "provider": "fish_speech"}
        print(f"  📤 POST /tasks/tts  参数：{data}")

        resp = client.post(f"{_BASE_URL}/tasks/tts", data=data)
        print(f"     HTTP {resp.status_code}")

        if resp.status_code == 200:
            return _ok(TAG, "Fish Speech TTS", resp.json())
        _fail(TAG, "Fish Speech TTS", resp.status_code, resp.text)


# ──────────────────────────────────────────────────────────────────────────────
# 2. GPT-SoVITS（2-1 TTS / 2-2 创建音色 / 2-3 高级参数）
# ──────────────────────────────────────────────────────────────────────────────

def test_2_1_gpt_sovits_tts():
    import httpx
    TAG = "[2-1]"
    print(f"\n{TAG} GPT-SoVITS TTS")

    wav_data = create_test_wav(duration_sec=5)
    with httpx.Client(timeout=30) as client:
        data = {"text": "烟雾测试文本合成", "provider": "gpt_sovits"}
        print(f"  📤 POST /tasks/tts  参数：{data}")

        resp = client.post(
            f"{_BASE_URL}/tasks/tts", data=data,
            files={"reference_audio": ("ref.wav", BytesIO(wav_data), "audio/wav")},
        )
        print(f"     HTTP {resp.status_code}")

        if resp.status_code == 200:
            return _ok(TAG, "GPT-SoVITS TTS", resp.json())
        _fail(TAG, "GPT-SoVITS TTS", resp.status_code, resp.text)


def test_2_2_gpt_sovits_create_voice():
    import httpx
    TAG = "[2-2]"
    print(f"\n{TAG} GPT-SoVITS 创建音色")

    with httpx.Client(timeout=30) as client:
        files = {
            "gpt_model_file": ("test_gpt.ckpt", BytesIO(b"\x00" * 1024), "application/octet-stream"),
            "sovits_model_file": ("test_sovits.pth", BytesIO(b"\x00" * 1024), "application/octet-stream"),
            "reference_audio": ("test_ref.wav", BytesIO(create_test_wav()), "audio/wav"),
        }
        data = {"voice_name": "smoke_test_gpt_sovits", "engine": "gpt_sovits", "ref_text": "这是参考音频的文本"}
        print(f"  📤 POST /voices/create  engine=gpt_sovits")

        resp = client.post(f"{_BASE_URL}/voices/create", data=data, files=files)
        print(f"     HTTP {resp.status_code}")

        if resp.status_code == 200:
            body = resp.json()
            voice_id = body.get("voice_id", "")
            print(f"     voice_id: {voice_id}")

            # 验证引擎类型
            voices_resp = client.get(f"{_BASE_URL}/voices")
            if voices_resp.status_code == 200:
                voices = voices_resp.json().get("voices", [])
                matched = [v for v in voices if v.get("voice_id") == voice_id]
                if matched:
                    assert matched[0].get("engine") == "gpt_sovits", f"引擎类型错误：{matched[0].get('engine')}"
                    print(f"     ✓ 引擎类型正确：gpt_sovits")

            # 清理
            del_resp = client.delete(f"{_BASE_URL}/voices/{voice_id}")
            if del_resp.status_code == 200:
                print(f"     🧹 清理：删除测试音色 {voice_id}")

            return _ok(TAG, "GPT-SoVITS 创建音色", body)
        _fail(TAG, "GPT-SoVITS 创建音色", resp.status_code, resp.text)


def test_2_3_gpt_sovits_advanced():
    import httpx
    TAG = "[2-3]"
    print(f"\n{TAG} GPT-SoVITS TTS 高级参数")

    wav_data = create_test_wav(duration_sec=5)
    with httpx.Client(timeout=60) as client:
        data = {
            "text": "高级参数烟雾测试", "provider": "gpt_sovits",
            "text_lang": "zh", "prompt_lang": "zh", "ref_text": "这是参考音频对应的文本",
            "top_k": "10", "top_p": "0.9", "temperature": "0.8", "speed": "1.2",
            "repetition_penalty": "1.5", "seed": "42", "text_split_method": "cut3",
            "batch_size": "2", "parallel_infer": "1", "fragment_interval": "0.5", "sample_steps": "16",
        }
        param_summary = {k: v for k, v in data.items() if k != "text"}
        print(f"  📤 POST /tasks/tts  参数：{param_summary}")

        resp = client.post(
            f"{_BASE_URL}/tasks/tts", data=data,
            files={"reference_audio": ("ref.wav", BytesIO(wav_data), "audio/wav")},
        )
        print(f"     HTTP {resp.status_code}")

        if resp.status_code == 200:
            return _ok(TAG, "GPT-SoVITS TTS（高级参数）", resp.json())
        _fail(TAG, "GPT-SoVITS TTS（高级参数）", resp.status_code, resp.text)


# ──────────────────────────────────────────────────────────────────────────────
# 3. Seed-VC（3-1 转换 / 3-2 高级参数）
# ──────────────────────────────────────────────────────────────────────────────

def _seed_vc_base_data():
    return {
        "provider": "seed_vc", "mode": "local",
        "output_dir": str(Path(tempfile.gettempdir()) / "ai-workshop-temp" / "download"),
    }


def test_3_1_seed_vc():
    import httpx
    TAG = "[3-1]"
    print(f"\n{TAG} Seed-VC 音色转换")

    wav_data = create_test_wav()
    with httpx.Client(timeout=30) as client:
        files = {
            "file": ("test.wav", BytesIO(wav_data), "audio/wav"),
            "reference_audio": ("ref.wav", BytesIO(wav_data), "audio/wav"),
        }
        data = _seed_vc_base_data()
        print(f"  📤 POST /convert  参数：{data}")

        resp = client.post(f"{_BASE_URL}/convert", data=data, files=files)
        print(f"     HTTP {resp.status_code}")

        if resp.status_code == 200:
            return _ok(TAG, "Seed-VC", resp.json())
        _fail(TAG, "Seed-VC", resp.status_code, resp.text)


def test_3_2_seed_vc_advanced():
    import httpx
    TAG = "[3-2]"
    print(f"\n{TAG} Seed-VC 高级参数")

    wav_data = create_test_wav()
    with httpx.Client(timeout=30) as client:
        files = {
            "file": ("test.wav", BytesIO(wav_data), "audio/wav"),
            "reference_audio": ("ref.wav", BytesIO(wav_data), "audio/wav"),
        }
        data = {
            **_seed_vc_base_data(),
            "pitch_shift": "2",
            "diffusion_steps": "12",
            "f0_condition": "true",
            "cfg_rate": "0.5",
            "enable_postprocess": "false",
        }
        param_summary = {k: v for k, v in data.items() if k not in ("provider", "mode", "output_dir")}
        print(f"  📤 POST /convert  高级参数：{param_summary}")

        resp = client.post(f"{_BASE_URL}/convert", data=data, files=files)
        print(f"     HTTP {resp.status_code}")

        if resp.status_code == 200:
            return _ok(TAG, "Seed-VC（高级参数）", resp.json())
        _fail(TAG, "Seed-VC（高级参数）", resp.status_code, resp.text)


# ──────────────────────────────────────────────────────────────────────────────
# 4. RVC（4-1 转换 / 4-2 转换高级参数 / 4-3 训练 / 4-4 训练高级参数）
# ──────────────────────────────────────────────────────────────────────────────

def _get_rvc_voice_id():
    """获取第一个可用的 RVC 音色 ID，没有则返回 None。"""
    import httpx
    with httpx.Client(timeout=10) as client:
        resp = client.get(f"{_BASE_URL}/voices")
        if resp.status_code != 200:
            return None
        voices_data = resp.json()
        voices = voices_data if isinstance(voices_data, list) else voices_data.get("voices", [])
        rvc_voices = [v for v in voices if v.get("engine") == "rvc"]
        if not rvc_voices:
            return None
        print(f"     音色总数：{len(voices)}，RVC 音色：{len(rvc_voices)}")
        print(f"     使用音色：{rvc_voices[0]['voice_id']}")
        return rvc_voices[0]["voice_id"]


def _rvc_convert_base_data(voice_id: str):
    return {
        "voice_id": voice_id, "provider": "rvc", "mode": "local",
        "output_dir": str(Path(tempfile.gettempdir()) / "ai-workshop-temp" / "download"),
    }


def test_4_1_rvc_convert():
    import httpx
    TAG = "[4-1]"
    print(f"\n{TAG} RVC 音色转换")
    print(f"  📤 GET /voices")

    voice_id = _get_rvc_voice_id()
    if not voice_id:
        print(f"⚠️  {TAG} 跳过 — 未找到 RVC 音色")
        return True

    wav_data = create_test_wav()
    with httpx.Client(timeout=30) as client:
        files = {"file": ("test.wav", BytesIO(wav_data), "audio/wav")}
        data = _rvc_convert_base_data(voice_id)
        print(f"  📤 POST /convert  参数：{data}")

        resp = client.post(f"{_BASE_URL}/convert", data=data, files=files)
        print(f"     HTTP {resp.status_code}")

        if resp.status_code == 200:
            return _ok(TAG, "RVC 音色转换", resp.json())
        _fail(TAG, "RVC 音色转换", resp.status_code, resp.text)


def test_4_2_rvc_convert_advanced():
    import httpx
    TAG = "[4-2]"
    print(f"\n{TAG} RVC 转换高级参数")
    print(f"  📤 GET /voices")

    voice_id = _get_rvc_voice_id()
    if not voice_id:
        print(f"⚠️  {TAG} 跳过 — 未找到 RVC 音色")
        return True

    wav_data = create_test_wav()
    with httpx.Client(timeout=30) as client:
        files = {"file": ("test.wav", BytesIO(wav_data), "audio/wav")}
        data = {
            **_rvc_convert_base_data(voice_id),
            "pitch_shift": "3",
            "f0_method": "harvest",
            "filter_radius": "5",
            "index_rate": "0.5",
            "rms_mix_rate": "0.4",
            "protect": "0.2",
        }
        param_summary = {k: v for k, v in data.items() if k not in ("voice_id", "provider", "mode", "output_dir")}
        print(f"  📤 POST /convert  高级参数：{param_summary}")

        resp = client.post(f"{_BASE_URL}/convert", data=data, files=files)
        print(f"     HTTP {resp.status_code}")

        if resp.status_code == 200:
            return _ok(TAG, "RVC 转换（高级参数）", resp.json())
        _fail(TAG, "RVC 转换（高级参数）", resp.status_code, resp.text)


def test_4_3_rvc_train():
    import httpx
    import zipfile
    TAG = "[4-3]"
    print(f"\n{TAG} RVC 训练（创建音色）")

    wav_data = create_test_wav(duration_sec=3)
    zip_buf = BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as zf:
        zf.writestr("train_sample.wav", wav_data)
    zip_buf.seek(0)

    with httpx.Client(timeout=30) as client:
        files = {"dataset": ("dataset.zip", zip_buf, "application/zip")}
        data = {
            "voice_id": "smoke_test_rvc", "voice_name": "烟雾测试RVC",
            "epochs": "1", "f0_method": "harvest", "sample_rate": "40000",
        }
        print(f"  📤 POST /train  voice_id={data['voice_id']}, epochs={data['epochs']}")

        resp = client.post(f"{_BASE_URL}/train", data=data, files=files)
        print(f"     HTTP {resp.status_code}")

        if resp.status_code == 200:
            return _ok(TAG, "RVC 训练", resp.json())
        _fail(TAG, "RVC 训练", resp.status_code, resp.text)


def test_4_4_rvc_train_advanced():
    import httpx
    import zipfile
    TAG = "[4-4]"
    print(f"\n{TAG} RVC 训练高级参数")

    wav_data = create_test_wav(duration_sec=3)
    zip_buf = BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as zf:
        zf.writestr("train_sample.wav", wav_data)
    zip_buf.seek(0)

    with httpx.Client(timeout=30) as client:
        files = {"dataset": ("dataset.zip", zip_buf, "application/zip")}
        data = {
            "voice_id": "smoke_test_rvc_adv", "voice_name": "烟雾测试RVC高级",
            "epochs": "2", "f0_method": "rmvpe", "sample_rate": "48000",
        }
        param_summary = {k: v for k, v in data.items() if k != "voice_name"}
        print(f"  📤 POST /train  高级参数：{param_summary}")

        resp = client.post(f"{_BASE_URL}/train", data=data, files=files)
        print(f"     HTTP {resp.status_code}")

        if resp.status_code == 200:
            return _ok(TAG, "RVC 训练（高级参数）", resp.json())
        _fail(TAG, "RVC 训练（高级参数）", resp.status_code, resp.text)


# ──────────────────────────────────────────────────────────────────────────────
# 5. Faster Whisper STT
# ──────────────────────────────────────────────────────────────────────────────

def test_5_faster_whisper():
    import httpx
    TAG = "[5]"
    print(f"\n{TAG} Faster Whisper STT")

    wav_data = create_test_wav()
    with httpx.Client(timeout=30) as client:
        files = {"file": ("test.wav", BytesIO(wav_data), "audio/wav")}
        data = {"provider": "faster_whisper", "model": "large-v3"}
        print(f"  📤 POST /tasks/stt  参数：{data}")

        resp = client.post(f"{_BASE_URL}/tasks/stt", data=data, files=files)
        print(f"     HTTP {resp.status_code}")

        if resp.status_code == 200:
            body = resp.json()
            text = body.get("text", body.get("result_text", ""))
            if text:
                print(f"     识别结果：{text}")
            return _ok(TAG, "Faster Whisper STT", body)
        _fail(TAG, "Faster Whisper STT", resp.status_code, resp.text)


# ──────────────────────────────────────────────────────────────────────────────
# 6. FaceFusion 换脸
# ──────────────────────────────────────────────────────────────────────────────

def test_6_facefusion():
    import httpx
    TAG = "[6]"
    print(f"\n{TAG} FaceFusion 换脸")

    png_data = create_test_png()
    with httpx.Client(timeout=30) as client:
        files = {
            "source_image": ("source.png", BytesIO(png_data), "image/png"),
            "reference_image": ("ref.png", BytesIO(png_data), "image/png"),
        }
        data = {"provider": "facefusion"}
        print(f"  📤 POST /tasks/image-i2i  参数：{data}")

        resp = client.post(f"{_BASE_URL}/tasks/image-i2i", data=data, files=files)
        print(f"     HTTP {resp.status_code}")

        if resp.status_code == 200:
            return _ok(TAG, "FaceFusion", resp.json())
        _fail(TAG, "FaceFusion", resp.status_code, resp.text)


# ──────────────────────────────────────────────────────────────────────────────
# 7. FFmpeg 媒体转换
# ──────────────────────────────────────────────────────────────────────────────

def test_7_ffmpeg():
    import httpx
    TAG = "[7]"
    print(f"\n{TAG} FFmpeg 媒体转换")

    wav_data = create_test_wav()
    with httpx.Client(timeout=30) as client:
        files = {"file": ("test.wav", BytesIO(wav_data), "audio/wav")}
        data = {"action": "convert", "output_format": "mp3"}
        print(f"  📤 POST /tasks/media-convert  参数：{data}")

        resp = client.post(f"{_BASE_URL}/tasks/media-convert", data=data, files=files)
        print(f"     HTTP {resp.status_code}")

        if resp.status_code == 200:
            return _ok(TAG, "FFmpeg", resp.json())
        _fail(TAG, "FFmpeg", resp.status_code, resp.text)


# ──────────────────────────────────────────────────────────────────────────────
# 主入口
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("🔍 烟雾测试 1：基础功能\n")
    print("─" * 60)

    backend_ok = check_backend_running()
    print(f"  {'✅' if backend_ok else '❌'} 后端服务：{'运行中' if backend_ok else '未运行'}")

    if not backend_ok:
        print("\n❌ 后端未运行。请先启动后端：npx electron .")
        sys.exit(1)

    print("\n" + "─" * 60)

    # 编号结构：主编号为引擎，子编号为子任务
    tests = {
        "[1]   Fish Speech TTS":         test_1_fish_speech_tts,
        "[2-1] GPT-SoVITS TTS":          test_2_1_gpt_sovits_tts,
        "[2-2] GPT-SoVITS 创建音色":     test_2_2_gpt_sovits_create_voice,
        "[2-3] GPT-SoVITS 高级参数":     test_2_3_gpt_sovits_advanced,
        "[3-1] Seed-VC 音色转换":         test_3_1_seed_vc,
        "[3-2] Seed-VC 高级参数":         test_3_2_seed_vc_advanced,
        "[4-1] RVC 音色转换":             test_4_1_rvc_convert,
        "[4-2] RVC 转换高级参数":         test_4_2_rvc_convert_advanced,
        "[4-3] RVC 训练":                 test_4_3_rvc_train,
        "[4-4] RVC 训练高级参数":         test_4_4_rvc_train_advanced,
        "[5]   Faster Whisper STT":       test_5_faster_whisper,
        "[6]   FaceFusion 换脸":          test_6_facefusion,
        "[7]   FFmpeg 媒体转换":          test_7_ffmpeg,
    }

    results = {}
    for name, fn in tests.items():
        try:
            results[name] = fn()
        except Exception as e:
            print(f"❌ 失败 — {name}：{e}")
            results[name] = False

    # 汇总
    passed = sum(1 for v in results.values() if v)
    failed = len(results) - passed

    print("\n" + "─" * 60)
    print("\n📊 测试结果汇总：\n")
    for name, result in results.items():
        status = "✅ 通过" if result else "❌ 失败"
        print(f"  {status} — {name}")
    print(f"\n  总计：✅ {passed} 通过  ❌ {failed} 失败\n")
    print("─" * 60)

    if failed > 0:
        sys.exit(1)
    else:
        sys.exit(0)
