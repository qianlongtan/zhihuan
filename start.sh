#!/usr/bin/env bash
# 双击/命令行启动知幻
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "首次运行：创建虚拟环境并安装依赖…"
  uv venv .venv --python 3.12
  . .venv/bin/activate
  uv pip install -r requirements.txt
fi

. .venv/bin/activate
exec python -u run.py "$@"
