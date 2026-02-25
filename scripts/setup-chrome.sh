#!/bin/bash
# 启动闲鱼专用 Chrome 实例 (端口 18803)
# 用法: bash setup-chrome.sh [start|stop|status]

PORT=18803
PROFILE="$HOME/.chrome-debug-xianyu"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

case "${1:-status}" in
  start)
    if curl -s "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; then
      echo "✅ Chrome 已在端口 $PORT 运行"
      exit 0
    fi
    mkdir -p "$PROFILE"
    nohup "$CHROME" \
      --remote-debugging-port=$PORT \
      --user-data-dir="$PROFILE" \
      --no-first-run \
      --no-default-browser-check \
      --disable-background-timer-throttling \
      --disable-backgrounding-occluded-windows \
      --disable-renderer-backgrounding \
      --headless=new \
      > /dev/null 2>&1 &
    sleep 2
    if curl -s "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; then
      echo "✅ Chrome 已启动 (端口 $PORT, PID $!)"
    else
      echo "❌ Chrome 启动失败"
      exit 1
    fi
    ;;
  stop)
    PID=$(lsof -ti :$PORT 2>/dev/null | head -1)
    if [ -n "$PID" ]; then
      kill "$PID" 2>/dev/null
      echo "✅ Chrome 已停止 (PID $PID)"
    else
      echo "Chrome 未在运行"
    fi
    ;;
  status)
    if curl -s "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; then
      echo "✅ Chrome 运行中 (端口 $PORT)"
      curl -s "http://127.0.0.1:$PORT/json/version" | head -3
    else
      echo "❌ Chrome 未运行 (端口 $PORT)"
    fi
    ;;
  *)
    echo "用法: $0 [start|stop|status]"
    ;;
esac
