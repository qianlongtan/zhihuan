"""PDF 划词文本清洗：PDF 抽出来的文本常带硬换行、断词连字符、软连字符。"""
from __future__ import annotations

import re

_CJK = re.compile(r"[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]")


def clean_text(s: str) -> str:
    if not s:
        return ""
    s = s.replace("\u00ad", "").replace("\ufeff", "")
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    # 行尾连字符断词：inter-\nnational -> international
    s = re.sub(r"([A-Za-z])-\n(?=[a-z])", r"\1", s)
    # 单换行视为 PDF 硬折行，合并成空格；段落空行保留
    s = re.sub(r"(?<!\n)\n(?!\n)", " ", s)
    # 中文之间不要空格
    s = _CJK.sub(lambda m: m.group(0), s)
    s = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", s)
    # 折叠多余空格
    s = re.sub(r"[ \t\u3000]{2,}", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def looks_like_refs(text: str) -> bool:
    """粗略判断是否参考文献条目，用于前端提示（不影响翻译）。"""
    t = text.strip()
    return bool(re.match(r"^\[\d{1,3}\]", t)) or bool(
        re.search(r"(19|20)\d{2}[;,]?\s*(doi|https?://)", t, re.I)
    )
