#!/bin/zsh

set -u

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

ROOT="$(cd "$(dirname "$0")" && pwd)"
PROFILE_NAME="dialogue"
PROFILE_PATH="$HOME/.config/tunnel-client/${PROFILE_NAME}.yaml"
KEYCHAIN_SERVICE="Dialogue ChatGPT Tunnel Runtime Key"
KEYCHAIN_ACCOUNT="${USER:-$(id -un)}"
DIALOGUE_URL="http://127.0.0.1:4173"
HEALTH_PORT="8080"
LOG_DIR="$HOME/Library/Logs/Dialogue"
SERVER_LOG="$LOG_DIR/dialogue-server.log"
TUNNEL_LOG="$LOG_DIR/tunnel-client.log"
SERVER_PID=""
TUNNEL_PID=""

pause_before_close() {
  echo
  read "?Press Return to close."
}

cleanup() {
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}

stop_and_exit() {
  echo
  echo "Stopping Dialogue and the ChatGPT connection..."
  cleanup
  exit 0
}

fail() {
  echo
  echo "$1"
  echo
  echo "Logs:"
  echo "  $SERVER_LOG"
  echo "  $TUNNEL_LOG"
  cleanup
  pause_before_close
  exit 1
}

trap stop_and_exit INT TERM HUP
trap cleanup EXIT

clear
echo "Starting Dialogue + ChatGPT"
echo "==========================="
echo

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "This launcher is currently for macOS only."
fi

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js 22 or newer is not available. Install or update Node, then try again."
fi

NODE_PATH="$(command -v node)"
NODE_MAJOR="$($NODE_PATH -p "Number(process.versions.node.split('.')[0])" 2>/dev/null)"
if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 22 ]]; then
  fail "Dialogue needs Node.js 22 or newer. Current version: $($NODE_PATH --version 2>/dev/null)"
fi

if ! command -v tunnel-client >/dev/null 2>&1; then
  fail "tunnel-client is not installed. Run 'Setup Dialogue for ChatGPT.command' first."
fi

if [[ ! -f "$PROFILE_PATH" ]]; then
  fail "The Dialogue tunnel profile does not exist. Run 'Setup Dialogue for ChatGPT.command' first."
fi

if [[ ! -f "$ROOT/server.js" || ! -f "$ROOT/mcp-server.mjs" ]]; then
  fail "Dialogue server files are missing. Run this launcher from inside the Dialogue repo."
fi

if ! CONTROL_PLANE_API_KEY="$(/usr/bin/security find-generic-password \
  -a "$KEYCHAIN_ACCOUNT" \
  -s "$KEYCHAIN_SERVICE" \
  -w 2>/dev/null)"; then
  fail "The Runtime API key is not in macOS Keychain. Run 'Setup Dialogue for ChatGPT.command' first."
fi
export CONTROL_PLANE_API_KEY

mkdir -p "$LOG_DIR"
echo "" >> "$SERVER_LOG"
echo "--- $(date) ---" >> "$SERVER_LOG"
echo "" >> "$TUNNEL_LOG"
echo "--- $(date) ---" >> "$TUNNEL_LOG"

if command -v lsof >/dev/null 2>&1; then
  if lsof -nP -iTCP:4173 -sTCP:LISTEN >/dev/null 2>&1; then
    fail "Port 4173 is already in use. Stop the existing Dialogue process, then try again."
  fi
  if lsof -nP -iTCP:$HEALTH_PORT -sTCP:LISTEN >/dev/null 2>&1; then
    fail "Port $HEALTH_PORT is already in use. Stop the existing tunnel-client process, then try again."
  fi
fi

printf "Starting Dialogue"
"$NODE_PATH" "$ROOT/server.js" >> "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

SERVER_READY=0
for _ in {1..30}; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo
    tail -n 20 "$SERVER_LOG" 2>/dev/null || true
    fail "Dialogue stopped while starting."
  fi
  if curl -fsS "$DIALOGUE_URL" >/dev/null 2>&1; then
    SERVER_READY=1
    break
  fi
  printf "."
  sleep 0.5
done

if [[ "$SERVER_READY" -ne 1 ]]; then
  echo
  tail -n 20 "$SERVER_LOG" 2>/dev/null || true
  fail "Dialogue did not become ready in time."
fi

echo " ready"
printf "Starting ChatGPT tunnel"
tunnel-client run --profile "$PROFILE_NAME" >> "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

TUNNEL_READY=0
for _ in {1..60}; do
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo
    tail -n 30 "$TUNNEL_LOG" 2>/dev/null || true
    fail "The ChatGPT tunnel stopped while starting."
  fi
  if tunnel-client health --port "$HEALTH_PORT" --require-control-plane-poll >/dev/null 2>&1; then
    TUNNEL_READY=1
    break
  fi
  printf "."
  sleep 2
done

if [[ "$TUNNEL_READY" -ne 1 ]]; then
  echo
  tail -n 30 "$TUNNEL_LOG" 2>/dev/null || true
  fail "The ChatGPT tunnel did not become ready within two minutes."
fi

echo " ready"
echo
open "$DIALOGUE_URL"

echo "Dialogue + ChatGPT is ready."
echo "Dialogue: $DIALOGUE_URL"
echo
echo "Keep this window open while you use Dialogue with ChatGPT."
echo "Press Control-C here when you want to stop both."

while true; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    tail -n 20 "$SERVER_LOG" 2>/dev/null || true
    fail "Dialogue stopped unexpectedly."
  fi
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    tail -n 30 "$TUNNEL_LOG" 2>/dev/null || true
    fail "The ChatGPT tunnel stopped unexpectedly."
  fi
  sleep 3
done
