"""云端 HTTP API 模型测试（需要 API Key）

分组（每组每模型 2 个用例：默认参数 + 自定义参数）：
  TTS  — OpenAI / Gemini / ElevenLabs / Cartesia / DashScope / MiniMax
  STT  — OpenAI / Gemini / Deepgram / Groq / DashScope
  LLM  — OpenAI / Gemini / GitHub Models

运行：
  cd test001 && poetry run pytest tests/test_cloud_api_models.py -v
"""
import base64
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ──────────────────────────────────────────────────────────────────────────────
# 共用 Mock 工具
# ──────────────────────────────────────────────────────────────────────────────

def _resp(status: int = 200, json_data=None, content: bytes = b"audio_bytes"):
    """构造一个 httpx.Response mock。"""
    r = MagicMock()
    r.status_code = status
    r.content = content
    r.text = str(json_data) if json_data else "error"
    r.json = MagicMock(return_value=json_data or {})
    r.headers = {"content-type": "audio/mpeg"}
    r.raise_for_status = MagicMock()
    return r


def _client(*post_side_effects, get_side_effects=None):
    """
    构造 httpx.AsyncClient mock（支持 async with）。

    post_side_effects: POST 调用依次返回的 response 列表（单个时直接 return_value）。
    get_side_effects:  GET 调用依次返回的 response 列表（单个时直接 return_value）。
    """
    c = AsyncMock()
    c.__aenter__ = AsyncMock(return_value=c)
    c.__aexit__ = AsyncMock(return_value=False)

    if len(post_side_effects) == 1:
        c.post = AsyncMock(return_value=post_side_effects[0])
    elif len(post_side_effects) > 1:
        c.post = AsyncMock(side_effect=list(post_side_effects))

    if get_side_effects:
        if len(get_side_effects) == 1:
            c.get = AsyncMock(return_value=get_side_effects[0])
        else:
            c.get = AsyncMock(side_effect=list(get_side_effects))
    return c


# ══════════════════════════════════════════════════════════════════════════════
# TTS
# ══════════════════════════════════════════════════════════════════════════════

# ──────────────────────────────────────────────────────────────────────────────
# OpenAI TTS
# ──────────────────────────────────────────────────────────────────────────────

class TestOpenAITTS:
    """OpenAI /v1/audio/speech"""

    @pytest.mark.asyncio
    async def test_default_params(self, tmp_path):
        """默认：gpt-4o-mini-tts + alloy 音色。"""
        import services.tts.openai_tts as svc

        mock_client = _client(_resp(content=b"mp3_audio_bytes"))

        with (
            patch("httpx.AsyncClient", return_value=mock_client),
            patch.object(svc, "DOWNLOAD_DIR", tmp_path),
        ):
            result = await svc.run_openai_tts("Hello world", api_key="sk-test-key")

        assert result["status"] == "success"
        assert result["provider"] == "openai"
        assert result["task"] == "tts"
        assert "result_url" in result
        # 验证发送了正确的 payload
        call_kwargs = mock_client.post.call_args
        payload = call_kwargs.kwargs["json"]
        assert payload["model"] == "gpt-4o-mini-tts"
        assert payload["voice"] == "alloy"
        assert payload["input"] == "Hello world"

    @pytest.mark.asyncio
    async def test_custom_model_and_voice(self, tmp_path):
        """自定义：gpt-4o-tts + nova 音色。"""
        import services.tts.openai_tts as svc

        mock_client = _client(_resp(content=b"custom_mp3"))

        with (
            patch("httpx.AsyncClient", return_value=mock_client),
            patch.object(svc, "DOWNLOAD_DIR", tmp_path),
        ):
            result = await svc.run_openai_tts(
                "自定义音色测试",
                api_key="sk-custom-key",
                model="gpt-4o-tts",
                voice="nova",
            )

        assert result["status"] == "success"
        payload = mock_client.post.call_args.kwargs["json"]
        assert payload["model"] == "gpt-4o-tts"
        assert payload["voice"] == "nova"


# ──────────────────────────────────────────────────────────────────────────────
# Gemini TTS
# ──────────────────────────────────────────────────────────────────────────────

