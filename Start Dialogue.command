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

EXISTING_PID=$(lsof -tiTCP:4173 -sTCP:LISTEN 2>/dev/null | head -n 1)
if [[ -n "$EXISTING_PID" ]]; then
  EXISTING_CWD=$(lsof -a -p "$EXISTING_PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  EXISTING_CMD=$(ps -p "$EXISTING_PID" -o command= 2>/dev/null)

  if [[ "$EXISTING_CWD" == "$PWD" && "$EXISTING_CMD" == *"node server.js"* ]]; then
    echo "Restarting the existing Dialogue server from this checkout…"
    kill "$EXISTING_PID" 2>/dev/null
    for _ in {1..20}; do
      if ! kill -0 "$EXISTING_PID" 2>/dev/null; then break; fi
      sleep 0.1
    done
  else
    echo "Port 4173 is already being used by another process:"
    echo "  $EXISTING_CMD"
    echo
    echo "Dialogue was not started, to avoid opening a stale or unrelated server."
    echo "Close the process using port 4173, then run Start Dialogue.command again."
    echo
    read "?Press Return to close."
    exit 1
  fi
fi

node server.js &
SERVER_PID=$!

sleep 1
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "Dialogue did not start successfully."
  echo "Check the error above, then try again."
  echo
  read "?Press Return to close."
  exit 1
fi

open "$URL"

wait $SERVER_PID
