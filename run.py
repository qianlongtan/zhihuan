#!/usr/bin/env python3
"""启动知幻：起本地服务并自动打开浏览器。"""
from __future__ import annotations

import socket
import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))


def _free_port(start: int = 8765) -> int:
    for port in range(start, start + 50):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start


def _open_browser(url: str) -> None:
    """无图形界面（服务器/远程终端）时不要拉起 xdg-open→lynx 占住终端。"""
    import os
    import shutil
    if sys.platform not in ("darwin", "win32"):
        if not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
            return
        # DISPLAY 存在但机器上没装浏览器时，xdg-open 会退到 lynx/w3m 刷屏
        if not any(shutil.which(b) for b in (
                "google-chrome", "google-chrome-stable", "chromium",
                "chromium-browser", "firefox", "x-www-browser")):
            return
    try:
        webbrowser.open(url)
    except Exception:
        pass


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else _free_port()
    url = f"http://127.0.0.1:{port}"
    print(f"\n  知幻 · PDF 划词翻译\n  {url}\n  关闭此窗口即退出\n")
    threading.Timer(1.2, lambda: _open_browser(url)).start()

    # 直接导入 app 对象（而不是 "backend.main:app" 字符串），否则 PyInstaller 收不到依赖
    from backend.main import app
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
