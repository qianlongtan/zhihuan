"""配置与厂商元数据。

密钥仅保存在本地 data/config.json（权限 600），不会上传到任何服务器。
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

# 打包成 exe 后：数据写 exe 旁边，静态资源在 PyInstaller 解包目录
if getattr(sys, "frozen", False):
    PROJECT_DIR = Path(sys.executable).resolve().parent
    RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", PROJECT_DIR))
else:
    PROJECT_DIR = Path(__file__).resolve().parent.parent
    RESOURCE_DIR = PROJECT_DIR

DATA_DIR = PROJECT_DIR / "data"
CONFIG_PATH = DATA_DIR / "config.json"

LANG_NAMES = {
    "auto": "自动检测",
    "zh": "简体中文",
    "zh-TW": "繁体中文",
    "en": "英语",
    "ja": "日语",
    "ko": "韩语",
    "fr": "法语",
    "de": "德语",
    "ru": "俄语",
    "es": "西班牙语",
    "pt": "葡萄牙语",
    "it": "意大利语",
    "ar": "阿拉伯语",
}

TARGET_LANGS = ["zh", "zh-TW", "en", "ja", "ko", "fr", "de", "ru", "es", "pt", "it", "ar"]
SOURCE_LANGS = ["auto", *TARGET_LANGS]

# 每家厂商的字段定义：前端据此自动渲染设置卡片
PROVIDERS: list[dict[str, Any]] = [
    {
        "id": "mock",
        "name": "离线示例",
        "tag": "无需密钥",
        "desc": "本地模拟翻译，用于先验证界面与交互。选择真实厂商并填入密钥后即可切换。",
        "fields": [],
        "defaults": {},
    },
    {
        "id": "index_translate",
        "name": "B站 Index-Translate",
        "tag": "完全免费",
        "desc": "哔哩哔哩开源的翻译模型，公共 API 无需密钥、不限额度。2B 最快，35B 质量最好。",
        "docs": "https://index-translate.bilibili.com/v1",
        "fields": [
            {"key": "model", "label": "模型", "type": "select", "default": "Index-Translate-9B",
             "options": [
                 {"value": "Index-Translate-9B", "label": "9B · 均衡，约 0.9s（推荐）"},
                 {"value": "Index-Translate-2B", "label": "2B · 最快，约 0.6s"},
                 {"value": "Index-Translate-35B-A3B", "label": "35B-A3B · 质量最好，偶有排队"},
             ],
             "help": "划词用 9B 最稳；35B 译文更细，但公共接口高峰期可能等十几秒。"},
            {"key": "base_url", "label": "Base URL", "type": "text",
             "default": "https://index-translate.bilibili.com/v1", "advanced": True},
        ],
        "defaults": {"model": "Index-Translate-9B",
                     "base_url": "https://index-translate.bilibili.com/v1"},
    },
    {
        "id": "zhipu",
        "name": "智谱 GLM",
        "tag": "OpenAI 兼容",
        "desc": "open.bigmodel.cn，glm-4.5-flash 有免费额度，译文通顺，适合学术长句。",
        "docs": "https://open.bigmodel.cn/usercenter/apikeys",
        "fields": [
            {"key": "api_key", "label": "API Key", "type": "password", "required": True,
             "placeholder": "形如 xxxxxxxx.yyyyyyyy"},
            {"key": "model", "label": "模型", "type": "text", "default": "glm-4.5-flash",
             "suggest": ["glm-4.5-flash", "glm-4-flash", "glm-4-plus", "glm-4.5", "glm-4-air"],
             "help": "glm-4.5-flash 免费且译文更顺；要更快可换 glm-4-flash。"},
            {"key": "base_url", "label": "Base URL", "type": "text",
             "default": "https://open.bigmodel.cn/api/paas/v4", "advanced": True},
        ],
        "defaults": {"model": "glm-4.5-flash", "base_url": "https://open.bigmodel.cn/api/paas/v4"},
    },
    {
        "id": "xfyun_maas",
        "name": "讯飞星辰 MaaS",
        "tag": "OpenAI 兼容",
        "desc": "maas.xfyun.cn，OpenAI 协议，直接填 APIKey 即可。",
        "docs": "https://maas.xfyun.cn/",
        "fields": [
            {"key": "api_key", "label": "APIKey", "type": "password", "required": True},
            {"key": "model", "label": "模型 ID", "type": "text", "default": "spark-x2.5",
             "suggest": ["spark-x2.5", "xdeepseekv3", "xop3qwen30b", "xopdeepseekv3"],
             "help": "模型 ID 见控制台「模型广场」，每家账号开通的模型不同。"},
            {"key": "base_url", "label": "Base URL", "type": "text",
             "default": "https://maas-api.cn-huabei-1.xf-yun.com/v2", "advanced": True,
             "help": "2026-01-10 之后开通的账号用 /v2，存量账号可用 /v1。"},
        ],
        "defaults": {"model": "spark-x2.5", "base_url": "https://maas-api.cn-huabei-1.xf-yun.com/v2"},
    },
    {
        "id": "niutrans",
        "name": "小牛翻译",
        "tag": "传统机翻",
        "desc": "api.niutrans.com。填了 AppId 走新版 v2（带签名），否则走旧版接口。",
        "docs": "https://niutrans.com/cloud/account",
        "fields": [
            {"key": "apikey", "label": "API Key", "type": "password", "required": True},
            {"key": "app_id", "label": "AppId", "type": "text", "required": False,
             "placeholder": "可留空", "help": "新版 v2 接口需要；留空则使用旧版接口。"},
        ],
        "defaults": {},
    },
    {
        "id": "volc",
        "name": "火山翻译",
        "tag": "AK/SK 签名",
        "desc": "open.volcengineapi.com 机器翻译，需要 AccessKey/SecretKey 并已开通服务。",
        "docs": "https://console.volcengine.com/translate",
        "fields": [
            {"key": "access_key", "label": "AccessKey", "type": "password", "required": True},
            {"key": "secret_key", "label": "SecretKey", "type": "password", "required": True},
            {"key": "region", "label": "区域", "type": "text", "default": "cn-north-1", "advanced": True},
            {"key": "endpoint", "label": "域名", "type": "text", "default": "",
             "placeholder": "translate.volcengineapi.com", "advanced": True,
             "help": "留空自动使用官方域名，失败会自动回退。"},
        ],
        "defaults": {"region": "cn-north-1"},
    },
    {
        "id": "spark",
        "name": "讯飞星火",
        "tag": "WebSocket",
        "desc": "spark-api.xf-yun.com，需要 APPID + APIKey + APISecret 三件套。",
        "docs": "https://console.xfyun.cn/services/bmx1",
        "fields": [
            {"key": "app_id", "label": "APPID", "type": "text", "required": True},
            {"key": "api_key", "label": "APIKey", "type": "password", "required": True},
            {"key": "api_secret", "label": "APISecret", "type": "password", "required": True},
            {"key": "model", "label": "版本", "type": "select", "default": "generalv3.5",
             "options": [
                 {"value": "lite", "label": "Lite（免费）"},
                 {"value": "generalv3", "label": "Pro"},
                 {"value": "generalv3.5", "label": "Max"},
                 {"value": "4.0Ultra", "label": "4.0 Ultra"},
             ]},
        ],
        "defaults": {"model": "generalv3.5"},
    },
    {
        "id": "spark_http",
        "name": "讯飞星火 HTTP",
        "tag": "OpenAI 兼容",
        "desc": "spark-api-open.xf-yun.com。只需 APIKey + APISecret（无需 APPID），使用星火 HTTP 接口。",
        "docs": "https://console.xfyun.cn/services/bmx1",
        "fields": [
            {"key": "api_key", "label": "APIKey", "type": "password", "required": True},
            {"key": "api_secret", "label": "APISecret", "type": "password", "required": True},
            {"key": "model", "label": "模型", "type": "select", "default": "lite",
             "options": [
                 {"value": "lite", "label": "Lite（免费）"},
                 {"value": "generalv3", "label": "Pro"},
                 {"value": "generalv3.5", "label": "Max"},
                 {"value": "4.0Ultra", "label": "4.0 Ultra"},
             ]},
        ],
        "defaults": {"model": "lite"},
    },
    {
        "id": "baidu",
        "name": "百度翻译",
        "tag": "传统机翻",
        "desc": "fanyi-api.baidu.com 通用文本翻译。免费版 1 QPS，标准版更快。",
        "docs": "https://fanyi-api.baidu.com/manage/developer",
        "fields": [
            {"key": "app_id", "label": "APP ID", "type": "text", "required": True},
            {"key": "secret_key", "label": "密钥", "type": "password", "required": True},
        ],
        "defaults": {},
    },
    {
        "id": "openai",
        "name": "自定义 OpenAI 兼容",
        "tag": "通用",
        "desc": "任何 OpenAI 协议服务：DeepSeek、Kimi、硅基流动、OneAPI、本地 Ollama / vLLM。",
        "fields": [
            {"key": "base_url", "label": "Base URL", "type": "text", "required": True,
             "placeholder": "https://api.deepseek.com/v1"},
            {"key": "api_key", "label": "API Key", "type": "password", "required": False,
             "placeholder": "本地模型可留空"},
            {"key": "model", "label": "模型", "type": "text", "required": True,
             "placeholder": "deepseek-chat"},
        ],
        "defaults": {},
    },
]

PROVIDER_MAP = {p["id"]: p for p in PROVIDERS}

DEFAULT_SETTINGS: dict[str, Any] = {
    "active": "mock",
    "source_lang": "auto",
    "target_lang": "zh",
    "providers": {p["id"]: dict(p.get("defaults", {})) for p in PROVIDERS},
}

SECRET_TYPES = {"password"}


def _ensure_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def load_settings() -> dict[str, Any]:
    _ensure_dir()
    if not CONFIG_PATH.exists():
        save_settings(DEFAULT_SETTINGS)
        return json.loads(json.dumps(DEFAULT_SETTINGS))
    try:
        raw = json.loads(CONFIG_PATH.read_text("utf-8"))
    except (json.JSONDecodeError, OSError):
        return json.loads(json.dumps(DEFAULT_SETTINGS))

    settings = json.loads(json.dumps(DEFAULT_SETTINGS))
    settings["active"] = raw.get("active", settings["active"])
    settings["source_lang"] = raw.get("source_lang", settings["source_lang"])
    settings["target_lang"] = raw.get("target_lang", settings["target_lang"])
    # 保留磁盘上的未知服务商配置，避免旧进程保存时把新加的配置整块丢弃
    for pid, cfg in (raw.get("providers") or {}).items():
        if isinstance(cfg, dict):
            settings["providers"].setdefault(pid, {}).update(cfg)
    return settings


def save_settings(settings: dict[str, Any]) -> None:
    _ensure_dir()
    tmp = CONFIG_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(settings, ensure_ascii=False, indent=2), "utf-8")
    try:
        os.chmod(tmp, 0o600)  # Windows 上无实际作用，且个别文件系统会报错
    except OSError:
        pass
    tmp.replace(CONFIG_PATH)


def public_settings(settings: dict[str, Any]) -> dict[str, Any]:
    """返回给前端：密文字段清空，但告知是否已保存。"""
    out = {
        "active": settings["active"],
        "source_lang": settings["source_lang"],
        "target_lang": settings["target_lang"],
        "providers": {},
    }
    for p in PROVIDERS:
        cfg = dict(settings["providers"].get(p["id"], {}))
        secrets_set = []
        for f in p["fields"]:
            if f["type"] in SECRET_TYPES:
                if cfg.get(f["key"]):
                    secrets_set.append(f["key"])
                cfg[f["key"]] = ""
        out["providers"][p["id"]] = {"values": cfg, "secrets_set": secrets_set}
    return out


def merge_settings(current: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    """合并前端提交的配置：密文字段为空表示保持原值。"""
    merged = json.loads(json.dumps(current))
    if incoming.get("active") in PROVIDER_MAP:
        merged["active"] = incoming["active"]
    if incoming.get("source_lang") in SOURCE_LANGS:
        merged["source_lang"] = incoming["source_lang"]
    if incoming.get("target_lang") in TARGET_LANGS:
        merged["target_lang"] = incoming["target_lang"]

    for pid, cfg in (incoming.get("providers") or {}).items():
        if pid not in PROVIDER_MAP or not isinstance(cfg, dict):
            continue
        target = merged["providers"].setdefault(pid, {})
        secret_keys = {f["key"] for f in PROVIDER_MAP[pid]["fields"] if f["type"] in SECRET_TYPES}
        for k, v in cfg.items():
            if k in secret_keys and (v is None or str(v) == ""):
                continue  # 留空 = 不修改
            target[k] = v
    return merged


def validate_provider(pid: str, settings: dict[str, Any]) -> None:
    p = PROVIDER_MAP.get(pid)
    if not p:
        raise ValueError(f"未知的翻译服务：{pid}")
    cfg = settings["providers"].get(pid, {})
    missing = [
        f["label"] for f in p["fields"]
        if f.get("required") and not str(cfg.get(f["key"], "")).strip()
    ]
    if missing and pid != "mock":
        raise ValueError(f"{p['name']} 缺少必填项：{'、'.join(missing)}")
