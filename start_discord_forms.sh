#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi

PYTHON_BIN="${PYTHON_BIN:-python3}"
PORT="${PORT:-8134}"
HOST="${HOST:-0.0.0.0}"
PID_FILE="$SCRIPT_DIR/.discord_forms_server.pid"
LOG_FILE="$SCRIPT_DIR/.discord_forms_server.log"
LOCAL_URL="http://127.0.0.1:${PORT}/"

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
LAN_URL=""
if [[ -n "${LAN_IP:-}" ]]; then
  LAN_URL="http://${LAN_IP}:${PORT}/"
fi

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE")"
  if kill -0 "$OLD_PID" >/dev/null 2>&1; then
    echo "Discord Forms Local is already running at $LOCAL_URL"
    [[ -n "$LAN_URL" ]] && echo "Network: $LAN_URL"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

cd "$SCRIPT_DIR"
nohup "$PYTHON_BIN" "$SCRIPT_DIR/server.py" --host "$HOST" --port "$PORT" --root "$SCRIPT_DIR" </dev/null >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

sleep 1
if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
  echo "Failed to start local server. Check $LOG_FILE" >&2
  rm -f "$PID_FILE"
  exit 1
fi

xdg-open "$LOCAL_URL" >/dev/null 2>&1 || true

echo "Discord Forms Local is running."
echo "Local: $LOCAL_URL"
[[ -n "$LAN_URL" ]] && echo "Network: $LAN_URL"
echo "Stop: $SCRIPT_DIR/stop_discord_forms.sh"
