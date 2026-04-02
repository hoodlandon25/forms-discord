#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/.discord_forms_server.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Discord Forms Local is not running."
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" >/dev/null 2>&1; then
  kill "$PID"
  echo "Stopped Discord Forms Local."
else
  echo "Discord Forms Local was not running."
fi

rm -f "$PID_FILE"
