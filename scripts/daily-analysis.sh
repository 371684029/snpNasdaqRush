#!/usr/bin/env bash
# SnpRush 每日分析 — 每天 11:20 由 cron 触发
# 生成 Markdown 报告到 docs/ 目录

set -e

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/daily-$(date +%Y-%m-%d).log"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] SnpRush 每日分析开始" >> "$LOG_FILE" 2>&1

node "$PROJECT_DIR/dist/index.js" analysis --md >> "$LOG_FILE" 2>&1

EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ 分析完成" >> "$LOG_FILE" 2>&1
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ 分析失败 (exit code: $EXIT_CODE)" >> "$LOG_FILE" 2>&1
fi

exit $EXIT_CODE
