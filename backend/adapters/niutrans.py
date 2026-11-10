"""小牛翻译。

新版 v2：POST https://api.niutrans.com/v2/text/translate
  表单字段 from / to / srcText / appId / timestamp / authStr
  authStr = md5(apikey=...&appId=...&from=...&srcText=...&timestamp=...&to=...) 按键名排序
旧版：POST https://api.niutrans.com/NiuTransServer/translation
  字段 from / to / src_text / apikey，返回 tgt_text
"""
from __future__ import annotations

import hashlib
import time

import httpx

from .base import BaseAdapter, ProviderError

V2_URL = "https://api.niutrans.com/v2/text/translate"
V1_URL = "https://api.niutrans.com/NiuTransServer/translation"


class NiuTransAdapter(BaseAdapter):
    def _post_v2(self, text: str, src: str, tgt: str) -> dict:
        api_key = self.cfg_str("apikey")
        app_id = self.cfg_str("app_id")
        params = {
            "from": src or "auto",
            "to": tgt,
            "srcText": text,
            "appId": app_id,
            "timestamp": str(int(time.time() * 1000)),
        }
        sign_src = dict(params)
        sign_src["apikey"] = api_key
        auth = "&".join(f"{k}={sign_src[k]}" for k in sorted(sign_src))
        params["authStr"] = hashlib.md5(auth.encode("utf-8")).hexdigest()
        return params

    async def translate(self, text: str, src: str, tgt: str) -> str:
        api_key = self.cfg_str("apikey")
        if not api_key:
            raise ProviderError("小牛翻译：缺少 API Key")
        use_v2 = bool(self.cfg_str("app_id"))

        try:
            async with httpx.AsyncClient(timeout=45, trust_env=False) as client:
                if use_v2:
                    r = await client.post(V2_URL, data=self._post_v2(text, src, tgt))
                    r.raise_for_status()
                    data = r.json()
                    code = str(data.get("errorCode", "0"))
                    if code not in ("0", "None", ""):
                        raise ProviderError(f"小牛翻译：错误码 {code}", str(data.get("errorMsg"))[:300])
                    out = data.get("tgtText") or data.get("tgt_text")
                else:
                    r = await client.post(
                        V1_URL,
                        data={"from": src or "auto", "to": tgt, "src_text": text, "apikey": api_key},
                    )
                    r.raise_for_status()
                    data = r.json()
                    code = str(data.get("error_code", data.get("errorCode", "0")))
                    if code not in ("0", "None", ""):
                        msg = data.get("error_msg") or data.get("errorMsg") or ""
                        raise ProviderError(f"小牛翻译：错误码 {code}", str(msg)[:300])
                    out = data.get("tgt_text") or data.get("tgtText")
        except httpx.HTTPError as e:
            raise ProviderError("小牛翻译：网络请求失败", str(e)) from e

        if not out:
            raise ProviderError("小牛翻译：返回为空", str(data)[:300])
        return str(out).strip()
