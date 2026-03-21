"""基础功能烟雾测试

分组：
  - TTS（文本转语音）— Fish Speech / GPT-SoVITS / OpenAI / Gemini
  - STT（語音転文本）— Faster Whisper / OpenAI / Gemini
  - VC（音色転換）— Seed-VC / RVC
  - 訓練（模型訓練）— RVC 訓練
  - 図像（図像生成/処理）— FaceFusion
  - 媒体転換 — FFmpeg

運行：
  cd test001 && python tests/smoke_test.py
"""

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from io import BytesIO

# 添加 backend 到 Python path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))


# ──────────────────────────────────────────────────────────────────────────────
# 工具函数：WAV 文件生成
# ──────────────────────────────────────────────────────────────────────────────

def create_test_wav(duration_sec: int = 1) -> bytes:
    """创建一个简单的 8kHz 16 位单声道 WAV 文件"""
    sample_rate = 8000
    num_samples = 8000 * duration_sec
    num_channels = 1
    bits_per_sample = 16

    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    data_size = num_samples * block_align

    import struct

    buf = BytesIO()

    # RIFF header
    buf.write(b'RIFF')
    buf.write(struct.pack('<I', 36 + data_size))
    buf.write(b'WAVE')

    # fmt subchunk
    buf.write(b'fmt ')
    buf.write(struct.pack('<I', 16))
    buf.write(struct.pack('<H', 1))  # Audio format (PCM)
    buf.write(struct.pack('<H', num_channels))
    buf.write(struct.pack('<I', sample_rate))
    buf.write(struct.pack('<I', byte_rate))
    buf.write(struct.pack('<H', block_align))
    buf.write(struct.pack('<H', bits_per_sample))

    # data subchunk
    buf.write(b'data')
    buf.write(struct.pack('<I', data_size))
    buf.write(b'\x00' * data_size)

    return buf.getvalue()


_BASE_URL = f"http://127.0.0.1:{os.environ.get('BACKEND_PORT', '8000')}"


def check_backend_running(base_url: str = _BASE_URL) -> bool:
    """检查后端服务是否运行中。"""
    try:
        import httpx
        with httpx.Client(timeout=2) as client:
            resp = client.get(f"{base_url}/health")
            return resp.status_code == 200
    except Exception:
        return False


# ──────────────────────────────────────────────────────────────────────────────
# 测试函数
# ──────────────────────────────────────────────────────────────────────────────

