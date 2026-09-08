#!/bin/zsh
cd "$(dirname "$0")"
clear

URL="http://127.0.0.1:4173"

if ! command -v node >/dev/null 2>&1; then
  echo "Dialogue needs Node.js 22 or newer before this local build can run."
  echo "Install Node once, then double-click this file again."
  echo
  read "?Press Return to close."
  exit 1
fi

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null)
if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 22 ]]; then
  echo "Dialogue needs Node.js 22 or newer."
  echo "Your current Node.js version is: $(node --version 2>/dev/null)"
  echo "Update Node once, then double-click this file again."
  echo
  read "?Press Return to close."
  exit 1
fi

echo "Starting Dialogue…"
echo "Keep this window open while Dialogue is running."
echo

node server.js &
SERVER_PID=$!

sleep 1
open "$URL"

wait $SERVER_PID