class TestGeminiTTS:
    """Gemini generateContent TTS（base64 编码音频）"""

    def _gemini_tts_resp(self, audio_b64: str, mime: str = "audio/wav"):
        return _resp(
            json_data={
                "candidates": [{
                    "content": {
                        "parts": [{"inlineData": {"data": audio_b64, "mimeType": mime}}]
                    }
                }]
            }
        )

    @pytest.mark.asyncio
    async def test_default_kore_voice(self, tmp_path):
        """默认：gemini-2.5-flash-preview-tts + Kore 音色，返回 WAV。"""
        import services.tts.gemini_tts as svc

        b64 = base64.b64encode(b"wav_audio_data").decode()
        mock_client = _client(self._gemini_tts_resp(b64, "audio/wav"))

        with (
            patch("httpx.AsyncClient", return_value=mock_client),
            patch.object(svc, "DOWNLOAD_DIR", tmp_path),
        ):
            result = await svc.run_gemini_tts("你好世界", api_key="gemini-api-key")

        assert result["status"] == "success"
        assert result["provider"] == "gemini"
        assert result["mime_type"] == "audio/wav"
        # 验证写入了正确的字节
        assert any(f.read_bytes() == b"wav_audio_data" for f in tmp_path.iterdir())

    @pytest.mark.asyncio
    async def test_custom_voice_and_model(self, tmp_path):
        """自定义：gemini-2.0-flash + Puck 音色，返回 MP3。"""
        import services.tts.gemini_tts as svc

        b64 = base64.b64encode(b"mp3_audio_data").decode()
        mock_client = _client(self._gemini_tts_resp(b64, "audio/mp3"))

        with (
            patch("httpx.AsyncClient", return_value=mock_client),
            patch.object(svc, "DOWNLOAD_DIR", tmp_path),
        ):
            result = await svc.run_gemini_tts(
                "Custom voice synthesis",
                api_key="gemini-key-2",
                model="gemini-2.0-flash-preview-tts",
                voice="Puck",
            )

        payload = mock_client.post.call_args.kwargs["json"]
        voice_name = (
            payload["generationConfig"]["speechConfig"]["voiceConfig"]
            ["prebuiltVoiceConfig"]["voiceName"]
        )
        assert voice_name == "Puck"
        assert result["mime_type"] == "audio/mp3"


# ──────────────────────────────────────────────────────────────────────────────
# ElevenLabs TTS
# ──────────────────────────────────────────────────────────────────────────────

class TestElevenLabsTTS:
    """ElevenLabs /v1/text-to-speech/{voice_id}"""

    @pytest.mark.asyncio
    async def test_default_voice(self, tmp_path):
        """默认：eleven_multilingual_v2 + 默认男声 voice_id。"""
        import services.tts.elevenlabs_tts as svc

        mock_client = _client(_resp(content=b"eleven_mp3"))

        with (
            patch("httpx.AsyncClient", return_value=mock_client),
            patch.object(svc, "DOWNLOAD_DIR", tmp_path),
        ):
            result = await svc.run_elevenlabs_tts(
                text="Hello ElevenLabs", api_key="xi-key-123"
            )

        assert result["status"] == "success"
        assert result["provider"] == "elevenlabs"
        # 验证 xi-api-key 请求头
        headers = mock_client.post.call_args.kwargs["headers"]
        assert headers["xi-api-key"] == "xi-key-123"
        payload = mock_client.post.call_args.kwargs["json"]
        assert payload["model_id"] == "eleven_multilingual_v2"

    @pytest.mark.asyncio
    async def test_custom_voice_and_model(self, tmp_path):
        """自定义：指定 voice_id + eleven_turbo_v2 高速模型。"""
        import services.tts.elevenlabs_tts as svc

        mock_client = _client(_resp(content=b"turbo_audio"))

        with (
            patch("httpx.AsyncClient", return_value=mock_client),
            patch.object(svc, "DOWNLOAD_DIR", tmp_path),
        ):
            result = await svc.run_elevenlabs_tts(
                text="速度优先的合成文本",
                api_key="xi-key-456",
                voice="custom-voice-id-abc",
                model="eleven_turbo_v2",
            )

        assert result["status"] == "success"
        payload = mock_client.post.call_args.kwargs["json"]
        assert payload["model_id"] == "eleven_turbo_v2"
        # URL 应包含 voice_id
        url = mock_client.post.call_args.args[0]
        assert "custom-voice-id-abc" in url


