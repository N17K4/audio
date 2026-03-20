from fastapi import APIRouter, Form, HTTPException

from services.llm.gemini_llm import run_gemini_llm
from services.llm.github_llm import run_github_llm
from services.llm.ollama_llm import run_ollama_llm
from services.llm.openai_llm import run_openai_llm
from services.llm.anthropic_llm import run_claude_llm
from services.llm.openai_compat_llm import run_openai_compat_llm

router = APIRouter()

# OpenAI 兼容 LLM provider → base URL
OPENAI_COMPAT_LLM: dict = {
    "groq":     "https://api.groq.com/openai/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "mistral":  "https://api.mistral.ai/v1",
    "xai":      "https://api.x.ai/v1",
    # 中国云端 API
    "qwen":     "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "doubao":   "https://ark.volces.com/api/v3",
    "hunyuan":  "https://api.hunyuan.cloud.tencent.com/v1",
    "glm":      "https://open.bigmodel.cn/api/paas/v4",
    "moonshot": "https://api.moonshot.cn/v1",
    "spark":    "https://spark-api-open.xf-yun.com/v1",
    "minimax":  "https://api.minimax.chat/v1",
    "baichuan": "https://api.baichuan-ai.com/v1",
}

# OpenAI 兼容 LLM 默认模型
OPENAI_COMPAT_DEFAULT_MODEL: dict = {
    "groq":     "llama-3.3-70b-versatile",
    "deepseek": "deepseek-chat",
    "mistral":  "mistral-small-latest",
    "xai":      "grok-3-mini",
    # 中国云端 API
    "qwen":     "qwen-plus",
    "doubao":   "",          # 需用户填写 ep-xxx
    "hunyuan":  "hunyuan-lite",
    "glm":      "glm-4-flash",
    "moonshot": "moonshot-v1-8k",
    "spark":    "lite",
    "minimax":  "MiniMax-Text-01",
    "baichuan": "Baichuan4-Air",
}


@router.post("/tasks/llm")
async def task_llm(
    prompt: str = Form(""),
    messages: str = Form(""),   # JSON 数组 [{role, content}, ...]，优先于 prompt
    provider: str = Form("gemini"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
):
    import json
    # 解析多轮历史
    parsed_messages = None
    if messages.strip():
        try:
            parsed_messages = json.loads(messages)
        except Exception:
            pass

    if not parsed_messages and not prompt.strip():
        raise HTTPException(status_code=400, detail="prompt 或 messages 必须提供其一")

    p = provider.strip().lower()
    if p == "gemini":
        return await run_gemini_llm(prompt=prompt, api_key=api_key, model=model or "gemini-2.5-flash", messages=parsed_messages)
    if p == "openai":
        return await run_openai_llm(prompt=prompt, api_key=api_key, model=model or "gpt-4o-mini", messages=parsed_messages)
    if p == "ollama":
        return await run_ollama_llm(prompt=prompt, model=model or "qwen2.5-coder:14b", base_url=cloud_endpoint or "http://localhost:11434", messages=parsed_messages)
    if p == "github":
        return await run_github_llm(prompt=prompt, api_key=api_key, model=model or "gpt-4o-mini", messages=parsed_messages)
    if p == "claude":
        return await run_claude_llm(prompt=prompt, api_key=api_key, model=model or "claude-opus-4-5", messages=parsed_messages)
    if p in OPENAI_COMPAT_LLM:
        effective_model = model.strip() or OPENAI_COMPAT_DEFAULT_MODEL.get(p, "")
        if p == "doubao" and not effective_model.startswith("ep-"):
            raise HTTPException(
                status_code=400,
                detail="豆包（Doubao）模型 ID 必须以 ep- 开头，请在火山引擎控制台（ark.console.volcengine.com）创建推理接入点并复制 Endpoint ID（格式：ep-xxxxxxxx-xxxxx）",
            )
        return await run_openai_compat_llm(
            prompt=prompt, api_key=api_key,
            model=effective_model,
            messages=parsed_messages,
            base_url=OPENAI_COMPAT_LLM[p],
            provider_name=p,
        )
    raise HTTPException(status_code=400, detail=f"Unsupported LLM provider: {provider}")


@router.post("/tasks/translate")
async def task_translate(
    text: str = Form(...),
    target_lang: str = Form("中文"),
    source_lang: str = Form("自动检测"),
    provider: str = Form("gemini"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
):
    if not text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    p = provider.strip().lower()

    system_prompt = f"你是专业翻译。{'如果源语言是' + source_lang + '，' if source_lang and source_lang != '自动检测' else ''}请将以下文本翻译成{target_lang}，只返回译文，不要解释。"
    messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": text}]

    if p == "gemini":
        result = await run_gemini_llm(prompt=text, api_key=api_key, model=model or "gemini-2.5-flash", messages=messages)
    elif p == "openai":
        result = await run_openai_llm(prompt=text, api_key=api_key, model=model or "gpt-4o-mini", messages=messages)
    elif p == "ollama":
        result = await run_ollama_llm(prompt=text, model=model or "qwen2.5:14b", base_url=cloud_endpoint or "http://localhost:11434", messages=messages)
    elif p == "github":
        result = await run_github_llm(prompt=text, api_key=api_key, model=model or "gpt-4o-mini", messages=messages)
    elif p == "claude":
        result = await run_claude_llm(prompt=text, api_key=api_key, model=model or "claude-opus-4-5", messages=messages)
    elif p in OPENAI_COMPAT_LLM:
        result = await run_openai_compat_llm(
            prompt=text, api_key=api_key,
            model=model or OPENAI_COMPAT_DEFAULT_MODEL[p],
            messages=messages,
            base_url=OPENAI_COMPAT_LLM[p],
            provider_name=p,
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported translate provider: {provider}")

    result["task"] = "translate"
    return result
