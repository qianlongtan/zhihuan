"""适配器注册表。"""
from __future__ import annotations

from .base import BaseAdapter, ProviderError
from .baidu import BaiduAdapter
from .index_translate import IndexTranslateAdapter
from .mock import MockAdapter
from .niutrans import NiuTransAdapter
from .openai_compat import OpenAICompatAdapter
from .siliconflow import SiliconFlowAdapter
from .spark import SparkAdapter
from .volc import VolcAdapter


class ZhipuAdapter(OpenAICompatAdapter):
    id = "zhipu"
    name = "智谱 GLM"
    default_base_url = "https://open.bigmodel.cn/api/paas/v4"

    def _payload(self, text: str, src: str, tgt: str, stream: bool) -> dict:
        payload = super()._payload(text, src, tgt, stream)
        # GLM-4.5 系列默认开启思考模式，划词翻译要的是低延迟，关掉
        payload["thinking"] = {"type": "disabled"}
        return payload


class XfyunMaasAdapter(OpenAICompatAdapter):
    id = "xfyun_maas"
    name = "讯飞星辰 MaaS"
    default_base_url = "https://maas-api.cn-huabei-1.xf-yun.com/v2"


class GenericOpenAIAdapter(OpenAICompatAdapter):
    id = "openai"
    name = "自定义 OpenAI 兼容"


class SparkHttpAdapter(OpenAICompatAdapter):
    """讯飞星火 HTTP 接口：Bearer <APIKey>:<APISecret>，与 WebSocket 版不同，无需 APPID。"""
    id = "spark_http"
    name = "讯飞星火 HTTP"
    default_base_url = "https://spark-api-open.xf-yun.com/v1"

    def _headers(self) -> dict[str, str]:
        key = self.cfg_str("api_key")
        secret = self.cfg_str("api_secret")
        if not key or not secret:
            raise ProviderError("讯飞星火 HTTP：需要 APIKey 与 APISecret")
        return {"Content-Type": "application/json", "Authorization": f"Bearer {key}:{secret}"}


REGISTRY: dict[str, type[BaseAdapter]] = {
    "mock": MockAdapter,
    "index_translate": IndexTranslateAdapter,
    "siliconflow": SiliconFlowAdapter,
    "zhipu": ZhipuAdapter,
    "xfyun_maas": XfyunMaasAdapter,
    "openai": GenericOpenAIAdapter,
    "niutrans": NiuTransAdapter,
    "volc": VolcAdapter,
    "spark": SparkAdapter,
    "spark_http": SparkHttpAdapter,
    "baidu": BaiduAdapter,
}

NAMES = {
    "mock": "离线示例",
    "index_translate": "B站 Index-Translate",
    "siliconflow": "硅基流动",
    "zhipu": "智谱 GLM",
    "xfyun_maas": "讯飞星辰 MaaS",
    "openai": "自定义 OpenAI 兼容",
    "niutrans": "小牛翻译",
    "volc": "火山翻译",
    "spark": "讯飞星火",
    "spark_http": "讯飞星火 HTTP",
    "baidu": "百度翻译",
}


def build(pid: str, settings: dict) -> BaseAdapter:
    cls = REGISTRY.get(pid)
    if not cls:
        raise ProviderError(f"未知的翻译服务：{pid}")
    return cls(settings["providers"].get(pid, {}))