# ──────────────────────────────────────────────────────────────────────────────
# Cartesia TTS
# ──────────────────────────────────────────────────────────────────────────────

class TestCartesiaTTS:
    """Cartesia sonic TTS"""

    @pytest.mark.asyncio
    async def test_default_params(self, tmp_path):
        """默认：sonic-2 + 默认 Barbershop Man voice_id。"""
        import services.tts.cartesia_tts as svc

        mock_client = _client(_resp(content=b"cartesia_mp3"))

        with (
            patch("httpx.AsyncClient", return_value=mock_client),
            patch.object(svc, "DOWNLOAD_DIR", tmp_path),
        ):
            result = await svc.run_cartesia_tts(
                text="Cartesia synthesis test", api_key="cartesia-api-key"
            )

        assert result["status"] == "success"
        assert result["provider"] == "cartesia"
        headers = mock_client.post.call_args.kwargs["headers"]
        assert headers["X-API-Key"] == "cartesia-api-key"

    @pytest.mark.asyncio
    async def test_custom_voice_and_model(self, tmp_path):
        """自定义：指定 voice_id + sonic-turbo 快速模型。"""
        import services.tts.cartesia_tts as svc

        mock_client = _client(_resp(content=b"turbo_audio"))

        with (
            patch("httpx.AsyncClient", return_value=mock_client),
            patch.object(svc, "DOWNLOAD_DIR", tmp_path),
        ):
            result = await svc.run_cartesia_tts(
                text="快速合成文本",
                api_key="cartesia-key-2",
                voice="my-custom-voice-id",
                model="sonic-turbo",
            )

        payload = mock_client.post.call_args.kwargs["json"]
        assert payload["model_id"] == "sonic-turbo"
        assert payload["voice"]["id"] == "my-custom-voice-id"


# ──────────────────────────────────────────────────────────────────────────────
# DashScope TTS（异步轮询）
# ──────────────────────────────────────────────────────────────────────────────

class TestDashScopeTTS:
    """阿里云 DashScope CosyVoice TTS（提交 → 轮询 → 下载）"""

    @pytest.mark.asyncio
    async def test_default_voice(self, tmp_path):
        """默认：cosyvoice-v2 + 龙小淳 v2 音色，轮询一次成功。"""
        import services.tts.dashscope_tts as svc

        submit_resp = _resp(json_data={"output": {"task_id": "task-abc-123"}})
        poll_resp = _resp(json_data={
            "output": {
                "task_status": "SUCCEEDED",
                "audio_address": "https://oss.example.com/audio.mp3",
            }
        })
        audio_resp = _resp(content=b"dashscope_mp3_bytes")
        audio_resp.raise_for_status = MagicMock()

        mock_client = _client(submit_resp, get_side_effects=[poll_resp, audio_resp])

        with (
            patch("httpx.AsyncClient", return_value=mock_client),
            patch.object(svc, "DOWNLOAD_DIR", tmp_path),
            patch("asyncio.sleep"),   # 跳过轮询等待
        ):
            result = await svc.run_dashscope_tts(
                text="你好，这是阿里云语音合成测试。",
                api_key="dashscope-key",
            )

        assert result["status"] == "success"
        assert result["provider"] == "dashscope"
        assert "result_url" in result

    @pytest.mark.asyncio
    async def test_custom_voice_and_model(self, tmp_path):
        """自定义：cosyvoice-v1 + longxiaochun 音色，验证提交 payload。"""
        import services.tts.dashscope_tts as svc

        submit_resp = _resp(json_data={"output": {"task_id": "task-xyz-456"}})
        poll_resp = _resp(json_data={
            "output": {
                "task_status": "SUCCEEDED",
                "audio_address": "https://oss.example.com/custom.mp3",
            }
        })
        audio_resp = _resp(content=b"custom_audio_bytes")

        mock_client = _client(submit_resp, get_side_effects=[poll_resp, audio_resp])

        with (
            patch("httpx.AsyncClient", return_value=mock_client),
            patch.object(svc, "DOWNLOAD_DIR", tmp_path),
            patch("asyncio.sleep"),
        ):
            result = await svc.run_dashscope_tts(
                text="自定义音色合成",
                api_key="dashscope-key-2",
                voice="longxiaochun",
                model="cosyvoice-v1",
            )

        assert result["status"] == "success"
        payload = mock_client.post.call_args.kwargs["json"]
        assert payload["model"] == "cosyvoice-v1"
        assert payload["input"]["voice"] == "longxiaochun"


