"""本地推理模型测试（通过 wrapper 脚本调用子进程）

分组：
  - Fish Speech TTS  — 持久化 worker 模式
  - Whisper STT      — openai-whisper
  - Faster-Whisper STT — CTransformer 加速
  - RVC 音色转换     — copy / command 两种模式
  - Seed-VC 音色转换 — 扩散步数 / F0 condition

运行：
  cd test001 && poetry run pytest tests/test_local_models.py -v
"""
import re
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ──────────────────────────────────────────────────────────────────────────────
# 共用工具
# ──────────────────────────────────────────────────────────────────────────────

# 通用命令模板占位符（STT / Seed-VC 等）
_FAKE_STT_CMD = '"{py}" "{script}" --input {input} --output {output} --model {model}'
_FAKE_TTS_CMD = '"{py}" "{script}" --text {text} --output {output} --voice_ref {voice_ref}'
_FAKE_VC_CMD  = '"{py}" "{script}" --input {input} --output {output} --voice_ref {voice_ref}'


def _subprocess_write_audio(expected: bytes = b"fake_wav_bytes"):
    """fake subprocess.run：把期望的音频数据写入命令中 --output 指定的路径。"""
    def _run(cmd, **kwargs):
        m = re.search(r'--output\s+(\S+)', cmd)
        if m:
            out = Path(m.group(1).strip("'\""))
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(expected)
        return MagicMock(returncode=0, stdout="", stderr="")
    return _run


def _subprocess_write_text(expected_text: str = "识别结果文本"):
    """fake subprocess.run：把识别文本写入命令中 --output 指定的 .txt 路径。"""
    def _run(cmd, **kwargs):
        m = re.search(r'--output\s+(\S+)', cmd)
        if m:
            Path(m.group(1).strip("'\"")).write_text(expected_text, encoding="utf-8")
        return MagicMock(returncode=0, stdout="", stderr="")
    return _run


# ──────────────────────────────────────────────────────────────────────────────
# Fish Speech TTS
# ──────────────────────────────────────────────────────────────────────────────

class TestFishSpeechTTS:
    """本地 Fish Speech 文本转语音（子进程 / 持久化 worker）"""

    @pytest.mark.asyncio
    async def test_default_params(self, tmp_path):
        """默认参数：纯文本输入，无参考音频，走本地子进程。"""
        import services.tts.fish_speech_tts as svc

        with (
            patch.object(svc, "DOWNLOAD_DIR", tmp_path),
            patch("services.tts.fish_speech_tts.get_fish_speech_command_template",
                  return_value=_FAKE_TTS_CMD),
            patch("services.tts.fish_speech_tts.build_engine_env", return_value={}),
            patch("services.tts.fish_speech_tts.log_ai_call"),
            patch("subprocess.run", side_effect=_subprocess_write_audio()),
        ):
            result = await svc.run_fish_speech_tts("你好，这是一段测试语音。")

        assert result["status"] == "success"
        assert result["provider"] == "fish_speech"
        assert result["task"] == "tts"
        assert "result_url" in result

    @pytest.mark.asyncio
    async def test_custom_voice_refs_multi(self, tmp_path):
        """自定义：多个参考音频路径，音色克隆场景。"""
        import services.tts.fish_speech_tts as svc

        with (
            patch.object(svc, "DOWNLOAD_DIR", tmp_path),
            patch("services.tts.fish_speech_tts.get_fish_speech_command_template",
                  return_value=_FAKE_TTS_CMD),
            patch("services.tts.fish_speech_tts.build_engine_env", return_value={}),
            patch("services.tts.fish_speech_tts.log_ai_call"),
            patch("subprocess.run", side_effect=_subprocess_write_audio()),
        ):
            result = await svc.run_fish_speech_tts(
                "自定义音色克隆合成",
                voice="/voices/speaker_a.wav",
                voice_refs=["/voices/ref1.wav", "/voices/ref2.wav"],
            )

        assert result["status"] == "success"
        assert result["provider"] == "fish_speech"
        assert "fish_speech" in result["result_url"]


# ──────────────────────────────────────────────────────────────────────────────
# Whisper STT
# ──────────────────────────────────────────────────────────────────────────────

