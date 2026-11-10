"""适配器基类与通用工具。"""
from __future__ import annotations

from typing import AsyncIterator

from ..config import LANG_NAMES

PROMPT = """你是专业的科技文献翻译引擎。请把用户提供的文本翻译成{target}。

要求：
1. 只输出译文。不要解释、不要加引号、不要复述原文、不要加"译文："之类前缀。
2. 术语准确，优先使用该领域通用译名；公式、变量、单位、缩写、基因/蛋白名、化学式、数字原样保留。
3. 原文若被 PDF 断行切成碎句，先在心里合并成完整句子再翻译，保证译文连贯。
4. 学术文本用书面语，保持原文语气；图表标题、方法步骤保持简洁。
5. 若文本本身就是{target}，原样返回。"""


class ProviderError(Exception):
    def __init__(self, message: str, detail: str | None = None):
        super().__init__(message)
        self.message = message
        self.detail = detail


def target_name(code: str) -> str:
    return LANG_NAMES.get(code, code)


def build_prompt(target: str) -> str:
    return PROMPT.format(target=target_name(target))


class BaseAdapter:
    id = "base"
    name = "base"

    def __init__(self, cfg: dict):
        self.cfg = cfg or {}

    @property
    def model(self) -> str:
        return str(self.cfg.get("model", "") or "")

    def cfg_str(self, key: str, default: str = "") -> str:
        v = self.cfg.get(key, default)
        return str(v).strip() if v is not None else default

    async def translate(self, text: str, src: str, tgt: str) -> str:
        raise NotImplementedError

    async def stream(self, text: str, src: str, tgt: str) -> AsyncIterator[str]:
        """默认：整段返回。LLM 适配器覆盖为真流式。"""
        yield await self.translate(text, src, tgt)

    async def test(self) -> str:
        out = await self.translate("The quick brown fox jumps over the lazy dog.", "en", "zh")
        return out.strip()