# ──────────────────────────────────────────────────────────────────────────────
# MiniMax TTS（Hex 编码音频）
# ──────────────────────────────────────────────────────────────────────────────

class TestMiniMaxTTS:
    """MiniMax t2a_v2 TTS（凭证格式：group_id:api_key）"""

    @pytest.mark.asyncio
    async def test_default_male_voice(self, tmp_path):
        """默认：speech-02-hd + male-qn-qingse 音色。"""
        import services.tts.minimax_tts as svc

        audio_bytes = b"minimax_mp3_bytes"
        mock_client = _client(_resp(json_data={
            "base_resp": {"status_code": 0, "status_msg": "success"},
            "data": {"audio": audio_bytes.hex()},
        }))

        with (
            patch("httpx.AsyncClient", return_value=mock_client),
            patch.object(svc, "DOWNLOAD_DIR", tmp_path),
        ):
            result = await svc.run_minimax_tts(
                text="你好，MiniMax TTS 测试。",
                api_key="group123:secret-key-abc",
            )

        assert result["status"] == "success"
        assert result["provider"] == "minimax_tts"
        # 验证写入的音频字节
        files = list(tmp_path.iterdir())
        assert len(files) == 1
        assert files[0].read_bytes() == audio_bytes

    @pytest.mark.asyncio
    async def test_custom_voice_and_model(self, tmp_path):
        """自定义：speech-01-hd + female-shaonv 音色。"""
        import services.tts.minimax_tts as svc

        audio_bytes = b"custom_minimax_audio"
        mock_client = _client(_resp(json_data={
            "base_resp": {"status_code": 0, "status_msg": "success"},
            "data": {"audio": audio_bytes.hex()},
        }))

        with (
            patch("httpx.AsyncClient", return_value=mock_client),
            patch.object(svc, "DOWNLOAD_DIR", tmp_path),
        ):
            result = await svc.run_minimax_tts(
                text="女声合成测试",
                api_key="group456:custom-secret",
                voice="female-shaonv",
                model="speech-01-hd",
            )

        payload = mock_client.post.call_args.kwargs["json"]
        assert payload["model"] == "speech-01-hd"
        assert payload["voice_setting"]["voice_id"] == "female-shaonv"


# ══════════════════════════════════════════════════════════════════════════════
# STT
# ══════════════════════════════════════════════════════════════════════════════

# ──────────────────────────────────────────────────────────────────────────────
# OpenAI STT
# ──────────────────────────────────────────────────────────────────────────────

class TestOpenAISTT:
    """OpenAI /v1/audio/transcriptions"""

    @pytest.mark.asyncio
    async def test_default_model(self):
        """默认：gpt-4o-mini-transcribe 模型。"""
        import services.stt.openai_stt as svc

        mock_client = _client(_resp(json_data={"text": "This is a transcription."}))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.run_openai_stt(
                b"audio_bytes", "speech.wav", api_key="sk-openai-key"
            )

        assert result["status"] == "success"
        assert result["provider"] == "openai"
        assert result["text"] == "This is a transcription."
        # 验证 model 参数
        data = mock_client.post.call_args.kwargs["data"]
        assert data["model"] == "gpt-4o-mini-transcribe"

    @pytest.mark.asyncio
    async def test_custom_whisper_large_model(self):
        """自定义：whisper-1 模型 + MP3 文件。"""
        import services.stt.openai_stt as svc

        mock_client = _client(_resp(json_data={"text": "Custom model output."}))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.run_openai_stt(
                b"mp3_bytes", "audio.mp3",
                api_key="sk-key-2",
                model="whisper-1",
            )

        assert result["text"] == "Custom model output."
        assert mock_client.post.call_args.kwargs["data"]["model"] == "whisper-1"


