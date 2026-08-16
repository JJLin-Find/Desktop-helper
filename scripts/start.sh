#!/usr/bin/env bash
#
# 桌宠助手 · 一键启动脚本
#
# 用法：
#   ./scripts/start.sh                 # 生产启动（构建 + 运行）
#   ./scripts/start.sh --dev           # 开发模式（electron-vite HMR 热更新）
#   ./scripts/start.sh --screenshot /tmp/pet.png   # 验证模式（截图后退出）
#   ./scripts/start.sh --compat        # 兼容模式（受限环境：--no-sandbox --disable-gpu）
#
# 自动处理：
#   1. 依赖缺失 → npm install（独立缓存，规避系统 npm 缓存权限问题）
#   2. Electron 二进制缺失 → 国内镜像下载
#   3. 运行失败且为沙箱/GPU 受限环境 → 自动以兼容参数重试
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="prod"
SCREENSHOT=""
COMPAT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev) MODE="dev"; shift ;;
    --compat) COMPAT=1; shift ;;
    --screenshot)
      if [[ $# -lt 2 ]]; then
        echo "[start] --screenshot 需要图片路径参数" >&2
        exit 1
      fi
      MODE="screenshot"; SCREENSHOT="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0 ;;
    *) echo "[start] 未知参数: $1（支持 --dev / --compat / --screenshot <path>）" >&2; exit 1 ;;
  esac
done

NPM_CACHE="$ROOT/.npm-cache"
ELECTRON_CACHE="$ROOT/.electron-cache"

# ---------- 1. 依赖检查与安装 ----------
if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "[start] 首次运行：安装依赖（约 1-2 分钟）..."
  npm install --no-audit --no-fund --cache "$NPM_CACHE"
fi

# ---------- 2. Electron 二进制检查与补装 ----------
if [[ ! -f "$ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ]]; then
  echo "[start] 补装 Electron 二进制（国内镜像）..."
  (
    cd "$ROOT/node_modules/electron"
    rm -rf dist
    electron_config_cache="$ELECTRON_CACHE" \
      ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
      node install.js
  )
fi

ELECTRON="$ROOT/node_modules/.bin/electron"

# ---------- 3. 构建（dev 模式无需预构建 packages，仍构建以确保最新） ----------
echo "[start] 构建 core / platform-api / desktop ..."
npm run build >/dev/null 2>&1 || {
  echo "[start] 构建失败，重新尝试并显示错误..." >&2
  npm run build
}

# ---------- 4. 启动 ----------
run_electron() {
  (
    cd "$ROOT/apps/desktop"
    if [[ "$MODE" == "dev" ]]; then
      exec "$ROOT/node_modules/.bin/electron-vite" dev "$@"
    elif [[ "$MODE" == "screenshot" ]]; then
      PET_SCREENSHOT="$SCREENSHOT" exec "$ELECTRON" . "$@"
    else
      exec "$ELECTRON" . "$@"
    fi
  )
}

echo "[start] 启动桌宠（mode=${MODE}）..."

if [[ "$COMPAT" -eq 1 ]]; then
  run_electron --no-sandbox --disable-gpu --user-data-dir="$ROOT/.electron-userdata"
  exit $?
fi

# 正常启动；若因沙箱/GPU 受限失败，自动以兼容参数重试
LOG="$(mktemp -t pet-start.XXXXXX)"
set +e
run_electron >"$LOG" 2>&1
CODE=$?
set -e

if grep -qE "sandbox initialization failed|Operation not permitted|GPU process isn't usable" "$LOG"; then
  echo "[start] 检测到受限环境，改用兼容参数重试..."
  cat "$LOG" | grep -E "\[main\]" || true
  run_electron --no-sandbox --disable-gpu --user-data-dir="$ROOT/.electron-userdata"
  exit $?
fi

cat "$LOG"
exit $CODE
