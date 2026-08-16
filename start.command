#!/usr/bin/env bash
#
# 桌宠助手 · macOS Finder 双击启动入口
# 双击本文件即可启动（首次会自动安装依赖并构建）。
# 需要开发模式：终端执行 ./scripts/start.sh --dev
#
cd "$(dirname "$0")"
exec bash "$(dirname "$0")/scripts/start.sh" "$@"
