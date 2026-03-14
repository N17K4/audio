from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException


def parse_cloud_auth_header(provider: str, api_key: str) -> Dict[str, str]:
    """
    Build auth headers for cloud voice-changer providers.
    Supported api_key input formats:
    - Plain key: inferred by provider
    - "bearer:xxxxx": force Authorization: Bearer xxxxx
    - "header:Header-Name:xxxxx": force custom header
    """
    key = api_key.strip()
    p = provider.strip().lower()
    if not key:
        return {}

    lower = key.lower()
    if lower.startswith("header:"):
        # header:Header-Name:VALUE
        parts = key.split(":", 2)
        if len(parts) == 3 and parts[1].strip() and parts[2].strip():
            return {parts[1].strip(): parts[2].strip()}
    if lower.startswith("bearer:"):
        return {"Authorization": f"Bearer {key.split(':', 1)[1].strip()}"}

    if p == "elevenlabs":
        return {"xi-api-key": key}
    if p == "azure":
        # Azure API Management / Azure AI common key header.
        return {"api-key": key}
    if p == "aws":
        # API Gateway common key header.
        return {"x-api-key": key}

    return {"Authorization": f"Bearer {key}"}


def require_httpx(feature: str):
    if httpx is None:
        raise HTTPException(
            status_code=500,
            detail=f"{feature} requires 'httpx' in runtime environment. Please run setup again.",
        )