# ──────────────────────────────────────────────────────────────────────────────
# Gemini STT
# ──────────────────────────────────────────────────────────────────────────────

class TestGeminiSTT:
    """Gemini multimodal STT（base64 音频 + 文本 prompt）"""

    @pytest.mark.asyncio
    async def test_default_model(self):
        """默认：gemini-2.5-flash 模型。"""
        import services.stt.gemini_stt as svc

        mock_client = _client(_resp(json_data={
            "candidates": [{
                "content": {"parts": [{"text": "识别结果文本"}]}
            }]
        }))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.run_gemini_stt(
                b"audio_bytes", "audio.wav", "audio/wav", api_key="gemini-key"
            )

        assert result["status"] == "success"
        assert result["provider"] == "gemini"
        assert result["text"] == "识别结果文本"

    @pytest.mark.asyncio
    async def test_custom_pro_model(self):
        """自定义：gemini-2.0-flash 模型 + MP3 输入。"""
        import services.stt.gemini_stt as svc

        mock_client = _client(_resp(json_data={
            "candidates": [{
                "content": {"parts": [{"text": "Pro model transcription"}]}
            }]
        }))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.run_gemini_stt(
                b"mp3_data", "speech.mp3", "audio/mpeg",
                api_key="gemini-key-pro",
                model="gemini-2.0-flash",
            )

        assert result["text"] == "Pro model transcription"
        url = mock_client.post.call_args.args[0]
        assert "gemini-2.0-flash" in url


# ──────────────────────────────────────────────────────────────────────────────
# Deepgram STT
# ──────────────────────────────────────────────────────────────────────────────

class TestDeepgramSTT:
    """Deepgram /v1/listen"""

    @pytest.mark.asyncio
    async def test_default_nova3_model(self):
        """默认：nova-3 模型，WAV 输入。"""
        import services.stt.deepgram_stt as svc

        mock_client = _client(_resp(json_data={
            "results": {
                "channels": [{
                    "alternatives": [{"transcript": "Deepgram transcription result."}]
                }]
            }
        }))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.run_deepgram_stt(
                b"wav_bytes", "speech.wav", api_key="dg-key-123"
            )

        assert result["status"] == "success"
        assert result["provider"] == "deepgram"
        assert result["text"] == "Deepgram transcription result."
        headers = mock_client.post.call_args.kwargs["headers"]
        assert headers["Authorization"] == "Token dg-key-123"

    @pytest.mark.asyncio
    async def test_custom_model_mp3(self):
        """自定义：nova-2 模型 + MP3 输入，Content-Type 映射正确。"""
        import services.stt.deepgram_stt as svc

        mock_client = _client(_resp(json_data={
            "results": {
                "channels": [{
                    "alternatives": [{"transcript": "Custom model output."}]
                }]
            }
        }))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.run_deepgram_stt(
                b"mp3_bytes", "audio.mp3",
                api_key="dg-key-456",
                model="nova-2",
            )

        assert result["text"] == "Custom model output."
        headers = mock_client.post.call_args.kwargs["headers"]
        assert headers["Content-Type"] == "audio/mpeg"


# ──────────────────────────────────────────────────────────────────────────────
# Groq STT
# ──────────────────────────────────────────────────────────────────────────────