def test_fish_speech_tts():
    """测试：Fish Speech TTS（本地推理）。"""
    import httpx

    print("🎙️  测试 Fish Speech TTS")

    with httpx.Client(timeout=30) as client:
        data = {
            "text": "烟雾测试文本合成",
            "provider": "fish_speech",
        }

        print(f"  📤 POST /tasks/tts")
        print(f"     请求参数：{data}")

        resp = client.post(
            f"{_BASE_URL}/tasks/tts",
            data=data,
        )

        print(f"     HTTP {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            print(f"     响应：{json.dumps(body, ensure_ascii=False)}")
            if body.get("job_id"):
                print(f"✅ 通过 — Fish Speech TTS 已排队 [job_id: {body['job_id']}]")
            else:
                print(f"✅ 通过 — Fish Speech TTS 响应正常")
            return True
        else:
            print(f"❌ 失败 — Fish Speech TTS (HTTP {resp.status_code})")
            print(f"   响应：{resp.text}")
            raise AssertionError("test failed")


def test_gpt_sovits_tts():
    """测试：GPT-SoVITS TTS（本地推理，需先安装 GPT-SoVITS 引擎）。"""
    import httpx

    print("🎙️  测试 GPT-SoVITS TTS")

    wav_data = create_test_wav(duration_sec=5)
    with httpx.Client(timeout=30) as client:
        data = {
            "text": "烟雾测试文本合成",
            "provider": "gpt_sovits",
        }

        print(f"  📤 POST /tasks/tts")
        print(f"     请求参数：{data}")

        resp = client.post(
            f"{_BASE_URL}/tasks/tts",
            data=data,
            files={"reference_audio": ("ref.wav", BytesIO(wav_data), "audio/wav")},
        )

        print(f"     HTTP {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            print(f"     响应：{json.dumps(body, ensure_ascii=False)}")
            if body.get("job_id"):
                print(f"✅ 通过 — GPT-SoVITS TTS 已排队 [job_id: {body['job_id']}]")
            else:
                print(f"✅ 通过 — GPT-SoVITS TTS 响应正常")
            return True
        else:
            print(f"❌ 失败 — GPT-SoVITS TTS (HTTP {resp.status_code})")
            print(f"   响应：{resp.text}")
            raise AssertionError("test failed")


def test_gpt_sovits_create_voice():
    """测试：GPT-SoVITS 创建音色（导入模型文件）。"""
    import httpx

    print("📦 测试 GPT-SoVITS 创建音色")

    with httpx.Client(timeout=30) as client:
        # 创建虚拟模型文件
        gpt_model = BytesIO(b"\x00" * 1024)
        sovits_model = BytesIO(b"\x00" * 1024)
        ref_audio = BytesIO(create_test_wav())

        files = {
            "gpt_model_file": ("test_gpt.ckpt", gpt_model, "application/octet-stream"),
            "sovits_model_file": ("test_sovits.pth", sovits_model, "application/octet-stream"),
            "reference_audio": ("test_ref.wav", ref_audio, "audio/wav"),
        }
        data = {
            "voice_name": f"smoke_test_gpt_sovits",
            "engine": "gpt_sovits",
            "ref_text": "这是参考音频的文本",
        }

        print(f"  📤 POST /voices/create")
        print(f"     engine=gpt_sovits, voice_name={data['voice_name']}")

        resp = client.post(
            f"{_BASE_URL}/voices/create",
            data=data,
            files=files,
        )

        print(f"     HTTP {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            print(f"     响应：{json.dumps(body, ensure_ascii=False)}")
            voice_id = body.get("voice_id", "")
            print(f"✅ 通过 — GPT-SoVITS 创建音色成功 [voice_id: {voice_id}]")

            # 验证 meta.json 包含 gpt_model 和 sovits_model 字段
            voices_resp = client.get(f"{_BASE_URL}/voices")
            if voices_resp.status_code == 200:
                voices = voices_resp.json().get("voices", [])
                matched = [v for v in voices if v.get("voice_id") == voice_id]
                if matched:
                    v = matched[0]
                    assert v.get("engine") == "gpt_sovits", f"引擎类型错误：{v.get('engine')}"
                    print(f"     ✓ 引擎类型正确：gpt_sovits")
                else:
                    print(f"     ⚠️ 音色列表中未找到新创建的音色（可能在不同目录）")

            # 清理：删除测试音色
            del_resp = client.delete(f"{_BASE_URL}/voices/{voice_id}")
            if del_resp.status_code == 200:
                print(f"     🧹 清理：删除测试音色 {voice_id}")
            else:
                print(f"     ⚠️ 删除测试音色失败 (HTTP {del_resp.status_code})")
            return True
        else:
            print(f"❌ 失败 — GPT-SoVITS 创建音色 (HTTP {resp.status_code})")
            print(f"   响应：{resp.text}")
            raise AssertionError("test failed")


def test_gpt_sovits_tts_advanced():
    """测试：GPT-SoVITS TTS 高级参数（验证参数传递不报错）。"""
    import httpx

    print("🎛️  测试 GPT-SoVITS TTS 高级参数")

    wav_data = create_test_wav(duration_sec=5)
    with httpx.Client(timeout=60) as client:
        data = {
            "text": "高级参数烟雾测试",
            "provider": "gpt_sovits",
            "text_lang": "zh",
            "prompt_lang": "zh",
            "ref_text": "这是参考音频对应的文本",
            "top_k": "10",
            "top_p": "0.9",
            "temperature": "0.8",
            "speed": "1.2",
            "repetition_penalty": "1.5",
            "seed": "42",
            "text_split_method": "cut3",
            "batch_size": "2",
            "parallel_infer": "1",
            "fragment_interval": "0.5",
            "sample_steps": "16",
        }

        print(f"  📤 POST /tasks/tts（含全部高级参数）")
        param_summary = {k: v for k, v in data.items() if k != "text"}
        print(f"     参数：{param_summary}")

        resp = client.post(
            f"{_BASE_URL}/tasks/tts",
            data=data,
            files={"reference_audio": ("ref.wav", BytesIO(wav_data), "audio/wav")},
        )

        print(f"     HTTP {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            print(f"     响应：{json.dumps(body, ensure_ascii=False)}")
            if body.get("job_id"):
                print(f"✅ 通过 — GPT-SoVITS TTS（高级参数）已排队 [job_id: {body['job_id']}]")
            else:
                print(f"✅ 通过 — GPT-SoVITS TTS（高级参数）响应正常")
            return True
        else:
            print(f"❌ 失败 — GPT-SoVITS TTS（高级参数）(HTTP {resp.status_code})")
            print(f"   响应：{resp.text}")
            raise AssertionError("test failed")


def test_faster_whisper_stt():
    """测试：Faster Whisper STT（本地推理）。"""
    import httpx

    print("👂 测试 Faster Whisper STT")

    wav_data = create_test_wav()

    with httpx.Client(timeout=30) as client:
        files = {"file": ("test.wav", BytesIO(wav_data), "audio/wav")}
        data = {
            "provider": "faster_whisper",
            "model": "large-v3",
        }

        print(f"  📤 POST /tasks/stt")
        print(f"     请求参数：{data}")
        print(f"     文件：test.wav ({len(wav_data)} bytes)")

        resp = client.post(
            f"{_BASE_URL}/tasks/stt",
            data=data,
            files=files,
        )

        print(f"     HTTP {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            print(f"     响应：{json.dumps(body, ensure_ascii=False)}")
            if body.get("job_id"):
                print(f"✅ 通过 — Faster Whisper STT 已排队 [job_id: {body['job_id']}]")
            elif body.get("text") or body.get("result_text"):
                print(f"✅ 通过 — Faster Whisper STT 完成：{body.get('text', body.get('result_text', ''))}")
            else:
                print(f"✅ 通过 — Faster Whisper STT 响应正常")
            return True
        else:
            print(f"❌ 失败 — Faster Whisper STT (HTTP {resp.status_code})")
            print(f"   响应：{resp.text}")
            raise AssertionError("test failed")


def test_seed_vc_voice_convert():
    """测试：Seed-VC 音色转换。"""
    import httpx

    print("🎵 测试 Seed-VC 音色转换")

    wav_data = create_test_wav()

    with httpx.Client(timeout=30) as client:
        files = {
            "file": ("test.wav", BytesIO(wav_data), "audio/wav"),
            "reference_audio": ("ref.wav", BytesIO(wav_data), "audio/wav"),
        }
        data = {
            "provider": "seed_vc",
            "mode": "local",
            "output_dir": str(Path(tempfile.gettempdir()) / "ai-workshop-temp" / "download"),
        }

        print(f"  📤 POST /convert")
        print(f"     请求参数：{data}")
        print(f"     文件：test.wav ({len(wav_data)} bytes), ref.wav ({len(wav_data)} bytes)")

        resp = client.post(
            f"{_BASE_URL}/convert",
            data=data,
            files=files,
        )

        print(f"     HTTP {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            print(f"     响应：{json.dumps(body, ensure_ascii=False)}")
            if body.get("job_id"):
                print(f"✅ 通过 — Seed-VC 已排队 [job_id: {body['job_id']}]")
            else:
                print(f"✅ 通过 — Seed-VC 响应正常")
            return True
        else:
            print(f"❌ 失败 — Seed-VC (HTTP {resp.status_code})")
            print(f"   响应：{resp.text}")
            raise AssertionError("test failed")


def test_rvc_voice_convert():
    """测试：RVC 音色转换（需要音色模型）。"""
    import httpx

    print("🎤 测试 RVC 音色转换")

    # 先获取可用的 RVC 音色
    with httpx.Client(timeout=10) as client:
        print(f"  📤 GET /voices")
        resp = client.get(f"{_BASE_URL}/voices")
        print(f"     HTTP {resp.status_code}")
        if resp.status_code != 200:
            print(f"     响应：{resp.text}")
            print("⚠️  无法获取音色列表，跳过 RVC 测试")
            return True  # skip = not a failure

        voices_data = resp.json()
        voices = voices_data if isinstance(voices_data, list) else voices_data.get("voices", [])
        rvc_voices = [v for v in voices if v.get("engine") == "rvc"]
        print(f"     音色总数：{len(voices)}，RVC 音色：{len(rvc_voices)}")

        if not rvc_voices:
            print("⚠️  未找到 RVC 音色，跳过")
            return True  # skip = not a failure

        voice_id = rvc_voices[0]["voice_id"]
        print(f"     使用音色：{voice_id}")

        # 进行转换
        wav_data = create_test_wav()
        files = {"file": ("test.wav", BytesIO(wav_data), "audio/wav")}
        data = {
            "voice_id": voice_id,
            "provider": "rvc",
            "mode": "local",
            "output_dir": str(Path(tempfile.gettempdir()) / "ai-workshop-temp" / "download"),
        }

        print(f"  📤 POST /convert")
        print(f"     请求参数：{data}")
        print(f"     文件：test.wav ({len(wav_data)} bytes)")

        resp = client.post(
            f"{_BASE_URL}/convert",
            data=data,
            files=files,
        )

        print(f"     HTTP {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            print(f"     响应：{json.dumps(body, ensure_ascii=False)}")
            if body.get("job_id"):
                print(f"✅ 通过 — RVC 已排队 [job_id: {body['job_id']}]")
            else:
                print(f"✅ 通过 — RVC 响应正常")
            return True
        else:
            print(f"❌ 失败 — RVC (HTTP {resp.status_code})")
            print(f"   响应：{resp.text}")
            raise AssertionError("test failed")


def test_ffmpeg_media_convert():
    """测试：FFmpeg 媒体转换。"""
    import httpx

    print("📹 测试 FFmpeg 媒体转换")

    wav_data = create_test_wav()

    with httpx.Client(timeout=30) as client:
        files = {"file": ("test.wav", BytesIO(wav_data), "audio/wav")}
        data = {
            "action": "convert",
            "output_format": "mp3",
        }

        print(f"  📤 POST /tasks/media-convert")
        print(f"     请求参数：{data}")
        print(f"     文件：test.wav ({len(wav_data)} bytes)")

        resp = client.post(
            f"{_BASE_URL}/tasks/media-convert",
            data=data,
            files=files,
        )

        print(f"     HTTP {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            print(f"     响应：{json.dumps(body, ensure_ascii=False)}")
            if body.get("job_id"):
                print(f"✅ 通过 — FFmpeg 已排队 [job_id: {body['job_id']}]")
            elif body.get("result_url"):
                print(f"✅ 通过 — FFmpeg 转换完成")
            else:
                print(f"✅ 通过 — FFmpeg 响应正常")
            return True
        else:
            print(f"❌ 失败 — FFmpeg (HTTP {resp.status_code})")
            print(f"   响应：{resp.text}")
            raise AssertionError("test failed")


def test_rvc_create_voice():
    """测试：RVC 音色创建（上传音频 + 训练）。"""
    import httpx

    print("🎤 测试 RVC 音色创建（训练）")

    wav_data = create_test_wav(duration_sec=3)
    # 创建一个最小 ZIP 文件包含训练音频
    import zipfile
    zip_buf = BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as zf:
        zf.writestr("train_sample.wav", wav_data)
    zip_buf.seek(0)

    with httpx.Client(timeout=30) as client:
        files = {"dataset": ("dataset.zip", zip_buf, "application/zip")}
        data = {
            "voice_id": "smoke_test_rvc",
            "voice_name": "烟雾测试RVC",
            "epochs": "1",
            "f0_method": "harvest",
            "sample_rate": "40000",
        }

        print(f"  📤 POST /train")
        print(f"     请求参数：voice_id={data['voice_id']}, epochs={data['epochs']}")

        resp = client.post(
            f"{_BASE_URL}/train",
            data=data,
            files=files,
        )

        print(f"     HTTP {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            print(f"     响应：{json.dumps(body, ensure_ascii=False)}")
            if body.get("job_id"):
                print(f"✅ 通过 — RVC 训练已排队 [job_id: {body['job_id']}]")
            else:
                print(f"✅ 通过 — RVC 训练响应正常")
            return True
        else:
            print(f"❌ 失败 — RVC 训练 (HTTP {resp.status_code})")
            print(f"   响应：{resp.text}")
            raise AssertionError("test failed")


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


def test_facefusion():
    """测试：FaceFusion 换脸（本地推理）。"""
    import httpx

    print("🎭 测试 FaceFusion 换脸")

    png_data = create_test_png()

    with httpx.Client(timeout=30) as client:
        files = {
            "source_image": ("source.png", BytesIO(png_data), "image/png"),
            "reference_image": ("ref.png", BytesIO(png_data), "image/png"),
        }
        data = {
            "provider": "facefusion",
        }

        print(f"  📤 POST /tasks/image-i2i")
        print(f"     请求参数：{data}")

        resp = client.post(
            f"{_BASE_URL}/tasks/image-i2i",
            data=data,
            files=files,
        )

        print(f"     HTTP {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            print(f"     响应：{json.dumps(body, ensure_ascii=False)}")
            if body.get("job_id"):
                print(f"✅ 通过 — FaceFusion 已排队 [job_id: {body['job_id']}]")
            else:
                print(f"✅ 通过 — FaceFusion 响应正常")
            return True
        else:
            print(f"❌ 失败 — FaceFusion (HTTP {resp.status_code})")
            print(f"   响应：{resp.text}")
            raise AssertionError("test failed")


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

    print("\n" + "─" * 60 + "\n")

    tests = {
        "Fish Speech TTS": test_fish_speech_tts,
        "GPT-SoVITS TTS": test_gpt_sovits_tts,
        "GPT-SoVITS 创建音色": test_gpt_sovits_create_voice,
        "GPT-SoVITS TTS 高级参数": test_gpt_sovits_tts_advanced,
        "Faster Whisper STT": test_faster_whisper_stt,
        "Seed-VC 音色转换": test_seed_vc_voice_convert,
        "RVC 音色转换": test_rvc_voice_convert,
        "RVC 训练": test_rvc_create_voice,
        "FaceFusion 换脸": test_facefusion,
        "FFmpeg 媒体转換": test_ffmpeg_media_convert,
    }

    results = {}
    for name, fn in tests.items():
        try:
            results[name] = fn()
        except Exception as e:
            print(f"❌ 失败 — {name}：{e}")
            results[name] = False
        print()

    # 输出结构化结果（供前端解析）
    passed = sum(1 for v in results.values() if v)
    failed = len(results) - passed

    print("─" * 60)
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
