"""讯飞星火（WebSocket 流式）。

鉴权：hmac-sha256(api_secret) 签 host/date/request-line，base64 后作为 authorization 参数。
协议：wss://spark-api.xf-yun.com/<ver>/chat?authorization=..&date=..&host=..
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
from email.utils import formatdate
from typing import AsyncIterator
from urllib.parse import quote, urlparse

import websockets

from .base import BaseAdapter, ProviderError, build_prompt

ROUTES = {
    "lite": ("v1.1", "lite"),
    "generalv3": ("v3.1", "generalv3"),
    "pro-128k": ("v3.1", "pro-128k"),
    "generalv3.5": ("v3.5", "generalv3.5"),
    "max-32k": ("v3.5", "max-32k"),
    "4.0Ultra": ("v4.0", "4.0Ultra"),
}


def _build_url(model: str, api_key: str, api_secret: str) -> tuple[str, str]:
    ver, domain = ROUTES.get(model, ROUTES["generalv3.5"])
    host = "spark-api.xf-yun.com"
    path = f"/{ver}/chat"

    date = formatdate(timeval=None, localtime=False, usegmt=True)
    origin = f"host: {host}\ndate: {date}\nGET {path} HTTP/1.1"
    digest = hmac.new(api_secret.encode("utf-8"), origin.encode("utf-8"), hashlib.sha256).digest()
    signature = base64.b64encode(digest).decode("utf-8")
    auth_origin = (
        f'api_key="{api_key}", algorithm="hmac-sha256", '
        f'headers="host date request-line", signature="{signature}"'
    )
    authorization = base64.b64encode(auth_origin.encode("utf-8")).decode("utf-8")
    url = (
        f"wss://{host}{path}"
        f"?authorization={quote(authorization)}&date={quote(date)}&host={host}"
    )
    return url, domain


class SparkAdapter(BaseAdapter):
    async def stream(self, text: str, src: str, tgt: str) -> AsyncIterator[str]:
        app_id = self.cfg_str("app_id")
        api_key = self.cfg_str("api_key")
        api_secret = self.cfg_str("api_secret")
        if not (app_id and api_key and api_secret):
            raise ProviderError("讯飞星火：需要 APPID、APIKey、APISecret 三项")

        url, domain = _build_url(self.model or "generalv3.5", api_key, api_secret)
        payload = {
            "header": {"app_id": app_id, "uid": "zhihuan"},
            "parameter": {
                "chat": {"domain": domain, "temperature": 0.2, "max_tokens": 4096}
            },
            "payload": {
                "message": {
                    "text": [
                        {"role": "system", "content": build_prompt(tgt)},
                        {"role": "user", "content": text},
                    ]
                }
            },
        }

        try:
            async with websockets.connect(url, open_timeout=20, close_timeout=5) as ws:
                await ws.send(json.dumps(payload))
                while True:
                    raw = await ws.recv()
                    obj = json.loads(raw)
                    header = obj.get("header") or {}
                    code = header.get("code", 0)
                    if code != 0:
                        raise ProviderError(
                            f"讯飞星火：{header.get('message', '调用失败')} (code={code})"
                        )
                    choices = (obj.get("payload") or {}).get("choices") or {}
                    for item in choices.get("text") or []:
                        content = item.get("content")
                        if content:
                            yield content
                    if header.get("status") == 2:
                        break
        except websockets.WebSocketException as e:
            raise ProviderError("讯飞星火：连接失败", str(e)) from e

    async def translate(self, text: str, src: str, tgt: str) -> str:
        parts: list[str] = []
        async for delta in self.stream(text, src, tgt):
            parts.append(delta)
        return "".join(parts).strip()
