"""B 站 Index-Translate 免费公共 API（OpenAI 兼容，无需密钥）。

- 端点：https://index-translate.bilibili.com/v1
- 模型：Index-Translate-2B（快）/ 9B（均衡）/ 35B-A3B（质量最好）
- 必须带非默认 User-Agent，否则网关直接返回 412 HTML。
- 服务端支持 chat_template_kwargs.enable_thinking=false；即便漏出 <think> 也会被过滤。
"""
from __future__ import annotations

import re
from typing import AsyncIterator

from .openai_compat import OpenAICompatAdapter

_THINK_BLOCK = re.compile(r"(?is)<think\b[^>]*>.*?</think\s*>")
_THINK_OPEN = re.compile(r"(?is)<think\b[^>]*>")


def strip_think(text: str) -> str:
    """去掉 CoT 片段（含未闭合的 <think> 到结尾）。"""
    text = _THINK_BLOCK.sub("", text)
    m = _THINK_OPEN.search(text)
    if m:
        text = text[: m.start()]
    return text.strip()


class IndexTranslateAdapter(OpenAICompatAdapter):
    id = "index_translate"
    name = "B站 Index-Translate"
    default_base_url = "https://index-translate.bilibili.com/v1"
    extra_headers = {"User-Agent": "Index-Translate-Client/1.0"}

    def _payload(self, text: str, src: str, tgt: str, stream: bool) -> dict:
        payload = super()._payload(text, src, tgt, stream)
        # 翻译模型不需要思维链；开着会把译文挤掉
        payload["chat_template_kwargs"] = {"enable_thinking": False}
        # 默认 max_tokens 偏小，整页翻译会被截断
        payload["max_tokens"] = 4096
        return payload

    async def translate(self, text: str, src: str, tgt: str) -> str:
        return strip_think(await super().translate(text, src, tgt))

    async def stream(self, text: str, src: str, tgt: str) -> AsyncIterator[str]:
        # 只在开头可能出现的 <think> 上做拦截，避免全文缓冲影响流式体感
        pending = ""
        started = False
        async for piece in super().stream(text, src, tgt):
            if started:
                yield piece
                continue
            pending += piece
            head = pending.lstrip()
            if not head:
                continue
            if len(head) < 6 and "<think".startswith(head.lower()):
                continue  # 还看不出是不是 <think
            if head.lower().startswith("<think"):
                end = re.search(r"(?is)</think\s*>", head)
                if not end:
                    continue  # 仍在思维链里
                rest = head[end.end():]
                started = True
                if rest.strip():
                    yield rest.lstrip()
            else:
                started = True
                yield head