class TestGroqSTT:
    """Groq Whisper STT（OpenAI 兼容 API）"""

    @pytest.mark.asyncio
    async def test_default_turbo_model(self):
        """默认：whisper-large-v3-turbo 模型。"""
        import services.stt.groq_stt as svc

        mock_client = _client(_resp(json_data={"text": "Groq fast transcription."}))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.run_groq_stt(
                b"audio_data", "recording.wav", api_key="gsk-groq-key"
            )

        assert result["status"] == "success"
        assert result["provider"] == "groq"
        assert result["text"] == "Groq fast transcription."

    @pytest.mark.asyncio
    async def test_custom_distil_model(self):
        """自定义：distil-whisper-large-v3-en + WAV 输入。"""
        import services.stt.groq_stt as svc

        mock_client = _client(_resp(json_data={"text": "Distil model output."}))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.run_groq_stt(
                b"wav_data", "audio.wav",
                api_key="gsk-key-2",
                model="distil-whisper-large-v3-en",
            )

        assert result["text"] == "Distil model output."


# ──────────────────────────────────────────────────────────────────────────────
# DashScope STT（异步轮询）
# ──────────────────────────────────────────────────────────────────────────────

class TestDashScopeSTT:
    """阿里云 DashScope Paraformer STT（提交 → 轮询 → 结果）"""

    @pytest.mark.asyncio
    async def test_default_paraformer_model(self):
        """默认：paraformer-realtime-v2 模型。"""
        import services.stt.dashscope_stt as svc

        submit_resp = _resp(json_data={"output": {"task_id": "stt-task-001"}})
        poll_resp = _resp(json_data={
            "output": {
                "task_status": "SUCCEEDED",
                "results": [{"transcription": "阿里云语音识别结果文本。"}],
            }
        })
        mock_client = _client(submit_resp, get_side_effects=[poll_resp])

        with (
            patch("httpx.AsyncClient", return_value=mock_client),
            patch("asyncio.sleep"),
        ):
            result = await svc.run_dashscope_stt(
                b"wav_bytes", "speech.wav", api_key="dashscope-key"
            )

        assert result["status"] == "success"
        assert result["provider"] == "dashscope"
        assert result["text"] == "阿里云语音识别结果文本。"

    @pytest.mark.asyncio
    async def test_custom_model(self):
        """自定义：paraformer-v2 模型。"""
        import services.stt.dashscope_stt as svc

        submit_resp = _resp(json_data={"output": {"task_id": "stt-task-002"}})
        poll_resp = _resp(json_data={
            "output": {
                "task_status": "SUCCEEDED",
                "results": [{"transcription": "自定义模型识别输出。"}],
            }
        })
        mock_client = _client(submit_resp, get_side_effects=[poll_resp])

        with (
            patch("httpx.AsyncClient", return_value=mock_client),
            patch("asyncio.sleep"),
        ):
            result = await svc.run_dashscope_stt(
                b"mp3_bytes", "audio.mp3",
                api_key="dashscope-key-2",
                model="paraformer-v2",
            )

        assert result["text"] == "自定义模型识别输出。"
        payload = mock_client.post.call_args.kwargs["json"]
        assert payload["model"] == "paraformer-v2"


# ══════════════════════════════════════════════════════════════════════════════
# LLM
# ══════════════════════════════════════════════════════════════════════════════

# ──────────────────────────────────────────────────────────────────────────────
# OpenAI LLM
# ──────────────────────────────────────────────────────────────────────────────

class TestOpenAILLM:
    """OpenAI /v1/chat/completions"""

    @pytest.mark.asyncio
    async def test_default_model_single_prompt(self):
        """默认：gpt-4o-mini，单轮 prompt。"""
        import services.llm.openai_llm as svc

        mock_client = _client(_resp(json_data={
            "choices": [{"message": {"content": "Hello from OpenAI!"}}]
        }))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.run_openai_llm(
                prompt="Say hello", api_key="sk-test-key"
            )

        assert result["status"] == "success"
        assert result["provider"] == "openai"
        assert result["text"] == "Hello from OpenAI!"
        payload = mock_client.post.call_args.kwargs["json"]
        assert payload["model"] == "gpt-4o-mini"
        assert payload["messages"] == [{"role": "user", "content": "Say hello"}]

    @pytest.mark.asyncio
    async def test_custom_model_multi_turn(self):
        """自定义：gpt-4o 模型 + 多轮对话 messages。"""
        import services.llm.openai_llm as svc

        mock_client = _client(_resp(json_data={
            "choices": [{"message": {"content": "Multi-turn response."}}]
        }))

        history = [
            {"role": "user", "content": "What's 2+2?"},
            {"role": "assistant", "content": "It's 4."},
            {"role": "user", "content": "And 4+4?"},
        ]

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.run_openai_llm(
                prompt="",
                api_key="sk-gpt4o-key",
                model="gpt-4o",
                messages=history,
            )

        assert result["text"] == "Multi-turn response."
        payload = mock_client.post.call_args.kwargs["json"]
        assert payload["model"] == "gpt-4o"
        assert payload["messages"] == history