class TestWhisperSTT:
    """本地 Whisper 语音识别（openai-whisper）"""

    @pytest.mark.asyncio
    async def test_default_base_model(self):
        """默认 base 模型，WAV 输入。"""
        import services.stt.whisper_stt as svc

        with (
            patch("services.stt.whisper_stt.get_whisper_command_template",
                  return_value=_FAKE_STT_CMD),
            patch("services.stt.whisper_stt.build_engine_env", return_value={}),
            patch("services.stt.whisper_stt.log_ai_call"),
            patch("subprocess.run", side_effect=_subprocess_write_text("Hello, this is a test.")),
        ):
            result = await svc.run_whisper_stt(b"fake_wav_bytes", "speech.wav")

        assert result["status"] == "success"
        assert result["provider"] == "whisper"
        assert result["text"] == "Hello, this is a test."
        assert result["model"] == "base"
        assert result["filename"] == "speech.wav"

    @pytest.mark.asyncio
    async def test_large_v3_model_mp3(self):
        """自定义：large-v3 模型，MP3 格式音频，中文识别。"""
        import services.stt.whisper_stt as svc

        with (
            patch("services.stt.whisper_stt.get_whisper_command_template",
                  return_value=_FAKE_STT_CMD),
            patch("services.stt.whisper_stt.build_engine_env", return_value={}),
            patch("services.stt.whisper_stt.log_ai_call"),
            patch("subprocess.run",
                  side_effect=_subprocess_write_text("这是大模型识别的中文结果。")),
        ):
            result = await svc.run_whisper_stt(b"mp3_bytes", "audio.mp3", model="large-v3")

        assert result["text"] == "这是大模型识别的中文结果。"
        assert result["model"] == "large-v3"
        assert result["filename"] == "audio.mp3"


# ──────────────────────────────────────────────────────────────────────────────
# Faster-Whisper STT
# ──────────────────────────────────────────────────────────────────────────────

class TestFasterWhisperSTT:
    """本地 Faster-Whisper 语音识别（CTransformer 加速版）"""

    @pytest.mark.asyncio
    async def test_default_base_model(self):
        """默认 base 模型，WAV 输入。"""
        import services.stt.faster_whisper_stt as svc

        with (
            patch("services.stt.faster_whisper_stt.get_faster_whisper_command_template",
                  return_value=_FAKE_STT_CMD),
            patch("services.stt.faster_whisper_stt.build_engine_env", return_value={}),
            patch("services.stt.faster_whisper_stt.log_ai_call"),
            patch("subprocess.run", side_effect=_subprocess_write_text("Faster transcription result.")),
        ):
            result = await svc.run_faster_whisper_stt(b"wav_bytes", "recording.wav")

        assert result["status"] == "success"
        assert result["provider"] == "faster_whisper"
        assert result["text"] == "Faster transcription result."
        assert result["model"] == "base"

    @pytest.mark.asyncio
    async def test_medium_model_flac_input(self):
        """自定义：medium 模型，FLAC 格式，中文语音场景。"""
        import services.stt.faster_whisper_stt as svc

        with (
            patch("services.stt.faster_whisper_stt.get_faster_whisper_command_template",
                  return_value=_FAKE_STT_CMD),
            patch("services.stt.faster_whisper_stt.build_engine_env", return_value={}),
            patch("services.stt.faster_whisper_stt.log_ai_call"),
            patch("subprocess.run",
                  side_effect=_subprocess_write_text("中文 FLAC 音频识别文本")),
        ):
            result = await svc.run_faster_whisper_stt(
                b"flac_bytes", "interview.flac", model="medium"
            )

        assert result["text"] == "中文 FLAC 音频识别文本"
        assert result["model"] == "medium"
        assert result["filename"] == "interview.flac"


# ──────────────────────────────────────────────────────────────────────────────
# RVC 音色转换
# ──────────────────────────────────────────────────────────────────────────────

