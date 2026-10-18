#!/bin/sh
# 从脚本自身目录跑：避免「在别的 cwd 下跑就找不到 tools/」的假红（无绝对路径）
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$SCRIPT_DIR" || exit 1

PASS=0; FAIL=0; FAILES=""; REDS=""
for f in tools/*-check.js tools/smoke-*.js; do
  # perf-step-check 在套件里只判体积门（--suite）：延迟是环境属性，别混进功能批
  EXTRA=""
  case "$f" in tools/perf-step-check.js) EXTRA=--suite;; esac
  if node "$f" $EXTRA >/dev/null 2>&1; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILES="$FAILES $f"; fi
done
echo "PASS=$PASS FAIL=$FAIL"
echo "REDS:$FAILES"