# ──────────────────────────────────────────────────────────────────────────────
# Gemini LLM
# ──────────────────────────────────────────────────────────────────────────────

class TestGeminiLLM:
    """Gemini generateContent LLM"""

    @pytest.mark.asyncio
    async def test_default_flash_model(self):
        """默认：gemini-2.5-flash，单轮 prompt。"""
        import services.llm.gemini_llm as svc

        mock_client = _client(_resp(json_data={
            "candidates": [{
                "content": {"parts": [{"text": "Gemini response here."}]}
            }]
        }))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.run_gemini_llm(
                prompt="Explain AI briefly", api_key="gemini-api-key"
            )

        assert result["status"] == "success"
        assert result["provider"] == "gemini"
        assert result["text"] == "Gemini response here."

    @pytest.mark.asyncio
    async def test_custom_pro_model_multi_turn(self):
        """自定义：gemini-2.0-flash + 多轮对话（OpenAI messages 格式转换）。"""
        import services.llm.gemini_llm as svc

        mock_client = _client(_resp(json_data={
            "candidates": [{
                "content": {"parts": [{"text": "Pro model answer."}]}
            }]
        }))

        messages = [
            {"role": "user", "content": "Tell me a joke"},
            {"role": "assistant", "content": "Why did the chicken cross the road?"},
            {"role": "user", "content": "I don't know, why?"},
        ]

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.run_gemini_llm(
                prompt="",
                api_key="gemini-pro-key",
                model="gemini-2.0-flash",
                messages=messages,
            )

        assert result["text"] == "Pro model answer."
        payload = mock_client.post.call_args.kwargs["json"]
        # assistant → model 角色转换验证
        assert payload["contents"][1]["role"] == "model"
        url = mock_client.post.call_args.args[0]
        assert "gemini-2.0-flash" in url


# ──────────────────────────────────────────────────────────────────────────────
# GitHub Models LLM
# ──────────────────────────────────────────────────────────────────────────────

class TestGitHubLLM:
    """GitHub Models（Azure AI Inference 兼容端点）"""

    @pytest.mark.asyncio
    async def test_default_gpt4o_mini(self):
        """默认：gpt-4o-mini via GitHub Models endpoint。"""
        import services.llm.github_llm as svc

        mock_client = _client(_resp(json_data={
            "choices": [{"message": {"content": "GitHub Models response."}}]
        }))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.run_github_llm(
                prompt="Hello GitHub Models", api_key="ghp-token-123"
            )

        assert result["status"] == "success"
        assert result["provider"] == "github"
        assert result["text"] == "GitHub Models response."
        headers = mock_client.post.call_args.kwargs["headers"]
        assert "ghp-token-123" in headers["Authorization"]

    @pytest.mark.asyncio
    async def test_custom_meta_llama_model(self):
        """自定义：Meta-Llama-3.1-70B-Instruct 模型 + 多轮 messages。"""
        import services.llm.github_llm as svc

        mock_client = _client(_resp(json_data={
            "choices": [{"message": {"content": "Llama says hello."}}]
        }))

        messages = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Who are you?"},
        ]

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.run_github_llm(
                prompt="",
                api_key="ghp-token-456",
                model="Meta-Llama-3.1-70B-Instruct",
                messages=messages,
            )

        assert result["text"] == "Llama says hello."
        payload = mock_client.post.call_args.kwargs["json"]
        assert payload["model"] == "Meta-Llama-3.1-70B-Instruct"
        assert payload["messages"] == messages