class TestRVCInference:
    """本地 RVC 音色转换"""

    def test_copy_mode(self, tmp_path):
        """copy 模式：直接复制输入文件（调试直通，无推理）。"""
        from services.vc.local_vc import run_local_inference_or_raise

        input_path = tmp_path / "input.wav"
        input_path.write_bytes(b"original_audio_data")
        output_path = tmp_path / "output.wav"

        voice = {"inference_mode": "copy", "path": str(tmp_path)}
        run_local_inference_or_raise(voice, input_path, output_path)

        assert output_path.exists()
        assert output_path.read_bytes() == b"original_audio_data"

    def test_command_mode_with_f0_env(self, tmp_path):
        """command 模式：RVC 命令行推理，附加 F0 移调 + RMVPE 环境变量。"""
        from services.vc.local_vc import run_local_inference_or_raise

        input_path = tmp_path / "source.wav"
        input_path.write_bytes(b"source_audio")
        output_path = tmp_path / "output.wav"

        voice = {
            "inference_mode": "command",
            "inference_command": (
                'python infer.py --input {input} --output {output}'
                ' --model {model} --index {index}'
            ),
            "path": str(tmp_path),
            "model_file": "model.pth",
            "index_file": None,
        }

        captured_cmd = {}

        def fake_run(cmd, **kwargs):
            output_path.write_bytes(b"rvc_converted_audio")
            captured_cmd["cmd"] = cmd
            captured_cmd["env"] = kwargs.get("env", {})
            return MagicMock(returncode=0, stdout="", stderr="")

        with (
            patch("subprocess.run", side_effect=fake_run),
            patch("services.vc.local_vc.build_engine_env", return_value={}),
            patch("services.vc.local_vc.log_ai_call"),
            patch("services.vc.local_vc.log_ai_error"),
        ):
            run_local_inference_or_raise(
                voice, input_path, output_path,
                extra_env={"RVC_F0_UP_KEY": "2", "RVC_F0_METHOD": "rmvpe"},
            )

        assert output_path.read_bytes() == b"rvc_converted_audio"
        # extra_env 应被合并到子进程环境
        assert captured_cmd["env"].get("RVC_F0_UP_KEY") == "2"
        assert captured_cmd["env"].get("RVC_F0_METHOD") == "rmvpe"


# ──────────────────────────────────────────────────────────────────────────────
# Seed-VC 音色转换
# ──────────────────────────────────────────────────────────────────────────────

class TestSeedVCInference:
    """本地 Seed-VC 扩散模型音色转换"""

    def test_default_params(self, tmp_path):
        """默认参数：10 步扩散，无 F0 condition，有参考音频。"""
        from services.vc.local_vc import run_seed_vc_cmd

        input_path = tmp_path / "source.wav"
        input_path.write_bytes(b"source_audio")
        output_path = tmp_path / "output.wav"

        captured = {}

        def fake_run(cmd, **kwargs):
            output_path.write_bytes(b"seed_vc_output")
            captured["cmd"] = cmd
            return MagicMock(returncode=0, stdout="", stderr="")

        with (
            patch("services.vc.local_vc.get_seed_vc_command_template",
                  return_value=_FAKE_VC_CMD),
            patch("services.vc.local_vc.build_engine_env", return_value={}),
            patch("services.vc.local_vc.log_ai_call"),
            patch("services.vc.local_vc.log_ai_error"),
            patch("subprocess.run", side_effect=fake_run),
        ):
            run_seed_vc_cmd(input_path, output_path, voice_ref="/voices/target.wav")

        assert output_path.exists()
        assert "--diffusion-steps 10" in captured["cmd"]
        assert "--cfg-rate 0.7" in captured["cmd"]
        # 默认无 F0 condition 和 no-postprocess 标志
        assert "--f0-condition" not in captured["cmd"]

    def test_custom_diffusion_f0_no_postprocess(self, tmp_path):
        """自定义：30 步扩散 + F0 condition + 半音移调 + 关闭后处理。"""
        from services.vc.local_vc import run_seed_vc_cmd

        input_path = tmp_path / "source.wav"
        input_path.write_bytes(b"source_audio")
        output_path = tmp_path / "output.wav"

        captured = {}

        def fake_run(cmd, **kwargs):
            output_path.write_bytes(b"seed_vc_f0_output")
            captured["cmd"] = cmd
            return MagicMock(returncode=0, stdout="", stderr="")

        with (
            patch("services.vc.local_vc.get_seed_vc_command_template",
                  return_value=_FAKE_VC_CMD),
            patch("services.vc.local_vc.build_engine_env", return_value={}),
            patch("services.vc.local_vc.log_ai_call"),
            patch("services.vc.local_vc.log_ai_error"),
            patch("subprocess.run", side_effect=fake_run),
        ):
            run_seed_vc_cmd(
                input_path,
                output_path,
                voice_ref="/voices/target.wav",
                diffusion_steps=30,
                pitch_shift=3,
                f0_condition=True,
                cfg_rate=0.5,
                enable_postprocess=False,
            )

        cmd = captured["cmd"]
        assert "--diffusion-steps 30" in cmd
        assert "--pitch-shift 3" in cmd
        assert "--f0-condition" in cmd
        assert "--cfg-rate 0.5" in cmd
        assert "--no-postprocess" in cmd
