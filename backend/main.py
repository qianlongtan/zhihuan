"""知幻 · PDF 划词翻译 —— 本地后端。"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import cache
from .adapters import NAMES, build
from .adapters.base import ProviderError
from .config import (
    LANG_NAMES,
    PROVIDER_MAP,
    PROVIDERS,
    RESOURCE_DIR,
    SOURCE_LANGS,
    TARGET_LANGS,
    load_settings,
    merge_settings,
    public_settings,
    save_settings,
    validate_provider,
)
from .textprep import clean_text

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = Path(RESOURCE_DIR) / "static"

app = FastAPI(title="知幻 · PDF 翻译", docs_url=None, redoc_url=None)


class TranslateIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=20000)
    provider: str | None = None
    source_lang: str | None = None
    target_lang: str | None = None
    no_cache: bool = False


class SettingsIn(BaseModel):
    active: str | None = None
    source_lang: str | None = None
    target_lang: str | None = None
    providers: dict | None = None


class TestIn(BaseModel):
    values: dict | None = None


# ---------------------------------------------------------------- 元数据 / 设置

@app.get("/api/meta")
async def meta():
    return {
        "providers": PROVIDERS,
        "languages": [{"code": c, "name": n} for c, n in LANG_NAMES.items()],
        "source_langs": SOURCE_LANGS,
        "target_langs": TARGET_LANGS,
        "version": "1.0.0",
    }


@app.get("/api/settings")
async def get_settings():
    s = load_settings()
    return public_settings(s)


@app.post("/api/settings")
async def post_settings(body: SettingsIn):
    current = load_settings()
    merged = merge_settings(current, body.model_dump(exclude_none=True))
    if merged["active"] != "mock":
        try:
            validate_provider(merged["active"], merged)
        except ValueError as e:
            raise HTTPException(400, str(e))
    save_settings(merged)
    return public_settings(merged)


@app.get("/api/health")
async def health():
    s = load_settings()
    return {
        "ok": True,
        "active": s["active"],
        "active_name": NAMES.get(s["active"], s["active"]),
        "cache": cache.stats(),
    }


# ---------------------------------------------------------------- 设置项测试

def _cfg_with_override(pid: str, values: dict | None) -> dict:
    current = load_settings()
    if not values:
        return current
    return merge_settings(current, {"providers": {pid: values}})


@app.post("/api/providers/{pid}/test")
async def test_provider(pid: str, body: TestIn | None = None):
    if pid not in PROVIDER_MAP:
        raise HTTPException(404, "未知服务商")
    s = _cfg_with_override(pid, body.values if body else None)
    adapter = build(pid, s)
    started = time.time()
    try:
        sample = await asyncio.wait_for(adapter.test(), timeout=75)
        return {
            "ok": True,
            "ms": int((time.time() - started) * 1000),
            "sample": sample[:300],
        }
    except asyncio.TimeoutError:
        return JSONResponse({"ok": False, "message": "请求超时（75s）"}, status_code=200)
    except ProviderError as e:
        return JSONResponse(
            {"ok": False, "message": e.message, "detail": (e.detail or "")[:500]},
            status_code=200,
        )
    except ValueError as e:
        return JSONResponse({"ok": False, "message": str(e)}, status_code=200)
    except Exception as e:  # 兜底，避免前端拿不到可读错误
        return JSONResponse(
            {"ok": False, "message": f"{type(e).__name__}: {e}"[:300]}, status_code=200
        )


# ---------------------------------------------------------------- 翻译

def _resolve(body: TranslateIn):
    s = load_settings()
    pid = body.provider or s["active"]
    if pid not in PROVIDER_MAP:
        raise HTTPException(400, f"未知服务商：{pid}")
    if pid != "mock":
        try:
            validate_provider(pid, s)
        except ValueError as e:
            raise HTTPException(400, str(e))
    src = body.source_lang or s["source_lang"]
    tgt = body.target_lang or s["target_lang"]
    text = clean_text(body.text)
    if not text:
        raise HTTPException(400, "选中文本为空")
    adapter = build(pid, s)
    return s, pid, adapter, src, tgt, text


@app.post("/api/translate")
async def translate(body: TranslateIn):
    s, pid, adapter, src, tgt, text = _resolve(body)
    model = adapter.model
    k = cache.key(pid, model, src, tgt, text)
    if not body.no_cache:
        hit = cache.get(k)
        if hit is not None:
            return {"text": hit, "provider": pid, "model": model, "cached": True, "ms": 0}

    started = time.time()
    try:
        out = await asyncio.wait_for(adapter.translate(text, src, tgt), timeout=120)
    except asyncio.TimeoutError:
        raise HTTPException(504, "翻译超时（120s）")
    except ProviderError as e:
        raise HTTPException(502, f"{e.message}｜{e.detail}" if e.detail else e.message)
    except Exception as e:
        raise HTTPException(502, f"{type(e).__name__}: {e}")

    if not out.strip():
        raise HTTPException(502, "服务商返回空结果")
    cache.put(k, out, pid, model)
    return {
        "text": out,
        "provider": pid,
        "model": model,
        "cached": False,
        "ms": int((time.time() - started) * 1000),
    }


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@app.post("/api/translate/stream")
async def translate_stream(body: TranslateIn):
    try:
        s, pid, adapter, src, tgt, text = _resolve(body)
    except HTTPException as e:
        msg = str(e.detail)

        async def err_gen():
            yield _sse({"type": "error", "message": msg})
        return StreamingResponse(err_gen(), media_type="text/event-stream")

    model = adapter.model
    k = cache.key(pid, model, src, tgt, text)

    async def gen():
        started = time.time()
        if not body.no_cache:
            hit = cache.get(k)
            if hit is not None:
                yield _sse({"type": "start", "provider": pid, "model": model, "cached": True})
                yield _sse({"type": "delta", "text": hit})
                yield _sse({"type": "done", "provider": pid, "model": model,
                            "cached": True, "ms": 0})
                return

        parts: list[str] = []
        try:
            yield _sse({"type": "start", "provider": pid, "model": model, "cached": False})
            guard = asyncio.timeout(180)
            async with guard:
                async for delta in adapter.stream(text, src, tgt):
                    parts.append(delta)
                    yield _sse({"type": "delta", "text": delta})
        except TimeoutError:
            yield _sse({"type": "error", "message": "翻译超时（180s）"})
            return
        except ProviderError as e:
            msg = f"{e.message}｜{e.detail}" if e.detail else e.message
            yield _sse({"type": "error", "message": msg})
            return
        except Exception as e:
            yield _sse({"type": "error", "message": f"{type(e).__name__}: {e}"})
            return

        out = "".join(parts).strip()
        if not out:
            yield _sse({"type": "error", "message": "服务商返回空结果"})
            return
        cache.put(k, out, pid, model)
        yield _sse({"type": "done", "provider": pid, "model": model,
                    "cached": False, "ms": int((time.time() - started) * 1000)})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/cache/stats")
async def cache_stats():
    return cache.stats()


@app.delete("/api/cache")
async def cache_clear():
    cache.clear()
    return {"ok": True, "cache": cache.stats()}


# ---------------------------------------------------------------- 静态资源

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")
