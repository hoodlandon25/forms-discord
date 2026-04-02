#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env"
  set +a
fi

DEPLOY_METHOD="${DEPLOY_METHOD:-}"
DEPLOY_LOCAL_DIR="${DEPLOY_LOCAL_DIR:-}"
DEPLOY_USER="${DEPLOY_USER:-}"
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_PATH="${DEPLOY_PATH:-}"
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"

if [[ -z "$DEPLOY_METHOD" ]]; then
  if [[ -n "$DEPLOY_LOCAL_DIR" ]]; then
    DEPLOY_METHOD="local-copy"
  elif [[ -n "$DEPLOY_HOST" && -n "$DEPLOY_PATH" ]]; then
    DEPLOY_METHOD="rsync"
  fi
fi

if [[ -z "$DEPLOY_METHOD" ]]; then
  echo "Deploy is not configured." >&2
  echo "Set DEPLOY_METHOD or provide DEPLOY_LOCAL_DIR / DEPLOY_HOST / DEPLOY_PATH in .env." >&2
  exit 1
fi

RSYNC_BIN="${RSYNC_BIN:-rsync}"
RSYNC_BASE_ARGS=(
  -az
  --delete
  --exclude=.env
  --exclude=.env.example
  --exclude=.admin_auth.json
  --exclude=.security_data.json
  --exclude=.discord_forms_server.log
  --exclude=.discord_forms_server.pid
  --exclude=__pycache__/
)

run_local_copy() {
  if [[ -z "$DEPLOY_LOCAL_DIR" ]]; then
    echo "DEPLOY_LOCAL_DIR is required for local-copy deploys." >&2
    exit 1
  fi

  mkdir -p "$DEPLOY_LOCAL_DIR"
  "$RSYNC_BIN" "${RSYNC_BASE_ARGS[@]}" "$SCRIPT_DIR/" "$DEPLOY_LOCAL_DIR/"
  echo "Local website updated at $DEPLOY_LOCAL_DIR"
}

run_rsync_remote() {
  if [[ -z "$DEPLOY_HOST" || -z "$DEPLOY_PATH" ]]; then
    echo "DEPLOY_HOST and DEPLOY_PATH are required for rsync deploys." >&2
    exit 1
  fi

  local remote_target
  if [[ -n "$DEPLOY_USER" ]]; then
    remote_target="${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}"
  else
    remote_target="${DEPLOY_HOST}:${DEPLOY_PATH}"
  fi

  "$RSYNC_BIN" "${RSYNC_BASE_ARGS[@]}" -e "ssh -p $DEPLOY_SSH_PORT" "$SCRIPT_DIR/" "$remote_target/"
  echo "Remote website updated at $remote_target"
}

case "$DEPLOY_METHOD" in
  local-copy)
    run_local_copy
    ;;
  rsync)
    run_rsync_remote
    ;;
  *)
    echo "Unsupported DEPLOY_METHOD: $DEPLOY_METHOD" >&2
    echo "Use local-copy or rsync." >&2
    exit 1
    ;;
esac
