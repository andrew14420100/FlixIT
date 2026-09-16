from __future__ import annotations
from typing import Any, Callable, Mapping, Optional
from urllib.parse import urlencode

URL_KEY = "mediaflow_url"
API_PASSWORD_KEY = "mediaflow_api_password"
ENABLED_KEY = "mediaflow_enabled"
HLS_ENDPOINT = "/proxy/hls/manifest.m3u8"
STREAM_ENDPOINT = "/proxy/stream"

def normalize_url(url: str | None) -> str:
    return str(url or "").strip().rstrip("/")

def get_config(get_setting: Callable[[str], Any]) -> dict[str, Any]:
    url = normalize_url(get_setting(URL_KEY))
    password = str(get_setting(API_PASSWORD_KEY) or "").strip()
    raw = get_setting(ENABLED_KEY)
    enabled = (raw.strip().lower() in {"1", "true", "yes", "on", "enabled"}) if isinstance(raw, str) else bool(raw)
    return {"enabled": enabled, "url": url, "api_password": password}

def _headers_to_params(headers: Mapping[str, Any] | None) -> dict[str, str]:
    params = {}
    for name, value in (headers or {}).items():
        if value is None:
            continue
        value = str(value).strip()
        if value:
            params[f"h_{str(name).lower()}"] = value
    return params

def build_proxy_url(
    base_url: str,
    stream_url: str | None = None,
    stream_type: str | None = None,
    api_password: str = "",
    headers: Optional[Mapping[str, Any]] = None,
    *,
    source_url: str | None = None,
    is_mp4: bool | None = None,
) -> str:
    base = normalize_url(base_url)
    if not base:
        raise ValueError("MediaFlow URL non configurato")
    if stream_url is None:
        stream_url = source_url
    if not stream_url:
        raise ValueError("URL dello stream non configurato")
    if is_mp4 is not None:
        resolved_type = "mp4" if is_mp4 else "hls"
    else:
        resolved_type = (stream_type or "hls").strip().lower()
    endpoint = HLS_ENDPOINT if resolved_type in {"hls", "m3u8", "application/vnd.apple.mpegurl"} else STREAM_ENDPOINT
    params = {"d": str(stream_url)}
    password = str(api_password or "").strip()
    if password:
        params["api_password"] = password
    params.update(_headers_to_params(headers))
    return f"{base}{endpoint}?{urlencode(params)}"

def wrap_stream(result: Mapping[str, Any], get_setting: Callable[[str], Any]) -> dict[str, Any]:
    output = dict(result)
    stream = str(output.get("stream") or "").strip()
    if not stream:
        return output
    cfg = get_config(get_setting)
    if not cfg["enabled"] or not cfg["url"]:
        return output
    base = cfg["url"]
    if stream.startswith(base + "/"):
        output["proxied"] = True
        output.setdefault("original_stream", stream)
        return output
    proxied = build_proxy_url(
        base_url=base,
        stream_url=stream,
        stream_type=str(output.get("type") or "hls").lower(),
        api_password=cfg["api_password"],
        headers=output.get("headers") or {},
    )
    output["original_stream"] = stream
    output["stream"] = proxied
    output["proxied"] = True
    return output

async def health_check(base_url: str, *, timeout: float = 10.0) -> dict[str, Any]:
    import httpx
    url = f"{normalize_url(base_url)}/health"
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        response = await client.get(url)
    return {"ok": response.is_success, "status_code": response.status_code, "url": url}
