"""百度翻译开放平台（通用文本翻译）。

POST https://fanyi-api.baidu.com/api/trans/vip/translate
form: q / from / to / appid / salt / sign
sign = md5(appid + q + salt + 密钥)
单次 q ≤ 6000 字节，超长自动按句切块。
"""
from __future__ import annotations

import asyncio
import hashlib
import random
import re

import httpx

from .base import BaseAdapter, ProviderError

URL = "https://fanyi-api.baidu.com/api/trans/vip/translate"
LIMIT_BYTES = 5200

LANG = {
    "zh": "zh", "zh-TW": "cht", "en": "en", "ja": "jp", "ko": "kor",
    "fr": "fra", "de": "de", "ru": "ru", "es": "spa", "pt": "pt",
    "it": "it", "ar": "ara",
}

ERR_MSG = {
    "52001": "请求超时，请重试",
    "52002": "系统错误，请重试",
    "52003": "未授权用户：APPID 或密钥不对",
    "54000": "必填参数为空",
    "54001": "签名错误：检查 APPID 与密钥是否配对",
    "54003": "访问频率受限（免费版 1 QPS）",
    "54004": "账户余额不足",
    "54005": "长文本请求过于频繁",
    "58000": "客户端 IP 非法",
    "58001": "译文语言方向不支持",
    "58002": "服务当前已关闭",
}


def _chunks(text: str, limit: int = LIMIT_BYTES) -> list[str]:
    """按段落/句子切分，保证每块 UTF-8 字节数 ≤ limit。"""
    out: list[str] = []
    buf = ""

    def push(seg: str) -> None:
        nonlocal buf
        if not seg:
            return
        if len((buf + seg).encode("utf-8")) <= limit:
            buf += seg
            return
        if buf:
            out.append(buf)
            buf = ""
        while len(seg.encode("utf-8")) > limit:
            cut = 1
            while cut < len(seg) and len(seg[:cut + 1].encode("utf-8")) <= limit:
                cut += 1
            out.append(seg[:cut])
            seg = seg[cut:]
        buf = seg

    for para in text.split("\n"):
        for sent in re.split(r"(?<=[.!?。！？])\s*", para):
            push(sent)
        push("\n")
    if buf.strip():
        out.append(buf)
    return [c for c in out if c.strip()] or [text]


class BaiduAdapter(BaseAdapter):
    async def _one(self, client: httpx.AsyncClient, text: str, src: str, tgt: str) -> str:
        app_id = self.cfg_str("app_id")
        secret = self.cfg_str("secret_key")
        if not app_id or not secret:
            raise ProviderError("百度翻译：需要 APP ID 与密钥")
        to_code = LANG.get(tgt)
        if not to_code:
            raise ProviderError(f"百度翻译：不支持目标语言 {tgt}")
        from_code = "auto" if src in ("auto", "", None) else LANG.get(src, "auto")

        data = None
        for attempt in range(2):
            salt = str(random.randint(32768, 65536))
            sign = hashlib.md5(
                (app_id + text + salt + secret).encode("utf-8")
            ).hexdigest()
            r = await client.post(URL, data={
                "q": text, "from": from_code, "to": to_code,
                "appid": app_id, "salt": salt, "sign": sign,
            })
            if r.status_code >= 400:
                raise ProviderError(f"百度翻译：HTTP {r.status_code}", r.text[:300])
            try:
                data = r.json()
                break
            except ValueError:
                # 百度偶发返回空体/风控页，重试一次
                if attempt == 0:
                    await asyncio.sleep(0.8)
                    continue
                raise ProviderError("百度翻译：返回内容无法解析", r.text[:300])
        if data is None:
            raise ProviderError("百度翻译：返回为空")
        if data.get("error_code"):
            code = str(data["error_code"])
            raise ProviderError(
                f"百度翻译：{ERR_MSG.get(code, '调用失败')}（{code}）",
                str(data.get("error_msg", ""))[:300],
            )
        items = data.get("trans_result") or []
        if not items:
            raise ProviderError("百度翻译：返回为空", str(data)[:300])
        return "\n".join(str(i.get("dst", "")) for i in items).strip()

    async def translate(self, text: str, src: str, tgt: str) -> str:
        try:
            async with httpx.AsyncClient(timeout=45, trust_env=False) as client:
                results = []
                for chunk in _chunks(text):
                    results.append(await self._one(client, chunk, src, tgt))
        except httpx.HTTPError as e:
            raise ProviderError("百度翻译：网络请求失败", str(e)) from e
        return "\n".join(r for r in results if r).strip()
