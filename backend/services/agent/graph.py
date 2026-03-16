import json
import logging
from typing import Generator

logger = logging.getLogger(__name__)

# ─── 各服务商的 OpenAI 兼容接口地址 ──────────────────────────────────────────
# 这些服务商全部兼容 OpenAI Chat Completions API 格式，只需换 base_url 和 api_key
OPENAI_COMPAT_URLS: dict[str, str] = {
    "openai":    "https://api.openai.com/v1",
    "deepseek":  "https://api.deepseek.com/v1",
    "groq":      "https://api.groq.com/openai/v1",
    "mistral":   "https://api.mistral.ai/v1",
    "xai":       "https://api.x.ai/v1",
    # 中国云端
    "qwen":      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "glm":       "https://open.bigmodel.cn/api/paas/v4",
    "moonshot":  "https://api.moonshot.cn/v1",
    "doubao":    "https://ark.cn-beijing.volces.com/api/v3",
    "hunyuan":   "https://api.hunyuan.cloud.tencent.com/v1",
    "minimax":   "https://api.minimaxi.com/v1",
}


def run_react_agent(
    task: str,
    tool_names: list[str],
    provider: str,
    model: str,
    api_key: str = "",
    ollama_url: str = "http://127.0.0.1:11434",
) -> Generator[str, None, None]:
    """ReAct Agent，流式输出每个步骤（最多 10 轮）"""
    from services.agent.tools import TOOLS

    selected_tools = {k: v for k, v in TOOLS.items() if k in tool_names}
    tools_desc = "\n".join(
        f"- {name}: {info['desc']}，参数: {info['args']}"
        for name, info in selected_tools.items()
    )

    system_prompt = f"""你是一个智能助手，使用 ReAct 方法解决任务。
可用工具：
{tools_desc}

每步格式：
思考: <分析当前情况>
行动: <工具名>(<参数JSON>)
观察: <工具结果>
...
最终答案: <综合所有信息的答案>

注意：行动参数必须是有效的 JSON 格式。"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"任务：{task}"},
    ]

    def call_llm(msgs: list[dict]) -> str:
        """调用指定服务商的语言模型，返回回复文本"""
        import httpx

        if provider == "ollama":
            # Ollama 使用自己的 /api/chat 接口，不是 OpenAI 格式
            resp = httpx.post(
                f"{ollama_url.rstrip('/')}/api/chat",
                json={"model": model, "messages": msgs, "stream": False},
                timeout=120,
            )
            resp.raise_for_status()
            return resp.json()["message"]["content"]

        elif provider == "gemini":
            # Gemini 使用 Google 自己的接口格式
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            # 把 OpenAI 格式的 messages 转为 Gemini 格式
            contents = [
                {"role": "user" if m["role"] == "user" else "model",
                 "parts": [{"text": m["content"]}]}
                for m in msgs if m["role"] != "system"
            ]
            resp = httpx.post(
                url,
                params={"key": api_key},
                json={"contents": contents},
                timeout=120,
            )
            resp.raise_for_status()
            return resp.json()["candidates"][0]["content"]["parts"][0]["text"]

        elif provider in OPENAI_COMPAT_URLS:
            # 所有 OpenAI 兼容服务商统一走同一段代码，只换 base_url
            base_url = OPENAI_COMPAT_URLS[provider]
            resp = httpx.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={"model": model, "messages": msgs},
                timeout=120,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

        else:
            raise ValueError(f"不支持的服务商: {provider}")

    for step in range(10):
        try:
            content = call_llm(messages)
        except Exception as e:
            yield json.dumps({"type": "error", "content": str(e)}, ensure_ascii=False)
            return

        messages.append({"role": "assistant", "content": content})

        if "思考:" in content:
            thought = content.split("思考:")[1].split("行动:")[0].strip()
            yield json.dumps({"type": "thought", "content": thought}, ensure_ascii=False)

        if "行动:" in content:
            action_part = content.split("行动:")[1]
            if "观察:" in action_part:
                action_part = action_part.split("观察:")[0]
            action_part = action_part.strip()

            try:
                tool_name = action_part.split("(")[0].strip()
                args_str = action_part[len(tool_name):].strip()
                if args_str.startswith("(") and args_str.endswith(")"):
                    args_str = args_str[1:-1]
                args = json.loads(args_str) if args_str else {}
            except Exception:
                args = {}
                tool_name = action_part.split("(")[0].strip()

            yield json.dumps({"type": "action", "tool": tool_name, "args": args}, ensure_ascii=False)

            if tool_name in selected_tools:
                try:
                    fn = selected_tools[tool_name]["fn"]
                    observation = fn(**args) if isinstance(args, dict) else fn(*args) if isinstance(args, list) else fn(args)
                except Exception as e:
                    observation = f"[工具错误] {e}"
            else:
                observation = f"[错误] 工具 '{tool_name}' 不可用"

            yield json.dumps({"type": "observation", "content": str(observation)}, ensure_ascii=False)
            messages.append({"role": "user", "content": f"观察: {observation}"})

        if "最终答案:" in content:
            final = content.split("最终答案:")[1].strip()
            yield json.dumps({"type": "final", "content": final}, ensure_ascii=False)
            return

    yield json.dumps({"type": "final", "content": "已达到最大步骤数，请查看上面的步骤结果。"}, ensure_ascii=False)
