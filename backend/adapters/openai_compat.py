"""OpenAI 兼容适配器：智谱 / 讯飞星辰 MaaS / 任意 OpenAI 协议服务。"""
from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from .base import BaseAdapter, ProviderError, build_prompt


class OpenAICompatAdapter(BaseAdapter):
    default_base_url = ""
    extra_headers: dict[str, str] = {}

    def _url(self) -> str:
        base = self.cfg_str("base_url", self.default_base_url).rstrip("/")
        if not base:
            raise ProviderError(f"{self.name}：未填写 Base URL")
        # 允许用户直接粘贴完整的 .../chat/completions
        if base.endswith("/chat/completions"):
            return base
        return base + "/chat/completions"

    def _headers(self) -> dict[str, str]:
        key = self.cfg_str("api_key")
        h = {"Content-Type": "application/json"}
        if key:
            h["Authorization"] = f"Bearer {key}"
        h.update(self.extra_headers)
        return h

    def _payload(self, text: str, src: str, tgt: str, stream: bool) -> dict:
        model = self.model
        if not model:
            raise ProviderError(f"{self.name}：未填写模型名称")
        return {
            "model": model,
            "messages": [
                {"role": "system", "content": build_prompt(tgt)},
                {"role": "user", "content": text},
            ],
            "temperature": 0.2,
            "stream": stream,
        }

    async def translate(self, text: str, src: str, tgt: str) -> str:
        payload = self._payload(text, src, tgt, False)
        try:
            async with httpx.AsyncClient(timeout=90, trust_env=False) as client:
                r = await client.post(self._url(), json=payload, headers=self._headers())
        except httpx.HTTPError as e:
            raise ProviderError(f"{self.name}：网络请求失败", str(e)) from e

        if r.status_code >= 400:
            raise ProviderError(f"{self.name}：HTTP {r.status_code}", _err_text(r))
        try:
            data = r.json()
            return data["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, TypeError) as e:
            raise ProviderError(f"{self.name}：返回格式异常", r.text[:500]) from e

    async def stream(self, text: str, src: str, tgt: str) -> AsyncIterator[str]:
        payload = self._payload(text, src, tgt, True)
        try:
            async with httpx.AsyncClient(timeout=120, trust_env=False) as client:
                async with client.stream(
                    "POST", self._url(), json=payload, headers=self._headers()
                ) as r:
                    if r.status_code >= 400:
                        body = (await r.aread()).decode("utf-8", "ignore")
                        raise ProviderError(f"{self.name}：HTTP {r.status_code}", body[:500])
                    async for line in r.aiter_lines():
                        line = line.strip()
                        if not line or not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            obj = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        choices = obj.get("choices") or []
                        if not choices:
                            err = obj.get("error")
                            if err:
                                raise ProviderError(f"{self.name}：{err.get('message', err)}")
                            continue
                        delta = (choices[0].get("delta") or {}).get("content")
                        if delta:
                            yield delta
        except httpx.HTTPError as e:
            raise ProviderError(f"{self.name}：网络请求失败", str(e)) from e


def _err_text(r: httpx.Response) -> str:
    try:
        j = r.json()
        return json.dumps(j, ensure_ascii=False)[:500]
    except Exception:
        return r.text[:500]
