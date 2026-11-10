"""硅基流动 SiliconFlow：OpenAI 兼容聚合平台。

- 端点：https://api.siliconflow.cn/v1
- 翻译首选腾讯混元翻译模型 tencent/Hunyuan-MT-7B（0.6s 级）；
  Qwen 系列为通用对话模型，术语偶有偏差。
"""
from __future__ import annotations

from .openai_compat import OpenAICompatAdapter


class SiliconFlowAdapter(OpenAICompatAdapter):
    id = "siliconflow"
    name = "硅基流动"
    default_base_url = "https://api.siliconflow.cn/v1"

    def _payload(self, text: str, src: str, tgt: str, stream: bool) -> dict:
        payload = super()._payload(text, src, tgt, stream)
        # Qwen3 系默认会先思考，划词场景直接关掉
        if "Qwen3" in self.model:
            payload["enable_thinking"] = False
        return payload
