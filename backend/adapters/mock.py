"""离线示例适配器：不需要任何密钥，用于验证界面。"""
from __future__ import annotations

import asyncio
from typing import AsyncIterator

from .base import BaseAdapter, build_prompt


class MockAdapter(BaseAdapter):
    async def translate(self, text: str, src: str, tgt: str) -> str:
        await asyncio.sleep(0.25)
        head = text.strip().replace("\n", " ")[:80]
        return (
            f"【离线示例 · 未调用真实接口】\n"
            f"这段文字会被发往所选厂商翻译。当前示例返回的是占位内容：\n"
            f"「{head}{'…' if len(text.strip()) > 80 else ''}」\n"
            f"请到右上角「设置」里选择一个服务商并填入密钥。"
        )

    async def stream(self, text: str, src: str, tgt: str) -> AsyncIterator[str]:
        out = await self.translate(text, src, tgt)
        for i in range(0, len(out), 6):
            yield out[i:i + 6]
            await asyncio.sleep(0.02)
