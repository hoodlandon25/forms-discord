#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WATCH_INTERVAL_SECONDS="${WATCH_INTERVAL_SECONDS:-5}"

snapshot() {
  find "$SCRIPT_DIR" -maxdepth 1 -type f \
    ! -name '.env' \
    ! -name '.admin_auth.json' \
    ! -name '.security_data.json' \
    ! -name '.site_data.json' \
    ! -name '.discord_forms_server.log' \
    ! -name '.discord_forms_server.pid' \
    -print0 \
    | sort -z \
    | xargs -0 sha256sum
}

LAST_SNAPSHOT="$(snapshot)"

echo "Watching $SCRIPT_DIR for website file changes."
echo "Polling every $WATCH_INTERVAL_SECONDS second(s)."

while true; do
  sleep "$WATCH_INTERVAL_SECONDS"
  CURRENT_SNAPSHOT="$(snapshot)"
  if [[ "$CURRENT_SNAPSHOT" == "$LAST_SNAPSHOT" ]]; then
    continue
  fi

  echo "Change detected. Deploying live website..."
  "$SCRIPT_DIR/deploy_website.sh"
  LAST_SNAPSHOT="$CURRENT_SNAPSHOT"
done
