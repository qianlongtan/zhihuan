"""书生端砚（Intern-AI Discovery）适配器。

- 端点：https://discovery-api.intern-ai.org.cn/v1（OpenAI 协议）
- 模型：Sage-A1.5
- 坑：Sage-A1.5 是思维模型，默认把 token 全花在 reasoning_content 上、content 返回空串。
  只有 chat_template_kwargs.enable_thinking=false 能关掉（enable_thinking / thinking / reasoning_effort 均无效）。
"""
from __future__ import annotations

from .base import ProviderError
from .openai_compat import OpenAICompatAdapter


class DuanyanAdapter(OpenAICompatAdapter):
    id = "duanyan"
    name = "书生端砚"
    default_base_url = "https://discovery-api.intern-ai.org.cn/v1"

    def _payload(self, text: str, src: str, tgt: str, stream: bool) -> dict:
        payload = super()._payload(text, src, tgt, stream)
        payload["chat_template_kwargs"] = {"enable_thinking": False}
        payload["max_tokens"] = 4096
        return payload

    async def translate(self, text: str, src: str, tgt: str) -> str:
        out = (await super().translate(text, src, tgt)).strip()
        if not out:
            raise ProviderError("书生端砚：模型未返回译文",
                                "Sage-A1.5 的思维链可能占满了输出，请重试或缩短选段。")
        return out
