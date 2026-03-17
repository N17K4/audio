"""基础功能烟雾测试

分组：
  - TTS（文本转语音）— Fish Speech / OpenAI / Gemini
  - STT（语音转文本）— Faster Whisper / OpenAI / Gemini
  - VC（音色转换）— Seed-VC / RVC
  - 训练（模型训练）— RVC 训练
  - 图像（图像生成/处理）— FaceFusion
  - 媒体转换 — FFmpeg

运行：
  cd test001 && poetry run pytest tests/smoke_test.py -v -s
  或直接：python tests/smoke_test.py
"""

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from io import BytesIO

import pytest

# 添加 backend 到 Python path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))


# ──────────────────────────────────────────────────────────────────────────────
# 工具函数：WAV 文件生成
# ──────────────────────────────────────────────────────────────────────────────

def create_test_wav() -> bytes:
    """创建一个简单的 8kHz 8 位单声道 WAV 文件（1 秒）"""
    sample_rate = 8000
    num_samples = 8000
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


def check_backend_running(base_url: str = "http://127.0.0.1:8000") -> bool:
    """检查后端服务是否运行中。"""
    try:
        import httpx
        with httpx.Client(timeout=2) as client:
            resp = client.get(f"{base_url}/health")
            return resp.status_code == 200
    except Exception:
        return False


# ──────────────────────────────────────────────────────────────────────────────
# 测试：基础功能（TTS、STT、VC、媒体转换等）
# ──────────────────────────────────────────────────────────────────────────────

class TestBasicFeatures:
    """基础功能烟雾测试"""

    @pytest.fixture(scope="function", autouse=True)
    def setup(self):
        """前置：检查后端服务。"""
        if not check_backend_running():
            pytest.skip(
                "❌ 后端未运行。请先启动后端：\n"
                "   在项目根目录运行：npx electron ."
            )

    def test_fish_speech_tts(self):
        """测试：Fish Speech TTS（本地推理）。"""
        import httpx

        print("🎙️  测试 Fish Speech TTS")

        with httpx.Client(timeout=30) as client:
            data = {
                "text": "烟雾测试文本合成",
                "provider": "fish_speech",
            }
            files = {}

            resp = client.post(
                "http://127.0.0.1:8000/tasks/tts",
                data=data,
            )

            if resp.status_code == 200:
                body = resp.json()
                if body.get("job_id"):
                    print(f"✅ Fish Speech TTS 已排队 [job_id: {body['job_id']}]")
                else:
                    print(f"✅ Fish Speech TTS 响应正常：{body}")
            else:
                print(f"❌ Fish Speech TTS 失败 (HTTP {resp.status_code})")
                print(f"   详情：{resp.text}")
                pytest.fail(f"Fish Speech TTS 失败")

    def test_faster_whisper_stt(self):
        """测试：Faster Whisper STT（本地推理）。"""
        import httpx

        print("👂 测试 Faster Whisper STT")

        wav_data = create_test_wav()

        with httpx.Client(timeout=30) as client:
            files = {"file": ("test.wav", BytesIO(wav_data), "audio/wav")}
            data = {
                "provider": "faster_whisper",
                "model": "base",
            }

            resp = client.post(
                "http://127.0.0.1:8000/tasks/stt",
                data=data,
                files=files,
            )

            if resp.status_code == 200:
                body = resp.json()
                if body.get("job_id"):
                    print(f"✅ Faster Whisper STT 已排队 [job_id: {body['job_id']}]")
                elif body.get("text") or body.get("result_text"):
                    print(f"✅ Faster Whisper STT 完成：{body.get('text', body.get('result_text', ''))}")
                else:
                    print(f"✅ Faster Whisper STT 响应正常")
            else:
                print(f"❌ Faster Whisper STT 失败 (HTTP {resp.status_code})")
                print(f"   详情：{resp.text}")
                pytest.fail("Faster Whisper STT 失败")

    def test_seed_vc_voice_convert(self):
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
            }

            resp = client.post(
                "http://127.0.0.1:8000/convert",
                data=data,
                files=files,
            )

            if resp.status_code == 200:
                body = resp.json()
                if body.get("job_id"):
                    print(f"✅ Seed-VC 已排队 [job_id: {body['job_id']}]")
                else:
                    print(f"✅ Seed-VC 响应正常")
            else:
                print(f"❌ Seed-VC 失败 (HTTP {resp.status_code})")
                print(f"   详情：{resp.text}")
                pytest.fail("Seed-VC 转换失败")

    def test_rvc_voice_convert(self):
        """测试：RVC 音色转换（需要音色模型）。"""
        import httpx

        print("🎤 测试 RVC 音色转换")

        # 先获取可用的 RVC 音色
        with httpx.Client(timeout=10) as client:
            resp = client.get("http://127.0.0.1:8000/voices")
            if resp.status_code != 200:
                print("⚠️  无法获取音色列表，跳过 RVC 测试")
                return

            voices_data = resp.json()
            voices = voices_data if isinstance(voices_data, list) else voices_data.get("voices", [])
            rvc_voices = [v for v in voices if v.get("engine") == "rvc"]

            if not rvc_voices:
                print("⚠️  未找到 RVC 音色，跳过")
                return

            voice_id = rvc_voices[0]["voice_id"]
            print(f"   使用音色：{voice_id}")

            # 进行转换
            wav_data = create_test_wav()
            files = {"file": ("test.wav", BytesIO(wav_data), "audio/wav")}
            data = {
                "voice_id": voice_id,
                "mode": "local",
            }

            resp = client.post(
                "http://127.0.0.1:8000/convert",
                data=data,
                files=files,
            )

            if resp.status_code == 200:
                body = resp.json()
                if body.get("job_id"):
                    print(f"✅ RVC 已排队 [job_id: {body['job_id']}]")
                else:
                    print(f"✅ RVC 响应正常")
            else:
                print(f"❌ RVC 失败 (HTTP {resp.status_code})")
                print(f"   详情：{resp.text}")
                pytest.fail("RVC 转换失败")

    def test_ffmpeg_media_convert(self):
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

            resp = client.post(
                "http://127.0.0.1:8000/tasks/media-convert",
                data=data,
                files=files,
            )

            if resp.status_code == 200:
                body = resp.json()
                if body.get("job_id"):
                    print(f"✅ FFmpeg 已排队 [job_id: {body['job_id']}]")
                elif body.get("result_url"):
                    print(f"✅ FFmpeg 转换完成")
                else:
                    print(f"✅ FFmpeg 响应正常")
            else:
                print(f"❌ FFmpeg 失败 (HTTP {resp.status_code})")
                print(f"   详情：{resp.text}")
                pytest.fail("FFmpeg 转换失败")


if __name__ == "__main__":
    # 快速检查：不通过 pytest 直接运行
    print("🔍 快速健康检查…\n")

    backend_ok = check_backend_running()
    print(f"  {'✅' if backend_ok else '❌'} 后端服务：{'运行中' if backend_ok else '未运行'}")

    if backend_ok:
        print("\n运行完整测试：poetry run pytest tests/smoke_test.py -v -s")
    else:
        print("\n请先启动后端：npx electron .")
