"""Ollama 本地自托管 LLM 测试

分组：
  - Ollama LLM — 通过 /v1/chat/completions 接口调用本地 Ollama 服务

运行：
  cd test001 && poetry run pytest tests/test_ollama.py -v
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _resp(status: int = 200, json_data: dict | None = None):
    """构造一个假的 httpx Response。"""
    m = MagicMock()
    m.status_code = status
    m.json = MagicMock(return_value=json_data or {})
    m.text = str(json_data)
    return m


def _async_client(*post_side_effects):
    """构造一个假的 httpx.AsyncClient，依次返回各 post 响应。"""
    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(side_effect=list(post_side_effects))
    return mock_client


# ──────────────────────────────────────────────────────────────────────────────
# Ollama LLM
# ──────────────────────────────────────────────────────────────────────────────

class TestOllamaLLM:
    """本地 Ollama 大语言模型推理"""

    @pytest.mark.asyncio
    async def test_default_model_single_prompt(self):
        """默认参数：qwen2.5-coder:14b 模型，单轮提问。"""
        import services.llm.ollama_llm as svc

        reply_json = {
            "choices": [{"message": {"role": "assistant", "content": "你好！有什么我可以帮助你的吗？"}}]
        }

        with patch("httpx.AsyncClient", return_value=_async_client(_resp(200, reply_json))):
            result = await svc.run_ollama_llm(prompt="你好")

        assert result["status"] == "success"
        assert result["task"] == "llm"
        assert result["provider"] == "ollama"
        assert result["text"] == "你好！有什么我可以帮助你的吗？"
        assert result["raw"] == reply_json

    @pytest.mark.asyncio
    async def test_custom_model_multiturn_messages(self):
        """自定义：llama3:8b 模型，自定义 base_url，多轮对话消息。"""
        import services.llm.ollama_llm as svc

        reply_json = {
            "choices": [{"message": {"role": "assistant", "content": "当然，以下是一个冒泡排序的 Python 实现：\n\n```python\ndef bubble_sort(arr):\n    ...\n```"}}]
        }

        messages = [
            {"role": "system", "content": "你是一个专业的 Python 编程助手。"},
            {"role": "user", "content": "请写一个冒泡排序。"},
        ]

        with patch("httpx.AsyncClient", return_value=_async_client(_resp(200, reply_json))):
            result = await svc.run_ollama_llm(
                prompt="请写一个冒泡排序。",
                model="llama3:8b",
                base_url="http://192.168.1.100:11434",
                messages=messages,
            )

        assert result["status"] == "success"
        assert result["provider"] == "ollama"
        assert "bubble_sort" in result["text"]
        assert result["raw"] == reply_json
