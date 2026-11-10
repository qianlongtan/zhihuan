"""火山引擎机器翻译（open.volcengineapi.com）。

POST /?Action=TranslateText&Version=2020-06-01
鉴权：HMAC-SHA256 变体（SigV4 风格），service=translate，region 默认 cn-north-1。
Body: {"TargetLanguage":"zh","TextList":["..."],"SourceLanguage":"en"}
返回: {"Result":{"TranslationList":[{"Translation":"...","DetectedLanguage":"en"}]}}
"""
from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone
from urllib.parse import quote

import httpx

from .base import BaseAdapter, ProviderError

# 机器翻译有独立域名；open.volcengineapi.com 作为回退
HOSTS = ["translate.volcengineapi.com", "open.volcengineapi.com"]
PATH = "/"
SERVICE = "translate"
VERSION = "2020-06-01"


def _sign(ak: str, sk: str, body: bytes, region: str, host: str) -> tuple[str, dict[str, str]]:
    now = datetime.now(timezone.utc)
    x_date = now.strftime("%Y%m%dT%H%M%SZ")
    short_date = x_date[:8]
    payload_hash = hashlib.sha256(body).hexdigest()

    headers = {
        "content-type": "application/json",
        "host": host,
        "x-content-sha256": payload_hash,
        "x-date": x_date,
    }
    signed_headers = ";".join(sorted(headers))
    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted(headers))
    canonical_query = "&".join(
        f"{quote(k, safe='-_.~')}={quote(v, safe='-_.~')}"
        for k, v in sorted({"Action": "TranslateText", "Version": VERSION}.items())
    )
    canonical_request = "\n".join(
        ["POST", PATH, canonical_query, canonical_headers, signed_headers, payload_hash]
    )

    scope = f"{short_date}/{region}/{SERVICE}/request"
    string_to_sign = "\n".join(
        ["HMAC-SHA256", x_date, scope,
         hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()]
    )

    k = hmac.new(sk.encode("utf-8"), short_date.encode("utf-8"), hashlib.sha256).digest()
    k = hmac.new(k, region.encode("utf-8"), hashlib.sha256).digest()
    k = hmac.new(k, SERVICE.encode("utf-8"), hashlib.sha256).digest()
    k = hmac.new(k, b"request", hashlib.sha256).digest()
    signature = hmac.new(k, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    authorization = (
        f"HMAC-SHA256 Credential={ak}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return authorization, {
        "Content-Type": "application/json",
        "X-Date": x_date,
        "X-Content-Sha256": payload_hash,
        "Authorization": authorization,
    }


class VolcAdapter(BaseAdapter):
    async def translate(self, text: str, src: str, tgt: str) -> str:
        ak = self.cfg_str("access_key")
        sk = self.cfg_str("secret_key")
        region = self.cfg_str("region", "cn-north-1")
        if not ak or not sk:
            raise ProviderError("火山翻译：缺少 AccessKey / SecretKey")

        body_obj: dict = {"TargetLanguage": tgt, "TextList": [text]}
        if src and src != "auto":
            body_obj["SourceLanguage"] = src
        body = json.dumps(body_obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

        hosts = HOSTS
        custom = self.cfg_str("endpoint")
        if custom:
            hosts = [custom.replace("https://", "").replace("http://", "").strip("/")] + HOSTS

        last_err: str | None = None
        r = None
        for host in hosts:
            authorization, headers = _sign(ak, sk, body, region, host)
            url = f"https://{host}{PATH}?Action=TranslateText&Version={VERSION}"
            try:
                async with httpx.AsyncClient(timeout=45, trust_env=False) as client:
                    r = await client.post(url, content=body, headers=headers)
                break
            except httpx.ConnectError as e:
                last_err = str(e)
                continue
            except httpx.HTTPError as e:
                raise ProviderError("火山翻译：网络请求失败", str(e)) from e

        if r is None:
            raise ProviderError("火山翻译：无法连接服务", last_err or "")

        if r.status_code >= 400:
            raise ProviderError(f"火山翻译：HTTP {r.status_code}", r.text[:500])

        try:
            data = r.json()
        except Exception as e:
            raise ProviderError("火山翻译：返回不是 JSON", r.text[:300]) from e

        meta = data.get("ResponseMetadata") or {}
        if meta.get("Error"):
            err = meta["Error"]
            raise ProviderError(f"火山翻译：{err.get('Code', '错误')}", str(err.get('Message', ''))[:300])

        items = ((data.get("Result") or {}).get("TranslationList")
                 or data.get("TranslationList") or [])
        if not items:
            raise ProviderError("火山翻译：返回为空", json.dumps(data, ensure_ascii=False)[:300])
        return str(items[0].get("Translation", "")).strip()
